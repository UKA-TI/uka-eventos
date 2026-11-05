import type { FiscalData, RefundInput } from '@uka/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { linkContact } from '../contacts/contact-link.js';
import { enqueueEmail } from '../mail/queue.js';
import {
  activePaid,
  assertEventOpen,
  issuePass,
  lockOrder,
} from './order-service.js';

const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 };

async function loadOrder(eventId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, eventId },
    include: { buyer: true },
  });
  if (!order) {
    throw new AppError(404, 'El pedido no existe.');
  }
  return order;
}

/** Una fecha nueva reinicia los recordatorios: los anteriores hablaban de otro plazo. */
export async function setDueDate(
  eventId: string,
  orderId: string,
  dueAt: Date,
) {
  const order = await loadOrder(eventId, orderId);
  if (order.status !== 'pending_payment') {
    throw new AppError(409, 'Solo una compra con saldo tiene vencimiento.');
  }
  return prisma.order.update({
    where: { id: order.id },
    data: { dueAt, reminderStage: 0 },
  });
}

export async function remindOrder(eventId: string, orderId: string) {
  const order = await loadOrder(eventId, orderId);
  if (order.status !== 'pending_payment') {
    throw new AppError(409, 'Esta compra no tiene saldo pendiente.');
  }
  if (!order.buyer.email) {
    throw new AppError(409, 'Esta compra no tiene correo de contacto.');
  }
  const toEmail = order.buyer.email;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { lastReminderAt: new Date() },
    });
    await enqueueEmail(tx, {
      eventId,
      kind: 'payment_reminder',
      refId: order.id,
      toEmail,
    });
  });
  return order;
}

/** Con factura ya emitida, cambiar los datos exigiría sustituirla: no se hace aquí. */
export async function saveFiscalData(
  eventId: string,
  orderId: string,
  fiscal: FiscalData | null,
) {
  const order = await loadOrder(eventId, orderId);
  if (order.invoiceStatus === 'issued') {
    throw new AppError(
      409,
      'Esta compra ya tiene factura. Sustitúyela en tu sistema de facturación.',
    );
  }
  return prisma.order.update({
    where: { id: order.id },
    data: fiscal
      ? {
          fiscalData: fiscal as Prisma.InputJsonValue,
          invoiceStatus: 'requested',
        }
      : { fiscalData: Prisma.DbNull, invoiceStatus: 'none' },
  });
}

export async function markInvoiced(
  eventId: string,
  orderId: string,
  invoiceFolio: string,
) {
  const order = await loadOrder(eventId, orderId);
  if (order.invoiceStatus !== 'requested') {
    throw new AppError(409, 'Esta compra no tiene una factura solicitada.');
  }
  return prisma.order.update({
    where: { id: order.id },
    data: { invoiceStatus: 'issued', invoiceFolio, invoicedAt: new Date() },
  });
}

/**
 * Un reembolso es dinero que de verdad salió; anular un pago es corregir un error. Una
 * compra activa solo se reembolsa ya pagada por completo: si aún debe saldo, devolverle
 * el anticipo y seguir cobrándole no tiene sentido, y lo que procede es cancelarla.
 */
export async function recordRefund(params: {
  eventId: string;
  orderId: string;
  input: RefundInput;
  userId: string;
}) {
  const { eventId, orderId, input, userId } = params;
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, eventId },
      include: { payments: true, refunds: true },
    });
    if (!order) {
      throw new AppError(404, 'El pedido no existe.');
    }
    await assertEventOpen(tx, eventId);
    if (order.status === 'pending_payment') {
      throw new AppError(
        409,
        'Esta compra aún tiene saldo. Para devolver un anticipo, cancélala.',
      );
    }
    const net = activePaid(order.payments) - activePaid(order.refunds);
    if (input.amount > net + 0.005) {
      throw new AppError(
        409,
        `El reembolso excede lo cobrado de ${net.toFixed(2)}.`,
      );
    }
    return tx.refund.create({
      data: {
        orderId: order.id,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        reason: input.reason,
        refundedAt: new Date(input.refundedAt),
        recordedById: userId,
      },
    });
  }, TX_OPTIONS);
}

export async function voidRefund(params: {
  eventId: string;
  orderId: string;
  refundId: string;
  userId: string;
}) {
  const { eventId, orderId, refundId, userId } = params;
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const refund = await tx.refund.findFirst({
      where: { id: refundId, orderId, order: { eventId } },
    });
    if (!refund) {
      throw new AppError(404, 'El reembolso no existe.');
    }
    if (refund.voidedAt) {
      throw new AppError(409, 'Este reembolso ya estaba anulado.');
    }
    await assertEventOpen(tx, eventId);
    return tx.refund.update({
      where: { id: refund.id },
      data: { voidedAt: new Date(), voidedById: userId },
    });
  }, TX_OPTIONS);
}

async function loadRegistration(
  tx: Prisma.TransactionClient,
  eventId: string,
  registrationId: string,
) {
  const registration = await tx.registration.findFirst({
    where: { id: registrationId, eventId, status: { not: 'cancelled' } },
    include: {
      guest: true,
      passes: {
        where: { status: { in: ['active', 'pending_activation'] } },
        include: { checkin: { select: { id: true } } },
      },
    },
  });
  if (!registration) {
    throw new AppError(404, 'Este registro no existe o está cancelado.');
  }
  return registration;
}

/** Misma persona, nombre mal escrito: el QR y su aceptación del aviso siguen valiendo. */
export async function correctGuestName(
  eventId: string,
  registrationId: string,
  input: { firstName: string; lastName: string },
) {
  return prisma.$transaction(async (tx) => {
    const registration = await loadRegistration(tx, eventId, registrationId);
    await tx.guest.update({
      where: { id: registration.guestId },
      data: { firstName: input.firstName, lastName: input.lastName },
    });
    return {
      folio: registration.folio,
      previous: `${registration.guest.firstName} ${registration.guest.lastName}`,
    };
  }, TX_OPTIONS);
}

/**
 * Otra persona ocupa el lugar. Conserva el folio y la mesa, pero el QR anterior deja de
 * valer y la nueva persona acepta el aviso por sí misma antes de tener el suyo. Quien
 * cedió sigue como comprador y su aceptación queda a su nombre.
 */
export async function transferPass(
  eventId: string,
  registrationId: string,
  input: {
    firstName: string;
    lastName: string;
    email: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const registration = await loadRegistration(tx, eventId, registrationId);
    if (registration.status !== 'confirmed') {
      throw new AppError(
        409,
        'Este lugar aún no está pagado. Corrige el registro o espera el pago.',
      );
    }
    if (registration.passes.some((pass) => pass.checkin)) {
      throw new AppError(409, 'Este pase ya ingresó al evento.');
    }
    const contactId = await linkContact(tx, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: null,
      organization: null,
    });
    const guest = await tx.guest.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        contactId,
      },
    });
    await tx.pass.updateMany({
      where: { id: { in: registration.passes.map((pass) => pass.id) } },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    await tx.registration.update({
      where: { id: registration.id },
      data: { guestId: guest.id },
    });
    const passId = await issuePass(tx, registration.id, 'pending_activation');
    await enqueueEmail(tx, {
      eventId,
      kind: 'pass_activation',
      refId: passId,
      toEmail: input.email,
    });
    return {
      folio: registration.folio,
      previous: `${registration.guest.firstName} ${registration.guest.lastName}`,
    };
  }, TX_OPTIONS);
}

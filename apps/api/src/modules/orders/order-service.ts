import {
  PRIVACY_NOTICE_VERSION,
  type GroupGuestInput,
  type OrderDelegateInput,
  type OrderInput,
  type PaymentInput,
  type ReconciledOrderInput,
} from '@uka/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { issueFolioWithin } from '../folios/prisma-folio-database.js';
import { linkContact } from '../contacts/contact-link.js';
import { enqueueEmail } from '../mail/queue.js';
import {
  groupToken,
  hashToken,
  newRecordId,
  passToken,
} from '../passes/tokens.js';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 };
const ACTIVE_ORDER = { in: ['pending_payment', 'confirmed'] };

/** Serializa las ventas de un evento para que el cupo no se pueda exceder. */
async function lockEvent(tx: Tx, eventId: string) {
  await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
}

async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
}

function fieldValue(type: string, value: unknown): string {
  if (type === 'checkbox') {
    return value === true ? 'Sí' : 'No';
  }
  return typeof value === 'string' ? value.trim() : '';
}

/** Valida contra las preguntas vigentes y guarda también su texto, por si cambian. */
function buildAnswers(
  fields: {
    id: string;
    label: string;
    type: string;
    required: boolean;
    options: Prisma.JsonValue;
  }[],
  answers: OrderInput['answers'],
) {
  return fields.map((field) => {
    const value = fieldValue(field.type, answers[field.id]);
    if (field.required && !value) {
      throw new AppError(400, `Responde la pregunta "${field.label}".`);
    }
    if (value && field.type === 'select') {
      const options = Array.isArray(field.options) ? field.options : [];
      if (!options.includes(value)) {
        throw new AppError(400, `Elige una opción válida en "${field.label}".`);
      }
    }
    if (value && field.type === 'number' && Number.isNaN(Number(value))) {
      throw new AppError(400, `Escribe un número en "${field.label}".`);
    }
    if (value && field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new AppError(400, `Escribe una fecha válida en "${field.label}".`);
    }
    return { label: field.label, value };
  });
}

/** Un pase sin activar existe, pero no muestra QR hasta que su dueño acepte el aviso. */
const LIVE_PASS = { in: ['active', 'pending_activation'] };

async function issuePass(
  tx: Tx,
  registrationId: string,
  status: 'active' | 'pending_activation' = 'active',
) {
  const id = newRecordId();
  await tx.pass.create({
    data: {
      id,
      registrationId,
      tokenHash: hashToken(passToken(id)),
      status,
    },
  });
  return id;
}

/** Quien compró varios lugares o por otro medio registra a los asistentes con una liga. */
const usesPrivateLink = (order: { seats: number; source: string }) =>
  order.seats > 1 || order.source === 'reconciled';

const privateLinkEmail = (order: { source: string }) =>
  order.source === 'reconciled' ? 'registration_invite' : 'group_link';

/** Confirma un pedido: emite los pases y deja los correos en la cola. */
async function confirmOrder(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      buyer: true,
      registrations: {
        where: { status: { not: 'cancelled' } },
        include: { guest: true, consents: { select: { id: true } } },
      },
    },
  });
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
      ...(usesPrivateLink(order)
        ? { groupTokenHash: hashToken(groupToken(order.id)) }
        : {}),
    },
  });
  for (const registration of order.registrations) {
    await tx.registration.update({
      where: { id: registration.id },
      data: { status: 'confirmed' },
    });
    // Al recuperar un pago, quien nunca aceptó el aviso sigue sin haberlo aceptado.
    const needsActivation =
      usesPrivateLink(order) && registration.consents.length === 0;
    const passId = await issuePass(
      tx,
      registration.id,
      needsActivation ? 'pending_activation' : 'active',
    );
    if (registration.guest.email) {
      await enqueueEmail(tx, {
        eventId: order.eventId,
        kind: needsActivation ? 'pass_activation' : 'pass',
        refId: passId,
        toEmail: registration.guest.email,
      });
    }
  }
  const recipient = order.delegateEmail ?? order.buyer.email;
  if (usesPrivateLink(order) && recipient) {
    await enqueueEmail(tx, {
      eventId: order.eventId,
      kind: privateLinkEmail(order),
      refId: order.id,
      toEmail: recipient,
    });
  }
}

/** Revierte un pedido confirmado: sus pases dejan de ser válidos. */
async function revokePasses(tx: Tx, orderId: string, status: string) {
  const registrations = await tx.registration.findMany({
    where: { orderId, status: { not: 'cancelled' } },
    select: { id: true },
  });
  const ids = registrations.map((registration) => registration.id);
  const used = await tx.checkin.count({
    where: { pass: { registrationId: { in: ids } } },
  });
  if (used > 0) {
    throw new AppError(
      409,
      'Este pedido ya tiene personas que ingresaron al evento.',
    );
  }
  await tx.pass.updateMany({
    where: { registrationId: { in: ids }, status: LIVE_PASS },
    data: { status: 'revoked', revokedAt: new Date() },
  });
  await tx.registration.updateMany({
    where: { id: { in: ids } },
    data: { status },
  });
}

async function assertAvailable(
  tx: Tx,
  event: { id: string; capacity: number | null },
  ticket: { id: string; capacity: number | null; seatsIncluded: number },
  quantity: number,
) {
  if (ticket.capacity !== null) {
    const sold = await tx.order.aggregate({
      where: { ticketTypeId: ticket.id, status: ACTIVE_ORDER },
      _sum: { quantity: true },
    });
    if ((sold._sum.quantity ?? 0) + quantity > ticket.capacity) {
      throw new AppError(409, 'Este boleto ya está agotado.');
    }
  }
  if (event.capacity !== null) {
    const taken = await tx.order.aggregate({
      where: { eventId: event.id, status: ACTIVE_ORDER },
      _sum: { seats: true },
    });
    if (
      (taken._sum.seats ?? 0) + ticket.seatsIncluded * quantity >
      event.capacity
    ) {
      throw new AppError(409, 'El evento ya no tiene lugares disponibles.');
    }
  }
}

async function nextReference(tx: Tx, eventId: string) {
  await tx.eventCounter.upsert({
    where: {
      eventId_counterType: { eventId, counterType: 'registration' },
    },
    update: {},
    create: { eventId, counterType: 'registration', currentValue: 0 },
  });
  return issueFolioWithin(tx, eventId);
}

/**
 * Registra una compra hecha por otro medio. El pago ya se concilió, así que solo
 * se envía la invitación a registrarse: el pase sale cuando la persona se registra.
 */
export async function createReconciledOrder(params: {
  eventId: string;
  input: ReconciledOrderInput;
  userId: string;
}) {
  const { eventId, input, userId } = params;
  return prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    if (event.status !== 'active') {
      throw new AppError(409, 'Este evento no está activo.');
    }
    const ticket = await tx.ticketType.findFirst({
      where: { id: input.ticketTypeId, eventId },
    });
    if (!ticket) {
      throw new AppError(400, 'Este boleto no existe.');
    }
    if (input.amount > 0 && !input.reference) {
      throw new AppError(
        400,
        'Escribe la referencia del pago para conciliarlo.',
      );
    }
    // Conciliar dos veces el mismo pago regalaría lugares.
    if (input.reference) {
      const repeated = await tx.payment.findFirst({
        where: {
          reference: input.reference,
          voidedAt: null,
          order: { eventId, status: { not: 'cancelled' } },
        },
        include: { order: { select: { reference: true } } },
      });
      if (repeated) {
        throw new AppError(
          409,
          `Ese pago ya se concilió en el pedido ${repeated.order.reference}.`,
        );
      }
    }
    await assertAvailable(tx, event, ticket, input.quantity);

    const reference = await nextReference(tx, eventId);
    const contactId = await linkContact(tx, input);
    const guest = await tx.guest.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        organization: input.organization,
        contactId,
      },
    });
    const order = await tx.order.create({
      data: {
        eventId,
        ticketTypeId: ticket.id,
        buyerGuestId: guest.id,
        createdById: userId,
        reference,
        quantity: input.quantity,
        seats: ticket.seatsIncluded * input.quantity,
        // Lo que realmente se recibió: puede haber descuentos o cortesías.
        amountDue: input.amount,
        source: 'reconciled',
        answers: [],
        delegateName: input.delegateName || null,
        delegateEmail: input.delegateEmail || null,
        folioPrefix: input.folioPrefix || null,
        registrationDeadline: input.registrationDeadline
          ? new Date(input.registrationDeadline)
          : null,
      },
    });
    if (input.amount > 0) {
      await tx.payment.create({
        data: {
          orderId: order.id,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
          notes: input.notes,
          paidAt: new Date(input.paidAt),
          recordedById: userId,
        },
      });
    }
    await confirmOrder(tx, order.id);
    return order;
  }, TX_OPTIONS);
}

/** Vuelve a enviar la liga a quien aún no termina de registrar a sus asistentes. */
export async function resendPrivateLink(eventId: string, orderId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, eventId },
      include: {
        buyer: true,
        _count: {
          select: {
            registrations: { where: { status: { not: 'cancelled' } } },
          },
        },
      },
    });
    if (!order || order.status !== 'confirmed' || !order.groupTokenHash) {
      throw new AppError(404, 'Este pedido no tiene una liga activa.');
    }
    const recipient = order.delegateEmail ?? order.buyer.email;
    if (!recipient) {
      throw new AppError(409, 'Este pedido no tiene correo.');
    }
    if (order._count.registrations >= order.seats) {
      throw new AppError(409, 'Ya se registraron todos los lugares.');
    }
    await enqueueEmail(tx, {
      eventId,
      kind: privateLinkEmail(order),
      refId: order.id,
      toEmail: recipient,
    });
  }, TX_OPTIONS);
}

/** Cambia a quién le toca registrar a los invitados y le envía la liga. */
export async function assignDelegate(
  eventId: string,
  orderId: string,
  input: OrderDelegateInput,
) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, eventId },
    });
    if (!order || order.status === 'cancelled') {
      throw new AppError(404, 'El pedido no existe.');
    }
    if (!usesPrivateLink(order)) {
      throw new AppError(
        409,
        'Este pedido es de un solo lugar y no usa liga de registro.',
      );
    }
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        delegateName: input.delegateName || null,
        delegateEmail: input.delegateEmail || null,
        folioPrefix: input.folioPrefix || null,
        registrationDeadline: input.registrationDeadline
          ? new Date(input.registrationDeadline)
          : null,
      },
    });
    if (
      input.delegateEmail &&
      input.delegateEmail !== order.delegateEmail &&
      order.status === 'confirmed'
    ) {
      await enqueueEmail(tx, {
        eventId,
        kind: privateLinkEmail(order),
        refId: order.id,
        toEmail: input.delegateEmail,
      });
    }
    return updated;
  }, TX_OPTIONS);
}

/** Folio de la mesa, como SORIANA-03. Si el lugar cambió de invitado, SORIANA-03-2. */
async function tableFolio(
  tx: Tx,
  eventId: string,
  prefix: string,
  seatNumber: number,
) {
  const base = `${prefix}-${String(seatNumber).padStart(2, '0')}`;
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const folio = attempt === 1 ? base : `${base}-${attempt}`;
    const used = await tx.registration.findFirst({
      where: { eventId, folio },
      select: { id: true },
    });
    if (!used) {
      return folio;
    }
  }
  throw new AppError(409, 'Este lugar ya cambió demasiadas veces de invitado.');
}

/** El invitado acepta el aviso por sí mismo. Solo entonces existe su QR. */
export async function activatePass(
  token: string,
  phone: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const pass = await tx.pass.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { registration: { include: { guest: true } } },
    });
    if (!pass) {
      throw new AppError(404, 'Este pase no existe.');
    }
    if (pass.status === 'active') {
      return;
    }
    if (pass.status !== 'pending_activation') {
      throw new AppError(409, 'Este pase ya no es válido.');
    }
    const claim = await tx.pass.updateMany({
      where: { id: pass.id, status: 'pending_activation' },
      data: { status: 'active' },
    });
    if (claim.count === 0) {
      return;
    }
    const { registration } = pass;
    await tx.consent.create({
      data: {
        registrationId: registration.id,
        purpose: 'event_registration',
        noticeVersion: PRIVACY_NOTICE_VERSION,
        granted: true,
        consentedAt: new Date(),
      },
    });
    if (phone) {
      await tx.guest.update({
        where: { id: registration.guestId },
        data: { phone },
      });
      if (registration.guest.contactId) {
        await tx.contact.updateMany({
          where: { id: registration.guest.contactId, phone: null },
          data: { phone },
        });
      }
    }
    if (registration.guest.email) {
      await enqueueEmail(tx, {
        eventId: registration.eventId,
        kind: 'pass',
        refId: pass.id,
        toEmail: registration.guest.email,
      });
    }
  }, TX_OPTIONS);
}

/** Reenvío desde la liga de la mesa: solo al correo de ese mismo invitado. */
export async function resendGroupGuest(token: string, registrationId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await loadGroup(tx, token);
    const registration = await tx.registration.findFirst({
      where: {
        id: registrationId,
        orderId: order.id,
        status: { not: 'cancelled' },
      },
      include: { guest: true, passes: { where: { status: LIVE_PASS } } },
    });
    const pass = registration?.passes[0];
    if (!registration || !pass || !registration.guest.email) {
      throw new AppError(404, 'Este invitado no tiene un pase vigente.');
    }
    await enqueueEmail(tx, {
      eventId: order.eventId,
      kind: pass.status === 'active' ? 'pass' : 'pass_activation',
      refId: pass.id,
      toEmail: registration.guest.email,
    });
  }, TX_OPTIONS);
}

export async function createOrder(params: {
  eventId: string;
  input: OrderInput;
  source: 'public' | 'staff';
  createdById?: string;
  privacyAccepted: boolean;
}) {
  const { eventId, input, source, createdById, privacyAccepted } = params;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const event = await tx.event.findUniqueOrThrow({
      where: { id: eventId },
      include: {
        formFields: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (event.status !== 'active') {
      throw new AppError(409, 'Este evento no tiene el registro abierto.');
    }
    const ticket = await tx.ticketType.findFirst({
      where: { id: input.ticketTypeId, eventId },
    });
    if (!ticket || !ticket.active) {
      throw new AppError(400, 'Este boleto no está disponible.');
    }
    if (source === 'public') {
      if (
        (ticket.salesStart && ticket.salesStart > now) ||
        (ticket.salesEnd && ticket.salesEnd < now)
      ) {
        throw new AppError(
          409,
          'Este boleto está fuera de su periodo de venta.',
        );
      }
    }

    await assertAvailable(tx, event, ticket, 1);

    const answers = buildAnswers(event.formFields, input.answers);
    const reference = await nextReference(tx, eventId);
    const contactId = await linkContact(tx, input);
    const guest = await tx.guest.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        organization: input.organization,
        contactId,
      },
    });
    const order = await tx.order.create({
      data: {
        eventId,
        ticketTypeId: ticket.id,
        buyerGuestId: guest.id,
        createdById,
        reference,
        seats: ticket.seatsIncluded,
        amountDue: ticket.price,
        source,
        answers,
      },
    });

    // Un boleto de un lugar es de quien lo compra; uno de varios lugares se
    // reparte después con la liga privada.
    if (ticket.seatsIncluded === 1) {
      const registration = await tx.registration.create({
        data: {
          eventId,
          guestId: guest.id,
          orderId: order.id,
          seatNumber: 1,
          folio: reference,
          status: 'pending',
        },
      });
      if (privacyAccepted) {
        await tx.consent.create({
          data: {
            registrationId: registration.id,
            purpose: 'event_registration',
            noticeVersion: PRIVACY_NOTICE_VERSION,
            granted: true,
            consentedAt: now,
          },
        });
      }
    }

    if (ticket.price.toNumber() === 0) {
      await confirmOrder(tx, order.id);
    } else {
      await enqueueEmail(tx, {
        eventId,
        kind: 'order_pending',
        refId: order.id,
        toEmail: input.email,
      });
    }
    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { registrations: { include: { passes: true } } },
    });
  }, TX_OPTIONS);
}

const moneyEquals = (a: number, b: number) => Math.abs(a - b) < 0.005;

function activePaid(
  payments: { amount: { toNumber(): number }; voidedAt: Date | null }[],
) {
  return payments
    .filter((payment) => !payment.voidedAt)
    .reduce((total, payment) => total + payment.amount.toNumber(), 0);
}

export async function recordPayment(params: {
  eventId: string;
  orderId: string;
  input: PaymentInput;
  userId: string;
}) {
  const { eventId, orderId, input, userId } = params;
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, eventId },
      include: { payments: true },
    });
    if (!order) {
      throw new AppError(404, 'El pedido no existe.');
    }
    if (order.status === 'cancelled') {
      throw new AppError(409, 'Este pedido está cancelado.');
    }
    const due = order.amountDue.toNumber();
    const paid = activePaid(order.payments);
    const total = paid + input.amount;
    if (total > due && !moneyEquals(total, due)) {
      throw new AppError(
        409,
        `El pago excede el saldo pendiente de ${(due - paid).toFixed(2)}.`,
      );
    }
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        amount: input.amount,
        method: input.method,
        reference: input.reference,
        notes: input.notes,
        paidAt: new Date(input.paidAt),
        recordedById: userId,
      },
    });
    const completed = moneyEquals(total, due);
    if (completed && order.status === 'pending_payment') {
      await confirmOrder(tx, order.id);
    }
    return { payment, completed };
  }, TX_OPTIONS);
}

export async function voidPayment(params: {
  eventId: string;
  orderId: string;
  paymentId: string;
  userId: string;
}) {
  const { eventId, orderId, paymentId, userId } = params;
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, eventId },
      include: { payments: true },
    });
    const payment = order?.payments.find((item) => item.id === paymentId);
    if (!order || !payment) {
      throw new AppError(404, 'El pago no existe.');
    }
    if (payment.voidedAt) {
      throw new AppError(409, 'Este pago ya estaba anulado.');
    }
    const remaining = activePaid(
      order.payments.filter((item) => item.id !== paymentId),
    );
    const stillPaid = moneyEquals(remaining, order.amountDue.toNumber());
    if (order.status === 'confirmed' && !stillPaid) {
      await revokePasses(tx, order.id, 'pending');
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'pending_payment',
          confirmedAt: null,
          groupTokenHash: null,
        },
      });
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidedById: userId },
    });
    return payment;
  }, TX_OPTIONS);
}

export async function cancelOrder(eventId: string, orderId: string) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({ where: { id: orderId, eventId } });
    if (!order) {
      throw new AppError(404, 'El pedido no existe.');
    }
    if (order.status === 'cancelled') {
      throw new AppError(409, 'Este pedido ya estaba cancelado.');
    }
    await revokePasses(tx, order.id, 'cancelled');
    return tx.order.update({
      where: { id: order.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        groupTokenHash: null,
      },
    });
  }, TX_OPTIONS);
}

async function loadGroup(tx: Tx, token: string) {
  const order = await tx.order.findUnique({
    where: { groupTokenHash: hashToken(token) },
  });
  if (!order || order.status !== 'confirmed') {
    throw new AppError(404, 'Esta liga no es válida.');
  }
  return order;
}

export async function addGroupGuest(token: string, input: GroupGuestInput) {
  return prisma.$transaction(async (tx) => {
    const found = await loadGroup(tx, token);
    const buyer = await tx.guest.findUniqueOrThrow({
      where: { id: found.buyerGuestId },
      select: { email: true },
    });
    await lockOrder(tx, found.id);
    await lockEvent(tx, found.eventId);
    const taken = await tx.registration.findMany({
      where: { orderId: found.id, status: { not: 'cancelled' } },
      select: { seatNumber: true },
    });
    if (taken.length >= found.seats) {
      throw new AppError(409, 'Ya se registraron todos los lugares.');
    }
    const used = new Set(taken.map((item) => item.seatNumber));
    let seatNumber = input.seatNumber ?? 1;
    if (input.seatNumber) {
      if (input.seatNumber > found.seats || used.has(input.seatNumber)) {
        throw new AppError(
          409,
          'Ese lugar ya fue ocupado. Actualiza la página.',
        );
      }
    } else {
      while (used.has(seatNumber)) {
        seatNumber += 1;
      }
    }
    const repeated = await tx.registration.findFirst({
      where: {
        eventId: found.eventId,
        status: { not: 'cancelled' },
        guest: { email: input.email },
      },
      select: { id: true },
    });
    if (repeated) {
      throw new AppError(
        409,
        'Ese correo ya tiene un lugar activo en este evento.',
      );
    }
    // Solo quien compró y registra por sí mismo acepta aquí el aviso. Lo que captura
    // una asistente, o cualquier dato de un tercero, lo activa el propio invitado.
    const isSelf = !found.delegateEmail && buyer.email === input.email;
    if (isSelf && !input.authorized) {
      throw new AppError(
        400,
        'Acepta el aviso de privacidad para registrarte.',
      );
    }
    const folio = found.folioPrefix
      ? await tableFolio(tx, found.eventId, found.folioPrefix, seatNumber)
      : await issueFolioWithin(tx, found.eventId);
    const contactId = await linkContact(tx, input);
    const guest = await tx.guest.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        organization: input.organization,
        contactId,
      },
    });
    const registration = await tx.registration.create({
      data: {
        eventId: found.eventId,
        guestId: guest.id,
        orderId: found.id,
        seatNumber,
        folio,
        status: 'confirmed',
      },
    });
    if (isSelf) {
      await tx.consent.create({
        data: {
          registrationId: registration.id,
          purpose: 'event_registration',
          noticeVersion: PRIVACY_NOTICE_VERSION,
          granted: true,
          consentedAt: new Date(),
        },
      });
    }
    const passId = await issuePass(
      tx,
      registration.id,
      isSelf ? 'active' : 'pending_activation',
    );
    await enqueueEmail(tx, {
      eventId: found.eventId,
      kind: isSelf ? 'pass' : 'pass_activation',
      refId: passId,
      toEmail: input.email,
    });
    return registration;
  }, TX_OPTIONS);
}

export async function removeGroupGuest(token: string, registrationId: string) {
  return prisma.$transaction(async (tx) => {
    const order = await loadGroup(tx, token);
    const registration = await tx.registration.findFirst({
      where: {
        id: registrationId,
        orderId: order.id,
        status: { not: 'cancelled' },
      },
      include: { passes: { include: { checkin: true } } },
    });
    if (!registration) {
      throw new AppError(404, 'Este invitado no existe.');
    }
    if (registration.passes.some((pass) => pass.checkin)) {
      throw new AppError(409, 'Este invitado ya ingresó al evento.');
    }
    await tx.pass.updateMany({
      where: { registrationId: registration.id, status: LIVE_PASS },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    // Libera el asiento para que otra persona pueda ocuparlo.
    await tx.registration.update({
      where: { id: registration.id },
      data: { status: 'cancelled', seatNumber: null },
    });
  }, TX_OPTIONS);
}

export async function resendPass(eventId: string, registrationId: string) {
  return prisma.$transaction(async (tx) => {
    const registration = await tx.registration.findFirst({
      where: { id: registrationId, eventId },
      include: { guest: true, passes: { where: { status: LIVE_PASS } } },
    });
    const pass = registration?.passes[0];
    if (!registration || !pass) {
      throw new AppError(404, 'Este registro no tiene un pase activo.');
    }
    if (!registration.guest.email) {
      throw new AppError(409, 'Este registro no tiene correo.');
    }
    await enqueueEmail(tx, {
      eventId,
      kind: pass.status === 'active' ? 'pass' : 'pass_activation',
      refId: pass.id,
      toEmail: registration.guest.email,
    });
  }, TX_OPTIONS);
}

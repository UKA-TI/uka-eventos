import { Router } from 'express';
import {
  nameCorrectionSchema,
  orderCancelSchema,
  orderDelegateSchema,
  orderDueDateSchema,
  orderFinancialStatus,
  orderFiscalSchema,
  orderInputSchema,
  orderInvoiceSchema,
  passTransferSchema,
  paymentInputSchema,
  reconciledOrderSchema,
  refundInputSchema,
  suggestedRefundPercent,
  fiscalDataSchema,
  cancellationTierSchema,
} from '@uka/shared';
import { z } from 'zod';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { currentUser, requireCsrf, requirePermission } from '../auth/auth.js';
import { mailConfigured } from '../mail/queue.js';
import { groupUrl, passUrl } from '../passes/tokens.js';
import {
  correctGuestName,
  markInvoiced,
  recordRefund,
  remindOrder,
  saveFiscalData,
  setDueDate,
  transferPass,
  voidRefund,
} from './order-finance.js';
import {
  assignDelegate,
  cancelOrder,
  createOrder,
  createReconciledOrder,
  recordPayment,
  resendPass,
  resendPrivateLink,
  voidPayment,
} from './order-service.js';

const PAGE_SIZE = 50;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  status: z
    .enum(['pending_payment', 'partial', 'overdue', 'confirmed', 'cancelled'])
    .optional(),
  q: z.string().trim().max(120).optional(),
});

const orderInclude = {
  ticketType: { select: { name: true } },
  buyer: true,
  payments: {
    orderBy: { paidAt: 'desc' as const },
    include: { recordedBy: { select: { displayName: true } } },
  },
  refunds: {
    orderBy: { refundedAt: 'desc' as const },
    include: { recordedBy: { select: { displayName: true } } },
  },
  registrations: {
    orderBy: { folio: 'asc' as const },
    include: {
      guest: true,
      passes: { where: { status: 'active' }, select: { id: true } },
    },
  },
};

export const ordersRouter = Router({ mergeParams: true });

ordersRouter.get(
  '/',
  requirePermission(
    'registrations.view',
    'registrations.manage',
    'payments.manage',
  ),
  asyncHandler(async (request, response) => {
    const { eventId } = request.params as { eventId: string };
    const { page, status, q } = listQuerySchema.parse(request.query);
    const { permissions } = currentUser(request);
    // Ligas con token: solo para quien administra, porque dan acceso al QR.
    const showLinks = permissions.includes('registrations.manage');

    const canSeeFiscal = permissions.some((code) =>
      ['payments.manage', 'finance.view', 'finance.manage'].includes(code),
    );
    const now = new Date();
    const statusFilter =
      status === 'partial'
        ? {
            status: 'pending_payment',
            payments: { some: { voidedAt: null } },
          }
        : status === 'overdue'
          ? { status: 'pending_payment', dueAt: { lt: now } }
          : status
            ? { status }
            : {};

    const where = {
      eventId,
      ...statusFilter,
      ...(q
        ? {
            OR: [
              { reference: { contains: q } },
              { buyer: { firstName: { contains: q } } },
              { buyer: { lastName: { contains: q } } },
              { buyer: { email: { contains: q } } },
              { buyer: { organization: { contains: q } } },
              {
                registrations: {
                  some: {
                    OR: [
                      { folio: { contains: q } },
                      { guest: { firstName: { contains: q } } },
                      { guest: { lastName: { contains: q } } },
                      { guest: { email: { contains: q } } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [orders, total, active, payments, refunds, queue, stuck, registered] =
      await Promise.all([
        prisma.order.findMany({
          where,
          include: orderInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
        }),
        prisma.order.count({ where }),
        prisma.order.findMany({
          where: { eventId, status: { not: 'cancelled' } },
          select: {
            id: true,
            status: true,
            seats: true,
            amountDue: true,
            dueAt: true,
          },
        }),
        prisma.payment.findMany({
          where: { voidedAt: null, order: { eventId } },
          select: { orderId: true, amount: true },
        }),
        prisma.refund.findMany({
          where: { voidedAt: null, order: { eventId } },
          select: { amount: true },
        }),
        prisma.emailMessage.groupBy({
          by: ['status'],
          where: { eventId },
          _count: { _all: true },
        }),
        prisma.emailMessage.findFirst({
          where: { eventId, status: 'pending', lastError: { not: null } },
          orderBy: { nextAttemptAt: 'desc' },
          select: { lastError: true },
        }),
        prisma.registration.count({
          where: { eventId, status: 'confirmed' },
        }),
      ]);

    const passIds = orders.flatMap((order) =>
      order.registrations.flatMap((item) => item.passes.map((pass) => pass.id)),
    );
    const emails = await prisma.emailMessage.findMany({
      where: { kind: 'pass', refId: { in: passIds } },
      orderBy: { createdAt: 'asc' },
      select: { refId: true, status: true },
    });
    const emailStatus = new Map(
      emails.map((item) => [item.refId, item.status]),
    );

    const collected = payments.reduce(
      (sum, payment) => sum + payment.amount.toNumber(),
      0,
    );
    const refunded = refunds.reduce(
      (sum, refund) => sum + refund.amount.toNumber(),
      0,
    );
    const paidByOrder = new Map<string, number>();
    for (const payment of payments) {
      paidByOrder.set(
        payment.orderId,
        (paidByOrder.get(payment.orderId) ?? 0) + payment.amount.toNumber(),
      );
    }
    const balanceOf = (order: {
      id: string;
      amountDue: { toNumber(): number };
    }) =>
      Math.max(
        order.amountDue.toNumber() - (paidByOrder.get(order.id) ?? 0),
        0,
      );
    const unpaid = active.filter((order) => order.status === 'pending_payment');
    const queueCount = (name: string) =>
      queue.find((item) => item.status === name)?._count._all ?? 0;

    response.json({
      total,
      page,
      pageSize: PAGE_SIZE,
      summary: {
        seatsTaken: active.reduce((sum, order) => sum + order.seats, 0),
        seatsConfirmed: active
          .filter((order) => order.status === 'confirmed')
          .reduce((sum, order) => sum + order.seats, 0),
        seatsToRegister: Math.max(
          active
            .filter((order) => order.status === 'confirmed')
            .reduce((sum, order) => sum + order.seats, 0) - registered,
          0,
        ),
        pendingOrders: active.filter(
          (order) => order.status === 'pending_payment',
        ).length,
        amountCollected: collected - refunded,
        amountRefunded: refunded,
        amountPending: unpaid.reduce((sum, order) => sum + balanceOf(order), 0),
        amountOverdue: unpaid
          .filter((order) => order.dueAt && order.dueAt < now)
          .reduce((sum, order) => sum + balanceOf(order), 0),
        emailsQueued: queueCount('pending') + queueCount('sending'),
        emailsFailed: queueCount('failed'),
        mailProblem: stuck?.lastError ?? null,
        mailConfigured: mailConfigured(),
      },
      orders: orders.map((order) => {
        const amountPaid = order.payments
          .filter((payment) => !payment.voidedAt)
          .reduce((sum, payment) => sum + payment.amount.toNumber(), 0);
        const amountRefunded = order.refunds
          .filter((refund) => !refund.voidedAt)
          .reduce((sum, refund) => sum + refund.amount.toNumber(), 0);
        const fiscal = fiscalDataSchema.safeParse(order.fiscalData);
        return {
          id: order.id,
          reference: order.reference,
          status: order.status,
          source: order.source,
          seats: order.seats,
          quantity: order.quantity,
          delegateName: order.delegateName,
          delegateEmail: order.delegateEmail,
          notes: order.notes,
          registrationDeadline: order.registrationDeadline,
          amountDue: order.amountDue.toNumber(),
          amountPaid,
          amountRefunded,
          balance:
            order.status === 'pending_payment'
              ? Math.max(order.amountDue.toNumber() - amountPaid, 0)
              : 0,
          financialStatus: orderFinancialStatus({
            status: order.status,
            amountDue: order.amountDue.toNumber(),
            amountPaid,
            amountRefunded,
          }),
          dueAt: order.dueAt,
          lastReminderAt: order.lastReminderAt,
          fiscal: canSeeFiscal && fiscal.success ? fiscal.data : null,
          invoiceStatus: order.invoiceStatus,
          invoiceFolio: order.invoiceFolio,
          cancellationReason: order.cancellationReason,
          createdAt: order.createdAt,
          confirmedAt: order.confirmedAt,
          ticketName: order.ticketType.name,
          buyer: {
            firstName: order.buyer.firstName,
            lastName: order.buyer.lastName,
            email: order.buyer.email,
            phone: order.buyer.phone,
            organization: order.buyer.organization,
          },
          answers: Array.isArray(order.answers) ? order.answers : [],
          groupUrl:
            showLinks && order.groupTokenHash ? groupUrl(order.id) : null,
          registrations: order.registrations.map((registration) => {
            const pass = registration.passes[0];
            return {
              id: registration.id,
              folio: registration.folio,
              status: registration.status,
              guestName: `${registration.guest.firstName} ${registration.guest.lastName}`,
              guestEmail: registration.guest.email,
              passUrl: showLinks && pass ? passUrl(pass.id) : null,
              emailStatus: pass ? (emailStatus.get(pass.id) ?? null) : null,
            };
          }),
          payments: order.payments.map((payment) => ({
            id: payment.id,
            amount: payment.amount.toNumber(),
            method: payment.method,
            reference: payment.reference,
            notes: payment.notes,
            paidAt: payment.paidAt,
            recordedBy: payment.recordedBy?.displayName ?? null,
            voidedAt: payment.voidedAt,
          })),
          refunds: order.refunds.map((refund) => ({
            id: refund.id,
            amount: refund.amount.toNumber(),
            method: refund.method,
            reference: refund.reference,
            reason: refund.reason,
            refundedAt: refund.refundedAt,
            recordedBy: refund.recordedBy?.displayName ?? null,
            voidedAt: refund.voidedAt,
          })),
        };
      }),
    });
  }),
);

ordersRouter.post(
  '/',
  requirePermission('registrations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId } = request.params as { eventId: string };
    const input = orderInputSchema.parse(request.body);
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    const user = currentUser(request);
    const order = await createOrder({
      eventId,
      input,
      source: 'staff',
      createdById: user.id,
      privacyAccepted: false,
    });
    await recordAudit({
      userId: user.id,
      action: 'order.create',
      entityType: 'order',
      entityId: order.id,
      eventId,
      details: { reference: order.reference },
    });
    response.status(201).json({ id: order.id, reference: order.reference });
  }),
);

ordersRouter.post(
  '/reconciled',
  requirePermission('payments.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId } = request.params as { eventId: string };
    const input = reconciledOrderSchema.parse(request.body);
    const user = currentUser(request);
    const order = await createReconciledOrder({
      eventId,
      input,
      userId: user.id,
    });
    await recordAudit({
      userId: user.id,
      action: 'order.reconcile',
      entityType: 'order',
      entityId: order.id,
      eventId,
      details: {
        reference: order.reference,
        quantity: input.quantity,
        amount: input.amount,
      },
    });
    response.status(201).json({ id: order.id, reference: order.reference });
  }),
);

ordersRouter.put(
  '/:orderId/delegate',
  requirePermission('registrations.manage', 'payments.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const input = orderDelegateSchema.parse(request.body);
    await assignDelegate(eventId, orderId, input);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'order.delegate',
      entityType: 'order',
      entityId: orderId,
      eventId,
    });
    response.status(204).end();
  }),
);

ordersRouter.post(
  '/:orderId/resend-link',
  requirePermission('registrations.manage', 'payments.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    await resendPrivateLink(eventId, orderId);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'order.resend_link',
      entityType: 'order',
      entityId: orderId,
      eventId,
    });
    response.status(202).json({ queued: true });
  }),
);

ordersRouter.post(
  '/retry-emails',
  requirePermission('registrations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId } = request.params as { eventId: string };
    const { count } = await prisma.emailMessage.updateMany({
      where: { eventId, status: 'failed' },
      data: {
        status: 'pending',
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
      },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'email.retry',
      entityType: 'event',
      entityId: eventId,
      eventId,
      details: { count },
    });
    response.json({ count });
  }),
);

ordersRouter.post(
  '/:orderId/payments',
  requirePermission('payments.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const input = paymentInputSchema.parse(request.body);
    const user = currentUser(request);
    const { payment, completed } = await recordPayment({
      eventId,
      orderId,
      input,
      userId: user.id,
    });
    await recordAudit({
      userId: user.id,
      action: 'payment.record',
      entityType: 'payment',
      entityId: payment.id,
      eventId,
      details: {
        orderId,
        amount: input.amount,
        method: input.method,
        completed,
      },
    });
    response.status(201).json({ completed });
  }),
);

ordersRouter.post(
  '/:orderId/payments/:paymentId/void',
  requirePermission('payments.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId, paymentId } = request.params as {
      eventId: string;
      orderId: string;
      paymentId: string;
    };
    const user = currentUser(request);
    const payment = await voidPayment({
      eventId,
      orderId,
      paymentId,
      userId: user.id,
    });
    await recordAudit({
      userId: user.id,
      action: 'payment.void',
      entityType: 'payment',
      entityId: payment.id,
      eventId,
      details: { orderId, amount: payment.amount.toNumber() },
    });
    response.status(204).end();
  }),
);

ordersRouter.post(
  '/:orderId/cancel',
  requirePermission('registrations.manage', 'refunds.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const input = orderCancelSchema.parse(request.body ?? {});
    const user = currentUser(request);
    const order = await cancelOrder({
      eventId,
      orderId,
      userId: user.id,
      canHandleMoney: user.permissions.includes('refunds.manage'),
      reason: input.reason,
      refund: input.refund,
    });
    await recordAudit({
      userId: user.id,
      action: 'order.cancel',
      entityType: 'order',
      entityId: order.id,
      eventId,
      details: {
        reference: order.reference,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.refund ? { amount: input.refund.amount } : {}),
      },
    });
    response.status(204).end();
  }),
);

ordersRouter.post(
  '/registrations/:registrationId/resend',
  requirePermission('registrations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, registrationId } = request.params as {
      eventId: string;
      registrationId: string;
    };
    await resendPass(eventId, registrationId);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'pass.resend',
      entityType: 'registration',
      entityId: registrationId,
      eventId,
    });
    response.status(202).end();
  }),
);

/** La política que aplica hoy a este evento, para orientar a quien cancela. */
ordersRouter.get(
  '/policy',
  requirePermission('registrations.manage', 'refunds.manage'),
  asyncHandler(async (request, response) => {
    const { eventId } = request.params as { eventId: string };
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { startsAt: true, series: { select: { type: true } } },
    });
    const policy = event
      ? await prisma.cancellationPolicy.findUnique({
          where: { eventType: event.series.type.trim().toLowerCase() },
        })
      : null;
    if (!event || !policy) {
      response.json(null);
      return;
    }
    const tiers = z.array(cancellationTierSchema).parse(policy.tiers);
    const now = new Date();
    response.json({
      text: policy.text,
      tiers,
      suggestedPercent: suggestedRefundPercent(tiers, event.startsAt, now),
      daysLeft: event.startsAt
        ? Math.floor((event.startsAt.getTime() - now.getTime()) / 86_400_000)
        : null,
    });
  }),
);

const canCollect = requirePermission('payments.manage', 'finance.manage');

ordersRouter.put(
  '/:orderId/due-date',
  canCollect,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const { dueAt } = orderDueDateSchema.parse(request.body);
    const order = await setDueDate(eventId, orderId, new Date(dueAt));
    await recordAudit({
      userId: currentUser(request).id,
      action: 'order.due_date',
      entityType: 'order',
      entityId: orderId,
      eventId,
      details: { reference: order.reference },
    });
    response.status(204).end();
  }),
);

ordersRouter.post(
  '/:orderId/remind',
  canCollect,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const order = await remindOrder(eventId, orderId);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'order.remind',
      entityType: 'order',
      entityId: orderId,
      eventId,
      details: { reference: order.reference },
    });
    response.status(202).json({ queued: true });
  }),
);

ordersRouter.put(
  '/:orderId/fiscal',
  canCollect,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const { fiscal } = orderFiscalSchema.parse(request.body);
    const order = await saveFiscalData(eventId, orderId, fiscal);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'order.fiscal',
      entityType: 'order',
      entityId: orderId,
      eventId,
      details: { reference: order.reference },
    });
    response.status(204).end();
  }),
);

ordersRouter.post(
  '/:orderId/invoice',
  requirePermission('finance.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const { invoiceFolio } = orderInvoiceSchema.parse(request.body);
    const order = await markInvoiced(eventId, orderId, invoiceFolio);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'order.invoice',
      entityType: 'order',
      entityId: orderId,
      eventId,
      details: { reference: order.reference, folio: invoiceFolio },
    });
    response.status(204).end();
  }),
);

ordersRouter.post(
  '/:orderId/refunds',
  requirePermission('refunds.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const input = refundInputSchema.parse(request.body);
    const user = currentUser(request);
    const refund = await recordRefund({
      eventId,
      orderId,
      input,
      userId: user.id,
    });
    await recordAudit({
      userId: user.id,
      action: 'refund.record',
      entityType: 'refund',
      entityId: refund.id,
      eventId,
      details: { amount: input.amount, reason: input.reason },
    });
    response.status(201).json({ id: refund.id });
  }),
);

ordersRouter.post(
  '/:orderId/refunds/:refundId/void',
  requirePermission('refunds.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId, refundId } = request.params as {
      eventId: string;
      orderId: string;
      refundId: string;
    };
    const user = currentUser(request);
    const refund = await voidRefund({
      eventId,
      orderId,
      refundId,
      userId: user.id,
    });
    await recordAudit({
      userId: user.id,
      action: 'refund.void',
      entityType: 'refund',
      entityId: refund.id,
      eventId,
      details: { amount: refund.amount.toNumber() },
    });
    response.status(204).end();
  }),
);

ordersRouter.post(
  '/registrations/:registrationId/correct-name',
  requirePermission('registrations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, registrationId } = request.params as {
      eventId: string;
      registrationId: string;
    };
    const input = nameCorrectionSchema.parse(request.body);
    const change = await correctGuestName(eventId, registrationId, input);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'registration.correct',
      entityType: 'registration',
      entityId: registrationId,
      eventId,
      details: {
        folio: change.folio,
        name: `${change.previous} → ${input.firstName} ${input.lastName}`,
        reason: input.reason,
      },
    });
    response.status(204).end();
  }),
);

ordersRouter.post(
  '/registrations/:registrationId/transfer',
  requirePermission('registrations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, registrationId } = request.params as {
      eventId: string;
      registrationId: string;
    };
    const input = passTransferSchema.parse(request.body);
    const change = await transferPass(eventId, registrationId, input);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'registration.transfer',
      entityType: 'registration',
      entityId: registrationId,
      eventId,
      details: {
        folio: change.folio,
        name: `${change.previous} → ${input.firstName} ${input.lastName}`,
        reason: input.reason,
      },
    });
    response.status(202).json({ queued: true });
  }),
);

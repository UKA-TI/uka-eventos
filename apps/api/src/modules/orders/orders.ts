import { Router } from 'express';
import {
  orderInputSchema,
  paymentInputSchema,
  reconciledOrderSchema,
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
  status: z.enum(['pending_payment', 'confirmed', 'cancelled']).optional(),
  q: z.string().trim().max(120).optional(),
});

const orderInclude = {
  ticketType: { select: { name: true } },
  buyer: true,
  payments: {
    orderBy: { paidAt: 'desc' as const },
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

    const where = {
      eventId,
      ...(status ? { status } : {}),
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

    const [orders, total, active, payments, queue, stuck, registered] =
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
          select: { id: true, status: true, seats: true, amountDue: true },
        }),
        prisma.payment.findMany({
          where: {
            voidedAt: null,
            order: { eventId, status: { not: 'cancelled' } },
          },
          select: { orderId: true, amount: true },
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
    const due = active.reduce(
      (sum, order) => sum + order.amountDue.toNumber(),
      0,
    );
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
        amountCollected: collected,
        amountPending: Math.max(due - collected, 0),
        emailsQueued: queueCount('pending') + queueCount('sending'),
        emailsFailed: queueCount('failed'),
        mailProblem: stuck?.lastError ?? null,
        mailConfigured: mailConfigured(),
      },
      orders: orders.map((order) => ({
        id: order.id,
        reference: order.reference,
        status: order.status,
        source: order.source,
        seats: order.seats,
        quantity: order.quantity,
        amountDue: order.amountDue.toNumber(),
        amountPaid: order.payments
          .filter((payment) => !payment.voidedAt)
          .reduce((sum, payment) => sum + payment.amount.toNumber(), 0),
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
        groupUrl: showLinks && order.groupTokenHash ? groupUrl(order.id) : null,
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
      })),
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
  requirePermission('registrations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventId, orderId } = request.params as {
      eventId: string;
      orderId: string;
    };
    const order = await cancelOrder(eventId, orderId);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'order.cancel',
      entityType: 'order',
      entityId: order.id,
      eventId,
      details: { reference: order.reference },
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

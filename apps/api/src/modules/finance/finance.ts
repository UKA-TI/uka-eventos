import { Router, type Request } from 'express';
import {
  agingBucket,
  agingBuckets,
  budgetItemInputSchema,
  cancellationPolicyInputSchema,
  cancellationTierSchema,
  daysOverdue,
  eventFinanceSettingsSchema,
  fiscalDataSchema,
  orderFinancialStatus,
} from '@uka/shared';
import { z } from 'zod';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import {
  currentUser,
  requireAuth,
  requireCsrf,
  requirePermission,
} from '../auth/auth.js';
import { dateStamp, formatDate, sendCsv, toCsv } from '../reports/csv.js';
import { closingCheck, eventFinanceTotals } from './finance-service.js';

const canView = requirePermission('finance.view', 'finance.manage');
const canManage = requirePermission('finance.manage');

const eventIdOf = (request: Request) =>
  (request.params as { eventId: string }).eventId;

async function assertOpen(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { status: true },
  });
  if (!event) {
    throw new AppError(404, 'El evento no existe.');
  }
  if (event.status === 'closed') {
    throw new AppError(
      409,
      'El evento está cerrado. Reábrelo para cambiar sus finanzas.',
    );
  }
}

export const eventFinanceRouter = Router({ mergeParams: true });

eventFinanceRouter.get(
  '/',
  canView,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        currency: true,
        paymentTermDays: true,
        corporateTermDays: true,
        paymentCutoffDays: true,
        paymentReminders: true,
        closedAt: true,
        closingSummary: true,
        closedBy: { select: { displayName: true } },
      },
    });
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    const [totals, payments, budget] = await Promise.all([
      eventFinanceTotals(eventId),
      prisma.payment.groupBy({
        by: ['method'],
        where: { voidedAt: null, order: { eventId } },
        _sum: { amount: true },
      }),
      prisma.budgetItem.findMany({
        where: { eventId },
        orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    const summary = event.closingSummary as {
      totals?: unknown;
      note?: string | null;
    } | null;
    response.json({
      currency: event.currency,
      paymentTermDays: event.paymentTermDays,
      corporateTermDays: event.corporateTermDays,
      paymentCutoffDays: event.paymentCutoffDays,
      paymentReminders: event.paymentReminders,
      totals,
      byMethod: payments.map((row) => ({
        method: row.method,
        amount: row._sum.amount?.toNumber() ?? 0,
      })),
      budget: budget.map((item) => ({
        id: item.id,
        category: item.category,
        concept: item.concept,
        budgeted: item.budgeted.toNumber(),
        actual: item.actual?.toNumber() ?? null,
        notes: item.notes,
      })),
      closing:
        event.closedAt && summary?.totals
          ? {
              closedAt: event.closedAt,
              closedBy: event.closedBy?.displayName ?? null,
              note: summary.note ?? null,
              totals: summary.totals,
            }
          : null,
    });
  }),
);

/** Lo puede ver quien va a cerrar el evento, aunque no administre las finanzas. */
eventFinanceRouter.get(
  '/closing-check',
  requirePermission('events.edit', 'finance.view', 'finance.manage'),
  asyncHandler(async (request, response) => {
    response.json(await closingCheck(eventIdOf(request)));
  }),
);

eventFinanceRouter.put(
  '/settings',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const input = eventFinanceSettingsSchema.parse(request.body);
    await assertOpen(eventId);
    await prisma.event.update({ where: { id: eventId }, data: input });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'finance.settings',
      entityType: 'event',
      entityId: eventId,
      eventId,
      details: { amount: input.fundraisingGoal ?? undefined },
    });
    response.status(204).end();
  }),
);

eventFinanceRouter.post(
  '/budget',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const input = budgetItemInputSchema.parse(request.body);
    await assertOpen(eventId);
    const item = await prisma.budgetItem.create({
      data: { ...input, eventId },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'budget.create',
      entityType: 'budget_item',
      entityId: item.id,
      eventId,
      details: { name: input.concept, amount: input.budgeted },
    });
    response.status(201).json({ id: item.id });
  }),
);

eventFinanceRouter.put(
  '/budget/:itemId',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { itemId } = request.params as { itemId: string };
    const input = budgetItemInputSchema.parse(request.body);
    await assertOpen(eventId);
    const result = await prisma.budgetItem.updateMany({
      where: { id: itemId, eventId },
      data: input,
    });
    if (result.count === 0) {
      throw new AppError(404, 'Este concepto no existe.');
    }
    await recordAudit({
      userId: currentUser(request).id,
      action: 'budget.update',
      entityType: 'budget_item',
      entityId: itemId,
      eventId,
      details: { name: input.concept, amount: input.actual ?? input.budgeted },
    });
    response.status(204).end();
  }),
);

eventFinanceRouter.delete(
  '/budget/:itemId',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { itemId } = request.params as { itemId: string };
    await assertOpen(eventId);
    const item = await prisma.budgetItem.findFirst({
      where: { id: itemId, eventId },
    });
    if (!item) {
      throw new AppError(404, 'Este concepto no existe.');
    }
    await prisma.budgetItem.delete({ where: { id: item.id } });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'budget.delete',
      entityType: 'budget_item',
      entityId: item.id,
      eventId,
      details: { name: item.concept },
    });
    response.status(204).end();
  }),
);

export const financeRouter = Router();

financeRouter.use(requireAuth);

const receivableQuerySchema = z.object({
  eventId: z.string().max(30).optional(),
  bucket: z.enum(agingBuckets.map(({ key }) => key)).optional(),
  q: z.string().trim().max(120).optional(),
});

async function receivables(query: z.infer<typeof receivableQuerySchema>) {
  const now = new Date();
  const orders = await prisma.order.findMany({
    where: {
      status: 'pending_payment',
      event: { status: { not: 'draft' } },
      ...(query.eventId ? { eventId: query.eventId } : {}),
    },
    include: {
      buyer: true,
      ticketType: { select: { name: true } },
      payments: { where: { voidedAt: null }, select: { amount: true } },
      event: {
        select: {
          id: true,
          name: true,
          timeZone: true,
          currency: true,
          paymentReminders: true,
        },
      },
    },
  });
  const term = query.q?.toLowerCase();
  const rows = orders
    .map((order) => {
      const amountDue = order.amountDue.toNumber();
      const amountPaid = order.payments.reduce(
        (sum, payment) => sum + payment.amount.toNumber(),
        0,
      );
      return {
        orderId: order.id,
        eventId: order.event.id,
        eventName: order.event.name,
        timeZone: order.event.timeZone,
        currency: order.event.currency,
        reference: order.reference,
        buyerName: `${order.buyer.firstName} ${order.buyer.lastName}`,
        buyerEmail: order.buyer.email,
        organization: order.buyer.organization,
        ticketName: order.ticketType.name,
        amountDue,
        amountPaid,
        balance: Math.max(amountDue - amountPaid, 0),
        dueAt: order.dueAt,
        daysOverdue: order.dueAt
          ? Math.max(daysOverdue(order.dueAt, now), 0)
          : null,
        bucket: agingBucket(order.dueAt, now),
        lastReminderAt: order.lastReminderAt,
        remindersOn: order.event.paymentReminders,
      };
    })
    .filter(
      (row) =>
        !term ||
        [row.reference, row.buyerName, row.buyerEmail, row.organization].some(
          (value) => value?.toLowerCase().includes(term),
        ),
    );
  const buckets = agingBuckets.map(({ key }) => {
    const inBucket = rows.filter((row) => row.bucket === key);
    return {
      key,
      count: inBucket.length,
      amount: inBucket.reduce((sum, row) => sum + row.balance, 0),
    };
  });
  const listed = (
    query.bucket ? rows.filter((row) => row.bucket === query.bucket) : rows
  ).sort(
    (a, b) =>
      (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
  );
  return {
    total: rows.reduce((sum, row) => sum + row.balance, 0),
    buckets,
    rows: listed,
  };
}

financeRouter.get(
  '/receivables',
  canView,
  asyncHandler(async (request, response) => {
    const query = receivableQuerySchema.parse(request.query);
    const [data, events] = await Promise.all([
      receivables(query),
      prisma.event.findMany({
        where: { status: { not: 'draft' }, orders: { some: {} } },
        orderBy: { startsAt: 'desc' },
        select: { id: true, name: true },
      }),
    ]);
    response.json({ ...data, events });
  }),
);

financeRouter.get(
  '/receivables.csv',
  canView,
  requirePermission('reports.export'),
  asyncHandler(async (request, response) => {
    const { rows } = await receivables(
      receivableQuerySchema.parse(request.query),
    );
    await recordAudit({
      userId: currentUser(request).id,
      action: 'report.export_receivables',
      entityType: 'report',
      details: { rows: rows.length },
    });
    const labels = new Map<string, string>(
      agingBuckets.map(({ key, label }) => [key, label]),
    );
    sendCsv(
      response,
      `cuentas-por-cobrar-${dateStamp()}.csv`,
      toCsv(
        [
          'Evento',
          'Referencia',
          'Comprador',
          'Correo',
          'Empresa',
          'Boleto',
          'Total',
          'Pagado',
          'Saldo',
          'Vence',
          'Días vencido',
          'Antigüedad',
        ],
        rows.map((row) => [
          row.eventName,
          row.reference,
          row.buyerName,
          row.buyerEmail,
          row.organization,
          row.ticketName,
          row.amountDue,
          row.amountPaid,
          row.balance,
          formatDate(row.dueAt),
          row.daysOverdue,
          labels.get(row.bucket),
        ]),
      ),
    );
  }),
);

/** Lo que falta facturar: solo compras con dinero recibido, y las ya emitidas para consulta. */
financeRouter.get(
  '/invoices',
  canView,
  asyncHandler(async (_request, response) => {
    const orders = await prisma.order.findMany({
      where: {
        invoiceStatus: { in: ['requested', 'issued'] },
        payments: { some: { voidedAt: null } },
      },
      orderBy: [{ invoiceStatus: 'desc' }, { createdAt: 'asc' }],
      take: 500,
      include: {
        buyer: { select: { firstName: true, lastName: true } },
        event: { select: { id: true, name: true } },
        payments: { where: { voidedAt: null }, select: { amount: true } },
        refunds: { where: { voidedAt: null }, select: { amount: true } },
      },
    });
    response.json(
      orders.flatMap((order) => {
        const fiscal = fiscalDataSchema.safeParse(order.fiscalData);
        if (!fiscal.success) {
          return [];
        }
        const amountPaid = order.payments.reduce(
          (sum, row) => sum + row.amount.toNumber(),
          0,
        );
        const amountRefunded = order.refunds.reduce(
          (sum, row) => sum + row.amount.toNumber(),
          0,
        );
        return [
          {
            orderId: order.id,
            eventId: order.event.id,
            eventName: order.event.name,
            reference: order.reference,
            buyerName: `${order.buyer.firstName} ${order.buyer.lastName}`,
            financialStatus: orderFinancialStatus({
              status: order.status,
              amountDue: order.amountDue.toNumber(),
              amountPaid,
              amountRefunded,
            }),
            amountPaid,
            amountRefunded,
            fiscal: fiscal.data,
            invoiceStatus: order.invoiceStatus,
            invoiceFolio: order.invoiceFolio,
          },
        ];
      }),
    );
  }),
);

financeRouter.get(
  '/policies',
  canView,
  asyncHandler(async (_request, response) => {
    const [policies, series] = await Promise.all([
      prisma.cancellationPolicy.findMany({
        orderBy: { eventType: 'asc' },
        include: { updatedBy: { select: { displayName: true } } },
      }),
      prisma.eventSeries.findMany({ select: { type: true } }),
    ]);
    response.json({
      policies: policies.map((policy) => ({
        eventType: policy.eventType,
        text: policy.text,
        tiers: z.array(cancellationTierSchema).parse(policy.tiers),
        updatedAt: policy.updatedAt,
        updatedBy: policy.updatedBy?.displayName ?? null,
      })),
      eventTypes: [
        ...new Set(series.map(({ type }) => type.trim().toLowerCase())),
      ].sort(),
    });
  }),
);

financeRouter.put(
  '/policies',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = cancellationPolicyInputSchema.parse(request.body);
    const eventType = input.eventType.toLowerCase();
    const user = currentUser(request);
    const data = {
      text: input.text,
      tiers: input.tiers,
      updatedById: user.id,
    };
    await prisma.cancellationPolicy.upsert({
      where: { eventType },
      update: data,
      create: { eventType, ...data },
    });
    await recordAudit({
      userId: user.id,
      action: 'policy.save',
      entityType: 'cancellation_policy',
      details: { name: eventType },
    });
    response.status(204).end();
  }),
);

financeRouter.delete(
  '/policies/:eventType',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { eventType } = request.params as { eventType: string };
    const { count } = await prisma.cancellationPolicy.deleteMany({
      where: { eventType },
    });
    if (count === 0) {
      throw new AppError(404, 'Esta política no existe.');
    }
    await recordAudit({
      userId: currentUser(request).id,
      action: 'policy.delete',
      entityType: 'cancellation_policy',
      details: { name: eventType },
    });
    response.status(204).end();
  }),
);

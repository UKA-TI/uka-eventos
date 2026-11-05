import type { FinanceTotals } from '@uka/shared';
import { prisma } from '../../database.js';

const round = (value: number) => Math.round(value * 100) / 100;

const sum = <T>(rows: T[], amount: (row: T) => number) =>
  round(rows.reduce((total, row) => total + amount(row), 0));

/**
 * Los números de un evento. Una sola fuente para el tablero, el comparativo de cierre y
 * el reporte: el ingreso es lo cobrado menos lo devuelto, también en compras canceladas,
 * porque cancelar no regresa el dinero por sí solo.
 */
export async function eventFinanceTotals(
  eventId: string,
  now = new Date(),
): Promise<FinanceTotals> {
  const [event, payments, refunds, pending, cancelled, donations, budget] =
    await Promise.all([
      prisma.event.findUniqueOrThrow({
        where: { id: eventId },
        select: { fundraisingGoal: true },
      }),
      prisma.payment.findMany({
        where: { voidedAt: null, order: { eventId } },
        select: { amount: true },
      }),
      prisma.refund.findMany({
        where: { voidedAt: null, order: { eventId } },
        select: { amount: true },
      }),
      prisma.order.findMany({
        where: { eventId, status: 'pending_payment' },
        select: {
          amountDue: true,
          dueAt: true,
          payments: { where: { voidedAt: null }, select: { amount: true } },
        },
      }),
      prisma.order.findMany({
        where: { eventId, status: 'cancelled' },
        select: {
          payments: { where: { voidedAt: null }, select: { amount: true } },
          refunds: { where: { voidedAt: null }, select: { amount: true } },
        },
      }),
      prisma.donation.aggregate({
        where: { eventId, voidedAt: null },
        _sum: { amount: true },
      }),
      prisma.budgetItem.findMany({
        where: { eventId },
        select: { budgeted: true, actual: true },
      }),
    ]);

  const grossCollected = sum(payments, (row) => row.amount.toNumber());
  const refunded = sum(refunds, (row) => row.amount.toNumber());
  const netCollected = round(grossCollected - refunded);
  const donationTotal = round(donations._sum.amount?.toNumber() ?? 0);
  const totalIncome = round(netCollected + donationTotal);
  const balanceOf = (order: (typeof pending)[number]) =>
    Math.max(
      order.amountDue.toNumber() -
        order.payments.reduce((total, row) => total + row.amount.toNumber(), 0),
      0,
    );
  const receivable = sum(pending, balanceOf);
  const overdue = sum(
    pending.filter((order) => order.dueAt && order.dueAt < now),
    balanceOf,
  );
  const retainedFromCancelled = sum(
    cancelled,
    (order) =>
      order.payments.reduce((total, row) => total + row.amount.toNumber(), 0) -
      order.refunds.reduce((total, row) => total + row.amount.toNumber(), 0),
  );
  const budgeted = sum(budget, (row) => row.budgeted.toNumber());
  const actualCosts = sum(budget, (row) => row.actual?.toNumber() ?? 0);
  const goal = event.fundraisingGoal?.toNumber() ?? null;
  // Mientras un concepto no tenga costo real, la proyección usa lo presupuestado.
  const projectedCosts = sum(
    budget,
    (row) => row.actual?.toNumber() ?? row.budgeted.toNumber(),
  );

  return {
    grossCollected,
    refunded,
    netCollected,
    retainedFromCancelled,
    donations: donationTotal,
    totalIncome,
    receivable,
    overdue,
    goal,
    goalProgress: goal ? totalIncome / goal : null,
    budgeted,
    actualCosts,
    costsMissing: budget.filter((row) => row.actual === null).length,
    result: round(totalIncome - actualCosts),
    projectedResult: round(totalIncome + receivable - projectedCosts),
  };
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const money = (value: number) =>
  value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Lo que un administrador revisaría antes de dar por cerrado un evento. */
export async function closingCheck(eventId: string) {
  const [pending, totals, invoices, incidents, costs, cancelledKept] =
    await Promise.all([
      prisma.order.count({ where: { eventId, status: 'pending_payment' } }),
      eventFinanceTotals(eventId),
      prisma.order.count({
        where: {
          eventId,
          invoiceStatus: 'requested',
          status: { not: 'pending_payment' },
          payments: { some: { voidedAt: null } },
        },
      }),
      prisma.incident.count({ where: { eventId, status: 'open' } }),
      prisma.budgetItem.count({ where: { eventId, actual: null } }),
      prisma.order.findMany({
        where: { eventId, status: 'cancelled' },
        select: {
          payments: { where: { voidedAt: null }, select: { amount: true } },
          refunds: { where: { voidedAt: null }, select: { amount: true } },
        },
      }),
    ]);
  const retained = cancelledKept.filter(
    (order) =>
      order.payments.reduce((total, row) => total + row.amount.toNumber(), 0) -
        order.refunds.reduce((total, row) => total + row.amount.toNumber(), 0) >
      0.005,
  ).length;

  const issues: { key: string; text: string }[] = [];
  if (pending > 0) {
    issues.push({
      key: 'receivable',
      text: `${plural(pending, 'compra sigue', 'compras siguen')} con saldo por ${money(totals.receivable)}.`,
    });
  }
  if (retained > 0) {
    issues.push({
      key: 'retained',
      text: `${plural(retained, 'compra cancelada retiene', 'compras canceladas retienen')} ${money(totals.retainedFromCancelled)}: confirma que no se deben devolver.`,
    });
  }
  if (invoices > 0) {
    issues.push({
      key: 'invoices',
      text: `${plural(invoices, 'factura solicitada falta', 'facturas solicitadas faltan')} de emitir.`,
    });
  }
  if (costs > 0) {
    issues.push({
      key: 'costs',
      text: `${plural(costs, 'concepto del presupuesto no tiene', 'conceptos del presupuesto no tienen')} costo real.`,
    });
  }
  if (incidents > 0) {
    issues.push({
      key: 'incidents',
      text: `${plural(incidents, 'incidencia sigue abierta', 'incidencias siguen abiertas')}.`,
    });
  }
  return { issues };
}

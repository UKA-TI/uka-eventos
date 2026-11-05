import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';
import { queuePaymentReminders } from '../src/modules/mail/reminders.js';
import { eventMetrics } from '../src/modules/reports/metrics.js';

/** Flujo real contra MariaDB (no corre en CI): npm run test:db-integration */
const run = randomBytes(4).toString('hex');
const domain = `${run}.uka.test`;
const origin = 'http://localhost:5173';
const day = 86_400_000;

const app = createApp(undefined, {
  microsoftVerifier: (token) =>
    Promise.resolve(JSON.parse(token) as MicrosoftIdentity),
});

async function login(name: string) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/microsoft')
    .set('Origin', origin)
    .send({
      idToken: JSON.stringify({
        tenantId: `tenant-${run}`,
        objectId: `oid-${run}-${name}`,
        email: `${name}@${domain}`,
        displayName: name,
      }),
    });
  expect(response.status).toBe(200);
  const csrf = response.body.csrfToken as string;
  const write = (method: 'post' | 'put' | 'delete', path: string) =>
    agent[method](path).set('Origin', origin).set('X-CSRF-Token', csrf);
  return { agent, write };
}

const fiscal = {
  rfc: 'UKD900101AB1',
  legalName: 'Empresa de Prueba SA de CV',
  regime: '601',
  postalCode: '06600',
  cfdiUse: 'G03',
  email: `facturas@${domain}`,
};

describe.skipIf(!process.env.RUN_DB_TESTS)('finance', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let cashier: Awaited<ReturnType<typeof login>>;
  let viewer: Awaited<ReturnType<typeof login>>;
  let eventId = '';
  let seriesId = '';
  let ticketId = '';
  let base = '';
  let slug = '';
  let counter = 0;
  const eventType = `tipo-${run}`;

  const buy = async (name = `compra${(counter += 1)}`, extra: object = {}) => {
    const response = await request(app)
      .post(`/api/public/events/${slug}/register`)
      .set('Origin', origin)
      .send({
        firstName: name,
        lastName: 'Prueba',
        email: `${name}@${domain}`,
        phone: '5512345678',
        organization: null,
        ticketTypeId: ticketId,
        answers: {},
        privacyAccepted: true,
        ...extra,
      });
    expect(response.status).toBe(201);
    return prisma.order.findFirstOrThrow({
      where: { eventId, reference: response.body.reference },
    });
  };

  const pay = (orderId: string, amount: number, by = admin) =>
    by.write('post', `${base}/orders/${orderId}/payments`).send({
      amount,
      method: 'transfer',
      reference: null,
      notes: null,
      paidAt: new Date().toISOString(),
    });

  const refundBody = (amount: number, reason = 'Pidió devolución') => ({
    amount,
    method: 'transfer',
    reference: null,
    reason,
    refundedAt: new Date().toISOString(),
  });

  const orderView = async (reference: string) => {
    const response = await admin.agent.get(
      `${base}/orders?q=${encodeURIComponent(reference)}`,
    );
    return response.body.orders.find(
      (order: { reference: string }) => order.reference === reference,
    );
  };

  const totals = async () =>
    (await admin.agent.get(`${base}/finance`)).body.totals;

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const roles = await prisma.role.findMany({
      where: { code: { in: ['ADMIN', 'QUERY'] } },
    });
    const roleId = (code: string) =>
      roles.find((role) => role.code === code)!.id;
    const cashierRole = await prisma.role.create({
      data: {
        code: `CAJA_${run}`,
        name: `Caja ${run}`,
        permissions: {
          create: [
            { permission: 'events.view' },
            { permission: 'registrations.manage' },
            { permission: 'payments.manage' },
          ],
        },
      },
    });
    await prisma.user.createMany({
      data: [
        {
          email: `admin@${domain}`,
          displayName: 'admin',
          roleId: roleId('ADMIN'),
        },
        {
          email: `caja@${domain}`,
          displayName: 'caja',
          roleId: cashierRole.id,
        },
        {
          email: `viewer@${domain}`,
          displayName: 'viewer',
          roleId: roleId('QUERY'),
        },
      ],
    });
    admin = await login('admin');
    cashier = await login('caja');
    viewer = await login('viewer');

    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: eventType },
    });
    seriesId = series.id;
    slug = `fin-${run}`;
    const event = await prisma.event.create({
      data: {
        seriesId,
        editionYear: 2030,
        status: 'active',
        slug,
        name: `Finanzas ${run}`,
        folioPrefix: 'FIN',
        paymentInstructions: 'Transferencia a la cuenta de prueba.',
        modules: ['publicRegistration', 'checkin'],
        startsAt: new Date(Date.now() + 40 * day),
        paymentTermDays: 7,
        ticketTypes: { create: [{ name: 'General', price: 1000 }] },
      },
      include: { ticketTypes: true },
    });
    eventId = event.id;
    ticketId = event.ticketTypes[0]!.id;
    base = `/api/events/${eventId}`;
  });

  afterAll(async () => {
    const inEvent = { eventId };
    const orderIds = (
      await prisma.order.findMany({ where: inEvent, select: { id: true } })
    ).map((order) => order.id);
    const regs = await prisma.registration.findMany({
      where: inEvent,
      select: { id: true },
    });
    const registrationId = { in: regs.map((reg) => reg.id) };
    await prisma.emailMessage.deleteMany({ where: inEvent });
    await prisma.auditLog.deleteMany({ where: inEvent });
    await prisma.consent.deleteMany({ where: { registrationId } });
    await prisma.checkin.deleteMany({ where: inEvent });
    await prisma.pass.deleteMany({ where: { registrationId } });
    await prisma.registration.deleteMany({ where: inEvent });
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: inEvent });
    await prisma.guest.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.contact.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.cancellationPolicy.deleteMany({ where: { eventType } });
    await prisma.eventCounter.deleteMany({ where: inEvent });
    await prisma.accessPoint.deleteMany({ where: inEvent });
    await prisma.ticketType.deleteMany({ where: inEvent });
    await prisma.donation.deleteMany({ where: inEvent });
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `@${domain}` } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.role.deleteMany({ where: { code: `CAJA_${run}` } });
    await prisma.$disconnect();
  });

  it('keeps finance behind its own permissions', async () => {
    for (const path of [
      '/api/finance/receivables',
      '/api/finance/invoices',
      '/api/finance/policies',
      `${base}/finance`,
    ]) {
      expect((await viewer.agent.get(path)).status).toBe(403);
      expect((await cashier.agent.get(path)).status).toBe(403);
      expect((await admin.agent.get(path)).status).toBe(200);
    }
    expect((await request(app).get('/api/finance/receivables')).status).toBe(
      401,
    );
    expect(
      (
        await cashier.write('put', `${base}/finance/settings`).send({
          fundraisingGoal: 1,
          paymentTermDays: 1,
          corporateTermDays: 1,
          paymentCutoffDays: 1,
          paymentReminders: true,
        })
      ).status,
    ).toBe(403);
  });

  it('gives a new order its due date, without going past the event', async () => {
    const order = await buy();
    const expected = Date.now() + 7 * day;
    expect(Math.abs(order.dueAt!.getTime() - expected)).toBeLessThan(60_000);

    await prisma.event.update({
      where: { id: eventId },
      data: { paymentTermDays: 90 },
    });
    const late = await buy();
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(late.dueAt!.getTime()).toBe(
      event.startsAt!.getTime() - event.paymentCutoffDays * day,
    );
    await prisma.event.update({
      where: { id: eventId },
      data: { paymentTermDays: 7 },
    });
  });

  it('shows a partial payment and keeps the pass until it is paid in full', async () => {
    const order = await buy();
    await pay(order.id, 400).expect(201);
    const partial = await orderView(order.reference);
    expect(partial).toMatchObject({
      financialStatus: 'partial',
      amountPaid: 400,
      balance: 600,
      status: 'pending_payment',
    });
    expect(partial.registrations[0].passUrl).toBeNull();

    const filtered = await admin.agent.get(`${base}/orders?status=partial`);
    expect(filtered.body.orders.map((row: { id: string }) => row.id)).toContain(
      order.id,
    );

    await pay(order.id, 600).expect(201);
    const paid = await orderView(order.reference);
    expect(paid).toMatchObject({ financialStatus: 'paid', balance: 0 });
    expect(paid.registrations[0].passUrl).toBeTruthy();
  });

  it('lists what is owed by age, for the whole team to chase', async () => {
    const overdue = await buy();
    await prisma.order.update({
      where: { id: overdue.id },
      data: { dueAt: new Date(Date.now() - 10 * day + 60_000) },
    });
    const response = await admin.agent.get(
      `/api/finance/receivables?eventId=${eventId}`,
    );
    expect(response.status).toBe(200);
    const row = response.body.rows.find(
      (item: { orderId: string }) => item.orderId === overdue.id,
    );
    expect(row).toMatchObject({ bucket: 'd8_30', balance: 1000 });
    expect(row.daysOverdue).toBe(10);
    expect(response.body.rows[0].orderId).toBe(overdue.id);
    const bucket = response.body.buckets.find(
      (item: { key: string }) => item.key === 'd8_30',
    );
    expect(bucket.amount).toBeGreaterThanOrEqual(1000);

    const only = await admin.agent.get(
      `/api/finance/receivables?eventId=${eventId}&bucket=current`,
    );
    expect(
      only.body.rows.every(
        (item: { bucket: string }) => item.bucket === 'current',
      ),
    ).toBe(true);

    const csv = await admin.agent.get(
      `/api/finance/receivables.csv?eventId=${eventId}`,
    );
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(overdue.reference);
  });

  it('reminds on schedule, once per stage, and stops when paid', async () => {
    const order = await buy();
    const reminders = () =>
      prisma.emailMessage.count({
        where: { kind: 'payment_reminder', refId: order.id },
      });

    const now = new Date();
    await prisma.order.update({
      where: { id: order.id },
      data: { dueAt: new Date(now.getTime() + 2 * day) },
    });
    await queuePaymentReminders(now);
    expect(await reminders()).toBe(1);
    await queuePaymentReminders(now);
    expect(await reminders()).toBe(1);

    // Vence hoy, pero alguien acaba de enviar uno: espera a que pase un día.
    await prisma.order.update({
      where: { id: order.id },
      data: { dueAt: now },
    });
    await queuePaymentReminders(new Date(now.getTime() + 60_000));
    expect(await reminders()).toBe(1);
    await queuePaymentReminders(new Date(now.getTime() + 25 * 3_600_000));
    expect(await reminders()).toBe(2);

    await pay(order.id, 1000).expect(201);
    await queuePaymentReminders(new Date(now.getTime() + 10 * day));
    expect(await reminders()).toBe(2);
  });

  it('does not remind if the event turned them off', async () => {
    const order = await buy();
    await prisma.order.update({
      where: { id: order.id },
      data: { dueAt: new Date() },
    });
    await prisma.event.update({
      where: { id: eventId },
      data: { paymentReminders: false },
    });
    await queuePaymentReminders();
    expect(
      await prisma.emailMessage.count({
        where: { kind: 'payment_reminder', refId: order.id },
      }),
    ).toBe(0);
    await prisma.event.update({
      where: { id: eventId },
      data: { paymentReminders: true },
    });
  });

  it('restarts reminders when the due date changes, and sends one by hand', async () => {
    const order = await buy();
    await prisma.order.update({
      where: { id: order.id },
      data: { reminderStage: 3 },
    });
    await cashier
      .write('put', `${base}/orders/${order.id}/due-date`)
      .send({ dueAt: new Date(Date.now() + 20 * day).toISOString() })
      .expect(204);
    const moved = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(moved.reminderStage).toBe(0);

    await cashier
      .write('post', `${base}/orders/${order.id}/remind`)
      .expect(202);
    expect(
      await prisma.emailMessage.count({
        where: { kind: 'payment_reminder', refId: order.id },
      }),
    ).toBe(1);
  });

  it('keeps fiscal data with the order, and tracks the invoice', async () => {
    const order = await buy(`fiscal${run}`, { fiscal });
    expect(order.invoiceStatus).toBe('requested');
    const hidden = await viewer.agent.get(
      `${base}/orders?q=${order.reference}`,
    );
    expect(hidden.status).toBe(403);

    let queue = await admin.agent.get('/api/finance/invoices');
    expect(
      queue.body.some((row: { orderId: string }) => row.orderId === order.id),
    ).toBe(false);

    await pay(order.id, 1000).expect(201);
    queue = await admin.agent.get('/api/finance/invoices');
    const row = queue.body.find(
      (item: { orderId: string }) => item.orderId === order.id,
    );
    expect(row.fiscal.rfc).toBe(fiscal.rfc);
    expect(row.invoiceStatus).toBe('requested');

    await admin
      .write('post', `${base}/orders/${order.id}/invoice`)
      .send({ invoiceFolio: 'A-100' })
      .expect(204);
    const view = await orderView(order.reference);
    expect(view).toMatchObject({
      invoiceStatus: 'issued',
      invoiceFolio: 'A-100',
    });

    const blocked = await admin
      .write('put', `${base}/orders/${order.id}/fiscal`)
      .send({ fiscal: { ...fiscal, legalName: 'Otra SA' } });
    expect(blocked.status).toBe(409);
  });

  it('rejects an invalid RFC at public registration', async () => {
    const response = await request(app)
      .post(`/api/public/events/${slug}/register`)
      .set('Origin', origin)
      .send({
        firstName: 'Mal',
        lastName: 'RFC',
        email: `malrfc@${domain}`,
        phone: '5512345678',
        organization: null,
        ticketTypeId: ticketId,
        answers: {},
        privacyAccepted: true,
        fiscal: { ...fiscal, rfc: 'NOVALE' },
      });
    expect(response.status).toBe(400);
  });

  it('records a refund as its own movement and reduces income', async () => {
    const order = await buy();
    await pay(order.id, 1000).expect(201);
    const before = await totals();

    const tooMuch = await admin
      .write('post', `${base}/orders/${order.id}/refunds`)
      .send(refundBody(1500));
    expect(tooMuch.status).toBe(409);

    const denied = await cashier
      .write('post', `${base}/orders/${order.id}/refunds`)
      .send(refundBody(300));
    expect(denied.status).toBe(403);

    await admin
      .write('post', `${base}/orders/${order.id}/refunds`)
      .send(refundBody(300))
      .expect(201);
    const view = await orderView(order.reference);
    expect(view).toMatchObject({
      financialStatus: 'partially_refunded',
      amountPaid: 1000,
      amountRefunded: 300,
      status: 'confirmed',
    });
    expect(view.refunds[0]).toMatchObject({
      amount: 300,
      reason: 'Pidió devolución',
      recordedBy: 'admin',
    });
    expect(view.registrations[0].passUrl).toBeTruthy();

    const after = await totals();
    expect(after.netCollected).toBe(before.netCollected - 300);
    expect(after.refunded).toBe(before.refunded + 300);

    const metrics = (await eventMetrics()).find((row) => row.id === eventId);
    expect(metrics?.income).toBe(after.netCollected);

    const audit = await prisma.auditLog.findFirst({
      where: { eventId, action: 'refund.record' },
    });
    expect(audit?.details).toMatchObject({ reason: 'Pidió devolución' });
  });

  it('does not refund an order that still owes money', async () => {
    const order = await buy();
    await pay(order.id, 400).expect(201);
    const response = await admin
      .write('post', `${base}/orders/${order.id}/refunds`)
      .send(refundBody(100));
    expect(response.status).toBe(409);
  });

  it('protects a payment that a refund depends on', async () => {
    const order = await buy();
    await pay(order.id, 1000).expect(201);
    const refund = await admin
      .write('post', `${base}/orders/${order.id}/refunds`)
      .send(refundBody(1000))
      .expect(201);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const blocked = await admin.write(
      'post',
      `${base}/orders/${order.id}/payments/${payment.id}/void`,
    );
    expect(blocked.status).toBe(409);

    await admin
      .write(
        'post',
        `${base}/orders/${order.id}/refunds/${refund.body.id as string}/void`,
      )
      .expect(204);
    expect((await orderView(order.reference)).financialStatus).toBe('paid');
    await admin
      .write('post', `${base}/orders/${order.id}/payments/${payment.id}/void`)
      .expect(204);
  });

  it('never loses the money of a cancelled order', async () => {
    const retained = await buy();
    await pay(retained.id, 1000).expect(201);
    const before = await totals();

    const noReason = await admin
      .write('post', `${base}/orders/${retained.id}/cancel`)
      .send({});
    expect(noReason.status).toBe(400);
    const noPermission = await cashier
      .write('post', `${base}/orders/${retained.id}/cancel`)
      .send({ reason: 'Se arrepintió' });
    expect(noPermission.status).toBe(403);

    await admin
      .write('post', `${base}/orders/${retained.id}/cancel`)
      .send({ reason: 'Fuera de plazo' })
      .expect(204);
    const view = await orderView(retained.reference);
    expect(view).toMatchObject({
      financialStatus: 'cancelled_retained',
      cancellationReason: 'Fuera de plazo',
    });
    const after = await totals();
    expect(after.netCollected).toBe(before.netCollected);
    expect(after.retainedFromCancelled).toBe(
      before.retainedFromCancelled + 1000,
    );

    const refunded = await buy();
    await pay(refunded.id, 1000).expect(201);
    await admin
      .write('post', `${base}/orders/${refunded.id}/cancel`)
      .send({
        reason: 'A tiempo',
        refund: {
          amount: 1000,
          method: 'transfer',
          reference: 'SPEI-1',
          refundedAt: new Date().toISOString(),
        },
      })
      .expect(204);
    expect((await orderView(refunded.reference)).financialStatus).toBe(
      'cancelled_refunded',
    );
    expect((await totals()).netCollected).toBe(after.netCollected);

    // Lo retenido se puede devolver después.
    await admin
      .write('post', `${base}/orders/${retained.id}/refunds`)
      .send(refundBody(500, 'Se revisó el caso'))
      .expect(201);

    // Sin dinero de por medio, cancela quien administra registros, sin motivo.
    const unpaid = await buy();
    await cashier
      .write('post', `${base}/orders/${unpaid.id}/cancel`)
      .expect(204);
  });

  it('corrects a name without touching the pass', async () => {
    const order = await buy(`nombre${run}`);
    await pay(order.id, 1000).expect(201);
    const before = await orderView(order.reference);
    const registrationId = before.registrations[0].id as string;
    await cashier
      .write(
        'post',
        `${base}/orders/registrations/${registrationId}/correct-name`,
      )
      .send({
        firstName: 'Nombre',
        lastName: 'Corregido',
        reason: 'Error de dedo',
      })
      .expect(204);
    const after = await orderView(order.reference);
    expect(after.registrations[0].guestName).toBe('Nombre Corregido');
    expect(after.registrations[0].passUrl).toBe(
      before.registrations[0].passUrl,
    );
  });

  it('transfers a pass: old QR dies, folio stays, new person accepts the notice', async () => {
    const order = await buy(`cede${run}`);
    await pay(order.id, 1000).expect(201);
    const before = await orderView(order.reference);
    const registration = before.registrations[0];
    const newEmail = `recibe${run}@${domain}`;

    await cashier
      .write(
        'post',
        `${base}/orders/registrations/${registration.id as string}/transfer`,
      )
      .send({
        firstName: 'Recibe',
        lastName: 'Pase',
        email: newEmail,
        reason: 'No podrá asistir',
      })
      .expect(202);

    const stored = await prisma.registration.findUniqueOrThrow({
      where: { id: registration.id as string },
      include: {
        guest: true,
        passes: { orderBy: { issuedAt: 'asc' } },
        consents: { include: { guest: true } },
      },
    });
    expect(stored.folio).toBe(registration.folio);
    expect(stored.guest.email).toBe(newEmail);
    expect(stored.passes.map((pass) => pass.status)).toEqual([
      'revoked',
      'pending_activation',
    ]);
    // La aceptación anterior sigue a nombre de quien aceptó.
    expect(stored.consents).toHaveLength(1);
    expect(stored.consents[0]?.guest.firstName).toBe(`cede${run}`);
    expect(
      await prisma.emailMessage.count({
        where: { kind: 'pass_activation', toEmail: newEmail },
      }),
    ).toBe(1);
    const buyer = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { buyer: true },
    });
    expect(buyer.buyer.firstName).toBe(`cede${run}`);

    const consents = await admin.agent.get(
      `/api/consents/notices?eventId=${eventId}&q=cede${run}`,
    );
    expect(consents.body.rows[0].guestName).toBe(`cede${run} Prueba`);
  });

  it('does not transfer a pass that already entered', async () => {
    const order = await buy();
    await pay(order.id, 1000).expect(201);
    const view = await orderView(order.reference);
    const registrationId = view.registrations[0].id as string;
    const pass = await prisma.pass.findFirstOrThrow({
      where: { registrationId, status: 'active' },
    });
    const point = await prisma.accessPoint.create({
      data: { eventId, name: `Fila ${randomBytes(2).toString('hex')}` },
    });
    await prisma.checkin.create({
      data: { eventId, passId: pass.id, accessPointId: point.id },
    });
    const response = await cashier
      .write('post', `${base}/orders/registrations/${registrationId}/transfer`)
      .send({
        firstName: 'Tarde',
        lastName: 'Pase',
        email: `tarde@${domain}`,
        reason: 'Fuera de tiempo',
      });
    expect(response.status).toBe(409);
  });

  it('shows the policy before paying and suggests a refund by date', async () => {
    const empty = await admin.agent.get(`${base}/orders/policy`);
    expect(empty.body).toBeNull();

    await admin
      .write('put', '/api/finance/policies')
      .send({
        eventType,
        text: 'Devolución total hasta 30 días antes; 50% hasta 15 días antes.',
        tiers: [
          { daysBefore: 30, percent: 100 },
          { daysBefore: 15, percent: 50 },
        ],
      })
      .expect(204);

    const publicEvent = await request(app).get(`/api/public/events/${slug}`);
    expect(publicEvent.body.cancellationPolicy).toContain('Devolución total');

    const policy = await admin.agent.get(`${base}/orders/policy`);
    expect(policy.body.suggestedPercent).toBe(100);

    await prisma.event.update({
      where: { id: eventId },
      data: { startsAt: new Date(Date.now() + 20 * day) },
    });
    expect(
      (await admin.agent.get(`${base}/orders/policy`)).body.suggestedPercent,
    ).toBe(50);
    await prisma.event.update({
      where: { id: eventId },
      data: { startsAt: new Date(Date.now() + 40 * day) },
    });
  });

  it('compares income against goal and costs', async () => {
    await admin
      .write('put', `${base}/finance/settings`)
      .send({
        fundraisingGoal: 100_000,
        paymentTermDays: 7,
        corporateTermDays: 15,
        paymentCutoffDays: 10,
        paymentReminders: true,
      })
      .expect(204);
    await prisma.donation.create({
      data: {
        eventId,
        amount: 2500,
        method: 'transfer',
        receivedAt: new Date(),
      },
    });
    const first = await admin
      .write('post', `${base}/finance/budget`)
      .send({
        category: 'venue',
        concept: 'Salón',
        budgeted: 3000,
        actual: 3500,
        notes: null,
      })
      .expect(201);
    await admin
      .write('post', `${base}/finance/budget`)
      .send({
        category: 'catering',
        concept: 'Cena',
        budgeted: 2000,
        actual: null,
        notes: null,
      })
      .expect(201);

    const { body } = await admin.agent.get(`${base}/finance`);
    const { totals: t } = body;
    expect(t.totalIncome).toBe(t.netCollected + 2500);
    expect(t.goal).toBe(100_000);
    expect(t.goalProgress).toBeCloseTo(t.totalIncome / 100_000);
    expect(t.budgeted).toBe(5000);
    expect(t.actualCosts).toBe(3500);
    expect(t.costsMissing).toBe(1);
    expect(t.result).toBe(t.totalIncome - 3500);
    expect(t.projectedResult).toBe(t.totalIncome + t.receivable - 3500 - 2000);

    await admin
      .write('put', `${base}/finance/budget/${first.body.id as string}`)
      .send({
        category: 'venue',
        concept: 'Salón',
        budgeted: 3000,
        actual: 3000,
        notes: null,
      })
      .expect(204);
    expect((await totals()).actualCosts).toBe(3000);
  });

  it('warns before closing, keeps the numbers and locks the money', async () => {
    const pendingOrder = await buy();
    const paidOrder = await buy();
    await pay(paidOrder.id, 1000).expect(201);

    const check = await admin.agent.get(`${base}/finance/closing-check`);
    const keys = check.body.issues.map((issue: { key: string }) => issue.key);
    expect(keys).toEqual(
      expect.arrayContaining(['receivable', 'retained', 'costs']),
    );

    const refused = await admin
      .write('post', `${base}/status`)
      .send({ status: 'closed' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('saldo');

    await admin
      .write('post', `${base}/status`)
      .send({ status: 'closed', note: 'Se cobra por fuera en enero' })
      .expect(200);

    const closed = await admin.agent.get(`${base}/finance`);
    expect(closed.body.closing).toMatchObject({
      closedBy: 'admin',
      note: 'Se cobra por fuera en enero',
    });
    const frozen = closed.body.closing.totals.netCollected as number;
    expect(frozen).toBe(closed.body.totals.netCollected);

    for (const attempt of [
      () => pay(pendingOrder.id, 1000),
      () =>
        admin
          .write('post', `${base}/orders/${paidOrder.id}/refunds`)
          .send(refundBody(100)),
      () =>
        admin
          .write('post', `${base}/orders/${paidOrder.id}/cancel`)
          .send({ reason: 'Tarde' }),
      () =>
        admin.write('post', `${base}/finance/budget`).send({
          category: 'other',
          concept: 'Tarde',
          budgeted: 1,
          actual: null,
          notes: null,
        }),
    ]) {
      expect((await attempt()).status).toBe(409);
    }

    await queuePaymentReminders(new Date(Date.now() + 30 * day));
    expect(
      await prisma.emailMessage.count({
        where: { kind: 'payment_reminder', refId: pendingOrder.id },
      }),
    ).toBe(0);

    await admin
      .write('post', `${base}/status`)
      .send({ status: 'active' })
      .expect(200);
    expect((await admin.agent.get(`${base}/finance`)).body.closing).toBeNull();
    await pay(pendingOrder.id, 1000).expect(201);
  });

  it('separates who collects from who refunds', async () => {
    const loginAs = async (name: string, code: string) => {
      const role = await prisma.role.findUniqueOrThrow({ where: { code } });
      await prisma.user.create({
        data: {
          email: `${name}@${domain}`,
          displayName: name,
          roleId: role.id,
        },
      });
      return login(name);
    };
    const collections = await loginAs('cobranza', 'COLLECTIONS');
    const finance = await loginAs('finanzas', 'FINANCE');
    const direction = await loginAs('direccion', 'DIRECTION');

    const order = await buy();
    expect((await pay(order.id, 1000, finance)).status).toBe(403);
    await pay(order.id, 1000, collections).expect(201);

    const denied = await collections
      .write('post', `${base}/orders/${order.id}/refunds`)
      .send(refundBody(100));
    expect(denied.status).toBe(403);
    const cannotCancel = await collections
      .write('post', `${base}/orders/${order.id}/cancel`)
      .send({ reason: 'Sin permiso' });
    expect(cannotCancel.status).toBe(403);

    await finance
      .write('post', `${base}/orders/${order.id}/refunds`)
      .send(refundBody(100))
      .expect(201);
    await finance
      .write('post', `${base}/orders/${order.id}/cancel`)
      .send({ reason: 'Autoriza finanzas' })
      .expect(204);

    expect(
      (await collections.agent.get('/api/finance/receivables')).status,
    ).toBe(200);
    expect((await direction.agent.get(`${base}/finance`)).status).toBe(200);
    expect((await direction.agent.get('/api/audit')).status).toBe(200);
    const blocked = await direction
      .write('put', `${base}/finance/settings`)
      .send({
        fundraisingGoal: 1,
        paymentTermDays: 1,
        corporateTermDays: 1,
        paymentCutoffDays: 1,
        paymentReminders: true,
      });
    expect(blocked.status).toBe(403);
  });

  it('closes without a note when nothing is pending', async () => {
    const series = await prisma.eventSeries.create({
      data: { name: `Limpia ${run}`, type: 'gala' },
    });
    const clean = await prisma.event.create({
      data: {
        seriesId: series.id,
        editionYear: 2031,
        status: 'active',
        slug: `lim-${run}`,
        name: `Limpia ${run}`,
        modules: [],
      },
    });
    await admin
      .write('post', `/api/events/${clean.id}/status`)
      .send({ status: 'closed' })
      .expect(200);
    await prisma.auditLog.deleteMany({ where: { eventId: clean.id } });
    await prisma.event.delete({ where: { id: clean.id } });
    await prisma.eventSeries.delete({ where: { id: series.id } });
  });
});

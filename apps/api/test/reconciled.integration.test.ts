import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';
import { renderEmail } from '../src/modules/mail/templates.js';
import { groupToken } from '../src/modules/passes/tokens.js';

/** Flujo real contra MariaDB (no corre en CI): npm run test:db-integration */
const run = randomBytes(4).toString('hex');
const domain = `${run}.uka.test`;
const origin = 'http://localhost:5173';

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
  return {
    get: (path: string) => agent.get(path),
    post: (path: string) =>
      agent.post(path).set('Origin', origin).set('X-CSRF-Token', csrf),
  };
}

const guest = (name: string, overrides: object = {}) => ({
  firstName: name,
  lastName: 'Prueba',
  email: `${name}@${domain}`,
  phone: '5512345678',
  organization: null,
  authorized: true,
  ...overrides,
});

describe.skipIf(!process.env.RUN_DB_TESTS)('reconciled purchases', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let registrar: Awaited<ReturnType<typeof login>>;
  let seriesId = '';
  let eventId = '';
  let single = '';
  let table = '';
  let limited = '';
  const slug = `conc-${run}`;

  const purchase = (name: string, overrides: object = {}) => ({
    firstName: name,
    lastName: 'Compradora',
    email: `${name}@${domain}`,
    phone: null,
    organization: null,
    ticketTypeId: single,
    quantity: 1,
    amount: 5500,
    method: 'transfer',
    reference: `SPEI-${name}`,
    notes: null,
    paidAt: '2030-01-10T18:00:00.000Z',
    ...overrides,
  });

  const reconcile = (body: object) =>
    admin.post(`/api/events/${eventId}/orders/reconciled`).send(body);

  const linkOf = (orderId: string) =>
    `/api/public/groups/${groupToken(orderId)}`;

  const addGuest = (orderId: string, body: object) =>
    request(app)
      .post(`${linkOf(orderId)}/guests`)
      .set('Origin', origin)
      .send(body);

  const mailOf = (refId: string) =>
    prisma.emailMessage.findMany({ where: { eventId, refId } });

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'ADMIN' },
    });
    const registrarRole = await prisma.role.create({
      data: {
        code: `CONC_${run}`,
        name: `Registro ${run}`,
        permissions: {
          create: [
            { permission: 'events.view' },
            { permission: 'registrations.manage' },
          ],
        },
      },
    });
    await prisma.user.createMany({
      data: [
        {
          email: `admin@${domain}`,
          displayName: 'admin',
          roleId: adminRole.id,
        },
        {
          email: `registrar@${domain}`,
          displayName: 'registrar',
          roleId: registrarRole.id,
        },
      ],
    });
    admin = await login('admin');
    registrar = await login('registrar');
    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: 'Gala' },
    });
    seriesId = series.id;
    const event = await prisma.event.create({
      data: {
        seriesId,
        editionYear: 2030,
        modules: ['publicRegistration'],
        status: 'active',
        slug,
        name: `Gala ${run}`,
        folioPrefix: 'CON',
        capacity: 40,
        startsAt: new Date('2030-03-01T02:00:00.000Z'),
      },
    });
    eventId = event.id;
    single = (
      await prisma.ticketType.create({
        data: { eventId, name: 'Individual', price: 5500 },
      })
    ).id;
    table = (
      await prisma.ticketType.create({
        data: { eventId, name: 'Mesa', price: 50000, seatsIncluded: 10 },
      })
    ).id;
    limited = (
      await prisma.ticketType.create({
        data: { eventId, name: 'Limitado', price: 100, capacity: 2 },
      })
    ).id;
  });

  afterAll(async () => {
    const inEvent = { eventId };
    const registrations = await prisma.registration.findMany({
      where: inEvent,
      select: { id: true },
    });
    const ids = registrations.map(({ id }) => id);
    const orders = await prisma.order.findMany({
      where: inEvent,
      select: { id: true },
    });
    await prisma.emailMessage.deleteMany({ where: inEvent });
    await prisma.consent.deleteMany({ where: { registrationId: { in: ids } } });
    await prisma.pass.deleteMany({ where: { registrationId: { in: ids } } });
    await prisma.registration.deleteMany({ where: inEvent });
    await prisma.payment.deleteMany({
      where: { orderId: { in: orders.map(({ id }) => id) } },
    });
    await prisma.order.deleteMany({ where: inEvent });
    await prisma.guest.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.contact.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.ticketType.deleteMany({ where: inEvent });
    await prisma.eventCounter.deleteMany({ where: inEvent });
    await prisma.auditLog.deleteMany({
      where: { OR: [inEvent, { user: { email: { endsWith: domain } } }] },
    });
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
    await prisma.authSession.deleteMany({
      where: { user: { email: { endsWith: domain } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.role.deleteMany({ where: { code: `CONC_${run}` } });
  });

  it('only someone who can manage payments reconciles', async () => {
    const denied = await registrar
      .post(`/api/events/${eventId}/orders/reconciled`)
      .send(purchase('negada'));
    expect(denied.status).toBe(403);
  });

  it('confirms the purchase, invites the buyer and sends no QR until they register', async () => {
    const created = await reconcile(purchase('ana'));
    expect(created.status).toBe(201);
    const orderId = created.body.id as string;

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { payments: true, registrations: true },
    });
    expect(order.status).toBe('confirmed');
    expect(order.source).toBe('reconciled');
    expect(order.registrations).toHaveLength(0);
    expect(order.payments[0]?.reference).toBe('SPEI-ana');

    const queued = await mailOf(orderId);
    expect(queued.map(({ kind }) => kind)).toEqual(['registration_invite']);
    expect(queued[0]?.toEmail).toBe(`ana@${domain}`);

    const invite = await renderEmail('registration_invite', orderId);
    expect(invite?.subject).toContain('Completa tu registro');
    expect(invite?.html).toContain('/mesa/');
    expect(invite?.html).toContain('cid:uka-logo');
    expect(invite?.html).toContain('Completar mi registro');

    const view = await request(app).get(linkOf(orderId));
    expect(view.status).toBe(200);
    expect(view.body.source).toBe('reconciled');
    expect(view.body.buyer.email).toBe(`ana@${domain}`);

    // Se registra ella misma: es su consentimiento y recibe su propio pase.
    const registered = await addGuest(orderId, guest('ana'));
    expect(registered.status).toBe(201);
    const registration = await prisma.registration.findFirstOrThrow({
      where: { orderId },
      include: { passes: true, consents: true },
    });
    expect(registration.status).toBe('confirmed');
    expect(registration.consents[0]?.purpose).toBe('event_registration');
    const pass = registration.passes[0]!;
    expect((await mailOf(pass.id)).map(({ kind }) => kind)).toEqual(['pass']);

    // Un solo boleto: no admite un segundo asistente.
    expect((await addGuest(orderId, guest('otra'))).status).toBe(409);
  });

  it('splits several tickets in seats and leaves third parties to activate', async () => {
    const created = await reconcile(
      purchase('beto', { quantity: 2, amount: 11000 }),
    );
    expect(created.status).toBe(201);
    const orderId = created.body.id as string;
    const view = await request(app).get(linkOf(orderId));
    expect(view.body.seats).toBe(2);
    expect((await renderEmail('registration_invite', orderId))?.html).toContain(
      'Registrar asistentes',
    );

    expect((await addGuest(orderId, guest('invitada'))).status).toBe(201);
    const registration = await prisma.registration.findFirstOrThrow({
      where: { orderId, guest: { email: `invitada@${domain}` } },
      include: { consents: true, passes: true },
    });
    // La compradora no acepta el aviso por su invitada: lo activa ella misma.
    expect(registration.consents).toHaveLength(0);
    expect(registration.passes[0]?.status).toBe('pending_activation');
  });

  it('multiplies seats for table tickets and shows how many are left to register', async () => {
    const created = await reconcile(
      purchase('empresa', { ticketTypeId: table, amount: 50000 }),
    );
    expect(created.status).toBe(201);
    const list = await admin.get(`/api/events/${eventId}/orders`);
    expect(list.status).toBe(200);
    const order = list.body.orders.find(
      ({ id }: { id: string }) => id === created.body.id,
    );
    expect(order.seats).toBe(10);
    expect(order.quantity).toBe(1);
    expect(order.groupUrl).toContain('/mesa/');
    // Ana registró su lugar, Beto uno de dos y la empresa ninguno de diez.
    expect(list.body.summary.seatsToRegister).toBe(11);
  });

  it('rejects reconciling the same payment twice and a paid order without reference', async () => {
    const repeated = await reconcile(
      purchase('dup', { reference: 'SPEI-ana' }),
    );
    expect(repeated.status).toBe(409);
    expect(repeated.body.error).toContain('ya se concilió');
    const noReference = await reconcile(
      purchase('sinref', { reference: null }),
    );
    expect(noReference.status).toBe(400);
  });

  it('respects ticket and event capacity by quantity', async () => {
    const tooMany = await reconcile(
      purchase('lim1', {
        ticketTypeId: limited,
        quantity: 3,
        amount: 300,
      }),
    );
    expect(tooMany.status).toBe(409);
    const fits = await reconcile(
      purchase('lim2', {
        ticketTypeId: limited,
        quantity: 2,
        amount: 200,
      }),
    );
    expect(fits.status).toBe(201);
    const soldOut = await reconcile(
      purchase('lim3', { ticketTypeId: limited, amount: 100 }),
    );
    expect(soldOut.status).toBe(409);
    // Una venta pública también cuenta los boletos conciliados.
    const pub = await request(app)
      .post(`/api/public/events/${slug}/register`)
      .set('Origin', origin)
      .send({
        firstName: 'Publico',
        lastName: 'Prueba',
        email: `publico@${domain}`,
        phone: '5512345678',
        organization: null,
        ticketTypeId: limited,
        answers: {},
        privacyAccepted: true,
      });
    expect(pub.status).toBe(409);

    const overEvent = await reconcile(
      purchase('lleno', { ticketTypeId: table, quantity: 5, amount: 250000 }),
    );
    expect(overEvent.status).toBe(409);
  });

  it('allows a courtesy and closes the link when the payment is voided', async () => {
    const courtesy = await reconcile(
      purchase('cortesia', { amount: 0, reference: null }),
    );
    expect(courtesy.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: courtesy.body.id as string },
      include: { payments: true },
    });
    expect(order.status).toBe('confirmed');
    expect(order.payments).toHaveLength(0);

    const paid = await reconcile(purchase('anula'));
    const orderId = paid.body.id as string;
    expect((await addGuest(orderId, guest('anula'))).status).toBe(201);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId },
    });

    const voided = await admin.post(
      `/api/events/${eventId}/orders/${orderId}/payments/${payment.id}/void`,
    );
    expect(voided.status).toBeLessThan(300);
    expect((await request(app).get(linkOf(orderId))).status).toBe(404);
    const pass = await prisma.pass.findFirstOrThrow({
      where: { registration: { orderId } },
    });
    expect(pass.status).toBe('revoked');

    // Al volver a pagar se reabre la liga y se invita de nuevo.
    const before = (await mailOf(orderId)).length;
    const repaid = await admin
      .post(`/api/events/${eventId}/orders/${orderId}/payments`)
      .send({
        amount: 5500,
        method: 'transfer',
        reference: 'SPEI-anula-2',
        notes: null,
        paidAt: '2030-01-11T18:00:00.000Z',
      });
    expect(repaid.status).toBe(201);
    expect((await request(app).get(linkOf(orderId))).status).toBe(200);
    const after = await mailOf(orderId);
    expect(after).toHaveLength(before + 1);
    expect(after.every(({ kind }) => kind === 'registration_invite')).toBe(
      true,
    );
  });

  it('resends the link only while there are seats to register', async () => {
    const created = await reconcile(purchase('reenvio'));
    const orderId = created.body.id as string;
    const resend = () =>
      admin.post(`/api/events/${eventId}/orders/${orderId}/resend-link`);
    expect((await resend()).status).toBe(202);
    expect(await mailOf(orderId)).toHaveLength(2);
    expect((await addGuest(orderId, guest('reenvio'))).status).toBe(201);
    expect((await resend()).status).toBe(409);
  });
});

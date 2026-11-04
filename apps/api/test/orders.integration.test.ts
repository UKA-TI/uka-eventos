import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';
import { MailServiceError } from '../src/modules/mail/graph-transport.js';
import { processMailQueue } from '../src/modules/mail/queue.js';
import type { OutgoingEmail } from '../src/modules/mail/templates.js';

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
  const post = (path: string) =>
    agent.post(path).set('Origin', origin).set('X-CSRF-Token', csrf);
  return { agent, post };
}

const person = (name: string, overrides: object = {}) => ({
  firstName: name,
  lastName: 'Prueba',
  email: `${name}@${domain}`,
  phone: '5512345678',
  organization: null,
  answers: {},
  privacyAccepted: true,
  ...overrides,
});

const register = (slug: string, body: object) =>
  request(app)
    .post(`/api/public/events/${slug}/register`)
    .set('Origin', origin)
    .send(body);

const tokenFrom = (url: string) => url.split('/').pop() ?? '';

const payment = (amount: number) => ({
  amount,
  method: 'transfer',
  reference: 'SPEI-1',
  notes: null,
  paidAt: '2027-01-10T18:00:00.000Z',
});

describe.skipIf(!process.env.RUN_DB_TESTS)('registration and payments', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let viewer: Awaited<ReturnType<typeof login>>;
  let eventId = '';
  let seriesId = '';
  let paidTicket = '';
  let freeTicket = '';
  let tableTicket = '';
  let limitedTicket = '';
  let requiredField = '';
  const slug = `evento-${run}`;

  const listOrders = async (query = '') => {
    const response = await admin.agent.get(
      `/api/events/${eventId}/orders${query}`,
    );
    expect(response.status).toBe(200);
    return response.body;
  };
  const findOrder = async (reference: string) => {
    const body = await listOrders();
    return body.orders.find(
      (order: { reference: string }) => order.reference === reference,
    );
  };

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const roles = await prisma.role.findMany({
      where: { code: { in: ['ADMIN', 'QUERY'] } },
    });
    const roleId = (code: string) =>
      roles.find((role) => role.code === code)!.id;
    await prisma.user.createMany({
      data: [
        {
          email: `admin@${domain}`,
          displayName: 'admin',
          roleId: roleId('ADMIN'),
        },
        {
          email: `viewer@${domain}`,
          displayName: 'viewer',
          roleId: roleId('QUERY'),
        },
      ],
    });
    admin = await login('admin');
    viewer = await login('viewer');

    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: 'Gala' },
    });
    seriesId = series.id;
    const event = await prisma.event.create({
      data: {
        seriesId,
        editionYear: 2027,
        slug,
        name: `Evento ${run}`,
        status: 'active',
        startsAt: new Date('2027-02-12T00:30:00.000Z'),
        capacity: 17,
        folioPrefix: 'TST',
        paymentInstructions: 'Cuenta <b>de prueba</b>',
        modules: ['publicRegistration', 'corporate', 'checkin'],
        ticketTypes: {
          create: [
            { name: 'Individual', price: 500, sortOrder: 0 },
            { name: 'Cortesía', price: 0, sortOrder: 1 },
            { name: 'Mesa', price: 4000, seatsIncluded: 10, sortOrder: 2 },
            { name: 'Limitado', price: 0, capacity: 1, sortOrder: 3 },
          ],
        },
        formFields: {
          create: [
            {
              label: 'Talla',
              type: 'select',
              required: true,
              options: ['CH', 'M'],
            },
          ],
        },
      },
      include: { ticketTypes: true, formFields: true },
    });
    eventId = event.id;
    const ticket = (name: string) =>
      event.ticketTypes.find((item) => item.name === name)!.id;
    paidTicket = ticket('Individual');
    freeTicket = ticket('Cortesía');
    tableTicket = ticket('Mesa');
    limitedTicket = ticket('Limitado');
    requiredField = event.formFields[0]!.id;
  });

  afterAll(async () => {
    const orders = await prisma.order.findMany({
      where: { eventId },
      select: { id: true, buyerGuestId: true },
    });
    const registrations = await prisma.registration.findMany({
      where: { eventId },
      select: { id: true, guestId: true },
    });
    const registrationIds = registrations.map((item) => item.id);
    await prisma.emailMessage.deleteMany({ where: { eventId } });
    await prisma.consent.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    await prisma.incident.deleteMany({ where: { eventId } });
    await prisma.checkin.deleteMany({ where: { eventId } });
    await prisma.accessPoint.deleteMany({ where: { eventId } });
    await prisma.pass.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    await prisma.registration.deleteMany({ where: { eventId } });
    await prisma.payment.deleteMany({
      where: { orderId: { in: orders.map((order) => order.id) } },
    });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.guest.deleteMany({
      where: {
        id: {
          in: [
            ...orders.map((order) => order.buyerGuestId),
            ...registrations.map((item) => item.guestId),
          ],
        },
      },
    });
    await prisma.eventCounter.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `@${domain}` } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('shows only public data of an open event', async () => {
    const response = await request(app).get(`/api/public/events/${slug}`);
    expect(response.status).toBe(200);
    expect(response.body.tickets).toHaveLength(4);
    expect(response.body).not.toHaveProperty('paymentInstructions');
    expect(response.body).not.toHaveProperty('capacity');
    expect((await request(app).get('/api/public/events/nope')).status).toBe(
      404,
    );
  });

  it('rejects writes from other origins, robots and missing consent', async () => {
    const body = person('robot', {
      ticketTypeId: freeTicket,
      answers: { [requiredField]: 'M' },
    });
    const foreign = await request(app)
      .post(`/api/public/events/${slug}/register`)
      .set('Origin', 'https://evil.example')
      .send(body);
    expect(foreign.status).toBe(403);
    expect((await register(slug, { ...body, website: 'x' })).status).toBe(400);
    expect(
      (await register(slug, { ...body, privacyAccepted: false })).status,
    ).toBe(400);
  });

  it('validates the custom questions', async () => {
    const missing = await register(
      slug,
      person('a', { ticketTypeId: freeTicket }),
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain('Talla');
    const invalid = await register(
      slug,
      person('a', {
        ticketTypeId: freeTicket,
        answers: { [requiredField]: 'XXL' },
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it('issues the pass immediately on free tickets', async () => {
    const response = await register(
      slug,
      person('gratis', {
        ticketTypeId: freeTicket,
        answers: { [requiredField]: 'M' },
      }),
    );
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('confirmed');
    expect(response.body.paymentInstructions).toBeNull();
    const pass = await request(app).get(
      `/api/public/passes/${tokenFrom(response.body.passUrl)}`,
    );
    expect(pass.status).toBe(200);
    expect(pass.body.status).toBe('active');
    expect(pass.body.qrDataUrl).toMatch(/^data:image\/png/);
    expect(pass.body.guestName).toBe('gratis Prueba');

    const consent = await prisma.consent.count({
      where: { registration: { folio: response.body.reference, eventId } },
    });
    expect(consent).toBe(1);
  });

  it('holds the QR on paid tickets until the payment is complete', async () => {
    const created = await register(
      slug,
      person('paga', {
        ticketTypeId: paidTicket,
        answers: { [requiredField]: 'CH' },
      }),
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending_payment');
    expect(created.body.passUrl).toBeNull();
    expect(created.body.paymentInstructions).toContain('de prueba');

    const order = await findOrder(created.body.reference);
    expect(order.amountDue).toBe(500);
    expect(order.registrations[0].passUrl).toBeNull();
    const url = `/api/events/${eventId}/orders/${order.id}/payments`;

    const tooMuch = await admin.post(url).send(payment(900));
    expect(tooMuch.status).toBe(409);

    const partial = await admin.post(url).send(payment(200));
    expect(partial.body.completed).toBe(false);
    expect((await findOrder(order.reference)).status).toBe('pending_payment');

    const rest = await admin.post(url).send(payment(300));
    expect(rest.body.completed).toBe(true);
    const confirmed = await findOrder(order.reference);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.amountPaid).toBe(500);
    const passUrl = confirmed.registrations[0].passUrl;
    expect(passUrl).toBeTruthy();
    expect(
      (await request(app).get(`/api/public/passes/${tokenFrom(passUrl)}`)).body
        .status,
    ).toBe('active');
  });

  it('revokes the pass if the payment is voided, and restores it when paid', async () => {
    const created = await register(
      slug,
      person('anula', {
        ticketTypeId: paidTicket,
        answers: { [requiredField]: 'M' },
      }),
    );
    const order = await findOrder(created.body.reference);
    const base = `/api/events/${eventId}/orders/${order.id}/payments`;
    await admin.post(base).send(payment(500));
    const paid = await findOrder(order.reference);
    const token = tokenFrom(paid.registrations[0].passUrl);

    const voided = await admin.post(`${base}/${paid.payments[0].id}/void`);
    expect(voided.status).toBe(204);
    const pending = await findOrder(order.reference);
    expect(pending.status).toBe('pending_payment');
    expect(pending.amountPaid).toBe(0);
    const revoked = await request(app).get(`/api/public/passes/${token}`);
    expect(revoked.body.status).toBe('revoked');
    expect(revoked.body.qrDataUrl).toBeNull();

    await admin.post(base).send(payment(500));
    const again = await findOrder(order.reference);
    expect(again.status).toBe('confirmed');
    expect(tokenFrom(again.registrations[0].passUrl)).not.toBe(token);
  });

  it('enforces permissions and hides QR links from viewers', async () => {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'QUERY' },
    });
    const custom = await prisma.role.create({
      data: {
        code: `CUSTOM_${run}`,
        name: `Solo registros ${run}`,
        permissions: {
          create: [
            { permission: 'events.view' },
            { permission: 'registrations.view' },
          ],
        },
      },
    });
    await prisma.user.update({
      where: { email: `viewer@${domain}` },
      data: { roleId: custom.id },
    });
    const list = await viewer.agent.get(`/api/events/${eventId}/orders`);
    expect(list.status).toBe(200);
    const withPass = list.body.orders.find(
      (order: { status: string }) => order.status === 'confirmed',
    );
    expect(withPass.registrations[0].passUrl).toBeNull();
    expect(
      (
        await viewer
          .post(`/api/events/${eventId}/orders/${withPass.id}/payments`)
          .send(payment(1))
      ).status,
    ).toBe(403);
    expect(
      (await viewer.post(`/api/events/${eventId}/orders/${withPass.id}/cancel`))
        .status,
    ).toBe(403);
    await prisma.user.update({
      where: { email: `viewer@${domain}` },
      data: { roleId: role.id },
    });
    await prisma.role.delete({ where: { id: custom.id } });
    expect(
      (await viewer.agent.get(`/api/events/${eventId}/orders`)).status,
    ).toBe(403);
  });

  it('runs the private link for multi-seat tickets', async () => {
    const created = await register(
      slug,
      person('empresa', {
        organization: 'Empresa Ejemplo',
        ticketTypeId: tableTicket,
        answers: { [requiredField]: 'M' },
      }),
    );
    expect(created.body.seats).toBe(10);
    expect(created.body.groupUrl).toBeNull();
    const order = await findOrder(created.body.reference);
    expect(order.registrations).toHaveLength(0);

    await admin
      .post(`/api/events/${eventId}/orders/${order.id}/payments`)
      .send(payment(4000));
    const confirmed = await findOrder(order.reference);
    expect(confirmed.groupUrl).toBeTruthy();
    const token = tokenFrom(confirmed.groupUrl);

    const empty = await request(app).get(`/api/public/groups/${token}`);
    expect(empty.body.seats).toBe(10);
    expect(empty.body.guests).toHaveLength(0);

    const guest = (name: string, extra: object = {}) => ({
      firstName: name,
      lastName: 'Invitado',
      email: `${name}@${domain}`,
      phone: '5512345678',
      organization: null,
      authorized: true,
      ...extra,
    });
    const url = `/api/public/groups/${token}/guests`;
    const denied = await request(app)
      .post(url)
      .set('Origin', origin)
      .send(guest('sin', { authorized: false }));
    expect(denied.status).toBe(400);

    const first = await request(app)
      .post(url)
      .set('Origin', origin)
      .send(guest('uno'));
    expect(first.status).toBe(201);
    expect(first.body.guests).toHaveLength(1);

    const removed = await request(app)
      .delete(`${url}/${first.body.guests[0].id}`)
      .set('Origin', origin);
    expect(removed.status).toBe(200);
    expect(removed.body.guests).toHaveLength(0);

    for (let seat = 0; seat < 10; seat += 1) {
      const added = await request(app)
        .post(url)
        .set('Origin', origin)
        .send(guest(`g${seat}`));
      expect(added.status).toBe(201);
    }
    const extra = await request(app)
      .post(url)
      .set('Origin', origin)
      .send(guest('once'));
    expect(extra.status).toBe(409);
    const list = await findOrder(order.reference);
    const folios = list.registrations.map(
      (item: { folio: string }) => item.folio,
    );
    expect(new Set(folios).size).toBe(folios.length);
  });

  it('never oversells tickets or the event, even under pressure', async () => {
    const limited = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        register(
          slug,
          person(`limit${index}`, {
            ticketTypeId: limitedTicket,
            answers: { [requiredField]: 'M' },
          }),
        ),
      ),
    );
    const statuses = limited.map((item) => item.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);

    const beforeFill = await listOrders();
    const left = 17 - beforeFill.summary.seatsTaken;
    expect(left).toBe(3);
    const flood = await Promise.all(
      Array.from({ length: left + 3 }, (_, index) =>
        register(
          slug,
          person(`flood${index}`, {
            ticketTypeId: freeTicket,
            answers: { [requiredField]: 'M' },
          }),
        ),
      ),
    );
    expect(flood.filter((item) => item.status === 201)).toHaveLength(left);
    const after = await listOrders();
    expect(after.summary.seatsTaken).toBe(17);

    const publicView = await request(app).get(`/api/public/events/${slug}`);
    expect(
      publicView.body.tickets.every(
        (ticket: { soldOut: boolean }) => ticket.soldOut,
      ),
    ).toBe(true);
  });

  it('frees the seats and invalidates passes when an order is cancelled', async () => {
    const body = await listOrders('?q=flood');
    const order = body.orders[0];
    const token = tokenFrom(order.registrations[0].passUrl);
    const cancel = await admin.post(
      `/api/events/${eventId}/orders/${order.id}/cancel`,
    );
    expect(cancel.status).toBe(204);
    expect(
      (await request(app).get(`/api/public/passes/${token}`)).body.status,
    ).toBe('revoked');
    expect((await listOrders()).summary.seatsTaken).toBe(16);
    const twice = await admin.post(
      `/api/events/${eventId}/orders/${order.id}/cancel`,
    );
    expect(twice.status).toBe(409);
  });

  it('does not expose orders through another event', async () => {
    const other = await prisma.event.create({
      data: {
        seriesId,
        editionYear: 2027,
        slug: `otro-${run}`,
        name: `Otro ${run}`,
        modules: [],
      },
    });
    const body = await listOrders();
    const response = await admin
      .post(`/api/events/${other.id}/orders/${body.orders[0].id}/payments`)
      .send(payment(1));
    expect(response.status).toBe(404);
    await prisma.event.delete({ where: { id: other.id } });
  });

  it('sends through the queue within limits, retries and escapes content', async () => {
    const unpaid = await register(
      slug,
      person('sinpago', {
        ticketTypeId: paidTicket,
        answers: { [requiredField]: 'M' },
      }),
    );
    expect(unpaid.body.status).toBe('pending_payment');
    const sent: { to: string; email: OutgoingEmail }[] = [];
    await prisma.emailMessage.updateMany({
      where: { eventId: { not: eventId }, status: 'pending' },
      data: { nextAttemptAt: new Date('2100-01-01T00:00:00.000Z') },
    });

    const limited = await processMailQueue(
      { send: async (to, email) => void sent.push({ to, email }) },
      { perMinute: 2, perDay: 100 },
    );
    // Lo que ya no aplica, como el aviso de un pedido ya pagado, se omite sin enviar.
    expect(limited.sent + limited.skipped).toBe(2);
    expect(limited.sent).toBeGreaterThan(0);
    expect(sent).toHaveLength(limited.sent);
    const skipped = await prisma.emailMessage.count({
      where: { eventId, status: 'skipped' },
    });
    expect(skipped).toBe(limited.skipped);

    const blocked = await processMailQueue(
      { send: async () => undefined },
      { perMinute: limited.sent, perDay: 100 },
    );
    expect(blocked.sent).toBe(0);

    // Un secreto vencido no debe gastar los intentos ni perder mensajes.
    const beforeService = await prisma.emailMessage.count({
      where: { eventId, status: 'pending' },
    });
    const service = await processMailQueue(
      {
        send: async () => {
          throw new MailServiceError('invalid_client');
        },
      },
      { perMinute: 10_000, perDay: 10_000 },
    );
    expect(service.failed).toBe(1);
    expect(
      await prisma.emailMessage.count({ where: { eventId, status: 'failed' } }),
    ).toBe(0);
    expect(
      await prisma.emailMessage.count({
        where: { eventId, status: 'pending', attempts: { gt: 0 } },
      }),
    ).toBe(0);
    expect(
      await prisma.emailMessage.count({
        where: { eventId, status: 'pending' },
      }),
    ).toBe(beforeService);
    await prisma.emailMessage.updateMany({
      where: { eventId, status: 'pending' },
      data: { nextAttemptAt: new Date(0), lastError: null },
    });

    // Las direcciones de prueba nunca se envían, aunque el correo esté conectado.
    const reserved = await processMailQueue(
      {
        send: async () => {
          throw new Error('no debe intentar enviar');
        },
      },
      { perMinute: 1, perDay: 10_000 },
      { skipReservedDomains: true },
    );
    expect(reserved.skipped + reserved.sent).toBeLessThanOrEqual(1);
    expect(reserved.failed).toBe(0);

    const failing = await processMailQueue(
      {
        send: async () => {
          throw new Error('Microsoft no disponible');
        },
      },
      { perMinute: 10_000, perDay: 10_000 },
    );
    expect(failing.failed).toBeGreaterThan(0);
    const retry = await prisma.emailMessage.findFirstOrThrow({
      where: { eventId, attempts: 1, status: 'pending' },
    });
    expect(retry.lastError).toContain('Microsoft no disponible');
    expect(retry.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.emailMessage.updateMany({
      where: { eventId, status: 'pending' },
      data: { nextAttemptAt: new Date(0) },
    });
    const all: { to: string; email: OutgoingEmail }[] = [];
    const done = await processMailQueue(
      { send: async (to, email) => void all.push({ to, email }) },
      { perMinute: 10_000, perDay: 10_000 },
    );
    expect(done.sent).toBeGreaterThan(0);

    const pending = [...sent, ...all].find(({ email }) =>
      email.subject.startsWith('Registro recibido'),
    );
    expect(pending?.email.html).toContain('&lt;b&gt;de prueba&lt;/b&gt;');
    expect(pending?.email.html).not.toContain('<b>de prueba</b>');

    const passMail = [...sent, ...all].find(({ email }) =>
      email.inlineImages.some((image) => image.contentId === 'pase-qr'),
    );
    expect(passMail?.email.html).toContain('cid:pase-qr');
    expect(
      passMail?.email.inlineImages.find(
        (image) => image.contentId === 'pase-qr',
      )?.contentBase64.length,
    ).toBeGreaterThan(100);

    // Todos llevan el logo incrustado: los correos bloquean imágenes remotas.
    for (const { email } of [...sent, ...all]) {
      expect(email.html).toContain('cid:uka-logo');
      const logo = email.inlineImages.find(
        (image) => image.contentId === 'uka-logo',
      );
      expect(logo?.contentBase64.length).toBeGreaterThan(100);
    }

    const group = [...sent, ...all].find(({ email }) =>
      email.subject.startsWith('Registra a tus invitados'),
    );
    expect(group?.email.html).toContain('/mesa/');

    await prisma.emailMessage.updateMany({
      where: {
        eventId: { not: eventId },
        nextAttemptAt: new Date('2100-01-01T00:00:00.000Z'),
      },
      data: { nextAttemptAt: new Date() },
    });
  });
});

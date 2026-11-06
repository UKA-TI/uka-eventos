import { randomBytes, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';
import { renderEmail } from '../src/modules/mail/templates.js';
import { groupToken, passToken } from '../src/modules/passes/tokens.js';

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
    put: (path: string) =>
      agent.put(path).set('Origin', origin).set('X-CSRF-Token', csrf),
  };
}

describe.skipIf(!process.env.RUN_DB_TESTS)('tables and event views', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let reader: Awaited<ReturnType<typeof login>>;
  let outsider: Awaited<ReturnType<typeof login>>;
  let seriesId = '';
  let eventId = '';
  let tableTicket = '';
  let orderId = '';
  let pointId = '';
  const company = `Soriana ${run}`;

  const groupPath = () => `/api/public/groups/${groupToken(orderId)}`;
  const addGuest = (name: string, extra: object = {}) =>
    request(app)
      .post(`${groupPath()}/guests`)
      .set('Origin', origin)
      .send({
        firstName: name,
        lastName: 'Invitado',
        email: `${name}@${domain}`,
        phone: null,
        organization: null,
        authorized: false,
        ...extra,
      });
  const registrationOf = (name: string) =>
    prisma.registration.findFirstOrThrow({
      where: { eventId, guest: { email: `${name}@${domain}` } },
      include: { passes: true, consents: true },
    });

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'ADMIN' },
    });
    const readerRole = await prisma.role.create({
      data: {
        code: `TBLR_${run}`,
        name: `Lector ${run}`,
        permissions: { create: [{ permission: 'registrations.view' }] },
      },
    });
    const outsiderRole = await prisma.role.create({
      data: {
        code: `TBLX_${run}`,
        name: `Solo evento ${run}`,
        permissions: { create: [{ permission: 'events.view' }] },
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
          email: `reader@${domain}`,
          displayName: 'reader',
          roleId: readerRole.id,
        },
        {
          email: `outsider@${domain}`,
          displayName: 'outsider',
          roleId: outsiderRole.id,
        },
      ],
    });
    admin = await login('admin');
    reader = await login('reader');
    outsider = await login('outsider');

    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: 'Gala' },
    });
    seriesId = series.id;
    const event = await prisma.event.create({
      data: {
        seriesId,
        editionYear: 2030,
        modules: ['publicRegistration', 'checkin'],
        status: 'active',
        slug: `tbl-${run}`,
        name: `Gala ${run}`,
        folioPrefix: 'TBL',
        capacity: 50,
        startsAt: new Date('2030-03-01T02:00:00.000Z'),
      },
    });
    eventId = event.id;
    tableTicket = (
      await prisma.ticketType.create({
        data: { eventId, name: 'Mesa', price: 1000, seatsIncluded: 3 },
      })
    ).id;
    pointId = (
      await prisma.accessPoint.create({
        data: { eventId, name: 'Fila A' },
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
    await prisma.incident.deleteMany({ where: inEvent });
    await prisma.checkin.deleteMany({ where: inEvent });
    await prisma.accessPoint.deleteMany({ where: inEvent });
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
    await prisma.company.deleteMany({ where: { name: { contains: run } } });
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
    await prisma.role.deleteMany({
      where: { code: { in: [`TBLR_${run}`, `TBLX_${run}`] } },
    });
  });

  it('sends the link to the assistant, not to the buyer', async () => {
    const created = await admin
      .post(`/api/events/${eventId}/orders/reconciled`)
      .send({
        firstName: 'Carlos',
        lastName: 'Director',
        email: `ceo@${domain}`,
        phone: null,
        organization: company,
        ticketTypeId: tableTicket,
        quantity: 1,
        amount: 1000,
        method: 'transfer',
        reference: `SPEI-${run}`,
        notes: null,
        paidAt: '2030-01-10T18:00:00.000Z',
        delegateName: 'Laura Asistente',
        delegateEmail: `laura@${domain}`,
        registrationDeadline: '2030-02-01T18:00:00.000Z',
      });
    expect(created.status).toBe(201);
    orderId = created.body.id as string;

    const mail = await prisma.emailMessage.findMany({
      where: { eventId, refId: orderId },
    });
    expect(mail.map(({ toEmail }) => toEmail)).toEqual([`laura@${domain}`]);
    const email = await renderEmail('registration_invite', orderId);
    expect(email?.html).toContain('Laura Asistente');
    expect(email?.html).toContain('Carlos Director');

    const view = await request(app).get(groupPath());
    expect(view.body.delegateName).toBe('Laura Asistente');
    expect(view.body.seats).toBe(3);
  });

  it('the assistant fills seats but never accepts the notice for a guest', async () => {
    const added = await addGuest('mariana', { seatNumber: 2 });
    expect(added.status).toBe(201);
    const registration = await registrationOf('mariana');
    // Consecutivo del evento, igual que cualquier otro folio.
    expect(registration.folio).toMatch(/^TBL\d{2}-\d{4}$/);
    expect(registration.seatNumber).toBe(2);
    expect(registration.consents).toHaveLength(0);
    const pass = registration.passes[0]!;
    expect(pass.status).toBe('pending_activation');

    // Marcar la casilla desde la liga de la asistente no acepta por el invitado.
    expect((await addGuest('andres', { authorized: true })).status).toBe(201);
    const andres = await registrationOf('andres');
    expect(andres.consents).toHaveLength(0);
    expect(andres.seatNumber).toBe(1);

    const mail = await prisma.emailMessage.findMany({
      where: { refId: pass.id },
    });
    expect(mail.map(({ kind }) => kind)).toEqual(['pass_activation']);

    // Sin activar no hay QR, ni en el correo ni en la página.
    const invitation = await renderEmail('pass_activation', pass.id);
    expect(invitation?.subject).toContain('lugar reservado');
    expect(invitation?.inlineImages.map(({ contentId }) => contentId)).toEqual([
      'uka-logo',
    ]);
    expect(await renderEmail('pass', pass.id)).toBeNull();
    const page = await request(app).get(
      `/api/public/passes/${passToken(pass.id)}`,
    );
    expect(page.body.status).toBe('pending_activation');
    expect(page.body.qrDataUrl).toBeNull();
  });

  it('protects seats and one place per email', async () => {
    expect((await addGuest('otro', { seatNumber: 2 })).status).toBe(409);
    expect((await addGuest('fuera', { seatNumber: 9 })).status).toBe(409);
    expect((await addGuest('mariana', { seatNumber: 3 })).status).toBe(409);
    const upper = await addGuest('x', {
      email: `MARIANA@${domain}`,
      seatNumber: 3,
    });
    expect(upper.status).toBe(409);
  });

  it('activates only with the guest’s own acceptance', async () => {
    const { passes } = await registrationOf('mariana');
    const pass = passes[0]!;
    const url = `/api/public/passes/${passToken(pass.id)}/activate`;
    expect(
      (
        await request(app)
          .post(url)
          .set('Origin', origin)
          .send({ privacyAccepted: false, phone: null })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(url)
          .send({ privacyAccepted: true, phone: null })
      ).status,
    ).toBe(403);
    const done = await request(app)
      .post(url)
      .set('Origin', origin)
      .send({ privacyAccepted: true, phone: '5512345678' });
    expect(done.status).toBe(204);
    // Repetir no duplica el consentimiento ni el correo.
    expect(
      (
        await request(app)
          .post(url)
          .set('Origin', origin)
          .send({ privacyAccepted: true, phone: null })
      ).status,
    ).toBe(204);

    const after = await registrationOf('mariana');
    expect(after.consents).toHaveLength(1);
    expect(after.consents[0]?.purpose).toBe('event_registration');
    expect(after.passes[0]?.status).toBe('active');
    const mail = await prisma.emailMessage.findMany({
      where: { refId: pass.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(mail.map(({ kind }) => kind)).toEqual(['pass_activation', 'pass']);
    const page = await request(app).get(
      `/api/public/passes/${passToken(pass.id)}`,
    );
    expect(page.body.qrDataUrl).toContain('data:image/png');
  });

  it('reception sees unactivated guests and admits them only by hand', async () => {
    const list = await admin.get(`/api/events/${eventId}/checkin/offline-list`);
    const entry = list.body.entries.find(
      (item: { guestName: string }) => item.guestName === 'andres Invitado',
    );
    expect(entry.pendingActivation).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain(`@${domain}`);

    const scan = (id: string, manualReason: string | null) =>
      admin.post(`/api/events/${eventId}/checkin/scan`).send({
        clientId: `${id}-${run}`,
        tokenHash: entry.tokenHash,
        accessPointId: pointId,
        scannedAt: new Date().toISOString(),
        manualReason,
      });
    const qr = await scan('qr-sin-activar', null);
    expect(qr.body.status).toBe('pending_activation');
    expect(await prisma.incident.count({ where: { eventId } })).toBe(0);

    const manual = await scan('manual-sin-activar', 'Llegó con su mesa');
    expect(manual.body.status).toBe('ok');
    const andres = await registrationOf('andres');
    expect(andres.passes[0]?.status).toBe('active');
    // Entró a mano: sigue sin haber aceptado el aviso, y eso debe verse.
    expect(andres.consents).toHaveLength(0);

    const again = await scan('otra-vez', null);
    expect(again.body.status).toBe('duplicate');
  });

  it('frees a seat and gives the new guest the next folio', async () => {
    const third = await addGuest('lucia', { seatNumber: 3 });
    expect(third.status).toBe(201);
    const lucia = await registrationOf('lucia');
    const removed = await request(app)
      .delete(`${groupPath()}/guests/${lucia.id}`)
      .set('Origin', origin);
    expect(removed.status).toBe(200);
    expect(
      (
        await prisma.pass.findFirstOrThrow({
          where: { registrationId: lucia.id },
        })
      ).status,
    ).toBe('revoked');

    const replaced = await addGuest('pablo', { seatNumber: 3 });
    expect(replaced.status).toBe(201);
    const pablo = await registrationOf('pablo');
    expect(pablo.seatNumber).toBe(3);
    expect(pablo.folio).not.toBe(lucia.folio);

    const resend = await request(app)
      .post(
        `${groupPath()}/guests/${(await registrationOf('pablo')).id}/resend`,
      )
      .set('Origin', origin);
    expect(resend.status).toBe(202);
    expect(
      (
        await request(app)
          .post(`${groupPath()}/guests/${lucia.id}/resend`)
          .set('Origin', origin)
      ).status,
    ).toBe(404);
  });

  it('the dashboard counts arrivals, seats and incidents', async () => {
    // Un pase revocado que se intenta usar abre otra incidencia, además de la
    // lectura repetida de la prueba de recepción.
    const lucia = await registrationOf('lucia');
    await admin.post(`/api/events/${eventId}/checkin/scan`).send({
      clientId: `revocado-${run}`,
      tokenHash: createHash('sha256')
        .update(passToken(lucia.passes[0]!.id))
        .digest('hex'),
      accessPointId: pointId,
      scannedAt: new Date().toISOString(),
      manualReason: null,
    });

    const response = await admin.get(`/api/events/${eventId}/dashboard`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      capacity: 50,
      seatsSold: 3,
      seatsToRegister: 0,
      registered: 3,
      pendingActivation: 1,
      checkedIn: 1,
      lastPeriodCheckins: 1,
      pendingArrival: 2,
      incidentsOpen: 2,
      incidentsResolved: 0,
      bucketMinutes: 15,
    });
    expect(response.body.timeline).toHaveLength(1);
    expect(response.body.timeline[0].count).toBe(1);
    expect(response.body.accessPoints).toEqual([
      expect.objectContaining({ name: 'Fila A', count: 1 }),
    ]);
    expect(
      (await outsider.get(`/api/events/${eventId}/dashboard`)).status,
    ).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(`@${domain}`);
  });

  it('lists guests with status, table and operator', async () => {
    const response = await admin.get(`/api/events/${eventId}/guests`);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
    const byEmail = (name: string) =>
      response.body.guests.find(
        (guest: { email: string }) => guest.email === `${name}@${domain}`,
      );
    // Ingresó, pero su lectura repetida sigue abierta: debe verse como incidencia.
    expect(byEmail('andres')).toMatchObject({
      status: 'incident',
      group: company,
      operatorName: 'admin',
      accessPointName: 'Fila A',
    });
    expect(byEmail('mariana').status).toBe('pending');
    expect(byEmail('pablo').status).toBe('activation');
    expect(byEmail('lucia')).toBeUndefined();

    const count = async (query: string) =>
      (await admin.get(`/api/events/${eventId}/guests?${query}`)).body.total;
    expect(await count('status=checked_in')).toBe(1);
    expect(await count('status=pending')).toBe(1);
    expect(await count('status=activation')).toBe(1);
    expect(await count('q=mariana')).toBe(1);
    expect(await count(`orderId=${orderId}`)).toBe(3);
    expect(await count('orderId=otro')).toBe(0);

    expect((await reader.get(`/api/events/${eventId}/guests`)).status).toBe(
      200,
    );
    expect((await outsider.get(`/api/events/${eventId}/guests`)).status).toBe(
      403,
    );
  });

  it('lists tables and hides the link from read-only profiles', async () => {
    const response = await admin.get(`/api/events/${eventId}/groups`);
    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      company,
      delegateName: 'Laura Asistente',
      seats: 3,
      registered: 3,
      activated: 2,
    });
    expect(response.body[0].groupUrl).toContain('/mesa/');

    const readOnly = await reader.get(`/api/events/${eventId}/groups`);
    expect(readOnly.body[0].groupUrl).toBeNull();

    const changed = await admin
      .put(`/api/events/${eventId}/orders/${orderId}/delegate`)
      .send({
        delegateName: 'Ana Nueva',
        delegateEmail: `ana.nueva@${domain}`,
        registrationDeadline: null,
      });
    expect(changed.status).toBe(204);
    const mail = await prisma.emailMessage.findMany({
      where: { eventId, refId: orderId },
    });
    expect(mail.map(({ toEmail }) => toEmail)).toContain(`ana.nueva@${domain}`);
    expect(
      (
        await reader
          .put(`/api/events/${eventId}/orders/${orderId}/delegate`)
          .send({})
      ).status,
    ).toBe(403);
  });
});

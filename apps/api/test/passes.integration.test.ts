import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';
import { queueEventReminders } from '../src/modules/mail/reminders.js';
import { renderEmail } from '../src/modules/mail/templates.js';
import { passToken } from '../src/modules/passes/tokens.js';

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

const binary = (
  res: request.Response,
  callback: (error: Error | null, body: unknown) => void,
) => {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe.skipIf(!process.env.RUN_DB_TESTS)('pass tools and consent', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let reader: Awaited<ReturnType<typeof login>>;
  let seriesId = '';
  let eventId = '';
  let soonId = '';
  let ticket = '';
  let soonTicket = '';
  let pointId = '';
  const slug = `pas-${run}`;
  const eventIds = () => [eventId, soonId];

  const register = (name: string, extra: object = {}, on = slug) =>
    request(app)
      .post(`/api/public/events/${on}/register`)
      .set('Origin', origin)
      .send({
        firstName: name,
        lastName: 'Ñandú Prueba',
        email: `${name}@${domain}`,
        phone: '5512345678',
        organization: null,
        ticketTypeId: on === slug ? ticket : soonTicket,
        answers: {},
        privacyAccepted: true,
        ...extra,
      });
  const passOf = (name: string, on = eventId) =>
    prisma.pass.findFirstOrThrow({
      where: {
        registration: { eventId: on, guest: { email: `${name}@${domain}` } },
      },
    });
  const contactOf = (name: string) =>
    prisma.contact.findUniqueOrThrow({
      where: { email: `${name}@${domain}` },
    });

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'ADMIN' },
    });
    const readerRole = await prisma.role.create({
      data: {
        code: `PASR_${run}`,
        name: `Lector ${run}`,
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
      ],
    });
    admin = await login('admin');
    reader = await login('reader');
    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: 'Gala' },
    });
    seriesId = series.id;
    const base = {
      seriesId,
      editionYear: 2030,
      modules: ['publicRegistration', 'checkin'],
      status: 'active',
      venue: 'Jardín Santa Fe',
    };
    const event = await prisma.event.create({
      data: {
        ...base,
        slug,
        name: `Gala, ${run}; 40 años`,
        folioPrefix: 'PAS',
        capacity: 2,
        startsAt: new Date('2030-03-01T00:30:00.000Z'),
        programStartsAt: new Date('2030-03-01T01:00:00.000Z'),
        mapUrl: 'https://maps.example.com/gala?a=1&b=2',
      },
    });
    eventId = event.id;
    const soon = await prisma.event.create({
      data: {
        ...base,
        slug: `pron-${run}`,
        name: `Pronto ${run}`,
        folioPrefix: 'PRO',
        startsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });
    soonId = soon.id;
    ticket = (
      await prisma.ticketType.create({
        data: { eventId, name: 'Gratis', price: 0 },
      })
    ).id;
    soonTicket = (
      await prisma.ticketType.create({
        data: { eventId: soonId, name: 'Gratis', price: 0 },
      })
    ).id;
    pointId = (
      await prisma.accessPoint.create({ data: { eventId, name: 'Fila A' } })
    ).id;
  });

  afterAll(async () => {
    const inEvents = { eventId: { in: eventIds() } };
    const registrations = await prisma.registration.findMany({
      where: inEvents,
      select: { id: true },
    });
    const ids = registrations.map(({ id }) => id);
    await prisma.emailMessage.deleteMany({ where: inEvents });
    await prisma.consent.deleteMany({ where: { registrationId: { in: ids } } });
    await prisma.checkin.deleteMany({ where: inEvents });
    await prisma.accessPoint.deleteMany({ where: inEvents });
    await prisma.pass.deleteMany({ where: { registrationId: { in: ids } } });
    await prisma.registration.deleteMany({ where: inEvents });
    await prisma.order.deleteMany({ where: inEvents });
    await prisma.guest.deleteMany({
      where: {
        OR: [
          { email: { endsWith: domain } },
          { firstName: { contains: `Sinmail${run}` } },
        ],
      },
    });
    await prisma.contact.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.company.deleteMany({ where: { name: { contains: run } } });
    await prisma.ticketType.deleteMany({ where: inEvents });
    await prisma.eventCounter.deleteMany({ where: inEvents });
    await prisma.auditLog.deleteMany({
      where: { OR: [inEvents, { user: { email: { endsWith: domain } } }] },
    });
    await prisma.event.deleteMany({ where: { id: { in: eventIds() } } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
    await prisma.authSession.deleteMany({
      where: { user: { email: { endsWith: domain } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.role.deleteMany({ where: { code: `PASR_${run}` } });
  });

  it('asks for marketing permission apart from the event', async () => {
    expect((await register('sinpermiso')).status).toBe(201);
    const without = await contactOf('sinpermiso');
    expect(without.marketingConsentAt).toBeNull();

    expect(
      (await register('conpermiso', { marketingConsent: true })).status,
    ).toBe(201);
    const withIt = await contactOf('conpermiso');
    expect(withIt.marketingConsentAt).not.toBeNull();
    expect(withIt.marketingConsentSource).toBe('registration');
    expect(withIt.marketingNoticeVersion).toBeTruthy();

    // Solo a quien dio permiso le llegaría una comunicación.
    const reachable = await admin.get(
      `/api/contacts?reachable=true&eventId=${eventId}`,
    );
    const emails = reachable.body.contacts.map(
      (contact: { email: string }) => contact.email,
    );
    expect(emails).toEqual([`conpermiso@${domain}`]);

    // Una casilla en un formulario público no revierte una baja: el correo no está
    // verificado y cualquiera podría escribir una dirección ajena.
    await prisma.contact.update({
      where: { id: withIt.id },
      data: { marketingConsentAt: null, optedOutAt: new Date() },
    });
    expect(
      (await register('conpermiso', { marketingConsent: true }, `pron-${run}`))
        .status,
    ).toBe(201);
    expect((await contactOf('conpermiso')).marketingConsentAt).toBeNull();

    // Registrarlo a mano queda en la bitácora y sí levanta la baja.
    const manual = await admin.post(`/api/contacts/${withIt.id}/opt-in`);
    expect(manual.status).toBe(204);
    const after = await contactOf('conpermiso');
    expect(after.optedOutAt).toBeNull();
    expect(after.marketingConsentSource).toBe('staff');
  });

  it('offers PDF, calendar and map on the page and in the email', async () => {
    const pass = await passOf('sinpermiso');
    const token = passToken(pass.id);

    const page = await request(app).get(`/api/public/passes/${token}`);
    expect(page.body.mapUrl).toContain('maps.example.com');
    expect(page.body.programStartsAt).toBe('2030-03-01T01:00:00.000Z');
    expect(page.body.calendar.google).toContain('calendar.google.com');
    expect(page.body.calendar.google).toContain('20300301T003000Z');
    expect(page.body.calendar.outlook).toContain('outlook.live.com');

    const pdf = await request(app)
      .get(`/api/public/passes/${token}/pass.pdf`)
      .buffer(true)
      .parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('.pdf');
    const body = pdf.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    const document = await PDFDocument.load(body);
    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toContain('Pase');

    const ics = await request(app).get(`/api/public/passes/${token}/event.ics`);
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect(ics.text).toContain('DTSTART:20300301T003000Z');
    expect(ics.text).toContain('LOCATION:Jardín Santa Fe');
    // Los signos reservados de un .ics van escapados.
    expect(ics.text).toContain(`Gala\\, ${run}\\; 40 años`);
    expect(ics.text.split('\r\n').every((line) => line.length <= 62)).toBe(
      true,
    );

    const email = await renderEmail('pass', pass.id);
    expect(email?.html).toContain('pass.pdf');
    expect(email?.html).toContain('event.ics');
    expect(email?.html).toContain('calendar.google.com');
    expect(email?.html).toContain('outlook.live.com');
    expect(email?.html).toContain('Programa');
    // El & de una liga debe ir escapado dentro del correo.
    expect(email?.html).toContain('gala?a=1&amp;b=2');
  });

  it('gives no files for a revoked or unknown pass', async () => {
    const pass = await passOf('sinpermiso');
    await prisma.pass.update({
      where: { id: pass.id },
      data: { status: 'revoked' },
    });
    const token = passToken(pass.id);
    expect(
      (await request(app).get(`/api/public/passes/${token}/pass.pdf`)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/public/passes/${token}/event.ics`)).status,
    ).toBe(404);
    expect(
      (await request(app).get('/api/public/passes/inventado/pass.pdf')).status,
    ).toBe(404);
    await prisma.pass.update({
      where: { id: pass.id },
      data: { status: 'active' },
    });
  });

  it('recovers a pass without revealing who is registered', async () => {
    const recover = (email: string) =>
      request(app)
        .post(`/api/public/events/${slug}/recover-pass`)
        .set('Origin', origin)
        .send({ email });
    const own = await passOf('sinpermiso');
    await prisma.emailMessage.deleteMany({ where: { refId: own.id } });

    const known = await recover(`sinpermiso@${domain}`);
    const unknown = await recover(`nadie@${domain}`);
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(
      await prisma.emailMessage.count({
        where: { toEmail: `nadie@${domain}` },
      }),
    ).toBe(0);
    const sent = await prisma.emailMessage.findMany({
      where: { refId: own.id },
    });
    expect(sent.map(({ toEmail }) => toEmail)).toEqual([
      `sinpermiso@${domain}`,
    ]);

    // Repetirlo no le llena el correo a nadie.
    expect((await recover(`sinpermiso@${domain}`)).status).toBe(202);
    expect(await prisma.emailMessage.count({ where: { refId: own.id } })).toBe(
      1,
    );
    expect(
      (
        await request(app)
          .post(`/api/public/events/${slug}/recover-pass`)
          .send({ email: `sinpermiso@${domain}` })
      ).status,
    ).toBe(403);
  });

  it('reminds once, only events about to start, skipping who already came', async () => {
    await register('pronto', {}, `pron-${run}`);
    const entered = await register('yaentro', {}, `pron-${run}`);
    expect(entered.status).toBe(201);
    const inside = await passOf('yaentro', soonId);
    const door = await prisma.accessPoint.create({
      data: { eventId: soonId, name: 'Puerta' },
    });
    await prisma.checkin.create({
      data: { eventId: soonId, passId: inside.id, accessPointId: door.id },
    });

    await queueEventReminders();
    const first = await prisma.emailMessage.findMany({
      where: { eventId: soonId, kind: 'event_reminder' },
    });
    const recipients = first.map(({ toEmail }) => toEmail);
    expect(recipients).toContain(`pronto@${domain}`);
    expect(recipients).not.toContain(`yaentro@${domain}`);

    await queueEventReminders();
    expect(
      await prisma.emailMessage.count({
        where: { eventId: soonId, kind: 'event_reminder' },
      }),
    ).toBe(first.length);
    expect(
      await prisma.emailMessage.count({
        where: { eventId, kind: 'event_reminder' },
      }),
    ).toBe(0);

    const pass = await passOf('pronto', soonId);
    const email = await renderEmail('event_reminder', pass.id);
    expect(email?.subject).toContain('Te esperamos');
    expect(email?.html).toContain('event.ics');
    expect(email?.html).toContain('cid:uka-logo');
    // Si entra antes de que salga el correo, ya no aplica.
    expect(await renderEmail('event_reminder', inside.id)).toBeNull();
  });

  it('registers an authorized guest, over capacity, with a reason', async () => {
    const before = await prisma.order.aggregate({
      where: { eventId, status: { not: 'cancelled' } },
      _sum: { seats: true },
    });
    expect(before._sum.seats).toBeGreaterThanOrEqual(2);
    expect((await register('lleno')).status).toBe(409);

    const body = {
      firstName: 'Invitada',
      lastName: 'Directora',
      email: `invitada@${domain}`,
      phone: null,
      organization: `Fundación ${run}`,
      ticketTypeId: ticket,
      reason: 'Invitada de Dirección, autoriza Ana',
      accessPointId: pointId,
    };
    expect(
      (
        await reader
          .post(`/api/events/${eventId}/checkin/authorized`)
          .send(body)
      ).status,
    ).toBe(403);
    expect(
      (
        await admin
          .post(`/api/events/${eventId}/checkin/authorized`)
          .send({ ...body, reason: '' })
      ).status,
    ).toBe(400);

    const created = await admin
      .post(`/api/events/${eventId}/checkin/authorized`)
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.admitted).toBe(true);
    expect(created.body.folio).toMatch(/^PAS\d{2}-\d{4}$/);

    const pass = await passOf('invitada');
    expect(pass.status).toBe('active');
    const checkin = await prisma.checkin.findUniqueOrThrow({
      where: { passId: pass.id },
    });
    expect(checkin.manualReason).toContain('Alta autorizada');
    const order = await prisma.order.findFirstOrThrow({
      where: { eventId, source: 'authorized' },
      include: { payments: true },
    });
    expect(order.notes).toBe(body.reason);
    expect(order.amountDue.toNumber()).toBe(0);
    expect(
      await prisma.emailMessage.count({
        where: { refId: pass.id, kind: 'pass' },
      }),
    ).toBe(1);
    const audit = await prisma.auditLog.count({
      where: { eventId, action: 'order.authorized' },
    });
    expect(audit).toBe(1);

    // El mismo correo no entra dos veces, y sin correo también se puede.
    expect(
      (await admin.post(`/api/events/${eventId}/checkin/authorized`).send(body))
        .status,
    ).toBe(409);
    const noEmail = await admin
      .post(`/api/events/${eventId}/checkin/authorized`)
      .send({
        ...body,
        firstName: `Sinmail${run}`,
        email: null,
        accessPointId: null,
      });
    expect(noEmail.status).toBe(201);
    expect(noEmail.body.admitted).toBe(false);
  });

  it('keeps consecutive folios for everyone', async () => {
    const registrations = await prisma.registration.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      select: { folio: true },
    });
    const numbers = registrations.map(({ folio }) =>
      Number(folio.split('-')[1]),
    );
    expect(registrations.every(({ folio }) => folio.startsWith('PAS'))).toBe(
      true,
    );
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });
});

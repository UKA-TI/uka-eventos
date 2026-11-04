import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';
import { processMailQueue } from '../src/modules/mail/queue.js';
import type { OutgoingEmail } from '../src/modules/mail/templates.js';
import { unsubscribeToken } from '../src/modules/passes/tokens.js';

/** Flujo real contra MariaDB (no corre en CI): npm run test:db-integration */
const run = randomBytes(4).toString('hex');
const domain = `${run}.uka.test`;
const origin = 'http://localhost:5173';
const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

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
  const withCsrf = <T extends request.Test>(test: T) =>
    test.set('Origin', origin).set('X-CSRF-Token', csrf);
  return {
    agent,
    get: (path: string) => agent.get(path),
    post: (path: string) => withCsrf(agent.post(path)),
    put: (path: string) => withCsrf(agent.put(path)),
    del: (path: string) => withCsrf(agent.delete(path)),
  };
}

const register = (slug: string, name: string, overrides: object = {}) =>
  request(app)
    .post(`/api/public/events/${slug}/register`)
    .set('Origin', origin)
    .send({
      firstName: name,
      lastName: 'Prueba',
      email: `${name}@${domain}`,
      phone: '5512345678',
      organization: null,
      answers: {},
      privacyAccepted: true,
      ...overrides,
    });

/** Solo se procesa lo de esta prueba: el resto de la cola queda en espera. */
async function holdOtherMail() {
  await prisma.emailMessage.updateMany({
    where: { status: 'pending', NOT: { toEmail: { endsWith: `@${domain}` } } },
    data: { nextAttemptAt: FAR_FUTURE },
  });
}

async function drain(
  limits = { perMinute: 10_000, perDay: 1_000_000 },
): Promise<{ to: string; email: OutgoingEmail }[]> {
  // Si el servidor de desarrollo está encendido, su cola omite estas direcciones de
  // prueba por seguridad. Se devuelven a la cola para procesarlas aquí.
  await prisma.emailMessage.updateMany({
    where: {
      toEmail: { endsWith: `@${domain}` },
      OR: [{ status: 'pending' }, { lastError: 'Dirección de prueba' }],
    },
    data: { status: 'pending', lastError: null, nextAttemptAt: new Date(0) },
  });
  const sent: { to: string; email: OutgoingEmail }[] = [];
  await processMailQueue(
    { send: async (to, email) => void sent.push({ to, email }) },
    limits,
  );
  return sent;
}

describe.skipIf(!process.env.RUN_DB_TESTS)('CRM', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let viewer: Awaited<ReturnType<typeof login>>;
  let writer: Awaited<ReturnType<typeof login>>;
  let seriesId = '';
  let eventId = '';
  let otherEventId = '';
  let paidTicket = '';
  let tableTicket = '';
  const slug = `crm-${run}`;
  const otherSlug = `crm2-${run}`;

  const contactByEmail = (name: string) =>
    prisma.contact.findUniqueOrThrow({
      where: { email: `${name}@${domain}` },
      include: { company: true, guests: true },
    });

  const listEmails = async (query: string) => {
    const response = await admin.get(`/api/contacts?${query}`);
    expect(response.status).toBe(200);
    return (response.body.contacts as { email: string | null }[])
      .map(({ email }) => email?.split('@')[0])
      .sort();
  };

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'ADMIN' },
    });
    const viewerRole = await prisma.role.create({
      data: {
        code: `CRMV_${run}`,
        name: `Lector ${run}`,
        permissions: {
          create: [
            { permission: 'contacts.view' },
            { permission: 'communications.view' },
          ],
        },
      },
    });
    const writerRole = await prisma.role.create({
      data: {
        code: `CRMW_${run}`,
        name: `Redactor ${run}`,
        permissions: { create: [{ permission: 'communications.manage' }] },
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
          email: `viewer@${domain}`,
          displayName: 'viewer',
          roleId: viewerRole.id,
        },
        {
          email: `writer@${domain}`,
          displayName: 'writer',
          roleId: writerRole.id,
        },
      ],
    });
    admin = await login('admin');
    viewer = await login('viewer');
    writer = await login('writer');

    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: `Tipo ${run}` },
    });
    seriesId = series.id;
    const base = {
      seriesId,
      modules: ['publicRegistration', 'corporate'],
      status: 'active',
      startsAt: new Date('2030-03-01T02:00:00.000Z'),
      paymentInstructions: 'Transferencia',
    };
    const event = await prisma.event.create({
      data: {
        ...base,
        editionYear: 2030,
        slug,
        name: `Evento <b>${run}</b>`,
        folioPrefix: 'CRA',
        venue: 'Sede',
      },
    });
    eventId = event.id;
    const other = await prisma.event.create({
      data: {
        ...base,
        editionYear: 2031,
        slug: otherSlug,
        name: `Otro ${run}`,
        folioPrefix: 'CRB',
      },
    });
    otherEventId = other.id;
    const free = await prisma.ticketType.create({
      data: { eventId, name: 'Gratis', price: 0 },
    });
    paidTicket = free.id;
    const table = await prisma.ticketType.create({
      data: { eventId, name: 'Mesa', price: 0, seatsIncluded: 4 },
    });
    tableTicket = table.id;
    await prisma.ticketType.create({
      data: { id: `tk${run}`, eventId: otherEventId, name: 'Gratis', price: 0 },
    });
    await holdOtherMail();
  });

  afterAll(async () => {
    const eventIds = [eventId, otherEventId];
    const inEvents = { eventId: { in: eventIds } };
    const registrations = await prisma.registration.findMany({
      where: inEvents,
      select: { id: true },
    });
    const registrationIds = registrations.map(({ id }) => id);
    await prisma.emailMessage.updateMany({
      where: {
        nextAttemptAt: FAR_FUTURE,
        NOT: { toEmail: { endsWith: domain } },
      },
      data: { nextAttemptAt: new Date() },
    });
    await prisma.emailMessage.deleteMany({
      where: { toEmail: { endsWith: `@${domain}` } },
    });
    await prisma.donation.deleteMany({
      where: { OR: [inEvents, { contact: { email: { endsWith: domain } } }] },
    });
    await prisma.campaign.deleteMany({ where: { name: { contains: run } } });
    await prisma.segment.deleteMany({ where: { name: { contains: run } } });
    await prisma.consent.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    await prisma.checkin.deleteMany({ where: inEvents });
    await prisma.accessPoint.deleteMany({ where: inEvents });
    await prisma.pass.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    await prisma.registration.deleteMany({ where: inEvents });
    await prisma.order.deleteMany({ where: inEvents });
    await prisma.guest.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.contact.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.company.deleteMany({ where: { name: { contains: run } } });
    await prisma.ticketType.deleteMany({ where: inEvents });
    await prisma.eventCounter.deleteMany({ where: inEvents });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [inEvents, { user: { email: { endsWith: domain } } }],
      },
    });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
    await prisma.authSession.deleteMany({
      where: { user: { email: { endsWith: domain } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.role.deleteMany({
      where: { code: { in: [`CRMV_${run}`, `CRMW_${run}`] } },
    });
  });

  it('joins registrations of the same email in one contact without overwriting data', async () => {
    const company = `Empresa ${run}`;
    const first = await register(slug, 'ana', {
      ticketTypeId: paidTicket,
      organization: company,
      phone: '5511111111',
    });
    expect(first.status).toBe(201);

    const contact = await contactByEmail('ana');
    expect(contact.source).toBe('registration');
    expect(contact.company?.name).toBe(company);

    // El equipo corrige el nombre; un registro posterior no debe pisarlo.
    const edit = await admin.put(`/api/contacts/${contact.id}`).send({
      firstName: 'Ana María',
      lastName: 'Prueba',
      email: contact.email,
      phone: contact.phone,
      position: 'Directora',
      companyId: contact.companyId,
    });
    expect(edit.status).toBe(200);

    const second = await register(otherSlug, 'ana', {
      ticketTypeId: `tk${run}`,
      firstName: 'Impostora',
      email: `ANA@${domain}`,
      phone: '5599999999',
      organization: company.toUpperCase(),
    });
    expect(second.status).toBe(201);

    const after = await contactByEmail('ana');
    expect(after.id).toBe(contact.id);
    expect(after.firstName).toBe('Ana María');
    expect(after.phone).toBe('5511111111');
    expect(after.guests).toHaveLength(2);
    expect(
      await prisma.company.count({ where: { name: { contains: run } } }),
    ).toBe(1);

    const detail = await admin.get(`/api/contacts/${contact.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.history).toHaveLength(2);
    expect(detail.body.participations).toBe(2);
  });

  it('counts the buyer of a table and filters by participation', async () => {
    expect(
      (await register(slug, 'beto', { ticketTypeId: paidTicket })).status,
    ).toBe(201);
    expect(
      (await register(slug, 'mesa', { ticketTypeId: tableTicket })).status,
    ).toBe(201);
    expect(
      (await register(otherSlug, 'caro', { ticketTypeId: `tk${run}` })).status,
    ).toBe(201);

    // Beto asiste al evento principal.
    const registration = await prisma.registration.findFirstOrThrow({
      where: { eventId, guest: { email: `beto@${domain}` } },
      include: { passes: true },
    });
    const point = await prisma.accessPoint.create({
      data: { eventId, name: `Puerta ${run}` },
    });
    await prisma.checkin.create({
      data: {
        eventId,
        passId: registration.passes[0]!.id,
        accessPointId: point.id,
      },
    });

    expect(await listEmails(`eventId=${eventId}`)).toEqual([
      'ana',
      'beto',
      'mesa',
    ]);
    expect(
      await listEmails(`eventId=${eventId}&participation=attended`),
    ).toEqual(['beto']);
    expect(
      await listEmails(`eventId=${eventId}&participation=not_attended`),
    ).toEqual(['ana', 'mesa']);
    expect(await listEmails(`seriesId=${seriesId}&editionYear=2031`)).toEqual([
      'ana',
      'caro',
    ]);

    const detail = await admin.get(
      `/api/contacts/${(await contactByEmail('mesa')).id}`,
    );
    expect(detail.body.history[0].role).toBe('buyer');
  });

  it('enforces permissions on contacts, communications and donations', async () => {
    const contact = await contactByEmail('beto');
    expect((await viewer.get('/api/contacts')).status).toBe(200);
    expect(
      (
        await viewer.put(`/api/contacts/${contact.id}`).send({
          firstName: 'X',
          lastName: 'Y',
          email: null,
          phone: null,
          position: null,
          companyId: null,
        })
      ).status,
    ).toBe(403);
    expect((await viewer.get('/api/donations')).status).toBe(403);
    expect((await writer.get('/api/contacts')).status).toBe(403);

    const noCsrf = await admin.agent
      .post(`/api/contacts/${contact.id}/opt-out`)
      .set('Origin', origin);
    expect(noCsrf.status).toBe(403);

    // Sin permiso de donativos, la ficha no los muestra.
    await admin.post('/api/donations').send({
      contactId: contact.id,
      companyId: null,
      eventId,
      amount: 500,
      method: 'cash',
      reference: null,
      notes: null,
      receivedAt: '2030-01-10T18:00:00.000Z',
    });
    const seen = await viewer.get(`/api/contacts/${contact.id}`);
    expect(seen.body.donations).toEqual([]);
  });

  it('keeps donations auditable and blocks deleting a donor', async () => {
    const contact = await contactByEmail('beto');
    const created = await admin.post('/api/donations').send({
      contactId: contact.id,
      companyId: null,
      eventId: otherEventId,
      amount: 1000.5,
      method: 'in_kind',
      reference: 'REF',
      notes: null,
      receivedAt: '2031-01-10T18:00:00.000Z',
    });
    expect(created.status).toBe(201);

    const total = await admin.get(`/api/donations?eventId=${otherEventId}`);
    expect(total.body.totalAmount).toBe(1000.5);

    const voided = await admin
      .post(`/api/donations/${created.body.id}/void`)
      .send({ reason: 'Capturado por error' });
    expect(voided.status).toBe(204);
    expect(
      (
        await admin
          .post(`/api/donations/${created.body.id}/void`)
          .send({ reason: 'Capturado por error' })
      ).status,
    ).toBe(409);

    const after = await admin.get(`/api/donations?eventId=${otherEventId}`);
    expect(after.body.totalAmount).toBe(0);
    expect(after.body.donations).toHaveLength(1);

    expect(await listEmails(`donor=true&eventId=${eventId}`)).toEqual(['beto']);
    expect((await admin.del(`/api/contacts/${contact.id}`)).status).toBe(409);
  });

  it('sends a campaign once, to the right people, and honors an unsubscribe', async () => {
    const segment = await admin.post('/api/segments').send({
      name: `Segmento ${run}`,
      description: null,
      filters: { eventId },
    });
    expect(segment.status).toBe(201);
    expect(segment.body.contacts).toBe(3);

    // Uno ya pidió la baja antes del envío y otro la pedirá con el mensaje en cola.
    const ana = await contactByEmail('ana');
    const beto = await contactByEmail('beto');
    const mesa = await contactByEmail('mesa');
    expect((await admin.post(`/api/contacts/${mesa.id}/opt-out`)).status).toBe(
      204,
    );
    await prisma.contact.update({
      where: { id: ana.id },
      data: { firstName: '<img src=x>' },
    });

    const invalid = await writer.post('/api/campaigns').send({
      name: `Invalida ${run}`,
      subject: 'Hola {{nombr}}',
      body: 'Texto',
      eventId,
      segmentId: segment.body.id,
    });
    expect(invalid.status).toBe(400);

    const draft = await writer.post('/api/campaigns').send({
      name: `Campaña ${run}`,
      subject: 'Hola {{nombre}}',
      body: 'Te invitamos a {{evento}} en {{sede}}.\n\nVisita https://www.unkilodeayuda.org.mx',
      eventId,
      segmentId: segment.body.id,
    });
    expect(draft.status).toBe(201);
    expect(draft.body.audience).toBe(2);
    const campaignId = draft.body.id as string;

    // Redactar no da permiso de enviar.
    expect(
      (await writer.post(`/api/campaigns/${campaignId}/send`)).status,
    ).toBe(403);

    const test = await writer.post(`/api/campaigns/${campaignId}/test`);
    expect(test.status).toBe(202);
    expect(test.body.toEmail).toBe(`writer@${domain}`);

    const preview = await viewer.get(`/api/campaigns/${campaignId}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.html).not.toContain('cid:');

    const sent = await admin.post(`/api/campaigns/${campaignId}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.audience).toBe(2);
    expect((await admin.post(`/api/campaigns/${campaignId}/send`)).status).toBe(
      409,
    );

    const messages = await prisma.emailMessage.findMany({
      where: { campaignId, kind: 'campaign' },
    });
    expect(messages.map(({ toEmail }) => toEmail).sort()).toEqual([
      `ana@${domain}`,
      `beto@${domain}`,
    ]);
    // Las campañas no ensucian el resumen de correos del evento.
    expect(messages.every(({ eventId: id }) => id === null)).toBe(true);
    expect(messages.every(({ priority }) => priority > 0)).toBe(true);
    await prisma.emailMessage.updateMany({
      where: { campaignId },
      data: { nextAttemptAt: FAR_FUTURE },
    });

    // Beto se da de baja con la liga: un GET no basta, hace falta confirmar.
    const token = unsubscribeToken(beto.id);
    expect(
      (await request(app).get(`/api/public/unsubscribe/x.${token}`)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/public/unsubscribe/${beto.id}.malo`))
        .status,
    ).toBe(404);
    const page = await request(app).get(`/api/public/unsubscribe/${token}`);
    expect(page.status).toBe(200);
    expect(page.body.email).toBe(`be***@${domain}`);
    expect(page.body.optedOut).toBe(false);
    expect((await contactByEmail('beto')).optedOutAt).toBeNull();
    expect(
      (await request(app).post(`/api/public/unsubscribe/${token}`)).status,
    ).toBe(403);
    const done = await request(app)
      .post(`/api/public/unsubscribe/${token}`)
      .set('Origin', origin);
    expect(done.status).toBe(200);
    expect(done.body.optedOut).toBe(true);
    expect((await contactByEmail('beto')).optOutSource).toBe('link');

    // Volver a registrarse no revierte la baja, pero el pase sí se entrega.
    const again = await register(otherSlug, 'beto', {
      ticketTypeId: `tk${run}`,
    });
    expect(again.status).toBe(201);
    expect((await contactByEmail('beto')).optedOutAt).not.toBeNull();

    const delivered = await drain();
    const toBeto = delivered.filter(({ to }) => to === `beto@${domain}`);
    expect(toBeto.length).toBeGreaterThan(0);
    expect(toBeto.every(({ email }) => !email.subject.startsWith('Hola'))).toBe(
      true,
    );

    const toAna = delivered.find(
      ({ to, email }) =>
        to === `ana@${domain}` && email.subject.startsWith('Hola'),
    );
    expect(toAna).toBeDefined();
    const html = toAna!.email.html;
    // Los datos de la persona y del evento no pueden inyectar HTML.
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('Sede');
    expect(html).toContain(`/baja/${ana.id}.`);
    expect(html).toContain(`/r/${slug}`);
    expect(html).toContain('href="https://www.unkilodeayuda.org.mx"');
    expect(html).toContain('cid:uka-logo');

    const testMail = delivered.find(({ to }) => to === `writer@${domain}`);
    expect(testMail?.email.subject).toMatch(/^\[Prueba\] /);
    expect(testMail?.email.html).not.toContain('/baja/');

    const final = await admin.get(`/api/campaigns/${campaignId}`);
    expect(final.body.stats).toEqual({
      pending: 0,
      sent: 1,
      failed: 0,
      skipped: 1,
    });
    expect(
      (await admin.put(`/api/campaigns/${campaignId}`).send(draft.body)).status,
    ).not.toBe(200);
  });

  it('lets passes through first and keeps a daily reserve for them', async () => {
    await prisma.contact.updateMany({
      where: { email: { endsWith: `@${domain}` } },
      data: { optedOutAt: null, optOutSource: null },
    });
    const draft = await admin.post('/api/campaigns').send({
      name: `Masiva ${run}`,
      subject: 'Aviso masivo',
      body: 'Texto',
      eventId: null,
      segmentId: (
        await admin.post('/api/segments').send({
          name: `Todos ${run}`,
          description: null,
          filters: { eventId },
        })
      ).body.id,
    });
    const campaignId = draft.body.id as string;
    expect((await admin.post(`/api/campaigns/${campaignId}/send`)).status).toBe(
      200,
    );

    const newcomer = await register(slug, 'dani', { ticketTypeId: paidTicket });
    expect(newcomer.status).toBe(201);

    const lastDay = await prisma.emailMessage.count({
      where: { sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    // Límite casi agotado: entra dentro de la reserva, las campañas esperan.
    const reserved = await drain({ perMinute: 10_000, perDay: lastDay + 1 });
    expect(reserved).toHaveLength(1);
    expect(reserved[0]?.to).toBe(`dani@${domain}`);
    expect(reserved[0]?.email.subject).not.toBe('Aviso masivo');
    expect(
      await prisma.emailMessage.count({
        where: { campaignId, status: 'sent' },
      }),
    ).toBe(0);

    const cancelled = await admin.post(`/api/campaigns/${campaignId}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.stats.pending).toBe(0);
    expect(cancelled.body.stats.skipped).toBeGreaterThan(0);
    expect(
      (await drain()).some(({ email }) => email.subject === 'Aviso masivo'),
    ).toBe(false);

    const duplicate = await admin.post(
      `/api/campaigns/${campaignId}/duplicate`,
    );
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.status).toBe('draft');
  });

  it('protects segments in use and manual contacts can be deleted', async () => {
    const segment = await admin.post('/api/segments').send({
      name: `Protegido ${run}`,
      description: null,
      filters: { eventId },
    });
    const draft = await admin.post('/api/campaigns').send({
      name: `Borrador ${run}`,
      subject: 'Asunto',
      body: 'Texto',
      eventId: null,
      segmentId: segment.body.id,
    });
    expect((await admin.del(`/api/segments/${segment.body.id}`)).status).toBe(
      409,
    );
    expect((await admin.del(`/api/campaigns/${draft.body.id}`)).status).toBe(
      204,
    );
    expect((await admin.del(`/api/segments/${segment.body.id}`)).status).toBe(
      204,
    );

    const manual = await admin.post('/api/contacts').send({
      firstName: 'Sin',
      lastName: 'Historia',
      email: `manual@${domain}`,
      phone: null,
      position: null,
      companyId: null,
    });
    expect(manual.status).toBe(201);
    const duplicated = await admin.post('/api/contacts').send({
      firstName: 'Otra',
      lastName: 'Persona',
      email: `MANUAL@${domain}`,
      phone: null,
      position: null,
      companyId: null,
    });
    expect(duplicated.status).toBe(409);
    expect((await admin.del(`/api/contacts/${manual.body.id}`)).status).toBe(
      204,
    );
  });
});

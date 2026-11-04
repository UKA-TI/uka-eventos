import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';

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
  const write = (method: 'post' | 'put' | 'delete', path: string) =>
    agent[method](path).set('Origin', origin).set('X-CSRF-Token', csrf);
  return { agent, write };
}

type Session = Awaited<ReturnType<typeof login>>;

const eventBody = (seriesId: string, overrides: object = {}) => ({
  seriesId,
  editionYear: 2027,
  slug: `gala-${run}`,
  name: `Gala ${run} 2027`,
  description: null,
  startsAt: null,
  endsAt: null,
  timeZone: 'America/Mexico_City',
  venue: 'Sede',
  paymentInstructions: null,
  capacity: 100,
  folioPrefix: null,
  currency: 'MXN',
  companionLimit: 0,
  modules: ['publicRegistration', 'checkin'],
  ...overrides,
});

const ticketBody = (overrides: object = {}) => ({
  name: 'General',
  description: null,
  price: 500,
  capacity: null,
  seatsIncluded: 1,
  salesStart: null,
  salesEnd: null,
  active: true,
  ...overrides,
});

const fieldBody = (overrides: object = {}) => ({
  label: 'Talla',
  type: 'select',
  required: true,
  options: ['CH', 'M', 'G'],
  helpText: null,
  active: true,
  ...overrides,
});

describe.skipIf(!process.env.RUN_DB_TESTS)('events configuration flow', () => {
  let admin: Session;
  let viewer: Session;
  let seriesId = '';
  let eventId = '';

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
  });

  afterAll(async () => {
    const series = await prisma.eventSeries.findMany({
      where: { name: { contains: run } },
      select: { id: true },
    });
    const seriesIds = series.map((item) => item.id);
    await prisma.event.deleteMany({ where: { seriesId: { in: seriesIds } } });
    await prisma.eventSeries.deleteMany({ where: { id: { in: seriesIds } } });
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `@${domain}` } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('creates a series and a draft event with its modules', async () => {
    const series = await admin
      .write('post', '/api/series')
      .send({ name: `Gala ${run}`, type: 'Gala', description: null });
    expect(series.status).toBe(201);
    seriesId = series.body.id;

    const event = await admin
      .write('post', '/api/events')
      .send(eventBody(seriesId));
    expect(event.status).toBe(201);
    eventId = event.body.id;
    expect(event.body.status).toBe('draft');
    expect(event.body.series.name).toBe(`Gala ${run}`);
    expect(event.body.modules).toEqual(['publicRegistration', 'checkin']);
    expect(event.body.activationIssues).toHaveLength(3);
  });

  it('rejects an unknown series and an unknown module', async () => {
    const badSeries = await admin
      .write('post', '/api/events')
      .send(eventBody('missing', { slug: `x-${run}` }));
    expect(badSeries.status).toBe(400);
    const badModule = await admin
      .write('put', `/api/events/${eventId}/modules`)
      .send({ modules: ['nope'] });
    expect(badModule.status).toBe(400);
  });

  it('hides drafts from people who cannot edit', async () => {
    expect((await viewer.agent.get(`/api/events/${eventId}`)).status).toBe(404);
    const list = await viewer.agent.get('/api/events');
    expect(
      list.body.some((event: { id: string }) => event.id === eventId),
    ).toBe(false);
    const series = await viewer.agent.get('/api/series');
    const own = series.body.find(
      (item: { id: string }) => item.id === seriesId,
    );
    expect(own.editions).toEqual([]);
  });

  it('blocks viewers from changing configuration', async () => {
    const event = await viewer
      .write('post', `/api/events/${eventId}/tickets`)
      .send(ticketBody());
    expect(event.status).toBe(403);
    const remove = await viewer.write('delete', `/api/events/${eventId}`);
    expect(remove.status).toBe(403);
  });

  it('will not activate an incomplete event', async () => {
    const response = await admin
      .write('post', `/api/events/${eventId}/status`)
      .send({ status: 'active' });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain('fecha de inicio');
  });

  it('manages ticket types, including free and multi-seat ones', async () => {
    const paid = await admin
      .write('post', `/api/events/${eventId}/tickets`)
      .send(ticketBody());
    expect(paid.status).toBe(201);
    expect(paid.body.price).toBe(500);

    const table = await admin
      .write('post', `/api/events/${eventId}/tickets`)
      .send(ticketBody({ name: 'Mesa', price: 4500.5, seatsIncluded: 10 }));
    expect(table.body.seatsIncluded).toBe(10);

    const free = await admin
      .write('post', `/api/events/${eventId}/tickets`)
      .send(ticketBody({ name: 'Cortesía', price: 0 }));
    expect(free.body.price).toBe(0);

    const duplicate = await admin
      .write('post', `/api/events/${eventId}/tickets`)
      .send(ticketBody());
    expect(duplicate.status).toBe(409);

    const dates = await admin
      .write('post', `/api/events/${eventId}/tickets`)
      .send(
        ticketBody({
          name: 'Fechas',
          salesStart: '2027-01-02T00:00:00.000Z',
          salesEnd: '2027-01-01T00:00:00.000Z',
        }),
      );
    expect(dates.status).toBe(400);

    const removed = await admin.write(
      'delete',
      `/api/events/${eventId}/tickets/${free.body.id}`,
    );
    expect(removed.status).toBe(204);
  });

  it('does not touch tickets through another event', async () => {
    const other = await admin
      .write('post', '/api/events')
      .send(eventBody(seriesId, { slug: `otro-${run}`, name: `Otro ${run}` }));
    const ticket = await prisma.ticketType.findFirstOrThrow({
      where: { eventId },
    });
    const response = await admin
      .write('put', `/api/events/${other.body.id}/tickets/${ticket.id}`)
      .send(ticketBody({ name: 'Robado' }));
    expect(response.status).toBe(404);
    expect(
      (await admin.write('delete', `/api/events/${other.body.id}`)).status,
    ).toBe(204);
  });

  it('manages custom questions and their order', async () => {
    const size = await admin
      .write('post', `/api/events/${eventId}/fields`)
      .send(fieldBody());
    expect(size.status).toBe(201);
    expect(size.body.options).toEqual(['CH', 'M', 'G']);

    const noOptions = await admin
      .write('post', `/api/events/${eventId}/fields`)
      .send(fieldBody({ options: [] }));
    expect(noOptions.status).toBe(400);

    const diet = await admin
      .write('post', `/api/events/${eventId}/fields`)
      .send(
        fieldBody({
          label: 'Alergias',
          type: 'text',
          required: false,
          options: [],
        }),
      );

    const stale = await admin
      .write('put', `/api/events/${eventId}/fields/order`)
      .send({ ids: [diet.body.id] });
    expect(stale.status).toBe(400);

    const order = await admin
      .write('put', `/api/events/${eventId}/fields/order`)
      .send({ ids: [diet.body.id, size.body.id] });
    expect(order.status).toBe(204);
    const detail = await admin.agent.get(`/api/events/${eventId}`);
    expect(detail.body.formFields.map((f: { id: string }) => f.id)).toEqual([
      diet.body.id,
      size.body.id,
    ]);
  });

  it('activates a complete event and protects its last ticket', async () => {
    const complete = await admin.write('put', `/api/events/${eventId}`).send(
      eventBody(seriesId, {
        startsAt: '2027-02-12T00:30:00.000Z',
        folioPrefix: 'GAL',
        paymentInstructions: 'Transferencia',
      }),
    );
    expect(complete.status).toBe(200);
    expect(complete.body.activationIssues).toEqual([]);

    const active = await admin
      .write('post', `/api/events/${eventId}/status`)
      .send({ status: 'active' });
    expect(active.status).toBe(200);
    expect(active.body.status).toBe('active');
    expect((await viewer.agent.get(`/api/events/${eventId}`)).status).toBe(200);

    const incomplete = await admin.write('put', `/api/events/${eventId}`).send(
      eventBody(seriesId, {
        startsAt: null,
        folioPrefix: 'GAL',
        paymentInstructions: 'Transferencia',
      }),
    );
    expect(incomplete.status).toBe(409);

    const [first, second] = active.body.ticketTypes as { id: string }[];
    expect(
      (
        await admin.write(
          'delete',
          `/api/events/${eventId}/tickets/${first!.id}`,
        )
      ).status,
    ).toBe(204);
    const last = await admin.write(
      'delete',
      `/api/events/${eventId}/tickets/${second!.id}`,
    );
    expect(last.status).toBe(409);
    const deactivate = await admin
      .write('put', `/api/events/${eventId}/tickets/${second!.id}`)
      .send(ticketBody({ name: 'Mesa', active: false }));
    expect(deactivate.status).toBe(409);
  });

  it('only deletes drafts', async () => {
    const response = await admin.write('delete', `/api/events/${eventId}`);
    expect(response.status).toBe(409);
    const series = await admin.write('delete', `/api/series/${seriesId}`);
    expect(series.status).toBe(409);
  });

  it('creates a new edition with configuration, not attendees', async () => {
    const edition = await admin
      .write('post', `/api/events/${eventId}/duplicate`)
      .send({
        name: `Gala ${run} 2028`,
        slug: `gala-${run}-2028`,
        editionYear: 2028,
        startsAt: '2028-02-12T00:30:00.000Z',
        endsAt: null,
      });
    expect(edition.status).toBe(201);
    expect(edition.body.status).toBe('draft');
    expect(edition.body.series.id).toBe(seriesId);
    expect(edition.body.editionYear).toBe(2028);
    expect(edition.body.registrationCount).toBe(0);
    expect(
      edition.body.ticketTypes.map((t: { name: string }) => t.name),
    ).toEqual(['Mesa']);
    expect(edition.body.formFields).toHaveLength(2);
    expect(edition.body.modules).toEqual(['publicRegistration', 'checkin']);

    const series = await admin.agent.get('/api/series');
    const own = series.body.find(
      (item: { id: string }) => item.id === seriesId,
    );
    expect(
      own.editions.map((e: { editionYear: number }) => e.editionYear),
    ).toEqual([2028, 2027]);
  });
});

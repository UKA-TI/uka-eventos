import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';
import { hashToken } from '../src/modules/passes/tokens.js';

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

describe.skipIf(!process.env.RUN_DB_TESTS)('check-in', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let reception: Awaited<ReturnType<typeof login>>;
  let viewer: Awaited<ReturnType<typeof login>>;
  let eventId = '';
  let otherEventId = '';
  let seriesId = '';
  let doorA = '';
  let doorB = '';
  let base = '';

  const item = (tokenHash: string, overrides: object = {}) => ({
    clientId: randomUUID(),
    tokenHash,
    accessPointId: doorA,
    scannedAt: new Date().toISOString(),
    manualReason: null,
    ...overrides,
  });

  async function makePass(
    event: string,
    name: string,
    status = 'active',
  ): Promise<string> {
    const ticket = await prisma.ticketType.findFirstOrThrow({
      where: { eventId: event },
    });
    const guest = await prisma.guest.create({
      data: { firstName: name, lastName: 'Prueba', email: `${name}@${domain}` },
    });
    const suffix = randomBytes(4).toString('hex');
    const order = await prisma.order.create({
      data: {
        eventId: event,
        ticketTypeId: ticket.id,
        buyerGuestId: guest.id,
        reference: `T-${suffix}`,
        seats: 1,
        amountDue: 0,
        status: 'confirmed',
        source: 'staff',
        answers: [],
      },
    });
    const registration = await prisma.registration.create({
      data: {
        eventId: event,
        guestId: guest.id,
        orderId: order.id,
        seatNumber: 1,
        folio: `T-${suffix}`,
        status: 'confirmed',
      },
    });
    const tokenHash = hashToken(`token-${suffix}`);
    await prisma.pass.create({
      data: { registrationId: registration.id, tokenHash, status },
    });
    return tokenHash;
  }

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const roles = await prisma.role.findMany({
      where: { code: { in: ['ADMIN', 'QUERY'] } },
    });
    const roleId = (code: string) =>
      roles.find((role) => role.code === code)!.id;
    const operator = await prisma.role.create({
      data: {
        code: `CUSTOM_${run}`,
        name: `Puerta ${run}`,
        permissions: {
          create: [
            { permission: 'events.view' },
            { permission: 'checkin.operate' },
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
        { email: `door@${domain}`, displayName: 'door', roleId: operator.id },
        {
          email: `viewer@${domain}`,
          displayName: 'viewer',
          roleId: roleId('QUERY'),
        },
      ],
    });
    admin = await login('admin');
    reception = await login('door');
    viewer = await login('viewer');

    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: 'Gala' },
    });
    seriesId = series.id;
    const shared = {
      seriesId,
      editionYear: 2027,
      status: 'active',
      startsAt: new Date('2027-02-12T00:30:00.000Z'),
      folioPrefix: 'CHK',
      ticketTypes: { create: [{ name: 'General', price: 0 }] },
    };
    const event = await prisma.event.create({
      data: {
        ...shared,
        slug: `chk-${run}`,
        name: `Check ${run}`,
        modules: ['checkin', 'raffle'],
      },
    });
    eventId = event.id;
    base = `/api/events/${eventId}/checkin`;
    const other = await prisma.event.create({
      data: {
        ...shared,
        slug: `chk2-${run}`,
        name: `Otro ${run}`,
        modules: ['checkin'],
        ticketTypes: { create: [{ name: 'General', price: 0 }] },
      },
    });
    otherEventId = other.id;
  });

  afterAll(async () => {
    const events = [eventId, otherEventId];
    await prisma.incident.deleteMany({ where: { eventId: { in: events } } });
    await prisma.checkin.deleteMany({ where: { eventId: { in: events } } });
    await prisma.accessPoint.deleteMany({ where: { eventId: { in: events } } });
    const regs = await prisma.registration.findMany({
      where: { eventId: { in: events } },
      select: { id: true },
    });
    await prisma.pass.deleteMany({
      where: { registrationId: { in: regs.map((reg) => reg.id) } },
    });
    await prisma.registration.deleteMany({
      where: { eventId: { in: events } },
    });
    await prisma.order.deleteMany({ where: { eventId: { in: events } } });
    await prisma.guest.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.contact.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.company.deleteMany({
      where: { name: { contains: run } },
    });
    await prisma.eventCounter.deleteMany({
      where: { eventId: { in: events } },
    });
    await prisma.event.deleteMany({ where: { id: { in: events } } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `@${domain}` } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.role.deleteMany({ where: { code: `CUSTOM_${run}` } });
    await prisma.$disconnect();
  });

  it('manages access points only with the manage permission', async () => {
    const denied = await reception
      .write('post', `${base}/access-points`)
      .send({ name: 'Puerta', active: true });
    expect(denied.status).toBe(403);

    const a = await admin
      .write('post', `${base}/access-points`)
      .send({ name: 'Fila A', active: true });
    expect(a.status).toBe(201);
    doorA = a.body.id;
    const b = await admin
      .write('post', `${base}/access-points`)
      .send({ name: 'Fila B', active: true });
    doorB = b.body.id;

    const same = await admin
      .write('post', `${base}/access-points`)
      .send({ name: 'Fila A', active: true });
    expect(same.status).toBe(409);
  });

  it('blocks people without check-in permission', async () => {
    expect((await viewer.agent.get(`${base}/offline-list`)).status).toBe(403);
    expect((await viewer.agent.get('/api/checkin/events')).status).toBe(403);
    expect(
      (await viewer.write('post', `${base}/scan`).send(item('a'.repeat(64))))
        .status,
    ).toBe(403);
    expect((await reception.agent.get(`${base}/incidents`)).status).toBe(403);
  });

  it('lists the event with its doors for the operator', async () => {
    const response = await reception.agent.get('/api/checkin/events');
    const own = response.body.find(
      (event: { id: string }) => event.id === eventId,
    );
    expect(own.accessPoints.map((p: { name: string }) => p.name)).toEqual([
      'Fila A',
      'Fila B',
    ]);
    expect(own).not.toHaveProperty('modules');
  });

  it('admits once, then flags the second attempt', async () => {
    const hash = await makePass(eventId, 'ana');
    const first = await reception
      .write('post', `${base}/scan`)
      .send(item(hash));
    expect(first.body.status).toBe('ok');
    expect(first.body.guestName).toBe('ana Prueba');
    expect(first.body.raffleFolio).toBe('R-0001');

    const second = await reception
      .write('post', `${base}/scan`)
      .send(item(hash, { accessPointId: doorB }));
    expect(second.body.status).toBe('duplicate');
    expect(second.body.accessPointName).toBe('Fila A');
    expect(second.body.operatorName).toBe('door');

    const incidents = await admin.agent.get(`${base}/incidents`);
    expect(incidents.body[0].type).toBe('duplicate');
    expect(incidents.body[0].status).toBe('open');
  });

  it('rejects revoked, unknown and other-event passes', async () => {
    const revoked = await makePass(eventId, 'rev', 'revoked');
    expect(
      (await reception.write('post', `${base}/scan`).send(item(revoked))).body
        .status,
    ).toBe('revoked');

    expect(
      (await reception.write('post', `${base}/scan`).send(item('f'.repeat(64))))
        .body.status,
    ).toBe('unknown');

    const foreign = await makePass(otherEventId, 'ajeno');
    const response = await reception
      .write('post', `${base}/scan`)
      .send(item(foreign));
    expect(response.body).toEqual({ status: 'unknown' });
    expect(
      await prisma.checkin.count({ where: { eventId: otherEventId } }),
    ).toBe(0);
  });

  it('rejects a door from another event', async () => {
    const hash = await makePass(eventId, 'puerta');
    const other = await prisma.accessPoint.create({
      data: { eventId: otherEventId, name: 'Ajena' },
    });
    const response = await reception
      .write('post', `${base}/scan`)
      .send(item(hash, { accessPointId: other.id }));
    expect(response.status).toBe(400);
  });

  it('admits only once when two doors scan at the same moment', async () => {
    const hash = await makePass(eventId, 'simultaneo');
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        reception
          .write('post', `${base}/scan`)
          .send(item(hash, { accessPointId: index % 2 ? doorA : doorB })),
      ),
    );
    const statuses = results.map((result) => result.body.status);
    expect(statuses.filter((status) => status === 'ok')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'duplicate')).toHaveLength(5);
  });

  it('gives each person a different raffle folio under pressure', async () => {
    const hashes = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        makePass(eventId, `rifa${index}`),
      ),
    );
    const results = await Promise.all(
      hashes.map((hash) =>
        reception.write('post', `${base}/scan`).send(item(hash)),
      ),
    );
    const folios = results.map((result) => result.body.raffleFolio);
    expect(new Set(folios).size).toBe(8);
  });

  it('syncs offline scans in order, idempotently, keeping their time', async () => {
    const early = await makePass(eventId, 'sync1');
    const contested = await makePass(eventId, 'sync2');
    const when = (minutes: number) =>
      new Date(Date.now() - minutes * 60_000).toISOString();

    const phone1 = item(contested, {
      scannedAt: when(5),
      accessPointId: doorB,
    });
    const phone2 = item(contested, { scannedAt: when(10) });
    const normal = item(early, { scannedAt: when(7) });

    const first = await reception
      .write('post', `${base}/sync`)
      .send({ items: [phone1, normal, phone2] });
    expect(first.status).toBe(200);
    const byClient = Object.fromEntries(
      first.body.results.map(
        (entry: { clientId: string; result: { status: string } }) => [
          entry.clientId,
          entry.result.status,
        ],
      ),
    );
    expect(byClient[phone2.clientId]).toBe('ok');
    expect(byClient[phone1.clientId]).toBe('duplicate');
    expect(byClient[normal.clientId]).toBe('ok');

    const stored = await prisma.checkin.findUniqueOrThrow({
      where: { clientEventId: phone2.clientId },
    });
    expect(stored.source).toBe('offline');
    expect(stored.checkedInAt.toISOString()).toBe(phone2.scannedAt);

    const incidentsBefore = await prisma.incident.count({ where: { eventId } });
    const again = await reception
      .write('post', `${base}/sync`)
      .send({ items: [phone1, normal, phone2] });
    expect(again.status).toBe(200);
    expect(await prisma.incident.count({ where: { eventId } })).toBe(
      incidentsBefore,
    );
    const retried = again.body.results.find(
      (entry: { clientId: string }) => entry.clientId === normal.clientId,
    );
    expect(retried.result.status).toBe('ok');
  });

  it('does not let a future clock move a check-in ahead', async () => {
    const hash = await makePass(eventId, 'futuro');
    const scan = item(hash, {
      scannedAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await reception.write('post', `${base}/sync`).send({ items: [scan] });
    const stored = await prisma.checkin.findUniqueOrThrow({
      where: { clientEventId: scan.clientId },
    });
    expect(stored.checkedInAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('gives the device only what it needs offline', async () => {
    const response = await reception.agent.get(`${base}/offline-list`);
    expect(response.status).toBe(200);
    const entry = response.body.entries[0];
    expect(Object.keys(entry).sort()).toEqual(
      ['checkedInAt', 'folio', 'guestName', 'ticketName', 'tokenHash'].sort(),
    );
    expect(JSON.stringify(response.body)).not.toContain(`@${domain}`);
    const revoked = response.body.entries.some(
      (item_: { guestName: string }) => item_.guestName === 'rev Prueba',
    );
    expect(revoked).toBe(false);
  });

  it('records manual entries with their reason and audit trail', async () => {
    const hash = await makePass(eventId, 'manual');
    const response = await reception
      .write('post', `${base}/scan`)
      .send(item(hash, { manualReason: 'No traía su teléfono' }));
    expect(response.body.status).toBe('ok');
    const overview = await reception.agent.get(`${base}/overview`);
    const entry = overview.body.recent.find(
      (row: { guestName: string }) => row.guestName === 'manual Prueba',
    );
    expect(entry.manualReason).toBe('No traía su teléfono');
    const audit = await prisma.auditLog.count({
      where: { eventId, action: 'checkin.manual' },
    });
    expect(audit).toBe(1);
  });

  it('counts by door and resolves incidents', async () => {
    const overview = await admin.agent.get(`${base}/overview`);
    expect(overview.body.checkedIn).toBeGreaterThan(0);
    const counted = overview.body.accessPoints.reduce(
      (sum: number, point: { checkins: number }) => sum + point.checkins,
      0,
    );
    expect(counted).toBe(overview.body.checkedIn);
    expect(overview.body.openIncidents).toBeGreaterThan(0);

    const created = await reception
      .write('post', `${base}/incidents`)
      .send({ accessPointId: doorA, description: 'Persona sin boleto' });
    expect(created.status).toBe(201);

    const denied = await reception
      .write('post', `${base}/incidents/${created.body.id}/resolve`)
      .send({ resolution: 'Listo' });
    expect(denied.status).toBe(403);

    const resolved = await admin
      .write('post', `${base}/incidents/${created.body.id}/resolve`)
      .send({ resolution: 'Se verificó en sistema' });
    expect(resolved.status).toBe(204);
    const twice = await admin
      .write('post', `${base}/incidents/${created.body.id}/resolve`)
      .send({ resolution: 'Otra vez' });
    expect(twice.status).toBe(404);
  });

  it('protects doors with history and orders with entries', async () => {
    const remove = await admin.write(
      'delete',
      `${base}/access-points/${doorA}`,
    );
    expect(remove.status).toBe(409);

    const entry = await prisma.checkin.findFirstOrThrow({
      where: { eventId },
      include: { pass: { include: { registration: true } } },
    });
    const cancel = await admin.write(
      'post',
      `/api/events/${eventId}/orders/${entry.pass.registration.orderId}/cancel`,
    );
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toContain('ingresaron');
  });
});

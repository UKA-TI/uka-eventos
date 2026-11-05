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
  const write = (path: string) =>
    agent.post(path).set('Origin', origin).set('X-CSRF-Token', csrf);
  return { agent, write };
}

describe.skipIf(!process.env.RUN_DB_TESTS)('control screens', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let door: Awaited<ReturnType<typeof login>>;
  let viewer: Awaited<ReturnType<typeof login>>;
  let doorUserId = '';
  let eventId = '';
  let seriesId = '';
  let doorA = '';
  let base = '';
  let folioCounter = 0;

  async function makePass(name: string, consent = false) {
    const ticket = await prisma.ticketType.findFirstOrThrow({
      where: { eventId },
    });
    const guest = await prisma.guest.create({
      data: { firstName: name, lastName: 'Prueba', email: `${name}@${domain}` },
    });
    folioCounter += 1;
    const folio = `CTL-${String(folioCounter).padStart(4, '0')}`;
    const order = await prisma.order.create({
      data: {
        eventId,
        ticketTypeId: ticket.id,
        buyerGuestId: guest.id,
        reference: `T-${run}-${folioCounter}`,
        seats: 1,
        amountDue: 0,
        status: 'confirmed',
        source: 'staff',
        answers: [],
      },
    });
    const registration = await prisma.registration.create({
      data: {
        eventId,
        guestId: guest.id,
        orderId: order.id,
        seatNumber: 1,
        folio,
        status: 'confirmed',
      },
    });
    if (consent) {
      await prisma.consent.create({
        data: {
          registrationId: registration.id,
          purpose: 'event_registration',
          noticeVersion: '2026-11',
          granted: true,
          consentedAt: new Date(),
        },
      });
    }
    const tokenHash = hashToken(`token-${run}-${folioCounter}`);
    await prisma.pass.create({
      data: { registrationId: registration.id, tokenHash, status: 'active' },
    });
    return { tokenHash, folio };
  }

  const item = (tokenHash: string, overrides: object = {}) => ({
    clientId: randomUUID(),
    tokenHash,
    accessPointId: doorA,
    scannedAt: new Date().toISOString(),
    manualReason: null,
    ...overrides,
  });

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const roles = await prisma.role.findMany({
      where: { code: { in: ['ADMIN', 'QUERY'] } },
    });
    const roleId = (code: string) =>
      roles.find((role) => role.code === code)!.id;
    const operator = await prisma.role.create({
      data: {
        code: `CTL_${run}`,
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
    door = await login('door');
    viewer = await login('viewer');
    doorUserId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: `door@${domain}` },
      })
    ).id;

    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: 'Gala' },
    });
    seriesId = series.id;
    const event = await prisma.event.create({
      data: {
        seriesId,
        editionYear: 2027,
        status: 'active',
        slug: `ctl-${run}`,
        name: `Control ${run}`,
        folioPrefix: 'CTL',
        modules: ['checkin'],
        ticketTypes: { create: [{ name: 'General', price: 0 }] },
        accessPoints: { create: [{ name: 'Fila A' }] },
      },
      include: { accessPoints: true },
    });
    eventId = event.id;
    doorA = event.accessPoints[0]!.id;
    base = `/api/events/${eventId}/checkin`;
  });

  afterAll(async () => {
    const inEvent = { eventId };
    await prisma.auditLog.deleteMany({ where: inEvent });
    await prisma.incident.deleteMany({ where: inEvent });
    await prisma.checkin.deleteMany({ where: inEvent });
    await prisma.accessPoint.deleteMany({ where: inEvent });
    const regs = await prisma.registration.findMany({
      where: inEvent,
      select: { id: true },
    });
    const registrationId = { in: regs.map((reg) => reg.id) };
    await prisma.consent.deleteMany({ where: { registrationId } });
    await prisma.pass.deleteMany({ where: { registrationId } });
    await prisma.registration.deleteMany({ where: inEvent });
    await prisma.order.deleteMany({ where: inEvent });
    await prisma.guest.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.contact.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.ticketType.deleteMany({ where: inEvent });
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `@${domain}` } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.role.deleteMany({ where: { code: `CTL_${run}` } });
    await prisma.$disconnect();
  });

  it('keeps the audit log and consents behind their own permissions', async () => {
    for (const path of [
      '/api/audit',
      '/api/audit/options',
      '/api/consents/events',
      '/api/consents/notices',
      '/api/consents/marketing',
    ]) {
      expect((await request(app).get(path)).status).toBe(401);
      expect((await door.agent.get(path)).status).toBe(403);
      expect((await viewer.agent.get(path)).status).toBe(403);
      expect((await admin.agent.get(path)).status).toBe(200);
    }
  });

  it('logs a manual entry once, online or offline, even if it is sent twice', async () => {
    const online = await makePass('online');
    await door
      .write(`${base}/scan`)
      .send(item(online.tokenHash, { manualReason: 'QR dañado' }))
      .expect(200);

    const offline = await makePass('offline');
    const queued = item(offline.tokenHash, { manualReason: 'No trae su pase' });
    await door
      .write(`${base}/sync`)
      .send({ items: [queued] })
      .expect(200);
    await door
      .write(`${base}/sync`)
      .send({ items: [queued] })
      .expect(200);

    const logged = await prisma.auditLog.findMany({
      where: { eventId, action: 'checkin.manual' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logged).toHaveLength(2);
    expect(logged[0]?.userId).toBe(doorUserId);
    expect(logged[0]?.details).toMatchObject({
      folio: online.folio,
      reason: 'QR dañado',
    });
    expect(logged[1]?.details).toMatchObject({
      folio: offline.folio,
      reason: 'No trae su pase',
      offline: true,
    });
  });

  it('does not log a normal QR entry as an exception', async () => {
    const pass = await makePass('normal');
    await door.write(`${base}/scan`).send(item(pass.tokenHash)).expect(200);
    const logged = await prisma.auditLog.findMany({
      where: { eventId, action: 'checkin.manual' },
    });
    expect(
      logged.some(
        (row) => (row.details as { folio?: string }).folio === pass.folio,
      ),
    ).toBe(false);
  });

  it('logs every incident with its operator', async () => {
    const pass = await makePass('twice');
    await door.write(`${base}/scan`).send(item(pass.tokenHash)).expect(200);
    const repeated = await door
      .write(`${base}/scan`)
      .send(item(pass.tokenHash));
    expect(repeated.body.status).toBe('duplicate');
    await door
      .write(`${base}/scan`)
      .send(item(hashToken(`nadie-${run}`)))
      .expect(200);
    await door
      .write(`${base}/incidents`)
      .send({ accessPointId: doorA, description: 'Se fue la luz' })
      .expect(201);

    const logged = await prisma.auditLog.findMany({
      where: { eventId, action: { startsWith: 'incident.' } },
    });
    expect(logged.map((row) => row.action).sort()).toEqual([
      'incident.duplicate',
      'incident.manual',
      'incident.unknown',
    ]);
    expect(logged.every((row) => row.userId === doorUserId)).toBe(true);
  });

  it('filters the audit log and shows it in plain words', async () => {
    const byEvent = await admin.agent.get(`/api/audit?eventId=${eventId}`);
    expect(byEvent.status).toBe(200);
    const manual = byEvent.body.rows.find(
      (row: { action: string; detail: string }) =>
        row.action === 'checkin.manual' && row.detail.includes('QR dañado'),
    );
    expect(manual.actionLabel).toBe('Dio un ingreso manual');
    expect(manual.userName).toBe('door');
    expect(manual.eventName).toBe(`Control ${run}`);
    expect(manual.detail).toContain('Motivo: QR dañado');

    const reception = await admin.agent.get(
      `/api/audit?eventId=${eventId}&category=recepcion`,
    );
    expect(reception.body.total).toBe(byEvent.body.total);
    const others = await admin.agent.get(
      `/api/audit?eventId=${eventId}&category=reportes`,
    );
    expect(others.body.total).toBe(0);

    const byUser = await admin.agent.get(
      `/api/audit?eventId=${eventId}&userId=${doorUserId}`,
    );
    expect(byUser.body.total).toBeGreaterThan(0);

    const past = await admin.agent.get(
      `/api/audit?eventId=${eventId}&to=2020-01-01`,
    );
    expect(past.body.total).toBe(0);
    const future = await admin.agent.get(
      `/api/audit?eventId=${eventId}&from=2099-01-01`,
    );
    expect(future.body.total).toBe(0);

    expect(
      (await admin.agent.get('/api/audit?category=inventada')).status,
    ).toBe(400);
  });

  it('lists who accepted the notice, and finds them by full name or folio', async () => {
    const pass = await makePass('Consentida', true);
    const all = await admin.agent.get(
      `/api/consents/notices?eventId=${eventId}`,
    );
    expect(all.body.accepted).toBe(1);
    expect(all.body.rows[0]).toMatchObject({
      guestName: 'Consentida Prueba',
      folio: pass.folio,
      purpose: 'event_registration',
      noticeVersion: '2026-11',
      eventName: `Control ${run}`,
    });
    const byName = await admin.agent.get(
      `/api/consents/notices?eventId=${eventId}&q=${encodeURIComponent('consentida prueba')}`,
    );
    expect(byName.body.total).toBe(1);
    const byFolio = await admin.agent.get(
      `/api/consents/notices?eventId=${eventId}&q=${pass.folio}`,
    );
    expect(byFolio.body.total).toBe(1);
    const nobody = await admin.agent.get(
      `/api/consents/notices?eventId=${eventId}&q=inexistente`,
    );
    expect(nobody.body.total).toBe(0);
    expect(nobody.body.accepted).toBe(1);
  });

  it('shows the current communications status of each contact', async () => {
    const now = new Date();
    await prisma.contact.createMany({
      data: [
        {
          firstName: 'Si',
          lastName: run,
          email: `si@${domain}`,
          marketingConsentAt: now,
          marketingConsentSource: 'registration',
          marketingNoticeVersion: '2026-11',
        },
        {
          firstName: 'Baja',
          lastName: run,
          email: `baja@${domain}`,
          marketingConsentAt: now,
          marketingConsentSource: 'registration',
          marketingNoticeVersion: '2026-11',
          optedOutAt: now,
          optOutSource: 'link',
        },
        { firstName: 'Nada', lastName: run, email: `nada@${domain}` },
      ],
    });
    const rows = async (status: string) =>
      (
        await admin.agent.get(
          `/api/consents/marketing?q=${run}&status=${status}`,
        )
      ).body.rows;

    expect((await rows('granted'))[0]).toMatchObject({
      name: `Si ${run}`,
      status: 'granted',
      source: 'registration',
      noticeVersion: '2026-11',
    });
    expect(await rows('opted_out')).toHaveLength(1);
    expect((await rows('opted_out'))[0]).toMatchObject({
      name: `Baja ${run}`,
      status: 'opted_out',
      source: 'link',
      noticeVersion: null,
    });
    expect((await rows('none'))[0]).toMatchObject({
      name: `Nada ${run}`,
      status: 'none',
      at: null,
      source: null,
    });
  });

  it('shows who operated the door, only to whoever manages it', async () => {
    expect((await door.agent.get(`${base}/operators`)).status).toBe(403);
    expect((await viewer.agent.get(`${base}/operators`)).status).toBe(403);

    const response = await admin.agent.get(`${base}/operators`);
    expect(response.status).toBe(200);
    const row = response.body.find(
      (operator: { email: string }) => operator.email === `door@${domain}`,
    );
    const entered = await prisma.checkin.count({
      where: { eventId, operatorUserId: doorUserId },
    });
    expect(entered).toBeGreaterThan(0);
    expect(row).toMatchObject({
      displayName: 'door',
      canOperate: true,
      checkins: entered,
      manual: 2,
      incidents: 3,
      doors: [{ name: 'Fila A', checkins: entered }],
    });
    expect(row.firstAt).toBeTruthy();
    expect(row.lastAt).toBeTruthy();
    expect(
      response.body.some(
        (operator: { email: string }) => operator.email === `viewer@${domain}`,
      ),
    ).toBe(false);
    expect(response.body[0].checkins).toBeGreaterThanOrEqual(
      response.body.at(-1).checkins,
    );
  });
});

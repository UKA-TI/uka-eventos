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
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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
    del: (path: string) =>
      agent.delete(path).set('Origin', origin).set('X-CSRF-Token', csrf),
  };
}

interface View {
  publishedAt: string | null;
  pendingChanges: number;
  tables: {
    id: string;
    name: string;
    capacity: number;
    occupied: number;
    zone: string | null;
    people: { name: string }[];
  }[];
  groups: {
    key: string;
    label: string;
    seats: number;
    placedSeats: number;
    orders: {
      id: string;
      allocations: {
        id: string;
        tableId: string;
        tableName: string;
        seats: number;
        locked: boolean;
      }[];
      people: { id: string; name: string; tableId: string | null }[];
    }[];
  }[];
}

describe.skipIf(!process.env.RUN_DB_TESTS)('table seating', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let viewer: Awaited<ReturnType<typeof login>>;
  let seriesId = '';
  let eventId = '';
  let single = '';
  let tableTicket = '';
  let pointId = '';
  const company = `Soriana ${run}`;

  const base = () => `/api/events/${eventId}/seating`;
  const view = async () => {
    const response = await admin.get(`${base()}/`);
    expect(response.status).toBe(200);
    return response.body as View;
  };
  const groupOf = async (label: string) => {
    const data = await view();
    const found = data.groups.find((group) => group.label === label);
    expect(found).toBeDefined();
    return { data, group: found! };
  };
  const reconcile = (
    name: string,
    extra: { organization?: string | null; ticketTypeId?: string } = {},
  ) =>
    admin.post(`/api/events/${eventId}/orders/reconciled`).send({
      firstName: name,
      lastName: 'Compra',
      email: `${name}@${domain}`,
      phone: null,
      organization: extra.organization ?? null,
      ticketTypeId: extra.ticketTypeId ?? single,
      quantity: 1,
      amount: 0,
      method: 'transfer',
      reference: null,
      notes: null,
      paidAt: '2030-01-10T18:00:00.000Z',
    });
  const addGuest = (orderId: string, name: string, own = false) =>
    request(app)
      .post(`/api/public/groups/${groupToken(orderId)}/guests`)
      .set('Origin', origin)
      .send({
        firstName: name,
        lastName: 'Invitado',
        email: `${name}@${domain}`,
        phone: null,
        organization: null,
        authorized: own,
      });

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'ADMIN' },
    });
    const viewerRole = await prisma.role.create({
      data: {
        code: `SEAT_${run}`,
        name: `Acomodo lector ${run}`,
        permissions: { create: [{ permission: 'seating.view' }] },
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
        editionYear: 2030,
        modules: ['publicRegistration', 'checkin', 'tables'],
        status: 'active',
        slug: `seat-${run}`,
        name: `Gala ${run}`,
        folioPrefix: 'SEA',
        startsAt: new Date('2030-03-01T02:00:00.000Z'),
      },
    });
    eventId = event.id;
    single = (
      await prisma.ticketType.create({
        data: { eventId, name: 'Individual', price: 0 },
      })
    ).id;
    tableTicket = (
      await prisma.ticketType.create({
        data: { eventId, name: 'Mesa', price: 0, seatsIncluded: 4 },
      })
    ).id;
    pointId = (
      await prisma.accessPoint.create({ data: { eventId, name: 'Fila A' } })
    ).id;
  });

  afterAll(async () => {
    const inEvent = { eventId };
    const registrations = await prisma.registration.findMany({
      where: inEvent,
      select: { id: true },
    });
    const ids = registrations.map(({ id }) => id);
    await prisma.emailMessage.deleteMany({ where: inEvent });
    await prisma.consent.deleteMany({ where: { registrationId: { in: ids } } });
    await prisma.checkin.deleteMany({ where: inEvent });
    await prisma.accessPoint.deleteMany({ where: inEvent });
    await prisma.pass.deleteMany({ where: { registrationId: { in: ids } } });
    await prisma.tableAllocation.deleteMany({ where: inEvent });
    await prisma.registration.deleteMany({ where: inEvent });
    await prisma.order.deleteMany({ where: inEvent });
    await prisma.guest.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.contact.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.company.deleteMany({ where: { name: { contains: run } } });
    await prisma.eventTable.deleteMany({ where: inEvent });
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
    await prisma.role.deleteMany({ where: { code: `SEAT_${run}` } });
  });

  it('accepts only real images as a plan', async () => {
    const put = (body: Buffer, type: string) =>
      admin.put(`${base()}/plan`).set('Content-Type', type).send(body);
    expect((await put(Buffer.from('no soy imagen'), 'image/png')).status).toBe(
      400,
    );
    expect((await put(PNG, 'image/png')).status).toBe(204);
    const plan = await admin
      .get(`${base()}/plan`)
      .buffer(true)
      .parse((res, callback) => {
        const stream = res as unknown as NodeJS.ReadableStream;
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(plan.status).toBe(200);
    expect(plan.headers['content-type']).toContain('image/png');
    expect((plan.body as Buffer).equals(PNG)).toBe(true);
    expect((await view()).tables).toEqual([]);
  });

  it('adds numbered tables and enforces who can change them', async () => {
    const created = await admin
      .post(`${base()}/tables`)
      .send({ count: 3, capacity: 4, zone: null });
    expect(created.status).toBe(201);
    const vip = await admin
      .post(`${base()}/tables`)
      .send({ count: 1, capacity: 4, zone: 'VIP' });
    expect(vip.status).toBe(201);
    const data = await view();
    expect(data.tables.map(({ name }) => name)).toEqual([
      'Mesa 1',
      'Mesa 2',
      'Mesa 3',
      'Mesa 4',
    ]);
    expect(data.tables[3]?.zone).toBe('VIP');

    expect((await viewer.get(`${base()}/`)).status).toBe(200);
    expect(
      (
        await viewer
          .post(`${base()}/tables`)
          .send({ count: 1, capacity: 4, zone: null })
      ).status,
    ).toBe(403);
    expect((await viewer.post(`${base()}/auto`)).status).toBe(403);
    expect((await viewer.post(`${base()}/publish`)).status).toBe(403);
  });

  it('keeps purchases of the same company together, even bought at different times', async () => {
    const first = await reconcile('compra1', { organization: company });
    expect(first.status).toBe(201);
    const alone = await reconcile('sola');
    expect(alone.status).toBe(201);
    // Se registran ellas mismas: su pase queda activo y pueden recibir su mesa.
    expect(
      (await addGuest(first.body.id as string, 'compra1', true)).status,
    ).toBe(201);
    expect((await addGuest(alone.body.id as string, 'sola', true)).status).toBe(
      201,
    );
    expect((await reconcile('compra2', { organization: company })).status).toBe(
      201,
    );

    const { group } = await groupOf(company);
    expect(group.seats).toBe(2);
    expect(group.orders).toHaveLength(2);

    const auto = await admin.post(`${base()}/auto`);
    expect(auto.status).toBe(200);
    expect(auto.body.unplacedSeats).toBe(0);

    const after = await groupOf(company);
    const tables = new Set(
      after.group.orders.flatMap((order) =>
        order.allocations.map((item) => item.tableId),
      ),
    );
    expect(tables.size).toBe(1);
    expect(after.group.placedSeats).toBe(2);
  });

  it('holds unregistered seats so nobody else takes them', async () => {
    const created = await reconcile('mesa4', {
      organization: `Grupo ${run}`,
      ticketTypeId: tableTicket,
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id as string;
    expect((await addGuest(orderId, 'uno')).status).toBe(201);

    expect((await admin.post(`${base()}/auto`)).status).toBe(200);
    const { data, group } = await groupOf(`Grupo ${run}`);
    expect(group.orders[0]?.allocations[0]?.seats).toBe(4);
    const tableId = group.orders[0]!.allocations[0]!.tableId;
    const table = data.tables.find(({ id }) => id === tableId)!;
    // Una persona registrada, cuatro lugares apartados.
    expect(table.occupied).toBe(4);
    expect(table.people).toHaveLength(1);

    // Quien se registra después ocupa un lugar ya apartado en esa mesa.
    expect((await addGuest(orderId, 'dos')).status).toBe(201);
    const later = await prisma.registration.findFirstOrThrow({
      where: { eventId, guest: { email: `dos@${domain}` } },
    });
    expect(later.tableId).toBe(tableId);
  });

  it('never fills a table past capacity by hand', async () => {
    const { data, group } = await groupOf(`Grupo ${run}`);
    const full = group.orders[0]!.allocations[0]!.tableId;
    const other = (await groupOf(company)).group;
    const moved = await admin.post(`${base()}/move-group`).send({
      orderIds: other.orders.map(({ id }) => id),
      tableId: full,
    });
    expect(moved.status).toBe(409);
    expect(moved.body.error).toContain('lugares libres');
    // El rechazo no deja nada a medias.
    expect((await groupOf(company)).group.placedSeats).toBe(2);
    expect(data.tables.length).toBe(4);
  });

  it('keeps what was moved by hand when seating again', async () => {
    const { data, group } = await groupOf(company);
    const empty = data.tables.find(
      (table) => table.occupied === 0 && !table.zone,
    );
    expect(empty).toBeDefined();
    const moved = await admin.post(`${base()}/move-group`).send({
      orderIds: group.orders.map(({ id }) => id),
      tableId: empty!.id,
    });
    expect(moved.status).toBe(204);

    expect((await admin.post(`${base()}/auto`)).status).toBe(200);
    const after = (await groupOf(company)).group;
    for (const order of after.orders) {
      expect(order.allocations[0]?.tableId).toBe(empty!.id);
      expect(order.allocations[0]?.locked).toBe(true);
    }

    const allocation = after.orders[0]!.allocations[0]!;
    const unlocked = await admin
      .post(`${base()}/allocations/${allocation.id}/lock`)
      .send({ locked: false });
    expect(unlocked.status).toBe(204);
    await admin
      .post(`${base()}/allocations/${allocation.id}/lock`)
      .send({ locked: true });
  });

  it('moves one person and keeps the count right', async () => {
    const { group } = await groupOf(`Grupo ${run}`);
    const order = group.orders[0]!;
    const person = order.people[0]!;
    const from = person.tableId!;
    const { data } = await groupOf(company);
    const target = data.tables.find(
      (table) => table.occupied < table.capacity && table.id !== from,
    )!;
    const moved = await admin
      .post(`${base()}/move-person`)
      .send({ registrationId: person.id, tableId: target.id });
    expect(moved.status).toBe(204);
    const after = await view();
    expect(after.tables.find(({ id }) => id === from)?.occupied).toBe(3);
    expect(after.tables.find(({ id }) => id === target.id)?.occupied).toBe(
      target.occupied + 1,
    );
    expect(
      after.tables
        .find(({ id }) => id === target.id)
        ?.people.map(({ name }) => name),
    ).toContain(person.name);
  });

  it('shows nothing to guests until published, then only notifies changes', async () => {
    const reg = await prisma.registration.findFirstOrThrow({
      where: { eventId, guest: { email: `sola@${domain}` } },
    });
    expect(reg.publishedTableId).toBeNull();
    const before = await view();
    expect(before.publishedAt).toBeNull();
    expect(before.pendingChanges).toBeGreaterThan(0);

    // Sin publicar, recepción y el invitado no ven la mesa.
    const offline = await admin.get(
      `/api/events/${eventId}/checkin/offline-list`,
    );
    expect(
      offline.body.entries.every(
        (entry: { tableName: string | null }) => entry.tableName === null,
      ),
    ).toBe(true);

    const count = await prisma.emailMessage.count({
      where: { eventId, kind: 'seat_notice' },
    });
    expect(count).toBe(0);

    const published = await admin.post(`${base()}/publish`);
    expect(published.status).toBe(200);
    expect(published.body.notified).toBeGreaterThan(0);

    const mails = await prisma.emailMessage.findMany({
      where: { eventId, kind: 'seat_notice' },
    });
    expect(mails.length).toBeGreaterThan(0);

    const after = await view();
    expect(after.publishedAt).not.toBeNull();
    expect(after.pendingChanges).toBe(0);

    // Publicar otra vez sin cambios no le escribe a nadie.
    const again = await admin.post(`${base()}/publish`);
    expect(again.body.notified).toBe(0);
    expect(
      await prisma.emailMessage.count({
        where: { eventId, kind: 'seat_notice' },
      }),
    ).toBe(mails.length);
  });

  it('sends the table with the pass, and reception sees it', async () => {
    const reg = await prisma.registration.findFirstOrThrow({
      where: { eventId, guest: { email: `compra1@${domain}` } },
      include: { passes: true, publishedTable: true },
    });
    expect(reg.publishedTable).not.toBeNull();
    const pass = reg.passes[0]!;
    const email = await renderEmail('seat_notice', pass.id);
    expect(email?.subject).toContain('Tu mesa');
    expect(email?.subject).toContain(reg.publishedTable!.name);
    expect(email?.html).toContain('cid:pase-qr');
    expect(email?.html).toContain(reg.publishedTable!.name);
    const list = await admin.get(`/api/events/${eventId}/checkin/offline-list`);
    const entry = list.body.entries.find(
      (item: { folio: string }) => item.folio === reg.folio,
    );
    expect(entry.tableName).toBe(reg.publishedTable!.name);
    const scan = await admin.post(`/api/events/${eventId}/checkin/scan`).send({
      clientId: `seat-${run}`,
      tokenHash: entry.tokenHash,
      accessPointId: pointId,
      scannedAt: new Date().toISOString(),
      manualReason: 'Prueba de mesa',
    });
    expect(scan.body.status).toBe('ok');
    expect(scan.body.tableName).toBe(reg.publishedTable!.name);
    const guests = await admin.get(`/api/events/${eventId}/guests?q=compra1`);
    expect(guests.body.guests[0].tableName).toBe(reg.publishedTable!.name);
  });

  it('lets a draft with tables and access points be deleted', async () => {
    const draft = await prisma.event.create({
      data: {
        seriesId,
        editionYear: 2031,
        modules: ['tables'],
        status: 'draft',
        slug: `bor-${run}`,
        name: `Borrador ${run}`,
        folioPrefix: 'BOR',
      },
    });
    await prisma.eventTable.create({
      data: { eventId: draft.id, name: 'Mesa 1', capacity: 10 },
    });
    await prisma.accessPoint.create({
      data: { eventId: draft.id, name: 'Fila A' },
    });
    const removed = await admin.del(`/api/events/${draft.id}`);
    expect(removed.status).toBeLessThan(300);
    expect(await prisma.event.count({ where: { id: draft.id } })).toBe(0);
  });

  it('protects a table in use and frees seats when an order is cancelled', async () => {
    const { group } = await groupOf(`Grupo ${run}`);
    const order = group.orders[0]!;
    const allocation = order.allocations[0]!;
    expect(
      (await admin.del(`${base()}/tables/${allocation.tableId}`)).status,
    ).toBe(409);
    const shrink = await admin
      .put(`${base()}/tables/${allocation.tableId}`)
      .send({
        name: allocation.tableName,
        capacity: 1,
        zone: null,
        x: 10,
        y: 10,
      });
    expect(shrink.status).toBe(409);

    const cancelled = await admin.post(
      `/api/events/${eventId}/orders/${order.id}/cancel`,
    );
    expect(cancelled.status).toBeLessThan(300);
    expect(
      await prisma.tableAllocation.count({ where: { orderId: order.id } }),
    ).toBe(0);
    const people = await prisma.registration.findMany({
      where: { orderId: order.id },
      select: { tableId: true, publishedTableId: true },
    });
    expect(
      people.every(
        ({ tableId, publishedTableId }) => !tableId && !publishedTableId,
      ),
    ).toBe(true);
  });
});

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';
import { toCsv } from '../src/modules/reports/csv.js';

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

interface Row {
  id: string;
  [key: string]: unknown;
}

describe('csv export', () => {
  it('neutralizes formulas, quotes separators and keeps real numbers', () => {
    const csv = toCsv(
      ['Nombre', 'Monto'],
      [
        ['=HYPERLINK("http://x")', -5],
        ['+5255', 10.5],
        ['@evil', null],
        ['Pérez, "Ana"', 0],
      ],
    );
    expect(csv.startsWith('﻿Nombre,Monto\r\n')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")",-5`);
    expect(csv).toContain(`'+5255,10.5`);
    expect(csv).toContain(`'@evil,\r\n`);
    expect(csv).toContain(`"Pérez, ""Ana""",0`);
  });
});

describe.skipIf(!process.env.RUN_DB_TESTS)('reports', () => {
  let admin: Awaited<ReturnType<typeof login>>;
  let viewer: Awaited<ReturnType<typeof login>>;
  let outsider: Awaited<ReturnType<typeof login>>;
  let seriesId = '';
  const ids: Record<string, string> = {};
  let ticket2030 = '';
  let ticket2031 = '';

  const register = (
    slug: string,
    ticketTypeId: string,
    name: string,
    organization: string | null = null,
  ) =>
    request(app)
      .post(`/api/public/events/${slug}/register`)
      .set('Origin', origin)
      .send({
        firstName: name,
        lastName: 'Prueba',
        email: `${name}@${domain}`,
        phone: '5512345678',
        organization,
        ticketTypeId,
        answers: {},
        privacyAccepted: true,
      });

  const payment = (amount: number, reference: string) => ({
    amount,
    method: 'transfer',
    reference,
    notes: null,
    paidAt: '2030-01-10T18:00:00.000Z',
  });

  const metricsOf = async (id: string) => {
    const response = await admin.get('/api/reports/events');
    expect(response.status).toBe(200);
    return (response.body as Row[]).find((row) => row.id === id)!;
  };

  beforeAll(async () => {
    await ensureSystemData(undefined);
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'ADMIN' },
    });
    const viewerRole = await prisma.role.create({
      data: {
        code: `REPV_${run}`,
        name: `Reportes ${run}`,
        permissions: { create: [{ permission: 'reports.view' }] },
      },
    });
    const outsiderRole = await prisma.role.create({
      data: {
        code: `REPX_${run}`,
        name: `Sin reportes ${run}`,
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
          email: `viewer@${domain}`,
          displayName: 'viewer',
          roleId: viewerRole.id,
        },
        {
          email: `outsider@${domain}`,
          displayName: 'outsider',
          roleId: outsiderRole.id,
        },
      ],
    });
    admin = await login('admin');
    viewer = await login('viewer');
    outsider = await login('outsider');

    const series = await prisma.eventSeries.create({
      data: { name: `Serie ${run}`, type: `Tipo ${run}` },
    });
    seriesId = series.id;
    const make = async (
      key: string,
      year: number,
      prefix: string,
      status = 'active',
    ) => {
      const event = await prisma.event.create({
        data: {
          seriesId,
          editionYear: year,
          modules: ['publicRegistration'],
          status,
          slug: `${key}-${run}`,
          name: `Evento ${key} ${run}`,
          folioPrefix: prefix,
          capacity: 10,
          startsAt: new Date(Date.UTC(year, 2, 1)),
        },
      });
      ids[key] = event.id;
      return event.id;
    };
    const first = await make('uno', 2030, 'RPA');
    const second = await make('dos', 2031, 'RPB');
    await make('bor', 2032, 'RPC', 'draft');
    ticket2030 = (
      await prisma.ticketType.create({
        data: { eventId: first, name: 'General', price: 100 },
      })
    ).id;
    ticket2031 = (
      await prisma.ticketType.create({
        data: { eventId: second, name: 'General', price: 100 },
      })
    ).id;
  });

  afterAll(async () => {
    const eventIds = Object.values(ids);
    const inEvents = { eventId: { in: eventIds } };
    const registrations = await prisma.registration.findMany({
      where: inEvents,
      select: { id: true },
    });
    const registrationIds = registrations.map(({ id }) => id);
    const orders = await prisma.order.findMany({
      where: inEvents,
      select: { id: true },
    });
    await prisma.emailMessage.deleteMany({ where: inEvents });
    await prisma.donation.deleteMany({ where: inEvents });
    await prisma.consent.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    await prisma.checkin.deleteMany({ where: inEvents });
    await prisma.accessPoint.deleteMany({ where: inEvents });
    await prisma.pass.deleteMany({
      where: { registrationId: { in: registrationIds } },
    });
    await prisma.registration.deleteMany({ where: inEvents });
    await prisma.payment.deleteMany({
      where: { orderId: { in: orders.map(({ id }) => id) } },
    });
    await prisma.order.deleteMany({ where: inEvents });
    await prisma.guest.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.contact.deleteMany({
      where: { email: { endsWith: `@${domain}` } },
    });
    await prisma.company.deleteMany({ where: { name: { contains: run } } });
    await prisma.ticketType.deleteMany({ where: inEvents });
    await prisma.eventCounter.deleteMany({ where: inEvents });
    await prisma.auditLog.deleteMany({
      where: { OR: [inEvents, { user: { email: { endsWith: domain } } }] },
    });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.eventSeries.delete({ where: { id: seriesId } });
    await prisma.authSession.deleteMany({
      where: { user: { email: { endsWith: domain } } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.role.deleteMany({
      where: { code: { in: [`REPV_${run}`, `REPX_${run}`] } },
    });
  });

  it('computes the metrics of each edition', async () => {
    const first = ids.uno!;
    const second = ids.dos!;
    const empresa = `Empresa ${run}`;

    // Edición 2030: Ana paga y asiste, Beto paga y no asiste, Caro no paga,
    // Dani cancela. Solo cuentan los pagos vigentes y los pedidos no cancelados.
    const orderOf = async (slug: string, name: string, org?: string) => {
      const response = await register(slug, ticket2030, name, org ?? null);
      expect(response.status).toBe(201);
      return prisma.order.findFirstOrThrow({
        where: { eventId: first, buyer: { email: `${name}@${domain}` } },
      });
    };
    const ana = await orderOf(`uno-${run}`, 'ana', empresa);
    const beto = await orderOf(`uno-${run}`, 'beto');
    await orderOf(`uno-${run}`, 'caro');
    const dani = await orderOf(`uno-${run}`, 'dani');
    for (const [order, reference] of [
      [ana, 'R-ANA'],
      [beto, 'R-BETO'],
    ] as const) {
      const paid = await admin
        .post(`/api/events/${first}/orders/${order.id}/payments`)
        .send(payment(100, reference));
      expect(paid.status).toBe(201);
    }
    expect(
      (await admin.post(`/api/events/${first}/orders/${dani.id}/cancel`))
        .status,
    ).toBeLessThan(300);

    const pass = await prisma.pass.findFirstOrThrow({
      where: { registration: { orderId: ana.id } },
    });
    const point = await prisma.accessPoint.create({
      data: { eventId: first, name: 'Puerta' },
    });
    await prisma.checkin.create({
      data: { eventId: first, passId: pass.id, accessPointId: point.id },
    });

    await prisma.donation.create({
      data: {
        eventId: first,
        amount: 500,
        method: 'cash',
        receivedAt: new Date(),
      },
    });
    await prisma.donation.create({
      data: {
        eventId: first,
        amount: 999,
        method: 'cash',
        receivedAt: new Date(),
        voidedAt: new Date(),
      },
    });

    // Edición 2031: Ana repite con su empresa; Eva es nueva.
    const again = await request(app)
      .post(`/api/public/events/dos-${run}/register`)
      .set('Origin', origin)
      .send({
        firstName: 'ana',
        lastName: 'Prueba',
        email: `ana@${domain}`,
        phone: '5512345678',
        organization: empresa,
        ticketTypeId: ticket2031,
        answers: {},
        privacyAccepted: true,
      });
    expect(again.status).toBe(201);
    expect((await register(`dos-${run}`, ticket2031, 'eva')).status).toBe(201);

    const one = await metricsOf(first);
    expect(one).toMatchObject({
      editionYear: 2030,
      capacity: 10,
      seatsTaken: 3,
      seatsSold: 2,
      occupancy: 0.3,
      registered: 2,
      attended: 1,
      attendanceRate: 0.5,
      income: 200,
      pendingIncome: 100,
      donations: 500,
      donationCount: 1,
      people: 3,
      newPeople: 3,
      returningPeople: 0,
      companies: 1,
      returningCompanies: 0,
    });

    const two = await metricsOf(second);
    expect(two).toMatchObject({
      income: 0,
      people: 2,
      newPeople: 1,
      returningPeople: 1,
      companies: 1,
      returningCompanies: 1,
      attendanceRate: null,
    });
  });

  it('never reports drafts and sorts newest first', async () => {
    const response = await admin.get('/api/reports/events');
    const rows = response.body as Row[];
    expect(rows.some(({ id }) => id === ids.bor)).toBe(false);
    const mine = rows.filter(({ id }) => id === ids.uno || id === ids.dos);
    expect(mine.map(({ id }) => id)).toEqual([ids.dos, ids.uno]);
  });

  it('enforces permissions: viewing does not allow exporting', async () => {
    expect((await viewer.get('/api/reports/events')).status).toBe(200);
    expect((await outsider.get('/api/reports/events')).status).toBe(403);
    for (const path of [
      '/api/reports/export/events.csv',
      '/api/reports/export/contacts.csv',
      '/api/reports/export/donations.csv',
      `/api/reports/export/events/${ids.uno}/registrations.csv`,
    ]) {
      expect((await viewer.get(path)).status).toBe(403);
    }
    expect((await request(app).get('/api/reports/events')).status).toBe(401);
  });

  it('exports filtered files and audits every download', async () => {
    const events = await admin.get(
      `/api/reports/export/events.csv?seriesId=${seriesId}&year=2030`,
    );
    expect(events.status).toBe(200);
    expect(events.headers['content-type']).toContain('text/csv');
    expect(events.headers['content-disposition']).toContain('attachment');
    expect(events.text).toContain(`Evento uno ${run}`);
    expect(events.text).not.toContain(`Evento dos ${run}`);

    const registrations = await admin.get(
      `/api/reports/export/events/${ids.uno}/registrations.csv`,
    );
    expect(registrations.status).toBe(200);
    expect(registrations.text).toContain(`ana@${domain}`);
    const anaLine = registrations.text
      .split('\r\n')
      .find((line) => line.includes(`ana@${domain}`));
    expect(anaLine).toContain('Sí');
    expect(anaLine).toContain('Registro público');
    expect(anaLine).not.toContain('Z,');

    const contacts = await admin.get(
      `/api/reports/export/contacts.csv?eventId=${ids.uno}&participation=attended`,
    );
    expect(contacts.status).toBe(200);
    expect(contacts.text).toContain(`ana@${domain}`);
    expect(contacts.text).not.toContain(`beto@${domain}`);

    const donations = await admin.get(
      `/api/reports/export/donations.csv?eventId=${ids.uno}`,
    );
    expect(donations.status).toBe(200);
    expect(donations.text).toContain('500');
    expect(donations.text).toContain('999');
    expect(donations.text).toContain('Efectivo');
    expect(donations.text).not.toContain(',cash,');

    const audit = await prisma.auditLog.findMany({
      where: {
        user: { email: `admin@${domain}` },
        action: { startsWith: 'report.export' },
      },
      select: { action: true },
    });
    expect(audit.map(({ action }) => action).sort()).toEqual([
      'report.export_contacts',
      'report.export_donations',
      'report.export_events',
      'report.export_registrations',
    ]);
  });

  it('lists paid seats nobody has registered yet', async () => {
    const reconciled = await admin
      .post(`/api/events/${ids.uno}/orders/reconciled`)
      .send({
        firstName: 'Frida',
        lastName: 'Prueba',
        email: `frida@${domain}`,
        phone: null,
        organization: null,
        ticketTypeId: ticket2030,
        quantity: 2,
        amount: 200,
        method: 'transfer',
        reference: 'R-FRIDA',
        notes: null,
        paidAt: '2030-01-10T18:00:00.000Z',
      });
    expect(reconciled.status).toBe(201);
    const file = await admin.get(
      `/api/reports/export/events/${ids.uno}/registrations.csv`,
    );
    const pending = file.text
      .split('\r\n')
      .filter(
        (line) =>
          line.includes(`frida@${domain}`) && line.includes('Por registrar'),
      );
    expect(pending).toHaveLength(2);
    expect(await metricsOf(ids.uno!).then((row) => row.seatsSold)).toBe(4);
  });
});

import express, { Router, type Request } from 'express';
import {
  seatingAddTablesSchema,
  seatingLockSchema,
  seatingMoveGroupSchema,
  seatingMovePersonSchema,
  seatingTableSchema,
  seatingZoneSchema,
} from '@uka/shared';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { currentUser, requireCsrf, requirePermission } from '../auth/auth.js';
import {
  autoSeat,
  groupKeyOf,
  groupLabelOf,
  loadSeatedOrders,
  moveGroup,
  movePerson,
  publishSeating,
} from './seating-service.js';

const MAX_PLAN_BYTES = 8 * 1024 * 1024;

function eventIdOf(request: Request): string {
  return (request.params as { eventId: string }).eventId;
}

const canView = requirePermission('seating.view', 'seating.manage');
const canManage = requirePermission('seating.manage');

/** Se confía en el contenido, no en lo que declara el navegador. */
function imageTypeOf(body: Buffer): 'image/png' | 'image/jpeg' | null {
  if (
    body.length > 8 &&
    body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png';
  }
  if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8) {
    return 'image/jpeg';
  }
  return null;
}

export const seatingRouter = Router({ mergeParams: true });

seatingRouter.get(
  '/',
  canView,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const [event, tables, orders, preferences, plan, pendingOrders] =
      await Promise.all([
        prisma.event.findUnique({
          where: { id: eventId },
          select: { seatingPublishedAt: true },
        }),
        prisma.eventTable.findMany({ where: { eventId } }),
        loadSeatedOrders(prisma, eventId),
        prisma.seatingPreference.findMany({ where: { eventId } }),
        prisma.eventPlan.findUnique({
          where: { eventId },
          select: { updatedAt: true },
        }),
        prisma.order.aggregate({
          where: { eventId, status: 'pending_payment' },
          _sum: { seats: true },
        }),
      ]);
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    const zones = new Map(
      preferences.map((item) => [item.groupKey, item.zone]),
    );

    const groups = new Map<
      string,
      {
        key: string;
        label: string;
        zone: string | null;
        seats: number;
        placedSeats: number;
        orders: unknown[];
      }
    >();
    const occupied = new Map<string, number>();
    const people = new Map<
      string,
      { id: string; name: string; folio: string; group: string }[]
    >();
    let changes = 0;
    let registeredPeople = 0;
    for (const order of orders) {
      const key = groupKeyOf(order);
      const label = groupLabelOf(order);
      const group = groups.get(key) ?? {
        key,
        label,
        zone: zones.get(key) ?? null,
        seats: 0,
        placedSeats: 0,
        orders: [],
      };
      const placed = order.allocations.reduce(
        (sum, item) => sum + item.seats,
        0,
      );
      for (const item of order.allocations) {
        occupied.set(
          item.tableId,
          (occupied.get(item.tableId) ?? 0) + item.seats,
        );
      }
      for (const registration of order.registrations) {
        registeredPeople += 1;
        if (registration.tableId !== registration.publishedTableId) {
          changes += 1;
        }
        if (registration.tableId) {
          const list = people.get(registration.tableId) ?? [];
          list.push({
            id: registration.id,
            name: `${registration.guest.firstName} ${registration.guest.lastName}`,
            folio: registration.folio,
            group: label,
          });
          people.set(registration.tableId, list);
        }
      }
      group.seats += order.seats;
      group.placedSeats += placed;
      group.orders.push({
        id: order.id,
        reference: order.reference,
        seats: order.seats,
        buyerName: `${order.buyer.firstName} ${order.buyer.lastName}`,
        allocations: order.allocations.map((item) => ({
          id: item.id,
          tableId: item.tableId,
          tableName: item.table.name,
          seats: item.seats,
          locked: item.locked,
        })),
        people: order.registrations.map((registration) => ({
          id: registration.id,
          name: `${registration.guest.firstName} ${registration.guest.lastName}`,
          folio: registration.folio,
          tableId: registration.tableId,
          pendingActivation: registration.passes.some(
            (pass) => pass.status === 'pending_activation',
          ),
        })),
      });
      groups.set(key, group);
    }

    response.json({
      publishedAt: event.seatingPublishedAt,
      pendingChanges: changes,
      registeredPeople,
      unpaidSeats: pendingOrders._sum.seats ?? 0,
      planVersion: plan ? plan.updatedAt.getTime() : null,
      tables: tables
        .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
        .map((table) => ({
          id: table.id,
          name: table.name,
          capacity: table.capacity,
          zone: table.zone,
          x: table.x,
          y: table.y,
          occupied: occupied.get(table.id) ?? 0,
          people: people.get(table.id) ?? [],
        })),
      groups: [...groups.values()].sort((a, b) =>
        a.label.localeCompare(b.label, 'es'),
      ),
    });
  }),
);

seatingRouter.get(
  '/plan',
  canView,
  asyncHandler(async (request, response) => {
    const plan = await prisma.eventPlan.findUnique({
      where: { eventId: eventIdOf(request) },
    });
    if (!plan) {
      throw new AppError(404, 'Este evento no tiene plano.');
    }
    response.setHeader('Content-Type', plan.mimeType);
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.send(Buffer.from(plan.data));
  }),
);

seatingRouter.put(
  '/plan',
  canManage,
  requireCsrf,
  express.raw({
    type: ['image/png', 'image/jpeg'],
    limit: MAX_PLAN_BYTES,
  }),
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const body = request.body as unknown;
    const mimeType = Buffer.isBuffer(body) ? imageTypeOf(body) : null;
    if (!mimeType || !Buffer.isBuffer(body)) {
      throw new AppError(400, 'El plano debe ser una imagen PNG o JPG.');
    }
    await prisma.eventPlan.upsert({
      where: { eventId },
      update: { data: new Uint8Array(body), mimeType },
      create: { eventId, data: new Uint8Array(body), mimeType },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'seating.plan',
      entityType: 'event',
      entityId: eventId,
      eventId,
    });
    response.status(204).end();
  }),
);

seatingRouter.post(
  '/tables',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const input = seatingAddTablesSchema.parse(request.body);
    const existing = await prisma.eventTable.findMany({
      where: { eventId },
      select: { name: true },
    });
    const names = new Set(existing.map(({ name }) => name));
    let number = 1;
    const data = [];
    // Quedan en cuadrícula sobre el plano, listas para arrastrarse a su lugar.
    const perRow = 8;
    for (let index = 0; index < input.count; index += 1) {
      while (names.has(`Mesa ${number}`)) {
        number += 1;
      }
      const name = `Mesa ${number}`;
      names.add(name);
      const slot = existing.length + index;
      data.push({
        eventId,
        name,
        capacity: input.capacity,
        zone: input.zone,
        x: 8 + (slot % perRow) * 12,
        y: 12 + Math.floor(slot / perRow) * 16,
      });
    }
    await prisma.eventTable.createMany({ data });
    response.status(201).json({ created: data.length });
  }),
);

seatingRouter.put(
  '/tables/:tableId',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { tableId } = request.params as { tableId: string };
    const input = seatingTableSchema.parse(request.body);
    const table = await prisma.eventTable.findFirst({
      where: { id: tableId, eventId },
    });
    if (!table) {
      throw new AppError(404, 'La mesa no existe.');
    }
    const used = await prisma.tableAllocation.aggregate({
      where: { tableId },
      _sum: { seats: true },
    });
    if ((used._sum.seats ?? 0) > input.capacity) {
      throw new AppError(
        409,
        `Esta mesa ya tiene ${used._sum.seats} lugares apartados.`,
      );
    }
    await prisma.eventTable.update({ where: { id: tableId }, data: input });
    response.status(204).end();
  }),
);

seatingRouter.delete(
  '/tables/:tableId',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { tableId } = request.params as { tableId: string };
    const table = await prisma.eventTable.findFirst({
      where: { id: tableId, eventId },
      include: { _count: { select: { allocations: true } } },
    });
    if (!table) {
      throw new AppError(404, 'La mesa no existe.');
    }
    if (table._count.allocations > 0) {
      throw new AppError(
        409,
        'Esta mesa tiene lugares asignados. Muévelos antes de borrarla.',
      );
    }
    await prisma.registration.updateMany({
      where: { publishedTableId: tableId },
      data: { publishedTableId: null },
    });
    await prisma.eventTable.delete({ where: { id: tableId } });
    response.status(204).end();
  }),
);

seatingRouter.put(
  '/groups/zone',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { groupKey, zone } = seatingZoneSchema.parse(request.body);
    if (zone) {
      await prisma.seatingPreference.upsert({
        where: { eventId_groupKey: { eventId, groupKey } },
        update: { zone },
        create: { eventId, groupKey, zone },
      });
    } else {
      await prisma.seatingPreference.deleteMany({
        where: { eventId, groupKey },
      });
    }
    response.status(204).end();
  }),
);

seatingRouter.post(
  '/auto',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const result = await autoSeat(eventId);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'seating.auto',
      entityType: 'event',
      entityId: eventId,
      eventId,
      details: {
        placed: result.placed,
        unplacedSeats: result.unplacedSeats,
      },
    });
    response.json(result);
  }),
);

seatingRouter.post(
  '/move-group',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { orderIds, tableId } = seatingMoveGroupSchema.parse(request.body);
    await moveGroup(eventIdOf(request), orderIds, tableId);
    response.status(204).end();
  }),
);

seatingRouter.post(
  '/move-person',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { registrationId, tableId } = seatingMovePersonSchema.parse(
      request.body,
    );
    await movePerson(eventIdOf(request), registrationId, tableId);
    response.status(204).end();
  }),
);

seatingRouter.post(
  '/allocations/:allocationId/lock',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { allocationId } = request.params as { allocationId: string };
    const { locked } = seatingLockSchema.parse(request.body);
    const { count } = await prisma.tableAllocation.updateMany({
      where: { id: allocationId, eventId: eventIdOf(request) },
      data: { locked },
    });
    if (count === 0) {
      throw new AppError(404, 'Ese lugar ya no está asignado.');
    }
    response.status(204).end();
  }),
);

seatingRouter.post(
  '/publish',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const result = await publishSeating(eventId);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'seating.publish',
      entityType: 'event',
      entityId: eventId,
      eventId,
      details: result,
    });
    response.json(result);
  }),
);

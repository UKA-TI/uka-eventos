import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { proposeSeating, type PlanGroup } from './seating-plan.js';

type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 };

const orderInclude = {
  buyer: { include: { contact: { include: { company: true } } } },
  allocations: { include: { table: { select: { name: true } } } },
  registrations: {
    where: { status: { not: 'cancelled' } },
    orderBy: { seatNumber: 'asc' },
    include: {
      guest: true,
      passes: {
        where: { status: { in: ['active', 'pending_activation'] } },
        select: { id: true, status: true },
      },
    },
  },
} satisfies Prisma.OrderInclude;

type LoadedOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Solo se acomoda lo pagado: un pedido pendiente aún puede no concretarse. */
export function loadSeatedOrders(tx: Tx, eventId: string) {
  return tx.order.findMany({
    where: { eventId, status: 'confirmed' },
    orderBy: { createdAt: 'asc' },
    include: orderInclude,
  });
}

/** Misma empresa, mismo grupo, aunque hayan comprado en momentos distintos. */
export function groupKeyOf(order: LoadedOrder): string {
  const companyId = order.buyer.contact?.companyId;
  return companyId ? `company:${companyId}` : `order:${order.id}`;
}

export function groupLabelOf(order: LoadedOrder): string {
  return (
    order.buyer.contact?.company?.name ??
    order.buyer.organization ??
    `${order.buyer.firstName} ${order.buyer.lastName}`
  );
}

async function lockEvent(tx: Tx, eventId: string) {
  await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
}

/** Sienta a las personas de un pedido según los lugares que tiene apartados. */
async function syncPeople(tx: Tx, order: LoadedOrder) {
  const allocations = await tx.tableAllocation.findMany({
    where: { orderId: order.id },
  });
  const free = new Map(allocations.map((item) => [item.tableId, item.seats]));
  const waiting: LoadedOrder['registrations'] = [];
  for (const registration of order.registrations) {
    const left = registration.tableId ? free.get(registration.tableId) : 0;
    if (registration.tableId && left && left > 0) {
      free.set(registration.tableId, left - 1);
    } else {
      waiting.push(registration);
    }
  }
  for (const registration of waiting) {
    const target =
      [...free.entries()].find(([, left]) => left > 0)?.[0] ?? null;
    if (target) {
      free.set(target, (free.get(target) ?? 0) - 1);
    }
    if (target !== registration.tableId) {
      await tx.registration.update({
        where: { id: registration.id },
        data: { tableId: target },
      });
    }
  }
}

/** Cuántos lugares tiene ocupados cada mesa, sumando lo apartado por cada pedido. */
async function occupancy(tx: Tx, eventId: string) {
  const rows = await tx.tableAllocation.groupBy({
    by: ['tableId'],
    where: { eventId },
    _sum: { seats: true },
  });
  return new Map(rows.map((row) => [row.tableId, row._sum.seats ?? 0]));
}

export async function autoSeat(eventId: string) {
  return prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const [tables, orders, preferences] = await Promise.all([
      tx.eventTable.findMany({ where: { eventId } }),
      loadSeatedOrders(tx, eventId),
      tx.seatingPreference.findMany({ where: { eventId } }),
    ]);
    const zones = new Map(
      preferences.map((item) => [item.groupKey, item.zone]),
    );
    // Lo fijado se queda: solo se reacomoda lo demás.
    await tx.tableAllocation.deleteMany({ where: { eventId, locked: false } });

    const lockedSeats = new Map<string, number>();
    const groups = new Map<string, PlanGroup>();
    for (const order of orders) {
      const locked = order.allocations.filter((item) => item.locked);
      const lockedTotal = locked.reduce((sum, item) => sum + item.seats, 0);
      for (const item of locked) {
        lockedSeats.set(
          item.tableId,
          (lockedSeats.get(item.tableId) ?? 0) + item.seats,
        );
      }
      const key = groupKeyOf(order);
      const group = groups.get(key) ?? {
        key,
        label: groupLabelOf(order),
        zone: zones.get(key) ?? null,
        orders: [],
        lockedTableIds: [],
      };
      group.orders.push({
        orderId: order.id,
        seats: Math.max(order.seats - lockedTotal, 0),
      });
      group.lockedTableIds.push(...locked.map((item) => item.tableId));
      groups.set(key, group);
    }

    const proposal = proposeSeating(
      tables.map((table) => ({
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        zone: table.zone,
        x: table.x,
        y: table.y,
        lockedSeats: lockedSeats.get(table.id) ?? 0,
      })),
      [...groups.values()],
    );
    if (proposal.allocations.length > 0) {
      await tx.tableAllocation.createMany({
        data: proposal.allocations.map((item) => ({ ...item, eventId })),
      });
    }
    for (const order of orders) {
      await syncPeople(tx, order);
    }
    return {
      warnings: proposal.warnings,
      unplacedSeats: proposal.unplacedSeats,
      placed: proposal.allocations.reduce((sum, item) => sum + item.seats, 0),
    };
  }, TX_OPTIONS);
}

/** Mover a mano deja fijo el lugar: un acomodo automático posterior no lo deshace. */
export async function moveGroup(
  eventId: string,
  orderIds: string[],
  tableId: string | null,
) {
  return prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds }, eventId, status: 'confirmed' },
      include: orderInclude,
    });
    if (orders.length !== orderIds.length || orders.length === 0) {
      throw new AppError(404, 'Ese grupo ya no está disponible.');
    }
    await tx.tableAllocation.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    if (tableId) {
      const table = await tx.eventTable.findFirst({
        where: { id: tableId, eventId },
      });
      if (!table) {
        throw new AppError(404, 'La mesa no existe.');
      }
      const seats = orders.reduce((sum, order) => sum + order.seats, 0);
      const used = (await occupancy(tx, eventId)).get(tableId) ?? 0;
      if (used + seats > table.capacity) {
        throw new AppError(
          409,
          `${table.name} tiene ${table.capacity - used} lugares libres y este grupo necesita ${seats}.`,
        );
      }
      await tx.tableAllocation.createMany({
        data: orders.map((order) => ({
          eventId,
          orderId: order.id,
          tableId,
          seats: order.seats,
          locked: true,
        })),
      });
    }
    for (const order of orders) {
      await syncPeople(tx, order);
    }
  }, TX_OPTIONS);
}

export async function movePerson(
  eventId: string,
  registrationId: string,
  tableId: string | null,
) {
  return prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const registration = await tx.registration.findFirst({
      where: { id: registrationId, eventId, status: { not: 'cancelled' } },
    });
    if (!registration) {
      throw new AppError(404, 'Este invitado ya no está disponible.');
    }
    if (registration.tableId === tableId) {
      return;
    }
    const orderId = registration.orderId;
    if (registration.tableId) {
      const current = await tx.tableAllocation.findUnique({
        where: {
          orderId_tableId: { orderId, tableId: registration.tableId },
        },
      });
      if (current && current.seats <= 1) {
        await tx.tableAllocation.delete({ where: { id: current.id } });
      } else if (current) {
        await tx.tableAllocation.update({
          where: { id: current.id },
          data: { seats: current.seats - 1 },
        });
      }
    }
    if (tableId) {
      const table = await tx.eventTable.findFirst({
        where: { id: tableId, eventId },
      });
      if (!table) {
        throw new AppError(404, 'La mesa no existe.');
      }
      const used = (await occupancy(tx, eventId)).get(tableId) ?? 0;
      if (used + 1 > table.capacity) {
        throw new AppError(409, `${table.name} ya está llena.`);
      }
      await tx.tableAllocation.upsert({
        where: { orderId_tableId: { orderId, tableId } },
        update: { seats: { increment: 1 }, locked: true },
        create: { eventId, orderId, tableId, seats: 1, locked: true },
      });
    }
    await tx.registration.update({
      where: { id: registration.id },
      data: { tableId },
    });
  }, TX_OPTIONS);
}

/**
 * Hace visible el acomodo y avisa solo a quien le cambió la mesa. Quien no ha activado
 * su pase recibe esa invitación, que ya lleva su mesa.
 */
export async function publishSeating(eventId: string) {
  return prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);
    const registrations = await tx.registration.findMany({
      where: { eventId, status: 'confirmed' },
      include: {
        guest: { select: { email: true } },
        passes: {
          where: { status: { in: ['active', 'pending_activation'] } },
          select: { id: true, status: true, checkin: { select: { id: true } } },
        },
      },
    });
    let notified = 0;
    let unassigned = 0;
    for (const registration of registrations) {
      if (!registration.tableId) {
        unassigned += 1;
      }
      if (registration.tableId === registration.publishedTableId) {
        continue;
      }
      await tx.registration.update({
        where: { id: registration.id },
        data: { publishedTableId: registration.tableId },
      });
      const pass = registration.passes[0];
      if (
        registration.tableId &&
        registration.guest.email &&
        pass &&
        !pass.checkin
      ) {
        await tx.emailMessage.create({
          data: {
            eventId,
            kind: pass.status === 'active' ? 'seat_notice' : 'pass_activation',
            refId: pass.id,
            toEmail: registration.guest.email,
          },
        });
        notified += 1;
      }
    }
    await tx.event.update({
      where: { id: eventId },
      data: { seatingPublishedAt: new Date() },
    });
    return { notified, unassigned };
  }, TX_OPTIONS);
}

/**
 * Un invitado capturado después del acomodo ocupa un lugar que su compra ya tenía
 * apartado. Si el acomodo ya se publicó, lo ve de inmediato.
 */
export async function seatNewGuest(
  tx: Tx,
  orderId: string,
  registrationId: string,
) {
  const [allocations, seated, order] = await Promise.all([
    tx.tableAllocation.findMany({ where: { orderId } }),
    tx.registration.groupBy({
      by: ['tableId'],
      where: {
        orderId,
        status: { not: 'cancelled' },
        tableId: { not: null },
      },
      _count: { _all: true },
    }),
    tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { event: { select: { seatingPublishedAt: true } } },
    }),
  ]);
  const used = new Map(seated.map((row) => [row.tableId, row._count._all]));
  const target = allocations.find(
    (item) => (used.get(item.tableId) ?? 0) < item.seats,
  );
  if (!target) {
    return;
  }
  await tx.registration.update({
    where: { id: registrationId },
    data: {
      tableId: target.tableId,
      ...(order.event.seatingPublishedAt
        ? { publishedTableId: target.tableId }
        : {}),
    },
  });
}

/** Un pedido que deja de estar pagado libera sus lugares. */
export async function releaseOrderSeats(tx: Tx, orderId: string) {
  await tx.tableAllocation.deleteMany({ where: { orderId } });
  await tx.registration.updateMany({
    where: { orderId },
    data: { tableId: null, publishedTableId: null },
  });
}

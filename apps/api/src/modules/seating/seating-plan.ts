/**
 * Propone el acomodo de un evento. Es una función pura: no toca la base de datos y
 * nada se les muestra a los invitados hasta que el equipo publica.
 */

export interface PlanTable {
  id: string;
  name: string;
  capacity: number;
  zone: string | null;
  x: number;
  y: number;
  /** Lugares ocupados por lo que el equipo fijó a mano. */
  lockedSeats: number;
}

export interface PlanOrder {
  orderId: string;
  /** Lugares que falta acomodar: los comprados menos los ya fijados. */
  seats: number;
}

export interface PlanGroup {
  key: string;
  label: string;
  /** Si el equipo lo reservó para una zona, como VIP. */
  zone: string | null;
  orders: PlanOrder[];
  /** Mesas donde el grupo ya tiene gente fijada: se intenta completar ahí. */
  lockedTableIds: string[];
}

export interface PlanAllocation {
  orderId: string;
  tableId: string;
  seats: number;
}

export interface PlanWarning {
  groupKey: string;
  label: string;
  kind: 'no_fit' | 'split' | 'outside_zone';
  message: string;
}

export interface SeatingProposal {
  allocations: PlanAllocation[];
  warnings: PlanWarning[];
  unplacedSeats: number;
}

const seatsOf = (group: PlanGroup) =>
  group.orders.reduce((sum, order) => sum + order.seats, 0);

export function proposeSeating(
  tables: PlanTable[],
  groups: PlanGroup[],
): SeatingProposal {
  const free = new Map(
    tables.map((table) => [
      table.id,
      Math.max(table.capacity - table.lockedSeats, 0),
    ]),
  );
  const allocations: PlanAllocation[] = [];
  const warnings: PlanWarning[] = [];
  let unplacedSeats = 0;

  const place = (group: PlanGroup, tableId: string, count: number) => {
    let pending = count;
    for (const order of group.orders) {
      if (pending === 0) {
        break;
      }
      const used = allocations
        .filter((item) => item.orderId === order.orderId)
        .reduce((sum, item) => sum + item.seats, 0);
      const seats = Math.min(order.seats - used, pending);
      if (seats > 0) {
        allocations.push({ orderId: order.orderId, tableId, seats });
        pending -= seats;
      }
    }
    free.set(tableId, (free.get(tableId) ?? 0) - count);
  };

  /** La mesa que menos lugares desperdicia, para aprovechar el cupo. */
  const bestFit = (candidates: PlanTable[], size: number) =>
    candidates
      .filter((table) => (free.get(table.id) ?? 0) >= size)
      .sort(
        (a, b) =>
          (free.get(a.id) ?? 0) - (free.get(b.id) ?? 0) ||
          a.name.localeCompare(b.name, 'es', { numeric: true }),
      )[0];

  // Primero los reservados para una zona y, dentro de eso, los grupos grandes: los
  // grandes son los más difíciles de acomodar cuando las mesas ya están parcialmente llenas.
  const ordered = [...groups]
    .filter((group) => seatsOf(group) > 0)
    .sort(
      (a, b) =>
        Number(Boolean(b.zone)) - Number(Boolean(a.zone)) ||
        seatsOf(b) - seatsOf(a) ||
        a.label.localeCompare(b.label, 'es'),
    );

  for (const group of ordered) {
    const size = seatsOf(group);
    const inZone = tables.filter((table) => table.zone === group.zone);
    // Sin zona propia, las mesas reservadas son el último recurso.
    const open = tables.filter((table) => !table.zone);
    const preferred = group.zone ? inZone : open;
    const fallback = tables.filter((table) => !preferred.includes(table));
    const own = tables.filter((table) =>
      group.lockedTableIds.includes(table.id),
    );

    const single =
      bestFit(own, size) ?? bestFit(preferred, size) ?? bestFit(fallback, size);
    if (single) {
      place(group, single.id, size);
      if (group.zone && single.zone !== group.zone) {
        warnings.push({
          groupKey: group.key,
          label: group.label,
          kind: 'outside_zone',
          message: `No cupo en la zona ${group.zone}: quedó en ${single.name}.`,
        });
      }
      continue;
    }

    const largest = Math.max(0, ...tables.map((table) => table.capacity));
    if (size <= largest) {
      // Cabría en una mesa vacía, pero ya no hay ninguna con lugar suficiente. No se
      // separa por su cuenta: el equipo decide si abre otra mesa o lo divide a mano.
      unplacedSeats += size;
      warnings.push({
        groupKey: group.key,
        label: group.label,
        kind: 'no_fit',
        message: `${size} lugares no caben juntos en ninguna mesa disponible.`,
      });
      continue;
    }

    // Es más grande que cualquier mesa: dividirlo es inevitable, y se avisa. Se usan
    // las mesas más cercanas entre sí en el plano.
    const pool = [...preferred, ...fallback].filter(
      (table) => (free.get(table.id) ?? 0) > 0,
    );
    const start = [...pool].sort(
      (a, b) => (free.get(b.id) ?? 0) - (free.get(a.id) ?? 0),
    )[0];
    if (!start) {
      unplacedSeats += size;
      warnings.push({
        groupKey: group.key,
        label: group.label,
        kind: 'no_fit',
        message: `${size} lugares no tienen mesa disponible.`,
      });
      continue;
    }
    const near = [...pool].sort(
      (a, b) =>
        Math.hypot(a.x - start.x, a.y - start.y) -
        Math.hypot(b.x - start.x, b.y - start.y),
    );
    let pending = size;
    const used: string[] = [];
    for (const table of near) {
      if (pending === 0) {
        break;
      }
      const seats = Math.min(free.get(table.id) ?? 0, pending);
      if (seats > 0) {
        place(group, table.id, seats);
        used.push(table.name);
        pending -= seats;
      }
    }
    unplacedSeats += pending;
    warnings.push({
      groupKey: group.key,
      label: group.label,
      kind: pending > 0 ? 'no_fit' : 'split',
      message:
        pending > 0
          ? `Solo se acomodaron ${size - pending} de ${size} lugares (${used.join(', ')}).`
          : `Es más grande que una mesa: quedó dividido en ${used.join(', ')}.`,
    });
  }

  return { allocations, warnings, unplacedSeats };
}

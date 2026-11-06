import { prisma } from '../../database.js';

export interface EventMetrics {
  id: string;
  name: string;
  status: string;
  editionYear: number;
  startsAt: Date | null;
  seriesId: string;
  seriesName: string;
  eventType: string;
  capacity: number | null;
  seatsTaken: number;
  seatsSold: number;
  occupancy: number | null;
  registered: number;
  attended: number;
  attendanceRate: number | null;
  income: number;
  pendingIncome: number;
  donations: number;
  donationCount: number;
  people: number;
  newPeople: number;
  returningPeople: number;
  companies: number;
  returningCompanies: number;
}

const ratio = (part: number, whole: number | null) =>
  whole ? part / whole : null;

function addTo(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * Métricas de cada evento publicado. "Nuevo" y "repite" se calculan recorriendo los
 * eventos en orden cronológico, sin importar qué filtre después la pantalla: alguien
 * que vino a la Gala 2026 repite en la Carrera 2027 aunque solo se mire 2027.
 */
export async function eventMetrics(): Promise<EventMetrics[]> {
  const published = { event: { status: { not: 'draft' } } };
  const [
    events,
    registrations,
    orders,
    checkins,
    payments,
    refunds,
    donations,
  ] = await Promise.all([
    prisma.event.findMany({
      where: { status: { not: 'draft' } },
      include: { series: { select: { name: true, type: true } } },
    }),
    prisma.registration.findMany({
      where: { ...published, status: { not: 'cancelled' } },
      select: {
        eventId: true,
        status: true,
        guest: {
          select: {
            contactId: true,
            contact: { select: { companyId: true } },
          },
        },
      },
    }),
    prisma.order.findMany({
      where: { ...published, status: { not: 'cancelled' } },
      select: {
        id: true,
        eventId: true,
        status: true,
        seats: true,
        amountDue: true,
        buyer: {
          select: {
            contactId: true,
            contact: { select: { companyId: true } },
          },
        },
      },
    }),
    prisma.checkin.groupBy({
      by: ['eventId'],
      where: published,
      _count: { _all: true },
    }),
    prisma.payment.findMany({
      // Una compra cancelada no borra su dinero: lo no devuelto sigue siendo ingreso.
      where: { voidedAt: null, order: published },
      select: {
        amount: true,
        orderId: true,
        order: { select: { eventId: true } },
      },
    }),
    prisma.refund.findMany({
      where: { voidedAt: null, order: published },
      select: { amount: true, order: { select: { eventId: true } } },
    }),
    prisma.donation.groupBy({
      by: ['eventId'],
      where: { voidedAt: null, eventId: { not: null } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const income = new Map<string, number>();
  const paidByOrder = new Map<string, number>();
  for (const payment of payments) {
    const amount = payment.amount.toNumber();
    addTo(income, payment.order.eventId, amount);
    addTo(paidByOrder, payment.orderId, amount);
  }

  for (const refund of refunds) {
    addTo(income, refund.order.eventId, -refund.amount.toNumber());
  }

  const seatsTaken = new Map<string, number>();
  const seatsSold = new Map<string, number>();
  const pendingIncome = new Map<string, number>();
  const peopleByEvent = new Map<string, Set<string>>();
  const companiesByEvent = new Map<string, Set<string>>();
  const note = (
    eventId: string,
    person: {
      contactId: string | null;
      contact: { companyId: string | null } | null;
    },
  ) => {
    if (person.contactId) {
      const people = peopleByEvent.get(eventId) ?? new Set();
      peopleByEvent.set(eventId, people.add(person.contactId));
    }
    if (person.contact?.companyId) {
      const companies = companiesByEvent.get(eventId) ?? new Set();
      companiesByEvent.set(eventId, companies.add(person.contact.companyId));
    }
  };

  for (const order of orders) {
    addTo(seatsTaken, order.eventId, order.seats);
    if (order.status === 'confirmed') {
      addTo(seatsSold, order.eventId, order.seats);
    } else {
      addTo(
        pendingIncome,
        order.eventId,
        Math.max(
          order.amountDue.toNumber() - (paidByOrder.get(order.id) ?? 0),
          0,
        ),
      );
    }
    note(order.eventId, order.buyer);
  }

  const registered = new Map<string, number>();
  for (const registration of registrations) {
    if (registration.status === 'confirmed') {
      addTo(registered, registration.eventId, 1);
    }
    note(registration.eventId, registration.guest);
  }

  const attended = new Map(
    checkins.map((row) => [row.eventId, row._count._all]),
  );
  const donationsByEvent = new Map(
    donations.map((row) => [
      row.eventId,
      { total: row._sum.amount?.toNumber() ?? 0, count: row._count._all },
    ]),
  );

  const when = (event: { startsAt: Date | null; createdAt: Date }) =>
    (event.startsAt ?? event.createdAt).getTime();
  const seenPeople = new Set<string>();
  const seenCompanies = new Set<string>();

  const rows = [...events]
    .sort((a, b) => when(a) - when(b))
    .map((event): EventMetrics => {
      const people = peopleByEvent.get(event.id) ?? new Set<string>();
      const companies = companiesByEvent.get(event.id) ?? new Set<string>();
      const returningPeople = [...people].filter((id) => seenPeople.has(id));
      const returningCompanies = [...companies].filter((id) =>
        seenCompanies.has(id),
      );
      people.forEach((id) => seenPeople.add(id));
      companies.forEach((id) => seenCompanies.add(id));

      const taken = seatsTaken.get(event.id) ?? 0;
      const confirmedPeople = registered.get(event.id) ?? 0;
      const came = attended.get(event.id) ?? 0;
      const donated = donationsByEvent.get(event.id);
      return {
        id: event.id,
        name: event.name,
        status: event.status,
        editionYear: event.editionYear,
        startsAt: event.startsAt,
        seriesId: event.seriesId,
        seriesName: event.series.name,
        eventType: event.series.type,
        capacity: event.capacity,
        seatsTaken: taken,
        seatsSold: seatsSold.get(event.id) ?? 0,
        occupancy: ratio(taken, event.capacity),
        registered: confirmedPeople,
        attended: came,
        attendanceRate: ratio(came, confirmedPeople),
        income: income.get(event.id) ?? 0,
        pendingIncome: pendingIncome.get(event.id) ?? 0,
        donations: donated?.total ?? 0,
        donationCount: donated?.count ?? 0,
        people: people.size,
        newPeople: people.size - returningPeople.length,
        returningPeople: returningPeople.length,
        companies: companies.size,
        returningCompanies: returningCompanies.length,
      };
    });
  return rows.reverse();
}

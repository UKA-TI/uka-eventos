import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { asyncHandler } from '../../async-handler.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { currentUser, requirePermission } from '../auth/auth.js';
import { groupUrl } from '../passes/tokens.js';

const PAGE_SIZE = 50;
const LAST_PERIOD_MS = 15 * 60 * 1000;
// Una gráfica con más barras no se lee: si la recepción duró mucho, se agrupa más.
const MAX_BUCKETS = 48;

function eventIdOf(request: Request): string {
  return (request.params as { eventId: string }).eventId;
}

export const eventViewsRouter = Router({ mergeParams: true });

const canSeeGuests = requirePermission(
  'registrations.view',
  'registrations.manage',
  'payments.manage',
  'checkin.manage',
);

/** Solo conteos, sin datos de personas: lo puede ver quien tenga acceso al evento. */
eventViewsRouter.get(
  '/dashboard',
  requirePermission(
    'events.view',
    'events.create',
    'events.edit',
    'checkin.operate',
    'checkin.manage',
    'reports.view',
  ),
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { capacity: true, timeZone: true },
    });
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    const now = Date.now();
    const [
      sold,
      registered,
      pendingActivation,
      checkins,
      incidents,
      accessPoints,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: { eventId, status: 'confirmed' },
        _sum: { seats: true },
      }),
      prisma.registration.count({ where: { eventId, status: 'confirmed' } }),
      prisma.pass.count({
        where: { status: 'pending_activation', registration: { eventId } },
      }),
      prisma.checkin.findMany({
        where: { eventId },
        orderBy: { checkedInAt: 'asc' },
        select: { checkedInAt: true, accessPointId: true },
      }),
      prisma.incident.groupBy({
        by: ['status'],
        where: { eventId },
        _count: { _all: true },
      }),
      prisma.accessPoint.findMany({
        where: { eventId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

    const perPoint = new Map<string, number>();
    for (const checkin of checkins) {
      perPoint.set(
        checkin.accessPointId,
        (perPoint.get(checkin.accessPointId) ?? 0) + 1,
      );
    }

    let bucketMinutes = 15;
    const times = checkins.map((checkin) => checkin.checkedInAt.getTime());
    const first = times[0];
    const last = times[times.length - 1];
    if (first !== undefined && last !== undefined) {
      while ((last - first) / (bucketMinutes * 60_000) >= MAX_BUCKETS) {
        bucketMinutes *= 2;
      }
    }
    const size = bucketMinutes * 60_000;
    const timeline: { start: string; label: string; count: number }[] = [];
    if (first !== undefined && last !== undefined) {
      const counts = new Map<number, number>();
      for (const time of times) {
        const bucket = Math.floor(time / size) * size;
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      }
      for (
        let bucket = Math.floor(first / size) * size;
        bucket <= last;
        bucket += size
      ) {
        timeline.push({
          start: new Date(bucket).toISOString(),
          label: new Date(bucket).toLocaleTimeString('es-MX', {
            timeZone: event.timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          count: counts.get(bucket) ?? 0,
        });
      }
    }

    const incidentCount = (status: string) =>
      incidents.find((row) => row.status === status)?._count._all ?? 0;
    const seatsSold = sold._sum.seats ?? 0;

    response.json({
      updatedAt: new Date(now).toISOString(),
      capacity: event.capacity,
      seatsSold,
      seatsToRegister: Math.max(seatsSold - registered, 0),
      registered,
      pendingActivation,
      checkedIn: checkins.length,
      lastPeriodCheckins: times.filter((time) => time >= now - LAST_PERIOD_MS)
        .length,
      pendingArrival: Math.max(registered - checkins.length, 0),
      incidentsOpen: incidentCount('open'),
      incidentsResolved: incidentCount('resolved'),
      bucketMinutes,
      timeline,
      accessPoints: accessPoints.map((point) => ({
        id: point.id,
        name: point.name,
        count: perPoint.get(point.id) ?? 0,
      })),
    });
  }),
);

const guestQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(120).optional(),
  status: z
    .enum(['checked_in', 'pending', 'activation', 'payment', 'incident'])
    .optional(),
  orderId: z.string().max(30).optional(),
});

function statusWhere(
  status: z.infer<typeof guestQuerySchema>['status'],
): Prisma.RegistrationWhereInput {
  switch (status) {
    case 'checked_in':
      return { passes: { some: { checkin: { isNot: null } } } };
    case 'incident':
      return { passes: { some: { incidents: { some: { status: 'open' } } } } };
    case 'activation':
      return { passes: { some: { status: 'pending_activation' } } };
    case 'payment':
      return { status: 'pending' };
    case 'pending':
      return {
        status: 'confirmed',
        passes: { some: { status: 'active', checkin: { is: null } } },
      };
    default:
      return {};
  }
}

const groupLabel = (order: {
  seats: number;
  source: string;
  buyer: {
    firstName: string;
    lastName: string;
    organization: string | null;
  };
}) =>
  order.seats > 1 || order.source === 'reconciled'
    ? (order.buyer.organization ??
      `${order.buyer.firstName} ${order.buyer.lastName}`)
    : null;

eventViewsRouter.get(
  '/guests',
  canSeeGuests,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { page, q, status, orderId } = guestQuerySchema.parse(request.query);
    const base: Prisma.RegistrationWhereInput = {
      eventId,
      status: { not: 'cancelled' },
    };
    const where: Prisma.RegistrationWhereInput = {
      AND: [
        base,
        statusWhere(status),
        orderId ? { orderId } : {},
        q
          ? {
              OR: [
                { folio: { contains: q } },
                { guest: { firstName: { contains: q } } },
                { guest: { lastName: { contains: q } } },
                { guest: { email: { contains: q } } },
                { guest: { organization: { contains: q } } },
              ],
            }
          : {},
      ],
    };
    const [registrations, total, allGuests] = await Promise.all([
      prisma.registration.findMany({
        where,
        orderBy: { folio: 'asc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          guest: true,
          publishedTable: { select: { name: true } },
          order: {
            include: {
              buyer: true,
              ticketType: { select: { name: true } },
            },
          },
          passes: {
            where: { status: { not: 'revoked' } },
            include: {
              incidents: {
                where: { status: 'open' },
                select: { id: true },
              },
              checkin: {
                include: {
                  accessPoint: { select: { name: true } },
                  operator: { select: { displayName: true } },
                },
              },
            },
          },
        },
      }),
      prisma.registration.count({ where }),
      prisma.registration.count({ where: base }),
    ]);

    response.json({
      guests: registrations.map((registration) => {
        const pass = registration.passes[0];
        const checkin = pass?.checkin ?? null;
        const state =
          pass && pass.incidents.length > 0
            ? 'incident'
            : checkin
              ? 'checked_in'
              : pass?.status === 'pending_activation'
                ? 'activation'
                : registration.status === 'pending'
                  ? 'payment'
                  : 'pending';
        return {
          id: registration.id,
          name: `${registration.guest.firstName} ${registration.guest.lastName}`,
          email: registration.guest.email,
          folio: registration.folio,
          group: groupLabel(registration.order),
          tableName: registration.publishedTable?.name ?? null,
          organization: registration.guest.organization,
          ticketName: registration.order.ticketType.name,
          status: state,
          checkedInAt: checkin?.checkedInAt ?? null,
          accessPointName: checkin?.accessPoint.name ?? null,
          operatorName: checkin?.operator?.displayName ?? null,
        };
      }),
      total,
      page,
      pageSize: PAGE_SIZE,
      allGuests,
    });
  }),
);

eventViewsRouter.get(
  '/groups',
  canSeeGuests,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { permissions } = currentUser(request);
    // La liga permite agregar y quitar invitados: solo para quien administra.
    const showLinks =
      permissions.includes('registrations.manage') ||
      permissions.includes('payments.manage');
    const orders = await prisma.order.findMany({
      where: {
        eventId,
        status: 'confirmed',
        groupTokenHash: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        buyer: true,
        registrations: {
          where: { status: { not: 'cancelled' } },
          select: {
            passes: {
              where: { status: 'active' },
              select: { id: true },
            },
          },
        },
      },
    });
    response.json(
      orders.map((order) => ({
        id: order.id,
        reference: order.reference,
        company:
          order.buyer.organization ??
          `${order.buyer.firstName} ${order.buyer.lastName}`,
        buyerName: `${order.buyer.firstName} ${order.buyer.lastName}`,
        buyerEmail: order.buyer.email,
        delegateName: order.delegateName,
        delegateEmail: order.delegateEmail,
        registrationDeadline: order.registrationDeadline,
        seats: order.seats,
        registered: order.registrations.length,
        activated: order.registrations.filter((item) => item.passes.length > 0)
          .length,
        groupUrl: showLinks ? groupUrl(order.id) : null,
      })),
    );
  }),
);

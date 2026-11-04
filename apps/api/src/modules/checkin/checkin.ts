import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import {
  accessPointInputSchema,
  authorizedGuestSchema,
  checkinBatchSchema,
  checkinItemSchema,
  incidentInputSchema,
  incidentResolveSchema,
  isEventModuleKey,
  type CheckinItem,
  type CheckinResult,
} from '@uka/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { currentUser, requireCsrf, requirePermission } from '../auth/auth.js';
import { createAuthorizedGuest } from '../orders/order-service.js';
import { hashToken, passToken } from '../passes/tokens.js';

const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 };
const canOperate = requirePermission('checkin.operate', 'checkin.manage');
const canManage = requirePermission('checkin.manage');

const passInclude = {
  registration: {
    include: {
      guest: { select: { firstName: true, lastName: true } },
      order: { include: { ticketType: { select: { name: true } } } },
      publishedTable: { select: { name: true } },
    },
  },
  checkin: {
    include: {
      accessPoint: { select: { name: true } },
      operator: { select: { displayName: true } },
    },
  },
} satisfies Prisma.PassInclude;

type LoadedPass = Prisma.PassGetPayload<{ include: typeof passInclude }>;

function eventIdOf(request: Request): string {
  return (request.params as { eventId: string }).eventId;
}

function guestView(pass: LoadedPass) {
  const { registration } = pass;
  return {
    guestName: `${registration.guest.firstName} ${registration.guest.lastName}`,
    folio: registration.folio,
    ticketName: registration.order.ticketType.name,
    tableName: registration.publishedTable?.name ?? null,
  };
}

async function nextRaffleFolio(tx: Prisma.TransactionClient, eventId: string) {
  await tx.eventCounter.upsert({
    where: { eventId_counterType: { eventId, counterType: 'raffle' } },
    update: {},
    create: { eventId, counterType: 'raffle', currentValue: 0 },
  });
  const rows = await tx.$queryRaw<{ currentValue: number | bigint }[]>`
    SELECT current_value AS currentValue FROM event_counters
    WHERE event_id = ${eventId} AND counter_type = 'raffle' FOR UPDATE`;
  const next = Number(rows[0]?.currentValue ?? 0) + 1;
  await tx.eventCounter.update({
    where: { eventId_counterType: { eventId, counterType: 'raffle' } },
    data: { currentValue: next },
  });
  return `R-${String(next).padStart(4, '0')}`;
}

function incidentOutcome(
  incident: { type: string; description: string },
  pass: LoadedPass | null,
): CheckinResult {
  const guest = pass ? guestView(pass) : null;
  if (incident.type === 'duplicate' && pass?.checkin) {
    return {
      status: 'duplicate',
      ...guest!,
      checkedInAt: pass.checkin.checkedInAt.toISOString(),
      accessPointName: pass.checkin.accessPoint.name,
      operatorName: pass.checkin.operator?.displayName ?? null,
    };
  }
  if (incident.type === 'revoked' && guest) {
    return { status: 'revoked', ...guest };
  }
  return { status: 'unknown' };
}

/**
 * Registra una lectura. El mismo proceso atiende el escaneo en vivo y lo que
 * llega al sincronizar. Repetir un clientId no duplica nada, porque un teléfono
 * puede reenviar su cola si se corta la conexión a media respuesta.
 */
async function processItem(params: {
  eventId: string;
  item: CheckinItem;
  operatorId: string;
  source: 'online' | 'offline';
}): Promise<CheckinResult> {
  const { eventId, item, operatorId, source } = params;

  const run = () =>
    prisma.$transaction(async (tx): Promise<CheckinResult> => {
      const pass = await tx.pass.findUnique({
        where: { tokenHash: item.tokenHash },
        include: passInclude,
      });
      const belongs = pass?.registration.eventId === eventId ? pass : null;

      const repeatedCheckin = await tx.checkin.findUnique({
        where: { clientEventId: item.clientId },
        select: { id: true, raffleFolio: true, checkedInAt: true },
      });
      if (repeatedCheckin && belongs) {
        return {
          status: 'ok',
          ...guestView(belongs),
          checkedInAt: repeatedCheckin.checkedInAt.toISOString(),
          raffleFolio: repeatedCheckin.raffleFolio,
        };
      }
      const repeatedIncident = await tx.incident.findUnique({
        where: { clientEventId: item.clientId },
      });
      if (repeatedIncident) {
        return incidentOutcome(repeatedIncident, belongs);
      }

      const accessPoint = await tx.accessPoint.findFirst({
        where: { id: item.accessPointId, eventId },
        select: { id: true },
      });
      if (!accessPoint) {
        throw new AppError(
          400,
          'El punto de acceso no pertenece a este evento.',
        );
      }

      const occurredAt = new Date(
        Math.min(new Date(item.scannedAt).getTime(), Date.now()),
      );
      const incident = (type: string, description: string) =>
        tx.incident.create({
          data: {
            eventId,
            clientEventId: item.clientId,
            passId: belongs?.id,
            accessPointId: accessPoint.id,
            operatorUserId: operatorId,
            type,
            description,
            occurredAt,
          },
        });

      if (!belongs) {
        const created = await incident(
          'unknown',
          'Se leyó un código que no pertenece a este evento.',
        );
        return incidentOutcome(created, null);
      }
      // Sin aceptar el aviso no hay QR que leer. En la puerta se atiende a mano: la
      // persona llegó con su mesa y recepción deja el motivo de su ingreso.
      if (belongs.status === 'pending_activation' && !item.manualReason) {
        return { status: 'pending_activation', ...guestView(belongs) };
      }
      if (
        belongs.status !== 'active' &&
        belongs.status !== 'pending_activation'
      ) {
        const created = await incident(
          'revoked',
          `Se intentó usar el pase revocado ${belongs.registration.folio}.`,
        );
        return incidentOutcome(created, belongs);
      }
      if (belongs.checkin) {
        const created = await incident(
          'duplicate',
          `El pase ${belongs.registration.folio} ya había ingresado por ${belongs.checkin.accessPoint.name}.`,
        );
        return incidentOutcome(created, belongs);
      }

      const event = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
        select: { modules: true },
      });
      const modules = Array.isArray(event.modules)
        ? event.modules.filter(isEventModuleKey)
        : [];
      const raffleFolio = modules.includes('raffle')
        ? await nextRaffleFolio(tx, eventId)
        : null;

      if (belongs.status === 'pending_activation') {
        await tx.pass.update({
          where: { id: belongs.id },
          data: { status: 'active' },
        });
      }
      const checkin = await tx.checkin.create({
        data: {
          eventId,
          passId: belongs.id,
          accessPointId: accessPoint.id,
          operatorUserId: operatorId,
          clientEventId: item.clientId,
          source,
          manualReason: item.manualReason,
          checkedInAt: occurredAt,
          raffleFolio,
        },
      });
      return {
        status: 'ok',
        ...guestView(belongs),
        checkedInAt: checkin.checkedInAt.toISOString(),
        raffleFolio,
      };
    }, TX_OPTIONS);

  try {
    return await run();
  } catch (error) {
    // Dos puertas leyeron el mismo pase al mismo tiempo: el índice único decide
    // quién entró, y la segunda lectura se resuelve ahora como duplicado.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      return run();
    }
    throw error;
  }
}

async function assertEvent(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, status: true },
  });
  if (!event || event.status === 'draft') {
    throw new AppError(404, 'El evento no existe o no está disponible.');
  }
}

export const eventCheckinRouter = Router({ mergeParams: true });

eventCheckinRouter.get(
  '/overview',
  canOperate,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const [accessPoints, confirmed, checkedIn, openIncidents, recent] =
      await Promise.all([
        prisma.accessPoint.findMany({
          where: { eventId },
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { checkins: true } } },
        }),
        prisma.order.aggregate({
          where: { eventId, status: 'confirmed' },
          _sum: { seats: true },
        }),
        prisma.checkin.count({ where: { eventId } }),
        prisma.incident.count({ where: { eventId, status: 'open' } }),
        prisma.checkin.findMany({
          where: { eventId },
          orderBy: { checkedInAt: 'desc' },
          take: 15,
          include: {
            accessPoint: { select: { name: true } },
            operator: { select: { displayName: true } },
            pass: { include: passInclude },
          },
        }),
      ]);

    response.json({
      expected: confirmed._sum.seats ?? 0,
      checkedIn,
      openIncidents,
      accessPoints: accessPoints.map((point) => ({
        id: point.id,
        name: point.name,
        active: point.status === 'active',
        checkins: point._count.checkins,
      })),
      recent: recent.map((checkin) => ({
        id: checkin.id,
        ...guestView(checkin.pass),
        checkedInAt: checkin.checkedInAt,
        accessPointName: checkin.accessPoint.name,
        operatorName: checkin.operator?.displayName ?? null,
        source: checkin.source,
        manualReason: checkin.manualReason,
        raffleFolio: checkin.raffleFolio,
      })),
    });
  }),
);

// Lista para operar sin internet. Lleva lo mínimo para reconocer a una persona;
// nunca correos ni teléfonos, porque se queda guardada en el dispositivo.
eventCheckinRouter.get(
  '/offline-list',
  canOperate,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    await assertEvent(eventId);
    const passes = await prisma.pass.findMany({
      where: {
        status: { in: ['active', 'pending_activation'] },
        registration: { eventId },
      },
      include: passInclude,
    });
    response.json({
      generatedAt: new Date().toISOString(),
      entries: passes.map((pass) => ({
        tokenHash: pass.tokenHash,
        ...guestView(pass),
        checkedInAt: pass.checkin?.checkedInAt ?? null,
        pendingActivation: pass.status === 'pending_activation',
      })),
    });
  }),
);

eventCheckinRouter.post(
  '/scan',
  canOperate,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    await assertEvent(eventId);
    const item = checkinItemSchema.parse(request.body);
    const user = currentUser(request);
    const result = await processItem({
      eventId,
      item,
      operatorId: user.id,
      source: 'online',
    });
    if (item.manualReason && result.status === 'ok') {
      await recordAudit({
        userId: user.id,
        action: 'checkin.manual',
        entityType: 'pass',
        eventId,
        details: { folio: result.folio, reason: item.manualReason },
      });
    }
    response.json(result);
  }),
);

eventCheckinRouter.post(
  '/sync',
  canOperate,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    await assertEvent(eventId);
    const { items } = checkinBatchSchema.parse(request.body);
    const user = currentUser(request);
    const results: { clientId: string; result: CheckinResult }[] = [];
    // En orden de lectura: si dos teléfonos sin señal leyeron el mismo pase,
    // cuenta el primero y el otro queda como incidencia.
    const ordered = [...items].sort(
      (a, b) =>
        new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime(),
    );
    for (const item of ordered) {
      const result = await processItem({
        eventId,
        item,
        operatorId: user.id,
        source: 'offline',
      });
      results.push({ clientId: item.clientId, result });
    }
    await recordAudit({
      userId: user.id,
      action: 'checkin.sync',
      entityType: 'event',
      entityId: eventId,
      eventId,
      details: { items: items.length },
    });
    response.json({ results });
  }),
);

eventCheckinRouter.post(
  '/authorized',
  requirePermission('checkin.manage', 'registrations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const input = authorizedGuestSchema.parse(request.body);
    const user = currentUser(request);
    if (input.accessPointId) {
      const point = await prisma.accessPoint.findFirst({
        where: { id: input.accessPointId, eventId },
        select: { id: true },
      });
      if (!point) {
        throw new AppError(
          400,
          'El punto de acceso no pertenece a este evento.',
        );
      }
    }
    const created = await createAuthorizedGuest({
      eventId,
      input,
      userId: user.id,
    });
    await recordAudit({
      userId: user.id,
      action: 'order.authorized',
      entityType: 'order',
      entityId: created.orderId,
      eventId,
      details: { folio: created.folio, reason: input.reason },
    });
    const admitted = input.accessPointId
      ? await processItem({
          eventId,
          operatorId: user.id,
          source: 'online',
          item: {
            clientId: randomUUID(),
            tokenHash: hashToken(passToken(created.passId)),
            accessPointId: input.accessPointId,
            scannedAt: new Date().toISOString(),
            manualReason: `Alta autorizada: ${input.reason}`,
          },
        })
      : null;
    response.status(201).json({
      folio: created.folio,
      admitted: admitted?.status === 'ok',
    });
  }),
);

eventCheckinRouter.post(
  '/access-points',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const input = accessPointInputSchema.parse(request.body);
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    const point = await prisma.accessPoint.create({
      data: {
        eventId,
        name: input.name,
        status: input.active ? 'active' : 'inactive',
      },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'access_point.create',
      entityType: 'access_point',
      entityId: point.id,
      eventId,
      details: { name: point.name },
    });
    response.status(201).json({ id: point.id });
  }),
);

eventCheckinRouter.put(
  '/access-points/:pointId',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { pointId } = request.params as { pointId: string };
    const input = accessPointInputSchema.parse(request.body);
    const result = await prisma.accessPoint.updateMany({
      where: { id: pointId, eventId },
      data: { name: input.name, status: input.active ? 'active' : 'inactive' },
    });
    if (result.count === 0) {
      throw new AppError(404, 'El punto de acceso no existe.');
    }
    response.status(204).end();
  }),
);

eventCheckinRouter.delete(
  '/access-points/:pointId',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { pointId } = request.params as { pointId: string };
    const point = await prisma.accessPoint.findFirst({
      where: { id: pointId, eventId },
      include: { _count: { select: { checkins: true, incidents: true } } },
    });
    if (!point) {
      throw new AppError(404, 'El punto de acceso no existe.');
    }
    if (point._count.checkins > 0 || point._count.incidents > 0) {
      throw new AppError(
        409,
        'Este punto ya tiene ingresos registrados. Desactívalo en lugar de borrarlo.',
      );
    }
    await prisma.accessPoint.delete({ where: { id: point.id } });
    response.status(204).end();
  }),
);

eventCheckinRouter.get(
  '/incidents',
  canManage,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const incidents = await prisma.incident.findMany({
      where: { eventId },
      orderBy: [{ status: 'asc' }, { occurredAt: 'desc' }],
      take: 200,
      include: {
        accessPoint: { select: { name: true } },
        operator: { select: { displayName: true } },
        resolvedBy: { select: { displayName: true } },
      },
    });
    response.json(
      incidents.map((incident) => ({
        id: incident.id,
        type: incident.type,
        status: incident.status,
        description: incident.description,
        occurredAt: incident.occurredAt,
        accessPointName: incident.accessPoint?.name ?? null,
        operatorName: incident.operator?.displayName ?? null,
        resolution: incident.resolution,
        resolvedBy: incident.resolvedBy?.displayName ?? null,
        resolvedAt: incident.resolvedAt,
      })),
    );
  }),
);

eventCheckinRouter.post(
  '/incidents',
  canOperate,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const input = incidentInputSchema.parse(request.body);
    const point = await prisma.accessPoint.findFirst({
      where: { id: input.accessPointId, eventId },
      select: { id: true },
    });
    if (!point) {
      throw new AppError(400, 'El punto de acceso no pertenece a este evento.');
    }
    const incident = await prisma.incident.create({
      data: {
        eventId,
        accessPointId: point.id,
        operatorUserId: currentUser(request).id,
        type: 'manual',
        description: input.description,
        occurredAt: new Date(),
      },
    });
    response.status(201).json({ id: incident.id });
  }),
);

eventCheckinRouter.post(
  '/incidents/:incidentId/resolve',
  canManage,
  requireCsrf,
  asyncHandler(async (request, response) => {
    const eventId = eventIdOf(request);
    const { incidentId } = request.params as { incidentId: string };
    const { resolution } = incidentResolveSchema.parse(request.body);
    const user = currentUser(request);
    const result = await prisma.incident.updateMany({
      where: { id: incidentId, eventId, status: 'open' },
      data: {
        status: 'resolved',
        resolution,
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new AppError(404, 'La incidencia no existe o ya estaba resuelta.');
    }
    await recordAudit({
      userId: user.id,
      action: 'incident.resolve',
      entityType: 'incident',
      entityId: incidentId,
      eventId,
    });
    response.status(204).end();
  }),
);

/** Eventos disponibles para operar en recepción. */
export const checkinRouter = Router();

checkinRouter.get(
  '/events',
  canOperate,
  asyncHandler(async (_request, response) => {
    const events = await prisma.event.findMany({
      where: { status: 'active' },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        name: true,
        startsAt: true,
        timeZone: true,
        venue: true,
        modules: true,
        accessPoints: {
          where: { status: 'active' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        },
      },
    });
    response.json(
      events
        .filter(
          (event) =>
            Array.isArray(event.modules) && event.modules.includes('checkin'),
        )
        .map(({ modules: _modules, ...event }) => event),
    );
  }),
);

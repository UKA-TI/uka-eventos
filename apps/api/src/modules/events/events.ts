import { Router } from 'express';
import { eventInputSchema, type EventInput } from '@uka/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import {
  currentUser,
  requireAuth,
  requireCsrf,
  requirePermission,
} from '../auth/auth.js';

const eventSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  status: true,
  startsAt: true,
  endsAt: true,
  timeZone: true,
  venue: true,
  capacity: true,
  folioPrefix: true,
  feeAmount: true,
  currency: true,
  companionLimit: true,
  registrationMode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;

function eventData(input: EventInput) {
  if (
    input.startsAt &&
    input.endsAt &&
    new Date(input.endsAt) <= new Date(input.startsAt)
  ) {
    throw new AppError(400, 'El evento debe terminar después de su inicio.');
  }
  return {
    ...input,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  };
}

function eventView<T extends { feeAmount: { toNumber(): number } | null }>(
  event: T,
) {
  return { ...event, feeAmount: event.feeAmount?.toNumber() ?? null };
}

export const eventsRouter = Router();

eventsRouter.use(requireAuth);

eventsRouter.get(
  '/',
  requirePermission('events.view', 'events.create', 'events.edit'),
  asyncHandler(async (request, response) => {
    const { permissions } = currentUser(request);
    const seesDrafts =
      permissions.includes('events.edit') ||
      permissions.includes('events.create');
    const events = await prisma.event.findMany({
      where: seesDrafts ? undefined : { status: { not: 'draft' } },
      orderBy: [{ startsAt: 'desc' }, { name: 'asc' }],
      select: eventSelect,
    });
    response.json(events.map(eventView));
  }),
);

eventsRouter.post(
  '/',
  requirePermission('events.create'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = eventInputSchema.parse(request.body);
    const event = await prisma.event.create({
      data: eventData(input),
      select: eventSelect,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'event.create',
      entityType: 'event',
      entityId: event.id,
      eventId: event.id,
      details: { name: event.name },
    });
    response.status(201).json(eventView(event));
  }),
);

eventsRouter.put(
  '/:id',
  requirePermission('events.edit'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = eventInputSchema.parse(request.body);
    const data = eventData(input);
    const result = await prisma.event.updateMany({
      where: { id: request.params.id },
      data,
    });
    if (result.count === 0) {
      throw new AppError(404, 'El evento no existe.');
    }
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: request.params.id },
      select: eventSelect,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'event.update',
      entityType: 'event',
      entityId: event.id,
      eventId: event.id,
      details: { name: event.name, status: event.status },
    });
    response.json(eventView(event));
  }),
);

import { Router } from 'express';
import { seriesInputSchema } from '@uka/shared';
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

const seriesInclude = {
  events: {
    orderBy: [{ editionYear: 'desc' as const }, { startsAt: 'desc' as const }],
    select: { id: true, name: true, editionYear: true, status: true },
  },
} satisfies Prisma.EventSeriesInclude;

function seriesView<T extends { events: { status: string }[] }>(
  series: T,
  seesDrafts: boolean,
) {
  const { events, ...rest } = series;
  return {
    ...rest,
    editions: events.filter((event) => seesDrafts || event.status !== 'draft'),
  };
}

export const seriesRouter = Router();

seriesRouter.use(requireAuth);

seriesRouter.get(
  '/',
  requirePermission('events.view', 'events.create', 'events.edit'),
  asyncHandler(async (request, response) => {
    const { permissions } = currentUser(request);
    const seesDrafts =
      permissions.includes('events.edit') ||
      permissions.includes('events.create');
    const series = await prisma.eventSeries.findMany({
      orderBy: { name: 'asc' },
      include: seriesInclude,
    });
    response.json(series.map((item) => seriesView(item, seesDrafts)));
  }),
);

seriesRouter.post(
  '/',
  requirePermission('events.create'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = seriesInputSchema.parse(request.body);
    const series = await prisma.eventSeries.create({
      data: input,
      include: seriesInclude,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'series.create',
      entityType: 'series',
      entityId: series.id,
      details: { name: series.name, type: series.type },
    });
    response.status(201).json(seriesView(series, true));
  }),
);

seriesRouter.put(
  '/:id',
  requirePermission('events.edit'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = seriesInputSchema.parse(request.body);
    const existing = await prisma.eventSeries.findUnique({
      where: { id: request.params.id },
    });
    if (!existing) {
      throw new AppError(404, 'La serie no existe.');
    }
    const series = await prisma.eventSeries.update({
      where: { id: existing.id },
      data: input,
      include: seriesInclude,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'series.update',
      entityType: 'series',
      entityId: series.id,
      details: { name: series.name, type: series.type },
    });
    response.json(seriesView(series, true));
  }),
);

seriesRouter.delete(
  '/:id',
  requirePermission('events.delete'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const existing = await prisma.eventSeries.findUnique({
      where: { id: request.params.id },
      include: { _count: { select: { events: true } } },
    });
    if (!existing) {
      throw new AppError(404, 'La serie no existe.');
    }
    if (existing._count.events > 0) {
      throw new AppError(
        409,
        'Esta serie tiene ediciones. Elimínalas antes de borrarla.',
      );
    }
    await prisma.eventSeries.delete({ where: { id: existing.id } });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'series.delete',
      entityType: 'series',
      entityId: existing.id,
      details: { name: existing.name },
    });
    response.status(204).end();
  }),
);

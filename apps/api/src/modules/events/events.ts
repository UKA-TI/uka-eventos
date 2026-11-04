import { Router, type Request } from 'express';
import {
  eventDuplicateSchema,
  eventInputSchema,
  eventModulesInputSchema,
  eventStatusInputSchema,
  isEventModuleKey,
  type EventInput,
} from '@uka/shared';
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
import { eventCheckinRouter } from '../checkin/checkin.js';
import { ordersRouter } from '../orders/orders.js';
import { formFieldsRouter, formFieldView } from './form-fields.js';
import { ticketTypesRouter, ticketTypeView } from './ticket-types.js';

const eventInclude = {
  series: { select: { id: true, name: true, type: true } },
  _count: { select: { ticketTypes: true } },
} as const;

const eventDetailInclude = {
  series: { select: { id: true, name: true, type: true } },
  ticketTypes: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { orders: true } } },
  },
  formFields: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  _count: { select: { orders: true, ticketTypes: true } },
} satisfies Prisma.EventInclude;

function checkDates(startsAt: string | null, endsAt: string | null) {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    throw new AppError(400, 'El evento debe terminar después de su inicio.');
  }
}

async function eventData(input: EventInput) {
  checkDates(input.startsAt, input.endsAt);
  const series = await prisma.eventSeries.findUnique({
    where: { id: input.seriesId },
    select: { id: true },
  });
  if (!series) {
    throw new AppError(400, 'La serie seleccionada no existe.');
  }
  return {
    ...input,
    modules: [...new Set(input.modules)],
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  };
}

function readModules(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter(isEventModuleKey) : [];
}

function eventView<
  T extends { modules: Prisma.JsonValue; _count: { ticketTypes: number } },
>(event: T) {
  const { _count, ...rest } = event;
  return {
    ...rest,
    modules: readModules(event.modules),
    ticketTypeCount: _count.ticketTypes,
  };
}

/** Lo que falta para poder abrir un evento. */
export function activationIssues(event: {
  startsAt: Date | null;
  folioPrefix: string | null;
  paymentInstructions: string | null;
  ticketTypes: { active: boolean; price: { toNumber(): number } }[];
}): string[] {
  const issues: string[] = [];
  if (!event.startsAt) {
    issues.push('Define la fecha de inicio.');
  }
  if (!event.folioPrefix) {
    issues.push('Define el prefijo de folio.');
  }
  if (!event.ticketTypes.some((ticket) => ticket.active)) {
    issues.push('Agrega al menos un tipo de boleto activo.');
  }
  if (
    !event.paymentInstructions &&
    event.ticketTypes.some(
      (ticket) => ticket.active && ticket.price.toNumber() > 0,
    )
  ) {
    issues.push(
      'Agrega las instrucciones de pago, porque hay boletos de paga.',
    );
  }
  return issues;
}

function seesDrafts(request: Request) {
  const { permissions } = currentUser(request);
  return (
    permissions.includes('events.edit') || permissions.includes('events.create')
  );
}

async function loadDetail(id: string) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: eventDetailInclude,
  });
  if (!event) {
    throw new AppError(404, 'El evento no existe.');
  }
  return event;
}

function detailView(event: Awaited<ReturnType<typeof loadDetail>>) {
  return {
    ...eventView(event),
    ticketTypes: event.ticketTypes.map(ticketTypeView),
    formFields: event.formFields.map(formFieldView),
    activationIssues: activationIssues(event),
    registrationCount: event._count.orders,
  };
}

export const eventsRouter = Router();

eventsRouter.use(requireAuth);

eventsRouter.get(
  '/',
  requirePermission('events.view', 'events.create', 'events.edit'),
  asyncHandler(async (request, response) => {
    const events = await prisma.event.findMany({
      where: seesDrafts(request) ? undefined : { status: { not: 'draft' } },
      orderBy: [{ startsAt: 'desc' }, { name: 'asc' }],
      include: eventInclude,
    });
    response.json(events.map(eventView));
  }),
);

eventsRouter.get(
  '/:id',
  requirePermission('events.view', 'events.create', 'events.edit'),
  asyncHandler(async (request, response) => {
    const event = await loadDetail(request.params.id);
    if (event.status === 'draft' && !seesDrafts(request)) {
      throw new AppError(404, 'El evento no existe.');
    }
    response.json(detailView(event));
  }),
);

eventsRouter.post(
  '/',
  requirePermission('events.create'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = eventInputSchema.parse(request.body);
    const created = await prisma.event.create({
      data: await eventData(input),
      select: { id: true, name: true },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'event.create',
      entityType: 'event',
      entityId: created.id,
      eventId: created.id,
      details: { name: created.name },
    });
    response.status(201).json(detailView(await loadDetail(created.id)));
  }),
);

eventsRouter.put(
  '/:id',
  requirePermission('events.edit'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = eventInputSchema.parse(request.body);
    const current = await loadDetail(request.params.id);
    const data = await eventData(input);
    if (current.status === 'active') {
      const issues = activationIssues({
        startsAt: data.startsAt,
        folioPrefix: data.folioPrefix,
        paymentInstructions: data.paymentInstructions,
        ticketTypes: current.ticketTypes,
      });
      if (issues.length > 0) {
        throw new AppError(
          409,
          `Un evento activo no puede quedar incompleto: ${issues.join(' ')}`,
        );
      }
    }
    await prisma.event.update({ where: { id: current.id }, data });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'event.update',
      entityType: 'event',
      entityId: current.id,
      eventId: current.id,
      details: { name: input.name },
    });
    response.json(detailView(await loadDetail(current.id)));
  }),
);

eventsRouter.put(
  '/:id/modules',
  requirePermission('events.edit'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { modules } = eventModulesInputSchema.parse(request.body);
    const current = await loadDetail(request.params.id);
    await prisma.event.update({
      where: { id: current.id },
      data: { modules: [...new Set(modules)] },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'event.modules',
      entityType: 'event',
      entityId: current.id,
      eventId: current.id,
      details: { previous: readModules(current.modules), modules },
    });
    response.json(detailView(await loadDetail(current.id)));
  }),
);

eventsRouter.post(
  '/:id/status',
  requirePermission('events.edit'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { status } = eventStatusInputSchema.parse(request.body);
    const current = await loadDetail(request.params.id);
    if (status === 'active') {
      const issues = activationIssues(current);
      if (issues.length > 0) {
        throw new AppError(409, `Aún no se puede activar: ${issues.join(' ')}`);
      }
    }
    if (status === 'draft' && current._count.orders > 0) {
      throw new AppError(
        409,
        'Este evento ya tiene registros y no puede volver a borrador.',
      );
    }
    await prisma.event.update({
      where: { id: current.id },
      data: { status },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'event.status',
      entityType: 'event',
      entityId: current.id,
      eventId: current.id,
      details: { previous: current.status, status },
    });
    response.json(detailView(await loadDetail(current.id)));
  }),
);

// Nueva edición: copia la configuración, nunca los registros ni los asistentes.
eventsRouter.post(
  '/:id/duplicate',
  requirePermission('events.create'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = eventDuplicateSchema.parse(request.body);
    checkDates(input.startsAt, input.endsAt);
    const source = await loadDetail(request.params.id);
    const created = await prisma.event.create({
      data: {
        seriesId: source.seriesId,
        editionYear: input.editionYear,
        slug: input.slug,
        name: input.name,
        description: source.description,
        status: 'draft',
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        timeZone: source.timeZone,
        venue: source.venue,
        paymentInstructions: source.paymentInstructions,
        capacity: source.capacity,
        folioPrefix: source.folioPrefix,
        currency: source.currency,
        companionLimit: source.companionLimit,
        modules: readModules(source.modules),
        ticketTypes: {
          create: source.ticketTypes.map((ticket) => ({
            name: ticket.name,
            description: ticket.description,
            price: ticket.price,
            capacity: ticket.capacity,
            seatsIncluded: ticket.seatsIncluded,
            active: ticket.active,
            sortOrder: ticket.sortOrder,
          })),
        },
        formFields: {
          create: source.formFields.map((field) => ({
            label: field.label,
            type: field.type,
            required: field.required,
            options: field.options as Prisma.InputJsonValue,
            helpText: field.helpText,
            active: field.active,
            sortOrder: field.sortOrder,
          })),
        },
      },
      select: { id: true },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'event.duplicate',
      entityType: 'event',
      entityId: created.id,
      eventId: created.id,
      details: { sourceEventId: source.id, name: input.name },
    });
    response.status(201).json(detailView(await loadDetail(created.id)));
  }),
);

eventsRouter.delete(
  '/:id',
  requirePermission('events.delete'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const current = await loadDetail(request.params.id);
    if (current.status !== 'draft') {
      throw new AppError(409, 'Solo se pueden eliminar eventos en borrador.');
    }
    if (current._count.orders > 0) {
      throw new AppError(409, 'Este evento ya tiene registros.');
    }
    await prisma.$transaction([
      prisma.eventCounter.deleteMany({ where: { eventId: current.id } }),
      prisma.event.delete({ where: { id: current.id } }),
    ]);
    await recordAudit({
      userId: currentUser(request).id,
      action: 'event.delete',
      entityType: 'event',
      entityId: current.id,
      details: { name: current.name },
    });
    response.status(204).end();
  }),
);

eventsRouter.use('/:eventId/tickets', ticketTypesRouter);
eventsRouter.use('/:eventId/fields', formFieldsRouter);
eventsRouter.use('/:eventId/orders', ordersRouter);
eventsRouter.use('/:eventId/checkin', eventCheckinRouter);

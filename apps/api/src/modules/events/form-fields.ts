import { Router } from 'express';
import { formFieldInputSchema, formFieldOrderSchema } from '@uka/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { currentUser, requireCsrf, requirePermission } from '../auth/auth.js';

export function formFieldView(field: {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: Prisma.JsonValue;
  helpText: string | null;
  active: boolean;
}) {
  return {
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    options: Array.isArray(field.options)
      ? field.options.filter((item) => typeof item === 'string')
      : [],
    helpText: field.helpText,
    active: field.active,
  };
}

/** Cada ruta valida que la pregunta pertenezca al evento de la dirección. */
async function loadField(eventId: string, fieldId: string) {
  const field = await prisma.eventFormField.findFirst({
    where: { id: fieldId, eventId },
  });
  if (!field) {
    throw new AppError(404, 'La pregunta no existe.');
  }
  return field;
}

export const formFieldsRouter = Router({ mergeParams: true });

formFieldsRouter.use(requirePermission('events.edit'), requireCsrf);

formFieldsRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const { eventId } = request.params as { eventId: string };
    const input = formFieldInputSchema.parse(request.body);
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    const last = await prisma.eventFormField.aggregate({
      where: { eventId },
      _max: { sortOrder: true },
    });
    const field = await prisma.eventFormField.create({
      data: { ...input, eventId, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'field.create',
      entityType: 'form_field',
      entityId: field.id,
      eventId,
      details: { label: field.label, type: field.type },
    });
    response.status(201).json(formFieldView(field));
  }),
);

// Va antes de '/:fieldId' para que "order" no se interprete como un id.
formFieldsRouter.put(
  '/order',
  asyncHandler(async (request, response) => {
    const { eventId } = request.params as { eventId: string };
    const { ids } = formFieldOrderSchema.parse(request.body);
    const fields = await prisma.eventFormField.findMany({
      where: { eventId },
      select: { id: true },
    });
    const known = new Set(fields.map((field) => field.id));
    if (
      ids.length !== known.size ||
      new Set(ids).size !== ids.length ||
      !ids.every((id) => known.has(id))
    ) {
      throw new AppError(400, 'La lista de preguntas está desactualizada.');
    }
    await prisma.$transaction(
      ids.map((id, sortOrder) =>
        prisma.eventFormField.update({ where: { id }, data: { sortOrder } }),
      ),
    );
    response.status(204).end();
  }),
);

formFieldsRouter.put(
  '/:fieldId',
  asyncHandler(async (request, response) => {
    const { eventId, fieldId } = request.params as {
      eventId: string;
      fieldId: string;
    };
    const input = formFieldInputSchema.parse(request.body);
    const current = await loadField(eventId, fieldId);
    const field = await prisma.eventFormField.update({
      where: { id: current.id },
      data: input,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'field.update',
      entityType: 'form_field',
      entityId: field.id,
      eventId,
      details: { label: field.label, type: field.type, active: field.active },
    });
    response.json(formFieldView(field));
  }),
);

formFieldsRouter.delete(
  '/:fieldId',
  asyncHandler(async (request, response) => {
    const { eventId, fieldId } = request.params as {
      eventId: string;
      fieldId: string;
    };
    const current = await loadField(eventId, fieldId);
    await prisma.eventFormField.delete({ where: { id: current.id } });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'field.delete',
      entityType: 'form_field',
      entityId: current.id,
      eventId,
      details: { label: current.label },
    });
    response.status(204).end();
  }),
);

import { Router } from 'express';
import { ticketTypeInputSchema, type TicketTypeInput } from '@uka/shared';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { currentUser, requireCsrf, requirePermission } from '../auth/auth.js';

export function ticketTypeView(ticket: {
  id: string;
  name: string;
  description: string | null;
  price: { toNumber(): number };
  capacity: number | null;
  seatsIncluded: number;
  salesStart: Date | null;
  salesEnd: Date | null;
  active: boolean;
  _count: { orders: number };
}) {
  return {
    id: ticket.id,
    name: ticket.name,
    description: ticket.description,
    price: ticket.price.toNumber(),
    capacity: ticket.capacity,
    seatsIncluded: ticket.seatsIncluded,
    salesStart: ticket.salesStart,
    salesEnd: ticket.salesEnd,
    active: ticket.active,
    registrationCount: ticket._count.orders,
  };
}

function ticketData(input: TicketTypeInput) {
  return {
    ...input,
    salesStart: input.salesStart ? new Date(input.salesStart) : null,
    salesEnd: input.salesEnd ? new Date(input.salesEnd) : null,
  };
}

const countRegistrations = {
  _count: { select: { orders: true } },
} as const;

/** Cada ruta valida que el boleto pertenezca al evento de la dirección. */
async function loadTicket(eventId: string, ticketId: string) {
  const ticket = await prisma.ticketType.findFirst({
    where: { id: ticketId, eventId },
    include: countRegistrations,
  });
  if (!ticket) {
    throw new AppError(404, 'El tipo de boleto no existe.');
  }
  return ticket;
}

/** Un evento activo siempre debe conservar al menos un boleto a la venta. */
async function assertKeepsActiveTicket(eventId: string, ticketId: string) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { status: true },
  });
  if (event.status !== 'active') {
    return;
  }
  const others = await prisma.ticketType.count({
    where: { eventId, active: true, id: { not: ticketId } },
  });
  if (others === 0) {
    throw new AppError(
      409,
      'Un evento activo necesita al menos un boleto activo.',
    );
  }
}

export const ticketTypesRouter = Router({ mergeParams: true });

ticketTypesRouter.use(requirePermission('events.edit'), requireCsrf);

ticketTypesRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const { eventId } = request.params as { eventId: string };
    const input = ticketTypeInputSchema.parse(request.body);
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    const last = await prisma.ticketType.aggregate({
      where: { eventId },
      _max: { sortOrder: true },
    });
    const ticket = await prisma.ticketType.create({
      data: {
        ...ticketData(input),
        eventId,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
      include: countRegistrations,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'ticket.create',
      entityType: 'ticket_type',
      entityId: ticket.id,
      eventId,
      details: { name: ticket.name, price: input.price },
    });
    response.status(201).json(ticketTypeView(ticket));
  }),
);

ticketTypesRouter.put(
  '/:ticketId',
  asyncHandler(async (request, response) => {
    const { eventId, ticketId } = request.params as {
      eventId: string;
      ticketId: string;
    };
    const input = ticketTypeInputSchema.parse(request.body);
    const current = await loadTicket(eventId, ticketId);
    if (!input.active) {
      await assertKeepsActiveTicket(eventId, ticketId);
    }
    const ticket = await prisma.ticketType.update({
      where: { id: current.id },
      data: ticketData(input),
      include: countRegistrations,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'ticket.update',
      entityType: 'ticket_type',
      entityId: ticket.id,
      eventId,
      details: {
        name: ticket.name,
        previousPrice: current.price.toNumber(),
        price: input.price,
        active: input.active,
      },
    });
    response.json(ticketTypeView(ticket));
  }),
);

ticketTypesRouter.delete(
  '/:ticketId',
  asyncHandler(async (request, response) => {
    const { eventId, ticketId } = request.params as {
      eventId: string;
      ticketId: string;
    };
    const current = await loadTicket(eventId, ticketId);
    if (current._count.orders > 0) {
      throw new AppError(
        409,
        'Este boleto ya tiene registros. Desactívalo en lugar de borrarlo.',
      );
    }
    await assertKeepsActiveTicket(eventId, ticketId);
    await prisma.ticketType.delete({ where: { id: current.id } });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'ticket.delete',
      entityType: 'ticket_type',
      entityId: current.id,
      eventId,
      details: { name: current.name },
    });
    response.status(204).end();
  }),
);

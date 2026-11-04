import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import {
  groupGuestInputSchema,
  isEventModuleKey,
  PRIVACY_NOTICE_URL,
  publicRegistrationSchema,
} from '@uka/shared';
import { asyncHandler } from '../../async-handler.js';
import { config } from '../../config.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { formFieldView } from '../events/form-fields.js';
import {
  contactIdFromUnsubscribeToken,
  groupUrl,
  hashToken,
  passToken,
  passUrl,
} from '../passes/tokens.js';
import {
  addGroupGuest,
  createOrder,
  removeGroupGuest,
} from '../orders/order-service.js';

const allowedOrigins = new Set(
  config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
);

const requireSameSite: RequestHandler = (request, _response, next) => {
  const origin = request.get('origin');
  if (!origin || !allowedOrigins.has(origin)) {
    next(new AppError(403, 'Origen no permitido.'));
    return;
  }
  next();
};

const writeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Una asistente captura muchos invitados desde la misma red de oficina.
  limit: 120,
  skip: () => config.NODE_ENV === 'test',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' },
});

async function loadOpenEvent(slug: string) {
  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      ticketTypes: {
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
      formFields: {
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  const modules = Array.isArray(event?.modules)
    ? event.modules.filter(isEventModuleKey)
    : [];
  if (
    !event ||
    event.status !== 'active' ||
    !modules.includes('publicRegistration')
  ) {
    throw new AppError(404, 'Este evento no tiene el registro abierto.');
  }
  return event;
}

export const publicRouter = Router();

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Solo muestra el correo oculto: quien tenga la liga no ve datos de la persona. */
async function loadUnsubscribeContact(token: string) {
  const contactId = contactIdFromUnsubscribeToken(token);
  const contact = contactId
    ? await prisma.contact.findUnique({ where: { id: contactId } })
    : null;
  if (!contact) {
    throw new AppError(404, 'Esta liga no es válida.');
  }
  return contact;
}

publicRouter.get(
  '/unsubscribe/:token',
  asyncHandler(async (request, response) => {
    const contact = await loadUnsubscribeContact(String(request.params.token));
    response.json({
      email: maskEmail(contact.email ?? ''),
      optedOut: Boolean(contact.optedOutAt),
      privacyUrl: PRIVACY_NOTICE_URL,
    });
  }),
);

/** Es POST con confirmación: los filtros de correo abren las ligas de los mensajes. */
publicRouter.post(
  '/unsubscribe/:token',
  writeLimit,
  requireSameSite,
  asyncHandler(async (request, response) => {
    const contact = await loadUnsubscribeContact(String(request.params.token));
    await prisma.contact.updateMany({
      where: { id: contact.id, optedOutAt: null },
      data: { optedOutAt: new Date(), optOutSource: 'link' },
    });
    response.json({
      email: maskEmail(contact.email ?? ''),
      optedOut: true,
      privacyUrl: PRIVACY_NOTICE_URL,
    });
  }),
);

publicRouter.get(
  '/events/:slug',
  asyncHandler(async (request, response) => {
    const event = await loadOpenEvent(request.params.slug ?? '');
    const now = new Date();
    const [ticketSales, seats] = await Promise.all([
      prisma.order.groupBy({
        by: ['ticketTypeId'],
        where: {
          eventId: event.id,
          status: { in: ['pending_payment', 'confirmed'] },
        },
        _count: { _all: true },
      }),
      prisma.order.aggregate({
        where: {
          eventId: event.id,
          status: { in: ['pending_payment', 'confirmed'] },
        },
        _sum: { seats: true },
      }),
    ]);
    const seatsLeft =
      event.capacity === null
        ? Number.POSITIVE_INFINITY
        : event.capacity - (seats._sum.seats ?? 0);

    response.json({
      name: event.name,
      description: event.description,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: event.timeZone,
      venue: event.venue,
      currency: event.currency,
      privacyUrl: PRIVACY_NOTICE_URL,
      tickets: event.ticketTypes
        .filter(
          (ticket) =>
            (!ticket.salesStart || ticket.salesStart <= now) &&
            (!ticket.salesEnd || ticket.salesEnd >= now),
        )
        .map((ticket) => {
          const sold =
            ticketSales.find((item) => item.ticketTypeId === ticket.id)?._count
              ._all ?? 0;
          return {
            id: ticket.id,
            name: ticket.name,
            description: ticket.description,
            price: ticket.price.toNumber(),
            seatsIncluded: ticket.seatsIncluded,
            soldOut:
              (ticket.capacity !== null && sold >= ticket.capacity) ||
              ticket.seatsIncluded > seatsLeft,
          };
        }),
      fields: event.formFields.map(formFieldView),
    });
  }),
);

publicRouter.post(
  '/events/:slug/register',
  requireSameSite,
  writeLimit,
  asyncHandler(async (request, response) => {
    const { website, ...input } = publicRegistrationSchema.parse(request.body);
    if (website) {
      throw new AppError(400, 'Revisa los datos capturados.');
    }
    const event = await loadOpenEvent(request.params.slug ?? '');
    const order = await createOrder({
      eventId: event.id,
      input,
      source: 'public',
      privacyAccepted: true,
    });
    const pass = order.registrations[0]?.passes[0];
    response.status(201).json({
      reference: order.reference,
      status: order.status,
      amountDue: order.amountDue.toNumber(),
      currency: event.currency,
      paymentInstructions:
        order.status === 'pending_payment' ? event.paymentInstructions : null,
      seats: order.seats,
      passUrl: pass ? passUrl(pass.id) : null,
      groupUrl: order.groupTokenHash ? groupUrl(order.id) : null,
    });
  }),
);

publicRouter.get(
  '/passes/:token',
  asyncHandler(async (request, response) => {
    const token = request.params.token ?? '';
    const pass = await prisma.pass.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        registration: {
          include: {
            guest: true,
            event: true,
            order: { include: { ticketType: { select: { name: true } } } },
          },
        },
      },
    });
    if (!pass) {
      throw new AppError(404, 'Este pase no existe.');
    }
    const { registration } = pass;
    const active = pass.status === 'active';
    response.json({
      status: active ? 'active' : 'revoked',
      folio: registration.folio,
      guestName: `${registration.guest.firstName} ${registration.guest.lastName}`,
      eventName: registration.event.name,
      startsAt: registration.event.startsAt,
      timeZone: registration.event.timeZone,
      venue: registration.event.venue,
      ticketName: registration.order.ticketType.name,
      qrDataUrl: active
        ? await QRCode.toDataURL(passToken(pass.id), {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 320,
          })
        : null,
      privacyUrl: PRIVACY_NOTICE_URL,
    });
  }),
);

async function loadGroupView(token: string) {
  const order = await prisma.order.findUnique({
    where: { groupTokenHash: hashToken(token) },
    include: {
      event: true,
      ticketType: { select: { name: true } },
      buyer: true,
      registrations: {
        where: { status: { not: 'cancelled' } },
        orderBy: { seatNumber: 'asc' },
        include: {
          guest: true,
          passes: { include: { checkin: { select: { id: true } } } },
        },
      },
    },
  });
  if (!order || order.status !== 'confirmed') {
    throw new AppError(404, 'Esta liga no es válida.');
  }
  return {
    reference: order.reference,
    eventName: order.event.name,
    startsAt: order.event.startsAt,
    timeZone: order.event.timeZone,
    venue: order.event.venue,
    ticketName: order.ticketType.name,
    contactName: `${order.buyer.firstName} ${order.buyer.lastName}`,
    seats: order.seats,
    privacyUrl: PRIVACY_NOTICE_URL,
    guests: order.registrations.map((registration) => ({
      id: registration.id,
      folio: registration.folio,
      name: `${registration.guest.firstName} ${registration.guest.lastName}`,
      email: registration.guest.email,
      checkedIn: registration.passes.some((pass) => pass.checkin),
    })),
  };
}

publicRouter.get(
  '/groups/:token',
  asyncHandler(async (request, response) => {
    response.json(await loadGroupView(request.params.token ?? ''));
  }),
);

publicRouter.post(
  '/groups/:token/guests',
  requireSameSite,
  writeLimit,
  asyncHandler(async (request, response) => {
    const token = request.params.token ?? '';
    await addGroupGuest(token, groupGuestInputSchema.parse(request.body));
    response.status(201).json(await loadGroupView(token));
  }),
);

publicRouter.delete(
  '/groups/:token/guests/:registrationId',
  requireSameSite,
  writeLimit,
  asyncHandler(async (request, response) => {
    const token = request.params.token ?? '';
    await removeGroupGuest(token, request.params.registrationId ?? '');
    response.json(await loadGroupView(token));
  }),
);

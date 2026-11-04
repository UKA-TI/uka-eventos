import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import {
  groupGuestInputSchema,
  isEventModuleKey,
  passActivationSchema,
  PRIVACY_NOTICE_URL,
  publicRegistrationSchema,
  recoverPassSchema,
} from '@uka/shared';
import { asyncHandler } from '../../async-handler.js';
import { config } from '../../config.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { formFieldView } from '../events/form-fields.js';
import { calendarFile, calendarLinks } from '../passes/pass-links.js';
import { passPdf } from '../passes/pass-pdf.js';
import {
  contactIdFromUnsubscribeToken,
  groupUrl,
  hashToken,
  passToken,
  passUrl,
} from '../passes/tokens.js';
import {
  activatePass,
  addGroupGuest,
  createOrder,
  removeGroupGuest,
  resendGroupGuest,
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

const recoverLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: () => config.NODE_ENV === 'test',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' },
});

/** Evita que alguien use este formulario para llenarle el correo a otra persona. */
const RECOVER_REPEAT_MS = 5 * 60 * 1000;

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
      programStartsAt: event.programStartsAt,
      mapUrl: event.mapUrl,
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
      marketingConsent: input.marketingConsent === true,
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
            publishedTable: { select: { name: true } },
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
      tableName: registration.publishedTable?.name ?? null,
      status: active
        ? 'active'
        : pass.status === 'pending_activation'
          ? 'pending_activation'
          : 'revoked',
      folio: registration.folio,
      guestName: `${registration.guest.firstName} ${registration.guest.lastName}`,
      eventName: registration.event.name,
      startsAt: registration.event.startsAt,
      timeZone: registration.event.timeZone,
      venue: registration.event.venue,
      ticketName: registration.order.ticketType.name,
      programStartsAt: registration.event.programStartsAt,
      mapUrl: registration.event.mapUrl,
      eventSlug: registration.event.slug,
      calendar: calendarLinks(registration.event, registration.folio),
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

async function loadPassForFile(token: string) {
  const pass = await prisma.pass.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      registration: {
        include: {
          guest: true,
          event: true,
          publishedTable: { select: { name: true } },
          order: { include: { ticketType: { select: { name: true } } } },
        },
      },
    },
  });
  // Sin activar o revocado no hay archivos: el PDF lleva el QR.
  if (!pass || pass.status !== 'active') {
    throw new AppError(404, 'Este pase no está disponible.');
  }
  return pass;
}

publicRouter.get(
  '/passes/:token/pass.pdf',
  asyncHandler(async (request, response) => {
    const pass = await loadPassForFile(request.params.token ?? '');
    const { registration } = pass;
    const { event, guest } = registration;
    const inZone = (date: Date, options: Intl.DateTimeFormatOptions) =>
      date.toLocaleString('es-MX', { timeZone: event.timeZone, ...options });
    const pdf = await passPdf({
      id: pass.id,
      guestName: `${guest.firstName} ${guest.lastName}`,
      folio: registration.folio,
      ticketName: registration.order.ticketType.name,
      eventName: event.name,
      when: event.startsAt
        ? inZone(event.startsAt, { dateStyle: 'long', timeStyle: 'short' })
        : 'Por confirmar',
      program: event.programStartsAt
        ? inZone(event.programStartsAt, { timeStyle: 'short' })
        : null,
      venue: event.venue,
    });
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="pase-${registration.folio}.pdf"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.send(Buffer.from(pdf));
  }),
);

publicRouter.get(
  '/passes/:token/event.ics',
  asyncHandler(async (request, response) => {
    const pass = await loadPassForFile(request.params.token ?? '');
    const file = calendarFile(
      pass.registration.event,
      pass.registration.folio,
      pass.id,
    );
    if (!file) {
      throw new AppError(404, 'Este evento aún no tiene fecha.');
    }
    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${pass.registration.event.slug}.ics"`,
    );
    response.send(file);
  }),
);

/** Responde igual exista o no el correo: no debe revelar quién está registrado. */
publicRouter.post(
  '/events/:slug/recover-pass',
  recoverLimit,
  requireSameSite,
  asyncHandler(async (request, response) => {
    const { email } = recoverPassSchema.parse(request.body);
    const event = await prisma.event.findUnique({
      where: { slug: request.params.slug ?? '' },
      select: { id: true, status: true },
    });
    if (event && event.status !== 'draft') {
      const passes = await prisma.pass.findMany({
        where: {
          status: { in: ['active', 'pending_activation'] },
          registration: {
            eventId: event.id,
            status: { not: 'cancelled' },
            guest: { email },
          },
        },
        take: 5,
      });
      const since = new Date(Date.now() - RECOVER_REPEAT_MS);
      for (const pass of passes) {
        const recent = await prisma.emailMessage.count({
          where: {
            refId: pass.id,
            createdAt: { gte: since },
          },
        });
        if (recent === 0) {
          await prisma.emailMessage.create({
            data: {
              eventId: event.id,
              kind: pass.status === 'active' ? 'pass' : 'pass_activation',
              refId: pass.id,
              toEmail: email,
            },
          });
        }
      }
    }
    response.status(202).json({ queued: true });
  }),
);

publicRouter.post(
  '/passes/:token/activate',
  requireSameSite,
  writeLimit,
  asyncHandler(async (request, response) => {
    const { phone, marketingConsent } = passActivationSchema.parse(
      request.body,
    );
    await activatePass(
      request.params.token ?? '',
      phone || null,
      marketingConsent,
    );
    response.status(204).end();
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
          passes: {
            where: { status: { not: 'revoked' } },
            include: { checkin: { select: { id: true } } },
          },
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
    delegateName: order.delegateName,
    registrationDeadline: order.registrationDeadline,
    source: order.source,
    buyer: {
      firstName: order.buyer.firstName,
      lastName: order.buyer.lastName,
      email: order.buyer.email,
      phone: order.buyer.phone,
      organization: order.buyer.organization,
    },
    seats: order.seats,
    privacyUrl: PRIVACY_NOTICE_URL,
    guests: order.registrations.map((registration) => ({
      id: registration.id,
      seatNumber: registration.seatNumber,
      folio: registration.folio,
      name: `${registration.guest.firstName} ${registration.guest.lastName}`,
      email: registration.guest.email,
      checkedIn: registration.passes.some((pass) => pass.checkin),
      pendingActivation: registration.passes.some(
        (pass) => pass.status === 'pending_activation',
      ),
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

publicRouter.post(
  '/groups/:token/guests/:registrationId/resend',
  requireSameSite,
  writeLimit,
  asyncHandler(async (request, response) => {
    await resendGroupGuest(
      request.params.token ?? '',
      request.params.registrationId ?? '',
    );
    response.status(202).json({ queued: true });
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

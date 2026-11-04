import { Router } from 'express';
import {
  companyInputSchema,
  contactInputSchema,
  contactNoteInputSchema,
  isEventModuleKey,
  segmentFiltersSchema,
  segmentInputSchema,
} from '@uka/shared';
import { z } from 'zod';
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
import { donationInclude, donationView } from '../donations/donations.js';
import { contactWhere, reachableWhere } from './filters.js';

const PAGE_SIZE = 50;

const queryText = z
  .string()
  .trim()
  .max(120)
  .transform((value) => value || undefined)
  .optional();

const contactQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: queryText,
  companyId: queryText,
  eventType: queryText,
  seriesId: queryText,
  eventId: queryText,
  editionYear: z.coerce.number().int().min(2000).max(2100).optional(),
  participation: z
    .enum(['any', 'registered', 'attended', 'not_attended'])
    .optional(),
  donor: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  reachable: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const contactInclude = {
  company: { select: { id: true, name: true } },
  _count: { select: { guests: true } },
} satisfies Prisma.ContactInclude;

type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

function contactView(contact: ContactRow) {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    position: contact.position,
    company: contact.company,
    source: contact.source,
    optedOutAt: contact.optedOutAt,
    optOutSource: contact.optOutSource,
    participations: contact._count.guests,
    createdAt: contact.createdAt,
  };
}

async function assertCompany(companyId: string | null) {
  if (
    companyId &&
    !(await prisma.company.findUnique({ where: { id: companyId } }))
  ) {
    throw new AppError(400, 'La empresa no existe.');
  }
}

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

const canReadContacts = requirePermission(
  'contacts.view',
  'contacts.manage',
  'communications.view',
  'communications.manage',
  'communications.send',
  'donations.view',
  'donations.manage',
);

/** Listas para los filtros: quien ve contactos no necesariamente ve la sección de eventos. */
contactsRouter.get(
  '/options',
  canReadContacts,
  asyncHandler(async (_request, response) => {
    const [companies, series, events] = await Promise.all([
      prisma.company.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.eventSeries.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, type: true },
      }),
      prisma.event.findMany({
        where: { status: { not: 'draft' } },
        orderBy: [{ editionYear: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          status: true,
          editionYear: true,
          modules: true,
        },
      }),
    ]);
    response.json({
      companies,
      series: series.map(({ id, name }) => ({ id, name })),
      eventTypes: [...new Set(series.map(({ type }) => type))].sort(),
      years: [...new Set(events.map(({ editionYear }) => editionYear))],
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        status: event.status,
        openForRegistration:
          event.status === 'active' &&
          Array.isArray(event.modules) &&
          event.modules.some(
            (module) =>
              isEventModuleKey(module) && module === 'publicRegistration',
          ),
      })),
    });
  }),
);

contactsRouter.get(
  '/',
  requirePermission('contacts.view', 'contacts.manage'),
  asyncHandler(async (request, response) => {
    const { page, ...filters } = contactQuerySchema.parse(request.query);
    const where = contactWhere(filters);
    const [contacts, total, reachable] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: contactInclude,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.contact.count({ where }),
      prisma.contact.count({ where: { AND: [where, reachableWhere] } }),
    ]);
    response.json({
      contacts: contacts.map(contactView),
      total,
      page,
      pageSize: PAGE_SIZE,
      reachable,
    });
  }),
);

contactsRouter.post(
  '/',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = contactInputSchema.parse(request.body);
    await assertCompany(input.companyId);
    const contact = await prisma.contact.create({
      data: { ...input, source: 'manual' },
      include: contactInclude,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'contact.create',
      entityType: 'contact',
      entityId: contact.id,
    });
    response.status(201).json(contactView(contact));
  }),
);

contactsRouter.get(
  '/:id',
  requirePermission('contacts.view', 'contacts.manage'),
  asyncHandler(async (request, response) => {
    const { permissions } = currentUser(request);
    const contact = await prisma.contact.findUnique({
      where: { id: request.params.id },
      include: {
        ...contactInclude,
        notes: {
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { displayName: true } } },
        },
        donations: {
          orderBy: { receivedAt: 'desc' },
          include: donationInclude,
        },
        guests: {
          include: {
            registrations: {
              include: {
                event: true,
                order: {
                  include: { ticketType: { select: { name: true } } },
                },
                passes: { include: { checkin: { select: { id: true } } } },
              },
            },
            orders: {
              include: {
                event: true,
                ticketType: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!contact) {
      throw new AppError(404, 'El contacto no existe.');
    }

    const attendee = contact.guests.flatMap((guest) =>
      guest.registrations.map((registration) => ({
        id: `r-${registration.id}`,
        orderId: registration.orderId,
        eventId: registration.eventId,
        eventName: registration.event.name,
        editionYear: registration.event.editionYear,
        startsAt: registration.event.startsAt,
        ticketName: registration.order.ticketType.name,
        reference: registration.folio,
        status: registration.status,
        role: 'attendee' as const,
        attended: registration.passes.some((pass) => pass.checkin),
      })),
    );
    // La compra solo se muestra aparte si no tiene un lugar propio, como una mesa.
    const seated = new Set(attendee.map(({ orderId }) => orderId));
    const buyer = contact.guests.flatMap((guest) =>
      guest.orders
        .filter((order) => !seated.has(order.id))
        .map((order) => ({
          id: `o-${order.id}`,
          orderId: order.id,
          eventId: order.eventId,
          eventName: order.event.name,
          editionYear: order.event.editionYear,
          startsAt: order.event.startsAt,
          ticketName: order.ticketType.name,
          reference: order.reference,
          status: order.status,
          role: 'buyer' as const,
          attended: false,
        })),
    );
    const history = [...attendee, ...buyer]
      .sort(
        (a, b) =>
          b.editionYear - a.editionYear ||
          (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0),
      )
      .map(({ orderId: _orderId, ...item }) => item);

    const messages = contact.email
      ? await prisma.emailMessage.findMany({
          where: { toEmail: contact.email },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true,
            kind: true,
            status: true,
            sentAt: true,
            createdAt: true,
          },
        })
      : [];

    const seesDonations =
      permissions.includes('donations.view') ||
      permissions.includes('donations.manage');

    response.json({
      ...contactView(contact),
      history,
      notes: contact.notes.map((note) => ({
        id: note.id,
        body: note.body,
        author: note.author?.displayName ?? null,
        createdAt: note.createdAt,
      })),
      donations: seesDonations ? contact.donations.map(donationView) : [],
      messages,
    });
  }),
);

contactsRouter.put(
  '/:id',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = contactInputSchema.parse(request.body);
    const existing = await prisma.contact.findUnique({
      where: { id: request.params.id },
    });
    if (!existing) {
      throw new AppError(404, 'El contacto no existe.');
    }
    await assertCompany(input.companyId);
    const contact = await prisma.contact.update({
      where: { id: existing.id },
      data: input,
      include: contactInclude,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'contact.update',
      entityType: 'contact',
      entityId: contact.id,
    });
    response.json(contactView(contact));
  }),
);

/** Solo se borra quien no tiene historia; con historia se conserva y se da de baja. */
contactsRouter.delete(
  '/:id',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const existing = await prisma.contact.findUnique({
      where: { id: request.params.id },
      include: { _count: { select: { guests: true, donations: true } } },
    });
    if (!existing) {
      throw new AppError(404, 'El contacto no existe.');
    }
    if (existing._count.guests > 0 || existing._count.donations > 0) {
      throw new AppError(
        409,
        'Este contacto tiene registros o donativos, así que no se puede borrar. Puedes darlo de baja de las comunicaciones.',
      );
    }
    await prisma.$transaction(async (tx) => {
      const recipients = await tx.campaignRecipient.findMany({
        where: { contactId: existing.id },
        select: { id: true },
      });
      await tx.emailMessage.deleteMany({
        where: {
          kind: 'campaign',
          refId: { in: recipients.map(({ id }) => id) },
        },
      });
      await tx.contact.delete({ where: { id: existing.id } });
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'contact.delete',
      entityType: 'contact',
      entityId: existing.id,
    });
    response.status(204).end();
  }),
);

contactsRouter.post(
  '/:id/notes',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { body } = contactNoteInputSchema.parse(request.body);
    const contactId = String(request.params.id);
    if (!(await prisma.contact.findUnique({ where: { id: contactId } }))) {
      throw new AppError(404, 'El contacto no existe.');
    }
    const note = await prisma.contactNote.create({
      data: { contactId, body, authorId: currentUser(request).id },
    });
    response.status(201).json({ id: note.id });
  }),
);

contactsRouter.delete(
  '/:id/notes/:noteId',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { count } = await prisma.contactNote.deleteMany({
      where: {
        id: String(request.params.noteId),
        contactId: String(request.params.id),
      },
    });
    if (count === 0) {
      throw new AppError(404, 'La nota no existe.');
    }
    response.status(204).end();
  }),
);

/** La baja también se registra a petición por teléfono o en persona. */
contactsRouter.post(
  '/:id/opt-out',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const contactId = String(request.params.id);
    const { count } = await prisma.contact.updateMany({
      where: { id: contactId, optedOutAt: null },
      data: { optedOutAt: new Date(), optOutSource: 'staff' },
    });
    if (count > 0) {
      await recordAudit({
        userId: currentUser(request).id,
        action: 'contact.opt_out',
        entityType: 'contact',
        entityId: contactId,
      });
    }
    response.status(204).end();
  }),
);

contactsRouter.post(
  '/:id/opt-in',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const contactId = String(request.params.id);
    const { count } = await prisma.contact.updateMany({
      where: { id: contactId, optedOutAt: { not: null } },
      data: { optedOutAt: null, optOutSource: null },
    });
    if (count > 0) {
      await recordAudit({
        userId: currentUser(request).id,
        action: 'contact.opt_in',
        entityType: 'contact',
        entityId: contactId,
      });
    }
    response.status(204).end();
  }),
);

export const companiesRouter = Router();
companiesRouter.use(requireAuth);

companiesRouter.get(
  '/',
  requirePermission('contacts.view', 'contacts.manage'),
  asyncHandler(async (request, response) => {
    const { q } = z.object({ q: queryText }).parse(request.query);
    const { permissions } = currentUser(request);
    const seesDonations =
      permissions.includes('donations.view') ||
      permissions.includes('donations.manage');
    const [companies, totals] = await Promise.all([
      prisma.company.findMany({
        where: q ? { name: { contains: q } } : {},
        orderBy: { name: 'asc' },
        include: { _count: { select: { contacts: true } } },
      }),
      seesDonations
        ? prisma.donation.groupBy({
            by: ['companyId'],
            where: { voidedAt: null, companyId: { not: null } },
            _sum: { amount: true },
          })
        : Promise.resolve([]),
    ]);
    const donated = new Map(
      totals.map((row) => [row.companyId, row._sum.amount?.toNumber() ?? 0]),
    );
    response.json(
      companies.map((company) => ({
        id: company.id,
        name: company.name,
        website: company.website,
        notes: company.notes,
        contacts: company._count.contacts,
        donated: donated.get(company.id) ?? 0,
      })),
    );
  }),
);

companiesRouter.post(
  '/',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = companyInputSchema.parse(request.body);
    const company = await prisma.company.create({ data: input });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'company.create',
      entityType: 'company',
      entityId: company.id,
      details: { name: company.name },
    });
    response.status(201).json({ id: company.id, name: company.name });
  }),
);

companiesRouter.put(
  '/:id',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = companyInputSchema.parse(request.body);
    const existing = await prisma.company.findUnique({
      where: { id: String(request.params.id) },
    });
    if (!existing) {
      throw new AppError(404, 'La empresa no existe.');
    }
    const company = await prisma.company.update({
      where: { id: existing.id },
      data: input,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'company.update',
      entityType: 'company',
      entityId: company.id,
      details: { name: company.name },
    });
    response.json({ id: company.id, name: company.name });
  }),
);

companiesRouter.delete(
  '/:id',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const existing = await prisma.company.findUnique({
      where: { id: String(request.params.id) },
      include: { _count: { select: { contacts: true, donations: true } } },
    });
    if (!existing) {
      throw new AppError(404, 'La empresa no existe.');
    }
    if (existing._count.contacts > 0 || existing._count.donations > 0) {
      throw new AppError(
        409,
        'Esta empresa tiene contactos o donativos, así que no se puede borrar.',
      );
    }
    await prisma.company.delete({ where: { id: existing.id } });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'company.delete',
      entityType: 'company',
      entityId: existing.id,
      details: { name: existing.name },
    });
    response.status(204).end();
  }),
);

export const segmentsRouter = Router();
segmentsRouter.use(requireAuth);

async function segmentView(segment: {
  id: string;
  name: string;
  description: string | null;
  filters: unknown;
  createdAt: Date;
}) {
  const filters = segmentFiltersSchema.parse(segment.filters);
  const where = contactWhere(filters);
  const [contacts, reachable] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.count({ where: { AND: [where, reachableWhere] } }),
  ]);
  return { ...segment, filters, contacts, reachable };
}

segmentsRouter.get(
  '/',
  requirePermission(
    'contacts.view',
    'contacts.manage',
    'communications.view',
    'communications.manage',
    'communications.send',
  ),
  asyncHandler(async (_request, response) => {
    const segments = await prisma.segment.findMany({
      orderBy: { name: 'asc' },
    });
    response.json(await Promise.all(segments.map(segmentView)));
  }),
);

segmentsRouter.post(
  '/',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = segmentInputSchema.parse(request.body);
    const segment = await prisma.segment.create({
      data: { ...input, createdById: currentUser(request).id },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'segment.create',
      entityType: 'segment',
      entityId: segment.id,
      details: { name: segment.name },
    });
    response.status(201).json(await segmentView(segment));
  }),
);

segmentsRouter.put(
  '/:id',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = segmentInputSchema.parse(request.body);
    const existing = await prisma.segment.findUnique({
      where: { id: String(request.params.id) },
    });
    if (!existing) {
      throw new AppError(404, 'El segmento no existe.');
    }
    const segment = await prisma.segment.update({
      where: { id: existing.id },
      data: input,
    });
    response.json(await segmentView(segment));
  }),
);

segmentsRouter.delete(
  '/:id',
  requirePermission('contacts.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const drafts = await prisma.campaign.count({
      where: { segmentId: id, status: 'draft' },
    });
    if (drafts > 0) {
      // Sin el segmento, ese borrador se iría a todos los contactos por error.
      throw new AppError(
        409,
        'Hay comunicaciones en borrador que usan este segmento.',
      );
    }
    const { count } = await prisma.segment.deleteMany({ where: { id } });
    if (count === 0) {
      throw new AppError(404, 'El segmento no existe.');
    }
    await recordAudit({
      userId: currentUser(request).id,
      action: 'segment.delete',
      entityType: 'segment',
      entityId: id,
    });
    response.status(204).end();
  }),
);

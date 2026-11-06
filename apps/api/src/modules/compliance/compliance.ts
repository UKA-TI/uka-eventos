import { Router } from 'express';
import { auditCategories } from '@uka/shared';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { asyncHandler } from '../../async-handler.js';
import { prisma } from '../../database.js';
import { requireAuth, requirePermission } from '../auth/auth.js';
import { auditActionLabels, auditDetailText } from './audit-labels.js';

const PAGE_SIZE = 50;
/** México no cambia de horario desde 2022: un día de la organización va de -06:00 a -06:00. */
const ORGANIZATION_OFFSET = '-06:00';

const queryText = z
  .string()
  .trim()
  .max(120)
  .transform((value) => value || undefined)
  .optional();

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const page = z.coerce.number().int().min(1).default(1);

const auditQuerySchema = z.object({
  page,
  eventId: queryText,
  userId: queryText,
  category: z.enum(auditCategories.map(({ key }) => key)).optional(),
  from: day,
  to: day,
});

const noticeQuerySchema = z.object({
  page,
  q: queryText,
  eventId: queryText,
});

const marketingQuerySchema = z.object({
  page,
  q: queryText,
  status: z.enum(['granted', 'opted_out', 'none']).optional(),
});

/** Cada palabra debe aparecer en alguno de los campos: "ana lopez" encuentra a Ana López. */
function everyWord<T>(q: string | undefined, match: (word: string) => T[]) {
  return (q ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ OR: match(word) }));
}

export const auditRouter = Router();

auditRouter.use(requireAuth, requirePermission('audit.view'));

auditRouter.get(
  '/options',
  asyncHandler(async (_request, response) => {
    const [events, users] = await Promise.all([
      prisma.event.findMany({
        orderBy: [{ startsAt: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        orderBy: { displayName: 'asc' },
        select: { id: true, displayName: true },
      }),
    ]);
    response.json({ events, users });
  }),
);

auditRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const query = auditQuerySchema.parse(request.query);
    const prefixes = auditCategories.find(
      ({ key }) => key === query.category,
    )?.prefixes;
    const where: Prisma.AuditLogWhereInput = {
      eventId: query.eventId,
      userId: query.userId,
      ...(prefixes && {
        OR: prefixes.map((prefix) => ({ action: { startsWith: prefix } })),
      }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && {
            gte: new Date(`${query.from}T00:00:00${ORGANIZATION_OFFSET}`),
          }),
          ...(query.to && {
            lte: new Date(`${query.to}T23:59:59.999${ORGANIZATION_OFFSET}`),
          }),
        },
      }),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: { select: { displayName: true } },
          event: { select: { name: true } },
        },
      }),
    ]);
    response.json({
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      rows: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        actionLabel: auditActionLabels[row.action] ?? row.action,
        detail: auditDetailText(row.details),
        userName: row.user?.displayName ?? null,
        eventName: row.event?.name ?? null,
      })),
    });
  }),
);

export const consentsRouter = Router();

consentsRouter.use(requireAuth, requirePermission('consents.view'));

consentsRouter.get(
  '/events',
  asyncHandler(async (_request, response) => {
    response.json(
      await prisma.event.findMany({
        orderBy: [{ startsAt: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true },
      }),
    );
  }),
);

consentsRouter.get(
  '/notices',
  asyncHandler(async (request, response) => {
    const query = noticeQuerySchema.parse(request.query);
    const inEvent = query.eventId ? { eventId: query.eventId } : {};
    const where: Prisma.ConsentWhereInput = {
      registration: {
        ...inEvent,
        AND: everyWord(query.q, (word) => [
          { folio: { contains: word } },
          { consents: { some: { guest: { firstName: { contains: word } } } } },
          { consents: { some: { guest: { lastName: { contains: word } } } } },
          { consents: { some: { guest: { email: { contains: word } } } } },
        ]),
      },
    };
    const [total, accepted, pending, rows] = await Promise.all([
      prisma.consent.count({ where }),
      prisma.consent.count({ where: { registration: inEvent } }),
      prisma.pass.count({
        where: { status: 'pending_activation', registration: inEvent },
      }),
      prisma.consent.findMany({
        where,
        orderBy: [{ consentedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          registration: {
            select: {
              folio: true,
              event: { select: { name: true } },
            },
          },
          // Quien aceptó, no quien tiene hoy el lugar: un pase cedido no cambia la evidencia.
          guest: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
    ]);
    response.json({
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      accepted,
      pending,
      rows: rows.map(({ registration, guest, ...consent }) => ({
        id: consent.id,
        guestName: `${guest.firstName} ${guest.lastName}`,
        email: guest.email,
        eventName: registration.event.name,
        folio: registration.folio,
        purpose: consent.purpose,
        noticeVersion: consent.noticeVersion,
        consentedAt: consent.consentedAt,
      })),
    });
  }),
);

const marketingStatus: Record<
  'granted' | 'opted_out' | 'none',
  Prisma.ContactWhereInput
> = {
  granted: { optedOutAt: null, marketingConsentAt: { not: null } },
  opted_out: { optedOutAt: { not: null } },
  none: { optedOutAt: null, marketingConsentAt: null },
};

consentsRouter.get(
  '/marketing',
  asyncHandler(async (request, response) => {
    const query = marketingQuerySchema.parse(request.query);
    const where: Prisma.ContactWhereInput = {
      ...(query.status ? marketingStatus[query.status] : {}),
      AND: everyWord(query.q, (word) => [
        { firstName: { contains: word } },
        { lastName: { contains: word } },
        { email: { contains: word } },
      ]),
    };
    const [total, granted, optedOut, none, rows] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.count({ where: marketingStatus.granted }),
      prisma.contact.count({ where: marketingStatus.opted_out }),
      prisma.contact.count({ where: marketingStatus.none }),
      prisma.contact.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          optedOutAt: true,
          optOutSource: true,
          marketingConsentAt: true,
          marketingConsentSource: true,
          marketingNoticeVersion: true,
        },
      }),
    ]);
    response.json({
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      granted,
      optedOut,
      none,
      rows: rows.map((contact) => {
        const status = contact.optedOutAt
          ? 'opted_out'
          : contact.marketingConsentAt
            ? 'granted'
            : 'none';
        return {
          contactId: contact.id,
          name: `${contact.firstName} ${contact.lastName}`,
          email: contact.email,
          status,
          // Una baja deja de contar la autorización anterior: se muestra lo vigente.
          at: contact.optedOutAt ?? contact.marketingConsentAt,
          source:
            status === 'opted_out'
              ? contact.optOutSource
              : contact.marketingConsentSource,
          noticeVersion:
            status === 'granted' ? contact.marketingNoticeVersion : null,
        };
      }),
    });
  }),
);

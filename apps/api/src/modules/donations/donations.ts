import { Router } from 'express';
import { donationInputSchema, donationVoidSchema } from '@uka/shared';
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

const PAGE_SIZE = 50;

export const donationInclude = {
  contact: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  event: { select: { id: true, name: true } },
  recordedBy: { select: { displayName: true } },
} satisfies Prisma.DonationInclude;

type DonationRow = Prisma.DonationGetPayload<{
  include: typeof donationInclude;
}>;

export function donationView(donation: DonationRow) {
  return {
    id: donation.id,
    amount: donation.amount.toNumber(),
    currency: donation.currency,
    method: donation.method,
    reference: donation.reference,
    notes: donation.notes,
    receivedAt: donation.receivedAt,
    contact: donation.contact
      ? {
          id: donation.contact.id,
          name: `${donation.contact.firstName} ${donation.contact.lastName}`,
        }
      : null,
    company: donation.company,
    event: donation.event,
    recordedBy: donation.recordedBy?.displayName ?? null,
    voidedAt: donation.voidedAt,
    voidReason: donation.voidReason,
  };
}

const donationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  eventId: z.string().max(30).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const donationsRouter = Router();
donationsRouter.use(requireAuth);

donationsRouter.get(
  '/',
  requirePermission('donations.view', 'donations.manage'),
  asyncHandler(async (request, response) => {
    const { page, eventId, year } = donationQuerySchema.parse(request.query);
    const where: Prisma.DonationWhereInput = {
      ...(eventId ? { eventId } : {}),
      ...(year
        ? {
            receivedAt: {
              gte: new Date(Date.UTC(year, 0, 1)),
              lt: new Date(Date.UTC(year + 1, 0, 1)),
            },
          }
        : {}),
    };
    const [donations, total, sum] = await Promise.all([
      prisma.donation.findMany({
        where,
        include: donationInclude,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.donation.count({ where }),
      prisma.donation.aggregate({
        where: { ...where, voidedAt: null },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    response.json({
      donations: donations.map(donationView),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalAmount: sum._sum.amount?.toNumber() ?? 0,
      count: sum._count._all,
    });
  }),
);

donationsRouter.post(
  '/',
  requirePermission('donations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = donationInputSchema.parse(request.body);
    const [contact, company, event] = await Promise.all([
      input.contactId
        ? prisma.contact.findUnique({ where: { id: input.contactId } })
        : true,
      input.companyId
        ? prisma.company.findUnique({ where: { id: input.companyId } })
        : true,
      input.eventId
        ? prisma.event.findUnique({ where: { id: input.eventId } })
        : true,
    ]);
    if (!contact || !company || !event) {
      throw new AppError(400, 'El donante o el evento ya no existe.');
    }
    const userId = currentUser(request).id;
    const donation = await prisma.donation.create({
      data: {
        ...input,
        receivedAt: new Date(input.receivedAt),
        recordedById: userId,
      },
      include: donationInclude,
    });
    await recordAudit({
      userId,
      action: 'donation.create',
      entityType: 'donation',
      entityId: donation.id,
      eventId: donation.eventId ?? undefined,
      details: { amount: input.amount, method: input.method },
    });
    response.status(201).json(donationView(donation));
  }),
);

/** Un donativo no se borra: se anula con motivo para que los totales sean auditables. */
donationsRouter.post(
  '/:id/void',
  requirePermission('donations.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { reason } = donationVoidSchema.parse(request.body);
    const id = String(request.params.id);
    const userId = currentUser(request).id;
    const { count } = await prisma.donation.updateMany({
      where: { id, voidedAt: null },
      data: { voidedAt: new Date(), voidedById: userId, voidReason: reason },
    });
    if (count === 0) {
      throw new AppError(409, 'El donativo no existe o ya estaba anulado.');
    }
    await recordAudit({
      userId,
      action: 'donation.void',
      entityType: 'donation',
      entityId: id,
      details: { reason },
    });
    response.status(204).end();
  }),
);

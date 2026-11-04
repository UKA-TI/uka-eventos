import { Router } from 'express';
import {
  campaignInputSchema,
  segmentFiltersSchema,
  templateInputSchema,
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
import { contactWhere, reachableWhere } from '../contacts/filters.js';
import { CAMPAIGN_PRIORITY } from '../mail/queue.js';
import { renderCampaignPreview } from '../mail/templates.js';

const SEND_TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 };

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get(
  '/',
  requirePermission(
    'communications.view',
    'communications.manage',
    'communications.send',
  ),
  asyncHandler(async (_request, response) => {
    response.json(
      await prisma.emailTemplate.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, subject: true, body: true },
      }),
    );
  }),
);

templatesRouter.post(
  '/',
  requirePermission('communications.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = templateInputSchema.parse(request.body);
    const template = await prisma.emailTemplate.create({ data: input });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'template.create',
      entityType: 'template',
      entityId: template.id,
      details: { name: template.name },
    });
    response.status(201).json(template);
  }),
);

templatesRouter.put(
  '/:id',
  requirePermission('communications.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = templateInputSchema.parse(request.body);
    const id = String(request.params.id);
    if (!(await prisma.emailTemplate.findUnique({ where: { id } }))) {
      throw new AppError(404, 'La plantilla no existe.');
    }
    response.json(
      await prisma.emailTemplate.update({ where: { id }, data: input }),
    );
  }),
);

templatesRouter.delete(
  '/:id',
  requirePermission('communications.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const { count } = await prisma.emailTemplate.deleteMany({
      where: { id: String(request.params.id) },
    });
    if (count === 0) {
      throw new AppError(404, 'La plantilla no existe.');
    }
    response.status(204).end();
  }),
);

const campaignInclude = {
  event: { select: { name: true } },
  segment: { select: { name: true, filters: true } },
  sentBy: { select: { displayName: true } },
  _count: { select: { recipients: true } },
} satisfies Prisma.CampaignInclude;

type CampaignRow = Prisma.CampaignGetPayload<{
  include: typeof campaignInclude;
}>;

/** A quién se enviaría ahora. Sin segmento, a todos los contactos a quienes se puede escribir. */
function audienceWhere(
  segment: { filters: unknown } | null,
): Prisma.ContactWhereInput {
  return {
    AND: [
      segment ? contactWhere(segmentFiltersSchema.parse(segment.filters)) : {},
      reachableWhere,
    ],
  };
}

async function campaignView(campaign: CampaignRow) {
  const [audience, stats] = await Promise.all([
    campaign.status === 'draft'
      ? prisma.contact.count({ where: audienceWhere(campaign.segment) })
      : campaign._count.recipients,
    prisma.emailMessage.groupBy({
      by: ['status'],
      where: { campaignId: campaign.id, kind: 'campaign' },
      _count: { _all: true },
    }),
  ]);
  const count = (...statuses: string[]) =>
    stats
      .filter((row) => statuses.includes(row.status))
      .reduce((total, row) => total + row._count._all, 0);
  return {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    body: campaign.body,
    eventId: campaign.eventId,
    eventName: campaign.event?.name ?? null,
    segmentId: campaign.segmentId,
    segmentName: campaign.segment?.name ?? null,
    status: campaign.status,
    queuedAt: campaign.queuedAt,
    cancelledAt: campaign.cancelledAt,
    createdAt: campaign.createdAt,
    sentBy: campaign.sentBy?.displayName ?? null,
    audience,
    stats: {
      pending: count('pending', 'sending'),
      sent: count('sent'),
      failed: count('failed'),
      skipped: count('skipped'),
    },
  };
}

async function loadCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: campaignInclude,
  });
  if (!campaign) {
    throw new AppError(404, 'La comunicación no existe.');
  }
  return campaign;
}

async function assertReferences(input: {
  eventId: string | null;
  segmentId: string | null;
}) {
  const [event, segment] = await Promise.all([
    input.eventId
      ? prisma.event.findUnique({ where: { id: input.eventId } })
      : true,
    input.segmentId
      ? prisma.segment.findUnique({ where: { id: input.segmentId } })
      : true,
  ]);
  if (!event) {
    throw new AppError(400, 'El evento no existe.');
  }
  if (!segment) {
    throw new AppError(400, 'El segmento no existe.');
  }
}

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

const canReadCampaigns = requirePermission(
  'communications.view',
  'communications.manage',
  'communications.send',
);

campaignsRouter.get(
  '/',
  canReadCampaigns,
  asyncHandler(async (_request, response) => {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: campaignInclude,
    });
    response.json(await Promise.all(campaigns.map(campaignView)));
  }),
);

campaignsRouter.post(
  '/',
  requirePermission('communications.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = campaignInputSchema.parse(request.body);
    await assertReferences(input);
    const campaign = await prisma.campaign.create({
      data: { ...input, createdById: currentUser(request).id },
      include: campaignInclude,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'campaign.create',
      entityType: 'campaign',
      entityId: campaign.id,
      details: { name: campaign.name },
    });
    response.status(201).json(await campaignView(campaign));
  }),
);

campaignsRouter.get(
  '/:id',
  canReadCampaigns,
  asyncHandler(async (request, response) => {
    response.json(
      await campaignView(await loadCampaign(String(request.params.id))),
    );
  }),
);

campaignsRouter.get(
  '/:id/preview',
  canReadCampaigns,
  asyncHandler(async (request, response) => {
    const preview = await renderCampaignPreview(String(request.params.id));
    if (!preview) {
      throw new AppError(404, 'La comunicación no existe.');
    }
    response.json(preview);
  }),
);

campaignsRouter.put(
  '/:id',
  requirePermission('communications.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = campaignInputSchema.parse(request.body);
    const id = String(request.params.id);
    await assertReferences(input);
    const { count } = await prisma.campaign.updateMany({
      where: { id, status: 'draft' },
      data: input,
    });
    if (count === 0) {
      throw new AppError(409, 'Solo se puede editar un borrador.');
    }
    response.json(await campaignView(await loadCampaign(id)));
  }),
);

campaignsRouter.delete(
  '/:id',
  requirePermission('communications.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const { count } = await prisma.campaign.deleteMany({
      where: { id, status: 'draft' },
    });
    if (count === 0) {
      throw new AppError(409, 'Solo se puede borrar un borrador.');
    }
    await recordAudit({
      userId: currentUser(request).id,
      action: 'campaign.delete',
      entityType: 'campaign',
      entityId: id,
    });
    response.status(204).end();
  }),
);

/** Copia para volver a enviar o corregir una comunicación ya enviada. */
campaignsRouter.post(
  '/:id/duplicate',
  requirePermission('communications.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const source = await loadCampaign(String(request.params.id));
    const copy = await prisma.campaign.create({
      data: {
        name: `${source.name} (copia)`.slice(0, 120),
        subject: source.subject,
        body: source.body,
        eventId: source.eventId,
        segmentId: source.segmentId,
        createdById: currentUser(request).id,
      },
      include: campaignInclude,
    });
    response.status(201).json(await campaignView(copy));
  }),
);

/** La prueba solo va al correo de quien la pide: no sirve para escribirle a terceros. */
campaignsRouter.post(
  '/:id/test',
  requirePermission('communications.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const campaign = await loadCampaign(String(request.params.id));
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: currentUser(request).id },
      select: { email: true },
    });
    await prisma.emailMessage.create({
      data: {
        kind: 'campaign_test',
        refId: campaign.id,
        campaignId: campaign.id,
        toEmail: user.email,
      },
    });
    response.status(202).json({ toEmail: user.email });
  }),
);

campaignsRouter.post(
  '/:id/send',
  requirePermission('communications.send'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const campaign = await loadCampaign(String(request.params.id));
    const userId = currentUser(request).id;
    if (campaign.segmentId && !campaign.segment) {
      throw new AppError(409, 'El segmento de esta comunicación ya no existe.');
    }
    if (campaign.eventId) {
      const event = await prisma.event.findUnique({
        where: { id: campaign.eventId },
      });
      if (event?.status !== 'active') {
        throw new AppError(
          409,
          'El evento elegido no está activo. Actívalo o quítalo de la comunicación.',
        );
      }
    }
    const count = await prisma.$transaction(async (tx) => {
      // Dos clics o dos personas no pueden enviar la misma comunicación dos veces.
      const claim = await tx.campaign.updateMany({
        where: { id: campaign.id, status: 'draft' },
        data: { status: 'queued', queuedAt: new Date(), sentById: userId },
      });
      if (claim.count === 0) {
        throw new AppError(409, 'Esta comunicación ya se envió.');
      }
      const contacts = await tx.contact.findMany({
        where: audienceWhere(campaign.segment),
        select: { id: true, email: true },
      });
      if (contacts.length === 0) {
        throw new AppError(409, 'No hay contactos a quienes enviarla.');
      }
      await tx.campaignRecipient.createMany({
        data: contacts.map((contact) => ({
          campaignId: campaign.id,
          contactId: contact.id,
        })),
      });
      const recipients = await tx.campaignRecipient.findMany({
        where: { campaignId: campaign.id },
        select: { id: true, contactId: true },
      });
      const emails = new Map(
        contacts.map((contact) => [contact.id, contact.email ?? '']),
      );
      await tx.emailMessage.createMany({
        data: recipients.map((recipient) => ({
          kind: 'campaign',
          refId: recipient.id,
          campaignId: campaign.id,
          priority: CAMPAIGN_PRIORITY,
          toEmail: emails.get(recipient.contactId) ?? '',
        })),
      });
      return recipients.length;
    }, SEND_TX_OPTIONS);
    await recordAudit({
      userId,
      action: 'campaign.send',
      entityType: 'campaign',
      entityId: campaign.id,
      details: { recipients: count, name: campaign.name },
    });
    response.json(await campaignView(await loadCampaign(campaign.id)));
  }),
);

/** Detiene lo que aún no sale. Lo ya enviado no se puede recuperar. */
campaignsRouter.post(
  '/:id/cancel',
  requirePermission('communications.send'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const claim = await prisma.campaign.updateMany({
      where: { id, status: 'queued' },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    if (claim.count === 0) {
      throw new AppError(409, 'Esta comunicación no se está enviando.');
    }
    await prisma.emailMessage.updateMany({
      where: { campaignId: id, kind: 'campaign', status: 'pending' },
      data: { status: 'skipped', lastError: 'Comunicación cancelada' },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'campaign.cancel',
      entityType: 'campaign',
      entityId: id,
    });
    response.json(await campaignView(await loadCampaign(id)));
  }),
);

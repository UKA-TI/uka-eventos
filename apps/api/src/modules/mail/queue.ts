import type { Logger } from 'pino';
import type { Prisma } from '../../generated/prisma/client.js';
import { config } from '../../config.js';
import { prisma } from '../../database.js';
import {
  graphTransport,
  MailServiceError,
  type MailTransport,
} from './graph-transport.js';
import { renderEmail } from './templates.js';

const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const TICK_MS = 10_000;
const SERVICE_RETRY_MS = 5 * 60 * 1000;

/** Las comunicaciones masivas salen después de pases y avisos de pago. */
export const CAMPAIGN_PRIORITY = 10;
/** Parte del límite diario que una campaña nunca puede usar. */
const TRANSACTIONAL_DAILY_RESERVE = 0.2;

// Dominios reservados para pruebas (RFC 2606): nunca existen como destinatarios.
const RESERVED_DOMAIN = /\.(test|example|invalid|localhost)$/i;

export function mailConfigured(): boolean {
  return Boolean(
    config.AZURE_TENANT_ID &&
      config.MAIL_CLIENT_ID &&
      config.MAIL_CLIENT_SECRET,
  );
}

export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  message: { eventId: string; kind: string; refId: string; toEmail: string },
): Promise<void> {
  await tx.emailMessage.create({ data: message });
}

/**
 * Envía lo que quepa dentro de los límites de Microsoft 365. Los envíos se cuentan
 * en la base de datos, así que los límites se respetan aunque la app se reinicie.
 */
export async function processMailQueue(
  transport: MailTransport,
  limits = {
    perMinute: config.MAIL_RATE_PER_MINUTE,
    perDay: config.MAIL_DAILY_LIMIT,
  },
  options = { skipReservedDomains: false },
): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = Date.now();
  await prisma.emailMessage.updateMany({
    where: {
      status: 'sending',
      claimedAt: { lt: new Date(now - STALE_CLAIM_MS) },
    },
    data: { status: 'pending', claimedAt: null },
  });

  const [lastMinute, lastDay] = await Promise.all([
    prisma.emailMessage.count({
      where: { sentAt: { gte: new Date(now - 60_000) } },
    }),
    prisma.emailMessage.count({
      where: { sentAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
    }),
  ]);
  const capacity = Math.min(
    limits.perMinute - lastMinute,
    limits.perDay - lastDay,
  );
  const result = { sent: 0, failed: 0, skipped: 0 };
  if (capacity <= 0) {
    return result;
  }

  const dueNow = { status: 'pending', nextAttemptAt: { lte: new Date(now) } };
  const transactional = await prisma.emailMessage.findMany({
    where: { ...dueNow, priority: { lt: CAMPAIGN_PRIORITY } },
    orderBy: { createdAt: 'asc' },
    take: capacity,
  });
  const campaignCapacity = Math.min(
    capacity - transactional.length,
    Math.floor(limits.perDay * (1 - TRANSACTIONAL_DAILY_RESERVE)) - lastDay,
  );
  const campaign =
    campaignCapacity > 0
      ? await prisma.emailMessage.findMany({
          where: { ...dueNow, priority: { gte: CAMPAIGN_PRIORITY } },
          orderBy: { createdAt: 'asc' },
          take: campaignCapacity,
        })
      : [];
  const due = [...transactional, ...campaign];

  for (const message of due) {
    const claim = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: 'pending' },
      data: { status: 'sending', claimedAt: new Date() },
    });
    if (claim.count === 0) {
      continue;
    }
    try {
      if (
        options.skipReservedDomains &&
        RESERVED_DOMAIN.test(message.toEmail)
      ) {
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            status: 'skipped',
            lastError: 'Dirección de prueba',
            claimedAt: null,
          },
        });
        result.skipped += 1;
        continue;
      }
      const email = await renderEmail(message.kind, message.refId);
      if (!email) {
        // El pedido cambió, por ejemplo se canceló: ya no debe enviarse.
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            status: 'skipped',
            lastError: 'Ya no aplica',
            claimedAt: null,
          },
        });
        result.skipped += 1;
        continue;
      }
      await transport.send(message.toEmail, email);
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          attempts: message.attempts + 1,
          lastError: null,
          claimedAt: null,
        },
      });
      result.sent += 1;
    } catch (error) {
      if (error instanceof MailServiceError) {
        // Todos los mensajes fallarían igual: se detiene el envío y se reintenta
        // después, sin gastar sus intentos. Nada se pierde mientras se corrige.
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: {
            status: 'pending',
            claimedAt: null,
            lastError: error.message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + SERVICE_RETRY_MS),
          },
        });
        await prisma.emailMessage.updateMany({
          where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
          data: { nextAttemptAt: new Date(Date.now() + SERVICE_RETRY_MS) },
        });
        result.failed += 1;
        break;
      }
      const attempts = message.attempts + 1;
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          claimedAt: null,
          lastError: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 500),
          nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
        },
      });
      result.failed += 1;
    }
  }
  return result;
}

/** Sin credenciales de correo no envía nada: los mensajes esperan en la cola. */
export function startMailWorker(logger: Logger): () => void {
  if (!mailConfigured()) {
    logger.warn('Mail is not configured: messages stay queued');
    return () => undefined;
  }
  let running = false;
  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const result = await processMailQueue(graphTransport, undefined, {
        skipReservedDomains: true,
      });
      if (result.sent || result.failed) {
        logger.info(result, 'Mail queue processed');
      }
    } catch (error) {
      logger.error({ err: error }, 'Mail queue failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

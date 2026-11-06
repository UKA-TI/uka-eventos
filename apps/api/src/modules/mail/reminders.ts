import { nextReminderStage } from '@uka/shared';
import { prisma } from '../../database.js';

const REMINDER_BEFORE_MS = 24 * 60 * 60 * 1000;

/**
 * Encola el recordatorio de los eventos que empiezan en las próximas 24 horas. Reclamar
 * el evento dentro de la transacción impide enviarlo dos veces, aunque corran dos
 * procesos o la app se reinicie. Quien no ha activado su pase recibe esa invitación.
 */
export async function queueEventReminders(now = new Date()): Promise<number> {
  const due = await prisma.event.findMany({
    where: {
      status: 'active',
      reminderSentAt: null,
      startsAt: {
        gt: now,
        lte: new Date(now.getTime() + REMINDER_BEFORE_MS),
      },
    },
    select: { id: true },
  });
  let queued = 0;
  for (const event of due) {
    queued += await prisma.$transaction(async (tx) => {
      const claim = await tx.event.updateMany({
        where: { id: event.id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claim.count === 0) {
        return 0;
      }
      const passes = await tx.pass.findMany({
        where: {
          status: { in: ['active', 'pending_activation'] },
          checkin: { is: null },
          registration: {
            eventId: event.id,
            status: 'confirmed',
            guest: { email: { not: null } },
          },
        },
        select: {
          id: true,
          status: true,
          registration: { select: { guest: { select: { email: true } } } },
        },
      });
      await tx.emailMessage.createMany({
        data: passes.map((pass) => ({
          eventId: event.id,
          kind: pass.status === 'active' ? 'event_reminder' : 'pass_activation',
          refId: pass.id,
          toEmail: pass.registration.guest.email ?? '',
        })),
      });
      return passes.length;
    });
  }
  return queued;
}

const MANUAL_REST_MS = 24 * 60 * 60 * 1000;

/**
 * Recordatorios de cobro según su vencimiento. Nunca cancelan ni liberan lugares: solo
 * avisan. Terminan al pagar, al cancelar o al empezar el evento. Si alguien del equipo
 * acaba de recordar a mano, espera un día para no enviar dos correos seguidos.
 */
export async function queuePaymentReminders(now = new Date()): Promise<number> {
  const orders = await prisma.order.findMany({
    where: {
      status: 'pending_payment',
      dueAt: { not: null },
      reminderStage: { lt: 4 },
      event: {
        status: 'active',
        paymentReminders: true,
        OR: [{ startsAt: null }, { startsAt: { gt: now } }],
      },
      buyer: { email: { not: null } },
    },
    select: {
      id: true,
      eventId: true,
      dueAt: true,
      reminderStage: true,
      lastReminderAt: true,
      buyer: { select: { email: true } },
    },
  });
  let queued = 0;
  for (const order of orders) {
    const stage = nextReminderStage(order.dueAt!, order.reminderStage, now);
    if (stage === null) {
      continue;
    }
    const rested =
      !order.lastReminderAt ||
      now.getTime() - order.lastReminderAt.getTime() >= MANUAL_REST_MS;
    if (!rested) {
      continue;
    }
    queued += await prisma.$transaction(async (tx) => {
      // Reclamar la etapa impide repetir el correo si corren dos procesos.
      const claim = await tx.order.updateMany({
        where: {
          id: order.id,
          status: 'pending_payment',
          reminderStage: order.reminderStage,
        },
        data: { reminderStage: stage, lastReminderAt: now },
      });
      if (claim.count === 0) {
        return 0;
      }
      await tx.emailMessage.create({
        data: {
          eventId: order.eventId,
          kind: 'payment_reminder',
          refId: order.id,
          toEmail: order.buyer.email ?? '',
        },
      });
      return 1;
    });
  }
  return queued;
}

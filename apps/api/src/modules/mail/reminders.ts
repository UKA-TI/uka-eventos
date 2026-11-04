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

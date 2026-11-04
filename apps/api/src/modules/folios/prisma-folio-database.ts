import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import {
  FolioService,
  type FolioDatabase,
  type FolioTransaction,
} from './folio-service.js';

function folioTransaction(
  transaction: Prisma.TransactionClient,
): FolioTransaction {
  return {
    findEvent: async (eventId) =>
      transaction.event.findUnique({
        where: { id: eventId },
        select: { folioPrefix: true, startsAt: true },
      }),
    lockCounter: async (eventId) => {
      const rows = await transaction.$queryRaw<
        { currentValue: number | bigint | string }[]
      >`SELECT current_value AS currentValue
        FROM event_counters
        WHERE event_id = ${eventId} AND counter_type = 'registration'
        FOR UPDATE`;
      const value = rows[0]?.currentValue;
      if (value === undefined || value === null) {
        return null;
      }

      const currentValue = Number(value);
      return Number.isSafeInteger(currentValue) ? currentValue : Number.NaN;
    },
    updateCounter: async (eventId, currentValue) => {
      await transaction.eventCounter.update({
        where: {
          eventId_counterType: { eventId, counterType: 'registration' },
        },
        data: { currentValue },
      });
    },
  };
}

export class PrismaFolioDatabase implements FolioDatabase {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(
    work: (transaction: FolioTransaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (transaction) => work(folioTransaction(transaction)),
      { maxWait: 60_000, timeout: 120_000 },
    );
  }
}

/** Emite un folio dentro de una transacción ya abierta: si esta falla, no se pierde. */
export function issueFolioWithin(
  transaction: Prisma.TransactionClient,
  eventId: string,
): Promise<string> {
  return new FolioService({
    transaction: (work) => work(folioTransaction(transaction)),
  }).issue(eventId);
}

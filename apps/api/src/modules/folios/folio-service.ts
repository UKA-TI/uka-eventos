export interface FolioEvent {
  folioPrefix: string | null;
  startsAt: Date | null;
}

export interface FolioTransaction {
  findEvent(eventId: string): Promise<FolioEvent | null>;
  lockCounter(eventId: string): Promise<number | null>;
  updateCounter(eventId: string, value: number): Promise<void>;
}

export interface FolioDatabase {
  transaction<T>(
    work: (transaction: FolioTransaction) => Promise<T>,
  ): Promise<T>;
}

export class FolioEventNotFoundError extends Error {
  constructor(eventId: string) {
    super(`Event ${eventId} was not found`);
    this.name = 'FolioEventNotFoundError';
  }
}

export class FolioConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FolioConfigurationError';
  }
}

export class FolioCounterNotFoundError extends Error {
  constructor(eventId: string) {
    super(`Registration folio counter is missing for event ${eventId}`);
    this.name = 'FolioCounterNotFoundError';
  }
}

export class FolioSequenceExhaustedError extends Error {
  constructor(eventId: string) {
    super(`Registration folio sequence is exhausted for event ${eventId}`);
    this.name = 'FolioSequenceExhaustedError';
  }
}

export class FolioService {
  constructor(private readonly database: FolioDatabase) {}

  issue(eventId: string): Promise<string> {
    return this.database.transaction(async (transaction) => {
      const event = await transaction.findEvent(eventId);
      if (!event) {
        throw new FolioEventNotFoundError(eventId);
      }

      if (!event.folioPrefix || !/^[A-Z0-9]{3}$/.test(event.folioPrefix)) {
        throw new FolioConfigurationError(
          `Event ${eventId} must have a three-character uppercase folio prefix`,
        );
      }

      if (!event.startsAt || Number.isNaN(event.startsAt.getTime())) {
        throw new FolioConfigurationError(
          `Event ${eventId} must have a valid start date to issue folios`,
        );
      }

      const currentValue = await transaction.lockCounter(eventId);
      if (currentValue === null) {
        throw new FolioCounterNotFoundError(eventId);
      }

      if (!Number.isInteger(currentValue) || currentValue < 0) {
        throw new FolioConfigurationError(
          `Event ${eventId} has an invalid registration folio counter`,
        );
      }

      const nextValue = currentValue + 1;
      if (nextValue > 9999) {
        throw new FolioSequenceExhaustedError(eventId);
      }

      await transaction.updateCounter(eventId, nextValue);
      const year = String(event.startsAt.getUTCFullYear()).slice(-2);
      return `${event.folioPrefix}${year}-${String(nextValue).padStart(4, '0')}`;
    });
  }
}

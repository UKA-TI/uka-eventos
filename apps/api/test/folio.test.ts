import { describe, expect, it } from 'vitest';
import {
  FolioConfigurationError,
  FolioCounterNotFoundError,
  FolioEventNotFoundError,
  FolioSequenceExhaustedError,
  FolioService,
  type FolioDatabase,
  type FolioEvent,
  type FolioTransaction,
} from '../src/modules/folios/folio-service.js';

const event: FolioEvent = {
  folioPrefix: 'GAL',
  startsAt: new Date('2027-02-12T00:30:00.000Z'),
};

class MemoryDatabase implements FolioDatabase {
  value: number | null;
  currentEvent: FolioEvent | null;
  private queue = Promise.resolve();

  constructor(options?: { value?: number | null; event?: FolioEvent | null }) {
    this.value = options && 'value' in options ? (options.value ?? null) : 0;
    this.currentEvent =
      options && 'event' in options ? (options.event ?? null) : event;
  }

  async transaction<T>(
    work: (transaction: FolioTransaction) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      return await work({
        findEvent: async () => this.currentEvent,
        lockCounter: async () => this.value,
        updateCounter: async (_eventId, value) => {
          this.value = value;
        },
      });
    } finally {
      release();
    }
  }
}

describe('FolioService', () => {
  it('creates a folio from the event prefix and UTC start year', async () => {
    const database = new MemoryDatabase({ value: 41 });
    const service = new FolioService(database);

    await expect(service.issue('event-1')).resolves.toBe('GAL27-0042');
    expect(database.value).toBe(42);
  });

  it('issues unique folios for 500 parallel service calls', async () => {
    const service = new FolioService(new MemoryDatabase());

    const folios = await Promise.all(
      Array.from({ length: 500 }, () => service.issue('event-1')),
    );

    expect(new Set(folios).size).toBe(500);
    expect(folios).toContain('GAL27-0001');
    expect(folios).toContain('GAL27-0500');
  });

  it('rejects an event that does not exist', async () => {
    const service = new FolioService(new MemoryDatabase({ event: null }));

    await expect(service.issue('missing')).rejects.toBeInstanceOf(
      FolioEventNotFoundError,
    );
  });

  it('rejects a missing or invalid folio prefix', async () => {
    const missingPrefix = new FolioService(
      new MemoryDatabase({ event: { ...event, folioPrefix: null } }),
    );
    const invalidPrefix = new FolioService(
      new MemoryDatabase({ event: { ...event, folioPrefix: 'gal' } }),
    );

    await expect(missingPrefix.issue('event-1')).rejects.toBeInstanceOf(
      FolioConfigurationError,
    );
    await expect(invalidPrefix.issue('event-1')).rejects.toBeInstanceOf(
      FolioConfigurationError,
    );
  });

  it('rejects a missing or invalid event start date', async () => {
    const missingStart = new FolioService(
      new MemoryDatabase({ event: { ...event, startsAt: null } }),
    );
    const invalidStart = new FolioService(
      new MemoryDatabase({
        event: { ...event, startsAt: new Date('invalid') },
      }),
    );

    await expect(missingStart.issue('event-1')).rejects.toBeInstanceOf(
      FolioConfigurationError,
    );
    await expect(invalidStart.issue('event-1')).rejects.toBeInstanceOf(
      FolioConfigurationError,
    );
  });

  it('rejects a missing or invalid counter', async () => {
    const missingCounter = new FolioService(
      new MemoryDatabase({ value: null }),
    );
    const invalidCounter = new FolioService(new MemoryDatabase({ value: -1 }));

    await expect(missingCounter.issue('event-1')).rejects.toBeInstanceOf(
      FolioCounterNotFoundError,
    );
    await expect(invalidCounter.issue('event-1')).rejects.toBeInstanceOf(
      FolioConfigurationError,
    );
  });

  it('issues the final four-digit folio and rejects the next one', async () => {
    const database = new MemoryDatabase({ value: 9998 });
    const service = new FolioService(database);

    await expect(service.issue('event-1')).resolves.toBe('GAL27-9999');
    await expect(service.issue('event-1')).rejects.toBeInstanceOf(
      FolioSequenceExhaustedError,
    );
  });
});

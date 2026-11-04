import assert from 'node:assert/strict';
import { PrismaFolioDatabase } from '../src/modules/folios/prisma-folio-database.js';
import { FolioService } from '../src/modules/folios/folio-service.js';
import { prisma } from '../src/database.js';

const slug = `folio-concurrency-${Date.now()}`;
const service = new FolioService(new PrismaFolioDatabase(prisma));
let eventId: string | undefined;

try {
  const event = await prisma.event.create({
    data: {
      slug,
      name: 'Folio concurrency integration test',
      status: 'draft',
      editionYear: 2027,
      modules: [],
      series: {
        connectOrCreate: {
          where: { name: 'Folio concurrency test series' },
          create: { name: 'Folio concurrency test series', type: 'Prueba' },
        },
      },
      startsAt: new Date('2027-02-12T00:30:00.000Z'),
      folioPrefix: 'TST',
    },
  });
  eventId = event.id;

  await prisma.eventCounter.create({
    data: { eventId, counterType: 'registration', currentValue: 0 },
  });

  const results = await Promise.allSettled(
    Array.from({ length: 500 }, () => service.issue(event.id)),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  assert.equal(
    failures.length,
    0,
    `all 500 folio transactions must succeed: ${failures
      .slice(0, 3)
      .map((failure) => String(failure.reason))
      .join('; ')}`,
  );

  const folios = results.map((result) => {
    assert.equal(result.status, 'fulfilled');
    return result.value;
  });
  assert.equal(new Set(folios).size, 500, 'folios must not repeat');
  assert.equal(
    await prisma.eventCounter
      .findUniqueOrThrow({
        where: {
          eventId_counterType: {
            eventId: event.id,
            counterType: 'registration',
          },
        },
      })
      .then((counter) => counter.currentValue),
    500,
  );
  console.log(
    'PASS: 500 concurrent MySQL folio transactions produced unique folios.',
  );
} finally {
  if (eventId) {
    await prisma.eventCounter.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
    await prisma.eventSeries.deleteMany({
      where: { name: 'Folio concurrency test series', events: { none: {} } },
    });
  }
  await prisma.$disconnect();
}

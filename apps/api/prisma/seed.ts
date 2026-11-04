import { defaultModulesForType } from '@uka/shared';
import { ensureSystemData } from '../src/bootstrap.js';
import { config } from '../src/config.js';
import { prisma } from '../src/database.js';

/**
 * Datos solo para desarrollo local. En producción los perfiles se crean al
 * arrancar la API y el primer administrador sale de BOOTSTRAP_ADMIN_EMAIL.
 */
async function seed() {
  if (config.NODE_ENV === 'production') {
    throw new Error('The development seed must not run in production');
  }

  await ensureSystemData();

  const accounts = [
    ['admin@uka.test', 'Administración de prueba', 'ADMIN'],
    ['recepcion@uka.test', 'Recepción de prueba', 'RECEPTION'],
    ['consulta@uka.test', 'Consulta de prueba', 'QUERY'],
  ] as const;
  for (const [email, displayName, code] of accounts) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.user.upsert({
      where: { email },
      update: { displayName, roleId: role.id },
      create: { email, displayName, roleId: role.id },
    });
  }

  const samples = [
    {
      series: { name: 'Gala de ejemplo', type: 'Gala' },
      event: {
        slug: 'evento-ejemplo-gala',
        name: 'Gala de ejemplo 2027',
        editionYear: 2027,
        status: 'active',
        startsAt: new Date('2027-03-20T00:30:00.000Z'),
        venue: 'Sede de ejemplo',
        capacity: 400,
        folioPrefix: 'GAL',
        paymentInstructions:
          'Transferencia a la cuenta de ejemplo. Envía tu comprobante a eventos@unkilodeayuda.org.mx con tu folio.',
      },
      tickets: [
        { name: 'Boleto individual', price: 5500, seatsIncluded: 1 },
        { name: 'Mesa de 10', price: 50000, seatsIncluded: 10 },
      ],
    },
    {
      series: { name: 'Carrera de ejemplo', type: 'Carrera' },
      event: {
        slug: 'evento-ejemplo-carrera',
        name: 'Carrera de ejemplo 2027',
        editionYear: 2027,
        status: 'draft',
        startsAt: new Date('2027-05-16T13:00:00.000Z'),
        venue: 'Parque de ejemplo',
        capacity: 1500,
        folioPrefix: 'CAR',
      },
      tickets: [{ name: 'Inscripción', price: 0, seatsIncluded: 1 }],
    },
  ];
  for (const { series: seriesSeed, event, tickets } of samples) {
    const series = await prisma.eventSeries.upsert({
      where: { name: seriesSeed.name },
      update: seriesSeed,
      create: seriesSeed,
    });
    const data = {
      ...event,
      seriesId: series.id,
      modules: defaultModulesForType(seriesSeed.type),
    };
    const saved = await prisma.event.upsert({
      where: { slug: event.slug },
      update: data,
      create: data,
    });
    for (const ticket of tickets) {
      await prisma.ticketType.upsert({
        where: { eventId_name: { eventId: saved.id, name: ticket.name } },
        update: ticket,
        create: { ...ticket, eventId: saved.id },
      });
    }
  }

  console.info('Seed complete: 3 test accounts and 2 sample events.');
}

try {
  await seed();
} catch (error) {
  console.error('Seed failed.', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

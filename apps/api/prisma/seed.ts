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

  const events = [
    {
      slug: 'evento-ejemplo-gala',
      name: 'Gala de ejemplo',
      status: 'active',
      startsAt: new Date('2027-03-20T00:30:00.000Z'),
      venue: 'Sede de ejemplo',
      capacity: 400,
      folioPrefix: 'GAL',
      registrationMode: 'individual_and_corporate',
    },
    {
      slug: 'evento-ejemplo-carrera',
      name: 'Carrera de ejemplo',
      status: 'draft',
      startsAt: new Date('2027-05-16T13:00:00.000Z'),
      venue: 'Parque de ejemplo',
      capacity: 1500,
      folioPrefix: 'CAR',
      registrationMode: 'individual',
    },
  ];
  for (const event of events) {
    await prisma.event.upsert({
      where: { slug: event.slug },
      update: event,
      create: event,
    });
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

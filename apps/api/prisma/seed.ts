import { z } from 'zod';
import { argon2id, hash } from 'argon2';
import '../src/config.js';
import { prisma } from '../src/database.js';

const credentialsSchema = z.object({
  SEED_ADMIN_PASSWORD: z.string().min(12),
  SEED_RECEPTION_PASSWORD: z.string().min(12),
  SEED_QUERY_PASSWORD: z.string().min(12),
});

const guestSeeds = [
  {
    groupId: 'seed-group-soriana',
    company: 'SORIANA',
    guests: [
      ['Mariana', 'López', 'mariana@soriana.ejemplo'],
      ['Andrés', 'Vega', 'andres@soriana.ejemplo'],
      ['Lucía', 'Reyes', 'lucia@soriana.ejemplo'],
    ],
  },
  {
    groupId: 'seed-group-demo',
    company: 'Grupo Ejemplo',
    guests: [
      ['Diego', 'Ruiz', 'diego@grupo.ejemplo'],
      ['Valeria', 'Cruz', 'valeria@grupo.ejemplo'],
      ['Emilio', 'Soto', 'emilio@grupo.ejemplo'],
      ['Sofía', 'León', 'sofia@grupo.ejemplo'],
      ['Pablo', 'Mora', 'pablo@grupo.ejemplo'],
      ['Elena', 'Díaz', 'elena@grupo.ejemplo'],
      ['Iván', 'Ríos', 'ivan@grupo.ejemplo'],
      ['Julia', 'Nava', 'julia@grupo.ejemplo'],
    ],
  },
] as const;

async function seed() {
  const credentials = credentialsSchema.parse(process.env);
  const gala = await prisma.event.upsert({
    where: { slug: 'gala-40' },
    update: {
      name: 'Gala Un Kilo de Ayuda · 40 años',
      status: 'draft',
      startsAt: new Date('2027-02-12T00:30:00.000Z'),
      timeZone: 'America/Mexico_City',
      venue: 'Jardín Santa Fe',
      capacity: 400,
      folioPrefix: 'GAL',
      feeAmount: 5500,
      currency: 'MXN',
      companionLimit: 1,
      registrationMode: 'individual_and_corporate',
    },
    create: {
      slug: 'gala-40',
      name: 'Gala Un Kilo de Ayuda · 40 años',
      status: 'draft',
      startsAt: new Date('2027-02-12T00:30:00.000Z'),
      timeZone: 'America/Mexico_City',
      venue: 'Jardín Santa Fe',
      capacity: 400,
      folioPrefix: 'GAL',
      feeAmount: 5500,
      currency: 'MXN',
      companionLimit: 1,
      registrationMode: 'individual_and_corporate',
    },
  });

  for (const [slug, name] of [
    ['evento-demo-2', 'Evento de demostración 2'],
    ['evento-demo-3', 'Evento de demostración 3'],
  ]) {
    await prisma.event.upsert({
      where: { slug },
      update: { name, status: 'draft' },
      create: { slug, name, status: 'draft' },
    });
  }

  for (let tableNumber = 1; tableNumber <= 40; tableNumber += 1) {
    await prisma.table.upsert({
      where: {
        eventId_name: {
          eventId: gala.id,
          name: `Mesa ${String(tableNumber).padStart(2, '0')}`,
        },
      },
      update: { capacity: 10 },
      create: {
        eventId: gala.id,
        name: `Mesa ${String(tableNumber).padStart(2, '0')}`,
        capacity: 10,
      },
    });
  }

  const groups = [
    {
      id: 'seed-group-soriana',
      company: 'SORIANA',
      contactName: 'Asistente de Dirección',
      contactEmail: 'asistente@soriana.ejemplo',
      maxSeats: 10,
    },
    {
      id: 'seed-group-demo',
      company: 'Grupo Ejemplo',
      contactName: 'Laura Méndez',
      contactEmail: 'laura@grupo.ejemplo',
      maxSeats: 8,
    },
    {
      id: 'seed-group-foundation',
      company: 'Fundación Ejemplo',
      contactName: 'Ana Robles',
      contactEmail: 'ana@fundacion.ejemplo',
      maxSeats: 5,
    },
  ];

  for (const group of groups) {
    await prisma.groupPurchase.upsert({
      where: { id: group.id },
      update: { ...group, eventId: gala.id, status: 'draft' },
      create: { ...group, eventId: gala.id, status: 'draft' },
    });
  }

  let folioSequence = 0;
  for (const group of guestSeeds) {
    for (const [
      seatIndex,
      [firstName, lastName, email],
    ] of group.guests.entries()) {
      const guestId = `seed-${group.groupId.slice('seed-group-'.length)}-${seatIndex + 1}`;
      await prisma.guest.upsert({
        where: { id: guestId },
        update: { firstName, lastName, email, organization: group.company },
        create: {
          id: guestId,
          firstName,
          lastName,
          email,
          organization: group.company,
        },
      });

      folioSequence += 1;
      const folio = `GAL27-${String(folioSequence).padStart(4, '0')}`;
      await prisma.registration.upsert({
        where: { eventId_folio: { eventId: gala.id, folio } },
        update: {
          guestId,
          groupPurchaseId: group.groupId,
          seatNumber: seatIndex + 1,
          status: 'active',
        },
        create: {
          eventId: gala.id,
          guestId,
          groupPurchaseId: group.groupId,
          seatNumber: seatIndex + 1,
          folio,
          status: 'active',
        },
      });
    }
  }

  await prisma.eventCounter.upsert({
    where: {
      eventId_counterType: {
        eventId: gala.id,
        counterType: 'registration',
      },
    },
    update: {},
    create: {
      eventId: gala.id,
      counterType: 'registration',
      currentValue: folioSequence,
    },
  });
  await prisma.eventCounter.upsert({
    where: {
      eventId_counterType: {
        eventId: gala.id,
        counterType: 'raffle',
      },
    },
    update: {},
    create: { eventId: gala.id, counterType: 'raffle', currentValue: 0 },
  });

  const roles = [
    {
      code: 'ADMIN',
      name: 'Administrador',
      email: 'admin@uka.test',
      displayName: 'Administración de prueba',
      password: credentials.SEED_ADMIN_PASSWORD,
    },
    {
      code: 'RECEPTION',
      name: 'Recepción',
      email: 'recepcion@uka.test',
      displayName: 'Recepción de prueba',
      password: credentials.SEED_RECEPTION_PASSWORD,
    },
    {
      code: 'QUERY',
      name: 'Consulta',
      email: 'consulta@uka.test',
      displayName: 'Consulta de prueba',
      password: credentials.SEED_QUERY_PASSWORD,
    },
  ];

  for (const roleSeed of roles) {
    const passwordHash = await hash(roleSeed.password, { type: argon2id });
    const role = await prisma.role.upsert({
      where: { code: roleSeed.code },
      update: { name: roleSeed.name },
      create: { code: roleSeed.code, name: roleSeed.name },
    });
    const user = await prisma.user.upsert({
      where: { email: roleSeed.email },
      update: {
        displayName: roleSeed.displayName,
        passwordHash,
        status: 'active',
      },
      create: {
        email: roleSeed.email,
        displayName: roleSeed.displayName,
        passwordHash,
        status: 'active',
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  console.info(
    'Seed complete: 3 draft events, 40 tables, 3 group purchases, 11 registrations, and 3 role accounts.',
  );
}

try {
  await seed();
} catch (error) {
  console.error('Seed failed.', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

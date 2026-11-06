import { ADMIN_ROLE_CODE, type PermissionCode } from '@uka/shared';
import { config } from './config.js';
import { prisma } from './database.js';

const systemRoles: {
  code: string;
  name: string;
  description: string;
  permissions: PermissionCode[];
}[] = [
  {
    code: ADMIN_ROLE_CODE,
    name: 'Administrador',
    description: 'Acceso total. Este perfil no se puede modificar.',
    permissions: [],
  },
  {
    code: 'RECEPTION',
    name: 'Recepción',
    description: 'Operación del evento y acceso de asistentes.',
    permissions: ['events.view', 'checkin.operate'],
  },
  {
    code: 'QUERY',
    name: 'Consulta',
    description: 'Solo lectura de información.',
    permissions: ['events.view'],
  },
  {
    code: 'DIRECTION',
    name: 'Dirección',
    description:
      'Ve resultados, finanzas y bitácora. No captura ni mueve dinero.',
    permissions: [
      'events.view',
      'registrations.view',
      'seating.view',
      'donations.view',
      'reports.view',
      'finance.view',
      'audit.view',
    ],
  },
  {
    code: 'EVENT_COORDINATION',
    name: 'Coordinación de eventos',
    description:
      'Crea y opera eventos, registros, mesas y recepción. No toca pagos.',
    permissions: [
      'events.view',
      'events.create',
      'events.edit',
      'registrations.view',
      'registrations.manage',
      'seating.view',
      'seating.manage',
      'checkin.operate',
      'checkin.manage',
      'reports.view',
    ],
  },
  {
    code: 'RECEPTION_LEAD',
    name: 'Supervisión de recepción',
    description:
      'Opera la puerta, resuelve incidencias y da altas autorizadas.',
    permissions: [
      'events.view',
      'registrations.view',
      'checkin.operate',
      'checkin.manage',
    ],
  },
  {
    code: 'COLLECTIONS',
    name: 'Cobranza',
    description:
      'Registra pagos y da seguimiento a saldos. No autoriza reembolsos.',
    permissions: [
      'events.view',
      'registrations.view',
      'registrations.manage',
      'payments.manage',
      'finance.view',
    ],
  },
  {
    code: 'FINANCE',
    name: 'Finanzas',
    description:
      'Autoriza reembolsos, lleva presupuesto, facturas y políticas. No captura cobros.',
    permissions: [
      'events.view',
      'registrations.view',
      'finance.view',
      'finance.manage',
      'refunds.manage',
      'donations.view',
      'donations.manage',
      'reports.view',
      'reports.export',
    ],
  },
  {
    code: 'FUNDRAISING',
    name: 'Procuración de fondos',
    description: 'Atiende contactos, empresas, donativos y campañas.',
    permissions: [
      'events.view',
      'contacts.view',
      'contacts.manage',
      'communications.view',
      'communications.manage',
      'communications.send',
      'donations.view',
      'donations.manage',
      'reports.view',
    ],
  },
  {
    code: 'COMMUNICATIONS',
    name: 'Comunicación',
    description: 'Prepara y envía campañas a los contactos que lo autorizaron.',
    permissions: [
      'events.view',
      'contacts.view',
      'communications.view',
      'communications.manage',
      'communications.send',
    ],
  },
  {
    code: 'AUDIT',
    name: 'Auditoría y privacidad',
    description: 'Solo lectura: bitácora, consentimientos, finanzas y accesos.',
    permissions: [
      'events.view',
      'registrations.view',
      'finance.view',
      'reports.view',
      'audit.view',
      'consents.view',
      'users.view',
      'roles.view',
    ],
  },
];

/**
 * Crea los perfiles del sistema y el primer administrador. Es seguro repetirlo
 * en cada arranque: nunca sobrescribe los permisos que ya se hayan ajustado.
 */
export async function ensureSystemData(
  adminEmail = config.BOOTSTRAP_ADMIN_EMAIL,
): Promise<void> {
  for (const seed of systemRoles) {
    // También por nombre: alguien pudo crear ya un perfil propio que se llame igual.
    const existing = await prisma.role.findFirst({
      where: { OR: [{ code: seed.code }, { name: seed.name }] },
    });
    if (existing) {
      continue;
    }
    await prisma.role.create({
      data: {
        code: seed.code,
        name: seed.name,
        description: seed.description,
        isSystem: true,
        permissions: {
          create: seed.permissions.map((permission) => ({ permission })),
        },
      },
    });
  }

  if (!adminEmail) {
    return;
  }
  const admin = await prisma.role.findUniqueOrThrow({
    where: { code: ADMIN_ROLE_CODE },
  });
  const hasAdmin = await prisma.user.count({ where: { roleId: admin.id } });
  if (hasAdmin === 0) {
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { roleId: admin.id },
      create: {
        email: adminEmail,
        displayName: adminEmail,
        roleId: admin.id,
      },
    });
  }
}

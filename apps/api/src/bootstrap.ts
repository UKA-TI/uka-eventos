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
];

/**
 * Crea los perfiles del sistema y el primer administrador. Es seguro repetirlo
 * en cada arranque: nunca sobrescribe los permisos que ya se hayan ajustado.
 */
export async function ensureSystemData(
  adminEmail = config.BOOTSTRAP_ADMIN_EMAIL,
): Promise<void> {
  for (const seed of systemRoles) {
    const existing = await prisma.role.findUnique({
      where: { code: seed.code },
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

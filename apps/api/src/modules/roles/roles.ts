import { randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import { ADMIN_ROLE_CODE, roleInputSchema } from '@uka/shared';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import {
  currentUser,
  effectivePermissions,
  requireAuth,
  requireCsrf,
  requirePermission,
} from '../auth/auth.js';

const roleInclude = {
  permissions: true,
  _count: { select: { users: true } },
} as const;

function roleView(role: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: string }[];
  _count: { users: number };
}) {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isLocked: role.code === ADMIN_ROLE_CODE,
    permissions: effectivePermissions(role),
    userCount: role._count.users,
  };
}

/** Nadie puede otorgar un permiso que no tiene. */
function assertCanGrant(
  request: Request,
  requested: string[],
  current: string[] = [],
) {
  const actor = currentUser(request);
  const added = requested.filter((code) => !current.includes(code));
  const forbidden = added.filter(
    (code) => !actor.permissions.some((owned) => owned === code),
  );
  if (forbidden.length > 0) {
    throw new AppError(
      403,
      'No puedes otorgar permisos que tu propio perfil no tiene.',
    );
  }
}

export const rolesRouter = Router();

rolesRouter.use(requireAuth);

rolesRouter.get(
  '/',
  requirePermission('roles.view', 'roles.manage', 'users.view', 'users.manage'),
  asyncHandler(async (_request, response) => {
    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: roleInclude,
    });
    response.json(roles.map(roleView));
  }),
);

rolesRouter.post(
  '/',
  requirePermission('roles.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = roleInputSchema.parse(request.body);
    assertCanGrant(request, input.permissions);
    const role = await prisma.role.create({
      data: {
        code: `CUSTOM_${randomBytes(6).toString('hex').toUpperCase()}`,
        name: input.name,
        description: input.description,
        permissions: {
          create: [...new Set(input.permissions)].map((permission) => ({
            permission,
          })),
        },
      },
      include: roleInclude,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'role.create',
      entityType: 'role',
      entityId: role.id,
      details: { name: role.name, permissions: input.permissions },
    });
    response.status(201).json(roleView(role));
  }),
);

rolesRouter.put(
  '/:id',
  requirePermission('roles.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = roleInputSchema.parse(request.body);
    const existing = await prisma.role.findUnique({
      where: { id: request.params.id },
      include: roleInclude,
    });
    if (!existing) {
      throw new AppError(404, 'El perfil no existe.');
    }
    if (existing.code === ADMIN_ROLE_CODE) {
      throw new AppError(409, 'El perfil Administrador no se puede modificar.');
    }
    const previous = effectivePermissions(existing);
    assertCanGrant(request, input.permissions, previous);

    const role = await prisma.$transaction(async (transaction) => {
      await transaction.rolePermission.deleteMany({
        where: { roleId: existing.id },
      });
      return transaction.role.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          description: input.description,
          permissions: {
            create: [...new Set(input.permissions)].map((permission) => ({
              permission,
            })),
          },
        },
        include: roleInclude,
      });
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'role.update',
      entityType: 'role',
      entityId: role.id,
      details: { name: role.name, previous, permissions: input.permissions },
    });
    response.json(roleView(role));
  }),
);

rolesRouter.delete(
  '/:id',
  requirePermission('roles.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const existing = await prisma.role.findUnique({
      where: { id: request.params.id },
      include: roleInclude,
    });
    if (!existing) {
      throw new AppError(404, 'El perfil no existe.');
    }
    if (existing.isSystem) {
      throw new AppError(409, 'Los perfiles del sistema no se pueden borrar.');
    }
    if (existing._count.users > 0) {
      throw new AppError(
        409,
        'Este perfil tiene usuarios asignados. Cámbialos de perfil antes de borrarlo.',
      );
    }
    await prisma.role.delete({ where: { id: existing.id } });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'role.delete',
      entityType: 'role',
      entityId: existing.id,
      details: { name: existing.name },
    });
    response.status(204).end();
  }),
);

import { Router, type Request } from 'express';
import {
  ADMIN_ROLE_CODE,
  userInviteSchema,
  userUpdateSchema,
} from '@uka/shared';
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

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  lastLoginAt: true,
  role: { select: { id: true, name: true } },
} as const;

/** Evita que alguien asigne un perfil con más alcance que el suyo. */
async function loadAssignableRole(request: Request, roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: true },
  });
  if (!role) {
    throw new AppError(400, 'El perfil seleccionado no existe.');
  }
  const actor = currentUser(request);
  const exceeds = effectivePermissions(role).some(
    (code) => !actor.permissions.includes(code),
  );
  if (exceeds || (role.code === ADMIN_ROLE_CODE && !actor.isAdmin)) {
    throw new AppError(
      403,
      'No puedes asignar un perfil con más permisos que el tuyo.',
    );
  }
  return role;
}

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get(
  '/',
  requirePermission('users.view', 'users.manage'),
  asyncHandler(async (_request, response) => {
    const users = await prisma.user.findMany({
      orderBy: { displayName: 'asc' },
      select: userSelect,
    });
    response.json(users);
  }),
);

usersRouter.post(
  '/',
  requirePermission('users.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = userInviteSchema.parse(request.body);
    await loadAssignableRole(request, input.roleId);
    const user = await prisma.user.create({
      data: { ...input, status: 'invited' },
      select: userSelect,
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'user.invite',
      entityType: 'user',
      entityId: user.id,
      details: { email: user.email, role: user.role.name },
    });
    response.status(201).json(user);
  }),
);

usersRouter.put(
  '/:id',
  requirePermission('users.manage'),
  requireCsrf,
  asyncHandler(async (request, response) => {
    const input = userUpdateSchema.parse(request.body);
    const actor = currentUser(request);
    const existing = await prisma.user.findUnique({
      where: { id: request.params.id },
      include: { role: true },
    });
    if (!existing) {
      throw new AppError(404, 'El usuario no existe.');
    }

    const changesAccess =
      existing.roleId !== input.roleId ||
      input.enabled !== (existing.status !== 'inactive');

    if (existing.id === actor.id && changesAccess) {
      throw new AppError(
        409,
        'No puedes cambiar tu propio perfil ni desactivarte. Pídeselo a otro administrador.',
      );
    }
    if (existing.role.code === ADMIN_ROLE_CODE && !actor.isAdmin) {
      throw new AppError(403, 'Solo un administrador puede editar a otro.');
    }
    if (existing.roleId !== input.roleId) {
      await loadAssignableRole(request, input.roleId);
    }

    const status = !input.enabled
      ? 'inactive'
      : existing.entraOid || existing.lastLoginAt
        ? 'active'
        : 'invited';

    const user = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: existing.id },
        data: {
          displayName: input.displayName,
          roleId: input.roleId,
          status,
        },
        select: userSelect,
      });
      if (status === 'inactive') {
        await transaction.authSession.deleteMany({
          where: { userId: existing.id },
        });
      }
      return updated;
    });

    await recordAudit({
      userId: actor.id,
      action: 'user.update',
      entityType: 'user',
      entityId: user.id,
      details: {
        previousRole: existing.role.name,
        role: user.role.name,
        previousStatus: existing.status,
        status,
      },
    });
    response.json(user);
  }),
);

import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Catálogo de permisos. La matriz visual de perfiles se dibuja a partir de esta
 * lista y la API valida contra ella: un módulo nuevo solo tiene que agregarse aquí.
 */
export const permissionCatalog = [
  {
    key: 'events',
    label: 'Eventos',
    actions: [
      { code: 'events.view', label: 'Ver' },
      { code: 'events.create', label: 'Crear' },
      { code: 'events.edit', label: 'Editar' },
    ],
  },
  {
    key: 'users',
    label: 'Usuarios',
    actions: [
      { code: 'users.view', label: 'Ver' },
      { code: 'users.manage', label: 'Invitar y administrar' },
    ],
  },
  {
    key: 'roles',
    label: 'Perfiles y permisos',
    actions: [
      { code: 'roles.view', label: 'Ver' },
      { code: 'roles.manage', label: 'Crear y editar' },
    ],
  },
] as const;

export type PermissionCode =
  (typeof permissionCatalog)[number]['actions'][number]['code'];

export const allPermissions: PermissionCode[] = permissionCatalog.flatMap(
  (module) => module.actions.map((action) => action.code),
);

export const ADMIN_ROLE_CODE = 'ADMIN';

const knownPermissions = new Set<string>(allPermissions);

export function isPermissionCode(value: string): value is PermissionCode {
  return knownPermissions.has(value);
}

const permissionCodeSchema = z.custom<PermissionCode>(
  (value) => typeof value === 'string' && isPermissionCode(value),
  'Permiso desconocido',
);

export const roleInputSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre del perfil.').max(80),
  description: z.string().trim().max(255).nullable(),
  permissions: z.array(permissionCodeSchema),
});

export type RoleInput = z.infer<typeof roleInputSchema>;

export const roleResponseSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  isLocked: z.boolean(),
  permissions: z.array(permissionCodeSchema),
  userCount: z.number().int().nonnegative(),
});

export type RoleRecord = z.infer<typeof roleResponseSchema>;

export const userStatusSchema = z.enum(['invited', 'active', 'inactive']);

export const userInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Escribe un correo válido.')
    .max(254),
  displayName: z.string().trim().min(1, 'Escribe el nombre.').max(180),
  roleId: z.string().min(1, 'Selecciona un perfil.').max(30),
});

export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(180),
  roleId: z.string().min(1).max(30),
  enabled: z.boolean(),
});

export type UserInvite = z.infer<typeof userInviteSchema>;
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  status: userStatusSchema,
  role: z.object({ id: z.string(), name: z.string() }),
  lastLoginAt: z.string().nullable(),
});

export type UserRecord = z.infer<typeof userResponseSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  roleName: z.string(),
  permissions: z.array(permissionCodeSchema),
});

export type AuthUser = z.infer<typeof authUserSchema>;

export const authSessionResponseSchema = z.object({
  user: authUserSchema.nullable(),
  csrfToken: z.string().nullable(),
});

export const authConfigResponseSchema = z.object({
  microsoft: z
    .object({ clientId: z.string(), tenantId: z.string() })
    .nullable(),
  devLoginEnabled: z.boolean(),
});

export const microsoftLoginSchema = z.object({
  idToken: z.string().min(1).max(20000),
});

export const devLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export const eventStatusSchema = z.enum(['draft', 'active', 'closed']);

export const eventInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, 'Escribe la dirección pública.')
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usa minúsculas, números y guiones'),
  name: z.string().trim().min(1, 'Escribe el nombre del evento.').max(180),
  description: z.string().trim().max(5000).nullable(),
  status: eventStatusSchema,
  startsAt: z.string().datetime({ offset: true }).nullable(),
  endsAt: z.string().datetime({ offset: true }).nullable(),
  timeZone: z.string().trim().min(1).max(64),
  venue: z.string().trim().max(180).nullable(),
  capacity: z
    .number('Escribe un número.')
    .int('Debe ser un número entero.')
    .positive('Debe ser mayor a cero.')
    .nullable(),
  folioPrefix: z
    .string()
    .regex(/^[A-Z0-9]{3}$/, 'Deben ser 3 letras o números')
    .nullable(),
  feeAmount: z
    .number('Escribe un número.')
    .nonnegative('No puede ser negativa.')
    .nullable(),
  currency: z.string().length(3).toUpperCase(),
  companionLimit: z
    .number('Escribe un número.')
    .int('Debe ser un número entero.')
    .nonnegative('No puede ser negativo.'),
  registrationMode: z.enum([
    'individual',
    'individual_and_corporate',
    'corporate',
  ]),
});

export type EventInput = z.infer<typeof eventInputSchema>;

export const eventResponseSchema = eventInputSchema.extend({
  id: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type EventRecord = z.infer<typeof eventResponseSchema>;

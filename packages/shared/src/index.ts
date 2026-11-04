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
      { code: 'events.edit', label: 'Editar y configurar' },
      { code: 'events.delete', label: 'Eliminar borradores' },
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

/**
 * Módulos que cada evento activa según lo que necesite. Las fases siguientes
 * muestran u ocultan sus pantallas con base en esta lista.
 */
export const eventModuleCatalog = [
  {
    key: 'publicRegistration',
    label: 'Registro público',
    description: 'Cualquier persona se registra con la liga del evento.',
  },
  {
    key: 'corporate',
    label: 'Compras corporativas',
    description:
      'Una empresa compra lugares y captura a sus invitados con una liga privada.',
  },
  {
    key: 'tables',
    label: 'Mesas',
    description: 'Asigna a los asistentes a mesas con cupo.',
  },
  {
    key: 'companions',
    label: 'Acompañantes',
    description: 'Cada asistente puede registrar acompañantes.',
  },
  {
    key: 'raffle',
    label: 'Rifa',
    description: 'Entrega un folio de rifa al ingresar al evento.',
  },
  {
    key: 'donations',
    label: 'Donativos',
    description: 'Registra los donativos recibidos en el evento.',
  },
  {
    key: 'checkin',
    label: 'Check-in con QR',
    description: 'Recepción escanea los pases desde la app instalada.',
  },
] as const;

export type EventModuleKey = (typeof eventModuleCatalog)[number]['key'];

const eventModuleKeys = new Set<string>(
  eventModuleCatalog.map((module) => module.key),
);

export function isEventModuleKey(value: unknown): value is EventModuleKey {
  return typeof value === 'string' && eventModuleKeys.has(value);
}

const eventModuleSchema = z.custom<EventModuleKey>(
  isEventModuleKey,
  'Módulo desconocido',
);

export const suggestedEventTypes = ['Gala', 'Carrera', 'Colecta'] as const;

const moduleDefaults: Record<string, EventModuleKey[]> = {
  gala: ['publicRegistration', 'corporate', 'tables', 'raffle', 'checkin'],
  carrera: ['publicRegistration', 'checkin'],
  colecta: ['publicRegistration', 'donations'],
};

/** Punto de partida al crear un evento; después se puede ajustar. */
export function defaultModulesForType(type: string): EventModuleKey[] {
  return (
    moduleDefaults[type.trim().toLowerCase()] ?? [
      'publicRegistration',
      'checkin',
    ]
  );
}

const nullableDateTime = z.string().datetime({ offset: true }).nullable();

export const seriesInputSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre de la serie.').max(180),
  type: z.string().trim().min(2, 'Indica el tipo de evento.').max(60),
  description: z.string().trim().max(5000).nullable(),
});

export type SeriesInput = z.infer<typeof seriesInputSchema>;

export const seriesResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string().nullable(),
  editions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      editionYear: z.number(),
      status: z.string(),
    }),
  ),
});

export type SeriesRecord = z.infer<typeof seriesResponseSchema>;

export const eventStatusSchema = z.enum(['draft', 'active', 'closed']);

export const eventStatusInputSchema = z.object({ status: eventStatusSchema });

const slugSchema = z
  .string()
  .trim()
  .min(1, 'Escribe la dirección pública.')
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usa minúsculas, números y guiones.');

const editionYearSchema = z
  .number('Escribe el año.')
  .int('Escribe un año válido.')
  .min(2000, 'Escribe un año válido.')
  .max(2100, 'Escribe un año válido.');

export const eventInputSchema = z.object({
  seriesId: z.string().min(1, 'Selecciona una serie.').max(30),
  editionYear: editionYearSchema,
  slug: slugSchema,
  name: z.string().trim().min(1, 'Escribe el nombre del evento.').max(180),
  description: z.string().trim().max(5000).nullable(),
  startsAt: nullableDateTime,
  endsAt: nullableDateTime,
  timeZone: z.string().trim().min(1).max(64),
  venue: z.string().trim().max(180).nullable(),
  capacity: z
    .number('Escribe un número.')
    .int('Debe ser un número entero.')
    .positive('Debe ser mayor a cero.')
    .nullable(),
  folioPrefix: z
    .string()
    .regex(/^[A-Z0-9]{3}$/, 'Deben ser 3 letras o números.')
    .nullable(),
  currency: z.string().length(3).toUpperCase(),
  companionLimit: z
    .number('Escribe un número.')
    .int('Debe ser un número entero.')
    .nonnegative('No puede ser negativo.'),
  modules: z.array(eventModuleSchema),
});

export type EventInput = z.infer<typeof eventInputSchema>;

export const eventModulesInputSchema = z.object({
  modules: z.array(eventModuleSchema),
});

export const eventDuplicateSchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre del evento.').max(180),
  slug: slugSchema,
  editionYear: editionYearSchema,
  startsAt: nullableDateTime,
  endsAt: nullableDateTime,
});

export type EventDuplicateInput = z.infer<typeof eventDuplicateSchema>;

export const eventResponseSchema = eventInputSchema.extend({
  id: z.string(),
  status: eventStatusSchema,
  series: z.object({ id: z.string(), name: z.string(), type: z.string() }),
  ticketTypeCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type EventRecord = z.infer<typeof eventResponseSchema>;

export const ticketTypeInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Escribe el nombre del boleto.').max(120),
    description: z.string().trim().max(500).nullable(),
    price: z
      .number('Escribe un precio.')
      .nonnegative('No puede ser negativo.')
      .max(99_999_999, 'El precio es demasiado alto.'),
    capacity: z
      .number('Escribe un número.')
      .int('Debe ser un número entero.')
      .positive('Debe ser mayor a cero.')
      .nullable(),
    seatsIncluded: z
      .number('Escribe un número.')
      .int('Debe ser un número entero.')
      .min(1, 'Debe incluir al menos un lugar.')
      .max(1000, 'Son demasiados lugares.'),
    salesStart: nullableDateTime,
    salesEnd: nullableDateTime,
    active: z.boolean(),
  })
  .refine(
    ({ salesStart, salesEnd }) =>
      !salesStart || !salesEnd || new Date(salesEnd) > new Date(salesStart),
    {
      message: 'El fin de venta debe ser posterior al inicio.',
      path: ['salesEnd'],
    },
  );

export type TicketTypeInput = z.infer<typeof ticketTypeInputSchema>;

export const ticketTypeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number(),
  capacity: z.number().nullable(),
  seatsIncluded: z.number(),
  salesStart: z.string().nullable(),
  salesEnd: z.string().nullable(),
  active: z.boolean(),
  registrationCount: z.number().int().nonnegative(),
});

export type TicketTypeRecord = z.infer<typeof ticketTypeResponseSchema>;

export const formFieldTypes = [
  { key: 'text', label: 'Texto' },
  { key: 'number', label: 'Número' },
  { key: 'date', label: 'Fecha' },
  { key: 'select', label: 'Lista de opciones' },
  { key: 'checkbox', label: 'Casilla de sí o no' },
] as const;

const formFieldTypeSchema = z.enum([
  'text',
  'number',
  'date',
  'select',
  'checkbox',
]);

export const formFieldInputSchema = z
  .object({
    label: z.string().trim().min(1, 'Escribe la pregunta.').max(120),
    type: formFieldTypeSchema,
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(120)).max(100),
    helpText: z.string().trim().max(255).nullable(),
    active: z.boolean(),
  })
  .refine(({ type, options }) => type !== 'select' || options.length > 0, {
    message: 'Escribe al menos una opción.',
    path: ['options'],
  });

export type FormFieldInput = z.infer<typeof formFieldInputSchema>;

export const formFieldResponseSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: formFieldTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()),
  helpText: z.string().nullable(),
  active: z.boolean(),
});

export type FormFieldRecord = z.infer<typeof formFieldResponseSchema>;

export const formFieldOrderSchema = z.object({
  ids: z.array(z.string().min(1).max(30)).max(200),
});

export const eventDetailResponseSchema = eventResponseSchema.extend({
  ticketTypes: z.array(ticketTypeResponseSchema),
  formFields: z.array(formFieldResponseSchema),
  activationIssues: z.array(z.string()),
  registrationCount: z.number().int().nonnegative(),
});

export type EventDetail = z.infer<typeof eventDetailResponseSchema>;

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
    key: 'registrations',
    label: 'Registros y pagos',
    actions: [
      { code: 'registrations.view', label: 'Ver' },
      { code: 'registrations.manage', label: 'Crear, cancelar y reenviar' },
      { code: 'payments.manage', label: 'Registrar y anular pagos' },
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
  paymentInstructions: z.string().trim().max(5000).nullable(),
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

export const PRIVACY_NOTICE_URL =
  'https://www.unkilodeayuda.org.mx/aviso-de-privacidad/';
export const PRIVACY_NOTICE_VERSION = '2026-11';

const personFields = {
  firstName: z.string().trim().min(1, 'Escribe el nombre.').max(100),
  lastName: z.string().trim().min(1, 'Escribe los apellidos.').max(140),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Escribe un correo válido.')
    .max(254),
  phone: z
    .string()
    .trim()
    .min(7, 'Escribe un teléfono válido.')
    .max(32)
    .regex(/^[0-9+() .-]+$/, 'Escribe un teléfono válido.'),
};

const answersSchema = z.record(
  z.string().max(30),
  z.union([z.string().trim().max(1000), z.boolean()]),
);

export const orderInputSchema = z.object({
  ...personFields,
  organization: z.string().trim().max(180).nullable(),
  ticketTypeId: z.string().min(1, 'Selecciona un boleto.').max(30),
  answers: answersSchema,
});

export type OrderInput = z.infer<typeof orderInputSchema>;

export const publicRegistrationSchema = orderInputSchema.extend({
  privacyAccepted: z.literal(true, {
    error: 'Debes aceptar el aviso de privacidad.',
  }),
  // Campo oculto: una persona nunca lo llena, un robot sí.
  website: z.string().max(200).optional(),
});

export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>;

export const groupGuestInputSchema = z.object({
  ...personFields,
  organization: z.string().trim().max(180).nullable(),
  authorized: z.literal(true, {
    error: 'Confirma que el invitado autorizó compartir sus datos.',
  }),
});

export type GroupGuestInput = z.infer<typeof groupGuestInputSchema>;

export const paymentMethods = [
  { key: 'transfer', label: 'Transferencia' },
  { key: 'cash', label: 'Efectivo' },
  { key: 'card', label: 'Tarjeta' },
  { key: 'other', label: 'Otro' },
] as const;

export const paymentInputSchema = z.object({
  amount: z
    .number('Escribe el monto.')
    .positive('Debe ser mayor a cero.')
    .max(99_999_999, 'El monto es demasiado alto.'),
  method: z.enum(['transfer', 'cash', 'card', 'other']),
  reference: z.string().trim().max(120).nullable(),
  notes: z.string().trim().max(500).nullable(),
  paidAt: z.string().datetime({ offset: true }),
});

export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const orderStatusSchema = z.enum([
  'pending_payment',
  'confirmed',
  'cancelled',
]);

const emailStatusSchema = z.enum([
  'pending',
  'sending',
  'sent',
  'failed',
  'skipped',
]);

export const orderResponseSchema = z.object({
  id: z.string(),
  reference: z.string(),
  status: orderStatusSchema,
  source: z.string(),
  seats: z.number(),
  amountDue: z.number(),
  amountPaid: z.number(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  ticketName: z.string(),
  buyer: z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    organization: z.string().nullable(),
  }),
  answers: z.array(z.object({ label: z.string(), value: z.string() })),
  groupUrl: z.string().nullable(),
  registrations: z.array(
    z.object({
      id: z.string(),
      folio: z.string(),
      status: z.string(),
      guestName: z.string(),
      guestEmail: z.string().nullable(),
      passUrl: z.string().nullable(),
      emailStatus: emailStatusSchema.nullable(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      method: z.string(),
      reference: z.string().nullable(),
      notes: z.string().nullable(),
      paidAt: z.string(),
      recordedBy: z.string().nullable(),
      voidedAt: z.string().nullable(),
    }),
  ),
});

export type OrderRecord = z.infer<typeof orderResponseSchema>;

export const orderListResponseSchema = z.object({
  orders: z.array(orderResponseSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  summary: z.object({
    seatsTaken: z.number(),
    seatsConfirmed: z.number(),
    pendingOrders: z.number(),
    amountCollected: z.number(),
    amountPending: z.number(),
    emailsQueued: z.number(),
    emailsFailed: z.number(),
    mailConfigured: z.boolean(),
  }),
});

export const publicEventResponseSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  timeZone: z.string(),
  venue: z.string().nullable(),
  currency: z.string(),
  privacyUrl: z.string(),
  tickets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      price: z.number(),
      seatsIncluded: z.number(),
      soldOut: z.boolean(),
    }),
  ),
  fields: z.array(formFieldResponseSchema),
});

export type PublicEvent = z.infer<typeof publicEventResponseSchema>;

export const publicRegistrationResultSchema = z.object({
  reference: z.string(),
  status: orderStatusSchema,
  amountDue: z.number(),
  currency: z.string(),
  paymentInstructions: z.string().nullable(),
  seats: z.number(),
  passUrl: z.string().nullable(),
  groupUrl: z.string().nullable(),
});

export type PublicRegistrationResult = z.infer<
  typeof publicRegistrationResultSchema
>;

export const publicPassResponseSchema = z.object({
  status: z.enum(['active', 'revoked']),
  folio: z.string(),
  guestName: z.string(),
  eventName: z.string(),
  startsAt: z.string().nullable(),
  timeZone: z.string(),
  venue: z.string().nullable(),
  ticketName: z.string(),
  qrDataUrl: z.string().nullable(),
  privacyUrl: z.string(),
});

export type PublicPass = z.infer<typeof publicPassResponseSchema>;

export const publicGroupResponseSchema = z.object({
  reference: z.string(),
  eventName: z.string(),
  startsAt: z.string().nullable(),
  timeZone: z.string(),
  venue: z.string().nullable(),
  ticketName: z.string(),
  contactName: z.string(),
  seats: z.number(),
  privacyUrl: z.string(),
  guests: z.array(
    z.object({
      id: z.string(),
      folio: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      checkedIn: z.boolean(),
    }),
  ),
});

export type PublicGroup = z.infer<typeof publicGroupResponseSchema>;

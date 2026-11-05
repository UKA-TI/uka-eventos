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
    key: 'checkin',
    label: 'Recepción',
    actions: [
      { code: 'checkin.operate', label: 'Operar el check-in' },
      {
        code: 'checkin.manage',
        label: 'Puntos de acceso, incidencias y operadores',
      },
    ],
  },
  {
    key: 'contacts',
    label: 'Contactos y empresas',
    actions: [
      { code: 'contacts.view', label: 'Ver' },
      { code: 'contacts.manage', label: 'Crear, editar y segmentar' },
    ],
  },
  {
    key: 'communications',
    label: 'Comunicaciones',
    actions: [
      { code: 'communications.view', label: 'Ver' },
      { code: 'communications.manage', label: 'Redactar y usar plantillas' },
      { code: 'communications.send', label: 'Enviar a contactos' },
    ],
  },
  {
    key: 'donations',
    label: 'Donativos',
    actions: [
      { code: 'donations.view', label: 'Ver' },
      { code: 'donations.manage', label: 'Registrar y anular' },
    ],
  },
  {
    key: 'seating',
    label: 'Acomodo de mesas',
    actions: [
      { code: 'seating.view', label: 'Ver' },
      { code: 'seating.manage', label: 'Acomodar y publicar' },
    ],
  },
  {
    key: 'reports',
    label: 'Reportes',
    actions: [
      { code: 'reports.view', label: 'Ver tablero y comparativos' },
      { code: 'reports.export', label: 'Descargar archivos con datos' },
    ],
  },
  {
    key: 'finance',
    label: 'Finanzas',
    actions: [
      { code: 'finance.view', label: 'Ver finanzas y cobranza' },
      {
        code: 'finance.manage',
        label: 'Meta, presupuesto, políticas y facturas',
      },
      { code: 'refunds.manage', label: 'Registrar reembolsos' },
    ],
  },
  {
    key: 'compliance',
    label: 'Control y privacidad',
    actions: [
      { code: 'audit.view', label: 'Ver la bitácora' },
      { code: 'consents.view', label: 'Ver los consentimientos' },
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

export const eventStatusInputSchema = z.object({
  status: eventStatusSchema,
  // Quien cierra con pendientes explica por qué: queda en la bitácora.
  note: z.string().trim().max(500).nullish(),
});

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
  programStartsAt: nullableDateTime.optional(),
  mapUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\/\S+$/, 'Escribe una liga completa, con https://.')
    .nullish(),
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

/** Catálogos del SAT más comunes. El CRM guarda estos datos; la factura se emite aparte. */
export const fiscalRegimes = [
  { key: '601', label: '601 General de Ley Personas Morales' },
  { key: '603', label: '603 Personas Morales con Fines no Lucrativos' },
  { key: '605', label: '605 Sueldos y Salarios' },
  { key: '606', label: '606 Arrendamiento' },
  { key: '612', label: '612 Actividades Empresariales y Profesionales' },
  { key: '616', label: '616 Sin obligaciones fiscales' },
  { key: '626', label: '626 Régimen Simplificado de Confianza' },
] as const;

export const cfdiUses = [
  { key: 'G03', label: 'G03 Gastos en general' },
  { key: 'D04', label: 'D04 Donativos' },
  { key: 'S01', label: 'S01 Sin efectos fiscales' },
] as const;

export const fiscalDataSchema = z.object({
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'Escribe un RFC válido.'),
  legalName: z.string().trim().min(2, 'Escribe la razón social.').max(250),
  regime: z.enum(
    fiscalRegimes.map(({ key }) => key),
    'Elige el régimen.',
  ),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'El código postal lleva 5 dígitos.'),
  cfdiUse: z.enum(
    cfdiUses.map(({ key }) => key),
    'Elige el uso del CFDI.',
  ),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Escribe un correo válido.')
    .max(254),
});

export type FiscalData = z.infer<typeof fiscalDataSchema>;

export const orderInputSchema = z.object({
  ...personFields,
  fiscal: fiscalDataSchema.nullish(),
  organization: z.string().trim().max(180).nullable(),
  ticketTypeId: z.string().min(1, 'Selecciona un boleto.').max(30),
  answers: answersSchema,
});

export type OrderInput = z.infer<typeof orderInputSchema>;

export const publicRegistrationSchema = orderInputSchema.extend({
  privacyAccepted: z.literal(true, {
    error: 'Debes aceptar el aviso de privacidad.',
  }),
  // Opcional y sin marcar de inicio: es un permiso distinto al del evento.
  marketingConsent: z.boolean().optional(),
  // Campo oculto: una persona nunca lo llena, un robot sí.
  website: z.string().max(200).optional(),
});

export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>;

export const groupGuestInputSchema = z.object({
  firstName: personFields.firstName,
  lastName: personFields.lastName,
  email: personFields.email,
  phone: z.string().trim().max(32).nullable(),
  organization: z.string().trim().max(180).nullable(),
  seatNumber: z.number().int().min(1).optional(),
  // Solo aplica a quien captura sus propios datos: nadie acepta el aviso por un tercero.
  authorized: z.boolean(),
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

/** Quien compra una mesa suele delegar en su asistente el registro de los invitados. */
const delegateFields = {
  delegateName: z.string().trim().max(160).nullish(),
  delegateEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Escribe un correo válido.')
    .max(254)
    .nullish(),
  registrationDeadline: z.string().datetime({ offset: true }).nullish(),
};

export const orderDelegateSchema = z.object(delegateFields);

export type OrderDelegateInput = z.infer<typeof orderDelegateSchema>;

/** Compra hecha por otro medio: el pago ya se concilió y la persona se registra después. */
export const reconciledOrderSchema = z.object({
  firstName: personFields.firstName,
  lastName: personFields.lastName,
  email: personFields.email,
  phone: z.string().trim().max(32).nullable(),
  organization: z.string().trim().max(180).nullable(),
  ticketTypeId: z.string().min(1, 'Selecciona un boleto.').max(30),
  quantity: z
    .number('Escribe la cantidad.')
    .int('Escribe una cantidad entera.')
    .min(1, 'Debe ser al menos 1.')
    .max(500, 'La cantidad es demasiado alta.'),
  amount: z
    .number('Escribe el monto recibido.')
    .min(0, 'No puede ser negativo.')
    .max(99_999_999, 'El monto es demasiado alto.'),
  method: z.enum(['transfer', 'cash', 'card', 'other']),
  reference: z.string().trim().max(120).nullable(),
  notes: z.string().trim().max(500).nullable(),
  paidAt: z.string().datetime({ offset: true }),
  ...delegateFields,
});

export type ReconciledOrderInput = z.infer<typeof reconciledOrderSchema>;

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
  quantity: z.number(),
  delegateName: z.string().nullable(),
  delegateEmail: z.string().nullable(),
  registrationDeadline: z.string().nullable(),
  notes: z.string().nullable(),
  amountDue: z.number(),
  amountPaid: z.number(),
  amountRefunded: z.number(),
  balance: z.number(),
  financialStatus: z.string(),
  dueAt: z.string().nullable(),
  lastReminderAt: z.string().nullable(),
  fiscal: fiscalDataSchema.nullable(),
  invoiceStatus: z.string(),
  invoiceFolio: z.string().nullable(),
  cancellationReason: z.string().nullable(),
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
  refunds: z.array(
    z.object({
      id: z.string(),
      amount: z.number(),
      method: z.string(),
      reference: z.string().nullable(),
      reason: z.string(),
      refundedAt: z.string(),
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
    seatsToRegister: z.number(),
    pendingOrders: z.number(),
    amountCollected: z.number(),
    amountRefunded: z.number(),
    amountPending: z.number(),
    amountOverdue: z.number(),
    emailsQueued: z.number(),
    emailsFailed: z.number(),
    mailProblem: z.string().nullable(),
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
  programStartsAt: z.string().nullable(),
  mapUrl: z.string().nullable(),
  currency: z.string(),
  privacyUrl: z.string(),
  cancellationPolicy: z.string().nullable(),
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

export const passActivationSchema = z.object({
  privacyAccepted: z.literal(true, {
    error: 'Acepta el aviso de privacidad para activar tu pase.',
  }),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[0-9+() .-]*$/, 'Escribe un teléfono válido.')
    .nullable(),
  marketingConsent: z.boolean().optional(),
});

export const recoverPassSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Escribe un correo válido.')
    .max(254),
});

export const publicPassResponseSchema = z.object({
  status: z.enum(['active', 'revoked', 'pending_activation']),
  tableName: z.string().nullable(),
  folio: z.string(),
  guestName: z.string(),
  eventName: z.string(),
  startsAt: z.string().nullable(),
  timeZone: z.string(),
  venue: z.string().nullable(),
  ticketName: z.string(),
  qrDataUrl: z.string().nullable(),
  programStartsAt: z.string().nullable(),
  mapUrl: z.string().nullable(),
  eventSlug: z.string(),
  calendar: z.object({ google: z.string(), outlook: z.string() }).nullable(),
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
  delegateName: z.string().nullable(),
  registrationDeadline: z.string().nullable(),
  source: z.string(),
  buyer: z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    organization: z.string().nullable(),
  }),
  seats: z.number(),
  privacyUrl: z.string(),
  guests: z.array(
    z.object({
      id: z.string(),
      folio: z.string(),
      seatNumber: z.number().nullable(),
      name: z.string(),
      email: z.string().nullable(),
      checkedIn: z.boolean(),
      pendingActivation: z.boolean(),
    }),
  ),
});

export type PublicGroup = z.infer<typeof publicGroupResponseSchema>;

export const accessPointInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Escribe el nombre del punto de acceso.')
    .max(100),
  active: z.boolean(),
});

export const checkinItemSchema = z.object({
  clientId: z.string().min(8).max(40),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  accessPointId: z.string().min(1).max(30),
  scannedAt: z.string().datetime({ offset: true }),
  manualReason: z.string().trim().max(255).nullable(),
});

export type CheckinItem = z.infer<typeof checkinItemSchema>;

export const checkinBatchSchema = z.object({
  items: z.array(checkinItemSchema).min(1).max(200),
});

const checkinGuestFields = {
  guestName: z.string(),
  folio: z.string(),
  ticketName: z.string(),
  tableName: z.string().nullable().optional(),
};

export const checkinResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    ...checkinGuestFields,
    checkedInAt: z.string(),
    raffleFolio: z.string().nullable(),
  }),
  z.object({
    status: z.literal('duplicate'),
    ...checkinGuestFields,
    checkedInAt: z.string(),
    accessPointName: z.string(),
    operatorName: z.string().nullable(),
  }),
  z.object({ status: z.literal('revoked'), ...checkinGuestFields }),
  z.object({ status: z.literal('pending_activation'), ...checkinGuestFields }),
  z.object({ status: z.literal('unknown') }),
]);

export type CheckinResult = z.infer<typeof checkinResultSchema>;

export const checkinSyncResponseSchema = z.object({
  results: z.array(
    z.object({ clientId: z.string(), result: checkinResultSchema }),
  ),
});

export const offlineListSchema = z.object({
  generatedAt: z.string(),
  entries: z.array(
    z.object({
      tokenHash: z.string(),
      ...checkinGuestFields,
      checkedInAt: z.string().nullable(),
      pendingActivation: z.boolean().optional(),
    }),
  ),
});

export type OfflineList = z.infer<typeof offlineListSchema>;

export const checkinEventsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    startsAt: z.string().nullable(),
    timeZone: z.string(),
    venue: z.string().nullable(),
    accessPoints: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
);

export type CheckinEvent = z.infer<typeof checkinEventsSchema>[number];

export const checkinOverviewSchema = z.object({
  expected: z.number(),
  checkedIn: z.number(),
  openIncidents: z.number(),
  accessPoints: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      active: z.boolean(),
      checkins: z.number(),
    }),
  ),
  recent: z.array(
    z.object({
      id: z.string(),
      ...checkinGuestFields,
      checkedInAt: z.string(),
      accessPointName: z.string(),
      operatorName: z.string().nullable(),
      source: z.string(),
      manualReason: z.string().nullable(),
      raffleFolio: z.string().nullable(),
    }),
  ),
});

export const incidentInputSchema = z.object({
  accessPointId: z.string().min(1).max(30),
  description: z.string().trim().min(3, 'Describe lo ocurrido.').max(500),
});

export const incidentResolveSchema = z.object({
  resolution: z.string().trim().min(3, 'Escribe cómo se resolvió.').max(500),
});

export const incidentListSchema = z.array(
  z.object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    description: z.string(),
    occurredAt: z.string(),
    accessPointName: z.string().nullable(),
    operatorName: z.string().nullable(),
    resolution: z.string().nullable(),
    resolvedBy: z.string().nullable(),
    resolvedAt: z.string().nullable(),
  }),
);

export type IncidentRecord = z.infer<typeof incidentListSchema>[number];

// ---------------------------------------------------------------------------
// CRM: contactos, empresas, segmentos, comunicaciones y donativos
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const contactInputSchema = z.object({
  firstName: z.string().trim().min(1, 'Escribe el nombre.').max(100),
  lastName: z.string().trim().min(1, 'Escribe los apellidos.').max(140),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Escribe un correo válido.')
    .max(254)
    .nullable(),
  phone: optionalText(32),
  position: optionalText(120),
  companyId: z.string().max(30).nullable(),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

export const contactNoteInputSchema = z.object({
  body: z.string().trim().min(1, 'Escribe la nota.').max(5000),
});

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre.').max(180),
  website: optionalText(255),
  notes: optionalText(5000),
});

export type CompanyInput = z.infer<typeof companyInputSchema>;

export const participationOptions = [
  { key: 'any', label: 'Sin importar' },
  { key: 'registered', label: 'Se registró' },
  { key: 'attended', label: 'Asistió' },
  { key: 'not_attended', label: 'Se registró y no asistió' },
] as const;

export const segmentFiltersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  companyId: z.string().max(30).optional(),
  eventType: z.string().trim().max(60).optional(),
  seriesId: z.string().max(30).optional(),
  eventId: z.string().max(30).optional(),
  editionYear: z.number().int().min(2000).max(2100).optional(),
  participation: z
    .enum(['any', 'registered', 'attended', 'not_attended'])
    .optional(),
  donor: z.boolean().optional(),
  reachable: z.boolean().optional(),
});

export type SegmentFilters = z.infer<typeof segmentFiltersSchema>;

export const segmentInputSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre del segmento.').max(120),
  description: optionalText(255),
  filters: segmentFiltersSchema,
});

export const segmentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  filters: segmentFiltersSchema,
  contacts: z.number(),
  reachable: z.number(),
  createdAt: z.string(),
});

export type SegmentRecord = z.infer<typeof segmentResponseSchema>;

export const contactSummarySchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  position: z.string().nullable(),
  company: z.object({ id: z.string(), name: z.string() }).nullable(),
  source: z.string(),
  optedOutAt: z.string().nullable(),
  optOutSource: z.string().nullable(),
  marketingConsentAt: z.string().nullable(),
  marketingConsentSource: z.string().nullable(),
  participations: z.number(),
  createdAt: z.string(),
});

export type ContactSummary = z.infer<typeof contactSummarySchema>;

export const contactListResponseSchema = z.object({
  contacts: z.array(contactSummarySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  reachable: z.number(),
});

export const donationMethodOptions = [
  { key: 'transfer', label: 'Transferencia' },
  { key: 'cash', label: 'Efectivo' },
  { key: 'card', label: 'Tarjeta' },
  { key: 'in_kind', label: 'En especie' },
  { key: 'other', label: 'Otro' },
] as const;

export const donationInputSchema = z.object({
  contactId: z.string().max(30).nullable(),
  companyId: z.string().max(30).nullable(),
  eventId: z.string().max(30).nullable(),
  amount: z
    .number('Escribe el monto.')
    .positive('Debe ser mayor a cero.')
    .max(9_999_999_999, 'El monto es demasiado alto.'),
  method: z.enum(['transfer', 'cash', 'card', 'in_kind', 'other']),
  reference: optionalText(120),
  notes: optionalText(500),
  receivedAt: z.string().datetime({ offset: true }),
});

export type DonationInput = z.infer<typeof donationInputSchema>;

export const donationVoidSchema = z.object({
  reason: z.string().trim().min(3, 'Escribe el motivo.').max(255),
});

export const donationResponseSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string(),
  method: z.string(),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  receivedAt: z.string(),
  contact: z.object({ id: z.string(), name: z.string() }).nullable(),
  company: z.object({ id: z.string(), name: z.string() }).nullable(),
  event: z.object({ id: z.string(), name: z.string() }).nullable(),
  recordedBy: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
});

export type DonationRecord = z.infer<typeof donationResponseSchema>;

export const donationListResponseSchema = z.object({
  donations: z.array(donationResponseSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalAmount: z.number(),
  count: z.number(),
});

export const contactDetailResponseSchema = contactSummarySchema.extend({
  history: z.array(
    z.object({
      id: z.string(),
      eventId: z.string(),
      eventName: z.string(),
      editionYear: z.number(),
      startsAt: z.string().nullable(),
      ticketName: z.string(),
      reference: z.string(),
      status: z.string(),
      role: z.enum(['attendee', 'buyer']),
      attended: z.boolean(),
    }),
  ),
  notes: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      author: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  donations: z.array(donationResponseSchema),
  messages: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      status: z.string(),
      sentAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export type ContactDetail = z.infer<typeof contactDetailResponseSchema>;

export const companyResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  website: z.string().nullable(),
  notes: z.string().nullable(),
  contacts: z.number(),
  donated: z.number(),
});

export type CompanyRecord = z.infer<typeof companyResponseSchema>;

export const crmOptionsResponseSchema = z.object({
  companies: z.array(z.object({ id: z.string(), name: z.string() })),
  series: z.array(z.object({ id: z.string(), name: z.string() })),
  eventTypes: z.array(z.string()),
  years: z.array(z.number()),
  events: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      openForRegistration: z.boolean(),
    }),
  ),
});

export type CrmOptions = z.infer<typeof crmOptionsResponseSchema>;

/** Variables que se pueden usar en el asunto y el texto de una comunicación. */
export const mergeVariables = [
  { key: 'nombre', label: 'Nombre del contacto' },
  { key: 'apellidos', label: 'Apellidos del contacto' },
  { key: 'evento', label: 'Nombre del evento elegido' },
  { key: 'fecha', label: 'Fecha del evento elegido' },
  { key: 'sede', label: 'Sede del evento elegido' },
] as const;

const knownVariables = new Set<string>(mergeVariables.map(({ key }) => key));

function usesOnlyKnownVariables(text: string): boolean {
  return [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].every((match) =>
    knownVariables.has(match[1] ?? ''),
  );
}

const unknownVariable = 'Usa solo las variables disponibles, como {{nombre}}.';

const emailSubject = z
  .string()
  .trim()
  .min(2, 'Escribe el asunto.')
  .max(180)
  .refine(usesOnlyKnownVariables, unknownVariable);

const emailBody = z
  .string()
  .trim()
  .min(2, 'Escribe el mensaje.')
  .max(20_000)
  .refine(usesOnlyKnownVariables, unknownVariable);

export const templateInputSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre.').max(120),
  subject: emailSubject,
  body: emailBody,
});

export const templateResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
});

export type TemplateRecord = z.infer<typeof templateResponseSchema>;

export const campaignInputSchema = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre.').max(120),
  subject: emailSubject,
  body: emailBody,
  eventId: z.string().max(30).nullable(),
  segmentId: z.string().max(30).nullable(),
});

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const campaignResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  eventId: z.string().nullable(),
  eventName: z.string().nullable(),
  segmentId: z.string().nullable(),
  segmentName: z.string().nullable(),
  status: z.enum(['draft', 'queued', 'cancelled']),
  queuedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  sentBy: z.string().nullable(),
  audience: z.number(),
  stats: z.object({
    pending: z.number(),
    sent: z.number(),
    failed: z.number(),
    skipped: z.number(),
  }),
});

export type CampaignRecord = z.infer<typeof campaignResponseSchema>;

export const campaignPreviewResponseSchema = z.object({
  subject: z.string(),
  html: z.string(),
});

export const unsubscribeResponseSchema = z.object({
  email: z.string(),
  optedOut: z.boolean(),
  privacyUrl: z.string(),
});

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------

export const reportEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  editionYear: z.number(),
  startsAt: z.string().nullable(),
  seriesId: z.string(),
  seriesName: z.string(),
  eventType: z.string(),
  capacity: z.number().nullable(),
  seatsTaken: z.number(),
  seatsSold: z.number(),
  occupancy: z.number().nullable(),
  registered: z.number(),
  attended: z.number(),
  attendanceRate: z.number().nullable(),
  income: z.number(),
  pendingIncome: z.number(),
  donations: z.number(),
  donationCount: z.number(),
  people: z.number(),
  newPeople: z.number(),
  returningPeople: z.number(),
  companies: z.number(),
  returningCompanies: z.number(),
});

export type ReportEvent = z.infer<typeof reportEventSchema>;

export const reportEventsResponseSchema = z.array(reportEventSchema);

// ---------------------------------------------------------------------------
// Vistas por evento: tablero, invitados y mesas
// ---------------------------------------------------------------------------

/** Alta en la puerta: alguien con autoridad decide que esta persona puede entrar. */
export const authorizedGuestSchema = z.object({
  firstName: personFields.firstName,
  lastName: personFields.lastName,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Escribe un correo válido.')
    .max(254)
    .nullable(),
  phone: z.string().trim().max(32).nullable(),
  organization: z.string().trim().max(180).nullable(),
  ticketTypeId: z.string().min(1, 'Selecciona un boleto.').max(30),
  reason: z.string().trim().min(3, 'Escribe el motivo.').max(200),
  accessPointId: z.string().max(30).nullable(),
});

export type AuthorizedGuestInput = z.infer<typeof authorizedGuestSchema>;

export const eventDashboardSchema = z.object({
  updatedAt: z.string(),
  capacity: z.number().nullable(),
  seatsSold: z.number(),
  seatsToRegister: z.number(),
  registered: z.number(),
  pendingActivation: z.number(),
  checkedIn: z.number(),
  lastPeriodCheckins: z.number(),
  pendingArrival: z.number(),
  incidentsOpen: z.number(),
  incidentsResolved: z.number(),
  bucketMinutes: z.number(),
  timeline: z.array(
    z.object({ start: z.string(), label: z.string(), count: z.number() }),
  ),
  accessPoints: z.array(
    z.object({ id: z.string(), name: z.string(), count: z.number() }),
  ),
});

export type EventDashboard = z.infer<typeof eventDashboardSchema>;

export const guestStatusOptions = [
  { key: 'checked_in', label: 'Ingresado', tone: 'ok' },
  { key: 'pending', label: 'Pendiente', tone: 'warn' },
  { key: 'activation', label: 'Sin activar', tone: 'neutral' },
  { key: 'payment', label: 'Pago pendiente', tone: 'neutral' },
  { key: 'incident', label: 'Incidencia', tone: 'bad' },
] as const;

export const guestListResponseSchema = z.object({
  guests: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      folio: z.string(),
      group: z.string().nullable(),
      tableName: z.string().nullable(),
      organization: z.string().nullable(),
      ticketName: z.string(),
      status: z.enum([
        'checked_in',
        'pending',
        'activation',
        'payment',
        'incident',
      ]),
      checkedInAt: z.string().nullable(),
      accessPointName: z.string().nullable(),
      operatorName: z.string().nullable(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  allGuests: z.number(),
});

export const eventGroupsResponseSchema = z.array(
  z.object({
    id: z.string(),
    reference: z.string(),
    company: z.string(),
    buyerName: z.string(),
    buyerEmail: z.string().nullable(),
    delegateName: z.string().nullable(),
    delegateEmail: z.string().nullable(),
    registrationDeadline: z.string().nullable(),
    seats: z.number(),
    registered: z.number(),
    activated: z.number(),
    groupUrl: z.string().nullable(),
  }),
);

export type EventGroup = z.infer<typeof eventGroupsResponseSchema>[number];

// ---------------------------------------------------------------------------
// Acomodo de mesas
// ---------------------------------------------------------------------------

const seatingZone = z.string().trim().max(60).nullable();

export const seatingAddTablesSchema = z.object({
  count: z
    .number('Escribe cuántas mesas.')
    .int('Escribe un número entero.')
    .min(1, 'Debe ser al menos 1.')
    .max(200, 'Son demasiadas mesas de una vez.'),
  capacity: z
    .number('Escribe el cupo.')
    .int('Escribe un número entero.')
    .min(1, 'Debe ser al menos 1.')
    .max(100, 'El cupo es demasiado alto.'),
  zone: seatingZone,
});

export const seatingTableSchema = z.object({
  name: z.string().trim().min(1, 'Escribe el nombre.').max(100),
  capacity: z.number().int().min(1).max(100),
  zone: seatingZone,
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

export const seatingZoneSchema = z.object({
  groupKey: z.string().min(1).max(60),
  zone: seatingZone,
});

export const seatingMoveGroupSchema = z.object({
  orderIds: z.array(z.string().max(30)).min(1).max(500),
  tableId: z.string().max(30).nullable(),
});

export const seatingMovePersonSchema = z.object({
  registrationId: z.string().max(30),
  tableId: z.string().max(30).nullable(),
});

export const seatingLockSchema = z.object({ locked: z.boolean() });

export const seatingViewSchema = z.object({
  publishedAt: z.string().nullable(),
  pendingChanges: z.number(),
  registeredPeople: z.number(),
  unpaidSeats: z.number(),
  planVersion: z.number().nullable(),
  tables: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      capacity: z.number(),
      zone: z.string().nullable(),
      x: z.number(),
      y: z.number(),
      occupied: z.number(),
      people: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          folio: z.string(),
          group: z.string(),
        }),
      ),
    }),
  ),
  groups: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      zone: z.string().nullable(),
      seats: z.number(),
      placedSeats: z.number(),
      orders: z.array(
        z.object({
          id: z.string(),
          reference: z.string(),
          seats: z.number(),
          buyerName: z.string(),
          allocations: z.array(
            z.object({
              id: z.string(),
              tableId: z.string(),
              tableName: z.string(),
              seats: z.number(),
              locked: z.boolean(),
            }),
          ),
          people: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              folio: z.string(),
              tableId: z.string().nullable(),
              pendingActivation: z.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type SeatingView = z.infer<typeof seatingViewSchema>;

export const seatingAutoResultSchema = z.object({
  placed: z.number(),
  unplacedSeats: z.number(),
  warnings: z.array(
    z.object({
      groupKey: z.string(),
      label: z.string(),
      kind: z.enum(['no_fit', 'split', 'outside_zone']),
      message: z.string(),
    }),
  ),
});

export const seatingPublishResultSchema = z.object({
  notified: z.number(),
  unassigned: z.number(),
});

/** Áreas para filtrar la bitácora. Cada acción pertenece a una por su prefijo. */
export const auditCategories = [
  {
    key: 'acceso',
    label: 'Acceso y permisos',
    prefixes: ['auth.', 'user.', 'role.'],
  },
  {
    key: 'eventos',
    label: 'Eventos',
    prefixes: ['event.', 'series.', 'ticket.', 'field.'],
  },
  {
    key: 'compras',
    label: 'Compras y pagos',
    prefixes: ['order.', 'payment.', 'pass.', 'refund.', 'registration.'],
  },
  {
    key: 'recepcion',
    label: 'Recepción',
    prefixes: ['checkin.', 'incident.', 'access_point.'],
  },
  { key: 'acomodo', label: 'Acomodo de mesas', prefixes: ['seating.'] },
  {
    key: 'crm',
    label: 'Contactos y comunicaciones',
    prefixes: [
      'contact.',
      'company.',
      'segment.',
      'template.',
      'campaign.',
      'donation.',
      'email.',
    ],
  },
  {
    key: 'finanzas',
    label: 'Finanzas',
    prefixes: ['budget.', 'finance.', 'policy.'],
  },
  { key: 'reportes', label: 'Descargas', prefixes: ['report.'] },
] as const;

const pageFields = {
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
};

export const auditListSchema = z.object({
  ...pageFields,
  rows: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string(),
      action: z.string(),
      actionLabel: z.string(),
      detail: z.string(),
      userName: z.string().nullable(),
      eventName: z.string().nullable(),
    }),
  ),
});

export const auditOptionsSchema = z.object({
  events: z.array(z.object({ id: z.string(), name: z.string() })),
  users: z.array(z.object({ id: z.string(), displayName: z.string() })),
});

export const consentEventsSchema = z.array(
  z.object({ id: z.string(), name: z.string() }),
);

export const consentNoticeListSchema = z.object({
  ...pageFields,
  accepted: z.number(),
  pending: z.number(),
  rows: z.array(
    z.object({
      id: z.string(),
      guestName: z.string(),
      email: z.string().nullable(),
      eventName: z.string(),
      folio: z.string(),
      purpose: z.string(),
      noticeVersion: z.string(),
      consentedAt: z.string(),
    }),
  ),
});

export const consentMarketingListSchema = z.object({
  ...pageFields,
  granted: z.number(),
  optedOut: z.number(),
  none: z.number(),
  rows: z.array(
    z.object({
      contactId: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      status: z.enum(['granted', 'opted_out', 'none']),
      at: z.string().nullable(),
      source: z.string().nullable(),
      noticeVersion: z.string().nullable(),
    }),
  ),
});

export const eventOperatorListSchema = z.array(
  z.object({
    id: z.string(),
    displayName: z.string(),
    email: z.string(),
    roleName: z.string(),
    status: z.string(),
    lastLoginAt: z.string().nullable(),
    canOperate: z.boolean(),
    checkins: z.number(),
    manual: z.number(),
    incidents: z.number(),
    doors: z.array(z.object({ name: z.string(), checkins: z.number() })),
    firstAt: z.string().nullable(),
    lastAt: z.string().nullable(),
  }),
);

/**
 * ¿Lo que se escribió en recepción es este folio? Basta el consecutivo: en la puerta
 * nadie teclea GAL27-0127 si con 127 alcanza. Compara el número completo para que
 * 12 no abra el pase 127.
 */
export function matchesFolio(folio: string, typed: string): boolean {
  const input = typed.replace(/\s+/g, '').toUpperCase();
  if (!input) {
    return false;
  }
  const whole = folio.toUpperCase();
  if (input === whole || input === whole.replace(/-/g, '')) {
    return true;
  }
  const consecutive = Number(whole.split('-').at(-1));
  return /^\d+$/.test(input) && Number(input) === consecutive;
}

// ---------------------------------------------------------------------------
// Finanzas
// ---------------------------------------------------------------------------

const moneyAmount = z
  .number('Escribe el monto.')
  .positive('Debe ser mayor a cero.')
  .max(99_999_999, 'El monto es demasiado alto.');

const refundFields = {
  amount: moneyAmount,
  method: z.enum(['transfer', 'cash', 'card', 'other']),
  reference: z.string().trim().max(120).nullable(),
  refundedAt: z.string().datetime({ offset: true }),
};

export const refundInputSchema = z.object({
  ...refundFields,
  reason: z.string().trim().min(3, 'Escribe el motivo.').max(500),
});

export type RefundInput = z.infer<typeof refundInputSchema>;

export const orderCancelSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
  refund: z.object(refundFields).nullish(),
});

export const orderDueDateSchema = z.object({
  dueAt: z.string().datetime({ offset: true }),
});

export const orderFiscalSchema = z.object({
  fiscal: fiscalDataSchema.nullable(),
});

export const orderInvoiceSchema = z.object({
  invoiceFolio: z.string().trim().min(1, 'Escribe el folio.').max(60),
});

export const nameCorrectionSchema = z.object({
  firstName: personFields.firstName,
  lastName: personFields.lastName,
  reason: z.string().trim().min(3, 'Escribe el motivo.').max(500),
});

export const passTransferSchema = z.object({
  firstName: personFields.firstName,
  lastName: personFields.lastName,
  email: personFields.email,
  reason: z.string().trim().min(3, 'Escribe el motivo.').max(500),
});

const moneyEqual = (a: number, b: number) => Math.abs(a - b) < 0.005;

export const financialStatusLabels: Record<string, [string, string]> = {
  pending: ['Pendiente de pago', 'warn'],
  partial: ['Pagada parcial', 'warn'],
  paid: ['Pagada', 'ok'],
  free: ['Sin costo', 'ok'],
  partially_refunded: ['Reembolso parcial', 'neutral'],
  refunded: ['Reembolsada', 'neutral'],
  cancelled: ['Cancelada', 'bad'],
  cancelled_refunded: ['Cancelada y reembolsada', 'bad'],
  cancelled_retained: ['Cancelada con retención', 'bad'],
};

/** El estado financiero se calcula de los pagos: así nunca contradice al dinero. */
export function orderFinancialStatus(order: {
  status: string;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
}): string {
  const { status, amountDue, amountPaid, amountRefunded } = order;
  const net = amountPaid - amountRefunded;
  if (status === 'cancelled') {
    if (net > 0.005) {
      return 'cancelled_retained';
    }
    return amountRefunded > 0 ? 'cancelled_refunded' : 'cancelled';
  }
  if (status === 'pending_payment') {
    return amountPaid > 0 ? 'partial' : 'pending';
  }
  if (amountRefunded > 0) {
    return moneyEqual(net, 0) ? 'refunded' : 'partially_refunded';
  }
  return amountDue === 0 ? 'free' : 'paid';
}

const DAY_MS = 86_400_000;

export const agingBuckets = [
  { key: 'current', label: 'Por vencer' },
  { key: 'd1_7', label: 'Vencido 1 a 7 días' },
  { key: 'd8_30', label: 'Vencido 8 a 30 días' },
  { key: 'd31', label: 'Vencido más de 30 días' },
  { key: 'no_date', label: 'Sin fecha de vencimiento' },
] as const;

export type AgingBucket = (typeof agingBuckets)[number]['key'];

export function daysOverdue(dueAt: Date, now: Date): number {
  return Math.ceil((now.getTime() - dueAt.getTime()) / DAY_MS);
}

export function agingBucket(dueAt: Date | null, now: Date): AgingBucket {
  if (!dueAt) {
    return 'no_date';
  }
  const days = daysOverdue(dueAt, now);
  if (days <= 0) {
    return 'current';
  }
  if (days <= 7) {
    return 'd1_7';
  }
  return days <= 30 ? 'd8_30' : 'd31';
}

/** Días respecto al vencimiento: tres antes, el mismo día, y dos insistencias después. */
export const REMINDER_OFFSETS_DAYS = [-3, 0, 3, 7] as const;

/**
 * La siguiente etapa de recordatorio, o null si aún no toca. Si pasaron varias de golpe,
 * por ejemplo tras una caída del servidor, salta a la última: un solo correo, no varios.
 */
export function nextReminderStage(
  dueAt: Date,
  stage: number,
  now: Date,
): number | null {
  let next: number | null = null;
  REMINDER_OFFSETS_DAYS.forEach((offset, index) => {
    if (index >= stage && now.getTime() >= dueAt.getTime() + offset * DAY_MS) {
      next = index + 1;
    }
  });
  return next;
}

/** Lo mínimo para pagar cuando se compra ya encima de la fecha límite del evento. */
export const LAST_MINUTE_PAYMENT_DAYS = 2;

/**
 * Fecha límite de una compra nueva. Una mesa o compra de varios lugares suele requerir
 * orden de compra y aprobación, así que tiene más plazo que un boleto individual. Todo
 * vence antes del evento, para acomodar las mesas solo con lo que ya está pagado.
 */
export function paymentDueDate(
  event: {
    paymentTermDays: number;
    corporateTermDays: number;
    paymentCutoffDays: number;
    startsAt: Date | null;
  },
  seats: number,
  now: Date,
): Date {
  const term = seats > 1 ? event.corporateTermDays : event.paymentTermDays;
  const due = new Date(now.getTime() + term * DAY_MS);
  if (!event.startsAt || event.startsAt <= now) {
    return due;
  }
  const cutoff = new Date(
    event.startsAt.getTime() - event.paymentCutoffDays * DAY_MS,
  );
  if (due <= cutoff) {
    return due;
  }
  const lastMinute = new Date(
    now.getTime() + LAST_MINUTE_PAYMENT_DAYS * DAY_MS,
  );
  const latest = cutoff > lastMinute ? cutoff : lastMinute;
  return latest < event.startsAt ? latest : event.startsAt;
}

export const cancellationTierSchema = z.object({
  daysBefore: z
    .number('Escribe los días.')
    .int('Escribe días completos.')
    .min(0, 'No puede ser negativo.')
    .max(730),
  percent: z
    .number('Escribe el porcentaje.')
    .int('Escribe un porcentaje entero.')
    .min(0, 'Va de 0 a 100.')
    .max(100, 'Va de 0 a 100.'),
});

export type CancellationTier = z.infer<typeof cancellationTierSchema>;

export const cancellationPolicyInputSchema = z.object({
  eventType: z.string().trim().min(2, 'Indica el tipo de evento.').max(60),
  text: z
    .string()
    .trim()
    .min(10, 'Escribe la política que verá quien compra.')
    .max(2000),
  tiers: z.array(cancellationTierSchema).max(6),
});

export const cancellationPolicySchema = z.object({
  eventType: z.string(),
  text: z.string(),
  tiers: z.array(cancellationTierSchema),
  updatedAt: z.string(),
  updatedBy: z.string().nullable(),
});

export const cancellationPolicyListSchema = z.object({
  policies: z.array(cancellationPolicySchema),
  eventTypes: z.array(z.string()),
});

export const orderPolicySchema = z.object({
  text: z.string(),
  tiers: z.array(cancellationTierSchema),
  suggestedPercent: z.number().nullable(),
  daysLeft: z.number().nullable(),
});

/** El porcentaje que marca la política: el del primer plazo que todavía se cumple. */
export function suggestedRefundPercent(
  tiers: CancellationTier[],
  startsAt: Date | null,
  now: Date,
): number | null {
  if (!startsAt || tiers.length === 0) {
    return null;
  }
  const daysLeft = Math.floor((startsAt.getTime() - now.getTime()) / DAY_MS);
  const tier = [...tiers]
    .sort((a, b) => b.daysBefore - a.daysBefore)
    .find(({ daysBefore }) => daysLeft >= daysBefore);
  return tier?.percent ?? 0;
}

export const budgetCategories = [
  { key: 'venue', label: 'Sede' },
  { key: 'catering', label: 'Banquete' },
  { key: 'production', label: 'Producción' },
  { key: 'fees', label: 'Comisiones' },
  { key: 'other', label: 'Otros' },
] as const;

export const budgetItemInputSchema = z.object({
  category: z.enum(budgetCategories.map(({ key }) => key)),
  concept: z.string().trim().min(2, 'Escribe el concepto.').max(160),
  budgeted: z
    .number('Escribe el presupuesto.')
    .min(0, 'No puede ser negativo.')
    .max(9_999_999_999),
  actual: z
    .number('Escribe el costo real.')
    .min(0, 'No puede ser negativo.')
    .max(9_999_999_999)
    .nullable(),
  notes: z.string().trim().max(500).nullable(),
});

export const eventFinanceSettingsSchema = z.object({
  fundraisingGoal: z
    .number('Escribe la meta.')
    .positive('Debe ser mayor a cero.')
    .max(9_999_999_999)
    .nullable(),
  paymentTermDays: z
    .number('Escribe los días.')
    .int('Escribe días completos.')
    .min(0, 'No puede ser negativo.')
    .max(180, 'Máximo 180 días.'),
  corporateTermDays: z
    .number('Escribe los días.')
    .int('Escribe días completos.')
    .min(0, 'No puede ser negativo.')
    .max(180, 'Máximo 180 días.'),
  paymentCutoffDays: z
    .number('Escribe los días.')
    .int('Escribe días completos.')
    .min(0, 'No puede ser negativo.')
    .max(180, 'Máximo 180 días.'),
  paymentReminders: z.boolean(),
});

const financeTotals = z.object({
  grossCollected: z.number(),
  refunded: z.number(),
  netCollected: z.number(),
  retainedFromCancelled: z.number(),
  donations: z.number(),
  totalIncome: z.number(),
  receivable: z.number(),
  overdue: z.number(),
  goal: z.number().nullable(),
  goalProgress: z.number().nullable(),
  budgeted: z.number(),
  actualCosts: z.number(),
  costsMissing: z.number(),
  result: z.number(),
  projectedResult: z.number(),
});

export type FinanceTotals = z.infer<typeof financeTotals>;

export const closingCheckSchema = z.object({
  issues: z.array(z.object({ key: z.string(), text: z.string() })),
});

export const eventFinanceSchema = z.object({
  currency: z.string(),
  paymentTermDays: z.number(),
  corporateTermDays: z.number(),
  paymentCutoffDays: z.number(),
  paymentReminders: z.boolean(),
  totals: financeTotals,
  byMethod: z.array(z.object({ method: z.string(), amount: z.number() })),
  budget: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      concept: z.string(),
      budgeted: z.number(),
      actual: z.number().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  closing: z
    .object({
      closedAt: z.string(),
      closedBy: z.string().nullable(),
      note: z.string().nullable(),
      totals: financeTotals,
    })
    .nullable(),
});

export const receivablesSchema = z.object({
  total: z.number(),
  buckets: z.array(
    z.object({ key: z.string(), count: z.number(), amount: z.number() }),
  ),
  rows: z.array(
    z.object({
      orderId: z.string(),
      eventId: z.string(),
      eventName: z.string(),
      timeZone: z.string(),
      currency: z.string(),
      reference: z.string(),
      buyerName: z.string(),
      buyerEmail: z.string().nullable(),
      organization: z.string().nullable(),
      ticketName: z.string(),
      amountDue: z.number(),
      amountPaid: z.number(),
      balance: z.number(),
      dueAt: z.string().nullable(),
      daysOverdue: z.number().nullable(),
      bucket: z.string(),
      lastReminderAt: z.string().nullable(),
      remindersOn: z.boolean(),
    }),
  ),
  events: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const invoiceQueueSchema = z.array(
  z.object({
    orderId: z.string(),
    eventId: z.string(),
    eventName: z.string(),
    reference: z.string(),
    buyerName: z.string(),
    financialStatus: z.string(),
    amountPaid: z.number(),
    amountRefunded: z.number(),
    fiscal: fiscalDataSchema,
    invoiceStatus: z.string(),
    invoiceFolio: z.string().nullable(),
  }),
);

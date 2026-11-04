import { Router } from 'express';
import { donationMethodOptions } from '@uka/shared';
import { z } from 'zod';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import { currentUser, requireAuth, requirePermission } from '../auth/auth.js';
import { contactWhere } from '../contacts/filters.js';
import { dateStamp, formatDate, sendCsv, toCsv } from './csv.js';
import { eventMetrics } from './metrics.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const percent = (value: number | null) =>
  value === null ? null : Math.round(value * 1000) / 10;

const orderStatusLabels: Record<string, string> = {
  pending_payment: 'Pendiente de pago',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

const registrationStatusLabels: Record<string, string> = {
  pending: 'Pendiente de pago',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

const orderSourceLabels: Record<string, string> = {
  public: 'Registro público',
  staff: 'Capturado por el equipo',
  reconciled: 'Compra conciliada',
  authorized: 'Alta autorizada',
};

const methodLabel = (method: string) =>
  donationMethodOptions.find(({ key }) => key === method)?.label ?? method;

reportsRouter.get(
  '/events',
  requirePermission('reports.view', 'reports.export'),
  asyncHandler(async (_request, response) => {
    response.json(await eventMetrics());
  }),
);

const eventsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  type: z.string().trim().max(60).optional(),
  seriesId: z.string().max(30).optional(),
});

reportsRouter.get(
  '/export/events.csv',
  requirePermission('reports.export'),
  asyncHandler(async (request, response) => {
    const filters = eventsQuerySchema.parse(request.query);
    const rows = (await eventMetrics()).filter(
      (row) =>
        (!filters.year || row.editionYear === filters.year) &&
        (!filters.type || row.eventType === filters.type) &&
        (!filters.seriesId || row.seriesId === filters.seriesId),
    );
    await recordAudit({
      userId: currentUser(request).id,
      action: 'report.export_events',
      entityType: 'report',
      details: { rows: rows.length, ...filters },
    });
    sendCsv(
      response,
      `comparativo-eventos-${dateStamp()}.csv`,
      toCsv(
        [
          'Evento',
          'Serie',
          'Tipo',
          'Edición',
          'Fecha',
          'Aforo',
          'Lugares ocupados',
          'Lugares vendidos',
          'Ocupación %',
          'Registrados',
          'Asistieron',
          'Asistencia %',
          'Ingresos',
          'Por cobrar',
          'Donativos',
          'Personas',
          'Personas nuevas',
          'Personas que repiten',
          'Empresas',
          'Empresas que repiten',
        ],
        rows.map((row) => [
          row.name,
          row.seriesName,
          row.eventType,
          row.editionYear,
          formatDate(row.startsAt),
          row.capacity,
          row.seatsTaken,
          row.seatsSold,
          percent(row.occupancy),
          row.registered,
          row.attended,
          percent(row.attendanceRate),
          row.income,
          row.pendingIncome,
          row.donations,
          row.people,
          row.newPeople,
          row.returningPeople,
          row.companies,
          row.returningCompanies,
        ]),
      ),
    );
  }),
);

reportsRouter.get(
  '/export/events/:eventId/registrations.csv',
  requirePermission('reports.export'),
  asyncHandler(async (request, response) => {
    const eventId = String(request.params.eventId);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new AppError(404, 'El evento no existe.');
    }
    const orders = await prisma.order.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      include: {
        buyer: true,
        ticketType: { select: { name: true } },
        payments: { where: { voidedAt: null }, select: { amount: true } },
        registrations: {
          orderBy: { seatNumber: 'asc' },
          include: {
            guest: true,
            passes: {
              include: {
                checkin: {
                  select: {
                    checkedInAt: true,
                    accessPoint: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const rows = orders.flatMap((order) => {
      const answers = (Array.isArray(order.answers) ? order.answers : [])
        .map((item) => {
          const answer = item as { label?: string; value?: string };
          return `${answer.label}: ${answer.value}`;
        })
        .join(' | ');
      const paid = order.payments.reduce(
        (sum, payment) => sum + payment.amount.toNumber(),
        0,
      );
      const buyerName = `${order.buyer.firstName} ${order.buyer.lastName}`;
      const common = [
        order.reference,
        order.ticketType.name,
        orderStatusLabels[order.status] ?? order.status,
        order.amountDue.toNumber(),
        paid,
        buyerName,
        order.buyer.email,
        orderSourceLabels[order.source] ?? order.source,
      ];
      const attendees = order.registrations.map((registration) => {
        const checkin = registration.passes.find(
          (pass) => pass.checkin,
        )?.checkin;
        return [
          registration.folio,
          registration.guest.firstName,
          registration.guest.lastName,
          registration.guest.email,
          registration.guest.phone,
          registration.guest.organization,
          registrationStatusLabels[registration.status] ?? registration.status,
          checkin ? 'Sí' : 'No',
          checkin?.checkedInAt.toLocaleString('es-MX', {
            timeZone: event.timeZone,
            dateStyle: 'short',
            timeStyle: 'short',
          }) ?? '',
          checkin?.accessPoint.name ?? '',
          ...common,
          answers,
        ];
      });
      const missing =
        order.status === 'confirmed'
          ? order.seats -
            order.registrations.filter((item) => item.status !== 'cancelled')
              .length
          : 0;
      // Los lugares pagados que nadie ha registrado también deben verse en el archivo.
      const unregistered = Array.from({ length: Math.max(missing, 0) }, () => [
        '',
        '',
        '',
        '',
        '',
        '',
        'Por registrar',
        'No',
        '',
        '',
        ...common,
        answers,
      ]);
      return [...attendees, ...unregistered];
    });

    await recordAudit({
      userId: currentUser(request).id,
      action: 'report.export_registrations',
      entityType: 'event',
      entityId: eventId,
      eventId,
      details: { rows: rows.length },
    });
    sendCsv(
      response,
      `registros-${event.slug}-${dateStamp()}.csv`,
      toCsv(
        [
          'Folio',
          'Nombre',
          'Apellidos',
          'Correo',
          'Teléfono',
          'Empresa',
          'Estado',
          'Asistió',
          'Hora de ingreso',
          'Punto de acceso',
          'Pedido',
          'Boleto',
          'Estado del pedido',
          'Importe',
          'Pagado',
          'Comprador',
          'Correo del comprador',
          'Origen',
          'Respuestas',
        ],
        rows,
      ),
    );
  }),
);

const contactsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  companyId: z.string().max(30).optional(),
  eventType: z.string().trim().max(60).optional(),
  seriesId: z.string().max(30).optional(),
  eventId: z.string().max(30).optional(),
  editionYear: z.coerce.number().int().min(2000).max(2100).optional(),
  participation: z
    .enum(['any', 'registered', 'attended', 'not_attended'])
    .optional(),
  donor: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  reachable: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

reportsRouter.get(
  '/export/contacts.csv',
  requirePermission('reports.export'),
  asyncHandler(async (request, response) => {
    const filters = contactsQuerySchema.parse(request.query);
    const contacts = await prisma.contact.findMany({
      where: contactWhere(filters),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        company: { select: { name: true } },
        _count: { select: { guests: true } },
      },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'report.export_contacts',
      entityType: 'report',
      details: { rows: contacts.length, ...filters },
    });
    sendCsv(
      response,
      `contactos-${dateStamp()}.csv`,
      toCsv(
        [
          'Nombre',
          'Apellidos',
          'Correo',
          'Teléfono',
          'Empresa',
          'Puesto',
          'Participaciones',
          'Acepta comunicaciones',
          'Dado de baja',
          'Fecha de alta',
        ],
        contacts.map((contact) => [
          contact.firstName,
          contact.lastName,
          contact.email,
          contact.phone,
          contact.company?.name,
          contact.position,
          contact._count.guests,
          contact.marketingConsentAt && !contact.optedOutAt ? 'Sí' : 'No',
          contact.optedOutAt ? 'Sí' : 'No',
          formatDate(contact.createdAt),
        ]),
      ),
    );
  }),
);

const donationsQuerySchema = z.object({
  eventId: z.string().max(30).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

reportsRouter.get(
  '/export/donations.csv',
  requirePermission('reports.export'),
  asyncHandler(async (request, response) => {
    const { eventId, year } = donationsQuerySchema.parse(request.query);
    const donations = await prisma.donation.findMany({
      where: {
        ...(eventId ? { eventId } : {}),
        ...(year
          ? {
              receivedAt: {
                gte: new Date(Date.UTC(year, 0, 1)),
                lt: new Date(Date.UTC(year + 1, 0, 1)),
              },
            }
          : {}),
      },
      orderBy: { receivedAt: 'desc' },
      include: {
        contact: { select: { firstName: true, lastName: true, email: true } },
        company: { select: { name: true } },
        event: { select: { name: true } },
        recordedBy: { select: { displayName: true } },
      },
    });
    await recordAudit({
      userId: currentUser(request).id,
      action: 'report.export_donations',
      entityType: 'report',
      details: { rows: donations.length, eventId, year },
    });
    sendCsv(
      response,
      `donativos-${dateStamp()}.csv`,
      toCsv(
        [
          'Fecha',
          'Donante',
          'Correo',
          'Empresa',
          'Evento',
          'Monto',
          'Moneda',
          'Forma',
          'Referencia',
          'Notas',
          'Registró',
          'Anulado',
          'Motivo de anulación',
        ],
        donations.map((donation) => [
          formatDate(donation.receivedAt),
          donation.contact
            ? `${donation.contact.firstName} ${donation.contact.lastName}`
            : '',
          donation.contact?.email,
          donation.company?.name,
          donation.event?.name,
          donation.amount.toNumber(),
          donation.currency,
          methodLabel(donation.method),
          donation.reference,
          donation.notes,
          donation.recordedBy?.displayName,
          donation.voidedAt ? 'Sí' : 'No',
          donation.voidReason,
        ]),
      ),
    );
  }),
);

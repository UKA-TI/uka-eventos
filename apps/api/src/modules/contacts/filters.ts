import type { SegmentFilters } from '@uka/shared';
import type { Prisma } from '../../generated/prisma/client.js';

function eventScope(filters: SegmentFilters): Prisma.EventWhereInput {
  return {
    ...(filters.eventId ? { id: filters.eventId } : {}),
    ...(filters.seriesId ? { seriesId: filters.seriesId } : {}),
    ...(filters.editionYear ? { editionYear: filters.editionYear } : {}),
    ...(filters.eventType ? { series: { type: filters.eventType } } : {}),
  };
}

/** Quien compró una mesa cuenta como registrado aunque no tenga un lugar propio. */
function registeredIn(event: Prisma.EventWhereInput): Prisma.ContactWhereInput {
  return {
    guests: {
      some: {
        OR: [
          { registrations: { some: { event, status: { not: 'cancelled' } } } },
          { orders: { some: { event, status: { not: 'cancelled' } } } },
        ],
      },
    },
  };
}

function attendedIn(event: Prisma.EventWhereInput): Prisma.ContactWhereInput {
  return {
    guests: {
      some: {
        registrations: {
          some: { event, passes: { some: { checkin: { isNot: null } } } },
        },
      },
    },
  };
}

function participationWhere(filters: SegmentFilters): Prisma.ContactWhereInput {
  const event = eventScope(filters);
  const hasScope = Object.keys(event).length > 0;
  // Elegir un evento sin indicar más significa "los que participaron en él".
  const participation =
    !filters.participation || filters.participation === 'any'
      ? hasScope
        ? 'registered'
        : 'any'
      : filters.participation;
  switch (participation) {
    case 'registered':
      return registeredIn(event);
    case 'attended':
      return attendedIn(event);
    case 'not_attended':
      return { AND: [registeredIn(event), { NOT: attendedIn(event) }] };
    default:
      return {};
  }
}

export function contactWhere(
  filters: SegmentFilters,
): Prisma.ContactWhereInput {
  const { q } = filters;
  return {
    AND: [
      participationWhere(filters),
      filters.companyId ? { companyId: filters.companyId } : {},
      filters.donor ? { donations: { some: { voidedAt: null } } } : {},
      filters.reachable ? reachableWhere : {},
      q
        ? {
            OR: [
              { firstName: { contains: q } },
              { lastName: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
              { company: { name: { contains: q } } },
            ],
          }
        : {},
    ],
  };
}

/** A quién sí se le puede escribir: dio permiso, tiene correo y no ha pedido la baja. */
export const reachableWhere: Prisma.ContactWhereInput = {
  email: { not: null },
  optedOutAt: null,
  marketingConsentAt: { not: null },
};

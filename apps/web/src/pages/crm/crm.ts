import { useQuery } from '@tanstack/react-query';
import {
  contactInputSchema,
  crmOptionsResponseSchema,
  segmentResponseSchema,
  templateResponseSchema,
  type CampaignRecord,
  type ContactInput,
  type SegmentFilters,
} from '@uka/shared';
import { z } from 'zod';
import { apiRequest } from '../../api.js';
import { issuesToErrors } from '../text.js';

export function useSegments() {
  return useQuery({
    queryKey: ['segments'],
    queryFn: async () =>
      z.array(segmentResponseSchema).parse(await apiRequest('/api/segments')),
  });
}

export function useTemplates() {
  return useQuery({
    queryKey: ['email-templates'],
    queryFn: async () =>
      z
        .array(templateResponseSchema)
        .parse(await apiRequest('/api/email-templates')),
  });
}

export function campaignState(campaign: CampaignRecord): [string, string] {
  if (campaign.status === 'draft') {
    return ['Borrador', 'neutral'];
  }
  if (campaign.status === 'cancelled') {
    return ['Cancelada', 'bad'];
  }
  return campaign.stats.pending > 0 ? ['Enviando', 'warn'] : ['Enviada', 'ok'];
}

export const emptyContactForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  position: '',
  companyId: '',
};

export type ContactFormValues = typeof emptyContactForm;

export function parseContactForm(
  form: ContactFormValues,
):
  | { success: true; data: ContactInput }
  | { success: false; errors: Record<string, string> } {
  const parsed = contactInputSchema.safeParse({
    firstName: form.firstName,
    lastName: form.lastName,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    position: form.position.trim() || null,
    companyId: form.companyId || null,
  });
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, errors: issuesToErrors(parsed.error.issues) };
}

export function useCrmOptions() {
  return useQuery({
    queryKey: ['crm-options'],
    queryFn: async () =>
      crmOptionsResponseSchema.parse(await apiRequest('/api/contacts/options')),
  });
}

/** Un segmento se abre como la lista de contactos con sus filtros en la dirección. */
export function filtersToParams(filters: SegmentFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== false) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

const messageKinds: Record<string, string> = {
  pass: 'Pase con QR',
  order_pending: 'Registro recibido',
  group_link: 'Liga de invitados',
  campaign: 'Comunicación',
  campaign_test: 'Prueba de comunicación',
};

export const messageKindLabel = (kind: string) => messageKinds[kind] ?? kind;

const messageStatuses: Record<string, [string, string]> = {
  pending: ['En cola', 'warn'],
  sending: ['En cola', 'warn'],
  sent: ['Enviado', 'ok'],
  failed: ['Falló', 'bad'],
  skipped: ['Omitido', 'neutral'],
};

export const messageStatus = (status: string): [string, string] =>
  messageStatuses[status] ?? [status, 'neutral'];

export const historyStatus = (status: string): [string, string] => {
  switch (status) {
    case 'confirmed':
      return ['Confirmado', 'ok'];
    case 'cancelled':
      return ['Cancelado', 'bad'];
    default:
      return ['Pendiente de pago', 'warn'];
  }
};

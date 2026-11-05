import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  defaultModulesForType,
  eventDetailResponseSchema,
  eventInputSchema,
  seriesInputSchema,
  seriesResponseSchema,
  suggestedEventTypes,
  type EventDetail,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Notice } from '../components/ui.js';
import { dateTimeInZoneToIso, toLocalDateTime } from './dates.js';
import { issuesToErrors, slugify } from './text.js';

const NEW_SERIES = '__nueva__';

function initialForm(event?: EventDetail) {
  return {
    seriesId: event?.series.id ?? '',
    newSeriesName: '',
    newSeriesType: '',
    editionYear: String(event?.editionYear ?? new Date().getFullYear()),
    name: event?.name ?? '',
    slug: event?.slug ?? '',
    description: event?.description ?? '',
    startsAt: event?.startsAt
      ? toLocalDateTime(event.startsAt, event.timeZone)
      : '',
    endsAt: event?.endsAt ? toLocalDateTime(event.endsAt, event.timeZone) : '',
    timeZone: event?.timeZone ?? 'America/Mexico_City',
    venue: event?.venue ?? '',
    programStartsAt: event?.programStartsAt
      ? toLocalDateTime(event.programStartsAt, event.timeZone)
      : '',
    mapUrl: event?.mapUrl ?? '',
    paymentInstructions: event?.paymentInstructions ?? '',
    capacity: event?.capacity?.toString() ?? '',
    folioPrefix: event?.folioPrefix ?? '',
  };
}

export function EventGeneralForm({
  event,
  onSaved,
  onCancel,
}: {
  event?: EventDetail;
  onSaved: (saved: EventDetail) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [form, setForm] = useState(() => initialForm(event));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');

  const series = useQuery({
    queryKey: ['series'],
    queryFn: async () =>
      z.array(seriesResponseSchema).parse(await apiRequest('/api/series')),
  });

  const update = (field: keyof typeof form, value: string) => {
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== field),
      ),
    );
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'name' && !event ? { slug: slugify(value) } : {}),
    }));
  };

  const creatingSeries = form.seriesId === NEW_SERIES;

  const save = useMutation({
    mutationFn: async () => {
      const problems: Record<string, string> = {};
      const seriesInput = seriesInputSchema.safeParse({
        name: form.newSeriesName,
        type: form.newSeriesType,
        description: null,
      });
      if (creatingSeries && !seriesInput.success) {
        const issues = issuesToErrors(seriesInput.error.issues);
        if (issues.name) problems.newSeriesName = issues.name;
        if (issues.type) problems.newSeriesType = issues.type;
      }

      const selected = series.data?.find((item) => item.id === form.seriesId);
      const type = creatingSeries ? form.newSeriesType : (selected?.type ?? '');
      const parsed = eventInputSchema.safeParse({
        seriesId: creatingSeries ? 'pendiente' : form.seriesId,
        editionYear: Number(form.editionYear),
        name: form.name,
        slug: form.slug,
        description: form.description.trim() || null,
        startsAt: form.startsAt
          ? dateTimeInZoneToIso(form.startsAt, form.timeZone)
          : null,
        endsAt: form.endsAt
          ? dateTimeInZoneToIso(form.endsAt, form.timeZone)
          : null,
        timeZone: form.timeZone,
        venue: form.venue.trim() || null,
        programStartsAt: form.programStartsAt
          ? dateTimeInZoneToIso(form.programStartsAt, form.timeZone)
          : null,
        mapUrl: form.mapUrl.trim() || null,
        paymentInstructions: form.paymentInstructions.trim() || null,
        capacity: form.capacity === '' ? null : Number(form.capacity),
        folioPrefix: form.folioPrefix.trim().toUpperCase() || null,
        currency: event?.currency ?? 'MXN',
        modules: event?.modules ?? defaultModulesForType(type),
      });
      if (!parsed.success) {
        Object.assign(problems, issuesToErrors(parsed.error.issues));
      }
      if (Object.keys(problems).length > 0 || !parsed.success) {
        setErrors(problems);
        return null;
      }

      let seriesId = form.seriesId;
      if (creatingSeries && seriesInput.success) {
        const created = seriesResponseSchema.parse(
          await apiRequest(
            '/api/series',
            jsonRequest('POST', seriesInput.data, csrfToken),
          ),
        );
        seriesId = created.id;
        await queryClient.invalidateQueries({ queryKey: ['series'] });
        setForm((current) => ({ ...current, seriesId }));
      }

      return eventDetailResponseSchema.parse(
        await apiRequest(
          event ? `/api/events/${event.id}` : '/api/events',
          jsonRequest(
            event ? 'PUT' : 'POST',
            { ...parsed.data, seriesId },
            csrfToken,
          ),
        ),
      );
    },
    onSuccess: (saved) => {
      if (saved) {
        setErrors({});
        onSaved(saved);
      }
    },
    onError: (error) =>
      setNotice(errorText(error, 'No se pudo guardar el evento.')),
  });

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setNotice('');
    save.mutate();
  };

  return (
    <form className="panel event-config-form" onSubmit={submit} noValidate>
      <Notice>{notice}</Notice>
      <h2 className="form-section">Serie y edición</h2>
      <p className="muted form-note">
        La serie agrupa las ediciones de un mismo evento, y es lo que permite
        compararlas año con año.
      </p>
      <div className="form-grid">
        <Field label="Serie" error={errors.seriesId}>
          <select
            value={form.seriesId}
            onChange={(e) => update('seriesId', e.target.value)}
          >
            <option value="">Selecciona una serie</option>
            {series.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.type})
              </option>
            ))}
            {can('events.create') && (
              <option value={NEW_SERIES}>+ Crear una serie nueva</option>
            )}
          </select>
        </Field>
        {creatingSeries && (
          <>
            <Field
              label="Nombre de la serie"
              error={errors.newSeriesName}
              hint="Sin año, por ejemplo: Gala Un Kilo de Ayuda."
            >
              <input
                value={form.newSeriesName}
                onChange={(e) => update('newSeriesName', e.target.value)}
              />
            </Field>
            <Field
              label="Tipo de evento"
              error={errors.newSeriesType}
              hint="Elige uno o escribe otro."
            >
              <input
                list="tipos-evento"
                value={form.newSeriesType}
                onChange={(e) => update('newSeriesType', e.target.value)}
              />
              <datalist id="tipos-evento">
                {suggestedEventTypes.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
            </Field>
          </>
        )}
        <Field label="Año de la edición" error={errors.editionYear}>
          <input
            type="number"
            min="2000"
            max="2100"
            value={form.editionYear}
            onChange={(e) => update('editionYear', e.target.value)}
          />
        </Field>
      </div>

      <h2 className="form-section">Datos del evento</h2>
      <div className="form-grid">
        <Field label="Nombre" error={errors.name}>
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </Field>
        <Field
          label="Dirección pública"
          error={errors.slug}
          hint="Será parte de la liga de registro."
        >
          <input
            value={form.slug}
            onChange={(e) => update('slug', e.target.value)}
          />
        </Field>
        <Field label="Inicio" error={errors.startsAt}>
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => update('startsAt', e.target.value)}
          />
        </Field>
        <Field label="Fin" error={errors.endsAt}>
          <input
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => update('endsAt', e.target.value)}
          />
        </Field>
        <Field
          label="Inicio del programa (opcional)"
          error={errors.programStartsAt}
          hint="El inicio del evento es la hora de recepción."
        >
          <input
            type="datetime-local"
            value={form.programStartsAt}
            onChange={(e) => update('programStartsAt', e.target.value)}
          />
        </Field>
        <Field
          label="Liga al mapa (opcional)"
          error={errors.mapUrl}
          hint="Aparece en el registro, el pase y los correos."
        >
          <input
            value={form.mapUrl}
            onChange={(e) => update('mapUrl', e.target.value)}
          />
        </Field>
        <Field label="Sede" error={errors.venue}>
          <input
            value={form.venue}
            onChange={(e) => update('venue', e.target.value)}
          />
        </Field>
        <Field label="Aforo" error={errors.capacity}>
          <input
            type="number"
            min="1"
            value={form.capacity}
            onChange={(e) => update('capacity', e.target.value)}
          />
        </Field>
        <Field
          label="Prefijo de folio"
          error={errors.folioPrefix}
          hint="3 letras o números, por ejemplo GAL."
        >
          <input
            maxLength={3}
            value={form.folioPrefix}
            onChange={(e) =>
              update('folioPrefix', e.target.value.toUpperCase())
            }
          />
        </Field>
        <div className="span-all">
          <Field
            label="Instrucciones de pago"
            error={errors.paymentInstructions}
            hint="Banco, cuenta y a dónde enviar el comprobante. Se muestran al registrarse en boletos de paga."
          >
            <textarea
              rows={3}
              value={form.paymentInstructions}
              onChange={(e) => update('paymentInstructions', e.target.value)}
            />
          </Field>
        </div>
        <div className="span-all">
          <Field label="Descripción" error={errors.description}>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </Field>
        </div>
      </div>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={save.isPending}
        >
          {save.isPending
            ? 'Guardando…'
            : event
              ? 'Guardar cambios'
              : 'Crear evento'}
        </button>
        {onCancel && (
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

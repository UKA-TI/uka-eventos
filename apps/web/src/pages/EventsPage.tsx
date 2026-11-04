import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  eventInputSchema,
  eventResponseSchema,
  type EventRecord,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import {
  Field,
  Loading,
  Notice,
  PageHeading,
  StatusBadge,
} from '../components/ui.js';
import { dateTimeInZoneToIso, toLocalDateTime } from './dates.js';

const emptyForm = {
  name: '',
  slug: '',
  description: '',
  status: 'draft',
  startsAt: '',
  endsAt: '',
  timeZone: 'America/Mexico_City',
  venue: '',
  capacity: '',
  folioPrefix: '',
  feeAmount: '',
  currency: 'MXN',
  companionLimit: '0',
  registrationMode: 'individual',
};

type EventForm = typeof emptyForm;

const modeLabels: Record<string, string> = {
  individual: 'Individual',
  individual_and_corporate: 'Individual y corporativo',
  corporate: 'Corporativo',
};

function toForm(event: EventRecord): EventForm {
  return {
    name: event.name,
    slug: event.slug,
    description: event.description ?? '',
    status: event.status,
    startsAt: event.startsAt
      ? toLocalDateTime(event.startsAt, event.timeZone)
      : '',
    endsAt: event.endsAt ? toLocalDateTime(event.endsAt, event.timeZone) : '',
    timeZone: event.timeZone,
    venue: event.venue ?? '',
    capacity: event.capacity?.toString() ?? '',
    folioPrefix: event.folioPrefix ?? '',
    feeAmount: event.feeAmount?.toString() ?? '',
    currency: event.currency,
    companionLimit: event.companionLimit.toString(),
    registrationMode: event.registrationMode,
  };
}

function toInput(form: EventForm) {
  return eventInputSchema.safeParse({
    name: form.name,
    slug: form.slug,
    description: form.description.trim() || null,
    status: form.status,
    startsAt: form.startsAt
      ? dateTimeInZoneToIso(form.startsAt, form.timeZone)
      : null,
    endsAt: form.endsAt
      ? dateTimeInZoneToIso(form.endsAt, form.timeZone)
      : null,
    timeZone: form.timeZone,
    venue: form.venue.trim() || null,
    capacity: form.capacity === '' ? null : Number(form.capacity),
    folioPrefix: form.folioPrefix.trim().toUpperCase() || null,
    feeAmount: form.feeAmount === '' ? null : Number(form.feeAmount),
    currency: form.currency,
    companionLimit: Number(form.companionLimit),
    registrationMode: form.registrationMode,
  });
}

function slugify(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function EventsPage() {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const events = useQuery({
    queryKey: ['events'],
    queryFn: async () =>
      z.array(eventResponseSchema).parse(await apiRequest('/api/events')),
  });

  const save = useMutation({
    mutationFn: async (input: unknown) =>
      apiRequest(
        editingId ? `/api/events/${editingId}` : '/api/events',
        jsonRequest(editingId ? 'PUT' : 'POST', input, csrfToken),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      setNotice({
        kind: 'ok',
        text: editingId ? 'Evento actualizado.' : 'Evento creado.',
      });
      setFormOpen(false);
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo guardar el evento.'),
      }),
  });

  const update = (field: keyof EventForm, value: string) => {
    setErrors((current) => {
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== field),
      );
    });
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'name' && !editingId ? { slug: slugify(value) } : {}),
    }));
  };

  const open = (event?: EventRecord) => {
    setEditingId(event?.id ?? null);
    setForm(event ? toForm(event) : emptyForm);
    setErrors({});
    setNotice(undefined);
    setFormOpen(true);
  };

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setNotice(undefined);
    const parsed = toInput(form);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  if (events.isPending) {
    return <Loading />;
  }

  return (
    <section>
      <PageHeading
        title="Eventos"
        description="Todos los eventos de Un Kilo de Ayuda."
        action={
          can('events.create') && (
            <button
              className="button primary"
              type="button"
              onClick={() => open()}
            >
              Nuevo evento
            </button>
          )
        }
      />
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {events.isError && <Notice>{events.error.message}</Notice>}

      {formOpen && (
        <form className="panel" onSubmit={submit} noValidate>
          <div className="panel-heading">
            <h2>{editingId ? 'Editar evento' : 'Nuevo evento'}</h2>
          </div>
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
            <Field label="Estado" error={errors.status}>
              <select
                value={form.status}
                onChange={(e) => update('status', e.target.value)}
              >
                <option value="draft">Borrador</option>
                <option value="active">Activo</option>
                <option value="closed">Cerrado</option>
              </select>
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
            <Field
              label="Cuota por persona (MXN)"
              error={errors.feeAmount}
              hint="Déjala vacía si el evento es gratuito."
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.feeAmount}
                onChange={(e) => update('feeAmount', e.target.value)}
              />
            </Field>
            <Field
              label="Acompañantes por persona"
              error={errors.companionLimit}
            >
              <input
                type="number"
                min="0"
                value={form.companionLimit}
                onChange={(e) => update('companionLimit', e.target.value)}
              />
            </Field>
            <Field
              label="Modalidad de registro"
              error={errors.registrationMode}
            >
              <select
                value={form.registrationMode}
                onChange={(e) => update('registrationMode', e.target.value)}
              >
                {Object.entries(modeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
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
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="panel table-panel">
        {events.data?.length === 0 ? (
          <p className="muted">Aún no hay eventos. Crea el primero.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Fecha</th>
                  <th>Sede</th>
                  <th>Aforo</th>
                  <th>Estado</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {events.data?.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <strong>{event.name}</strong>
                    </td>
                    <td>
                      {event.startsAt
                        ? new Date(event.startsAt).toLocaleDateString('es-MX', {
                            timeZone: event.timeZone,
                            dateStyle: 'medium',
                          })
                        : '—'}
                    </td>
                    <td>{event.venue ?? '—'}</td>
                    <td>{event.capacity?.toLocaleString('es-MX') ?? '—'}</td>
                    <td>
                      <StatusBadge status={event.status} />
                    </td>
                    <td className="row-actions">
                      {can('events.edit') && (
                        <button
                          className="link-button"
                          type="button"
                          onClick={() => open(event)}
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

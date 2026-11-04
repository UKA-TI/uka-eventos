import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  eventDetailResponseSchema,
  eventDuplicateSchema,
  type EventDetail,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice, StatusBadge } from '../components/ui.js';
import { dateTimeInZoneToIso } from './dates.js';
import { EventCheckinTab } from './EventCheckinTab.js';
import { EventFormFieldsTab } from './EventFormFieldsTab.js';
import { EventGeneralForm } from './EventGeneralForm.js';
import { EventModulesTab } from './EventModulesTab.js';
import { EventRegistrationsTab } from './EventRegistrationsTab.js';
import { EventSummaryTab } from './EventSummaryTab.js';
import { EventTicketsTab } from './EventTicketsTab.js';
import { formatEventDate, issuesToErrors, slugify } from './text.js';

const tabs = [
  ['resumen', 'Resumen'],
  ['registros', 'Registros'],
  ['checkin', 'Check-in'],
  ['boletos', 'Boletos'],
  ['formulario', 'Formulario'],
  ['modulos', 'Módulos'],
] as const;

type Tab = (typeof tabs)[number][0];

function NewEditionForm({
  event,
  onCancel,
}: {
  event: EventDetail;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { csrfToken } = usePermissions();
  const nextYear = event.editionYear + 1;
  const defaultName = event.name.includes(String(event.editionYear))
    ? event.name.replace(String(event.editionYear), String(nextYear))
    : `${event.name} ${nextYear}`;
  const [form, setForm] = useState({
    name: defaultName,
    slug: slugify(defaultName),
    editionYear: String(nextYear),
    startsAt: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: async (input: unknown) =>
      eventDetailResponseSchema.parse(
        await apiRequest(
          `/api/events/${event.id}/duplicate`,
          jsonRequest('POST', input, csrfToken),
        ),
      ),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      await queryClient.invalidateQueries({ queryKey: ['series'] });
      onCancel();
      navigate(`/eventos/${saved.id}`);
    },
  });

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const parsed = eventDuplicateSchema.safeParse({
      name: form.name,
      slug: form.slug,
      editionYear: Number(form.editionYear),
      startsAt: form.startsAt
        ? dateTimeInZoneToIso(form.startsAt, event.timeZone)
        : null,
      endsAt: null,
    });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <form className="panel" onSubmit={submit} noValidate>
      <div className="panel-heading">
        <h2>Nueva edición de {event.series.name}</h2>
      </div>
      <p className="muted form-note">
        Copia la configuración, los boletos y el formulario. No copia registros
        ni asistentes, y queda como borrador.
      </p>
      {create.isError && (
        <Notice>{errorText(create.error, 'No se pudo crear.')}</Notice>
      )}
      <div className="form-grid">
        <Field label="Nombre" error={errors.name}>
          <input
            value={form.name}
            onChange={(e) =>
              setForm({
                ...form,
                name: e.target.value,
                slug: slugify(e.target.value),
              })
            }
          />
        </Field>
        <Field label="Dirección pública" error={errors.slug}>
          <input
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
          />
        </Field>
        <Field label="Año de la edición" error={errors.editionYear}>
          <input
            type="number"
            value={form.editionYear}
            onChange={(e) => setForm({ ...form, editionYear: e.target.value })}
          />
        </Field>
        <Field label="Inicio" error={errors.startsAt}>
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          />
        </Field>
      </div>
      <div className="form-actions">
        <button
          className="button primary"
          type="submit"
          disabled={create.isPending}
        >
          {create.isPending ? 'Creando…' : 'Crear edición'}
        </button>
        <button className="button secondary" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function EventDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    // Otras pantallas pueden enlazar directo a una pestaña.
    const requested = searchParams.get('tab');
    return tabs.find(([value]) => value === requested)?.[0] ?? 'resumen';
  });
  const [editing, setEditing] = useState(false);
  const [newEdition, setNewEdition] = useState(false);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();
  const key = ['event', id];

  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      eventDetailResponseSchema.parse(await apiRequest(`/api/events/${id}`)),
  });

  const refresh = async (saved?: EventDetail) => {
    if (saved) {
      queryClient.setQueryData(key, saved);
    } else {
      await queryClient.invalidateQueries({ queryKey: key });
    }
    await queryClient.invalidateQueries({ queryKey: ['events'] });
    await queryClient.invalidateQueries({ queryKey: ['series'] });
  };

  const changeStatus = useMutation({
    mutationFn: async (status: string) =>
      eventDetailResponseSchema.parse(
        await apiRequest(
          `/api/events/${id}/status`,
          jsonRequest('POST', { status }, csrfToken),
        ),
      ),
    onSuccess: async (saved) => {
      await refresh(saved);
      setNotice({ kind: 'ok', text: 'Estado actualizado.' });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo cambiar el estado.'),
      }),
  });

  const remove = useMutation({
    mutationFn: async () =>
      apiRequest(
        `/api/events/${id}`,
        jsonRequest('DELETE', undefined, csrfToken),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      await queryClient.invalidateQueries({ queryKey: ['series'] });
      navigate('/eventos', { replace: true });
    },
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo eliminar el evento.'),
      }),
  });

  if (query.isPending) {
    return <Loading />;
  }
  if (query.isError) {
    return (
      <div className="panel">
        <Notice>{query.error.message}</Notice>
        <Link to="/eventos">Volver a eventos</Link>
      </div>
    );
  }

  const event = query.data;
  const canEdit = can('events.edit');
  const setStatus = (status: string) => {
    setNotice(undefined);
    changeStatus.mutate(status);
  };

  return (
    <section>
      <Link className="back-link" to="/eventos">
        Eventos
      </Link>
      <div className="page-heading">
        <div>
          <h1>{event.name}</h1>
          <p className="muted">
            {event.series.name} · {event.series.type} · Edición{' '}
            {event.editionYear}
          </p>
          <p className="muted">
            {formatEventDate(event.startsAt, event.timeZone, true)}
            {event.venue ? ` · ${event.venue}` : ''}
          </p>
        </div>
        <div className="heading-actions">
          <StatusBadge status={event.status} />
          {can('events.create') && (
            <button
              className="button secondary"
              type="button"
              onClick={() => setNewEdition(true)}
            >
              Nueva edición
            </button>
          )}
          {canEdit && event.status !== 'active' && (
            <button
              className="button primary"
              type="button"
              disabled={
                changeStatus.isPending || event.activationIssues.length > 0
              }
              onClick={() => setStatus('active')}
            >
              {event.status === 'closed' ? 'Reabrir' : 'Activar'}
            </button>
          )}
          {canEdit && event.status === 'active' && (
            <button
              className="button secondary"
              type="button"
              disabled={changeStatus.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `¿Cerrar "${event.name}"? Podrás reabrirlo después.`,
                  )
                ) {
                  setStatus('closed');
                }
              }}
            >
              Cerrar evento
            </button>
          )}
          {can('events.delete') && event.status === 'draft' && (
            <button
              className="button secondary danger"
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`¿Eliminar el borrador "${event.name}"?`)) {
                  setNotice(undefined);
                  remove.mutate();
                }
              }}
            >
              Eliminar
            </button>
          )}
        </div>
      </div>

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {canEdit &&
        event.status === 'draft' &&
        event.activationIssues.length > 0 && (
          <div className="checklist" role="status">
            <strong>Para activar este evento falta:</strong>
            <ul>
              {event.activationIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

      {newEdition && (
        <NewEditionForm event={event} onCancel={() => setNewEdition(false)} />
      )}

      <div className="tabs" role="tablist" aria-label="Secciones del evento">
        {tabs
          .filter(
            ([value]) =>
              (value !== 'registros' ||
                can(
                  'registrations.view',
                  'registrations.manage',
                  'payments.manage',
                )) &&
              (value !== 'checkin' || can('checkin.operate', 'checkin.manage')),
          )
          .map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? 'tab active' : 'tab'}
              onClick={() => {
                setTab(value);
                setEditing(false);
              }}
            >
              {label}
              {value === 'boletos' ? ` (${event.ticketTypes.length})` : ''}
              {value === 'formulario' ? ` (${event.formFields.length})` : ''}
            </button>
          ))}
      </div>

      {tab === 'resumen' &&
        (editing ? (
          <EventGeneralForm
            key={event.updatedAt}
            event={event}
            onCancel={() => setEditing(false)}
            onSaved={async (saved) => {
              await refresh(saved);
              setEditing(false);
              setNotice({ kind: 'ok', text: 'Evento actualizado.' });
            }}
          />
        ) : (
          <EventSummaryTab
            event={event}
            onEdit={canEdit ? () => setEditing(true) : undefined}
          />
        ))}
      {tab === 'registros' && (
        <EventRegistrationsTab event={event} onChanged={() => refresh()} />
      )}
      {tab === 'checkin' && <EventCheckinTab event={event} />}
      {tab === 'boletos' && (
        <EventTicketsTab event={event} onChanged={() => refresh()} />
      )}
      {tab === 'formulario' && (
        <EventFormFieldsTab event={event} onChanged={() => refresh()} />
      )}
      {tab === 'modulos' && (
        <EventModulesTab event={event} onSaved={(saved) => refresh(saved)} />
      )}
    </section>
  );
}

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  eventGroupsResponseSchema,
  guestListResponseSchema,
  guestStatusOptions,
  type EventDetail,
} from '@uka/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Loading, Notice } from '../components/ui.js';
import { NameChangeForm } from './OrderFinanceForms.js';

const REFRESH_MS = 30_000;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** Asistentes › Lista de invitados: todo lo que se hace con una persona vive aquí. */
export function EventGuestsTab({ event }: { event: EventDetail }) {
  const queryClient = useQueryClient();
  const { can, csrfToken } = usePermissions();
  const canManage = can('registrations.manage');
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [status, setStatus] = useState('');
  // Desde una compra se llega con sus invitados ya filtrados.
  const [orderId, setOrderId] = useState(
    () => searchParams.get('compra') ?? '',
  );
  const [changing, setChanging] = useState<{
    id: string;
    guestName: string;
  } | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  }>();

  const query = new URLSearchParams({ page: String(page) });
  if (search.trim()) {
    query.set('q', search.trim());
  }
  if (status) {
    query.set('status', status);
  }
  if (orderId) {
    query.set('orderId', orderId);
  }

  const guests = useQuery({
    queryKey: ['event-guests', event.id, query.toString()],
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      guestListResponseSchema.parse(
        await apiRequest(`/api/events/${event.id}/guests?${query.toString()}`),
      ),
  });
  const groups = useQuery({
    queryKey: ['event-groups', event.id],
    queryFn: async () =>
      eventGroupsResponseSchema.parse(
        await apiRequest(`/api/events/${event.id}/groups`),
      ),
  });
  const resend = useMutation({
    mutationFn: async (guest: { id: string; name: string }) =>
      apiRequest(
        `/api/events/${event.id}/orders/registrations/${guest.id}/resend`,
        jsonRequest('POST', undefined, csrfToken),
      ),
    onSuccess: (_result, guest) =>
      setNotice({
        kind: 'ok',
        text: `El pase de ${guest.name} está en la cola de correo.`,
      }),
    onError: (error) =>
      setNotice({
        kind: 'error',
        text: errorText(error, 'No se pudo reenviar el pase.'),
      }),
  });

  if (guests.isPending) {
    return <Loading />;
  }
  if (guests.isError) {
    return <Notice>{guests.error.message}</Notice>;
  }

  const data = guests.data;
  const pages = Math.max(Math.ceil(data.total / data.pageSize), 1);
  const filtered = Boolean(search.trim() || status || orderId);
  const shownFrom = data.total === 0 ? 0 : (page - 1) * data.pageSize + 1;
  const shownTo = Math.min(page * data.pageSize, data.total);
  const groupOption = groups.data?.find((group) => group.id === orderId);

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      {changing && (
        <NameChangeForm
          event={event}
          registration={changing}
          onCancel={() => setChanging(null)}
          onDone={async (text) => {
            await queryClient.invalidateQueries({
              queryKey: ['event-guests', event.id],
            });
            setChanging(null);
            setNotice({ kind: 'ok', text });
          }}
        />
      )}

      <div className="filters">
        <label className="filter-field filter-search">
          <span>Buscar invitado</span>
          <input
            type="search"
            placeholder="Nombre, correo, folio u organización"
            aria-label="Buscar invitado"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="filter-field">
          <span>Estado</span>
          <select
            aria-label="Filtrar por estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos los estados</option>
            {guestStatusOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {orderId && !groupOption ? (
          <span className="filter-chip">
            Invitados de una compra
            <button
              className="link-button"
              type="button"
              onClick={() => {
                setOrderId('');
                setPage(1);
              }}
            >
              Quitar filtro
            </button>
          </span>
        ) : (
          <label className="filter-field">
            <span>Empresa o mesa</span>
            <select
              aria-label="Filtrar por empresa o mesa"
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas las empresas / mesas</option>
              {groups.data?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.company}
                </option>
              ))}
            </select>
          </label>
        )}
        {can('reports.export') && data.allGuests > 0 && (
          <a
            className="button secondary"
            href={`/api/reports/export/events/${event.id}/registrations.csv`}
          >
            Exportar CSV
          </a>
        )}
      </div>

      <div className="panel table-panel attendee-panel">
        <div className="panel-heading">
          <h2>Invitados del evento</h2>
          <span className="result-count">
            {data.total.toLocaleString('es-MX')}{' '}
            {data.total === 1 ? 'resultado' : 'resultados'}
          </span>
        </div>
        {data.guests.length === 0 ? (
          <p className="muted">
            {filtered
              ? 'No hay invitados que coincidan con el filtro.'
              : 'Aún no hay invitados registrados en este evento.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="guests-table attendee-table">
              <thead>
                <tr>
                  <th>Invitado</th>
                  <th>Folio</th>
                  <th>Empresa / mesa</th>
                  <th>Mesa</th>
                  <th>Estado</th>
                  <th>Ingreso</th>
                  {canManage && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {data.guests.map((guest) => {
                  const state = guestStatusOptions.find(
                    (option) => option.key === guest.status,
                  )!;
                  return (
                    <tr key={guest.id}>
                      <td data-label="Invitado" className="attendee-name-cell">
                        <div className="person">
                          <span className="avatar soft" aria-hidden="true">
                            {initials(guest.name)}
                          </span>
                          <span>
                            <strong>{guest.name}</strong>
                            <small className="cell-note">
                              {guest.email ?? guest.organization ?? ''}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td data-label="Folio">
                        <strong className="folio">{guest.folio}</strong>
                      </td>
                      <td data-label="Empresa / mesa">{guest.group ?? '—'}</td>
                      <td data-label="Mesa">{guest.tableName ?? '—'}</td>
                      <td data-label="Estado">
                        <span className={`badge ${state.tone}`}>
                          {state.label}
                        </span>
                      </td>
                      <td data-label="Ingreso">
                        {guest.checkedInAt ? (
                          <div>
                            {new Date(guest.checkedInAt).toLocaleTimeString(
                              'es-MX',
                              { timeZone: event.timeZone, timeStyle: 'short' },
                            )}
                            <small className="cell-note">
                              {[guest.accessPointName, guest.operatorName]
                                .filter(Boolean)
                                .join(' · ')}
                            </small>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      {canManage && (
                        <td data-label="Acciones">
                          <span className="guest-actions">
                            {guest.passUrl && (
                              <a
                                href={guest.passUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Ver pase
                              </a>
                            )}
                            {guest.passUrl && guest.email && (
                              <button
                                className="link-button"
                                type="button"
                                disabled={resend.isPending}
                                onClick={() => {
                                  setNotice(undefined);
                                  resend.mutate(guest);
                                }}
                              >
                                {guest.passPending
                                  ? 'Reenviar invitación'
                                  : 'Reenviar pase'}
                              </button>
                            )}
                            <button
                              className="link-button"
                              type="button"
                              onClick={() => {
                                setNotice(undefined);
                                setChanging({
                                  id: guest.id,
                                  guestName: guest.name,
                                });
                              }}
                            >
                              Cambiar nombre
                            </button>
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="table-foot">
        <span>
          Mostrando {shownFrom.toLocaleString('es-MX')}–
          {shownTo.toLocaleString('es-MX')} de{' '}
          {data.total.toLocaleString('es-MX')}
          {filtered
            ? ` (${data.allGuests.toLocaleString('es-MX')} en total)`
            : ''}
        </span>
        {pages > 1 && (
          <div className="pagination">
            <button
              className="button secondary small"
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page} de {pages}
            </span>
            <button
              className="button secondary small"
              type="button"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </button>
          </div>
        )}
      </div>
    </>
  );
}

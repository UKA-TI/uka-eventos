import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  eventGroupsResponseSchema,
  guestListResponseSchema,
  guestStatusOptions,
  type EventDetail,
} from '@uka/shared';
import { useState } from 'react';
import { apiRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Loading, Notice } from '../components/ui.js';

const REFRESH_MS = 30_000;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function EventGuestsTab({ event }: { event: EventDetail }) {
  const { can } = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [orderId, setOrderId] = useState('');

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

  return (
    <>
      <div className="filters">
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
        {can('reports.export') && data.allGuests > 0 && (
          <a
            className="button secondary"
            href={`/api/reports/export/events/${event.id}/registrations.csv`}
          >
            Exportar CSV
          </a>
        )}
      </div>

      <div className="panel table-panel">
        {data.guests.length === 0 ? (
          <p className="muted">
            {filtered
              ? 'No hay invitados que coincidan con el filtro.'
              : 'Aún no hay invitados registrados en este evento.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="guests-table">
              <thead>
                <tr>
                  <th>Invitado</th>
                  <th>Folio</th>
                  <th>Empresa / mesa</th>
                  <th>Mesa</th>
                  <th>Organización</th>
                  <th>Estado</th>
                  <th>Hora</th>
                  <th>Operador</th>
                </tr>
              </thead>
              <tbody>
                {data.guests.map((guest) => {
                  const state = guestStatusOptions.find(
                    (option) => option.key === guest.status,
                  )!;
                  return (
                    <tr key={guest.id}>
                      <td>
                        <div className="person">
                          <span className="avatar soft" aria-hidden="true">
                            {initials(guest.name)}
                          </span>
                          <span>
                            <strong>{guest.name}</strong>
                            <small className="cell-note">{guest.email}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <strong className="folio">{guest.folio}</strong>
                      </td>
                      <td>{guest.group ?? '—'}</td>
                      <td>{guest.tableName ?? '—'}</td>
                      <td>{guest.organization ?? '—'}</td>
                      <td>
                        <span className={`badge ${state.tone}`}>
                          {state.label}
                        </span>
                      </td>
                      <td>
                        {guest.checkedInAt
                          ? new Date(guest.checkedInAt).toLocaleTimeString(
                              'es-MX',
                              { timeZone: event.timeZone, timeStyle: 'short' },
                            )
                          : '—'}
                      </td>
                      <td>
                        {guest.operatorName ?? '—'}
                        {guest.accessPointName && (
                          <small className="cell-note">
                            {guest.accessPointName}
                          </small>
                        )}
                      </td>
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

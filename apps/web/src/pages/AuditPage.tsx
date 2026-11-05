import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  auditCategories,
  auditListSchema,
  auditOptionsSchema,
} from '@uka/shared';
import { useState } from 'react';
import { apiRequest } from '../api.js';
import { Loading, Notice, PageHeading } from '../components/ui.js';

const emptyFilters = {
  eventId: '',
  userId: '',
  category: '',
  from: '',
  to: '',
};

const formatMoment = (value: string) =>
  new Date(value).toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

export function AuditPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);

  const options = useQuery({
    queryKey: ['audit-options'],
    queryFn: async () =>
      auditOptionsSchema.parse(await apiRequest('/api/audit/options')),
  });
  const list = useQuery({
    queryKey: ['audit', filters, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        }
      });
      return auditListSchema.parse(await apiRequest(`/api/audit?${params}`));
    },
  });

  const update = (key: keyof typeof emptyFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const pages = list.data
    ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize))
    : 1;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <section>
      <PageHeading
        title="Bitácora"
        description="Lo que hizo cada persona en el sistema. No se puede editar ni borrar."
      />
      <div className="filters">
        <select
          aria-label="Evento"
          value={filters.eventId}
          onChange={(e) => update('eventId', e.target.value)}
        >
          <option value="">Todos los eventos</option>
          {options.data?.events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Persona"
          value={filters.userId}
          onChange={(e) => update('userId', e.target.value)}
        >
          <option value="">Todas las personas</option>
          {options.data?.users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label="Área"
          value={filters.category}
          onChange={(e) => update('category', e.target.value)}
        >
          <option value="">Todas las áreas</option>
          {auditCategories.map((category) => (
            <option key={category.key} value={category.key}>
              {category.label}
            </option>
          ))}
        </select>
        <label className="filter-date">
          <span>Desde</span>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => update('from', e.target.value)}
          />
        </label>
        <label className="filter-date">
          <span>Hasta</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => update('to', e.target.value)}
          />
        </label>
        {filtered && (
          <button
            className="link-button"
            type="button"
            onClick={() => {
              setFilters(emptyFilters);
              setPage(1);
            }}
          >
            Quitar filtros
          </button>
        )}
      </div>

      {list.isPending && <Loading />}
      {list.isError && <Notice>{list.error.message}</Notice>}
      {list.data && (
        <div className="panel table-panel">
          {list.data.rows.length === 0 ? (
            <p className="muted">
              {filtered
                ? 'Nada coincide con estos filtros.'
                : 'Aún no hay movimientos.'}
            </p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Acción</th>
                    <th>Persona</th>
                    <th>Fecha</th>
                    <th>Evento</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="cell-wrap">
                        <strong>{row.actionLabel}</strong>
                        {row.detail && (
                          <small className="cell-note">{row.detail}</small>
                        )}
                      </td>
                      <td>{row.userName ?? 'Usuario eliminado'}</td>
                      <td className="nowrap">{formatMoment(row.createdAt)}</td>
                      <td>{row.eventName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
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
    </section>
  );
}

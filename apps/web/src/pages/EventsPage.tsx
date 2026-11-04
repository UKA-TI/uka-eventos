import { useQuery } from '@tanstack/react-query';
import { eventResponseSchema } from '@uka/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { apiRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Loading, Notice, PageHeading, StatusBadge } from '../components/ui.js';
import { formatEventDate } from './text.js';

export function EventsPage() {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');

  const events = useQuery({
    queryKey: ['events'],
    queryFn: async () =>
      z.array(eventResponseSchema).parse(await apiRequest('/api/events')),
  });

  if (events.isPending) {
    return <Loading />;
  }

  const list = events.data ?? [];
  const types = [...new Set(list.map((event) => event.series.type))].sort();
  const years = [...new Set(list.map((event) => event.editionYear))].sort(
    (a, b) => b - a,
  );
  const term = search.trim().toLowerCase();
  const filtered = list.filter(
    (event) =>
      (!term ||
        event.name.toLowerCase().includes(term) ||
        event.series.name.toLowerCase().includes(term) ||
        (event.venue ?? '').toLowerCase().includes(term)) &&
      (!type || event.series.type === type) &&
      (!status || event.status === status) &&
      (!year || event.editionYear === Number(year)),
  );

  return (
    <section>
      <PageHeading
        title="Eventos"
        description="Todas las ediciones de los eventos de Un Kilo de Ayuda."
        action={
          can('events.create') && (
            <button
              className="button primary"
              type="button"
              onClick={() => navigate('/eventos/nuevo')}
            >
              Nuevo evento
            </button>
          )
        }
      />
      {events.isError && <Notice>{events.error.message}</Notice>}

      <div className="filters">
        <input
          type="search"
          placeholder="Buscar por nombre, serie o sede"
          aria-label="Buscar evento"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filtrar por tipo"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">Todos los tipos</option>
          {types.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar por año"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          <option value="">Todos los años</option>
          {years.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar por estado"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="active">Activo</option>
          <option value="closed">Cerrado</option>
        </select>
      </div>

      <div className="panel table-panel">
        {filtered.length === 0 ? (
          <p className="muted">
            {list.length === 0
              ? 'Aún no hay eventos. Crea el primero.'
              : 'Ningún evento coincide con los filtros.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Tipo</th>
                  <th>Edición</th>
                  <th>Fecha</th>
                  <th>Sede</th>
                  <th>Aforo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Link to={`/eventos/${event.id}`}>{event.name}</Link>
                    </td>
                    <td>{event.series.type}</td>
                    <td>{event.editionYear}</td>
                    <td>{formatEventDate(event.startsAt, event.timeZone)}</td>
                    <td>{event.venue ?? '—'}</td>
                    <td>{event.capacity?.toLocaleString('es-MX') ?? '—'}</td>
                    <td>
                      <StatusBadge status={event.status} />
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

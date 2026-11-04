import { useQuery } from '@tanstack/react-query';
import { eventResponseSchema } from '@uka/shared';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { apiRequest } from '../api.js';
import { usePermissions, useSession } from '../auth/session.js';
import { PageHeading, StatusBadge } from '../components/ui.js';

export function HomePage() {
  const session = useSession();
  const { can } = usePermissions();
  const canSeeEvents = can('events.view', 'events.create', 'events.edit');
  const events = useQuery({
    queryKey: ['events'],
    enabled: canSeeEvents,
    queryFn: async () =>
      z.array(eventResponseSchema).parse(await apiRequest('/api/events')),
  });
  const user = session.data?.user;
  const list = events.data ?? [];
  const active = list.filter((event) => event.status === 'active');

  return (
    <section>
      <PageHeading
        title={`Hola, ${user?.displayName ?? ''}`}
        description={`Tu perfil es ${user?.roleName ?? ''}.`}
      />
      {canSeeEvents ? (
        <>
          <div className="stats">
            <article className="stat">
              <span>Eventos activos</span>
              <strong>{events.isPending ? '—' : active.length}</strong>
            </article>
            <article className="stat">
              <span>Eventos visibles</span>
              <strong>{events.isPending ? '—' : list.length}</strong>
            </article>
          </div>
          <div className="panel">
            <div className="panel-heading">
              <h2>Eventos activos</h2>
              <Link to="/eventos">Ver todos</Link>
            </div>
            {active.length === 0 ? (
              <p className="muted">
                {events.isPending
                  ? 'Cargando…'
                  : 'No hay eventos activos por ahora.'}
              </p>
            ) : (
              <ul className="plain-list">
                {active.map((event) => (
                  <li key={event.id}>
                    <span>
                      <Link to={`/eventos/${event.id}`}>{event.name}</Link>
                      <small>
                        {event.startsAt
                          ? new Date(event.startsAt).toLocaleString('es-MX', {
                              timeZone: event.timeZone,
                              dateStyle: 'long',
                              timeStyle: 'short',
                            })
                          : 'Sin fecha'}
                        {event.venue ? ` · ${event.venue}` : ''}
                      </small>
                    </span>
                    <StatusBadge status={event.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="panel">
          <p className="muted">
            Tu perfil todavía no tiene módulos asignados. Pide a un
            administrador que te otorgue los permisos que necesitas.
          </p>
        </div>
      )}
    </section>
  );
}

import { useQuery } from '@tanstack/react-query';
import { eventResponseSchema } from '@uka/shared';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { apiRequest } from '../api.js';
import { usePermissions, useSession } from '../auth/session.js';
import { Icon, type IconName } from '../components/icons.js';
import { PageHeading, StatusBadge } from '../components/ui.js';
import type { PermissionCode } from '@uka/shared';

const quickLinks: {
  to: string;
  icon: IconName;
  title: string;
  text: string;
  any: PermissionCode[];
}[] = [
  {
    to: '/eventos/nuevo',
    icon: 'calendar',
    title: 'Crear evento',
    text: 'Configura boletos, módulos y registro.',
    any: ['events.create'],
  },
  {
    to: '/recepcion',
    icon: 'scan',
    title: 'Abrir recepción',
    text: 'Escanea pases en la entrada.',
    any: ['checkin.operate', 'checkin.manage'],
  },
  {
    to: '/contactos',
    icon: 'contacts',
    title: 'Ver contactos',
    text: 'Historial, notas y segmentos.',
    any: ['contacts.view', 'contacts.manage'],
  },
  {
    to: '/comunicaciones/nueva',
    icon: 'mail',
    title: 'Escribir una invitación',
    text: 'Prepara un envío a un segmento.',
    any: ['communications.manage'],
  },
];

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
  const links = quickLinks.filter((link) => can(...link.any));

  return (
    <section>
      <PageHeading
        title={`Hola, ${user?.displayName ?? ''}`}
        description={`Perfil: ${user?.roleName ?? ''}`}
      />
      {links.length > 0 && (
        <nav className="quick-links" aria-label="Accesos rápidos">
          {links.map((link) => (
            <Link key={link.to} className="quick-link" to={link.to}>
              <Icon name={link.icon} />
              <span>
                {link.title}
                <small>{link.text}</small>
              </span>
            </Link>
          ))}
        </nav>
      )}
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

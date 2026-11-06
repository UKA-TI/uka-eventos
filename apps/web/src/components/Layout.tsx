import { logoUrl } from '../brand.js';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions, useSession } from '../auth/session.js';
import { checkinStore } from '../checkin/store.js';
import { Icon, type IconName } from './icons.js';
import { Loading, Notice } from './ui.js';
import { PageNavigationContext } from './page-navigation.js';
import { ModuleNavigation } from './ModuleNavigation.js';

const sectionRouteIcons: Record<string, IconName> = {
  '/eventos': 'calendar',
  '/series': 'layers',
  '/contactos': 'contacts',
  '/empresas': 'building',
  '/segmentos': 'filter',
  '/usuarios': 'users',
  '/perfiles': 'shield',
  '/bitacora': 'list',
  '/consentimientos': 'badge',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** Valida la sesión antes de mostrar el CRM. Recepción usa Shell directamente. */
export function Layout() {
  const session = useSession();
  if (session.isPending) {
    return <Loading />;
  }
  if (!session.data?.user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/** Menú principal y marco de la aplicación, para quien ya tiene una sesión. */
export function Shell({
  children,
  bare = false,
}: {
  children: ReactNode;
  /** Sin márgenes: para pantallas que usan todo el espacio, como el escáner. */
  bare?: boolean;
}) {
  const session = useSession();
  const { can, csrfToken } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const user = session.data?.user;

  if (!user) {
    return null;
  }

  const logout = async () => {
    const pending = checkinStore.pendingCount();
    if (
      pending > 0 &&
      !window.confirm(
        `Este dispositivo tiene ${pending} lecturas de recepción sin enviar y se perderán al cerrar sesión. ¿Salir de todos modos?`,
      )
    ) {
      return;
    }
    try {
      await apiRequest(
        '/api/auth/logout',
        jsonRequest('POST', undefined, csrfToken),
      );
      checkinStore.clear();
      queryClient.clear();
      navigate('/login', { replace: true });
    } catch (error) {
      setNotice(errorText(error, 'No se pudo cerrar sesión.'));
    }
  };

  const closeMenu = () => setMenuOpen(false);

  // El menú se organiza por tarea. Lo que es parte de la misma tarea (eventos y series,
  // contactos y empresas) comparte una entrada con pestañas, para que haya menos opciones.
  const route = (to: string, label: string, allowed: boolean) => ({
    to,
    label,
    allowed,
  });
  const canEvents = can('events.view', 'events.create', 'events.edit');
  const canContacts = can('contacts.view', 'contacts.manage');
  const canComms = can(
    'communications.view',
    'communications.manage',
    'communications.send',
  );
  const allSections: {
    heading: string | null;
    items: {
      label: string;
      icon: IconName;
      routes: { to: string; label: string; allowed: boolean }[];
    }[];
  }[] = [
    {
      heading: null,
      items: [
        { label: 'Inicio', icon: 'home', routes: [route('/', 'Inicio', true)] },
      ],
    },
    {
      heading: 'Eventos',
      items: [
        {
          label: 'Eventos',
          icon: 'calendar',
          routes: [
            route('/eventos', 'Eventos', canEvents),
            route('/series', 'Series de eventos', canEvents),
          ],
        },
        {
          label: 'Recepción',
          icon: 'scan',
          routes: [
            route(
              '/recepcion',
              'Recepción',
              can('checkin.operate', 'checkin.manage'),
            ),
          ],
        },
      ],
    },
    {
      heading: 'Donantes y contactos',
      items: [
        {
          label: 'Contactos',
          icon: 'contacts',
          routes: [
            route('/contactos', 'Personas', canContacts),
            route('/empresas', 'Empresas', canContacts),
            route('/segmentos', 'Segmentos', canContacts || canComms),
          ],
        },
        {
          label: 'Comunicaciones',
          icon: 'mail',
          routes: [route('/comunicaciones', 'Comunicaciones', canComms)],
        },
        {
          label: 'Donativos',
          icon: 'heart',
          routes: [
            route(
              '/donativos',
              'Donativos',
              can('donations.view', 'donations.manage'),
            ),
          ],
        },
      ],
    },
    {
      heading: 'Dinero y resultados',
      items: [
        {
          label: 'Cobranza',
          icon: 'wallet',
          routes: [
            route(
              '/cobranza',
              'Cobranza',
              can('finance.view', 'finance.manage'),
            ),
          ],
        },
        {
          label: 'Reportes',
          icon: 'chart',
          routes: [
            route(
              '/reportes',
              'Reportes',
              can('reports.view', 'reports.export'),
            ),
          ],
        },
      ],
    },
    {
      heading: 'Administración',
      items: [
        {
          label: 'Usuarios y permisos',
          icon: 'users',
          routes: [
            route('/usuarios', 'Usuarios', can('users.view', 'users.manage')),
            route(
              '/perfiles',
              'Perfiles y permisos',
              can('roles.view', 'roles.manage'),
            ),
          ],
        },
        {
          label: 'Control y privacidad',
          icon: 'shield',
          routes: [
            route('/bitacora', 'Bitácora', can('audit.view')),
            route('/consentimientos', 'Consentimientos', can('consents.view')),
          ],
        },
      ],
    },
  ];
  const sections = allSections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => ({
          ...item,
          routes: item.routes.filter((entry) => entry.allowed),
        }))
        .filter((item) => item.routes.length > 0),
    }))
    .filter((section) => section.items.length > 0);
  const path = location.pathname;
  const isInItem = (item: (typeof sections)[number]['items'][number]) =>
    item.routes.some((entry) =>
      entry.to === '/'
        ? path === '/'
        : path === entry.to || path.startsWith(`${entry.to}/`),
    );
  // Las pestañas de la tarea solo en sus pantallas principales, no en un detalle.
  const sectionTabs = sections
    .flatMap((section) => section.items)
    .find(
      (item) =>
        item.routes.length > 1 &&
        item.routes.some((entry) => entry.to === path),
    );

  return (
    <div className="shell">
      <aside
        id="main-sidebar"
        className={menuOpen ? 'sidebar open' : 'sidebar'}
      >
        <div className="brand">
          <div className="mobile-brand">
            <img src={logoUrl} alt="Un Kilo de Ayuda" />
            <div className="mobile-brand-name">
              <strong>
                Eventos <span>UKA</span>
              </strong>
              <small>Un Kilo de Ayuda</small>
            </div>
          </div>
          <button
            className="mobile-menu-toggle sidebar-close"
            type="button"
            aria-label="Cerrar menú principal"
            onClick={closeMenu}
          >
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label="Navegación principal" onClick={closeMenu}>
          {sections.map((section) => (
            <div key={section.heading ?? 'inicio'} className="nav-section">
              {section.heading && (
                <small className="nav-heading">{section.heading}</small>
              )}
              {section.items.map((item) => (
                <NavLink
                  key={item.label}
                  className={() =>
                    isInItem(item) ? 'nav-link active' : 'nav-link'
                  }
                  end={item.routes[0]!.to === '/'}
                  to={item.routes[0]!.to}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="avatar" aria-hidden="true">
            {initials(user.displayName)}
          </div>
          <div>
            <strong>{user.displayName}</strong>
            <small>{user.roleName}</small>
          </div>
          <button className="link-button" type="button" onClick={logout}>
            Salir
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="mobile-bar">
          <button
            className="mobile-menu-toggle"
            type="button"
            aria-label={
              menuOpen ? 'Cerrar menú principal' : 'Abrir menú principal'
            }
            aria-controls="main-sidebar"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
          </button>
          <div className="mobile-brand">
            <img src={logoUrl} alt="Un Kilo de Ayuda" />
            <div className="mobile-brand-name">
              <strong>
                Eventos <span>UKA</span>
              </strong>
              <small>Un Kilo de Ayuda</small>
            </div>
          </div>
        </header>
        <main className={bare ? 'content-bare' : 'content'}>
          <Notice>{notice}</Notice>
          <PageNavigationContext.Provider
            value={
              sectionTabs && (
                <ModuleNavigation
                  label={sectionTabs.label}
                  current={path}
                  items={sectionTabs.routes.map(
                    (entry) => [entry.to, entry.label] as const,
                  )}
                  onSelect={(value) => navigate(value)}
                >
                  <nav
                    className="tabs section-tabs"
                    aria-label={sectionTabs.label}
                  >
                    {sectionTabs.routes.map((entry) => (
                      <NavLink
                        key={entry.to}
                        to={entry.to}
                        end
                        className={({ isActive }) =>
                          isActive ? 'tab active' : 'tab'
                        }
                      >
                        <Icon
                          name={sectionRouteIcons[entry.to] ?? sectionTabs.icon}
                        />
                        {entry.label}
                      </NavLink>
                    ))}
                  </nav>
                </ModuleNavigation>
              )
            }
          >
            {children}
          </PageNavigationContext.Provider>
        </main>
      </div>
    </div>
  );
}

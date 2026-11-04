import { logoUrl } from '../brand.js';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions, useSession } from '../auth/session.js';
import { checkinStore } from '../checkin/store.js';
import { Icon } from './icons.js';
import { Loading, Notice } from './ui.js';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link active' : 'nav-link';

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

  return (
    <div className="shell">
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <img src={logoUrl} alt="Un Kilo de Ayuda" />
          <strong>
            EVENTOS
            <br />
            UKA
          </strong>
        </div>
        <nav aria-label="Navegación principal" onClick={closeMenu}>
          <NavLink className={linkClass} end to="/">
            <Icon name="home" />
            Inicio
          </NavLink>
          {can('events.view', 'events.create', 'events.edit') && (
            <NavLink className={linkClass} to="/eventos">
              <Icon name="calendar" />
              Eventos
            </NavLink>
          )}
          {can('events.view', 'events.create', 'events.edit') && (
            <NavLink className={linkClass} to="/series">
              <Icon name="layers" />
              Series
            </NavLink>
          )}
          {can('reports.view', 'reports.export') && (
            <NavLink className={linkClass} to="/reportes">
              <Icon name="chart" />
              Reportes
            </NavLink>
          )}
          {can('checkin.operate', 'checkin.manage') && (
            <NavLink className={linkClass} to="/recepcion">
              <Icon name="scan" />
              Recepción
            </NavLink>
          )}
          {(can('contacts.view', 'contacts.manage') ||
            can(
              'communications.view',
              'communications.manage',
              'communications.send',
            ) ||
            can('donations.view', 'donations.manage')) && (
            <small className="nav-heading">CRM</small>
          )}
          {can('contacts.view', 'contacts.manage') && (
            <NavLink className={linkClass} to="/contactos">
              <Icon name="contacts" />
              Contactos
            </NavLink>
          )}
          {can('contacts.view', 'contacts.manage') && (
            <NavLink className={linkClass} to="/empresas">
              <Icon name="building" />
              Empresas
            </NavLink>
          )}
          {can(
            'contacts.view',
            'contacts.manage',
            'communications.view',
            'communications.manage',
            'communications.send',
          ) && (
            <NavLink className={linkClass} to="/segmentos">
              <Icon name="filter" />
              Segmentos
            </NavLink>
          )}
          {can(
            'communications.view',
            'communications.manage',
            'communications.send',
          ) && (
            <NavLink className={linkClass} to="/comunicaciones">
              <Icon name="mail" />
              Comunicaciones
            </NavLink>
          )}
          {can('donations.view', 'donations.manage') && (
            <NavLink className={linkClass} to="/donativos">
              <Icon name="heart" />
              Donativos
            </NavLink>
          )}
          {(can('users.view', 'users.manage') ||
            can('roles.view', 'roles.manage')) && (
            <small className="nav-heading">Administración</small>
          )}
          {can('users.view', 'users.manage') && (
            <NavLink className={linkClass} to="/usuarios">
              <Icon name="users" />
              Usuarios
            </NavLink>
          )}
          {can('roles.view', 'roles.manage') && (
            <NavLink className={linkClass} to="/perfiles">
              <Icon name="shield" />
              Perfiles y permisos
            </NavLink>
          )}
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
          <strong>EVENTOS UKA</strong>
          <button
            className="button secondary small"
            type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            Menú
          </button>
        </header>
        <main className={bare ? 'content-bare' : 'content'}>
          <Notice>{notice}</Notice>
          {children}
        </main>
      </div>
    </div>
  );
}

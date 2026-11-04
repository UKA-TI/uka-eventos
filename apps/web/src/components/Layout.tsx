import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions, useSession } from '../auth/session.js';
import { Loading, Notice } from './ui.js';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link active' : 'nav-link';

export function Layout() {
  const session = useSession();
  const { can, csrfToken } = usePermissions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const user = session.data?.user;

  if (session.isPending) {
    return <Loading />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const logout = async () => {
    try {
      await apiRequest(
        '/api/auth/logout',
        jsonRequest('POST', undefined, csrfToken),
      );
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
          <img src="/img/logo_uka.png" alt="Un Kilo de Ayuda" />
          <strong>EVENTOS UKA</strong>
        </div>
        <nav aria-label="Navegación principal" onClick={closeMenu}>
          <NavLink className={linkClass} end to="/">
            Inicio
          </NavLink>
          {can('events.view', 'events.create', 'events.edit') && (
            <NavLink className={linkClass} to="/eventos">
              Eventos
            </NavLink>
          )}
          {(can('users.view', 'users.manage') ||
            can('roles.view', 'roles.manage')) && (
            <small className="nav-heading">Administración</small>
          )}
          {can('users.view', 'users.manage') && (
            <NavLink className={linkClass} to="/usuarios">
              Usuarios
            </NavLink>
          )}
          {can('roles.view', 'roles.manage') && (
            <NavLink className={linkClass} to="/perfiles">
              Perfiles y permisos
            </NavLink>
          )}
        </nav>
        <div className="sidebar-user">
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
        <main className="content">
          <Notice>{notice}</Notice>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

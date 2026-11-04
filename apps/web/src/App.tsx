import type { PermissionCode } from '@uka/shared';
import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { usePermissions, useSession } from './auth/session.js';
import { Layout } from './components/Layout.js';
import { Loading } from './components/ui.js';
import {
  ReceptionHomePage,
  ReceptionStationPage,
} from './pages/checkin/ReceptionPage.js';
import { EventDetailPage } from './pages/EventDetailPage.js';
import { EventsPage } from './pages/EventsPage.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NewEventPage } from './pages/NewEventPage.js';
import { GroupPage } from './pages/public/GroupPage.js';
import { PassPage } from './pages/public/PassPage.js';
import { PublicRegisterPage } from './pages/public/PublicRegisterPage.js';
import { RolesPage } from './pages/RolesPage.js';
import { SeriesPage } from './pages/SeriesPage.js';
import { UsersPage } from './pages/UsersPage.js';

function Guard({
  any,
  children,
}: {
  any: PermissionCode[];
  children: ReactNode;
}) {
  const session = useSession();
  const { can } = usePermissions();
  if (session.isPending) {
    return <Loading />;
  }
  return can(...any) ? children : <Navigate to="/" replace />;
}

function NotFound() {
  return (
    <div className="panel">
      <h1>Página no encontrada</h1>
      <p className="muted">La dirección que abriste no existe.</p>
      <Link to="/">Volver al inicio</Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/recepcion" element={<ReceptionHomePage />} />
      <Route path="/recepcion/:eventId" element={<ReceptionStationPage />} />
      <Route path="/r/:slug" element={<PublicRegisterPage />} />
      <Route path="/pase/:token" element={<PassPage />} />
      <Route path="/mesa/:token" element={<GroupPage />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route
          path="eventos"
          element={
            <Guard any={['events.view', 'events.create', 'events.edit']}>
              <EventsPage />
            </Guard>
          }
        />
        <Route
          path="eventos/nuevo"
          element={
            <Guard any={['events.create']}>
              <NewEventPage />
            </Guard>
          }
        />
        <Route
          path="eventos/:id"
          element={
            <Guard any={['events.view', 'events.create', 'events.edit']}>
              <EventDetailPage />
            </Guard>
          }
        />
        <Route
          path="series"
          element={
            <Guard any={['events.view', 'events.create', 'events.edit']}>
              <SeriesPage />
            </Guard>
          }
        />
        <Route
          path="usuarios"
          element={
            <Guard any={['users.view', 'users.manage']}>
              <UsersPage />
            </Guard>
          }
        />
        <Route
          path="perfiles"
          element={
            <Guard any={['roles.view', 'roles.manage']}>
              <RolesPage />
            </Guard>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

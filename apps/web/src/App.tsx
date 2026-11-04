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
import { CampaignPage } from './pages/crm/CampaignPage.js';
import { CommunicationsPage } from './pages/crm/CommunicationsPage.js';
import { CompaniesPage } from './pages/crm/CompaniesPage.js';
import { ContactDetailPage } from './pages/crm/ContactDetailPage.js';
import { ContactsPage } from './pages/crm/ContactsPage.js';
import { DonationsPage } from './pages/crm/DonationsPage.js';
import { SegmentsPage } from './pages/crm/SegmentsPage.js';
import { EventDetailPage } from './pages/EventDetailPage.js';
import { EventsPage } from './pages/EventsPage.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { NewEventPage } from './pages/NewEventPage.js';
import { GroupPage } from './pages/public/GroupPage.js';
import { PassPage } from './pages/public/PassPage.js';
import { PublicRegisterPage } from './pages/public/PublicRegisterPage.js';
import { RecoverPassPage } from './pages/public/RecoverPassPage.js';
import { UnsubscribePage } from './pages/public/UnsubscribePage.js';
import { ReportsPage } from './pages/reports/ReportsPage.js';
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
      <Route path="/baja/:token" element={<UnsubscribePage />} />
      <Route path="/recuperar/:slug" element={<RecoverPassPage />} />
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
          path="reportes"
          element={
            <Guard any={['reports.view', 'reports.export']}>
              <ReportsPage />
            </Guard>
          }
        />
        <Route
          path="contactos"
          element={
            <Guard any={['contacts.view', 'contacts.manage']}>
              <ContactsPage />
            </Guard>
          }
        />
        <Route
          path="contactos/:id"
          element={
            <Guard any={['contacts.view', 'contacts.manage']}>
              <ContactDetailPage />
            </Guard>
          }
        />
        <Route
          path="empresas"
          element={
            <Guard any={['contacts.view', 'contacts.manage']}>
              <CompaniesPage />
            </Guard>
          }
        />
        <Route
          path="segmentos"
          element={
            <Guard
              any={[
                'contacts.view',
                'contacts.manage',
                'communications.view',
                'communications.manage',
                'communications.send',
              ]}
            >
              <SegmentsPage />
            </Guard>
          }
        />
        <Route
          path="comunicaciones"
          element={
            <Guard
              any={[
                'communications.view',
                'communications.manage',
                'communications.send',
              ]}
            >
              <CommunicationsPage />
            </Guard>
          }
        />
        <Route
          path="comunicaciones/nueva"
          element={
            <Guard any={['communications.manage']}>
              <CampaignPage />
            </Guard>
          }
        />
        <Route
          path="comunicaciones/:id"
          element={
            <Guard
              any={[
                'communications.view',
                'communications.manage',
                'communications.send',
              ]}
            >
              <CampaignPage />
            </Guard>
          }
        />
        <Route
          path="donativos"
          element={
            <Guard any={['donations.view', 'donations.manage']}>
              <DonationsPage />
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

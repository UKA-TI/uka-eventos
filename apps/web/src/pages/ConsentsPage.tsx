import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  consentEventsSchema,
  consentMarketingListSchema,
  consentNoticeListSchema,
} from '@uka/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Loading, Notice, PageHeading } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { ModuleNavigation } from '../components/ModuleNavigation.js';

const consentSections = [
  ['notices', 'Aviso de privacidad'],
  ['marketing', 'Comunicaciones'],
] as const;

type View = 'notices' | 'marketing';

const purposes: Record<string, string> = {
  event_registration: 'Registro al evento',
};

const sources: Record<string, string> = {
  registration: 'Formulario de registro',
  activation: 'Activación del pase',
  staff: 'Capturado por el equipo',
  link: 'Liga de baja del correo',
};

const marketingStates = {
  granted: ['Autorizó', 'ok'],
  opted_out: ['Se dio de baja', 'bad'],
  none: ['Sin autorización', 'neutral'],
} as const;

const formatDay = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

function Pager({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (next: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) {
    return null;
  }
  return (
    <div className="pagination">
      <button
        className="button secondary small"
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
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
        onClick={() => onChange(page + 1)}
      >
        Siguiente
      </button>
    </div>
  );
}

function NoticesView() {
  const [q, setQ] = useState('');
  const [eventId, setEventId] = useState('');
  const [page, setPage] = useState(1);
  const events = useQuery({
    queryKey: ['consent-events'],
    queryFn: async () =>
      consentEventsSchema.parse(await apiRequest('/api/consents/events')),
  });
  const list = useQuery({
    queryKey: ['consents', 'notices', q, eventId, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) });
      if (q.trim()) {
        params.set('q', q.trim());
      }
      if (eventId) {
        params.set('eventId', eventId);
      }
      return consentNoticeListSchema.parse(
        await apiRequest(`/api/consents/notices?${params}`),
      );
    },
  });

  return (
    <>
      {list.data && (
        <div className="stats">
          <article className="stat">
            <span>Aceptaron el aviso</span>
            <strong>{list.data.accepted.toLocaleString('es-MX')}</strong>
          </article>
          <article className="stat">
            <span>Pases por activar</span>
            <strong>{list.data.pending.toLocaleString('es-MX')}</strong>
          </article>
        </div>
      )}
      <div className="filters">
        <label className="filter-field filter-search">
          <span>Buscar por nombre, correo o folio</span>
          <input
            type="search"
            aria-label="Buscar por nombre, correo o folio"
            placeholder="Nombre, correo o folio"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {events.data && (
          <label className="filter-field">
            <span>Evento</span>
            <select
              aria-label="Evento"
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos los eventos</option>
              {events.data.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {list.isPending && <Loading />}
      {list.isError && <Notice>{list.error.message}</Notice>}
      {list.data && (
        <div className="panel table-panel">
          {list.data.rows.length === 0 ? (
            <p className="muted">Sin aceptaciones que mostrar.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Evento</th>
                    <th>Finalidad</th>
                    <th>Aceptó</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.guestName}</strong>
                        {row.email && (
                          <small className="cell-note">{row.email}</small>
                        )}
                      </td>
                      <td>
                        {row.eventName}
                        <small className="cell-note">Folio {row.folio}</small>
                      </td>
                      <td>
                        {purposes[row.purpose] ?? row.purpose}
                        <small className="cell-note">
                          Aviso versión {row.noticeVersion}
                        </small>
                      </td>
                      <td className="nowrap">{formatDay(row.consentedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {list.data && (
        <Pager
          page={page}
          total={list.data.total}
          pageSize={list.data.pageSize}
          onChange={setPage}
        />
      )}
    </>
  );
}

function MarketingView() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { can } = usePermissions();
  const canOpenContact = can('contacts.view', 'contacts.manage');

  const list = useQuery({
    queryKey: ['consents', 'marketing', q, status, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) });
      if (q.trim()) {
        params.set('q', q.trim());
      }
      if (status) {
        params.set('status', status);
      }
      return consentMarketingListSchema.parse(
        await apiRequest(`/api/consents/marketing?${params}`),
      );
    },
  });

  return (
    <>
      {list.data && (
        <div className="stats">
          <article className="stat">
            <span>Autorizaron</span>
            <strong>{list.data.granted.toLocaleString('es-MX')}</strong>
          </article>
          <article className="stat">
            <span>Se dieron de baja</span>
            <strong>{list.data.optedOut.toLocaleString('es-MX')}</strong>
          </article>
          <article className="stat">
            <span>Sin autorización</span>
            <strong>{list.data.none.toLocaleString('es-MX')}</strong>
          </article>
        </div>
      )}
      <div className="filters">
        <label className="filter-field filter-search">
          <span>Buscar por nombre o correo</span>
          <input
            type="search"
            aria-label="Buscar por nombre o correo"
            placeholder="Nombre o correo"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="filter-field">
          <span>Estado</span>
          <select
            aria-label="Estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos los estados</option>
            {Object.entries(marketingStates).map(([value, [label]]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isPending && <Loading />}
      {list.isError && <Notice>{list.error.message}</Notice>}
      {list.data && (
        <div className="panel table-panel">
          {list.data.rows.length === 0 ? (
            <p className="muted">Sin contactos que mostrar.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Estado</th>
                    <th>Fecha</th>
                    <th>Origen</th>
                    <th>Versión del aviso</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((row) => {
                    const [label, tone] = marketingStates[row.status];
                    return (
                      <tr key={row.contactId}>
                        <td>
                          {canOpenContact ? (
                            <Link to={`/contactos/${row.contactId}`}>
                              <strong>{row.name}</strong>
                            </Link>
                          ) : (
                            <strong>{row.name}</strong>
                          )}
                          {row.email && (
                            <small className="cell-note">{row.email}</small>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${tone}`}>{label}</span>
                        </td>
                        <td className="nowrap">{formatDay(row.at)}</td>
                        <td>
                          {row.source
                            ? (sources[row.source] ?? row.source)
                            : '—'}
                        </td>
                        <td>{row.noticeVersion ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {list.data && (
        <Pager
          page={page}
          total={list.data.total}
          pageSize={list.data.pageSize}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function ConsentsPage() {
  const [view, setView] = useState<View>('notices');
  return (
    <section>
      <PageHeading
        title="Consentimientos"
        description="Quién aceptó qué, cuándo y con qué versión del aviso de privacidad."
      />
      <ModuleNavigation
        label="Consentimientos"
        current={view}
        items={consentSections}
        onSelect={(value) => setView(value)}
      >
        <div className="tabs" role="tablist">
          {consentSections.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              className={view === value ? 'tab active' : 'tab'}
              onClick={() => setView(value)}
            >
              <Icon name={value === 'notices' ? 'shield' : 'mail'} />
              {label}
            </button>
          ))}
        </div>
      </ModuleNavigation>
      {view === 'notices' ? <NoticesView /> : <MarketingView />}
    </section>
  );
}

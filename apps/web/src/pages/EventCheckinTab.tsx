import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  accessPointInputSchema,
  checkinOverviewSchema,
  incidentListSchema,
  incidentResolveSchema,
  type EventDetail,
} from '@uka/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../api.js';
import { usePermissions } from '../auth/session.js';
import { Field, Loading, Notice } from '../components/ui.js';
import { AuthorizedGuestForm } from './AuthorizedGuestForm.js';
import { issuesToErrors } from './text.js';

const REFRESH_MS = 15_000;

const incidentTypes: Record<string, string> = {
  duplicate: 'Pase repetido',
  revoked: 'Pase revocado',
  unknown: 'Código desconocido',
  manual: 'Reporte de recepción',
};

type NoticeState = { kind: 'ok' | 'error'; text: string };

function useCheckinOverview(event: EventDetail) {
  return useQuery({
    queryKey: ['checkin', event.id],
    refetchInterval: REFRESH_MS,
    queryFn: async () =>
      checkinOverviewSchema.parse(
        await apiRequest(`/api/events/${event.id}/checkin/overview`),
      ),
  });
}

function useCheckinAction(
  event: EventDetail,
  onSuccess: (text: string) => void,
  onError: (text: string) => void,
) {
  const queryClient = useQueryClient();
  const { csrfToken } = usePermissions();
  return useMutation({
    mutationFn: async (action: {
      path: string;
      method: 'POST' | 'PUT' | 'DELETE';
      body?: unknown;
      success: string;
    }) => {
      await apiRequest(
        `/api/events/${event.id}/checkin/${action.path}`,
        jsonRequest(action.method, action.body, csrfToken),
      );
      return action.success;
    },
    onSuccess: async (success) => {
      await queryClient.invalidateQueries({ queryKey: ['checkin', event.id] });
      await queryClient.invalidateQueries({
        queryKey: ['incidents', event.id],
      });
      onSuccess(success);
    },
    onError: (error) =>
      onError(errorText(error, 'No se pudo completar la acción.')),
  });
}

/** Configuración › Puntos de acceso: las puertas o filas se preparan antes del evento. */
export function EventAccessPointsTab({ event }: { event: EventDetail }) {
  const { can } = usePermissions();
  const canManage = can('checkin.manage');
  const [doorName, setDoorName] = useState('');
  const [doorErrors, setDoorErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<NoticeState>();
  const overview = useCheckinOverview(event);
  const act = useCheckinAction(
    event,
    (text) => {
      setNotice({ kind: 'ok', text });
      setDoorName('');
    },
    (text) => setNotice({ kind: 'error', text }),
  );

  if (overview.isPending) {
    return <Loading />;
  }
  if (overview.isError) {
    return <Notice>{overview.error.message}</Notice>;
  }

  const addDoor = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setNotice(undefined);
    const parsed = accessPointInputSchema.safeParse({
      name: doorName,
      active: true,
    });
    if (!parsed.success) {
      setDoorErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setDoorErrors({});
    act.mutate({
      path: 'access-points',
      method: 'POST',
      body: parsed.data,
      success: 'Punto de acceso agregado.',
    });
  };

  const points = overview.data.accessPoints;

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Puntos de acceso</h2>
            <p className="muted">
              Cada puerta o fila por donde entra la gente. Recepción elige el
              suyo al abrir el escáner, y así se sabe por dónde entró cada
              persona.
            </p>
          </div>
        </div>
        {points.length === 0 ? (
          <p className="muted form-note">
            Agrega al menos uno, por ejemplo «Entrada principal» o «Fila A».
          </p>
        ) : (
          <ul className="plain-list">
            {points.map((point) => (
              <li key={point.id}>
                <span>
                  <strong>{point.name}</strong>
                  <small>
                    {point.checkins.toLocaleString('es-MX')}{' '}
                    {point.checkins === 1 ? 'ingreso' : 'ingresos'}
                    {point.active ? '' : ' · Desactivado'}
                  </small>
                </span>
                {canManage && (
                  <span className="row-actions">
                    <button
                      className="link-button"
                      type="button"
                      disabled={act.isPending}
                      onClick={() => {
                        setNotice(undefined);
                        act.mutate({
                          path: `access-points/${point.id}`,
                          method: 'PUT',
                          body: { name: point.name, active: !point.active },
                          success: point.active
                            ? 'Punto de acceso desactivado.'
                            : 'Punto de acceso activado.',
                        });
                      }}
                    >
                      {point.active ? 'Desactivar' : 'Activar'}
                    </button>
                    {point.checkins === 0 && (
                      <button
                        className="link-button danger"
                        type="button"
                        disabled={act.isPending}
                        onClick={() => {
                          if (window.confirm(`¿Borrar ${point.name}?`)) {
                            setNotice(undefined);
                            act.mutate({
                              path: `access-points/${point.id}`,
                              method: 'DELETE',
                              success: 'Punto de acceso borrado.',
                            });
                          }
                        }}
                      >
                        Borrar
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <form className="inline-form" onSubmit={addDoor} noValidate>
            <Field label="Nuevo punto de acceso" error={doorErrors.name}>
              <input
                value={doorName}
                onChange={(e) => setDoorName(e.target.value)}
              />
            </Field>
            <button
              className="button secondary"
              type="submit"
              disabled={act.isPending}
            >
              Agregar
            </button>
          </form>
        )}
      </div>
    </>
  );
}

/** Día del evento › Entradas e incidencias: lo que pasa en la puerta. */
export function EventCheckinTab({ event }: { event: EventDetail }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const canManage = can('checkin.manage');
  const canOperate = can('checkin.operate', 'checkin.manage');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [notice, setNotice] = useState<NoticeState>();

  const overview = useCheckinOverview(event);
  const incidents = useQuery({
    queryKey: ['incidents', event.id],
    enabled: canManage,
    refetchInterval: REFRESH_MS,
    queryFn: async () =>
      incidentListSchema.parse(
        await apiRequest(`/api/events/${event.id}/checkin/incidents`),
      ),
  });
  const act = useCheckinAction(
    event,
    (text) => {
      setNotice({ kind: 'ok', text });
      setResolvingId(null);
      setResolution('');
    },
    (text) => setNotice({ kind: 'error', text }),
  );

  if (overview.isPending) {
    return <Loading />;
  }
  if (overview.isError) {
    return <Notice>{overview.error.message}</Notice>;
  }

  const data = overview.data;
  const pending = Math.max(data.expected - data.checkedIn, 0);
  const activePoints = data.accessPoints.filter((point) => point.active);

  return (
    <>
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {activePoints.length === 0 && (
        <p className="notice warn" role="status">
          Este evento aún no tiene puntos de acceso, y sin ellos recepción no
          puede escanear.{' '}
          <Link to={`/eventos/${event.id}?tab=accesos`}>
            Agregarlos en Configuración › Puntos de acceso
          </Link>
        </p>
      )}

      <div className="stats">
        <article className="stat">
          <span>Ingresaron</span>
          <strong>
            {data.checkedIn.toLocaleString('es-MX')}
            <small> de {data.expected.toLocaleString('es-MX')}</small>
          </strong>
        </article>
        <article className="stat">
          <span>Por llegar</span>
          <strong>{pending.toLocaleString('es-MX')}</strong>
        </article>
        <article className="stat">
          <span>Incidencias abiertas</span>
          <strong>{data.openIncidents}</strong>
        </article>
      </div>

      {event.status === 'active' && (
        <div className="section-actions">
          {canOperate && activePoints.length > 0 && (
            <Link
              className="button primary link-as-button inline-button"
              to={`/recepcion/${event.id}`}
            >
              Abrir el escáner de recepción
            </Link>
          )}
          {can('checkin.manage', 'registrations.manage') && !authorizing && (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setNotice(undefined);
                setAuthorizing(true);
              }}
            >
              Alta autorizada
            </button>
          )}
        </div>
      )}

      {authorizing && (
        <AuthorizedGuestForm
          event={event}
          accessPoints={activePoints}
          onCancel={() => setAuthorizing(false)}
          onDone={async (folio, admitted) => {
            await queryClient.invalidateQueries({
              queryKey: ['checkin', event.id],
            });
            await queryClient.invalidateQueries({
              queryKey: ['event-guests', event.id],
            });
            await queryClient.invalidateQueries({
              queryKey: ['event-dashboard', event.id],
            });
            setAuthorizing(false);
            setNotice({
              kind: 'ok',
              text: admitted
                ? `Alta ${folio} registrada; ya cuenta como ingreso.`
                : `Alta ${folio} registrada. Búscala en el escáner para darle ingreso.`,
            });
          }}
        />
      )}

      {canManage && (
        <div className="panel">
          <div className="panel-heading">
            <h2>Incidencias</h2>
          </div>
          {(incidents.data ?? []).length === 0 ? (
            <p className="muted">Sin incidencias.</p>
          ) : (
            <ul className="plain-list">
              {incidents.data?.map((incident) => (
                <li key={incident.id} className="incident-item">
                  <span>
                    <strong>
                      {incidentTypes[incident.type] ?? incident.type}
                    </strong>
                    <small>{incident.description}</small>
                    <small>
                      {new Date(incident.occurredAt).toLocaleString('es-MX', {
                        timeZone: event.timeZone,
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      {incident.accessPointName
                        ? ` · ${incident.accessPointName}`
                        : ''}
                      {incident.operatorName
                        ? ` · ${incident.operatorName}`
                        : ''}
                    </small>
                    {incident.resolution && (
                      <small>
                        Resuelta por {incident.resolvedBy ?? 'alguien'}:{' '}
                        {incident.resolution}
                      </small>
                    )}
                    {resolvingId === incident.id && (
                      <span className="inline-form">
                        <input
                          aria-label="Cómo se resolvió"
                          placeholder="¿Cómo se resolvió?"
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                        />
                        <button
                          className="button primary small"
                          type="button"
                          disabled={act.isPending}
                          onClick={() => {
                            setNotice(undefined);
                            const parsed = incidentResolveSchema.safeParse({
                              resolution,
                            });
                            if (!parsed.success) {
                              setNotice({
                                kind: 'error',
                                text:
                                  parsed.error.issues[0]?.message ??
                                  'Revisa el texto.',
                              });
                              return;
                            }
                            act.mutate({
                              path: `incidents/${incident.id}/resolve`,
                              method: 'POST',
                              body: parsed.data,
                              success: 'Incidencia resuelta.',
                            });
                          }}
                        >
                          Guardar
                        </button>
                      </span>
                    )}
                  </span>
                  {incident.status === 'open' ? (
                    resolvingId !== incident.id && (
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => {
                          setResolvingId(incident.id);
                          setResolution('');
                        }}
                      >
                        Resolver
                      </button>
                    )
                  ) : (
                    <span className="badge ok">Resuelta</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="panel table-panel">
        <div className="panel-heading table-heading">
          <h2>Últimos ingresos</h2>
        </div>
        {data.recent.length === 0 ? (
          <p className="muted">Aún no hay ingresos.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Invitado</th>
                  <th>Folio</th>
                  <th>Hora</th>
                  <th>Acceso</th>
                  <th>Operador</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.guestName}</strong>
                    </td>
                    <td>{row.folio}</td>
                    <td>
                      {new Date(row.checkedInAt).toLocaleTimeString('es-MX', {
                        timeZone: event.timeZone,
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>{row.accessPointName}</td>
                    <td>{row.operatorName ?? '—'}</td>
                    <td>
                      {[
                        row.source === 'offline' ? 'Sin conexión' : null,
                        row.manualReason ? `Manual: ${row.manualReason}` : null,
                        row.raffleFolio ? `Rifa ${row.raffleFolio}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { checkinEventsSchema, incidentInputSchema } from '@uka/shared';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { apiRequest, errorText, jsonRequest } from '../../api.js';
import { sessionKey, usePermissions, useSession } from '../../auth/session.js';
import {
  checkinStore,
  isConnectionError,
  sha256Hex,
} from '../../checkin/store.js';
import { QrScanner } from '../../checkin/QrScanner.js';
import { useStation, type StationOutcome } from '../../checkin/useStation.js';
import { Shell } from '../../components/Layout.js';
import { Loading, Notice, PageHeading } from '../../components/ui.js';
import { formatEventDate } from '../text.js';

const RESULT_MS = 3500;
const SAME_CODE_MS = 6000;

/**
 * Con sesión, Recepción conserva el menú. Sin conexión no hay sesión que validar.
 * Recibe el dato en lugar de consultarlo: sin internet, montar otro lector de la
 * sesión la vuelve a pedir, regresa la pantalla a "cargando" y se repite sin fin.
 */
function ReceptionFrame({
  hasSession,
  children,
  bare = false,
}: {
  hasSession: boolean;
  children: ReactNode;
  bare?: boolean;
}) {
  return hasSession ? <Shell bare={bare}>{children}</Shell> : <>{children}</>;
}

function useOperator() {
  const session = useSession();
  const user = session.data?.user;
  const cached = checkinStore.operator();
  const canOperate =
    user?.permissions.includes('checkin.operate') ||
    user?.permissions.includes('checkin.manage');

  useEffect(() => {
    if (user && canOperate) {
      checkinStore.saveOperator({
        displayName: user.displayName,
        roleName: user.roleName,
      });
    }
  }, [canOperate, user]);

  // Sin internet no se puede preguntar por la sesión: se confía en la última
  // conocida de este dispositivo, que se borra al cerrar sesión.
  const offline = session.isError && isConnectionError(session.error);
  return {
    isPending: session.isPending,
    loggedOut: session.isSuccess && !user,
    forbidden: Boolean(user) && !canOperate,
    allowed: canOperate || (offline && Boolean(cached)),
    displayName: user?.displayName ?? cached?.displayName ?? '',
    csrfToken: session.data?.csrfToken ?? '',
  };
}

function ResultOverlay({
  outcome,
  timeZone,
  onClose,
}: {
  outcome: StationOutcome;
  timeZone: string;
  onClose: () => void;
}) {
  const { result, offline } = outcome;
  const view = {
    ok: { tone: 'ok', title: 'Bienvenida o bienvenido' },
    duplicate: { tone: 'warn', title: 'Este pase ya ingresó' },
    revoked: { tone: 'bad', title: 'Pase no válido' },
    unknown: { tone: 'bad', title: 'Código no reconocido' },
  }[result.status];

  return (
    <button
      type="button"
      className={`scan-result ${view.tone}`}
      onClick={onClose}
      role="alert"
    >
      <strong className="scan-title">{view.title}</strong>
      {result.status !== 'unknown' && (
        <>
          <span className="scan-name">{result.guestName}</span>
          <span>
            {result.ticketName} · {result.folio}
          </span>
        </>
      )}
      {result.status === 'ok' && result.raffleFolio && (
        <span className="scan-raffle">Folio de rifa: {result.raffleFolio}</span>
      )}
      {result.status === 'duplicate' && (
        <span>
          Ingresó a las{' '}
          {new Date(result.checkedInAt).toLocaleTimeString('es-MX', {
            timeZone,
            timeStyle: 'short',
          })}{' '}
          · {result.accessPointName}
          {result.operatorName ? ` · ${result.operatorName}` : ''}
        </span>
      )}
      {result.status === 'revoked' && (
        <span>Envía a esta persona a la mesa de incidencias.</span>
      )}
      {result.status === 'unknown' && (
        <span>
          {offline
            ? 'No está en la lista de este dispositivo. Se revisará al recuperar la conexión.'
            : 'No pertenece a este evento.'}
        </span>
      )}
      {offline && <small>Registrado sin conexión</small>}
      <small>Toca para continuar</small>
    </button>
  );
}

export function ReceptionHomePage() {
  const session = useSession();
  const operator = useOperator();
  const navigate = useNavigate();
  const events = useQuery({
    queryKey: ['checkin-events'],
    enabled: operator.allowed,
    queryFn: async () => {
      const list = checkinEventsSchema.parse(
        await apiRequest('/api/checkin/events'),
      );
      checkinStore.saveEvents(list);
      return list;
    },
  });

  if (operator.isPending) {
    return <Loading />;
  }
  if (operator.loggedOut) {
    return <Navigate to="/login" replace />;
  }
  if (operator.forbidden) {
    return <Navigate to="/" replace />;
  }

  const list = events.data ?? checkinStore.events();

  const content = (
    <>
      {events.isPending && <Loading />}
      {!events.isPending && list.length === 0 && (
        <p className="muted">
          No hay eventos activos con check-in. Actívalo en el módulo del evento.
        </p>
      )}
      <div className="station-list">
        {list.map((event) => (
          <button
            key={event.id}
            type="button"
            className="station-option"
            onClick={() => navigate(`/recepcion/${event.id}`)}
          >
            <strong>{event.name}</strong>
            <small>
              {formatEventDate(event.startsAt, event.timeZone, true)}
              {event.venue ? ` · ${event.venue}` : ''}
            </small>
          </button>
        ))}
      </div>
    </>
  );

  // Con sesión se navega como en el resto del CRM. Sin conexión no hay sesión que
  // validar y el teléfono debe poder operar: se muestra la vista independiente.
  if (session.data?.user) {
    return (
      <Shell>
        <section className="reception-home">
          <PageHeading
            title="Elige el evento"
            description="Abre la recepción del evento para escanear pases. En el teléfono también funciona sin internet."
          />
          {content}
        </section>
      </Shell>
    );
  }

  return (
    <div className="station-home">
      <header className="station-bar">
        <strong>Recepción</strong>
      </header>
      <main className="station-content">
        <h1>Elige el evento</h1>
        {content}
      </main>
    </div>
  );
}

export function ReceptionStationPage() {
  const { eventId = '' } = useParams();
  const session = useSession();
  const { can } = usePermissions();
  const operator = useOperator();
  const events = useQuery({
    queryKey: ['checkin-events'],
    enabled: operator.allowed,
    queryFn: async () => {
      const list = checkinEventsSchema.parse(
        await apiRequest('/api/checkin/events'),
      );
      checkinStore.saveEvents(list);
      return list;
    },
  });
  const [doorId, setDoorId] = useState(() => checkinStore.door(eventId) ?? '');

  if (operator.isPending) {
    return <Loading />;
  }
  if (operator.loggedOut) {
    return <Navigate to="/login" replace />;
  }
  if (operator.forbidden) {
    return <Navigate to="/" replace />;
  }

  const event = (events.data ?? checkinStore.events()).find(
    (item) => item.id === eventId,
  );
  if (!event) {
    return events.isPending ? (
      <ReceptionFrame hasSession={Boolean(session.data?.user)}>
        <Loading />
      </ReceptionFrame>
    ) : (
      <Navigate to="/recepcion" replace />
    );
  }
  const door = event.accessPoints.find((point) => point.id === doorId);

  if (!door) {
    const content = (
      <>
        {event.accessPoints.length === 0 && (
          <p className="notice warn" role="status">
            Este evento aún no tiene puntos de acceso.{' '}
            {can('checkin.manage') ? (
              <Link to={`/eventos/${event.id}?tab=checkin`}>
                Agregar puntos de acceso
              </Link>
            ) : (
              'Pide a un administrador que los agregue.'
            )}
          </p>
        )}
        <div className="station-list">
          {event.accessPoints.map((point) => (
            <button
              key={point.id}
              type="button"
              className="station-option"
              onClick={() => {
                checkinStore.saveDoor(eventId, point.id);
                setDoorId(point.id);
              }}
            >
              <strong>{point.name}</strong>
            </button>
          ))}
        </div>
      </>
    );
    if (session.data?.user) {
      return (
        <Shell>
          <section className="reception-home">
            <Link className="back-link" to="/recepcion">
              Recepción
            </Link>
            <PageHeading
              title="¿En qué punto de acceso estás?"
              description={event.name}
            />
            {content}
          </section>
        </Shell>
      );
    }
    return (
      <div className="station-home">
        <header className="station-bar">
          <strong>{event.name}</strong>
          <Link to="/recepcion">Eventos</Link>
        </header>
        <main className="station-content">
          <h1>¿En qué punto de acceso estás?</h1>
          {content}
        </main>
      </div>
    );
  }

  return (
    <ReceptionFrame hasSession={Boolean(session.data?.user)} bare>
      <Station
        eventId={eventId}
        eventName={event.name}
        timeZone={event.timeZone}
        doorId={door.id}
        doorName={door.name}
        csrfToken={operator.csrfToken}
        onChangeDoor={() => setDoorId('')}
      />
    </ReceptionFrame>
  );
}

function Station({
  eventId,
  eventName,
  timeZone,
  doorId,
  doorName,
  csrfToken,
  onChangeDoor,
}: {
  eventId: string;
  eventName: string;
  timeZone: string;
  doorId: string;
  doorName: string;
  csrfToken: string;
  onChangeDoor: () => void;
}) {
  const queryClient = useQueryClient();
  const refreshSession = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: sessionKey });
  }, [queryClient]);
  const station = useStation({
    eventId,
    accessPointId: doorId,
    csrfToken,
    refreshSession,
  });
  const [outcome, setOutcome] = useState<StationOutcome | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'scan' | 'search' | 'incident'>('scan');
  const [incidentText, setIncidentText] = useState('');
  const [incidentNotice, setIncidentNotice] = useState('');
  const lastCode = useRef({ code: '', at: 0 });

  useEffect(() => {
    if (!outcome) {
      return undefined;
    }
    navigator.vibrate?.(outcome.result.status === 'ok' ? 80 : [120, 80, 120]);
    const timer = setTimeout(() => setOutcome(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  const handleHash = useCallback(
    async (tokenHash: string, reason: string | null) => {
      setError('');
      try {
        setOutcome(await station.admit(tokenHash, reason));
      } catch (cause) {
        setError(errorText(cause, 'No se pudo registrar el ingreso.'));
      }
    },
    [station],
  );

  const onCode = useCallback(
    (code: string) => {
      const now = Date.now();
      // La cámara ve el mismo código muchas veces por segundo. Solo vuelve a contar
      // si dejó de verse un rato, para no crear un repetido por dejar el teléfono
      // apuntando al mismo pase.
      const sameCode =
        lastCode.current.code === code &&
        now - lastCode.current.at < SAME_CODE_MS;
      lastCode.current = { code, at: now };
      if (sameCode) {
        return;
      }
      void sha256Hex(code).then((hash) => handleHash(hash, null));
    },
    [handleHash],
  );

  const term = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      term.length < 2
        ? []
        : station.entries
            .filter(
              (entry) =>
                entry.guestName.toLowerCase().includes(term) ||
                entry.folio.toLowerCase().includes(term),
            )
            .slice(0, 20),
    [station.entries, term],
  );
  const entered = station.entries.filter((entry) => entry.checkedInAt).length;

  const sendIncident = async () => {
    const parsed = incidentInputSchema.safeParse({
      accessPointId: doorId,
      description: incidentText,
    });
    if (!parsed.success) {
      setIncidentNotice(parsed.error.issues[0]?.message ?? 'Revisa el texto.');
      return;
    }
    try {
      await apiRequest(
        `/api/events/${eventId}/checkin/incidents`,
        jsonRequest('POST', parsed.data, csrfToken),
      );
      setIncidentText('');
      setIncidentNotice('Incidencia registrada.');
    } catch (cause) {
      setIncidentNotice(
        isConnectionError(cause)
          ? 'Sin conexión. Anótala y regístrala al recuperar la señal.'
          : errorText(cause, 'No se pudo registrar.'),
      );
    }
  };

  return (
    <div className="station">
      <header className="station-bar">
        <div>
          <strong>{eventName}</strong>
          <button className="station-door" type="button" onClick={onChangeDoor}>
            {doorName} · cambiar
          </button>
        </div>
        <Link to="/recepcion">Cambiar de evento</Link>
      </header>

      <div
        className={station.online ? 'station-status' : 'station-status offline'}
      >
        <span>
          {station.online ? 'En línea' : 'Sin conexión'}
          {station.queueSize > 0 && ` · ${station.queueSize} por enviar`}
        </span>
        <span>
          {entered} de {station.entries.length} ingresaron
        </span>
      </div>
      {station.needsLogin && (
        <Notice>
          Tu sesión terminó. Las lecturas siguen guardadas aquí;{' '}
          <Link to="/login">inicia sesión</Link> para enviarlas.
        </Notice>
      )}
      {station.conflicts > 0 && (
        <p className="notice warn" role="status">
          Al sincronizar, {station.conflicts}{' '}
          {station.conflicts === 1 ? 'lectura resultó' : 'lecturas resultaron'}{' '}
          en incidencia. Revísalas en el CRM.
        </p>
      )}
      {!station.online && station.entries.length === 0 && (
        <Notice>
          Este dispositivo no tiene la lista del evento. Conéctate para
          descargarla.
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}

      <div className="tabs station-tabs" role="tablist">
        {(
          [
            ['scan', 'Escanear'],
            ['search', 'Buscar'],
            ['incident', 'Incidencia'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={mode === value ? 'tab active' : 'tab'}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'scan' && (
        <QrScanner paused={outcome !== null} onCode={onCode} />
      )}

      {mode === 'search' && (
        <div className="station-content">
          <input
            className="station-search"
            type="search"
            placeholder="Nombre o folio"
            aria-label="Buscar por nombre o folio"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className="muted">
            Solo para quien no pueda mostrar su QR. Verifica su identidad antes
            de darle ingreso.
          </p>
          <ul className="plain-list">
            {matches.map((entry) => (
              <li key={entry.tokenHash}>
                <span>
                  <strong>{entry.guestName}</strong>
                  <small>
                    {entry.ticketName} · {entry.folio}
                  </small>
                </span>
                {entry.checkedInAt ? (
                  <span className="badge neutral">Ya ingresó</span>
                ) : (
                  <button
                    className="button primary small"
                    type="button"
                    onClick={() => {
                      const reason = window.prompt(
                        `Motivo del ingreso manual de ${entry.guestName}:`,
                      );
                      if (reason?.trim()) {
                        void handleHash(entry.tokenHash, reason.trim());
                        setSearch('');
                      }
                    }}
                  >
                    Dar ingreso
                  </button>
                )}
              </li>
            ))}
          </ul>
          {term.length >= 2 && matches.length === 0 && (
            <p className="muted">
              Sin resultados en la lista de este dispositivo.
            </p>
          )}
        </div>
      )}

      {mode === 'incident' && (
        <div className="station-content">
          <label className="field">
            <span>¿Qué ocurrió?</span>
            <textarea
              rows={4}
              value={incidentText}
              onChange={(e) => setIncidentText(e.target.value)}
            />
          </label>
          {incidentNotice && <p className="muted">{incidentNotice}</p>}
          <div className="form-actions">
            <button
              className="button primary"
              type="button"
              onClick={() => void sendIncident()}
            >
              Registrar incidencia
            </button>
          </div>
        </div>
      )}

      {outcome && (
        <ResultOverlay
          outcome={outcome}
          timeZone={timeZone}
          onClose={() => setOutcome(null)}
        />
      )}
    </div>
  );
}

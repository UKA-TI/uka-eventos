import { useQuery } from '@tanstack/react-query';
import { eventDashboardSchema, type EventDetail } from '@uka/shared';
import { useState } from 'react';
import { apiRequest } from '../api.js';
import { Loading, Notice } from '../components/ui.js';
import { BarChart } from './reports/BarChart.js';

const REFRESH_MS = 15_000;

const count = (value: number) => value.toLocaleString('es-MX');
const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

function Meter({ value }: { value: number }) {
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <i style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

/** Columnas por franja de tiempo. Solo se rotula el pico; el resto vive en el eje y al pasar. */
function TimelineChart({
  points,
  bucketMinutes,
}: {
  points: { start: string; label: string; count: number }[];
  bucketMinutes: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...points.map((point) => point.count));
  const peak = points.reduce(
    (best, point) => (point.count > best.count ? point : best),
    points[0] ?? { start: '', label: '', count: 0 },
  );
  const step = Math.max(1, Math.ceil(points.length / 8));
  // La marca intermedia solo si cae en un número entero: un eje no debe redondear.
  const ticks = max % 2 === 0 ? [max, max / 2, 0] : [max, 0];

  return (
    <div className="timeline">
      <div className="timeline-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick}>{count(tick)}</span>
        ))}
      </div>
      <div className="timeline-plot">
        {points.map((point, index) => (
          <div
            key={point.start}
            className={
              active === point.start ? 'timeline-col is-active' : 'timeline-col'
            }
            tabIndex={0}
            role="group"
            aria-label={`${point.label}: ${count(point.count)} ingresos`}
            onPointerEnter={() => setActive(point.start)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(point.start)}
            onBlur={() => setActive(null)}
          >
            <div className="timeline-track">
              <i style={{ height: `${(point.count / max) * 100}%` }}>
                {point.start === peak.start && point.count > 0 && (
                  <b className="timeline-peak">{count(point.count)}</b>
                )}
              </i>
            </div>
            <span className="timeline-label">
              {index % step === 0 ? point.label : ''}
            </span>
            {active === point.start && (
              <div className="chart-tip timeline-tip" role="status">
                <strong>{count(point.count)} ingresos</strong>
                <span>
                  {point.label}, {bucketMinutes} min
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EventDashboardTab({
  event,
  groupTabVisible,
  onOpenTab,
}: {
  event: EventDetail;
  groupTabVisible: boolean;
  onOpenTab: (tab: 'mesas' | 'invitados') => void;
}) {
  const dashboard = useQuery({
    queryKey: ['event-dashboard', event.id],
    refetchInterval: REFRESH_MS,
    queryFn: async () =>
      eventDashboardSchema.parse(
        await apiRequest(`/api/events/${event.id}/dashboard`),
      ),
  });

  if (dashboard.isPending) {
    return <Loading />;
  }
  if (dashboard.isError) {
    return <Notice>{dashboard.error.message}</Notice>;
  }

  const data = dashboard.data;
  const rate = percent(data.checkedIn, data.registered);
  const updated = new Date(data.updatedAt).toLocaleTimeString('es-MX', {
    timeStyle: 'short',
  });

  return (
    <>
      <div className="dash-head">
        <span>
          {event.status === 'active' && <i className="live-dot" />}
          {event.status === 'active' ? 'En vivo' : 'Evento cerrado'} ·
          Actualizado a las {updated}
        </span>
      </div>

      {data.seatsToRegister > 0 && (
        <p className="notice warn" role="status">
          {count(data.seatsToRegister)}{' '}
          {data.seatsToRegister === 1
            ? 'lugar vendido aún no tiene'
            : 'lugares vendidos aún no tienen'}{' '}
          invitado registrado.{' '}
          <button
            className="link-button"
            type="button"
            onClick={() => onOpenTab(groupTabVisible ? 'mesas' : 'invitados')}
          >
            {groupTabVisible
              ? 'Ver Asistentes › Registro por grupo'
              : 'Ver Asistentes › Lista de invitados'}
          </button>
        </p>
      )}

      <div className="kpi-grid">
        <article className="stat kpi">
          <span>Ingresados</span>
          <strong>{count(data.checkedIn)}</strong>
          <small>
            {data.lastPeriodCheckins > 0
              ? `+${count(data.lastPeriodCheckins)} en los últimos 15 min`
              : 'Sin ingresos en los últimos 15 min'}
          </small>
          <Meter value={rate} />
        </article>
        <article className="stat kpi">
          <span>Registrados</span>
          <strong>{count(data.registered)}</strong>
          <small>
            {data.capacity
              ? `${percent(data.registered, data.capacity)}% del cupo de ${count(data.capacity)}`
              : `${count(data.seatsSold)} lugares vendidos`}
          </small>
          {data.capacity ? (
            <Meter value={percent(data.registered, data.capacity)} />
          ) : null}
        </article>
        <article className="stat kpi">
          <span>Pendientes</span>
          <strong>{count(data.pendingArrival)}</strong>
          <small>
            {percent(data.pendingArrival, data.registered)}% por llegar
            {data.pendingActivation > 0 &&
              ` · ${count(data.pendingActivation)} sin activar`}
          </small>
          <Meter value={percent(data.pendingArrival, data.registered)} />
        </article>
        <article className="stat kpi">
          <span>Incidencias</span>
          <strong>{count(data.incidentsOpen + data.incidentsResolved)}</strong>
          <small>
            {data.incidentsOpen > 0 ? (
              <b className="text-alert">
                {count(data.incidentsOpen)}{' '}
                {data.incidentsOpen === 1 ? 'abierta' : 'abiertas'}
              </b>
            ) : (
              'Ninguna abierta'
            )}{' '}
            · {count(data.incidentsResolved)}{' '}
            {data.incidentsResolved === 1 ? 'resuelta' : 'resueltas'}
          </small>
        </article>
      </div>

      <div className="dash-grid">
        <figure className="panel chart">
          <figcaption className="chart-head">
            <h2>Ingresos cada {data.bucketMinutes} minutos</h2>
          </figcaption>
          {data.timeline.length === 0 ? (
            <p className="muted">
              Aquí verás el ritmo de llegada cuando empiece la recepción.
            </p>
          ) : (
            <TimelineChart
              points={data.timeline}
              bucketMinutes={data.bucketMinutes}
            />
          )}
        </figure>
        <div className="dash-side">
          <div className="dash-rate">
            <b>{rate}%</b>
            <span>
              de asistencia · {count(data.checkedIn)} de{' '}
              {count(data.registered)}
            </span>
          </div>
          <BarChart
            title="Por punto de acceso"
            series={[{ key: 'count', label: 'Ingresos', tone: 'serie-1' }]}
            groups={[...data.accessPoints]
              .sort((a, b) => b.count - a.count)
              .map((point) => ({
                id: point.id,
                label: point.name,
                values: { count: point.count },
              }))}
            format={count}
          />
        </div>
      </div>
    </>
  );
}

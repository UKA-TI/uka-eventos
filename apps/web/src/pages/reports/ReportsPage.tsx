import { useQuery } from '@tanstack/react-query';
import { reportEventsResponseSchema, type ReportEvent } from '@uka/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../api.js';
import { usePermissions } from '../../auth/session.js';
import { Loading, Notice, PageHeading } from '../../components/ui.js';
import { BarChart } from './BarChart.js';

const money = (value: number) =>
  value.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
const count = (value: number) => value.toLocaleString('es-MX');
const pct = (value: number | null) =>
  value === null
    ? '—'
    : `${(value * 100).toLocaleString('es-MX', { maximumFractionDigits: 1 })} %`;

type Metric = {
  key: keyof ReportEvent;
  label: string;
  format: (value: number) => string;
  /** Las tasas se comparan en puntos; el resto en porcentaje de cambio. */
  isRate?: boolean;
};

const metrics: Metric[] = [
  { key: 'registered', label: 'Registrados', format: count },
  { key: 'attended', label: 'Asistieron', format: count },
  {
    key: 'attendanceRate',
    label: 'Asistencia',
    format: (value) => pct(value),
    isRate: true,
  },
  { key: 'seatsSold', label: 'Lugares vendidos', format: count },
  {
    key: 'occupancy',
    label: 'Ocupación',
    format: (value) => pct(value),
    isRate: true,
  },
  { key: 'income', label: 'Ingresos', format: money },
  { key: 'donations', label: 'Donativos', format: money },
  { key: 'newPeople', label: 'Personas nuevas', format: count },
  { key: 'returningPeople', label: 'Personas que repiten', format: count },
  { key: 'companies', label: 'Empresas', format: count },
  { key: 'returningCompanies', label: 'Empresas que repiten', format: count },
];

/** Cambio frente a la edición anterior. Lleva signo y flecha: nunca solo color. */
function changeText(
  current: number | null,
  previous: number | null,
  isRate?: boolean,
): string | null {
  if (current === null || previous === null) {
    return null;
  }
  if (isRate) {
    const points = (current - previous) * 100;
    if (Math.abs(points) < 0.05) {
      return '= igual';
    }
    return `${points > 0 ? '▲ +' : '▼ '}${points.toLocaleString('es-MX', { maximumFractionDigits: 1 })} pts`;
  }
  if (previous === 0) {
    return current === 0 ? '= igual' : null;
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.05) {
    return '= igual';
  }
  return `${change > 0 ? '▲ +' : '▼ '}${change.toLocaleString('es-MX', { maximumFractionDigits: 1 })} %`;
}

function sum(rows: ReportEvent[], key: keyof ReportEvent): number {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function EditionComparison({
  rows,
  focusSeriesId,
}: {
  rows: ReportEvent[];
  focusSeriesId: string;
}) {
  const series = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; total: number }>();
    for (const row of rows) {
      const item = byId.get(row.seriesId) ?? {
        id: row.seriesId,
        name: row.seriesName,
        total: 0,
      };
      item.total += 1;
      byId.set(row.seriesId, item);
    }
    return [...byId.values()].sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name),
    );
  }, [rows]);
  const [seriesId, setSeriesId] = useState('');
  const selected = focusSeriesId || seriesId || series[0]?.id || '';
  const editions = rows
    .filter((row) => row.seriesId === selected)
    .sort((a, b) => a.editionYear - b.editionYear);

  return (
    <div className="panel table-panel">
      <div className="panel-heading">
        <div>
          <h2>El mismo evento, año contra año</h2>
          <small className="cell-note">
            Cada edición se compara con la anterior de su serie.
          </small>
        </div>
        <select
          className="inline-select"
          aria-label="Serie a comparar"
          disabled={Boolean(focusSeriesId)}
          value={selected}
          onChange={(e) => setSeriesId(e.target.value)}
        >
          {series.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.total})
            </option>
          ))}
        </select>
      </div>
      {editions.length < 2 && (
        <p className="muted">
          Esta serie tiene una sola edición. La comparación aparecerá cuando
          exista la siguiente.
        </p>
      )}
      {editions.length > 0 && (
        <div className="table-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Indicador</th>
                {editions.map((edition) => (
                  <th key={edition.id}>{edition.editionYear}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.key}>
                  <th scope="row">{metric.label}</th>
                  {editions.map((edition, index) => {
                    const value = edition[metric.key] as number | null;
                    const previous = editions[index - 1];
                    const change = previous
                      ? changeText(
                          value,
                          previous[metric.key] as number | null,
                          metric.isRate,
                        )
                      : null;
                    return (
                      <td key={edition.id}>
                        {value === null ? '—' : metric.format(value)}
                        {change && (
                          <small className="cell-note">{change}</small>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const sortable: {
  key: keyof ReportEvent;
  label: string;
  render: (row: ReportEvent) => string;
}[] = [
  {
    key: 'registered',
    label: 'Registrados',
    render: (r) => count(r.registered),
  },
  { key: 'attended', label: 'Asistieron', render: (r) => count(r.attended) },
  {
    key: 'attendanceRate',
    label: 'Asistencia',
    render: (r) => pct(r.attendanceRate),
  },
  { key: 'occupancy', label: 'Ocupación', render: (r) => pct(r.occupancy) },
  { key: 'income', label: 'Ingresos', render: (r) => money(r.income) },
  { key: 'donations', label: 'Donativos', render: (r) => money(r.donations) },
  { key: 'newPeople', label: 'Nuevas', render: (r) => count(r.newPeople) },
  {
    key: 'returningPeople',
    label: 'Repiten',
    render: (r) => count(r.returningPeople),
  },
  {
    key: 'returningCompanies',
    label: 'Empresas que repiten',
    render: (r) => count(r.returningCompanies),
  },
];

export function ReportsPage() {
  const { can } = usePermissions();
  const [year, setYear] = useState('');
  const [type, setType] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [sortKey, setSortKey] = useState<keyof ReportEvent | null>(null);

  const report = useQuery({
    queryKey: ['reports-events'],
    queryFn: async () =>
      reportEventsResponseSchema.parse(await apiRequest('/api/reports/events')),
  });

  if (report.isPending) {
    return <Loading />;
  }
  if (report.isError) {
    return <Notice>{report.error.message}</Notice>;
  }

  const all = report.data;
  const years = [...new Set(all.map((row) => row.editionYear))].sort(
    (a, b) => b - a,
  );
  const types = [...new Set(all.map((row) => row.eventType))].sort();
  const seriesList = [
    ...new Map(all.map((row) => [row.seriesId, row.seriesName])),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const rows = all.filter(
    (row) =>
      (!year || row.editionYear === Number(year)) &&
      (!type || row.eventType === type) &&
      (!seriesId || row.seriesId === seriesId),
  );
  const ordered = sortKey
    ? [...rows].sort(
        (a, b) => (Number(b[sortKey]) || 0) - (Number(a[sortKey]) || 0),
      )
    : rows;

  const registered = sum(rows, 'registered');
  const attended = sum(rows, 'attended');
  const exportQuery = new URLSearchParams();
  if (year) {
    exportQuery.set('year', year);
  }
  if (type) {
    exportQuery.set('type', type);
  }
  if (seriesId) {
    exportQuery.set('seriesId', seriesId);
  }

  const groupOf = (row: ReportEvent, values: Record<string, number>) => ({
    id: row.id,
    label: row.name,
    note: `Edición ${row.editionYear}`,
    values,
  });

  return (
    <section>
      <PageHeading
        title="Reportes"
        description="Compara eventos entre sí y el mismo evento año contra año. No incluye borradores."
        action={
          can('reports.export') && (
            <a
              className="button secondary"
              href={`/api/reports/export/events.csv?${exportQuery.toString()}`}
            >
              Descargar comparativo
            </a>
          )
        }
      />

      {all.length === 0 ? (
        <div className="panel">
          <p className="muted">
            Aún no hay eventos publicados. Los reportes aparecerán cuando
            actives el primero.
          </p>
          {can('events.create') && (
            <Link to="/eventos/nuevo">Crear evento</Link>
          )}
        </div>
      ) : (
        <>
          <div className="filters">
            <select
              aria-label="Filtrar por año"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="">Todos los años</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por tipo"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">Todos los tipos</option>
              {types.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar por serie"
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
            >
              <option value="">Todas las series</option>
              {seriesList.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="stats">
            <article className="stat">
              <span>Eventos</span>
              <strong>{count(rows.length)}</strong>
            </article>
            <article className="stat">
              <span>Registrados</span>
              <strong>{count(registered)}</strong>
            </article>
            <article className="stat">
              <span>Asistieron</span>
              <strong>
                {count(attended)}
                {registered > 0 && <small> {pct(attended / registered)}</small>}
              </strong>
            </article>
            <article className="stat">
              <span>Ingresos</span>
              <strong>{money(sum(rows, 'income'))}</strong>
            </article>
            <article className="stat">
              <span>Donativos</span>
              <strong>{money(sum(rows, 'donations'))}</strong>
            </article>
            <article className="stat">
              <span>Personas nuevas</span>
              <strong>{count(sum(rows, 'newPeople'))}</strong>
            </article>
          </div>

          {rows.length === 0 ? (
            <div className="panel">
              <p className="muted">Ningún evento coincide con los filtros.</p>
            </div>
          ) : (
            <>
              <div className="chart-grid">
                <BarChart
                  title="Registrados y asistentes"
                  series={[
                    {
                      key: 'registered',
                      label: 'Registrados',
                      tone: 'serie-1',
                    },
                    { key: 'attended', label: 'Asistieron', tone: 'serie-2' },
                  ]}
                  groups={rows.map((row) =>
                    groupOf(row, {
                      registered: row.registered,
                      attended: row.attended,
                    }),
                  )}
                  format={count}
                />
                <BarChart
                  title="Ingresos por evento"
                  description="Pagos vigentes registrados, sin donativos."
                  series={[
                    { key: 'income', label: 'Ingresos', tone: 'serie-1' },
                  ]}
                  groups={rows.map((row) =>
                    groupOf(row, { income: row.income }),
                  )}
                  format={money}
                />
              </div>

              <div className="panel table-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Comparativo entre eventos</h2>
                    <small className="cell-note">
                      Elige una columna para ordenar de mayor a menor.
                    </small>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Evento</th>
                        {sortable.map((column) => (
                          <th
                            key={column.key}
                            aria-sort={
                              sortKey === column.key ? 'descending' : undefined
                            }
                          >
                            <button
                              className="sort-button"
                              type="button"
                              onClick={() =>
                                setSortKey(
                                  sortKey === column.key ? null : column.key,
                                )
                              }
                            >
                              {column.label}
                              {sortKey === column.key ? ' ▼' : ''}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ordered.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {can('events.view', 'events.edit') ? (
                              <Link to={`/eventos/${row.id}`}>
                                <strong>{row.name}</strong>
                              </Link>
                            ) : (
                              <strong>{row.name}</strong>
                            )}
                            <small className="cell-note">
                              {row.eventType} · Edición {row.editionYear}
                            </small>
                          </td>
                          {sortable.map((column) => (
                            <td key={column.key}>{column.render(row)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Compara años: filtrar por uno solo no debe esconder las demás ediciones. */}
              <EditionComparison rows={all} focusSeriesId={seriesId} />
            </>
          )}

          <p className="form-note">
            Asistencia: quienes ingresaron entre los registrados confirmados.
            Ocupación: lugares apartados o vendidos contra el aforo. Personas
            nuevas: su primera participación en cualquier evento, aunque el
            filtro muestre otro periodo.
          </p>
        </>
      )}
    </section>
  );
}

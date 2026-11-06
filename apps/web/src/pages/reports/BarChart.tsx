import { useState, type CSSProperties } from 'react';

export interface ChartSeries {
  key: string;
  label: string;
  /** Clase de color: serie-1 o serie-2, siempre la misma para la misma medida. */
  tone: 'serie-1' | 'serie-2';
}

export interface ChartGroup {
  id: string;
  label: string;
  note?: string;
  values: Record<string, number>;
}

const MAX_GROUPS = 12;

/**
 * Barras horizontales con el valor en la punta. Una sola escala por gráfica: medidas
 * de distinta naturaleza, como personas y dinero, van en gráficas separadas.
 */
export function BarChart({
  title,
  description,
  series,
  groups,
  format,
}: {
  title: string;
  description?: string;
  series: ChartSeries[];
  groups: ChartGroup[];
  format: (value: number) => string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const shown = groups.slice(0, MAX_GROUPS);
  const max = Math.max(
    1,
    ...shown.flatMap((group) =>
      series.map((item) => group.values[item.key] ?? 0),
    ),
  );
  const empty = shown.every((group) =>
    series.every((item) => !group.values[item.key]),
  );

  return (
    <figure className="panel chart">
      <figcaption className="chart-head">
        <h2>{title}</h2>
        {description && <small className="cell-note">{description}</small>}
        {series.length > 1 && (
          <ul className="chart-legend">
            {series.map((item) => (
              <li key={item.key}>
                <i className={item.tone} aria-hidden="true" />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
      {empty ? (
        <p className="muted">Aún no hay datos que mostrar.</p>
      ) : (
        <div className="chart-rows">
          {shown.map((group) => (
            <div
              key={group.id}
              className={
                active === group.id ? 'chart-row is-active' : 'chart-row'
              }
              tabIndex={0}
              role="group"
              aria-label={`${group.label}: ${series
                .map(
                  (item) =>
                    `${item.label} ${format(group.values[item.key] ?? 0)}`,
                )
                .join(', ')}`}
              onPointerEnter={() => setActive(group.id)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(group.id)}
              onBlur={() => setActive(null)}
            >
              <div className="chart-label">
                <span>{group.label}</span>
                {group.note && <small>{group.note}</small>}
              </div>
              <div className="chart-bars">
                {series.map((item) => {
                  const value = group.values[item.key] ?? 0;
                  return (
                    <div className="chart-bar-line" key={item.key}>
                      <i
                        className={`chart-bar ${item.tone}`}
                        // La longitud sale de una sola escala; el espacio del valor se
                        // reserva antes para que ninguna barra se recorte.
                        style={{ '--share': value / max } as CSSProperties}
                      />
                      <span className="chart-value">{format(value)}</span>
                    </div>
                  );
                })}
              </div>
              {active === group.id && (
                <div className="chart-tip" role="status">
                  <strong>{group.label}</strong>
                  {series.map((item) => (
                    <span key={item.key}>
                      <i className={item.tone} aria-hidden="true" />
                      <b>{format(group.values[item.key] ?? 0)}</b> {item.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {groups.length > MAX_GROUPS && (
        <small className="cell-note">
          Se muestran {MAX_GROUPS} de {groups.length} eventos. La tabla de abajo
          tiene todos.
        </small>
      )}
    </figure>
  );
}

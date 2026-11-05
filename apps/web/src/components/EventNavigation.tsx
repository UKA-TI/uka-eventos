import { useEffect, useRef, useState } from 'react';

/**
 * Las secciones del evento agrupadas por la tarea que resuelven. Cada acción vive en un
 * solo lugar: el dinero en Ventas, las personas en Asistentes, la puerta en Día del
 * evento y lo que se prepara una vez en Configuración.
 */
const groups = [
  { label: 'Ventas', tabs: ['registros', 'finanzas'] },
  { label: 'Asistentes', tabs: ['invitados', 'mesas', 'acomodo'] },
  { label: 'Día del evento', tabs: ['checkin', 'operadores'] },
  {
    label: 'Configuración',
    tabs: ['resumen', 'boletos', 'formulario', 'accesos', 'modulos'],
  },
];

/** Una línea por sección para quien no sabe qué hay detrás de cada nombre. */
const descriptions: Record<string, string> = {
  registros: 'Compras, pagos, reembolsos y facturas',
  finanzas: 'Meta, presupuesto, resultado y cierre',
  invitados: 'Cada persona: su pase, reenvíos y cambios de nombre',
  mesas: 'Avance de las empresas que registran a sus invitados',
  acomodo: 'Plano y asignación de mesas',
  checkin: 'Ingresos, incidencias y altas autorizadas',
  operadores: 'Quién opera la puerta y qué registró',
  resumen: 'Fecha, sede, aforo y liga de registro',
  boletos: 'Precios, cupos y fechas de venta',
  formulario: 'Preguntas para quien se registra',
  accesos: 'Puertas o filas por donde entra la gente',
  modulos: 'Funciones que usa este evento',
};

export function EventNavigation<T extends string>({
  tabs,
  current,
  onSelect,
}: {
  tabs: readonly (readonly [T, string])[];
  current: T;
  onSelect: (tab: T) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const navigation = useRef<HTMLElement>(null);
  const currentGroup = groups.find((group) => group.tabs.includes(current));
  const currentLabel = tabs.find(([value]) => value === current)?.[1];

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!navigation.current?.contains(event.target as Node)) setOpen(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (open) {
          navigation.current
            ?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')
            ?.focus();
        }
        setOpen(null);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const select = (value: T) => {
    setOpen(null);
    onSelect(value);
  };

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.tabs.flatMap((key) =>
        tabs.filter(([value]) => value === key),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <nav
      className="event-navigation"
      aria-label="Secciones del evento"
      ref={navigation}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(null);
      }}
    >
      <div className="event-navigation-bar">
        {tabs
          .filter(([value]) => value === 'tablero')
          .map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`event-nav-trigger${current === value ? ' active' : ''}`}
              aria-current={current === value ? 'page' : undefined}
              onClick={() => select(value)}
            >
              {label}
            </button>
          ))}
        {visibleGroups.map((group) => {
          const expanded = open === group.label;
          const only = group.items.length === 1 ? group.items[0] : null;
          // Un grupo con una sola sección no necesita menú: un clic menos.
          if (only) {
            const [value, label] = only;
            return (
              <div className="event-nav-group" key={group.label}>
                <button
                  type="button"
                  className={`event-nav-trigger${current === value ? ' active' : ''}`}
                  aria-current={current === value ? 'page' : undefined}
                  onClick={() => select(value)}
                >
                  {label}
                </button>
              </div>
            );
          }
          return (
            <div className="event-nav-group" key={group.label}>
              <button
                type="button"
                className={`event-nav-trigger${currentGroup?.label === group.label ? ' active' : ''}`}
                aria-expanded={expanded}
                aria-controls={`event-nav-${group.tabs[0]}`}
                onClick={() => setOpen(expanded ? null : group.label)}
              >
                {group.label}
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
              {expanded && (
                <div
                  className="event-nav-dropdown"
                  id={`event-nav-${group.tabs[0]}`}
                >
                  {group.items.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-current={current === value ? 'page' : undefined}
                      className={current === value ? 'active' : ''}
                      onClick={() => select(value)}
                    >
                      <span className="event-nav-item-label">{label}</span>
                      {descriptions[value] && (
                        <span className="event-nav-item-desc">
                          {descriptions[value]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <label className="event-navigation-mobile field">
        <span>Sección del evento</span>
        <select
          value={current}
          onChange={(event) => select(event.target.value as T)}
        >
          {tabs
            .filter(([value]) => value === 'tablero')
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          {visibleGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="event-navigation-location">
        {currentGroup && (
          <>
            <span>{currentGroup.label}</span>
            <span aria-hidden="true">/</span>
          </>
        )}
        <strong>{currentLabel}</strong>
        {descriptions[current] && (
          <span className="event-navigation-hint">
            · {descriptions[current]}
          </span>
        )}
      </p>
    </nav>
  );
}

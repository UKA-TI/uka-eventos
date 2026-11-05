import { useEffect, useRef, useState } from 'react';

const groups = [
  { label: 'Invitados y mesas', tabs: ['invitados', 'mesas', 'acomodo'] },
  { label: 'Compras y pagos', tabs: ['registros', 'finanzas'] },
  { label: 'Control de acceso', tabs: ['checkin', 'operadores'] },
  {
    label: 'Configuración',
    tabs: ['resumen', 'boletos', 'formulario', 'modulos'],
  },
];

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
        {groups.map((group) => {
          const items = group.tabs.flatMap((key) =>
            tabs.filter(([value]) => value === key),
          );
          if (!items.length) return null;
          const expanded = open === group.label;
          return (
            <div className="event-nav-group" key={group.label}>
              <button
                type="button"
                className={`event-nav-trigger${currentGroup === group ? ' active' : ''}`}
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
                  {items.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-current={current === value ? 'page' : undefined}
                      className={current === value ? 'active' : ''}
                      onClick={() => select(value)}
                    >
                      {label}
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
          {groups.map((group) => {
            const items = group.tabs.flatMap((key) =>
              tabs.filter(([value]) => value === key),
            );
            return items.length > 0 ? (
              <optgroup key={group.label} label={group.label}>
                {items.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
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
      </p>
    </nav>
  );
}

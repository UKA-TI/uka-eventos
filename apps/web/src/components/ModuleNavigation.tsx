import type { ReactNode } from 'react';
import { Icon } from './icons.js';

/** Un mismo menú: barra con iconos en escritorio y selector en espacios estrechos. */
export function ModuleNavigation<T extends string>({
  label,
  current,
  items,
  onSelect,
  children,
}: {
  label: string;
  current: T;
  items: readonly (readonly [T, string, string?])[];
  onSelect: (value: T) => void;
  children: ReactNode;
}) {
  const groups = [...new Set(items.map((item) => item[2]).filter(Boolean))];
  return (
    <div className="module-navigation">
      <div className="module-navigation-desktop">{children}</div>
      <label className="field module-navigation-mobile">
        <span className="module-navigation-label">
          <Icon name="layers" />
          {label}
        </span>
        <select
          value={current}
          onChange={(event) => {
            const item = items.find(([value]) => value === event.target.value);
            if (item) onSelect(item[0]);
          }}
        >
          {items
            .filter((item) => !item[2])
            .map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {items
                .filter((item) => item[2] === group)
                .map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditCategories, matchesFolio } from '@uka/shared';
import { describe, expect, it } from 'vitest';
import {
  auditActionLabels,
  auditDetailText,
} from '../src/modules/compliance/audit-labels.js';

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('audit log wording', () => {
  const actions = [
    ...new Set(
      sources(join(import.meta.dirname, '../src/modules')).flatMap((path) =>
        [
          ...readFileSync(path, 'utf8').matchAll(
            /action: '([a-z_]+\.[a-z_]+)'/g,
          ),
        ].map((match) => match[1] as string),
      ),
    ),
  ];

  it('finds the actions in the code', () => {
    expect(actions).toContain('payment.record');
    expect(actions.length).toBeGreaterThan(40);
  });

  it('has readable text for every action in the code', () => {
    expect(actions.filter((action) => !auditActionLabels[action])).toEqual([]);
  });

  it('files every action under an area', () => {
    const prefixes = auditCategories.flatMap((category) => category.prefixes);
    const orphans = Object.keys(auditActionLabels).filter(
      (action) => !prefixes.some((prefix) => action.startsWith(prefix)),
    );
    expect(orphans).toEqual([]);
  });

  it('turns stored details into one readable line', () => {
    expect(
      auditDetailText({ folio: 'GAL27-0007', reason: 'No trae su pase' }),
    ).toBe('Folio GAL27-0007 · Motivo: No trae su pase');
    expect(auditDetailText({ previous: 'draft', status: 'active' })).toBe(
      'Estado: Borrador → Activo',
    );
    expect(
      auditDetailText({
        previousRole: 'Consulta',
        role: 'Recepción',
        previousStatus: 'active',
        status: 'active',
      }),
    ).toBe('Perfil: Consulta → Recepción · Estado: Activo');
    expect(auditDetailText({ amount: 5500, method: 'transfer' })).toBe(
      '$5,500.00',
    );
    expect(auditDetailText({ permissions: ['events.view'] })).toBe('');
    expect(auditDetailText(null)).toBe('');
  });
});

describe('typing a folio at the door', () => {
  it('accepts the whole folio in any case and with spaces', () => {
    expect(matchesFolio('GAL27-0127', 'GAL27-0127')).toBe(true);
    expect(matchesFolio('GAL27-0127', ' gal27-0127 ')).toBe(true);
    expect(matchesFolio('GAL27-0127', 'gal270127')).toBe(true);
  });

  it('accepts only the consecutive number', () => {
    expect(matchesFolio('GAL27-0127', '127')).toBe(true);
    expect(matchesFolio('GAL27-0127', '0127')).toBe(true);
  });

  it('does not confuse similar folios', () => {
    expect(matchesFolio('GAL27-0127', '12')).toBe(false);
    expect(matchesFolio('GAL27-0127', '1270')).toBe(false);
    expect(matchesFolio('GAL27-0127', 'GAL27-0128')).toBe(false);
    expect(matchesFolio('GAL27-0127', 'GAL')).toBe(false);
    expect(matchesFolio('GAL27-0127', '')).toBe(false);
    expect(matchesFolio('GAL27-0127', '0')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  proposeSeating,
  type PlanGroup,
  type PlanTable,
} from '../src/modules/seating/seating-plan.js';

const table = (
  name: string,
  capacity = 10,
  extra: Partial<PlanTable> = {},
): PlanTable => ({
  id: name,
  name,
  capacity,
  zone: null,
  x: 0,
  y: 0,
  lockedSeats: 0,
  ...extra,
});

const group = (
  key: string,
  seats: number | number[],
  extra: Partial<PlanGroup> = {},
): PlanGroup => ({
  key,
  label: key,
  zone: null,
  lockedTableIds: [],
  orders: (Array.isArray(seats) ? seats : [seats]).map((count, index) => ({
    orderId: `${key}-${index}`,
    seats: count,
  })),
  ...extra,
});

const tablesOf = (result: ReturnType<typeof proposeSeating>, key: string) => [
  ...new Set(
    result.allocations
      .filter((item) => item.orderId.startsWith(`${key}-`))
      .map((item) => item.tableId),
  ),
];

const seated = (result: ReturnType<typeof proposeSeating>, tableId: string) =>
  result.allocations
    .filter((item) => item.tableId === tableId)
    .reduce((sum, item) => sum + item.seats, 0);

describe('seating proposal', () => {
  it('keeps every purchase of a company at the same table', () => {
    const result = proposeSeating(
      [table('Mesa 1'), table('Mesa 2')],
      [group('soriana', [4, 3, 2]), group('otra', 9)],
    );
    expect(tablesOf(result, 'soriana')).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.unplacedSeats).toBe(0);
  });

  it('fills tables, seating small groups in the leftover space', () => {
    const result = proposeSeating(
      [table('Mesa 1'), table('Mesa 2')],
      [group('a', 8), group('b', 6), group('c', 2), group('d', 4)],
    );
    expect(result.unplacedSeats).toBe(0);
    expect(seated(result, 'Mesa 1')).toBe(10);
    expect(seated(result, 'Mesa 2')).toBe(10);
  });

  it('never exceeds capacity', () => {
    const result = proposeSeating(
      [table('Mesa 1', 8), table('Mesa 2', 8)],
      [group('a', 5), group('b', 5), group('c', 5)],
    );
    expect(seated(result, 'Mesa 1')).toBeLessThanOrEqual(8);
    expect(seated(result, 'Mesa 2')).toBeLessThanOrEqual(8);
    expect(result.unplacedSeats).toBe(5);
  });

  it('warns instead of splitting a group that would fit in an empty table', () => {
    const result = proposeSeating(
      [table('Mesa 1'), table('Mesa 2')],
      [group('a', 6), group('b', 6), group('c', 6)],
    );
    expect(result.unplacedSeats).toBe(6);
    const warning = result.warnings[0];
    expect(warning?.kind).toBe('no_fit');
    expect(warning?.message).toContain('no caben juntos');
    // Quien no cupo queda sin mesa: no se parte para llenar los huecos.
    expect(seated(result, 'Mesa 1') + seated(result, 'Mesa 2')).toBe(12);
  });

  it('splits a group larger than any table, near each other, and says so', () => {
    const result = proposeSeating(
      [
        table('Mesa 1', 10, { x: 0, y: 0 }),
        table('Mesa 2', 10, { x: 10, y: 0 }),
        table('Mesa 3', 10, { x: 90, y: 90 }),
      ],
      [group('grande', 15)],
    );
    expect(result.unplacedSeats).toBe(0);
    expect(tablesOf(result, 'grande').sort()).toEqual(['Mesa 1', 'Mesa 2']);
    expect(result.warnings[0]?.kind).toBe('split');
  });

  it('reserves zones for their groups, and uses them only as a last resort', () => {
    const vip = table('VIP 1', 10, { zone: 'VIP' });
    const common = table('Mesa 1');
    const result = proposeSeating(
      [common, vip],
      [group('normal', 4), group('patrocinador', 8, { zone: 'VIP' })],
    );
    expect(tablesOf(result, 'patrocinador')).toEqual(['VIP 1']);
    expect(tablesOf(result, 'normal')).toEqual(['Mesa 1']);

    const onlyVip = proposeSeating([vip], [group('normal', 4)]);
    expect(tablesOf(onlyVip, 'normal')).toEqual(['VIP 1']);
  });

  it('warns when a zone is full', () => {
    const result = proposeSeating(
      [table('VIP 1', 4, { zone: 'VIP' }), table('Mesa 1')],
      [group('p', 8, { zone: 'VIP' })],
    );
    expect(tablesOf(result, 'p')).toEqual(['Mesa 1']);
    expect(result.warnings[0]?.kind).toBe('outside_zone');
  });

  it('respects what the team locked and completes a group at its table', () => {
    const result = proposeSeating(
      [table('Mesa 1', 10, { lockedSeats: 7 }), table('Mesa 2')],
      [group('fijo', 2, { lockedTableIds: ['Mesa 1'] }), group('grande', 8)],
    );
    expect(tablesOf(result, 'fijo')).toEqual(['Mesa 1']);
    expect(seated(result, 'Mesa 1')).toBe(2);
    expect(tablesOf(result, 'grande')).toEqual(['Mesa 2']);
  });

  it('reports everything as unplaced when there are no tables', () => {
    const result = proposeSeating([], [group('a', 3)]);
    expect(result.allocations).toEqual([]);
    expect(result.unplacedSeats).toBe(3);
    expect(result.warnings).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';

import { NBSP, rowLoadCell, rowValueCell, targetBrief } from '../src/index';

const plain = (s: string | null) => (s ?? '').replaceAll(NBSP, ' ');

describe('targetBrief: the open table row’s short target (18 Oct)', () => {
  it('reps range and target RPE, no load (the load is in its own cell)', () => {
    expect(plain(targetBrief({ reps: { min: 3, max: 6 }, durationS: null }, 8.5))).toBe('3–6 @ 8.5');
    expect(plain(targetBrief({ reps: { min: 8, max: 8 }, durationS: null }, null))).toBe('8');
  });

  it('time and distance targets', () => {
    expect(targetBrief({ reps: null, durationS: 45 }, null)).toBe('0:45');
    expect(plain(targetBrief({ reps: null, durationS: null, distanceM: 20 }, null))).toBe('20 m');
  });

  it('nothing to say is null', () => {
    expect(targetBrief({ reps: null, durationS: null }, null)).toBeNull();
  });
});

describe('row cells', () => {
  it('per-hand dumbbells, assisted and lb read as numbers; bodyweight has no load cell', () => {
    expect(rowLoadCell({ value: 22.5, unit: 'kg', convention: 'per_hand' }, 'per_hand', { kind: 'dumbbells' })).toBe('22.5');
    expect(rowLoadCell({ value: 135, unit: 'lb', convention: 'total' }, 'total', { kind: 'barbell' })).toBe('135');
    expect(rowLoadCell({ value: 30, unit: 'kg', convention: 'assistance' }, 'assistance', { kind: 'assisted_stack' })).toBe('30');
    expect(rowLoadCell(null, 'bodyweight', null)).toBeNull();
    expect(rowLoadCell(null, 'added', null)).toBe('BW');
  });

  it('value cells', () => {
    expect(rowValueCell({ load: null, reps: 6, durationS: null, rpe: null, rir: null }, 'reps')).toBe('6');
    expect(rowValueCell({ load: null, reps: null, durationS: null, rpe: null, rir: null }, 'reps')).toBe('—');
    expect(rowValueCell({ load: null, reps: null, durationS: 40, rpe: null, rir: null }, 'duration')).toBe('0:40');
  });
});

import { describe, expect, it } from 'vitest';
import type { Load, LoadConvention, WeightUnit } from '@fizz/schemas';
import { calculateNextTargets, comparableSetsOf, importedWorkingSetCount, lastComparableSession, workingSetsFromPrevious, type HistorySession } from '../src/index';
import { doubleProgression, dumbbells } from './fixtures';

/**
 * Review import-progress B1, B2: how a FitNotes session is read. FitNotes has
 * no warm-up flag, so only the lighter sets before the top set are a ramp;
 * the top set and everything after it (back-offs, a descending pyramid) are
 * working sets. The set count to plan comes from the same reading and never
 * drops below the default because of it. Invented numbers.
 */

const RULE = doubleProgression({ repRange: { min: 8, max: 10 }, workingSets: 3, maxRpeToProgress: null });
const load = (value: number, convention: LoadConvention = 'per_hand', unit: WeightUnit = 'kg'): Load => ({ value, unit, convention });

function fitnotes(sets: readonly [number, number][], o: { convention?: LoadConvention; unit?: WeightUnit; day?: string } = {}): HistorySession {
  const day = o.day ?? '2026-09-15T12:00:00.000Z';
  return {
    sessionId: `fitnotes-${day}`,
    performedAtUtc: day,
    equipmentId: null,
    gymId: null,
    imported: true,
    sets: sets.map(([l, reps]) => ({ setType: 'working' as const, side: null, load: load(l, o.convention, o.unit), reps, rpe: null, rir: null })),
  };
}
const read = (h: HistorySession) => comparableSetsOf(h).map((x) => [x.load?.value, x.reps]);

function next(history: HistorySession[]) {
  return calculateNextTargets({
    exerciseName: 'Dumbbell press',
    measurement: 'reps',
    history,
    rule: RULE,
    equipment: dumbbells(),
    unit: 'kg',
    convention: 'per_hand',
    pain: { active: false, reportedAtUtc: null },
  });
}

describe('comparableSetsOf on FitNotes sessions (reading (a): a leading ramp only)', () => {
  it('a leading ramp is left out; equal top sets are the working sets', () => {
    expect(read(fitnotes([[10, 12], [15, 10], [20, 10], [20, 10], [20, 10]]))).toEqual([[20, 10], [20, 10], [20, 10]]);
  });

  it('ramp, top single, then back-offs: the top set and the back-offs are kept', () => {
    const h = fitnotes([[10, 10], [14, 5], [18, 3], [22, 4], [18, 9], [18, 9], [18, 8]]);
    expect(read(h)).toEqual([[22, 4], [18, 9], [18, 9], [18, 8]]);
  });

  it('a descending pyramid keeps every set', () => {
    expect(read(fitnotes([[24, 6], [20, 8], [16, 10]]))).toEqual([[24, 6], [20, 8], [16, 10]]);
  });

  it('a pyramid up and down keeps the top and the way down, not the way up', () => {
    expect(read(fitnotes([[10, 12], [16, 8], [20, 6], [16, 8], [10, 12]]))).toEqual([[20, 6], [16, 8], [10, 12]]);
  });

  it('assisted machines: the hardest set is the least assistance; more-assisted sets before it are the ramp, after it they count', () => {
    const h = fitnotes([[40, 10], [30, 8], [20, 6], [30, 8]], { convention: 'assistance' });
    expect(read(h)).toEqual([[20, 6], [30, 8]]);
  });

  it('lb sessions read the same way, per unit', () => {
    expect(read(fitnotes([[45, 10], [95, 5], [135, 5], [115, 8]], { convention: 'total', unit: 'lb' }))).toEqual([[135, 5], [115, 8]]);
  });

  it('logged in the app, sets are read as logged', () => {
    const h = fitnotes([[10, 12], [20, 10], [15, 10]]);
    expect(comparableSetsOf({ ...h, imported: false })).toHaveLength(3);
  });
});

describe('targets from FitNotes back-offs and pyramids (B1, B2)', () => {
  it('ramp, top single, back-offs: the rule plans from the back-off load, never every set at the top load', () => {
    const t = next([fitnotes([[10, 10], [14, 5], [18, 3], [22, 4], [17.5, 10], [17.5, 10], [17.5, 10]])]);
    // The top single (4 reps) is below the range: hold at the easiest counted load (the back-offs).
    expect(t.decision).toBe('hold_after_miss');
    expect(t.sets.every((x) => x.load !== null && x.load.value === 17.5)).toBe(true);
    expect(t.explanation.facts.join(' ')).toMatch(/lighter sets before the top set were read as warm-ups/);
  });

  it('a descending pyramid holds at its lightest set, and back-off sets are never called warm-ups', () => {
    const t = next([fitnotes([[22.5, 8], [20, 9], [17.5, 10]])]);
    expect(t.decision).toBe('hold');
    expect(t.sets.every((x) => x.load?.value === 17.5)).toBe(true);
    expect(t.explanation.facts.join(' ')).not.toMatch(/warm-ups/);
  });
});

describe('the set count planned from FitNotes (B1, B2)', () => {
  it('the same reading as the load, never below the default because of it; a short session keeps its own count; at most 10', () => {
    // 7 sets, a ramp to one top set: 3, not 1 and not 7.
    expect(importedWorkingSetCount(1, 7, 3)).toBe(3);
    // Top set and 3 back-offs: 4.
    expect(importedWorkingSetCount(4, 7, 3)).toBe(4);
    // Two sets done: two planned.
    expect(importedWorkingSetCount(2, 2, 3)).toBe(2);
    expect(importedWorkingSetCount(12, 12, 3)).toBe(10);
    expect(importedWorkingSetCount(0, 0, 3)).toBe(1);
  });

  it('Add exercise after a FitNotes ramp to a top single: Last shows the top set, the plan has the default 3 sets', () => {
    const h = fitnotes([[10, 10], [14, 6], [18, 4], [22, 3]]);
    const prev = lastComparableSession([h], { equipmentId: 'any-dumbbells', unit: 'kg', loadConvention: 'per_hand' });
    expect(prev?.sets.map((x) => x.values.load?.value)).toEqual([22]);
    expect(prev ? workingSetsFromPrevious(prev, [h]) : null).toBe(3);
  });

  it('Add exercise after top + back-offs: Last shows them all and plans that many', () => {
    const h = fitnotes([[10, 10], [22, 4], [18, 9], [18, 9], [18, 8]]);
    const prev = lastComparableSession([h], { equipmentId: 'any-dumbbells', unit: 'kg', loadConvention: 'per_hand' });
    expect(prev?.sets.map((x) => x.values.load?.value)).toEqual([22, 18, 18, 18]);
    expect(prev ? workingSetsFromPrevious(prev, [h]) : null).toBe(4);
  });

  it('logged in the app: the logged count, even below the default', () => {
    const h = { ...fitnotes([[20, 10], [20, 10]]), imported: false, equipmentId: 'db' };
    const prev = lastComparableSession([h], { equipmentId: 'db', unit: 'kg', loadConvention: 'per_hand' });
    expect(prev ? workingSetsFromPrevious(prev, [h]) : null).toBe(2);
  });
});

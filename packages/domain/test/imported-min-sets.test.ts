import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Load, LoadConvention, WeightUnit } from '@fizz/schemas';
import { calculateNextTargets, IMPORTED_HISTORY_DAYS, MIN_IMPORTED_SETS, type HistorySession } from '../src/index';
import { barbell, doubleProgression, dumbbells } from './fixtures';

/**
 * Ben, 19 Oct: "imported targets - say 3 sets of imported history". With the
 * latest comparable session from FitNotes, 3 judged sets across the run of
 * imported sessions are enough for the rule to judge that session, even when
 * the rule asks for more. Synthetic numbers only.
 */

const RULE = doubleProgression({ repRange: { min: 8, max: 10 }, workingSets: 3, maxRpeToProgress: null });
const DAY1 = '2026-09-08T12:00:00.000Z';
const DAY2 = '2026-09-11T12:00:00.000Z';
const DAY3 = '2026-09-15T12:00:00.000Z';
const load = (value: number, convention: LoadConvention, unit: WeightUnit): Load => ({ value, unit, convention });

function fitnotes(sets: readonly [number, number][], day: string, o: { convention?: LoadConvention; unit?: WeightUnit } = {}): HistorySession {
  return {
    sessionId: `fitnotes-${day}`,
    performedAtUtc: day,
    equipmentId: null,
    gymId: null,
    imported: true,
    sets: sets.map(([l, reps]) => ({ setType: 'working' as const, side: null, load: load(l, o.convention ?? 'per_hand', o.unit ?? 'kg'), reps, rpe: null, rir: null })),
  };
}

function sided(pairs: readonly [number, number][], day: string): HistorySession {
  const base = fitnotes([], day);
  return {
    ...base,
    sets: pairs.flatMap(([l, reps]) => (['left', 'right'] as const).map((side) => ({ setType: 'working' as const, side, load: load(l, 'per_hand', 'kg'), reps, rpe: null, rir: null }))),
  };
}

function inApp(sets: readonly [number, number][], day: string, eq: EquipmentInstance): HistorySession {
  return { ...fitnotes(sets, day), sessionId: `app-${day}`, imported: false, equipmentId: eq.id, gymId: eq.gymId };
}

const DB = dumbbells();

function next(history: HistorySession[], o: { equipment?: EquipmentInstance | null; convention?: LoadConvention; unit?: WeightUnit } = {}) {
  const equipment = o.equipment === undefined ? DB : o.equipment;
  return calculateNextTargets({
    exerciseName: 'Dumbbell press',
    measurement: 'reps',
    history,
    rule: RULE,
    equipment,
    unit: o.unit ?? 'kg',
    convention: o.convention ?? 'per_hand',
    pain: { active: false, reportedAtUtc: null },
    ...(equipment === null ? { fitLater: true } : {}),
  });
}
const facts = (t: ReturnType<typeof next>) => t.explanation.facts.join(' ');

describe('MIN_IMPORTED_SETS (Ben, 19 Oct)', () => {
  it('is 3, counted over imported workouts within 28 days of the latest', () => {
    expect(MIN_IMPORTED_SETS).toBe(3);
    expect(IMPORTED_HISTORY_DAYS).toBe(28);
  });

  it('review S1: a latest workout of 1 set with 2 sets from years before still holds', () => {
    const t = next([fitnotes([[20, 10]], DAY3), fitnotes([[10, 10], [10, 10]], '2022-03-01T12:00:00.000Z')]);
    expect(t.decision).toBe('hold');
    expect(t.sets.every((x) => x.load?.value === 20)).toBe(true);
    expect(facts(t)).not.toMatch(/imported history are enough/);
  });

  it('review S1: the window is 28 days from the latest imported workout, inclusive', () => {
    const at28 = '2026-08-18T12:00:00.000Z'; // 28 days before DAY3
    const at29 = '2026-08-17T12:00:00.000Z';
    expect(next([fitnotes([[20, 10], [20, 10]], DAY3), fitnotes([[20, 9]], at28)]).decision).toBe('increase_load');
    expect(next([fitnotes([[20, 10], [20, 10]], DAY3), fitnotes([[20, 9]], at29)]).decision).toBe('hold');
  });

  it('review S1: 1 set at the top with 2 recent imported sets (3 sets) progresses; an old session stops the count', () => {
    expect(next([fitnotes([[20, 10]], DAY3), fitnotes([[20, 9]], DAY2), fitnotes([[20, 9]], DAY1)]).decision).toBe('increase_load');
    // An old session between them ends the run, even with a recent-looking count behind it.
    expect(next([fitnotes([[20, 10]], DAY3), fitnotes([[20, 9], [20, 9]], '2025-01-10T12:00:00.000Z')]).decision).toBe('hold');
  });

  it('review S2: left/right pairs count once each (2 pairs + 1 earlier pair = 3 progresses; 2 pairs alone hold)', () => {
    const t = next([sided([[20, 10], [20, 10]], DAY3), sided([[20, 9]], DAY1)]);
    expect(t.decision).toBe('increase_load');
    expect(facts(t)).toMatch(/3 sets of imported history are enough/);
    // 4 rows but 2 pairs: still 2 sets of imported history.
    expect(next([sided([[20, 10], [20, 10]], DAY3)]).decision).toBe('hold');
  });

  it('a lone imported session of 2 sets at the top still holds (2 sets of imported history)', () => {
    const t = next([fitnotes([[20, 10], [20, 10]], DAY3)]);
    expect(t.decision).toBe('hold');
    expect(t.sets.every((x) => x.load?.value === 20)).toBe(true);
    expect(facts(t)).toMatch(/Only 2 of 3 working sets were judged on 2026-09-15; holding/);
  });

  it('2 sets at the top with 1 earlier imported set (3 sets of imported history) progress', () => {
    const t = next([fitnotes([[20, 10], [20, 10]], DAY3), fitnotes([[20, 9]], DAY1)]);
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load?.value === 22.5)).toBe(true);
    expect(facts(t)).toMatch(/Judged on the 2 working sets on 2026-09-15: 3 sets of imported history are enough\./);
    expect(facts(t)).not.toMatch(/holding/);
  });

  it('earlier imported sessions count at any load; the latest session alone decides the step', () => {
    const t = next([fitnotes([[20, 10], [20, 10]], DAY3), fitnotes([[17.5, 10], [17.5, 10]], DAY2)]);
    expect(t.decision).toBe('increase_load');
    // The latest misses the top on one set: no increase, whatever the history.
    expect(next([fitnotes([[20, 10], [20, 9]], DAY3), fitnotes([[20, 10], [20, 10]], DAY2)]).decision).not.toBe('increase_load');
  });

  it('a lone top set kept as context and a lighter finisher are not counted', () => {
    // 1 top + 2 back-offs: 2 judged; with nothing earlier, still a hold.
    expect(next([fitnotes([[25, 4], [17.5, 10], [17.5, 10]], DAY3)]).decision).toBe('hold');
    // 2 working sets + a finisher: 2 judged; still a hold.
    expect(next([fitnotes([[20, 10], [20, 10], [12.5, 15]], DAY3)]).decision).toBe('hold');
    // A ramp warm-up isn't a set of history either.
    expect(next([fitnotes([[10, 12], [20, 10], [20, 10]], DAY3)]).decision).toBe('hold');
    // With one judged set earlier: 3, progresses.
    expect(next([fitnotes([[25, 4], [17.5, 10], [17.5, 10]], DAY3), fitnotes([[17.5, 9]], DAY1)]).decision).toBe('increase_load');
  });

  it('only imported sessions from the latest back count: an in-app session ends the run, and in-app history needs the rule’s sets', () => {
    // Latest imported 2 sets, then an in-app session of 3: the run is 2 sets, so it holds.
    expect(next([fitnotes([[20, 10], [20, 10]], DAY3), inApp([[20, 9], [20, 9], [20, 9]], DAY2, DB)]).decision).toBe('hold');
    // Latest in app with 2 sets, imported history behind it: the rule's 3 sets still apply.
    const t = next([inApp([[20, 10], [20, 10]], DAY3, DB), fitnotes([[20, 10], [20, 10], [20, 10]], DAY1)]);
    expect(t.decision).toBe('hold');
    expect(facts(t)).toMatch(/Only 2 of 3 working sets were logged on 2026-09-15; holding/);
  });

  it('assisted: less assistance after 2 sets at the top with 3 sets of imported history', () => {
    const h = [fitnotes([[30, 10], [30, 10]], DAY3, { convention: 'assistance' }), fitnotes([[30, 9]], DAY1, { convention: 'assistance' })];
    const t = next(h, { equipment: null, convention: 'assistance' });
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load !== null && x.load.value < 30)).toBe(true);
    expect(next([h[0] as HistorySession], { equipment: null, convention: 'assistance' }).decision).toBe('hold');
  });

  it('lb on a lb bar, total convention: the same count applies', () => {
    const lbBar = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 25, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] });
    const h = [fitnotes([[135, 10], [135, 10]], DAY3, { convention: 'total', unit: 'lb' }), fitnotes([[135, 8]], DAY1, { convention: 'total', unit: 'lb' })];
    const t = next(h, { equipment: lbBar, convention: 'total', unit: 'lb' });
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load?.unit === 'lb' && x.load.value > 135)).toBe(true);
    expect(next([h[0] as HistorySession], { equipment: lbBar, convention: 'total', unit: 'lb' }).decision).toBe('hold');
  });

  it('never past the equipment max: at the rack’s heaviest, 3 sets of history progress reps, not load', () => {
    const t = next([fitnotes([[30, 10], [30, 10]], DAY3), fitnotes([[30, 10]], DAY1)]);
    expect(t.decision).not.toBe('increase_load');
    expect(t.sets.every((x) => x.load?.value === 30)).toBe(true);
  });

  it('pain still stops it', () => {
    const t = calculateNextTargets({ exerciseName: 'Dumbbell press', measurement: 'reps', history: [fitnotes([[20, 10], [20, 10]], DAY3), fitnotes([[20, 10]], DAY1)], rule: RULE, equipment: DB, unit: 'kg', convention: 'per_hand', pain: { active: true, reportedAtUtc: DAY3 } });
    expect(t.decision).toBe('halted_pain');
  });
});

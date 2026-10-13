import { describe, expect, it } from 'vitest';
import type { Load, LoadConvention, WeightUnit } from '@fizz/schemas';
import { calculateNextTargets, comparableSetsOf, importedWorkingSetCount, lastComparableSession, readFitNotesWorkingSets, workingSetsFromPrevious, type HistorySession } from '../src/index';
import { barbell, doubleProgression, dumbbells } from './fixtures';

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
  it('ramp, top single, back-offs at the top of the range: increase from the back-off load (r2 B1)', () => {
    const t = next([fitnotes([[10, 10], [14, 5], [18, 3], [22, 4], [17.5, 10], [17.5, 10], [17.5, 10]])]);
    // The top single (4 reps) is context, not a miss at 17.5 kg: every set at 17.5 kg hit 10.
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load !== null && x.load.value === 20)).toBe(true);
    const facts = t.explanation.facts.join(' ');
    expect(facts).toMatch(/lighter sets before the top set were read as warm-ups/);
    expect(facts).toMatch(/1 heavier top set was kept as context; reps were judged on the 3 sets at 17\.5 kg/);
    expect(facts).toMatch(/all 3 judged sets reached 10\+ reps at 17\.5 kg/);
  });

  it('a descending pyramid holds at its lightest set when that set is below the top, and back-off sets are never called warm-ups', () => {
    const t = next([fitnotes([[22.5, 8], [20, 9], [17.5, 9]])]);
    expect(t.decision).toBe('hold');
    expect(t.sets.every((x) => x.load?.value === 17.5)).toBe(true);
    expect(t.explanation.facts.join(' ')).not.toMatch(/warm-ups/);
  });

  it('r3 B1: a descending pyramid is judged on every set, so its lightest set alone hitting the top holds', () => {
    const t = next([fitnotes([[22.5, 8], [20, 9], [17.5, 10]])]);
    expect(t.decision).toBe('hold');
    expect(t.sets.every((x) => x.load?.value === 17.5)).toBe(true);
    expect(t.explanation.facts.join(' ')).toMatch(/No load had most of the sets, so reps were judged on all 3 sets; the plan is from the easiest, 17\.5 kg each/);
  });

  it('r3 B1: a descending pyramid with every set at the top of the range progresses from its easiest load', () => {
    const t = next([fitnotes([[22.5, 10], [20, 10], [17.5, 10]])]);
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load?.value === 20)).toBe(true);
    expect(t.explanation.facts.join(' ')).toMatch(/all 3 judged sets reached 10\+ reps, the easiest at 17\.5 kg each/);
  });

  it('back-offs in range but below the top: hold, not hold_after_miss', () => {
    const t = next([fitnotes([[10, 10], [22.5, 3], [20, 9], [20, 9], [20, 8]])]);
    expect(t.decision).toBe('hold');
    expect(t.sets.every((x) => x.load?.value === 20)).toBe(true);
  });
});

describe('two FitNotes sessions of a top single then back-offs (r2 B1)', () => {
  const DAY1 = '2026-09-10T12:00:00.000Z';
  const DAY2 = '2026-09-13T12:00:00.000Z';

  it('in-range back-offs twice in a row: never reduce, and no miss is claimed at the back-off load', () => {
    const shape: [number, number][] = [[10, 10], [15, 5], [22.5, 3], [20, 10], [20, 10], [20, 10]];
    const t = next([fitnotes(shape, { day: DAY1 }), fitnotes(shape, { day: DAY2 })]);
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load?.value === 22.5)).toBe(true);
    expect(t.explanation.facts.join(' ')).not.toMatch(/fell below/);
  });

  it("the review's barbell case (40x10, 60x5, 80x3, 70x10 x3, twice; 8-10): increase, never reduce", () => {
    const shape: [number, number][] = [[40, 10], [60, 5], [80, 3], [70, 10], [70, 10], [70, 10]];
    const t = calculateNextTargets({
      exerciseName: 'Bench press',
      measurement: 'reps',
      history: [fitnotes(shape, { day: DAY1, convention: 'total' }), fitnotes(shape, { day: DAY2, convention: 'total' })],
      rule: RULE,
      equipment: barbell(),
      unit: 'kg',
      convention: 'total',
      pain: { active: false, reportedAtUtc: null },
    });
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load !== null && x.load.value > 70)).toBe(true);
    expect(t.explanation.facts.join(' ')).not.toMatch(/fell below 8 reps at 70/);
  });

  it('lb: in-range back-offs after a top single progress the same way', () => {
    const shape: [number, number][] = [[95, 5], [185, 2], [155, 10], [155, 10], [155, 10]];
    const lbBar = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 25, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] });
    const t = calculateNextTargets({
      exerciseName: 'Bench press',
      measurement: 'reps',
      history: [fitnotes(shape, { day: DAY1, convention: 'total', unit: 'lb' }), fitnotes(shape, { day: DAY2, convention: 'total', unit: 'lb' })],
      rule: RULE,
      equipment: lbBar,
      unit: 'lb',
      convention: 'total',
      pain: { active: false, reportedAtUtc: null },
    });
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load?.unit === 'lb' && x.load.value > 155)).toBe(true);
  });

  it('a genuine miss at the back-off load: one session holds after the miss', () => {
    const t = next([fitnotes([[10, 10], [22.5, 3], [20, 7], [20, 7], [20, 7]], { day: DAY2 })]);
    expect(t.decision).toBe('hold_after_miss');
    expect(t.sets.every((x) => x.load?.value === 20)).toBe(true);
  });

  it('a genuine miss at the back-off load twice in a row: reduce, naming the load the miss was at', () => {
    const shape: [number, number][] = [[10, 10], [22.5, 3], [20, 7], [20, 7], [20, 7]];
    const t = next([fitnotes(shape, { day: DAY1 }), fitnotes(shape, { day: DAY2 })]);
    expect(t.decision).toBe('reduce_load');
    expect(t.explanation.facts.join(' ')).toMatch(/2 sessions in a row fell below 8 reps at 20 kg/);
    expect(t.sets.every((x) => x.load !== null && x.load.value < 20)).toBe(true);
  });

  it('in the app, a heavier set still counts toward a miss (logged history is read as logged)', () => {
    const t = next([{ ...fitnotes([[22.5, 3], [20, 10], [20, 10], [20, 10]], { day: DAY2 }), imported: false, equipmentId: dumbbells().id }]);
    expect(t.decision).toBe('hold_after_miss');
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

  it('Add exercise after top + back-offs: Last shows them all; the plan has the back-offs only (r3 S1)', () => {
    const h = fitnotes([[10, 10], [22, 4], [18, 9], [18, 9], [18, 8]]);
    const prev = lastComparableSession([h], { equipmentId: 'any-dumbbells', unit: 'kg', loadConvention: 'per_hand' });
    expect(prev?.sets.map((x) => x.values.load?.value)).toEqual([22, 18, 18, 18]);
    expect(prev ? workingSetsFromPrevious(prev, [h]) : null).toBe(3);
  });

  it('Add exercise after 4 working sets and a lighter finisher: plans the 4 working sets (r3 S1)', () => {
    const h = fitnotes([[20, 10], [20, 10], [20, 10], [20, 9], [12, 15]]);
    const prev = lastComparableSession([h], { equipmentId: 'any-dumbbells', unit: 'kg', loadConvention: 'per_hand' });
    expect(prev ? workingSetsFromPrevious(prev, [h]) : null).toBe(4);
  });

  it('logged in the app: the logged count, even below the default', () => {
    const h = { ...fitnotes([[20, 10], [20, 10]]), imported: false, equipmentId: 'db' };
    const prev = lastComparableSession([h], { equipmentId: 'db', unit: 'kg', loadConvention: 'per_hand' });
    expect(prev ? workingSetsFromPrevious(prev, [h]) : null).toBe(2);
  });
});

describe('the working load of a FitNotes session (r3 B1: the load with the most sets, ties to the easiest)', () => {
  const ref = (sets: readonly [number, number][], convention: LoadConvention = 'per_hand') => {
    const r = readFitNotesWorkingSets(comparableSetsOf(fitnotes(sets, { convention })));
    const v = (xs: readonly { load: Load | null }[]) => xs.map((x) => x.load?.value);
    return { load: r.reference?.value, judged: v(r.judged), context: v(r.context), harderJudged: v(r.harderJudged), easier: v(r.easier) };
  };

  it('working sets then a finisher: the working load, the finisher not judged', () => {
    expect(ref([[20, 10], [20, 10], [20, 10], [12, 15]])).toEqual({ load: 20, judged: [20, 20, 20], context: [], harderJudged: [], easier: [12] });
  });

  it('a top single then back-offs: the back-off load, the top single as context', () => {
    expect(ref([[22, 4], [18, 9], [18, 9], [18, 8]])).toEqual({ load: 18, judged: [18, 18, 18], context: [22], harderJudged: [], easier: [] });
  });

  it('two heavier sets then two back-offs: a tie goes to the easiest, and the heavier sets are judged (not fewer)', () => {
    expect(ref([[22, 8], [22, 8], [18, 10], [18, 10]])).toEqual({ load: 18, judged: [22, 22, 18, 18], context: [], harderJudged: [22, 22], easier: [] });
  });

  it('assisted: the reference is the most-assisted of tied loads; a less-assisted single is context', () => {
    expect(ref([[20, 6], [30, 9], [30, 9]], 'assistance')).toEqual({ load: 30, judged: [30, 30], context: [20], harderJudged: [], easier: [] });
  });

  it('no loads: every kept set is judged', () => {
    const h: HistorySession = { ...fitnotes([[0, 10]]), sets: [{ setType: 'working', side: null, load: null, reps: 10, rpe: null, rir: null }] };
    expect(readFitNotesWorkingSets(comparableSetsOf(h)).judged).toHaveLength(1);
  });
});

describe('targets from FitNotes working sets with a lighter finisher (r3 B1)', () => {
  const DAY1 = '2026-09-10T12:00:00.000Z';
  const DAY2 = '2026-09-13T12:00:00.000Z';

  it('3 sets at the top of the range at 20, then a 12 kg finisher: increase from 20, and the finisher is said to be not judged', () => {
    const t = next([fitnotes([[20, 10], [20, 10], [20, 10], [12, 15]])]);
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load?.value === 22.5)).toBe(true);
    const facts = t.explanation.facts.join(' ');
    expect(facts).toMatch(/1 lighter set than 20 kg each \(a finisher or drop set\) was not judged/);
    expect(facts).toMatch(/all 3 judged sets reached 10\+ reps at 20 kg each/);
    expect(facts).not.toMatch(/kept as context/);
  });

  it('3 sets below the floor at 20, then a finisher in range: hold after the miss at 20', () => {
    const t = next([fitnotes([[20, 7], [20, 7], [20, 7], [16, 12]], { day: DAY2 })]);
    expect(t.decision).toBe('hold_after_miss');
    expect(t.sets.every((x) => x.load?.value === 20)).toBe(true);
  });

  it('the same miss twice in a row: reduce, naming 20 kg', () => {
    const shape: [number, number][] = [[20, 7], [20, 7], [20, 7], [16, 12]];
    const t = next([fitnotes(shape, { day: DAY1 }), fitnotes(shape, { day: DAY2 })]);
    expect(t.decision).toBe('reduce_load');
    expect(t.explanation.facts.join(' ')).toMatch(/2 sessions in a row fell below 8 reps at 20 kg each/);
    expect(t.sets.every((x) => x.load !== null && x.load.value < 20)).toBe(true);
  });

  it('lb, barbell: working sets at 135 and a lighter finisher increase from 135', () => {
    const lbBar = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 25, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] });
    const t = calculateNextTargets({
      exerciseName: 'Bench press',
      measurement: 'reps',
      history: [fitnotes([[95, 10], [135, 10], [135, 10], [135, 10], [95, 15]], { convention: 'total', unit: 'lb' })],
      rule: RULE,
      equipment: lbBar,
      unit: 'lb',
      convention: 'total',
      pain: { active: false, reportedAtUtc: null },
    });
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load?.unit === 'lb' && x.load.value > 135)).toBe(true);
  });

  it('the up-and-down pyramid is not increased from its 10 kg tail: every kept set is judged, so a 6-rep set holds', () => {
    const t = next([fitnotes([[10, 12], [16, 8], [20, 6], [16, 8], [10, 12]])]);
    expect(t.decision).toBe('hold');
    expect(t.sets.every((x) => x.load?.value === 10)).toBe(true);
    // A harder set below the range is not a miss at the planned load (r2 B1): two sessions never reduce.
    const twice = next([fitnotes([[10, 12], [16, 8], [20, 6], [16, 8], [10, 12]], { day: DAY1 }), fitnotes([[10, 12], [16, 8], [20, 6], [16, 8], [10, 12]], { day: DAY2 })]);
    expect(twice.decision).toBe('hold');
  });

  it('assisted: a less-assisted top set is context and the fact says "less-assisted", not "heavier"', () => {
    const t = calculateNextTargets({
      exerciseName: 'Assisted pull-up',
      measurement: 'reps',
      history: [fitnotes([[20, 6], [30, 10], [30, 10], [30, 10]], { convention: 'assistance' })],
      rule: RULE,
      equipment: null,
      unit: 'kg',
      convention: 'assistance',
      pain: { active: false, reportedAtUtc: null },
      fitLater: true,
    });
    expect(t.decision).toBe('increase_load');
    expect(t.sets.every((x) => x.load !== null && x.load.value < 30)).toBe(true);
    const facts = t.explanation.facts.join(' ');
    expect(facts).toMatch(/1 less-assisted top set was kept as context; reps were judged on the 3 sets at assist 30 kg/);
    expect(facts).not.toMatch(/heavier/);
  });
});

describe('only judged sets make up the rule (r3 S1)', () => {
  it('one heavy set, then a single back-off at the top of the range: no increase under a 3-set rule', () => {
    const t = next([fitnotes([[22.5, 5], [17.5, 10]])]);
    expect(t.decision).not.toBe('increase_load');
  });

  it('a top single then two back-offs at the top: 2 of 3 judged, hold', () => {
    const t = next([fitnotes([[22.5, 4], [17.5, 10], [17.5, 10]])]);
    expect(t.decision).toBe('hold');
    expect(t.sets.every((x) => x.load?.value === 17.5)).toBe(true);
    expect(t.explanation.facts.join(' ')).toMatch(/Only 2 of 3 working sets were judged on 2026-09-15; holding/);
  });

  it('the planned count leaves out the context set and the finisher', () => {
    expect(importedWorkingSetCount(readFitNotesWorkingSets(comparableSetsOf(fitnotes([[22, 4], [18, 10], [18, 10], [18, 10], [18, 10]]))).judged.length, 5, 3)).toBe(4);
    expect(importedWorkingSetCount(readFitNotesWorkingSets(comparableSetsOf(fitnotes([[20, 10], [20, 10], [20, 10], [12, 15]]))).judged.length, 4, 3)).toBe(3);
  });
});

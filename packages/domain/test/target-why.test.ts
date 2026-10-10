import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, PainFlag, SessionAggregate, SetValues } from '@fizz/schemas';

import {
  basisSetsText,
  buildActiveSetView,
  buildAddExerciseCommand,
  buildStepCard,
  calculateNextTargets,
  clearPainFlag,
  explainTarget,
  NBSP,
  newPainFlag,
  painStatusFor,
  plannedSetsFromTargets,
  startWorkout,
  startWorkoutFromSession,
  toHistorySessions,
  type ExplainTargetInput,
  type HistorySession,
  type NextTargets,
  type TargetExplanation,
} from '../src/index';
import { assisted, at, barbell, doubleProgression, dumbbells, exercise, GYM, id, idGen, kg, ms, OWNER, profile, stack, values } from './fixtures';
import { apply, BENCH, exercises, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/** Domain text uses no-break spaces; tests read it with plain spaces. */
const plain = (s: string) => s.replaceAll(NBSP, ' ');
const DAY = 86_400;
const WEEK = 7 * DAY;
const BAR = barbell();
const owner = profile();
const benchEx = exercises.get(BENCH) ?? exercise(200, 'Bench press');
const GYMS = { [GYM]: 'Main Gym' };

/** Rows as `[label, ...lines]` with plain spaces, for whole-panel comparisons. */
const rowsOf = (e: TargetExplanation | null) => (e?.rows ?? []).map((r) => [r.label, ...r.lines.map(plain)]);

let idBase = 50_000;
/** An empty workout `day` days after T0 with one exercise, `logs` logged as working sets, then finished. */
function finished(day: number, logs: SetValues[], ex: Exercise = benchEx, eq: EquipmentInstance | null = BAR): SessionAggregate {
  const ids = idGen((idBase += 1_000));
  const t = day * DAY;
  let s = startWorkout({ opId: `start-${String(day)}`, owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: eq ? [eq] : [], at: at(t), newId: ids }).aggregate;
  const plan = logs.map(() => ({ setType: 'working' as const, planned: { load: null, reps: null, durationS: null, rpe: null, rir: null } }));
  s = apply(s, buildAddExerciseCommand({ opId: `add-${String(day)}`, owner, exercise: ex, equipmentId: eq?.id ?? null, at: at(t + 1), newId: ids, plan }));
  const sets = s.sets.slice();
  logs.forEach((v, i) => {
    s = apply(s, logCmd(sets[i]?.id ?? '', v, t + 100 * (i + 1)));
  });
  return apply(s, { type: 'finish', at: at(t + 1_000), opId: `fin-${String(day)}`, expectedVersion: s.session.version, endedAt: null });
}

function rule(history: HistorySession[], eq: EquipmentInstance | null, flags: readonly PainFlag[] = [], ex: Exercise = benchEx): NextTargets {
  return calculateNextTargets({
    exerciseName: ex.name,
    measurement: 'reps',
    history,
    rule: doubleProgression({ workingSets: 2 }),
    equipment: eq,
    unit: 'kg',
    convention: eq?.loadConvention ?? ex.defaultLoadConvention,
    pain: painStatusFor(flags, ex.id),
  });
}

/** Today's workout: the exercise added with the built-in rule's targets, provenance stored as the app does. */
function today(day: number, history: HistorySession[], opts: { eq?: EquipmentInstance | null; ex?: Exercise; flags?: readonly PainFlag[]; why?: boolean } = {}): SessionAggregate {
  const eq = opts.eq === undefined ? BAR : opts.eq;
  const ex = opts.ex ?? benchEx;
  const ids = idGen((idBase += 1_000));
  const t = day * DAY;
  const result = rule(history, eq, opts.flags ?? [], ex);
  const plan = plannedSetsFromTargets(result, opts.why === false ? undefined : { history, equipment: eq, at: at(t + 1) });
  let s = startWorkout({ opId: `today-${String(day)}`, owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: eq ? [eq] : [], at: at(t), newId: ids }).aggregate;
  s = apply(s, buildAddExerciseCommand({ opId: `today-add-${String(day)}`, owner, exercise: ex, equipmentId: eq?.id ?? null, at: at(t + 1), newId: ids, plan }));
  return s;
}

function explain(aggregate: SessionAggregate, over: Partial<ExplainTargetInput> = {}): TargetExplanation | null {
  return explainTarget({ aggregate, setId: aggregate.sets[0]?.id ?? '', nowMs: ms(10 * DAY), basisNow: null, gymNames: GYMS, painFlags: [], history: [], ...over });
}

const hist = (...sessions: SessionAggregate[]) => sessions.flatMap((s) => toHistorySessions(s, s.exercises[0]?.exerciseId ?? '', { identity: true }));

function flag(day: number, over: Partial<PainFlag> = {}): PainFlag {
  return { ...newPainFlag({ id: id(7_000 + day), ownerId: OWNER, opId: `pain-${String(day)}`, exerciseId: BENCH, exerciseName: 'Bench press', area: 'shoulder', source: 'check_in', checkInId: null, at: at(day * DAY) }), ...over };
}

describe('explainTarget: built-in rule target (check 39)', () => {
  const basis = finished(0, [values(kg(100), 8, { rpe: 8 }), values(kg(100), 8, { rpe: 8 })]);
  const h = hist(basis);
  const now = today(2, h);

  it('shows who set it and after which workout, the sets it used (actual), the rule’s own words and the step', () => {
    const e = explain(now, { basisNow: basis, history: h });
    const result = rule(h, BAR);
    const card = buildStepCard(BAR, kg(100));
    expect(e?.recorded).toBe(true);
    expect(rowsOf(e)).toEqual([
      ['Set by', 'Built-in rule · after your 8 Oct workout', 'Double progression 6–8'],
      ['Last time', '100 kg × 8, 8', 'RPE 8, 8', '8 Oct · Main Gym · Olympic bar'],
      ['Reason', plain(result.explanation.summary), ...result.explanation.facts.map(plain)],
      ['Equipment', `+2.5 kg (+${String(card?.nextUp?.pct)}%), the smallest step on this bar.`],
    ]);
    expect(rowsOf(e)[2]).toEqual(['Reason', 'Increase to 102.5 kg for 6–8 reps.', 'Last session: every counted set reached 8+ reps at 100 kg.']);
    expect(e?.rows.map((r) => [r.key, r.kind])).toEqual([
      ['set_by', 'app'],
      ['last_time', 'actual'],
      ['reason', 'app'],
      ['equipment', 'app'],
    ]);
    expect(e?.basisEdited).toBeNull();
  });

  it('a routine-named basis reads `after Push A, 8 Oct`', () => {
    let s = startFixture().state;
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 10));
    s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(100), 8, { rpe: 8 }), 200));
    s = apply(s, logCmd(bench[2]?.id ?? '', values(kg(100), 8, { rpe: 8 }), 400));
    for (const ex of s.exercises.filter((x) => x.exerciseId !== BENCH)) s = apply(s, { type: 'skip_exercise', at: at(500), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
    s = apply(s, { type: 'finish', at: at(900), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    const h2 = toHistorySessions(s, BENCH, { identity: true });
    const e = explain(today(2, h2), { basisNow: s, history: h2 });
    // The warm-up isn't part of the basis.
    expect(rowsOf(e).slice(0, 2)).toEqual([
      ['Set by', 'Built-in rule · after Push A, 8 Oct', 'Double progression 6–8'],
      ['Last time', '100 kg × 8, 8', 'RPE 8, 8', '8 Oct · Main Gym · Olympic bar'],
    ]);
  });

  it('is stored, not recomputed (AW3): a later flag and a newer workout don’t change Set by, Last time or Reason', () => {
    const before = explain(now, { basisNow: basis, history: h });
    const newer = finished(3, [values(kg(80), 5)]);
    const after = explain(now, { basisNow: basis, history: [...h, ...hist(newer)], painFlags: [flag(3)], nowMs: ms(4 * DAY) });
    expect(rowsOf(after).slice(0, 4)).toEqual(rowsOf(before));
    // The flag itself is shown as it is now, and says it came after the target.
    expect(rowsOf(after)[4]).toEqual(['Pain', 'Flag on since 11 Oct (shoulder). Loads, reps and sets can’t go up.', 'Flagged after this target was set, so the target wasn’t changed.']);
    expect(after?.rows[4]?.kind).toBe('warning');
  });

  it('the same input always gives the same panel, and nothing passed in is changed', () => {
    const input: ExplainTargetInput = { aggregate: now, setId: now.sets[1]?.id ?? '', nowMs: ms(3 * DAY), basisNow: basis, gymNames: GYMS, painFlags: [flag(1)], history: h };
    const copy = structuredClone(input);
    expect(explainTarget(input)).toEqual(explainTarget(copy));
    expect(input).toEqual(copy);
  });
});

describe('explainTarget: the basis edited since (check 42)', () => {
  const basis = finished(0, [values(kg(100), 8, { rpe: 8 }), values(kg(100), 8, { rpe: 8 })]);
  const h = hist(basis);
  const now = today(2, h);

  it('says when the basis was edited, and keeps showing the values the target used', () => {
    const set2 = basis.sets[1];
    const edited = apply(basis, { type: 'correct_set', at: at(DAY + 60), opId: 'fix-2', setId: set2?.id ?? '', expectedSetVersion: set2?.version ?? 0, patch: { reps: 6 } });
    const e = explain(now, { basisNow: edited, history: hist(edited) });
    expect(plain(e?.basisEdited ?? '')).toBe('Based on 8 Oct before you edited it on 9 Oct.');
    expect(rowsOf(e)[1]).toEqual(['Last time', '100 kg × 8, 8', 'RPE 8, 8', '8 Oct · Main Gym · Olympic bar']);
    // The target itself is untouched (rule 2).
    expect(now.sets.map((s) => s.planned.load)).toEqual([kg(102.5), kg(102.5)]);
  });

  it('no note when nothing changed, or when the basis workout can’t be read (no claim either way)', () => {
    expect(explain(now, { basisNow: basis, history: h })?.basisEdited).toBeNull();
    expect(explain(now, { basisNow: null, history: h })?.basisEdited).toBeNull();
  });
});

describe('explainTarget: missing provenance (check 43) and no target', () => {
  const basis = finished(0, [values(kg(100), 8, { rpe: 8 }), values(kg(100), 8, { rpe: 8 })]);
  const h = hist(basis);

  it('a target stored before Why? existed: Not recorded, Last time from history, and never a guessed reason', () => {
    const old = today(2, h, { why: false });
    expect(old.sets[0]?.planned.provenance).toBeUndefined();
    const e = explain(old, { history: h });
    expect(e?.recorded).toBe(false);
    expect(rowsOf(e)).toEqual([
      ['Set by', 'Not recorded (set before this app version)'],
      ['Last time', '100 kg × 8, 8', 'RPE 8, 8', '8 Oct · Main Gym · Olympic bar'],
    ]);
  });

  it('…and with no history either: says there are no earlier sets on this equipment', () => {
    const old = today(2, h, { why: false });
    expect(rowsOf(explain(old, { history: [] }))).toEqual([
      ['Set by', 'Not recorded (set before this app version)'],
      ['Last time', 'No earlier sets on Olympic bar.'],
    ]);
  });

  it('no target (an exercise added with no history), an unknown set or a deleted set: nothing to explain', () => {
    const empty = today(2, []);
    expect(empty.sets[0]?.planned).toMatchObject({ load: null, reps: null, durationS: null });
    expect(explain(empty)).toBeNull();
    const now = today(2, h);
    expect(explain(now, { setId: id(999_999) })).toBeNull();
    const del = apply(now, { type: 'delete_set', at: at(2 * DAY + 5), opId: 'del', setId: now.sets[1]?.id ?? '', expectedSetVersion: now.sets[1]?.version ?? 0 });
    expect(explain(del, { setId: now.sets[1]?.id ?? '' })).toBeNull();
  });
});

describe('explainTarget: routine and Repeat targets', () => {
  it('routine: Your routine, the routine’s own number, the fit, and Last time from history', () => {
    const { state } = startFixture({ benchTarget: 101 });
    const bench = setsFor(state, BENCH);
    const e = explainTarget({ aggregate: state, setId: bench[1]?.id ?? '', nowMs: ms(60), basisNow: null, gymNames: GYMS, painFlags: [], history: [] });
    expect(rowsOf(e)).toEqual([
      ['Set by', 'Your routine · Push A'],
      ['Last time', 'No earlier sets on Olympic bar.'],
      ['Reason', 'Push A sets 101 kg × 6–8.'],
      ['Equipment', 'Rounded to 100 kg, the nearest easier load this bar makes. Plan was 101 kg.'],
    ]);
    const hang = state.sets.find((s) => s.planned.durationS === 45);
    expect(rowsOf(explainTarget({ aggregate: state, setId: hang?.id ?? '', nowMs: ms(60), basisNow: null, gymNames: GYMS, painFlags: [], history: [] }))[2]).toEqual(['Reason', 'Push A sets 0:45.']);
  });

  it('Repeat: the set it copied (actual, with effort), no progression, and the cap at a lighter gym', () => {
    let s = startFixture().state;
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(102.5), 8, { rpe: 9 }), 200));
    s = apply(s, logCmd(bench[2]?.id ?? '', values(kg(100), 7), 400));
    for (const ex of s.exercises) if (ex.exerciseId !== BENCH) s = apply(s, { type: 'skip_exercise', at: at(500), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
    const source = apply(s, { type: 'finish', at: at(900), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    const lighter = barbell({ plates: [{ mass: 20, count: 4 }] });
    const out = startWorkoutFromSession({ opId: 'rep', owner, gymId: GYM, source, exercises, gymEquipment: [lighter], at: at(DAY), newId: idGen(95_000) });
    const set = setsFor(out.aggregate, BENCH)[0];
    const e = explainTarget({ aggregate: out.aggregate, setId: set?.id ?? '', nowMs: ms(DAY + 60), basisNow: source, gymNames: GYMS, painFlags: [], history: [] });
    expect(rowsOf(e)).toEqual([
      ['Set by', 'Repeat of Push A, 8 Oct'],
      ['Last time', '102.5 kg × 8', 'RPE 9', '8 Oct · Main Gym · Olympic bar'],
      ['Reason', 'What you did last time is today’s target. No progression is applied.'],
      ['Equipment', 'Capped at 100 kg: the most this bar makes. Last time was 102.5 kg.'],
    ]);
  });
});

describe('explainTarget: Start next session (review B1.1)', () => {
  // Last time 100 kg × 8, 8 on the bar; the built-in rule plans 102.5 kg for the next session.
  const source = finished(0, [values(kg(100), 8, { rpe: 8 }), values(kg(100), 8, { rpe: 8 })]);
  const h = hist(source);
  const result = rule(h, BAR);
  const at2 = at(2 * DAY);
  const targetsWith = (why: boolean) => {
    const plan = why ? plannedSetsFromTargets(result, { history: h, equipment: BAR, at: at2 }) : plannedSetsFromTargets(result);
    return new Map([[BENCH, plan ?? []]]);
  };
  const next = (gym: EquipmentInstance[], why = true) =>
    startWorkoutFromSession({ opId: `next-${String(why)}`, owner, gymId: GYM, source, exercises, gymEquipment: gym, at: at2, newId: idGen((idBase += 1_000)), targets: targetsWith(why) });

  it('a progressed target from the rule is explained as the rule, never as a repeat with no progression', () => {
    const out = next([BAR]);
    const set = setsFor(out.aggregate, BENCH)[0];
    expect(set?.planned).toMatchObject({ load: kg(102.5), source: 'built_in_rule', provenance: { source: 'rule' } });
    const e = explainTarget({ aggregate: out.aggregate, setId: set?.id ?? '', nowMs: ms(2 * DAY + 60), basisNow: source, gymNames: GYMS, painFlags: [], history: h });
    expect(rowsOf(e)[0]?.[1]).toBe('Built-in rule · after your 8 Oct workout');
    expect(rowsOf(e)[2]).toEqual(['Reason', 'Increase to 102.5 kg for 6–8 reps.', 'Last session: every counted set reached 8+ reps at 100 kg.']);
    expect(rowsOf(e).flat().join(' ')).not.toMatch(/Repeat of|No progression is applied/);
  });

  it('at a lighter gym the rule’s target is fitted and the fit is said against the target, not last time', () => {
    const lighter = barbell({ plates: [{ mass: 20, count: 2 }] });
    const set = setsFor(next([lighter]).aggregate, BENCH)[0];
    expect(set?.planned.provenance?.source).toBe('rule');
    expect(set?.planned.provenance?.guardNotes.map(plain)).toEqual(['Capped at 60 kg: the most this bar makes. Target was 102.5 kg.']);
  });

  it('a rule target written without provenance reads Not recorded, never a made-up repeat', () => {
    const set = setsFor(next([BAR], false).aggregate, BENCH)[0];
    expect(set?.planned.source).toBe('built_in_rule');
    expect(set?.planned.provenance).toBeUndefined();
  });
});

describe('explainTarget: pain flags (Pain and Before flag rows)', () => {
  // 8 Oct 105 × 6, 6 · flag 9 Oct (shoulder) · 10 Oct 100 × 8, 8 · today 11 Oct, held by the flag.
  const pre = finished(0, [values(kg(105), 6, { rpe: 9 }), values(kg(105), 6, { rpe: 9 })]);
  const post = finished(2, [values(kg(100), 8, { rpe: 8 }), values(kg(100), 8, { rpe: 8 })]);
  const h = hist(pre, post);
  const on = flag(1);
  const now = today(3, h, { flags: [on] });

  it('with the flag on: the rule says it held, Pain says since when, Before flag shows the last sets before it (reference only)', () => {
    expect(now.sets[0]?.planned.load).toEqual(kg(100));
    const e = explain(now, { basisNow: post, history: h, painFlags: [on], nowMs: ms(3 * DAY + 60) });
    expect(rowsOf(e)).toEqual([
      ['Set by', 'Built-in rule · after your 10 Oct workout', 'Double progression 6–8'],
      ['Last time', '100 kg × 8, 8', 'RPE 8, 8', '10 Oct · Main Gym · Olympic bar'],
      ['Reason', 'Progression for Bench press is paused because pain was reported on 2026-10-09. Targets are not increased.', 'Targets are not increased while a pain flag is active. Clear the flag when you are ready.'],
      ['Pain', 'Flag on since 9 Oct (shoulder). Loads, reps and sets can’t go up.'],
      ['Before flag', '105 kg × 6, 6 · 8 Oct'],
    ]);
    expect(e?.rows.find((r) => r.key === 'before_flag')?.kind).toBe('actual');
    // Reference only: it never becomes the target.
    expect(now.sets.every((s) => s.planned.load?.value === 100)).toBe(true);
  });

  it('after clearing: Before flag stays for 8 weeks, then goes; no Pain row', () => {
    const cleared = clearPainFlag(on, at(4 * DAY));
    const in7 = explain(now, { basisNow: post, history: h, painFlags: [cleared], nowMs: ms(4 * DAY + 7 * WEEK) });
    expect(rowsOf(in7).map((r) => r[0])).toEqual(['Set by', 'Last time', 'Reason', 'Before flag']);
    const in9 = explain(now, { basisNow: post, history: h, painFlags: [cleared], nowMs: ms(4 * DAY + 9 * WEEK) });
    expect(rowsOf(in9).map((r) => r[0])).toEqual(['Set by', 'Last time', 'Reason']);
  });

  it('a flag with no area, and a flag on another movement', () => {
    const noArea = flag(1, { area: null });
    expect(rowsOf(explain(now, { history: h, painFlags: [noArea], nowMs: ms(3 * DAY + 60) })).find((r) => r[0] === 'Pain')).toEqual(['Pain', 'Flag on since 9 Oct. Loads, reps and sets can’t go up.']);
    const other = flag(1, { exerciseId: ROW, exerciseName: 'Cable row' });
    expect(rowsOf(explain(now, { history: h, painFlags: [other], nowMs: ms(3 * DAY + 60) })).map((r) => r[0])).toEqual(['Set by', 'Last time', 'Reason']);
  });

  it('no sets before the flag: no Before flag row', () => {
    const early = flag(-1);
    expect(rowsOf(explain(now, { history: h, painFlags: [early], nowMs: ms(3 * DAY + 60) })).map((r) => r[0])).toEqual(['Set by', 'Last time', 'Reason', 'Pain']);
  });
});

describe('explainTarget: load conventions in the words', () => {
  it('per-hand dumbbells: `each` on every load, the rack’s step', () => {
    const rack = dumbbells();
    const db = exercise(210, 'Dumbbell bench press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const basis = finished(0, [values(kg(20, 'per_hand'), 10, { rpe: 8 }), values(kg(20, 'per_hand'), 10, { rpe: 8 })], db, rack);
    const h = hist(basis);
    const e = explain(today(2, h, { eq: rack, ex: db }), { basisNow: basis, history: h });
    expect(rowsOf(e)[1]).toEqual(['Last time', '20 kg each × 10, 10', 'RPE 8, 8', '8 Oct · Main Gym · Home dumbbells']);
    expect(rowsOf(e)[3]).toEqual(['Equipment', '+2.5 kg each (+12.5%), the smallest step on this rack.']);
  });

  it('assisted machine: Assist loads, and the step is less assistance', () => {
    const machine = assisted();
    const pull = exercise(211, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
    const basis = finished(0, [values(kg(20, 'assistance'), 8, { rpe: 8 }), values(kg(20, 'assistance'), 8, { rpe: 8 })], pull, machine);
    const h = hist(basis);
    const e = explain(today(2, h, { eq: machine, ex: pull }), { basisNow: basis, history: h });
    expect(rowsOf(e)[1]).toEqual(['Last time', 'Assist 20 kg × 8, 8', 'RPE 8, 8', '8 Oct · Main Gym · Assisted pull-up']);
    expect(rowsOf(e)[3]).toEqual(['Equipment', '5 kg less assistance, the smallest step on this machine.']);
  });

  it('unilateral sets are grouped by side; effort follows the same order', () => {
    const s = (side: 'left' | 'right', reps: number, rpe: number) => ({ side, values: { load: kg(25, 'stack'), reps, durationS: null, rpe, rir: null } });
    const sets = [s('left', 10, 8), s('right', 10, 8), s('left', 9, 9), s('right', 10, 9)];
    expect(plain(basisSetsText(sets, { loadConvention: 'stack', measurement: 'reps' }, stack()))).toBe('Left 25 kg stack × 10, 9; Right 25 kg stack × 10, 10');
  });
});

describe('buildActiveSetView: target.hasExplanation', () => {
  it('every set with a target has Why?; a set with none doesn’t', () => {
    const basis = finished(0, [values(kg(100), 8, { rpe: 8 }), values(kg(100), 8, { rpe: 8 })]);
    const view = (a: SessionAggregate) => buildActiveSetView({ aggregate: a, nowMs: ms(2 * DAY + 10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
    expect(view(today(2, hist(basis))).focus?.hasExplanation).toBe(true);
    // A target with no stored provenance still gets Why? (it says `Not recorded`).
    expect(view(today(2, hist(basis), { why: false })).focus?.hasExplanation).toBe(true);
    expect(view(today(2, [])).focus?.hasExplanation).toBe(false);
  });
});

describe('explainTarget: sets left out (Not used, active-workout §2.13)', () => {
  /** Day 0: 100 × 8, 8, then a third set Ben marked `Form broke`. */
  function basisWithFlag(): SessionAggregate {
    const ids = idGen((idBase += 1_000));
    let s = startWorkout({ opId: 'nu-start', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [BAR], at: at(0), newId: ids }).aggregate;
    const plan = [1, 2, 3].map(() => ({ setType: 'working' as const, planned: { load: null, reps: null, durationS: null, rpe: null, rir: null } }));
    s = apply(s, buildAddExerciseCommand({ opId: 'nu-add', owner, exercise: benchEx, equipmentId: BAR.id, at: at(1), newId: ids, plan }));
    const sets = s.sets.slice();
    [8, 8, 9].forEach((r, i) => {
      s = apply(s, logCmd(sets[i]?.id ?? '', values(kg(r === 9 ? 105 : 100), r === 9 ? 6 : 8, { rpe: 8 }), 100 * (i + 1)));
    });
    const third = s.sets.find((x) => x.id === sets[2]?.id);
    s = apply(s, { type: 'correct_set', at: at(500), opId: 'nu-mark', setId: third?.id ?? '', expectedSetVersion: third?.version ?? 0, patch: { exclusions: ['technique'] } });
    return apply(s, { type: 'finish', at: at(1_000), opId: 'nu-fin', expectedVersion: s.session.version, endedAt: null });
  }

  it('Last time lists the counted sets; Not used names the marked one with Ben’s reason', () => {
    const basis = basisWithFlag();
    const h = hist(basis);
    const e = explain(today(2, h), { basisNow: basis, history: h });
    expect(rowsOf(e)[1]).toEqual(['Last time', '100 kg × 8, 8', 'RPE 8, 8', '8 Oct · Main Gym · Olympic bar']);
    expect(rowsOf(e).at(-1)).toEqual(['Not used', 'Set 3 on 8 Oct: form broke.']);
    expect(e?.rows.at(-1)?.kind).toBe('actual');
    expect(e?.basisEdited).toBeNull();
  });

  it('without stored provenance, Not used is read from history', () => {
    const basis = basisWithFlag();
    const h = hist(basis);
    const e = explain(today(2, h, { why: false }), { history: h });
    expect(rowsOf(e)[1]?.[1]).toBe('100 kg × 8, 8');
    expect(rowsOf(e).at(-1)).toEqual(['Not used', 'Set 3 on 8 Oct: form broke.']);
  });
});

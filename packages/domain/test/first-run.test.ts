import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';

import {
  buildActiveSetView,
  buildAddExerciseCommand,
  COMMON_EXERCISE_IDS,
  defaultStartingPlan,
  deriveWorkoutTitle,
  getSessionPhase,
  isOpenEndedWorkout,
  muscleSummary,
  NBSP,
  pickerSections,
  reduceSession,
  startWorkout,
  startWorkoutFromSession,
  starterExercises,
  type ActiveSetView,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, idGen, kg, lb, ms, profile, values } from './fixtures';
import { apply, BENCH, expectOk, exercises as fixtureExercises, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * First-run flow (audit B1, B2, F4, F5): an exercise with no history gets a
 * usable plan, an open-ended workout keeps resting after its last set so far,
 * the next session carries the built-in targets, and workouts get plain names.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const BENCH_EX = exercise(500, 'Bench press', { movementPattern: 'horizontal_push', primaryMuscles: ['chest'], compatibleEquipment: ['barbell'], family: 'bench_press', mechanic: 'compound', defaultRestS: 180 });
const CURL_EX = exercise(501, 'Dumbbell curl', { movementPattern: 'arms', primaryMuscles: ['biceps'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'isolation', defaultRestS: 60 });

function view(aggregate: SessionAggregate, nowS: number, title: string | null = null): ActiveSetView {
  return buildActiveSetView({ aggregate, nowMs: ms(nowS), gymName: 'Main gym', previous: {}, painFlagged: new Set(), edits: null, title });
}

/** An empty workout with `ex` added the way the app adds an exercise with no history. */
function openWorkoutWith(ex: Exercise, eq: EquipmentInstance, unit: 'kg' | 'lb' = 'kg'): SessionAggregate {
  const owner = profile({ preferredUnit: unit });
  const ids = idGen(80_000);
  let s = startWorkout({ opId: 'start-open', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [eq], at: at(0), newId: ids }).aggregate;
  const plan = defaultStartingPlan(ex, eq.kind, eq.loadConvention);
  s = apply(s, buildAddExerciseCommand({ opId: 'add-open', owner, exercise: ex, equipmentId: eq.id, at: at(1), newId: ids, plan }));
  return s;
}

describe('defaultStartingPlan (audit B1)', () => {
  it('three working sets in the built-in rep range for the category, never a guessed load', () => {
    const bench = defaultStartingPlan(BENCH_EX, 'barbell', 'total');
    expect(bench).toHaveLength(3);
    expect(bench.every((p) => p.setType === 'working' && p.planned.load === null && p.planned.source === 'built_in_rule')).toBe(true);
    expect(bench[0]?.planned.reps).toEqual({ min: 3, max: 6 });
    expect(defaultStartingPlan(CURL_EX, 'dumbbells', 'per_hand')[0]?.planned.reps).toEqual({ min: 8, max: 12 });
    // Unknown exercise: the accessory range, the widest.
    expect(defaultStartingPlan(null, null, 'total')[0]?.planned.reps).toEqual({ min: 8, max: 12 });
    expect(defaultStartingPlan(BENCH_EX, 'barbell', 'total', 0)).toHaveLength(1);
    expect(defaultStartingPlan(BENCH_EX, 'barbell', 'total', 50)).toHaveLength(10);
  });
});

describe('open-ended workout: rest after every set, Add exercise when all done (audit B1)', () => {
  it('logging the first set starts the rest and moves to set 2, prefilled from set 1', () => {
    const eq = barbell();
    let s = openWorkoutWith(BENCH_EX, eq);
    expect(isOpenEndedWorkout(s)).toBe(true);
    const v0 = view(s, 2, 'Push');
    expect(v0.title).toBe('Push');
    const f0 = v0.focus;
    if (!f0) throw new Error('no focus');
    expect(plain(f0.headerLine)).toBe('Barbell · Set 1 of 3');
    expect(plain(f0.target)).toBe('Target (built-in rule) 3–6 reps');
    // Reps come from the target; the load is Ben's to enter (no guessed load): the button focuses it.
    expect(f0.draft.reps).toBe(6);
    expect(v0.primary).toEqual({ kind: 'enter', field: 'load', label: 'Enter load' });

    const sets = setsFor(s, BENCH_EX.id);
    s = apply(s, logCmd(sets[0]?.id ?? '', values(kg(60), 6), 30));
    expect(s.restTimer).toMatchObject({ status: 'running', durationS: 180 });
    const v1 = view(s, 40);
    expect(v1.phase).toBe('resting');
    expect(plain(v1.upNext)).toBe('Set 2 · 3–6 reps');
    expect(v1.focus?.setId).toBe(sets[1]?.id);
    expect(v1.focus?.draft.load).toEqual(kg(60));
    expect(plain(v1.focus?.logLabel)).toBe('Log 60 kg × 6');
  });

  it('the last set so far still starts the rest; the primary is Add exercise, and Finish cancels the rest', () => {
    let s = openWorkoutWith(BENCH_EX, barbell());
    const sets = setsFor(s, BENCH_EX.id);
    s = apply(s, logCmd(sets[0]?.id ?? '', values(kg(60), 6), 30));
    s = apply(s, logCmd(sets[1]?.id ?? '', values(kg(60), 6), 250));
    const r = expectOk(reduceSession(s, logCmd(sets[2]?.id ?? '', values(kg(60), 5), 470)));
    expect(r.events.map((e) => e.type)).toEqual(['RestEnded', 'SetCommitted', 'RestStarted', 'ActiveSetChanged', 'AllSetsDone']);
    s = r.state;
    expect(s.session.activeSetId).toBeNull();
    expect(getSessionPhase(s, ms(480))).toMatchObject({ kind: 'resting', nextSetId: null });
    const v = view(s, 480);
    expect(v.focus).toBeNull();
    expect(v.rest).toMatchObject({ kind: 'running', durationS: 180 });
    expect(v.primary).toEqual({ kind: 'add_exercise', label: 'Add exercise' });
    expect(view(s, 470 + 200).phase).toBe('all_done');

    const fin = expectOk(reduceSession(s, { type: 'finish', at: at(500), opId: 'fin-open', expectedVersion: s.session.version, endedAt: null }));
    expect(fin.state.restTimer?.status).toBe('cancelled');
  });

  it('a set added during that rest becomes the current set; the rest keeps running', () => {
    let s = openWorkoutWith(CURL_EX, dumbbells());
    for (const [i, set] of setsFor(s, CURL_EX.id).entries()) s = apply(s, logCmd(set.id, values(kg(12, 'per_hand'), 10), 30 + i * 100));
    expect(s.restTimer?.status).toBe('running');
    const ex = s.exercises[0];
    s = apply(s, { type: 'add_set', at: at(240), opId: 'add-set-4', sessionExerciseId: ex?.id ?? '', newSetId: '00000000-0000-4000-8000-000000088888', setType: null });
    const v = view(s, 245);
    expect(v.phase).toBe('resting');
    expect(v.focus?.setNumber).toBe(4);
    // Copied from the last set's target (8–12: the top of the range), with the load logged here.
    expect(plain(v.focus?.logLabel)).toBe('Log 12 kg each × 12');
  });

  it('a planned workout is not open-ended: its final set still ends without rest (rest-state #14)', () => {
    const { state } = startFixture();
    expect(isOpenEndedWorkout(state)).toBe(false);
  });

  it('lb gyms and assisted machines plan the same way, with no load guessed', () => {
    const s = openWorkoutWith(exercise(502, 'Assisted pull-up', { movementPattern: 'vertical_pull', primaryMuscles: ['lats'], compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', mechanic: 'compound' }), assisted({ unit: 'lb', assistanceLoads: [10, 20, 30] }), 'lb');
    const v = view(s, 2);
    expect(v.focus?.loadField?.assisted).toBe(true);
    expect(v.focus?.draft.load).toBeNull();
    expect(plain(v.focus?.target)).toBe('Target (built-in rule) 6–10 reps');
  });
});

describe('next session from the last workout (audit B2)', () => {
  /** Bench done once: 100 × 6, 6, 6 at RPE 8 (a clean top of the 3–6 range). */
  function finishedBench(): SessionAggregate {
    let s = startFixture().state;
    const bench = setsFor(s, BENCH);
    s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 10));
    s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(100), 8), 200));
    s = apply(s, logCmd(bench[2]?.id ?? '', values(kg(100), 8), 400));
    for (const ex of s.exercises.filter((e) => e.exerciseId !== BENCH)) s = apply(s, { type: 'skip_exercise', at: at(500), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
    return apply(s, { type: 'finish', at: at(900), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
  }

  it('uses the given targets (labelled built-in rule) and names the workout; others repeat as last time', () => {
    const source = finishedBench();
    const targets = new Map([[BENCH, [
      { setType: 'working' as const, planned: { load: kg(102.5), reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' as const } },
      { setType: 'working' as const, planned: { load: kg(102.5), reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' as const } },
    ]]]);
    const out = startWorkoutFromSession({ opId: 'next-1', owner: profile(), gymId: GYM, source, exercises: fixtureExercises, gymEquipment: [barbell()], at: at(86_400), newId: idGen(42_000), targets, name: 'Push' });
    expect(out.aggregate.session.routineName).toBe('Push');
    expect(isOpenEndedWorkout(out.aggregate)).toBe(false);
    const bench = setsFor(out.aggregate, BENCH);
    expect(bench.map((x) => [x.planned.load?.value, x.planned.reps, x.planned.source])).toEqual([
      [102.5, { min: 6, max: 8 }, 'built_in_rule'],
      [102.5, { min: 6, max: 8 }, 'built_in_rule'],
    ]);
  });

  it('targets still go through this gym: rounded toward easier and never above its max; lb stays lb', () => {
    const source = finishedBench();
    const small = barbell({ id: '00000000-0000-4000-8000-0000000009c1', plates: [{ mass: 20, count: 2 }] });
    const targets = new Map([[BENCH, [{ setType: 'working' as const, planned: { load: kg(102.5), reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null } }]]]);
    const out = startWorkoutFromSession({ opId: 'next-2', owner: profile(), gymId: GYM, source, exercises: fixtureExercises, gymEquipment: [small], at: at(86_400), newId: idGen(43_000), targets });
    expect(setsFor(out.aggregate, BENCH)[0]?.planned.load).toEqual(kg(60));
    const lbBar = barbell({ id: '00000000-0000-4000-8000-0000000009c2', unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 5, count: 2 }] });
    const lbOut = startWorkoutFromSession({ opId: 'next-3', owner: profile(), gymId: GYM, source, exercises: fixtureExercises, gymEquipment: [lbBar], at: at(86_400), newId: idGen(44_000), targets });
    const load = setsFor(lbOut.aggregate, BENCH)[0]?.planned.load;
    expect(load?.unit).toBe('lb');
    expect(load === null || load === undefined ? 0 : load.value).toBeLessThanOrEqual(lb(225).value);
  });

  it('next session at a gym without the bar: no load target, reps kept, still labelled built-in rule (gym-switch GS1, B1)', () => {
    const source = finishedBench();
    const targets = new Map([[BENCH, [{ setType: 'working' as const, planned: { load: kg(102.5), reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null } }]]]);
    const rack = dumbbells({ id: '00000000-0000-4000-8000-0000000009c3', loads: [10, 12.5, 15, 17.5, 20] });
    const out = startWorkoutFromSession({ opId: 'next-4', owner: profile(), gymId: GYM, source, exercises: fixtureExercises, gymEquipment: [rack], at: at(86_400), newId: idGen(45_000), targets, gymName: 'Hotel · Lisbon' });
    const set = setsFor(out.aggregate, BENCH)[0];
    expect(set?.planned.load).toBeNull();
    expect(set?.planned.reps).toEqual({ min: 6, max: 8 });
    expect(set?.planned.source).toBe('built_in_rule');
    expect(set?.planned.snap?.reason).toBe('not_here');
    expect(set?.planned.snap?.intended).toEqual(kg(102.5));
    expect(set?.status).toBe('pending');
    expect(out.notes.map((n) => n.text).join(' ')).toContain('no load target');
  });
});

describe('workout titles and muscle summary (audit F5)', () => {
  const s = starterExercises('2026-10-10T00:00:00.000Z');
  const named = (...names: string[]) => names.map((n) => {
    const e = s.find((x) => x.name === n);
    if (!e) throw new Error(n);
    return e;
  });
  it('names a workout from what is in it', () => {
    expect(deriveWorkoutTitle(named('Bench press', 'Dumbbell shoulder press', 'Triceps pushdown'))).toBe('Push');
    expect(deriveWorkoutTitle(named('Lat pulldown', 'Barbell row', 'Dumbbell curl'))).toBe('Pull');
    expect(deriveWorkoutTitle(named('Back squat', 'Romanian deadlift', 'Leg extension'))).toBe('Legs');
    expect(deriveWorkoutTitle(named('Bench press', 'Lat pulldown'))).toBe('Upper body');
    expect(deriveWorkoutTitle(named('Back squat', 'Bench press', 'Barbell row'))).toBe('Full body');
    expect(deriveWorkoutTitle([])).toBe('Workout');
  });
  it('lists up to three muscle words in order', () => {
    expect(muscleSummary(named('Bench press', 'Dumbbell shoulder press', 'Triceps pushdown', 'Lateral raise'))).toBe('Chest · Shoulders · Triceps');
    expect(muscleSummary([])).toBeNull();
  });
});

describe('pickerSections (audit F4)', () => {
  const list = starterExercises('2026-10-10T00:00:00.000Z').map((exercise) => ({ exercise }));
  const extra = { exercise: exercise(600, 'Zercher squat', { primaryMuscles: ['quads'] }) };
  it('recent first, then the common lifts, then everything else A–Z; each once', () => {
    const recent = [COMMON_EXERCISE_IDS[5] ?? ''];
    const sections = pickerSections([extra, ...list], '', recent);
    expect(sections.map((x) => x.title)).toEqual(['Recent', 'Common lifts', 'All exercises']);
    expect(sections[0]?.items.map((p) => p.exercise.id)).toEqual(recent);
    expect(sections[1]?.items[0]?.exercise.name).toBe('Bench press');
    expect(sections[1]?.items.some((p) => p.exercise.id === recent[0])).toBe(false);
    expect(sections[2]?.items.map((p) => p.exercise.name)).toEqual(['Zercher squat']);
  });
  it('a query shows matches only; no match is an empty list', () => {
    expect(pickerSections([extra, ...list], 'squat', []).map((x) => [x.title, x.items.map((p) => p.exercise.name)])).toEqual([
      ['Matches', ['Back squat', 'Bulgarian split squat', 'Goblet squat', 'Zercher squat']],
    ]);
    expect(pickerSections(list, 'xyz', [])).toEqual([]);
  });
});

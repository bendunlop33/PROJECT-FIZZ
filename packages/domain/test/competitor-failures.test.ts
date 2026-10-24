import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, Load, LoadConvention, ProgressionRule, SessionAggregate, SessionCommand, WeightUnit, WorkoutSet } from '@fizz/schemas';

import {
  buildActiveSetView,
  buildAddExerciseCommand,
  buildGymSwitchProposal,
  changeGymCommand,
  currentGymEquipment,
  equipmentOfRow,
  buildTodayView,
  calculateNextTargets,
  createMemoryRepositories,
  createSessionService,
  discardCommand,
  discardConfirmation,
  formatLoad,
  getAchievableLoads,
  getSessionPhase,
  isLoadAchievable,
  latestCommittedSetId,
  newPainFlag,
  nextTargetsFor,
  plannedSetsFromTargets,
  planTemplateLoad,
  reduceSession,
  startWorkout,
  startWorkoutFromSession,
  stepLoad,
  toScaled,
  warmUpRamp,
  warmUpText,
  type HistorySession,
  type NextTargets,
  type SessionEvent,
} from '../src/index';
import {
  assisted,
  at,
  barbell,
  bodyweightStation,
  doubleProgression,
  dumbbells,
  exercise,
  GYM,
  id,
  idGen,
  kg,
  ms,
  OWNER,
  plateMachine,
  profile,
  routine,
  routineExercise,
  stack,
  template,
  topSetBackoff,
  values,
} from './fixtures';
import { SPLIT_SQUAT, unilateralSession } from './repository-contract';
import { apply, BENCH, exercises as PUSH_A_EXERCISES, expectError, expectOk, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * Competitor-failure acceptance pack (docs/research/competitor-landscape.md,
 * "Opportunities for GymSmarter" #2; approved by Ben 2026-10-09). Each block
 * is a failure users reported in another app, restated as a check that
 * GymSmarter can't do the same thing (CLAUDE.md rules 2, 4 and 5).
 *
 *   (a) An import never changes planned or pending sets (Fitbod refresh).
 *   (b) No target below the empty bar, between dumbbell or stack steps, or at 0 (LiftTrack, MacroFactor).
 *   (c) Warm-ups obey equipment caps and pain blocks (JuggernautAI).
 *   (d) Editing a logged set never restarts rest (MacroFactor).
 *   (e) Discard needs a confirmation or Undo (LiftTrack "no second step").
 *   (f) Deleting one set never removes another (Hevy).
 *   (g) Repeat at a gym without the equipment never keeps an impossible load (slice-3 B1).
 *
 * The app-level halves (SQLite, import service, rest alerts, screens' discard
 * prompt) are in `apps/mobile/test/competitor-failures.test.ts`.
 */

// ---------------------------------------------------------------------------
// Shared: the equipment matrix and the "is this a possible target?" check.

const plates = (pairs: [number, number][]) => pairs.map(([mass, count]) => ({ mass, count }));

/** Every equipment kind, in kg and lb, with uneven steps, add-ons, maxima and single-horn machines. */
const EQUIPMENT: readonly EquipmentInstance[] = [
  barbell({ id: id(1101), name: 'Olympic bar (kg)' }),
  barbell({ id: id(1102), name: 'Olympic bar (lb)', unit: 'lb', barMass: 45, plates: plates([[45, 6], [25, 2], [10, 2], [5, 2], [2.5, 2]]) }),
  barbell({ id: id(1103), name: 'Bar capped at 100 kg', maxLoad: 100 }),
  barbell({ id: id(1104), name: 'Technique bar (15 kg, coarse plates)', barMass: 15, plates: plates([[10, 2], [5, 2]]) }),
  dumbbells({ id: id(1111), name: 'Dumbbells 5–30 kg' }),
  dumbbells({ id: id(1112), name: 'Dumbbells with gaps', loads: [2, 4, 6, 8, 10, 12.5, 15, 20, 25, 32.5] }),
  dumbbells({ id: id(1113), name: 'Dumbbells (lb)', unit: 'lb', loads: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] }),
  dumbbells({ id: id(1114), name: 'Dumbbells capped at 20 kg', maxLoad: 20 }),
  stack({ id: id(1121), name: 'Cable stack 5–50 kg' }),
  stack({ id: id(1122), name: 'Odd stack with a 2.5 add-on', stackLoads: [9, 16, 23, 30, 37, 44, 51], addOns: [2.5] }),
  stack({ id: id(1123), name: 'Stack (lb) capped at 150', unit: 'lb', stackLoads: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200], addOns: [5], maxLoad: 150 }),
  assisted({ id: id(1131), name: 'Assisted pull-up 5–40 kg' }),
  assisted({ id: id(1132), name: 'Assisted dip (lb)', unit: 'lb', assistanceLoads: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] }),
  plateMachine({ id: id(1141), name: 'Leg press (two horns)' }),
  plateMachine({ id: id(1142), name: 'Row machine (one horn)', loadingSides: 1, plates: plates([[20, 2], [10, 2], [5, 2], [2.5, 2]]) }),
  plateMachine({ id: id(1143), name: 'Hack squat capped at 100 kg', maxLoad: 100 }),
  bodyweightStation(),
];

/**
 * Zero is a real setting only where the equipment makes it: a plate-loaded
 * machine with no plates on (the plate line reads `No plates`), and
 * bodyweight. A barbell, dumbbell, stack or assistance target of 0 is the
 * LiftTrack "0 lb set".
 */
const ZERO_IS_A_SETTING: ReadonlySet<LoadConvention> = new Set(['added', 'bodyweight']);

/** (b) as one check: a target is null (no load target) or a load this equipment can actually make. */
function expectPossibleTarget(load: Load | null, eq: EquipmentInstance, where: string): void {
  if (load === null) return;
  const what = `${where}: target ${formatLoad(load)} on ${eq.name}`;
  expect(load.unit, what).toBe(eq.unit);
  expect(load.convention, what).toBe(eq.loadConvention);
  expect(isLoadAchievable(load, eq), `${what} is not a load it can make`).toBe(true);
  if (eq.kind === 'barbell') expect(toScaled(load.value), `${what} is below the empty bar`).toBeGreaterThanOrEqual(toScaled(eq.barMass));
  if (eq.maxLoad !== undefined) expect(toScaled(load.value), `${what} is above its max`).toBeLessThanOrEqual(toScaled(eq.maxLoad));
  if (eq.kind === 'dumbbells') expect(eq.loads.map(toScaled), `${what} is between dumbbells`).toContain(toScaled(load.value));
  if (!ZERO_IS_A_SETTING.has(load.convention)) expect(load.value, `${what} is 0`).toBeGreaterThan(0);
}

function expectPossibleTargets(t: NextTargets, eq: EquipmentInstance, where: string): void {
  for (const s of t.sets) expectPossibleTarget(s.load, eq, `${where} (${t.decision}, ${s.setType})`);
}

/** A few values of every kind around an equipment's range: 0, below, on, between and above its steps. */
function probeValues(eq: EquipmentInstance): number[] {
  const loads = getAchievableLoads(eq).loads;
  const first = loads[0] ?? 10;
  const last = loads.at(-1) ?? 10;
  const sample = (xs: readonly number[], n: number) => (xs.length <= n ? [...xs] : Array.from({ length: n }, (_, i) => xs[Math.round((i * (xs.length - 1)) / (n - 1))] ?? first));
  const between = loads.slice(0, -1).map((l, i) => (l + (loads[i + 1] ?? l)) / 2);
  const values = [0, first / 2, first, first + 0.1, ...sample(loads, 6), ...sample(between, 6), last, last + 0.5, last * 1.5];
  return [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].filter((v) => v >= 0);
}

let sessionN = 9_000;
function history(eq: EquipmentInstance | null, unit: WeightUnit, convention: LoadConvention, day: number, value: number | null, reps: number[], rpe: number | null = null): HistorySession {
  sessionN += 1;
  const load: Load | null = value === null || convention === 'bodyweight' ? null : { value, unit, convention };
  return {
    sessionId: id(sessionN),
    performedAtUtc: `2026-09-${String(day).padStart(2, '0')}T06:00:00.000Z`,
    equipmentId: eq?.id ?? null,
    gymId: null,
    imported: false,
    sets: reps.map((r) => ({ setType: 'working' as const, side: null, load, reps: r, rpe, rir: null })),
  };
}

/** Every history shape that leads to a different decision: increase, hold, hold after a miss, reduce, partial. */
function historyShapes(eq: EquipmentInstance | null, unit: WeightUnit, convention: LoadConvention, v: number): { name: string; h: HistorySession[] }[] {
  const at = (day: number, reps: number[], rpe: number | null = null) => history(eq, unit, convention, day, v, reps, rpe);
  return [
    { name: 'top of range, easy', h: [at(2, [8, 8, 8], 7)] },
    { name: 'top of range, RPE 10', h: [at(2, [8, 8, 8], 10)] },
    { name: 'inside the range', h: [at(2, [7, 7, 6])] },
    { name: 'one bad day', h: [at(2, [5, 4, 4])] },
    { name: 'two misses in a row', h: [at(1, [5, 4, 4]), at(2, [5, 5, 4])] },
    { name: 'only one set logged', h: [at(2, [8])] },
  ];
}

function rulesFor(eq: EquipmentInstance | null, convention: LoadConvention, unit: WeightUnit): { name: string; rule: ProgressionRule }[] {
  const otherUnit: WeightUnit = unit === 'kg' ? 'lb' : 'kg';
  const rules = [
    { name: 'double progression, 2.5 kg steps', rule: doubleProgression() },
    { name: `double progression, steps in ${otherUnit}`, rule: doubleProgression({ loadIncrement: { value: otherUnit === 'lb' ? 5 : 2.5, unit: otherUnit } }) },
    { name: 'double progression, max jump 2.5 kg', rule: doubleProgression({ maxLoadJump: { value: 2.5, unit: 'kg' } }) },
    { name: 'double progression, 1 kg steps', rule: doubleProgression({ loadIncrement: { value: 1, unit: 'kg' } }) },
  ];
  if (convention !== 'assistance' && (eq === null || eq.loadConvention !== 'assistance')) {
    rules.push({ name: 'top set + back-off', rule: topSetBackoff({ topSet: { repRange: { min: 6, max: 8 }, maxRpeToProgress: 9, minRirToProgress: null } }) });
  }
  return rules;
}

describe('(b) no target below the empty bar, between dumbbell or stack steps, or at 0, for every equipment kind', () => {
  // One test per equipment item with its own timeout: the whole matrix is
  // >5,000 loads and ran past Vitest's 5 s default on a loaded machine
  // (review failure-tests B1). Tests in a file run in order, so the total is
  // checked after every item has run.
  let checked = 0;
  it.each(EQUIPMENT.map((eq) => [eq.name, eq] as const))(
    'next targets (built-in rule) on %s: every decision, every rule, from loads on, between, below and above the steps',
    (_name, eq) => {
      const { unit } = eq;
      const convention = eq.loadConvention;
      for (const v of probeValues(eq)) {
        for (const shape of historyShapes(eq, unit, convention, v)) {
          for (const { name, rule } of rulesFor(eq, convention, unit)) {
            for (const pain of [false, true]) {
              const t = calculateNextTargets({
                exerciseName: 'Lift',
                measurement: 'reps',
                history: shape.h,
                rule,
                equipment: eq,
                unit,
                convention,
                pain: { active: pain, reportedAtUtc: pain ? '2026-09-03T06:00:00.000Z' : null },
              });
              expectPossibleTargets(t, eq, `last ${String(v)} ${unit}, ${shape.name}, ${name}${pain ? ', pain flag' : ''}`);
              checked += t.sets.filter((s) => s.load !== null).length;
            }
          }
        }
      }
    },
    30_000,
  );

  it('the next-targets matrix really produced loads to check (not just "no load target" everywhere)', () => {
    expect(checked).toBeGreaterThan(5_000);
  });

  it('a rule’s starting load (no history yet), in either unit, is never between steps, below the bar or at 0', () => {
    for (const eq of EQUIPMENT) {
      for (const v of probeValues(eq)) {
        for (const startUnit of ['kg', 'lb'] as const) {
          const rule = doubleProgression({ startingLoad: { value: v, unit: startUnit } });
          const t = calculateNextTargets({ exerciseName: 'Lift', measurement: 'reps', history: [], rule, equipment: eq, unit: eq.unit, convention: eq.loadConvention, pain: { active: false, reportedAtUtc: null } });
          expectPossibleTargets(t, eq, `starting load ${String(v)} ${startUnit}`);
        }
      }
    }
  });

  it('with no equipment profile, a planned load is never 0 unless the convention has a real zero', () => {
    const conventions: LoadConvention[] = ['total', 'per_hand', 'stack', 'assistance', 'added'];
    for (const convention of conventions) {
      for (const unit of ['kg', 'lb'] as const) {
        // 0 too (review failure-tests M2): a logged 0 is never planned again as 0 kg each / assist 0 kg.
        for (const v of [0, 1, 2.5, 5, 10, 20, 45, 100]) {
          for (const shape of historyShapes(null, unit, convention, v)) {
            for (const { name, rule } of rulesFor(null, convention, unit)) {
              const t = calculateNextTargets({ exerciseName: 'Lift', measurement: 'reps', history: shape.h, rule, equipment: null, unit, convention, pain: { active: false, reportedAtUtc: null } });
              for (const s of t.sets) {
                if (s.load === null || ZERO_IS_A_SETTING.has(convention)) continue;
                expect(s.load.value, `${convention} ${String(v)} ${unit}, ${shape.name}, ${name} (${t.decision}): target ${formatLoad(s.load)}`).toBeGreaterThan(0);
              }
            }
          }
        }
      }
    }
  });

  it('with no equipment profile, a 0 history on total, each or stack plans no load, never 0 + one step (review failure-tests-r2 S2)', () => {
    for (const convention of ['total', 'per_hand', 'stack'] as const) {
      for (const unit of ['kg', 'lb'] as const) {
        for (const shape of historyShapes(null, unit, convention, 0)) {
          for (const { name, rule } of rulesFor(null, convention, unit)) {
            const t = calculateNextTargets({ exerciseName: 'Lift', measurement: 'reps', history: shape.h, rule, equipment: null, unit, convention, pain: { active: false, reportedAtUtc: null } });
            for (const s of t.sets) expect(s.load, `${convention} ${unit}, ${shape.name}, ${name} (${t.decision})`).toBeNull();
          }
        }
      }
    }
  });

  it('a routine’s planned load at Start is snapped to the equipment from any value, in either unit', () => {
    for (const eq of EQUIPMENT) {
      for (const v of probeValues(eq)) {
        for (const unit of ['kg', 'lb'] as const) {
          const r = planTemplateLoad(id(1), { value: v, unit, convention: eq.loadConvention }, { unit: eq.unit, convention: eq.loadConvention, equipment: eq });
          expectPossibleTarget(r.load, eq, `template ${String(v)} ${unit}`);
        }
      }
    }
  });

  it('the keypad’s step keys only ever offer loads the equipment can make', () => {
    for (const eq of EQUIPMENT) {
      for (const v of probeValues(eq)) {
        for (const step of ['increase', 'decrease'] as const) {
          const r = stepLoad(v, eq, step);
          if (r.ok) expectPossibleTarget({ value: r.value, unit: eq.unit, convention: eq.loadConvention }, eq, `${step} from ${String(v)}`);
        }
      }
    }
  });
});

describe('(b) regression: assistance with no machine profile (bug found by this pack)', () => {
  const NO_PAIN = { active: false, reportedAtUtc: null };
  const next = (last: number) =>
    calculateNextTargets({
      exerciseName: 'Assisted pull-up',
      measurement: 'reps',
      history: [history(null, 'kg', 'assistance', 2, last, [8, 8, 8], 7)],
      rule: doubleProgression(),
      equipment: null,
      unit: 'kg',
      convention: 'assistance',
      pain: NO_PAIN,
    });

  it('holds the last assistance and adds a rep instead of "assist 0 kg"', () => {
    const t = next(2.5);
    expect(t.decision).toBe('increase_reps');
    expect(t.sets.map((s) => s.load)).toEqual([kg(2.5, 'assistance'), kg(2.5, 'assistance'), kg(2.5, 'assistance')]);
    expect(t.sets[0]?.reps).toEqual({ min: 9, max: 9 });
    expect(t.explanation.summary).toBe('Add a rep: aim for 9 at assist 2.5 kg, because the next step would leave no assistance.');
    // Less than one step left behaves the same; a full step still comes off as before.
    expect(next(1).sets[0]?.load).toEqual(kg(1, 'assistance'));
    expect(next(10).sets[0]?.load).toEqual(kg(7.5, 'assistance'));
  });
});

// ---------------------------------------------------------------------------
// Shared helpers for the session blocks.

/** IDs of set rows that differ between two states (a row in only one of them counts). */
function changedSetIds(before: SessionAggregate, after: SessionAggregate): string[] {
  const ids = new Set([...before.sets.map((s) => s.id), ...after.sets.map((s) => s.id)]);
  return [...ids].filter((sid) => !isDeepStrictEqual(before.sets.find((s) => s.id === sid), after.sets.find((s) => s.id === sid))).sort();
}

const restEvents = (events: readonly SessionEvent[]) => events.filter((e) => e.type === 'RestStarted' || e.type === 'RestAdjusted' || e.type === 'RestEnded');

function setOf(state: SessionAggregate, exerciseId: string, n: number): WorkoutSet {
  const s = setsFor(state, exerciseId)[n];
  if (!s) throw new Error(`no set ${String(n)}`);
  return s;
}

function current(state: SessionAggregate, setId: string): WorkoutSet {
  const s = state.sets.find((x) => x.id === setId);
  if (!s) throw new Error(`no set ${setId}`);
  return s;
}

describe('(a) an import never changes planned or pending sets (Fitbod refresh)', () => {
  it('no session command rewrites a target that is already planned: only new rows bring targets, copied, never re-planned', () => {
    let s = startFixture().state;
    const planned = new Map(s.sets.map((x) => [x.id, x.planned]));
    const w = setOf(s, BENCH, 0);
    const b1 = setOf(s, BENCH, 1);
    const b2 = setOf(s, BENCH, 2);
    const benchEx = s.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '';
    const rowEx = s.exercises.find((e) => e.exerciseId === ROW)?.id ?? '';
    const steps: ((st: SessionAggregate) => SessionCommand)[] = [
      () => ({ type: 'save_draft', at: at(5), setId: b1.id, values: values(kg(105), 8) }),
      () => logCmd(w.id, values(kg(60), 10), 10),
      (st) => ({ type: 'correct_set', at: at(20), opId: 'fix-w', setId: w.id, expectedSetVersion: current(st, w.id).version, patch: { reps: 12 } }),
      () => logCmd(b1.id, values(kg(102.5), 8), 100),
      (st) => ({ type: 'undo_log', at: at(105), opId: 'undo-b1', setId: b1.id, expectedSetVersion: current(st, b1.id).version }),
      () => logCmd(b1.id, values(kg(100), 8), 110, 'log:b1:again'),
      (st) => ({ type: 'set_rest_after', at: at(120), opId: 'rest-b2', setId: b2.id, seconds: 240, scope: 'exercise', expectedVersion: st.session.version }),
      () => ({ type: 'pause', at: at(130), opId: 'pause' }),
      () => ({ type: 'resume', at: at(140), opId: 'resume' }),
      () => ({ type: 'add_set', at: at(150), opId: 'add-bench', sessionExerciseId: benchEx, newSetId: id(1401), setType: null }),
      (st) => ({ type: 'delete_set', at: at(160), opId: 'del-b2', setId: b2.id, expectedSetVersion: current(st, b2.id).version }),
      () => ({ type: 'skip_exercise', at: at(170), opId: 'skip-row', sessionExerciseId: rowEx }),
      () => ({ type: 'tick', at: at(400) }),
      (st) => ({ type: 'finish', at: at(500), opId: 'fin', expectedVersion: st.session.version, endedAt: null }),
    ];
    for (const step of steps) s = apply(s, step(s));
    for (const [sid, plan] of planned) expect(current(s, sid).planned, `planned target of ${sid}`).toEqual(plan);
    // The added set copies the last set's target; it isn't re-planned from history (marked as added in the workout: plan vs done).
    expect(current(s, id(1401)).planned).toEqual({ ...b2.planned, addedInWorkout: true });
  });
});

describe('(c) warm-ups obey equipment caps and pain blocks', () => {
  const BARS = EQUIPMENT.filter((e) => e.kind === 'barbell');

  it('every warm-up step is a load the bar can make, never above its max, strictly below and building to the working load', () => {
    let steps = 0;
    for (const bar of BARS) {
      for (const v of probeValues(bar)) {
        const ramp = warmUpRamp({ value: v, unit: bar.unit, convention: 'total' }, bar);
        ramp.forEach((step, i) => {
          expectPossibleTarget({ value: step.load, unit: bar.unit, convention: 'total' }, bar, `warm-up step ${String(i + 1)} for ${String(v)} ${bar.unit}`);
          expect(toScaled(step.load)).toBeLessThan(toScaled(v));
          if (i > 0) expect(toScaled(step.load)).toBeGreaterThan(toScaled(ramp[i - 1]?.load ?? 0));
          steps += 1;
        });
      }
    }
    expect(steps).toBeGreaterThan(100);
  });

  it('a working load above the bar’s max (logged off-profile) never pulls a warm-up step past the max', () => {
    const capped = BARS.find((b) => b.maxLoad !== undefined);
    if (capped?.kind !== 'barbell') throw new Error('fixture');
    const ramp = warmUpRamp(kg(180), capped);
    // WU4 on a bar capped at 100: bar, 40 % → 70, 60 % and 80 % both capped at 100 (merged), and WU4's gap step (45) between the bar and 70.
    expect(ramp.map((r) => r.load)).toEqual([20, 45, 70, 100]);
    expect(ramp.every((r) => r.load <= (capped.maxLoad ?? Infinity))).toBe(true);
  });

  const bar = barbell();
  const bench: Exercise = exercise(1300, 'Bench press', { family: 'bench_press', movementPattern: 'horizontal_push', compatibleEquipment: ['barbell'] });
  const NO_PAIN = { active: false, reportedAtUtc: null };
  const req = {
    ownerId: OWNER,
    exerciseId: bench.id,
    exerciseName: bench.name,
    measurement: 'reps' as const,
    unit: 'kg' as const,
    convention: 'total' as const,
    equipment: bar,
    exercise: bench,
    rule: null,
    workingSets: 3,
    history: [history(bar, 'kg', 'total', 2, 100, [6, 6, 6], 8)],
    painFlags: [],
    sessionPain: NO_PAIN,
  };
  const flag = newPainFlag({ id: id(1301), ownerId: OWNER, opId: 'pain-1', exerciseId: bench.id, exerciseName: bench.name, area: null, source: 'workout', checkInId: null, at: at(-3600) });

  /** Empty workout at a gym with one bar; bench added with the given plan. */
  function benchWorkout(plan: ReturnType<typeof plannedSetsFromTargets>): SessionAggregate {
    const s = startWorkout({ opId: 'pain-start', owner: profile(), gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [bar], at: at(0), newId: idGen(130_000) }).aggregate;
    return apply(s, buildAddExerciseCommand({ opId: 'add-bench', owner: profile(), exercise: bench, equipmentId: bar.id, at: at(5), newId: idGen(131_000), plan }));
  }

  it('with a pain flag the working target is held, and the warm-up ramps only to that held load', () => {
    const free = nextTargetsFor(req).result;
    expect(free.decision).toBe('increase_load');
    expect(free.sets[0]?.load).toEqual(kg(102.5));
    const held = nextTargetsFor({ ...req, painFlags: [flag] }).result;
    expect(held.decision).toBe('halted_pain');
    const s = benchWorkout(plannedSetsFromTargets(held));
    expect(s.sets.map((x) => x.planned.load)).toEqual([kg(100), kg(100), kg(100)]);
    const view = buildActiveSetView({ aggregate: s, nowMs: ms(10), gymName: null, previous: {}, painFlagged: new Set([bench.id]), edits: null });
    expect(view.focus?.painFlagged).toBe(true);
    // The suggestion is the shared planner's ladder for the set's own reps (WU3), up to the held load only.
    const ramp = warmUpRamp(kg(100), bar, s.sets[0]?.planned.reps?.min ?? null);
    expect(view.focus?.warmUp).toBe(warmUpText(ramp, bar));
    expect(ramp.every((r) => r.load < 100)).toBe(true);
  });

  it('a working load lowered on the card (a lighter day, or an accepted coach change) brings the warm-up down with it', () => {
    const s = benchWorkout(plannedSetsFromTargets(nextTargetsFor(req).result));
    const first = s.sets[0];
    if (!first) throw new Error('fixture');
    const view = buildActiveSetView({ aggregate: s, nowMs: ms(10), gymName: null, previous: {}, painFlagged: new Set(), edits: { setId: first.id, values: values(kg(60), 6) } });
    const ramp = warmUpRamp(kg(60), bar, first.planned.reps?.min ?? null);
    expect(view.focus?.warmUp).toBe(warmUpText(ramp, bar));
    expect(ramp.every((r) => r.load < 60)).toBe(true);
    expect(ramp[0]?.load).toBe(20);
  });

  it('planned warm-up sets go through the same equipment check as working sets, at Start and in Repeat', () => {
    const capped = barbell({ id: id(1103), name: 'Bar capped at 100 kg', maxLoad: 100 });
    const r = routine([
      routineExercise(1310, {
        exerciseId: BENCH,
        equipmentId: capped.id,
        setTemplates: [
          template(13101, { setType: 'warmup', targetLoad: kg(120), targetReps: { min: 5, max: 5 } }),
          template(13102, { setType: 'warmup', targetLoad: kg(61), targetReps: { min: 3, max: 3 } }),
          template(13103, { targetLoad: kg(140) }),
        ],
      }),
    ]);
    const out = startWorkout({ opId: 'cap', owner: profile(), gymId: GYM, routine: r, exercises: PUSH_A_EXERCISES, gymEquipment: [capped], at: at(0), newId: idGen(132_000) });
    for (const x of out.aggregate.sets) expectPossibleTarget(x.planned.load, capped, `${x.setType} at Start`);
    // The 120 warm-up capped at the bar's 100 would equal the working load: Start plans it again below it (WU8, rule 4).
    expect(out.aggregate.sets.map((x) => x.planned.load?.value)).toEqual([60, 60, 100]);

    // Repeat at a gym whose bar stops at 50 kg: the 60 kg warm-up is capped too.
    let src = startFixture().state;
    src = apply(src, logCmd(setOf(src, BENCH, 0).id, values(kg(60), 10), 10));
    src = apply(src, logCmd(setOf(src, BENCH, 1).id, values(kg(100), 8), 200));
    src = apply(src, { type: 'finish', at: at(300), opId: 'fin', expectedVersion: src.session.version, endedAt: null });
    const hotel = barbell({ id: id(1105), name: 'Hotel bar to 50 kg', maxLoad: 50 });
    const rep = startWorkoutFromSession({ opId: 'rep-cap', owner: profile(), gymId: GYM, source: src, exercises: PUSH_A_EXERCISES, gymEquipment: [hotel], at: at(86_400), newId: idGen(133_000) });
    const benchSets = setsFor(rep.aggregate, BENCH);
    // Capped at 50 the warm-up would equal the working 50: planned again below it (WU8, rule 4).
    expect(benchSets.map((x) => [x.setType, x.planned.load?.value])).toEqual([
      ['warmup', 40],
      ['working', 50],
    ]);
    for (const x of benchSets) expectPossibleTarget(x.planned.load, hotel, `${x.setType} in Repeat`);
  });
});

describe('(d) editing a logged set never restarts rest (MacroFactor)', () => {
  /** Push A: warm-up logged at 10 s (rest to 70 s), first working set logged at 80 s (rest 180 s, to 260 s). */
  function resting() {
    let s = startFixture().state;
    const w = setOf(s, BENCH, 0);
    const b1 = setOf(s, BENCH, 1);
    s = apply(s, logCmd(w.id, values(kg(60), 10), 10));
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 80));
    expect(s.restTimer).toMatchObject({ setId: b1.id, status: 'running', durationS: 180, deadlineUtc: at(260).utc });
    return { s, w, b1, b2: setOf(s, BENCH, 2) };
  }

  it('corrections of load, reps, effort or set type, on the resting set or an older one, leave the timer exactly as it was', () => {
    const { s, w, b1 } = resting();
    const corrections: { setId: string; patch: Extract<SessionCommand, { type: 'correct_set' }>['patch'] }[] = [
      { setId: b1.id, patch: { load: kg(97.5) } },
      { setId: b1.id, patch: { reps: 6 } },
      { setId: b1.id, patch: { rpe: 9.5 } },
      { setId: b1.id, patch: { setType: 'top' } },
      { setId: w.id, patch: { reps: 12, load: kg(62.5) } },
    ];
    let state = s;
    corrections.forEach((c, i) => {
      const r = expectOk(reduceSession(state, { type: 'correct_set', at: at(100 + i), opId: `fix-${String(i)}`, setId: c.setId, expectedSetVersion: current(state, c.setId).version, patch: c.patch }));
      expect(r.state.restTimer, `correction ${String(i)}`).toEqual(s.restTimer);
      expect(restEvents(r.events), `correction ${String(i)}`).toEqual([]);
      expect(getSessionPhase(r.state, ms(200))).toEqual(getSessionPhase(s, ms(200)));
      state = r.state;
    });
  });

  it('deleting a logged set, editing the next set’s rest or its draft never touches the running timer', () => {
    const { s, w, b2 } = resting();
    const cmds: ((st: SessionAggregate) => SessionCommand)[] = [
      (st) => ({ type: 'delete_set', at: at(100), opId: 'del-w', setId: w.id, expectedSetVersion: current(st, w.id).version }),
      (st) => ({ type: 'set_rest_after', at: at(110), opId: 'rest', setId: b2.id, seconds: 300, scope: 'exercise', expectedVersion: st.session.version }),
      () => ({ type: 'save_draft', at: at(120), setId: b2.id, values: values(kg(95), 8) }),
    ];
    let state = s;
    for (const cmd of cmds) {
      const r = expectOk(reduceSession(state, cmd(state)));
      expect(r.state.restTimer).toEqual(s.restTimer);
      expect(restEvents(r.events)).toEqual([]);
      state = r.state;
    }
    // The new rest applies after the next set, not to the one running now.
    expect(current(state, b2.id).rest.seconds).toBe(300);
  });

  it('while paused a correction keeps the paused time left; after rest ended a correction starts no new rest', () => {
    const { s, b1 } = resting();
    const paused = apply(s, { type: 'pause', at: at(150), opId: 'p' });
    const r = expectOk(reduceSession(paused, { type: 'correct_set', at: at(160), opId: 'fix-p', setId: b1.id, expectedSetVersion: current(paused, b1.id).version, patch: { reps: 7 } }));
    expect(r.state.restTimer).toEqual(paused.restTimer);
    expect(r.state.restTimer?.remainingMsAtPause).toBe(110_000);

    const ended = apply(s, { type: 'tick', at: at(400) });
    expect(ended.restTimer?.status).toBe('expired');
    const after = expectOk(reduceSession(ended, { type: 'correct_set', at: at(410), opId: 'fix-e', setId: b1.id, expectedSetVersion: current(ended, b1.id).version, patch: { reps: 7 } }));
    expect(after.state.restTimer).toEqual(ended.restTimer);
    expect(restEvents(after.events)).toEqual([]);
    expect(getSessionPhase(after.state, ms(420))).toMatchObject({ kind: 'ready', restEnded: { timerId: s.restTimer?.id } });
  });

  it('a correction after Finish (Summary edit) doesn’t bring a rest back', () => {
    const { s, b1 } = resting();
    const done = apply(s, { type: 'finish', at: at(120), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    const r = expectOk(reduceSession(done, { type: 'correct_set', at: at(500), opId: 'fix-f', setId: b1.id, expectedSetVersion: current(done, b1.id).version, patch: { reps: 9 } }));
    expect(r.state.restTimer).toEqual(done.restTimer);
    expect(r.state.restTimer?.status).toBe('cancelled');
    expect(restEvents(r.events)).toEqual([]);
  });
});

describe('(e) Discard needs a confirmation or Undo (LiftTrack: "no second step")', () => {
  it('asks first whenever a set is logged and says how many; with nothing logged it discards at once', () => {
    let s = startFixture().state;
    const w = setOf(s, BENCH, 0);
    const b1 = setOf(s, BENCH, 1);
    expect(discardConfirmation(s)).toEqual({ required: false, loggedSets: 0, expectedVersion: s.session.version });
    s = apply(s, logCmd(w.id, values(kg(60), 10), 10));
    expect(discardConfirmation(s)).toEqual({ required: true, loggedSets: 1, expectedVersion: s.session.version, message: '1 logged set will be discarded. This can’t be undone.' });
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 100));
    expect(discardConfirmation(s)).toMatchObject({ required: true, loggedSets: 2, message: '2 logged sets will be discarded. This can’t be undone.' });
    // A deleted set isn't counted, but the other logged set still needs the confirmation.
    s = apply(s, { type: 'delete_set', at: at(110), opId: 'del', setId: b1.id, expectedSetVersion: current(s, b1.id).version });
    expect(discardConfirmation(s)).toMatchObject({ required: true, loggedSets: 1 });
    // Skipped sets aren't logged sets.
    const skipped = apply(startFixture().state, { type: 'skip_exercise', at: at(5), opId: 'skip', sessionExerciseId: setOf(startFixture().state, BENCH, 0).sessionExerciseId });
    expect(discardConfirmation(skipped).required).toBe(false);
    // Log then Undo: nothing logged any more.
    let u = apply(startFixture().state, logCmd(w.id, values(kg(60), 10), 10));
    u = apply(u, { type: 'undo_log', at: at(12), opId: 'undo', setId: w.id, expectedSetVersion: current(u, w.id).version });
    expect(discardConfirmation(u).required).toBe(false);
  });

  it('a confirmation shown before another set was logged is refused as stale; nothing is discarded', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(setOf(s, BENCH, 0).id, values(kg(60), 10), 10));
    const ask = discardConfirmation(s);
    // Logged from the lock screen while the alert was open.
    s = apply(s, logCmd(setOf(s, BENCH, 1).id, values(kg(100), 8), 100));
    const r = reduceSession(s, { type: 'discard', at: at(110), opId: 'discard-1', expectedVersion: ask.expectedVersion, confirmedLoggedSets: ask.loggedSets });
    expectError(r, 'stale_version');
    expect(r.state.session.status).toBe('active');
    expect(r.state.sets).toEqual(s.sets);
  });

  it('Today’s stale card offers its one-tap Discard only when discardConfirmation says nothing is logged, at the version it was shown for', () => {
    const later = ms(7 * 3600);
    const today = (s: SessionAggregate) => {
      const local = (utc: string) => utc.slice(0, 10);
      const v = buildTodayView({ nowMs: later, active: s, finishedThisWeek: [], todayLocalDate: local(at(7 * 3600).utc), localDateOf: local, recentCheckIns: [] });
      if (v.main.kind !== 'stale') throw new Error(`expected the stale card, got ${v.main.kind}`);
      return v.main;
    };
    const w = setOf(startFixture().state, BENCH, 0);
    const logged = apply(startFixture().state, logCmd(w.id, values(kg(60), 10), 10));
    const states: [string, SessionAggregate][] = [
      ['nothing logged', startFixture().state],
      ['one set logged', logged],
      ['logged then undone', apply(logged, { type: 'undo_log', at: at(12), opId: 'undo', setId: w.id, expectedSetVersion: current(logged, w.id).version })],
      ['logged then deleted', apply(logged, { type: 'delete_set', at: at(12), opId: 'del', setId: w.id, expectedSetVersion: current(logged, w.id).version })],
      ['all skipped', apply(startFixture().state, { type: 'skip_exercise', at: at(5), opId: 'skip', sessionExerciseId: w.sessionExerciseId })],
    ];
    for (const [name, s] of states) {
      const card = today(s);
      const ask = discardConfirmation(s);
      // `Discard (nothing logged)` (no prompt) is shown exactly when endedAboutUtc is null.
      expect(card.endedAboutUtc === null, name).toBe(!ask.required);
      expect(card.sessionVersion, name).toBe(ask.expectedVersion);
    }
    expect(today(logged).endedAboutUtc).not.toBeNull();
  });

  it('a discard that skipped the confirmation is refused by the reducer itself, whoever sends it (review failure-tests M3)', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(setOf(s, BENCH, 0).id, values(kg(60), 10), 10));
    s = apply(s, logCmd(setOf(s, BENCH, 1).id, values(kg(100), 8), 100));
    const v = s.session.version;
    // "Nothing logged" (0), or a confirmation for fewer sets than are now logged: refused, nothing changes.
    for (const confirmed of [0, 1, 3]) {
      const r = reduceSession(s, { type: 'discard', at: at(110), opId: `skip-${String(confirmed)}`, expectedVersion: v, confirmedLoggedSets: confirmed });
      expectError(r, 'discard_unconfirmed');
      expect(r.state.session.status).toBe('active');
      expect(r.state.sets).toEqual(s.sets);
    }
    expect(expectOk(reduceSession(s, discardCommand(discardConfirmation(s), { opId: 'ok', at: at(120) }))).state.session.status).toBe('discarded');
  });

  it('a confirmed discard keeps every row and its audit (only the workout’s status changes); a repeated tap is a no-op', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(setOf(s, BENCH, 0).id, values(kg(60), 10), 10));
    const cmd: SessionCommand = discardCommand(discardConfirmation(s), { opId: 'discard-1', at: at(20) });
    const r = expectOk(reduceSession(s, cmd));
    expect(r.state.session.status).toBe('discarded');
    expect(r.state.sets).toEqual(s.sets);
    expect(r.state.exercises).toEqual(s.exercises);
    expect(r.state.audit).toEqual(s.audit);
    const again = expectOk(reduceSession(r.state, cmd));
    expect(again).toMatchObject({ duplicate: true });
    expect(again.state).toBe(r.state);
  });
});

describe('(f) deleting one set never removes another (Hevy)', () => {
  /** Push A part-way: bench done (W, B1, B2), first row set logged, the rest pending. */
  function partWay(): SessionAggregate {
    let s = startFixture().state;
    s = apply(s, logCmd(setOf(s, BENCH, 0).id, values(kg(60), 10), 10));
    s = apply(s, logCmd(setOf(s, BENCH, 1).id, values(kg(100), 8), 200));
    s = apply(s, logCmd(setOf(s, BENCH, 2).id, values(kg(100), 7), 400));
    return apply(s, logCmd(setOf(s, ROW, 0).id, values(kg(50, 'stack'), 12), 600));
  }

  it('deleting any one set, logged or pending, changes that row only; every other row is untouched and nothing is removed', () => {
    const base = partWay();
    const live = base.sets.filter((x) => x.status !== 'deleted');
    expect(new Set(live.map((x) => x.status))).toEqual(new Set(['completed', 'pending']));
    for (const target of live) {
      const r = expectOk(reduceSession(base, { type: 'delete_set', at: at(700), opId: `del-${target.id}`, setId: target.id, expectedSetVersion: target.version }));
      expect(changedSetIds(base, r.state), `deleting ${target.id}`).toEqual([target.id]);
      expect(current(r.state, target.id)).toMatchObject({ status: 'deleted', actual: target.actual });
      expect(r.state.sets).toHaveLength(base.sets.length);
      expect(r.events.filter((e) => e.type === 'SetDeleted')).toEqual([{ type: 'SetDeleted', setId: target.id }]);
    }
  });

  it('after an earlier set is deleted and the numbers shift, deleting “set 2” deletes the row it was shown for', () => {
    let s = partWay();
    const [w, b1, b2] = setsFor(s, BENCH);
    if (!w || !b1 || !b2) throw new Error('fixture');
    s = apply(s, { type: 'delete_set', at: at(700), opId: 'del-w', setId: w.id, expectedSetVersion: w.version });
    // B2 is now shown as set 2 of bench; its card carries its own ID and version.
    const before = s;
    s = apply(s, { type: 'delete_set', at: at(710), opId: 'del-b2', setId: b2.id, expectedSetVersion: current(s, b2.id).version });
    expect(changedSetIds(before, s)).toEqual([b2.id]);
    expect(current(s, b1.id)).toEqual(current(before, b1.id));
  });

  it('a repeated delete (same tap retried) or a second delete of the same set never moves on to a neighbour', () => {
    const base = partWay();
    const b1 = setOf(base, BENCH, 1);
    const cmd: SessionCommand = { type: 'delete_set', at: at(700), opId: 'del-b1', setId: b1.id, expectedSetVersion: b1.version };
    const once = expectOk(reduceSession(base, cmd)).state;
    const retried = expectOk(reduceSession(once, cmd));
    expect(retried).toMatchObject({ duplicate: true, superseded: false });
    expect(retried.state).toBe(once);
    const fresh = reduceSession(once, { ...cmd, opId: 'del-b1-again', expectedSetVersion: current(once, b1.id).version });
    expectError(fresh, 'set_not_found');
    expect(changedSetIds(once, fresh.state)).toEqual([]);
  });

  it('a delete from a stale card (the set changed since it was shown) is refused', () => {
    const base = partWay();
    const b2 = setOf(base, BENCH, 2);
    const fixed = apply(base, { type: 'correct_set', at: at(650), opId: 'fix', setId: b2.id, expectedSetVersion: b2.version, patch: { reps: 8 } });
    const r = reduceSession(fixed, { type: 'delete_set', at: at(700), opId: 'del', setId: b2.id, expectedSetVersion: b2.version });
    expectError(r, 'stale_version');
    expect(changedSetIds(fixed, r.state)).toEqual([]);
  });

  it('Undo after deleting the latest logged set can’t reach back and un-log an older set', () => {
    const base = partWay();
    const row1 = setOf(base, ROW, 0);
    const s = apply(base, { type: 'delete_set', at: at(700), opId: 'del-row1', setId: row1.id, expectedSetVersion: row1.version });
    expect(latestCommittedSetId(s)).toBeNull();
    const b2 = setOf(s, BENCH, 2);
    const r = reduceSession(s, { type: 'undo_log', at: at(705), opId: 'undo', setId: b2.id, expectedSetVersion: b2.version });
    expectError(r, 'not_latest_set');
    expect(current(r.state, b2.id).status).toBe('completed');
  });

  it('unilateral pairs: deleting the pending other side keeps the logged side; deleting a logged side keeps a logged partner', () => {
    let s = unilateralSession('start-uni-f', idGen(140_000));
    const [first, second, third] = [...s.sets].sort((a, b) => a.index - b.index);
    if (!first || !second || !third) throw new Error('fixture');
    s = apply(s, logCmd(first.id, values(kg(15, 'per_hand'), 10), 10, 'log-left', 'left'));
    const companion = s.sets.find((x) => x.pairedWithSetId === first.id);
    if (!companion) throw new Error('no other side');
    // Delete the pending right side: the logged left side and the other sets stay.
    const r1 = expectOk(reduceSession(s, { type: 'delete_set', at: at(20), opId: 'del-right', setId: companion.id, expectedSetVersion: companion.version }));
    expect(changedSetIds(s, r1.state)).toEqual([companion.id]);
    // Log the right side too, then delete the left: the logged right side is kept (only a pending
    // other side belongs to its set; review R4).
    const both = apply(s, logCmd(companion.id, values(kg(15, 'per_hand'), 10), 30, 'log-right', 'right'));
    const r2 = expectOk(reduceSession(both, { type: 'delete_set', at: at(40), opId: 'del-left', setId: first.id, expectedSetVersion: current(both, first.id).version }));
    expect(changedSetIds(both, r2.state)).toEqual([first.id]);
    expect(current(r2.state, companion.id).status).toBe('completed');
    // With the right side still pending, deleting the left takes its own pending other side with it
    // (one prescribed set), and nothing else.
    const r3 = expectOk(reduceSession(s, { type: 'delete_set', at: at(40), opId: 'del-left-2', setId: first.id, expectedSetVersion: current(s, first.id).version }));
    expect(changedSetIds(s, r3.state)).toEqual([first.id, companion.id].sort());
    expect(SPLIT_SQUAT.laterality).toBe('unilateral');
  });
});

describe('(g) Repeat at a gym without the equipment never keeps an impossible load', () => {
  const EX = {
    bench: exercise(1501, 'Bench press', { compatibleEquipment: ['barbell'], defaultLoadConvention: 'total' }),
    press: exercise(1502, 'DB shoulder press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' }),
    row: exercise(1503, 'Seated cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' }),
    pullUp: exercise(1504, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' }),
    legPress: exercise(1505, 'Leg press', { compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added' }),
  };
  const catalogue = new Map(Object.values(EX).map((e) => [e.id, e]));
  const MAIN_GYM = [barbell(), dumbbells(), stack(), assisted(), plateMachine()];
  const plan: [Exercise, EquipmentInstance, Load][] = [
    [EX.bench, barbell(), kg(102.5)],
    [EX.press, dumbbells(), kg(27.5, 'per_hand')],
    [EX.row, stack(), kg(45, 'stack')],
    [EX.pullUp, assisted(), kg(15, 'assistance')],
    [EX.legPress, plateMachine(), kg(140, 'added')],
  ];

  /** A finished workout at the main gym: two sets of each exercise at the planned load. */
  function finishedAtMainGym(): SessionAggregate {
    const r = routine(
      plan.map(([ex, eq, load], i) =>
        routineExercise(1510 + i, { exerciseId: ex.id, equipmentId: eq.id, order: i, setTemplates: [template(15100 + i * 10, { targetLoad: load }), template(15101 + i * 10, { targetLoad: load })] }),
      ),
    );
    let s = startWorkout({ opId: 'main', owner: profile(), gymId: GYM, routine: r, exercises: catalogue, gymEquipment: MAIN_GYM, at: at(0), newId: idGen(150_000) }).aggregate;
    let t = 10;
    for (const x of [...s.sets]) {
      s = apply(s, logCmd(x.id, values(x.planned.load, 8), t));
      t += 60;
    }
    return apply(s, { type: 'finish', at: at(t), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
  }

  /** Rule 4 on a whole new session: every planned load is on that exercise's own equipment here, and possible on it. */
  function expectNoImpossibleLoad(s: SessionAggregate, where: string): void {
    for (const x of s.sets) {
      const ex = s.exercises.find((e) => e.id === x.sessionExerciseId);
      if (!ex || x.planned.load === null) continue;
      const eq = s.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId);
      expect(eq, `${where}: ${ex.exerciseName} has a ${formatLoad(x.planned.load)} target with no equipment to check it on`).toBeDefined();
      if (eq) expectPossibleTarget(x.planned.load, eq, `${where}: ${ex.exerciseName}`);
    }
  }

  const source = finishedAtMainGym();
  const GYMS: { name: string; equipment: EquipmentInstance[] }[] = [
    { name: 'bodyweight-only park', equipment: [bodyweightStation()] },
    { name: 'hotel with dumbbells to 20 kg', equipment: [dumbbells({ id: id(1521), loads: [4, 8, 12, 16, 20] })] },
    { name: 'smaller gym, lighter kit', equipment: [barbell({ id: id(1522), maxLoad: 80 }), stack({ id: id(1523), stackLoads: [7, 14, 21, 28, 35] }), assisted({ id: id(1524), assistanceLoads: [20, 30, 40] }), plateMachine({ id: id(1525), plates: plates([[20, 4]]) })] },
    { name: 'US gym in lb', equipment: [barbell({ id: id(1526), unit: 'lb', barMass: 45, plates: plates([[45, 8], [25, 2], [10, 2], [5, 2], [2.5, 2]]) }), dumbbells({ id: id(1527), unit: 'lb', loads: [10, 20, 30, 40, 50, 60] }), stack({ id: id(1528), unit: 'lb', stackLoads: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], addOns: [] })] },
    { name: 'main gym with every machine retired', equipment: MAIN_GYM.map((e) => ({ ...e, availability: 'retired' as const })) },
  ];

  for (const g of GYMS) {
    it(`Repeat at a ${g.name}: no load is planned that this gym can’t make, reps are kept`, () => {
      const out = startWorkoutFromSession({ opId: `rep-${g.name}`, owner: profile(), gymId: GYM, source, exercises: catalogue, gymEquipment: g.equipment, at: at(86_400), newId: idGen(151_000) });
      expectNoImpossibleLoad(out.aggregate, g.name);
      expect(out.aggregate.sets.every((x) => x.status === 'pending' && x.planned.reps !== null)).toBe(true);
      expect(out.aggregate.sets).toHaveLength(source.sets.length);
    });
  }

  it('starting a routine at a gym without its equipment never keeps an impossible load either (same rule as Repeat B1)', () => {
    const r = routine(plan.map(([ex, eq, load], i) => routineExercise(1530 + i, { exerciseId: ex.id, equipmentId: eq.id, order: i, setTemplates: [template(15300 + i, { targetLoad: load })] })));
    for (const g of GYMS) {
      const out = startWorkout({ opId: `start-${g.name}`, owner: profile(), gymId: GYM, routine: r, exercises: catalogue, gymEquipment: g.equipment, at: at(0), newId: idGen(152_000) });
      expectNoImpossibleLoad(out.aggregate, `Start at a ${g.name}`);
      // The routine's target stays visible as a warning; the set keeps its reps.
      for (const x of out.aggregate.sets) {
        const ex = out.aggregate.exercises.find((e) => e.id === x.sessionExerciseId);
        if (ex?.equipmentId === null) expect(x.planned.load, `${g.name}: ${ex.exerciseName}`).toBeNull();
        expect(x.planned.reps).toEqual({ min: 6, max: 8 });
      }
    }
    const park = startWorkout({ opId: 'start-park', owner: profile(), gymId: GYM, routine: r, exercises: catalogue, gymEquipment: [bodyweightStation()], at: at(0), newId: idGen(153_000) });
    expect(park.warnings).toContainEqual({ kind: 'target_dropped', setTemplateId: id(15300), requested: kg(102.5), reason: 'equipment_not_in_gym' });
    // Machine numbers too: no stack target without the stack.
    expect(park.warnings).toContainEqual({ kind: 'target_dropped', setTemplateId: id(15302), requested: kg(45, 'stack'), reason: 'equipment_not_in_gym' });
    // Why? says why the load was dropped (active-set provenance + this pack).
    const dropped = park.aggregate.sets.find((x) => x.planned.load === null && x.planned.provenance?.guardNotes.some((n) => n.includes('nothing of that kind')) === true);
    expect(dropped, 'a dropped set explains itself').toBeDefined();
  });

  it('starting a routine at a gym with the same kind of equipment caps its targets there (routines.md §2.2; review failure-tests M1)', () => {
    const r = routine(plan.map(([ex, eq, load], i) => routineExercise(1540 + i, { exerciseId: ex.id, equipmentId: eq.id, order: i, setTemplates: [template(15400 + i, { targetLoad: load })] })));
    const named = new Map(MAIN_GYM.map((e) => [e.id, e]));
    for (const g of GYMS) {
      const out = startWorkout({ opId: `start-kind-${g.name}`, owner: profile(), gymId: GYM, routine: r, exercises: catalogue, gymEquipment: g.equipment, routineEquipment: named, at: at(0), newId: idGen(154_000) });
      expectNoImpossibleLoad(out.aggregate, `Start (same-kind fallback) at a ${g.name}`);
      expect(out.aggregate.sets.every((x) => x.planned.reps !== null)).toBe(true);
    }
    const hotel = startWorkout({ opId: 'start-hotel', owner: profile(), gymId: GYM, routine: r, exercises: catalogue, gymEquipment: [dumbbells({ id: id(1521), loads: [4, 8, 12, 16, 20] })], routineEquipment: named, at: at(0), newId: idGen(155_000) });
    const press = hotel.aggregate.exercises.find((e) => e.exerciseId === EX.press.id);
    expect(press?.equipmentId).toBe(id(1521));
    const pressSet = hotel.aggregate.sets.find((x) => x.sessionExerciseId === press?.id);
    // 27.5 kg each is capped to the hotel's heaviest pair, not dropped.
    expect(pressSet?.planned.load).toEqual(kg(20, 'per_hand'));
    expect(hotel.warnings).toContainEqual({ kind: 'equipment_not_in_gym', routineExerciseId: id(1541), equipmentId: dumbbells().id, substituteId: id(1521) });
    expect(hotel.warnings).toContainEqual(expect.objectContaining({ kind: 'target_rounded', setTemplateId: id(15401), planned: kg(20, 'per_hand'), bounded: 'max' }));
    // No same-kind item at the hotel: the bench target is still dropped, never kept unchecked.
    expect(hotel.warnings).toContainEqual({ kind: 'equipment_not_in_gym', routineExerciseId: id(1540), equipmentId: barbell().id, substituteId: null });
    expect(hotel.warnings).toContainEqual({ kind: 'target_dropped', setTemplateId: id(15400), requested: kg(102.5), reason: 'equipment_not_in_gym' });
  });

  it('the session service looks up the routine’s named equipment, so Start caps at the hotel through the app path too', async () => {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile(), null);
    await repos.exercises.save(EX.press, null);
    await repos.equipment.save(dumbbells({ gymId: id(1599) }), null);
    await repos.equipment.save(dumbbells({ id: id(1521), loads: [4, 8, 12, 16, 20] }), null);
    const r = routine([routineExercise(1550, { exerciseId: EX.press.id, equipmentId: dumbbells().id, order: 0, setTemplates: [template(15500, { targetLoad: kg(27.5, 'per_hand') })] })]);
    await repos.routines.save(r, null);
    const svc = createSessionService(repos, idGen(156_000));
    const out = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: r.id, opId: 'svc-hotel', at: at(0) });
    if (!out.ok) throw new Error(out.error.message);
    expect(out.aggregate.exercises[0]?.equipmentId).toBe(id(1521));
    expect(out.aggregate.sets[0]?.planned.load).toEqual(kg(20, 'per_hand'));
  });

  it('mid-workout gym switch re-fits every pending load to the new gym (GE7; competitor-landscape opportunity 6, ADR 0019)', () => {
    const r = routine(plan.map(([ex, eq, load], i) => routineExercise(1560 + i, { exerciseId: ex.id, equipmentId: eq.id, order: i, setTemplates: [template(15600 + i * 10, { targetLoad: load }), template(15601 + i * 10, { targetLoad: load })] })));
    let s = startWorkout({ opId: 'mid', owner: profile(), gymId: GYM, gymName: 'Main', routine: r, exercises: catalogue, gymEquipment: MAIN_GYM, at: at(0), newId: idGen(157_000) }).aggregate;
    // One set of each exercise done at the main gym before the switch.
    let t = 10;
    for (const ex of s.exercises) {
      const first = s.sets.filter((x) => x.sessionExerciseId === ex.id).sort((a, b) => a.index - b.index)[0];
      if (!first) continue;
      s = apply(s, logCmd(first.id, values(first.planned.load, 8), t));
      t += 60;
    }
    const OTHER = id(1590);
    let checked = 0;
    for (const [n, g] of GYMS.entries()) {
      // A retired main gym is an equipment update at the same gym (newer versions of the same items).
      const same = g.equipment.some((e) => MAIN_GYM.some((m) => m.id === e.id));
      const gymId = same ? GYM : OTHER;
      const equipment = g.equipment.map((e) => (same ? { ...e, version: e.version + 1 } : { ...e, gymId }));
      const p = buildGymSwitchProposal({
        aggregate: s,
        mode: same ? 'equipment_update' : 'gym_switch',
        gym: { id: gymId, name: g.name, equipment },
        gymNames: { [GYM]: 'Main', [OTHER]: g.name },
        exercises: catalogue,
        painFlagged: new Set(),
        ownerUnit: 'kg',
        newId: idGen(158_000 + n * 100),
      });
      const after = expectOk(reduceSession(s, changeGymCommand(p, `switch-${g.name}`, at(t + 10)))).state;
      // Rule 2: logged sets are never touched; rule 4: no pending load the new gym can't make.
      for (const d of s.sets.filter((x) => x.status === 'completed')) expect(after.sets.find((x) => x.id === d.id), g.name).toEqual(d);
      for (const x of after.sets.filter((y) => y.status === 'pending')) {
        const row = after.exercises.find((e) => e.id === x.sessionExerciseId);
        const eq = row ? equipmentOfRow(after.session.equipmentSnapshot, row) : null;
        if (x.planned.load === null || x.planned.load.convention === 'bodyweight') continue;
        expect(eq, `${g.name}: ${row?.exerciseName ?? ''} keeps a ${formatLoad(x.planned.load)} target with no equipment here`).not.toBeNull();
        if (eq) {
          expect(eq.availability, `${g.name}: ${eq.name}`).toBe('available');
          expect(currentGymEquipment(after.session).some((c) => c.id === eq.id && c.version === eq.version), `${g.name}: ${eq.name} is this gym's`).toBe(true);
          expectPossibleTarget(x.planned.load, eq, `${g.name}: ${row?.exerciseName ?? ''}`);
          checked += 1;
        }
        // Reps are kept whatever happens to the load (GS4).
        expect(x.planned.reps).not.toBeNull();
      }
    }
    expect(checked, 'some pending loads were re-fitted and checked').toBeGreaterThan(0);
  });
});

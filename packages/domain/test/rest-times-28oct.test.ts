import { describe, expect, it } from 'vitest';
import { BUILD_LIMITS, REST_DEFAULT_KEYS, REST_DEFAULT_LIMITS, TrainingProfileSchema, type RoutineExercise, type SessionAggregate, type TrainingChange, type TrainingProfile } from '@fizz/schemas';

import {
  BUILDER_DAY_MIXES,
  BUILDER_REST_LEVELS,
  STANDARD_REST_DEFAULTS,
  addWarmupCommand,
  applyTrainingChange,
  buildFromSetup,
  defaultRestS,
  estimateBuilderSeconds,
  fitTemplateToMinutes,
  fitToMinutes,
  hasOwnRestDefaults,
  mainLiftRestLine,
  newTrainingProfile,
  restAfterRows,
  restDefaultsOf,
  restLevelTimesLine,
  restTableOf,
  restTimesView,
  roundRestOf,
  stepRestDefault,
  toDraftPlan,
  workingRestS,
  type BuilderContext,
  type BuilderSlot,
  type BuilderWorkout,
  type RestDefaults,
} from '../src/index';
import { context, pool } from './builder-v3-fixture';
import { at, id, routineExercise, template } from './fixtures';
import { BENCH, startFixture } from './session-fixture';

/**
 * (Ben, 28 Oct) Profile › Rest times: Ben's own default rests (training profile, Your data, versioned writes with op
 * IDs). Every default reader uses them; a slot's own rest wins; the fit's shorter levels scale from them with the
 * floors (compound never below 1:30, main lift never shortened).
 */

const ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000002';
const T0 = '2026-10-28T08:00:00.000Z';
const T1 = '2026-10-28T09:00:00.000Z';
const fresh = (): TrainingProfile => newTrainingProfile({ id: ID, ownerId: OWNER, atUtc: T0 });
let n = 0;
const apply = (p: TrainingProfile, c: TrainingChange, opId = `rt-${String((n += 1))}`, expectedVersion = p.version) => applyTrainingChange(p, c, { opId, expectedVersion, atUtc: T1, nowYear: 2026, today: '2026-10-28' });
const ok = (p: TrainingProfile, c: TrainingChange): TrainingProfile => {
  const r = apply(p, c);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.profile;
};

/** Ben's: main 4:00, top 4:30, back-off 3:30, compound 3:00, isolation 2:00, round 1:00, warm-up 1:30. */
const BENS: Required<RestDefaults> = { workingMain: 240, top: 270, backoff: 210, workingCompound: 180, workingIsolation: 120, round: 60, warmup: 90 };

const all = (w: BuilderWorkout) => w.blocks.flatMap((b) => b.slots);
const chest = (ctx: BuilderContext) => buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [...BUILDER_DAY_MIXES.chest] }, pool, ctx).workout;

describe('the setting (training profile, Your data)', () => {
  it('absent: the standard defaults; the limits match the builder’s', () => {
    expect(restDefaultsOf(null)).toEqual({});
    expect(restDefaultsOf(fresh())).toEqual({});
    expect(hasOwnRestDefaults(restDefaultsOf(fresh()))).toBe(false);
    for (const k of REST_DEFAULT_KEYS) expect(defaultRestS(k === 'workingMain' || k === 'workingCompound' || k === 'workingIsolation' ? 'working' : k, k === 'workingCompound' ? 'compound' : k === 'workingIsolation' || k === 'round' ? 'isolation' : 'main', 'normal', undefined, {})).toBe(STANDARD_REST_DEFAULTS[k]);
    expect(STANDARD_REST_DEFAULTS).toEqual({ workingMain: 180, top: 210, backoff: 180, workingCompound: 120, workingIsolation: 90, round: 90, warmup: 60 });
    expect(REST_DEFAULT_LIMITS.minS).toBe(BUILD_LIMITS.minRestS);
    expect(REST_DEFAULT_LIMITS.maxS).toBe(BUILD_LIMITS.maxRestS);
  });

  it('one write per change: stored as he set it, validated by the schema, version bumped', () => {
    const p1 = ok(fresh(), { kind: 'rest_default', key: 'workingCompound', seconds: 150 });
    expect(p1.version).toBe(2);
    expect(p1.restDefaultsS).toEqual({ workingCompound: 150 });
    expect(TrainingProfileSchema.parse(p1)).toEqual(p1);
    expect(restDefaultsOf(p1)).toEqual({ workingCompound: 150 });
    // Set to the standard value: still his (used exactly, never snapped to a preset).
    const p2 = ok(p1, { kind: 'rest_default', key: 'workingCompound', seconds: 120 });
    expect(restDefaultsOf(p2)).toEqual({ workingCompound: 120 });
    expect(defaultRestS('working', 'compound', 'normal', [60, 90, 180], restDefaultsOf(p2))).toBe(120);
    expect(defaultRestS('working', 'compound', 'normal', [60, 90, 180], {})).toBe(90);
  });

  it('refuses a value off the 15 s steps, outside 0:30–6:00, or an unknown key', () => {
    for (const seconds of [100, 15, 375, 0, -15, 1.5]) expect(apply(fresh(), { kind: 'rest_default', key: 'top', seconds }).ok, String(seconds)).toBe(false);
    expect(apply(fresh(), { kind: 'rest_default', key: 'beforeDrop' as never, seconds: 30 }).ok).toBe(false);
    for (const seconds of [30, 360]) expect(apply(fresh(), { kind: 'rest_default', key: 'top', seconds }).ok).toBe(true);
  });

  it('Reset to defaults clears all of his; a repeated op ID writes once; a stale version is refused (rule 5)', () => {
    let p = fresh();
    for (const k of REST_DEFAULT_KEYS) p = ok(p, { kind: 'rest_default', key: k, seconds: BENS[k] });
    expect(restDefaultsOf(p)).toEqual(BENS);
    const reset = apply(p, { kind: 'reset_rest_defaults' }, 'reset-1');
    if (!reset.ok) throw new Error(reset.error);
    expect(reset.profile.restDefaultsS).toBeUndefined();
    const again = apply(reset.profile, { kind: 'reset_rest_defaults' }, 'reset-1', p.version);
    expect(again.ok && again.replayed).toBe(true);
    if (again.ok) expect(again.profile.version).toBe(reset.profile.version);
    const stale = apply(reset.profile, { kind: 'rest_default', key: 'top', seconds: 240 }, 'late', p.version);
    expect(stale.ok).toBe(false);
  });

  it('a stored value outside the limits reads clamped to them and onto 15 s', () => {
    expect(restDefaultsOf({ restDefaultsS: { top: 999, warmup: 10, round: 70 } })).toMatchObject({ top: 360, warmup: 30, round: 75 });
  });
});

describe('Profile › Rest times view', () => {
  it('seven rows in order with their values; − / + in 15 s steps, off at the limits; Reset only with his own', () => {
    const v = restTimesView({});
    expect(v.rows.map((r) => `${r.label} ${r.text}`)).toEqual(['Main lift 3:00', 'Top set 3:30', 'Back-off 3:00', 'Compound 2:00', 'Isolation 1:30', 'Superset round 1:30', 'Warm-up 1:00']);
    expect(v.rows[0]).toMatchObject({ down: 165, up: 195 });
    expect(v.canReset).toBe(false);
    const edge = { warmup: 30, top: 360 };
    expect(stepRestDefault(30, -1)).toBeNull();
    expect(stepRestDefault(30, 1)).toBe(45);
    expect(stepRestDefault(360, 1)).toBeNull();
    const ev = restTimesView(edge);
    expect(ev.canReset).toBe(true);
    expect(ev.rows.find((r) => r.key === 'warmup')).toMatchObject({ seconds: 30, down: null, up: 45 });
    expect(ev.rows.find((r) => r.key === 'top')).toMatchObject({ seconds: 360, down: 345, up: null });
    expect(hasOwnRestDefaults(edge)).toBe(true);
  });

  it('shows what he gets now: a standard value snapped to his presets, his own exactly', () => {
    const presets = [60, 90, 180];
    expect(restTimesView({}, presets).rows.map((r) => r.text)).toEqual(['3:00', '3:00', '3:00', '1:30', '1:30', '1:30', '1:00']);
    expect(restTimesView({ top: 225, workingCompound: 135 }, presets).rows.map((r) => r.text)).toEqual(['3:00', '3:45', '3:00', '2:15', '1:30', '1:30', '1:00']);
  });
});

describe('rest levels from his defaults', () => {
  it('the standard defaults give the 27 Oct table exactly', () => {
    expect(restTableOf('normal')).toEqual({ top: 210, backoff: 180, workingMain: 180, workingCompound: 120, workingIsolation: 90, round: 90 });
    expect(restTableOf('shorter')).toEqual({ top: 210, backoff: 180, workingMain: 180, workingCompound: 90, workingIsolation: 75, round: 75 });
    expect(restTableOf('shortest')).toEqual({ top: 210, backoff: 180, workingMain: 180, workingCompound: 90, workingIsolation: 60, round: 60 });
    expect(BUILDER_REST_LEVELS.shorter).toEqual(restTableOf('shorter'));
  });

  it('scale from his: compound 3:00 → 2:30 → 2:00, isolation 2:00 → 1:30 → 1:15; the main lift never shortened', () => {
    expect(restTableOf('shorter', BENS)).toEqual({ top: 270, backoff: 210, workingMain: 240, workingCompound: 150, workingIsolation: 90, round: 45 });
    expect(restTableOf('shortest', BENS)).toEqual({ top: 270, backoff: 210, workingMain: 240, workingCompound: 120, workingIsolation: 75, round: 45 });
  });

  it('floors: a compound accessory never below 1:30, nothing below 0:30, and never longer than his standard', () => {
    const short = { workingCompound: 105, workingIsolation: 30, round: 45 };
    for (const l of ['shorter', 'shortest'] as const) {
      expect(restTableOf(l, short).workingCompound).toBe(90);
      expect(restTableOf(l, short).workingIsolation).toBe(30);
      expect(restTableOf(l, short).round).toBeGreaterThanOrEqual(30);
    }
    const under = { workingCompound: 75 };
    for (const l of ['normal', 'shorter', 'shortest'] as const) expect(restTableOf(l, under).workingCompound).toBe(75);
  });

  it('the `Rest when short on time` lines (values only)', () => {
    expect(restLevelTimesLine('normal')).toBe('Compound 2:00 · Isolation 1:30');
    expect(restLevelTimesLine('shorter')).toBe('Compound 1:30 · Isolation 1:15');
    expect(restLevelTimesLine('shortest')).toBe('Compound 1:30 · Isolation 1:00');
    expect(mainLiftRestLine()).toBe('Main lift 3:00');
    expect(restLevelTimesLine('normal', BENS)).toBe('Compound 3:00 · Isolation 2:00');
    expect(restLevelTimesLine('shortest', BENS)).toBe('Compound 2:00 · Isolation 1:15');
    expect(mainLiftRestLine(BENS)).toBe('Main lift 4:00');
    // As he gets them: the standard ones snap to his presets (60 / 90 / 180), his own don't.
    expect(restLevelTimesLine('normal', {}, [60, 90, 180])).toBe('Compound 1:30 · Isolation 1:30');
    expect(restLevelTimesLine('normal', { workingCompound: 120 }, [60, 90, 180])).toBe('Compound 2:00 · Isolation 1:30');
  });
});

describe('every default reader uses his values', () => {
  it('defaultRestS: by kind and role; before a drop never changes; his own exact, the standard ones still snap to his presets', () => {
    expect(defaultRestS('working', 'main', 'normal', undefined, BENS)).toBe(240);
    expect(defaultRestS('top', 'main', 'shortest', undefined, BENS)).toBe(270);
    expect(defaultRestS('backoff', 'compound', 'normal', undefined, BENS)).toBe(210);
    expect(defaultRestS('working', 'compound', 'normal', undefined, BENS)).toBe(180);
    expect(defaultRestS('drop', 'isolation', 'normal', undefined, BENS)).toBe(120);
    expect(defaultRestS('round', 'isolation', 'normal', undefined, BENS)).toBe(60);
    expect(defaultRestS('warmup', 'main', 'shortest', undefined, BENS)).toBe(90);
    expect(defaultRestS('before_drop', 'isolation', 'normal', undefined, BENS)).toBe(15);
    expect(defaultRestS('working', 'compound', 'normal', [60, 150, 300], BENS)).toBe(180);
    expect(defaultRestS('working', 'compound', 'normal', [60, 150, 300], { workingIsolation: 120 })).toBe(150);
    expect(defaultRestS('working', 'isolation', 'shorter', [60, 150, 300], { workingIsolation: 120 })).toBe(90);
    expect(defaultRestS('warmup', 'main', 'normal', [45, 300], {})).toBe(45);
    expect(defaultRestS('warmup', 'main', 'normal', [45, 300], { warmup: 75 })).toBe(75);
  });

  it('the builder: rests after rows, round rest, working rest, the estimate and the saved draft; his own slot rest wins', () => {
    const std = context();
    const bens: BuilderContext = { ...std, restDefaultsS: BENS };
    const w = chest(std);
    const main = all(w).find((s) => s.main) as BuilderSlot;
    const acc = all(w).find((s) => !s.main && std.info(s.exerciseId)?.role === 'compound') as BuilderSlot;
    const iso = all(w).find((s) => std.info(s.exerciseId)?.role === 'isolation') as BuilderSlot;
    expect(workingRestS(main, std.info, 'normal', undefined, BENS)).toBe(main.rows.some((r) => r.type === 'top') ? 270 : 240);
    expect(workingRestS(acc, std.info, 'normal', undefined, BENS)).toBe(180);
    expect(workingRestS(iso, std.info, 'normal', undefined, BENS)).toBe(120);
    expect(roundRestOf({ slots: [acc, iso], auto: false }, 'normal', undefined, BENS)).toBe(60);
    // Longer defaults: a longer workout.
    expect(estimateBuilderSeconds(w, bens)).toBeGreaterThan(estimateBuilderSeconds(w, std));
    // The draft saved carries his rests.
    const plan = toDraftPlan(w, { info: std.info, catalogueIdOf: (x) => x, checkedOnOf: () => null, restDefaultsS: BENS });
    const isoRests = plan.slots.find((s) => s.slotKey === iso.key)?.setTemplates.filter((t) => t.setType === 'working').map((t) => t.restS);
    expect(isoRests?.every((r) => r === 120)).toBe(true);
    // A rest of his own on the slot keeps it.
    const own: BuilderSlot = { ...iso, restS: { working: 45 } };
    expect(restAfterRows(own, std.info, 'normal', undefined, BENS).filter((_, i) => own.rows[i]?.type === 'working')).toEqual(own.rows.filter((r) => r.type === 'working').map(() => 45));
  });

  it('the fit: the main lift keeps his rests at every level; accessories go to his scaled level', () => {
    const std = context();
    const bens: BuilderContext = { ...std, restDefaultsS: BENS };
    const w = chest(bens);
    const main = all(w).find((s) => s.main) as BuilderSlot;
    const before = restAfterRows(main, bens.info, 'normal', undefined, BENS);
    const f = fitToMinutes(w, bens, { minutes: Math.floor(estimateBuilderSeconds({ ...w, restLevel: 'shortest' }, bens) / 60), mainGroup: 'Chest', grow: false, supersets: false });
    expect(f.workout.restLevel).toBe('shortest');
    const fm = all(f.workout).find((s) => s.main) as BuilderSlot;
    expect(restAfterRows(fm, bens.info, f.workout.restLevel, undefined, BENS)).toEqual(before);
    const iso = all(f.workout).find((s) => bens.info(s.exerciseId)?.role === 'isolation') as BuilderSlot;
    expect(workingRestS(iso, bens.info, f.workout.restLevel, undefined, BENS)).toBe(75);
  });

  it('the saved-workout editor’s Time: the shorter level from his defaults', () => {
    const three = (k: number) => [k + 1, k + 2, k + 3].map((x) => template(x, { targetReps: { min: 10, max: 10 } }));
    const exercises = [routineExercise(1, { exerciseId: 'main', order: 0, setTemplates: three(10), restBySetType: { working: { seconds: 180 } } }), routineExercise(2, { exerciseId: 'acc', order: 1, setTemplates: three(20), restBySetType: { working: { seconds: 180 } } })];
    const est = (list: readonly RoutineExercise[]) => list.reduce((a, e) => a + (e.restBySetType.working?.seconds ?? 0) * 3 + 135, 0);
    const base = { exercises, minutes: 15, main: [true, false], isCompound: () => true, isCore: () => false, defaultRestS: 90, estimateS: est, newId: () => id(999) };
    expect(fitTemplateToMinutes({ ...base, restDefaultsS: BENS }).exercises[1]?.restBySetType.working?.seconds).toBe(150);
    expect(fitTemplateToMinutes(base).exercises[1]?.restBySetType.working?.seconds).toBe(90);
  });

  it('a warm-up added to the open workout with none yet rests his warm-up value; with one, that one’s', () => {
    const s0 = startFixture().state;
    const bench = s0.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '';
    // Bench without its warm-ups (deleted) so the new one has none to copy.
    const bare: SessionAggregate = { ...s0, sets: s0.sets.map((x) => (x.sessionExerciseId === bench && x.setType === 'warmup' ? { ...x, status: 'deleted' as const } : x)) };
    const built = addWarmupCommand(bare, bench, { opId: 'w-1', at: at(400), newSetId: id(93001), warmupRestS: 90 });
    if (!built.ok) throw new Error(built.reason);
    expect(built.command.restS).toBe(90);
    const kept = addWarmupCommand(s0, bench, { opId: 'w-2', at: at(400), newSetId: id(93002), warmupRestS: 90 });
    if (!kept.ok) throw new Error(kept.reason);
    expect(kept.command.restS).toBe(s0.sets.find((x) => x.sessionExerciseId === bench && x.setType === 'warmup')?.rest.seconds);
  });
});

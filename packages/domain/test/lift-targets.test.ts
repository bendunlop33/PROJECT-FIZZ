import { describe, expect, it } from 'vitest';
import { TrainingProfileSchema, type LiftTarget, type TrainingChange, type TrainingProfile } from '@fizz/schemas';

import {
  applyTrainingChange,
  canAddLiftTarget,
  liftSetsOf,
  liftTargetChartValue,
  liftTargetChoices,
  liftTargetHit,
  liftTargetLine,
  liftTargetsInUse,
  liftTargetStatus,
  liftTargetTimeLeft,
  newLiftTarget,
  newTrainingProfile,
  readLiftTargetNumber,
  seriesTermsOfId,
  toMs,
  type LiftSet,
  type LiftTargetChoice,
  type ProgressSession,
} from '../src/index';

const ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000002';
const BENCH = '00000000-0000-4000-8000-0000000000b1';
const DB_PRESS = '00000000-0000-4000-8000-0000000000d1';
const SQUAT = '00000000-0000-4000-8000-0000000000c1';
const ROW = '00000000-0000-4000-8000-0000000000e1';
const CUSTOM = '00000000-0000-4000-8000-0000000000f1';
const SET_AT = '2026-10-13T09:00:00.000Z';

/** Display text uses no-break spaces; compare words. */
const plain = (x: string | null): string | null => (x === null ? null : x.replace(/\u00a0/g, ' '));
const at = (date: string, hour = 8): number => toMs(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`);
function set(exerciseId: string, date: string, value: number, reps: number, o: Partial<LiftSet> = {}): LiftSet {
  return { exerciseId, date, atMs: at(date), dateOnly: false, load: { value, unit: 'kg', convention: 'total' }, reps, equipmentKind: 'barbell', ...o };
}

const benchChoice: LiftTargetChoice = { exerciseId: BENCH, name: 'Bench Press', convention: 'total', unit: 'kg', plateLoaded: false, lastDate: '2026-10-13' };

function target(o: Partial<Parameters<typeof newLiftTarget>[0]> = {}, sets: readonly LiftSet[] = []): LiftTarget {
  return newLiftTarget({ id: 't1', choice: benchChoice, kind: 'one_rm', value: 100, unit: 'kg', reps: 1, byDate: null, atUtc: SET_AT, today: '2026-10-13', setBy: 'ben', ...o }, sets);
}

let n = 0;
function apply(p: TrainingProfile, c: TrainingChange) {
  return applyTrainingChange(p, c, { opId: `op-${String((n += 1))}`, expectedVersion: p.version, atUtc: '2026-10-14T08:00:00.000Z', nowYear: 2026, today: '2026-10-14' });
}
const fresh = (): TrainingProfile => newTrainingProfile({ id: ID, ownerId: OWNER, atUtc: '2026-10-13T08:00:00.000Z' });

describe('the setting and the stored list (rules 5, 10)', () => {
  it('is off by default: nothing is in use, and older profiles (no field) still parse', () => {
    const p = fresh();
    expect(p.liftTargetsOn).toBeUndefined();
    expect(liftTargetsInUse(p)).toEqual([]);
    expect(TrainingProfileSchema.safeParse(p).success).toBe(true);
  });

  it('turning it off hides the targets but keeps them', () => {
    const on = apply(fresh(), { kind: 'lift_targets_on', on: true });
    if (!on.ok) throw new Error('on');
    const withT = apply(on.profile, { kind: 'set_lift_target', target: target() });
    if (!withT.ok) throw new Error('set');
    expect(liftTargetsInUse(withT.profile)).toHaveLength(1);
    const off = apply(withT.profile, { kind: 'lift_targets_on', on: false });
    if (!off.ok) throw new Error('off');
    expect(liftTargetsInUse(off.profile)).toEqual([]);
    expect(off.profile.liftTargets).toHaveLength(1);
  });

  it('is one per exercise (a new one replaces it) and at most 3', () => {
    let p = fresh();
    for (const [i, ex] of [BENCH, SQUAT, ROW].entries()) {
      const r = apply(p, { kind: 'set_lift_target', target: target({ id: `t${String(i)}`, choice: { ...benchChoice, exerciseId: ex } }) });
      if (!r.ok) throw new Error('set');
      p = r.profile;
    }
    expect(p.liftTargets).toHaveLength(3);
    expect(canAddLiftTarget(p.liftTargets ?? [], DB_PRESS)).toBe(false);
    expect(canAddLiftTarget(p.liftTargets ?? [], BENCH)).toBe(true);
    const fourth = apply(p, { kind: 'set_lift_target', target: target({ id: 't4', choice: { ...benchChoice, exerciseId: DB_PRESS } }) });
    expect(fourth).toMatchObject({ ok: false, error: 'invalid' });
    const replace = apply(p, { kind: 'set_lift_target', target: target({ id: 't5', value: 110 }) });
    if (!replace.ok) throw new Error('replace');
    expect(replace.profile.liftTargets?.map((t) => [t.exerciseId, t.load.value])).toEqual([
      [BENCH, 110],
      [SQUAT, 100],
      [ROW, 100],
    ]);
    const removed = apply(replace.profile, { kind: 'remove_lift_target', exerciseId: SQUAT });
    if (!removed.ok) throw new Error('remove');
    expect(removed.profile.liftTargets?.map((t) => t.exerciseId)).toEqual([BENCH, ROW]);
  });

  it('refuses a stale version and replays a repeated operation ID', () => {
    const p = fresh();
    const w = { opId: 'same', expectedVersion: 1, atUtc: '2026-10-14T08:00:00.000Z', nowYear: 2026, today: '2026-10-14' };
    const first = applyTrainingChange(p, { kind: 'set_lift_target', target: target() }, w);
    if (!first.ok) throw new Error('first');
    expect(applyTrainingChange(first.profile, { kind: 'set_lift_target', target: target({ value: 120 }) }, w)).toMatchObject({ ok: true, replayed: true });
    expect(applyTrainingChange(first.profile, { kind: 'set_lift_target', target: target({ value: 120 }) }, { ...w, opId: 'other' })).toMatchObject({ ok: false, error: 'stale' });
  });

  it('refuses bad values: a 1RM with reps, a date before today, an absurd load', () => {
    const bad: LiftTarget[] = [
      { ...target(), reps: 5 },
      target({ byDate: '2026-10-01' }),
      target({ value: 2000 }),
      target({ unit: 'lb', value: 1400 }),
      { ...target(), byDate: '2026-02-31' },
    ];
    for (const t of bad) expect(apply(fresh(), { kind: 'set_lift_target', target: t }).ok).toBe(false);
  });
});

describe('display: est. 1RM, was, best, time and distance left (rule 6)', () => {
  const history = [set(BENCH, '2026-09-20', 80, 5), set(BENCH, '2026-10-01', 82.5, 3)];

  it('1RM: est. 1RM now and what it was when set, always labelled est.', () => {
    const t = target({ byDate: '2026-12-08' }, history);
    // Epley 80 × (1 + 5/30) = 93.33 → 93.5; 82.5 × 1.1 = 90.75 → 91.
    expect(t.was).toEqual({ value: 93.5, date: '2026-09-20', isEstimate: true });
    const later = [...history, set(BENCH, '2026-10-20', 85, 5)];
    const s = liftTargetStatus(t, later, '2026-10-20');
    expect(s.estimate).toEqual({ value: 99, date: '2026-10-20' });
    const line = liftTargetLine(t, s);
    expect(plain(line.title)).toBe('Bench Press 100 kg');
    expect(plain(line.detail)).toBe('est. 1RM 99 kg · was 93.5 kg on 20 Sep');
    expect(plain(line.progress)).toBe('7 weeks left · 1 kg to go');
    expect(line.hit).toBeNull();
    expect(line.accessibilityLabel).toContain('estimated 1RM');
  });

  it('an estimate at or past the target is not a hit and shows nothing to go', () => {
    const t = target({}, history);
    const s = liftTargetStatus(t, [...history, set(BENCH, '2026-10-20', 90, 5)], '2026-10-20');
    expect(s.estimate?.value).toBe(105);
    expect(s.hit).toBeNull();
    expect(s.toGo).toBeNull();
    expect(liftTargetLine(t, s).hit).toBeNull();
  });

  it('weight × reps: Best is the heaviest set of at least those reps', () => {
    const t = target({ kind: 'weight_reps', value: 90, reps: 5 }, history);
    expect(t.was).toEqual({ value: 80, reps: 5, date: '2026-09-20', isEstimate: false });
    const sets = [...history, set(BENCH, '2026-10-17', 85, 5), set(BENCH, '2026-10-18', 95, 3)];
    const s = liftTargetStatus(t, sets, '2026-10-18');
    expect(s.best).toEqual({ value: 85, reps: 5, date: '2026-10-17' });
    const line = liftTargetLine(t, s);
    expect(plain(line.title)).toBe('Bench Press 90 kg × 5');
    expect(plain(line.detail)).toBe('Best: 85 kg × 5 on 17 Oct');
    expect(plain(line.progress)).toBe('5 kg to go');
  });

  it('nothing logged: no detail, no was, and no made-up numbers', () => {
    const t = target({ byDate: '2026-10-20' });
    expect(t.was).toBeNull();
    const line = liftTargetLine(t, liftTargetStatus(t, [], '2026-10-14'));
    expect(line.detail).toBeNull();
    expect(plain(line.progress)).toBe('6 days left');
  });

  it('time left words', () => {
    expect(plain(liftTargetTimeLeft(56, '2026-12-08'))).toBe('8 weeks left');
    expect(plain(liftTargetTimeLeft(7, '2026-12-08'))).toBe('1 week left');
    expect(plain(liftTargetTimeLeft(1, '2026-12-08'))).toBe('1 day left');
    expect(plain(liftTargetTimeLeft(0, '2026-12-08'))).toBe('Due today');
    expect(plain(liftTargetTimeLeft(-3, '2026-12-08'))).toBe('Due 8 Dec');
  });
});

describe('hit detection: an actual logged set since it was set', () => {
  it('1RM: a single at the weight counts; the same day before setting it does not', () => {
    const t = target();
    expect(liftTargetHit(t, [set(BENCH, '2026-10-13', 100, 1, { atMs: toMs(SET_AT) - 60_000 })])).toBeNull();
    expect(liftTargetHit(t, [set(BENCH, '2026-10-20', 97.5, 1), set(BENCH, '2026-12-02', 100, 1), set(BENCH, '2026-12-09', 102.5, 1)])).toEqual({ date: '2026-12-02' });
    const s = liftTargetStatus(t, [set(BENCH, '2026-12-02', 100, 1)], '2026-12-10');
    const line = liftTargetLine(t, s);
    expect(plain(line.hit)).toBe('Hit 2 Dec');
    expect(line.progress).toBeNull();
  });

  it('weight × reps: the weight for at least the reps', () => {
    const t = target({ kind: 'weight_reps', value: 90, reps: 5 });
    expect(liftTargetHit(t, [set(BENCH, '2026-10-20', 90, 4), set(BENCH, '2026-10-21', 87.5, 8)])).toBeNull();
    expect(liftTargetHit(t, [set(BENCH, '2026-10-22', 92.5, 5)])).toEqual({ date: '2026-10-22' });
  });

  it('kg and lb: a set in lb is converted; 220 lb is under 100 kg, 225 lb is over', () => {
    const t = target();
    const lb = (v: number, date: string) => set(BENCH, date, v, 1, { load: { value: v, unit: 'lb', convention: 'total' } });
    expect(liftTargetHit(t, [lb(220, '2026-10-20')])).toBeNull();
    expect(liftTargetHit(t, [lb(225, '2026-10-21')])).toEqual({ date: '2026-10-21' });
    const inLb = target({ unit: 'lb', value: 225 });
    expect(inLb.load.unit).toBe('lb');
    expect(liftTargetHit(inLb, [set(BENCH, '2026-10-22', 102.5, 1)])).toEqual({ date: '2026-10-22' });
    expect(plain(liftTargetLine(inLb, liftTargetStatus(inLb, [], '2026-10-14')).title)).toBe('Bench Press 225 lb');
  });

  it('per-hand dumbbells: compared per hand, never with a total', () => {
    const choice: LiftTargetChoice = { exerciseId: DB_PRESS, name: 'Dumbbell Press', convention: 'per_hand', unit: 'kg', plateLoaded: false, lastDate: '2026-10-10' };
    const t = target({ choice, kind: 'weight_reps', value: 40, reps: 8 });
    expect(t.load.convention).toBe('per_hand');
    const perHand = (v: number) => set(DB_PRESS, '2026-10-20', v, 8, { load: { value: v, unit: 'kg', convention: 'per_hand' }, equipmentKind: 'dumbbells' });
    const total = set(DB_PRESS, '2026-10-20', 80, 8, { equipmentKind: 'dumbbells' });
    expect(liftTargetHit(t, [total])).toBeNull();
    expect(liftTargetHit(t, [perHand(37.5)])).toBeNull();
    expect(liftTargetHit(t, [perHand(40)])).toEqual({ date: '2026-10-20' });
    expect(plain(liftTargetLine(t, liftTargetStatus(t, [], '2026-10-14')).title)).toBe('Dumbbell Press 40 kg each × 8');
  });

  it('a date-only import counts from the day after it was set', () => {
    const t = target();
    expect(liftTargetHit(t, [set(BENCH, '2026-10-13', 100, 1, { dateOnly: true, atMs: at('2026-10-13', 23) })])).toBeNull();
    expect(liftTargetHit(t, [set(BENCH, '2026-10-14', 100, 1, { dateOnly: true })])).toEqual({ date: '2026-10-14' });
  });
});

describe('sets and choices', () => {
  const session = (date: string, exercises: ProgressSession['exercises']): ProgressSession => ({
    sessionId: `s-${date}`,
    version: 1,
    source: 'manual',
    name: null,
    gymId: null,
    startedAtUtc: `${date}T08:00:00.000Z`,
    startedMs: at(date),
    tz: 'UTC',
    date,
    dateOnly: false,
    endedAtUtc: null,
    durationMs: null,
    durationConfirmed: false,
    exercises,
  });
  const ex = (exerciseId: string, convention: 'total' | 'per_hand' | 'assistance' | 'stack', sets: { type?: 'warmup' | 'working'; value: number; reps: number; spotted?: boolean }[], name = 'X'): ProgressSession['exercises'][number] => ({
    sessionExerciseId: `se-${exerciseId}`,
    exerciseId,
    exerciseName: name,
    equipmentId: null,
    equipmentKind: convention === 'assistance' ? 'assisted_stack' : convention === 'stack' ? 'weight_stack' : 'barbell',
    gymId: null,
    convention,
    unit: 'kg',
    measurement: 'reps',
    laterality: 'bilateral',
    sets: sets.map((s, i) => ({
      setId: `x${String(i)}`,
      setType: s.type ?? 'working',
      side: null,
      load: { value: s.value, unit: 'kg', convention },
      reps: s.reps,
      durationS: null,
      rpe: null,
      rir: null,
      completedAtUtc: `2026-10-0${String(i + 1)}T08:00:00.000Z`,
      index: i,
      ...(s.spotted ? { exclusions: ['spotted' as const] } : {}),
    })),
  });

  it('leaves out warm-ups and marked sets', () => {
    const sets = liftSetsOf([session('2026-10-05', [ex(BENCH, 'total', [{ type: 'warmup', value: 120, reps: 1 }, { value: 120, reps: 1, spotted: true }, { value: 90, reps: 3 }])])]);
    expect(sets.map((s) => s.load.value)).toEqual([90]);
  });

  it('offers exercises Ben logged with a load, his own included; never assisted ones', () => {
    const sets = liftSetsOf([
      session('2026-10-01', [ex(BENCH, 'total', [{ value: 90, reps: 3 }]), ex(ROW, 'assistance', [{ value: 20, reps: 8 }])]),
      session('2026-10-05', [ex(CUSTOM, 'stack', [{ value: 50, reps: 10 }], 'My Machine Press')]),
    ]);
    type Named = { id: string; name: string; archivedAtUtc?: string };
    const names = new Map<string, Named>([
      [BENCH, { id: BENCH, name: 'Bench Press' }],
      [CUSTOM, { id: CUSTOM, name: 'My Machine Press' }],
    ]);
    expect(liftTargetChoices(sets, names).map((c) => [c.name, c.convention])).toEqual([
      ['My Machine Press', 'stack'],
      ['Bench Press', 'total'],
    ]);
    const archived = new Map<string, Named>([...names, [CUSTOM, { id: CUSTOM, name: 'My Machine Press', archivedAtUtc: '2026-10-10T00:00:00.000Z' }]]);
    expect(liftTargetChoices(sets, archived).map((c) => c.name)).toEqual(['Bench Press']);
  });

  it('reads the editor number', () => {
    expect(readLiftTargetNumber('102,5')).toBe(102.5);
    expect(readLiftTargetNumber('0')).toBeNull();
    expect(readLiftTargetNumber('abc')).toBeNull();
  });
});

describe('the exercise detail chart line', () => {
  it('1RM on Est. 1RM; weight × reps on Top set; the series unit; never another convention', () => {
    const t = target();
    expect(liftTargetChartValue(t, { exerciseId: BENCH, convention: 'total', unit: 'kg', metric: 'e1rm' })).toBe(100);
    expect(liftTargetChartValue(t, { exerciseId: BENCH, convention: 'total', unit: 'kg', metric: 'top_set' })).toBeNull();
    expect(liftTargetChartValue(t, { exerciseId: BENCH, convention: 'per_hand', unit: 'kg', metric: 'e1rm' })).toBeNull();
    expect(liftTargetChartValue(t, { exerciseId: BENCH, convention: 'total', unit: 'lb', metric: 'e1rm' })).toBeCloseTo(220.46, 1);
    const wr = target({ kind: 'weight_reps', value: 90, reps: 5 });
    expect(liftTargetChartValue(wr, { exerciseId: BENCH, convention: 'total', unit: 'kg', metric: 'top_set' })).toBe(90);
  });

  it('reads a Progress series ID', () => {
    expect(seriesTermsOfId(`${BENCH}|eq|total|kg|reps`)).toEqual({ exerciseId: BENCH, convention: 'total', unit: 'kg' });
    expect(seriesTermsOfId('nope')).toBeNull();
  });
});


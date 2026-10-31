import { describe, expect, it } from 'vitest';
import { TrainingProfileSchema, type MuscleGroup, type TrainingChange, type TrainingProfile } from '@fizz/schemas';

import {
  ageFromBirthYear,
  applyTrainingChange,
  cmFromFeetInches,
  DEFAULT_SPLIT,
  feetInches,
  goalCheckInDue,
  heightText,
  latestWeight,
  mainLiftFor,
  mainLiftOptions,
  matchSplitDay,
  newTrainingProfile,
  nextSplitDay,
  pinnedNoteFor,
  PRESET_SPLITS,
  recommendMainLift,
  weightText,
  lastSplitWorkoutGroups,
  liftHistoryFrom,
  splitDayFocus,
  workoutMuscleGroups,
  type LiftHistory,
} from '../src/index';
import { richFinishedSession, SPLIT_SQUAT } from './testing';

const ID = '00000000-0000-4000-8000-000000000001';
const OWNER = '00000000-0000-4000-8000-000000000002';
const T0 = '2026-10-13T08:00:00.000Z';
const T1 = '2026-10-14T08:00:00.000Z';

const fresh = (): TrainingProfile => newTrainingProfile({ id: ID, ownerId: OWNER, atUtc: T0 });

let n = 0;
function apply(p: TrainingProfile, c: TrainingChange, opId = `op-${String((n += 1))}`) {
  return applyTrainingChange(p, c, { opId, expectedVersion: p.version, atUtc: T1, nowYear: 2026, today: '2026-10-14' });
}
function ok(p: TrainingProfile, c: TrainingChange): TrainingProfile {
  const r = apply(p, c);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.profile;
}

describe('training profile writes (rule 5)', () => {
  it('a new profile is valid with the defaults: check-in 6 weeks, 45 min, self targets off, nothing else set', () => {
    const p = fresh();
    expect(TrainingProfileSchema.parse(p)).toEqual(p);
    expect(p).toMatchObject({ checkInWeeks: 6, sessionMinutes: 45, selfNextTargets: false, about: {}, weights: [] });
    expect(p.goal).toBeUndefined();
    expect(p.split).toBeUndefined();
  });

  it('each change bumps the version and records its op ID', () => {
    const p = ok(fresh(), { kind: 'gender', gender: 'male' });
    expect(p.version).toBe(2);
    expect(p.updatedAtUtc).toBe(T1);
    expect(p.about.gender).toBe('male');
    expect(p.recentOps).toHaveLength(1);
  });

  it('a repeated op ID is a no-op replay, even after the version moved', () => {
    const p0 = fresh();
    const a = applyTrainingChange(p0, { kind: 'add_weight', entry: { id: 'w1', date: '2026-10-13', value: 82.5, unit: 'kg' } }, { opId: 'dup', expectedVersion: 1, atUtc: T1, nowYear: 2026, today: '2026-10-14' });
    if (!a.ok) throw new Error('setup');
    const again = applyTrainingChange(a.profile, { kind: 'add_weight', entry: { id: 'w1', date: '2026-10-13', value: 82.5, unit: 'kg' } }, { opId: 'dup', expectedVersion: 1, atUtc: T1, nowYear: 2026, today: '2026-10-14' });
    expect(again).toEqual({ ok: true, profile: a.profile, replayed: true });
    expect(a.profile.weights).toHaveLength(1);
  });

  it('a stale version is rejected and nothing changes', () => {
    const p = ok(fresh(), { kind: 'goal', goal: 'strength' });
    const r = applyTrainingChange(p, { kind: 'goal', goal: 'muscle' }, { opId: 'late', expectedVersion: 1, atUtc: T1, nowYear: 2026, today: '2026-10-14' });
    expect(r).toEqual({ ok: false, error: 'stale', currentVersion: 2 });
  });

  it('out-of-range values are invalid: birth year, height, weight, check-in weeks, days, session length', () => {
    const p = fresh();
    const bad: TrainingChange[] = [
      { kind: 'birth_year', year: 2020 },
      { kind: 'birth_year', year: 1900 },
      { kind: 'height', cm: 90 },
      { kind: 'add_weight', entry: { id: 'x', date: '2026-10-13', value: 20, unit: 'kg' } },
      { kind: 'add_weight', entry: { id: 'x', date: '13/10/2026', value: 80, unit: 'kg' } },
      { kind: 'check_in_weeks', weeks: 3 },
      { kind: 'check_in_weeks', weeks: 13 },
      { kind: 'days_per_week', days: 0 },
      { kind: 'session_minutes', minutes: 10 },
      { kind: 'main_lift', dayId: 'nope', exerciseId: 'x' },
      { kind: 'custom_split', days: [] },
      { kind: 'custom_split', days: [{ id: 'a', name: '  ', bodyParts: ['Chest'] }] },
      { kind: 'custom_split', days: [{ id: 'a', name: 'Arms', bodyParts: [] }] },
      { kind: 'custom_split', days: [{ id: 'a', name: 'A', bodyParts: ['Chest'] }, { id: 'a', name: 'B', bodyParts: ['Back'] }] },
    ];
    for (const c of bad) expect(apply(p, c)).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('about you: birth year, gender, height and experience set and clear (Not set)', () => {
    let p = ok(fresh(), { kind: 'birth_year', year: 1992 });
    p = ok(p, { kind: 'height', cm: 180.04 });
    p = ok(p, { kind: 'experience', level: 'experienced' });
    expect(p.about).toEqual({ birthYear: 1992, heightCm: 180, experience: 'experienced' });
    p = ok(p, { kind: 'gender', gender: 'female' });
    p = ok(p, { kind: 'gender', gender: null });
    expect(p.about.gender).toBeUndefined();
  });

  it('weights: dated entries in kg or lb, kept in date order, deleted by ID', () => {
    let p = ok(fresh(), { kind: 'add_weight', entry: { id: 'b', date: '2026-10-10', value: 181, unit: 'lb' } });
    p = ok(p, { kind: 'add_weight', entry: { id: 'a', date: '2026-09-01', value: 83, unit: 'kg' } });
    expect(p.weights.map((w) => w.id)).toEqual(['a', 'b']);
    expect(latestWeight(p.weights)?.id).toBe('b');
    p = ok(p, { kind: 'delete_weight', entryId: 'b' });
    expect(p.weights.map((w) => w.id)).toEqual(['a']);
    expect(latestWeight([])).toBeNull();
  });

  it('a lb weight is checked in kg: 55 lb (25 kg) is accepted, 50 lb is not', () => {
    expect(apply(fresh(), { kind: 'add_weight', entry: { id: 'x', date: '2026-10-13', value: 50, unit: 'lb' } })).toMatchObject({ ok: false });
    expect(apply(fresh(), { kind: 'add_weight', entry: { id: 'x', date: '2026-10-13', value: 56, unit: 'lb' } })).toMatchObject({ ok: true });
  });

  it('goal: set records when, so the check-in counts from it; clearing removes both', () => {
    let p = ok(fresh(), { kind: 'goal', goal: 'both' });
    expect(p.goalSetAtUtc).toBe(T1);
    p = ok(p, { kind: 'check_in_weeks', weeks: 4 });
    expect(goalCheckInDue(p, '2026-11-10T08:00:00.000Z')).toBe(false);
    expect(goalCheckInDue(p, '2026-11-11T08:00:00.000Z')).toBe(true);
    p = ok(p, { kind: 'goal', goal: null });
    expect(p.goalSetAtUtc).toBeUndefined();
    expect(goalCheckInDue(p, '2027-11-11T08:00:00.000Z')).toBe(false);
  });

  it('split: a preset, a custom list, and main lifts carried to a day with the same ID', () => {
    let p = ok(fresh(), { kind: 'main_lift', dayId: 'legs', exerciseId: 'squat' });
    expect(p.split?.kind).toBe('ppl');
    p = ok(p, { kind: 'preset_split', split: 'clsb' });
    expect(p.split?.days.map((d) => d.name)).toEqual(['Chest', 'Legs', 'Shoulders', 'Back']);
    expect(p.split?.days.find((d) => d.id === 'legs')?.mainLiftExerciseId).toBe('squat');
    p = ok(p, { kind: 'custom_split', days: [{ id: 'u', name: ' Upper ', bodyParts: ['Chest', 'Back'] }, { id: 'legs', name: 'Legs', bodyParts: ['Quads'] }] });
    expect(p.split).toEqual({ kind: 'custom', days: [{ id: 'u', name: 'Upper', bodyParts: ['Chest', 'Back'] }, { id: 'legs', name: 'Legs', bodyParts: ['Quads'], mainLiftExerciseId: 'squat' }] });
    p = ok(p, { kind: 'main_lift', dayId: 'legs', exerciseId: null });
    expect(p.split?.days[1]?.mainLiftExerciseId).toBeUndefined();
  });

  it('review B2: Custom → preset → Custom restores the custom days and their main lifts', () => {
    let p = ok(fresh(), { kind: 'custom_split', days: [{ id: 'u', name: 'Upper', bodyParts: ['Chest', 'Back'] }, { id: 'a', name: 'Arms', bodyParts: ['Biceps', 'Triceps'] }] });
    p = ok(p, { kind: 'main_lift', dayId: 'u', exerciseId: 'bench' });
    const custom = p.split;
    p = ok(p, { kind: 'preset_split', split: 'ppl' });
    expect(p.split?.kind).toBe('ppl');
    expect(p.customDays?.map((d) => d.name)).toEqual(['Upper', 'Arms']);
    // Picking Custom again sends the kept days (the Split screen's `customStartDays`).
    p = ok(p, { kind: 'custom_split', days: p.customDays ?? [] });
    expect(p.split).toEqual(custom);
    expect(TrainingProfileSchema.parse(p)).toEqual(p);
  });

  it('review B2: PPL → CLSB → PPL restores the Push and Pull main lifts; Legs carries both ways', () => {
    let p = ok(fresh(), { kind: 'main_lift', dayId: 'push', exerciseId: 'ohp' });
    p = ok(p, { kind: 'main_lift', dayId: 'pull', exerciseId: 'row' });
    p = ok(p, { kind: 'main_lift', dayId: 'legs', exerciseId: 'squat' });
    p = ok(p, { kind: 'preset_split', split: 'clsb' });
    expect(p.split?.days.map((d) => d.mainLiftExerciseId)).toEqual([undefined, 'squat', undefined, undefined]);
    p = ok(p, { kind: 'main_lift', dayId: 'chest', exerciseId: 'bench' });
    p = ok(p, { kind: 'preset_split', split: 'ppl' });
    expect(p.split?.days.map((d) => d.mainLiftExerciseId)).toEqual(['ohp', 'row', 'squat']);
    p = ok(p, { kind: 'preset_split', split: 'clsb' });
    expect(p.split?.days.find((d) => d.id === 'chest')?.mainLiftExerciseId).toBe('bench');
  });

  it('review B2: a main lift cleared on one split stays cleared; removed custom days drop their lifts', () => {
    let p = ok(fresh(), { kind: 'main_lift', dayId: 'push', exerciseId: 'ohp' });
    p = ok(p, { kind: 'main_lift', dayId: 'push', exerciseId: null });
    p = ok(ok(p, { kind: 'preset_split', split: 'clsb' }), { kind: 'preset_split', split: 'ppl' });
    expect(p.split?.days[0]?.mainLiftExerciseId).toBeUndefined();
    p = ok(p, { kind: 'custom_split', days: [{ id: 'x', name: 'X', bodyParts: ['Core'] }, { id: 'y', name: 'Y', bodyParts: ['Calves'] }] });
    p = ok(p, { kind: 'main_lift', dayId: 'y', exerciseId: 'calf' });
    p = ok(p, { kind: 'custom_split', days: [{ id: 'x', name: 'X', bodyParts: ['Core'] }] });
    expect(p.mainLifts).toEqual({});
  });

  it('an older row with lifts only on the split days still carries them', () => {
    const legacy: TrainingProfile = { ...fresh(), split: { kind: 'ppl', days: PRESET_SPLITS.ppl.map((d) => (d.id === 'legs' ? { ...d, mainLiftExerciseId: 'squat' } : d)) } };
    const p = ok(legacy, { kind: 'preset_split', split: 'clsb' });
    expect(p.mainLifts).toEqual({ legs: 'squat' });
  });

  it('review S5: a weight dated after today is refused', () => {
    expect(apply(fresh(), { kind: 'add_weight', entry: { id: 'x', date: '2026-10-15', value: 80, unit: 'kg' } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(apply(fresh(), { kind: 'add_weight', entry: { id: 'x', date: '2026-10-14', value: 80, unit: 'kg' } })).toMatchObject({ ok: true });
  });

  it('D5: self next-time targets default off and switch on', () => {
    expect(ok(fresh(), { kind: 'self_next_targets', on: true }).selfNextTargets).toBe(true);
  });
});

describe('derived values', () => {
  it('age from birth year is the age reached this calendar year', () => {
    expect(ageFromBirthYear(1992, 2026)).toBe(34);
  });

  it('height shows cm and ft/in; ft/in converts back', () => {
    expect(heightText(180)).toBe('180 cm · 5′11″');
    expect(feetInches(152.4)).toEqual({ ft: 5, inch: 0 });
    expect(cmFromFeetInches(6, 0)).toBe(182.9);
  });

  it('weight shows in the chosen unit', () => {
    expect(weightText({ value: 82.5, unit: 'kg' }, 'kg')).toBe('82.5 kg');
    expect(weightText({ value: 100, unit: 'kg' }, 'lb')).toBe('220.5 lb');
  });
});

describe('split rotation (F19)', () => {
  const groups = (o: Partial<Record<MuscleGroup, number>>) => new Map(Object.entries(o) as [MuscleGroup, number][]);

  it('workout muscle groups count working sets on each exercise’s first primary muscle', () => {
    expect(workoutMuscleGroups([{ primaryMuscles: ['chest', 'triceps'], workingSets: 3 }, { primaryMuscles: ['triceps'], workingSets: 2 }, { primaryMuscles: [], workingSets: 3 }, { primaryMuscles: ['lats'], workingSets: 0 }])).toEqual(groups({ Chest: 3, Triceps: 2 }));
  });

  it('the next day follows the last workout’s day and wraps; first day with no history or no match', () => {
    expect(nextSplitDay(DEFAULT_SPLIT, null).id).toBe('push');
    expect(nextSplitDay(DEFAULT_SPLIT, groups({ Chest: 6, Triceps: 3 })).id).toBe('pull');
    expect(nextSplitDay(DEFAULT_SPLIT, groups({ Quads: 6, Calves: 3 })).id).toBe('push');
    expect(nextSplitDay(DEFAULT_SPLIT, groups({ Core: 6 })).id).toBe('push');
    const clsb = { kind: 'clsb' as const, days: [...PRESET_SPLITS.clsb] };
    expect(nextSplitDay(clsb, groups({ Shoulders: 6, Triceps: 2 })).id).toBe('back');
    expect(matchSplitDay(clsb, groups({ Triceps: 3 }))?.id).toBe('chest');
  });

  it('rear delts count as Back (§9 Q13): a rear-delt workout matches the Back/Pull day, not Shoulders', () => {
    const rear = workoutMuscleGroups([{ primaryMuscles: ['rear_delts', 'upper_back'], workingSets: 4 }, { primaryMuscles: ['rear_delts'], workingSets: 3 }, { primaryMuscles: ['side_delts'], workingSets: 2 }]);
    expect(rear).toEqual(groups({ Back: 7, Shoulders: 2 }));
    const clsb = { kind: 'clsb' as const, days: [...PRESET_SPLITS.clsb] };
    expect(matchSplitDay(clsb, rear)?.id).toBe('back');
    expect(matchSplitDay(DEFAULT_SPLIT, rear)?.id).toBe('pull');
  });
});

describe('main lift (D7)', () => {
  const ex = (id: string, name: string, muscle: string, mechanic: 'compound' | 'isolation' = 'compound') => ({ id, name, primaryMuscles: [muscle], mechanic });
  const history: LiftHistory[] = [
    { exercise: ex('bench', 'Bench press', 'chest'), sessions: 10, bestKg: 100 },
    { exercise: ex('incline', 'Incline DB press', 'upper_chest'), sessions: 12, bestKg: 34 },
    { exercise: ex('ohp', 'Overhead press', 'front_delts'), sessions: 20, bestKg: 60 },
    { exercise: ex('fly', 'Cable fly', 'chest', 'isolation'), sessions: 30, bestKg: 20 },
    { exercise: ex('squat', 'Squat', 'quads'), sessions: 0, bestKg: 140 },
  ];

  it('recommends a compound lift for the day’s first body part, most workouts first', () => {
    expect(recommendMainLift(PRESET_SPLITS.ppl[0] ?? { bodyParts: ['Chest'] }, history)?.id).toBe('incline');
    expect(recommendMainLift({ bodyParts: ['Shoulders', 'Triceps'] }, history)?.id).toBe('ohp');
    expect(recommendMainLift({ bodyParts: ['Quads'] }, history)).toBeNull();
  });

  it('Ben’s choice wins; an unknown choice falls back to the recommendation', () => {
    const day = { id: 'push', name: 'Push', bodyParts: ['Chest', 'Shoulders', 'Triceps'] as const };
    const names: Record<string, string> = { bench: 'Bench press' };
    const nameOf = (id: string) => names[id] ?? null;
    expect(mainLiftFor({ ...day, bodyParts: [...day.bodyParts], mainLiftExerciseId: 'bench' }, history, nameOf)).toEqual({ exerciseId: 'bench', name: 'Bench press', source: 'yours' });
    expect(mainLiftFor({ ...day, bodyParts: [...day.bodyParts], mainLiftExerciseId: 'gone' }, history, nameOf)).toEqual({ exerciseId: 'incline', name: 'Incline DB press', source: 'recommended' });
  });

  it('options are compound lifts for the day’s body parts, by name', () => {
    expect(mainLiftOptions({ bodyParts: ['Chest'] }, history.map((h) => h.exercise)).map((e) => e.id)).toEqual(['bench', 'incline']);
  });

  it('a rear-delt-led compound is a Back main lift, not a Shoulders one (§9 Q13)', () => {
    const highRow = ex('high-row', 'High row', 'rear_delts');
    const rows: LiftHistory[] = [...history, { exercise: highRow, sessions: 40, bestKg: 50 }];
    expect(mainLiftOptions({ bodyParts: ['Back', 'Biceps'] }, rows.map((h) => h.exercise)).map((e) => e.id)).toEqual(['high-row']);
    expect(mainLiftOptions({ bodyParts: ['Shoulders'] }, rows.map((h) => h.exercise)).map((e) => e.id)).toEqual(['ohp']);
    expect(recommendMainLift({ bodyParts: ['Back', 'Biceps'] }, rows)?.id).toBe('high-row');
    expect(recommendMainLift({ bodyParts: ['Shoulders', 'Triceps'] }, rows)?.id).toBe('ohp');
  });
});

describe('from history (finished workouts)', () => {
  const squat = { ...SPLIT_SQUAT, primaryMuscles: ['quads'], mechanic: 'compound' as const };
  const exerciseOf = (id: string) => (id === squat.id ? squat : null);

  it('counts each exercise once per workout with its heaviest completed working load (per-hand kept as typed)', () => {
    const h = liftHistoryFrom([richFinishedSession(), richFinishedSession()], exerciseOf);
    expect(h).toEqual([{ exercise: squat, sessions: 2, bestKg: 15 }]);
    expect(liftHistoryFrom([richFinishedSession()], () => null)).toEqual([]);
  });

  it('the last workout’s groups feed the rotation: split squats (quads) → Legs, so Push is next', () => {
    const g = lastSplitWorkoutGroups(DEFAULT_SPLIT, [richFinishedSession()], exerciseOf);
    expect(g?.get('Quads')).toBeGreaterThan(0);
    expect(nextSplitDay(DEFAULT_SPLIT, g).id).toBe('push');
    expect(lastSplitWorkoutGroups(DEFAULT_SPLIT, [], exerciseOf)).toBeNull();
  });

  it('review S6: a newer workout that fits no day (Core only) is skipped, so the rotation keeps going', () => {
    const push = richFinishedSession();
    const core = richFinishedSession();
    const later = new Date(Date.parse(push.session.startedAt.utc) + 86_400_000).toISOString();
    const coreAgg = { ...core, session: { ...core.session, startedAt: { ...core.session.startedAt, utc: later } }, exercises: core.exercises.map((e) => ({ ...e, exerciseId: 'plank' })) };
    const plank = { ...squat, id: 'plank', name: 'Plank', primaryMuscles: ['abs'] };
    const press = { ...squat, primaryMuscles: ['chest'] };
    const of = (id: string) => (id === squat.id ? press : id === 'plank' ? plank : null);
    // Push, then Core only: Pull is next (not back to Push).
    const g = lastSplitWorkoutGroups(DEFAULT_SPLIT, [coreAgg, push], of);
    expect(g?.get('Chest')).toBeGreaterThan(0);
    expect(nextSplitDay(DEFAULT_SPLIT, g).id).toBe('pull');
    expect(lastSplitWorkoutGroups(DEFAULT_SPLIT, [coreAgg], of)).toBeNull();
  });

  it('a split day’s build focus: preset days by ID, custom days by name (split_day)', () => {
    expect(splitDayFocus({ kind: 'clsb' }, { id: 'shoulders' })).toBe('shoulders');
    expect(splitDayFocus({ kind: 'ppl' }, { id: 'pull' })).toBe('pull');
    expect(splitDayFocus({ kind: 'custom' }, { id: 'legs' })).toBe('split_day');
  });
});

describe('(Ben, 26 Oct) pinned exercise notes', () => {
  const BENCH = 'ex-bench';
  const GYM_A = 'gym-a';

  it('pin, replace, gym-only alongside every-gym, unpin; Your data in the profile, versioned', () => {
    let p = ok(fresh(), { kind: 'pin_note', exerciseId: BENCH, gymId: null, text: '  Seat 4, pins at 6  ' });
    expect(p.pinnedNotes).toEqual([{ exerciseId: BENCH, gymId: null, text: 'Seat 4, pins at 6', updatedAtUtc: T1 }]);
    p = ok(p, { kind: 'pin_note', exerciseId: BENCH, gymId: GYM_A, text: 'Bench 2, the wobbly one' });
    p = ok(p, { kind: 'pin_note', exerciseId: BENCH, gymId: null, text: 'Seat 5' });
    expect(p.pinnedNotes?.map((x) => [x.gymId, x.text])).toEqual([
      [GYM_A, 'Bench 2, the wobbly one'],
      [null, 'Seat 5'],
    ]);
    expect(pinnedNoteFor(p.pinnedNotes, BENCH, GYM_A)?.text).toBe('Bench 2, the wobbly one');
    expect(pinnedNoteFor(p.pinnedNotes, BENCH, 'gym-b')?.text).toBe('Seat 5');
    expect(pinnedNoteFor(p.pinnedNotes, BENCH, null)?.text).toBe('Seat 5');
    expect(pinnedNoteFor(p.pinnedNotes, 'other', GYM_A)).toBeNull();
    p = ok(p, { kind: 'unpin_note', exerciseId: BENCH, gymId: null });
    expect(pinnedNoteFor(p.pinnedNotes, BENCH, 'gym-b')).toBeNull();
    p = ok(p, { kind: 'unpin_note', exerciseId: BENCH, gymId: GYM_A });
    expect(p.pinnedNotes).toBeUndefined();
    expect(TrainingProfileSchema.parse(p)).toEqual(p);
  });

  it('an empty or too-long note is refused; a repeated opId writes once; a stale version is refused', () => {
    expect(apply(fresh(), { kind: 'pin_note', exerciseId: BENCH, gymId: null, text: '   ' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(apply(fresh(), { kind: 'pin_note', exerciseId: BENCH, gymId: null, text: 'x'.repeat(501) })).toMatchObject({ ok: false, error: 'invalid' });
    const p0 = fresh();
    const first = applyTrainingChange(p0, { kind: 'pin_note', exerciseId: BENCH, gymId: null, text: 'Seat 4' }, { opId: 'pin-1', expectedVersion: p0.version, atUtc: T1, nowYear: 2026, today: '2026-10-14' });
    if (!first.ok) throw new Error('not written');
    const again = applyTrainingChange(first.profile, { kind: 'pin_note', exerciseId: BENCH, gymId: null, text: 'Seat 4' }, { opId: 'pin-1', expectedVersion: p0.version, atUtc: T1, nowYear: 2026, today: '2026-10-14' });
    expect(again).toMatchObject({ ok: true, replayed: true });
    if (again.ok) expect(again.profile.version).toBe(first.profile.version);
    const stale = applyTrainingChange(first.profile, { kind: 'unpin_note', exerciseId: BENCH, gymId: null }, { opId: 'unpin-1', expectedVersion: p0.version, atUtc: T1, nowYear: 2026, today: '2026-10-14' });
    expect(stale).toMatchObject({ ok: false, error: 'stale' });
  });
});

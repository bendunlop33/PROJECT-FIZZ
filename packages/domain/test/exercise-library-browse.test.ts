import { describe, expect, it } from 'vitest';

import type { Exercise, Load } from '@fizz/schemas';

import {
  actualSetText,
  buildAddDestinations,
  NO_DISTANCE_IN_WORKOUTS,
  buildExerciseBrowseView,
  buildExerciseInfoView,
  editDistance,
  equipmentFiltersOf,
  gymAvailability,
  lastActualByExercise,
  matchExercise,
  muscleGroupsOf,
  NO_FILTERS,
  passesFilters,
  pickerSections,
  searchExerciseRows,
  searchExercises,
  type BrowseEntry,
  type ExerciseFilters,
  type ProgressExercise,
  type ProgressSession,
  type ProgressSet,
} from '../src/index';
import { assisted, barbell, dumbbells, exercise, GYM, id, kg, lb, stack } from './fixtures';

/**
 * Library › Exercises and Exercise detail (exercise-library §9, EL1, EL2):
 * search with aliases and typos, filters, the `At <gym>` count, rows' `Last`
 * actuals in their own unit and convention (kg/lb, per-hand dumbbells,
 * assisted machines, bodyweight), the detail model (Coaching knowledge vs
 * Your data) and the Add sheet's destinations.
 */

const NB = ' ';
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NB, ' ');

const RDL = exercise(1, 'Romanian deadlift', { movementPattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'] });
const SL_RDL = exercise(2, 'Single-leg RDL', { movementPattern: 'hinge', primaryMuscles: ['hamstrings'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', laterality: 'unilateral' });
const BENCH = exercise(3, 'Bench press', { movementPattern: 'horizontal_push', primaryMuscles: ['chest'] });
const DB_BENCH = exercise(4, 'Dumbbell bench press', { movementPattern: 'horizontal_push', primaryMuscles: ['chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const FLY = exercise(5, 'Cable fly', { movementPattern: 'horizontal_push', primaryMuscles: ['chest'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const PULLUP = exercise(6, 'Assisted pull-up', { movementPattern: 'vertical_pull', primaryMuscles: ['lats'], compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
const PUSHUP = exercise(7, 'Push-up', { movementPattern: 'horizontal_push', primaryMuscles: ['chest'], compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
const ARNOLD = exercise(8, 'Arnold press', { movementPattern: 'vertical_push', primaryMuscles: ['front_delts'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const DB_RDL = exercise(9, 'Dumbbell Romanian deadlift', { movementPattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const PLANK = exercise(10, 'Plank', { movementPattern: 'core', primaryMuscles: ['abs'], compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', measurement: 'duration' });

const ALIASES: Record<string, string[]> = { [RDL.id]: ['RDL', 'Barbell RDL', 'Romanian DL'], [SL_RDL.id]: ['Single leg RDL', 'SL RDL'], [BENCH.id]: ['Flat bench', 'BB bench'], [DB_RDL.id]: ['DB RDL'] };

const ALL = [RDL, SL_RDL, BENCH, DB_BENCH, FLY, PULLUP, PUSHUP, ARNOLD, DB_RDL, PLANK];
const entry = (e: Exercise, over: Partial<BrowseEntry> = {}): BrowseEntry => ({ exercise: e, aliases: ALIASES[e.id] ?? [], hasGuide: e.id === RDL.id, painFlag: null, ...over });
const ENTRIES = ALL.map((e) => entry(e));

const bar = barbell({ id: id(700), gymId: GYM });
const rack = dumbbells({ id: id(701), gymId: GYM });
const cable = stack({ id: id(702), gymId: GYM });
const assist = assisted({ id: id(703), gymId: GYM });
/** Main gym without a cable station. */
const NO_CABLE = { id: GYM, name: 'Main Gym', equipment: [bar, rack, assist] };

describe('search (EL1): name, aliases, one typo per word of 5+ letters, ranked', () => {
  it('RDL, rdl and `romanain deadlift` all find Romanian deadlift; the alias hit names the alias', () => {
    expect(matchExercise('RDL', RDL.name, ALIASES[RDL.id])).toMatchObject({ kind: 'alias', matchedAlias: 'RDL' });
    expect(matchExercise('rdl', RDL.name, ALIASES[RDL.id])).toMatchObject({ kind: 'alias', matchedAlias: 'RDL' });
    expect(matchExercise('romanain deadlift', RDL.name, ALIASES[RDL.id])).toMatchObject({ kind: 'typo', matchedAlias: null });
    // Still typing with a typo in the first word.
    expect(matchExercise('romanain dead', RDL.name)).toMatchObject({ kind: 'typo' });
    expect(matchExercise('Romanian deadlift', RDL.name)).toMatchObject({ kind: 'exact' });
    expect(matchExercise('roman', RDL.name)).toMatchObject({ kind: 'prefix' });
  });

  it('short words need an exact prefix (no typo under 5 letters); two typos in one word are no match', () => {
    expect(matchExercise('bnch', BENCH.name)).toBeNull();
    expect(matchExercise('bench', BENCH.name)).toMatchObject({ kind: 'prefix' });
    expect(matchExercise('dedlift', RDL.name)).toMatchObject({ kind: 'typo' });
    expect(matchExercise('dedlfit', RDL.name)).toBeNull();
    expect(editDistance('romanain', 'romanian')).toBe(1);
    expect(editDistance('abc', 'abcdef')).toBe(2);
  });

  it('punctuation and case don’t matter: `pullup`, `Pull up` and `pull-up` find Assisted pull-up', () => {
    for (const q of ['pull up', 'Pull-up', 'PULL UP']) expect(matchExercise(q, PULLUP.name)).not.toBeNull();
    expect(matchExercise('pushup', PUSHUP.name)).toMatchObject({ kind: 'exact' });
  });

  it('ranks exact name, prefix, alias, word, then typo; ties A–Z; empty query lists everything A–Z', () => {
    const list = ALL.map((e) => ({ name: e.name, aliases: ALIASES[e.id] ?? [] }));
    // A word of the name ranks before a word of an alias.
    expect(searchExercises(list, 'rdl').map((e) => e.name)).toEqual(['Romanian deadlift', 'Single-leg RDL', 'Dumbbell Romanian deadlift']);
    expect(searchExercises(list, 'bench').map((e) => e.name)).toEqual(['Bench press', 'Dumbbell bench press']);
    expect(searchExercises(list, '')).toHaveLength(ALL.length);
    expect(searchExercises(list, 'landmine twst')).toEqual([]);
  });

  it('the workout picker uses the same matcher (aliases and typos), recent and common lifts unchanged without a query', () => {
    const list = ALL.map((e) => ({ exercise: e, aliases: ALIASES[e.id] ?? [] }));
    expect(pickerSections(list, 'flat bench', []).map((s) => s.items.map((p) => p.exercise.name))).toEqual([['Bench press']]);
    expect(pickerSections(list, 'romanain', [])[0]?.items.map((p) => p.exercise.name)).toEqual(['Dumbbell Romanian deadlift', 'Romanian deadlift']);
  });
});

describe('filters (§2.3, EL2)', () => {
  const f = (over: Partial<ExerciseFilters>): ExerciseFilters => ({ ...NO_FILTERS, ...over });

  it('Muscle: Hamstrings + Equipment: Dumbbells narrows to the dumbbell hinges', () => {
    const rows = searchExerciseRows(ENTRIES, '', f({ muscles: ['Hamstrings'], equipment: ['dumbbells'] }), null).rows.map((r) => r.entry.exercise.name);
    expect(rows).toEqual(['Dumbbell Romanian deadlift', 'Single-leg RDL']);
  });

  it('Movement filter, and filters combine with the query', () => {
    expect(searchExerciseRows(ENTRIES, '', f({ movements: ['vertical_pull'] }), null).rows.map((r) => r.entry.exercise.name)).toEqual(['Assisted pull-up']);
    expect(searchExerciseRows(ENTRIES, 'press', f({ equipment: ['dumbbells'] }), null).rows.map((r) => r.entry.exercise.name)).toEqual(['Arnold press', 'Dumbbell bench press']);
  });

  it('equipment kinds: per-hand dumbbells, cable stack, assisted machine and bodyweight each map to their own chip', () => {
    expect(equipmentFiltersOf(DB_BENCH)).toEqual(['dumbbells']);
    expect(equipmentFiltersOf(FLY)).toEqual(['cable_stack']);
    expect(equipmentFiltersOf(PULLUP)).toEqual(['assisted']);
    expect(equipmentFiltersOf(PUSHUP)).toEqual(['bodyweight']);
    expect(passesFilters(PULLUP, f({ equipment: ['assisted'] }))).toBe(true);
    expect(passesFilters(PULLUP, f({ equipment: ['cable_stack'] }))).toBe(false);
  });

  it('rear delts are Back (§9 Q13): Face pull is under the Back chip, not Shoulders', () => {
    const FACE_PULL = exercise(11, 'Face pull', { movementPattern: 'horizontal_pull', primaryMuscles: ['rear_delts', 'upper_back'], secondaryMuscles: ['traps', 'side_delts'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
    const REAR_FLY = exercise(12, 'Rear delt fly', { movementPattern: 'horizontal_pull', primaryMuscles: ['rear_delts'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    expect(muscleGroupsOf(FACE_PULL)).toEqual(['Back']);
    expect(muscleGroupsOf(REAR_FLY)).toEqual(['Back']);
    expect(passesFilters(FACE_PULL, f({ muscles: ['Back'] }))).toBe(true);
    expect(passesFilters(FACE_PULL, f({ muscles: ['Shoulders'] }))).toBe(false);
    expect(passesFilters(REAR_FLY, f({ muscles: ['Shoulders'] }))).toBe(false);
    const rows = (m: 'Back' | 'Shoulders') => searchExerciseRows([...ENTRIES, entry(FACE_PULL), entry(REAR_FLY)], '', f({ muscles: [m] }), null).rows.map((r) => r.entry.exercise.name);
    expect(rows('Back')).toEqual(['Assisted pull-up', 'Face pull', 'Rear delt fly']);
    expect(rows('Shoulders')).toEqual(['Arnold press']);
  });

  it('At Main Gym hides what the gym can’t do and counts it; bodyweight never needs an item; no gym = unknown', () => {
    const on = searchExerciseRows(ENTRIES, '', f({ atGym: true }), NO_CABLE.equipment);
    expect(on.rows.some((r) => r.entry.exercise.id === FLY.id)).toBe(false);
    expect(on.hiddenByGymCount).toBe(1);
    expect(gymAvailability(PUSHUP, NO_CABLE.equipment)).toBe('available');
    expect(gymAvailability(FLY, [...NO_CABLE.equipment, cable])).toBe('available');
    expect(gymAvailability(FLY, null)).toBe('unknown');
    // A retired item doesn't count.
    expect(gymAvailability(FLY, [{ ...cable, availability: 'retired' }])).toBe('not_at_gym');
  });
});

// ---------------------------------------------------------------------------

function pset(n: number, load: Load | null, reps: number | null, over: Partial<ProgressSet> = {}): ProgressSet {
  return { setId: id(n), setType: 'working', side: null, load, reps, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: n, ...over };
}
function prow(e: Exercise, sets: ProgressSet[], over: Partial<ProgressExercise> = {}): ProgressExercise {
  return { sessionExerciseId: id(5000 + sets.length), exerciseId: e.id, exerciseName: e.name, equipmentId: null, equipmentKind: null, gymId: GYM, convention: e.defaultLoadConvention, unit: 'kg', measurement: e.measurement, laterality: e.laterality, sets, ...over };
}
function psession(n: number, date: string, exercises: ProgressExercise[], over: Partial<ProgressSession> = {}): ProgressSession {
  const startedAtUtc = `${date}T09:00:00.000Z`;
  return { sessionId: id(n), version: 1, source: 'manual', name: null, gymId: GYM, startedAtUtc, startedMs: Date.parse(startedAtUtc), tz: 'Europe/London', date, dateOnly: false, endedAtUtc: null, durationMs: null, durationConfirmed: false, exercises, ...over };
}

const HOTEL = id(3);
const SESSIONS: ProgressSession[] = [
  psession(900, '2026-09-28', [prow(RDL, [pset(1, kg(110), 8), pset(2, kg(115), 8)])]),
  psession(901, '2026-10-03', [prow(RDL, [pset(3, kg(60), 5, { setType: 'warmup' }), pset(4, kg(120), 8), pset(5, kg(120), 7)])]),
  psession(902, '2026-10-04', [prow(DB_BENCH, [pset(6, kg(30, 'per_hand'), 9), pset(7, kg(32.5, 'per_hand'), 8)], { gymId: HOTEL })], { gymId: HOTEL }),
  psession(903, '2026-10-05', [prow(PULLUP, [pset(8, kg(30, 'assistance'), 8), pset(9, kg(20, 'assistance'), 6)])]),
  psession(904, '2026-10-06', [prow(PUSHUP, [pset(10, null, 12), pset(11, null, 15)])]),
  psession(905, '2026-10-07', [prow(ARNOLD, [pset(12, lb(40, 'per_hand'), 10)], { unit: 'lb' })]),
];

describe('Last on each row: an actual, in its own unit and convention (§9.3 line 3, rule 6)', () => {
  const last = lastActualByExercise(SESSIONS);

  it('the latest workout’s top working set (warm-ups never), per-hand reads `each`, lb stays lb', () => {
    expect(plain(last.get(RDL.id)?.text)).toBe('120 kg × 8');
    expect(last.get(RDL.id)?.date).toBe('2026-10-03');
    expect(plain(last.get(DB_BENCH.id)?.text)).toBe('32.5 kg each × 8');
    expect(plain(last.get(ARNOLD.id)?.text)).toBe('40 lb each × 10');
  });

  it('assisted: least assistance is the top set; bodyweight: most reps', () => {
    expect(plain(last.get(PULLUP.id)?.text)).toBe('Assist 20 kg × 6');
    expect(plain(last.get(PUSHUP.id)?.text)).toBe('BW × 15');
  });

  it('timed sets read as time', () => {
    expect(actualSetText({ load: null, reps: null, durationS: 45 }, { convention: 'bodyweight', measurement: 'duration', equipmentKind: null })).toBe('0:45');
  });
});

describe('buildExerciseBrowseView (§9.3)', () => {
  const base = { entries: ENTRIES, filters: NO_FILTERS, gym: NO_CABLE, recentIds: [ARNOLD.id, RDL.id], last: lastActualByExercise(SESSIONS), gymNames: { [GYM]: 'Main Gym', [HOTEL]: 'Hotel Gym' }, today: '2026-10-08' };

  it('no query: RECENT then ALL EXERCISES · N (every exercise, done or not); rows read `Last … · date`', () => {
    const v = buildExerciseBrowseView({ ...base, query: '' });
    expect(v.sections.map((s) => s.title)).toEqual(['RECENT', `ALL EXERCISES · ${String(ALL.length)}`]);
    expect(v.sections[0]?.rows.map((r) => r.name)).toEqual(['Arnold press', 'Romanian deadlift']);
    const rdl = v.sections[1]?.rows.find((r) => r.name === 'Romanian deadlift');
    expect(plain(rdl?.line2)).toBe('Barbell · Hamstrings');
    expect(plain(rdl?.line3)).toBe('Last 120 kg × 8 · 3 Oct');
    expect(rdl?.hasGuide).toBe(true);
    // Never done: no third line.
    expect(v.sections[1]?.rows.find((r) => r.name === 'Cable fly')?.line3).toBeNull();
    // Done at another gym: says where.
    expect(plain(v.sections[1]?.rows.find((r) => r.name === 'Dumbbell bench press')?.line3)).toBe('Last 32.5 kg each × 8 · 4 Oct at Hotel Gym');
    expect(v.gymChip).toEqual({ label: 'At Main Gym', enabled: true });
    expect(v.hiddenText).toBeNull();
  });

  it('query: MATCHES with the alias shown; no match says so', () => {
    const v = buildExerciseBrowseView({ ...base, query: 'rdl' });
    expect(v.sections.map((s) => s.key)).toEqual(['matches']);
    expect(plain(v.sections[0]?.rows[0]?.line2)).toBe('Matches “RDL” · Barbell · Hamstrings');
    expect(v.sections[0]?.rows.find((r) => r.name === 'Single-leg RDL')?.line2).toContain('per side');
    const none = buildExerciseBrowseView({ ...base, query: 'landmine twst' });
    expect(none.sections).toEqual([]);
    expect(none.empty).toBe('No match for “landmine twst”.');
  });

  it('At Main Gym: hidden count line; filters off by default; no gym = `Any gym` and nothing hidden', () => {
    const v = buildExerciseBrowseView({ ...base, query: '', filters: { ...NO_FILTERS, atGym: true } });
    expect(v.hiddenText).toBe('1 more not at Main Gym.');
    expect(v.canClear).toBe(true);
    const anyGym = buildExerciseBrowseView({ ...base, query: '', gym: null, filters: { ...NO_FILTERS, atGym: true } });
    expect(anyGym.gymChip).toEqual({ label: 'Any gym', enabled: false });
    expect(anyGym.hiddenText).toBeNull();
    expect(anyGym.canClear).toBe(false);
  });

  it('a flagged exercise is tagged May hurt and never hidden; VoiceOver reads the row in words', () => {
    const entries = ENTRIES.map((e) => (e.exercise.id === RDL.id ? { ...e, painFlag: { since: '2026-10-06', accessibilityLabel: 'May hurt: you flagged pain on it.' } } : e));
    const v = buildExerciseBrowseView({ ...base, entries, query: 'romanian' });
    const row = v.sections[0]?.rows.find((r) => r.name === 'Romanian deadlift');
    expect(row?.tags).toEqual([{ kind: 'may_hurt', text: 'May hurt', accessibilityLabel: 'May hurt: you flagged pain on it.' }]);
    expect(row?.accessibilityLabel).toBe('Romanian deadlift, barbell · hamstrings, last 120 kg times 8 · 3 oct, has a guide, May hurt: you flagged pain on it.');
  });
});

describe('buildExerciseInfoView (§9.4, EL13): Coaching knowledge and Your data kept apart', () => {
  const knowledge = { poster: { catalogueKey: 'barbell-romanian-deadlift', draftLabel: 'Draft guide', accessibilityLabel: 'Exercise guide' }, legend: [{ label: 'Feel it most:', list: 'Hamstrings · Glutes' }], execution: ['a', 'b', 'c', 'd'], avoid: ['w', 'x', 'y', 'z'], hasFullHowTo: true };

  it('header, poster, at most 3 cues and 3 don’ts; Your data matches Progress’s own numbers for the series', () => {
    const v = buildExerciseInfoView({
      exercise: RDL,
      aliases: ['RDL'],
      knowledge,
      sessions: SESSIONS,
      unit: 'kg',
      progress: { seriesId: `${RDL.id}|load`, seriesLabel: '', stats: [{ value: '≈146 kg', label: 'EST. 1RM' }, { value: '120 × 8', label: 'BEST SET' }, { value: '2', label: 'SESSIONS' }] },
      painFlag: null,
      usedIn: [{ routineId: id(300), name: 'Legs A' }],
      gymName: 'Main Gym',
      today: '2026-10-08',
    });
    expect(v.subtitle).toBe('Hinge · Barbell');
    expect(v.aliasesLine).toBe('Also called RDL');
    expect(v.knowledge.cues).toEqual(['a', 'b', 'c']);
    expect(v.knowledge.avoid).toEqual(['w', 'x', 'y']);
    expect(v.knowledge.alternativesLabel).toBe('Alternatives at Main Gym');
    expect(v.yours.history?.caption).toBe('');
    expect(v.yours.history?.rows.map((r) => [r.label, plain(r.value), r.estimate])).toEqual([
      ['Last', '120 kg × 8 · 3 Oct', false],
      ['Est. 1RM', '≈146 kg', true],
      ['Best set', '120 × 8', false],
    ]);
    expect(v.yours.history?.workouts).toBe(`2 workouts since 28${NB}Sep`);
    expect(v.yours.usedIn).toEqual([{ routineId: id(300), name: 'Legs A' }]);
  });

  it('Last is in Ben’s unit, as the stats are, when the latest session was logged in the other unit (review S2)', () => {
    const sessions = [...SESSIONS, psession(906, '2026-10-07', [prow(RDL, [pset(13, lb(225), 5)], { unit: 'lb' })])];
    const input = { exercise: RDL, aliases: [], knowledge, sessions, progress: { seriesId: `${RDL.id}|load`, seriesLabel: '', stats: [] }, painFlag: null, usedIn: [], gymName: null, today: '2026-10-08' };
    expect(plain(buildExerciseInfoView({ ...input, unit: 'kg' }).yours.history?.rows[0]?.value)).toBe('102.06 kg × 5 · 7 Oct');
    expect(plain(buildExerciseInfoView({ ...input, unit: 'lb' }).yours.history?.rows[0]?.value)).toBe('225 lb × 5 · 7 Oct');
  });

  it('no history: `No history yet.` and no records; no legend falls back to the exercise’s muscles; a pain flag shows its date', () => {
    const v = buildExerciseInfoView({ exercise: FLY, aliases: [], knowledge: { poster: null, legend: [], execution: [], avoid: [], hasFullHowTo: false }, sessions: SESSIONS, progress: null, unit: null, painFlag: { flagId: id(77), since: '2026-10-06' }, usedIn: [], gymName: null, today: '2026-10-08' });
    expect(v.yours.history).toBeNull();
    expect(v.yours.empty).toBe('No history yet.');
    expect(v.knowledge.muscles).toEqual([{ label: 'Muscles:', list: 'Chest' }]);
    expect(plain(v.yours.pain?.text)).toBe('May hurt · flagged 6 Oct');
    expect(v.knowledge.alternativesLabel).toBe('Alternatives');
  });
});

describe('buildAddDestinations (§9.5)', () => {
  it('the workout in progress first, rotation then most recent then A–Z, `Already in it` disabled, the running one applies next time', () => {
    const d = buildAddDestinations({
      exerciseId: FLY.id,
      session: { id: id(800), name: 'Push A', version: 7, exerciseIds: [BENCH.id], routineId: id(301) },
      routines: [
        { id: id(303), name: 'Arms', version: 1, exerciseIds: [FLY.id], rotationIndex: null, lastDoneMs: null },
        { id: id(302), name: 'Pull B', version: 4, exerciseIds: [], rotationIndex: 1, lastDoneMs: 5 },
        { id: id(301), name: 'Push A', version: 2, exerciseIds: [BENCH.id], rotationIndex: 0, lastDoneMs: 9 },
        { id: id(304), name: 'Legs', version: 1, exerciseIds: [], rotationIndex: null, lastDoneMs: 100 },
      ],
    });
    expect(d.now).toMatchObject({ kind: 'session', label: 'Push A · in progress', disabled: false, version: 7, primary: 'Add to Push A' });
    expect(d.workouts.map((w) => [w.label, w.detail, w.disabledText])).toEqual([
      ['Push A', 'In progress · applies next time', null],
      ['Pull B', null, null],
      ['Legs', null, null],
      ['Arms', null, 'Already in it'],
    ]);
    expect(d.workouts[1]).toMatchObject({ version: 4, primary: 'Add to Pull B' });
    expect(d.newWorkout.primary).toBe('Add to new workout');
  });

  it('a distance exercise (review S1): saved and new workouts disabled with the reason; NOW stays open', () => {
    const d = buildAddDestinations({
      exerciseId: FLY.id,
      measurement: 'distance',
      session: { id: id(800), name: 'Push A', version: 1, exerciseIds: [], routineId: null },
      routines: [
        { id: id(301), name: 'Legs A', version: 2, exerciseIds: [], rotationIndex: 0, lastDoneMs: 1 },
        { id: id(302), name: 'Arms', version: 1, exerciseIds: [FLY.id], rotationIndex: null, lastDoneMs: null },
      ],
    });
    expect(d.now).toMatchObject({ disabled: false });
    expect(d.workouts.map((w) => [w.label, w.disabled, w.disabledText])).toEqual([
      ['Legs A', true, NO_DISTANCE_IN_WORKOUTS],
      ['Arms', true, 'Already in it'],
    ]);
    expect(d.newWorkout).toMatchObject({ disabled: true, disabledText: NO_DISTANCE_IN_WORKOUTS });
    expect(buildAddDestinations({ exerciseId: FLY.id, measurement: 'duration', session: null, routines: [] }).newWorkout.disabled).toBe(false);
  });

  it('no workout running: no NOW row; an exercise already in the running workout is disabled there', () => {
    expect(buildAddDestinations({ exerciseId: FLY.id, session: null, routines: [] }).now).toBeNull();
    expect(buildAddDestinations({ exerciseId: BENCH.id, session: { id: id(800), name: 'Push A', version: 1, exerciseIds: [BENCH.id], routineId: null }, routines: [] }).now).toMatchObject({ disabled: true, disabledText: 'Already in it' });
  });
});

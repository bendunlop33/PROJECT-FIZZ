import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PlannedSetSchema, TargetEarlierWorkSchema, type Exercise, type ProgressionRule, type SessionAggregate } from '@fizz/schemas';

import {
  buildAddExerciseCommand,
  builtInDefaultRule,
  earlierWorkFact,
  earlierWorkOf,
  earlierSetsByMuscle,
  earlierSetsP,
  earlierWorkWhy,
  explainTarget,
  NBSP,
  nextTargetsFor,
  otherContextSessions,
  pendingEarlierWork,
  plannedSetsFromTargets,
  replanEntries,
  resolveContext,
  sharedEarlierWork,
  startWorkout,
  type ContextWorkout,
  type FatigueMuscles,
  type HistorySession,
  type NextTargetRequest,
  type WorkContext,
} from '../src/index';
import { at, barbell, exercise, GYM, id, idGen, kg, ms, OWNER, profile, T0_MS, TZ } from './fixtures';
import { apply } from './session-fixture';

/**
 * SF7(b) (Ben, 15 Nov, build 568): each built-in target records how in-session fatigue read it (earlier same-muscle
 * work today, the reference, whether SF3 changed it); `Why?` shows it in one line and the coach is told it.
 * Fixture: Ben's Push B, dumbbell shoulder press before bench, with the catalogue's real muscles.
 */

const plain = (s: string | null) => (s === null ? null : s.replaceAll(NBSP, ' '));
const DAY = 86_400_000;
const BENCH = id(9201);
const DBSP = id(9202);
const PUSHDOWN = id(9203);
const LATERAL = id(9204);

/** The catalogue entries as shipped (packages/catalogue/data/exercises). */
function catalogue(file: string): FatigueMuscles {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../../catalogue/data/exercises/${file}.json`, import.meta.url)), 'utf8')) as { name: string; primaryMuscles: string[]; secondaryMuscles?: string[] };
  return { name: j.name, primaryMuscles: j.primaryMuscles, secondaryMuscles: j.secondaryMuscles ?? [] };
}
const MUSCLES = new Map<string, FatigueMuscles>([
  [BENCH, catalogue('barbell-bench-press')],
  [DBSP, catalogue('dumbbell-seated-shoulder-press')],
  [PUSHDOWN, { name: 'Triceps pushdown', primaryMuscles: ['triceps'] }],
  [LATERAL, { name: 'Lateral raise', primaryMuscles: ['side_delts'] }],
]);
const musclesOf = (x: string) => MUSCLES.get(x) ?? null;

const BAR = barbell();
const BENCH_EX: Exercise = exercise(9201, 'Bench press', { primaryMuscles: ['chest'], secondaryMuscles: ['front_delts', 'triceps'], mechanic: 'compound' });
const DEFAULT = builtInDefaultRule(OWNER, 'kg', 3, 'compound');
const RULE: ProgressionRule = DEFAULT.method === 'double_progression' ? { ...DEFAULT, repRange: { min: 5, max: 8 } } : DEFAULT;

const ctx = (earlier: WorkContext['earlier']): WorkContext => ({ earlier, supersetWith: [] });
const FIRST = ctx([]);
const AFTER_DBSP = ctx([{ exerciseId: DBSP, sets: 3 }]);

function exposure(n: number, daysAgo: number, load: number, reps: number[], context: WorkContext): HistorySession {
  return {
    sessionId: id(n),
    performedAtUtc: new Date(T0_MS - daysAgo * DAY).toISOString(),
    equipmentId: BAR.id,
    gymId: GYM,
    imported: false,
    routineName: 'Push B',
    sets: reps.map((r) => ({ setType: 'working', side: null, load: kg(load), reps: r, rpe: 8, rir: null })),
    tz: TZ,
    context,
  };
}

function request(history: HistorySession[], today: WorkContext | null): NextTargetRequest {
  return {
    ownerId: OWNER,
    exerciseId: BENCH,
    exerciseName: BENCH_EX.name,
    measurement: 'reps',
    unit: 'kg',
    convention: 'total',
    equipment: BAR,
    exercise: BENCH_EX,
    rule: RULE,
    workingSets: 3,
    history,
    painFlags: [],
    sessionPain: { active: false, reportedAtUtc: null },
    fatigue: { today, musclesOf },
  };
}

const AT = { utc: new Date(T0_MS).toISOString(), tz: TZ };
const provenanceOf = (history: HistorySession[], today: WorkContext | null) => {
  const r = nextTargetsFor(request(history, today));
  const planned = plannedSetsFromTargets(r.result, { history, equipment: BAR, at: AT });
  const first = planned?.find((p) => p.setType !== 'warmup');
  // What's stored must pass the schema (the write that sets the target never fails on its explanation).
  if (first !== undefined) PlannedSetSchema.parse(first.planned);
  return { r, planned, ew: first?.planned.provenance?.earlierWork };
};

describe('SF1 on Ben’s Push B: dumbbell shoulder press before bench (catalogue muscles)', () => {
  it('bench is primary chest only; the shoulder press works chest as a secondary (upper chest), so P = 3 × ½ = 1.5', () => {
    expect(MUSCLES.get(BENCH)?.primaryMuscles).toEqual(['chest']);
    expect(MUSCLES.get(DBSP)?.primaryMuscles).toEqual(['front_delts']);
    expect(MUSCLES.get(DBSP)?.secondaryMuscles).toContain('upper_chest');
    expect(resolveContext(AFTER_DBSP, BENCH, musclesOf)).toEqual({ p: 1.5, sameMuscleSuperset: false, muscle: 'Chest', muscleRole: 'primary' });
  });

  it('records every shared muscle, how the shoulder press worked it (shoulders direct; chest and triceps secondary)', () => {
    expect(sharedEarlierWork(AFTER_DBSP, BENCH, musclesOf)).toEqual([{ name: 'Dumbbell shoulder press', sets: 3, direct: ['Shoulders'], secondary: ['Chest', 'Triceps'] }]);
  });

  it('reads the logged order of the workout (warm-ups left out) the same way', () => {
    const w: ContextWorkout = {
      session: { source: 'app' },
      exercises: [
        { id: 'r1', exerciseId: DBSP, order: 0, supersetGroup: null, removed: undefined, measurement: 'reps' },
        { id: 'r2', exerciseId: BENCH, order: 1, supersetGroup: null, removed: undefined, measurement: 'reps' },
      ],
      sets: [
        ...['warmup', 'working', 'working', 'working'].map((t, i) => ({ sessionExerciseId: 'r1', setType: t as 'warmup' | 'working', status: 'completed' as const, side: null, completedAt: at(60 * (i + 1)), actual: { load: kg(20, 'per_hand'), reps: 10, durationS: null, rpe: 8, rir: null } })),
        { sessionExerciseId: 'r2', setType: 'working' as const, status: 'pending' as const, side: null, completedAt: null, actual: null },
      ],
    };
    expect(earlierWorkOf(w, BENCH, { planned: true })).toEqual(AFTER_DBSP);
  });

  it('a same-muscle reference within 2 sets is like for like: last Push B (also after the press) is the basis, no SF3', () => {
    const history = [exposure(1, 3, 100, [6, 6, 6], FIRST), exposure(2, 7, 100, [6, 6, 5], AFTER_DBSP)];
    const { r, ew } = provenanceOf(history, AFTER_DBSP);
    expect(r.result.earlierWork?.basis).toBe('comparable');
    expect(ew).toMatchObject({ p: 1.5, muscle: 'Chest', basis: 'comparable', reference: { p: 0 } });
    // Within the window, the newest comparable wins: the bench-first session 3 days ago (|1.5 − 0| ≤ 2).
    expect(ew?.reference?.sessionId).toBe(id(1));
    expect(ew?.cushion).toBeUndefined();
  });
});

describe('provenance carries SF facts', () => {
  it('comparable found', () => {
    const { ew } = provenanceOf([exposure(2, 7, 100, [6, 6, 6], AFTER_DBSP)], AFTER_DBSP);
    expect(ew).toEqual({
      p: 1.5,
      muscle: 'Chest',
      muscleRole: 'primary',
      before: [{ name: 'Dumbbell shoulder press', sets: 3, direct: ['Shoulders'], secondary: ['Chest', 'Triceps'] }],
      reference: { sessionId: id(2), performedAt: { utc: new Date(T0_MS - 7 * DAY).toISOString(), tz: TZ }, p: 1.5, sameMuscleSuperset: false },
      basis: 'comparable',
    });
    expect(plain(earlierWorkWhy(ew))).toBe('After dumbbell shoulder press ×3 · compared with 1 Oct (after 1.5 chest sets)');
    expect(earlierWorkFact(ew ?? (null as never))).toBe(
      `before: dumbbell shoulder press 3 (shoulders direct; chest, triceps secondary) · P 1.5 chest · ref ${new Date(T0_MS - 7 * DAY).toISOString().slice(0, 10)} P 1.5, like for like · no cushion`,
    );
  });

  it('SF3 applied: a much heavier chest day before it than any history (6 shoulder-press sets → P 3 vs 0)', () => {
    const { r, ew } = provenanceOf([exposure(1, 7, 100, [6, 6, 6], FIRST)], ctx([{ exerciseId: DBSP, sets: 6 }]));
    expect(r.result.sets.filter((s) => s.setType !== 'warmup').map((s) => [s.load?.value, s.reps.min])).toEqual([0, 1, 2].map(() => [100, 5]));
    expect(ew).toMatchObject({ p: 3, basis: 'cushion', cushion: { reps: 1, stepDown: false }, reference: { p: 0 } });
    expect(plain(earlierWorkWhy(ew))).toBe('After dumbbell shoulder press ×6 · no session like it: 1 rep fewer · est.');
    expect(earlierWorkFact(ew ?? (null as never))).toMatch(/· P 3 chest · ref \S+ P 0, not like for like · cushion applied \(no load increase today\): −1 rep, est\.$/);
  });

  it('no earlier work: recorded for the coach, no Why? line', () => {
    const { ew } = provenanceOf([exposure(1, 7, 100, [6, 6, 6], FIRST)], FIRST);
    expect(ew).toMatchObject({ p: 0, muscle: null, before: [], basis: 'comparable' });
    expect(earlierWorkWhy(ew)).toBeNull();
    expect(earlierWorkFact(ew ?? (null as never))).toMatch(/^nothing before it shares its muscles · P 0 · ref \S+ P 0, like for like · no cushion$/);
  });

  it('earlier work on bench’s secondary muscles only (pushdowns, laterals) counts ½ (SF1 amended 21 Nov): triceps 3 × ½ = 1.5 sets P', () => {
    const today = ctx([{ exerciseId: PUSHDOWN, sets: 3 }, { exerciseId: LATERAL, sets: 2 }]);
    const { ew } = provenanceOf([exposure(1, 7, 100, [6, 6, 6], FIRST)], today);
    // Triceps 3 × 1 × ½ = 1.5; front/side delts (Shoulders) 2 × 1 × ½ = 1; chest 0.
    expect(ew).toMatchObject({ p: 1.5, muscle: 'Triceps', muscleRole: 'secondary', basis: 'comparable', before: [{ name: 'Triceps pushdown', sets: 3, direct: ['Triceps'] }, { name: 'Lateral raise', sets: 2, direct: ['Shoulders'] }] });
    expect(plain(earlierWorkWhy(ew))).toBe('After triceps pushdown ×3, lateral raise ×2 · triceps · compared with 1 Oct (done first)');
    expect(earlierWorkFact(ew ?? (null as never))).toMatch(/· P 1\.5 triceps \(secondary\) · ref \S+ P 0, like for like · no cushion$/);
  });

  it('a lot of secondary-only work with no history like it: SF3 from the halved count (5 pushdowns → P 2.5 vs 0, 1 rep fewer)', () => {
    const { r, ew } = provenanceOf([exposure(1, 7, 100, [6, 6, 6], FIRST)], ctx([{ exerciseId: PUSHDOWN, sets: 5 }]));
    expect(ew).toMatchObject({ p: 2.5, muscle: 'Triceps', muscleRole: 'secondary', basis: 'cushion', cushion: { reps: 1, stepDown: false } });
    expect(r.result.sets.filter((s) => s.setType !== 'warmup').map((s) => [s.load?.value, s.reps.min])).toEqual([0, 1, 2].map(() => [100, 5]));
    expect(plain(earlierWorkWhy(ew))).toBe('After triceps pushdown ×5 · triceps · no session like it: 1 rep fewer · est.');
  });

  it('today fresher than the only reference: no session like it, compared with it', () => {
    const { ew } = provenanceOf([exposure(1, 7, 100, [6, 6, 6], ctx([{ exerciseId: DBSP, sets: 8 }]))], FIRST);
    expect(ew).toMatchObject({ p: 0, basis: 'other', reference: { p: 4 } });
    expect(plain(earlierWorkWhy(ew))).toBe('Done first · no session like it · compared with 1 Oct (after 4 sets)');
  });

  it('no fatigue input: no SF note at all', () => {
    const plainRequest: Partial<NextTargetRequest> = request([exposure(1, 7, 100, [6, 6, 6], FIRST)], null);
    delete plainRequest.fatigue;
    const r = nextTargetsFor(plainRequest as NextTargetRequest);
    const planned = plannedSetsFromTargets(r.result, { history: [], equipment: BAR, at: AT });
    expect(planned?.some((p) => p.planned.provenance?.earlierWork !== undefined)).toBe(false);
  });
});

describe('Why? (only in the panel)', () => {
  const owner = profile();
  function workoutWith(history: HistorySession[], today: WorkContext): SessionAggregate {
    const ids = idGen(70_000);
    const r = nextTargetsFor(request(history, today));
    const plan = plannedSetsFromTargets(r.result, { history, equipment: BAR, at: at(1) });
    let s = startWorkout({ opId: 'sf-start', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [BAR], at: at(0), newId: ids }).aggregate;
    s = apply(s, buildAddExerciseCommand({ opId: 'sf-add', owner, exercise: BENCH_EX, equipmentId: BAR.id, at: at(1), newId: ids, plan }));
    return s;
  }
  const why = (s: SessionAggregate) => {
    const set = s.sets.find((x) => x.setType !== 'warmup');
    return explainTarget({ aggregate: s, setId: set?.id ?? '', nowMs: ms(10), basisNow: null, gymNames: {}, painFlags: [], history: [] });
  };

  it('`Earlier today` row after the rule’s reason when SF read a like-for-like reference', () => {
    const s = workoutWith([exposure(2, 7, 100, [6, 6, 6], AFTER_DBSP)], AFTER_DBSP);
    const rows = why(s)?.rows ?? [];
    const keys = rows.map((r) => r.key);
    expect(keys.indexOf('earlier_today')).toBeGreaterThan(keys.indexOf('reason'));
    expect(rows.find((r) => r.key === 'earlier_today')?.lines.map(plain)).toEqual(['After dumbbell shoulder press ×3 · compared with 1 Oct (after 1.5 chest sets)']);
  });

  it('SF3: the one line is the reason (the rule’s own SF3 sentence isn’t repeated)', () => {
    const s = workoutWith([exposure(1, 7, 100, [6, 6, 6], FIRST)], ctx([{ exerciseId: DBSP, sets: 6 }]));
    const rows = why(s)?.rows ?? [];
    expect(rows.some((r) => r.key === 'reason')).toBe(false);
    expect(rows.filter((r) => r.key === 'earlier_today').map((r) => r.lines.map(plain))).toEqual([['After dumbbell shoulder press ×6 · no session like it: 1 rep fewer · est.']]);
  });

  it('nothing before it: no extra row', () => {
    const s = workoutWith([exposure(1, 7, 100, [6, 6, 6], FIRST)], FIRST);
    expect(why(s)?.rows.some((r) => r.key === 'earlier_today')).toBe(false);
  });

  it('pendingEarlierWork reads the next pending working set’s note (the coach’s source)', () => {
    const s = workoutWith([exposure(2, 7, 100, [6, 6, 6], AFTER_DBSP)], AFTER_DBSP);
    expect(pendingEarlierWork(s.sets)?.p).toBe(1.5);
  });
});

describe('SF6 replan keeps the note current', () => {
  it('same numbers but a different SF note still updates the set (Why? never goes stale after a reorder)', () => {
    const history = [exposure(1, 7, 100, [6, 6, 6], FIRST)];
    const before = provenanceOf(history, AFTER_DBSP).planned ?? [];
    const after = provenanceOf(history, FIRST).planned ?? [];
    const sets = before.map((p, i) => ({ id: `s${String(i)}`, version: 1, setType: p.setType, status: 'pending', planned: p.planned }));
    const entries = replanEntries({ row: {} as never, sets: sets as never, today: FIRST, workingSets: 3 }, after);
    expect(entries.length).toBe(sets.filter((s) => s.setType !== 'warmup').length);
    expect(entries.every((e) => e.planned.provenance?.earlierWork?.p === 0)).toBe(true);
  });
});

describe('SF1 amended (Ben, 21 Nov): the target’s secondary muscles count at ½', () => {
  it('3 × dumbbell shoulder press before bench: chest 1.5, front delts 1.5, triceps 0.75 → P 1.5 (a tie names the primary)', () => {
    const by = earlierSetsByMuscle(AFTER_DBSP.earlier, musclesOf);
    // Chest: the press's secondary (upper chest), bench's primary: 3 × ½.
    expect(by.get('Chest')).toEqual({ direct: 0, secondary: 3 });
    // Front delts: the press's primary, bench's secondary: 3 × 1, halved for bench below.
    expect(by.get('Shoulders')).toEqual({ direct: 3, secondary: 0 });
    // Triceps: secondary on both: 3 × ½, halved for bench below.
    expect(by.get('Triceps')).toEqual({ direct: 0, secondary: 3 });
    expect(earlierSetsP(musclesOf(BENCH), by)).toEqual({ p: 1.5, muscle: 'Chest', muscleRole: 'primary' });
  });

  it('Soares 2016: 1 set of triceps pushdowns before bench → P 0.5 (was 0), set by triceps as a secondary mover', () => {
    expect(resolveContext(ctx([{ exerciseId: PUSHDOWN, sets: 1 }]), BENCH, musclesOf)).toEqual({ p: 0.5, sameMuscleSuperset: false, muscle: 'Triceps', muscleRole: 'secondary' });
  });

  it('secondary work outweighing the primary names the secondary: 4 pushdowns + 1 shoulder press → triceps 4 × ½ + ½ × ½ = 2.25 vs chest 0.5', () => {
    const r = resolveContext(ctx([{ exerciseId: PUSHDOWN, sets: 4 }, { exerciseId: DBSP, sets: 1 }]), BENCH, musclesOf);
    expect(r).toMatchObject({ p: 2.25, muscle: 'Triceps', muscleRole: 'secondary' });
  });

  it('a group that is both primary and secondary for the target counts once, as primary', () => {
    const info: FatigueMuscles = { primaryMuscles: ['chest'], secondaryMuscles: ['upper_chest', 'triceps'] };
    const by = earlierSetsByMuscle([{ exerciseId: BENCH, sets: 2 }], musclesOf);
    expect(earlierSetsP(info, by)).toEqual({ p: 2, muscle: 'Chest', muscleRole: 'primary' });
  });

  it('exercises with no secondary muscles count only their primaries; cardio and no primaries stay unknown', () => {
    expect(earlierSetsP({ primaryMuscles: ['triceps'] }, earlierSetsByMuscle(AFTER_DBSP.earlier, musclesOf))).toEqual({ p: 1.5, muscle: 'Triceps', muscleRole: 'primary' });
    expect(earlierSetsP({ primaryMuscles: ['side_delts'] }, new Map())).toEqual({ p: 0, muscle: null, muscleRole: null });
    expect(earlierSetsP({ primaryMuscles: [], secondaryMuscles: ['triceps'] }, new Map())).toBeNull();
    expect(earlierSetsP({ primaryMuscles: ['quads'], measurement: 'cardio' }, new Map())).toBeNull();
  });

  it('SF2 / SF5: a pushdowns-first bench session is now its own context against a fresh one (P 2.5 vs 0 > 2)', () => {
    const points = [
      { sessionId: 'fresh', context: FIRST },
      { sessionId: 'after-pushdowns', context: ctx([{ exerciseId: PUSHDOWN, sets: 5 }]) },
    ];
    expect([...otherContextSessions(points, BENCH, musclesOf)]).toEqual(['fresh']);
  });

  it('stored provenance from before 21 Nov (no muscleRole) still passes the schema and reads as before', () => {
    const old = { p: 1.5, muscle: 'Chest', before: [], reference: null, basis: 'comparable' as const };
    expect(TargetEarlierWorkSchema.parse(old)).toEqual(old);
    expect(earlierWorkFact(old)).toBe('nothing before it shares its muscles · P 1.5 chest · no ref · no cushion');
  });
});

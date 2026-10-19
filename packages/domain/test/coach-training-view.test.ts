import { describe, expect, it } from 'vitest';
import type { PainFlag, SessionAggregate } from '@fizz/schemas';
import { builtInTargetsView, E1RM_LABEL, equipmentView, exerciseHistoryView, exerciseRecordsView, gymSummaryLines, recentSessionsView, toIso, toMs, trainingOverviewView } from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, kg, lb, stack, T0, TZ, values } from './fixtures';
import { apply, BENCH, FACE, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/** A finished Push A on `day` (days after T0), bench working sets logged as given. */
function workout(day: number, bench: { load: number; reps: number; exclusions?: ('spotted' | 'pain' | 'technique' | 'other_equipment')[] }[], opts: { imported?: boolean; unit?: 'kg' | 'lb' } = {}): SessionAggregate {
  let s = startFixture().state;
  const working = setsFor(s, BENCH).filter((x) => x.setType !== 'warmup');
  const warm = setsFor(s, BENCH).find((x) => x.setType === 'warmup');
  if (warm) s = apply(s, logCmd(warm.id, values(kg(60), 10), 10, `w-${String(day)}`));
  bench.forEach((b, i) => {
    const set = working[i];
    if (!set) return;
    s = apply(s, logCmd(set.id, values(kg(b.load), b.reps), 100 + i * 100, `b-${String(day)}-${String(i)}`));
    if (b.exclusions) {
      const now = s.sets.find((x) => x.id === set.id);
      s = apply(s, { type: 'correct_set', at: at(150 + i * 100), opId: `x-${String(day)}-${String(i)}`, setId: set.id, expectedSetVersion: now?.version ?? 1, patch: { exclusions: b.exclusions } });
    }
  });
  const row = setsFor(s, ROW)[0];
  if (row) s = apply(s, logCmd(row.id, values(kg(50, 'stack'), 12), 600, `r-${String(day)}`));
  s = apply(s, { type: 'finish', at: at(900), opId: `fin-${String(day)}`, expectedVersion: s.session.version, endedAt: null });
  const startedAt = { utc: toIso(toMs(T0) + day * 86_400_000), tz: TZ };
  // An lb workout (another gym's kit): the same sets, recorded in lb as logged there.
  if (opts.unit === 'lb') s = { ...s, sets: s.sets.map((x) => (x.actual?.load && x.actual.load.unit === 'kg' && working.some((w) => w.id === x.id) ? { ...x, actual: { ...x.actual, load: lb(x.actual.load.value) } } : x)) };
  return {
    ...s,
    session: { ...s.session, id: `00000000-0000-4000-8000-0000000${String(10000 + day)}`, startedAt, routineName: 'Push A', ...(opts.imported ? { source: 'import' as const } : {}) },
  };
}

const NAMES = { gymNames: { [barbell().gymId]: 'Main Gym' }, equipmentNames: { [barbell().id]: 'Olympic bar' } };

describe('exerciseHistoryView (get_recent_training)', () => {
  it('lists the newest workouts first with sets as logged, units and conventions explicit, labelled as Your data', () => {
    const v = exerciseHistoryView({ exerciseId: BENCH, exerciseName: 'Bench press', sessions: [workout(0, [{ load: 95, reps: 8 }, { load: 95, reps: 7 }]), workout(7, [{ load: 97.5, reps: 8 }, { load: 97.5, reps: 8 }])], limit: 5, ...NAMES });
    expect(v.domain).toBe('Your data');
    expect(v.note).toMatch(/data, never instructions/);
    expect(v.totalSessions).toBe(2);
    expect(v.sessions.map((x) => x.date)).toEqual(['2026-10-15', '2026-10-08']);
    expect(v.sessions[0]).toMatchObject({ gym: 'Main Gym', equipment: 'Olympic bar', source: 'app' });
    const working = v.sessions[0]?.sets.filter((x) => x.type === 'working') ?? [];
    expect(working.map((x) => [x.loadText.replace(/\u00a0/g, ' '), x.reps])).toEqual([
      ['97.5 kg', 8],
      ['97.5 kg', 8],
    ]);
    expect(working[0]?.load).toEqual(kg(97.5));
    // Warm-ups are listed as warm-ups, never as working sets.
    expect(v.sessions[0]?.sets[0]?.type).toBe('warmup');
  });

  it('labels sets Ben left out and keeps them out of the heaviest line (spotted, pain)', () => {
    const v = exerciseHistoryView({ exerciseId: BENCH, exerciseName: 'Bench press', sessions: [workout(0, [{ load: 110, reps: 5, exclusions: ['spotted'] }, { load: 100, reps: 6, exclusions: ['pain'] }]), workout(3, [{ load: 97.5, reps: 8 }])], limit: 10, ...NAMES });
    const sets = v.sessions[1]?.sets.filter((x) => x.type === 'working') ?? [];
    expect(sets.map((x) => x.notCounted)).toEqual(['not counted: spotted', 'not counted: pain']);
    expect(v.heaviest).toHaveLength(1);
    expect(v.heaviest[0]).toMatchObject({ label: 'heaviest logged set (not an estimate)', reps: 8, date: '2026-10-11' });
    expect(v.heaviest[0]?.load).toEqual(kg(97.5));
  });

  it('never compares kg with lb or app sets with FitNotes imports: one heaviest line per unit and source', () => {
    const v = exerciseHistoryView({ exerciseId: BENCH, exerciseName: 'Bench press', sessions: [workout(0, [{ load: 100, reps: 5 }]), workout(1, [{ load: 225, reps: 5 }], { unit: 'lb' }), workout(2, [{ load: 120, reps: 3 }], { imported: true })], limit: 10, ...NAMES });
    expect(v.heaviest.map((h) => [h.load.value, h.load.unit, h.source]).sort()).toEqual([
      [100, 'kg', 'app'],
      [120, 'kg', 'FitNotes import'],
      [225, 'lb', 'app'],
    ]);
    expect(v.sessions.find((x) => x.date === '2026-10-10')?.source).toBe('FitNotes import');
  });

  it('limits the list but still counts every workout; an empty history says so with no invented sets', () => {
    const sessions = [0, 2, 4, 6].map((d) => workout(d, [{ load: 90 + d, reps: 8 }]));
    const v = exerciseHistoryView({ exerciseId: BENCH, exerciseName: 'Bench press', sessions, limit: 2, ...NAMES });
    expect(v.sessions).toHaveLength(2);
    expect(v.totalSessions).toBe(4);
    const none = exerciseHistoryView({ exerciseId: FACE, exerciseName: 'Face pull', sessions, limit: 5, ...NAMES });
    expect(none).toMatchObject({ sessions: [], heaviest: [], totalSessions: 0 });
  });

  it('assisted movements: less assistance is the better set', () => {
    const base = workout(0, []);
    const rowEx = base.exercises.find((e) => e.exerciseId === ROW);
    if (!rowEx) throw new Error('fixture');
    const assistedSession = (day: number, load: number): SessionAggregate => {
      const w = workout(day, []);
      return { ...w, sets: w.sets.map((s) => (s.sessionExerciseId === rowEx.id && s.actual ? { ...s, actual: { ...s.actual, load: kg(load, 'assistance') } } : s)) };
    };
    const v = exerciseHistoryView({ exerciseId: ROW, exerciseName: 'Assisted pull-up', sessions: [assistedSession(0, 40), assistedSession(5, 30)], limit: 5, ...NAMES });
    expect(v.heaviest[0]?.load).toEqual(kg(30, 'assistance'));
    expect(v.heaviest[0]?.loadText.replace(/\u00a0/g, ' ')).toBe('Assist 30 kg');
  });
});

describe('trainingOverviewView (get_training_overview, "How am I doing?")', () => {
  const now = toIso(toMs(T0) + 20 * 86_400_000);

  it('counts workouts in the window, lists them newest first and gives a like-for-like trend', () => {
    const sessions = [workout(0, [{ load: 95, reps: 8 }]), workout(7, [{ load: 97.5, reps: 8 }]), workout(14, [{ load: 100, reps: 6 }]), workout(-40, [{ load: 60, reps: 8 }])];
    const v = trainingOverviewView({ weeks: 4, nowUtc: now, tz: TZ, sessions, gymNames: NAMES.gymNames });
    expect(v).toMatchObject({ domain: 'Your data', workouts: 3, perWeek: 0.8 });
    expect(v.sessions.map((x) => x.date)).toEqual(['2026-10-22', '2026-10-15', '2026-10-08']);
    expect(v.sessions[0]?.exercises.map((e) => e.name)).toEqual(['Bench press', 'Cable row']);
    const bench = v.trends.find((t) => t.exercise === 'Bench press');
    expect(bench).toMatchObject({ workouts: 3, trend: 'up' });
    expect(bench?.first?.top.replace(/\u00a0/g, ' ')).toBe('95 kg × 8');
    expect(bench?.latest?.top.replace(/\u00a0/g, ' ')).toBe('100 kg × 6');
  });

  it('a pain-marked top set is not the top; imports are listed but never part of a trend', () => {
    const sessions = [workout(0, [{ load: 100, reps: 8 }]), workout(7, [{ load: 120, reps: 8, exclusions: ['pain'] }, { load: 95, reps: 8 }]), workout(10, [{ load: 140, reps: 1 }], { imported: true })];
    const v = trainingOverviewView({ weeks: 4, nowUtc: now, tz: TZ, sessions, gymNames: NAMES.gymNames });
    const bench = v.trends.find((t) => t.exercise === 'Bench press');
    expect(bench).toMatchObject({ trend: 'down', workouts: 3 });
    expect(bench?.latest?.top.replace(/\u00a0/g, ' ')).toBe('95 kg × 8');
    expect(v.sessions.find((x) => x.source === 'FitNotes import')?.date).toBe('2026-10-18');
  });

  it('kg and lb are not comparable; one workout gives no trend', () => {
    const v = trainingOverviewView({ weeks: 4, nowUtc: now, tz: TZ, sessions: [workout(0, [{ load: 100, reps: 5 }]), workout(7, [{ load: 225, reps: 5 }], { unit: 'lb' })], gymNames: {} });
    expect(v.trends.find((t) => t.exercise === 'Bench press')?.trend).toBe('not comparable');
    const one = trainingOverviewView({ weeks: 4, nowUtc: now, tz: TZ, sessions: [workout(0, [{ load: 100, reps: 5 }])], gymNames: {} });
    expect(one.trends).toEqual([]);
    const empty = trainingOverviewView({ weeks: 2, nowUtc: now, tz: TZ, sessions: [], gymNames: {} });
    expect(empty).toMatchObject({ workouts: 0, perWeek: 0, sessions: [], trends: [] });
  });

  it('per week is over the weeks the history covers, not a window that predates it (review N4)', () => {
    // 20 days of history, a 12-week window: 3 workouts over 20 days, not over 12 weeks.
    const sessions = [workout(0, [{ load: 95, reps: 8 }]), workout(7, [{ load: 97.5, reps: 8 }]), workout(14, [{ load: 100, reps: 6 }])];
    const v = trainingOverviewView({ weeks: 12, nowUtc: now, tz: TZ, sessions, gymNames: {}, firstWorkoutUtc: sessions[0]?.session.startedAt.utc ?? null });
    expect(v).toMatchObject({ perWeek: 1, perWeekOverWeeks: 2.9 });
    // A longer history: the window as before.
    const long = trainingOverviewView({ weeks: 2, nowUtc: now, tz: TZ, sessions, gymNames: {}, firstWorkoutUtc: sessions[0]?.session.startedAt.utc ?? null });
    expect(long).toMatchObject({ perWeekOverWeeks: 2 });
    // Never less than a week.
    const fresh = trainingOverviewView({ weeks: 4, nowUtc: now, tz: TZ, sessions: [workout(19, [{ load: 95, reps: 8 }])], gymNames: {}, firstWorkoutUtc: toIso(toMs(T0) + 19 * 86_400_000) });
    expect(fresh).toMatchObject({ workouts: 1, perWeek: 1, perWeekOverWeeks: 1 });
  });

  it('working sets Ben marked as not counted are counted apart (review N5)', () => {
    const v = trainingOverviewView({ weeks: 4, nowUtc: now, tz: TZ, sessions: [workout(7, [{ load: 120, reps: 8, exclusions: ['spotted'] }, { load: 95, reps: 8 }])], gymNames: {} });
    const bench = v.sessions[0]?.exercises.find((e) => e.name === 'Bench press');
    expect(bench).toMatchObject({ notCounted: 1 });
    expect(bench?.top?.replace(/\u00a0/g, ' ')).toBe('95 kg × 8');
    const row = v.sessions[0]?.exercises.find((e) => e.name === 'Cable row');
    expect(row && 'notCounted' in row).toBe(false);
  });
});

describe('equipmentView (get_gym_equipment)', () => {
  it('per-hand dumbbells, an assisted stack and a barbell, each with its own unit, convention, min and max', () => {
    const v = equipmentView({ gymName: 'Main Gym', equipment: [barbell(), dumbbells(), assisted(), stack({ availability: 'retired' })], exercise: null });
    expect(v.domain).toBe('Your data');
    expect(v.items.map((i) => [i.kind, i.convention])).toEqual([
      ['barbell', 'total'],
      ['dumbbells', 'per_hand'],
      ['assisted_stack', 'assistance'],
    ]);
    const db = v.items.find((i) => i.kind === 'dumbbells');
    expect(db?.max).toBeGreaterThan(0);
    expect(db?.loads).toMatch(/kg$/);
  });

  it('for one exercise: only the items it can use; a bodyweight exercise needs none', () => {
    const bench = exercise(200, 'Bench press');
    const v = equipmentView({ gymName: 'Main Gym', equipment: [barbell(), stack()], exercise: bench });
    expect(v.items.map((i) => i.kind)).toEqual(['barbell']);
    const pushUp = exercise(300, 'Push-up', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
    expect(equipmentView({ gymName: 'Main Gym', equipment: [barbell()], exercise: pushUp })).toMatchObject({ bodyweight: true, items: [] });
  });

  it('a long inventory is summarised with its lightest and heaviest loads (never extrapolated past the max)', () => {
    const big = stack({ stackLoads: Array.from({ length: 60 }, (_, i) => (i + 1) * 2.5) });
    const line = equipmentView({ gymName: 'G', equipment: [big], exercise: null }).items[0];
    expect(line).toMatchObject({ min: 2.5, max: 150, count: 60 });
    expect(line?.loads).toContain('…');
    expect(line?.loads.endsWith('150 kg')).toBe(true);
  });
});

describe('builtInTargetsView (get_progression_targets)', () => {
  it('is labelled as the fallback for comparison and says when a pain flag holds the movement', () => {
    const flag = { status: 'active' } as PainFlag;
    const v = builtInTargetsView({
      exerciseName: 'Bench press',
      convention: 'total',
      planned: [{ setType: 'working', planned: { load: kg(100), reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null } }],
      basedOn: { utc: T0, tz: TZ, title: 'Push A' },
      painFlag: flag,
    });
    expect(v).toMatchObject({ domain: 'Your data', label: 'built-in rule (fallback), for comparison', basedOn: { date: '2026-10-08', title: 'Push A' }, painFlag: 'pain flag on: no increases' });
    expect(v.sets[0]?.target.replace(/\u00a0/g, ' ')).toBe('100 kg × 6–8 reps');
  });

  it('each working set names its target RPE as the next workout would plan it: the plan’s, else the rule’s; none on warm-ups; Ben’s one-day override never carries (merge with target RPE)', () => {
    const set = (setType: 'warmup' | 'working' | 'drop', rpe: number | null, rpeOverride?: number) => ({
      setType,
      planned: { load: kg(100), reps: { min: 6, max: 8 }, durationS: null, rpe, rir: null, ...(rpeOverride === undefined ? {} : { rpeOverride }) },
    });
    const v = builtInTargetsView({
      exerciseName: 'Bench press',
      convention: 'total',
      planned: [set('warmup', null), set('working', null), set('working', 7.5), set('working', null, 9.5), set('drop', null)],
      basedOn: null,
      painFlag: null,
      ruleRpe: 8.5,
    });
    expect(v.sets.map((x) => x.rpe)).toEqual([null, 8.5, 7.5, 8.5, null]);
    expect(v.sets.map((x) => x.target.replace(/\u00a0/g, ' '))).toEqual(['100 kg × 6–8 reps', '100 kg × 6–8 reps @ RPE 8.5', '100 kg × 6–8 reps @ RPE 7.5', '100 kg × 6–8 reps @ RPE 8.5', '100 kg × 6–8 reps']);
    // Rule target unknown: no RPE invented (rule 6).
    expect(builtInTargetsView({ exerciseName: 'Bench press', convention: 'total', planned: [set('working', null)], basedOn: null, painFlag: null }).sets[0]?.rpe).toBeNull();
  });
});

describe('exerciseRecordsView (get_exercise_records, Coach v3)', () => {
  it('heaviest logged set, most reps and the best e1RM, which is always labelled an estimate', () => {
    const v = exerciseRecordsView({ exerciseId: BENCH, exerciseName: 'Bench press', sessions: [workout(0, [{ load: 100, reps: 5 }, { load: 90, reps: 10 }]), workout(7, [{ load: 95, reps: 8 }])], ...NAMES });
    expect(v.domain).toBe('Your data');
    expect(v.totalSessions).toBe(2);
    expect(v.records).toHaveLength(1);
    const r = v.records[0];
    expect(r?.heaviest).toMatchObject({ label: 'heaviest logged set (not an estimate)', reps: 5, load: kg(100) });
    expect(r?.mostReps).toMatchObject({ reps: 10, load: kg(90) });
    // Epley: 90 × (1 + 10/30) = 120; 100 × (1 + 5/30) = 116.7; 95 × (1 + 8/30) = 120.3 → 120.5.
    expect(r?.bestE1rm?.label).toBe(E1RM_LABEL);
    expect(r?.bestE1rm?.label).toMatch(/estimate, not a tested max/);
    expect(r?.bestE1rm?.value).toBe(120.5);
    expect(r?.bestE1rm?.text).toMatch(/^≈ 120\.5 kg \(est\.\)$/);
    expect(r?.bestE1rm?.from).toMatchObject({ reps: 8, load: kg(95) });
  });

  it('kg and lb, app and FitNotes stay on separate lines; sets Ben left out never count', () => {
    const v = exerciseRecordsView({
      exerciseId: BENCH,
      exerciseName: 'Bench press',
      sessions: [workout(0, [{ load: 130, reps: 3, exclusions: ['spotted'] }, { load: 100, reps: 5 }]), workout(1, [{ load: 225, reps: 5 }], { unit: 'lb' }), workout(2, [{ load: 110, reps: 3 }], { imported: true })],
      ...NAMES,
    });
    expect(v.records.map((r) => [r.heaviest.load.value, r.unit, r.source]).sort()).toEqual([
      [100, 'kg', 'app'],
      [110, 'kg', 'FitNotes import'],
      [225, 'lb', 'app'],
    ]);
    expect(v.imported).toMatch(/FitNotes/);
  });

  it('no e1RM for assisted sets (bigger assistance is easier), and none from sets over 10 reps', () => {
    const base = workout(0, [{ load: 30, reps: 8 }]);
    const assistedAgg: SessionAggregate = { ...base, sets: base.sets.map((x) => (x.actual?.load?.unit === 'kg' && x.actual.load.convention === 'total' ? { ...x, actual: { ...x.actual, load: { ...x.actual.load, convention: 'assistance' as const } } } : x)) };
    const a = exerciseRecordsView({ exerciseId: BENCH, exerciseName: 'Assisted pull-up', sessions: [assistedAgg], ...NAMES });
    expect(a.records.find((r) => r.convention === 'assistance')?.bestE1rm).toBeNull();
    const high = exerciseRecordsView({ exerciseId: BENCH, exerciseName: 'Bench press', sessions: [workout(0, [{ load: 60, reps: 15 }])], ...NAMES });
    expect(high.records[0]?.bestE1rm).toBeNull();
    expect(high.records[0]?.mostReps.reps).toBe(15);
  });
});

describe('recentSessionsView (get_recent_sessions, Coach v3)', () => {
  it('newest first, limited to count, every exercise with its sets as logged (warm-ups marked)', () => {
    const v = recentSessionsView({ sessions: [workout(0, [{ load: 95, reps: 8 }]), workout(7, [{ load: 97.5, reps: 8, exclusions: ['pain'] }]), workout(3, [{ load: 96, reps: 8 }])], count: 2, gymNames: NAMES.gymNames });
    expect(v.domain).toBe('Your data');
    expect(v.sessions.map((x) => x.date)).toEqual(['2026-10-15', '2026-10-11']);
    const bench = v.sessions[0]?.exercises[0];
    expect(bench?.sets[0]).toMatch(/^warm-up 60\skg × 10$/u);
    expect(bench?.sets[1]).toMatch(/^97\.5\skg × 8 \(not counted: pain\)$/u);
    expect(v.sessions[0]?.exercises.map((e) => e.exerciseId)).toContain(ROW);
    expect(v.sessions[0]).toMatchObject({ title: 'Push A', gym: 'Main Gym', source: 'app' });
  });

  it('an imported workout is labelled and has no minutes', () => {
    const v = recentSessionsView({ sessions: [workout(0, [{ load: 95, reps: 8 }], { imported: true })], count: 5, gymNames: {} });
    expect(v.sessions[0]).toMatchObject({ source: 'FitNotes import', minutes: null });
    expect(v.imported).toMatch(/FitNotes/);
  });
});

describe('gym summary (get_gym_equipment with no exercise, Coach v3)', () => {
  it('one line per item: per-hand dumbbells say each, assisted says assist; another gym can be read by name', () => {
    const v = equipmentView({ gymName: 'Hotel gym', equipment: [dumbbells(), assisted(), barbell()], exercise: null, savedGyms: ['Main Gym', 'Hotel gym'] });
    expect(v.savedGyms).toEqual(['Main Gym', 'Hotel gym']);
    const lines = v.summary ?? [];
    expect(lines.find((l) => /each$/.test(l))).toBeDefined();
    expect(lines.find((l) => /: assist /.test(l))).toBeDefined();
    expect(lines).toEqual(gymSummaryLines(v.items));
    // With an exercise, no summary.
    expect(equipmentView({ gymName: 'G', equipment: [barbell()], exercise: exercise(200, 'Bench press') }).summary).toBeUndefined();
  });
});

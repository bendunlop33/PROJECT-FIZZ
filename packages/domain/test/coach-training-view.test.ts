import { describe, expect, it } from 'vitest';
import type { PainFlag, SessionAggregate } from '@fizz/schemas';
import { builtInTargetsView, equipmentView, exerciseHistoryView, toIso, toMs, trainingOverviewView } from '../src/index';
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
});

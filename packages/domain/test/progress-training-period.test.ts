import { describe, expect, it } from 'vitest';

import { at } from './fixtures';
import { apply, startFixture } from './session-fixture';
import { buildProgressHomeView, buildTrainingPeriodView, periodBar, sessionPlanDayName, toProgressSession, weekBars, type ActivityRow, type MuscleInfo, type ProgressSession, type TrainingPlanDays } from '../src/index';

/**
 * (Redesign v3 C3, C4; Ben 27 Oct) Progress › Training for the period bar: the Month calendar (tiles, dots by plan
 * day, rings for activities, legend), the Week's 7 days, 3M+ weekly bars, and totals against the previous period.
 */

const MIN = 60_000;
const TODAY = '2026-10-27';
let n = 0;

function session(date: string, opts: { name?: string | null; planDay?: number; routineId?: string; imported?: boolean; sets?: number; planId?: string } = {}): ProgressSession {
  n += 1;
  const startedMs = Date.parse(`${date}T17:30:00.000Z`);
  const imported = opts.imported === true;
  return {
    sessionId: `s${String(n)}`,
    version: 1,
    source: imported ? 'import' : 'manual',
    name: opts.name === undefined ? 'Workout' : opts.name,
    gymId: null,
    startedAtUtc: new Date(startedMs).toISOString(),
    startedMs,
    tz: 'Europe/London',
    date,
    dateOnly: imported,
    endedAtUtc: imported ? null : new Date(startedMs + 50 * MIN).toISOString(),
    durationMs: imported ? null : 50 * MIN,
    durationConfirmed: false,
    exercises: [
      {
        sessionExerciseId: `r${String(n)}`,
        exerciseId: 'bench',
        exerciseName: 'Bench press',
        equipmentId: null,
        equipmentKind: 'barbell',
        gymId: null,
        convention: 'total',
        unit: 'kg',
        measurement: 'reps',
        laterality: 'bilateral',
        sets: Array.from({ length: opts.sets ?? 4 }, (_, i) => ({ setId: `x${String(n)}-${String(i)}`, setType: 'working' as const, side: null, load: { value: 60, unit: 'kg' as const, convention: 'total' as const }, reps: 8, durationS: null, rpe: null, rir: null, completedAtUtc: null, index: i })),
      },
    ],
    ...(opts.planDay !== undefined ? { planDay: { planId: opts.planId ?? 'plan-1', dayIndex: opts.planDay } } : {}),
    ...(opts.routineId !== undefined ? { routineId: opts.routineId } : {}),
  };
}

const INFO = new Map<string, MuscleInfo>([['bench', { name: 'Bench press', movementPattern: 'horizontal_push', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] }]]);
const PLAN: TrainingPlanDays = {
  planId: 'plan-1',
  days: [
    { dayIndex: 0, name: 'Push', routineIds: ['r-push'] },
    { dayIndex: 1, name: 'Pull', routineIds: ['r-pull'] },
    { dayIndex: 2, name: 'Legs', routineIds: ['r-legs'] },
  ],
};
const run = (activityId: string): ActivityRow => ({ activityId, version: 1, title: 'Run', when: 'Mon', detail: '5.2 km', planned: false, accessibilityLabel: 'Run, 5.2 km' });

function sept(): ProgressSession[] {
  // 9 sessions in September, 3 sets each.
  return ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10', '2026-09-15', '2026-09-17', '2026-09-22', '2026-09-24', '2026-09-29'].map((d) => session(d, { sets: 3, planDay: 0 }));
}

describe('Month (C3)', () => {
  const sessions = [
    ...sept(),
    session('2026-10-05', { planDay: 0, name: 'Push' }),
    session('2026-10-06', { planDay: 1, name: 'Pull' }),
    session('2026-10-08', { routineId: 'r-legs', name: 'Legs' }), // older plan workout: no planDay, matched by routine
    session('2026-10-10', { name: 'Arms day' }), // not a plan day
    session('2026-10-20', { planDay: 0, name: 'Push' }),
    session('2026-10-20', { planDay: 2, name: 'Legs' }),
  ];
  const bar = periodBar({ today: TODAY, span: 'month', offset: 0, earliest: '2026-09-01' });
  const view = buildTrainingPeriodView({ sessions, exercises: INFO, today: TODAY, bar, plan: PLAN, aim: 3, earliest: '2026-09-01', activities: [{ date: '2026-10-12', row: run('a1') }, { date: '2026-10-20', row: run('a2') }, { date: '2026-10-30', row: { ...run('a3'), planned: true } }] });
  const tiles = (view.month?.weeks ?? []).flat().filter((t) => t !== null);
  const tile = (d: string) => tiles.find((t) => t.date === d);

  it('a Monday-first grid of every day in October', () => {
    expect(view.month?.weeks[0]?.slice(0, 3)).toEqual([null, null, null]); // 1 Oct 2026 is a Thursday
    expect(tiles).toHaveLength(31);
    expect(view.weekdayLetters).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
  });

  it('green on any workout or activity; today outlined; future faded; planned activities not drawn', () => {
    expect(tile('2026-10-05')?.state).toBe('done');
    expect(tile('2026-10-12')?.state).toBe('done'); // a run only
    expect(tile('2026-10-13')?.state).toBe('empty');
    expect(tile(TODAY)?.isToday).toBe(true);
    expect(tile('2026-10-28')?.state).toBe('future');
    expect(tile('2026-10-30')?.marks).toEqual([]);
  });

  it('one dot per session coloured by plan day (old plan workouts by routine), neutral otherwise, a ring per activity', () => {
    expect(tile('2026-10-05')?.marks).toEqual([{ kind: 'dot', colour: 'orange' }]);
    expect(tile('2026-10-06')?.marks).toEqual([{ kind: 'dot', colour: 'blue' }]);
    expect(tile('2026-10-08')?.marks).toEqual([{ kind: 'dot', colour: 'violet' }]);
    expect(tile('2026-10-10')?.marks).toEqual([{ kind: 'dot', colour: 'neutral' }]);
    expect(tile('2026-10-12')?.marks).toEqual([{ kind: 'ring' }]);
    expect(tile('2026-10-20')?.marks).toEqual([{ kind: 'dot', colour: 'orange' }, { kind: 'dot', colour: 'violet' }, { kind: 'ring' }]);
  });

  it('a tap opens the one thing, or lists a busy day', () => {
    expect(tile('2026-10-05')?.open).toEqual({ kind: 'session', sessionId: expect.any(String) as string });
    expect(tile('2026-10-12')?.open).toEqual({ kind: 'activity', activityId: 'a1' });
    expect(tile('2026-10-13')?.open).toBeNull();
    expect(tile('2026-10-20')?.open).toEqual({ kind: 'day', date: '2026-10-20' });
    expect(view.dayRows['2026-10-20']?.map((r) => r.kind)).toEqual(['session', 'session', 'activity']);
    expect(tile('2026-10-20')?.words).toContain('Push, Legs, Run');
  });

  it('legend: the plan days, Other, and the ring, always', () => {
    expect(view.legend.map((l) => l.label)).toEqual(['Push', 'Pull', 'Legs', 'Other', 'Run / other']);
    expect(view.legend.map((l) => l.mark)).toEqual([
      { kind: 'dot', colour: 'orange' },
      { kind: 'dot', colour: 'blue' },
      { kind: 'dot', colour: 'violet' },
      { kind: 'dot', colour: 'neutral' },
      { kind: 'ring' },
    ]);
    const empty = buildTrainingPeriodView({ sessions: [], exercises: INFO, today: TODAY, bar, plan: null, aim: null, earliest: TODAY });
    expect(empty.legend.map((l) => l.label)).toEqual(['Workout', 'Run / other']);
  });

  it('`October workouts · 6` and totals against the whole of September', () => {
    expect(view.month?.workouts).toMatchObject({ label: 'October workouts', count: 6, month: '2026-10' });
    const [sessionsT, timeT, setsT] = view.totals;
    expect(sessionsT).toMatchObject({ value: '6', label: 'Sessions', delta: '−3 vs Sep' });
    expect(timeT).toMatchObject({ label: 'Time', delta: '−2 h 30' });
    expect(setsT).toMatchObject({ value: '24', label: 'Sets', delta: '−3' });
  });
});

describe('totals honesty (rule 6)', () => {
  it('no delta against a period wholly before the first log; no time delta when a workout has no time', () => {
    const bar = periodBar({ today: TODAY, span: 'month', offset: 0, earliest: '2026-10-02' });
    const v = buildTrainingPeriodView({ sessions: [session('2026-10-02')], exercises: INFO, today: TODAY, bar, plan: null, aim: null, earliest: '2026-10-02' });
    expect(v.totals.map((t) => t.delta)).toEqual([null, null, null]);
    const withImport = [session('2026-09-03', { imported: true }), session('2026-10-02')];
    const bar2 = periodBar({ today: TODAY, span: 'month', offset: 0, earliest: '2026-09-03' });
    const v2 = buildTrainingPeriodView({ sessions: withImport, exercises: INFO, today: TODAY, bar: bar2, plan: null, aim: null, earliest: '2026-09-03' });
    expect(v2.totals[0]?.delta).toBe('±0 vs Sep');
    expect(v2.totals[1]?.delta).toBeNull();
  });
});

describe('Week (C4)', () => {
  it('the 7 days and totals against last week', () => {
    const sessions = [session('2026-10-20', { planDay: 0 }), session('2026-10-26', { planDay: 1 }), session('2026-10-27', { planDay: 2 })];
    const bar = periodBar({ today: TODAY, span: 'week', offset: 0, earliest: '2026-10-01' });
    const v = buildTrainingPeriodView({ sessions, exercises: INFO, today: TODAY, bar, plan: PLAN, aim: 3, earliest: '2026-10-01' });
    expect(v.week?.map((t) => t.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(v.week?.[2]?.state).toBe('future');
    expect(v.month).toBeNull();
    expect(v.bars).toBeNull();
    expect(v.totals[0]?.delta).toBe('+1 vs last week');
  });
});

describe('3M / 6M / 1Y bars (C4)', () => {
  it('one bar per week starting in the period, to this week; finished weeks under the aim are greyed', () => {
    const sessions = [session('2026-08-03'), session('2026-08-04'), session('2026-08-05'), session('2026-08-10'), session('2026-10-26'), session('2026-07-31')];
    const bar = periodBar({ today: TODAY, span: '3m', offset: 0, earliest: '2026-07-01' });
    const v = buildTrainingPeriodView({ sessions, exercises: INFO, today: TODAY, bar, plan: null, aim: 3, earliest: '2026-07-01' });
    const bars = v.bars;
    expect(bars?.weeks[0]).toMatchObject({ monday: '2026-08-03', count: 3, underAim: false });
    expect(bars?.weeks[1]).toMatchObject({ monday: '2026-08-10', count: 1, underAim: true });
    expect(bars?.weeks.at(-1)).toMatchObject({ monday: '2026-10-26', count: 1, underAim: null, current: true });
    expect(bars?.weeks).toHaveLength(13);
    expect(bars?.aim).toBe('aim 3');
    expect(bars?.last).toBe('this week');
    expect(v.legend).toEqual([]);
    expect(v.totals.map((t) => t.label)).toEqual(['Sessions', 'Time', 'A week']);
  });

  it('no aim: nothing greyed; a 1Y period has ~52 bars', () => {
    const bar = periodBar({ today: TODAY, span: '1y', offset: 0 });
    const b = weekBars([], bar.full, TODAY, null);
    expect(b.weeks.length).toBeGreaterThanOrEqual(51);
    expect(b.weeks.every((w) => w.underAim === null)).toBe(true);
    expect(b.aim).toBeNull();
  });
});

describe('sessionPlanDayName', () => {
  it('current plan by planDay, then routine; another plan by its own name; else null', () => {
    expect(sessionPlanDayName({ planDay: { planId: 'plan-1', dayIndex: 1 }, name: 'Pull A' }, PLAN)).toBe('Pull');
    expect(sessionPlanDayName({ routineId: 'r-legs', name: 'Legs' }, PLAN)).toBe('Legs');
    expect(sessionPlanDayName({ planDay: { planId: 'old', dayIndex: 0 }, name: 'Upper' }, PLAN)).toBe('Upper');
    expect(sessionPlanDayName({ name: 'Arms' }, PLAN)).toBeNull();
    expect(sessionPlanDayName({ planDay: { planId: 'old', dayIndex: 0 }, name: null }, null)).toBeNull();
  });
});

describe('home view on the bar window', () => {
  it('muscles and records use the bar period; the records line names it', () => {
    const bar = periodBar({ today: TODAY, span: 'month', offset: -1, earliest: '2026-01-01' });
    const v = buildProgressHomeView({ sessions: sept(), exercises: INFO, today: TODAY, period: '1m', grouping: 'body_part', bar: { window: bar.window, title: bar.title, phrase: bar.phrase } });
    expect(v.dataState).toBe('normal');
    if (v.dataState !== 'normal') return;
    expect(v.window.from).toBe('2026-09-01');
    expect(v.window.to).toBe('2026-09-30');
    expect(v.muscles.rows.find((r) => r.label === 'Chest')?.sessions).toBe(9);
    expect(v.records.empty).toBeNull();
  });
});

describe('projection keeps the plan day', () => {
  it('toProgressSession carries planDay and routineId when the workout has them, and neither key otherwise', () => {
    let s = startFixture().state;
    s = apply(s, { type: 'finish', at: at(3600), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    const plain = toProgressSession({ ...s, session: { ...s.session, routineId: null } }, 'Europe/London', 0);
    expect(plain).not.toBeNull();
    expect(plain && 'planDay' in plain).toBe(false);
    expect(plain && 'routineId' in plain).toBe(false);
    const planned = toProgressSession(
      { ...s, session: { ...s.session, routineId: 'r-push', planDay: { planId: 'plan-1', dayIndex: 0, splitDayId: 'push', templateRoutineId: null, templateVersion: null, variationId: null } } },
      'Europe/London',
      0,
    );
    expect(planned?.planDay).toEqual({ planId: 'plan-1', dayIndex: 0 });
    expect(planned?.routineId).toBe('r-push');
  });
});

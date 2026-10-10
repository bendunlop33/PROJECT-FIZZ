import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import {
  buildActiveSetView,
  clockText,
  estimateTimeLeft,
  paceSamplesOf,
  percentile,
  recentPaceSamples,
  resolvePace,
  roundTimeLeftMinutes,
  startWorkout,
  timeLeftLine,
  timeLeftSheet,
  TIME_LEFT,
  type TimeLeftEstimate,
} from '../src/index';
import { NBSP } from '../src/index';
import { at, barbell, GYM, idGen, kg, ms, profile, routine, routineExercise, stack, template, TZ, values } from './fixtures';
import { apply, BENCH, exercises, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/** Bench ×`benchSets` then Cable row ×`rowSets`, 2:00 rest after every working set. */
function twoExercises(benchSets = 3, rowSets = 3, opts: { hang?: boolean; benchTransitionS?: number | null } = {}): SessionAggregate {
  const r = routine([
    routineExercise(600, {
      exerciseId: BENCH,
      equipmentId: barbell().id,
      order: 0,
      setTemplates: Array.from({ length: benchSets }, (_, i) => template(6000 + i, { targetLoad: kg(100) })),
      restBySetType: { working: { seconds: 120 } },
      transitionRestS: opts.benchTransitionS ?? null,
    }),
    routineExercise(601, {
      exerciseId: ROW,
      equipmentId: stack().id,
      order: 1,
      setTemplates: Array.from({ length: rowSets }, (_, i) => template(6010 + i, { targetLoad: kg(50, 'stack') })),
      restBySetType: { working: { seconds: 120 } },
    }),
    ...(opts.hang
      ? [routineExercise(602, { exerciseId: HANG, order: 2, setTemplates: [template(6020, { targetReps: null, targetDurationS: 45 })], restBySetType: { working: { seconds: 120 } } })]
      : []),
  ]);
  return startWorkout({ opId: 'start-tl', owner: profile(), gymId: GYM, routine: r, exercises, gymEquipment: [barbell(), stack()], at: at(0), newId: idGen(20_000) }).aggregate;
}

const NO_SAMPLES = { set: [], changeover: [] };
/** Display text uses a no-break space between a number and `min`. */
const t = (text: string): string => text.replace(/(\d) min/g, `$1${NBSP}min`);

function est(state: SessionAggregate, nowS: number, extra: Partial<Parameters<typeof estimateTimeLeft>[1]> = {}): TimeLeftEstimate {
  const e = estimateTimeLeft(state, { nowMs: ms(nowS), ...extra });
  if (!e) throw new Error('expected an estimate');
  return e;
}

describe('estimateTimeLeft (active-workout §2.15.2)', () => {
  it('check 57: 6 pending sets, 2:00 rest, 1:00 a set and a 2:00 changeover → 18 min, shown as About 20 min', () => {
    const s = twoExercises();
    const e = est(s, 0, { recent: { set: [60, 60, 60], changeover: [120] } });
    // 6 × 1:00 + 5 × 2:00 + 1 × 2:00 changeover = 18 min
    expect(e.seconds).toBe(6 * 60 + 5 * 120 + 120);
    expect(e.minutes).toBe(20);
    expect(e.pendingSets).toBe(6);
    expect(e.pendingExercises).toBe(2);
    expect(e.plannedRestSeconds).toBe(600);
    expect(e.pace.source).toBe('recent_workouts');
    expect(timeLeftLine(e, TZ).text).toBe(t('About 20 min left · ends about 19:20'));
  });

  it('check 57: paused time and a 40-minute gap never enter the pace', () => {
    let s = twoExercises(4, 3);
    const [b1, b2, b3, b4] = setsFor(s, BENCH);
    const [r1] = setsFor(s, ROW);
    if (!b1 || !b2 || !b3 || !b4 || !r1) throw new Error('fixture');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 100));
    s = apply(s, logCmd(b2.id, values(kg(100), 8), 280)); // 3:00 gap − 2:00 rest = 60
    s = apply(s, logCmd(b3.id, values(kg(100), 8), 460)); // 60
    s = apply(s, { type: 'pause', at: at(500), opId: 'p1' });
    s = apply(s, { type: 'resume', at: at(1500), opId: 'r1' });
    s = apply(s, logCmd(b4.id, values(kg(100), 8), 1640)); // 1180 − 1000 paused = 180 → 60
    s = apply(s, logCmd(r1.id, values(kg(50, 'stack'), 10), 1640 + 40 * 60)); // 40-min gap: dropped
    const samples = paceSamplesOf(s, ms(4100));
    expect(samples.set).toEqual([60, 60, 60]);
    expect(samples.changeover).toEqual([]);

    const e = est(s, 1640 + 40 * 60);
    expect(e.pace.source).toBe('this_workout');
    expect(e.pace.secondsPerSet).toBe(60);
    expect(e.pace.changeoverSource).toBe('default');
    // Resting 2:00 now, then 2 rows: 2 × 1:00 + 1 rest of 2:00, no changeover.
    expect(e.seconds).toBe(120 + 2 * 60 + 120);
    expect(e.minutes).toBe(6);
  });

  it('check 58: with no logs at all, the default pace is used and labelled Default', () => {
    const s = twoExercises();
    const e = est(s, 0);
    expect(e.pace.source).toBe('default');
    expect(e.pace.secondsPerSet).toBe(TIME_LEFT.defaultSetSeconds);
    expect(e.pace.changeoverSeconds).toBe(TIME_LEFT.defaultChangeoverSeconds);
    expect(e.seconds).toBe(6 * 45 + 5 * 120 + 120);
    expect(e.lowMinutes).toBeLessThanOrEqual(e.minutes);
    expect(e.highMinutes).toBeGreaterThan(e.minutes);
    expect(e.pace.low.secondsPerSet).toBeCloseTo(45 * 0.75);
    expect(e.pace.high.secondsPerSet).toBeCloseTo(45 * 1.25);
    expect(timeLeftLine(e, TZ).text.startsWith('About ')).toBe(true);
    expect(timeLeftSheet(e, s, ms(0), TZ).paceSource).toBe('Default');
  });

  it('uses this workout only once it has 3 gaps of that kind; recent workouts before that', () => {
    let s = twoExercises(4, 2);
    const [b1, b2, b3] = setsFor(s, BENCH);
    if (!b1 || !b2 || !b3) throw new Error('fixture');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 0));
    s = apply(s, logCmd(b2.id, values(kg(100), 8), 200)); // 80
    s = apply(s, logCmd(b3.id, values(kg(100), 8), 400)); // 80
    const recent = { set: [30, 30, 30, 30], changeover: [90] };
    expect(est(s, 400, { recent }).pace).toMatchObject({ source: 'recent_workouts', secondsPerSet: 30, changeoverSeconds: 90 });
    expect(est(s, 400).pace.source).toBe('default');
  });

  it('adds what is left of a running rest, and nothing after the final set', () => {
    let s = twoExercises(1, 1);
    const [b1] = setsFor(s, BENCH);
    if (!b1) throw new Error('fixture');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 0));
    // 30 s into the bench rest: 1:30 left, the changeover to the row still to come, then the row.
    const e = est(s, 30, { recent: { set: [60], changeover: [60] } });
    expect(e.pendingSets).toBe(1);
    expect(e.seconds).toBe(90 + 60 + 60);
    expect(timeLeftLine(e, TZ).text).toBe(t('About 4 min left'));
  });

  it('timed sets add their planned duration; superset members use the transition', () => {
    const fast = est(startFixture({ supersetTransitionS: 15 }).state, 0, { recent: { set: [0], changeover: [0] } });
    const slow = est(startFixture({ supersetTransitionS: 45 }).state, 0, { recent: { set: [0], changeover: [0] } });
    // W, B1, B2, R1, F1, R2, F2, H1
    expect(fast.pendingSets).toBe(8);
    expect(fast.pendingExercises).toBe(4);
    // With zero pace, the estimate is the planned rest plus the 45 s hang.
    expect(fast.seconds).toBe(fast.plannedRestSeconds + 45);
    // R1→F1 and R2→F2 are the superset transitions.
    expect(slow.plannedRestSeconds - fast.plannedRestSeconds).toBe(60);
  });

  it('counts a changeover only between exercises, not between superset members', () => {
    const { state } = startFixture({ supersetTransitionS: 15 });
    const zero = est(state, 0, { recent: { set: [0], changeover: [0] } });
    const withChangeover = est(state, 0, { recent: { set: [0], changeover: [100] } });
    // Bench → superset → Dead hang: 2 changeovers.
    expect(withChangeover.seconds - zero.seconds).toBe(200);
  });

  it('an exercise with a transition uses it before the next exercise, as log_set does', () => {
    const s = twoExercises(2, 1, { benchTransitionS: 30 });
    const e = est(s, 0, { recent: { set: [0], changeover: [0] } });
    // B1 → B2: 2:00; B2 → R1: 0:30 transition.
    expect(e.plannedRestSeconds).toBe(150);
  });

  it('skipped and deleted sets are not left to do; returns null once nothing is pending', () => {
    let s = twoExercises(1, 2);
    const row = s.exercises.find((x) => x.exerciseId === ROW);
    if (!row) throw new Error('fixture');
    s = apply(s, { type: 'skip_exercise', at: at(10), opId: 'skip', sessionExerciseId: row.id });
    expect(est(s, 10).pendingSets).toBe(1);
    const [b1] = setsFor(s, BENCH);
    if (!b1) throw new Error('fixture');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 60));
    expect(estimateTimeLeft(s, { nowMs: ms(60) })).toBeNull();
  });

  it('is frozen while paused and says so', () => {
    let s = twoExercises();
    s = apply(s, { type: 'pause', at: at(60), opId: 'p' });
    const a = est(s, 60);
    const b = est(s, 60 + 3600);
    expect(b.seconds).toBe(a.seconds);
    expect(b.paused).toBe(true);
    expect(timeLeftLine(b, TZ).text).toBe(t(`Paused · about ${String(b.minutes)} min left after you resume`));
    expect(timeLeftSheet(b, s, ms(60 + 3600), TZ).endsLine).toBeNull();
  });

  it('standing around makes the end time move later honestly', () => {
    const s = twoExercises();
    const a = est(s, 0);
    const b = est(s, 20 * 60);
    expect(b.seconds).toBe(a.seconds);
    expect(new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()).toBe(20 * 60_000);
  });

  it('never reads check-ins: the same workout with a check-in gives the same estimate', () => {
    const s = twoExercises();
    const withCheckIn: SessionAggregate = { ...s, session: { ...s.session, checkIn: { kind: 'skipped', atUtc: at(0).utc } } };
    expect(est(withCheckIn, 0)).toEqual(est(s, 0));
  });
});

describe('Finish by wording (check 59)', () => {
  const s = twoExercises();
  const recent = { set: [60, 60, 60], changeover: [120] };

  it('on track: the line names the finish-by time', () => {
    const e = est(s, 0, { recent, finishByUtc: at(45 * 60).utc });
    expect(e.overByMinutes).toBeNull();
    expect(timeLeftLine(e, TZ).text).toBe(t('About 20 min left · on track for 19:45'));
  });

  it('over: about N min past, rounded the same way', () => {
    const e = est(s, 0, { recent, finishByUtc: at(8 * 60).utc });
    expect(e.overByMinutes).toBe(10);
    expect(timeLeftLine(e, TZ).text).toBe(t('About 20 min left · about 10 min past 19:08'));
  });

  it('Not set restores the normal wording; the sets are never changed', () => {
    const before = JSON.stringify(s);
    const e = est(s, 0, { recent, finishByUtc: null });
    expect(timeLeftLine(e, TZ).text).toBe(t('About 20 min left · ends about 19:20'));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('rounding and line variants (§2.15.1)', () => {
  it('10 min or more → nearest 5; under 10 → nearest minute', () => {
    expect(roundTimeLeftMinutes(18 * 60)).toBe(20);
    expect(roundTimeLeftMinutes(12 * 60 + 29)).toBe(10);
    expect(roundTimeLeftMinutes(9 * 60 + 29)).toBe(9);
    expect(roundTimeLeftMinutes(9 * 60 + 31)).toBe(10);
    expect(roundTimeLeftMinutes(-5)).toBe(0);
  });

  it('under 2 min reads Under 2 min left; never seconds', () => {
    let s = twoExercises(1, 1);
    const [b1] = setsFor(s, BENCH);
    if (!b1) throw new Error('fixture');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 0));
    const e = est(s, 119, { recent: { set: [30], changeover: [0] } });
    expect(timeLeftLine(e, TZ)).toEqual({ text: t('Under 2 min left'), accessibilityLabel: 'Workout estimate: under 2 minutes left.' });
  });

  it('VoiceOver label is worded as an estimate', () => {
    const e = est(twoExercises(), 0, { recent: { set: [60, 60, 60], changeover: [120] } });
    expect(timeLeftLine(e, TZ).accessibilityLabel).toBe('Workout estimate: about 20 minutes left, ending about 19:20.');
  });

  it('end time is rounded to 5 minutes', () => {
    const e = est(twoExercises(), 7 * 60, { recent: { set: [60, 60, 60], changeover: [120] } });
    // 19:07 + 18 min = 19:25
    expect(clockText(new Date(e.endsAt).getTime(), TZ)).toBe('19:25');
  });
});

describe('pace helpers', () => {
  it('percentile interpolates; median of an even list is the middle mean', () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(percentile([10], 0.25)).toBe(10);
    expect(() => percentile([], 0.5)).toThrow();
  });

  it('range comes from the 25th and 75th percentiles', () => {
    const p = resolvePace({ set: [40, 60, 80, 100], changeover: [] }, NO_SAMPLES);
    expect(p.low.secondsPerSet).toBe(55);
    expect(p.high.secondsPerSet).toBe(85);
    expect(p.samples).toBe(4);
  });

  it('recentPaceSamples: last 5 finished workouts with real times; imported date-only ones skipped', () => {
    const finished: SessionAggregate[] = [];
    for (let i = 0; i < 7; i += 1) {
      let s = twoExercises(2, 1);
      const [b1, b2] = setsFor(s, BENCH);
      if (!b1 || !b2) throw new Error('fixture');
      s = apply(s, logCmd(b1.id, values(kg(100), 8), 0));
      s = apply(s, logCmd(b2.id, values(kg(100), 8), 120 + i)); // sample = i
      s = apply(s, { type: 'finish', at: at(400), opId: `f${String(i)}`, expectedVersion: s.session.version, endedAt: null });
      finished.push({ ...s, session: { ...s.session, id: `s${String(i)}`, startedAt: { ...s.session.startedAt, utc: new Date(ms(i * 86_400)).toISOString() } } });
    }
    const imported = finished[6];
    if (!imported) throw new Error('fixture');
    finished[6] = { ...imported, session: { ...imported.session, localDate: '2026-10-20' } };
    expect(recentPaceSamples(finished).set.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('buildActiveSetView carries the time left (§2.15.1)', () => {
  const view = (s: SessionAggregate, nowS: number) =>
    buildActiveSetView({ aggregate: s, nowMs: ms(nowS), gymName: null, previous: {}, painFlagged: new Set(), edits: null, recentPace: { set: [60, 60, 60], changeover: [120] } });

  it('Ready shows the estimate line with the Finish by wording from the session', () => {
    let s = twoExercises();
    expect(view(s, 0).timeLeft?.line.text).toBe(t('About 20 min left · ends about 19:20'));
    s = apply(s, { type: 'set_finish_by', at: at(0), opId: 'fb', finishBy: at(45 * 60), expectedVersion: s.session.version });
    const v = view(s, 0);
    expect(v.finishByUtc).toBe(at(45 * 60).utc);
    expect(v.timeLeft?.line.text).toBe(t('About 20 min left · on track for 19:45'));
  });

  it('hidden once all sets are done', () => {
    let s = twoExercises(1, 1);
    const [b1] = setsFor(s, BENCH);
    const [r1] = setsFor(s, ROW);
    if (!b1 || !r1) throw new Error('fixture');
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 0));
    s = apply(s, logCmd(r1.id, values(kg(50, 'stack'), 10), 200));
    const v = view(s, 200);
    expect(v.phase).toBe('all_done');
    expect(v.timeLeft).toBeNull();
  });
});

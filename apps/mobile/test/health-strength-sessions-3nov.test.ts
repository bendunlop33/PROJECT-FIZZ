import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { WORKOUT_BACKFILL_DAYS } from '../src/health/health-service';
import { FakeHealth } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 3 Nov) Real SQLite and a fake HealthKit. Ben's strength sessions logged only on Garmin come in through Apple
 * Health: one with no workout of its own counts as one session in Progress › Training (6M bars, Sessions, Time, the
 * Month calendar, Consistency); one his app workout overlaps never counts twice; Lifts and Muscles never change.
 * The first workouts read of a run goes back a year (`WORKOUT_BACKFILL_DAYS`), whatever `How far back` says.
 */

let h: Harness;
let fake: FakeHealth;
beforeEach(() => {
  h = createHarness('2026-10-01T16:00:00.000Z');
  fake = new FakeHealth();
});
afterEach(async () => {
  await h.cleanup();
});

const NOW = Date.parse('2026-11-03T12:00:00.000Z');
const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00.000Z`);

async function launch(): Promise<AppServices> {
  return (await h.launch({ health: { port: fake, buildIncludesHealth: true } })).services;
}

/** Two app workouts in October, a Garmin-only strength (Wed 14 Oct) and one overlapping the app workout of Tue 20 Oct. */
async function october(s: AppServices) {
  const gymId = await setUpGym(h, s);
  h.clockMs = at('2026-10-06', '17:00');
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
  h.clockMs = at('2026-10-20', '17:00');
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }, { load: 62.5, reps: 8 }] }]);
  const garminOnly = fake.addGarmin({ activityType: 50, startMs: at('2026-10-14', '07:00'), endMs: at('2026-10-14', '07:50'), sourceName: 'Connect' });
  // Overlaps the 20th's workout: the read pairs it with that workout.
  const overlapping = fake.addGarmin({ activityType: 50, startMs: at('2026-10-20', '17:01'), endMs: at('2026-10-20', '17:41'), sourceName: 'Connect' });
  // Garmin-only, five months back: beyond the default 8-week window.
  const june = fake.addGarmin({ activityType: 50, startMs: at('2026-06-10', '07:00'), endMs: at('2026-06-10', '07:45'), sourceName: 'Connect' });
  // A run is never a session.
  fake.addGarmin({ activityType: 37, startMs: at('2026-10-15', '07:00'), endMs: at('2026-10-15', '07:40'), distanceM: 8000, sourceName: 'Connect' });
  return { garminOnly, overlapping, june };
}

async function readHealth(s: AppServices): Promise<void> {
  await s.health.setSwitch('readActivities', true);
  await s.health.readNow();
}

const total = (v: { totals: { key: string; value: string }[] } | null | undefined, key: string) => v?.totals.find((t) => t.key === key)?.value;

describe('Garmin-only strength workouts count as sessions (Ben, 3 Nov)', () => {
  it('6M bars, Sessions, Time and the month calendar include last month’s Garmin-only one; the overlapping one isn’t counted twice; Lifts and Muscles unchanged', async () => {
    const s = await launch();
    const o = await october(s);
    h.clockMs = NOW;

    const before6m = await s.progress.training({ span: '6m', offset: 0 });
    const beforeOct = await s.progress.training({ span: 'month', offset: -1 });
    const beforeLifts = await s.progress.projected();
    const beforeMuscles = await s.progress.muscleSetsBetween('2026-10-01', '2026-10-31');
    expect(total(before6m?.view, 'sessions')).toBe('2');
    expect(total(beforeOct?.view, 'sessions')).toBe('2');

    await readHealth(s);

    // 6M: the June and October Garmin-only ones are bars (June is past the 8-week window: the back-fill read it).
    const six = await s.progress.training({ span: '6m', offset: 0 });
    expect(total(six?.view, 'sessions')).toBe('4');
    const bars = six?.view?.bars?.weeks ?? [];
    expect(bars.find((w) => w.monday === '2026-10-12')?.count).toBe(1);
    expect(bars.find((w) => w.monday === '2026-10-19')?.count).toBe(1);
    expect(bars.find((w) => w.monday === '2026-06-08')?.count).toBe(1);

    // October: Sessions 3 (the overlapping Garmin one is the 20th's workout), Time adds its 50 min, Sets unchanged.
    const oct = await s.progress.training({ span: 'month', offset: -1 });
    expect(total(oct?.view, 'sessions')).toBe('3');
    expect(total(oct?.view, 'sets')).toBe(total(beforeOct?.view, 'sets'));
    const minutes = (v: string | undefined) => {
      const m = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?/.exec((v ?? '').replace(/\u00a0/g, ' '));
      return Number(m?.[1] ?? 0) * 60 + Number(m?.[2] ?? 0);
    };
    expect(minutes(total(oct?.view, 'time')) - minutes(total(beforeOct?.view, 'time'))).toBe(50);
    expect(oct?.view?.month?.workouts.count).toBe(3);
    // The 14th: shaded, its Health ring opening its Health sheet (the activity), never a logged workout.
    const tile = oct?.view?.month?.weeks.flat().find((d) => d?.date === '2026-10-14');
    expect(tile).toMatchObject({ state: 'done', marks: [{ kind: 'ring' }], open: { kind: 'activity', activityId: o.garminOnly } });
    const act = await s.activities.get(o.garminOnly);
    expect(act?.source).toBe('health');
    // The 20th: the workout's dot only (its Garmin recording is linked to it).
    const tile20 = oct?.view?.month?.weeks.flat().find((d) => d?.date === '2026-10-20');
    expect(tile20?.marks).toEqual([{ kind: 'dot', colour: 'neutral' }]);
    expect(await s.health.forWorkout((beforeLifts?.sessions.find((x) => x.date === '2026-10-20')?.sessionId) ?? '')).toMatchObject({ kind: 'linked', healthUuid: o.overlapping });

    // Lifts and Muscles: the same workouts, the same sets.
    const afterLifts = await s.progress.projected();
    expect(afterLifts?.sessions.map((x) => x.sessionId).sort()).toEqual(beforeLifts?.sessions.map((x) => x.sessionId).sort());
    expect(await s.progress.muscleSetsBetween('2026-10-01', '2026-10-31')).toEqual(beforeMuscles);
    expect(oct?.home.view.dataState === 'normal' && beforeOct?.home.view.dataState === 'normal' ? oct.home.view.muscles : null).toEqual(beforeOct?.home.view.dataState === 'normal' ? beforeOct.home.view.muscles : null);

    // The 1Y bar steps back to the Garmin-only June too (it is before the first app workout).
    const shell = await s.progress.shell({ span: 'month', offset: -4 });
    expect(shell?.bar.canBack).toBe(true);
  });

  it('Consistency counts it in its week, never as a plan day', async () => {
    const s = await launch();
    await october(s);
    h.clockMs = NOW;
    await readHealth(s);
    const c = await s.plans.consistency();
    const week = c?.weeks.find((w) => w.monday === '2026-10-12');
    expect(week?.workouts).toBe(1);
    expect(c?.weeks.find((w) => w.monday === '2026-10-19')?.workouts).toBe(1);
  });

  it('back-fill: the first read of a run goes back a year; later reads that run read the window; a restart reads a year again', async () => {
    const s = await launch();
    const o = await october(s);
    h.clockMs = NOW;
    const since: number[] = [];
    const read = fake.readWorkouts.bind(fake);
    fake.readWorkouts = (from: number, until: number, hr: boolean) => {
      since.push(from);
      return read(from, until, hr);
    };
    await readHealth(s);
    expect(WORKOUT_BACKFILL_DAYS).toBe(365);
    expect(since[0]).toBe(NOW - 365 * 86_400_000);
    // Later reads this run: the 8-week window; June stays stored (a read replaces only its own window).
    h.clockMs = NOW + 3_600_000;
    await s.health.readNow();
    expect(since.at(-1)).toBe(NOW + 3_600_000 - 56 * 86_400_000);
    expect(total((await s.progress.training({ span: '6m', offset: 0 }))?.view, 'sessions')).toBe('4');
    // Idempotent: reading the year again stores the same samples once.
    await h.forceClose();
    const s2 = await launch();
    fake.readWorkouts = (from: number, until: number, hr: boolean) => {
      since.push(from);
      return read(from, until, hr);
    };
    h.clockMs = NOW + 7_200_000;
    await s2.health.readNow();
    expect(since.at(-1)).toBe(NOW + 7_200_000 - 365 * 86_400_000);
    const six = await s2.progress.training({ span: '6m', offset: 0 });
    expect(total(six?.view, 'sessions')).toBe('4');
    expect(six?.view?.bars?.weeks.find((w) => w.monday === '2026-06-08')?.count).toBe(1);
    expect(o.june).toBeDefined();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { FakeHealth } from './fake-health';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 8 Nov) Real SQLite and a fake HealthKit. The monthly recap's Workouts, the weekly review's `week_sessions`
 * and the coach's week view count a Garmin-only strength workout as Progress › Training does: one an app workout
 * overlaps is that workout (never twice), one Ben marked `Not it` stays uncounted, and nothing about lifts or
 * muscles changes. A review stored before the Health read keeps its counts.
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

const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00.000Z`);

async function launch(): Promise<AppServices> {
  return (await h.launch({ health: { port: fake, buildIncludesHealth: true } })).services;
}

async function readHealth(s: AppServices): Promise<void> {
  await s.health.setSwitch('readActivities', true);
  await s.health.readNow();
}

const total = (v: { totals: { key: string; value: string }[] } | null | undefined, key: string) => v?.totals.find((t) => t.key === key)?.value;

describe('Garmin-only strength sessions in the recap, the weekly review and the coach’s week (Ben, 8 Nov)', () => {
  it('monthly recap: Workouts and Time count the Garmin-only one, the overlapping one once, `Not it` never; muscles and lifts unchanged', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    h.clockMs = at('2026-10-06', '17:00');
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    h.clockMs = at('2026-10-20', '17:00');
    const tuesday = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }, { load: 62.5, reps: 8 }] }]);
    fake.addGarmin({ activityType: 50, startMs: at('2026-10-14', '07:00'), endMs: at('2026-10-14', '07:50'), sourceName: 'Connect' });
    fake.addGarmin({ activityType: 50, startMs: at('2026-10-20', '17:01'), endMs: at('2026-10-20', '17:41'), sourceName: 'Connect' });
    const notIt = fake.addGarmin({ activityType: 50, startMs: at('2026-10-22', '07:00'), endMs: at('2026-10-22', '07:40'), sourceName: 'Connect' });

    h.clockMs = at('2026-11-03', '12:00');
    const before = (await s.progress.recap())?.view;
    expect(before?.stats[0]).toMatchObject({ label: 'Workouts', value: '2' });

    await readHealth(s);
    expect((await s.health.notIt({ healthUuid: notIt, sessionId: tuesday, opId: 'not-it' })).ok).toBe(true);

    const after = (await s.progress.recap())?.view;
    expect(after?.stats[0]).toMatchObject({ label: 'Workouts', value: '3' });
    // The same as Progress › Training's October.
    const oct = await s.progress.training({ span: 'month', offset: -1 });
    expect(total(oct?.view, 'sessions')).toBe('3');
    expect(after?.stats[1]?.value).not.toBe(before?.stats[1]?.value);
    expect(after?.muscles).toEqual(before?.muscles);
    expect(after?.lifts).toEqual(before?.lifts);
  });

  it('weekly review: `week_sessions` counts it (no plan, no aim: workouts); a review stored before the read keeps its counts', async () => {
    const s = await launch();
    const gymId = await setUpGym(h, s);
    // The reviewed week: Mon 26 Oct – Sun 1 Nov. One app workout; the Garmin-only one on Wed 28 Oct.
    h.clockMs = at('2026-10-27', '17:00');
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    fake.addGarmin({ activityType: 50, startMs: at('2026-10-28', '07:00'), endMs: at('2026-10-28', '07:50'), sourceName: 'Connect' });
    fake.addGarmin({ activityType: 50, startMs: at('2026-10-27', '17:02'), endMs: at('2026-10-27', '17:40'), sourceName: 'Connect' });

    h.clockMs = at('2026-11-02', '08:00');
    const first = await s.reviews.runOnOpen();
    if (first.kind === 'nothing' || first.kind === 'failed') throw new Error(first.kind);
    const stored = first.review.facts.find((f) => f.kind === 'week_sessions' && f.weekMonday === '2026-10-26');
    expect(stored).toMatchObject({ done: 1, workouts: 1 });

    await readHealth(s);
    const second = await s.reviews.runOnOpen();
    if (second.kind === 'nothing' || second.kind === 'failed') throw new Error(second.kind);
    const fact = second.review.facts.find((f) => f.kind === 'week_sessions' && f.weekMonday === '2026-10-26');
    expect(fact).toMatchObject({ done: 2, planned: null, workouts: 2 });
    // The review stored before is still readable (Past weeks).
    expect(await s.reviews.review(first.review.id)).not.toBeNull();
  });

  it('the coach’s week view: a Garmin-only strength workout this week is a gym day', async () => {
    const s = await launch();
    await setUpGym(h, s);
    fake.addGarmin({ activityType: 50, startMs: at('2026-11-02', '07:00'), endMs: at('2026-11-02', '07:50'), sourceName: 'Connect' });
    h.clockMs = at('2026-11-03', '12:00');
    expect((await s.week.contextView())?.gymDaysDone).toBe(0);
    await readHealth(s);
    expect((await s.week.contextView())?.gymDaysDone).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Progress slice A through the app services (progress.md §6.2, §8): the home
 * view model, settings, recompute after corrections, `Count it` (idempotent,
 * versioned, Undo, survives a relaunch), the calendar and the ResumeBar.
 * Everything is local; no coach or network is wired here at all (check 20).
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-05T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;
const HOUR = 3_600_000;

async function setUp() {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  return { s, gymId: gym.ok ? (gym.gymId ?? '') : '' };
}

async function normal(s: AppServices, req: Parameters<AppServices['progress']['home']>[0] = {}) {
  const home = await s.progress.home(req);
  if (home?.view.dataState !== 'normal') throw new Error('expected normal');
  return { ...home, view: home.view };
}

describe('Progress home through the services', () => {
  it('empty until a workout is finished; then sessions, muscles and the window are counted; settings are remembered', async () => {
    const { s, gymId } = await setUp();
    expect((await s.progress.home())?.view).toEqual({ dataState: 'empty' });

    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8, rpe: 5 }] }]);
    h.clockMs += 2 * DAY;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 62.5, reps: 8 }] }]);

    const home = await normal(s);
    expect(home.period).toBe('1m');
    expect(home.grouping).toBe('body_part');
    expect(home.view.activity.stats[0]).toEqual({ value: '2', label: 'SESSIONS' });
    const chest = home.view.muscles.rows.find((r) => r.key === 'Chest');
    expect(chest).toMatchObject({ sessions: 2, sets: 3 });
    expect(home.view.muscles.notCounted.summary).toBe('1 rated under RPE 6');
    expect(home.unreadable).toBe(0);
    expect(home.resume).toBeNull();

    expect(await s.progress.saveSettings({ period: '3m', grouping: 'ppl' })).toEqual({ ok: true });
    const again = await normal(s);
    expect(again.period).toBe('3m');
    expect(again.grouping).toBe('ppl');
    expect(again.view.muscles.rows.map((r) => r.label)).toEqual(['Push', 'Pull', 'Legs', 'Core']);
    // An explicit window wins over the saved one.
    expect((await normal(s, { period: '1y' })).view.windowLabel).toBe('1 year');
  });

  it('an unfinished workout is never counted and shows the ResumeBar; a correction recomputes on the next read', async () => {
    const { s, gymId } = await setUp();
    const done = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const before = await normal(s);
    expect(before.view.muscles.rows.find((r) => r.key === 'Chest')?.sets).toBe(1);

    // Correct the set to RPE 5: it no longer counts (check 22).
    const agg = (await s.workout.load(done))?.aggregate;
    const set = agg?.sets.find((x) => x.status === 'completed');
    if (!set) throw new Error('no set');
    const corrected = await s.workout.dispatch(done, { type: 'correct_set', at: h.now(), opId: 'fix-1', setId: set.id, expectedSetVersion: set.version, patch: { rpe: 5 } });
    expect(corrected.ok).toBe(true);
    const after = await normal(s);
    expect(after.view.muscles.rows.find((r) => r.key === 'Chest')?.sets).toBe(0);
    expect(after.view.muscles.notCounted.summary).toBe('1 rated under RPE 6');

    const started = await s.workout.start({ gymId, opId: 'start-open', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const open = await normal(s);
    expect(open.view.activity.stats[0]?.value).toBe('1');
    expect(open.resume).toMatchObject({ sessionId: started.aggregate.session.id, state: 'ready' });
    const cal = await s.progress.calendar();
    expect(cal?.view.days[cal.view.month + '-05']?.map((r) => r.kind)).toEqual(['finished', 'in_progress']);
  });

  it('Count it: a long workout is left out of time, Count it adds it, a retry is a duplicate, a stale sheet is refused, Undo removes it, and it survives a relaunch', async () => {
    const { s, gymId } = await setUp();
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    h.clockMs += DAY;
    // A workout left open: 5 h 12 min from start to Finish.
    const started = await s.workout.start({ gymId, opId: 'start-long', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const longId = started.aggregate.session.id;
    h.clockMs += 5 * HOUR + 12 * 60_000;
    const v = (await s.workout.load(longId))?.aggregate.session.version ?? 0;
    expect((await s.workout.dispatch(longId, { type: 'finish', at: h.now(), opId: 'fin-long', expectedVersion: v, endedAt: null })).ok).toBe(true);
    await h.settle(s);

    const home = await normal(s, { period: '3m' });
    expect(home.view.activity.footnote).toBe('Time from 1 of 2 sessions');
    const row = home.view.activity.sheet.overCap[0];
    expect(row?.sessionId).toBe(longId);
    if (!row) throw new Error('no over-cap row');

    const req = { sessionId: row.sessionId, expectedVersion: row.version, opId: 'count-1' };
    const counted = await s.progress.confirmDuration(req);
    if (!counted.ok) throw new Error(counted.message);
    expect(await s.progress.confirmDuration(req)).toMatchObject({ ok: true });
    expect(await s.progress.confirmDuration({ ...req, opId: 'count-2' })).toMatchObject({ ok: false });
    const withIt = await normal(s, { period: '3m' });
    expect(withIt.view.activity.footnote).toBeNull();
    expect(withIt.view.activity.sheet.overCap).toEqual([]);

    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await normal(s2, { period: '3m' })).view.activity.footnote).toBeNull();
    const undone = await s2.progress.undoConfirmDuration({ sessionId: longId, expectedVersion: counted.version, opId: 'undo-1' });
    expect(undone.ok).toBe(true);
    expect((await normal(s2, { period: '3m' })).view.activity.footnote).toBe('Time from 1 of 2 sessions');
  });
});

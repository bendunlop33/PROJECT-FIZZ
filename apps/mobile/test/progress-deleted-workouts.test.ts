import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Progress and deleted workouts (delete-workouts §5, DW10–DW19; progress.md
 * §6): a deleted workout leaves every Progress number (sessions per window,
 * time in gym, muscle frequency, records, Est. 1RM, the calendar and the
 * Exercises list) and comes back exactly on Restore.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-05T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const HOUR = 3_600_000;

async function setUp() {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  return { s, gymId: gym.ok ? (gym.gymId ?? '') : '' };
}

async function normal(s: AppServices) {
  const home = await s.progress.home({ days: 30, grouping: 'body_part' });
  if (home?.view.dataState !== 'normal') throw new Error('expected normal');
  return home.view;
}

/** What the home counts, without the window's dates (the clock moves between reads). */
async function counted(s: AppServices) {
  const v = await normal(s);
  return { stats: v.activity.stats, sheet: v.activity.sheet, muscles: v.muscles, records: v.records };
}

async function deleteOne(s: AppServices, sessionId: string, opId: string) {
  const row = await s.repeat.describeById(sessionId);
  if (!row) throw new Error('no row');
  const out = await s.history.deleteWorkouts([{ sessionId, expectedVersion: row.version }], opId);
  if (!out.ok) throw new Error(out.message);
  return out.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version }));
}

describe('Progress leaves a deleted workout out, and has it back on Restore', () => {
  it('sessions per window, time in gym, muscle frequency, records, Est. 1RM, the calendar and the Exercises list', async () => {
    const { s, gymId } = await setUp();
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    const onlyFirst = await counted(s);
    h.clockMs += 3 * HOUR;
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 5 }, { load: 80, reps: 5 }, { load: 80, reps: 5 }] }]);

    const both = await counted(s);
    expect(both.stats[0]).toEqual({ value: '2', label: 'SESSIONS' });
    expect(both.muscles.rows.find((r) => r.key === 'Chest')).toMatchObject({ sessions: 2, sets: 5 });
    expect(both).not.toEqual(onlyFirst);
    const exerciseId = (await s.progress.exercises())?.view.rows[0]?.exerciseId ?? '';
    const detailBoth = (await s.progress.exerciseDetail({ exerciseId }))?.view;
    expect(detailBoth?.points).toHaveLength(2);
    const calBoth = await s.progress.calendar();
    expect(calBoth?.view.days[calBoth.view.month + '-05']?.map((r) => r.kind)).toEqual(['finished', 'finished']);
    const listBoth = (await s.progress.exercises())?.view.rows.map((r) => r.line);

    const undo = await deleteOne(s, second, 'del-1');

    // Sessions, time, muscles and records are exactly as before the deleted workout was logged.
    const without = await counted(s);
    expect(without.stats[0]).toEqual({ value: '1', label: 'SESSIONS' });
    expect(without.muscles.rows.find((r) => r.key === 'Chest')).toMatchObject({ sessions: 1, sets: 2 });
    expect(without).toEqual(onlyFirst);
    // Records and Est. 1RM on exercise detail: only the first workout's 60 kg sets.
    const detailWithout = (await s.progress.exerciseDetail({ exerciseId }))?.view;
    expect(detailWithout?.points).toHaveLength(1);
    expect(detailWithout?.points.map((p) => p.sessionId)).not.toContain(second);
    expect(JSON.stringify(detailWithout?.records ?? null)).not.toMatch(/80/);
    expect(JSON.stringify(detailWithout?.points ?? null)).not.toMatch(/\b80\b/);
    const calWithout = await s.progress.calendar();
    expect(calWithout?.view.days[calWithout.view.month + '-05']?.map((r) => r.kind)).toEqual(['finished']);
    expect(JSON.stringify(calWithout?.view)).not.toContain(second);
    expect((await s.progress.exercises())?.view.rows.map((r) => r.line)).not.toEqual(listBoth);

    expect((await s.history.restoreWorkouts(undo, 'restore-1')).ok).toBe(true);
    expect(await counted(s)).toEqual(both);
    expect((await s.progress.exerciseDetail({ exerciseId }))?.view?.points).toEqual(detailBoth?.points);
    expect((await s.progress.exerciseDetail({ exerciseId }))?.view?.records).toEqual(detailBoth?.records);
    expect((await s.progress.calendar())?.view).toEqual(calBoth?.view);
    expect((await s.progress.exercises())?.view.rows.map((r) => r.line)).toEqual(listBoth);
  });

  it('deleting the only workout empties the home; Restore brings it back', async () => {
    const { s, gymId } = await setUp();
    const only = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const before = await counted(s);
    const undo = await deleteOne(s, only, 'del-only');
    expect((await s.progress.home())?.view).toEqual({ dataState: 'empty' });
    expect((await s.progress.exercises())?.view.empty).toBe(true);
    expect((await s.history.restoreWorkouts(undo, 'restore-only')).ok).toBe(true);
    expect(await counted(s)).toEqual(before);
  });
});

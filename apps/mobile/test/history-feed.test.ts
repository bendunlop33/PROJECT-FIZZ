import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HISTORY_PAGE_WEEKS } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 26 Oct: "the app isn't very good at showing recent activity beyond the last couple of days") Today's Recent
 * and History, end to end on real SQLite: workouts and activities merged, newest first; planned activities left out;
 * a deleted workout leaves and comes back with Undo; paging by week skips a long gap; a retried activity add (same
 * operation ID) is listed once; the same list after a force-close.
 */

let h: Harness;
beforeEach(() => {
  // Thursday 1 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-01T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const at = (iso: string) => {
  h.clockMs = Date.parse(iso);
};
const bench = [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] }];

async function seed(s: AppServices): Promise<{ gymId: string; workouts: Record<string, string> }> {
  const gymId = await setUpGym(h, s);
  const workouts: Record<string, string> = {};
  // An old workout in May, then nothing until October (a long gap).
  at('2026-05-05T07:00:00.000Z');
  workouts.may = await logWorkout(h, s, gymId, bench);
  for (const day of ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-24', '2026-10-26']) {
    at(`${day}T17:00:00.000Z`);
    workouts[day] = await logWorkout(h, s, gymId, bench);
  }
  return { gymId, workouts };
}

describe('Today › Recent and History (Ben, 26 Oct)', () => {
  it('Recent: the last 14 days, workouts and done activities merged, newest first, at most 6', async () => {
    const { services: s } = await h.launch();
    const { workouts } = await seed(s);
    at('2026-10-27T08:00:00.000Z');
    expect(await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'done', date: '2026-10-25', durationS: 28 * 60, distanceM: 5200, effort: null }, opId: 'run-25' })).toMatchObject({ ok: true });
    expect(await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'planned', date: '2026-10-29', durationS: null, distanceM: null, effort: 'long' }, opId: 'run-29' })).toMatchObject({ ok: true });
    expect(await s.activities.add({ id: h.ids(), fields: { kind: 'ride', status: 'planned', date: '2026-10-22', durationS: 3600, distanceM: null, effort: null }, opId: 'ride-22' })).toMatchObject({ ok: true });
    const data = await s.todaySession.load();
    if (data === null) throw new Error('no data');
    // 13 Oct to 27 Oct: the 26th, the run on the 25th, the 24th, the 19th; not the 12th (15 days back); no planned ones.
    expect(data.recent.map((r) => `${r.kind}:${r.localDate}`)).toEqual(['workout:2026-10-26', 'activity:2026-10-25', 'workout:2026-10-24', 'workout:2026-10-19']);
    const first = data.recent[0];
    expect(first?.kind === 'workout' ? first.sessionId : null).toBe(workouts['2026-10-26']);
    expect(first?.value.replaceAll(' ', ' ')).toMatch(/^\d+ min · 2 sets$/);
    expect(data.recent[1]?.value.replaceAll(' ', ' ')).toBe('5.2 km · 28 min');
  });

  it('a retried activity add (same op) is listed once; a force-close shows the same list', async () => {
    const launched = await h.launch();
    const s = launched.services;
    await seed(s);
    at('2026-10-27T08:00:00.000Z');
    const id = h.ids();
    const add = { id, fields: { kind: 'run' as const, status: 'done' as const, date: '2026-10-27', durationS: null, distanceM: 10_000, effort: null }, opId: 'run-27' };
    expect(await s.activities.add(add)).toMatchObject({ ok: true, duplicate: false });
    expect(await s.activities.add(add)).toMatchObject({ ok: true, duplicate: true });
    const before = await s.history.feed();
    expect(before.items.filter((i) => i.kind === 'activity')).toHaveLength(1);
    await h.forceClose();
    const { services: again } = await h.launch();
    const after = await again.history.feed();
    expect(after.items.map((i) => i.key)).toEqual(before.items.map((i) => i.key));
    expect((await again.todaySession.load())?.recent.map((r) => r.key)).toEqual(before.items.filter((i) => i.localDate >= '2026-10-14').map((i) => i.key));
  });

  it('History: this week and the five before it; each listed workout has its row; Show more skips the gap', async () => {
    const { services: s } = await h.launch();
    const { workouts } = await seed(s);
    at('2026-10-27T08:00:00.000Z');
    const page = await s.history.feed();
    expect(page.from).toBe('2026-09-21');
    expect(page.items.map((i) => i.localDate)).toEqual(['2026-10-26', '2026-10-24', '2026-10-19', '2026-10-12', '2026-10-05']);
    for (const i of page.items) if (i.kind === 'workout') expect(page.workouts[i.sessionId]).toMatchObject({ sessionId: i.sessionId, gymName: 'Main Gym', sets: 2 });
    // Nothing between 10 Aug and 21 Sep: the next page reaches May's workout.
    expect(page.olderFrom).not.toBeNull();
    const older = await s.history.feed({ from: page.olderFrom ?? '' });
    expect(older.items.map((i) => i.kind === 'workout' && i.sessionId)).toContain(workouts.may);
    expect(older.olderFrom).toBeNull();
    expect(HISTORY_PAGE_WEEKS).toBe(6);
  });

  it('a deleted workout leaves History and Recent, and comes back with Undo (restore)', async () => {
    const { services: s } = await h.launch();
    const { workouts } = await seed(s);
    at('2026-10-27T08:00:00.000Z');
    const target = workouts['2026-10-24'] ?? '';
    const row = (await s.history.feed()).workouts[target];
    if (row === undefined) throw new Error('not listed');
    const del = await s.history.deleteWorkouts([{ sessionId: target, expectedVersion: row.version }], 'del-1');
    if (!del.ok) throw new Error(del.message);
    expect((await s.history.feed()).items.some((i) => i.kind === 'workout' && i.sessionId === target)).toBe(false);
    expect((await s.todaySession.load())?.recent.some((i) => i.kind === 'workout' && i.sessionId === target)).toBe(false);
    // A stale delete (an old version) changes nothing.
    const again = await s.history.deleteWorkouts([{ sessionId: target, expectedVersion: row.version }], 'del-2');
    expect(again.ok).toBe(false);
    const restored = await s.history.restoreWorkouts(del.refs.map((r) => ({ sessionId: r.sessionId, expectedVersion: r.version })), 'undo-1');
    expect(restored.ok).toBe(true);
    expect((await s.history.feed()).items.some((i) => i.kind === 'workout' && i.sessionId === target)).toBe(true);
  });
});

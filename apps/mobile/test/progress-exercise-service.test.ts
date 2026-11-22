import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCoachContext, describeCoachContext } from '@fizz/coach';

import { seesLabel, starterChips } from '../src/coach/sheet-view';
import { createHarness, logWorkout, type Harness } from './harness';

/**
 * Progress slice B through the app services (progress.md §2.6, §2.7, §6.2):
 * the Exercises list and exercise detail from stored workouts, a marked set
 * recomputing on the next read, the pain line, remembered choices, opening on
 * a workout, and the same numbers after a relaunch. Local only: no coach or
 * network is wired here (check 41).
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-01T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const DAY = 86_400_000;
const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');

async function setUp() {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  return { s, gymId: gym.ok ? (gym.gymId ?? '') : '' };
}

describe('Exercises list and exercise detail through the services', () => {
  it('lists the exercise, builds the detail, recomputes after a set is marked, and shows the pain line', async () => {
    const { s, gymId } = await setUp();
    expect((await s.progress.exercises())?.view.empty).toBe(true);
    const ids: string[] = [];
    for (const [load, reps] of [
      [60, 8],
      [62.5, 8],
      [65, 6],
      [65, 8],
    ] as const) {
      ids.push(await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load, reps }] }]));
      h.clockMs += 2 * DAY;
    }
    const list = (await s.progress.exercises())?.view;
    expect(list?.rows.map((r) => [r.name, sp(r.line)])).toEqual([['Bench press', '4 sessions · last 7 Oct']]);
    const exerciseId = list?.rows[0]?.exerciseId ?? '';

    const detail = (await s.progress.exerciseDetail({ exerciseId }))?.view;
    if (!detail) throw new Error('detail');
    expect(detail.metric).toBe('e1rm');
    expect(detail.points.map((p) => sp(p.display))).toEqual(['≈76 kg', '≈79 kg', '≈78 kg', '≈82.5 kg']);
    // (Ben, 26 Oct) Records are the tracked lift's New bests, exactly as each Summary judged them: bench is a default
    // tracked lift at his newest top set's reps (as of each workout), so 65 × 6 was one when it was logged.
    expect(detail.records?.items.map((r) => [r.label, sp(r.value)])).toEqual([
      ['New best', '65 kg × 8'],
      ['New best', '65 kg × 6'],
      ['New best', '62.5 kg × 8'],
    ]);
    expect(detail.pain).toBeNull();
    const version = (await s.reviews.progress())?.trainingVersion ?? 1;
    expect(await s.training.change({ kind: 'progress_lifts', exerciseIds: [exerciseId], reps: { [exerciseId]: 8 } }, version, 'lifts-1')).toMatchObject({ ok: true });
    const tracked = (await s.progress.exerciseDetail({ exerciseId }))?.view;
    // 62.5 × 8 and 65 × 8 beat everything before at 8 reps; 65 × 6 is short of 8 (no estimate counts).
    expect(tracked?.records?.items.map((r) => [r.label, sp(r.value)])).toEqual([
      ['New best', '65 kg × 8'],
      ['New best', '62.5 kg × 8'],
    ]);
    // The Summary says the same of each workout.
    expect((await s.reviews.sessionBests(ids[3] ?? '')).map((b) => sp(b.text))).toEqual(['New best · Bench press 65 × 8']);
    expect(await s.reviews.sessionBests(ids[2] ?? '')).toEqual([]);

    // Mark the last set `Pain`: no point, `Not counted`, history says so, and the pain line appears (PG21, check 32).
    const last = (await s.workout.load(ids[3] ?? ''))?.aggregate.sets.find((x) => x.status === 'completed');
    if (!last) throw new Error('no set');
    const marked = await s.workout.correctSet({ sessionId: ids[3] ?? '', setId: last.id, expectedSetVersion: last.version, patch: { exclusions: ['pain'] }, opId: 'mark-pain' });
    expect(marked.ok).toBe(true);
    const after = (await s.progress.exerciseDetail({ exerciseId }))?.view;
    expect(after?.points).toHaveLength(3);
    expect(after?.markers.map((m) => m.label)).toContain('Not counted');
    expect(after?.history.months[0]?.rows[0]?.sets).toBe('65×8 (pain)');
    expect(after?.records?.items.map((r) => sp(r.value))).toEqual(['62.5 kg × 8']);
    expect(sp(after?.pain?.text)).toBe('Pain flag since 9 Oct'); // flagged when marked, today
  });

  it('(Ben, 26 Oct) a lift that isn’t tracked has no RECORDS, however much heavier it gets; picking it on Overview gives it its New bests', async () => {
    const { s, gymId } = await setUp();
    const ids: string[] = [];
    for (const load of [10, 12.5, 15]) {
      ids.push(await logWorkout(h, s, gymId, [{ exercise: 'Dumbbell curl', sets: [{ load, reps: 10 }] }]));
      h.clockMs += 2 * DAY;
    }
    const curl = (await s.progress.exercises())?.view.rows.find((r) => r.name === 'Dumbbell curl')?.exerciseId ?? '';
    expect((await s.reviews.progress())?.lifts.lifts.some((l) => l.exerciseId === curl)).toBe(false);
    expect((await s.progress.exerciseDetail({ exerciseId: curl }))?.view?.records).toBeNull();
    expect(await s.reviews.sessionBests(ids[2] ?? '')).toEqual([]);
    const home = await s.progress.home({ period: '3m' });
    expect(home?.view.dataState === 'normal' ? home.view.records.items : null).toEqual([]);
    const version = (await s.reviews.progress())?.trainingVersion ?? 1;
    expect(await s.training.change({ kind: 'progress_lifts', exerciseIds: [curl], reps: { [curl]: 10 } }, version, 'lifts-curl')).toMatchObject({ ok: true });
    const tracked = (await s.progress.exerciseDetail({ exerciseId: curl }))?.view?.records?.items.map((r) => [r.sessionId, sp(r.value)]);
    expect(tracked).toEqual([
      [ids[2], '15 kg each × 10'],
      [ids[1], '12.5 kg each × 10'],
    ]);
    expect((await s.reviews.sessionBests(ids[2] ?? '')).map((b) => sp(b.text))).toEqual(['New best · Dumbbell curl 15 each × 10']);
  });

  it('remembers the metric and range per exercise; opening on a workout selects it; a relaunch keeps the data and resets the choices', async () => {
    const { s, gymId } = await setUp();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60 + i * 2.5, reps: 5 }] }]));
      h.clockMs += 3 * DAY;
    }
    const exerciseId = (await s.progress.exercises())?.view.rows[0]?.exerciseId ?? '';
    expect((await s.progress.exerciseDetail({ exerciseId, metric: 'top_set', range: '3m' }))?.view?.metric).toBe('top_set');
    const again = (await s.progress.exerciseDetail({ exerciseId }))?.view;
    expect([again?.metric, again?.range]).toEqual(['top_set', '3m']);
    const opened = (await s.progress.exerciseDetail({ exerciseId, sessionId: ids[1] ?? '' }))?.view;
    expect(opened?.selectedSessionId).toBe(ids[1]);
    expect(sp(opened?.points[1]?.display)).toBe('62.5 kg × 5');

    // Relaunch (force-close): the same history, the default choices.
    const { services: s2 } = await h.launch();
    const fresh = (await s2.progress.exerciseDetail({ exerciseId }))?.view;
    expect([fresh?.metric, fresh?.range]).toEqual(['e1rm', '6m']);
    expect(fresh?.points).toHaveLength(3);
  });
});

describe('Opening on an old workout is not remembered (review progress-B r2 S2)', () => {
  it('the widened range and opened series hold across refetches, then the exercise opens from home on the remembered range', async () => {
    const { s, gymId } = await setUp();
    const old = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 5 }] }]);
    h.clockMs += 400 * DAY;
    for (let i = 0; i < 3; i += 1) {
      await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 70 + i * 2.5, reps: 5 }] }]);
      h.clockMs += 2 * DAY;
    }
    const exerciseId = (await s.progress.exercises())?.view.rows[0]?.exerciseId ?? '';

    // Opened from that workout's Summary: widened to `All`, its point selected.
    const opened = (await s.progress.exerciseDetail({ exerciseId, sessionId: old }))?.view;
    if (!opened) throw new Error('view');
    expect([opened.range, opened.selectedSessionId]).toEqual(['all', old]);

    // The screen's refetch (back from `Open workout ›`): the opening's choices as non-remembered fields.
    const refocus = (await s.progress.exerciseDetail({ exerciseId, openedSeriesId: opened.seriesId, openedRange: opened.range, selectSessionId: old }))?.view;
    expect([refocus?.range, refocus?.seriesId, refocus?.selectedSessionId]).toEqual(['all', opened.seriesId, old]);

    // Opened again from home or the Exercises list: the default range, not `All`.
    expect((await s.progress.exerciseDetail({ exerciseId }))?.view?.range).toBe('6m');

    // Ben's own range choice is still remembered, and an opening doesn't overwrite it.
    await s.progress.exerciseDetail({ exerciseId, range: '3m' });
    await s.progress.exerciseDetail({ exerciseId, sessionId: old });
    await s.progress.exerciseDetail({ exerciseId, openedSeriesId: opened.seriesId, openedRange: 'all' });
    expect((await s.progress.exerciseDetail({ exerciseId }))?.view?.range).toBe('3m');
  });
});

describe('Ask from exercise detail (§2.1, §4.4)', () => {
  const entry = { kind: 'progress_exercise' as const, exerciseName: 'Bench press', seriesLabel: 'Main Gym · Barbell', from: '2026-04-09', to: '2026-10-08' };

  it('frames the general thread with the exercise, series and range; no numbers, no canned chips', async () => {
    expect(seesLabel(entry, null, false)).toBe('Sees: Bench press · Main Gym · Barbell');
    expect(starterChips(entry, { status: 'ok', model: 'm' }, false)).toEqual([]);
    const openedFrom = { screen: 'progress_exercise' as const, exercise: 'Bench press', series: 'Main Gym · Barbell', range: { from: '2026-04-09', to: '2026-10-08' } };
    const ctx = buildCoachContext({ turnKind: 'general', session: null, gymName: null, painFlags: [], checkIn: null, memories: [], thread: [], catalogue: [], openedFrom });
    expect(ctx.yourData.openedFrom).toEqual(openedFrom);
    expect(describeCoachContext(ctx).yourData).toContainEqual({ label: 'Opened from', detail: 'Progress · Bench press · Main Gym · Barbell' });
    const { s } = await setUp();
    expect((await s.coach.describe(entry, null)).yourData).toContainEqual({ label: 'Opened from', detail: 'Progress · Bench press · Main Gym · Barbell' });
  });
});

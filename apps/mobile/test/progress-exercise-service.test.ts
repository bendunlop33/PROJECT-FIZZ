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
    expect(detail.records.items.map((r) => sp(r.label))).toEqual(['Most reps at 65 kg', 'Best Est. 1RM']);
    expect(detail.pain).toBeNull();

    // Mark the last set `Pain`: no point, `Not counted`, history says so, and the pain line appears (PG21, check 32).
    const last = (await s.workout.load(ids[3] ?? ''))?.aggregate.sets.find((x) => x.status === 'completed');
    if (!last) throw new Error('no set');
    const marked = await s.workout.correctSet({ sessionId: ids[3] ?? '', setId: last.id, expectedSetVersion: last.version, patch: { exclusions: ['pain'] }, opId: 'mark-pain' });
    expect(marked.ok).toBe(true);
    const after = (await s.progress.exerciseDetail({ exerciseId }))?.view;
    expect(after?.points).toHaveLength(3);
    expect(after?.markers.map((m) => m.label)).toContain('Not counted');
    expect(after?.history.months[0]?.rows[0]?.sets).toBe('65×8 (pain)');
    expect(after?.records.items).toEqual([]);
    expect(sp(after?.pain?.text)).toBe('Pain flag since 9 Oct'); // flagged when marked, today
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

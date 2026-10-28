import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SummaryScreen } from '../../src/screens/workout/SummaryScreen';
import { WorkoutScreen } from '../../src/screens/workout/WorkoutScreen';
import { finishWorkout } from '../finish-workout';
import type { Harness } from '../harness';
import { expectHealthy, renderScreen } from './render-screen';
import { benWithHistory, harness, startPlanDay, withPlan } from './seed';

/**
 * The active workout and its Summary, rendered (ADR 0037). The workout's first frame is its loading state and the
 * next its loaded one: the exact transition that closed the app on every Start on 27 Oct, when a hook sat below the
 * screen's early returns ("Rendered more hooks than during the previous render").
 */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('Workout', () => {
  it('an empty workout: loading, then the table and Add exercise', async () => {
    const ben = await benWithHistory(h);
    const started = await ben.s.workout.start({ gymId: ben.gymId, opId: h.ids(), checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes('No exercises yet'));
    expect(r.firstText).not.toContain('No exercises yet');
    expect(r.text()).toContain('Finish');
    expectHealthy(r);
    await r.unmount();
  });

  it('a plan day: loading, then its exercises with planned sets', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben);
    const sessionId = await startPlanDay(h, ben);
    const loaded = await ben.s.workout.load(sessionId);
    const dayName = loaded?.aggregate.session.routineName;
    if (dayName == null || (loaded?.aggregate.exercises.length ?? 0) === 0) throw new Error('no plan day');
    const r = await renderScreen(h, ben.launched, WorkoutScreen, { name: 'Workout' }, (t) => t.includes(dayName) && t.includes('PREVIOUS'));
    expect(r.firstText).not.toContain(dayName);
    expect(r.text()).not.toContain('No exercises yet');
    expect(r.text()).toContain('＋ Set');
    expectHealthy(r);
    await r.unmount();
  });
});

describe('Summary', () => {
  it('a finished plan day: loading, then its exercises and sets', async () => {
    const ben = await benWithHistory(h);
    await withPlan(h, ben);
    const sessionId = await startPlanDay(h, ben);
    await finishWorkout(h, ben.s, sessionId);
    const dayName = (await ben.s.workout.load(sessionId))?.aggregate.session.routineName ?? 'no day';
    const r = await renderScreen(h, ben.launched, SummaryScreen, { name: 'Summary', params: { sessionId, justFinished: true } }, (t) => t.includes(dayName) && t.includes('Exercises'));
    expect(r.firstText).not.toContain(dayName);
    expectHealthy(r);
    await r.unmount();
  });
});

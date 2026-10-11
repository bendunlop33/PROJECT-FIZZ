import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { workTimerText } from '../src/workout/cues';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Timed exercises (planks, hangs; active-workout §2.7) through the app's
 * services on real SQLite: the picker offers them, `Start` runs the work
 * timer, `Stop` leaves the time so far to log, and Log saves it.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('work timer text', () => {
  it('counts down in m:ss, rounding up, never below 0:00', () => {
    expect(workTimerText(45_000)).toBe('0:45');
    expect(workTimerText(37_200)).toBe('0:38');
    expect(workTimerText(400)).toBe('0:01');
    expect(workTimerText(0)).toBe('0:00');
    expect(workTimerText(-5)).toBe('0:00');
    expect(workTimerText(null)).toBe('0:00');
    expect(workTimerText(90_000)).toBe('1:30');
  });
});

describe('timed sets end to end', () => {
  it('the picker offers Plank; Start → Stop → Log saves the time worked', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const picks = await s.workout.pickerExercises(sessionId, 'Plank', { withCatalogue: true });
    const plank = picks.find((p) => p.exercise.name === 'Plank');
    expect(plank?.exercise.measurement).toBe('duration');
    // Distance exercises aren't offered by this picker yet.
    expect((await s.workout.pickerExercises(sessionId, '', { withCatalogue: true })).every((p) => p.exercise.measurement !== 'distance')).toBe(true);

    const added = await s.workout.addExercise({ sessionId, exerciseId: plank?.exercise.id ?? '', equipmentId: null, opId: 'add-plank' });
    if (!added.ok) throw new Error(added.error.message);
    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    const v = s.workout.view(data, h.clockMs, null);
    expect(v.primary).toEqual({ kind: 'start_work', label: 'Start 0:30', durationS: 30 });
    const setId = v.focus?.setId ?? '';

    const go = await s.workout.dispatch(sessionId, { type: 'start_work_interval', at: h.now(), opId: 'work-1', setId, durationS: 30 });
    if (!go.ok) throw new Error(go.error.message);
    h.clockMs += 22_000;
    const stop = await s.workout.dispatch(sessionId, { type: 'stop_work_interval', at: h.now(), opId: 'stop-1', setId });
    if (!stop.ok) throw new Error(stop.error.message);
    const after = s.workout.view({ ...data, aggregate: stop.aggregate }, h.clockMs, null);
    expect(after.primary).toMatchObject({ kind: 'log' });
    expect(after.focus?.duration?.value).toBe(22);
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId, values: after.focus?.draft ?? { load: null, reps: null, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    expect(logged.aggregate.sets.find((x) => x.id === setId)?.actual).toMatchObject({ durationS: 22 });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { editorShown, enterAction, isResting } from '../src/workout/rest-fold';
import { createHarness, type Harness } from './harness';

/** The rest-screen fold (review B1, S6): `Enter load` always reaches a drawn field. */
describe('rest fold (pure)', () => {
  it('rest is running or paused, not ended or absent', () => {
    expect(isResting({ kind: 'running' })).toBe(true);
    expect(isResting({ kind: 'paused' })).toBe(true);
    expect(isResting({ kind: 'ended' })).toBe(false);
    expect(isResting(null)).toBe(false);
  });

  it('the editor is folded only while resting and not opened', () => {
    expect(editorShown({ resting: false, hasFocus: true, showNextSet: false })).toBe(true);
    expect(editorShown({ resting: true, hasFocus: true, showNextSet: false })).toBe(false);
    expect(editorShown({ resting: true, hasFocus: true, showNextSet: true })).toBe(true);
    expect(editorShown({ resting: false, hasFocus: false, showNextSet: true })).toBe(false);
  });

  it('Enter during rest opens the editor first; otherwise it only focuses', () => {
    expect(enterAction('load', { resting: true, hasFocus: true, showNextSet: false })).toEqual({ unfold: true, focus: 'load' });
    expect(enterAction('reps', { resting: true, hasFocus: true, showNextSet: true })).toEqual({ unfold: false, focus: 'reps' });
    expect(enterAction('load', { resting: false, hasFocus: true, showNextSet: false })).toEqual({ unfold: false, focus: 'load' });
  });

  it('after Enter, the field it focuses is always drawn', () => {
    for (const resting of [true, false])
      for (const showNextSet of [true, false]) {
        const input = { resting, hasFocus: true, showNextSet };
        const a = enterAction('load', input);
        expect(editorShown({ ...input, showNextSet: showNextSet || a.unfold })).toBe(true);
      }
  });
});

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

describe('rest fold on a first workout (review B1 scenario)', () => {
  it('3 bench sets, rest running, Triceps pushdown added: Enter load opens the folded editor', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gym = await s.setup.useTypicalGym();
    await s.setup.complete();
    const gymId = gym.ok ? (gym.gymId ?? '') : '';
    const started = await s.workout.start({ gymId, opId: 'start', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const pick = async (name: string) => {
      const p = (await s.workout.pickerExercises(sessionId, name, { withCatalogue: true })).find((x) => x.exercise.name === name);
      if (!p) throw new Error(name);
      const r = await s.workout.addExercise({ sessionId, exerciseId: p.exercise.id, equipmentId: p.equipment[0]?.id ?? null, opId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    };
    await pick('Bench press');
    for (let i = 0; i < 3; i += 1) {
      h.clockMs += 60_000;
      const data = await s.workout.load();
      if (!data) throw new Error('no workout');
      const v = s.workout.view(data, h.clockMs, null);
      const values = { load: { value: 60, unit: 'kg' as const, convention: 'total' as const }, reps: 6, durationS: null, rpe: null, rir: null };
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: v.focus?.setId ?? '', values, restTimerId: h.ids() });
      expect(r.ok).toBe(true);
    }
    await pick('Triceps pushdown');
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const v = s.workout.view(data, h.clockMs + 5_000, null);
    expect(v.focus?.exerciseName).toBe('Triceps pushdown');
    expect(v.primary).toMatchObject({ kind: 'enter', field: 'load' });
    const input = { resting: isResting(v.rest), hasFocus: v.focus !== null, showNextSet: false };
    expect(input.resting).toBe(true);
    // This is what the screen draws: folded, so the button must open it.
    expect(editorShown(input)).toBe(false);
    expect(enterAction('load', input)).toEqual({ unfold: true, focus: 'load' });
    await h.settle(s);
  });
});

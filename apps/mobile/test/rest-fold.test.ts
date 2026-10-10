import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { editorShown, editorSlot, enterAction, isResting, READY_HOLD_MS, readyHoldUntil } from '../src/workout/rest-fold';
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

describe('editor slot across the rest end (premium-feel review B1)', () => {
  it('editor opened during rest keeps the same key when the rest ends, and does not animate', () => {
    const during = editorSlot({ resting: true, hasFocus: true, showNextSet: true, setId: 's2', drawn: true });
    const after = editorSlot({ resting: false, hasFocus: true, showNextSet: true, setId: 's2', drawn: true });
    expect(during).toEqual({ kind: 'editor', key: 'editor:s2', animateOnMount: false });
    expect(after.kind).toBe('editor');
    if (during.kind === 'editor' && after.kind === 'editor') expect(after.key).toBe(during.key);
  });

  it('folded during rest: the link, then the editor fades in when the rest ends', () => {
    expect(editorSlot({ resting: true, hasFocus: true, showNextSet: false, setId: 's2', drawn: true })).toEqual({ kind: 'link' });
    expect(editorSlot({ resting: false, hasFocus: true, showNextSet: false, setId: 's2', drawn: true })).toEqual({ kind: 'editor', key: 'editor:s2', animateOnMount: true });
  });

  it('never animates on the first draw; nothing without a set', () => {
    expect(editorSlot({ resting: false, hasFocus: true, showNextSet: false, setId: 's1', drawn: false })).toEqual({ kind: 'editor', key: 'editor:s1', animateOnMount: false });
    expect(editorSlot({ resting: false, hasFocus: false, showNextSet: false, setId: null, drawn: true })).toEqual({ kind: 'none' });
  });
});

describe('Rest end → READY hold (premium-feel §4.3, review S2)', () => {
  const deadline = Date.UTC(2026, 9, 10, 7, 2, 0);
  const running = { kind: 'running' as const, timerId: 't1', deadlineUtc: new Date(deadline).toISOString() };
  const ended = { kind: 'ended' as const, timerId: 't1', skipped: false };

  it('holds READY for 600 ms when the rest reaches its end on screen', () => {
    expect(readyHoldUntil(running, ended, deadline + 300)).toBe(deadline + 300 + READY_HOLD_MS);
  });

  it('no hold for Skip, another timer, a return to the app later, or no transition', () => {
    expect(readyHoldUntil(running, { ...ended, skipped: true }, deadline - 20_000)).toBeNull();
    expect(readyHoldUntil(running, { ...ended, timerId: 't2' }, deadline)).toBeNull();
    expect(readyHoldUntil(running, ended, deadline + 60_000)).toBeNull();
    expect(readyHoldUntil(ended, ended, deadline)).toBeNull();
    expect(readyHoldUntil(null, ended, deadline)).toBeNull();
  });

  it('during the hold an open editor keeps its key; the folded one swaps in after', () => {
    // The screen treats the hold as rest on screen, so the slot is the same as during rest.
    expect(editorSlot({ resting: true, hasFocus: true, showNextSet: false, setId: 's2', drawn: true })).toEqual({ kind: 'link' });
    expect(editorSlot({ resting: true, hasFocus: true, showNextSet: true, setId: 's2', drawn: true })).toMatchObject({ key: 'editor:s2', animateOnMount: false });
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { undoableTimeFit, type TimeFitOffer } from '@fizz/domain';
import type { WorkoutSet } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { askBarView } from '../src/coach/builder-coach-view';
import { timeFitSheet } from '../src/workout/time-fit';
import { workoutMenu } from '../src/workout/table';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * workout-table-v3 §5 (b3 merge), end to end on real SQLite with no coach:
 * `+N min` offers the builder's fit steps over the sets left as one change.
 * Nothing changes until Apply (rule 3); Apply is one versioned write that
 * survives a force-close; Undo puts every set back; a stale offer is
 * refused (rule 5); a replayed Apply changes nothing.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function addWithSets(s: AppServices, sessionId: string, name: string, sets: number): Promise<void> {
  const picks = await s.workout.pickerExercises(sessionId, name);
  const pick = picks.find((p) => p.exercise.name === name) ?? picks[0];
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: `add-${name}` });
  if (!added.ok) throw new Error(added.error.message);
  const row = added.aggregate.exercises.find((e) => e.exerciseId === pick?.exercise.id)?.id ?? '';
  for (let i = 1; i < sets; i += 1) {
    const more = await s.workout.addSet({ sessionId, sessionExerciseId: row, opId: `add-set-${name}-${String(i)}`, newSetId: h.ids() });
    if (!more.ok) throw new Error(more.error.message);
  }
}

async function workout(s: AppServices): Promise<string> {
  const gymId = await setUpGym(h, s);
  const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  await addWithSets(s, sessionId, 'Bench press', 3);
  await addWithSets(s, sessionId, 'Lateral raise', 4);
  await addWithSets(s, sessionId, 'Triceps pushdown', 4);
  return sessionId;
}

const shape = (sets: readonly WorkoutSet[]) =>
  sets.map((x) => ({ id: x.id, status: x.status, rest: x.rest.seconds, rpe: x.planned.rpeOverride ?? x.planned.rpe }));

describe('+N min: the builder fit as one offer with Apply and Undo (v3 §5)', () => {
  it('offers, applies only on Apply, survives a force-close, and Undo puts it all back', async () => {
    let { services: s } = await h.launch();
    const sessionId = await workout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const before = shape(data.aggregate.sets);

    const offer = s.workout.timeFit(data, 20);
    expect(offer).not.toBeNull();
    if (offer === null) return;
    // Making the offer changes nothing (rule 3).
    expect(shape((await s.workout.load())?.aggregate.sets ?? [])).toEqual(before);
    const sheet = timeFitSheet(offer, 20);
    expect(sheet.title).toBe('20 min over');
    expect(sheet.estimate).toMatch(/^(≈ \d+ → \d+ min left|Saves ≈ \d+ min)$/);
    // One line per change, each with before → after (review SP-3).
    expect(sheet.lines.length).toBe(offer.lines.length);
    for (const l of sheet.lines) expect(l).toMatch(/→|^Skip: /);
    expect([sheet.apply, sheet.notNow, sheet.timeLeft]).toEqual(['Apply', 'Not now', 'Time left ›']);
    // The main lift (the first compound) is never trimmed or dropped.
    const bench = data.aggregate.exercises[0]?.id ?? '';
    expect(offer.lines.some((l) => l.kind !== 'rest' && l.kind !== 'effort' && l.sessionExerciseId === bench)).toBe(false);

    const r = await s.workout.applyTimeFit({ sessionId, offer, opId: 'fit-1' });
    expect(r.ok).toBe(true);
    // A replay is a duplicate: nothing more changes.
    const again = await s.workout.applyTimeFit({ sessionId, offer, opId: 'fit-1' });
    expect(again.ok).toBe(true);

    await h.forceClose();
    s = (await h.launch()).services;
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const applied = shape(data.aggregate.sets);
    expect(applied).not.toEqual(before);
    // The old offer is now stale (rule 5).
    const stale = await s.workout.applyTimeFit({ sessionId, offer, opId: 'fit-2' });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_version' } });

    // ⋯ offers `Undo fit to time` after the relaunch (the toast is long gone; review S1).
    expect(undoableTimeFit(data.aggregate, h.now())).toBe('fit-1');
    const undone = await s.workout.undoOp({ sessionId, targetOpId: 'fit-1' });
    expect(undone.ok).toBe(true);
    const back = await s.workout.load();
    expect(shape(back?.aggregate.sets ?? [])).toEqual(before);
    expect(undoableTimeFit(back?.aggregate ?? data.aggregate, h.now())).toBeNull();
    // A second tap on Undo is the same operation (derived opId): a replay, never applied twice (rule 5).
    await s.workout.undoOp({ sessionId, targetOpId: 'fit-1' });
    expect(shape((await s.workout.load())?.aggregate.sets ?? [])).toEqual(before);
  });

  it('nothing over: no offer', async () => {
    const { services: s } = await h.launch();
    await workout(s);
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(s.workout.timeFit(data, 0)).toBeNull();
  });
});

describe('the fit sheet and ⋯ (review SP-3, S1, S3)', () => {
  const base: TimeFitOffer = { status: 'fitted', beforeMinutes: 33, afterMinutes: 28, savedMinutes: 5, targetMinutes: 28, expectedVersion: 4, steps: [], lines: [
    { kind: 'rest', sessionExerciseId: 'r', name: 'Cable row', fromS: 90, toS: 60, sets: 2 },
    { kind: 'sets', sessionExerciseId: 'l', name: 'Lateral raise', from: 3, to: 2 },
    { kind: 'effort', sessionExerciseId: 'c', name: 'Curl', from: 8, to: 9 },
    { kind: 'drop', sessionExerciseId: 'x', name: 'Cable crunch' },
  ] };

  it('one line per change, before → after, and the estimate', () => {
    expect(timeFitSheet(base, 5)).toEqual({
      title: '5 min over',
      lines: ['Cable row rest 1:30 → 1:00', 'Lateral raise 3 → 2 sets', 'Curl last set @8 → @9', 'Skip: Cable crunch'],
      estimate: '≈ 33 → 28 min left',
      apply: 'Apply',
      notNow: 'Not now',
      timeLeft: 'Time left ›',
      applied: 'Fitted · ≈ 5 min shorter',
    });
  });

  it('more over than it can make up: `Saves ≈ N min`', () => {
    expect(timeFitSheet({ ...base, status: 'over', savedMinutes: 9 }, 40).estimate).toBe('Saves ≈ 9 min');
  });

  it('⋯ shows `Undo fit to time` only while it can still be undone', () => {
    const m = { view: 'table' as const, paused: false, openEnded: false, ax: false, gymName: 'Main Gym' };
    expect(workoutMenu(m).some((x) => x.id === 'undo_fit')).toBe(false);
    expect(workoutMenu({ ...m, undoFit: true }).find((x) => x.id === 'undo_fit')?.label).toBe('Undo fit to time');
  });

  it('the workout’s coach entry (v3 §1.6): never disabled for a missing coach (the sheet says so), one short honest word', () => {
    expect(askBarView('active', 'ok', 'idle')).toMatchObject({ short: 'Coach', status: null, disabled: false });
    expect(askBarView('active', 'offline', 'idle')).toMatchObject({ short: 'Offline', status: 'Offline', disabled: false, accessibilityLabel: 'Ask the coach, Offline' });
    expect(askBarView('active', 'not_connected', 'idle')).toMatchObject({ short: 'No coach', disabled: false });
    expect(askBarView('active', 'ok', 'unavailable').mic).toMatchObject({ glyph: '⊘', disabled: false });
  });
});

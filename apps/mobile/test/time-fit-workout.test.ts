import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { timeFitPrompt } from '../src/workout/time-fit';
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

const shape = (sets: readonly { id: string; status: string; rest: { seconds: number }; planned: { rpeOverride?: number; rpe: number | null } }[]) =>
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
    const prompt = timeFitPrompt(offer, 20);
    expect(prompt.title).toBe('20 min over');
    expect(prompt.message).toMatch(/min left$/);
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

    const undone = await s.workout.undoOp({ sessionId, targetOpId: 'fit-1' });
    expect(undone.ok).toBe(true);
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

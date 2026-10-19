import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildExecutionOrder } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { supersetPickerView } from '../src/workout/superset-picker';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * `Superset with…` mid-workout (Ben, 19 Oct: "I want the option to add superset to an existing
 * set", "Even if it's the same exercise with different or no weight"). Through the app's services
 * on SQLite: a new partner (the same exercise too) or one already in the workout, sets alternating
 * from the current round, done sets untouched, Undo, a stale version and a force-close.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const rowsNamed = (a: SessionAggregate, name: string) => a.exercises.filter((e) => e.exerciseName === name && e.removed === undefined).sort((x, y) => x.order - y.order);
const nextNames = (a: SessionAggregate, n: number) => {
  const pending = buildExecutionOrder(a.exercises.filter((e) => e.removed === undefined), a.sets).filter((id) => a.sets.find((x) => x.id === id)?.status === 'pending');
  return pending.slice(0, n).map((id) => a.exercises.find((e) => e.id === a.sets.find((x) => x.id === id)?.sessionExerciseId)?.exerciseName);
};

describe('Superset with… during a workout', () => {
  it('seated calf raise with one set done: Calf raise (bodyweight) pairs from the next round, the same exercise again too; Undo; a force-close keeps it', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    const started = await s.workout.start({ gymId, opId: 'start-ss', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const calf = (await s.workout.pickerExercises(sessionId, 'Seated calf raise', { withCatalogue: true })).find((p) => p.exercise.name === 'Seated calf raise');
    if (!calf) throw new Error('no seated calf raise');
    const added = await s.workout.addExercise({ sessionId, exerciseId: calf.exercise.id, equipmentId: calf.equipment[0]?.id ?? null, opId: 'add-calf', shape: { workingSets: 3 } });
    if (!added.ok) throw new Error(added.error.message);
    const calfRow = rowsNamed(added.aggregate, 'Seated calf raise')[0];
    const first = added.aggregate.sets.filter((x) => x.sessionExerciseId === calfRow?.id).sort((a, b) => a.index - b.index)[0];
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first?.id ?? '', values: { load: first?.planned.load ?? { value: 40, unit: calfRow?.unit ?? 'kg', convention: calfRow?.loadConvention ?? 'added' }, reps: 12, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const doneSet = logged.aggregate.sets.find((x) => x.id === first?.id);

    // The picker: nothing else in the workout yet; a new partner starts with the 2 sets left.
    const choices = await s.workout.supersetChoices(sessionId, calfRow?.id ?? '');
    expect(choices).toMatchObject({ name: 'Seated calf raise', partners: [], sets: 2 });
    expect(supersetPickerView(choices, '')?.title).toBe('Superset with Seated calf raise');

    // Calf raise (bodyweight), the new catalogue entry, as the partner.
    const bw = (await s.workout.pickerExercises(sessionId, 'bodyweight calf raise', { withCatalogue: true })).find((p) => p.exercise.name === 'Calf raise (bodyweight)');
    if (!bw) throw new Error('no Calf raise (bodyweight)');
    expect(bw.exercise.defaultLoadConvention).toBe('bodyweight');
    const paired = await s.workout.addExercise({ sessionId, exerciseId: bw.exercise.id, equipmentId: bw.equipment[0]?.id ?? null, opId: 'pair-bw', shape: { workingSets: choices?.sets ?? 1 }, supersetWithSessionExerciseId: calfRow?.id ?? '' });
    if (!paired.ok) throw new Error(paired.error.message);
    const bwRow = rowsNamed(paired.aggregate, 'Calf raise (bodyweight)')[0];
    expect(bwRow).toMatchObject({ supersetGroup: 'A', roundOffset: 1, loadConvention: 'bodyweight' });
    expect(paired.aggregate.sets.filter((x) => x.sessionExerciseId === bwRow?.id && x.setType === 'working')).toHaveLength(2);
    expect(nextNames(paired.aggregate, 4)).toEqual(['Seated calf raise', 'Calf raise (bodyweight)', 'Seated calf raise', 'Calf raise (bodyweight)']);
    // The done set is untouched (rule 2).
    expect(paired.aggregate.sets.find((x) => x.id === first?.id)).toEqual(doneSet);

    // Undo takes the partner out; the calf raise is single again.
    const undone = await s.workout.undoOp({ sessionId, targetOpId: 'pair-bw' });
    expect(undone.ok).toBe(true);
    const afterUndo = await s.workout.load(sessionId);
    expect(rowsNamed(afterUndo?.aggregate as SessionAggregate, 'Seated calf raise')[0]?.supersetGroup).toBeNull();

    // The same exercise again ("we put 0"): a second Seated calf raise in the superset, its own sets.
    const again = await s.workout.addExercise({ sessionId, exerciseId: calf.exercise.id, equipmentId: calf.equipment[0]?.id ?? null, opId: 'pair-self', shape: { workingSets: 2 }, supersetWithSessionExerciseId: calfRow?.id ?? '' });
    if (!again.ok) throw new Error(again.error.message);
    const copies = rowsNamed(again.aggregate, 'Seated calf raise');
    // A fresh letter: the undone partner's row keeps its old one (Undo of its removal could bring it back).
    expect(copies.map((e) => e.supersetGroup)).toEqual(['B', 'B']);
    expect(again.aggregate.sets.filter((x) => x.sessionExerciseId === copies[1]?.id).every((x) => x.status === 'pending')).toBe(true);

    // A retry of the same add is the same write.
    const retry = await s.workout.addExercise({ sessionId, exerciseId: calf.exercise.id, equipmentId: calf.equipment[0]?.id ?? null, opId: 'pair-self', shape: { workingSets: 2 }, supersetWithSessionExerciseId: calfRow?.id ?? '' });
    expect(retry).toMatchObject({ ok: true, duplicate: true });

    // Force-close: the superset is still there; Remove superset after the relaunch, then its Undo.
    await h.forceClose();
    ({ services: s } = await h.launch());
    const back = await s.workout.load(sessionId);
    if (!back) throw new Error('no workout');
    expect(rowsNamed(back.aggregate, 'Seated calf raise').map((e) => [e.supersetGroup, e.roundOffset ?? 0])).toEqual([
      ['B', 0],
      ['B', 1],
    ]);
    const split = await s.workout.dispatch(sessionId, { type: 'split_superset', at: h.now(), opId: 'split-1', sessionExerciseId: calfRow?.id ?? '', expectedVersion: back.aggregate.session.version });
    if (!split.ok) throw new Error(split.error.message);
    expect(rowsNamed(split.aggregate, 'Seated calf raise').map((e) => e.supersetGroup)).toEqual([null, null]);
    expect((await s.workout.undoOp({ sessionId, targetOpId: 'split-1' })).ok).toBe(true);
  });

  it('an exercise already in the workout is linked (it moves next to the anchor); a stale version is refused', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'commercial');
    const started = await s.workout.start({ gymId, opId: 'start-ln', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    for (const [i, name] of ['Push-up', 'Seated calf raise', 'Plank'].entries()) {
      const pick = (await s.workout.pickerExercises(sessionId, name, { withCatalogue: true })).find((p) => p.exercise.name === name);
      if (!pick) throw new Error(`no ${name}`);
      const r = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: `add-${String(i)}`, shape: { workingSets: 2 } });
      if (!r.ok) throw new Error(r.error.message);
    }
    const now = (await s.workout.load(sessionId))?.aggregate as SessionAggregate;
    const push = rowsNamed(now, 'Push-up')[0]?.id ?? '';
    const plank = rowsNamed(now, 'Plank')[0]?.id ?? '';
    const choices = await s.workout.supersetChoices(sessionId, push);
    expect(choices?.partners.map((p) => [p.exerciseName, p.detail])).toEqual([
      ['Seated calf raise', '2 sets left'],
      ['Plank', '2 sets left'],
    ]);
    expect(supersetPickerView(choices, 'plan')?.partners.map((p) => p.exerciseName)).toEqual(['Plank']);
    const linked = await s.workout.linkSuperset({ sessionId, sessionExerciseId: push, withSessionExerciseId: plank, expectedVersion: choices?.version ?? 0, opId: 'link-plank' });
    if (!linked.ok) throw new Error(linked.error.message);
    expect(linked.aggregate.exercises.filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order).map((e) => [e.exerciseName, e.supersetGroup])).toEqual([
      ['Push-up', 'A'],
      ['Plank', 'A'],
      ['Seated calf raise', null],
    ]);
    const stale = await s.workout.linkSuperset({ sessionId, sessionExerciseId: push, withSessionExerciseId: rowsNamed(now, 'Seated calf raise')[0]?.id ?? '', expectedVersion: choices?.version ?? 0, opId: 'link-stale' });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_version' } });
  });
});

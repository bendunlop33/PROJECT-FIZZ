import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, equipmentOfRow, gymLearnToast, type CommandOutcome } from '@fizz/domain';
import type { EquipmentInstance, SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { popupCellWrite } from '../src/workout/exercise-popup';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 27 Oct: "If I add it it should work") Real SQLite, offline, no coach: a weight Ben types for a set not done
 * yet is kept exactly as typed; off the gym's known kit the gym learns it (versioned) with `Main Gym: 62.5 kg added`;
 * Undo takes the learn back and then his target; the logged set is never touched (rule 2). kg on a bodyweight
 * exercise is added weight. The built-in rule's targets still snap to the (now updated) kit.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-27T16:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const ok = (r: CommandOutcome): SessionAggregate => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.aggregate;
};

async function started(): Promise<{ s: AppServices; sessionId: string; a: SessionAggregate; row: string; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9, rpe: 8 }] }]);
  h.clockMs += DAY;
  const st = await s.workout.start({ gymId, opId: 'start-today', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!st.ok) throw new Error(st.error.message);
  const sessionId = st.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Incline dumbbell press')).find((p) => p.exercise.name === 'Incline dumbbell press');
  const a = ok(await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-incline' }));
  const row = a.exercises.find((e) => e.exerciseName === 'Incline dumbbell press')?.id ?? '';
  return { s, sessionId, a, row, gymId };
}

const rackOf = async (s: AppServices, _gymId: string, id: string): Promise<EquipmentInstance | null> => (await s.gyms.item(id))?.equipment ?? null;

describe('a typed weight is kept and the gym learns it', () => {
  it('a dumbbell past the rack: kept as typed, the rack learns it (versioned), Undo puts both back; survives a relaunch', async () => {
    const { s, sessionId, a, row, gymId } = await started();
    const set = a.sets.find((x) => x.sessionExerciseId === row && x.status === 'pending' && x.setType !== 'warmup');
    if (set === undefined) throw new Error('no set');
    const rack = equipmentOfRow(a.session.equipmentSnapshot, a.exercises.find((e) => e.id === row) ?? a.exercises[0]!);
    if (rack === null) throw new Error('no rack');
    const top = rack.kind === 'dumbbells' ? (rack.loads.at(-1) ?? 0) : 0;
    const typed = top + 12.5;
    const w = popupCellWrite(a, set.id, 'kg', typed);
    if (w.kind !== 'planned') throw new Error(`expected planned, got ${w.kind}`);
    expect(w.patch).toMatchObject({ load: { value: typed, unit: 'kg', convention: 'per_hand' }, loadAsTyped: true });
    expect(w.learn).toMatchObject({ kind: 'add_dumbbell', value: typed });
    const after = ok(await s.workout.dispatch(sessionId, { type: 'edit_planned_set', at: h.now(), opId: 'typed-1', setId: w.setId, expectedSetVersion: w.expectedSetVersion, patch: w.patch }));
    expect(after.sets.find((x) => x.id === set.id)?.planned.load?.value).toBe(typed);
    // A typed target: the gym learns it (today's kit isn't refreshed under his target, so Undo is exact).
    const learned = await s.gyms.learn(w.learn!);
    if (!learned.ok) throw new Error(learned.message);
    expect(gymLearnToast(w.learn!, 'Main Gym')).toBe(`Main Gym: ${String(typed)} kg added`);
    const now = await rackOf(s, gymId, rack.id);
    expect(now?.kind === 'dumbbells' && now.loads.includes(typed)).toBe(true);
    expect(now?.version).toBe(rack.version + 1);
    const today = (await s.workout.load(sessionId))?.aggregate;
    expect(today?.sets.find((x) => x.id === set.id)?.planned.load?.value).toBe(typed);
    // After a relaunch: still there.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === set.id)?.planned.load?.value).toBe(typed);
    // Undo: his target, then the learn.
    const uo = await s2.workout.undoOp({ sessionId, targetOpId: 'typed-1' });
    expect((await s2.gyms.undoEdit(learned.edit)).ok).toBe(true);
    expect(uo.ok).toBe(true);
    const back = await rackOf(s2, gymId, rack.id);
    expect(back?.kind === 'dumbbells' && back.loads.includes(typed)).toBe(false);
    expect((await s2.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === set.id)?.planned.load?.value).toBe(set.planned.load?.value);
  });

  it('a logged set is never re-snapped; a replayed typed write changes nothing (same opId)', async () => {
    const { s, sessionId, a, row } = await started();
    const set = a.sets.find((x) => x.sessionExerciseId === row && x.status === 'pending' && x.setType !== 'warmup');
    if (set === undefined) throw new Error('no set');
    const patch = { load: { value: 23.75, unit: 'kg' as const, convention: 'per_hand' as const }, loadAsTyped: true as const };
    const once = ok(await s.workout.dispatch(sessionId, { type: 'edit_planned_set', at: h.now(), opId: 'typed-2', setId: set.id, expectedSetVersion: set.version, patch }));
    const twice = await s.workout.dispatch(sessionId, { type: 'edit_planned_set', at: h.now(), opId: 'typed-2', setId: set.id, expectedSetVersion: set.version, patch });
    expect(twice.ok && twice.duplicate).toBe(true);
    const logged = ok(await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-typed', setId: set.id, values: { load: patch.load, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() }));
    expect(logged.sets.find((x) => x.id === set.id)?.actual?.load).toEqual(patch.load);
    expect(once.session.version).toBeLessThan(logged.session.version);
  });
});

describe('Your workout: a typed kg is kept and the gym learns it', () => {
  it('a barbell top between plate steps is kept as typed (never `Rounded to`); a dumbbell past the rack teaches the rack; Undo puts both back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += 4 * DAY;
    const base = await s.builder.initialSetup({ dayId: 'pull' });
    const main = (await s.builder.setupFacts(base)).mainLifts.find((m) => m.name === 'Barbell row');
    if (main === undefined) throw new Error('no barbell row');
    const made = await s.builder.create({ ...base, mainLiftExerciseId: main.id }, 'build-typed');
    if (made.status !== 'written' && made.status !== 'replayed') throw new Error(made.status);
    const snap = made.snapshot;
    const slot = snap.workout.blocks.flatMap((b) => b.slots).find((x) => x.main);
    if (slot === undefined) throw new Error('no main');
    const ti = slot.rows.findIndex((r) => r.type === 'top' || r.type === 'working');
    // 101.25 kg: no plate pair makes it here; kept exactly as typed (nothing to learn on plates).
    const r1 = await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: slot.key, index: ti, patch: { kind: 'load', value: 101.25 } }, { opId: 'typed-row-1', basis: { version: snap.version } });
    if (r1.status !== 'written') throw new Error(r1.status);
    expect(r1.snapshot.workout.blocks.flatMap((b) => b.slots).find((x) => x.key === slot.key)?.rows[ti]?.load).toBe(101.25);
    expect(r1.toast?.learn).toBeUndefined();
    expect(r1.toast?.text ?? '').not.toMatch(/Rounded|Not at this gym|Lighter/);
    // A per-hand dumbbell slot (Pull's accessories) typed past the rack: kept, and the toast carries the rack's learn.
    const added = await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: catalogueExerciseId('dumbbell-incline-bench-press') }, { opId: 'add-db', basis: { version: r1.snapshot.version } });
    if (added.status !== 'written') throw new Error(added.status);
    const db = added.snapshot.workout.blocks.flatMap((b) => b.slots).find((x) => x.convention === 'per_hand');
    if (db === undefined) throw new Error('no per-hand slot');
    const wi = db.rows.findIndex((r) => r.type !== 'warmup');
    const r2 = await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: db.key, index: wi, patch: { kind: 'load', value: 52.5 } }, { opId: 'typed-db-1', basis: { version: added.snapshot.version } });
    if (r2.status !== 'written') throw new Error(r2.status);
    expect(r2.snapshot.workout.blocks.flatMap((b) => b.slots).find((x) => x.key === db.key)?.rows.find((r) => r.typed === true)?.load).toBe(52.5);
    expect(r2.toast).toMatchObject({ undoOpId: 'typed-db-1', learn: { kind: 'add_dumbbell', value: 52.5 } });
    const g = await s.gyms.learn(r2.toast!.learn!);
    if (!g.ok) throw new Error(g.message);
    const rack = await s.gyms.item(r2.toast!.learn!.equipmentId);
    expect(rack?.equipment.kind === 'dumbbells' && rack.equipment.loads.includes(52.5)).toBe(true);
    // Undo (as the screen does): the gym, then the edit.
    expect((await s.gyms.undoEdit(g.edit)).ok).toBe(true);
    const undone = await s.builder.undo(snap.draftId, 'typed-db-1', 'undo-typed-db-1');
    expect(undone.status).toBe('written');
    const again = await s.gyms.item(r2.toast!.learn!.equipmentId);
    expect(again?.equipment.kind === 'dumbbells' && again.equipment.loads.includes(52.5)).toBe(false);
  });
});

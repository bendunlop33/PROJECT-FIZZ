import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addWarmupCommand, currentGymEquipment, equipmentOfRow, isLoadAchievable, movableSetIds, moveSetCommand, removeExerciseCommand, supersetNextCommand, type CommandOutcome } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * workout-table-v3 §7 through the app's services on real SQLite, no network
 * and no coach: the builder's Swap / Add sheet mid-workout, loads from the
 * builder's load sources fitted to the gym's kit (rule 4), `Why this
 * weight?`, the builder's advice on Ben's own change (never a block), and
 * Remove that keeps logged sets in history. Writes are idempotent by opId
 * and survive a force-close.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-20T16:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const ok = (r: CommandOutcome): SessionAggregate => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.aggregate;
};

async function started(): Promise<{ s: AppServices; sessionId: string; bench: string; a: SessionAggregate }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
    { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9, rpe: 8 }, { load: 27.5, reps: 9, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  const st = await s.workout.start({ gymId, opId: 'start-today', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!st.ok) throw new Error(st.error.message);
  const sessionId = st.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  const a = ok(await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-bench' }));
  const bench = a.exercises.find((e) => e.exerciseName === 'Bench press')?.id ?? '';
  return { s, sessionId, bench, a };
}

/** Every planned load of a row is one its item can make (rule 4). */
function achievable(a: SessionAggregate, rowId: string): boolean {
  const row = a.exercises.find((e) => e.id === rowId);
  if (row === undefined) return false;
  const eq = equipmentOfRow(a.session.equipmentSnapshot, row);
  return a.sets.filter((x) => x.sessionExerciseId === rowId && x.status === 'pending').every((x) => x.planned.load === null || eq === null || isLoadAchievable(x.planned.load, eq));
}

describe('Swap / Add with the builder’s sheet and loads (§7)', () => {
  it('the sheet lists this gym’s exercises of the group by focus with works lines, minus what’s in the workout; another group on request', async () => {
    const { s, sessionId, bench } = await started();
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: bench });
    expect(c?.group).toBe('Chest');
    const names = (c?.sections ?? []).flatMap((x) => x.items.map((i) => i.name));
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('Bench press');
    expect((c?.sections ?? []).flatMap((x) => x.items).every((i) => i.works === null || i.works.length > 0)).toBe(true);
    const back = await s.workoutEdit.choices(sessionId, { sessionExerciseId: null, group: 'Back' });
    expect(back?.group).toBe('Back');
    expect(back?.groups).toContain('Abs');
  });

  it('forearm and prehab work is findable (D5): wrist curls under the arms group › Forearms, cuff under Shoulders, tibialis under Legs; Add works', async () => {
    const { s, sessionId } = await started();
    const heads = async (group: 'Biceps' | 'Shoulders' | 'Legs' | 'Back') => {
      const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: null, group });
      return new Map((c?.sections ?? []).map((x) => [x.focus, x.items.map((i) => i.name)]));
    };
    const arms = await heads('Biceps');
    expect(arms.get('Forearms')).toEqual(expect.arrayContaining(['Barbell wrist curl']));
    expect(arms.get('Biceps') ?? []).not.toContain('Barbell wrist curl');
    const shoulders = await heads('Shoulders');
    expect(shoulders.get('Rotator cuff')).toEqual(expect.arrayContaining(['Cable external rotation']));
    // Cuff work is no longer filed as rear delts under Back.
    expect([...(await heads('Back')).values()].flat()).not.toContain('Cable external rotation');
    const legs = await heads('Legs');
    expect(legs.get('Shins')).toEqual(expect.arrayContaining(['Tibialis raise']));
    expect(legs.get('Calves') ?? []).not.toContain('Tibialis raise');

    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: null, group: 'Biceps' });
    const wrist = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Barbell wrist curl');
    if (wrist === undefined) throw new Error('no wrist curl in the sheet');
    const a = ok(await s.workoutEdit.add(sessionId, wrist.exerciseId, 'add-wrist'));
    expect(a.exercises.some((e) => e.exerciseId === wrist.exerciseId && e.removed === undefined)).toBe(true);
  });

  it('Add: the builder’s sets (warm-up for a compound, 3 working @ RPE 8–9), loads on the gym’s item; idempotent; Undo', async () => {
    const { s, sessionId } = await started();
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: null });
    const incline = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Incline dumbbell press');
    if (incline === undefined) throw new Error('no incline in the sheet');
    const a = ok(await s.workoutEdit.add(sessionId, incline.exerciseId, 'add-incline'));
    const row = a.exercises.find((e) => e.exerciseId === incline.exerciseId && e.removed === undefined);
    if (row === undefined) throw new Error('not added');
    const sets = a.sets.filter((x) => x.sessionExerciseId === row.id).sort((x, y) => x.index - y.index);
    expect(sets.filter((x) => x.setType !== 'warmup')).toHaveLength(3);
    expect(sets.filter((x) => x.setType !== 'warmup').map((x) => x.planned.rpe)).toEqual([8, 8, 9]);
    // Per-hand dumbbells: kg each, from his own history (27.5 × 9), rounded on the rack.
    expect(row.loadConvention).toBe('per_hand');
    expect(sets.every((x) => x.planned.load === null || (x.planned.load.unit === 'kg' && x.planned.load.convention === 'per_hand'))).toBe(true);
    expect(achievable(a, row.id)).toBe(true);
    const again = await s.workoutEdit.add(sessionId, incline.exerciseId, 'add-incline');
    expect(again.ok && again.duplicate).toBe(true);
    // Restart recovery: the Undo works after a force-close.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const u = await s2.workout.undoOp({ sessionId, targetOpId: 'add-incline' });
    expect(u.ok).toBe(true);
  });

  it('Swap: only sets not done yet move, with the builder’s loads fitted to the new item; logged sets stay (rule 2)', async () => {
    const { s, sessionId, bench, a } = await started();
    const first = a.sets.filter((x) => x.sessionExerciseId === bench && x.status === 'pending').sort((x, y) => x.index - y.index)[0];
    h.clockMs += 60_000;
    const logged = ok(await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first?.id ?? '', values: { load: { value: 100, unit: 'kg', convention: 'total' }, reps: 6, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() }));
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: bench });
    const to = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Incline dumbbell press') ?? (c?.sections ?? [])[0]?.items[0];
    if (to === undefined) throw new Error('nothing to swap to');
    const r = await s.workoutEdit.swap(sessionId, bench, to.exerciseId, 'swap-1');
    const after = ok(r);
    expect(after.sets.find((x) => x.id === first?.id)).toEqual(logged.sets.find((x) => x.id === first?.id));
    const row = after.exercises.find((e) => e.swappedFrom?.opId === 'swap-1');
    if (row === undefined) throw new Error('no swap row');
    expect(achievable(after, row.id)).toBe(true);
    expect(r.ok && r.toName).toBe(to.name);
  });

  it('Why this weight? reads what was stored with the next set; never empty for a planned set', async () => {
    const { s, sessionId, bench } = await started();
    const lines = await s.workoutEdit.why(sessionId, bench);
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe('Ben’s own change: advice, never a block (§7)', () => {
  it('Superset with next of bench and another chest press: not recommended (both work the chest), and the superset stays', async () => {
    const { s, sessionId, a } = await started();
    const pick = (await s.workout.pickerExercises(sessionId, 'Incline dumbbell press')).find((p) => p.exercise.name === 'Incline dumbbell press');
    const two = ok(await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-2' }));
    const bench = two.exercises.find((e) => e.exerciseName === 'Bench press')?.id ?? '';
    const cmd = supersetNextCommand(two, bench, { opId: 'pair-1', at: h.now() });
    if (cmd === null) throw new Error('no pair');
    const paired = ok(await s.workout.dispatch(sessionId, cmd));
    const advice = await s.workoutEdit.advice(two, paired);
    expect(advice).not.toBeNull();
    expect(paired.exercises.filter((e) => e.supersetGroup !== null)).toHaveLength(2);
    expect(a.session.id).toBe(sessionId);
  });
});

describe('Remove with logged sets (§7: asks first, keeps them in history)', () => {
  it('keeps the logged set and the row; the rest goes; Undo brings it back', async () => {
    const { s, sessionId, bench, a } = await started();
    const first = a.sets.filter((x) => x.sessionExerciseId === bench && x.status === 'pending').sort((x, y) => x.index - y.index)[0];
    h.clockMs += 60_000;
    const logged = ok(await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first?.id ?? '', values: { load: { value: 100, unit: 'kg', convention: 'total' }, reps: 6, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() }));
    const { command, loggedSets } = removeExerciseCommand(logged, bench, { opId: 'rm-1', at: h.now() });
    expect(loggedSets).toBe(1);
    const removed = ok(await s.workout.dispatch(sessionId, command));
    expect(removed.sets.filter((x) => x.sessionExerciseId === bench && x.status === 'completed')).toHaveLength(1);
    expect(removed.sets.filter((x) => x.sessionExerciseId === bench && x.status === 'pending')).toHaveLength(0);
    expect(currentGymEquipment(removed.session).length).toBeGreaterThan(0);
    const u = await s.workout.undoOp({ sessionId, targetOpId: 'rm-1' });
    expect(u.ok).toBe(true);
    const back = await s.workout.load(sessionId);
    expect(back?.aggregate.sets.filter((x) => x.sessionExerciseId === bench && x.status === 'pending').length).toBeGreaterThan(0);
  });
});

describe('pain holds the builder’s loads for Add and Swap (rule 9; integrity S4)', () => {
  /** Incline logged easily (27.5 × 12 @ RPE 6): without pain the builder would go up from it. */
  async function easyIncline(): Promise<{ s: AppServices; sessionId: string; bench: string }> {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
      { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 12, rpe: 6 }, { load: 27.5, reps: 12, rpe: 6 }, { load: 27.5, reps: 12, rpe: 6 }] },
    ]);
    h.clockMs += DAY;
    const st = await s.workout.start({ gymId, opId: 'start-today', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!st.ok) throw new Error(st.error.message);
    const sessionId = st.aggregate.session.id;
    const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
    const a = ok(await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-bench' }));
    return { s, sessionId, bench: a.exercises.find((e) => e.exerciseName === 'Bench press')?.id ?? '' };
  }

  const working = (a: SessionAggregate, exerciseId: string) => {
    const row = a.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined);
    return a.sets.filter((x) => x.sessionExerciseId === row?.id && x.status === 'pending' && x.setType !== 'warmup').map((x) => x.planned.load?.value ?? 0);
  };

  it('without pain the builder goes up from the easy sets (30 kg each), so the hold below is the pain flag’s', async () => {
    const { s, sessionId } = await easyIncline();
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: null });
    const incline = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Incline dumbbell press');
    if (incline === undefined) throw new Error('no incline in the sheet');
    const loads = working(ok(await s.workoutEdit.add(sessionId, incline.exerciseId, 'add-incline')), incline.exerciseId);
    expect(Math.max(...loads)).toBeGreaterThan(27.5);
  });

  it('Add: a pain-flagged exercise starts no heavier than its last comparable load (27.5 kg each), on the rack', async () => {
    const { s, sessionId } = await easyIncline();
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: null });
    const incline = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Incline dumbbell press');
    if (incline === undefined) throw new Error('no incline in the sheet');
    expect((await s.pain.flagMovement({ exerciseId: incline.exerciseId, exerciseName: 'Incline dumbbell press', opId: 'pain-1' })).ok).toBe(true);
    expect((await s.workoutEdit.choices(sessionId, { sessionExerciseId: null }))?.sections.flatMap((x) => x.items).find((i) => i.exerciseId === incline.exerciseId)?.mayHurt).toBe(true);
    const a = ok(await s.workoutEdit.add(sessionId, incline.exerciseId, 'add-incline'));
    const loads = working(a, incline.exerciseId);
    expect(loads.length).toBeGreaterThan(0);
    for (const v of loads) expect(v).toBeLessThanOrEqual(27.5);
    const row = a.exercises.find((e) => e.exerciseId === incline.exerciseId && e.removed === undefined);
    expect(achievable(a, row?.id ?? '')).toBe(true);

  });

  it('Swap: the substitute, pain-flagged, is held the same way', async () => {
    const { s, sessionId, bench } = await easyIncline();
    const c = await s.workoutEdit.choices(sessionId, { sessionExerciseId: bench });
    const incline = (c?.sections ?? []).flatMap((x) => x.items).find((i) => i.name === 'Incline dumbbell press');
    if (incline === undefined) throw new Error('no incline in the sheet');
    expect((await s.pain.flagMovement({ exerciseId: incline.exerciseId, exerciseName: 'Incline dumbbell press', opId: 'pain-1' })).ok).toBe(true);
    const a = ok(await s.workoutEdit.swap(sessionId, bench, incline.exerciseId, 'swap-1'));
    const loads = working(a, incline.exerciseId);
    expect(loads.length).toBeGreaterThan(0);
    for (const v of loads) expect(v).toBeLessThanOrEqual(27.5);
  });
});

describe('set order and warm-ups survive a force-close on SQLite (integrity S4)', () => {
  it('reorder_sets and add_warmup are read back from the store as written; their Undo works after relaunch', async () => {
    const { s, sessionId, bench, a } = await started();
    const pending = a.sets.filter((x) => x.sessionExerciseId === bench && x.status === 'pending' && x.setType !== 'warmup').sort((x, y) => x.index - y.index);
    expect(pending.length).toBeGreaterThanOrEqual(2);
    const move = moveSetCommand(a, pending.at(-1)?.id ?? '', 0, { opId: 'reorder-1', at: h.now() });
    if (move === null) throw new Error('no move');
    const moved = ok(await s.workout.dispatch(sessionId, move));
    const order = movableSetIds(moved, bench);
    const warm = addWarmupCommand(moved, bench, { opId: 'warm-1', at: h.now(), newSetId: h.ids() });
    if (!warm.ok) throw new Error(warm.reason);
    const withWarm = ok(await s.workout.dispatch(sessionId, warm.command));
    const shape = (x: SessionAggregate) => x.sets.filter((y) => y.sessionExerciseId === bench && y.status !== 'deleted').sort((p, q) => p.index - q.index).map((y) => `${y.id}:${y.setType}:${String(y.index)}`);
    const before = shape(withWarm);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const back = (await s2.workout.load(sessionId))?.aggregate;
    if (back === undefined) throw new Error('not restored');
    expect(shape(back)).toEqual(before);
    expect(movableSetIds(back, bench).filter((x) => order.includes(x))).toEqual(order);
    expect(back.sets.find((x) => x.id === warm.command.newSetId)?.setType).toBe('warmup');
    expect((await s2.workout.undoOp({ sessionId, targetOpId: 'warm-1' })).ok).toBe(true);
    expect((await s2.workout.undoOp({ sessionId, targetOpId: 'reorder-1' })).ok).toBe(true);
    const undone = (await s2.workout.load(sessionId))?.aggregate;
    expect(movableSetIds(undone ?? back, bench)).toEqual(movableSetIds(a, bench));
  });
});

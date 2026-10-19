import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLockScreenContent, pickerEquipmentLabel, pickerSections } from '@fizz/domain';

import { planRestAlert } from '../src/alerts/rest-alerts';
import { valueFieldOf } from '../src/workout/table';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Cardio (Ben, 19 Oct: "rowing machine or bike ... with a timer and
 * distance") through the app's services on real SQLite: the picker's
 * Cardio chip, Start, a force-close mid-row, ✓ logging the timer's time
 * with the distance typed from the machine, the table row with its pace,
 * and next time's targets repeating it.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

const sp = (s: string | null | undefined) => s?.replace(/\u00a0/g, ' ');

describe('cardio end to end', () => {
  it('Rowing machine: Cardio chip → Start → force-close → ✓ logs 20:00 · 4,800 m with 2:05 /500 m; next time repeats it', async () => {
    let { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;

    // The picker: a Cardio chip lists the machines, new ones included; none needs a gym item.
    const all = await s.workout.pickerExercises(sessionId, '', { withCatalogue: true });
    const cardio = pickerSections(all, '', [], { cardio: true }).flatMap((x) => x.items.map((p) => p.exercise.name));
    for (const name of ['Rowing machine', 'Ski erg', 'Treadmill run', 'Air bike', 'Exercise bike', 'Cross trainer', 'Stair climber', 'Incline walk (treadmill)']) expect(cardio).toContain(name);
    expect(cardio).not.toContain('Bench press');
    const rower = all.find((p) => p.exercise.name === 'Rowing machine');
    expect(rower?.exercise.measurement).toBe('cardio');
    expect(rower?.equipment).toEqual([]);
    expect(rower && pickerEquipmentLabel(rower.exercise, rower.equipment)).toBe('Cardio');

    const added = await s.workout.addExercise({ sessionId, exerciseId: rower?.exercise.id ?? '', equipmentId: null, opId: 'add-row', shape: { workingSets: 1 } });
    if (!added.ok) throw new Error(added.error.message);
    const rowSet = added.aggregate.sets.find((x) => added.aggregate.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === rower?.exercise.id);
    if (rowSet === undefined) throw new Error('no rowing set');
    const act = await s.workout.dispatch(sessionId, { type: 'set_active_set', at: h.now(), opId: 'act-row', setId: rowSet.id, expectedVersion: added.aggregate.session.version });
    if (!act.ok) throw new Error(act.error.message);

    let data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    let v = s.workout.view(data, h.clockMs, null);
    expect(v.primary).toMatchObject({ kind: 'start_work', label: 'Start' });
    const start = await s.workout.dispatch(sessionId, { type: 'start_work_interval', at: h.now(), opId: 'start-row', setId: rowSet.id, durationS: v.primary.kind === 'start_work' ? v.primary.durationS : 1 });
    if (!start.ok) throw new Error(start.error.message);
    // No "Time" alert for a timer that counts up, and the lock screen shows when it started, not a countdown.
    expect(planRestAlert(start.aggregate, h.clockMs + 1000)).toBeNull();
    expect(buildLockScreenContent(start.aggregate, h.clockMs + 1000, 'Europe/London')).toMatchObject({ state: 'working', title: 'Rowing machine', countdown: null });

    // Force-close twenty minutes in: the relaunch reads the stored start.
    await h.forceClose();
    h.clockMs += 20 * 60_000;
    ({ services: s } = await h.launch());
    data = await s.workout.load(sessionId);
    if (!data) throw new Error('reload');
    v = s.workout.view(data, h.clockMs, null);
    expect(v.focus?.workTimer).toMatchObject({ state: 'running', elapsedMs: 1_200_000 });
    expect(v.primary).toEqual({ kind: 'stop_work', label: 'Stop' });

    // The distance is typed from the machine while it runs; ✓ logs the timer's time with it.
    const focus = v.focus;
    if (!focus) throw new Error('focus');
    const t = s.workout.tableView(data, h.clockMs, null);
    const block = t.blocks.find((b) => b.kind === 'exercise' && b.card.exerciseId === rower?.exercise.id);
    if (block?.kind !== 'exercise') throw new Error('no rower block');
    expect(block.card.columns?.valueLabel).toBe('TIME · DIST');
    expect(valueFieldOf({ valueLabel: 'TIME · DIST' })).toBe('time');
    const values = { ...focus.logValues, distanceM: 4800 };
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: focus.opId, setId: focus.setId, values, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    expect(logged.aggregate.sets.find((x) => x.id === rowSet.id)?.actual).toMatchObject({ durationS: 1200, distanceM: 4800 });

    data = await s.workout.load(sessionId);
    if (!data) throw new Error('load after log');
    const after = s.workout.tableView(data, h.clockMs + 1000, null).blocks.find((b) => b.kind === 'exercise' && b.card.exerciseId === rower?.exercise.id);
    if (after?.kind !== 'exercise') throw new Error('no rower block after');
    const row = after.card.rows.find((r) => r.setId === rowSet.id);
    expect(row?.state).toBe('done');
    expect(sp(row?.cells.value)).toBe('20:00 · 4,800 m');
    expect(sp(row?.pace)).toBe('2:05 /500 m');

    // Finish; Start next session targets last time's time and distance, with no load or reps.
    for (const ex of logged.aggregate.exercises) {
      if (!logged.aggregate.sets.some((x) => x.sessionExerciseId === ex.id && x.status === 'pending')) continue;
      const skip = await s.workout.dispatch(sessionId, { type: 'skip_exercise', at: h.now(), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
      if (!skip.ok) throw new Error(skip.error.message);
    }
    const loaded = await s.workout.load(sessionId);
    if (!loaded) throw new Error('load before finish');
    h.clockMs += 60_000;
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin', expectedVersion: loaded.aggregate.session.version, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    h.clockMs += 86_400_000;
    const again = await s.workout.start({ gymId, opId: 'next-1', checkIn: { kind: 'skipped', atUtc: h.now().utc }, nextOf: sessionId });
    if (!again.ok) throw new Error(again.error.message);
    const next = again.aggregate.sets.filter((x) => again.aggregate.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === rower?.exercise.id);
    // No load beyond bodyweight (the row's convention), no reps: last time's time and distance.
    expect(next.map((x) => x.planned)).toEqual([expect.objectContaining({ reps: null, durationS: 1200, distanceM: 4800 })]);
    expect(next[0]?.planned.load === null || next[0]?.planned.load.convention === 'bodyweight').toBe(true);
  });
});

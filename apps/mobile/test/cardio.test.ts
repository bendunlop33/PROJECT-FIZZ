import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLockScreenContent, catalogueExerciseId, defaultSlotShape, pickerEquipmentLabel, pickerSections } from '@fizz/domain';
import type { SessionAggregate, SessionCheckIn } from '@fizz/schemas';

import { planRestAlert } from '../src/alerts/rest-alerts';
import type { AppServices } from '../src/services/app-services';
import { CARDIO_TIME_FORMAT, nextFieldText } from '../src/ui/number-text';
import { cuesWorkEnd } from '../src/workout/cues';
import { addRepsRow, initialAddShape, repsDraftOfShape, slotShapeOfAdd } from '../src/workout/exercise-info-view';
import { cardioDraftWith, repsDraftValid, repsSteps } from '../src/workout/reps-draft';
import { repsDraftOf, repsPayload } from './overview-driver';
import { pickerAddSets, pickerBarValue, slotRepsDraft } from '../src/workout/set-shape-view';
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
    // The big button logs the time so far (review S6); Stop is the small one.
    expect(v.primary).toEqual({ kind: 'log', label: 'Log 20:00' });
    expect(v.workAction).toEqual({ kind: 'stop_work', label: 'Stop' });

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

const DAY = 86_400_000;
const ROWER_ID = catalogueExerciseId('rowing-erg');
const skipped = (): SessionCheckIn => ({ kind: 'skipped', atUtc: h.now().utc });
const rowSetsOf = (a: SessionAggregate, exerciseId = ROWER_ID) => a.sets.filter((x) => a.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === exerciseId);

/** An empty workout with one row logged (time and distance), finished; the clock moves on a day. */
async function rowWorkout(s: AppServices, gymId: string, durationS: number, distanceM: number): Promise<string> {
  const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: skipped() });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  await s.workout.pickerExercises(sessionId, '', { withCatalogue: true });
  const added = await s.workout.addExercise({ sessionId, exerciseId: ROWER_ID, equipmentId: null, opId: h.ids(), shape: { workingSets: 1 } });
  if (!added.ok) throw new Error(added.error.message);
  const set = rowSetsOf(added.aggregate)[0];
  if (set === undefined) throw new Error('no row set');
  h.clockMs += durationS * 1000;
  const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: h.ids(), setId: set.id, values: { load: null, reps: null, durationS, distanceM, rpe: null, rir: null }, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  h.clockMs += 60_000;
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: logged.aggregate.session.version, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  h.clockMs += DAY;
  return sessionId;
}

describe('review B1: next time repeats last time’s time and distance on every path', () => {
  it('a saved workout and Up next start at last time’s 20:00 · 4,800 m (not the saved 15:00 · 3,000 m); a picker add after a row targets it too, as one set', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await rowWorkout(s, gymId, 900, 3000);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Row day', opId: 'save-row', addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    // Another row since, not from the saved workout.
    await rowWorkout(s, gymId, 1200, 4800);

    // Up next: its page shows last time's values.
    const page = await s.overview.load({ target: { kind: 'next' }, gymId });
    const row = page?.view.rows.find((r) => r.name === 'Rowing machine');
    expect(sp(row?.editRow.repsText)).toBe('20:00 · 4,800 m');

    // The saved workout's own page and Start: last time's time and distance, labelled a repeat; no load, reps or RPE.
    const own = await s.overview.load({ target: { kind: 'routine', routineId: saved.routine.id }, gymId });
    expect(sp(own?.view.rows.find((r) => r.name === 'Rowing machine')?.editRow.repsText)).toBe('20:00 · 4,800 m');
    const started = await s.workout.start({ gymId, opId: 'start-row-day', checkIn: skipped(), routineOf: saved.routine.id });
    if (!started.ok) throw new Error(started.error.message);
    expect(rowSetsOf(started.aggregate).map((x) => x.planned)).toEqual([expect.objectContaining({ load: null, reps: null, durationS: 1200, distanceM: 4800, rpe: null, source: 'repeat' })]);
    const sessionId = started.aggregate.session.id;
    const discard = await s.workout.dispatch(sessionId, { type: 'discard', at: h.now(), opId: 'discard-1', expectedVersion: started.aggregate.session.version, confirmedLoggedSets: 0 });
    if (!discard.ok) throw new Error(discard.error.message);

    // Review S2: the rower from the picker without the Cardio chip is one set, at last time's values.
    const empty = await s.workout.start({ gymId, opId: 'start-empty', checkIn: skipped() });
    if (!empty.ok) throw new Error(empty.error.message);
    const sets = pickerAddSets({ value: 3, touched: false }, 'cardio');
    expect(sets).toBe(1);
    const added = await s.workout.addExercise({ sessionId: empty.aggregate.session.id, exerciseId: ROWER_ID, equipmentId: null, opId: 'add-row', shape: { workingSets: sets } });
    if (!added.ok) throw new Error(added.error.message);
    expect(rowSetsOf(added.aggregate).map((x) => x.planned)).toEqual([expect.objectContaining({ durationS: 1200, distanceM: 4800, source: 'repeat' })]);
  });

  it('with no row yet, a picker add is one empty set (no invented target)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: skipped() });
    if (!started.ok) throw new Error(started.error.message);
    await s.workout.pickerExercises(started.aggregate.session.id, '', { withCatalogue: true });
    const added = await s.workout.addExercise({ sessionId: started.aggregate.session.id, exerciseId: ROWER_ID, equipmentId: null, opId: 'add-row', shape: { workingSets: pickerAddSets({ value: 3, touched: false }, 'cardio') } });
    if (!added.ok) throw new Error(added.error.message);
    expect(rowSetsOf(added.aggregate).map((x) => [x.planned.durationS, x.planned.distanceM ?? null, x.planned.load])).toEqual([[null, null, null]]);
  });
});

describe('review S2 and N7: the picker’s Sets bar', () => {
  it('untouched: 1 for a cardio machine, 3 otherwise; the chip shows 1 but never resets Ben’s own count', () => {
    expect(pickerAddSets({ value: 3, touched: false }, 'cardio')).toBe(1);
    expect(pickerAddSets({ value: 3, touched: false }, 'reps')).toBe(3);
    expect(pickerAddSets({ value: 2, touched: true }, 'cardio')).toBe(2);
    expect(pickerBarValue({ value: 3, touched: false }, true)).toBe(1);
    expect(pickerBarValue({ value: 3, touched: false }, false)).toBe(3);
    expect(pickerBarValue({ value: 5, touched: true }, true)).toBe(5);
    expect(pickerBarValue({ value: 5, touched: true }, false)).toBe(5);
  });
});

describe('review S1: the overview and Library sheets take a cardio time past 10:00, and a distance', () => {
  it('today’s edit on a saved workout: 25:00 · 5,000 m is kept (no 10:00 clamp) and Start uses it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await rowWorkout(s, gymId, 1200, 4800);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Row day', opId: 'save-row', addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    const target = { kind: 'routine' as const, routineId: saved.routine.id };
    const page = await s.overview.load({ target, gymId });
    const row = page?.view.rows.find((r) => r.name === 'Rowing machine');
    if (row === undefined) throw new Error('no row');
    const draft = repsDraftOf(row.editRow);
    expect(draft).toEqual({ kind: 'cardio', seconds: 1200, distanceM: 4800 });
    expect(repsSteps(draft).time?.up).toMatchObject({ enabled: true, value: 1260 });
    let d = cardioDraftWith(draft as Extract<typeof draft, { kind: 'cardio' }>, 'time', 1500);
    d = cardioDraftWith(d as Extract<typeof d, { kind: 'cardio' }>, 'distance', 5000);
    expect(repsDraftValid(d)).toBe(true);
    const payload = repsPayload(d, row.editRow.plannedReps);
    expect(payload).toEqual({ kind: 'reps', reps: null, durationS: 1500, distanceM: 5000 });
    if (payload.kind !== 'reps') throw new Error('payload');
    const w = await s.overview.edit({ target, gymId, expectedDraftVersion: null, opId: 'row-25', edit: { kind: 'reps', slotKey: row.slotKey, reps: null, durationS: payload.durationS, distanceM: payload.distanceM ?? null } });
    expect(w.ok).toBe(true);
    const after = await s.overview.load({ target, gymId });
    expect(sp(after?.view.rows.find((r) => r.name === 'Rowing machine')?.editRow.repsText)).toBe('25:00 · 5,000 m');
    // Neither a time nor a distance is no edit; Done is off.
    expect(repsDraftValid({ kind: 'cardio', seconds: null, distanceM: null })).toBe(false);
    // An hour is fine; 4 h is the most.
    expect(cardioDraftWith({ kind: 'cardio', seconds: 1200, distanceM: null }, 'time', 99_999)).toEqual({ kind: 'cardio', seconds: 14_400, distanceM: null });
    const started = await s.workout.start({ gymId, opId: 'start-25', checkIn: skipped(), routineOf: saved.routine.id, ...(after?.draft ? { draft: { id: after.draft.id, expectedVersion: after.draft.version } } : {}) });
    if (!started.ok) throw new Error(started.error.message);
    expect(rowSetsOf(started.aggregate).map((x) => x.planned)).toEqual([expect.objectContaining({ durationS: 1500, distanceM: 5000 })]);
  });

  it('the Library Add sheet: a cardio machine opens with Time · Distance (never Work time); 30:00 · 6,000 m lands in the saved workout', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await rowWorkout(s, gymId, 1200, 4800);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Row day', opId: 'save-row', addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    const bikeId = catalogueExerciseId('exercise-bike');
    const bike = { movementPattern: 'conditioning' as const, measurement: 'cardio' as const, defaultLoadConvention: 'bodyweight' as const, compatibleEquipment: ['erg' as const] };
    let shape = initialAddShape(defaultSlotShape(bike), null, 'cardio');
    expect(addRepsRow(shape, false)).toEqual({ label: 'Time', text: '10:00' });
    const start = repsDraftOfShape(shape);
    expect(start).toEqual({ kind: 'cardio', seconds: 600, distanceM: null });
    shape = { ...shape, durationS: 1800, distanceM: 6000, repsTouched: true };
    expect(sp(addRepsRow(shape, false).text)).toBe('30:00 · 6,000 m');
    expect(slotShapeOfAdd(shape)).toMatchObject({ durationS: 1800, distanceM: 6000 });
    const r = await s.library.addToWorkout({ exerciseId: bikeId, shape, to: { kind: 'routine', routineId: saved.routine.id, expectedVersion: saved.routine.version }, opId: 'lib-bike' });
    expect(r.ok).toBe(true);
    const routine = (await s.routines.editor({ routineId: saved.routine.id, gymId: null }))?.routine;
    const slot = routine?.exercises.find((e) => e.exerciseId === bikeId);
    expect(slot?.setTemplates.map((t) => [t.targetDurationS, t.targetDistanceM])).toEqual([[1800, 6000]]);
    // The workout editor's Reps sheet on that slot is the cardio one too.
    expect(slotRepsDraft(slot?.setTemplates ?? [], true)).toEqual({ kind: 'cardio', seconds: 1800, distanceM: 6000 });
  });
});

describe('review S5: the time field reads and shows mm:ss', () => {
  it('20:34 typed (or 20.34 on the number pad) is 1,234 s and stays as typed; after Stop the field shows 20:34, never 20.57', () => {
    expect(CARDIO_TIME_FORMAT.parse('20:34')).toBe(1234);
    expect(CARDIO_TIME_FORMAT.parse('20.34')).toBe(1234);
    expect(nextFieldText('20.34', 1234, CARDIO_TIME_FORMAT)).toBe('20.34');
    // Half-typed: no value yet, and the text isn't replaced under Ben's thumb.
    expect(CARDIO_TIME_FORMAT.parse('20.3')).toBeNull();
    expect(nextFieldText('20.3', null, CARDIO_TIME_FORMAT)).toBe('20.3');
    // A value from the timer (Stop) or a step shows as the machine does.
    expect(nextFieldText('', 1234, CARDIO_TIME_FORMAT)).toBe('20:34');
    expect(nextFieldText('20:34', 1294, CARDIO_TIME_FORMAT)).toBe('21:34');
  });
});

describe('review S7: the cardio cap ends silently', () => {
  it('no in-app cue when a cardio timer reaches its cap; a timed set still cues', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: skipped() });
    if (!started.ok) throw new Error(started.error.message);
    await s.workout.pickerExercises(started.aggregate.session.id, '', { withCatalogue: true });
    const added = await s.workout.addExercise({ sessionId: started.aggregate.session.id, exerciseId: ROWER_ID, equipmentId: null, opId: 'add-row', shape: { workingSets: 1 } });
    if (!added.ok) throw new Error(added.error.message);
    const set = rowSetsOf(added.aggregate)[0];
    const timer = await s.workout.dispatch(started.aggregate.session.id, { type: 'start_work_interval', at: h.now(), opId: 'start-row', setId: set?.id ?? '', durationS: 1 });
    if (!timer.ok) throw new Error(timer.error.message);
    expect(cuesWorkEnd(timer.aggregate)).toBe(false);
    expect(cuesWorkEnd({ ...timer.aggregate, exercises: timer.aggregate.exercises.map((e) => ({ ...e, measurement: 'duration' as const })) })).toBe(true);
  });
});

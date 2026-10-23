import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, defaultSlotShape, slotsOf } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { LoadConvention, Routine, RoutineExercise, SessionAggregate } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { popupView, workoutView } from '../src/builder/builder-view';
import type { AppServices } from '../src/services/app-services';
import { initialAddShape } from '../src/workout/exercise-info-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review fixes for the Workout overview's retirement (docs/reviews/retire-workout-overview.md), on real SQLite,
 * offline:
 * - B1: a library workout or a past one opens on Your workout as the overview planned it (its own sets, reps, set
 *   types and Fixed loads at this gym), not rebuilt by the builder; what Your workout can't hold is named
 *   (`N left out`), and a workout of only those says so instead of `wasn't found`.
 * - B2 / high: a chat draft revised, or a library workout edited, after it was opened reloads (silently with no
 *   edits; with edits `… changed · Reload`), and a chat draft's Start on an older version is refused (rule 5).
 * - S1: a chat draft already saved isn't offered `Save to Workouts` again from Your workout.
 * - B3: the coach's `next workout` change isn't offered, and an older card's Apply is refused (it would change nothing).
 * - S5: two quick opens, a force-close mid-open, midnight, pain and a machine's max through `openTarget`.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-05T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`open ${r.status}: ${r.message}`);
};
const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((sl) => snap.facts[sl.exerciseId]?.name ?? '?');
const rowsOf = (snap: BuilderSnapshot, name: string) => slotsOf(snap.workout.blocks).find((sl) => snap.facts[sl.exerciseId]?.name === name)?.rows ?? [];

async function saved(s: AppServices, sessionId: string, name: string): Promise<Routine> {
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name, addToRotation: true, opId: `save-${name}` });
  if (!r.ok) throw new Error(r.message);
  return r.routine;
}

/** The page's working rows are the session's working sets, one for one (type, reps and load). */
function startedAsShown(snap: BuilderSnapshot, a: SessionAggregate | undefined): void {
  expect(a).toBeDefined();
  for (const slot of slotsOf(snap.workout.blocks)) {
    const ex = a?.exercises.find((e) => e.exerciseId === slot.exerciseId);
    const sets = [...(a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup') ?? [])].sort((x, y) => x.index - y.index);
    const rows = slot.rows.filter((r) => r.type !== 'warmup');
    expect(sets.map((x) => x.setType)).toEqual(rows.map((r) => r.type));
    expect(sets.map((x) => x.planned.load?.value ?? null)).toEqual(rows.map((r) => r.load));
  }
}

describe('B1: a library workout opens as saved, not rebuilt', () => {
  it('the reviewer’s probe: 5 × 5 squat and 2 × 20 lateral raise saved as `Five by five` open as 5 and 2 working sets (no top set or back-offs), and Start creates exactly that', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [
      { exercise: 'Back squat', sets: [1, 2, 3, 4, 5].map(() => ({ load: 100, reps: 5, rpe: 8 })) },
      { exercise: 'Lateral raise', sets: [{ load: 8, reps: 20 }, { load: 8, reps: 20 }] },
    ]);
    h.clockMs += DAY;
    const five = await saved(s, sid, 'Five by five');
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: five.id }, 'open-five'));
    expect(names(snap)).toEqual(['Back squat', 'Lateral raise']);
    expect(rowsOf(snap, 'Back squat').filter((r) => r.type !== 'warmup').map((r) => r.type)).toEqual(['working', 'working', 'working', 'working', 'working']);
    expect(rowsOf(snap, 'Lateral raise').filter((r) => r.type !== 'warmup').map((r) => r.type)).toEqual(['working', 'working']);
    expect(snap.leftOut).toEqual([]);
    // The overview's own planner at this gym: the same sets and loads the retired page showed.
    const planned = await s.routines.planned(five.id, gymId);
    const squat = planned?.aggregate.exercises.find((e) => e.exerciseName === 'Back squat');
    const plannedSquat = planned?.aggregate.sets.filter((x) => x.sessionExerciseId === squat?.id && x.setType !== 'warmup').map((x) => x.planned.load?.value ?? null);
    expect(rowsOf(snap, 'Back squat').filter((r) => r.type !== 'warmup').map((r) => r.load)).toEqual(plannedSquat);

    const started = await s.builder.start(snap.draftId, { opId: 'start-five', expectedVersion: snap.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    startedAsShown(snap, a);
    expect(a?.session.routineId).toBe(five.id);
  });

  it('(22 Oct) Fixed loads stand; cardio, a timed set and a second copy show on Your workout and Start creates them exactly as saved; a workout of only a timed set opens too', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const push = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] }]);
    const bench = (await s.workout.load(push))?.aggregate.exercises.find((e) => e.exerciseName === 'Bench press')?.exerciseId ?? '';
    h.clockMs += DAY;
    const slot = (exerciseId: string, n: number, t: Partial<RoutineExercise['setTemplates'][number]>): RoutineExercise => ({
      id: h.ids(),
      exerciseId,
      equipmentId: null,
      order: n,
      supersetGroup: null,
      setTemplates: [{ id: h.ids(), setType: 'working', targetLoad: null, targetReps: { min: 5, max: 5 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null, ...t }],
      restBySetType: {},
      transitionRestS: null,
      progressionRuleId: null,
    });
    const made = await s.routines.create({ edit: { name: 'Fixed', exercises: [slot(bench, 0, { targetLoad: { value: 42.5, unit: 'kg', convention: 'total' } }), slot(bench, 1, {})] }, opId: 'new-fixed' });
    if (!made.ok) throw new Error(made.message);
    // A timed plank and a cardio machine (time and distance), added from the Library.
    let version = made.routine.version;
    const addTo = async (exerciseId: string, shape: Parameters<AppServices['library']['addToWorkout']>[0]['shape'], opId: string) => {
      expect((await s.library.addToWorkout({ exerciseId, shape, to: { kind: 'routine', routineId: made.routine.id, expectedVersion: version }, opId })).ok).toBe(true);
      version += 1;
    };
    await addTo(catalogueExerciseId('bodyweight-plank'), { workingSets: 2, warmups: 0, reps: null, durationS: 45, effort: { scale: 'rpe', value: null }, repsTouched: true }, 'add-plank');
    const bike = { movementPattern: 'conditioning' as const, measurement: 'cardio' as const, defaultLoadConvention: 'bodyweight' as const, compatibleEquipment: ['erg' as const] };
    await addTo(catalogueExerciseId('exercise-bike'), { ...initialAddShape(defaultSlotShape(bike), null, 'cardio'), durationS: 1200, distanceM: 5000, repsTouched: true }, 'add-bike');
    const plank = (await s.routines.editor({ routineId: made.routine.id, gymId: null }))?.routine?.exercises.find((e) => e.setTemplates.some((t) => t.targetDurationS === 45))?.exerciseId ?? '';
    expect(plank).not.toBe('');

    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: made.routine.id }, 'open-fixed'));
    expect(names(snap)).toEqual(['Bench press', 'Bench press', 'Plank', 'Exercise bike']);
    expect(snap.leftOut).toEqual([]);
    const slots = slotsOf(snap.workout.blocks);
    expect(slots[0]?.rows.filter((r) => r.type !== 'warmup').map((r) => [r.reps, r.load])).toEqual([[5, 42.5]]);
    expect(slots[1]?.rows.filter((r) => r.type !== 'warmup').map((r) => r.reps)).toEqual([5]);
    expect(slots[0]?.key).not.toBe(slots[1]?.key);
    expect(rowsOf(snap, 'Plank').map((r) => [r.durationS, r.distanceM])).toEqual([
      [45, undefined],
      [45, undefined],
    ]);
    expect(rowsOf(snap, 'Exercise bike').map((r) => [r.durationS, r.distanceM])).toEqual([[1200, 5000]]);
    // The page shows them as the overview did: the time (and distance) where a load would be.
    const shown = workoutView(snap).rounds.flatMap((r) => r.rows);
    expect(shown.map((r) => r.topText.replaceAll('\u00a0', ' '))).toEqual(['42.5', expect.any(String), '0:45', '20:00 · 5,000 m']);
    expect(shown[2]?.accessibilityLabel).toContain('45 seconds');
    expect(shown[3]?.accessibilityLabel).toContain('20 minutes, 5 kilometres');
    // The pop-up shows the time in Reps and doesn't take typing there; no warm-up ramp for a timed set.
    const plankPop = popupView(snap, slots[2]?.key ?? '', () => 60);
    expect(plankPop?.rows.map((r) => [r.reps, r.repsText, r.editable])).toEqual([
      [null, '0:45', false],
      [null, '0:45', false],
    ]);
    expect(plankPop?.canAddWarmup).toBe(false);
    expect(popupView(snap, slots[3]?.key ?? '', () => 60)?.rows[0]?.repsText.replaceAll('\u00a0', ' ')).toBe('20:00 · 5,000 m');
    // The estimate counts the ride's 20 minutes.
    expect(snap.minutes).toBeGreaterThanOrEqual(22);
    expect(await s.builder.whyWeight(snap.draftId, slots[0]?.key ?? '')).toContain('Saved workout');
    // A ride has no load: its time is the saved workout's, never `Start light`.
    expect(await s.builder.whyWeight(snap.draftId, slots[3]?.key ?? '')).toEqual(['Saved workout']);

    // An edit elsewhere on the page re-encodes every slot: the timed and cardio sets stay as saved.
    const edited = opened(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: slots[1]?.key ?? '' }, { opId: 'edit-copy', basis: { version: snap.version } }));
    expect(rowsOf(edited, 'Exercise bike').map((r) => [r.durationS, r.distanceM])).toEqual([[1200, 5000]]);
    expect(slotsOf(edited.workout.blocks).map((x) => x.rows.filter((r) => r.type !== 'warmup').length)).toEqual([1, 2, 2, 1]);

    const started = await s.builder.start(edited.draftId, { opId: 'start-fixed', expectedVersion: edited.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    const rowsIn = (order: number) => {
      const ex = [...(a?.exercises ?? [])].filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order)[order];
      return { exerciseId: ex?.exerciseId, sets: [...(a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup') ?? [])].sort((x, y) => x.index - y.index) };
    };
    expect([0, 1, 2, 3].map((i) => rowsIn(i).exerciseId)).toEqual([bench, bench, plank, catalogueExerciseId('exercise-bike')]);
    expect(rowsIn(0).sets.map((x) => [x.planned.reps, x.planned.load?.value ?? null])).toEqual([[{ min: 5, max: 5 }, 42.5]]);
    expect(rowsIn(1).sets).toHaveLength(2);
    expect(rowsIn(2).sets.map((x) => [x.planned.reps, x.planned.durationS])).toEqual([
      [null, 45],
      [null, 45],
    ]);
    expect(rowsIn(3).sets.map((x) => [x.planned.reps, x.planned.durationS, x.planned.distanceM])).toEqual([[null, 1200, 5000]]);
    await s.workout.dispatch(started.sessionId, { type: 'discard', at: h.now(), opId: 'discard-fixed', confirmedLoggedSets: 0, expectedVersion: a?.session.version ?? 0 }).catch(() => null);

    // Only a timed set: it opens (no `Can’t open`) and starts as saved.
    const plankOnly = await s.routines.create({ edit: { name: 'Plank', exercises: [slot(plank, 0, { targetReps: null, targetDurationS: 60 })] }, opId: 'new-plank' });
    if (!plankOnly.ok) throw new Error(plankOnly.message);
    const only = opened(await s.builder.openTarget({ kind: 'routine', routineId: plankOnly.routine.id }, 'open-plank'));
    expect(names(only)).toEqual(['Plank']);
    expect(rowsOf(only, 'Plank').map((r) => r.durationS)).toEqual([60]);
  });
});

describe('B2 / high: what a draft was opened on moved since', () => {
  it('a library workout edited after it was opened: no edits, it reopens with the change; with edits, `… changed · Reload` (Undo puts the edits back)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }] }]);
    h.clockMs += DAY;
    const pushA = await saved(s, sid, 'Push A');
    const first = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-1'));
    expect(names(first)).toEqual(['Bench press']);
    const add = async (name: string, opId: string) => {
      const r = (await s.routines.editor({ routineId: pushA.id, gymId: null }))?.routine;
      if (r == null) throw new Error('no routine');
      const picks = await s.library.destinations(catalogueExerciseId(name));
      expect(picks).not.toBeNull();
      const w = await s.library.addToWorkout({ exerciseId: catalogueExerciseId(name), shape: { workingSets: 3, warmups: 0, reps: { min: 10, max: 12 }, durationS: null, effort: { scale: 'rpe', value: null }, repsTouched: false }, to: { kind: 'routine', routineId: pushA.id, expectedVersion: r.version }, opId });
      expect(w.ok).toBe(true);
    };
    await add('cable-fly', 'add-fly');
    const again = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-2'));
    expect(again.draftId).toBe(first.draftId);
    expect(names(again)).toEqual(['Bench press', 'Cable fly']);
    expect(again.planDayChanged).toBeNull();

    // Ben edits the page, then the workout changes again: the line, not a silent reload.
    const benchSlot = slotsOf(again.workout.blocks)[0];
    const edited = opened(await s.builder.edit(again.draftId, { kind: 'add_set', slotKey: benchSlot?.key ?? '' }, { opId: 'edit-1', basis: { version: again.version } }));
    await add('cable-triceps-pushdown', 'add-pushdown');
    const third = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-3'));
    expect(third.version).toBe(edited.version);
    expect(third.planDayChanged).toEqual({ text: 'Push A changed', silent: false });
    const reloaded = await s.builder.reloadPlanDay(third.draftId, { opId: 'reload-1', expectedVersion: third.version });
    expect(reloaded.status).toBe('written');
    if (reloaded.status !== 'written') return;
    expect(names(reloaded.snapshot)).toEqual(['Bench press', 'Cable fly', 'Triceps pushdown']);
    expect(reloaded.snapshot.planDayChanged).toBeNull();
    expect(reloaded.toast).toMatchObject({ text: 'Reloaded', undoOpId: 'reload-1' });
    const undone = await s.builder.undo(third.draftId, 'reload-1', 'undo-reload');
    expect(undone.snapshot === null ? 0 : rowsOf(undone.snapshot, 'Bench press').filter((r) => r.type !== 'warmup').length).toBe(3);
  });

  it('a chat draft revised after it was opened: reopened, it is the new version; opened with edits, Start on the old version is refused and the chat draft isn’t marked Started', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] },
      { exercise: 'Lateral raise', sets: [{ load: 8, reps: 12 }] },
    ]);
    h.clockMs += DAY;
    model = new StepModel([stub(['Bench press', 'Lateral raise']), () => replyWith('Here it is.')]);
    const r1 = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'build me a 45-minute push session', spoken: false }, turnId: h.ids() });
    const card = r1.cards[0]?.record;
    if (card?.detail.kind !== 'build_workout') throw new Error('no draft');
    const chatId = card.detail.draftId;
    const v1 = opened(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-chat-1'));
    expect(names(v1)).toEqual(['Bench press', 'Lateral raise']);

    const revise = async (keep: string[], text: string) => {
      model = new StepModel([stub(keep), () => replyWith('Done.')]);
      const r = await s.coach.send({ entry: { kind: 'draft', draftId: chatId, name: 'Push' }, threadId: r1.threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
      expect(r.cards[0]?.record.detail).toMatchObject({ kind: 'build_workout' });
    };
    await revise(['Lateral raise'], 'no bench today');
    expect((await s.coachDrafts.get(chatId))?.currentVersion).toBe(2);
    // No edits on the page: the same draft, reloaded silently to v2.
    const v2 = opened(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-chat-2'));
    expect(v2.draftId).toBe(v1.draftId);
    expect(names(v2)).toEqual(['Lateral raise']);

    // Edited, then the coach revises again: the old page can't start (stale), and v3 isn't marked Started.
    const lat = slotsOf(v2.workout.blocks)[0];
    const edited = opened(await s.builder.edit(v2.draftId, { kind: 'add_set', slotKey: lat?.key ?? '' }, { opId: 'edit-chat', basis: { version: v2.version } }));
    await revise(['Bench press', 'Lateral raise'], 'actually add bench back');
    const stale = await s.builder.start(edited.draftId, { opId: 'start-stale', expectedVersion: edited.version, checkIn: null });
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    expect(await s.sessions.active()).toBeNull();
    expect(await s.coachDrafts.get(chatId)).toMatchObject({ status: 'open', currentVersion: 3 });
    const page = opened(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-chat-3'));
    expect(page.planDayChanged).toEqual({ text: `${page.name} changed`, silent: false });
    const reloaded = await s.builder.reloadPlanDay(page.draftId, { opId: 'reload-chat', expectedVersion: page.version });
    if (reloaded.status !== 'written') throw new Error(reloaded.status);
    expect(names(reloaded.snapshot)).toEqual(['Bench press', 'Lateral raise']);
    const started = await s.builder.start(page.draftId, { opId: 'start-v3', expectedVersion: reloaded.snapshot.version, checkIn: null });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(await s.coachDrafts.get(chatId)).toMatchObject({ status: 'started', sessionId: started.sessionId, currentVersion: 3 });
  });

  it('S1: a chat draft already saved to Workouts isn’t offered `Save to Workouts` again on Your workout, and a save from there is refused', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] }]);
    h.clockMs += DAY;
    model = new StepModel([stub(['Bench press', 'Lateral raise']), () => replyWith('Here it is.')]);
    const r1 = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'build me a 45-minute push session', spoken: false }, turnId: h.ids() });
    const card = r1.cards[0]?.record;
    if (card?.detail.kind !== 'build_workout') throw new Error('no draft');
    const chatId = card.detail.draftId;
    const before = opened(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-s1'));
    expect(before.canSave).toBe(true);
    const savedChat = await s.routines.saveFrom({ from: { kind: 'draft', draftId: chatId, gymId }, name: 'Push', addToRotation: false, opId: 'save-chat' });
    expect(savedChat.ok).toBe(true);
    const after = await s.builder.read(before.draftId);
    expect(after?.canSave).toBe(false);
    expect(await s.routines.saveFrom({ from: { kind: 'draft', draftId: before.draftId, gymId }, name: 'Push 2', addToRotation: false, opId: 'save-builder' })).toMatchObject({ ok: false, reason: 'already_saved' });
    expect((await s.routines.list()).filter((r) => r.name.startsWith('Push'))).toHaveLength(1);
  });
});

describe('Re-review (R1–R5)', () => {
  const fixedSlot = (exerciseId: string, value: number, reps = { min: 5, max: 5 }, convention: LoadConvention = 'total'): RoutineExercise => ({
    id: h.ids(),
    exerciseId,
    equipmentId: null,
    order: 0,
    supersetGroup: null,
    setTemplates: [0, 1].map(() => ({ id: h.ids(), setType: 'working' as const, targetLoad: { value, unit: 'kg' as const, convention }, targetReps: reps, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null })),
    restBySetType: {},
    transitionRestS: null,
    progressionRuleId: null,
  });

  it('R1: the reviewer’s probe: 5 × (3–6) squat shows 3–6 and, after an edit elsewhere, Start plans 3–6 (not 3 × 3); a reps edit fixes only that set', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [
      { exercise: 'Back squat', sets: [1, 2, 3, 4, 5].map(() => ({ load: 100, reps: 5, rpe: 8 })) },
      { exercise: 'Lateral raise', sets: [{ load: 8, reps: 20 }, { load: 8, reps: 20 }] },
    ]);
    h.clockMs += DAY;
    const five = await saved(s, sid, 'Five');
    const planned = await s.routines.planned(five.id, gymId);
    const squatEx = planned?.aggregate.exercises.find((e) => e.exerciseName === 'Back squat');
    const plannedReps = planned?.aggregate.sets.filter((x) => x.sessionExerciseId === squatEx?.id && x.setType !== 'warmup').map((x) => x.planned.reps) ?? [];
    expect(plannedReps.length).toBe(5);
    expect(plannedReps.some((r) => r !== null && r.max > r.min)).toBe(true);

    let snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: five.id }, 'open-r1'));
    const squatRows = () => rowsOf(snap, 'Back squat').filter((r) => r.type !== 'warmup');
    expect(squatRows().map((r) => ({ min: r.reps, max: r.repsMax ?? r.reps }))).toEqual(plannedReps);
    const squatKey = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === 'Back squat')?.key ?? '';
    const latKey = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === 'Lateral raise')?.key ?? '';
    // The exercise pop-up shows the range, and says it.
    const pop = popupView(snap, squatKey, () => 120)?.rows.filter((r) => r.type !== 'warmup') ?? [];
    const range = plannedReps[0];
    expect(pop[0]?.repsText).toBe(range === null || range === undefined ? '' : `${String(range.min)}–${String(range.max)}`);
    expect(pop[0]?.accessibilityLabel).toContain(`${String(range?.min)} to ${String(range?.max)} reps`);
    snap = opened(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: latKey }, { opId: 'r1-add', basis: { version: snap.version } }));
    // Ben sets the last squat set to 5 reps.
    const lastSquat = rowsOf(snap, 'Back squat').length - 1;
    snap = opened(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: squatKey, index: lastSquat, patch: { kind: 'reps', reps: 5 } }, { opId: 'r1-reps', basis: { version: snap.version } }));
    // Force-close and relaunch: the range is stored, not just on screen.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const read = await s2.builder.read(snap.draftId);
    expect(read).not.toBeNull();
    if (read === null) return;
    const started = await s2.builder.start(read.draftId, { opId: 'start-r1', expectedVersion: read.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s2.workout.load(started.sessionId))?.aggregate;
    const ex = a?.exercises.find((e) => e.exerciseName === 'Back squat');
    const reps = [...(a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup') ?? [])].sort((x, y) => x.index - y.index).map((x) => x.planned.reps);
    expect(reps).toEqual([...plannedReps.slice(0, 4), { min: 5, max: 5 }]);
  });

  it('R2: `Gym changed` on a saved workout keeps its Fixed load at the new gym (the planner’s, not the builder’s rule); Undo puts it back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const push = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] }]);
    const bench = (await s.workout.load(push))?.aggregate.exercises.find((e) => e.exerciseName === 'Bench press')?.exerciseId ?? '';
    h.clockMs += DAY;
    const made = await s.routines.create({ edit: { name: 'Fixed', exercises: [fixedSlot(bench, 42.5)] }, opId: 'new-fixed-r2' });
    if (!made.ok) throw new Error(made.message);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: made.routine.id }, 'open-r2'));
    expect(rowsOf(snap, 'Bench press').filter((r) => r.type !== 'warmup').map((r) => r.load)).toEqual([42.5, 42.5]);
    const other = h.ids();
    expect((await s.setup.saveGym({ gymId: other, name: 'Second gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(other)).ok).toBe(true);
    const at = await s.builder.read(snap.draftId);
    expect(at?.gymChanged).toBe(true);
    const moved = await s.builder.changeGym(snap.draftId, { opId: 'gym-r2', expectedVersion: at?.version ?? 0 });
    if (moved.status !== 'written') throw new Error(moved.status);
    expect(moved.snapshot.gymId).toBe(other);
    expect(rowsOf(moved.snapshot, 'Bench press').filter((r) => r.type !== 'warmup').map((r) => r.load)).toEqual([42.5, 42.5]);
    expect(await s.builder.whyWeight(snap.draftId, slotsOf(moved.snapshot.workout.blocks)[0]?.key ?? '')).toContain('Saved workout');

    // Edited first (an extra set), then the gym changes: Ben's three sets stay, the saved ones at 42.5.
    const back = await s.builder.undo(snap.draftId, 'gym-r2', 'u-gym-r2');
    if (back.snapshot === null) throw new Error('no undo');
    const key = slotsOf(back.snapshot.workout.blocks)[0]?.key ?? '';
    const edited = opened(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: key }, { opId: 'r2-add', basis: { version: back.snapshot.version } }));
    const again = await s.builder.changeGym(snap.draftId, { opId: 'gym-r2b', expectedVersion: edited.version });
    if (again.status !== 'written') throw new Error(again.status);
    const rows = rowsOf(again.snapshot, 'Bench press').filter((r) => r.type !== 'warmup');
    expect(rows).toHaveLength(3);
    expect(rows.slice(0, 2).map((r) => r.load)).toEqual([42.5, 42.5]);
  });

  it('R3 / R5: a Fixed load over a machine’s max opens capped at the max (rule 4) and `Why this weight?` says so', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [
      { exercise: 'Triceps pushdown', sets: [{ load: 30, reps: 10, rpe: 8 }] },
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] },
    ]);
    const a0 = (await s.workout.load(sid))?.aggregate;
    const pushdown = a0?.exercises.find((e) => e.exerciseName === 'Triceps pushdown')?.exerciseId ?? '';
    h.clockMs += DAY;
    const pd = a0?.exercises.find((e) => e.exerciseName === 'Triceps pushdown');
    // On the gym's cable stack (the item Ben used), Fixed at 400 kg: past the stack's max.
    const made = await s.routines.create({ edit: { name: 'Heavy pushdown', exercises: [{ ...fixedSlot(pushdown, 400, { min: 10, max: 12 }, pd?.loadConvention ?? 'stack'), equipmentId: pd?.equipmentId ?? null }] }, opId: 'new-max' });
    if (!made.ok) throw new Error(made.message);
    const planned = await s.routines.planned(made.routine.id, gymId);
    const cap = planned?.aggregate.sets.find((x) => x.setType !== 'warmup')?.planned;
    expect(cap?.snap?.outcome).toBe('capped');
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: made.routine.id }, 'open-max'));
    const rows = rowsOf(snap, 'Triceps pushdown').filter((r) => r.type !== 'warmup');
    expect(rows.map((r) => r.load)).toEqual(rows.map(() => cap?.load?.value ?? null));
    for (const r of rows) expect(r.load ?? 0).toBeLessThan(400);
    const why = await s.builder.whyWeight(snap.draftId, slotsOf(snap.workout.blocks)[0]?.key ?? '');
    expect(why[0]).toBe('Saved workout');
    expect(why.some((l) => l.startsWith('Max here'))).toBe(true);
    // Start keeps the cap (never extrapolated past the max).
    const started = await s.builder.start(snap.draftId, { opId: 'start-max', expectedVersion: snap.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    startedAsShown(snap, (await s.workout.load(started.sessionId))?.aggregate);
  });

  it('R3: the reviewer’s repro: bench flagged for pain, its library workout’s `Why this weight?` says it is held, not just `Saved workout`', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }] }]);
    h.clockMs += DAY;
    const routine = await saved(s, sid, 'Bench day');
    const bench = routine.exercises[0]?.exerciseId ?? '';
    expect((await s.pain.flagMovement({ exerciseId: bench, exerciseName: 'Bench press', opId: 'pain-r3' })).ok).toBe(true);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-r3'));
    const why = await s.builder.whyWeight(snap.draftId, slotsOf(snap.workout.blocks)[0]?.key ?? '');
    expect(why.some((l) => /held/i.test(l))).toBe(true);
    expect(why).not.toEqual(['Saved workout']);
  });

  it('rule 4: a saved exercise with no item opens on this gym’s item, capped at its max (not 400 kg on a stack), and Start plans that', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [{ exercise: 'Triceps pushdown', sets: [{ load: 30, reps: 10, rpe: 8 }] }]);
    const pd = (await s.workout.load(sid))?.aggregate.exercises[0];
    h.clockMs += DAY;
    const made = await s.routines.create({ edit: { name: 'No item', exercises: [fixedSlot(pd?.exerciseId ?? '', 400, { min: 10, max: 12 }, pd?.loadConvention ?? 'stack')] }, opId: 'new-null' });
    if (!made.ok) throw new Error(made.message);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: made.routine.id }, 'open-null'));
    const rows = rowsOf(snap, 'Triceps pushdown').filter((r) => r.type !== 'warmup');
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.load).not.toBeNull();
      expect(r.load ?? 400).toBeLessThan(400);
    }
    expect(Object.values(snap.items).every((x) => x !== null)).toBe(true);
    // (O1) The shared planner now caps it on this gym's stack, so `Why?` names the planner's cap (`Max here …`), as for a pinned item.
    expect((await s.builder.whyWeight(snap.draftId, slotsOf(snap.workout.blocks)[0]?.key ?? '')).some((l) => l.startsWith('Max here'))).toBe(true);
    const started = await s.builder.start(snap.draftId, { opId: 'start-null', expectedVersion: snap.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    startedAsShown(snap, (await s.workout.load(started.sessionId))?.aggregate);
  });

  it('R4: saved from Your workout first, the chat card’s Save is refused and the card reads saved: one workout, not two', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] }]);
    h.clockMs += DAY;
    model = new StepModel([stub(['Bench press', 'Lateral raise']), () => replyWith('Here it is.')]);
    const r1 = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'build me a 45-minute push session', spoken: false }, turnId: h.ids() });
    const card = r1.cards[0]?.record;
    if (card?.detail.kind !== 'build_workout') throw new Error('no draft');
    const chatId = card.detail.draftId;
    const page = opened(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-r4'));
    expect(page.canSave).toBe(true);
    const fromPage = await s.routines.saveFrom({ from: { kind: 'draft', draftId: page.draftId, gymId }, name: 'Push', addToRotation: false, opId: 'save-page' });
    expect(fromPage.ok).toBe(true);
    expect(await s.routines.saveFrom({ from: { kind: 'draft', draftId: chatId, gymId }, name: 'Push 2', addToRotation: false, opId: 'save-chat-after' })).toMatchObject({ ok: false, reason: 'already_saved' });
    expect((await s.routines.list()).filter((r) => r.name.startsWith('Push'))).toHaveLength(1);
  });
});

describe('S5: opening under real conditions', () => {
  async function pushA(s: AppServices) {
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }] },
      { exercise: 'Lateral raise', sets: [{ load: 8, reps: 12 }] },
    ]);
    h.clockMs += DAY;
    return { gymId, routine: await saved(s, sid, 'Push A') };
  }

  it('two quick opens (two screens, two op IDs) are one draft; a force-close after opening resumes it on relaunch with a new op ID', async () => {
    let { services: s } = await h.launch();
    const { routine } = await pushA(s);
    const [a, b] = await Promise.all([s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'quick-1'), s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'quick-2')]);
    expect(opened(a).draftId).toBe(opened(b).draftId);
    await h.forceClose();
    ({ services: s } = await h.launch());
    expect(opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'after-relaunch')).draftId).toBe(opened(a).draftId);
  });

  it('opened before midnight and again after: a fresh draft today, yesterday’s offered as `Edits from`', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s);
    const night = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'late'));
    h.clockMs += DAY;
    const morning = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'early'));
    expect(morning.draftId).not.toBe(night.draftId);
    expect((await s.builder.earlierEdits()).map((e) => e.draftId)).toContain(night.draftId);
  });

  it('a pain-flagged exercise opens held at its last load and marked `May hurt` (rule 9)', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s);
    const bench = routine.exercises[0]?.exerciseId ?? '';
    expect((await s.pain.flagMovement({ exerciseId: bench, exerciseName: 'Bench press', opId: 'pain-1' })).ok).toBe(true);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-pain'));
    expect(snap.facts[bench]?.mayHurt).toBe(true);
    for (const r of rowsOf(snap, 'Bench press').filter((x) => x.type !== 'warmup')) expect(r.load ?? 0).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------

function buildOf(req: ModelRequest): { usable: { catalogueId: string; name: string }[] } {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build;
}
const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null });
function stub(keep: string[]) {
  return (req: ModelRequest): ModelEvent[] => {
    const b = buildOf(req);
    return toolCall('propose_workout', { name: 'Push', exercises: keep.map((n) => ex(b.usable.find((u) => u.name === n)?.catalogueId ?? `missing-${n}`)), message: 'Here.' });
  };
}

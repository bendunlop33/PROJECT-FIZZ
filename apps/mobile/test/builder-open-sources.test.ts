import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, defaultSlotShape, slotsOf } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { Routine, RoutineExercise, SessionAggregate } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
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

    const started = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-five', expectedVersion: snap.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    startedAsShown(snap, a);
    expect(a?.session.routineId).toBe(five.id);
  });

  it('Fixed loads stand; cardio, a timed set and a second copy are left out and named; a workout of only cardio says so', async () => {
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
    await addTo(catalogueExerciseId('bodyweight-plank'), { workingSets: 1, warmups: 0, reps: null, durationS: 45, effort: { scale: 'rpe', value: null }, repsTouched: true }, 'add-plank');
    const bike = { movementPattern: 'conditioning' as const, measurement: 'cardio' as const, defaultLoadConvention: 'bodyweight' as const, compatibleEquipment: ['erg' as const] };
    await addTo(catalogueExerciseId('exercise-bike'), { ...initialAddShape(defaultSlotShape(bike), null, 'cardio'), durationS: 1200, distanceM: 5000, repsTouched: true }, 'add-bike');
    const plank = (await s.routines.editor({ routineId: made.routine.id, gymId: null }))?.routine?.exercises.find((e) => e.setTemplates.some((t) => t.targetDurationS === 45))?.exerciseId ?? '';
    expect(plank).not.toBe('');

    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: made.routine.id }, 'open-fixed'));
    expect(names(snap)).toEqual(['Bench press']);
    expect(rowsOf(snap, 'Bench press').filter((r) => r.type !== 'warmup').map((r) => [r.reps, r.load])).toEqual([[5, 42.5]]);
    expect(snap.leftOut).toHaveLength(3);
    expect(snap.leftOut).toContain('Plank');
    expect(snap.leftOut.filter((n) => n === 'Bench press')).toHaveLength(1);
    expect(await s.builder.whyWeight(snap.draftId, slotsOf(snap.workout.blocks)[0]?.key ?? '')).toContain('Saved workout');
    const started = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-fixed', expectedVersion: snap.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    startedAsShown(snap, (await s.workout.load(started.sessionId))?.aggregate);
    await s.workout.dispatch(started.sessionId, { type: 'discard', at: h.now(), opId: 'discard-fixed', confirmedLoggedSets: 0, expectedVersion: (await s.workout.load(started.sessionId))?.aggregate.session.version ?? 0 }).catch(() => null);

    // Only cardio: honest, not `wasn't found`.
    const rideOnly = await s.routines.create({ edit: { name: 'Ride', exercises: [slot(plank, 0, { targetReps: null, targetDurationS: 60 })] }, opId: 'new-ride' });
    if (!rideOnly.ok) throw new Error(rideOnly.message);
    expect(await s.builder.openTarget({ kind: 'routine', routineId: rideOnly.routine.id }, 'open-ride')).toMatchObject({ status: 'closed', message: 'Can’t open this workout here yet.' });
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
    const stale = await s.builder.start(edited.draftId, { choice: { kind: 'today' }, opId: 'start-stale', expectedVersion: edited.version, checkIn: null });
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    expect(await s.sessions.active()).toBeNull();
    expect(await s.coachDrafts.get(chatId)).toMatchObject({ status: 'open', currentVersion: 3 });
    const page = opened(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-chat-3'));
    expect(page.planDayChanged).toEqual({ text: `${page.name} changed`, silent: false });
    const reloaded = await s.builder.reloadPlanDay(page.draftId, { opId: 'reload-chat', expectedVersion: page.version });
    if (reloaded.status !== 'written') throw new Error(reloaded.status);
    expect(names(reloaded.snapshot)).toEqual(['Bench press', 'Lateral raise']);
    const started = await s.builder.start(page.draftId, { choice: { kind: 'today' }, opId: 'start-v3', expectedVersion: reloaded.snapshot.version, checkIn: null });
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

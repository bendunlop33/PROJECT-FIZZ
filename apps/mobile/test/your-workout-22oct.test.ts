import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, slotsOf } from '@fizz/domain';
import type { Routine, RoutineExercise } from '@fizz/schemas';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { popupLinks, timeRowView, workoutView } from '../src/builder/builder-view';
import type { AppServices } from '../src/services/app-services';
import { swapPainConfirm } from '../src/ui/swap-sheet-model';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';
import { finishWorkout } from './finish-workout';

/**
 * Your workout, Ben's 22 Oct batch (the Workout overview's retirement follow-ups), on real SQLite, offline:
 * - the `May hurt` confirm before swapping to a flagged exercise (rule 9), as the overview had it;
 * - `How to` and `History` in the row pop-up, where the overview's rows had them;
 * - cardio, timed sets and the same exercise twice on Your workout, as saved (more in builder-open-sources B1);
 * - Time on Your workout (Ben: "add option to reduce time"): Today's built-in fit on today's draft only, no coach.
 */

const DAY = 86_400_000;
const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
let h: Harness;
let model: StepModel;
beforeEach(() => {
  // A connected coach that is only used to build a plan: Your workout's Time never calls it.
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

async function saved(s: AppServices, sessionId: string, name: string): Promise<Routine> {
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name, addToRotation: true, opId: `save-${name}` });
  if (!r.ok) throw new Error(r.message);
  return r.routine;
}

async function pushA(s: AppServices) {
  const gymId = await setUpGym(h, s);
  const sid = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 8, reps: 12 }] },
  ]);
  h.clockMs += DAY;
  return { gymId, routine: await saved(s, sid, 'Push A') };
}

describe('the `May hurt` confirm before a swap (rule 9)', () => {
  it('a flagged pick asks first, naming the flag; `Choose another` / `Swap anyway` (`Add anyway` when adding); an unflagged pick goes straight through', () => {
    expect(swapPainConfirm({ name: 'Overhead press', mayHurt: true, painLine: 'Shoulder pain flagged 6 Oct.' }, 'Swap')).toEqual({ title: 'Overhead press may hurt', message: 'Shoulder pain flagged 6 Oct.', cancel: 'Choose another', confirm: 'Swap anyway' });
    expect(swapPainConfirm({ name: 'Overhead press', mayHurt: true }, 'Add')).toEqual({ title: 'Overhead press may hurt', message: null, cancel: 'Choose another', confirm: 'Add anyway' });
    expect(swapPainConfirm({ name: 'Cable fly', mayHurt: false, painLine: null }, 'Swap')).toBeNull();
  });

  it('Your workout’s Swap list marks a flagged exercise `May hurt` with its flag line; the sheet confirms before picking it', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s);
    const fly = catalogueExerciseId('cable-fly');
    expect((await s.pain.flagMovement({ exerciseId: fly, exerciseName: 'Cable fly', opId: 'pain-fly' })).ok).toBe(true);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-push'));
    const bench = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === 'Bench press');
    const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: bench?.key ?? null, group: 'Chest' });
    const items = choices?.sections.flatMap((sec) => sec.items) ?? [];
    const flagged = items.find((i) => i.exerciseId === fly);
    expect(flagged).toMatchObject({ name: 'Cable fly', mayHurt: true, painLine: 'Pain flagged 6\u00a0Oct.' });
    expect(swapPainConfirm(flagged ?? { name: '', mayHurt: false }, 'Swap')).toMatchObject({ title: 'Cable fly may hurt', message: 'Pain flagged 6\u00a0Oct.', confirm: 'Swap anyway', cancel: 'Choose another' });
    for (const other of items.filter((i) => i.exerciseId !== fly)) expect(other).toMatchObject({ mayHurt: false, painLine: null });
  });

  it('the shared Swap sheet asks with that confirm before `onPick` (source)', () => {
    const sheet = read('ui/swap-sheet.tsx');
    // (Ben, 25 Oct) Suggestions and the full list share one ask: `swapPainConfirm` / `pickerConfirm`, then `onPick`.
    expect(sheet).toContain('ask(swapPainConfirm(it, actionWord), it.exerciseId);');
    expect(sheet).toContain('ask(pickerConfirm(r, actionWord), r.exerciseId);');
    expect(sheet).toContain('Alert.alert(c.title, c.message ?? undefined, [');
    expect(sheet).toContain("{ text: c.cancel, style: 'cancel' },");
  });
});

describe('`How to` and `History` in the row pop-up', () => {
  it('History only for an exercise Ben has logged (with this gym’s item and gym); How to only when it has a guide', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s);
    let snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-links'));
    // A never-logged exercise added on the page: no History.
    const added = await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: catalogueExerciseId('cable-fly') }, { opId: 'add-fly', basis: { version: snap.version } });
    snap = opened(added);
    const slotOf = (name: string) => slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === name);
    const bench = slotOf('Bench press');
    const fly = slotOf('Cable fly');
    expect(bench).toBeDefined();
    expect(fly).toBeDefined();
    expect(snap.facts[bench?.exerciseId ?? '']?.hasHistory).toBe(true);
    expect(snap.facts[fly?.exerciseId ?? '']?.hasHistory).toBe(false);
    const guides = new Set([fly?.exerciseId]);
    const howToOf = (x: { exerciseId: string; exerciseName: string }) => (guides.has(x.exerciseId) ? { catalogueKey: 'cable-fly', name: x.exerciseName } : null);
    const benchLinks = popupLinks(snap, bench?.key ?? '', howToOf);
    expect(benchLinks.howTo).toBeNull();
    expect(benchLinks.history).toEqual({ exerciseId: bench?.exerciseId, name: 'Bench press', ...(snap.items[bench?.key ?? ''] ? { equipmentId: snap.items[bench?.key ?? ''] } : {}), gymId: snap.gymId });
    expect(benchLinks.history?.equipmentId).toBeDefined();
    const flyLinks = popupLinks(snap, fly?.key ?? '', howToOf);
    expect(flyLinks).toEqual({ howTo: { catalogueKey: 'cable-fly', name: 'Cable fly' }, history: null });
    expect(popupLinks(snap, 'no-such-slot', howToOf)).toEqual({ howTo: null, history: null });
  });

  it('the pop-up shows the links only when given; Your workout closes the pop-up, then opens the guide or the history (source)', () => {
    const popup = read('ui/exercise-popup.tsx');
    expect(popup).toContain('label={POPUP_COPY.howTo}');
    expect(popup).toContain('label={POPUP_COPY.history}');
    expect(popup).toContain('p.onHowTo !== undefined || p.onHistory !== undefined ? (');
    const page = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(page).toContain('popupLinks(snap, popupSlot, (x) => howToRouteFor(x, bundledHowToSources()))');
    expect(page).toMatch(/setPopup\(null\);\s*navigation\.navigate\('HowTo', howTo\);/);
    expect(page).toMatch(/setPopup\(null\);\s*navigation\.navigate\('ExerciseProgress', history\);/);
    // The active workout's pop-up is unchanged: it has its own menu's How to and History.
    expect(read('screens/workout/WorkoutScreen.tsx')).not.toContain('onHowTo=');
  });
});

describe('cardio, timed sets and an exercise twice (as saved)', () => {
  it('`Gym changed` on a saved workout with bench twice and a plank: each copy keeps its own Fixed load and set count at the new gym; the plank keeps its time', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const push = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] }]);
    const bench = (await s.workout.load(push))?.aggregate.exercises.find((e) => e.exerciseName === 'Bench press')?.exerciseId ?? '';
    h.clockMs += DAY;
    const plank = catalogueExerciseId('bodyweight-plank');
    const template = (t: Partial<RoutineExercise['setTemplates'][number]>): RoutineExercise['setTemplates'][number] => ({ id: h.ids(), setType: 'working', targetLoad: null, targetReps: { min: 5, max: 5 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null, ...t });
    const ex = (exerciseId: string, order: number, sets: RoutineExercise['setTemplates']): RoutineExercise => ({ id: h.ids(), exerciseId, equipmentId: null, order, supersetGroup: null, setTemplates: sets, restBySetType: {}, transitionRestS: null, progressionRuleId: null });
    const fixed = (v: number) => template({ targetLoad: { value: v, unit: 'kg', convention: 'total' } });
    const made = await s.routines.create({ edit: { name: 'Twice', exercises: [ex(bench, 0, [fixed(42.5)]), ex(bench, 1, [fixed(50), fixed(50), fixed(50)]), ex(plank, 2, [template({ targetReps: null, targetDurationS: 60 })])] }, opId: 'new-twice' });
    if (!made.ok) throw new Error(made.message);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: made.routine.id }, 'open-twice'));
    const work = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).map((sl) => sl.rows.filter((r) => r.type !== 'warmup').map((r) => r.durationS ?? r.load));
    expect(work(snap)).toEqual([[42.5], [50, 50, 50], [60]]);
    const other = h.ids();
    expect((await s.setup.saveGym({ gymId: other, name: 'Second gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(other)).ok).toBe(true);
    const at = await s.builder.read(snap.draftId);
    expect(at?.gymChanged).toBe(true);
    const moved = await s.builder.changeGym(snap.draftId, { opId: 'gym-twice', expectedVersion: at?.version ?? 0 });
    if (moved.status !== 'written') throw new Error(moved.status);
    expect(moved.snapshot.gymId).toBe(other);
    expect(work(moved.snapshot)).toEqual([[42.5], [50, 50, 50], [60]]);
  });
});

// ---------------------------------------------------------------------------
// Time (22 Oct, Ben: "add option to reduce time")

async function bigPush(s: AppServices) {
  const gymId = await setUpGym(h, s);
  const three = (load: number, reps: number) => [0, 1, 2].map(() => ({ load, reps, rpe: 8 }));
  const sid = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: three(100, 6) },
    { exercise: 'Incline dumbbell press', sets: three(27.5, 9) },
    { exercise: 'Face pull', sets: three(20, 12) },
    { exercise: 'Triceps pushdown', sets: three(30, 12) },
    { exercise: 'Lateral raise', sets: three(8, 12) },
  ]);
  h.clockMs += DAY;
  return { gymId, routine: await saved(s, sid, 'Push B') };
}

/** Every slot as it would start: exercise, then each set's type, reps, load and RPE; and the rest level. */
const shapeOf = (x: BuilderSnapshot) => ({ rest: x.workout.restLevel, blocks: x.workout.blocks.map((b) => b.slots.map((sl) => `${x.facts[sl.exerciseId]?.name ?? '?'}:${sl.rows.map((r) => `${r.type}/${String(r.reps)}/${String(r.load)}/${String(r.rpe)}`).join(',')}`)) });

async function cutUntilDropped(s: AppServices, snap0: BuilderSnapshot): Promise<BuilderSnapshot> {
  let snap = snap0;
  for (let i = 0; i < 12 && snap.time?.changes.some((c) => c.kind === 'drop') !== true; i += 1) {
    const to = workoutView(snap).time.less;
    if (to === null) break;
    snap = opened(await s.builder.setTime(snap.draftId, to, { opId: `less-${String(snap.version)}`, expectedVersion: snap.version }));
  }
  return snap;
}

describe('Time on Your workout: the same built-in fit as Today’s, today’s draft only, no coach', () => {
  it('a saved workout gets shorter (rests, then sets, then a whole exercise, never the main lift), with a note and its detail; Start creates the shorter workout; the saved workout is untouched; no coach call', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s);
    const saved0 = (await s.routines.editor({ routineId: routine.id, gymId: null }))?.routine;
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-time'));
    const v0 = workoutView(snap0);
    expect(v0.time).toMatchObject({ minutes: snap0.setup.minutes, note: null, lines: [], undoMinutes: null });
    expect(snap0.time).toBeNull();
    const asked = model.requests.length;

    // One step: the length drops; rests go first.
    const one = opened(await s.builder.setTime(snap0.draftId, v0.time.less ?? 0, { opId: 'less-first', expectedVersion: snap0.version }));
    expect(one.setup.minutes).toBe(v0.time.less);
    expect(one.time?.changes[0]).toMatchObject({ kind: 'rest', from: 'normal' });

    const short = await cutUntilDropped(s, one);
    const v = workoutView(short);
    expect(v.time.note).toMatch(/^−\d+ exercises?$/);
    expect(v.time.lines.some((l) => l === 'Medium rest' || l === 'Minimum rest')).toBe(true);
    expect(v.time.lines.some((l) => l.startsWith('Dropped '))).toBe(true);
    expect(v.time.undoMinutes).toBe(snap0.setup.minutes);
    expect(short.minutes).toBeLessThan(snap0.minutes);
    expect(v.title).toBe(`Push B · about ${String(short.minutes)} min`);
    // The main lift stays with all its sets; nothing is ever added or made heavier.
    const benchBefore = slotsOf(snap0.workout.blocks).find((x) => snap0.facts[x.exerciseId]?.name === 'Bench press');
    const benchAfter = slotsOf(short.workout.blocks).find((x) => short.facts[x.exerciseId]?.name === 'Bench press');
    expect(benchAfter?.rows.map((r) => [r.type, r.reps, r.load, r.rpe])).toEqual(benchBefore?.rows.map((r) => [r.type, r.reps, r.load, r.rpe]));
    const before = new Map(slotsOf(snap0.workout.blocks).map((x) => [x.key, x]));
    for (const sl of slotsOf(short.workout.blocks)) {
      const was = before.get(sl.key);
      expect(was).toBeDefined();
      expect(sl.rows.length).toBeLessThanOrEqual(was?.rows.length ?? 0);
      sl.rows.forEach((r, i) => {
        expect(r.load).toBe(was?.rows[i]?.load);
        expect(r.rpe).toBe(was?.rows[i]?.rpe);
      });
    }
    // Supersets were off: none made.
    expect(short.workout.blocks.every((b) => b.slots.length === 1)).toBe(true);
    expect(model.requests.length).toBe(asked);

    // Start creates the shorter workout, as shown.
    const started = await s.builder.start(short.draftId, { opId: 'start-short', expectedVersion: short.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    const live = [...(a?.exercises ?? [])].filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order);
    expect(live.map((e) => e.exerciseId)).toEqual(slotsOf(short.workout.blocks).map((x) => x.exerciseId));
    for (const [i, sl] of slotsOf(short.workout.blocks).entries()) expect(a?.sets.filter((x) => x.sessionExerciseId === live[i]?.id && x.setType !== 'warmup').length).toBe(sl.rows.filter((r) => r.type !== 'warmup').length);
    // Today only: the saved workout is as it was.
    const saved1 = (await s.routines.editor({ routineId: routine.id, gymId: null }))?.routine;
    expect(saved1?.version).toBe(saved0?.version);
    expect(saved1?.exercises).toEqual(saved0?.exercises);
  });

  it('more time brings back what it cut, up to the original (never more); the detail’s Undo puts the original back in one step', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-back'));
    const short = await cutUntilDropped(s, snap0);
    expect(shapeOf(short)).not.toEqual(shapeOf(snap0));
    // Step back up: each step brings back some; at the original length it is the original exactly.
    let snap = short;
    for (let i = 0; i < 12 && workoutView(snap).time.note !== null; i += 1) {
      const to = workoutView(snap).time.more;
      if (to === null) break;
      snap = opened(await s.builder.setTime(snap.draftId, to, { opId: `more-${String(i)}`, expectedVersion: snap.version }));
    }
    expect(shapeOf(snap)).toEqual(shapeOf(snap0));
    expect(snap.time).toBeNull();
    // Longer still: nothing added.
    const longer = opened(await s.builder.setTime(snap.draftId, snap.setup.minutes + 30, { opId: 'longer', expectedVersion: snap.version }));
    expect(shapeOf(longer)).toEqual(shapeOf(snap0));
    // Cut again, then the detail's Undo: one write, the original back at the length before the first Time change
    // (review B1: the set-up's length; the longer step in between was Time's, today's only).
    const again = await cutUntilDropped(s, longer);
    const undoTo = workoutView(again).time.undoMinutes;
    expect(undoTo).toBe(again.time?.fromMinutes);
    expect(undoTo).toBe(snap0.setup.minutes);
    expect(undoTo ?? 0).toBeLessThan(longer.setup.minutes);
    const undone = opened(await s.builder.setTime(again.draftId, undoTo ?? 0, { opId: 'undo-time', expectedVersion: again.version }));
    expect(undone.version).toBe(again.version + 1);
    expect(shapeOf(undone)).toEqual(shapeOf(snap0));
    expect(undone.setup.minutes).toBe(undoTo);
    expect(undone.over).toBe(false);
    expect(workoutView(undone).time.note).toBeNull();
  });

  it('idempotent and versioned: a retried op ID writes once; a stale version writes nothing; a force-close keeps the fit, and more time still restores after relaunch', async () => {
    let { services: s } = await h.launch();
    const { routine } = await bigPush(s);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-ops'));
    const to = workoutView(snap0).time.less ?? 0;
    const first = await s.builder.setTime(snap0.draftId, to - 10, { opId: 'time-1', expectedVersion: snap0.version });
    expect(first.status).toBe('written');
    const retry = await s.builder.setTime(snap0.draftId, to - 10, { opId: 'time-1', expectedVersion: snap0.version });
    expect(retry.status).toBe('replayed');
    const cut = opened(first);
    expect(opened(retry).version).toBe(cut.version);
    const stale = await s.builder.setTime(snap0.draftId, to - 20, { opId: 'time-2', expectedVersion: snap0.version });
    expect(stale.status).toBe('stale');
    expect((await s.builder.read(snap0.draftId))?.version).toBe(cut.version);
    // The same length again writes nothing.
    expect((await s.builder.setTime(cut.draftId, cut.setup.minutes, { opId: 'same', expectedVersion: cut.version })).status).toBe('replayed');

    await h.forceClose();
    ({ services: s } = await h.launch());
    const read = await s.builder.read(cut.draftId);
    if (read === null) throw new Error('gone');
    expect(shapeOf(read)).toEqual(shapeOf(cut));
    expect(read.time?.fromMinutes).toBe(snap0.setup.minutes);
    expect(workoutView(read).time.note).toBe(workoutView(cut).time.note);
    const back = opened(await s.builder.setTime(read.draftId, snap0.setup.minutes, { opId: 'back', expectedVersion: read.version }));
    expect(shapeOf(back)).toEqual(shapeOf(snap0));
  });

  it('Ben’s edit after a fit stays when time comes back; Gym changed moves the original and fits it to Time again (note, more time and Undo still work)', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-edit'));
    const short = await cutUntilDropped(s, snap0);
    const dropped = (short.time?.changes ?? []).flatMap((c) => (c.kind === 'drop' ? [c.slotKey] : []));
    const bench = slotsOf(short.workout.blocks).find((x) => short.facts[x.exerciseId]?.name === 'Bench press');
    if (bench === undefined) throw new Error('no bench');
    const edited = opened(await s.builder.edit(short.draftId, { kind: 'add_set', slotKey: bench.key }, { opId: 'bench-set', basis: { version: short.version } }));
    const benchRows = slotsOf(edited.workout.blocks).find((x) => x.key === bench.key)?.rows.length ?? 0;
    expect(benchRows).toBe(bench.rows.length + 1);
    expect(workoutView(edited).time.note).toBe(workoutView(short).time.note);
    const back = opened(await s.builder.setTime(edited.draftId, snap0.setup.minutes, { opId: 'back-edit', expectedVersion: edited.version }));
    for (const k of dropped) expect(slotsOf(back.workout.blocks).some((x) => x.key === k)).toBe(true);
    expect(slotsOf(back.workout.blocks).find((x) => x.key === bench.key)?.rows.length).toBe(benchRows);

    // Gym changed (22 Oct review): the fit is undone, the original moves to the new gym and is fitted to Time again
    // there, so the shorter workout, its note and more time all still work; Undo puts the gym and the fit back.
    const again = await cutUntilDropped(s, back);
    const other = h.ids();
    expect((await s.setup.saveGym({ gymId: other, name: 'Second gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(other)).ok).toBe(true);
    const moved = await s.builder.changeGym(again.draftId, { opId: 'gym-time', expectedVersion: again.version });
    if (moved.status !== 'written') throw new Error(moved.status);
    expect(moved.snapshot.setup.minutes).toBe(again.setup.minutes);
    expect(moved.snapshot.time?.fromMinutes).toBe(again.time?.fromMinutes);
    expect(workoutView(moved.snapshot).time.note).toBe(workoutView(again).time.note);
    const counts = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).map((sl) => `${sl.key}×${String(sl.rows.filter((r) => r.type !== 'warmup').length)}`);
    expect(counts(moved.snapshot)).toEqual(counts(again));
    expect(moved.snapshot.workout.restLevel).toBe(again.workout.restLevel);
    const undone = await s.builder.undo(again.draftId, 'gym-time', 'undo-gym-time');
    expect(undone.status).toBe('written');
    if (undone.snapshot === null) throw new Error('no undo');
    expect(undone.snapshot.time?.fromMinutes).toBe(again.time?.fromMinutes);
    expect(workoutView(undone.snapshot).time.note).toBe(workoutView(again).time.note);
    // Moved again, then more time at the new gym: everything the fit cut is back (the new gym's loads), rests normal.
    const moved2 = await s.builder.changeGym(undone.snapshot.draftId, { opId: 'gym-time-2', expectedVersion: undone.snapshot.version });
    if (moved2.status !== 'written') throw new Error(moved2.status);
    const whole = opened(await s.builder.setTime(moved2.snapshot.draftId, moved2.snapshot.time?.fromMinutes ?? 0, { opId: 'whole-at-new-gym', expectedVersion: moved2.snapshot.version }));
    expect(whole.gymId).toBe(other);
    expect(whole.time).toBeNull();
    expect(whole.workout.restLevel).toBe('normal');
    expect(counts(whole)).toEqual(counts(back));
  });
});

// A plan day: a Time fit is today's only, never a plan change.
function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const planEx = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const DAYS: [string, string, string[]][] = [
  ['Push', 'push', ['Bench press', 'Incline dumbbell press', 'Dumbbell shoulder press', 'Triceps pushdown', 'Lateral raise']],
  ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
  ['Legs', 'legs', ['Back squat', 'Leg curl']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => planEx(idOf(n))) })), message: 'Push, pull, legs.', minutes: null, gymName: null });
};

describe('Time on a plan day: today only, never a plan change', () => {
  it('(D1) a Time fit alone never offers Keep for next time; with Ben’s own change, Apply writes his change and none of the cuts', async () => {
    const { services: s } = await h.launch();
    await bigPush(s);
    model = new StepModel([planStub, () => replyWith('Here is your week.')]);
    const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
    const card = result.cards[0]?.record;
    if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
    const c = await s.plans.card({ planId: card.detail.planId, versionN: 1 });
    expect(await s.plans.apply({ planId: card.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
    const push = (await s.plans.active())?.days[0]?.routineId;
    if (push === undefined) throw new Error('no push day');
    const template0 = (await s.routines.editor({ routineId: push, gymId: null }))?.routine;
    const asked = model.requests.length;

    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: push }, 'open-plan-day'));
    expect(snap0.planDay).not.toBeNull();
    const short = await cutUntilDropped(s, snap0);
    expect(short.time?.changes.length ?? 0).toBeGreaterThan(0);
    const timeOnly = await s.builder.start(short.draftId, { opId: 'start-short', expectedVersion: short.version });
    if (!timeOnly.ok) throw new Error(timeOnly.message);
    await finishWorkout(h, s, timeOnly.sessionId);
    expect(await s.builder.keepNextTimeOf(timeOnly.sessionId)).toBeNull();
    expect(model.requests.length).toBe(asked);
    h.clockMs += DAY;

    // Ben adds a set to the main lift: the row names only that; Apply writes it, and every exercise and set count
    // the fit cut stays in the plan.
    const again = opened(await s.builder.openTarget({ kind: 'routine', routineId: push }, 'open-plan-day-2'));
    const short2 = await cutUntilDropped(s, again);
    const bench = slotsOf(short2.workout.blocks).find((x) => x.main);
    if (bench === undefined) throw new Error('no main');
    const edited = opened(await s.builder.edit(short2.draftId, { kind: 'add_set', slotKey: bench.key }, { opId: 'plan-set', basis: { version: short2.version } }));
    const r = await s.builder.start(edited.draftId, { opId: 'start-edited', expectedVersion: edited.version });
    if (!r.ok) throw new Error(r.message);
    await finishWorkout(h, s, r.sessionId);
    const keep = await s.builder.keepNextTimeOf(r.sessionId);
    expect(keep?.state === 'open' ? keep.lines : null).toHaveLength(1);
    expect(keep?.state === 'open' ? keep.lines[0] : null).toMatch(/sets$/);
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toEqual({ ok: true });
    const template1 = (await s.routines.editor({ routineId: push, gymId: null }))?.routine;
    // (22 Oct review B1) The plan day keeps its own length, never Time's.
    expect(short2.setup.minutes).toBeLessThan(snap0.setup.minutes);
    expect(template1?.planDay?.minutes).toBe(template0?.planDay?.minutes);
    expect(template1?.exercises.map((e) => e.exerciseId)).toEqual(template0?.exercises.map((e) => e.exerciseId));
    const work = (rt: typeof template0) => rt?.exercises.map((e) => e.setTemplates.filter((t) => t.setType !== 'warmup').length) ?? [];
    const changed = work(template1).map((n, i) => n - (work(template0)[i] ?? 0));
    expect(changed.filter((d) => d !== 0)).toEqual([1]);
    // The session is today's shorter workout.
    const a = (await s.workout.load(r.sessionId))?.aggregate;
    expect(a?.exercises.filter((e) => e.removed === undefined)).toHaveLength(slotsOf(edited.workout.blocks).length);
  });
});

describe('Time on Your workout (source): the same control as Today’s; the screen only shows the service’s fit', () => {
  it('one TimeStepper for Today and Your workout; the note opens the detail with Undo; no fit or coach call on the screen', () => {
    const stepper = read('ui/time-stepper.tsx');
    expect(stepper).toContain('accessibilityRole="adjustable"');
    expect(stepper).toContain('TIME_LABELS.less');
    // One Time row with its note (fit-to-time 22 Oct revision) on Your workout; (redesign v3) Today's card shows the
    // estimate and opens the same fit detail, with no stepper of its own.
    expect(read('screens/today/TodaySession.tsx')).not.toContain('function TimeStepper(');
    expect(read('screens/TodayScreen.tsx')).toContain('<TimeDetailSheet');
    expect(stepper).toContain('<TimeStepper minutes={minutes} over={over} onStep={onStep} />');
    expect(stepper).toContain('color="status.warning"');
    const page = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(page).toContain("import { TimeDetailSheet, TimeNoteRow } from '../../ui/time-stepper';");
    expect(page).toContain('<TimeNoteRow');
    expect(page).toContain('services.builder.setTime(cur.draftId, to, { opId: newUuid(), expectedVersion: cur.version })');
    expect(page).toContain('onUndo={(back) => void setTime({ to: back })}');
    for (const banned of ['fitToMinutes', 'fitWorkoutToTime', 'unfitWorkout', 'builderCoach.askEdit({ draftId: cur.draftId, words: `']) expect(page).not.toContain(banned);
  });
});

describe('the Time row’s view', () => {
  const base = (minutes: number, time: BuilderSnapshot['time']): BuilderSnapshot => ({
    draftId: 'd',
    version: 1,
    setup: { dayId: 'custom', dayName: 'Push', dayParts: [], minutes, mainLiftExerciseId: null, supersets: false, groups: [], variationId: null, groupsEdited: true },
    workout: { blocks: [], restLevel: 'normal' },
    minutes,
    over: false,
    name: 'Push',
    planDay: null,
    variationLabel: null,
    undo: null,
    facts: { inc: { name: 'Incline DB press', works: null, group: 'Chest', compound: true, mayHurt: false, notHere: false, hasHistory: true }, pd: { name: 'Triceps pushdown', works: null, group: 'Arms', compound: false, mayHurt: false, notHere: false, hasHistory: true } },
    unit: 'kg',
    skipped: [],
    revs: {},
    planDayChanged: null,
    gymChanged: false,
    rests: {},
    items: {},
    startable: true,
    gymId: null,
    from: null,
    canSave: false,
    canSaveVariation: false,
    carry: null,
    leftOut: [],
    time,
    coachLanded: null,
    today: null,
  });

  it('the note is the biggest change (exercises, else sets, else rests); the detail lists them all; steps stop at 15 and 180', () => {
    const v = timeRowView(
      base(45, {
        fromMinutes: 60,
        changes: [
          { kind: 'rest', from: 'normal', to: 'shortest' },
          { kind: 'sets', slotKey: 'a', exerciseId: 'inc', from: 3, to: 2 },
          { kind: 'drop', slotKey: 'b', exerciseId: 'pd' },
        ],
      }),
    );
    expect(v).toMatchObject({ minutes: 45, note: '−1 exercise', lines: ['Minimum rest', 'Incline DB press 3 → 2 sets', 'Dropped Triceps pushdown'], undoMinutes: 60, less: 40, more: 50, noteLabel: 'Time changes: −1 exercise' });
    expect(v.valueText.replace('\u00a0', ' ')).toBe('45 min');
    expect(timeRowView(base(50, { fromMinutes: 60, changes: [{ kind: 'sets', slotKey: 'a', exerciseId: 'inc', from: 3, to: 2 }, { kind: 'sets', slotKey: 'c', exerciseId: 'pd', from: 3, to: 2 }] })).note).toBe('−2 sets');
    expect(timeRowView(base(55, { fromMinutes: 60, changes: [{ kind: 'rest', from: 'normal', to: 'shorter' }] })).note).toBe('medium rest');
    // No live fit, or a fit whose cuts Ben has since undone himself: no note, no Undo.
    expect(timeRowView(base(60, null))).toMatchObject({ note: null, lines: [], undoMinutes: null });
    expect(timeRowView(base(60, { fromMinutes: 60, changes: [] }))).toMatchObject({ note: null, undoMinutes: null });
    expect(timeRowView(base(15, null)).less).toBeNull();
    expect(timeRowView(base(180, null)).more).toBeNull();
    expect(timeRowView(base(47, null))).toMatchObject({ less: 45, more: 50 });
  });
});

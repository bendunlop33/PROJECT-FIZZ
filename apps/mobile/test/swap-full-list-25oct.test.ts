import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildExercisePickerView, catalogueExerciseId, currentGymEquipment, equipmentOfRow, isLoadAchievable, pickerConfirm, slotsOf, type CommandOutcome, type PickerIndex, type PickerRowView } from '@fizz/domain';
import type { CustomExerciseFields, Routine, SessionAggregate } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { applyTemplateEdit, openTemplate, saveTemplate, templateTarget } from '../src/workout/template-editor';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 25 Oct, iPhone: "When I swap exercises I don't have the option to select from all exercises.") The Swap /
 * Add sheet keeps its ranked suggestions and adds every exercise (catalogue + Ben's own) with the Library's search,
 * on real SQLite, offline, through the three hosts: Your workout (today's draft only), the one workout editor (the
 * template, versioned), and the workout in progress (today only, idempotent, Undo survives a force-close). An
 * exercise found only by search swaps in; Ben's own exercise is listed and taken; one the gym can't do is listed
 * last, `Not at Main Gym`, asks first, and its loads are never invented past the gym's kit (rule 4).
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-25T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`builder ${r.status}: ${'message' in r ? r.message : ''}`);
};
const ok = (r: CommandOutcome): SessionAggregate => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.aggregate;
};
const rowsOf = (v: ReturnType<typeof buildExercisePickerView>): PickerRowView[] => v.sections.flatMap((s) => s.parts.flatMap((p) => p.rows));
const view = (index: PickerIndex, query: string, exclude: readonly string[], suggested: readonly string[] = []) => buildExercisePickerView({ index, query, group: null, exclude, suggested });

const KROC: CustomExerciseFields = { name: 'Kroc row', equipment: 'dumbbells', loadConvention: 'per_hand', primaryMuscles: ['lats', 'biceps'], measurement: 'reps', laterality: 'unilateral' };

async function pushA(s: AppServices, preset: 'commercial' | 'home_dumbbells' = 'commercial'): Promise<{ gymId: string; routine: Routine; sessionId: string }> {
  const gymId = await setUpGym(h, s, preset);
  const sessionId = await logWorkout(h, s, gymId, [
    { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9, rpe: 8 }, { load: 27.5, reps: 9, rpe: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12, rpe: 8 }] },
  ]);
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name: 'Push A', addToRotation: true, opId: 'save-push-a' });
  if (!r.ok) throw new Error(r.message);
  h.clockMs += DAY;
  return { gymId, routine: r.routine, sessionId };
}

describe('Your workout: every exercise, today only', () => {
  it('an exercise only search finds (another group, not in the suggestions) swaps in; the template is untouched; a stale basis is refused; Undo', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-push'));
    const incline = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === 'Incline dumbbell press');
    if (incline === undefined) throw new Error('no incline slot');
    const suggested = (await s.builder.exerciseChoices(snap.draftId, { slotKey: incline.key }))?.sections.flatMap((x) => x.items.map((i) => i.exerciseId)) ?? [];
    expect(suggested.length).toBeGreaterThan(0);
    const index = await s.exercisePicker.forDraft(snap.draftId);
    // The whole catalogue is there (Ben's 237 + any of his own), minus what Your workout can't take (cardio etc.).
    expect(index.entries.length).toBeGreaterThan(150);
    const inWorkout = slotsOf(snap.workout.blocks).map((x) => x.exerciseId);
    // `rdl`: an alias, a Legs exercise, never in a Chest swap's suggestions.
    const rdl = rowsOf(view(index, 'rdl', inWorkout, suggested)).find((r) => r.name === 'Romanian deadlift');
    if (rdl === undefined) throw new Error('rdl not found');
    expect(suggested).not.toContain(rdl.exerciseId);
    expect(rdl.line).toContain('Matches');
    expect(pickerConfirm(rdl, 'Swap')).toBeNull();

    const swapped = opened(await s.builder.edit(snap.draftId, { kind: 'swap', slotKey: incline.key, exerciseId: rdl.exerciseId }, { opId: 'swap-rdl', basis: { version: snap.version } }));
    const slot = slotsOf(swapped.workout.blocks).find((x) => x.key === incline.key);
    expect(slot?.exerciseId).toBe(rdl.exerciseId);
    // Same place and set count (§2.5); the saved workout is not changed (today only).
    expect(slot?.rows.filter((r) => r.type !== 'warmup').length).toBe(incline.rows.filter((r) => r.type !== 'warmup').length);
    expect((await s.routines.editor({ routineId: routine.id, gymId: null }))?.routine?.version).toBe(routine.version);
    // A retry is the same write; a write on the older version is refused (rule 5).
    expect((await s.builder.edit(snap.draftId, { kind: 'swap', slotKey: incline.key, exerciseId: rdl.exerciseId }, { opId: 'swap-rdl', basis: { version: snap.version } })).status).toBe('replayed');
    const other = rowsOf(view(index, 'goblet', inWorkout))[0];
    if (other === undefined) throw new Error('no goblet');
    expect((await s.builder.edit(snap.draftId, { kind: 'swap', slotKey: incline.key, exerciseId: other.exerciseId }, { opId: 'swap-stale', basis: { version: snap.version } })).status).toBe('stale');
    // Undo puts the incline press back, also after a force-close.
    await h.forceClose();
    const s2 = (await h.launch()).services;
    const back = opened(await s2.builder.undo(snap.draftId, 'swap-rdl', 'undo-swap-rdl'));
    expect(slotsOf(back.workout.blocks).find((x) => x.key === incline.key)?.exerciseId).toBe(incline.exerciseId);
  });

  it('Ben’s own exercise is in the list, tagged `Yours`, found by its name, and adds', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s);
    const made = await s.customExercises.create({ fields: KROC, opId: 'kroc' });
    if (!made.ok) throw new Error(made.message);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-push'));
    const index = await s.exercisePicker.forDraft(snap.draftId);
    const kroc = rowsOf(view(index, 'kroc', slotsOf(snap.workout.blocks).map((x) => x.exerciseId)))[0];
    expect(kroc).toMatchObject({ exerciseId: made.exercise.id, name: 'Kroc row', tags: [{ kind: 'custom', text: 'Yours' }] });
    // Without a search it is under BACK with the rest.
    const all = buildExercisePickerView({ index, query: '', group: 'Back', exclude: [], suggested: [] });
    expect(rowsOf(all).map((r) => r.name)).toContain('Kroc row');
    const added = opened(await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: made.exercise.id }, { opId: 'add-kroc', basis: { version: snap.version } }));
    expect(slotsOf(added.workout.blocks).some((x) => x.exerciseId === made.exercise.id)).toBe(true);
    // A deleted one of his leaves the list.
    expect((await s.customExercises.remove({ exerciseId: made.exercise.id, expectedVersion: made.exercise.version, opId: 'del-kroc' })).ok).toBe(true);
    expect((await s.exercisePicker.forDraft(snap.draftId)).entries.some((e) => e.exercise.id === made.exercise.id)).toBe(false);
  });

  it('at a gym without the kit: listed last, dimmed `Not at Main Gym`, asks first; once picked the row says so and no load is made up (rule 4)', async () => {
    const { services: s } = await h.launch();
    const { routine } = await pushA(s, 'home_dumbbells');
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-push'));
    const lateral = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === 'Lateral raise');
    if (lateral === undefined) throw new Error('no lateral slot');
    const index = await s.exercisePicker.forDraft(snap.draftId);
    const shoulders = rowsOf(buildExercisePickerView({ index, query: '', group: 'Shoulders', exclude: [], suggested: [] }));
    const cable = shoulders.find((r) => r.name === 'Cable lateral raise');
    if (cable === undefined) throw new Error('no cable lateral raise');
    expect(cable).toMatchObject({ notHere: true, tags: [{ kind: 'not_here', text: 'Not at Main Gym' }] });
    // Last: every row the gym can do comes before it.
    const firstMiss = shoulders.findIndex((r) => r.notHere);
    expect(shoulders.slice(firstMiss).every((r) => r.notHere)).toBe(true);
    expect(shoulders.slice(0, firstMiss).length).toBeGreaterThan(0);
    expect(pickerConfirm(cable, 'Swap')).toEqual({ title: 'Main Gym has no cable station. Swap Cable lateral raise anyway?', message: null, cancel: 'Choose another', confirm: 'Swap anyway' });
    // `Swap anyway`: today's draft takes it, as a row Your workout already shows `Not at this gym`.
    const swapped = opened(await s.builder.edit(snap.draftId, { kind: 'swap', slotKey: lateral.key, exerciseId: cable.exerciseId }, { opId: 'swap-cable', basis: { version: snap.version } }));
    expect(swapped.facts[cable.exerciseId]?.notHere).toBe(true);
    const slot = slotsOf(swapped.workout.blocks).find((x) => x.key === lateral.key);
    expect(slot?.rows.every((r) => r.load === null)).toBe(true);
  });
});

describe('the one workout editor: every exercise, a template change', () => {
  it('swap to a search-only exercise and to an unavailable one; Save is one version; an older version is refused', async () => {
    const { services: s } = await h.launch();
    const { routine, gymId } = await pushA(s, 'home_dumbbells');
    const o = await openTemplate(s, { routineId: routine.id });
    if (o === null) throw new Error('not opened');
    const index = await s.exercisePicker.forTemplate(gymId);
    const inWorkout = o.list.map((e) => e.exerciseId);
    const squat = rowsOf(view(index, 'back squat', inWorkout)).find((r) => r.name === 'Back squat');
    if (squat === undefined) throw new Error('no squat');
    // A barbell exercise at a dumbbells-only gym: listed, tagged, asks.
    expect(squat.notHere).toBe(true);
    expect(pickerConfirm(squat, 'Swap')?.title).toMatch(/^Main Gym has no .+\. Swap Back squat anyway\?$/);
    const first = o.list[0];
    if (first === undefined) throw new Error('empty');
    const info = await s.routines.exerciseInfo([squat.exerciseId]);
    const x = info[squat.exerciseId];
    if (x === undefined) throw new Error('no info');
    const facts = await s.builder.templateFacts({ gymId, exerciseIds: [squat.exerciseId] });
    const ctx = { info: { ...o.info, [x.id]: x }, facts: { ...o.facts, ...facts }, gym: o.data.gym, unit: o.data.unit, globalDefault: o.data.globalDefault, effortScale: o.data.effortScale, stored: o.data.routine?.exercises ?? [] };
    const edited = applyTemplateEdit(o.list, { kind: 'swap', slotId: first.id, exercise: { id: x.id, measurement: x.measurement } }, ctx, () => h.ids()).list;
    expect(facts[squat.exerciseId]?.notHere).toBe(true);
    const saved = await saveTemplate(s.routines, { target: templateTarget({ routineId: routine.id }), edit: { name: o.name, exercises: edited }, expectedVersion: routine.version, opId: 'save-squat' });
    if (saved.kind !== 'saved') throw new Error(saved.kind);
    expect(saved.routine.version).toBe(routine.version + 1);
    expect(saved.routine.exercises[0]?.exerciseId).toBe(squat.exerciseId);
    const stale = await saveTemplate(s.routines, { target: templateTarget({ routineId: routine.id }), edit: { name: o.name, exercises: o.list }, expectedVersion: routine.version, opId: 'save-stale' });
    expect(stale.kind).not.toBe('saved');
  });

  it('distance exercises are never offered (a saved workout has no distance target)', async () => {
    const { services: s } = await h.launch();
    const { gymId } = await pushA(s);
    const index = await s.exercisePicker.forTemplate(gymId);
    expect(index.entries.every((e) => e.exercise.measurement !== 'distance')).toBe(true);
  });
});

describe('the workout in progress: every exercise, today only', () => {
  async function started(preset: 'commercial' | 'home_dumbbells') {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, preset);
    await logWorkout(h, s, gymId, [{ exercise: 'Lateral raise', sets: [{ load: 10, reps: 12, rpe: 8 }] }]);
    h.clockMs += DAY;
    const st = await s.workout.start({ gymId, opId: 'start-today', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!st.ok) throw new Error(st.error.message);
    const sessionId = st.aggregate.session.id;
    const a = ok(await s.workoutEdit.add(sessionId, catalogueExerciseId('dumbbell-lateral-raise'), 'add-lateral'));
    const lateral = a.exercises.find((e) => e.removed === undefined);
    if (lateral === undefined) throw new Error('no row');
    return { s, sessionId, lateral: lateral.id };
  }

  it('Swap to an exercise only search finds: pending sets move with loads on the gym’s kit; idempotent; Undo after a force-close', async () => {
    const { s, sessionId, lateral } = await started('commercial');
    const choices = await s.workoutEdit.choices(sessionId, { sessionExerciseId: lateral });
    const suggested = (choices?.sections ?? []).flatMap((x) => x.items.map((i) => i.exerciseId));
    const index = await s.exercisePicker.forSession(sessionId, lateral);
    // Swap keeps the measurement: a timed plank is not offered for a reps exercise.
    expect(index.entries.every((e) => e.exercise.measurement === 'reps')).toBe(true);
    const curl = rowsOf(view(index, 'hamer curl', [catalogueExerciseId('dumbbell-lateral-raise')], suggested)).find((r) => r.name.toLowerCase().includes('hammer'));
    if (curl === undefined) throw new Error('no hammer curl (typo search)');
    expect(suggested).not.toContain(curl.exerciseId);
    const r = await s.workoutEdit.swap(sessionId, lateral, curl.exerciseId, 'swap-curl');
    const after = ok(r);
    const row = after.exercises.find((e) => e.swappedFrom?.opId === 'swap-curl');
    if (row === undefined) throw new Error('no swap row');
    const eq = equipmentOfRow(after.session.equipmentSnapshot, row);
    expect(after.sets.filter((x) => x.sessionExerciseId === row.id && x.status === 'pending').every((x) => x.planned.load === null || eq === null || isLoadAchievable(x.planned.load, eq))).toBe(true);
    const again = await s.workoutEdit.swap(sessionId, lateral, curl.exerciseId, 'swap-curl');
    expect(again.ok && again.duplicate).toBe(true);
    await h.forceClose();
    const s2 = (await h.launch()).services;
    expect((await s2.workout.undoOp({ sessionId, targetOpId: 'swap-curl' })).ok).toBe(true);
  });

  it('Add one the gym can’t do (after `Add anyway`): no load is invented; Ben’s own exercise is in Add’s list', async () => {
    const { s, sessionId } = await started('home_dumbbells');
    const made = await s.customExercises.create({ fields: KROC, opId: 'kroc' });
    if (!made.ok) throw new Error(made.message);
    const a0 = await s.sessions.active();
    const live = (a0?.exercises ?? []).filter((e) => e.removed === undefined).map((e) => e.exerciseId);
    const index = await s.exercisePicker.forSession(sessionId, null);
    expect(rowsOf(view(index, 'kroc', live)).map((r) => r.name)).toEqual(['Kroc row']);
    const fly = rowsOf(view(index, 'cable fly', live)).find((r) => r.name === 'Cable fly');
    if (fly === undefined) throw new Error('no cable fly');
    expect(fly.notHere).toBe(true);
    expect(pickerConfirm(fly, 'Add')?.confirm).toBe('Add anyway');
    const a = ok(await s.workoutEdit.add(sessionId, fly.exerciseId, 'add-fly'));
    const row = a.exercises.find((e) => e.exerciseId === fly.exerciseId && e.removed === undefined);
    if (row === undefined) throw new Error('not added');
    // Nothing at this gym loads it: no planned load past what exists (rule 4).
    const eq = equipmentOfRow(a.session.equipmentSnapshot, row);
    expect(currentGymEquipment(a.session).some((e) => e.kind === 'weight_stack')).toBe(false);
    expect(a.sets.filter((x) => x.sessionExerciseId === row.id).every((x) => x.planned.load === null || (eq !== null && isLoadAchievable(x.planned.load, eq)))).toBe(true);
  });
});

describe('wiring (the sheet itself needs an iPhone)', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf8');
  it('all three hosts read the full list once per open and render the shared sheet; no search service call per keystroke', () => {
    const edits = read('screens', 'workout', 'WorkoutEdits.tsx');
    const builder = read('screens', 'builder', 'BuilderWorkoutScreen.tsx');
    const editor = read('screens', 'builder', 'EditWorkoutScreen.tsx');
    expect(edits).toContain('services.exercisePicker.forSession(');
    expect(builder).toContain('services.exercisePicker.forDraft(');
    expect(editor).toContain('services.exercisePicker.forTemplate(');
    for (const src of [edits, builder, editor]) {
      expect(src).toContain('usePickerView(');
      expect(src).toContain('useAddOwn');
      expect(src).not.toContain('routines.searchExercises');
    }
    const sheet = read('ui', 'swap-sheet.tsx');
    expect(sheet).toContain('pickerConfirm(r, actionWord)');
    expect(sheet).not.toContain('ActionSheetIOS');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addExercise, NBSP, mergeRoutineEdits, routineEditDirty, routineIssues, type RoutineEdit } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { RoutineExercise } from '@fizz/schemas';

import { backFromEditor, popToFromEditor } from '../src/navigation/actions';
import type { AppServices } from '../src/services/app-services';
import type { EditorExerciseInfo } from '../src/services/workout-services';
import { editorPrimary } from '../src/workout/library-view';
import { beginSaveEdit, saveEditRequest, settleSaveEdit, type SaveEditOutcome } from '../src/workout/save-edit-handoff';
import {
  applyTemplateEdit,
  editableOf,
  openTemplate,
  parseClock,
  parseMetres,
  parseRepRange,
  saveTemplate,
  templateKgStep,
  templatePopupView,
  templateTableView,
  templateTarget,
  undoTemplateSave,
  type TemplateEditOp,
  type TemplateEditorCtx,
  type TemplateOpened,
} from '../src/workout/template-editor';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct: "Why does the plan builder's workout builder look so different to the usual workout builder?") One
 * workout editor, on Your workout's page, for every way in: Library `＋` (New workout), a saved workout's `Edit`,
 * `Duplicate`, a plan day's `Edit`, `Save to Workouts › Edit ›` and Exercise detail's `New workout`. Real SQLite:
 * open → edits on the page (the shared table and pop-up's model) → Save (one version, opId) → the toast's Undo;
 * Cancel writes nothing; an older version is refused (rule 5) and Keep both saves on the newer one; a plan day's
 * change is to its template, never to a workout already done (rule 2); a typed load is rounded to this gym (rule 4).
 */

const DAY = 86_400_000;
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 12 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-12T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const newId = () => h.ids();

function ctxOf(o: TemplateOpened): TemplateEditorCtx {
  return { info: o.info, facts: o.facts, gym: o.data.gym, unit: o.data.unit, globalDefault: o.data.globalDefault, effortScale: o.data.effortScale, stored: o.data.routine?.exercises ?? [] };
}

/** The page: what it holds, and an edit as the screen applies it. */
class Page {
  name: string;
  list: RoutineExercise[];
  ctx: TemplateEditorCtx;
  constructor(readonly opened: TemplateOpened) {
    this.name = opened.name;
    this.list = opened.list;
    this.ctx = ctxOf(opened);
  }
  apply(op: TemplateEditOp): string | null {
    const r = applyTemplateEdit(this.list, op, this.ctx, newId);
    this.list = r.list;
    return r.note;
  }
  get edit(): RoutineEdit {
    return { name: this.name, exercises: this.list };
  }
  dirty(): boolean {
    return routineEditDirty(this.opened.base, this.edit);
  }
  primary(isNew: boolean) {
    return editorPrimary({ issues: routineIssues(this.edit, (id) => this.ctx.info[id]?.measurement === 'distance', this.ctx.stored), dirty: this.dirty(), isNew });
  }
  /** `＋ Add exercise` from the search (its info as the sheet has it). */
  async add(s: AppServices, name: string) {
    const x = (await s.routines.searchExercises(name)).find((e) => e.name === name);
    if (x === undefined) throw new Error(`no ${name}`);
    const facts = await s.builder.templateFacts({ gymId: this.ctx.gym?.id ?? null, exerciseIds: [x.id] });
    this.ctx = { ...this.ctx, info: { ...this.ctx.info, [x.id]: x }, facts: { ...this.ctx.facts, ...facts } };
    this.apply({ kind: 'add_exercise', exercise: { id: x.id, measurement: x.measurement }, shape: x.defaultShape });
    return x;
  }
  slot(name: string): RoutineExercise {
    const e = this.list.find((x) => this.ctx.info[x.exerciseId]?.name === name);
    if (e === undefined) throw new Error(`no ${name}`);
    return e;
  }
}

async function open(s: AppServices, req: Parameters<typeof openTemplate>[1]): Promise<Page> {
  const o = await openTemplate(s, req);
  if (o === null) throw new Error('could not open');
  return new Page(o);
}

async function ben(): Promise<{ s: AppServices; gymId: string; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const sessionId = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 8, rpe: 8 }, { load: 100, reps: 8, rpe: 8 }] },
    { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
  ]);
  h.clockMs += DAY;
  return { s, gymId, sessionId };
}

async function savedPushA(s: AppServices, sessionId: string) {
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name: 'Push A', addToRotation: true, opId: 'save-push-a' });
  if (!r.ok) throw new Error(r.message);
  return r.routine;
}

describe('the page shows Your workout’s table and pop-up for a saved workout', () => {
  it('numbered rounds, a superset as 2a/2b, Sets, `+N W`, Top set `Auto` or the Fixed load; works lines', async () => {
    const { s, sessionId } = await ben();
    const pushA = await savedPushA(s, sessionId);
    const p = await open(s, { routineId: pushA.id });
    expect(p.dirty()).toBe(false);
    expect(p.primary(false)).toEqual({ label: 'No changes', disabled: true });
    const incline = p.slot('Incline dumbbell press');
    const lateral = p.slot('Lateral raise');
    p.apply({ kind: 'superset_next', slotId: incline.id });
    p.apply({ kind: 'add_warmup', slotId: p.slot('Bench press').id });
    const t = templateTableView(p.list, p.ctx);
    expect(t.rounds.map((r) => r.rows.map((x) => x.label))).toEqual([['1'], ['2a', '2b']]);
    expect(t.rounds[1]?.superset).toBe(true);
    expect(t.rounds[0]?.rows[0]).toMatchObject({ name: 'Bench press', warmText: '+1 W', topText: 'Auto' });
    expect(t.rounds[0]?.rows[0]?.works).not.toBeNull();
    expect(t.rounds[1]?.rows.map((r) => r.actions.map((a) => a.name))).toEqual([
      ['delete', 'swap', 'move_up', 'move_down', 'unlink'],
      ['delete', 'swap', 'move_up', 'unlink'],
    ]);
    expect(t.topHeader).toBe('Top set (kg)');
    // Typed Fixed load on per-hand dumbbells: rounded down to the rack (rule 4), `each`.
    const v = templatePopupView(p.list, incline.id, p.ctx);
    const first = v?.rows[0];
    if (v === null || first === undefined) throw new Error('no pop-up');
    expect(v.kgHeader).toBe('Kg');
    expect(first.kgPlaceholder).toBe('Auto');
    const note = p.apply({ kind: 'cell', slotId: incline.id, setId: first.key, field: 'kg', value: 26.3 });
    const typed = p.list.find((e) => e.id === incline.id)?.setTemplates[0]?.targetLoad;
    expect(typed?.convention).toBe('per_hand');
    expect(typed?.value).toBeLessThanOrEqual(26.3);
    expect(note === null ? 'exact' : plain(note)).toMatch(/exact|At Start .* each/);
    expect(templateTableView(p.list, p.ctx).rounds[1]?.rows[0]?.topText).toMatch(/ each$/);
    // Equipment max: past the rack's heaviest dumbbell it's capped there, with the line saying so.
    const capped = p.apply({ kind: 'cell', slotId: incline.id, setId: first.key, field: 'kg', value: 500 });
    expect(plain(capped)).toMatch(/^Max here .* each$/);
    const max = p.list.find((e) => e.id === incline.id)?.setTemplates[0]?.targetLoad?.value ?? 0;
    expect(templateKgStep(p.list, incline.id, max, 1, p.ctx)).toBeNull();
    expect(templateKgStep(p.list, incline.id, max, -1, p.ctx)).toBeLessThan(max);
    // From an Auto cell, `+` starts at the last logged load (10 kg each), snapped here (design pass 5.1).
    expect(templateKgStep(p.list, lateral.id, null, 1, p.ctx)).toBe(10);
    // `Auto load` puts it back to Auto.
    p.apply({ kind: 'auto_load', slotId: incline.id, setId: first.key });
    expect(p.list.find((e) => e.id === incline.id)?.setTemplates[0]?.targetLoad).toBeNull();
    expect(lateral.id).toBeDefined();
  });

  it('the pop-up keeps everything the old editor had: per-set reps (range), type, RPE, rest by type (and Default), this set’s rest, Main, Add weight, slot reps and effort', async () => {
    const { s, sessionId } = await ben();
    const pushA = await savedPushA(s, sessionId);
    const p = await open(s, { routineId: pushA.id });
    const bench = p.slot('Bench press');
    const set1 = bench.setTemplates[0];
    if (set1 === undefined) throw new Error('no set');
    p.apply({ kind: 'cell', slotId: bench.id, setId: set1.id, field: 'reps', value: 5 });
    p.apply({ kind: 'set_type', slotId: bench.id, setId: set1.id, type: 'top' });
    p.apply({ kind: 'cell', slotId: bench.id, setId: set1.id, field: 'rpe', value: 8.3 });
    const second = p.slot('Bench press').setTemplates[1];
    if (second === undefined) throw new Error('no second set');
    p.apply({ kind: 'set_reps', slotId: bench.id, setId: second.id, reps: parseRepRange('10-6') ?? { min: 0, max: 0 } });
    p.apply({ kind: 'set_rest', slotId: bench.id, setId: second.id, seconds: 150 });
    p.apply({ kind: 'rest_step', slotId: bench.id, setType: 'top', dir: 1 });
    p.apply({ kind: 'main', slotId: bench.id, on: true });
    const after = p.slot('Bench press');
    expect(after.setTemplates[0]).toMatchObject({ setType: 'top', targetReps: { min: 5, max: 5 }, targetRpe: 8.5 });
    expect(after.setTemplates[1]).toMatchObject({ targetReps: { min: 6, max: 10 }, restOverrideS: 150 });
    expect(after.main).toBe(true);
    const v = templatePopupView(p.list, bench.id, p.ctx);
    expect(v?.rows.map((r) => [r.mark, r.typeText, r.repsText])).toEqual([
      ['1', 'Top set', '5'],
      ['2', 'Working · 2:30', '6–10'],
    ]);
    expect(v?.rests.map((r) => r.kind)).toEqual(['top', 'working']);
    expect(v?.rests[0]?.own).toBe(true);
    expect(v?.options).toMatchObject({ main: true, addedWeight: null, reps: { label: 'Reps' } });
    expect(v?.rows[0]?.extraActions?.map((a) => a.name)).toEqual(['reps_range', 'rest_after']);
    p.apply({ kind: 'rest_default', slotId: bench.id, setType: 'top' });
    expect(p.slot('Bench press').restBySetType.top).toBeUndefined();
    p.apply({ kind: 'slot_reps', slotId: bench.id, value: { reps: { min: 3, max: 5 } } });
    p.apply({ kind: 'slot_effort', slotId: bench.id, value: 9 });
    // `Reps` and `Target RPE` for the exercise: every non-warm-up set here (no plain working set left after the slot write).
    expect(p.slot('Bench press').setTemplates.every((t) => t.targetReps?.min === 3 || t.setType === 'top')).toBe(true);
    // Add weight on a bodyweight exercise (Ben, 18 Oct) is in the pop-up's options.
    const pullUp = await p.add(s, 'Pull-up');
    expect(pullUp.defaultLoadConvention).toBe('bodyweight');
    const pull = p.slot('Pull-up');
    expect(templatePopupView(p.list, pull.id, p.ctx)?.options.addedWeight).toBe(false);
    expect(templatePopupView(p.list, pull.id, p.ctx)?.rows[0]).toMatchObject({ kgEditable: false, kgPlaceholder: 'BW' });
    p.apply({ kind: 'added_weight', slotId: pull.id, on: true });
    expect(templatePopupView(p.list, pull.id, p.ctx)?.options.addedWeight).toBe(true);
    expect(templatePopupView(p.list, pull.id, p.ctx)?.rows[0]?.kgEditable).toBe(true);
    // The words on Save: one version with all of it.
    const r = await saveTemplate(s.routines, { target: { kind: 'edit', routineId: pushA.id, copy: false }, edit: p.edit, expectedVersion: pushA.version, opId: 'save-1' });
    expect(r.kind).toBe('saved');
    const stored = (await s.routines.editor({ routineId: pushA.id, gymId: null }))?.routine;
    expect(stored?.version).toBe(pushA.version + 1);
    expect(stored?.exercises.find((e) => e.exerciseId === bench.exerciseId)?.main).toBe(true);
  });

  it('lb gym with an assisted machine: the columns say lb; a typed assistance rounds toward more help and never past the machine’s max (rule 4)', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('lb');
    const draft = s.coachingKnowledge.buildGymDraft('commercial', 'lb');
    await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => (i.key === 'assisted' ? { ...i, ticked: true } : i)) } });
    await s.setup.complete();
    const p = await open(s, { routineId: null });
    expect(p.ctx.unit).toBe('lb');
    await p.add(s, 'Assisted pull-up');
    await p.add(s, 'Incline dumbbell press');
    const assist = p.slot('Assisted pull-up');
    const db = p.slot('Incline dumbbell press');
    expect(templateTableView(p.list, p.ctx).topHeader).toBe('Top set (lb)');
    expect(templatePopupView(p.list, assist.id, p.ctx)?.kgHeader).toBe('Lb');
    const note = p.apply({ kind: 'cell', slotId: assist.id, setId: assist.setTemplates[0]?.id ?? '', field: 'kg', value: 999 });
    const load = p.slot('Assisted pull-up').setTemplates[0]?.targetLoad;
    expect(load).toMatchObject({ unit: 'lb', convention: 'assistance' });
    expect(load?.value).toBeLessThan(999);
    expect(plain(note)).toMatch(/lb/);
    expect(templateTableView(p.list, p.ctx).rounds[0]?.rows[0]?.topText).toMatch(/assist$/);
    // Per-hand dumbbells in lb: rounded down on the rack, `each`.
    p.apply({ kind: 'cell', slotId: db.id, setId: db.setTemplates[0]?.id ?? '', field: 'kg', value: 52 });
    const dbLoad = p.slot('Incline dumbbell press').setTemplates[0]?.targetLoad;
    expect(dbLoad).toMatchObject({ unit: 'lb', convention: 'per_hand' });
    expect(dbLoad?.value).toBeLessThanOrEqual(52);
    expect(templateTableView(p.list, p.ctx).rounds[1]?.rows[0]?.topText).toMatch(/ each$/);
  });
});

describe('every entry point: Save, Cancel, Undo, stale (rule 5)', () => {
  it('Library ＋ New workout: empty, `Add a name` then `Add an exercise`; Save creates it once (opId); Undo deletes it; Cancel writes nothing', async () => {
    const { s } = await ben();
    expect(templateTarget({ routineId: null })).toEqual({ kind: 'new' });
    const p = await open(s, { routineId: null });
    expect(p.list).toEqual([]);
    expect(p.primary(true).label).toBe('Add a name');
    p.name = 'Arms';
    expect(p.primary(true).label).toBe('Add an exercise');
    await p.add(s, 'Barbell curl');
    expect(p.primary(true)).toEqual({ label: 'Save', disabled: false });
    const before = (await s.routines.list()).length;
    const r = await saveTemplate(s.routines, { target: { kind: 'new' }, edit: p.edit, expectedVersion: null, opId: 'new-1' });
    if (r.kind !== 'saved') throw new Error(JSON.stringify(r));
    expect(r.toast).toMatchObject({ text: 'Saved Arms', undo: { kind: 'delete', routineId: r.routine.id } });
    // A retried Save is the same save.
    const again = await saveTemplate(s.routines, { target: { kind: 'new' }, edit: p.edit, expectedVersion: null, opId: 'new-1' });
    expect(again.kind === 'saved' && again.routine.id).toBe(r.routine.id);
    expect((await s.routines.list()).length).toBe(before + 1);
    // Library ＋ → Save → Library › Workouts with the toast.
    expect(popToFromEditor('Library', r.toast)).toMatchObject({ payload: { params: { params: { params: { segment: 'workouts', toast: r.toast } } } } });
    if (r.toast.undo === null) throw new Error('no undo');
    expect(await undoTemplateSave(s.routines, r.toast.undo, 'undo-1')).toEqual({ ok: true });
    expect((await s.routines.list()).length).toBe(before);
    // Cancel: nothing written.
    const q = await open(s, { routineId: null });
    q.name = 'Legs';
    expect(backFromEditor('Library', undefined)).toEqual({ type: 'GO_BACK' });
    expect((await s.routines.list()).length).toBe(before);
  });

  it('a saved workout’s Edit: one version with an Undo record; Undo puts it back; a stale Save writes nothing and Keep both saves on the newer one; a force-close keeps only what was saved', async () => {
    const { s, sessionId } = await ben();
    const pushA = await savedPushA(s, sessionId);
    const p = await open(s, { routineId: pushA.id });
    p.name = 'Push A heavy';
    p.apply({ kind: 'delete_exercise', slotId: p.slot('Lateral raise').id });
    const r = await saveTemplate(s.routines, { target: templateTarget({ routineId: pushA.id }), edit: p.edit, expectedVersion: pushA.version, opId: 'edit-1' });
    if (r.kind !== 'saved') throw new Error(r.kind);
    expect(r.routine.version).toBe(pushA.version + 1);
    expect(r.toast).toMatchObject({ text: 'Saved Push A heavy', undo: { kind: 'revert' } });
    // Retried: the same save, no third version.
    const again = await saveTemplate(s.routines, { target: templateTarget({ routineId: pushA.id }), edit: p.edit, expectedVersion: pushA.version, opId: 'edit-1' });
    expect(again.kind === 'saved' && again.routine.version).toBe(pushA.version + 1);
    if (r.toast.undo === null) throw new Error('no undo');
    expect(await undoTemplateSave(s.routines, r.toast.undo, 'undo-edit-1')).toEqual({ ok: true });
    const back = await open(s, { routineId: pushA.id });
    expect(back.name).toBe('Push A');
    expect(back.list.map((e) => back.ctx.info[e.exerciseId]?.name)).toEqual(['Bench press', 'Incline dumbbell press', 'Lateral raise']);

    // Two pages open on the same version: the second Save is refused (rule 5), nothing written.
    const a = await open(s, { routineId: pushA.id });
    const b = await open(s, { routineId: pushA.id });
    const v = a.opened.data.routine?.version ?? 0;
    a.apply({ kind: 'add_set', slotId: a.slot('Bench press').id });
    expect((await saveTemplate(s.routines, { target: templateTarget({ routineId: pushA.id }), edit: a.edit, expectedVersion: v, opId: 'a-1' })).kind).toBe('saved');
    b.name = 'Push B';
    const st = await saveTemplate(s.routines, { target: templateTarget({ routineId: pushA.id }), edit: b.edit, expectedVersion: v, opId: 'b-1' });
    if (st.kind !== 'stale') throw new Error(st.kind);
    const now = await open(s, { routineId: pushA.id });
    expect(now.name).toBe('Push A');
    // Keep both: Ben's rename on the newer version (a new opId).
    const merged = mergeRoutineEdits(b.opened.base, b.edit, editableOf(st.current), {});
    const kept = await saveTemplate(s.routines, { target: templateTarget({ routineId: pushA.id }), edit: merged.merged, expectedVersion: st.current.version, opId: 'b-2' });
    if (kept.kind !== 'saved') throw new Error(kept.kind);
    expect(kept.routine.name).toBe('Push B');
    expect(kept.routine.exercises.find((e) => e.exerciseId === a.slot('Bench press').exerciseId)?.setTemplates.length).toBe(a.slot('Bench press').setTemplates.length);

    // Unsaved edits are lost on a force-close; what was saved stays.
    const c = await open(s, { routineId: pushA.id });
    c.name = 'Not saved';
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await open(s2, { routineId: pushA.id })).name).toBe('Push B');
  });

  it('Duplicate: the copy opens with its name selected; Save keeps the copy’s Undo (it deletes the copy); Cancel hands the copy’s toast back', async () => {
    const { s, sessionId } = await ben();
    const pushA = await savedPushA(s, sessionId);
    const dup = await s.routines.duplicate({ routineId: pushA.id, opId: 'dup-1' });
    if (!dup.ok) throw new Error(dup.message);
    const copyToast = { key: dup.routine.id, text: `Saved ${dup.routine.name}`, undo: { kind: 'delete' as const, routineId: dup.routine.id, version: dup.routine.version } };
    expect(backFromEditor('Library', copyToast)).toMatchObject({ payload: { params: { params: { params: { toast: copyToast } } } } });
    const target = templateTarget({ routineId: dup.routine.id, copyToast });
    expect(target).toEqual({ kind: 'edit', routineId: dup.routine.id, copy: true });
    const p = await open(s, { routineId: dup.routine.id });
    p.name = 'Push C';
    const r = await saveTemplate(s.routines, { target, edit: p.edit, expectedVersion: dup.routine.version, opId: 'dup-save' });
    if (r.kind !== 'saved') throw new Error(r.kind);
    expect(r.toast.undo).toEqual({ kind: 'delete', routineId: dup.routine.id, version: r.routine.version });
    if (r.toast.undo === null) throw new Error('no undo');
    expect(await undoTemplateSave(s.routines, r.toast.undo, 'dup-undo')).toEqual({ ok: true });
    expect((await s.routines.list()).map((x) => x.name)).not.toContain('Push C');
    expect((await s.routines.list()).map((x) => x.name)).toContain('Push A');
  });

  it('Save to Workouts › Edit ›: opens on the unsaved copy (not dirty); Save is the sheet’s own save under its opId; a retry is the same workout', async () => {
    const { s, sessionId } = await ben();
    const src = await s.routines.saveSource({ kind: 'session', sessionId });
    if (src === null || src === 'stale') throw new Error('no source');
    const got: SaveEditOutcome[] = [];
    beginSaveEdit('sheet-op', { from: { kind: 'session', sessionId }, addToRotation: false, opId: 'sheet-op' }, (o) => got.push(o));
    const target = templateTarget({ routineId: null, saveAs: 'sheet-op' });
    expect(target).toEqual({ kind: 'save_as', key: 'sheet-op' });
    const p = await open(s, { routineId: null, draft: { name: src.name, exercises: src.exercises }, saveAs: 'sheet-op' });
    expect(p.dirty()).toBe(false);
    expect(templateTableView(p.list, p.ctx).rounds).toHaveLength(3);
    p.apply({ kind: 'add_set', slotId: p.slot('Lateral raise').id });
    p.name = 'Shoulders too';
    const r = await saveTemplate(s.routines, { target, edit: p.edit, expectedVersion: null, opId: 'ignored' });
    if (r.kind !== 'saved_as') throw new Error(r.kind);
    expect(r.routine.name).toBe('Shoulders too');
    const again = await saveTemplate(s.routines, { target, edit: p.edit, expectedVersion: null, opId: 'ignored-2' });
    expect(again.kind === 'saved_as' && again.routine.id).toBe(r.routine.id);
    // The screen settles the sheet once; its host shows the toast.
    expect(settleSaveEdit('sheet-op', { kind: 'saved', routine: r.routine })).toBe(true);
    expect(saveEditRequest('sheet-op')).toBeNull();
    expect(got).toEqual([{ kind: 'saved', routine: r.routine }]);
    expect((await saveTemplate(s.routines, { target, edit: p.edit, expectedVersion: null, opId: 'x' })).kind).toBe('failed');
  });

  it('Exercise detail › New workout: opens with that exercise, needs a name; Save hands `Saved …` back to the detail', async () => {
    const { s } = await ben();
    const x = (await s.routines.searchExercises('Lateral raise')).find((e) => e.name === 'Lateral raise') as EditorExerciseInfo;
    const exercises = addExercise([], { id: x.id, measurement: x.measurement }, newId, { ...x.defaultShape, workingSets: 4 });
    const p = await open(s, { routineId: null, draft: { name: '', exercises } });
    expect(p.list).toHaveLength(1);
    expect(templateTableView(p.list, p.ctx).rounds[0]?.rows[0]).toMatchObject({ name: 'Lateral raise', setsText: '4' });
    expect(p.primary(true).label).toBe('Add a name');
    p.name = 'Delts';
    const r = await saveTemplate(s.routines, { target: { kind: 'new' }, edit: p.edit, expectedVersion: null, opId: 'info-new' });
    if (r.kind !== 'saved') throw new Error(r.kind);
    expect(popToFromEditor('ExerciseInfo', r.toast)).toEqual({ type: 'GO_BACK' });
    expect((await s.routines.list()).map((w) => w.name)).toContain('Delts');
  });
});

// A plan with a Push day (the coach's build, scripted).
function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
}
const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  const days: [string, string, string[]][] = [
    ['Push', 'push', ['Bench press', 'Incline dumbbell press']],
    ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
  ];
  return toolCall('propose_plan', { days: days.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((x) => ex(idOf(x))) })), message: 'Push, pull.', minutes: null, gymName: null });
};

describe('a plan day’s Edit (rule 2): its template for the weeks ahead, never a workout already done', () => {
  it('Save changes the plan day; the done session keeps what was done; Undo puts the template back', async () => {
    const { s, gymId } = await ben();
    model = new StepModel([planStub, () => replyWith('Here is your week.')]);
    const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 4-day plan', spoken: false }, turnId: h.ids() });
    const card = result.cards[0]?.record;
    if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
    const planId = card.detail.planId;
    const c = await s.plans.card({ planId, versionN: 1 });
    expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
    const push = (await s.plans.active())?.days[0]?.routineId ?? '';
    // Do the Push day once.
    const started = await s.workout.start({ gymId, opId: 'start-push', checkIn: null, routineOf: push });
    if (!started.ok) throw new Error(started.error.message);
    const sid = started.aggregate.session.id;
    for (const set of started.aggregate.sets.filter((x) => x.setType !== 'warmup')) {
      h.clockMs += 60_000;
      const conv = started.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
      const r = await s.workout.dispatch(sid, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
    const loaded = await s.workout.load(sid);
    const fin = await s.workout.dispatch(sid, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: loaded?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    const done = await s.workout.load(sid);
    const doneSets = done?.aggregate.sets.map((x) => [x.id, x.status, x.actual?.reps ?? null, x.actual?.load?.value ?? null]);
    const doneExercises = done?.aggregate.exercises.map((e) => e.exerciseId);
    h.clockMs += DAY;

    // Library › Plan › Push › Edit.
    const p = await open(s, { routineId: push });
    expect(p.list.map((e) => p.ctx.info[e.exerciseId]?.name)).toEqual(['Bench press', 'Incline dumbbell press']);
    const version = p.opened.data.routine?.version ?? 0;
    await p.add(s, 'Lateral raise');
    p.apply({ kind: 'add_set', slotId: p.slot('Bench press').id });
    p.apply({ kind: 'drop', slotId: p.slot('Lateral raise').id, targetId: p.slot('Incline dumbbell press').id, edge: 'onto' });
    expect(templateTableView(p.list, p.ctx).rounds.map((r) => r.rows.map((x) => x.label))).toEqual([['1'], ['2a', '2b']]);
    const r = await saveTemplate(s.routines, { target: templateTarget({ routineId: push }), edit: p.edit, expectedVersion: version, opId: 'plan-day-edit' });
    if (r.kind !== 'saved') throw new Error(r.kind);
    // Back to the plan day with `Saved Push · Undo` (handed off in memory).
    expect(popToFromEditor('PlanDay', r.toast)).toEqual({ type: 'GO_BACK' });
    const day = await s.plans.planDay(push);
    expect(day?.rows.map((x) => x.name)).toEqual(['Bench press', 'Incline dumbbell press', 'Lateral raise']);
    // The workout already done is as it was (rule 2).
    const still = await s.workout.load(sid);
    expect(still?.aggregate.sets.map((x) => [x.id, x.status, x.actual?.reps ?? null, x.actual?.load?.value ?? null])).toEqual(doneSets);
    expect(still?.aggregate.exercises.map((e) => e.exerciseId)).toEqual(doneExercises);
    // The plan still has the day (same routine), and Undo puts its template back.
    expect((await s.plans.active())?.days[0]?.routineId).toBe(push);
    if (r.toast.undo === null) throw new Error('no undo');
    expect(await undoTemplateSave(s.routines, r.toast.undo, 'plan-day-undo')).toEqual({ ok: true });
    expect((await s.plans.planDay(push))?.rows.map((x) => x.name)).toEqual(['Bench press', 'Incline dumbbell press']);
  });
});

describe('the prompts’ parsers (rep range, time, distance)', () => {
  it('reads what Ben types', () => {
    expect(parseRepRange('8-12')).toEqual({ min: 8, max: 12 });
    expect(parseRepRange('12–8')).toEqual({ min: 8, max: 12 });
    expect(parseRepRange(' 5 ')).toEqual({ min: 5, max: 5 });
    expect(parseRepRange('0')).toBeNull();
    expect(parseRepRange('abc')).toBeNull();
    expect(parseClock('1:30')).toBe(90);
    expect(parseClock('45')).toBe(45);
    expect(parseClock('20:00')).toBe(1200);
    expect(parseClock('1:75')).toBeNull();
    expect(parseClock('0')).toBeNull();
    expect(parseMetres('5,000')).toEqual({ metres: 5000 });
    expect(parseMetres('')).toEqual({ metres: null });
    expect(parseMetres('x')).toBeNull();
  });
});

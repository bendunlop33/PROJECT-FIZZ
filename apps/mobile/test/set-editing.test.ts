import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { committedLoad, loadNeedsFit, plannedEditSave } from '../src/workout/set-edit';
import { UNDO_TOAST } from '../src/workout/undo-op';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * 14 Oct (Ben, build 151): "I should be able to edit anything on the sets".
 * Edit set for a set not done yet, end to end on real SQLite with no coach:
 * the load is fitted to the gym's equipment, the edit is versioned and
 * survives a force-close, and Undo puts the plan back. Plus the save flow.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function benchWorkout(s: AppServices): Promise<string> {
  const gymId = await setUpGym(h, s);
  const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const picks = await s.workout.pickerExercises(sessionId, 'Bench press');
  const bench = picks.find((p) => p.exercise.name === 'Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-bench' });
  if (!added.ok) throw new Error(added.error.message);
  const row = added.aggregate.exercises[0]?.id ?? '';
  const more = await s.workout.addSet({ sessionId, sessionExerciseId: row, opId: 'add-set-2', newSetId: h.ids() });
  if (!more.ok) throw new Error(more.error.message);
  return sessionId;
}

describe('Edit set for a set not done yet, offline, through a force-close', () => {
  it('fits a typed load, saves one versioned edit, survives relaunch, and Undo puts the plan back', async () => {
    let { services: s } = await h.launch();
    expect((await s.coach.availability()).status).not.toBe('ok');
    const sessionId = await benchWorkout(s);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const second = data.aggregate.sets[1];
    if (!second) throw new Error('no second set');
    // A typed load the bar can't make becomes the nearest one it can (rule 4).
    const fitted = s.workout.snapPlannedLoad(data, second.id, 61.3);
    expect(fitted).not.toBe(61.3);
    expect(fitted).not.toBeNull();
    if (fitted === undefined) throw new Error('no fit');
    const view = s.workout.plannedEditView(data, second.id, { load: fitted, reps: { min: 5, max: 5 }, setType: 'top', restS: 150 });
    expect(view?.patch).toMatchObject({ load: { value: fitted, unit: 'kg', convention: 'total' }, reps: { min: 5, max: 5 }, setType: 'top', restS: 150 });
    const r = await s.workout.editPlannedSet({ sessionId, setId: second.id, expectedSetVersion: view?.setVersion ?? 0, patch: view?.patch ?? {}, opId: 'edit-1' });
    expect(r.ok).toBe(true);
    // A stale sheet is refused (rule 5).
    const stale = await s.workout.editPlannedSet({ sessionId, setId: second.id, expectedSetVersion: view?.setVersion ?? 0, patch: { restS: 60 }, opId: 'edit-2' });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_version' } });

    await h.forceClose();
    const relaunch = await h.launch();
    s = relaunch.services;
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const after = data.aggregate.sets.find((x) => x.id === second.id);
    expect(after).toMatchObject({ setType: 'top', rest: { seconds: 150 }, planned: { load: { value: fitted }, reps: { min: 5, max: 5 } } });
    // Logging never waited on anything: the current set is still the first one.
    expect(data.aggregate.session.activeSetId).toBe(data.aggregate.sets[0]?.id);

    const undone = await s.workout.undoOp({ sessionId, targetOpId: 'edit-1' });
    expect(undone.ok).toBe(true);
    const back = undone.ok ? undone.aggregate.sets.find((x) => x.id === second.id) : undefined;
    expect(back).toMatchObject({ setType: second.setType, rest: second.rest, planned: second.planned });
  });

  it('Insert set after: straight after that set, with Undo', async () => {
    const { services: s } = await h.launch();
    const sessionId = await benchWorkout(s);
    const data = await s.workout.load();
    const first = data?.aggregate.sets[0];
    if (!data || !first) throw new Error('no workout');
    const inserted = h.ids();
    const r = await s.workout.addSet({ sessionId, sessionExerciseId: first.sessionExerciseId, opId: 'ins-1', newSetId: inserted, afterSetId: first.id });
    if (!r.ok) throw new Error(r.error.message);
    const nav = s.workout.navigation({ ...data, aggregate: r.aggregate }, first.id);
    expect(nav.nextSetId).toBe(inserted);
    expect(UNDO_TOAST.added(2)).toBe('Set 2 added');
    const undone = await s.workout.undoOp({ sessionId, targetOpId: 'ins-1' });
    expect(undone.ok && undone.aggregate.sets.find((x) => x.id === inserted)?.status).toBe('deleted');
  });
});

describe('plannedEditSave: the edit, then the note', () => {
  const ok = (version: number, duplicate = false) => ({ ok: true as const, duplicate, aggregate: { session: { version } } });
  const no = (code: string) => ({ ok: false as const, error: { code, message: `refused: ${code}` } });

  it('an edit then a note on the version the edit returned', async () => {
    const seen: number[] = [];
    const r = await plannedEditSave({ patch: { restS: 90 }, note: 'grip', sessionVersion: 4, edit: () => Promise.resolve(ok(5)), setNote: (_n, v) => { seen.push(v); return Promise.resolve(ok(6)); } });
    expect(r).toEqual({ kind: 'edited', noteFailed: false });
    expect(seen).toEqual([5]);
  });

  it('a stale edit saves nothing and says so; the note is not tried', async () => {
    let noted = false;
    const r = await plannedEditSave({ patch: { restS: 90 }, note: 'grip', sessionVersion: 4, edit: () => Promise.resolve(no('stale_version')), setNote: () => { noted = true; return Promise.resolve(ok(6)); } });
    expect(r).toEqual({ kind: 'refused', message: 'This set changed since it was shown. Showing the latest.' });
    expect(noted).toBe(false);
  });

  it('a note that fails after a saved edit still hands over the edit’s Undo', async () => {
    expect(await plannedEditSave({ patch: { restS: 90 }, note: null, sessionVersion: 4, edit: () => Promise.resolve(ok(5)), setNote: () => Promise.resolve(no('stale_version')) })).toEqual({ kind: 'edited', noteFailed: true });
  });

  it('only a note, or an edit already saved by an earlier tap: back without an Undo toast', async () => {
    expect(await plannedEditSave({ patch: null, note: 'x', sessionVersion: 4, edit: () => Promise.resolve(ok(5)), setNote: () => Promise.resolve(ok(5)) })).toEqual({ kind: 'saved' });
    expect(await plannedEditSave({ patch: { restS: 90 }, note: undefined, sessionVersion: 4, edit: () => Promise.resolve(ok(5, true)), setNote: () => Promise.resolve(ok(5)) })).toEqual({ kind: 'saved' });
  });
});

describe('a typed load shows what will be saved (review S1)', () => {
  it('blur or Save turns 101 into the 100 the bar makes; a load nothing can make goes back to the stored one', () => {
    expect(loadNeedsFit(101, 100)).toBe(true);
    expect(committedLoad(101, 100)).toBe(100);
    expect(loadNeedsFit(100, 100)).toBe(false);
    expect(loadNeedsFit(null, null)).toBe(false);
    // Nothing fits (undefined): back to untouched, so the stored target shows and is kept.
    expect(loadNeedsFit(22, undefined)).toBe(true);
    expect(committedLoad(22, undefined)).toBeUndefined();
    expect(loadNeedsFit(undefined, undefined)).toBe(false);
  });
});

describe('screens wire it (source checks; the feel needs a real iPhone)', () => {
  const SRC = join(__dirname, '..', 'src', 'screens', 'workout');
  it('Edit set routes a set not done yet to its plan editor; the editor never computes a target', () => {
    const edit = readFileSync(join(SRC, 'EditSetScreen.tsx'), 'utf8');
    expect(edit).toContain('<PlannedSetEdit');
    const planned = readFileSync(join(SRC, 'PlannedSetEdit.tsx'), 'utf8');
    expect(planned).toContain('services.workout.plannedEditView(');
    // (Ben, 27 Oct) A typed load is kept as typed (no snapping here); the domain says what the gym learns.
    expect(planned).not.toContain('services.workout.snapPlannedLoad(');
    expect(planned).toContain('typedLoadPlan(aggregate, setId, typedLoad, data.bodyweightExercises)');
    expect(planned).not.toMatch(/roundToAvailableLoad|getAchievableLoads|stepLoad/);
    expect(planned).toContain('if (loadNeedsFit(typedLoad, snapped))');
  });
  it('a refusal survives the reload’s remount: the error lives in EditSetScreen (review S4)', () => {
    const edit = readFileSync(join(SRC, 'EditSetScreen.tsx'), 'utf8');
    expect(edit).toMatch(/error=\{error\}\s+onRefused=/);
    const planned = readFileSync(join(SRC, 'PlannedSetEdit.tsx'), 'utf8');
    expect(planned).not.toContain('setError(');
  });
});

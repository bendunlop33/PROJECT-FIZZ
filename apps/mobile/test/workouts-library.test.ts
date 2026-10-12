import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, setWorkingSetCount } from '@fizz/domain';
import type { Routine } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The Workouts library through the app services on real SQLite
 * (routines.md Part A, acceptance checks WL-A1–A15): the list's sections,
 * create / edit / Undo (also after a force-close) / conflict, duplicate,
 * delete and restore with the rotation, Save to Workouts from a finished
 * workout, a history row and an overview, Main, and no AI anywhere.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-05T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const DAY = 86_400_000;

async function saved(s: AppServices, sessionId: string, name: string, addToRotation: boolean): Promise<Routine> {
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name, addToRotation, opId: `save-${name}` });
  if (!r.ok) throw new Error(r.message);
  return r.routine;
}

async function library(s: AppServices, gymId: string | null) {
  const l = await s.routines.library({ gymId, sort: 'recent', showAllHistory: false });
  if (!l) throw new Error('no library');
  return l;
}

async function rename(s: AppServices, sessionId: string, label: string): Promise<void> {
  const loaded = await s.workout.load(sessionId);
  const r = await s.workout.dispatch(sessionId, { type: 'rename_session', at: h.now(), opId: h.ids(), name: label, expectedVersion: loaded?.aggregate.session.version ?? 0 });
  if (!r.ok) throw new Error(r.error.message);
}

/** A named `Shoulders` workout in history; Push A, Pull A, Legs A saved into the rotation in that order (Legs A done last, so Push A is next); Arms made new, never done. */
async function fixture(s: AppServices) {
  const gymId = await setUpGym(h, s);
  const shoulders = await logWorkout(h, s, gymId, [{ exercise: 'Overhead press', sets: [{ load: 40, reps: 8 }] }]);
  await rename(s, shoulders, 'Shoulders');
  h.clockMs += DAY;
  const push = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 8, reps: 12 }] },
  ]);
  const pushA = await saved(s, push, 'Push A', true);
  h.clockMs += DAY;
  const pull = await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }] }]);
  const pullA = await saved(s, pull, 'Pull A', true);
  h.clockMs += DAY;
  const legs = await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 80, reps: 5 }] }]);
  const legsA = await saved(s, legs, 'Legs A', true);
  const arms = await s.routines.create({ edit: { name: 'Arms', exercises: pushA.exercises.slice(1) }, opId: 'new-arms' });
  if (!arms.ok) throw new Error(arms.message);
  h.clockMs += DAY;
  return { gymId, pushA, pullA, legsA, arms: arms.routine, push, shoulders };
}

describe('the Workouts list (WL-A1)', () => {
  it('YOUR ROTATION from Up next, ALL WORKOUTS, FROM HISTORY; values only', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    const l = await library(s, f.gymId);
    expect(l.view.rotation.map((r) => [r.name, r.upNext])).toEqual([
      ['Push A', true],
      ['Pull A', false],
      ['Legs A', false],
    ]);
    expect(l.view.all.map((r) => r.name)).toEqual(['Arms']);
    // One set, no rest after it, and the harness's 60 s set gaps make Ben's recent pace 0 s a set under the one
    // estimator (`estimatePendingWork`, merged from main): an estimate of 0 isn't shown, never `≈ 0 min`.
    expect(plain(l.view.all[0]?.detail)).toBe('New · 1 exercise');
    expect(l.view.all[0]?.minutes).toBeNull();
    expect(l.view.history.map((x) => x.label)).toEqual(['Shoulders']);
    // A workout with rest in it has an estimate (one-set workouts are 0 here, as above).
    expect(l.view.rotation.find((r) => r.name === 'Push A')?.minutes).toBeGreaterThan(0);
    expect(l.active).toBeNull();
    // Today's Up next is the same workout.
    expect((await s.next.preview(f.gymId))?.title).toBe('Push A');
    // No gym: no estimates, still listed.
    expect((await library(s, null)).view.rotation.map((r) => r.minutes)).toEqual([null, null, null]);
  });

  it('the picker lists Up next, then YOUR WORKOUTS, then FROM HISTORY (WL-A3)', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    const l = await s.sessions.list(f.gymId);
    expect(l?.upNext?.label).toBe('Push A');
    expect(l?.workouts.map((r) => r.label)).toEqual(['Pull A', 'Legs A', 'Arms']);
    expect(l?.fromHistory.map((r) => r.label)).toEqual(['Shoulders']);
  });
});

describe('edit, Undo, conflict (WL-A4, A5, A6, A13)', () => {
  it('a save writes one version and a record; Undo restores it, also after a force-close; a later change blocks Undo', async () => {
    let { services: s } = await h.launch();
    const f = await fixture(s);
    const ed = await s.routines.editor({ routineId: f.pushA.id, gymId: f.gymId });
    if (!ed) throw new Error('no editor');
    expect(ed.inProgress).toBe(false);
    expect(ed.exercises.map((e) => e.main)).toEqual([true, false]);
    const exercises = ed.exercises.map((e, i) => (i === 1 ? { ...e, main: true, setTemplates: e.setTemplates.map((t) => ({ ...t, targetReps: { min: 6, max: 8 } })) } : e)).reverse();
    const edit = { name: 'Push A', exercises };
    const [a, b] = await Promise.all([
      s.routines.update({ routineId: f.pushA.id, edit, expectedVersion: f.pushA.version, opId: 'edit-1' }),
      s.routines.update({ routineId: f.pushA.id, edit, expectedVersion: f.pushA.version, opId: 'edit-1' }),
    ]);
    if (!a.ok || !b.ok) throw new Error('edit failed');
    expect(a.routine.version).toBe(2);
    expect(b.routine.version).toBe(2);
    expect(a.actionId).toBe(b.actionId);
    // An older expectedVersion: nothing written, the newer version back for the conflict sheet.
    const stale = await s.routines.update({ routineId: f.pushA.id, edit: { ...edit, name: 'X' }, expectedVersion: 1, opId: 'edit-stale' });
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    if (!stale.ok && stale.reason === 'stale') {
      expect(stale.current.version).toBe(2);
      expect(stale.lines.length).toBeGreaterThan(0);
    }

    await h.forceClose();
    s = (await h.launch()).services;
    const back = await s.routines.revert({ actionId: a.actionId ?? '', opId: 'undo-1' });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.routine.version).toBe(3);
    expect(back.routine.exercises.map((e) => e.exerciseId)).toEqual(f.pushA.exercises.map((e) => e.exerciseId));
    expect(back.routine.exercises.map((e) => e.main)).toEqual([true, false]);
    // Undo again is a no-op replay.
    expect((await s.routines.revert({ actionId: a.actionId ?? '', opId: 'undo-1' })).ok).toBe(true);

    // Save again, then rename: the save's Undo is refused and changes nothing.
    const again = await s.routines.update({ routineId: f.pushA.id, edit, expectedVersion: 3, opId: 'edit-2' });
    if (!again.ok) throw new Error(again.message);
    const renamed = await s.routines.rename({ routineId: f.pushA.id, name: 'Push B', expectedVersion: 4, opId: 'ren' });
    expect(renamed.ok).toBe(true);
    const refused = await s.routines.revert({ actionId: again.actionId ?? '', opId: 'undo-2' });
    expect(refused).toMatchObject({ ok: false, message: 'Can’t undo: Push A changed since.' });
    const lib = await library(s, f.gymId);
    expect(lib.view.rotation.find((r) => r.routineId === f.pushA.id)?.version).toBe(5);
  });

  it('a Fixed 37.5 kg each saves; at Start it is capped by the rack (rule 4); the running workout never changes', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s, 'home_dumbbells');
    const sid = await logWorkout(h, s, gymId, [{ exercise: 'Dumbbell bench press', sets: [{ load: 20, reps: 8 }] }]);
    const r = await saved(s, sid, 'DB', true);
    const ed = await s.routines.editor({ routineId: r.id, gymId });
    if (!ed?.gym) throw new Error('no gym');
    const slot = ed.exercises[0];
    if (!slot) throw new Error('no slot');
    const rack = ed.gym.equipment.find((e) => e.kind === 'dumbbells');
    if (rack?.kind !== 'dumbbells') throw new Error('no rack');
    const max = Math.max(...rack.loads);
    const pinned = { ...slot, setTemplates: slot.setTemplates.map((t) => ({ ...t, targetLoad: { value: max + 7.5, unit: 'kg' as const, convention: 'per_hand' as const } })) };
    const u = await s.routines.update({ routineId: r.id, edit: { name: 'DB', exercises: [pinned] }, expectedVersion: r.version, opId: 'pin' });
    if (!u.ok) throw new Error(u.message);
    expect(u.routine.exercises[0]?.setTemplates[0]?.targetLoad?.value).toBe(max + 7.5);
    h.clockMs += DAY;
    const started = await s.workout.start({ gymId, opId: 'start-db', checkIn: null, routineOf: r.id });
    if (!started.ok) throw new Error(started.error.message);
    const set = started.aggregate.sets.find((x) => x.setType !== 'warmup');
    expect(set?.planned.load).toEqual({ value: max, unit: 'kg', convention: 'per_hand' });
    // Edit while it runs: the note shows; the workout keeps its sets.
    const ed2 = await s.routines.editor({ routineId: r.id, gymId });
    expect(ed2?.inProgress).toBe(true);
    const before = JSON.stringify((await s.workout.load(started.aggregate.session.id))?.aggregate.sets);
    const u2 = await s.routines.update({ routineId: r.id, edit: { name: 'DB', exercises: [{ ...pinned, setTemplates: pinned.setTemplates.map((t) => ({ ...t, targetLoad: null })) }] }, expectedVersion: u.routine.version, opId: 'pin-2' });
    expect(u2.ok).toBe(true);
    expect(JSON.stringify((await s.workout.load(started.aggregate.session.id))?.aggregate.sets)).toBe(before);
    expect((await library(s, gymId)).active?.routineId).toBe(r.id);
  });
});

describe('duplicate and delete (WL-A7, A8)', () => {
  it('Duplicate makes `Push A copy` out of the rotation; Delete leaves the rotation and Undo puts it back in place', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    const [d1, d2] = await Promise.all([s.routines.duplicate({ routineId: f.pushA.id, opId: 'dup-1' }), s.routines.duplicate({ routineId: f.pushA.id, opId: 'dup-1' })]);
    if (!d1.ok || !d2.ok) throw new Error('dup failed');
    expect(d1.routine.id).toBe(d2.routine.id);
    expect(d1.routine).toMatchObject({ name: 'Push A copy', inRotation: false, createdFromRoutineId: f.pushA.id });
    let l = await library(s, f.gymId);
    expect(l.view.all.map((r) => r.name)).toContain('Push A copy');
    // Undo of a duplicate = delete it.
    const gone = await s.routines.remove({ routineId: d1.routine.id, expectedVersion: 1, opId: 'dup-undo' });
    expect(gone.ok).toBe(true);

    const del = await s.routines.remove({ routineId: f.pushA.id, expectedVersion: f.pushA.version, opId: 'del' });
    if (!del.ok) throw new Error(del.message);
    l = await library(s, f.gymId);
    expect(l.view.rotation.map((r) => r.name)).toEqual(['Pull A', 'Legs A']);
    // Past Push A workouts still open with their exercises.
    expect((await s.workout.load(f.push))?.aggregate.exercises.length).toBe(2);
    const undo = await s.routines.restore({ routineId: f.pushA.id, expectedVersion: del.routine.version, opId: 'del-undo' });
    expect(undo.ok).toBe(true);
    l = await library(s, f.gymId);
    expect(l.view.rotation.map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Legs A']);

    // Add / remove from the rotation (RT9), with Undo back to the same place.
    const out = await s.routines.setRotation({ routineId: f.pullA.id, on: false, expectedVersion: f.pullA.version, opId: 'rot-out' });
    if (!out.ok) throw new Error(out.message);
    expect((await library(s, f.gymId)).view.rotation.map((r) => r.name)).toEqual(['Push A', 'Legs A']);
    const back = await s.routines.setRotation({ routineId: f.pullA.id, on: true, expectedVersion: out.routine.version, opId: 'rot-back', placeAtUtc: f.pullA.rotationAtUtc ?? null });
    expect(back.ok).toBe(true);
    expect((await library(s, f.gymId)).view.rotation.map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Legs A']);
  });
});

describe('Save to Workouts (WL-A9, A10, A11, A12)', () => {
  it('a sled push is left out and listed on the save sheet (review S1); Repeat’s save lists it too; nothing saved as timed', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-sled', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const addAndLog = async (name: string, values: { load: { value: number; unit: 'kg'; convention: 'total' | 'added' } | null; reps: number | null; durationS: number | null; distanceM?: number }) => {
      const pick = (await s.workout.pickerExercises(sessionId, name, { withCatalogue: true })).find((p) => p.exercise.name === name);
      if (!pick) throw new Error(`no ${name}`);
      const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
      if (!added.ok) throw new Error(added.error.message);
      const ex = added.aggregate.exercises.at(-1);
      const set = added.aggregate.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup').sort((a, b) => a.index - b.index)[0];
      if (!set) throw new Error('no set');
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: h.ids(), setId: set.id, values: { ...values, rpe: null, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    };
    await addAndLog('Bench press', { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null });
    await addAndLog('Sled push', { load: { value: 40, unit: 'kg', convention: 'added' }, reps: null, durationS: 30, distanceM: 20 });
    const data = await s.workout.load(sessionId);
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);

    const src = await s.routines.saveSource({ kind: 'session', sessionId });
    if (src === 'stale' || src === null) throw new Error('no source');
    expect(src.detail).toBe('1 exercise · 1 set');
    expect(src.notSaved).toBe('Not copied: 1 distance set (Sled push)');
    const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name: 'Legs', addToRotation: false, opId: 'save-legs' });
    if (!r.ok) throw new Error(r.message);
    expect(r.routine.exercises).toHaveLength(1);
    expect(r.routine.exercises.flatMap((e) => e.setTemplates).every((t) => t.targetDurationS === null)).toBe(true);

    // Repeat's save: the same sled push listed, never a timed template.
    const rep = await s.routines.saveSource({ kind: 'repeat', sessionId, gymId });
    if (rep === 'stale' || rep === null) throw new Error('no repeat source');
    expect(rep.notSaved).toBe('Not copied: 1 distance set (Sled push)');
    const rr = await s.routines.saveFrom({ from: { kind: 'repeat', sessionId, gymId }, name: 'Legs again', addToRotation: false, opId: 'save-legs-2' });
    if (!rr.ok) throw new Error(rr.message);
    expect(rr.routine.exercises.flatMap((e) => e.setTemplates).every((t) => t.targetDurationS === null)).toBe(true);
    // A workout with no distance: nothing listed.
    const plainSid = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const none = await s.routines.saveSource({ kind: 'session', sessionId: plainSid });
    expect(none !== 'stale' && none?.notSaved).toBeNull();
  });

  it('an Empty workout saves done exercises and set counts with Auto loads; the next overview has targets from it; the workout is unchanged', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] },
    ]);
    const before = await s.workout.load(sid);
    const src = await s.routines.saveSource({ kind: 'session', sessionId: sid });
    if (src === 'stale') throw new Error('stale');
    expect(plain(src?.name)).toBe('Workout · Mon 5 Oct');
    expect(src?.detail).toBe('2 exercises · 5 sets');
    const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId: sid }, name: src?.name ?? '', addToRotation: false, opId: 'save-empty' });
    if (!r.ok) throw new Error(r.message);
    expect(r.routine.exercises.flatMap((e) => e.setTemplates).every((t) => t.targetLoad === null)).toBe(true);
    expect(r.routine.exercises.map((e) => e.setTemplates.length)).toEqual([3, 2]);
    expect(r.routine.exercises.map((e) => e.main)).toEqual([true, true]);
    expect(r.routine.inRotation).toBe(false);
    expect((await s.workout.load(sid))?.aggregate).toEqual(before?.aggregate);
    h.clockMs += 2 * DAY;
    const page = await s.overview.load({ target: { kind: 'routine', routineId: r.routine.id }, gymId });
    expect(page?.view.rows.map((x) => x.name)).toEqual(['Bench press', 'Barbell row']);
    // Targets from the built-in rule using the source workout: a load, never Auto.
    expect(page?.view.rows.every((x) => x.load.value !== '')).toBe(true);
    expect(Number(page?.view.rows[0]?.load.value)).toBeGreaterThanOrEqual(60);
    // Not in the rotation: Up next isn't it.
    expect((await s.next.preview(gymId))?.routine).toBeNull();
  });

  it('N6 (Ben, 12 Oct): a FROM HISTORY row saved under another name leaves its older sessions under FROM HISTORY; no history is rewritten', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    // A second, newer `Shoulders` workout.
    const newer = await logWorkout(h, s, f.gymId, [{ exercise: 'Overhead press', sets: [{ load: 42.5, reps: 8 }] }]);
    await rename(s, newer, 'Shoulders');
    h.clockMs += DAY;
    const row = (await library(s, f.gymId)).view.history.find((x) => x.label === 'Shoulders');
    if (!row) throw new Error('no history');
    expect(row.sourceSessionId).toBe(newer);
    const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId: row.sourceSessionId }, name: 'Shoulders A', addToRotation: false, opId: 'save-sh-a' });
    if (!r.ok) throw new Error(r.message);
    const after = await library(s, f.gymId);
    expect(after.view.all.map((x) => x.name)).toContain('Shoulders A');
    // The older `Shoulders` session keeps its name and stays a FROM HISTORY row (in the library and the picker).
    expect(after.view.history.map((x) => [x.label, x.sourceSessionId])).toEqual([['Shoulders', f.shoulders]]);
    expect((await s.sessions.list(f.gymId))?.fromHistory.map((x) => x.label)).toEqual(['Shoulders']);
    expect((await s.workout.load(f.shoulders))?.aggregate.session.routineName).toBe('Shoulders');
    expect((await s.workout.load(newer))?.aggregate.session.routineName).toBe('Shoulders');
  });

  it('a history row saves from its latest workout and keeps its history; nothing to save says so', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    const l = await library(s, f.gymId);
    const row = l.view.history[0];
    if (!row) throw new Error('no history');
    const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId: row.sourceSessionId }, name: row.label, addToRotation: false, opId: 'save-sh' });
    if (!r.ok) throw new Error(r.message);
    const after = await library(s, f.gymId);
    expect(after.view.history).toEqual([]);
    const sh = after.view.all.find((x) => x.name === 'Shoulders');
    expect(sh?.lastDone).not.toBeNull();
    expect(plain(sh?.detail)).toMatch(/days ago$/);

    // A workout with only skipped sets has nothing to save.
    const started = await s.workout.start({ gymId: f.gymId, opId: 'start-empty', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const fin = await s.workout.dispatch(started.aggregate.session.id, { type: 'finish', at: h.now(), opId: 'fin-empty', expectedVersion: started.aggregate.session.version, endedAt: null });
    if (fin.ok) {
      expect(await s.routines.saveSource({ kind: 'session', sessionId: started.aggregate.session.id })).toBeNull();
      expect(await s.routines.saveFrom({ from: { kind: 'session', sessionId: started.aggregate.session.id }, name: 'X', addToRotation: false, opId: 'save-none' })).toMatchObject({ ok: false, reason: 'nothing' });
    }
  });

  it('an overview save takes exactly what the page shows; an out-of-date page saves nothing', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    const target = { kind: 'routine' as const, routineId: f.pushA.id };
    const page = await s.overview.load({ target, gymId: f.gymId });
    if (!page) throw new Error('no page');
    const from = { kind: 'preview' as const, target, gymId: f.gymId, previewKey: page.view.previewKey };
    const src = await s.routines.saveSource(from, 'Push A');
    expect(src !== 'stale' && src?.detail).toBe('2 exercises · 3 sets');
    const r = await s.routines.saveFrom({ from, name: 'Push A · short', addToRotation: false, opId: 'save-page' });
    if (!r.ok) throw new Error(r.message);
    expect(r.routine.exercises.map((e) => e.exerciseId)).toEqual(f.pushA.exercises.map((e) => e.exerciseId));
    expect(r.routine.exercises.flatMap((e) => e.setTemplates).every((t) => t.targetLoad === null)).toBe(true);
    expect(r.routine.createdFromSessionId).toBeNull();
    // With today's edits (WL-A11): a swap is saved as swapped, a skipped row is left out.
    const rowOf = (name: string) => page.view.rows.find((x) => x.name === name);
    const bench = rowOf('Bench press');
    const raise = rowOf('Lateral raise');
    if (!bench || !raise) throw new Error('rows');
    const skip = await s.overview.edit({ target, gymId: f.gymId, expectedDraftVersion: page.draft?.version ?? null, opId: 'skip-raise', edit: { kind: 'skip', slotKey: raise.slotKey } });
    expect(skip.ok).toBe(true);
    const p2 = await s.overview.load({ target, gymId: f.gymId });
    const sheet = await s.overview.swapCandidates({ target, gymId: f.gymId, slotKey: bench.slotKey });
    const sub = sheet?.rows[0];
    if (!p2 || !sub) throw new Error('no swap');
    const swap = await s.overview.edit({ target, gymId: f.gymId, expectedDraftVersion: p2.draft?.version ?? null, opId: 'swap-bench', edit: { kind: 'swap', slotKey: bench.slotKey, toExerciseId: sub.exerciseId } });
    expect(swap.ok).toBe(true);
    const p3 = await s.overview.load({ target, gymId: f.gymId });
    if (!p3) throw new Error('no page');
    const edited = await s.routines.saveFrom({ from: { ...from, previewKey: p3.view.previewKey }, name: 'Push A · swapped', addToRotation: false, opId: 'save-edited' });
    if (!edited.ok) throw new Error(edited.message);
    expect(edited.routine.exercises.map((e) => e.exerciseId)).toEqual([sub.exerciseId]);
    // Push A itself is unchanged by the save (rule 2: template only through its own change card or the editor).
    expect((await s.routines.editor({ routineId: f.pushA.id, gymId: f.gymId }))?.routine?.version).toBe(f.pushA.version);

    // The workout changes after the page was read: nothing saved.
    const ren = await s.routines.rename({ routineId: f.pushA.id, name: 'Push AA', expectedVersion: f.pushA.version, opId: 'ren-page' });
    expect(ren.ok).toBe(true);
    expect(await s.routines.saveFrom({ from: { ...from, previewKey: p3.view.previewKey }, name: 'Again', addToRotation: false, opId: 'save-page-2' })).toMatchObject({ ok: false, reason: 'stale_preview', message: 'Targets updated' });
  });

  it('Main survives Duplicate and a backup restore (WL-A12)', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    const ed = await s.routines.editor({ routineId: f.pushA.id, gymId: f.gymId });
    if (!ed) throw new Error('no editor');
    const flipped = ed.exercises.map((e, i) => ({ ...e, main: i === 1 }));
    const u = await s.routines.update({ routineId: f.pushA.id, edit: { name: 'Push A', exercises: flipped }, expectedVersion: f.pushA.version, opId: 'main' });
    if (!u.ok) throw new Error(u.message);
    const d = await s.routines.duplicate({ routineId: f.pushA.id, opId: 'dup-main' });
    expect(d.ok && d.routine.exercises.map((e) => e.main)).toEqual([false, true]);
    await s.backups.backUpOnPhone('manual');
    const name = [...h.backupFiles.keys()].sort().at(-1) ?? '';
    const text = h.backupFiles.get(name) ?? '';
    const p = await s.restore.prepare(text);
    if (!p.ok) throw new Error('prepare failed');
    expect((await s.restore.restore(text, p.preview.stamp)).ok).toBe(true);
    const after = await s.routines.editor({ routineId: f.pushA.id, gymId: f.gymId });
    expect(after?.exercises.map((e) => e.main)).toEqual([false, true]);
  });
});

describe('workout-library review A: S2, S4, S5, N5', () => {
  it('S2, S5: an overview save of a saved workout keeps its Fixed pin, Main and item; only its own rest presets and set overrides are copied', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    const ed = await s.routines.editor({ routineId: f.pushA.id, gymId: f.gymId });
    const [bench, raise] = ed?.exercises ?? [];
    if (!ed || !bench || !raise) throw new Error('no editor');
    const pinned = {
      ...bench,
      main: false,
      restBySetType: { working: { seconds: 150 } },
      setTemplates: bench.setTemplates.map((t, i) => (t.setType === 'warmup' ? t : { ...t, targetLoad: i === 0 ? { value: 60, unit: 'kg' as const, convention: 'total' as const } : null, restOverrideS: i === 1 ? 200 : null })),
    };
    const u = await s.routines.update({ routineId: f.pushA.id, edit: { name: 'Push A', exercises: [pinned, { ...raise, main: true, restBySetType: {} }] }, expectedVersion: f.pushA.version, opId: 'pin-main' });
    if (!u.ok) throw new Error(u.message);
    const target = { kind: 'routine' as const, routineId: f.pushA.id };
    const page = await s.overview.load({ target, gymId: f.gymId });
    if (!page) throw new Error('no page');
    const r = await s.routines.saveFrom({ from: { kind: 'preview', target, gymId: f.gymId, previewKey: page.view.previewKey }, name: 'Push A · 30 min', addToRotation: false, opId: 'save-pinned' });
    if (!r.ok) throw new Error(r.message);
    const [b, l] = r.routine.exercises;
    expect(b?.main).toBe(false);
    expect(l?.main).toBe(true);
    expect(b?.setTemplates.filter((t) => t.setType !== 'warmup').map((t) => t.targetLoad?.value ?? null)).toEqual([60, null]);
    expect(b?.equipmentId).toBe(bench.equipmentId);
    expect(b?.restBySetType).toEqual({ working: { seconds: 150 } });
    expect(b?.setTemplates.filter((t) => t.setType !== 'warmup').map((t) => t.restOverrideS)).toEqual([null, 200]);
    // Lateral raise's rest came from the exercise or global default: not frozen into the copy.
    expect(l?.restBySetType).toEqual({});
  });

  it('S4: Repeat saves the Repeat preview at this gym, its fitted loads as Fixed, linked to the workout it repeats', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [{ exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 10 }, { load: 32.5, reps: 10 }] }]);
    // Repeat at a gym whose rack tops out at 25 kg each.
    const hotelId = h.ids();
    expect((await s.setup.saveGym({ gymId: hotelId, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    const preview = await s.repeat.preview(sid, hotelId);
    if (!preview) throw new Error('no preview');
    const from = { kind: 'repeat' as const, sessionId: sid, gymId: hotelId };
    const src = await s.routines.saveSource(from);
    expect(src !== 'stale' && src?.detail).toBe('1 exercise · 2 sets');
    const r = await s.routines.saveFrom({ from, name: 'DB', addToRotation: false, opId: 'save-repeat' });
    if (!r.ok) throw new Error(r.message);
    const loads = r.routine.exercises[0]?.setTemplates.map((t) => t.targetLoad) ?? [];
    // What the screen showed (25 kg each), never last time's 32.5 kg each.
    expect(loads).toEqual([25, 25].map((value) => ({ value, unit: 'kg', convention: 'per_hand' })));
    expect(r.routine.createdFromSessionId).toBe(sid);
  });

  it('N5: a deleted workout is not duplicated; a retry of an earlier copy still replays', async () => {
    const { services: s } = await h.launch();
    const f = await fixture(s);
    const d = await s.routines.duplicate({ routineId: f.pushA.id, opId: 'dup-before' });
    if (!d.ok) throw new Error(d.message);
    const del = await s.routines.remove({ routineId: f.pushA.id, expectedVersion: f.pushA.version, opId: 'del-dup' });
    expect(del.ok).toBe(true);
    expect(await s.routines.duplicate({ routineId: f.pushA.id, opId: 'dup-after' })).toMatchObject({ ok: false });
    expect(await s.routines.duplicate({ routineId: f.pushA.id, opId: 'dup-before' })).toMatchObject({ ok: true, routine: { id: d.routine.id } });
  });
});

describe('create (New workout) and offline (WL-A14)', () => {
  it('validates, saves once per opId, Main from the rule, and never calls a provider', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const found = await s.routines.searchExercises('bench');
    const bench = found.find((x) => x.name === 'Bench press');
    const curl = (await s.routines.searchExercises('curl'))[0];
    if (!bench || !curl) throw new Error('no exercises');
    expect(await s.routines.create({ edit: { name: '', exercises: [] }, opId: 'bad' })).toMatchObject({ ok: false, message: 'Add a name' });
    const slot = (exerciseId: string, n: number) => ({
      id: h.ids(),
      exerciseId,
      equipmentId: null,
      order: n,
      supersetGroup: null,
      setTemplates: [{ id: h.ids(), setType: 'working' as const, targetLoad: null, targetReps: { min: 8, max: 10 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null }],
      restBySetType: {},
      transitionRestS: null,
      progressionRuleId: null,
    });
    const edit = { name: 'Upper', exercises: [slot(curl.id, 0), slot(bench.id, 1)] };
    const [a, b] = await Promise.all([s.routines.create({ edit, opId: 'new-1' }), s.routines.create({ edit, opId: 'new-1' })]);
    if (!a.ok || !b.ok) throw new Error('create failed');
    expect(a.routine.id).toBe(b.routine.id);
    expect(a.routine.exercises.map((e) => e.main)).toEqual([curl.compound, true]);
    expect(await s.routines.estimate({ exercises: a.routine.exercises, gymId })).toBeGreaterThan(0);
    const l = await library(s, gymId);
    expect(l.view.all.map((r) => r.name)).toEqual(['Upper']);
  });
});

describe('Save to Workouts → Edit › (routines.md §A2.5, WL-A18, exercise-library EL-B23)', () => {
  it('the sheet’s copy opens in the editor; a changed set count saves one workout under the sheet’s opId, keeping its history link', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] },
    ]);
    const from = { kind: 'session' as const, sessionId: sid };
    const src = await s.routines.saveSource(from);
    if (src === 'stale' || src === null) throw new Error('no source');
    // The editor opens on exactly what the sheet would save.
    expect(src.detail).toBe('2 exercises · 4 sets');
    expect(src.exercises.map((e) => e.setTemplates.length)).toEqual([2, 2]);
    const row = src.exercises[1];
    if (!row) throw new Error('no row');
    const edit = { name: 'Push A', exercises: setWorkingSetCount(src.exercises, row.id, 4, h.ids) };
    const r = await s.routines.saveFrom({ from, name: edit.name, addToRotation: true, opId: 'sheet-op', edit });
    if (!r.ok) throw new Error(r.message);
    expect(r.routine.exercises.map((e) => e.setTemplates.length)).toEqual([2, 4]);
    expect(r.routine).toMatchObject({ name: 'Push A', version: 1, lastOpId: 'sheet-op', createdFromSessionId: sid, inRotation: true, source: 'ben' });
    // A retry, and the sheet’s own Save with the same opId, are the same save: one workout (rule 5).
    const again = await s.routines.saveFrom({ from, name: edit.name, addToRotation: true, opId: 'sheet-op', edit });
    const sheet = await s.routines.saveFrom({ from, name: 'Push A', addToRotation: true, opId: 'sheet-op' });
    expect(again.ok && again.routine.id).toBe(r.routine.id);
    expect(sheet.ok && sheet.routine.exercises.map((e) => e.setTemplates.length)).toEqual([2, 4]);
    expect((await library(s, gymId)).view.rotation.map((x) => x.name)).toEqual(['Push A']);
    // Undo (the toast's delete) removes it.
    const undo = await s.routines.remove({ routineId: r.routine.id, expectedVersion: 1, opId: 'undo-save' });
    expect(undo.ok).toBe(true);
    // The finished workout is untouched.
    expect((await s.workout.load(sid))?.aggregate.exercises).toHaveLength(2);
  });

  it('Cancel writes nothing; an invalid edit saves nothing and says why', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const from = { kind: 'session' as const, sessionId: sid };
    const src = await s.routines.saveSource(from);
    if (src === 'stale' || src === null) throw new Error('no source');
    const before = await library(s, gymId);
    // Cancel: no call at all, so nothing beyond the read.
    expect((await library(s, gymId)).view).toEqual(before.view);
    const bad = await s.routines.saveFrom({ from, name: 'X', addToRotation: false, opId: 'bad-edit', edit: { name: 'X', exercises: [] } });
    expect(bad).toMatchObject({ ok: false, message: 'Add an exercise' });
    expect((await library(s, gymId)).view.all).toEqual([]);
  });
});

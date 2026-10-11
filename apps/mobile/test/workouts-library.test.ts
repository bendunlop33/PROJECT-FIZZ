import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP } from '@fizz/domain';
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
    expect(plain(l.view.all[0]?.detail)).toMatch(/^New · 1 exercise · ≈ \d+ min$/);
    expect(l.view.history.map((x) => x.label)).toEqual(['Shoulders']);
    expect(l.view.rotation.every((r) => r.minutes !== null && r.minutes > 0)).toBe(true);
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
  it('an Empty workout saves done exercises and set counts with Auto loads; the next overview has targets from it; the workout is unchanged', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const sid = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] },
    ]);
    const before = await s.workout.load(sid);
    const src = await s.routines.saveSource({ kind: 'session', sessionId: sid });
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
    expect((await s.routines.saveSource(from, 'Push A'))?.detail).toBe('2 exercises · 3 sets');
    const r = await s.routines.saveFrom({ from, name: 'Push A · short', addToRotation: false, opId: 'save-page' });
    if (!r.ok) throw new Error(r.message);
    expect(r.routine.exercises.map((e) => e.exerciseId)).toEqual(f.pushA.exercises.map((e) => e.exerciseId));
    expect(r.routine.exercises.flatMap((e) => e.setTemplates).every((t) => t.targetLoad === null)).toBe(true);
    expect(r.routine.createdFromSessionId).toBeNull();
    // The workout changes after the page was read: nothing saved.
    const ren = await s.routines.rename({ routineId: f.pushA.id, name: 'Push AA', expectedVersion: f.pushA.version, opId: 'ren-page' });
    expect(ren.ok).toBe(true);
    expect(await s.routines.saveFrom({ from, name: 'Again', addToRotation: false, opId: 'save-page-2' })).toMatchObject({ ok: false, reason: 'stale_preview', message: 'Targets updated' });
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

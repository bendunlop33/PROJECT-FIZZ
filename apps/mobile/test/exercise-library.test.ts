import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, NO_FILTERS } from '@fizz/domain';

import type { LibraryAddShape } from '../src/services/library-service';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Library › Exercises through the app services on real SQLite
 * (exercise-library §9–§10, EL-B1–EL-B24): every exercise listed outside a
 * workout, search with aliases and typos, filters, the detail's two domains
 * and Progress's own numbers, `Add to a workout` (saved workout: versioned,
 * Undo after a force-close, stale refused; workout in progress: new pending
 * sets only, Undo), and the `Sets` count on the workout's picker. Nothing
 * here needs a network or the coach.
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

async function browse(s: AppServices, query = '', filters = NO_FILTERS) {
  const b = await s.library.browse({ query, filters });
  if (!b) throw new Error('no library');
  return b;
}
async function idOf(s: AppServices, name: string): Promise<string> {
  const row = (await browse(s, name)).view.sections.flatMap((x) => x.rows).find((r) => r.name === name);
  if (!row) throw new Error(`no ${name}`);
  return row.exerciseId;
}
const shape = (over: Partial<LibraryAddShape> = {}): LibraryAddShape => ({ workingSets: 3, warmups: 0, reps: { min: 8, max: 12 }, durationS: null, effort: { scale: 'rpe', value: null }, repsTouched: false, ...over });

describe('browse outside a workout (EL-B1–EL-B4, EL-B15)', () => {
  it('lists every exercise (never done ones too), with no workout running and no AI', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const b = await browse(s);
    const all = b.view.sections.find((x) => x.key === 'all');
    expect(all?.title).toMatch(/^ALL EXERCISES · \d+$/);
    expect(all?.rows.length).toBeGreaterThan(100);
    expect(all?.rows.some((r) => r.name === 'Arnold press')).toBe(true);
    expect(b.view.sections.some((x) => x.key === 'recent')).toBe(false);
    expect(b.resume).toBeNull();
  });

  it('RDL, rdl and `romanain deadlift` find Romanian deadlift; the alias hit says so; no match says so', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    for (const q of ['RDL', 'rdl', 'romanain deadlift']) {
      const rows = (await browse(s, q)).view.sections.flatMap((x) => x.rows);
      expect(rows.map((r) => r.name)).toContain('Romanian deadlift');
    }
    const rdl = (await browse(s, 'rdl')).view.sections[0]?.rows.find((r) => r.name === 'Romanian deadlift');
    expect(plain(rdl?.line2)).toMatch(/^Matches “RDL” · Barbell · Hamstrings/);
    expect(rdl?.hasGuide).toBe(true);
    expect((await browse(s, 'landmine twst')).view.empty).toBe('No match for “landmine twst”.');
  });

  it('Muscle + Equipment filters narrow; At <gym> hides what the gym can’t do and counts it', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s, 'home_dumbbells');
    const narrowed = (await browse(s, '', { ...NO_FILTERS, muscles: ['Hamstrings'], equipment: ['dumbbells'] })).view.sections.flatMap((x) => x.rows);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.every((r) => r.line2.includes('Dumbbells'))).toBe(true);
    expect(narrowed.map((r) => r.name)).toContain('Dumbbell Romanian deadlift');
    const atGym = await browse(s, '', { ...NO_FILTERS, atGym: true });
    expect(atGym.view.hiddenText).toMatch(/^\d+ more not at .+\.$/);
    expect(atGym.view.sections.flatMap((x) => x.rows).some((r) => r.name === 'Lat pulldown')).toBe(false);
  });

  it('after a workout: RECENT first, and Last is an actual in its own convention (per-hand reads `each`)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 100, reps: 8 }, { load: 100, reps: 7 }] },
      { exercise: 'Dumbbell bench press', sets: [{ load: 30, reps: 9 }] },
    ]);
    const b = await browse(s);
    const recent = b.view.sections.find((x) => x.key === 'recent');
    expect(recent?.rows.map((r) => r.name).sort()).toEqual(['Bench press', 'Dumbbell bench press']);
    const bench = recent?.rows.find((r) => r.name === 'Bench press');
    expect(plain(bench?.line3)).toBe('Last 100 kg × 8 · 5 Oct');
    expect(plain(recent?.rows.find((r) => r.name === 'Dumbbell bench press')?.line3)).toBe('Last 30 kg each × 9 · 5 Oct');
  });
});

describe('Exercise detail (EL-B5, EL-B7, EL-B8)', () => {
  it('no history: the poster, cues ≤ 3, Full how-to, and `No history yet.` with no Progress link', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const d = await s.library.detail(await idOf(s, 'Romanian deadlift'));
    expect(d?.view.knowledge.poster?.catalogueKey).toBe('barbell-romanian-deadlift');
    expect(d?.view.knowledge.cues.length).toBeLessThanOrEqual(3);
    expect(d?.view.knowledge.avoid.length).toBeLessThanOrEqual(3);
    expect(d?.view.knowledge.cues.length).toBeGreaterThan(0);
    expect(d?.howTo).toEqual({ catalogueKey: 'barbell-romanian-deadlift', name: 'Romanian deadlift' });
    expect(d?.view.aliasesLine).toMatch(/^Also called RDL/);
    expect(d?.view.yours.empty).toBe('No history yet.');
    expect(d?.progress).toBeNull();
    expect(d?.defaultShape).toMatchObject({ workingSets: 3, warmups: 0, targetRpe: null });
  });

  it('with history: Your data is Progress’s own series and numbers, and links to it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 5 }, { load: 95, reps: 8 }] }]);
    h.clockMs += 2 * DAY;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 102.5, reps: 5 }] }]);
    const id = await idOf(s, 'Bench press');
    const d = await s.library.detail(id);
    const progress = await s.progress.exerciseDetail({ exerciseId: id });
    expect(d?.progress).toEqual({ exerciseId: id, seriesId: progress?.view?.seriesId });
    expect(d?.view.yours.history?.caption).toBe(progress?.view?.seriesLabel);
    const rows = d?.view.yours.history?.rows.map((r) => [r.label, plain(r.value)]);
    expect(rows?.[0]).toEqual(['Last', '102.5 kg × 5 · 7 Oct']);
    // Est. 1RM carries `≈` (an estimate) and equals Progress's.
    const e1rm = progress?.view?.stats.find((x) => x.label === 'EST. 1RM')?.value;
    expect(d?.view.yours.history?.rows.find((r) => r.label === 'Est. 1RM')).toMatchObject({ value: e1rm, estimate: true });
    expect(e1rm).toMatch(/^≈/);
    expect(plain(d?.view.yours.history?.workouts)).toBe('2 workouts since 5 Oct');
  });
});

describe('Add to a workout (EL-B9–EL-B11, EL14)', () => {
  async function withSaved(s: AppServices) {
    const gymId = await setUpGym(h, s);
    const done = await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 60, reps: 8 }] }]);
    const saved = await s.routines.saveFrom({ from: { kind: 'session', sessionId: done }, name: 'Pull B', addToRotation: true, opId: 'save-pull' });
    if (!saved.ok) throw new Error(saved.message);
    h.clockMs += DAY;
    return { gymId, routine: saved.routine };
  }

  it('to a saved workout: 4 working sets, Auto loads, Main off; one version per opId; Undo puts it back, also after a force-close', async () => {
    let { services: s } = await h.launch();
    const { routine } = await withSaved(s);
    const facePull = await idOf(s, 'Face pull');
    const dest = await s.library.destinations(facePull);
    const row = dest?.destinations.workouts.find((w) => w.label === 'Pull B');
    expect(row).toMatchObject({ disabled: false, version: routine.version, primary: 'Add to Pull B' });
    const req = { exerciseId: facePull, shape: shape({ workingSets: 4 }), to: { kind: 'routine' as const, routineId: routine.id, expectedVersion: routine.version }, opId: 'lib-add-1' };
    const r = await s.library.addToWorkout(req);
    expect(r).toMatchObject({ ok: true, toast: 'Added to Pull B' });
    // A retry of the same opId is the same write.
    expect(await s.library.addToWorkout(req)).toMatchObject({ ok: true });
    const now = (await s.routines.editor({ routineId: routine.id, gymId: null }))?.routine;
    expect(now?.version).toBe(routine.version + 1);
    const slot = now?.exercises.find((e) => e.exerciseId === facePull);
    expect(slot?.setTemplates.filter((t) => t.setType !== 'warmup')).toHaveLength(4);
    expect(slot?.setTemplates.every((t) => t.targetLoad === null && t.targetReps !== null)).toBe(true);
    expect(slot?.main).toBe(false);
    // Already in it now.
    expect((await s.library.destinations(facePull))?.destinations.workouts.find((w) => w.label === 'Pull B')).toMatchObject({ disabled: true, disabledText: 'Already in it' });

    await h.forceClose();
    ({ services: s } = await h.launch());
    if (!r.ok || r.undo === null) throw new Error('no undo');
    expect(await s.library.undoAdd({ undo: r.undo, opId: 'lib-undo-1' })).toEqual({ ok: true });
    const back = (await s.routines.editor({ routineId: routine.id, gymId: null }))?.routine;
    expect(back?.exercises.some((e) => e.exerciseId === facePull)).toBe(false);
  });

  it('a stale version writes nothing and says so (rule 5)', async () => {
    const { services: s } = await h.launch();
    const { routine } = await withSaved(s);
    const facePull = await idOf(s, 'Face pull');
    const curl = await idOf(s, 'Dumbbell curl');
    expect((await s.library.addToWorkout({ exerciseId: curl, shape: shape(), to: { kind: 'routine', routineId: routine.id, expectedVersion: routine.version }, opId: 'first' })).ok).toBe(true);
    const stale = await s.library.addToWorkout({ exerciseId: facePull, shape: shape(), to: { kind: 'routine', routineId: routine.id, expectedVersion: routine.version }, opId: 'second' });
    expect(stale).toEqual({ ok: false, reason: 'stale', message: 'Pull B changed. Try again.' });
    const now = (await s.routines.editor({ routineId: routine.id, gymId: null }))?.routine;
    expect(now?.exercises.some((e) => e.exerciseId === facePull)).toBe(false);
  });

  it('to the workout in progress: 3 pending working sets at the end; done sets untouched; Undo removes it; the template applies next time', async () => {
    const { services: s } = await h.launch();
    const { gymId, routine } = await withSaved(s);
    const started = await s.workout.start({ gymId, opId: 'start-run', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const bench = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
    const added = await s.workout.addExercise({ sessionId, exerciseId: bench?.exercise.id ?? '', equipmentId: bench?.equipment[0]?.id ?? null, opId: 'add-bench' });
    if (!added.ok) throw new Error(added.error.message);
    const first = added.aggregate.sets.find((x) => x.status === 'pending');
    if (!first) throw new Error('no set');
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first.id, values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const doneBefore = logged.aggregate.sets.filter((x) => x.status === 'completed');
    expect(doneBefore).toHaveLength(1);

    const facePull = await idOf(s, 'Face pull');
    const dest = await s.library.destinations(facePull);
    expect(dest?.destinations.now).toMatchObject({ kind: 'session', disabled: false });
    const r = await s.library.addToWorkout({ exerciseId: facePull, shape: shape(), to: { kind: 'session', sessionId }, opId: 'lib-session-1' });
    expect(r.ok).toBe(true);
    const now = (await s.workout.load(sessionId))?.aggregate;
    const row = now?.exercises.find((e) => e.exerciseId === facePull);
    expect(row?.order).toBe(Math.max(...(now?.exercises.map((e) => e.order) ?? [])));
    const sets = now?.sets.filter((x) => x.sessionExerciseId === row?.id) ?? [];
    expect(sets.map((x) => [x.setType, x.status])).toEqual([['working', 'pending'], ['working', 'pending'], ['working', 'pending']]);
    expect(now?.sets.filter((x) => x.status === 'completed')).toEqual(doneBefore);
    // The saved workout isn't touched by an add to the running one.
    expect((await s.routines.editor({ routineId: routine.id, gymId: null }))?.routine?.version).toBe(routine.version);

    if (!r.ok || r.undo === null) throw new Error('no undo');
    expect(await s.library.undoAdd({ undo: r.undo, opId: 'lib-session-undo' })).toEqual({ ok: true });
    const undone = (await s.workout.load(sessionId))?.aggregate;
    expect(undone?.exercises.find((e) => e.id === row?.id)?.removed).toBeDefined();
    expect(undone?.sets.filter((x) => x.status === 'completed')).toEqual(doneBefore);
  });
});

describe('the workout picker’s Sets bar (EL-B21, EL-B22)', () => {
  it('an empty workout’s first add makes 3 pending working sets; `[−]` to 2 makes 2; a retry is the same add', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-empty', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const picks = await s.workout.pickerExercises(sessionId, 'face pul');
    const face = picks.find((p) => p.exercise.name === 'Face pull');
    expect(face).toBeDefined();
    const three = await s.workout.addExercise({ sessionId, exerciseId: face?.exercise.id ?? '', equipmentId: face?.equipment[0]?.id ?? null, opId: 'pick-1', shape: { workingSets: 3 } });
    if (!three.ok) throw new Error(three.error.message);
    expect(three.aggregate.sets.filter((x) => x.status === 'pending' && x.setType === 'working')).toHaveLength(3);
    const again = await s.workout.addExercise({ sessionId, exerciseId: face?.exercise.id ?? '', equipmentId: face?.equipment[0]?.id ?? null, opId: 'pick-1', shape: { workingSets: 3 } });
    expect(again.ok && again.aggregate.exercises.filter((e) => e.exerciseId === face?.exercise.id)).toHaveLength(1);
    const curl = (await s.workout.pickerExercises(sessionId, 'curl')).find((p) => p.exercise.name === 'Dumbbell curl');
    const two = await s.workout.addExercise({ sessionId, exerciseId: curl?.exercise.id ?? '', equipmentId: curl?.equipment[0]?.id ?? null, opId: 'pick-2', shape: { workingSets: 2 } });
    if (!two.ok) throw new Error(two.error.message);
    const row = two.aggregate.exercises.find((e) => e.exerciseId === curl?.exercise.id);
    expect(two.aggregate.sets.filter((x) => x.sessionExerciseId === row?.id)).toHaveLength(2);
  });

  it('the picker and the editor’s add sheet search aliases too', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-alias', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const picks = await s.workout.pickerExercises(started.aggregate.session.id, 'rdl');
    expect(picks[0]?.exercise.name).toBe('Romanian deadlift');
    expect(picks[0]?.aliases).toContain('RDL');
    const editor = await s.routines.searchExercises('rdl');
    expect(editor[0]?.name).toBe('Romanian deadlift');
    expect(editor[0]?.defaultShape).toMatchObject({ workingSets: 3, warmups: 0 });
  });
});

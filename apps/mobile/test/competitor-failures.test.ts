import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { discardConfirmation, isLoadAchievable, toMs } from '@fizz/domain';
import type { SessionAggregate, SessionCommand, WorkoutSet } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Competitor-failure acceptance pack, app half (docs/research/competitor-landscape.md
 * opportunity 2). The same failures as `packages/domain/test/competitor-failures.test.ts`,
 * checked through the app services on real SQLite files, with force-close and
 * relaunch where it matters:
 *
 *   (a) An import never changes planned or pending sets (Fitbod refresh).
 *   (d) Editing a logged set never restarts rest, on the lock screen either (MacroFactor).
 *   (e) Discard needs a confirmation or Undo (LiftTrack "no second step").
 *   (f) Deleting one set never removes another (Hevy).
 *   (g) Repeat at a gym without the equipment never keeps an impossible load (slice-3 B1).
 *
 * (b) and (c) are pure equipment and warm-up rules; they live in the domain half only.
 * Every CSV here is synthetic.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-08T17:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const A1 = 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time';
/** Older FitNotes history: needs no answers (a stack exercise). */
const OLD_EXPORT = [A1, '2026-09-01,Lat pulldown,Back,40,10,,,', '2026-09-03,Lat pulldown,Back,42.5,10,,,', '2026-09-05,Lat pulldown,Back,45,10,,,'].join('\n');
/** A newer export with heavier, more recent sets: what made Fitbod regenerate the planned workout. */
const NEWER_EXPORT = [OLD_EXPORT, '2026-09-20,Lat pulldown,Back,70,12,,,', '2026-10-01,Lat pulldown,Back,75,12,,,'].join('\n');

async function openReady(s: AppServices, text: string) {
  const r = await s.imports.open({ name: 'FitNotes_Export_synthetic.csv', text });
  if (r.kind !== 'preview') throw new Error(`expected a preview, got ${r.kind}`);
  if (!r.draft.analysis.ready) throw new Error('this file should need no answers');
  return r.draft;
}

/** Start a workout and add `name` with the gym's first compatible equipment (planned by the built-in rule when there is history). */
async function startWith(s: AppServices, gymId: string, name: string): Promise<{ sessionId: string; sets: WorkoutSet[] }> {
  const started = await s.workout.start({ gymId, opId: `start-${String(h.clockMs)}`, checkIn: null });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
  if (!pick) throw new Error(`no ${name}`);
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
  if (!added.ok) throw new Error(added.error.message);
  return { sessionId, sets: [...added.aggregate.sets].sort((a, b) => a.index - b.index) };
}

async function stored(s: AppServices, sessionId: string): Promise<SessionAggregate> {
  const data = await s.workout.load(sessionId);
  if (!data) throw new Error('workout not found');
  return data.aggregate;
}

/** Every set row as stored, by ID: planned targets, drafts, results, status, versions. */
async function storedSets(s: AppServices, sessionId: string): Promise<WorkoutSet[]> {
  return [...(await stored(s, sessionId)).sets].sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function dispatch(s: AppServices, sessionId: string, cmd: SessionCommand): Promise<SessionAggregate> {
  const r = await s.workout.dispatch(sessionId, cmd);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.aggregate;
}

/** Log the planned set at its own target (load and the top of its rep range). */
async function logPlanned(s: AppServices, sessionId: string, set: WorkoutSet, rpe: number | null = null): Promise<SessionAggregate> {
  h.clockMs += 60_000;
  const values = { load: set.planned.load, reps: set.planned.reps?.max ?? 8, durationS: null, rpe, rir: null };
  return dispatch(s, sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}:0`, setId: set.id, values, restTimerId: h.ids() });
}

const PULLDOWN_DAY = [1, 2, 3].map(() => ({ load: 50, reps: 10, rpe: 8 }));

describe('(a) an import never changes planned or pending sets (Fitbod refresh)', () => {
  it('can’t be committed or undone while a workout is unfinished; its planned, pending and drafted sets are untouched, through a relaunch', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const old = await openReady(s, OLD_EXPORT);
    const first = await s.imports.commit(old.draftId, old.mappingVersion, 'import-1');
    if (!first.ok) throw new Error(first.reason);
    await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: PULLDOWN_DAY }]);

    h.clockMs += 86_400_000;
    const { sessionId, sets } = await startWith(s, gymId, 'Lat pulldown');
    expect(sets.map((x) => x.planned.source)).toEqual(['built_in_rule', 'built_in_rule', 'built_in_rule']);
    const [one, two] = sets;
    if (!one || !two) throw new Error('fixture');
    await logPlanned(s, sessionId, one);
    await dispatch(s, sessionId, { type: 'save_draft', at: h.now(), setId: two.id, values: { load: two.planned.load, reps: 9, durationS: null, rpe: null, rir: null } });
    const before = await storedSets(s, sessionId);

    const newer = await openReady(s, NEWER_EXPORT);
    expect(await s.imports.commit(newer.draftId, newer.mappingVersion, 'import-2')).toMatchObject({ ok: false, reason: 'workout_unfinished' });
    const job = await s.imports.job(first.jobId);
    expect(await s.imports.revert(first.jobId, job?.job.version ?? 0, 'undo-1')).toMatchObject({ ok: false, reason: 'workout_unfinished' });
    expect(await storedSets(s, sessionId)).toEqual(before);

    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await storedSets(s2, sessionId)).toEqual(before);
  });

  it('a workout started while an import is paused: Continue waits for it, and neither the rest of the import nor its Undo touches it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: PULLDOWN_DAY }]);
    const draft = await openReady(s, NEWER_EXPORT);
    let written = 0;
    const paused = await s.imports.commit(draft.draftId, draft.mappingVersion, 'import-1', { onProgress: (n) => (written = n), shouldStop: () => written >= 1 });
    expect(paused).toMatchObject({ ok: true, status: 'stopped', written: 1 });
    const jobId = paused.ok ? paused.jobId : '';

    h.clockMs += 86_400_000;
    const { sessionId, sets } = await startWith(s, gymId, 'Lat pulldown');
    const [one] = sets;
    if (!one) throw new Error('fixture');
    await logPlanned(s, sessionId, one);
    const during = await storedSets(s, sessionId);
    expect(await s.imports.resume(jobId)).toMatchObject({ ok: false, reason: 'workout_unfinished' });
    expect(await storedSets(s, sessionId)).toEqual(during);

    h.clockMs += 60_000;
    const live = await stored(s, sessionId);
    await dispatch(s, sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: live.session.version, endedAt: null });
    const finished = await storedSets(s, sessionId);
    expect(await s.imports.resume(jobId)).toMatchObject({ ok: true, status: 'finished' });
    expect(await storedSets(s, sessionId)).toEqual(finished);
    const job = await s.imports.job(jobId);
    expect(await s.imports.revert(jobId, job?.job.version ?? 0, 'undo-1')).toMatchObject({ ok: true });
    expect(await storedSets(s, sessionId)).toEqual(finished);
  });
});

describe('(d) editing a logged set never restarts rest (MacroFactor)', () => {
  it('corrections, an effort change and deleting an older set leave the pending lock-screen alert at the same time, also after a relaunch', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += 86_400_000;
    const { sessionId, sets } = await startWith(s, gymId, 'Bench press');
    const [one, two] = sets;
    if (!one || !two) throw new Error('fixture');
    await logPlanned(s, sessionId, one);
    const resting = await logPlanned(s, sessionId, two);
    await h.settle(s);
    const deadlineMs = toMs(resting.restTimer?.deadlineUtc ?? '');
    expect(resting.restTimer).toMatchObject({ setId: two.id, status: 'running' });
    const alertAt = () => [...h.pending.values()].map((p) => p.fireAtMs);
    expect(alertAt()).toEqual([deadlineMs]);

    const version = async (svc: AppServices, setId: string) => (await stored(svc, sessionId)).sets.find((x) => x.id === setId)?.version ?? 0;
    const edits: ((svc: AppServices) => Promise<SessionCommand>)[] = [
      async (svc) => ({ type: 'correct_set', at: h.now(), opId: h.ids(), setId: two.id, expectedSetVersion: await version(svc, two.id), patch: { load: { value: 97.5, unit: 'kg', convention: 'total' } } }),
      async (svc) => ({ type: 'correct_set', at: h.now(), opId: h.ids(), setId: two.id, expectedSetVersion: await version(svc, two.id), patch: { rpe: 9.5 } }),
      async (svc) => ({ type: 'correct_set', at: h.now(), opId: h.ids(), setId: one.id, expectedSetVersion: await version(svc, one.id), patch: { reps: 5 } }),
      async (svc) => ({ type: 'delete_set', at: h.now(), opId: h.ids(), setId: one.id, expectedSetVersion: await version(svc, one.id) }),
    ];
    let svc = s;
    for (const [i, edit] of edits.entries()) {
      h.clockMs += 10_000;
      if (i === 2) {
        // Restart recovery in the middle: the relaunch reschedules the same alert, and edits after it don't move it.
        await h.forceClose();
        svc = (await h.launch()).services;
        await h.settle(svc);
        expect(alertAt()).toEqual([deadlineMs]);
      }
      const after = await dispatch(svc, sessionId, await edit(svc));
      await h.settle(svc);
      expect(after.restTimer, `edit ${String(i)}`).toEqual(resting.restTimer);
      expect(alertAt(), `edit ${String(i)}`).toEqual([deadlineMs]);
      const data = await svc.workout.load(sessionId);
      if (!data) throw new Error('no data');
      expect(svc.workout.view(data, h.clockMs, null).rest).toMatchObject({ kind: 'running', deadlineUtc: resting.restTimer?.deadlineUtc });
    }
  });
});

describe('(e) Discard needs a confirmation or Undo (LiftTrack: "no second step")', () => {
  it('the screens’ path: a confirmation shown before a lock-screen log is refused as stale, nothing is lost through a relaunch, and a confirmed discard keeps the rows', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += 86_400_000;
    const { sessionId, sets } = await startWith(s, gymId, 'Bench press');
    const [one, two] = sets;
    if (!one || !two) throw new Error('fixture');
    expect(discardConfirmation(await stored(s, sessionId))).toMatchObject({ required: false });
    await logPlanned(s, sessionId, one);
    const ask = discardConfirmation(await stored(s, sessionId));
    expect(ask).toMatchObject({ required: true, loggedSets: 1 });
    // Logged from the Live Activity while the alert was open.
    await logPlanned(s, sessionId, two);
    const stale = await s.workout.dispatch(sessionId, { type: 'discard', at: h.now(), opId: h.ids(), expectedVersion: ask.expectedVersion });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_version' } });

    await h.forceClose();
    const { services: s2 } = await h.launch();
    const recovered = await s2.sessions.recover();
    expect(recovered?.state.session).toMatchObject({ id: sessionId, status: 'active' });
    expect(recovered?.state.sets.filter((x) => x.status === 'completed').map((x) => x.id).sort()).toEqual([one.id, two.id].sort());

    const confirm = discardConfirmation(await stored(s2, sessionId));
    expect(confirm).toMatchObject({ required: true, loggedSets: 2, message: '2 logged sets will be discarded. This can’t be undone.' });
    const before = await storedSets(s2, sessionId);
    await dispatch(s2, sessionId, { type: 'discard', at: h.now(), opId: h.ids(), expectedVersion: confirm.expectedVersion });
    const after = await stored(s2, sessionId);
    expect(after.session.status).toBe('discarded');
    expect(await storedSets(s2, sessionId)).toEqual(before);
    expect(await s2.sessions.active()).toBeNull();
  });

  // Today's stale card also discards (`Discard (nothing logged)`, no prompt); the domain half checks
  // that buildTodayView offers it only when discardConfirmation says nothing is logged.
  it('every screen that discards a workout asks discardConfirmation first (source check)', () => {
    const SRC = join(import.meta.dirname, '../src');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return files(p);
        return /\.(ts|tsx)$/.test(name) ? [p] : [];
      });
    const discarding = files(join(SRC, 'screens')).filter((f) => readFileSync(f, 'utf8').includes("type: 'discard'"));
    expect(discarding.map((f) => relative(SRC, f)).sort()).toEqual(['screens/TodayScreen.tsx', 'screens/workout/WorkoutScreen.tsx']);
    for (const f of discarding) expect(readFileSync(f, 'utf8'), relative(SRC, f)).toContain('discardConfirmation(');
  });
});

describe('(f) deleting one set never removes another (Hevy)', () => {
  it('deleting a logged set through the app changes that row only (kept as a record), and after a relaunch every other set is as it was', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += 86_400_000;
    const { sessionId, sets } = await startWith(s, gymId, 'Bench press');
    const [one, two, three] = sets;
    if (!one || !two || !three) throw new Error('fixture');
    await logPlanned(s, sessionId, one);
    await logPlanned(s, sessionId, two);
    const before = await storedSets(s, sessionId);
    const target = before.find((x) => x.id === two.id);
    if (!target) throw new Error('fixture');
    await dispatch(s, sessionId, { type: 'delete_set', at: h.now(), opId: 'delete-set-2', setId: target.id, expectedSetVersion: target.version });
    // The same tap again (a retry after a slow save) is a no-op, not the next set.
    await dispatch(s, sessionId, { type: 'delete_set', at: h.now(), opId: 'delete-set-2', setId: target.id, expectedSetVersion: target.version });

    await h.forceClose();
    const { services: s2 } = await h.launch();
    const after = await storedSets(s2, sessionId);
    expect(after).toHaveLength(before.length);
    expect(after.filter((x) => x.id !== target.id)).toEqual(before.filter((x) => x.id !== target.id));
    expect(after.find((x) => x.id === target.id)).toMatchObject({ status: 'deleted', actual: target.actual });
  });
});

describe('(g) Repeat at a gym without the equipment never keeps an impossible load', () => {
  it('a mixed workout repeated at a dumbbells-only gym plans only loads that gym can make (real presets, SQLite)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const day = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 102.5, reps: 5 }] },
      { exercise: 'Dumbbell shoulder press', sets: [{ load: 27.5, reps: 8 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 55, reps: 10 }] },
      { exercise: 'Leg press', sets: [{ load: 140, reps: 10 }] },
      { exercise: 'Assisted pull-up', sets: [{ load: 20, reps: 8 }] },
    ]);
    const homeId = h.ids();
    expect(await s.setup.saveGym({ gymId: homeId, name: 'Home', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).toEqual({ ok: true });
    h.clockMs += 86_400_000;
    const started = await s.workout.start({ gymId: homeId, opId: 'repeat-home', checkIn: null, repeatOf: day });
    if (!started.ok) throw new Error(started.error.message);
    const a = started.aggregate;
    // The commercial preset doesn't tick a leg press or an assisted machine, so those two were
    // logged with no equipment: their loads were never checked anywhere (see the todo below).
    const source = await stored(s, day);
    const hadEquipment = new Set(source.exercises.filter((e) => e.equipmentId !== null).map((e) => e.exerciseId));
    expect([...hadEquipment].length).toBe(3);
    for (const set of a.sets) {
      const ex = a.exercises.find((e) => e.id === set.sessionExerciseId);
      if (!ex || set.planned.load === null || !hadEquipment.has(ex.exerciseId)) continue;
      const eq = a.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId);
      expect(eq, `${ex.exerciseName}: a load with no equipment here to check it on`).toBeDefined();
      if (eq) expect(isLoadAchievable(set.planned.load, eq), `${ex.exerciseName} on ${eq.name}`).toBe(true);
    }
    // Of the exercises done on equipment, only the dumbbell one keeps a load; every exercise keeps its reps.
    const loaded = a.exercises.filter((e) => hadEquipment.has(e.exerciseId) && a.sets.some((x) => x.sessionExerciseId === e.id && x.planned.load !== null));
    expect(loaded.map((e) => e.exerciseName)).toEqual(['Dumbbell shoulder press']);
    expect(a.sets.every((x) => x.planned.reps !== null)).toBe(true);
  });

  it.todo(
    'OPEN (needs Ben/PM): an exercise logged with no equipment (e.g. Leg press 140 kg added, its machine not in the gym profile) is repeated with that load unchecked and no note, at any gym: also at one whose own leg press stops at 100 kg (equipment stays empty, so nothing snaps it). The slice-3 review (B1) says unchecked mirrors unchecked; routines.md §2.4 says "a load is never planned without equipment to check it on" and exercise-library §4.2 shows "no load target" for an exercise added without its equipment. Decide (drop the load with a note, or attach this gym’s compatible equipment and snap), then assert it here',
  );
});

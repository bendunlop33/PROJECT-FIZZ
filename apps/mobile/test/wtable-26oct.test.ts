import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildExercisePickerView, type CommandOutcome } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 26 Oct; competitor pass 4 and app review 26 Oct #2) The live workout table's approved changes, through the
 * app's services on real SQLite with no network and no coach: the Swap / Add sheet's `Recent` group and equipment
 * chips, `Superset with…` on the shared sheet (the old picker is gone), and the writes it makes (opId, versions).
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-26T16:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const ok = (r: CommandOutcome): SessionAggregate => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.aggregate;
};

async function started(): Promise<{ s: AppServices; sessionId: string; bench: string; a: SessionAggregate; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 8, rpe: 8 }, { load: 100, reps: 7, rpe: 9 }, { load: 95, reps: 8, rpe: 9 }] },
    { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9, rpe: 8 }, { load: 27.5, reps: 9, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  const st = await s.workout.start({ gymId, opId: 'start-today', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!st.ok) throw new Error(st.error.message);
  const sessionId = st.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  const a = ok(await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-bench' }));
  const bench = a.exercises.find((e) => e.exerciseName === 'Bench press')?.id ?? '';
  return { s, sessionId, bench, a, gymId };
}

describe('Swap / Add: Recent and equipment (Ben, 26 Oct)', () => {
  it('Recent lists what he did lately (newest first), minus what is in the workout; the chips filter the full list', async () => {
    const { s, sessionId, bench } = await started();
    const index = await s.exercisePicker.forSession(sessionId, null);
    const names = (ids: readonly string[]) => ids.map((id) => index.entries.find((e) => e.exercise.id === id)?.exercise.name);
    expect(names(index.recent ?? [])).toEqual(['Bench press', 'Incline dumbbell press']);
    const live = (await s.workout.load(sessionId))?.aggregate.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId) ?? [];
    const v = buildExercisePickerView({ index, query: '', group: null, exclude: live, suggested: [] });
    expect(v.recent.map((r) => r.name)).toEqual(['Incline dumbbell press']);
    const db = buildExercisePickerView({ index, query: '', group: 'Chest', equipment: 'dumbbells', exclude: live, suggested: [] });
    const rows = db.sections.flatMap((x) => x.parts.flatMap((p) => p.rows));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /dumbbell/i.test(r.line) || /dumbbell/i.test(r.name))).toBe(true);
    expect(bench).not.toBe('');
  });

  it('Recent reaches back 4 weeks only', async () => {
    const { s, sessionId } = await started();
    h.clockMs += 40 * DAY;
    const index = await s.exercisePicker.forSession(sessionId, null);
    expect(index.recent ?? []).toEqual([]);
  });
});

describe('Superset with… on the shared sheet (review 26 Oct #2)', () => {
  it('a new exercise is added as the partner with as many sets as it has left; Undo; the same opId twice is one add', async () => {
    const { s, sessionId, bench, a } = await started();
    const left = a.sets.filter((x) => x.sessionExerciseId === bench && x.status === 'pending' && x.setType !== 'warmup').length;
    const index = await s.exercisePicker.forSession(sessionId, null);
    const fly = index.entries.find((e) => e.exercise.name === 'Dumbbell fly')?.exercise.id ?? '';
    const r = ok(await s.workoutEdit.add(sessionId, fly, 'pair-fly', { supersetWith: bench }));
    const row = r.exercises.find((e) => e.exerciseId === fly && e.removed === undefined);
    expect(row?.supersetGroup).not.toBeNull();
    expect(r.exercises.find((e) => e.id === bench)?.supersetGroup).toBe(row?.supersetGroup);
    expect(r.sets.filter((x) => x.sessionExerciseId === row?.id && x.setType !== 'warmup')).toHaveLength(left);
    const again = await s.workoutEdit.add(sessionId, fly, 'pair-fly', { supersetWith: bench });
    expect(again.ok && again.duplicate).toBe(true);
    expect(ok(again).exercises.filter((e) => e.exerciseId === fly && e.removed === undefined)).toHaveLength(1);
    const undone = await s.workout.undoOp({ sessionId, targetOpId: 'pair-fly' });
    expect(undone.ok).toBe(true);
    expect((await s.workout.load(sessionId))?.aggregate.exercises.filter((e) => e.exerciseId === fly && e.removed === undefined)).toHaveLength(0);
  });

  it('an exercise already in the workout is linked on the version it was worked out from; a stale one is refused', async () => {
    const { s, sessionId, bench } = await started();
    const index = await s.exercisePicker.forSession(sessionId, null);
    const curl = index.entries.find((e) => e.exercise.name === 'Dumbbell curl')?.exercise.id ?? '';
    const added = ok(await s.workoutEdit.add(sessionId, curl, 'add-curl'));
    const curlRow = added.exercises.find((e) => e.exerciseId === curl)?.id ?? '';
    const stale = await s.workout.linkSuperset({ sessionId, sessionExerciseId: bench, withSessionExerciseId: curlRow, expectedVersion: added.session.version - 1, opId: 'link-stale' });
    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_version' } });
    const linked = ok(await s.workout.linkSuperset({ sessionId, sessionExerciseId: bench, withSessionExerciseId: curlRow, expectedVersion: added.session.version, opId: 'link-curl' }));
    expect(linked.exercises.find((e) => e.id === curlRow)?.supersetGroup).toBe(linked.exercises.find((e) => e.id === bench)?.supersetGroup);
  });
});

describe('no live-workout path opens the old picker (review 26 Oct #2)', () => {
  const SRC = join(import.meta.dirname, '..', 'src');
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []));
  it('nothing navigates to ExercisePicker and the route is gone', () => {
    for (const f of files(SRC)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/['"]ExercisePicker['"]/);
    const screen = readFileSync(join(SRC, 'screens', 'workout', 'WorkoutScreen.tsx'), 'utf8');
    expect(screen).toContain('workoutEdits.openSupersetWith(ex.sessionExerciseId)');
    expect(screen.match(/workoutEdits\.openAdd\(\)/g)?.length).toBeGreaterThanOrEqual(5);
  });
});

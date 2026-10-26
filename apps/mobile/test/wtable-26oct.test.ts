import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildExercisePickerView, saveDraftCommand, type CommandOutcome } from '@fizz/domain';
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

const plain = (x: string | null | undefined) => (x ?? '').replaceAll(' ', ' ');

describe('last time on every row (Ben, 26 Oct)', () => {
  it('each row shows its comparable set from the last session; an extra set shows none; a copied draft survives a force-close', async () => {
    const { s, sessionId, bench } = await started();
    // A fourth set: last time had three.
    const a = ok(await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: 'extra', sessionExerciseId: bench, newSetId: h.ids(), setType: null }));
    const d = await s.workout.load(sessionId);
    if (d === null) throw new Error('no workout');
    const rows = s.workout.tableView(d, h.clockMs, null).blocks.flatMap((b) => (b.kind === 'exercise' && b.card.sessionExerciseId === bench ? b.card.rows : []));
    const working = rows.filter((r) => r.setType !== 'warmup');
    expect(working.map((r) => (r.last === null ? '—' : plain(r.last.text)))).toEqual(['100 × 8', '100 × 7', '95 × 8', '—']);
    // Copy set 2's last time into it as the open row's draft (what the line's tap does), then force-close.
    const second = working[1];
    if (second?.last == null) throw new Error('no last');
    const set = a.sets.find((x) => x.id === second.setId);
    ok(await s.workout.dispatch(sessionId, { type: 'set_active_set', at: h.now(), opId: 'pick-2', setId: second.setId, expectedVersion: a.session.version }));
    // The draft path the open row saves (debounced on the phone); twice is the same draft (a copy is a value, not a log).
    const copy = saveDraftCommand({ setId: second.setId, values: second.last.values, setVersion: set?.version ?? 1, copied: true }, h.now());
    ok(await s.workout.dispatch(sessionId, copy));
    const twice = ok(await s.workout.dispatch(sessionId, { ...copy, expectedSetVersion: (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === second.setId)?.version ?? 1 }));
    expect(twice.sets.filter((x) => x.status === 'completed')).toHaveLength(0);
    await h.forceClose();
    const s2 = (await h.launch()).services;
    const back = await s2.workout.load(sessionId);
    const copied = back?.aggregate.sets.find((x) => x.id === second.setId);
    expect(copied?.status).toBe('pending');
    expect(copied?.draft).toMatchObject({ load: { value: 100, unit: 'kg', convention: 'total' }, reps: 7 });
    // Nothing done was touched (rule 2): no set is logged.
    expect(back?.aggregate.sets.filter((x) => x.status === 'completed')).toHaveLength(0);
  });
});

describe('PB on the row (Ben, 26 Oct): the Summary’s New best, set by set', () => {
  it('only real bests at the tracked reps, against history and earlier sets today; the Summary agrees after Finish', async () => {
    const { s, sessionId, bench, a } = await started();
    const lifts = await s.reviews.liftChoices();
    const benchId = lifts.find((c) => c.name === 'Bench press')?.exerciseId ?? '';
    const version = (await s.reviews.progress())?.trainingVersion ?? 1;
    expect(await s.training.change({ kind: 'progress_lifts', exerciseIds: [benchId], reps: { [benchId]: 8 } }, version, 'lifts-1')).toMatchObject({ ok: true });
    const ctx = await s.reviews.liveBestsContext();
    if (ctx === null) throw new Error('no context');
    const sets = a.sets.filter((x) => x.sessionExerciseId === bench && x.setType !== 'warmup').sort((x, y) => x.index - y.index);
    let cur = a;
    const log = async (setId: string, load: number, reps: number) => {
      h.clockMs += 120_000;
      cur = ok(await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log-${setId}-${String(h.clockMs)}`, setId, values: { load: { value: load, unit: 'kg', convention: 'total' }, reps, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() }));
      return s.reviews.liveNewBests(ctx, cur);
    };
    // 100 × 8 ties last time's best: not a PB. 102.5 × 6 is short of the tracked 8 reps: not one (no estimates).
    expect((await log(sets[0]?.id ?? '', 100, 8)).size).toBe(0);
    expect((await log(sets[1]?.id ?? '', 102.5, 6)).size).toBe(0);
    // 102.5 × 8: a real best.
    const third = await log(sets[2]?.id ?? '', 102.5, 8);
    expect([...third]).toEqual([sets[2]?.id]);
    // Undo of that log takes the mark away (it is worked out from the sets as they are).
    const logged3 = cur.sets.find((x) => x.id === sets[2]?.id);
    cur = ok(await s.workout.dispatch(sessionId, { type: 'undo_log', at: h.now(), opId: 'undo-3', setId: sets[2]?.id ?? '', expectedSetVersion: logged3?.version ?? 1 }));
    expect(s.reviews.liveNewBests(ctx, cur).size).toBe(0);
    expect([...(await log(sets[2]?.id ?? '', 102.5, 8))]).toEqual([sets[2]?.id]);
    h.clockMs += 60_000;
    ok(await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'finish', expectedVersion: cur.session.version, endedAt: null }));
    const bests = await s.reviews.sessionBests(sessionId);
    expect(bests.map((b) => plain(b.text))).toEqual(['New best · Bench press 102.5 × 8']);
  });

  it('a lift’s first ever session is never a PB', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const st = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!st.ok) throw new Error(st.error.message);
    const sessionId = st.aggregate.session.id;
    const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
    const a = ok(await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-bench' }));
    const ctx = await s.reviews.liveBestsContext();
    const set = a.sets.find((x) => x.setType !== 'warmup');
    const logged = ok(await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: set?.id ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() }));
    expect(ctx === null ? 0 : s.reviews.liveNewBests(ctx, logged).size).toBe(0);
  });
});

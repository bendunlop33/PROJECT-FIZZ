import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import {
  historySummaryOf,
  HISTORY_SUMMARY_FORMAT,
  reduceSession,
  startWorkout,
  toHistorySessions,
  toHistoryWorkout,
  type HistorySummary,
} from '@fizz/domain';
import { assisted, at, barbell, exercise, GYM, id, idGen, lb, OWNER, profile, richFinishedSession, routine, routineExercise, template, values } from '@fizz/domain/testing';
import type { SessionAggregate, SessionCommand } from '@fizz/schemas';
import {
  createBackup,
  DatabaseManager,
  DERIVED_TABLES,
  exportTables,
  migrate,
  MIGRATIONS,
  openStore,
  readAggregate,
  type Store,
} from '../src/index';
import { nodeDatabaseHost, openNodeDriver } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * (ADR 0032, Ben-approved 24 Oct) The stored per-workout history summary: written in the same transaction as every
 * save, edit, delete, restore, import and purge; backfilled by migration 36; rebuilt on open when missing or stale and
 * by the repair path when the check finds one that disagrees; never in a backup. History reads use it instead of
 * decoding every workout, and fall back to decoding when it isn't current.
 */

const PRESS = exercise(250, 'Bench press (lb)', { compatibleEquipment: ['barbell'], defaultLoadConvention: 'total' });
const PULLUP = exercise(251, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', movementPattern: 'pull' });
const lbBar = barbell({ id: id(120), unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 25, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] });
const assist = assisted({ id: id(121) });

/** A finished workout in lb on a barbell and on an assisted machine (assistance kg): every set logged. */
function mixedWorkout(k: number): SessionAggregate {
  const r = routine([
    routineExercise(800 + k * 10, { exerciseId: PRESS.id, equipmentId: lbBar.id, order: 0, setTemplates: [template(8000 + k * 10, { targetLoad: lb(135), targetReps: { min: 6, max: 8 } }), template(8001 + k * 10, { targetLoad: lb(135), targetReps: { min: 6, max: 8 } })] }),
    routineExercise(801 + k * 10, { exerciseId: PULLUP.id, equipmentId: assist.id, order: 1, setTemplates: [template(8002 + k * 10, { targetLoad: { value: 25, unit: 'kg', convention: 'assistance' }, targetReps: { min: 6, max: 10 } })] }),
  ]);
  let a = startWorkout({ opId: `mixed-${String(k)}`, owner: profile(), gymId: GYM, routine: r, exercises: new Map([[PRESS.id, PRESS], [PULLUP.id, PULLUP]]), gymEquipment: [lbBar, assist], at: at(k * 86_400), newId: idGen(200_000 + k * 1000) }).aggregate;
  const apply = (cmd: SessionCommand) => {
    const res = reduceSession(a, cmd);
    if (!res.ok) throw new Error(res.error.message);
    a = res.state;
  };
  let n = 0;
  while (a.session.activeSetId !== null) {
    const set = a.sets.find((x) => x.id === a.session.activeSetId);
    if (set === undefined) throw new Error('no set');
    apply({ type: 'log_set', at: at(k * 86_400 + 60 + n * 120), opId: `mixed-${String(k)}-log-${String(n)}`, setId: set.id, values: values(set.planned.load, 7, { rpe: 8 }), restTimerId: id(300_000 + k * 100 + n) });
    n += 1;
  }
  apply({ type: 'finish', at: at(k * 86_400 + 3600), opId: `mixed-${String(k)}-finish`, expectedVersion: a.session.version, endedAt: null });
  return a;
}

async function seeded(): Promise<Store> {
  const store = await openStore(memoryDriver());
  await store.repos.profiles.save(profile(), null);
  return store;
}

/** The stored summary rows, raw. */
const rows = (store: Store) => store.db.read((q) => q.getAll<{ session_id: string; revision: number; format: number; data: string; lifts: string }>('SELECT session_id, revision, format, data, lifts FROM history_summaries ORDER BY session_id'));

let store: Store;
beforeEach(async () => {
  store = await seeded();
});
afterEach(async () => {
  if (!store.db.isClosed) await store.close();
});

describe('written with every workout write, in the same transaction', () => {
  it('a finished workout has exactly the summary recomputed from it (kg per hand, lb, assisted)', async () => {
    const rich = richFinishedSession();
    const mixed = mixedWorkout(1);
    expect((await store.repos.sessions.save(rich, null)).ok).toBe(true);
    expect((await store.repos.sessions.save(mixed, null)).ok).toBe(true);
    const stored = await rows(store);
    expect(stored.map((r) => r.session_id).sort()).toEqual([rich.session.id, mixed.session.id].sort());
    for (const r of stored) expect(r.format).toBe(HISTORY_SUMMARY_FORMAT);
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: true, checked: 2, missing: [], differing: [], orphans: [] });
    // Loads keep their unit and convention: lb total, assistance kg, per hand.
    const press = (await store.listExerciseHistory(OWNER, PRESS.id)).flatMap((h) => h.sets.map((x) => x.load));
    expect(press.every((l) => l?.unit === 'lb' && l.convention === 'total' && l.value === 135)).toBe(true);
    const pull = (await store.listExerciseHistory(OWNER, PULLUP.id)).flatMap((h) => h.sets.map((x) => x.load));
    expect(pull).toEqual([{ value: 25, unit: 'kg', convention: 'assistance' }]);
    const split = rich.exercises[0]?.exerciseId ?? '';
    expect(await store.listExerciseHistory(OWNER, split)).toEqual(toHistorySessions(rich, split, { identity: true }));
  });

  it('an unfinished workout has none; Finish writes it; a correction rewrites it at the new revision', async () => {
    const mixed = mixedWorkout(2);
    // The same workout before Finish: active.
    const start = startWorkout({ opId: 'active-1', owner: profile(), gymId: GYM, routine: routine([routineExercise(900, { exerciseId: PRESS.id, equipmentId: lbBar.id, order: 0, setTemplates: [template(9000, { targetLoad: lb(135) })] })]), exercises: new Map([[PRESS.id, PRESS]]), gymEquipment: [lbBar], at: at(0), newId: idGen(400_000) }).aggregate;
    expect((await store.repos.sessions.save(start, null)).ok).toBe(true);
    expect(await rows(store)).toEqual([]);
    expect((await store.repos.sessions.save(mixed, null)).ok).toBe(true);
    const set = mixed.sets.find((x) => x.status === 'completed' && x.actual?.load?.unit === 'lb');
    if (set?.actual == null) throw new Error('no set');
    const fixed = reduceSession(mixed, { type: 'correct_set', at: at(200_000), opId: 'fix-lb', setId: set.id, expectedSetVersion: set.version, patch: { reps: 9 } });
    if (!fixed.ok) throw new Error(fixed.error.message);
    expect((await store.repos.sessions.save(fixed.state, mixed.revision)).ok).toBe(true);
    const r = (await rows(store)).find((x) => x.session_id === mixed.session.id);
    expect(r?.revision).toBe(fixed.state.revision);
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: true });
    expect((await store.listExerciseHistory(OWNER, PRESS.id)).flatMap((h) => h.sets.map((x) => x.reps))).toContain(9);
  });

  it('a stale save (another revision) or a repeated operation writes nothing: the summary stays the stored workout’s', async () => {
    const mixed = mixedWorkout(3);
    expect((await store.repos.sessions.save(mixed, null)).ok).toBe(true);
    const before = await rows(store);
    const set = mixed.sets.find((x) => x.status === 'completed');
    if (set === undefined) throw new Error('no set');
    const fixed = reduceSession(mixed, { type: 'correct_set', at: at(300_000), opId: 'fix-stale', setId: set.id, expectedSetVersion: set.version, patch: { reps: 3 } });
    if (!fixed.ok) throw new Error(fixed.error.message);
    // Stale: expected revision behind the stored one.
    expect(await store.repos.sessions.save(fixed.state, mixed.revision - 1)).toMatchObject({ ok: false, error: 'conflict' });
    // Duplicate start: the same workout again as new.
    expect(await store.repos.sessions.save(mixed, null)).toMatchObject({ ok: false, error: 'conflict' });
    expect(await rows(store)).toEqual(before);
    // The same operation ID replayed by the reducer is a no-op, so a save of it changes nothing either.
    const replay = reduceSession(fixed.state, { type: 'correct_set', at: at(300_000), opId: 'fix-stale', setId: set.id, expectedSetVersion: set.version, patch: { reps: 3 } });
    expect(replay.ok && replay.state).toBe(fixed.state);
  });

  it('delete removes it, restore brings it back, a purge leaves nothing behind', async () => {
    const mixed = mixedWorkout(4);
    expect((await store.repos.sessions.save(mixed, null)).ok).toBe(true);
    const del = await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, opId: 'del-1', at: at(500_000), items: [{ sessionId: mixed.session.id, expectedVersion: mixed.session.version }] });
    expect(del.ok).toBe(true);
    expect(await rows(store)).toEqual([]);
    expect(await store.listExerciseHistory(OWNER, PRESS.id)).toEqual([]);
    const deleted = await store.repos.sessions.get(mixed.session.id);
    expect((await store.repos.sessions.restoreWorkouts({ ownerId: OWNER, opId: 'restore-1', at: at(500_100), items: [{ sessionId: mixed.session.id, expectedVersion: deleted?.session.version ?? 0 }] })).ok).toBe(true);
    expect(await rows(store)).toHaveLength(1);
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: true, checked: 1 });
    const again = await store.repos.sessions.get(mixed.session.id);
    expect((await store.repos.sessions.deleteWorkouts({ ownerId: OWNER, opId: 'del-2', at: at(500_200), items: [{ sessionId: mixed.session.id, expectedVersion: again?.session.version ?? 0 }] })).ok).toBe(true);
    expect((await store.repos.sessions.purgeDeleted({ ownerId: OWNER, opId: 'purge-1', at: at(500_300), sessionIds: [mixed.session.id] })).ok).toBe(true);
    expect(await store.db.read((q) => q.getAll('SELECT session_id FROM history_summary_exercises'))).toEqual([]);
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: true, orphans: [] });
  });
});

describe('history reads use the summaries', () => {
  it('read without decoding: a workout whose rows went bad after its summary was written still reads from the summary until the check drops it', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const file = join(dir, 'training.db');
      let s = await openStore(openNodeDriver(file));
      await s.repos.profiles.save(profile(), null);
      const mixed = mixedWorkout(5);
      expect((await s.repos.sessions.save(mixed, null)).ok).toBe(true);
      const want = toHistorySessions(mixed, PRESS.id, { identity: true });
      await s.close();
      // Damage the workout's rows behind the app's back (its revision stays).
      const raw = new DatabaseSync(file);
      raw.prepare("UPDATE session_exercises SET exercise_name = '' WHERE session_id = ?").run(mixed.session.id);
      raw.close();
      // Restart: the summary is current by revision, so it is read (no decode) and still gives the history.
      s = await openStore(openNodeDriver(file));
      expect(await s.listExerciseHistory(OWNER, PRESS.id)).toEqual(want);
      expect((await s.repos.sessions.listFinishedBetween(OWNER, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')).map((w) => w.session.id)).toEqual([mixed.session.id]);
      // The consistency check can't recompute it (unreadable); the repair removes its summary; reads then decode and fail as before.
      expect(await s.checkHistorySummaries()).toMatchObject({ unreadable: [mixed.session.id] });
      expect(await s.repairHistorySummaries([mixed.session.id])).toMatchObject({ removed: 1, unreadable: [mixed.session.id] });
      await expect(s.repos.sessions.listFinishedWithExercise(OWNER, PRESS.id)).rejects.toThrow();
      expect((await s.repos.sessions.listFinishedBetweenReadable(OWNER, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')).unreadable).toBe(1);
      await s.close();
    } finally {
      cleanup();
    }
  });

  it('a summary that isn’t current (another revision or format) is never read: the workout is decoded instead, and the next open rebuilds it', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const file = join(dir, 'training.db');
      let s = await openStore(openNodeDriver(file));
      await s.repos.profiles.save(profile(), null);
      const a = mixedWorkout(6);
      const b = mixedWorkout(7);
      expect((await s.repos.sessions.save(a, null)).ok).toBe(true);
      expect((await s.repos.sessions.save(b, null)).ok).toBe(true);
      // A wrong summary at an old revision, and one of another format.
      await s.db.write(async (tx) => {
        await tx.run("UPDATE history_summaries SET revision = revision - 1, data = json_set(data, '$.session.routineName', 'WRONG') WHERE session_id = ?", [a.session.id]);
        await tx.run('UPDATE history_summaries SET format = format + 1 WHERE session_id = ?', [b.session.id]);
      });
      const fresh = await openStore(openNodeDriver(file));
      // Reads on the store opened before the change see the truth by decoding (no `WRONG`).
      const read = await s.repos.sessions.listFinishedBetween(OWNER, '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z');
      expect(read.map((w) => w.session.routineName)).not.toContain('WRONG');
      expect(read).toEqual([a, b].map(toHistoryWorkout));
      await s.close();
      // The store opened after it rebuilt both on open.
      expect(fresh.summaryRefresh).toMatchObject({ written: 2 });
      expect(await fresh.checkHistorySummaries()).toMatchObject({ ok: true, checked: 2 });
      await fresh.close();
      s = await openStore(openNodeDriver(file));
      expect(s.summaryRefresh).toMatchObject({ written: 0, removed: 0 });
      await s.close();
    } finally {
      cleanup();
    }
  });

  it('the repair path: a summary at the right revision that disagrees with its workout is found by the check and rebuilt', async () => {
    const mixed = mixedWorkout(8);
    expect((await store.repos.sessions.save(mixed, null)).ok).toBe(true);
    await store.db.write((tx) => tx.run("UPDATE history_summaries SET lifts = json_set(lifts, '$.\"' || ? || '\"[0].sets[0].reps', 99) WHERE session_id = ?", [PRESS.id, mixed.session.id]));
    const repsNow = async () => (await store.listExerciseHistory(OWNER, PRESS.id)).flatMap((h) => h.sets.map((x) => x.reps));
    // Current by revision, so it is what history reads (the check is what catches it).
    expect(await repsNow()).toContain(99);
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: false, differing: [mixed.session.id] });
    expect(await store.repairHistorySummaries()).toMatchObject({ written: 1 });
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: true, differing: [] });
    // Reads after the repair see the rebuilt summary (nothing parsed before it is reused).
    expect(await repsNow()).not.toContain(99);
    expect(await repsNow()).toEqual(toHistorySessions(mixed, PRESS.id, { identity: true }).flatMap((h) => h.sets.map((x) => x.reps)));
  });

  it('orphaned rows (a workout no longer in history) are reported and removed', async () => {
    const mixed = mixedWorkout(9);
    expect((await store.repos.sessions.save(mixed, null)).ok).toBe(true);
    await store.db.write((tx) => tx.run("UPDATE sessions SET status = 'discarded' WHERE id = ?", [mixed.session.id]));
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: false, orphans: [mixed.session.id] });
    expect(await store.repairHistorySummaries()).toMatchObject({ removed: 1 });
    expect(await store.checkHistorySummaries()).toMatchObject({ ok: true, orphans: [] });
  });

  it('the summary is the workout as history reads it: the same session, rows, sets and revision; no audit trail', () => {
    const rich = richFinishedSession();
    const s = historySummaryOf(rich) as HistorySummary;
    expect(s.workout).toEqual({ session: rich.session, exercises: rich.exercises, sets: rich.sets, revision: rich.revision, addedRowIds: [] });
    expect(Object.keys(s.workout)).not.toContain('audit');
    expect(historySummaryOf({ ...rich, session: { ...rich.session, status: 'active', endedAt: null } })).toBeNull();
  });
});

describe('migration 36 backfills every stored workout', () => {
  it('a schema-35 database with workouts gets their summaries in the migration’s own transaction', async () => {
    const db = memoryDriver();
    const at35 = await openStore(db, { migrations: MIGRATIONS.slice(0, 35) });
    await at35.repos.profiles.save(profile(), null);
    const workouts = [richFinishedSession(), mixedWorkout(10), mixedWorkout(11)];
    for (const w of workouts) expect((await at35.repos.sessions.save(w, null)).ok).toBe(true);
    const before = await at35.db.read((q) => exportTables(q));
    const at36 = await openStore(db);
    expect(at36.migration).toMatchObject({ from: 35, applied: [36, 37, 38, 39, 40] });
    // Backfilled by the migration (nothing left for the open-time refresh).
    expect(at36.summaryRefresh).toMatchObject({ written: 0 });
    expect(await at36.checkHistorySummaries()).toMatchObject({ ok: true, checked: 3 });
    // Your data unchanged (migration 37 only adds empty past-log columns); the derived tables aren't in an export.
    expect(await at36.db.read((q) => exportTables(q))).toEqual({
      ...before,
      // Migration 38 adds the Apple Health tables (empty).
      health_writes: [],
      health_links: [],
      sessions: (before.sessions ?? []).map((r) => ({ ...r, past_log: null })),
      timing_audit: (before.timing_audit ?? []).map((r) => ({ ...r, shift_ms: null })),
    });
    for (const w of workouts) expect(await at36.db.read((q) => readAggregate(q, w.session.id))).toEqual(w);
    await at36.close();
  });

  it('`migrate` alone (no backfill, as a restore builds) leaves them to the open-time refresh', async () => {
    const db = memoryDriver();
    const at35 = await openStore(db, { migrations: MIGRATIONS.slice(0, 35) });
    await at35.repos.profiles.save(profile(), null);
    expect((await at35.repos.sessions.save(mixedWorkout(12), null)).ok).toBe(true);
    expect(await migrate(db)).toMatchObject({ applied: [36, 37, 38, 39, 40] });
    const opened = await openStore(db);
    expect(opened.summaryRefresh).toMatchObject({ written: 1 });
    expect(await opened.checkHistorySummaries()).toMatchObject({ ok: true, checked: 1 });
    await opened.close();
  });
});

describe('backups: derived, so never in the file; a restore rebuilds them', () => {
  it('the backup has no summary tables; the restored database has every summary, consistent', async () => {
    for (const w of [richFinishedSession(), mixedWorkout(13), mixedWorkout(14)]) expect((await store.repos.sessions.save(w, null)).ok).toBe(true);
    const backup = await createBackup(store, { at: at(900_000), app: { name: 'test', version: '0', build: null } });
    for (const t of DERIVED_TABLES) expect(backup.text.includes(`"${t}"`)).toBe(false);
    const { dir, cleanup } = tempDir();
    try {
      let n = 0;
      const manager = await DatabaseManager.open({ host: nodeDatabaseHost(dir), newName: () => `db-${String(++n)}.db` });
      expect(await manager.restore(backup.text, at(900_100))).toMatchObject({ ok: true, status: 'restored' });
      expect(await manager.store.checkHistorySummaries()).toMatchObject({ ok: true, checked: 3 });
      expect(await manager.store.listExerciseHistory(OWNER, PRESS.id)).toEqual(await store.listExerciseHistory(OWNER, PRESS.id));
      // Restoring the same file again is `unchanged`: the derived tables never count as a difference.
      expect(await manager.restore(backup.text, at(900_200))).toMatchObject({ ok: true, status: 'unchanged' });
      await manager.close();
    } finally {
      cleanup();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { reduceSession, toHistorySessions, toHistoryWorkout } from '@fizz/domain';
import { at, profile, richFinishedSession } from '@fizz/domain/testing';
import type { SessionAggregate } from '@fizz/schemas';
import { checkIntegrity, exportTables, migrate, MIGRATIONS, openStore, readAggregate } from '../src/index';
import { memoryDriver } from './helpers';

/**
 * (Perf, 23 Oct: "so slow") Migration 35 (`session_exercises (session_id)`), the batched workout reads and the
 * history cache: what Today, Your workout and the plan builder read is the stored workout, never an older copy.
 */

describe('migration 35 (session_exercises index)', () => {
  it('in place on a schema-34 database: every row kept, the index there, and workout reads use it', async () => {
    const db = memoryDriver();
    const at34 = await openStore(db, { migrations: MIGRATIONS.filter((m) => m.version <= 34) });
    await at34.repos.profiles.save(profile(), null);
    await at34.repos.sessions.save(richFinishedSession(), null);
    const before = await at34.db.read((q) => exportTables(q));
    expect(await migrate(db)).toMatchObject({ from: 34, to: 37, applied: [35, 36, 37] });
    const at35 = await openStore(db);
    // Migration 37 adds `sessions.past_log` and `timing_audit.shift_ms` (both NULL here).
    const after = await at35.db.read((q) => exportTables(q));
    expect(after).toEqual({ ...before, sessions: (before.sessions ?? []).map((r) => ({ ...r, past_log: null })), timing_audit: (before.timing_audit ?? []).map((r) => ({ ...r, shift_ms: null })) });
    const plan = await at35.db.read((q) => q.getAll<{ detail: string }>('EXPLAIN QUERY PLAN SELECT * FROM session_exercises WHERE session_id = ? ORDER BY ordinal, id', ['x']));
    expect(plan.map((r) => r.detail).join(' ')).toContain('session_exercises_session');
    expect((await checkIntegrity(at35.db)).ok).toBe(true);
    await at35.close();
  });
});

describe('the history cache', () => {
  const owner = profile().id;
  const rich = richFinishedSession();
  const exerciseId = rich.exercises[0]?.exerciseId ?? '';

  async function seeded() {
    const store = await openStore(memoryDriver());
    await store.repos.profiles.save(profile(), null);
    expect((await store.repos.sessions.save(rich, null)).ok).toBe(true);
    return store;
  }

  it('batched reads give exactly what one-by-one reads give', async () => {
    const store = await seeded();
    const one = await store.db.read((q) => readAggregate(q, rich.session.id));
    if (one === null) throw new Error('not saved');
    // (ADR 0032) History reads give the workout as history reads it (its stored summary).
    const summary = toHistoryWorkout(one);
    const many = await store.repos.sessions.getMany([rich.session.id, 'missing']);
    expect(many.get(rich.session.id)).toEqual(summary);
    expect(many.has('missing')).toBe(false);
    expect(await store.repos.sessions.listFinishedWithExercise(owner, exerciseId)).toEqual([summary]);
    const both = await store.repos.sessions.listFinishedWithExercises(owner, [exerciseId, 'none']);
    expect(both.get(exerciseId)).toEqual([summary]);
    expect(both.get('none')).toEqual([]);
    expect((await store.listExerciseHistories(owner, [exerciseId])).get(exerciseId)).toEqual(await store.listExerciseHistory(owner, exerciseId));
    expect(await store.listExerciseHistory(owner, exerciseId)).toEqual(toHistorySessions(one, exerciseId, { identity: true }));
    await store.close();
  });

  it('a correction (a new revision) is read, never the cached copy; so is a save that keeps the revision', async () => {
    const store = await seeded();
    const first = await store.listExerciseHistory(owner, exerciseId);
    const set = rich.sets.find((x) => x.status === 'completed' && x.actual?.reps != null && rich.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === exerciseId);
    if (set?.actual == null) throw new Error('no logged set');
    const corrected = reduceSession(rich, { type: 'correct_set', at: at(9_000), opId: 'fix-1', setId: set.id, expectedSetVersion: set.version, patch: { reps: (set.actual.reps ?? 0) + 1 } });
    if (!corrected.ok) throw new Error(corrected.error.message);
    expect((await store.repos.sessions.save(corrected.state, rich.revision)).ok).toBe(true);
    const second = await store.listExerciseHistory(owner, exerciseId);
    expect(second).not.toEqual(first);
    expect(second.flatMap((h) => h.sets).some((x) => x.reps === (set.actual?.reps ?? 0) + 1)).toBe(true);
    // A save at the same revision (a caller that didn't bump it) is still read fresh.
    const same: SessionAggregate = { ...corrected.state, session: { ...corrected.state.session, routineName: 'Renamed' } };
    expect((await store.repos.sessions.save(same, corrected.state.revision)).ok).toBe(true);
    expect((await store.repos.sessions.listFinishedWithExercise(owner, exerciseId))[0]?.session.routineName).toBe('Renamed');
    await store.close();
  });

  it('a deleted workout leaves history at once, and comes back on Restore', async () => {
    const store = await seeded();
    expect(await store.listExerciseHistory(owner, exerciseId)).not.toHaveLength(0);
    const del = await store.repos.sessions.deleteWorkouts({ ownerId: owner, opId: 'cache-delete-op', at: at(10_000), items: [{ sessionId: rich.session.id, expectedVersion: rich.session.version }] });
    if (!del.ok) throw new Error(JSON.stringify(del.error));
    expect(await store.listExerciseHistory(owner, exerciseId)).toHaveLength(0);
    const deleted = await store.repos.sessions.get(rich.session.id);
    const back = await store.repos.sessions.restoreWorkouts({ ownerId: owner, opId: 'cache-restore-op', at: at(10_100), items: [{ sessionId: rich.session.id, expectedVersion: deleted?.session.version ?? 0 }] });
    expect(back.ok).toBe(true);
    expect(await store.listExerciseHistory(owner, exerciseId)).not.toHaveLength(0);
    await store.close();
  });

  it('`get` still returns a copy to change; history reads are shared and read-only', async () => {
    const store = await seeded();
    const a = await store.repos.sessions.get(rich.session.id);
    if (a === null) throw new Error('missing');
    a.sets.length = 0;
    expect((await store.repos.sessions.get(rich.session.id))?.sets).toHaveLength(rich.sets.length);
    const h1 = await store.repos.sessions.listFinishedWithExercise(owner, exerciseId);
    const h2 = await store.repos.sessions.listFinishedWithExercise(owner, exerciseId);
    expect(h2[0]).toBe(h1[0]);
    await store.close();
  });
});

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionService } from '@fizz/domain';
import {
  apply,
  at,
  dumbbells,
  GYM,
  id,
  idGen,
  kg,
  logCmd,
  OWNER,
  profile,
  richFinishedSession,
  routine,
  routineExercise,
  SPLIT_SQUAT,
  startFixture,
  template,
  unilateralSession,
  values,
} from '@fizz/domain/testing';
import type { SessionAggregate } from '@fizz/schemas';
import { CorruptDataError, HistoryRewriteError, InvalidRecordError, openStore, parseJson, type Store } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { failingDriver, memoryDriver, tempDir } from './helpers';

async function seed(store: Store): Promise<void> {
  const { repos } = store;
  await repos.profiles.save(profile(), null);
  await repos.equipment.save(dumbbells(), null);
  await repos.exercises.save(SPLIT_SQUAT, null);
  await repos.routines.save(
    routine([
      routineExercise(700, {
        exerciseId: SPLIT_SQUAT.id,
        equipmentId: dumbbells().id,
        setTemplates: [7001, 7002].map((n) => template(n, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })),
      }),
    ]),
    null,
  );
}

describe('restart recovery on a database file', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it('recovers the active workout after a force-close and keeps operation IDs idempotent', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sessionId = started.aggregate.session.id;
    const setId = started.aggregate.sets[0]?.id ?? '';
    const log = logCmd(setId, values(kg(15, 'per_hand'), 10, { rpe: 8 }), 60, 'log-1');
    const logged = await service.dispatch(sessionId, log);
    if (!logged.ok) throw new Error(logged.error.code);
    // "Force-close": drop every in-memory object; only the file survives.
    await store.close();

    store = await openStore(openNodeDriver(path));
    expect(store.migration.applied).toEqual([]);
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(120));
    expect(recovered?.state.sets.find((s) => s.id === setId)).toEqual(logged.aggregate.sets.find((s) => s.id === setId));
    expect(recovered?.state.restTimer?.deadlineUtc).toBe(logged.aggregate.restTimer?.deadlineUtc);

    // The UI retries the same tap after relaunch: a duplicate, not a second set.
    const retry = await service.dispatch(sessionId, log);
    expect(retry).toMatchObject({ ok: true, duplicate: true, superseded: false });
    const startRetry = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(200) });
    expect(startRetry).toMatchObject({ ok: true, duplicate: true });
    const stored = await store.repos.sessions.get(sessionId);
    expect(stored?.sets.filter((s) => s.status === 'completed')).toHaveLength(1);
    expect(stored?.audit).toHaveLength(1);
    await store.close();
  });

  it('a write killed mid-transaction leaves no partial set, and the retry lands once', async () => {
    const path = join(dir, 'training.db');
    const failing = failingDriver(openNodeDriver(path), (sql) => sql.includes('INSERT INTO "set_audit"'));
    let store = await openStore(failing);
    await seed(store);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sessionId = started.aggregate.session.id;
    const log = logCmd(started.aggregate.sets[0]?.id ?? '', values(kg(15, 'per_hand'), 10), 60, 'log-1');

    expect(await service.dispatch(sessionId, log)).toMatchObject({ ok: false, error: { code: 'write_failed' } });
    // The set row was upserted before the audit insert failed; the rollback removed it.
    expect(await store.repos.sessions.get(sessionId)).toEqual(started.aggregate);
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const retried = await service.dispatch(sessionId, log);
    expect(retried).toMatchObject({ ok: true, duplicate: false });
    expect(await service.dispatch(sessionId, log)).toMatchObject({ ok: true, duplicate: true });
    expect((await store.repos.sessions.get(sessionId))?.sets.filter((s) => s.status === 'completed')).toHaveLength(1);
    await store.close();
  });
});

describe('validation on read and write (review nit 8)', () => {
  let store: Store;
  beforeEach(async () => {
    store = await openStore(memoryDriver());
  });
  afterEach(async () => {
    await store.close();
  });
  const sql = (text: string, params: (string | number | null)[] = []) => store.db.driver.run(text, params);

  it('refuses to write an invalid record and writes nothing', async () => {
    await expect(store.repos.profiles.save({ ...profile(), timezone: 'Mars/Olympus' }, null)).rejects.toBeInstanceOf(InvalidRecordError);
    expect(await store.repos.profiles.get(OWNER)).toBeNull();
    const { state } = startFixture();
    await expect(store.repos.sessions.save({ ...state, revision: -1 }, null)).rejects.toBeInstanceOf(InvalidRecordError);
    expect(await store.repos.sessions.get(state.session.id)).toBeNull();
  });

  it('fails loudly on a document that no longer matches its schema or its columns', async () => {
    await store.repos.equipment.save(dumbbells(), null);
    await sql("UPDATE equipment SET data = json_set(data, '$.loads', json('[10, 5]'))");
    await expect(store.repos.equipment.get(dumbbells().id)).rejects.toThrow(/Corrupt equipment row .*loads/);

    await store.repos.profiles.save(profile(), null);
    await sql('UPDATE profiles SET version = 7');
    await expect(store.repos.profiles.get(OWNER)).rejects.toBeInstanceOf(CorruptDataError);

    await store.repos.exercises.save(SPLIT_SQUAT, null);
    // Malformed JSON can't even be stored (CHECK json_valid); valid JSON of the wrong shape is caught on read.
    await expect(sql("UPDATE exercises SET data = '{not json'")).rejects.toThrow('CHECK constraint failed');
    await sql("UPDATE exercises SET data = '42'");
    await expect(store.repos.exercises.list()).rejects.toBeInstanceOf(CorruptDataError);
    expect(() => parseJson('t', 'i', 'c', '{not json')).toThrow('Malformed JSON');
  });

  it('fails loudly on a corrupt session row instead of guessing', async () => {
    const { state } = startFixture();
    await store.repos.sessions.save(state, null);
    const setId = state.sets[0]?.id ?? '';
    // A completed set without a result is impossible; it must not be read as pending or as zero reps.
    await sql("UPDATE session_sets SET status = 'completed' WHERE id = ?", [setId]);
    await expect(store.repos.sessions.get(state.session.id)).rejects.toThrow(/Corrupt sessions row .*sets\.0\.status/);
    await sql("UPDATE session_sets SET status = 'pending', planned = '{\"load\": 5}' WHERE id = ?", [setId]);
    await expect(store.repos.sessions.get(state.session.id)).rejects.toBeInstanceOf(CorruptDataError);
    await expect(store.repos.sessions.getActive(OWNER)).rejects.toBeInstanceOf(CorruptDataError);
  });

  it('detects a lost audit row', async () => {
    const rich = richFinishedSession();
    await store.repos.sessions.save(rich, null);
    await store.db.driver.exec('DROP TRIGGER set_audit_no_delete');
    await sql('DELETE FROM set_audit WHERE ordinal = 1');
    await expect(store.repos.sessions.get(rich.session.id)).rejects.toThrow(/set_audit .*ordinal/);
  });
});

describe('history is append-only through the repository', () => {
  let store: Store;
  let saved: SessionAggregate;
  beforeEach(async () => {
    store = await openStore(memoryDriver());
    saved = richFinishedSession();
    await store.repos.sessions.save(saved, null);
  });
  afterEach(async () => {
    await store.close();
  });

  const attempt = (a: SessionAggregate) => store.repos.sessions.save({ ...a, revision: saved.revision + 1 }, saved.revision);

  it.each([
    ['an audit entry is dropped', (a: SessionAggregate) => ({ ...a, audit: a.audit.slice(1) })],
    ['audit entries are reordered', (a: SessionAggregate) => ({ ...a, audit: [...a.audit].reverse() })],
    ['a timing audit entry is dropped', (a: SessionAggregate) => ({ ...a, timingAudit: a.timingAudit.slice(0, 1) })],
    ['a set is removed instead of tombstoned', (a: SessionAggregate) => ({ ...a, sets: a.sets.slice(1) })],
    ['a processed operation is forgotten', (a: SessionAggregate) => ({ ...a, processedOps: Object.fromEntries(Object.entries(a.processedOps).slice(1)) })],
    ['a pause is edited', (a: SessionAggregate) => ({ ...a, session: { ...a.session, pauses: a.session.pauses.map((p) => ({ ...p, endUtc: p.startUtc })) } })],
  ])('rejects a save where %s, and keeps the stored aggregate', async (_label, mutate) => {
    await expect(attempt(mutate(saved))).rejects.toBeInstanceOf(HistoryRewriteError);
    expect(await store.repos.sessions.get(saved.session.id)).toEqual(saved);
  });

  it('rejects a set that belongs to another session', async () => {
    const other = unilateralSession('start-other', idGen(95_000));
    await store.repos.sessions.save(other, null);
    const stolen = saved.sets[0];
    if (!stolen) throw new Error('fixture');
    const hijack = { ...other, sets: [...other.sets, { ...stolen, sessionId: other.session.id, sessionExerciseId: other.exercises[0]?.id ?? '' }] };
    await expect(store.repos.sessions.save({ ...hijack, revision: other.revision + 1 }, other.revision)).rejects.toBeInstanceOf(HistoryRewriteError);
    expect(await store.repos.sessions.get(saved.session.id)).toEqual(saved);
  });

  it('allows only one active session per owner', async () => {
    await store.repos.sessions.save(startFixture().state, null);
    await expect(store.repos.sessions.save(unilateralSession('start-2', idGen(96_000)), null)).rejects.toThrow('UNIQUE');
  });
});

describe('listExerciseHistory', () => {
  it('returns finished sessions with this exercise, latest first, with sides', async () => {
    const store = await openStore(memoryDriver());
    const finish = (s: SessionAggregate, t: number) =>
      apply(s, { type: 'finish', at: at(t), opId: `fin-${t}`, expectedVersion: s.session.version, endedAt: null });

    const older = richFinishedSession();
    let newer = unilateralSession('start-new', idGen(97_000));
    newer = { ...newer, session: { ...newer.session, startedAt: at(86_400) } };
    newer = apply(newer, logCmd(newer.sets[0]?.id ?? '', values(kg(17.5, 'per_hand'), 9), 86_460, 'n-1', 'left'));
    newer = finish(newer, 86_500);
    const active = unilateralSession('start-active', idGen(98_000));
    for (const s of [older, newer, active]) await store.repos.sessions.save(s, null);

    const history = await store.listExerciseHistory(OWNER, SPLIT_SQUAT.id);
    expect(history.map((h) => h.sessionId)).toEqual([newer.session.id, older.session.id]);
    expect(history[0]?.sets.map((x) => [x.side, x.reps])).toEqual([['left', 9]]);
    // Set 1 left, set 2 both, then set 1's right side (the companion row); set 3 was undone and skipped.
    expect(history[1]?.sets.map((x) => x.side)).toEqual(['left', 'both', 'right']);
    expect(await store.listExerciseHistory(OWNER, id(999))).toEqual([]);
    await store.close();
  });
});

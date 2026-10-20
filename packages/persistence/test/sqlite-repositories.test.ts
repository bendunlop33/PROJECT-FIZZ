import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPresetDraft, createSessionService, materialiseGymDraft } from '@fizz/domain';
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

  it('an accidental tick undone after a force-close puts back the rest that was running, with its deadline (workout-table-v3 §3)', async () => {
    const path = join(dir, 'training.db');
    let store = await openStore(openNodeDriver(path));
    await seed(store);
    let service = createSessionService(store.repos, idGen(80_000));
    const started = await service.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-1', at: at(0) });
    if (!started.ok) throw new Error(started.error.code);
    const sessionId = started.aggregate.session.id;
    const [first, second] = started.aggregate.sets;
    if (!first || !second) throw new Error('fixture');
    const logged = await service.dispatch(sessionId, logCmd(first.id, values(kg(15, 'per_hand'), 10), 60, 'log-1'));
    if (!logged.ok) throw new Error(logged.error.code);
    const rest = logged.aggregate.restTimer;
    if (rest?.status !== 'running') throw new Error('no rest');
    const accidental = await service.dispatch(sessionId, logCmd(second.id, values(kg(15, 'per_hand'), 10), 65, 'log-2'));
    if (!accidental.ok) throw new Error(accidental.error.code);
    expect(accidental.aggregate.restTimer?.resumeOnUndo).toHaveLength(1);
    await store.close();

    store = await openStore(openNodeDriver(path));
    service = createSessionService(store.repos, idGen(90_000));
    const recovered = await service.recover(OWNER, at(70));
    expect(recovered?.state.restTimer).toEqual(accidental.aggregate.restTimer);
    const undone = await service.dispatch(sessionId, { type: 'undo_log', at: at(70), opId: 'undo-2', setId: second.id, expectedSetVersion: 2 });
    if (!undone.ok) throw new Error(undone.error.code);
    expect(undone.aggregate.restTimer).toMatchObject({ id: rest.id, status: 'running', deadlineUtc: rest.deadlineUtc });
    await store.close();

    store = await openStore(openNodeDriver(path));
    expect((await store.repos.sessions.get(sessionId))?.restTimer).toEqual(undone.aggregate.restTimer);
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

describe('sessions.listFinishedRefs (rotation, routine last done)', () => {
  it('lists finished workouts with a logged set, newest first, with their routine; not active or empty ones', async () => {
    const store = await openStore(memoryDriver());
    const older = richFinishedSession();
    let newer = unilateralSession('start-new', idGen(97_000));
    newer = { ...newer, session: { ...newer.session, startedAt: at(86_400), routineId: id(300) } };
    newer = apply(newer, logCmd(newer.sets[0]?.id ?? '', values(kg(17.5, 'per_hand'), 9), 86_460, 'n-1', 'left'));
    newer = apply(newer, { type: 'finish', at: at(86_500), opId: 'fin-n', expectedVersion: newer.session.version, endedAt: null });
    let empty = unilateralSession('start-empty', idGen(99_000));
    empty = apply(empty, { type: 'finish', at: at(86_600), opId: 'fin-e', expectedVersion: empty.session.version, endedAt: null });
    for (const s of [older, newer, empty]) await store.repos.sessions.save(s, null);
    await store.repos.sessions.save(unilateralSession('start-active', idGen(98_000)), null);
    const refs = await store.repos.sessions.listFinishedRefs(OWNER, 10);
    expect(refs.map((r) => [r.sessionId, r.routineId])).toEqual([
      [newer.session.id, id(300)],
      [older.session.id, older.session.routineId],
    ]);
    expect(refs[0]).toMatchObject({ startedAtUtc: at(86_400).utc, tz: at(0).tz });
    expect(await store.repos.sessions.listFinishedRefs(OWNER, 1)).toHaveLength(1);
    await store.close();
  });
});

describe('sessions.listSessionTypeRows (session picker)', () => {
  it('lists finished workouts with a logged set, newest first, with name, source and exercise count', async () => {
    const store = await openStore(memoryDriver());
    const older = richFinishedSession();
    let newer = unilateralSession('start-new', idGen(97_000));
    newer = { ...newer, session: { ...newer.session, startedAt: at(86_400), routineName: 'Legs' } };
    newer = apply(newer, logCmd(newer.sets[0]?.id ?? '', values(kg(17.5, 'per_hand'), 9), 86_460, 'n-1', 'left'));
    newer = apply(newer, { type: 'finish', at: at(86_500), opId: 'fin-n', expectedVersion: newer.session.version, endedAt: null });
    let empty = unilateralSession('start-empty', idGen(99_000));
    empty = apply(empty, { type: 'finish', at: at(86_600), opId: 'fin-e', expectedVersion: empty.session.version, endedAt: null });
    for (const s of [older, newer, empty]) await store.repos.sessions.save(s, null);
    const rows = await store.repos.sessions.listSessionTypeRows(OWNER, 10);
    expect(rows.map((r) => r.sessionId)).toEqual([newer.session.id, older.session.id]);
    // Exercises with a completed set only, as the next-session plan copies them (review r2 N3).
    const done = (agg: typeof older): number => new Set(agg.exercises.filter((e) => agg.sets.some((x) => x.sessionExerciseId === e.id && x.status === 'completed')).map((e) => e.exerciseId)).size;
    expect(rows[0]).toMatchObject({ routineName: 'Legs', imported: false, startedAtUtc: at(86_400).utc, exerciseCount: done(newer) });
    expect(rows[1]?.exerciseCount).toBe(done(older));
    expect(done(newer)).toBeGreaterThan(0);
    // The same exercises, by ID (F20: an unnamed import's type is named from them).
    const doneIds = (agg: typeof older): string[] => [...new Set(agg.exercises.filter((e) => agg.sets.some((x) => x.sessionExerciseId === e.id && x.status === 'completed')).map((e) => e.exerciseId))].sort();
    expect([...(rows[0]?.exerciseIds ?? [])].sort()).toEqual(doneIds(newer));
    expect([...(rows[1]?.exerciseIds ?? [])].sort()).toEqual(doneIds(older));
    expect(await store.repos.sessions.listSessionTypeRows(OWNER, 1)).toHaveLength(1);
    await store.close();
  });
});

describe('gyms.createWithEquipment (createGymFromDraft)', () => {
  const draftGym = () => {
    const result = materialiseGymDraft(buildPresetDraft('commercial', 'kg'), {
      name: 'Main gym',
      ownerId: OWNER,
      gymId: GYM,
      isDefault: true,
      atUtc: at(0).utc,
      newId: idGen(50_000),
    });
    if (!result.ok) throw new Error('preset did not validate');
    return result;
  };

  it('saves the gym and every item in one write, and a retry is a duplicate', async () => {
    const store = await openStore(memoryDriver());
    const { gym, equipment } = draftGym();
    expect(await store.repos.gyms.createWithEquipment(gym, equipment)).toEqual({ ok: true, duplicate: false });
    expect(await store.repos.gyms.createWithEquipment(gym, equipment)).toEqual({ ok: true, duplicate: true });
    expect(await store.repos.gyms.listByOwner(OWNER)).toHaveLength(1);
    const saved = await store.repos.equipment.listByGym(GYM);
    expect(saved).toHaveLength(6);
    expect(saved.every((e) => e.detailsSource === 'preset')).toBe(true);
    await store.close();
  });

  it('writes nothing when any item fails (all or nothing)', async () => {
    const store = await openStore(memoryDriver());
    const { gym, equipment } = draftGym();
    const first = equipment[0];
    if (!first) throw new Error('no equipment');
    // An equipment ID that already exists makes the whole write roll back.
    await store.repos.equipment.save(first, null);
    await expect(store.repos.gyms.createWithEquipment(gym, equipment)).rejects.toThrow(/already exists/);
    expect(await store.repos.gyms.listByOwner(OWNER)).toEqual([]);
    expect(await store.repos.equipment.listByGym(GYM)).toHaveLength(1);
    await store.close();
  });

  it('refuses equipment that belongs to another gym or owner', async () => {
    const store = await openStore(memoryDriver());
    const { gym, equipment } = draftGym();
    const stray = equipment.map((e, i) => (i === 0 ? { ...e, gymId: id(77) } : e));
    expect(await store.repos.gyms.createWithEquipment(gym, stray)).toEqual({ ok: false, error: 'mismatched_equipment' });
    expect(await store.repos.gyms.listByOwner(OWNER)).toEqual([]);
    await store.close();
  });
});

describe('countRecords', () => {
  it('counts finished and unfinished workouts, and logged sets of finished workouts only', async () => {
    const store = await openStore(memoryDriver());
    expect(await store.countRecords()).toEqual({ finishedWorkouts: 0, unfinishedWorkouts: 0, loggedSets: 0, gyms: 0, exercises: 0 });
    const finished = richFinishedSession();
    await store.repos.sessions.save(finished, null);
    const counts = await store.countRecords();
    expect(counts.finishedWorkouts).toBe(1);
    expect(counts.unfinishedWorkouts).toBe(0);
    expect(counts.loggedSets).toBe(finished.sets.filter((s) => s.status === 'completed').length);
    await store.close();
  });
});

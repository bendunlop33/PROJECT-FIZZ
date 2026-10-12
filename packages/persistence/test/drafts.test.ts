import { afterEach, describe, expect, it } from 'vitest';

import { applyDraftCommand, basisSlots, reduceSession, stableStringify, type DraftCommand } from '@fizz/domain';
import { at, hotelFixture, id, OWNER, profile } from '@fizz/domain/testing';
import { ActionRecordSchema, type ActionRecord, type DraftBasis, type PreStartDraft, type Routine, type SessionAggregate, type ZonedTimestamp } from '@fizz/schemas';

import { checkIntegrity, createBackup, DatabaseManager, latestVersion, migrate, MIGRATIONS, openStore, fenceHolds, readUserVersion, sha256Hex, type BackupFile, type SqlDriver, type SqlValue, type Store } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { memoryDriver, tempDir } from './helpers';

/**
 * Pre-start drafts in SQLite (ADR 0022, migration 7): versioned writes, one
 * open draft per basis, midnight expiry, the session create that consumes
 * one and discards the rest in its own transaction, the routine change and
 * its Undo, backup/restore (an open draft comes back discarded) and an
 * in-place migration from schema 6.
 */

let dirs: { dir: string; cleanup: () => void }[] = [];
afterEach(() => {
  for (const d of dirs) d.cleanup();
  dirs = [];
});
function managerIn(dir?: string): Promise<DatabaseManager> {
  let path = dir;
  if (path === undefined) {
    const d = tempDir();
    dirs.push(d);
    path = d.dir;
  }
  let n = 0;
  return DatabaseManager.open({ host: nodeDatabaseHost(path), newName: () => `d-${String(Date.now())}-${String((n += 1))}.db` });
}

const { BENCH, pushA } = hotelFixture;
const ROUTINE = id(300);
const BASIS = { kind: 'routine' as const, routineId: ROUTINE };

/** The fixture's routine, as stored. */
function routine(): Routine {
  const agg = pushA();
  return {
    id: ROUTINE,
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(0).utc,
    updatedAtUtc: at(0).utc,
    name: 'Push A',
    exercises: agg.exercises.map((e, i) => ({
      id: id(900 + i),
      exerciseId: e.exerciseId,
      equipmentId: e.equipmentId,
      order: i,
      supersetGroup: null,
      setTemplates: agg.sets
        .filter((s) => s.sessionExerciseId === e.id)
        .map((s, j) => ({ id: id(9500 + i * 10 + j), setType: s.setType, targetLoad: s.planned.load, targetReps: s.planned.reps, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null })),
      restBySetType: {},
      transitionRestS: null,
      progressionRuleId: null,
    })),
  };
}
const SLOTS = basisSlots({ kind: 'routine', routine: routine() });
const SLOT_BENCH = id(900);

function change(current: PreStartDraft | null, command: DraftCommand, opId: string, when: ZonedTimestamp = at(0), basis: DraftBasis = BASIS, newId = id(5000)): PreStartDraft {
  const c = applyDraftCommand({ current, expectedVersion: current?.version ?? null, opId, at: when, ownerId: OWNER, basis, newDraftId: newId, slots: SLOTS, command });
  if (c.kind !== 'write') throw new Error(c.kind);
  return c.next;
}

async function seeded(store: Store): Promise<void> {
  await store.repos.profiles.save(profile(), null);
  await store.repos.routines.save(routine(), null);
}

/** A workout started from the draft (`session.todayEdits`), or from nowhere. */
function startedFrom(draft: { id: string; version: number } | null, opId = 'start-1', startAt = at(60)): SessionAggregate {
  const a = pushA();
  return {
    ...a,
    session: {
      ...a.session,
      id: id(4000 + opId.length),
      startOperationId: opId,
      startedAt: startAt,
      lastActivityAtUtc: startAt.utc,
      ...(draft ? { todayEdits: { draftId: draft.id, draftVersion: draft.version, swapped: [], skipped: [], reordered: false } } : {}),
    },
    sets: a.sets.map((s) => ({ ...s, sessionId: id(4000 + opId.length) })),
    exercises: a.exercises.map((e) => ({ ...e, sessionId: id(4000 + opId.length) })),
  };
}

describe('the draft repository', () => {
  it('saves versioned writes, keeps one open draft per basis, and survives a relaunch (TE-A14)', async () => {
    const d = tempDir();
    dirs.push(d);
    const m1 = await managerIn(d.dir);
    await seeded(m1.store);
    const v1 = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(903) } }, 'op-1');
    expect(await m1.store.repos.drafts.save(v1, null)).toEqual({ ok: true, version: 1 });
    // A second open draft for the same basis is a conflict, never a second row.
    const other = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(902) } }, 'op-x', at(0), BASIS, id(5001));
    expect(await m1.store.repos.drafts.save(other, null)).toMatchObject({ ok: false, error: 'conflict' });
    const v2 = change(v1, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: id(805) } }, 'op-2');
    expect(await m1.store.repos.drafts.save(v2, 1)).toEqual({ ok: true, version: 2 });
    // A stale version writes nothing (rule 5).
    expect(await m1.store.repos.drafts.save(change(v1, { type: 'reset' }, 'op-3'), 1)).toMatchObject({ ok: false, error: 'conflict', currentVersion: 2 });
    await m1.close();

    // Force-close and relaunch: the draft is there as left.
    const m2 = await managerIn(d.dir);
    expect(await m2.store.repos.drafts.open(OWNER, BASIS)).toEqual(v2);
    expect((await checkIntegrity(m2.store.db)).ok).toBe(true);
    await m2.close();
  });

  it('expires at local midnight in the draft’s own time zone, once (TE-A15)', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const draft = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(903) } }, 'op-1');
    await store.repos.drafts.save(draft, null);
    expect(await store.repos.drafts.expire(OWNER, '2026-10-08T10:59:59.000Z')).toEqual([]);
    const closed = await store.repos.drafts.expire(OWNER, draft.expiresAtUtc);
    expect(closed.map((x) => [x.id, x.status, x.version])).toEqual([[draft.id, 'expired', 2]]);
    expect(await store.repos.drafts.open(OWNER, BASIS)).toBeNull();
    expect(await store.repos.drafts.expire(OWNER, draft.expiresAtUtc)).toEqual([]);
    // A new edit after midnight starts a new draft for the same basis.
    const fresh = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(903) } }, 'op-2', { utc: draft.expiresAtUtc, tz: draft.tz }, BASIS, id(5002));
    expect(await store.repos.drafts.save(fresh, null)).toEqual({ ok: true, version: 1 });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });
});

describe('a new workout closes the drafts in its own transaction (ADR 0022 §3)', () => {
  it('Start consumes the draft it came from and discards every other open one; the draft row is in the fence', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const mine = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(903) } }, 'op-1');
    const other = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(903) } }, 'op-2', at(0), { kind: 'next', sourceSessionId: id(77) }, id(5001));
    await store.repos.drafts.save(mine, null);
    await store.repos.drafts.save(other, null);
    const fence = { rows: [{ table: 'pre_start_drafts' as const, id: mine.id, version: mine.version }], sets: [] };
    expect(await store.db.read((q) => fenceHolds(q, fence))).toBe(true);

    const a = startedFrom(mine);
    expect(await store.repos.sessions.save(a, null, fence)).toMatchObject({ ok: true });
    const consumed = await store.repos.drafts.get(mine.id);
    expect(consumed).toMatchObject({ status: 'consumed', sessionId: a.session.id, version: 2 });
    expect(await store.repos.drafts.get(other.id)).toMatchObject({ status: 'discarded', version: 2, sessionId: null });
    // The consumed draft no longer holds the fence: a Start planned from it is stale.
    expect(await store.db.read((q) => fenceHolds(q, fence))).toBe(false);
    expect((await store.repos.sessions.get(a.session.id))?.session.todayEdits).toEqual(a.session.todayEdits);
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('a draft past its midnight, or at another version, creates nothing (TE-A12, TE-A15)', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const draft = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(903) } }, 'op-1');
    await store.repos.drafts.save(draft, null);
    // Started at 00:05 local, after the draft's midnight.
    const late = startedFrom(draft, 'late', { utc: '2026-10-08T11:05:00.000Z', tz: draft.tz });
    expect(await store.repos.sessions.save(late, null)).toEqual({ ok: false, error: 'stale_inputs' });
    expect(await store.repos.sessions.get(late.session.id)).toBeNull();
    const wrong = startedFrom({ id: draft.id, version: 9 }, 'wrong');
    expect(await store.repos.sessions.save(wrong, null)).toEqual({ ok: false, error: 'stale_inputs' });
    expect(await store.repos.drafts.get(draft.id)).toEqual(draft);
    // Any other start (Empty workout, Repeat) discards it in the same transaction.
    expect(await store.repos.sessions.save(startedFrom(null, 'empty'), null)).toMatchObject({ ok: true });
    expect(await store.repos.drafts.get(draft.id)).toMatchObject({ status: 'discarded' });
    await store.close();
  });

  it('skippedBy and todayEdits round-trip on the session rows', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const a = startedFrom(null, 'rt');
    const bench = a.exercises.find((e) => e.exerciseId === BENCH);
    const skipped: SessionAggregate = {
      ...a,
      session: { ...a.session, todayEdits: { draftId: id(5000), draftVersion: 1, swapped: [{ sessionExerciseId: bench?.id ?? '', slotKey: SLOT_BENCH, fromExerciseId: BENCH, fromExerciseName: 'Bench press' }], skipped: [], reordered: true } },
      sets: a.sets.map((s) => (s.sessionExerciseId === bench?.id ? { ...s, status: 'skipped' as const, skippedBy: 'before_start' as const } : s)),
    };
    // No draft row: a session naming one that doesn't exist is refused.
    expect(await store.repos.sessions.save(skipped, null)).toEqual({ ok: false, error: 'stale_inputs' });
    const session = { ...skipped.session };
    delete session.todayEdits;
    const plain = { ...skipped, session };
    expect(await store.repos.sessions.save(plain, null)).toMatchObject({ ok: true });
    const back = await store.repos.sessions.get(a.session.id);
    expect(back?.sets.filter((s) => s.skippedBy === 'before_start')).toHaveLength(4);
    expect(back).toEqual(plain);
    // The reducer still logs the rest; Add set brings the skipped exercise back.
    if (!back) throw new Error('not saved');
    const r = reduceSession(back, { type: 'add_set', at: at(120), opId: 'add-1', sessionExerciseId: bench?.id ?? '', newSetId: id(8888), setType: null });
    expect(r.ok).toBe(true);
    await store.close();
  });
});

function updateAction(opId: string, before: Routine['exercises'][number], after: Routine['exercises'][number], draft: { id: string; editId: string } | null): ActionRecord {
  return ActionRecordSchema.parse({
    actionId: id(6000 + opId.length),
    turnId: null,
    opId,
    status: 'committed',
    author: 'ben',
    detail: { kind: 'update_routine', routineId: ROUTINE, routineName: 'Push A', changes: [{ change: 'swap', text: 'Bench press → DB bench press' }], slot: { before, after }, versionBefore: 1, versionAfter: 2, draft },
    failure: null,
    reason: null,
    evidenceRefs: [],
    guardNotes: [],
    entityVersions: [{ entity: 'routine', id: ROUTINE, before: 1, after: 2 }],
    undoneBy: null,
    createdAt: at(30),
  });
}

describe('Change Push A too ›: Apply and Undo (TE4, TE-A9)', () => {
  it('Apply: routine v2, one ben record, the swap edit redundant, in one transaction; Undo puts both back; replays are no-ops', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const draft = change(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: id(805) } }, 'op-1');
    await store.repos.drafts.save(draft, null);
    const editId = draft.edits[0]?.editId ?? '';
    const r1 = routine();
    const before = r1.exercises[0];
    if (!before) throw new Error('no slot');
    const after = { ...before, exerciseId: id(805), equipmentId: null, setTemplates: before.setTemplates.map((t) => ({ ...t, targetLoad: null })) };
    const r2: Routine = { ...r1, version: 2, updatedAtUtc: at(30).utc, lastOpId: 'apply-1', exercises: r1.exercises.map((x, i) => (i === 0 ? after : x)) };
    const action = updateAction('apply-1', before, after, { id: draft.id, editId });

    const applied = await store.repos.drafts.applyRoutineChange({ ownerId: OWNER, routine: r2, expectedRoutineVersion: 1, action, at: at(30) });
    expect(applied).toMatchObject({ status: 'written', routine: { version: 2 } });
    expect((await store.repos.routines.get(ROUTINE))?.exercises[0]?.exerciseId).toBe(id(805));
    const d2 = await store.repos.drafts.get(draft.id);
    expect(d2?.edits[0]?.removed?.why).toBe('redundant');
    expect(await store.repos.coach.getAction(action.actionId)).toMatchObject({ author: 'ben', detail: { kind: 'update_routine' } });
    expect(await store.repos.drafts.applyRoutineChange({ ownerId: OWNER, routine: r2, expectedRoutineVersion: 1, action, at: at(30) })).toMatchObject({ status: 'replayed' });
    // A card shown before the routine moved is out of date: nothing is written.
    expect(await store.repos.drafts.applyRoutineChange({ ownerId: OWNER, routine: { ...r2, version: 2 }, expectedRoutineVersion: 1, action: updateAction('apply-again', before, after, null), at: at(31) })).toMatchObject({ status: 'stale' });

    const undo = ActionRecordSchema.parse({ ...action, actionId: id(6100), opId: 'undo-1', detail: { kind: 'undo', undoneActionId: action.actionId, what: 'the change to Push A', restored: [], alreadyLogged: [] }, createdAt: at(40) });
    const undone = await store.repos.drafts.undoRoutineChange({ ownerId: OWNER, undo, at: at(40), newRoutineAtUtc: at(40).utc });
    expect(undone).toMatchObject({ status: 'written', routine: { version: 3 } });
    const r3 = await store.repos.routines.get(ROUTINE);
    expect(r3?.exercises[0]).toEqual(before);
    const d3 = await store.repos.drafts.get(draft.id);
    expect(d3?.edits.filter((e) => e.removed === null)).toMatchObject([{ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: id(805) }]);
    expect((await store.repos.coach.getAction(action.actionId))?.undoneBy?.actionId).toBe(undo.actionId);
    expect(await store.repos.drafts.undoRoutineChange({ ownerId: OWNER, undo, at: at(40), newRoutineAtUtc: at(40).utc })).toMatchObject({ status: 'replayed' });
    expect((await checkIntegrity(store.db)).ok).toBe(true);
    await store.close();
  });

  it('Undo after the routine changed elsewhere is refused and changes nothing', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const r1 = routine();
    const before = r1.exercises[0];
    if (!before) throw new Error('no slot');
    const after = { ...before, exerciseId: id(805), equipmentId: null };
    const action = updateAction('apply-2', before, after, null);
    await store.repos.drafts.applyRoutineChange({ ownerId: OWNER, routine: { ...r1, version: 2, exercises: r1.exercises.map((x, i) => (i === 0 ? after : x)) }, expectedRoutineVersion: 1, action, at: at(30) });
    const renamed = await store.repos.routines.get(ROUTINE);
    if (!renamed) throw new Error('no routine');
    await store.repos.routines.save({ ...renamed, name: 'Push B', version: 3 }, 2);
    const undo = ActionRecordSchema.parse({ ...action, actionId: id(6101), opId: 'undo-2', detail: { kind: 'undo', undoneActionId: action.actionId, what: 'the change to Push A', restored: [], alreadyLogged: [] } });
    expect(await store.repos.drafts.undoRoutineChange({ ownerId: OWNER, undo, at: at(40), newRoutineAtUtc: at(40).utc })).toEqual({ status: 'not_possible', reason: 'changed_since' });
    expect((await store.repos.routines.get(ROUTINE))?.version).toBe(3);
    expect(await store.repos.coach.getAction(undo.actionId)).toBeNull();
    await store.close();
  });
});

describe('backup and restore with drafts (TE-A17)', () => {
  it('drafts are in the backup; an open one restores as discarded; the rest exactly', async () => {
    const src = await managerIn();
    await seeded(src.store);
    const open = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(903) } }, 'op-1');
    await src.store.repos.drafts.save(open, null);
    const expired = (await src.store.repos.drafts.expire(OWNER, open.expiresAtUtc))[0];
    const again = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(902) } }, 'op-2', { utc: open.expiresAtUtc, tz: open.tz }, BASIS, id(5009));
    await src.store.repos.drafts.save(again, null);
    const made = await createBackup(src.store, { at: at(100), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: null } });
    expect((JSON.parse(made.text) as { tables: Record<string, unknown[]> }).tables.pre_start_drafts).toHaveLength(2);
    await src.close();

    const dst = await managerIn();
    expect(await dst.restore(made.text, at(200))).toMatchObject({ ok: true, status: 'restored' });
    expect(await dst.store.repos.drafts.get(expired?.id ?? '')).toEqual(expired);
    expect(await dst.store.repos.drafts.get(again.id)).toMatchObject({ status: 'discarded', version: again.version + 1, edits: again.edits });
    expect(await dst.store.repos.drafts.open(OWNER, BASIS)).toBeNull();
    expect((await checkIntegrity(dst.store.db)).ok).toBe(true);
    await dst.close();
  });
});

async function copyIntoSchema6(from: SqlDriver, to: SqlDriver): Promise<void> {
  await migrate(to, MIGRATIONS, 6);
  const tables = await from.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  await to.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) {
    const cols = new Set((await to.getAll<{ name: string }>(`PRAGMA table_info(${name})`)).map((c) => c.name));
    if (cols.size === 0) continue;
    for (const row of await from.getAll(`SELECT * FROM ${name}`)) {
      const keys = Object.keys(row).filter((k) => cols.has(k));
      await to.run(`INSERT OR IGNORE INTO ${name} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => row[k] as SqlValue));
    }
  }
  await to.exec('PRAGMA foreign_keys = ON');
}

describe('a populated schema-6 database migrates in place to 7', () => {
  it('keeps workouts and coach actions, adds the drafts table and columns, and takes an update_routine record', async () => {
    const source = memoryDriver();
    const made = await openStore(source);
    await seeded(made);
    const a = startedFrom(null, 'v6');
    await made.repos.sessions.save(a, null);
    const coachRecord = ActionRecordSchema.parse({
      actionId: id(6200),
      turnId: null,
      opId: 'mem-1',
      status: 'committed',
      author: 'coach',
      detail: { kind: 'save_memory', memoryId: id(6201), text: 'Trains before work' },
      failure: null,
      reason: null,
      evidenceRefs: [],
      guardNotes: [],
      entityVersions: [],
      undoneBy: null,
      createdAt: at(5),
    });
    await made.db.write((tx) =>
      tx.run('INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?)', [
        coachRecord.actionId,
        OWNER,
        coachRecord.opId,
        'save_memory',
        'committed',
        coachRecord.createdAt.utc,
        coachRecord.createdAt.utc,
        JSON.stringify(coachRecord),
      ]),
    );

    const phone = memoryDriver();
    await copyIntoSchema6(source, phone);
    await made.close();
    expect(await phone.getFirst('PRAGMA user_version')).toEqual({ user_version: 6 });
    // At 6 the old CHECK refuses the new kind.
    await expect(phone.run("INSERT INTO coach_actions (id, owner_id, op_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES ('x', 'o', 'p', 'update_routine', 'committed', 1, 't', 't', '{}')")).rejects.toThrow();

    const v7 = await openStore(phone);
    expect(v7.migration.from).toBe(6);
    // 7, then any later migration (8: deleted workouts).
    expect(v7.migration.applied[0]).toBe(7);
    expect(await v7.repos.sessions.get(a.session.id)).toEqual(a);
    expect(await v7.repos.coach.getAction(coachRecord.actionId)).toEqual(coachRecord);
    expect(await v7.repos.drafts.listByOwner(OWNER)).toEqual([]);
    const draft = change(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: id(805) } }, 'op-1');
    await v7.repos.drafts.save(draft, null);
    const r1 = routine();
    const before = r1.exercises[0];
    if (!before) throw new Error('no slot');
    const after = { ...before, exerciseId: id(805), equipmentId: null };
    const applied = await v7.repos.drafts.applyRoutineChange({ ownerId: OWNER, routine: { ...r1, version: 2, exercises: r1.exercises.map((x, i) => (i === 0 ? after : x)) }, expectedRoutineVersion: 1, action: updateAction('apply-v7', before, after, { id: draft.id, editId: draft.edits[0]?.editId ?? '' }), at: at(30) });
    expect(applied.status).toBe('written');
    // Coach actions are still never deleted.
    await expect(v7.db.write((tx) => tx.run('DELETE FROM coach_actions'))).rejects.toThrow(/never deleted/);
    expect((await checkIntegrity(v7.db)).ok).toBe(true);
    await v7.close();
  });
});

describe('review fixes: the template Undo keeps a newer swap (S4), rollback discards drafts (N4), a v6 backup with coach actions (S6)', () => {
  it('Undo of the template change leaves a newer today-swap on that slot as it is', async () => {
    const store = await openStore(memoryDriver());
    await seeded(store);
    const draft = change(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: id(805) } }, 'op-1');
    await store.repos.drafts.save(draft, null);
    const r1 = routine();
    const before = r1.exercises[0];
    if (!before) throw new Error('no slot');
    const after = { ...before, exerciseId: id(805), equipmentId: null };
    const action = updateAction('apply-s4', before, after, { id: draft.id, editId: draft.edits[0]?.editId ?? '' });
    expect((await store.repos.drafts.applyRoutineChange({ ownerId: OWNER, routine: { ...r1, version: 2, exercises: r1.exercises.map((x, i) => (i === 0 ? after : x)) }, expectedRoutineVersion: 1, action, at: at(30) })).status).toBe('written');
    // Then Ben swaps that slot to something else for today.
    const d2 = await store.repos.drafts.get(draft.id);
    if (!d2) throw new Error('no draft');
    const d3 = change(d2, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: id(806) } }, 'op-2', at(35));
    expect((await store.repos.drafts.save(d3, d2.version)).ok).toBe(true);
    const undo = ActionRecordSchema.parse({ ...action, actionId: id(6300), opId: 'undo-s4', detail: { kind: 'undo', undoneActionId: action.actionId, what: 'the change to Push A', restored: [], alreadyLogged: [] }, createdAt: at(40) });
    const undone = await store.repos.drafts.undoRoutineChange({ ownerId: OWNER, undo, at: at(40), newRoutineAtUtc: at(40).utc });
    expect(undone).toMatchObject({ status: 'written', routine: { version: 3 } });
    expect((await store.repos.routines.get(ROUTINE))?.exercises[0]).toEqual(before);
    // The draft is untouched: today's machine pick stays.
    const d4 = await store.repos.drafts.get(draft.id);
    expect(d4?.version).toBe(d3.version);
    expect(d4?.edits.filter((e) => e.removed === null)).toMatchObject([{ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: id(806) }]);
    await store.close();
  });

  it('a rollback never brings back an open draft', async () => {
    const m = await managerIn();
    await seeded(m.store);
    const open = change(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(903) } }, 'op-1');
    await m.store.repos.drafts.save(open, null);
    const made = await createBackup(m.store, { at: at(100), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: null } });
    // Change something so the restore isn't identical; the draft stays open in the old database.
    await m.store.repos.routines.save({ ...routine(), name: 'Push B', version: 2 }, 1);
    expect(await m.restore(made.text, at(200))).toMatchObject({ ok: true, status: 'restored' });
    expect(await m.store.repos.drafts.open(OWNER, BASIS)).toBeNull();
    expect(await m.rollback(at(300))).toMatchObject({ ok: true });
    expect((await m.store.repos.routines.get(ROUTINE))?.name).toBe('Push B');
    expect(await m.store.repos.drafts.get(open.id)).toMatchObject({ status: 'discarded', version: open.version + 1, updatedAtUtc: at(300).utc });
    expect((await checkIntegrity(m.store.db)).ok).toBe(true);
    await m.close();
  });

  it('a schema-6 backup with coach actions restores through migration 7 (the coach_actions rebuild)', async () => {
    const src = await managerIn();
    await seeded(src.store);
    const a = startedFrom(null, 'v6-backup');
    await src.store.repos.sessions.save(a, null);
    const coachRecord = ActionRecordSchema.parse({
      actionId: id(6400),
      turnId: null,
      opId: 'mem-b',
      status: 'committed',
      author: 'coach',
      detail: { kind: 'save_memory', memoryId: id(6401), text: 'Trains before work' },
      failure: null,
      reason: null,
      evidenceRefs: [],
      guardNotes: [],
      entityVersions: [],
      undoneBy: null,
      createdAt: at(5),
    });
    await src.store.db.write((tx) =>
      tx.run('INSERT INTO coach_actions (id, owner_id, op_id, turn_id, session_id, kind, status, version, created_at_utc, updated_at_utc, data) VALUES (?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?, ?)', [
        coachRecord.actionId,
        OWNER,
        coachRecord.opId,
        'save_memory',
        'committed',
        coachRecord.createdAt.utc,
        coachRecord.createdAt.utc,
        JSON.stringify(coachRecord),
      ]),
    );
    const made = await createBackup(src.store, { at: at(100), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: null } });
    await src.close();
    // As build 6 wrote it: no drafts table, no today_edits / skipped_by columns.
    const file = JSON.parse(made.text) as BackupFile;
    const tables = { ...file.tables };
    Reflect.deleteProperty(tables, 'pre_start_drafts');
    // …nor schema 8 (deleted workouts).
    Reflect.deleteProperty(tables, 'purged_sessions');
    tables.sessions = (tables.sessions ?? []).map((row) => {
      const copy = { ...row };
      delete copy.today_edits;
      for (const c of ['deleted_at_utc', 'deleted_at_tz', 'deleted_by_op_id', 'purge_after_utc']) Reflect.deleteProperty(copy, c);
      return copy;
    });
    tables.session_sets = (tables.session_sets ?? []).map((row) => {
      const copy = { ...row };
      delete copy.skipped_by;
      return copy;
    });
    expect(tables.coach_actions).toHaveLength(1);
    const counts = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));
    const body: Partial<BackupFile> = { ...file, schemaVersion: 6, tables, counts };
    delete body.checksum;
    const v6 = JSON.stringify({ ...body, checksum: { algorithm: 'sha-256', value: sha256Hex(stableStringify(body)) } });

    const dst = await managerIn();
    expect(await dst.restore(v6, at(200))).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true } });
    expect(await dst.store.db.read((q) => readUserVersion(q))).toBe(latestVersion());
    expect(await dst.store.repos.sessions.get(a.session.id)).toEqual(a);
    expect(await dst.store.repos.coach.getAction(coachRecord.actionId)).toEqual(coachRecord);
    expect(await dst.store.repos.drafts.listByOwner(OWNER)).toEqual([]);
    // The rebuilt table takes the new kind and still refuses deletes.
    const r1 = routine();
    const before = r1.exercises[0];
    if (!before) throw new Error('no slot');
    const after = { ...before, exerciseId: id(805), equipmentId: null };
    const applied = await dst.store.repos.drafts.applyRoutineChange({ ownerId: OWNER, routine: { ...r1, version: 2, exercises: r1.exercises.map((x, i) => (i === 0 ? after : x)) }, expectedRoutineVersion: 1, action: updateAction('apply-b', before, after, null), at: at(210) });
    expect(applied.status).toBe('written');
    await expect(dst.store.db.write((tx) => tx.run('DELETE FROM coach_actions'))).rejects.toThrow(/never deleted/);
    expect((await checkIntegrity(dst.store.db)).ok).toBe(true);
    await dst.close();
  });
});

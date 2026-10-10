import { afterEach, describe, expect, it } from 'vitest';
import { newPainFlag, stableStringify } from '@fizz/domain';
import { at, id, OWNER, profile } from '@fizz/domain/testing';
import {
  ActionRecordSchema,
  type ActionDetail,
  type ActionRecord,
  type CoachMessage,
  type CoachThread,
  type CoachTurn,
  type Memory,
  type PlaybookCandidate,
} from '@fizz/schemas';
import {
  checkIntegrity,
  createBackup,
  DatabaseManager,
  exportTables,
  latestVersion,
  openStore,
  sha256Hex,
  type BackupFile,
  type Store,
} from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { failingDriver, memoryDriver, tempDir } from './helpers';

const THREAD = id(900);
const TURN = id(901);
const SQUAT = id(50);

let seq = 1000;
function action(detail: ActionDetail, over: Partial<ActionRecord> = {}): ActionRecord {
  seq += 1;
  return ActionRecordSchema.parse({
    actionId: id(seq),
    turnId: TURN,
    opId: `${TURN}:tool:${String(seq)}`,
    status: 'committed',
    author: 'coach',
    detail,
    failure: null,
    reason: null,
    evidenceRefs: [],
    guardNotes: [],
    entityVersions: [],
    undoneBy: null,
    createdAt: at(seq),
    ...over,
  });
}

function thread(): CoachThread {
  return { id: THREAD, ownerId: OWNER, version: 1, createdAtUtc: at(0).utc, updatedAtUtc: at(0).utc, sessionId: null, title: 'Drop the last two' };
}

function turn(over: Partial<CoachTurn> = {}): CoachTurn {
  return {
    id: TURN,
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(0).utc,
    updatedAtUtc: at(0).utc,
    threadId: THREAD,
    kind: 'general',
    status: 'running',
    error: null,
    model: 'gpt-6.1-sol',
    contextHash: 'ctx-1',
    startedAt: at(0),
    endedAtUtc: null,
    toolLog: [],
    ...over,
  };
}

function benMessage(text = 'Remember that I train before work'): Omit<CoachMessage, 'ordinal'> {
  return { id: id(902), ownerId: OWNER, threadId: THREAD, turnId: TURN, createdAt: at(0), body: { role: 'ben', input: { kind: 'words', text, spoken: false } } };
}

function memory(n: number, text: string, actionId: string, key = `memory:${text}`): Memory {
  return { id: id(n), ownerId: OWNER, version: 1, createdAtUtc: at(1).utc, updatedAtUtc: at(1).utc, text, contentKey: key, status: 'active', quote: text, createdByActionId: actionId };
}

function candidate(n: number, text: string, actionId: string): PlaybookCandidate {
  return { id: id(n), version: 1, createdAtUtc: at(1).utc, updatedAtUtc: at(1).utc, text, contentKey: `playbook:${text}`, statedBy: 'ben', status: 'to_review', createdByActionId: actionId };
}

function undoOf(target: ActionRecord, over: Partial<ActionRecord> = {}): ActionRecord {
  return action({ kind: 'undo', undoneActionId: target.actionId, what: 'the memory', restored: [], alreadyLogged: [] }, { author: 'ben', turnId: null, ...over });
}

let stores: Store[] = [];
async function store(): Promise<Store> {
  const s = await openStore(memoryDriver());
  stores.push(s);
  return s;
}
let dirs: { dir: string; cleanup: () => void }[] = [];
afterEach(async () => {
  for (const s of stores) await s.close().catch(() => undefined);
  stores = [];
  for (const d of dirs) d.cleanup();
  dirs = [];
});

describe('coach turns and messages (ADR 0019 C3)', () => {
  it("saves Ben's message with the turn before any request; a repeated start changes nothing", async () => {
    const s = await store();
    const first = await s.repos.coach.startTurn({ thread: thread(), newThread: true, turn: turn(), benMessage: benMessage() });
    expect(first).toMatchObject({ replayed: false, benMessage: { ordinal: 0 } });
    const again = await s.repos.coach.startTurn({ thread: thread(), newThread: true, turn: turn(), benMessage: benMessage() });
    expect(again.replayed).toBe(true);
    expect(await s.repos.coach.listMessages(THREAD)).toHaveLength(1);
    const reply = await s.repos.coach.appendMessage({
      id: id(903),
      ownerId: OWNER,
      threadId: THREAD,
      turnId: TURN,
      createdAt: at(2),
      body: { role: 'coach', items: [{ kind: 'sentence', text: 'Got it.' }], actionIds: [], note: null, offer: null, hiddenLines: [], complete: true },
    });
    expect(reply.ordinal).toBe(1);
    expect((await s.repos.coach.listThreads(OWNER)).map((t) => t.id)).toEqual([THREAD]);
  });

  it('messages are append-only at the database level', async () => {
    const s = await store();
    await s.repos.coach.startTurn({ thread: thread(), newThread: true, turn: turn(), benMessage: benMessage() });
    await expect(s.db.write((tx) => tx.run('DELETE FROM coach_messages'))).rejects.toThrow(/append-only/);
    await expect(s.db.write((tx) => tx.run("UPDATE coach_messages SET data = '{}'"))).rejects.toThrow(/append-only/);
    await expect(s.db.write((tx) => tx.run('DELETE FROM coach_threads'))).rejects.toThrow(/never deleted/);
  });

  it('restart recovery: a running turn becomes interrupted; its committed action is still there, once', async () => {
    const s = await store();
    await s.repos.coach.startTurn({ thread: thread(), newThread: true, turn: turn(), benMessage: benMessage() });
    const a = action({ kind: 'save_memory', memoryId: id(1), text: 'Trains before work' });
    await s.repos.coach.commit(OWNER, { kind: 'save_memory', action: a, memory: memory(1, 'Trains before work', a.actionId) });
    // The app is killed here: no reply, no finishTurn.
    const recovered = await s.repos.coach.recoverInterruptedTurns(OWNER, at(60).utc);
    expect(recovered.map((t) => [t.id, t.status])).toEqual([[TURN, 'interrupted']]);
    expect(await s.repos.coach.recoverInterruptedTurns(OWNER, at(61).utc)).toEqual([]);
    expect((await s.repos.coach.listTurnActions(TURN)).map((r) => r.actionId)).toEqual([a.actionId]);
    // A late finish can't reopen it.
    expect((await s.repos.coach.updateTurn(TURN, { status: 'completed', error: null, endedAtUtc: at(62).utc, toolLog: [] }, at(62).utc)).status).toBe('interrupted');
  });
});

describe('coach writes: record and change in one transaction, idempotent (rule 5)', () => {
  it('a replayed opId returns the saved record and writes nothing twice (contract check 6)', async () => {
    const s = await store();
    const a = action({ kind: 'save_memory', memoryId: id(1), text: 'Trains before work' });
    const write = { kind: 'save_memory' as const, action: a, memory: memory(1, 'Trains before work', a.actionId) };
    expect(await s.repos.coach.commit(OWNER, write)).toEqual({ status: 'written', action: a });
    expect(await s.repos.coach.commit(OWNER, write)).toEqual({ status: 'replayed', action: a });
    // Same content from a new turn (Try again): the live memory and its record, not a second copy.
    const b = action({ kind: 'save_memory', memoryId: id(2), text: 'Trains before work' }, { turnId: id(905), opId: 'other-turn:save_memory:x' });
    expect(await s.repos.coach.commit(OWNER, { kind: 'save_memory', action: b, memory: memory(2, 'Trains before work', b.actionId) })).toEqual({ status: 'replayed', action: a });
    expect(await s.repos.coach.listMemories(OWNER)).toHaveLength(1);
    expect(await s.repos.coach.findActionByOpId(OWNER, b.opId)).toBeNull();
  });

  it('forgetting checks the memory version; a stale call writes nothing', async () => {
    const s = await store();
    const a = action({ kind: 'save_memory', memoryId: id(1), text: 'Hates lunges' });
    await s.repos.coach.commit(OWNER, { kind: 'save_memory', action: a, memory: memory(1, 'Hates lunges', a.actionId) });
    const stale = action({ kind: 'forget_memory', memoryId: id(1), text: 'Hates lunges' });
    expect(await s.repos.coach.commit(OWNER, { kind: 'forget_memory', action: stale, memoryId: id(1), expectedVersion: 7, atUtc: at(5).utc })).toEqual({ status: 'conflict', reason: 'stale_version' });
    expect(await s.repos.coach.getAction(stale.actionId)).toBeNull();
    const ok = action({ kind: 'forget_memory', memoryId: id(1), text: 'Hates lunges' });
    expect((await s.repos.coach.commit(OWNER, { kind: 'forget_memory', action: ok, memoryId: id(1), expectedVersion: 1, atUtc: at(5).utc })).status).toBe('written');
    expect(await s.repos.coach.getMemory(id(1))).toMatchObject({ status: 'forgotten', version: 2 });
    const missing = action({ kind: 'forget_memory', memoryId: id(77), text: 'x' });
    expect(await s.repos.coach.commit(OWNER, { kind: 'forget_memory', action: missing, memoryId: id(77), expectedVersion: 1, atUtc: at(5).utc })).toEqual({ status: 'conflict', reason: 'missing' });
  });

  it('pain flags: one per exercise; an exercise already flagged is never flagged twice (rule 9)', async () => {
    const s = await store();
    const flag = (n: number, exerciseId: string) =>
      newPainFlag({ id: id(n), ownerId: OWNER, opId: `op-${String(n)}`, exerciseId, exerciseName: 'Back squat', area: 'knee', source: 'coach', checkInId: null, at: at(3) });
    const a = action({ kind: 'set_pain_flag', flagIds: [id(10)], exerciseNames: ['Back squat'], area: 'knee' });
    expect((await s.repos.coach.commit(OWNER, { kind: 'pain_flags', action: a, flags: [flag(10, SQUAT)] })).status).toBe('written');
    const b = action({ kind: 'set_pain_flag', flagIds: [id(11)], exerciseNames: ['Back squat'], area: 'knee' });
    expect(await s.repos.coach.commit(OWNER, { kind: 'pain_flags', action: b, flags: [flag(11, SQUAT)] })).toEqual({ status: 'conflict', reason: 'already_exists' });
    expect(await s.repos.painFlags.listActive(OWNER)).toHaveLength(1);
  });

  it('proposals and refused calls are records with no other change', async () => {
    const s = await store();
    const p = action(
      { kind: 'propose_next_workout_change', sourceSessionId: id(60), workoutLabel: 'Push A', changes: [{ change: 'swap', text: 'Cable fly → Pec deck' }], because: 'you asked for variety.' },
      { status: 'proposed' },
    );
    expect((await s.repos.coach.commit(OWNER, { kind: 'record', action: p })).status).toBe('written');
    expect((await s.repos.coach.listRecentActions(OWNER, { sessionId: id(60), limit: 5 })).map((r) => r.actionId)).toEqual([p.actionId]);
  });

  it('a crash while writing the record leaves neither the change nor the record (kill mid-write)', async () => {
    const driver = failingDriver(memoryDriver(), (sql) => sql.includes('INSERT INTO "coach_actions"'));
    driver.armed = false;
    const s = await openStore(driver);
    stores.push(s);
    driver.armed = true;
    const a = action({ kind: 'save_memory', memoryId: id(1), text: 'Trains before work' });
    await expect(s.repos.coach.commit(OWNER, { kind: 'save_memory', action: a, memory: memory(1, 'Trains before work', a.actionId) })).rejects.toThrow(/Injected failure/);
    expect(await s.repos.coach.listMemories(OWNER, 'all')).toEqual([]);
    expect(await s.repos.coach.getAction(a.actionId)).toBeNull();
    driver.armed = false;
    expect((await s.repos.coach.commit(OWNER, { kind: 'save_memory', action: a, memory: memory(1, 'Trains before work', a.actionId) })).status).toBe('written');
  });

  it('playbook candidates are Coaching knowledge: no owner column, one open copy per text', async () => {
    const s = await store();
    const a = action({ kind: 'add_playbook_candidate', candidateId: id(20), text: 'Deload every 6 weeks' });
    await s.repos.coach.commit(OWNER, { kind: 'playbook_candidate', action: a, candidate: candidate(20, 'Deload every 6 weeks', a.actionId) });
    const cols = await s.db.read((q) => q.getAll<{ name: string }>('PRAGMA table_info(playbook_candidates)'));
    expect(cols.map((c) => c.name)).not.toContain('owner_id');
    const b = action({ kind: 'add_playbook_candidate', candidateId: id(21), text: 'Deload every 6 weeks' }, { opId: 'again' });
    expect(await s.repos.coach.commit(OWNER, { kind: 'playbook_candidate', action: b, candidate: candidate(21, 'Deload every 6 weeks', b.actionId) })).toEqual({ status: 'replayed', action: a });
    expect(await s.repos.coach.listPlaybookCandidates()).toHaveLength(1);
  });
});

describe('Undo (an action of its own, written with the reversal)', () => {
  it('undoes a memory, a pain flag and a playbook candidate; a repeat is a replay; a second undo is refused', async () => {
    const s = await store();
    const m = action({ kind: 'save_memory', memoryId: id(1), text: 'Trains before work' });
    await s.repos.coach.commit(OWNER, { kind: 'save_memory', action: m, memory: memory(1, 'Trains before work', m.actionId) });
    const u = undoOf(m);
    const r = await s.repos.coach.undo(OWNER, u);
    expect(r).toMatchObject({ status: 'written', target: { undoneBy: { actionId: u.actionId } } });
    expect(await s.repos.coach.getMemory(id(1))).toMatchObject({ status: 'forgotten' });
    expect((await s.repos.coach.undo(OWNER, u)).status).toBe('replayed');
    expect(await s.repos.coach.undo(OWNER, undoOf(m))).toEqual({ status: 'not_possible', reason: 'already_undone' });

    const f = action({ kind: 'set_pain_flag', flagIds: [id(10)], exerciseNames: ['Back squat'], area: 'knee' });
    await s.repos.coach.commit(OWNER, {
      kind: 'pain_flags',
      action: f,
      flags: [newPainFlag({ id: id(10), ownerId: OWNER, opId: 'p', exerciseId: SQUAT, exerciseName: 'Back squat', area: 'knee', source: 'coach', checkInId: null, at: at(3) })],
    });
    expect((await s.repos.coach.undo(OWNER, undoOf(f))).status).toBe('written');
    expect(await s.repos.painFlags.listActive(OWNER)).toEqual([]);

    const c = action({ kind: 'add_playbook_candidate', candidateId: id(20), text: 'Deload every 6 weeks' });
    await s.repos.coach.commit(OWNER, { kind: 'playbook_candidate', action: c, candidate: candidate(20, 'Deload every 6 weeks', c.actionId) });
    expect((await s.repos.coach.undo(OWNER, undoOf(c))).status).toBe('written');
    expect((await s.repos.coach.listPlaybookCandidates())[0]?.status).toBe('withdrawn');
  });

  it('undoing a forget brings the memory back unless the same memory was saved again since', async () => {
    const s = await store();
    const m = action({ kind: 'save_memory', memoryId: id(1), text: 'Hates lunges' });
    await s.repos.coach.commit(OWNER, { kind: 'save_memory', action: m, memory: memory(1, 'Hates lunges', m.actionId) });
    const f = action({ kind: 'forget_memory', memoryId: id(1), text: 'Hates lunges' });
    await s.repos.coach.commit(OWNER, { kind: 'forget_memory', action: f, memoryId: id(1), expectedVersion: 1, atUtc: at(5).utc });
    const again = action({ kind: 'save_memory', memoryId: id(2), text: 'Hates lunges' });
    await s.repos.coach.commit(OWNER, { kind: 'save_memory', action: again, memory: memory(2, 'Hates lunges', again.actionId) });
    expect(await s.repos.coach.undo(OWNER, undoOf(f))).toEqual({ status: 'not_possible', reason: 'changed_since' });
    expect((await s.repos.coach.getAction(f.actionId))?.undoneBy).toBeNull();
  });

  it("a proposal can't be undone (it was never applied); an adjustment whose workout is gone reads as changed since", async () => {
    const s = await store();
    const p = action(
      { kind: 'propose_next_workout_change', sourceSessionId: id(60), workoutLabel: 'Push A', changes: [{ change: 'swap', text: 'Cable fly → Pec deck' }], because: 'variety.' },
      { status: 'proposed' },
    );
    await s.repos.coach.commit(OWNER, { kind: 'record', action: p });
    expect(await s.repos.coach.undo(OWNER, undoOf(p))).toEqual({ status: 'not_possible', reason: 'not_committed' });
    const adj = action({ kind: 'adjust_pending_sets', sessionId: id(60), exercises: [] });
    await s.repos.coach.commit(OWNER, { kind: 'record', action: adj });
    expect(await s.repos.coach.undo(OWNER, undoOf(adj))).toEqual({ status: 'not_possible', reason: 'changed_since' });
  });
});

describe('integrity, backup and restore with coach data', () => {
  async function fill(s: Store) {
    await s.repos.profiles.save(profile(), null);
    await s.repos.coach.startTurn({ thread: thread(), newThread: true, turn: turn(), benMessage: benMessage() });
    const a = action({ kind: 'save_memory', memoryId: id(1), text: 'Trains before work' });
    await s.repos.coach.commit(OWNER, { kind: 'save_memory', action: a, memory: memory(1, 'Trains before work', a.actionId) });
    const c = action({ kind: 'add_playbook_candidate', candidateId: id(20), text: 'Deload every 6 weeks' });
    await s.repos.coach.commit(OWNER, { kind: 'playbook_candidate', action: c, candidate: candidate(20, 'Deload every 6 weeks', c.actionId) });
    await s.repos.coach.updateTurn(TURN, { status: 'completed', error: null, endedAtUtc: at(9).utc, toolLog: [{ tool: 'save_memory', outcome: 'committed', text: 'Saved to memory', actionId: a.actionId }] }, at(9).utc);
  }

  it('the integrity check reads every coach row and catches a column that disagrees with its record', async () => {
    const s = await store();
    await fill(s);
    const report = await checkIntegrity(s.db);
    expect(report.ok).toBe(true);
    expect(report.checked).toMatchObject({ coach_threads: 1, coach_turns: 1, coach_messages: 1, coach_actions: 2, memories: 1, playbook_candidates: 1 });
    await s.db.write((tx) => tx.run("UPDATE coach_actions SET status = 'failed' WHERE kind = 'save_memory'"));
    expect((await checkIntegrity(s.db)).issues.map((i) => i.table)).toContain('coach_actions');
  });

  function managerIn(): Promise<DatabaseManager> {
    const d = tempDir();
    dirs.push(d);
    let n = 0;
    return DatabaseManager.open({ host: nodeDatabaseHost(d.dir), newName: () => `t-${String((n += 1))}.db` });
  }

  it('a backup round trip carries coach data exactly', async () => {
    const src = await managerIn();
    await fill(src.store);
    const made = await createBackup(src.store, { at: at(100), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: null } });
    const before = await src.store.db.read((q) => exportTables(q));
    await src.close();
    const dst = await managerIn();
    expect(await dst.restore(made.text, at(200))).toMatchObject({ ok: true, status: 'restored' });
    expect(await dst.store.db.read((q) => exportTables(q))).toEqual(before);
    expect(await dst.store.repos.coach.listMemories(OWNER)).toHaveLength(1);
    await dst.close();
  });

  it('a backup from before the coach (schema 3) restores with empty coach tables', async () => {
    const src = await managerIn();
    await src.store.repos.profiles.save(profile(), null);
    const made = await createBackup(src.store, { at: at(100), app: { name: 'PROJECT-FIZZ', version: '0.1.0', build: null } });
    await src.close();
    const file = JSON.parse(made.text) as BackupFile;
    const tables = { ...file.tables };
    for (const t of ['coach_threads', 'coach_turns', 'coach_messages', 'coach_actions', 'memories', 'playbook_candidates', 'next_session_targets']) Reflect.deleteProperty(tables, t);
    const counts = Object.fromEntries(Object.entries(tables).map(([t, rows]) => [t, rows.length]));
    const body: Omit<BackupFile, 'checksum'> = { ...file, schemaVersion: 3, tables, counts };
    Reflect.deleteProperty(body, 'checksum');
    const v3 = JSON.stringify({ ...body, checksum: { algorithm: 'sha-256', value: sha256Hex(stableStringify(body)) } });
    const dst = await managerIn();
    expect(await dst.restore(v3, at(200))).toMatchObject({ ok: true, status: 'restored', preview: { needsMigration: true } });
    expect(await dst.store.db.read((q) => q.getFirst<{ n: number }>('SELECT count(*) AS n FROM coach_actions'))).toEqual({ n: 0 });
    expect(await dst.store.repos.coach.listThreads(OWNER)).toEqual([]);
    expect(latestVersion()).toBeGreaterThanOrEqual(4);
    await dst.close();
  });
});

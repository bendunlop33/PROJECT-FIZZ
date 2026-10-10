import {
  ActionRecordSchema,
  CoachMessageSchema,
  CoachThreadSchema,
  CoachTurnSchema,
  MemorySchema,
  PlaybookCandidateSchema,
  type ActionRecord,
  type CoachMessage,
  type CoachThread,
  type CoachTurn,
  type CoachUndoResult,
  type CoachWrite,
  type CoachWriteResult,
  type Memory,
  type PainFlag,
  type PlaybookCandidate,
} from '@fizz/schemas';
import type { Database } from './database';
import { decodeDocument, erase, listDocuments, PAIN_FLAG_SPEC, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor, SqlRow } from './driver';
import { checkRead, checkWrite, insert, mismatch, parseJson, rowId } from './sql';

/**
 * Coach v1 storage (ADR 0019 §9, slice C3). Every coach write is an
 * `ActionRecord` committed in the same transaction as the change it
 * describes, so a force-close leaves both or neither. Writes are idempotent
 * on the record's `opId` (rule 5) and, for the append kinds, on their
 * content. Conversations and action records are never deleted.
 *
 * Not here yet (seams): today's set targets (`adjust_pending_sets` and its
 * Undo) need the reducer's `adjust_pending_targets` command, which waits for
 * `claude/active-set` (`TargetSource` gains `coach`); next-session targets
 * and offers arrive with C7/C8.
 */

export const COACH_THREAD_SPEC: DocumentSpec<CoachThread> = { table: 'coach_threads', schema: CoachThreadSchema, columns: (t) => ({ owner_id: t.ownerId }) };
export const COACH_TURN_SPEC: DocumentSpec<CoachTurn> = {
  table: 'coach_turns',
  schema: CoachTurnSchema,
  columns: (t) => ({ owner_id: t.ownerId, thread_id: t.threadId, status: t.status }),
};
export const MEMORY_SPEC: DocumentSpec<Memory> = {
  table: 'memories',
  schema: MemorySchema,
  columns: (m) => ({ owner_id: m.ownerId, content_key: m.contentKey, status: m.status }),
};
export const PLAYBOOK_CANDIDATE_SPEC: DocumentSpec<PlaybookCandidate> = {
  table: 'playbook_candidates',
  schema: PlaybookCandidateSchema,
  columns: (c) => ({ content_key: c.contentKey, status: c.status }),
};

/** The session an action is about, for `get_recent_actions` and the workout's Undo. */
function sessionOf(record: ActionRecord): string | null {
  switch (record.detail.kind) {
    case 'adjust_pending_sets':
      return record.detail.sessionId;
    case 'set_next_session_targets':
    case 'propose_next_workout_change':
      return record.detail.sourceSessionId;
    case 'set_pain_flag':
    case 'save_memory':
    case 'forget_memory':
    case 'add_playbook_candidate':
    case 'undo':
      return null;
  }
}

export function decodeAction(row: SqlRow): ActionRecord {
  const id = rowId(row.id);
  const record = checkRead(ActionRecordSchema, parseJson('coach_actions', id, 'data', row.data ?? null), 'coach_actions', id);
  const expect: Record<string, unknown> = {
    id: record.actionId,
    op_id: record.opId,
    turn_id: record.turnId,
    session_id: sessionOf(record),
    kind: record.detail.kind,
    status: record.status,
    created_at_utc: record.createdAt.utc,
  };
  for (const [col, value] of Object.entries(expect)) {
    if (row[col] !== value) throw mismatch('coach_actions', id, col, `Column says ${String(row[col])}, document says ${String(value)}`);
  }
  return record;
}

export function decodeMessage(row: SqlRow): CoachMessage {
  const id = rowId(row.id);
  const m = checkRead(CoachMessageSchema, parseJson('coach_messages', id, 'data', row.data ?? null), 'coach_messages', id);
  const expect: Record<string, unknown> = {
    id: m.id,
    owner_id: m.ownerId,
    thread_id: m.threadId,
    turn_id: m.turnId,
    ordinal: m.ordinal,
    role: m.body.role,
    created_at_utc: m.createdAt.utc,
  };
  for (const [col, value] of Object.entries(expect)) {
    if (row[col] !== value) throw mismatch('coach_messages', id, col, `Column says ${String(row[col])}, document says ${String(value)}`);
  }
  return m;
}

/** Coach tables for the whole-database integrity check. */
export const COACH_DOCUMENT_TABLES: readonly DocumentTable[] = [
  erase(COACH_THREAD_SPEC),
  erase(COACH_TURN_SPEC),
  erase(MEMORY_SPEC),
  erase(PLAYBOOK_CANDIDATE_SPEC),
  { table: 'coach_actions', decode: decodeAction },
  { table: 'coach_messages', decode: decodeMessage },
];

async function actionByOp(q: SqlExecutor, ownerId: string, opId: string): Promise<ActionRecord | null> {
  const row = await q.getFirst('SELECT * FROM coach_actions WHERE owner_id = ? AND op_id = ?', [ownerId, opId]);
  return row ? decodeAction(row) : null;
}

async function actionById(q: SqlExecutor, actionId: string): Promise<{ record: ActionRecord; version: number; ownerId: string } | null> {
  const row = await q.getFirst('SELECT * FROM coach_actions WHERE id = ?', [actionId]);
  if (row === null) return null;
  return { record: decodeAction(row), version: Number(row.version), ownerId: String(row.owner_id) };
}

async function insertAction(tx: SqlExecutor, ownerId: string, record: ActionRecord): Promise<void> {
  const valid = checkWrite(ActionRecordSchema, record, 'coach_actions', record.actionId);
  await insert(tx, 'coach_actions', {
    id: valid.actionId,
    owner_id: ownerId,
    op_id: valid.opId,
    turn_id: valid.turnId,
    session_id: sessionOf(valid),
    kind: valid.detail.kind,
    status: valid.status,
    version: 1,
    created_at_utc: valid.createdAt.utc,
    updated_at_utc: valid.createdAt.utc,
    data: JSON.stringify(valid),
  });
}

async function updateAction(tx: SqlExecutor, record: ActionRecord, expectedVersion: number, atUtc: string): Promise<boolean> {
  const valid = checkWrite(ActionRecordSchema, record, 'coach_actions', record.actionId);
  const r = await tx.run('UPDATE coach_actions SET data = ?, status = ?, version = version + 1, updated_at_utc = ? WHERE id = ? AND version = ?', [
    JSON.stringify(valid),
    valid.status,
    atUtc,
    valid.actionId,
    expectedVersion,
  ]);
  return r.changes === 1;
}

async function getDoc<T extends { id: string; version: number; updatedAtUtc: string }>(q: SqlExecutor, spec: DocumentSpec<T>, id: string): Promise<T | null> {
  const row = await q.getFirst(`SELECT * FROM "${spec.table}" WHERE id = ?`, [id]);
  return row ? decodeDocument(spec, row) : null;
}

/** Thrown inside a transaction to roll it back and report a conflict. */
class Rollback extends Error {
  constructor(readonly reason: 'stale_version' | 'missing' | 'already_exists') {
    super(reason);
  }
}

export class SqliteCoachStore {
  constructor(private readonly db: Database) {}

  // ---------- Threads, turns, messages ----------

  /**
   * Save Ben's message before the request is sent (ADR 0019 §7), with the
   * thread when it is new and the turn as `running`. Idempotent by turn ID.
   */
  startTurn(input: { thread: CoachThread; newThread: boolean; turn: CoachTurn; benMessage: Omit<CoachMessage, 'ordinal'> }): Promise<{ turn: CoachTurn; benMessage: CoachMessage; replayed: boolean }> {
    return this.db.write(async (tx) => {
      const existing = await getDoc(tx, COACH_TURN_SPEC, input.turn.id);
      if (existing !== null) {
        const row = await tx.getFirst("SELECT * FROM coach_messages WHERE turn_id = ? AND role = 'ben' ORDER BY ordinal LIMIT 1", [existing.id]);
        if (row === null) throw new Error(`Turn ${existing.id} has no message from Ben`);
        return { turn: existing, benMessage: decodeMessage(row), replayed: true };
      }
      if (input.newThread) {
        const saved = await saveDocumentIn(tx, COACH_THREAD_SPEC, input.thread, null);
        if (!saved.ok) throw new Error(`Thread ${input.thread.id} already exists`);
      } else {
        const current = await getDoc(tx, COACH_THREAD_SPEC, input.thread.id);
        if (current === null) throw new Error(`Thread ${input.thread.id} doesn't exist`);
        await saveDocumentIn(tx, COACH_THREAD_SPEC, { ...current, version: current.version + 1, updatedAtUtc: input.turn.updatedAtUtc }, current.version);
      }
      const saved = await saveDocumentIn(tx, COACH_TURN_SPEC, input.turn, null);
      if (!saved.ok) throw new Error(`Turn ${input.turn.id} already exists`);
      const benMessage = await this.appendIn(tx, input.benMessage);
      return { turn: input.turn, benMessage, replayed: false };
    });
  }

  /** Append a message at the end of its thread. Idempotent by message ID. */
  appendMessage(message: Omit<CoachMessage, 'ordinal'>): Promise<CoachMessage> {
    return this.db.write((tx) => this.appendIn(tx, message));
  }

  private async appendIn(tx: SqlExecutor, message: Omit<CoachMessage, 'ordinal'>): Promise<CoachMessage> {
    const dup = await tx.getFirst('SELECT * FROM coach_messages WHERE id = ?', [message.id]);
    if (dup !== null) return decodeMessage(dup);
    const last = await tx.getFirst<{ n: number | null }>('SELECT max(ordinal) AS n FROM coach_messages WHERE thread_id = ?', [message.threadId]);
    const full = checkWrite(CoachMessageSchema, { ...message, ordinal: (last?.n ?? -1) + 1 }, 'coach_messages', message.id);
    await insert(tx, 'coach_messages', {
      id: full.id,
      owner_id: full.ownerId,
      thread_id: full.threadId,
      turn_id: full.turnId,
      ordinal: full.ordinal,
      role: full.body.role,
      created_at_utc: full.createdAt.utc,
      data: JSON.stringify(full),
    });
    return full;
  }

  /** End a turn (or record its tool log so far). Versioned; a finished turn is never reopened. */
  updateTurn(turnId: string, patch: Pick<CoachTurn, 'status' | 'error' | 'endedAtUtc' | 'toolLog'>, atUtc: string): Promise<CoachTurn> {
    return this.db.write(async (tx) => {
      const current = await getDoc(tx, COACH_TURN_SPEC, turnId);
      if (current === null) throw new Error(`Turn ${turnId} doesn't exist`);
      if (current.status !== 'running') return current;
      const next: CoachTurn = { ...current, ...patch, version: current.version + 1, updatedAtUtc: atUtc };
      const r = await saveDocumentIn(tx, COACH_TURN_SPEC, next, current.version);
      if (!r.ok) throw new Error(`Turn ${turnId} changed while it was being saved`);
      return next;
    });
  }

  /**
   * Restart recovery (ADR 0019 §7, coach-contract check 8): a turn still
   * `running` when the app starts was cut off by a force-close. It becomes
   * `interrupted`; its committed actions are already saved and show their
   * cards once; nothing is re-sent or padded.
   */
  recoverInterruptedTurns(ownerId: string, atUtc: string): Promise<CoachTurn[]> {
    return this.db.write(async (tx) => {
      const running = await listDocuments(tx, COACH_TURN_SPEC, "owner_id = ? AND status = 'running'", [ownerId]);
      const out: CoachTurn[] = [];
      for (const t of running) {
        const next: CoachTurn = { ...t, status: 'interrupted', endedAtUtc: atUtc, version: t.version + 1, updatedAtUtc: atUtc };
        await saveDocumentIn(tx, COACH_TURN_SPEC, next, t.version);
        out.push(next);
      }
      return out;
    });
  }

  getTurn(turnId: string): Promise<CoachTurn | null> {
    return this.db.read((q) => getDoc(q, COACH_TURN_SPEC, turnId));
  }

  getThread(threadId: string): Promise<CoachThread | null> {
    return this.db.read((q) => getDoc(q, COACH_THREAD_SPEC, threadId));
  }

  /** Newest first (the sheet's thread list). */
  listThreads(ownerId: string): Promise<CoachThread[]> {
    return this.db.read(async (q) => (await listDocuments(q, COACH_THREAD_SPEC, 'owner_id = ?', [ownerId])).sort((a, b) => (a.updatedAtUtc < b.updatedAtUtc ? 1 : -1)));
  }

  listMessages(threadId: string): Promise<CoachMessage[]> {
    return this.db.read(async (q) => (await q.getAll('SELECT * FROM coach_messages WHERE thread_id = ? ORDER BY ordinal', [threadId])).map(decodeMessage));
  }

  // ---------- Actions ----------

  findActionByOpId(ownerId: string, opId: string): Promise<ActionRecord | null> {
    return this.db.read((q) => actionByOp(q, ownerId, opId));
  }

  getAction(actionId: string): Promise<ActionRecord | null> {
    return this.db.read(async (q) => (await actionById(q, actionId))?.record ?? null);
  }

  listTurnActions(turnId: string): Promise<ActionRecord[]> {
    return this.db.read(async (q) => (await q.getAll('SELECT * FROM coach_actions WHERE turn_id = ? ORDER BY created_at_utc, id', [turnId])).map(decodeAction));
  }

  /** Newest first: this session's actions when given, else the owner's (for `get_recent_actions`). */
  listRecentActions(ownerId: string, options: { sessionId?: string | null; limit: number }): Promise<ActionRecord[]> {
    return this.db.read(async (q) => {
      const rows =
        options.sessionId != null
          ? await q.getAll('SELECT * FROM coach_actions WHERE owner_id = ? AND session_id = ? ORDER BY created_at_utc DESC, id DESC LIMIT ?', [ownerId, options.sessionId, options.limit])
          : await q.getAll('SELECT * FROM coach_actions WHERE owner_id = ? ORDER BY created_at_utc DESC, id DESC LIMIT ?', [ownerId, options.limit]);
      return rows.map(decodeAction);
    });
  }

  /**
   * Commit one coach write: the change and its record together, or nothing.
   * A record with the same opId already saved is returned unchanged
   * (`replayed`), so a tool call replayed after a dropped connection changes
   * nothing twice (contract check 6).
   */
  commit(ownerId: string, write: CoachWrite): Promise<CoachWriteResult> {
    return this.db
      .write(async (tx): Promise<CoachWriteResult> => {
        const prior = await actionByOp(tx, ownerId, write.action.opId);
        if (prior !== null) return { status: 'replayed', action: prior };
        const replay = await this.applyIn(tx, ownerId, write);
        if (replay !== null) return { status: 'replayed', action: replay };
        await insertAction(tx, ownerId, write.action);
        return { status: 'written', action: write.action };
      })
      .catch((e: unknown) => {
        if (e instanceof Rollback) return { status: 'conflict', reason: e.reason };
        throw e;
      });
  }

  /** The change itself. Returns an existing record when the same live content is already there. */
  private async applyIn(tx: SqlExecutor, ownerId: string, write: CoachWrite): Promise<ActionRecord | null> {
    switch (write.kind) {
      case 'record':
        return null;
      case 'save_memory': {
        if (write.memory.ownerId !== ownerId) throw new Error('Memory owner differs from the store owner');
        const live = await tx.getFirst("SELECT * FROM memories WHERE owner_id = ? AND content_key = ? AND status = 'active'", [ownerId, write.memory.contentKey]);
        if (live !== null) return this.creatorOf(tx, decodeDocument(MEMORY_SPEC, live).createdByActionId);
        const r = await saveDocumentIn(tx, MEMORY_SPEC, write.memory, null);
        if (!r.ok) throw new Rollback('already_exists');
        return null;
      }
      case 'forget_memory': {
        const m = await getDoc(tx, MEMORY_SPEC, write.memoryId);
        if (m === null || m.ownerId !== ownerId) throw new Rollback('missing');
        if (m.version !== write.expectedVersion || m.status !== 'active') throw new Rollback('stale_version');
        await saveDocumentIn(tx, MEMORY_SPEC, { ...m, status: 'forgotten' as const, version: m.version + 1, updatedAtUtc: write.atUtc }, m.version);
        return null;
      }
      case 'pain_flags': {
        // Rule 9: a flag is never duplicated; flags that are already on stay as they are.
        let added = 0;
        for (const f of write.flags) {
          if (f.ownerId !== ownerId) throw new Error('Pain flag owner differs from the store owner');
          const live = await tx.getFirst("SELECT id FROM pain_flags WHERE owner_id = ? AND exercise_id = ? AND status = 'active'", [ownerId, f.exerciseId]);
          if (live !== null) continue;
          const r = await saveDocumentIn(tx, PAIN_FLAG_SPEC, f, null);
          if (!r.ok) throw new Rollback('already_exists');
          added += 1;
        }
        if (added === 0) throw new Rollback('already_exists');
        return null;
      }
      case 'playbook_candidate': {
        const open = await tx.getFirst("SELECT * FROM playbook_candidates WHERE content_key = ? AND status = 'to_review'", [write.candidate.contentKey]);
        if (open !== null) return this.creatorOf(tx, decodeDocument(PLAYBOOK_CANDIDATE_SPEC, open).createdByActionId);
        const r = await saveDocumentIn(tx, PLAYBOOK_CANDIDATE_SPEC, write.candidate, null);
        if (!r.ok) throw new Rollback('already_exists');
        return null;
      }
    }
  }

  private async creatorOf(tx: SqlExecutor, actionId: string): Promise<ActionRecord> {
    const a = await actionById(tx, actionId);
    if (a === null) throw new Rollback('already_exists');
    return a.record;
  }

  /**
   * Undo a coach action (Ben's tap; the coach has no undo tool). The undo is
   * its own `ActionRecord`, written with the reversal and the target's
   * `undoneBy` in one transaction. Idempotent on the undo's opId. Today's
   * set targets aren't undone here yet (see the file comment).
   */
  undo(ownerId: string, undo: ActionRecord): Promise<CoachUndoResult> {
    if (undo.detail.kind !== 'undo') throw new TypeError('undo() takes an undo record');
    const targetId = undo.detail.undoneActionId;
    const atUtc = undo.createdAt.utc;
    return this.db.write(async (tx): Promise<CoachUndoResult> => {
      const prior = await actionByOp(tx, ownerId, undo.opId);
      if (prior !== null) {
        const t = await actionById(tx, targetId);
        return t === null ? { status: 'not_possible', reason: 'missing' } : { status: 'replayed', undo: prior, target: t.record };
      }
      const target = await actionById(tx, targetId);
      if (target === null || target.ownerId !== ownerId) return { status: 'not_possible', reason: 'missing' };
      if (target.record.status !== 'committed') return { status: 'not_possible', reason: 'not_committed' };
      if (target.record.undoneBy !== null) return { status: 'not_possible', reason: 'already_undone' };
      const reverted = await this.revertIn(tx, ownerId, target.record, atUtc);
      if (reverted !== 'ok') return { status: 'not_possible', reason: reverted };
      const updated: ActionRecord = { ...target.record, undoneBy: { actionId: undo.actionId, atUtc } };
      if (!(await updateAction(tx, updated, target.version, atUtc))) throw new Error(`Action ${targetId} changed while it was being undone`);
      await insertAction(tx, ownerId, undo);
      return { status: 'written', undo, target: updated };
    });
  }

  private async revertIn(tx: SqlExecutor, ownerId: string, target: ActionRecord, atUtc: string): Promise<'ok' | 'changed_since' | 'unsupported'> {
    const d = target.detail;
    switch (d.kind) {
      case 'save_memory': {
        const m = await getDoc(tx, MEMORY_SPEC, d.memoryId);
        if (m === null || m.ownerId !== ownerId || m.status !== 'active') return 'changed_since';
        await saveDocumentIn(tx, MEMORY_SPEC, { ...m, status: 'forgotten' as const, version: m.version + 1, updatedAtUtc: atUtc }, m.version);
        return 'ok';
      }
      case 'forget_memory': {
        const m = await getDoc(tx, MEMORY_SPEC, d.memoryId);
        if (m === null || m.ownerId !== ownerId || m.status !== 'forgotten') return 'changed_since';
        const clash = await tx.getFirst("SELECT id FROM memories WHERE owner_id = ? AND content_key = ? AND status = 'active'", [ownerId, m.contentKey]);
        if (clash !== null) return 'changed_since';
        await saveDocumentIn(tx, MEMORY_SPEC, { ...m, status: 'active' as const, version: m.version + 1, updatedAtUtc: atUtc }, m.version);
        return 'ok';
      }
      case 'set_pain_flag': {
        let cleared = 0;
        for (const id of d.flagIds) {
          const f: PainFlag | null = await getDoc(tx, PAIN_FLAG_SPEC, id);
          if (f === null || f.ownerId !== ownerId || f.status !== 'active') continue;
          await saveDocumentIn(tx, PAIN_FLAG_SPEC, { ...f, status: 'cleared' as const, clearedAtUtc: atUtc, version: f.version + 1, updatedAtUtc: atUtc }, f.version);
          cleared += 1;
        }
        return cleared > 0 ? 'ok' : 'changed_since';
      }
      case 'add_playbook_candidate': {
        const c = await getDoc(tx, PLAYBOOK_CANDIDATE_SPEC, d.candidateId);
        if (c === null || c.status !== 'to_review') return 'changed_since';
        await saveDocumentIn(tx, PLAYBOOK_CANDIDATE_SPEC, { ...c, status: 'withdrawn' as const, version: c.version + 1, updatedAtUtc: atUtc }, c.version);
        return 'ok';
      }
      case 'adjust_pending_sets':
      case 'set_next_session_targets':
      case 'propose_next_workout_change':
      case 'undo':
        return 'unsupported';
    }
  }

  // ---------- Memories and playbook candidates ----------

  listMemories(ownerId: string, status: Memory['status'] | 'all' = 'active'): Promise<Memory[]> {
    return this.db.read((q) =>
      status === 'all' ? listDocuments<Memory>(q, MEMORY_SPEC, 'owner_id = ?', [ownerId]) : listDocuments<Memory>(q, MEMORY_SPEC, 'owner_id = ? AND status = ?', [ownerId, status]),
    );
  }

  getMemory(id: string): Promise<Memory | null> {
    return this.db.read((q) => getDoc(q, MEMORY_SPEC, id));
  }

  /** Coaching knowledge, read-only in v1; never sent to the coach until approved. */
  listPlaybookCandidates(): Promise<PlaybookCandidate[]> {
    return this.db.read((q) => listDocuments(q, PLAYBOOK_CANDIDATE_SPEC));
  }
}

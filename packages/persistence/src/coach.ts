import {
  ActionRecordSchema,
  CoachMessageSchema,
  CoachThreadSchema,
  CoachTurnSchema,
  MemorySchema,
  NextSessionTargetRecordSchema,
  PlaybookCandidateSchema,
  type ActionRecord,
  type CoachMessage,
  type CoachThread,
  type CoachTurn,
  type CoachUndoResult,
  type CoachWrite,
  type CoachWriteResult,
  type DraftBasis,
  type ExerciseTargetChanges,
  type Memory,
  type NextSessionTargetRecord,
  type PainFlag,
  type PlaybookCandidate,
} from '@fizz/schemas';
import { chatSetUndoCommand, isInHistory, nextTargetSourceBasis, reduceSession, suggestionInDate } from '@fizz/domain';
import type { Database } from './database';
import { readAggregate, writeAggregate } from './sessions';
import { decodeDocument, erase, EXERCISE_SPEC, listDocuments, PAIN_FLAG_SPEC, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor, SqlRow } from './driver';
import { checkRead, checkWrite, inHistorySql, insert, mismatch, parseJson, rowId } from './sql';
import { getWorkoutDraftIn, WORKOUT_DRAFT_SPEC } from './workout-drafts';

/**
 * Coach v1 storage (ADR 0020 §9, slice C3). Every coach write is an
 * `ActionRecord` committed in the same transaction as the change it
 * describes, so a force-close leaves both or neither. Writes are idempotent
 * on the record's `opId` (rule 5) and, for the append kinds, on their
 * content. Conversations and action records are never deleted.
 *
 * Today's set targets (`adjust_pending_sets`, C7) run the session reducer
 * inside the same transaction as their record; next-session targets (C8)
 * are rows written with theirs.
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

export const NEXT_TARGET_SPEC: DocumentSpec<NextSessionTargetRecord> = {
  table: 'next_session_targets',
  schema: NextSessionTargetRecordSchema,
  columns: (r) => ({ owner_id: r.ownerId, source_session_id: r.sourceSessionId, exercise_id: r.exerciseId, action_id: r.actionId, status: r.status }),
};

/** Ben's review of a playbook candidate. */
export type CandidateWrite = { status: 'written'; candidate: PlaybookCandidate } | { status: 'stale'; candidate: PlaybookCandidate } | { status: 'missing' };

/** A Ben write on a memory (Save, Not now, edit). */
export type MemoryWrite = { status: 'written'; memory: Memory } | { status: 'stale' | 'duplicate'; memory: Memory } | { status: 'missing' };

/** The session an action is about, for `get_recent_actions` and the workout's Undo. */
function sessionOf(record: ActionRecord): string | null {
  switch (record.detail.kind) {
    case 'adjust_pending_sets':
    case 'add_exercise_today':
    case 'edit_today':
    case 'rename_workout':
    case 'log_set':
    case 'correct_set':
      return record.detail.sessionId;
    case 'set_next_session_targets':
    case 'propose_next_workout_change':
      return record.detail.sourceSessionId;
    case 'set_pain_flag':
    case 'save_memory':
    case 'suggest_memory':
    case 'forget_memory':
    case 'add_playbook_candidate':
    case 'update_routine':
    case 'fit_today':
    case 'build_workout':
    case 'build_question':
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
  erase(NEXT_TARGET_SPEC),
  { table: 'coach_actions', decode: decodeAction },
  { table: 'coach_messages', decode: decodeMessage },
];

export async function actionByOp(q: SqlExecutor, ownerId: string, opId: string): Promise<ActionRecord | null> {
  const row = await q.getFirst('SELECT * FROM coach_actions WHERE owner_id = ? AND op_id = ?', [ownerId, opId]);
  return row ? decodeAction(row) : null;
}

export async function actionById(q: SqlExecutor, actionId: string): Promise<{ record: ActionRecord; version: number; ownerId: string } | null> {
  const row = await q.getFirst('SELECT * FROM coach_actions WHERE id = ?', [actionId]);
  if (row === null) return null;
  return { record: decodeAction(row), version: Number(row.version), ownerId: String(row.owner_id) };
}

export async function insertAction(tx: SqlExecutor, ownerId: string, record: ActionRecord): Promise<void> {
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

export async function updateAction(tx: SqlExecutor, record: ActionRecord, expectedVersion: number, atUtc: string): Promise<boolean> {
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

/**
 * The workout started from `source`, if any (CA10; review S2, S3): a start
 * noted in `next_target_uses` whose session exists and isn't discarded. An
 * unrelated workout never counts, and a discarded start gives the source's
 * targets back.
 */
/**
 * SQL: a `coach_actions` row (alias `a`) is in the coach's context. Its workout, if any, is the live
 * one or in history; a workout that's deleted, discarded, reverted or purged (tombstone) isn't
 * (delete-workouts §5, DW16; review r3 S1).
 */
export function actionInContextSql(a: string): string {
  return `(${a}.session_id IS NULL OR (
    NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = ${a}.session_id AND NOT (s.status = 'active' OR ${inHistorySql('s')}))
    AND NOT EXISTS (SELECT 1 FROM purged_sessions p WHERE p.session_id = ${a}.session_id)))`;
}

async function startedFrom(q: SqlExecutor, ownerId: string, sourceSessionId: string): Promise<string | null> {
  const row = await q.getFirst<{ id: string }>(
    "SELECT s.id AS id FROM next_target_uses u JOIN sessions s ON s.owner_id = u.owner_id AND s.start_operation_id = u.start_op_id WHERE u.owner_id = ? AND u.source_session_id = ? AND s.id != ? AND s.status IN ('active', 'finished') ORDER BY s.started_at_utc LIMIT 1",
    [ownerId, sourceSessionId, sourceSessionId],
  );
  return row?.id ?? null;
}

/**
 * Has a workout started from this basis since `sinceUtc` (and still exists,
 * not discarded)? A routine: a session of that routine. The next session of a
 * workout: a start noted against it (`next_target_uses`). Live or in
 * history (`inHistorySql`): a deleted workout doesn't count. Structural
 * proposals and their Apply end there (ADR 0020 §3).
 */
export async function basisStartedSince(q: SqlExecutor, ownerId: string, basis: DraftBasis, sinceUtc: string): Promise<boolean> {
  if (basis.kind === 'coach_draft') {
    const started = await q.getFirst<{ id: string }>("SELECT id FROM workout_drafts WHERE id = ? AND owner_id = ? AND status = 'started' AND updated_at_utc >= ?", [basis.draftId, ownerId, sinceUtc]);
    return started !== null;
  }
  const row =
    basis.kind === 'routine'
      ? await q.getFirst<{ id: string }>(`SELECT id FROM sessions WHERE owner_id = ? AND routine_id = ? AND started_at_utc >= ? AND (status = 'active' OR ${inHistorySql()}) LIMIT 1`, [ownerId, basis.routineId, sinceUtc])
      : await q.getFirst<{ id: string }>(
          `SELECT s.id AS id FROM next_target_uses u JOIN sessions s ON s.owner_id = u.owner_id AND s.start_operation_id = u.start_op_id WHERE u.owner_id = ? AND u.source_session_id = ? AND s.id != ? AND u.created_at_utc >= ? AND (s.status = 'active' OR ${inHistorySql('s')}) LIMIT 1`,
          [ownerId, basis.sourceSessionId, basis.sourceSessionId, sinceUtc],
        );
  return row !== null;
}

/** A row as read: `usedBySessionId` is the live workout started from its source, worked out at read time. */
function withUse(row: NextSessionTargetRecord, usedBy: string | null): NextSessionTargetRecord {
  return row.usedBySessionId === usedBy ? row : { ...row, usedBySessionId: usedBy };
}

/** Statuses a next-session target row may move between by Ben's tap. */
const NEXT_TARGET_MOVES: Record<NextSessionTargetRecord['status'], readonly NextSessionTargetRecord['status'][]> = {
  saved: ['undone'],
  undone: ['saved'],
  proposed: ['applied', 'not_applied'],
  applied: ['proposed'],
  not_applied: [],
};

/** Ben's tap on one `Next time` row: the row as he saw it, its new status and the record of the tap. */
export interface NextTargetStatusWrite {
  rowId: string;
  expectedVersion: number;
  status: NextSessionTargetRecord['status'];
  record: ActionRecord;
}

export type NextTargetStatusResult = { status: 'written' | 'replayed'; row: NextSessionTargetRecord } | { status: 'not_possible'; reason: 'missing' | 'changed_since' | 'used' };

export class SqliteCoachStore {
  constructor(private readonly db: Database) {}

  // ---------- Threads, turns, messages ----------

  /**
   * Save Ben's message before the request is sent (ADR 0020 §7), with the
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
   * Restart recovery (ADR 0020 §7, coach-contract check 8): a turn still
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

  /**
   * Newest first: this session's actions when given, else the owner's (for `get_recent_actions`).
   * Only actions in the coach's context (delete-workouts §5, DW16; review r3 S1): an action on a
   * deleted, discarded, reverted or purged workout is left out, and so is an Undo of one.
   */
  listRecentActions(ownerId: string, options: { sessionId?: string | null; limit: number }): Promise<ActionRecord[]> {
    return this.db.read(async (q) => {
      const inContext = `${actionInContextSql('a')} AND NOT (a.kind = 'undo' AND EXISTS (SELECT 1 FROM coach_actions t WHERE t.id = json_extract(a.data, '$.detail.undoneActionId') AND NOT ${actionInContextSql('t')}))`;
      const rows =
        options.sessionId != null
          ? await q.getAll(`SELECT a.* FROM coach_actions a WHERE a.owner_id = ? AND a.session_id = ? AND ${inContext} ORDER BY a.created_at_utc DESC, a.id DESC LIMIT ?`, [ownerId, options.sessionId, options.limit])
          : await q.getAll(`SELECT a.* FROM coach_actions a WHERE a.owner_id = ? AND ${inContext} ORDER BY a.created_at_utc DESC, a.id DESC LIMIT ?`, [ownerId, options.limit]);
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
      case 'suggest_memory': {
        // CM1/CM2: a suggestion waits for Ben; one already saved or waiting with the same text isn't suggested again.
        // One that dropped off after SUGGESTION_DAYS without an answer isn't waiting any more (review S6): the
        // same words may be suggested again. The old row stays as it was (CM3).
        if (write.memory.ownerId !== ownerId) throw new Error('Memory owner differs from the store owner');
        const saved = await tx.getFirst("SELECT id FROM memories WHERE owner_id = ? AND content_key = ? AND status = 'active'", [ownerId, write.memory.contentKey]);
        if (saved !== null) throw new Rollback('already_exists');
        const waiting = await tx.getAll("SELECT * FROM memories WHERE owner_id = ? AND content_key = ? AND status = 'suggested'", [ownerId, write.memory.contentKey]);
        if (waiting.some((row) => suggestionInDate(decodeDocument(MEMORY_SPEC, row), write.memory.createdAtUtc))) throw new Rollback('already_exists');
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
      case 'next_session_targets': {
        const source = await readAggregate(tx, write.action.detail.kind === 'set_next_session_targets' ? write.action.detail.sourceSessionId : '');
        if (source === null || source.session.ownerId !== ownerId) throw new Rollback('missing');
        // The same sets as the review saw (CA10): a rename or a time edit since isn't a change to the targets' basis.
        if (nextTargetSourceBasis(source) !== write.sourceBasis || !isInHistory(source.session) || (await startedFrom(tx, ownerId, source.session.id)) !== null) throw new Rollback('stale_version');
        // A newer review replaces the rows, including a tap Ben made on an earlier review's row
        // (only reachable through his own `Try again` after a review that saved then failed; review N2).
        // The earlier review's card can't revert them after that (`changed_since`).
        for (const row of write.rows) {
          if (row.ownerId !== ownerId) throw new Error('Next-target owner differs from the store owner');
          const current = await getDoc(tx, NEXT_TARGET_SPEC, row.id);
          const r = await saveDocumentIn(tx, NEXT_TARGET_SPEC, current === null ? row : { ...row, version: current.version + 1, createdAtUtc: current.createdAtUtc }, current?.version ?? null);
          if (!r.ok) throw new Rollback('stale_version');
        }
        return null;
      }
      case 'session_command': {
        const agg = await readAggregate(tx, write.sessionId);
        if (agg === null || agg.session.ownerId !== ownerId) throw new Rollback('missing');
        if (write.expectedSessionVersion !== undefined && agg.session.version !== write.expectedSessionVersion) throw new Rollback('stale_version');
        // Review coach-add S3: the catalogue exercise is saved only with the add itself, never on a refusal.
        // Coach v3: an edit may add or swap to more than one catalogue exercise (`saveExercises`).
        for (const e of [...(write.saveExercise === undefined ? [] : [write.saveExercise]), ...(write.saveExercises ?? [])]) {
          if ((await tx.getFirst('SELECT id FROM exercises WHERE id = ?', [e.id])) !== null) continue;
          if (e.ownerId !== null && e.ownerId !== ownerId) throw new Error('Exercise owner differs from the store owner');
          const saved = await saveDocumentIn(tx, EXERCISE_SPEC, e, null);
          if (!saved.ok) throw new Rollback('missing');
        }
        const r = reduceSession(agg, write.command);
        if (!r.ok) throw new Rollback(r.error.code === 'stale_version' ? 'stale_version' : 'missing');
        if (r.state !== agg) await writeAggregate(tx, r.state);
        return null;
      }
      case 'playbook_candidate': {
        const open = await tx.getFirst("SELECT * FROM playbook_candidates WHERE content_key = ? AND status = 'to_review'", [write.candidate.contentKey]);
        if (open !== null) return this.creatorOf(tx, decodeDocument(PLAYBOOK_CANDIDATE_SPEC, open).createdByActionId);
        // (11 Oct) Already approved or rejected in the same words: not offered again (coaching-playbook §3.1).
        const decided = await tx.getFirst("SELECT id FROM playbook_candidates WHERE content_key = ? AND status IN ('approved', 'rejected')", [write.candidate.contentKey]);
        if (decided !== null) throw new Rollback('already_exists');
        const r = await saveDocumentIn(tx, PLAYBOOK_CANDIDATE_SPEC, write.candidate, null);
        if (!r.ok) throw new Rollback('already_exists');
        return null;
      }
      case 'workout_draft': {
        // workout-builder §8.2: the draft (new, or a new version on the version the turn read) and its record together.
        if (write.draft.ownerId !== ownerId) throw new Error('Draft owner differs from the store owner');
        if (write.expectedVersion !== null) {
          const current = await getWorkoutDraftIn(tx, write.draft.id);
          if (current === null || current.ownerId !== ownerId) throw new Rollback('missing');
          if (current.status !== 'open' || current.expiresAtUtc <= write.action.createdAt.utc) throw new Rollback('stale_version');
        }
        const r = await saveDocumentIn(tx, WORKOUT_DRAFT_SPEC, write.draft, write.expectedVersion);
        if (!r.ok) throw new Rollback(write.expectedVersion === null ? 'already_exists' : 'stale_version');
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
      if (reverted !== 'ok' && typeof reverted === 'string') return { status: 'not_possible', reason: reverted };
      const updated: ActionRecord = { ...target.record, undoneBy: { actionId: undo.actionId, atUtc } };
      if (!(await updateAction(tx, updated, target.version, atUtc))) throw new Error(`Action ${targetId} changed while it was being undone`);
      // Today's sets: the undo says what came back and what was already logged (from the reducer's result, not the model).
      const saved: ActionRecord = typeof reverted === 'object' ? { ...undo, detail: { ...undo.detail, ...reverted } } : undo;
      await insertAction(tx, ownerId, saved);
      return { status: 'written', undo: saved, target: updated };
    });
  }

  private async revertIn(
    tx: SqlExecutor,
    ownerId: string,
    target: ActionRecord,
    atUtc: string,
  ): Promise<'ok' | 'changed_since' | 'gym_changed' | 'unsupported' | { restored: ExerciseTargetChanges[]; alreadyLogged: number[] }> {
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
      case 'adjust_pending_sets': {
        const agg = await readAggregate(tx, d.sessionId);
        if (agg === null || agg.session.ownerId !== ownerId || agg.session.status !== 'active') return 'changed_since';
        const changes = d.exercises.flatMap((e) => e.changes);
        const r = reduceSession(agg, {
          type: 'revert_target_adjustment',
          at: { utc: atUtc, tz: target.createdAt.tz },
          opId: `undo:${target.actionId}`,
          actionId: target.actionId,
          removedSetIds: changes.filter((c) => c.after === null).map((c) => c.setId),
          addedSetIds: changes.filter((c) => c.before === null).map((c) => c.setId),
        });
        if (!r.ok && r.error.code === 'gym_changed') return 'gym_changed';
        if (!r.ok || r.state === agg || r.duplicate) return 'changed_since';
        await writeAggregate(tx, r.state);
        const now = new Map(r.state.sets.map((x) => [x.id, x]));
        const was = new Map(agg.sets.map((x) => [x.id, x]));
        const restored: ExerciseTargetChanges[] = d.exercises
          .map((e) => ({
            ...e,
            changes: e.changes.filter((c) => c.before !== null && c.after !== null && was.get(c.setId)?.status === 'pending' && now.get(c.setId)?.planned.coach?.actionId !== target.actionId).map((c) => ({ ...c, before: c.after, after: c.before })),
          }))
          .filter((e) => e.changes.length > 0);
        const alreadyLogged = changes.filter((c) => now.get(c.setId)?.status === 'completed').map((c) => c.setNumber);
        return { restored, alreadyLogged };
      }
      case 'edit_today': {
        // Coach v3: every step's own Undo, last first, all or nothing (`revert_coach_edit`), only in the workout it was
        // made in. Target changes come back on sets still pending; a set logged since stays as it is (rule 2).
        if (d.command === null) return 'unsupported';
        const agg = await readAggregate(tx, d.sessionId);
        if (agg === null || agg.session.ownerId !== ownerId || agg.session.status !== 'active') return 'changed_since';
        const r = reduceSession(agg, { type: 'revert_coach_edit', at: { utc: atUtc, tz: target.createdAt.tz }, opId: `undo:${target.actionId}`, targetOpId: d.command.opId, actionId: d.command.actionId });
        if (!r.ok && r.error.code === 'gym_changed') return 'gym_changed';
        if (!r.ok || r.duplicate) return 'changed_since';
        if (r.state !== agg) await writeAggregate(tx, r.state);
        const now = new Map(r.state.sets.map((x) => [x.id, x]));
        const was = new Map(agg.sets.map((x) => [x.id, x]));
        const actionId = d.command.actionId;
        const restored: ExerciseTargetChanges[] = d.exercises
          .map((e) => ({
            ...e,
            changes: e.changes.filter((c) => c.before !== null && c.after !== null && was.get(c.setId)?.status === 'pending' && now.get(c.setId)?.planned.coach?.actionId !== actionId).map((c) => ({ ...c, before: c.after, after: c.before })),
          }))
          .filter((e) => e.changes.length > 0)
          .slice(0, 12);
        const alreadyLogged = d.exercises.flatMap((e) => e.changes).filter((c) => now.get(c.setId)?.status === 'completed').map((c) => c.setNumber).slice(0, 40);
        return { restored, alreadyLogged };
      }
      case 'log_set':
      case 'correct_set': {
        // The workout's own guards (11 Oct, coach tools): a log comes back with `undo_log` (the set's version, still the
        // latest commit); a correction with one more `correct_set` to the values before. Only in the workout it was made in.
        const agg = await readAggregate(tx, d.sessionId);
        if (agg === null || agg.session.ownerId !== ownerId || agg.session.status !== 'active') return 'changed_since';
        const command = chatSetUndoCommand(d, { opId: `undo:${target.actionId}`, at: { utc: atUtc, tz: target.createdAt.tz } });
        if (command === null) return 'unsupported';
        const r = reduceSession(agg, command);
        if (!r.ok || r.duplicate) return 'changed_since';
        await writeAggregate(tx, r.state);
        return 'ok';
      }
      case 'add_exercise_today': {
        // (12 Oct) The added row comes out with the workout's own `undo_op` on the add, only in the workout it was
        // added to and while none of its sets is logged or skipped (rule 2); the reducer refuses it otherwise.
        const agg = await readAggregate(tx, d.sessionId);
        if (agg === null || agg.session.ownerId !== ownerId || agg.session.status !== 'active') return 'changed_since';
        const r = reduceSession(agg, { type: 'undo_op', at: { utc: atUtc, tz: target.createdAt.tz }, opId: `undo:${target.actionId}`, targetOpId: target.opId });
        if (!r.ok || r.duplicate) return 'changed_since';
        await writeAggregate(tx, r.state);
        return 'ok';
      }
      case 'rename_workout': {
        // (14 Oct) Named back with the workout's own `rename_session`, only while the name is still the coach's.
        const agg = await readAggregate(tx, d.sessionId);
        if (agg === null || agg.session.ownerId !== ownerId || agg.session.routineName !== d.after) return 'changed_since';
        const r = reduceSession(agg, { type: 'rename_session', at: { utc: atUtc, tz: target.createdAt.tz }, opId: `undo:${target.actionId}`, name: d.before, expectedVersion: agg.session.version });
        if (!r.ok) return 'unsupported';
        if (r.duplicate) return 'changed_since';
        await writeAggregate(tx, r.state);
        return 'ok';
      }
      case 'set_next_session_targets': {
        const rows = await listDocuments(tx, NEXT_TARGET_SPEC, 'action_id = ?', [target.actionId]);
        let undone = 0;
        for (const row of rows) {
          if (row.ownerId !== ownerId || (await startedFrom(tx, ownerId, row.sourceSessionId)) !== null) continue;
          if (row.status !== 'saved' && row.status !== 'applied') continue;
          await saveDocumentIn(tx, NEXT_TARGET_SPEC, { ...row, status: row.status === 'saved' ? ('undone' as const) : ('proposed' as const), version: row.version + 1, updatedAtUtc: atUtc }, row.version);
          undone += 1;
        }
        return undone > 0 ? 'ok' : 'changed_since';
      }
      case 'propose_next_workout_change': {
        // Only Ben's Apply is undoable (a proposal itself was never applied), until a workout starts from its basis.
        if (d.proposalId === undefined || d.basis === undefined) return 'unsupported';
        return (await basisStartedSince(tx, ownerId, d.basis, target.createdAt.utc)) ? 'changed_since' : 'ok';
      }
      // A suggestion was never applied (Ben's Not now, or Forget after Save, are the ways back). Ben's routine change from
      // today's edits has its own Undo (`routines.undoTemplateSwap`), version-checked against the routine.
      // The coach's fit to time has its own Undo (`drafts.undoCoachFit`), versioned on the draft.
      // A draft version's Undo is Ben's draft write (`workout_drafts`), not a coach undo (workout-builder §5.3).
      case 'suggest_memory':
      case 'update_routine':
      case 'fit_today':
      case 'build_workout':
      case 'build_question':
      case 'undo':
        return 'unsupported';
    }
  }

  // ---------- Next-session targets (D21) ----------

  /** The rows for one finished workout (the Summary's `Next time`, `nextTargetsOf`). */
  listNextTargets(ownerId: string, sourceSessionId: string): Promise<NextSessionTargetRecord[]> {
    return this.db.read(async (q) => {
      const rows = await listDocuments(q, NEXT_TARGET_SPEC, 'owner_id = ? AND source_session_id = ?', [ownerId, sourceSessionId]);
      if (rows.length === 0) return rows;
      const usedBy = await startedFrom(q, ownerId, sourceSessionId);
      return rows.map((r) => withUse(r, usedBy));
    });
  }

  getNextTarget(id: string): Promise<NextSessionTargetRecord | null> {
    return this.db.read(async (q) => {
      const row = await getDoc(q, NEXT_TARGET_SPEC, id);
      return row === null ? null : withUse(row, await startedFrom(q, row.ownerId, row.sourceSessionId));
    });
  }

  /**
   * Ben's tap on one row: Undo, `Use coach target`, Apply or Not now. The
   * row's new status and the record of the tap are saved together;
   * idempotent on the record's opId; refused once a workout has started from
   * the source (the target was used) or when the row moved on.
   */
  setNextTargetStatus(ownerId: string, input: NextTargetStatusWrite): Promise<NextTargetStatusResult> {
    return this.db.write((tx) => this.nextTargetStatusIn(tx, ownerId, input));
  }

  /**
   * Several row taps as one write (the Summary's `Undo all` once the coach's
   * record is already undone): all are saved, or none (review S3). Each tap
   * is idempotent on its own opId, so a repeat replays. A refusal names the
   * first row that couldn't move; nothing is written then.
   */
  setNextTargetStatuses(ownerId: string, inputs: readonly NextTargetStatusWrite[]): Promise<{ status: 'written' | 'replayed'; rows: NextSessionTargetRecord[] } | ({ status: 'not_possible'; rowId: string } & Extract<NextTargetStatusResult, { status: 'not_possible' }>)> {
    const refused = new Error('next-target batch refused');
    let refusal: { status: 'not_possible'; rowId: string; reason: 'missing' | 'changed_since' | 'used' } | null = null;
    return this.db
      .write(async (tx) => {
        const rows: NextSessionTargetRecord[] = [];
        let wrote = false;
        for (const input of inputs) {
          const r = await this.nextTargetStatusIn(tx, ownerId, input);
          if (r.status === 'not_possible') {
            refusal = { status: 'not_possible', rowId: input.rowId, reason: r.reason };
            // Roll back the rows already written in this transaction.
            throw refused;
          }
          if (r.status === 'written') wrote = true;
          rows.push(r.row);
        }
        return { status: wrote ? ('written' as const) : ('replayed' as const), rows };
      })
      .catch((e: unknown) => {
        if (e === refused && refusal !== null) return refusal;
        throw e;
      });
  }

  private async nextTargetStatusIn(tx: SqlExecutor, ownerId: string, input: NextTargetStatusWrite): Promise<NextTargetStatusResult> {
    const prior = await actionByOp(tx, ownerId, input.record.opId);
    const row = await getDoc(tx, NEXT_TARGET_SPEC, input.rowId);
    if (row === null || row.ownerId !== ownerId) return { status: 'not_possible', reason: 'missing' };
    const usedBy = await startedFrom(tx, ownerId, row.sourceSessionId);
    if (prior !== null) return { status: 'replayed', row: withUse(row, usedBy) };
    // Used only by a workout started from this source that still exists (review S2, S3).
    if (usedBy !== null) return { status: 'not_possible', reason: 'used' };
    if (row.version !== input.expectedVersion || !NEXT_TARGET_MOVES[row.status].includes(input.status)) return { status: 'not_possible', reason: 'changed_since' };
    const source = await readAggregate(tx, row.sourceSessionId);
    if (source === null) return { status: 'not_possible', reason: 'missing' };
    const next = { ...row, status: input.status, usedBySessionId: null, version: row.version + 1, updatedAtUtc: input.record.createdAt.utc };
    await saveDocumentIn(tx, NEXT_TARGET_SPEC, next, row.version);
    await insertAction(tx, ownerId, input.record);
    return { status: 'written', row: next };
  }

  /**
   * Note that the workout with this start opId is being started from
   * `sourceSessionId`, before the start is written (review S2, S3). The
   * source's targets count as used only while that session exists and isn't
   * discarded, so a force-close before the start, a failed start or a
   * discard leaves them unused. Idempotent on the opId.
   */
  noteStartFrom(ownerId: string, sourceSessionId: string, startOpId: string, atUtc: string): Promise<void> {
    return this.db.write(async (tx) => {
      await tx.run('INSERT OR IGNORE INTO next_target_uses (owner_id, start_op_id, source_session_id, created_at_utc) VALUES (?, ?, ?, ?)', [ownerId, startOpId, sourceSessionId, atUtc]);
    });
  }

  // ---------- Offers (CA4) ----------

  /** Offers shown during one workout (CA4: once per exercise row and kind; survives a relaunch, review S6). */
  listOffers(sessionId: string): Promise<{ sessionExerciseId: string; kind: string; atVersion: number }[]> {
    return this.db.read(async (q) =>
      (await q.getAll<{ session_exercise_id: string; kind: string; at_version: number }>('SELECT session_exercise_id, kind, at_version FROM coach_offers WHERE session_id = ? ORDER BY created_at_utc, session_exercise_id, kind', [sessionId])).map((r) => ({
        sessionExerciseId: r.session_exercise_id,
        kind: r.kind,
        atVersion: r.at_version,
      })),
    );
  }

  /** Record an offer as shown; a later one for the same row and kind (after an adjustment) replaces it. */
  recordOffer(ownerId: string, input: { sessionId: string; sessionExerciseId: string; kind: string; atVersion: number; atUtc: string }): Promise<void> {
    return this.db.write(async (tx) => {
      await tx.run('INSERT OR REPLACE INTO coach_offers (owner_id, session_id, session_exercise_id, kind, at_version, created_at_utc) VALUES (?, ?, ?, ?, ?, ?)', [ownerId, input.sessionId, input.sessionExerciseId, input.kind, input.atVersion, input.atUtc]);
    });
  }

  // ---------- Structural proposals (ADR 0020 §3) ----------

  /** Every structural proposal and Ben's taps on them (Apply, Not now), oldest first. A small list. */
  listStructural(ownerId: string): Promise<ActionRecord[]> {
    return this.db.read(async (q) => (await q.getAll("SELECT * FROM coach_actions WHERE owner_id = ? AND kind = 'propose_next_workout_change' ORDER BY created_at_utc, id", [ownerId])).map(decodeAction));
  }

  /**
   * Ben's Apply or Not now on a structural proposal, checked and saved in one
   * transaction (rule 5): the proposal must still be a live suggestion (no
   * earlier tap), no workout may have started from its basis since it was
   * made, and a routine must still be at the version it was proposed
   * against. Idempotent on the tap's opId. A refusal writes nothing.
   */
  commitStructuralTap(ownerId: string, tap: ActionRecord): Promise<CoachWriteResult> {
    const d = tap.detail;
    if (d.kind !== 'propose_next_workout_change' || d.proposalId === undefined || d.basis === undefined) throw new TypeError('commitStructuralTap takes a tap on a structural proposal');
    const proposalId = d.proposalId;
    const basis = d.basis;
    return this.db
      .write(async (tx): Promise<CoachWriteResult> => {
        const prior = await actionByOp(tx, ownerId, tap.opId);
        if (prior !== null) return { status: 'replayed', action: prior };
        const proposal = await actionById(tx, proposalId);
        if (proposal === null || proposal.ownerId !== ownerId || proposal.record.status !== 'proposed') throw new Rollback('missing');
        const earlier = (await tx.getAll("SELECT * FROM coach_actions WHERE owner_id = ? AND kind = 'propose_next_workout_change'", [ownerId]))
          .map(decodeAction)
          .filter((r) => r.detail.kind === 'propose_next_workout_change' && r.detail.proposalId === proposalId);
        if (earlier.length > 0) throw new Rollback('already_exists');
        if (await basisStartedSince(tx, ownerId, basis, proposal.record.createdAt.utc)) throw new Rollback('stale_version');
        const pd = proposal.record.detail;
        if (basis.kind === 'routine' && pd.kind === 'propose_next_workout_change' && pd.basisVersion !== undefined) {
          const routine = await tx.getFirst<{ version: number }>('SELECT version FROM routines WHERE id = ?', [basis.routineId]);
          if (routine === null || routine.version !== pd.basisVersion) throw new Rollback('stale_version');
        }
        await insertAction(tx, ownerId, tap);
        return { status: 'written', action: tap };
      })
      .catch((e: unknown) => {
        if (e instanceof Rollback) return { status: 'conflict', reason: e.reason };
        throw e;
      });
  }

  basisStartedSince(ownerId: string, basis: DraftBasis, sinceUtc: string): Promise<boolean> {
    return this.db.read((q) => basisStartedSince(q, ownerId, basis, sinceUtc));
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

  /**
   * Ben's Save or Not now on a coach suggestion (coach-memory §2.4, CM2):
   * versioned (rule 5). Save makes it a confirmed memory, refused when the
   * same text is already saved; Not now keeps it as `not_saved`. `closedAs:
   * 'playbook'` records that Ben sent it to the playbook instead (CM9).
   */
  decideMemory(ownerId: string, req: { memoryId: string; expectedVersion: number; decision: 'save' | 'not_now'; atUtc: string; closedAs?: 'playbook' }): Promise<MemoryWrite> {
    return this.db.write(async (tx): Promise<MemoryWrite> => {
      const m = await getDoc(tx, MEMORY_SPEC, req.memoryId);
      if (m === null || m.ownerId !== ownerId) return { status: 'missing' };
      const target = req.decision === 'save' ? ('active' as const) : ('not_saved' as const);
      // A double tap: already where it was asked to go.
      if (m.status === target && m.version === req.expectedVersion + 1) return { status: 'written', memory: m };
      if (m.version !== req.expectedVersion || m.status !== 'suggested') return { status: 'stale', memory: m };
      if (target === 'active') {
        const clash = await tx.getFirst("SELECT id FROM memories WHERE owner_id = ? AND content_key = ? AND status = 'active'", [ownerId, m.contentKey]);
        if (clash !== null) return { status: 'duplicate', memory: m };
      }
      const next: Memory = { ...m, status: target, version: m.version + 1, updatedAtUtc: req.atUtc, ...(target === 'not_saved' && req.closedAs !== undefined ? { closedAs: req.closedAs } : {}) };
      await saveDocumentIn(tx, MEMORY_SPEC, next, m.version);
      return { status: 'written', memory: next };
    });
  }

  /**
   * Ben's edit of a confirmed memory (coach-memory §2.2): new text and key,
   * the earlier text kept in `edits`. Versioned; refused when another saved
   * memory already says the same.
   */
  editMemory(ownerId: string, req: { memoryId: string; expectedVersion: number; text: string; contentKey: string; atUtc: string }): Promise<MemoryWrite> {
    return this.db.write(async (tx): Promise<MemoryWrite> => {
      const m = await getDoc(tx, MEMORY_SPEC, req.memoryId);
      if (m === null || m.ownerId !== ownerId) return { status: 'missing' };
      if (m.version === req.expectedVersion + 1 && m.text === req.text) return { status: 'written', memory: m };
      if (m.version !== req.expectedVersion || m.status !== 'active') return { status: 'stale', memory: m };
      if (m.text === req.text) return { status: 'written', memory: m };
      const clash = await tx.getFirst("SELECT id FROM memories WHERE owner_id = ? AND content_key = ? AND status = 'active' AND id != ?", [ownerId, req.contentKey, m.id]);
      if (clash !== null) return { status: 'duplicate', memory: m };
      const next: Memory = { ...m, text: req.text, contentKey: req.contentKey, edits: [...(m.edits ?? []), { before: m.text, atUtc: req.atUtc }].slice(-20), version: m.version + 1, updatedAtUtc: req.atUtc };
      await saveDocumentIn(tx, MEMORY_SPEC, next, m.version);
      return { status: 'written', memory: next };
    });
  }

  /** Coaching knowledge; never sent to the coach until approved. */
  listPlaybookCandidates(): Promise<PlaybookCandidate[]> {
    return this.db.read((q) => listDocuments(q, PLAYBOOK_CANDIDATE_SPEC));
  }

  /**
   * Ben's review of a chat rule (coaching-playbook §4.1, B8): Approve or
   * Reject a rule to review, or put an approved or rejected one back to
   * review (the toast's Undo, `Remove from playbook`, `Review again`).
   * Versioned (rule 5); a double tap is one write. Coaching knowledge: no owner.
   */
  decidePlaybookCandidate(req: { candidateId: string; expectedVersion: number; decision: 'approve' | 'reject' | 'reopen'; atUtc: string }): Promise<CandidateWrite> {
    return this.db.write(async (tx): Promise<CandidateWrite> => {
      const c = await getDoc(tx, PLAYBOOK_CANDIDATE_SPEC, req.candidateId);
      if (c === null || c.status === 'withdrawn') return { status: 'missing' };
      const target = req.decision === 'approve' ? ('approved' as const) : req.decision === 'reject' ? ('rejected' as const) : ('to_review' as const);
      if (c.status === target && c.version === req.expectedVersion + 1) return { status: 'written', candidate: c };
      const from = req.decision === 'reopen' ? c.status === 'approved' || c.status === 'rejected' : c.status === 'to_review';
      if (c.version !== req.expectedVersion || !from) return { status: 'stale', candidate: c };
      if (target === 'to_review') {
        const clash = await tx.getFirst("SELECT id FROM playbook_candidates WHERE content_key = ? AND status = 'to_review'", [c.contentKey]);
        if (clash !== null) return { status: 'stale', candidate: c };
      }
      const next: PlaybookCandidate = { ...c, status: target, version: c.version + 1, updatedAtUtc: req.atUtc, ...(target === 'to_review' ? {} : { decidedAtUtc: req.atUtc }) };
      await saveDocumentIn(tx, PLAYBOOK_CANDIDATE_SPEC, next, c.version);
      return { status: 'written', candidate: next };
    });
  }
}

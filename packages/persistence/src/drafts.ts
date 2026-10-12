import { PreStartDraftSchema, type ActionRecord, type DraftBasis, type PreStartDraft, type Routine, type ZonedTimestamp } from '@fizz/schemas';
import { applyDraftCommand, draftBasisKey, markDraftEdits, type SaveResult } from '@fizz/domain';
import type { Database } from './database';
import { actionById, actionByOp, insertAction, updateAction } from './coach';
import { decodeDocument, DocumentRepository, erase, ROUTINE_SPEC, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor } from './driver';

/**
 * Pre-start drafts (ADR 0022, migration 7): today's edits before a workout
 * exists. Your data, owner-scoped; never in coach context (rule 10). Every
 * write is versioned; the domain (`applyDraftCommand`) makes the change and
 * this stores it. A session created by any path closes them (`sessions.ts`).
 */

export const DRAFT_SPEC: DocumentSpec<PreStartDraft> = {
  table: 'pre_start_drafts',
  schema: PreStartDraftSchema,
  columns: (d) => ({ owner_id: d.ownerId, basis_key: draftBasisKey(d.basis), status: d.status, expires_at_utc: d.expiresAtUtc }),
};

export const DRAFT_DOCUMENT_TABLES: readonly DocumentTable[] = [erase(DRAFT_SPEC)];

export type DraftSave = SaveResult;

/** `Change Push A too ›` → Apply: what was written, or why nothing was. */
export type RoutineChangeResult =
  | { status: 'written' | 'replayed'; action: ActionRecord; routine: Routine; draft: PreStartDraft | null }
  | { status: 'stale'; routine: Routine | null }
  | { status: 'missing' };

export type RoutineChangeUndo =
  | { status: 'written' | 'replayed'; undo: ActionRecord; routine: Routine; draft: PreStartDraft | null }
  | { status: 'not_possible'; reason: 'missing' | 'already_undone' | 'changed_since' };

async function getDraft(q: SqlExecutor, id: string): Promise<PreStartDraft | null> {
  const row = await q.getFirst('SELECT * FROM pre_start_drafts WHERE id = ?', [id]);
  return row ? decodeDocument(DRAFT_SPEC, row) : null;
}

async function getRoutine(q: SqlExecutor, id: string): Promise<Routine | null> {
  const row = await q.getFirst('SELECT * FROM routines WHERE id = ?', [id]);
  return row ? decodeDocument(ROUTINE_SPEC, row) : null;
}

export class SqliteDrafts extends DocumentRepository<PreStartDraft> {
  constructor(db: Database) {
    super(db, DRAFT_SPEC);
  }

  /** The open draft for one basis (its midnight may have passed: the caller checks the time). */
  async open(ownerId: string, basis: DraftBasis): Promise<PreStartDraft | null> {
    const rows = await this.listWhere("owner_id = ? AND basis_key = ? AND status = 'open'", [ownerId, draftBasisKey(basis)]);
    return rows[0] ?? null;
  }

  /** Every draft for one basis, open or closed (a coach Apply reads which of its edits Ben took back, review S5). */
  listForBasis(ownerId: string, basis: DraftBasis): Promise<PreStartDraft[]> {
    return this.listWhere('owner_id = ? AND basis_key = ?', [ownerId, draftBasisKey(basis)]);
  }

  listByOwner(ownerId: string): Promise<PreStartDraft[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }

  /**
   * Close every open draft whose local midnight has passed (TE5): `expired`,
   * versioned. Returns the drafts it closed, so the page can say `Earlier
   * edits cleared` once for one that had edits.
   */
  expire(ownerId: string, nowUtc: string): Promise<PreStartDraft[]> {
    return this.db.write(async (tx) => {
      const rows = await tx.getAll("SELECT * FROM pre_start_drafts WHERE owner_id = ? AND status = 'open' AND expires_at_utc <= ?", [ownerId, nowUtc]);
      const closed: PreStartDraft[] = [];
      for (const row of rows) {
        const d = decodeDocument(DRAFT_SPEC, row);
        const next: PreStartDraft = { ...d, status: 'expired', version: d.version + 1, updatedAt: { utc: nowUtc, tz: d.tz }, updatedAtUtc: nowUtc };
        const r = await saveDocumentIn(tx, DRAFT_SPEC, next, d.version);
        if (r.ok) closed.push(next);
      }
      return closed;
    });
  }

  /**
   * Save one draft write. A second open draft for the same basis (another
   * write raced this create) is a conflict, never an error.
   */
  override save(draft: PreStartDraft, expectedVersion: number | null): Promise<SaveResult> {
    return this.db.write(async (tx) => {
      if (expectedVersion === null) {
        const clash = await tx.getFirst<{ version: number }>("SELECT version FROM pre_start_drafts WHERE owner_id = ? AND basis_key = ? AND status = 'open'", [draft.ownerId, draftBasisKey(draft.basis)]);
        if (clash !== null) return { ok: false, error: 'conflict', currentVersion: clash.version };
      }
      return saveDocumentIn(tx, DRAFT_SPEC, draft, expectedVersion);
    });
  }

  /**
   * `Change Push A too ›` → Apply (TE4, ADR 0022): in one transaction, the
   * routine at its next version, Ben's `ActionRecord` (`update_routine`), and
   * the draft's swap edit marked `redundant` (the template now matches).
   * Idempotent on the record's `opId`; a routine that moved since the card
   * was shown is `stale` and nothing is written (rule 5).
   */
  applyRoutineChange(req: { ownerId: string; routine: Routine; expectedRoutineVersion: number; action: ActionRecord; at: ZonedTimestamp }): Promise<RoutineChangeResult> {
    return this.db.write(async (tx): Promise<RoutineChangeResult> => {
      const prior = await actionByOp(tx, req.ownerId, req.action.opId);
      if (prior !== null) {
        const routine = await getRoutine(tx, req.routine.id);
        if (routine === null) return { status: 'missing' };
        const d = prior.detail.kind === 'update_routine' ? prior.detail.draft : null;
        return { status: 'replayed', action: prior, routine, draft: d === null ? null : await getDraft(tx, d.id) };
      }
      const current = await getRoutine(tx, req.routine.id);
      if (current === null || current.ownerId !== req.ownerId) return { status: 'missing' };
      if (current.version !== req.expectedRoutineVersion || req.routine.version !== current.version + 1) return { status: 'stale', routine: current };
      const saved = await saveDocumentIn(tx, ROUTINE_SPEC, req.routine, current.version);
      if (!saved.ok) return { status: 'stale', routine: current };
      await insertAction(tx, req.ownerId, req.action);
      let draft: PreStartDraft | null = null;
      const link = req.action.detail.kind === 'update_routine' ? req.action.detail.draft : null;
      if (link !== null) {
        const d = await getDraft(tx, link.id);
        const next = d === null || d.status !== 'open' ? null : markDraftEdits(d, [link.editId], 'redundant', req.action.opId, req.at);
        if (d !== null && next !== null) {
          const r = await saveDocumentIn(tx, DRAFT_SPEC, next, d.version);
          if (!r.ok) throw new Error('The draft changed while the routine was being changed');
          draft = next;
        } else draft = d;
      }
      return { status: 'written', action: req.action, routine: req.routine, draft };
    });
  }

  /**
   * Undo of `Change Push A too ›` (TE4): the routine slot goes back exactly
   * as it was, if the routine is still at the version Apply produced, and
   * the draft's swap edit comes back (a new copy) while that draft is open
   * and the slot has no newer swap of Ben's.
   * Otherwise nothing changes (`changed_since`: `Can't undo: Push A changed
   * since.`). The undo is its own `ActionRecord` (author `ben`), written with
   * the original's `undoneBy` in the same transaction; idempotent on its opId.
   */
  undoRoutineChange(req: { ownerId: string; undo: ActionRecord; at: ZonedTimestamp; newRoutineAtUtc: string }): Promise<RoutineChangeUndo> {
    if (req.undo.detail.kind !== 'undo') throw new TypeError('undoRoutineChange() takes an undo record');
    const targetId = req.undo.detail.undoneActionId;
    return this.db.write(async (tx): Promise<RoutineChangeUndo> => {
      const prior = await actionByOp(tx, req.ownerId, req.undo.opId);
      const target = await actionById(tx, targetId);
      if (target === null || target.ownerId !== req.ownerId || target.record.detail.kind !== 'update_routine') return { status: 'not_possible', reason: 'missing' };
      const d = target.record.detail;
      if (prior !== null) {
        const routine = await getRoutine(tx, d.routineId);
        if (routine === null) return { status: 'not_possible', reason: 'missing' };
        return { status: 'replayed', undo: prior, routine, draft: d.draft === null ? null : await getDraft(tx, d.draft.id) };
      }
      if (target.record.undoneBy !== null) return { status: 'not_possible', reason: 'already_undone' };
      const routine = await getRoutine(tx, d.routineId);
      if (routine === null || routine.ownerId !== req.ownerId) return { status: 'not_possible', reason: 'missing' };
      if (routine.version !== d.versionAfter) return { status: 'not_possible', reason: 'changed_since' };
      const at = routine.exercises.findIndex((x) => x.id === d.slot.after.id);
      if (at < 0) return { status: 'not_possible', reason: 'changed_since' };
      const exercises = routine.exercises.map((x, i) => (i === at ? { ...d.slot.before, order: x.order } : x));
      const back: Routine = { ...routine, exercises, version: routine.version + 1, updatedAtUtc: req.newRoutineAtUtc, lastOpId: req.undo.opId };
      const saved = await saveDocumentIn(tx, ROUTINE_SPEC, back, routine.version);
      if (!saved.ok) return { status: 'not_possible', reason: 'changed_since' };
      let draft: PreStartDraft | null = null;
      if (d.draft !== null) {
        const current = await getDraft(tx, d.draft.id);
        if (current !== null && current.status === 'open' && current.expiresAtUtc > req.at.utc) {
          const change = applyDraftCommand({
            current,
            expectedVersion: current.version,
            opId: req.undo.opId,
            at: req.at,
            ownerId: req.ownerId,
            basis: current.basis,
            newDraftId: current.id,
            slots: [],
            // A newer swap Ben made on that slot since stays: his later choice is never replaced without a word (review S4).
            command: { type: 'restore', editIds: [d.draft.editId], keepLive: true },
          });
          if (change.kind === 'write') {
            const r = await saveDocumentIn(tx, DRAFT_SPEC, change.next, current.version);
            if (!r.ok) throw new Error('The draft changed while the routine change was being undone');
            draft = change.next;
          } else draft = current;
        }
      }
      const updated: ActionRecord = { ...target.record, undoneBy: { actionId: req.undo.actionId, atUtc: req.at.utc } };
      if (!(await updateAction(tx, updated, target.version, req.at.utc))) throw new Error(`Action ${targetId} changed while it was being undone`);
      await insertAction(tx, req.ownerId, req.undo);
      return { status: 'written', undo: req.undo, routine: back, draft };
    });
  }
}

/**
 * After a restore (ADR 0022 §5): every open draft becomes `discarded`, so a
 * restored phone never starts from an old draft. A database from before
 * migration 7 has no drafts table: nothing to do.
 */
export function discardOpenDrafts(db: Database, atUtc: string | null = null): Promise<number> {
  return db.write(async (tx) => {
    const table = await tx.getFirst("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pre_start_drafts'");
    if (table === null) return 0;
    const r = await tx.run(
      `UPDATE pre_start_drafts SET status = 'discarded', version = version + 1,
         updated_at_utc = coalesce(?, updated_at_utc),
         data = json_set(data, '$.status', 'discarded', '$.version', version + 1, '$.updatedAtUtc', coalesce(?, updated_at_utc), '$.updatedAt.utc', coalesce(?, updated_at_utc))
       WHERE status = 'open'`,
      [atUtc, atUtc, atUtc],
    );
    return r.changes;
  });
}

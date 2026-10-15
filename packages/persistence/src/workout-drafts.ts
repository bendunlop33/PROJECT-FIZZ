import { WorkoutDraftSchema, type WorkoutDraft } from '@fizz/schemas';
import { expireWorkoutDraft, type DraftLifeChange, type SaveResult } from '@fizz/domain';
import type { Database } from './database';
import { decodeDocument, DocumentRepository, erase, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor } from './driver';

/**
 * Coach-built workout drafts (workout-builder.md §8.2, migration 13). Your
 * data, owner-scoped. The coach's own write (a new draft or version) goes
 * through the coach store with its `ActionRecord` in one transaction
 * (`CoachWrite` kind `workout_draft`); Ben's taps (Undo a version, Discard,
 * its Undo, the save link) come here as versioned writes the domain made
 * (`DraftLifeChange`). A Start closes the draft in the session's own
 * transaction (`sessions.ts`).
 */

export const WORKOUT_DRAFT_SPEC: DocumentSpec<WorkoutDraft> = {
  table: 'workout_drafts',
  schema: WorkoutDraftSchema,
  columns: (d) => ({ owner_id: d.ownerId, status: d.status, expires_at_utc: d.expiresAtUtc }),
};

export const WORKOUT_DRAFT_DOCUMENT_TABLES: readonly DocumentTable[] = [erase(WORKOUT_DRAFT_SPEC)];

export async function getWorkoutDraftIn(q: SqlExecutor, id: string): Promise<WorkoutDraft | null> {
  const row = await q.getFirst('SELECT * FROM workout_drafts WHERE id = ?', [id]);
  return row ? decodeDocument(WORKOUT_DRAFT_SPEC, row) : null;
}

/** What a Ben write did. */
export type WorkoutDraftWrite =
  | { status: 'written' | 'replayed'; draft: WorkoutDraft }
  | { status: 'stale' | 'closed'; draft: WorkoutDraft }
  | { status: 'missing' }
  | { status: 'invalid'; reason: string };

export class SqliteWorkoutDrafts extends DocumentRepository<WorkoutDraft> {
  constructor(db: Database) {
    super(db, WORKOUT_DRAFT_SPEC);
  }

  listByOwner(ownerId: string): Promise<WorkoutDraft[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }

  /**
   * One of Ben's draft writes, decided inside the transaction against the
   * draft as stored (rule 5): `change` gets the current draft and returns
   * the domain's `DraftLifeChange`. A repeated op ID is `replayed`.
   */
  write(ownerId: string, id: string, change: (current: WorkoutDraft) => DraftLifeChange): Promise<WorkoutDraftWrite> {
    return this.db.write(async (tx): Promise<WorkoutDraftWrite> => {
      const current = await getWorkoutDraftIn(tx, id);
      if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
      const c = change(current);
      switch (c.kind) {
        case 'duplicate':
          return { status: 'replayed', draft: c.current };
        case 'stale':
          return { status: 'stale', draft: c.current };
        case 'closed':
          return { status: 'closed', draft: c.current };
        case 'invalid':
          return { status: 'invalid', reason: c.reason };
        case 'write': {
          const r: SaveResult = await saveDocumentIn(tx, WORKOUT_DRAFT_SPEC, c.next, c.expectedVersion);
          if (!r.ok) return { status: 'stale', draft: current };
          return { status: 'written', draft: c.next };
        }
      }
    });
  }

  /**
   * The 14-day expiry (BD4), run on launch and on read: every open or
   * discarded draft past `expiresAtUtc` becomes `expired`, versioned.
   * Returns the drafts it closed.
   */
  expire(ownerId: string, nowUtc: string): Promise<WorkoutDraft[]> {
    return this.db.write(async (tx) => {
      const rows = await tx.getAll("SELECT * FROM workout_drafts WHERE owner_id = ? AND status IN ('open', 'discarded') AND expires_at_utc <= ?", [ownerId, nowUtc]);
      const closed: WorkoutDraft[] = [];
      for (const row of rows) {
        const d = decodeDocument(WORKOUT_DRAFT_SPEC, row);
        const next = expireWorkoutDraft(d, nowUtc);
        if (next === null) continue;
        const r = await saveDocumentIn(tx, WORKOUT_DRAFT_SPEC, next, d.version);
        if (r.ok) closed.push(next);
      }
      return closed;
    });
  }
}

/**
 * Inside a session's create transaction (§6.3): the coach draft a workout
 * starts from becomes `started` with the session's ID. False (nothing
 * written): it isn't open any more, or its 14 days are over by the start.
 * The overview's fence already pinned its version (OV4).
 */
export async function startWorkoutDraftIn(tx: SqlExecutor, draftId: string, ownerId: string, sessionId: string, atUtc: string): Promise<boolean> {
  const d = await getWorkoutDraftIn(tx, draftId);
  if (d === null || d.ownerId !== ownerId || d.status !== 'open' || d.expiresAtUtc <= atUtc) return false;
  const next: WorkoutDraft = { ...d, status: 'started', sessionId, startedAtUtc: atUtc, version: d.version + 1, updatedAtUtc: atUtc };
  const r = await saveDocumentIn(tx, WORKOUT_DRAFT_SPEC, next, d.version);
  return r.ok;
}

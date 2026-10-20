import { WorkoutDraftSchema, type BuilderDraftKey, type WorkoutDraft } from '@fizz/schemas';
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

/** SQL over `workout_drafts` matching the unique index `workout_drafts_open_builder` (migration 30): the open builder draft with this key. */
const OPEN_BUILDER_SQL =
  "status = 'open' AND json_extract(data, '$.builderKey') IS NOT NULL AND coalesce(json_extract(data, '$.builderKey.planId'), '-') = ? AND coalesce(json_extract(data, '$.builderKey.splitDayId'), '-') = ? AND coalesce(json_extract(data, '$.builderKey.mainLiftExerciseId'), '-') = ? AND json_extract(data, '$.builderKey.localDate') = ?";
const builderKeyParams = (k: BuilderDraftKey): string[] => [k.planId ?? '-', k.splitDayId ?? '-', k.mainLiftExerciseId ?? '-', k.localDate];

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

/** Creating a builder draft: the new one, a retry of it, or the open one that already holds the key (resume it). */
export type BuilderDraftCreate =
  | { status: 'written' | 'replayed'; draft: WorkoutDraft }
  | { status: 'exists'; draft: WorkoutDraft }
  | { status: 'invalid'; reason: string };

export class SqliteWorkoutDrafts extends DocumentRepository<WorkoutDraft> {
  constructor(db: Database) {
    super(db, WORKOUT_DRAFT_SPEC);
  }

  /** (v3 §4.4) The open builder draft for this key, resumed on reopen. */
  async openBuilderDraft(ownerId: string, key: BuilderDraftKey): Promise<WorkoutDraft | null> {
    const rows = await this.listWhere(`owner_id = ? AND ${OPEN_BUILDER_SQL}`, [ownerId, ...builderKeyParams(key)]);
    return rows[0] ?? null;
  }

  /** (v3 §2.3 `Edits from Mon 19 Oct`) Open builder drafts from local dates before `localDate`. */
  async earlierOpenBuilderDrafts(ownerId: string, localDate: string): Promise<WorkoutDraft[]> {
    const rows = await this.listWhere("owner_id = ? AND status = 'open' AND json_extract(data, '$.builderKey') IS NOT NULL", [ownerId]);
    return rows.filter((d) => d.builderKey !== undefined && d.builderKey.localDate < localDate);
  }

  /**
   * (v3 §4.4) A new builder draft, decided inside one transaction: a retry
   * (same ID, an op ID it already holds) replays; when an open draft already
   * holds the key, nothing is written and that one is returned to resume.
   */
  createBuilderDraft(ownerId: string, draft: WorkoutDraft): Promise<BuilderDraftCreate> {
    if (draft.ownerId !== ownerId) return Promise.resolve({ status: 'invalid', reason: 'owner' });
    const key = draft.builderKey;
    if (key === undefined || draft.status !== 'open') return Promise.resolve({ status: 'invalid', reason: 'not an open builder draft' });
    return this.db.write(async (tx): Promise<BuilderDraftCreate> => {
      const same = await getWorkoutDraftIn(tx, draft.id);
      if (same !== null) {
        if (same.ownerId === ownerId && same.opIds.some((o) => draft.opIds.includes(o))) return { status: 'replayed', draft: same };
        return { status: 'invalid', reason: 'id taken' };
      }
      const holder = await tx.getFirst(`SELECT * FROM workout_drafts WHERE owner_id = ? AND ${OPEN_BUILDER_SQL}`, [ownerId, ...builderKeyParams(key)]);
      if (holder !== null) return { status: 'exists', draft: decodeDocument(WORKOUT_DRAFT_SPEC, holder) };
      const r = await saveDocumentIn(tx, WORKOUT_DRAFT_SPEC, draft, null);
      if (!r.ok) return { status: 'invalid', reason: 'conflict' };
      return { status: 'written', draft };
    });
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
 * written): it isn't open any more, or its 14 days are over by the start,
 * or (v3 §4.4) its current workout is empty: Start refuses an empty plan.
 * The overview's fence already pinned its version (OV4).
 */
export async function startWorkoutDraftIn(tx: SqlExecutor, draftId: string, ownerId: string, sessionId: string, atUtc: string): Promise<boolean> {
  const d = await getWorkoutDraftIn(tx, draftId);
  if (d === null || d.ownerId !== ownerId || d.status !== 'open' || d.expiresAtUtc <= atUtc) return false;
  const current = d.versions.find((v) => v.n === d.currentVersion);
  if (current === undefined || current.plan.slots.length === 0) return false;
  const next: WorkoutDraft = { ...d, status: 'started', sessionId, startedAtUtc: atUtc, version: d.version + 1, updatedAtUtc: atUtc };
  const r = await saveDocumentIn(tx, WORKOUT_DRAFT_SPEC, next, d.version);
  return r.ok;
}

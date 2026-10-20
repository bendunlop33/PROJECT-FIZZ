import { mainLiftKey, PLAN_DAY_LIMITS, PlanDayVariationSchema, REVIEW_LIMITS, ReviewSchema, reviewSubjectKey, type PlanDayVariation, type Review, type ReviewKind, type ReviewSubject } from '@fizz/schemas';
import type { Database } from './database';
import { decodeDocument, DocumentRepository, erase, listDocuments, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor } from './driver';

/**
 * Workout builder v3 records (migration 30): saved plan-day variations
 * (§4.3) and reviews (§6.1, §6.2). Both Your data, owner-scoped (rule 10),
 * in backups, exports and `Delete my data` like every Your-data table.
 *
 * Persistence only checks what must hold inside the write transaction
 * (rule 5: the version, a repeated op ID, the variation limit and one live
 * label per key, one current review per subject); the domain decides the
 * change itself.
 */

export const PLAN_DAY_VARIATION_SPEC: DocumentSpec<PlanDayVariation> = {
  table: 'plan_day_variations',
  schema: PlanDayVariationSchema,
  columns: (v) => ({ owner_id: v.ownerId, split_day_id: v.splitDayId, main_lift_key: mainLiftKey(v.mainLiftExerciseId), deleted: v.deletedAtUtc === null ? 0 : 1 }),
};

export const REVIEW_SPEC: DocumentSpec<Review> = {
  table: 'reviews',
  schema: ReviewSchema,
  columns: (r) => ({ owner_id: r.ownerId, kind: r.subject.kind, subject_key: reviewSubjectKey(r.subject), status: r.status }),
};

export const PLAN_DAY_DOCUMENT_TABLES: readonly DocumentTable[] = [erase(PLAN_DAY_VARIATION_SPEC), erase(REVIEW_SPEC)];

// ---------------------------------------------------------------------------
// Variations

/**
 * A variation write. `limit`: 5 live variations already hang off this (split
 * day, main lift) (Q10: `Limit reached`). `duplicate_label`: another live one
 * has the same label. `stale`: the version moved (rule 5).
 */
export type VariationWrite =
  | { status: 'written' | 'replayed'; variation: PlanDayVariation }
  | { status: 'stale'; variation: PlanDayVariation | null }
  | { status: 'limit' | 'duplicate_label' }
  | { status: 'invalid'; reason: string };

const labelKey = (label: string): string => label.trim().toLowerCase();

async function getVariationIn(q: SqlExecutor, id: string): Promise<PlanDayVariation | null> {
  const row = await q.getFirst('SELECT * FROM plan_day_variations WHERE id = ?', [id]);
  return row ? decodeDocument(PLAN_DAY_VARIATION_SPEC, row) : null;
}

/**
 * Save a variation inside a caller's transaction (so `Save as new variation`
 * and the session's create are one write under one op ID, §4.6). `opId` must
 * be in `next.opIds`; a retry with an op ID the stored one holds replays.
 */
export async function saveVariationIn(tx: SqlExecutor, ownerId: string, next: PlanDayVariation, expectedVersion: number | null, opId: string): Promise<VariationWrite> {
  if (next.ownerId !== ownerId) return { status: 'invalid', reason: 'owner' };
  if (!next.opIds.includes(opId)) return { status: 'invalid', reason: 'op ID not recorded' };
  const current = await getVariationIn(tx, next.id);
  if (current !== null && current.ownerId !== ownerId) return { status: 'invalid', reason: 'owner' };
  if (current?.opIds.includes(opId) === true) return { status: 'replayed', variation: current };
  if ((current?.version ?? null) !== expectedVersion) return { status: 'stale', variation: current };
  if (next.deletedAtUtc === null) {
    const live = await listDocuments(tx, PLAN_DAY_VARIATION_SPEC, 'owner_id = ? AND split_day_id = ? AND main_lift_key = ? AND deleted = 0 AND id <> ?', [ownerId, next.splitDayId, mainLiftKey(next.mainLiftExerciseId), next.id]);
    if (live.length >= PLAN_DAY_LIMITS.maxVariations) return { status: 'limit' };
    if (live.some((v) => labelKey(v.label) === labelKey(next.label))) return { status: 'duplicate_label' };
  }
  const r = await saveDocumentIn(tx, PLAN_DAY_VARIATION_SPEC, next, expectedVersion);
  return r.ok ? { status: 'written', variation: next } : { status: 'stale', variation: await getVariationIn(tx, next.id) };
}

export class SqlitePlanDayVariations extends DocumentRepository<PlanDayVariation> {
  constructor(db: Database) {
    super(db, PLAN_DAY_VARIATION_SPEC);
  }

  /** Live variations of a (split day, main lift), oldest first: the same for every plan (§4.3). */
  async listFor(ownerId: string, splitDayId: string, mainLiftExerciseId: string | null): Promise<PlanDayVariation[]> {
    const rows = await this.listWhere('owner_id = ? AND split_day_id = ? AND main_lift_key = ? AND deleted = 0', [ownerId, splitDayId, mainLiftKey(mainLiftExerciseId)]);
    return rows.sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? -1 : a.createdAtUtc > b.createdAtUtc ? 1 : a.id < b.id ? -1 : 1));
  }

  /** Every variation (deleted ones too). */
  listByOwner(ownerId: string): Promise<PlanDayVariation[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }

  saveVariation(ownerId: string, next: PlanDayVariation, expectedVersion: number | null, opId: string): Promise<VariationWrite> {
    return this.db.write((tx) => saveVariationIn(tx, ownerId, next, expectedVersion, opId));
  }
}

// ---------------------------------------------------------------------------
// Reviews

/**
 * A review write. `unchanged`: the current review for the subject was made
 * from the same inputs, so nothing ran again (§6.1: re-run only when the
 * inputs change); it is returned as stored.
 */
export type ReviewWrite =
  | { status: 'written' | 'replayed' | 'unchanged'; review: Review }
  | { status: 'stale'; review: Review | null }
  | { status: 'invalid'; reason: string };

async function getReviewIn(q: SqlExecutor, id: string): Promise<Review | null> {
  const row = await q.getFirst('SELECT * FROM reviews WHERE id = ?', [id]);
  return row ? decodeDocument(REVIEW_SPEC, row) : null;
}

async function currentReviewIn(q: SqlExecutor, ownerId: string, subject: ReviewSubject): Promise<Review | null> {
  const row = await q.getFirst("SELECT * FROM reviews WHERE owner_id = ? AND kind = ? AND subject_key = ? AND status = 'current'", [ownerId, subject.kind, reviewSubjectKey(subject)]);
  return row ? decodeDocument(REVIEW_SPEC, row) : null;
}

export class SqliteReviews extends DocumentRepository<Review> {
  constructor(db: Database) {
    super(db, REVIEW_SPEC);
  }

  /** The current review of a subject, if any. */
  current(ownerId: string, subject: ReviewSubject): Promise<Review | null> {
    return this.db.read((q) => currentReviewIn(q, ownerId, subject));
  }

  /** Current reviews of one kind, newest first (Progress › Reviews history). */
  async listCurrent(ownerId: string, kind: ReviewKind, limit: number): Promise<Review[]> {
    const rows = await this.listWhere("owner_id = ? AND kind = ? AND status = 'current'", [ownerId, kind]);
    return rows.sort((a, b) => (a.createdAt.utc < b.createdAt.utc ? 1 : a.createdAt.utc > b.createdAt.utc ? -1 : 0)).slice(0, limit);
  }

  listByOwner(ownerId: string): Promise<Review[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }

  /**
   * A new review of its subject, version 1, `current`. In one transaction:
   * a retry replays; the same inputs as the current one is `unchanged`;
   * otherwise the current one becomes `superseded` (naming this one) and
   * this one is written.
   */
  record(ownerId: string, review: Review): Promise<ReviewWrite> {
    if (review.ownerId !== ownerId) return Promise.resolve({ status: 'invalid', reason: 'owner' });
    if (review.status !== 'current' || review.version !== 1) return Promise.resolve({ status: 'invalid', reason: 'a new review is current, version 1' });
    return this.db.write(async (tx): Promise<ReviewWrite> => {
      const same = await getReviewIn(tx, review.id);
      if (same !== null) return same.ownerId === ownerId && same.opIds.some((o) => review.opIds.includes(o)) ? { status: 'replayed', review: same } : { status: 'invalid', reason: 'id taken' };
      const current = await currentReviewIn(tx, ownerId, review.subject);
      if (current !== null) {
        if (current.inputsHash === review.inputsHash) return { status: 'unchanged', review: current };
        const old: Review = { ...current, status: 'superseded', supersededById: review.id, version: current.version + 1, updatedAtUtc: review.updatedAtUtc, opIds: [...current.opIds, ...review.opIds].slice(-REVIEW_LIMITS.maxOpIds) };
        if (!(await saveDocumentIn(tx, REVIEW_SPEC, old, current.version)).ok) return { status: 'stale', review: current };
      }
      const r = await saveDocumentIn(tx, REVIEW_SPEC, review, null);
      if (!r.ok) throw new Error('Review write conflicted after the check');
      return { status: 'written', review };
    });
  }

  /**
   * A change to a stored review (the coach's part arriving after the facts,
   * `pending` → `reviewed`), at the version expected (rule 5). `opId` must
   * be in `next.opIds`; a retry replays.
   */
  update(ownerId: string, next: Review, expectedVersion: number, opId: string): Promise<ReviewWrite> {
    if (next.ownerId !== ownerId) return Promise.resolve({ status: 'invalid', reason: 'owner' });
    if (!next.opIds.includes(opId)) return Promise.resolve({ status: 'invalid', reason: 'op ID not recorded' });
    return this.db.write(async (tx): Promise<ReviewWrite> => {
      const current = await getReviewIn(tx, next.id);
      if (current === null || current.ownerId !== ownerId) return { status: 'invalid', reason: 'missing' };
      if (current.opIds.includes(opId)) return { status: 'replayed', review: current };
      if (current.version !== expectedVersion || reviewSubjectKey(current.subject) !== reviewSubjectKey(next.subject) || current.subject.kind !== next.subject.kind) return { status: 'stale', review: current };
      const r = await saveDocumentIn(tx, REVIEW_SPEC, next, expectedVersion);
      return r.ok ? { status: 'written', review: next } : { status: 'stale', review: current };
    });
  }
}

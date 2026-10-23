import { WorkoutDraftSchema, type BuilderDraftKey, type Routine, type WorkoutDraft } from '@fizz/schemas';
import { expireWorkoutDraft, type DraftLifeChange, type PlanDayKeySplit, type SaveResult } from '@fizz/domain';
import type { Database } from './database';
import { decodeDocument, DocumentRepository, erase, saveDocumentIn, saveRoutineTemplateIn, type DocumentSpec, type DocumentTable } from './documents';
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

/** SQL over `workout_drafts` matching the unique index `workout_drafts_open_builder` (migrations 30, 33): the open builder draft with this key. */
const OPEN_BUILDER_SQL =
  "status = 'open' AND json_extract(data, '$.builderKey') IS NOT NULL AND coalesce(json_extract(data, '$.builderKey.planId'), '-') = ? AND coalesce(json_extract(data, '$.builderKey.dayIndex'), -1) = ? AND coalesce(json_extract(data, '$.builderKey.splitDayId'), '-') = ? AND coalesce(json_extract(data, '$.builderKey.mainLiftExerciseId'), '-') = ? AND json_extract(data, '$.builderKey.localDate') = ? AND coalesce(json_extract(data, '$.builderKey.from.kind'), '-') = ? AND coalesce(json_extract(data, '$.builderKey.from.id'), '-') = ?";
const builderKeyParams = (k: BuilderDraftKey): (string | number)[] => [k.planId ?? '-', k.dayIndex ?? -1, k.splitDayId ?? '-', k.mainLiftExerciseId ?? '-', k.localDate, k.from?.kind ?? '-', k.from?.id ?? '-'];

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

/**
 * What Summary's `Keep for next time?` wrote (D1): both writes, a retry of them, or neither (`stale`: the draft's
 * answer or the plan day / saved workout moved since; rule 5).
 */
export type KeepNextTimeWrite = { status: 'written' | 'replayed'; draft: WorkoutDraft } | { status: 'stale' } | { status: 'missing' } | { status: 'invalid'; reason: string };

/** Thrown inside the keep transaction to roll back the answer when the routine write is refused. */
class KeepRollback extends Error {}

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
   * (Ben, 23 Oct, D1) Summary's `Keep for next time?`: the started draft's answer (`change`, decided against the
   * draft as stored) and, for Apply or its Undo, the plan day's or saved workout's write at `expectedVersion`, in one
   * transaction: a force-close leaves both or neither, and a retry under the same op ID writes nothing more.
   */
  keepNextTime(ownerId: string, id: string, change: (current: WorkoutDraft) => DraftLifeChange, routine?: { next: Routine; expectedVersion: number; split: PlanDayKeySplit }): Promise<KeepNextTimeWrite> {
    return this.db
      .write(async (tx): Promise<KeepNextTimeWrite> => {
        const current = await getWorkoutDraftIn(tx, id);
        if (current === null || current.ownerId !== ownerId) return { status: 'missing' };
        const c = change(current);
        switch (c.kind) {
          case 'duplicate':
            return { status: 'replayed', draft: c.current };
          case 'stale':
          case 'closed':
            return { status: 'stale' };
          case 'invalid':
            return { status: 'invalid', reason: c.reason };
          case 'write': {
            const r = await saveDocumentIn(tx, WORKOUT_DRAFT_SPEC, c.next, c.expectedVersion);
            if (!r.ok) return { status: 'stale' };
            if (routine !== undefined && (routine.next.ownerId !== ownerId || !(await saveRoutineTemplateIn(tx, routine.next, routine.expectedVersion, routine.split)).ok)) throw new KeepRollback();
            return { status: 'written', draft: c.next };
          }
        }
      })
      .catch((e: unknown) => {
        if (e instanceof KeepRollback) return { status: 'stale' as const };
        throw e;
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
 * Why a draft didn't start (nothing written): `gone` (not open any more, not
 * Ben's, or its 14 days are over by the start), `stale` (its version moved
 * since the screen read it; rule 5), or `empty` (v3 §4.4: Start refuses a
 * workout with no exercises, so the UI says so rather than `Out of date`;
 * review b3-data N5).
 */
export type DraftStartResult = { ok: true } | { ok: false; reason: 'gone' | 'stale' | 'empty' };

/**
 * Inside a session's create transaction (§6.3): the coach or builder draft a
 * workout starts from becomes `started` with the session's ID.
 * `expectedVersion` (v3 §4.4, review b3-data N3): the draft's version the
 * screen showed; builder edits bump it in place, so the atomic Start passes
 * it. Absent (coach drafts as before): the overview's fence already pinned it
 * (OV4).
 */
export async function startWorkoutDraftIn(tx: SqlExecutor, draftId: string, ownerId: string, sessionId: string, atUtc: string, expectedVersion?: number): Promise<DraftStartResult> {
  const d = await getWorkoutDraftIn(tx, draftId);
  if (d === null || d.ownerId !== ownerId || d.status !== 'open' || d.expiresAtUtc <= atUtc) return { ok: false, reason: 'gone' };
  if (expectedVersion !== undefined && d.version !== expectedVersion) return { ok: false, reason: 'stale' };
  const current = d.versions.find((v) => v.n === d.currentVersion);
  if (current === undefined || current.plan.slots.length === 0) return { ok: false, reason: 'empty' };
  const next: WorkoutDraft = { ...d, status: 'started', sessionId, startedAtUtc: atUtc, version: d.version + 1, updatedAtUtc: atUtc };
  const r = await saveDocumentIn(tx, WORKOUT_DRAFT_SPEC, next, d.version);
  return r.ok ? { ok: true } : { ok: false, reason: 'stale' };
}

/**
 * (Review B2, retire-workout-overview) Whether a builder draft opened on a coach chat draft was opened on an older
 * version of it than the chat draft's current one (`setup.sourceVersion`): its Start is refused as stale (rule 5),
 * so a revised chat draft is never marked Started with the version before it. False for every other draft, and for
 * a chat draft no longer open (the start stands, as `startChatSourceIn`).
 */
export async function chatSourceStaleIn(tx: SqlExecutor, builderDraftId: string): Promise<boolean> {
  const d = await getWorkoutDraftIn(tx, builderDraftId);
  const from = d?.builderKey?.from;
  if (d === null || from?.kind !== 'coach_draft' || from.id === builderDraftId) return false;
  const chat = await getWorkoutDraftIn(tx, from.id);
  if (chat === null || chat.builderKey !== undefined || chat.status !== 'open') return false;
  const opened = d.versions.find((v) => v.n === d.currentVersion)?.request.setup?.sourceVersion;
  return opened !== undefined && opened !== chat.currentVersion;
}

/**
 * (22 Oct, Workout overview retired) After a builder draft opened on a coach chat draft starts (`builderKey.from`
 * kind `coach_draft`), the chat draft is started with the same session, in the same transaction, so its card no
 * longer offers it. Already started, discarded or expired: left as it is (the start still stands).
 */
export async function startChatSourceIn(tx: SqlExecutor, builderDraftId: string, ownerId: string, sessionId: string, atUtc: string): Promise<void> {
  const d = await getWorkoutDraftIn(tx, builderDraftId);
  const from = d?.builderKey?.from;
  if (from?.kind !== 'coach_draft' || from.id === builderDraftId) return;
  const chat = await getWorkoutDraftIn(tx, from.id);
  if (chat === null || chat.builderKey !== undefined) return;
  await startWorkoutDraftIn(tx, from.id, ownerId, sessionId, atUtc);
}

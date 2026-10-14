import { TrainingProfileSchema, type TrainingChange, type TrainingProfile } from '@fizz/schemas';
import { applyTrainingChange, deriveId, newTrainingProfile, type TrainingWriteContext } from '@fizz/domain';
import type { Database } from './database';
import { decodeDocument, erase, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor } from './driver';

/**
 * Ben's training details and split (migration 16). Your data, one document
 * per owner. Every change is `applyTrainingChange` on the stored row inside
 * one write transaction: a stale version is refused, a repeated operation ID
 * is a no-op (rule 5).
 */
export const TRAINING_PROFILE_SPEC: DocumentSpec<TrainingProfile> = {
  table: 'training_profiles',
  schema: TrainingProfileSchema,
  columns: (p) => ({ owner_id: p.ownerId }),
};

export const TRAINING_PROFILE_DOCUMENT_TABLES: readonly DocumentTable[] = [erase(TRAINING_PROFILE_SPEC)];

/** The owner's training profile row ID (stable, so a restore or a retry finds the same row). */
export const trainingProfileId = (ownerId: string): string => deriveId(`training-profile:${ownerId}`);

async function readIn(q: SqlExecutor, ownerId: string): Promise<TrainingProfile | null> {
  const row = await q.getFirst('SELECT * FROM training_profiles WHERE owner_id = ?', [ownerId]);
  return row ? decodeDocument(TRAINING_PROFILE_SPEC, row) : null;
}

export type TrainingProfileWrite =
  | { status: 'written' | 'replayed'; profile: TrainingProfile }
  | { status: 'stale' | 'invalid'; profile: TrainingProfile };

export class SqliteTrainingProfiles {
  constructor(private readonly db: Database) {}

  /** The stored profile, or null before the first write. */
  get(ownerId: string): Promise<TrainingProfile | null> {
    return this.db.read((q) => readIn(q, ownerId));
  }

  /** The stored profile, else the defaults (version 1) written now. Idempotent. */
  ensure(ownerId: string, atUtc: string): Promise<TrainingProfile> {
    return this.db.write(async (tx) => {
      const have = await readIn(tx, ownerId);
      if (have !== null) return have;
      const p = newTrainingProfile({ id: trainingProfileId(ownerId), ownerId, atUtc });
      const saved = await saveDocumentIn(tx, TRAINING_PROFILE_SPEC, p, null);
      if (!saved.ok) throw new Error('Training profile row clash');
      return p;
    });
  }

  /** One change on `expectedVersion` (the version the screen showed). */
  change(ownerId: string, change: TrainingChange, w: TrainingWriteContext): Promise<TrainingProfileWrite> {
    return this.db.write(async (tx) => {
      const current = (await readIn(tx, ownerId)) ?? newTrainingProfile({ id: trainingProfileId(ownerId), ownerId, atUtc: w.atUtc });
      const stored = await tx.getFirst('SELECT 1 AS x FROM training_profiles WHERE owner_id = ?', [ownerId]);
      const r = applyTrainingChange(current, change, w);
      if (!r.ok) return { status: r.error, profile: current };
      if (r.replayed) return { status: 'replayed', profile: r.profile };
      const saved = await saveDocumentIn(tx, TRAINING_PROFILE_SPEC, r.profile, stored === null ? null : current.version);
      if (!saved.ok) return { status: 'stale', profile: current };
      return { status: 'written', profile: r.profile };
    });
  }
}

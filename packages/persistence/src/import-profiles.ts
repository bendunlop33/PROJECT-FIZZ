import {
  ImportLayoutRequestSchema,
  ImportProfileSchema,
  type ImportLayoutRequest,
  type ImportProfile,
  type ZonedTimestamp,
} from '@fizz/schemas';
import type { Database } from './database';
import { decodeDocument, saveDocumentIn, type DocumentSpec } from './documents';
import type { SqlRow } from './driver';

/**
 * Saved import layouts and layout requests (data-import-export §9.6.4, ADR
 * 0026 §5–§6). All Your data (rule 10): backed up in its section, in the full
 * export, removed by `Delete my data`, absent from `Coaching knowledge only`.
 *
 * - A layout is **in use** only while one of its `uses` is an import still in
 *   effect (`layoutInUse`), so `Undo this import` takes back a layout that
 *   only that import used (AI12), as remembered names do.
 * - A stored layout that fails the schema (a hand-edited backup) is never
 *   used, and is listed as damaged so Ben is told (check 57). It never stops
 *   the app opening.
 * - Every write is versioned; a stale version is refused (rule 5).
 */

export const IMPORT_PROFILE_SPEC: DocumentSpec<ImportProfile> = {
  table: 'import_profiles',
  schema: ImportProfileSchema,
  columns: (p) => ({ owner_id: p.ownerId }),
};

export const IMPORT_LAYOUT_REQUEST_SPEC: DocumentSpec<ImportLayoutRequest> = {
  table: 'import_layout_requests',
  schema: ImportLayoutRequestSchema,
  columns: (r) => ({ owner_id: r.ownerId, operation_id: r.operationId, sample_hash: r.sampleHash, state: r.state }),
};

/** A stored layout that failed the schema: never used; shown as `⚠ Damaged` with `Delete layout`. */
export interface DamagedProfile {
  id: string;
  /** Its name, when the stored text still has one (file text Ben typed, shown in quotes). */
  name: string | null;
}

function nameOf(row: SqlRow): string | null {
  if (typeof row.data !== 'string') return null;
  try {
    const n = (JSON.parse(row.data) as { name?: unknown }).name;
    return typeof n === 'string' ? n.slice(0, 80) : null;
  } catch {
    return null;
  }
}

/** Whether a layout is in use: one of its imports is still in effect (not undone). */
export function layoutInUse(p: Pick<ImportProfile, 'uses' | 'deletedAt'>, undoneJobIds: ReadonlySet<string>): boolean {
  return p.deletedAt === null && p.uses.some((j) => !undoneJobIds.has(j));
}

export type ProfileWriteOutcome = { ok: true; profile: ImportProfile } | { ok: false; error: 'not_found' | 'stale' };

export class SqliteImportProfiles {
  constructor(private readonly db: Database) {}

  /** Every layout of the owner (deleted ones included, flagged), and the ones that can't be read. */
  list(ownerId: string): Promise<{ profiles: ImportProfile[]; damaged: DamagedProfile[] }> {
    return this.db.read(async (q) => {
      const rows = await q.getAll('SELECT * FROM import_profiles WHERE owner_id = ? ORDER BY id', [ownerId]);
      const profiles: ImportProfile[] = [];
      const damaged: DamagedProfile[] = [];
      for (const row of rows) {
        try {
          profiles.push(decodeDocument(IMPORT_PROFILE_SPEC, row));
        } catch {
          damaged.push({ id: String(row.id), name: nameOf(row) });
        }
      }
      return { profiles, damaged };
    });
  }

  get(id: string): Promise<ImportProfile | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst('SELECT * FROM import_profiles WHERE id = ?', [id]);
      if (!row) return null;
      try {
        return decodeDocument(IMPORT_PROFILE_SPEC, row);
      } catch {
        return null;
      }
    });
  }

  /** `Delete layout` (soft, so `Undo` can bring it back) and its Undo. Imports it was used by are untouched. */
  setDeleted(id: string, expectedVersion: number, at: ZonedTimestamp | null): Promise<ProfileWriteOutcome> {
    return this.db.write(async (tx) => {
      const row = await tx.getFirst('SELECT * FROM import_profiles WHERE id = ?', [id]);
      if (!row) return { ok: false, error: 'not_found' };
      let current: ImportProfile;
      try {
        current = decodeDocument(IMPORT_PROFILE_SPEC, row);
      } catch {
        return { ok: false, error: 'not_found' };
      }
      if (current.version !== expectedVersion) return { ok: false, error: 'stale' };
      const next: ImportProfile = { ...current, deletedAt: at, version: current.version + 1, updatedAtUtc: (at ?? current.provenance.confirmedAt).utc };
      const saved = await saveDocumentIn(tx, IMPORT_PROFILE_SPEC, next, current.version);
      return saved.ok ? { ok: true, profile: next } : { ok: false, error: 'stale' };
    });
  }

  /** A damaged layout can only be removed (it can't be read to soft-delete). */
  removeDamaged(id: string): Promise<boolean> {
    return this.db.write(async (tx) => {
      const row = await tx.getFirst('SELECT * FROM import_profiles WHERE id = ?', [id]);
      if (!row) return false;
      try {
        decodeDocument(IMPORT_PROFILE_SPEC, row);
        return false;
      } catch {
        await tx.run('DELETE FROM import_profiles WHERE id = ?', [id]);
        return true;
      }
    });
  }

  /** The request stored under this operation ID, if any (a repeat sends nothing). */
  request(ownerId: string, operationId: string): Promise<ImportLayoutRequest | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst('SELECT * FROM import_layout_requests WHERE owner_id = ? AND operation_id = ?', [ownerId, operationId]);
      return row ? decodeDocument(IMPORT_LAYOUT_REQUEST_SPEC, row) : null;
    });
  }

  /**
   * The newest layout that arrived for this exact sample **of this exact file**
   * and that Ben never acted on (`closedAt` null): reused after an
   * interruption (§9.3.3). A layout he confirmed, cancelled or asked to read
   * again is never reused; nor is one from a record with no file checksum.
   */
  proposedFor(ownerId: string, sampleHash: string, fileHash: string): Promise<ImportLayoutRequest | null> {
    return this.db.read(async (q) => {
      const rows = await q.getAll("SELECT * FROM import_layout_requests WHERE owner_id = ? AND sample_hash = ? AND state = 'proposed' ORDER BY updated_at_utc DESC, id DESC", [ownerId, sampleHash]);
      for (const row of rows) {
        const r = decodeDocument(IMPORT_LAYOUT_REQUEST_SPEC, row);
        if (r.fileHash === fileHash && r.closedAt === null && r.spec !== null) return r;
      }
      return null;
    });
  }

  /** The newest request for this exact sample, whatever its state (a `sent` one with nothing in flight was interrupted). */
  latestFor(ownerId: string, sampleHash: string): Promise<ImportLayoutRequest | null> {
    return this.db.read(async (q) => {
      const rows = await q.getAll('SELECT * FROM import_layout_requests WHERE owner_id = ? AND sample_hash = ? ORDER BY updated_at_utc DESC, id DESC', [ownerId, sampleHash]);
      const first = rows[0];
      return first ? decodeDocument(IMPORT_LAYOUT_REQUEST_SPEC, first) : null;
    });
  }

  /** Save a request: `null` creates it (refused when its operation ID is taken), else a versioned update. */
  saveRequest(record: ImportLayoutRequest, expectedVersion: number | null): Promise<{ ok: true } | { ok: false; error: 'duplicate' | 'stale' }> {
    return this.db.write(async (tx) => {
      if (expectedVersion === null) {
        const taken = await tx.getFirst('SELECT id FROM import_layout_requests WHERE owner_id = ? AND operation_id = ?', [record.ownerId, record.operationId]);
        if (taken) return { ok: false, error: 'duplicate' };
      }
      const saved = await saveDocumentIn(tx, IMPORT_LAYOUT_REQUEST_SPEC, record, expectedVersion);
      return saved.ok ? { ok: true } : { ok: false, error: 'stale' };
    });
  }
}

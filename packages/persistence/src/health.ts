import {
  DEFAULT_HEALTH_SETTINGS,
  HealthLinkSchema,
  HealthSettingsSchema,
  HealthRestingHrSampleSchema,
  HealthSleepSampleSchema,
  HealthWeightSampleSchema,
  HealthWorkoutSampleSchema,
  HealthWorkoutWriteSchema,
  type Activity,
  type HealthLink,
  type HealthRestingHrSample,
  type HealthSettings,
  type HealthSleepSample,
  type HealthWeightSample,
  type HealthWorkoutSample,
  type HealthWorkoutWrite,
} from '@fizz/schemas';
import { activitiesWithHealth, addDays, toIso, toMs, type HealthLinkChange, type LinkableWorkout } from '@fizz/domain';

import type { Database } from './database';
import { decodeDocument, erase, listDocuments, saveDocumentIn, type DocumentSpec, type DocumentTable } from './documents';
import type { SqlExecutor, SqlRow } from './driver';
import { checkRead, checkWrite, inHistorySql, parseJson, rowId } from './sql';

/**
 * (Ben, 27 Oct; ADR 0035) Apple Health's tables (migration 38): what the app wrote, Ben's links, what it read and
 * the switches. Every write is decided by the domain against the row as stored inside the transaction:
 * versioned, a repeated op ID changes nothing (rule 5).
 */

export const HEALTH_LINK_SPEC: DocumentSpec<HealthLink> = {
  table: 'health_links',
  schema: HealthLinkSchema,
  columns: (l) => ({ owner_id: l.ownerId, health_uuid: l.healthUuid, session_id: l.sessionId, status: l.status }),
};

export const HEALTH_DOCUMENT_TABLES: readonly DocumentTable[] = [erase(HEALTH_LINK_SPEC)];

export type HealthLinkWrite = { status: 'written' | 'replayed'; link: HealthLink } | { status: 'stale'; link: HealthLink | null } | { status: 'invalid'; reason: string };

/** One app workout as `planHealthWrites` first sees it: cheap columns only. */
export interface HealthWriteRow {
  sessionId: string;
  revision: number;
  /** The write record's last-checked revision; null with no record. */
  checkedRevision: number | null;
}

async function linkIn(q: SqlExecutor, ownerId: string, healthUuid: string): Promise<HealthLink | null> {
  const row = await q.getFirst('SELECT * FROM health_links WHERE owner_id = ? AND health_uuid = ?', [ownerId, healthUuid.toLowerCase()]);
  return row ? decodeDocument(HEALTH_LINK_SPEC, row) : null;
}

/** Save a decided link change inside a caller's transaction. */
export async function saveHealthLinkChangeIn(tx: SqlExecutor, ownerId: string, c: HealthLinkChange): Promise<HealthLinkWrite> {
  switch (c.kind) {
    case 'duplicate':
      return { status: 'replayed', link: c.current };
    case 'stale':
      return { status: 'stale', link: c.current };
    case 'invalid':
      return { status: 'invalid', reason: c.reason };
    case 'write': {
      if (c.next.ownerId !== ownerId) throw new Error('Health link owner differs from the store owner');
      const r = await saveDocumentIn(tx, HEALTH_LINK_SPEC, c.next, c.expectedVersion);
      return r.ok ? { status: 'written', link: c.next } : { status: 'stale', link: await linkIn(tx, ownerId, c.next.healthUuid) };
    }
  }
}

function decodeWorkoutSample(row: SqlRow): HealthWorkoutSample {
  const id = rowId(row.id);
  return checkRead(HealthWorkoutSampleSchema, parseJson('health_samples', id, 'data', row.data ?? null), 'health_samples', id);
}

function decodeWeightSample(row: SqlRow): HealthWeightSample {
  const id = rowId(row.id);
  return checkRead(HealthWeightSampleSchema, parseJson('health_samples', id, 'data', row.data ?? null), 'health_samples', id);
}

const DAY_MS = 86_400_000;

export type HealthSampleKind = 'workout' | 'weight' | 'resting_hr' | 'sleep';
export interface HealthSampleOf {
  workout: HealthWorkoutSample;
  weight: HealthWeightSample;
  resting_hr: HealthRestingHrSample;
  sleep: HealthSleepSample;
}
const SAMPLE_SCHEMA = { workout: HealthWorkoutSampleSchema, weight: HealthWeightSampleSchema, resting_hr: HealthRestingHrSampleSchema, sleep: HealthSleepSampleSchema } as const;

export class SqliteHealth {
  constructor(private readonly db: Database) {}

  // ---------------------------------------------------------------- settings

  async settings(ownerId: string): Promise<HealthSettings> {
    const row = await this.db.read((q) => q.getFirst<{ data: string }>('SELECT data FROM health_settings WHERE owner_id = ?', [ownerId]));
    return row === null ? DEFAULT_HEALTH_SETTINGS : checkRead(HealthSettingsSchema, parseJson('health_settings', ownerId, 'data', row.data), 'health_settings', ownerId);
  }

  /** The switches after `make`, on the version stored inside the write; `stale` when it moved on (rule 5). */
  updateSettings(ownerId: string, expectedVersion: number, make: (current: HealthSettings) => HealthSettings): Promise<{ ok: true; settings: HealthSettings } | { ok: false; settings: HealthSettings }> {
    return this.db.write(async (tx) => {
      const row = await tx.getFirst<{ data: string }>('SELECT data FROM health_settings WHERE owner_id = ?', [ownerId]);
      const current = row === null ? DEFAULT_HEALTH_SETTINGS : checkRead(HealthSettingsSchema, parseJson('health_settings', ownerId, 'data', row.data), 'health_settings', ownerId);
      if (current.version !== expectedVersion) return { ok: false as const, settings: current };
      const next = checkWrite(HealthSettingsSchema, { ...make(current), version: current.version + 1 }, 'health_settings', ownerId);
      await tx.run('INSERT INTO health_settings (owner_id, version, data) VALUES (?, ?, ?) ON CONFLICT (owner_id) DO UPDATE SET version = excluded.version, data = excluded.data', [ownerId, next.version, JSON.stringify(next)]);
      return { ok: true as const, settings: next };
    });
  }

  // ---------------------------------------------------------------- samples read from Health

  /**
   * A read's result replaces what was stored for its window (`sinceUtc` on): Health is the source, so a sample
   * deleted there goes here too. All or nothing.
   */
  replaceSamples<K extends HealthSampleKind>(ownerId: string, kind: K, sinceUtc: string, samples: readonly HealthSampleOf[K][]): Promise<number> {
    return this.db.write(async (tx) => {
      await tx.run('DELETE FROM health_samples WHERE owner_id = ? AND kind = ? AND start_utc >= ?', [ownerId, kind, sinceUtc]);
      let n = 0;
      for (const s of samples) {
        const valid = checkWrite(SAMPLE_SCHEMA[kind], s, 'health_samples', s.uuid) as HealthSampleOf[K];
        const start = 'startUtc' in valid ? valid.startUtc : valid.atUtc;
        if (start < sinceUtc) continue;
        await tx.run('INSERT INTO health_samples (id, owner_id, kind, start_utc, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET owner_id = excluded.owner_id, kind = excluded.kind, start_utc = excluded.start_utc, data = excluded.data', [
          valid.uuid,
          ownerId,
          kind,
          start,
          JSON.stringify(valid),
        ]);
        n += 1;
      }
      return n;
    });
  }

  /** Forget one kind (its switch went off). */
  clearSamples(ownerId: string, kind: HealthSampleKind): Promise<void> {
    return this.db.write(async (tx) => {
      await tx.run('DELETE FROM health_samples WHERE owner_id = ? AND kind = ?', [ownerId, kind]);
    });
  }

  /** (Q8) Resting heart rates or sleep segments since `fromUtc`, oldest first. */
  async samplesSince<K extends 'resting_hr' | 'sleep'>(ownerId: string, kind: K, fromUtc: string): Promise<HealthSampleOf[K][]> {
    const rows = await this.db.read((q) => q.getAll('SELECT * FROM health_samples WHERE owner_id = ? AND kind = ? AND start_utc >= ? ORDER BY start_utc', [ownerId, kind, fromUtc]));
    return rows.map((r) => {
      const id = rowId(r.id);
      return checkRead(SAMPLE_SCHEMA[kind], parseJson('health_samples', id, 'data', r.data ?? null), 'health_samples', id) as HealthSampleOf[K];
    });
  }

  workoutSamples(ownerId: string, fromUtc: string, toUtc: string): Promise<HealthWorkoutSample[]> {
    return this.db.read((q) => workoutSamplesIn(q, ownerId, fromUtc, toUtc));
  }

  async workoutSample(ownerId: string, uuid: string): Promise<HealthWorkoutSample | null> {
    const row = await this.db.read((q) => q.getFirst("SELECT * FROM health_samples WHERE owner_id = ? AND kind = 'workout' AND id = ?", [ownerId, uuid.toLowerCase()]));
    return row === null ? null : decodeWorkoutSample(row);
  }

  async weightSamples(ownerId: string): Promise<HealthWeightSample[]> {
    const rows = await this.db.read((q) => q.getAll("SELECT * FROM health_samples WHERE owner_id = ? AND kind = 'weight' ORDER BY start_utc", [ownerId]));
    return rows.map(decodeWeightSample);
  }

  // ---------------------------------------------------------------- writes to Health

  async writes(ownerId: string): Promise<HealthWorkoutWrite[]> {
    const rows = await this.db.read((q) => q.getAll<{ session_id: string; data: string }>('SELECT session_id, data FROM health_writes WHERE owner_id = ?', [ownerId]));
    return rows.map((r) => checkRead(HealthWorkoutWriteSchema, parseJson('health_writes', r.session_id, 'data', r.data), 'health_writes', r.session_id));
  }

  /**
   * The app workouts `planHealthWrites` must look at: every one with a write record whose revision moved on (or
   * that is gone), plus finished, logged-in-app workouts with no record recorded since `sinceUtc` (end or
   * past-log entry time). Null `sinceUtc`: records only.
   */
  writeRows(ownerId: string, sinceUtc: string | null): Promise<{ toCheck: HealthWriteRow[]; goneSessionIds: string[] }> {
    return this.db.read(async (q) => {
      const recorded = await q.getAll<{ session_id: string; session_revision: number; revision: number | null }>(
        'SELECT w.session_id, w.session_revision, s.revision FROM health_writes w LEFT JOIN sessions s ON s.id = w.session_id WHERE w.owner_id = ?',
        [ownerId],
      );
      const toCheck: HealthWriteRow[] = recorded.filter((r) => r.revision !== null && r.revision !== r.session_revision).map((r) => ({ sessionId: r.session_id, revision: r.revision ?? 0, checkedRevision: r.session_revision }));
      const goneSessionIds = recorded.filter((r) => r.revision === null).map((r) => r.session_id);
      if (sinceUtc !== null) {
        const fresh = await q.getAll<{ id: string; revision: number }>(
          `SELECT id, revision FROM sessions WHERE owner_id = ? AND ${inHistorySql()} AND source = 'manual' AND (ended_at_utc >= ? OR json_extract(past_log, '$.enteredAt.utc') >= ?) AND id NOT IN (SELECT session_id FROM health_writes WHERE owner_id = ?)`,
          [ownerId, sinceUtc, sinceUtc, ownerId],
        );
        for (const r of fresh) toCheck.push({ sessionId: r.id, revision: r.revision, checkedRevision: null });
      }
      return { toCheck, goneSessionIds };
    });
  }

  /** Record a Health write (versioned on the record as read; `stale` when it moved on). */
  saveWrite(next: HealthWorkoutWrite, expectedVersion: number | null, sessionRevision: number): Promise<'written' | 'stale'> {
    return this.db.write(async (tx) => {
      const valid = checkWrite(HealthWorkoutWriteSchema, next, 'health_writes', next.sessionId);
      const cur = await tx.getFirst<{ version: number }>('SELECT version FROM health_writes WHERE session_id = ?', [valid.sessionId]);
      if ((cur?.version ?? null) !== expectedVersion) return 'stale';
      await tx.run(
        'INSERT INTO health_writes (session_id, owner_id, status, health_uuid, session_revision, version, updated_at_utc, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET status = excluded.status, health_uuid = excluded.health_uuid, session_revision = excluded.session_revision, version = excluded.version, updated_at_utc = excluded.updated_at_utc, data = excluded.data',
        [valid.sessionId, valid.ownerId, valid.status, valid.healthUuid, sessionRevision, valid.version, valid.updatedAtUtc, JSON.stringify(valid)],
      );
      return 'written';
    });
  }

  /** Nothing to write (same fingerprint): note the revision checked so it isn't loaded again. */
  markChecked(sessionId: string, sessionRevision: number): Promise<void> {
    return this.db.write(async (tx) => {
      await tx.run('UPDATE health_writes SET session_revision = ? WHERE session_id = ?', [sessionRevision, sessionId]);
    });
  }

  // ---------------------------------------------------------------- links

  links(ownerId: string): Promise<HealthLink[]> {
    return this.db.read((q) => listDocuments(q, HEALTH_LINK_SPEC, 'owner_id = ?', [ownerId]));
  }

  linkOf(ownerId: string, healthUuid: string): Promise<HealthLink | null> {
    return this.db.read((q) => linkIn(q, ownerId, healthUuid));
  }

  async linkForWorkout(ownerId: string, sessionId: string): Promise<HealthLink | null> {
    const rows = await this.db.read((q) => listDocuments(q, HEALTH_LINK_SPEC, "owner_id = ? AND session_id = ? AND status = 'linked'", [ownerId, sessionId]));
    return rows[0] ?? null;
  }

  /**
   * Link, unlink or `Not it`, decided against the stored link inside the write; `linkedElsewhere(sessionId)`
   * says whether that workout already has another linked activity.
   */
  changeLink(ownerId: string, healthUuid: string, make: (current: HealthLink | null, linkedElsewhere: (sessionId: string) => Promise<boolean>) => Promise<HealthLinkChange> | HealthLinkChange): Promise<HealthLinkWrite> {
    return this.db.write(async (tx) => {
      const current = await linkIn(tx, ownerId, healthUuid);
      const elsewhere = async (sessionId: string) =>
        (await tx.getFirst("SELECT 1 AS x FROM health_links WHERE owner_id = ? AND session_id = ? AND status = 'linked' AND health_uuid <> ?", [ownerId, sessionId, healthUuid.toLowerCase()])) !== null;
      const out = await saveHealthLinkChangeIn(tx, ownerId, await make(current, elsewhere));
      // (Q1) A link or unlink changes whether the app's own Health write should exist: check those workouts again.
      if (out.status === 'written') {
        const ids = [...new Set([current?.sessionId, out.link.sessionId].filter((x): x is string => x !== undefined))];
        for (const id of ids) await tx.run('UPDATE health_writes SET session_revision = -1 WHERE session_id = ?', [id]);
      }
      return out;
    });
  }

  /** The app workouts in history that started in [`fromUtc`, `toUtc`): what a Health activity can link to. */
  linkableWorkouts(ownerId: string, fromUtc: string, toUtc: string): Promise<LinkableWorkout[]> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ id: string; started_at_utc: string; started_at_tz: string; ended_at_utc: string | null; routine_name: string | null }>(
        `SELECT id, started_at_utc, started_at_tz, ended_at_utc, routine_name FROM sessions WHERE owner_id = ? AND ${inHistorySql()} AND ended_at_utc IS NOT NULL AND started_at_utc >= ? AND started_at_utc < ? ORDER BY started_at_utc`,
        [ownerId, fromUtc, toUtc],
      );
      return rows.map((r) => ({ sessionId: r.id, startUtc: r.started_at_utc, endUtc: r.ended_at_utc ?? r.started_at_utc, tz: r.started_at_tz, title: r.routine_name ?? 'Workout' }));
    });
  }
}

async function workoutSamplesIn(q: SqlExecutor, ownerId: string, fromUtc: string, toUtc: string): Promise<HealthWorkoutSample[]> {
  const rows = await q.getAll("SELECT * FROM health_samples WHERE owner_id = ? AND kind = 'workout' AND start_utc >= ? AND start_utc < ? ORDER BY start_utc", [ownerId, fromUtc, toUtc]);
  return rows.map(decodeWorkoutSample);
}

/**
 * Ben's activities dated in [`from`, `to`) (local dates) with what was read from Health (`activitiesWithHealth`:
 * never the app's own writes, never a linked one, paired with his where they match). Inside the caller's read.
 */
export async function activitiesWithHealthIn(q: SqlExecutor, ownerId: string, own: readonly Activity[], from: string, to: string): Promise<Activity[]> {
  // Local dates to a UTC window with a day either side for any zone; filtered by local date after.
  const fromUtc = toIso(toMs(`${addDays(from, -1)}T00:00:00.000Z`));
  const toUtc = toIso(toMs(`${addDays(to, 1)}T00:00:00.000Z`) + DAY_MS);
  const samples = await workoutSamplesIn(q, ownerId, fromUtc, toUtc);
  if (samples.length === 0) return [...own];
  const links = await listDocuments(q, HEALTH_LINK_SPEC, 'owner_id = ?', [ownerId]);
  const written = await q.getAll<{ health_uuid: string }>('SELECT health_uuid FROM health_writes WHERE owner_id = ?', [ownerId]);
  const externalIds = [...new Set(samples.map((s) => s.externalId?.toLowerCase()).filter((x): x is string => x !== undefined))];
  const appSessionIds = new Set<string>();
  for (const id of externalIds) if ((await q.getFirst('SELECT 1 AS x FROM sessions WHERE id = ?', [id])) !== null) appSessionIds.add(id);
  return activitiesWithHealth({ ownerId, samples, links, own, ownBundleId: null, writtenUuids: new Set(written.map((w) => w.health_uuid)), appSessionIds }).filter((a) => a.fields.date >= from && a.fields.date < to);
}

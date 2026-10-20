import {
  CheckInSchema,
  PainFlagSchema,
  EquipmentInstanceSchema,
  ExerciseSchema,
  GymSchema,
  ProgressionRuleSchema,
  RoutineSchema,
  UserProfileSchema,
  planDayTemplateKey,
  type CheckIn,
  type PainFlag,
  type EquipmentInstance,
  type Exercise,
  type Gym,
  type ProgressionRule,
  type Routine,
  type UserProfile,
} from '@fizz/schemas';
import type { SaveResult } from '@fizz/domain';
import type { z } from 'zod';
import type { Database } from './database';
import type { SqlExecutor, SqlRow, SqlValue } from './driver';
import { checkRead, checkWrite, ident, insert, mismatch, parseJson, rowId, upsert } from './sql';

type Versioned = { id: string; version: number; updatedAtUtc: string };

/**
 * A record stored as a validated JSON document plus lookup columns. `columns`
 * derives the extra columns from the record; on read they must agree with the
 * document, or the row is reported as corrupt.
 */
export interface DocumentSpec<T extends Versioned> {
  table: string;
  schema: z.ZodType<T>;
  columns: (record: T) => Record<string, SqlValue>;
}

export const PROFILE_SPEC: DocumentSpec<UserProfile> = { table: 'profiles', schema: UserProfileSchema, columns: () => ({}) };
export const GYM_SPEC: DocumentSpec<Gym> = { table: 'gyms', schema: GymSchema, columns: (g) => ({ owner_id: g.ownerId }) };
export const EQUIPMENT_SPEC: DocumentSpec<EquipmentInstance> = {
  table: 'equipment',
  schema: EquipmentInstanceSchema,
  columns: (e) => ({ owner_id: e.ownerId, gym_id: e.gymId, kind: e.kind }),
};
export const EXERCISE_SPEC: DocumentSpec<Exercise> = { table: 'exercises', schema: ExerciseSchema, columns: (e) => ({ owner_id: e.ownerId }) };
export const ROUTINE_SPEC: DocumentSpec<Routine> = { table: 'routines', schema: RoutineSchema, columns: (r) => ({ owner_id: r.ownerId }) };

/** A live template's key (planId, splitDayId, main lift); null for every other routine and a deleted template. */
export const routinePlanDayKey = (r: Routine): string | null => (r.planDay === undefined || (r.deletedAtUtc ?? null) !== null ? null : planDayTemplateKey(r.planDay));

/** SQL over `routines.data` matching the unique index `routines_plan_day` (migration 30): a live template with this key. */
const LIVE_TEMPLATE_SQL = "json_extract(data, '$.planDay') IS NOT NULL AND json_extract(data, '$.deletedAtUtc') IS NULL AND json_extract(data, '$.planDay.planId') = ? AND json_extract(data, '$.planDay.splitDayId') = ? AND coalesce(json_extract(data, '$.planDay.mainLiftExerciseId'), '-') = ?";
export const PROGRESSION_RULE_SPEC: DocumentSpec<ProgressionRule> = {
  table: 'progression_rules',
  schema: ProgressionRuleSchema,
  columns: (r) => ({ owner_id: r.ownerId }),
};

export const CHECK_IN_SPEC: DocumentSpec<CheckIn> = {
  table: 'check_ins',
  schema: CheckInSchema,
  columns: (c) => ({ owner_id: c.ownerId, recorded_at_utc: c.recordedAt.utc }),
};
export const PAIN_FLAG_SPEC: DocumentSpec<PainFlag> = {
  table: 'pain_flags',
  schema: PainFlagSchema,
  columns: (f) => ({ owner_id: f.ownerId, exercise_id: f.exerciseId, status: f.status }),
};

/** A document table with its type erased, for whole-database checks. */
export interface DocumentTable {
  table: string;
  decode(row: SqlRow): unknown;
}

/** A document spec as a type-erased table for whole-database checks. */
export const erase = <T extends Versioned>(spec: DocumentSpec<T>): DocumentTable => ({
  table: spec.table,
  decode: (row) => decodeDocument(spec, row),
});

/** Decode and validate one document row. Throws `CorruptDataError`. */
export function decodeDocument<T extends Versioned>(spec: DocumentSpec<T>, row: SqlRow): T {
  const id = rowId(row.id);
  const record = checkRead(spec.schema, parseJson(spec.table, id, 'data', row.data ?? null), spec.table, id);
  if (record.id !== row.id) throw mismatch(spec.table, id, 'id', `Column says ${id}, document says ${record.id}`);
  if (record.version !== row.version) throw mismatch(spec.table, id, 'version', `Column says ${String(row.version)}, document says ${record.version}`);
  for (const [col, value] of Object.entries(spec.columns(record))) {
    if (row[col] !== value) throw mismatch(spec.table, id, col, `Column says ${String(row[col])}, document says ${String(value)}`);
  }
  return record;
}

export class DocumentRepository<T extends Versioned> {
  constructor(
    protected readonly db: Database,
    protected readonly spec: DocumentSpec<T>,
  ) {}

  get(id: string): Promise<T | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst(`SELECT * FROM ${ident(this.spec.table)} WHERE id = ?`, [id]);
      return row ? decodeDocument(this.spec, row) : null;
    });
  }

  save(record: T, expectedVersion: number | null): Promise<SaveResult> {
    return this.db.write((tx) => saveDocumentIn(tx, this.spec, record, expectedVersion));
  }

  /** Rows matching `where` (trusted SQL from this package), ordered by id. */
  protected listWhere(where: string, params: readonly SqlValue[]): Promise<T[]> {
    return this.db.read((q) => listDocuments(q, this.spec, where, params));
  }
}

/**
 * Validate and save one document inside a caller's transaction, with the
 * same optimistic version check as `DocumentRepository.save`.
 */
export async function saveDocumentIn<T extends Versioned>(
  tx: SqlExecutor,
  spec: DocumentSpec<T>,
  record: T,
  expectedVersion: number | null,
): Promise<SaveResult> {
  const valid = checkWrite(spec.schema, record, spec.table, record.id);
  const current = await tx.getFirst<{ version: number }>(`SELECT version FROM ${ident(spec.table)} WHERE id = ?`, [valid.id]);
  const currentVersion = current?.version ?? null;
  if (currentVersion !== expectedVersion) return { ok: false, error: 'conflict', currentVersion };
  const row = {
    id: valid.id,
    version: valid.version,
    updated_at_utc: valid.updatedAtUtc,
    ...spec.columns(valid),
    data: JSON.stringify(valid),
  };
  if (current === null) await insert(tx, spec.table, row);
  else await upsert(tx, spec.table, ['id'], row);
  return { ok: true, version: valid.version };
}

/** Deletes a record only at the version expected (rule 5); false when it changed or is gone. */
export async function deleteDocumentIn<T extends Versioned>(tx: SqlExecutor, spec: DocumentSpec<T>, id: string, expectedVersion: number): Promise<boolean> {
  const r = await tx.run(`DELETE FROM ${ident(spec.table)} WHERE id = ? AND version = ?`, [id, expectedVersion]);
  return r.changes === 1;
}

export type CreateGymOutcome = { ok: true; duplicate: boolean } | { ok: false; error: 'conflict' | 'mismatched_equipment' };

export async function listDocuments<T extends Versioned>(
  q: SqlExecutor,
  spec: DocumentSpec<T>,
  where = '1 = 1',
  params: readonly SqlValue[] = [],
): Promise<T[]> {
  const rows = await q.getAll(`SELECT * FROM ${ident(spec.table)} WHERE ${where} ORDER BY id`, params);
  return rows.map((r) => decodeDocument(spec, r));
}

export class SqliteGyms extends DocumentRepository<Gym> {
  constructor(db: Database) {
    super(db, GYM_SPEC);
  }
  listByOwner(ownerId: string): Promise<Gym[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }

  /**
   * Create a gym and its equipment in one transaction (onboarding's
   * `createGymFromDraft`), so a force-close can't leave half a gym. Idempotent
   * by gym ID: a retry with the same gym ID (double tap, retry after an
   * error) changes nothing and reports `duplicate`.
   */
  createWithEquipment(gym: Gym, equipment: readonly EquipmentInstance[]): Promise<CreateGymOutcome> {
    if (equipment.some((e) => e.gymId !== gym.id || e.ownerId !== gym.ownerId)) {
      return Promise.resolve({ ok: false, error: 'mismatched_equipment' });
    }
    return this.db.write(async (tx) => {
      const existing = await tx.getFirst('SELECT id FROM gyms WHERE id = ?', [gym.id]);
      if (existing) return { ok: true, duplicate: true };
      const saved = await saveDocumentIn(tx, GYM_SPEC, gym, null);
      if (!saved.ok) return { ok: false, error: 'conflict' };
      for (const eq of equipment) {
        const r = await saveDocumentIn(tx, EQUIPMENT_SPEC, eq, null);
        // Roll back the gym too: all or nothing.
        if (!r.ok) throw new Error(`Equipment ${eq.id} already exists; nothing was saved`);
      }
      return { ok: true, duplicate: false };
    });
  }
}

export class SqliteEquipment extends DocumentRepository<EquipmentInstance> {
  constructor(db: Database) {
    super(db, EQUIPMENT_SPEC);
  }
  listByGym(gymId: string): Promise<EquipmentInstance[]> {
    return this.listWhere('gym_id = ?', [gymId]);
  }

  /**
   * Whether any logged set used this item (gym-editor GE6: its unit is then
   * locked, so history stays comparable). Finished, active or discarded
   * workouts all count: the set exists either way.
   */
  hasLoggedSets(equipmentId: string): Promise<boolean> {
    return this.db.read(async (q) => {
      const row = await q.getFirst(
        `SELECT 1 AS used FROM session_exercises e JOIN session_sets s ON s.session_exercise_id = e.id
         WHERE e.equipment_id = ? AND s.status = 'completed' LIMIT 1`,
        [equipmentId],
      );
      return row !== null;
    });
  }
}

export class SqliteExercises extends DocumentRepository<Exercise> {
  constructor(db: Database) {
    super(db, EXERCISE_SPEC);
  }
  list(): Promise<Exercise[]> {
    return this.listWhere('1 = 1', []);
  }

  /** (19 Oct) Whether any completed set was logged with this exercise (a custom exercise's shape then stays, EL3). */
  hasLoggedSets(exerciseId: string): Promise<boolean> {
    return this.db.read(async (q) => {
      const row = await q.getFirst(
        `SELECT 1 AS used FROM session_exercises e JOIN session_sets s ON s.session_exercise_id = e.id
         WHERE e.exercise_id = ? AND s.status = 'completed' LIMIT 1`,
        [exerciseId],
      );
      return row !== null;
    });
  }

  /**
   * (Review exlist S4) Whether anything holds a load in this exercise's convention: a set logged with
   * it, a workout with it (pending sets in the active one), a routine, an open workout draft, plan or
   * pre-start draft, or a live next-session target. A custom exercise's shape then stays (EL3).
   * IDs are UUIDs, so a match inside a document's JSON is that exercise.
   */
  isInUse(exerciseId: string): Promise<boolean> {
    return this.db.read(async (q) => {
      const like = `%"${exerciseId}"%`;
      const row = await q.getFirst(
        `SELECT 1 AS used WHERE
           EXISTS (SELECT 1 FROM session_exercises WHERE exercise_id = ?)
           OR EXISTS (SELECT 1 FROM routines WHERE data LIKE ?)
           OR EXISTS (SELECT 1 FROM workout_drafts WHERE status = 'open' AND data LIKE ?)
           OR EXISTS (SELECT 1 FROM plan_drafts WHERE status = 'open' AND data LIKE ?)
           OR EXISTS (SELECT 1 FROM pre_start_drafts WHERE status = 'open' AND data LIKE ?)
           OR EXISTS (SELECT 1 FROM next_session_targets WHERE exercise_id = ? AND status IN ('saved', 'proposed'))`,
        [exerciseId, like, like, like, like, exerciseId],
      );
      return row !== null;
    });
  }
}

/** A template write: saved, a stale version (rule 5), or another live template already holds the key (§4.2). */
export type TemplateSaveResult = SaveResult | { ok: false; error: 'duplicate_template'; existingId: string };

/**
 * Save a routine inside a caller's transaction, refusing a second live
 * template for the same (plan, split day, main lift) with a result rather
 * than the unique index's error (workout-builder v3 §4.2). The atomic
 * Start (§4.6) calls this in the session's own transaction.
 */
export async function saveRoutineTemplateIn(tx: SqlExecutor, record: Routine, expectedVersion: number | null): Promise<TemplateSaveResult> {
  const p = record.planDay;
  if (p !== undefined && (record.deletedAtUtc ?? null) === null) {
    const other = await tx.getFirst<{ id: string }>(`SELECT id FROM routines WHERE owner_id = ? AND id <> ? AND ${LIVE_TEMPLATE_SQL}`, [record.ownerId, record.id, p.planId, p.splitDayId, p.mainLiftExerciseId ?? '-']);
    if (other !== null) return { ok: false, error: 'duplicate_template', existingId: other.id };
  }
  return saveDocumentIn(tx, ROUTINE_SPEC, record, expectedVersion);
}

export class SqliteRoutines extends DocumentRepository<Routine> {
  constructor(db: Database) {
    super(db, ROUTINE_SPEC);
  }
  listByOwner(ownerId: string): Promise<Routine[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }

  /** Live plan-day templates of one plan (§4.2). */
  listTemplates(ownerId: string, planId: string): Promise<Routine[]> {
    return this.listWhere("owner_id = ? AND json_extract(data, '$.planDay.planId') = ? AND json_extract(data, '$.deletedAtUtc') IS NULL", [ownerId, planId]);
  }

  /** The live template for (plan, split day, main lift), if any. */
  async templateFor(ownerId: string, key: { planId: string; splitDayId: string; mainLiftExerciseId: string | null }): Promise<Routine | null> {
    const rows = await this.listWhere(`owner_id = ? AND ${LIVE_TEMPLATE_SQL}`, [ownerId, key.planId, key.splitDayId, key.mainLiftExerciseId ?? '-']);
    return rows[0] ?? null;
  }

  /** `save`, with the one-template-per-key check in the same transaction. */
  saveTemplate(record: Routine, expectedVersion: number | null): Promise<TemplateSaveResult> {
    return this.db.write((tx) => saveRoutineTemplateIn(tx, record, expectedVersion));
  }
}

/** Pre-workout check-ins (Your data). */
export class SqliteCheckIns extends DocumentRepository<CheckIn> {
  constructor(db: Database) {
    super(db, CHECK_IN_SPEC);
  }

  /** Check-ins recorded at or after `sinceUtc`, newest first (deleted ones included; callers filter). */
  async listSince(ownerId: string, sinceUtc: string): Promise<CheckIn[]> {
    const rows = await this.listWhere('owner_id = ? AND recorded_at_utc >= ?', [ownerId, sinceUtc]);
    return rows.sort((a, b) => (a.recordedAt.utc < b.recordedAt.utc ? 1 : a.recordedAt.utc > b.recordedAt.utc ? -1 : 0));
  }

  /** IDs among `ids` that a workout already links to (`sessions.check_in_id`). */
  linkedIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return Promise.resolve(new Set());
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ check_in_id: string }>(
        `SELECT check_in_id FROM sessions WHERE check_in_id IN (${ids.map(() => '?').join(', ')})`,
        ids,
      );
      return new Set(rows.map((r) => r.check_in_id));
    });
  }
}

/** Pain flags (Your data; rule 9). */
export class SqlitePainFlags extends DocumentRepository<PainFlag> {
  constructor(db: Database) {
    super(db, PAIN_FLAG_SPEC);
  }
  listByOwner(ownerId: string): Promise<PainFlag[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }
  listActive(ownerId: string): Promise<PainFlag[]> {
    return this.listWhere("owner_id = ? AND status = 'active'", [ownerId]);
  }
}

export const DOCUMENT_TABLES: readonly DocumentTable[] = [
  erase(PROFILE_SPEC),
  erase(GYM_SPEC),
  erase(EQUIPMENT_SPEC),
  erase(EXERCISE_SPEC),
  erase(ROUTINE_SPEC),
  erase(PROGRESSION_RULE_SPEC),
  erase(CHECK_IN_SPEC),
  erase(PAIN_FLAG_SPEC),
];

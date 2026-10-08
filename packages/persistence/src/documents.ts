import {
  EquipmentInstanceSchema,
  ExerciseSchema,
  GymSchema,
  ProgressionRuleSchema,
  RoutineSchema,
  UserProfileSchema,
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
export const PROGRESSION_RULE_SPEC: DocumentSpec<ProgressionRule> = {
  table: 'progression_rules',
  schema: ProgressionRuleSchema,
  columns: (r) => ({ owner_id: r.ownerId }),
};

/** A document table with its type erased, for whole-database checks. */
export interface DocumentTable {
  table: string;
  decode(row: SqlRow): unknown;
}

const erase = <T extends Versioned>(spec: DocumentSpec<T>): DocumentTable => ({
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
    return this.db.write(async (tx) => {
      const valid = checkWrite(this.spec.schema, record, this.spec.table, record.id);
      const current = await tx.getFirst<{ version: number }>(`SELECT version FROM ${ident(this.spec.table)} WHERE id = ?`, [valid.id]);
      const currentVersion = current?.version ?? null;
      if (currentVersion !== expectedVersion) return { ok: false, error: 'conflict', currentVersion };
      const row = {
        id: valid.id,
        version: valid.version,
        updated_at_utc: valid.updatedAtUtc,
        ...this.spec.columns(valid),
        data: JSON.stringify(valid),
      };
      if (current === null) await insert(tx, this.spec.table, row);
      else await upsert(tx, this.spec.table, ['id'], row);
      return { ok: true, version: valid.version };
    });
  }

  /** Rows matching `where` (trusted SQL from this package), ordered by id. */
  protected listWhere(where: string, params: readonly SqlValue[]): Promise<T[]> {
    return this.db.read((q) => listDocuments(q, this.spec, where, params));
  }
}

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
}

export class SqliteEquipment extends DocumentRepository<EquipmentInstance> {
  constructor(db: Database) {
    super(db, EQUIPMENT_SPEC);
  }
  listByGym(gymId: string): Promise<EquipmentInstance[]> {
    return this.listWhere('gym_id = ?', [gymId]);
  }
}

export class SqliteExercises extends DocumentRepository<Exercise> {
  constructor(db: Database) {
    super(db, EXERCISE_SPEC);
  }
  list(): Promise<Exercise[]> {
    return this.listWhere('1 = 1', []);
  }
}

export class SqliteRoutines extends DocumentRepository<Routine> {
  constructor(db: Database) {
    super(db, ROUTINE_SPEC);
  }
  listByOwner(ownerId: string): Promise<Routine[]> {
    return this.listWhere('owner_id = ?', [ownerId]);
  }
}

export const DOCUMENT_TABLES: readonly DocumentTable[] = [
  erase(PROFILE_SPEC),
  erase(GYM_SPEC),
  erase(EQUIPMENT_SPEC),
  erase(EXERCISE_SPEC),
  erase(ROUTINE_SPEC),
  erase(PROGRESSION_RULE_SPEC),
];

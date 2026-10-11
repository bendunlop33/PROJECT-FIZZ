import type { SqlExecutor, SqlRow } from './driver';
import { exportTables } from './backup/backup';
import { readUserVersion } from './migrations';

/**
 * The two data domains (CLAUDE.md rule 10, design-system §7.2,
 * data-import-export DX11): **Your data** (owner-scoped, about Ben) and
 * **Coaching knowledge** (general, no owner).
 *
 * Every table at the current schema is listed here, so a new table can't
 * slip past `Delete my data`, `Reset coaching knowledge` or an export: a
 * table that isn't classified makes `domainOf` throw, and a test compares
 * this list with `sqlite_master`.
 *
 * `exercises` holds both: a row with no owner is the catalogue / starter
 * list (Coaching knowledge); a row with an owner is one Ben made (an import's
 * `Add new`), owner-scoped like everything else he made. This matches the
 * restore preview's rule (`isSharedKnowledge`). Open decision B12 would move
 * custom exercise definitions to Coaching knowledge; until Ben decides, the
 * owner column is the rule.
 */
export type DataDomain = 'your_data' | 'coaching_knowledge';

/** Tables whose every row is Your data. */
export const YOUR_DATA_TABLES = [
  'profiles',
  'gyms',
  'equipment',
  'routines',
  'progression_rules',
  'sessions',
  'session_pauses',
  'session_exercises',
  'session_sets',
  'rest_timers',
  'work_intervals',
  'set_audit',
  'timing_audit',
  'processed_operations',
  'check_ins',
  'pain_flags',
  'import_jobs',
  'import_rows',
  'exercise_aliases',
  'coach_threads',
  'coach_turns',
  'coach_messages',
  'coach_actions',
  'memories',
  'next_session_targets',
  'next_target_uses',
  'coach_offers',
] as const;

/** Tables whose every row is Coaching knowledge. */
export const KNOWLEDGE_TABLES = ['playbook_candidates'] as const;

/** Tables that hold both, split by the row's `owner_id`. */
export const SPLIT_TABLES = ['exercises'] as const;

export const CLASSIFIED_TABLES: readonly string[] = [...YOUR_DATA_TABLES, ...KNOWLEDGE_TABLES, ...SPLIT_TABLES];

export class UnclassifiedTableError extends Error {
  constructor(readonly table: string) {
    super(`Table ${table} isn't assigned to Your data or Coaching knowledge`);
    this.name = 'UnclassifiedTableError';
  }
}

export function domainOf(table: string, row: SqlRow): DataDomain {
  if ((YOUR_DATA_TABLES as readonly string[]).includes(table)) return 'your_data';
  if ((KNOWLEDGE_TABLES as readonly string[]).includes(table)) return 'coaching_knowledge';
  if ((SPLIT_TABLES as readonly string[]).includes(table)) return row.owner_id === null || row.owner_id === undefined ? 'coaching_knowledge' : 'your_data';
  throw new UnclassifiedTableError(table);
}

/** Every table's rows that belong to `domain` (all tables present, possibly empty). */
export function filterDomain(tables: Record<string, readonly SqlRow[]>, domain: DataDomain): Record<string, SqlRow[]> {
  const out: Record<string, SqlRow[]> = {};
  for (const [table, rows] of Object.entries(tables)) out[table] = rows.filter((r) => domainOf(table, r) === domain);
  return out;
}

/** Counts per domain, for the Delete / Reset screens and their confirmation. */
export interface DomainCounts {
  yourData: {
    workouts: number;
    sets: number;
    gyms: number;
    routines: number;
    checkIns: number;
    painFlags: number;
    memories: number;
    coachThreads: number;
    imports: number;
    /** Every Your-data row in every table (0 = nothing about Ben is stored). */
    records: number;
  };
  coachingKnowledge: {
    exercises: number;
    playbookCandidates: number;
    records: number;
  };
}

export function countDomains(tables: Record<string, readonly SqlRow[]>): DomainCounts {
  const mine = filterDomain(tables, 'your_data');
  const known = filterDomain(tables, 'coaching_knowledge');
  const n = (t: Record<string, SqlRow[]>, name: string) => t[name]?.length ?? 0;
  const total = (t: Record<string, SqlRow[]>) => Object.values(t).reduce((s, rows) => s + rows.length, 0);
  const sessions = mine.sessions ?? [];
  const finished = new Set(sessions.filter((s) => s.status === 'finished').map((s) => s.id));
  return {
    yourData: {
      workouts: finished.size,
      sets: (mine.session_sets ?? []).filter((s) => s.status === 'completed' && finished.has(s.session_id ?? null)).length,
      gyms: n(mine, 'gyms'),
      routines: n(mine, 'routines'),
      checkIns: n(mine, 'check_ins'),
      painFlags: n(mine, 'pain_flags'),
      memories: (mine.memories ?? []).filter((m) => m.status === 'active').length,
      coachThreads: n(mine, 'coach_threads'),
      imports: n(mine, 'import_jobs'),
      records: total(mine),
    },
    coachingKnowledge: {
      exercises: n(known, 'exercises'),
      playbookCandidates: (known.playbook_candidates ?? []).filter((c) => c.status === 'to_review').length,
      records: total(known),
    },
  };
}

/** Columns declared `json_valid(...)` in a table's CREATE statement (for a readable export). */
async function jsonColumns(q: SqlExecutor, table: string): Promise<Set<string>> {
  const row = await q.getFirst<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
  const out = new Set<string>();
  for (const m of (row?.sql ?? '').matchAll(/json_valid\(\s*"?(\w+)"?\s*\)/g)) if (m[1]) out.add(m[1]);
  return out;
}

/**
 * One domain's rows, for `Export: My data` / `Coaching knowledge only`
 * (data-import-export §2.6, §4.4). JSON columns are parsed so the file reads
 * as data rather than escaped strings. Tables with no rows in the domain are
 * left out. Not restorable (backups are).
 */
export async function exportDomain(q: SqlExecutor, domain: DataDomain): Promise<{ schemaVersion: number; tables: Record<string, Record<string, unknown>[]> }> {
  const schemaVersion = await readUserVersion(q);
  const all = await exportTables(q);
  const picked = filterDomain(all, domain);
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [table, rows] of Object.entries(picked)) {
    if (rows.length === 0) continue;
    const json = await jsonColumns(q, table);
    tables[table] = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [col, value] of Object.entries(row)) {
        if (json.has(col) && typeof value === 'string') {
          try {
            out[col] = JSON.parse(value) as unknown;
            continue;
          } catch {
            // Stored text that isn't JSON is exported as it is.
          }
        }
        out[col] = value;
      }
      return out;
    });
  }
  return { schemaVersion, tables };
}

/** Every string in a row, JSON columns opened (to find which exercise IDs Your data uses). */
function stringsIn(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    out.add(value);
    if ((value.startsWith('{') || value.startsWith('[')) && value.length > 1) {
      try {
        stringsIn(JSON.parse(value) as unknown, out);
      } catch {
        // Not JSON.
      }
    }
  } else if (Array.isArray(value)) {
    for (const v of value) stringsIn(v, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) stringsIn(v, out);
  }
}

/**
 * IDs of Coaching-knowledge exercises that Your data refers to anywhere
 * (workouts, routines, pain flags, targets, import answers…). A reset keeps
 * these so nothing of Ben's points at a missing exercise (open-decisions
 * "For the developer" §1). Deliberately broad: any string equal to the ID.
 */
export function knowledgeExercisesInUse(tables: Record<string, readonly SqlRow[]>): Set<string> {
  const ids = new Set((tables.exercises ?? []).filter((r) => domainOf('exercises', r) === 'coaching_knowledge').map((r) => String(r.id)));
  const seen = new Set<string>();
  for (const rows of Object.values(filterDomain(tables, 'your_data'))) for (const row of rows) stringsIn(row, seen);
  return new Set([...ids].filter((id) => seen.has(id)));
}

/** Tables at this database's schema (for the classification test). */
export async function userTables(q: SqlExecutor): Promise<string[]> {
  const rows = await q.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((r) => r.name);
}

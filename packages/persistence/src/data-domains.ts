import type { Database } from './database';
import type { SqlExecutor, SqlRow } from './driver';
import { exportTables } from './backup/backup';
import { noYield, type Slicer } from './backup/slice';
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
  // Today's edits before a workout starts (main's ADR 0022, migration 7): owner-scoped, Ben's choices.
  'pre_start_drafts',
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

/** One domain's rows as exported (JSON columns opened). */
export interface DomainExport {
  schemaVersion: number;
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * Counts per domain straight from SQL (review S3): no row is read into JS,
 * so the Export screen gets its counts in milliseconds on any history.
 * Equal to `countDomains` over every table (tested). An unclassified table
 * throws, as `countDomains` does.
 */
export async function countDomainsIn(q: SqlExecutor): Promise<DomainCounts> {
  const count = async (sql: string): Promise<number> => (await q.getFirst<{ n: number }>(sql))?.n ?? 0;
  const mine: Record<string, number> = {};
  const known: Record<string, number> = {};
  for (const table of await userTables(q)) {
    const quoted = `"${table.replaceAll('"', '""')}"`;
    if ((YOUR_DATA_TABLES as readonly string[]).includes(table)) mine[table] = await count(`SELECT COUNT(*) AS n FROM ${quoted}`);
    else if ((KNOWLEDGE_TABLES as readonly string[]).includes(table)) known[table] = await count(`SELECT COUNT(*) AS n FROM ${quoted}`);
    else if ((SPLIT_TABLES as readonly string[]).includes(table)) {
      mine[table] = await count(`SELECT COUNT(*) AS n FROM ${quoted} WHERE owner_id IS NOT NULL`);
      known[table] = await count(`SELECT COUNT(*) AS n FROM ${quoted} WHERE owner_id IS NULL`);
    } else throw new UnclassifiedTableError(table);
  }
  const sum = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);
  return {
    yourData: {
      workouts: await count("SELECT COUNT(*) AS n FROM sessions WHERE status = 'finished'"),
      sets: await count("SELECT COUNT(*) AS n FROM session_sets s JOIN sessions x ON x.id = s.session_id WHERE s.status = 'completed' AND x.status = 'finished'"),
      gyms: mine.gyms ?? 0,
      routines: mine.routines ?? 0,
      checkIns: mine.check_ins ?? 0,
      painFlags: mine.pain_flags ?? 0,
      memories: await count("SELECT COUNT(*) AS n FROM memories WHERE status = 'active'"),
      coachThreads: mine.coach_threads ?? 0,
      imports: mine.import_jobs ?? 0,
      records: sum(mine),
    },
    coachingKnowledge: {
      exercises: known.exercises ?? 0,
      playbookCandidates: await count("SELECT COUNT(*) AS n FROM playbook_candidates WHERE status = 'to_review'"),
      records: sum(known),
    },
  };
}

/**
 * One domain's rows, for `Export: My data` / `Coaching knowledge only`
 * (data-import-export §2.6, §4.4). JSON columns are parsed so the file reads
 * as data rather than escaped strings. Tables with no rows in the domain are
 * left out. Not restorable (backups are).
 *
 * As `createBackup` does (backup review B1, your-data-merge S1), only the
 * paged read holds the store queue; filtering and parsing run after it, with
 * `slice()` between rows.
 */
export async function exportDomain(db: Pick<Database, 'read'>, domain: DataDomain, slice: Slicer = noYield): Promise<DomainExport> {
  const { schemaVersion, all, json } = await db.read(async (q) => {
    const all = await exportTables(q, slice);
    const json = new Map<string, Set<string>>();
    for (const table of Object.keys(all)) json.set(table, await jsonColumns(q, table));
    return { schemaVersion: await readUserVersion(q), all, json };
  });
  await slice();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [table, rows] of Object.entries(all)) {
    const cols = json.get(table) ?? new Set<string>();
    const out: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (domainOf(table, row) !== domain) continue;
      const shaped: Record<string, unknown> = {};
      for (const [col, value] of Object.entries(row)) {
        if (cols.has(col) && typeof value === 'string') {
          try {
            shaped[col] = JSON.parse(value) as unknown;
            continue;
          } catch {
            // Stored text that isn't JSON is exported as it is.
          }
        }
        shaped[col] = value;
      }
      out.push(shaped);
      await slice();
    }
    if (out.length > 0) tables[table] = out;
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
export async function knowledgeExercisesInUse(tables: Record<string, readonly SqlRow[]>, slice: Slicer = noYield): Promise<Set<string>> {
  const ids = new Set((tables.exercises ?? []).filter((r) => domainOf('exercises', r) === 'coaching_knowledge').map((r) => String(r.id)));
  const seen = new Set<string>();
  // Sliced per row (your-data-merge S1): a 2-year history held the JS thread for ~150-260 ms in one go.
  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows) {
      if (domainOf(table, row) !== 'your_data') continue;
      stringsIn(row, seen);
      await slice();
    }
  }
  return new Set([...ids].filter((id) => seen.has(id)));
}

/** Tables at this database's schema (for the classification test). */
export async function userTables(q: SqlExecutor): Promise<string[]> {
  const rows = await q.getAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((r) => r.name);
}

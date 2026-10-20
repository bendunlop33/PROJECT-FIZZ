import { stableStringify } from '@fizz/domain';

import type { SqlRow } from '../driver';
import { rowInHistory } from '../sql';
import { noYield, type Slicer } from './slice';

/**
 * What a restore replaces (data-import-export §2.3, PM decision on review
 * SP3, 2026-10-09). A record on this phone counts as **replaced** when the
 * backup doesn't have it, or has it with different content. On top of that,
 * a restore deletes the database kept for `Undo last restore`; anything in it
 * that is neither on this phone now nor in the backup is lost with it, so it
 * is counted too (review S2). Discarded, reverted and deleted workouts
 * aren't counted as workouts; deleted ones the backup has live are counted
 * on their own (delete-workouts §6.5).
 *
 * Records are compared by full content when both sides are at the same
 * schema version. When they aren't (an older backup, or an Undo copy left
 * from before an app update), they are compared by their version stamps
 * (`version`/`updated_at_utc`, and a workout's `revision`), which every write
 * through the app bumps.
 *
 * Only **Your data** is counted (rule 10; PM decision RS1 on the re-review,
 * 2026-10-09). Shared Coaching-knowledge rows (the starter list and catalogue
 * exercises, which have no owner) are never counted as replaced, changed or
 * lost: they are re-seeded by catalogue key at every launch, and each install
 * stamps its own copy with its own first-launch time, so comparing them would
 * report records that don't exist (review R1).
 */

type Tables = Record<string, readonly SqlRow[]>;

export interface ReplaceCounts {
  /** Finished or unfinished workouts. */
  workouts: number;
  newestWorkoutUtc: string | null;
  /** Profiles, gyms, equipment, custom exercises, routines, rules, check-ins, pain flags, import jobs, remembered names, coach conversations, memories and saved variations (Your data only). */
  otherRecords: number;
}

/** Owner data tables whose rows a restore can replace (workouts are counted separately). */
export const OTHER_RECORD_TABLES = ['profiles', 'gyms', 'equipment', 'exercises', 'routines', 'progression_rules', 'check_ins', 'pain_flags', 'import_jobs', 'exercise_aliases', 'coach_threads', 'memories', 'plan_day_variations'] as const;

export type CompareMode = 'content' | 'stamp';

/**
 * Coaching knowledge: a row in a table with an `owner_id` column whose owner
 * is null (today only starter/catalogue exercises). Profiles have no
 * `owner_id`; they are the owner.
 */
export function isSharedKnowledge(row: SqlRow): boolean {
  return 'owner_id' in row && row.owner_id === null;
}

function keyOf(row: SqlRow): string {
  return typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : stableStringify(row);
}

/** One fingerprint per record ID, per table; workouts include every row that hangs off them. */
interface Fingerprints {
  workouts: Map<string, { print: string; startedAtUtc: string | null }>;
  other: Map<string, Map<string, string>>;
}

async function fingerprints(tables: Tables, mode: CompareMode, slice: Slicer): Promise<Fingerprints> {
  const children = new Map<string, string[]>();
  if (mode === 'content') {
    for (const [name, rows] of Object.entries(tables)) {
      if (name === 'sessions') continue;
      for (const row of rows) {
        const sid = row.session_id;
        if (typeof sid !== 'string') continue;
        const list = children.get(sid) ?? [];
        list.push(`${name}:${stableStringify(row)}`);
        children.set(sid, list);
        await slice();
      }
    }
  }
  const workouts = new Map<string, { print: string; startedAtUtc: string | null }>();
  for (const s of tables.sessions ?? []) {
    // Only history counts (delete-workouts §5): discarded, reverted (undone import) and deleted workouts are hidden
    // everywhere, so a restore doesn't count them as replaced. Deleted ones are counted on their own (`deletedSinceBackup`).
    if (!rowInHistory(s) && s.status !== 'active') continue;
    const id = keyOf(s);
    const print =
      mode === 'content'
        ? stableStringify({ s, c: [...(children.get(id) ?? [])].sort() })
        : stableStringify([s.status, s.version, s.revision, s.last_activity_at_utc]);
    workouts.set(id, { print, startedAtUtc: typeof s.started_at_utc === 'string' ? s.started_at_utc : null });
    await slice();
  }
  const other = new Map<string, Map<string, string>>();
  for (const t of OTHER_RECORD_TABLES) {
    const m = new Map<string, string>();
    for (const r of tables[t] ?? []) {
      if (isSharedKnowledge(r)) continue;
      m.set(keyOf(r), mode === 'content' ? stableStringify(r) : stableStringify([r.version, r.updated_at_utc]));
      await slice();
    }
    other.set(t, m);
  }
  return { workouts, other };
}

/** Records of `side` that none of `others` hold with the same fingerprint. */
function notIn(side: Fingerprints, others: readonly Fingerprints[], match: 'absent' | 'differs' | 'either'): ReplaceCounts {
  const wanted = (have: readonly (string | undefined)[], print: string): boolean => {
    const present = have.some((p) => p !== undefined);
    const same = have.some((p) => p === print);
    if (match === 'absent') return !present;
    if (match === 'differs') return present && !same;
    return !same;
  };
  let workouts = 0;
  const started: string[] = [];
  for (const [id, w] of side.workouts) {
    if (!wanted(others.map((o) => o.workouts.get(id)?.print), w.print)) continue;
    workouts += 1;
    if (w.startedAtUtc !== null) started.push(w.startedAtUtc);
  }
  let otherRecords = 0;
  for (const [t, rows] of side.other) {
    for (const [id, print] of rows) if (wanted(others.map((o) => o.other.get(t)?.get(id)), print)) otherRecords += 1;
  }
  started.sort();
  return { workouts, newestWorkoutUtc: started.at(-1) ?? null, otherRecords };
}

export interface ReplaceAnalysis {
  /** On this phone, not in the backup. */
  onlyOnPhone: ReplaceCounts;
  /** On this phone and in the backup, with different content (changed since, or another history). */
  changedOnPhone: ReplaceCounts;
  /**
   * In the data kept for `Undo last restore` and in neither this phone's data
   * nor the backup: the restore deletes that copy, so these are lost. Null
   * when no copy is kept.
   */
  keptForUndo: ReplaceCounts | null;
  /**
   * Workouts deleted on this phone (in Recently deleted, awaiting the purge,
   * or purged) that the backup holds as live history: the restore brings
   * them back (delete-workouts §6.5; `Keep deleted`, DW28, isn't built and
   * waits on DW-Q4).
   */
  deletedSinceBackup: number;
}

/** Workouts this phone deleted or purged that `backup` has in history (§6.5). */
export function deletedSince(current: Tables, backup: Tables): number {
  const gone = new Set<string>();
  for (const s of current.sessions ?? []) if (s.status === 'deleted') gone.add(keyOf(s));
  for (const p of current.purged_sessions ?? []) if (typeof p.session_id === 'string') gone.add(p.session_id);
  if (gone.size === 0) return 0;
  return (backup.sessions ?? []).filter((s) => rowInHistory(s) && gone.has(keyOf(s))).length;
}

/** `slice` pauses between records so a large history never holds the JS thread (backup review B1). */
export async function analyseReplace(
  input: {
    current: { schemaVersion: number; tables: Tables };
    backup: { schemaVersion: number; tables: Tables };
    /** The rollback database, or null when none is kept (or it's empty). */
    kept: { schemaVersion: number; tables: Tables } | null;
  },
  slice: Slicer = noYield,
): Promise<ReplaceAnalysis> {
  const pairMode: CompareMode = input.current.schemaVersion === input.backup.schemaVersion ? 'content' : 'stamp';
  const current = await fingerprints(input.current.tables, pairMode, slice);
  const backup = await fingerprints(input.backup.tables, pairMode, slice);
  let keptForUndo: ReplaceCounts | null = null;
  if (input.kept !== null) {
    const allSame = pairMode === 'content' && input.kept.schemaVersion === input.current.schemaVersion;
    const mode: CompareMode = allSame ? 'content' : 'stamp';
    const k = await fingerprints(input.kept.tables, mode, slice);
    const c = allSame ? current : await fingerprints(input.current.tables, mode, slice);
    const b = allSame ? backup : await fingerprints(input.backup.tables, mode, slice);
    keptForUndo = notIn(k, [c, b], 'either');
  }
  return {
    onlyOnPhone: notIn(current, [backup], 'absent'),
    changedOnPhone: notIn(current, [backup], 'differs'),
    keptForUndo,
    deletedSinceBackup: deletedSince(input.current.tables, input.backup.tables),
  };
}

/** True when the restore would replace or delete anything (the confirm alert shows). */
export function replacesAnything(a: ReplaceAnalysis): boolean {
  const n = (c: ReplaceCounts | null) => (c === null ? 0 : c.workouts + c.otherRecords);
  return n(a.onlyOnPhone) + n(a.changedOnPhone) + n(a.keptForUndo) + a.deletedSinceBackup > 0;
}

/**
 * What in a database kept for Undo isn't on this phone, so dropping that copy
 * loses it (review r5 B1: Reset drops the copy too). Your data only.
 * - `absent`: only records whose ID is gone. For a copy that is an earlier
 *   state of this same data (kept by Reset or its Undo, which copy every
 *   Your-data row), a different version is an older one, not a lost one.
 * - `either`: also records whose content differs (a copy kept by a restore
 *   is another history), as the restore preview counts it.
 */
export async function keptOnly(
  input: {
    current: { schemaVersion: number; tables: Tables };
    kept: { schemaVersion: number; tables: Tables };
    match: 'absent' | 'either';
  },
  slice: Slicer = noYield,
): Promise<ReplaceCounts> {
  const mode: CompareMode = input.current.schemaVersion === input.kept.schemaVersion ? 'content' : 'stamp';
  const kept = await fingerprints(input.kept.tables, mode, slice);
  const current = await fingerprints(input.current.tables, mode, slice);
  return notIn(kept, [current], input.match);
}

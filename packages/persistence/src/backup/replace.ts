import { stableStringify } from '@fizz/domain';

import type { SqlRow } from '../driver';

/**
 * What a restore replaces (data-import-export §2.3, PM decision on review
 * SP3, 2026-10-09). A record on this phone counts as **replaced** when the
 * backup doesn't have it, or has it with different content. On top of that,
 * a restore deletes the database kept for `Undo last restore`; anything in it
 * that is neither on this phone now nor in the backup is lost with it, so it
 * is counted too (review S2). Discarded workouts aren't counted.
 *
 * Records are compared by full content when both sides are at the same
 * schema version. When they aren't (an older backup, or an Undo copy left
 * from before an app update), they are compared by their version stamps
 * (`version`/`updated_at_utc`, and a workout's `revision`), which every write
 * through the app bumps.
 */

type Tables = Record<string, readonly SqlRow[]>;

export interface ReplaceCounts {
  /** Finished or unfinished workouts. */
  workouts: number;
  newestWorkoutUtc: string | null;
  /** Profiles, gyms, equipment, exercises, routines, rules, check-ins and pain flags. */
  otherRecords: number;
}

/** Owner data tables whose rows a restore can replace (workouts are counted separately). */
export const OTHER_RECORD_TABLES = ['profiles', 'gyms', 'equipment', 'exercises', 'routines', 'progression_rules', 'check_ins', 'pain_flags'] as const;

export type CompareMode = 'content' | 'stamp';

function keyOf(row: SqlRow): string {
  return typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : stableStringify(row);
}

/** One fingerprint per record ID, per table; workouts include every row that hangs off them. */
interface Fingerprints {
  workouts: Map<string, { print: string; startedAtUtc: string | null }>;
  other: Map<string, Map<string, string>>;
}

function fingerprints(tables: Tables, mode: CompareMode): Fingerprints {
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
      }
    }
  }
  const workouts = new Map<string, { print: string; startedAtUtc: string | null }>();
  for (const s of tables.sessions ?? []) {
    if (s.status === 'discarded') continue;
    const id = keyOf(s);
    const print =
      mode === 'content'
        ? stableStringify({ s, c: [...(children.get(id) ?? [])].sort() })
        : stableStringify([s.status, s.version, s.revision, s.last_activity_at_utc]);
    workouts.set(id, { print, startedAtUtc: typeof s.started_at_utc === 'string' ? s.started_at_utc : null });
  }
  const other = new Map<string, Map<string, string>>();
  for (const t of OTHER_RECORD_TABLES) {
    const m = new Map<string, string>();
    for (const r of tables[t] ?? []) m.set(keyOf(r), mode === 'content' ? stableStringify(r) : stableStringify([r.version, r.updated_at_utc]));
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
}

export function analyseReplace(input: {
  current: { schemaVersion: number; tables: Tables };
  backup: { schemaVersion: number; tables: Tables };
  /** The rollback database, or null when none is kept (or it's empty). */
  kept: { schemaVersion: number; tables: Tables } | null;
}): ReplaceAnalysis {
  const pairMode: CompareMode = input.current.schemaVersion === input.backup.schemaVersion ? 'content' : 'stamp';
  const current = fingerprints(input.current.tables, pairMode);
  const backup = fingerprints(input.backup.tables, pairMode);
  let keptForUndo: ReplaceCounts | null = null;
  if (input.kept !== null) {
    const allSame = pairMode === 'content' && input.kept.schemaVersion === input.current.schemaVersion;
    const mode: CompareMode = allSame ? 'content' : 'stamp';
    const k = fingerprints(input.kept.tables, mode);
    const c = allSame ? current : fingerprints(input.current.tables, mode);
    const b = allSame ? backup : fingerprints(input.backup.tables, mode);
    keptForUndo = notIn(k, [c, b], 'either');
  }
  return {
    onlyOnPhone: notIn(current, [backup], 'absent'),
    changedOnPhone: notIn(current, [backup], 'differs'),
    keptForUndo,
  };
}

/** True when the restore would replace or delete anything (the confirm alert shows). */
export function replacesAnything(a: ReplaceAnalysis): boolean {
  const n = (c: ReplaceCounts | null) => (c === null ? 0 : c.workouts + c.otherRecords);
  return n(a.onlyOnPhone) + n(a.changedOnPhone) + n(a.keptForUndo) > 0;
}

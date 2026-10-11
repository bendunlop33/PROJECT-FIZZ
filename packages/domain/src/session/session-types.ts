/**
 * Session types for the session picker (session-picker.md §3): what Ben can
 * choose to train today, which one is recommended and why, and the order the
 * picker lists them in. Pure: callers pass `now`; nothing reads the clock,
 * storage or the coach.
 *
 * - `categoryLabel` (§3.2): an unnamed FitNotes import's label from its
 *   working sets' `Category` cells (`Legs`, `Chest + Triceps`), or null.
 * - `deriveSessionTypes` (§3.1): routines, named workouts and (imports only)
 *   category groups, one row per normalised name.
 * - `recommendSession` (§3.3): the D19 rotation when it applies, else the
 *   active type with the longest gap since it was last done.
 * - `orderSessionTypes` (§3.3): recommended first, longest gap first,
 *   never-done routines, then `OLDER`.
 * - `formatLastDone` (§6): `Today` / `Yesterday` / `N days ago` / `14 Aug`.
 */
import type { ZonedTimestamp } from '@fizz/schemas';

import { daysBetween, localDateOf } from '../calendar';
import { dayMonthText } from '../display';
import { toMs } from '../time';
import { storedWorkoutName } from './first-run';
import { isFromRoutine, nextInRotation, type FinishedRef } from './routines';

/** Types not done for more than this many days are listed under `OLDER` and never recommended (SP-D3). */
export const OLDER_AFTER_DAYS = 42;

/** `N days ago` is used under this many days; older dates are absolute (`14 Aug`). */
export const RELATIVE_DAYS_MAX = 13;

// ---------------------------------------------------------------------------
// Names

/** A workout name as grouping compares it (§3.1): trimmed, spaces collapsed, case-folded. */
export function normaliseSessionName(name: string): string {
  return displaySessionName(name).toLowerCase();
}

/** A name as shown: trimmed with spaces collapsed, Ben's spelling otherwise kept. */
function displaySessionName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

const nameKey = (normalised: string): string => `name:${normalised}`;
const routineKey = (routineId: string): string => `routine:${routineId}`;

// ---------------------------------------------------------------------------
// Category label (§3.2)

/** Share of working sets a single category needs to name a session. */
const SINGLE_SHARE = 0.6;
/** Each of the top two needs this share, and together `PAIR_SHARE`, for `Chest + Triceps`. */
const PAIR_EACH_SHARE = 0.25;
const PAIR_SHARE = 0.8;

export interface CategoryLabel {
  /** As Ben typed it in FitNotes (trimmed); a pair in alphabetical order, joined by ` + `. */
  label: string;
  /** Order- and case-insensitive grouping key (`name:chest + triceps`). */
  key: string;
}

/**
 * The label of an unnamed imported workout from its working sets' FitNotes
 * `Category` cells (category → working-set count). Empty cells are ignored;
 * cells that differ only by surrounding spaces are one category. Null when no
 * category dominates (a mixed session is not a type).
 */
export function categoryLabel(counts: Readonly<Record<string, number>>): CategoryLabel | null {
  const merged = new Map<string, number>();
  for (const [raw, n] of Object.entries(counts)) {
    const name = displaySessionName(raw);
    if (name.length === 0 || !Number.isFinite(n) || n <= 0) continue;
    merged.set(name, (merged.get(name) ?? 0) + n);
  }
  const total = [...merged.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const ranked = [...merged.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  const [first, second] = ranked;
  if (first === undefined) return null;
  if (first[1] / total >= SINGLE_SHARE) return { label: first[0], key: nameKey(normaliseSessionName(first[0])) };
  if (second === undefined) return null;
  const a = first[1] / total;
  const b = second[1] / total;
  if (a < PAIR_EACH_SHARE || b < PAIR_EACH_SHARE || a + b < PAIR_SHARE) return null;
  const pair = [first[0], second[0]].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' }) || x.localeCompare(y, 'en'));
  const label = pair.join(' + ');
  return { label, key: nameKey(normaliseSessionName(label)) };
}

// ---------------------------------------------------------------------------
// Session types (§3.1)

/** A finished workout, as grouping needs it. */
export interface SessionTypeSession {
  id: string;
  routineId: string | null;
  routineName: string | null;
  startedAt: ZonedTimestamp;
  /** Exercises in the workout (the picker's `5 exercises`). */
  exerciseCount: number;
  /** From a FitNotes import (`source: 'import'`). */
  imported: boolean;
  /** Imported only: working-set count per FitNotes `Category` cell (`imports.categoriesBySession`). */
  importCategories?: Readonly<Record<string, number>> | null;
}

/** A live routine, in list order. */
export interface SessionTypeRoutine {
  id: string;
  name: string;
  createdFromSessionId?: string | null | undefined;
  exerciseCount: number;
}

export type SessionTypeKind = 'routine' | 'named' | 'category';

export interface SessionType {
  /** `routine:<id>`, or `name:<normalised label>` for history types. */
  key: string;
  label: string;
  kind: SessionTypeKind;
  routineId: string | null;
  /** The most recent finished workout in the group; null for a routine never done. */
  sourceSessionId: string | null;
  lastDone: ZonedTimestamp | null;
  /** From the source workout, or from the routine. */
  exerciseCount: number;
  /** Last done more than `OLDER_AFTER_DAYS` ago (listed under `OLDER`, never recommended). */
  older: boolean;
}

export interface DeriveSessionTypesInput {
  routines: readonly SessionTypeRoutine[];
  sessions: readonly SessionTypeSession[];
  now: ZonedTimestamp;
}

interface Group {
  key: string;
  kind: SessionTypeKind;
  routine: SessionTypeRoutine | null;
  members: { session: SessionTypeSession; label: string; kind: 'named' | 'category' | 'routine' }[];
}

const startedMs = (s: SessionTypeSession): number => toMs(s.startedAt.utc);

/** Whole calendar days from `at` to `now`, in `now`'s zone. */
function daysSince(at: ZonedTimestamp, now: ZonedTimestamp): number {
  return daysBetween(localDateOf(toMs(at.utc), now.tz), localDateOf(toMs(now.utc), now.tz));
}

/** A session's own history label: its stored name, or (unnamed imports only) its Category label. */
function historyLabelOf(s: SessionTypeSession): { label: string; key: string; kind: 'named' | 'category' } | null {
  const stored = storedWorkoutName(s);
  if (stored !== null) {
    const label = displaySessionName(stored);
    if (label.length === 0) return null;
    return { label, key: nameKey(normaliseSessionName(label)), kind: 'named' };
  }
  if (!s.imported || s.importCategories === undefined || s.importCategories === null) return null;
  const c = categoryLabel(s.importCategories);
  return c === null ? null : { ...c, kind: 'category' };
}

/**
 * Session types from live routines and finished workouts (§3.1). One type
 * per routine (its own workouts, plus unlinked workouts with its name); then
 * one per normalised name across named workouts and unnamed imports'
 * Category labels. Unnamed workouts logged in the app are not types. Returned
 * in routine list order, then by name; `orderSessionTypes` sorts for display.
 */
export function deriveSessionTypes(input: DeriveSessionTypesInput): SessionType[] {
  const groups = new Map<string, Group>();
  const byName = new Map<string, Group>();
  for (const r of input.routines) {
    const g: Group = { key: routineKey(r.id), kind: 'routine', routine: r, members: [] };
    groups.set(g.key, g);
    const n = nameKey(normaliseSessionName(r.name));
    // Two routines can't share a name (checkRoutineName); if they ever do, the first in list order keeps it.
    if (!byName.has(n)) byName.set(n, g);
  }
  for (const s of input.sessions) {
    const ref = { sessionId: s.id, routineId: s.routineId };
    const own = input.routines.find((r) => isFromRoutine(ref, r));
    if (own !== undefined) {
      groups.get(routineKey(own.id))?.members.push({ session: s, label: own.name, kind: 'routine' });
      continue;
    }
    // A workout from a routine that's gone (deleted) stays in Past workouts only (§3.1: named means `routineId: null`).
    if (s.routineId !== null) continue;
    const h = historyLabelOf(s);
    if (h === null) continue;
    const g = byName.get(h.key) ?? { key: h.key, kind: h.kind, routine: null, members: [] };
    if (!byName.has(h.key)) {
      byName.set(h.key, g);
      groups.set(g.key, g);
    }
    g.members.push({ session: s, label: h.label, kind: h.kind });
  }

  const out: SessionType[] = [];
  for (const g of groups.values()) {
    const newest = [...g.members].sort((a, b) => startedMs(b.session) - startedMs(a.session) || a.session.id.localeCompare(b.session.id))[0];
    if (g.routine !== null) {
      out.push({
        key: g.key,
        label: g.routine.name,
        kind: 'routine',
        routineId: g.routine.id,
        sourceSessionId: newest?.session.id ?? null,
        lastDone: newest?.session.startedAt ?? null,
        exerciseCount: g.routine.exerciseCount,
        older: newest !== undefined && daysSince(newest.session.startedAt, input.now) > OLDER_AFTER_DAYS,
      });
      continue;
    }
    if (newest === undefined) continue;
    out.push({
      key: g.key,
      // The most recent spelling (§3.1).
      label: newest.label,
      // A Category group joined by a named workout reads as named (Ben's own name now, SP-D8).
      kind: g.members.some((m) => m.kind === 'named') ? 'named' : 'category',
      routineId: null,
      sourceSessionId: newest.session.id,
      lastDone: newest.session.startedAt,
      exerciseCount: newest.session.exerciseCount,
      older: daysSince(newest.session.startedAt, input.now) > OLDER_AFTER_DAYS,
    });
  }
  // Routines were added first, in list order; history types follow by label.
  const routinesFirst = out.filter((t) => t.kind === 'routine');
  const history = out.filter((t) => t.kind !== 'routine').sort((a, b) => a.label.localeCompare(b.label, 'en') || a.key.localeCompare(b.key));
  return [...routinesFirst, ...history];
}

// ---------------------------------------------------------------------------
// Recommendation (§3.3)

export type SessionRecommendationBasis =
  /** D19 rotation: `After Pull A · Thu 8 Oct`. */
  | { kind: 'after'; routineName: string; at: ZonedTimestamp }
  /** D19 with one routine: `Your only routine`. */
  | { kind: 'only' }
  /** The active type done longest ago: `Last done Mon 5 Oct · 6 days ago`. */
  | { kind: 'longest_gap'; lastDone: ZonedTimestamp }
  /** The only type there is: `From Thu 8 Oct`. */
  | { kind: 'single'; lastDone: ZonedTimestamp };

export interface SessionRecommendation {
  key: string;
  basis: SessionRecommendationBasis;
}

/**
 * Up next (§3.3; SP-D4). 1. The D19 rotation when the last workout came from
 * a routine (`nextInRotation`, unchanged). 2. Else the active type (not
 * `older`, done before) with the oldest `lastDone`, never the type of the
 * last finished workout unless it is the only active one. 3. Else the only
 * type there is, or null.
 * `routines`: live routines in list order. `lastFinished`: the newest finished workout.
 */
export function recommendSession(
  types: readonly SessionType[],
  routines: readonly Pick<SessionTypeRoutine, 'id' | 'name' | 'createdFromSessionId'>[],
  lastFinished: FinishedRef | null,
): SessionRecommendation | null {
  const pick = nextInRotation(routines, lastFinished);
  if (pick.kind === 'routine') {
    const key = routineKey(pick.routine.id);
    if (types.some((t) => t.key === key)) {
      return { key, basis: pick.basis.kind === 'only' ? { kind: 'only' } : { kind: 'after', routineName: pick.basis.routineName, at: { utc: pick.basis.atUtc, tz: pick.basis.tz } } };
    }
  }
  const active = types.filter((t): t is SessionType & { lastDone: ZonedTimestamp } => t.lastDone !== null && !t.older);
  const justDone = lastFinished === null ? null : (types.find((t) => t.sourceSessionId === lastFinished.sessionId)?.key ?? null);
  const pool = active.length > 1 ? active.filter((t) => t.key !== justDone) : active;
  const oldest = [...pool].sort((a, b) => toMs(a.lastDone.utc) - toMs(b.lastDone.utc) || a.key.localeCompare(b.key))[0];
  if (oldest !== undefined) {
    return { key: oldest.key, basis: types.length === 1 ? { kind: 'single', lastDone: oldest.lastDone } : { kind: 'longest_gap', lastDone: oldest.lastDone } };
  }
  const only = types.length === 1 ? types[0] : undefined;
  if (only !== undefined && only.lastDone !== null) return { key: only.key, basis: { kind: 'single', lastDone: only.lastDone } };
  return null;
}

// ---------------------------------------------------------------------------
// Order (§3.3)

export interface OrderedSessionTypes {
  /** Recommended first, then longest gap first, then never-done routines (`New`) in list order. */
  current: SessionType[];
  /** `OLDER`: most recent first. */
  older: SessionType[];
}

/** The picker's order (SP-D3). `types` in `deriveSessionTypes` order (routines in list order first). */
export function orderSessionTypes(types: readonly SessionType[], recommendedKey: string | null): OrderedSessionTypes {
  const rec = types.find((t) => t.key === recommendedKey) ?? null;
  const rest = types.filter((t) => t !== rec);
  const ms = (t: SessionType): number => (t.lastDone === null ? 0 : toMs(t.lastDone.utc));
  const active = rest.filter((t) => t.lastDone !== null && !t.older).sort((a, b) => ms(a) - ms(b) || a.key.localeCompare(b.key));
  const fresh = rest.filter((t) => t.lastDone === null);
  const older = rest.filter((t) => t.lastDone !== null && t.older).sort((a, b) => ms(b) - ms(a) || a.key.localeCompare(b.key));
  return { current: [...(rec ? [rec] : []), ...active, ...fresh], older };
}

// ---------------------------------------------------------------------------
// Copy (§6)

/** `Today` · `Yesterday` · `6 days ago` (under 14 days) · `14 Aug`. Actuals, in `now`'s zone. */
export function formatLastDone(lastDone: ZonedTimestamp, now: ZonedTimestamp): string {
  const d = daysSince(lastDone, now);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= RELATIVE_DAYS_MAX) return `${String(d)} days ago`;
  return dayMonthText(lastDone.utc, now.tz);
}

/**
 * Session types for the session picker (session-picker.md §3): what Ben can
 * choose to train today, which one is recommended and why, and the order the
 * picker lists them in. Pure: callers pass `now`; nothing reads the clock,
 * storage or the coach.
 *
 * - `categoryLabel` (§3.2): an unnamed FitNotes import's label from its
 *   working sets' `Category` cells (`Legs`, `Chest + Triceps`), or null.
 * - `groupSessionTypes` / `deriveSessionTypes` (§3.1): routines, named
 *   workouts and (imports only, Decision 1) category groups, one row per
 *   normalised name, with each workout's type key.
 * - `recommendSession` (§3.3, Decision 2): the D19 rotation when it applies,
 *   else the startable active type with the longest gap since it was last done.
 * - `orderSessionTypes` (§3.3): recommended first, longest gap first,
 *   never-done routines, then `OLDER`.
 * - `formatLastDone` (§6): `Today` / `Yesterday` / `N days ago` / `14 Aug` /
 *   `14 Aug 2025`.
 *
 * Ben's two open decisions (session-picker §9), both off until he decides:
 * `SESSION_PICKER_DECISIONS`. Decision 1 is a switch; Decision 2 is only a
 * marker until the service resolver is wired to `recommendSession`. Until
 * then imports are never grouped by Category and Up next keeps D19's "last
 * workout" fallback.
 */
import type { ZonedTimestamp } from '@fizz/schemas';

import { daysBetween, localDateOf } from '../calendar';
import { dayMonthText, NBSP } from '../display';
import { toMs } from '../time';
import { storedWorkoutName } from './first-run';
import { isFromRoutine, nextInRotation, type FinishedRef } from './routines';

/** Types not done for more than this many days are listed under `OLDER` and never recommended (SP-D3). */
const OLDER_AFTER_DAYS = 42;

/** `N days ago` is used under this many days; older dates are absolute (`14 Aug`). */
const RELATIVE_DAYS_MAX = 13;

/** Dates this many calendar months back or more show their year (`14 Aug 2025`): an old date never reads as recent (rule 6). */
const YEAR_AFTER_MONTHS = 11;

/**
 * Ben's open decisions (session-picker §9). Both stay false until he
 * approves them and the CHANGELOG records it (review SI6).
 * - `groupImportsByCategory` (Decision 1): unnamed FitNotes imports become
 *   types by their `Category` label. Also needs P-I3: imported workouts
 *   can't be started yet, so such a type is `startable: false` (ADR 0016).
 * - `longestGapFallback` (Decision 2): a marker, not a switch yet (review
 *   r2 S4). The rule is built and tested (`recommendSession`), but the
 *   services don't read this flag: Today, the picker, the overview and the
 *   Plan all take Up next from the app's D19 resolver (`resolveUpNext`).
 *   Its type is `false` so turning it on fails to compile until that
 *   resolver branches on it (with its eyebrow, §2.3 `UP NEXT · LAST DONE`).
 */
export interface SessionPickerDecisions {
  groupImportsByCategory: boolean;
  longestGapFallback: false;
}

export const SESSION_PICKER_DECISIONS: Readonly<SessionPickerDecisions> = Object.freeze({ groupImportsByCategory: false, longestGapFallback: false });

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

/** A routine's session type key (`routine:<id>`). */
export function routineTypeKey(routineId: string): string {
  return `routine:${routineId}`;
}

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
 * `Category` cells (category → working-set count). Empty cells are ignored.
 * Cells with the same normalised name are one category, shown in its most
 * frequent spelling (review N3). Null when no category dominates (a mixed
 * session is not a type).
 */
export function categoryLabel(counts: Readonly<Record<string, number>>): CategoryLabel | null {
  const merged = new Map<string, { total: number; spellings: Map<string, number> }>();
  for (const [raw, n] of Object.entries(counts)) {
    const name = displaySessionName(raw);
    if (name.length === 0 || !Number.isFinite(n) || n <= 0) continue;
    const key = normaliseSessionName(name);
    const entry = merged.get(key) ?? { total: 0, spellings: new Map<string, number>() };
    entry.total += n;
    entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + n);
    merged.set(key, entry);
  }
  const named = [...merged.values()].map((e) => ({
    total: e.total,
    // Ties: code-unit order, so `Legs` beats `legs` the same way every time.
    label: [...e.spellings.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0] ?? '',
  }));
  const total = named.reduce((a, b) => a + b.total, 0);
  if (total === 0) return null;
  const ranked = named.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'en'));
  const [first, second] = ranked;
  if (first === undefined) return null;
  if (first.total / total >= SINGLE_SHARE) return { label: first.label, key: nameKey(normaliseSessionName(first.label)) };
  if (second === undefined) return null;
  const a = first.total / total;
  const b = second.total / total;
  if (a < PAIR_EACH_SHARE || b < PAIR_EACH_SHARE || a + b < PAIR_SHARE) return null;
  const pair = [first.label, second.label].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' }) || x.localeCompare(y, 'en'));
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
  /**
   * The group's most recent workout. For a routine this also counts
   * unlinked workouts with its name (and, with Decision 1, imports whose
   * Category matches it), so it can be newer than the routine list's and
   * D19's `After X · date`, which read only workouts started from the
   * routine (review N4).
   */
  lastDone: ZonedTimestamp | null;
  /** From the source workout, or from the routine. */
  exerciseCount: number;
  /** Last done more than 42 days ago (listed under `OLDER`, never the longest-gap pick). */
  older: boolean;
  /**
   * Whether Start can begin this type today. A routine always can (its own
   * structure). A history type plans from its source workout, which can't
   * be an imported one while P-I3 is open (ADR 0016: never repeated, loads
   * never checked on equipment). Unstartable types are never recommended,
   * and the service leaves them out of the picker until P-I3 is decided.
   */
  startable: boolean;
}

export interface DeriveSessionTypesInput {
  routines: readonly SessionTypeRoutine[];
  sessions: readonly SessionTypeSession[];
  now: ZonedTimestamp;
  /** Decision 1 (`SESSION_PICKER_DECISIONS`): unnamed imports become types by their Category label. */
  groupImportsByCategory: boolean;
}

/** Session types, and the type each grouped workout belongs to. */
export interface SessionTypeIndex {
  types: SessionType[];
  /** Workout ID → its type's key; workouts in no type (unnamed, mixed, deleted routine) are absent. */
  keyOfSession: ReadonlyMap<string, string>;
}

interface Group {
  key: string;
  routine: SessionTypeRoutine | null;
  members: { session: SessionTypeSession; label: string; kind: 'named' | 'category' | 'routine' }[];
}

const startedMs = (s: SessionTypeSession): number => toMs(s.startedAt.utc);

/** Whole calendar days from `at` to `now`, in `now`'s zone. */
function daysSince(at: ZonedTimestamp, now: ZonedTimestamp): number {
  return daysBetween(localDateOf(toMs(at.utc), now.tz), localDateOf(toMs(now.utc), now.tz));
}

/** A session's own history label: its stored name, or (unnamed imports, Decision 1 only) its Category label. */
function historyLabelOf(s: SessionTypeSession, byCategory: boolean): { label: string; key: string; kind: 'named' | 'category' } | null {
  const stored = storedWorkoutName(s);
  if (stored !== null) {
    const label = displaySessionName(stored);
    if (label.length === 0) return null;
    return { label, key: nameKey(normaliseSessionName(label)), kind: 'named' };
  }
  if (!byCategory || !s.imported || s.importCategories === undefined || s.importCategories === null) return null;
  const c = categoryLabel(s.importCategories);
  return c === null ? null : { ...c, kind: 'category' };
}

/**
 * Session types from live routines and finished workouts (§3.1). One type
 * per routine (its own workouts, plus unlinked workouts with its name); then
 * one per normalised name across named workouts and (Decision 1) unnamed
 * imports' Category labels. Unnamed workouts logged in the app are not
 * types. Types are in routine list order, then by name; `orderSessionTypes`
 * sorts for display.
 */
export function groupSessionTypes(input: DeriveSessionTypesInput): SessionTypeIndex {
  const groups = new Map<string, Group>();
  const byName = new Map<string, Group>();
  for (const r of input.routines) {
    const g: Group = { key: routineTypeKey(r.id), routine: r, members: [] };
    groups.set(g.key, g);
    const n = nameKey(normaliseSessionName(r.name));
    // Two routines can't share a name (checkRoutineName); if they ever do, the first in list order keeps it.
    if (!byName.has(n)) byName.set(n, g);
  }
  const keyOfSession = new Map<string, string>();
  for (const s of input.sessions) {
    const ref = { sessionId: s.id, routineId: s.routineId };
    const own = input.routines.find((r) => isFromRoutine(ref, r));
    if (own !== undefined) {
      const key = routineTypeKey(own.id);
      groups.get(key)?.members.push({ session: s, label: own.name, kind: 'routine' });
      keyOfSession.set(s.id, key);
      continue;
    }
    // A workout from a routine that's gone (deleted) stays in Past workouts only (§3.1: named means `routineId: null`).
    if (s.routineId !== null) continue;
    const h = historyLabelOf(s, input.groupImportsByCategory);
    if (h === null) continue;
    let g = byName.get(h.key);
    if (g === undefined) {
      g = { key: h.key, routine: null, members: [] };
      byName.set(h.key, g);
      groups.set(g.key, g);
    }
    g.members.push({ session: s, label: h.label, kind: h.kind });
    keyOfSession.set(s.id, g.key);
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
        startable: true,
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
      startable: !newest.session.imported,
    });
  }
  // Routines were added first, in list order; history types follow by label.
  const routinesFirst = out.filter((t) => t.kind === 'routine');
  const history = out.filter((t) => t.kind !== 'routine').sort((a, b) => a.label.localeCompare(b.label, 'en') || a.key.localeCompare(b.key));
  return { types: [...routinesFirst, ...history], keyOfSession };
}

/** `groupSessionTypes(input).types`. */
export function deriveSessionTypes(input: DeriveSessionTypesInput): SessionType[] {
  return groupSessionTypes(input).types;
}

// ---------------------------------------------------------------------------
// Recommendation (§3.3, Decision 2)

export type SessionRecommendationBasis =
  /** D19 rotation: `After Pull A · Thu 8 Oct`. */
  | { kind: 'after'; routineName: string; at: ZonedTimestamp }
  /** D19 with one routine: `Your only routine`. */
  | { kind: 'only' }
  /** The active type done longest ago: `Last done Mon 5 Oct · 6 days ago`. */
  | { kind: 'longest_gap'; lastDone: ZonedTimestamp }
  /** The only type there is, or (every type `OLDER`) the one done most recently: `From Thu 8 Oct`. */
  | { kind: 'from'; lastDone: ZonedTimestamp };

export interface SessionRecommendation {
  key: string;
  basis: SessionRecommendationBasis;
}

export interface RecommendSessionInput {
  index: SessionTypeIndex;
  /** Live routines in list order. */
  routines: readonly Pick<SessionTypeRoutine, 'id' | 'name' | 'createdFromSessionId'>[];
  /** The newest finished workout (`listFinishedRefs`' first). */
  lastFinished: FinishedRef | null;
}

type Done = SessionType & { lastDone: ZonedTimestamp };
const doneMs = (t: Done): number => toMs(t.lastDone.utc);

/**
 * Up next under Decision 2 (§3.3; SP-D4), once Ben approves it:
 * 1. The D19 rotation when the last workout came from a routine
 *    (`nextInRotation`, unchanged).
 * 2. Else, among startable types done in the last 42 days, the one done
 *    longest ago, never the type of the last finished workout (found by
 *    workout ID, so a named workout that joined a routine counts as that
 *    routine) unless it is the only one. Ties go to the lower key.
 * 3. Else (every type `OLDER`: back after a break) the startable type done
 *    most recently (review S1), not the First-workout hero.
 * 4. Else null. A never-done routine and an unstartable (imported) type
 *    are never recommended (review B2).
 */
export function recommendSession(input: RecommendSessionInput): SessionRecommendation | null {
  const { types, keyOfSession } = input.index;
  const pick = nextInRotation(input.routines, input.lastFinished);
  if (pick.kind === 'routine') {
    const key = routineTypeKey(pick.routine.id);
    if (types.some((t) => t.key === key)) {
      return { key, basis: pick.basis.kind === 'only' ? { kind: 'only' } : { kind: 'after', routineName: pick.basis.routineName, at: { utc: pick.basis.atUtc, tz: pick.basis.tz } } };
    }
  }
  const done = types.filter((t): t is Done => t.startable && t.lastDone !== null);
  const active = done.filter((t) => !t.older);
  const justDone = input.lastFinished === null ? null : (keyOfSession.get(input.lastFinished.sessionId) ?? null);
  const pool = active.length > 1 ? active.filter((t) => t.key !== justDone) : active;
  const oldest = [...pool].sort((a, b) => doneMs(a) - doneMs(b) || a.key.localeCompare(b.key))[0];
  if (oldest !== undefined) {
    return { key: oldest.key, basis: done.length === 1 ? { kind: 'from', lastDone: oldest.lastDone } : { kind: 'longest_gap', lastDone: oldest.lastDone } };
  }
  const latest = [...done].sort((a, b) => doneMs(b) - doneMs(a) || a.key.localeCompare(b.key))[0];
  return latest === undefined ? null : { key: latest.key, basis: { kind: 'from', lastDone: latest.lastDone } };
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

/**
 * `Today` · `Yesterday` · `6 days ago` (under 14 days) · `14 Aug` ·
 * `14 Aug 2025` (11 or more calendar months back, so two-year-old imported
 * history never reads as recent: review S4). Actuals, in `now`'s zone.
 */
export function formatLastDone(lastDone: ZonedTimestamp, now: ZonedTimestamp): string {
  const d = daysSince(lastDone, now);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d <= RELATIVE_DAYS_MAX) return `${String(d)} days ago`;
  const [y, m] = localDateOf(toMs(lastDone.utc), now.tz).split('-').map(Number);
  const [ny, nm] = localDateOf(toMs(now.utc), now.tz).split('-').map(Number);
  const months = ((ny ?? 0) - (y ?? 0)) * 12 + ((nm ?? 0) - (m ?? 0));
  const dayMonth = dayMonthText(lastDone.utc, now.tz);
  return months >= YEAR_AFTER_MONTHS ? `${dayMonth}${NBSP}${String(y)}` : dayMonth;
}

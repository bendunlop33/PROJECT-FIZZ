import { ActivityFieldsSchema, type Activity, type ActivityEffort, type ActivityFields, type ActivityKind, type SplitBodyPart, type ZonedTimestamp } from '@fizz/schemas';
import { ACTIVITY_LIMITS } from '@fizz/schemas';

import { addDays, daysBetween, localMidnightUtcMs, weekdayIndexOfDate } from './calendar';
import { formatNumber, localDateText, NBSP } from './display';
import { shortRelativeDay } from './session/recent';

/**
 * Activities outside the gym (Ben, 20 Oct: "if I did or have planned a long
 * run maybe we swap to a push rather than shoulder and chest separately").
 * Pure. Only what Ben logged: kind, done or planned, a date, a rough
 * duration and/or distance, an effort word. Nothing is scored or estimated
 * (rule 6); a run is "long" or "hard" only by his word or his numbers.
 *
 * - `isLongActivity` / `isHardActivity`: a `long` effort, or a run of at
 *   least 90 min or 15 km, is long; a `hard` effort is hard.
 * - `legRunNear`: the long or hard run that keeps legs off today: one
 *   yesterday, or one tomorrow (local dates in Ben's zone). A planned
 *   activity counts on its date unless Ben cancels it (Ben, 20 Oct): no need
 *   to mark it done. Counting is not relabelling: rows keep `Planned` and the
 *   coach reads `planned` (review ben-runs-20oct B1, rule 6).
 * - `avoidLegDays`: Up next's filter. Days whose body parts include legs go
 *   after every other day while a run is near; if every day is legs, the
 *   first stays and `legsAnyway` says why.
 * - Writes (add, edit, delete, Undo) are versioned and idempotent on their op
 *   IDs (rule 5); Undo puts back exactly the state before the last write.
 */

// ---------------------------------------------------------------------------
// Long and hard

/** A run this long (or longer) is a long session whatever the effort word. */
export const LONG_RUN_SECONDS = 90 * 60;
/** A run this far (or further) is a long session whatever the effort word. */
export const LONG_RUN_METRES = 15_000;

/** A long session: Ben said `long`, or a run of at least 90 min or 15 km. */
export function isLongActivity(f: Pick<ActivityFields, 'kind' | 'effort' | 'durationS' | 'distanceM'>): boolean {
  if (f.effort === 'long') return true;
  if (f.kind !== 'run') return false;
  return (f.durationS !== null && f.durationS >= LONG_RUN_SECONDS) || (f.distanceM !== null && f.distanceM >= LONG_RUN_METRES);
}

/** A hard session: Ben said `hard`. */
export function isHardActivity(f: Pick<ActivityFields, 'effort'>): boolean {
  return f.effort === 'hard';
}

/** A long or hard run: the runs that keep legs off the day before (planned) and the day after (done). */
export function isLegRun(f: Pick<ActivityFields, 'kind' | 'effort' | 'durationS' | 'distanceM'>): boolean {
  return f.kind === 'run' && (isLongActivity(f) || isHardActivity(f));
}

const live = (a: Pick<Activity, 'deletedAtUtc'>): boolean => a.deletedAtUtc === null;

export interface LegRunNear {
  /** `after`: a long or hard run yesterday; `before`: one tomorrow. */
  when: 'after' | 'before';
  activity: Activity;
  /** `Long run yesterday`, `Hard run tomorrow`. */
  why: string;
}

/**
 * The long or hard run that keeps legs off `today` (local `YYYY-MM-DD` in
 * Ben's zone): one yesterday, else one tomorrow. Deleted (cancelled)
 * activities don't count; a planned run counts on its date without being
 * marked done (Ben, 20 Oct).
 */
export function legRunNear(activities: readonly Activity[], today: string): LegRunNear | null {
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const runs = activities.filter((a) => live(a) && isLegRun(a.fields));
  const done = runs.find((a) => a.fields.date === yesterday);
  if (done !== undefined) return { when: 'after', activity: done, why: `${isLongActivity(done.fields) ? 'Long' : 'Hard'} run yesterday` };
  const planned = runs.find((a) => a.fields.date === tomorrow);
  if (planned !== undefined) return { when: 'before', activity: planned, why: `${isLongActivity(planned.fields) ? 'Long' : 'Hard'} run tomorrow` };
  return null;
}

/** Body parts that make a day a leg day for the run rule. */
export const LEG_PARTS: readonly SplitBodyPart[] = ['Quads', 'Hamstrings', 'Glutes', 'Calves'];

/** A day whose main body parts include legs. */
export function isLegDay(bodyParts: readonly SplitBodyPart[]): boolean {
  return bodyParts.some((p) => LEG_PARTS.includes(p));
}

export interface LegFiltered<T> {
  order: T[];
  /** Every day is a leg day, so the first is one anyway: its `Why?` names the run. */
  legsAnyway: boolean;
}

/**
 * Up next's run rule (Ben, 20 Oct): with a long or hard run near (`near`),
 * the days in `ordered` (already in due order) whose body parts include legs
 * move after every other day, keeping their order. With no run near, nothing
 * changes. When every day is a leg day the order stays and `legsAnyway` is
 * set.
 */
export function avoidLegDays<T>(ordered: readonly T[], partsOf: (t: T) => readonly SplitBodyPart[], near: LegRunNear | null): LegFiltered<T> {
  if (near === null || ordered.length === 0) return { order: [...ordered], legsAnyway: false };
  const legs = ordered.filter((t) => isLegDay(partsOf(t)));
  const other = ordered.filter((t) => !isLegDay(partsOf(t)));
  return { order: [...other, ...legs], legsAnyway: other.length === 0 && legs.length > 0 };
}

// ---------------------------------------------------------------------------
// Text

export const ACTIVITY_WORD: Readonly<Record<ActivityKind, string>> = { run: 'Run', ride: 'Ride', swim: 'Swim', sport: 'Sport', other: 'Activity' };
export const EFFORT_WORD: Readonly<Record<ActivityEffort, string>> = { easy: 'easy', moderate: 'moderate', hard: 'hard', long: 'long' };

export const ACTIVITY_COPY = {
  add: 'Activity',
  title: 'Activity',
  done: 'Done',
  planned: 'Planned',
  save: 'Save',
  delete: 'Delete',
  saved: 'Activity saved',
  deleted: 'Activity deleted',
  undo: 'Undo',
  duration: 'Time',
  distance: 'Distance',
  effort: 'Effort',
  date: 'Date',
} as const;

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** `Mon` … `Sun` for a local date. */
export function dateWeekdayShort(date: string): string {
  return WEEKDAY_SHORT[weekdayIndexOfDate(date)] ?? localDateText(date);
}

/** `45 min`, `1 h 30 min`, `2 h`. */
export function activityDurationText(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${String(m)}${NBSP}min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${String(h)}${NBSP}h` : `${String(h)}${NBSP}h ${String(r)}${NBSP}min`;
}

/** `18 km`, `400 m`, `21.1 km`. */
export function activityDistanceText(metres: number): string {
  return metres >= 1000 ? `${formatNumber(Math.round(metres / 100) / 10)}${NBSP}km` : `${formatNumber(Math.round(metres))}${NBSP}m`;
}

/** `18 km · 1 h 30 min · long`: what Ben logged, in that order; parts not given are left out. */
export function activityDetail(f: Pick<ActivityFields, 'durationS' | 'distanceM' | 'effort'>): string {
  const parts: string[] = [];
  if (f.distanceM !== null) parts.push(activityDistanceText(f.distanceM));
  if (f.durationS !== null) parts.push(activityDurationText(f.durationS));
  if (f.effort !== null) parts.push(EFFORT_WORD[f.effort]);
  return parts.join(' · ');
}

/** A date relative to today: past as Recent shows it (`Yesterday`, `Sat`, `12 Oct`); ahead `Tomorrow`, `Sat`, `3 Nov`. */
export function activityWhen(date: string, today: string): string {
  const ahead = daysBetween(today, date);
  if (ahead <= 0) return shortRelativeDay(date, today);
  if (ahead === 1) return 'Tomorrow';
  if (ahead <= 6) return dateWeekdayShort(date);
  return localDateText(date);
}

export interface ActivityRow {
  activityId: string;
  version: number;
  /** `Run`. */
  title: string;
  /** `Yesterday`, `Sat`. */
  when: string;
  /** `18 km · long`, `Planned · long`. */
  detail: string;
  planned: boolean;
  /** (Ben, 27 Oct) Read from Apple Health: its source (`Garmin`). Read-only; its sheet shows it and offers a link. */
  fromHealth?: string;
  accessibilityLabel: string;
}

/**
 * One activity as Today's Recent, the calendar and Your plan list it. A
 * planned one keeps `Planned` until Ben marks it done, on and after its date
 * too: it counts for the run rule and the week, but it is never shown as done
 * before he says so (review ben-runs-20oct B1, rule 6); its sheet offers
 * `Cancel run`, so row and sheet agree (N3).
 */
export function activityRow(a: Activity, today: string): ActivityRow {
  const title = activityTitle(a);
  const when = activityWhen(a.fields.date, today);
  const planned = a.fields.status === 'planned';
  const source = a.health !== undefined ? a.health.sourceName : a.source === 'health' ? 'Health' : null;
  const detail = [planned ? ACTIVITY_COPY.planned : null, activityDetail(a.fields) || null, source].filter((x): x is string => x !== null).join(' · ');
  return {
    activityId: a.id,
    version: a.version,
    title,
    when,
    detail,
    planned,
    ...(source === null ? {} : { fromHealth: source }),
    accessibilityLabel: [title, when, detail, source === null ? '' : 'from Apple Health'].filter((x) => x !== '').join(', ').replaceAll(NBSP, ' '),
  };
}

/** `Run`; a Health activity's own label (`Strength`, `Walk`, `Tennis`) when its kind is `other` or `sport`. */
export function activityTitle(a: Pick<Activity, 'fields' | 'health'>): string {
  if (a.health !== undefined && (a.fields.kind === 'other' || a.fields.kind === 'sport')) return a.health.label;
  return ACTIVITY_WORD[a.fields.kind];
}

/**
 * The sheet's remove button: `Cancel run` for a planned activity (one that
 * didn't or won't happen stops counting), `Delete` for one done. Both are the
 * same tombstone write with Undo.
 */
export function activityRemoveLabel(f: Pick<ActivityFields, 'kind' | 'status'>): string {
  return f.status === 'planned' ? `Cancel ${ACTIVITY_WORD[f.kind].toLowerCase()}` : ACTIVITY_COPY.delete;
}

/** The toast after a remove: `Run cancelled` (planned) or `Activity deleted`. */
export function activityRemovedText(f: Pick<ActivityFields, 'kind' | 'status'>): string {
  return f.status === 'planned' ? `${ACTIVITY_WORD[f.kind]} cancelled` : ACTIVITY_COPY.deleted;
}

/**
 * The status the coach reads (review ben-runs-20oct B1): as logged. A planned
 * one whose date has passed reads `planned (counts)`: never confirmed, still
 * counted for the run rule and the week (Ben, 20 Oct). Today's reads
 * `planned`: it may not have happened yet.
 */
export function activityStatusOn(a: Pick<Activity, 'fields'>, today: string): 'done' | 'planned' | 'planned (counts)' {
  if (a.fields.status === 'done') return 'done';
  return a.fields.date < today ? 'planned (counts)' : 'planned';
}

/** `Run · Sat · long`: one line in Your plan's week. */
export function weekActivityLine(a: Activity): string {
  const f = a.fields;
  const tail = f.effort !== null ? EFFORT_WORD[f.effort] : activityDetail(f);
  return [activityTitle(a), dateWeekdayShort(f.date), tail, a.health?.sourceName ?? ''].filter((x) => x !== '').join(' · ');
}

/** Live activities whose date is in [`from`, `to`) (local dates), oldest first. */
export function activitiesBetween(activities: readonly Activity[], from: string, to: string): Activity[] {
  return activities.filter((a) => live(a) && a.fields.date >= from && a.fields.date < to).sort((x, y) => (x.fields.date < y.fields.date ? -1 : x.fields.date > y.fields.date ? 1 : x.createdAtUtc < y.createdAtUtc ? -1 : 1));
}

/** For ordering with workouts: an activity sorts at noon on its date. */
export function activitySortMs(a: Pick<Activity, 'fields' | 'tz'>): number {
  return localMidnightUtcMs(a.fields.date, a.tz) + 12 * 3_600_000;
}

// ---------------------------------------------------------------------------
// Writes

export type ActivityChange =
  | { kind: 'write'; next: Activity; expectedVersion: number | null }
  | { kind: 'duplicate'; current: Activity }
  /** Not as the screen read it, deleted, or the Undo is out of date: nothing changes (rule 5). */
  | { kind: 'stale'; current: Activity | null }
  | { kind: 'invalid'; reason: string };

interface WriteInput {
  opId: string;
  at: ZonedTimestamp;
}

/** The fields, checked; a reason when they aren't valid. */
export function checkActivityFields(f: ActivityFields): { ok: true; fields: ActivityFields } | { ok: false; reason: string } {
  const r = ActivityFieldsSchema.safeParse(f);
  if (!r.success) return { ok: false, reason: r.error.issues[0]?.message ?? 'not a valid activity' };
  return { ok: true, fields: r.data };
}

/** (Ben, 27 Oct) Activities read from Apple Health are read-only: never added, edited, deleted or undone here. */
const READ_ONLY = 'Read from Apple Health';

/** A new activity (Ben's sheet or the coach). Idempotent by ID in the store: a retry with the same ID changes nothing. */
export function addActivity(input: WriteInput & { id: string; ownerId: string; fields: ActivityFields; source: Activity['source'] }): ActivityChange {
  if (input.source === 'health') return { kind: 'invalid', reason: READ_ONLY };
  const c = checkActivityFields(input.fields);
  if (!c.ok) return { kind: 'invalid', reason: c.reason };
  const next: Activity = {
    id: input.id,
    ownerId: input.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    fields: c.fields,
    tz: input.at.tz,
    source: input.source,
    deletedAtUtc: null,
    lastChange: { opId: input.opId, kind: 'add', versionAfter: 1, before: null },
    opIds: [input.opId],
  };
  return { kind: 'write', next, expectedVersion: null };
}

function bump(current: Activity, input: WriteInput, patch: Partial<Activity>, last: Activity['lastChange']): Activity {
  return { ...current, ...patch, version: current.version + 1, updatedAtUtc: input.at.utc, lastChange: last, opIds: [...current.opIds, input.opId].slice(-ACTIVITY_LIMITS.maxOps) };
}

/** Edit what Ben logged, on the version the screen showed. */
export function editActivity(current: Activity, input: WriteInput & { expectedVersion: number; fields: ActivityFields }): ActivityChange {
  if (current.source === 'health') return { kind: 'invalid', reason: READ_ONLY };
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.deletedAtUtc !== null) return { kind: 'stale', current };
  const c = checkActivityFields(input.fields);
  if (!c.ok) return { kind: 'invalid', reason: c.reason };
  const next = bump(current, input, { fields: c.fields }, { opId: input.opId, kind: 'edit', versionAfter: current.version + 1, before: current.fields });
  return { kind: 'write', next, expectedVersion: current.version };
}

/** Delete (a tombstone, so Undo can bring it back). */
export function deleteActivity(current: Activity, input: WriteInput & { expectedVersion: number }): ActivityChange {
  if (current.source === 'health') return { kind: 'invalid', reason: READ_ONLY };
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.deletedAtUtc !== null) return { kind: 'stale', current };
  const next = bump(current, input, { deletedAtUtc: input.at.utc }, { opId: input.opId, kind: 'delete', versionAfter: current.version + 1, before: null });
  return { kind: 'write', next, expectedVersion: current.version };
}

/**
 * Undo of the last write (`targetOpId`): an add is deleted, an edit puts the
 * fields back, a delete brings it back. Only while the activity is still at
 * the version that write left; its own op ID (a second Undo is stale).
 */
export function undoActivity(current: Activity, input: WriteInput & { targetOpId: string }): ActivityChange {
  if (current.source === 'health') return { kind: 'invalid', reason: READ_ONLY };
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  const last = current.lastChange;
  if (last === null || last.opId !== input.targetOpId || last.versionAfter !== current.version) return { kind: 'stale', current };
  switch (last.kind) {
    case 'add':
      if (current.deletedAtUtc !== null) return { kind: 'stale', current };
      return { kind: 'write', next: bump(current, input, { deletedAtUtc: input.at.utc }, null), expectedVersion: current.version };
    case 'edit':
      if (last.before === null || current.deletedAtUtc !== null) return { kind: 'stale', current };
      return { kind: 'write', next: bump(current, input, { fields: last.before }, null), expectedVersion: current.version };
    case 'delete':
      if (current.deletedAtUtc === null) return { kind: 'stale', current };
      return { kind: 'write', next: bump(current, input, { deletedAtUtc: null }, null), expectedVersion: current.version };
  }
}

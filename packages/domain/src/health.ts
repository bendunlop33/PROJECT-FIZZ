import {
  ActivityFieldsSchema,
  HEALTH_LIMITS,
  type Activity,
  type ActivityKind,
  type HealthActivityProvenance,
  type HealthInterval,
  type HealthLink,
  type HealthReadWindow,
  type HealthRestingHrSample,
  type HealthSleepSample,
  type HealthWeightSample,
  type HealthWorkoutSample,
  type HealthWorkoutWrite,
  type HealthWriteType,
  type WeightEntry,
} from '@fizz/schemas';

import type { SessionAggregate } from '@fizz/schemas';

import { localDateOf } from './calendar';
import { isInHistory } from './session/deletion';
import { NBSP } from './display';
import { deriveId } from './stable';
import { toIso, toMs } from './time';

/**
 * Apple Health (Ben, 27 Oct; ADR 0035). Pure: what to write, what a read means, what to show.
 *
 * - Writes: `healthWorkoutOf` turns a finished workout into the Health workout to write (strength type, start,
 *   end, pauses; nothing invented, rule 6). `planHealthWrites` compares the app's workouts with what was written
 *   and returns the saves and deletes still to do: a new workout recorded since writing was turned on, a moved
 *   or edited one (its start, end, pauses or type changed), a deleted one. Each op has a deterministic op ID, so
 *   a retry after a force-close is the same op (one write per op ID, rule 5).
 * - Reads: `classifyHealthWorkout` maps Health's workout types to the app's activity kinds;
 *   `healthActivitiesFor` lists Health workouts as read-only activities, leaving out the app's own writes,
 *   linked ones, and ones Ben logged himself (same kind, same day). `bodyweightEntries` merges Health's weights
 *   with Ben's: his entry wins on a day he has one.
 * - Links: a Health strength workout that clearly overlaps an app workout (same day, at least half of the
 *   shorter one) is linked automatically; a looser match is offered (`linkSuggestion`); Ben can link from a
 *   picker (`nearbyWorkouts`) or unlink. Versioned and idempotent (rule 5).
 */

// ---------------------------------------------------------------------------
// Health's workout types

/** HKWorkoutActivityType raw values the app writes. */
export const HK_WRITE_TYPE: Readonly<Record<HealthWriteType, number>> = { traditional_strength: 50, functional_strength: 20 };

/**
 * HKWorkoutActivityType raw values of the strength family (apple-health.md §3.2): traditional and functional
 * strength, core, cross training. These link to an app workout on a clear overlap; `other` (3000) is only asked.
 */
export const HK_STRENGTH_TYPES: ReadonlySet<number> = new Set([50, 20, 59, 11]);
/** `other`: may be linked, never automatically. */
export const HK_OTHER_TYPE = 3000;

export interface HealthKindInfo {
  kind: ActivityKind;
  /** `Strength`, `Walk` … ; the kind's own word (`Run`) when nothing more specific. */
  label: string;
  strength: boolean;
}

const RUN = new Set([37, 71]);
const RIDE = new Set([13, 74]);
const SWIM = new Set([46]);
const SPORT: Readonly<Record<number, string>> = {
  1: 'American football',
  3: 'Aussie rules',
  4: 'Badminton',
  5: 'Baseball',
  6: 'Basketball',
  7: 'Bowling',
  8: 'Boxing',
  9: 'Climbing',
  10: 'Cricket',
  18: 'Fencing',
  21: 'Golf',
  23: 'Handball',
  25: 'Hockey',
  27: 'Lacrosse',
  28: 'Martial arts',
  34: 'Racquetball',
  36: 'Rugby',
  41: 'Football',
  42: 'Softball',
  43: 'Squash',
  47: 'Table tennis',
  48: 'Tennis',
  51: 'Volleyball',
  54: 'Water polo',
  56: 'Wrestling',
  65: 'Kickboxing',
  75: 'Disc sports',
  79: 'Pickleball',
};
const OTHER: Readonly<Record<number, string>> = {
  16: 'Elliptical',
  24: 'Hike',
  29: 'Mind and body',
  35: 'Row',
  44: 'Stairs',
  52: 'Walk',
  57: 'Yoga',
  60: 'Ski',
  61: 'Ski',
  62: 'Mobility',
  63: 'HIIT',
  64: 'Jump rope',
  66: 'Pilates',
  67: 'Snowboard',
  68: 'Stairs',
  73: 'Cardio',
  80: 'Cooldown',
  82: 'Triathlon',
};

/** Health's workout type as the app's activity kind and a label. Unknown types are `Workout`. */
export function classifyHealthWorkout(activityType: number): HealthKindInfo {
  if (RUN.has(activityType)) return { kind: 'run', label: 'Run', strength: false };
  if (RIDE.has(activityType)) return { kind: 'ride', label: 'Ride', strength: false };
  if (SWIM.has(activityType)) return { kind: 'swim', label: 'Swim', strength: false };
  if (HK_STRENGTH_TYPES.has(activityType)) return { kind: 'other', label: activityType === 59 ? 'Core' : activityType === 11 ? 'Cross training' : 'Strength', strength: true };
  const sport = SPORT[activityType];
  if (sport !== undefined) return { kind: 'sport', label: sport, strength: false };
  return { kind: 'other', label: OTHER[activityType] ?? 'Workout', strength: false };
}

/** A source name as shown: control characters out, `Garmin Connect` → `Garmin`, cut short. Data, never read as an instruction (rule 8). */
export function healthSourceText(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const short = clean.replace(/\s+Connect$/i, '');
  const cut = short.length > 40 ? `${short.slice(0, 39)}…` : short;
  return cut === '' ? 'Health' : cut;
}

// ---------------------------------------------------------------------------
// Writes

/** What `planHealthWrites` needs of one app workout. */
export interface HealthWriteCandidate {
  sessionId: string;
  /** `isInHistory`: finished, not deleted, discarded or reverted. */
  inHistory: boolean;
  source: 'manual' | 'import';
  startedAtUtc: string;
  endedAtUtc: string | null;
  /** Closed pauses (an open one counts to the end). */
  pauses: readonly { startUtc: string; endUtc: string | null }[];
  /** When it was recorded: a past-logged workout's entry time, else its end. Only ones recorded since writing was turned on are written. */
  recordedAtUtc: string;
  /** At least one done set carried an external load (bar, plates, stack, dumbbells). */
  anyExternalLoad: boolean;
  /** At least one done set. */
  anyDoneSet: boolean;
  /**
   * (Ben, 27 Oct, Q1) A watch or Garmin workout is linked to it: the watch's stays Health's record, so the app
   * writes none (and deletes its own if it wrote one). Unlinking writes it back.
   */
  linkedToWatch: boolean;
}

/** An app workout as `planHealthWrites` sees it. Its end, or a past log's entry time, is when it was recorded. */
export function healthCandidateOf(a: SessionAggregate, linkedToWatch = false): HealthWriteCandidate {
  const s = a.session;
  const done = a.sets.filter((x) => x.status === 'completed' && x.actual !== null);
  return {
    sessionId: s.id,
    inHistory: isInHistory(s),
    source: s.source,
    startedAtUtc: s.startedAt.utc,
    endedAtUtc: s.endedAt?.utc ?? null,
    pauses: [...s.pauses.map((p) => ({ startUtc: p.startUtc, endUtc: p.endUtc })), ...(s.pause === null ? [] : [{ startUtc: s.pause.pausedAtUtc, endUtc: null }])],
    recordedAtUtc: s.pastLog?.enteredAt.utc ?? s.endedAt?.utc ?? s.startedAt.utc,
    anyExternalLoad: done.some((x) => x.actual !== null && x.actual.load !== null && x.actual.load.convention !== 'bodyweight'),
    anyDoneSet: done.length > 0,
    linkedToWatch,
  };
}

export interface HealthWorkoutPlan {
  type: HealthWriteType;
  startUtc: string;
  endUtc: string;
  /** Pauses inside the workout, merged and in order (Health's duration leaves them out). */
  pauses: HealthInterval[];
  fingerprint: string;
}

/**
 * The Health workout for a finished workout, or null (not finished, no time, too long). Strength training by
 * default; functional strength when every done set was bodyweight (no external load), e.g. a calisthenics
 * circuit. Start and end are the workout's own (moved or past-logged times included).
 */
export function healthWorkoutOf(c: HealthWriteCandidate): HealthWorkoutPlan | null {
  if (!c.inHistory || c.endedAtUtc === null) return null;
  const start = toMs(c.startedAtUtc);
  const end = toMs(c.endedAtUtc);
  if (!(end > start) || end - start > HEALTH_LIMITS.maxWorkoutS * 1000) return null;
  const clipped = c.pauses
    .map((p) => ({ s: Math.max(start, toMs(p.startUtc)), e: Math.min(end, p.endUtc === null ? end : toMs(p.endUtc)) }))
    .filter((p) => p.e > p.s)
    .sort((a, b) => a.s - b.s);
  const merged: { s: number; e: number }[] = [];
  for (const p of clipped) {
    const last = merged.at(-1);
    if (last !== undefined && p.s <= last.e) last.e = Math.max(last.e, p.e);
    else merged.push({ ...p });
  }
  const type: HealthWriteType = c.anyDoneSet && !c.anyExternalLoad ? 'functional_strength' : 'traditional_strength';
  const pauses = merged.map((p) => ({ startUtc: toIso(p.s), endUtc: toIso(p.e) }));
  const startUtc = toIso(start);
  const endUtc = toIso(end);
  return { type, startUtc, endUtc, pauses, fingerprint: healthWorkoutFingerprint(type, startUtc, endUtc, pauses) };
}

/** What a Health workout was written from: type, start, end and pauses. Equal fingerprints need no rewrite. */
export function healthWorkoutFingerprint(type: HealthWriteType, startUtc: string, endUtc: string, pauses: readonly HealthInterval[]): string {
  const pausedS = Math.round(pauses.reduce((sum, p) => sum + toMs(p.endUtc) - toMs(p.startUtc), 0) / 1000);
  return deriveId(`${type}|${startUtc}|${endUtc}|${pauses.map((p) => `${p.startUtc}-${p.endUtc}`).join(',')}`).slice(0, 18) + `:${String(pausedS)}`;
}

/** The sync identifier a written workout carries in Health (`HKMetadataKeySyncIdentifier`). */
export function healthSyncIdentifier(sessionId: string): string {
  return `gymsmarter-session:${sessionId}`;
}

export type HealthWriteOp =
  | { kind: 'save'; sessionId: string; opId: string; syncVersion: number; workout: HealthWorkoutPlan; replacesUuid: string | null }
  | { kind: 'delete'; sessionId: string; opId: string; syncVersion: number; healthUuid: string };

function opIdOf(kind: 'save' | 'delete', sessionId: string, syncVersion: number): string {
  return `health-${kind}:${sessionId}:${String(syncVersion)}`;
}

/**
 * The writes still to do. With writing off, nothing (Health keeps what it has). With it on:
 * - a workout with no write record is saved when finished, logged in the app (not imported) and recorded at or
 *   after `writeSinceUtc` (history from before isn't written);
 * - one already written is saved again when its fingerprint changed (moved, edited times, pauses), or deleted from
 *   Health when it left history (deleted, discarded), is gone (purged), or a watch workout was linked to it (Q1:
 *   the watch's is Health's record);
 * - one whose Health workout was deleted is saved again when it is back in history (restored) or unlinked;
 * - one Ben removed from Health (`Remove GymSmarter workouts from Health`) is never written again.
 */
export function planHealthWrites(input: {
  settings: { writeWorkouts: boolean; writeSinceUtc: string | null };
  candidates: readonly HealthWriteCandidate[];
  records: readonly HealthWorkoutWrite[];
}): HealthWriteOp[] {
  if (!input.settings.writeWorkouts || input.settings.writeSinceUtc === null) return [];
  const since = toMs(input.settings.writeSinceUtc);
  const byId = new Map(input.candidates.map((c) => [c.sessionId, c]));
  const recordOf = new Map(input.records.map((r) => [r.sessionId, r]));
  const ops: HealthWriteOp[] = [];
  for (const c of input.candidates) {
    if (recordOf.has(c.sessionId)) continue;
    if (c.source !== 'manual' || c.linkedToWatch || toMs(c.recordedAtUtc) < since) continue;
    const workout = healthWorkoutOf(c);
    if (workout === null) continue;
    ops.push({ kind: 'save', sessionId: c.sessionId, opId: opIdOf('save', c.sessionId, 1), syncVersion: 1, workout, replacesUuid: null });
  }
  for (const r of input.records) {
    const c = byId.get(r.sessionId);
    const workout = c === undefined || c.linkedToWatch ? null : healthWorkoutOf(c);
    const next = r.syncVersion + 1;
    if (r.status === 'written') {
      if (workout === null) ops.push({ kind: 'delete', sessionId: r.sessionId, opId: opIdOf('delete', r.sessionId, next), syncVersion: next, healthUuid: r.healthUuid });
      else if (workout.fingerprint !== r.fingerprint) ops.push({ kind: 'save', sessionId: r.sessionId, opId: opIdOf('save', r.sessionId, next), syncVersion: next, workout, replacesUuid: r.healthUuid });
    } else if (r.status === 'deleted' && workout !== null) {
      ops.push({ kind: 'save', sessionId: r.sessionId, opId: opIdOf('save', r.sessionId, next), syncVersion: next, workout, replacesUuid: null });
    }
  }
  return ops;
}

/** What Health did with one op. */
export type HealthWriteResult = { kind: 'saved'; healthUuid: string } | { kind: 'deleted' };

/** `Remove GymSmarter workouts from Health` done: every written record becomes `removed` (never written again). */
export function healthWriteRemoved(prev: HealthWorkoutWrite, opId: string, atUtc: string): HealthWorkoutWrite | null {
  if (prev.opIds.includes(opId) || prev.status !== 'written') return null;
  return { ...prev, status: 'removed', version: prev.version + 1, updatedAtUtc: atUtc, opIds: [...prev.opIds, opId].slice(-HEALTH_LIMITS.maxOps) };
}

/** The write record after `op` succeeded; null when `op` was already recorded (a replay changes nothing). */
export function healthWriteRecordAfter(prev: HealthWorkoutWrite | null, op: HealthWriteOp, result: HealthWriteResult, ownerId: string, atUtc: string): HealthWorkoutWrite | null {
  if (prev !== null && prev.opIds.includes(op.opId)) return null;
  const opIds = [...(prev?.opIds ?? []), op.opId].slice(-HEALTH_LIMITS.maxOps);
  const version = (prev?.version ?? 0) + 1;
  if (op.kind === 'save') {
    if (result.kind !== 'saved') throw new Error('A save needs the saved workout');
    return { sessionId: op.sessionId, ownerId, status: 'written', healthUuid: result.healthUuid.toLowerCase(), type: op.workout.type, fingerprint: op.workout.fingerprint, syncVersion: op.syncVersion, version, updatedAtUtc: atUtc, opIds };
  }
  if (prev === null) return null;
  return { ...prev, status: 'deleted', syncVersion: op.syncVersion, version, updatedAtUtc: atUtc, opIds };
}

// ---------------------------------------------------------------------------
// Links (a Health activity is one of the app's workouts)

export interface LinkableWorkout {
  sessionId: string;
  startUtc: string;
  endUtc: string;
  tz: string;
  /** `Push`, `Workout`. */
  title: string;
}

/** Overlap as a share of the shorter of the two (0–1). */
export function overlapShare(a: HealthInterval, b: HealthInterval): number {
  const as = toMs(a.startUtc);
  const ae = toMs(a.endUtc);
  const bs = toMs(b.startUtc);
  const be = toMs(b.endUtc);
  const shorter = Math.min(ae - as, be - bs);
  if (shorter <= 0) return 0;
  return Math.max(0, Math.min(ae, be) - Math.max(as, bs)) / shorter;
}

/** A clear overlap: same local day and at least half of the shorter one (Ben, 27 Oct). */
export const AUTO_LINK_MIN_OVERLAP = 0.5;

export function healthLinkId(healthUuid: string): string {
  return deriveId(`health-link:${healthUuid.toLowerCase()}`);
}

function sameDay(sample: HealthWorkoutSample, w: LinkableWorkout): boolean {
  return localDateOf(toMs(sample.startUtc), w.tz) === localDateOf(toMs(w.startUtc), w.tz);
}

function linkedSessions(links: readonly HealthLink[]): Set<string> {
  return new Set(links.filter((l) => l.status === 'linked').map((l) => l.sessionId));
}

/**
 * The Health workouts to link on reading (apple-health.md §3.2): a strength-family type, no link record yet (an
 * unlinked or `Not it` one is never linked or asked again), the same local day as an app workout and overlapping
 * at least half of the shorter one, and the only such pair for both: with two or more candidates nothing
 * auto-links (the Summary asks instead). An app workout already linked takes no other.
 */
export function autoLinkPairs(input: { samples: readonly HealthWorkoutSample[]; workouts: readonly LinkableWorkout[]; links: readonly HealthLink[] }): { healthUuid: string; sessionId: string }[] {
  const recorded = new Set(input.links.map((l) => l.healthUuid));
  const taken = linkedSessions(input.links);
  const pairs: { healthUuid: string; sessionId: string }[] = [];
  for (const s of input.samples) {
    if (!HK_STRENGTH_TYPES.has(s.activityType) || recorded.has(s.uuid)) continue;
    for (const w of input.workouts) {
      if (taken.has(w.sessionId) || !sameDay(s, w)) continue;
      if (overlapShare(s, { startUtc: w.startUtc, endUtc: w.endUtc }) >= AUTO_LINK_MIN_OVERLAP) pairs.push({ healthUuid: s.uuid, sessionId: w.sessionId });
    }
  }
  const count = (key: (p: { healthUuid: string; sessionId: string }) => string) => {
    const m = new Map<string, number>();
    for (const p of pairs) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return m;
  };
  const perSample = count((p) => p.healthUuid);
  const perSession = count((p) => p.sessionId);
  return pairs.filter((p) => perSample.get(p.healthUuid) === 1 && perSession.get(p.sessionId) === 1);
}

/** A Health workout starting or ending within this of an app workout, the same day, is asked about. */
export const ASK_WITHIN_MS = 60 * 60_000;

/**
 * The Health workouts the Summary asks about (`Link to this workout?`; apple-health.md §3.2) for one app
 * workout with no linked activity: same local day, strength family or `other`, no link record yet, and
 * overlapping it at all or starting or ending within an hour of it, and not a clear single auto-link (those
 * are linked on reading). Two or more: the Summary offers a list. Nearest first.
 */
export function linkQuestions(workout: LinkableWorkout, samples: readonly HealthWorkoutSample[], links: readonly HealthLink[]): HealthWorkoutSample[] {
  if (linkedSessions(links).has(workout.sessionId)) return [];
  const recorded = new Set(links.map((l) => l.healthUuid));
  const ws = toMs(workout.startUtc);
  const we = toMs(workout.endUtc);
  return samples
    .filter((s) => (HK_STRENGTH_TYPES.has(s.activityType) || s.activityType === HK_OTHER_TYPE) && !recorded.has(s.uuid) && sameDay(s, workout))
    .filter((s) => {
      const ss = toMs(s.startUtc);
      const se = toMs(s.endUtc);
      const overlaps = Math.min(se, we) > Math.max(ss, ws);
      const near = Math.abs(ss - ws) <= ASK_WITHIN_MS || Math.abs(se - we) <= ASK_WITHIN_MS || Math.abs(ss - we) <= ASK_WITHIN_MS || Math.abs(se - ws) <= ASK_WITHIN_MS;
      return overlaps || near;
    })
    .sort((a, b) => Math.abs(toMs(a.startUtc) - ws) - Math.abs(toMs(b.startUtc) - ws));
}

/** The Health activity sheet's one-tap `Link to this workout?`: the same day's nearest app workout that would ask about it. */
export function linkSuggestion(sample: HealthWorkoutSample, workouts: readonly LinkableWorkout[], links: readonly HealthLink[]): LinkableWorkout | null {
  return nearbyWorkouts(sample, workouts, links).find((w) => sameDay(sample, w) && linkQuestions(w, [sample], links).length === 1) ?? null;
}

/** `Link to a workout`: the app workouts within a day either side, not linked to another activity, nearest first. */
export function nearbyWorkouts(sample: HealthWorkoutSample, workouts: readonly LinkableWorkout[], links: readonly HealthLink[]): LinkableWorkout[] {
  const taken = linkedSessions(links.filter((l) => l.healthUuid !== sample.uuid));
  const at = toMs(sample.startUtc);
  return workouts
    .filter((w) => !taken.has(w.sessionId) && Math.abs(toMs(w.startUtc) - at) <= 36 * 3_600_000)
    .sort((a, b) => Math.abs(toMs(a.startUtc) - at) - Math.abs(toMs(b.startUtc) - at));
}

export type HealthLinkChange =
  | { kind: 'write'; next: HealthLink; expectedVersion: number | null }
  | { kind: 'duplicate'; current: HealthLink }
  /** Not as the screen read it: nothing changes (rule 5). */
  | { kind: 'stale'; current: HealthLink | null }
  | { kind: 'invalid'; reason: string };

/**
 * Link a Health activity to an app workout (Ben's tap, or `auto` on reading). On the version the screen read
 * (`expectedVersion`; null: no record yet). A workout already linked to another activity is refused.
 */
export function linkHealthActivity(
  current: HealthLink | null,
  input: { ownerId: string; healthUuid: string; sessionId: string; by: HealthLink['by']; opId: string; atUtc: string; expectedVersion: number | null; sessionLinkedElsewhere: boolean },
): HealthLinkChange {
  if (current !== null && current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if ((current?.version ?? null) !== input.expectedVersion) return { kind: 'stale', current };
  if (input.sessionLinkedElsewhere) return { kind: 'invalid', reason: 'That workout already has a linked activity' };
  if (current !== null && current.status === 'linked') return { kind: 'stale', current };
  const uuid = input.healthUuid.toLowerCase();
  const next: HealthLink =
    current === null
      ? { id: healthLinkId(uuid), ownerId: input.ownerId, version: 1, createdAtUtc: input.atUtc, updatedAtUtc: input.atUtc, healthUuid: uuid, sessionId: input.sessionId, status: 'linked', by: input.by, opIds: [input.opId] }
      : { ...current, version: current.version + 1, updatedAtUtc: input.atUtc, sessionId: input.sessionId, status: 'linked', by: input.by, opIds: [...current.opIds, input.opId].slice(-HEALTH_LIMITS.maxOps) };
  return { kind: 'write', next, expectedVersion: input.expectedVersion };
}

/**
 * `Not it` on a question: remembered, so that Health workout is never auto-linked or asked about again (Ben can
 * still link it by hand). Only with no record yet.
 */
export function dismissHealthLink(current: HealthLink | null, input: { ownerId: string; healthUuid: string; sessionId: string; opId: string; atUtc: string }): HealthLinkChange {
  if (current !== null) return current.opIds.includes(input.opId) ? { kind: 'duplicate', current } : { kind: 'stale', current };
  const uuid = input.healthUuid.toLowerCase();
  return {
    kind: 'write',
    next: { id: healthLinkId(uuid), ownerId: input.ownerId, version: 1, createdAtUtc: input.atUtc, updatedAtUtc: input.atUtc, healthUuid: uuid, sessionId: input.sessionId, status: 'unlinked', by: 'ben', opIds: [input.opId] },
    expectedVersion: null,
  };
}

/** Unlink: the Health activity shows as its own again and is never auto-linked again. */
export function unlinkHealthActivity(current: HealthLink, input: { opId: string; atUtc: string; expectedVersion: number }): HealthLinkChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.status !== 'linked') return { kind: 'stale', current };
  return {
    kind: 'write',
    next: { ...current, version: current.version + 1, updatedAtUtc: input.atUtc, status: 'unlinked', by: 'ben', opIds: [...current.opIds, input.opId].slice(-HEALTH_LIMITS.maxOps) },
    expectedVersion: current.version,
  };
}

// ---------------------------------------------------------------------------
// Health workouts as activities

export function healthProvenanceOf(s: HealthWorkoutSample): HealthActivityProvenance {
  const info = classifyHealthWorkout(s.activityType);
  return {
    uuid: s.uuid,
    activityType: s.activityType,
    label: info.label,
    sourceName: healthSourceText(s.sourceName),
    startUtc: s.startUtc,
    endUtc: s.endUtc,
    avgHeartRate: s.avgHeartRate === null ? null : Math.round(s.avgHeartRate),
    maxHeartRate: s.maxHeartRate === null ? null : Math.round(s.maxHeartRate),
    ...(s.activeKcal === undefined || s.activeKcal === null ? {} : { activeKcal: Math.round(s.activeKcal) }),
    strength: info.strength,
  };
}

/** A Health workout as a read-only activity (done, on its local date; no effort word: Health has none). Null when too short to be one. */
export function healthActivityOf(s: HealthWorkoutSample, ownerId: string): Activity | null {
  const info = classifyHealthWorkout(s.activityType);
  const seconds = Math.round(s.durationS > 0 ? s.durationS : (toMs(s.endUtc) - toMs(s.startUtc)) / 1000);
  const durationS = seconds >= 60 && seconds <= 24 * 3600 ? seconds : null;
  const distanceM = s.distanceM !== null && s.distanceM >= 10 && s.distanceM <= 1_000_000 ? Math.round(s.distanceM) : null;
  const fields = ActivityFieldsSchema.safeParse({ kind: info.kind, status: 'done', date: localDateOf(toMs(s.startUtc), s.tz), durationS, distanceM, effort: null });
  if (!fields.success) return null;
  return {
    id: s.uuid,
    ownerId,
    version: 1,
    createdAtUtc: s.startUtc,
    updatedAtUtc: s.endUtc,
    fields: fields.data,
    tz: s.tz,
    source: 'health',
    health: healthProvenanceOf(s),
    deletedAtUtc: null,
    lastChange: null,
    opIds: [],
  };
}

/** The app's own write: its source, a UUID it wrote, or an external ID that is one of its workouts (apple-health.md §3.1). */
function isOwnWrite(s: HealthWorkoutSample, ownBundleId: string | null, writtenUuids: ReadonlySet<string>, appSessionIds: ReadonlySet<string>): boolean {
  if (ownBundleId !== null && (s.sourceBundleId === ownBundleId || s.sourceBundleId.startsWith(`${ownBundleId}.`))) return true;
  return writtenUuids.has(s.uuid) || (s.externalId !== null && appSessionIds.has(s.externalId.toLowerCase()));
}

const familyOf = (activityType: number): string => {
  const c = classifyHealthWorkout(activityType);
  return c.strength ? 'strength' : `${c.kind}:${c.label}`;
};

/**
 * Two sources recording the same activity (Apple Watch and Garmin, apple-health.md §3.5): the same family,
 * overlapping at least half of the shorter one, is one. The kept one has distance and heart rate if either does,
 * else the longer. Returns the kept samples and, per kept UUID, the other sources' names.
 */
export function dedupeHealthSources(samples: readonly HealthWorkoutSample[]): { kept: HealthWorkoutSample[]; alsoRecordedBy: Map<string, string[]> } {
  const score = (s: HealthWorkoutSample) => (s.distanceM !== null ? 2 : 0) + (s.avgHeartRate !== null ? 2 : 0) + s.durationS / 1e7;
  const sorted = [...samples].sort((a, b) => score(b) - score(a));
  const kept: HealthWorkoutSample[] = [];
  const alsoRecordedBy = new Map<string, string[]>();
  for (const s of sorted) {
    const twin = kept.find((k) => k.sourceBundleId !== s.sourceBundleId && familyOf(k.activityType) === familyOf(s.activityType) && overlapShare(k, s) >= AUTO_LINK_MIN_OVERLAP);
    if (twin === undefined) kept.push(s);
    else alsoRecordedBy.set(twin.uuid, [...(alsoRecordedBy.get(twin.uuid) ?? []), healthSourceText(s.sourceName)]);
  }
  return { kept: kept.sort((a, b) => toMs(a.startUtc) - toMs(b.startUtc)), alsoRecordedBy };
}

/** A done activity of Ben's matches a Health one when he gave neither number, or each he gave is within 15 %. */
function closeEnough(mine: Activity['fields'], h: Activity['fields']): boolean {
  const near = (a: number | null, b: number | null) => a === null || b === null || Math.abs(a - b) <= 0.15 * Math.max(a, b);
  if (mine.durationS === null && mine.distanceM === null) return true;
  return near(mine.durationS, h.durationS) && near(mine.distanceM, h.distanceM);
}

/**
 * Ben's activities with Health's, as every list shows them (apple-health.md §3.1–§3.5), oldest first:
 * - never the app's own writes, so a workout is never shown twice;
 * - never one linked to an app workout (it shows on that workout instead);
 * - two sources recording the same activity are one;
 * - Ben's planned activity and the one Health run (same kind, same day) are one item, done, with Health's time
 *   and distance and his effort word; his done one likewise when the numbers agree (within 15 %, or he gave
 *   none). His record is unchanged underneath (the item keeps his ID; `health` says what was paired). Anything
 *   else shows apart.
 * Ben's deleted activities are left out, as `listBetween` does.
 */
export function activitiesWithHealth(input: {
  ownerId: string;
  samples: readonly HealthWorkoutSample[];
  links: readonly HealthLink[];
  own: readonly Activity[];
  ownBundleId: string | null;
  writtenUuids: ReadonlySet<string>;
  appSessionIds: ReadonlySet<string>;
}): Activity[] {
  const linked = new Set(input.links.filter((l) => l.status === 'linked').map((l) => l.healthUuid));
  const fresh = input.samples.filter((s) => !isOwnWrite(s, input.ownBundleId, input.writtenUuids, input.appSessionIds) && !linked.has(s.uuid));
  const { kept } = dedupeHealthSources(fresh);
  const health = kept.map((s) => healthActivityOf(s, input.ownerId)).filter((a): a is Activity => a !== null);
  const mine = input.own.filter((a) => a.deletedAtUtc === null && a.source !== 'health').map((a) => ({ a, out: a }));
  const shown: Activity[] = [];
  for (const h of health) {
    const sameDay = (m: { a: Activity; out: Activity }) => m.out === m.a && m.a.fields.kind === h.fields.kind && m.a.fields.date === h.fields.date;
    const sameDayHealth = health.filter((x) => x.fields.kind === h.fields.kind && x.fields.date === h.fields.date).length;
    const match = sameDayHealth === 1 ? mine.find((m) => sameDay(m) && (m.a.fields.status === 'planned' || closeEnough(m.a.fields, h.fields))) : undefined;
    if (match === undefined || h.health === undefined) {
      shown.push(h);
      continue;
    }
    match.out = {
      ...match.a,
      fields: { ...match.a.fields, status: 'done', durationS: h.fields.durationS ?? match.a.fields.durationS, distanceM: h.fields.distanceM ?? match.a.fields.distanceM },
      health: h.health,
    };
  }
  return [...mine.map((m) => m.out), ...shown].sort((x, y) => (x.fields.date < y.fields.date ? -1 : x.fields.date > y.fields.date ? 1 : x.createdAtUtc < y.createdAtUtc ? -1 : 1));
}

/** `Garmin · Strength · 54 min · avg 128 bpm`: a linked or Health activity's recorded facts, labelled with its source. */
export function healthActivityLine(p: HealthActivityProvenance): string {
  const minutes = Math.round((toMs(p.endUtc) - toMs(p.startUtc)) / 60_000);
  const parts = [p.sourceName, p.label, `${String(minutes)}${NBSP}min`];
  if (p.avgHeartRate !== null) parts.push(`avg ${String(p.avgHeartRate)}${NBSP}bpm`);
  if (p.maxHeartRate !== null) parts.push(`max ${String(p.maxHeartRate)}${NBSP}bpm`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Bodyweight

export interface BodyweightEntry extends WeightEntry {
  from: 'you' | 'health';
  /** The Health source (`Withings`), shown as data; null for Ben's. */
  sourceName: string | null;
}

/**
 * Ben's weights and Health's, oldest first. On a day Ben entered one, Health's that day are left out (his entry
 * wins); otherwise Health's latest that day stands. Health's are in kg, as Health gives them.
 */
export function bodyweightEntries(own: readonly WeightEntry[], health: readonly HealthWeightSample[]): BodyweightEntry[] {
  const ownDays = new Set(own.map((w) => w.date));
  const healthByDay = new Map<string, BodyweightEntry>();
  for (const h of health) {
    const date = localDateOf(toMs(h.atUtc), h.tz);
    if (ownDays.has(date)) continue;
    const entry: BodyweightEntry = { id: h.uuid, date, value: Math.round(h.kg * 100) / 100, unit: 'kg', recordedAtUtc: h.atUtc, from: 'health', sourceName: healthSourceText(h.sourceName) };
    const have = healthByDay.get(date);
    if (have === undefined || have.recordedAtUtc < entry.recordedAtUtc) healthByDay.set(date, entry);
  }
  const all: BodyweightEntry[] = [...own.map((w) => ({ ...w, from: 'you' as const, sourceName: null })), ...healthByDay.values()];
  return all.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.recordedAtUtc < b.recordedAtUtc ? -1 : a.recordedAtUtc > b.recordedAtUtc ? 1 : a.id.localeCompare(b.id)));
}

/** The newest bodyweight (Ben's or Health's), or null. */
export function latestBodyweight(entries: readonly BodyweightEntry[]): BodyweightEntry | null {
  return entries.at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// Read window (Q6), resting heart rate and sleep (Q8): raw values only, no scores (rule 6)

/** Days each `How far back` choice reads; `all`: everything Health has. */
export const READ_WINDOW_DAYS: Readonly<Record<HealthReadWindow, number | null>> = { '4w': 28, '8w': 56, '6m': 183, '1y': 365, all: null };

export const READ_WINDOW_WORD: Readonly<Record<HealthReadWindow, string>> = { '4w': '4 weeks', '8w': '8 weeks', '6m': '6 months', '1y': '1 year', all: 'All' };

/** Where a read starts: the window back from now, at least `minDays` (bodyweight reads 2 years at least); 0 for `all`. */
export function readSinceMs(window: HealthReadWindow, nowMs: number, minDays = 0): number {
  const days = READ_WINDOW_DAYS[window];
  return days === null ? 0 : nowMs - Math.max(days, minDays) * 86_400_000;
}

/** One value a day, with the source that recorded it (shown as data). */
export interface HealthDailyValue {
  date: string;
  value: number;
  source: string;
}

/** Resting heart rate, one a day (the day's latest), rounded bpm, oldest first. */
export function restingHeartRateDays(samples: readonly HealthRestingHrSample[]): HealthDailyValue[] {
  const byDay = new Map<string, HealthRestingHrSample>();
  for (const s of samples) {
    const date = localDateOf(toMs(s.atUtc), s.tz);
    const have = byDay.get(date);
    if (have === undefined || have.atUtc < s.atUtc) byDay.set(date, s);
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, s]) => ({ date, value: Math.round(s.bpm), source: healthSourceText(s.sourceName) }));
}

const ASLEEP: ReadonlySet<string> = new Set(['asleep', 'core', 'deep', 'rem']);

/**
 * Minutes asleep per night (the local date it ended), oldest first. Only asleep stages count; overlapping
 * segments of one source count once; with two sources (watch and phone) the night is the source with the most
 * sleep that night, never the two added together.
 */
export function sleepNights(samples: readonly HealthSleepSample[]): HealthDailyValue[] {
  const groups = new Map<string, { date: string; source: string; spans: [number, number][] }>();
  for (const s of samples) {
    if (!ASLEEP.has(s.stage)) continue;
    const start = toMs(s.startUtc);
    const end = toMs(s.endUtc);
    if (!(end > start)) continue;
    const date = localDateOf(end, s.tz);
    const key = `${date}|${s.sourceBundleId}`;
    const g = groups.get(key) ?? { date, source: healthSourceText(s.sourceName), spans: [] };
    g.spans.push([start, end]);
    groups.set(key, g);
  }
  const best = new Map<string, HealthDailyValue>();
  for (const g of groups.values()) {
    const spans = [...g.spans].sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cur: [number, number] | null = null;
    for (const sp of spans) {
      if (cur !== null && sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1]);
      else {
        if (cur !== null) total += cur[1] - cur[0];
        cur = [sp[0], sp[1]];
      }
    }
    if (cur !== null) total += cur[1] - cur[0];
    const minutes = Math.round(total / 60_000);
    const have = best.get(g.date);
    if (have === undefined || have.value < minutes) best.set(g.date, { date: g.date, value: minutes, source: g.source });
  }
  return [...best.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** `7 h 20 min` asleep. */
export function sleepText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${String(m)}${NBSP}min` : m === 0 ? `${String(h)}${NBSP}h` : `${String(h)}${NBSP}h ${String(m)}${NBSP}min`;
}

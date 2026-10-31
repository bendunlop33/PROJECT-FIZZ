import {
  ActivityFieldsSchema,
  HEALTH_LIMITS,
  isFizzBundle,
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

import { addDays, localDateOf, localHourUtcMs, localMidnightUtcMs } from './calendar';
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

/**
 * A source name as shown: control characters out, `Garmin Connect` → `Garmin`, cut short. Data, never read as an
 * instruction (rule 8). Garmin Connect's iPhone app is named just `Connect` in Health (Ben, 31 Oct: `Strength · 50 min ·
 * Connect`): that is `Garmin` too.
 */
export function healthSourceText(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const short = /^connect$/i.test(clean) ? 'Garmin' : clean.replace(/\s+Connect$/i, '');
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
  /** Entered after the fact (`Log a past workout`): its times are rough, so a match a day either side is offered. */
  pastLogged?: boolean;
  /**
   * (Ben, 29 Oct) A date-only workout (a FitNotes import: no time of day, no end), on this local date. Paired by hand
   * on its own date only, never automatically (its start is only an ordering anchor).
   */
  localDate?: string;
  /**
   * (Ben, 31 Oct) A date-only workout whose start is a time written in the file (a layout import's `18:02`), not the
   * 12:00 ordering anchor: it may auto-link by start time (`ASK_WITHIN_MS`).
   */
  startAsWritten?: boolean;
}

/** A workout's local date: its own date-only date, else its start's. */
export function linkableDate(w: LinkableWorkout): string {
  return w.localDate ?? localDateOf(toMs(w.startUtc), w.tz);
}

/**
 * (Ben, 29 Oct) The Health workouts that can be linked at all: never the app's own copies, by a UUID it wrote or an
 * external ID that is one of its workouts (a copy from an older build's bundle passes the source check; counted as a
 * second strength workout that day, it blocked the auto-link).
 */
export function linkableSamples(samples: readonly HealthWorkoutSample[], writtenUuids: ReadonlySet<string>, appSessionIds: ReadonlySet<string>): HealthWorkoutSample[] {
  return samples.filter((s) => !isOwnCopy(s, writtenUuids, appSessionIds));
}

/** (Ben, 31 Oct) The app's own Health copy: a UUID it wrote, one of its workouts' IDs, or any install's bundle (`isFizzBundle`). */
export function isOwnCopy(s: HealthWorkoutSample, writtenUuids: ReadonlySet<string>, appSessionIds: ReadonlySet<string>): boolean {
  return writtenUuids.has(s.uuid) || isFizzBundle(s.sourceBundleId) || (s.externalId !== null && appSessionIds.has(s.externalId.toLowerCase()));
}

/**
 * (Ben, 31 Oct: "These should link") Two Health strength workouts that are one session recorded twice (Garmin
 * writing it again, a watch's twin), whatever their sources: the same local day, overlapping by most of the shorter
 * one (`AUTO_LINK_MIN_OVERLAP`). Pure.
 */
export function sameSessionSamples(a: HealthWorkoutSample, b: HealthWorkoutSample): boolean {
  return a.uuid !== b.uuid && HK_STRENGTH_TYPES.has(a.activityType) && HK_STRENGTH_TYPES.has(b.activityType) && localDateOf(toMs(a.startUtc), a.tz) === localDateOf(toMs(b.startUtc), a.tz) && overlapShare(a, b) >= AUTO_LINK_MIN_OVERLAP;
}

/** A link record that is Ben's own `Unlink` or `Not it`: that Health workout stays apart, never folded into another. */
const bensApart = (l: HealthLink | undefined): boolean => l !== undefined && l.status !== 'linked' && l.by === 'ben';

/**
 * (Ben, 31 Oct) The Health workouts that are a linked workout recorded again, by UUID, with the link they belong to:
 * the link's own `also`, and any strength workout with no link of its own that is the same session as a linked one
 * (`sameSessionSamples`). Ben's own `Unlink` / `Not it` keeps one apart. They show nowhere on their own: the linked
 * workout shows once. Pure.
 */
export function linkedTwins(samples: readonly HealthWorkoutSample[], links: readonly HealthLink[]): Map<string, HealthLink> {
  const live = links.filter((l) => l.status === 'linked');
  const recordOf = new Map(links.map((l) => [l.healthUuid, l] as const));
  const liveUuids = new Set(live.map((l) => l.healthUuid));
  const linkedSamples = samples.filter((x) => liveUuids.has(x.uuid));
  const out = new Map<string, HealthLink>();
  for (const l of live) for (const u of l.also ?? []) if (!liveUuids.has(u)) out.set(u, l);
  for (const s of samples) {
    if (liveUuids.has(s.uuid) || out.has(s.uuid) || bensApart(recordOf.get(s.uuid))) continue;
    const twin = linkedSamples.find((l) => sameSessionSamples(s, l));
    const link = twin === undefined ? undefined : live.find((l) => l.healthUuid === twin.uuid);
    if (link !== undefined) out.set(s.uuid, link);
  }
  return out;
}

/**
 * (Ben, 31 Oct) What reading records into the links: each strength workout that is a linked workout recorded again
 * (`linkedTwins`) and not in its link's `also` yet, by link. Pure.
 */
export function twinsToRecord(samples: readonly HealthWorkoutSample[], links: readonly HealthLink[]): { healthUuid: string; add: string[] }[] {
  const by = new Map<string, string[]>();
  for (const [uuid, l] of linkedTwins(samples, links)) {
    if ((l.also ?? []).includes(uuid)) continue;
    by.set(l.healthUuid, [...(by.get(l.healthUuid) ?? []), uuid]);
  }
  return [...by].map(([healthUuid, add]) => ({ healthUuid, add: add.sort() }));
}

/**
 * (Ben, 31 Oct: "Same workout") Add Health workouts to a live link as the same session recorded again (`also`), or
 * take them out (`remove`: its Undo). On the version read; idempotent by op ID. Pure.
 */
export function changeLinkAlso(current: HealthLink | null, input: { add?: readonly string[]; remove?: readonly string[]; opId: string; atUtc: string; expectedVersion: number | null }): HealthLinkChange {
  if (current === null) return { kind: 'stale', current: null };
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (input.expectedVersion !== null && current.version !== input.expectedVersion) return { kind: 'stale', current };
  if (current.status !== 'linked') return { kind: 'stale', current };
  const add = (input.add ?? []).map((u) => u.toLowerCase()).filter((u) => u !== current.healthUuid);
  const remove = new Set((input.remove ?? []).map((u) => u.toLowerCase()));
  const also = [...new Set([...(current.also ?? []).filter((u) => !remove.has(u)), ...add])];
  if (also.length > HEALTH_LIMITS.maxAlso) return { kind: 'invalid', reason: 'Too many recordings of one workout' };
  const { also: _drop, ...rest } = current;
  return {
    kind: 'write',
    next: { ...rest, ...(also.length === 0 ? {} : { also }), version: current.version + 1, updatedAtUtc: input.atUtc, opIds: [...current.opIds, input.opId].slice(-HEALTH_LIMITS.maxOps) },
    expectedVersion: current.version,
  };
}

/**
 * (Ben, 31 Oct: "These should link") Automatic links that hold a workout with the wrong Health workout: the app's own
 * copy (`ownUuids`, or any install's bundle), or one no longer in Health (absent from a read covering its day), while
 * a strength workout from another source, with no link record, overlaps that workout the same day. Releasing them lets
 * the real one link (`autoLinkPairs`). Ben's own links are left alone. Pure.
 */
export function linksToRelink(input: { links: readonly HealthLink[]; samples: readonly HealthWorkoutSample[]; workouts: readonly LinkableWorkout[]; ownUuids: ReadonlySet<string>; readFromUtc: string }): HealthLink[] {
  const byUuid = new Map(input.samples.map((x) => [x.uuid, x] as const));
  const recorded = new Set(input.links.map((l) => l.healthUuid));
  const fromMs = toMs(input.readFromUtc) + 86_400_000;
  const workoutOf = new Map(input.workouts.map((w) => [w.sessionId, w] as const));
  return input.links.filter((l) => {
    if (l.status !== 'linked' || l.by !== 'auto') return false;
    const w = workoutOf.get(l.sessionId);
    if (w === undefined || (w.localDate !== undefined && w.startAsWritten !== true)) return false;
    const sample = byUuid.get(l.healthUuid);
    const wrong = sample === undefined ? toMs(w.startUtc) >= fromMs : input.ownUuids.has(l.healthUuid) || isFizzBundle(sample.sourceBundleId);
    if (!wrong) return false;
    return input.samples.some((x) => HK_STRENGTH_TYPES.has(x.activityType) && !recorded.has(x.uuid) && !input.ownUuids.has(x.uuid) && !isFizzBundle(x.sourceBundleId) && sameDay(x, w) && overlapShare(x, w) > 0);
  });
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
  return localDateOf(toMs(sample.startUtc), w.tz) === linkableDate(w);
}

function linkedSessions(links: readonly HealthLink[]): Set<string> {
  return new Set(links.filter((l) => l.status === 'linked').map((l) => l.sessionId));
}

/** The fuller recording first: heart rate, then distance, then the longer, then by UUID. */
const recordingScore = (s: HealthWorkoutSample) => (s.avgHeartRate !== null ? 4 : 0) + (s.distanceM !== null ? 2 : 0);
function fullerFirst(a: HealthWorkoutSample, b: HealthWorkoutSample): number {
  return recordingScore(b) - recordingScore(a) || b.durationS - a.durationS || a.uuid.localeCompare(b.uuid);
}

/** One day's strength workouts grouped into sessions (`sameSessionSamples`, transitively), each fuller first. */
function sessionGroups(samples: readonly HealthWorkoutSample[]): HealthWorkoutSample[][] {
  const groups: HealthWorkoutSample[][] = [];
  for (const s of samples) {
    const hit = groups.filter((g) => g.some((x) => sameSessionSamples(s, x)));
    const merged = [s, ...hit.flat()];
    for (const g of hit) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  return groups.map((g) => [...g].sort(fullerFirst));
}

/** Auto-link needs the two within this of each other (or overlapping): log times differ (Ben, 27 Oct). */
export const AUTO_LINK_NEAR_MS = 2 * 3_600_000;

/** Overlapping, or start or end within `AUTO_LINK_NEAR_MS` of the other's. */
function nearInTime(s: HealthInterval, w: HealthInterval): boolean {
  if (overlapShare(s, w) > 0) return true;
  const [ss, se, ws, we] = [toMs(s.startUtc), toMs(s.endUtc), toMs(w.startUtc), toMs(w.endUtc)];
  return Math.min(Math.abs(ss - we), Math.abs(se - ws), Math.abs(ss - ws), Math.abs(se - we)) <= AUTO_LINK_NEAR_MS;
}

/**
 * The Health workouts to link on reading (apple-health.md §3.2; Ben, 27 Oct: "the log times won't always be the
 * same"). Times never block a link; they only decide whether it is automatic. Auto-link when, on one local day, there
 * is exactly one Health strength-family workout with no link record (an unlinked or `Not it` one is never linked or
 * offered again automatically) and exactly one app workout, not linked yet, and the two overlap or are within 2 h.
 * Anything else is offered as a one-tap `Link` (`sameDayLinkCandidates`).
 *
 * (Ben, 31 Oct) Run over every Health workout in the read window on each read, so past days pair too (a back-fill),
 * never across days. A date-only imported workout (no end) auto-links only when its start is a time from the file
 * (`startAsWritten`) and the Health workout starts within `ASK_WITHIN_MS` of it; one with no time (FitNotes: the
 * 12:00 anchor) is left for the day sheet's `Pair`.
 */
export function autoLinkPairs(input: { samples: readonly HealthWorkoutSample[]; workouts: readonly LinkableWorkout[]; links: readonly HealthLink[] }): { healthUuid: string; sessionId: string; also?: string[] }[] {
  // (Ben, 31 Oct) A workout recorded twice (Garmin writing it again, a watch's twin) is one: the twins of a linked
  // workout are that link's, and two unlinked twins on a day count once (the fuller one links, the other is `also`).
  const twins = linkedTwins(input.samples, input.links);
  const recorded = new Set([...input.links.map((l) => l.healthUuid), ...twins.keys()]);
  const taken = linkedSessions(input.links);
  const byDay = new Map<string, { samples: HealthWorkoutSample[]; workouts: LinkableWorkout[] }>();
  const day = (date: string) => {
    let d = byDay.get(date);
    if (d === undefined) {
      d = { samples: [], workouts: [] };
      byDay.set(date, d);
    }
    return d;
  };
  for (const w of input.workouts) day(linkableDate(w)).workouts.push(w);
  for (const s of input.samples) {
    if (!HK_STRENGTH_TYPES.has(s.activityType) || recorded.has(s.uuid)) continue;
    day(localDateOf(toMs(s.startUtc), s.tz)).samples.push(s);
  }
  const out: { healthUuid: string; sessionId: string; also?: string[] }[] = [];
  for (const d of byDay.values()) {
    const groups = sessionGroups(d.samples);
    const [g] = groups;
    const [w] = d.workouts;
    if (groups.length !== 1 || d.workouts.length !== 1 || g === undefined || w === undefined || taken.has(w.sessionId)) continue;
    const [s, ...also] = g;
    if (s === undefined) continue;
    // A date-only workout has no end: only a start written in the file can match, by start time; the noon anchor never does.
    const near = w.localDate === undefined ? nearInTime(s, w) : w.startAsWritten === true && Math.abs(toMs(s.startUtc) - toMs(w.startUtc)) <= ASK_WITHIN_MS;
    if (near) out.push({ healthUuid: s.uuid, sessionId: w.sessionId, ...(also.length === 0 ? {} : { also: also.map((x) => x.uuid).sort() }) });
  }
  return out;
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
  // A date-only workout has no times to be near: only the one-tap same-day Link offers it.
  if (linkedSessions(links).has(workout.sessionId) || workout.localDate !== undefined) return [];
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

/**
 * (Ben, 27 Oct: "TrainingPeaks lets you just click Pair or Link") The Summary's one-tap `Link`: the same local day's
 * Health strength (or `other`) workouts with no link record (an unlinked or `Not it` one isn't offered again here;
 * `Link activity from Health` still lists it), not the app's own, nearest in time first.
 */
export function sameDayLinkCandidates(workout: LinkableWorkout, samples: readonly HealthWorkoutSample[], links: readonly HealthLink[]): HealthWorkoutSample[] {
  if (linkedSessions(links).has(workout.sessionId)) return [];
  const recorded = new Set(links.map((l) => l.healthUuid));
  const ws = toMs(workout.startUtc);
  const days = linkDays(workout);
  return samples
    .filter((s) => (HK_STRENGTH_TYPES.has(s.activityType) || s.activityType === HK_OTHER_TYPE) && !recorded.has(s.uuid) && days.has(localDateOf(toMs(s.startUtc), workout.tz)))
    .sort((a, b) => Math.abs(toMs(a.startUtc) - ws) - Math.abs(toMs(b.startUtc) - ws));
}

/**
 * The days a workout's Health match may be on: its own; and the day either side when it is near midnight (starts
 * before 02:00 or from 22:00, or ends on another day) or was logged after the fact with rough times (Ben, 27 Oct).
 */
export function linkDays(w: LinkableWorkout): Set<string> {
  if (w.localDate !== undefined) return new Set([w.localDate]);
  const start = toMs(w.startUtc);
  const date = localDateOf(start, w.tz);
  const hour = (start - localMidnightUtcMs(date, w.tz)) / 3_600_000;
  const crossesMidnight = localDateOf(toMs(w.endUtc), w.tz) !== date;
  const wide = w.pastLogged === true || hour < 2 || hour >= 22 || crossesMidnight;
  return new Set(wide ? [addDays(date, -1), date, addDays(date, 1)] : [date]);
}

/**
 * Summary `⋯ › Link activity from Health`: any Health strength or `other` workout from the day before to the day
 * after, not linked to another workout (an unlinked or `Not it` one included: linking by hand is always allowed).
 */
export function linkChoicesFor(workout: LinkableWorkout, samples: readonly HealthWorkoutSample[], links: readonly HealthLink[]): HealthWorkoutSample[] {
  if (linkedSessions(links).has(workout.sessionId)) return [];
  const taken = new Set(links.filter((l) => l.status === 'linked').map((l) => l.healthUuid));
  const ws = toMs(workout.startUtc);
  const day = localDateOf(ws, workout.tz);
  const near = new Set([addDays(day, -1), day, addDays(day, 1)]);
  return samples
    .filter((s) => (HK_STRENGTH_TYPES.has(s.activityType) || s.activityType === HK_OTHER_TYPE) && !taken.has(s.uuid) && near.has(localDateOf(toMs(s.startUtc), workout.tz)))
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

/**
 * (Ben, 29 Oct: "These two strength sessions should be linkable? Why no option to pair workouts together") A day's
 * pairs for the day sheet, on `date` only (never across days, Ben). `unpaired`: each Health strength (or `other`)
 * workout with no link to a workout, with the day's app workouts not linked yet, nearest in time first (a `Not it` or
 * an unlinked one included: pairing by hand is always allowed). `paired`: the day's workouts with their linked Health
 * workout. Pure.
 */
export function dayPairs(input: { date: string; samples: readonly HealthWorkoutSample[]; workouts: readonly LinkableWorkout[]; links: readonly HealthLink[] }): {
  /** `same`: (Ben, 31 Oct) the day's paired workouts it may be a second recording of (`Same workout`). */
  unpaired: { sample: HealthWorkoutSample; choices: LinkableWorkout[]; same: { workout: LinkableWorkout; link: HealthLink }[] }[];
  paired: { workout: LinkableWorkout; sample: HealthWorkoutSample; link: HealthLink }[];
} {
  const live = input.links.filter((l) => l.status === 'linked');
  const linkOf = new Map(live.map((l) => [l.healthUuid, l]));
  const dayWorkouts = input.workouts.filter((w) => linkableDate(w) === input.date);
  const byId = new Map(dayWorkouts.map((w) => [w.sessionId, w]));
  const sampleDate = (s: HealthWorkoutSample) => localDateOf(toMs(s.startUtc), s.tz);
  const pairable = (s: HealthWorkoutSample) => HK_STRENGTH_TYPES.has(s.activityType) || s.activityType === HK_OTHER_TYPE;
  const taken = new Set(live.map((l) => l.sessionId));
  const free = dayWorkouts.filter((w) => !taken.has(w.sessionId));
  const unpaired: { sample: HealthWorkoutSample; choices: LinkableWorkout[]; same: { workout: LinkableWorkout; link: HealthLink }[] }[] = [];
  const paired: { workout: LinkableWorkout; sample: HealthWorkoutSample; link: HealthLink }[] = [];
  // (Ben, 31 Oct) A linked workout recorded again is that workout: never a row of its own, never offered.
  const twins = linkedTwins(input.samples, input.links);
  const dayLinks = live.filter((l) => byId.has(l.sessionId));
  for (const s of input.samples) {
    const link = linkOf.get(s.uuid);
    if (link !== undefined) {
      const w = byId.get(link.sessionId);
      if (w !== undefined) paired.push({ workout: w, sample: s, link });
      continue;
    }
    if (twins.has(s.uuid) || !pairable(s) || sampleDate(s) !== input.date) continue;
    const at = toMs(s.startUtc);
    const near = (a: LinkableWorkout, b: LinkableWorkout) => Math.abs(toMs(a.startUtc) - at) - Math.abs(toMs(b.startUtc) - at) || a.sessionId.localeCompare(b.sessionId);
    const choices = [...free].sort(near);
    const same = HK_STRENGTH_TYPES.has(s.activityType)
      ? dayLinks
          .map((l) => ({ workout: byId.get(l.sessionId), link: l }))
          .filter((x): x is { workout: LinkableWorkout; link: HealthLink } => x.workout !== undefined)
          .sort((a, b) => near(a.workout, b.workout))
      : [];
    if (choices.length === 0 && same.length === 0) continue;
    unpaired.push({ sample: s, choices, same });
  }
  return { unpaired: unpaired.sort((a, b) => toMs(a.sample.startUtc) - toMs(b.sample.startUtc)), paired };
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

/**
 * (Ben, 31 Oct) Live automatic links to the app's own Health copy of a workout (an older build, before 29 Oct, could
 * auto-link a copy whose source wasn't its bundle): they hold the workout, so the Garmin workout that day never
 * linked. `ownUuids`: the copies' UUIDs (written by the app, or carrying one of its workouts' IDs). Ben's own links
 * are left alone. Pure.
 */
export function ownCopyLinks(links: readonly HealthLink[], ownUuids: ReadonlySet<string>): HealthLink[] {
  return links.filter((l) => l.status === 'linked' && l.by === 'auto' && ownUuids.has(l.healthUuid));
}

/** Release one of `ownCopyLinks`: unlinked, still `auto` (Ben never chose it), versioned and idempotent. */
export function releaseOwnCopyLink(current: HealthLink, input: { opId: string; atUtc: string; expectedVersion: number }): HealthLinkChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.status !== 'linked' || current.by !== 'auto') return { kind: 'stale', current };
  return {
    kind: 'write',
    next: { ...current, version: current.version + 1, updatedAtUtc: input.atUtc, status: 'unlinked', opIds: [...current.opIds, input.opId].slice(-HEALTH_LIMITS.maxOps) },
    expectedVersion: current.version,
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
  if (isFizzBundle(s.sourceBundleId, ownBundleId)) return true;
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
 * - never one linked to an app workout (it shows on that workout instead), nor another source's recording of that
 *   same activity (a watch's twin of the linked Garmin workout: Ben, 31 Oct);
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
  const notOwn = input.samples.filter((s) => !isOwnWrite(s, input.ownBundleId, input.writtenUuids, input.appSessionIds));
  const linkedSamples = notOwn.filter((s) => linked.has(s.uuid));
  // A watch's twin of a linked workout (another family member too, e.g. an `other` with the same times), and (Ben,
  // 31 Oct) any strength workout that is the linked one recorded again, from any source (`linkedTwins`).
  const twins = linkedTwins(notOwn, input.links);
  const twinOfLinked = (s: HealthWorkoutSample) => twins.has(s.uuid) || linkedSamples.some((l) => l.sourceBundleId !== s.sourceBundleId && familyOf(l.activityType) === familyOf(s.activityType) && overlapShare(l, s) >= AUTO_LINK_MIN_OVERLAP);
  const fresh = notOwn.filter((s) => !linked.has(s.uuid) && !twinOfLinked(s));
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

/** A night runs from 18:00 the evening before to 12:00 on its date (local). */
export const SLEEP_NIGHT = { eveningHour: 18, noonHour: 12 } as const;

/**
 * The night (its local wake-up date) a sleep segment belongs to (Ben, 27 Oct): a segment ending at or after 18:00
 * belongs to the next date, so 22:30–23:59 and 00:00–06:30 are one night. A segment starting at or after noon on
 * that date (an afternoon nap) belongs to no night: null.
 */
export function sleepNightOf(startMs: number, endMs: number, tz: string): string | null {
  const endDate = localDateOf(endMs, tz);
  const night = endMs >= localHourUtcMs(endDate, SLEEP_NIGHT.eveningHour, tz) ? addDays(endDate, 1) : endDate;
  return startMs < localHourUtcMs(night, SLEEP_NIGHT.noonHour, tz) ? night : null;
}

/**
 * Minutes asleep per night (its local wake-up date, `sleepNightOf`), oldest first. Only asleep stages count;
 * overlapping segments of one source count once; with two sources (watch and phone) the night is the source with
 * the most sleep that night, never the two added together. Afternoon naps are left out.
 */
export function sleepNights(samples: readonly HealthSleepSample[]): HealthDailyValue[] {
  const groups = new Map<string, { date: string; source: string; spans: [number, number][] }>();
  for (const s of samples) {
    if (!ASLEEP.has(s.stage)) continue;
    const start = toMs(s.startUtc);
    const end = toMs(s.endUtc);
    if (!(end > start)) continue;
    const date = sleepNightOf(start, end, s.tz);
    if (date === null) continue;
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

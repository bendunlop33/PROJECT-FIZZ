import {
  localMidnightUtcMs,
  autoLinkPairs,
  ownCopyLinks,
  releaseOwnCopyLink,
  dayPairs,
  linkableSamples,
  classifyHealthWorkout,
  dismissHealthLink,
  healthActivityOf,
  healthCandidateOf,
  healthProvenanceOf,
  healthSyncIdentifier,
  healthWriteRecordAfter,
  healthWriteRemoved,
  HK_WRITE_TYPE,
  linkHealthActivity,
  linkChoicesFor,
  localDateOf,
  sameDayLinkCandidates,
  linkSuggestion,
  nearbyWorkouts,
  planHealthWrites,
  timingUndoCommand,
  type CommandOutcome,
  readSinceMs,
  restingHeartRateDays,
  sleepNights,
  todayHealthLine,
  todayHealthLineFor,
  bodyweightEntries,
  convertMass,
  latestBodyweight,
  type TodayHealthShows,
  toIso,
  toMs,
  unlinkHealthActivity,
  type HealthDailyValue,
  type TodayHealthLine,
  type HealthWriteCandidate,
  type HealthWriteOp,
  type LinkableWorkout,
} from '@fizz/domain';
import type { HealthLinkWrite, Store } from '@fizz/persistence';
import { healthCapability, restingHrSamplesFrom, sleepSamplesFrom, weightSamplesFrom, workoutSamplesFrom, type HealthCapability, type HealthPort, type HealthType } from '@fizz/providers';
import type { LinkedActivityContext } from '@fizz/coach';
import { DEFAULT_HEALTH_SETTINGS, type Activity, type HealthLink, type HealthReadWindow, type HealthSettings, type HealthWorkoutSample, type SessionCommand, type HealthWorkoutWrite, type SessionAggregate, type UserProfile, type ZonedTimestamp } from '@fizz/schemas';

import { NATIVE_PAUSED_COPY, type NativePause } from '../diagnostics/launch-guard';
import { HEALTH_COPY, healthScreenView, linkCandidateLine, linkedActivityView, NO_DAY_PAIRS, pairedFacts, type DayPairsView, type HealthScreenView, type HealthSwitch, type LinkCandidateView, type WorkoutHealthView } from './health-view';
import { formatTime } from '../format/dates';

/**
 * Apple Health (Ben, 27 Oct; ADR 0035; apple-health.md). Local only, never waits on the network (rule 1), and
 * never in the logging loop: writes run after Finish and on edits, reads on app open and return to the
 * foreground (not while a workout is open). Every decision is the domain's; this file moves data between
 * HealthKit (`HealthPort`) and the store.
 *
 * - Switches: each asks iOS for its own types only when Ben turns it on. Turning a read off forgets what it read
 *   (it is read again when turned on); turning writing off stops writes (Health keeps what it has).
 * - Writes: `syncWrites` runs `planHealthWrites` over the workouts that changed (by revision) and does each op once
 *   (deterministic op IDs; the module adopts a sample already written for a retried op).
 * - Reads: as far back as `How far back` says (Ben, 27 Oct, Q6; default 8 weeks), bodyweight at least 2 years. A read
 *   replaces its window. Clear overlaps of strength workouts are linked automatically afterwards; a linked watch
 *   workout then replaces the app's own Health write (Q1). Resting heart rate and sleep (Q8) are raw values.
 */

/** Bodyweight reads at least this far back whatever the window (Q6). */
export const WEIGHT_MIN_DAYS = 2 * 365;
/** Progress's trend lines and the coach see this many days of resting heart rate and sleep. */
export const SIGNAL_DAYS = 30;
/** A read on return to the foreground waits this long since the last one. */
export const READ_EVERY_MS = 15 * 60_000;

export interface HealthServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  newId: () => string;
  /** The HealthKit bridge; null when the build has no module (Expo Go, an older build). */
  port: HealthPort | null;
  /** False when the build left the entitlement out (`FIZZ_HEALTHKIT=0`). */
  buildIncludesHealth: boolean;
  /**
   * (Ben, 28 Oct) Off this run by the launch guard (safe start) or the native-off record (`nativeFeaturePause`): shown
   * as `Paused for this launch` / `Paused on this build`, distinct from an install without Health. Absent: never.
   */
  paused?: () => NativePause | null;
  /** Whether a workout is open now (reads wait until it is finished). */
  workoutOpen: () => Promise<boolean>;
  /** The workout's versioned commands (`Use watch times` goes through the existing time-shift path). */
  dispatch?: (sessionId: string, command: SessionCommand) => Promise<CommandOutcome>;
}

/** Start or end this far from the watch's: `Use watch times` is offered. */
export const WATCH_TIMES_DIFFER_MS = 2 * 60_000;

export type HealthSwitchOutcome = { ok: true } | { ok: false; message: string };
export type HealthLinkOutcome = { ok: true; healthUuid: string; version: number } | { ok: false; message: string };

const READ_TYPES: Readonly<Record<Exclude<HealthSwitch, 'writeWorkouts'>, HealthType[]>> = {
  readActivities: ['workout', 'distanceWalkingRunning', 'distanceCycling', 'distanceSwimming', 'activeEnergyBurned'],
  readHeartRate: ['heartRate'],
  readWeight: ['bodyMass'],
  readRestingHeartRate: ['restingHeartRate'],
  readSleep: ['sleepAnalysis'],
};

/** The raw daily values Progress and the coach show (Q8), with their source. */
export interface HealthSignals {
  restingHeartRate: HealthDailyValue[];
  sleep: HealthDailyValue[];
}

export function createHealthService(deps: HealthServiceDeps) {
  const repo = () => deps.store().repos.health;
  let capability: Promise<HealthCapability> | null = null;
  let reading = false;
  let newOnLastRead: number | null = null;
  let notSaved = 0;
  let syncing: Promise<void> | null = null;
  let lastReadStartMs = 0;

  const paused = (): NativePause | null => deps.paused?.() ?? null;
  /** What a refused Health action says: paused this run, else not on this install. */
  const unavailableText = (): string => {
    const p = paused();
    return p === null ? HEALTH_COPY.notAvailable : NATIVE_PAUSED_COPY[p].line;
  };

  function cap(refresh = false): Promise<HealthCapability> {
    if (capability === null || refresh) capability = healthCapability(deps.port, deps.buildIncludesHealth);
    return capability;
  }

  async function owner(): Promise<UserProfile | null> {
    return deps.profile().catch(() => null);
  }

  async function settings(ownerId: string): Promise<HealthSettings | null> {
    return repo()
      .settings(ownerId)
      .catch(() => null);
  }

/** (Q8) Resting heart rate and sleep, a value a day for the last 30 days, each with its source; empty while off. */
  async function readSignals(window: { from: string; to: string } | null = null): Promise<HealthSignals> {
    const p = await owner();
    const s = p === null ? null : await settings(p.id);
    if (p === null || s === null) return { restingHeartRate: [], sleep: [] };
    // (Redesign v3 C2) Progress › Body follows the period bar: the days in its window (a day early for last night's sleep).
    const from = window === null ? toIso(toMs(deps.now().utc) - (SIGNAL_DAYS + 1) * 86_400_000) : toIso(localMidnightUtcMs(window.from, p.timezone) - 86_400_000);
    const [hr, sleep] = await Promise.all([
      s.readRestingHeartRate ? repo().samplesSince(p.id, 'resting_hr', from).catch(() => []) : Promise.resolve([]),
      s.readSleep ? repo().samplesSince(p.id, 'sleep', from).catch(() => []) : Promise.resolve([]),
    ]);
    if (window !== null) {
      const inside = (d: { date: string }) => d.date >= window.from && d.date <= window.to;
      return { restingHeartRate: restingHeartRateDays(hr).filter(inside), sleep: sleepNights(sleep).filter(inside) };
    }
    return { restingHeartRate: restingHeartRateDays(hr).slice(-SIGNAL_DAYS), sleep: sleepNights(sleep).slice(-SIGNAL_DAYS) };
  }

  // ------------------------------------------------------------------ writes

  async function doOp(op: HealthWriteOp, prev: HealthWorkoutWrite | null, ownerId: string, tz: string, revision: number): Promise<boolean> {
    const port = deps.port;
    if (port === null) return false;
    try {
      if (op.kind === 'save') {
        const w = op.workout;
        const saved = await port.saveWorkout({
          activityType: HK_WRITE_TYPE[w.type],
          startMs: toMs(w.startUtc),
          endMs: toMs(w.endUtc),
          pauses: w.pauses.map((p) => ({ startMs: toMs(p.startUtc), endMs: toMs(p.endUtc) })),
          syncIdentifier: healthSyncIdentifier(op.sessionId),
          syncVersion: op.syncVersion,
          externalId: op.sessionId,
          timeZone: tz,
        });
        // Health replaces an older version with the same sync identifier; the old sample is deleted too in case it didn't.
        if (op.replacesUuid !== null && op.replacesUuid !== saved.uuid.toLowerCase()) await port.deleteWorkout(op.replacesUuid).catch(() => 0);
        const next = healthWriteRecordAfter(prev, op, { kind: 'saved', healthUuid: saved.uuid }, ownerId, deps.now().utc);
        if (next !== null) await repo().saveWrite(next, prev?.version ?? null, revision);
      } else {
        await port.deleteWorkout(op.healthUuid);
        const next = healthWriteRecordAfter(prev, op, { kind: 'deleted' }, ownerId, deps.now().utc);
        if (next !== null) await repo().saveWrite(next, prev?.version ?? null, revision);
      }
      return true;
    } catch {
      return false;
    }
  }

  async function syncOnce(): Promise<void> {
    const p = await owner();
    if (p === null) return;
    const s = await settings(p.id);
    if (s === null || !s.writeWorkouts || (await cap()) !== 'available') return;
    // An open workout has nothing to write yet; Finish's write wakes this again.
    if (await deps.workoutOpen().catch(() => true)) return;
    const { toCheck, goneSessionIds } = await repo().writeRows(p.id, s.writeSinceUtc);
    if (toCheck.length === 0 && goneSessionIds.length === 0) {
      notSaved = 0;
      return;
    }
    const records = await repo().writes(p.id);
    const recordOf = new Map(records.map((r) => [r.sessionId, r]));
    const candidates: HealthWriteCandidate[] = [];
    const revisionOf = new Map<string, number>();
    const linked = new Set((await repo().links(p.id)).filter((l) => l.status === 'linked').map((l) => l.sessionId));
    for (const row of toCheck) {
      const a: SessionAggregate | null = await deps
        .store()
        .repos.sessions.get(row.sessionId)
        .catch(() => null);
      if (a === null) continue;
      candidates.push(healthCandidateOf(a, linked.has(a.session.id)));
      revisionOf.set(row.sessionId, a.revision);
    }
    const checked = new Set([...candidates.map((c) => c.sessionId), ...goneSessionIds]);
    const ops = planHealthWrites({ settings: s, candidates, records: records.filter((r) => checked.has(r.sessionId)) });
    let failed = 0;
    for (const op of ops) {
      const ok = await doOp(op, recordOf.get(op.sessionId) ?? null, p.id, p.timezone, revisionOf.get(op.sessionId) ?? 0);
      if (!ok) failed += 1;
    }
    // Nothing to write for a changed workout (sets edited, times the same): note the revision so it isn't loaded again.
    const touched = new Set(ops.map((o) => o.sessionId));
    for (const c of candidates) {
      const r = recordOf.get(c.sessionId);
      const rev = revisionOf.get(c.sessionId);
      if (r !== undefined && rev !== undefined && !touched.has(c.sessionId)) await repo().markChecked(c.sessionId, rev).catch(() => undefined);
    }
    notSaved = failed;
  }

  /** Write, rewrite or delete what changed. One run at a time; a call during a run waits for it. */
  function syncWrites(): Promise<void> {
    if (syncing !== null) return syncing;
    syncing = syncOnce()
      .catch(() => undefined)
      .finally(() => {
        syncing = null;
      });
    return syncing;
  }

  // ------------------------------------------------------------------ reads

  async function readOnce(force: boolean): Promise<void> {
    const p = await owner();
    const port = deps.port;
    if (p === null || port === null) return;
    const s = await settings(p.id);
    if (s === null || !(s.readActivities || s.readWeight || s.readRestingHeartRate || s.readSleep) || (await cap()) !== 'available') return;
    if (await deps.workoutOpen().catch(() => false)) return;
    const nowMs = toMs(deps.now().utc);
    if (!force && nowMs - lastReadStartMs < READ_EVERY_MS) return;
    lastReadStartMs = nowMs;
    reading = true;
    const tz = p.timezone;
    let ok = true;
    let fresh = 0;
    try {
      if (s.readActivities) {
        const sinceMs = readSinceMs(s.readWindow, nowMs);
        const before = new Set((await repo().workoutSamples(p.id, toIso(sinceMs), toIso(nowMs + 86_400_000))).map((x) => x.uuid));
        const rows = await port.readWorkouts(sinceMs, nowMs + 60_000, s.readHeartRate);
        const samples = workoutSamplesFrom(rows, port.bundleId, tz);
        await repo().replaceSamples(p.id, 'workout', toIso(sinceMs), samples);
        fresh += samples.filter((x) => !before.has(x.uuid)).length;
        await autoLink(p, samples);
      }
      if (s.readRestingHeartRate) {
        const sinceMs = readSinceMs(s.readWindow, nowMs);
        await repo().replaceSamples(p.id, 'resting_hr', toIso(sinceMs), restingHrSamplesFrom(await port.readRestingHeartRate(sinceMs), port.bundleId, tz));
      }
      if (s.readSleep) {
        const sinceMs = readSinceMs(s.readWindow, nowMs);
        await repo().replaceSamples(p.id, 'sleep', toIso(sinceMs), sleepSamplesFrom(await port.readSleep(sinceMs), port.bundleId, tz));
      }
      if (s.readWeight) {
        const sinceMs = readSinceMs(s.readWindow, nowMs, WEIGHT_MIN_DAYS);
        const rows = await port.readBodyMass(sinceMs);
        const before = new Set((await repo().weightSamples(p.id)).map((x) => x.uuid));
        const samples = weightSamplesFrom(rows, port.bundleId, tz);
        await repo().replaceSamples(p.id, 'weight', toIso(sinceMs), samples);
        fresh += samples.filter((x) => !before.has(x.uuid)).length;
      }
    } catch {
      ok = false;
    } finally {
      reading = false;
    }
    newOnLastRead = ok ? fresh : newOnLastRead;
    const at = deps.now().utc;
    const cur = await settings(p.id);
    if (cur !== null) await repo().updateSettings(p.id, cur.version, (x) => (ok ? { ...x, lastReadUtc: at, lastReadFailedUtc: null } : { ...x, lastReadFailedUtc: at })).catch(() => null);
  }

  async function autoLink(p: UserProfile, samples: Parameters<typeof autoLinkPairs>[0]['samples']): Promise<void> {
    if (samples.length === 0) return;
    const nowMs = toMs(deps.now().utc);
    const first = samples.reduce((m, x) => Math.min(m, toMs(x.startUtc)), nowMs);
    const workouts = await repo().linkableWorkouts(p.id, toIso(first - 2 * 86_400_000), toIso(nowMs + 86_400_000));
    // Never the app's own copies (an older build's source passes the bundle check): one Garmin workout is then one.
    const own = await ownCopies(p.id, samples);
    // (Ben, 31 Oct) An older build's automatic link to the app's own copy holds the workout: release it first.
    const ownUuids = new Set([...own.written, ...samples.filter((x) => x.externalId !== null && own.sessions.has(x.externalId.toLowerCase())).map((x) => x.uuid)]);
    for (const l of ownCopyLinks(await repo().links(p.id), ownUuids)) {
      await repo()
        .changeLink(p.id, l.healthUuid, (cur) => (cur === null ? { kind: 'stale', current: null } : releaseOwnCopyLink(cur, { opId: `health-own-release:${l.healthUuid}:${String(l.version)}`, atUtc: deps.now().utc, expectedVersion: l.version })))
        .catch(() => null);
    }
    const links = await repo().links(p.id);
    // Every Health workout in the read window, so past days pair too (a back-fill; Ben, 31 Oct).
    for (const pair of autoLinkPairs({ samples: linkableSamples(samples, own.written, own.sessions), workouts, links })) {
      await repo()
        .changeLink(p.id, pair.healthUuid, async (cur, elsewhere) =>
          linkHealthActivity(cur, { ownerId: p.id, healthUuid: pair.healthUuid, sessionId: pair.sessionId, by: 'auto', opId: `health-autolink:${pair.healthUuid}`, atUtc: deps.now().utc, expectedVersion: null, sessionLinkedElsewhere: await elsewhere(pair.sessionId) }),
        )
        .catch(() => null);
    }
  }

  /** The app's own Health copies among `samples`: UUIDs it wrote, and external IDs that are its workouts. */
  async function ownCopies(ownerId: string, samples: readonly HealthWorkoutSample[]): Promise<{ written: Set<string>; sessions: Set<string> }> {
    const written = new Set((await repo().writes(ownerId).catch(() => [])).map((x) => x.healthUuid));
    const sessions = new Set<string>();
    for (const id of new Set(samples.map((x) => x.externalId?.toLowerCase()).filter((x): x is string => x !== undefined))) {
      const a = await deps
        .store()
        .repos.sessions.get(id)
        .catch(() => null);
      if (a !== null) sessions.add(id);
    }
    return { written, sessions };
  }

  function readNow(force = true): Promise<void> {
    return readOnce(force).catch(() => {
      reading = false;
    });
  }

  // ------------------------------------------------------------------ links

  function linkOutcome(r: HealthLinkWrite | null): HealthLinkOutcome {
    if (r === null) return { ok: false, message: 'Couldn’t save. Try again.' };
    switch (r.status) {
      case 'written':
      case 'replayed':
        return { ok: true, healthUuid: r.link.healthUuid, version: r.link.version };
      case 'stale':
        return { ok: false, message: 'Changed since. Try again.' };
      case 'invalid':
        return { ok: false, message: r.reason };
    }
  }

  /** A finished workout as linking sees it, with the Health workouts around it (never the app's own) and the links. */
  async function workoutContext(ownerId: string, sessionId: string): Promise<{ workout: LinkableWorkout; samples: HealthWorkoutSample[]; links: HealthLink[] } | null> {
    const a = await deps
      .store()
      .repos.sessions.get(sessionId)
      .catch(() => null);
    // A date-only workout (a FitNotes import) has no end: it links on its date (Ben, 29 Oct).
    if (a === null || (a.session.endedAt === null && a.session.localDate === undefined)) return null;
    const workout: LinkableWorkout = {
      sessionId,
      startUtc: a.session.startedAt.utc,
      endUtc: a.session.endedAt?.utc ?? a.session.startedAt.utc,
      tz: a.session.startedAt.tz,
      title: a.session.routineName ?? 'Workout',
      ...(a.session.pastLog === undefined ? {} : { pastLogged: true }),
      ...(a.session.localDate === undefined ? {} : { localDate: a.session.localDate }),
    };
    const ms = toMs(workout.startUtc);
    const all = await repo()
      .workoutSamples(ownerId, toIso(ms - 2 * 86_400_000), toIso(ms + 2 * 86_400_000))
      .catch(() => []);
    const writes = new Set((await repo().writes(ownerId).catch(() => [])).map((x) => x.healthUuid));
    const links = await repo()
      .links(ownerId)
      .catch(() => []);
    return { workout, samples: all.filter((x) => !writes.has(x.uuid) && x.externalId?.toLowerCase() !== sessionId), links };
  }

  function candidateView(x: HealthWorkoutSample, tz: string): LinkCandidateView {
    return { healthUuid: x.uuid, ...linkCandidateLine(x, classifyHealthWorkout(x.activityType).label, tz) };
  }

  async function linkableAround(ownerId: string, startUtc: string): Promise<LinkableWorkout[]> {
    const ms = toMs(startUtc);
    return repo().linkableWorkouts(ownerId, toIso(ms - 2 * 86_400_000), toIso(ms + 2 * 86_400_000));
  }

  return {
    /** Whether Apple Health can be used on this install (re-checked when Profile › Apple Health opens). */
    capability: (refresh = false) => cap(refresh),

    /** Profile › Apple Health and its Profile row. */
    async screen(refresh = false): Promise<HealthScreenView> {
      const c = await cap(refresh);
      const p = await owner();
      const s = p === null ? null : await settings(p.id);
      const base = { notSaved, reading, newOnLastRead, nowMs: toMs(deps.now().utc), tz: deps.now().tz };
      if (p === null || s === null || c !== 'available' || paused() !== null) {
        return healthScreenView({ ...base, capability: c === 'available' ? 'not_on_this_install' : c, paused: paused(), settings: s ?? DEFAULT_HEALTH_SETTINGS, shareStatus: null, readCounts: { workouts: 0, weights: 0 }, sources: [], written: 0 });
      }
      const nowMs = toMs(deps.now().utc);
      const [workouts, weights, writes, shareStatus] = await Promise.all([
        repo().workoutSamples(p.id, toIso(readSinceMs(s.readWindow, nowMs)), toIso(nowMs + 86_400_000)).catch(() => []),
        repo().weightSamples(p.id).catch(() => []),
        repo().writes(p.id).catch(() => []),
        s.writeWorkouts && deps.port !== null ? deps.port.workoutShareStatus().catch(() => null) : Promise.resolve(null),
      ]);
      const latest = new Map<string, string>();
      for (const x of [...workouts.map((w) => ({ name: w.sourceName, at: w.endUtc })), ...weights.map((w) => ({ name: w.sourceName, at: w.atUtc }))]) {
        const have = latest.get(x.name);
        if (have === undefined || have < x.at) latest.set(x.name, x.at);
      }
      return healthScreenView({
        ...base,
        capability: c,
        settings: s,
        shareStatus,
        readCounts: { workouts: workouts.length, weights: weights.length },
        sources: [...latest.entries()].map(([name, latestUtc]) => ({ name, latestUtc })),
        written: writes.filter((w) => w.status === 'written').length,
      });
    },

    /**
     * One switch. On: iOS asks for that type's permission (the sheet shows only the first time), then the switch
     * is saved and a read or write runs. Off: saved at once; a read's data is forgotten (read again when on).
     */
    async setSwitch(key: HealthSwitch, on: boolean): Promise<HealthSwitchOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, message: 'Couldn’t save. Try again.' };
      if (on) {
        if ((await cap(true)) !== 'available' || deps.port === null) return { ok: false, message: unavailableText() };
        const share: HealthType[] = key === 'writeWorkouts' ? ['workout'] : [];
        const read: HealthType[] = key === 'writeWorkouts' ? [] : [...READ_TYPES[key]];
        const asked = await deps.port.requestAuthorization(share, read).catch(() => ({ ok: false, message: '' }));
        if (!asked.ok && asked.message === 'missing_entitlement') {
          capability = Promise.resolve('not_on_this_install');
          return { ok: false, message: 'Not available on this install' };
        }
      }
      const cur = await settings(p.id);
      if (cur === null) return { ok: false, message: 'Couldn’t save. Try again.' };
      const at = deps.now().utc;
      const r = await repo()
        .updateSettings(p.id, cur.version, (x) => ({ ...x, [key]: on, ...(key === 'writeWorkouts' ? { writeSinceUtc: on ? at : null } : {}) }))
        .catch(() => null);
      if (r === null || !r.ok) return { ok: false, message: 'Changed since. Try again.' };
      if (!on && key === 'readActivities') await repo().clearSamples(p.id, 'workout').catch(() => undefined);
      if (!on && key === 'readWeight') await repo().clearSamples(p.id, 'weight').catch(() => undefined);
      if (!on && key === 'readRestingHeartRate') await repo().clearSamples(p.id, 'resting_hr').catch(() => undefined);
      if (!on && key === 'readSleep') await repo().clearSamples(p.id, 'sleep').catch(() => undefined);
      if (on && key === 'writeWorkouts') void syncWrites();
      if (on && key !== 'writeWorkouts') void readNow(true);
      return { ok: true };
    },

    /** (Q6) `How far back`: one control for every read (bodyweight at least 2 years). A new read follows. */
    async setReadWindow(window: HealthReadWindow): Promise<HealthSwitchOutcome> {
      const p = await owner();
      const cur = p === null ? null : await settings(p.id);
      if (p === null || cur === null) return { ok: false, message: 'Couldn’t save. Try again.' };
      const r = await repo()
        .updateSettings(p.id, cur.version, (x) => ({ ...x, readWindow: window }))
        .catch(() => null);
      if (r === null || !r.ok) return { ok: false, message: 'Changed since. Try again.' };
      void readNow(true);
      return { ok: true };
    },

    /** (Q8) Resting heart rate and sleep, a value a day for the last 30 days, each with its source; empty while off. */
    signals: () => readSignals(),

    /**
     * (Ben, 27 Oct) Progress › Training's Apple Health block: last night's sleep and this morning's resting heart rate
     * against its 28-day median (gym first: not on Today, pending Ben), then the trend lines. Local reads only.
     */
    async lastNight(window: { from: string; to: string } | null = null): Promise<{ line: TodayHealthLine | null; signals: HealthSignals }> {
      const p = await owner();
      const signals = await readSignals(window);
      if (p === null) return { line: null, signals };
      return { line: todayHealthLine(signals, localDateOf(toMs(deps.now().utc), p.timezone)), signals };
    },

    /**
     * (Redesign v3 §A2; Ben, 27 Oct) Today's small line under the header: the parts Ben chose (`Show on Today`), from
     * the same local reads as Progress. Null while Health is off (no read switch on) or there is nothing to show.
     */
    async todayLine(shows: TodayHealthShows): Promise<TodayHealthLine | null> {
      const p = await owner();
      const s = p === null ? null : await settings(p.id);
      if (p === null || s === null || !(s.readSleep || s.readRestingHeartRate || s.readWeight)) return null;
      const signals = await readSignals();
      let bw: { date: string; value: number; unit: 'kg' | 'lb'; source: string | null } | null = null;
      if (shows.bodyweight && s.readWeight) {
        const [profile, health] = await Promise.all([
          deps
            .store()
            .repos.trainingProfiles.get(p.id)
            .catch(() => null),
          repo()
            .weightSamples(p.id)
            .catch(() => []),
        ]);
        const last = latestBodyweight(bodyweightEntries(profile?.weights ?? [], health));
        if (last !== null) bw = { date: last.date, value: convertMass({ value: last.value, unit: last.unit }, p.preferredUnit).value, unit: p.preferredUnit, source: last.sourceName };
      }
      return todayHealthLineFor(signals, localDateOf(toMs(deps.now().utc), p.timezone), shows, bw);
    },

    readNow: () => readNow(true),
    syncWrites,

    /** App open and return to the foreground: a read when due, and any writes left over (a failed or killed one). */
    async onAppActive(): Promise<void> {
      await syncWrites();
      await readNow(false);
    },

    /** `Remove GymSmarter workouts from Health`: only this app's samples; each record becomes `removed` (never written again). */
    async removeAllOwn(): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
      const p = await owner();
      if (p === null || deps.port === null) return { ok: false, message: unavailableText() };
      try {
        const count = await deps.port.deleteAllOwnWorkouts();
        const opId = `health-remove-all:${deps.newId()}`;
        for (const w of await repo().writes(p.id)) {
          const next = healthWriteRemoved(w, opId, deps.now().utc);
          if (next !== null) await repo().saveWrite(next, w.version, 0);
        }
        return { ok: true, count };
      } catch {
        return { ok: false, message: 'Couldn’t remove. Try again.' };
      }
    },

    /** The Summary's (and a past workout's) `Linked activity` row, or the question, or nothing. */
    async forWorkout(sessionId: string): Promise<WorkoutHealthView> {
      const p = await owner();
      if (p === null || (await cap()) !== 'available') return { kind: 'none' };
      const s = await settings(p.id);
      if (s === null || !s.readActivities) return { kind: 'none' };
      const link = await repo()
        .linkForWorkout(p.id, sessionId)
        .catch(() => null);
      if (link !== null) {
        const sample = await repo()
          .workoutSample(p.id, link.healthUuid)
          .catch(() => null);
        if (sample === null) return { kind: 'none' };
        const a = await deps
          .store()
          .repos.sessions.get(sessionId)
          .catch(() => null);
        const differ = a !== null && a.session.endedAt !== null && a.session.localDate === undefined && (Math.abs(toMs(a.session.startedAt.utc) - toMs(sample.startUtc)) > WATCH_TIMES_DIFFER_MS || Math.abs(toMs(a.session.endedAt.utc) - toMs(sample.endUtc)) > WATCH_TIMES_DIFFER_MS);
        return { ...linkedActivityView(healthProvenanceOf(sample), link.version, s.readHeartRate, p.timezone), useWatchTimes: differ && deps.dispatch !== undefined };
      }
      const ctx = await workoutContext(p.id, sessionId);
      if (ctx === null) return { kind: 'none' };
      // (Ben, 27 Oct, TrainingPeaks-style) Every unlinked Health strength or `other` workout that day: one tap links.
      const qs = sameDayLinkCandidates(ctx.workout, ctx.samples, ctx.links);
      if (qs.length === 0) return { kind: 'none' };
      return { kind: 'question', candidates: qs.map((x) => candidateView(x, p.timezone)) };
    },

    /**
     * (Ben, 27 Oct) `Use watch times`: the workout's start and end become the linked watch workout's, through the
     * existing versioned time-shift (sets move with the start), on the version the row showed. Never silent: Ben's tap,
     * and the returned `undo` puts the times back. Refused (with a message) when the move isn't allowed.
     */
    async useWatchTimes(sessionId: string, opId: string): Promise<{ ok: true; undo: () => Promise<{ ok: boolean; message?: string }> } | { ok: false; message: string }> {
      const p = await owner();
      const dispatch = deps.dispatch;
      if (p === null || dispatch === undefined) return { ok: false, message: 'Couldn’t change the times.' };
      const link = await repo()
        .linkForWorkout(p.id, sessionId)
        .catch(() => null);
      const sample = link === null ? null : await repo().workoutSample(p.id, link.healthUuid).catch(() => null);
      const a = await deps
        .store()
        .repos.sessions.get(sessionId)
        .catch(() => null);
      if (sample === null || a === null) return { ok: false, message: 'Couldn’t change the times.' };
      const tz = a.session.startedAt.tz;
      const r = await dispatch(sessionId, { type: 'update_session_timing', at: deps.now(), opId, expectedVersion: a.session.version, startedAt: { utc: sample.startUtc, tz }, endedAt: { utc: sample.endUtc, tz }, shift: true });
      if (!r.ok) return { ok: false, message: r.error.message };
      const after = r.aggregate;
      return {
        ok: true,
        undo: async () => {
          const cmd = timingUndoCommand(after, opId, deps.newId(), deps.now());
          if (cmd === null) return { ok: false, message: 'Nothing to undo.' };
          const u = await dispatch(sessionId, cmd);
          return u.ok ? { ok: true } : { ok: false, message: u.error.message };
        },
      };
    },

    /** Summary `⋯ › Link activity from Health`: Health strength or `other` workouts from the day before to the day after. */
    async linkChoices(sessionId: string): Promise<LinkCandidateView[]> {
      const p = await owner();
      if (p === null || (await cap()) !== 'available') return [];
      const s = await settings(p.id);
      if (s === null || !s.readActivities) return [];
      const ctx = await workoutContext(p.id, sessionId);
      return ctx === null ? [] : linkChoicesFor(ctx.workout, ctx.samples, ctx.links).map((x) => candidateView(x, p.timezone));
    },

    /** (Ben, 27 Oct, Q4) The linked watch workout as the coach sees it: HR only while its switch is on. Null: none. */
    async coachLinked(sessionId: string): Promise<LinkedActivityContext | null> {
      const p = await owner();
      if (p === null) return null;
      const s = await settings(p.id);
      if (s === null || !s.readActivities) return null;
      const link = await repo()
        .linkForWorkout(p.id, sessionId)
        .catch(() => null);
      const sample = link === null ? null : await repo().workoutSample(p.id, link.healthUuid).catch(() => null);
      if (sample === null) return null;
      const prov = healthProvenanceOf(sample);
      return {
        source: prov.sourceName,
        type: prov.label,
        minutes: Math.round((toMs(prov.endUtc) - toMs(prov.startUtc)) / 60_000),
        avgHeartRate: s.readHeartRate ? prov.avgHeartRate : null,
        maxHeartRate: s.readHeartRate ? prov.maxHeartRate : null,
        activeKcal: prov.activeKcal ?? null,
        use: "recorded by Ben's watch, via Apple Health; mention when he asks; never diagnose; never change loads from it alone",
      };
    },

    /** The Health activity sheet: its facts and source, a one-tap suggestion and the `Link to a workout` list. */
    async activity(healthUuid: string): Promise<{ activity: Activity; suggestion: LinkableWorkout | null; nearby: LinkableWorkout[]; showHeartRate: boolean } | null> {
      const p = await owner();
      if (p === null) return null;
      const sample = await repo()
        .workoutSample(p.id, healthUuid)
        .catch(() => null);
      if (sample === null) return null;
      const activity = healthActivityOf(sample, p.id);
      if (activity === null) return null;
      const links = await repo()
        .links(p.id)
        .catch(() => []);
      const workouts = await linkableAround(p.id, sample.startUtc).catch(() => []);
      const s = await settings(p.id);
      const nearby = nearbyWorkouts(sample, workouts, links);
      const sameDay = nearby.filter((w) => localDateOf(toMs(w.startUtc), w.tz) === localDateOf(toMs(sample.startUtc), w.tz));
      // One tap (Ben, 27 Oct): the near match, else the day's only workout.
      const suggestion = linkSuggestion(sample, workouts, links) ?? (sameDay.length === 1 ? (sameDay[0] ?? null) : null);
      return { activity, suggestion, nearby, showHeartRate: s?.readHeartRate === true };
    },

    /**
     * (Ben, 29 Oct: "Why no option to pair workouts together") The day sheet's pairs on `date` (a local date): each
     * Health strength workout not linked with the day's app workouts it can pair with, and each paired workout's
     * Health facts. Same day only, never across days. Local reads only.
     */
    async dayPairs(date: string): Promise<DayPairsView> {
      const p = await owner();
      if (p === null || paused() !== null || (await cap()) !== 'available') return NO_DAY_PAIRS;
      const s = await settings(p.id);
      if (s === null || !s.readActivities) return NO_DAY_PAIRS;
      const from = toIso(localMidnightUtcMs(date, p.timezone) - 86_400_000);
      const to = toIso(localMidnightUtcMs(date, p.timezone) + 2 * 86_400_000);
      try {
        const all = await repo().workoutSamples(p.id, from, to);
        const own = await ownCopies(p.id, all);
        const samples = linkableSamples(all, own.written, own.sessions);
        const workouts = await repo().linkableWorkouts(p.id, from, to);
        const links = await repo().links(p.id);
        const d = dayPairs({ date, samples, workouts, links });
        const time = (w: LinkableWorkout) => (w.localDate !== undefined ? null : formatTime(toMs(w.startUtc), p.timezone));
        return {
          unpaired: Object.fromEntries(d.unpaired.map((u) => [u.sample.uuid, u.choices.map((w) => ({ sessionId: w.sessionId, time: time(w) }))])),
          paired: Object.fromEntries(
            d.paired.map((x) => {
              const prov = healthProvenanceOf(x.sample);
              return [x.workout.sessionId, { healthUuid: x.sample.uuid, linkVersion: x.link.version, facts: pairedFacts(prov, s.readHeartRate), source: prov.sourceName }];
            }),
          ),
        };
      } catch {
        return NO_DAY_PAIRS;
      }
    },

    /** Ben's `Link`: on the version he saw (null: no record yet). */
    async link(req: { healthUuid: string; sessionId: string; opId: string }): Promise<HealthLinkOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, message: 'Couldn’t save. Try again.' };
      const r = await repo()
        .changeLink(p.id, req.healthUuid, async (cur, elsewhere) =>
          linkHealthActivity(cur, { ownerId: p.id, healthUuid: req.healthUuid, sessionId: req.sessionId, by: 'ben', opId: req.opId, atUtc: deps.now().utc, expectedVersion: cur?.version ?? null, sessionLinkedElsewhere: await elsewhere(req.sessionId) }),
        )
        .catch(() => null);
      return linkOutcome(r);
    },

    /** `Unlink`, on the version the row showed; its Undo is `link` again. */
    async unlink(req: { healthUuid: string; expectedVersion: number; opId: string }): Promise<HealthLinkOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, message: 'Couldn’t save. Try again.' };
      const r = await repo()
        .changeLink(p.id, req.healthUuid, (cur) => (cur === null ? { kind: 'stale', current: null } : unlinkHealthActivity(cur, { opId: req.opId, atUtc: deps.now().utc, expectedVersion: req.expectedVersion })))
        .catch(() => null);
      return linkOutcome(r);
    },

    /** `Not it`: never asked or auto-linked again. */
    async notIt(req: { healthUuid: string; sessionId: string; opId: string }): Promise<HealthLinkOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, message: 'Couldn’t save. Try again.' };
      const r = await repo()
        .changeLink(p.id, req.healthUuid, (cur) => dismissHealthLink(cur, { ownerId: p.id, healthUuid: req.healthUuid, sessionId: req.sessionId, opId: req.opId, atUtc: deps.now().utc }))
        .catch(() => null);
      return linkOutcome(r);
    },

    /**
     * After any write to the store (Finish, an edit, a move, a delete, a restore), the Health writes catch up:
     * checked every few seconds against the store's write count, so nothing in the logging loop waits on it.
     * Returns the stop function.
     */
    watchWrites(everyMs = 3000): () => void {
      let seen: { store: Store; writes: number } | null = null;
      const timer = setInterval(() => {
        const store = deps.store();
        const writes = store.db.writeCount;
        if (seen !== null && seen.store === store && seen.writes === writes) return;
        seen = { store, writes };
        void syncWrites();
      }, everyMs);
      return () => {
        clearInterval(timer);
      };
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;

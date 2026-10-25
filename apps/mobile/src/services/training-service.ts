import {
  buildDayFor,
  liftHistoryFrom,
  mainLiftFor,
  mainLiftOptions,
  newTrainingProfile,
  splitInUse,
  toIso,
  toMs,
  type LiftHistory,
  type MainLift,
  type HistoryWorkout,
} from '@fizz/domain';
import { trainingProfileId, type Store } from '@fizz/persistence';
import type { Exercise, TrainingChange, TrainingProfile, UserProfile, ZonedTimestamp } from '@fizz/schemas';
import type { TrainingInput } from '@fizz/coach';

import { buildDayChips, type BuildDayChip } from '../coach/build-view';
import { localDateKey } from '../format/dates';

/**
 * Training details and split (Ben 13 Oct: D5, D7, D8; F19). Your data, local
 * only. Screens and the coach read the same values from here; nothing is
 * computed in a screen. Reads never write: before the first change the
 * defaults are shown as version 1 and the first change writes them.
 */

/** How far back main-lift recommendations look. */
export const MAIN_LIFT_WINDOW_DAYS = 180;

export interface TrainingServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  catalogueExercises?: () => readonly Exercise[];
}

export type TrainingWriteOutcome = { ok: true; profile: TrainingProfile } | { ok: false; reason: 'stale' | 'invalid' | 'no_profile' | 'failed'; profile: TrainingProfile | null };

export interface TrainingSnapshot {
  owner: UserProfile;
  profile: TrainingProfile;
  /** Each split day's main lift (Ben's, else recommended), by day ID. */
  mainLifts: Record<string, MainLift>;
  /** Compound lifts Ben can choose per day, by day ID. */
  options: Record<string, { id: string; name: string }[]>;
  nextDayId: string;
  nowYear: number;
}

export function createTrainingService(deps: TrainingServiceDeps) {
  const repo = () => deps.store().repos.trainingProfiles;
  const yearOf = (at: ZonedTimestamp): number => Number(localDateKey(toMs(at.utc), at.tz).slice(0, 4));

  /** Throws when the row can't be read (review S4): the screen shows its error state, the coach "not available". */
  async function stored(owner: UserProfile): Promise<TrainingProfile> {
    return (await repo().get(owner.id)) ?? newTrainingProfile({ id: trainingProfileId(owner.id), ownerId: owner.id, atUtc: owner.createdAtUtc });
  }

  async function pool(): Promise<Map<string, Exercise>> {
    const out = new Map<string, Exercise>();
    for (const e of await deps.store().repos.exercises.list().catch(() => [] as Exercise[])) out.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!out.has(e.id)) out.set(e.id, e);
    return out;
  }

  async function recent(owner: UserProfile): Promise<HistoryWorkout[]> {
    const now = deps.now();
    const from = toIso(toMs(now.utc) - MAIN_LIFT_WINDOW_DAYS * 86_400_000);
    const r = await deps.store().repos.sessions.listFinishedBetweenReadable(owner.id, from, toIso(toMs(now.utc) + 1)).catch(() => ({ sessions: [] as HistoryWorkout[], unreadable: 0 }));
    return r.sessions;
  }

  async function snapshot(): Promise<TrainingSnapshot | null> {
    const owner = await deps.profile();
    if (owner === null) return null;
    const profile = await stored(owner);
    const exercises = await pool();
    const exerciseOf = (id: string) => exercises.get(id) ?? null;
    const sessions = await recent(owner);
    const history: LiftHistory[] = liftHistoryFrom(sessions, exerciseOf);
    const split = splitInUse(profile);
    const mainLifts: Record<string, MainLift> = {};
    const options: Record<string, { id: string; name: string }[]> = {};
    const all = [...exercises.values()].filter((e) => e.ownerId === null || e.ownerId === owner.id);
    for (const d of split.days) {
      mainLifts[d.id] = mainLiftFor(d, history, (id) => exercises.get(id)?.name ?? null);
      options[d.id] = mainLiftOptions(d, all).map((e) => ({ id: e.id, name: e.name }));
    }
    return { owner, profile, mainLifts, options, nextDayId: buildDayFor(split, sessions, exerciseOf, deps.now().utc).id, nowYear: yearOf(deps.now()) };
  }

  /** Each split day's main lift, without the rest of the snapshot (review S3). */
  async function splitMains(): Promise<Set<string>> {
    const owner = await deps.profile();
    if (owner === null) return new Set();
    const split = splitInUse(await stored(owner));
    const exercises = await pool();
    const nameOf = (id: string) => exercises.get(id)?.name ?? null;
    let history: LiftHistory[] | null = null;
    const out = new Set<string>();
    for (const d of split.days) {
      const yours = d.mainLiftExerciseId !== undefined && nameOf(d.mainLiftExerciseId) !== null;
      if (!yours && history === null) history = liftHistoryFrom(await recent(owner), (id) => exercises.get(id) ?? null);
      const m = mainLiftFor(d, history ?? [], nameOf);
      if (m !== null) out.add(m.exerciseId);
    }
    return out;
  }

  return {
    snapshot,

    /**
     * Each split day's main lift (Ben's, or the recommended one). The light
     * path (review S3): no options or build day, and the 180-day history is
     * read only when a day has no lift of Ben's. Empty when nothing can be read.
     */
    async splitMainLiftIds(): Promise<Set<string>> {
      return splitMains().catch(() => new Set<string>());
    },

    /**
     * Every main lift (Ben, 20 Oct: `Targets hit` on the split day's main lift
     * only): each split day's main lift. Empty when nothing can be read.
     */
    async mainLiftIds(): Promise<Set<string>> {
      return splitMains().catch(() => new Set<string>());
    },

    /**
     * One change on the version the screen showed (rule 5). `opId` is the
     * tap's ID: a double tap writes once. A stale version is refused; the
     * screen reloads.
     */
    async change(change: TrainingChange, expectedVersion: number, opId: string): Promise<TrainingWriteOutcome> {
      const owner = await deps.profile();
      if (owner === null) return { ok: false, reason: 'no_profile', profile: null };
      const at = deps.now();
      try {
        const r = await repo().change(owner.id, change, { opId, expectedVersion, atUtc: at.utc, nowYear: yearOf(at), today: localDateKey(toMs(at.utc), at.tz) });
        return r.status === 'written' || r.status === 'replayed' ? { ok: true, profile: r.profile } : { ok: false, reason: r.status, profile: r.profile };
      } catch {
        return { ok: false, reason: 'failed', profile: null };
      }
    },

    /**
     * (workout-builder v2.1 §2.1, §6.2) A tapped `main_lift` answer on the
     * coach's question: saved for that split day only when Ben hasn't chosen
     * one (a field that is set is never overwritten), on the version read
     * now, idempotent on `opId`. Null: nothing saved (already set, stale,
     * or the exercise isn't known). The saved version is what Undo needs.
     */
    async saveMainLiftAnswer(req: { dayId: string; catalogueId: string; opId: string }): Promise<{ savedVersion: number; exerciseId: string } | null> {
      const s = await snapshot().catch(() => null);
      if (s === null || s.mainLifts[req.dayId]?.source === 'yours') return null;
      const exercises = await pool();
      const all = [...exercises.values()];
      const e = all.find((x) => x.ownerId === s.owner.id && x.catalogueKey === req.catalogueId) ?? all.find((x) => x.catalogueKey === req.catalogueId || x.id === req.catalogueId) ?? null;
      if (e === null) return null;
      const at = deps.now();
      try {
        const r = await repo().change(s.owner.id, { kind: 'main_lift', dayId: req.dayId, exerciseId: e.id }, { opId: req.opId, expectedVersion: s.profile.version, atUtc: at.utc, nowYear: yearOf(at), today: localDateKey(toMs(at.utc), at.tz) });
        return r.status === 'written' || r.status === 'replayed' ? { savedVersion: r.profile.version, exerciseId: e.id } : null;
      } catch {
        return null;
      }
    },

    /** The profile's applied op IDs and version (a question card's `Saved to Profile` state, §6.2). Null: no profile or unreadable. */
    async appliedOps(): Promise<{ recentOps: string[]; version: number } | null> {
      const owner = await deps.profile().catch(() => null);
      if (owner === null) return null;
      const p = await repo().get(owner.id).catch(() => null);
      return p === null ? null : { recentOps: [...p.recentOps], version: p.version };
    },

    /** `Undo` on `Saved to Profile` (§6.2): only while the profile is still at the version this answer saved. */
    async undoMainLiftAnswer(req: { dayId: string; savedVersion: number; opId: string }): Promise<'undone' | 'changed'> {
      const owner = await deps.profile();
      if (owner === null) return 'changed';
      const at = deps.now();
      try {
        const r = await repo().change(owner.id, { kind: 'main_lift', dayId: req.dayId, exerciseId: null }, { opId: req.opId, expectedVersion: req.savedVersion, atUtc: at.utc, nowYear: yearOf(at), today: localDateKey(toMs(at.utc), at.tz) });
        return r.status === 'written' || r.status === 'replayed' ? 'undone' : 'changed';
      } catch {
        return 'changed';
      }
    },

    /** The coach's planning context (Your data). Null with no profile; throws when the row can't be read. */
    async coachInput(): Promise<TrainingInput | null> {
      const s = await snapshot();
      if (s === null) return null;
      const saved = await repo().get(s.owner.id);
      return { profile: saved, nowYear: s.nowYear, mainLifts: s.mainLifts, nextDayId: s.nextDayId };
    },

    /** F19: the Build card's chips (the split's days), the next day selected, and the session length. */
    async buildCard(): Promise<{ days: BuildDayChip[]; nextDayId: string | null; sessionMinutes: number; mainLifts: Record<string, MainLift> }> {
      // Building a workout never waits on this row: an unreadable one gives the default split.
      const s = await snapshot().catch(() => null);
      const split = splitInUse(s?.profile ?? null);
      return { days: buildDayChips(split), nextDayId: s?.nextDayId ?? split.days[0]?.id ?? null, sessionMinutes: s?.profile.sessionMinutes ?? 45, mainLifts: s?.mainLifts ?? {} };
    },
  };
}

export type TrainingService = ReturnType<typeof createTrainingService>;

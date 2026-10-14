import {
  lastWorkoutGroups,
  liftHistoryFrom,
  mainLiftFor,
  mainLiftOptions,
  newTrainingProfile,
  nextSplitDay,
  splitInUse,
  toMs,
  type LiftHistory,
  type MainLift,
} from '@fizz/domain';
import { trainingProfileId, type Store } from '@fizz/persistence';
import type { Exercise, SessionAggregate, TrainingChange, TrainingProfile, UserProfile, ZonedTimestamp } from '@fizz/schemas';
import type { TrainingInput } from '@fizz/coach';

import { buildDayChips, type BuildDayChip } from '../coach/build-view';

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
  const yearOf = (at: ZonedTimestamp): number => Number(new Intl.DateTimeFormat('en-GB', { timeZone: at.tz, year: 'numeric' }).format(new Date(toMs(at.utc))));

  async function stored(owner: UserProfile): Promise<TrainingProfile> {
    return (await repo().get(owner.id).catch(() => null)) ?? newTrainingProfile({ id: trainingProfileId(owner.id), ownerId: owner.id, atUtc: owner.createdAtUtc });
  }

  async function pool(): Promise<Map<string, Exercise>> {
    const out = new Map<string, Exercise>();
    for (const e of await deps.store().repos.exercises.list().catch(() => [] as Exercise[])) out.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!out.has(e.id)) out.set(e.id, e);
    return out;
  }

  async function recent(owner: UserProfile): Promise<SessionAggregate[]> {
    const now = deps.now();
    const from = new Date(toMs(now.utc) - MAIN_LIFT_WINDOW_DAYS * 86_400_000).toISOString();
    const r = await deps.store().repos.sessions.listFinishedBetweenReadable(owner.id, from, new Date(toMs(now.utc) + 1).toISOString()).catch(() => ({ sessions: [] as SessionAggregate[], unreadable: 0 }));
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
    return { owner, profile, mainLifts, options, nextDayId: nextSplitDay(split, lastWorkoutGroups(sessions, exerciseOf)).id, nowYear: yearOf(deps.now()) };
  }

  return {
    snapshot,

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
        const r = await repo().change(owner.id, change, { opId, expectedVersion, atUtc: at.utc, nowYear: yearOf(at) });
        return r.status === 'written' || r.status === 'replayed' ? { ok: true, profile: r.profile } : { ok: false, reason: r.status, profile: r.profile };
      } catch {
        return { ok: false, reason: 'failed', profile: null };
      }
    },

    /** The coach's planning context (Your data). Null with no profile. */
    async coachInput(): Promise<TrainingInput | null> {
      const s = await snapshot();
      if (s === null) return null;
      const owner = s.owner;
      const saved = await repo().get(owner.id).catch(() => null);
      return { profile: saved, nowYear: s.nowYear, mainLifts: s.mainLifts, nextDayId: s.nextDayId };
    },

    /** F19: the Build card's chips (the split's days), the next day selected, and the session length. */
    async buildCard(): Promise<{ days: BuildDayChip[]; nextDayId: string | null; sessionMinutes: number; mainLifts: Record<string, MainLift> }> {
      const s = await snapshot();
      const split = splitInUse(s?.profile ?? null);
      return { days: buildDayChips(split), nextDayId: s?.nextDayId ?? split.days[0]?.id ?? null, sessionMinutes: s?.profile.sessionMinutes ?? 45, mainLifts: s?.mainLifts ?? {} };
    },
  };
}

export type TrainingService = ReturnType<typeof createTrainingService>;

import { anyGymHasLocation, gymLocationAction, gymLocationFromFix, matchGymByLocation, type LocationFix } from '@fizz/domain';
import type { SqliteRepositories } from '@fizz/persistence';
import type { Gym, GymLocation, UserProfile, ZonedTimestamp } from '@fizz/schemas';

/**
 * (Ben, 7 Nov; ADR 0041) Gym from GPS. A gym can keep one location (Profile ›
 * Gyms › a gym › `Use current location`); when Today opens, or a workout is
 * on screen, one quick when-in-use fix says which saved gym Ben is at. Before
 * Start it switches Today's gym (with Undo); during a workout it only offers.
 *
 * Never asks for permission except from `Use current location`; never
 * background location or region monitoring. Coordinates stay on the gym
 * record (Your data) and are never sent anywhere. With no native module,
 * no permission or no fix, nothing happens and nothing is said.
 */

export type LocationPermission = 'granted' | 'denied' | 'undetermined';

/** The phone's location, behind a port (expo-location on the phone, a fake in tests). */
export interface LocationPort {
  /** The native module is in this build. False: the GPS rows are hidden. */
  available(): boolean;
  /** Current when-in-use permission, without asking. */
  permission(): Promise<LocationPermission>;
  /** Ask for when-in-use permission (only from `Use current location`). */
  request(): Promise<LocationPermission>;
  /** One fix, or null when none came within `timeoutMs`. `precise` for saving a gym; low power for matching. */
  fix(opts: { precise: boolean; timeoutMs: number }): Promise<LocationFix | null>;
}

/** Waits for a match fix: short, so Today never feels slow (it doesn't block anything either way). */
export const MATCH_FIX_TIMEOUT_MS = 4000;
/** Waits for the fix `Use current location` saves. */
export const SAVE_FIX_TIMEOUT_MS = 10000;

export type GymLocationSave =
  | { ok: true; gym: Gym }
  | { ok: false; reason: 'unavailable' | 'denied' | 'no_fix' | 'not_found' | 'stale' | 'failed'; message: string };

export type TodayGymCheck = { kind: 'none' } | { kind: 'switched'; gymId: string; gymName: string; previousGymId: string | null };

export interface GymLocationDeps {
  repos: () => SqliteRepositories;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  port: LocationPort | null;
  /** Today's gym (the selected/default one). */
  currentGym: () => Promise<Gym | null>;
  /** Selects Today's gym (`gyms.select`: versioned, one transaction). */
  selectGym: (gymId: string) => Promise<{ ok: true; previousGymId: string | null; changed: boolean } | { ok: false; message: string }>;
  /** The workout in progress, if any (Today switches only before Start). */
  activeSession: () => Promise<{ id: string; gymId: string | null } | null>;
}

const MESSAGES = {
  unavailable: 'Location isn’t available on this install.',
  denied: 'Location is off for GymSmarter. Turn it on in Settings.',
  no_fix: 'Couldn’t get your location. Try again.',
  not_found: 'That gym wasn’t found.',
  stale: 'The gym changed. Try again.',
  failed: 'Couldn’t save. Try again.',
} as const;

export function createGymLocationService(deps: GymLocationDeps) {
  /** Gyms Ben switched back from with Undo: not switched to again automatically until the app restarts. */
  const declined = new Set<string>();

  const usable = (): LocationPort | null => {
    const p = deps.port;
    try {
      return p !== null && p.available() ? p : null;
    } catch {
      return null;
    }
  };

  async function liveGyms(): Promise<Gym[]> {
    const p = await deps.profile();
    if (!p) return [];
    return (await deps.repos().gyms.listByOwner(p.id)).filter((g) => g.archivedAtUtc === undefined);
  }

  async function ownGym(gymId: string): Promise<Gym | null> {
    const p = await deps.profile();
    const g = await deps.repos().gyms.get(gymId);
    return p && g && g.ownerId === p.id ? g : null;
  }

  async function writeLocation(gym: Gym, location: GymLocation | null): Promise<GymLocationSave> {
    const next: Gym = { ...gym, version: gym.version + 1, updatedAtUtc: deps.now().utc };
    if (location === null) delete next.location;
    else next.location = location;
    try {
      const r = await deps.repos().gyms.save(next, gym.version);
      return r.ok ? { ok: true, gym: next } : { ok: false, reason: 'stale', message: MESSAGES.stale };
    } catch {
      return { ok: false, reason: 'failed', message: MESSAGES.failed };
    }
  }

  /** One match fix, only with permission already granted (never asks); null on any failure. */
  async function quietFix(): Promise<LocationFix | null> {
    const port = usable();
    if (port === null) return null;
    try {
      if ((await port.permission()) !== 'granted') return null;
      return await port.fix({ precise: false, timeoutMs: MATCH_FIX_TIMEOUT_MS });
    } catch {
      return null;
    }
  }

  return {
    /** Whether to show the GPS rows at all (the module is in this build). */
    available(): boolean {
      return usable() !== null;
    },

    /**
     * `Use current location` on a gym: asks for when-in-use permission the first time, takes one precise fix
     * and saves it on the gym (versioned). A double tap saves the latest fix again as a new version; nothing else.
     */
    async setFromCurrentLocation(gymId: string): Promise<GymLocationSave> {
      const port = usable();
      if (port === null) return { ok: false, reason: 'unavailable', message: MESSAGES.unavailable };
      const gym = await ownGym(gymId);
      if (gym === null) return { ok: false, reason: 'not_found', message: MESSAGES.not_found };
      let fix: LocationFix | null;
      try {
        let perm = await port.permission();
        if (perm === 'undetermined') perm = await port.request();
        if (perm !== 'granted') return { ok: false, reason: 'denied', message: MESSAGES.denied };
        fix = await port.fix({ precise: true, timeoutMs: SAVE_FIX_TIMEOUT_MS });
      } catch {
        fix = null;
      }
      const location = gymLocationFromFix(fix, deps.now().utc);
      if (location === null) return { ok: false, reason: 'no_fix', message: MESSAGES.no_fix };
      return writeLocation(gym, location);
    },

    /** `Clear`: the gym forgets its location (a new version). Clearing one that has none writes nothing. */
    async clear(gymId: string): Promise<GymLocationSave> {
      const gym = await ownGym(gymId);
      if (gym === null) return { ok: false, reason: 'not_found', message: MESSAGES.not_found };
      if (gym.location === undefined) return { ok: true, gym };
      return writeLocation(gym, null);
    },

    /**
     * Today opened: when a saved gym with a location is within 200 m and isn't Today's gym, it becomes Today's
     * gym (before Start only). Anything else (no location saved, no permission, no fix, a workout running): none.
     */
    async checkToday(): Promise<TodayGymCheck> {
      if (usable() === null) return { kind: 'none' };
      const gyms = await liveGyms();
      if (!anyGymHasLocation(gyms)) return { kind: 'none' };
      if ((await deps.activeSession().catch(() => null)) !== null) return { kind: 'none' };
      const fix = await quietFix();
      const current = await deps.currentGym().catch(() => null);
      const action = gymLocationAction(matchGymByLocation(fix, gyms), { currentGymId: current?.id ?? null, workoutActive: false });
      if (action.kind !== 'switch_today' || declined.has(action.gymId)) return { kind: 'none' };
      // A workout may have started while the fix was taken: then nothing changes behind it.
      if ((await deps.activeSession().catch(() => null)) !== null) return { kind: 'none' };
      const r = await deps.selectGym(action.gymId).catch(() => null);
      if (r === null || !r.ok || !r.changed) return { kind: 'none' };
      return { kind: 'switched', gymId: action.gymId, gymName: action.gymName, previousGymId: r.previousGymId };
    },

    /** The toast's Undo: Today's gym goes back, and this gym isn't picked automatically again until a restart. */
    async undoToday(check: Extract<TodayGymCheck, { kind: 'switched' }>): Promise<boolean> {
      declined.add(check.gymId);
      if (check.previousGymId === null) return true;
      const r = await deps.selectGym(check.previousGymId).catch(() => null);
      return r !== null && r.ok;
    },

    /**
     * A workout is on screen: the saved gym Ben is at, when it isn't the workout's gym, to offer
     * (`You're at Battersea · Switch`). Never switches anything itself.
     */
    async checkWorkout(sessionId: string): Promise<{ gymId: string; gymName: string } | null> {
      if (usable() === null) return null;
      const gyms = await liveGyms();
      if (!anyGymHasLocation(gyms)) return null;
      const fix = await quietFix();
      const session = await deps.activeSession().catch(() => null);
      if (session === null || session.id !== sessionId) return null;
      const action = gymLocationAction(matchGymByLocation(fix, gyms), { currentGymId: session.gymId, workoutActive: true });
      return action.kind === 'offer_in_workout' ? { gymId: action.gymId, gymName: action.gymName } : null;
    },
  };
}

export type GymLocationService = ReturnType<typeof createGymLocationService>;

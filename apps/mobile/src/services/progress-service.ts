import {
  buildCalendarMonthView,
  buildProgressHomeView,
  DEFAULT_PROGRESS_WINDOW,
  localDateOf,
  monthOf,
  resumeBar,
  STALE_SESSION_MS,
  toMs,
  toProgressSession,
  type CalendarMonthView,
  type CommandOutcome,
  type MuscleInfo,
  type ProgressHomeView,
  type ProgressSession,
  type ResumeBar,
} from '@fizz/domain';
import { timeSlicer, type Slicer, type Store } from '@fizz/persistence';
import type { Exercise, ProgressGrouping, ProgressWindowDays, SessionCommand, UserProfile, ZonedTimestamp } from '@fizz/schemas';

/**
 * Progress (progress.md v1.0, slice A). Local reads only: nothing here waits
 * on a network or the coach (rule 1), and screens get finished view models
 * (the UI computes nothing).
 *
 * Finished workouts are projected once per stored revision and kept in
 * memory; each call lists `(id, revision)` with one cheap query and re-reads
 * only what changed, so a correction, `Count it`, an import or a restore is
 * reflected the next time Progress is shown, and switching windows reads
 * almost nothing (§3.1 `Set or time corrected elsewhere`, check 22, 25).
 */

export interface ProgressServiceDeps {
  store: () => Store;
  now: () => ZonedTimestamp;
  profile: () => Promise<UserProfile | null>;
  /**
   * Saves `profile.progress` (versioned profile write). `merge` runs on the
   * profile as read inside the write (and again on a retry), so concurrent
   * changes to window and grouping both land; it returns null for no change.
   */
  saveSettings: (merge: (current: UserProfile['progress']) => NonNullable<UserProfile['progress']> | null) => Promise<{ ok: boolean }>;
  /** Bundled catalogue rows, by catalogue key: muscles for stored rows saved without helpers. */
  catalogueExercises: () => readonly Exercise[];
  dispatch: (sessionId: string, command: SessionCommand) => Promise<CommandOutcome>;
  /** Yields between workouts on a cold read so taps and frames keep running (default: 8 ms slices). */
  slicer?: () => Slicer;
  /** Resolves when the UI is idle; `prewarm` waits for it so it never competes with a launch or Finish. */
  idle?: () => Promise<void>;
}

export interface ProgressHome {
  view: ProgressHomeView;
  days: ProgressWindowDays;
  grouping: ProgressGrouping;
  /** Workouts that failed to read and aren't counted. */
  unreadable: number;
  resume: ResumeBar | null;
}

export type ConfirmOutcome = { ok: true; sessionId: string; version: number } | { ok: false; message: string };

interface Cached {
  revision: number;
  projection: ProgressSession | null;
  unreadable: boolean;
}

const COULDNT_SAVE = 'Couldn’t save. Try again.';

/** What Progress knows about each exercise: the stored row, with the catalogue's helpers when the row has none (starter rows were saved without them). */
export function muscleInfoFor(rows: readonly Exercise[], catalogue: readonly Exercise[]): Map<string, MuscleInfo> {
  const byKey = new Map(catalogue.flatMap((c) => (c.catalogueKey ? [[c.catalogueKey, c] as const] : [])));
  const out = new Map<string, MuscleInfo>();
  for (const c of catalogue) out.set(c.id, infoOf(c, undefined));
  for (const r of rows) out.set(r.id, infoOf(r, r.catalogueKey ? byKey.get(r.catalogueKey) : undefined));
  return out;
}

function infoOf(row: Exercise, bundled: Exercise | undefined): MuscleInfo {
  const primary = row.primaryMuscles.length > 0 ? row.primaryMuscles : (bundled?.primaryMuscles ?? []);
  const secondary = row.secondaryMuscles ?? bundled?.secondaryMuscles;
  return { name: row.name, movementPattern: row.movementPattern, primaryMuscles: primary, secondaryMuscles: secondary, split: row.split ?? bundled?.split };
}

export function createProgressService(deps: ProgressServiceDeps) {
  const repos = () => deps.store().repos;
  let cache = new Map<string, Cached>();
  let cacheKey: { store: Store; ownerId: string; tz: string } | null = null;
  /**
   * Ben's latest window / grouping choice, set the moment he taps, before the
   * save lands, so the home and Muscles always show the same thing (one shared
   * setting, check 15). Set synchronously, so a reload started right after
   * the tap already sees it. Tied to the open store: a restore drops it.
   */
  let chosen: { store: Store; days?: ProgressWindowDays; grouping?: ProgressGrouping } | null = null;
  let settingsWrites: Promise<unknown> = Promise.resolve();
  /** The tap that last set each field of `chosen`; a failed save drops only the fields it still owns (review r2 N2). */
  const fieldOwner: { days?: symbol; grouping?: symbol } = {};

  function dropFailed(patch: { days?: ProgressWindowDays; grouping?: ProgressGrouping }, token: symbol): void {
    if (chosen === null) return;
    const next = { ...chosen };
    if (patch.days !== undefined && fieldOwner.days === token) {
      delete next.days;
      delete fieldOwner.days;
    }
    if (patch.grouping !== undefined && fieldOwner.grouping === token) {
      delete next.grouping;
      delete fieldOwner.grouping;
    }
    chosen = next.days === undefined && next.grouping === undefined ? null : next;
  }

  function chosenNow(): { days?: ProgressWindowDays; grouping?: ProgressGrouping } {
    if (chosen === null || chosen.store !== deps.store()) return {};
    return chosen;
  }

  /** A projection pass in progress (prewarm or a screen); the next one waits for it, then mostly hits the cache. */
  let pass: Promise<unknown> = Promise.resolve();

  /** Every finished workout, projected; reads only sessions whose revision changed. One pass at a time. */
  function finishedSessions(profile: UserProfile): Promise<{ sessions: ProgressSession[]; unreadable: number }> {
    const run = () => projectAll(profile);
    const out = pass.then(run, run);
    pass = out.catch(() => undefined);
    return out;
  }

  async function projectAll(profile: UserProfile): Promise<{ sessions: ProgressSession[]; unreadable: number }> {
    const store = deps.store();
    if (cacheKey === null || cacheKey.store !== store || cacheKey.ownerId !== profile.id || cacheKey.tz !== profile.timezone) {
      cache = new Map();
      cacheKey = { store, ownerId: profile.id, tz: profile.timezone };
    }
    const nowMs = toMs(deps.now().utc);
    const refs = await store.repos.sessions.listFinishedRevisions(profile.id);
    const next = new Map<string, Cached>();
    const slice = (deps.slicer ?? (() => timeSlicer()))();
    for (const ref of refs) {
      await slice();
      const hit = cache.get(ref.id);
      if (hit !== undefined && hit.revision === ref.revision) {
        next.set(ref.id, hit);
        continue;
      }
      try {
        const agg = await store.repos.sessions.get(ref.id);
        next.set(ref.id, { revision: ref.revision, projection: agg ? toProgressSession(agg, profile.timezone, nowMs) : null, unreadable: false });
      } catch {
        next.set(ref.id, { revision: ref.revision, projection: null, unreadable: true });
      }
    }
    cache = next;
    const sessions: ProgressSession[] = [];
    let unreadable = 0;
    for (const c of next.values()) {
      if (c.unreadable) unreadable += 1;
      else if (c.projection !== null) sessions.push(c.projection);
    }
    return { sessions, unreadable };
  }

  async function context(profile: UserProfile) {
    const [{ sessions, unreadable }, rows, gyms] = await Promise.all([finishedSessions(profile), repos().exercises.list(), repos().gyms.listByOwner(profile.id)]);
    return {
      sessions,
      unreadable,
      exercises: muscleInfoFor(rows, deps.catalogueExercises()),
      gymNames: Object.fromEntries(gyms.map((g) => [g.id, g.name])),
    };
  }

  return {
    /**
     * Projects every finished workout into the in-memory cache ahead of time,
     * after launch and after Finish, so opening Progress after a cold start
     * doesn't wait seconds on a long history (review S4). Sliced and run when
     * the UI is idle; never awaited by anything Ben does.
     */
    async prewarm(): Promise<void> {
      await deps.idle?.();
      const profile = await deps.profile();
      if (!profile) return;
      await finishedSessions(profile);
    },

    /**
     * `buildProgressHome` (§6.2): one call for the home and the Muscles
     * screen. `days` / `grouping` default to Ben's last choice (the one shared
     * setting: just chosen, else saved in Your data), else `30 days` and
     * `Body parts`. Screens pass nothing, so they never disagree.
     */
    async home(req: { days?: ProgressWindowDays; grouping?: ProgressGrouping } = {}): Promise<ProgressHome | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const pick = chosenNow();
      const days = req.days ?? pick.days ?? profile.progress?.window ?? DEFAULT_PROGRESS_WINDOW;
      const grouping = req.grouping ?? pick.grouping ?? profile.progress?.grouping ?? 'body_part';
      const now = deps.now();
      const nowMs = toMs(now.utc);
      const ctx = await context(profile);
      const active = await repos().sessions.getActive(profile.id).catch(() => null);
      return {
        view: buildProgressHomeView({ sessions: ctx.sessions, exercises: ctx.exercises, gymNames: ctx.gymNames, today: localDateOf(nowMs, profile.timezone), days, grouping }),
        days,
        grouping,
        unreadable: ctx.unreadable,
        resume: resumeBar(active, nowMs),
      };
    },

    /** `buildCalendarMonth` (§6.2). `month` is `YYYY-MM`; default: this month. */
    async calendar(month?: string): Promise<{ view: CalendarMonthView; unreadable: number } | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const nowMs = toMs(deps.now().utc);
      const today = localDateOf(nowMs, profile.timezone);
      const ctx = await context(profile);
      const active = await repos().sessions.getActive(profile.id).catch(() => null);
      const activeRow =
        active === null
          ? null
          : {
              sessionId: active.session.id,
              date: localDateOf(toMs(active.session.startedAt.utc), profile.timezone),
              name: active.session.routineName,
              fresh: nowMs - toMs(active.session.lastActivityAtUtc) < STALE_SESSION_MS,
            };
      return {
        view: buildCalendarMonthView({ sessions: ctx.sessions, exercises: ctx.exercises, gymNames: ctx.gymNames, month: month ?? monthOf(today), today, active: activeRow }),
        unreadable: ctx.unreadable,
      };
    },

    /**
     * `Count it` (PG25a): `confirmSessionDuration(sessionId, expectedVersion,
     * opId)`. Idempotent per `opId`; a stale version is refused. The returned
     * version is what `undoCount` binds to.
     */
    async confirmDuration(req: { sessionId: string; expectedVersion: number; opId: string }): Promise<ConfirmOutcome> {
      return setConfirmed(req, true);
    },

    /** Undo of `Count it`: only against the version `Count it` produced. */
    async undoConfirmDuration(req: { sessionId: string; expectedVersion: number; opId: string }): Promise<ConfirmOutcome> {
      return setConfirmed(req, false);
    },

    /**
     * `setProgressWindow` / `setProgressGrouping` (Your data settings). Not
     * data, so no Undo. The choice is shared at once (the next `home()` from
     * either screen uses it); the save merges onto the stored setting and runs
     * after any earlier one, so quick taps never lose a field (review S3).
     * On a failed save the fields it set are dropped (unless a later tap set
     * them again) and the saved setting shows again.
     */
    saveSettings(patch: { days?: ProgressWindowDays; grouping?: ProgressGrouping }): Promise<{ ok: boolean }> {
      const mine = { ...chosenNow(), ...patch, store: deps.store() };
      chosen = mine;
      const token = Symbol('settings tap');
      if (patch.days !== undefined) fieldOwner.days = token;
      if (patch.grouping !== undefined) fieldOwner.grouping = token;
      const run = async (): Promise<{ ok: boolean }> => {
        const out = await deps
          .saveSettings((current) => {
            const now = current ?? {};
            const next = { ...now, ...(patch.days !== undefined ? { window: patch.days } : {}), ...(patch.grouping !== undefined ? { grouping: patch.grouping } : {}) };
            return next.window === now.window && next.grouping === now.grouping ? null : next;
          })
          .catch(() => ({ ok: false }));
        if (!out.ok) dropFailed(patch, token);
        return out;
      };
      const out = settingsWrites.then(run, run);
      settingsWrites = out.catch(() => undefined);
      return out;
    },
  };

  async function setConfirmed(req: { sessionId: string; expectedVersion: number; opId: string }, confirmed: boolean): Promise<ConfirmOutcome> {
    try {
      const out = await deps.dispatch(req.sessionId, { type: 'confirm_session_duration', at: deps.now(), opId: req.opId, confirmed, expectedVersion: req.expectedVersion });
      if (!out.ok) return { ok: false, message: out.error.code === 'stale_version' ? 'This workout changed. Check it and try again.' : out.error.message };
      return { ok: true, sessionId: req.sessionId, version: out.aggregate.session.version };
    } catch {
      return { ok: false, message: COULDNT_SAVE };
    }
  }
}

export type ProgressService = ReturnType<typeof createProgressService>;

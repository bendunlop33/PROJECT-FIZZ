import {
  buildCalendarMonthView,
  activityRow,
  buildExerciseDetailView,
  buildExerciseExtras,
  type ExerciseExtrasView,
  buildExerciseListView,
  buildExerciseTabView,
  buildProgressHomeView,
  customProgressWindow,
  listProgressExercises,
  defaultLiftPicks,
  trackedLiftPicks,
  buildMonthlyRecap,
  recapCardShown,
  recapMonthOf,
  MONTHLY_RECAP,
  type MonthlyRecapView,
  liftChips,
  liftsTabSelection,
  type LiftChip,
  type LiftPicksSource,
  periodHolding,
  periodProgressWindow,
  rangeText,
  rangeWords,
  DEFAULT_PROGRESS_PERIOD,
  localDateOf,
  exerciseTargetHistory,
  isMainLift,
  targetsHitShown,
  type ExerciseTargetHistory,
  monthOf,
  normaliseProgressRange,
  resumeBar,
  STALE_SESSION_MS,
  toMs,
  toProgressSession,
  painFlagCovering,
  type CalendarMonthView,
  type CommandOutcome,
  type ExerciseDetailView,
  type ExerciseListView,
  type ExerciseMeasure,
  type ExerciseMetric,
  type ExerciseTabView,
  type MuscleGroup,
  type TrendRange,
  type MuscleInfo,
  type DateRange,
  type ProgressHomeView,
  type ProgressSession,
  type ResumeBar,
  type HistoryWorkout,
  type NewBestRecords,
  addDays,
  buildTrainingPeriodView,
  DEFAULT_PERIOD_SPAN,
  periodBar,
  type PeriodBarView,
  type PeriodSpan,
  type TrainingPeriodView,
  type TrainingPlanDays,
} from '@fizz/domain';
import { timeSlicer, type Slicer, type Store } from '@fizz/persistence';

import { createVersionMemo } from './version-memo';
import type { Exercise, ImplementCount, ProgressGrouping, ProgressPeriodKey, SessionAggregate, SessionCommand, UserProfile, ZonedTimestamp } from '@fizz/schemas';

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
  /** Dumbbells per hand-load set for a catalogue entry (`implements`: 1 or 2), for Progress's total weight; null when not recorded. */
  catalogueImplements?: (catalogueKey: string) => ImplementCount | null;
  dispatch: (sessionId: string, command: SessionCommand) => Promise<CommandOutcome>;
  /** Yields between workouts on a cold read so taps and frames keep running (default: 8 ms slices). */
  slicer?: () => Slicer;
  /** Resolves when the UI is idle; `prewarm` waits for it so it never competes with a launch or Finish. */
  idle?: () => Promise<void>;
  /** Every main lift (`Targets hit` shows on main lifts only, Ben 20 Oct); absent: none. */
  mainLiftIds?: () => Promise<ReadonlySet<string>>;
  /**
   * The plan in use's main lift per day, in day order (Progress › Lifts' chips, Ben 26 Oct); null with no
   * plan in use (or absent): Ben's most-trained main compounds instead.
   */
  planMainLifts?: () => Promise<readonly string[] | null>;
  /** (Ben, 26 Oct) The lifts Ben picked on Overview (`Edit`, `progress_lifts`), in his order; absent or empty: none. */
  progressLifts?: () => Promise<readonly string[]>;
  /** (Ben, 26 Oct) With a plan in use: each recent week and whether it reached his aim (the consistency card's); null otherwise. */
  planWeeks?: () => Promise<readonly { monday: string; atAim: boolean | null }[] | null>;
  /**
   * (Ben, 26 Oct; one definition of best) The tracked lifts' `New best`s (the weekly review's `newBestClaims`, the
   * Summary's rule): every `RECORDS` list and the recap's count. Absent or null: not known, no records shown.
   */
  newBests?: () => Promise<NewBestRecords | null>;
  /** (Redesign v3 C3) The plan in use's days (names in plan order, the routines each was made from); null with no plan. */
  planDays?: () => Promise<TrainingPlanDays | null>;
  /** (Redesign v3 C4) Ben's days-a-week aim (Profile › Training); null: none. */
  aim?: () => Promise<number | null>;
}

/** (Redesign v3 C2) The period bar's choice: a span and how many periods back. */
export interface PeriodChoice {
  span: PeriodSpan;
  offset: number;
}

/** (Redesign v3 C3, C4) Progress › Training for the bar's period. */
export interface ProgressTraining {
  bar: PeriodBarView;
  /** Muscles, records and the left-out-time sheet, on the bar's window. */
  home: ProgressHome;
  /** Null with nothing logged at all. */
  view: TrainingPeriodView | null;
}

/** (Ben, 26 Oct) The monthly recap card: the month just ended, while its card shows on Progress. */
export interface RecapCard {
  view: MonthlyRecapView;
}

/** (Perf, Ben 26 Oct) Progress before any tab: whether there is history, the period in use (the coach's entry) and the ResumeBar. */
export interface ProgressShell {
  hasData: boolean;
  period: ProgressPeriodKey;
  range: DateRange | null;
  resume: ResumeBar | null;
  /** (Redesign v3 C2) The period bar for the choice asked (default: this month), shared by Lifts, Training and Body. */
  bar: PeriodBarView;
  /** Today in Ben's zone (a span change keeps the place: `offsetHolding`). */
  today: string;
}

export interface ProgressHome {
  view: ProgressHomeView;
  /** The preset in use, or the last one chosen when a custom period shows. */
  period: ProgressPeriodKey;
  /** The custom period showing (made valid), or null for a preset. For this run of the app only: not saved. */
  range: DateRange | null;
  /** Today in Ben's zone, and the first workout's date (or today): the period sheet's bounds. */
  today: string;
  earliest: string;
  grouping: ProgressGrouping;
  /** Workouts that failed to read and aren't counted. */
  unreadable: number;
  resume: ResumeBar | null;
}

/** What exercise detail is asked for (§2.7); anything left out is the remembered choice, else the default. */
export interface ExerciseDetailRequest {
  exerciseId: string;
  seriesId?: string | null;
  /** Prefer this equipment's series (Workout overview `History`). */
  equipmentId?: string | null;
  /** Else a series at this gym (Workout overview `History`). */
  gymId?: string | null;
  /** Open on the series with this workout, its point selected (home record, past workout). */
  sessionId?: string | null;
  /** With `sessionId`: the workout row tapped (Summary). */
  sessionExerciseId?: string | null;
  metric?: ExerciseMetric | null;
  range?: TrendRange | null;
  /**
   * The series and range an opening chose (`sessionId`, `equipmentId`), kept
   * by the screen on later fetches until Ben picks his own. Used when no
   * explicit `seriesId` / `range` is given, and never remembered (review
   * progress-B r2 S2).
   */
  openedSeriesId?: string | null;
  openedRange?: TrendRange | null;
  /** The workout selected on screen, so a refetch keeps it selected (its week's point under weekly bests). */
  selectSessionId?: string | null;
  repBy?: 'weight' | 'reps';
  historyMonths?: number;
}

/** Progress › Exercises tab (Ben, 13–14 Oct 2026): one exercise, measure, period and trailing count. */
export interface ExerciseTabRequest {
  /** Null: Ben's last pick on this phone (`remembered`) while it has history, else the first of his main lifts (`lifts`). */
  exerciseId?: string | null;
  /** Ben's last pick in the Lifts tab on this phone (device prefs); ignored once it has no history. */
  remembered?: string | null;
  period: ProgressPeriodKey;
  /** A custom period, or null for the preset. */
  range?: DateRange | null;
  measure?: ExerciseMeasure | null;
  trailing?: number | null;
  seriesId?: string | null;
  /** Opened from a home record: that workout's series, and a period wide enough to show it. */
  open?: { sessionId: string; sessionExerciseId: string | null } | null;
  /** Settings › `Targets hit` (this phone; default off): with it on, a main lift's targets carry `Targets hit 5 of last 6`. */
  targetsHit?: boolean;
  /** `BEST REPS` by weight (default) or by reps. */
  repBy?: 'weight' | 'reps';
}

export interface ExerciseTab {
  /** Null with no finished workout yet. */
  view: ExerciseTabView | null;
  period: ProgressPeriodKey;
  range: DateRange | null;
  window: DateRange;
  datesLine: string;
  datesWords: string;
  today: string;
  earliest: string;
  unreadable: number;
  /** (19 Oct, plan tracker v1) The exercise's target against actual per workout and (main lifts, setting on; Ben 20 Oct) `Targets hit 5 of last 6`; null with no exercise. */
  targets?: ExerciseTargetHistory | null;
  /**
   * (Ben, 26 Oct) The chip row over the chart: his main lifts (the plan's per day, else his most-trained
   * main compounds, else his recent exercises), the one showing selected.
   */
  lifts: { chips: LiftChip[]; source: LiftPicksSource };
  /**
   * (Ben, 26 Oct: one exercise-progress screen) Under the shared chart and table, in Lifts and on Exercise detail:
   * `BEST REPS` for the period, all-time `RECORDS` and an active pain flag, for the series showing; null with no exercise.
   */
  extras: ExerciseExtrasView | null;
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
  return { name: row.name, movementPattern: row.movementPattern, primaryMuscles: primary, secondaryMuscles: secondary, split: row.split ?? bundled?.split, mechanic: row.mechanic ?? bundled?.mechanic };
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
  let chosen: { store: Store; period?: ProgressPeriodKey; grouping?: ProgressGrouping } | null = null;
  /**
   * A custom period (Ben, 12 Oct 2026), shared by the home and Muscles like
   * the window. In memory for this run only: a fixed date range saved in Your
   * data would silently go stale, so a relaunch shows the saved preset.
   * Choosing a preset clears it. Tied to the open store.
   */
  let customRange: { store: Store; range: DateRange } | null = null;
  let settingsWrites: Promise<unknown> = Promise.resolve();
  /** The tap that last set each field of `chosen`; a failed save drops only the fields it still owns (review r2 N2). */
  const fieldOwner: { period?: symbol; grouping?: symbol } = {};

  function dropFailed(patch: { period?: ProgressPeriodKey; grouping?: ProgressGrouping }, token: symbol): void {
    if (chosen === null) return;
    const next = { ...chosen };
    if (patch.period !== undefined && fieldOwner.period === token) {
      delete next.period;
      delete fieldOwner.period;
    }
    if (patch.grouping !== undefined && fieldOwner.grouping === token) {
      delete next.grouping;
      delete fieldOwner.grouping;
    }
    chosen = next.period === undefined && next.grouping === undefined ? null : next;
  }

  function chosenNow(): { period?: ProgressPeriodKey; grouping?: ProgressGrouping } {
    if (chosen === null || chosen.store !== deps.store()) return {};
    return chosen;
  }

  /** A projection pass in progress (prewarm or a screen); the next one waits for it, then mostly hits the cache. */
  let pass: Promise<unknown> = Promise.resolve();
  /**
   * (Perf, Ben 26 Oct) The last pass's answer: handed out again (the same array) while no workout changed, so the
   * domain's per-history memos (records) hold across periods, tabs and returns to Progress.
   */
  let lastPass: { store: Store; ownerId: string; tz: string; out: { sessions: ProgressSession[]; unreadable: number } } | null = null;

  /** Every finished workout, projected; reads only sessions whose revision changed. One pass at a time. */
  function finishedSessions(profile: UserProfile): Promise<{ sessions: ProgressSession[]; unreadable: number }> {
    const run = () => projectAll(profile);
    const out = pass.then(run, run);
    pass = out.catch(() => undefined);
    return out;
  }

  /** Workouts read per slice of a projection pass. */
  const PROJECT_BATCH = 8;

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
    // (Perf, 23 Oct) Changed workouts are read a few at a time (one batched read each, shared with the store's
    // cache), still sliced so a long pass never blocks.
    const toRead = refs.filter((ref) => {
      const hit = cache.get(ref.id);
      return hit === undefined || hit.revision !== ref.revision;
    });
    const read = new Map<string, HistoryWorkout | Error | null>();
    for (let i = 0; i < toRead.length; i += PROJECT_BATCH) {
      await slice();
      const ids = toRead.slice(i, i + PROJECT_BATCH).map((r) => r.id);
      try {
        const got = await store.repos.sessions.getMany(ids);
        for (const id of ids) read.set(id, got.get(id) ?? null);
      } catch (e) {
        for (const id of ids) read.set(id, e instanceof Error ? e : new Error(String(e)));
      }
    }
    for (const ref of refs) {
      const hit = cache.get(ref.id);
      if (hit !== undefined && hit.revision === ref.revision) {
        next.set(ref.id, hit);
        continue;
      }
      const agg = read.get(ref.id) ?? null;
      if (agg instanceof Error) {
        next.set(ref.id, { revision: ref.revision, projection: null, unreadable: true });
        continue;
      }
      try {
        next.set(ref.id, { revision: ref.revision, projection: agg ? toProgressSession(agg, profile.timezone, nowMs) : null, unreadable: false });
      } catch {
        next.set(ref.id, { revision: ref.revision, projection: null, unreadable: true });
      }
    }
    const same = toRead.length === 0 && next.size === cache.size && lastPass !== null && lastPass.store === store && lastPass.ownerId === profile.id && lastPass.tz === profile.timezone;
    cache = next;
    if (same && lastPass !== null) return lastPass.out;
    const sessions: ProgressSession[] = [];
    let unreadable = 0;
    for (const c of next.values()) {
      if (c.unreadable) unreadable += 1;
      else if (c.projection !== null) sessions.push(c.projection);
    }
    const out = { sessions, unreadable };
    lastPass = { store, ownerId: profile.id, tz: profile.timezone, out };
    return out;
  }

  /** The records' `New best`s, or null when they can't be read (never a guess: no records are shown then). */
  async function bestsNow(): Promise<NewBestRecords | null> {
    return (await deps.newBests?.().catch(() => null)) ?? null;
  }

  async function context(profile: UserProfile) {
    const [{ sessions, unreadable }, rows, gyms] = await Promise.all([finishedSessions(profile), repos().exercises.list(), repos().gyms.listByOwner(profile.id)]);
    return {
      sessions,
      unreadable,
      exercises: muscleInfoFor(rows, deps.catalogueExercises()),
      gymNames: Object.fromEntries(gyms.map((g) => [g.id, g.name])),
      /** One dumbbell or two per hand-load set (the catalogue's `implements`); null for custom exercises and anything else. */
      implementsOf: (exerciseId: string): ImplementCount | null => {
        const row = rows.find((r) => r.id === exerciseId) ?? deps.catalogueExercises().find((c) => c.id === exerciseId);
        if (row === undefined || row.defaultLoadConvention !== 'per_hand' || !row.catalogueKey) return null;
        return deps.catalogueImplements?.(row.catalogueKey) ?? null;
      },
    };
  }

  /** Target against actual for one exercise: its newest finished workouts, read as planned and logged (plan tracker v1). */
  async function targetsFor(profile: UserProfile, sessions: readonly ProgressSession[], exerciseId: string, targetsHit: boolean, limit = 20): Promise<ExerciseTargetHistory> {
    const ids = sessions
      .filter((x) => x.exercises.some((e) => e.exerciseId === exerciseId))
      .sort((a, b) => b.startedMs - a.startedMs)
      .slice(0, limit)
      .map((x) => x.sessionId);
    // (Perf, Ben 26 Oct; review 26 Oct finding 9) One batched read of the stored history summaries, not up to 20
    // full workouts one at a time; kept while nothing is written, so a period or measure change reads nothing.
    const history = await targetsMemo.get(deps.store(), `${profile.id}|${exerciseId}|${String(limit)}|${ids.join(',')}`, async () => {
      const got = await repos()
        .sessions.getMany(ids)
        .catch(() => new Map<string, HistoryWorkout | Error>());
      const workouts: HistoryWorkout[] = [];
      for (const id of ids) {
        const a = got.get(id);
        if (a !== undefined && !(a instanceof Error) && a.session.ownerId === profile.id) workouts.push(a);
      }
      return exerciseTargetHistory(workouts, exerciseId, limit);
    });
    // `Targets hit` (Ben, 20 Oct): with the setting on, on main lifts only; the per-workout rows always stay.
    const mains = targetsHit ? ((await deps.mainLiftIds?.().catch(() => null)) ?? new Set<string>()) : new Set<string>();
    return { ...history, hitText: targetsHitShown(history.hitText, { on: targetsHit, main: isMainLift(exerciseId, mains) }) };
  }

  /**
   * Ben's choices on exercise detail, per exercise, for this run of the app
   * (§4.2: the series and the rep-table toggle are remembered per exercise).
   * In memory only: not data, and a restore or relaunch falls back to the
   * defaults (most-used series, `Est. 1RM`, `6 mo`, `By weight`).
   */
  const targetsMemo = createVersionMemo<ExerciseTargetHistory>(8);
  /** (Perf, Ben 26 Oct) Answers kept while nothing is written (`createVersionMemo`): a return to Progress reads nothing. */
  const homeMemo = createVersionMemo<ProgressHome | null>(8);
  const tabMemo = createVersionMemo<ExerciseTab | null>(8);
  const activeMemo = createVersionMemo<SessionAggregate | null>(1);
  const shellMemo = createVersionMemo<ProgressShell>(4);
  const recapMemo = createVersionMemo<RecapCard | null>(2);
  const trainingMemo = createVersionMemo<ProgressTraining | null>(8);
  const activeOf = (ownerId: string): Promise<SessionAggregate | null> =>
    activeMemo.get(deps.store(), ownerId, () =>
      repos()
        .sessions.getActive(ownerId)
        .catch(() => null),
    );

  const detailChoice = new Map<string, { store: Store; seriesId?: string; metric?: ExerciseMetric; range?: TrendRange; repBy?: 'weight' | 'reps' }>();

  /** The period, grouping and custom range in use: the request's, else Ben's latest tap, else saved, else the defaults. */
  function periodNow(profile: UserProfile, req: { period?: ProgressPeriodKey; grouping?: ProgressGrouping; range?: DateRange }, today: string): { period: ProgressPeriodKey; grouping: ProgressGrouping; range: DateRange | null } {
    const pick = chosenNow();
    const period = req.period ?? pick.period ?? profile.progress?.period ?? DEFAULT_PROGRESS_PERIOD;
    const grouping = req.grouping ?? pick.grouping ?? profile.progress?.grouping ?? 'body_part';
    const asked = req.range ?? (req.period === undefined && customRange !== null && customRange.store === deps.store() ? customRange.range : null);
    return { period, grouping, range: asked === null ? null : normaliseProgressRange(asked, today) };
  }

  async function homeFor(profile: UserProfile, req: { period?: ProgressPeriodKey; grouping?: ProgressGrouping; range?: DateRange }): Promise<ProgressHome | null> {
    const nowMs = toMs(deps.now().utc);
    const today = localDateOf(nowMs, profile.timezone);
    const { period, grouping, range } = periodNow(profile, req, today);
    // (Perf, Ben 26 Oct) Kept while nothing is written: a return to Progress or a period picked before reads nothing.
    const base = await homeMemo.get(deps.store(), JSON.stringify([profile.id, profile.timezone, today, period, grouping, range]), async () => {
      const [ctx, bests] = await Promise.all([context(profile), bestsNow()]);
      let earliest = today;
      for (const s of ctx.sessions) if (s.date < earliest) earliest = s.date;
      const home: ProgressHome = {
        view: buildProgressHomeView({ sessions: ctx.sessions, exercises: ctx.exercises, gymNames: ctx.gymNames, today, period, grouping, range, bests }),
        period,
        range,
        today,
        earliest,
        grouping,
        unreadable: ctx.unreadable,
        resume: null,
      };
      return home;
    });
    if (base === null) return null;
    const resume = resumeBar(await activeOf(profile.id), nowMs);
    // The same object while nothing changed, so a screen showing it doesn't render again.
    return resume === null ? base : { ...base, resume };
  }

  async function readExerciseTab(profile: UserProfile, req: ExerciseTabRequest, today: string): Promise<ExerciseTab | null> {
      const ctx = await context(profile);
      let period = req.period;
      let range = req.range ? normaliseProgressRange(req.range, today) : null;
      const openDate = req.open ? ctx.sessions.find((s) => s.sessionId === req.open?.sessionId)?.date : undefined;
      if (openDate !== undefined && range === null) ({ period, range } = periodHolding(openDate, today, period));
      const window = range === null ? periodProgressWindow(today, period) : customProgressWindow(range);
      let earliest = today;
      for (const s of ctx.sessions) if (s.date < earliest) earliest = s.date;
      const listed = listProgressExercises(ctx.sessions);
      const names = new Map(listed.map((e) => [e.exerciseId, e.name]));
      const planMains = (await deps.planMainLifts?.().catch(() => null)) ?? null;
      const picked = (await deps.progressLifts?.().catch(() => null)) ?? [];
      // (Ben, 26 Oct) One list of tracked lifts: his Overview picks first, then the defaults.
      const picks = trackedLiftPicks({ picked, defaults: defaultLiftPicks({ planMains, sessions: ctx.sessions, info: (id) => ctx.exercises.get(id) ?? null, today }), logged: (id) => names.has(id) });
      const exerciseId = liftsTabSelection({ requested: req.exerciseId ?? null, remembered: req.remembered ?? null, picks: picks.ids, logged: (id) => names.has(id) }) ?? listed[0]?.exerciseId ?? null;
      const nameOf = (id: string): string => ctx.exercises.get(id)?.name ?? names.get(id) ?? 'Exercise';
      const lifts = { chips: liftChips(picks.ids, exerciseId, nameOf), source: picks.source };
      const view =
        exerciseId === null
          ? null
          : buildExerciseTabView({
              sessions: ctx.sessions,
              exerciseId,
              today,
              window,
              unit: profile.preferredUnit,
              implements: ctx.implementsOf(exerciseId),
              name: ctx.exercises.get(exerciseId)?.name ?? '',
              seriesId: req.seriesId ?? null,
              sessionId: req.open?.sessionId ?? null,
              sessionExerciseId: req.open?.sessionExerciseId ?? null,
              measure: req.measure ?? null,
              trailing: req.trailing ?? null,
            });
      const targets = exerciseId === null ? null : await targetsFor(profile, ctx.sessions, exerciseId, req.targetsHit === true).catch(() => null);
      let extras: ExerciseExtrasView | null = null;
      if (view !== null) {
        const nowMs = toMs(deps.now().utc);
        const flags = await repos()
          .painFlags.listActive(profile.id)
          .catch(() => []);
        const pain = painFlagCovering(flags, view.exerciseId, nowMs, profile.timezone);
        extras = buildExerciseExtras({
          bests: await bestsNow(),
          sessions: ctx.sessions,
          exerciseId: view.exerciseId,
          seriesId: view.seriesId,
          today,
          window,
          unit: profile.preferredUnit,
          repBy: req.repBy ?? 'weight',
          painFlag: pain === null ? null : { flagId: pain.flag.id, date: localDateOf(toMs(pain.flag.reportedAt.utc), pain.flag.reportedAt.tz) },
        });
      }
      return { view, period, range, window: { from: window.from, to: window.to }, datesLine: rangeText(window, today), datesWords: rangeWords(window, today), today, earliest, unreadable: ctx.unreadable, targets, lifts, extras };
  }

  return {
    /** `listProgressExercises` (§6.2, §2.6): exercises with a finished session, by last done; search and body-part filter. */
    async exercises(req: { query?: string; group?: MuscleGroup | null } = {}): Promise<{ view: ExerciseListView; unreadable: number } | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const ctx = await context(profile);
      const today = localDateOf(toMs(deps.now().utc), profile.timezone);
      return { view: buildExerciseListView({ sessions: ctx.sessions, exercises: ctx.exercises, today, query: req.query ?? '', group: req.group ?? null }), unreadable: ctx.unreadable };
    },

    /**
     * The Exercises tab (Ben, 13–14 Oct 2026): local only, no AI. The period
     * is the tab's own (not the shared home setting). The exercise (Ben, 26 Oct):
     * the one asked for, else his last pick on this phone, else his first main lift
     * (`defaultLiftPicks`: the plan's per day, else his most-trained main compounds).
     */
    async exerciseTab(req: ExerciseTabRequest): Promise<ExerciseTab | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const today = localDateOf(toMs(deps.now().utc), profile.timezone);
      // (Perf, Ben 26 Oct) The same request with nothing written since is answered from memory.
      return tabMemo.get(deps.store(), JSON.stringify([profile.id, profile.timezone, profile.preferredUnit, today, req]), () => readExerciseTab(profile, req, today));
    },

    /**
     * (Ben, 26 Oct) The monthly recap (facts only, offline, from the stored history summaries): the month before
     * today's, against the one before it, on the 1st–7th until Ben dismisses it. Null when the card doesn't show
     * (later in the month, dismissed, or no workout that month); nothing is read then.
     */
    async recap(): Promise<RecapCard | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const today = localDateOf(toMs(deps.now().utc), profile.timezone);
      if (Number(today.slice(8, 10)) > MONTHLY_RECAP.showDays || profile.progress?.recapDismissed === recapMonthOf(today)) return null;
      return recapMemo.get(deps.store(), JSON.stringify([profile.id, profile.timezone, profile.preferredUnit, today]), async () => {
        const ctx = await context(profile);
        const names = new Map(listProgressExercises(ctx.sessions).map((e) => [e.exerciseId, e.name]));
        const planMains = (await deps.planMainLifts?.().catch(() => null)) ?? null;
        const picked = (await deps.progressLifts?.().catch(() => null)) ?? [];
        const lifts = trackedLiftPicks({ picked, defaults: defaultLiftPicks({ planMains, sessions: ctx.sessions, info: (id) => ctx.exercises.get(id) ?? null, today }), logged: (id) => names.has(id) }).ids;
        const planWeeks = (await deps.planWeeks?.().catch(() => null)) ?? null;
        const view = buildMonthlyRecap({ sessions: ctx.sessions, exercises: ctx.exercises, today, lifts, unit: profile.preferredUnit, planWeeks, nameOf: (id) => ctx.exercises.get(id)?.name ?? names.get(id) ?? null, bests: await bestsNow() });
        return recapCardShown({ today, dismissed: profile.progress?.recapDismissed ?? null, recap: view }) && view !== null ? { view } : null;
      });
    },

    /** Dismiss the recap card for `month` (Your data, a versioned profile write; the same month twice writes once). */
    async dismissRecap(month: string): Promise<{ ok: boolean }> {
      return deps
        .saveSettings((current) => (current?.recapDismissed === month ? null : { ...(current ?? {}), recapDismissed: month }))
        .catch(() => ({ ok: false }));
    },

    /**
     * (Perf, Ben 26 Oct) What Progress needs before any tab: whether there is anything to show, the period the
     * coach is asked about, and the ResumeBar. Cheap: no workout is read.
     */
    async shell(choice: PeriodChoice = { span: DEFAULT_PERIOD_SPAN, offset: 0 }): Promise<ProgressShell | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const nowMs = toMs(deps.now().utc);
      const today = localDateOf(nowMs, profile.timezone);
      const { period, range } = periodNow(profile, {}, today);
      const base = await shellMemo.get(deps.store(), JSON.stringify([profile.id, profile.timezone, today, period, range, choice.span, choice.offset]), async () => {
        const [refs, first] = await Promise.all([repos().sessions.listFinishedRevisions(profile.id), repos().sessions.earliestFinishedStartUtc(profile.id).catch(() => null)]);
        const earliest = first === null ? today : localDateOf(toMs(first), profile.timezone);
        return { hasData: refs.length > 0, period, range, resume: null, today, bar: periodBar({ today, span: choice.span, offset: choice.offset, earliest: earliest < today ? earliest : today }) };
      });
      const resume = resumeBar(await activeOf(profile.id), nowMs);
      return resume === null ? base : { ...base, resume };
    },

    /**
     * (Redesign v3 C3, C4) Progress › Training for the period bar's choice: the Month calendar, the Week's days or the
     * weekly bars, totals against the previous period, muscles and records. Local reads only; kept while nothing is
     * written, so stepping back to a period seen before reads nothing.
     */
    async training(choice: PeriodChoice = { span: DEFAULT_PERIOD_SPAN, offset: 0 }): Promise<ProgressTraining | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const nowMs = toMs(deps.now().utc);
      const today = localDateOf(nowMs, profile.timezone);
      const { grouping } = periodNow(profile, {}, today);
      const base = await trainingMemo.get(deps.store(), JSON.stringify([profile.id, profile.timezone, today, grouping, choice.span, choice.offset]), async () => {
        const [ctx, bests, plan, aim] = await Promise.all([context(profile), bestsNow(), deps.planDays?.().catch(() => null) ?? Promise.resolve(null), deps.aim?.().catch(() => null) ?? Promise.resolve(null)]);
        let earliest = today;
        for (const s of ctx.sessions) if (s.date < earliest) earliest = s.date;
        const bar = periodBar({ today, span: choice.span, offset: choice.offset, earliest });
        const view = buildProgressHomeView({ sessions: ctx.sessions, exercises: ctx.exercises, gymNames: ctx.gymNames, today, period: bar.preset, grouping, bests, bar: { window: bar.window, title: bar.title, phrase: bar.phrase } });
        const tiled = choice.span === 'week' || choice.span === 'month';
        const acts = tiled
          ? await repos()
              .activities.listBetween(profile.id, bar.full.from, addDays(bar.full.to, 1))
              .catch(() => [])
          : [];
        const home: ProgressHome = { view, period: bar.preset, range: { from: bar.window.from, to: bar.window.to }, today, earliest, grouping, unreadable: ctx.unreadable, resume: null };
        return {
          bar,
          home,
          view:
            view.dataState === 'empty'
              ? null
              : buildTrainingPeriodView({
                  sessions: ctx.sessions,
                  exercises: ctx.exercises,
                  gymNames: ctx.gymNames,
                  today,
                  bar,
                  plan,
                  aim,
                  earliest,
                  activities: acts.filter((a) => a.fields.status === 'done').map((a) => ({ date: a.fields.date, row: activityRow(a, today) })),
                }),
        };
      });
      if (base === null) return null;
      const resume = resumeBar(await activeOf(profile.id), nowMs);
      return resume === null ? base : { ...base, home: { ...base.home, resume } };
    },

    /**
     * Exercise detail (§2.7): one call builds the series menu, headline,
     * chart, panel, table, rep table, records and history for one series,
     * metric and range. Local only; no AI. Explicit choices in the request
     * are remembered for the exercise; opening on a workout (`sessionId`) or
     * equipment picks that series (and, for an older workout, a wider range)
     * without overwriting the remembered ones, and so do `openedSeriesId` /
     * `openedRange` on the fetches after it.
     */
    async exerciseDetail(req: ExerciseDetailRequest): Promise<{ view: ExerciseDetailView | null; unreadable: number } | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const store = deps.store();
      const prev = detailChoice.get(req.exerciseId);
      const kept = prev !== undefined && prev.store === store ? prev : { store };
      const next = {
        ...kept,
        ...(req.seriesId ? { seriesId: req.seriesId } : {}),
        ...(req.metric ? { metric: req.metric } : {}),
        ...(req.range ? { range: req.range } : {}),
        ...(req.repBy ? { repBy: req.repBy } : {}),
      };
      detailChoice.set(req.exerciseId, next);
      const nowMs = toMs(deps.now().utc);
      const today = localDateOf(nowMs, profile.timezone);
      const [ctx, flags, bests] = await Promise.all([context(profile), repos().painFlags.listActive(profile.id).catch(() => []), bestsNow()]);
      const pain = painFlagCovering(flags, req.exerciseId, nowMs, profile.timezone);
      const opening = req.sessionId != null || req.equipmentId != null || req.gymId != null;
      const view = buildExerciseDetailView({
        bests,
        sessions: ctx.sessions,
        exerciseId: req.exerciseId,
        today,
        unit: profile.preferredUnit,
        name: ctx.exercises.get(req.exerciseId)?.name ?? '',
        seriesId: req.seriesId ?? (opening ? null : (req.openedSeriesId ?? next.seriesId ?? null)),
        equipmentId: req.equipmentId ?? null,
        gymId: req.gymId ?? null,
        sessionId: req.sessionId ?? null,
        sessionExerciseId: req.sessionExerciseId ?? null,
        selectSessionId: req.selectSessionId ?? null,
        metric: next.metric ?? null,
        range: req.range ?? req.openedRange ?? next.range ?? null,
        implements: ctx.implementsOf(req.exerciseId),
        repBy: next.repBy ?? 'weight',
        historyMonths: req.historyMonths ?? 2,
        painFlag: pain === null ? null : { flagId: pain.flag.id, date: localDateOf(toMs(pain.flag.reportedAt.utc), pain.flag.reportedAt.tz) },
      });
      return { view, unreadable: ctx.unreadable };
    },

    /**
     * (19 Oct, plan tracker v1) One exercise's target against actual per finished workout, newest first, and
     * `Targets hit 5 of last 6` (main lifts with the setting on): from the sets as planned and logged (a FitNotes import has no target).
     */
    async exerciseTargets(exerciseId: string, opts: { targetsHit?: boolean; limit?: number } = {}): Promise<ExerciseTargetHistory | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const { sessions } = await finishedSessions(profile);
      return targetsFor(profile, sessions, exerciseId, opts.targetsHit === true, opts.limit ?? 20);
    },

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
      // (Perf, Ben 26 Oct) And the Training totals for the period in use, so the tab opens from memory (it also
      // walks the records once for every later period).
      await (deps.slicer ?? (() => timeSlicer()))()();
      await homeFor(profile, {}).catch(() => null);
    },

    /**
     * `buildProgressHome` (§6.2): one call for the home and the Muscles
     * screen. `period` / `grouping` default to Ben's last choice (the one shared
     * setting: just chosen, else saved in Your data), else `1 month` and
     * `Body parts`. Screens pass nothing, so they never disagree.
     */
    async home(req: { period?: ProgressPeriodKey; grouping?: ProgressGrouping; range?: DateRange } = {}): Promise<ProgressHome | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      return homeFor(profile, req);
    },


    /**
     * What the Library reads from history (exercise-library §9): the same
     * finished workouts Progress shows (one cache), gym names, today's local
     * date and the ResumeBar. Local only.
     */
    async libraryHistory(): Promise<{ sessions: readonly ProgressSession[]; gymNames: Record<string, string>; today: string; resume: ResumeBar | null } | null> {
      const profile = await deps.profile();
      if (!profile) return null;
      const nowMs = toMs(deps.now().utc);
      const [ctx, active] = await Promise.all([context(profile), repos().sessions.getActive(profile.id).catch(() => null)]);
      return { sessions: ctx.sessions, gymNames: ctx.gymNames, today: localDateOf(nowMs, profile.timezone), resume: resumeBar(active, nowMs) };
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
      // (Ben, 20 Oct) Activities on the calendar as their own type.
      const shown = month ?? monthOf(today);
      const acts = await repos()
        .activities.listBetween(profile.id, `${shown}-01`, `${shown}-32`)
        .catch(() => []);
      return {
        view: buildCalendarMonthView({ sessions: ctx.sessions, exercises: ctx.exercises, gymNames: ctx.gymNames, month: shown, today, active: activeRow, activities: acts.map((a) => ({ date: a.fields.date, row: activityRow(a, today) })) }),
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
    /**
     * Show a custom period (the period sheet's `Show`), or go back to the
     * preset (null). Shared at once by the home and Muscles; not data, not
     * saved, no Undo (Clear is the way back).
     */
    choosePeriod(range: DateRange | null): void {
      customRange = range === null ? null : { store: deps.store(), range };
    },

    saveSettings(patch: { period?: ProgressPeriodKey; grouping?: ProgressGrouping }): Promise<{ ok: boolean }> {
      // Choosing a preset ends a custom period.
      if (patch.period !== undefined) customRange = null;
      const mine = { ...chosenNow(), ...patch, store: deps.store() };
      chosen = mine;
      const token = Symbol('settings tap');
      if (patch.period !== undefined) fieldOwner.period = token;
      if (patch.grouping !== undefined) fieldOwner.grouping = token;
      const run = async (): Promise<{ ok: boolean }> => {
        const out = await deps
          .saveSettings((current) => {
            const now = current ?? {};
            const next = { ...now, ...(patch.period !== undefined ? { period: patch.period } : {}), ...(patch.grouping !== undefined ? { grouping: patch.grouping } : {}) };
            return next.period === now.period && next.grouping === now.grouping ? null : next;
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

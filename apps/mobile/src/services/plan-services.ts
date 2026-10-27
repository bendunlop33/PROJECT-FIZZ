import {
  localDateOf,
  activePause,
  activePin,
  applyPlan,
  autoResumeDue,
  addDays,
  consistency,
  localWeekBounds,
  pausedDates,
  planInUseUntilUtc,
  pausedInWeek,
  pausePlan,
  pinPlanDay,
  previousPlanLine,
  previousPlans,
  restartedPlanIdFor,
  restartPlan,
  planDayBodyParts,
  resumePlan,
  splitInUse,
  undoPlanControl,
  workoutGroupsOf,
  type PlanControlChange,
  type PlanDueWorkout,
  currentPlanVersion,
  endPlan,
  isDeleted,
  liveRoutines,
  isMainLift,
  planDayDetail,
  planDayFromTemplates,
  planDayLines,
  planDayRows,
  planIsOpen,
  plannedSetsThisWeek,
  planOverview,
  planRoutines,
  planWeekStartMs,
  rotationRoutines,
  showsTargetsHit,
  toIso,
  toMs,
  undoEndPlan,
  undoPlanApply,
  type ConsistencyView,
  type PlanDayDetailRow,
  type PlanDayRow,
  type PlanEndChange,
  type PlanOverview,
  pbAppliedBuilder,
  pbBlockOfPlan,
  planDayOf,
  PB_BLOCK_COPY,
  type PbBlockRow,
  movePlanDay,
  undoMovePlanDay,
  syncPlanWeek,
  type PbBlockView,
  type HistoryWorkout,
} from '@fizz/domain';
import type { PlanWrite, Store } from '@fizz/persistence';
import { createVersionMemo } from './version-memo';
import { editBlockOf, readPlanBlock, slotKits, weekViews } from './plan-edit-read';
import type { Exercise, MuscleGroup, PlanApplyMode, PlanDraft, Routine, SessionAggregate, SplitBodyPart, UserProfile, ZonedTimestamp } from '@fizz/schemas';

/**
 * Coach-built plans (Ben, 19 Oct): the plan card and its day view, Apply
 * (`Replace my workouts` / `Add alongside`) and Undo, and the plan tracker's
 * consistency card. Your data, local only: nothing here calls the coach or
 * the network. Every value comes from the stored plan and Ben's records;
 * the screens never compute targets, loads or counts themselves.
 */

export interface PlanServicesDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  catalogueExercises?: () => readonly Exercise[];
  /** The selected gym (Library › Your plan's Up next and a day's loads are at it); absent or null: none set up. */
  currentGym?: () => Promise<{ id: string; name: string } | null>;
  /** Up next's workout at this gym (null: the typical gym), as Today shows it; null when Up next isn't a workout. */
  upNextRoutineId?: (gymId: string | null) => Promise<string | null>;
  /** What Start would create for a workout at this gym (a dry run, saves nothing) and about how long. */
  plannedDay?: (routineId: string, gymId: string) => Promise<{ aggregate: SessionAggregate; aboutMinutes: number | null } | null>;
  /** Each split day's main lift (`Targets hit` shows on main lifts only, Ben 20 Oct); absent: none. */
  splitMainLiftIds?: () => Promise<ReadonlySet<string>>;
  /** (Ben, 20 Oct) This week's activity lines and the week change in use (week-services); absent: none. */
  weekInfo?: () => Promise<{ lines: string[]; change: { text: string; weekPlanId: string; version: number; daysRemoved: number; merged: string[][] } | null }>;
}

/**
 * (Ben, 23 Oct: plan length = block 1) A builder plan's weeks on Library › Plan › Your plan: every week's view (the
 * strip shows any of them; done weeks read-only), the current week, and whether the block is done (`Start next
 * block ›` opens the builder with the plan's answers). Null on a coach plan (it has no length).
 */
export interface PlanBlockOverview {
  views: PbBlockView[];
  /** The week the strip opens on: the current one (the last once done). */
  current: number;
  done: boolean;
  header: string;
  /** `6 weeks · Standard · deload week 6`. */
  line: string;
  /** (Ben, 26 Oct) The plan's version as read: `Move day` and `Edit plan` write against it (rule 5). */
  planId: string;
  planVersion: number;
  /** (26 Oct) `Edit plan` while the block runs (a done block starts the next one instead). */
  editable: boolean;
  /**
   * (26 Oct) This week's plan days not done yet: `Do today ›` opens that day on Today (its Today key); `Move day` the
   * weekdays it can move to this week (Set days plans; null on Any days).
   */
  actions: Readonly<Record<number, { todayKey: string; moveTo: number[] | null }>>;
}

export interface PlanOverviewWithBlock extends PlanOverview {
  /** Absent or null: no weeks to show (a coach plan). */
  block?: PlanBlockOverview | null;
}

const EFFORT_WORD = { standard: 'Standard', push: 'Push', maintain: 'Maintain' } as const;

export type PlanCardState =
  | { kind: 'open' }
  /** Applied (this version): Undo while it is the plan in use. */
  | { kind: 'applied'; mode: PlanApplyMode; atUtc: string }
  /** A newer version of the same plan exists: this card can't apply (rule 5). */
  | { kind: 'replaced'; byN: number }
  /** A newer plan was applied since: this one ended (no Undo here; the newer plan's Undo brings it back). */
  | { kind: 'superseded' }
  /**
   * Ben ended it (Library › Your plan › `End plan`). `canResume` (review planview S4): no other plan is in
   * use, so `Use again` (the same write as the toast's Undo) is offered here after the toast is gone.
   */
  | { kind: 'ended'; canResume: boolean }
  | { kind: 'expired' }
  | { kind: 'gone' };

export interface PlanCardData {
  planId: string;
  versionN: number;
  /** The plan's stored version: what Apply and Undo must find (rule 5). */
  planVersion: number;
  name: string;
  days: { index: number; name: string; line: string; leftOut: number }[];
  rationale: string | null;
  gymName: string | null;
  state: PlanCardState;
  /** Workouts in the rotation now that `Replace my workouts` would take out (kept in Workouts). */
  replaces: string[];
}

export interface PlanDayData {
  planId: string;
  versionN: number;
  index: number;
  name: string;
  minutes: number;
  rows: PlanDayRow[];
  /** The checks' lines for this day (`Why?`). */
  checks: string[];
  /** After Apply: the saved workout this day became (open it to edit). */
  routineId: string | null;
}

export type PlanWriteOutcome = { ok: true; plan: PlanDraft; duplicate: boolean } | { ok: false; reason: 'stale' | 'closed' | 'changed_since' | 'missing' | 'failed'; message: string };

/** The applied plan as Progress and Today read it. */
export interface ActivePlan {
  planId: string;
  name: string;
  appliedAtUtc: string;
  days: { routineId: string; name: string; createdFromSessionId: string | null }[];
}

export const PLAN_COPY = {
  stale: 'Out of date. Nothing changed.',
  closed: 'This plan has expired.',
  missing: 'Plan not found.',
  failed: 'Couldn’t save. Try again.',
  /** A plan day with no gym set up, or one this gym can't plan (review planview S2). */
  noGym: 'No gym',
  notHere: 'Can’t plan at this gym',
  /** Your plan couldn't be read (review planview S5). */
  loadFailed: 'Couldn’t load your plan.',
  changedSince: (names: readonly string[]) => `Can’t undo: ${names.join(', ')} changed since.`,
  /** Undo of `End plan` with a newer plan in use, or the plan moved on since. */
  notEnded: 'Out of date. Nothing changed.',
  /** (20 Oct) A pause `until` that isn't after today. */
  badDate: 'Pick a date after today.',
  alreadyPaused: 'Already paused.',
  notPaused: 'Not paused.',
} as const;

/** (26 Oct) `Move day`'s write as an outcome (a taken weekday or a done day: out of date). */
function moveOutcome(r: PlanWrite | null): PlanWriteOutcome {
  if (r === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
  if (r.status === 'written' || r.status === 'replayed') return { ok: true, plan: r.plan, duplicate: r.status === 'replayed' };
  if (r.status === 'missing') return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
  return { ok: false, reason: 'stale', message: PLAN_COPY.stale };
}

/** Library › Your plan › a day (Ben, 19 Oct): what Start would plan here and last time's sets. */
export interface PlanDayScreenData {
  planId: string;
  routineId: string;
  name: string;
  dayN: number;
  of: number;
  /** `Day 2 of 4 · Main gym · about 60 min`. */
  header: string;
  rows: PlanDayDetailRow[];
  /**
   * `planned`: the rows are what Start would plan at this gym. Review planview S2: `no_gym` (none set up
   * yet) or `not_here` (this gym can't plan it): the rows are the saved sets × targets, no loads.
   */
  status: 'planned' | 'no_gym' | 'not_here';
  /** (Ben, 20 Oct) The plan's stored version (what `Make next` must find) and whether this day is pinned now. */
  planVersion: number;
  pinned: boolean;
  /** The plan is paused: `Make next` isn't offered. */
  paused: boolean;
  /**
   * (Ben, 27 Oct: Library › Plan v2) Opened from another week of a builder plan: that week's planned targets
   * (`Week 5 of 6 · Deload`, each exercise's sets × reps · kg), as the week's day card showed; null: this week (the
   * rows are what Start would plan) or a coach plan.
   */
  week: { header: string; note: string | null; rows: PbBlockRow[] } | null;
}

/** Library › Plan › Previous: one row (`Summer PPL` / `Push / Pull / Legs · ended 20 Sep`). */
export interface PreviousPlanRow {
  planId: string;
  planVersion: number;
  name: string;
  line: string;
}

/** What `End plan` did (Ben, 20 Oct): the workouts it couldn't put back (`N workouts not restored`, behind `Why?`). */
export type PlanEndOutcome = (Extract<PlanWriteOutcome, { ok: true }> & { notRestored: string[] }) | Extract<PlanWriteOutcome, { ok: false }>;

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

export function createPlanServices(deps: PlanServicesDeps) {
  const consistencyMemo = createVersionMemo<ConsistencyView | null>(2);
  const repo = () => deps.store().repos.planDrafts;

  async function owner(): Promise<UserProfile | null> {
    return deps.profile();
  }

  /** (Ben, 23 Oct: plan length = block 1) The applied builder plan's weeks; null on a coach plan. */
  async function blockOverview(p: UserProfile, plan: PlanDraft, refs: readonly { routineId: string | null; startedAtUtc: string; planDay?: { planId: string; dayIndex: number } | undefined }[], nowMs: number, tz: string, of: (id: string) => Exercise | null): Promise<PlanBlockOverview | null> {
    const b = pbAppliedBuilder(plan);
    const block = pbBlockOfPlan(plan, refs, nowMs, tz);
    if (b === null || block === null) return null;
    // Each slot's item wherever Ben set it up (the plan was checked at one gym; a later gym change doesn't move the plan).
    const kitOf = await slotKits(deps.store(), p.id);
    const a = b.builder.answers;
    // (Ben, 26 Oct: Edit plan) Each week from the plan's week map; Set days plans show each day's weekday.
    const views = weekViews({ plan, answers: a, block, kitOf, nameOf: (id) => of(id)?.name ?? 'Exercise' });
    const deloads = views[0]?.deloadWeeks ?? [];
    const line = [`${String(a.weeks)} weeks`, EFFORT_WORD[a.effort], ...(deloads.length === 0 ? [] : [`deload ${deloads.length === 1 ? 'week' : 'weeks'} ${deloads.join(', ')}`])].join(' · ');
    const eb = editBlockOf(block);
    const actions: Record<number, { todayKey: string; moveTo: number[] | null }> = {};
    const thisWeek = eb === null ? undefined : views[eb.week - 1];
    if (eb !== null && thisWeek !== undefined && activePause(plan, nowMs, tz) === null) {
      const taken = new Set(thisWeek.days.flatMap((d) => (d.weekday === null ? [] : [d.weekday])));
      for (const d of thisWeek.days) {
        if (d.done) continue;
        actions[d.index] = { todayKey: `plan:${plan.id}:${String(d.index)}`, moveTo: d.weekday === null ? null : [0, 1, 2, 3, 4, 5, 6].filter((x) => x === d.weekday || !taken.has(x)) };
      }
    }
    return { views, current: Math.min(block.week, a.weeks), done: block.done, header: views[0] === undefined ? '' : views[0].header, line, planId: plan.id, planVersion: plan.version, editable: eb !== null, actions };
  }

  /**
   * (Ben, 27 Oct: Library › Plan v2) A plan day's planned targets in block week `w`, when that isn't the block's week
   * now: what the old week strip's day card showed. Null: this week, a coach plan, or not a day of the plan.
   */
  async function weekOfDay(p: UserProfile, plan: PlanDraft, routine: Routine, w: number, nowMs: number): Promise<PlanDayScreenData['week']> {
    const b = pbAppliedBuilder(plan);
    if (b === null || plan.applied === null) return null;
    const dayIndex = plan.applied.made.find((m) => m.routineId === routine.id)?.dayIndex ?? planDayOf(routine)?.dayIndex ?? null;
    const block = await readPlanBlock(deps.store(), p.id, plan, nowMs, p.timezone);
    const a = b.builder.answers;
    if (dayIndex === null || block === null || w < 1 || w > a.weeks || (!block.done && w === block.week)) return null;
    const of = await exerciseOf();
    const views = weekViews({ plan, answers: a, block, kitOf: await slotKits(deps.store(), p.id), nameOf: (id) => of(id)?.name ?? 'Exercise' });
    const view = views[w - 1];
    const day = view?.days.find((d) => d.index === dayIndex);
    if (view === undefined || day === undefined) return null;
    const deload = view.deloadWeeks.includes(w);
    return { header: `${PB_BLOCK_COPY.week(w, a.weeks)}${deload ? ` · ${PB_BLOCK_COPY.deload}` : ''}`, note: view.note, rows: day.rows };
  }

  async function exerciseOf(): Promise<(id: string) => Exercise | null> {
    const pool = new Map<string, Exercise>();
    for (const e of await deps.store().repos.exercises.list().catch(() => [] as Exercise[])) pool.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!pool.has(e.id)) pool.set(e.id, e);
    return (id) => pool.get(id) ?? null;
  }

  /** The main lifts on a plan day: each split day's main lift (Ben, 20 Oct), not the day's `Main` flags. */
  async function splitMainLifts(): Promise<Set<string>> {
    return new Set((await deps.splitMainLiftIds?.().catch(() => null)) ?? []);
  }

  /** Ben's plan by ID (expired on read past its 14 days while open). */
  async function get(planId: string): Promise<PlanDraft | null> {
    const p = await owner();
    if (p === null) return null;
    await repo().expire(p.id, deps.now().utc).catch(() => []);
    const plan = await repo().get(planId).catch(() => null);
    return plan !== null && plan.ownerId === p.id ? plan : null;
  }

  function stateOf(plan: PlanDraft | null, versionN: number, nowUtc: string, otherApplied = false): PlanCardState {
    if (plan === null) return { kind: 'gone' };
    if (plan.status === 'expired' || plan.status === 'discarded' || (plan.status === 'open' && !planIsOpen(plan, nowUtc))) return { kind: 'expired' };
    if (plan.currentVersion !== versionN) return { kind: 'replaced', byN: plan.currentVersion };
    if (plan.status === 'superseded') return { kind: 'superseded' };
    if (plan.status === 'ended') return { kind: 'ended', canResume: !otherApplied };
    if (plan.status === 'applied' && plan.applied !== null) return { kind: 'applied', mode: plan.applied.mode, atUtc: plan.applied.atUtc };
    return { kind: 'open' };
  }

  async function live(ownerId: string): Promise<Routine[]> {
    return liveRoutines(await deps.store().repos.routines.listByOwner(ownerId).catch(() => [] as Routine[]));
  }

  /**
   * The catalogue exercises a plan names that aren't Ben's rows yet (as `Add exercise` saves them). Read only:
   * Apply saves them in its own transaction, so a stale or refused Apply writes nothing (review S4). Null: one is unknown.
   */
  async function exercisesToSave(plan: PlanDraft): Promise<Exercise[] | null> {
    const ids = new Set(currentPlanVersion(plan).days.flatMap((d) => d.plan.slots.map((s) => s.exerciseId)));
    const catalogue = new Map((deps.catalogueExercises?.() ?? []).map((e) => [e.id, e]));
    const out: Exercise[] = [];
    for (const id of ids) {
      if ((await deps.store().repos.exercises.get(id).catch(() => null)) !== null) continue;
      const row = catalogue.get(id);
      if (row === undefined) return null;
      out.push(row);
    }
    return out;
  }

  /** The applied plan in use and its live days, in day order; null without one. */
  async function active(): Promise<ActivePlan | null> {
    const p = await owner();
    if (p === null) return null;
    const plan = await repo().applied(p.id).catch(() => null);
    if (plan === null || plan.applied === null) return null;
    const days = planRoutines(plan, await live(p.id));
    if (days.length === 0) return null;
    return { planId: plan.id, name: plan.name, appliedAtUtc: plan.applied.atUtc, days: days.map((r) => ({ routineId: r.id, name: r.name, createdFromSessionId: r.createdFromSessionId ?? null })) };
  }

  async function endWrite(planId: string, make: (current: PlanDraft, routines: ReadonlyMap<string, Routine | null>, otherApplied: boolean) => PlanEndChange): Promise<PlanWriteOutcome> {
    const p = await owner();
    if (p === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
    const r = await repo()
      .endOrResume(p.id, planId, make)
      .catch(() => null);
    if (r === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
    switch (r.status) {
      case 'written':
      case 'replayed':
        return { ok: true, plan: r.plan, duplicate: r.status === 'replayed' };
      case 'stale':
      case 'closed':
        return { ok: false, reason: 'stale', message: PLAN_COPY.notEnded };
      case 'changed_since':
        return { ok: false, reason: 'changed_since', message: PLAN_COPY.changedSince(r.names) };
      case 'missing':
      case 'invalid':
        return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
    }
  }

  /** (Ben, 20 Oct) A `Make next`, pause, resume or Undo write on the plan, decided against what is stored (rule 5). */
  async function controlWrite(planId: string, make: (current: PlanDraft, routines: readonly Routine[]) => PlanControlChange): Promise<PlanWriteOutcome> {
    const p = await owner();
    if (p === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
    const r = await repo()
      .control(p.id, planId, make)
      .catch(() => null);
    if (r === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
    switch (r.status) {
      case 'written':
      case 'replayed':
        return { ok: true, plan: r.plan, duplicate: r.status === 'replayed' };
      case 'stale':
      case 'closed':
      case 'changed_since':
        return { ok: false, reason: 'stale', message: PLAN_COPY.stale };
      case 'missing':
        return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      case 'invalid':
        return { ok: false, reason: 'stale', message: r.reason === 'bad_date' ? PLAN_COPY.badDate : r.reason === 'already_paused' ? PLAN_COPY.alreadyPaused : r.reason === 'not_paused' ? PLAN_COPY.notPaused : PLAN_COPY.stale };
    }
  }

  /** Each plan day's body parts (`planDayBodyParts`) for the ✓ and Up next's muscle counting. */
  async function bodyPartsOf(ownerId: string, days: readonly Routine[]): Promise<Map<string, SplitBodyPart[]>> {
    const of = await exerciseOf();
    const training = await deps.store().repos.trainingProfiles.get(ownerId).catch(() => null);
    const split = splitInUse(training);
    return new Map(days.map((r) => [r.id, planDayBodyParts(r, of, split)]));
  }

  /** Finished workouts from `fromMs` with the working sets they did per muscle group (Your plan's ✓, 20 Oct). */
  async function groupedWorkouts(ownerId: string, fromMs: number, nowMs: number): Promise<Map<string, ReadonlyMap<MuscleGroup, number>>> {
    const r = await deps.store().repos.sessions.listFinishedBetweenReadable(ownerId, toIso(fromMs), toIso(nowMs + 1)).catch(() => ({ sessions: [] as HistoryWorkout[] }));
    const of = await exerciseOf();
    return new Map(r.sessions.map((a) => [a.session.id, workoutGroupsOf(a, of)]));
  }

  return {
    get,
    active,

    /**
     * (D7, Ben 22–23 Oct: one split source) The plan in use, paused or not: an applied plan with live workouts, as
     * Today and Library › Your plan read it. Null: none (Profile › Split and its defaults are then the source). Local
     * reads only; a failed read throws (never taken for no plan).
     */
    async inUse(): Promise<{ planId: string; name: string } | null> {
      const p = await owner();
      if (p === null) return null;
      const plan = await repo().applied(p.id);
      if (plan === null || plan.applied === null) return null;
      return planRoutines(plan, liveRoutines(await deps.store().repos.routines.listByOwner(p.id))).length === 0 ? null : { planId: plan.id, name: plan.name };
    },

    /** The plan card for one version: every value from the stored plan. Null: the plan isn't Ben's. */
    async card(req: { planId: string; versionN: number }): Promise<PlanCardData | null> {
      const p = await owner();
      if (p === null) return null;
      const plan = await get(req.planId);
      const v = plan?.versions.find((x) => x.n === req.versionN) ?? null;
      if (plan === null || v === null) return null;
      const gym = v.request.gymId === null ? null : await deps.store().repos.gyms.get(v.request.gymId).catch(() => null);
      const routines = await live(p.id);
      const madeIds = new Set(plan.applied?.made.map((m) => m.routineId) ?? []);
      return {
        planId: plan.id,
        versionN: v.n,
        planVersion: plan.version,
        name: `${String(v.days.length)}-day plan`,
        days: planDayLines(v).map((d) => ({ index: d.index, name: d.name, line: `${plural(d.exercises, 'exercise')} · ${plural(d.workingSets, 'set')} · ${String(d.minutes)} min`, leftOut: d.leftOut })),
        rationale: v.rationale,
        gymName: gym?.name ?? null,
        state: stateOf(plan, req.versionN, deps.now().utc, plan.status === 'ended' && (await repo().applied(p.id).catch(() => null)) !== null),
        replaces: rotationRoutines(routines).filter((r) => !madeIds.has(r.id)).map((r) => r.name),
      };
    },

    /** One day of a plan version, for the day view. */
    async day(req: { planId: string; versionN: number; dayIndex: number }): Promise<PlanDayData | null> {
      const plan = await get(req.planId);
      const v = plan?.versions.find((x) => x.n === req.versionN) ?? null;
      const d = v?.days.find((x) => x.index === req.dayIndex) ?? null;
      if (plan === null || v === null || d === null) return null;
      const of = await exerciseOf();
      const made = plan.applied !== null && plan.applied.versionN === v.n ? (plan.applied.made.find((m) => m.dayIndex === d.index)?.routineId ?? null) : null;
      const routine = made === null ? null : await deps.store().repos.routines.get(made).catch(() => null);
      return {
        planId: plan.id,
        versionN: v.n,
        index: d.index,
        name: d.name,
        minutes: d.minutes,
        rows: planDayRows(d, of),
        checks: d.checks.map((c) => c.text),
        routineId: routine !== null && !isDeleted(routine) ? routine.id : null,
      };
    },

    /**
     * Apply (rule 3: Ben's tap on a proposal). `expectedVersion` and
     * `versionN` are the card's: a newer version, or an Apply or Undo since,
     * changes nothing (rule 5). Idempotent by `opId` (minted at the first tap).
     */
    async apply(req: { planId: string; versionN: number; expectedVersion: number; mode: PlanApplyMode; opId: string }): Promise<PlanWriteOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const plan = await get(req.planId);
      if (plan === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const exercises = await exercisesToSave(plan);
      if (exercises === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
      const at = deps.now();
      const r = await repo()
        .apply(p.id, req.planId, (c, routines, applied) => applyPlan(c, { expectedVersion: req.expectedVersion, versionN: req.versionN, mode: req.mode, opId: req.opId, at, live: liveRoutines(routines), applied }), exercises)
        .catch(() => null);
      if (r === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
      switch (r.status) {
        case 'written':
        case 'replayed':
          return { ok: true, plan: r.plan, duplicate: r.status === 'replayed' };
        case 'stale':
          return { ok: false, reason: 'stale', message: PLAN_COPY.stale };
        case 'closed':
          return { ok: false, reason: 'closed', message: PLAN_COPY.closed };
        case 'changed_since':
          return { ok: false, reason: 'changed_since', message: PLAN_COPY.changedSince(r.names) };
        case 'missing':
        case 'invalid':
          return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      }
    },

    /** Undo of an Apply: the setup before it back, only while nothing it touched changed since (rule 2, 5). */
    async undo(req: { planId: string; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const at = deps.now();
      const r = await repo()
        .undo(p.id, req.planId, (c, routines, plans) => undoPlanApply(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, routines, plans }))
        .catch(() => null);
      if (r === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
      switch (r.status) {
        case 'written':
        case 'replayed':
          return { ok: true, plan: r.plan, duplicate: r.status === 'replayed' };
        case 'stale':
          return { ok: false, reason: 'stale', message: PLAN_COPY.stale };
        case 'closed':
          return { ok: false, reason: 'closed', message: PLAN_COPY.closed };
        case 'changed_since':
          return { ok: false, reason: 'changed_since', message: PLAN_COPY.changedSince(r.names) };
        case 'missing':
        case 'invalid':
          return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      }
    },

    /**
     * Library › Plan › Previous (Ben, 22–23 Oct, D7): the plans Ben used before, newest first, each with the
     * stored version `Start again` must find. Local reads only; a failed read throws (never shown as none).
     */
    async previous(): Promise<PreviousPlanRow[]> {
      const p = await owner();
      if (p === null) return [];
      return previousPlans(await repo().listByOwner(p.id), p.id).map((x) => ({ planId: x.planId, planVersion: x.planVersion, name: x.name, line: previousPlanLine(x, p.timezone) }));
    },

    /**
     * `Start again` on a previous plan (until the plan builder ships, which opens with its answers instead):
     * a copy of it applied in `mode`, superseding any plan in use. Its Undo is `undo({ planId: copy })`,
     * which puts the setup before back (the plan in use then, too). `expectedVersion`: the row's (rule 5).
     * Idempotent by `opId` (minted at the tap).
     */
    async startAgain(req: { planId: string; expectedVersion: number; mode: PlanApplyMode; opId: string }): Promise<PlanWriteOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const source = await repo().get(req.planId).catch(() => null);
      if (source === null || source.ownerId !== p.id) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const exercises = await exercisesToSave(source);
      if (exercises === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
      const at = deps.now();
      const r = await repo()
        .restart(p.id, req.planId, restartedPlanIdFor(req.opId), (s, routines, applied) => restartPlan(s, { expectedVersion: req.expectedVersion, mode: req.mode, opId: req.opId, at, live: liveRoutines(routines), applied }), exercises)
        .catch(() => null);
      if (r === null) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
      switch (r.status) {
        case 'written':
        case 'replayed':
          return { ok: true, plan: r.plan, duplicate: r.status === 'replayed' };
        case 'stale':
        case 'closed':
        case 'changed_since':
          return { ok: false, reason: 'stale', message: PLAN_COPY.stale };
        case 'missing':
        case 'invalid':
          return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      }
    },

    /**
     * Library › Workouts › Your plan (Ben, 19 Oct): the plan in use, its
     * goal line from Profile › Training details, each day's state this week
     * (Monday–Sunday in Ben's time zone, from Apply) and Up next, days this
     * week and planned sets done. Null without a plan in use. Local reads only.
     * Throws when the plan or its workouts can't be read (review planview S5: never
     * shown as no plan).
     */
    async overview(): Promise<PlanOverviewWithBlock | null> {
      const p = await owner();
      if (p === null) return null;
      const plan = await repo().applied(p.id);
      if (plan === null || plan.applied === null) return null;
      const days = planRoutines(plan, liveRoutines(await deps.store().repos.routines.listByOwner(p.id)));
      if (days.length === 0) return null;
      const now = deps.now();
      const nowMs = toMs(now.utc);
      const tz = p.timezone;
      const parts = await bodyPartsOf(p.id, days);
      // (27 Oct) Each workout's plan day, so Library › Plan's one list joins the week's days to their workouts.
      const madeDay = new Map(plan.applied.made.map((m) => [m.routineId, m.dayIndex] as const));
      const dayRefs = days.map((r) => ({ routineId: r.id, name: r.name, createdFromSessionId: r.createdFromSessionId ?? null, bodyParts: parts.get(r.id) ?? [], dayIndex: madeDay.get(r.id) ?? planDayOf(r)?.dayIndex ?? null }));
      const from = planWeekStartMs({ appliedAtUtc: plan.applied.atUtc, nowMs, tz });
      const week = await deps.store().repos.sessions.listFinishedBetweenReadable(p.id, toIso(from), toIso(nowMs + 1)).catch(() => ({ sessions: [] as HistoryWorkout[] }));
      // (Ben, 20 Oct) This week's workouts carry the muscles they trained: an off-plan leg day ticks Legs.
      const of = await exerciseOf();
      const groups = new Map(week.sessions.map((a) => [a.session.id, workoutGroupsOf(a, of)]));
      const workouts = (await deps.store().repos.sessions.listFinishedRefs(p.id, 400, { includeImported: true }).catch(() => [])).map((w) => ({ ...w, groups: groups.get(w.sessionId) }));
      const training = await deps.store().repos.trainingProfiles.get(p.id).catch(() => null);
      const gym = (await deps.currentGym?.().catch(() => null)) ?? null;
      const pause = activePause(plan, nowMs, tz);
      const nextRoutineId = pause !== null ? null : ((await deps.upNextRoutineId?.(gym?.id ?? null).catch(() => null)) ?? null);
      const monday = localWeekBounds(nowMs, tz).mondayLocalDate;
      const info = (await deps.weekInfo?.().catch(() => null)) ?? null;
      const view = planOverview({
        activities: info?.lines ?? [],
        weekChange: info?.change ?? null,
        paused: pause === null ? null : { untilDate: pause.untilDate },
        pausedDaysThisWeek: pausedInWeek(monday, pausedDates(plan.pauses, monday, addDays(monday, 7), tz)),
        plan: { id: plan.id, name: plan.name, status: plan.status, version: plan.version, appliedAtUtc: plan.applied.atUtc },
        days: dayRefs,
        workouts,
        nextRoutineId,
        training: training === null ? null : { goal: training.goal, daysPerWeek: training.daysPerWeek, sessionMinutes: training.sessionMinutes },
        sets: plannedSetsThisWeek({ sessions: week.sessions, days: dayRefs, appliedAtUtc: plan.applied.atUtc, nowMs, tz }),
        nowMs,
        tz,
      });
      if (view === null) return null;
      return { ...view, block: await blockOverview(p, plan, workouts, nowMs, tz, of) };
    },

    /** One day of the plan in use (Library › Your plan › a day): its planned sets at this gym and last time's. Null: not a day of it. */
    async planDay(routineId: string, opts: { targetsHit: boolean; week?: number | undefined } = { targetsHit: false }): Promise<PlanDayScreenData | null> {
      const p = await owner();
      if (p === null) return null;
      const plan = await repo().applied(p.id).catch(() => null);
      const days = planRoutines(plan, await live(p.id));
      const at = days.findIndex((r) => r.id === routineId);
      const routine = days[at];
      if (plan === null || routine === undefined) return null;
      const gym = (await deps.currentGym?.().catch(() => null)) ?? null;
      const run = gym === null ? null : ((await deps.plannedDay?.(routine.id, gym.id).catch(() => null)) ?? null);
      const histories = new Map<string, HistoryWorkout[]>();
      for (const exerciseId of run === null ? routine.exercises.map((e) => e.exerciseId) : run.aggregate.exercises.map((e) => e.exerciseId)) {
        if (histories.has(exerciseId)) continue;
        histories.set(exerciseId, await deps.store().repos.sessions.listFinishedWithExercise(p.id, exerciseId).catch(() => []));
      }
      const history = (id: string) => histories.get(id) ?? [];
      // `Targets hit` (Ben, 20 Oct): with the setting on, only on the split's main lifts (Profile), never a workout's `Main` flags.
      const mains = opts.targetsHit ? await splitMainLifts() : new Set<string>();
      const targetsHit = (id: string) => showsTargetsHit({ on: opts.targetsHit, main: isMainLift(id, mains) });
      const detail =
        run === null
          ? planDayFromTemplates({ dayN: at + 1, of: days.length, gymName: gym?.name ?? null, routine, exerciseOf: await exerciseOf(), unit: p.preferredUnit, history, targetsHit })
          : planDayDetail({ dayN: at + 1, of: days.length, gymName: gym?.name ?? null, aboutMinutes: run.aboutMinutes, planned: run.aggregate, history, targetsHit });
      const status = run !== null ? 'planned' : gym === null ? 'no_gym' : 'not_here';
      const nowMs = toMs(deps.now().utc);
      // Pinned while no workout since the pin did that day (as Up next reads it).
      let pinned = false;
      if (plan.pin?.routineId === routine.id) {
        const parts = await bodyPartsOf(p.id, days);
        // Every finished workout since the pin, read as Up next reads it (review plan-adapt S3).
        const r = await deps.store().repos.sessions.listFinishedBetweenReadable(p.id, plan.pin.atUtc, toIso(nowMs + 1)).catch(() => ({ sessions: [] as HistoryWorkout[] }));
        const of = await exerciseOf();
        const ws: PlanDueWorkout[] = r.sessions.map((a) => ({ sessionId: a.session.id, routineId: a.session.routineId ?? null, startedAtUtc: a.session.startedAt.utc, groups: workoutGroupsOf(a, of) }));
        pinned = activePin(plan.pin, days.map((r) => ({ routineId: r.id, name: r.name, bodyParts: parts.get(r.id) ?? [], createdFromSessionId: r.createdFromSessionId ?? null })), ws) !== null;
      }
      const week = opts.week === undefined ? null : await weekOfDay(p, plan, routine, opts.week, nowMs);
      return { planId: plan.id, routineId: routine.id, name: routine.name, dayN: at + 1, of: days.length, header: detail.header, rows: detail.rows, status, planVersion: plan.version, pinned, paused: activePause(plan, nowMs, p.timezone) !== null, week };
    },

    /**
     * `End plan` (Ben's tap, after the in-page confirm): the plan's days leave
     * the rotation (kept, with their history); Up next falls back to the
     * normal rules. `expectedVersion`: the block's read (rule 5). Idempotent by `opId`.
     */
    async end(req: { planId: string; expectedVersion: number; opId: string }): Promise<PlanEndOutcome> {
      const at = deps.now();
      const r = await endWrite(req.planId, (c, routines) => endPlan(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, routines }));
      return r.ok ? { ...r, notRestored: (r.plan.ended?.notRestored ?? []).map((x) => x.name) } : r;
    },

    /**
     * (Ben, 20 Oct) `Make next` on a plan day (null: unpin): Up next starts it until it is done. `expectedVersion`:
     * the screen's read (rule 5). Idempotent by `opId`; `undoControl` is its Undo.
     */
    async makeNext(req: { planId: string; routineId: string | null; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      const at = deps.now();
      return controlWrite(req.planId, (c, routines) => pinPlanDay(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, routineId: req.routineId, days: planRoutines(c, liveRoutines(routines)) }));
    },

    /** (Ben, 20 Oct) `Pause plan`: until `untilDate` (local `YYYY-MM-DD`) starts, or until Resume (null). */
    async pause(req: { planId: string; untilDate: string | null; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      const p = await owner();
      const at = deps.now();
      return controlWrite(req.planId, (c) => pausePlan(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, untilDate: req.untilDate, tz: p?.timezone ?? at.tz }));
    },

    /** (Ben, 20 Oct) `Resume`: the plan drives Up next again at once. */
    async resumePause(req: { planId: string; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      const p = await owner();
      const at = deps.now();
      return controlWrite(req.planId, (c) => resumePlan(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, tz: p?.timezone ?? at.tz }));
    },

    /** Undo of the last `Make next`, pause or resume (`targetOpId`), from the version it left (`expectedVersion`). */
    async undoControl(req: { planId: string; targetOpId: string; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      const at = deps.now();
      return controlWrite(req.planId, (c) => undoPlanControl(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, targetOpId: req.targetOpId }));
    },

    /**
     * (Ben, 20 Oct) On app open: a pause whose `until` date has come is ended (at that date's start). Idempotent: the op
     * ID is the pause's own, so two opens write it once. Returns whether it wrote.
     */
    async autoResume(): Promise<boolean> {
      const p = await owner();
      if (p === null) return false;
      const plan = await repo().applied(p.id).catch(() => null);
      const at = deps.now();
      const due = autoResumeDue(plan, toMs(at.utc), p.timezone);
      if (plan === null || due === null) return false;
      const r = await controlWrite(plan.id, (c) => resumePlan(c, { expectedVersion: c.version, opId: `plan-auto-resume:${due.opId}`, at, tz: p.timezone, auto: true }));
      return r.ok && !r.duplicate;
    },

    /**
     * (Ben, 26 Oct: Edit plan) On app open and on Library › Your plan: a new block week's version takes over the plan's
     * workouts (a change `from week N` or `only week N` starts or ends). Idempotent; writes only when a day's version
     * changes. Returns whether it wrote.
     */
    async syncWeek(): Promise<boolean> {
      const p = await owner();
      if (p === null) return false;
      const plan = await repo().applied(p.id).catch(() => null);
      if (plan?.weekVersions === undefined) return false;
      const at = deps.now();
      const eb = editBlockOf(await readPlanBlock(deps.store(), p.id, plan, toMs(at.utc), p.timezone));
      const b = pbAppliedBuilder(plan);
      if (eb === null || b === null) return false;
      const r = await repo().edit(p.id, plan.id, (c, routines) => syncPlanWeek(c, { at, block: eb, weeks: b.builder.answers.weeks, routines })).catch(() => null);
      return r?.status === 'written';
    },

    /**
     * (Ben, 26 Oct) `Move day` on a plan day, this week only (Set days plans): Legs → Sat. Refused when that weekday
     * holds another plan day or the day is done this week. `expectedVersion`: Your plan's read (rule 5); idempotent by
     * `opId`; `undoMove` is its Undo.
     */
    async moveDay(req: { planId: string; dayIndex: number; weekday: number; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const plan = await repo().get(req.planId).catch(() => null);
      if (plan === null || plan.ownerId !== p.id) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const at = deps.now();
      const eb = editBlockOf(await readPlanBlock(deps.store(), p.id, plan, toMs(at.utc), p.timezone));
      if (eb === null) return { ok: false, reason: 'stale', message: PLAN_COPY.stale };
      const r = await repo().move(p.id, req.planId, (c) => movePlanDay(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, block: eb, dayIndex: req.dayIndex, weekday: req.weekday })).catch(() => null);
      return moveOutcome(r);
    },

    async undoMove(req: { planId: string; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      const p = await owner();
      if (p === null) return { ok: false, reason: 'missing', message: PLAN_COPY.missing };
      const at = deps.now();
      const r = await repo().move(p.id, req.planId, (c) => undoMovePlanDay(c, { expectedVersion: req.expectedVersion, opId: req.opId, at })).catch(() => null);
      return moveOutcome(r);
    },

    /** The `Plan ended` toast's Undo: the plan in use again, its days back in their places (refused if a newer plan is in use or a day changed since). */
    async resume(req: { planId: string; expectedVersion: number; opId: string }): Promise<PlanWriteOutcome> {
      const at = deps.now();
      return endWrite(req.planId, (c, routines, otherApplied) => undoEndPlan(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, routines, otherApplied }));
    },

    /**
     * `Consistency` on Progress (plan tracker v1): the last 8 weeks against
     * Profile's days-a-week aim (none: counts only) and, with a plan, its
     * days done this week. Counts from finished workouts only.
     */
    async consistency(): Promise<ConsistencyView | null> {
      const p = await owner();
      if (p === null) return null;
      // (Perf, Ben 26 Oct) Kept while nothing is written and the day is the same: a return to Progress reads nothing.
      return consistencyMemo.get(deps.store(), `${p.id}|${p.timezone}|${localDateOf(toMs(deps.now().utc), p.timezone)}`, () => readConsistency(p));
    },
  };

  async function readConsistency(p: UserProfile): Promise<ConsistencyView | null> {
      const now = deps.now();
      const nowMs = toMs(now.utc);
      const from = nowMs - 10 * 7 * 86_400_000;
      // Workouts with a set done, FitNotes imports included (they are his workouts too); deleted ones aren't.
      const refs = (await deps.store().repos.sessions.listFinishedRefs(p.id, 400, { includeImported: true }).catch(() => [])).filter((r) => toMs(r.startedAtUtc) >= from);
      const training = await deps.store().repos.trainingProfiles.get(p.id).catch(() => null);
      const plan = await active();
      // (Ben, 20 Oct) Paused days don't count against the aim: every plan's pauses (one ended since still paused those
      // days), none past the day its plan stopped being in use (review plan-adapt B1).
      const tz = p.timezone;
      const firstMonday = localWeekBounds(from, tz).mondayLocalDate;
      const end = addDays(localWeekBounds(nowMs, tz).mondayLocalDate, 7);
      const paused = new Set<string>();
      for (const d of await repo().listByOwner(p.id).catch(() => [] as PlanDraft[])) {
        if (d.applied === null || (d.pauses ?? []).length === 0) continue;
        for (const x of pausedDates(d.pauses, firstMonday, end, tz, planInUseUntilUtc(d))) paused.add(x);
      }
      const weekStart = plan === null ? nowMs : planWeekStartMs({ appliedAtUtc: plan.appliedAtUtc, nowMs, tz });
      const groups = plan === null ? new Map<string, ReadonlyMap<MuscleGroup, number>>() : await groupedWorkouts(p.id, weekStart, nowMs);
      const parts = plan === null ? new Map<string, SplitBodyPart[]>() : await bodyPartsOf(p.id, (await live(p.id)).filter((r) => plan.days.some((d) => d.routineId === r.id)));
      return consistency({
        workouts: refs.map((r) => ({ sessionId: r.sessionId, routineId: r.routineId, startedAtUtc: r.startedAtUtc, groups: groups.get(r.sessionId) })),
        nowMs,
        tz,
        aim: training?.daysPerWeek ?? null,
        plan: plan === null ? null : { days: plan.days.map((d) => ({ ...d, bodyParts: parts.get(d.routineId) ?? [] })), appliedAtUtc: plan.appliedAtUtc },
        pausedDates: paused,
      });
  }
}

export type PlanServices = ReturnType<typeof createPlanServices>;

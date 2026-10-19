import {
  applyPlan,
  consistency,
  currentPlanVersion,
  isDeleted,
  liveRoutines,
  planDayLines,
  planDayRows,
  planIsOpen,
  planRoutines,
  rotationRoutines,
  toMs,
  undoPlanApply,
  type ConsistencyView,
  type PlanDayRow,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { Exercise, PlanApplyMode, PlanDraft, Routine, UserProfile, ZonedTimestamp } from '@fizz/schemas';

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
}

export type PlanCardState =
  | { kind: 'open' }
  /** Applied (this version): Undo while it is the plan in use. */
  | { kind: 'applied'; mode: PlanApplyMode; atUtc: string }
  /** A newer version of the same plan exists: this card can't apply (rule 5). */
  | { kind: 'replaced'; byN: number }
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
  changedSince: (names: readonly string[]) => `Can’t undo: ${names.join(', ')} changed since.`,
} as const;

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

export function createPlanServices(deps: PlanServicesDeps) {
  const repo = () => deps.store().repos.planDrafts;

  async function owner(): Promise<UserProfile | null> {
    return deps.profile();
  }

  async function exerciseOf(): Promise<(id: string) => Exercise | null> {
    const pool = new Map<string, Exercise>();
    for (const e of await deps.store().repos.exercises.list().catch(() => [] as Exercise[])) pool.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!pool.has(e.id)) pool.set(e.id, e);
    return (id) => pool.get(id) ?? null;
  }

  /** Ben's plan by ID (expired on read past its 14 days while open). */
  async function get(planId: string): Promise<PlanDraft | null> {
    const p = await owner();
    if (p === null) return null;
    await repo().expire(p.id, deps.now().utc).catch(() => []);
    const plan = await repo().get(planId).catch(() => null);
    return plan !== null && plan.ownerId === p.id ? plan : null;
  }

  function stateOf(plan: PlanDraft | null, versionN: number, nowUtc: string): PlanCardState {
    if (plan === null) return { kind: 'gone' };
    if (plan.status === 'expired' || plan.status === 'discarded' || (plan.status === 'open' && !planIsOpen(plan, nowUtc))) return { kind: 'expired' };
    if (plan.currentVersion !== versionN) return { kind: 'replaced', byN: plan.currentVersion };
    if (plan.status === 'applied' && plan.applied !== null) return { kind: 'applied', mode: plan.applied.mode, atUtc: plan.applied.atUtc };
    return { kind: 'open' };
  }

  async function live(ownerId: string): Promise<Routine[]> {
    return liveRoutines(await deps.store().repos.routines.listByOwner(ownerId).catch(() => [] as Routine[]));
  }

  /** Every catalogue exercise a plan names is saved as Ben's row before a workout uses it (as `Add exercise` does). */
  async function ensureExercises(plan: PlanDraft): Promise<boolean> {
    const ids = new Set(currentPlanVersion(plan).days.flatMap((d) => d.plan.slots.map((s) => s.exerciseId)));
    const catalogue = new Map((deps.catalogueExercises?.() ?? []).map((e) => [e.id, e]));
    for (const id of ids) {
      if ((await deps.store().repos.exercises.get(id).catch(() => null)) !== null) continue;
      const row = catalogue.get(id);
      if (row === undefined) return false;
      await deps.store().repos.exercises.save(row, null).catch(() => null);
      if ((await deps.store().repos.exercises.get(id).catch(() => null)) === null) return false;
    }
    return true;
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

  return {
    get,
    active,

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
        state: stateOf(plan, req.versionN, deps.now().utc),
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
      if (!(await ensureExercises(plan))) return { ok: false, reason: 'failed', message: PLAN_COPY.failed };
      const at = deps.now();
      const r = await repo()
        .apply(p.id, req.planId, (c, routines) => applyPlan(c, { expectedVersion: req.expectedVersion, versionN: req.versionN, mode: req.mode, opId: req.opId, at, live: liveRoutines(routines) }))
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
        .undo(p.id, req.planId, (c, routines) => undoPlanApply(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, routines }))
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
     * `Consistency` on Progress (plan tracker v1): the last 8 weeks against
     * Profile's days-a-week aim (none: counts only) and, with a plan, its
     * days done this week. Counts from finished workouts only.
     */
    async consistency(): Promise<ConsistencyView | null> {
      const p = await owner();
      if (p === null) return null;
      const now = deps.now();
      const nowMs = toMs(now.utc);
      const from = nowMs - 10 * 7 * 86_400_000;
      // Workouts with a set done, FitNotes imports included (they are his workouts too); deleted ones aren't.
      const refs = (await deps.store().repos.sessions.listFinishedRefs(p.id, 400, { includeImported: true }).catch(() => [])).filter((r) => toMs(r.startedAtUtc) >= from);
      const training = await deps.store().repos.trainingProfiles.get(p.id).catch(() => null);
      const plan = await active();
      return consistency({
        workouts: refs.map((r) => ({ sessionId: r.sessionId, routineId: r.routineId, startedAtUtc: r.startedAtUtc })),
        nowMs,
        tz: p.timezone,
        aim: training?.daysPerWeek ?? null,
        plan: plan === null ? null : { days: plan.days, appliedAtUtc: plan.appliedAtUtc },
      });
    },
  };
}

export type PlanServices = ReturnType<typeof createPlanServices>;

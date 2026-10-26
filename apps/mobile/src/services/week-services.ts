import {
  ACTIVITY_COPY,
  activeWeekPlan,
  activePause,
  activityRow,
  activityStatusOn,
  activitySortMs,
  addActivity,
  addDays,
  applyWeekPlan,
  deleteActivity,
  editActivity,
  healthActivityOf,
  isInHistory,
  liveRoutines,
  localDateOf,
  localWeekBounds,
  mergedExercises,
  planDayBodyParts,
  planPace,
  plannedDaySeconds,
  planDaysDoneThisWeek,
  planRoutines,
  routineFromSession,
  splitDaysTrained,
  splitInUse,
  splitWorkoutOf,
  suggestWeek,
  toIso,
  toMs,
  undoActivity,
  undoWeekPlan,
  weekActivityLine,
  weekChangeText,
  weekDays,
  weekDaysRemoved,
  weekFacts,
  weekFactsKey,
  isSplitDayName,
  SPLIT_WINDOW_DAYS,
  dateWeekdayShort,
  activityDetail,
  ACTIVITY_WORD,
  type ActivityChange,
  type ActivityRow,
  type WeekDayInput,
  type WeekFacts,
  type WeekProposal,
  type HistoryWorkout,
} from '@fizz/domain';
import type { ActivityWrite, Store } from '@fizz/persistence';
import type { ActionRecord, Activity, ActivityFields, Exercise, PlanDraft, Routine, RoutineExercise, SessionAggregate, SplitBodyPart, SplitDay, TrainingProfile, UserProfile, WeekBasis, WeekPlan, ZonedTimestamp } from '@fizz/schemas';

/**
 * (Ben, 20 Oct: "Can we add ability to flex ordering and sessions etc subject
 * to week have eg if I did or have planned a long run maybe we swap to a push
 * rather than shoulder and chest separately") Activities and this week's
 * shape. Local only: logging an activity never waits on the network or the
 * coach (rule 1). Every write is versioned and idempotent on its op ID
 * (rule 5) with Undo (rule 2). The screens never compute the week, a merge
 * or the run rule themselves.
 *
 * - `activities`: add / edit / delete / Undo, Today's Recent rows, a day's
 *   rows for the calendar, this week's lines for Your plan.
 * - `week`: this week's facts (gym days left against the days left, plan or
 *   split), the coach's proposal card state, Apply (the change and its merged
 *   day in one write, stale when the week moved on) and Undo.
 */

export interface WeekServicesDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  newId: () => string;
  catalogueExercises?: () => readonly Exercise[];
  /** The selected gym's ID (a merged day's loads are what each day would plan there); null: none set up. */
  currentGymId?: () => Promise<string | null>;
  /** What Start would create for a workout at a gym (a dry run, saves nothing). */
  plannedDay?: (routineId: string, gymId: string) => Promise<{ aggregate: SessionAggregate } | null>;
}

/**
 * A day's exercises with each working set's load set to what Start would plan for it at this gym today (snapped to
 * the gym's real equipment, rule 4), so the merged day starts from the same loads as its two days would. Sets with no
 * planned load stay as they were.
 */
function withPlannedLoads(exercises: readonly RoutineExercise[], planned: SessionAggregate | null): RoutineExercise[] {
  if (planned === null) return [...exercises];
  return exercises.map((e) => {
    const row = planned.exercises.find((x) => x.exerciseId === e.exerciseId && x.removed === undefined);
    if (row === undefined) return e;
    const loads = planned.sets
      .filter((x) => x.sessionExerciseId === row.id && x.setType !== 'warmup' && x.status !== 'deleted' && x.pairedWithSetId === null)
      .sort((a, b) => a.index - b.index)
      .map((x) => x.planned.load);
    let i = 0;
    return {
      ...e,
      setTemplates: e.setTemplates.map((t) => {
        if (t.setType === 'warmup') return t;
        const load = loads[i] ?? null;
        i += 1;
        return load === null || t.targetLoad !== null ? t : { ...t, targetLoad: load };
      }),
    };
  });
}

export type ActivityOutcome = { ok: true; activity: Activity; duplicate: boolean } | { ok: false; reason: 'stale' | 'invalid' | 'missing' | 'failed'; message: string };

export const ACTIVITY_FAIL = {
  stale: 'Changed since. Nothing saved.',
  invalid: 'Add a time, a distance or an effort.',
  missing: 'Not found.',
  failed: 'Couldn’t save. Try again.',
} as const;

/** A day of this week, as the facts and Apply read it. */
interface WeekDay extends WeekDayInput {
  routine: Routine | null;
  splitDay: SplitDay | null;
}

export interface WeekState {
  monday: string;
  today: string;
  basis: WeekBasis;
  days: WeekDay[];
  facts: WeekFacts;
  factsKey: string;
  active: WeekPlan | null;
  activities: Activity[];
}

/** The coach's week proposal card: what Ben can do with it now. */
export type WeekCardState =
  | { kind: 'open' }
  | { kind: 'applied'; weekPlanId: string; version: number }
  | { kind: 'undone' }
  /** The week moved on since (a workout, an activity, the plan): Apply would write nothing (rule 5). */
  | { kind: 'stale' }
  /** Its week is over. */
  | { kind: 'expired' }
  | { kind: 'gone' };

export interface WeekCard {
  actionId: string;
  scope: 'This week';
  before: { name: string; note: string | null }[];
  after: { name: string; note: string | null }[];
  state: WeekCardState;
}

export type WeekWriteOutcome = { ok: true; week: WeekPlan; duplicate: boolean } | { ok: false; reason: 'stale' | 'invalid' | 'missing' | 'failed'; message: string };

export const WEEK_COPY = {
  scope: 'This week',
  apply: 'Apply',
  undo: 'Undo',
  applied: 'This week changed',
  undone: 'Back to your plan',
  stale: 'Out of date. Nothing changed.',
  failed: 'Couldn’t change this week. Try again.',
} as const;

export function createWeekServices(deps: WeekServicesDeps) {
  const repos = () => deps.store().repos;

  async function exerciseOf(): Promise<(id: string) => Exercise | null> {
    const pool = new Map<string, Exercise>();
    for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) pool.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!pool.has(e.id)) pool.set(e.id, e);
    return (id) => pool.get(id) ?? null;
  }

  function outcome(r: ActivityWrite): ActivityOutcome {
    switch (r.status) {
      case 'written':
      case 'replayed':
        return { ok: true, activity: r.activity, duplicate: r.status === 'replayed' };
      case 'stale':
        return { ok: false, reason: 'stale', message: ACTIVITY_FAIL.stale };
      case 'invalid':
        return { ok: false, reason: 'invalid', message: ACTIVITY_FAIL.invalid };
      case 'missing':
        return { ok: false, reason: 'missing', message: ACTIVITY_FAIL.missing };
    }
  }

  async function change(activityId: string, make: (current: Activity) => ActivityChange): Promise<ActivityOutcome> {
    const p = await deps.profile();
    if (p === null) return { ok: false, reason: 'missing', message: ACTIVITY_FAIL.missing };
    const r = await repos()
      .activities.change(p.id, activityId, make)
      .catch(() => null);
    return r === null ? { ok: false, reason: 'failed', message: ACTIVITY_FAIL.failed } : outcome(r);
  }

  /** Live activities from `from` to `to` (local dates, `to` exclusive). */
  async function between(ownerId: string, from: string, to: string): Promise<Activity[]> {
    return repos()
      .activities.listBetween(ownerId, from, to)
      .catch(() => [] as Activity[]);
  }

  // -------------------------------------------------------------------------
  // This week

  /** The plan in use and not paused, else null (the split's days then). */
  async function planInUse(p: UserProfile, nowMs: number): Promise<PlanDraft | null> {
    const plan = await repos()
      .planDrafts.applied(p.id)
      .catch(() => null);
    if (plan === null || plan.applied === null) return null;
    return activePause(plan, nowMs, p.timezone) === null ? plan : null;
  }

  async function state(p: UserProfile): Promise<WeekState> {
    const now = deps.now();
    const nowMs = toMs(now.utc);
    const tz = p.timezone;
    const today = localDateOf(nowMs, tz);
    const { mondayLocalDate: monday, startMs } = localWeekBounds(nowMs, tz);
    const of = await exerciseOf();
    const training = await repos()
      .trainingProfiles.get(p.id)
      .catch(() => null);
    const split = splitInUse(training);
    const { sessions } = await repos()
      .sessions.listFinishedBetweenReadable(p.id, toIso(startMs), toIso(nowMs + 1))
      .catch(() => ({ sessions: [] as HistoryWorkout[] }));
    const thisWeek = sessions.filter((a) => isInHistory(a.session));
    const gymDates = new Set(thisWeek.map((a) => localDateOf(toMs(a.session.startedAt.utc), tz)));
    const workouts = thisWeek.map((a) => ({ sessionId: a.session.id, routineId: a.session.routineId ?? null, startedAtUtc: a.session.startedAt.utc, groups: splitWorkoutOf(a, of, null).groups }));
    const plan = await planInUse(p, nowMs);
    const routines = await repos()
      .routines.listByOwner(p.id)
      .catch(() => [] as Routine[]);
    const planDays = plan === null ? [] : planRoutines(plan, liveRoutines(routines));
    const basis: WeekBasis = plan !== null && planDays.length > 0 ? { kind: 'plan', planId: plan.id, planVersion: plan.version } : { kind: 'split' };
    let days: WeekDay[];
    if (basis.kind === 'plan' && plan?.applied != null) {
      const refs = planDays.map((r) => ({ routineId: r.id, name: r.name, createdFromSessionId: r.createdFromSessionId ?? null, bodyParts: planDayBodyParts(r, of, split) }));
      const done = planDaysDoneThisWeek({ days: refs, appliedAtUtc: plan.applied.atUtc, workouts, nowMs, tz });
      days = planDays.map((r, i) => ({ id: r.id, name: r.name, bodyParts: refs[i]?.bodyParts ?? [], done: done.has(r.id), routine: r, splitDay: null }));
    } else {
      const done = new Set(workouts.flatMap((w) => splitDaysTrained(split, w.groups)));
      days = split.days.map((d) => ({ id: d.id, name: d.name, bodyParts: [...d.bodyParts], done: done.has(d.id), routine: null, splitDay: d }));
    }
    const weekPlans = await repos()
      .weekPlans.listForWeek(p.id, monday)
      .catch(() => [] as WeekPlan[]);
    const active = activeWeekPlan(weekPlans, nowMs, tz, (b) => (b.kind === 'plan' ? basis.kind === 'plan' && b.planId === basis.planId : basis.kind === 'split'));
    if (active !== null) {
      // This week's days with the change in place: a merged day is done once a workout from it is.
      const made = new Map(active.made.map((m, i) => [i, routines.find((r) => r.id === m.routineId && (r.deletedAtUtc ?? null) === null) ?? null]));
      days = weekDays(days, (d) => d.id, active, (i) => {
        const r = made.get(i) ?? null;
        const m = active.merges[i];
        if (r === null || m === undefined) return null;
        const parts = [...new Set(days.filter((d) => m.dayIds.includes(d.id)).flatMap((d) => d.bodyParts))] as SplitBodyPart[];
        return { id: r.id, name: r.name, bodyParts: parts, done: workouts.some((w) => w.routineId === r.id), routine: r, splitDay: null };
      });
    }
    const activities = await between(p.id, addDays(monday, -1), addDays(monday, 8));
    const facts = weekFacts({ today, nowMs, tz, aim: training?.daysPerWeek ?? null, gymDates, days, activities });
    const factsKey = weekFactsKey({ monday, basisKey: basis.kind === 'plan' ? `plan:${basis.planId}:${String(basis.planVersion)}` : 'split', workoutIds: workouts.map((w) => w.sessionId), activities: activities.filter((a) => a.fields.date >= monday && a.fields.date < addDays(monday, 7)) });
    return { monday, today, basis, days, facts, factsKey, active, activities };
  }

  /** A day's exercises for a merge: its own workout (a plan day), else the split day's workout or newest workout of it. */
  async function dayExercises(p: UserProfile, day: WeekDay, training: TrainingProfile | null, at: ZonedTimestamp): Promise<RoutineExercise[]> {
    if (day.routine !== null) {
      const gymId = (await deps.currentGymId?.().catch(() => null)) ?? null;
      const planned = gymId === null ? null : ((await deps.plannedDay?.(day.routine.id, gymId).catch(() => null)) ?? null);
      return withPlannedLoads(day.routine.exercises, planned?.aggregate ?? null);
    }
    const split = splitInUse(training);
    const sd = day.splitDay;
    if (sd === null) return [];
    const live = liveRoutines(
      await repos()
        .routines.listByOwner(p.id)
        .catch(() => [] as Routine[]),
    );
    const named = live.find((r) => isSplitDayName(r.name, sd.name));
    if (named !== undefined) return named.exercises;
    const nowMs = toMs(at.utc);
    const { sessions } = await repos()
      .sessions.listFinishedBetweenReadable(p.id, toIso(nowMs - SPLIT_WINDOW_DAYS * 86_400_000), toIso(nowMs + 1))
      .catch(() => ({ sessions: [] as HistoryWorkout[] }));
    const of = await exerciseOf();
    const newest = [...sessions].sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc)).find((a) => splitDaysTrained(split, splitWorkoutOf(a, of, null).groups).includes(sd.id));
    if (newest === undefined) return [];
    // Last time's loads (done on real equipment) for this one week; an imported workout's stay unset.
    const r = routineFromSession({ id: deps.newId(), ownerId: p.id, name: sd.name, opId: 'merge-read', source: newest, at, newId: deps.newId, keepLoads: true, isCompound: (id) => of(id)?.mechanic === 'compound' });
    return r?.exercises ?? [];
  }

  /** Review S4: Up next's `about N min` for a day's exercises (`plannedDaySeconds` at Ben's pace over his last 5 workouts). */
  async function dayEstimator(p: UserProfile, exercises: readonly RoutineExercise[], at: ZonedTimestamp): Promise<(exs: readonly RoutineExercise[]) => number> {
    const of = await exerciseOf();
    const pool = new Map<string, Exercise>();
    for (const e of exercises) {
      const x = of(e.exerciseId);
      if (x !== null) pool.set(x.id, x);
    }
    const recent: SessionAggregate[] = [];
    for (const ref of await repos()
      .sessions.listFinishedRefs(p.id, 5)
      .catch(() => [])) {
      const x = await repos()
        .sessions.get(ref.sessionId)
        .catch(() => null);
      if (x !== null) recent.push(x);
    }
    const pace = planPace(recent);
    return (exs) => plannedDaySeconds(exs, { owner: p, exercises: pool, pace, at });
  }

  async function proposalOf(actionId: string): Promise<(ActionRecord & { detail: Extract<ActionRecord['detail'], { kind: 'propose_week' }> }) | null> {
    const r = await repos()
      .coach.getAction(actionId)
      .catch(() => null);
    if (r === null || r.detail.kind !== 'propose_week' || r.status !== 'proposed') return null;
    return r as ActionRecord & { detail: Extract<ActionRecord['detail'], { kind: 'propose_week' }> };
  }

  const activities = {
    /** Today › ＋ Activity, or the edit sheet's Save on a new one. `id`: the sheet's own (a double tap saves once). */
    async add(req: { id: string; fields: ActivityFields; opId: string }): Promise<ActivityOutcome> {
      const p = await deps.profile();
      if (p === null) return { ok: false, reason: 'missing', message: ACTIVITY_FAIL.missing };
      const c = addActivity({ id: req.id, ownerId: p.id, fields: req.fields, source: 'ben', opId: req.opId, at: deps.now() });
      const r = await repos()
        .activities.add(p.id, c)
        .catch(() => null);
      return r === null ? { ok: false, reason: 'failed', message: ACTIVITY_FAIL.failed } : outcome(r);
    },
    edit: (req: { activityId: string; expectedVersion: number; fields: ActivityFields; opId: string }): Promise<ActivityOutcome> => change(req.activityId, (c) => editActivity(c, { expectedVersion: req.expectedVersion, opId: req.opId, at: deps.now(), fields: req.fields })),
    remove: (req: { activityId: string; expectedVersion: number; opId: string }): Promise<ActivityOutcome> => change(req.activityId, (c) => deleteActivity(c, { expectedVersion: req.expectedVersion, opId: req.opId, at: deps.now() })),
    /** The toast's Undo of the last add, edit or delete (`targetOpId`). */
    undo: (req: { activityId: string; targetOpId: string; opId: string }): Promise<ActivityOutcome> => change(req.activityId, (c) => undoActivity(c, { opId: req.opId, at: deps.now(), targetOpId: req.targetOpId })),
    async get(activityId: string): Promise<Activity | null> {
      const p = await deps.profile();
      const a = await repos()
        .activities.get(activityId)
        .catch(() => null);
      if (a === null && p !== null) {
        // (ADR 0035) An activity read from Apple Health: read-only, built from its sample.
        const sample = await repos()
          .health.workoutSample(p.id, activityId)
          .catch(() => null);
        return sample === null ? null : healthActivityOf(sample, p.id);
      }
      return a !== null && p !== null && a.ownerId === p.id && a.deletedAtUtc === null ? a : null;
    },
    /** Live activities dated in [`from`, `to`) (local dates): the morning reminder's run rule. Unreadable: none. */
    async between(from: string, to: string): Promise<Activity[]> {
      const p = await deps.profile();
      return p === null ? [] : between(p.id, from, to);
    },
    /** Today's Recent: done in the last 14 days and planned in the next 7, with each one's sort instant. */
    async recent(): Promise<(ActivityRow & { sortMs: number })[]> {
      const p = await deps.profile();
      if (p === null) return [];
      const today = localDateOf(toMs(deps.now().utc), p.timezone);
      return (await between(p.id, addDays(today, -14), addDays(today, 8))).map((a) => ({ ...activityRow(a, today), sortMs: activitySortMs(a) }));
    },
    /** Progress › Calendar: a month's activities by local date. */
    async month(month: string): Promise<Record<string, ActivityRow[]>> {
      const p = await deps.profile();
      if (p === null) return {};
      const today = localDateOf(toMs(deps.now().utc), p.timezone);
      const out: Record<string, ActivityRow[]> = {};
      for (const a of await between(p.id, `${month}-01`, `${month}-32`)) (out[a.fields.date] ??= []).push(activityRow(a, today));
      return out;
    },
    /** Your plan's week: `Run · Sat · long`, Monday to Sunday. */
    async weekLines(): Promise<string[]> {
      const p = await deps.profile();
      if (p === null) return [];
      const { mondayLocalDate: monday } = localWeekBounds(toMs(deps.now().utc), p.timezone);
      return (await between(p.id, monday, addDays(monday, 7))).map(weekActivityLine);
    },
  };

  const week = {
    /** This week's facts for the coach and Your plan. Null without a profile. */
    async state(): Promise<WeekState | null> {
      const p = await deps.profile();
      return p === null ? null : state(p);
    },

    /** The coach's YOUR DATA `week` view (rule 6: only what was logged). */
    async contextView() {
      const p = await deps.profile();
      if (p === null) return null;
      const s = await state(p);
      const training = await repos()
        .trainingProfiles.get(p.id)
        .catch(() => null);
      const suggestion = s.facts.needsReshape ? suggestWeek(s.facts) : null;
      return {
        today: s.today,
        weekday: dateWeekdayShort(s.today),
        aim: training?.daysPerWeek ?? null,
        gymDaysDone: s.facts.gymDaysDone,
        gymDaysLeft: s.facts.gymDaysLeft,
        daysFrom: s.basis.kind,
        remaining: s.facts.remaining.map((d) => ({ id: d.id, name: d.name, bodyParts: [...d.bodyParts] })),
        activities: s.activities.map((a) => [ACTIVITY_WORD[a.fields.kind], `${dateWeekdayShort(a.fields.date)} ${a.fields.date}`, activityStatusOn(a, s.today), activityDetail(a.fields).replaceAll(' ', ' '), a.health === undefined ? '' : `from Apple Health (${a.health.label}, ${a.health.sourceName})`].filter((x) => x !== '').join(' · ')),
        needsReshape: s.facts.needsReshape && s.active === null,
        suggestion: suggestion === null || suggestion.merges.length === 0 ? null : { merges: suggestion.merges.map((m) => ({ dayIds: [...m.dayIds], name: m.name })) },
        applied: s.active === null ? null : weekChangeText(s.active),
      } as const;
    },

    /** The coach's week card: before/after, `This week`, and what Ben can do now. */
    async card(actionId: string): Promise<WeekCard | null> {
      const p = await deps.profile();
      if (p === null) return null;
      const r = await repos()
        .coach.getAction(actionId)
        .catch(() => null);
      if (r === null || r.detail.kind !== 'propose_week') return null;
      const d = r.detail;
      const base = { actionId, scope: WEEK_COPY.scope, before: d.before, after: d.after } as const;
      const made = await repos()
        .weekPlans.byProposal(p.id, actionId)
        .catch(() => null);
      if (made !== null) return { ...base, state: made.status === 'applied' ? { kind: 'applied', weekPlanId: made.id, version: made.version } : { kind: 'undone' } };
      if (r.status !== 'proposed') return { ...base, state: { kind: 'gone' } };
      const s = await state(p);
      if (s.monday !== d.weekMonday) return { ...base, state: { kind: 'expired' } };
      return { ...base, state: s.factsKey === d.factsKey && s.active === null ? { kind: 'open' } : { kind: 'stale' } };
    },

    /**
     * Apply (Ben's tap on the proposal): the week change and each merged day's workout in one write,
     * refused as stale when the week moved on since the proposal (rule 5). A double tap applies once.
     */
    async apply(req: { actionId: string; opId: string }): Promise<WeekWriteOutcome> {
      const p = await deps.profile();
      if (p === null) return { ok: false, reason: 'missing', message: WEEK_COPY.failed };
      const r = await proposalOf(req.actionId);
      if (r === null) return { ok: false, reason: 'missing', message: WEEK_COPY.failed };
      const at = deps.now();
      const s = await state(p);
      const training = await repos()
        .trainingProfiles.get(p.id)
        .catch(() => null);
      const minutes = training?.sessionMinutes ?? 60;
      const byId = new Map(s.days.map((d) => [d.id, d]));
      const parts: [RoutineExercise[], RoutineExercise[]][] = [];
      for (const m of r.detail.merges) {
        const [a, b] = m.dayIds.map((id) => byId.get(id) ?? null);
        const ea = a === null || a === undefined ? [] : await dayExercises(p, a, training, at);
        const eb = b === null || b === undefined ? [] : await dayExercises(p, b, training, at);
        // Review S3: both days or nothing. A day with no exercises to bring would drop out of the week unseen. (A day no
        // longer in the week means it moved on: Apply below answers duplicate or stale.)
        if (a !== null && a !== undefined && b !== null && b !== undefined && (ea.length === 0 || eb.length === 0)) return { ok: false, reason: 'invalid', message: WEEK_COPY.failed };
        parts.push([ea, eb]);
      }
      // Review S4: trimmed at Up next's own estimate (the same dry run and Ben's pace), so `about N min` fits.
      const secondsOf = await dayEstimator(p, parts.flat(2), at);
      const merged = parts.map(([ea, eb]) => ({ routineId: deps.newId(), exercises: mergedExercises(ea, eb, { minutes, newId: deps.newId, secondsOf }) }));
      const proposal: WeekProposal = { actionId: r.actionId, weekMonday: r.detail.weekMonday, basis: r.detail.basis, merges: r.detail.merges, skips: r.detail.skips, before: r.detail.before, after: r.detail.after, factsKey: r.detail.factsKey };
      const id = deps.newId();
      const w = await repos()
        .weekPlans.apply(p.id, s.monday, (current) => applyWeekPlan({ id, ownerId: p.id, proposal, monday: s.monday, factsKey: s.factsKey, current, merged, opId: req.opId, at }))
        .catch(() => null);
      if (w === null) return { ok: false, reason: 'failed', message: WEEK_COPY.failed };
      switch (w.status) {
        case 'written':
        case 'replayed':
          return { ok: true, week: w.week, duplicate: w.status === 'replayed' };
        case 'stale':
          return { ok: false, reason: 'stale', message: WEEK_COPY.stale };
        case 'invalid':
          return { ok: false, reason: 'invalid', message: WEEK_COPY.failed };
        case 'missing':
          return { ok: false, reason: 'missing', message: WEEK_COPY.failed };
      }
    },

    /** Undo of an Apply: the week as the plan has it, the merged day's workout gone. Stale on an old version. */
    async undo(req: { weekPlanId: string; expectedVersion: number; opId: string }): Promise<WeekWriteOutcome> {
      const p = await deps.profile();
      if (p === null) return { ok: false, reason: 'missing', message: WEEK_COPY.failed };
      const at = deps.now();
      const w = await repos()
        .weekPlans.undo(p.id, req.weekPlanId, (c, routines) => undoWeekPlan(c, { expectedVersion: req.expectedVersion, opId: req.opId, at, routines }))
        .catch(() => null);
      if (w === null) return { ok: false, reason: 'failed', message: WEEK_COPY.failed };
      switch (w.status) {
        case 'written':
        case 'replayed':
          return { ok: true, week: w.week, duplicate: w.status === 'replayed' };
        case 'stale':
          return { ok: false, reason: 'stale', message: WEEK_COPY.stale };
        case 'invalid':
          return { ok: false, reason: 'invalid', message: WEEK_COPY.failed };
        case 'missing':
          return { ok: false, reason: 'missing', message: WEEK_COPY.failed };
      }
    },

    /** Your plan's `This week: Push (Chest + Shoulders)` with Undo, while a change is in use. */
    async change(): Promise<{ text: string; weekPlanId: string; version: number; daysRemoved: number; merged: string[][] } | null> {
      const p = await deps.profile();
      if (p === null) return null;
      const s = await state(p);
      return s.active === null ? null : { text: weekChangeText(s.active), weekPlanId: s.active.id, version: s.active.version, daysRemoved: weekDaysRemoved(s.active), merged: s.active.merges.map((m) => [...m.dayIds]) };
    },
  };

  return { activities, week, copy: ACTIVITY_COPY };
}

export type WeekServices = ReturnType<typeof createWeekServices>;

/**
 * The weekly auto-review and Progress › Reviews (workout-builder-v3 §6.1 weekly, §6.2; Ben 20–21 Oct).
 * In-process; the only network call is the model port, and nothing waits for it (rule 1): the facts are
 * code's, from stored records only, and stand on their own as `Not reviewed` when the coach can't look.
 *
 * - **When:** on app open (any connection; background runs aren't reliable on a free-provisioned app):
 *   from Sunday 18:00 the week now ending, otherwise the week just ended (`weeklyReviewWeek`). Cached by
 *   an input hash on the review record: the same inputs with a settled coach part run nothing; the same
 *   inputs that never got a coach part (offline, not connected, a failed call) ask again when reachable;
 *   new inputs make a new review that supersedes the old one in one write (`SqliteReviews.record`).
 * - **Coach:** the ChatGPT-plan route only (the coach's own availability; never a paid route, rule 7), the
 *   stronger model (`builderModelFor('weekly')`), one strict tool. Every number in its words is checked
 *   (`checkWeeklyReview`); a wrong one hides its sentence. Its plan tweaks are offers (rule 3).
 * - **Changes (Progress v3, rule 3):** code's own (the same edit repeated, §6.1) and the coach's. A small
 *   change on the same exercises (working sets on a plan-day template) is applied for the next sessions as
 *   soon as the review stores it, recorded with its reason and author, each with Undo (and Redo); a
 *   structural one (swap, add, remove, day move), and a small one whose reason the number check hid, is
 *   only ever asked (Apply / Keep as is). Small changes land before the page is told; until then (or if the
 *   apply failed, or on an older week) they read `Not applied`. Every write is the routine's versioned write
 *   with an `update_routine` record, guarded per exercise (refused once that exercise's working sets moved
 *   from the change's `fromSets`, rule 5; the same review's change to another exercise doesn't block it)
 *   and never on a pain-flagged movement (rule 9). Apply, Undo and Redo each have one deterministic op
 *   (from the review, the change and the record before), so a force-close between a write and its mark is
 *   finished on the next open or tap, never written twice.
 * - **Progress page (v3):** This week, Lifts, Muscles (live, from stored records) and Coach's changes (the
 *   newest stored review), `progress()`.
 * - **Your data** (rule 10): reviews are their own records (migration 30), facts apart from coach text, in
 *   backups, export and Delete my data with the rest of Ben's data.
 *
 * Not proven on the device: the ChatGPT-plan route with this request has to run on Ben's iPhone before
 * it counts as working.
 */

import {
  BUILDER_STATUS_WORD,
  buildWeeklyRequest,
  builderModelFor,
  carriedProposals,
  checkWeeklyReview,
  codeProposals,
  mergeCoachAsks,
  requestBuilderTool,
  unansweredAsk,
  weeklyContextText,
  weeklyFactTexts,
  type BuilderCoachReach,
  type CoachModelPort,
} from '@fizz/coach';
import {
  addDays,
  changesContentKey,
  coachChangesView,
  musclePlanOfReview,
  deriveId,
  isDeleted,
  autoApplicable,
  isStructuralProposal,
  liftsView,
  liftHistorySessions,
  sessionNewBests,
  type NewBestView,
  musclesView,
  templateWorkingSets,
  thisWeekView,
  isInHistory,
  liftTargetsInUse,
  liveRoutines,
  localDateOf,
  localWeekBounds,
  planDayBodyParts,
  planInUseUntilUtc,
  planRoutines,
  pausedDates,
  reviewCardView,
  reviewFactLines,
  reviewHistoryRow,
  reviewProposalText,
  reviewSessionOf,
  splitInUse,
  stableStringify,
  toIso,
  toMs,
  weekDataOfReview,
  weeklyFacts,
  weeklyReviewFacts,
  weeklyReviewWeek,
  weeklyReviewWorthwhile,
  withTemplateWorkingSets,
  WEEKLY_REVIEW,
  proposalView,
  type CoachChangesView,
  type LiftsView,
  type MuscleTrackerView,
  type ReviewCardView,
  type ThisWeekView,
  type ReviewHistoryRow,
  type ReviewPlan,
  type ReviewProposalView,
  type ReviewSession,
  type ReviewTemplate,
  type ReviewWeekData,
  type WeeklyFacts,
  type WeeklyReviewInput,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { ActionRecord, Activity, Exercise, PlanDraft, ReviewCoach, ReviewProposal, ReviewSubject, Routine, SessionAggregate, TrainingProfile, TrainingReview, UserProfile, ZonedTimestamp } from '@fizz/schemas';
import { BUILDER_COACH_TOOL } from '@fizz/schemas';
import type { CoachAvailability } from '../coach/coach-service';

export interface WeeklyReviewServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  newId: () => string;
  availability: () => Promise<CoachAvailability>;
  /** The plan route's model port. Absent: the coach isn't in this build's wiring (`Coach not connected`). */
  model?: () => CoachModelPort;
  catalogueExercises?: () => readonly Exercise[];
  /** Each split day's main lift: the default `Lifts shown` with no plan templates. */
  mainLiftIds?: () => Promise<ReadonlySet<string>>;
}

export type WeeklyRun =
  /** Nothing to review (no history, or an empty week with no plan or aim). */
  | { kind: 'nothing' }
  /** Same inputs, coach part settled: nothing ran. */
  | { kind: 'cached'; review: TrainingReview }
  | { kind: 'reviewed'; review: TrainingReview }
  /** Stored with code's facts only: `Not reviewed · Offline` (rule 1). */
  | { kind: 'not_reviewed'; review: TrainingReview; status: Exclude<BuilderCoachReach, 'ok'> | 'failed' }
  | { kind: 'failed' };

export interface LiftChoice {
  exerciseId: string;
  name: string;
  shown: boolean;
  /** Not in the plan and no lift target: adding it asks for the reps to track it at (once). */
  needsReps: boolean;
  /** The reps picked before, else the reps of Ben's newest top set (the picker's starting value). */
  reps: number | null;
}

/** Progress v3 (one page for every goal): This week → Lifts → Muscles → Coach's changes. */
export interface ProgressData {
  week: ThisWeekView;
  lifts: LiftsView;
  muscles: MuscleTrackerView;
  /** The newest weekly review's changes; null with no review yet. */
  changes: CoachChangesView | null;
  /** Whether any earlier review exists (`Past weeks ›`). */
  hasPast: boolean;
  /** Whether Ben chose the lifts (false: the plan's main lifts). */
  liftsChosen: boolean;
  trainingVersion: number;
}

/** One stored week (Past weeks › a week): its facts and the changes it made. */
export interface ReviewDetail {
  card: ReviewCardView;
  changes: CoachChangesView | null;
}

export type ProposalOutcome = { ok: true; line: string; proposal: ReviewProposalView } | { ok: false; reason: 'out_of_date' | 'pain' | 'changed_since' | 'missing' | 'failed'; message: string };

export const REVIEW_SERVICE_COPY = {
  outOfDate: 'Out of date',
  heldPain: 'Held · pain',
  changedSince: (name: string) => `Can’t undo: ${name} changed since.`,
  failed: 'Couldn’t save',
  missing: 'Not found',
} as const;

const SESSION_WEEKS = WEEKLY_REVIEW.trendWeeks + WEEKLY_REVIEW.weeks + 1;
const HISTORY_LIMIT = 26;
/** A coach call that failed isn't made again for the same inputs before this (review b3-wave3-truth S4: Ben's plan allowance). */
export const FAILED_RETRY_MS = 6 * 3_600_000;

function reachOf(a: CoachAvailability): BuilderCoachReach {
  if (a.status === 'ok' && a.model !== null) return 'ok';
  return a.status === 'offline' ? 'offline' : 'not_connected';
}

export function createWeeklyReviewService(deps: WeeklyReviewServiceDeps) {
  const repos = () => deps.store().repos;
  let running: Promise<WeeklyRun> | null = null;
  /** The review whose coach call is out right now: Progress reads `Reviewing…` until it returns (review build-b-21oct S2). */
  let asking: string | null = null;
  // Screens reload when a run stores a review (pending, then the coach's part; review b3-wave3-ux B2).
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) {
      try {
        l();
      } catch {
        // A listener's failure never stops the run.
      }
    }
  };

  async function exercisePool(): Promise<Map<string, Exercise>> {
    const pool = new Map<string, Exercise>();
    for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) pool.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!pool.has(e.id)) pool.set(e.id, e);
    return pool;
  }

  async function sessionsUpTo(owner: UserProfile, nowMs: number): Promise<ReviewSession[]> {
    const from = toIso(nowMs - SESSION_WEEKS * 7 * 86_400_000);
    const r = await repos()
      .sessions.listFinishedBetweenReadable(owner.id, from, toIso(nowMs + 1))
      .catch(() => ({ sessions: [] as SessionAggregate[] }));
    return r.sessions.map((a) => reviewSessionOf(a, owner.timezone, nowMs)).filter((s): s is ReviewSession => s !== null);
  }

  /**
   * The tracked lifts' whole history (one indexed read each, at most 6), so a PB beats every earlier real top
   * set, not only the weeks loaded. A lift whose history can't be read is `unknown`: no PB is claimed for it
   * (rule 6; review progress-v3b-design S2). Kept per lift while the finished workouts are the same (their IDs
   * and revisions, `finishedWorkoutsDigest`), so a refresh doesn't read years of history again (review
   * progress-v3b S3); with no digest it reads every time.
   */
  let historyCache: { store: Store; key: string; lifts: Map<string, ReviewSession[]> } | null = null;
  async function liftHistory(g: Gathered): Promise<{ earlier: ReviewSession[]; unknown: Set<string> }> {
    const store = deps.store();
    const digest = await store.finishedWorkoutsDigest().catch(() => null);
    const key = digest === null ? null : `${g.owner.id}|${g.owner.timezone}|${digest}`;
    if (key === null || historyCache === null || historyCache.store !== store || historyCache.key !== key) historyCache = key === null ? null : { store, key, lifts: new Map() };
    const earlier: ReviewSession[] = [];
    const unknown = new Set<string>();
    for (const id of new Set(g.input.lifts)) {
      let sessions = historyCache?.lifts.get(id);
      if (sessions === undefined) {
        const h = await store.listExerciseHistory(g.owner.id, id).catch(() => null);
        if (h === null) {
          unknown.add(id);
          continue;
        }
        sessions = liftHistorySessions(id, h, g.owner.timezone);
        historyCache?.lifts.set(id, sessions);
      }
      earlier.push(...sessions);
    }
    return { earlier, unknown };
  }

  /** Every plan Ben applied (in use now or before), with its days and paused dates. */
  async function plansOf(owner: UserProfile, routines: readonly Routine[], pool: Map<string, Exercise>, training: TrainingProfile | null, from: string, to: string): Promise<{ plans: ReviewPlan[]; current: PlanDraft | null; currentDays: Routine[]; previousDays: Routine[] }> {
    const drafts = await repos()
      .planDrafts.listByOwner(owner.id)
      .catch(() => [] as PlanDraft[]);
    const byId = new Map(routines.map((r) => [r.id, r]));
    const split = splitInUse(training);
    const of = (id: string) => pool.get(id) ?? null;
    const live = liveRoutines(routines);
    const plans: ReviewPlan[] = [];
    let current: PlanDraft | null = null;
    let currentDays: Routine[] = [];
    const ended: { at: string; days: Routine[] }[] = [];
    for (const d of drafts) {
      if (d.applied === null || (d.status !== 'applied' && d.status !== 'superseded' && d.status !== 'ended')) continue;
      const days = d.status === 'applied' ? planRoutines(d, live) : d.applied.made.map((m) => byId.get(m.routineId)).filter((r): r is Routine => r !== undefined);
      if (d.status === 'applied' && (current === null || (current.applied?.atUtc ?? '') < d.applied.atUtc)) {
        current = d;
        currentDays = days;
      }
      if (d.status !== 'applied') ended.push({ at: d.applied.atUtc, days });
      plans.push({
        planId: d.id,
        appliedAtUtc: d.applied.atUtc,
        untilUtc: planInUseUntilUtc(d),
        days: days.map((r) => ({ routineId: r.id, name: r.name, createdFromSessionId: r.createdFromSessionId ?? null, bodyParts: planDayBodyParts(r, of, split) })),
        pausedDates: pausedDates(d.pauses, from, to, owner.timezone, planInUseUntilUtc(d)),
      });
    }
    // The plan before the current one (for the `now × n` marker when its reps differ).
    const before = ended.filter((e) => current === null || e.at < (current.applied?.atUtc ?? '')).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    return { plans, current, currentDays, previousDays: before?.days ?? [] };
  }

  /** Each exercise's top-set reps in a plan's days (the main lift's day first): a single target, or the low end. */
  function topRepsOf(days: readonly Routine[]): Map<string, number> {
    const out = new Map<string, number>();
    const ordered = [...days].sort((a, b) => Number(b.planDay?.mainLiftExerciseId != null) - Number(a.planDay?.mainLiftExerciseId != null));
    for (const r of ordered) {
      for (const e of r.exercises) {
        if (out.has(e.exerciseId) && r.planDay?.mainLiftExerciseId !== e.exerciseId) continue;
        const working = e.setTemplates.filter((t) => t.setType !== 'warmup');
        const top = working.find((t) => t.setType === 'top') ?? working[0];
        if (top?.targetReps != null) out.set(e.exerciseId, top.targetReps.min);
      }
    }
    return out;
  }

  function templatesOf(plan: PlanDraft | null, days: readonly Routine[], pool: Map<string, Exercise>): ReviewTemplate[] {
    if (plan === null) return [];
    return days.map((r) => ({
      planId: plan.id,
      routineId: r.id,
      name: r.name,
      version: r.version,
      exercises: r.exercises.map((e) => {
        const working = e.setTemplates.filter((t) => t.setType !== 'warmup');
        const top = working.find((t) => t.setType === 'top') ?? working[0];
        return { exerciseId: e.exerciseId, name: pool.get(e.exerciseId)?.name ?? 'Exercise', workingSets: working.length, topReps: top?.targetReps?.min ?? null };
      }),
    }));
  }

  interface Gathered {
    owner: UserProfile;
    input: WeeklyReviewInput;
    training: TrainingProfile | null;
    pool: Map<string, Exercise>;
    liftsChosen: boolean;
    nameOf: (id: string) => string;
    /** The plan's (and split's) main lifts. */
    mains: Set<string>;
    planReps: Map<string, number>;
    previousPlanReps: Map<string, number> | null;
    /** Local date the plan in use was applied. */
    planAppliedDate: string | null;
  }

  /** Everything the facts are made from, for one week, read from the store (local only). */
  async function gather(monday: string): Promise<Gathered | null> {
    const owner = await deps.profile();
    if (owner === null) return null;
    const now = deps.now();
    const nowMs = toMs(now.utc);
    const tz = owner.timezone;
    const pool = await exercisePool();
    const training = await repos()
      .trainingProfiles.get(owner.id)
      .catch(() => null);
    const routines = await repos()
      .routines.listByOwner(owner.id)
      .catch(() => [] as Routine[]);
    const from = addDays(monday, -7 * SESSION_WEEKS);
    const to = addDays(monday, 7);
    const { plans, current, currentDays, previousDays } = await plansOf(owner, routines, pool, training, from, to);
    const templates = templatesOf(current, currentDays, pool);
    const sessions = await sessionsUpTo(owner, nowMs);
    const activities = (
      await repos()
        .activities.listBetween(owner.id, from, to)
        .catch(() => [] as Activity[])
    )
      .filter((a) => a.deletedAtUtc === null)
      .map((a) => ({ id: a.id, date: a.fields.date, kind: a.fields.kind, status: a.fields.status, distanceM: a.fields.distanceM }));
    const pain = await repos()
      .painFlags.listActive(owner.id)
      .catch(() => []);
    const chosen = training?.progressLifts ?? [];
    const liftTargets = liftTargetsInUse(training);
    const mains = new Set<string>();
    for (const r of currentDays) {
      const m = r.planDay?.mainLiftExerciseId ?? r.exercises.find((e) => e.main === true)?.exerciseId;
      if (m != null) mains.add(m);
    }
    for (const m of (await deps.mainLiftIds?.().catch(() => null)) ?? []) mains.add(m);
    let lifts: string[] = [...chosen];
    if (lifts.length === 0) {
      // A lift with a target is shown by default too, after the main lifts (review b3-wave3-ux S3).
      lifts = [...new Set([...mains, ...liftTargets.map((t) => t.exerciseId)])];
    }
    const logged = new Map<string, string>();
    for (const s of sessions) for (const e of s.exercises) logged.set(e.exerciseId, e.name);
    const nameOf = (id: string): string => pool.get(id)?.name ?? logged.get(id) ?? 'Exercise';
    return {
      owner,
      training,
      pool,
      liftsChosen: chosen.length > 0,
      nameOf,
      mains,
      planReps: topRepsOf(currentDays),
      previousPlanReps: previousDays.length === 0 ? null : topRepsOf(previousDays),
      planAppliedDate: current?.applied == null ? null : localDateOf(toMs(current.applied.atUtc), tz),
      input: {
        monday,
        nowMs,
        tz,
        sessions,
        plans,
        aim: training?.daysPerWeek ?? null,
        goal: training?.goal ?? null,
        info: (id) => pool.get(id) ?? null,
        lifts: lifts.slice(0, WEEKLY_REVIEW.maxLifts),
        liftTargets,
        activities,
        templates,
        painFlagged: new Set(pain.map((p) => p.exerciseId)),
        unit: owner.preferredUnit,
      },
    };
  }

  /**
   * The inputs a review is made from (§6.1 cache key): the stored facts (not code's own tweak suggestions,
   * so Apply doesn't re-run it), goal, lifts, and the active pain flags (a new flag re-runs it, so no tweak
   * stands on a flagged movement; rule 9, review b3-wave3-truth B5). Never the plan's set counts
   * (`group_sets.planned`, only whether there is a plan line): the review's own changes move them, and a re-run
   * on that would ask the coach again, drop Ben's open asks, bring `NEW` back after his `Got it` and let the
   * coach add another automatic change on every open (rule 3; review build-b-21oct B1). The reviewed week
   * keeps the plan it was reviewed against.
   */
  function inputsHashOf(g: Gathered, facts: ReturnType<typeof weeklyReviewFacts>): string {
    const kept = facts.filter((f) => f.kind !== 'template_edit').map((f) => (f.kind === 'group_sets' ? { ...f, planned: f.planned === null ? null : 'plan' } : f));
    return deriveId(`weekly:${stableStringify({ facts: kept, goal: g.input.goal, lifts: g.input.lifts, templates: g.input.templates.map((t) => t.routineId), pain: [...g.input.painFlagged].sort() })}`).slice(0, 128);
  }

  const keyOf = (p: Pick<ReviewProposal, 'change'>): string => `${p.change.routineId}|${p.change.exerciseId}`;

  async function askCoach(g: Gathered, f: WeeklyFacts, reviewId: string, taken: readonly ReviewProposal[], onAsk: () => void, signal?: AbortSignal): Promise<{ coach: ReviewCoach; proposals: ReviewProposal[]; status: BuilderCoachReach | 'failed' }> {
    if (deps.model === undefined) return { coach: { status: 'not_connected' }, proposals: [], status: 'not_connected' };
    const a = await deps.availability().catch((): CoachAvailability => ({ status: 'not_connected', model: null }));
    const reach = reachOf(a);
    if (reach !== 'ok' || a.model === null) return { coach: { status: reach === 'ok' ? 'not_connected' : reach }, proposals: [], status: reach === 'ok' ? 'not_connected' : reach };
    // `Reviewing…` only once the coach is reachable and the call goes out (review progress-v3b-data N1).
    onAsk();
    const text = weeklyContextText({
      week: `${f.monday} to ${addDays(f.monday, 6)}`,
      facts: weeklyFactTexts(f),
      goal: g.input.goal,
      planDays: g.input.templates.map((t) => ({ routineId: t.routineId, name: t.name, exercises: t.exercises })),
      painFlags: [...g.input.painFlagged].map((id) => g.nameOf(id)),
    });
    const port = deps.model();
    const answer = await requestBuilderTool(port, buildWeeklyRequest(text, builderModelFor('weekly', { main: a.model, light: a.workoutModelGone === true ? null : (a.workoutModel ?? null) })), BUILDER_COACH_TOOL.weeklyReview, signal === undefined ? {} : { signal });
    if (!answer.ok) {
      const status = answer.error === 'network' || answer.error === 'timeout' ? 'offline' : answer.error === 'auth_expired' || answer.error === 'not_eligible' || answer.error === 'model_gone' || answer.error === 'unavailable' ? 'not_connected' : 'failed';
      return { coach: status === 'failed' ? { status, atUtc: deps.now().utc } : { status }, proposals: [], status };
    }
    const checked = checkWeeklyReview(answer.args, { facts: f, templates: g.input.templates, painFlagged: g.input.painFlagged, prefix: reviewId, taken });
    return { coach: { status: 'reviewed', verdict: checked.verdict, lines: checked.lines.slice(0, 10), actionIds: [], numbersChecked: true }, proposals: checked.proposals, status: 'ok' };
  }

  async function run(opts: { signal?: AbortSignal } = {}): Promise<WeeklyRun> {
    const owner = await deps.profile();
    if (owner === null) return { kind: 'nothing' };
    const now = deps.now();
    const monday = weeklyReviewWeek(toMs(now.utc), owner.timezone);
    const g = await gather(monday);
    if (g === null) return { kind: 'nothing' };
    const f = weeklyFacts(g.input);
    if (!weeklyReviewWorthwhile(f)) return { kind: 'nothing' };
    const facts = weeklyReviewFacts(f);
    const subject: ReviewSubject = { kind: 'weekly', weekMonday: monday };
    const opId = `weekly-review:${deps.newId()}`;
    const reviewId = deriveId(`weekly-review:${opId}`);
    const previous = await repos()
      .reviews.current(owner.id, subject)
      .catch(() => null);
    // Ben's answers carry over; the coach's unanswered asks too, their reasons checked again against these
    // facts, never on a movement flagged since (review build-b-21oct S1, progress-v3b-data B1; rule 9).
    const carried = carriedProposals(previous?.proposals ?? [], { facts: f, painFlagged: g.input.painFlagged });
    const taken = new Set(carried.map(keyOf));
    const fresh = codeProposals(f.edits, reviewId).filter((p) => !taken.has(keyOf(p)));
    const proposals = [...carried, ...fresh].slice(0, 4);
    const review: TrainingReview = {
      id: reviewId,
      ownerId: owner.id,
      version: 1,
      createdAtUtc: now.utc,
      updatedAtUtc: now.utc,
      subject,
      inputsHash: inputsHashOf(g, facts),
      facts,
      coach: { status: 'pending' },
      status: 'current',
      supersededById: null,
      opIds: [opId],
      createdAt: now,
      proposals,
      // Ben's `Got it` carries over a re-run with nothing new to show (no new change).
      ...(previous?.seenAtUtc !== undefined && fresh.length === 0 ? { seenAtUtc: previous.seenAtUtc } : {}),
    };
    const w = await repos()
      .reviews.record(owner.id, review)
      .catch(() => null);
    if (w === null || w.status === 'invalid' || w.status === 'stale') return { kind: 'failed' };
    if (w.status === 'unchanged' || w.status === 'replayed') return { kind: 'cached', review: w.review };
    // The same inputs whose coach call failed lately: not asked again yet (review b3-wave3-truth S4).
    const c = w.review.coach;
    if (w.status === 'retry_coach' && c.status === 'failed' && c.atUtc !== undefined && toMs(now.utc) - toMs(c.atUtc) < FAILED_RETRY_MS) return { kind: 'not_reviewed', review: w.review, status: 'failed' };
    // Small changes land in the plan before the page is told (review progress-v3-design B1).
    const stored = await autoApply(w.review);
    if (w.status === 'written' || stored.version !== w.review.version) emit();
    // `Reviewing…` while the call is out (only once the coach is reachable), then the page is told again when
    // it returns (below) or throws (here; review progress-v3b-design S4). The coach's unanswered asks from an
    // earlier run don't block a fresh tweak for the same exercise: it replaces them (review progress-v3b-data B1).
    const markAsking = () => {
      asking = stored.id;
      emit();
    };
    let asked: Awaited<ReturnType<typeof askCoach>>;
    try {
      asked = await askCoach(g, f, stored.id, (stored.proposals ?? []).filter((p) => !unansweredAsk(p)), markAsking, opts.signal);
    } catch (e) {
      if (asking === stored.id) {
        asking = null;
        emit();
      }
      throw e;
    }
    asking = null;
    const coachOp = `${opId}:coach`;
    const latest = (await repos().reviews.get(stored.id).catch(() => null)) ?? stored;
    // Still offline (or not connected) on a later open: nothing new to write.
    if (asked.status !== 'ok' && asked.status !== 'failed' && latest.coach.status === asked.coach.status && asked.proposals.length === 0) {
      emit();
      return { kind: 'not_reviewed', review: latest, status: asked.status };
    }
    const mergedProposals = mergeCoachAsks(latest.proposals ?? [], asked.proposals);
    // The coach's sentence (or new changes) is news: `NEW` again until `Got it`.
    const { seenAtUtc, ...unseen } = latest;
    const keepSeen = seenAtUtc !== undefined && asked.status !== 'ok' && mergedProposals.length === (latest.proposals ?? []).length;
    const next: TrainingReview = { ...(keepSeen ? latest : unseen), coach: asked.coach, proposals: mergedProposals, version: latest.version + 1, updatedAtUtc: deps.now().utc, opIds: [...latest.opIds, coachOp].slice(-20) };
    const u = await repos()
      .reviews.update(owner.id, next, latest.version, coachOp)
      .catch(() => null);
    const wrote = u !== null && (u.status === 'written' || u.status === 'replayed') ? u.review : latest;
    const saved = u?.status === 'written' ? await autoApply(wrote) : wrote;
    emit();
    return asked.status === 'ok' ? { kind: 'reviewed', review: saved } : { kind: 'not_reviewed', review: saved, status: asked.status };
  }

  /** Read-modify-write of one proposal on a stored review (rule 5: at the version read; one retry). */
  async function changeProposal(reviewId: string, proposalId: string, opId: string, change: (p: ReviewProposal) => ReviewProposal): Promise<ReviewProposal | null> {
    const owner = await deps.profile();
    if (owner === null) return null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const r = await repos()
        .reviews.get(reviewId)
        .catch(() => null);
      if (r === null || r.ownerId !== owner.id) return null;
      if (r.opIds.includes(opId)) return r.proposals?.find((p) => p.id === proposalId) ?? null;
      const proposals = (r.proposals ?? []).map((p) => (p.id === proposalId ? change(p) : p));
      const next: TrainingReview = { ...r, proposals, version: r.version + 1, updatedAtUtc: deps.now().utc, opIds: [...r.opIds.slice(-19), opId] };
      const u = await repos()
        .reviews.update(owner.id, next, r.version, opId)
        .catch(() => null);
      if (u !== null && (u.status === 'written' || u.status === 'replayed')) return u.review.proposals?.find((p) => p.id === proposalId) ?? null;
    }
    return null;
  }

  async function proposalOf(reviewId: string, proposalId: string): Promise<{ owner: UserProfile; review: TrainingReview; proposal: ReviewProposal } | null> {
    const owner = await deps.profile();
    if (owner === null) return null;
    const review = await repos()
      .reviews.get(reviewId)
      .catch(() => null);
    const proposal = review?.proposals?.find((p) => p.id === proposalId);
    if (review === null || review.ownerId !== owner.id || proposal === undefined) return null;
    return { owner, review, proposal };
  }

  const outcome = (p: ReviewProposal | null, line: string): ProposalOutcome => (p === null ? { ok: false, reason: 'failed', message: REVIEW_SERVICE_COPY.failed } : { ok: true, line, proposal: proposalView(p) });

  const viewsOf = (r: TrainingReview, nameOf: (id: string) => string): ReviewWeekData | null => weekDataOfReview(r, nameOf);

  const mondayOf = (r: TrainingReview): string => (r.subject.kind === 'weekly' ? r.subject.weekMonday : '');

  async function storedWeekly(ownerId: string): Promise<TrainingReview[]> {
    const stored = await repos()
      .reviews.listCurrent(ownerId, 'weekly', HISTORY_LIMIT + 1)
      .catch(() => [] as TrainingReview[]);
    return [...stored].sort((a, b) => (mondayOf(a) < mondayOf(b) ? 1 : -1));
  }

  /**
   * One template write for a proposal (Apply, the automatic apply of a small change, or Redo): the routine's
   * next version with an `update_routine` record, at `expectedVersion` (rule 5), never on a pain-flagged
   * movement (rule 9). `stale`: refused, nothing written.
   */
  async function writeChange(owner: UserProfile, p: ReviewProposal, opId: string, author: ActionRecord['author'], expected: (routine: Routine) => number | null): Promise<{ kind: 'written'; actionId: string } | { kind: 'stale' } | { kind: 'pain' } | { kind: 'changed_since' } | { kind: 'failed' }> {
    const pain = await repos()
      .painFlags.listActive(owner.id)
      .catch(() => null);
    if (pain === null) return { kind: 'failed' };
    if (pain.some((f) => f.exerciseId === p.change.exerciseId)) return { kind: 'pain' };
    const routine = await repos()
      .routines.get(p.change.routineId)
      .catch(() => null);
    if (routine === null || routine.ownerId !== owner.id || isDeleted(routine)) return { kind: 'stale' };
    const version = expected(routine);
    if (version === null) return { kind: 'changed_since' };
    const at = deps.now();
    const c = withTemplateWorkingSets(routine, { exerciseId: p.change.exerciseId, toSets: p.change.toSets, expectedVersion: version, opId, atUtc: at.utc });
    if (c.kind !== 'write') return { kind: 'stale' };
    const action: ActionRecord = {
      actionId: deriveId(opId),
      turnId: null,
      opId,
      status: 'committed',
      author,
      detail: { kind: 'update_routine', routineId: routine.id, routineName: routine.name, changes: [{ change: 'edit', text: reviewProposalText(p).slice(0, 200) }], before: routine, versionBefore: routine.version, versionAfter: c.next.version, draft: null },
      failure: null,
      reason: p.reason,
      evidenceRefs: [],
      guardNotes: [],
      entityVersions: [{ entity: 'routine', id: routine.id, before: routine.version, after: c.next.version }],
      undoneBy: null,
      createdAt: at,
    };
    const w = await repos()
      .drafts.applyRoutineChange({ ownerId: owner.id, routine: c.next, expectedRoutineVersion: routine.version, action, at })
      .catch(() => null);
    if (w === null) return { kind: 'failed' };
    if (w.status === 'stale' || w.status === 'missing') return { kind: 'stale' };
    return { kind: 'written', actionId: w.action.actionId };
  }

  /** Apply (Ben's tap on a structural change, or the review's own apply of a small one, rule 3). */
  async function applyOne(req: { reviewId: string; proposalId: string; opId: string }, author: ActionRecord['author']): Promise<ProposalOutcome> {
    const found = await proposalOf(req.reviewId, req.proposalId);
    if (found === null) return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
    const { owner, proposal: p } = found;
    const line = reviewProposalText(p);
    if (p.status === 'applied') return outcome(p, line);
    if (p.status !== 'open') return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
    // One template write per proposal, whatever the tap: its op ID and record come from the proposal, so a
    // tap after a force-close between the write and the mark finds the write and marks it (review
    // b3-wave3-truth S3), never a second write or a stale refusal of its own change.
    const applyOp = `review-apply:${deriveId(`${req.reviewId}|${p.id}`)}`;
    const actionId = deriveId(applyOp);
    const prior = await repos()
      .coach.getAction(actionId)
      .catch(() => null);
    if (prior !== null) {
      const undone = prior.undoneBy !== null;
      return outcome(await changeProposal(req.reviewId, req.proposalId, `${req.opId}:mark`, (x) => ({ ...x, status: undone ? 'undone' : 'applied', actionId })), line);
    }
    // Guarded per exercise, not by the routine's version (review progress-v3-data B1): the same review's change
    // to another exercise on this plan day moves the version but not this exercise. Refused once this
    // exercise's working sets aren't what the change started from (rule 5).
    const w = await writeChange(owner, p, applyOp, author, (routine) => (templateWorkingSets(routine, p.change.exerciseId) === p.change.fromSets ? routine.version : null));
    if (w.kind === 'failed') return { ok: false, reason: 'failed', message: REVIEW_SERVICE_COPY.failed };
    if (w.kind === 'pain') {
      // Held by the pain flag, and said so (rule 9; review build-b-21oct S3), never `Out of date`.
      await changeProposal(req.reviewId, req.proposalId, `${req.opId}:stale`, (x) => ({ ...x, status: 'stale', held: 'pain' }));
      return { ok: false, reason: 'pain', message: REVIEW_SERVICE_COPY.heldPain };
    }
    if (w.kind !== 'written') {
      await changeProposal(req.reviewId, req.proposalId, `${req.opId}:stale`, (x) => ({ ...x, status: 'stale' }));
      return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
    }
    return outcome(await changeProposal(req.reviewId, req.proposalId, `${req.opId}:mark`, (x) => ({ ...x, status: 'applied', actionId: w.actionId })), line);
  }

  /**
   * (Rule 3, Progress v3) The review's small changes are applied for the next sessions as soon as it stores
   * them (each with its reason and Undo), before the page is told; structural ones, and a small one whose
   * reason was hidden, wait for Ben. Runs after every open too, so a change a force-close left open is
   * applied then (one deterministic op per proposal: never twice). Until then the page shows it `Not applied`.
   */
  async function autoApply(review: TrainingReview): Promise<TrainingReview> {
    const open = (review.proposals ?? []).filter((p) => p.status === 'open' && autoApplicable(p));
    if (open.length === 0) return review;
    for (const p of open) await applyOne({ reviewId: review.id, proposalId: p.id, opId: `auto:${deriveId(`${review.id}|${p.id}`)}` }, p.source === 'coach' ? 'coach' : 'checks');
    return (await repos().reviews.get(review.id).catch(() => null)) ?? review;
  }

  /**
   * The changes Ben acted on himself: Keep as is, Undo, and an Apply or Redo whose record is his (an
   * automatic apply is the coach's or the checks'). When every change is his, Coach's changes collapse.
   */
  async function actedOn(r: TrainingReview): Promise<Set<string>> {
    const out = new Set<string>();
    for (const p of r.proposals ?? []) {
      if (p.status === 'skipped' || p.status === 'undone') out.add(p.id);
      else if (p.status === 'applied' && p.actionId !== null) {
        const a = await repos()
          .coach.getAction(p.actionId)
          .catch(() => null);
        if (a?.author === 'ben') out.add(p.id);
      }
    }
    return out;
  }

  return {
    /** Called after each review a run stores (the pending one, then the coach's part); returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** On app open (§6.1). One run at a time; never throws. Small changes are applied after the run (rule 3). */
    runOnOpen(opts: { signal?: AbortSignal } = {}): Promise<WeeklyRun> {
      running ??= run(opts)
        .then(async (r): Promise<WeeklyRun> => {
          if (r.kind === 'nothing' || r.kind === 'failed') return r;
          const review = await autoApply(r.review);
          if (review.version !== r.review.version) emit();
          return { ...r, review };
        })
        .catch((): WeeklyRun => ({ kind: 'failed' }))
        .finally(() => {
          running = null;
        });
      return running;
    },

    /** Progress (v3): This week, Lifts and Muscles live from stored records; Coach's changes from the newest review. Local only. */
    async progress(): Promise<ProgressData | null> {
      const owner = await deps.profile();
      if (owner === null) return null;
      const nowMs = toMs(deps.now().utc);
      const today = localDateOf(nowMs, owner.timezone);
      const monday = localWeekBounds(nowMs, owner.timezone).mondayLocalDate;
      const g = await gather(monday);
      if (g === null) return null;
      const stored = await storedWeekly(owner.id);
      const newest = stored[0];
      // Only the latest reviewable week's review is `for next week` (review progress-v3-data S5).
      const current = newest !== undefined && mondayOf(newest) === weeklyReviewWeek(nowMs, owner.timezone);
      const history = await liftHistory(g);
      return {
        week: thisWeekView(g.input, { today, reviewIds: new Map(stored.map((r) => [mondayOf(r), r.id])), historyWeeks: SESSION_WEEKS - 1 }),
        lifts: liftsView(g.input, { today, mains: g.mains, planReps: g.planReps, pickedReps: g.training?.progressLiftReps ?? {}, previousPlanReps: g.previousPlanReps, planAppliedDate: g.planAppliedDate, nameOf: g.nameOf, earlier: history.earlier, historyUnknown: history.unknown }),
        // Reviewed weeks keep the plan they were reviewed against (review progress-v3-design S4).
        muscles: musclesView(g.input, { today, storedPlans: new Map(stored.map((r) => [mondayOf(r), musclePlanOfReview(r)])) }),
        changes: newest === undefined ? null : coachChangesView(newest, today, { current, actedOn: await actedOn(newest), painFlagged: g.input.painFlagged, reviewing: asking === newest.id }),
        hasPast: stored.length > 1,
        liftsChosen: g.liftsChosen,
        // No row yet: the defaults are version 1 (the first change writes them).
        trainingVersion: g.training?.version ?? 1,
      };
    },

    /**
     * The Summary's PB moment (Progress v3): `New best · Bench 100 × 6` for each tracked lift whose real top set
     * in this workout beats every earlier real one at its tracked reps (the Lifts chart's definition). Local only.
     */
    async sessionBests(sessionId: string): Promise<NewBestView[]> {
      const owner = await deps.profile();
      if (owner === null) return [];
      const nowMs = toMs(deps.now().utc);
      const g = await gather(localWeekBounds(nowMs, owner.timezone).mondayLocalDate);
      if (g === null) return [];
      const history = await liftHistory(g);
      return sessionNewBests(g.input, { planReps: g.planReps, pickedReps: g.training?.progressLiftReps ?? {}, nameOf: g.nameOf, earlier: history.earlier, historyUnknown: history.unknown }, sessionId);
    },

    /** Past weeks: every stored weekly review but the newest, newest first. */
    async pastWeeks(): Promise<ReviewHistoryRow[]> {
      const owner = await deps.profile();
      if (owner === null) return [];
      const today = localDateOf(toMs(deps.now().utc), owner.timezone);
      const pool = await exercisePool();
      const [, ...older] = await storedWeekly(owner.id);
      return older.flatMap((r) => {
        const d = viewsOf(r, (id) => pool.get(id)?.name ?? 'Exercise');
        return d === null ? [] : [reviewHistoryRow(r, d, today)];
      });
    },

    /** One stored week in full (Past weeks › a week): facts as stored, and its changes. */
    async review(reviewId: string): Promise<ReviewDetail | null> {
      const owner = await deps.profile();
      if (owner === null) return null;
      const r = await repos()
        .reviews.get(reviewId)
        .catch(() => null);
      if (r === null || r.ownerId !== owner.id) return null;
      const today = localDateOf(toMs(deps.now().utc), owner.timezone);
      const pool = await exercisePool();
      const d = weekDataOfReview(r, (id) => pool.get(id)?.name ?? 'Exercise');
      if (d === null) return null;
      return { card: reviewCardView(r, d, today, 99), changes: coachChangesView(r, today, { current: mondayOf(r) === weeklyReviewWeek(toMs(deps.now().utc), owner.timezone) }) };
    },

    /**
     * `Got it` on Coach's changes: the section collapses to one line. Versioned and idempotent (rule 5): a
     * review that moved since the tap (the coach's part landed) isn't marked, so news is never hidden unseen.
     */
    async markSeen(req: { reviewId: string; expectedVersion: number; opId: string; /** `CoachChangesView.contentKey`: what Ben saw. */ contentKey?: string }): Promise<boolean> {
      const owner = await deps.profile();
      if (owner === null) return false;
      const r = await repos()
        .reviews.get(req.reviewId)
        .catch(() => null);
      if (r === null || r.ownerId !== owner.id) return false;
      if (r.opIds.includes(req.opId) || r.seenAtUtc !== undefined) return true;
      // Moved since the page loaded: still marked when only statuses moved (the automatic apply landing; review
      // progress-v3-design S5); never when the coach's words or the changes are new to Ben.
      if (r.version !== req.expectedVersion && (req.contentKey === undefined || changesContentKey(r) !== req.contentKey)) return false;
      const at = deps.now().utc;
      const u = await repos()
        .reviews.update(owner.id, { ...r, seenAtUtc: at, version: r.version + 1, updatedAtUtc: at, opIds: [...r.opIds.slice(-19), req.opId] }, r.version, req.opId)
        .catch(() => null);
      if (u !== null && (u.status === 'written' || u.status === 'replayed')) emit();
      return u !== null && (u.status === 'written' || u.status === 'replayed');
    },

    /** `Edit` (lifts): every exercise Ben has logged in the window (newest first), whether it is shown, and whether adding it asks for reps. */
    async liftChoices(): Promise<LiftChoice[]> {
      const owner = await deps.profile();
      if (owner === null) return [];
      const nowMs = toMs(deps.now().utc);
      const g = await gather(weeklyReviewWeek(nowMs, owner.timezone));
      if (g === null) return [];
      const shown = new Set(g.input.lifts);
      const picked = g.training?.progressLiftReps ?? {};
      const targeted = new Set(g.input.liftTargets.map((t) => t.exerciseId));
      const newest = [...g.input.sessions].sort((a, b) => b.startedMs - a.startedMs);
      const seen = new Set<string>();
      const out: LiftChoice[] = [];
      const lastReps = (id: string): number | null => {
        for (const s of newest) {
          const sets = s.exercises.filter((e) => e.exerciseId === id).flatMap((e) => e.sets.filter((x) => x.setType !== 'warmup' && x.reps !== null && x.reps > 0));
          const top = [...sets].sort((a, b) => (b.load?.value ?? 0) - (a.load?.value ?? 0))[0];
          if (top?.reps != null) return Math.min(30, top.reps);
        }
        return null;
      };
      const choice = (id: string, isShown: boolean): LiftChoice => {
        const needsReps = !g.planReps.has(id) && !targeted.has(id);
        return { exerciseId: id, name: g.nameOf(id), shown: isShown, needsReps, reps: needsReps ? (picked[id] ?? lastReps(id)) : null };
      };
      for (const s of newest)
        for (const e of s.exercises) {
          if (seen.has(e.exerciseId) || !e.sets.some((x) => x.setType !== 'warmup')) continue;
          const info = g.pool.get(e.exerciseId);
          if (info?.measurement === 'cardio') continue;
          seen.add(e.exerciseId);
          out.push(choice(e.exerciseId, shown.has(e.exerciseId)));
        }
      for (const id of g.input.lifts) if (!seen.has(id)) out.unshift(choice(id, true));
      return out;
    },

    /** Apply on a structural change (Ben's tap, rule 3): the template's next version, refused when it moved since (rule 5). */
    applyProposal(req: { reviewId: string; proposalId: string; opId: string }): Promise<ProposalOutcome> {
      return applyOne(req, 'ben');
    },

    /** Keep as is (Skip): nothing changes in the plan. */
    async skipProposal(req: { reviewId: string; proposalId: string; opId: string }): Promise<ProposalOutcome> {
      const found = await proposalOf(req.reviewId, req.proposalId);
      if (found === null) return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
      if (found.proposal.status !== 'open' && found.proposal.status !== 'skipped') return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
      return outcome(await changeProposal(req.reviewId, req.proposalId, req.opId, (x) => ({ ...x, status: 'skipped' })), reviewProposalText(found.proposal));
    },

    /**
     * Undo of an applied change: that exercise's working sets back to what the change started from, while it
     * still has the change's count (rule 5), leaving the routine's other changes since (the same review's
     * change to another exercise) in place (review progress-v3-data B1). One undo per apply: its op comes from
     * the apply's record, so a force-close between the write and the mark is finished on the next tap.
     */
    async undoProposal(req: { reviewId: string; proposalId: string; opId: string }): Promise<ProposalOutcome> {
      const found = await proposalOf(req.reviewId, req.proposalId);
      if (found === null || found.proposal.actionId === null) return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
      const { owner, proposal: p } = found;
      if (p.status === 'undone') return outcome(p, reviewProposalText(p));
      if (p.status !== 'applied') return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
      const target = await repos()
        .coach.getAction(p.actionId ?? '')
        .catch(() => null);
      if (target === null || target.detail.kind !== 'update_routine') return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
      const undoOp = `review-undo:${deriveId(`${req.reviewId}|${p.id}|${target.actionId}`)}`;
      const at = deps.now();
      const undo: ActionRecord = {
        ...target,
        actionId: deriveId(undoOp),
        opId: undoOp,
        author: 'ben',
        detail: { kind: 'undo', undoneActionId: target.actionId, what: `the change to ${target.detail.routineName}`.slice(0, 200), restored: [], alreadyLogged: [] },
        entityVersions: [],
        undoneBy: null,
        createdAt: at,
      };
      const inverse = (current: Routine): Routine | null => {
        if (templateWorkingSets(current, p.change.exerciseId) !== p.change.toSets) return null;
        const c = withTemplateWorkingSets(current, { exerciseId: p.change.exerciseId, toSets: p.change.fromSets, expectedVersion: current.version, opId: undoOp, atUtc: at.utc });
        return c.kind === 'write' ? c.next : null;
      };
      const r = await repos()
        .drafts.undoRoutineChange({ ownerId: owner.id, undo, at, newRoutineAtUtc: at.utc, inverse })
        .catch(() => null);
      if (r === null) return { ok: false, reason: 'failed', message: REVIEW_SERVICE_COPY.failed };
      // Undone already (a force-close after the undo, before the mark): mark it, never `changed since` (review b3-wave3-truth S3).
      if (r.status === 'not_possible' && r.reason === 'already_undone') return outcome(await changeProposal(req.reviewId, req.proposalId, `${undoOp}:mark`, (x) => ({ ...x, status: 'undone' })), reviewProposalText(p));
      if (r.status === 'not_possible') return { ok: false, reason: 'changed_since', message: REVIEW_SERVICE_COPY.changedSince(p.change.routineName) };
      return outcome(await changeProposal(req.reviewId, req.proposalId, `${undoOp}:mark`, (x) => ({ ...x, status: 'undone' })), reviewProposalText(p));
    },

    /**
     * Redo of an undone small change: written again on the template as it is now, only while its working sets
     * are still what the change started from (rule 5: refused once Ben changed them since; rule 9: never on a
     * pain-flagged movement). One redo per undone apply: its op comes from the review, the change and the
     * record it undid (review progress-v3-design B2), so a force-close between the write and the mark is
     * found and marked on the next tap, never refused as `changed since` with no Undo.
     */
    async redoProposal(req: { reviewId: string; proposalId: string; opId: string }): Promise<ProposalOutcome> {
      const found = await proposalOf(req.reviewId, req.proposalId);
      if (found === null) return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
      const { owner, proposal: p } = found;
      const line = reviewProposalText(p);
      if (p.status === 'applied') return outcome(p, line);
      if (p.status !== 'undone' || isStructuralProposal(p)) return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
      const redoOp = `review-redo:${deriveId(`${req.reviewId}|${p.id}|${p.actionId ?? ''}`)}`;
      const prior = await repos()
        .coach.getAction(deriveId(redoOp))
        .catch(() => null);
      if (prior !== null) return outcome(await changeProposal(req.reviewId, req.proposalId, `${redoOp}:mark`, (x) => ({ ...x, status: 'applied', actionId: prior.actionId })), line);
      const w = await writeChange(owner, p, redoOp, 'ben', (routine) => (templateWorkingSets(routine, p.change.exerciseId) === p.change.fromSets ? routine.version : null));
      if (w.kind === 'failed') return { ok: false, reason: 'failed', message: REVIEW_SERVICE_COPY.failed };
      if (w.kind === 'changed_since') return { ok: false, reason: 'changed_since', message: REVIEW_SERVICE_COPY.changedSince(p.change.routineName) };
      if (w.kind === 'pain') return { ok: false, reason: 'pain', message: REVIEW_SERVICE_COPY.heldPain };
      if (w.kind === 'stale') return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
      return outcome(await changeProposal(req.reviewId, req.proposalId, `${redoOp}:mark`, (x) => ({ ...x, status: 'applied', actionId: w.actionId })), line);
    },

    /** The coach status word (`● Coach`, `Offline`, `Coach not connected`). No provider call. */
    async status(): Promise<string> {
      if (deps.model === undefined) return BUILDER_STATUS_WORD.not_connected;
      const a = await deps.availability().catch((): CoachAvailability => ({ status: 'not_connected', model: null }));
      return BUILDER_STATUS_WORD[reachOf(a)];
    },

    /** Summary's `How did it feel?`: Ben's stored answer and the workout's version (the tap's `expectedVersion`). */
    async feelOf(sessionId: string): Promise<{ feel: 'easy' | 'good' | 'hard' | null; version: number } | null> {
      const owner = await deps.profile();
      const a = await repos()
        .sessions.get(sessionId)
        .catch(() => null);
      if (owner === null || a === null || a.session.ownerId !== owner.id || !isInHistory(a.session)) return null;
      return { feel: a.session.feel?.value ?? null, version: a.session.version };
    },

    /** Code's fact lines for a stored review (tests, diagnostics). */
    factLinesOf(r: TrainingReview, nameOf: (id: string) => string): string[] {
      const d = weekDataOfReview(r, nameOf);
      return d === null ? [] : reviewFactLines(d);
    },
  };
}

export type WeeklyReviewService = ReturnType<typeof createWeeklyReviewService>;

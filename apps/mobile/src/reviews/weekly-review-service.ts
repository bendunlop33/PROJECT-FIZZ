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
 * - **Proposals:** code's own (the same edit repeated, §6.1) and the coach's, each Apply / Skip; Apply is
 *   the routine's versioned write with an `update_routine` record (Undo restores the version before),
 *   refused when the template moved since (rule 5).
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
  checkWeeklyReview,
  codeProposals,
  requestBuilderTool,
  weeklyContextText,
  weeklyFactTexts,
  type BuilderCoachReach,
  type CoachModelPort,
} from '@fizz/coach';
import {
  addDays,
  deriveId,
  goalView,
  isDeleted,
  liftTargetsInUse,
  liveRoutines,
  localDateOf,
  localWeekBounds,
  planDayBodyParts,
  planInUseUntilUtc,
  planRoutines,
  pausedDates,
  proposalView,
  reviewCardView,
  reviewConsistencyView,
  reviewFactLines,
  reviewHistoryRow,
  reviewProposalText,
  reviewSessionOf,
  setsBarsView,
  liftChartView,
  splitInUse,
  stableStringify,
  toIso,
  toMs,
  weekDataOfReview,
  weekRangeText,
  weeklyFacts,
  weeklyReviewFacts,
  weeklyReviewWeek,
  weeklyReviewWorthwhile,
  withTemplateWorkingSets,
  WEEKLY_REVIEW,
  type GoalView,
  type LiftChartView,
  type ReviewCardView,
  type ReviewConsistencyView,
  type ReviewHistoryRow,
  type ReviewPlan,
  type ReviewProposalView,
  type ReviewSession,
  type ReviewTemplate,
  type ReviewWeekData,
  type SetsBarsView,
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
}

export interface ReviewsData {
  /** The newest weekly review, as the Latest card. Null: none yet. */
  latest: ReviewCardView | null;
  goal: GoalView;
  /** `13–19 Oct` for the Goal view's live week. */
  weekRange: string;
  liftsShown: { exerciseId: string; name: string }[];
  /** Whether Ben chose the lifts (false: the plan's main lifts). */
  liftsChosen: boolean;
  /** Older weekly reviews, newest first. */
  history: ReviewHistoryRow[];
  trainingVersion: number | null;
}

export interface ReviewDetail {
  card: ReviewCardView;
  consistency: ReviewConsistencyView;
  sets: SetsBarsView;
  lifts: LiftChartView[];
}

export type ProposalOutcome = { ok: true; line: string; proposal: ReviewProposalView } | { ok: false; reason: 'out_of_date' | 'changed_since' | 'missing' | 'failed'; message: string };

export const REVIEW_SERVICE_COPY = {
  outOfDate: 'Out of date',
  changedSince: (name: string) => `Can’t undo: ${name} changed since.`,
  failed: 'Couldn’t save',
  missing: 'Not found',
} as const;

const SESSION_WEEKS = WEEKLY_REVIEW.trendWeeks + WEEKLY_REVIEW.weeks + 1;
const HISTORY_LIMIT = 26;

function reachOf(a: CoachAvailability): BuilderCoachReach {
  if (a.status === 'ok' && a.model !== null) return 'ok';
  return a.status === 'offline' ? 'offline' : 'not_connected';
}

export function createWeeklyReviewService(deps: WeeklyReviewServiceDeps) {
  const repos = () => deps.store().repos;
  let running: Promise<WeeklyRun> | null = null;

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

  /** Every plan Ben applied (in use now or before), with its days and paused dates. */
  async function plansOf(owner: UserProfile, routines: readonly Routine[], pool: Map<string, Exercise>, training: TrainingProfile | null, from: string, to: string): Promise<{ plans: ReviewPlan[]; current: PlanDraft | null; currentDays: Routine[] }> {
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
    for (const d of drafts) {
      if (d.applied === null || (d.status !== 'applied' && d.status !== 'superseded' && d.status !== 'ended')) continue;
      const days = d.status === 'applied' ? planRoutines(d, live) : d.applied.made.map((m) => byId.get(m.routineId)).filter((r): r is Routine => r !== undefined);
      if (d.status === 'applied' && (current === null || (current.applied?.atUtc ?? '') < d.applied.atUtc)) {
        current = d;
        currentDays = days;
      }
      plans.push({
        planId: d.id,
        appliedAtUtc: d.applied.atUtc,
        untilUtc: planInUseUntilUtc(d),
        days: days.map((r) => ({ routineId: r.id, name: r.name, createdFromSessionId: r.createdFromSessionId ?? null, bodyParts: planDayBodyParts(r, of, split) })),
        pausedDates: pausedDates(d.pauses, from, to, owner.timezone, planInUseUntilUtc(d)),
      });
    }
    return { plans, current, currentDays };
  }

  function templatesOf(plan: PlanDraft | null, days: readonly Routine[], pool: Map<string, Exercise>): ReviewTemplate[] {
    if (plan === null) return [];
    return days.map((r) => ({
      planId: plan.id,
      routineId: r.id,
      name: r.name,
      version: r.version,
      exercises: r.exercises.map((e) => ({ exerciseId: e.exerciseId, name: pool.get(e.exerciseId)?.name ?? 'Exercise', workingSets: e.setTemplates.filter((t) => t.setType !== 'warmup').length })),
    }));
  }

  interface Gathered {
    owner: UserProfile;
    input: WeeklyReviewInput;
    training: TrainingProfile | null;
    pool: Map<string, Exercise>;
    liftsChosen: boolean;
    nameOf: (id: string) => string;
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
    const { plans, current, currentDays } = await plansOf(owner, routines, pool, training, from, to);
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
    let lifts: string[] = [...chosen];
    if (lifts.length === 0) {
      const mains = new Set<string>();
      for (const r of currentDays) {
        const m = r.planDay?.mainLiftExerciseId ?? r.exercises.find((e) => e.main === true)?.exerciseId;
        if (m != null) mains.add(m);
      }
      for (const m of (await deps.mainLiftIds?.().catch(() => null)) ?? []) mains.add(m);
      lifts = [...mains];
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
        liftTargets: liftTargetsInUse(training),
        activities,
        templates,
        painFlagged: new Set(pain.map((p) => p.exerciseId)),
        unit: owner.preferredUnit,
      },
    };
  }

  /** The inputs a review is made from (§6.1 cache key): the stored facts (not code's own tweak suggestions, so Apply doesn't re-run it), goal and lifts. */
  function inputsHashOf(g: Gathered, facts: ReturnType<typeof weeklyReviewFacts>): string {
    return deriveId(`weekly:${stableStringify({ facts: facts.filter((f) => f.kind !== 'template_edit'), goal: g.input.goal, lifts: g.input.lifts, templates: g.input.templates.map((t) => t.routineId) })}`).slice(0, 128);
  }

  const keyOf = (p: Pick<ReviewProposal, 'change'>): string => `${p.change.routineId}|${p.change.exerciseId}`;

  async function askCoach(g: Gathered, f: WeeklyFacts, reviewId: string, taken: readonly ReviewProposal[], signal?: AbortSignal): Promise<{ coach: ReviewCoach; proposals: ReviewProposal[]; status: BuilderCoachReach | 'failed' }> {
    if (deps.model === undefined) return { coach: { status: 'not_connected' }, proposals: [], status: 'not_connected' };
    const a = await deps.availability().catch((): CoachAvailability => ({ status: 'not_connected', model: null }));
    const reach = reachOf(a);
    if (reach !== 'ok' || a.model === null) return { coach: { status: reach === 'ok' ? 'not_connected' : reach }, proposals: [], status: reach === 'ok' ? 'not_connected' : reach };
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
      return { coach: { status }, proposals: [], status };
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
    // Ben's answers carry over (applied, skipped, undone, out of date); code's open suggestions are made again.
    const carried = (previous?.proposals ?? []).filter((p) => p.status !== 'open');
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
    };
    const w = await repos()
      .reviews.record(owner.id, review)
      .catch(() => null);
    if (w === null || w.status === 'invalid' || w.status === 'stale') return { kind: 'failed' };
    if (w.status === 'unchanged' || w.status === 'replayed') return { kind: 'cached', review: w.review };
    const stored = w.review;
    const asked = await askCoach(g, f, stored.id, stored.proposals ?? [], opts.signal);
    const coachOp = `${opId}:coach`;
    const latest = (await repos().reviews.get(stored.id).catch(() => null)) ?? stored;
    const mergedProposals = [...(latest.proposals ?? []), ...asked.proposals.filter((p) => !(latest.proposals ?? []).some((q) => keyOf(q) === keyOf(p)))].slice(0, 4);
    const next: TrainingReview = { ...latest, coach: asked.coach, proposals: mergedProposals, version: latest.version + 1, updatedAtUtc: deps.now().utc, opIds: [...latest.opIds, coachOp].slice(-20) };
    const u = await repos()
      .reviews.update(owner.id, next, latest.version, coachOp)
      .catch(() => null);
    const saved = u !== null && (u.status === 'written' || u.status === 'replayed') ? u.review : latest;
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

  return {
    /** On app open (§6.1). One run at a time; never throws. */
    runOnOpen(opts: { signal?: AbortSignal } = {}): Promise<WeeklyRun> {
      running ??= run(opts)
        .catch((): WeeklyRun => ({ kind: 'failed' }))
        .finally(() => {
          running = null;
        });
      return running;
    },

    /** Progress › Reviews: the Latest card, the Goal view (this week, live), Lifts shown, History. Local only. */
    async reviews(): Promise<ReviewsData | null> {
      const owner = await deps.profile();
      if (owner === null) return null;
      const now = deps.now();
      const nowMs = toMs(now.utc);
      const today = localDateOf(nowMs, owner.timezone);
      // The Goal view is this week so far (live); the Latest card is the stored review.
      const monday = localWeekBounds(nowMs, owner.timezone).mondayLocalDate;
      const g = await gather(monday);
      if (g === null) return null;
      const live = weeklyFacts(g.input);
      const stored = await repos()
        .reviews.listCurrent(owner.id, 'weekly', HISTORY_LIMIT + 1)
        .catch(() => [] as TrainingReview[]);
      const sorted = [...stored].sort((a, b) => (a.subject.kind === 'weekly' && b.subject.kind === 'weekly' ? (a.subject.weekMonday < b.subject.weekMonday ? 1 : -1) : 0));
      const [newest, ...older] = sorted;
      const newestData = newest === undefined ? null : viewsOf(newest, g.nameOf);
      return {
        latest: newest === undefined || newestData === null ? null : reviewCardView(newest, newestData, today),
        goal: goalView(live, g.input.goal, today),
        weekRange: weekRangeText(monday),
        liftsShown: g.input.lifts.map((id) => ({ exerciseId: id, name: g.nameOf(id) })),
        liftsChosen: g.liftsChosen,
        history: older.flatMap((r) => {
          const d = viewsOf(r, g.nameOf);
          return d === null ? [] : [reviewHistoryRow(r, d, today)];
        }),
        // No row yet: the defaults are version 1 (the first change writes them).
        trainingVersion: g.training?.version ?? 1,
      };
    },

    /** One stored review in full (History › a week). */
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
      return { card: reviewCardView(r, d, today, 99), consistency: reviewConsistencyView(d, today), sets: setsBarsView(d.groups), lifts: d.lifts.map((l) => liftChartView(l, today)) };
    },

    /** `Lifts shown` editor: every exercise Ben has logged in the window (newest first) and whether it is shown. */
    async liftChoices(): Promise<LiftChoice[]> {
      const owner = await deps.profile();
      if (owner === null) return [];
      const nowMs = toMs(deps.now().utc);
      const g = await gather(weeklyReviewWeek(nowMs, owner.timezone));
      if (g === null) return [];
      const shown = new Set(g.input.lifts);
      const newest = [...g.input.sessions].sort((a, b) => b.startedMs - a.startedMs);
      const seen = new Set<string>();
      const out: LiftChoice[] = [];
      for (const s of newest)
        for (const e of s.exercises) {
          if (seen.has(e.exerciseId) || !e.sets.some((x) => x.setType !== 'warmup')) continue;
          const info = g.pool.get(e.exerciseId);
          if (info?.measurement === 'cardio') continue;
          seen.add(e.exerciseId);
          out.push({ exerciseId: e.exerciseId, name: g.nameOf(e.exerciseId), shown: shown.has(e.exerciseId) });
        }
      for (const id of g.input.lifts) if (!seen.has(id)) out.unshift({ exerciseId: id, name: g.nameOf(id), shown: true });
      return out;
    },

    /** Apply on a proposal (Ben's tap, rule 3): the template's next version, refused when it moved since (rule 5). */
    async applyProposal(req: { reviewId: string; proposalId: string; opId: string }): Promise<ProposalOutcome> {
      const found = await proposalOf(req.reviewId, req.proposalId);
      if (found === null) return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
      const { owner, proposal: p } = found;
      const line = reviewProposalText(p);
      if (p.status === 'applied') return outcome(p, line);
      if (p.status !== 'open') return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
      const actionId = deriveId(`review-apply:${req.opId}`);
      // A double tap, or a retry after a force-close: the write under this op ID already happened.
      const prior = await repos()
        .coach.getAction(actionId)
        .catch(() => null);
      if (prior !== null) return outcome(await changeProposal(req.reviewId, req.proposalId, `${req.opId}:mark`, (x) => ({ ...x, status: 'applied', actionId })), line);
      const markStale = async (): Promise<ProposalOutcome> => {
        await changeProposal(req.reviewId, req.proposalId, `${req.opId}:stale`, (x) => ({ ...x, status: 'stale' }));
        return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
      };
      const routine = await repos()
        .routines.get(p.change.routineId)
        .catch(() => null);
      if (routine === null || routine.ownerId !== owner.id || isDeleted(routine)) return markStale();
      const at = deps.now();
      const c = withTemplateWorkingSets(routine, { exerciseId: p.change.exerciseId, toSets: p.change.toSets, expectedVersion: p.change.expectedVersion, opId: req.opId, atUtc: at.utc });
      if (c.kind !== 'write') return markStale();
      const action: ActionRecord = {
        actionId,
        turnId: null,
        opId: req.opId,
        status: 'committed',
        author: 'ben',
        detail: { kind: 'update_routine', routineId: routine.id, routineName: routine.name, changes: [{ change: 'edit', text: line.slice(0, 200) }], before: routine, versionBefore: routine.version, versionAfter: c.next.version, draft: null },
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
      if (w === null) return { ok: false, reason: 'failed', message: REVIEW_SERVICE_COPY.failed };
      if (w.status === 'stale' || w.status === 'missing') return markStale();
      return outcome(await changeProposal(req.reviewId, req.proposalId, `${req.opId}:mark`, (x) => ({ ...x, status: 'applied', actionId: w.action.actionId })), line);
    },

    /** Skip: nothing changes in the plan. */
    async skipProposal(req: { reviewId: string; proposalId: string; opId: string }): Promise<ProposalOutcome> {
      const found = await proposalOf(req.reviewId, req.proposalId);
      if (found === null) return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
      if (found.proposal.status !== 'open' && found.proposal.status !== 'skipped') return { ok: false, reason: 'out_of_date', message: REVIEW_SERVICE_COPY.outOfDate };
      return outcome(await changeProposal(req.reviewId, req.proposalId, req.opId, (x) => ({ ...x, status: 'skipped' })), reviewProposalText(found.proposal));
    },

    /** Undo of an Apply: the template's version before, while it is still at the version Apply made (rule 5). */
    async undoProposal(req: { reviewId: string; proposalId: string; opId: string }): Promise<ProposalOutcome> {
      const found = await proposalOf(req.reviewId, req.proposalId);
      if (found === null || found.proposal.actionId === null) return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
      const { owner, proposal: p } = found;
      if (p.status === 'undone') return outcome(p, reviewProposalText(p));
      const target = await repos()
        .coach.getAction(p.actionId ?? '')
        .catch(() => null);
      if (target === null || target.detail.kind !== 'update_routine') return { ok: false, reason: 'missing', message: REVIEW_SERVICE_COPY.missing };
      const at = deps.now();
      const undo: ActionRecord = {
        ...target,
        actionId: deriveId(`review-undo:${req.opId}`),
        opId: req.opId,
        author: 'ben',
        detail: { kind: 'undo', undoneActionId: target.actionId, what: `the change to ${target.detail.routineName}`.slice(0, 200), restored: [], alreadyLogged: [] },
        entityVersions: [],
        undoneBy: null,
        createdAt: at,
      };
      const r = await repos()
        .drafts.undoRoutineChange({ ownerId: owner.id, undo, at, newRoutineAtUtc: at.utc })
        .catch(() => null);
      if (r === null) return { ok: false, reason: 'failed', message: REVIEW_SERVICE_COPY.failed };
      if (r.status === 'not_possible') return { ok: false, reason: 'changed_since', message: REVIEW_SERVICE_COPY.changedSince(p.change.routineName) };
      return outcome(await changeProposal(req.reviewId, req.proposalId, `${req.opId}:mark`, (x) => ({ ...x, status: 'undone' })), reviewProposalText(p));
    },

    /** The coach status word for the Reviews header (`● Coach`, `Offline`, `Coach not connected`). No provider call. */
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
      if (owner === null || a === null || a.session.ownerId !== owner.id || a.session.status !== 'finished') return null;
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

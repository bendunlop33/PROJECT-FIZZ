/**
 * The builder's coach (workout-builder-v3 §2.0.2 Mix it up, §2.6, §2.9, §5,
 * §6.1 pre-session nudge). In-process; the only network call is the model
 * port, and nothing in Set up, Your workout, Today or logging waits for it
 * (rule 1): every manual path works without it, and Set up words still fill
 * the set-up by code when it's offline (§9 Q4), with no coach bubble.
 *
 * What it reads and writes goes through ports the builder and Today streams
 * own (`BuilderCoachSource`, `BuilderCoachWriter`), so the checks here never
 * reach into their storage. Every write is Ben's tap (Apply, Done) or his ask
 * (Set up), idempotent on its op ID and versioned (rule 5).
 *
 * Not proven on the device: the ChatGPT-plan route with these one-tool
 * requests has to run on Ben's iPhone before it counts as working.
 */

import {
  BUILDER_STATUS_WORD,
  builderApplyOpId,
  builderFacts,
  builderModelFor,
  builderWorkoutView,
  buildEditRequest,
  buildMixRequest,
  buildNudgeRequest,
  buildReviewRequest,
  buildSetupRequest,
  checkCoachText,
  checkFillSetup,
  checkMixPick,
  checkNudge,
  checkReview,
  codeMixPick,
  makeBuilderProposal,
  NO_NUMBERS,
  reviewClaimBase,
  workoutClaimCheck,
  type ClaimBase,
  memoryContentKey,
  mixContextText,
  newActionRecord,
  nudgeContextText,
  nudgeOffer,
  nudgeReviewFacts,
  parseSetupWords,
  preSessionSignals,
  recheckBuilderProposal,
  requestBuilderTool,
  reviewFactLines,
  reviewFacts,
  setupContextText,
  signalLine,
  type BuilderCoachEnv,
  type BuilderCoachExtras,
  type BuilderCoachReach,
  type BuilderCoachSnapshot,
  type BuilderProposal,
  type BuilderReviewFacts,
  type BuilderToolAnswer,
  type CheckedReview,
  type CoachModelPort,
  type MixPick,
  type NudgeOffer,
  type PreSessionInput,
  type ReviewNote,
  type ReviewPlanDay,
  type SetupCoachContext,
  type SetupFill,
} from '@fizz/coach';
import { deriveId, estimateBuilderMinutes, infoOrDefault, parseBuildRequest, slotsOf, stableStringify, toMs, type BuilderGroupName, type BuilderWorkout } from '@fizz/domain';
import {
  BUILDER_COACH_TOOL,
  type ActionDetail,
  type BuilderCoachToolName,
  type Memory,
  type MuscleGroup,
  type ReviewCoach,
  type ReviewFact,
  type ReviewSubject,
  type TrainingReview,
  type ZonedTimestamp,
} from '@fizz/schemas';
import type { CoachWrite, CoachWriteResult } from '@fizz/schemas';
import type { ReviewWrite } from '@fizz/persistence';
import type { CoachAvailability } from './coach-service';

// ---------------------------------------------------------------------------
// Ports (wired at the merge by the builder and Today streams)

/** Today's builder draft as the coach sees and checks it. */
export interface BuilderCoachWorld {
  snapshot: BuilderCoachSnapshot;
  /** The checks' context: rules context, gym availability, pain flags, the load guard. `askedHeavier` is read from Ben's words here. */
  env: Omit<BuilderCoachEnv, 'askedHeavier'>;
  extras: BuilderCoachExtras;
}

/** Where Set up words were asked: on Set up itself, or Today's coach bar (§2.0.5, §2.1: opens the builder on Set up, filled). */
export type SetupFrom = 'setup' | 'today';

export interface BuilderCoachSource {
  /** The open builder draft (or Today's card draft) by ID; null when it's gone. */
  world(draftId: string): Promise<BuilderCoachWorld | null>;
  /**
   * Set up's context, with its day and main-lift options. `setup`: Set up as it stands (null: it isn't
   * open). `today`: a fresh Set up for Today's card (its day, length and groups), before the builder opens.
   */
  setup(from: SetupFrom): Promise<SetupCoachContext | null>;
}

export type BuilderWriteResult = { ok: true } | { ok: false; reason: 'stale' | 'failed' };

/**
 * The builder stream's writes (wired at the merge). Contract notes from the reviews (b3-coach S11):
 * - `applyWorkout` keeps the draft's `origin: 'builder'` and writes builder loads through the same
 *   codec the builder uses, or Start re-fits them.
 * - Every slot a coach apply changes gets its `DraftSlot.rev` bumped (rule 5: other proposals and
 *   review suggestions touching it then read `Out of date`), and a length change bumps Set up's revision.
 */
export interface BuilderCoachWriter {
  /**
   * Apply a checked set-up at once, with the builder's Undo toast; a retry with the same op ID writes once.
   * `openBuilder`: asked from Today, so the builder opens on Set up, filled, with the toast there.
   */
  applySetup(fill: SetupFill, opId: string, opts: { openBuilder: boolean }): Promise<BuilderWriteResult>;
  /**
   * Write a checked workout as a new draft version (§4.4: applied coach proposals make a version) with
   * its Undo snapshot; refused (`stale`) when the draft moved past `expectedVersion`; idempotent on `opId`.
   */
  applyWorkout(req: { draftId: string; expectedVersion: number; workout: BuilderWorkout; minutes: number; lines: readonly string[]; opId: string }): Promise<BuilderWriteResult>;
  /** Whether a write under this op ID already happened (a double tap, or a retry after a force-close). */
  applied(opId: string): Promise<boolean>;
}

/** The reviews table for the owner (`SqliteReviews`, migration 30). */
export interface BuilderReviewsPort {
  current(subject: ReviewSubject): Promise<TrainingReview | null>;
  record(review: TrainingReview): Promise<ReviewWrite>;
  update(next: TrainingReview, expectedVersion: number, opId: string): Promise<ReviewWrite>;
}

/** `For next <day> day` notes (Your data, rule 10). */
export interface DayNotesPort {
  saveText(note: { text: string; splitDayId: string; mainLiftExerciseId: string | null; reviewId: string | null; opId: string }): Promise<'saved' | 'duplicate' | 'failed'>;
  /** A numeric note: the coach's target for that lift next time (§2.9, §3.1 step 1). Absent: not wired yet. */
  saveTarget?: (note: Extract<ReviewNote, { kind: 'target' }> & { splitDayId: string; reviewId: string | null; opId: string }) => Promise<'saved' | 'duplicate' | 'failed'>;
}

export interface BuilderCoachServiceDeps {
  availability: () => Promise<CoachAvailability>;
  /** The model port (the plan route). Absent: the coach isn't in this build's wiring. */
  model?: () => CoachModelPort;
  now: () => ZonedTimestamp;
  newId: () => string;
  ownerId: () => Promise<string>;
  source: BuilderCoachSource;
  writer: BuilderCoachWriter;
  reviews?: BuilderReviewsPort;
  dayNotes?: DayNotesPort;
}

// ---------------------------------------------------------------------------
// Results

/**
 * How a coach call went: `ok` and the reach words, or `failed` (connected, but the call didn't give a usable
 * answer: invalid arguments, a limit, a timeout). Never reported as `Coach not connected` (review S12).
 */
export type CoachCallStatus = BuilderCoachReach | 'failed';

export type SetupAsk =
  /** Filled at once; `toast` is the Undo toast's words. `by: 'code'`: read by code (offline), no coach bubble. */
  | { kind: 'filled'; by: 'coach' | 'code'; toast: string; notes: string[]; reply: string | null; status: CoachCallStatus }
  /** The coach answered a question; nothing to fill. */
  | { kind: 'reply'; text: string; status: CoachCallStatus }
  | { kind: 'not_understood'; line: 'Not understood'; status: CoachCallStatus }
  /** Set up isn't open (and Today's card has no day to set up), or the write failed. */
  | { kind: 'failed'; status: CoachCallStatus };

export type EditAsk =
  | { kind: 'proposal'; proposal: BuilderProposal; status: 'ok' }
  /** The coach answered (or nothing it asked for could be done: `notes` says why). */
  | { kind: 'reply'; text: string | null; notes: string[]; status: 'ok' }
  /** Offline / not connected / the call failed: the bar shows the word; manual edits all still work. */
  | { kind: 'unavailable'; status: CoachCallStatus }
  /** The draft is gone (deleted, or started): nothing to change. */
  | { kind: 'gone' };

export type ApplyResult = { kind: 'applied'; lines: string[] } | { kind: 'out_of_date'; line: 'Out of date. Ask again.' } | { kind: 'failed' };

export interface BuilderReviewResult {
  /** The review's ID (day notes saved from it carry it, so `From last review` shows one review's notes). */
  reviewId: string;
  status: 'reviewed' | 'offline' | 'not_connected' | 'failed';
  /** Whether Done can save its notes (the day-notes port is wired); false: the notes aren't shown. */
  notesSaveable: boolean;
  facts: BuilderReviewFacts;
  /** Code's `Add back <name>` suggestions (proposals), shown with or without the coach. */
  addBack: { id: string; name: string; proposal: BuilderProposal }[];
  coach: CheckedReview | null;
}

export type NudgeResult =
  /**
   * Nothing to say. `by: 'code'`: no clear signal, so the coach wasn't asked (and this is only returned when
   * it could have been, connected); `by: 'coach'`: it was asked and chose silence.
   */
  | { kind: 'silent'; by: 'code' | 'coach' }
  /** The coach's line, with code's offer as `Apply` (rule 3: an offer, applied only on Ben's tap). */
  | { kind: 'line'; line: string; offer: NudgeOffer | null }
  /** Ben applied or skipped today's offer: nothing on the card again today (review B1); the line stays for `Why?`. */
  | { kind: 'settled'; line: string | null; outcome: 'applied' | 'skipped' }
  /** The coach didn't look (offline, not connected, or the call failed): `Not reviewed · …` (rule 1). */
  | { kind: 'not_reviewed'; status: Exclude<BuilderCoachReach, 'ok'> | 'failed' };

/** Markers in the pre-session review's op IDs: the offer was applied or skipped (review B1). */
const NUDGE_SETTLED = { applied: 'nudge-applied:', skipped: 'nudge-skipped:' } as const;

function nudgeSettledOf(r: TrainingReview): 'applied' | 'skipped' | null {
  if (r.opIds.some((o) => o.startsWith(NUDGE_SETTLED.applied))) return 'applied';
  if (r.opIds.some((o) => o.startsWith(NUDGE_SETTLED.skipped))) return 'skipped';
  return null;
}

// ---------------------------------------------------------------------------

/** One status word's state (§2.6): ok only when connected with a model; offline as is; anything else not connected. */
export function builderReachOf(a: CoachAvailability): BuilderCoachReach {
  if (a.status === 'ok' && a.model !== null) return 'ok';
  return a.status === 'offline' ? 'offline' : 'not_connected';
}

export { BUILDER_STATUS_WORD };

const OFFLINE_HOLD_MS = 60 * 1000;

const PART_GROUP: Readonly<Record<string, MuscleGroup>> = { quads: 'Quads', hamstrings_glutes: 'Hamstrings', calves: 'Calves' };
const GROUP_MUSCLE: Readonly<Record<BuilderGroupName, MuscleGroup | null>> = { Chest: 'Chest', Back: 'Back', Shoulders: 'Shoulders', Biceps: 'Biceps', Triceps: 'Triceps', Abs: 'Core', Legs: null };

/** The review's facts as stored (code only, rule 6). */
export function sessionReviewFacts(f: BuilderReviewFacts): ReviewFact[] {
  const out: ReviewFact[] = [];
  const sets = new Map<MuscleGroup, number>();
  for (const g of f.groupSets) {
    const m = g.group === 'Legs' ? (g.part === null ? null : (PART_GROUP[g.part] ?? null)) : GROUP_MUSCLE[g.group];
    if (m !== null) sets.set(m, (sets.get(m) ?? 0) + g.sets);
  }
  for (const [group, n] of sets) out.push({ kind: 'group_sets', group, sets: Math.min(500, n), planned: null, range: null });
  for (const l of f.plan?.lines ?? []) out.push({ kind: 'plan_line', line: l.key, ok: l.ok, actual: l.actual, planned: l.planned, exerciseIds: l.exerciseIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10) });
  return out;
}

export function createBuilderCoachService(deps: BuilderCoachServiceDeps) {
  let lastNetworkFailureMs: number | null = null;
  const nowMs = (): number => toMs(deps.now().utc);

  async function reach(): Promise<{ reach: BuilderCoachReach; models: { main: string; light: string | null } | null }> {
    if (deps.model === undefined) return { reach: 'not_connected', models: null };
    const a = await deps.availability().catch((): CoachAvailability => ({ status: 'not_connected', model: null }));
    let r = builderReachOf(a);
    if (r === 'ok' && lastNetworkFailureMs !== null && nowMs() - lastNetworkFailureMs < OFFLINE_HOLD_MS) r = 'offline';
    return { reach: r, models: r === 'ok' && a.model !== null ? { main: a.model, light: a.workoutModelGone === true ? null : (a.workoutModel ?? null) } : null };
  }

  async function call<K extends BuilderCoachToolName>(req: Parameters<typeof requestBuilderTool>[1], tool: K, signal?: AbortSignal): Promise<BuilderToolAnswer<K>> {
    const port = deps.model?.();
    if (port === undefined) return { ok: false, error: 'unavailable' };
    const r = await requestBuilderTool(port, req, tool, signal === undefined ? {} : { signal });
    if (!r.ok && r.error === 'network') lastNetworkFailureMs = nowMs();
    else if (r.ok) lastNetworkFailureMs = null;
    return r;
  }

  /** A failed call's status: the network is `offline`; a route that can't answer (signed out, not eligible, gone) is not connected; anything else `failed`. */
  const failedReach = (r: BuilderToolAnswer<BuilderCoachToolName>): CoachCallStatus => {
    if (r.ok) return 'ok';
    switch (r.error) {
      case 'network':
      case 'timeout':
        return 'offline';
      case 'auth_expired':
      case 'not_eligible':
      case 'model_gone':
      case 'unavailable':
        return 'not_connected';
      case 'usage_limit':
      case 'cancelled':
      case 'invalid_args':
      case 'no_answer':
        return 'failed';
    }
  };

  function envFor(world: BuilderCoachWorld, words: string): BuilderCoachEnv {
    return { ...world.env, askedHeavier: parseBuildRequest(words).askedHeavier };
  }

  /** The claim check's base for a workout: code's counts, lengths and Ben's words only (never IDs, slot keys or memories; B2). */
  function claimBase(world: BuilderCoachWorld, words = ''): ClaimBase {
    return { ctx: world.env.ctx, minutes: [world.snapshot.minutes, estimateBuilderMinutes(world.snapshot.workout, world.env.ctx)], words };
  }

  /** The session review record (Your data); its ID when written or already current. */
  async function storeSessionReview(input: { reviewId: string; world: BuilderCoachWorld; facts: BuilderReviewFacts; coach: CheckedReview | null; status: BuilderReviewResult['status']; opId: string }): Promise<string | null> {
    if (deps.reviews === undefined) return null;
    const now = deps.now();
    const subject: ReviewSubject = { kind: 'session', draftId: input.world.snapshot.draftId, draftVersion: input.world.snapshot.draftVersion };
    const coachPart: ReviewCoach =
      input.coach === null
        ? { status: input.status === 'reviewed' ? 'failed' : input.status }
        : { status: 'reviewed', verdict: input.coach.verdict, lines: [...input.coach.suggestions.map((s) => s.proposal.lines.join(' · ').slice(0, 300)), ...input.coach.notes.map((n) => n.text)].slice(0, 10), actionIds: [], numbersChecked: true };
    const review: TrainingReview = {
      id: input.reviewId,
      ownerId: await deps.ownerId(),
      version: 1,
      createdAtUtc: now.utc,
      updatedAtUtc: now.utc,
      subject,
      inputsHash: deriveId(`inputs:${stableStringify({ w: input.world.snapshot.workout, m: input.world.snapshot.minutes, f: input.facts })}`),
      facts: sessionReviewFacts(input.facts).slice(0, 60),
      coach: coachPart,
      status: 'current',
      supersededById: null,
      opIds: [input.opId],
      createdAt: now,
    };
    const w = await deps.reviews.record(review).catch(() => null);
    if (w === null || w.status === 'invalid' || w.status === 'stale') return null;
    if (w.status === 'retry_coach' && coachPart.status === 'reviewed') {
      const next: TrainingReview = { ...w.review, coach: coachPart, version: w.review.version + 1, updatedAtUtc: now.utc, opIds: [...w.review.opIds, input.opId].slice(-20) };
      await deps.reviews.update(next, w.review.version, input.opId).catch(() => null);
    }
    return w.review.id;
  }

  const service = {
    /** The bar's status word now (`● Coach`, `Offline`, `Coach not connected`). No provider call. */
    async status(): Promise<BuilderCoachReach> {
      return (await reach()).reach;
    },

    /**
     * Set up's bar (§2.6): the words fill the set-up at once with Undo. Connected: the coach's
     * `fill_setup`, checked. Offline, not connected, or the call failed: code reads the words
     * (§9 Q4) — no coach message, and `Not understood` when it reads nothing.
     */
    async askSetup(req: { words: string; opId: string; from?: SetupFrom; signal?: AbortSignal }): Promise<SetupAsk> {
      const from = req.from ?? 'setup';
      const ctx = await deps.source.setup(from);
      const r = await reach();
      if (ctx === null) return { kind: 'failed', status: r.reach };
      const write = { openBuilder: from === 'today' };
      let status: CoachCallStatus = r.reach;
      if (r.reach === 'ok' && r.models !== null) {
        const answer = await call(buildSetupRequest(ctx, req.words, builderModelFor('setup', r.models)), BUILDER_COACH_TOOL.fillSetup, req.signal);
        if (answer.ok) {
          const facts = builderFacts([setupContextText(ctx), req.words]);
          const reply = checkCoachText(answer.args.reply, facts).shown;
          const fill = checkFillSetup(answer.args, ctx, req.words);
          if (fill === null) return reply === null ? { kind: 'not_understood', line: 'Not understood', status: 'ok' } : { kind: 'reply', text: reply, status: 'ok' };
          const w = await deps.writer.applySetup(fill, req.opId, write);
          return w.ok ? { kind: 'filled', by: 'coach', toast: fill.toast, notes: fill.notes, reply, status: 'ok' } : { kind: 'failed', status: 'ok' };
        }
        status = failedReach(answer);
      }
      const args = parseSetupWords(req.words, ctx);
      const fill = args === null ? null : checkFillSetup(args, ctx, req.words);
      if (fill === null) return { kind: 'not_understood', line: 'Not understood', status };
      const w = await deps.writer.applySetup(fill, req.opId, write);
      return w.ok ? { kind: 'filled', by: 'code', toast: fill.toast, notes: fill.notes, reply: null, status } : { kind: 'failed', status };
    },

    /**
     * Your workout's bar (§2.6): a proposal with code-made before/after lines, Apply / Skip.
     * Offline or not connected: `unavailable` (the bar shows the word and is disabled).
     */
    async askEdit(req: { draftId: string; words: string; opId: string; signal?: AbortSignal }): Promise<EditAsk> {
      const r = await reach();
      if (r.reach !== 'ok' || r.models === null) return { kind: 'unavailable', status: r.reach === 'ok' ? 'not_connected' : r.reach };
      const world = await deps.source.world(req.draftId);
      if (world === null) return { kind: 'gone' };
      const env = envFor(world, req.words);
      const view = builderWorkoutView(world.snapshot, env.ctx, estimateBuilderMinutes(world.snapshot.workout, env.ctx));
      const answer = await call(buildEditRequest(view, world.extras, req.words, builderModelFor('edit', r.models)), BUILDER_COACH_TOOL.proposeWorkoutEdit, req.signal);
      if (!answer.ok) return { kind: 'unavailable', status: failedReach(answer) };
      const made = makeBuilderProposal({ id: req.opId, snapshot: world.snapshot, ops: answer.args.ops, words: answer.args.reply, check: workoutClaimCheck(world.snapshot.workout, claimBase(world, req.words)), env });
      if (made.proposal === null) return { kind: 'reply', text: made.reason, notes: made.outcome.notes, status: 'ok' };
      return { kind: 'proposal', proposal: made.proposal, status: 'ok' };
    },

    /**
     * Apply on a proposal, review suggestion or pre-session offer (rule 3: only on Ben's tap). Checked
     * against the draft as it is now: `Out of date. Ask again.` when a slot it touches changed, or
     * the same ops no longer give the lines Ben saw; then one versioned write under one op ID.
     */
    async apply(proposal: BuilderProposal): Promise<ApplyResult> {
      // A double tap, or a retry after a force-close: already written under this op ID (review S1).
      if (await deps.writer.applied(builderApplyOpId(proposal.id)).catch(() => false)) return { kind: 'applied', lines: proposal.lines };
      const world = await deps.source.world(proposal.draftId);
      if (world === null) return { kind: 'out_of_date', line: 'Out of date. Ask again.' };
      const env: BuilderCoachEnv = { ...world.env, askedHeavier: false };
      const check = recheckBuilderProposal(proposal, world.snapshot, env);
      if (!check.ok) return { kind: 'out_of_date', line: check.line };
      const w = await deps.writer.applyWorkout({ draftId: proposal.draftId, expectedVersion: world.snapshot.draftVersion, workout: check.outcome.workout, minutes: check.outcome.minutes, lines: proposal.lines, opId: builderApplyOpId(proposal.id) });
      if (w.ok) return { kind: 'applied', lines: proposal.lines };
      return w.reason === 'stale' ? { kind: 'out_of_date', line: 'Out of date. Ask again.' } : { kind: 'failed' };
    },

    /**
     * `Coach review` (§2.9). Code's facts always (counts, variety, Plan with `Add back`); with the
     * coach, its verdict, suggestions and notes after the number check (review effort high, main
     * model). Stored as a session review (Your data); a new one only when the inputs changed.
     */
    async review(req: { draftId: string; opId: string; groups: readonly BuilderGroupName[]; plan: ReviewPlanDay | null; signal?: AbortSignal }): Promise<BuilderReviewResult | null> {
      const world = await deps.source.world(req.draftId);
      if (world === null) return null;
      const env: BuilderCoachEnv = { ...world.env, askedHeavier: false };
      const facts = reviewFacts({ snapshot: world.snapshot, ctx: env.ctx, groups: req.groups, plan: req.plan });
      const lines = reviewFactLines(facts);
      const claims = reviewClaimBase(facts, { ctx: env.ctx, minutes: claimBase(world).minutes, plan: req.plan });
      const addBack = facts.addBack.flatMap((a) => {
        const p = makeBuilderProposal({ id: `${req.opId}:add:${a.exerciseId}`, snapshot: world.snapshot, ops: [{ op: 'add', exerciseId: a.exerciseId, afterSlotKey: null, workingSets: a.workingSets }], words: null, check: NO_NUMBERS, env }).proposal;
        return p === null ? [] : [{ id: p.id, name: a.name, proposal: p }];
      });
      const r = await reach();
      let status: BuilderReviewResult['status'] = r.reach === 'ok' ? 'failed' : r.reach;
      let coach: CheckedReview | null = null;
      const reviewId = deriveId(`builder-review:${req.opId}`);
      if (r.reach === 'ok' && r.models !== null) {
        const view = builderWorkoutView(world.snapshot, env.ctx, estimateBuilderMinutes(world.snapshot.workout, env.ctx));
        const answer = await call(buildReviewRequest(view, world.extras, lines, builderModelFor('review', r.models)), BUILDER_COACH_TOOL.reviewWorkout, req.signal);
        if (answer.ok) {
          coach = checkReview({ reviewId, args: answer.args, snapshot: world.snapshot, env, claims });
          status = 'reviewed';
        } else {
          const st = failedReach(answer);
          status = st === 'ok' ? 'failed' : st;
        }
      }
      const stored = await storeSessionReview({ reviewId, world, facts, coach, status, opId: req.opId });
      return { reviewId: stored ?? reviewId, status, notesSaveable: deps.dayNotes !== undefined, facts, addBack, coach };
    },

    /**
     * Done (or swipe down) on the review: the ticked `For next <day> day` notes are saved (Your data).
     * Text notes become day notes. A numeric note becomes the coach's target for that lift when that is
     * wired (SP2, Ben to decide); until then it is saved as a text day note in code's words
     * (`Bench top set: 102.5 kg next`), so it shows under `From last review` and reaches the coach (B4).
     * `notSaved`: the IDs that failed, for a one-word `Not saved` on the sheet.
     */
    async saveReviewNotes(req: { notes: readonly ReviewNote[]; ticked: ReadonlySet<string>; splitDayId: string; mainLiftExerciseId: string | null; reviewId: string | null; opId: string }): Promise<{ saved: number; skipped: number; notSaved: string[] }> {
      let saved = 0;
      const notSaved: string[] = [];
      const asText = (n: ReviewNote, opId: string) => deps.dayNotes?.saveText({ text: n.text, splitDayId: req.splitDayId, mainLiftExerciseId: req.mainLiftExerciseId, reviewId: req.reviewId, opId }) ?? Promise.resolve('failed' as const);
      for (const n of req.notes) {
        if (!req.ticked.has(n.id)) continue;
        const opId = `${req.opId}:${n.id}`;
        const target = n.kind === 'target' ? deps.dayNotes?.saveTarget : undefined;
        const r = n.kind === 'target' && target !== undefined ? await target({ ...n, splitDayId: req.splitDayId, reviewId: req.reviewId, opId }) : await asText(n, opId);
        if (r === 'failed') notSaved.push(n.id);
        else saved += 1;
      }
      return { saved, skipped: notSaved.length, notSaved };
    },

    /**
     * `↻ Mix it up` (§2.0.2): the coach picks from code's shortlist with a one-line reason (light
     * model); offline or on any failure, code's pick, labelled not reviewed. Null: empty shortlist.
     */
    async mixPick(req: { fromExerciseId: string; shortlist: readonly string[]; lastDone: (exerciseId: string) => string | null; world: BuilderCoachWorld; signal?: AbortSignal }): Promise<MixPick | null> {
      if (req.shortlist.length === 0) return null;
      const r = await reach();
      if (r.reach !== 'ok' || r.models === null) return codeMixPick(req.shortlist, r.reach === 'ok' ? 'not_connected' : r.reach);
      const name = (id: string) => infoOrDefault(req.world.env.ctx.info, id).name;
      const text = mixContextText({ from: name(req.fromExerciseId), shortlist: req.shortlist.map((id) => ({ exerciseId: id, name: name(id), lastDone: req.lastDone(id) })), extras: { goal: req.world.extras.goal, memories: req.world.extras.memories, history: req.world.extras.history } });
      const answer = await call(buildMixRequest(text, builderModelFor('mix', r.models)), BUILDER_COACH_TOOL.mixPick, req.signal);
      if (!answer.ok) {
        const st = failedReach(answer);
        return codeMixPick(req.shortlist, st === 'offline' || st === 'not_connected' ? st : 'failed');
      }
      return checkMixPick(answer.args, req.shortlist, builderFacts([text]));
    },

    /**
     * The pre-session nudge (§6.1), opening Today. Silent unless code finds a clear real signal; only
     * then is the coach asked (light model), and only when the inputs (the signals and the plan day)
     * changed since today's stored one: never again because the draft moved, so an applied offer
     * isn't offered again a step lighter (review B1). Its line comes with code's offer as `Apply`
     * (rule 3). Once Ben applies or skips it (`applyNudge`, `skipNudge`), it is `settled` for the day.
     * The connection is always read, so offline or not connected is `not_reviewed` even with no
     * signal (review B5, rule 1).
     */
    async preSessionNudge(req: { draftId: string; splitDayId: string | null; input: PreSessionInput; opId: string; signal?: AbortSignal }): Promise<NudgeResult> {
      const r = await reach();
      const world = await deps.source.world(req.draftId);
      if (world === null) return r.reach === 'ok' ? { kind: 'silent', by: 'code' } : { kind: 'not_reviewed', status: r.reach };
      const env: BuilderCoachEnv = { ...world.env, askedHeavier: false };
      const slots = slotsOf(world.snapshot.workout.blocks);
      const ids = new Set(slots.map((s) => s.exerciseId));
      const hasLegs = slots.some((s) => infoOrDefault(env.ctx.info, s.exerciseId).group === 'Legs');
      const signals = preSessionSignals(req.input, ids, hasLegs);
      const name = (id: string) => infoOrDefault(env.ctx.info, id).name;
      const signalLines = signals.map((s) => signalLine(s, name));
      const offer = signals.length === 0 ? null : nudgeOffer(signals, world.snapshot, env);
      const text = nudgeContextText({ day: world.snapshot.dayName, signals: signalLines, offer: offer === null ? null : { id: offer.id, lines: offer.proposal.lines }, extras: { goal: world.extras.goal, painFlags: world.extras.painFlags } });
      const facts = builderFacts([text]);
      const subject: ReviewSubject = { kind: 'pre_session', localDate: req.input.today, splitDayId: req.splitDayId, draftId: req.draftId };
      // The inputs: the signals and the plan day only (not the draft or the offer, which move with Apply).
      const inputsHash = deriveId(`nudge:${stableStringify({ signals, splitDayId: req.splitDayId })}`);
      const first: ReviewCoach = signals.length === 0 ? { status: 'silent' } : r.reach === 'ok' ? { status: 'pending' } : { status: r.reach };
      const quiet = (): NudgeResult => (r.reach === 'ok' ? { kind: 'silent', by: 'code' } : { kind: 'not_reviewed', status: r.reach });

      const now = deps.now();
      const reviewId = deriveId(`nudge-review:${req.opId}`);
      let stored: TrainingReview | null = null;
      if (deps.reviews !== undefined) {
        const review: TrainingReview = { id: reviewId, ownerId: await deps.ownerId(), version: 1, createdAtUtc: now.utc, updatedAtUtc: now.utc, subject, inputsHash, facts: nudgeReviewFacts(signals), coach: first, status: 'current', supersededById: null, opIds: [req.opId], createdAt: now };
        const w = await deps.reviews.record(review).catch(() => null);
        if (w !== null && w.status !== 'invalid' && w.status !== 'stale') {
          stored = w.review;
          const settled = nudgeSettledOf(w.review);
          const c = w.review.coach;
          if (settled !== null) return { kind: 'settled', line: c.status === 'reviewed' ? (c.lines[0] ?? null) : null, outcome: settled };
          if (signals.length > 0 && (w.status === 'unchanged' || w.status === 'replayed')) {
            if (c.status === 'silent') return { kind: 'silent', by: 'coach' };
            if (c.status === 'reviewed' && c.lines[0] !== undefined) return { kind: 'line', line: c.lines[0], offer };
            // A stored pending (a crash mid-call), offline or failed: asked again below when the coach is reachable.
          }
        }
      }
      if (signals.length === 0) return quiet();
      if (r.reach !== 'ok' || r.models === null) return { kind: 'not_reviewed', status: r.reach === 'ok' ? 'not_connected' : r.reach };

      const answer = await call(buildNudgeRequest(text, builderModelFor('nudge', r.models)), BUILDER_COACH_TOOL.preSessionNudge, req.signal);
      const settle = async (coach: ReviewCoach): Promise<void> => {
        if (deps.reviews === undefined || stored === null) return;
        const opId = `${req.opId}:coach`;
        const next: TrainingReview = { ...stored, coach, version: stored.version + 1, updatedAtUtc: deps.now().utc, opIds: [...stored.opIds, opId].slice(-20) };
        await deps.reviews.update(next, stored.version, opId).catch(() => null);
      };
      if (!answer.ok) {
        const st = failedReach(answer);
        const status = st === 'ok' ? 'failed' : st;
        await settle({ status });
        return { kind: 'not_reviewed', status };
      }
      const checked = checkNudge(answer.args, offer, facts);
      if (!checked.speak) {
        await settle({ status: 'silent' });
        return { kind: 'silent', by: 'coach' };
      }
      await settle({ status: 'reviewed', verdict: null, lines: [checked.line], actionIds: [], numbersChecked: true });
      return { kind: 'line', line: checked.line, offer: checked.offer };
    },

    /**
     * Apply on the nudge's offer (Ben's tap, rule 3): the same checked Apply as any proposal, then the day's
     * pre-session review is marked applied so the card stays quiet today (review B1).
     */
    async applyNudge(req: { offer: NudgeOffer; localDate: string; opId: string }): Promise<ApplyResult> {
      const out = await service.apply(req.offer.proposal);
      if (out.kind === 'applied') await markNudge(req.localDate, 'applied', req.opId);
      return out;
    },

    /** Skip on the nudge's offer: nothing changes, and the card stays quiet today. */
    async skipNudge(req: { localDate: string; opId: string }): Promise<void> {
      await markNudge(req.localDate, 'skipped', req.opId);
    },
  };
  return service;

  async function markNudge(localDate: string, outcome: 'applied' | 'skipped', opId: string): Promise<void> {
    if (deps.reviews === undefined) return;
    const current = await deps.reviews.current({ kind: 'pre_session', localDate, splitDayId: null, draftId: null }).catch(() => null);
    if (current === null || nudgeSettledOf(current) !== null) return;
    const marker = `${NUDGE_SETTLED[outcome]}${opId}`.slice(0, 128);
    // The marker goes last and survives the op-ID cap (older op IDs drop first).
    const next: TrainingReview = { ...current, version: current.version + 1, updatedAtUtc: deps.now().utc, opIds: [...current.opIds.slice(-19), marker] };
    await deps.reviews.update(next, current.version, marker).catch(() => null);
  }
}

export type BuilderCoachService = ReturnType<typeof createBuilderCoachService>;

// ---------------------------------------------------------------------------
// Day notes on the coach store (memories with a day-note scope; Your data)

/** The part of the coach store a day note needs. */
export interface DayNoteStore {
  commit(ownerId: string, write: CoachWrite): Promise<CoachWriteResult>;
}

/**
 * Text day notes as memories scoped to the day (`Memory.dayNote`), saved on Ben's Done (rule 2:
 * his tap). The same words for the same day are one note (content key scoped by day and main lift);
 * a retry with the same op ID writes once.
 */
export function createDayNotes(deps: { store: () => DayNoteStore; ownerId: () => Promise<string>; now: () => ZonedTimestamp }): DayNotesPort {
  return {
    async saveText(note) {
      const ownerId = await deps.ownerId();
      const now = deps.now();
      const text = note.text.trim().slice(0, 200);
      if (text === '') return 'failed';
      const memoryId = deriveId(`day-note:${note.opId}`);
      const detail: ActionDetail = { kind: 'save_memory', memoryId, text };
      const record = { ...newActionRecord({ turnId: '', opId: note.opId, now }, detail, { author: 'ben', entityVersions: [{ entity: 'memory', id: memoryId, before: null, after: 1 }] }), turnId: null };
      const key = memoryContentKey(`day ${note.splitDayId} ${note.mainLiftExerciseId ?? '-'} ${text}`).slice(0, 160);
      const memory: Memory = {
        id: memoryId,
        ownerId,
        version: 1,
        createdAtUtc: now.utc,
        updatedAtUtc: now.utc,
        text,
        contentKey: key,
        status: 'active',
        quote: text,
        createdByActionId: record.actionId,
        source: 'coach_suggested',
        dayNote: { splitDayId: note.splitDayId, mainLiftExerciseId: note.mainLiftExerciseId, reviewId: note.reviewId, hiddenOn: [] },
      };
      const r = await deps
        .store()
        .commit(ownerId, { kind: 'save_memory', action: record, memory })
        .catch(() => null);
      if (r === null || r.status === 'conflict') return 'failed';
      return r.status === 'replayed' ? 'duplicate' : 'saved';
    },
  };
}

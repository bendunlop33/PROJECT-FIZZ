import {
  addDraftVersion,
  checkWorkoutProposal,
  currentDraftVersion,
  deriveId,
  diffDraftVersions,
  draftDiffLines,
  draftName,
  exercisesLooselyNamedIn,
  exercisesNamedIn,
  leftOutCount,
  newWorkoutDraft,
  type WorkoutProposalContext,
} from '@fizz/domain';
import { BUILD_LIMITS, type ActionDetail, type BuildCheck, type BuildFocus, type DraftPlan, type GuardNote, type WorkoutDraft, type WorkoutDraftVersion } from '@fizz/schemas';
import { isChangeClaim } from './claims';
import { actionIdFor, newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';

/**
 * The workout builder's tool (workout-builder.md v1.0 §8.2): `propose_workout`.
 *
 * Offered only in a general turn when Ben asked for a workout (request kind
 * `build`) or, with a coach draft in context, asked to change it (BD16).
 * The model sends structure only; `checkWorkoutProposal` decides what stays
 * (the selected gym, pain flags, §8.3 limits) and the executor stores a
 * `WorkoutDraft` version with its `build_workout` record in one transaction,
 * idempotent on the opId. Nothing here plans a load or a length: the
 * overview does that from history and the fit (BD6, BD11). Nothing starts
 * or saves: Ben taps Start or Save himself (BD15).
 */

/** Ben's request as code read it (BD3, §8.2): never the model's reading. */
export interface BuildRequest {
  /** Ben's words (or the Build card's), quoted: data, never instructions (rule 8). */
  text: string;
  minutes: number;
  focus: BuildFocus;
  gymId: string | null;
  gymName: string | null;
  origin: 'chip' | 'card' | 'text' | 'voice';
}

/** One exercise the coach may use (the selected gym's usable list, BD5). */
export interface UsableExercise {
  catalogueId: string;
  name: string;
  /** `Barbell`, `Dumbbells`, `Bodyweight` … */
  equipment: string;
  measured: 'reps' | 'time';
}

/** What a build turn sends under `YOUR DATA` (§8.4) besides the usual blocks. */
export interface BuildContextView {
  request: { quote: string; minutes: number; focus: BuildFocus; origin: BuildRequest['origin'] };
  gym: { name: string; typicalEquipment: boolean } | null;
  usable: UsableExercise[];
  /** Items marked busy today (none until the gym's `Busy today` exists). */
  busyToday: string[];
  /** Working sets that fit the length at the default pace. */
  setBudget: number;
  /** The rotation's next workout, by name. */
  upNext: string | null;
  /** The coach draft being changed (BD16), as stored. */
  draft: { name: string; version: number; exercises: { catalogueId: string; name: string; workingSets: number; reps: string; targetRpe: number | null }[] } | null;
}

export interface BuildDeps {
  store: CoachWriteStore;
  request: BuildRequest;
  /** The draft in context (a change makes its next version), else null (a new draft). */
  draft: WorkoutDraft | null;
  /**
   * The checks' context at the selected gym (`previous`: the plan being
   * changed, for stable slot keys; `catalogueIds`: what the call names, so
   * their history can be read first).
   */
  checkContext: (previous: DraftPlan | null, opId: string, catalogueIds: readonly string[]) => Promise<WorkoutProposalContext>;
  nameOf: (exerciseId: string) => string;
  contextHash: string;
  /** The selected gym's equipment versions, hashed (what the usable list was read from). */
  equipmentVersion: string;
}

/**
 * Review r4 (PM, 13 Oct): the build context now rides on every general turn with a gym, so the usable
 * list is capped. A turn where a build is in play (Ben asked, or is following one up) gets up to
 * `BUILD_USABLE_CAP`; a turn that only offers the tool gets `OFFERED_USABLE_CAP`. Each entry is about
 * 120 characters (about 30 tokens) of JSON, so the offered list is about 1.8k tokens; with the tool
 * schema (about 600) and the offered instructions (about 300) a general turn grows by about 2.7k.
 */
export const BUILD_USABLE_CAP = 200;
export const OFFERED_USABLE_CAP = 60;

/**
 * The first `cap` usable exercises, the `first` ones (the draft's, then Ben's routines') ahead of the
 * rest, returned in the list's own order (by name). Pure.
 */
export function capUsable(usable: readonly UsableExercise[], cap: number, first: readonly string[] = []): UsableExercise[] {
  if (usable.length <= cap) return [...usable];
  const rank = new Map<string, number>();
  first.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const keep = new Set(
    usable
      .map((u, i) => ({ u, i, r: rank.get(u.catalogueId) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .slice(0, cap)
      .map((x) => x.i),
  );
  return usable.filter((_, i) => keep.has(i));
}

/** The exercise splits that fit a session focus, for ranking the usable list (review r5 S2). */
const FOCUS_SPLITS: Readonly<Record<BuildFocus, readonly string[]>> = {
  coach_picks: [],
  push: ['push'],
  pull: ['pull'],
  legs: ['legs'],
  upper: ['push', 'pull'],
  lower: ['legs'],
  full_body: [],
};

/**
 * Review r5 S2: which usable exercises go ahead of the alphabetical fill when the list is capped, in
 * order: the ones Ben named in full ("split squats"), the draft's, the ones a distinctive word of his
 * names ("calf"), the ones fitting the focus (by catalogue split), then his routines'. Pure.
 */
export function usableFirst(input: {
  words: readonly string[];
  focus: BuildFocus;
  pool: readonly { catalogueId: string; name: string; split?: string | undefined }[];
  draft: readonly string[];
  routines: readonly string[];
}): string[] {
  const text = input.words.join('\n');
  const named = input.pool.map((u) => ({ exerciseId: u.catalogueId, exerciseName: u.name }));
  const splits = FOCUS_SPLITS[input.focus];
  const focus = input.pool.filter((u) => u.split !== undefined && splits.includes(u.split)).map((u) => u.catalogueId);
  return [...new Set([...exercisesNamedIn(text, named), ...input.draft, ...namedByTail(text, named), ...exercisesLooselyNamedIn(text, named), ...focus, ...input.routines])];
}

const wordsOf = (s: string): string[] => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 0);
const singular = (w: string): string => w.replace(/s$/, '').replace(/e$/, '');

/** Exercises whose last two name words Ben said in a row ("calf raises" for Standing calf raise), for ranking only. */
function namedByTail(text: string, exercises: readonly { exerciseId: string; exerciseName: string }[]): string[] {
  const said = wordsOf(text).map(singular);
  return exercises
    .filter((e) => {
      const tail = wordsOf(e.exerciseName).slice(-2).map(singular);
      return tail.length === 2 && said.some((w, i) => w === tail[0] && said[i + 1] === tail[1]);
    })
    .map((e) => e.exerciseId);
}

/** The draft's ID for a first version: derived from the opId, so a replay finds the same row. */
export const coachDraftIdFor = (opId: string): string => deriveId(`coach-draft:${opId}`);

function guardNotesOf(checks: readonly BuildCheck[]): GuardNote[] {
  return checks.slice(0, 40).map((c) => ({ kind: 'build_check', setIds: [], text: c.text }));
}

function linesOf(previous: DraftPlan | null, plan: DraftPlan, nameOf: (id: string) => string): Extract<ActionDetail, { kind: 'build_workout' }>['lines'] {
  if (previous === null) return [];
  return draftDiffLines(diffDraftVersions(previous, plan), nameOf)
    .slice(0, 40)
    .map((l) => ({ change: l.change, text: l.text.slice(0, 200) }));
}

/** The coach's message after the claim check (§7): at most 240 characters; a sentence claiming a change is dropped. */
export function checkedRationale(message: string): string | null {
  const t = message.replace(/\s+/g, ' ').trim().slice(0, BUILD_LIMITS.messageMax);
  if (t === '') return null;
  const kept = (t.match(/[^.!?]+[.!?]*/g) ?? [t]).map((x) => x.trim()).filter((x) => x !== '' && !isChangeClaim(x));
  return kept.length === 0 ? null : kept.join(' ');
}

/** The tool output for a second build in one turn (review S2). */
export const BUILD_ALREADY_LINE = 'Already built this turn. Reply now.';

export function createBuildExecutor(deps: BuildDeps): CoachExecutors {
  // Review S2: one request builds one draft (or one version). The executor lives for one turn.
  let landedOpId: string | null = null;
  const propose: ToolExecutor = async (call, ctx): Promise<ToolResult> => {
    if (call.tool !== 'propose_workout') throw new TypeError(call.tool);
    if (landedOpId !== null && landedOpId !== ctx.opId) return { kind: 'refused', line: BUILD_ALREADY_LINE };
    const args = call.args;
    const previous = deps.draft === null ? null : currentDraftVersion(deps.draft).plan;
    const draftId = deps.draft?.id ?? coachDraftIdFor(ctx.opId);
    const check = checkWorkoutProposal(args, await deps.checkContext(previous, ctx.opId, args.exercises.map((e) => e.catalogueId)));
    const name = draftName(deps.request.focus, deps.request.minutes);
    const parentN = deps.draft?.currentVersion ?? null;
    const rationale = checkedRationale(args.message);
    const base = { kind: 'build_workout' as const, draftId, name, gymName: deps.request.gymName?.slice(0, 120) ?? null };
    const record = async (status: 'rejected' | 'stale', failure: string): Promise<ToolResult> => {
      const detail: ActionDetail = { ...base, versionN: (parentN ?? 0) + 1, parentN, exerciseCount: 0, leftOut: leftOutCount(check.checks), lines: [] };
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status, failure, guardNotes: guardNotesOf(check.checks), reason: rationale }) });
      if (r.status === 'conflict') throw new Error('Could not record the refused build');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    };
    if (check.status === 'unusable') return record('rejected', 'every exercise failed the checks');

    const version: WorkoutDraftVersion = {
      n: 1,
      parentN,
      status: 'current',
      actionId: actionIdFor(ctx.opId),
      turnId: ctx.turnId,
      request: { text: deps.request.text.slice(0, 4000), minutes: deps.request.minutes, focus: deps.request.focus, gymId: deps.request.gymId, origin: deps.request.origin },
      rawArgs: JSON.stringify(args).slice(0, 40_000),
      plan: check.plan,
      fitMinutes: deps.request.minutes,
      checks: check.checks.slice(0, 60),
      rationale,
      contextHash: deps.contextHash,
      equipmentVersion: deps.equipmentVersion,
      createdAt: ctx.now,
    };
    let next: WorkoutDraft;
    let expectedVersion: number | null;
    if (deps.draft === null) {
      next = newWorkoutDraft({ id: draftId, ownerId: ctx.ownerId, version, opId: ctx.opId, at: ctx.now });
      expectedVersion = null;
    } else {
      const change = addDraftVersion(deps.draft, { version, expectedVersion: deps.draft.version, opId: ctx.opId, at: ctx.now });
      if (change.kind !== 'write') return record('stale', 'the draft changed since');
      next = change.next;
      expectedVersion = change.expectedVersion;
    }
    const current = currentDraftVersion(next);
    const detail: ActionDetail = {
      ...base,
      name: next.name,
      versionN: current.n,
      parentN: current.parentN,
      exerciseCount: current.plan.slots.length,
      leftOut: leftOutCount(check.checks),
      lines: linesOf(previous, current.plan, deps.nameOf),
    };
    const action = newActionRecord(ctx, detail, { status: 'committed', reason: rationale, guardNotes: guardNotesOf(check.checks) });
    const r = await deps.store.commit(ctx.ownerId, { kind: 'workout_draft', action, draft: next, expectedVersion });
    if (r.status === 'conflict') return record('stale', 'the draft changed since');
    landedOpId = ctx.opId;
    return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
  };
  return { propose_workout: propose };
}

/** About the `propose_workout` call itself (a turn that is building). */
const CALL_RULES = [
  'Never give loads, weights or minutes: the app plans loads from his history and fits the length. Give targetRpe for every exercise. Stay within build.setBudget working sets.',
  'Its `message` (at most 240 characters) says why this selection and order, citing only facts given. No praise, scores, recovery claims or diagnoses.',
];

/** About the reply after the call (a turn that is building). */
const AFTER_CALL_RULES = [
  'Never say the workout was saved, scheduled or started: Ben opens it, starts it or saves it himself. Then reply in one short sentence.',
  'If `propose_workout` is refused, say in one short sentence that it was not built and why; never say it is ready or in the app.',
];

/** Review r4 S2: every turn with the tool says so, building or not. */
const MULTI_WEEK_LINE = 'It builds one session. Multi-week programmes and weekly plans are not available yet: if Ben asks for one, say so plainly.';

/**
 * Review r5 B1: on a turn that only offers the tool, the call and post-call rules apply only if the
 * model calls `propose_workout`. Worded so nothing reads as a general rule: when Ben asks what weight
 * to use or what he lifted, the coach answers in full as usual (rule 3).
 */
const SCOPED_BUILD_RULES = [
  'Only if you call `propose_workout`: put no loads or minutes in the call (the app plans them from his history and the length); give targetRpe for every exercise; stay within build.setBudget working sets; its `message` (at most 240 characters) says why this selection and order, citing only facts given, with no praise, scores, recovery claims or diagnoses. After it, keep the reply brief and never say the workout was saved, scheduled or started (Ben does that); if it is refused, say it was not built and why.',
  'These limits are only for the call. On any other question, including what weight or reps to use or what he lifted before, answer as usual.',
  MULTI_WEEK_LINE,
];

/** Instructions added to a turn that offers `propose_workout` (§7 coach message rules, BD1, BD15). */
export const BUILD_INSTRUCTIONS = [
  'Ben asked for a workout in the app. Call `propose_workout` first, once, using only catalogueIds from YOUR DATA build.usable. Never write the workout out as text in `reply`: a plan in text is not in the app.',
  'If he is agreeing to a session you described earlier in this thread, build that session: the same exercises (or the closest in build.usable), sets and reps.',
  'To change the draft in context, call `propose_workout` with the whole new version.',
  ...CALL_RULES,
  ...AFTER_CALL_RULES,
  MULTI_WEEK_LINE,
].join('\n');

/**
 * Review r4 (PM, 13 Oct, pending Ben's confirmation): every general turn with a gym offers
 * `propose_workout`, never forced unless Ben's words are an unambiguous build request
 * (`forcesBuild`). The model decides from his words; the result is only a draft (BD12, BD15).
 * Review r5 B1: the build rules are scoped to the call (`SCOPED_BUILD_RULES`).
 */
export const OFFERED_BUILD_INSTRUCTIONS = [
  '`propose_workout` builds one workout session in the app as a draft Ben opens, starts or saves himself. Use it only when Ben asks for a workout or session, or agrees to put a session you described earlier in this thread into the app. Never use it for pain or soreness, advice, questions about his history, or multi-week plans. If he asks for a session and mentions pain or soreness, ask about that first and build only once he says to.',
  'If you describe a session he might want in the app, end by asking exactly: "Want me to build it in the app?" Never say a workout is built, added, saved or ready unless `propose_workout` succeeded this turn. Do not say the app cannot build workouts.',
  ...SCOPED_BUILD_RULES,
].join('\n');

/**
 * Review r3 S1: Ben replied to your offer to build, but his words may not be a yes ("I'm going at 6").
 * `propose_workout` is offered and nothing is forced: the model reads his words.
 */
export const OFFER_REPLY_BUILD_INSTRUCTIONS = [
  'You offered to build a session in the app. Read Ben\'s reply: if it agrees, call `propose_workout` first, once, using only catalogueIds from YOUR DATA build.usable, for the session you described (the same exercises, or the closest in build.usable, sets and reps).',
  'If his reply does not clearly agree, do not build: reply briefly, and ask "Want me to build it in the app?" if it is still unclear.',
  ...SCOPED_BUILD_RULES,
].join('\n');

/**
 * Added to a general turn that doesn't offer `propose_workout` but where the app could build one
 * (build 131; review S4: scoped to one session). Review r3 B1: the prompt matches the turn. The model
 * can't build on this turn, so it offers instead of promising, and never says the app can't build.
 */
export const NO_BUILD_TOOL_INSTRUCTIONS = [
  'You cannot build a workout on this turn. Never say a workout is being built, set up, added or saved, or that it is ready, in the app or in his workouts.',
  'If Ben wants a session in the app, or you describe one for him, end by asking exactly: "Want me to build it in the app?" Do not say the app cannot build workouts.',
  'Multi-week programmes are not available yet, and you never save, schedule or start a workout for him: say so plainly when he asks for that.',
].join('\n');

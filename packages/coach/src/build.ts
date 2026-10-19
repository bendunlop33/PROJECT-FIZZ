import {
  addDraftVersion,
  checkBuildQuestion,
  dayMonthText,
  expectedLoad,
  formatNumber,
  noReferenceCeiling,
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
  wordsOnlyMessage,
  checkCoachClaims,
  coachSentences,
  type KnownPreferences,
  type LoadReferences,
  type QuestionContext,
  type WorkoutProposalContext,
} from '@fizz/domain';
import { BUILD_LIMITS, muscleGroupOf, type ActionDetail, type BuildCheck, type BuildDay, type BuildFocus, type DraftPlan, type GuardNote, type WorkoutDraft, type WorkoutDraftVersion } from '@fizz/schemas';
import { isChangeClaim } from './claims';
import { collectFacts, mergeFacts, verifySentence, withoutNumbers, type NumberFacts } from './numbers';
import { actionIdFor, newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';

/**
 * The workout builder's tools (workout-builder.md v2.1 §8.2):
 * `propose_workout` and `ask_build_question`.
 *
 * `propose_workout` is offered in a general turn when Ben asked for a
 * workout (request kind `build`), or, with a coach draft in context, asked
 * to change it (BD16). v2 (BD6): the model sends the structure and a
 * working load per exercise with its basis; `checkWorkoutProposal` decides
 * what stays (the selected gym, pain flags, §8.3 limits) and
 * `checkProposedLoad` checks, bounds and fits each load. The executor stores
 * a `WorkoutDraft` version with its `build_workout` record in one
 * transaction, idempotent on the opId. Minutes are never the model's
 * (BD11). Nothing starts or saves: Ben taps Start or Save himself (BD15).
 *
 * `ask_build_question` (BD17) records one checked question card (status
 * `proposed`) and nothing else; the turn stops there and Ben's tap answers it.
 */

/** Ben's request as code read it (BD3, §8.2): never the model's reading. */
export interface BuildRequest {
  /** Ben's words (or the Build card's), quoted: data, never instructions (rule 8). */
  text: string;
  minutes: number;
  focus: BuildFocus;
  /** (F19) The split day chosen on the Build card. */
  day?: BuildDay | null;
  gymId: string | null;
  gymName: string | null;
  origin: 'chip' | 'card' | 'text' | 'voice';
  /**
   * (Coach v3) A length Ben stated outright: the Build card's chip, or a length with a time word in
   * his newest message ("45 min"). It always wins over the model's `minutes`. Absent: none.
   */
  minutesFromBen?: number | null;
  /** (Coach v3) Bare numbers in his newest message that could be a length ("make it 40" → 40). */
  benNumbers?: readonly number[];
  /** (Coach v3) The focus came from the Build card's chips: the model's `focus` doesn't change it. */
  focusFromChips?: boolean;
}

/** (Coach v3) A gym the build can be checked at: its context for the checks and its equipment hash. */
export interface BuildGym {
  gymId: string | null;
  gymName: string | null;
  checkContext: BuildDeps['checkContext'];
  equipmentVersion: string;
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
  request: { quote: string; minutes: number; focus: BuildFocus; origin: BuildRequest['origin']; /** (F19) The split day, its body parts and main lift (Ben's or recommended). */ day?: { name: string; bodyParts: string[]; mainLift: string | null } };
  gym: { name: string; typicalEquipment: boolean } | null;
  /** (Coach v3) Ben's saved gyms by name: `propose_workout`'s `gymName` is one of these. */
  gyms?: string[];
  usable: UsableExercise[];
  /** Items marked busy today (none until the gym's `Busy today` exists). */
  busyToday: string[];
  /** Working sets that fit the length at the default pace. */
  setBudget: number;
  /** The rotation's next workout, by name. */
  upNext: string | null;
  /** The coach draft being changed (BD16), as stored. */
  draft: { name: string; version: number; exercises: { catalogueId: string; name: string; workingSets: number; reps: string; targetRpe: number | null; load?: string | null }[] } | null;
  /**
   * (v2, §8.6) What the coach proposes loads from: per candidate exercise,
   * the last comparable working tops (app and FitNotes, labelled), the
   * reference e1RM (est.), the gap, a personal ratio, and the first-time
   * ceiling with no reference. The same numbers `checkProposedLoad` checks against.
   */
  loadReferences?: LoadReferenceView[];
  /** (v2, BD18) What is already known: never asked again. Missing items are listed. */
  known?: KnownView;
}

/** One exercise's load references as the coach reads them (Your data). */
export interface LoadReferenceView {
  catalogueId: string;
  name: string;
  /** The unit and convention a load for it must use here. */
  unit: 'kg' | 'lb';
  convention: string;
  /** `100×7 @8 · 6 Oct · app`, newest first, at most 3. */
  last: string[];
  /** The reference e1RM, an estimate. */
  e1rmEst: number | null;
  gapDays: number | null;
  /** `est. from DB bench press 32.5×8` (personal ratio) or a related lift. */
  estimate: string | null;
  /** With no reference: the most a first-time load may be here (est.). */
  firstTimeMax: number | null;
  /** Pain holds it at no harder than the last working load. */
  held: boolean;
}

/**
 * One exercise's references as the coach is sent them (§8.6): exactly the
 * numbers `checkProposedLoad` checks against.
 */
export function loadReferenceView(catalogueId: string, name: string, refs: LoadReferences, held: boolean): LoadReferenceView {
  const own = refs.own;
  const last = (own?.sessions ?? []).map((s) => {
    const v = refs.convention === 'added' ? `+${formatNumber(s.top.value)}` : formatNumber(s.top.value);
    return `${v}×${String(s.top.reps)}${s.top.rpe === null ? '' : ` @${formatNumber(s.top.rpe)}`} · ${dayMonthText(s.performedAtUtc, s.tz).replace(/\u00a0/g, ' ')} · ${s.source === 'fitnotes' ? 'FitNotes import' : 'app'}`;
  });
  const e1rm = own?.e1rm ?? null;
  const noRef = own === null && refs.derived === null;
  return {
    catalogueId,
    name,
    unit: refs.unit,
    convention: refs.convention,
    last,
    e1rmEst: e1rm === null ? null : Math.round(e1rm * 2) / 2,
    gapDays: own?.gapDays ?? null,
    estimate: refs.derived !== null ? `est. from ${refs.derived.text}` : own?.estOnly === true ? 'est.: FitNotes, machine not recorded' : null,
    // The checker uses the slot's own reps; 12 reps at RPE 8 is the usual first-time slot.
    firstTimeMax: noRef ? noReferenceCeiling(refs.equipment, refs.patternE1rms.map((e) => expectedLoad(e, 12, 8))) : null,
    held,
  };
}

/** The `KNOWN` block (§8.6). */
export interface KnownView {
  goal: string | null;
  sessionMinutes: number | null;
  mainLift: string | null;
  recentSplits: string[];
  missing: string[];
  /** Training details from Profile (`experience: intermediate`, `born 1990`, `bodyweight 82 kg (3 Oct)`): never asked (review S6). */
  about?: string[];
  /** Clarifying questions left in this build request (BD17: at most 2). */
  questionsLeft: number;
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
  /** (v2, BD17) The question checks' inputs; absent: `ask_build_question` has no executor (never offered). */
  questions?: { known: KnownPreferences; context: QuestionContext; day: { id: string; name: string } | null };
  /** (Coach v3) Ben's saved gyms by name (`build.gyms`), for the refusal line. */
  gyms?: readonly string[];
  /** (Coach v3) Another saved gym the model named (`gymName`); null when none matches. */
  gymFor?: (name: string) => Promise<BuildGym | null>;
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
  chest: ['push'],
  shoulders: ['push'],
  back: ['pull'],
  split_day: [],
};

/**
 * Review r5 S2: which usable exercises go ahead of the alphabetical fill when the list is capped, in
 * order: the ones Ben named in full ("split squats"), the draft's, the ones a distinctive word of his
 * names ("calf"), the ones whose main muscle is one of the split day's body parts (F19; review S7),
 * the ones fitting the focus (by catalogue split), then his routines'. Pure.
 */
export function usableFirst(input: {
  words: readonly string[];
  focus: BuildFocus;
  pool: readonly { catalogueId: string; name: string; split?: string | undefined; primaryMuscle?: string | undefined }[];
  draft: readonly string[];
  routines: readonly string[];
  /** The Build card's split day's body parts, when one is chosen. */
  dayBodyParts?: readonly string[];
}): string[] {
  const text = input.words.join('\n');
  const named = input.pool.map((u) => ({ exerciseId: u.catalogueId, exerciseName: u.name }));
  const splits = FOCUS_SPLITS[input.focus];
  const parts = input.dayBodyParts ?? [];
  const day = parts.length === 0 ? [] : input.pool.filter((u) => u.primaryMuscle !== undefined && parts.includes(muscleGroupOf(u.primaryMuscle) ?? '')).map((u) => u.catalogueId);
  const focus = input.pool.filter((u) => u.split !== undefined && splits.includes(u.split)).map((u) => u.catalogueId);
  return [...new Set([...exercisesNamedIn(text, named), ...input.draft, ...namedByTail(text, named), ...exercisesLooselyNamedIn(text, named), ...day, ...focus, ...input.routines])];
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

/**
 * The coach's message after the claim check (§7; review r5 B1u): at most 600 (Coach v3; was 240)
 * characters; a sentence claiming a change, or with any number, number word,
 * max/record claim or praise (`checkCoachWords`, the load-note rule), is
 * dropped. Sentences split without breaking decimals or `est.`.
 */
export function checkedRationale(message: string, facts?: NumberFacts): string | null {
  const t = message.replace(/\s+/g, ' ').trim().slice(0, BUILD_LIMITS.messageMax);
  if (facts === undefined) return wordsOnlyMessage(t, (x) => !isChangeClaim(x));
  // Coach v3 (ADR 0027): numbers may stay when each one is in the facts (the draft's own numbers, Ben's words, what the coach read).
  // A sentence describing the draft's numbers ("Presses at 22.5 kg each for 8–10") isn't a change claim; its words are checked without them.
  const kept = coachSentences(t).filter((x) => checkCoachClaims(x) && !isChangeClaim(withoutNumbers(x)) && verifySentence(x, facts).ok);
  return kept.length === 0 ? null : kept.join(' ');
}

/** (Coach v3) The facts a draft's message is checked against: the turn's, plus the checked plan, its length and Ben's request. */
export function draftFacts(turn: NumberFacts, plan: DraftPlan | null, minutes: number, requestText: string): NumberFacts {
  return mergeFacts(turn, collectFacts([JSON.stringify(plan), String(minutes), requestText]));
}

/** A gym name reduced for matching: lower case, letters and digits, no "the", "my" or a trailing "gym". */
export function gymNameCore(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0 && w !== 'the' && w !== 'my');
  if (words.length > 1 && words.at(-1) === 'gym') words.pop();
  return words.join(' ');
}

/** (Coach v3) Do two gym names mean the same saved gym ("Hotel gym" and "hotel")? Pure. */
export function sameGymName(a: string, b: string): boolean {
  const x = gymNameCore(a);
  return x !== '' && x === gymNameCore(b);
}

/**
 * (Coach v3) The saved gym a name means: the one with the same name ("hotel gym" → "Hotel gym"),
 * else the only one whose name has all its words ("Hotel gym" → "Hotel · Lisbon"). Null: none, or
 * more than one. Pure.
 */
export function savedGymFor(name: string, saved: readonly string[]): string | null {
  const same = saved.filter((n) => sameGymName(n, name));
  if (same.length === 1) return same[0] ?? null;
  if (same.length > 1) return null;
  const want = gymNameCore(name).split(' ').filter((w) => w !== '' && w !== 'gym');
  if (want.length === 0) return null;
  const hits = saved.filter((n) => {
    const has = new Set(gymNameCore(n).split(' '));
    return want.every((w) => has.has(w));
  });
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/**
 * (Coach v3) The saved gym Ben's words name, newest message first, or null. A name counts when its
 * words appear in a row: the whole name ("Main Gym", "Hotel · Lisbon"), or one of its words with
 * "gym" after it ("my hotel gym" names "Hotel" and "Hotel · Lisbon"). One-word names need "gym"
 * ("home" alone never names "Home"). Only a name no other saved gym shares counts. Pure; the
 * words are data (rule 8).
 */
export function gymNamedIn(texts: readonly string[], names: readonly string[]): string | null {
  const said = (t: string): string => ` ${t.toLowerCase().replace(/[’']/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).join(' ')} `;
  for (const text of texts) {
    const t = said(text);
    const hits = names.filter((n) => {
      const core = gymNameCore(n);
      if (core === '') return false;
      const full = said(n).trim();
      return t.includes(` ${core} gym `) || (full.includes(' ') && t.includes(` ${full} `)) || core.split(' ').some((w) => w.length > 2 && t.includes(` ${w} gym `));
    });
    if (hits.length === 1) return hits[0] ?? null;
  }
  return null;
}

/** Fed back when the model names a gym Ben hasn't saved. Nothing is built. */
export function unknownGymLine(name: string, gyms: readonly string[]): string {
  const list = gyms.length === 0 ? 'none saved' : gyms.map((g) => `"${g}"`).join(', ');
  return `Not built: no saved gym called "${name.slice(0, 60)}". Saved gyms: ${list}. Use one of them, or null for the selected gym.`;
}

/** Bare numbers that could be a length (15–180): no unit after them ("make it 40"), not "3 sets", "20 kg", "8 reps". */
export function bareNumbers(text: string): number[] {
  const out: number[] = [];
  const t = text.toLowerCase();
  for (const m of t.matchAll(/(?<![\d.,×x@+-])(\d{2,3})(?!\d|[.,]\d)(?!\s*(?:kg|kgs|kilos?|lbs?|pounds?|s\b|secs?|seconds?|reps?|sets?|x\b|×|%|m\b|km|mi\b|k\b|cm|rpe|min|mins|minutes?|h\b|hrs?|hours?|th\b|st\b|nd\b|rd\b|each|per))/g)) {
    const n = Number(m[1]);
    if (n >= 15 && n <= 180) out.push(n);
  }
  return out;
}

/**
 * (Coach v3, Ben 18 Oct: "make it 40") The draft's length. A length Ben stated outright wins; then
 * the model's reading, unless Ben's newest message has exactly one bare number and it isn't the
 * model's (his literal number wins); then the request's own (his earlier words, the draft, his
 * usual length). Stepped to 5, 15–180. Pure.
 */
export function buildMinutesFor(request: Pick<BuildRequest, 'minutes' | 'minutesFromBen' | 'benNumbers'>, modelMinutes: number | null | undefined): { minutes: number; by: 'ben' | 'coach' | 'request' } {
  const step = (n: number): number => Math.min(180, Math.max(15, Math.round(n / 5) * 5));
  if (request.minutesFromBen != null) return { minutes: step(request.minutesFromBen), by: 'ben' };
  if (modelMinutes != null) {
    const bare = request.benNumbers ?? [];
    const only = bare.length === 1 ? bare[0] : undefined;
    if (only !== undefined && only !== modelMinutes) return { minutes: step(only), by: 'ben' };
    return { minutes: step(modelMinutes), by: 'coach' };
  }
  return { minutes: request.minutes, by: 'request' };
}

/** (Coach v3) The draft's focus: the Build card's chip, else the model's reading, else the request's. Pure. */
export function buildFocusFor(request: Pick<BuildRequest, 'focus' | 'focusFromChips'>, modelFocus: BuildFocus | null | undefined): BuildFocus {
  if (request.focusFromChips === true || modelFocus == null || modelFocus === 'split_day') return request.focus;
  return modelFocus;
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
    // Coach v3: the gym, length and focus are the model's reading of the conversation, checked here.
    let gym: BuildGym = { gymId: deps.request.gymId, gymName: deps.request.gymName, checkContext: deps.checkContext, equipmentVersion: deps.equipmentVersion };
    if (args.gymName != null) {
      const other = deps.gymFor === undefined ? null : await deps.gymFor(args.gymName);
      const same = deps.request.gymName !== null && (other === null ? sameGymName(args.gymName, deps.request.gymName) : other.gymId === deps.request.gymId);
      if (!same && other === null) return { kind: 'refused', line: unknownGymLine(args.gymName, deps.gyms ?? []) };
      if (!same && other !== null) gym = other;
    }
    const minutes = buildMinutesFor(deps.request, args.minutes).minutes;
    const focus = buildFocusFor(deps.request, args.focus);
    const day = focus === deps.request.focus ? (deps.request.day ?? null) : null;
    const check = checkWorkoutProposal(args, await gym.checkContext(previous, ctx.opId, args.exercises.map((e) => e.catalogueId)));
    const name = draftName(focus, minutes, day?.name ?? null);
    const parentN = deps.draft?.currentVersion ?? null;
    const rationale = checkedRationale(args.message, ctx.facts === undefined ? undefined : draftFacts(ctx.facts, check.plan, minutes, deps.request.text));
    const base = { kind: 'build_workout' as const, draftId, name, gymName: gym.gymName?.slice(0, 120) ?? null };
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
      request: { text: deps.request.text.slice(0, 4000), minutes, focus, gymId: gym.gymId, origin: deps.request.origin, ...(day ? { day: { name: day.name, bodyParts: [...day.bodyParts] } } : {}) },
      rawArgs: JSON.stringify(args).slice(0, 40_000),
      plan: check.plan,
      fitMinutes: minutes,
      checks: check.checks.slice(0, 60),
      rationale,
      ...(ctx.facts === undefined ? {} : { rationaleNumbersChecked: true as const }),
      contextHash: deps.contextHash,
      equipmentVersion: gym.equipmentVersion,
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
  const ask: ToolExecutor = async (call, ctx): Promise<ToolResult> => {
    if (call.tool !== 'ask_build_question') throw new TypeError(call.tool);
    const q = deps.questions;
    if (q === undefined) return { kind: 'refused', line: QUESTION_NOT_OFFERED_LINE };
    if (landedOpId !== null) return { kind: 'refused', line: BUILD_ALREADY_LINE };
    const checked = checkBuildQuestion(call.args, q.known, q.context);
    if (!checked.ok) return { kind: 'refused', line: `${checked.line}. Build now with what you have.` };
    const detail: ActionDetail = { kind: 'build_question', topic: checked.topic, question: checked.question, answers: checked.answers, day: checked.topic === 'main_lift' ? q.day : null };
    const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status: 'proposed' }) });
    if (r.status === 'conflict') throw new Error('Could not record the question');
    return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
  };
  return { propose_workout: propose, ...(deps.questions === undefined ? {} : { ask_build_question: ask }) };
}

/** Fed back when the question tool runs with no question context (never offered then). */
export const QUESTION_NOT_OFFERED_LINE = 'No question now. Build with what you have.';

/** About the `propose_workout` call itself (a turn that is building). */
const CALL_RULES = [
  'Give each exercise a working `load` (and `topSet.load`) from build.loadReferences, in the unit and convention listed there, with a `basis` of at most 60 characters: a short reason in words, with no numbers (e.g. "main lift, strength focus"; the app shows the numbers). With no reference, an estimate up to build.loadReferences.firstTimeMax; null when you have no opinion. Give `minutes`, `focus` and `gymName` (one of build.gyms) from what Ben asked in this conversation, the newest first; the app fits the length. Give targetRpe for every exercise. Stay within build.setBudget working sets.',
  'Use build.known (goal, usual length, main lift, recent split days) and his training details; never ask for them. Put the main lift first when there is one.',
  'Its `message` (at most 600 characters) says, like a coach would, why this selection and order. Any number in it must come from YOUR DATA, a tool result, Ben’s words or this workout; the app drops sentences with other numbers. No praise, scores, max or record claims, recovery claims or diagnoses.',
];

/** (v2, BD17) Added when `ask_build_question` is offered. */
export const QUESTION_RULES =
  'If, and only if, one answer would change the workout and it is not in build.known or his training details, you may first call `ask_build_question` instead of `propose_workout`: one short question with 2 to 4 tap answers. Never about the length, his goal, pain or injury. Most builds need no question.';

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
  'Only if you call `propose_workout`: give each exercise a working load from build.loadReferences with a short basis in words, no numbers; give minutes, focus and gymName from what Ben asked (the app fits the length); give targetRpe for every exercise; stay within build.setBudget working sets; its `message` (at most 600 characters) says, like a coach would, why this selection and order; any number in it must come from YOUR DATA, a tool result, Ben’s words or this workout; no praise, scores, max or record claims, recovery claims or diagnoses. After it, keep the reply brief and never say the workout was saved, scheduled or started (Ben does that); if it is refused, say it was not built and why.',
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

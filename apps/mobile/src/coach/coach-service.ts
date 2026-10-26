/**
 * The coach in the app (ADR 0020 C6–C8): threads, turns, Undo, the summary
 * turn and next-session targets, over `@fizz/coach` and the coach store.
 * In-process and local; the only network call is the model port, and
 * nothing in the workout loop waits for it (rule 1).
 *
 * Not proven on the device: spike S3 (strict function tools with
 * `tool_choice: "required"` on the plan route) still has to pass on Ben's
 * iPhone before any of this counts as working.
 */

import {
  liveFocusExerciseIds,
  RECENT_LIFT_SESSIONS,
  actionIdFor,
  applyBuiltInAdjustment,
  asksForMoreSets,
  buildCoachContext,
  builtInAdjustOpId,
  buildTodayFitRequest,
  requestTodayFit,
  type TodayFitAnswer,
  type TodayFitContext,
  acceptEditOffer,
  acceptLiftTargetOffer,
  createEditTodayExecutor,
  type EditTodayDeps,
  createRenameExecutor,
  createChatSetExecutors,
  createNextTargetsExecutor,
  createSessionReadExecutor,
  createStoreExecutors,
  describeCoachContext,
  nextTargetTapOpId,
  nextTargetTapRecord,
  ruleResetWrite,
  recoverCoachTurns,
  runCoachTurn,
  undoCoachAction,
  undoOpId,
  createTrainingReadExecutors,
  createExerciseListExecutors,
  createLiftTargetExecutors,
  type LiftTargetDeps,
  createStructuralExecutors,
  createBuildExecutor,
  createPlanExecutor,
  asksForPlan,
  asksToPausePlan,
  asksToPlanWeek,
  classifyBenRequest,
  isStructuralRequest,
  createPausePlanExecutor,
  createActivityExecutor,
  renderActionResult,
  createWeekExecutor,
  acceptActivityOffer,
  acceptActivityOpId,
  type WeekContextView,
  type WeekToolContext,
  type ActivityToolDeps,
  revisesPlan,
  changesPlanInUse,
  type PlanContextView,
  type PlanPauseView,
  COACH_BUILD_TIMEOUT_MS,
  COACH_WORKOUT_TIMEOUT_MS,
  DEFAULT_COACH_TIMING,
  asksForBuild,
  buildFollowUpIn,
  buildQuestionChain,
  loadReferenceView,
  type QuestionChain,
  refusedBuildActionIds,
  capUsable,
  capAddable,
  usableFirst,
  BUILD_USABLE_CAP,
  OFFERED_USABLE_CAP,
  buildRequestWords,
  buildWordsNewestFirst,
  buildChainWords,
  recentBenWords,
  addedContinuationOf,
  lengthRevision,
  gymNamedIn,
  sameGymName,
  savedGymFor,
  createGymUpdateExecutor,
  type GymUpdatePlace,
  type BuildGym,
  type BuildFollowUp,
  type AddableExercise,
  type BuildContextView,
  type ExerciseListDeps,
  structuralTapRecord,
  memoryContentKey,
  newActionRecord,
  playbookContentKey,
  type CoachExecutors,
  type StructuralDeps,
  type TrainingReadPort,
  type CoachModelPort,
  type CoachTurnProgress,
  type CoachTurnResult,
  type ContextDescription,
  type NextTargetTap,
  type OpenedFrom,
  type TrainingInput,
  type LinkedActivityContext,
} from '@fizz/coach';
import {
  basisSlots,
  addDays,
  activePause,
  planIsOpen,
  currentPlanVersion,
  buildRequestText,
  buildSetBudget,
  coachDraftIsOpen,
  currentDraftVersion,
  draftWorkingSets,
  liveRoutines,
  nextInRotation,
  painFlagCovering,
  parseRequestedFocus,
  parseRequestedMinutes,
  rankSubstitutions,
  resolveBuildMinutes,
  rotationRoutines,
  stableStringify,
  substituteTargets,
  type SnapGym,
  type SubstituteContext,
  type HistorySession,
  doableHere,
  currentGymEquipment,
  draftBasisKey,
  getStructuralChangeSignals,
  partRootOf,
  structuralProposalState,
  substitutionOptions,
  cleanMemoryText,
  deriveId,
  memoryCanBeSaved,
  memoryList,
  type AppliedStructural,
  type MemoryList,
  type StructuralProposalState,
  type StructuralSlot,
  builtInTargetsView,
  equipmentView,
  exerciseHistoryView,
  type ExerciseHistoryView,
  exerciseRecordsView,
  recentSessionsView,
  toIso,
  trainingOverviewView,
  DEFAULT_COACH_TRIGGER_THRESHOLDS,
  evaluateCoachTrigger,
  evaluateSessionAdjustment,
  evaluateCheckInOffer,
  evaluateLighterSession,
  anyWorkingSetEverLogged,
  checkInFact,
  DEFAULT_CHECK_IN_SETTINGS,
  type LighterSessionAdjustment,
  exercisesNamedForPain,
  isInHistory,
  isTriggerKind,
  lastAdjustedVersion,
  movementMatcher,
  nextSessionBases,
  nextTargetFitsSource,
  nextTargetSourceBasis,
  coachTargetRows,
  isRuleResetRow,
  painFlagChoices,
  ruleTargetRpes,
  progressPeriodPhrase,
  progressWindowAt,
  customProgressWindow,
  localDateOf,
  rangeText,
  shouldShowCoachOffer,
  targetRpeOf,
  todayAdjustmentIds,
  toMs,
  unspecifiedPain,
  buildReferences,
  exercisesNamedIn,
  knownPreferences,
  matchSplitDay,
  painHoldFor,
  parseBuildRequest,
  splitInUse,
  toHistorySessions,
  workoutMuscleGroups,
  type FindableExercise,
  customExerciseIdOf,
  customExerciseLine,
  customFieldsOf,
  exerciseNearDuplicate,
  isArchivedExercise,
  type LoadReferences,
  type CoachTrigger,
  type OfferLogEntry,
  type SessionAdjustment,
  type SessionAdjustmentTrigger,
  gymSetupWords,
  type RuleReps,
  type HistoryLike,
  type HistoryWorkout,
  missingEquipmentNoun,
} from '@fizz/domain';
import type { CandidateWrite, MemoryWrite, SqliteRepositories, Store } from '@fizz/persistence';
import { playbookRuleList, type PlaybookRuleList } from './playbook-view';

import { summaryNoteSentences } from './next-time-view';
import type { CustomWrite } from '../services/custom-exercises';
import type { TextCoachState } from '@fizz/providers';
import { muscleGroupOf } from '@fizz/schemas';
import type {
  ActionDetail,
  CheckInSettings,
  Gym,
  BuildDay,
  BuildFocus,
  EquipmentInstance,
  PainFlag,
  PlanDraft,
  RepRange,
  Routine,
  WorkoutDraft,
  Memory,
  ActionRecord,
  BenInput,
  PlaybookCandidate,
  DraftBasis,
  Exercise,
  StructuralSignalKind,
  CheckIn,
  CoachMessage,
  CoachThread,
  CoachTurn,
  CoachTurnKind,
  CustomExerciseFields,
  NextSessionTargetRecord,
  CoachTarget,
  PlannedSet,
  ProgressPeriodKey,
  SessionAggregate,
  SetType,
  UserProfile,
  ZonedTimestamp,
} from '@fizz/schemas';

/** (19 Oct) The coach's new-exercise card as the sheet shows it. */
export interface ExerciseProposalCard {
  actionId: string;
  exerciseId: string;
  fields: CustomExerciseFields;
  /** `Meadows row · Barbell · total load · Back, Biceps · reps` */
  line: string;
  state: 'open' | 'added' | 'deleted';
}

/** Where the sheet was opened from (coach-sheet §1). */
export type CoachEntry =
  | { kind: 'today' }
  /** Progress (progress.md §2.1, §4.4): a general thread, framed by the window on screen. */
  | { kind: 'progress'; period: ProgressPeriodKey; /** A custom period on screen (replaces `period`). */ range?: { from: string; to: string } }
  /** Exercise detail (progress.md slice B): a general thread framed by the exercise, its series and the chart's dates. */
  | { kind: 'progress_exercise'; exerciseName: string; seriesLabel: string; from: string; to: string }
  | { kind: 'workout'; sessionId: string }
  | { kind: 'summary'; sessionId: string }
  /** `⋯ → Ask coach` on a coach draft's overview (workout-builder §6.2): a general thread with the draft in context (BD16). */
  | { kind: 'draft'; draftId: string; name: string };

/** Today, Progress and a coach draft: no workout attached; the general thread. */
export type GeneralEntry = Extract<CoachEntry, { kind: 'today' | 'progress' | 'progress_exercise' | 'draft' }>;

export function isGeneralEntry(entry: CoachEntry): entry is GeneralEntry {
  return entry.kind === 'today' || entry.kind === 'progress' || entry.kind === 'progress_exercise' || entry.kind === 'draft';
}

/** Why a build can't start (workout-builder §5.4): the one reason word shown, never a stand-in plan. */
export type BuildBlock = 'offline' | 'not_connected' | 'signed_out' | 'usage_limit' | 'choose_model';

/** The status word for a coach that can't build (§5.4, §7). */
export function buildBlockOf(status: CoachStatus): BuildBlock | null {
  switch (status) {
    case 'ok':
      return null;
    case 'offline':
      return 'offline';
    case 'expired':
      return 'signed_out';
    case 'limit':
      return 'usage_limit';
    case 'model_gone':
    case 'no_model':
      return 'choose_model';
    case 'not_connected':
    case 'not_eligible':
    case 'no_scope':
    case 'region':
      return 'not_connected';
  }
}

/** Connection state as the coach UI needs it: the stored status, plus `offline` after a request failed for lack of network. */
export type CoachStatus = TextCoachState['status'];

export interface CoachAvailability {
  status: CoachStatus;
  model: string | null;
  /** (Coach v3) Ben's mid-workout model, when he chose one in Settings. */
  workoutModel?: string | null;
  /** (Coach v3 review S7) That model is no longer in his plan's list: live-workout turns can't run. */
  workoutModelGone?: true;
}

/**
 * (Coach v3 review S7) The coach can answer during a live workout: connected and ok, and his
 * mid-workout model (if he chose one) still listed. Otherwise the built-in rule offers and acts
 * on his chips, as when offline; no other model is ever used in its place.
 */
export function liveCoachReachable(a: CoachAvailability | null): boolean {
  return a?.status === 'ok' && a.workoutModelGone !== true;
}

/**
 * An offer on the rest card (path B). `coach`: Adjust asks the coach.
 * `rule`: the coach can't answer, so the built-in rule offers its own
 * change (CA6 revised, build 108 F2), shown as `change` and applied only on
 * Ben's Adjust, with Undo.
 */
export type WorkoutOffer = CoachTrigger & {
  sessionExerciseId: string;
  by: 'coach' | 'rule';
  change: string | null;
  /**
   * The rule's offer only: what it was worked out on and would write (review
   * coach-fallback S2). `Adjust` applies only if the change worked out again
   * now touches the same sets with the same targets. Null for the coach's.
   */
  basis: RuleOfferBasis | null;
};

export interface RuleOfferBasis {
  /** The workout's version the offer was computed on (recorded; a rest or set-value edit moves it on without changing the offer). */
  baseVersion: number;
  touchedSetIds: string[];
  /** Each changed set's new target, in order (canonical JSON). */
  targets: string;
}

function basisOf(a: SessionAdjustment): RuleOfferBasis {
  const targets = a.plan.flatMap((e) => e.changes.flatMap((c) => (c.after === null ? [] : [{ setId: c.setId, after: c.after }])));
  return { baseVersion: a.args.baseVersion, touchedSetIds: [...a.touchedSetIds], targets: JSON.stringify(targets) };
}

/** Whether the change worked out now is the one Ben was shown (rule 5: never applied to different sets or targets). */
export function sameRuleChange(shown: RuleOfferBasis, now: RuleOfferBasis): boolean {
  return shown.touchedSetIds.length === now.touchedSetIds.length && shown.touchedSetIds.every((id, i) => now.touchedSetIds[i] === id) && shown.targets === now.targets;
}

/**
 * (Ben, 23 Oct) The lighter-session offer after a low check-in, in Ready
 * before the first working set (check-in CI5). `coach`: `Adjust` asks the
 * coach (`lighter_session`). `rule`: the coach can't answer (not connected or
 * offline), so the built-in lighter session is offered with its concrete
 * change; `Apply` writes it with Undo, `Skip` changes nothing.
 */
export interface CheckInLighterOffer {
  sessionId: string;
  checkInId: string;
  triggerId: string;
  by: 'coach' | 'rule';
  prompt: string;
  fact: string;
  change: string | null;
  basis: RuleOfferBasis | null;
  /** The workout's version when it was offered (recorded with the answer). */
  atVersion: number;
}

/** The `coach_offers` row that marks the check-in offer as answered (one per check-in), so it never comes back. */
const checkInOfferRow = (checkInId: string): string => `check_in:${checkInId}`;
const CHECK_IN_OFFER_KIND = 'check_in_low';

function lighterBasisOf(a: LighterSessionAdjustment): RuleOfferBasis {
  const targets = a.plan.flatMap((e) => e.changes.map((c) => ({ setId: c.setId, after: c.after })));
  return { baseVersion: a.args.baseVersion, touchedSetIds: [...a.touchedSetIds], targets: JSON.stringify(targets) };
}

/** What Ben's `Adjust` on the rule's offer did. */
export type RuleOfferResult =
  | { status: 'applied'; record: ActionRecord }
  /** The workout moved on so the change Ben saw no longer fits it: nothing changed. */
  | { status: 'stale' }
  /** Nothing the rule can change any more (say, the sets were logged): nothing changed. */
  | { status: 'unchanged' };

interface OfferCheckInput {
  aggregate: SessionAggregate;
  setId: string;
  resting: boolean;
  /** The coach can answer now (`availability().status === 'ok'`). Otherwise the built-in rule offers. */
  coachReachable: boolean;
  pending: boolean;
}

/** The Build card's chips (code, never the model): length, focus, and the split day with its main lift (F19). */
export interface BuildChips {
  minutes: number | null;
  focus: BuildFocus;
  day?: BuildDay | null;
  mainLift?: string | null;
}

/** Review S1: how far back the coach's history is read for a week offer already made (a week of turns is far fewer). */
const WEEK_OFFER_LOOKBACK = 200;

export interface CoachServiceDeps {
  /** (Ben, 27 Oct, Q4; ADR 0035) The watch workout linked to a workout, as the coach sees it; absent or null: none. */
  healthLinked?: (sessionId: string) => Promise<LinkedActivityContext | null>;
  /** Check-in settings (check-in.md §2.8); absent, the defaults. */
  checkInSettings?: () => CheckInSettings;
  /**
   * (Ben, 20 Oct) Lift targets: whether the setting is on, and `set_lift_target`'s checks. Absent, or
   * off: the tool is never offered and the coach doesn't see targets (they come through `training`).
   */
  liftTargets?: { on: () => Promise<boolean>; prepare: LiftTargetDeps['prepare'] };
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  newId: () => string;
  /** The model port (the plan route on the phone). Absent: the coach isn't in this build's wiring. */
  model?: () => CoachModelPort;
  /** Keychain + settings file; no network. Absent: not connected. */
  connection?: () => Promise<TextCoachState>;
  /** The built-in rule's next targets for a finished workout (workout services). */
  builtInNextTargets: (sessionId: string, reps?: Map<string, RuleReps>) => Promise<Map<string, { setType: SetType; planned: PlannedSet }[]> | null>;
  /** After a coach change to today's sets or its Undo: rest alerts follow the new targets. */
  onSessionChanged?: (aggregate: SessionAggregate) => void;
  /** The bundled exercise catalogue (Coaching knowledge), for swap options and names. */
  catalogueExercises?: () => readonly Exercise[];
  catalogueSubstitutions?: (catalogueKey: string) => readonly (string | null)[];
  /** (19 Oct) Add on the coach's new-exercise card: Ben's own write (custom exercises). Absent: `propose_exercise` isn't offered. */
  createCustomExercise?: (req: { fields: CustomExerciseFields; opId: string; proposalActionId: string }) => Promise<CustomWrite>;
  /**
   * (Review exlist S3) `propose_exercise`'s duplicate guard: the custom-exercise service's check over Ben's
   * whole list (his import names too). Absent: the same check on the exercises and catalogue aliases here.
   */
  exerciseClash?: (name: string) => Promise<{ catalogueId: string; name: string; near: boolean } | null>;
  /** (19 Oct) A catalogue entry's other names (Coaching knowledge), for `find_exercises`. */
  catalogueAliases?: (catalogueKey: string) => readonly string[];
  /** The typical gym's items when Ben has no gym yet (workout-builder §4.1 `⚠ No gym`): what Start would save. */
  typicalEquipment?: () => Promise<EquipmentInstance[] | null>;
  /**
   * (12 Oct) What the coach's `add_exercise_today` check needs for one exercise ID at the workout's gym
   * (workout services; local reads only). Absent: the tool isn't in this build's wiring (withheld, never offered).
   */
  coachAddInputs?: (exerciseId: string, aggregate: SessionAggregate) => Promise<{ exercise: Exercise | null; history: HistorySession[]; substitute: SubstituteContext; owner: UserProfile; sameMovementIds?: string[]; exerciseUnsaved?: boolean } | null>;
  /** (13 Oct, D7, D8) Ben's training details, split and main lifts for the planning context. Absent: listed as not available. */
  training?: () => Promise<TrainingInput | null>;
  /** Up next as Today's card names it (workout services; local reads only). Absent: the rotation's routine. */
  upNextTitle?: (gymId: string | null) => Promise<string | null>;
  /**
   * (Ben, 20 Oct) This week (week services; local reads only): YOUR DATA's `week` view and the facts
   * `propose_week` checks against. Absent: neither tool is wired (withheld, never offered).
   */
  week?: { view(): Promise<WeekContextView | null>; tool(): Promise<WeekToolContext | null> };
  /**
   * (Ben, 23 Oct, D8) Where an applied next-workout change lands: the builder's open Your workout drafts. `revert`
   * takes it back off every one it landed on (`check`: only whether it can, while it is still each one's last change).
   * Absent: nothing landed, so nothing to take back.
   */
  nextWorkout?: { revert(applyActionId: string, check: boolean): Promise<boolean> };
}

/** (Ben, 20 Oct) An activity the coach offered: `Log` while open; once logged, its record (Undo on it). */
export type ActivityOfferState = { kind: 'open' } | { kind: 'logged'; record: ActionRecord } | { kind: 'refused'; line: string };

/** A structural proposal card's state (ADR 0020 §3), from the proposal and Ben's taps on it. */
export interface ProposalCardState {
  state: StructuralProposalState;
  /** Ben's Apply record (its Undo), when he applied it. */
  apply: ActionRecord | null;
}

/** A memory suggestion card's state (coach-memory §2.4): the memory as it is now, and whether Save is still possible. */
export interface MemoryCardState {
  memory: Memory;
  canSave: boolean;
  /**
   * Ben chose `Add to playbook` on it (CM9; review coach-tools r3 N1, N2): where its words stand in the
   * playbook. `rejected`: he had rejected the same words before, so they weren't added again.
   */
  playbook?: 'to_review' | 'approved' | 'rejected';
}

/** Where words stand in the playbook: approved wins, then to review, then rejected (withdrawn is gone). */
function playbookStateOf(candidates: readonly PlaybookCandidate[], key: string): MemoryCardState['playbook'] {
  const same = candidates.filter((c) => c.contentKey === key);
  for (const status of ['approved', 'to_review', 'rejected'] as const) if (same.some((c) => c.status === status)) return status;
  return undefined;
}

/** A thread as stored, with every action its messages and turns refer to. */
export interface ThreadData {
  thread: CoachThread;
  messages: CoachMessage[];
  turns: Map<string, CoachTurn>;
  /** Actions by turn, for cards (including turns cut off before their reply was saved). */
  actionsByTurn: Map<string, ActionRecord[]>;
  /** Structural proposals in this thread: their card state (Apply, Not now, Undo). */
  proposals?: Map<string, ProposalCardState>;
  /** Memory suggestions in this thread, by action ID. */
  memories?: Map<string, MemoryCardState>;
  /** (19 Oct) New-exercise cards in this thread, by action ID: open, added or deleted since. */
  exerciseProposals?: Map<string, ExerciseProposalCard['state']>;
  /** (20 Oct, ADR 0029) The coach's gym suggestions in this thread, by action ID: Ben's Apply (with its Undo) or Not now. */
  gymProposals?: Map<string, GymProposalState>;
}

/** A gym suggestion card's state: open, applied (Ben's Apply record, for Undo), not applied, or out of date (the gym changed). */
export interface GymProposalState {
  state: 'open' | 'applied' | 'not_applied' | 'out_of_date';
  apply: ActionRecord | null;
}

const GENERAL_REUSE_MS = 6 * 60 * 60 * 1000;
/** How long one network failure reads as `Offline` (coach-sheet §4: it clears by itself when the network returns). */
export const OFFLINE_HOLD_MS = 60 * 1000;

/** Exercise IDs Ben named in his words, matched to the workout's exercises (for rule 9's `messagePain`). */
export function namedExercises(text: string, session: SessionAggregate | null): string[] {
  return session === null ? [] : exercisesNamedForPain(text, session.exercises);
}

/**
 * Whose actions `get_recent_actions` reads: a workout's or summary's thread reads that workout's only,
 * whether or not it's still in context (a deleted one then reads none); Today and the Progress entries
 * (general threads) read the owner's (review r3 S1). The store leaves out actions on workouts out of context either way.
 */
export function recentActionsScope(entry: CoachEntry): string | null {
  return isGeneralEntry(entry) ? null : entry.sessionId;
}

export function createCoachService(deps: CoachServiceDeps) {
  const repos = (): SqliteRepositories => deps.store().repos;
  const coachStore = () => repos().coach;
  const running = new Map<string, AbortController>();
  const summaryRuns = new Map<string, Promise<CoachTurnResult | null>>();
  const offerLogs = new Map<string, OfferLogEntry[]>();
  const offerQueues = new Map<string, Promise<unknown>>();
  /** When the last request failed for lack of network (UTC ms); a completed turn clears it, and it lapses after `OFFLINE_HOLD_MS`. */
  let lastNetworkFailureMs: number | null = null;

  /** The workout's offer log: from memory, else the store (a relaunch keeps CA4's once-per-kind). */
  async function offerLogOf(sessionId: string): Promise<OfferLogEntry[]> {
    const cached = offerLogs.get(sessionId);
    if (cached !== undefined) return cached;
    const stored = await coachStore()
      .listOffers(sessionId)
      .catch(() => []);
    const log = stored.flatMap((o): OfferLogEntry[] => (isTriggerKind(o.kind) ? [{ sessionExerciseId: o.sessionExerciseId, kind: o.kind, atVersion: o.atVersion }] : []));
    offerLogs.set(sessionId, log);
    return log;
  }

  async function owner(): Promise<UserProfile> {
    const p = await deps.profile();
    if (!p) throw new Error('Owner profile not found.');
    return p;
  }

  /** Ben already tapped `Add to playbook` on this suggestion: a live candidate in its words, made from it. */
  async function sentToPlaybook(m: Memory): Promise<boolean> {
    const key = playbookContentKey(m.text);
    for (const c of await coachStore().listPlaybookCandidates()) {
      if (c.contentKey !== key || c.status === 'withdrawn') continue;
      const a = await coachStore().getAction(c.createdByActionId);
      if (a?.detail.kind === 'add_playbook_candidate' && a.detail.fromMemoryId === m.id) return true;
    }
    return false;
  }

  async function availability(): Promise<CoachAvailability> {
    if (deps.connection === undefined || deps.model === undefined) return { status: 'not_connected', model: null };
    const s = await deps.connection().catch((): TextCoachState => ({ status: 'not_connected', route: null, email: null, model: null }));
    const offline = lastNetworkFailureMs !== null && toMs(deps.now().utc) - lastNetworkFailureMs < OFFLINE_HOLD_MS;
    const status: CoachStatus = s.status === 'ok' && offline ? 'offline' : s.status;
    return { status, model: s.model?.slug ?? null, ...(s.workoutModel == null ? {} : { workoutModel: s.workoutModel.slug }), ...(s.workoutModelGone === true ? { workoutModelGone: true as const } : {}) };
  }

  async function sessionOf(entry: CoachEntry): Promise<SessionAggregate | null> {
    if (isGeneralEntry(entry)) return null;
    const a = await repos().sessions.get(entry.sessionId).catch(() => null);
    // Only the live workout or one in history is in the coach's context (delete-workouts §5): a deleted,
    // discarded or reverted one isn't; its thread keeps its text.
    return a !== null && (a.session.status === 'active' || isInHistory(a.session)) ? a : null;
  }

  /** CS1: a workout's own thread; outside a workout the last general thread if used in the last 6 hours. */
  async function resolveThread(entry: CoachEntry): Promise<string | null> {
    const p = await owner();
    const threads = await coachStore().listThreads(p.id);
    if (!isGeneralEntry(entry)) return threads.find((t) => t.sessionId === entry.sessionId)?.id ?? null;
    const recent = threads.find((t) => t.sessionId === null);
    if (recent === undefined) return null;
    return toMs(deps.now().utc) - toMs(recent.updatedAtUtc) <= GENERAL_REUSE_MS ? recent.id : null;
  }

  async function loadThread(threadId: string): Promise<ThreadData | null> {
    const thread = await coachStore().getThread(threadId);
    if (thread === null) return null;
    const messages = await coachStore().listMessages(threadId);
    const turns = new Map<string, CoachTurn>();
    const actionsByTurn = new Map<string, ActionRecord[]>();
    for (const turnId of new Set(messages.map((m) => m.turnId))) {
      const t = await coachStore().getTurn(turnId);
      if (t !== null) turns.set(turnId, t);
      actionsByTurn.set(turnId, await coachStore().listTurnActions(turnId));
    }
    const proposalIds = [...actionsByTurn.values()].flat().filter((a) => a.detail.kind === 'propose_next_workout_change' && a.status === 'proposed').map((a) => a.actionId);
    const proposals = proposalIds.length === 0 ? new Map<string, ProposalCardState>() : await proposalStates(proposalIds);
    // Memory suggestions: the card follows the memory (Save, Not now, or 14 days without an answer).
    const memories = new Map<string, MemoryCardState>();
    const suggested = [...actionsByTurn.values()].flat().filter((a) => a.detail.kind === 'suggest_memory' && a.status === 'proposed');
    if (suggested.length > 0) {
      const all = await coachStore().listMemories(thread.ownerId, 'all');
      const nowUtc = deps.now().utc;
      const playbook = await coachStore().listPlaybookCandidates();
      for (const a of suggested) {
        if (a.detail.kind !== 'suggest_memory') continue;
        const id = a.detail.memoryId;
        const m = all.find((x) => x.id === id);
        if (m === undefined) continue;
        const state = m.status === 'not_saved' && m.closedAs === 'playbook' ? playbookStateOf(playbook, playbookContentKey(m.text)) : undefined;
        memories.set(a.actionId, { memory: m, canSave: memoryCanBeSaved(m, all, nowUtc), ...(state !== undefined ? { playbook: state } : {}) });
      }
    }
    // (19 Oct) New-exercise cards: whether Ben added it (the exercise row exists) or deleted it since.
    const exerciseProposals = new Map<string, ExerciseProposalCard['state']>();
    for (const a of [...actionsByTurn.values()].flat()) {
      if (a.detail.kind !== 'propose_exercise' || a.status !== 'proposed') continue;
      const e = await repos().exercises.get(a.detail.exerciseId).catch(() => null);
      exerciseProposals.set(a.actionId, e === null || e.ownerId !== thread.ownerId ? 'open' : isArchivedExercise(e) ? 'deleted' : 'added');
    }
    const gymProposals = new Map<string, GymProposalState>();
    const gymSuggestions = [...actionsByTurn.values()].flat().filter((a) => a.detail.kind === 'update_gym' && a.status === 'proposed');
    if (gymSuggestions.length > 0) {
      const taps = await coachStore().listGymUpdates(thread.ownerId).catch(() => [] as ActionRecord[]);
      for (const a of gymSuggestions) gymProposals.set(a.actionId, await gymProposalState(a, taps));
    }
    return { thread, messages, turns, actionsByTurn, proposals, memories, exerciseProposals, gymProposals };
  }

  /** (ADR 0029) A gym suggestion's card: Ben's tap on it, else whether the gym moved on since (then Apply would be refused). */
  async function gymProposalState(proposal: ActionRecord, taps: readonly ActionRecord[]): Promise<GymProposalState> {
    const mine = taps.filter((t) => t.detail.kind === 'update_gym' && t.detail.proposalId === proposal.actionId);
    const apply = mine.find((t) => t.status === 'committed') ?? null;
    if (apply !== null) return { state: 'applied', apply };
    if (mine.some((t) => t.status === 'rejected')) return { state: 'not_applied', apply: null };
    if (proposal.detail.kind !== 'update_gym') return { state: 'out_of_date', apply: null };
    const edit = proposal.detail.edit;
    const gym = await repos().gyms.get(edit.gymId).catch(() => null);
    const items = new Map((await repos().equipment.listByGym(edit.gymId).catch(() => [] as EquipmentInstance[])).map((e) => [e.id, e]));
    const current = (edit.gym === null || gym?.version === edit.gym.before.version) && edit.equipment.every((e) => (e.before === null ? !items.has(e.after.id) : items.get(e.before.id)?.version === e.before.version));
    return { state: current ? 'open' : 'out_of_date', apply: null };
  }

  /**
   * Applies the next workout's Your workout draft couldn't take on its last
   * open (review S1; D8): not doable at that gym, a pain flag, or the
   * exercise isn't in it any more. Kept for this app run only: every open
   * works it out again (another gym may take it), so nothing about it is
   * stored. After a force-close the card is optimistic: it reads `Applied`
   * until that workout opens again (review coach-tools r2 N1).
   */
  const refusedApplies = new Set<string>();

  /** Each proposal's card state: Ben's Apply or Not now, and whether a workout started from its basis since (or the routine moved on). */
  async function proposalStates(proposalIds: readonly string[]): Promise<Map<string, ProposalCardState>> {
    const p = await owner();
    const all = await coachStore().listStructural(p.id);
    const out = new Map<string, ProposalCardState>();
    for (const id of proposalIds) {
      const proposal = all.find((a) => a.actionId === id);
      if (proposal === undefined || proposal.detail.kind !== 'propose_next_workout_change' || proposal.detail.basis === undefined) continue;
      const d = proposal.detail;
      const basis = d.basis;
      if (basis === undefined) continue;
      const taps = all.filter((a) => a.detail.kind === 'propose_next_workout_change' && a.detail.proposalId === id);
      const apply = taps.find((a) => a.status === 'committed') ?? null;
      const dismissed = taps.some((a) => a.status === 'rejected');
      const since = apply?.createdAt.utc ?? proposal.createdAt.utc;
      const startedSince = await coachStore().basisStartedSince(p.id, basis, since).catch(() => false);
      // (D8) A change made since Your workout takes it lands there. One from before (written into the retired overview's
      // draft) reads `Out of date`, never Apply (review B3), and an older Apply has no Undo (nit 3).
      const lands = d.landsOn === 'your_workout';
      let basisChanged = !lands;
      if (lands && apply === null && basis.kind === 'routine' && d.basisVersion !== undefined) {
        const routine = await repos().routines.get(basis.routineId).catch(() => null);
        basisChanged = routine === null || routine.version !== d.basisVersion;
      }
      const refusedHere = apply !== null && refusedApplies.has(apply.actionId);
      const shownApply = apply === null ? null : lands ? { undone: apply.undoneBy !== null } : apply.undoneBy === null ? null : { undone: true };
      out.set(id, { state: structuralProposalState({ apply: shownApply, dismissed, startedSince, basisChanged, refusedHere }), apply });
    }
    return out;
  }

  async function exerciseById(id: string): Promise<Exercise | null> {
    return (await repos().exercises.get(id).catch(() => null)) ?? deps.catalogueExercises?.().find((e) => e.id === id) ?? null;
  }

  /**
   * What the next workout from `source` starts from (ADR 0020 §3): its plan day's template (D8: a plan day started
   * from Your workout names its template, not a routine), its routine, else the next session built from it.
   */
  async function structuralBasisOf(p: UserProfile, source: SessionAggregate): Promise<{ basis: DraftBasis; basisVersion: number | null; label: string; slots: StructuralSlot[] } | null> {
    const routineId = source.session.planDay?.templateRoutineId ?? source.session.routineId;
    const routine = routineId === null ? null : await repos().routines.get(routineId).catch(() => null);
    if (routine !== null && routine.ownerId === p.id && (routine.deletedAtUtc ?? null) === null) {
      const slots: StructuralSlot[] = [];
      for (const r of [...routine.exercises].sort((a, b) => a.order - b.order)) {
        const name = (await exerciseById(r.exerciseId))?.name ?? source.exercises.find((e) => e.exerciseId === r.exerciseId)?.exerciseName ?? 'Exercise';
        slots.push({ slotKey: r.id, exerciseId: r.exerciseId, supersetGroup: r.supersetGroup, name });
      }
      return { basis: { kind: 'routine', routineId: routine.id }, basisVersion: routine.version, label: routine.name, slots };
    }
    // The next session of a workout: its part roots (the ones Start copies once it's finished).
    const roots =
      isInHistory(source.session)
        ? basisSlots({ kind: 'next', source })
        : [...source.exercises].sort((a, b) => a.order - b.order).filter((e) => e.removed === undefined && partRootOf(source.exercises, e.id) === e.id).map((e) => ({ slotKey: e.id, exerciseId: e.exerciseId, supersetGroup: e.supersetGroup }));
    if (roots.length === 0) return null;
    const name = (exerciseId: string) => source.exercises.find((e) => e.exerciseId === exerciseId)?.exerciseName ?? 'Exercise';
    return { basis: { kind: 'next', sourceSessionId: source.session.id }, basisVersion: null, label: source.session.routineName ?? 'workout', slots: roots.map((r) => ({ ...r, name: name(r.exerciseId) })) };
  }

  /** The workout a structural change would build from in this turn: the one in context, else the last finished one. */
  async function structuralSource(p: UserProfile, session: SessionAggregate | null): Promise<SessionAggregate | null> {
    if (session !== null) return session;
    // (ADR 0032) A structural change builds from the full stored workout, not its history summary.
    const last = await repos().sessions.latestFinished(p.id).catch(() => null);
    return last === null ? null : repos().sessions.get(last.session.id).catch(() => null);
  }

  /** CA9 signals for the gate: a pain flag since that workout, or its equipment changed (never from the model). */
  async function structuralSignalsFor(p: UserProfile, session: SessionAggregate | null): Promise<StructuralSignalKind[]> {
    const source = await structuralSource(p, session);
    if (source === null) return [];
    const gymId = source.session.gymId;
    const equipment = gymId === null ? [] : await repos().equipment.listByGym(gymId).catch(() => []);
    const signals = getStructuralChangeSignals({ source, painFlags: await repos().painFlags.listActive(p.id).catch(() => []), varietyRequests: [], currentEquipment: equipment, nextGymId: null, nowUtc: deps.now().utc });
    return [...new Set(signals.map((x) => x.kind))];
  }

  function structuralDeps(p: UserProfile, session: SessionAggregate | null): StructuralDeps {
    const gymOf = async () => {
      const g = await gymInContext(p, session);
      return g === null ? null : { id: g.id, name: g.name, equipment: await repos().equipment.listByGym(g.id).catch(() => []) };
    };
    return {
      store: coachStore(),
      async basisFor(sourceSessionId) {
        const source = await repos().sessions.get(sourceSessionId).catch(() => null);
        if (source === null || source.session.ownerId !== p.id || (!isInHistory(source.session) && source.session.status !== 'active')) return null;
        const basis = await structuralBasisOf(p, source);
        return basis === null ? null : { sourceVersion: source.session.version, basis };
      },
      async exercise(id) {
        const e = await exerciseById(id);
        return e === null ? null : { name: e.name, measurement: e.measurement };
      },
      async doable(id) {
        const e = await exerciseById(id);
        const gym = await gymOf();
        return e !== null && gym !== null && doableHere(e, gym);
      },
      painFlags: () => repos().painFlags.listActive(p.id),
      async substitutions(exerciseId) {
        const planned = await exerciseById(exerciseId);
        const gym = await gymOf();
        if (planned === null || gym === null) return null;
        const pool = new Map<string, Exercise>();
        for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) pool.set(e.id, e);
        for (const e of deps.catalogueExercises?.() ?? []) if (!pool.has(e.id)) pool.set(e.id, e);
        const flagged = new Set((await repos().painFlags.listActive(p.id).catch(() => [])).map((f) => f.exerciseId));
        return substitutionOptions({
          planned,
          pool: [...pool.values()],
          catalogueSubstitutions: planned.catalogueKey ? (deps.catalogueSubstitutions?.(planned.catalogueKey) ?? []) : [],
          gym,
          painFlagged: flagged,
          exclude: new Set((session?.exercises ?? []).map((e) => e.exerciseId)),
        });
      },
    };
  }

  async function checkInOf(session: SessionAggregate | null): Promise<CheckIn | null> {
    if (session?.session.checkIn?.kind !== 'answered') return null;
    return repos().checkIns.get(session.session.checkIn.checkInId).catch(() => null);
  }

  /** The turn kind from the entry and the workout's state (an old workout's thread is read-only for it). */
  function kindFor(entry: CoachEntry, session: SessionAggregate | null, summaryTurn: boolean): CoachTurnKind {
    if (summaryTurn) return 'summary';
    if (entry.kind === 'workout' && session?.session.status === 'active') return 'workout';
    return 'general';
  }

  async function builtInNext(session: SessionAggregate): Promise<Map<string, { setType: SetType; planned: PlannedSet }[]>> {
    return (await deps.builtInNextTargets(session.session.id).catch(() => null)) ?? new Map();
  }

  /** The gym a question is about: the workout's, else the default gym, else the last workout's (null: none yet). */
  /** `update_gym`'s gym (ADR 0029): the saved gym Ben named, else the workout's (or selected) gym, with its items and unit. */
  async function gymForUpdate(p: UserProfile, session: SessionAggregate | null, name: string | null): Promise<GymUpdatePlace | null> {
    const gyms = (await repos().gyms.listByOwner(p.id).catch(() => [])).filter((g) => g.archivedAtUtc === undefined);
    let gym: Gym | undefined;
    if (name !== null && name.trim() !== '') {
      const named = savedGymFor(name, gyms.map((g) => g.name));
      gym = named === null ? undefined : gyms.find((g) => g.name === named);
      if (gym === undefined) return null;
    } else {
      const here = await gymInContext(p, session);
      gym = here === null ? undefined : gyms.find((g) => g.id === here.id);
    }
    if (gym === undefined) return null;
    const equipment = await repos().equipment.listByGym(gym.id).catch(() => [] as EquipmentInstance[]);
    return { gym, equipment, unit: equipment.find((e) => e.availability === 'available')?.unit ?? p.preferredUnit };
  }

  /** (ADR 0029) The coach's one-line view of a gym's setup (`full gym (assumed)`), when it has one. */
  function setupOf(gym: Gym | null, equipment: readonly EquipmentInstance[]): { setup?: string } {
    const words = gym === null ? null : gymSetupWords(gym, equipment);
    return words === null ? {} : { setup: words };
  }

  /** An exercise by Ben's ID or a catalogue ID (`machine-leg-press`), as the coach names them. */
  async function exerciseByIdOrKey(key: string): Promise<Exercise | null> {
    const byId = await exerciseById(key).catch(() => null);
    if (byId !== null) return byId;
    return deps.catalogueExercises?.().find((e) => e.catalogueKey === key) ?? (await repos().exercises.list().catch(() => [] as Exercise[])).find((e) => e.catalogueKey === key) ?? null;
  }

  async function gymInContext(p: UserProfile, session: SessionAggregate | null): Promise<{ id: string; name: string } | null> {
    const gyms = (await repos().gyms.listByOwner(p.id).catch(() => [])).filter((g) => g.archivedAtUtc === undefined);
    const byId = (id: string | null | undefined) => (id == null ? undefined : gyms.find((g) => g.id === id));
    const last = session === null ? await repos().sessions.latestFinished(p.id).catch(() => null) : null;
    const g = byId(session?.session.gymId) ?? gyms.find((x) => x.isDefault) ?? byId(last?.session.gymId) ?? gyms[0];
    return g === undefined ? null : { id: g.id, name: g.name };
  }

  /**
   * Past workouts, gym equipment and the built-in rule's targets for the read
   * tools (backlog §4.3). Local reads only; each view is Your data, quoted as
   * data (rules 8, 10). Deleted and discarded workouts are never read: the
   * repository lists finished workouts only.
   */
  function trainingReads(p: UserProfile, session: SessionAggregate | null): TrainingReadPort {
    const gymNames = async (): Promise<Record<string, string>> => Object.fromEntries((await repos().gyms.listByOwner(p.id).catch(() => [])).map((g) => [g.id, g.name]));
    const equipmentNames = (aggs: readonly HistoryLike[]): Record<string, string> => Object.fromEntries(aggs.flatMap((a) => a.session.equipmentSnapshot.map((e) => [e.id, e.name] as const)));
    const exerciseNameOf = async (id: string, aggs: readonly HistoryLike[]): Promise<string | null> =>
      (await repos().exercises.get(id).catch(() => null))?.name ?? aggs.flatMap((a) => a.exercises).find((e) => e.exerciseId === id)?.exerciseName ?? null;
    const finishedWith = (exerciseId: string) => repos().sessions.listFinishedWithExercise(p.id, exerciseId).catch(() => [] as HistoryWorkout[]);
    return {
      async exerciseHistory(exerciseId, sessions) {
        const aggs = await finishedWith(exerciseId);
        const name = await exerciseNameOf(exerciseId, aggs);
        if (name === null || aggs.length === 0) return null;
        return exerciseHistoryView({ exerciseId, exerciseName: name, sessions: aggs, limit: sessions, gymNames: await gymNames(), equipmentNames: equipmentNames(aggs) });
      },
      async overview(weeks) {
        const now = deps.now();
        const from = toIso(toMs(now.utc) - weeks * 7 * 86_400_000);
        const aggs = await repos().sessions.listFinishedBetween(p.id, from, now.utc).catch(() => [] as HistoryWorkout[]);
        const firstWorkoutUtc = await repos().sessions.earliestFinishedStartUtc(p.id).catch(() => null);
        return trainingOverviewView({ weeks, nowUtc: now.utc, tz: now.tz, sessions: aggs, gymNames: await gymNames(), firstWorkoutUtc });
      },
      async equipment(exerciseId, gymName) {
        // Coach v3: another saved gym by name (the hotel gym), matched like a build's gymName; else the gym in context.
        const saved = (await repos().gyms.listByOwner(p.id).catch(() => [])).filter((g) => g.archivedAtUtc === undefined);
        const named = gymName == null || gymName.trim() === '' ? null : (saved.find((g) => sameGymName(gymName, g.name)) ?? null);
        if (gymName != null && gymName.trim() !== '' && named === null) return null;
        const gym = named === null ? await gymInContext(p, session) : { id: named.id, name: named.name };
        if (gym === null) return null;
        const exercise = exerciseId === null ? null : await repos().exercises.get(exerciseId).catch(() => null);
        if (exerciseId !== null && exercise === null) return null;
        const items = await repos().equipment.listByGym(gym.id).catch(() => []);
        return equipmentView({ gymName: gym.name, equipment: items, exercise, savedGyms: saved.map((g) => g.name) });
      },
      async exerciseRecords(exerciseId) {
        const aggs = await finishedWith(exerciseId);
        const name = await exerciseNameOf(exerciseId, aggs);
        if (name === null || aggs.length === 0) return null;
        return exerciseRecordsView({ exerciseId, exerciseName: name, sessions: aggs, gymNames: await gymNames(), equipmentNames: equipmentNames(aggs) });
      },
      async recentSessions(count) {
        const refs = await repos().sessions.listFinishedRefs(p.id, count, { includeImported: true }).catch(() => []);
        const aggs: SessionAggregate[] = [];
        for (const r of refs) {
          const a = await repos().sessions.get(r.sessionId).catch(() => null);
          if (a !== null) aggs.push(a);
        }
        return recentSessionsView({ sessions: aggs, count, gymNames: await gymNames() });
      },
      async builtInTargets(exerciseId) {
        const aggs = await finishedWith(exerciseId);
        const latest = [...aggs].sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc))[0];
        if (latest === undefined) return null;
        const reps = new Map<string, RuleReps>();
        const planned = (await deps.builtInNextTargets(latest.session.id, reps).catch(() => null))?.get(exerciseId) ?? null;
        const ex = latest.exercises.find((e) => e.exerciseId === exerciseId);
        if (planned === null || ex === undefined) return null;
        const flags = await repos().painFlags.listActive(p.id).catch(() => []);
        const ruleRpes: Record<string, number> = await ruleRpesOf(latest).catch(() => ({}));
        const ruleRpe = ruleRpes[ex.id] ?? null;
        return builtInTargetsView({
          ruleRpe,
          exerciseName: ex.exerciseName,
          convention: ex.loadConvention,
          planned,
          basedOn: { utc: latest.session.startedAt.utc, tz: latest.session.startedAt.tz, title: latest.session.routineName },
          painFlag: flags.find((f) => f.exerciseId === exerciseId && f.status === 'active') ?? null,
          reps: reps.get(exerciseId) ?? null,
        });
      },
    };
  }

  /**
   * Coach v3: what `edit_today` and Ben's accept of an offered edit need for the live workout: the
   * workout read fresh, pain, the gym, and the add tool's local reads for each exercise an add or a
   * swap names (no AI, no network).
   */
  function editDepsFor(p: UserProfile, session: SessionAggregate, gymName: string | null, checkIn: CheckIn | null, onlySessionExerciseId: string | null = null): EditTodayDeps {
    const addInputs = deps.coachAddInputs;
    return {
      store: coachStore(),
      loadSession: () => repos().sessions.get(session.session.id),
      painFlags: () => repos().painFlags.listActive(p.id),
      sessionPainUnspecified: unspecifiedPain(checkIn).active,
      gymName,
      onlySessionExerciseId,
      ruleTargetRpe: ruleRpesOf,
      ...(addInputs === undefined ? {} : { inputs: (exerciseId: string, aggregate: SessionAggregate) => addInputs(exerciseId, aggregate).catch(() => null) }),
      ...(deps.onSessionChanged === undefined ? {} : { onSessionChanged: deps.onSessionChanged }),
    };
  }

  async function executorsFor(p: UserProfile, entry: CoachEntry, kind: CoachTurnKind, session: SessionAggregate | null, gymName: string | null, checkIn: CheckIn | null, benAskedForMoreSets: boolean, onlySessionExerciseId: string | null = null): Promise<CoachExecutors> {
    const store = coachStore();
    const reads = createTrainingReadExecutors(trainingReads(p, session));
    const base: CoachExecutors = {
      ...reads,
      // (20 Oct, ADR 0029) "This gym has no leg press": applied with Undo when Ben said it, else a card he applies.
      update_gym: createGymUpdateExecutor({ store, gym: (name) => gymForUpdate(p, session, name), exercise: exerciseByIdOrKey }),
      // (Ben, 23 Oct, D8) `propose_next_workout_change` is back: an Apply lands on the next workout's Your workout draft
      // (today-only edits with Undo; the builder's `landCoachChanges`), so the card never says Applied for nothing.
      ...createStructuralExecutors(structuralDeps(p, session)),
      ...createStoreExecutors({
      store,
      exercises: { exerciseName: async (id) => (await repos().exercises.get(id).catch(() => null))?.name ?? session?.exercises.find((e) => e.exerciseId === id)?.exerciseName ?? null },
      // A workout's thread reads only that workout's actions, even when the workout is out of context
      // (deleted): the store then returns none, rather than every action Ben has (review r3 S1).
      sessionId: recentActionsScope(entry),
      }),
    };
    if (session === null) return base;
    const load = () => repos().sessions.get(session.session.id);
    const painFlags = () => repos().painFlags.listActive(p.id);
    const out: CoachExecutors = { ...base, get_active_session: createSessionReadExecutor({ loadSession: load, gymName, ruleTargetRpe: ruleRpesOf }) };
    if (kind === 'workout') {
      // Coach v3 (ADR 0027): one tool for today's workout (swap, add, remove, move, set count, targets); applies only when Ben asked.
      out.edit_today = createEditTodayExecutor(editDepsFor(p, session, gymName, checkIn, onlySessionExerciseId));
      // "Log 100 for 8", "set 2 was 95" (backlog §4.3): the workout's own commands, only when Ben's words ask.
      Object.assign(out, createChatSetExecutors({ store, loadSession: load, ...(deps.onSessionChanged === undefined ? {} : { onSessionChanged: deps.onSessionChanged }) }));
      // "Change name of workout to …" (14 Oct): the workout's own `rename_session`, applied only when Ben asked.
      Object.assign(out, createRenameExecutor({ store, loadSession: load, ...(deps.onSessionChanged === undefined ? {} : { onSessionChanged: deps.onSessionChanged }) }));
    }
    if (kind === 'summary') {
      out.set_next_session_targets = createNextTargetsExecutor({
        store,
        source: session,
        bases: nextSessionBases(session, await builtInNext(session), await ruleRpesOf(session).catch(() => ({}))),
        painFlags,
        gymName,
        workoutLabel: session.session.routineName ?? 'workout',
        benAskedForMoreSets,
        // (Review ben-8-decisions B1) Ben's answer to the rule's reset stands for that exercise.
        ruleAnswered: async () => new Set((await coachStore().listNextTargets(p.id, session.session.id).catch(() => [])).filter(isRuleResetRow).map((r) => r.exerciseId)),
      });
    }
    return out;
  }

  /** (21 Oct) The recent sessions of a live workout's exercises in play, as `get_recent_training` reads them. Local reads only. */
  async function recentLiftsFor(p: UserProfile, session: SessionAggregate, words: string): Promise<ExerciseHistoryView[]> {
    const reads = trainingReads(p, session);
    const out: ExerciseHistoryView[] = [];
    for (const id of liveFocusExerciseIds(session, namedExercises(words, session))) {
      const v = await reads.exerciseHistory(id, RECENT_LIFT_SESSIONS).catch(() => null);
      if (v !== null && v.sessions.length > 0) out.push(v);
    }
    return out;
  }

  async function gymNameOf(session: SessionAggregate | null): Promise<string | null> {
    const gymId = session?.session.gymId ?? null;
    if (gymId === null) return null;
    return (await repos().gyms.get(gymId).catch(() => null))?.name ?? null;
  }

  /** Progress's window as dates in Ben's timezone, so the coach reads "this month" against what he sees. */
  function openedFromOf(p: UserProfile, entry: CoachEntry): OpenedFrom | undefined {
    if (entry.kind === 'progress_exercise') return { screen: 'progress_exercise', exercise: entry.exerciseName, series: entry.seriesLabel, range: { from: entry.from, to: entry.to } };
    if (entry.kind !== 'progress') return undefined;
    if (entry.range) return { screen: 'progress', window: { days: customProgressWindow(entry.range).days, from: entry.range.from, to: entry.range.to, label: rangeText(entry.range, localDateOf(toMs(deps.now().utc), p.timezone)) } };
    const w = progressWindowAt(toMs(deps.now().utc), p.timezone, entry.period);
    return { screen: 'progress', window: { days: w.days, from: w.from, to: w.to, label: `last ${progressPeriodPhrase(entry.period)}` } };
  }

  async function contextInput(p: UserProfile, kind: CoachTurnKind, session: SessionAggregate | null, entry: CoachEntry) {
    const openedFrom = openedFromOf(p, entry);
    const gymName = await gymNameOf(session);
    const checkIn = await checkInOf(session);
    const builtIn = kind === 'summary' && session !== null ? await builtInNext(session) : null;
    const training = (await deps.training?.().catch(() => null)) ?? null;
    const linkedActivity = session === null || deps.healthLinked === undefined ? null : await deps.healthLinked(session.session.id).catch(() => null);
    return {
      gymName,
      checkIn,
      input: {
        session,
        gymName,
        ...(session === null ? {} : { ruleTargetRpe: await ruleRpesOf(session).catch(() => ({})) }),
        painFlags: await repos().painFlags.listActive(p.id),
        checkIn,
        // (Builder v3) Day notes go only with their day (`dayNotesFor`), so ✕ keeps one from the coach that day.
        memories: (await coachStore().listMemories(p.id)).filter((m) => m.dayNote === undefined),
        catalogue: [],
        // Coaching knowledge: only the chat rules Ben approved are sent (never memories, rule 10).
        playbookCandidates: await coachStore().listPlaybookCandidates().catch(() => []),
        // The read tools for past workouts, equipment and the built-in rule are wired (backlog §4.3).
        trainingHistoryAvailable: true,
        ...(openedFrom === undefined ? {} : { openedFrom }),
        ...(training === null ? {} : { training }),
        ...(linkedActivity === null ? {} : { linkedActivity }),
        ...(builtIn === null || session === null
          ? {}
          : {
              builtInNext: nextSessionBases(session, builtIn).flatMap((b) =>
                b.builtIn === null ? [] : [{ exerciseId: b.exercise.exerciseId, name: b.exercise.exerciseName, target: b.builtIn.target, sets: b.builtIn.sets }],
              ),
            }),
      },
    };
  }

  /** Did Ben ask for more sets or volume in this thread (D1)? Only his own words. */
  async function askedForMoreSets(threadId: string | null): Promise<boolean> {
    if (threadId === null) return false;
    const msgs = await coachStore().listMessages(threadId).catch(() => []);
    return msgs.some((m) => m.body.role === 'ben' && m.body.input.kind === 'words' && asksForMoreSets(m.body.input.text));
  }

  interface SendRequest {
    entry: CoachEntry;
    threadId: string | null;
    input: BenInput;
    /** The tap's ID: a double-tapped Send runs one turn. */
    turnId: string;
    onProgress?: (p: CoachTurnProgress) => void;
    /** The post-workout summary turn (D21). */
    summary?: boolean;
    /** How a build request was made (§8.2 `origin`): the Build card or the chip; words typed or spoken otherwise. */
    buildOrigin?: 'chip' | 'card';
    /** The Build card's chips (code, never the model): its length and focus win over what the words say. */
    buildChips?: BuildChips | null;
  }

  /**
   * Whether the thread's newest coach draft is still open (BD15's fixed line applies there; review
   * S4: a started, discarded or expired draft doesn't count). Newest turn first; stops at the first build.
   */
  async function threadHasOpenDraft(p: UserProfile, threadId: string | null): Promise<boolean> {
    if (threadId === null) return false;
    const msgs = await coachStore().listMessages(threadId).catch(() => []);
    for (const turnId of [...new Set(msgs.map((m) => m.turnId))].reverse()) {
      const build = [...(await coachStore().listTurnActions(turnId).catch(() => []))].reverse().find((a) => a.detail.kind === 'build_workout' && a.status === 'committed');
      if (build !== undefined && build.detail.kind === 'build_workout') {
        const d = await draftOf(p, build.detail.draftId);
        return d !== null && d.status === 'open';
      }
    }
    return false;
  }

  /** A coach draft of Ben's, open or not (the turn reads it; the executor refuses a closed one). */
  async function draftOf(p: UserProfile, draftId: string): Promise<WorkoutDraft | null> {
    const d = await repos().workoutDrafts.get(draftId).catch(() => null);
    return d !== null && d.ownerId === p.id && coachDraftIsOpen(d, deps.now().utc) ? d : null;
  }

  /**
   * (19 Oct) The open coach plan the thread's newest build made, or null: the newest `build_workout` or
   * `build_plan` card in the thread decides which build Ben's change words are about.
   */
  async function threadOpenPlan(p: UserProfile, threadId: string | null): Promise<PlanDraft | null> {
    if (threadId === null) return null;
    const msgs = await coachStore().listMessages(threadId).catch(() => []);
    for (const turnId of [...new Set(msgs.map((m) => m.turnId))].reverse()) {
      const build = [...(await coachStore().listTurnActions(turnId).catch(() => []))].reverse().find((a) => (a.detail.kind === 'build_workout' || a.detail.kind === 'build_plan') && a.status === 'committed');
      if (build === undefined) continue;
      if (build.detail.kind !== 'build_plan') return null;
      const plan = await repos().planDrafts.get(build.detail.planId).catch(() => null);
      return plan !== null && plan.ownerId === p.id && planIsOpen(plan, deps.now().utc) ? plan : null;
    }
    return null;
  }

  /** (Review planview-19oct B1) Ben's plan in use (applied), or null. */
  async function appliedPlanOf(p: UserProfile): Promise<PlanDraft | null> {
    const plan = await repos().planDrafts.applied(p.id).catch(() => null);
    return plan !== null && plan.ownerId === p.id && plan.status === 'applied' ? plan : null;
  }

  /** The selected gym for a build (§4.1): the default gym, else the typical gym's items (`⚠ No gym`). */
  /**
   * The gym a build is planned at. Coach v3 (Ben 18 Oct, "in my hotel gym"): a saved gym Ben's words
   * name (newest first), else the draft's own gym, else the gym in context.
   */
  async function buildGym(p: UserProfile, words: readonly string[] = [], draftGymId: string | null = null): Promise<{ gym: SnapGym; typical: boolean } | null> {
    const saved = (await repos().gyms.listByOwner(p.id).catch(() => [])).filter((x) => x.archivedAtUtc === undefined);
    const named = gymNamedIn(words, saved.map((x) => x.name));
    const pick = saved.find((x) => named !== null && x.name === named) ?? saved.find((x) => x.id === draftGymId) ?? null;
    const g = pick === null ? await gymInContext(p, null) : { id: pick.id, name: pick.name };
    if (g !== null) return { gym: { id: g.id, name: g.name, equipment: await repos().equipment.listByGym(g.id).catch(() => []) }, typical: false };
    const typical = (await deps.typicalEquipment?.().catch(() => null)) ?? null;
    return typical === null ? null : { gym: { id: 'typical-gym-preview', name: 'Typical gym', equipment: typical }, typical: true };
  }

  /**
   * (12 Oct) The exercises `add_exercise_today` may add in this workout: Ben's and the catalogue's, measured
   * in reps or time, doable at the workout's current gym (rule 4) and not pain-flagged (rule 9). (19 Oct)
   * Exercises already in it stay listed: an add of one is a second copy (a superset with itself at 0).
   * Sent only when Ben's words asked to add one.
   */
  async function addableFor(p: UserProfile, session: SessionAggregate): Promise<AddableExercise[]> {
    const flags = await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
    const at = deps.now();
    const nowMs = toMs(at.utc);
    const gym = { id: session.session.gymId ?? 'no-gym', name: 'this gym', equipment: currentGymEquipment(session.session) };
    const pool = await exercisePool();
    // Review S2: the same movement under another ID or name (a FitNotes custom "Lateral Raise") counts as flagged.
    const flagged = movementMatcher(pool, flags.filter((f) => f.status === 'active'));
    return pool
      .filter((e) => (e.ownerId === null || e.ownerId === p.id) && !isArchivedExercise(e) && e.measurement !== 'distance' && !flagged(e) && painFlagCovering(flags, e.id, nowMs, at.tz) === null && doableHere(e, gym))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({ exerciseId: e.catalogueKey ?? e.id, name: e.name, equipment: e.compatibleEquipment[0]?.replaceAll('_', ' ') ?? 'bodyweight', measured: e.measurement === 'cardio' ? ('cardio' as const) : e.measurement === 'duration' ? ('time' as const) : ('reps' as const) }));
  }

  /**
   * (Ben, 27 Oct: "Why not") `find_exercises`' second pool: the rest of Ben's list (catalogue and his own, not deleted)
   * with code's reason it can't be added here now, so the coach names the reason instead of "not in your list".
   */
  function elsewherePool(p: UserProfile, pool: readonly Exercise[], usableIds: ReadonlySet<string>, gym: { name: string; equipment: readonly EquipmentInstance[] }, flagged: (e: Exercise) => boolean): (FindableExercise & { why: string })[] {
    return findablePool(pool.filter((e) => (e.ownerId === null || e.ownerId === p.id) && !isArchivedExercise(e) && !usableIds.has(e.id))).map((f) => {
      const e = f.exercise as Exercise;
      const why = flagged(e) ? 'pain flagged' : e.measurement === 'distance' ? 'measured by distance (not added by the coach)' : `${gym.name} has no ${missingEquipmentNoun(e, gym.equipment)} in its profile`;
      return { ...f, why };
    });
  }

  /** `find_exercises`' pool: the IDs the coach uses (catalogue key, else Ben's ID), with catalogue aliases. */
  function findablePool(list: readonly Exercise[]): FindableExercise[] {
    return list.map((e) => ({ catalogueId: e.catalogueKey ?? e.id, exercise: e, aliases: e.catalogueKey ? (deps.catalogueAliases?.(e.catalogueKey) ?? []) : [] }));
  }

  /**
   * (19 Oct) `propose_exercise`'s checks: a name already in Ben's list (catalogue or his own, not
   * deleted, at any gym) is refused with the one to use; Add saves the card's exercise under an ID
   * from the card.
   */
  function proposeDeps(p: UserProfile, pool: readonly Exercise[]): ExerciseListDeps['propose'] {
    if (deps.createCustomExercise === undefined) return undefined;
    const mine = pool.filter((e) => e.ownerId === null || e.ownerId === p.id);
    const shared = deps.exerciseClash;
    return {
      store: coachStore(),
      // Review exlist S3: the Library's own check (his import names too), with near matches.
      clash:
        shared ??
        ((name) => {
          const r = exerciseNearDuplicate(
            name,
            mine.map((e) => ({ id: e.id, name: e.name, aliases: e.catalogueKey ? (deps.catalogueAliases?.(e.catalogueKey) ?? []) : [], source: e.source, archived: isArchivedExercise(e), e })),
          );
          return Promise.resolve(r === null ? null : { catalogueId: r.hit.e.catalogueKey ?? r.hit.e.id, name: r.hit.e.name, near: r.near });
        }),
      exerciseIdFor: (ownerId, actionId) => customExerciseIdOf(ownerId, { proposalActionId: actionId }),
    };
  }

  /** Ben's exercises and the catalogue's (Coaching knowledge), by ID: what a catalogue key can resolve to. */
  async function exercisePool(): Promise<Exercise[]> {
    const pool = new Map<string, Exercise>();
    for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) pool.set(e.id, e);
    for (const e of deps.catalogueExercises?.() ?? []) if (!pool.has(e.id)) pool.set(e.id, e);
    return [...pool.values()];
  }

  /**
   * A build turn (workout-builder §8.2, §8.4): code reads the length and
   * focus (Ben's chips, else his words, else the draft being changed, else
   * 60); the context lists only exercises usable at the selected gym (BD5);
   * the executor checks the call against the same gym, pain flags and
   * limits. Review r4 (PM, 13 Oct, pending Ben): every general turn with a gym gets it, so
   * `propose_workout` is offered whatever his words (forcing stays `forcesBuild`'s call in the turn).
   * `inPlay`: Ben asked for a build or is following one up; otherwise the usable list is capped
   * shorter and the whole-build timeout isn't applied. Null only when there's no gym at all.
   */
  async function buildTurn(
    p: UserProfile,
    said: string,
    origin: 'chip' | 'card' | 'text' | 'voice',
    draft: WorkoutDraft | null,
    chips: BuildChips | null,
    followUp: BuildFollowUp | null,
    chain: QuestionChain | null = null,
    /** Coach v3: Ben's earlier messages in this thread, newest first (which gym he named). */
    earlierWords: readonly string[] = [],
    /** (19 Oct) Ben asked for a plan of several days, or to change the open plan in this thread (`plan`). */
    planRequest: { plan: PlanDraft | null; basedOn?: PlanDraft | null } | null = null,
  ): Promise<{ view: BuildContextView; executors: CoachExecutors; inPlay: boolean } | null> {
    const inPlay = planRequest !== null || asksForBuild({ turnKind: 'general', text: said, draftInContext: draft !== null, followUp });
    // A follow-up ("yes add it") reads length and focus from Ben's earlier request too; never from the coach's text.
    const text = buildRequestWords(said, followUp);
    const parent = draft === null ? null : currentDraftVersion(draft);
    // Newest first: "yes but make it 45 mins" beats the request's length (review B2, B3).
    const newest = buildWordsNewestFirst(said, followUp);
    const place = await buildGym(p, [...newest, ...earlierWords], parent?.request.gymId ?? null);
    if (place === null) return null;
    const { gym } = place;
    const savedGyms = (await repos().gyms.listByOwner(p.id).catch(() => [])).filter((x) => x.archivedAtUtc === undefined);
    const firstOf = <T,>(read: (w: string) => T | null): T | null => newest.reduce<T | null>((found, w) => found ?? read(w), null);
    // v2 (BD6, BD18): what the coach proposes loads from, and what is already known (never asked again).
    const training = (await deps.training?.().catch(() => null)) ?? null;
    // BD11 / WB-P7 (review S2): chips, else his words, else the draft being changed, else Profile's session length (the KNOWN block's), else the default.
    const minutes = chips?.minutes ?? firstOf(parseRequestedMinutes) ?? parent?.fitMinutes ?? resolveBuildMinutes(null, training?.profile?.sessionMinutes ?? null);
    const focus: BuildFocus = chips !== null && chips.focus !== 'coach_picks' ? chips.focus : (firstOf(parseRequestedFocus) ?? parent?.request.focus ?? 'coach_picks');
    // F19: the Build card's split day (else the draft's own), with its main lift (Ben's or recommended), for naming and context.
    const day = chips !== null && chips.focus !== 'coach_picks' ? (chips.day ?? null) : chips === null && firstOf(parseRequestedFocus) === null ? (parent?.request.day ?? null) : null;
    const pool = await exercisePool();
    const byId = new Map(pool.map((e) => [e.id, e]));
    const byKey = new Map(pool.flatMap((e) => (e.catalogueKey ? [[e.catalogueKey, e] as const] : [])));
    const flags = await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
    const at = deps.now();
    const nowMs = toMs(at.utc);
    const flagged = (id: string) => painFlagCovering(flags, id, nowMs, at.tz) !== null;
    const live = liveRoutines(await repos().routines.listByOwner(p.id).catch(() => [] as Routine[]));
    const keyOf = (id: string): string => byId.get(id)?.catalogueKey ?? id;
    const doable = pool.filter((e) => e.measurement !== 'distance' && !isArchivedExercise(e) && (e.ownerId === null || e.ownerId === p.id) && !flagged(e.id) && doableHere(e, gym)).sort((a, b) => a.name.localeCompare(b.name));
    // Review r5 S2: a capped list keeps what Ben named and what fits the focus ahead of the alphabetical fill.
    // (19 Oct, Ben: "Why can't I add it") Ranked by this build's words back to its request, not only the
    // newest ("Try now" names nothing): what he named two messages ago stays in the capped list.
    const rankWords = [...newest, ...earlierWords];
    const rankFocus: BuildFocus = focus !== 'coach_picks' ? focus : (rankWords.reduce<BuildFocus | null>((f, w) => f ?? parseRequestedFocus(w), null) ?? focus);
    const first = usableFirst({
      words: rankWords,
      focus: rankFocus,
      pool: doable.map((e) => ({ catalogueId: e.catalogueKey ?? e.id, name: e.name, split: e.split, primaryMuscle: e.primaryMuscles[0] })),
      draft: parent?.plan.slots.map((sl) => sl.catalogueId) ?? [],
      routines: live.flatMap((r) => r.exercises.map((e) => keyOf(e.exerciseId))),
      dayBodyParts: day?.bodyParts ?? [],
    });
    const allUsable = doable
      .map((e) => ({ catalogueId: e.catalogueKey ?? e.id, name: e.name, equipment: e.compatibleEquipment[0]?.replaceAll('_', ' ') ?? 'bodyweight', measured: e.measurement === 'cardio' ? ('cardio' as const) : e.measurement === 'duration' ? ('time' as const) : ('reps' as const) }));
    const usable = capUsable(allUsable, inPlay ? BUILD_USABLE_CAP : OFFERED_USABLE_CAP, first);
    // The cap is for prompt size only: `find_exercises` searches the whole doable list, which the checks accept.
    const proposeHere = proposeDeps(p, pool);
    const doableIds = new Set(doable.map((e) => e.id));
    const findExecutors = createExerciseListExecutors({ pool: () => Promise.resolve(findablePool(doable)), elsewhere: () => Promise.resolve(elsewherePool(p, pool, doableIds, gym, (e) => flagged(e.id))), ...(proposeHere === undefined ? {} : { propose: proposeHere }) });
    const split = splitInUse(training?.profile ?? null);
    const dayObj = day !== null ? (split.days.find((d) => d.name === day.name) ?? null) : (split.days.find((d) => d.id === focus) ?? null);
    const ownMain = dayObj === null ? null : (training?.mainLifts[dayObj.id] ?? null);
    const mainEx = ownMain !== null && ownMain.source === 'yours' ? (byId.get(ownMain.exerciseId) ?? null) : null;
    const words = parseBuildRequest(newest.join('\n'));
    const namedKeys = new Set(exercisesNamedIn(newest.join('\n'), pool.map((e) => ({ exerciseId: e.id, exerciseName: e.name }))));
    const recent = inPlay ? await repos().sessions.listFinishedBetween(p.id, toIso(nowMs - 180 * 86_400_000), toIso(nowMs + 1)).catch(() => [] as HistoryWorkout[]) : [];
    const recentIds = [...new Set(recent.flatMap((a) => a.exercises.map((e) => e.exerciseId)))];
    const recentHistory = new Map<string, HistorySession[]>(recentIds.map((id) => [id, recent.flatMap((a) => toHistorySessions(a, id, { identity: true })).sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc))]));
    const fullHistory = new Map<string, HistorySession[]>();
    // Review S1: the context and the checker read the same references, so an exercise's (and its pattern-mates')
    // whole history is read up front: a personal ratio pairs sessions older than 180 days (§8.5, WB-L5c).
    const historyOf = async (id: string): Promise<HistorySession[]> => {
      const hit = fullHistory.get(id);
      if (hit !== undefined) return hit;
      const h = await deps.store().listExerciseHistory(p.id, id).catch(() => recentHistory.get(id) ?? []);
      fullHistory.set(id, h);
      return h;
    };
    const checkIn = (await repos().checkIns.listSince(p.id, toIso(nowMs - 12 * 3_600_000)).catch(() => [] as CheckIn[])).find((c) => c.deletedAtUtc === undefined) ?? null;
    const sessionPain = unspecifiedPain(checkIn);
    const loadCtxAt = (g: SnapGym) => ({ ownerId: p.id, unit: p.preferredUnit, gym: g, knownEquipment: new Map(g.equipment.map((e) => [e.id, e])), painFlags: flags, sessionPain, at });
    const loadCtx = loadCtxAt(gym);
    // Pattern-mates with their whole history (read up front below), so a ratio can pair old sessions.
    const matesOf = () =>
      recentIds.flatMap((id) => {
        const e = byId.get(id);
        return e === undefined ? [] : [{ exercise: e, history: fullHistory.get(id) ?? recentHistory.get(id) ?? [] }];
      });
    // Per gym (Coach v3: the model may build at another saved gym), keyed by gym and exercise.
    const refsCache = new Map<string, LoadReferences>();
    const refsAt = (g: SnapGym) => (e: Exercise): LoadReferences => {
      const key = `${g.id}:${e.id}`;
      const hit = refsCache.get(key);
      if (hit !== undefined) return hit;
      const r = buildReferences({ target: { exercise: e, history: fullHistory.get(e.id) ?? recentHistory.get(e.id) ?? [] }, mates: matesOf(), ctx: g === gym ? loadCtx : loadCtxAt(g), nowMs });
      refsCache.set(key, r);
      return r;
    };
    const refsFor = refsAt(gym);
    const painFor = (e: Exercise) => painHoldFor(e.id, flags, sessionPain, nowMs, at.tz);
    const LOAD_REFERENCE_CAP = 40;
    const lastDone = new Map<string, number>(recentIds.map((id) => [id, toMs(recentHistory.get(id)?.[0]?.performedAtUtc ?? '1970-01-01T00:00:00.000Z')]));
    const withHistory = doable.filter((e) => e.measurement === 'reps' && lastDone.has(e.id)).sort((a, b) => (lastDone.get(b.id) ?? 0) - (lastDone.get(a.id) ?? 0));
    // Then first-time exercises (the first-time maximum), ranked as the usable list is: what Ben named and what fits the focus first.
    const firstTime = [...new Set([...first, ...usable.map((u) => u.catalogueId)])].flatMap((k) => {
      const e = byKey.get(k) ?? byId.get(k);
      return e !== undefined && e.measurement === 'reps' && e.defaultLoadConvention !== 'bodyweight' && !lastDone.has(e.id) ? [e] : [];
    });
    const listed = inPlay ? [...withHistory, ...firstTime].slice(0, LOAD_REFERENCE_CAP) : [];
    if (inPlay) {
      for (const id of new Set([...recentIds, ...listed.map((e) => e.id)])) await historyOf(id);
      refsCache.clear();
    }
    const loadViews = inPlay
      ? listed
          .map((e) => loadReferenceView(e.catalogueKey ?? e.id, e.name, refsFor(e), painFor(e) !== null))
          .filter((v) => v.last.length > 0 || v.estimate !== null || v.firstTimeMax !== null)
      : [];
    const memories = (await coachStore().listMemories(p.id).catch(() => [] as Memory[])).filter((m) => m.dayNote === undefined).map((m) => ({ text: m.text, savedOn: localDateOf(toMs(m.createdAtUtc), at.tz) }));
    const recentSplits = recent
      .filter((a) => nowMs - toMs(a.session.startedAt.utc) <= 14 * 86_400_000)
      .flatMap((a) => {
        const groups = workoutMuscleGroups(a.exercises.map((ex) => ({ primaryMuscles: byId.get(ex.exerciseId)?.primaryMuscles ?? [], workingSets: a.sets.filter((x) => x.sessionExerciseId === ex.id && x.status === 'completed' && x.setType !== 'warmup').length })));
        const d = matchSplitDay(split, groups);
        return d === null ? [] : [{ date: localDateOf(toMs(a.session.startedAt.utc), a.session.startedAt.tz), day: d.name }];
      })
      .reverse();
    const goalSet = training?.profile?.goalSetAtUtc;
    const known = knownPreferences({
      profile: training?.profile ?? null,
      goalDate: goalSet === undefined ? null : localDateOf(toMs(goalSet), at.tz),
      day: dayObj === null ? null : { name: dayObj.name, mainLift: mainEx === null ? null : { exerciseId: mainEx.id, name: mainEx.name } },
      recentSplits,
      memories,
    });
    const knownView = {
      goal: known.goal === null ? null : `${known.goal.word}${known.goal.since === null ? '' : ` (since ${known.goal.since})`}`,
      sessionMinutes: known.sessionMinutes,
      mainLift: known.mainLift === null ? null : `${known.mainLift.day}: ${known.mainLift.name}`,
      recentSplits: known.recentSplits.map((r) => `${r.day} · ${r.date}`),
      missing: known.missing,
      about: [
        ...(known.about.experience === null ? [] : [`experience: ${known.about.experience}`]),
        ...(known.about.birthYear === null ? [] : [`born ${String(known.about.birthYear)}`]),
        ...(known.about.gender === null ? [] : [`gender: ${known.about.gender}`]),
        ...(known.about.heightCm === null ? [] : [`height ${String(known.about.heightCm)} cm`]),
        ...(known.about.bodyweight === null ? [] : [`bodyweight ${String(known.about.bodyweight.value)} ${known.about.bodyweight.unit} (${known.about.bodyweight.date})`]),
      ],
      questionsLeft: Math.max(0, 2 - (chain?.asked ?? 0)),
    };
    // The same Up next as Today's card (review today-18oct S1); without that wiring, the rotation's routine.
    const upNext =
      deps.upNextTitle !== undefined
        ? await deps.upNextTitle(place.typical ? null : gym.id).catch(() => null)
        : await (async () => {
            const refs = await repos().sessions.listFinishedRefs(p.id, 1).catch(() => []);
            const pick = nextInRotation(rotationRoutines(live), refs[0] ?? null);
            return pick.kind === 'routine' ? pick.routine.name : null;
          })();
    // (19 Oct) A plan turn: Ben's split (or Push/Pull/Legs), days a week and each day's length, the plan being changed.
    const mainOf = (d: { id: string }): Exercise | null => {
      const own = training?.mainLifts[d.id] ?? null;
      return own !== null && own.source === 'yours' ? (byId.get(own.exerciseId) ?? null) : null;
    };
    const planMinutes = resolveBuildMinutes(firstOf(parseRequestedMinutes), training?.profile?.sessionMinutes ?? null);
    // Review planview-19oct B1: the open plan in the thread, else the plan in use Ben's words change.
    const planBase = planRequest === null ? null : (planRequest.plan ?? planRequest.basedOn ?? null);
    const planView: PlanContextView | null =
      planRequest === null
        ? null
        : {
            splitDays: split.days.map((d) => ({ id: d.id, name: d.name, bodyParts: [...d.bodyParts], mainLift: mainOf(d)?.name ?? null })),
            daysPerWeek: training?.profile?.daysPerWeek ?? null,
            minutesEach: planMinutes,
            setBudget: buildSetBudget(planMinutes),
            rotation: rotationRoutines(live).map((r) => r.name),
            current:
              planBase === null
                ? null
                : {
                    name: planBase.name,
                    version: planBase.currentVersion,
                    ...(planRequest.plan === null ? { inUse: true as const } : {}),
                    days: currentPlanVersion(planBase).days.map((d) => ({
                      name: d.name,
                      splitDayId: d.splitDayId,
                      exercises: d.plan.slots.map((sl) => {
                        const w = sl.setTemplates.find((t) => t.setType !== 'warmup' && t.setType !== 'top');
                        const l = w?.load?.load ?? null;
                        return { catalogueId: sl.catalogueId, name: byId.get(sl.exerciseId)?.name ?? 'Exercise', workingSets: draftWorkingSets(sl), reps: w?.reps === null || w === undefined ? `${String(w?.durationS ?? 0)} s` : `${String(w.reps.min)}–${String(w.reps.max)}`, load: l === null ? null : `${String(l.value)} ${l.unit} ${l.convention}` };
                      }),
                    })),
                  },
          };
    const view: BuildContextView = {
      ...(planView === null ? {} : { plan: planView }),
      request: { quote: text, minutes, focus, origin, ...(day === null ? {} : { day: { name: day.name, bodyParts: [...day.bodyParts], mainLift: chips?.mainLift ?? null } }) },
      gym: { name: gym.name, typicalEquipment: place.typical, ...setupOf(savedGyms.find((x) => x.id === gym.id) ?? null, gym.equipment) },
      usable,
      busyToday: [],
      setBudget: buildSetBudget(minutes),
      upNext,
      ...(loadViews.length === 0 ? {} : { loadReferences: loadViews }),
      ...(savedGyms.length === 0 ? {} : { gyms: savedGyms.map((x) => x.name) }),
      known: knownView,
      draft:
        parent === null || draft === null
          ? null
          : {
              name: draft.name,
              version: parent.n,
              exercises: parent.plan.slots.map((sl) => {
                const w = sl.setTemplates.find((t) => t.setType !== 'warmup' && t.setType !== 'top');
                const l = w?.load?.load ?? null;
                return { catalogueId: sl.catalogueId, name: byId.get(sl.exerciseId)?.name ?? 'Exercise', workingSets: draftWorkingSets(sl), reps: w?.reps === null || w === undefined ? `${String(w?.durationS ?? 0)} s` : `${String(w.reps.min)}–${String(w.reps.max)}`, targetRpe: w?.targetRpe ?? null, load: l === null ? null : `${String(l.value)} ${l.unit} ${l.convention}` };
              }),
            },
    };
    const subCtxAt = (g: SnapGym): SubstituteContext => ({ ownerId: p.id, unit: p.preferredUnit, gym: g, knownEquipment: new Map(g.equipment.map((e) => [e.id, e])), painFlags: flags, sessionPain: { active: false, reportedAtUtc: null }, at });
    const checkContextAt = (g: SnapGym): BuildGym['checkContext'] => {
      const subCtx = () => subCtxAt(g);
      const refsHere = refsAt(g);
      return async (previous, opId, catalogueIds) => {
        // The rule's reps on each named exercise's own history (BD8), read before the checks run.
        const reps = new Map<string, RepRange | null>();
        for (const key of new Set(catalogueIds)) {
          const e = byKey.get(key) ?? byId.get(key);
          if (e === undefined) continue;
          const history = await deps.store().listExerciseHistory(p.id, e.id).catch(() => []);
          // The whole history (an exercise last done over 180 days ago gets a personal ratio, §8.5).
          fullHistory.set(e.id, history);
          refsCache.delete(`${g.id}:${e.id}`);
          const plan = substituteTargets({ workingSets: 3, templates: [] }, e, history, subCtx()).plan;
          reps.set(e.id, plan?.find((x) => x.setType !== 'warmup')?.planned.reps ?? null);
        }
        return {
          exerciseFor: (key) => byKey.get(key) ?? byId.get(key) ?? null,
          // Review exlist S5: a deleted exercise of Ben's is never usable, even named by ID.
          usable: (e) => !isArchivedExercise(e) && doableHere(e, g),
          substituteFor: (e) =>
            rankSubstitutions({
              ...subCtx(),
              slotExercise: e,
              slot: { workingSets: 3, templates: [] },
              exercises: pool.filter((x) => !isArchivedExercise(x)),
              catalogueSubstitutions: e.catalogueKey ? (deps.catalogueSubstitutions?.(e.catalogueKey) ?? []) : [],
              excludeExerciseIds: new Set(),
              histories: new Map(),
              nowMs,
            }).find((r) => r.mayHurt === null)?.plan.exercise ?? null,
          painFlags: flags,
          nowMs,
          tz: at.tz,
          restPresetsS: p.restPresets.map((r) => r.seconds),
          ruleReps: (e) => reps.get(e.id) ?? null,
          previous,
          newSlotKey: (exerciseId, i) => deriveId(`coach-draft-slot:${opId}:${exerciseId}:${String(i)}`),
          loads: { refsFor: refsHere, painFor, askedHeavier: words.askedHeavier },
          mainLift: mainEx === null ? null : { exercise: mainEx, skip: words.skipMainInsert || (draft !== null && parent !== null && !parent.plan.slots.some((sl) => sl.exerciseId === mainEx.id)) },
          namedByBen: (e) => namedKeys.has(e.id),
        };
      };
    };
    const equipmentVersionOf = (g: SnapGym): string => deriveId(stableStringify(g.equipment.map((e) => [e.id, e.version])));
    // Coach v3: a length Ben stated outright (a chip, or a time word in his newest message) beats the model's.
    const minutesFromBen = chips?.minutes ?? parseRequestedMinutes(said);
    const gymFor = async (name: string): Promise<BuildGym | null> => {
      const matched = savedGymFor(name, savedGyms.map((x) => x.name));
      const other = savedGyms.find((x) => x.name === matched);
      if (other === undefined) return null;
      const g: SnapGym = other.id === gym.id ? gym : { id: other.id, name: other.name, equipment: await repos().equipment.listByGym(other.id).catch(() => []) };
      return { gymId: g.id, gymName: g.name, checkContext: checkContextAt(g), equipmentVersion: equipmentVersionOf(g) };
    };
    const planExecutors =
      planRequest === null
        ? {}
        : createPlanExecutor({
            store: coachStore(),
            request: { text, minutes: planMinutes, minutesFromBen: parseRequestedMinutes(said), gymId: place.typical ? null : gym.id, gymName: place.typical ? null : gym.name, origin },
            plan: planRequest.plan,
            basedOn: planRequest.plan === null ? (planRequest.basedOn ?? null) : null,
            splitDays: split.days,
            checkContext: checkContextAt(gym),
            mainLiftFor: (d) => {
              const m = d === null ? null : mainOf(d);
              return m === null ? null : { exercise: m, skip: false };
            },
            exerciseOf: (id) => byId.get(id) ?? null,
            groupOf: muscleGroupOf,
            contextHash: deriveId(stableStringify(view)),
            equipmentVersion: equipmentVersionOf(gym),
            gyms: savedGyms.map((x) => x.name),
            gymFor,
          });
    const executors = createBuildExecutor({
      store: coachStore(),
      request: { text, minutes, focus, day, gymId: place.typical ? null : gym.id, gymName: place.typical ? null : gym.name, origin, minutesFromBen, benNumbers: chips === null ? [lengthRevision(said)].filter((n): n is number => n !== null) : [], focusFromChips: chips !== null && chips.focus !== 'coach_picks' },
      draft,
      checkContext: checkContextAt(gym),
      gyms: savedGyms.map((x) => x.name),
      gymFor,
      nameOf: (exerciseId) => byId.get(exerciseId)?.name ?? 'Exercise',
      contextHash: deriveId(stableStringify(view)),
      equipmentVersion: equipmentVersionOf(gym),
      questions: {
        known,
        day: dayObj === null ? null : { id: dayObj.id, name: dayObj.name },
        context: {
          requestMinutes: chips?.minutes ?? firstOf(parseRequestedMinutes),
          dayName: dayObj?.name ?? null,
          mainNamed: words.skipMainInsert,
          mainLiftOk: (key) => {
            const e = byKey.get(key) ?? byId.get(key);
            if (e === undefined || e.mechanic !== 'compound' || !doable.includes(e)) return false;
            const g = e.primaryMuscles[0] === undefined ? null : muscleGroupOf(e.primaryMuscles[0]);
            return dayObj === null || (g !== null && (dayObj.bodyParts as readonly string[]).includes(g));
          },
          nameOf: (key) => (byKey.get(key) ?? byId.get(key))?.name ?? null,
        },
      },
    });
    return { view, executors: { ...findExecutors, ...executors, ...planExecutors }, inPlay };
  }

  /** Review S1: a `propose_week` for this week's facts as they are now is already in Ben's coach history. */
  async function weekOfferedFor(p: UserProfile, week: NonNullable<CoachServiceDeps['week']>): Promise<boolean> {
    const now = await week.tool();
    if (now === null) return false;
    const recent = await repos().coach.listRecentActions(p.id, { limit: WEEK_OFFER_LOOKBACK });
    return recent.some((r) => r.detail.kind === 'propose_week' && r.detail.weekMonday === now.facts.monday && r.detail.factsKey === now.factsKey);
  }

  /** (Ben, 20 Oct) `log_activity`'s store, zone and same-day check. */
  function activityDeps(p: UserProfile): ActivityToolDeps {
    return { store: coachStore(), tz: p.timezone, onDate: (date) => repos().activities.listBetween(p.id, date, addDays(date, 1)) };
  }

  async function send(req: SendRequest): Promise<CoachTurnResult> {
    const p = await owner();
    const a = await availability();
    if (a.status !== 'ok' && a.status !== 'offline') throw new Error(`The coach isn't available (${a.status}).`);
    const model = deps.model?.();
    if (model === undefined || a.model === null) throw new Error("The coach isn't connected.");
    const session = await sessionOf(req.entry);
    const kind = kindFor(req.entry, session, req.summary === true);
    const ctx = await contextInput(p, kind, session, req.entry);
    const offerScope = req.input.kind === 'chip' ? (req.input.sessionExerciseId ?? null) : null;
    const executors = await executorsFor(p, req.entry, kind, session, ctx.gymName, ctx.checkIn, await askedForMoreSets(req.threadId), offerScope);
    // workout-builder §8.2: a build turn (Ben asked for a workout, or to change the draft in context) gets its context and its one tool.
    const draftInContext = req.entry.kind === 'draft' ? await draftOf(p, req.entry.draftId) : null;
    // Build 131: a follow-up to a session the coach described in text ("yes add it"); the turn engine reads the same thread.
    // Review exlist S2: a workout's thread too, so its add list is ranked by Ben's recent words ("Try now" names nothing).
    const thread = req.input.kind === 'words' && req.threadId !== null && (kind === 'general' || kind === 'workout') ? await coachStore().listMessages(req.threadId).catch(() => [] as CoachMessage[]) : [];
    // Review exlist B1: `Added <name>.` after Add on the coach's new-exercise card continues the request that led to the
    // card: read as it was then (that message, the thread before it), so a build keeps its length, focus, gym and loads.
    // The turn engine reads the same continuation (`addedContinuationOf`).
    const continued = req.input.kind === 'words' && thread.length > 0 ? await addedContinuationOf(thread, req.input.text, (id) => coachStore().listTurnActions(id)) : null;
    const said = req.input.kind === 'words' ? (kind === 'general' ? (continued?.request ?? req.input.text) : req.input.text) : '';
    const history = kind === 'general' ? (continued?.history ?? thread) : [];
    const refused = history.length === 0 ? new Set<string>() : await refusedBuildActionIds(history, (id) => coachStore().listTurnActions(id));
    // v2 (BD17): Ben answering the coach's question is a build follow-up with his request's words.
    const chain = kind === 'general' && req.input.kind === 'words' && history.length > 0 ? await buildQuestionChain(history, said, (id) => coachStore().listTurnActions(id)) : null;
    const followUp = kind === 'general' && req.input.kind === 'words' ? (chain?.followUp ?? buildFollowUpIn(history, said, refused)) : null;
    // Coach v3: Ben's earlier words in this thread that belong to this build, newest first (the gym he named two messages ago; review S6: never an older request's).
    const benWordsOf = (list: readonly CoachMessage[]) => list.flatMap((m) => (m.body.role === 'ben' && m.body.input.kind === 'words' ? [{ text: m.body.input.text, atMs: toMs(m.createdAt.utc) }] : [])).reverse();
    const earlierBen = benWordsOf(history);
    const earlierWords = req.input.kind === 'words' ? buildChainWords(said, earlierBen, toMs(deps.now().utc)) : [];
    // (19 Oct) A plan of several days: Ben asked for one, or his words change the open plan in this thread.
    const planInThread = kind === 'general' && req.input.kind === 'words' ? await threadOpenPlan(p, req.threadId) : null;
    const planFollowUp = followUp !== null && followUp.priorBenText !== null && asksForPlan(followUp.priorBenText);
    // Review planview-19oct B1: no open plan here and Ben's words change "my plan" (Library's `Ask coach to change`): the plan in use is the basis.
    const planInUse = kind === 'general' && req.input.kind === 'words' && planInThread === null && changesPlanInUse(said) ? await appliedPlanOf(p) : null;
    const planWanted = kind === 'general' && req.input.kind === 'words' && (planFollowUp || asksForPlan(said) || (planInThread !== null && (revisesPlan(said) || changesPlanInUse(said))) || planInUse !== null);
    const build = kind === 'general' && req.input.kind === 'words' ? await buildTurn(p, said, req.buildOrigin ?? (req.input.spoken ? 'voice' : 'text'), draftInContext, req.buildChips ?? null, followUp, chain, earlierWords, planWanted ? { plan: planInThread, basedOn: planInUse } : null) : null;
    if (build !== null) Object.assign(executors, build.executors);
    // (Ben, 20 Oct) "Pause my plan", "I'm on holiday till 3 Nov", "resume my plan": the plan in use and today's date, and the tool.
    const pauseTurn = kind === 'general' && req.input.kind === 'words' && asksToPausePlan(said);
    let planPause: PlanPauseView | undefined;
    // (Ben, 20 Oct) This week on every general turn: today, gym days left, the days left, his activities; `log_activity`
    // (logged when his words tell it, else an offer) and `propose_week` (a proposal; offered when he asks, or `weekOpen`).
    const weekRead = kind === 'general' && deps.week !== undefined ? await deps.week.view().catch(() => null) : null;
    // Review S1 (rule 3): code opens `propose_week` on its own only once for the week as it is now. An offer already made
    // for these facts (open, declined or ignored) keeps it shut until the week changes (a workout, an activity, the plan);
    // Ben's own ask still opens it.
    const benAsksWeek = req.input.kind === 'words' && (asksToPlanWeek(said) || isStructuralRequest(classifyBenRequest(said, 'general')));
    const offeredAlready = !benAsksWeek && weekRead?.needsReshape === true && deps.week !== undefined ? await weekOfferedFor(p, deps.week).catch(() => false) : false;
    const weekView = weekRead === null ? null : offeredAlready ? { ...weekRead, needsReshape: false, suggestion: null } : weekRead;
    if (kind === 'general' && deps.week !== undefined) {
      const w = deps.week;
      Object.assign(executors, createActivityExecutor(activityDeps(p)), createWeekExecutor({ store: coachStore(), week: () => w.tool() }));
    }
    if (pauseTurn) {
      const inUse = await repos().planDrafts.applied(p.id).catch(() => null);
      const nowMs = toMs(deps.now().utc);
      const running = activePause(inUse, nowMs, p.timezone);
      planPause = { today: localDateOf(nowMs, p.timezone), inUse: inUse === null ? null : { name: inUse.name, paused: running === null ? null : { until: running.untilDate } } };
      Object.assign(executors, createPausePlanExecutor({ store: coachStore(), loadPlan: () => repos().planDrafts.applied(p.id), tz: p.timezone }));
    }
    // (12 Oct) What can be added here, by ID. Coach v3 (ADR 0027): on every live-workout turn, no word
    // gate (the model reads what Ben meant), capped at ADDABLE_CAP with what he named first. Review exlist
    // S2: what he named in his recent messages in this workout's thread counts too (same limits as a build's).
    const allAddable = kind === 'workout' && session !== null && session.session.status === 'active' && deps.coachAddInputs !== undefined ? await addableFor(p, session) : null;
    const recentBen = recentBenWords(benWordsOf(thread), toMs(deps.now().utc));
    const addable = allAddable === null ? null : capAddable(allAddable, [req.input.kind === 'words' ? req.input.text : '', ...recentBen].join('\n'));
    // 21 Oct (Ben's Build B report): a live turn carries the last sessions of the exercises in play (the one he's on,
    // the ones he named here or in his recent messages), so "it's too light given Friday" has Friday's sets without a read.
    const recentLifts = kind === 'workout' && session !== null && session.session.status === 'active' ? await recentLiftsFor(p, session, [req.input.kind === 'words' ? req.input.text : '', ...recentBen].join('\n')).catch(() => []) : [];
    // (19 Oct) The capped addable list in the prompt; `find_exercises` searches all of it (`edit_today` add checks against all of it).
    if (allAddable !== null && session !== null) {
      const ids = new Set(allAddable.map((a) => a.exerciseId));
      const everything = await exercisePool();
      const pool = everything.filter((e) => ids.has(e.catalogueKey ?? e.id));
      const proposeHere = proposeDeps(p, everything);
      const usableIds = new Set(pool.map((e) => e.id));
      const flags = await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
      const flaggedMove = movementMatcher(everything, flags.filter((f) => f.status === 'active'));
      const atNow = deps.now();
      const flaggedHere = (e: Exercise): boolean => flaggedMove(e) || painFlagCovering(flags, e.id, toMs(atNow.utc), atNow.tz) !== null;
      const gymHere = { name: (await repos().gyms.get(session.session.gymId ?? '').catch(() => null))?.name ?? 'This gym', equipment: currentGymEquipment(session.session) };
      Object.assign(executors, createExerciseListExecutors({ pool: () => Promise.resolve(findablePool(pool)), elsewhere: () => Promise.resolve(elsewherePool(p, everything, usableIds, gymHere, flaggedHere)), ...(proposeHere === undefined ? {} : { propose: proposeHere }) }));
    }
    // (Ben, 20 Oct) Lift targets on: the coach may set one Ben asks for (the turn checks he asked).
    const liftTargetsOn = (kind === 'general' || kind === 'workout') && deps.liftTargets !== undefined && (await deps.liftTargets.on().catch(() => false));
    if (liftTargetsOn && deps.liftTargets !== undefined) Object.assign(executors, createLiftTargetExecutors({ store: coachStore(), prepare: deps.liftTargets.prepare }));
    const stop = new AbortController();
    running.set(req.turnId, stop);
    try {
      const result = await runCoachTurn(
        {
          ownerId: p.id,
          threadId: req.threadId,
          turnId: req.turnId,
          kind,
          input: req.input,
          model: a.model,
          // Coach v3 (Ben 18 Oct): his lighter mid-workout model, if he chose one; `think_harder` returns to the main one.
          ...(kind === 'workout' && a.workoutModel != null ? { workoutModel: a.workoutModel } : {}),
          surface: 'sheet',
          context: { ...ctx.input, ...(build === null ? {} : { build: build.view }), ...(addable === null ? {} : { addable }), ...(recentLifts.length === 0 ? {} : { recentLifts }), ...(planPause === undefined ? {} : { plan: planPause }), ...(weekView === null ? {} : { week: weekView }) },
          structuralSignals: await structuralSignalsFor(p, session).catch(() => []),
          namedExerciseIds: req.input.kind === 'words' ? namedExercises(req.input.text, session) : [],
          ...(draftInContext !== null ? { draftInContext: true } : {}),
          ...((await threadHasOpenDraft(p, req.threadId)) ? { draftInThread: true } : {}),
          // Review B1, S4: the coach is told the app builds a session only when it really can here.
          ...(kind === 'general' && build !== null ? { buildAvailable: true } : {}),
          ...(planInThread !== null || planInUse !== null ? { planInContext: true } : {}),
          ...(liftTargetsOn ? { liftTargetsOn: true } : {}),
          ...(weekView?.needsReshape === true ? { weekOpen: true } : {}),
          signal: stop.signal,
          ...(req.onProgress === undefined ? {} : { onProgress: req.onProgress }),
        },
        // A build turn has the whole-build cap (BD13) on top of the first-event and stall timeouts.
        {
          model,
          store: coachStore(),
          executors,
          now: deps.now,
          newId: deps.newId,
          ...(build?.inPlay === true ? { timing: { ...DEFAULT_COACH_TIMING, totalMs: COACH_BUILD_TIMEOUT_MS } } : kind === 'workout' ? { timing: { ...DEFAULT_COACH_TIMING, totalMs: COACH_WORKOUT_TIMEOUT_MS } } : {}),
          // Coach v3: Adjust on an offered edit applies exactly that offer (no model call); stale when the workout moved on.
          ...(kind === 'workout' && session !== null ? { acceptOffer: (proposal: ActionRecord, c: { ownerId: string; turnId: string; now: ZonedTimestamp }) => acceptEditOffer(editDepsFor(p, session, ctx.gymName, ctx.checkIn), proposal, c) } : {}),
          // Review lift-targets B1: Apply (or "yes") on the coach's target offer sets exactly that target; stale when his targets changed.
          ...(liftTargetsOn ? { acceptLiftTarget: (proposal: ActionRecord, c: { ownerId: string; turnId: string; now: ZonedTimestamp }) => acceptLiftTargetOffer(coachStore(), proposal, c) } : {}),
        },
      );
      if (result.error === 'network') lastNetworkFailureMs = toMs(deps.now().utc);
      else if (result.status === 'completed') lastNetworkFailureMs = null;
      if (session !== null && result.cards.some((c) => (c.record.detail.kind === 'adjust_pending_sets' || c.record.detail.kind === 'add_exercise_today' || c.record.detail.kind === 'edit_today' || c.record.detail.kind === 'rename_workout') && c.record.status === 'committed')) {
        const fresh = await repos().sessions.get(session.session.id).catch(() => null);
        if (fresh !== null) deps.onSessionChanged?.(fresh);
      }
      return result;
    } finally {
      running.delete(req.turnId);
    }
  }

  return {
    availability,
    resolveThread,
    loadThread,
    listThreads: async (): Promise<CoachThread[]> => coachStore().listThreads((await owner()).id),
    send,

    /**
     * Whether a build can start now (workout-builder §5.4): null when it can;
     * else the reason word for `Needs the coach`. No provider call.
     */
    async buildBlock(): Promise<BuildBlock | null> {
      return buildBlockOf((await availability()).status);
    },

    /**
     * The Build card's `Build` (§4.1): one Ben message made from the chips
     * (`Build a 45 min push workout`) plus anything typed, and one build
     * turn. Nothing is sent when the coach can't build (`Needs the coach`).
     */
    async buildWorkout(req: { entry: CoachEntry; threadId: string | null; turnId: string; minutes: number | null; focus: BuildFocus; day?: BuildDay | null; mainLift?: string | null; extra?: string; origin: 'chip' | 'card'; onProgress?: (p: CoachTurnProgress) => void }): Promise<{ ok: true; result: CoachTurnResult } | { ok: false; block: BuildBlock }> {
      const block = buildBlockOf((await availability()).status);
      if (block !== null) return { ok: false, block };
      const words = buildRequestText({ minutes: req.minutes, focus: req.focus, dayName: req.day?.name ?? null });
      const extra = req.extra?.trim() ?? '';
      const text = extra === '' ? words : `${words}. ${extra}`;
      const result = await send({
        entry: req.entry,
        threadId: req.threadId,
        turnId: req.turnId,
        input: { kind: 'words', text, spoken: false },
        buildOrigin: req.origin,
        buildChips: { minutes: req.minutes, focus: req.focus, day: req.day ?? null, mainLift: req.mainLift ?? null },
        ...(req.onProgress === undefined ? {} : { onProgress: req.onProgress }),
      });
      return { ok: true, result };
    },

    /**
     * The coach's fit of today's plan (fit-to-time §5): one model request with
     * exactly the context it is given, and nothing written here (the overview
     * validates and writes what passes). Null when the coach can't be reached
     * (not connected, paused, or offline after a failed request): no provider
     * call (FT-C9). A network failure marks the coach offline for a while.
     */
    async fitToday(context: TodayFitContext, signal?: AbortSignal): Promise<TodayFitAnswer | null> {
      const a = await availability();
      const model = deps.model?.();
      if (a.status !== 'ok' || a.model === null || model === undefined) return null;
      const r = await requestTodayFit(model, buildTodayFitRequest(context, a.model), signal === undefined ? {} : { signal });
      if (!r.ok && r.error === 'network') lastNetworkFailureMs = toMs(deps.now().utc);
      else if (r.ok) lastNetworkFailureMs = null;
      return r;
    },

    /**
     * (19 Oct) The coach's new-exercise card: its fields, and whether Ben added it (the exercise row
     * exists; `deleted` once he deleted it since). Null: no such proposal.
     */
    async exerciseProposal(actionId: string): Promise<ExerciseProposalCard | null> {
      const p = await owner();
      const a = await coachStore().getAction(actionId).catch(() => null);
      if (a === null || a.detail.kind !== 'propose_exercise' || a.status !== 'proposed') return null;
      const e = await repos().exercises.get(a.detail.exerciseId).catch(() => null);
      const mine = e !== null && e.ownerId === p.id ? e : null;
      return {
        actionId,
        exerciseId: a.detail.exerciseId,
        fields: mine === null ? a.detail.fields : customFieldsOf(mine),
        line: customExerciseLine(mine === null ? a.detail.fields : customFieldsOf(mine)),
        state: mine === null ? 'open' : isArchivedExercise(mine) ? 'deleted' : 'added',
      };
    },

    /**
     * Add on the coach's new-exercise card (rule 3: only now is it saved), or Save from its Edit with
     * Ben's `fields`. One exercise per card: a double tap saves once. A name already in his list is
     * refused with that exercise. The sheet then sends `Added <name>.` as Ben's message, so the coach
     * carries on with what he asked.
     */
    async addProposedExercise(req: { actionId: string; opId: string; fields?: CustomExerciseFields }): Promise<CustomWrite> {
      const a = await coachStore().getAction(req.actionId).catch(() => null);
      if (a === null || a.detail.kind !== 'propose_exercise' || a.status !== 'proposed' || deps.createCustomExercise === undefined) return { ok: false, reason: 'missing', message: 'Not found.' };
      return deps.createCustomExercise({ fields: req.fields ?? a.detail.fields, opId: req.opId, proposalActionId: req.actionId });
    },

    /** Stop (coach-sheet §3): cancels the request; anything already committed stays with its card. */
    stop(turnId: string): void {
      running.get(turnId)?.abort();
    },

    isRunning: (turnId: string): boolean => running.has(turnId),

    /** (Ben, 20 Oct) An activity the coach offered: open, or the record of Ben's `Log` (with Undo). */
    async activityOffer(actionId: string): Promise<ActivityOfferState> {
      const p = await owner();
      const logged = await coachStore().findActionByOpId(p.id, acceptActivityOpId(actionId));
      return logged !== null && logged.status === 'committed' ? { kind: 'logged', record: logged } : { kind: 'open' };
    },

    /** (Ben, 20 Oct) Ben's `Log` on the coach's activity offer: exactly what it offered, once (rule 3, 5). No model call. */
    async logOfferedActivity(actionId: string): Promise<ActivityOfferState> {
      const p = await owner();
      const proposal = await coachStore().getAction(actionId);
      if (proposal === null) return { kind: 'refused', line: 'There is no offer to log.' };
      const r = await acceptActivityOffer(activityDeps(p), proposal, { ownerId: p.id, turnId: proposal.turnId ?? 'tap', now: deps.now() });
      if (r.kind !== 'action') return { kind: 'refused', line: r.kind === 'refused' ? r.line : 'Not logged.' };
      return r.record.status === 'committed' ? { kind: 'logged', record: r.record } : { kind: 'refused', line: renderActionResult(r.record, 'sheet').text };
    },

    /** Undo from a card or the workout's banner. A double tap (same opId) undoes once. */
    async undo(actionId: string, opId: string) {
      const p = await owner();
      // (D8) An applied next-workout change already on an open Your workout: it goes back there too, only while it is
      // still that draft's last change (rule 5); otherwise nothing is undone and the card keeps its Undo.
      const target0 = await coachStore().getAction(actionId).catch(() => null);
      const landed = target0?.detail.kind === 'propose_next_workout_change' && target0.detail.proposalId !== undefined && target0.detail.landsOn === 'your_workout' && target0.status === 'committed' && target0.undoneBy === null && deps.nextWorkout !== undefined;
      if (landed && !(await deps.nextWorkout?.revert(actionId, true).catch(() => false))) {
        const failed = newActionRecord({ turnId: '', opId, now: deps.now() }, { kind: 'undo', undoneActionId: actionId, what: 'that change', restored: [], alreadyLogged: [] }, { author: 'ben', status: 'rejected', failure: 'it changed since' });
        return { undo: { ...failed, turnId: null }, result: { status: 'not_possible' as const, reason: 'changed_since' as const } };
      }
      const r = await undoCoachAction(coachStore(), { ownerId: p.id, actionId, opId, now: deps.now() });
      if (landed && (r.result.status === 'written' || r.result.status === 'replayed')) await deps.nextWorkout?.revert(actionId, false).catch(() => false);
      const target = r.result.status === 'written' || r.result.status === 'replayed' ? r.result.target : null;
      if (target?.detail.kind === 'adjust_pending_sets' || target?.detail.kind === 'add_exercise_today' || target?.detail.kind === 'edit_today' || target?.detail.kind === 'rename_workout' || target?.detail.kind === 'log_set' || target?.detail.kind === 'correct_set') {
        const fresh = await repos().sessions.get(target.detail.sessionId).catch(() => null);
        if (fresh !== null) deps.onSessionChanged?.(fresh);
      }
      return r;
    },

    getAction: (actionId: string): Promise<ActionRecord | null> => coachStore().getAction(actionId),

    proposalStates,

    // ---------- Playbook chat rules (coaching-playbook §2.1, §4.1; Coaching knowledge, local, no AI) ----------

    /** Rules from chat: to review, approved and rejected, numbered `Chat rule N`. */
    async playbookRules(): Promise<PlaybookRuleList> {
      return playbookRuleList(await coachStore().listPlaybookCandidates());
    },

    /** Approve, Reject, or back to review (the toast's Undo, Remove, Review again). Versioned; a double tap is one write. */
    decidePlaybookRule(candidateId: string, expectedVersion: number, decision: 'approve' | 'reject' | 'reopen'): Promise<CandidateWrite> {
      return coachStore().decidePlaybookCandidate({ candidateId, expectedVersion, decision, atUtc: deps.now().utc });
    },

    // ---------- Memory (coach-memory §2.1–2.4; Your data, local, no AI) ----------

    /** Waiting suggestions and saved memories. */
    async memories(): Promise<MemoryList> {
      const p = await owner();
      // Day notes (`For next <day> day`) live with their day (`From last review`, ✕), not in Memories (review b3-coach S5).
      return memoryList((await coachStore().listMemories(p.id, 'all')).filter((m) => m.dayNote === undefined), deps.now().utc);
    },

    /** Save or Not now on a suggestion (versioned; a double tap is one write). */
    async decideMemory(memoryId: string, expectedVersion: number, decision: 'save' | 'not_now'): Promise<MemoryWrite> {
      const p = await owner();
      const m = await coachStore().getMemory(memoryId);
      // 14 days without an answer: it can't be saved any more (CM3).
      if (decision === 'save' && m !== null && m.status === 'suggested' && !memoryCanBeSaved(m, await coachStore().listMemories(p.id, 'all'), deps.now().utc)) return { status: 'stale', memory: m };
      // A force-close between `Add to playbook`'s two writes (review coach-tools r3 N3): its candidate is
      // already there, so finish that choice rather than keep the same words in both homes.
      if (m !== null && m.ownerId === p.id && m.status === 'suggested' && m.version === expectedVersion && (await sentToPlaybook(m))) {
        const closed = await coachStore().decideMemory(p.id, { memoryId, expectedVersion, decision: 'not_now', atUtc: deps.now().utc, closedAs: 'playbook' });
        return closed.status === 'written' ? { status: 'stale', memory: closed.memory } : closed;
      }
      return coachStore().decideMemory(p.id, { memoryId, expectedVersion, decision, atUtc: deps.now().utc });
    },

    /**
     * `Add to playbook` on a memory card whose words could be a rule (CM9's
     * split; review coach-tools r2 S2): a `To review` candidate (Coaching
     * knowledge, unused until approved) and the suggestion closed as not
     * saved, so nothing about it stays waiting in Your data. Two writes, each
     * idempotent: the candidate by its words, the close by version, so a
     * retry after a force-close between them finishes the job.
     */
    async memoryToPlaybook(
      memoryId: string,
      expectedVersion: number,
      opId: string,
    ): Promise<{ ok: true; record: ActionRecord | null; rejectedBefore: boolean } | { ok: false; reason: 'missing' | 'stale' }> {
      const p = await owner();
      const m = await coachStore().getMemory(memoryId);
      if (m === null || m.ownerId !== p.id) return { ok: false, reason: 'missing' };
      const key = playbookContentKey(m.text);
      const done = async () => ({ ok: true as const, record: null, rejectedBefore: playbookStateOf(await coachStore().listPlaybookCandidates(), key) === 'rejected' });
      // A double tap, or a second tap that raced the first (review coach-tools r3 N4): already sent to the playbook.
      if (m.status === 'not_saved' && m.closedAs === 'playbook' && m.version > expectedVersion) return done();
      if (m.status !== 'suggested' || m.version !== expectedVersion) return { ok: false, reason: 'stale' };
      if (!memoryCanBeSaved(m, await coachStore().listMemories(p.id, 'all'), deps.now().utc)) return { ok: false, reason: 'stale' };
      const now = deps.now();
      const candidateId = deriveId(`ben-playbook:${opId}`);
      const detail: ActionDetail = { kind: 'add_playbook_candidate', candidateId, text: m.text, fromMemoryId: memoryId };
      const record = { ...newActionRecord({ turnId: '', opId, now }, detail, { author: 'ben' }), turnId: null };
      const statedBy = m.source === 'ben_asked' ? ('ben' as const) : ('coach' as const);
      const r = await coachStore().commit(p.id, {
        kind: 'playbook_candidate',
        action: record,
        candidate: { id: candidateId, version: 1, createdAtUtc: now.utc, updatedAtUtc: now.utc, text: m.text, contentKey: key, statedBy, status: 'to_review', createdByActionId: record.actionId },
      });
      // Already approved or rejected in the same words: it is in the playbook's hands either way.
      if (r.status === 'conflict' && r.reason !== 'already_exists') return { ok: false, reason: 'stale' };
      const closed = await coachStore().decideMemory(p.id, { memoryId, expectedVersion, decision: 'not_now', atUtc: now.utc, closedAs: 'playbook' });
      if (closed.status === 'stale' && closed.memory.status === 'not_saved' && closed.memory.closedAs === 'playbook') return done();
      if (closed.status !== 'written') return { ok: false, reason: closed.status === 'missing' ? 'missing' : 'stale' };
      // Rejected before in the same words (review coach-tools r3 N2): closed, and not offered again (coaching-playbook §3.1).
      return { ok: true, record: r.status === 'conflict' ? null : r.action, rejectedBefore: r.status === 'conflict' && playbookStateOf(await coachStore().listPlaybookCandidates(), key) === 'rejected' };
    },

    /** Edit a saved memory's words; the earlier words are kept with the memory. */
    async editMemory(memoryId: string, expectedVersion: number, text: string): Promise<MemoryWrite | { status: 'invalid' }> {
      const p = await owner();
      const clean = cleanMemoryText(text);
      if (clean === null) return { status: 'invalid' };
      return coachStore().editMemory(p.id, { memoryId, expectedVersion, text: clean, contentKey: memoryContentKey(clean), atUtc: deps.now().utc });
    },

    /** Ben's own new memory (`Add`): saved at once, with Undo (its record is his). The same words twice are one memory. */
    async addMemory(text: string, opId: string): Promise<{ ok: true; record: ActionRecord; duplicate: boolean } | { ok: false }> {
      const p = await owner();
      const clean = cleanMemoryText(text);
      if (clean === null) return { ok: false };
      const now = deps.now();
      const memoryId = deriveId(`ben-memory:${opId}`);
      const detail: ActionDetail = { kind: 'save_memory', memoryId, text: clean };
      const record = { ...newActionRecord({ turnId: '', opId, now }, detail, { author: 'ben', entityVersions: [{ entity: 'memory', id: memoryId, before: null, after: 1 }] }), turnId: null };
      const memory: Memory = { id: memoryId, ownerId: p.id, version: 1, createdAtUtc: now.utc, updatedAtUtc: now.utc, text: clean, contentKey: memoryContentKey(clean), status: 'active', quote: clean, createdByActionId: record.actionId, source: 'ben_added' };
      const r = await coachStore().commit(p.id, { kind: 'save_memory', action: record, memory });
      if (r.status === 'conflict') return { ok: false };
      return { ok: true, record: r.action, duplicate: r.status === 'replayed' };
    },

    /** Forget a saved memory (a tombstone). Undo through `undo` on the returned record. */
    async forgetMemory(memoryId: string, expectedVersion: number, opId: string): Promise<{ ok: true; record: ActionRecord } | { ok: false; stale: boolean }> {
      const p = await owner();
      const m = await coachStore().getMemory(memoryId);
      if (m === null || m.ownerId !== p.id) return { ok: false, stale: false };
      const now = deps.now();
      const detail: ActionDetail = { kind: 'forget_memory', memoryId, text: m.text };
      const record = { ...newActionRecord({ turnId: '', opId, now }, detail, { author: 'ben', entityVersions: [{ entity: 'memory', id: memoryId, before: expectedVersion, after: expectedVersion + 1 }] }), turnId: null };
      const r = await coachStore().commit(p.id, { kind: 'forget_memory', action: record, memoryId, expectedVersion, atUtc: now.utc });
      if (r.status === 'conflict') return { ok: false, stale: r.reason === 'stale_version' };
      return { ok: true, record: r.action };
    },

    /**
     * Apply or Not now on a structural proposal card (ADR 0020 §3). Checked
     * and saved in one write: refused once a workout has started from its
     * basis or the routine changed (`Out of date`), or after an earlier tap.
     * A double tap replays. Applying changes nothing else yet: the next
     * workout's overview writes it into that day's draft (`structuralDraftPlan`).
     */
    async tapProposal(proposalId: string, tap: 'apply' | 'not_now'): Promise<{ ok: true; record: ActionRecord } | { ok: false; state: StructuralProposalState | null }> {
      const p = await owner();
      const proposal = await coachStore().getAction(proposalId);
      if (proposal === null || proposal.detail.kind !== 'propose_next_workout_change' || proposal.status !== 'proposed' || proposal.detail.basis === undefined) return { ok: false, state: null };
      // Review B3: an older card (from before D8) would land nowhere: refused, `Out of date`.
      if (tap === 'apply' && proposal.detail.landsOn !== 'your_workout') return { ok: false, state: 'out_of_date' };
      const r = await coachStore().commitStructuralTap(p.id, structuralTapRecord(proposal, tap, { now: deps.now() }));
      if (r.status !== 'conflict') return { ok: true, record: r.action };
      return { ok: false, state: (await proposalStates([proposalId])).get(proposalId)?.state ?? null };
    },

    /**
     * (20 Oct, ADR 0029) Apply or Not now on the coach's gym suggestion. Apply saves exactly the
     * edit the card shows, as Ben's own record, in one transaction with the gym (rule 5: refused,
     * `Out of date`, when the gym changed since). One tap per card: a double tap replays.
     */
    async tapGymProposal(proposalId: string, tap: 'apply' | 'not_now'): Promise<{ ok: true; record: ActionRecord } | { ok: false; state: GymProposalState['state'] | null }> {
      const p = await owner();
      const proposal = await coachStore().getAction(proposalId);
      if (proposal === null || proposal.detail.kind !== 'update_gym' || proposal.status !== 'proposed') return { ok: false, state: null };
      const taps = await coachStore().listGymUpdates(p.id);
      const before = await gymProposalState(proposal, taps);
      if (before.state !== 'open') return { ok: false, state: before.state };
      const detail = { ...proposal.detail, proposalId };
      const opId = `gym-${tap}:${proposalId}`;
      const base = newActionRecord({ turnId: '', opId, now: deps.now() }, detail, { author: 'ben', status: tap === 'apply' ? 'committed' : 'rejected', entityVersions: proposal.entityVersions });
      const record: ActionRecord = { ...base, turnId: null };
      const r = tap === 'apply' ? await coachStore().commit(p.id, { kind: 'gym_edit', action: record, edit: proposal.detail.edit }) : await coachStore().commit(p.id, { kind: 'record', action: record });
      if (r.status === 'conflict') return { ok: false, state: 'out_of_date' };
      return { ok: true, record: r.action };
    },

    /**
     * Ben's applied structural proposals for one plan (ADR 0020 §3), for the
     * next workout's Your workout draft to land (D8, the builder's
     * `landCoachChanges`). Only ones made to land there: older ones went to the
     * retired overview's draft. Reads coach records only.
     */
    async appliedStructural(basis: DraftBasis): Promise<AppliedStructural[]> {
      const p = await owner();
      const key = draftBasisKey(basis);
      const out: AppliedStructural[] = [];
      for (const a of await coachStore().listStructural(p.id)) {
        if (a.status !== 'committed' || a.author !== 'ben' || a.detail.kind !== 'propose_next_workout_change' || a.detail.landsOn !== 'your_workout' || a.detail.basis === undefined || draftBasisKey(a.detail.basis) !== key) continue;
        const used = a.undoneBy === null && (await coachStore().basisStartedSince(p.id, basis, a.createdAt.utc).catch(() => true));
        out.push({ applyActionId: a.actionId, ops: a.detail.ops ?? [], atUtc: a.createdAt.utc, undone: a.undoneBy !== null, used });
      }
      return out;
    },

    /**
     * (D8) The plans with an applied next-workout change still to land (not undone, no workout started from them
     * since), for Today to show it on the card before Start. Reads coach records only.
     */
    async pendingNextWorkoutChanges(): Promise<DraftBasis[]> {
      const p = await owner();
      const out = new Map<string, DraftBasis>();
      for (const a of await coachStore().listStructural(p.id)) {
        if (a.status !== 'committed' || a.author !== 'ben' || a.undoneBy !== null || a.detail.kind !== 'propose_next_workout_change' || a.detail.landsOn !== 'your_workout' || a.detail.basis === undefined) continue;
        const basis = a.detail.basis;
        if (out.has(draftBasisKey(basis))) continue;
        if (!(await coachStore().basisStartedSince(p.id, basis, a.createdAt.utc).catch(() => true))) out.set(draftBasisKey(basis), basis);
      }
      return [...out.values()];
    },

    /**
     * (D8) Ben undid a landed next-workout change on Your workout: his Apply is undone here too, so the card reads
     * `Undone` and the change never lands on another draft. One op ID per apply (a retry is the same undo).
     */
    async noteNextWorkoutChangeUndone(applyActionId: string): Promise<void> {
      const p = await owner();
      await undoCoachAction(coachStore(), { ownerId: p.id, actionId: applyActionId, opId: `undo-landed:${applyActionId}`, now: deps.now() });
    },

    /**
     * What the last Your workout open did with these applies (review S1; D8):
     * the ones in `refused` couldn't land on the draft there; the rest of
     * `checked` did (or already had).
     */
    /** Whether the last open refused this apply (its card reads `Couldn't apply here`). */
    wasStructuralRefused(applyActionId: string): boolean {
      return refusedApplies.has(applyActionId);
    },

    noteStructuralRefused(checked: readonly string[], refused: readonly string[]): void {
      for (const id of checked) refusedApplies.delete(id);
      for (const id of refused) refusedApplies.add(id);
    },

    /**
     * Today in Ben's profile timezone (`YYYY-MM-DD`), as the coach context
     * dates the Progress window, so the sheet's `Sees:` label names the year
     * the same way (review ben-bugs r2 N2). Null before setup.
     */
    async today(): Promise<string | null> {
      const p = await deps.profile().catch(() => null);
      return p === null ? null : localDateOf(toMs(deps.now().utc), p.timezone);
    },

    /** `What the coach can see` for this entry, from the same builder the request uses. */
    async describe(entry: CoachEntry, threadId: string | null): Promise<ContextDescription> {
      const p = await owner();
      const session = await sessionOf(entry);
      const kind = kindFor(entry, session, false);
      const ctx = await contextInput(p, kind, session, entry);
      const thread = threadId === null ? [] : await coachStore().listMessages(threadId);
      return describeCoachContext(buildCoachContext({ ...ctx.input, turnKind: kind, thread }));
    },

    /**
     * The one summary turn after a workout (D21, CA10). Runs in the
     * background; leaving the Summary doesn't stop it. Once per workout: a
     * workout whose thread already has a completed summary turn is skipped;
     * one cut off or failed runs again (`Try again`). `Offline`
     * after an earlier failure still tries (the network may be back); a
     * review skipped because the coach can't answer isn't remembered, so a
     * later call runs it.
     */
    runSummaryTurn(sessionId: string): Promise<CoachTurnResult | null> {
      const existing = summaryRuns.get(sessionId);
      if (existing !== undefined) return existing;
      let skipped = false;
      let finished = false;
      const run = (async (): Promise<CoachTurnResult | null> => {
        const a = await availability();
        if (a.status !== 'ok' && a.status !== 'offline') {
          skipped = true;
          return null;
        }
        const entry: CoachEntry = { kind: 'summary', sessionId };
        const threadId = await resolveThread(entry);
        if (threadId !== null) {
          const data = await loadThread(threadId);
          if (data !== null && [...data.turns.values()].some((t) => t.kind === 'summary' && t.status === 'completed')) return null;
        }
        const r = await send({ entry, threadId, input: { kind: 'summary' }, turnId: deps.newId(), summary: true });
        finished = r.status === 'completed';
        return r;
      })().catch(() => null);
      summaryRuns.set(sessionId, run);
      // Only a running or completed review is remembered; a skipped or failed one can be run again.
      void run.then(() => {
        if ((skipped || !finished) && summaryRuns.get(sessionId) === run) summaryRuns.delete(sessionId);
      });
      return run;
    },

    /** The summary turn for this workout, if one is running in this app run (the Summary shows `Coach is reviewing…`). */
    summaryRunning: (sessionId: string): Promise<CoachTurnResult | null> | null => summaryRuns.get(sessionId) ?? null,

    /** The summary turn's checked reply for this workout (the Summary's coach note), or null. */
    async summaryNote(sessionId: string): Promise<string | null> {
      const threadId = await resolveThread({ kind: 'summary', sessionId });
      if (threadId === null) return null;
      const data = await loadThread(threadId);
      if (data === null) return null;
      const summaryTurns = new Set([...data.turns.values()].filter((t) => t.kind === 'summary').map((t) => t.id));
      const msg = [...data.messages].reverse().find((m) => m.body.role === 'coach' && summaryTurns.has(m.turnId));
      if (msg === undefined || msg.body.role !== 'coach') {
        // Cut off by a force-close and never retried (review N7): say so rather than nothing.
        return [...data.turns.values()].some((t) => t.kind === 'summary' && t.status === 'interrupted') ? 'Interrupted.' : null;
      }
      const sentences = msg.body.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []));
      // A number about an exercise is shown only beside the coach's own saved target for it (review S5).
      const p = await owner();
      const [source, rows] = await Promise.all([repos().sessions.get(sessionId).catch(() => null), coachStore().listNextTargets(p.id, sessionId).catch(() => [])]);
      const names = [...new Set((source?.exercises ?? []).map((e) => e.exerciseName))];
      const fits = source === null ? null : { version: source.session.version, basis: nextTargetSourceBasis(source) };
      const coachRows = coachTargetRows(rows);
      const text = summaryNoteSentences(sentences, names, fits === null ? coachRows : coachRows.filter((r) => nextTargetFitsSource(r, fits))).join(' ');
      return text === '' ? null : text;
    },

    /**
     * `Sore or pain?` outside a workout (review S5): the movements a `Pain`
     * tap can flag. Those Ben named (whole names), else every movement of
     * the workout in view (the Summary's, or the last finished one from
     * Today). Empty: nothing to flag, so the question isn't shown.
     */
    /**
     * What `Pain` can flag after Ben mentions pain (`painFlagChoices`): the movements his words
     * name; in a workout, else the exercise in focus (`focus`); else every movement of the
     * workout (or the last one, from Today). `pick`: show them as chips (review S5, r2 S1).
     */
    async painChoices(entry: CoachEntry, words: string | null, focus: { exerciseId: string; name: string } | null = null): Promise<{ choices: { exerciseId: string; name: string }[]; pick: boolean }> {
      const p = await owner();
      // The last workout Ben did, FitNotes ones included (review import-progress S2).
      const sessionId = isGeneralEntry(entry) ? ((await repos().sessions.listFinishedRefs(p.id, 1, { includeImported: true }).catch(() => []))[0]?.sessionId ?? null) : entry.sessionId;
      const session = sessionId === null ? null : await repos().sessions.get(sessionId).catch(() => null);
      const seen = new Set<string>();
      const all: { exerciseId: string; exerciseName: string }[] = [];
      for (const e of [...(session?.exercises ?? [])].sort((a, b) => a.order - b.order)) {
        if (seen.has(e.exerciseId)) continue;
        seen.add(e.exerciseId);
        all.push({ exerciseId: e.exerciseId, exerciseName: e.exerciseName });
      }
      if (focus !== null && !seen.has(focus.exerciseId)) all.push({ exerciseId: focus.exerciseId, exerciseName: focus.name });
      const r = painFlagChoices(words, all, focus?.exerciseId ?? null);
      const name = new Map(all.map((e) => [e.exerciseId, e.exerciseName]));
      return { choices: r.exerciseIds.map((id) => ({ exerciseId: id, name: name.get(id) ?? '' })), pick: r.pick };
    },

    /** The coach's own next-session rows for a workout (never Ben's answers to the rule's reset: `ruleResets`). */
    async nextTargets(sessionId: string): Promise<NextSessionTargetRecord[]> {
      const p = await owner();
      return coachTargetRows(await coachStore().listNextTargets(p.id, sessionId));
    },

    /** (Ben, 23 Oct) Ben's answers to the built-in rule's stall resets on this workout's Summary. */
    async ruleResets(sessionId: string): Promise<NextSessionTargetRecord[]> {
      const p = await owner();
      return (await coachStore().listNextTargets(p.id, sessionId)).filter(isRuleResetRow);
    },

    /**
     * (Ben, 23 Oct; review v5offers SP2) A tap on the rule's own stall reset (`Reset to 90 kg × 6–8?`): the first
     * Apply or Skip saves Ben's answer with its record (`ruleResetWrite`); later taps (Undo, then Apply or Skip again)
     * move that row as any `Next time` row moves. Offline: works (no coach call). One op ID per row version and tap.
     */
    async tapRuleReset(sessionId: string, offer: { exerciseId: string; exerciseName: string; target: CoachTarget; hold: CoachTarget | null; row: NextSessionTargetRecord | null; again?: true }, tap: NextTargetTap): Promise<{ status: 'written' | 'replayed' } | { status: 'not_possible'; reason: string }> {
      const p = await owner();
      // (Review ben-8-decisions S1) His Apply no longer fits the workout: a new answer, at the row's version he saw.
      if (offer.row !== null && offer.again === true && (tap === 'apply' || tap === 'not_now')) {
        const source = await repos().sessions.get(sessionId).catch(() => null);
        if (source === null || source.session.ownerId !== p.id) return { status: 'not_possible', reason: 'missing' };
        const opId = deriveId(`rule-reset:${tap}:${sessionId}:${offer.exerciseId}:v${String(offer.row.version)}`);
        const w = await coachStore().commit(p.id, ruleResetWrite({ ownerId: p.id, source, exerciseId: offer.exerciseId, exerciseName: offer.exerciseName, target: offer.target, hold: offer.hold, tap, opId, now: deps.now(), expectedVersion: offer.row.version }));
        return w.status === 'conflict' ? { status: 'not_possible', reason: w.reason === 'stale_version' ? 'changed_since' : w.reason } : { status: w.status };
      }
      if (offer.row !== null) {
        const { status, record } = nextTargetTapRecord(offer.row, tap, { opId: nextTargetTapOpId(offer.row, tap), now: deps.now() });
        const r = await coachStore().setNextTargetStatus(p.id, { rowId: offer.row.id, expectedVersion: offer.row.version, status, record });
        return r.status === 'not_possible' ? { status: 'not_possible', reason: r.reason } : { status: r.status };
      }
      if (tap !== 'apply' && tap !== 'not_now') return { status: 'not_possible', reason: 'missing' };
      const source = await repos().sessions.get(sessionId).catch(() => null);
      if (source === null || source.session.ownerId !== p.id) return { status: 'not_possible', reason: 'missing' };
      const opId = deriveId(`rule-reset:${tap}:${sessionId}:${offer.exerciseId}`);
      const w = await coachStore().commit(p.id, ruleResetWrite({ ownerId: p.id, source, exerciseId: offer.exerciseId, exerciseName: offer.exerciseName, target: offer.target, hold: offer.hold, tap, opId, now: deps.now() }));
      return w.status === 'conflict' ? { status: 'not_possible', reason: w.reason === 'stale_version' ? 'changed_since' : w.reason } : { status: w.status };
    },

    /** IDs of this workout's saved rows that no longer fit it (a set corrected since; a rename doesn't count). */
    async staleNextTargets(sessionId: string): Promise<Set<string>> {
      const p = await owner();
      const [source, rows] = await Promise.all([repos().sessions.get(sessionId).catch(() => null), coachStore().listNextTargets(p.id, sessionId).catch(() => [])]);
      if (source === null) return new Set();
      const fits = { version: source.session.version, basis: nextTargetSourceBasis(source) };
      return new Set(rows.filter((r) => !nextTargetFitsSource(r, fits)).map((r) => r.id));
    },

    /** Ben's tap on a `Next time` row: Undo, Use coach target, Apply, Not now. */
    async tapNextTarget(row: NextSessionTargetRecord, tap: NextTargetTap, opId: string) {
      const p = await owner();
      const { status, record } = nextTargetTapRecord(row, tap, { opId, now: deps.now() });
      return coachStore().setNextTargetStatus(p.id, { rowId: row.id, expectedVersion: row.version, status, record });
    },

    /**
     * `Undo all` on the Summary for the coach's one review (`actionId`). While
     * that record is live, it is undone as a whole, so its card in the coach
     * sheet reads `Undone` too (review B1). Once it is already undone (a `Use
     * coach target` after an earlier Undo all), the live rows are undone as
     * one write. Either way all rows change or none do (review S3); a repeat
     * tap replays.
     */
    async undoNextTargets(actionId: string, rows: readonly NextSessionTargetRecord[]): Promise<{ ok: boolean }> {
      const p = await owner();
      const action = await coachStore().getAction(actionId).catch(() => null);
      if (action !== null && action.status === 'committed' && action.undoneBy === null) {
        const r = await undoCoachAction(coachStore(), { ownerId: p.id, actionId, opId: undoOpId(actionId), now: deps.now() }).catch(() => null);
        return { ok: r !== null && (r.result.status === 'written' || r.result.status === 'replayed') };
      }
      const taps = rows.map((row) => ({ rowId: row.id, expectedVersion: row.version, ...nextTargetTapRecord(row, 'undo', { opId: nextTargetTapOpId(row, 'undo'), now: deps.now() }) }));
      const r = await coachStore()
        .setNextTargetStatuses(p.id, taps)
        .catch(() => null);
      return { ok: r !== null && r.status !== 'not_possible' };
    },

    /** Restart recovery at launch: turns cut off by a force-close become `interrupted`. */
    async recover(): Promise<number> {
      const p = await deps.profile();
      if (!p) return 0;
      return (await recoverCoachTurns(coachStore(), p.id, deps.now())).length;
    },

    /**
     * Path B (coach-adjustments §4.2): after a set is logged, a pure check;
     * no AI call. Shown only while resting, nothing pending, a pending set
     * left on that exercise, and at most once per exercise and kind (CA4).
     * With the coach reachable it is the coach's offer; otherwise the
     * built-in rule's, with its concrete change, or none when the rule has
     * nothing to change (CA6 revised). Showing it is saved at once (`coach_offers`),
     * so it won't come back for that exercise and kind, even after a relaunch
     * (review S6). A failed read or write never blocks logging.
     */
    async offerAfterLog(input: OfferCheckInput): Promise<WorkoutOffer | null> {
      // One check at a time per workout, so two quick logs can't both read the log before the first offer is saved (review r2 N3).
      const sessionId = input.aggregate.session.id;
      const run = (offerQueues.get(sessionId) ?? Promise.resolve()).then(() => checkOffer(input));
      offerQueues.set(sessionId, run.catch(() => undefined));
      return run;
    },

    /**
     * What a logged set triggers now (rule T against its target RPE), with no
     * offer gate and nothing recorded: whether an offer already showing for
     * it still holds after an effort chip or a correction (review r3 N3).
     */
    async triggerKindOf(aggregate: SessionAggregate, setId: string): Promise<CoachTrigger['kind'] | null> {
      return (await triggerOf(aggregate, setId))?.kind ?? null;
    },

    /**
     * F3: the coach was asked through an offer and couldn't answer. The
     * built-in rule's offer for the same trigger, on the workout as it is
     * now (not logged again for CA4: it is the same offer). Null when the
     * rule has nothing to change.
     */
    async ruleOfferFor(offer: Pick<WorkoutOffer, 'triggerId' | 'kind' | 'setId' | 'fact' | 'prompt' | 'sessionExerciseId' | 'targetRpe' | 'loggedRpe'>): Promise<WorkoutOffer | null> {
      const session = await sessionOfSet(offer.setId);
      if (session === null) return null;
      // The logged set must still trigger this offer (review target-rpe r3 S1).
      if (!(await stillTriggers(session, offer))) return null;
      const adjustment = await ruleAdjustment(session, offer).catch(() => null);
      return adjustment === null ? null : { ...offer, by: 'rule', change: adjustment.change, basis: basisOf(adjustment) };
    },

    /**
     * Ben's `Adjust` on the rule's offer. Worked out again on the workout as
     * it is now and applied only if it is still the change he was shown
     * (rule 5: never applied to newer state). One opId per trigger, so a
     * double tap applies once and replays.
     */
    async applyRuleOffer(offer: WorkoutOffer): Promise<RuleOfferResult> {
      const p = await owner();
      const opId = builtInAdjustOpId(offer.triggerId);
      const earlier = await coachStore()
        .getAction(actionIdFor(opId))
        .catch(() => null);
      if (earlier !== null) return earlier.status === 'committed' ? { status: 'applied', record: earlier } : { status: 'stale' };
      const session = await sessionOfSet(offer.setId);
      if (session === null || session.session.status !== 'active') return { status: 'stale' };
      // A correction (logged RPE, reps, target RPE) since the offer was shown can remove its reason (review target-rpe r3 S1).
      if (!(await stillTriggers(session, offer))) return { status: 'stale' };
      const adjustment = await ruleAdjustment(session, offer);
      if (adjustment === null) return { status: 'unchanged' };
      // Same sets, same targets, same words as shown (review S2); else it is a different change.
      if (offer.basis === null || !sameRuleChange(offer.basis, basisOf(adjustment)) || adjustment.change !== offer.change) return { status: 'stale' };
      return writeRuleChange(p.id, session.session.id, adjustment, opId);
    },

    /**
     * (Ben, 23 Oct; check-in.md §4.4 revised) The lighter-session offer for the workout's check-in, or
     * null: no answered check-in, it doesn't ask for one (score, Tired / Poor sleep), a working set is
     * already logged, nothing pending, already answered (`coach_offers`), or (rule) nothing the built-in
     * lighter session can change. A pure check; no AI call. A failed read shows nothing.
     */
    async checkInOffer(aggregate: SessionAggregate, coachReachable: boolean): Promise<CheckInLighterOffer | null> {
      try {
        if (aggregate.session.status !== 'active') return null;
        const checkIn = await checkInOf(aggregate);
        if (checkIn === null || checkIn.deletedAtUtc !== undefined) return null;
        const answered = (await coachStore().listOffers(aggregate.session.id)).some((o) => o.sessionExerciseId === checkInOfferRow(checkIn.id));
        if (answered) return null;
        const offer = evaluateCheckInOffer({
          checkIn,
          settings: deps.checkInSettings?.() ?? DEFAULT_CHECK_IN_SETTINGS,
          coach: coachReachable ? 'available' : 'not_connected',
          anyWorkingSetLogged: anyWorkingSetEverLogged(aggregate),
          hasPendingWorkingSet: aggregate.sets.some((x) => x.status === 'pending' && x.setType !== 'warmup'),
        });
        if (offer === null) return null;
        // Applied before (and maybe undone since): never offered again for this check-in.
        if ((await coachStore().getAction(actionIdFor(builtInAdjustOpId(offer.triggerId)))) !== null) return null;
        const base = { sessionId: aggregate.session.id, checkInId: checkIn.id, triggerId: offer.triggerId, prompt: 'Want a lighter session today?', fact: offer.fact, atVersion: aggregate.session.version };
        if (offer.by === 'coach') return { ...base, by: 'coach', change: null, basis: null };
        const adjustment = await lighterAdjustment(aggregate, checkIn);
        return adjustment === null ? null : { ...base, by: 'rule', change: adjustment.change, basis: lighterBasisOf(adjustment) };
      } catch {
        return null;
      }
    },

    /**
     * `Apply` on the built-in lighter session: worked out again on the workout as it is now and
     * applied only if it is still the change Ben was shown (rule 5), today's pending sets only, with
     * Undo. One opId per check-in, so a double tap applies once and replays.
     */
    async applyLighterSession(offer: CheckInLighterOffer): Promise<RuleOfferResult> {
      const p = await owner();
      const opId = builtInAdjustOpId(offer.triggerId);
      const earlier = await coachStore()
        .getAction(actionIdFor(opId))
        .catch(() => null);
      if (earlier !== null) return earlier.status === 'committed' ? { status: 'applied', record: earlier } : { status: 'stale' };
      const session = await repos()
        .sessions.getActive(p.id)
        .catch(() => null);
      if (session === null || session.session.id !== offer.sessionId || anyWorkingSetEverLogged(session)) return { status: 'stale' };
      const checkIn = await checkInOf(session);
      if (checkIn === null || checkIn.id !== offer.checkInId) return { status: 'stale' };
      const adjustment = await lighterAdjustment(session, checkIn);
      if (adjustment === null) return { status: 'unchanged' };
      if (offer.basis === null || !sameRuleChange(offer.basis, lighterBasisOf(adjustment)) || adjustment.change !== offer.change) return { status: 'stale' };
      const r = await writeRuleChange(p.id, session.session.id, adjustment, opId);
      await answerCheckInOffer(p.id, offer, session.session.version);
      return r;
    },

    /** `Skip` / `No thanks` (or the coach's `Adjust`, which asks it): the check-in offer is answered and won't come back. */
    async answerCheckInOffer(offer: CheckInLighterOffer): Promise<void> {
      const p = await owner();
      await answerCheckInOffer(p.id, offer, null);
    },

    /**
     * Ben's own `Too hard` / `Too easy` chip when the coach can't answer
     * (review coach-fallback S1; CLAUDE.md rule 3: when Ben asks, today's
     * remaining sets change at once, with Undo; the built-in rule is the
     * fallback with no AI). The rule's change to the focused exercise,
     * applied now on the current version. One opId per tap.
     */
    async applyRuleRequest(input: { sessionId: string; sessionExerciseId: string; intent: 'too_hard' | 'too_easy'; opId: string }): Promise<RuleOfferResult> {
      const p = await owner();
      const opId = `built-in-ask:${input.opId}`;
      const earlier = await coachStore()
        .getAction(actionIdFor(opId))
        .catch(() => null);
      if (earlier !== null) return earlier.status === 'committed' ? { status: 'applied', record: earlier } : { status: 'stale' };
      const session = await repos()
        .sessions.getActive(p.id)
        .catch(() => null);
      if (session === null || session.session.id !== input.sessionId || !session.exercises.some((e) => e.id === input.sessionExerciseId)) return { status: 'stale' };
      const adjustment = await ruleAdjustment(session, { kind: 'ben_asked', intent: input.intent, sessionExerciseId: input.sessionExerciseId, fact: input.intent === 'too_hard' ? 'Too hard' : 'Too easy' });
      if (adjustment === null) return { status: 'unchanged' };
      return writeRuleChange(p.id, session.session.id, adjustment, opId);
    },
  };

  /** The built-in lighter session on the workout as it is now (pure `evaluateLighterSession` with Ben's pain flags, check-in and gym). */
  async function lighterAdjustment(a: SessionAggregate, checkIn: CheckIn): Promise<LighterSessionAdjustment | null> {
    const p = await owner();
    const [painFlags, gymName] = await Promise.all([repos().painFlags.listActive(p.id), gymNameOf(a)]);
    return evaluateLighterSession({ aggregate: a, painFlags, sessionPainUnspecified: unspecifiedPain(checkIn).active, gymName, fact: checkInFact(checkIn) });
  }

  /** The built-in rule's target RPE per session exercise, from each exercise's catalogue entry (unknown: the accessory profile). */
  async function ruleRpesOf(a: HistoryLike): Promise<Record<string, number>> {
    const info = new Map<string, Awaited<ReturnType<ReturnType<typeof repos>['exercises']['get']>>>();
    for (const id of new Set(a.exercises.map((e) => e.exerciseId))) {
      info.set(id, await repos().exercises.get(id).catch(() => null));
    }
    return ruleTargetRpes(a, (id) => info.get(id) ?? null);
  }

  async function answerCheckInOffer(ownerId: string, offer: CheckInLighterOffer, atVersion: number | null): Promise<void> {
    await coachStore()
      .recordOffer(ownerId, { sessionId: offer.sessionId, sessionExerciseId: checkInOfferRow(offer.checkInId), kind: CHECK_IN_OFFER_KIND, atVersion: Math.max(1, atVersion ?? offer.atVersion), atUtc: deps.now().utc })
      .catch(() => undefined);
  }

  /** The active workout a logged set belongs to. */
  async function sessionOfSet(setId: string): Promise<SessionAggregate | null> {
    const p = await owner();
    const active = await repos()
      .sessions.getActive(p.id)
      .catch(() => null);
    return active !== null && active.sets.some((x) => x.id === setId) ? active : null;
  }

  async function writeRuleChange(ownerId: string, sessionId: string, adjustment: Pick<SessionAdjustment, 'args' | 'plan' | 'guardNotes' | 'reason' | 'rule'>, opId: string): Promise<RuleOfferResult> {
    const w = await applyBuiltInAdjustment(coachStore(), { ownerId, sessionId, adjustment, opId, now: deps.now() });
    if (w.status === 'stale') return { status: 'stale' };
    const fresh = await repos().sessions.get(sessionId).catch(() => null);
    if (fresh !== null) deps.onSessionChanged?.(fresh);
    return { status: 'applied', record: w.record };
  }

  /** The built-in rule's change for a trigger or Ben's request (pure `evaluateSessionAdjustment` with Ben's pain flags, check-in and gym). */
  async function ruleAdjustment(a: SessionAggregate, trigger: SessionAdjustmentTrigger): Promise<SessionAdjustment | null> {
    const p = await owner();
    const [painFlags, checkIn, gymName] = await Promise.all([repos().painFlags.listActive(p.id), checkInOf(a), gymNameOf(a)]);
    return evaluateSessionAdjustment({ aggregate: a, trigger, painFlags, sessionPainUnspecified: unspecifiedPain(checkIn).active, gymName });
  }

  /** Rule T on a logged set, judged against its target RPE: Ben's, the coach's, the plan's, else the built-in rule's (CHANGELOG 2026-10-11). */
  async function triggerOf(a: SessionAggregate, setId: string): Promise<CoachTrigger | null> {
    const set = a.sets.find((s) => s.id === setId);
    if (set === undefined) return null;
    const live = a.sets.filter((s) => s.sessionExerciseId === set.sessionExerciseId && s.status !== 'deleted').sort((x, y) => x.index - y.index);
    const ruleRpe = (await ruleRpesOf(a))[set.sessionExerciseId] ?? null;
    return evaluateCoachTrigger(set, live.findIndex((s) => s.id === set.id) + 1, DEFAULT_COACH_TRIGGER_THRESHOLDS, targetRpeOf(set, ruleRpe)?.rpe ?? null, { deload: a.session.deload !== undefined });
  }

  /** Whether the offer's logged set, as it is now, still triggers the offer's kind. */
  async function stillTriggers(a: SessionAggregate, offer: Pick<WorkoutOffer, 'setId' | 'kind'>): Promise<boolean> {
    const now = await triggerOf(a, offer.setId).catch(() => null);
    return now !== null && now.kind === offer.kind;
  }

  async function checkOffer(input: OfferCheckInput): Promise<WorkoutOffer | null> {
    const a = input.aggregate;
    const set = a.sets.find((s) => s.id === input.setId);
    if (set === undefined) return null;
    const live = a.sets.filter((s) => s.sessionExerciseId === set.sessionExerciseId && s.status !== 'deleted').sort((x, y) => x.index - y.index);
    const trigger = await triggerOf(a, set.id);
    if (trigger === null) return null;
    // Nothing to adjust when this exercise has no pending set left (review S1).
    if (!live.some((s) => s.status === 'pending')) return null;
    const log = await offerLogOf(a.session.id);
    // CA4: only an adjustment applied during this workout re-opens the offer, at the version it was applied (not the
    // current one, and not the coach's next-session target the workout started with).
    const ids = todayAdjustmentIds(a.sets, set.sessionExerciseId);
    const appliedAt = new Map<string, number>();
    for (const id of ids) {
      const r = await coachStore()
        .getAction(id)
        .catch(() => null);
      const v = r?.status === 'committed' && r.undoneBy === null ? r.entityVersions.find((e) => e.entity === 'session' && e.id === a.session.id)?.after : null;
      if (typeof v === 'number') appliedAt.set(id, v);
    }
    const adjusted = lastAdjustedVersion(ids, appliedAt);
    if (!shouldShowCoachOffer({ trigger, sessionExerciseId: set.sessionExerciseId, resting: input.resting, pending: input.pending, log, lastAdjustedAtVersion: adjusted })) return null;
    // The coach can't answer: the built-in rule offers its own change instead (CA6 revised). Nothing it can
    // change (no lighter load or fewer reps that fit, pain blocks a raise): no offer, nothing extra shown.
    const rule = input.coachReachable ? null : await ruleAdjustment(a, trigger).catch(() => null);
    if (!input.coachReachable && rule === null) return null;
    const entry: OfferLogEntry = { sessionExerciseId: set.sessionExerciseId, kind: trigger.kind, atVersion: a.session.version };
    offerLogs.set(a.session.id, [...log.filter((e) => e.sessionExerciseId !== entry.sessionExerciseId || e.kind !== entry.kind), entry]);
    await coachStore()
      .recordOffer(a.session.ownerId, { sessionId: a.session.id, ...entry, atUtc: deps.now().utc })
      .catch(() => undefined);
    return { ...trigger, sessionExerciseId: set.sessionExerciseId, by: rule === null ? 'coach' : 'rule', change: rule?.change ?? null, basis: rule === null ? null : basisOf(rule) };
  }
}

export type CoachService = ReturnType<typeof createCoachService>;

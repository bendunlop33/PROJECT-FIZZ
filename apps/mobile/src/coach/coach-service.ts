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
  actionIdFor,
  applyBuiltInAdjustment,
  asksForMoreSets,
  buildCoachContext,
  builtInAdjustOpId,
  buildTodayFitRequest,
  requestTodayFit,
  type TodayFitAnswer,
  type TodayFitContext,
  createAdjustExecutor,
  createChatSetExecutors,
  createNextTargetsExecutor,
  createSessionReadExecutor,
  createStoreExecutors,
  describeCoachContext,
  nextTargetTapOpId,
  nextTargetTapRecord,
  recoverCoachTurns,
  runCoachTurn,
  storeTodayTargets,
  undoCoachAction,
  undoOpId,
  createTrainingReadExecutors,
  createStructuralExecutors,
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
} from '@fizz/coach';
import {
  basisSlots,
  doableHere,
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
  toIso,
  trainingOverviewView,
  DEFAULT_COACH_TRIGGER_THRESHOLDS,
  evaluateCoachTrigger,
  evaluateSessionAdjustment,
  exercisesNamedForPain,
  isInHistory,
  isTriggerKind,
  lastAdjustedVersion,
  nextSessionBases,
  nextTargetFitsSource,
  nextTargetSourceBasis,
  painFlagChoices,
  ruleTargetRpes,
  progressWindowAt,
  customProgressWindow,
  rangeText,
  shouldShowCoachOffer,
  targetRpeOf,
  todayAdjustmentIds,
  toMs,
  unspecifiedPain,
  type CoachTrigger,
  type OfferLogEntry,
  type SessionAdjustment,
  type SessionAdjustmentTrigger,
} from '@fizz/domain';
import type { CandidateWrite, MemoryWrite, SqliteRepositories, Store } from '@fizz/persistence';
import { playbookRuleList, type PlaybookRuleList } from './playbook-view';

import { summaryNoteSentences } from './next-time-view';
import type { TextCoachState } from '@fizz/providers';
import type {
  ActionDetail,
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
  NextSessionTargetRecord,
  PlannedSet,
  ProgressWindowDays,
  SessionAggregate,
  SetType,
  UserProfile,
  ZonedTimestamp,
} from '@fizz/schemas';

/** Where the sheet was opened from (coach-sheet §1). */
export type CoachEntry =
  | { kind: 'today' }
  /** Progress (progress.md §2.1, §4.4): a general thread, framed by the window on screen. */
  | { kind: 'progress'; days: ProgressWindowDays; /** A custom period on screen (replaces `days`). */ range?: { from: string; to: string } }
  /** Exercise detail (progress.md slice B): a general thread framed by the exercise, its series and the chart's dates. */
  | { kind: 'progress_exercise'; exerciseName: string; seriesLabel: string; from: string; to: string }
  | { kind: 'workout'; sessionId: string }
  | { kind: 'summary'; sessionId: string };

/** Today and Progress: no workout attached; the general thread. */
export type GeneralEntry = Extract<CoachEntry, { kind: 'today' | 'progress' | 'progress_exercise' }>;

export function isGeneralEntry(entry: CoachEntry): entry is GeneralEntry {
  return entry.kind === 'today' || entry.kind === 'progress' || entry.kind === 'progress_exercise';
}

/** Connection state as the coach UI needs it: the stored status, plus `offline` after a request failed for lack of network. */
export type CoachStatus = TextCoachState['status'];

export interface CoachAvailability {
  status: CoachStatus;
  model: string | null;
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

export interface CoachServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  newId: () => string;
  /** The model port (the plan route on the phone). Absent: the coach isn't in this build's wiring. */
  model?: () => CoachModelPort;
  /** Keychain + settings file; no network. Absent: not connected. */
  connection?: () => Promise<TextCoachState>;
  /** The built-in rule's next targets for a finished workout (workout services). */
  builtInNextTargets: (sessionId: string) => Promise<Map<string, { setType: SetType; planned: PlannedSet }[]> | null>;
  /** After a coach change to today's sets or its Undo: rest alerts follow the new targets. */
  onSessionChanged?: (aggregate: SessionAggregate) => void;
  /** The bundled exercise catalogue (Coaching knowledge), for swap options and names. */
  catalogueExercises?: () => readonly Exercise[];
  catalogueSubstitutions?: (catalogueKey: string) => readonly (string | null)[];
}

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
    return { status, model: s.model?.slug ?? null };
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
    return { thread, messages, turns, actionsByTurn, proposals, memories };
  }

  /**
   * Applies the next workout's overview couldn't write into its draft on its
   * last load (review S1): not doable at that gym, or the plan has no place
   * for them. Kept for this app run only: every overview load works it out
   * again (another gym may take it), so nothing about it is stored. After a
   * force-close the card is optimistic: it reads `Applied` until the next
   * workout's overview loads again (review coach-tools r2 N1).
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
      let basisChanged = false;
      if (apply === null && basis.kind === 'routine' && d.basisVersion !== undefined) {
        const routine = await repos().routines.get(basis.routineId).catch(() => null);
        basisChanged = routine === null || routine.version !== d.basisVersion;
      }
      const refusedHere = apply !== null && refusedApplies.has(apply.actionId);
      out.set(id, { state: structuralProposalState({ apply: apply === null ? null : { undone: apply.undoneBy !== null }, dismissed, startedSince, basisChanged, refusedHere }), apply });
    }
    return out;
  }

  async function exerciseById(id: string): Promise<Exercise | null> {
    return (await repos().exercises.get(id).catch(() => null)) ?? deps.catalogueExercises?.().find((e) => e.id === id) ?? null;
  }

  /** What the next workout from `source` starts from (ADR 0020 §3): its routine, else the next session built from it. */
  async function structuralBasisOf(p: UserProfile, source: SessionAggregate): Promise<{ basis: DraftBasis; basisVersion: number | null; label: string; slots: StructuralSlot[] } | null> {
    const routineId = source.session.routineId;
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
    return repos().sessions.latestFinished(p.id).catch(() => null);
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
    const equipmentNames = (aggs: readonly SessionAggregate[]): Record<string, string> => Object.fromEntries(aggs.flatMap((a) => a.session.equipmentSnapshot.map((e) => [e.id, e.name] as const)));
    const exerciseNameOf = async (id: string, aggs: readonly SessionAggregate[]): Promise<string | null> =>
      (await repos().exercises.get(id).catch(() => null))?.name ?? aggs.flatMap((a) => a.exercises).find((e) => e.exerciseId === id)?.exerciseName ?? null;
    const finishedWith = (exerciseId: string) => repos().sessions.listFinishedWithExercise(p.id, exerciseId).catch(() => [] as SessionAggregate[]);
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
        const aggs = await repos().sessions.listFinishedBetween(p.id, from, now.utc).catch(() => [] as SessionAggregate[]);
        const firstWorkoutUtc = await repos().sessions.earliestFinishedStartUtc(p.id).catch(() => null);
        return trainingOverviewView({ weeks, nowUtc: now.utc, tz: now.tz, sessions: aggs, gymNames: await gymNames(), firstWorkoutUtc });
      },
      async equipment(exerciseId) {
        const gym = await gymInContext(p, session);
        if (gym === null) return null;
        const exercise = exerciseId === null ? null : await repos().exercises.get(exerciseId).catch(() => null);
        if (exerciseId !== null && exercise === null) return null;
        const items = await repos().equipment.listByGym(gym.id).catch(() => []);
        return equipmentView({ gymName: gym.name, equipment: items, exercise });
      },
      async builtInTargets(exerciseId) {
        const aggs = await finishedWith(exerciseId);
        const latest = [...aggs].sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc))[0];
        if (latest === undefined) return null;
        const planned = (await deps.builtInNextTargets(latest.session.id).catch(() => null))?.get(exerciseId) ?? null;
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
        });
      },
    };
  }

  async function executorsFor(p: UserProfile, entry: CoachEntry, kind: CoachTurnKind, session: SessionAggregate | null, gymName: string | null, checkIn: CheckIn | null, benAskedForMoreSets: boolean, onlySessionExerciseId: string | null = null): Promise<CoachExecutors> {
    const store = coachStore();
    const reads = createTrainingReadExecutors(trainingReads(p, session));
    const base: CoachExecutors = {
      ...reads,
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
      out.adjust_pending_sets = createAdjustExecutor({ store, targets: storeTodayTargets(store), loadSession: load, painFlags, sessionPainUnspecified: unspecifiedPain(checkIn).active, gymName, onlySessionExerciseId, ruleTargetRpe: ruleRpesOf });
      // "Log 100 for 8", "set 2 was 95" (backlog §4.3): the workout's own commands, only when Ben's words ask.
      Object.assign(out, createChatSetExecutors({ store, loadSession: load, ...(deps.onSessionChanged === undefined ? {} : { onSessionChanged: deps.onSessionChanged }) }));
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
      });
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
    if (entry.range) return { screen: 'progress', window: { days: customProgressWindow(entry.range).days, from: entry.range.from, to: entry.range.to, label: rangeText(entry.range) } };
    const w = progressWindowAt(toMs(deps.now().utc), p.timezone, entry.days);
    return { screen: 'progress', window: { days: entry.days, from: w.from, to: w.to } };
  }

  async function contextInput(p: UserProfile, kind: CoachTurnKind, session: SessionAggregate | null, entry: CoachEntry) {
    const openedFrom = openedFromOf(p, entry);
    const gymName = await gymNameOf(session);
    const checkIn = await checkInOf(session);
    const builtIn = kind === 'summary' && session !== null ? await builtInNext(session) : null;
    return {
      gymName,
      checkIn,
      input: {
        session,
        gymName,
        ...(session === null ? {} : { ruleTargetRpe: await ruleRpesOf(session).catch(() => ({})) }),
        painFlags: await repos().painFlags.listActive(p.id),
        checkIn,
        memories: await coachStore().listMemories(p.id),
        catalogue: [],
        // Coaching knowledge: only the chat rules Ben approved are sent (never memories, rule 10).
        playbookCandidates: await coachStore().listPlaybookCandidates().catch(() => []),
        // The read tools for past workouts, equipment and the built-in rule are wired (backlog §4.3).
        trainingHistoryAvailable: true,
        ...(openedFrom === undefined ? {} : { openedFrom }),
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
          surface: 'sheet',
          context: ctx.input,
          structuralSignals: await structuralSignalsFor(p, session).catch(() => []),
          namedExerciseIds: req.input.kind === 'words' ? namedExercises(req.input.text, session) : [],
          signal: stop.signal,
          ...(req.onProgress === undefined ? {} : { onProgress: req.onProgress }),
        },
        { model, store: coachStore(), executors, now: deps.now, newId: deps.newId },
      );
      if (result.error === 'network') lastNetworkFailureMs = toMs(deps.now().utc);
      else if (result.status === 'completed') lastNetworkFailureMs = null;
      if (session !== null && result.cards.some((c) => c.record.detail.kind === 'adjust_pending_sets' && c.record.status === 'committed')) {
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

    /** Stop (coach-sheet §3): cancels the request; anything already committed stays with its card. */
    stop(turnId: string): void {
      running.get(turnId)?.abort();
    },

    isRunning: (turnId: string): boolean => running.has(turnId),

    /** Undo from a card or the workout's banner. A double tap (same opId) undoes once. */
    async undo(actionId: string, opId: string) {
      const p = await owner();
      const r = await undoCoachAction(coachStore(), { ownerId: p.id, actionId, opId, now: deps.now() });
      const target = r.result.status === 'written' || r.result.status === 'replayed' ? r.result.target : null;
      if (target?.detail.kind === 'adjust_pending_sets' || target?.detail.kind === 'log_set' || target?.detail.kind === 'correct_set') {
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
      return memoryList(await coachStore().listMemories(p.id, 'all'), deps.now().utc);
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
      const r = await coachStore().commitStructuralTap(p.id, structuralTapRecord(proposal, tap, { now: deps.now() }));
      if (r.status !== 'conflict') return { ok: true, record: r.action };
      return { ok: false, state: (await proposalStates([proposalId])).get(proposalId)?.state ?? null };
    },

    /**
     * Ben's applied structural proposals for one plan (ADR 0020 §3), for the
     * next workout's overview to write into its draft (`structuralDraftPlan`).
     * Reads coach records only.
     */
    async appliedStructural(basis: DraftBasis): Promise<AppliedStructural[]> {
      const p = await owner();
      const key = draftBasisKey(basis);
      const out: AppliedStructural[] = [];
      for (const a of await coachStore().listStructural(p.id)) {
        if (a.status !== 'committed' || a.author !== 'ben' || a.detail.kind !== 'propose_next_workout_change' || a.detail.basis === undefined || draftBasisKey(a.detail.basis) !== key) continue;
        const used = a.undoneBy === null && (await coachStore().basisStartedSince(p.id, basis, a.createdAt.utc).catch(() => true));
        out.push({ applyActionId: a.actionId, ops: a.detail.ops ?? [], undone: a.undoneBy !== null, used });
      }
      return out;
    },

    /**
     * What the last overview load did with these applies (review S1): the
     * ones in `refused` couldn't be written into the draft there; the rest
     * of `checked` were (or already had been).
     */
    /** Whether the last overview load refused this apply (its card reads `Couldn't apply here`). */
    wasStructuralRefused(applyActionId: string): boolean {
      return refusedApplies.has(applyActionId);
    },

    noteStructuralRefused(checked: readonly string[], refused: readonly string[]): void {
      for (const id of checked) refusedApplies.delete(id);
      for (const id of refused) refusedApplies.add(id);
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
      const text = summaryNoteSentences(sentences, names, fits === null ? rows : rows.filter((r) => nextTargetFitsSource(r, fits))).join(' ');
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
      const sessionId = isGeneralEntry(entry) ? ((await repos().sessions.listFinishedRefs(p.id, 1).catch(() => []))[0]?.sessionId ?? null) : entry.sessionId;
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

    async nextTargets(sessionId: string): Promise<NextSessionTargetRecord[]> {
      const p = await owner();
      return coachStore().listNextTargets(p.id, sessionId);
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

  /** The built-in rule's target RPE per session exercise, from each exercise's catalogue entry (unknown: the accessory profile). */
  async function ruleRpesOf(a: SessionAggregate): Promise<Record<string, number>> {
    const info = new Map<string, Awaited<ReturnType<ReturnType<typeof repos>['exercises']['get']>>>();
    for (const id of new Set(a.exercises.map((e) => e.exerciseId))) {
      info.set(id, await repos().exercises.get(id).catch(() => null));
    }
    return ruleTargetRpes(a, (id) => info.get(id) ?? null);
  }

  /** The active workout a logged set belongs to. */
  async function sessionOfSet(setId: string): Promise<SessionAggregate | null> {
    const p = await owner();
    const active = await repos()
      .sessions.getActive(p.id)
      .catch(() => null);
    return active !== null && active.sets.some((x) => x.id === setId) ? active : null;
  }

  async function writeRuleChange(ownerId: string, sessionId: string, adjustment: SessionAdjustment, opId: string): Promise<RuleOfferResult> {
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
    return evaluateCoachTrigger(set, live.findIndex((s) => s.id === set.id) + 1, DEFAULT_COACH_TRIGGER_THRESHOLDS, targetRpeOf(set, ruleRpe)?.rpe ?? null);
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

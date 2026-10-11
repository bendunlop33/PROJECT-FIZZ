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
  asksForMoreSets,
  buildCoachContext,
  createAdjustExecutor,
  createNextTargetsExecutor,
  createSessionReadExecutor,
  createStoreExecutors,
  describeCoachContext,
  nextTargetTapRecord,
  recoverCoachTurns,
  runCoachTurn,
  storeTodayTargets,
  undoCoachAction,
  type CoachExecutors,
  type CoachModelPort,
  type CoachTurnProgress,
  type CoachTurnResult,
  type ContextDescription,
  type NextTargetTap,
} from '@fizz/coach';
import {
  DEFAULT_COACH_TRIGGER_THRESHOLDS,
  evaluateCoachTrigger,
  exercisesNamedForPain,
  isTriggerKind,
  lastAdjustedVersion,
  nextSessionBases,
  painFlagChoices,
  shouldShowCoachOffer,
  todayAdjustmentIds,
  toMs,
  unspecifiedPain,
  type CoachTrigger,
  type OfferLogEntry,
} from '@fizz/domain';
import type { SqliteRepositories, Store } from '@fizz/persistence';

import { summaryNoteSentences } from './next-time-view';
import type { TextCoachState } from '@fizz/providers';
import type {
  ActionRecord,
  BenInput,
  CheckIn,
  CoachMessage,
  CoachThread,
  CoachTurn,
  CoachTurnKind,
  NextSessionTargetRecord,
  PlannedSet,
  SessionAggregate,
  SetType,
  UserProfile,
  ZonedTimestamp,
} from '@fizz/schemas';

/** Where the sheet was opened from (coach-sheet §1). */
export type CoachEntry =
  | { kind: 'today' }
  | { kind: 'workout'; sessionId: string }
  | { kind: 'summary'; sessionId: string };

/** Connection state as the coach UI needs it: the stored status, plus `offline` after a request failed for lack of network. */
export type CoachStatus = TextCoachState['status'];

export interface CoachAvailability {
  status: CoachStatus;
  model: string | null;
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
}

/** A thread as stored, with every action its messages and turns refer to. */
export interface ThreadData {
  thread: CoachThread;
  messages: CoachMessage[];
  turns: Map<string, CoachTurn>;
  /** Actions by turn, for cards (including turns cut off before their reply was saved). */
  actionsByTurn: Map<string, ActionRecord[]>;
}

const GENERAL_REUSE_MS = 6 * 60 * 60 * 1000;

/** Exercise IDs Ben named in his words, matched to the workout's exercises (for rule 9's `messagePain`). */
export function namedExercises(text: string, session: SessionAggregate | null): string[] {
  return session === null ? [] : exercisesNamedForPain(text, session.exercises);
}

export function createCoachService(deps: CoachServiceDeps) {
  const repos = (): SqliteRepositories => deps.store().repos;
  const coachStore = () => repos().coach;
  const running = new Map<string, AbortController>();
  const summaryRuns = new Map<string, Promise<CoachTurnResult | null>>();
  const offerLogs = new Map<string, OfferLogEntry[]>();
  const offerQueues = new Map<string, Promise<unknown>>();
  let lastNetworkFailure = false;

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

  async function availability(): Promise<CoachAvailability> {
    if (deps.connection === undefined || deps.model === undefined) return { status: 'not_connected', model: null };
    const s = await deps.connection().catch((): TextCoachState => ({ status: 'not_connected', route: null, email: null, model: null }));
    const status: CoachStatus = s.status === 'ok' && lastNetworkFailure ? 'offline' : s.status;
    return { status, model: s.model?.slug ?? null };
  }

  async function sessionOf(entry: CoachEntry): Promise<SessionAggregate | null> {
    if (entry.kind === 'today') return null;
    return repos().sessions.get(entry.sessionId).catch(() => null);
  }

  /** CS1: a workout's own thread; outside a workout the last general thread if used in the last 6 hours. */
  async function resolveThread(entry: CoachEntry): Promise<string | null> {
    const p = await owner();
    const threads = await coachStore().listThreads(p.id);
    if (entry.kind !== 'today') return threads.find((t) => t.sessionId === entry.sessionId)?.id ?? null;
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
    return { thread, messages, turns, actionsByTurn };
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

  async function executorsFor(p: UserProfile, kind: CoachTurnKind, session: SessionAggregate | null, gymName: string | null, checkIn: CheckIn | null, benAskedForMoreSets: boolean, onlySessionExerciseId: string | null = null): Promise<CoachExecutors> {
    const store = coachStore();
    const base: CoachExecutors = createStoreExecutors({
      store,
      exercises: { exerciseName: async (id) => (await repos().exercises.get(id).catch(() => null))?.name ?? session?.exercises.find((e) => e.exerciseId === id)?.exerciseName ?? null },
      sessionId: session?.session.id ?? null,
    });
    if (session === null) return base;
    const load = () => repos().sessions.get(session.session.id);
    const painFlags = () => repos().painFlags.listActive(p.id);
    const out: CoachExecutors = { ...base, get_active_session: createSessionReadExecutor({ loadSession: load, gymName }) };
    if (kind === 'workout') {
      out.adjust_pending_sets = createAdjustExecutor({ store, targets: storeTodayTargets(store), loadSession: load, painFlags, sessionPainUnspecified: unspecifiedPain(checkIn).active, gymName, onlySessionExerciseId });
    }
    if (kind === 'summary') {
      out.set_next_session_targets = createNextTargetsExecutor({
        store,
        source: session,
        bases: nextSessionBases(session, await builtInNext(session)),
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

  async function contextInput(p: UserProfile, kind: CoachTurnKind, session: SessionAggregate | null) {
    const gymName = await gymNameOf(session);
    const checkIn = await checkInOf(session);
    const builtIn = kind === 'summary' && session !== null ? await builtInNext(session) : null;
    return {
      gymName,
      checkIn,
      input: {
        session,
        gymName,
        painFlags: await repos().painFlags.listActive(p.id),
        checkIn,
        memories: await coachStore().listMemories(p.id),
        catalogue: [],
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
    const ctx = await contextInput(p, kind, session);
    const offerScope = req.input.kind === 'chip' ? (req.input.sessionExerciseId ?? null) : null;
    const executors = await executorsFor(p, kind, session, ctx.gymName, ctx.checkIn, await askedForMoreSets(req.threadId), offerScope);
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
          structuralSignals: [],
          namedExerciseIds: req.input.kind === 'words' ? namedExercises(req.input.text, session) : [],
          signal: stop.signal,
          ...(req.onProgress === undefined ? {} : { onProgress: req.onProgress }),
        },
        { model, store: coachStore(), executors, now: deps.now, newId: deps.newId },
      );
      if (result.error === 'network') lastNetworkFailure = true;
      else if (result.status === 'completed') lastNetworkFailure = false;
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
      if (target?.detail.kind === 'adjust_pending_sets') {
        const fresh = await repos().sessions.get(target.detail.sessionId).catch(() => null);
        if (fresh !== null) deps.onSessionChanged?.(fresh);
      }
      return r;
    },

    getAction: (actionId: string): Promise<ActionRecord | null> => coachStore().getAction(actionId),

    /** `What the coach can see` for this entry, from the same builder the request uses. */
    async describe(entry: CoachEntry, threadId: string | null): Promise<ContextDescription> {
      const p = await owner();
      const session = await sessionOf(entry);
      const kind = kindFor(entry, session, false);
      const ctx = await contextInput(p, kind, session);
      const thread = threadId === null ? [] : await coachStore().listMessages(threadId);
      return describeCoachContext(buildCoachContext({ ...ctx.input, turnKind: kind, thread }));
    },

    /**
     * The one summary turn after a workout (D21, CA10). Runs in the
     * background; leaving the Summary doesn't stop it. Once per workout: a
     * workout whose thread already has a summary turn is skipped.
     */
    runSummaryTurn(sessionId: string): Promise<CoachTurnResult | null> {
      const existing = summaryRuns.get(sessionId);
      if (existing !== undefined) return existing;
      const run = (async (): Promise<CoachTurnResult | null> => {
        const a = await availability();
        if (a.status !== 'ok') return null;
        const entry: CoachEntry = { kind: 'summary', sessionId };
        const threadId = await resolveThread(entry);
        if (threadId !== null) {
          const data = await loadThread(threadId);
          if (data !== null && [...data.turns.values()].some((t) => t.kind === 'summary')) return null;
        }
        return send({ entry, threadId, input: { kind: 'summary' }, turnId: deps.newId(), summary: true });
      })().catch(() => null);
      summaryRuns.set(sessionId, run);
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
      const text = summaryNoteSentences(sentences, names, rows).join(' ');
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
      const sessionId = entry.kind === 'today' ? ((await repos().sessions.listFinishedRefs(p.id, 1).catch(() => []))[0]?.sessionId ?? null) : entry.sessionId;
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

    /** Ben's tap on a `Next time` row: Undo, Use coach target, Apply, Not now. */
    async tapNextTarget(row: NextSessionTargetRecord, tap: NextTargetTap, opId: string) {
      const p = await owner();
      const { status, record } = nextTargetTapRecord(row, tap, { opId, now: deps.now() });
      return coachStore().setNextTargetStatus(p.id, { rowId: row.id, expectedVersion: row.version, status, record });
    },

    /** Restart recovery at launch: turns cut off by a force-close become `interrupted`. */
    async recover(): Promise<number> {
      const p = await deps.profile();
      if (!p) return 0;
      return (await recoverCoachTurns(coachStore(), p.id, deps.now())).length;
    },

    /**
     * Path B (coach-adjustments §4.2): after a set is logged, a pure check;
     * no AI call. Shown only while resting, with the coach reachable, nothing
     * pending, a pending set left on that exercise, and at most once per
     * exercise and kind (CA4). Showing it is saved at once (`coach_offers`),
     * so it won't come back for that exercise and kind, even after a relaunch
     * (review S6). A failed read or write never blocks logging.
     */
    async offerAfterLog(input: { aggregate: SessionAggregate; setId: string; resting: boolean; coachReachable: boolean; pending: boolean }): Promise<(CoachTrigger & { sessionExerciseId: string }) | null> {
      // One check at a time per workout, so two quick logs can't both read the log before the first offer is saved (review r2 N3).
      const sessionId = input.aggregate.session.id;
      const run = (offerQueues.get(sessionId) ?? Promise.resolve()).then(() => checkOffer(input));
      offerQueues.set(sessionId, run.catch(() => undefined));
      return run;
    },
  };

  async function checkOffer(input: { aggregate: SessionAggregate; setId: string; resting: boolean; coachReachable: boolean; pending: boolean }): Promise<(CoachTrigger & { sessionExerciseId: string }) | null> {
    const a = input.aggregate;
    const set = a.sets.find((s) => s.id === input.setId);
    if (set === undefined) return null;
    const live = a.sets.filter((s) => s.sessionExerciseId === set.sessionExerciseId && s.status !== 'deleted').sort((x, y) => x.index - y.index);
    const trigger = evaluateCoachTrigger(set, live.findIndex((s) => s.id === set.id) + 1, DEFAULT_COACH_TRIGGER_THRESHOLDS);
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
    if (!shouldShowCoachOffer({ trigger, sessionExerciseId: set.sessionExerciseId, resting: input.resting, coachReachable: input.coachReachable, pending: input.pending, log, lastAdjustedAtVersion: adjusted })) return null;
    const entry: OfferLogEntry = { sessionExerciseId: set.sessionExerciseId, kind: trigger.kind, atVersion: a.session.version };
    offerLogs.set(a.session.id, [...log.filter((e) => e.sessionExerciseId !== entry.sessionExerciseId || e.kind !== entry.kind), entry]);
    await coachStore()
      .recordOffer(a.session.ownerId, { sessionId: a.session.id, ...entry, atUtc: deps.now().utc })
      .catch(() => undefined);
    return { ...trigger, sessionExerciseId: set.sessionExerciseId };
  }
}

export type CoachService = ReturnType<typeof createCoachService>;

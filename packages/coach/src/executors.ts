import { deriveId, nextTargetSourceBasis, validateNextSessionTargets, validateTodayAdjustment, type AdjustIntent, type ExerciseAdjustmentPlan, type MessagePain, type NextSessionBasis, type SessionAdjustment } from '@fizz/domain';
import type {
  ActionDetail,
  ActionRecord,
  AdjustPendingSetsArgs,
  CoachToolCall,
  CoachToolName,
  CoachUndoResult,
  CoachWrite,
  CoachWriteResult,
  ExerciseTargetChanges,
  GuardNote,
  Memory,
  NextSessionTargetRecord,
  PainArea,
  PainFlag,
  SessionAggregate,
  ZonedTimestamp,
} from '@fizz/schemas';
import { isChangeClaim } from './claims';
import { workoutView } from './context';
import { renderActionResult } from './render';
import { appendContentKeys, memoryContentKey, memoryTextKind, playbookContentKey } from './tool-call';

/**
 * Tool executors (ADR 0020 §2, §5; slice C4). Each one turns a parsed,
 * gated tool call into either read data or an `ActionRecord` committed with
 * its change through the store, in one transaction, idempotent on the opId.
 * Deterministic code decides every number: `validateTodayAdjustment` snaps,
 * caps and blocks; the model's arguments are only a request.
 *
 * A tool with no executor in this build is withheld from the turn (it is
 * never offered to the model), so the coach can't call something the app
 * can't do. In this build that is `propose_next_workout_change` (structural
 * proposals) and the history / equipment / built-in rule reads until the
 * app wires their ports. `adjust_pending_sets` (workout turns) and
 * `set_next_session_targets` (the summary turn) are wired by the app.
 */

export type ToolResult =
  | { kind: 'read'; data: unknown; earlier?: readonly ActionRecord[] }
  | { kind: 'action'; record: ActionRecord; replayed: boolean }
  /** Nothing ran and nothing was written (e.g. a second build in one turn); `line` goes back to the model. */
  | { kind: 'refused'; line: string };

export interface ToolCallContext {
  ownerId: string;
  turnId: string;
  opId: string;
  now: ZonedTimestamp;
  /** Ben's own words in this turn (null for a chip or an accepted offer). */
  benWords: string | null;
  /** `classifyPainMention` on Ben's words, with the movements he named. */
  messagePain: MessagePain | null;
  /** How the request was made, for the snapping direction. */
  intent: AdjustIntent;
}

export type ToolExecutor = (call: CoachToolCall, ctx: ToolCallContext) => Promise<ToolResult>;
export type CoachExecutors = Partial<Record<CoachToolName, ToolExecutor>>;

/** The store as the executors use it (`SqliteCoachStore` implements it). */
export interface CoachWriteStore {
  commit(ownerId: string, write: CoachWrite): Promise<CoachWriteResult>;
  getMemory(id: string): Promise<Memory | null>;
  listRecentActions(ownerId: string, options: { sessionId?: string | null; limit: number }): Promise<ActionRecord[]>;
}

/** Deterministic from the opId, so a replay builds the same record and row IDs. */
export const actionIdFor = (opId: string): string => deriveId(`coach-action:${opId}`);

/** The coach's reason, only if it doesn't itself claim a change (CC3). */
function checkedReason(reason: string | null): string | null {
  if (reason === null) return null;
  return isChangeClaim(reason) ? null : reason;
}

export function newActionRecord(
  ctx: Pick<ToolCallContext, 'turnId' | 'opId' | 'now'>,
  detail: ActionDetail,
  over: Partial<Pick<ActionRecord, 'status' | 'failure' | 'reason' | 'guardNotes' | 'entityVersions' | 'evidenceRefs' | 'author'>> = {},
): ActionRecord {
  return {
    actionId: actionIdFor(ctx.opId),
    turnId: ctx.turnId,
    opId: ctx.opId,
    status: over.status ?? 'committed',
    author: over.author ?? 'coach',
    detail,
    failure: over.failure ?? null,
    reason: checkedReason(over.reason ?? null),
    evidenceRefs: over.evidenceRefs ?? [],
    guardNotes: over.guardNotes ?? [],
    entityVersions: over.entityVersions ?? [],
    undoneBy: null,
    createdAt: ctx.now,
  };
}

/** Commit, and turn a conflict into its own refused record (also idempotent on the opId). */
async function commitOr(store: CoachWriteStore, ownerId: string, write: CoachWrite, refused: (reason: 'stale_version' | 'missing' | 'already_exists') => ActionRecord): Promise<ToolResult> {
  const r = await store.commit(ownerId, write);
  if (r.status !== 'conflict') return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
  const again = await store.commit(ownerId, { kind: 'record', action: refused(r.reason) });
  if (again.status === 'conflict') throw new Error(`Couldn't record the refused ${write.action.detail.kind}`);
  return { kind: 'action', record: again.action, replayed: again.status === 'replayed' };
}

// ---------------------------------------------------------------------------
// Append tools and memory

export interface ExerciseLookup {
  /** The exercise's name, or null when it isn't known (never a guess). */
  exerciseName(exerciseId: string): Promise<string | null>;
}

export function createStoreExecutors(deps: { store: CoachWriteStore; exercises: ExerciseLookup; sessionId: string | null }): CoachExecutors {
  const { store } = deps;

  /** A memory that waits for Ben's choice (CM1, CM2; CM9's split card when the words could be a rule). Never sent to the coach until saved. */
  function suggestMemory(text: string, quote: string, source: 'coach_suggested' | 'ben_asked', ctx: ToolCallContext): Promise<ToolResult> {
    const memoryId = deriveId(`coach-memory:${ctx.opId}`);
    const memory: Memory = {
      id: memoryId,
      ownerId: ctx.ownerId,
      version: 1,
      createdAtUtc: ctx.now.utc,
      updatedAtUtc: ctx.now.utc,
      text,
      contentKey: memoryContentKey(text),
      status: 'suggested',
      quote,
      createdByActionId: actionIdFor(ctx.opId),
      source,
    };
    const detail: ActionDetail = { kind: 'suggest_memory', memoryId, text };
    return commitOr(store, ctx.ownerId, { kind: 'suggest_memory', action: newActionRecord(ctx, detail, { status: 'proposed' }), memory }, () =>
      newActionRecord({ ...ctx, opId: `${ctx.opId}:refused` }, detail, { status: 'rejected', failure: 'it is already saved or waiting' }),
    );
  }

  /** A `To review` playbook candidate (Coaching knowledge): not used until Ben approves it. */
  function addCandidate(text: string, statedBy: 'ben' | 'coach', ctx: ToolCallContext): Promise<ToolResult> {
    const candidateId = deriveId(`coach-playbook:${ctx.opId}`);
    const detail: ActionDetail = { kind: 'add_playbook_candidate', candidateId, text };
    return commitOr(
      store,
      ctx.ownerId,
      {
        kind: 'playbook_candidate',
        action: newActionRecord(ctx, detail),
        candidate: {
          id: candidateId,
          version: 1,
          createdAtUtc: ctx.now.utc,
          updatedAtUtc: ctx.now.utc,
          text,
          contentKey: playbookContentKey(text),
          statedBy,
          status: 'to_review',
          createdByActionId: actionIdFor(ctx.opId),
        },
      },
      () => newActionRecord({ ...ctx, opId: `${ctx.opId}:refused` }, detail, { status: 'rejected', failure: 'it was already reviewed' }),
    );
  }

  return {
    get_recent_actions: async (call, ctx) => {
      if (call.tool !== 'get_recent_actions') throw new TypeError(call.tool);
      const earlier = await store.listRecentActions(ctx.ownerId, { sessionId: deps.sessionId, limit: call.args.limit });
      return { kind: 'read', data: null, earlier };
    },

    set_pain_flag: async (call, ctx) => {
      if (call.tool !== 'set_pain_flag') throw new TypeError(call.tool);
      const ids = [...new Set(call.args.exerciseIds)].sort();
      const names: string[] = [];
      const flags: PainFlag[] = [];
      for (const exerciseId of ids) {
        const name = await deps.exercises.exerciseName(exerciseId);
        if (name === null) continue;
        names.push(name);
        flags.push({
          id: deriveId(`coach-pain-flag:${ctx.opId}:${exerciseId}`),
          ownerId: ctx.ownerId,
          version: 1,
          createdAtUtc: ctx.now.utc,
          updatedAtUtc: ctx.now.utc,
          exerciseId,
          exerciseName: name,
          area: call.args.area satisfies PainArea | null,
          source: 'coach',
          checkInId: null,
          reportedAt: ctx.now,
          status: 'active',
          clearedAtUtc: null,
          createdByOpId: ctx.opId,
        });
      }
      const detail: ActionDetail = { kind: 'set_pain_flag', flagIds: flags.map((f) => f.id), exerciseNames: names.length > 0 ? names : ['that exercise'], area: call.args.area };
      if (flags.length === 0) {
        const r = await store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status: 'rejected', failure: "the coach named an exercise the app doesn't know" }) });
        if (r.status === 'conflict') throw new Error('Could not record the refused pain flag');
        return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
      }
      const action = newActionRecord(ctx, detail, { entityVersions: flags.map((f) => ({ entity: 'pain_flag', id: f.id, before: null, after: 1 })) });
      return commitOr(store, ctx.ownerId, { kind: 'pain_flags', action, flags }, () =>
        newActionRecord({ ...ctx, opId: `${ctx.opId}:refused` }, detail, { status: 'rejected', failure: `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} already flagged` }),
      );
    },

    save_memory: async (call, ctx) => {
      if (call.tool !== 'save_memory') throw new TypeError(call.tool);
      // CM9 (review coach-tools r2 S1): even when Ben says "remember …", a general rule is never a memory. Only
      // unmistakably general wording (review r3 S1) goes to the playbook as a `To review` candidate from Ben
      // (inert until he approves it, with Undo); anything that could be his own constraint waits as a card
      // with both choices.
      const kind = memoryTextKind(call.args.text, 'ben');
      if (kind === 'rule') return addCandidate(call.args.text, 'ben', ctx);
      if (kind === 'unclear') return suggestMemory(call.args.text, call.args.quote, 'ben_asked', ctx);
      const memoryId = deriveId(`coach-memory:${ctx.opId}`);
      const contentKey = appendContentKeys(call)[0] ?? `memory:${memoryId}`;
      const memory: Memory = {
        id: memoryId,
        ownerId: ctx.ownerId,
        version: 1,
        createdAtUtc: ctx.now.utc,
        updatedAtUtc: ctx.now.utc,
        text: call.args.text,
        contentKey,
        status: 'active',
        quote: call.args.quote,
        createdByActionId: actionIdFor(ctx.opId),
      };
      const detail: ActionDetail = { kind: 'save_memory', memoryId, text: call.args.text };
      return commitOr(store, ctx.ownerId, { kind: 'save_memory', action: newActionRecord(ctx, detail, { entityVersions: [{ entity: 'memory', id: memoryId, before: null, after: 1 }] }), memory }, () =>
        newActionRecord({ ...ctx, opId: `${ctx.opId}:refused` }, detail, { status: 'rejected', failure: 'it is already saved' }),
      );
    },

    suggest_memory: async (call, ctx) => {
      if (call.tool !== 'suggest_memory') throw new TypeError(call.tool);
      return suggestMemory(call.args.text, call.args.quote, 'coach_suggested', ctx);
    },

    forget_memory: async (call, ctx) => {
      if (call.tool !== 'forget_memory') throw new TypeError(call.tool);
      const m = await store.getMemory(call.args.memoryId);
      const text = m?.text ?? 'that memory';
      const detail: ActionDetail = { kind: 'forget_memory', memoryId: call.args.memoryId, text };
      if (m === null || m.ownerId !== ctx.ownerId) {
        const r = await store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status: 'rejected', failure: 'no such memory' }) });
        if (r.status === 'conflict') throw new Error('Could not record the refused forget');
        return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
      }
      const action = newActionRecord(ctx, detail, { entityVersions: [{ entity: 'memory', id: m.id, before: call.args.expectedVersion, after: call.args.expectedVersion + 1 }] });
      return commitOr(store, ctx.ownerId, { kind: 'forget_memory', action, memoryId: m.id, expectedVersion: call.args.expectedVersion, atUtc: ctx.now.utc }, (reason) =>
        newActionRecord({ ...ctx, opId: `${ctx.opId}:refused` }, detail, { status: reason === 'stale_version' ? 'stale' : 'rejected', failure: reason === 'stale_version' ? 'it changed since' : 'no such memory' }),
      );
    },

    add_playbook_candidate: async (call, ctx) => {
      if (call.tool !== 'add_playbook_candidate') throw new TypeError(call.tool);
      return addCandidate(call.args.text, call.args.statedBy, ctx);
    },
  };
}

// ---------------------------------------------------------------------------
// Today's sets (the session port is the seam for `claude/active-set`)

export type TodayTargetsWriteResult =
  | { status: 'written' | 'replayed'; record: ActionRecord }
  /** The session moved on (version) between validation and the write: nothing changed. */
  | { status: 'stale' };

/**
 * Writes today's pending-set targets and the record in one transaction,
 * through the session reducer's `adjust_pending_targets` command
 * (`expectedVersion`, `opId`), so a replay or a newer session changes
 * nothing. Not built yet: it needs `TargetSource: 'coach'` from
 * `claude/active-set`.
 */
export interface TodayTargetsPort {
  apply(input: { ownerId: string; sessionId: string; expectedVersion: number; opId: string; plan: readonly ExerciseAdjustmentPlan[]; record: ActionRecord }): Promise<TodayTargetsWriteResult>;
}

export interface AdjustDeps {
  store: CoachWriteStore;
  targets: TodayTargetsPort;
  /** The active workout as it is now (read fresh for each call). */
  loadSession(): Promise<SessionAggregate | null>;
  painFlags(): Promise<readonly PainFlag[]>;
  sessionPainUnspecified: boolean;
  gymName: string | null;
  /**
   * Set when Ben accepted an offer about one exercise row (CA1): a change to
   * any other exercise is refused, so the tool's scope matches the offer
   * (review S1).
   */
  onlySessionExerciseId?: string | null;
  /** The built-in rule's target RPE per session exercise (`ruleTargetRpes`), so a raise above it counts as an increase (review target-rpe S1). */
  ruleTargetRpe?: (s: SessionAggregate) => Promise<Readonly<Record<string, number>>>;
}

function requestedSets(agg: SessionAggregate | null, args: AdjustPendingSetsArgs): ExerciseTargetChanges[] {
  return args.exercises.flatMap((req) => {
    const ex = agg?.exercises.find((e) => e.id === req.sessionExerciseId);
    if (ex === undefined || agg === null) return [];
    const live = agg.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted').sort((a, b) => a.index - b.index);
    const changes = req.sets.flatMap((c) => {
      const n = live.findIndex((s) => s.id === c.setId) + 1;
      return n > 0 ? [{ setId: c.setId, setNumber: n, before: null, after: null }] : [];
    });
    return [{ sessionExerciseId: ex.id, exerciseName: ex.exerciseName, changes }];
  });
}

function failureText(outcome: string): string {
  const t = outcome.replace(/\s*(?:Nothing changed|Sets unchanged|No change)\.?\s*$/i, '').replace(/[.\s]+$/, '');
  return (t.charAt(0).toLowerCase() + t.slice(1)).slice(0, 200) || 'the change was refused';
}

export function createAdjustExecutor(deps: AdjustDeps): ToolExecutor {
  return async (call, ctx) => {
    if (call.tool !== 'adjust_pending_sets') throw new TypeError(call.tool);
    const agg = await deps.loadSession();
    const refuse = async (status: 'stale' | 'rejected', outcome: string, guardNotes: GuardNote[]): Promise<ToolResult> => {
      const detail: ActionDetail = { kind: 'adjust_pending_sets', sessionId: agg?.session.id ?? '00000000-0000-4000-8000-000000000000', exercises: requestedSets(agg, call.args) };
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status, failure: status === 'stale' ? null : failureText(outcome), guardNotes, reason: call.args.reason }) });
      if (r.status === 'conflict') throw new Error('Could not record the refused adjustment');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    };
    if (agg === null) return refuse('stale', 'There is no active workout.', []);
    const only = deps.onlySessionExerciseId ?? null;
    if (only !== null && call.args.exercises.some((e) => e.sessionExerciseId !== only)) {
      const name = agg.exercises.find((e) => e.id === only)?.exerciseName ?? 'that exercise';
      return refuse('rejected', `Only ${name}. No change.`, []);
    }
    const result = validateTodayAdjustment({
      aggregate: agg,
      args: call.args,
      intent: ctx.intent,
      opId: ctx.opId,
      painFlags: await deps.painFlags(),
      sessionPainUnspecified: deps.sessionPainUnspecified,
      gymName: deps.gymName,
      messagePain: ctx.messagePain,
      ruleTargetRpe: deps.ruleTargetRpe ? await deps.ruleTargetRpe(agg).catch(() => undefined) : undefined,
    });
    if (result.status === 'stale') return refuse('stale', result.outcome, result.guardNotes);
    if (result.status === 'unchanged') return refuse('rejected', result.outcome, result.guardNotes);
    const exercises: ExerciseTargetChanges[] = result.exercises.map((e) => ({ sessionExerciseId: e.sessionExerciseId, exerciseName: e.exerciseName, changes: e.changes }));
    const record = newActionRecord(ctx, { kind: 'adjust_pending_sets', sessionId: agg.session.id, exercises }, {
      guardNotes: result.guardNotes,
      reason: call.args.reason,
      entityVersions: [{ entity: 'session', id: agg.session.id, before: agg.session.version, after: agg.session.version + 1 }],
    });
    const w = await deps.targets.apply({ ownerId: ctx.ownerId, sessionId: agg.session.id, expectedVersion: call.args.baseVersion, opId: ctx.opId, plan: result.exercises, record });
    if (w.status === 'stale') return refuse('stale', 'Your workout moved on.', result.guardNotes);
    return { kind: 'action', record: w.record, replayed: w.status === 'replayed' };
  };
}

// ---------------------------------------------------------------------------
// Undo (Ben's tap; not a coach tool)

export interface UndoStore {
  getAction(actionId: string): Promise<ActionRecord | null>;
  undo(ownerId: string, undo: ActionRecord): Promise<CoachUndoResult>;
}

/** What an undo names: `the change to sets 3–4`, `the memory "…"`. Rendered from the record. */
function undoWhat(target: ActionRecord): string {
  const d = target.detail;
  switch (d.kind) {
    case 'save_memory':
      return `the memory “${d.text}”`;
    case 'suggest_memory':
      return `the suggestion “${d.text}”`;
    case 'forget_memory':
      return `forgetting “${d.text}”`;
    case 'set_pain_flag':
      return `the pain flag on ${d.exerciseNames.join(' and ')}`;
    case 'add_playbook_candidate':
      return 'the playbook suggestion';
    case 'log_set':
      return `logging set ${String(d.setNumber)} of ${d.exerciseName}`;
    case 'correct_set':
      return `the correction to set ${String(d.setNumber)} of ${d.exerciseName}`;
    case 'adjust_pending_sets':
    case 'set_next_session_targets':
    case 'propose_next_workout_change':
    case 'update_routine':
    case 'undo':
      return renderActionResult(target, 'sheet').text.replace(/\.$/, '').slice(0, 200);
    case 'fit_today':
      return `the fit to ${String(d.minutes)} min`;
    case 'build_workout':
      return `version ${String(d.versionN)} of ${d.name}`;
  }
}

const UNDO_FAILURE: Record<Extract<CoachUndoResult, { status: 'not_possible' }>['reason'], string> = {
  missing: 'it isn’t saved',
  not_committed: 'it was never applied',
  already_undone: 'it was already undone',
  changed_since: 'it changed since',
  gym_changed: 'gym changed',
  unsupported: 'this change can’t be undone here yet',
};

/**
 * The operation ID of Ben's Undo of one action, from any surface (banner,
 * card, Summary). An action is undone at most once, so every Undo tap on it
 * is the same intent: a double tap, or a tap on the sheet after the banner's,
 * replays the first instead of reporting `already undone`.
 */
export function undoOpId(actionId: string): string {
  return `undo:${actionId}`;
}

/**
 * The operation ID of one tap on a `Next time` row: the same tap on the same
 * version of the row is one intent (a double tap replays); after the row
 * moves on, a tap is a new one.
 */
export function nextTargetTapOpId(row: Pick<NextSessionTargetRecord, 'id' | 'version'>, tap: NextTargetTap): string {
  return `next-tap:${row.id}:${String(row.version)}:${tap}`;
}

/**
 * Undo one coach action from its card. `opId` is the tap's own operation ID,
 * so a double tap undoes once. A refused undo is returned as a record that
 * isn't saved (`Couldn't undo: …`), never as a sentence claiming it worked.
 */
export async function undoCoachAction(store: UndoStore, input: { ownerId: string; actionId: string; opId: string; now: ZonedTimestamp }): Promise<{ undo: ActionRecord; result: CoachUndoResult }> {
  const target = await store.getAction(input.actionId);
  const detail: ActionDetail = { kind: 'undo', undoneActionId: input.actionId, what: target === null ? 'that change' : undoWhat(target), restored: [], alreadyLogged: [] };
  const undo = newActionRecord({ turnId: '', opId: input.opId, now: input.now }, detail, { author: 'ben' });
  const record = { ...undo, turnId: null };
  const result = await store.undo(input.ownerId, record);
  if (result.status === 'not_possible') return { undo: { ...record, status: 'rejected', failure: UNDO_FAILURE[result.reason] }, result };
  return { undo: result.undo, result };
}

// ---------------------------------------------------------------------------
// Today's sets through the store (C7): the reducer command and the record in one transaction

/** `TodayTargetsPort` over the coach store's `session_command` write (one SQLite transaction). */
export function storeTodayTargets(store: Pick<CoachWriteStore, 'commit'>): TodayTargetsPort {
  return {
    async apply(input) {
      const changes = input.plan.flatMap((e) => e.changes.filter((c) => c.before !== null && c.after !== null).map((c) => ({ setId: c.setId, target: c.after ?? { load: null, reps: null } })));
      const command = {
        type: 'adjust_pending_targets' as const,
        at: input.record.createdAt,
        opId: input.opId,
        expectedVersion: input.expectedVersion,
        actionId: input.record.actionId,
        reason: input.record.reason,
        changes,
        removeSetIds: input.plan.flatMap((e) => (e.removed === null ? [] : [e.removed.setId])),
        addSets: input.plan.flatMap((e) => (e.added === null ? [] : [{ newSetId: e.added.setId, copyFromSetId: e.added.copyFromSetId, target: e.added.after }])),
      };
      const r = await store.commit(input.ownerId, { kind: 'session_command', action: input.record, sessionId: input.sessionId, command });
      if (r.status === 'conflict') return { status: 'stale' };
      return { status: r.status, record: r.action };
    },
  };
}

/** The operation ID of Ben's `Adjust` on the built-in rule's offer: one per trigger, so a double tap applies once. */
export function builtInAdjustOpId(triggerId: string): string {
  return `built-in-adjust:${triggerId}`;
}

/**
 * The built-in rule's change to today's remaining sets (CA6 revised, build
 * 108 F2), applied on Ben's `Adjust` when the coach can't answer. The same
 * write as the coach's (`adjust_pending_targets`, version-gated, idempotent
 * on the opId, one transaction with its record), so the same Undo works.
 * The record's author is `checks` (app code, not the coach) and its reason
 * is the rule's own app text; each changed target is `source: 'built_in_rule'`.
 */
export async function applyBuiltInAdjustment(
  store: Pick<CoachWriteStore, 'commit'>,
  input: { ownerId: string; sessionId: string; adjustment: SessionAdjustment; opId: string; now: ZonedTimestamp },
): Promise<TodayTargetsWriteResult> {
  const a = input.adjustment;
  const exercises: ExerciseTargetChanges[] = a.plan.map((e) => ({ sessionExerciseId: e.sessionExerciseId, exerciseName: e.exerciseName, changes: e.changes }));
  const base = newActionRecord({ turnId: '', opId: input.opId, now: input.now }, { kind: 'adjust_pending_sets', sessionId: input.sessionId, exercises }, {
    author: 'checks',
    guardNotes: a.guardNotes,
    entityVersions: [{ entity: 'session', id: input.sessionId, before: a.args.baseVersion, after: a.args.baseVersion + 1 }],
  });
  // The rule's reason is app text, not a coach sentence, so the claim check (CC3) doesn't apply to it.
  const record: ActionRecord = { ...base, turnId: null, reason: a.reason };
  const command = {
    type: 'adjust_pending_targets' as const,
    at: input.now,
    opId: input.opId,
    expectedVersion: a.args.baseVersion,
    actionId: record.actionId,
    reason: a.reason,
    rule: a.rule,
    changes: a.plan.flatMap((e) => e.changes.flatMap((c) => (c.before !== null && c.after !== null ? [{ setId: c.setId, target: c.after }] : []))),
    removeSetIds: [],
    addSets: [],
  };
  const r = await store.commit(input.ownerId, { kind: 'session_command', action: record, sessionId: input.sessionId, command });
  if (r.status === 'conflict') return { status: 'stale' };
  return { status: r.status, record: r.action };
}

/** `get_active_session`: the workout read fresh, with set IDs and the version a change must name. */
export function createSessionReadExecutor(deps: { loadSession(): Promise<SessionAggregate | null>; gymName: string | null; ruleTargetRpe?: (s: SessionAggregate) => Promise<Readonly<Record<string, number>>> }): ToolExecutor {
  return async (call) => {
    if (call.tool !== 'get_active_session') throw new TypeError(call.tool);
    const s = await deps.loadSession();
    return { kind: 'read', data: s === null ? { workout: null } : { workout: workoutView(s, deps.gymName, deps.ruleTargetRpe ? await deps.ruleTargetRpe(s).catch(() => undefined) : undefined) } };
  };
}

// ---------------------------------------------------------------------------
// Next-session targets (C8, D21)

export interface NextTargetsDeps {
  store: CoachWriteStore;
  /** The finished workout this summary turn is about; the only source the tool may name. */
  source: SessionAggregate;
  /** `nextSessionBases` with the built-in rule's plan. */
  bases: readonly NextSessionBasis[];
  painFlags(): Promise<readonly PainFlag[]>;
  gymName: string | null;
  /** `Push A`, or the workout's title. */
  workoutLabel: string;
  /** Ben asked for more sets or volume in this conversation (D1). */
  benAskedForMoreSets: boolean;
}

/** One row per source workout and exercise, so a later answer replaces it rather than adding a second. */
export const nextTargetRowId = (sourceSessionId: string, exerciseId: string): string => deriveId(`next-target:${sourceSessionId}:${exerciseId}`);

/**
 * `set_next_session_targets`: validated (snap, cap, pain), classified (CA8),
 * then the small rows saved and the bigger ones kept as proposals, with one
 * record, in one transaction. A workout started from this source since, or
 * an edit to it, makes the answer stale (CA10, rule 5).
 */
export function createNextTargetsExecutor(deps: NextTargetsDeps): ToolExecutor {
  return async (call, ctx) => {
    if (call.tool !== 'set_next_session_targets') throw new TypeError(call.tool);
    const a = call.args;
    const label = deps.workoutLabel;
    const refuse = async (status: 'stale' | 'rejected', failure: string | null, guardNotes: GuardNote[] = []): Promise<ToolResult> => {
      const detail: ActionDetail = { kind: 'set_next_session_targets', sourceSessionId: deps.source.session.id, workoutLabel: label, rows: [] };
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status, failure, guardNotes }) });
      if (r.status === 'conflict') throw new Error('Could not record the refused next targets');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    };
    if (a.sourceSessionId !== deps.source.session.id) return refuse('rejected', 'it named a different workout');
    if (a.sourceVersion !== deps.source.session.version) return refuse('stale', null);
    const v = validateNextSessionTargets({ source: deps.source, bases: deps.bases, targets: a.targets, painFlags: await deps.painFlags(), gymName: deps.gymName, ctx: { benAskedForMoreSets: deps.benAskedForMoreSets } });
    const notes = [...v.rows.flatMap((r) => r.guardNotes.map((n) => ({ ...n, text: `${r.exerciseName}: ${n.text}` }))), ...v.dropped];
    if (v.rows.length === 0) return refuse('rejected', v.dropped[0]?.text.replace(/\.$/, '').slice(0, 200) ?? 'no change from the built-in rule', notes);
    const lastSets = (exerciseId: string): number | null => deps.bases.find((b) => b.exercise.exerciseId === exerciseId)?.lastSets ?? null;
    const detail: ActionDetail = {
      kind: 'set_next_session_targets',
      sourceSessionId: deps.source.session.id,
      workoutLabel: label,
      rows: v.rows.map((r) => ({
        exerciseId: r.exerciseId,
        exerciseName: r.exerciseName,
        before: r.builtIn,
        after: r.after,
        setsBefore: r.builtInSets ?? lastSets(r.exerciseId),
        setsAfter: r.sets,
        size: r.size,
      })),
    };
    const anySmall = v.rows.some((r) => r.size === 'small');
    const reason = v.rows.map((r) => r.reason).find((x) => !isChangeClaim(x)) ?? null;
    const record = newActionRecord(ctx, detail, {
      status: anySmall ? 'committed' : 'proposed',
      reason,
      guardNotes: notes,
      entityVersions: [{ entity: 'session', id: deps.source.session.id, before: deps.source.session.version, after: deps.source.session.version }],
    });
    const rows: NextSessionTargetRecord[] = v.rows.map((r) => ({
      id: nextTargetRowId(deps.source.session.id, r.exerciseId),
      ownerId: ctx.ownerId,
      version: 1,
      createdAtUtc: ctx.now.utc,
      updatedAtUtc: ctx.now.utc,
      sourceSessionId: deps.source.session.id,
      sourceVersion: deps.source.session.version,
      sourceBasis: nextTargetSourceBasis(deps.source),
      exerciseId: r.exerciseId,
      exerciseName: r.exerciseName,
      actionId: record.actionId,
      target: r.after,
      sets: r.sets,
      builtIn: r.builtIn,
      builtInSets: r.builtInSets,
      size: r.size,
      status: r.size === 'small' ? 'saved' : 'proposed',
      reason: isChangeClaim(r.reason) ? null : r.reason.slice(0, 240),
      guardNotes: r.guardNotes,
      pctChange: r.pctChange,
      usedBySessionId: null,
    }));
    const w = await deps.store.commit(ctx.ownerId, { kind: 'next_session_targets', action: record, rows, sourceVersion: deps.source.session.version, sourceBasis: nextTargetSourceBasis(deps.source) });
    if (w.status === 'conflict') return refuse(w.reason === 'stale_version' ? 'stale' : 'rejected', w.reason === 'stale_version' ? null : 'the workout wasn’t found', notes);
    return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
  };
}

export type NextTargetTap = 'undo' | 'use_coach' | 'apply' | 'not_now';

/**
 * The record of Ben's tap on a `Next time` row (his own action, author
 * `ben`): Undo is an undo of the coach's target for that exercise; `Use
 * coach target` and `Apply` save the coach's target as his choice.
 */
export function nextTargetTapRecord(row: NextSessionTargetRecord, tap: NextTargetTap, input: { opId: string; now: ZonedTimestamp }): { status: NextSessionTargetRecord['status']; record: ActionRecord } {
  const ctx = { turnId: '', opId: input.opId, now: input.now };
  const label = row.exerciseName;
  if (tap === 'undo' || tap === 'not_now') {
    const detail: ActionDetail = { kind: 'undo', undoneActionId: row.actionId, what: `the coach's ${label} target for next time`, restored: [], alreadyLogged: [] };
    return { status: tap === 'undo' ? (row.status === 'applied' ? 'proposed' : 'undone') : 'not_applied', record: { ...newActionRecord(ctx, detail, { author: 'ben' }), turnId: null } };
  }
  const detail: ActionDetail = {
    kind: 'set_next_session_targets',
    sourceSessionId: row.sourceSessionId,
    workoutLabel: label,
    rows: [{ exerciseId: row.exerciseId, exerciseName: row.exerciseName, before: row.builtIn, after: row.target, setsBefore: row.builtInSets, setsAfter: row.sets, size: 'small' }],
  };
  return { status: tap === 'apply' ? 'applied' : 'saved', record: { ...newActionRecord(ctx, detail, { author: 'ben' }), turnId: null } };
}

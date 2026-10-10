import { deriveId, validateTodayAdjustment, type AdjustIntent, type ExerciseAdjustmentPlan, type MessagePain } from '@fizz/domain';
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
  PainArea,
  PainFlag,
  SessionAggregate,
  ZonedTimestamp,
} from '@fizz/schemas';
import { isChangeClaim } from './claims';
import { renderActionResult } from './render';
import { appendContentKeys } from './tool-call';

/**
 * Tool executors (ADR 0019 §2, §5; slice C4). Each one turns a parsed,
 * gated tool call into either read data or an `ActionRecord` committed with
 * its change through the store, in one transaction, idempotent on the opId.
 * Deterministic code decides every number: `validateTodayAdjustment` snaps,
 * caps and blocks; the model's arguments are only a request.
 *
 * A tool with no executor in this build is withheld from the turn (it is
 * never offered to the model), so the coach can't call something the app
 * can't do. In this build that is: `set_next_session_targets` and
 * `propose_next_workout_change` (C8), the history / equipment / built-in
 * rule reads until the app wires their ports, and `adjust_pending_sets`
 * until the session's `adjust_pending_targets` command exists (needs
 * `claude/active-set`); `createAdjustExecutor` is ready for that port.
 */

export type ToolResult =
  | { kind: 'read'; data: unknown; earlier?: readonly ActionRecord[] }
  | { kind: 'action'; record: ActionRecord; replayed: boolean };

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
      const candidateId = deriveId(`coach-playbook:${ctx.opId}`);
      const contentKey = appendContentKeys(call)[0] ?? `playbook_candidate:${candidateId}`;
      const detail: ActionDetail = { kind: 'add_playbook_candidate', candidateId, text: call.args.text };
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
            text: call.args.text,
            contentKey,
            statedBy: call.args.statedBy,
            status: 'to_review',
            createdByActionId: actionIdFor(ctx.opId),
          },
        },
        () => newActionRecord({ ...ctx, opId: `${ctx.opId}:refused` }, detail, { status: 'rejected', failure: 'it is already waiting for review' }),
      );
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
  const t = outcome.replace(/\s*(?:Nothing changed|Sets unchanged)\.?\s*$/i, '').replace(/[.\s]+$/, '');
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
    const result = validateTodayAdjustment({
      aggregate: agg,
      args: call.args,
      intent: ctx.intent,
      opId: ctx.opId,
      painFlags: await deps.painFlags(),
      sessionPainUnspecified: deps.sessionPainUnspecified,
      gymName: deps.gymName,
      messagePain: ctx.messagePain,
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
    case 'forget_memory':
      return `forgetting “${d.text}”`;
    case 'set_pain_flag':
      return `the pain flag on ${d.exerciseNames.join(' and ')}`;
    case 'add_playbook_candidate':
      return 'the playbook suggestion';
    case 'adjust_pending_sets':
    case 'set_next_session_targets':
    case 'propose_next_workout_change':
    case 'undo':
      return renderActionResult(target, 'sheet').text.replace(/\.$/, '').slice(0, 200);
  }
}

const UNDO_FAILURE: Record<Extract<CoachUndoResult, { status: 'not_possible' }>['reason'], string> = {
  missing: 'it isn’t saved',
  not_committed: 'it was never applied',
  already_undone: 'it was already undone',
  changed_since: 'it changed since',
  unsupported: 'this change can’t be undone here yet',
};

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

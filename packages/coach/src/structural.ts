import { checkStructuralProposal, type StructuralExerciseInfo, type StructuralSlot, type SubstitutionOption } from '@fizz/domain';
import type { ActionDetail, ActionRecord, DraftBasis, GuardNote, PainFlag, ZonedTimestamp } from '@fizz/schemas';
import { isChangeClaim } from './claims';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolExecutor, type ToolResult } from './executors';

/**
 * Structural proposals (ADR 0020 §3, coach-contract CC10, CLAUDE.md rule 3):
 * `propose_next_workout_change` and its read companion `get_substitutions`.
 *
 * The tool is only offered when Ben asked for a swap or variety in this turn,
 * or something changed (a pain flag since that workout, its equipment
 * changed): the gate is `buildTurnRegistry` with the app's
 * `getStructuralChangeSignals`. The executor checks the request against the
 * plan the next workout starts from (`checkStructuralProposal`) and saves a
 * **proposal**: nothing changes until Ben taps Apply on the card. Apply,
 * Not now and Undo are Ben's own records (`structuralApplyRecord`).
 */

export interface StructuralBasis {
  basis: DraftBasis;
  /** The routine's version (routine basis); absent for the next session from a workout. */
  basisVersion: number | null;
  /** `Push A`, or the workout's name. */
  label: string;
  /** The plan the next workout starts from, in order. */
  slots: StructuralSlot[];
}

export interface StructuralDeps {
  store: CoachWriteStore;
  /**
   * What the next workout from this one starts from, with the source
   * workout's version. Null when the workout isn't Ben's or has nothing to
   * build from.
   */
  basisFor(sourceSessionId: string): Promise<{ sourceVersion: number; basis: StructuralBasis } | null>;
  exercise(exerciseId: string): Promise<StructuralExerciseInfo | null>;
  doable(exerciseId: string): Promise<boolean>;
  painFlags(): Promise<readonly PainFlag[]>;
  /** `get_substitutions`: options for one exercise at the gym in context. */
  substitutions(exerciseId: string): Promise<SubstitutionOption[] | null>;
}

const NO_SOURCE = '00000000-0000-4000-8000-000000000000';

function noteKind(kind: 'structural_dropped' | 'pain_blocked' | 'no_equipment'): GuardNote['kind'] {
  return kind;
}

export function createStructuralExecutors(deps: StructuralDeps): CoachExecutors {
  const propose: ToolExecutor = async (call, ctx): Promise<ToolResult> => {
    if (call.tool !== 'propose_next_workout_change') throw new TypeError(call.tool);
    const a = call.args;
    const found = await deps.basisFor(a.sourceSessionId);
    const label = found?.basis.label ?? 'workout';
    const refuse = async (status: 'stale' | 'rejected', failure: string | null, guardNotes: GuardNote[] = []): Promise<ToolResult> => {
      const detail: ActionDetail = {
        kind: 'propose_next_workout_change',
        sourceSessionId: found === null ? NO_SOURCE : a.sourceSessionId,
        workoutLabel: label,
        changes: [{ change: a.changes[0]?.change ?? 'swap', text: 'No change' }],
        because: 'Not proposed',
      };
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status, failure, guardNotes }) });
      if (r.status === 'conflict') throw new Error('Could not record the refused proposal');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    };
    if (found === null) return refuse('rejected', 'that workout can’t be the start of the next one');
    if (a.sourceVersion !== found.sourceVersion) return refuse('stale', null);
    const ids = new Set<string>([...found.basis.slots.map((s) => s.exerciseId), ...a.changes.flatMap((c) => (c.change === 'swap' ? [c.fromExerciseId, c.toExerciseId] : c.change === 'reorder' ? c.exerciseIds : [c.exerciseId]))]);
    const info = new Map<string, StructuralExerciseInfo | null>();
    const doable = new Map<string, boolean>();
    for (const id of ids) {
      info.set(id, await deps.exercise(id));
      doable.set(id, await deps.doable(id));
    }
    const flagged = new Set((await deps.painFlags()).filter((f) => f.status === 'active').map((f) => f.exerciseId));
    const check = checkStructuralProposal({
      slots: found.basis.slots,
      changes: a.changes,
      exercise: (id) => info.get(id) ?? null,
      doable: (id) => doable.get(id) ?? false,
      painFlagged: flagged,
    });
    const notes: GuardNote[] = check.notes.map((n) => ({ kind: noteKind(n.kind), setIds: [], text: n.text }));
    if (check.status === 'rejected') return refuse('rejected', check.failure.charAt(0).toLowerCase() + check.failure.slice(1), notes);
    const reason = isChangeClaim(a.reason) ? null : a.reason;
    const detail: ActionDetail = {
      kind: 'propose_next_workout_change',
      sourceSessionId: a.sourceSessionId,
      workoutLabel: label,
      changes: check.lines,
      because: (reason ?? 'Suggested by the coach.').slice(0, 200),
      basis: found.basis.basis,
      ...(found.basis.basisVersion === null ? {} : { basisVersion: found.basis.basisVersion }),
      ops: check.ops,
      before: check.before,
      after: check.after,
    };
    const record = newActionRecord(ctx, detail, { status: 'proposed', reason, guardNotes: notes });
    const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: record });
    if (r.status === 'conflict') throw new Error('Could not record the proposal');
    return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
  };

  return {
    propose_next_workout_change: propose,
    get_substitutions: async (call) => {
      if (call.tool !== 'get_substitutions') throw new TypeError(call.tool);
      const options = await deps.substitutions(call.args.exerciseId);
      return { kind: 'read', data: options === null ? { domain: 'Your data', not_available: 'no such exercise or no gym' } : { domain: 'Your data', options } };
    },
  };
}

/** The op ID of Ben's tap on a proposal card: one Apply and one Not now per proposal, so a double tap is one write. */
export function proposalTapOpId(proposalId: string, tap: 'apply' | 'not_now'): string {
  return `${tap}:${proposalId}`;
}

/**
 * Ben's own record of a tap on a structural proposal (author `ben`, no
 * turn): `apply` is a committed copy of the proposal that the next
 * workout's overview writes into its draft and that Undo reverses until
 * that workout starts; `not_now` is a rejected copy.
 */
export function structuralTapRecord(proposal: ActionRecord, tap: 'apply' | 'not_now', input: { now: ZonedTimestamp }): ActionRecord {
  if (proposal.detail.kind !== 'propose_next_workout_change') throw new TypeError('not a structural proposal');
  const opId = proposalTapOpId(proposal.actionId, tap);
  const detail: ActionDetail = { ...proposal.detail, proposalId: proposal.actionId };
  const record = newActionRecord({ turnId: '', opId, now: input.now }, detail, {
    author: 'ben',
    status: tap === 'apply' ? 'committed' : 'rejected',
    failure: tap === 'apply' ? null : 'not now',
    reason: proposal.reason,
    evidenceRefs: [proposal.actionId],
  });
  return { ...record, turnId: null };
}

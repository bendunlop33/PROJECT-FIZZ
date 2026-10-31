import { checkCoachAdd, coachAddRowId, exercisesLooselyNamedIn, exercisesNamedIn, type CoachAddInput } from '@fizz/domain';
import type { ActionDetail, SessionAggregate } from '@fizz/schemas';
import type { AddableExercise } from './context';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * Coach v3 (ADR 0027): the list of what can be added goes on every live-workout turn (no word
 * gate), so it is kept short: about 60 entries (≈ 1.8k tokens).
 */
export const ADDABLE_CAP = 60;

/**
 * The first `cap` addable exercises, the ones Ben's words name (in full, then loosely) ahead of the
 * rest, in the list's own order (by name). Pure; the words are data (rule 8).
 */
export function capAddable(list: readonly AddableExercise[], words: string, cap = ADDABLE_CAP): AddableExercise[] {
  if (list.length <= cap) return [...list];
  const named = list.map((a) => ({ exerciseId: a.exerciseId, exerciseName: a.name }));
  const first = new Set([...exercisesNamedIn(words, named), ...exercisesLooselyNamedIn(words, named)]);
  const keep = new Set([...list.filter((a) => first.has(a.exerciseId)), ...list.filter((a) => !first.has(a.exerciseId))].slice(0, cap).map((a) => a.exerciseId));
  return list.filter((a) => keep.has(a.exerciseId));
}

/**
 * `add_exercise_today` (12 Oct; Ben: "Why can't the ChatGPT link create sets
 * in the app?"). Offered on every live-workout turn with the list of what can
 * be added (Coach v3); it applies only when Ben asked (`verifyAsked`). The domain check
 * (`checkCoachAdd`) validates the call against the workout's gym, pain flags
 * and Ben's exercises, plans loads from his history through the shared fit,
 * and builds the workout's own `add_exercise` command; the store runs it with
 * the record in one transaction, refused when the workout moved on since the
 * coach read it (rule 5), idempotent on the opId. It applies at once because
 * Ben asked (rule 3), shows as a card, and Undo takes the row out again while
 * nothing on it is done (`undo_op`; rule 2).
 */

export interface AddExerciseDeps {
  store: CoachWriteStore;
  /** The active workout as it is now (read fresh for each call). */
  loadSession(): Promise<SessionAggregate | null>;
  /**
   * Local reads for one `exerciseId` (a catalogue ID or Ben's exercise's ID)
   * at the workout's current gym: the exercise, its history, the substitute
   * context (items, pain flags, check-in pain) and Ben's profile. Reads
   * only: a catalogue exercise not yet in Ben's exercises comes back with
   * `exerciseUnsaved` and is saved with the add's own write (review S3).
   */
  inputs(exerciseId: string, aggregate: SessionAggregate): Promise<Pick<CoachAddInput, 'exercise' | 'history' | 'substitute' | 'owner' | 'sameMovementIds'> & { exerciseUnsaved?: boolean }>;
  /** After a write: the workout screen and rest alerts follow the new state. */
  onSessionChanged?: (aggregate: SessionAggregate) => void;
}

const NO_ID = '00000000-0000-4000-8000-000000000000';

export function createAddExerciseExecutor(deps: AddExerciseDeps): CoachExecutors {
  return {
    add_exercise_today: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'add_exercise_today') throw new TypeError(call.tool);
      const aggregate = await deps.loadSession();
      const got = aggregate === null ? null : await deps.inputs(call.args.exerciseId, aggregate);
      const sessionId = aggregate?.session.id ?? NO_ID;
      const refusedDetail = (name: string | null): ActionDetail => ({
        kind: 'add_exercise_today',
        sessionId,
        sessionExerciseId: coachAddRowId(ctx.opId),
        exerciseId: got?.exercise?.id ?? null,
        exerciseName: (name ?? got?.exercise?.name ?? 'that exercise').slice(0, 120),
        sets: 0,
        target: null,
        durationS: null,
        equipmentName: null,
        afterName: null,
        supersetWithName: null,
      });
      const record = async (status: 'stale' | 'rejected', failure: string | null, detail: ActionDetail, opId = ctx.opId, guardNotes: ReturnType<typeof checkCoachAdd>['guardNotes'] = []): Promise<ToolResult> => {
        const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord({ ...ctx, opId }, detail, { status, failure, guardNotes, reason: call.args.reason }) });
        if (r.status === 'conflict') throw new Error('Could not record the refused add');
        return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
      };
      if (aggregate === null || got === null) return record('stale', null, refusedDetail(null));
      const { exerciseUnsaved, ...checkInputs } = got;
      const check = checkCoachAdd({ aggregate, args: call.args, ...checkInputs, opId: ctx.opId, at: ctx.now });
      if (check.status !== 'ok') return record(check.status, check.status === 'rejected' ? check.failure : null, refusedDetail(check.exerciseName), ctx.opId, check.guardNotes);
      const s = check.summary;
      const detail: ActionDetail = {
        kind: 'add_exercise_today',
        sessionId,
        sessionExerciseId: s.sessionExerciseId,
        exerciseId: s.exerciseId,
        exerciseName: s.exerciseName,
        sets: s.sets,
        target: s.target,
        durationS: s.durationS,
        ...(s.distanceM !== undefined ? { distanceM: s.distanceM } : {}),
        equipmentName: s.equipmentName,
        afterName: s.afterName,
        supersetWithName: s.supersetWithName,
      };
      const action = newActionRecord(ctx, detail, {
        reason: call.args.reason,
        guardNotes: check.guardNotes,
        entityVersions: [{ entity: 'session', id: sessionId, before: call.args.baseVersion, after: call.args.baseVersion + 1 }],
      });
      const w = await deps.store.commit(ctx.ownerId, { kind: 'session_command', action, sessionId, command: check.command, expectedSessionVersion: call.args.baseVersion, ...(exerciseUnsaved === true && got.exercise !== null ? { saveExercise: got.exercise } : {}) });
      if (w.status === 'conflict') {
        // Nothing was written: the workout moved on between the check and the write (a Log tap), or the workout refused it.
        const stale = w.reason === 'stale_version';
        return record(stale ? 'stale' : 'rejected', stale ? null : 'the workout refused it', detail, `${ctx.opId}:refused`, check.guardNotes);
      }
      if (w.status === 'written') {
        const fresh = await deps.loadSession().catch(() => null);
        if (fresh !== null) deps.onSessionChanged?.(fresh);
      }
      return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
    },
  };
}

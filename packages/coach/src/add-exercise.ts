import { checkCoachAdd, coachAddRowId, type CoachAddInput } from '@fizz/domain';
import type { ActionDetail, SessionAggregate } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * `add_exercise_today` (12 Oct; Ben: "Why can't the ChatGPT link create sets
 * in the app?"). Offered only in a workout turn whose words ask for it
 * (`add` / `change` request kinds, `registry.ts`). The domain check
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
   * context (items, pain flags, check-in pain) and Ben's profile.
   */
  inputs(exerciseId: string, aggregate: SessionAggregate): Promise<Pick<CoachAddInput, 'exercise' | 'history' | 'substitute' | 'owner'>>;
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
      const check = checkCoachAdd({ aggregate, args: call.args, ...got, opId: ctx.opId, at: ctx.now });
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
        equipmentName: s.equipmentName,
        afterName: s.afterName,
        supersetWithName: s.supersetWithName,
      };
      const action = newActionRecord(ctx, detail, {
        reason: call.args.reason,
        guardNotes: check.guardNotes,
        entityVersions: [{ entity: 'session', id: sessionId, before: call.args.baseVersion, after: call.args.baseVersion + 1 }],
      });
      const w = await deps.store.commit(ctx.ownerId, { kind: 'session_command', action, sessionId, command: check.command, expectedSessionVersion: call.args.baseVersion });
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

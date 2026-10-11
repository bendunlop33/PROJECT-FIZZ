import { checkChatCorrection, checkChatLog, type ChatSetCheck } from '@fizz/domain';
import type { ActionDetail, SessionAggregate } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * Log or correct a set from chat (backlog §4.3, coach-sheet §2.7, CS5; Ben
 * accepted 11 Oct): `log_set` and `correct_set`. Only offered when Ben's own
 * words ask for it in this turn (`log` / `correct` request kinds). The
 * domain check (`checkChatLog`, `checkChatCorrection`) builds the workout's
 * own `log_set` / `correct_set` command; the store runs it with the record in
 * one transaction (rule 5), idempotent on the opId. Undo is Ben's tap
 * (`undo_log`, or a correction back), refused once the set changed.
 */

export interface ChatSetDeps {
  store: CoachWriteStore;
  loadSession(): Promise<SessionAggregate | null>;
  /** After a write: rest alerts follow the logged set (the Log button's path does the same). */
  onSessionChanged?: (aggregate: SessionAggregate) => void;
}

const NO_ID = '00000000-0000-4000-8000-000000000000';

export function createChatSetExecutors(deps: ChatSetDeps): CoachExecutors {
  const run = async (kind: 'log_set' | 'correct_set', args: { baseVersion: number; setId: string; load: ActionDetailLoad; reps: number | null; rpe: number | null }, ctx: Parameters<NonNullable<CoachExecutors['log_set']>>[1]): Promise<ToolResult> => {
    const aggregate = await deps.loadSession();
    const input = { aggregate, baseVersion: args.baseVersion, setId: args.setId, load: args.load, reps: args.reps, rpe: args.rpe, benWords: ctx.benWords, opId: ctx.opId, at: ctx.now };
    const check: ChatSetCheck = kind === 'log_set' ? checkChatLog(input) : checkChatCorrection(input);
    const sessionId = aggregate?.session.id ?? NO_ID;
    const values = { load: args.load, reps: args.reps, rpe: args.rpe };
    if (check.status !== 'ok') {
      const base = { sessionId, setId: args.setId, exerciseName: check.exerciseName ?? 'Exercise', setNumber: check.setNumber ?? 1, setVersionAfter: null };
      const detail: ActionDetail = kind === 'log_set' ? { kind, ...base, values } : { kind, ...base, before: values, after: values };
      const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, detail, { status: check.status, failure: check.status === 'stale' ? null : check.failure }) });
      if (r.status === 'conflict') throw new Error('Could not record the refused set write');
      return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
    }
    const base = { sessionId, setId: args.setId, exerciseName: check.exerciseName, setNumber: check.setNumber, setVersionAfter: check.setVersionAfter };
    const detail: ActionDetail = kind === 'log_set' ? { kind, ...base, values: check.after } : { kind, ...base, before: check.before, after: check.after };
    const record = newActionRecord(ctx, detail, { entityVersions: [{ entity: 'session', id: sessionId, before: args.baseVersion, after: args.baseVersion + 1 }] });
    const r = await deps.store.commit(ctx.ownerId, { kind: 'session_command', action: record, sessionId, command: check.command });
    if (r.status === 'conflict') {
      // The set changed between the check and the write (a Log tap): nothing was written.
      const stale = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord({ ...ctx, opId: `${ctx.opId}:stale` }, { ...detail, setVersionAfter: null }, { status: 'stale' }) });
      if (stale.status === 'conflict') throw new Error('Could not record the stale set write');
      return { kind: 'action', record: stale.action, replayed: stale.status === 'replayed' };
    }
    if (r.status === 'written') {
      const fresh = await deps.loadSession().catch(() => null);
      if (fresh !== null) deps.onSessionChanged?.(fresh);
    }
    return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
  };
  return {
    log_set: (call, ctx) => {
      if (call.tool !== 'log_set') throw new TypeError(call.tool);
      return run('log_set', call.args, ctx);
    },
    correct_set: (call, ctx) => {
      if (call.tool !== 'correct_set') throw new TypeError(call.tool);
      return run('correct_set', call.args, ctx);
    },
  };
}

type ActionDetailLoad = Extract<ActionDetail, { kind: 'log_set' }>['values']['load'];

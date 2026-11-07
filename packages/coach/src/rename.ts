import { reduceSession } from '@fizz/domain';
import type { ActionDetail, SessionAggregate } from '@fizz/schemas';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * `rename_workout` (14 Oct; Ben, build 151: "Change name of workout to …").
 * The workout's own `rename_session` command, versioned on the session
 * (rule 5) and idempotent on the opId, written with its record in one
 * transaction. It applies at once only when Ben asked; the turn turns an
 * unasked call into an offer (rule 3). Undo names it back while the name is
 * still the coach's. The reducer's own rules stand: an open-ended workout in
 * progress can't be named until it's finished (audit B1), and the routine
 * keeps its name.
 */

export interface RenameDeps {
  store: CoachWriteStore;
  /** The active workout as it is now (read fresh for each call). */
  loadSession(): Promise<SessionAggregate | null>;
  onSessionChanged?: (aggregate: SessionAggregate) => void;
}

const NO_ID = '00000000-0000-4000-8000-000000000000';

const lowerFirst = (t: string): string => t.charAt(0).toLowerCase() + t.slice(1);

export function createRenameExecutor(deps: RenameDeps): CoachExecutors {
  return {
    rename_workout: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'rename_workout') throw new TypeError(call.tool);
      const agg = await deps.loadSession();
      const name = call.args.name.replace(/\s+/g, ' ').trim().slice(0, 120);
      const detail: ActionDetail = { kind: 'rename_workout', sessionId: agg?.session.id ?? NO_ID, before: agg?.session.routineName ?? null, after: name === '' ? 'Workout' : name };
      const record = async (status: 'stale' | 'rejected', failure: string | null, opId = ctx.opId): Promise<ToolResult> => {
        const r = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord({ ...ctx, opId }, detail, { status, failure }) });
        if (r.status === 'conflict') throw new Error('Could not record the refused rename');
        return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
      };
      if (agg === null || agg.session.status !== 'active') return record('stale', null);
      if (name === '') return record('rejected', 'no name given');
      if (agg.session.version !== call.args.baseVersion) return record('stale', null);
      if (agg.session.routineName === name) return record('rejected', 'it already has that name');
      const command = { type: 'rename_session' as const, at: ctx.now, opId: ctx.opId, name, expectedVersion: call.args.baseVersion };
      // The workout's own rules first, so a refusal says why (an open-ended workout is named after Finish).
      const check = reduceSession(agg, command);
      if (!check.ok) return record(check.error.code === 'stale_version' ? 'stale' : 'rejected', check.error.code === 'stale_version' ? null : lowerFirst(check.error.message.replace(/\.$/, '')).slice(0, 200));
      const action = newActionRecord(ctx, detail, { entityVersions: [{ entity: 'session', id: agg.session.id, before: call.args.baseVersion, after: call.args.baseVersion + 1 }] });
      const w = await deps.store.commit(ctx.ownerId, { kind: 'session_command', action, sessionId: agg.session.id, command, expectedSessionVersion: call.args.baseVersion });
      if (w.status === 'conflict') return record('stale', null, `${ctx.opId}:refused`);
      if (w.status === 'written') {
        const fresh = await deps.loadSession().catch(() => null);
        if (fresh !== null) deps.onSessionChanged?.(fresh);
      }
      return { kind: 'action', record: w.action, replayed: w.status === 'replayed' };
    },
  };
}

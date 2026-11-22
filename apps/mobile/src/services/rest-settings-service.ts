import { restSettingsChange, restSettingsOf } from '@fizz/domain';
import type { ActionRecord, CommandOf, RestSettings, SessionAggregate, SessionCommand, UpdateRestSettingsArgs, ZonedTimestamp } from '@fizz/schemas';
import type { PreparedRestSettings } from '@fizz/coach';

import type { TrainingService } from './training-service';

/**
 * (Ben, 2 Nov) The coach's `update_rest_settings`: Ben's rest settings (Profile › Rest times, `Rest when short on
 * time`, `Shorten main lift too`) from his words. Local, no AI. `prepare` checks the call on the profile as stored
 * (`restSettingsChange`: Rest times' own limits, never rounded); the coach writes it with its record (one versioned
 * write, rule 5) and its Undo is the coach's. `Today too?` (the card) moves the open workout's pending rests that are on
 * the old default to the new one, one `coach_edit_today` under the record's ID with its own Undo (`revert_coach_edit`);
 * done sets and rests Ben set himself never change (rule 2). Nothing is computed in a screen.
 */

export interface RestSettingsServiceDeps {
  training: Pick<TrainingService, 'snapshot'>;
  /** The open workout's rests moved from `before` to `after` (`workout.restSettingsCommand`); null: none open or nothing moves. */
  todayCommand: (change: { before: RestSettings; after: RestSettings }, op: { opId: string; actionId: string; at: ZonedTimestamp }, sessionId?: string) => Promise<{ sessionId: string; command: CommandOf<'coach_edit_today'>; sets: number } | null>;
  dispatch: (sessionId: string, command: SessionCommand) => Promise<{ ok: boolean }>;
  session: (sessionId: string) => Promise<SessionAggregate | null>;
  getAction: (actionId: string) => Promise<ActionRecord | null>;
  now: () => ZonedTimestamp;
}

export const REST_SETTINGS_COPY = { todayToo: 'Today too?', todayDone: 'Today too: done', undo: 'Undo', stale: 'Out of date. Nothing changed.', notUndone: 'Not undone.' } as const;

/** `Today too`'s op on the workout: the same for a double tap or after a restart (rule 5). */
export const restTodayOpId = (actionId: string): string => `rest-today:${actionId}`;
const restTodayUndoOpId = (actionId: string): string => `rest-today-undo:${actionId}`;

/** The card's `Today too?` state: `open` (offered), `done` (applied, Undo), or null (nothing to offer). */
export type RestTodayState = 'open' | 'done' | null;

type RestDetail = Extract<ActionRecord['detail'], { kind: 'update_rest_settings' }>;

export function createRestSettingsService(deps: RestSettingsServiceDeps) {
  async function committed(actionId: string): Promise<{ record: ActionRecord; d: RestDetail } | null> {
    const record = await deps.getAction(actionId).catch(() => null);
    if (record === null || record.detail.kind !== 'update_rest_settings' || record.status !== 'committed') return null;
    return { record, d: record.detail };
  }

  return {
    /** `update_rest_settings`'s checks (the coach): the change on the profile as stored, and whether today has rests it moves. */
    async prepare(args: UpdateRestSettingsArgs, at: { actionId: string; opId: string; nowUtc: string; tz: string }): Promise<{ ok: true; prepared: PreparedRestSettings } | { ok: false; line: string }> {
      const snap = await deps.training.snapshot().catch(() => null);
      if (snap === null) return { ok: false, line: 'Your training details couldn’t be read.' };
      const before = restSettingsOf(snap.profile);
      const c = restSettingsChange(before, { rests: args.rests, whenShort: args.whenShort, shortenMain: args.shortenMain });
      if (c.kind !== 'ok') return { ok: false, line: `${c.line}. Nothing changed.` };
      const today = await deps.todayCommand({ before, after: c.after }, { opId: restTodayOpId(at.actionId), actionId: at.actionId, at: { utc: at.nowUtc, tz: at.tz } }).catch(() => null);
      return {
        ok: true,
        prepared: {
          change: { kind: 'rest_settings', settings: c.after },
          before,
          after: c.after,
          lines: c.lines,
          profileId: snap.profile.id,
          expectedVersion: snap.profile.version,
          today: today === null ? null : { sessionId: today.sessionId, sets: Math.min(200, today.sets) },
        },
      };
    },

    /** The card's `Today too?`: offered while the settings change stands and the workout still has rests it moves. */
    async today(actionId: string): Promise<RestTodayState> {
      const x = await committed(actionId);
      if (x?.d.today == null) return null;
      const agg = await deps.session(x.d.today.sessionId).catch(() => null);
      if (agg === null || agg.session.status !== 'active') return null;
      const op = restTodayOpId(actionId);
      if (agg.processedOps[op] !== undefined) return agg.processedOps[restTodayUndoOpId(actionId)] === undefined ? 'done' : null;
      if (x.record.undoneBy !== null) return null;
      const cmd = await deps.todayCommand({ before: x.d.before, after: x.d.after }, { opId: op, actionId, at: deps.now() }, x.d.today.sessionId).catch(() => null);
      return cmd === null ? null : 'open';
    },

    /** `Today too`: the open workout's rests on the old default move to the new one (one change, its own Undo). */
    async applyToday(actionId: string): Promise<boolean> {
      const x = await committed(actionId);
      if (x?.d.today == null || x.record.undoneBy !== null) return false;
      const cmd = await deps.todayCommand({ before: x.d.before, after: x.d.after }, { opId: restTodayOpId(actionId), actionId, at: deps.now() }, x.d.today.sessionId).catch(() => null);
      if (cmd === null) return false;
      const r = await deps.dispatch(cmd.sessionId, cmd.command).catch(() => ({ ok: false }));
      return r.ok;
    },

    /** Undo of `Today too`: those rests back on sets still pending (a set logged since keeps its rest, rule 2). */
    async undoToday(actionId: string): Promise<boolean> {
      const x = await committed(actionId);
      if (x?.d.today == null) return false;
      const r = await deps
        .dispatch(x.d.today.sessionId, { type: 'revert_coach_edit', at: deps.now(), opId: restTodayUndoOpId(actionId), targetOpId: restTodayOpId(actionId), actionId })
        .catch(() => ({ ok: false }));
      return r.ok;
    },
  };
}

export type RestSettingsService = ReturnType<typeof createRestSettingsService>;

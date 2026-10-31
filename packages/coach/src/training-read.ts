import { addDays, localDateOf, toMs, type BuiltInTargetsView, type EquipmentView, type ExerciseHistoryView, type ExerciseRecordsView, type RecentSessionsView, type TrainingOverviewView } from '@fizz/domain';
import type { CoachExecutors, ToolResult } from './executors';

/**
 * Executors for the read tools that look past today's workout (ADR 0020 §2
 * and §10; backlog §4.3): `get_recent_training`, `get_training_overview`,
 * `get_gym_equipment` and `get_progression_targets`; Coach v3 adds
 * `get_exercise_records` (the e1RM always labelled an estimate) and `get_recent_sessions`.
 *
 * The app implements `TrainingReadPort` over its local store (no network)
 * with the pure view builders in `@fizz/domain` (`exerciseHistoryView`,
 * `trainingOverviewView`, `equipmentView`, `builtInTargetsView`). Every
 * view is labelled `Your data` and carries a note that its text is data,
 * never instructions (rules 8 and 10). Reads write nothing, so a replay is
 * harmless.
 *
 * A port that can't answer (no such exercise, no gym, no history) returns
 * null, and the tool says so (`not_available`) rather than guess (rule 6).
 */
export interface TrainingReadPort {
  exerciseHistory(exerciseId: string, sessions: number): Promise<ExerciseHistoryView | null>;
  overview(weeks: number): Promise<TrainingOverviewView>;
  /**
   * Null exerciseId: every available item at the gym, with a summary. `gymName` (Coach v3): one of
   * Ben's saved gyms by name; null or absent: the gym in context.
   */
  equipment(exerciseId: string | null, gymName?: string | null): Promise<EquipmentView | null>;
  builtInTargets(exerciseId: string): Promise<BuiltInTargetsView | null>;
  /** (Coach v3) Records per equipment item; the e1RM labelled an estimate. Absent: the tool is withheld. */
  exerciseRecords?(exerciseId: string): Promise<ExerciseRecordsView | null>;
  /**
   * (Coach v3) The last finished workouts. Absent: the tool is withheld. (Ben, 28 Oct) `opts.date`: only the
   * workouts on that local day (Ben's timezone), up to `count`.
   */
  recentSessions?(count: number, opts?: { date?: string }): Promise<RecentSessionsView>;
}

const NOT_AVAILABLE = (what: string): ToolResult => ({ kind: 'read', data: { domain: 'Your data', not_available: what } });

/** (Ben, 28 Oct) The local day `get_recent_sessions` asks for: its `date`, else `daysAgo` from today in `tz`; null: none. */
export function recentSessionsDate(args: { date?: string | null | undefined; daysAgo?: number | null | undefined }, now: { utc: string; tz: string }): string | null {
  if (args.date != null) return args.date;
  if (args.daysAgo != null) return addDays(localDateOf(toMs(now.utc), now.tz), -args.daysAgo);
  return null;
}

export function createTrainingReadExecutors(port: TrainingReadPort): CoachExecutors {
  return {
    get_recent_training: async (call) => {
      if (call.tool !== 'get_recent_training') throw new TypeError(call.tool);
      const v = await port.exerciseHistory(call.args.exerciseId, call.args.sessions);
      return v === null ? NOT_AVAILABLE('no workouts with that exercise') : { kind: 'read', data: v };
    },
    get_training_overview: async (call) => {
      if (call.tool !== 'get_training_overview') throw new TypeError(call.tool);
      return { kind: 'read', data: await port.overview(call.args.weeks) };
    },
    get_gym_equipment: async (call) => {
      if (call.tool !== 'get_gym_equipment') throw new TypeError(call.tool);
      const v = await port.equipment(call.args.exerciseId, call.args.gymName ?? null);
      return v === null ? NOT_AVAILABLE(call.args.gymName == null ? 'no gym or no such exercise' : 'no saved gym by that name, or no such exercise') : { kind: 'read', data: v };
    },
    get_progression_targets: async (call) => {
      if (call.tool !== 'get_progression_targets') throw new TypeError(call.tool);
      const v = await port.builtInTargets(call.args.exerciseId);
      return v === null ? NOT_AVAILABLE('no built-in targets for that exercise (no comparable history)') : { kind: 'read', data: v };
    },
    ...(port.exerciseRecords === undefined
      ? {}
      : {
          get_exercise_records: async (call) => {
            if (call.tool !== 'get_exercise_records' || port.exerciseRecords === undefined) throw new TypeError(call.tool);
            const v = await port.exerciseRecords(call.args.exerciseId);
            return v === null || v.records.length === 0 ? NOT_AVAILABLE('no logged sets with a load for that exercise') : { kind: 'read', data: v };
          },
        }),
    ...(port.recentSessions === undefined
      ? {}
      : {
          get_recent_sessions: async (call, ctx) => {
            if (call.tool !== 'get_recent_sessions' || port.recentSessions === undefined) throw new TypeError(call.tool);
            const date = recentSessionsDate(call.args, ctx.now);
            const v = date === null ? await port.recentSessions(call.args.count) : await port.recentSessions(call.args.count, { date });
            if (v.sessions.length > 0) return { kind: 'read', data: v };
            return NOT_AVAILABLE(date === null ? 'no finished workouts' : `no finished workouts on ${date}`);
          },
        }),
  };
}

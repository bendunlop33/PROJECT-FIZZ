import type { BuiltInTargetsView, EquipmentView, ExerciseHistoryView, TrainingOverviewView } from '@fizz/domain';
import type { CoachExecutors, ToolResult } from './executors';

/**
 * Executors for the read tools that look past today's workout (ADR 0020 §2
 * and §10; backlog §4.3): `get_recent_training`, `get_training_overview`,
 * `get_gym_equipment` and `get_progression_targets`.
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
  /** Null exerciseId: every available item at the gym in context. */
  equipment(exerciseId: string | null): Promise<EquipmentView | null>;
  builtInTargets(exerciseId: string): Promise<BuiltInTargetsView | null>;
}

const NOT_AVAILABLE = (what: string): ToolResult => ({ kind: 'read', data: { domain: 'Your data', not_available: what } });

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
      const v = await port.equipment(call.args.exerciseId);
      return v === null ? NOT_AVAILABLE('no gym or no such exercise') : { kind: 'read', data: v };
    },
    get_progression_targets: async (call) => {
      if (call.tool !== 'get_progression_targets') throw new TypeError(call.tool);
      const v = await port.builtInTargets(call.args.exerciseId);
      return v === null ? NOT_AVAILABLE('no built-in targets for that exercise (no comparable history)') : { kind: 'read', data: v };
    },
  };
}

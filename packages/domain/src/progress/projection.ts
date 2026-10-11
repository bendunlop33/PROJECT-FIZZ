import type { EquipmentKind, Laterality, Load, LoadConvention, Measurement, SessionAggregate, SetExclusion, SetSide, SetType, WeightUnit } from '@fizz/schemas';
import { localDateOf } from '../calendar';
import { equipmentOfRow } from '../session/equipment-snapshot';
import { workoutDurationMs } from '../session/view';
import { toMs } from '../time';

/**
 * What Progress reads of one finished workout (progress.md §6): the same
 * projection as `toHistorySessions` (finished only, completed sets with a
 * result, corrections already applied, deleted and skipped rows absent), for
 * every exercise at once, plus the facts the home needs (local date, time in
 * gym, source). Pure, and cheap to keep per session: the service caches one
 * per stored revision and recomputes nothing else when the window changes.
 */

export interface ProgressSet {
  setId: string;
  setType: SetType;
  /** As on `WorkoutSet.side`: `both`, `left`, `right`, or null (bilateral). */
  side: SetSide | null;
  /** Unit and convention travel with the value (kg/lb, total, per hand, stack, added, assistance). */
  load: Load | null;
  reps: number | null;
  durationS: number | null;
  rpe: number | null;
  rir: number | null;
  /** Ben's `Spotted`, `Pain`, `Form broke`, `Other equipment` marks (PG21). Absent = counts. */
  exclusions?: readonly SetExclusion[];
  /** Null on rows imported with no time. */
  completedAtUtc: string | null;
  index: number;
  /** Corrected after logging (`correctSet`): the chart's `Edited` marker (progress.md §3.4). */
  edited?: true;
}

export interface ProgressExercise {
  sessionExerciseId: string;
  exerciseId: string;
  /** The name as logged (a snapshot, so a later rename doesn't rewrite history). */
  exerciseName: string;
  equipmentId: string | null;
  /** The equipment's kind from the workout's snapshot (`plate_loaded_machine` tells plates from `BW +`). */
  equipmentKind: EquipmentKind | null;
  /** The equipment's name from the snapshot (`Barbell`, `Cable stack 2`); null with none. Series labels (slice B). */
  equipmentName?: string | null;
  /** The gym this row was done at (its own gym after a mid-workout switch); null when not recorded. */
  gymId: string | null;
  convention: LoadConvention;
  unit: WeightUnit;
  measurement: Measurement;
  laterality: Laterality;
  /** Completed sets with a result, in the order they were done. */
  sets: readonly ProgressSet[];
}

export interface ProgressSession {
  sessionId: string;
  /** The stored session's content version (Count it binds to it). */
  version: number;
  source: 'manual' | 'import';
  /** The workout's own name (routine or rename); null = none was given. */
  name: string | null;
  gymId: string | null;
  /** UTC start (corrected if edited); an ordering anchor only for date-only imports. */
  startedAtUtc: string;
  startedMs: number;
  /** The session's own zone (for times shown on the calendar). */
  tz: string;
  /** Local date in the owner's zone (PG16), or the imported workout's own date. */
  date: string;
  /** True for a workout with a date and no times (imported, ADR 0016). */
  dateOnly: boolean;
  /** Null when there is no end time (or for a date-only workout). */
  endedAtUtc: string | null;
  /** Start to end minus pauses inside it, exactly the Summary's `Active time`; null with no times or no end. */
  durationMs: number | null;
  /** `Count it` was used on this workout (PG25a). */
  durationConfirmed: boolean;
  exercises: readonly ProgressExercise[];
}

/**
 * Project one stored workout for Progress. Returns null for anything that
 * isn't `finished` (active, discarded, reverted): an unfinished workout is
 * never counted (PG33).
 */
export function toProgressSession(aggregate: SessionAggregate, ownerTz: string, nowMs: number): ProgressSession | null {
  const { session } = aggregate;
  if (session.status !== 'finished') return null;
  const switched = (session.gymChanges ?? []).length > 0;
  const byExercise = new Map<string, ProgressSet[]>();
  for (const s of aggregate.sets) {
    if (s.status !== 'completed' || s.actual === null) continue;
    const bucket = byExercise.get(s.sessionExerciseId) ?? [];
    bucket.push({
      setId: s.id,
      setType: s.setType,
      side: s.side,
      load: s.actual.load,
      reps: s.actual.reps,
      durationS: s.actual.durationS,
      rpe: s.actual.rpe,
      rir: s.actual.rir,
      ...(s.exclusions && s.exclusions.length > 0 ? { exclusions: s.exclusions } : {}),
      completedAtUtc: s.completedAt?.utc ?? null,
      index: s.index,
      ...(s.edited ? { edited: true as const } : {}),
    });
    byExercise.set(s.sessionExerciseId, bucket);
  }
  const exercises: ProgressExercise[] = [...aggregate.exercises]
    .sort((a, b) => a.order - b.order)
    .map((ex) => {
      const equipment = equipmentOfRow(session.equipmentSnapshot, ex);
      const sets = (byExercise.get(ex.id) ?? []).sort((a, b) => (a.completedAtUtc ?? '').localeCompare(b.completedAtUtc ?? '') || a.index - b.index);
      return {
        sessionExerciseId: ex.id,
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        equipmentId: ex.equipmentId,
        equipmentKind: equipment?.kind ?? null,
        equipmentName: equipment?.name ?? null,
        gymId: switched && equipment !== null ? equipment.gymId : session.gymId,
        convention: ex.loadConvention,
        unit: ex.unit,
        measurement: ex.measurement,
        laterality: ex.laterality,
        sets,
      };
    });
  const dateOnly = session.localDate !== undefined;
  const startedMs = toMs(session.startedAt.utc);
  return {
    sessionId: session.id,
    version: session.version,
    source: session.source,
    name: session.routineName,
    gymId: session.gymId,
    startedAtUtc: session.startedAt.utc,
    startedMs,
    tz: session.startedAt.tz,
    date: session.localDate ?? localDateOf(startedMs, ownerTz),
    dateOnly,
    endedAtUtc: session.endedAt?.utc ?? null,
    durationMs: dateOnly || session.endedAt === null ? null : workoutDurationMs(aggregate, nowMs),
    durationConfirmed: session.durationConfirmedAt !== undefined,
    exercises,
  };
}

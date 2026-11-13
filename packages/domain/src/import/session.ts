import type { ImportRow, SessionAggregate, SessionExercise, SetAuditEntry, WorkoutSet } from '@fizz/schemas';
import { localHourUtcMs } from '../calendar';
import { toIso } from '../time';
import { fitNotes2WorkoutOf } from './fitnotes';
import { importIds } from './plan';

/**
 * One imported workout, built from its frozen import rows (check 23: a
 * resumed commit rebuilds exactly the same record). Pure.
 *
 * - `finished`, `source: 'import'`, linked to its job, `localDate` = the
 *   FitNotes date. FitNotes has no time of day, so `startedAt` is only an
 *   ordering anchor at 12:00 local on that date in the import's zone, never
 *   shown; there is no end time and no duration (rule 6). Today and the
 *   summary read `localDate` (`dateOnlyOf`) and show the date only.
 * - Sets are completed with the mapped values, as written (never snapped to
 *   equipment; rule 2). No equipment instance is attached (the file doesn't
 *   say which machine or bar was used).
 * - Each set has one `logged` audit entry stamped with the import's commit
 *   time: when it entered the app. The original row is the provenance.
 * - FitNotes has no warm-up flag, so every set is a working set (research
 *   §3.4; proposed spec change S6 would mark them "not recorded").
 * - Layout imports (ADR 0026): one workout per workout key (two Strong
 *   workouts on one date are two workouts). A start time written in the file
 *   (no zone) is read in the import's zone, as FitNotes dates are, and is
 *   only the ordering anchor; the cell as written stays the provenance
 *   (`18:02 (as in the file)`). A confirmed warm-up or drop-set marker gives
 *   the set that type.
 * - FitNotes 2's workout export (variant `D`, `fitNotes2`): the file says
 *   when the workout started and ended (UTC instants), so the workout has
 *   that real start, end and duration (no `localDate`: it isn't date-only),
 *   and its `Name` as the workout's name. Warm-ups keep their type; `RIR`
 *   is kept as written.
 */

/** FitNotes files have no rest: `not_recorded`, never a rest of 0 s from the global default (review N6). */
export const IMPORTED_REST = { seconds: 0, source: 'not_recorded', sourceLabel: 'Not recorded (imported)' } as const;

export interface ImportedSessionInput {
  ownerId: string;
  jobId: string;
  operationId: string;
  /** Zone the dates are read in (the job's). */
  tz: string;
  gymId: string | null;
  /** When the commit started (the job's `startedAt.utc`). */
  importedAtUtc: string;
  date: string;
  /** The workout's key (layout imports); absent: the date (FitNotes). */
  workoutKey?: string;
  /** `HH:mm` as written in the file (layout imports); absent or null: none. */
  startLocal?: string | null;
  /** The job's imported rows for this workout. */
  rows: readonly ImportRow[];
  /** The job's file is FitNotes 2's workout export (variant `D`): its cells give the real start, end and name. */
  fitNotes2?: boolean;
}

export function anchorUtcFor(date: string, tz: string, startLocal: string | null = null): string {
  const m = startLocal === null ? null : /^(\d{2}):(\d{2})$/.exec(startLocal);
  if (!m) return toIso(localHourUtcMs(date, 12, tz));
  return toIso(localHourUtcMs(date, Number(m[1]), tz) + Number(m[2]) * 60_000);
}

export function buildImportedSession(input: ImportedSessionInput): SessionAggregate {
  const key = input.workoutKey ?? input.date;
  const sessionId = importIds.session(input.jobId, key);
  const startOperationId = importIds.startOperation(input.operationId, key);
  const rows = input.rows
    .filter((r) => r.result === 'imported' && (input.workoutKey !== undefined || r.localDate === input.date) && r.sessionId === sessionId)
    .sort((a, b) => a.row - b.row || (a.part ?? 0) - (b.part ?? 0));
  // FitNotes 2: the real start and end, from the cells (provenance). Rows that don't read fall back to the anchor, date only.
  const fn2 = input.fitNotes2 === true && rows[0] !== undefined ? fitNotes2WorkoutOf(rows[0].cells, input.tz) : null;
  const anchor = fn2 !== null ? toIso(fn2.startUtcMs) : anchorUtcFor(input.date, input.tz, input.startLocal ?? null);
  const ended = fn2 !== null && fn2.endUtcMs !== null ? { utc: toIso(fn2.endUtcMs), tz: input.tz } : null;

  const exercises = new Map<string, SessionExercise>();
  const sets: WorkoutSet[] = [];
  const audit: SetAuditEntry[] = [];
  for (const r of rows) {
    const m = r.imported;
    if (!m || r.setId === null) continue;
    if (!exercises.has(m.sessionExerciseId)) {
      exercises.set(m.sessionExerciseId, {
        id: m.sessionExerciseId,
        sessionId,
        exerciseId: m.exerciseId,
        exerciseName: m.exerciseName,
        measurement: 'reps',
        laterality: m.laterality,
        equipmentId: null,
        loadConvention: m.convention,
        unit: m.unit,
        order: m.exerciseOrder,
        supersetGroup: null,
        transitionRestS: null,
        progressionRuleId: null,
      });
    }
    const side = m.laterality === 'unilateral' ? ('both' as const) : null;
    const actual = { load: m.load, reps: m.reps, durationS: null, rpe: m.rpe, rir: m.rir ?? null };
    const setType = m.setType ?? 'working';
    sets.push({
      id: r.setId,
      sessionId,
      sessionExerciseId: m.sessionExerciseId,
      index: m.setIndex,
      setType,
      status: 'completed',
      side,
      pairedWithSetId: null,
      planned: { load: null, reps: null, durationS: null, rpe: null, rir: null },
      rest: { ...IMPORTED_REST },
      actual,
      draft: null,
      completedAt: { utc: anchor, tz: input.tz },
      completedByOpId: startOperationId,
      undoCount: 0,
      flags: [],
      edited: false,
      version: 1,
    });
    audit.push({
      id: `import:${r.setId}`,
      sessionId,
      setId: r.setId,
      opId: startOperationId,
      kind: 'logged',
      atUtc: input.importedAtUtc,
      before: null,
      after: { status: 'completed', setType, side, actual, version: 1 },
    });
  }
  const orderedExercises = [...exercises.values()].sort((a, b) => a.order - b.order);
  // Sets in exercise order, then set order, so the stored ordinal follows the workout.
  const orderOf = new Map(orderedExercises.map((e) => [e.id, e.order]));
  sets.sort((a, b) => (orderOf.get(a.sessionExerciseId) ?? 0) - (orderOf.get(b.sessionExerciseId) ?? 0) || a.index - b.index);
  const auditOrder = new Map(sets.map((s, i) => [s.id, i]));
  audit.sort((a, b) => (auditOrder.get(a.setId) ?? 0) - (auditOrder.get(b.setId) ?? 0));

  return {
    session: {
      id: sessionId,
      ownerId: input.ownerId,
      routineId: null,
      routineName: fn2?.name ?? null,
      gymId: input.gymId,
      startOperationId,
      status: 'finished',
      source: 'import',
      importJobId: input.jobId,
      ...(fn2 !== null ? {} : { localDate: input.date }),
      startedAt: { utc: anchor, tz: input.tz },
      endedAt: ended,
      version: 1,
      activeSetId: null,
      equipmentSnapshot: [],
      pause: null,
      pauses: [],
      lastActivityAtUtc: ended?.utc ?? anchor,
      checkIn: null,
    },
    exercises: orderedExercises,
    sets,
    restTimer: null,
    workInterval: null,
    audit,
    timingAudit: [],
    processedOps: {},
    revision: 1,
  };
}

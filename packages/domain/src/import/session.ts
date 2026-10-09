import type { ImportRow, SessionAggregate, SessionExercise, SetAuditEntry, WorkoutSet } from '@fizz/schemas';
import { localHourUtcMs } from '../calendar';
import { toIso } from '../time';
import { importIds } from './plan';

/**
 * One imported workout, built from its frozen import rows (check 23: a
 * resumed commit rebuilds exactly the same record). Pure.
 *
 * - `finished`, `source: 'import'`, linked to its job, `localDate` = the
 *   FitNotes date. FitNotes has no time of day, so `startedAt` is only an
 *   ordering anchor at 12:00 local on that date in the import's zone, never
 *   shown; there is no end time and no duration (rule 6).
 * - Sets are completed with the mapped values, as written (never snapped to
 *   equipment; rule 2). No equipment instance is attached (the file doesn't
 *   say which machine or bar was used).
 * - Each set has one `logged` audit entry stamped with the import's commit
 *   time: when it entered the app. The original row is the provenance.
 * - FitNotes has no warm-up flag, so every set is a working set (research
 *   §3.4; proposed spec change S6 would mark them "not recorded").
 */

export const IMPORTED_REST = { seconds: 0, source: 'global_default', sourceLabel: 'Not recorded (imported)' } as const;

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
  /** The job's imported rows for this date. */
  rows: readonly ImportRow[];
}

export function anchorUtcFor(date: string, tz: string): string {
  return toIso(localHourUtcMs(date, 12, tz));
}

export function buildImportedSession(input: ImportedSessionInput): SessionAggregate {
  const sessionId = importIds.session(input.jobId, input.date);
  const startOperationId = importIds.startOperation(input.operationId, input.date);
  const anchor = anchorUtcFor(input.date, input.tz);
  const rows = input.rows
    .filter((r) => r.result === 'imported' && r.localDate === input.date && r.sessionId === sessionId)
    .sort((a, b) => a.row - b.row);

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
    const actual = { load: m.load, reps: m.reps, durationS: null, rpe: m.rpe, rir: null };
    sets.push({
      id: r.setId,
      sessionId,
      sessionExerciseId: m.sessionExerciseId,
      index: m.setIndex,
      setType: 'working',
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
      after: { status: 'completed', setType: 'working', side, actual, version: 1 },
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
      routineName: null,
      gymId: input.gymId,
      startOperationId,
      status: 'finished',
      source: 'import',
      importJobId: input.jobId,
      localDate: input.date,
      startedAt: { utc: anchor, tz: input.tz },
      endedAt: null,
      version: 1,
      activeSetId: null,
      equipmentSnapshot: [],
      pause: null,
      pauses: [],
      lastActivityAtUtc: anchor,
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

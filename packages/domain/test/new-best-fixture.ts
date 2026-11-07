import type { WeightUnit } from '@fizz/schemas';
import { isSetCountable, newBestClaims, type NewBestRecords, type ProgressSession, type ReviewSession, type WeeklyReviewInput } from '../src/index';

/** A Progress workout as the weekly review reads it (what `reviewSessionOf` gives for the same stored workout). */
export function reviewOfProgress(p: ProgressSession): ReviewSession {
  return {
    sessionId: p.sessionId,
    name: p.name,
    date: p.date,
    startedMs: p.startedMs,
    startedAtUtc: p.startedAtUtc,
    routineId: null,
    template: null,
    feel: null,
    plannedReps: null,
    doneReps: 0,
    ...(p.source === 'import' ? { imported: true as const } : {}),
    exercises: p.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      name: e.exerciseName,
      equipmentKind: e.equipmentKind,
      equipmentId: e.equipmentId,
      plannedWorking: null,
      sets: e.sets.map((s) => ({ setType: s.setType, load: s.load, reps: s.reps, rpe: s.rpe, targetRpe: null, counts: isSetCountable(s, 'record') })),
    })),
  };
}

export function reviewInputOf(sessions: readonly ReviewSession[], lifts: readonly string[], unit: WeightUnit = 'kg'): WeeklyReviewInput {
  return { monday: '2026-10-05', nowMs: Date.parse('2026-10-11T12:00:00Z'), tz: 'Europe/London', sessions, plans: [], aim: null, goal: null, info: () => null, lifts, liftTargets: [], activities: [], templates: [], painFlagged: new Set(), unit };
}

/** The `New best` records of these workouts for these tracked lifts (each at the picked reps, else his newest top set's). */
export function bestsFor(sessions: readonly ProgressSession[], lifts: readonly string[], o: { reps?: Record<string, number>; unit?: WeightUnit; historyUnknown?: ReadonlySet<string> } = {}): NewBestRecords {
  return newBestClaims(reviewInputOf(sessions.map(reviewOfProgress), lifts, o.unit), { planReps: new Map(), pickedReps: o.reps ?? {}, nameOf: (id) => id, ...(o.historyUnknown ? { historyUnknown: o.historyUnknown } : {}) });
}

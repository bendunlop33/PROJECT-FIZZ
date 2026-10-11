import type { Load, LoadConvention } from '@fizz/schemas';
import { loadText, NBSP } from '../display';
import type { HistorySession, HistorySet } from '../progression';
import { findSetRecord } from '../session/records';
import type { ProgressExercise, ProgressSession } from './projection';
import { inRange, type DateRange } from './window';

/**
 * Records set inside a Progress window (progress.md PG10, PG30): `Heaviest
 * set` and `Most reps at <load>`, each judged as the set was logged with
 * `findSetRecord`, against everything done before that workout (and earlier
 * sets that day). Same rules as the Summary's record line: only workouts
 * logged in the app make a claim, it needs ≥ 3 earlier sessions on the same
 * equipment, convention and unit, marked sets never count, and a heavier
 * imported set suppresses it. At most one record per exercise per workout
 * (the last heaviest, else the last most-reps). Pure.
 */

export type ProgressRecordKind = 'heaviest' | 'most_reps_at_load';

export interface ProgressRecord {
  kind: ProgressRecordKind;
  sessionId: string;
  date: string;
  exerciseId: string;
  exerciseName: string;
  equipmentId: string | null;
  gymId: string | null;
  convention: LoadConvention;
  load: Load;
  reps: number;
  /** `Heaviest set` · `Most reps at 59 kg`. */
  label: string;
  /** `105 kg × 3` · `12`. */
  value: string;
  /** Records here are actual results; Est. 1RM records (slice B) set this. */
  isEstimate: false;
}

function historySets(ex: ProgressExercise): HistorySet[] {
  return ex.sets.map((s) => ({
    setType: s.setType,
    side: s.side,
    load: s.load,
    reps: s.reps,
    rpe: null,
    rir: null,
    ...(s.exclusions ? { exclusions: s.exclusions } : {}),
  }));
}

/** One `HistorySession` per exercise and equipment in a workout, as `toHistorySessions` makes them. */
function toHistoryByExercise(s: ProgressSession): Map<string, HistorySession[]> {
  const out = new Map<string, Map<string | null, HistorySession>>();
  for (const ex of s.exercises) {
    const byEq = out.get(ex.exerciseId) ?? new Map<string | null, HistorySession>();
    const prior = byEq.get(ex.equipmentId);
    const sets = historySets(ex);
    if (prior) byEq.set(ex.equipmentId, { ...prior, sets: [...prior.sets, ...sets] });
    else byEq.set(ex.equipmentId, { sessionId: s.sessionId, performedAtUtc: s.startedAtUtc, equipmentId: ex.equipmentId, gymId: ex.gymId, imported: s.source === 'import', sets });
    out.set(ex.exerciseId, byEq);
  }
  return new Map([...out].map(([k, v]) => [k, [...v.values()]]));
}

export interface RecordsInWindow {
  /** Newest first, at most `limit`. */
  items: ProgressRecord[];
  total: number;
}

export function recordsInWindow(
  sessions: readonly ProgressSession[],
  window: DateRange,
  opts: { gymNames?: Readonly<Record<string, string>>; limit?: number } = {},
): RecordsInWindow {
  const ordered = [...sessions].sort((a, b) => a.startedMs - b.startedMs || a.sessionId.localeCompare(b.sessionId));
  // Earlier history per exercise, oldest first, built once.
  const history = new Map<string, { startedMs: number; sessionId: string; h: HistorySession }[]>();
  for (const s of ordered) {
    for (const [exerciseId, hs] of toHistoryByExercise(s)) {
      const list = history.get(exerciseId) ?? [];
      for (const h of hs) list.push({ startedMs: s.startedMs, sessionId: s.sessionId, h });
      history.set(exerciseId, list);
    }
  }

  const found: (ProgressRecord & { order: number; startedMs: number })[] = [];
  for (const s of ordered) {
    if (s.source !== 'manual' || !inRange(s.date, window)) continue;
    s.exercises.forEach((ex, order) => {
      if (ex.sets.length === 0) return;
      const before = (history.get(ex.exerciseId) ?? []).filter((e) => e.startedMs < s.startedMs && e.sessionId !== s.sessionId).map((e) => e.h);
      const earlierToday: HistorySet[] = [];
      let heaviest: { load: Load; reps: number } | null = null;
      let mostReps: { load: Load; reps: number } | null = null;
      const gymName = ex.gymId === null ? null : (opts.gymNames?.[ex.gymId] ?? null);
      for (const set of ex.sets) {
        const rec = findSetRecord({
          exerciseName: ex.exerciseName,
          gymName,
          equipmentId: ex.equipmentId,
          convention: ex.convention,
          measurement: ex.measurement,
          equipment: ex.equipmentKind === null ? null : { kind: ex.equipmentKind },
          set: { setType: set.setType, load: set.load, reps: set.reps, ...(set.exclusions ? { exclusions: set.exclusions } : {}) },
          earlierToday,
          history: before,
        });
        if (rec !== null && set.load !== null && set.reps !== null) {
          if (rec.kind === 'heaviest') heaviest = { load: set.load, reps: set.reps };
          else mostReps = { load: set.load, reps: set.reps };
        }
        earlierToday.push({ setType: set.setType, side: set.side, load: set.load, reps: set.reps, rpe: null, rir: null, ...(set.exclusions ? { exclusions: set.exclusions } : {}) });
      }
      const shown = heaviest !== null ? { kind: 'heaviest' as const, ...heaviest } : mostReps !== null ? { kind: 'most_reps_at_load' as const, ...mostReps } : null;
      if (shown === null) return;
      const loadWords = loadText(shown.load, ex.convention, ex.equipmentKind === null ? null : { kind: ex.equipmentKind });
      found.push({
        kind: shown.kind,
        sessionId: s.sessionId,
        date: s.date,
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        equipmentId: ex.equipmentId,
        gymId: ex.gymId,
        convention: ex.convention,
        load: shown.load,
        reps: shown.reps,
        label: shown.kind === 'heaviest' ? 'Heaviest set' : `Most reps at ${loadWords}`,
        value: shown.kind === 'heaviest' ? `${loadWords}${NBSP}×${NBSP}${String(shown.reps)}` : String(shown.reps),
        isEstimate: false,
        order,
        startedMs: s.startedMs,
      });
    });
  }
  found.sort((a, b) => b.date.localeCompare(a.date) || b.startedMs - a.startedMs || a.order - b.order);
  const limit = opts.limit ?? 5;
  const items: ProgressRecord[] = found.slice(0, limit).map((r) => ({
    kind: r.kind,
    sessionId: r.sessionId,
    date: r.date,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    equipmentId: r.equipmentId,
    gymId: r.gymId,
    convention: r.convention,
    load: r.load,
    reps: r.reps,
    label: r.label,
    value: r.value,
    isEstimate: false,
  }));
  return { items, total: found.length };
}

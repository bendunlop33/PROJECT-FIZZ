import { describe, expect, it } from 'vitest';
import type { Load, LoadConvention, SetExclusion, SetType, WeightUnit } from '@fizz/schemas';

import { findSetRecord, recordsInWindow, type HistorySession, type HistorySet, type ProgressExercise, type ProgressSession, type ProgressSet } from '../src/index';

/**
 * `recordsInWindow` is one chronological pass with running maxima. It must
 * decide exactly what `findSetRecord` (the Summary's record line) decides for
 * each set given the full history, so the two can never disagree. This test
 * runs the straightforward `findSetRecord` version against it on random
 * histories with ties, mixed units and conventions, other equipment, imports,
 * marked sets, warm-ups, drop sets, zero reps, two rows of one exercise in a
 * workout and workouts that start at the same instant.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

function randomHistory(seed: number): ProgressSession[] {
  const r = rng(seed);
  const out: ProgressSession[] = [];
  let n = 0;
  for (let k = 0; k < 60; k += 1) {
    const day = 1 + Math.floor(k * 1.5);
    const startedMs = Date.UTC(2026, 6, day, r() < 0.15 ? 9 : 18);
    const source = r() < 0.2 ? ('import' as const) : ('manual' as const);
    const rows: ProgressExercise[] = [];
    const rowCount = 1 + Math.floor(r() * 3);
    for (let x = 0; x < rowCount; x += 1) {
      const exerciseId = pick(r, ['bench', 'bench', 'press', 'pullup']);
      const convention: LoadConvention = exerciseId === 'pullup' ? pick(r, ['assistance', 'added'] as const) : pick(r, ['total', 'total', 'total', 'per_hand'] as const);
      const unit: WeightUnit = r() < 0.15 ? 'lb' : 'kg';
      const equipmentId = source === 'import' ? null : pick(r, ['bar-1', 'bar-1', 'bar-2', null]);
      const sets: ProgressSet[] = [];
      for (let y = 0; y < 1 + Math.floor(r() * 5); y += 1) {
        n += 1;
        const setType: SetType = pick(r, ['working', 'working', 'working', 'top', 'backoff', 'warmup', 'drop'] as const);
        const exclusions: SetExclusion[] | undefined = r() < 0.08 ? ['spotted'] : undefined;
        const load: Load | null = r() < 0.05 ? null : { value: pick(r, [80, 90, 95, 100, 100, 102.5, 105, 110, 220, 230]), unit: r() < 0.03 ? (unit === 'kg' ? 'lb' : 'kg') : unit, convention: r() < 0.03 ? 'stack' : convention };
        sets.push({
          setId: `x${String(n)}`,
          setType,
          side: null,
          load,
          reps: r() < 0.05 ? null : pick(r, [0, 3, 5, 5, 6, 8, 8, 10]),
          durationS: null,
          rpe: null,
          rir: null,
          completedAtUtc: null,
          index: y,
          ...(exclusions ? { exclusions } : {}),
        });
      }
      rows.push({
        sessionExerciseId: `row-${String(k)}-${String(x)}`,
        exerciseId,
        exerciseName: exerciseId,
        equipmentId,
        equipmentKind: null,
        gymId: 'g',
        convention,
        unit,
        measurement: 'reps',
        laterality: 'bilateral',
        sets,
      });
    }
    out.push({
      sessionId: `s${String(k).padStart(3, '0')}`,
      version: 1,
      source,
      name: null,
      gymId: 'g',
      startedAtUtc: new Date(startedMs).toISOString(),
      startedMs,
      tz: 'UTC',
      date: new Date(startedMs).toISOString().slice(0, 10),
      dateOnly: source === 'import',
      endedAtUtc: null,
      durationMs: null,
      durationConfirmed: false,
      exercises: rows,
    });
  }
  return out;
}

const toHistorySet = (s: ProgressSet): HistorySet => ({ setType: s.setType, side: s.side, load: s.load, reps: s.reps, rpe: null, rir: null, ...(s.exclusions ? { exclusions: s.exclusions } : {}) });

/** The straightforward version: `findSetRecord` for every set with the whole earlier history. */
function reference(sessions: readonly ProgressSession[], from: string, to: string) {
  const out: { sessionId: string; exerciseId: string; order: number; kind: string; load: Load; reps: number }[] = [];
  for (const s of sessions) {
    if (s.source !== 'manual' || s.date < from || s.date > to) continue;
    s.exercises.forEach((ex, order) => {
      const history: HistorySession[] = [];
      for (const h of sessions) {
        if (h.startedMs >= s.startedMs || h.sessionId === s.sessionId) continue;
        const byEq = new Map<string | null, HistorySet[]>();
        for (const e of h.exercises) if (e.exerciseId === ex.exerciseId) byEq.set(e.equipmentId, [...(byEq.get(e.equipmentId) ?? []), ...e.sets.map(toHistorySet)]);
        for (const [equipmentId, sets] of byEq) history.push({ sessionId: h.sessionId, performedAtUtc: h.startedAtUtc, equipmentId, gymId: 'g', imported: h.source === 'import', sets });
      }
      const earlierToday: HistorySet[] = [];
      let heaviest: ProgressSet | null = null;
      let most: ProgressSet | null = null;
      for (const set of ex.sets) {
        const rec = findSetRecord({ exerciseName: ex.exerciseName, gymName: null, equipmentId: ex.equipmentId, convention: ex.convention, measurement: ex.measurement, set: { setType: set.setType, load: set.load, reps: set.reps, ...(set.exclusions ? { exclusions: set.exclusions } : {}) }, earlierToday, history });
        if (rec?.kind === 'heaviest') heaviest = set;
        else if (rec !== null) most = set;
        earlierToday.push(toHistorySet(set));
      }
      const shown = heaviest ?? most;
      if (shown?.load && shown.reps !== null) out.push({ sessionId: s.sessionId, exerciseId: ex.exerciseId, order, kind: heaviest ? 'heaviest' : 'most_reps_at_load', load: shown.load, reps: shown.reps });
    });
  }
  return out.sort((a, b) => b.sessionId.localeCompare(a.sessionId) || a.order - b.order);
}

describe('recordsInWindow decides exactly what findSetRecord decides', () => {
  let compared = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`random history ${String(seed)}`, () => {
      const sessions = randomHistory(seed);
      const window = { from: '2026-07-20', to: '2026-10-31' };
      const want = reference(sessions, window.from, window.to);
      const got = recordsInWindow(sessions, window, { limit: Number.POSITIVE_INFINITY }).items.map((x) => ({ sessionId: x.sessionId, exerciseId: x.exerciseId, kind: x.kind, load: x.load, reps: x.reps }));
      compared += want.length;
      expect([...got].sort((a, b) => b.sessionId.localeCompare(a.sessionId))).toEqual(want.map((w) => ({ sessionId: w.sessionId, exerciseId: w.exerciseId, kind: w.kind, load: w.load, reps: w.reps })));
    });
  }
  it('the random histories produced records to compare', () => {
    expect(compared).toBeGreaterThan(30);
  });
});

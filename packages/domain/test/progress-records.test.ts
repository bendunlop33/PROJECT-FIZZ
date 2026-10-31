import { describe, expect, it } from 'vitest';
import type { Load, LoadConvention, SetExclusion, SetType, WeightUnit } from '@fizz/schemas';

import { newBestClaims, recordsInWindow, sessionNewBests, type ProgressExercise, type ProgressSession, type ProgressSet } from '../src/index';
import { reviewInputOf, reviewOfProgress } from './new-best-fixture';

/**
 * (Ben, 26 Oct; one definition of best) `newBestClaims` is one pass per lift with running bests. It must say exactly
 * what the Summary's `sessionNewBests` says for every workout given the whole history, so Progress's records, the
 * recap's count and the Summary can never disagree. This test runs `sessionNewBests` for every workout against it
 * on random histories with ties, mixed units and conventions (the lift's convention changing over time), stacks on
 * two machines, other bars, imports, marked sets, warm-ups, drop sets, zero reps, two rows of one exercise in a
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
      const exerciseId = pick(r, ['bench', 'bench', 'press', 'pullup', 'cable']);
      const convention: LoadConvention = exerciseId === 'pullup' ? pick(r, ['assistance', 'added'] as const) : exerciseId === 'cable' ? 'stack' : pick(r, ['total', 'total', 'total', 'per_hand'] as const);
      const unit: WeightUnit = r() < 0.15 ? 'lb' : 'kg';
      const equipmentId = source === 'import' ? null : exerciseId === 'cable' ? pick(r, ['stack-1', 'stack-1', 'stack-2']) : pick(r, ['bar-1', 'bar-1', 'bar-2', null]);
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

const LIFTS = ['bench', 'press', 'pullup', 'cable'];
const REPS = { bench: 5, pullup: 8 };

describe('newBestClaims says exactly what the Summary\u2019s sessionNewBests says, workout by workout', () => {
  let compared = 0;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`random history ${String(seed)}`, () => {
      const sessions = randomHistory(seed);
      const input = reviewInputOf(sessions.map(reviewOfProgress), LIFTS);
      const opts = { planReps: new Map<string, number>(), pickedReps: REPS, nameOf: (id: string) => id };
      const want = sessions.flatMap((s) => sessionNewBests(input, opts, s.sessionId).map((b) => `${s.sessionId}|${b.exerciseId}|${b.text}`)).sort();
      const bests = newBestClaims(input, opts);
      const got = bests.claims.map((c) => `${c.sessionId}|${c.exerciseId}|${c.view.text}`).sort();
      compared += want.length;
      expect(got).toEqual(want);
      // Progress's records are those claims, on workouts logged in the app (every claim is one).
      const listed = recordsInWindow(sessions, { from: '2000-01-01', to: '2099-12-31' }, { limit: Number.POSITIVE_INFINITY, bests }).items.map((x) => `${x.sessionId}|${x.exerciseId}`).sort();
      expect(listed).toEqual(bests.claims.map((c) => `${c.sessionId}|${c.exerciseId}`).sort());
      expect(bests.claims.every((c) => sessions.find((x) => x.sessionId === c.sessionId)?.source === 'manual')).toBe(true);
    });
  }
  it('the random histories produced bests to compare', () => {
    expect(compared).toBeGreaterThan(30);
  });
});

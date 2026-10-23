import { describe, expect, it } from 'vitest';
import { buildFromSetup, getAchievableLoads, referenceE1rm, slotsOf, type BuilderSetup, type BuilderWorkout, type LoadReferences, type RefSession } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import { applyBuilderEdits, createBuilderLoadGuard, topLoad, type BuilderCoachEnv, type BuilderCoachSnapshot } from '../src/index';

/**
 * D4 (Ben, 22–23 Oct) through the coach's typed edits: when the coach lowers today's top (Ben asked), the back-offs
 * drop by the same %, rounded down on the bar; a heavier top works them out from their reps and RPE, inside the band
 * below the new top (Balanced 4–10 %), never at or above it.
 */

const chest: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 3 }, { group: 'Triceps', count: 1 }, { group: 'Abs', count: 1 }] };

function benchRefs(): LoadReferences {
  const top = { value: 100, reps: 8, rpe: 8 };
  const s: RefSession = { sessionId: 's-bench', performedAtUtc: '2026-10-13T10:00:00Z', tz: 'Europe/London', source: 'app', sets: [top], top };
  return { exerciseId: 'bench', unit: 'kg', convention: 'total', direction: 'resistance', equipment: F.bar, own: { sessions: [s], e1rm: referenceE1rm(s.sets), gapDays: 7, estOnly: false }, latest: s, all: [s], derived: null, patternE1rms: [], historyVersion: 'h1' };
}

function setup() {
  const ctx = F.context();
  const w: BuilderWorkout = buildFromSetup(chest, F.pool, ctx).workout;
  const env: BuilderCoachEnv = {
    ctx,
    usable: (id) => F.info(id) !== null,
    pain: () => null,
    loads: createBuilderLoadGuard({ ctx, refs: (id) => (id === 'bench' ? benchRefs() : null), pain: () => null }),
    askedHeavier: true,
    mainGroup: 'Chest',
  };
  const snap: BuilderCoachSnapshot = { draftId: 'd1', draftVersion: 3, dayName: 'Chest', minutes: 60, supersets: true, workout: w, revs: {} };
  const key = slotsOf(w.blocks).find((s) => s.exerciseId === 'bench')?.key ?? 'missing';
  return { snap, env, key };
}

const benchOf = (w: BuilderWorkout) => slotsOf(w.blocks).find((s) => s.exerciseId === 'bench');
const backoffs = (w: BuilderWorkout) => benchOf(w)?.rows.filter((r) => r.type === 'backoff').map((r) => r.load) ?? [];

describe('D4: the coach lowers or raises today’s top', () => {
  it('lighter top (100 → 90): back-offs drop by the same %, rounded down on the bar', () => {
    const { snap, env, key } = setup();
    const before = benchOf(snap.workout);
    const t0 = before === undefined ? null : topLoad(before);
    expect(t0).toBe(100);
    const b0 = backoffs(snap.workout);
    expect(b0.length).toBeGreaterThan(0);
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: key, direction: null, value: 90, unit: 'kg' }], env);
    const after = benchOf(o.workout);
    expect(after === undefined ? null : topLoad(after)).toBe(90);
    const loads = getAchievableLoads(F.bar).loads;
    const expected = b0.map((b) => Math.max(...loads.filter((x) => x <= ((b ?? 0) * 90) / 100 + 1e-9)));
    expect(backoffs(o.workout)).toEqual(expected);
    for (const b of backoffs(o.workout)) expect(b ?? Infinity).toBeLessThan(90);
  });

  it('heavier top (100 → 102.5): back-offs from their reps and RPE, inside 4–10 % below the new top', () => {
    const { snap, env, key } = setup();
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: key, direction: 'heavier', value: null, unit: null }], env);
    const after = benchOf(o.workout);
    const t = after === undefined ? 0 : (topLoad(after) ?? 0);
    expect(t).toBe(102.5);
    for (const b of backoffs(o.workout)) {
      expect(b ?? Infinity).toBeLessThanOrEqual(t * 0.96 + 1e-9);
      expect(b ?? 0).toBeGreaterThan(t * 0.9 - 2.5);
    }
  });
});

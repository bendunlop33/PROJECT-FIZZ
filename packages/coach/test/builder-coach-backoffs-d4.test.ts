import { describe, expect, it } from 'vitest';
import { buildFromSetup, editSetRow, fromDraftPlan, getAchievableLoads, toDraftPlan, type DraftCodecContext, referenceE1rm, slotsOf, type BuilderSetup, type BuilderSlot, type BuilderWorkout, type LoadReferences, type RefSession } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import { applyBuilderEdits, createBuilderLoadGuard, topLoad, type BuilderCoachEnv, type BuilderCoachSnapshot } from '../src/index';

/**
 * D4 (Ben, 22–23 Oct) through the coach's typed edits: when the coach lowers today's top (Ben asked), the back-offs
 * drop by the same %, measured from the top they were worked out from, rounded down on the bar. (Ben, 23 Oct, SP2) A
 * heavier top Ben asked the coach for raises them the same way (workout-builder-v3 §3.1 step 2 wins over HT8 here),
 * inside the D4 band and never at or above it; a top Ben types himself still never raises them. A load raised,
 * lowered or put back never compounds (review B1).
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

  it('Ben, 23 Oct: a heavier top the coach sets (100 → 110) raises the back-offs by the same %, inside the band, snapped down', () => {
    const { snap, env, key } = setup();
    expect(backoffs(snap.workout).every((b) => b === 95)).toBe(true);
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: key, direction: null, value: 110, unit: 'kg' }], env);
    expect(topLoad(benchOf(o.workout) as BuilderSlot)).toBe(110);
    // 95 × 110 / 100 = 104.5, inside Balanced's 4 % edge (105.6) → 102.5 on the bar.
    expect(backoffs(o.workout).every((b) => b === 102.5)).toBe(true);
    for (const b of backoffs(o.workout)) {
      expect(b ?? Infinity).toBeLessThanOrEqual(110 * 0.96 + 1e-9);
      expect(b ?? 0).toBeGreaterThanOrEqual(110 * 0.9 - 2.5);
    }
  });

  it('Ben, 23 Oct: a top Ben types after the coach raised it ends the follow (a heavier one he types never raises them)', () => {
    const { snap, env, key } = setup();
    const up = applyBuilderEdits(snap, [{ op: 'load', slotKey: key, direction: null, value: 110, unit: 'kg' }], env).workout;
    const typed = withBench(up, (s) => {
      const r = editSetRow(s, s.rows.findIndex((x) => x.type === 'top'), { kind: 'load', value: 120 }, env.ctx.loads('bench'));
      if (!r.ok) throw new Error(r.reason);
      return r.slot;
    });
    expect(backoffs(typed).every((b) => b === 102.5)).toBe(true);
    const lower = withBench(typed, (s) => {
      const r = editSetRow(s, s.rows.findIndex((x) => x.type === 'top'), { kind: 'load', value: 100 }, env.ctx.loads('bench'));
      if (!r.ok) throw new Error(r.reason);
      return r.slot;
    });
    // From 102.5 at 110: × 100 / 110 = 93.2 → 92.5.
    expect(backoffs(lower).every((b) => b === 92.5)).toBe(true);
  });

  it('Ben, 23 Oct: the follow survives a force-close (codec), so the back-offs still follow the coach’s top after a relaunch', () => {
    const { snap, env, key } = setup();
    const up = applyBuilderEdits(snap, [{ op: 'load', slotKey: key, direction: null, value: 110, unit: 'kg' }], env).workout;
    const codec: DraftCodecContext = { info: env.ctx.info, catalogueIdOf: (e) => e, checkedOnOf: () => null };
    const back = fromDraftPlan(toDraftPlan(up, codec));
    expect(benchOf(back)?.rows.filter((r) => r.type === 'backoff').every((r) => r.backoffFrom?.follow === true)).toBe(true);
    const down = applyBuilderEdits(snapOf(snap, back), [{ op: 'load', slotKey: key, direction: null, value: 100, unit: 'kg' }], env).workout;
    expect(backoffs(down).every((b) => b === 95)).toBe(true);
  });

  it('heavier top (100 → 102.5): back-offs follow by the same % (95 × 1.025 = 97.4 → 95 on the bar), 4–10 % below the new top', () => {
    const { snap, env, key } = setup();
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: key, direction: 'heavier', value: null, unit: null }], env);
    const after = benchOf(o.workout);
    const t = after === undefined ? 0 : (topLoad(after) ?? 0);
    expect(t).toBe(102.5);
    expect(backoffs(o.workout)).toEqual(backoffs(snap.workout));
    for (const b of backoffs(o.workout)) {
      expect(b ?? Infinity).toBeLessThanOrEqual(t * 0.96 + 1e-9);
      expect(b ?? 0).toBeGreaterThan(t * 0.9 - 2.5);
    }
  });
});

const snapOf = (snap: BuilderCoachSnapshot, w: BuilderWorkout): BuilderCoachSnapshot => ({ ...snap, workout: w, draftVersion: snap.draftVersion + 1 });
const withBench = (w: BuilderWorkout, f: (s: BuilderSlot) => BuilderSlot): BuilderWorkout => ({ ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.exerciseId === 'bench' ? f(s) : s)) })) });

describe('D4 review B1: the coach never ratchets the back-offs', () => {
  const setLoad = (key: string, value: number) => ({ op: 'load' as const, slotKey: key, direction: null, value, unit: 'kg' as const });

  it('heavier (102.5) then set 100: back-offs back to the built 95, not 92.5', () => {
    const { snap, env, key } = setup();
    const b0 = backoffs(snap.workout);
    expect(b0.every((b) => b === 95)).toBe(true);
    const up = applyBuilderEdits(snap, [{ op: 'load', slotKey: key, direction: 'heavier', value: null, unit: null }], env).workout;
    const back = applyBuilderEdits(snapOf(snap, up), [setLoad(key, 100)], env).workout;
    expect(topLoad(benchOf(back) as BuilderSlot)).toBe(100);
    expect(backoffs(back)).toEqual(b0);
  });

  it('Ben typed 110; the coach steps it down (lighter → 107.5): back-offs follow the coach’s top (100); set 100: back to 95', () => {
    const { snap, env, key } = setup();
    const b0 = backoffs(snap.workout);
    const typed = withBench(snap.workout, (s) => {
      const r = editSetRow(s, s.rows.findIndex((x) => x.type === 'top'), { kind: 'load', value: 110 }, env.ctx.loads('bench'));
      if (!r.ok) throw new Error(r.reason);
      return r.slot;
    });
    expect(backoffs(typed)).toEqual(b0);
    const stepped = applyBuilderEdits(snapOf(snap, typed), [{ op: 'load', slotKey: key, direction: 'lighter', value: null, unit: null }], env).workout;
    expect(topLoad(benchOf(stepped) as BuilderSlot)).toBe(107.5);
    // 95 × 107.5 / 100 = 102.1 → 100 on the bar (7 % below, inside Balanced).
    expect(backoffs(stepped).every((b) => b === 100)).toBe(true);
    const set = applyBuilderEdits(snapOf(snap, typed), [setLoad(key, 100)], env).workout;
    expect(backoffs(set)).toEqual(b0);
  });

  it('lighter (97.5) then heavier: 92.5, then back to 95; lighter twice lands where one lighter step to the same top does', () => {
    const { snap, env, key } = setup();
    const down1 = applyBuilderEdits(snap, [setLoad(key, 97.5)], env).workout;
    // 95 × 97.5 / 100 = 92.6 → 92.5.
    expect(backoffs(down1).every((b) => b === 92.5)).toBe(true);
    const up = applyBuilderEdits(snapOf(snap, down1), [setLoad(key, 100)], env).workout;
    expect(backoffs(up)).toEqual(backoffs(snap.workout));
    const twice = applyBuilderEdits(snapOf(snap, applyBuilderEdits(snap, [setLoad(key, 95)], env).workout), [setLoad(key, 90)], env).workout;
    const once = applyBuilderEdits(snap, [setLoad(key, 90)], env).workout;
    expect(backoffs(twice)).toEqual(backoffs(once));
  });

  it('a saved workout’s own back-offs (no anchor): the coach’s 80 lowers 90 → 70 (same %), 100 again puts 90 back', () => {
    const { snap, env, key } = setup();
    const saved = withBench(snap.workout, (s) => ({
      ...s,
      source: 'saved',
      anchorE1rm: null,
      repRange: { min: 5, max: 5 },
      rows: [
        { type: 'top', reps: 5, load: 100, rpe: 8 },
        { type: 'backoff', reps: 5, load: 90, rpe: 8 },
        { type: 'backoff', reps: 5, load: 90, rpe: 8 },
      ],
    }));
    const low = applyBuilderEdits(snapOf(snap, saved), [setLoad(key, 80)], env).workout;
    expect(backoffs(low)).toEqual([70, 70]);
    const back = applyBuilderEdits(snapOf(snap, low), [setLoad(key, 100)], env).workout;
    expect(topLoad(benchOf(back) as BuilderSlot)).toBe(100);
    expect(backoffs(back)).toEqual([90, 90]);
  });

  it('MEDIUM (c): with a heavier top Ben typed, the coach’s “more reps” never makes a back-off heavier', () => {
    const { snap, env, key } = setup();
    const typed = withBench(snap.workout, (s) => {
      const r = editSetRow(s, s.rows.findIndex((x) => x.type === 'top'), { kind: 'load', value: 110 }, env.ctx.loads('bench'));
      if (!r.ok) throw new Error(r.reason);
      return r.slot;
    });
    const before = backoffs(typed);
    const more = applyBuilderEdits(snapOf(snap, typed), [{ op: 'reps', slotKey: key, reps: 10 }], env).workout;
    backoffs(more).forEach((b, i) => {
      expect(b ?? Infinity).toBeLessThanOrEqual(before[i] ?? 0);
    });
  });
});

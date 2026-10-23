import { describe, expect, it } from 'vitest';
import { buildFromSetup, carriedSets, fitWorkoutToTime, fromDraftPlan, landCarryOver, pendingCarryOvers, slotsOf, toDraftPlan, withCarriedBack, withCoachSetCounts, withoutCarried, workingCount, type BuilderContext, type BuilderWorkout, type CarryItem } from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

/**
 * (Ben, 23 Oct) Two gaps of the 23 Oct build:
 * - carried-over sets are never cut again by Time on the landing day, on Your workout too (review ben-8-decisions S3),
 *   and at most 4 carried sets land on one day in all (PM, 23 Oct);
 * - the coach's set count for next time reaches every way the next workout is planned (`withCoachSetCounts`), within
 *   the guardrails (1 to 10 working sets, never on a pain-flagged movement).
 */

const ctx = context();
const chest = (): BuilderWorkout => buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 4 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] }, pool, ctx).workout;
const TRI: CarryItem = { group: 'Arms', sets: 3, exerciseId: 'pushdown', toDayIndex: 2, toDayName: 'Shoulders' };
const slot = (w: BuilderWorkout, id: string) => slotsOf(w.blocks).find((s) => s.exerciseId === id);
const codec = { info, catalogueIdOf: (id: string) => id, checkedOnOf: () => null };

describe('carried sets aren’t cut again (review ben-8-decisions S3)', () => {
  it('landing marks the slot; the mark survives the draft codec (force-close)', () => {
    const landed = landCarryOver(chest(), [TRI], ctx).workout;
    const tri = slot(landed, 'pushdown');
    expect(tri?.carried).toBe(3);
    const back = fromDraftPlan(toDraftPlan(landed, codec));
    expect(slot(back, 'pushdown')?.carried).toBe(3);
  });

  it('without / back: the workout without the carried sets, then exactly as it was', () => {
    const landed = landCarryOver(chest(), [TRI], ctx).workout;
    const { workout, held } = withoutCarried(landed, ctx);
    const was = slot(landed, 'pushdown');
    expect(was === undefined ? 0 : workingCount(was) - carriedSets(was)).toBe(workingCount(slot(workout, 'pushdown') ?? { rows: [] }));
    expect(held).toHaveLength(1);
    const again = withCarriedBack(workout, held, ctx);
    expect(workingCount(slot(again, 'pushdown') ?? { rows: [] })).toBe(workingCount(was ?? { rows: [] }));
    expect(slot(again, 'pushdown')?.carried).toBe(3);
  });

  it('Your workout’s Time on the landing day keeps every carried set, at every length', () => {
    const landed = landCarryOver(chest(), [TRI], ctx).workout;
    const tri = slot(landed, 'pushdown');
    if (tri === undefined) throw new Error('fixture');
    for (const to of [50, 40, 30, 20]) {
      const r = fitWorkoutToTime({ current: landed, fit: null, minutes: 999, to, ctx, mainGroup: 'Chest', supersets: false });
      const now = slot(r.workout, 'pushdown');
      expect(now?.carried, `at ${String(to)}`).toBe(3);
      expect(now === undefined ? 0 : workingCount(now), `at ${String(to)}`).toBeGreaterThanOrEqual(3);
      // Then more Time again: the workout as it was, carried sets and all.
      const back = fitWorkoutToTime({ current: r.workout, fit: r.fit, minutes: 999, to: 999, ctx, mainGroup: 'Chest', supersets: false });
      expect(workingCount(slot(back.workout, 'pushdown') ?? { rows: [] })).toBe(workingCount(tri));
    }
  });

  it('an exercise the carry-over added stays through Time', () => {
    const w = chest();
    const noTri: BuilderWorkout = { ...w, blocks: w.blocks.flatMap((b) => { const slots = b.slots.filter((x) => x.exerciseId !== 'pushdown'); return slots.length === 0 ? [] : [{ ...b, slots }]; }) };
    const landed = landCarryOver(noTri, [{ ...TRI, sets: 2 }], ctx).workout;
    expect(slot(landed, 'pushdown')?.carried).toBe(2);
    const r = fitWorkoutToTime({ current: landed, fit: null, minutes: 999, to: 25, ctx, mainGroup: 'Chest', supersets: false });
    expect(workingCount(slot(r.workout, 'pushdown') ?? { rows: [] })).toBe(2);
  });

  it('at most 4 carried sets land on one day in all, oldest first (PM, 23 Oct)', () => {
    const base = { planId: 'p', dayIndex: 2, nowUtc: '2026-10-22T10:00:00.000Z' };
    const src = (sessionId: string, atUtc: string, items: CarryItem[]) => ({ draft: { sessionId, builderKey: { planId: 'p', dayIndex: 0, splitDayId: 'chest', mainLiftExerciseId: null, localDate: '2026-10-20' } }, items, atUtc });
    const s1 = { sessionId: 's1', startedAtUtc: '2026-10-20T10:00:00.000Z', planDay: { planId: 'p', dayIndex: 0 } };
    const s3 = { sessionId: 's3', startedAtUtc: '2026-10-21T10:00:00.000Z', planDay: { planId: 'p', dayIndex: 1 } };
    const sh: CarryItem = { group: 'Shoulders', sets: 4, exerciseId: 'lateral_raise', toDayIndex: 2, toDayName: 'Shoulders' };
    // The newer one listed first: the older one still lands first.
    const r = pendingCarryOvers({ ...base, sources: [src('s3', '2026-10-21T11:00:00.000Z', [sh]), src('s1', '2026-10-20T11:00:00.000Z', [TRI])], sessions: [s1, s3] });
    expect(r.reduce((n, x) => n + x.sets, 0)).toBe(4);
    expect(r).toEqual([TRI, { ...sh, sets: 1 }]);
  });
});

describe('the coach’s set count for next time (Ben, 23 Oct)', () => {
  const withSets = (sets: Record<string, number>, pain: readonly string[] = []): BuilderContext => ({
    ...ctx,
    loads: (id) => ({ ...ctx.loads(id), ...(sets[id] === undefined ? {} : { coachSets: sets[id] }), ...(pain.includes(id) ? { painCap: 50 } : {}) }),
  });

  it('a slot takes the coach’s count (an applied extra set too); others as they were', () => {
    const w = chest();
    const fly = slot(w, 'cable_fly');
    if (fly === undefined) throw new Error('fixture');
    const r = withCoachSetCounts(w, withSets({ cable_fly: workingCount(fly) + 1 }));
    expect(workingCount(slot(r.workout, 'cable_fly') ?? { rows: [] })).toBe(workingCount(fly) + 1);
    expect(r.changed).toEqual([fly.key]);
    for (const s of slotsOf(w.blocks)) if (s.exerciseId !== 'cable_fly') expect(workingCount(slot(r.workout, s.exerciseId) ?? { rows: [] })).toBe(workingCount(s));
  });

  it('guardrails: 1 to 10 working sets; never on a pain-flagged movement; the same count: nothing', () => {
    const w = chest();
    expect(workingCount(slot(withCoachSetCounts(w, withSets({ cable_fly: 40 })).workout, 'cable_fly') ?? { rows: [] })).toBe(10);
    expect(workingCount(slot(withCoachSetCounts(w, withSets({ cable_fly: 0 })).workout, 'cable_fly') ?? { rows: [] })).toBe(1);
    const fly = slot(w, 'cable_fly');
    expect(withCoachSetCounts(w, withSets({ cable_fly: 5 }, ['cable_fly'])).changed).toEqual([]);
    expect(withCoachSetCounts(w, withSets({ cable_fly: fly === undefined ? 3 : workingCount(fly) })).changed).toEqual([]);
    expect(withCoachSetCounts(w, ctx).workout).toBe(w);
  });
});

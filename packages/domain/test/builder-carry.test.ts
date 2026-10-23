import { describe, expect, it } from 'vitest';
import { BuilderSetupSchema } from '@fizz/schemas';
import { buildFromSetup, carriedItems, carryItemText, carryOverOffer, carryTargetDay, fitLostByGroup, fitToMinutes, landCarryOver, pendingCarryOvers, slotsOf, workingCount, type BuilderWorkout, type CarryDay, type CarryItem } from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

/**
 * (Ben, 23 Oct; fit-to-time SP3) The carry-over of the sets Time cut: a real offer (Carry over / ✕), never applied by
 * default, at most 4 sets in all, by muscle to each one's next day in plan order (abs: the next day); it lands on that
 * day's next workout after its own fit, never more than the fit as it ended took.
 */

const ctx = context();
const chest = (): BuilderWorkout => buildFromSetup({ minutes: 999, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 4 }, { group: 'Triceps', count: 1 }, { group: 'Abs', count: 1 }] }, pool, ctx).workout;
const DAYS: CarryDay[] = [
  { dayIndex: 0, name: 'Chest', groups: ['Chest', 'Triceps', 'Abs'] },
  { dayIndex: 1, name: 'Back', groups: ['Back', 'Biceps'] },
  { dayIndex: 2, name: 'Shoulders', groups: ['Shoulders', 'Triceps'] },
  { dayIndex: 3, name: 'Legs', groups: ['Legs'] },
];

describe('carry-over offer (Ben, 23 Oct)', () => {
  it('by muscle to each one’s next day; at most 4 in all; 2 or more per group; the main lift never counts', () => {
    const w = chest();
    const fit = fitToMinutes(w, ctx, { minutes: 50, mainGroup: 'Chest', grow: false, supersets: false });
    const offer = carryOverOffer({ steps: fit.steps, base: w, info, mainGroup: 'Chest', fromDayIndex: 0, days: DAYS });
    // 50: a fly set and the whole pushdown went: 3 triceps sets to the next day with triceps (Shoulders).
    expect(offer).toEqual([{ group: 'Triceps', sets: 3, exerciseId: 'pushdown', toDayIndex: 2, toDayName: 'Shoulders' }]);
    expect(carryItemText(offer[0] as CarryItem)).toBe('+3 Triceps sets on your next Shoulders day');
    // 25: nine chest sets went; at most 4 in all; chest goes to the next Chest day (wraps to itself? never: none other).
    const short = fitToMinutes(w, ctx, { minutes: 25, mainGroup: 'Chest', grow: false, supersets: false });
    const big = carryOverOffer({ steps: short.steps, base: w, info, mainGroup: 'Chest', fromDayIndex: 0, days: DAYS });
    expect(big.reduce((n, x) => n + x.sets, 0)).toBeLessThanOrEqual(4);
    expect(big.every((x) => x.sets >= 2)).toBe(true);
    expect(big.find((x) => x.group === 'Chest')).toBeUndefined();
    // No cut: nothing.
    expect(carryOverOffer({ steps: [], base: w, info, mainGroup: 'Chest', fromDayIndex: 0, days: DAYS })).toEqual([]);
  });

  it('routing: the next day in plan order with that group (wrapping); abs to the next day; none: nothing', () => {
    expect(carryTargetDay('Triceps', 2, DAYS)?.name).toBe('Chest');
    expect(carryTargetDay('Biceps', 0, DAYS)?.name).toBe('Back');
    expect(carryTargetDay('Abs', 3, DAYS)?.name).toBe('Chest');
    expect(carryTargetDay('Legs', 3, DAYS)).toBeNull();
  });

  it('what still carries: never more per group than the fit as it ended took; skipped carries nothing', () => {
    const item: CarryItem = { group: 'Triceps', sets: 3, exerciseId: 'pushdown', toDayIndex: 2, toDayName: 'Shoulders' };
    expect(carriedItems({ choice: 'carried', atUtc: '2026-10-23T10:00:00.000Z', items: [item] }, [{ group: 'Triceps', sets: 2 }])).toEqual([{ ...item, sets: 2 }]);
    expect(carriedItems({ choice: 'carried', atUtc: '2026-10-23T10:00:00.000Z', items: [item] }, [])).toEqual([]);
    expect(carriedItems({ choice: 'skipped', atUtc: '2026-10-23T10:00:00.000Z', items: [item] }, [{ group: 'Triceps', sets: 3 }])).toEqual([]);
    expect(BuilderSetupSchema.shape.carryOver.safeParse({ choice: 'carried', atUtc: '2026-10-23T10:00:00.000Z', items: [{ ...item, exerciseId: '00000000-0000-4000-8000-000000000001' }] }).error?.issues ?? []).toEqual([]);
  });

  it('pending: from a workout done (its session), within 14 days, until that day is started after it; several add up, capped at 4', () => {
    const item: CarryItem = { group: 'Triceps', sets: 3, exerciseId: 'pushdown', toDayIndex: 2, toDayName: 'Shoulders' };
    const src = (sessionId: string | null, atUtc = '2026-10-20T10:00:00.000Z') => ({ draft: { sessionId, builderKey: { planId: 'p', dayIndex: 0, splitDayId: 'chest', mainLiftExerciseId: null, localDate: '2026-10-20' } }, items: [item], atUtc });
    const base = { planId: 'p', dayIndex: 2, nowUtc: '2026-10-22T10:00:00.000Z' };
    const s1 = { sessionId: 's1', startedAtUtc: '2026-10-20T10:00:00.000Z', planDay: { planId: 'p', dayIndex: 0 } };
    expect(pendingCarryOvers({ ...base, sources: [src('s1')], sessions: [s1] })).toEqual([item]);
    // Not done (no session): nothing.
    expect(pendingCarryOvers({ ...base, sources: [src(null)], sessions: [s1] })).toEqual([]);
    expect(pendingCarryOvers({ ...base, sources: [src('s9')], sessions: [s1] })).toEqual([]);
    // Another day: nothing.
    expect(pendingCarryOvers({ ...base, dayIndex: 1, sources: [src('s1')], sessions: [s1] })).toEqual([]);
    // Shoulders done since: used.
    expect(pendingCarryOvers({ ...base, sources: [src('s1')], sessions: [s1, { sessionId: 's2', startedAtUtc: '2026-10-21T10:00:00.000Z', planDay: { planId: 'p', dayIndex: 2 } }] })).toEqual([]);
    // Older than 14 days: gone.
    expect(pendingCarryOvers({ ...base, nowUtc: '2026-11-05T10:00:00.000Z', sources: [src('s1')], sessions: [s1] })).toEqual([]);
    // Two sources: add up, at most 4.
    const s3 = { sessionId: 's3', startedAtUtc: '2026-10-21T10:00:00.000Z', planDay: { planId: 'p', dayIndex: 0 } };
    expect(pendingCarryOvers({ ...base, sources: [src('s1'), src('s3')], sessions: [s1, s3] })).toEqual([{ ...item, sets: 4 }]);
  });

  it('landing: on the group’s first exercise (not the main lift); else the exercise it came from, added', () => {
    const w = chest();
    const tri = slotsOf(w.blocks).find((s) => s.exerciseId === 'pushdown');
    const before = tri === undefined ? 0 : workingCount(tri);
    const r = landCarryOver(w, [{ group: 'Triceps', sets: 3, exerciseId: 'pushdown', toDayIndex: 2, toDayName: 'Shoulders' }], ctx);
    expect(slotsOf(r.workout.blocks).find((s) => s.exerciseId === 'pushdown')?.rows.filter((x) => x.type !== 'warmup')).toHaveLength(before + 3);
    expect(r.changed).toEqual([tri?.key]);
    const noTri: BuilderWorkout = { ...w, blocks: w.blocks.flatMap((b) => { const slots = b.slots.filter((x) => x.exerciseId !== 'pushdown'); return slots.length === 0 ? [] : [{ ...b, slots }]; }) };
    const added = landCarryOver(noTri, [{ group: 'Triceps', sets: 2, exerciseId: 'pushdown', toDayIndex: 2, toDayName: 'Shoulders' }], ctx);
    const slot = slotsOf(added.workout.blocks).find((s) => s.exerciseId === 'pushdown');
    expect(slot === undefined ? 0 : workingCount(slot)).toBe(2);
  });

  it('lost by group counts a left-out exercise’s sets and a trimmed one’s loss', () => {
    const w = chest();
    const fly = slotsOf(w.blocks).find((s) => s.exerciseId === 'cable_fly');
    const tri = slotsOf(w.blocks).find((s) => s.exerciseId === 'pushdown');
    if (fly === undefined || tri === undefined) throw new Error('fixture');
    expect(fitLostByGroup([{ kind: 'sets', slotKey: fly.key, exerciseId: 'cable_fly', from: 3, to: 2 }, { kind: 'drop', slotKey: tri.key, exerciseId: 'pushdown' }], w, info)).toEqual([
      { group: 'Chest', sets: 1, exerciseId: 'cable_fly' },
      { group: 'Triceps', sets: workingCount(tri), exerciseId: 'pushdown' },
    ]);
  });
});

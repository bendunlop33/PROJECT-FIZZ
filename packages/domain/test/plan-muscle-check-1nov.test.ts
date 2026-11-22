import { describe, expect, it } from 'vitest';

import { planMuscleGapLines, type MuscleCreditInfo } from '../src';
import type { PlanDayDraft } from '@fizz/schemas';

/**
 * (Ben, 1 Nov: "the coach should have caught" it) The deterministic check a proposed or built plan gets: one line per
 * group out of range on its typical week. `checkPlanProposal` adds each as a `muscle_gap` plan check (card + the
 * coach's guard notes; packages/coach/test/plan-muscle-check-1nov.test.ts runs it through the executor).
 */
const INFO: Record<string, MuscleCreditInfo> = {
  row: { primaryMuscles: ['lats', 'upper_back'], secondaryMuscles: ['biceps', 'rear_delts'], movementPattern: 'horizontal_pull' },
  pulldown: { primaryMuscles: ['lats'], secondaryMuscles: ['biceps'], movementPattern: 'vertical_pull' },
  curl: { primaryMuscles: ['biceps'], secondaryMuscles: ['forearms'], movementPattern: 'isolation' },
};
const slot = (exerciseId: string, sets: number, order: number) => ({ slotKey: `${exerciseId}-${String(order)}`, exerciseId, catalogueId: exerciseId, order, main: order === 0, supersetGroup: null, setTemplates: Array.from({ length: sets }, () => ({ setType: 'working' as const, reps: { min: 8, max: 12 }, durationS: null, targetRpe: null, restS: null })) });
const day = (index: number, name: string, slots: ReturnType<typeof slot>[]): PlanDayDraft => ({ index, name, splitDayId: null, focus: 'coach_picks', minutes: 60, plan: { slots }, checks: [] });

describe('planMuscleGapLines', () => {
  it('a pull plan with no curls: Biceps below its range (assisted 6 → 4–8); with curls, no Biceps line', () => {
    const days = [day(0, 'Pull A', [slot('row', 4, 0), slot('pulldown', 4, 1)]), day(1, 'Pull B', [slot('row', 4, 0)])];
    const lines = planMuscleGapLines(days, { goal: 'muscle', priorities: new Set() }, (id) => INFO[id] ?? null);
    expect(lines).toContain('Biceps 0/wk · below 4–8');
    const fixed = [days[0] as PlanDayDraft, day(1, 'Pull B', [slot('row', 4, 0), slot('curl', 4, 1)])];
    expect(planMuscleGapLines(fixed, { goal: 'muscle', priorities: new Set() }, (id) => INFO[id] ?? null).some((l) => l.startsWith('Biceps'))).toBe(false);
    expect(planMuscleGapLines(days, { goal: null, priorities: new Set() }, (id) => INFO[id] ?? null)).toEqual([]);
  });
});

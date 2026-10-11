import { describe, expect, it } from 'vitest';
import { ProgressionRuleSchema } from '@fizz/schemas';

import { builtInDefaultRule, calculateNextTargets, nextTargetsFor, plannedSetsFromTargets, ruleCategory, starterExercises, type HistorySession } from '../src/index';
import { at, barbell, dumbbells, id, kg, OWNER, stack } from './fixtures';

/** ADR 0010 amendment 2 (provisional): the built-in default rule by exercise category. */
describe('built-in default rule by category', () => {
  const starters = new Map(starterExercises('2026-10-09T00:00:00.000Z').map((e) => [e.name, e]));
  const cat = (name: string, kind: Parameters<typeof ruleCategory>[1]) => ruleCategory(starters.get(name) ?? null, kind, 'total');

  it('classifies main barbell lifts, other compounds and accessories', () => {
    for (const n of ['Bench press', 'Back squat', 'Deadlift', 'Overhead press', 'Barbell row', 'Incline bench press']) expect([n, cat(n, 'barbell')]).toEqual([n, 'main_barbell']);
    for (const n of ['Romanian deadlift', 'Hip thrust']) expect([n, cat(n, 'barbell')]).toEqual([n, 'compound']);
    for (const n of ['Dumbbell bench press', 'Lat pulldown', 'Leg press', 'Bulgarian split squat', 'Pull-up']) expect([n, cat(n, null)]).toEqual([n, 'compound']);
    for (const n of ['Dumbbell curl', 'Lateral raise', 'Triceps pushdown', 'Leg extension', 'Leg curl', 'Face pull']) expect([n, cat(n, null)]).toEqual([n, 'isolation']);
    // No catalogue info (e.g. a custom exercise read without it): the widest range.
    expect(ruleCategory(null, 'barbell', 'total')).toBe('isolation');
    // A barbell-compatible main lift with no equipment attached still counts by its load convention.
    expect(ruleCategory(starters.get('Bench press') ?? null, null, 'total')).toBe('main_barbell');
    // A trap-bar deadlift has its own equipment kind (its bar weight differs) but is still a main lift; EZ-bar curls stay accessories.
    const trap = { movementPattern: 'hinge', mechanic: 'compound' as const, family: 'deadlift', compatibleEquipment: ['trap_bar' as const] };
    expect(ruleCategory(trap, null, 'total')).toBe('main_barbell');
    expect(ruleCategory(trap, 'trap_bar', 'total')).toBe('main_barbell');
    expect(ruleCategory({ movementPattern: 'arms', mechanic: 'isolation', family: 'curl', compatibleEquipment: ['ez_bar'] }, null, 'total')).toBe('isolation');
  });

  it('gives valid, labelled rules: 3–6 @ RPE 8.5, 6–10 @ 9, 8–12 @ 9', () => {
    const main = builtInDefaultRule(OWNER, 'kg', 5, 'main_barbell');
    expect(ProgressionRuleSchema.safeParse(main).success).toBe(true);
    expect(main).toMatchObject({ repRange: { min: 3, max: 6 }, maxRpeToProgress: 8.5, workingSets: 5 });
    expect(main.name).toBe('3–6 reps, up to RPE 8.5');
    expect(builtInDefaultRule(OWNER, 'lb', 3, 'compound')).toMatchObject({ repRange: { min: 6, max: 10 }, maxRpeToProgress: 9, loadIncrement: { value: 5, unit: 'lb' } });
    expect(builtInDefaultRule(OWNER, 'kg', 3, 'isolation')).toMatchObject({ repRange: { min: 8, max: 12 }, maxRpeToProgress: 9 });
    expect(new Set([builtInDefaultRule(OWNER, 'kg', 3, 'main_barbell').id, builtInDefaultRule(OWNER, 'kg', 3, 'compound').id, builtInDefaultRule(OWNER, 'lb', 3, 'main_barbell').id]).size).toBe(3);
  });

  it('5 × 5 bench at 100 kg, RPE 8: the main-lift rule holds steady instead of cutting the load (review SP1)', () => {
    const bar = barbell();
    const sessions: HistorySession[] = [0, 1].map((w) => ({
      sessionId: id(700 + w),
      performedAtUtc: at(-(2 - w) * 7 * 86_400).utc,
      equipmentId: bar.id,
      gymId: null,
      imported: false,
      sets: [1, 2, 3, 4, 5].map(() => ({ setType: 'working' as const, side: null, load: kg(100), reps: 5, rpe: 8, rir: null })),
    }));
    const pain = { active: false, reportedAtUtc: null };
    const base = { exerciseName: 'Bench press', measurement: 'reps' as const, history: sessions, equipment: bar, unit: 'kg' as const, convention: 'total' as const, pain };
    const main = calculateNextTargets({ ...base, rule: builtInDefaultRule(OWNER, 'kg', 5, 'main_barbell') });
    // 5 reps is inside 3–6: keep the load and add reps; the 8–12 rule would have cut it.
    expect(main.decision).toBe('hold');
    expect(main.sets[0]?.load).toEqual(kg(100));
    const old = calculateNextTargets({ ...base, rule: builtInDefaultRule(OWNER, 'kg', 5, 'isolation') });
    expect(old.decision).toBe('reduce_load');
  });
});

describe('next targets for an added exercise (review S3)', () => {
  const pulldown = starterExercises('x').find((e) => e.name === 'Lat pulldown');
  if (!pulldown) throw new Error('fixture');
  const st = stack();
  const hist: HistorySession = { sessionId: id(710), performedAtUtc: at(-86_400).utc, equipmentId: st.id, gymId: null, imported: false, sets: [1, 2, 3].map(() => ({ setType: 'working' as const, side: null, load: kg(40, 'stack'), reps: 10, rpe: 8, rir: null })) };
  const req = {
    ownerId: OWNER,
    exerciseId: pulldown.id,
    exerciseName: pulldown.name,
    measurement: 'reps' as const,
    unit: 'kg' as const,
    convention: 'stack' as const,
    equipment: st,
    exercise: pulldown,
    rule: null,
    workingSets: 3,
    history: [hist],
    painFlags: [],
    sessionPain: { active: false, reportedAtUtc: null },
  };

  it('plans the same sets the summary showed, labelled as the built-in rule, on achievable loads', () => {
    const { result, rule } = nextTargetsFor(req);
    expect(rule).toMatchObject({ method: 'double_progression', repRange: { min: 6, max: 10 } });
    expect(result.decision).toBe('increase_load');
    const plan = plannedSetsFromTargets(result);
    expect(plan).toHaveLength(3);
    expect(plan?.[0]).toEqual({ setType: 'working', planned: { load: kg(45, 'stack'), reps: { min: 6, max: 10 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' } });
  });

  it('pain mentioned without a movement holds targets; no history plans nothing', () => {
    const held = nextTargetsFor({ ...req, sessionPain: { active: true, reportedAtUtc: at(0).utc } });
    expect(held.result.decision).toBe('halted_pain');
    expect(plannedSetsFromTargets(held.result)?.[0]?.planned.load).toEqual(kg(40, 'stack'));
    expect(plannedSetsFromTargets(nextTargetsFor({ ...req, history: [] }).result)).toBeNull();
  });

  it('per-hand dumbbells never plan past the rack', () => {
    const db = dumbbells();
    const press = starterExercises('x').find((e) => e.name === 'Dumbbell bench press');
    const top = Math.max(...(db.kind === 'dumbbells' ? db.loads : [0]));
    const h2: HistorySession = { sessionId: id(711), performedAtUtc: at(-86_400).utc, equipmentId: db.id, gymId: null, imported: false, sets: [1, 2].map(() => ({ setType: 'working' as const, side: null, load: kg(top, 'per_hand'), reps: 10, rpe: 7, rir: null })) };
    const plan = plannedSetsFromTargets(nextTargetsFor({ ...req, exerciseId: press?.id ?? '', exerciseName: 'Dumbbell bench press', convention: 'per_hand', equipment: db, exercise: press ?? null, history: [h2] }).result);
    expect(plan?.every((p) => (p.planned.load?.value ?? 0) <= top)).toBe(true);
  });
});

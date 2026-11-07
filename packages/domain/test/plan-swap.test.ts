import { describe, expect, it } from 'vitest';

import { buildPlanFromAnswers, notPreferredInPlan, pbNotPreferred, pbNotPreferredReplacement, pbWithSessions, planSwapDirection, planSwapPreview, type PlanSwapDayInput } from '../src/index';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben, 30 Oct, build 486) One exercise swapped in every plan day where it appears, and Any preferences' not preferred
 * reaching the plan. Pure.
 */

const LP = 'machine-leg-press';
const LE = 'machine-leg-extension';
const SS = 'dumbbell-bulgarian-split-squat';
const row = (id: string, exerciseId: string, order: number) => ({ id, exerciseId, order });
const BENS_PLAN: PlanSwapDayInput[] = [
  { routineId: 'push-a', name: 'Push A', version: 3, rows: [row('p1', 'barbell-bench-press', 0)] },
  { routineId: 'legs-a', name: 'Legs A', version: 4, rows: [row('a1', 'barbell-back-squat', 0), row('a2', LE, 1), row('a3', 'machine-lying-leg-curl', 2)] },
  { routineId: 'legs-b', name: 'Legs B', version: 2, rows: [row('b1', 'barbell-romanian-deadlift', 0), row('b2', LP, 1), row('b3', LE, 2)] },
];

describe('pbNotPreferred: what Any preferences marks not preferred', () => {
  it('Quad extra → Split squat: leg extension is not preferred; the pick and likes never are', () => {
    expect([...pbNotPreferred(answers({ prefs: { quads: 1 } }))]).toEqual([LE]);
    // Other: both listed options are not preferred.
    expect([...pbNotPreferred(answers({ prefs: { quads: { other: 'dumbbell-step-up' } } }))].sort()).toEqual([SS, LE].sort());
    // A like elsewhere wins over not preferred.
    expect(pbNotPreferred(answers({ prefs: { quads: 1 }, likes: [LE] })).has(LE)).toBe(false);
    expect(pbNotPreferred(answers({ never: ['cable-fly'] })).has('cable-fly')).toBe(true);
    expect(pbNotPreferred(answers({ prefs: { quads: 'either' } })).size).toBe(0);
  });

  it('a new plan from those answers: never is never planned; not preferred ranks last (it can still fill a slot)', () => {
    const a = pbWithSessions(answers({ prefs: { quads: 1 }, split: 'ppl' }), 6);
    const p = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
    const keys = p.days.flatMap((d) => d.exercises.map((e) => e.key));
    // The pick is planned.
    expect(keys).toContain(SS);
    // Ranked last (plan-builder.md §2), so a 6-day PPL at this gym leaves it out. It is not dropped outright: with few
    // quad options usable it can still fill a slot. `never` drops it whatever.
    expect(keys).not.toContain(LE);
    const never = buildPlanFromAnswers({ answers: { ...a, never: [LE] }, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
    expect(never.days.flatMap((d) => d.exercises.map((e) => e.key))).not.toContain(LE);
  });
});

describe('planSwapDirection: a not-preferred exercise is never put in', () => {
  const inPlan = (id: string) => BENS_PLAN.some((d) => d.rows.some((r) => r.exerciseId === id));
  it('Ben: "swap leg press and leg extension" read as leg press → leg extension, leg extension not preferred: flipped', () => {
    expect(planSwapDirection({ remove: LP, add: LE, notPreferred: new Set([LE]), inPlan })).toEqual({ kind: 'ok', remove: LE, add: LP, flipped: true });
  });
  it('already the right way round: kept', () => {
    expect(planSwapDirection({ remove: LE, add: LP, notPreferred: new Set([LE]), inPlan })).toEqual({ kind: 'ok', remove: LE, add: LP, flipped: false });
  });
  it('adding a not-preferred exercise that is not in the plan, or both not preferred: refused', () => {
    expect(planSwapDirection({ remove: LP, add: 'cable-fly', notPreferred: new Set(['cable-fly']), inPlan })).toEqual({ kind: 'refused', reason: 'adds_not_preferred' });
    expect(planSwapDirection({ remove: LP, add: LE, notPreferred: new Set([LE, LP]), inPlan })).toEqual({ kind: 'refused', reason: 'adds_not_preferred' });
    expect(planSwapDirection({ remove: LP, add: LP, notPreferred: new Set(), inPlan })).toEqual({ kind: 'refused', reason: 'same' });
  });
});

describe('planSwapPreview: every plan day with it, only that exercise', () => {
  it('leg extension → leg press: Legs A swaps its row; Legs B already has leg press, so its leg extension row goes; Push A untouched', () => {
    expect(planSwapPreview(BENS_PLAN, LE, LP)).toEqual({
      kind: 'ok',
      days: [
        { routineId: 'legs-a', routineName: 'Legs A', versionBefore: 4, edits: [{ kind: 'swap', rowId: 'a2' }] },
        { routineId: 'legs-b', routineName: 'Legs B', versionBefore: 2, edits: [{ kind: 'remove', rowId: 'b3' }] },
      ],
    });
  });
  it('not in any day, or the same exercise: nothing to do', () => {
    expect(planSwapPreview(BENS_PLAN, 'cable-fly', LP)).toEqual({ kind: 'not_in_plan' });
    expect(planSwapPreview(BENS_PLAN, LP, LP)).toEqual({ kind: 'same' });
  });
  it('a day whose only exercise is going out is swapped, never emptied', () => {
    const days: PlanSwapDayInput[] = [{ routineId: 'x', name: 'X', version: 1, rows: [row('x1', LE, 0)] }];
    expect(planSwapPreview(days, LE, LP)).toEqual({ kind: 'ok', days: [{ routineId: 'x', routineName: 'X', versionBefore: 1, edits: [{ kind: 'swap', rowId: 'x1' }] }] });
  });
});

describe('notPreferredInPlan and the replacement (Settings: In your plan … · Replace)', () => {
  it('leg extension is in Legs A and Legs B', () => {
    expect(notPreferredInPlan(new Set([LE]), BENS_PLAN)).toEqual([{ exerciseId: LE, days: ['Legs A', 'Legs B'] }]);
    expect(notPreferredInPlan(new Set(['cable-fly']), BENS_PLAN)).toEqual([]);
  });
  it('the replacement is his pick on that question, else the first same-muscle alternative that fits', () => {
    const ports = { usable: () => true, held: () => false, alternatives: [LE, 'dumbbell-goblet-squat'] };
    expect(pbNotPreferredReplacement(LE, answers({ prefs: { quads: 1 } }), ports)).toBe(SS);
    expect(pbNotPreferredReplacement(LE, answers({ prefs: { quads: { other: 'dumbbell-step-up' } } }), ports)).toBe('dumbbell-step-up');
    // The pick isn't usable here: the next alternative that is.
    expect(pbNotPreferredReplacement(LE, answers({ prefs: { quads: 1 } }), { ...ports, usable: (k) => k !== SS })).toBe('dumbbell-goblet-squat');
    // Held for pain, or itself not preferred: skipped.
    expect(pbNotPreferredReplacement('cable-fly', answers({ never: ['cable-fly'] }), { usable: () => true, held: (k) => k === 'machine-pec-deck', alternatives: ['machine-pec-deck', 'cable-fly', 'dumbbell-fly'] })).toBe('dumbbell-fly');
    expect(pbNotPreferredReplacement('cable-fly', answers({ never: ['cable-fly'] }), { usable: () => false, held: () => false, alternatives: ['dumbbell-fly'] })).toBeNull();
  });
});

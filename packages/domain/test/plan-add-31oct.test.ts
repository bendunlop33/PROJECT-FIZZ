import { describe, expect, it } from 'vitest';

import { oneExerciseChange, planAddPreview, type PlanSwapDayInput } from '../src/index';

/**
 * (Ben, 31 Oct, build 493: "Can we just add them in after the raises. Can u fix the plan too?") One exercise added to
 * the named plan days, every week, at a chosen place. Pure.
 */

const CURL = 'dumbbell-curl';
const HLR = 'bodyweight-hanging-leg-raise';
const row = (id: string, exerciseId: string, order: number) => ({ id, exerciseId, order });
const PLAN: PlanSwapDayInput[] = [
  { routineId: 'push-a', name: 'Push A', version: 3, rows: [row('p1', 'barbell-bench-press', 0)] },
  { routineId: 'pull-a', name: 'Pull A', version: 4, rows: [row('a1', 'pull-up', 0), row('a2', HLR, 1), row('a3', 'face-pull', 2)] },
  { routineId: 'pull-b', name: 'Pull B', version: 2, rows: [row('b1', 'barbell-row', 0)] },
];
const rowIdOf = (r: string) => `new-${r}`;

describe('planAddPreview', () => {
  it('after the named exercise where the day has it, else at the end; only the named days; names match loosely', () => {
    const p = planAddPreview(PLAN, { add: CURL, dayNames: ['pull a', 'Pull  B'], after: HLR, rowIdOf });
    expect(p).toEqual({
      kind: 'ok',
      days: [
        { routineId: 'pull-a', routineName: 'Pull A', versionBefore: 4, rowId: 'new-pull-a', afterRowId: 'a2' },
        { routineId: 'pull-b', routineName: 'Pull B', versionBefore: 2, rowId: 'new-pull-b', afterRowId: null },
      ],
      already: [],
    });
  });

  it('at the end when no place is given', () => {
    const p = planAddPreview(PLAN, { add: CURL, dayNames: ['Pull A'], after: null, rowIdOf });
    expect(p.kind === 'ok' ? p.days.map((d) => d.afterRowId) : null).toEqual([null]);
  });

  it('a day that already has it is left as it is (never a second copy); all of them: refused', () => {
    const withCurl = PLAN.map((d) => (d.name === 'Pull B' ? { ...d, rows: [...d.rows, row('b2', CURL, 1)] } : d));
    const p = planAddPreview(withCurl, { add: CURL, dayNames: ['Pull A', 'Pull B'], after: null, rowIdOf });
    expect(p.kind === 'ok' ? [p.days.map((d) => d.routineName), p.already] : null).toEqual([['Pull A'], ['Pull B']]);
    expect(planAddPreview(withCurl, { add: CURL, dayNames: ['Pull B'], after: null, rowIdOf })).toEqual({ kind: 'already', days: ['Pull B'] });
  });

  it('a day name that is no plan day refuses the whole add', () => {
    expect(planAddPreview(PLAN, { add: CURL, dayNames: ['Pull A', 'Arms'], after: null, rowIdOf })).toEqual({ kind: 'unknown_days', unknown: ['Arms'] });
  });

  it('the template write puts the row straight after its place (Every week), with the coach’s sets and reps', () => {
    const rows = PLAN[1]?.rows.map((r) => ({ ...r, equipmentId: null, supersetGroup: null, setTemplates: [], restBySetType: {}, transitionRestS: null, progressionRuleId: null, main: false })) ?? [];
    const out = oneExerciseChange(rows, { kind: 'add', rowId: 'new-pull-a', fromExerciseId: null, toExerciseId: CURL, afterRowId: 'a2', sets: 3, reps: { min: 10, max: 12 }, load: null });
    expect(out.map((r) => r.exerciseId)).toEqual(['pull-up', HLR, CURL, 'face-pull']);
    const added = out.find((r) => r.id === 'new-pull-a');
    expect(added?.setTemplates.map((t) => [t.targetReps, t.targetLoad])).toEqual([
      [{ min: 10, max: 12 }, null],
      [{ min: 10, max: 12 }, null],
      [{ min: 10, max: 12 }, null],
    ]);
  });
});

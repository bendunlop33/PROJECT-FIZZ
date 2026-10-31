import { describe, expect, it } from 'vitest';
import type { Routine, SessionAggregate } from '@fizz/schemas';
import { isMainLiftRow, MAIN_SWAP_COPY, mainLiftFirst, planDayMainLifts, workoutMainLifts } from '../src/index';

/**
 * (Ben, 27 Oct; redesign-27oct.md §E3) The mid-workout Swap sheet on the main lift: the plan day's main-lift
 * alternatives first (as Today's main-lift chips), then everything else.
 */

type T = Pick<Routine, 'exercises'> & Partial<Pick<Routine, 'planDay' | 'createdFromPlan'>>;
const ex = (exerciseId: string, main = false) => ({ exerciseId, ...(main ? { main: true } : {}) }) as unknown as Routine['exercises'][number];
const tpl = (dayIndex: number, main: string | null, planId = 'plan-1', exercises: string[] = []): T => ({
  exercises: exercises.map((x) => ex(x)),
  planDay: { planId, dayIndex, splitDayId: dayIndex === 0 ? 'push' : 'pull', mainLiftExerciseId: main, templateRoutineId: null, templateVersion: null } as unknown as NonNullable<Routine['planDay']>,
});

describe('planDayMainLifts', () => {
  const templates: T[] = [tpl(0, 'bench'), tpl(1, 'row'), tpl(0, 'incline_bb'), tpl(0, 'bench'), tpl(0, 'ohp', 'plan-2'), tpl(0, null, 'plan-1', ['dip'])];

  it('the day’s templates’ main lifts in plan order, once each; other days and other plans are not its options', () => {
    expect(planDayMainLifts({ planDay: { planId: 'plan-1', dayIndex: 0 }, templates, split: null })).toEqual(['bench', 'incline_bb']);
    expect(planDayMainLifts({ planDay: { planId: 'plan-1', dayIndex: 1 }, templates, split: null })).toEqual(['row']);
  });

  it('a template with no main lift of its own uses its main-flagged exercise; none: not an option', () => {
    const own: T = { exercises: [ex('dip'), ex('close_grip', true)], planDay: tpl(0, null).planDay };
    expect(planDayMainLifts({ planDay: { planId: 'plan-1', dayIndex: 0 }, templates: [own, tpl(0, null, 'plan-1', ['fly'])], split: null })).toEqual(['close_grip']);
  });

  it('not started from a plan day: none', () => {
    expect(planDayMainLifts({ planDay: null, templates, split: null })).toEqual([]);
    expect(planDayMainLifts({ planDay: undefined, templates, split: null })).toEqual([]);
  });
});

describe('isMainLiftRow and workoutMainLifts', () => {
  const a = {
    session: { planDay: { mainLiftExerciseId: 'bench' } },
    exercises: [
      { id: 'r1', exerciseId: 'bench' },
      { id: 'r2', exerciseId: 'incline_db' },
      { id: 'r3', exerciseId: 'incline_bb', swappedFrom: { sessionExerciseId: 'r1', opId: 'op' } },
      { id: 'r4', exerciseId: 'machine', swappedFrom: { sessionExerciseId: 'r3', opId: 'op2' } },
    ],
  } as unknown as SessionAggregate;

  it('the plan day’s main lift at Start, unless the draft named its own main slots', () => {
    expect([...workoutMainLifts(a, new Set())]).toEqual(['bench']);
    expect([...workoutMainLifts(a, new Set(['squat']))]).toEqual(['squat']);
    expect([...workoutMainLifts({ session: {} } as unknown as SessionAggregate, new Set())]).toEqual([]);
  });

  it('the main lift’s row, and a row swapped in for it (all the way back); never an accessory', () => {
    const mains = new Set(['bench']);
    expect(isMainLiftRow(a, 'r1', mains)).toBe(true);
    expect(isMainLiftRow(a, 'r3', mains)).toBe(true);
    expect(isMainLiftRow(a, 'r4', mains)).toBe(true);
    expect(isMainLiftRow(a, 'r2', mains)).toBe(false);
    expect(isMainLiftRow(a, 'missing', mains)).toBe(false);
    expect(isMainLiftRow(a, 'r1', new Set())).toBe(false);
  });

  it('a swap loop never hangs', () => {
    const loop = { exercises: [{ id: 'x', exerciseId: 'a', swappedFrom: { sessionExerciseId: 'y', opId: '1' } }, { id: 'y', exerciseId: 'b', swappedFrom: { sessionExerciseId: 'x', opId: '2' } }] } as unknown as SessionAggregate;
    expect(isMainLiftRow(loop, 'x', new Set(['c']))).toBe(false);
  });
});

describe('mainLiftFirst', () => {
  const item = (exerciseId: string) => ({ exerciseId, name: exerciseId });
  const sections = [
    { focus: 'Mid chest', items: [item('db_bench'), item('machine_press'), item('incline_bb')] },
    { focus: 'Upper chest', items: [item('incline_bb2')] },
  ];

  it('the alternatives first under `Main lift`, in plan order; the rest without them; an emptied section goes', () => {
    expect(mainLiftFirst(sections, [item('incline_bb'), item('db_bench')])).toEqual([
      { focus: MAIN_SWAP_COPY.heading, items: [item('incline_bb'), item('db_bench')] },
      { focus: 'Mid chest', items: [item('machine_press')] },
      { focus: 'Upper chest', items: [item('incline_bb2')] },
    ]);
    expect(mainLiftFirst([{ focus: 'Upper chest', items: [item('incline_bb2')] }], [item('incline_bb2')])).toEqual([{ focus: MAIN_SWAP_COPY.heading, items: [item('incline_bb2')] }]);
  });

  it('no alternatives: the sections as they were; a repeated alternative once', () => {
    expect(mainLiftFirst(sections, [])).toEqual(sections);
    expect(mainLiftFirst(sections, [item('x'), item('x')])[0]?.items).toEqual([item('x')]);
  });
});

import { describe, expect, it } from 'vitest';
import type { DraftPlan } from '@fizz/schemas';
import { fromDraftPlan, routineOfBuilderDraft, slotsOf, specsFromSession, specsFromWorkout, workingCount, workoutFromTemplate, type BuilderContext } from '../src/index';
import { context } from './builder-v3-fixture';
import { id } from './fixtures';

/**
 * (22 Oct, Ben: the Workout overview is retired) What Your workout opens on
 * besides Set up: a library workout's exercises, a past workout to do
 * again, a coach chat draft's checked plan, and the routine its session
 * credits (rotation and `last done`).
 */

function ctx(): BuilderContext {
  const base = context();
  let n = 0;
  return { ...base, newKey: () => id(30_000 + (n += 1)) };
}

const tpl = (setType: string) => ({ setType });

describe('a library workout on Your workout (specsFromWorkout)', () => {
  it('its order, main lift, working-set counts (warm-ups not counted) and Ben’s own pairs; an exercise listed twice opens once', () => {
    const specs = specsFromWorkout([
      { exerciseId: 'cable_fly', order: 2, supersetGroup: 'A', setTemplates: [tpl('working'), tpl('working')] },
      { exerciseId: 'bench', order: 0, main: true, supersetGroup: null, setTemplates: [tpl('warmup'), tpl('warmup'), tpl('top'), tpl('backoff'), tpl('backoff')] },
      { exerciseId: 'crunch', order: 3, supersetGroup: 'A', setTemplates: [tpl('working'), tpl('working'), tpl('working')] },
      { exerciseId: 'bench', order: 4, supersetGroup: null, setTemplates: [tpl('working')] },
      { exerciseId: 'pushdown', order: 1, supersetGroup: null, setTemplates: [tpl('warmup')] },
    ]);
    expect(specs).toEqual([
      { exerciseId: 'bench', main: true, workingSets: 3, group: null },
      { exerciseId: 'pushdown', main: false, workingSets: 1, group: null },
      { exerciseId: 'cable_fly', main: false, workingSets: 2, group: 'A' },
      { exerciseId: 'crunch', main: false, workingSets: 3, group: 'A' },
    ]);
    const w = workoutFromTemplate(specs, ctx());
    expect(slotsOf(w.blocks).map((s) => [s.exerciseId, workingCount(s)])).toEqual([
      ['bench', 3],
      ['pushdown', 1],
      ['cable_fly', 2],
      ['crunch', 3],
    ]);
    // Ben's pair stays one round.
    expect(w.blocks.map((b) => b.slots.length)).toEqual([1, 1, 2]);
  });
  it('more than 10 working sets are capped at the builder’s limit', () => {
    expect(specsFromWorkout([{ exerciseId: 'bench', order: 0, supersetGroup: null, setTemplates: Array.from({ length: 14 }, () => tpl('working')) }])[0]?.workingSets).toBe(10);
  });
});

describe('a past workout to do again (specsFromSession)', () => {
  const ex = (rowId: string, exerciseId: string, order: number, supersetGroup: string | null = null, removed?: unknown) => ({ id: rowId, exerciseId, order, supersetGroup, ...(removed === undefined ? {} : { removed }) });
  const set = (sessionExerciseId: string, setType: string, status: string) => ({ sessionExerciseId, setType, status });
  it('the working sets Ben did; none done: the ones planned and not skipped; removed rows, deleted sets and rows with nothing left out', () => {
    const specs = specsFromSession({
      exercises: [ex('r1', 'bench', 0), ex('r2', 'pushdown', 1), ex('r3', 'cable_fly', 2, 'A'), ex('r4', 'crunch', 3, 'A'), ex('r5', 'curl', 4, null, { atUtc: 'x' }), ex('r6', 'hammer', 5), ex('r7', 'bench', 6)],
      sets: [
        set('r1', 'warmup', 'completed'),
        set('r1', 'top', 'completed'),
        set('r1', 'backoff', 'completed'),
        set('r1', 'backoff', 'skipped'),
        set('r2', 'working', 'pending'),
        set('r2', 'working', 'pending'),
        set('r2', 'working', 'skipped'),
        set('r3', 'working', 'completed'),
        set('r4', 'working', 'completed'),
        set('r4', 'working', 'deleted'),
        set('r5', 'working', 'completed'),
        set('r6', 'working', 'skipped'),
        set('r7', 'working', 'completed'),
      ],
    });
    expect(specs).toEqual([
      { exerciseId: 'bench', main: false, workingSets: 2, group: null },
      { exerciseId: 'pushdown', main: false, workingSets: 2, group: null },
      { exerciseId: 'cable_fly', main: false, workingSets: 1, group: 'A' },
      { exerciseId: 'crunch', main: false, workingSets: 1, group: 'A' },
    ]);
  });
});

describe('a coach chat draft’s plan read by the builder (codec)', () => {
  const slot = (exerciseId: string, source: 'coach' | 'coach_est' | 'rule' | 'plan' | 'none', value: number | null) => ({
    slotKey: id(31_000 + exerciseId.length),
    exerciseId,
    catalogueId: exerciseId,
    order: 0,
    main: false,
    supersetGroup: null,
    setTemplates: [
      { setType: 'warmup' as const, reps: { min: 8, max: 8 }, durationS: null, targetRpe: null, restS: 60 },
      { setType: 'working' as const, reps: { min: 8, max: 10 }, durationS: null, targetRpe: 8, restS: 90, load: { load: value === null ? null : { value, unit: 'kg' as const, convention: 'total' as const }, source, basis: null, basisFromCoach: false, held: false, notes: [], notUsed: null } },
    ],
  });
  it('the coach’s chosen load reads as Coach target (an estimate too); the plan’s as Plan; none as Start light; else the rule', () => {
    const plan: DraftPlan = { slots: [slot('bench', 'coach', 100), { ...slot('row', 'coach_est', 80), order: 1 }, { ...slot('squat', 'plan', 120), order: 2 }, { ...slot('curl', 'none', null), order: 3 }, { ...slot('pushdown', 'rule', 25), order: 4 }] };
    expect(slotsOf(fromDraftPlan(plan).blocks).map((s) => [s.exerciseId, s.source])).toEqual([
      ['bench', 'coach_target'],
      ['row', 'coach_target'],
      ['squat', 'plan'],
      ['curl', 'none'],
      ['pushdown', 'rule'],
    ]);
  });
});

describe('the routine a builder draft’s session credits', () => {
  const key = { planId: null, dayIndex: null, splitDayId: null, mainLiftExerciseId: null, localDate: '2026-10-22' };
  it('only a draft opened on a library workout names it; Set up, Today, a past workout and a chat draft name none', () => {
    expect(routineOfBuilderDraft({ builderKey: { ...key, from: { kind: 'routine', id: id(1) } } })).toBe(id(1));
    expect(routineOfBuilderDraft({ builderKey: { ...key, from: { kind: 'session', id: id(1) } } })).toBeNull();
    expect(routineOfBuilderDraft({ builderKey: { ...key, from: { kind: 'coach_draft', id: id(1) } } })).toBeNull();
    expect(routineOfBuilderDraft({ builderKey: key })).toBeNull();
    expect(routineOfBuilderDraft({})).toBeNull();
  });
});

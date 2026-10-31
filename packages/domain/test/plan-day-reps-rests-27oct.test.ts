import { describe, expect, it } from 'vitest';
import type { RoutineExercise, SetTemplate } from '@fizz/schemas';
import { estimateBuilderSeconds, fromDraftPlan, restAfterRows, storedReps, storedRests, storedTemplateWorkout, toDraftPlan, type BuilderSlot, type BuilderWorkout, type TodayTemplate } from '../src/index';
import { context, info, pool } from './builder-v3-fixture';
import { id } from './fixtures';

/**
 * (Ben, 27 Oct) Today drafts a plan day exactly as stored: besides its exercises, set counts and pairs, the reps and
 * rests Ben set in Library › Plan › day › Edit. Time's estimate then moves with them; Time's shorter rest levels still
 * shorten an accessory's stored rest, never the main lift's.
 */

const set = (k: number, type: SetTemplate['setType'], reps: { min: number; max: number } | null, over: Partial<SetTemplate> = {}): SetTemplate => ({ id: id(8000 + k), setType: type, targetLoad: null, targetReps: reps, targetDurationS: reps === null ? 45 : null, targetRpe: null, targetRir: null, restOverrideS: null, ...over });
const rex = (over: Partial<RoutineExercise>): RoutineExercise => ({ id: id(700), exerciseId: id(1), equipmentId: null, order: 0, supersetGroup: null, setTemplates: [set(1, 'working', { min: 8, max: 12 })], restBySetType: {}, transitionRestS: null, progressionRuleId: null, ...over });

describe('storedReps / storedRests: what a plan day stored', () => {
  it('reps: the working sets’ range; none for timed work or a top set', () => {
    expect(storedReps(rex({ setTemplates: [set(1, 'warmup', { min: 5, max: 5 }), set(2, 'working', { min: 12, max: 15 }), set(3, 'working', { min: 12, max: 15 })] }))).toEqual({ min: 12, max: 15 });
    expect(storedReps(rex({ setTemplates: [set(1, 'working', { min: 6, max: 6 }), set(2, 'working', { min: 8, max: 8 })] }))).toEqual({ min: 6, max: 8 });
    expect(storedReps(rex({ setTemplates: [set(1, 'working', null)] }))).toBeNull();
    expect(storedReps(rex({ setTemplates: [set(1, 'top', { min: 5, max: 5 }), set(2, 'backoff', { min: 8, max: 8 })] }))).toBeNull();
  });
  it('rests: by set type, else a set’s own; clamped; none for a superset member', () => {
    expect(storedRests(rex({ restBySetType: { working: { seconds: 75 } } }))).toEqual({ working: 75 });
    expect(storedRests(rex({ setTemplates: [set(1, 'working', { min: 8, max: 8 }, { restOverrideS: 150 })] }))).toEqual({ working: 150 });
    expect(storedRests(rex({ restBySetType: { working: { seconds: 5 } } }))).toEqual({ working: 30 });
    expect(storedRests(rex({}))).toBeNull();
    expect(storedRests(rex({ supersetGroup: 'A', restBySetType: { working: { seconds: 75 } } }))).toBeNull();
  });
});

const template = (slots: NonNullable<TodayTemplate['slots']>): TodayTemplate => ({ routineId: 'r', version: 1, label: 'Bench', mainLiftExerciseId: 'bench', exerciseIds: slots.map((x) => x.exerciseId), minutes: 45, absPlan: false, supersetsPlan: false, groups: [], slots });
const slotOf = (w: BuilderWorkout | null, exerciseId: string): BuilderSlot | undefined => w?.blocks.flatMap((b) => b.slots).find((s) => s.exerciseId === exerciseId);
const workingRests = (s: BuilderSlot | undefined, level: BuilderWorkout['restLevel']) => (s === undefined ? [] : restAfterRows(s, info, level).filter((_, i) => s.rows[i]?.type !== 'warmup'));

describe('Today drafts the plan day’s reps and rests (Ben, 27 Oct)', () => {
  const plain = template([
    { exerciseId: 'bench', workingSets: 3, group: null },
    { exerciseId: 'cable_fly', workingSets: 3, group: null },
  ]);
  const edited = template([
    { exerciseId: 'bench', workingSets: 3, group: null, restS: { top: 240, backoff: 240 } },
    { exerciseId: 'cable_fly', workingSets: 3, group: null, reps: { min: 15, max: 20 }, restS: { working: 120 } },
  ]);
  const ctx = context();
  const a = storedTemplateWorkout(plain, { supersets: false }, { ctx, pool });
  const b = storedTemplateWorkout(edited, { supersets: false }, { ctx, pool });

  it('the stored reps are the slot’s rep range and its rows', () => {
    const fly = slotOf(b, 'cable_fly');
    expect(fly?.repRange).toEqual({ min: 15, max: 20 });
    expect(fly?.rows.filter((r) => r.type === 'working').every((r) => r.reps === 15)).toBe(true);
    expect(slotOf(a, 'cable_fly')?.repRange).not.toEqual({ min: 15, max: 20 });
  });
  it('the stored rests replace the defaults at normal length, and the estimate moves', () => {
    expect(workingRests(slotOf(b, 'cable_fly'), 'normal').slice(0, 2)).toEqual([120, 120]);
    expect(workingRests(slotOf(b, 'bench'), 'normal').slice(0, 2)).toEqual([240, 240]);
    if (a === null || b === null) throw new Error('drafts');
    expect(estimateBuilderSeconds(b, ctx)).toBeGreaterThan(estimateBuilderSeconds(a, ctx));
  });
  it('a shorter rest level still shortens an accessory’s stored rest, never the main lift’s', () => {
    const fly = workingRests(slotOf(b, 'cable_fly'), 'shortest');
    expect(Math.max(...fly)).toBeLessThan(120);
    expect(workingRests(slotOf(b, 'bench'), 'shortest').slice(0, 2)).toEqual([240, 240]);
  });
  it('the stored rest survives the draft codec (commit, reopen, Start)', () => {
    if (b === null) throw new Error('draft');
    const back = fromDraftPlan(toDraftPlan(b, { info, catalogueIdOf: (x) => x, checkedOnOf: () => null }), 'normal');
    expect(slotOf(back, 'cable_fly')?.planRestS).toEqual({ working: 120 });
    expect(slotOf(back, 'cable_fly')?.repRange).toEqual({ min: 15, max: 20 });
  });
  it('a substitute picked here doesn’t inherit the stored exercise’s reps and rests', () => {
    const w = storedTemplateWorkout(edited, { supersets: false }, { ctx, pool, usable: (x) => x !== 'cable_fly' });
    const sub = w?.blocks.flatMap((s) => s.slots).find((s) => !s.main);
    expect(sub?.exerciseId).not.toBe('cable_fly');
    expect(sub?.planRestS).toBeUndefined();
    expect(sub?.repRange).not.toEqual({ min: 15, max: 20 });
  });
});

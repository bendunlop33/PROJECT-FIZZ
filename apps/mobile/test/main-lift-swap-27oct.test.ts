import { describe, expect, it } from 'vitest';

import { MAIN_SWAP_COPY } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { Exercise, Routine, SessionAggregate, UserProfile } from '@fizz/schemas';

import type { BuilderEnv, BuilderEnvPort } from '../src/builder/builder-env';
import { mainLiftSection } from '../src/ui/swap-sheet-model';
import { createWorkoutEditService } from '../src/workout/workout-edit-service';

/**
 * (Ben, 27 Oct; redesign-27oct.md §E3) The mid-workout Swap sheet on the main lift: the plan day's main-lift
 * alternatives (this gym's, not already in the workout) first under `Main lift`, then everything else as ranked.
 * Any other row, a workout not started from the plan in use, or another muscle group: the sheet as before.
 * The service over a fake store and builder env (reads only; nothing here writes).
 */

const OWNER = { id: 'owner-1' } as UserProfile;
const ex = (id: string, name: string, primaryMuscles: string[]): Exercise => ({ id, name, primaryMuscles, secondaryMuscles: [], measurement: 'reps' }) as unknown as Exercise;
const EXERCISES = new Map<string, Exercise>([
  ['bench', ex('bench', 'Barbell bench press', ['chest'])],
  ['incline_bb', ex('incline_bb', 'Incline barbell press', ['upper chest'])],
  ['db_bench', ex('db_bench', 'Dumbbell bench press', ['chest'])],
  ['machine_press', ex('machine_press', 'Machine chest press', ['chest'])],
  ['fly', ex('fly', 'Cable fly', ['chest'])],
  ['smith_incline', ex('smith_incline', 'Smith incline press', ['upper chest'])],
  ['pushdown', ex('pushdown', 'Triceps pushdown', ['triceps'])],
]);

const session = (planDay: { planId: string; dayIndex: number; mainLiftExerciseId: string | null } | null, rows: { id: string; exerciseId: string; swappedFrom?: string }[]): SessionAggregate =>
  ({
    session: { id: 's1', gymId: 'gym-1', ...(planDay === null ? {} : { planDay: { ...planDay, splitDayId: 'push', templateRoutineId: null, templateVersion: null, variationId: null } }) },
    exercises: rows.map((r, i) => ({ id: r.id, exerciseId: r.exerciseId, order: i, ...(r.swappedFrom === undefined ? {} : { swappedFrom: { sessionExerciseId: r.swappedFrom, opId: 'op' } }) })),
    sets: [],
  }) as unknown as SessionAggregate;

const template = (dayIndex: number, main: string): Routine =>
  ({ id: `t-${String(dayIndex)}-${main}`, createdAtUtc: '2026-10-01T00:00:00.000Z', deletedAtUtc: null, exercises: [{ exerciseId: main }], planDay: { planId: 'plan-1', dayIndex, splitDayId: 'push', mainLiftExerciseId: main } }) as unknown as Routine;

function service(a: SessionAggregate, opts: { templates?: Routine[]; plan?: { id: string } | null; notHere?: string[] } = {}) {
  const plan = opts.plan === undefined ? { id: 'plan-1', status: 'applied', applied: { made: [] } } : opts.plan;
  const templates = opts.templates ?? [template(0, 'bench'), template(0, 'incline_bb'), template(0, 'smith_incline'), template(1, 'row')];
  const store = {
    repos: {
      sessions: { get: () => Promise.resolve(a) },
      workoutDrafts: { get: () => Promise.resolve(null) },
      planDrafts: { applied: () => Promise.resolve(plan) },
      routines: { listByOwner: () => Promise.resolve(templates.map((t) => ({ ...t, createdFromPlan: undefined }))) },
      trainingProfiles: { get: () => Promise.resolve(null) },
    },
  } as unknown as Store;
  const groupOf = (id: string) => (id === 'pushdown' ? 'Arms' : 'Chest');
  const env: BuilderEnvPort = () =>
    Promise.resolve({
      info: (id: string) => { const e = EXERCISES.get(id); return e === undefined ? null : { exerciseId: id, name: e.name, group: groupOf(id), role: 'compound', heavy: false, part: groupOf(id), muscles: [...e.primaryMuscles], angle: e.primaryMuscles[0] ?? '', barbell: false }; },
      exercise: (id: string) => EXERCISES.get(id) ?? null,
      worksOf: () => 'chest',
      painFlagged: () => false,
      painLine: () => null,
      doable: (id: string) => !(opts.notHere ?? []).includes(id),
      candidates: (g: string) => (g === 'Chest' ? ['db_bench', 'machine_press', 'fly', 'incline_bb', 'bench'] : ['pushdown']),
    } as unknown as BuilderEnv);
  return createWorkoutEditService({ store: () => store, profile: () => Promise.resolve(OWNER), env, workout: {} as never });
}

const flat = (c: Awaited<ReturnType<ReturnType<typeof service>['choices']>>) => (c?.sections ?? []).map((s) => `${s.focus}: ${s.items.map((i) => i.exerciseId).join(', ')}`);

describe('Swap on the main lift mid-workout (Ben, 27 Oct)', () => {
  it('the plan’s main-lift alternatives first, in plan order, then everything else without them', async () => {
    const a = session({ planId: 'plan-1', dayIndex: 0, mainLiftExerciseId: 'bench' }, [{ id: 'r1', exerciseId: 'bench' }, { id: 'r2', exerciseId: 'fly' }]);
    const c = await service(a).choices('s1', { sessionExerciseId: 'r1' });
    const sections = c?.sections ?? [];
    expect(sections[0]).toMatchObject({ focus: MAIN_SWAP_COPY.heading, items: [{ exerciseId: 'incline_bb', name: 'Incline barbell press' }, { exerciseId: 'smith_incline' }] });
    // Never the lift being swapped or one already in the workout; each listed once.
    const ids = sections.flatMap((s) => s.items.map((i) => i.exerciseId));
    expect(ids).not.toContain('bench');
    expect(ids).not.toContain('fly');
    expect(ids.filter((x) => x === 'incline_bb')).toHaveLength(1);
    expect(ids.slice(2)).toEqual(expect.arrayContaining(['db_bench', 'machine_press']));
    // The sheet shows it above Recent and Suggested.
    expect(mainLiftSection(sections).main?.focus).toBe(MAIN_SWAP_COPY.heading);
  });

  it('a row swapped in for the main lift is still the main lift', async () => {
    const a = session({ planId: 'plan-1', dayIndex: 0, mainLiftExerciseId: 'bench' }, [{ id: 'r1', exerciseId: 'bench' }, { id: 'r3', exerciseId: 'db_bench', swappedFrom: 'r1' }]);
    const c = await service(a).choices('s1', { sessionExerciseId: 'r3' });
    expect(c?.sections[0]?.focus).toBe(MAIN_SWAP_COPY.heading);
  });

  it('an alternative this gym can’t do isn’t offered first', async () => {
    const a = session({ planId: 'plan-1', dayIndex: 0, mainLiftExerciseId: 'bench' }, [{ id: 'r1', exerciseId: 'bench' }]);
    const c = await service(a, { notHere: ['smith_incline'] }).choices('s1', { sessionExerciseId: 'r1' });
    expect(c?.sections[0]?.items.map((i) => i.exerciseId)).toEqual(['incline_bb']);
  });

  it('as before: an accessory, another group, no plan day, another plan, or a day with no other main lift', async () => {
    const a = session({ planId: 'plan-1', dayIndex: 0, mainLiftExerciseId: 'bench' }, [{ id: 'r1', exerciseId: 'bench' }, { id: 'r2', exerciseId: 'fly' }]);
    const none = (c: Awaited<ReturnType<ReturnType<typeof service>['choices']>>) => {
      expect(flat(c).some((l) => l.startsWith(MAIN_SWAP_COPY.heading))).toBe(false);
    };
    none(await service(a).choices('s1', { sessionExerciseId: 'r2' }));
    none(await service(a).choices('s1', { sessionExerciseId: 'r1', group: 'Arms' }));
    none(await service(a).choices('s1', { sessionExerciseId: null }));
    none(await service(session(null, [{ id: 'r1', exerciseId: 'bench' }])).choices('s1', { sessionExerciseId: 'r1' }));
    none(await service(a, { plan: { id: 'plan-2' } }).choices('s1', { sessionExerciseId: 'r1' }));
    none(await service(a, { plan: null }).choices('s1', { sessionExerciseId: 'r1' }));
    none(await service(a, { templates: [template(0, 'bench')] }).choices('s1', { sessionExerciseId: 'r1' }));
  });
});

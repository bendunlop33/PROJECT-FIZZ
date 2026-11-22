import { describe, expect, it } from 'vitest';
import type { BuilderMuscleInfo } from '@fizz/schemas';
import { buildFromSetup, builderInfoOf, categoryHint, isAutoPickInfo, leadMuscleGroup, muscleFit, muscleRowOf, muscleWords, slotsOf, type BuilderContext, type BuilderExerciseInfo, type BuilderPool } from '../src/index';
import { context, info as baseInfo } from './builder-v3-fixture';

/**
 * The five muscle words Ben approved on 23 Oct (catalogue expansion Q1):
 * hip_flexors, rotator_cuff, serratus, tibialis, neck. Counting goes to the
 * right broad group; prehab and forearm work is Swap / Add only.
 */

const ex = (primaryMuscles: string[], secondaryMuscles: string[] = [], movementPattern = 'core'): BuilderMuscleInfo => ({ primaryMuscles, secondaryMuscles, movementPattern, measurement: 'reps' });

describe('counting (Progress and the weekly review) with the new words', () => {
  it('each new lead muscle counts in its broad group', () => {
    expect(leadMuscleGroup(ex(['rotator_cuff'], ['rear_delts'], 'horizontal_pull'))).toBe('Shoulders');
    expect(leadMuscleGroup(ex(['tibialis'], [], 'calves'))).toBe('Calves');
    expect(leadMuscleGroup(ex(['hip_flexors', 'abs']))).toBe('Core');
    expect(leadMuscleGroup(ex(['serratus'], [], 'horizontal_push'))).toBe('Chest');
    expect(leadMuscleGroup(ex(['neck'], [], 'vertical_pull'))).toBe('Back');
    // Abs-led leg raises are unchanged by the added hip flexors.
    expect(leadMuscleGroup(ex(['abs', 'hip_flexors'], ['obliques']))).toBe('Core');
    // Forearms still count nowhere.
    expect(leadMuscleGroup(ex(['forearms'], [], 'arms'))).toBeNull();
  });

  it('Progress rows (D5 detailed list): cuff → Shoulders (no longer Back), tibialis → Calves, forearms none', () => {
    expect(muscleRowOf(ex(['rotator_cuff'], ['rear_delts'], 'horizontal_pull'))).toBe('Shoulders');
    expect(muscleRowOf(ex(['rear_delts'], [], 'horizontal_pull'))).toBe('Back');
    expect(muscleRowOf(ex(['tibialis'], [], 'calves'))).toBe('Calves');
    expect(muscleRowOf(ex(['serratus'], [], 'horizontal_push'))).toBe('Chest');
    expect(muscleRowOf(ex(['neck'], [], 'vertical_pull'))).toBe('Back');
    expect(muscleRowOf(ex(['forearms'], [], 'arms'))).toBeNull();
  });

  it('workout title words', () => {
    expect(muscleWords([{ primaryMuscles: ['rotator_cuff'] }, { primaryMuscles: ['tibialis'] }, { primaryMuscles: ['abs', 'hip_flexors'] }], 4)).toEqual(['Shoulders', 'Shins', 'Core', 'Hip flexors']);
  });
});

describe('builder info and automatic picks', () => {
  const row = (id: string, primaryMuscles: string[], movementPattern: string, secondaryMuscles: string[] = []) =>
    builderInfoOf({ id, name: id, primaryMuscles, secondaryMuscles, movementPattern, measurement: 'reps', mechanic: 'isolation', compatibleEquipment: ['cable_stack'] } as unknown as Parameters<typeof builderInfoOf>[0]);

  it('tibialis is a Legs part (calves) under Shins; cuff is Shoulders; wrist curl is the arms group, all browse only', () => {
    const tib = row('tib', ['tibialis'], 'calves');
    expect([tib?.group, tib?.angle, tib?.part]).toEqual(['Legs', 'Shins', 'calves']);
    const er = row('er', ['rotator_cuff'], 'horizontal_pull', ['rear_delts']);
    expect([er?.group, er?.angle]).toEqual(['Shoulders', 'Rotator cuff']);
    const wrist = row('wrist', ['forearms'], 'arms', ['grip']);
    expect([wrist?.group, wrist?.angle, wrist?.part]).toEqual(['Arms', 'Forearms', 'forearms']);
    for (const i of [tib, er, wrist]) expect(isAutoPickInfo(i ?? null)).toBe(false);
    const legRaise = row('lr', ['abs', 'hip_flexors'], 'core', ['obliques']);
    expect([legRaise?.group, legRaise?.angle, isAutoPickInfo(legRaise ?? null)]).toEqual(['Core', 'Abs', true]);
    expect(isAutoPickInfo(null)).toBe(false);
  });

  it('the build never picks a wrist curl, tibialis raise or cuff rotation by itself, even first in the pool', () => {
    const extra: Record<string, BuilderExerciseInfo> = {
      wrist_curl: { exerciseId: 'wrist_curl', name: 'Wrist curl', group: 'Arms', role: 'isolation', heavy: false, part: 'forearms', muscles: ['forearms'], angle: 'Forearms', barbell: false },
      tib_raise: { exerciseId: 'tib_raise', name: 'Tibialis raise', group: 'Legs', role: 'isolation', heavy: false, part: 'calves', muscles: ['tibialis'], angle: 'Shins', barbell: false },
    };
    const base = context();
    const ctx: BuilderContext = { ...base, info: (id) => extra[id] ?? baseInfo(id) };
    const pool: BuilderPool = (g) => (g === 'Arms' ? ['wrist_curl', 'curl', 'hammer'] : g === 'Legs' ? ['tib_raise', 'calf', 'leg_ext', 'leg_curl'] : []);
    const b = buildFromSetup({ minutes: 90, mainLiftExerciseId: null, supersets: false, groups: [{ group: 'Arms', count: 2 }, { group: 'Legs', count: 3 }] }, pool, ctx);
    const picked = slotsOf(b.workout.blocks).map((s) => s.exerciseId);
    expect(picked).toEqual(expect.arrayContaining(['curl', 'hammer', 'calf']));
    expect(picked).not.toContain('wrist_curl');
    expect(picked).not.toContain('tib_raise');
  });
});

describe('FitNotes categories accept the new words (a hint never hides the right suggestion)', () => {
  it.each([
    [['Legs'], ['tibialis']],
    [['Calves'], ['tibialis']],
    [['Abs'], ['hip_flexors']],
    [['Shoulders'], ['rotator_cuff']],
    [['Shoulders'], ['neck']],
    [['Chest'], ['serratus']],
    [['Trapezius'], ['neck']],
  ])('%s agrees with %s', (cats, muscles) => {
    expect(muscleFit(categoryHint(cats), muscles)).toBe('agrees');
  });
});

import { describe, expect, it } from 'vitest';
import {
  BUILDER_FOCI,
  BUILDER_GROUP_PARTS,
  BUILDER_GROUPS,
  builderFocusOf,
  builderFocusSections,
  builderGroupOf,
  builderGroupOfMuscleGroup,
  builderGroupOfPart,
  builderGroupOfParts,
  MUSCLE_GROUPS,
  MUSCLE_TO_GROUP,
  SPLIT_BODY_PARTS,
  SplitBodyPartSchema,
  worksLine,
  type BuilderExerciseInfo,
  type BuilderFocus,
} from '../src/index';

const ex = (primaryMuscles: string[], secondaryMuscles: string[] = [], movementPattern?: string): BuilderExerciseInfo => ({ primaryMuscles, secondaryMuscles, movementPattern });

describe('BuilderGroup (display only, §4.7, §9 Q8)', () => {
  it('seven groups; Legs = Quads + Hamstrings + Glutes + Calves; Abs = Core', () => {
    expect(BUILDER_GROUPS).toEqual(['Chest', 'Back', 'Shoulders', 'Legs', 'Biceps', 'Triceps', 'Abs']);
    expect(BUILDER_GROUP_PARTS.Legs).toEqual(['Quads', 'Hamstrings', 'Glutes', 'Calves']);
    expect(BUILDER_GROUP_PARTS.Abs).toEqual(['Core']);
    for (const p of ['Quads', 'Hamstrings', 'Glutes', 'Calves'] as const) expect(builderGroupOfPart(p)).toBe('Legs');
    expect(builderGroupOfPart('Core')).toBe('Abs');
    expect(builderGroupOfMuscleGroup('Forearms')).toBeNull();
  });

  it('every stored split body part belongs to exactly one builder group, and the parts table agrees', () => {
    const listed = BUILDER_GROUPS.flatMap((g) => BUILDER_GROUP_PARTS[g].map((p) => [p, g] as const));
    expect(listed.map(([p]) => p).sort()).toEqual([...SPLIT_BODY_PARTS].sort());
    for (const [p, g] of listed) expect(builderGroupOfPart(p)).toBe(g);
    // The parts it stores are always SplitBodyPart names (stored data unchanged).
    for (const g of BUILDER_GROUPS) for (const p of BUILDER_GROUP_PARTS[g]) expect(SplitBodyPartSchema.safeParse(p).success).toBe(true);
  });

  it('every muscle group but Forearms has a builder group', () => {
    for (const g of MUSCLE_GROUPS) expect(builderGroupOfMuscleGroup(g) === null).toBe(g === 'Forearms');
  });

  it('a stored parts list reads back as one group, else null', () => {
    expect(builderGroupOfParts(['Quads', 'Calves'])).toBe('Legs');
    expect(builderGroupOfParts(['Core'])).toBe('Abs');
    expect(builderGroupOfParts(['Chest', 'Triceps'])).toBeNull();
    expect(builderGroupOfParts([])).toBeNull();
  });
});

describe('builderGroupOf (catalogue exercise)', () => {
  it('from the first primary muscle that has a builder group', () => {
    expect(builderGroupOf(ex(['chest'], ['front_delts', 'triceps']))).toBe('Chest');
    expect(builderGroupOf(ex(['hamstrings', 'glutes']))).toBe('Legs');
    expect(builderGroupOf(ex(['obliques', 'core']))).toBe('Abs');
    expect(builderGroupOf(ex(['brachialis', 'biceps']))).toBe('Biceps');
    // Farmer carry: grip has no builder group, traps is Back.
    expect(builderGroupOf(ex(['grip', 'traps']))).toBe('Back');
  });
  it('rear delts are Back (§9 Q13)', () => {
    expect(builderGroupOf(ex(['rear_delts'], ['upper_back', 'traps']))).toBe('Back');
    expect(builderGroupOf(ex(['rear_delts', 'upper_back'], ['traps', 'side_delts']))).toBe('Back');
  });
  it('null for only forearms, no muscles, or words outside the vocabulary', () => {
    expect(builderGroupOf(ex(['forearms']))).toBeNull();
    expect(builderGroupOf(ex([]))).toBeNull();
    expect(builderGroupOf(ex(['rhomboids']))).toBeNull();
  });
});

describe('builderFocusOf (Swap focus headings, §2.5)', () => {
  it('every focus lies in its exercise’s group, for every vocabulary muscle as the lead', () => {
    for (const m of Object.keys(MUSCLE_TO_GROUP)) {
      for (const pattern of [undefined, 'horizontal_pull', 'vertical_pull']) {
        const e = ex([m], [], pattern);
        const g = builderGroupOf(e);
        const f = builderFocusOf(e);
        if (g === null) expect(f).toBeNull();
        else expect(BUILDER_FOCI[g] as readonly BuilderFocus[]).toContain(f);
      }
    }
  });
  it('Upper chest / Mid chest', () => {
    expect(builderFocusOf(ex(['upper_chest', 'front_delts'], ['chest', 'triceps'], 'horizontal_push'))).toBe('Upper chest');
    expect(builderFocusOf(ex(['chest', 'upper_chest'], [], 'horizontal_push'))).toBe('Upper chest');
    expect(builderFocusOf(ex(['chest'], ['front_delts', 'triceps'], 'horizontal_push'))).toBe('Mid chest');
  });
  it('Lats / Mid-back / Rear delts: rows are Mid-back whichever back muscle is listed first', () => {
    expect(builderFocusOf(ex(['lats'], ['upper_back', 'biceps'], 'vertical_pull'))).toBe('Lats');
    expect(builderFocusOf(ex(['lats', 'upper_back'], ['rear_delts'], 'horizontal_pull'))).toBe('Mid-back');
    expect(builderFocusOf(ex(['upper_back', 'lats'], ['rear_delts'], 'horizontal_pull'))).toBe('Mid-back');
    expect(builderFocusOf(ex(['rear_delts', 'upper_back'], ['traps'], 'horizontal_pull'))).toBe('Rear delts');
    expect(builderFocusOf(ex(['spinal_erectors', 'glutes'], ['hamstrings'], 'hinge'))).toBe('Lower back');
  });
  it('Front delts / Side delts; Quads / Hamstrings & glutes / Calves', () => {
    expect(builderFocusOf(ex(['front_delts'], ['side_delts', 'triceps']))).toBe('Front delts');
    expect(builderFocusOf(ex(['side_delts'], ['front_delts']))).toBe('Side delts');
    expect(builderFocusOf(ex(['quads', 'glutes']))).toBe('Quads');
    expect(builderFocusOf(ex(['glutes'], ['hamstrings']))).toBe('Hamstrings & glutes');
    expect(builderFocusOf(ex(['hamstrings', 'glutes']))).toBe('Hamstrings & glutes');
    expect(builderFocusOf(ex(['calves']))).toBe('Calves');
  });
});

describe('builderFocusSections', () => {
  const items = [
    { id: 'fly', info: ex(['chest'], ['front_delts']) },
    { id: 'incline', info: ex(['upper_chest', 'front_delts'], ['chest', 'triceps']) },
    { id: 'press', info: ex(['chest'], ['front_delts', 'triceps']) },
    { id: 'pushdown', info: ex(['triceps']) },
  ];
  it('the group’s exercises under headings in display order, input order kept, others left out', () => {
    expect(builderFocusSections(items, (i) => i.info, 'Chest').map((s) => [s.focus, s.items.map((i) => i.id)])).toEqual([
      ['Upper chest', ['incline']],
      ['Mid chest', ['fly', 'press']],
    ]);
    expect(builderFocusSections(items, (i) => i.info, 'Triceps').map((s) => s.focus)).toEqual(['Triceps']);
    expect(builderFocusSections(items, (i) => i.info, 'Back')).toEqual([]);
  });
});

describe('worksLine (§2.4, §2.5)', () => {
  it('primaries then helpers, short gym words, first capitalised', () => {
    expect(worksLine(ex(['chest'], ['front_delts', 'triceps']))).toBe('Chest, front delts, triceps');
    expect(worksLine(ex(['upper_chest', 'front_delts'], ['chest', 'triceps']))).toBe('Upper chest, front delts, triceps');
    expect(worksLine(ex(['hamstrings', 'glutes'], ['spinal_erectors', 'adductors', 'upper_back', 'grip']))).toBe('Hamstrings, glutes, lower back');
    expect(worksLine(ex(['rear_delts', 'upper_back'], ['traps', 'side_delts']))).toBe('Rear delts, upper back, traps');
  });
  it('at most 3 by default; core and grip only when primary; chest left out beside upper chest', () => {
    expect(worksLine(ex(['quads', 'glutes'], ['adductors', 'hamstrings', 'spinal_erectors', 'core']))).toBe('Quads, glutes, adductors');
    expect(worksLine(ex(['abs'], ['obliques', 'grip']))).toBe('Abs, obliques');
    expect(worksLine(ex(['abs', 'core'], ['obliques']))).toBe('Abs, core, obliques');
    expect(worksLine(ex(['triceps'], ['core', 'grip']))).toBe('Triceps');
    expect(worksLine(ex(['chest', 'upper_chest']))).toBe('Upper chest');
    expect(worksLine(ex(['lats'], ['upper_back', 'biceps', 'brachialis']), 4)).toBe('Lats, upper back, biceps, brachialis');
  });
  it('unknown words skipped; nothing left is null', () => {
    expect(worksLine(ex(['rhomboids', 'lats']))).toBe('Lats');
    expect(worksLine(ex([]))).toBeNull();
    expect(worksLine(ex(['rhomboids']))).toBeNull();
  });
});

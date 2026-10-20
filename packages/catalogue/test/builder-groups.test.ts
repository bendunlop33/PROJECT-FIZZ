import { BUILDER_FOCI, builderFocusOf, builderGroupOf, isBuilderStrength, worksLine, type BuilderFocus, type BuilderGroup } from '@fizz/schemas';
import { describe, expect, it } from 'vitest';
import { bundledCatalogue, type CatalogueEntry } from '../src/index';

/** Builder groups, focus headings and `works` lines on the real catalogue (workout-builder-v3 §2.4, §2.5, §4.7). */
const entries: readonly CatalogueEntry[] = bundledCatalogue().catalogue.entries;
const byKey = (key: string): CatalogueEntry => {
  const e = entries.find((x) => x.key === key);
  if (e === undefined) throw new Error(`No entry ${key}`);
  return e;
};

describe('builder groups on the catalogue', () => {
  it('every strength entry has a builder group and a focus inside it, and a works line', () => {
    for (const e of entries.filter(isBuilderStrength)) {
      const g = builderGroupOf(e);
      expect(g, e.key).not.toBeNull();
      expect(BUILDER_FOCI[g as BuilderGroup] as readonly BuilderFocus[], e.key).toContain(builderFocusOf(e));
      expect(worksLine(e), e.key).not.toBeNull();
    }
  });

  it('conditioning, cardio and carry entries have no group or focus', () => {
    const out = entries.filter((e) => !isBuilderStrength(e));
    expect(out.length).toBeGreaterThan(0);
    for (const e of out) {
      expect(['conditioning', 'carry'].includes(e.movementPattern) || e.measurement === 'cardio', e.key).toBe(true);
      expect(builderGroupOf(e), e.key).toBeNull();
      expect(builderFocusOf(e), e.key).toBeNull();
    }
  });

  it.each(['treadmill-run', 'battle-ropes', 'farmers-carry', 'ski-erg', 'bodyweight-burpee', 'sled-push'])('%s → no builder group', (key) => {
    expect(builderGroupOf(byKey(key))).toBeNull();
  });

  it.each([
    ['barbell-bench-press', 'Chest', 'Mid chest', 'Chest, front delts, triceps'],
    ['barbell-incline-bench-press', 'Chest', 'Upper chest', 'Upper chest, front delts, triceps'],
    ['dumbbell-incline-bench-press', 'Chest', 'Upper chest', 'Upper chest, front delts, triceps'],
    ['cable-fly', 'Chest', 'Mid chest', 'Chest, front delts'],
    ['cable-lat-pulldown', 'Back', 'Lats', 'Lats, upper back, biceps'],
    ['barbell-bent-over-row', 'Back', 'Mid-back', 'Lats, upper back, rear delts'],
    ['cable-seated-row', 'Back', 'Mid-back', 'Lats, upper back, rear delts'],
    ['dumbbell-chest-supported-row', 'Back', 'Mid-back', 'Upper back, lats, rear delts'],
    ['cable-face-pull', 'Back', 'Rear delts', 'Rear delts, upper back, traps'],
    ['dumbbell-rear-delt-fly', 'Back', 'Rear delts', 'Rear delts, upper back, traps'],
    ['machine-reverse-pec-deck', 'Back', 'Rear delts', 'Rear delts, upper back, traps'],
    ['bodyweight-45-degree-back-extension', 'Back', 'Lower back', 'Lower back, glutes, hamstrings'],
    ['dumbbell-lateral-raise', 'Shoulders', 'Side delts', 'Side delts, front delts, traps'],
    ['barbell-overhead-press', 'Shoulders', 'Front delts', 'Front delts, side delts, triceps'],
    ['barbell-back-squat', 'Legs', 'Quads', 'Quads, glutes, adductors'],
    ['barbell-romanian-deadlift', 'Legs', 'Hamstrings & glutes', 'Hamstrings, glutes, lower back'],
    ['barbell-hip-thrust', 'Legs', 'Hamstrings & glutes', 'Glutes, hamstrings, quads'],
    ['machine-seated-calf-raise', 'Legs', 'Calves', 'Calves'],
    ['dumbbell-hammer-curl', 'Biceps', 'Biceps', 'Biceps'],
    ['bodyweight-plank', 'Abs', 'Abs', 'Abs, core, obliques'],
    ['sandbag-lunge', 'Legs', 'Quads', 'Quads, glutes, hamstrings'],
    ['cable-rope-triceps-pushdown', 'Triceps', 'Triceps', 'Triceps'],
    ['cable-crunch', 'Abs', 'Abs', 'Abs, obliques'],
  ] as const)('%s → %s · %s · %s', (key, group, focus, works) => {
    const e = byKey(key);
    expect(builderGroupOf(e)).toBe(group);
    expect(builderFocusOf(e)).toBe(focus);
    expect(worksLine(e)).toBe(works);
  });

  it('no rear-delt-led entry is grouped under Shoulders (§9 Q13)', () => {
    for (const e of entries.filter((x) => x.primaryMuscles[0] === 'rear_delts')) expect(builderGroupOf(e), e.key).toBe('Back');
  });
});

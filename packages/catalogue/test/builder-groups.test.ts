import { BUILDER_FOCI, builderFocusCounts, builderFocusOf, builderGroupOf, isBuilderAutoPick, isBuilderStrength, worksLine, type BuilderFocus, type BuilderGroup } from '@fizz/schemas';
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
    // Forearm- or grip-only entries (wrist curls, dead hang) are found under the arms group (`Biceps` until D5's `Arms`)
    // with the `Forearms` focus: Swap / Add only, never picked by the builder, never counted (builder-groups.ts).
    const forearmOnly = (e: CatalogueEntry) => e.primaryMuscles.every((m) => m === 'forearms' || m === 'grip');
    const forearm = entries.filter((e) => isBuilderStrength(e) && forearmOnly(e));
    expect(forearm.map((e) => e.key).sort()).toEqual(['barbell-reverse-wrist-curl', 'barbell-wrist-curl', 'bodyweight-dead-hang']);
    for (const e of forearm) {
      expect(builderGroupOf(e), e.key).toBe('Biceps');
      expect(builderFocusOf(e), e.key).toBe('Forearms');
      expect(isBuilderAutoPick(e), e.key).toBe(false);
      expect(builderFocusCounts(builderFocusOf(e)), e.key).toBe(false);
      expect(worksLine(e), e.key).not.toBeNull();
    }
    for (const e of entries.filter(isBuilderStrength)) {
      const g = builderGroupOf(e);
      expect(g, e.key).not.toBeNull();
      expect(BUILDER_FOCI[g as BuilderGroup] as readonly BuilderFocus[], e.key).toContain(builderFocusOf(e));
      expect(worksLine(e), e.key).not.toBeNull();
    }
  });

  it('the 23 Oct muscle words: tibialis, cuff and hip-flexor entries land in the right group and focus', () => {
    // The tibialis raise is Legs › Shins (not Calves); cuff rotations are Shoulders › Rotator cuff (not Back › Rear delts).
    expect([builderGroupOf(byKey('bodyweight-tibialis-raise')), builderFocusOf(byKey('bodyweight-tibialis-raise'))]).toEqual(['Legs', 'Shins']);
    expect(worksLine(byKey('bodyweight-tibialis-raise'))).toBe('Shins');
    for (const k of ['cable-external-rotation', 'band-external-rotation', 'dumbbell-side-lying-external-rotation']) {
      expect([builderGroupOf(byKey(k)), builderFocusOf(byKey(k))], k).toEqual(['Shoulders', 'Rotator cuff']);
      expect(isBuilderAutoPick(byKey(k)), k).toBe(false);
    }
    expect(worksLine(byKey('cable-external-rotation'))).toBe('Rotator cuff, rear delts');
    // Leg raises and sit-ups stay Abs-led (the abs are listed first), with hip flexors in the works line.
    for (const k of ['bodyweight-decline-sit-up', 'bodyweight-captains-chair-knee-raise', 'bodyweight-lying-leg-raise', 'bodyweight-v-up', 'bodyweight-toes-to-bar', 'bodyweight-hollow-body-hold']) {
      expect([builderGroupOf(byKey(k)), builderFocusOf(byKey(k))], k).toEqual(['Abs', 'Abs']);
      expect(isBuilderAutoPick(byKey(k)), k).toBe(true);
      expect(byKey(k).primaryMuscles, k).toContain('hip_flexors');
    }
    expect(worksLine(byKey('bodyweight-lying-leg-raise'))).toBe('Abs, hip flexors, obliques');
    for (const k of ['bodyweight-reverse-crunch', 'bodyweight-bicycle-crunch', 'bodyweight-hanging-leg-raise', 'bodyweight-hanging-knee-raise']) expect(byKey(k).secondaryMuscles, k).toContain('hip_flexors');
    // No entry still uses a stand-in for these.
    expect(byKey('bodyweight-tibialis-raise').primaryMuscles).toEqual(['tibialis']);
    for (const e of entries) expect(e.primaryMuscles.includes('rear_delts') && /external rotation/i.test(e.name), e.key).toBe(false);
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

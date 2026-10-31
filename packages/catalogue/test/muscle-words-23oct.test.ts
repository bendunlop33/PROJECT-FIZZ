import { describe, expect, it } from 'vitest';
import { bundledGuides } from '../src/guide-library';
import { lazyBundledCatalogue } from '../src/loader';
import { formatMuscleList, muscleFocusFor, muscleLegend, musclePlainLabel, muscleShortLabel, spokenMuscleList } from '../src/muscles';
import { MUSCLE_REGION_MAP, resolveFocus } from '../src/figure/muscle-map';
import type { Muscle } from '../src/vocab';

/** The five muscle words approved 23 Oct (catalogue expansion Q1): names, and an honest fallback on the figure (no art yet). */
const NEW: readonly Muscle[] = ['hip_flexors', 'rotator_cuff', 'serratus', 'tibialis', 'neck'];

describe('How to names', () => {
  it('plain words first, the gym term in brackets', () => {
    expect(NEW.map(musclePlainLabel)).toEqual(['front of hips (hip flexors)', 'shoulder rotators (rotator cuff)', 'sides of ribs (serratus)', 'front of shins (tibialis)', 'neck']);
    expect(NEW.map(muscleShortLabel)).toEqual(['front of hips', 'shoulder rotators', 'sides of ribs', 'front of shins', 'neck']);
    expect(formatMuscleList(['abs', 'hip_flexors'])).toBe('Abs, front of hips (hip flexors)');
    expect(spokenMuscleList(['rotator_cuff', 'rear_delts'])).toBe('shoulder rotators, rotator cuff, and back of shoulders, rear delts');
  });
});

describe('figure fallback: no region art for the new words', () => {
  const library = bundledGuides();
  const catalogue = lazyBundledCatalogue();
  const guide = (key: string) => {
    const g = library.load(key);
    if (!g.ok) throw new Error(`${key} should load`);
    return g.value.guide;
  };

  it('never drawn in any view (never coloured as a neighbouring muscle)', () => {
    for (const m of NEW) for (const v of ['side', 'front', 'back'] as const) expect(MUSCLE_REGION_MAP[m][v], `${m} ${v}`).toBeNull();
    for (const view of ['side', 'front', 'back'] as const) {
      const r = resolveFocus({ primary: ['rotator_cuff', 'tibialis'], secondary: ['rear_delts', 'hip_flexors'] }, undefined, view);
      expect(r.notShown).toEqual(expect.arrayContaining(['rotator_cuff', 'tibialis', 'hip_flexors']));
      expect(r.drawn.some((m) => NEW.includes(m))).toBe(false);
      expect(r.regions.some((x) => NEW.includes(x.muscle))).toBe(false);
      // Still listed in the text (§4.7).
      expect(r.strong).toEqual(['rotator_cuff', 'tibialis']);
      expect(r.soft).toEqual(['rear_delts', 'hip_flexors']);
    }
  });

  it('with a guide, the new words stay in Feel it most / Also works and appear under Not shown', () => {
    const focus = muscleFocusFor({ primaryMuscles: ['chest', 'serratus'], secondaryMuscles: ['front_delts', 'triceps'] }, guide('barbell-bench-press'));
    expect(focus.strong).toEqual(['chest', 'serratus']);
    expect(focus.notShown).toContain('serratus');
    expect(focus.drawn).not.toContain('serratus');
    const legend = muscleLegend(focus);
    expect(legend.find((l) => l.kind === 'most')?.list).toBe('Chest, sides of ribs (serratus)');
    expect(legend.find((l) => l.kind === 'notShown')?.list).toContain('sides of ribs');
  });

  it('the remapped catalogue entries load, list the new words, and have no guide that could mis-draw them', () => {
    for (const [key, m] of [
      ['bodyweight-tibialis-raise', 'tibialis'],
      ['cable-external-rotation', 'rotator_cuff'],
      ['bodyweight-lying-leg-raise', 'hip_flexors'],
    ] as const) {
      const e = catalogue.entry(key);
      if (!e.ok) throw new Error(key);
      expect(e.entry.primaryMuscles, key).toContain(m);
      const f = muscleFocusFor(e.entry, null);
      expect(f.drawn).toEqual([]);
      expect(f.strong).toContain(m);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { CATALOGUE_STATIONS } from '@fizz/domain';

import { bundledCatalogue } from '../src/index';

/**
 * (ADR 0030) The domain's bench and rack needs are the catalogue's
 * `requiresStation`, limited to what a gym profile records. No drift.
 */
describe('CATALOGUE_STATIONS matches the catalogue', () => {
  it('lists every entry that needs a bench, incline bench or rack, with the same stations', () => {
    const { catalogue } = bundledCatalogue();
    const fromCatalogue: Record<string, string[]> = {};
    for (const e of catalogue.entries) {
      const s = (e.requiresStation ?? []).filter((x) => x === 'bench' || x === 'incline_bench' || x === 'rack');
      if (s.length > 0) fromCatalogue[e.key] = s;
    }
    expect(Object.fromEntries(Object.entries(CATALOGUE_STATIONS).map(([k, v]) => [k, [...v]]))).toEqual(fromCatalogue);
  });

  it('kettlebell, EZ bar, trap bar and Smith exercises list a kind a gym can hold', () => {
    const { catalogue } = bundledCatalogue();
    const byKey = (k: string) => catalogue.byKey(k);
    expect(byKey('smith-machine-squat')).toMatchObject({ compatibleEquipment: ['smith_machine'], defaultLoadConvention: 'total' });
    expect(byKey('kettlebell-swing')).toMatchObject({ compatibleEquipment: ['kettlebell'], defaultLoadConvention: 'per_hand', implements: 1 });
    expect(byKey('ez-bar-curl')).toMatchObject({ compatibleEquipment: ['ez_bar'], defaultLoadConvention: 'total' });
    expect(byKey('trap-bar-deadlift')).toMatchObject({ compatibleEquipment: ['trap_bar'], defaultLoadConvention: 'total' });
    // Every kettlebell exercise is counted per bell, so it snaps on the gym's kettlebells.
    for (const e of catalogue.entries) if (e.compatibleEquipment.length === 1 && e.compatibleEquipment[0] === 'kettlebell') expect(e.defaultLoadConvention).toBe('per_hand');
  });
});

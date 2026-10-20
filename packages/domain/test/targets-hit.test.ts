import { describe, expect, it } from 'vitest';

import { isMainLift, mainLiftIds, showsTargetsHit, targetsHitShown } from '../src/index';

describe('isMainLift (Ben, 20 Oct: targets hit on the split day’s main lift only)', () => {
  it('a split day’s main lift (his or the recommended one) is a main lift; nothing else is', () => {
    const ids = mainLiftIds({ dayMainLifts: ['squat', null, undefined, 'bench'] });
    expect([...ids].sort()).toEqual(['bench', 'squat']);
    expect(isMainLift('squat', ids)).toBe(true);
    expect(isMainLift('curl', ids)).toBe(false);
  });

  it('nothing set up: no main lifts', () => {
    expect(mainLiftIds({ dayMainLifts: [] }).size).toBe(0);
  });
});

describe('targetsHitShown', () => {
  it('only with the setting on and a main lift', () => {
    expect(targetsHitShown('Targets hit 5 of last 6', { on: true, main: true })).toBe('Targets hit 5 of last 6');
    expect(targetsHitShown('Targets hit 5 of last 6', { on: false, main: true })).toBeNull();
    expect(targetsHitShown('Targets hit 5 of last 6', { on: true, main: false })).toBeNull();
    expect(targetsHitShown(null, { on: true, main: true })).toBeNull();
    expect(showsTargetsHit({ on: false, main: false })).toBe(false);
  });
});

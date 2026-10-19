import { describe, expect, it } from 'vitest';

import { isMainLift, mainLiftIds, showsTargetsHit, targetsHitShown, type MainLiftSources } from '../src/index';

const compound = new Set(['squat', 'bench', 'row', 'deadlift']);
const src = (over: Partial<MainLiftSources> = {}): MainLiftSources => ({
  dayMainLifts: ['squat', null, undefined],
  routines: [],
  isCompound: (id) => compound.has(id),
  ...over,
});

describe('isMainLift (Ben, 20 Oct: targets hit on main lifts only)', () => {
  it('a split day’s main lift (his or the recommended one) is a main lift', () => {
    expect(isMainLift('squat', src())).toBe(true);
    expect(isMainLift('curl', src())).toBe(false);
  });

  it('`Main` in a workout counts; `Main` off doesn’t', () => {
    const routines = [{ exercises: [{ exerciseId: 'bench', main: true }, { exerciseId: 'fly', main: true }, { exerciseId: 'row', main: false }, { exerciseId: 'curl', main: false }] }];
    const ids = mainLiftIds(src({ routines }));
    expect([...ids].sort()).toEqual(['bench', 'fly', 'squat']);
    expect(isMainLift('fly', src({ routines }))).toBe(true);
    expect(isMainLift('row', src({ routines }))).toBe(false);
    expect(isMainLift('curl', ids)).toBe(false);
  });

  it('a workout saved before `Main` was stored: the rule (compounds in the first two places; else the first)', () => {
    const routines = [
      { exercises: [{ exerciseId: 'deadlift' }, { exerciseId: 'curl' }, { exerciseId: 'bench' }] },
      { exercises: [{ exerciseId: 'lateral-raise' }, { exerciseId: 'curl' }] },
    ];
    const ids = mainLiftIds(src({ dayMainLifts: [], routines }));
    expect([...ids].sort()).toEqual(['deadlift', 'lateral-raise']);
  });

  it('nothing set up: no main lifts', () => {
    expect(mainLiftIds(src({ dayMainLifts: [] })).size).toBe(0);
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

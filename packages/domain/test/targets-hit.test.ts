import { describe, expect, it } from 'vitest';

import { isMainLift, mainLiftIds, mainLiftRoutines, routineMainLiftIds, showsTargetsHit, targetsHitShown, type MainLiftSources } from '../src/index';

const compound = new Set(['squat', 'bench', 'row', 'deadlift']);
const isCompound = (id: string) => compound.has(id);
const src = (over: Partial<MainLiftSources> = {}): MainLiftSources => ({
  dayMainLifts: ['squat', null, undefined],
  routines: [],
  isCompound,
  ...over,
});
const ex = (exerciseId: string, order: number, main?: boolean) => (main === undefined ? { exerciseId, order } : { exerciseId, order, main });

describe('isMainLift (Ben, 20 Oct: targets hit on main lifts only)', () => {
  it('a split day’s main lift (his or the recommended one) is a main lift', () => {
    const ids = mainLiftIds(src());
    expect(isMainLift('squat', ids)).toBe(true);
    expect(isMainLift('curl', ids)).toBe(false);
  });

  it('`Main` in a workout counts; `Main` off doesn’t', () => {
    const routines = [{ exercises: [ex('bench', 0, true), ex('fly', 1, true), ex('row', 2, false), ex('curl', 3, false)] }];
    const ids = mainLiftIds(src({ routines }));
    expect([...ids].sort()).toEqual(['bench', 'fly', 'squat']);
    expect(isMainLift('fly', ids)).toBe(true);
    expect(isMainLift('row', ids)).toBe(false);
    expect(isMainLift('curl', ids)).toBe(false);
  });

  it('a workout saved before `Main` was stored: the rule (compounds in the first two places; else the first)', () => {
    const routines = [{ exercises: [ex('deadlift', 0), ex('curl', 1), ex('bench', 2)] }, { exercises: [ex('lateral-raise', 0), ex('curl', 1)] }];
    const ids = mainLiftIds(src({ dayMainLifts: [], routines }));
    expect([...ids].sort()).toEqual(['deadlift', 'lateral-raise']);
  });

  it('the rule reads the workout in `order`, not stored array order (review S2)', () => {
    // Stored out of order: in `order` it is Curl, Bench, Deadlift → only Bench is in the first two places.
    const exercises = [ex('deadlift', 2), ex('curl', 0), ex('bench', 1)];
    expect([...routineMainLiftIds(exercises, isCompound)]).toEqual(['bench']);
    expect([...routineMainLiftIds([ex('curl', 1), ex('lateral-raise', 0)], isCompound)]).toEqual(['lateral-raise']);
  });

  it('nothing set up: no main lifts', () => {
    expect(mainLiftIds(src({ dayMainLifts: [] })).size).toBe(0);
  });
});

describe('mainLiftRoutines (review S1: only workouts that count)', () => {
  const base = { createdAtUtc: '2026-10-01T00:00:00.000Z', deletedAtUtc: null, rotationAtUtc: undefined };
  const inRot = { ...base, id: 'push-a', inRotation: true };
  const outOfRot = { ...base, id: 'arms', inRotation: false };
  const planDay = { ...base, id: 'upper', inRotation: false, createdFromPlan: { planId: 'plan-1', versionN: 1, dayIndex: 0 } };
  const endedDay = { ...base, id: 'old-upper', inRotation: false, createdFromPlan: { planId: 'plan-0', versionN: 1, dayIndex: 0 } };
  const live = [inRot, outOfRot, planDay, endedDay] as unknown as Parameters<typeof mainLiftRoutines>[0];
  const applied = { id: 'plan-1', status: 'applied', applied: { made: [{ routineId: 'upper' }] } } as unknown as Parameters<typeof mainLiftRoutines>[1];

  it('the rotation and the applied plan’s days; not a workout out of rotation or from an ended plan', () => {
    expect(mainLiftRoutines(live, applied).map((r) => r.id).sort()).toEqual(['push-a', 'upper']);
    expect(mainLiftRoutines(live, null).map((r) => r.id)).toEqual(['push-a']);
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

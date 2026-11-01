import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, SessionAggregate } from '@fizz/schemas';
import { reduceSession, startWorkout, warmupPrefsCommand, warmupPrefsOf, type WarmupLookup } from '../src/index';
import { at, dumbbells, exercise, GYM, id, idGen, kg, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, logCmd, setsFor } from './session-fixture';

/**
 * (Ben, 1 Nov) Changing his warm-up preferences re-plans today's not-yet-done warm-ups (one command under one action
 * ID), never a logged set; Undo (`revert_target_adjustment`) puts back exactly the ones still pending.
 */

const DSP = id(700);
const RACK: EquipmentInstance = dumbbells({ loads: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40] });
const FACTS = { mechanic: 'compound' as const, movementPattern: 'vertical_push', primaryMuscles: ['front_delts'], measurement: 'reps' };

function start(): SessionAggregate {
  const ex = exercise(700, 'Dumbbell shoulder press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'compound', movementPattern: 'vertical_push', primaryMuscles: ['front_delts'] });
  const warm = [0, 1, 2].map((i) => template(7010 + i, { setType: 'warmup', targetReps: { min: 5, max: 5 } }));
  const work = [7020, 7021].map((n) => template(n, { targetLoad: kg(35, 'per_hand'), targetReps: { min: 6, max: 10 }, targetRpe: 9 }));
  return startWorkout({
    opId: 'start',
    owner: profile(),
    gymId: GYM,
    routine: routine([routineExercise(710, { exerciseId: DSP, equipmentId: RACK.id, order: 0, setTemplates: [...warm, ...work] })]),
    exercises: new Map([[DSP, ex]]),
    gymEquipment: [RACK],
    at: at(0),
    newId: idGen(72_000),
  }).aggregate;
}

const warmLoads = (s: SessionAggregate): (number | null)[] => setsFor(s, DSP).filter((x) => x.setType === 'warmup' && x.status !== 'deleted').map((x) => (x.status === 'completed' ? (x.actual?.load?.value ?? null) : (x.planned.load?.value ?? null)));
const lookup = (prefs: Parameters<typeof warmupPrefsOf>[0]): WarmupLookup & { prefs: ReturnType<typeof warmupPrefsOf> } => ({ facts: () => FACTS, prefs: warmupPrefsOf(prefs) });

describe('warm-up preferences re-plan today’s pending warm-ups', () => {
  it('Start stores simple loads (default on): 15, 20, 30 for 35 kg each', () => {
    expect(warmLoads(start())).toEqual([15, 20, 30]);
  });

  it('Simple off: the pending ones go to the 22 Oct steps; a logged warm-up stays; Undo puts back the pending ones', () => {
    let s = start();
    const [w1] = setsFor(s, DSP);
    s = apply(s, logCmd(w1?.id ?? '', values(kg(15, 'per_hand'), 8), 20));
    const cmd = warmupPrefsCommand({ aggregate: s, workingLoad: (w) => w.planned.load, lookup: lookup({ warmups: { simpleLoads: false } }), opId: 'prefs-1', actionId: id(9901), at: at(30) });
    expect(cmd?.changes.map((c) => c.target.load?.value)).toEqual([27.5]);
    const r = reduceSession(s, cmd ?? (() => { throw new Error('no command'); })());
    if (!r.ok) throw new Error(r.error.message);
    expect(warmLoads(r.state)).toEqual([15, 20, 27.5]);
    // Rule 2: the logged set is untouched.
    expect(setsFor(r.state, DSP)[0]).toEqual(setsFor(s, DSP)[0]);
    const back = reduceSession(r.state, { type: 'revert_target_adjustment', at: at(40), opId: 'undo-1', actionId: id(9901), removedSetIds: [], addedSetIds: [] });
    if (!back.ok) throw new Error(back.error.message);
    expect(warmLoads(back.state)).toEqual([15, 20, 30]);
  });

  it('nothing to change: no command (same preferences)', () => {
    expect(warmupPrefsCommand({ aggregate: start(), workingLoad: (w) => w.planned.load, lookup: lookup(null), opId: 'p', actionId: id(9902), at: at(30) })).toBeNull();
  });

  it('warm-ups off for the exercise: its pending warm-ups come out; Undo puts them back', () => {
    const s = start();
    const cmd = warmupPrefsCommand({ aggregate: s, workingLoad: (w) => w.planned.load, lookup: lookup({ warmups: { perExercise: { [DSP]: 'off' } } }), opId: 'prefs-2', actionId: id(9903), at: at(30) });
    expect(cmd?.removeSetIds).toHaveLength(3);
    const r = reduceSession(s, cmd ?? (() => { throw new Error('no command'); })());
    if (!r.ok) throw new Error(r.error.message);
    expect(warmLoads(r.state)).toEqual([]);
    const back = reduceSession(r.state, { type: 'revert_target_adjustment', at: at(40), opId: 'undo-2', actionId: id(9903), removedSetIds: cmd?.removeSetIds ?? [], addedSetIds: [] });
    if (!back.ok) throw new Error(back.error.message);
    expect(warmLoads(back.state)).toEqual([15, 20, 30]);
  });

  it('a stale command (the workout moved on) is refused, never applied to newer state (rule 5)', () => {
    let s = start();
    const cmd = warmupPrefsCommand({ aggregate: s, workingLoad: (w) => w.planned.load, lookup: lookup({ warmups: { simpleLoads: false } }), opId: 'prefs-3', actionId: id(9904), at: at(30) });
    const [w1] = setsFor(s, DSP);
    s = apply(s, logCmd(w1?.id ?? '', values(kg(15, 'per_hand'), 8), 20));
    const r = reduceSession(s, cmd ?? (() => { throw new Error('no command'); })());
    expect(r.ok).toBe(false);
  });
});

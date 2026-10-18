import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';
import {
  addedWeightEquipment,
  addedWeightItems,
  addWeightToggle,
  buildActiveSetView,
  buildSetEditView,
  estimateOneRepMax,
  isLoadAchievable,
  reduceSession,
  roundToAvailableLoad,
  setAddedWeight,
  slotLoadConvention,
  startWorkout,
} from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, plateMachine, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, expectError, expectOk, logCmd } from './session-fixture';

const BACK_EXT = id(700);
const LEG_PRESS = id(701);

const exercises = new Map<string, Exercise>([
  [BACK_EXT, exercise(700, '45° back extension', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', movementPattern: 'hinge' })],
  [LEG_PRESS, exercise(701, 'Leg press', { compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added', movementPattern: 'squat' })],
]);
const BODYWEIGHT = new Set([BACK_EXT]);

/** Dumbbells 5–30 kg (2.5 steps) and barbell plates 1.25–25 kg. */
const gym: EquipmentInstance[] = [dumbbells(), barbell(), plateMachine()];

function start(over: { addedWeight?: boolean; targets?: number[]; equipment?: EquipmentInstance[] } = {}): SessionAggregate {
  const targets = over.targets;
  const r = routine([
    routineExercise(710, {
      exerciseId: BACK_EXT,
      order: 0,
      ...(over.addedWeight === true ? { addedWeight: true } : {}),
      setTemplates: [0, 1, 2].map((i) => template(7100 + i, { targetReps: { min: 12, max: 12 }, targetLoad: targets?.[i] === undefined ? null : kg(targets[i] ?? 0, 'added') })),
    }),
    routineExercise(711, { exerciseId: LEG_PRESS, equipmentId: plateMachine().id, order: 1, setTemplates: [template(7110, { targetLoad: kg(100, 'added') })] }),
  ]);
  return startWorkout({ opId: 'start-aw', owner: profile(), gymId: GYM, routine: r, exercises, gymEquipment: over.equipment ?? gym, at: at(0), newId: idGen() }).aggregate;
}

const row = (s: SessionAggregate, exerciseId: string) => {
  const r = s.exercises.find((e) => e.exerciseId === exerciseId);
  if (!r) throw new Error('row missing');
  return r;
};
const setsOf = (s: SessionAggregate, exerciseId: string) => s.sets.filter((x) => x.sessionExerciseId === row(s, exerciseId).id).sort((a, b) => a.index - b.index);
const mode = (s: SessionAggregate, m: 'added' | 'bodyweight', opId = `mode-${m}`, ex = BACK_EXT) =>
  reduceSession(s, { type: 'set_load_mode', at: at(5), opId, expectedVersion: s.session.version, sessionExerciseId: row(s, ex).id, mode: m });

describe('added weight options (gym dumbbells and plates)', () => {
  it('lists each dumbbell and plate size in the row unit, never another unit or a retired item', () => {
    const items = addedWeightItems([dumbbells({ loads: [5, 10] }), barbell({ plates: [{ mass: 20, count: 2 }, { mass: 1.25, count: 2 }, { mass: 15, count: 0 }] })], 'kg');
    expect(items).toEqual([1.25, 5, 10, 20]);
    // An lb rack adds nothing to a kg row: no conversion, nothing invented (rule 4).
    expect(addedWeightItems([dumbbells({ unit: 'lb', loads: [10, 20] })], 'kg')).toEqual([]);
    expect(addedWeightItems([dumbbells({ availability: 'retired' })], 'kg')).toEqual([]);
    expect(addedWeightItems([dumbbells({ unit: 'lb', loads: [10, 20] })], 'lb')).toEqual([10, 20]);
  });

  it('snaps toward easier, includes 0 and never goes past the heaviest single item', () => {
    const eq = addedWeightEquipment(gym, 'kg', null, GYM);
    const easier = roundToAvailableLoad(kg(11.3, 'added'), eq, 'easier');
    expect(easier.ok && easier.load).toEqual(kg(11.25, 'added'));
    const capped = roundToAvailableLoad(kg(80, 'added'), eq, 'nearest');
    expect(capped.ok && capped.load.value).toBe(30);
    expect(capped.ok && capped.bounded).toBe('max');
    expect(isLoadAchievable(kg(0, 'added'), eq)).toBe(true);
    // Nothing to add here: only 0.
    const none = addedWeightEquipment([], 'kg', null, GYM);
    expect(isLoadAchievable(kg(0, 'added'), none)).toBe(true);
    expect(isLoadAchievable(kg(5, 'added'), none)).toBe(false);
    // An lb load is never read as kg.
    expect(isLoadAchievable(lb(10, 'added'), eq)).toBe(false);
  });

  it('offers + Weight only on bodyweight exercises, and only when the gym has something to add', () => {
    expect(addWeightToggle({ loadConvention: 'bodyweight', unit: 'kg' }, null, gym)).toEqual({ on: false });
    expect(addWeightToggle({ loadConvention: 'bodyweight', unit: 'kg' }, null, [])).toBeNull();
    // A row with no equipment already in `added` is a sled or a leg press without its machine unless the catalogue says bodyweight.
    expect(addWeightToggle({ loadConvention: 'added', unit: 'kg' }, null, gym)).toBeNull();
    expect(addWeightToggle({ loadConvention: 'added', unit: 'kg' }, null, gym, true)).toEqual({ on: true });
    expect(addWeightToggle({ loadConvention: 'added', unit: 'kg' }, plateMachine(), gym, true)).toBeNull();
    expect(addWeightToggle({ loadConvention: 'per_hand', unit: 'kg' }, dumbbells(), gym, true)).toBeNull();
  });
});

describe('set_load_mode: + Weight for the rest of today', () => {
  it('switches the row, keeps logged sets as logged, and is versioned and idempotent', () => {
    let s = start();
    expect(row(s, BACK_EXT).loadConvention).toBe('bodyweight');
    const [first, second, third] = setsOf(s, BACK_EXT);
    if (!first || !second || !third) throw new Error('sets');
    s = apply(s, logCmd(first.id, values(kg(0, 'bodyweight'), 12), 60));

    const stale = s;
    const on = expectOk(mode(s, 'added'));
    s = on.state;
    expect(row(s, BACK_EXT).loadConvention).toBe('added');
    expect(s.session.version).toBe(stale.session.version + 1);
    // Rule 2: the logged bodyweight set is untouched.
    expect(setsOf(s, BACK_EXT)[0]?.actual?.load).toEqual(kg(0, 'bodyweight'));
    // Rule 5: a write against the old version is refused.
    expectError(reduceSession(s, { type: 'set_load_mode', at: at(6), opId: 'mode-stale', expectedVersion: stale.session.version, sessionExerciseId: row(s, BACK_EXT).id, mode: 'bodyweight' }), 'stale_version');
    // A retried op is a duplicate, not a second change.
    const retry = expectOk(reduceSession(s, { type: 'set_load_mode', at: at(5), opId: 'mode-added', expectedVersion: stale.session.version, sessionExerciseId: row(s, BACK_EXT).id, mode: 'added' }));
    expect(retry.duplicate).toBe(true);
    expect(retry.state.session.version).toBe(s.session.version);

    // A weighted set logs the added mass only.
    s = apply(s, logCmd(second.id, values(kg(10, 'added'), 12), 200));
    expect(setsOf(s, BACK_EXT)[1]?.actual?.load).toEqual(kg(10, 'added'));
    expect(setsOf(s, BACK_EXT)[1]?.flags).toEqual([]);
    // The earlier bodyweight set can still be corrected as it was.
    const corrected = reduceSession(s, { type: 'correct_set', at: at(210), opId: 'fix-1', setId: first.id, expectedSetVersion: setsOf(s, BACK_EXT)[0]?.version ?? 0, patch: { reps: 11 } });
    expect(corrected.ok).toBe(true);

    // Back to bodyweight: the weighted set stays weighted.
    s = expectOk(mode(s, 'bodyweight')).state;
    expect(row(s, BACK_EXT).loadConvention).toBe('bodyweight');
    expect(setsOf(s, BACK_EXT)[1]?.actual?.load).toEqual(kg(10, 'added'));
    s = apply(s, logCmd(third.id, values(kg(0, 'bodyweight'), 15), 400));
    expect(setsOf(s, BACK_EXT)[2]?.actual?.load).toEqual(kg(0, 'bodyweight'));
  });

  it('clears a pending target in the other convention, never carrying an added load to bodyweight', () => {
    let s = start({ addedWeight: true, targets: [10, 10, 10] });
    expect(setsOf(s, BACK_EXT).map((x) => x.planned.load)).toEqual([kg(10, 'added'), kg(10, 'added'), kg(10, 'added')]);
    const r = expectOk(mode(s, 'bodyweight'));
    s = r.state;
    expect(setsOf(s, BACK_EXT).map((x) => x.planned.load)).toEqual([null, null, null]);
    expect(r.events[0]).toMatchObject({ type: 'LoadModeChanged', mode: 'bodyweight' });
    // A bodyweight row with an added log value is refused only for another convention, not bodyweight/added.
    const first = setsOf(s, BACK_EXT)[0];
    expectError(reduceSession(s, logCmd(first?.id ?? '', values(kg(10, 'stack'), 12), 60)), 'convention_mismatch');
  });

  it('refuses on an exercise loaded on its own equipment', () => {
    const s = start();
    expectError(mode(s, 'bodyweight', 'mode-lp', LEG_PRESS), 'convention_mismatch');
  });
});

describe('Add weight in a saved workout', () => {
  it('starts the exercise as added weight and fits targets to the gym (easier, never past the heaviest item)', () => {
    const s = start({ addedWeight: true, targets: [11, 50, 0] });
    expect(row(s, BACK_EXT).loadConvention).toBe('added');
    expect(row(s, BACK_EXT).equipmentId).toBeNull();
    expect(setsOf(s, BACK_EXT).map((x) => x.planned.load)).toEqual([kg(10, 'added'), kg(30, 'added'), kg(0, 'added')]);
    // The flag means nothing on a non-bodyweight exercise.
    expect(slotLoadConvention({ addedWeight: true }, 'added')).toBe('added');
    expect(slotLoadConvention({ addedWeight: true }, 'total')).toBe('total');
    expect(slotLoadConvention({}, 'bodyweight')).toBe('bodyweight');
  });

  it('at a gym with nothing to add, a weighted target fits to 0 added', () => {
    const s = start({ addedWeight: true, targets: [10], equipment: [plateMachine({ plates: [] })] });
    expect(setsOf(s, BACK_EXT)[0]?.planned.load).toEqual(kg(0, 'added'));
  });

  it('the editor switch clears Fixed loads of the other convention', () => {
    const slot = routineExercise(720, { exerciseId: BACK_EXT, setTemplates: [template(7200, { targetLoad: kg(0, 'bodyweight') }), template(7201)] });
    const [on] = setAddedWeight([slot], slot.id, true);
    expect(on?.addedWeight).toBe(true);
    expect(on?.setTemplates[0]?.targetLoad).toBeNull();
    const weighted = { ...slot, addedWeight: true, setTemplates: [template(7202, { targetLoad: kg(10, 'added') })] };
    const [off] = setAddedWeight([weighted], slot.id, false);
    expect(off?.addedWeight).toBeUndefined();
    expect(off?.setTemplates[0]?.targetLoad).toBeNull();
  });
});

describe('views and history', () => {
  it('the set card offers + Weight and steps through the gym items once weighted', () => {
    let s = start();
    const view = (agg: SessionAggregate, bw: ReadonlySet<string> | undefined) =>
      buildActiveSetView({ aggregate: agg, nowMs: ms(10), gymName: 'Hotel', previous: {}, painFlagged: new Set(), edits: null, ...(bw ? { bodyweightExercises: bw } : {}) }).focus;
    expect(view(s, BODYWEIGHT)?.addWeight).toEqual({ on: false });
    expect(view(s, BODYWEIGHT)?.loadField).toBeNull();
    s = expectOk(mode(s, 'added')).state;
    const f = view(s, BODYWEIGHT);
    expect(f?.addWeight).toEqual({ on: true });
    expect(f?.loadField?.label).toBe('Added');
    expect(f?.logValues.load).toEqual(kg(0, 'added'));
    expect(f?.loadField?.up).toMatchObject({ enabled: true, value: 1.25 });
    // Without the catalogue's word it's ambiguous: no switch offered.
    expect(view(s, undefined)?.addWeight).toBeNull();
  });

  it('the correction sheet follows the set’s own convention', () => {
    let s = start();
    const first = setsOf(s, BACK_EXT)[0];
    s = apply(s, logCmd(first?.id ?? '', values(kg(0, 'bodyweight'), 12), 60));
    const v = buildSetEditView(s, first?.id ?? '', values(kg(0, 'added'), 12), null, { bodyweightExercises: BODYWEIGHT });
    expect(v?.convention).toBe('added');
    expect(v?.addWeight).toEqual({ on: true });
    expect(v?.loadField?.label).toBe('Added');
    expect(v?.text).toContain('BW');
  });

  it('an added-weight bodyweight set is never shown as a 1RM', () => {
    expect(estimateOneRepMax(kg(10, 'added'), 8, null).eligible).toBe(false);
    expect(estimateOneRepMax(kg(10, 'added'), 8, 'plate_loaded_machine').eligible).toBe(true);
  });
});

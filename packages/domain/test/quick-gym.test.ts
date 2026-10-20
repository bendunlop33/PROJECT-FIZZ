import { describe, expect, it } from 'vitest';
import { GymSchema, type EquipmentInstance, type Gym } from '@fizz/schemas';
import {
  assumedTag,
  assumedWhy,
  buildQuickGymDraft,
  doableHere,
  dumbbellLoadsFor,
  equipmentHere,
  equipmentForExercise,
  getAchievableLoads,
  gymEditLanded,
  gymEditWrites,
  gymLearnFor,
  gymLearnText,
  gymSetupWords,
  initQuickGymForm,
  quickGymFormInput,
  quickGymFormRows,
  reduceQuickGymForm,
  makeFullNeedsDumbbellStep,
  materialiseGymDraft,
  notHereExerciseIds,
  planGymLearn,
  planGymUpdate,
  planMakeFullGym,
  planNotHere,
  planPutBack,
  planRevertGymEdit,
  roundToAvailableLoad,
  type GymEdit,
} from '../src/index';
import { dumbbells, exercise, GYM, idGen, kg, lb, OWNER, stack, T0 } from './fixtures';

const T1 = '2026-10-20T06:00:00.000Z';
const T2 = '2026-10-20T07:00:00.000Z';

function gym(over: Partial<Gym> = {}): Gym {
  return GymSchema.parse({ id: GYM, ownerId: OWNER, version: 1, createdAtUtc: T0, updatedAtUtc: T0, name: 'Main gym', isDefault: true, ...over });
}

function saveQuick(input: Parameters<typeof buildQuickGymDraft>[0]): { gym: Gym; equipment: EquipmentInstance[] } {
  const r = materialiseGymDraft(buildQuickGymDraft(input), { name: 'Main gym', ownerId: OWNER, gymId: GYM, isDefault: true, atUtc: T0, newId: idGen(), setup: input.setup });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r;
}

/** Applies an edit to an in-memory gym, as the service's transaction does. */
function apply(state: { gym: Gym; equipment: EquipmentInstance[] }, edit: GymEdit) {
  const w = gymEditWrites(edit);
  const byId = new Map(state.equipment.map((e) => [e.id, e]));
  for (const e of w.equipment) {
    expect(byId.get(e.next.id)?.version ?? null).toBe(e.expectedVersion);
    byId.set(e.next.id, e.next);
  }
  if (w.gym) expect(state.gym.version).toBe(w.gym.expectedVersion);
  return { gym: w.gym?.next ?? state.gym, equipment: [...byId.values()] };
}

const legPress = exercise(900, 'Leg press', { compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added' });
const legExt = exercise(901, 'Leg extension', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const pushdown = exercise(902, 'Cable pushdown', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const pushUp = exercise(903, 'Push-up', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
const dbPress = exercise(904, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });

describe('full gym (one question: dumbbells go up in)', () => {
  it.each([
    ['kg', 1, [1, 2, 3], 50],
    ['kg', 2, [2, 4, 6], 50],
    ['kg', 2.5, [2.5, 5, 7.5], 50],
    ['kg', 5, [5, 10, 15], 50],
    ['lb', 2.5, [2.5, 5, 7.5], 120],
    ['lb', 5, [5, 10, 15], 120],
  ] as const)('%s every %s: dumbbells per hand to the top, every item assumed and in the unit', (unit, step, first, top) => {
    const { gym: g, equipment } = saveQuick({ setup: 'full', unit, dumbbellStep: step });
    expect(g.setup).toBe('full');
    const db = equipment.find((e) => e.kind === 'dumbbells');
    expect(db?.kind === 'dumbbells' && db.loadConvention).toBe('per_hand');
    expect(db?.kind === 'dumbbells' && db.loads.slice(0, 3)).toEqual(first);
    expect(db?.kind === 'dumbbells' && db.loads.at(-1)).toBe(top);
    expect(equipment.map((e) => e.kind)).toEqual(['dumbbells', 'barbell', 'plate_loaded_machine', 'weight_stack', 'weight_stack', 'assisted_stack', 'bodyweight_station']);
    for (const e of equipment) {
      expect(e.unit).toBe(unit);
      expect(e.detailsSource).toBe('preset');
      expect(assumedTag(e)).toBe('Assumed');
      if (e.kind !== 'bodyweight_station') expect(getAchievableLoads(e).loads.length).toBeGreaterThan(5);
    }
    const bar = equipment.find((e) => e.kind === 'barbell');
    expect(bar?.kind === 'barbell' && bar.barMass).toBe(unit === 'kg' ? 20 : 45);
    // Plenty of plates: a heavy deadlift is makeable.
    expect(getAchievableLoads(bar as EquipmentInstance).loads.at(-1)).toBeGreaterThan(unit === 'kg' ? 300 : 600);
  });

  it('refuses a step out of range; a top that is not a multiple stops below it', () => {
    expect(() => dumbbellLoadsFor('kg', 0, 50)).toThrow(RangeError);
    expect(() => dumbbellLoadsFor('kg', 12.5, 50)).toThrow(RangeError);
    expect(dumbbellLoadsFor('kg', 2, 25).at(-1)).toBe(24);
  });

  it('snaps on assumed items like any other, never past their max (rule 4)', () => {
    const { equipment } = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2 });
    const db = equipment.find((e) => e.kind === 'dumbbells') as EquipmentInstance;
    expect(roundToAvailableLoad(kg(23, 'per_hand'), db, 'easier')).toMatchObject({ ok: true, load: { value: 22 } });
    expect(roundToAvailableLoad(kg(70, 'per_hand'), db, 'nearest')).toMatchObject({ ok: true, load: { value: 50 }, bounded: 'max' });
    const machines = equipment.find((e) => e.name === 'Machines') as EquipmentInstance;
    expect(roundToAvailableLoad(kg(500, 'stack'), machines, 'nearest')).toMatchObject({ ok: true, load: { value: 120 }, bounded: 'max' });
  });

  it('Why? says what is assumed; the coach sees one line', () => {
    const { gym: g, equipment } = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 });
    expect(equipment.map((e) => assumedWhy(e))).toEqual(['Assumed dumbbells', 'Assumed plates', 'Assumed plates', 'Assumed stack step', 'Assumed stack step', 'Assumed stack step', null]);
    expect(gymSetupWords(g, equipment)).toBe('full gym (assumed)');
    expect(gymSetupWords(g, equipment.map((e) => ({ ...e, detailsSource: 'user' as const })))).toBe('full gym');
    expect(gymSetupWords(gym(), equipment)).toBeNull();
  });
});

describe('hotel / small and home', () => {
  it('small: dumbbells up to the top at the step, cables optional, no barbell or machines unless ticked', () => {
    const { gym: g, equipment } = saveQuick({ setup: 'small', unit: 'kg', dumbbells: { max: 25, step: 2.5 }, extras: ['cable'] });
    expect(g.setup).toBe('small');
    expect(equipment.map((e) => e.kind)).toEqual(['dumbbells', 'weight_stack']);
    const db = equipment[0];
    expect(db?.kind === 'dumbbells' && [db.loads[0], db.loads.at(-1)]).toEqual([2.5, 25]);
    const ticked = saveQuick({ setup: 'small', unit: 'kg', dumbbells: { max: 10, step: 1 }, extras: ['barbell', 'machines'] }).equipment;
    expect(ticked.map((e) => e.kind)).toEqual(['dumbbells', 'barbell', 'plate_loaded_machine', 'weight_stack']);
  });

  it('home in lb: what is ticked, natively in lb; no dumbbells is allowed', () => {
    const { equipment } = saveQuick({ setup: 'home', unit: 'lb', dumbbells: null, extras: ['barbell', 'pull_up_bar'] });
    expect(equipment.map((e) => [e.kind, e.unit])).toEqual([
      ['barbell', 'lb'],
      ['bodyweight_station', 'lb'],
    ]);
  });
});

describe('Make full gym on an existing gym', () => {
  const mine = dumbbells({ gymId: GYM, detailsSource: 'user', loads: [5, 10, 15, 20] });
  const cable = stack({ gymId: GYM, detailsSource: 'user' });

  it('keeps his confirmed items and adds the assumed rest; Undo retires them and restores the gym', () => {
    const before = { gym: gym(), equipment: [mine, cable] };
    expect(makeFullNeedsDumbbellStep(before.gym, before.equipment)).toBe(false);
    const p = planMakeFullGym({ ...before, unit: 'kg', dumbbellStep: 2.5, atUtc: T1, newId: idGen(50_000) });
    if (p.kind !== 'edit') throw new Error('nothing');
    expect(p.edit.equipment.map((e) => e.after.kind)).toEqual(['barbell', 'plate_loaded_machine', 'assisted_stack', 'bodyweight_station']);
    expect(p.edit.equipment.every((e) => e.before === null && e.after.detailsSource === 'preset')).toBe(true);
    expect(p.edit.gym?.after).toMatchObject({ setup: 'full', version: 2 });
    const after = apply(before, p.edit);
    expect(after.equipment.find((e) => e.id === mine.id)).toEqual(mine);
    // Again: nothing to add.
    expect(planMakeFullGym({ ...after, unit: 'kg', dumbbellStep: 2.5, atUtc: T1, newId: idGen(60_000) }).kind).toBe('nothing_to_add');
    // A retry after it landed is a duplicate.
    const byId = new Map(after.equipment.map((e) => [e.id, e]));
    expect(gymEditLanded(p.edit, { gym: after.gym, equipment: (id) => byId.get(id) ?? null })).toBe(true);

    const undo = planRevertGymEdit(p.edit, { gym: after.gym, equipment: (id) => byId.get(id) ?? null }, T2);
    if (undo === 'changed_since') throw new Error('stale');
    expect(undo.gym?.next).toMatchObject({ version: 3 });
    expect(undo.gym?.next.setup).toBeUndefined();
    expect(undo.equipment.every((w) => w.next.availability === 'retired')).toBe(true);
  });

  it('a stale Undo is refused (rule 5)', () => {
    const p = planMakeFullGym({ gym: gym(), equipment: [mine], unit: 'kg', dumbbellStep: 2.5, atUtc: T1, newId: idGen(50_000) });
    if (p.kind !== 'edit') throw new Error('nothing');
    const after = apply({ gym: gym(), equipment: [mine] }, p.edit);
    const newer = { ...after.gym, version: after.gym.version + 1 };
    const byId = new Map(after.equipment.map((e) => [e.id, e]));
    expect(planRevertGymEdit(p.edit, { gym: newer, equipment: (id) => byId.get(id) ?? null }, T2)).toBe('changed_since');
  });

  it('never adds back a kind Ben said is missing; asks the dumbbell step only when it adds dumbbells', () => {
    const g = gym({ missingKinds: ['plate_loaded_machine', 'assisted_stack'] });
    expect(makeFullNeedsDumbbellStep(g, [])).toBe(true);
    const p = planMakeFullGym({ gym: g, equipment: [], unit: 'lb', dumbbellStep: 5, atUtc: T1, newId: idGen(50_000) });
    if (p.kind !== 'edit') throw new Error('nothing');
    expect(p.edit.equipment.map((e) => e.after.kind)).not.toContain('plate_loaded_machine');
    expect(p.edit.equipment.map((e) => e.after.kind)).not.toContain('assisted_stack');
    expect(p.edit.equipment.every((e) => e.after.unit === 'lb')).toBe(true);
  });
});

describe('Not at this gym', () => {
  it('marks the items the exercise would use; it leaves builds and pickers there; others on the same stack stay', () => {
    const { equipment } = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 });
    const snapGym = (eq: readonly EquipmentInstance[]) => ({ id: GYM, name: 'Main gym', equipment: eq });
    expect(doableHere(legExt, snapGym(equipment))).toBe(true);
    const p = planNotHere({ exercise: legExt, equipment, atUtc: T1 });
    if (p.kind !== 'edit') throw new Error(p.kind);
    expect(p.edit.lines).toEqual(['Leg extension: not here']);
    expect(p.edit.equipment.map((e) => e.after.name)).toEqual(['Cable station', 'Machines']);
    expect(p.edit.equipment.every((e) => e.after.version === 2 && e.after.notFor?.includes(legExt.id))).toBe(true);
    const after = apply({ gym: gym(), equipment }, p.edit).equipment;
    expect(doableHere(legExt, snapGym(after))).toBe(false);
    expect(equipmentForExercise(legExt, after)).toEqual([]);
    expect(doableHere(pushdown, snapGym(after))).toBe(true);
    expect(notHereExerciseIds(after)).toEqual([legExt.id]);
    expect(planNotHere({ exercise: legExt, equipment: after, atUtc: T1 }).kind).toBe('already');
    expect(planNotHere({ exercise: pushUp, equipment: after, atUtc: T1 }).kind).toBe('none_needed');

    const back = planPutBack({ exerciseId: legExt.id, exerciseName: 'Leg extension', equipment: after, atUtc: T2 });
    if (back === null) throw new Error('none');
    const restored = apply({ gym: gym(), equipment: after }, back).equipment;
    expect(doableHere(legExt, snapGym(restored))).toBe(true);
    expect(restored.every((e) => e.notFor === undefined)).toBe(true);
  });
});

describe('the Add gym screen (review S5, N1, N2)', () => {
  it('one tap: Full gym preselected with Main gym and the default step on a first gym', () => {
    const f = initQuickGymForm('kg', true);
    expect(f.name).toBe('Main gym');
    expect(quickGymFormInput(f)).toEqual({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 });
    expect(quickGymFormRows(f)).toMatchObject({ max: false, step: true, extras: false });
    expect(quickGymFormInput(initQuickGymForm('lb', true))).toEqual({ setup: 'full', unit: 'lb', dumbbellStep: 5 });
  });

  it('a second gym starts with no name', () => {
    expect(initQuickGymForm('kg', false).name).toBe('');
  });

  it('N1: Home → None, then Hotel / small: the dumbbells come back with a selected max and the step row', () => {
    let f = initQuickGymForm('kg', true);
    f = reduceQuickGymForm(f, { kind: 'setup', setup: 'home' });
    f = reduceQuickGymForm(f, { kind: 'max', max: null });
    expect(quickGymFormRows(f)).toMatchObject({ none: true, step: false, bodyweightOnly: true });
    expect(quickGymFormInput(f)).toMatchObject({ setup: 'home', dumbbells: null });
    f = reduceQuickGymForm(f, { kind: 'setup', setup: 'small' });
    expect(f.dumbbellMax).toBe(20);
    expect(quickGymFormRows(f)).toMatchObject({ none: false, step: true });
    expect(quickGymFormInput(f)).toEqual({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2.5 }, extras: ['cable'] });
    // None isn't an answer for a hotel gym.
    expect(reduceQuickGymForm(f, { kind: 'max', max: null }).dumbbellMax).toBe(20);
  });

  it('extras are per type; a full gym ignores them; a bad step is ignored', () => {
    let f = reduceQuickGymForm(initQuickGymForm('kg', true), { kind: 'setup', setup: 'small' });
    f = reduceQuickGymForm(f, { kind: 'extra', key: 'cable' });
    f = reduceQuickGymForm(f, { kind: 'extra', key: 'barbell' });
    expect(f.extras).toEqual({ small: ['barbell'], home: [] });
    f = reduceQuickGymForm(f, { kind: 'setup', setup: 'full' });
    expect(reduceQuickGymForm(f, { kind: 'extra', key: 'cable' })).toBe(f);
    expect(reduceQuickGymForm(f, { kind: 'step', step: 3 }).dumbbellStep).toBe(2.5);
    expect(reduceQuickGymForm(f, { kind: 'step', step: 1 }).dumbbellStep).toBe(1);
  });
});

describe('review S2: light racks step finer than heavy ones', () => {
  it('kg in 1s: 1–10 in 1s, then 2.5s to the top; no 11, 23 or 47 kg assumed', () => {
    const loads = dumbbellLoadsFor('kg', 1, 50);
    expect(loads.slice(0, 11)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12.5]);
    expect(loads.at(-1)).toBe(50);
    for (const v of [11, 23, 27, 47]) expect(loads).not.toContain(v);
    expect(dumbbellLoadsFor('kg', 1, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(dumbbellLoadsFor('kg', 1, 15)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12.5, 15]);
  });

  it('lb in 2.5s: to 25, then 5s to 120; other steps run the whole rack', () => {
    const loads = dumbbellLoadsFor('lb', 2.5, 120);
    expect(loads.slice(8, 12)).toEqual([22.5, 25, 30, 35]);
    expect(loads).not.toContain(27.5);
    expect(loads.at(-1)).toBe(120);
    expect(dumbbellLoadsFor('kg', 2, 50).slice(0, 3)).toEqual([2, 4, 6]);
    expect(dumbbellLoadsFor('kg', 2.5, 50)).toHaveLength(20);
  });
});

describe('learning from a load the assumed gym cannot make', () => {
  const rack = dumbbells({ gymId: GYM, detailsSource: 'preset', loads: [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25] });
  const assumedStack = stack({ gymId: GYM, name: 'Machines', detailsSource: 'preset' });
  const legExtAt = { id: legExt.id, name: legExt.name };
  const snapGym = (eq: readonly EquipmentInstance[]) => ({ id: GYM, name: 'Main gym', equipment: eq });

  it('a 22 kg dumbbell on a 2.5 kg rack: Add 22 kg dumbbells here? → added; the rack stays assumed (review S1)', () => {
    const learn = gymLearnFor(rack, kg(22, 'per_hand'));
    expect(learn).toMatchObject({ kind: 'add_dumbbell', value: 22 });
    if (learn === null) throw new Error('none');
    expect(gymLearnText(learn)).toBe('Add 22 kg dumbbells here?');
    const edit = planGymLearn(rack, learn, T1, idGen(80_000));
    const after = edit?.equipment[0]?.after;
    expect(after?.kind === 'dumbbells' && after.loads).toContain(22);
    expect(after).toMatchObject({ version: 2, detailsSource: 'preset' });
    expect(after?.checkedAtUtc).toBeUndefined();
    expect(assumedWhy(after as EquipmentInstance)).toBe('Assumed dumbbells');
    // Already added: nothing more to do.
    expect(planGymLearn(after as EquipmentInstance, learn, T1, idGen(80_100))).toBeNull();
    expect(gymLearnFor(after as EquipmentInstance, kg(22, 'per_hand'))).toBeNull();
  });

  it('review N4: a dumbbell chip only on a 0.5 grid and at most two steps above the top', () => {
    expect(gymLearnFor(rack, kg(30, 'per_hand'))).toMatchObject({ kind: 'add_dumbbell', value: 30 });
    expect(gymLearnFor(rack, kg(31, 'per_hand'))).toBeNull();
    expect(gymLearnFor(rack, kg(97.5, 'per_hand'))).toBeNull();
    expect(gymLearnFor(rack, kg(23.75, 'per_hand'))).toBeNull();
    expect(gymLearnFor(rack, kg(13.5, 'per_hand'))).toMatchObject({ value: 13.5 });
  });

  it('review B2: Leg extension goes up in 7 kg? gives that machine its own stack; other machines keep the assumed 5s', () => {
    const before = [assumedStack];
    const step = gymLearnFor(assumedStack, kg(7, 'stack'), legExtAt);
    expect(step).toMatchObject({ kind: 'stack_step', step: 7, exerciseId: legExt.id });
    if (step === null) throw new Error('none');
    expect(gymLearnText(step)).toBe('Leg extension goes up in 7 kg?');
    const edit = planGymLearn(assumedStack, step, T1, idGen(80_200), before);
    if (edit === null) throw new Error('no edit');
    expect(edit.lines).toEqual(['Leg extension: every 7 kg']);
    const after = apply({ gym: gym(), equipment: before }, edit).equipment;
    const family = after.find((e) => e.id === assumedStack.id);
    const own = after.find((e) => e.id !== assumedStack.id);
    // The family stays assumed and unchanged, only not for leg extension.
    expect(family).toMatchObject({ detailsSource: 'preset', notFor: [legExt.id], version: 2 });
    expect(family?.kind === 'weight_stack' && family.stackLoads).toEqual(assumedStack.kind === 'weight_stack' ? assumedStack.stackLoads : []);
    expect(own).toMatchObject({ name: 'Leg extension', detailsSource: 'user', onlyFor: [legExt.id], version: 1 });
    expect(own?.kind === 'weight_stack' && own.stackLoads.slice(0, 3)).toEqual([7, 14, 21]);
    expect(own?.kind === 'weight_stack' && own.stackLoads.at(-1)).toBe(49);
    // Leg extension maps to its own stack; the pushdown still maps to the family and snaps in 5s.
    expect(equipmentHere(legExt, { gym: snapGym(after) }).equipment?.id).toBe(own?.id);
    const pushEq = equipmentHere(pushdown, { gym: snapGym(after) }).equipment;
    expect(pushEq?.id).toBe(assumedStack.id);
    if (pushEq === null) throw new Error('no item');
    expect(roundToAvailableLoad(kg(42, 'stack'), pushEq, 'easier')).toMatchObject({ ok: true, load: { value: 40 } });
    expect(equipmentForExercise(pushdown, after).map((e) => e.id)).toEqual([assumedStack.id]);
    // Leg extension is here (its own machine), not listed under Not at this gym.
    expect(notHereExerciseIds(after)).toEqual([]);
    // The confirmed own stack offers nothing more; the stale chip on the family plans nothing.
    expect(gymLearnFor(own as EquipmentInstance, kg(8, 'stack'), legExtAt)).toBeNull();
    expect(planGymLearn(family as EquipmentInstance, step, T2, idGen(80_300), after)).toBeNull();
    // Undo: the family is back as it was and the own stack retired.
    const back = planRevertGymEdit(edit, { gym: null, equipment: (id) => after.find((e) => e.id === id) ?? null }, T2);
    if (back === 'changed_since') throw new Error('changed');
    expect(back.equipment.map((w) => [w.next.id === assumedStack.id, w.next.availability, w.next.notFor ?? null])).toEqual([
      [true, 'available', null],
      [false, 'retired', null],
    ]);
  });

  it('review B2: above the top on its step → Leg extension goes to 60 kg?; another machine is untouched', () => {
    const top = gymLearnFor(assumedStack, kg(60, 'stack'), legExtAt);
    expect(top).toMatchObject({ kind: 'stack_max', max: 60 });
    if (top === null) throw new Error('none');
    expect(gymLearnText(top)).toBe('Leg extension goes to 60 kg?');
    const edit = planGymLearn(assumedStack, top, T1, idGen(80_400), [assumedStack]);
    const own = edit?.equipment.find((e) => e.before === null)?.after;
    expect(own?.kind === 'weight_stack' && own.stackLoads.slice(-3)).toEqual([50, 55, 60]);
    const family = edit?.equipment.find((e) => e.before !== null)?.after;
    expect(family?.kind === 'weight_stack' && family.stackLoads.at(-1)).toBe(50);
  });

  it('review B2: weak step guesses offer nothing (12 kg, 3 kg); no exercise, no stack chip', () => {
    expect(gymLearnFor(assumedStack, kg(12, 'stack'), legExtAt)).toBeNull();
    expect(gymLearnFor(assumedStack, kg(3, 'stack'), legExtAt)).toBeNull();
    expect(gymLearnFor(assumedStack, kg(7, 'stack'), null)).toBeNull();
    expect(gymLearnFor(assumedStack, kg(14, 'stack'), legExtAt)).toMatchObject({ step: 7 });
    expect(gymLearnFor(assumedStack, kg(9, 'stack'), legExtAt)).toMatchObject({ step: 4.5 });
  });

  it('nothing for: an achievable load, another unit or convention, a typo-sized load, a confirmed stack', () => {
    expect(gymLearnFor(rack, kg(22.5, 'per_hand'))).toBeNull();
    expect(gymLearnFor(rack, lb(22, 'per_hand'))).toBeNull();
    expect(gymLearnFor(rack, kg(22, 'total'))).toBeNull();
    expect(gymLearnFor(rack, kg(220, 'per_hand'))).toBeNull();
    expect(gymLearnFor(rack, null)).toBeNull();
    expect(gymLearnFor(stack({ gymId: GYM, detailsSource: 'user' }), kg(7, 'stack'), legExtAt)).toBeNull();
    // A lb rack learns in lb.
    const lbRack = dumbbells({ gymId: GYM, unit: 'lb', loads: [5, 10, 15, 20] });
    expect(gymLearnText(gymLearnFor(lbRack, lb(12.5, 'per_hand')) ?? { kind: 'add_dumbbell', equipmentId: '', unit: 'lb', value: 0 })).toBe('Add 12.5 lb dumbbells here?');
  });

  it('Not at this gym on a machine with its own stack, then Put back: only its own stack comes back', () => {
    const step = gymLearnFor(assumedStack, kg(7, 'stack'), legExtAt);
    if (step === null) throw new Error('none');
    const edit = planGymLearn(assumedStack, step, T1, idGen(80_500), [assumedStack]);
    if (edit === null) throw new Error('no edit');
    const learned = apply({ gym: gym(), equipment: [assumedStack] }, edit).equipment;
    const gone = planNotHere({ exercise: legExt, equipment: learned, atUtc: T2 });
    if (gone.kind !== 'edit') throw new Error(gone.kind);
    expect(gone.edit.equipment).toHaveLength(1);
    const after = apply({ gym: gym(), equipment: learned }, gone.edit).equipment;
    expect(notHereExerciseIds(after)).toEqual([legExt.id]);
    expect(doableHere(legExt, snapGym(after))).toBe(false);
    const back = planPutBack({ exerciseId: legExt.id, exerciseName: 'Leg extension', equipment: after, atUtc: T2 });
    expect(back?.equipment.map((e) => e.after.onlyFor)).toEqual([[legExt.id]]);
  });
});

describe('the coach’s update_gym changes', () => {
  const base = () => saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 });
  const exercises = new Map([legPress, legExt, dbPress].map((e) => [e.id, e]));
  const plan = (changes: Parameters<typeof planGymUpdate>[0]['changes'], s = base()) => planGymUpdate({ ...s, unit: 'kg', changes, exercise: (id) => exercises.get(id) ?? null, atUtc: T1, newId: idGen(70_000) });

  it('"no leg press here" marks it; "dumbbells go up in 2 to 40" sets the rack; one version per record', () => {
    const p = plan([
      { op: 'not_here', exerciseId: legPress.id },
      { op: 'dumbbells', max: 40, step: 2 },
      { op: 'dumbbells', max: 36, step: null },
    ]);
    if (!p.ok) throw new Error(p.reason);
    expect(p.edit.lines).toEqual(['Leg press: not here', 'Dumbbells: 2–40 kg, every 2', 'Dumbbells: 2–36 kg, every 2']);
    const rack = p.edit.equipment.find((e) => e.after.kind === 'dumbbells');
    expect(rack?.after.version).toBe(2);
    expect(rack?.after.kind === 'dumbbells' && rack.after.loads.at(-1)).toBe(36);
    expect(rack?.after.detailsSource).toBe('user');
    const plateMachine = p.edit.equipment.find((e) => e.after.kind === 'plate_loaded_machine');
    expect(plateMachine?.after.notFor).toEqual([legPress.id]);
  });

  it('remove a kind retires it and remembers it; add brings the full-gym items back, assumed', () => {
    const s = base();
    const r = plan([{ op: 'remove', equipment: 'assisted_stack' }], s);
    if (!r.ok) throw new Error(r.reason);
    expect(r.edit.gym?.after.missingKinds).toEqual(['assisted_stack']);
    const after = apply(s, r.edit);
    expect(after.equipment.filter((e) => e.kind === 'assisted_stack' && e.availability === 'available')).toHaveLength(0);
    const a = plan([{ op: 'add', equipment: 'assisted_stack' }], after);
    if (!a.ok) throw new Error(a.reason);
    expect(a.edit.gym?.after.missingKinds).toBeUndefined();
    expect(a.edit.equipment.map((e) => [e.before, e.after.kind, e.after.detailsSource])).toEqual([[null, 'assisted_stack', 'preset']]);
  });

  it('review B2: stack step for one machine (exerciseId) gives it its own stack; the family keeps its step', () => {
    const s = base();
    const p = plan([{ op: 'stack_step', step: 7, itemName: null, exerciseId: legExt.id }], s);
    if (!p.ok) throw new Error(p.reason);
    expect(p.edit.lines).toEqual(['Leg extension: every 7 kg']);
    const made = p.edit.equipment.find((e) => e.before === null)?.after;
    expect(made).toMatchObject({ name: 'Leg extension', onlyFor: [legExt.id], detailsSource: 'user' });
    const changed = p.edit.equipment.filter((e) => e.before !== null).map((e) => e.after);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ notFor: [legExt.id], detailsSource: 'preset' });
    // Again, on the machine's own stack now: only that item changes.
    const after = apply(s, p.edit);
    const again = plan([{ op: 'stack_step', step: 5, itemName: null, exerciseId: legExt.id }], after);
    if (!again.ok) throw new Error(again.reason);
    expect(again.edit.equipment.map((e) => e.after.id)).toEqual([made?.id]);
    // A family-wide step leaves a machine's own stack alone.
    const all = plan([{ op: 'stack_step', step: 10, itemName: null }], after);
    if (!all.ok) throw new Error(all.reason);
    expect(all.edit.equipment.map((e) => e.after.name).sort()).toEqual(['Cable station', 'Machines']);
  });

  it('review B2: in a full gym (Cable station first) the machine maps to its own stack', () => {
    const s = base();
    const machines = s.equipment.find((e) => e.name === 'Machines');
    if (machines === undefined) throw new Error('no machines');
    const learn = gymLearnFor(machines, kg(7, 'stack'), { id: legExt.id, name: 'Leg extension' });
    if (learn === null) throw new Error('none');
    const edit = planGymLearn(machines, learn, T1, idGen(81_000), s.equipment);
    if (edit === null) throw new Error('no edit');
    const after = apply(s, edit).equipment;
    const mapped = equipmentHere(legExt, { gym: { id: GYM, name: 'Main gym', equipment: after } }).equipment;
    expect(mapped).toMatchObject({ name: 'Leg extension', onlyFor: [legExt.id] });
    expect(equipmentHere(pushdown, { gym: { id: GYM, name: 'Main gym', equipment: after } }).equipment?.name).toBe('Cable station');
  });

  it('review N3: "dumbbells up to 60" lifts a saved ceiling with the rack', () => {
    const s = base();
    const capped = { ...s, equipment: s.equipment.map((e) => (e.kind === 'dumbbells' ? { ...e, maxLoad: 50 } : e)) };
    const p = plan([{ op: 'dumbbells', max: 60, step: null }], capped);
    if (!p.ok) throw new Error(p.reason);
    const rack = p.edit.equipment[0]?.after;
    expect(rack?.kind === 'dumbbells' && [rack.loads.at(-1), rack.maxLoad]).toEqual([60, 60]);
    expect(getAchievableLoads(rack as EquipmentInstance).loads.at(-1)).toBe(60);
  });

  it('a 1 kg ladder keeps its 1s when only the top changes', () => {
    const s = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 1 });
    const p = plan([{ op: 'dumbbells', max: 30, step: null }], s);
    if (!p.ok) throw new Error(p.reason);
    const rack = p.edit.equipment[0]?.after;
    expect(rack?.kind === 'dumbbells' && rack.loads.slice(0, 3)).toEqual([1, 2, 3]);
    expect(rack?.kind === 'dumbbells' && rack.loads.at(-1)).toBe(30);
  });

  it('stack step for a named family; bad numbers are refused, nothing written', () => {
    const p = plan([{ op: 'stack_step', step: 7, itemName: 'cable' }]);
    if (!p.ok) throw new Error(p.reason);
    expect(p.edit.equipment.map((e) => e.after.name)).toEqual(['Cable station']);
    expect(p.edit.lines).toEqual(['Cable station: every 7 kg']);
    expect(plan([{ op: 'dumbbells', max: null, step: 12.5 }])).toMatchObject({ ok: false });
    expect(plan([{ op: 'stack_step', step: 7, itemName: 'smith' }])).toMatchObject({ ok: false });
    expect(plan([{ op: 'not_here', exerciseId: '00000000-0000-4000-8000-000000000999' }])).toMatchObject({ ok: false });
  });
});

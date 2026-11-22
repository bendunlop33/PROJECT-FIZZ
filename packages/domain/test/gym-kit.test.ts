import { describe, expect, it } from 'vitest';
import { GymSchema, type EquipmentInstance, type Exercise, type Gym } from '@fizz/schemas';
import {
  applyEquipmentForm,
  assumedWhy,
  buildPlateSetup,
  buildPresetDraft,
  buildQuickGymDraft,
  catalogueExerciseId,
  checkCustomExerciseFields,
  doableHere,
  equipmentForExercise,
  equipmentRowLine,
  formFromEquipment,
  getAchievableLoads,
  gymAvailability,
  isBarLoaded,
  isLoadAchievable,
  loadFieldLabel,
  loadPreviewLine,
  loadText,
  mapEquipment,
  materialiseGymDraft,
  missingStations,
  newEquipmentForm,
  planGymUpdate,
  planMakeFullGym,
  roundToAvailableLoad,
  snapPlanToGym,
  stepLoad,
  type QuickGymInput,
} from '../src/index';
import { barbell, dumbbells, exercise, GYM, idGen, kg, lb, OWNER, T0 } from './fixtures';

/** (Ben, 20 Oct; ADR 0030) Kettlebells, EZ bar, trap bar, Smith machine, benches and racks. */

const T1 = '2026-10-20T06:00:00.000Z';

function gym(over: Partial<Gym> = {}): Gym {
  return GymSchema.parse({ id: GYM, ownerId: OWNER, version: 1, createdAtUtc: T0, updatedAtUtc: T0, name: 'Main gym', isDefault: true, ...over });
}

function saveQuick(input: QuickGymInput): EquipmentInstance[] {
  const r = materialiseGymDraft(buildQuickGymDraft(input), { name: 'Gym', ownerId: OWNER, gymId: GYM, isDefault: true, atUtc: T0, newId: idGen(), setup: input.setup });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.equipment;
}

const item = <K extends EquipmentInstance['kind']>(list: readonly EquipmentInstance[], kind: K) => {
  const e = list.find((x) => x.kind === kind && x.availability === 'available');
  if (e === undefined) throw new Error(`no ${kind}`);
  return e as Extract<EquipmentInstance, { kind: K }>;
};

/** A catalogue exercise row (its ID is `UUIDv5(key)`, which the station table is looked up by). */
function catalogue(key: string, name: string, over: Partial<Exercise>): Exercise {
  return { ...exercise(1, name, over), id: catalogueExerciseId(key), catalogueKey: key };
}

const benchPress = catalogue('barbell-bench-press', 'Bench press', { compatibleEquipment: ['barbell'], defaultLoadConvention: 'total' });
const inclineDb = catalogue('dumbbell-incline-bench-press', 'Incline dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const dbRow = catalogue('dumbbell-bent-over-row', 'Dumbbell row', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const bwSplitSquat = catalogue('bodyweight-bulgarian-split-squat', 'Bulgarian split squat', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
const swing = catalogue('kettlebell-swing', 'Kettlebell swing', { compatibleEquipment: ['kettlebell'], defaultLoadConvention: 'per_hand' });
const smithSquat = catalogue('smith-machine-squat', 'Smith machine squat', { compatibleEquipment: ['smith_machine'], defaultLoadConvention: 'added' });
const trapDeadlift = catalogue('trap-bar-deadlift', 'Trap bar deadlift', { compatibleEquipment: ['trap_bar'], defaultLoadConvention: 'total' });
const ezCurl = catalogue('ez-bar-curl', 'EZ bar curl', { compatibleEquipment: ['ez_bar'], defaultLoadConvention: 'total' });

const snapGym = (equipment: readonly EquipmentInstance[]) => ({ id: GYM, name: 'Gym', equipment });

describe('full gym: every new kind, assumed, at typical values (kg and lb natively)', () => {
  it.each([
    ['kg', [4, 8, 12, 16, 20, 24, 28, 32], 10, 25, 15],
    ['lb', [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70], 20, 55, 35],
  ] as const)('%s', (unit, bells, ez, trap, smith) => {
    const eq = saveQuick({ setup: 'full', unit, dumbbellStep: unit === 'kg' ? 2.5 : 5 });
    expect(item(eq, 'kettlebell')).toMatchObject({ loadConvention: 'per_hand', loads: bells, unit, detailsSource: 'preset' });
    expect(item(eq, 'ez_bar')).toMatchObject({ loadConvention: 'total', barMass: ez, unit, detailsSource: 'preset' });
    expect(item(eq, 'trap_bar')).toMatchObject({ loadConvention: 'total', barMass: trap });
    // Plates added, its bar's starting weight beside the load, never in it (rule 6: the bar weight is assumed).
    expect(item(eq, 'smith_machine')).toMatchObject({ loadConvention: 'added', barMass: smith, name: 'Smith machine' });
    expect(item(eq, 'bench')).toMatchObject({ benchType: 'adjustable', loadConvention: 'bodyweight' });
    expect(item(eq, 'rack')).toMatchObject({ rackType: 'power_rack' });
    // Gym defaults stay (item 10): dumbbells to 50 kg / 120 lb.
    expect(item(eq, 'dumbbells').loads.at(-1)).toBe(unit === 'kg' ? 50 : 120);
  });

  it('a bench or rack has no load of its own', () => {
    const eq = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 });
    expect(getAchievableLoads(item(eq, 'bench')).loads).toEqual([]);
    expect(isLoadAchievable(kg(0, 'bodyweight'), item(eq, 'rack'))).toBe(true);
    expect(isLoadAchievable(kg(20, 'bodyweight'), item(eq, 'rack'))).toBe(false);
  });

  it('the typical (commercial) gym ticks a bench and a rack; the others are there to tick', () => {
    const draft = buildPresetDraft('commercial', 'kg');
    expect(draft.items.filter((i) => i.ticked).map((i) => i.key)).toContain('bench');
    expect(draft.items.filter((i) => !i.ticked).map((i) => i.key)).toEqual(expect.arrayContaining(['kettlebells', 'ez_bar', 'trap_bar', 'smith_machine']));
  });
});

describe('snapping on the new kinds (rule 4)', () => {
  const eq = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 });

  it('kettlebells: per bell, toward easier, never past the heaviest', () => {
    const kb = item(eq, 'kettlebell');
    expect(roundToAvailableLoad(kg(22, 'per_hand'), kb, 'easier')).toMatchObject({ ok: true, load: { value: 20, convention: 'per_hand' }, exact: false });
    expect(roundToAvailableLoad(kg(40, 'per_hand'), kb, 'nearest')).toMatchObject({ ok: true, load: { value: 32 }, bounded: 'max' });
    expect(stepLoad(32, kb, 'increase')).toEqual({ ok: false, reason: 'at_max' });
    // A total isn't a per-bell load: never silently reinterpreted.
    expect(roundToAvailableLoad(kg(16, 'total'), kb, 'nearest')).toMatchObject({ ok: false, reason: 'convention_mismatch' });
  });

  it('EZ and trap: totals incl. the bar, from the bar up; Smith: plates added, balanced', () => {
    const ez = item(eq, 'ez_bar');
    const trap = item(eq, 'trap_bar');
    const smith = item(eq, 'smith_machine');
    expect(isBarLoaded(ez) && isBarLoaded(trap)).toBe(true);
    expect(isBarLoaded(smith)).toBe(false);
    expect(getAchievableLoads(ez).loads[0]).toBe(10);
    expect(getAchievableLoads(trap).loads[0]).toBe(25);
    expect(getAchievableLoads(smith).loads.slice(0, 3)).toEqual([0, 2.5, 5]);
    expect(roundToAvailableLoad(kg(41, 'added'), smith, 'easier')).toMatchObject({ ok: true, load: { value: 40, convention: 'added' } });
    // Shown as plates, never as weight added to the body.
    expect(loadText(kg(40, 'added'), 'added', smith)).toBe('40\u00a0kg\u00a0plates');
    expect(loadFieldLabel('added', smith)).toBe('Plates');
    // A total is never read as plates.
    expect(roundToAvailableLoad(kg(60, 'total'), smith, 'easier')).toMatchObject({ ok: false, reason: 'convention_mismatch' });
    expect(roundToAvailableLoad(kg(31, 'total'), ez, 'easier')).toMatchObject({ ok: true, load: { value: 30 } });
    // Below the bar is never rounded up to it by a fit (dropped instead).
    expect(roundToAvailableLoad(kg(5, 'total'), trap, 'easier')).toMatchObject({ ok: true, load: { value: 25 }, bounded: 'min' });
    expect(buildPlateSetup({ value: 40, unit: 'kg' }, smith)).toMatchObject({ ok: true, base: { value: 0 }, sides: 2, perSide: [{ mass: 20, count: 1 }] });
    expect(buildPlateSetup({ value: 70, unit: 'kg' }, ez)).toMatchObject({ ok: true, base: { value: 10 }, perSide: [{ mass: 25, count: 1 }, { mass: 5, count: 1 }] });
    expect(buildPlateSetup({ value: 5, unit: 'kg' }, trap)).toMatchObject({ ok: false, reason: 'below_base' });
    // A max is never passed.
    const capped = { ...trap, maxLoad: 105 };
    expect(roundToAvailableLoad(kg(140, 'total'), capped, 'nearest')).toMatchObject({ ok: true, load: { value: 105 }, bounded: 'max' });
  });

  it('lb gym: natively in lb (no conversion), a kg request converts', () => {
    const lbEq = saveQuick({ setup: 'full', unit: 'lb', dumbbellStep: 5 });
    expect(roundToAvailableLoad(lb(37, 'per_hand'), item(lbEq, 'kettlebell'), 'easier')).toMatchObject({ ok: true, load: { value: 35, unit: 'lb' } });
    expect(roundToAvailableLoad(kg(16, 'per_hand'), item(lbEq, 'kettlebell'), 'nearest')).toMatchObject({ ok: true, load: { value: 35, unit: 'lb' }, convertedRequest: { unit: 'lb' } });
    expect(getAchievableLoads(item(lbEq, 'trap_bar')).loads[0]).toBe(55);
  });

  it('a plan made for kettlebells, Smith and trap bar maps to those items; a gym without them has them not here', () => {
    const slot = (ex: Exercise, kind: EquipmentInstance['kind'], value: number, convention: 'total' | 'per_hand' | 'added') => ({
      slotId: ex.id,
      exercise: ex,
      sourceEquipment: { id: 'elsewhere', kind, name: 'x', gymId: 'other' },
      unit: 'kg' as const,
      convention,
      sets: [{ id: `${ex.id}-1`, setType: 'working' as const, intended: kg(value, convention), current: null, reps: { min: 8, max: 8 }, durationS: null }],
    });
    const slots = [slot(swing, 'kettlebell', 18, 'per_hand'), slot(smithSquat, 'smith_machine', 61, 'added'), slot(trapDeadlift, 'trap_bar', 101, 'total')];
    const r = snapPlanToGym({ mode: 'start', slots, gym: snapGym(eq), ownerUnit: 'kg' });
    expect(r.slots.map((s) => [s.equipment?.kind, s.sets[0]?.load?.value])).toEqual([
      ['kettlebell', 16],
      ['smith_machine', 60],
      ['trap_bar', 100],
    ]);
    const plain = snapPlanToGym({ mode: 'start', slots, gym: snapGym([barbell({ gymId: GYM }), dumbbells({ gymId: GYM })]), ownerUnit: 'kg' });
    // Never planned on the Olympic bar or the dumbbells (rule 4).
    expect(plain.slots.map((s) => [s.mapping, s.sets[0]?.load])).toEqual([
      ['not_here', null],
      ['not_here', null],
      ['not_here', null],
    ]);
  });

  it('Why? names what is assumed; confirmed items say nothing', () => {
    expect(assumedWhy(item(eq, 'kettlebell'))).toBe('Assumed kettlebells');
    expect(assumedWhy(item(eq, 'ez_bar'))).toBe('Assumed bar and plates');
    expect(assumedWhy(item(eq, 'smith_machine'))).toBe('Assumed plates');
    expect(assumedWhy({ ...item(eq, 'trap_bar'), detailsSource: 'user' })).toBeNull();
    expect(assumedWhy(item(eq, 'bench'))).toBeNull();
  });
});

describe('benches and racks enable the exercises that need them', () => {
  it('hotel: a bench by default, no rack: bench press needs the rack; dumbbell work is fine', () => {
    const hotel = saveQuick({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: ['cable', 'bench', 'barbell'] });
    expect(item(hotel, 'bench').benchType).toBe('adjustable');
    expect(missingStations(benchPress.id, hotel)).toEqual(['rack']);
    expect(equipmentForExercise(benchPress, hotel)).toEqual([]);
    expect(doableHere(benchPress, snapGym(hotel))).toBe(false);
    expect(gymAvailability(benchPress, hotel)).toBe('not_at_gym');
    expect(mapEquipment(benchPress, { id: 'x', kind: 'barbell', name: 'Bar', gymId: 'other' }, snapGym(hotel), undefined)).toEqual({ equipment: null, mapping: 'not_here', stations: ['rack'] });
    expect(doableHere(inclineDb, snapGym(hotel))).toBe(true);
    expect(doableHere(dbRow, snapGym(hotel))).toBe(true);
    // Ticking the rack too: bench press is on.
    const withRack = saveQuick({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: ['bench', 'barbell', 'rack'] });
    expect(doableHere(benchPress, snapGym(withRack))).toBe(true);
  });

  it('home without a bench: bench exercises are not here; bodyweight ones never need it', () => {
    const home = saveQuick({ setup: 'home', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: [] });
    expect(missingStations(inclineDb.id, home)).toEqual(['incline_bench']);
    expect(doableHere(inclineDb, snapGym(home))).toBe(false);
    expect(doableHere(dbRow, snapGym(home))).toBe(true);
    expect(doableHere(bwSplitSquat, snapGym(home))).toBe(true);
  });

  it('a flat bench serves flat work only; an incline one incline only; adjustable both', () => {
    const base = saveQuick({ setup: 'home', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: ['bench'] });
    const withType = (benchType: 'flat' | 'incline' | 'adjustable') => base.map((e) => (e.kind === 'bench' ? { ...e, benchType } : e));
    const dbBench = catalogue('dumbbell-bench-press', 'Dumbbell bench press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    expect([doableHere(dbBench, snapGym(withType('flat'))), doableHere(inclineDb, snapGym(withType('flat')))]).toEqual([true, false]);
    expect([doableHere(dbBench, snapGym(withType('incline'))), doableHere(inclineDb, snapGym(withType('incline')))]).toEqual([false, true]);
    expect([doableHere(dbBench, snapGym(withType('adjustable'))), doableHere(inclineDb, snapGym(withType('adjustable')))]).toEqual([true, true]);
  });

  it('a gym set up before benches and racks existed (no record) stops nothing; Make full gym adds them', () => {
    const old = [barbell({ gymId: GYM }), dumbbells({ gymId: GYM })];
    expect(missingStations(benchPress.id, old)).toEqual([]);
    expect(doableHere(benchPress, snapGym(old))).toBe(true);
    // A custom exercise has no station needs.
    expect(missingStations(exercise(5, 'My press').id, saveQuick({ setup: 'home', unit: 'kg', dumbbells: null, extras: [] }))).toEqual([]);
  });

  it('Make full gym on a hotel gym brings the bench and rack it said it lacked, and every new kind', () => {
    const hotel = saveQuick({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: [] });
    const p = planMakeFullGym({ gym: gym({ setup: 'small' }), equipment: hotel, unit: 'kg', dumbbellStep: 2, atUtc: T1, newId: idGen(80_000) });
    if (p.kind !== 'edit') throw new Error(p.kind);
    expect(p.edit.equipment.map((e) => e.after.kind)).toEqual(expect.arrayContaining(['kettlebell', 'ez_bar', 'trap_bar', 'smith_machine', 'bench', 'rack']));
    const after = [...hotel, ...p.edit.equipment.map((e) => e.after)];
    expect(doableHere(inclineDb, snapGym(after))).toBe(true);
  });

  it('the coach adds kettlebells on Ben’s word; "no bench here" retires it and its exercises leave', () => {
    const full = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 }).filter((e) => e.kind !== 'kettlebell');
    const g = gym({ setup: 'full' });
    const add = planGymUpdate({ gym: g, equipment: full, unit: 'kg', changes: [{ op: 'add', equipment: 'kettlebell' }], exercise: () => null, atUtc: T1, newId: idGen(90_000) });
    expect(add.ok && add.edit.equipment.map((e) => [e.before, e.after.kind, e.after.detailsSource])).toEqual([[null, 'kettlebell', 'preset']]);
    expect(add.ok && add.edit.lines).toEqual(['Added: Kettlebells']);
    const remove = planGymUpdate({ gym: g, equipment: full, unit: 'kg', changes: [{ op: 'remove', equipment: 'bench' }], exercise: () => null, atUtc: T1, newId: idGen(91_000) });
    if (!remove.ok) throw new Error(remove.reason);
    expect(remove.edit.lines).toEqual(['Bench: not here']);
    const after = full.map((e) => remove.edit.equipment.find((x) => x.after.id === e.id)?.after ?? e);
    expect(doableHere(dbRow, snapGym(after))).toBe(true);
    expect(doableHere(inclineDb, snapGym(after))).toBe(false);
  });
});

describe('gym editor for the new kinds', () => {
  const meta = { id: '00000000-0000-4000-8000-000000000099', ownerId: OWNER, gymId: GYM, atUtc: T1 };

  it('new forms start at the typical values', () => {
    expect(newEquipmentForm('smith_machine', 'kg')).toMatchObject({ kind: 'smith_machine', barMass: 15, name: 'Smith machine' });
    expect(newEquipmentForm('ez_bar', 'lb')).toMatchObject({ barMass: 20, name: 'EZ bar' });
    expect(newEquipmentForm('trap_bar', 'kg')).toMatchObject({ barMass: 25, name: 'Trap bar' });
    expect(newEquipmentForm('kettlebell', 'kg')).toMatchObject({ range: { from: 4, to: 32, step: 4 } });
  });

  it('saves each kind checked by Ben, with its own preview line', () => {
    const smith = applyEquipmentForm({ ...newEquipmentForm('smith_machine', 'kg'), plates: [{ mass: 20, count: 4 }] } as never, null, meta);
    if (!smith.ok) throw new Error(smith.problems.join());
    expect(smith.equipment).toMatchObject({ kind: 'smith_machine', loadConvention: 'added', barMass: 15, detailsSource: 'user' });
    expect(equipmentRowLine(smith.equipment)).toBe('0–80 kg plates · 15 kg bar');
    expect(loadPreviewLine(smith.equipment)).toBe('Makes 3 loads: 0–80 kg plates, every 40 kg · 15 kg bar.');
    const ezSaved = applyEquipmentForm({ ...newEquipmentForm('ez_bar', 'kg'), plates: [{ mass: 10, count: 2 }] } as never, null, meta);
    expect(ezSaved.ok && equipmentRowLine(ezSaved.equipment)).toBe('10–30 kg · total');

    const kb = applyEquipmentForm(newEquipmentForm('kettlebell', 'kg'), null, meta);
    if (!kb.ok) throw new Error(kb.problems.join());
    expect(equipmentRowLine(kb.equipment)).toBe('4–32 kg each');
    expect(formFromEquipment(kb.equipment)).toMatchObject({ kind: 'kettlebell', range: { from: 4, to: 32, step: 4 }, missing: [], extra: [] });

    const bench = applyEquipmentForm({ ...newEquipmentForm('bench', 'kg'), benchType: 'flat' } as never, null, meta);
    if (!bench.ok) throw new Error(bench.problems.join());
    expect(bench.equipment).toMatchObject({ kind: 'bench', benchType: 'flat', loadConvention: 'bodyweight' });
    expect(equipmentRowLine(bench.equipment)).toBe('Flat');
    expect(formFromEquipment(bench.equipment)).toEqual({ kind: 'bench', name: 'Bench', unit: 'kg', benchType: 'flat' });

    const rack = applyEquipmentForm(newEquipmentForm('rack', 'kg'), null, meta);
    expect(rack.ok && equipmentRowLine(rack.equipment)).toBe('Squat rack');
  });

  it('a max below the bar is refused for the EZ and trap bar; a Smith max is plates', () => {
    for (const kind of ['ez_bar', 'trap_bar'] as const) {
      const r = applyEquipmentForm({ ...newEquipmentForm(kind, 'kg'), maxLoad: 5 } as never, null, meta);
      expect(r.ok).toBe(false);
    }
    const smith = applyEquipmentForm({ ...newEquipmentForm('smith_machine', 'kg'), plates: [{ mass: 20, count: 4 }], maxLoad: 5 } as never, null, meta);
    expect(smith.ok && getAchievableLoads(smith.equipment).loads).toEqual([0]);
  });
});

describe('custom exercises', () => {
  it('can be on a Smith machine; never on a bench or rack (presence only)', () => {
    const base = { name: 'Smith shrug', loadConvention: 'added', primaryMuscles: ['upper_back'], measurement: 'reps', laterality: 'bilateral' };
    expect(checkCustomExerciseFields({ ...base, equipment: 'smith_machine' }).ok).toBe(true);
    expect(checkCustomExerciseFields({ ...base, equipment: 'smith_machine', loadConvention: 'total' }).ok).toBe(false);
    expect(checkCustomExerciseFields({ ...base, equipment: 'bench' }).ok).toBe(false);
    expect(checkCustomExerciseFields({ ...base, equipment: 'rack', loadConvention: 'total' }).ok).toBe(false);
  });
});

describe('EZ curl on the EZ bar only', () => {
  it('maps to the EZ bar, never the Olympic bar', () => {
    const eq = [barbell({ gymId: GYM }), ...saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 }).filter((e) => e.kind === 'ez_bar')];
    expect(equipmentForExercise(ezCurl, eq).map((e) => e.kind)).toEqual(['ez_bar']);
    expect(equipmentForExercise(ezCurl, [barbell({ gymId: GYM })])).toEqual([]);
  });
});

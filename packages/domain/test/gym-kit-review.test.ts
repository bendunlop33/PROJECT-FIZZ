import { describe, expect, it } from 'vitest';
import { GymSchema, PlannedSnapSchema, ProposeExerciseArgsSchema, type EquipmentInstance, type Exercise, type Gym } from '@fizz/schemas';
import {
  assumedLine,
  buildQuickGymDraft,
  cardNoteText,
  catalogueExerciseId,
  doableHere,
  equipmentKey,
  materialiseGymDraft,
  missingStations,
  needsStationText,
  pickerEquipmentLabel,
  planGymUpdate,
  plannedSnapOf,
  planRevertGymEdit,
  plateBreakdownLine,
  refitNote,
  repeatNoteText,
  sameEquipmentKind,
  setSnapNote,
  snapPlanToGym,
  stationWords,
  warmUpRamp,
  warmUpText,
  type GymEdit,
  type QuickGymInput,
} from '../src/index';
import { barbell, dumbbells, exercise, GYM, idGen, kg, OWNER, T0 } from './fixtures';

/** Review ben-kit (20 Oct): B1, B3, S1, S2, S4, N2 on the kit slice (ADR 0030). */

const T1 = '2026-10-20T06:00:00.000Z';
const T2 = '2026-10-20T07:00:00.000Z';

function gym(over: Partial<Gym> = {}): Gym {
  return GymSchema.parse({ id: GYM, ownerId: OWNER, version: 1, createdAtUtc: T0, updatedAtUtc: T0, name: 'Hotel', isDefault: true, ...over });
}

function saveQuick(input: QuickGymInput): EquipmentInstance[] {
  const r = materialiseGymDraft(buildQuickGymDraft(input), { name: 'Hotel', ownerId: OWNER, gymId: GYM, isDefault: true, atUtc: T0, newId: idGen(), setup: input.setup });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.equipment;
}

const item = <K extends EquipmentInstance['kind']>(list: readonly EquipmentInstance[], kind: K) => {
  const e = list.find((x) => x.kind === kind && x.availability === 'available');
  if (e === undefined) throw new Error(`no ${kind}`);
  return e as Extract<EquipmentInstance, { kind: K }>;
};

function catalogue(key: string, name: string, over: Partial<Exercise>): Exercise {
  return { ...exercise(1, name, over), id: catalogueExerciseId(key), catalogueKey: key };
}

const ohp = catalogue('barbell-overhead-press', 'Overhead press', { compatibleEquipment: ['barbell'], defaultLoadConvention: 'total' });
const benchPress = catalogue('barbell-bench-press', 'Bench press', { compatibleEquipment: ['barbell'], defaultLoadConvention: 'total' });
const inclineDb = catalogue('dumbbell-incline-bench-press', 'Incline dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const dbBench = catalogue('dumbbell-bench-press', 'Dumbbell bench press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const dbRow = catalogue('dumbbell-bent-over-row', 'Dumbbell row', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });

const snapGym = (equipment: readonly EquipmentInstance[]) => ({ id: GYM, name: 'Hotel', equipment });
const plain = (s: string | null | undefined) => s?.replaceAll(' ', ' ') ?? null;

describe('B1: a lift left out for a missing bench or rack names the bench or rack, never its own item', () => {
  // A hotel with a barbell and a bench, no rack: the overhead press is planned on the hotel's own barbell.
  const hotel = saveQuick({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: ['bench', 'barbell'] });
  const bar = item(hotel, 'barbell');
  const slot = (ex: Exercise, value: number) => ({
    slotId: ex.id,
    exercise: ex,
    sourceEquipment: { id: bar.id, kind: bar.kind, name: bar.name, gymId: GYM },
    unit: 'kg' as const,
    convention: 'total' as const,
    sets: [{ id: `${ex.id}-1`, setType: 'working' as const, intended: kg(value), current: null, reps: { min: 5, max: 5 }, durationS: null }],
  });
  const r = snapPlanToGym({ mode: 'start', slots: [slot(ohp, 40), slot(benchPress, 60)], gym: snapGym(hotel), ownerUnit: 'kg' });

  it('the fit records the missing rack, stored on the set (reads the same after a relaunch)', () => {
    expect(r.slots.map((s) => [s.mapping, s.stations, s.sets[0]?.reason])).toEqual([
      ['not_here', ['rack'], 'not_here'],
      ['not_here', ['rack'], 'not_here'],
    ]);
    const s0 = r.slots[0];
    const set = s0?.sets[0];
    if (s0 === undefined || set === undefined) throw new Error('no slot');
    const stored = plannedSnapOf(set, s0, 'start', GYM);
    expect(stored).toMatchObject({ outcome: 'dropped', reason: 'not_here', stations: ['rack'], intendedOn: { equipmentId: bar.id } });
    // Round-trips through the stored schema (planned.snap).
    expect(PlannedSnapSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    const text = setSnapNote(PlannedSnapSchema.parse(stored), null, { gymName: 'Hotel', equipment: null, unit: 'kg' });
    expect(plain(text?.text)).toBe('No load target · no rack here · plan 40 kg');
    expect(text?.text).not.toContain('barbell');
  });

  it('the switch card, Repeat and Why? say the rack', () => {
    const s0 = r.slots[0];
    const note = s0?.notes.find((n) => n.kind === 'dropped');
    if (s0 === undefined || note === undefined) throw new Error('no note');
    expect(plain(cardNoteText(note, s0)?.text)).toBe('No rack here');
    expect(plain(repeatNoteText(note, s0))).toBe('No load target · no rack here · last time 40 kg × 5');
    const stored = plannedSnapOf(s0.sets[0] ?? (undefined as never), s0, 'gym_switch', GYM) ?? undefined;
    expect(plain(refitNote(stored, null, null, 'Plan'))).toBe('No load target: plan was 40 kg, and this gym has no rack.');
  });

  it('a gap that isn’t a station still names the planned item (as before)', () => {
    // No barbell, but a rack: the barbell is what's missing.
    const noBar = hotel.filter((e) => e.kind !== 'barbell').map((e) => (e.kind === 'rack' ? { ...e, availability: 'available' as const } : e));
    const x = snapPlanToGym({ mode: 'start', slots: [slot(ohp, 40)], gym: snapGym(noBar), ownerUnit: 'kg' });
    expect(x.slots[0]?.stations).toEqual([]);
    const s0 = x.slots[0];
    const set = s0?.sets[0];
    if (s0 === undefined || set === undefined) throw new Error('no slot');
    const stored = plannedSnapOf(set, s0, 'start', GYM);
    expect(stored?.stations).toBeUndefined();
    expect(plain(setSnapNote(stored ?? undefined, null, { gymName: 'Hotel', equipment: null, unit: 'kg' })?.text)).toBe('No load target · no barbell and plates here · plan 40 kg');
  });

  it('the picker row says what is needed', () => {
    expect(pickerEquipmentLabel(ohp, [], missingStations(ohp.id, hotel))).toBe('Needs a rack');
    const home = saveQuick({ setup: 'home', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: [] });
    expect(pickerEquipmentLabel(inclineDb, [], missingStations(inclineDb.id, home))).toBe('Needs an incline bench');
    // Not a station: the old line.
    expect(pickerEquipmentLabel(dbRow, [])).toBe('Not at this gym · loads won’t be checked');
    expect(needsStationText(['bench', 'rack'])).toBe('Needs a bench and rack');
    expect(stationWords(['bench', 'rack'])).toBe('bench or rack');
    expect(stationWords([])).toBeNull();
  });

  it('stored stations only ever explain `not_here`', () => {
    const base = { intended: kg(40), intendedOn: null, outcome: 'dropped', equipmentId: null, gymId: GYM, by: 'start' } as const;
    expect(PlannedSnapSchema.safeParse({ ...base, reason: 'no_achievable_loads', stations: ['rack'] }).success).toBe(false);
    expect(PlannedSnapSchema.safeParse({ ...base, reason: 'not_here', stations: ['rack'] }).success).toBe(true);
    // A snap stored before this change (no `stations`) still reads.
    expect(PlannedSnapSchema.safeParse({ ...base, reason: 'not_here' }).success).toBe(true);
  });
});

describe('B3: the coach’s "no bench here" takes effect on a gym with no bench record; Undo brings the exercises back', () => {
  // A gym set up before benches and racks existed: no record of either.
  const old = [barbell({ gymId: GYM }), dumbbells({ gymId: GYM })];
  const g = gym();

  function apply(equipment: readonly EquipmentInstance[], edit: GymEdit): EquipmentInstance[] {
    const out = new Map(equipment.map((e) => [e.id, e]));
    for (const e of edit.equipment) out.set(e.after.id, e.after);
    return [...out.values()];
  }

  it('Apply saves a retired bench (known none), so bench exercises leave; flat-free work stays', () => {
    expect(doableHere(dbBench, snapGym(old))).toBe(true);
    const p = planGymUpdate({ gym: g, equipment: old, unit: 'kg', changes: [{ op: 'remove', equipment: 'bench' }], exercise: () => null, atUtc: T1, newId: idGen(95_000) });
    if (!p.ok) throw new Error(p.reason);
    expect(p.edit.lines).toEqual(['Bench: not here']);
    expect(p.edit.equipment.map((e) => [e.before, e.after.kind, e.after.availability])).toEqual([[null, 'bench', 'retired']]);
    expect(p.edit.gym?.after.missingKinds).toEqual(['bench']);
    const after = apply(old, p.edit);
    expect(missingStations(dbBench.id, after)).toEqual(['bench']);
    expect(doableHere(dbBench, snapGym(after))).toBe(false);
    expect(doableHere(inclineDb, snapGym(after))).toBe(false);
    expect(doableHere(dbRow, snapGym(after))).toBe(true);
    // A rack isn't touched: the bench press still needs only the bench.
    expect(missingStations(benchPress.id, after)).toEqual(['bench']);

    // Undo: the gym back, the retired bench removed (a retired one would still say "none here").
    const byId = new Map(after.map((e) => [e.id, e]));
    const gymAfter = p.edit.gym?.after ?? g;
    const undo = planRevertGymEdit(p.edit, { gym: gymAfter, equipment: (id) => byId.get(id) ?? null }, T2);
    if (undo === 'changed_since') throw new Error('stale');
    expect(undo.equipment).toEqual([]);
    expect(undo.remove).toEqual([{ id: p.edit.equipment[0]?.after.id, expectedVersion: 1 }]);
    expect(undo.gym?.next.missingKinds).toBeUndefined();
    const undone = after.filter((e) => !undo.remove.some((r) => r.id === e.id));
    expect(doableHere(dbBench, snapGym(undone))).toBe(true);
    expect(doableHere(inclineDb, snapGym(undone))).toBe(true);
  });

  it('a gym that already has a bench record retires it (no second record); Undo puts it back', () => {
    const withBench = saveQuick({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: ['bench'] });
    const p = planGymUpdate({ gym: g, equipment: withBench, unit: 'kg', changes: [{ op: 'remove', equipment: 'bench' }], exercise: () => null, atUtc: T1, newId: idGen(96_000) });
    if (!p.ok) throw new Error(p.reason);
    expect(p.edit.equipment.map((e) => [e.before?.availability, e.after.availability])).toEqual([['available', 'retired']]);
    const after = apply(withBench, p.edit);
    const byId = new Map(after.map((e) => [e.id, e]));
    const undo = planRevertGymEdit(p.edit, { gym: p.edit.gym?.after ?? g, equipment: (id) => byId.get(id) ?? null }, T2);
    if (undo === 'changed_since') throw new Error('stale');
    expect(undo.remove).toEqual([]);
    expect(undo.equipment.map((w) => w.next.availability)).toEqual(['available']);
  });

  it('a gym with a retired rack already (quick setup) adds nothing more for "no rack here"', () => {
    const hotel = saveQuick({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: ['bench'] });
    const p = planGymUpdate({ gym: g, equipment: hotel, unit: 'kg', changes: [{ op: 'remove', equipment: 'rack' }], exercise: () => null, atUtc: T1, newId: idGen(97_000) });
    if (!p.ok) throw new Error(p.reason);
    expect(p.edit.equipment).toEqual([]);
    expect(p.edit.gym?.after.missingKinds).toEqual(['rack']);
  });
});

describe('S1: EZ and trap bars of different weights are never compared as the same lift', () => {
  const full = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 });
  const ez = item(full, 'ez_bar');
  const trap = item(full, 'trap_bar');

  it('a different bar weight makes the totals incomparable; the same bar matches', () => {
    expect(sameEquipmentKind(equipmentKey(ez), equipmentKey({ ...ez, barMass: 7.5 }))).toBe(false);
    expect(sameEquipmentKind(equipmentKey(ez), equipmentKey({ ...ez, id: 'other' }))).toBe(true);
    expect(sameEquipmentKind(equipmentKey(trap), equipmentKey({ ...trap, barMass: 20 }))).toBe(false);
    // 25 kg is 55.1 lb: a 55 lb trap bar is a different bar.
    expect(sameEquipmentKind(equipmentKey(trap), equipmentKey({ ...trap, unit: 'lb', barMass: 55 }))).toBe(false);
  });
});

describe('S2: the set card’s plate breakdown and warm-up for the new bars and the Smith machine', () => {
  const full = saveQuick({ setup: 'full', unit: 'kg', dumbbellStep: 2.5 });
  const ez = item(full, 'ez_bar');
  const trap = item(full, 'trap_bar');
  const smith = item(full, 'smith_machine');

  it('EZ and trap bars: their own bar, then plates a side; Smith: plates a side (plates added)', () => {
    expect(plain(plateBreakdownLine(kg(25), ez))).toBe('10 bar + 5 + 2.5 / side');
    expect(plain(plateBreakdownLine(kg(10), ez))).toBe('Just the bar (10 kg)');
    expect(plain(plateBreakdownLine(kg(125), trap))).toBe('25 bar + 25 + 25 / side');
    expect(plain(plateBreakdownLine(kg(60, 'added'), smith))).toBe('25 + 5 / side');
    // A total is never broken down on the Smith machine (it logs plates added).
    expect(plateBreakdownLine(kg(60), smith)).toBeNull();
  });

  it('the warm-up ramp: trap bar yes, EZ bar no', () => {
    // A trap bar starts from the floor (WU9): no empty-bar step; 40 / 60 / 80 % of 140 on its plates.
    const ramp = warmUpRamp(kg(140), trap);
    expect(ramp[0]).toEqual({ load: 55, reps: 5 });
    expect(ramp.length).toBeGreaterThan(2);
    expect(plain(warmUpText(ramp, trap))).toMatch(/^55 × 5 · /);
    expect(warmUpRamp(kg(40), ez)).toEqual([]);
  });
});

describe('S4 and N2: wording and the coach’s exercise kinds', () => {
  it('kettlebells read like dumbbells in the assumed line', () => {
    expect(assumedLine('Hotel', { kind: 'kettlebell', name: 'Kettlebells' })).toBe('Hotel’s kettlebells are assumed.');
    expect(assumedLine('Hotel', { kind: 'dumbbells', name: 'Dumbbells' })).toBe('Hotel’s dumbbells are assumed.');
    expect(assumedLine('Hotel', { kind: 'ez_bar', name: 'EZ bar' })).toBe('Hotel’s EZ bar is assumed.');
  });

  it('propose_exercise never offers a bench or rack as an exercise’s equipment', () => {
    const args = { name: 'Bench thing', loadConvention: null, primaryMuscles: ['chest'], measurement: 'reps', laterality: null, reason: 'Ben asked' };
    expect(ProposeExerciseArgsSchema.safeParse({ ...args, equipment: 'bench' }).success).toBe(false);
    expect(ProposeExerciseArgsSchema.safeParse({ ...args, equipment: 'rack' }).success).toBe(false);
    expect(ProposeExerciseArgsSchema.safeParse({ ...args, equipment: 'kettlebell' }).success).toBe(true);
  });
});

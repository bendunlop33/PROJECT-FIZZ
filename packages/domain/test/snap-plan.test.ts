import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Load, LoadConvention, SnapMode, WeightUnit } from '@fizz/schemas';
import { EquipmentInstanceSchema } from '@fizz/schemas';
import {
  compareDifficulty,
  convertMass,
  getAchievableLoads,
  isLoadAchievable,
  loadDirection,
  mapEquipment,
  snapPlanToGym,
  type SnapExercise,
  type SnapSetInput,
  type SnapSlotInput,
  type SnapSource,
} from '../src/index';
import { assisted, barbell, dumbbells, id, kg, lb, plateMachine, stack, T0 } from './fixtures';
import { HOTEL, hotelRack, MAIN, mainBar, mainCable, mainRack } from './gym-fixture';

const src = (eq: EquipmentInstance): SnapSource => ({ id: eq.id, kind: eq.kind, name: eq.name, gymId: eq.gymId });
const ex = (name: string, kinds: SnapExercise['compatibleEquipment'], convention: LoadConvention): SnapExercise => ({ id: id(name.length * 97), name, compatibleEquipment: kinds, defaultLoadConvention: convention });
const INCLINE = ex('Incline DB press', ['dumbbells'], 'per_hand');
const BENCH = ex('Bench press', ['barbell'], 'total');
const ROW = ex('Cable row', ['weight_stack'], 'stack');
const PULL = ex('Assisted pull-up', ['assisted_stack'], 'assistance');
const CHEST = ex('Chest press', ['plate_loaded_machine', 'weight_stack'], 'added');

const set = (n: number, intended: Load | null, current: Load | null = null, setType: SnapSetInput['setType'] = 'working'): SnapSetInput => ({
  id: id(5000 + n),
  setType,
  intended,
  current,
  reps: { min: 8, max: 10 },
  durationS: null,
});
function slot(exercise: SnapExercise, source: EquipmentInstance | null, sets: SnapSetInput[], unit: WeightUnit = 'kg', convention: LoadConvention = exercise.defaultLoadConvention): SnapSlotInput {
  return { slotId: id(4000 + sets.length), exercise, sourceEquipment: source ? src(source) : null, unit, convention, sets };
}
const gym = (gymId: string, equipment: EquipmentInstance[], name = 'Hotel · Lisbon') => ({ id: gymId, name, equipment });
const one = (mode: SnapMode, s: SnapSlotInput, g: ReturnType<typeof gym>, extra: { pain?: string[]; lastUsedHere?: (x: string) => string | null } = {}) =>
  snapPlanToGym({ mode, slots: [s], gym: g, ownerUnit: 'kg', ...(extra.pain ? { painFlagged: new Set(extra.pain) } : {}), ...(extra.lastUsedHere ? { lastUsedHere: extra.lastUsedHere } : {}) }).slots[0];

describe('mapEquipment (GS3 order)', () => {
  const hotelBar = barbell({ id: id(711), gymId: HOTEL, name: 'Hotel bar' });
  const hotelRack2 = dumbbells({ id: id(712), gymId: HOTEL, name: 'Hotel light rack', loads: [2.5, 5] });
  const g = gym(HOTEL, [hotelRack2, hotelRack, hotelBar]);

  it('1. the same item when it is here and usable', () => {
    expect(mapEquipment(INCLINE, src(hotelRack), g, undefined)).toEqual({ equipment: hotelRack, mapping: 'same_item' });
  });
  it('2. else the item this exercise last used at this gym', () => {
    expect(mapEquipment(INCLINE, src(mainRack), g, () => hotelRack.id)).toEqual({ equipment: hotelRack, mapping: 'last_used_here' });
  });
  it('2. a last-used item the exercise can’t use is skipped', () => {
    expect(mapEquipment(INCLINE, src(mainRack), g, () => hotelBar.id).mapping).toBe('same_kind');
  });
  it('3. else the first usable item of the same kind', () => {
    expect(mapEquipment(INCLINE, src(mainRack), g, () => null)).toEqual({ equipment: hotelRack2, mapping: 'same_kind' });
  });
  it('4. else the first usable item of another kind the exercise lists', () => {
    const machine = stack({ id: id(713), gymId: HOTEL, name: 'Chest stack' });
    expect(mapEquipment(CHEST, src(plateMachine()), gym(HOTEL, [machine]), undefined)).toEqual({ equipment: machine, mapping: 'other_kind' });
  });
  it('5. else not here', () => {
    expect(mapEquipment(ROW, src(mainCable), g, undefined)).toEqual({ equipment: null, mapping: 'not_here' });
  });
  it('a retired item or one marked unusable today is never used', () => {
    const retired = { ...hotelRack, availability: 'retired' as const };
    expect(mapEquipment(INCLINE, src(mainRack), gym(HOTEL, [retired]), undefined).mapping).toBe('not_here');
    expect(mapEquipment(INCLINE, src(mainRack), { ...gym(HOTEL, [hotelRack]), unusableIds: new Set([hotelRack.id]) }, undefined).mapping).toBe('not_here');
  });
  it('a plan made without equipment stays without (none_needed)', () => {
    expect(mapEquipment(INCLINE, null, g, undefined)).toEqual({ equipment: null, mapping: 'none_needed' });
  });
});

describe('snapPlanToGym fitting (gym-switch §6.1)', () => {
  const hotel = gym(HOTEL, [hotelRack]);

  it('caps at the most the rack makes (never above a max), rounding toward easier', () => {
    const r = one('gym_switch', slot(INCLINE, mainRack, [set(1, kg(32.5, 'per_hand'), kg(32.5, 'per_hand'))]), hotel);
    expect(r?.mapping).toBe('same_kind');
    expect(r?.sets[0]).toMatchObject({ load: kg(20, 'per_hand'), outcome: 'capped', bounded: 'max', changed: true });
    expect(r?.notes).toEqual([expect.objectContaining({ kind: 'capped' })]);
  });

  it('rounds down to the nearest load here', () => {
    const odd = dumbbells({ id: id(714), gymId: HOTEL, loads: [5, 10, 15, 20] });
    const r = one('gym_switch', slot(INCLINE, mainRack, [set(1, kg(17.5, 'per_hand'), kg(17.5, 'per_hand'))]), gym(HOTEL, [odd]));
    expect(r?.sets[0]).toMatchObject({ load: kg(15, 'per_hand'), outcome: 'rounded', bounded: null });
  });

  it('converts kg to lb only through rounding on the equipment (review SP5)', () => {
    const lbRack = dumbbells({ id: id(715), gymId: HOTEL, unit: 'lb', loads: [10, 20, 30, 40, 45, 50] });
    const r = one('repeat', slot(INCLINE, mainRack, [set(1, kg(22.5, 'per_hand'))]), gym(HOTEL, [lbRack]));
    expect(r?.sets[0]).toMatchObject({ load: lb(45, 'per_hand'), outcome: 'converted' });
    expect(r?.unit).toBe('lb');
  });

  it('drops a load below the easiest here instead of rounding it up', () => {
    const heavy = dumbbells({ id: id(716), gymId: HOTEL, loads: [10, 12.5] });
    const r = one('gym_switch', slot(INCLINE, mainRack, [set(1, kg(5, 'per_hand'), kg(5, 'per_hand'))]), gym(HOTEL, [heavy]));
    expect(r?.sets[0]).toMatchObject({ load: null, outcome: 'dropped', reason: 'lightest_is_harder', lightest: kg(10, 'per_hand') });
  });

  it('assisted machines: more assistance is easier; less than the machine can give is dropped', () => {
    const machine = assisted({ id: id(717), gymId: HOTEL, assistanceLoads: [10, 20, 30, 40] });
    const easier = one('gym_switch', slot(PULL, assisted(), [set(1, kg(25, 'assistance'), kg(25, 'assistance'))]), gym(HOTEL, [machine]));
    expect(easier?.sets[0]).toMatchObject({ load: kg(30, 'assistance'), outcome: 'rounded' });
    const tooHard = one('gym_switch', slot(PULL, assisted(), [set(1, kg(5, 'assistance'), kg(5, 'assistance'))]), gym(HOTEL, [machine]));
    expect(tooHard?.sets[0]).toMatchObject({ load: kg(10, 'assistance'), outcome: 'capped', bounded: 'min' });
    const tooEasy = one('gym_switch', slot(PULL, assisted(), [set(1, kg(50, 'assistance'), kg(50, 'assistance'))]), gym(HOTEL, [machine]));
    expect(tooEasy?.sets[0]).toMatchObject({ load: null, reason: 'lightest_is_harder' });
  });

  it('another kind of machine: plates are never converted to a stack (convention_mismatch)', () => {
    const machine = stack({ id: id(718), gymId: HOTEL, name: 'Chest stack' });
    const r = one('gym_switch', slot(CHEST, plateMachine(), [set(1, kg(140, 'added'), kg(140, 'added'))]), gym(HOTEL, [machine]));
    expect(r?.mapping).toBe('other_kind');
    expect(r?.convention).toBe('stack');
    expect(r?.sets[0]).toMatchObject({ load: null, reason: 'convention_mismatch' });
  });

  it('equipment with no achievable loads gives no load target', () => {
    const broken = stack({ id: id(719), gymId: HOTEL, minLoad: 60, maxLoad: 70 });
    const r = one('gym_switch', slot(ROW, mainCable, [set(1, kg(40, 'stack'), kg(40, 'stack'))]), gym(HOTEL, [broken]));
    expect(r?.sets[0]).toMatchObject({ load: null, reason: 'no_achievable_loads' });
  });

  it('GS4: equipment not here means no load target, reps and time kept, never "kept as planned"', () => {
    const r = one('gym_switch', slot(ROW, mainCable, [set(1, kg(50, 'stack'), kg(50, 'stack'))]), hotel);
    expect(r).toMatchObject({ mapping: 'not_here', equipment: null, unit: 'kg', convention: 'stack' });
    expect(r?.sets[0]).toMatchObject({ load: null, outcome: 'dropped', reason: 'not_here', changed: true });
    expect(r?.notes[0]).toMatchObject({ kind: 'dropped', reason: 'not_here', equipmentName: 'Cable station' });
  });

  it('without equipment a load is kept only in the slot’s own unit and convention', () => {
    const same = one('start', slot(BENCH, null, [set(1, kg(60))]), hotel);
    expect(same?.sets[0]).toMatchObject({ load: kg(60), outcome: 'exact' });
    const other = one('start', slot(BENCH, null, [set(1, kg(60))], 'lb'), hotel);
    expect(other?.sets[0]).toMatchObject({ load: null, reason: 'unit_not_convertible' });
  });

  it('GS2: fits from the intended target, so switching back restores it', () => {
    // At Hotel the plan's 32.5 is capped at 20; back at Main it is 32.5 again.
    const back = one('gym_switch', slot(INCLINE, mainRack, [set(1, kg(32.5, 'per_hand'), kg(20, 'per_hand'))]), gym(MAIN, [mainBar, mainRack], 'Main Gym'));
    expect(back?.sets[0]).toMatchObject({ load: kg(32.5, 'per_hand'), outcome: 'restored', changed: true });
    expect(back?.notes).toEqual([expect.objectContaining({ kind: 'restored' })]);
    // A load dropped at Hotel (no bar) comes back with the bar.
    const bench = one('gym_switch', slot(BENCH, mainBar, [set(1, kg(100), null)]), gym(MAIN, [mainBar], 'Main Gym'));
    expect(bench?.sets[0]).toMatchObject({ load: kg(100), outcome: 'restored' });
  });

  it('rule 9: with a pain flag a target never goes back up', () => {
    const r = one('gym_switch', slot(INCLINE, mainRack, [set(1, kg(32.5, 'per_hand'), kg(20, 'per_hand'))]), gym(MAIN, [mainRack], 'Main Gym'), { pain: [INCLINE.id] });
    expect(r?.sets[0]).toMatchObject({ load: kg(20, 'per_hand'), painHeld: true, changed: false });
    expect(r?.notes).toEqual([expect.objectContaining({ kind: 'pain' })]);
    const dropped = one('gym_switch', slot(BENCH, mainBar, [set(1, kg(100), null)]), gym(MAIN, [mainBar], 'Main Gym'), { pain: [BENCH.id] });
    expect(dropped?.sets[0]).toMatchObject({ load: null, reason: 'pain_flag' });
    // Going down is still allowed with a pain flag.
    const down = one('gym_switch', slot(INCLINE, mainRack, [set(1, kg(32.5, 'per_hand'), kg(32.5, 'per_hand'))]), hotel, { pain: [INCLINE.id] });
    expect(down?.sets[0]).toMatchObject({ load: kg(20, 'per_hand'), outcome: 'capped' });
  });

  it('refitting twice gives the same result (idempotent)', () => {
    const first = one('gym_switch', slot(INCLINE, mainRack, [set(1, kg(32.5, 'per_hand'), kg(32.5, 'per_hand'))]), hotel);
    const again = one('gym_switch', slot(INCLINE, mainRack, [set(1, kg(32.5, 'per_hand'), first?.sets[0]?.load ?? null)]), hotel);
    expect(again?.sets[0]?.load).toEqual(first?.sets[0]?.load);
    expect(again?.sets[0]?.changed).toBe(false);
  });

  it('notes name the hardest working set (warm-ups only when nothing else)', () => {
    const r = one('repeat', slot(BENCH, mainBar, [set(1, kg(60), null, 'warmup'), set(2, kg(102.5)), set(3, kg(100))]), hotel);
    const note = r?.notes[0];
    expect(note).toMatchObject({ kind: 'dropped', reason: 'not_here', setIds: [id(5001), id(5002), id(5003)] });
    expect(note?.top.intended).toEqual(kg(102.5));
  });
});

/** A seeded generator, so a failure always reproduces (no new dependency). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const meta = (n: number, gymId: string, unit: WeightUnit) => ({
  id: id(30_000 + n),
  ownerId: id(1),
  version: 1,
  createdAtUtc: T0,
  updatedAtUtc: T0,
  gymId,
  name: `Item ${String(n)}`,
  unit,
  movementTags: [],
  availability: 'available' as const,
});

function randomEquipment(next: () => number, n: number, gymId: string): EquipmentInstance {
  const unit: WeightUnit = next() < 0.3 ? 'lb' : 'kg';
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const step = unit === 'kg' ? pick([1.25, 2.5, 5]) : pick([2.5, 5, 10]);
  const ladder = (from: number, count: number) => Array.from({ length: count }, (_, i) => Math.round((from + i * step) * 100) / 100);
  const bounds = () => {
    const out: { minLoad?: number; maxLoad?: number } = {};
    if (next() < 0.3) out.maxLoad = Math.round(next() * 60 + 10);
    if (next() < 0.2) out.minLoad = Math.round(next() * 20);
    if (out.minLoad !== undefined && out.maxLoad !== undefined && out.minLoad > out.maxLoad) delete out.minLoad;
    return out;
  };
  const kind = pick(['barbell', 'dumbbells', 'weight_stack', 'assisted_stack', 'plate_loaded_machine'] as const);
  const base = { ...meta(n, gymId, unit), ...bounds() };
  switch (kind) {
    case 'barbell': {
      const b = { ...base, kind, loadConvention: 'total', barMass: unit === 'kg' ? 20 : 45, plates: [{ mass: unit === 'kg' ? 20 : 45, count: 2 + 2 * Math.floor(next() * 3) }, { mass: unit === 'kg' ? 5 : 10, count: 2 }, { mass: unit === 'kg' ? 1.25 : 2.5, count: next() < 0.5 ? 0 : 2 }] };
      if (b.maxLoad !== undefined && b.maxLoad < b.barMass) delete b.maxLoad;
      return EquipmentInstanceSchema.parse(b);
    }
    case 'dumbbells':
      return EquipmentInstanceSchema.parse({ ...base, kind, loadConvention: 'per_hand', loads: ladder(step, 2 + Math.floor(next() * 12)).filter((v, i, a) => a.indexOf(v) === i) });
    case 'weight_stack':
      return EquipmentInstanceSchema.parse({ ...base, kind, loadConvention: 'stack', stackLoads: ladder(step * 2, 3 + Math.floor(next() * 15)), addOns: next() < 0.3 ? [step / 2] : [] });
    case 'assisted_stack':
      return EquipmentInstanceSchema.parse({ ...base, kind, loadConvention: 'assistance', assistanceLoads: ladder(step * 2, 2 + Math.floor(next() * 8)) });
    case 'plate_loaded_machine':
      return EquipmentInstanceSchema.parse({ ...base, kind, loadConvention: 'added', loadingSides: next() < 0.5 ? 1 : 2, plates: [{ mass: unit === 'kg' ? 20 : 45, count: 4 }, { mass: unit === 'kg' ? 10 : 25, count: 2 }] });
  }
}

const CONVENTION: Record<string, LoadConvention> = { barbell: 'total', dumbbells: 'per_hand', weight_stack: 'stack', assisted_stack: 'assistance', plate_loaded_machine: 'added' };

describe('snapPlanToGym invariant (property test, gym-switch §6.1, check 2)', () => {
  it('every load is achievable here, never harder than intended, never past a pain hold, never without equipment', () => {
    const next = rng(20261009);
    const modes: SnapMode[] = ['start', 'repeat', 'gym_switch', 'equipment_update'];
    let checked = 0;
    const seen = { loaded: 0, dropped: 0, capped: 0, converted: 0, painHeld: 0, restored: 0 };
    for (let run = 0; run < 400; run += 1) {
      const mode = modes[run % modes.length] ?? 'start';
      const sourceGym = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, i) => randomEquipment(next, run * 20 + i, MAIN));
      const targetGym = next() < 0.1 ? [] : Array.from({ length: Math.floor(next() * 5) }, (_, i) => randomEquipment(next, run * 20 + 10 + i, HOTEL));
      const pain = new Set<string>();
      const slots: SnapSlotInput[] = sourceGym.map((source, i) => {
        const kinds = [source.kind, ...(next() < 0.3 ? [targetGym[0]?.kind ?? source.kind] : [])].filter((k, j, a) => a.indexOf(k) === j);
        const exercise: SnapExercise = { id: id(40_000 + run * 10 + i), name: `Ex ${String(i)}`, compatibleEquipment: kinds, defaultLoadConvention: CONVENTION[source.kind] ?? 'total' };
        if (next() < 0.25) pain.add(exercise.id);
        const loads = getAchievableLoads(source).loads;
        const sets = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, k): SnapSetInput => {
          const v = loads.length > 0 && next() < 0.8 ? (loads[Math.floor(next() * loads.length)] ?? 10) : Math.round(next() * 200) / 2;
          const intended: Load = { value: v, unit: next() < 0.15 ? (source.unit === 'kg' ? 'lb' : 'kg') : source.unit, convention: source.loadConvention };
          const current: Load | null = mode === 'start' || mode === 'repeat' ? null : next() < 0.2 ? null : { ...intended, value: Math.max(0, intended.value - Math.round(next() * 10)) };
          return { id: id(50_000 + run * 100 + i * 10 + k), setType: k === 0 && next() < 0.3 ? 'warmup' : 'working', intended, current, reps: { min: 6, max: 8 }, durationS: null };
        });
        return { slotId: id(45_000 + run * 10 + i), exercise, sourceEquipment: src(source), unit: source.unit, convention: source.loadConvention, sets };
      });
      const out = snapPlanToGym({ mode, slots, gym: gym(HOTEL, targetGym), painFlagged: pain, ownerUnit: next() < 0.5 ? 'kg' : 'lb' });
      for (const [i, s] of out.slots.entries()) {
        const input = slots[i];
        if (!input) throw new Error('slot');
        if (s.equipment !== null) expect(targetGym).toContain(s.equipment);
        for (const r of s.sets) {
          checked += 1;
          const setIn = input.sets.find((x) => x.id === r.id);
          if (!setIn) throw new Error('set');
          if (r.outcome === 'capped') seen.capped += 1;
          if (r.outcome === 'converted') seen.converted += 1;
          if (r.outcome === 'restored') seen.restored += 1;
          if (r.painHeld) seen.painHeld += 1;
          if (r.load === null) {
            seen.dropped += 1;
            continue;
          }
          seen.loaded += 1;
          // Rule 4: an equipped plan never has a load without equipment here, and every load is achievable on it.
          expect(s.equipment, `run ${String(run)}`).not.toBeNull();
          if (s.equipment) expect(isLoadAchievable(r.load, s.equipment), `run ${String(run)} ${JSON.stringify(r.load)}`).toBe(true);
          // Never harder than intended.
          const intended = setIn.intended;
          if (!intended) throw new Error('a load without an intended target');
          expect(intended.convention).toBe(r.load.convention);
          const intendedHere = convertMass(intended, r.load.unit).value;
          expect(compareDifficulty(r.load.value, intendedHere, loadDirection(r.load.convention)) <= 1, `run ${String(run)}`).toBe(true);
          // With a pain flag, never harder than the target it had (switch modes).
          if ((mode === 'gym_switch' || mode === 'equipment_update') && pain.has(input.exercise.id)) {
            expect(setIn.current, `run ${String(run)} pain`).not.toBeNull();
            if (setIn.current) expect(compareDifficulty(r.load.value, convertMass(setIn.current, r.load.unit).value, loadDirection(r.load.convention)) <= 1).toBe(true);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // The generator reaches every interesting branch, so the invariant isn't checked vacuously.
    for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(5);
  });
});

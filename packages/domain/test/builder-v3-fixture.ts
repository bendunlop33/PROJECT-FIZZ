import type { EquipmentInstance } from '@fizz/schemas';
import type { BuilderContext, BuilderExerciseInfo, BuilderGroupName, BuilderPool, SlotLoadInput } from '../src/index';
import { assisted, barbell, dumbbells, id, stack } from './fixtures';

/**
 * Builder v3 fixture: the prototype's chest/back/legs exercises
 * (docs/design/prototypes/workout-builder-v3.html) with injected muscle
 * facts, and Main Gym-style equipment: a 20 kg bar with 1.25 kg plates
 * (2.5 kg steps), dumbbells 2.5–40 kg each, a cable stack 5–100 kg, an
 * assisted machine 5–40 kg.
 */

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

export const bar = barbell({
  id: id(7700),
  plates: [
    { mass: 25, count: 4 },
    { mass: 20, count: 2 },
    { mass: 10, count: 2 },
    { mass: 5, count: 2 },
    { mass: 2.5, count: 2 },
    { mass: 1.25, count: 2 },
  ],
  maxLoad: 180,
});
/** A gym whose smallest pair is 2.5 kg: 5 kg steps on the bar. */
export const coarseBar = barbell({
  id: id(7701),
  plates: [
    { mass: 25, count: 4 },
    { mass: 20, count: 2 },
    { mass: 10, count: 2 },
    { mass: 5, count: 2 },
    { mass: 2.5, count: 2 },
  ],
});
export const rack = dumbbells({ id: id(7702), loads: steps(2.5, 40, 2.5) });
export const cable = stack({ id: id(7703), stackLoads: steps(5, 100, 5) });
export const assist = assisted({ id: id(7704) });
export const lbRack = dumbbells({ id: id(7705), unit: 'lb', loads: steps(5, 100, 5) });

type Info = Omit<BuilderExerciseInfo, 'exerciseId' | 'part'> & { part?: string };
const I = (name: string, group: BuilderGroupName, role: 'compound' | 'isolation', angle: string, muscles: string[], over: Partial<Info> = {}): Info => ({ name, group, role, heavy: false, angle, muscles, barbell: false, ...over });

export const INFO: Record<string, Info> = {
  bench: I('Barbell bench press', 'Chest', 'compound', 'Mid chest', ['chest', 'front delts', 'triceps'], { heavy: true, barbell: true }),
  incline_db: I('Incline dumbbell press', 'Chest', 'compound', 'Upper chest', ['upper chest', 'front delts', 'triceps']),
  incline_bb: I('Incline barbell press', 'Chest', 'compound', 'Upper chest', ['upper chest', 'front delts', 'triceps'], { heavy: true, barbell: true }),
  machine_press: I('Machine chest press', 'Chest', 'compound', 'Mid chest', ['chest', 'triceps']),
  cable_fly: I('Cable fly', 'Chest', 'isolation', 'Mid chest', ['chest']),
  crossover: I('Cable crossover', 'Chest', 'isolation', 'Lower chest', ['chest']),
  pec_deck: I('Pec deck', 'Chest', 'isolation', 'Upper chest', ['chest']),
  pushdown: I('Triceps pushdown', 'Triceps', 'isolation', 'Triceps', ['triceps']),
  oh_ext: I('Overhead triceps extension', 'Triceps', 'isolation', 'Triceps', ['triceps']),
  curl: I('EZ-bar curl', 'Biceps', 'isolation', 'Biceps', ['biceps']),
  hammer: I('Hammer curl', 'Biceps', 'isolation', 'Biceps', ['brachialis', 'forearms', 'biceps']),
  crunch: I('Cable crunch', 'Abs', 'isolation', 'Abs', ['abs']),
  knee_raise: I('Hanging knee raise', 'Abs', 'isolation', 'Abs', ['abs', 'hip flexors']),
  squat: I('Back squat', 'Legs', 'compound', 'Quads', ['quads', 'glutes', 'adductors'], { heavy: true, barbell: true, part: 'quads' }),
  leg_press: I('Leg press', 'Legs', 'compound', 'Quads', ['quads', 'glutes'], { heavy: true, part: 'quads' }),
  rdl: I('Romanian deadlift', 'Legs', 'compound', 'Hamstrings & glutes', ['hamstrings', 'glutes', 'lower back'], { heavy: true, barbell: true, part: 'hamstrings_glutes' }),
  hip_thrust: I('Hip thrust', 'Legs', 'compound', 'Hamstrings & glutes', ['glutes', 'hamstrings'], { heavy: true, part: 'hamstrings_glutes' }),
  leg_curl: I('Leg curl', 'Legs', 'isolation', 'Hamstrings & glutes', ['hamstrings'], { part: 'hamstrings_glutes' }),
  leg_ext: I('Leg extension', 'Legs', 'isolation', 'Quads', ['quads'], { part: 'quads' }),
  calf: I('Seated calf raise', 'Legs', 'isolation', 'Calves', ['calves'], { part: 'calves' }),
  lat_pulldown: I('Lat pulldown', 'Back', 'compound', 'Lats', ['lats', 'biceps']),
  assisted_pullup: I('Assisted pull-up', 'Back', 'compound', 'Lats', ['lats', 'biceps']),
  row: I('Barbell row', 'Back', 'compound', 'Mid-back', ['mid-back', 'lats', 'rear delts', 'biceps'], { heavy: true, barbell: true }),
};

export const info = (exerciseId: string): BuilderExerciseInfo | null => {
  const i = INFO[exerciseId];
  return i === undefined ? null : { ...i, exerciseId, part: i.part ?? i.group };
};

/** Est. max per exercise (prototype numbers) and the item each maps to. */
const E1RM: Record<string, number | null> = {
  bench: 127,
  incline_db: 39,
  incline_bb: 105,
  machine_press: 105,
  cable_fly: 22,
  crossover: 22,
  pec_deck: 60,
  pushdown: 41,
  oh_ext: 30,
  curl: 40,
  hammer: 18,
  crunch: 55,
  knee_raise: null,
  squat: 150,
  leg_press: 100,
  rdl: 140,
  hip_thrust: 160,
  leg_curl: 65,
  leg_ext: 90,
  calf: 60,
  lat_pulldown: 82,
  assisted_pullup: null,
  row: 118,
};
const EQ: Record<string, EquipmentInstance | null> = {
  bench: bar,
  incline_db: rack,
  incline_bb: bar,
  squat: bar,
  rdl: bar,
  row: bar,
  hip_thrust: bar,
  hammer: rack,
  knee_raise: null,
  assisted_pullup: assist,
};

export function loadInput(over: Partial<SlotLoadInput> = {}): SlotLoadInput {
  return { unit: 'kg', convention: 'total', equipment: bar, coachTarget: null, planFirstLoad: null, ruleTarget: null, e1rm: null, startLightCeiling: null, painCap: null, ...over };
}

export function loadsFor(exerciseId: string, overrides: Record<string, Partial<SlotLoadInput>> = {}): SlotLoadInput {
  const eq = exerciseId in EQ ? (EQ[exerciseId] ?? null) : cable;
  const convention = eq?.loadConvention ?? 'bodyweight';
  return loadInput({ equipment: eq, convention, e1rm: convention === 'assistance' ? null : (E1RM[exerciseId] ?? null), ...(convention === 'assistance' ? { ruleTarget: { value: 25, reps: 8, rpe: 8 } } : {}), ...overrides[exerciseId] });
}

export function context(overrides: Record<string, Partial<SlotLoadInput>> = {}): BuilderContext {
  let n = 0;
  return {
    info,
    loads: (exerciseId) => loadsFor(exerciseId, overrides),
    newKey: (exerciseId) => {
      n += 1;
      return `${exerciseId}#${n}`;
    },
  };
}

/** History first, then catalogue (already filtered for the gym and pain). */
export const POOL: Record<BuilderGroupName, string[]> = {
  Chest: ['incline_db', 'cable_fly', 'machine_press', 'incline_bb', 'crossover', 'bench'],
  Back: ['lat_pulldown', 'row', 'assisted_pullup'],
  Shoulders: [],
  Legs: ['leg_press', 'rdl', 'leg_curl', 'leg_ext', 'calf', 'hip_thrust', 'squat'],
  Biceps: ['curl', 'hammer'],
  Triceps: ['pushdown', 'oh_ext'],
  Abs: ['crunch', 'knee_raise'],
};
export const pool: BuilderPool = (g) => POOL[g];

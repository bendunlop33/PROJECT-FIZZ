import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';
import { buildGymSwitchProposal, changeGymCommand, startWorkout, type GymSwitchInput, type GymSwitchProposal } from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, id, idGen, kg, profile, routine, routineExercise, stack, template } from './fixtures';

/**
 * gym-switch.md §7 fixture "hotel". Main Gym: 20 kg bar with plates up to
 * 180 kg, dumbbells 2.5–40 kg each every 2.5, a cable stack 5–100 kg.
 * Hotel · Lisbon: dumbbells 2.5–20 kg each every 2.5; no barbell, no cable.
 * Push A: Bench press 4 × 100 kg × 6–8, Incline DB press 3 × 32.5 kg each ×
 * 8–10, Cable row 3 × 50 kg stack × 12, Lateral raise 3 × 10 kg each × 12–15.
 */
export const MAIN = id(2);
export const HOTEL = id(3);
export const HOME = id(4);
export const GYM_NAMES: Record<string, string> = { [MAIN]: 'Main Gym', [HOTEL]: 'Hotel · Lisbon', [HOME]: 'Home' };

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

export const mainBar = barbell({
  id: id(700),
  gymId: MAIN,
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
export const mainRack = dumbbells({ id: id(701), gymId: MAIN, name: 'Main dumbbells', loads: steps(2.5, 40, 2.5) });
export const mainCable = stack({ id: id(702), gymId: MAIN, name: 'Cable station', stackLoads: steps(5, 100, 5) });
export const mainAssist = assisted({ id: id(703), gymId: MAIN });
export const MAIN_EQ: EquipmentInstance[] = [mainBar, mainRack, mainCable, mainAssist];

export const hotelRack = dumbbells({ id: id(710), gymId: HOTEL, name: 'Hotel dumbbells', loads: steps(2.5, 20, 2.5) });
export const HOTEL_EQ: EquipmentInstance[] = [hotelRack];

export const homeRack = dumbbells({ id: id(720), gymId: HOME, name: 'Home dumbbells', loads: steps(2.5, 40, 2.5) });
export const HOME_EQ: EquipmentInstance[] = [homeRack];

export const BENCH = id(800);
export const INCLINE = id(801);
export const CABLE_ROW = id(802);
export const LATERAL = id(803);
export const PULLUP = id(804);
export const DB_BENCH = id(805);

export const EXERCISES = new Map<string, Exercise>([
  [BENCH, exercise(800, 'Bench press', { compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', movementPattern: 'push' })],
  [INCLINE, exercise(801, 'Incline DB press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [CABLE_ROW, exercise(802, 'Cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', movementPattern: 'pull' })],
  [LATERAL, exercise(803, 'Lateral raise', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [PULLUP, exercise(804, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', movementPattern: 'pull' })],
  [DB_BENCH, exercise(805, 'DB bench press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
]);

export function pushA(opts: { incline?: number; at?: EquipmentInstance[] } = {}): SessionAggregate {
  const r = routine([
    routineExercise(900, {
      exerciseId: BENCH,
      equipmentId: mainBar.id,
      order: 0,
      setTemplates: [1, 2, 3, 4].map((n) => template(9000 + n, { targetLoad: kg(100), targetReps: { min: 6, max: 8 } })),
    }),
    routineExercise(901, {
      exerciseId: INCLINE,
      equipmentId: mainRack.id,
      order: 1,
      setTemplates: [1, 2, 3].map((n) => template(9010 + n, { targetLoad: kg(opts.incline ?? 32.5, 'per_hand'), targetReps: { min: 8, max: 10 } })),
    }),
    routineExercise(902, {
      exerciseId: CABLE_ROW,
      equipmentId: mainCable.id,
      order: 2,
      setTemplates: [1, 2, 3].map((n) => template(9020 + n, { targetLoad: kg(50, 'stack'), targetReps: { min: 12, max: 12 } })),
    }),
    routineExercise(903, {
      exerciseId: LATERAL,
      equipmentId: mainRack.id,
      order: 3,
      setTemplates: [1, 2, 3].map((n) => template(9030 + n, { targetLoad: kg(10, 'per_hand'), targetReps: { min: 12, max: 15 } })),
    }),
  ]);
  return startWorkout({
    opId: 'start-push-a',
    owner: profile(),
    gymId: MAIN,
    gymName: 'Main Gym',
    routine: r,
    exercises: EXERCISES,
    gymEquipment: opts.at ?? MAIN_EQ,
    at: at(0),
    newId: idGen(20_000),
  }).aggregate;
}

export function rowOf(state: SessionAggregate, exerciseId: string, part = 0) {
  return state.exercises.filter((e) => e.exerciseId === exerciseId).sort((a, b) => a.order - b.order)[part];
}

/** Every live set of an exercise (all parts), in index order within each part. */
export function exerciseSets(state: SessionAggregate, exerciseId: string) {
  const rows = state.exercises.filter((e) => e.exerciseId === exerciseId).sort((a, b) => a.order - b.order);
  return rows.flatMap((r) => state.sets.filter((s) => s.sessionExerciseId === r.id).sort((a, b) => a.index - b.index));
}

let ids = 60_000;
export function propose(state: SessionAggregate, gym: { id: string; equipment: EquipmentInstance[] }, over: Partial<GymSwitchInput> = {}): GymSwitchProposal {
  return buildGymSwitchProposal({
    aggregate: state,
    mode: gym.id === state.session.gymId ? 'equipment_update' : 'gym_switch',
    gym: { id: gym.id, name: GYM_NAMES[gym.id] ?? 'Gym', equipment: gym.equipment },
    gymNames: GYM_NAMES,
    exercises: EXERCISES,
    painFlagged: new Set(),
    ownerUnit: 'kg',
    newId: () => id((ids += 1)),
    ...over,
  });
}

export function switchCmd(p: GymSwitchProposal, seconds: number, opId = `switch-${String(seconds)}`) {
  return changeGymCommand(p, opId, at(seconds));
}

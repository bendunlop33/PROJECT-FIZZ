import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';
import { joinWarmups, startWorkout, withJoinWarmups, type JoinWarmupInput } from '../src/index';
import { at, barbell, bodyweightStation, dumbbells, exercise, GYM, id, idGen, kg, lb, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, logCmd } from './session-fixture';

/**
 * (Ben, 8 Nov, live Pull B, build 552) Barbell rows added mid-workout after pull-ups got one 50 kg warm-up before
 * 97.5 kg working sets. An exercise that joins a running workout gets the shared planner's warm-ups at its place:
 * WU5 (rep band) / WU4 + PL1 (heavy band) on a bar, WU6 on dumbbells and stacks, WU2's warm muscle (pull-ups
 * logged → the back is warm), all snapped to the real kit (rule 4) and below the first working load.
 */

const PULLUP = id(810);
const ROW = id(811);
const DBROW = id(812);
const CABLE = id(813);
const CURL = id(814);
const BAR = barbell();
const RACK = dumbbells({ loads: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40] });
const STACK = stack({ stackLoads: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80] });
const STATION = bodyweightStation();
const EX = new Map<string, Exercise>([
  [PULLUP, exercise(810, 'Pull-up', { catalogueKey: 'bodyweight-pull-up', family: 'pull_up', movementPattern: 'vertical_pull', mechanic: 'compound', primaryMuscles: ['lats'], compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' })],
  [ROW, exercise(811, 'Barbell row', { catalogueKey: 'barbell-bent-over-row', family: 'row', movementPattern: 'horizontal_pull', mechanic: 'compound', primaryMuscles: ['lats', 'upper_back'] })],
  [DBROW, exercise(812, 'One-arm dumbbell row', { movementPattern: 'horizontal_pull', mechanic: 'compound', primaryMuscles: ['lats'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [CABLE, exercise(813, 'Cable row', { movementPattern: 'horizontal_pull', mechanic: 'compound', primaryMuscles: ['upper_back'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' })],
  [CURL, exercise(814, 'Barbell curl', { movementPattern: 'curl', mechanic: 'isolation', primaryMuscles: ['biceps'] })],
]);
const lookup = { facts: (x: string) => EX.get(x) ?? null };

/** Pull B: pull-ups first (logged or not), on a gym with a bar, dumbbells and a stack. */
function pullB(logPullups: boolean, gear: EquipmentInstance[] = [BAR, RACK, STACK, STATION]): SessionAggregate {
  const s = startWorkout({
    opId: 'start',
    owner: profile(),
    gymId: GYM,
    routine: routine([routineExercise(820, { exerciseId: PULLUP, equipmentId: STATION.id, order: 0, setTemplates: [template(8201, { targetReps: { min: 8, max: 8 } }), template(8202, { targetReps: { min: 8, max: 8 } })] })]),
    exercises: EX,
    gymEquipment: gear,
    at: at(0),
    newId: idGen(82_000),
  }).aggregate;
  if (!logPullups) return s;
  const first = s.sets.find((x) => x.setType !== 'warmup');
  return first === undefined ? s : apply(s, logCmd(first.id, values(null, 8, { rpe: 8 }), 60, 'log-pu'));
}

const row = (state: SessionAggregate, over: Partial<JoinWarmupInput> = {}): JoinWarmupInput => ({ state, exercise: { id: ROW, measurement: 'reps' }, equipment: BAR, convention: 'total', unit: 'kg', ctx: { lookup }, ...over });
const steps = (sets: ReturnType<typeof joinWarmups>) => sets.map((x) => [x.load?.value ?? null, x.reps?.min ?? null]);
const work = (load: number, reps: number, convention: 'total' | 'per_hand' | 'stack' = 'total') => ({ load: kg(load, convention), reps: { min: reps, max: reps } });

describe('an exercise added mid-workout warms up by the approved rules (8 Nov)', () => {
  it('rows 97.5 × 8 after logged pull-ups (back warm, WU2): WU5 warmed, the 80 % step only, on plates (PL1)', () => {
    expect(steps(joinWarmups(row(pullB(true)), work(97.5, 8)))).toEqual([[80, 4]]);
  });

  it('cold (pull-ups not logged yet): WU5’s full ladder, 50 × 8 then 80 × 4; never a lone light step', () => {
    expect(steps(joinWarmups(row(pullB(false)), work(97.5, 8)))).toEqual([[50, 8], [80, 4]]);
  });

  it('heavy band 97.5 × 6: cold, PL1’s plate ladder from the floor (no empty bar, no jump over 30 % of W); warm, one step near 80 % × 2', () => {
    const cold = steps(joinWarmups(row(pullB(false)), work(97.5, 6)));
    expect(cold).toEqual([[60, 5], [80, 2]]);
    expect(steps(joinWarmups(row(pullB(true)), work(97.5, 6)))).toEqual([[80, 2]]);
  });

  it('whatever the case, the last warm-up is at 70–90 % of W on a heavy bar lift: no jump from ~50 % straight to W', () => {
    for (const logged of [true, false]) {
      for (const reps of [3, 5, 6, 8, 10, 12]) {
        const got = joinWarmups(row(pullB(logged)), work(97.5, reps));
        const top = got.at(-1)?.load?.value ?? 0;
        expect(top / 97.5).toBeGreaterThanOrEqual(0.7);
        expect(top / 97.5).toBeLessThanOrEqual(0.9);
      }
    }
  });

  it('per-hand dumbbells (WU6, secondary compound): cold 80 % × 4 snapped to the rack (simple 5 kg); warm none', () => {
    const db = (s: SessionAggregate) => joinWarmups(row(s, { exercise: { id: DBROW, measurement: 'reps' }, equipment: RACK, convention: 'per_hand' }), work(35, 8, 'per_hand'));
    const cold = db(pullB(false));
    expect(steps(cold)).toEqual([[25, 4]]);
    expect(cold.every((x) => x.load?.convention === 'per_hand')).toBe(true);
    expect(db(pullB(true))).toEqual([]);
  });

  it('a stack (WU6): cold 80 % × 4 on the stack’s own steps; warm none', () => {
    const cable = (s: SessionAggregate) => joinWarmups(row(s, { exercise: { id: CABLE, measurement: 'reps' }, equipment: STACK, convention: 'stack' }), work(65, 10, 'stack'));
    expect(steps(cable(pullB(false)))).toEqual([[50, 5]]);
    expect(cable(pullB(true))).toEqual([]);
  });

  it('a curl after pull-ups is not warmed by them (different primary muscle): WU7’s single 50 % step', () => {
    expect(steps(joinWarmups(row(pullB(true), { exercise: { id: CURL, measurement: 'reps' } }), work(40, 10)))).toEqual([[20, 8]]);
  });

  it('lb: the bar + 20 lb steps, all in lb', () => {
    const LBBAR = barbell({ unit: 'lb', barMass: 45, plates: [45, 35, 25, 10, 5, 2.5].map((mass) => ({ mass, count: 4 })) });
    const got = joinWarmups(row(pullB(false, [LBBAR, STATION]), { equipment: LBBAR, unit: 'lb' }), { load: lb(215, 'total'), reps: { min: 8, max: 8 } });
    expect(got.length).toBe(2);
    expect(got.every((x) => x.load?.unit === 'lb' && (x.load.value - 45) % 20 === 0 && x.load.value < 215)).toBe(true);
  });

  it('Ben turned this exercise’s warm-ups off: none; the plan’s Warm-ups setting none: none', () => {
    expect(joinWarmups(row(pullB(false), { ctx: { lookup: { ...lookup, prefs: { simpleLoads: true, perExercise: { [ROW]: 'off' } } } } }), work(97.5, 8))).toEqual([]);
    expect(joinWarmups(row(pullB(false), { ctx: { lookup, mode: 'none' } }), work(97.5, 8))).toEqual([]);
  });

  it('withJoinWarmups: a plan’s own cold warm-ups give way to the planner’s for the place; the working sets stay as they were', () => {
    const plan = [
      { setType: 'warmup' as const, planned: { load: kg(50), reps: { min: 8, max: 8 }, durationS: null, rpe: null, rir: null } },
      ...[1, 2, 3].map(() => ({ setType: 'working' as const, planned: { load: kg(97.5), reps: { min: 8, max: 8 }, durationS: null, rpe: 8, rir: null } })),
    ];
    const out = withJoinWarmups(plan, row(pullB(true)));
    expect(out?.map((p) => [p.setType, p.planned.load?.value])).toEqual([['warmup', 80], ['working', 97.5], ['working', 97.5], ['working', 97.5]]);
    expect(withJoinWarmups(null, row(pullB(true)))).toBeNull();
  });
});

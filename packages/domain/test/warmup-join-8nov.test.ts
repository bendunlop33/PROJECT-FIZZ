import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';
import { buildSwapExerciseCommand, checkCoachAdd, joinsAsSecondary, joinWarmups, reduceSession, startWorkout, withJoinWarmups, type HistorySession, type JoinWarmupInput } from '../src/index';
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

/** Pull B with a one-arm dumbbell row planned after pull-ups: one light warm-up and three working sets, pull-ups logged. */
function pullBWithDbRow(): SessionAggregate {
  const s = startWorkout({
    opId: 'start-db',
    owner: profile(),
    gymId: GYM,
    routine: routine([
      routineExercise(830, { exerciseId: PULLUP, equipmentId: STATION.id, order: 0, setTemplates: [template(8301, { targetReps: { min: 8, max: 8 } })] }),
      routineExercise(831, {
        exerciseId: DBROW,
        equipmentId: RACK.id,
        order: 1,
        setTemplates: [template(8311, { setType: 'warmup', targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 8 } }), ...[8312, 8313, 8314].map((n) => template(n, { targetLoad: kg(35, 'per_hand'), targetReps: { min: 8, max: 8 } }))],
      }),
    ]),
    exercises: EX,
    gymEquipment: [BAR, RACK, STACK, STATION],
    at: at(0),
    newId: idGen(83_000),
  }).aggregate;
  const first = s.sets.find((x) => x.setType !== 'warmup' && s.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === PULLUP);
  return first === undefined ? s : apply(s, logCmd(first.id, values(null, 8, { rpe: 8 }), 60, 'log-pu2'));
}

const rowsOf = (s: SessionAggregate, exerciseId: string) => {
  const row = s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined);
  return s.sets.filter((x) => x.sessionExerciseId === row?.id && x.status !== 'deleted').sort((a, b) => a.index - b.index).map((x) => [x.setType, x.status, x.planned.load?.value ?? null, x.planned.reps?.min ?? null]);
};

describe('a swap mid-workout plans the substitute’s own warm-ups (8 Nov)', () => {
  const plan = { exercise: EX.get(ROW) as Exercise, pin: BAR, plan: [1, 2, 3].map(() => ({ setType: 'working' as const, planned: { load: kg(97.5), reps: { min: 8, max: 8 }, durationS: null, rpe: 8, rir: null } })) };
  const swap = (s: SessionAggregate, ctx: boolean) => {
    const dbRow = s.exercises.find((e) => e.exerciseId === DBROW)?.id ?? '';
    const r = buildSwapExerciseCommand({ aggregate: s, sessionExerciseId: dbRow, plan, gymName: 'Main', ownerUnit: 'kg', opId: 'swap-row', at: at(300), newId: idGen(84_000), ...(ctx ? { warmups: { lookup } } : {}) });
    if (!r.ok) throw new Error(r.reason);
    return r.command;
  };

  it('dumbbell row (one 15 kg warm-up) → barbell row 97.5 × 8 after pull-ups: the planner’s 80 × 4, not the old count at a light load; Undo brings the dumbbell row back exactly', () => {
    const s0 = pullBWithDbRow();
    const cmd = swap(s0, true);
    const s1 = (() => {
      const r = reduceSession(s0, cmd);
      if (!r.ok) throw new Error(r.error.message);
      return r.state;
    })();
    expect(rowsOf(s1, ROW)).toEqual([
      ['warmup', 'pending', 80, 4],
      ['working', 'pending', 97.5, 8],
      ['working', 'pending', 97.5, 8],
      ['working', 'pending', 97.5, 8],
    ]);
    // The pull-ups Ben logged are untouched (rule 2).
    expect(rowsOf(s1, PULLUP)).toEqual(rowsOf(s0, PULLUP));
    // A retry with the same opId is a duplicate, nothing new.
    const again = reduceSession(s1, cmd);
    expect(again.ok && again.duplicate).toBe(true);
    const undone = reduceSession(s1, { type: 'undo_op', at: at(320), opId: 'undo-swap-row', targetOpId: 'swap-row' });
    if (!undone.ok) throw new Error(undone.error.message);
    expect(rowsOf(undone.state, DBROW)).toEqual(rowsOf(s0, DBROW));
    expect(undone.state.sets.filter((x) => x.status === 'pending' && undone.state.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === ROW)).toEqual([]);
  });

  it('cold (nothing logged): the full ladder replaces the one light warm-up; a warm-up logged on the new row stays through Undo', () => {
    const fresh = startWorkout({
      opId: 'start-cold',
      owner: profile(),
      gymId: GYM,
      routine: routine([routineExercise(840, { exerciseId: DBROW, equipmentId: RACK.id, order: 0, setTemplates: [template(8401, { setType: 'warmup', targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 8 } }), template(8402, { targetLoad: kg(35, 'per_hand'), targetReps: { min: 8, max: 8 } })] })]),
      exercises: EX,
      gymEquipment: [BAR, RACK, STACK, STATION],
      at: at(0),
      newId: idGen(85_000),
    }).aggregate;
    const r = buildSwapExerciseCommand({ aggregate: fresh, sessionExerciseId: fresh.exercises[0]?.id ?? '', plan: { ...plan, plan: plan.plan.slice(0, 1) }, gymName: 'Main', ownerUnit: 'kg', opId: 'swap-cold', at: at(30), newId: idGen(86_000), warmups: { lookup } });
    if (!r.ok) throw new Error(r.reason);
    const s1r = reduceSession(fresh, r.command);
    if (!s1r.ok) throw new Error(s1r.error.message);
    // First exercise of the session, cold: WU5 50 % × 8 then 80 % × 4 (WU6's extra step is for secondary compounds).
    expect(rowsOf(s1r.state, ROW)).toEqual([['warmup', 'pending', 50, 8], ['warmup', 'pending', 80, 4], ['working', 'pending', 97.5, 8]]);
    const w1 = s1r.state.sets.find((x) => x.setType === 'warmup' && x.status === 'pending' && s1r.state.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === ROW);
    const s2 = apply(s1r.state, logCmd(w1?.id ?? '', values(kg(50), 8), 90, 'log-w1'));
    const u = reduceSession(s2, { type: 'undo_op', at: at(100), opId: 'undo-cold', targetOpId: 'swap-cold' });
    if (!u.ok) throw new Error(u.error.message);
    // The logged warm-up stays; the dumbbell row's working set is back; he's warm, so its old warm-up isn't.
    expect(rowsOf(u.state, ROW)).toEqual([['warmup', 'completed', 50, 8]]);
    expect(rowsOf(u.state, DBROW)).toEqual([['working', 'pending', 35, 8]]);
  });

  it('without the planner’s context the swap keeps its earlier shape (one new set per pending set)', () => {
    const cmd = swap(pullBWithDbRow(), false);
    expect(cmd.warmups).toBeUndefined();
    expect(cmd.sets).toHaveLength(4);
  });
});

describe('the coach’s add plans warm-ups and targets from history (8 Nov)', () => {
  const OWNER = profile();
  const history = (n: number, daysAgo: number): HistorySession => ({
    sessionId: id(n),
    performedAtUtc: at(-daysAgo * 86_400).utc,
    equipmentId: BAR.id,
    gymId: GYM,
    imported: false,
    sets: [1, 2, 3].map(() => ({ setType: 'working' as const, side: null, load: kg(95), reps: 10, rpe: 8, rir: null })),
    tz: 'Europe/London',
  });
  it('rows after logged pull-ups, last two sessions 95 × 10 at RIR 2: compound reps from history (not 3–6), the warm 80 % step first', () => {
    const s = pullB(true);
    const r = checkCoachAdd({
      aggregate: s,
      args: { baseVersion: s.session.version, exerciseId: 'barbell-bent-over-row', workingSets: 3, reps: null, workSeconds: null, distanceMetres: null, targetRpe: null, afterSessionExerciseId: null, supersetWithSessionExerciseId: null, load: null, reason: 'Ben asked' },
      exercise: EX.get(ROW) ?? null,
      history: [history(870, 2), history(871, 5)],
      substitute: { ownerId: OWNER.id, unit: 'kg', gym: { id: GYM, name: 'Main', equipment: s.session.equipmentSnapshot }, knownEquipment: new Map(s.session.equipmentSnapshot.map((e) => [e.id, e])), painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(100), warmups: { lookup }, secondaryLift: true },
      owner: OWNER,
      opId: 'coach-add-row',
      at: at(100),
    });
    if (r.status !== 'ok') throw new Error(r.status);
    const plan = r.command.plan ?? [];
    const work = plan.filter((p) => p.setType !== 'warmup');
    expect(work).toHaveLength(3);
    // The rule's next step from 95 × 10 at RPE 8 on a 6–10 compound range, never a 3–6 main-lift range.
    for (const p of work) {
      expect(p.planned.reps?.max ?? 0).toBeGreaterThanOrEqual(10);
      expect(p.planned.load?.value ?? 0).toBeGreaterThanOrEqual(95);
      expect(p.planned.load?.value ?? 0).toBeLessThanOrEqual(97.5);
    }
    const W = work[0]?.planned.load?.value ?? 0;
    const warm = plan.filter((p) => p.setType === 'warmup').map((p) => p.planned.load?.value ?? 0);
    expect(warm).toHaveLength(1);
    expect((warm[0] ?? 0) / W).toBeGreaterThanOrEqual(0.7);
    const applied = reduceSession(s, r.command);
    expect(applied.ok).toBe(true);
  });
});

describe('joinsAsSecondary: an added or swapped-in lift reads as a secondary lift unless it is the main lift (8 Nov)', () => {
  const mainBarbell = (row: { exerciseId: string }) => row.exerciseId === ROW || row.exerciseId === CURL;
  it('after logged pull-ups (no main lift named): secondary; in an empty workout before anything is done: its own category', () => {
    expect(joinsAsSecondary(pullB(true), { exerciseId: ROW, mains: new Set(), mainBarbell })).toBe(true);
    expect(joinsAsSecondary(pullB(false), { exerciseId: ROW, mains: new Set(), mainBarbell })).toBe(false);
  });
  it('a named main lift: that exercise is the main lift; anything else is secondary', () => {
    expect(joinsAsSecondary(pullB(false), { exerciseId: ROW, mains: new Set([ROW]), mainBarbell })).toBe(false);
    expect(joinsAsSecondary(pullB(false), { exerciseId: ROW, mains: new Set([PULLUP]), mainBarbell })).toBe(true);
  });
  it('a swap for the main lift row stays the main lift', () => {
    const s = pullB(true);
    const pu = s.exercises.find((e) => e.exerciseId === PULLUP)?.id ?? '';
    expect(joinsAsSecondary(s, { exerciseId: ROW, mains: new Set([PULLUP]), replacing: pu, mainBarbell })).toBe(false);
  });
});

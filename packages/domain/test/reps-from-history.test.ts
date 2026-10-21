import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, Exercise, SetType } from '@fizz/schemas';

import {
  aimReps,
  loadReferences,
  makeSlot,
  nextTargetsFor,
  PERSONAL_REPS,
  personalRepRange,
  ruleAnchorOf,
  ruleRepsFact,
  sameEffortReps,
  slotLoadOf,
  slotRepRange,
  slotRepsWhy,
  substituteTargets,
  typicalReps,
  lastSessionE1rm,
  type BuilderContext,
  type BuilderExerciseInfo,
  type HistorySession,
  type SlotLoadInput,
} from '../src/index';
import { assisted, barbell, dumbbells, exercise, GYM, id, kg, lb, OWNER, T0_MS, TZ } from './fixtures';

/**
 * Reps from history (Ben, 21 Oct 19:15, live Back workout): shrugs were planned
 * at 8 reps although he did 15 last time. Every slot's reps default from his
 * most recent session of that exact exercise, through the built-in rule
 * (double progression around his reps), on every new-workout path; the goal
 * range only applies without history, or moves gradually when history is far
 * outside it.
 */

const DAY = 86_400_000;
const NOW = T0_MS;
const ISO = { min: 8, max: 12 };

const rack: EquipmentInstance = dumbbells({ loads: Array.from({ length: 23 }, (_, i) => 5 + i * 2.5) }); // 5 … 60 kg each
const shortRack: EquipmentInstance = dumbbells({ id: id(7901), loads: [10, 15, 20, 25, 30] });
const PLATES = [
  { mass: 25, count: 4 },
  { mass: 20, count: 2 },
  { mass: 10, count: 2 },
  { mass: 5, count: 2 },
  { mass: 2.5, count: 2 },
  { mass: 1.25, count: 2 },
];
const bar = barbell({ id: id(7800), plates: PLATES, maxLoad: 180 });
const assist = assisted();

const SHRUG = exercise(320, 'Dumbbell shrug', { movementPattern: 'shrug', mechanic: 'isolation', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const ROW = exercise(310, 'Barbell row', { movementPattern: 'horizontal_pull', mechanic: 'compound', family: 'row' });
const PULLUP = exercise(330, 'Assisted pull-up', { movementPattern: 'vertical_pull', mechanic: 'compound', compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });

interface S {
  load: number;
  reps: number;
  rpe?: number;
  type?: SetType;
}

function session(n: number, daysAgo: number, eq: EquipmentInstance, convention: 'per_hand' | 'total' | 'assistance', sets: S[]): HistorySession {
  return {
    sessionId: id(n),
    performedAtUtc: new Date(NOW - daysAgo * DAY).toISOString(),
    equipmentId: eq.id,
    gymId: GYM,
    imported: false,
    sets: sets.map((s) => ({ setType: s.type ?? 'working', side: null, load: kg(s.load, convention), reps: s.reps, rpe: s.rpe ?? null, rir: null })),
    tz: TZ,
  };
}
const three = (load: number, reps: number, rpe?: number): S[] => [0, 1, 2].map(() => ({ load, reps, ...(rpe === undefined ? {} : { rpe }) }));

/** Ben's shrugs last time: 3 × 30 kg each × 15. */
const SHRUGS_15 = [session(900, 7, rack, 'per_hand', three(30, 15))];

const ctxAt = (gymEq: EquipmentInstance[]) => ({ gym: { id: GYM, name: 'Main gym', equipment: gymEq }, knownEquipment: new Map(gymEq.map((e) => [e.id, e])), unit: 'kg' as const });

/** What `builder-env` hands the builder for one exercise. */
function slotLoads(ex: Exercise, history: HistorySession[], gymEq: EquipmentInstance[]): SlotLoadInput {
  const refs = loadReferences({ exercise: ex, history, ctx: ctxAt(gymEq), nowMs: NOW });
  const req = {
    ownerId: OWNER,
    exerciseId: ex.id,
    exerciseName: ex.name,
    measurement: 'reps' as const,
    unit: refs.unit,
    convention: refs.convention,
    equipment: refs.equipment,
    exercise: ex,
    rule: null,
    workingSets: 3,
    history,
    painFlags: [],
    sessionPain: { active: false, reportedAtUtc: null },
    comparableEquipmentIds: new Set(refs.comparableEquipmentIds ?? []),
  };
  const { result, rule } = nextTargetsFor(req);
  const acc = nextTargetsFor({ ...req, accessory: true });
  return {
    unit: refs.unit,
    convention: refs.convention,
    equipment: refs.equipment,
    coachTarget: null,
    planFirstLoad: null,
    ruleTarget: history.length === 0 ? null : ruleAnchorOf(result, rule, refs.convention),
    e1rm: refs.own?.e1rm ?? null,
    lastE1rm: lastSessionE1rm(refs.own),
    e1rmGapDays: refs.own?.gapDays ?? null,
    startLightCeiling: null,
    painCap: null,
    ruleReps: history.length === 0 ? null : (result.reps ?? null),
    secondary: { ruleTarget: history.length === 0 ? null : ruleAnchorOf(acc.result, acc.rule, refs.convention), ruleReps: history.length === 0 ? null : (acc.result.reps ?? null) },
  };
}

const infoOf = (ex: Exercise, role: 'compound' | 'isolation', barbellLift = false): BuilderExerciseInfo => ({ exerciseId: ex.id, name: ex.name, group: 'Back', role, heavy: false, part: 'Back', muscles: [ex.name.toLowerCase()], angle: 'Back', barbell: barbellLift });

function ctxFor(ex: Exercise, load: SlotLoadInput, role: 'compound' | 'isolation', barbellLift = false): BuilderContext {
  return { info: (x) => (x === ex.id ? infoOf(ex, role, barbellLift) : null), loads: () => load, newKey: (x) => `k-${x}` };
}

const working = (rows: { type: SetType; reps: number; load: number | null }[]) => rows.filter((r) => r.type !== 'warmup');

describe('rep range from history (pure)', () => {
  it('typical reps: the lower median of the working sets', () => {
    expect(typicalReps([15, 15, 15])).toBe(15);
    expect(typicalReps([15, 14, 12])).toBe(14);
    expect(typicalReps([12, 15])).toBe(12);
    expect(typicalReps([])).toBeNull();
  });

  it('goal range without history or inside it; his reps above it up to the cap; gradual toward the goal past the cap; below it from his reps', () => {
    expect(personalRepRange(ISO, null, 15)).toEqual({ range: ISO, kind: 'goal' });
    expect(personalRepRange(ISO, 10, 15)).toEqual({ range: ISO, kind: 'goal' });
    expect(personalRepRange(ISO, 15, 15)).toEqual({ range: { min: 12, max: 15 }, kind: 'history' });
    expect(personalRepRange(ISO, 20, 15)).toEqual({ range: { min: 15, max: 18 }, kind: 'toward_goal' });
    expect(personalRepRange(ISO, 16, 15)).toEqual({ range: { min: 12, max: 15 }, kind: 'toward_goal' });
    expect(personalRepRange(ISO, 5, 15)).toEqual({ range: { min: 5, max: 8 }, kind: 'history' });
    // Bodyweight: reps are the only way on, so the range follows him however high.
    expect(personalRepRange(ISO, 20, 15, false)).toEqual({ range: { min: 17, max: 20 }, kind: 'history' });
    expect(PERSONAL_REPS.width).toBe(3);
  });

  it('aim: after a load increase, the reps the new load allows at the same effort; a hold repeats his reps; a miss plans the floor', () => {
    expect(sameEffortReps(15, 60, 62.5, 'resistance')).toBe(13);
    expect(sameEffortReps(15, 60, 62.5, 'assistance')).toBeNull();
    expect(aimReps('increase_load', { min: 12, max: 15 }, 15, { from: 60, to: 62.5, direction: 'resistance' })).toBe(13);
    expect(aimReps('increase_load', { min: 12, max: 15 }, 15, null)).toBe(12);
    expect(aimReps('hold', ISO, 10, null)).toBe(10);
    expect(aimReps('increase_reps', { min: 11, max: 11 }, 10, null)).toBe(11);
    expect(aimReps('hold_after_miss', ISO, 6, null)).toBe(8);
    expect(aimReps('insufficient_data', ISO, null, null)).toBe(8);
  });

  it('Why? facts: only when the range came from history', () => {
    expect(ruleRepsFact({ last: 15, goal: ISO, range: { min: 12, max: 15 }, kind: 'history' })).toBe('Reps follow your last session (15 reps): 12–15.');
    expect(ruleRepsFact({ last: 20, goal: ISO, range: { min: 15, max: 18 }, kind: 'toward_goal' })).toBe('Last session 20 reps, well above 8–12: 15–18 this time, moving toward 8–12.');
    expect(ruleRepsFact({ last: 10, goal: ISO, range: ISO, kind: 'goal' })).toBeNull();
  });
});

describe('Ben’s shrugs, reproduced: did 15 last time → planned around 15, not 8', () => {
  it('the built-in rule (Today, swaps, adds, get_progression_targets) plans 12–15 at the next dumbbell, with the reason behind Why?', () => {
    const { result, rule } = nextTargetsFor({ ownerId: OWNER, exerciseId: SHRUG.id, exerciseName: SHRUG.name, measurement: 'reps', unit: 'kg', convention: 'per_hand', equipment: rack, exercise: SHRUG, rule: null, workingSets: 3, history: SHRUGS_15, painFlags: [], sessionPain: { active: false, reportedAtUtc: null } });
    expect(result.decision).toBe('increase_load');
    expect(result.sets.map((s) => [s.load?.value, s.reps])).toEqual([0, 1, 2].map(() => [32.5, { min: 12, max: 15 }]));
    expect(rule.method === 'double_progression' ? rule.repRange : null).toEqual({ min: 12, max: 15 });
    expect(rule.name).toBe('12–15 reps, up to RPE 9');
    expect(result.reps).toEqual({ last: 15, goal: ISO, range: { min: 12, max: 15 }, kind: 'history', aim: 12 });
    expect(result.explanation.facts[0]).toBe('Reps follow your last session (15 reps): 12–15.');
  });

  it('the builder slot plans 3 × 12+ at 32.5 kg each (not 8), with `Reps: last time 15` behind Why?', () => {
    const load = slotLoads(SHRUG, SHRUGS_15, [rack]);
    const slot = makeSlot(SHRUG.id, { main: false }, ctxFor(SHRUG, load, 'isolation'));
    const work = working(slot.rows);
    expect(work).toHaveLength(3);
    expect(work.every((r) => r.reps >= 12 && r.reps <= 15)).toBe(true);
    expect(work.every((r) => r.reps !== 8)).toBe(true);
    expect(work.map((r) => r.load)).toEqual([32.5, 32.5, 32.5]);
    expect(slot.source).toBe('rule');
    expect(slot.repRange).toEqual({ min: 12, max: 15 });
    expect(slotRepsWhy(false, load.ruleReps)).toBe('Reps: last time 15');
  });

  it('heavier shrugs (50 kg each × 15): the next step allows 13 at the same effort, so 13 is planned', () => {
    const load = slotLoads(SHRUG, [session(901, 5, rack, 'per_hand', three(50, 15))], [rack]);
    const slot = makeSlot(SHRUG.id, { main: false }, ctxFor(SHRUG, load, 'isolation'));
    expect(working(slot.rows).map((r) => [r.reps, r.load])).toEqual([0, 1, 2].map(() => [13, 52.5]));
  });

  it('history inside the goal range without reaching its top: the same load at his reps (a hold), not the range floor', () => {
    const load = slotLoads(SHRUG, [session(902, 5, rack, 'per_hand', three(30, 10, 8))], [rack]);
    const slot = makeSlot(SHRUG.id, { main: false }, ctxFor(SHRUG, load, 'isolation'));
    expect(working(slot.rows).map((r) => [r.reps, r.load])).toEqual([0, 1, 2].map(() => [10, 30]));
    expect(load.ruleReps?.kind).toBe('goal');
    expect(slotRepsWhy(false, load.ruleReps)).toBeNull();
  });

  it('no history: the goal range applies (8–12, planned at 8, no load)', () => {
    const load = slotLoads(SHRUG, [], [rack]);
    const slot = makeSlot(SHRUG.id, { main: false }, ctxFor(SHRUG, load, 'isolation'));
    expect(slot.repRange).toEqual(ISO);
    expect(working(slot.rows).every((r) => r.reps === 8 && r.load === null)).toBe(true);
    expect(slotRepsWhy(false, load.ruleReps)).toBeNull();
  });

  it('history far above the goal (25 reps) moves toward it gradually, said behind Why?', () => {
    const load = slotLoads(SHRUG, [session(903, 5, rack, 'per_hand', three(20, 25))], [rack]);
    expect(load.ruleReps).toMatchObject({ last: 25, range: { min: 20, max: 23 }, kind: 'toward_goal' });
    const slot = makeSlot(SHRUG.id, { main: false }, ctxFor(SHRUG, load, 'isolation'));
    expect(working(slot.rows).every((r) => r.reps >= 20 && r.reps <= 23)).toBe(true);
    expect(slotRepsWhy(false, load.ruleReps)).toBe('Reps: last time 25 · toward 8–12');
  });

  it('lb dumbbells: the same reps from history, loads in lb on the lb rack', () => {
    const lbRack = dumbbells({ id: id(7902), unit: 'lb', loads: Array.from({ length: 23 }, (_, i) => 10 + i * 5) });
    const h: HistorySession = { ...session(907, 5, lbRack, 'per_hand', []), sets: [0, 1, 2].map(() => ({ setType: 'working' as const, side: null, load: lb(70, 'per_hand'), reps: 15, rpe: null, rir: null })) };
    const load = slotLoads(SHRUG, [h], [lbRack]);
    const slot = makeSlot(SHRUG.id, { main: false }, ctxFor(SHRUG, load, 'isolation'));
    expect(slot.unit).toBe('lb');
    expect(working(slot.rows).map((r) => [r.reps, r.load])).toEqual([0, 1, 2].map(() => [12, 75]));
  });

  it('equipment max: at the heaviest dumbbell he holds there at his reps, never above it (rule 4)', () => {
    const load = slotLoads(SHRUG, [session(904, 5, shortRack, 'per_hand', three(30, 15))], [shortRack]);
    const slot = makeSlot(SHRUG.id, { main: false }, ctxFor(SHRUG, load, 'isolation'));
    const work = working(slot.rows);
    expect(work.every((r) => r.load !== null && r.load <= 30)).toBe(true);
    expect(work.every((r) => r.reps === 15)).toBe(true);
  });
});

describe('secondary compounds and main lifts', () => {
  const ROWS_12 = [session(905, 4, bar, 'total', three(80, 12))];

  it('a barbell row as a secondary lift (main lift rule read as a compound’s): his 12 reps → about 11 at the next load, not 3–6', () => {
    const load = slotLoads(ROW, ROWS_12, [bar]);
    // The main-lift reading keeps 3–6 (`fixed`); the secondary reading follows his reps.
    expect(load.ruleReps?.kind).toBe('fixed');
    expect(load.secondary?.ruleReps).toMatchObject({ last: 12, range: { min: 9, max: 12 }, kind: 'history' });
    const slot = makeSlot(ROW.id, { main: false }, ctxFor(ROW, load, 'compound', true));
    const work = working(slot.rows);
    expect(work.map((r) => [r.reps, r.load])).toEqual([0, 1, 2].map(() => [11, 82.5]));
    expect(slotLoadOf(load, false).ruleReps?.kind).toBe('history');
    expect(slotLoadOf(load, true)).toBe(load);
  });

  it('the same row as the main lift keeps its top set / back-offs scheme, and Why? names his last reps', () => {
    const load = slotLoads(ROW, ROWS_12, [bar]);
    const slot = makeSlot(ROW.id, { main: true }, ctxFor(ROW, load, 'compound', true));
    const work = working(slot.rows);
    expect(work[0]).toMatchObject({ type: 'top', reps: 6 });
    expect(work.slice(1).every((r) => r.type === 'backoff' && r.reps === 8)).toBe(true);
    expect(slotRepsWhy(true, load.ruleReps)).toBe('Last time 12 reps · main lift 6–8');
    const reps = load.ruleReps;
    if (reps == null) throw new Error('no rule reps');
    expect(slotRepsWhy(true, { ...reps, last: 7 })).toBeNull();
  });

  it('without the secondary reading, a fixed rule as a secondary lift plans his reps and derives the load from the rule load’s e1RM (never the 3–6 load as is)', () => {
    const load = slotLoads(ROW, ROWS_12, [bar]);
    const plain: SlotLoadInput = { ...load };
    delete plain.secondary;
    expect(slotRepRange(false, plain)).toEqual({ min: 12, max: 12 });
    const slot = makeSlot(ROW.id, { main: false }, ctxFor(ROW, plain, 'compound', true));
    const work = working(slot.rows);
    expect(work.every((r) => r.reps === 12)).toBe(true);
    // The rule's 82.5 is for 3–6 reps: 12 reps take less.
    expect(work.every((r) => r.load !== null && r.load < 82.5)).toBe(true);
  });

  it('assisted machine: reps follow his history and the next step is less assistance (no same-effort reps on assistance)', () => {
    const { result } = nextTargetsFor({ ownerId: OWNER, exerciseId: PULLUP.id, exerciseName: PULLUP.name, measurement: 'reps', unit: 'kg', convention: 'assistance', equipment: assist, exercise: PULLUP, rule: null, workingSets: 3, history: [session(906, 4, assist, 'assistance', three(30, 12))], painFlags: [], sessionPain: { active: false, reportedAtUtc: null } });
    expect(result.decision).toBe('increase_load');
    expect(result.sets[0]?.load?.value).toBe(25);
    expect(result.reps).toMatchObject({ last: 12, range: { min: 9, max: 12 }, kind: 'history', aim: 9 });
  });

  it('a rule of Ben’s own keeps its range (`fixed`)', () => {
    const own = nextTargetsFor({ ownerId: OWNER, exerciseId: SHRUG.id, exerciseName: SHRUG.name, measurement: 'reps', unit: 'kg', convention: 'per_hand', equipment: rack, exercise: SHRUG, rule: null, workingSets: 3, history: SHRUGS_15, painFlags: [], sessionPain: { active: false, reportedAtUtc: null } }).rule;
    const mine = { ...own, id: id(5555), repRange: { min: 8, max: 12 }, name: 'Mine' };
    const { result } = nextTargetsFor({ ownerId: OWNER, exerciseId: SHRUG.id, exerciseName: SHRUG.name, measurement: 'reps', unit: 'kg', convention: 'per_hand', equipment: rack, exercise: SHRUG, rule: mine, workingSets: 3, history: SHRUGS_15, painFlags: [], sessionPain: { active: false, reportedAtUtc: null } });
    expect(result.reps?.kind).toBe('fixed');
    expect(result.sets[0]?.reps).toEqual({ min: 8, max: 12 });
  });

  it('swaps and adds (substituteTargets) carry the same reps as the builder reads', () => {
    const sp = substituteTargets({ workingSets: 3, templates: [{ setType: 'working', reps: ISO, durationS: null }] }, SHRUG, SHRUGS_15, { ...ctxAt([rack]), ownerId: OWNER, painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: { utc: new Date(NOW).toISOString(), tz: TZ } });
    expect(sp.ruleReps).toMatchObject({ last: 15, range: { min: 12, max: 15 }, aim: 12 });
    expect(sp.plan?.map((s) => s.planned.reps)).toEqual([0, 1, 2].map(() => ({ min: 12, max: 15 })));
  });
});

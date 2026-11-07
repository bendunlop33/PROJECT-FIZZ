import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, Exercise, Load, PreStartDraft, Routine, SessionAggregate, TodayEdit, ZonedTimestamp } from '@fizz/schemas';
import { PreStartDraftSchema, SessionAggregateSchema, TodayEditSchema } from '@fizz/schemas';

import {
  addTargets,
  applyDraftCommand,
  applyEditsToRoutine,
  basisSlots,
  buildWorkoutOverview,
  editCountOf,
  liveEdits,
  moveSlot,
  planWithTodayEdits,
  pruneOf,
  rankAddCandidates,
  resolveTodayEdits,
  setsStepFrom,
  shapeTemplates,
  substituteTargets,
  templateLinesFromEdits,
  withAddedPlaced,
  withoutTodayOnlySets,
  todayLoadNote,
  todayShapes,
  type DraftCommand,
  type HistorySession,
  type NextTargetEntry,
  type OverviewToday,
  type RowShapeEdit,
  type SubstituteContext,
  type SwapPlan,
  type TodayPlanOutput,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, OWNER, profile, routine, routineExercise, stack, template, TZ } from './fixtures';

/**
 * Full edit before start (overview-today-edits §11, slice B): the four new
 * edit kinds (`add`, `sets`, `reps`, `load`) as intent in the draft, applied
 * by the one planning path (`planWithTodayEdits`, then the unchanged planner
 * and shared fit), the Edit mode row view, and `Update Push A` (template
 * lines with default checks, Apply through the editor's `editRoutine`).
 * Covers kg/lb, per-hand dumbbells, an equipment max, an assisted machine,
 * duplicate operation IDs and stale versions.
 */

const NB = '\u00a0';
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NB, ' ');

const BENCH = id(210);
const INCLINE = id(211);
const FLY = id(212);
const RAISE = id(213);
const PUSHDOWN = id(214);
const DB_BENCH = id(220);
const FACE_PULL = id(225);
const PULLUP = id(223);
const CURL = id(226);

const ex = (n: number, name: string, over: Partial<Exercise>) => exercise(n, name, over);
const EXERCISES = new Map<string, Exercise>([
  [BENCH, ex(210, 'Bench press', { primaryMuscles: ['chest'], family: 'bench_press' })],
  [INCLINE, ex(211, 'Incline DB press', { primaryMuscles: ['upper_chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [FLY, ex(212, 'Cable fly', { primaryMuscles: ['chest'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' })],
  [RAISE, ex(213, 'Lateral raise', { primaryMuscles: ['side_delts'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [PUSHDOWN, ex(214, 'Triceps pushdown', { primaryMuscles: ['triceps'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' })],
  [DB_BENCH, ex(220, 'DB bench press', { primaryMuscles: ['chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [FACE_PULL, ex(225, 'Face pull', { primaryMuscles: ['rear_delts'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'isolation' })],
  [PULLUP, ex(223, 'Assisted pull-up', { primaryMuscles: ['lats'], compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })],
  [CURL, ex(226, 'Barbell curl', { primaryMuscles: ['biceps'], compatibleEquipment: ['barbell'], defaultLoadConvention: 'total', mechanic: 'isolation' })],
]);
const exOf = (exerciseId: string): Exercise => {
  const e = EXERCISES.get(exerciseId);
  if (!e) throw new Error('no exercise');
  return e;
};

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};
const MAIN = GYM;
const HOTEL = id(3);
const bar = barbell({ id: id(700), gymId: MAIN, plates: [{ mass: 25, count: 4 }, { mass: 20, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }] });
const rack = dumbbells({ id: id(701), gymId: MAIN, name: 'Main dumbbells', loads: steps(2.5, 40, 2.5) });
const cable = stack({ id: id(702), gymId: MAIN, name: 'Cable station', stackLoads: steps(5, 100, 5) });
const assist = assisted({ id: id(703), gymId: MAIN });
const MAIN_EQ: EquipmentInstance[] = [bar, rack, cable, assist];
const hotelRack = dumbbells({ id: id(710), gymId: HOTEL, name: 'Hotel dumbbells', loads: steps(2.5, 20, 2.5) });
const lbRack = dumbbells({ id: id(711), gymId: id(4), name: 'Imperial dumbbells', unit: 'lb', loads: steps(5, 100, 5) });
const KNOWN = new Map([...MAIN_EQ, hotelRack, lbRack].map((e) => [e.id, e]));
const MAIN_GYM = { id: MAIN, name: 'Main gym', equipment: MAIN_EQ };
const HOTEL_GYM = { id: HOTEL, name: 'Hotel gym', equipment: [hotelRack] };
const LB_GYM = { id: id(4), name: 'Imperial gym', equipment: [lbRack] };

const SLOT_BENCH = id(600);
const SLOT_INCLINE = id(601);
const SLOT_RAISE = id(602);
const SLOT_PUSHDOWN = id(603);
const SLOT_FLY = id(604);
const SLOT_PULLUP = id(605);
const NEW_SLOT = id(650);
const NEW_SLOT_2 = id(651);

function pushA(over: Partial<Routine> = {}): Routine {
  return {
    ...routine([
      routineExercise(600, {
        exerciseId: BENCH,
        equipmentId: bar.id,
        order: 0,
        setTemplates: [
          template(6001, { setType: 'warmup', targetLoad: kg(60), targetReps: { min: 5, max: 5 } }),
          template(6002, { setType: 'warmup', targetLoad: kg(80), targetReps: { min: 3, max: 3 } }),
          template(6003, { targetLoad: kg(100) }),
          template(6004, { targetLoad: kg(100) }),
          template(6005, { targetLoad: kg(100) }),
        ],
      }),
      routineExercise(601, { exerciseId: INCLINE, equipmentId: rack.id, order: 1, setTemplates: [6011, 6012, 6013].map((n) => template(n, { targetLoad: kg(30, 'per_hand'), targetReps: { min: 8, max: 10 } })) }),
      routineExercise(602, { exerciseId: RAISE, equipmentId: rack.id, order: 2, supersetGroup: 'A', setTemplates: [6021, 6022, 6023].map((n) => template(n, { targetLoad: kg(10, 'per_hand'), targetReps: { min: 12, max: 15 } })) }),
      routineExercise(603, { exerciseId: PUSHDOWN, equipmentId: cable.id, order: 3, supersetGroup: 'A', setTemplates: [6031, 6032, 6033].map((n) => template(n, { targetLoad: kg(25, 'stack'), targetReps: { min: 10, max: 12 } })) }),
      routineExercise(604, { exerciseId: FLY, equipmentId: cable.id, order: 4, setTemplates: [6041, 6042, 6043].map((n) => template(n, { targetLoad: kg(50, 'stack'), targetReps: { min: 12, max: 15 } })) }),
    ]),
    // A library workout: its non-null loads are Ben's Fixed pins.
    source: 'ben',
    ...over,
  };
}

function history(sessionN: number, daysAgo: number, equipment: EquipmentInstance | null, load: Load | null, reps: number[]): HistorySession {
  return {
    sessionId: id(sessionN),
    performedAtUtc: at(-daysAgo * 86_400).utc,
    equipmentId: equipment?.id ?? null,
    gymId: equipment?.gymId ?? MAIN,
    imported: false,
    sets: reps.map((r) => ({ setType: 'working' as const, side: null, load, reps: r, rpe: null, rir: null })),
    tz: TZ,
  };
}
/** Face pull last done 7 days ago ("1 Oct") at 20 kg × 15. */
const FACE_PULL_HISTORY = [history(910, 7, cable, kg(20, 'stack'), [15, 15, 15])];

function ctxAt(gym: { id: string; name: string; equipment: readonly EquipmentInstance[] }, over: Partial<SubstituteContext> = {}): SubstituteContext {
  return { ownerId: OWNER, unit: 'kg', gym, knownEquipment: KNOWN, painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(0), ...over };
}

let editN = 0;
type Body = Parameters<typeof applyDraftCommand>[0]['command'] extends infer C ? (C extends { type: 'edit'; edit: infer E } ? E : never) : never;
function edit(body: Body): TodayEdit {
  editN += 1;
  const e = { ...body, editId: id(7000 + editN), opId: `op-${String(editN)}`, atUtc: at(0).utc, replacesEditId: null, removed: null } as TodayEdit;
  expect(TodayEditSchema.safeParse(e).success).toBe(true);
  return e;
}

function plan(
  edits: readonly TodayEdit[],
  opts: { gym?: typeof MAIN_GYM; adds?: Map<string, SwapPlan>; swaps?: Map<string, SwapPlan>; r?: Routine } = {},
): Extract<TodayPlanOutput, { kind: 'routine' }> {
  const gym = opts.gym ?? MAIN_GYM;
  return planWithTodayEdits(
    {
      kind: 'routine',
      input: { opId: 'preview', owner: profile(), gymId: gym.id, gymName: gym.name, routine: opts.r ?? pushA(), exercises: EXERCISES, gymEquipment: gym.equipment, knownEquipment: KNOWN, at: at(0), newId: idGen(20_000) },
    },
    { draft: { id: id(5000), version: 3 }, edits, swaps: opts.swaps ?? new Map(), adds: opts.adds ?? new Map() },
  );
}

const rowsOf = (agg: SessionAggregate) => [...agg.exercises].sort((a, b) => a.order - b.order);
const setsOf = (agg: SessionAggregate, sessionExerciseId: string) => agg.sets.filter((s) => s.sessionExerciseId === sessionExerciseId).sort((a, b) => a.index - b.index);
const rowOf = (out: { aggregate: SessionAggregate; slotOf: Record<string, string> }, slotKey: string) => rowsOf(out.aggregate).find((e) => out.slotOf[e.id] === slotKey);
const workingOf = (out: { aggregate: SessionAggregate; slotOf: Record<string, string> }, slotKey: string) => setsOf(out.aggregate, rowOf(out, slotKey)?.id ?? '').filter((s) => s.setType !== 'warmup');

const BASIS = { kind: 'routine' as const, routineId: id(300) };
const SLOTS = basisSlots({ kind: 'routine', routine: pushA() });
function write(current: PreStartDraft | null, command: DraftCommand, opId: string, when: ZonedTimestamp = at(0), expectedVersion: number | null = current?.version ?? null) {
  return applyDraftCommand({ current, expectedVersion, opId, at: when, ownerId: OWNER, basis: BASIS, newDraftId: id(5000), slots: SLOTS, command });
}
function written(change: ReturnType<typeof write>): PreStartDraft {
  if (change.kind !== 'write') throw new Error(`expected a write, got ${change.kind}`);
  expect(PreStartDraftSchema.safeParse(change.next).success).toBe(true);
  return change.next;
}

const facePullPlan = () => new Map([[NEW_SLOT, addTargets(exOf(FACE_PULL), FACE_PULL_HISTORY, ctxAt(MAIN_GYM))]]);

// ---------------------------------------------------------------------------

describe('the draft takes the §11 kinds: versioned, idempotent, within limits (TE12, TE17, rule 5)', () => {
  it('sets, reps and load replace the slot’s previous edit of that kind; `clear` is `Use planned`; a retry is a duplicate; a stale version writes nothing', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 4 } }, 's1'));
    d = written(write(d, { type: 'edit', edit: { kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 5 } }, 's2'));
    expect(liveEdits(d.edits)).toMatchObject([{ kind: 'sets', workingSets: 5 }]);
    expect(write(d, { type: 'edit', edit: { kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 5 } }, 's3')).toMatchObject({ kind: 'unchanged' });
    expect(write(d, { type: 'edit', edit: { kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 6 } }, 's2')).toMatchObject({ kind: 'duplicate' });
    expect(write(d, { type: 'edit', edit: { kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 6 } }, 's4', at(0), 1)).toMatchObject({ kind: 'stale' });
    d = written(write(d, { type: 'edit', edit: { kind: 'reps', slotKey: SLOT_INCLINE, reps: { min: 6, max: 8 }, durationS: null } }, 's5'));
    d = written(write(d, { type: 'edit', edit: { kind: 'load', slotKey: SLOT_INCLINE, load: kg(32.5, 'per_hand') } }, 's6'));
    d = written(write(d, { type: 'clear', kind: 'reps', slotKey: SLOT_INCLINE }, 's7'));
    expect(liveEdits(d.edits).map((e) => e.kind)).toEqual(['sets', 'load']);
    expect(write(d, { type: 'clear', kind: 'reps', slotKey: SLOT_INCLINE }, 's8')).toMatchObject({ kind: 'unchanged' });
  });

  it('refuses values outside the limits: sets 1–10, reps 1–50, work time 0:05–10:00, reps or time but not both', () => {
    for (const bad of [
      { kind: 'sets' as const, slotKey: SLOT_INCLINE, workingSets: 0 },
      { kind: 'sets' as const, slotKey: SLOT_INCLINE, workingSets: 11 },
      { kind: 'reps' as const, slotKey: SLOT_INCLINE, reps: { min: 0, max: 8 }, durationS: null },
      { kind: 'reps' as const, slotKey: SLOT_INCLINE, reps: { min: 8, max: 51 }, durationS: null },
      { kind: 'reps' as const, slotKey: SLOT_INCLINE, reps: { min: 9, max: 8 }, durationS: null },
      { kind: 'reps' as const, slotKey: SLOT_INCLINE, reps: null, durationS: 3 },
      { kind: 'reps' as const, slotKey: SLOT_INCLINE, reps: { min: 8, max: 8 }, durationS: 30 },
    ]) {
      expect(write(null, { type: 'edit', edit: bad }, `bad-${JSON.stringify(bad)}`)).toEqual({ kind: 'invalid', reason: 'out_of_range' });
    }
    expect(write(null, { type: 'edit', edit: { kind: 'sets', slotKey: id(999), workingSets: 4 } }, 'gone')).toEqual({ kind: 'invalid', reason: 'slot_gone' });
  });

  it('add: an exercise already in today’s plan is a second copy (Ben, 19 Oct), at most six; an added row can’t be skipped or swapped; Remove takes its edits and Undo brings them all back', () => {
    expect(write(null, { type: 'edit', edit: { kind: 'add', slotKey: NEW_SLOT, exerciseId: INCLINE } }, 'a0').kind).toBe('write');
    let d = written(write(null, { type: 'edit', edit: { kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL } }, 'a1'));
    expect(write(d, { type: 'edit', edit: { kind: 'add', slotKey: NEW_SLOT_2, exerciseId: FACE_PULL } }, 'a2').kind).toBe('write');
    expect(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: FACE_PULL } }, 'a3')).toEqual({ kind: 'invalid', reason: 'in_plan' });
    expect(write(d, { type: 'edit', edit: { kind: 'skip', slotKey: NEW_SLOT } }, 'a4')).toEqual({ kind: 'invalid', reason: 'added' });
    d = written(write(d, { type: 'edit', edit: { kind: 'sets', slotKey: NEW_SLOT, workingSets: 4 } }, 'a5'));
    const add = liveEdits(d.edits).find((e) => e.kind === 'add');
    const removed = write(d, { type: 'undo', editId: add?.editId ?? '' }, 'a6');
    if (removed.kind !== 'write') throw new Error(removed.kind);
    expect(removed.removed).toHaveLength(2);
    expect(liveEdits(removed.next.edits)).toEqual([]);
    const back = written(write(removed.next, { type: 'restore', editIds: removed.removed }, 'a7'));
    expect(liveEdits(back.edits).map((e) => e.kind)).toEqual(['add', 'sets']);
    // Six at most.
    let many: PreStartDraft | null = null;
    const extra = [FACE_PULL, DB_BENCH, PULLUP, CURL, id(230), id(231)];
    extra.forEach((x, i) => (many = written(write(many, { type: 'edit', edit: { kind: 'add', slotKey: id(660 + i), exerciseId: x } }, `m${String(i)}`))));
    expect(write(many, { type: 'edit', edit: { kind: 'add', slotKey: id(670), exerciseId: id(232) } }, 'm7')).toEqual({ kind: 'invalid', reason: 'too_many' });
  });

  it('an order listing only the plan’s own slots keeps today’s added ones at the end (a coach Apply’s order, review B2); an unknown or missing planned slot is still refused', () => {
    const d = written(write(null, { type: 'edit', edit: { kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL } }, 'o0'));
    const planned = moveSlot(SLOTS, SLOT_INCLINE, 'first') ?? [];
    const r = written(write(d, { type: 'edit', edit: { kind: 'order', slotKeys: planned } }, 'o1'));
    expect(liveEdits(r.edits).find((e) => e.kind === 'order')).toMatchObject({ slotKeys: [...planned, NEW_SLOT] });
    // The same order again (with or without the added key) changes nothing.
    expect(write(r, { type: 'edit', edit: { kind: 'order', slotKeys: planned } }, 'o2')).toMatchObject({ kind: 'unchanged' });
    expect(write(r, { type: 'edit', edit: { kind: 'order', slotKeys: [...planned, NEW_SLOT] } }, 'o3')).toMatchObject({ kind: 'unchanged' });
    expect(write(d, { type: 'edit', edit: { kind: 'order', slotKeys: planned.slice(1) } }, 'o4')).toEqual({ kind: 'invalid', reason: 'bad_order' });
    expect(write(d, { type: 'edit', edit: { kind: 'order', slotKeys: [...planned, id(998)] } }, 'o5')).toEqual({ kind: 'invalid', reason: 'bad_order' });
  });

  it('a coach order keeps an added exercise where Ben placed it: ahead of the slot it preceded, not moved to the end (merge r2 S1)', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL } }, 'p0'));
    // Ben moves Face pull to the top.
    d = written(write(d, { type: 'edit', edit: { kind: 'order', slotKeys: [NEW_SLOT, SLOT_BENCH, SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY] } }, 'p1'));
    // The coach's order lists the plan's own slots only: incline first.
    const coach = [SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY];
    const r = written(write(d, { type: 'edit', edit: { kind: 'order', slotKeys: coach } }, 'p2'));
    expect(liveEdits(r.edits).find((e) => e.kind === 'order')).toMatchObject({ slotKeys: [SLOT_INCLINE, NEW_SLOT, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY] });
    expect(resolveTodayEdits(SLOTS, liveEdits(r.edits)).order?.indexOf(NEW_SLOT)).toBe(1);
    // Undo of the coach's order brings Ben's back.
    const coachOrder = liveEdits(r.edits).find((e) => e.kind === 'order');
    const undone = written(write(r, { type: 'undo', editId: coachOrder?.editId ?? '' }, 'p3'));
    expect(liveEdits(undone.edits).find((e) => e.kind === 'order')).toMatchObject({ slotKeys: [NEW_SLOT, SLOT_BENCH, SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY] });
    // Duplicate op ID: nothing more written.
    expect(write(r, { type: 'edit', edit: { kind: 'order', slotKeys: coach } }, 'p2')).toMatchObject({ kind: 'duplicate' });
  });

  it('placing an added exercise back: last in Ben’s order stays last, never placed goes last, and one that would split a superset goes last (merge r2 S1)', () => {
    const coach = [SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY];
    const NEW_2 = id(651);
    expect(withAddedPlaced(coach, [NEW_SLOT], [SLOT_BENCH, SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY, NEW_SLOT], SLOTS)).toEqual([...coach, NEW_SLOT]);
    expect(withAddedPlaced(coach, [NEW_SLOT], null, SLOTS)).toEqual([...coach, NEW_SLOT]);
    // Two added, placed together ahead of Fly: they stay together, in Ben's order.
    expect(withAddedPlaced(coach, [NEW_SLOT, NEW_2], [SLOT_BENCH, SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN, NEW_2, NEW_SLOT, SLOT_FLY], SLOTS)).toEqual([SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, NEW_2, NEW_SLOT, SLOT_FLY]);
    // Ahead of the superset in Ben's order; the coach turns the pair round, so "before Raise" would split it.
    const flipped = [SLOT_BENCH, SLOT_INCLINE, SLOT_PUSHDOWN, SLOT_RAISE, SLOT_FLY];
    expect(withAddedPlaced(flipped, [NEW_SLOT], [SLOT_BENCH, SLOT_INCLINE, NEW_SLOT, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY], SLOTS)).toEqual([...flipped, NEW_SLOT]);
    // Already listed: left where the order puts it.
    expect(withAddedPlaced([NEW_SLOT, ...coach], [NEW_SLOT], [SLOT_BENCH, NEW_SLOT], SLOTS)).toEqual([NEW_SLOT, ...coach]);
  });

  it('the last exercise left counts an added one: with every planned exercise skipped and one added, the skip is allowed', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL } }, 'l0'));
    for (const [i, s] of SLOTS.map((x) => x.slotKey).entries()) d = written(write(d, { type: 'edit', edit: { kind: 'skip', slotKey: s } }, `l${String(i + 1)}`));
    expect(liveEdits(d.edits).filter((e) => e.kind === 'skip')).toHaveLength(5);
  });
});

describe('resolving §11 edits (TE12 order; stale when the plan moved)', () => {
  it('an added exercise goes at the end; an order edit made before an add keeps it at the end; one made after places it; a gone planned slot makes the order stale', () => {
    const add = edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL });
    const before = edit({ kind: 'order', slotKeys: moveSlot(SLOTS, SLOT_INCLINE, 'first') ?? [] });
    const r = resolveTodayEdits(SLOTS, [before, add]);
    expect(r.order).toEqual([SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY, NEW_SLOT]);
    const after = edit({ kind: 'order', slotKeys: [NEW_SLOT, SLOT_BENCH, SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY] });
    expect(resolveTodayEdits(SLOTS, [add, after]).order?.[0]).toBe(NEW_SLOT);
    // The add removed since (Remove): its key drops out of the order, which still applies.
    const gone = { ...add, removed: { atUtc: at(5).utc, opId: 'rm', why: 'undo' as const } };
    expect(resolveTodayEdits(SLOTS, [gone, after]).outcomes.find((o) => o.kind === 'order')?.result).toBe('applied');
    expect(resolveTodayEdits(SLOTS, [gone, after]).order).toBeNull();
    // A planned slot removed from the routine: stale (v0.2 rule).
    expect(resolveTodayEdits(SLOTS.filter((s) => s.slotKey !== SLOT_FLY), [add, after]).outcomes.find((o) => o.kind === 'order')?.result).toBe('stale');
  });

  it('sets, reps and load on a gone slot are stale and pruned; `N EDITED` counts each slot once', () => {
    const s = edit({ kind: 'sets', slotKey: SLOT_FLY, workingSets: 4 });
    const r = edit({ kind: 'reps', slotKey: SLOT_INCLINE, reps: { min: 6, max: 8 }, durationS: null });
    const l = edit({ kind: 'load', slotKey: SLOT_INCLINE, load: kg(32.5, 'per_hand') });
    const res = resolveTodayEdits(SLOTS, [s, r, l]);
    expect(editCountOf(res)).toBe(2);
    const gone = resolveTodayEdits(SLOTS.filter((x) => x.slotKey !== SLOT_FLY), [s, r, l]);
    expect(pruneOf(gone.outcomes)).toEqual([{ editId: s.editId, why: 'stale' }]);
  });
});

describe('planWithTodayEdits with §11 edits: preview = Start (TE-B2 to TE-B6)', () => {
  it('TE-B3: [+] on incline makes 4 working sets copying set 3’s target; a superset member’s [+] adds to that member only; warm-ups untouched', () => {
    const out = plan([edit({ kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 4 }), edit({ kind: 'sets', slotKey: SLOT_RAISE, workingSets: 4 })]);
    const incline = workingOf(out, SLOT_INCLINE);
    expect(incline).toHaveLength(4);
    expect(incline[3]?.planned.load).toEqual(incline[2]?.planned.load);
    expect(incline[3]?.planned.reps).toEqual({ min: 8, max: 10 });
    expect(workingOf(out, SLOT_RAISE)).toHaveLength(4);
    expect(workingOf(out, SLOT_PUSHDOWN)).toHaveLength(3);
    expect(setsOf(out.aggregate, rowOf(out, SLOT_BENCH)?.id ?? '').filter((s) => s.setType === 'warmup')).toHaveLength(2);
    expect(out.plannedShape[SLOT_INCLINE]).toEqual({ workingSets: 3, reps: { min: 8, max: 10 }, durationS: null });
    expect(out.aggregate.session.todayEdits?.edited?.map((e) => [e.slotKey, e.kinds])).toEqual([
      [SLOT_INCLINE, ['sets']],
      [SLOT_RAISE, ['sets']],
    ]);
    expect(SessionAggregateSchema.safeParse(out.aggregate).success).toBe(true);
    // Fewer: from the end, at least one.
    expect(workingOf(plan([edit({ kind: 'sets', slotKey: SLOT_BENCH, workingSets: 1 })]), SLOT_BENCH)).toHaveLength(1);
  });

  it('TE-B4: reps 8–10 → 6–8 on incline changes every working set today; the bench’s warm-ups keep theirs; work time on a timed slot', () => {
    const out = plan([edit({ kind: 'reps', slotKey: SLOT_INCLINE, reps: { min: 6, max: 8 }, durationS: null }), edit({ kind: 'reps', slotKey: SLOT_BENCH, reps: { min: 3, max: 5 }, durationS: null })]);
    expect(workingOf(out, SLOT_INCLINE).map((s) => s.planned.reps)).toEqual([{ min: 6, max: 8 }, { min: 6, max: 8 }, { min: 6, max: 8 }]);
    expect(setsOf(out.aggregate, rowOf(out, SLOT_BENCH)?.id ?? '').filter((s) => s.setType === 'warmup').map((s) => s.planned.reps)).toEqual([
      { min: 5, max: 5 },
      { min: 3, max: 3 },
    ]);
    // The routine itself is untouched (rule 2).
    expect(pushA().exercises[1]?.setTemplates[0]?.targetReps).toEqual({ min: 8, max: 10 });
  });

  it('TE-B5: Ben’s 37.5 kg each at Hotel gym (rack to 20) plans 20 kg each; at Main gym it re-fits from the intended 37.5; back-off sets keep theirs', () => {
    const load = edit({ kind: 'load', slotKey: SLOT_INCLINE, load: kg(37.5, 'per_hand') });
    const hotel = plan([load], { gym: HOTEL_GYM });
    expect(workingOf(hotel, SLOT_INCLINE).map((s) => s.planned.load)).toEqual([kg(20, 'per_hand'), kg(20, 'per_hand'), kg(20, 'per_hand')]);
    // The intended value is kept on the set (the fit's record), so a gym switch re-fits from it.
    expect(workingOf(hotel, SLOT_INCLINE)[0]?.planned.snap?.intended).toEqual(kg(37.5, 'per_hand'));
    expect(todayLoadNote(kg(37.5, 'per_hand'), hotelRack)).toBe('Most here: 20 kg each');
    expect(todayLoadNote(kg(31, 'per_hand'), rack)).toBe('Rounds to 30 kg each here');
    expect(todayLoadNote(kg(30, 'per_hand'), rack)).toBeNull();
    const main = plan([load]);
    expect(workingOf(main, SLOT_INCLINE).map((s) => s.planned.load)).toEqual([kg(37.5, 'per_hand'), kg(37.5, 'per_hand'), kg(37.5, 'per_hand')]);
    // Ben's load claims no rule `Why?`.
    expect(workingOf(main, SLOT_INCLINE)[0]?.planned.source).toBeUndefined();

    // Top set + back-offs: the edit sets the top; back-offs keep theirs.
    const topBack = pushA({
      exercises: [
        routineExercise(600, {
          exerciseId: BENCH,
          equipmentId: bar.id,
          order: 0,
          setTemplates: [template(6003, { setType: 'top', targetLoad: kg(100), targetReps: { min: 3, max: 5 } }), template(6004, { setType: 'backoff', targetLoad: kg(85) }), template(6005, { setType: 'backoff', targetLoad: kg(85) })],
        }),
      ],
    });
    const tb = plan([edit({ kind: 'load', slotKey: SLOT_BENCH, load: kg(110) })], { r: topBack });
    expect(workingOf(tb, SLOT_BENCH).map((s) => [s.setType, s.planned.load?.value])).toEqual([
      ['top', 110],
      ['backoff', 85],
      ['backoff', 85],
    ]);
  });

  it('kg/lb: 37.5 kg each on an lb rack plans the nearest makeable lb load toward easier, never above', () => {
    const r = pushA({ exercises: [routineExercise(601, { exerciseId: INCLINE, equipmentId: rack.id, order: 0, setTemplates: [6011, 6012].map((n) => template(n, { targetLoad: kg(30, 'per_hand'), targetReps: { min: 8, max: 10 } })) })] });
    const out = plan([edit({ kind: 'load', slotKey: SLOT_INCLINE, load: kg(37.5, 'per_hand') })], { gym: LB_GYM, r });
    const l = workingOf(out, SLOT_INCLINE)[0]?.planned.load;
    expect(l?.unit).toBe('lb');
    expect(l?.convention).toBe('per_hand');
    // 37.5 kg = 82.7 lb: 80 lb (toward easier, on the rack's 5 lb steps).
    expect(l?.value).toBe(80);
  });

  it('assisted machine: Ben’s assistance is fitted toward easier (more assistance), within the machine', () => {
    const r = pushA({ exercises: [routineExercise(605, { exerciseId: PULLUP, equipmentId: assist.id, order: 0, setTemplates: [6051, 6052].map((n) => template(n, { targetLoad: kg(30, 'assistance') })) })] });
    const out = plan([edit({ kind: 'load', slotKey: SLOT_PULLUP, load: kg(31, 'assistance') })], { r });
    const l = workingOf(out, SLOT_PULLUP)[0]?.planned.load;
    expect(l?.convention).toBe('assistance');
    expect(l?.value ?? 0).toBeGreaterThanOrEqual(31);
  });

  it('TE-B6: Face pull is added at the end from its own history (never another exercise’s); with no history it has no load; stale when its plan is missing', () => {
    const add = edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL });
    const out = plan([add], { adds: facePullPlan() });
    const rows = rowsOf(out.aggregate);
    expect(rows.at(-1)?.exerciseName).toBe('Face pull');
    expect(out.slotOf[rows.at(-1)?.id ?? '']).toBe(NEW_SLOT);
    const fp = workingOf(out, NEW_SLOT);
    expect(fp).toHaveLength(3);
    expect(fp[0]?.planned.load?.convention).toBe('stack');
    expect(fp[0]?.planned.load?.value ?? 0).toBeGreaterThanOrEqual(20);
    expect(fp[0]?.planned.provenance?.basis?.sessionId).toBe(id(910));
    expect(out.aggregate.session.todayEdits?.added).toEqual([{ sessionExerciseId: rows.at(-1)?.id, slotKey: NEW_SLOT }]);
    // No history: the rule's range for it (isolation 8–12) and no load.
    const none = plan([add], { adds: new Map([[NEW_SLOT, addTargets(exOf(FACE_PULL), [], ctxAt(MAIN_GYM))]]) });
    expect(workingOf(none, NEW_SLOT).map((s) => [s.planned.load, s.planned.reps])).toEqual([
      [null, { min: 8, max: 12 }],
      [null, { min: 8, max: 12 }],
      [null, { min: 8, max: 12 }],
    ]);
    // The caller couldn't plan it (the exercise is gone): stale, nothing added.
    const missing = plan([add]);
    expect(rowsOf(missing.aggregate)).toHaveLength(5);
    expect(missing.outcomes.find((o) => o.editId === add.editId)?.result).toBe('stale');
    // Sets on an added slot apply to it.
    expect(workingOf(plan([add, edit({ kind: 'sets', slotKey: NEW_SLOT, workingSets: 2 })], { adds: facePullPlan() }), NEW_SLOT)).toHaveLength(2);
  });

  it('TE-B2: every mix of the new kinds with swap, skip and order plans one consistent session (deterministic; skipped stays skipped)', () => {
    const kinds = ['add', 'sets', 'reps', 'load', 'skip', 'order'] as const;
    for (let mask = 0; mask < 1 << kinds.length; mask += 1) {
      const edits: TodayEdit[] = [];
      const on = (k: (typeof kinds)[number]) => (mask & (1 << kinds.indexOf(k))) !== 0;
      if (on('add')) edits.push(edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL }));
      if (on('sets')) edits.push(edit({ kind: 'sets', slotKey: SLOT_RAISE, workingSets: 5 }));
      if (on('reps')) edits.push(edit({ kind: 'reps', slotKey: SLOT_PUSHDOWN, reps: { min: 8, max: 10 }, durationS: null }));
      if (on('load')) edits.push(edit({ kind: 'load', slotKey: SLOT_INCLINE, load: kg(27.5, 'per_hand') }));
      if (on('skip')) edits.push(edit({ kind: 'skip', slotKey: SLOT_FLY }));
      if (on('order')) edits.push(edit({ kind: 'order', slotKeys: moveSlot(SLOTS, SLOT_RAISE, 'first') ?? [] }));
      const a = plan(edits, { adds: facePullPlan() });
      const b = plan(edits, { adds: facePullPlan() });
      expect(a.aggregate).toEqual(b.aggregate);
      expect(SessionAggregateSchema.safeParse(a.aggregate).success).toBe(true);
      expect(rowsOf(a.aggregate)).toHaveLength(on('add') ? 6 : 5);
      expect(workingOf(a, SLOT_RAISE)).toHaveLength(on('sets') ? 5 : 3);
      expect(workingOf(a, SLOT_PUSHDOWN)[0]?.planned.reps).toEqual(on('reps') ? { min: 8, max: 10 } : { min: 10, max: 12 });
      expect(workingOf(a, SLOT_INCLINE)[0]?.planned.load).toEqual(on('load') ? kg(27.5, 'per_hand') : kg(30, 'per_hand'));
      expect(workingOf(a, SLOT_FLY).every((s) => s.status === (on('skip') ? 'skipped' : 'pending'))).toBe(true);
      if (on('order')) expect(rowsOf(a.aggregate)[0]?.exerciseName).toBe('Lateral raise');
      if (on('add')) expect(rowsOf(a.aggregate).at(-1)?.exerciseName).toBe('Face pull');
    }
  });

  it('the next session of a non-routine workout takes the same kinds (add at its place, sets, reps, load)', () => {
    const source = nextSource();
    const add = edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL });
    const roots = basisSlots({ kind: 'next', source });
    const benchRoot = roots[0]?.slotKey ?? '';
    const out = planWithTodayEdits(
      { kind: 'next', input: { opId: 'p', owner: profile(), gymId: MAIN, source, exercises: EXERCISES, gymEquipment: MAIN_EQ, at: at(0), newId: idGen(30_000) } },
      {
        draft: { id: id(5000), version: 1 },
        edits: [add, edit({ kind: 'order', slotKeys: [NEW_SLOT, ...roots.map((r) => r.slotKey)] }), edit({ kind: 'sets', slotKey: benchRoot, workingSets: 4 }), edit({ kind: 'load', slotKey: benchRoot, load: kg(102.5) })],
        swaps: new Map(),
        adds: facePullPlan(),
      },
    );
    const rows = rowsOf(out.aggregate);
    expect(rows.map((r) => r.exerciseName)).toEqual(['Face pull', 'Bench press']);
    expect(workingOf(out, benchRoot).map((s) => s.planned.load?.value)).toEqual([102.5, 102.5, 102.5, 102.5]);
    expect(out.plannedShape[benchRoot]?.workingSets).toBe(3);
    expect(SessionAggregateSchema.safeParse(out.aggregate).success).toBe(true);
  });
});

/** A finished Bench press workout (3 × 100 kg × 8) to start the next session from: a dry run, every set done as planned. */
function nextSource(): SessionAggregate {
  const r = pushA({ exercises: [pushA().exercises[0] as Routine['exercises'][number]] });
  const agg = plan([], { r }).aggregate;
  return SessionAggregateSchema.parse({
    ...agg,
    session: { ...agg.session, id: id(950), status: 'finished', startedAt: at(-86_400), routineId: null },
    sets: agg.sets.map((x) => ({ ...x, status: 'completed', actual: { load: x.planned.load, reps: x.planned.reps?.max ?? null, durationS: null, rpe: null, rir: null }, completedAt: at(-86_000), completedByOpId: `done-${x.id}` })),
  });
}

// ---------------------------------------------------------------------------

function overview(out: ReturnType<typeof plan>, over: Partial<OverviewToday> = {}) {
  const shapeEdits = new Map<string, RowShapeEdit>();
  const at_ = (k: string): RowShapeEdit => shapeEdits.get(k) ?? { sets: null, reps: null, load: null };
  for (const [k, v] of out.resolved.sets) shapeEdits.set(k, { ...at_(k), sets: v.editId });
  for (const [k, v] of out.resolved.reps) shapeEdits.set(k, { ...at_(k), reps: v.editId });
  for (const [k, v] of out.resolved.loads) shapeEdits.set(k, { ...at_(k), load: v.editId });
  return buildWorkoutOverview({
    aggregate: out.aggregate,
    fits: out.fits,
    pasts: {},
    painFlags: [],
    exerciseInfo: {},
    recent: [],
    nowMs: ms(0),
    tz: TZ,
    title: 'Push A',
    basis: { kind: 'only' },
    gym: { id: MAIN, name: 'Main gym' },
    key: { target: { kind: 'routine', routineId: id(300) }, routine: { id: id(300), version: 1 }, gym: { id: MAIN, equipment: [] }, source: null, painFlags: [], coachActions: [], unit: 'kg', checkIn: null, draft: { id: id(5000), version: 3 } },
    today: {
      slotOf: out.slotOf,
      slots: out.slots,
      swapped: new Map(),
      skipped: out.resolved.skipped,
      editCount: editCountOf(out.resolved),
      draft: { id: id(5000), version: 3 },
      routineName: 'Push A',
      added: new Map([...out.resolved.added].map(([k, v]) => [k, v.editId])),
      shapeEdits,
      plannedShape: out.plannedShape,
      benLoads: new Map([...out.resolved.loads].map(([k, v]) => [k, v.load])),
      ...over,
    },
  });
}

describe('Edit mode rows (§11.3)', () => {
  it('markers `＋ ADDED` and `✎ EDITED`; steppers step from the plan (back to it clears the edit), disabled at the limits; Ben’s load is tagged', () => {
    const out = plan([edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL }), edit({ kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 4 }), edit({ kind: 'load', slotKey: SLOT_PUSHDOWN, load: kg(27.5, 'stack') })], { adds: facePullPlan() });
    const view = overview(out);
    expect(view.editCount).toBe(3);
    const byName = (n: string) => view.rows.find((r) => r.name === n);
    expect(byName('Face pull')?.marker).toMatchObject({ kind: 'added', word: 'Added', glyph: 'add' });
    expect(byName('Face pull')?.actions).toMatchObject({ remove: true, swap: false, skip: false });
    expect(byName('Incline DB press')?.marker).toMatchObject({ kind: 'edited', word: 'Edited', glyph: 'edit' });
    const incline = byName('Incline DB press')?.editRow;
    expect(incline).toMatchObject({ workingSets: 4, setsDown: { workingSets: 3, clear: true }, setsUp: { workingSets: 5, clear: false } });
    expect(plain(incline?.repsText)).toBe('8–10 reps');
    expect(plain(incline?.loadText)).toBe('30 kg each');
    expect(incline?.accessibilityLabel).toBe('2, Incline DB press, edited, 4 sets, 8 to 10 reps, target 30 kilograms each');
    const pushdown = byName('Triceps pushdown')?.editRow;
    expect(pushdown).toMatchObject({ benLoad: true, intendedLoad: kg(27.5, 'stack') });
    // The cable goes in 5 kg steps: Ben's 27.5 is fitted toward easier (rule 4); his intended value is kept.
    expect(plain(pushdown?.loadText)).toBe('25 kg');
    expect(pushdown?.keypad).toMatchObject({ unit: 'kg', convention: 'stack', equipmentId: cable.id, value: 27.5 });
    const one = overview(plan([edit({ kind: 'sets', slotKey: SLOT_BENCH, workingSets: 1 })])).rows[0]?.editRow;
    expect(one?.setsDown).toBeNull();
    const ten = overview(plan([edit({ kind: 'sets', slotKey: SLOT_BENCH, workingSets: 10 })])).rows[0]?.editRow;
    expect(ten?.setsUp).toBeNull();
    // Markers precedence: SKIPPED wins over EDITED.
    const skipEdit = overview(plan([edit({ kind: 'sets', slotKey: SLOT_FLY, workingSets: 4 }), edit({ kind: 'skip', slotKey: SLOT_FLY })])).rows[4];
    expect(skipEdit?.marker.kind).toBe('skipped');
  });

  it('an added exercise with no history shows `—  No history`', () => {
    const out = plan([edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL })], { adds: new Map([[NEW_SLOT, addTargets(exOf(FACE_PULL), [], ctxAt(MAIN_GYM))]]) });
    const row = overview(out).rows.at(-1);
    expect(row?.editRow).toMatchObject({ loadText: null, noHistory: true });
  });
});

describe('Update Push A (§11.5, TE-B7, TE-B8)', () => {
  const names = (exerciseId: string) => EXERCISES.get(exerciseId)?.name ?? 'Exercise';
  const DB_PLAN: SwapPlan = { exercise: exOf(DB_BENCH), pin: null, plan: null };
  const fiveEdits = () => [
    edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH }),
    edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL }),
    edit({ kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 4 }),
    edit({ kind: 'order', slotKeys: moveSlot(SLOTS, SLOT_INCLINE, 'first') ?? [] }),
    edit({ kind: 'skip', slotKey: SLOT_FLY }),
    edit({ kind: 'load', slotKey: SLOT_PUSHDOWN, load: kg(27.5, 'stack') }),
  ];

  it('lists five lines (swap, add, sets, order, skip) with the skip unchecked; a typed load is never listed', () => {
    const out = plan(fiveEdits(), { adds: facePullPlan(), swaps: new Map([[SLOT_BENCH, DB_PLAN]]) });
    const lines = templateLinesFromEdits({ routine: pushA(), resolved: out.resolved, today: todayShapes(out.aggregate, out.slotOf), nameOf: names });
    // Face pull's reps come from its own history through the built-in rule (20 kg × 15, 15, 15). Since main's playbook 7-F
    // change (11 Oct: a next load over 10% heavier progresses reps instead), that history planned 12–15, not 8–12. Reps from
    // history (21 Oct): the range follows his 15 (12–15) and the stack's next step is still too big, so it holds at 15.
    expect(lines.map((l) => [l.label, plain(l.text), l.checked])).toEqual([
      ['Changed', 'Bench press', true],
      ['Added', 'Face pull · 3 × 15', true],
      ['Sets', 'Incline DB press 3 → 4', true],
      ['Order', 'Incline DB press first', true],
      ['Removed', 'Cable fly', false],
    ]);
    expect(plain(lines[0]?.detail)).toBe('→ DB bench press');
    expect(lines.some((l) => l.text.includes('27.5'))).toBe(false);
  });

  it('Apply writes v+1 with the checked lines (no skip): swapped and added exercises Auto; the routine keeps its name; idempotent and versioned', () => {
    const out = plan(fiveEdits(), { adds: facePullPlan(), swaps: new Map([[SLOT_BENCH, DB_PLAN]]) });
    const today = todayShapes(out.aggregate, out.slotOf);
    const current = pushA({ version: 3 });
    const lines = templateLinesFromEdits({ routine: current, resolved: out.resolved, today, nameOf: names }).filter((l) => l.checked);
    const c = applyEditsToRoutine({ current, lines, resolved: out.resolved, today, expectedVersion: 3, opId: 'upd-1', at: at(60), isCompound: () => false });
    if (c.kind !== 'write') throw new Error(c.kind);
    const r = c.next;
    expect(r.version).toBe(4);
    expect(r.name).toBe('Push A');
    expect(r.exercises.map((e) => names(e.exerciseId))).toEqual(['Incline DB press', 'DB bench press', 'Lateral raise', 'Triceps pushdown', 'Cable fly', 'Face pull']);
    const db = r.exercises.find((e) => e.exerciseId === DB_BENCH);
    expect(db?.setTemplates.every((t) => t.targetLoad === null)).toBe(true);
    expect(db?.equipmentId).toBeNull();
    const fp = r.exercises.find((e) => e.exerciseId === FACE_PULL);
    expect(fp?.id).toBe(NEW_SLOT);
    expect(fp?.setTemplates.map((t) => [t.targetLoad, t.targetReps])).toEqual([
      [null, { min: 15, max: 15 }],
      [null, { min: 15, max: 15 }],
      [null, { min: 15, max: 15 }],
    ]);
    expect(r.exercises.find((e) => e.id === SLOT_INCLINE)?.setTemplates.filter((t) => t.setType !== 'warmup')).toHaveLength(4);
    // Today's typed load never reaches the template (TE-B8).
    expect(r.exercises.find((e) => e.id === SLOT_PUSHDOWN)?.setTemplates.map((t) => t.targetLoad)).toEqual([kg(25, 'stack'), kg(25, 'stack'), kg(25, 'stack')]);
    // The superset stays one group.
    expect(r.exercises.filter((e) => e.supersetGroup !== null)).toHaveLength(2);
    // Retry and stale.
    expect(applyEditsToRoutine({ current: r, lines, resolved: out.resolved, today, expectedVersion: 3, opId: 'upd-1', at: at(61), isCompound: () => false }).kind).toBe('duplicate');
    expect(applyEditsToRoutine({ current: r, lines, resolved: out.resolved, today, expectedVersion: 3, opId: 'upd-2', at: at(61), isCompound: () => false }).kind).toBe('stale');
    // With the skip ticked too, Cable fly goes.
    const all = templateLinesFromEdits({ routine: current, resolved: out.resolved, today, nameOf: names });
    const removed = applyEditsToRoutine({ current, lines: all, resolved: out.resolved, today, expectedVersion: 3, opId: 'upd-3', at: at(60), isCompound: () => false });
    if (removed.kind !== 'write') throw new Error(removed.kind);
    expect(removed.next.exercises.map((e) => e.exerciseId)).not.toContain(FLY);
  });

  it('after Apply the plan matches: the applied edits resolve redundant or plan the same rows, so their markers go', () => {
    const out = plan(fiveEdits(), { adds: facePullPlan(), swaps: new Map([[SLOT_BENCH, DB_PLAN]]) });
    const today = todayShapes(out.aggregate, out.slotOf);
    const current = pushA();
    const lines = templateLinesFromEdits({ routine: current, resolved: out.resolved, today, nameOf: names }).filter((l) => l.checked);
    const c = applyEditsToRoutine({ current, lines, resolved: out.resolved, today, expectedVersion: 1, opId: 'upd-9', at: at(60), isCompound: () => false });
    if (c.kind !== 'write') throw new Error(c.kind);
    const applied = new Set(lines.flatMap((l) => l.editIds));
    const left = fiveEdits().filter((e) => e.kind === 'skip' || e.kind === 'load');
    expect(applied.size).toBe(4);
    const after = resolveTodayEdits(basisSlots({ kind: 'routine', routine: c.next }), left);
    expect(editCountOf(after)).toBe(2);
  });
});

describe('the Add exercise list (§11.4)', () => {
  it('not in today’s plan, doable here unless Show all, matching the search; recent first; flagged last', () => {
    const histories = new Map<string, HistorySession[]>([[FACE_PULL, FACE_PULL_HISTORY]]);
    const base = { exercises: [...EXERCISES.values()], excludeExerciseIds: new Set([BENCH, INCLINE, RAISE, PUSHDOWN, FLY]), query: '', gym: MAIN_GYM, showAll: false, histories, painFlags: [], nowMs: ms(0), tz: TZ };
    const list = rankAddCandidates(base).map((e) => e.name);
    expect(list[0]).toBe('Face pull');
    expect(list).not.toContain('Bench press');
    expect(rankAddCandidates({ ...base, query: 'pull' }).map((e) => e.name)).toEqual(['Face pull', 'Assisted pull-up']);
    // Hotel gym: dumbbells only (no cable, no bar).
    expect(rankAddCandidates({ ...base, gym: HOTEL_GYM }).map((e) => e.name)).toEqual(['DB bench press']);
    expect(rankAddCandidates({ ...base, gym: HOTEL_GYM, showAll: true }).map((e) => e.name)).toContain('Face pull');
  });
});

describe('shapeTemplates (pure)', () => {
  it('copies keep their source; fewer drop from the end; Ben’s load goes on top and plain working sets only', () => {
    const copied: [string, string][] = [];
    const own: string[] = [];
    const t = [template(1, { setType: 'warmup' }), template(2, { setType: 'top', targetLoad: kg(100) }), template(3, { setType: 'backoff', targetLoad: kg(85) })];
    const out = shapeTemplates(t, { workingSets: 3, load: kg(105) }, { newId: idGen(90_000), copied: (a, b) => copied.push([a, b]), ownLoad: (x) => own.push(x) });
    expect(out.map((x) => [x.setType, x.targetLoad?.value])).toEqual([
      ['warmup', undefined],
      ['top', 105],
      ['backoff', 85],
      ['backoff', 85],
    ]);
    expect(copied).toHaveLength(1);
    expect(own).toEqual([id(2)]);
    expect(shapeTemplates(t, { workingSets: 1 }, { newId: idGen(90_100) }).map((x) => x.setType)).toEqual(['warmup', 'top']);
    expect(lb(5).unit).toBe('lb');
  });
});

// ---------------------------------------------------------------------------
// Review B1, B2, S1 (slice B r1)

describe('review B1: Ben’s typed load belongs to the exercise it was typed for', () => {
  const DB_HISTORY = [history(920, 5, rack, kg(35, 'per_hand'), [8, 8, 8])];
  const slotShape = { workingSets: 3, templates: [0, 1, 2].map(() => ({ setType: 'working' as const, reps: { min: 6, max: 8 }, durationS: null })) };
  const dbPlan = (): Map<string, SwapPlan> => new Map([[SLOT_BENCH, substituteTargets(slotShape, exOf(DB_BENCH), DB_HISTORY, ctxAt(MAIN_GYM))]]);
  const benchLoads = (d: PreStartDraft) => {
    const out = plan(d.edits, { swaps: dbPlan() });
    const view = overview(out);
    return { out, row: view.rows.find((r) => r.slotKey === SLOT_BENCH), loads: workingOf(out, SLOT_BENCH).map((s) => s.planned.load) };
  };

  it('100 kg typed on Bench press, then a swap to DB bench press: the substitute plans its own 35 kg each, with no [Ben] tag; Undo swap brings the 100 kg back', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'load', slotKey: SLOT_BENCH, load: kg(100) } }, 'b1-load'));
    expect(liveEdits(d.edits)[0]).toMatchObject({ kind: 'load', exerciseId: BENCH });
    const swap = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'b1-swap'));
    d = swap;
    const swapped = benchLoads(d);
    expect(swapped.loads).toEqual([kg(35, 'per_hand'), kg(35, 'per_hand'), kg(35, 'per_hand')]);
    expect(swapped.row?.editRow).toMatchObject({ benLoad: false, intendedLoad: null, keypad: { unit: 'kg', convention: 'per_hand', value: 35 } });
    expect(swapped.out.resolved.loads.has(SLOT_BENCH)).toBe(false);
    // Waiting, not pruned: no outcome for it, so the next write keeps it.
    expect(pruneOf(swapped.out.outcomes)).toEqual([]);
    // Without the fix: [null, null, null] and the [Ben] tag.

    // `Undo swap` (clear_swap): Bench press and Ben's 100 kg again.
    const sw = liveEdits(d.edits).find((e) => e.kind === 'swap');
    d = written(write(d, { type: 'clear_swap', slotKey: SLOT_BENCH }, 'b1-unswap'));
    const back = benchLoads(d);
    expect(back.loads).toEqual([kg(100), kg(100), kg(100)]);
    expect(back.row?.editRow).toMatchObject({ benLoad: true, keypad: { convention: 'total', value: 100 } });
    // The toast's Undo of the swap does the same.
    const viaUndo = written(write(swap, { type: 'undo', editId: sw?.editId ?? '' }, 'b1-undo'));
    expect(benchLoads(viaUndo).loads).toEqual([kg(100), kg(100), kg(100)]);
  });

  it('a per-hand load typed on the substitute never lands on the barbell after Undo swap; both loads are kept, each for its own exercise', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'load', slotKey: SLOT_BENCH, load: kg(100) } }, 'b1b-1'));
    d = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'b1b-2'));
    d = written(write(d, { type: 'edit', edit: { kind: 'load', slotKey: SLOT_BENCH, load: kg(37.5, 'per_hand') } }, 'b1b-3'));
    // Two choices on one slot: the bench's isn't replaced by the DB bench's.
    expect(liveEdits(d.edits).flatMap((e) => (e.kind === 'load' ? [[e.exerciseId, e.load.value]] : []))).toEqual([
      [BENCH, 100],
      [DB_BENCH, 37.5],
    ]);
    expect(benchLoads(d).loads).toEqual([kg(37.5, 'per_hand'), kg(37.5, 'per_hand'), kg(37.5, 'per_hand')]);
    d = written(write(d, { type: 'clear_swap', slotKey: SLOT_BENCH }, 'b1b-4'));
    expect(benchLoads(d).loads).toEqual([kg(100), kg(100), kg(100)]);
    // `Use planned` clears the load of the exercise the slot holds now only.
    d = written(write(d, { type: 'clear', kind: 'load', slotKey: SLOT_BENCH }, 'b1b-5'));
    expect(liveEdits(d.edits).flatMap((e) => (e.kind === 'load' ? [e.exerciseId] : []))).toEqual([DB_BENCH]);
    expect(benchLoads(d).loads[0]?.convention).toBe('total');
    expect(benchLoads(d).row?.editRow.benLoad).toBe(false);
    // Swap again: his DB bench load is back with it.
    d = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'b1b-6'));
    expect(benchLoads(d).loads).toEqual([kg(37.5, 'per_hand'), kg(37.5, 'per_hand'), kg(37.5, 'per_hand')]);
    // A caller's exerciseId is never trusted: the draft stamps the slot's own.
    const forged = written(write(d, { type: 'edit', edit: { kind: 'load', slotKey: SLOT_BENCH, load: kg(40, 'per_hand'), exerciseId: BENCH } }, 'b1b-7'));
    expect(liveEdits(forged.edits).flatMap((e) => (e.kind === 'load' ? [[e.exerciseId, e.load.value]] : []))).toEqual([[DB_BENCH, 40]]);
  });

  it('a load edit from before `exerciseId` was recorded applies to the slot’s own exercise only', () => {
    const old = edit({ kind: 'load', slotKey: SLOT_BENCH, load: kg(100) });
    expect(old.kind === 'load' && old.exerciseId).toBe(undefined);
    expect(workingOf(plan([old]), SLOT_BENCH).map((s) => s.planned.load)).toEqual([kg(100), kg(100), kg(100)]);
    const swapped = plan([old, edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH })], { swaps: dbPlan() });
    expect(workingOf(swapped, SLOT_BENCH).map((s) => s.planned.load)).toEqual([kg(35, 'per_hand'), kg(35, 'per_hand'), kg(35, 'per_hand')]);
  });
});

describe('review r2 S1: a swap that can no longer be planned gives the slot back with Ben’s own load', () => {
  it('102.5 kg on Bench press, swap to DB bench press, then no plan for the substitute (no dumbbells here): Bench press plans 102.5 kg with the [Ben] tag, and preview equals Start', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'load', slotKey: SLOT_BENCH, load: kg(102.5) } }, 'r2s1-load'));
    d = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'r2s1-swap'));
    d = written(write(d, { type: 'edit', edit: { kind: 'load', slotKey: SLOT_BENCH, load: kg(37.5, 'per_hand') } }, 'r2s1-dbload'));
    // The caller couldn't build the substitute's plan: no swap plan.
    const out = plan(d.edits, { swaps: new Map() });
    expect(workingOf(out, SLOT_BENCH).map((s) => s.planned.load)).toEqual([kg(102.5), kg(102.5), kg(102.5)]);
    expect(out.resolved.loads.get(SLOT_BENCH)).toMatchObject({ load: kg(102.5), exerciseId: BENCH });
    expect(overview(out).rows.find((r) => r.slotKey === SLOT_BENCH)?.editRow).toMatchObject({ benLoad: true, keypad: { convention: 'total', value: 102.5 } });
    // The swap is pruned on the next write; the substitute's load waits (not pruned), Ben's bench load is applied.
    const loadIds = liveEdits(d.edits).flatMap((e) => (e.kind === 'load' ? [[e.exerciseId, e.editId]] : []));
    const prune = pruneOf(out.outcomes).map((p) => p.editId);
    expect(prune).toEqual([liveEdits(d.edits).find((e) => e.kind === 'swap')?.editId]);
    expect(out.outcomes.filter((o) => o.kind === 'load')).toEqual([{ editId: loadIds.find(([x]) => x === BENCH)?.[1], kind: 'load', result: 'applied' }]);
    // Without the fix: the routine's planned load and no [Ben] tag.
  });
});

describe('review B2: the keypad never relabels Ben’s number with another unit or convention', () => {
  it('37.5 kg each at an lb rack opens at the fitted 80 lb each, never 37.5 lb', () => {
    const r = pushA({ exercises: [routineExercise(601, { exerciseId: INCLINE, equipmentId: rack.id, order: 0, setTemplates: [6011, 6012].map((n) => template(n, { targetLoad: kg(30, 'per_hand'), targetReps: { min: 8, max: 10 } })) })] });
    const out = plan([edit({ kind: 'load', slotKey: SLOT_INCLINE, load: kg(37.5, 'per_hand') })], { gym: LB_GYM, r });
    const row = overview(out).rows[0]?.editRow;
    expect(plain(row?.loadText)).toBe('80 lb each');
    expect(row?.intendedLoad).toEqual(kg(37.5, 'per_hand'));
    // Without the fix: { unit: 'lb', value: 37.5 } (about 17 kg if saved as-is).
    expect(row?.keypad).toMatchObject({ unit: 'lb', convention: 'per_hand', value: 80 });
    // At a kg rack, his own number.
    const main = overview(plan([edit({ kind: 'load', slotKey: SLOT_INCLINE, load: kg(37.5, 'per_hand') })], { r })).rows[0]?.editRow;
    expect(main?.keypad).toMatchObject({ unit: 'kg', convention: 'per_hand', value: 37.5 });
  });
});

describe('review S2: steps from a count (the screen chains quick taps on the last write’s count)', () => {
  it('+ from 4 is 5; − back to the plan clears; the limits disable', () => {
    expect(setsStepFrom(4, 1, 3)).toEqual({ workingSets: 5, clear: false });
    expect(setsStepFrom(4, -1, 3)).toEqual({ workingSets: 3, clear: true });
    expect(setsStepFrom(1, -1, 3)).toBeNull();
    expect(setsStepFrom(10, 1, 3)).toBeNull();
  });
});

describe('review S1: a routine from before the library drops last time’s today-only set counts (TE-B13)', () => {
  const entry = (reps: number): NextTargetEntry => ({ setType: 'working', planned: { load: kg(12.5, 'per_hand'), reps: { min: reps, max: reps }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' } });
  const legacy = (): Routine => {
    const r = pushA();
    delete (r as { source?: unknown }).source;
    return r;
  };
  const edited = (kinds: ('sets' | 'reps' | 'load')[]) => ({ edited: [{ sessionExerciseId: id(8000), slotKey: SLOT_INCLINE, kinds }] });

  it('4 sets done on a 3-set slot after a today-only +: the next start plans 3; 2 after a today-only −: plans 3 again', () => {
    const four = new Map([[INCLINE, [entry(10), entry(10), entry(10), entry(9)]]]);
    expect(withoutTodayOnlySets(four, legacy(), edited(['sets'])).get(INCLINE)).toHaveLength(3);
    const two = new Map([[INCLINE, [entry(10), entry(9)]]]);
    const padded = withoutTodayOnlySets(two, legacy(), edited(['sets'])).get(INCLINE);
    expect(padded?.map((p) => p.planned.reps?.min)).toEqual([10, 9, 9]);
  });

  it('unchanged without a sets edit, for library workouts, and with no last edits', () => {
    const four = new Map([[INCLINE, [entry(10), entry(10), entry(10), entry(9)]]]);
    expect(withoutTodayOnlySets(four, legacy(), edited(['reps', 'load'])).get(INCLINE)).toHaveLength(4);
    expect(withoutTodayOnlySets(four, pushA(), edited(['sets'])).get(INCLINE)).toHaveLength(4);
    expect(withoutTodayOnlySets(four, legacy(), undefined).get(INCLINE)).toHaveLength(4);
  });
});

describe('review N2: a Sets or Reps line on a swapped slot names the workout’s own exercise', () => {
  it('Bench press 3 → 4, not DB bench press, since an unticked Changed line leaves the slot as Bench press', () => {
    const DB_PLAN: SwapPlan = { exercise: exOf(DB_BENCH), pin: null, plan: null };
    const out = plan([edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH }), edit({ kind: 'sets', slotKey: SLOT_BENCH, workingSets: 4 }), edit({ kind: 'reps', slotKey: SLOT_BENCH, reps: { min: 3, max: 5 }, durationS: null })], { swaps: new Map([[SLOT_BENCH, DB_PLAN]]) });
    const lines = templateLinesFromEdits({ routine: pushA(), resolved: out.resolved, today: todayShapes(out.aggregate, out.slotOf), nameOf: (x) => EXERCISES.get(x)?.name ?? 'Exercise' });
    expect(lines.map((l) => [l.label, plain(l.text)])).toEqual([
      ['Changed', 'Bench press'],
      ['Sets', 'Bench press 3 → 4'],
      ['Reps', 'Bench press 6–8 → 3–5'],
    ]);
  });
});

describe('add with a Sets count (exercise-library §10.2, TE-B15, EL-B21)', () => {
  it('an add carries the bar’s count: 4 working sets with history targets, untouched it is 3; a count outside 1–10 is refused', () => {
    const d = written(write(null, { type: 'edit', edit: { kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL, workingSets: 4 } }, 'b1'));
    expect(liveEdits(d.edits)).toMatchObject([{ kind: 'add', workingSets: 4 }]);
    const four = plan([edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL, workingSets: 4 })], { adds: facePullPlan() });
    expect(workingOf(four, NEW_SLOT)).toHaveLength(4);
    // Its own history's target on every set, the copies included (never another exercise's load).
    expect(workingOf(four, NEW_SLOT).every((s) => s.planned.load?.convention === 'stack' && s.status === 'pending')).toBe(true);
    const three = plan([edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL })], { adds: facePullPlan() });
    expect(workingOf(three, NEW_SLOT)).toHaveLength(3);
    const two = plan([edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL, workingSets: 2 })], { adds: facePullPlan() });
    expect(workingOf(two, NEW_SLOT)).toHaveLength(2);
    for (const n of [0, 11, 2.5]) expect(write(null, { type: 'edit', edit: { kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL, workingSets: n } }, `bad-${String(n)}`)).toEqual({ kind: 'invalid', reason: 'out_of_range' });
  });

  it('the next session of a non-routine workout takes the add’s count too', () => {
    const source = nextSource();
    const out = planWithTodayEdits(
      { kind: 'next', input: { opId: 'p', owner: profile(), gymId: MAIN, source, exercises: EXERCISES, gymEquipment: MAIN_EQ, at: at(0), newId: idGen(30_000) } },
      { draft: { id: id(5000), version: 1 }, edits: [edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL, workingSets: 5 })], swaps: new Map(), adds: facePullPlan() },
    );
    expect(workingOf(out, NEW_SLOT)).toHaveLength(5);
    expect(workingOf(out, NEW_SLOT).every((s) => s.planned.load?.convention === 'stack')).toBe(true);
    // The source workout's own exercise keeps its count.
    expect(workingOf(out, basisSlots({ kind: 'next', source })[0]?.slotKey ?? '')).toHaveLength(3);
  });

  it('with no history the default shape is resized (no load invented), and a later `sets` edit on the added row wins', () => {
    const none = new Map([[NEW_SLOT, addTargets(exOf(FACE_PULL), [], ctxAt(MAIN_GYM))]]);
    const five = plan([edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL, workingSets: 5 })], { adds: none });
    expect(workingOf(five, NEW_SLOT)).toHaveLength(5);
    expect(workingOf(five, NEW_SLOT).every((s) => s.planned.load === null)).toBe(true);
    const later = plan([edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL, workingSets: 5 }), edit({ kind: 'sets', slotKey: NEW_SLOT, workingSets: 2 })], { adds: none });
    expect(workingOf(later, NEW_SLOT)).toHaveLength(2);
    // The plan's own exercises are untouched by an add's count.
    expect(workingOf(five, SLOT_INCLINE)).toHaveLength(3);
  });
});

describe('the same exercise added again before Start (Ben, 19 Oct)', () => {
  it('each slot keeps its own targets: the plan’s incline keeps its 32.5 kg, the second copy plans from its own history', () => {
    const inclineHistory = [history(920, 3, rack, kg(20, 'per_hand'), [12, 12, 12])];
    const adds = new Map([[NEW_SLOT, addTargets(exOf(INCLINE), inclineHistory, ctxAt(MAIN_GYM))]]);
    const targets = new Map([[INCLINE, [1, 2, 3].map(() => ({ setType: 'working' as const, planned: { load: kg(32.5, 'per_hand'), reps: { min: 8, max: 10 }, durationS: null, rpe: null, rir: null } }))]]);
    // No Fixed load on the incline templates, so its targets decide.
    const r = pushA();
    const unpinned = { ...r, exercises: r.exercises.map((x) => (x.id === SLOT_INCLINE ? { ...x, setTemplates: x.setTemplates.map((t) => ({ ...t, targetLoad: null })) } : x)) };
    const out = planWithTodayEdits(
      { kind: 'routine', input: { opId: 'preview', owner: profile(), gymId: MAIN, gymName: 'Main gym', routine: unpinned, exercises: EXERCISES, gymEquipment: MAIN_EQ, knownEquipment: KNOWN, at: at(0), newId: idGen(20_000), targets } },
      { draft: { id: id(5000), version: 3 }, edits: [edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: INCLINE })], swaps: new Map(), adds },
    );
    expect(out.outcomes.map((o) => o.result)).toEqual(['applied']);
    expect(workingOf(out, SLOT_INCLINE).map((s) => s.planned.load?.value)).toEqual([32.5, 32.5, 32.5]);
    const copy = workingOf(out, NEW_SLOT);
    expect(copy.length).toBeGreaterThan(0);
    expect(copy.every((s) => s.planned.load?.value !== 32.5)).toBe(true);
    expect(rowsOf(out.aggregate).filter((e) => e.exerciseId === INCLINE)).toHaveLength(2);
  });
});

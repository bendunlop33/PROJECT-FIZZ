import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, Exercise, Load, PainFlag, PreStartDraft, Routine, SessionAggregate, TodayEdit, ZonedTimestamp } from '@fizz/schemas';
import { MAX_DRAFT_EDITS, PreStartDraftSchema, SessionAggregateSchema } from '@fizz/schemas';

import {
  applyDraftCommand,
  basisSlots,
  buildWorkoutOverview,
  draftIsLive,
  editCountOf,
  explainTarget,
  liveEdits,
  markDraftEdits,
  moveSlot,
  nextLocalMidnightUtc,
  pastExercisesOf,
  planWithTodayEdits,
  previewFence,
  previewKey,
  pruneOf,
  rankSubstitutions,
  resolveTodayEdits,
  slotMoves,
  substituteTargets,
  swapRoutineSlot,
  editedSlots,
  type DraftCommand,
  type HistorySession,
  type OverviewToday,
  type PastExercise,
  type SubstituteContext,
  type SwapPlan,
  type TodayPlanOutput,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, OWNER, profile, routine, routineExercise, stack, template, TZ } from './fixtures';

/**
 * Today's edits before Start (overview-today-edits.md, ADR 0022): the draft's
 * versioned, idempotent lifecycle and midnight expiry; resolving edits
 * against the plan; and `planWithTodayEdits`, the one path for the overview
 * and Start (TE-A2). Swap targets come from the substitute's own history,
 * fitted to this gym, never from the original's load (TE-A5).
 */

const NB = ' ';
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NB, ' ');

// ---------------------------------------------------------------------------
// Fixture: Push A at Main gym (spec §7)

const BENCH = id(210);
const INCLINE = id(211);
const FLY = id(212);
const RAISE = id(213);
const PUSHDOWN = id(214);
const DB_BENCH = id(220);
const CHEST_PRESS = id(221);
const PUSHUP = id(222);
const PULLUP = id(223);
const PULLDOWN = id(224);

const ex = (n: number, name: string, over: Partial<Exercise>) => exercise(n, name, over);
const EXERCISES = new Map<string, Exercise>([
  [BENCH, ex(210, 'Bench press', { primaryMuscles: ['chest'], family: 'bench_press', catalogueKey: 'barbell-bench-press' })],
  [INCLINE, ex(211, 'Incline DB press', { primaryMuscles: ['upper_chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', family: 'bench_press', catalogueKey: 'incline-dumbbell-press' })],
  [FLY, ex(212, 'Cable fly', { primaryMuscles: ['chest'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', catalogueKey: 'cable-fly' })],
  [RAISE, ex(213, 'Lateral raise', { primaryMuscles: ['side_delts'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [PUSHDOWN, ex(214, 'Triceps pushdown', { primaryMuscles: ['triceps'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' })],
  [DB_BENCH, ex(220, 'DB bench press', { primaryMuscles: ['chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', family: 'bench_press', catalogueKey: 'dumbbell-bench-press' })],
  [CHEST_PRESS, ex(221, 'Chest press machine', { primaryMuscles: ['chest'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', family: 'bench_press', catalogueKey: 'machine-chest-press' })],
  [PUSHUP, ex(222, 'Push-up', { primaryMuscles: ['chest'], compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', family: 'bench_press', catalogueKey: 'push-up' })],
  [PULLUP, ex(223, 'Assisted pull-up', { primaryMuscles: ['lats'], compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', family: 'vertical_pull' })],
  [PULLDOWN, ex(224, 'Lat pulldown', { primaryMuscles: ['lats'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', family: 'vertical_pull' })],
]);
const exOf = (exerciseId: string): Exercise => {
  const e = EXERCISES.get(exerciseId);
  if (!e) throw new Error('no exercise');
  return e;
};
/** The bench's catalogue substitutions, in catalogue order (one has no entry). */
const BENCH_SUBS = ['dumbbell-bench-press', 'machine-chest-press', 'push-up', 'smith-machine-bench-press', 'incline-dumbbell-press'];

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
const HOTEL_EQ: EquipmentInstance[] = [hotelRack];
const lbRack = dumbbells({ id: id(711), gymId: HOTEL, name: 'Imperial dumbbells', unit: 'lb', loads: steps(5, 100, 5) });
const KNOWN = new Map([...MAIN_EQ, ...HOTEL_EQ, lbRack].map((e) => [e.id, e]));

const SLOT_BENCH = id(600);
const SLOT_INCLINE = id(601);
const SLOT_RAISE = id(602);
const SLOT_PUSHDOWN = id(603);
const SLOT_FLY = id(604);

function pushA(): Routine {
  return routine([
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
  ]);
}

/** One finished appearance of an exercise, as `listExerciseHistory` gives it. */
function history(sessionN: number, daysAgo: number, equipment: EquipmentInstance | null, load: Load | null, reps: number[], over: Partial<HistorySession> = {}): HistorySession {
  return {
    sessionId: id(sessionN),
    performedAtUtc: at(-daysAgo * 86_400).utc,
    equipmentId: equipment?.id ?? null,
    gymId: equipment?.gymId ?? MAIN,
    imported: false,
    sets: reps.map((r) => ({ setType: 'working' as const, side: null, load, reps: r, rpe: null, rir: null })),
    tz: TZ,
    ...over,
  };
}

/** DB bench last done 21 days ago at 32.5 kg each × 8, 8, 7 (the fixture's "17 Sep"). */
const DB_BENCH_HISTORY = [history(900, 21, rack, kg(32.5, 'per_hand'), [8, 8, 7])];

function ctxAt(gym: { id: string; name: string; equipment: readonly EquipmentInstance[] }, over: Partial<SubstituteContext> = {}): SubstituteContext {
  return { ownerId: OWNER, unit: 'kg', gym, knownEquipment: KNOWN, painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(0), ...over };
}
const MAIN_GYM = { id: MAIN, name: 'Main gym', equipment: MAIN_EQ };
const HOTEL_GYM = { id: HOTEL, name: 'Hotel gym', equipment: HOTEL_EQ };

const benchSlot = { workingSets: 3, templates: [{ setType: 'working' as const, reps: { min: 6, max: 8 }, durationS: null }, { setType: 'working' as const, reps: { min: 6, max: 8 }, durationS: null }, { setType: 'working' as const, reps: { min: 6, max: 8 }, durationS: null }] };

function plan(edits: readonly TodayEdit[], opts: { gym?: typeof MAIN_GYM; swaps?: Map<string, SwapPlan>; draft?: { id: string; version: number } | null; r?: Routine } = {}): Extract<TodayPlanOutput, { kind: 'routine' }> {
  const gym = opts.gym ?? MAIN_GYM;
  return planWithTodayEdits(
    {
      kind: 'routine',
      input: { opId: 'preview', owner: profile(), gymId: gym.id, gymName: gym.name, routine: opts.r ?? pushA(), exercises: EXERCISES, gymEquipment: gym.equipment, knownEquipment: KNOWN, at: at(0), newId: idGen(20_000) },
    },
    { draft: opts.draft === undefined ? { id: id(5000), version: 3 } : opts.draft, edits, swaps: opts.swaps ?? new Map() },
  );
}

let editN = 0;
function edit(body: { kind: 'swap'; slotKey: string; toExerciseId: string } | { kind: 'skip'; slotKey: string } | { kind: 'order'; slotKeys: string[] }): TodayEdit {
  editN += 1;
  return { ...body, editId: id(7000 + editN), opId: `op-${String(editN)}`, atUtc: at(0).utc, replacesEditId: null, removed: null };
}

const rowsOf = (agg: SessionAggregate) => [...agg.exercises].sort((a, b) => a.order - b.order);
const setsOf = (agg: SessionAggregate, sessionExerciseId: string) => agg.sets.filter((s) => s.sessionExerciseId === sessionExerciseId).sort((a, b) => a.index - b.index);

// ---------------------------------------------------------------------------
// Lifecycle

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

describe('the pre-start draft: versioned, idempotent, expires at local midnight (TE5, rule 5)', () => {
  it('the first edit creates it at version 1; each write bumps the version and moves the expiry to the next local midnight', () => {
    const d1 = written(write(null, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_FLY } }, 'op-a'));
    expect(d1).toMatchObject({ id: id(5000), version: 1, status: 'open', sessionId: null, tz: TZ, opIds: ['op-a'] });
    // T0 is 19:00 in Auckland (06:00 UTC, NZDT +13): midnight there is 11:00 UTC.
    expect(d1.expiresAtUtc).toBe('2026-10-08T11:00:00.000Z');
    expect(nextLocalMidnightUtc('2026-10-08T06:00:00.000Z', 'Europe/London')).toBe('2026-10-08T23:00:00.000Z');
    expect(draftIsLive(d1, '2026-10-08T10:59:59.000Z')).toBe(true);
    expect(draftIsLive(d1, '2026-10-08T11:00:00.000Z')).toBe(false);
    const d2 = written(write(d1, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'op-b', { utc: '2026-10-08T10:30:00.000Z', tz: 'Europe/London' }));
    expect(d2.version).toBe(2);
    // The latest write's time zone decides the day.
    expect(d2.tz).toBe('Europe/London');
    expect(d2.expiresAtUtc).toBe('2026-10-08T23:00:00.000Z');
    expect(liveEdits(d2.edits).map((e) => e.kind)).toEqual(['skip', 'swap']);
  });

  it('a repeated opId is a duplicate (no second edit); a stale version writes nothing', () => {
    const d1 = written(write(null, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_FLY } }, 'op-a'));
    expect(write(d1, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_FLY } }, 'op-a')).toMatchObject({ kind: 'duplicate' });
    expect(write(d1, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_INCLINE } }, 'op-c', at(0), 7)).toMatchObject({ kind: 'stale' });
    // Someone created the draft since the page read none.
    expect(write(d1, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_INCLINE } }, 'op-d', at(0), null)).toMatchObject({ kind: 'stale' });
    expect(write(null, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_INCLINE } }, 'op-e', at(0), 1)).toMatchObject({ kind: 'stale' });
  });

  it('Undo of each edit: a swap brings back the swap it replaced; a skip is brought back; Reset and its Undo', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'op-1'));
    d = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: CHEST_PRESS } }, 'op-2'));
    const second = liveEdits(d.edits)[0];
    expect(second).toMatchObject({ kind: 'swap', toExerciseId: CHEST_PRESS });
    expect(d.edits.filter((e) => e.removed?.why === 'replaced')).toHaveLength(1);
    // Undo swap: back to DB bench, then back to the plan.
    d = written(write(d, { type: 'undo', editId: second?.editId ?? '' }, 'op-3'));
    const back = liveEdits(d.edits);
    expect(back).toMatchObject([{ kind: 'swap', toExerciseId: DB_BENCH, replacesEditId: null }]);
    d = written(write(d, { type: 'undo', editId: back[0]?.editId ?? '' }, 'op-4'));
    expect(liveEdits(d.edits)).toEqual([]);
    // Edits are never deleted.
    expect(d.edits.length).toBe(3);

    d = written(write(d, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_FLY } }, 'op-5'));
    const skip = liveEdits(d.edits)[0];
    d = written(write(d, { type: 'undo', editId: skip?.editId ?? '' }, 'op-6'));
    expect(liveEdits(d.edits)).toEqual([]);
    expect(write(d, { type: 'undo', editId: skip?.editId ?? '' }, 'op-7')).toMatchObject({ kind: 'unchanged' });

    d = written(write(d, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_FLY } }, 'op-8'));
    d = written(write(d, { type: 'edit', edit: { kind: 'order', slotKeys: [SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY] } }, 'op-9'));
    const reset = write(d, { type: 'reset' }, 'op-10');
    if (reset.kind !== 'write') throw new Error('reset');
    expect(reset.removed).toHaveLength(2);
    d = reset.next;
    expect(liveEdits(d.edits)).toEqual([]);
    expect(d.status).toBe('open');
    d = written(write(d, { type: 'restore', editIds: reset.removed }, 'op-11'));
    expect(liveEdits(d.edits).map((e) => e.kind).sort()).toEqual(['order', 'skip']);
  });

  it('refuses a skip of the last exercise left, an order that splits a superset, and an edit to a slot that is gone', () => {
    let d: PreStartDraft | null = null;
    for (const [i, slot] of [SLOT_BENCH, SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN].entries()) d = written(write(d, { type: 'edit', edit: { kind: 'skip', slotKey: slot } }, `skip-${String(i)}`));
    expect(write(d, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_FLY } }, 'skip-last')).toEqual({ kind: 'invalid', reason: 'last_exercise' });
    expect(write(null, { type: 'edit', edit: { kind: 'order', slotKeys: [SLOT_RAISE, SLOT_BENCH, SLOT_PUSHDOWN, SLOT_INCLINE, SLOT_FLY] } }, 'split')).toEqual({ kind: 'invalid', reason: 'bad_order' });
    expect(write(null, { type: 'edit', edit: { kind: 'skip', slotKey: id(999) } }, 'gone')).toEqual({ kind: 'invalid', reason: 'slot_gone' });
    // The plan's own order is no edit.
    expect(write(null, { type: 'edit', edit: { kind: 'order', slotKeys: SLOTS.map((s) => s.slotKey) } }, 'same')).toMatchObject({ kind: 'unchanged' });
  });

  it('only live edits count toward the cap: a long run of moves never locks the draft; removed ones are compacted oldest first (review N2)', () => {
    const a = [SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY];
    const b = [SLOT_BENCH, SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY];
    let d = written(write(null, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_FLY } }, 'cap-skip'));
    const skipId = liveEdits(d.edits)[0]?.editId;
    for (let i = 0; i < MAX_DRAFT_EDITS + 50; i += 1) d = written(write(d, { type: 'edit', edit: { kind: 'order', slotKeys: i % 2 === 0 ? a : b } }, `cap-${String(i)}`));
    expect(d.edits.length).toBe(MAX_DRAFT_EDITS);
    // The live skip (the oldest edit) and the live order are kept; the oldest removed orders went.
    expect(liveEdits(d.edits).map((e) => e.kind)).toEqual(['skip', 'order']);
    expect(d.edits[0]?.editId).toBe(skipId);
    // Still writable, and the toast Undo still steps back one order.
    const live = liveEdits(d.edits).find((e) => e.kind === 'order');
    d = written(write(d, { type: 'undo', editId: live?.editId ?? '' }, 'cap-undo'));
    expect(liveEdits(d.edits).find((e) => e.kind === 'order')).toMatchObject({ slotKeys: (MAX_DRAFT_EDITS + 50) % 2 === 0 ? a : b });
    d = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'cap-swap'));
    expect(d.edits.length).toBe(MAX_DRAFT_EDITS);
  });

  it('Reset order removes only the order; marking an edit redundant is one versioned write', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'order', slotKeys: [SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY] } }, 'o1'));
    d = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'o2'));
    d = written(write(d, { type: 'clear_order' }, 'o3'));
    expect(liveEdits(d.edits).map((e) => e.kind)).toEqual(['swap']);
    const swap = liveEdits(d.edits)[0];
    const marked = markDraftEdits(d, [swap?.editId ?? ''], 'redundant', 'apply-1', at(60));
    expect(marked?.version).toBe(d.version + 1);
    expect(marked?.edits.find((e) => e.editId === swap?.editId)?.removed?.why).toBe('redundant');
    expect(marked === null ? null : markDraftEdits(marked, [swap?.editId ?? ''], 'redundant', 'apply-1', at(60))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Resolving and moving

describe('resolving edits against today’s plan', () => {
  it('a slot that is gone makes its edits stale; a swap to the slot’s own exercise is redundant; one order counts once', () => {
    const swap = edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH });
    const skip = edit({ kind: 'skip', slotKey: SLOT_FLY });
    const order = edit({ kind: 'order', slotKeys: [SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY] });
    const r = resolveTodayEdits(SLOTS, [swap, skip, order]);
    expect(r.outcomes.map((o) => o.result)).toEqual(['applied', 'applied', 'applied']);
    expect(editCountOf(r)).toBe(3);
    // Cable fly removed from the routine: the skip and the order are stale (TE-A12).
    const without = SLOTS.filter((s) => s.slotKey !== SLOT_FLY);
    const r2 = resolveTodayEdits(without, [swap, skip, order]);
    expect(r2.outcomes.map((o) => [o.kind, o.result])).toEqual([
      ['swap', 'applied'],
      ['skip', 'stale'],
      ['order', 'stale'],
    ]);
    expect(pruneOf(r2.outcomes)).toEqual([
      { editId: skip.editId, why: 'stale' },
      { editId: order.editId, why: 'stale' },
    ]);
    // The template now has DB bench in that slot: the swap is redundant.
    const r3 = resolveTodayEdits(SLOTS.map((s) => (s.slotKey === SLOT_BENCH ? { ...s, exerciseId: DB_BENCH } : s)), [swap]);
    expect(r3.outcomes[0]?.result).toBe('redundant');
    expect(r3.swaps.size).toBe(0);
  });

  it('Do first and ↑ / ↓ move a superset as one; the ends can’t move further', () => {
    expect(moveSlot(SLOTS, SLOT_INCLINE, 'first')).toEqual([SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY]);
    expect(moveSlot(SLOTS, SLOT_PUSHDOWN, 'first')).toEqual([SLOT_RAISE, SLOT_PUSHDOWN, SLOT_BENCH, SLOT_INCLINE, SLOT_FLY]);
    expect(moveSlot(SLOTS, SLOT_RAISE, 'down')).toEqual([SLOT_BENCH, SLOT_INCLINE, SLOT_FLY, SLOT_RAISE, SLOT_PUSHDOWN]);
    expect(moveSlot(SLOTS, SLOT_BENCH, 'up')).toBeNull();
    expect(moveSlot(SLOTS, SLOT_FLY, 'down')).toBeNull();
    expect(slotMoves(SLOTS, SLOT_BENCH)).toEqual({ first: false, up: false, down: true });
    expect(slotMoves(SLOTS, SLOT_PUSHDOWN)).toEqual({ first: true, up: true, down: true });
  });
});

// ---------------------------------------------------------------------------
// Swap targets

describe('substituteTargets and rankSubstitutions (TE6, TE-A4, TE-A5)', () => {
  const histories = new Map<string, HistorySession[]>([
    [DB_BENCH, DB_BENCH_HISTORY],
    [PUSHUP, [history(901, 7, null, null, [15, 14, 12])]],
    [INCLINE, [history(902, 4, rack, kg(30, 'per_hand'), [9, 9, 9])]],
    [BENCH, [history(903, 4, bar, kg(100), [8, 8, 8])]],
  ]);
  const rank = (over: Partial<Parameters<typeof rankSubstitutions>[0]> = {}) =>
    rankSubstitutions({
      ...ctxAt(MAIN_GYM),
      slotExercise: exOf(BENCH),
      slot: benchSlot,
      exercises: [...EXERCISES.values()],
      catalogueSubstitutions: BENCH_SUBS,
      excludeExerciseIds: new Set([BENCH, RAISE, PUSHDOWN, FLY]),
      histories,
      nowMs: ms(0),
      ...over,
    });

  it('DB bench from its own history (32.5 kg each), never from bench’s 100 kg; no history reads `No history` with no load', () => {
    const p = substituteTargets(benchSlot, exOf(DB_BENCH), DB_BENCH_HISTORY, ctxAt(MAIN_GYM));
    expect(p.pin?.id).toBe(rack.id);
    expect(p.plan?.map((s) => s.planned.load)).toEqual([kg(32.5, 'per_hand'), kg(32.5, 'per_hand'), kg(32.5, 'per_hand')]);
    expect(p.plan?.[0]?.planned.source).toBe('built_in_rule');
    expect(p.plan?.[0]?.planned.provenance?.source).toBe('rule');
    const none = substituteTargets(benchSlot, exOf(CHEST_PRESS), [], ctxAt(MAIN_GYM));
    expect(none).toMatchObject({ pin: null, plan: null });
    // B7: FitNotes history (no item recorded) is planned on the item this gym maps the exercise to, and fitted there.
    const fromFitNotes = substituteTargets(benchSlot, exOf(DB_BENCH), [{ ...(DB_BENCH_HISTORY[0] as HistorySession), imported: true, equipmentId: null, gymId: null }], ctxAt(MAIN_GYM));
    expect(fromFitNotes.pin?.id).toBe(rack.id);
    expect(fromFitNotes.plan?.map((s) => s.planned.load)).toEqual([kg(32.5, 'per_hand'), kg(32.5, 'per_hand'), kg(32.5, 'per_hand')]);
    // At the hotel (dumbbells to 20 kg each) the same FitNotes history never plans above the rack's max (rule 4).
    const hotel = substituteTargets(benchSlot, exOf(DB_BENCH), [{ ...(DB_BENCH_HISTORY[0] as HistorySession), imported: true, equipmentId: null, gymId: null }], ctxAt(HOTEL_GYM));
    expect(hotel.plan?.every((s) => s.planned.load !== null && s.planned.load.value <= 20)).toBe(true);
  });

  it('catalogue order, then family by recency; only what this gym can do, never in today’s plan (skipped included); unresolved keys left out', () => {
    const rows = rank();
    expect(rows.map((r) => r.name)).toEqual(['DB bench press', 'Chest press machine', 'Push-up', 'Incline DB press']);
    // The built-in rule's own rep range for each (the slot's set count); a substitute with no history keeps the slot's sets and reps.
    // Reps from history (21 Oct): push-ups (15, 14, 12; bodyweight) follow his reps, 11–14, not the rule's capped 10–12.
    expect(rows.map((r) => plain(r.targetText))).toEqual(['32.5 kg each × 6–10', '— × 6–8', 'BW × 11–14', '30 kg each × 6–10']);
    expect(rows.map((r) => r.equipmentWord)).toEqual(['Dumbbells', 'Stack', 'Bodyweight', 'Dumbbells']);
    expect(plain(rows[0]?.lastText)).toMatch(/^last 32\.5 × 8 · 17 Sep$/);
    expect(rows[1]?.lastText).toBe('No history');
    expect(rows[0]?.accessibilityLabel).toContain('DB bench press, dumbbells, last 32.5 kilograms each for 8, target 32.5 kilograms each, 6 to 10 reps');
    // Incline is in today's plan: never offered.
    expect(rank({ excludeExerciseIds: new Set([BENCH, INCLINE]) }).map((r) => r.name)).not.toContain('Incline DB press');
    // Hotel gym (dumbbells only): nothing needing a barbell or a cable (TE-A4).
    const hotel = rank({ ...ctxAt(HOTEL_GYM) });
    expect(hotel.map((r) => r.name)).toEqual(['DB bench press', 'Push-up', 'Incline DB press']);
    // TE-A11: DB bench re-fits to the hotel rack, capped at 20 kg each (never above its max).
    expect(plain(hotel[0]?.targetText)).toBe('20 kg each × 6–10');
  });

  it('pain-flagged candidates are kept, marked `May hurt`, and listed last; at most 8', () => {
    const flag: PainFlag = {
      id: id(77),
      ownerId: OWNER,
      version: 1,
      createdAtUtc: at(-86_400).utc,
      updatedAtUtc: at(-86_400).utc,
      exerciseId: DB_BENCH,
      exerciseName: 'DB bench press',
      area: 'shoulder',
      source: 'workout',
      checkInId: null,
      reportedAt: at(-86_400),
      status: 'active',
      clearedAtUtc: null,
      createdByOpId: 'op-pain',
    };
    const rows = rank({ painFlags: [flag] });
    expect(rows.at(-1)?.name).toBe('DB bench press');
    expect(rows.at(-1)?.mayHurt).toMatchObject({ flagId: id(77), confirm: { title: 'DB bench press may hurt', confirm: 'Add anyway', cancel: 'Choose another' } });
    expect(rows.at(-1)?.mayHurt?.confirm.message).toMatch(/^Shoulder pain flagged /);
    expect(rows.slice(0, -1).every((r) => r.mayHurt === null)).toBe(true);
    // The rule holds a pain-flagged exercise's load (rule 9): never harder than last time.
    expect(plain(rows.at(-1)?.targetText)).toBe('32.5 kg each × 6–10');
    const many = [...Array(12).keys()].map((i) => ex(400 + i, `Press ${String(i)}`, { family: 'bench_press', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' }));
    expect(rank({ exercises: [...EXERCISES.values(), ...many] })).toHaveLength(8);
  });

  it('B5: pain on the exercise being swapped holds the substitute today; without it the same history goes up', () => {
    // 30 kg each × 10, 10, 10: the top of 6–10, so the rule would go up.
    const ready = [history(905, 7, rack, kg(30, 'per_hand'), [10, 10, 10])];
    const free = substituteTargets(benchSlot, exOf(DB_BENCH), ready, ctxAt(MAIN_GYM));
    expect(free.plan?.[0]?.planned.load).toEqual(kg(32.5, 'per_hand'));
    const held = substituteTargets(benchSlot, exOf(DB_BENCH), ready, ctxAt(MAIN_GYM, { sessionPain: { active: true, reportedAtUtc: at(-60).utc } }));
    expect(held.plan?.map((x) => x.planned.load)).toEqual([kg(30, 'per_hand'), kg(30, 'per_hand'), kg(30, 'per_hand')]);
    // Reps aren't pushed past last time either: the range stays, nothing is added.
    expect(held.plan?.[0]?.planned.reps?.max).toBeLessThanOrEqual(10);
    expect(held.plan).toHaveLength(3);
    const rows = rank({ histories: new Map([...histories, [DB_BENCH, ready]]), sessionPain: { active: true, reportedAtUtc: at(-60).utc } });
    expect(plain(rows.find((r) => r.exerciseId === DB_BENCH)?.targetText)).toBe('30 kg each × 6–10');
  });

  it('Swap again lists the planned exercise first as `planned`, with the plan’s own target', () => {
    const rows = rank({ excludeExerciseIds: new Set([DB_BENCH, RAISE, PUSHDOWN, FLY, INCLINE]), planned: { targetText: `102.5${NB}kg × 6–8`, spoken: 'target 102.5 kilograms, 6 to 8 reps' } });
    expect(rows[0]).toMatchObject({ name: 'Bench press', planned: true, targetText: `102.5${NB}kg × 6–8` });
    expect(rows[0]?.accessibilityLabel).toMatch(/^Bench press, planned, barbell, .*target 102\.5 kilograms, 6 to 8 reps$/);
  });
});

// ---------------------------------------------------------------------------
// planWithTodayEdits: the one path for the overview and Start

function swapsFor(gym: typeof MAIN_GYM, pairs: [string, string, HistorySession[]][]): Map<string, SwapPlan> {
  return new Map(pairs.map(([slot, exerciseId, h]) => [slot, substituteTargets(benchSlot, exOf(exerciseId), h, ctxAt(gym))]));
}

describe('planWithTodayEdits (TE2, TE-A2, TE-A3, TE-A8)', () => {
  it('no edits: the same plan as before, and every row’s slot key', () => {
    const out = plan([], { draft: null });
    expect(rowsOf(out.aggregate).map((e) => e.exerciseName)).toEqual(['Bench press', 'Incline DB press', 'Lateral raise', 'Triceps pushdown', 'Cable fly']);
    expect(rowsOf(out.aggregate).map((e) => out.slotOf[e.id])).toEqual([SLOT_BENCH, SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY]);
    expect(out.aggregate.session.todayEdits).toBeUndefined();
    expect(SessionAggregateSchema.safeParse(out.aggregate).success).toBe(true);
  });

  it('skip: sets stay as skipped before start; Start opens on the first pending set; a superset left with one member loses its bracket', () => {
    const out = plan([edit({ kind: 'skip', slotKey: SLOT_FLY }), edit({ kind: 'skip', slotKey: SLOT_PUSHDOWN })]);
    const fly = rowsOf(out.aggregate)[4];
    const flySets = setsOf(out.aggregate, fly?.id ?? '');
    expect(flySets.map((s) => [s.status, s.skippedBy])).toEqual([
      ['skipped', 'before_start'],
      ['skipped', 'before_start'],
      ['skipped', 'before_start'],
    ]);
    expect(rowsOf(out.aggregate).map((e) => e.supersetGroup)).toEqual([null, null, null, null, null]);
    expect(out.aggregate.session.activeSetId).toBe(setsOf(out.aggregate, rowsOf(out.aggregate)[0]?.id ?? '')[0]?.id);
    expect(out.aggregate.session.todayEdits).toMatchObject({ draftId: id(5000), draftVersion: 3, reordered: false, swapped: [] });
    expect(out.aggregate.session.todayEdits?.skipped.map((s) => s.slotKey).sort()).toEqual([SLOT_PUSHDOWN, SLOT_FLY].sort());
    expect(SessionAggregateSchema.safeParse(out.aggregate).success).toBe(true);
    // Skipping one of two keeps no bracket; skipping one of three would keep it.
    const raiseOnly = plan([edit({ kind: 'skip', slotKey: SLOT_FLY })]);
    expect(rowsOf(raiseOnly.aggregate).map((e) => e.supersetGroup)).toEqual([null, null, 'A', 'A', null]);
  });

  it('Do first: the edited order is the session’s; Start opens Ready on incline set 1; a superset moves as one', () => {
    const order = moveSlot(SLOTS, SLOT_INCLINE, 'first') ?? [];
    const out = plan([edit({ kind: 'order', slotKeys: order })]);
    expect(rowsOf(out.aggregate).map((e) => e.exerciseName)).toEqual(['Incline DB press', 'Bench press', 'Lateral raise', 'Triceps pushdown', 'Cable fly']);
    expect(out.aggregate.session.activeSetId).toBe(setsOf(out.aggregate, rowsOf(out.aggregate)[0]?.id ?? '')[0]?.id);
    expect(out.aggregate.session.todayEdits?.reordered).toBe(true);
    const group = plan([edit({ kind: 'order', slotKeys: moveSlot(SLOTS, SLOT_RAISE, 'first') ?? [] })]);
    expect(rowsOf(group.aggregate).map((e) => e.exerciseName).slice(0, 2)).toEqual(['Lateral raise', 'Triceps pushdown']);
  });

  it('swap: the substitute with its own target on this gym’s item, no warm-ups, never a load from the original', () => {
    const swaps = swapsFor(MAIN_GYM, [[SLOT_BENCH, DB_BENCH, DB_BENCH_HISTORY]]);
    const out = plan([edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH })], { swaps });
    const row = rowsOf(out.aggregate)[0];
    expect(row).toMatchObject({ exerciseId: DB_BENCH, exerciseName: 'DB bench press', equipmentId: rack.id, loadConvention: 'per_hand', supersetGroup: null });
    const sets = setsOf(out.aggregate, row?.id ?? '');
    expect(sets.map((s) => s.setType)).toEqual(['working', 'working', 'working']);
    expect(sets.map((s) => s.planned.load)).toEqual([kg(32.5, 'per_hand'), kg(32.5, 'per_hand'), kg(32.5, 'per_hand')]);
    expect(sets[0]?.planned.source).toBe('built_in_rule');
    expect(out.slotOf[row?.id ?? '']).toBe(SLOT_BENCH);
    expect(out.aggregate.session.todayEdits?.swapped).toEqual([{ sessionExerciseId: row?.id, slotKey: SLOT_BENCH, fromExerciseId: BENCH, fromExerciseName: 'Bench press' }]);
    // Why? says it was swapped before start, then explains the substitute's own target.
    const why = explainTarget({ aggregate: out.aggregate, setId: sets[0]?.id ?? '', nowMs: ms(0), basisNow: null, gymNames: {}, painFlags: [], history: DB_BENCH_HISTORY });
    expect(why?.rows[0]).toEqual({ key: 'swapped', label: null, lines: ['Swapped before start · Bench press'], kind: 'app' });

    // No history: the slot's sets and reps, no load at all.
    const plain = plan([edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: CHEST_PRESS })], { swaps: swapsFor(MAIN_GYM, [[SLOT_BENCH, CHEST_PRESS, []]]) });
    const cp = rowsOf(plain.aggregate)[0];
    expect(cp).toMatchObject({ exerciseName: 'Chest press machine', equipmentId: cable.id, loadConvention: 'stack' });
    expect(setsOf(plain.aggregate, cp?.id ?? '').map((s) => [s.setType, s.planned.load, s.planned.reps])).toEqual([
      ['working', null, { min: 6, max: 8 }],
      ['working', null, { min: 6, max: 8 }],
      ['working', null, { min: 6, max: 8 }],
    ]);
  });

  it('a swap whose plan is missing is stale; the original stays', () => {
    const out = plan([edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH })], { swaps: new Map() });
    expect(rowsOf(out.aggregate)[0]?.exerciseName).toBe('Bench press');
    expect(out.outcomes[0]?.result).toBe('stale');
  });

  it('a gym change keeps every edit and re-fits the swap (Hotel: capped at 20 kg each); a cable substitute there gets no load', () => {
    const edits = [edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH }), edit({ kind: 'skip', slotKey: SLOT_FLY }), edit({ kind: 'order', slotKeys: moveSlot(SLOTS, SLOT_INCLINE, 'first') ?? [] })];
    const out = plan(edits, { gym: HOTEL_GYM, swaps: swapsFor(HOTEL_GYM, [[SLOT_BENCH, DB_BENCH, DB_BENCH_HISTORY]]) });
    expect(out.outcomes.map((o) => o.result)).toEqual(['applied', 'applied', 'applied']);
    const rows = rowsOf(out.aggregate);
    expect(rows.map((e) => e.exerciseName)).toEqual(['Incline DB press', 'DB bench press', 'Lateral raise', 'Triceps pushdown', 'Cable fly']);
    expect(rows[1]?.equipmentId).toBe(hotelRack.id);
    expect(setsOf(out.aggregate, rows[1]?.id ?? '').map((s) => s.planned.load)).toEqual([kg(20, 'per_hand'), kg(20, 'per_hand'), kg(20, 'per_hand')]);
    const cablePlan = plan([edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: CHEST_PRESS })], { gym: HOTEL_GYM, swaps: new Map([[SLOT_BENCH, { exercise: exOf(CHEST_PRESS), pin: cable, plan: [{ setType: 'working' as const, planned: { load: kg(40, 'stack'), reps: { min: 8, max: 10 }, durationS: null, rpe: null, rir: null } }] }]]) });
    const cp = rowsOf(cablePlan.aggregate)[0];
    expect(cp?.equipmentId).toBeNull();
    expect(setsOf(cablePlan.aggregate, cp?.id ?? '')[0]?.planned.load).toBeNull();
    expect(cablePlan.fits[setsOf(cablePlan.aggregate, cp?.id ?? '')[0]?.id ?? '']).toMatchObject({ kind: 'dropped' });
  });

  it('kg/lb: a kg history on a lb rack is converted only through that rack’s loads, rounding toward easier', () => {
    const LB_GYM = { id: HOTEL, name: 'Hotel gym', equipment: [lbRack] };
    const swaps = swapsFor(LB_GYM, [[SLOT_BENCH, DB_BENCH, DB_BENCH_HISTORY]]);
    const out = plan([edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH })], { gym: LB_GYM, swaps });
    const row = rowsOf(out.aggregate)[0];
    expect(row).toMatchObject({ unit: 'lb', loadConvention: 'per_hand' });
    // 32.5 kg = 71.65 lb → 70 lb each (easier), never 75.
    expect(setsOf(out.aggregate, row?.id ?? '')[0]?.planned.load).toEqual(lb(70, 'per_hand'));
  });

  it('an assisted machine: a substitute keeps its assistance, fitted toward more assistance, never past the machine', () => {
    const r = routine([routineExercise(610, { exerciseId: PULLDOWN, equipmentId: cable.id, order: 0, setTemplates: [6101, 6102, 6103].map((n) => template(n, { targetLoad: kg(60, 'stack'), targetReps: { min: 8, max: 10 } })) })]);
    const h = [history(905, 3, assist, kg(42, 'assistance'), [8, 8, 8])];
    const swaps = new Map([[id(610), substituteTargets(benchSlot, exOf(PULLUP), h, ctxAt(MAIN_GYM))]]);
    const out = plan([edit({ kind: 'swap', slotKey: id(610), toExerciseId: PULLUP })], { r, swaps });
    const row = rowsOf(out.aggregate)[0];
    expect(row).toMatchObject({ exerciseName: 'Assisted pull-up', equipmentId: assist.id, loadConvention: 'assistance' });
    const loads = setsOf(out.aggregate, row?.id ?? '').map((s) => s.planned.load);
    // The machine gives at most 40 kg of assistance: 42 → 40 (the most it gives), never extrapolated.
    expect(loads.every((l) => l !== null && l.convention === 'assistance' && l.value <= 40)).toBe(true);
  });

  it('is deterministic: the same inputs plan the same session (what the overview shows is what Start saves)', () => {
    const edits = [edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH }), edit({ kind: 'skip', slotKey: SLOT_FLY }), edit({ kind: 'order', slotKeys: moveSlot(SLOTS, SLOT_RAISE, 'first') ?? [] })];
    const swaps = swapsFor(MAIN_GYM, [[SLOT_BENCH, DB_BENCH, DB_BENCH_HISTORY]]);
    expect(plan(edits, { swaps }).aggregate).toEqual(plan(edits, { swaps }).aggregate);
  });
});

// ---------------------------------------------------------------------------
// The overview over an edited plan

function overview(out: ReturnType<typeof plan>, fromNames: Record<string, string> = {}, over: Partial<OverviewToday> = {}) {
  const pasts: Record<string, PastExercise[]> = {};
  for (const e of out.aggregate.exercises) pasts[e.exerciseId] = pastExercisesOf([], e.exerciseId);
  const swapped = new Map([...out.resolved.swaps].map(([slot, s]) => [slot, { editId: s.editId, fromExerciseId: out.baseSlots.find((b) => b.slotKey === slot)?.exerciseId ?? '', fromName: fromNames[slot] ?? 'Bench press' }]));
  return buildWorkoutOverview({
    aggregate: out.aggregate,
    fits: out.fits,
    pasts,
    painFlags: [],
    exerciseInfo: Object.fromEntries([...EXERCISES].map(([k, e]) => [k, e])),
    recent: [],
    nowMs: ms(0),
    tz: TZ,
    title: 'Push A',
    basis: { kind: 'only' },
    gym: { id: MAIN, name: 'Main gym' },
    key: { target: { kind: 'routine', routineId: id(300) }, routine: { id: id(300), version: 1 }, gym: { id: MAIN, equipment: [] }, source: null, painFlags: [], coachActions: [], unit: 'kg', checkIn: null, draft: { id: id(5000), version: 3 } },
    today: { slotOf: out.slotOf, slots: out.slots, swapped, skipped: out.resolved.skipped, editCount: editCountOf(out.resolved), draft: { id: id(5000), version: 3 }, routineName: 'Push A', ...over },
  });
}

describe('the overview with today’s edits (§2.1, §2.2, TE-A3)', () => {
  it('markers, the edit count, skipped rows left out of SETS and the muscles; row actions decided here', () => {
    const edits = [edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH }), edit({ kind: 'skip', slotKey: SLOT_FLY }), edit({ kind: 'order', slotKeys: moveSlot(SLOTS, SLOT_INCLINE, 'first') ?? [] })];
    const out = plan(edits, { swaps: swapsFor(MAIN_GYM, [[SLOT_BENCH, DB_BENCH, DB_BENCH_HISTORY]]) });
    const view = overview(out);
    expect(view.editCount).toBe(3);
    expect(view.draft).toEqual({ id: id(5000), version: 3 });
    expect(view.rows.map((r) => [r.name, r.marker.kind])).toEqual([
      ['Incline DB press', 'new'],
      ['DB bench press', 'swapped'],
      ['Lateral raise', 'new'],
      ['Triceps pushdown', 'new'],
      ['Cable fly', 'skipped'],
    ]);
    expect(view.rows.map((r) => r.slotKey)).toEqual([SLOT_INCLINE, SLOT_BENCH, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY]);
    expect(view.exerciseCount).toBe(5);
    // 3 + 3 + 3 + 3, the fly's 3 left out.
    expect(view.workingSets).toBe(12);
    expect(overview(plan([edit({ kind: 'skip', slotKey: SLOT_PUSHDOWN })])).muscles).not.toContain('Triceps');
    expect(overview(plan([])).muscles).toContain('Triceps');
    const swapped = view.rows[1];
    expect(swapped?.marker).toMatchObject({ word: 'Swapped', glyph: 'swap', tone: 'secondary' });
    expect(swapped?.panel[0]).toEqual({ key: 'swapped', label: 'Swapped', value: 'For Bench press · today', tone: 'normal' });
    expect(swapped?.actions).toEqual({ swap: true, undoSwap: true, skip: true, bringBack: false, doFirst: true, up: true, down: true, changeRoutine: true, remove: false });
    expect(swapped?.accessibilityLabel).toBe('2, DB bench press, swapped for Bench press today, 3 sets of 6 to 10, target 32.5 kilograms each, new');
    const skipped = view.rows[4];
    expect(skipped?.load).toMatchObject({ value: '—', none: true });
    expect(skipped?.panel[0]).toEqual({ key: 'skipped', label: 'Skipped', value: 'Today', tone: 'normal' });
    expect(skipped?.actions).toMatchObject({ swap: false, skip: false, bringBack: true, doFirst: false, up: true, down: false });
    expect(skipped?.accessibilityLabel).toBe('5, Cable fly, skipped today');
    expect(view.rows[0]?.actions).toMatchObject({ doFirst: false, up: false, undoSwap: false, changeRoutine: false });
    // A next session has no routine to change.
    expect(overview(out, {}, { routineName: null }).rows[1]?.actions.changeRoutine).toBe(false);
  });

  it('the last exercise left can’t be skipped; WARM-UP and PLATES follow the first barbell lift in today’s order, skipped ones left out', () => {
    const skipAll = [SLOT_INCLINE, SLOT_RAISE, SLOT_PUSHDOWN, SLOT_FLY].map((s) => edit({ kind: 'skip', slotKey: s }));
    const view = overview(plan(skipAll));
    expect(view.rows[0]?.actions.skip).toBe(false);
    expect(view.rows[0]?.panel.map((l) => l.key)).toContain('warmup');
    const benchSkipped = overview(plan([edit({ kind: 'skip', slotKey: SLOT_BENCH })]));
    expect(benchSkipped.rows.flatMap((r) => r.panel.map((l) => l.key))).not.toContain('warmup');
  });

  it('the draft is in the preview key and the start’s fence: any edit makes an older page stale', () => {
    const out = plan([]);
    const a = overview(out).previewKey;
    const b = buildWorkoutOverview({ ...overviewInput(out), key: { ...overviewInput(out).key, draft: { id: id(5000), version: 4 } } }).previewKey;
    expect(a).not.toBe(b);
    const fence = previewFence(overviewInput(out).key, OWNER, null);
    expect(fence.rows).toContainEqual({ table: 'pre_start_drafts', id: id(5000), version: 3 });
    // No draft: the key is the one the page had before drafts existed.
    const noDraft = { ...overviewInput(out).key };
    delete noDraft.draft;
    expect(previewKey({ ...noDraft, draft: null })).toBe(previewKey(noDraft));
  });
});

function overviewInput(out: ReturnType<typeof plan>): Parameters<typeof buildWorkoutOverview>[0] {
  return {
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
  };
}

describe('swapRoutineSlot (Change Push A too ›, TE4)', () => {
  it('replaces the slot’s exercise from now on: item cleared, template loads automatic, sets and reps kept; versioned and idempotent', () => {
    const r = pushA();
    const c = swapRoutineSlot(r, SLOT_BENCH, exOf(DB_BENCH), 1, 'apply-1', at(60));
    if (c.kind !== 'write') throw new Error(c.kind);
    const slot = c.next.exercises.find((e) => e.id === SLOT_BENCH);
    expect(slot).toMatchObject({ exerciseId: DB_BENCH, equipmentId: null, progressionRuleId: null });
    expect(slot?.setTemplates.map((t) => [t.setType, t.targetLoad, t.targetReps])).toEqual(r.exercises[0]?.setTemplates.map((t) => [t.setType, null, t.targetReps]));
    expect(c.next.version).toBe(2);
    expect(swapRoutineSlot(c.next, SLOT_BENCH, exOf(DB_BENCH), 1, 'apply-1', at(61)).kind).toBe('duplicate');
    // A card shown before the routine moved is out of date, even if it would now change nothing.
    expect(swapRoutineSlot(c.next, SLOT_BENCH, exOf(DB_BENCH), 1, 'apply-2', at(62)).kind).toBe('stale');
    expect(swapRoutineSlot(c.next, id(999), exOf(DB_BENCH), 2, 'apply-3', at(62)).kind).toBe('invalid');
  });

  it('after a skip breaks a superset, its other member can move on its own; the order then stays valid', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_PUSHDOWN } }, 'sk'));
    const today = editedSlots(SLOTS, resolveTodayEdits(SLOTS, d.edits));
    const order = moveSlot(today, SLOT_RAISE, 'first') ?? [];
    expect(order).toEqual([SLOT_RAISE, SLOT_BENCH, SLOT_INCLINE, SLOT_PUSHDOWN, SLOT_FLY]);
    d = written(write(d, { type: 'edit', edit: { kind: 'order', slotKeys: order } }, 'mv'));
    expect(resolveTodayEdits(SLOTS, d.edits).outcomes.map((o) => o.result)).toEqual(['applied', 'applied']);
    // An order moved back to the plan's own is no reorder (not counted).
    const back = edit({ kind: 'order', slotKeys: SLOTS.map((s) => s.slotKey) });
    expect(editCountOf(resolveTodayEdits(SLOTS, [back]))).toBe(0);
  });
});

describe('TE-A2: for every combination of swap, skip and order, the overview shows exactly the planned session', () => {
  const combos = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ swap: (n & 1) !== 0, skip: (n & 2) !== 0, order: (n & 4) !== 0 }));
  for (const c of combos) {
    it(`swap ${String(c.swap)}, skip ${String(c.skip)}, order ${String(c.order)}: every convention (total, per hand, stack)`, () => {
      const edits: TodayEdit[] = [];
      if (c.swap) edits.push(edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH }));
      if (c.skip) edits.push(edit({ kind: 'skip', slotKey: SLOT_FLY }));
      if (c.order) edits.push(edit({ kind: 'order', slotKeys: moveSlot(SLOTS, SLOT_RAISE, 'first') ?? [] }));
      const out = plan(edits, { swaps: swapsFor(MAIN_GYM, [[SLOT_BENCH, DB_BENCH, DB_BENCH_HISTORY]]) });
      const view = overview(out);
      const ordered = rowsOf(out.aggregate);
      expect(view.rows.map((r) => r.sessionExerciseId)).toEqual(ordered.map((e) => e.id));
      expect(new Set(ordered.map((e) => e.loadConvention))).toEqual(new Set(['total', 'per_hand', 'stack'].filter((x) => !(c.swap && x === 'total'))));
      for (const r of view.rows) {
        const sets = setsOf(out.aggregate, r.sessionExerciseId).filter((x) => x.setType !== 'warmup');
        if (r.edit?.kind === 'skipped') {
          expect(sets.every((x) => x.status === 'skipped' && x.skippedBy === 'before_start')).toBe(true);
          expect(r.load.value).toBe('—');
          continue;
        }
        const ex = ordered.find((e) => e.id === r.sessionExerciseId);
        expect(sets[0]?.status).toBe('pending');
        expect(r.firstSetId).toBe(sets[0]?.id);
        expect(plain(r.detail).startsWith(`${String(sets.length)} × `)).toBe(true);
        const first = sets[0]?.planned.load ?? null;
        const unit = first === null ? null : first.convention === 'per_hand' ? `${first.unit} each` : first.unit;
        expect(r.load.unit).toBe(unit);
        if (first !== null) expect(Number(r.load.value)).toBe(first.value);
        expect(r.marker.kind === 'swapped').toBe(c.swap && ex?.exerciseId === DB_BENCH);
      }
      expect(view.editCount).toBe(Number(c.swap) + Number(c.skip) + Number(c.order));
      expect(view.workingSets).toBe(out.aggregate.sets.filter((x) => x.setType !== 'warmup' && x.status === 'pending').length);
    });
  }
});

// ---------------------------------------------------------------------------
// Review fixes (docs/reviews/today-edits.md S1, S4, S5)

describe('back to the plan after chained swaps (review S1, TE-A6)', () => {
  it('clear_swap removes the whole chain: none of the swaps it replaced comes back; the toast Undo still steps back one', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'c1'));
    d = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: CHEST_PRESS } }, 'c2'));
    d = written(write(d, { type: 'edit', edit: { kind: 'skip', slotKey: SLOT_FLY } }, 'c3'));
    const chained = liveEdits(d.edits).find((e) => e.kind === 'swap');
    // `Bench press · planned` (or `Undo swap`): bench, not DB bench.
    const cleared = write(d, { type: 'clear_swap', slotKey: SLOT_BENCH }, 'c4');
    if (cleared.kind !== 'write') throw new Error(cleared.kind);
    expect(cleared.removed).toEqual([chained?.editId]);
    expect(cleared.added).toEqual([]);
    expect(liveEdits(cleared.next.edits).map((e) => e.kind)).toEqual(['skip']);
    expect(resolveTodayEdits(SLOTS, cleared.next.edits).swaps.size).toBe(0);
    expect(editedSlots(SLOTS, resolveTodayEdits(SLOTS, cleared.next.edits)).find((s) => s.slotKey === SLOT_BENCH)?.exerciseId).toBe(BENCH);
    // Nothing to clear: unchanged, no version bump; a retry is a duplicate.
    expect(write(cleared.next, { type: 'clear_swap', slotKey: SLOT_BENCH }, 'c5')).toMatchObject({ kind: 'unchanged' });
    expect(write(cleared.next, { type: 'clear_swap', slotKey: SLOT_BENCH }, 'c4')).toMatchObject({ kind: 'duplicate' });
    // Its Undo (the toast restores what it removed): the chained swap again.
    const back = written(write(cleared.next, { type: 'restore', editIds: cleared.removed }, 'c6'));
    expect(liveEdits(back.edits).find((e) => e.kind === 'swap')).toMatchObject({ toExerciseId: CHEST_PRESS });
    // The step-wise Undo (toast) on the second swap still brings back the first.
    const step = written(write(d, { type: 'undo', editId: chained?.editId ?? '' }, 'c7'));
    expect(liveEdits(step.edits).find((e) => e.kind === 'swap')).toMatchObject({ toExerciseId: DB_BENCH });
  });
});

describe('restoring without replacing a newer choice (review S4)', () => {
  it('keepLive: a removed swap stays removed when its slot has a newer live swap; restored when the slot is free', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 'k1'));
    const first = liveEdits(d.edits)[0];
    // The template change's Apply marks it redundant; then Ben swaps the slot again today.
    d = markDraftEdits(d, [first?.editId ?? ''], 'redundant', 'apply', at(10)) ?? d;
    d = written(write(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: CHEST_PRESS } }, 'k2'));
    // The template change's Undo: machine press stays.
    expect(write(d, { type: 'restore', editIds: [first?.editId ?? ''], keepLive: true }, 'k3')).toMatchObject({ kind: 'unchanged' });
    // Without keepLive (Undo of a Reset) the old behaviour stands.
    const replaced = written(write(d, { type: 'restore', editIds: [first?.editId ?? ''] }, 'k4'));
    expect(liveEdits(replaced.edits)).toMatchObject([{ kind: 'swap', toExerciseId: DB_BENCH }]);
    // A free slot: restored.
    const free = written(write(d, { type: 'clear_swap', slotKey: SLOT_BENCH }, 'k5'));
    expect(liveEdits(written(write(free, { type: 'restore', editIds: [first?.editId ?? ''], keepLive: true }, 'k6')).edits)).toMatchObject([{ kind: 'swap', toExerciseId: DB_BENCH }]);
  });
});

describe('a swap never takes another slot’s exercise (review S5)', () => {
  const withDbBench = (): Routine => {
    const r = pushA();
    return { ...r, exercises: r.exercises.map((x) => (x.id === SLOT_INCLINE ? { ...x, exerciseId: DB_BENCH } : x)) };
  };
  const slotsWithDb = basisSlots({ kind: 'routine', routine: withDbBench() });

  it('applyDraftCommand refuses an exercise already in today’s plan (another slot’s own, or another slot’s swap)', () => {
    const w = (current: PreStartDraft | null, command: DraftCommand, opId: string) =>
      applyDraftCommand({ current, expectedVersion: current?.version ?? null, opId, at: at(0), ownerId: OWNER, basis: BASIS, newDraftId: id(5000), slots: slotsWithDb, command });
    expect(w(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 's1')).toEqual({ kind: 'invalid', reason: 'in_plan' });
    const d = written(w(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: CHEST_PRESS } }, 's2'));
    expect(w(d, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_FLY, toExerciseId: CHEST_PRESS } }, 's3')).toEqual({ kind: 'invalid', reason: 'in_plan' });
    // Swapped away today, the other slot's exercise is free.
    const away = written(w(null, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_INCLINE, toExerciseId: CHEST_PRESS } }, 's4'));
    expect(w(away, { type: 'edit', edit: { kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH } }, 's5').kind).toBe('write');
  });

  it('resolveTodayEdits marks it stale once the routine gains that exercise; the other slot keeps its own targets', () => {
    const swap = edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: DB_BENCH });
    expect(resolveTodayEdits(SLOTS, [swap]).outcomes[0]?.result).toBe('applied');
    // DB bench added to Push A in the routine editor after the swap.
    const r = resolveTodayEdits(slotsWithDb, [swap]);
    expect(r.outcomes[0]?.result).toBe('stale');
    expect(pruneOf(r.outcomes)).toEqual([{ editId: swap.editId, why: 'stale' }]);
    // A cross-swap (each slot swapped away) and two swaps to one exercise (the later is stale).
    const a = edit({ kind: 'swap', slotKey: SLOT_INCLINE, toExerciseId: CHEST_PRESS });
    expect(resolveTodayEdits(slotsWithDb, [swap, a]).outcomes.map((o) => o.result)).toEqual(['applied', 'applied']);
    const twice = edit({ kind: 'swap', slotKey: SLOT_FLY, toExerciseId: DB_BENCH });
    expect(resolveTodayEdits(SLOTS, [swap, twice]).outcomes.map((o) => o.result)).toEqual(['applied', 'stale']);

    // The plan: the bench slot stays bench; the DB bench slot plans from its own template, not the substitute's.
    const own = [kg(30, 'per_hand'), kg(30, 'per_hand'), kg(30, 'per_hand')];
    const out = plan([swap], { r: withDbBench(), swaps: swapsFor(MAIN_GYM, [[SLOT_BENCH, DB_BENCH, [history(901, 2, rack, kg(20, 'per_hand'), [8, 8, 8])]]]) });
    const rows = rowsOf(out.aggregate);
    expect(rows.map((e) => e.exerciseName).slice(0, 2)).toEqual(['Bench press', 'DB bench press']);
    expect(setsOf(out.aggregate, rows[1]?.id ?? '').map((s) => s.planned.load)).toEqual(own);
    expect(out.outcomes[0]?.result).toBe('stale');
  });
  it('a swap that resolves stale keeps its slot’s exercise: a later swap to it is stale too, so one exercise is never in two slots (review R2-S1)', () => {
    // Bench → chest press, then fly → bench (allowed: bench was swapped away).
    const toPress = edit({ kind: 'swap', slotKey: SLOT_BENCH, toExerciseId: CHEST_PRESS });
    const toBench = edit({ kind: 'swap', slotKey: SLOT_FLY, toExerciseId: BENCH });
    expect(resolveTodayEdits(SLOTS, [toPress, toBench]).outcomes.map((o) => o.result)).toEqual(['applied', 'applied']);
    // Then Push A is edited: chest press goes in the incline slot.
    const withPress = basisSlots({ kind: 'routine', routine: { ...pushA(), exercises: pushA().exercises.map((x) => (x.id === SLOT_INCLINE ? { ...x, exerciseId: CHEST_PRESS } : x)) } });
    const r = resolveTodayEdits(withPress, [toPress, toBench]);
    expect(r.outcomes.map((o) => o.result)).toEqual(['stale', 'stale']);
    expect(r.swaps.size).toBe(0);
    const today = editedSlots(withPress, r).map((x) => x.exerciseId);
    expect(today.filter((x) => x === BENCH)).toHaveLength(1);
    expect(new Set(today).size).toBe(today.length);
    expect(pruneOf(r.outcomes)).toEqual([
      { editId: toPress.editId, why: 'stale' },
      { editId: toBench.editId, why: 'stale' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, Exercise, Load, PreStartDraft, Routine, SessionAggregate, TodayEdit, WorkoutSet, ZonedTimestamp } from '@fizz/schemas';
import { PreStartDraftSchema, SessionAggregateSchema, TodayEditSchema } from '@fizz/schemas';

import {
  addTargets,
  applyDraftCommand,
  basisSlots,
  buildWorkoutOverview,
  estimateRemainingDuration,
  finishByFromFit,
  fitMinutesOf,
  fitTier,
  fitWheelMinutes,
  howLongSheet,
  liveEdits,
  overByMinutes,
  overviewTodayOf,
  planPace,
  planWithTodayEdits,
  resolveTodayEdits,
  roundEstimateMinutes,
  substituteTargets,
  templateLinesFromEdits,
  todayShapes,
  type DraftCommand,
  type ResolvedPace,
  type SubstituteContext,
  type SwapPlan,
  type TodayPlanOutput,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, ms, OWNER, profile, routine, routineExercise, stack, template, TZ } from './fixtures';

/**
 * Fit to time (fit-to-time.md, slice C): the built-in trim `fitPlanToMinutes`
 * (§4), the `fit` draft edit as intent re-run by the one planning path
 * (FT4), Ben's edits winning (FT5), Finish by (FT8), and the overview's
 * card, tile and markers. Fixture: §4.5 Push A at Main gym.
 */

const BENCH = id(210);
const INCLINE = id(211);
const FLY = id(212);
const RAISE = id(213);
const PUSHDOWN = id(214);
const DB_BENCH = id(220);
const FACE_PULL = id(225);
const PULLUP = id(223);

const EXERCISES = new Map<string, Exercise>([
  [BENCH, exercise(210, 'Bench press', { primaryMuscles: ['chest'], mechanic: 'compound' })],
  [INCLINE, exercise(211, 'Incline DB press', { primaryMuscles: ['upper_chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'compound' })],
  [FLY, exercise(212, 'Cable fly', { primaryMuscles: ['chest'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'isolation' })],
  [RAISE, exercise(213, 'Lateral raise', { primaryMuscles: ['side_delts'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'isolation' })],
  [PUSHDOWN, exercise(214, 'Triceps pushdown', { primaryMuscles: ['triceps'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'isolation' })],
  [DB_BENCH, exercise(220, 'DB bench press', { primaryMuscles: ['chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'compound' })],
  [FACE_PULL, exercise(225, 'Face pull', { primaryMuscles: ['rear_delts'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'isolation' })],
  [PULLUP, exercise(223, 'Assisted pull-up', { primaryMuscles: ['lats'], compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', mechanic: 'compound' })],
]);

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
const NEW_SLOT = id(650);

/** §4.5: bench 3 working + 2 warm-ups (A), incline DB 3 (A), superset lateral raise 3 + pushdown 3 (C), cable fly 3 (C). Rest 3:30 on the mains (5:00 after a warm-up), 1:30 on the rest. */
function pushA(over: Partial<Routine> = {}): Routine {
  const mainRest = { warmup: { seconds: 300 }, working: { seconds: 210 } };
  const accRest = { working: { seconds: 90 } };
  return {
    ...routine([
      routineExercise(600, {
        exerciseId: BENCH,
        equipmentId: bar.id,
        order: 0,
        restBySetType: mainRest,
        setTemplates: [
          template(6001, { setType: 'warmup', targetLoad: kg(60), targetReps: { min: 5, max: 5 } }),
          template(6002, { setType: 'warmup', targetLoad: kg(80), targetReps: { min: 3, max: 3 } }),
          template(6003, { targetLoad: kg(100) }),
          template(6004, { targetLoad: kg(100) }),
          template(6005, { targetLoad: kg(100) }),
        ],
      }),
      routineExercise(601, { exerciseId: INCLINE, equipmentId: rack.id, order: 1, restBySetType: mainRest, setTemplates: [6011, 6012, 6013].map((n) => template(n, { targetLoad: kg(30, 'per_hand'), targetReps: { min: 8, max: 10 } })) }),
      routineExercise(602, { exerciseId: RAISE, equipmentId: rack.id, order: 2, supersetGroup: 'A', restBySetType: accRest, transitionRestS: 15, setTemplates: [6021, 6022, 6023].map((n) => template(n, { targetLoad: kg(10, 'per_hand'), targetReps: { min: 12, max: 15 } })) }),
      routineExercise(603, { exerciseId: PUSHDOWN, equipmentId: cable.id, order: 3, supersetGroup: 'A', restBySetType: accRest, transitionRestS: 15, setTemplates: [6031, 6032, 6033].map((n) => template(n, { targetLoad: kg(25, 'stack'), targetReps: { min: 10, max: 12 } })) }),
      routineExercise(604, { exerciseId: FLY, equipmentId: cable.id, order: 4, restBySetType: accRest, setTemplates: [6041, 6042, 6043].map((n) => template(n, { targetLoad: kg(50, 'stack'), targetReps: { min: 12, max: 15 } })) }),
    ]),
    source: 'ben',
    ...over,
  };
}

/** Ben's pace from his last 5 workouts (§4.5): 50 s a set, 45 s between exercises. */
const PACE: ResolvedPace = { source: 'recent_workouts', secondsPerSet: 50, changeoverSeconds: 45, samples: 20 };

let editN = 0;
type Body = Parameters<typeof applyDraftCommand>[0]['command'] extends infer C ? (C extends { type: 'edit'; edit: infer E } ? E : never) : never;
function edit(body: Body, over: Partial<TodayEdit> = {}): TodayEdit {
  editN += 1;
  const e = { ...body, editId: id(7000 + editN), opId: `op-${String(editN)}`, atUtc: at(0).utc, replacesEditId: null, removed: null, ...over } as TodayEdit;
  expect(TodayEditSchema.safeParse(e).success).toBe(true);
  return e;
}

function plan(
  edits: readonly TodayEdit[],
  opts: { gym?: typeof MAIN_GYM; adds?: Map<string, SwapPlan>; swaps?: Map<string, SwapPlan>; r?: Routine; held?: (exerciseId: string) => boolean; pace?: ResolvedPace } = {},
): Extract<TodayPlanOutput, { kind: 'routine' }> {
  const gym = opts.gym ?? MAIN_GYM;
  return planWithTodayEdits(
    {
      kind: 'routine',
      input: { opId: 'preview', owner: profile(), gymId: gym.id, gymName: gym.name, routine: opts.r ?? pushA(), exercises: EXERCISES, gymEquipment: gym.equipment, knownEquipment: KNOWN, at: at(0), newId: idGen(20_000) },
    },
    { draft: { id: id(5000), version: 3 }, edits, swaps: opts.swaps ?? new Map(), adds: opts.adds ?? new Map(), fit: { pace: opts.pace ?? PACE, ...(opts.held ? { held: opts.held } : {}) } },
  );
}

const rowsOf = (agg: SessionAggregate) => [...agg.exercises].sort((a, b) => a.order - b.order);
const rowOf = (out: { aggregate: SessionAggregate; slotOf: Record<string, string> }, slotKey: string) => rowsOf(out.aggregate).find((e) => out.slotOf[e.id] === slotKey);
const setsOf = (out: { aggregate: SessionAggregate; slotOf: Record<string, string> }, slotKey: string): WorkoutSet[] =>
  out.aggregate.sets.filter((s) => s.sessionExerciseId === rowOf(out, slotKey)?.id).sort((a, b) => a.index - b.index);
const pendingWorking = (out: { aggregate: SessionAggregate; slotOf: Record<string, string> }, slotKey: string) => setsOf(out, slotKey).filter((s) => s.status === 'pending' && s.setType !== 'warmup').length;
const minutes = (agg: SessionAggregate) => estimateRemainingDuration(agg, { pace: PACE }).seconds / 60;

const name = (slotKey: string): string => ({ [SLOT_BENCH]: 'Bench press', [SLOT_INCLINE]: 'Incline DB press', [SLOT_RAISE]: 'Lateral raise', [SLOT_PUSHDOWN]: 'Triceps pushdown', [SLOT_FLY]: 'Cable fly' })[slotKey] ?? slotKey;
const linesOf = (out: ReturnType<typeof plan>) => (out.fit?.lines ?? []).map((l) => (l.kind === 'sets' ? `${name(l.slotKey)} ${String(l.from)}→${String(l.to)}` : `${name(l.slotKey)} ${l.kind}`));

function overview(out: ReturnType<typeof plan>, swapped = new Map<string, { editId: string; fromExerciseId: string; fromName: string }>()) {
  return buildWorkoutOverview({
    aggregate: out.aggregate,
    fits: out.fits,
    pasts: {},
    painFlags: [],
    exerciseInfo: {},
    recent: [],
    pace: PACE,
    nowMs: ms(0),
    tz: TZ,
    title: 'Push A',
    basis: { kind: 'only' },
    gym: { id: MAIN, name: 'Main gym' },
    key: { target: { kind: 'routine', routineId: id(300) }, routine: { id: id(300), version: 1 }, gym: { id: MAIN, equipment: [] }, source: null, painFlags: [], coachActions: [], unit: 'kg', checkIn: null, draft: { id: id(5000), version: 3 } },
    today: overviewTodayOf(out, { swapped, draft: { id: id(5000), version: 3 }, routineName: 'Push A' }),
  });
}

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

/** Every set's identity and targets, for "nothing but the status changed". */
const shapeOfSets = (agg: SessionAggregate) => [...agg.sets].sort((a, b) => (a.id < b.id ? -1 : 1)).map((s) => ({ id: s.id, ex: s.sessionExerciseId, index: s.index, type: s.setType, load: s.planned.load, reps: s.planned.reps, durationS: s.planned.durationS, rest: s.rest.seconds }));
const orderOf = (agg: SessionAggregate) => rowsOf(agg).map((e) => e.exerciseId);

// ---------------------------------------------------------------------------

describe('fitTier (§4.2)', () => {
  it('main is A; another compound (or a priority group) is B; everything else C', () => {
    expect(fitTier({ main: true, compound: false })).toBe('A');
    expect(fitTier({ main: false, compound: true })).toBe('B');
    expect(fitTier({ main: false, compound: false, priority: true })).toBe('B');
    expect(fitTier({ main: false, compound: false })).toBe('C');
  });
});

describe('fitPlanToMinutes reproduces §4.5 (FT-C2, FT-C4)', () => {
  it('Push A is about 56 min with Ben’s pace', () => {
    const none = plan([]);
    expect(minutes(none.aggregate)).toBeCloseTo(55.67, 1);
    expect(none.fit).toBeNull();
    expect(none.aggregate.session.finishBy).toBeUndefined();
  });

  it('45: accessories trimmed to 2 (cable fly first, then the superset’s round), then cable fly skipped; mains untouched', () => {
    const out = plan([edit({ kind: 'fit', minutes: 45 })]);
    expect(out.fit).toMatchObject({ status: 'fitted', by: 'built_in', minutes: 45 });
    expect(linesOf(out)).toEqual(['Lateral raise 3→2', 'Triceps pushdown 3→2', 'Cable fly skip']);
    expect((out.fit?.beforeSeconds ?? 0) / 60).toBeCloseTo(55.67, 1);
    expect((out.fit?.afterSeconds ?? 0) / 60).toBeCloseTo(44.5, 1);
    expect(minutes(out.aggregate)).toBeCloseTo(44.5, 1);
    expect(pendingWorking(out, SLOT_BENCH)).toBe(3);
    expect(pendingWorking(out, SLOT_INCLINE)).toBe(3);
    expect(setsOf(out, SLOT_BENCH).filter((s) => s.setType === 'warmup' && s.status === 'pending')).toHaveLength(2);
    expect(setsOf(out, SLOT_FLY).every((s) => s.status === 'skipped' && s.skippedBy === 'before_start')).toBe(true);
    // The trim takes the last set of each superset member (one round).
    expect(setsOf(out, SLOT_RAISE).map((s) => s.status)).toEqual(['pending', 'pending', 'skipped']);
    expect(setsOf(out, SLOT_PUSHDOWN).map((s) => s.status)).toEqual(['pending', 'pending', 'skipped']);
  });

  it('30: the superset is skipped next (tier C before tier B), then the mains go to 2 sets, later main first', () => {
    const out = plan([edit({ kind: 'fit', minutes: 30 })]);
    expect(out.fit?.status).toBe('fitted');
    expect(linesOf(out)).toEqual(['Bench press 3→2', 'Incline DB press 3→2', 'Lateral raise skip', 'Triceps pushdown skip', 'Cable fly skip']);
    expect((out.fit?.afterSeconds ?? 0) / 60).toBeCloseTo(26.25, 1);
    // Warm-ups of a kept main stay.
    expect(setsOf(out, SLOT_BENCH).filter((s) => s.setType === 'warmup').every((s) => s.status === 'pending')).toBe(true);
  });

  it('20: `over` after pass 3 with nothing cut beyond it: mains at 2, never skipped', () => {
    const out = plan([edit({ kind: 'fit', minutes: 20 })]);
    expect(out.fit?.status).toBe('over');
    expect(linesOf(out)).toEqual(['Bench press 3→2', 'Incline DB press 3→2', 'Lateral raise skip', 'Triceps pushdown skip', 'Cable fly skip']);
    expect(pendingWorking(out, SLOT_BENCH)).toBe(2);
    expect(pendingWorking(out, SLOT_INCLINE)).toBe(2);
    const view = overview(out);
    expect(view.fit?.title).toBe('Shortest: ≈ 25 min');
    expect(view.estimate?.minutes).toBe(25);
  });

  it('already fits: no cuts, nothing skipped, the plan as it was (and the sheet says `Fits already`)', () => {
    const none = plan([]);
    const out = plan([edit({ kind: 'fit', minutes: 60 })]);
    expect(out.fit).toMatchObject({ status: 'already_fits', lines: [], skipSetIds: [] });
    expect(out.aggregate.sets.map((s) => s.status)).toEqual(none.aggregate.sets.map((s) => s.status));
    const sheet = howLongSheet({ nowSeconds: 56 * 60, nowMinutes: 55, unfittedSeconds: 56 * 60, fitMinutes: null, chosen: 60, coachAvailable: true });
    expect(sheet.trim).toEqual({ text: 'Fits already', enabled: false, minutes: 60 });
    expect(sheet.ask.text).toBe('Ask coach to fill 60 min');
  });

  it('removes the last drop set, then the last back-off, then the last plain working set; never a top set, never below 2', () => {
    const r = pushA();
    const bench = r.exercises.find((x) => x.id === SLOT_BENCH);
    if (!bench) throw new Error('no bench');
    const topBackoff: Routine = {
      ...r,
      exercises: r.exercises.map((x) =>
        x.id !== SLOT_INCLINE
          ? x
          : {
              ...x,
              main: false,
              setTemplates: [
                template(6111, { setType: 'top', targetLoad: kg(34, 'per_hand'), targetReps: { min: 6, max: 6 } }),
                template(6112, { setType: 'backoff', targetLoad: kg(28, 'per_hand') }),
                template(6113, { setType: 'backoff', targetLoad: kg(28, 'per_hand') }),
                template(6114, { setType: 'drop', targetLoad: kg(20, 'per_hand') }),
              ],
            },
      ),
    };
    // Incline is now tier B (compound, not main): trimmed after tier C, down to 2, top set kept.
    const out = plan([edit({ kind: 'fit', minutes: 40 })], { r: topBackoff });
    const incline = setsOf(out, SLOT_INCLINE);
    const status = (t: string) => incline.filter((s) => s.setType === t).map((s) => s.status);
    expect(status('top')).toEqual(['pending']);
    expect(status('drop')).toEqual(['skipped']);
    expect(status('backoff')).toEqual(['pending', 'skipped']);
    expect(incline.filter((s) => s.status === 'pending')).toHaveLength(2);
  });
});

describe('the trim never raises anything (FT-C3, property test)', () => {
  /** A small seeded generator, so a failure names its seed. */
  function rng(seed: number): () => number {
    let x = seed >>> 0;
    return () => {
      x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
      return x / 0xffffffff;
    };
  }
  const POOL = [BENCH, INCLINE, FLY, RAISE, PUSHDOWN, DB_BENCH, FACE_PULL, PULLUP];
  const EQ: Record<string, string> = { [BENCH]: bar.id, [INCLINE]: rack.id, [FLY]: cable.id, [RAISE]: rack.id, [PUSHDOWN]: cable.id, [DB_BENCH]: rack.id, [FACE_PULL]: cable.id, [PULLUP]: assist.id };
  const LOAD: Record<string, Load> = { [BENCH]: kg(100), [INCLINE]: kg(30, 'per_hand'), [FLY]: kg(50, 'stack'), [RAISE]: kg(10, 'per_hand'), [PUSHDOWN]: kg(25, 'stack'), [DB_BENCH]: kg(32.5, 'per_hand'), [FACE_PULL]: kg(20, 'stack'), [PULLUP]: kg(20, 'assistance') };
  const TYPES = ['working', 'working', 'working', 'top', 'backoff', 'drop', 'warmup'] as const;

  function randomRoutine(next: () => number, seed: number): Routine {
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
    const n = 1 + Math.floor(next() * 6);
    const chosen = [...POOL].sort(() => next() - 0.5).slice(0, n);
    let group = 0;
    const out = chosen.map((exerciseId, i) => {
      const sets = 1 + Math.floor(next() * 6);
      const inSuperset = i > 0 && next() < 0.3;
      if (!inSuperset) group += 1;
      return routineExercise(800 + i, {
        exerciseId,
        equipmentId: EQ[exerciseId] ?? null,
        order: i,
        supersetGroup: inSuperset ? `g${String(group)}` : next() < 0.2 ? `g${String(group + 1)}` : null,
        ...(next() < 0.5 ? { main: next() < 0.5 } : {}),
        restBySetType: { working: { seconds: 30 + Math.floor(next() * 270) } },
        transitionRestS: next() < 0.5 ? 15 : null,
        setTemplates: Array.from({ length: sets }, (_, k) => template(seed * 100 + i * 10 + k, { setType: pick(TYPES), targetLoad: LOAD[exerciseId] ?? null, targetReps: { min: 5 + k, max: 8 + k } })),
      });
    });
    return { ...pushA(), exercises: out };
  }

  it('over random plans and lengths: loads, reps, rest, set types and order identical; only pending → skipped; mains never skipped nor below 2', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const next = rng(seed);
      const r = randomRoutine(next, seed);
      const before = plan([], { r });
      // Mostly below the plan's length, so the trim has work to do; sometimes above it.
      const length = Math.max(15, Math.min(180, 5 * Math.round((next() * 1.2 * minutes(before.aggregate)) / 5)));
      const fitted = plan([edit({ kind: 'fit', minutes: length })], { r });
      expect(shapeOfSets(fitted.aggregate), `seed ${String(seed)}`).toEqual(shapeOfSets(before.aggregate));
      expect(orderOf(fitted.aggregate), `seed ${String(seed)}`).toEqual(orderOf(before.aggregate));
      const was = new Map(before.aggregate.sets.map((s) => [s.id, s.status]));
      for (const s of fitted.aggregate.sets) {
        if (s.status !== was.get(s.id)) expect([was.get(s.id), s.status], `seed ${String(seed)}`).toEqual(['pending', 'skipped']);
      }
      // A kept slot keeps its warm-ups and its top sets.
      for (const slot of basisSlots({ kind: 'routine', routine: r })) {
        const sets = setsOf(fitted, slot.slotKey);
        const kept = sets.some((s) => s.status === 'pending');
        if (kept) expect(sets.filter((s) => (s.setType === 'warmup' || s.setType === 'top') && s.status !== 'pending'), `seed ${String(seed)}`).toEqual([]);
      }
      // Never more skipped than needed in pass order: tier A slots keep min(2, their count).
      const mains = r.exercises.filter((x) => x.main === true);
      for (const m of mains) {
        const start = setsOf(before, m.id).filter((s) => s.setType !== 'warmup').length;
        expect(pendingWorking(fitted, m.id), `seed ${String(seed)}`).toBeGreaterThanOrEqual(Math.min(2, start));
      }
      if (fitted.fit?.status === 'fitted') expect(fitted.fit.afterSeconds).toBeLessThanOrEqual(length * 60);
      expect(fitted.fit?.afterSeconds).toBeLessThanOrEqual(fitted.fit?.beforeSeconds ?? Infinity);
    }
  });
});

describe('the fit is intent, planned on every read (FT4, FT-C5, FT-C6)', () => {
  it('preview = Start: the same draft plans the same rows and statuses, and Start carries Finish by and `fitted`', () => {
    const edits = [edit({ kind: 'sets', slotKey: SLOT_BENCH, workingSets: 4 }), edit({ kind: 'fit', minutes: 45 })];
    const a = plan(edits);
    const b = plan(edits);
    expect(b.aggregate.sets.map((s) => [s.setType, s.status, s.planned.load])).toEqual(a.aggregate.sets.map((s) => [s.setType, s.status, s.planned.load]));
    // Finish by = start + 45 min, rounded up to 5 min (FT8).
    expect(a.aggregate.session.finishBy).toEqual(finishByFromFit(at(0), 45));
    expect(a.aggregate.session.todayEdits?.fitted).toEqual({ minutes: 45, by: 'built_in', cuts: a.fit?.lines });
    expect(a.aggregate.session.todayEdits?.edited).toEqual([{ sessionExerciseId: rowOf(a, SLOT_BENCH)?.id, slotKey: SLOT_BENCH, kinds: ['sets'] }]);
    expect(SessionAggregateSchema.safeParse(a.aggregate).success).toBe(true);
  });

  it('Finish by rounds up to the next 5 minutes in the start’s time zone', () => {
    expect(finishByFromFit({ utc: '2026-10-11T17:43:10.000Z', tz: TZ }, 45)).toEqual({ utc: '2026-10-11T18:30:00.000Z', tz: TZ });
    expect(finishByFromFit({ utc: '2026-10-11T17:45:00.000Z', tz: TZ }, 45)).toEqual({ utc: '2026-10-11T18:30:00.000Z', tz: TZ });
  });

  it('re-runs after another edit, a swap or a gym change: no stale cut is left', () => {
    const fit = edit({ kind: 'fit', minutes: 45 });
    // A set added elsewhere: the trim has more to find.
    const more = plan([edit({ kind: 'sets', slotKey: SLOT_INCLINE, workingSets: 5 }), fit]);
    expect(linesOf(more)).not.toEqual(linesOf(plan([fit])));
    expect(more.fit?.lines.find((l) => l.slotKey === SLOT_INCLINE)).toBeUndefined();
    // A swap: the slot keeps its tier (main) and the substitute's own plan is trimmed like any other.
    const swaps = new Map([[SLOT_INCLINE, substituteTargets({ workingSets: 3, templates: [1, 2, 3].map(() => ({ setType: 'working' as const, reps: { min: 8, max: 10 }, durationS: null })) }, EXERCISES.get(DB_BENCH) as Exercise, [], ctxAt(MAIN_GYM))]]);
    const swapped = plan([edit({ kind: 'swap', slotKey: SLOT_INCLINE, toExerciseId: DB_BENCH }), fit], { swaps });
    expect(swapped.fit?.lines.some((l) => l.slotKey === SLOT_INCLINE && l.kind === 'skip')).toBe(false);
    for (const out of [more, swapped]) {
      for (const setId of out.fit?.skipSetIds ?? []) expect(out.aggregate.sets.find((s) => s.id === setId)?.status).toBe('skipped');
      expect(out.aggregate.sets.filter((s) => s.status === 'skipped')).toHaveLength(out.fit?.skipSetIds.length ?? -1);
    }
    // Another gym (lb rack at the Imperial gym): re-fitted loads, the same trim rules, loads never changed by the trim.
    const lbPlain = plan([], { gym: LB_GYM });
    const lbFit = plan([fit], { gym: LB_GYM });
    expect(shapeOfSets(lbFit.aggregate)).toEqual(shapeOfSets(lbPlain.aggregate));
    expect(lbFit.aggregate.sets.some((s) => s.planned.load?.unit === 'lb')).toBe(true);
    const hotel = plan([fit], { gym: HOTEL_GYM });
    expect(shapeOfSets(hotel.aggregate)).toEqual(shapeOfSets(plan([], { gym: HOTEL_GYM }).aggregate));
  });
});

describe('Ben wins (FT5, FT-C7)', () => {
  it('Bring back on a fit-skipped row is Ben’s sets edit: that slot leaves the fit and the card reads `≈ … min · N over 45`', () => {
    const fit = edit({ kind: 'fit', minutes: 45 });
    const first = plan([fit]);
    const view = overview(first);
    const fly = view.rows.find((r) => r.slotKey === SLOT_FLY);
    expect(fly?.edit).toEqual({ kind: 'skipped', editId: fit.editId, fitKeep: 3 });
    expect(fly?.actions.bringBack).toBe(true);
    expect(fly?.marker).toMatchObject({ kind: 'skipped', word: 'Skipped' });
    // The screen sends Ben's own count for the slot.
    const back = plan([fit, edit({ kind: 'sets', slotKey: SLOT_FLY, workingSets: fly?.edit?.kind === 'skipped' ? (fly.edit.fitKeep ?? 0) : 0 })]);
    expect(pendingWorking(back, SLOT_FLY)).toBe(3);
    expect(back.fit?.lines.some((l) => l.slotKey === SLOT_FLY)).toBe(false);
    // The trim re-runs without it (FT4): here the superset goes instead and it still fits.
    // (FT-C7's `≈ 52 min · 7 over 45` assumes no new cut after Bring back; flagged for Ben.)
    const v2 = overview(back);
    expect(back.fit?.status).toBe('fitted');
    expect(v2.fit?.lines).toEqual(['Lateral raise · skipped', 'Triceps pushdown · skipped']);
    // When Ben's kept slots stop it fitting, the card says by how much.
    const tooMuch = plan([fit, edit({ kind: 'sets', slotKey: SLOT_FLY, workingSets: 3 }), edit({ kind: 'sets', slotKey: SLOT_RAISE, workingSets: 3 }), edit({ kind: 'sets', slotKey: SLOT_PUSHDOWN, workingSets: 3 })]);
    expect(tooMuch.fit).toMatchObject({ status: 'over', benKept: true });
    const v3 = overview(tooMuch);
    expect(v3.fit?.title).toBe('Fitted to 45 min');
    expect(v3.fit?.beforeAfter).toMatch(/^≈\u00a0\d+\u00a0min · \d+ over 45$/);
  });

  it('a slot with Ben’s reps or load, an added exercise, and a pain-held slot are never trimmed or skipped', () => {
    const out = plan(
      [edit({ kind: 'reps', slotKey: SLOT_FLY, reps: { min: 10, max: 12 }, durationS: null }), edit({ kind: 'load', slotKey: SLOT_RAISE, load: kg(12.5, 'per_hand') }), edit({ kind: 'fit', minutes: 20 })],
      { held: (x) => x === PUSHDOWN },
    );
    expect(pendingWorking(out, SLOT_FLY)).toBe(3);
    expect(pendingWorking(out, SLOT_RAISE)).toBe(3);
    expect(pendingWorking(out, SLOT_PUSHDOWN)).toBe(3);
    expect(out.fit?.status).toBe('over');
    const add = new Map([[NEW_SLOT, addTargets(EXERCISES.get(FACE_PULL) as Exercise, [], ctxAt(MAIN_GYM))]]);
    const withAdd = plan([edit({ kind: 'add', slotKey: NEW_SLOT, exerciseId: FACE_PULL }), edit({ kind: 'fit', minutes: 20 })], { adds: add });
    expect(setsOf(withAdd, NEW_SLOT).every((s) => s.status === 'pending')).toBe(true);
  });
});

describe('the draft: one fit at a time, Undo, Clear, versioned and idempotent (FT2, FT-C8, FT-C17)', () => {
  it('Trim writes a fit; another length replaces it and Undo brings the first back; Clear fit and its Undo; retries and stale versions write nothing', () => {
    let d = written(write(null, { type: 'edit', edit: { kind: 'fit', minutes: 45 } }, 'f1'));
    expect(write(d, { type: 'edit', edit: { kind: 'fit', minutes: 45 } }, 'f2')).toMatchObject({ kind: 'unchanged' });
    expect(write(d, { type: 'edit', edit: { kind: 'fit', minutes: 30 } }, 'f1')).toMatchObject({ kind: 'duplicate' });
    expect(write(d, { type: 'edit', edit: { kind: 'fit', minutes: 30 } }, 'f3', at(0), null)).toMatchObject({ kind: 'stale' });
    expect(write(d, { type: 'edit', edit: { kind: 'fit', minutes: 10 } }, 'f4')).toEqual({ kind: 'invalid', reason: 'out_of_range' });
    expect(write(d, { type: 'edit', edit: { kind: 'fit', minutes: 181 } }, 'f4')).toEqual({ kind: 'invalid', reason: 'out_of_range' });
    const change = write(d, { type: 'edit', edit: { kind: 'fit', minutes: 30 } }, 'f5');
    d = written(change);
    expect(liveEdits(d.edits)).toMatchObject([{ kind: 'fit', minutes: 30 }]);
    const newest = liveEdits(d.edits)[0];
    d = written(write(d, { type: 'undo', editId: newest?.editId ?? '' }, 'f6'));
    expect(liveEdits(d.edits)).toMatchObject([{ kind: 'fit', minutes: 45 }]);
    const cleared = write(d, { type: 'clear_fit' }, 'f7');
    if (cleared.kind !== 'write') throw new Error(cleared.kind);
    expect(liveEdits(cleared.next.edits)).toEqual([]);
    d = written(write(cleared.next, { type: 'restore', editIds: cleared.removed }, 'f8'));
    expect(liveEdits(d.edits)).toMatchObject([{ kind: 'fit', minutes: 45 }]);
  });

  it('Undo restores the plan exactly: rows, SETS and TIME', () => {
    const before = plan([]);
    let d = written(write(null, { type: 'edit', edit: { kind: 'fit', minutes: 45 } }, 'u1'));
    const fit = liveEdits(d.edits)[0];
    expect(plan(liveEdits(d.edits)).fit?.status).toBe('fitted');
    d = written(write(d, { type: 'undo', editId: fit?.editId ?? '' }, 'u2'));
    const after = plan(liveEdits(d.edits));
    expect(after.aggregate.sets.map((s) => s.status)).toEqual(before.aggregate.sets.map((s) => s.status));
    expect(overview(after).workingSets).toBe(overview(before).workingSets);
    expect(overview(after).estimate).toEqual(overview(before).estimate);
    expect(after.aggregate.session.finishBy).toBeUndefined();
  });

  it('a Ben edit sent with a coach author is still Ben’s', () => {
    const d = written(write(null, { type: 'edit', edit: { kind: 'sets', slotKey: SLOT_FLY, workingSets: 2, author: 'coach', actionId: id(9) } as Body }, 'b1'));
    expect(liveEdits(d.edits)[0]?.author).toBeUndefined();
    expect(resolveTodayEdits(SLOTS, d.edits).coachEdits.size).toBe(0);
  });

  it('the fit survives a force-close: it is in the saved draft, and a re-read plans the same', () => {
    const d = written(write(null, { type: 'edit', edit: { kind: 'fit', minutes: 45 } }, 'r1'));
    const reread = PreStartDraftSchema.parse(JSON.parse(JSON.stringify(d)));
    expect(plan(liveEdits(reread.edits)).fit?.lines).toEqual(plan(liveEdits(d.edits)).fit?.lines);
  });
});

describe('the overview with a fit (§3.1, §3.3, FT-C18)', () => {
  it('tile, card, `5 EXERCISES · FITTED`, TRIMMED and SKIPPED markers, SETS without the cut sets, VoiceOver', () => {
    const out = plan([edit({ kind: 'fit', minutes: 45 })]);
    const view = overview(out);
    expect(view.fit).toMatchObject({ title: 'Fitted to 45 min', beforeAfter: '≈ 55 → 45 min', tileLabel: 'Time · fit 45', by: 'built_in', status: 'fitted' });
    expect(view.fit?.lines).toEqual(['Lateral raise · 3 → 2 sets', 'Triceps pushdown · 3 → 2 sets', 'Cable fly · skipped']);
    expect(view.fit?.accessibilityLabel).toBe('Fitted to 45 minutes. About 55 minutes to about 45 minutes. Lateral raise 3 to 2 sets. Triceps pushdown 3 to 2 sets. Cable fly skipped.');
    expect(view.estimate?.minutes).toBe(45);
    expect(view.editCount).toBe(0);
    // SETS: bench 3, incline 3, raise 2, pushdown 2.
    expect(view.workingSets).toBe(10);
    const raise = view.rows.find((r) => r.slotKey === SLOT_RAISE);
    expect(raise?.marker).toMatchObject({ kind: 'trimmed', word: 'Trimmed', glyph: 'clock' });
    expect(raise?.detail).toBe('2 × 12–15');
    expect(raise?.accessibilityLabel).toContain('trimmed to fit');
    // `[+]` on a trimmed row writes Ben's count; it never clears back into the trim.
    expect(raise?.editRow.setsUp).toEqual({ workingSets: 3, clear: false });
    expect(raise?.editRow.setsDown).toEqual({ workingSets: 1, clear: false });
    const fly = view.rows.find((r) => r.slotKey === SLOT_FLY);
    expect(fly?.marker.kind).toBe('skipped');
    expect(fly?.load.value).toBe('—');
    expect(fly?.detail).toBe('3 × 12–15');
    expect(view.rows.find((r) => r.slotKey === SLOT_BENCH)?.marker.kind).not.toBe('trimmed');
  });

  it('`How long?`: Now equals the tile; default chip is the live fit, else the largest below Now; Ask coach offline', () => {
    const none = overview(plan([]));
    const sheet = howLongSheet({ nowSeconds: none.estimate?.seconds ?? null, nowMinutes: none.estimate?.minutes ?? null, unfittedSeconds: none.estimate?.seconds ?? null, fitMinutes: null, chosen: null, coachAvailable: false });
    expect(sheet.nowText).toBe(`Now ≈ ${String(none.estimate?.minutes)} min`);
    expect(sheet.selected).toBe(45);
    expect(sheet.trim).toEqual({ text: 'Trim to 45 min', enabled: true, minutes: 45 });
    expect(sheet.ask).toEqual({ text: 'Ask coach', enabled: false, caption: 'Coach offline', lengthen: false });
    expect(sheet.clear).toBe(false);
    expect(sheet.chips.map((c) => c.text)).toEqual(['30', '45', '60', '75', '90']);
    const live = howLongSheet({ nowSeconds: 44.5 * 60, nowMinutes: 45, unfittedSeconds: 55.67 * 60, fitMinutes: 30, chosen: null, coachAvailable: true });
    expect(live).toMatchObject({ selected: 30, clear: true, trim: { text: 'Trim to 30 min', enabled: true } });
    const other = howLongSheet({ nowSeconds: 3000, nowMinutes: 50, unfittedSeconds: 3000, fitMinutes: null, chosen: 35, coachAvailable: true });
    expect(other.other).toEqual({ selected: true, text: '35' });
    expect(fitWheelMinutes()[0]).toBe(15);
    expect(fitWheelMinutes().at(-1)).toBe(180);
  });

  it('a fit’s minutes never read at or under its length while over', () => {
    expect(fitMinutesOf(47 * 60, 'over', 45)).toBe(50);
    expect(fitMinutesOf(47 * 60, 'fitted', 50)).toBe(45);
    expect(overByMinutes(52 * 60, 45)).toBe(7);
    expect(overByMinutes(45 * 60 + 5, 45)).toBe(1);
    expect(roundEstimateMinutes(44.5 * 60)).toBe(45);
    expect(planPace([])).toMatchObject({ source: 'default', secondsPerSet: 45, changeoverSeconds: 120 });
  });

  it('the template card never lists a fit: it is today only (rule 2)', () => {
    const out = plan([edit({ kind: 'fit', minutes: 30 })]);
    const lines = templateLinesFromEdits({ routine: pushA(), resolved: out.resolved, today: todayShapes(out.aggregate, out.slotOf), nameOf: (x) => EXERCISES.get(x)?.name ?? 'Exercise' });
    expect(lines).toEqual([]);
  });
});

function ctxAt(gym: { id: string; name: string; equipment: readonly EquipmentInstance[] }, over: Partial<SubstituteContext> = {}): SubstituteContext {
  return { ownerId: OWNER, unit: 'kg', gym, knownEquipment: KNOWN, painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(0), ...over };
}

import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, Exercise, Load, NextSessionTargetRecord, PainFlag, PlannedSet, Routine, SessionAggregate } from '@fizz/schemas';

import {
  bestSet,
  buildWorkoutOverview,
  changeText,
  coachTargetText,
  equipmentKey,
  isComparable,
  lastComparable,
  lastText,
  loadCell,
  NBSP,
  markerSpoken,
  markerWords,
  overviewDoneBy,
  pastExercisesOf,
  planRoutineStart,
  overviewCoachOf,
  platesText,
  previewFence,
  previewKey,
  roundedText,
  sameEquipmentKind,
  setsDetail,
  statStripSpoken,
  targetChangeMarker,
  type OverviewInput,
  type PastExercise,
  type PlannedFirst,
  type PreviewKeyParts,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, profile, routine, routineExercise, stack, template, TZ } from './fixtures';

const NB = '\u00a0';
const plain = (s: string | null | undefined): string => (s ?? '').replaceAll(NB, ' ');

/** One past appearance, built by hand for the marker rules. */
function past(over: Partial<PastExercise> = {}): PastExercise {
  return {
    sessionId: id(900),
    performedAt: at(-7 * 86_400),
    imported: false,
    equipment: equipmentKey(barbell()),
    convention: 'total',
    unit: 'kg',
    targets: [1, 2, 3].map(() => ({ setType: 'working' as const, load: kg(97.5), reps: { min: 6, max: 8 }, durationS: null })),
    actuals: [8, 8, 8].map((r) => ({ setType: 'working' as const, load: kg(97.5), reps: r, durationS: null })),
    ...over,
  };
}

const planned = (over: Partial<PlannedFirst> = {}): PlannedFirst => ({ load: kg(100), reps: { min: 6, max: 8 }, durationS: null, workingSets: 3, convention: 'total', ...over });
const flag = { id: id(77) };

describe('targetChangeMarker (§4, OV6)', () => {
  it('each row in order: HELD, NEW, NO LOAD, UP/DOWN, REPS, SETS, SAME', () => {
    const p = past();
    expect(targetChangeMarker(planned(), p, flag, null).kind).toBe('held');
    expect(targetChangeMarker(planned(), null, null, null).kind).toBe('new');
    const dropped = { kind: 'dropped', requested: kg(30, 'stack'), reason: 'equipment_not_in_gym', missing: 'Cable stack' } as const;
    expect(targetChangeMarker(planned({ load: null }), p, null, dropped).kind).toBe('no_load');
    expect(targetChangeMarker(planned(), p, null, null).kind).toBe('up');
    expect(targetChangeMarker(planned({ load: kg(95) }), p, null, null).kind).toBe('down');
    expect(targetChangeMarker(planned({ load: kg(97.5), reps: { min: 8, max: 10 } }), p, null, null).kind).toBe('reps_up');
    expect(targetChangeMarker(planned({ load: kg(97.5), reps: { min: 5, max: 8 } }), p, null, null).kind).toBe('reps_down');
    expect(targetChangeMarker(planned({ load: kg(97.5), workingSets: 4 }), p, null, null).kind).toBe('sets_up');
    expect(targetChangeMarker(planned({ load: kg(97.5), workingSets: 2 }), p, null, null).kind).toBe('sets_down');
    expect(targetChangeMarker(planned({ load: kg(97.5) }), p, null, null).kind).toBe('same');
  });

  it('pain beats load up; NEW beats NO LOAD; load beats reps; reps beat sets', () => {
    const p = past();
    const held = targetChangeMarker(planned({ load: kg(97.5), reps: { min: 8, max: 10 } }), p, flag, null);
    expect(held.kind).toBe('held');
    // HELD still carries the size of any difference for the panel's CHANGE line.
    expect(held.delta).toEqual({ kind: 'reps', by: 2 });
    const dropped = { kind: 'dropped', requested: kg(30, 'stack'), reason: 'equipment_not_in_gym', missing: null } as const;
    expect(targetChangeMarker(planned({ load: null }), null, null, dropped).kind).toBe('new');
    expect(targetChangeMarker(planned({ reps: { min: 8, max: 10 }, workingSets: 4 }), p, null, null).kind).toBe('up');
    expect(targetChangeMarker(planned({ load: kg(97.5), reps: { min: 8, max: 10 }, workingSets: 4 }), p, null, null).kind).toBe('reps_up');
  });

  it('kg ↔ lb: a converted load within 1% is the same; a real change is measured in today’s unit', () => {
    const p = past({ targets: [{ setType: 'working', load: kg(100), reps: { min: 6, max: 8 }, durationS: null }, { setType: 'working', load: kg(100), reps: { min: 6, max: 8 }, durationS: null }, { setType: 'working', load: kg(100), reps: { min: 6, max: 8 }, durationS: null }] });
    expect(targetChangeMarker(planned({ load: lb(220) }), p, null, null).kind).toBe('same');
    const up = targetChangeMarker(planned({ load: lb(230) }), p, null, null);
    expect(up.kind).toBe('up');
    expect(plain(changeText(up))).toMatch(/^↑ 9\.54 lb · vs \d+ Oct$/);
    // Same unit: exact, so a single 1.25 kg step is a change.
    expect(targetChangeMarker(planned({ load: kg(101.25) }), p, null, null).kind).toBe('up');
  });

  it('per-hand dumbbells: compared per hand, and the change says each', () => {
    const p = past({ equipment: equipmentKey(dumbbells()), convention: 'per_hand', targets: [{ setType: 'working', load: kg(32, 'per_hand'), reps: { min: 8, max: 10 }, durationS: null }] });
    const m = targetChangeMarker(planned({ load: kg(30, 'per_hand'), reps: { min: 8, max: 10 }, workingSets: 1, convention: 'per_hand' }), p, null, null);
    expect(m.kind).toBe('down');
    expect(plain(changeText(m))).toMatch(/^↓ 2 kg each · vs /);
    expect(markerSpoken(m)).toMatch(/^load down 2 kilograms each from \d+ October$/);
  });

  it('an assisted machine: less assistance is UP, more is DOWN', () => {
    const p = past({ equipment: equipmentKey(assisted()), convention: 'assistance', targets: [{ setType: 'working', load: kg(25, 'assistance'), reps: { min: 6, max: 8 }, durationS: null }] });
    const less = targetChangeMarker(planned({ load: kg(20, 'assistance'), workingSets: 1, convention: 'assistance' }), p, null, null);
    expect(less.kind).toBe('up');
    expect(plain(changeText(less))).toMatch(/^↑ 5 kg less assistance/);
    expect(targetChangeMarker(planned({ load: kg(30, 'assistance'), workingSets: 1, convention: 'assistance' }), p, null, null).kind).toBe('down');
  });

  it('a workout with no targets compares load only, against its heaviest counted set', () => {
    const p = past({
      targets: [],
      actuals: [
        { setType: 'working', load: kg(60), reps: 8, durationS: null },
        { setType: 'working', load: kg(70), reps: 5, durationS: null, exclusions: ['spotted'] },
        { setType: 'working', load: kg(62.5), reps: 6, durationS: null },
      ],
    });
    // 70 was spotted: it doesn't count, so the bar is 62.5.
    expect(targetChangeMarker(planned({ load: kg(62.5), reps: { min: 10, max: 12 }, workingSets: 5 }), p, null, null).kind).toBe('same');
    expect(targetChangeMarker(planned({ load: kg(65) }), p, null, null).kind).toBe('up');
  });

  it('comparable: same equipment kind and bar, same convention, never imported (a different bar is NEW)', () => {
    const key = { equipment: equipmentKey(barbell()), convention: 'total' as const };
    expect(isComparable(key, past())).toBe(true);
    expect(isComparable(key, past({ equipment: equipmentKey(barbell({ barMass: 15 })) }))).toBe(false);
    expect(isComparable(key, past({ imported: true }))).toBe(false);
    expect(isComparable(key, past({ convention: 'stack', equipment: equipmentKey(stack()) }))).toBe(false);
    // Another gym's bar of the same mass (in lb) still compares.
    expect(sameEquipmentKind(equipmentKey(barbell()), equipmentKey(barbell({ unit: 'lb', barMass: 44.0925 })))).toBe(true);
    expect(sameEquipmentKind(equipmentKey(barbell()), equipmentKey(barbell({ id: id(555) })))).toBe(true);
    expect(sameEquipmentKind(null, null)).toBe(true);
    const newer = past({ sessionId: id(901), performedAt: at(-86_400), equipment: equipmentKey(barbell({ barMass: 15 })) });
    expect(lastComparable(key, [newer, past()])?.sessionId).toBe(id(900));
    const m = targetChangeMarker(planned(), lastComparable(key, [newer]), null, null);
    expect(m).toEqual({ kind: 'new', delta: null, basis: null });
  });

  it('markers never use done, danger or accent styling; HELD and NO LOAD carry an icon and a word', () => {
    for (const kind of ['held', 'new', 'no_load', 'up', 'down', 'reps_up', 'reps_down', 'sets_up', 'sets_down', 'same'] as const) {
      const w = markerWords(kind);
      expect(['warning', 'secondary']).toContain(w.tone);
      if (w.tone === 'warning') expect(w.glyph).toBe('warning');
      expect(w.word.length).toBeGreaterThan(0);
    }
  });
});

describe('load cells, details and panel text', () => {
  it('formats each load convention for the TARGET column', () => {
    expect(loadCell(kg(100), 'total', 'barbell', false)).toMatchObject({ value: '100', unit: 'kg', spoken: 'target 100 kilograms' });
    expect(loadCell(kg(32, 'per_hand'), 'per_hand', 'dumbbells', false)).toMatchObject({ value: '32', unit: 'kg each' });
    expect(loadCell(kg(25, 'stack'), 'stack', 'weight_stack', false)).toMatchObject({ value: '25', unit: 'kg' });
    expect(loadCell(kg(20, 'assistance'), 'assistance', 'assisted_stack', false)).toMatchObject({ value: '−20', unit: 'kg', spoken: 'target 20 kilograms of assistance' });
    expect(loadCell(null, 'bodyweight', null, false)).toMatchObject({ value: 'BW', unit: null });
    expect(loadCell(kg(10, 'added'), 'added', 'bodyweight_station', false)).toMatchObject({ value: '+10', unit: 'kg' });
    expect(loadCell(null, 'stack', null, true)).toMatchObject({ value: '—', none: true });
    expect(loadCell(lb(225), 'total', 'barbell', false).spoken).toBe('target 225 pounds');
  });

  it('sets detail: ranges, timed sets, unilateral and mixed targets', () => {
    const s = (reps: [number, number] | null, durationS: number | null = null) => ({ planned: { load: null, reps: reps ? { min: reps[0], max: reps[1] } : null, durationS, rpe: null, rir: null } });
    expect(plain(setsDetail([s([6, 8]), s([6, 8]), s([6, 8])], false))).toBe('3 × 6–8');
    expect(plain(setsDetail([s(null, 45), s(null, 45), s(null, 45)], false))).toBe('3 × 0:45');
    expect(plain(setsDetail([s([10, 10]), s([10, 10]), s([10, 10])], true))).toBe('3 × 10 each side');
    expect(plain(setsDetail([s([3, 5]), s([6, 8]), s([6, 8])], false))).toBe('1 × 3–5 + 2 × 6–8');
  });

  it('LAST is the actual sets; BEST is the heaviest counted actual set, never an estimate', () => {
    expect(plain(lastText(past()))).toBe('97.5 kg × 8, 8, 8');
    expect(plain(lastText(past({ actuals: [{ setType: 'top', load: kg(100), reps: 5, durationS: null }, { setType: 'backoff', load: kg(90), reps: 8, durationS: null }] })))).toBe('100 kg × 5, 90 kg × 8');
    const key = { equipment: equipmentKey(barbell()), convention: 'total' as const };
    const older = past({ sessionId: id(902), performedAt: at(-30 * 86_400), actuals: [{ setType: 'working', load: kg(102.5), reps: 5, durationS: null }, { setType: 'working', load: kg(110), reps: 3, durationS: null, exclusions: ['spotted'] }] });
    const best = bestSet(key, [past(), older]);
    expect(best?.load).toEqual(kg(102.5));
    expect(best?.reps).toBe(5);
    expect(bestSet(key, [past({ imported: true, actuals: [{ setType: 'working', load: kg(150), reps: 1, durationS: null }] })])).toBeNull();
  });

  it('BEST on an assisted machine is the least assistance, not the most (N5)', () => {
    const key = { equipment: equipmentKey(assisted()), convention: 'assistance' as const };
    const p = past({
      equipment: equipmentKey(assisted()),
      convention: 'assistance',
      actuals: [
        { setType: 'working', load: kg(30, 'assistance'), reps: 8, durationS: null },
        { setType: 'working', load: kg(20, 'assistance'), reps: 6, durationS: null },
        { setType: 'working', load: kg(20, 'assistance'), reps: 7, durationS: null },
      ],
    });
    expect(bestSet(key, [p])).toMatchObject({ load: kg(20, 'assistance'), reps: 7 });
  });

  it('PLATES per side with the bar; ROUNDED names the cap or the steps', () => {
    expect(plain(platesText(kg(100), barbell()))).toBe('20 · 20 a side · 20 kg bar');
    expect(plain(platesText(kg(20), barbell()))).toBe('Bar only · 20 kg bar');
    expect(platesText(kg(101), barbell())).toBeNull();
    const rack = dumbbells({ loads: [10, 20, 30] });
    expect(plain(roundedText({ kind: 'rounded', requested: kg(32, 'per_hand'), planned: kg(30, 'per_hand'), bounded: 'max', converted: false }, rack))).toBe('Rack tops out at 30 kg each');
    const st = stack({ stackLoads: [15, 20], addOns: [2.5] });
    expect(roundedText({ kind: 'rounded', requested: kg(18.75, 'stack'), planned: kg(17.5, 'stack'), bounded: null, converted: false }, st)).toBe('Stack goes 15 → 17.5 → 20');
  });

  it('DONE BY rounds to 5 min; the strip reads as one sentence', () => {
    const now = Date.UTC(2026, 9, 10, 17, 8, 0);
    expect(overviewDoneBy(now, 55 * 60, 'Europe/London')).toMatchObject({ text: '19:05' });
    expect(overviewDoneBy(now + 60_000, 55 * 60, 'Europe/London').text).toBe('19:05');
    expect(statStripSpoken(55, '19:05', 15)).toBe('About 55 minutes, done about 19:05, 15 working sets');
    expect(statStripSpoken(null, null, 1)).toBe('1 working set');
  });
});

describe('previewKey (§7)', () => {
  const base: PreviewKeyParts = {
    target: { kind: 'routine', routineId: id(300) },
    routine: { id: id(300), version: 1 },
    gym: { id: GYM, equipment: [{ id: id(100), version: 1 }, { id: id(101), version: 2 }] },
    source: { id: id(900), revision: 4 },
    painFlags: [],
    coachActions: [],
    unit: 'kg',
    checkIn: null,
  };
  it('is stable for the same inputs in any order, and changes with each input that can change a target', () => {
    const k = previewKey(base);
    expect(previewKey({ ...base, gym: { id: GYM, equipment: [{ id: id(101), version: 2 }, { id: id(100), version: 1 }] } })).toBe(k);
    const changed: PreviewKeyParts[] = [
      { ...base, routine: { id: id(300), version: 2 } },
      { ...base, gym: { id: GYM, equipment: [{ id: id(100), version: 2 }, { id: id(101), version: 2 }] } },
      { ...base, gym: { id: id(3), equipment: [] } },
      { ...base, gym: { typical: true } },
      { ...base, source: { id: id(900), revision: 5 } },
      { ...base, painFlags: [{ id: id(77), version: 1 }] },
      { ...base, coachActions: [{ id: id(88), version: 1 }] },
      { ...base, unit: 'lb' },
      { ...base, checkIn: { id: id(66), version: 1 } },
    ];
    for (const c of changed) expect(previewKey(c)).not.toBe(k);
  });
});

// ---------------------------------------------------------------------------
// The whole page over a real dry run (OV3, OV6 cap, OV7, superset)

const BENCH = id(210);
const INCLINE = id(211);
const FLY = id(212);
const RAISE = id(213);
const PUSHDOWN = id(214);
const PULLUP = id(215);
const DIP = id(216);
const PLANK = id(217);

const exercisesMap = new Map<string, Exercise>([
  [BENCH, exercise(210, 'Bench press', { primaryMuscles: ['chest'] })],
  [INCLINE, exercise(211, 'Incline dumbbell press', { primaryMuscles: ['upper_chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [FLY, exercise(212, 'Cable fly', { primaryMuscles: ['chest'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' })],
  [RAISE, exercise(213, 'Lateral raise', { primaryMuscles: ['side_delts'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [PUSHDOWN, exercise(214, 'Triceps pushdown', { primaryMuscles: ['triceps'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' })],
  [PULLUP, exercise(215, 'Assisted pull-up', { primaryMuscles: ['lats'], compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })],
  [DIP, exercise(216, 'Weighted dip', { primaryMuscles: ['triceps'], compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'added' })],
  [PLANK, exercise(217, 'Plank', { measurement: 'duration', compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' })],
]);

const bar = barbell({ plates: [{ mass: 25, count: 4 }, { mass: 20, count: 2 }, { mass: 10, count: 2 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }, { mass: 1.25, count: 2 }] });
const rack = dumbbells({ loads: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30] });
const cable = stack({ stackLoads: [5, 10, 15, 20, 25, 30, 35, 40], addOns: [2.5] });
const assist = assisted();

function pushA(): Routine {
  return routine([
    routineExercise(600, {
      exerciseId: BENCH,
      equipmentId: bar.id,
      order: 0,
      setTemplates: [
        template(6001, { setType: 'warmup', targetLoad: kg(20), targetReps: { min: 10, max: 10 } }),
        template(6002, { setType: 'warmup', targetLoad: kg(60), targetReps: { min: 5, max: 5 } }),
        template(6003, { setType: 'warmup', targetLoad: kg(80), targetReps: { min: 3, max: 3 } }),
        template(6004, { targetLoad: kg(100) }),
        template(6005, { targetLoad: kg(100) }),
        template(6006, { targetLoad: kg(100) }),
      ],
    }),
    routineExercise(601, { exerciseId: INCLINE, equipmentId: rack.id, order: 1, setTemplates: [6011, 6012, 6013].map((n) => template(n, { targetLoad: kg(32, 'per_hand'), targetReps: { min: 8, max: 10 } })) }),
    routineExercise(602, { exerciseId: FLY, equipmentId: cable.id, order: 2, setTemplates: [6021, 6022, 6023].map((n) => template(n, { targetLoad: kg(18.75, 'stack'), targetReps: { min: 12, max: 15 } })) }),
    routineExercise(603, { exerciseId: RAISE, equipmentId: rack.id, order: 3, supersetGroup: 'A', setTemplates: [6031, 6032, 6033].map((n) => template(n, { targetLoad: kg(10, 'per_hand'), targetReps: { min: 12, max: 15 } })) }),
    routineExercise(604, { exerciseId: PUSHDOWN, equipmentId: cable.id, order: 4, supersetGroup: 'A', setTemplates: [6041, 6042, 6043].map((n) => template(n, { targetLoad: kg(25, 'stack'), targetReps: { min: 10, max: 12 } })) }),
  ]);
}

function dryRun(r: Routine, gymEquipment: readonly EquipmentInstance[], known: readonly EquipmentInstance[] = gymEquipment) {
  return planRoutineStart({
    opId: 'preview',
    owner: profile(),
    gymId: GYM,
    routine: r,
    exercises: exercisesMap,
    gymEquipment,
    knownEquipment: new Map(known.map((e) => [e.id, e])),
    at: at(0),
    newId: idGen(20_000),
  });
}

/** A finished copy of a dry run, every set done as planned (or with `reps`). `load` replaces the target and the result. */
function finishedFrom(agg: SessionAggregate, sessionId: string, startedAtSeconds: number, opts: { load?: (l: Load | null) => Load | null; reps?: number } = {}): SessionAggregate {
  return {
    ...agg,
    session: { ...agg.session, id: sessionId, status: 'finished', startedAt: at(startedAtSeconds) },
    sets: agg.sets.map((s) => ({
      ...s,
      planned: opts.load ? { ...s.planned, load: opts.load(s.planned.load) } : s.planned,
      status: 'completed',
      actual: { load: opts.load ? opts.load(s.planned.load) : s.planned.load, reps: opts.reps ?? s.planned.reps?.max ?? null, durationS: s.planned.durationS, rpe: null, rir: null },
      completedAt: at(startedAtSeconds + 60),
    })),
  };
}

function overviewOf(out: ReturnType<typeof dryRun>, history: readonly SessionAggregate[], over: Partial<OverviewInput> = {}) {
  const pasts: Record<string, PastExercise[]> = {};
  for (const ex of out.aggregate.exercises) pasts[ex.exerciseId] = pastExercisesOf(history, ex.exerciseId);
  return buildWorkoutOverview({
    aggregate: out.aggregate,
    fits: out.fits,
    pasts,
    painFlags: [],
    exerciseInfo: Object.fromEntries([...exercisesMap].map(([k, e]) => [k, e])),
    recent: [],
    nowMs: ms(0),
    tz: TZ,
    title: 'Push A',
    basis: { kind: 'only' },
    gym: { id: GYM, name: 'Main gym' },
    key: { target: { kind: 'routine', routineId: id(300) }, routine: { id: id(300), version: 1 }, gym: { id: GYM, equipment: [] }, source: null, painFlags: [], coachActions: [], unit: 'kg', checkIn: null },
    ...over,
  });
}

function painFlag(exerciseId: string): PainFlag {
  return {
    id: id(77),
    ownerId: id(1),
    version: 1,
    createdAtUtc: at(-86_400).utc,
    updatedAtUtc: at(-86_400).utc,
    exerciseId,
    exerciseName: 'Incline dumbbell press',
    area: 'shoulder',
    source: 'workout',
    checkInId: null,
    reportedAt: at(-86_400),
    status: 'active',
    clearedAtUtc: null,
    createdByOpId: 'op-pain',
  };
}

describe('buildWorkoutOverview over the shared dry run', () => {
  it('OV3: every row’s sets, reps and load equal the pending targets Start would create', () => {
    const out = dryRun(pushA(), [bar, rack, cable]);
    const view = overviewOf(out, []);
    expect(view.exerciseCount).toBe(5);
    expect(view.workingSets).toBe(15);
    for (const row of view.rows) {
      const ex = out.aggregate.exercises.find((e) => e.id === row.sessionExerciseId);
      const working = out.aggregate.sets.filter((s) => s.sessionExerciseId === row.sessionExerciseId && s.setType !== 'warmup').sort((a, b) => a.index - b.index);
      const first = working[0];
      expect(ex?.exerciseName).toBe(row.name);
      expect(plain(row.detail).startsWith(`${String(working.length)} × `)).toBe(true);
      expect(row.firstSetId).toBe(first?.id);
      const cell = loadCell(first?.planned.load ?? null, ex?.loadConvention ?? 'total', null, false);
      expect(row.load.value).toBe(cell.value);
    }
    expect(view.rows.map((r) => r.load.value)).toEqual(['100', '30', '17.5', '10', '25']);
    expect(plain(view.rows[0]?.detail)).toBe('3 × 6–8 · 3 warm-ups');
    expect(view.muscles).toEqual(['Chest', 'Shoulders', 'Triceps']);
    expect(view.estimate?.minutes).toBeGreaterThan(0);
  });

  it('every load convention: barbell, per dumbbell, stack, assisted, bodyweight + added, timed', () => {
    const r = routine([
      routineExercise(610, { exerciseId: BENCH, equipmentId: bar.id, setTemplates: [template(6101, { targetLoad: kg(100) })] }),
      routineExercise(611, { exerciseId: INCLINE, equipmentId: rack.id, order: 1, setTemplates: [template(6111, { targetLoad: kg(20, 'per_hand') })] }),
      routineExercise(612, { exerciseId: FLY, equipmentId: cable.id, order: 2, setTemplates: [template(6121, { targetLoad: kg(25, 'stack') })] }),
      routineExercise(613, { exerciseId: PULLUP, equipmentId: assist.id, order: 3, setTemplates: [template(6131, { targetLoad: kg(20, 'assistance') })] }),
      routineExercise(614, { exerciseId: DIP, equipmentId: null, order: 4, setTemplates: [template(6141, { targetLoad: kg(10, 'added') })] }),
      routineExercise(615, { exerciseId: PLANK, equipmentId: null, order: 5, setTemplates: [template(6151, { targetReps: null, targetDurationS: 45 })] }),
    ]);
    const out = dryRun(r, [bar, rack, cable, assist]);
    const view = overviewOf(out, []);
    expect(view.rows.map((x) => [x.load.value, x.load.unit])).toEqual([
      ['100', 'kg'],
      ['20', 'kg each'],
      ['25', 'kg'],
      ['−20', 'kg'],
      ['+10', 'kg'],
      ['BW', null],
    ]);
    expect(plain(view.rows[5]?.detail)).toBe('1 × 0:45');
    for (const row of view.rows) {
      const set = out.aggregate.sets.find((s) => s.id === row.firstSetId);
      expect(set?.status).toBe('pending');
    }
  });

  it('a rack max caps the target: DOWN with the info glyph, and ROUNDED says why (OV6)', () => {
    const main = dryRun(pushA(), [bar, dumbbells({ loads: [10, 20, 32] }), cable]);
    const lastWeek = finishedFrom(main.aggregate, id(910), -7 * 86_400);
    const hotel = dryRun(pushA(), [bar, rack, cable]);
    const view = overviewOf(hotel, [lastWeek]);
    const incline = view.rows[1];
    expect(incline?.marker.kind).toBe('down');
    expect(incline?.rounded).toBe(true);
    expect(incline?.load.value).toBe('30');
    expect(incline?.panel.find((l) => l.key === 'rounded')?.value).toBe(`Rack tops out at 30${NB}kg${NB}each`);
    expect(plain(incline?.panel.find((l) => l.key === 'change')?.value)).toMatch(/^↓ 2 kg each · vs /);
    // Rounded on the stack (18.75 → 17.5): the glyph, with the stack's steps.
    const fly = view.rows[2];
    expect(fly?.rounded).toBe(true);
    expect(fly?.panel.find((l) => l.key === 'rounded')?.value).toBe('Stack goes 15 → 17.5 → 20');
  });

  it('equipment not here: NO LOAD, a dash, reps kept, and the panel names the missing item', () => {
    const lastWeek = finishedFrom(dryRun(pushA(), [bar, rack, cable]).aggregate, id(911), -7 * 86_400);
    const out = dryRun(pushA(), [bar, rack], [bar, rack, cable]);
    const view = overviewOf(out, [lastWeek]);
    const fly = view.rows[2];
    expect(fly?.load).toMatchObject({ value: '—', none: true });
    expect(plain(fly?.detail)).toBe('3 × 12–15');
    // Last time still counts when the routine's equipment isn't here: NO LOAD, never NEW.
    expect(fly?.marker).toMatchObject({ kind: 'no_load', word: 'No load', glyph: 'warning', tone: 'warning' });
    expect(fly?.missingEquipment).toBe('Cable stack');
    expect(fly?.panel.find((l) => l.key === 'gym')).toMatchObject({ value: 'No cable stack here', tone: 'warning' });
    expect(fly?.rounded).toBe(false);
  });

  it('OV7: a pain-flagged exercise is HELD (icon + word), and the panel shows the flag', () => {
    const out = dryRun(pushA(), [bar, rack, cable]);
    const lastWeek = finishedFrom(out.aggregate, id(912), -7 * 86_400);
    const view = overviewOf(out, [lastWeek], { painFlags: [painFlag(INCLINE)] });
    const incline = view.rows[1];
    expect(incline?.marker).toMatchObject({ kind: 'held', word: 'Held', glyph: 'warning', tone: 'warning' });
    expect(incline?.painFlag).toMatchObject({ id: id(77), checkDue: false });
    expect(incline?.panel.find((l) => l.key === 'flag')).toMatchObject({ label: 'Flag', tone: 'warning' });
    expect(incline?.accessibilityLabel).toContain('held, pain flag');
  });

  it('D1 (minimal copy): a built-in rule target has a one-word Rule line in its panel; a routine template has none', () => {
    const out = dryRun(pushA(), [bar, rack, cable]);
    const benchId = out.aggregate.exercises.find((e) => e.exerciseName === 'Bench press')?.id;
    const ruled = { ...out, aggregate: { ...out.aggregate, sets: out.aggregate.sets.map((x) => (x.sessionExerciseId === benchId ? { ...x, planned: { ...x.planned, source: 'built_in_rule' as const } } : x)) } };
    const view = overviewOf(ruled, []);
    expect(view.rows[0]?.panel.find((l) => l.key === 'rule')).toEqual({ key: 'rule', label: 'Rule', value: 'Built-in', tone: 'normal' });
    expect(view.rows[1]?.panel.some((l) => l.key === 'rule')).toBe(false);
  });

  it('the first barbell lift gets WARM-UP, PLATES, BEST and LAST; supersets group consecutive members', () => {
    const out = dryRun(pushA(), [bar, rack, cable]);
    const older = finishedFrom(out.aggregate, id(913), -21 * 86_400, { load: (l) => (l && l.convention === 'total' ? kg(102.5) : l), reps: 5 });
    const lastWeek = finishedFrom(out.aggregate, id(914), -7 * 86_400, { load: (l) => (l && l.convention === 'total' ? kg(97.5) : l), reps: 8 });
    const view = overviewOf(out, [lastWeek, older]);
    const bench = view.rows[0];
    const lines = Object.fromEntries((bench?.panel ?? []).map((l) => [l.key, plain(l.value)]));
    expect(lines.warmup).toBe('20 × 10 · 60 × 5 · 80 × 3');
    expect(lines.plates).toBe('25 · 10 · 5 a side · 20 kg bar');
    expect(lines.best).toMatch(/^102\.5 kg × 5 · \d+ Sep$/);
    expect(lines.last).toMatch(/^97\.5 kg × 8, 8, 8 · \d+ Oct$/);
    expect(bench?.marker.kind).toBe('up');
    // Only the first barbell lift.
    expect(view.rows[1]?.panel.some((l) => l.key === 'warmup' || l.key === 'plates' || l.key === 'best')).toBe(false);
    expect(view.groups.map((g) => (g.kind === 'single' ? g.row.name : g.rows.map((r) => r.name).join('+')))).toEqual(['Bench press', 'Incline dumbbell press', 'Cable fly', 'Lateral raise+Triceps pushdown']);
    expect(view.rows[3]?.supersetWith).toEqual(['Triceps pushdown']);
    expect(view.rows[0]?.accessibilityLabel).toMatch(/^1, Bench press, 3 sets of 6 to 8, 3 warm-ups, target 100 kilograms, load up 2\.5 kilograms from \d+ October$/);
  });

  it('opening the page is pure: the dry run is untouched and nothing is saved', () => {
    const out = dryRun(pushA(), [bar, rack, cable]);
    const before = JSON.stringify(out.aggregate);
    overviewOf(out, []);
    expect(JSON.stringify(out.aggregate)).toBe(before);
  });
});

describe('coach rows (§5): stored next-session targets only', () => {
  const record = (over: Partial<NextSessionTargetRecord> = {}): NextSessionTargetRecord => ({
    id: 'row-1',
    ownerId: id(1),
    version: 1,
    createdAtUtc: at(0).utc,
    updatedAtUtc: at(0).utc,
    sourceSessionId: id(500),
    sourceVersion: 3,
    exerciseId: id(600),
    exerciseName: 'Bench press',
    actionId: 'act-1',
    target: { load: kg(57.5), reps: null },
    sets: null,
    builtIn: null,
    builtInSets: null,
    size: 'small',
    status: 'saved',
    reason: 'Every set was RPE 10.',
    guardNotes: [],
    pctChange: -4.2,
    usedBySessionId: null,
    ...over,
  });
  const coachSet = (actionId = 'act-1'): { planned: PlannedSet } => ({
    planned: {
      load: kg(57.5),
      reps: { min: 8, max: 8 },
      durationS: null,
      rpe: null,
      rir: null,
      source: 'coach',
      provenance: { source: 'coach', setAt: at(0), routineName: null, requestedLoad: kg(57.5), basis: null, coach: { actionId, scope: 'next_session', reason: 'Every set was RPE 10.' }, guardNotes: [] },
    },
  });
  const ruleSet = (): { planned: PlannedSet } => ({ planned: { load: kg(62.5), reps: { min: 8, max: 8 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' } });
  const ctx = { sourceVersion: 3, painFlagged: false, painToday: false };

  it('Coach tag and stored reason when Start uses the coach’s target; nothing without a stored row (no AI, no canned text)', () => {
    expect(overviewCoachOf(coachSet(), record(), ctx)).toEqual({ state: 'coach', rowId: 'row-1', reason: 'Every set was RPE 10.' });
    expect(overviewCoachOf(coachSet(), undefined, ctx)).toBeNull();
    expect(overviewCoachOf(ruleSet(), undefined, ctx)).toBeNull();
    // A set planned from another coach action isn't this row's.
    expect(overviewCoachOf(coachSet('other'), record(), ctx)).toBeNull();
  });

  it('after Undo: the built-in target, with Use coach target only where Start would use it again', () => {
    const undone = record({ status: 'undone', version: 2 });
    expect(overviewCoachOf(ruleSet(), undone, ctx)).toEqual({ state: 'built_in', rowId: 'row-1', putBack: 'use_coach', target: `57.5${NBSP}kg` });
    expect(overviewCoachOf(ruleSet(), { ...undone, usedBySessionId: id(700) }, ctx)).toBeNull();
    expect(overviewCoachOf(ruleSet(), undone, { ...ctx, sourceVersion: 4 })).toBeNull();
    expect(overviewCoachOf(ruleSet(), undone, { ...ctx, painFlagged: true })).toBeNull();
    expect(overviewCoachOf(ruleSet(), undone, { ...ctx, painToday: true })).toBeNull();
    // A declined suggestion isn't offered again here.
    expect(overviewCoachOf(ruleSet(), record({ status: 'not_applied' }), ctx)).toBeNull();
  });

  it('a bigger change still to apply (or applied, then undone, so back to proposed) offers Apply, with the same checks (merge S1)', () => {
    const proposed = record({ status: 'proposed', size: 'bigger', version: 3, target: { load: kg(50), reps: { min: 6, max: 8 } }, sets: 4 });
    expect(overviewCoachOf(ruleSet(), proposed, ctx)).toEqual({ state: 'built_in', rowId: 'row-1', putBack: 'apply', target: `50${NBSP}kg${NBSP}×${NBSP}6–8 · 4${NBSP}sets` });
    expect(overviewCoachOf(ruleSet(), { ...proposed, usedBySessionId: id(700) }, ctx)).toBeNull();
    expect(overviewCoachOf(ruleSet(), proposed, { ...ctx, sourceVersion: 4 })).toBeNull();
    expect(overviewCoachOf(ruleSet(), proposed, { ...ctx, painFlagged: true })).toBeNull();
    expect(overviewCoachOf(ruleSet(), proposed, { ...ctx, painToday: true })).toBeNull();
    // Applied: Start uses it, so it's the Coach state with Undo.
    expect(overviewCoachOf(coachSet(), record({ status: 'applied', size: 'bigger' }), ctx)).toMatchObject({ state: 'coach' });
  });

  it('the stored target as a value only (merge N2): load, reps, sets, per hand', () => {
    expect(coachTargetText({ target: { load: kg(57.5), reps: null }, sets: null })).toBe(`57.5${NBSP}kg`);
    expect(coachTargetText({ target: { load: null, reps: { min: 10, max: 12 } }, sets: null })).toBe(`10–12${NBSP}reps`);
    expect(coachTargetText({ target: { load: null, reps: null }, sets: 3 })).toBe(`3${NBSP}sets`);
    expect(coachTargetText({ target: { load: { value: 50, unit: 'lb', convention: 'per_hand' }, reps: { min: 8, max: 8 } }, sets: null })).toBe(`50${NBSP}lb${NBSP}each${NBSP}×${NBSP}8`);
    expect(coachTargetText({ target: { load: null, reps: null }, sets: null })).toBe('—');
  });

  it('the stored rows are in the key and the start’s fence (ADR 0021): an Undo changes the key', () => {
    const parts: PreviewKeyParts = {
      target: { kind: 'next', sourceSessionId: id(500) },
      routine: null,
      gym: { id: GYM, equipment: [] },
      source: { id: id(500), revision: 3 },
      painFlags: [],
      coachActions: [{ id: 'row-1', version: 1 }],
      unit: 'kg',
      checkIn: null,
    };
    expect(previewKey(parts)).not.toBe(previewKey({ ...parts, coachActions: [{ id: 'row-1', version: 2 }] }));
    expect(previewFence(parts, id(1), null).sets).toContainEqual({ kind: 'next_session_targets', ownerId: id(1), sourceSessionId: id(500), members: [{ id: 'row-1', version: 1 }] });
    expect(previewFence({ ...parts, source: null }, id(1), null).sets.some((x) => x.kind === 'next_session_targets')).toBe(false);
  });
});


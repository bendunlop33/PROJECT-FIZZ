import { describe, expect, it } from 'vitest';
import type { RoutineExercise } from '@fizz/schemas';

import {
  addExercise,
  addSet,
  createRoutine,
  deleteSet,
  editorItemFor,
  editorMainFlags,
  editorSetRows,
  editorSummaryLine,
  fixedLoadFrame,
  fixedLoadNote,
  fixedLoadSeed,
  fixedLoadSteps,
  lastWorkingLoad,
  mergeRoutineEdits,
  moveExercise,
  planRoutineStart,
  removeExercise,
  replaceExercise,
  setMain,
  setRestBySetType,
  supersetWithNext,
  templateTargetText,
  ungroup,
  updateSet,
  NBSP,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, OWNER, profile, routineExercise, stack, template } from './fixtures';
import { BENCH, FACE, HANG, ROW } from './session-fixture';

const plain = (s: string | null) => (s ?? '').replaceAll(NBSP, ' ');
const ids = (list: readonly RoutineExercise[]) => list.map((e) => e.exerciseId);
const base = (): RoutineExercise[] => [
  routineExercise(10, { exerciseId: BENCH, order: 0 }),
  routineExercise(11, { exerciseId: ROW, order: 1 }),
  routineExercise(12, { exerciseId: FACE, order: 2 }),
];

describe('editor list changes (routines.md §A2.3, §4.3)', () => {
  it('add an exercise: three working sets Auto × 8–10, or 0:45 for a timed one, at the end', () => {
    const list = addExercise(base(), { id: HANG, measurement: 'duration' }, idGen(1000));
    expect(ids(list)).toEqual([BENCH, ROW, FACE, HANG]);
    expect(list[3]?.setTemplates.map((t) => [t.setType, t.targetLoad, t.targetReps, t.targetDurationS])).toEqual([
      ['working', null, null, 45],
      ['working', null, null, 45],
      ['working', null, null, 45],
    ]);
    const reps = addExercise([], { id: BENCH, measurement: 'reps' }, idGen(1100));
    expect(reps[0]?.setTemplates.map((t) => t.targetReps)).toEqual([{ min: 8, max: 10 }, { min: 8, max: 10 }, { min: 8, max: 10 }]);
    expect(ids(removeExercise(list, list[1]?.id ?? ''))).toEqual([BENCH, FACE, HANG]);
  });

  it('Move up / Move down keep order numbers; a move out of a superset leaves it', () => {
    const list = base();
    const up = moveExercise(list, list[2]?.id ?? '', 'up');
    expect(ids(up)).toEqual([BENCH, FACE, ROW]);
    expect(up.map((e) => e.order)).toEqual([0, 1, 2]);
    expect(ids(moveExercise(list, list[0]?.id ?? '', 'up'))).toEqual([BENCH, ROW, FACE]);
    const grouped = supersetWithNext(list, list[1]?.id ?? '');
    if (!grouped) throw new Error('no group');
    expect(grouped.map((e) => e.supersetGroup)).toEqual([null, 'A', 'A']);
    // Swapping places inside the group keeps it; moving the first member above the bench takes it out.
    expect(moveExercise(grouped, grouped[2]?.id ?? '', 'up').map((e) => [e.exerciseId, e.supersetGroup])).toEqual([
      [BENCH, null],
      [FACE, 'A'],
      [ROW, 'A'],
    ]);
    expect(moveExercise(grouped, grouped[1]?.id ?? '', 'up').map((e) => e.supersetGroup)).toEqual([null, null, null]);
  });

  it('Superset with next: up to 4 members, labels A, B in order; Ungroup splits it', () => {
    let list = [...base(), routineExercise(13, { exerciseId: HANG, order: 3 }), routineExercise(14, { exerciseId: BENCH, order: 4 })];
    list = supersetWithNext(list, list[0]?.id ?? '') ?? list;
    list = supersetWithNext(list, list[1]?.id ?? '') ?? list;
    list = supersetWithNext(list, list[2]?.id ?? '') ?? list;
    expect(list.map((e) => e.supersetGroup)).toEqual(['A', 'A', 'A', 'A', null]);
    expect(supersetWithNext(list, list[3]?.id ?? '')).toBeNull();
    expect(supersetWithNext(list, list[4]?.id ?? '')).toBeNull();
    expect(ungroup(list, list[2]?.id ?? '').map((e) => e.supersetGroup)).toEqual([null, null, null, null, null]);
    // Joining the next one onto an existing group grows that group.
    const three = supersetWithNext(supersetWithNext(base(), base()[0]?.id ?? '') ?? [], base()[1]?.id ?? '');
    expect(three?.map((e) => e.supersetGroup)).toEqual(['A', 'A', 'A']);
  });

  it('Replace keeps set types, reps, rest and Main; loads back to Auto, item and rule cleared (never converted)', () => {
    const list = base().map((e, i) =>
      i === 0 ? { ...e, main: true, equipmentId: id(100), progressionRuleId: id(400), setTemplates: [template(1, { targetLoad: kg(100), targetReps: { min: 4, max: 6 } })], restBySetType: { working: { seconds: 180 } } } : e,
    );
    const r = replaceExercise(list, list[0]?.id ?? '', { id: id(250), measurement: 'reps' })[0];
    expect(r).toMatchObject({ exerciseId: id(250), equipmentId: null, progressionRuleId: null, main: true, restBySetType: { working: { seconds: 180 } } });
    expect(r?.setTemplates.map((t) => [t.targetLoad, t.targetReps])).toEqual([[null, { min: 4, max: 6 }]]);
    const timed = replaceExercise(list, list[0]?.id ?? '', { id: HANG, measurement: 'duration' })[0];
    expect(timed?.setTemplates.map((t) => [t.targetReps, t.targetDurationS])).toEqual([[null, 45]]);
  });

  it('sets: + Warm-up goes first, + Working copies the last one; edit; delete; the last set can’t be deleted here', () => {
    const list = base();
    const slot = list[0]?.id ?? '';
    let next = updateSet(list, slot, list[0]?.setTemplates[0]?.id ?? '', { targetReps: { min: 6, max: 8 }, restOverrideS: 150 });
    next = addSet(next, slot, 'working', 'reps', idGen(2000));
    next = addSet(next, slot, 'warmup', 'reps', idGen(2100));
    next = addSet(next, slot, 'top', 'reps', idGen(2200));
    const sets = next[0]?.setTemplates ?? [];
    expect(sets.map((t) => [t.setType, t.targetReps, t.restOverrideS])).toEqual([
      ['warmup', { min: 5, max: 5 }, null],
      ['working', { min: 6, max: 8 }, 150],
      ['working', { min: 6, max: 8 }, null],
      ['top', { min: 8, max: 10 }, null],
    ]);
    const del = deleteSet(next, slot, sets[0]?.id ?? '');
    expect(del.kind === 'ok' && del.list[0]?.setTemplates).toHaveLength(3);
    expect(deleteSet(list, list[1]?.id ?? '', list[1]?.setTemplates[0]?.id ?? '')).toEqual({ kind: 'last_set' });
    // 30 sets is the most.
    let full = list;
    for (let i = 0; i < 40; i += 1) full = addSet(full, slot, 'working', 'reps', idGen(3000 + i * 10));
    expect(full[0]?.setTemplates).toHaveLength(30);
  });

  it('rest by set type: set, then Use default clears it; Main toggles are Ben’s', () => {
    const list = setRestBySetType(base(), base()[0]?.id ?? '', 'warmup', { seconds: 60, presetName: 'Warm-up' });
    expect(list[0]?.restBySetType).toEqual({ warmup: { seconds: 60, presetName: 'Warm-up' } });
    expect(setRestBySetType(list, list[0]?.id ?? '', 'warmup', null)[0]?.restBySetType).toEqual({});
    const compound = (x: string) => x === BENCH;
    expect(editorMainFlags(list, compound)).toEqual([true, false, false]);
    const toggled = setMain(setMain(list, list[0]?.id ?? '', false), list[2]?.id ?? '', true);
    expect(editorMainFlags(toggled, compound)).toEqual([false, false, true]);
    // Stored and survives a save.
    const saved = createRoutine({ id: id(990), ownerId: OWNER, edit: { name: 'X', exercises: toggled }, opId: 'o', at: at(0), isCompound: compound });
    expect(saved.kind === 'write' && saved.next.exercises.map((e) => e.main)).toEqual([false, false, true]);
  });
});

describe('what the editor shows', () => {
  const ctx = { exerciseName: 'Bench press', convention: 'total' as const, equipment: null, exerciseDefaultRestS: 120, globalDefault: { seconds: 90 }, perSide: false };
  it('collapses identical sets, shows targets and resolved rest, marks a set’s own rest', () => {
    const slot = {
      setTemplates: [
        template(1, { setType: 'warmup', targetReps: { min: 5, max: 5 } }),
        template(2, { setType: 'top', targetReps: { min: 4, max: 6 } }),
        template(3),
        template(4),
        template(5, { restOverrideS: 150 }),
      ],
      restBySetType: { warmup: { seconds: 60 }, top: { seconds: 180 } },
    };
    const rows = editorSetRows(slot, ctx);
    expect(rows.map((r) => [r.numbers, r.badge, r.typeWord, plain(r.target), r.rest, r.ownRest])).toEqual([
      ['1', 'W', 'Warm-up', 'Auto × 5', '1:00', false],
      ['2', 'T', 'Top set', 'Auto × 4–6', '3:00', false],
      ['3–4', null, 'Working', 'Auto × 6–8', '2:00', false],
      ['5', null, 'Working', 'Auto × 6–8', '2:30', true],
    ]);
    expect(rows[2]?.accessibilityLabel).toBe('Sets 3 to 4, Working, Auto times 6–8, rest 2:00');
    expect(rows[3]?.accessibilityLabel).toContain("this set's own rest");
    expect(plain(templateTargetText(template(9, { targetLoad: kg(30, 'per_hand'), targetReps: { min: 8, max: 8 } }), { convention: 'per_hand', equipment: { kind: 'dumbbells' }, perSide: false }))).toBe('30 kg each × 8');
    expect(plain(templateTargetText(template(9, { targetReps: { min: 8, max: 10 } }), { convention: 'per_hand', equipment: null, perSide: true }))).toBe('Auto × 8–10 per side');
    expect(plain(templateTargetText(template(9, { targetReps: null, targetDurationS: 45 }), { convention: 'bodyweight', equipment: null, perSide: false }))).toBe('BW · 0:45');
    expect(plain(editorSummaryLine(5, 55, 'Main gym'))).toBe('5 exercises · ≈ 55 min at Main gym');
    expect(editorSummaryLine(1, null, null)).toBe('1 exercise');
  });
});

describe('Fixed load seed (design pass 5.1): Auto → Fixed starts from the last logged load, snapped', () => {
  const ws = (load: ReturnType<typeof kg> | null, setType: 'working' | 'warmup' = 'working') => ({ setType, side: null, load, reps: 8, rpe: null, rir: null });
  const h = (utc: string, sets: ReturnType<typeof ws>[]) => ({ performedAtUtc: utc, sets });

  it('the newest workout’s heaviest working set; warm-ups and no-load sets don’t count; assisted: least assistance', () => {
    expect(lastWorkingLoad([h('2026-10-01T06:00:00.000Z', [ws(kg(90))]), h('2026-10-08T06:00:00.000Z', [ws(kg(60), 'warmup'), ws(kg(100)), ws(kg(97.5))])])).toEqual(kg(100));
    expect(lastWorkingLoad([h('2026-10-08T06:00:00.000Z', [ws(null)]), h('2026-10-01T06:00:00.000Z', [ws(kg(80))])])).toEqual(kg(80));
    expect(lastWorkingLoad([h('2026-10-08T06:00:00.000Z', [ws(kg(30, 'assistance')), ws(kg(20, 'assistance'))])])).toEqual(kg(20, 'assistance'));
    expect(lastWorkingLoad([])).toBeNull();
  });

  it('bench: about 100 kg, not the bar; snapped toward easier on the plates', () => {
    const bar = barbell();
    expect(fixedLoadSeed(kg(100), { unit: 'kg', convention: 'total' }, bar)).toBe(100);
    expect(fixedLoadSeed(kg(101.3), { unit: 'kg', convention: 'total' }, bar)).toBe(100);
    expect(fixedLoadSeed(null, { unit: 'kg', convention: 'total' }, bar)).toBe(20);
  });

  it('per-hand dumbbells never past the rack max; lb last load on a kg rack is converted; other convention falls back', () => {
    const rack = dumbbells();
    expect(fixedLoadSeed(kg(40, 'per_hand'), { unit: 'kg', convention: 'per_hand' }, rack)).toBe(30);
    expect(fixedLoadSeed(lb(50, 'per_hand'), { unit: 'kg', convention: 'per_hand' }, rack)).toBe(22.5);
    expect(fixedLoadSeed(kg(100), { unit: 'kg', convention: 'per_hand' }, rack)).toBe(5);
  });

  it('assisted: more assistance is easier; with no item, the last load as is in the same unit, else 0', () => {
    expect(fixedLoadSeed(kg(22, 'assistance'), { unit: 'kg', convention: 'assistance' }, assisted())).toBe(25);
    expect(fixedLoadSeed(kg(100), { unit: 'kg', convention: 'total' }, null)).toBe(100);
    expect(fixedLoadSeed(lb(225), { unit: 'kg', convention: 'total' }, null)).toBe(0);
  });
});

describe('Fixed loads (§2.3 set sheet; rule 4)', () => {
  const rack = dumbbells({ loads: [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30] });
  it('37.5 kg each on a 30 kg rack: saves with the capped warning; achievable needs no note', () => {
    expect(plain(fixedLoadNote(kg(37.5, 'per_hand'), rack))).toBe('Max here 30 kg each');
    expect(fixedLoadNote(kg(27.5, 'per_hand'), rack)).toBeNull();
    expect(plain(fixedLoadNote(kg(26, 'per_hand'), rack))).toBe('At Start 25 kg each');
    expect(fixedLoadNote(kg(100), null)).toBeNull();
  });

  it('lb rack: a kg load is converted toward easier; assisted: more assistance is easier', () => {
    const lbRack = dumbbells({ unit: 'lb', loads: [10, 15, 20, 25, 30, 35, 40, 45, 50] });
    expect(plain(fixedLoadNote(kg(20, 'per_hand'), lbRack))).toMatch(/lb each/);
    expect(fixedLoadNote(lb(40, 'per_hand'), lbRack)).toBeNull();
    const assist = assisted();
    expect(fixedLoadNote(kg(25, 'assistance'), assist)).toBeNull();
    expect(plain(fixedLoadNote(kg(50, 'assistance'), assist))).toMatch(/40 kg/);
    expect(fixedLoadFrame(lbRack, 'kg', 'per_hand')).toEqual({ unit: 'lb', convention: 'per_hand' });
    expect(fixedLoadFrame(null, 'kg', 'total')).toEqual({ unit: 'kg', convention: 'total' });
  });

  it('the stepper walks achievable loads and stops at the rack’s ends; without an item, 2.5 kg steps', () => {
    const f = fixedLoadFrame(rack, 'kg', 'per_hand');
    expect(fixedLoadSteps(30, f, rack)).toMatchObject({ up: { enabled: false }, down: { enabled: true, value: 27.5 } });
    expect(fixedLoadSteps(null, f, rack)).toMatchObject({ up: { enabled: true, value: 5 }, down: { enabled: false } });
    expect(fixedLoadSteps(60, { unit: 'kg', convention: 'total' }, null)).toMatchObject({ up: { value: 62.5 }, down: { value: 57.5 } });
    expect(fixedLoadSteps(5, { unit: 'lb', convention: 'total' }, null)).toMatchObject({ up: { value: 10 }, down: { value: 0 } });
  });

  it('WL-A4: a Fixed 37.5 kg each is capped at 30 kg each at Start, with the routine’s Auto sets taking the targets', () => {
    const DB = id(260);
    const ex = new Map([[DB, exercise(260, 'Incline DB press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })]]);
    const slot = routineExercise(30, {
      exerciseId: DB,
      equipmentId: rack.id,
      setTemplates: [template(301, { targetLoad: kg(37.5, 'per_hand'), targetReps: { min: 6, max: 8 } }), template(302, { targetReps: { min: 6, max: 8 } })],
    });
    const c = createRoutine({ id: id(991), ownerId: OWNER, edit: { name: 'Push A', exercises: [slot] }, opId: 'o', at: at(0), isCompound: () => true });
    if (c.kind !== 'write') throw new Error(c.message);
    const target = { setType: 'working' as const, planned: { load: kg(25, 'per_hand'), reps: { min: 8, max: 10 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' as const } };
    const out = planRoutineStart({ opId: 'start', owner: profile(), gymId: GYM, routine: c.next, exercises: ex, knownEquipment: new Map(), gymEquipment: [rack, stack()], at: at(10), newId: idGen(5000), targets: new Map([[DB, [target, target]]]) });
    const sets = out.aggregate.sets.filter((s) => s.setType === 'working');
    expect(sets.map((s) => [s.planned.load?.value, s.planned.load?.convention, s.planned.reps, s.planned.source])).toEqual([
      [30, 'per_hand', { min: 6, max: 8 }, undefined],
      [25, 'per_hand', { min: 6, max: 8 }, 'built_in_rule'],
    ]);
  });
});

describe('editorItemFor (the item a Fixed load is checked on)', () => {
  it('the slot’s own item here, else the first compatible one, else none', () => {
    const rack = dumbbells();
    const info = { defaultLoadConvention: 'per_hand' as const, compatibleEquipment: ['dumbbells' as const] };
    expect(editorItemFor({ equipmentId: rack.id }, info, [stack(), rack])?.id).toBe(rack.id);
    expect(editorItemFor({ equipmentId: id(999) }, info, [stack(), rack])?.id).toBe(rack.id);
    expect(editorItemFor({ equipmentId: null }, info, [stack()])).toBeNull();
    expect(editorItemFor({ equipmentId: rack.id }, info, [{ ...rack, availability: 'retired' }])).toBeNull();
  });
});

describe('mergeRoutineEdits (Keep both, WL-A6)', () => {
  const b = { name: 'Push A', exercises: base() };
  const reps = (e: RoutineExercise, min: number): RoutineExercise => ({ ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetReps: { min, max: min + 2 } })) });
  it('different slots: both kept; Ben’s order wins when he reordered; additions keep their place', () => {
    const [bench, row, face] = base();
    if (!bench || !row || !face) throw new Error('fixture');
    const mine = { name: 'Push A', exercises: [face, bench, reps(row, 10)] };
    const theirs = { name: 'Push A', exercises: [reps(bench, 4), row, face, routineExercise(40, { exerciseId: HANG })] };
    const r = mergeRoutineEdits(b, mine, theirs);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.exercises.map((e) => [e.exerciseId, e.setTemplates[0]?.targetReps?.min, e.order])).toEqual([
      [FACE, 6, 0],
      [BENCH, 4, 1],
      [ROW, 10, 2],
      [HANG, 6, 3],
    ]);
  });
  it('the same slot or the name changed on both: a conflict; unpicked keeps the newer version, a pick takes Ben’s', () => {
    const [bench, row, face] = base();
    if (!bench || !row || !face) throw new Error('fixture');
    const mine = { name: 'Push B', exercises: [reps(bench, 10), row, face] };
    const theirs = { name: 'Push C', exercises: [reps(bench, 3), row] };
    const r = mergeRoutineEdits(b, mine, theirs);
    expect(r.conflicts.map((c) => (c.kind === 'name' ? 'name' : c.slotId))).toEqual(['name', bench.id]);
    expect(r.merged.name).toBe('Push C');
    expect(r.merged.exercises.map((e) => [e.exerciseId, e.setTemplates[0]?.targetReps?.min])).toEqual([
      [BENCH, 3],
      [ROW, 6],
    ]);
    const picked = mergeRoutineEdits(b, mine, theirs, { name: 'mine', [bench.id]: 'mine' });
    expect(picked.merged.name).toBe('Push B');
    expect(picked.merged.exercises[0]?.setTemplates[0]?.targetReps?.min).toBe(10);
    // Face pull: removed by the newer version, untouched by Ben, so it stays removed.
    expect(picked.merged.exercises.map((e) => e.exerciseId)).toEqual([BENCH, ROW]);
  });
});

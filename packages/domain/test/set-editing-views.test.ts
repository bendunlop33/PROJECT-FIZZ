import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';
import {
  buildAddExerciseCommand,
  buildPlannedSetEditView,
  NBSP,
  reduceSession,
  restSetsView,
  setGlance,
  setNavigation,
  snapPlannedLoad,
  startWorkout,
  toggleRepRange,
  workoutChatContext,
} from '../src/index';
import { assisted, at, dumbbells, exercise, GYM, idGen, kg, lb, profile, values } from './fixtures';
import { apply, BENCH, expectOk, FACE, logCmd, ROW, setsFor, startFixture } from './session-fixture';

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

function emptyWith(ex: Exercise, eq: EquipmentInstance, unit: 'kg' | 'lb' = 'kg'): SessionAggregate {
  const owner = profile({ preferredUnit: unit });
  const ids = idGen(72_000);
  let state = startWorkout({ opId: 'start-e', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [eq], at: at(0), newId: ids }).aggregate;
  state = apply(state, buildAddExerciseCommand({ opId: 'add-1', owner, exercise: ex, equipmentId: eq.id, at: at(1), newId: ids }));
  return state;
}

function bench(s: SessionAggregate, i: number) {
  const set = setsFor(s, BENCH)[i];
  if (!set) throw new Error('no set');
  return set;
}

describe('buildPlannedSetEditView: Edit set for a set not done yet', () => {
  it('shows the stored target, type, target RPE and rest; unchanged sends nothing', () => {
    const s = startFixture().state;
    const v = buildPlannedSetEditView(s, bench(s, 1).id);
    expect(v).toMatchObject({ setNumber: 2, isCurrent: false, setType: { value: 'working', changed: false }, rest: { seconds: 180, text: '3:00' }, patch: null, changed: false });
    expect(v?.loadField).toMatchObject({ value: 100, unitText: 'kg', up: { value: 102.5 }, down: { value: 97.5 } });
    expect(v?.reps).toMatchObject({ range: true, min: { value: 6 }, max: { value: 8 } });
    expect(plain(v?.text)).toBe('Target 100 kg × 6–8');
    expect(buildPlannedSetEditView(s, bench(s, 0).id)?.isCurrent).toBe(true);
  });

  it('builds the patch from only what changed, and it applies as one edit', () => {
    const s = startFixture().state;
    const b1 = bench(s, 1);
    const v = buildPlannedSetEditView(s, b1.id, { load: 105, reps: { min: 5, max: 5 }, setType: 'top', targetRpe: 9, restS: 240 });
    expect(v?.patch).toEqual({ load: kg(105), reps: { min: 5, max: 5 }, setType: 'top', targetRpe: 9, restS: 240 });
    expect(v?.reps).toMatchObject({ range: false, max: null });
    expect(plain(v?.text)).toBe('Target 105 kg × 5');
    const r = expectOk(reduceSession(s, { type: 'edit_planned_set', at: at(5), opId: 'e', setId: b1.id, expectedSetVersion: v?.setVersion ?? 0, patch: v?.patch ?? {} }));
    expect(buildPlannedSetEditView(r.state, b1.id)?.changed).toBe(false);
  });

  it('a warm-up or drop set offers no target RPE', () => {
    const s = startFixture().state;
    expect(buildPlannedSetEditView(s, bench(s, 0).id)?.targetRpe).toBeNull();
    expect(buildPlannedSetEditView(s, bench(s, 1).id, { setType: 'drop', targetRpe: 8 })?.patch).toEqual({ setType: 'drop' });
  });

  it('reps range: steppers keep min below max; Range toggles exact ↔ range', () => {
    const s = startFixture().state;
    const v = buildPlannedSetEditView(s, bench(s, 1).id, { reps: { min: 7, max: 8 } });
    expect(v?.reps?.min.up).toMatchObject({ enabled: false });
    expect(v?.reps?.max?.down).toMatchObject({ enabled: false });
    expect(toggleRepRange({ min: 8, max: 8 })).toEqual({ min: 8, max: 10 });
    expect(toggleRepRange({ min: 6, max: 8 })).toEqual({ min: 8, max: 8 });
  });

  it('a logged set has no plan editor (it is corrected instead)', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(bench(s, 0).id, values(kg(60), 10), 20));
    expect(buildPlannedSetEditView(s, bench(s, 0).id)).toBeNull();
  });

  it('rest steps 15 s, 0 to 60 min', () => {
    const s = startFixture().state;
    expect(buildPlannedSetEditView(s, bench(s, 1).id, { restS: 0 })?.rest).toMatchObject({ down: { enabled: false }, up: { value: 15 } });
    expect(buildPlannedSetEditView(s, bench(s, 1).id, { restS: 3600 })?.rest).toMatchObject({ up: { enabled: false }, down: { value: 3585 } });
  });
});

describe('snapPlannedLoad: a typed load becomes one the equipment can make', () => {
  it('barbell in kg: nearest plate step, capped at the bar’s max', () => {
    const s = startFixture().state;
    expect(snapPlannedLoad(s, bench(s, 1).id, 101)).toBe(100);
    expect(snapPlannedLoad(s, bench(s, 1).id, 101.5)).toBe(102.5);
    expect(snapPlannedLoad(s, bench(s, 1).id, 900)).toBe(187.5);
    expect(snapPlannedLoad(s, bench(s, 1).id, null)).toBeNull();
  });

  it('weight stack: never past its heaviest plate', () => {
    const s = startFixture().state;
    const face = setsFor(s, FACE)[0];
    expect(snapPlannedLoad(s, face?.id ?? '', 57)).toBe(50);
    expect(snapPlannedLoad(s, face?.id ?? '', 2)).toBe(5);
  });

  it('per-hand dumbbells in lb: the rack’s own pairs', () => {
    const rack = dumbbells({ unit: 'lb', loads: [10, 15, 20, 25, 30, 35, 40, 45, 50] });
    const press = exercise(261, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = emptyWith(press, rack, 'lb');
    const set = s.sets[0];
    expect(snapPlannedLoad(s, set?.id ?? '', 43)).toBe(45);
    expect(snapPlannedLoad(s, set?.id ?? '', 80)).toBe(50);
    const v = buildPlannedSetEditView(s, set?.id ?? '', { load: 45 });
    expect(v?.loadField).toMatchObject({ unitText: 'lb each', up: { value: 50 }, down: { value: 40 } });
    expect(v?.patch?.load).toEqual(lb(45, 'per_hand'));
  });

  it('assisted machine: + is more assistance, capped at its max', () => {
    const a = assisted();
    const pull = exercise(262, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
    const s = emptyWith(pull, a);
    const set = s.sets[0];
    expect(snapPlannedLoad(s, set?.id ?? '', 47)).toBe(40);
    const v = buildPlannedSetEditView(s, set?.id ?? '', { load: 40 });
    expect(v?.loadField).toMatchObject({ label: 'Assist', assisted: true, up: { enabled: false }, down: { value: 35 } });
    expect(v?.patch?.load).toEqual(kg(40, 'assistance'));
  });
});

describe('rest screen: Last set and Next (F8)', () => {
  it('the set just logged shows its result and effort; the next set its type, target and target RPE', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(bench(s, 0).id, values(kg(60), 10, { rpe: 6 }), 20));
    const r = restSetsView(s, { [bench(s, 1).sessionExerciseId]: 8 });
    expect(r.last).toMatchObject({ exerciseName: 'Bench press', setNumber: 1, setTypeLabel: 'Warm-up', status: 'done', effort: { rpe: 6, rir: null }, isCurrent: false });
    expect(plain(r.last?.value)).toBe('60 kg × 10');
    expect(r.next).toMatchObject({ setNumber: 2, setCount: 3, setTypeLabel: 'Working', status: 'pending', isCurrent: true });
    expect(plain(r.next?.value)).toBe('100 kg × 6–8 @RPE 8');
    expect(plain(r.next?.accessibilityLabel)).toBe('Bench press, set 2 of 3, Working, current, target 100 kg × 6–8 @RPE 8');
  });

  it('nothing logged: no Last set; Ben’s own target RPE wins on Next', () => {
    let s = startFixture().state;
    expect(restSetsView(s).last).toBeNull();
    const b1 = bench(s, 1);
    s = apply(s, { type: 'edit_planned_set', at: at(3), opId: 'e', setId: b1.id, expectedSetVersion: b1.version, patch: { targetRpe: 7.5 } });
    expect(plain(setGlance(s, b1.id, { [b1.sessionExerciseId]: 8 })?.value)).toBe('100 kg × 6–8 @RPE 7.5');
  });
});

describe('setNavigation: prev / next across exercises (F7)', () => {
  it('walks the whole workout in order; viewing never changes the current set', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(bench(s, 0).id, values(kg(60), 10), 20));
    const current = s.session.activeSetId;
    const here = setNavigation(s, null);
    expect(here).toMatchObject({ shownSetId: current, atCurrent: true, position: 2, total: 8, prevSetId: bench(s, 0).id, nextSetId: bench(s, 2).id });
    // Past the bench, into the superset (Cable row's first set).
    const third = setNavigation(s, bench(s, 2).id);
    expect(third).toMatchObject({ atCurrent: false, nextSetId: setsFor(s, ROW)[0]?.id, currentSetId: current });
    expect(s.session.activeSetId).toBe(current);
    // The first and last sets have no prev / next.
    expect(setNavigation(s, bench(s, 0).id).prevSetId).toBeNull();
    const order = setNavigation(s, null);
    let last = order.shownSetId;
    for (let i = 0; i < 20; i += 1) last = setNavigation(s, last).nextSetId ?? last;
    expect(setNavigation(s, last).nextSetId).toBeNull();
  });

  it('a viewed set that was deleted falls back to the current one', () => {
    const s = startFixture().state;
    const b2 = bench(s, 2);
    const gone = apply(s, { type: 'delete_set', at: at(5), opId: 'd', setId: b2.id, expectedSetVersion: b2.version });
    expect(setNavigation(gone, b2.id)).toMatchObject({ shownSetId: gone.session.activeSetId, atCurrent: true });
  });
});

describe('workoutChatContext: what the chips are about', () => {
  it('names the current exercise; off target after a much harder set, not after an on-target one', () => {
    let s = startFixture().state;
    expect(workoutChatContext(s)).toEqual({ exerciseName: 'Bench press', offTarget: false });
    s = apply(s, logCmd(bench(s, 0).id, values(kg(60), 10), 20));
    const ex = bench(s, 1).sessionExerciseId;
    const onTarget = apply(s, logCmd(bench(s, 1).id, values(kg(100), 8, { rpe: 8 }), 200));
    expect(workoutChatContext(onTarget, { [ex]: 8 }).offTarget).toBe(false);
    const hard = apply(s, logCmd(bench(s, 1).id, values(kg(100), 8, { rpe: 10 }), 200));
    expect(workoutChatContext(hard, { [ex]: 8 })).toEqual({ exerciseName: 'Bench press', offTarget: true });
    const short = apply(s, logCmd(bench(s, 1).id, values(kg(100), 3), 200));
    expect(workoutChatContext(short, { [ex]: 8 }).offTarget).toBe(true);
  });
});

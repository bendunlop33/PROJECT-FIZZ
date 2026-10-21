import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { buildActiveSetView, buildPlannedSetEditView, buildSetEditView, buildWorkoutTableView, exerciseCardFacts, plusSetType, reduceSession, setStepName, setSteps, startWorkout, type ActiveViewInput } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, idGen, kg, ms, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, expectError, logCmd, setsFor, startFixture, BENCH, HANG } from './session-fixture';

/**
 * wo-v3 reviews B1/B2: one numbering for the whole active workout. The v3
 * table numbers working sets 1..n without warm-ups, and the other side of a
 * single-side log shares its partner's number; every toast, sheet title and
 * VoiceOver label reads the same `stepName`.
 */

const input = (aggregate: SessionAggregate): ActiveViewInput => ({ aggregate, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });

describe('setSteps', () => {
  it('numbers working sets 1..n, names warm-ups, and gives the other side its partner\'s number', () => {
    const steps = setSteps([
      { id: 'w1', setType: 'warmup', pairedWithSetId: null },
      { id: 'w2', setType: 'warmup', pairedWithSetId: null },
      { id: 'a', setType: 'top', pairedWithSetId: null },
      { id: 'a-r', setType: 'top', pairedWithSetId: 'a' },
      { id: 'b', setType: 'backoff', pairedWithSetId: null },
      { id: 'orphan', setType: 'working', pairedWithSetId: 'gone' },
    ]);
    expect([...steps.entries()].map(([k, v]) => [k, v.name, v.number, v.companion])).toEqual([
      ['w1', 'Warm-up', null, false],
      ['w2', 'Warm-up', null, false],
      ['a', 'Set 1', 1, false],
      ['a-r', 'Set 1', 1, true],
      ['b', 'Set 2', 2, false],
      ['orphan', 'Set 3', 3, false],
    ]);
  });
});

describe('every view names a set the way the v3 table does (B1)', () => {
  it('bench with a warm-up: Log, just-saved, correction, card facts and planned edit all say Set 1 for the first working set', () => {
    let { state } = startFixture();
    const [warm, s1, s2] = setsFor(state, BENCH);
    if (!warm || !s1 || !s2) throw new Error('fixture');
    let v = buildActiveSetView(input(state));
    expect(v.focus?.setId).toBe(warm.id);
    expect(v.focus?.stepName).toBe('Warm-up');
    expect(buildWorkoutTableView(input(state)).log?.prefix).toBe('Warm-up');

    state = apply(state, logCmd(warm.id, values(kg(60), 10), 30));
    v = buildActiveSetView(input(state));
    expect(v.justSaved?.stepName).toBe('Warm-up');
    expect(v.focus?.setId).toBe(s1.id);
    expect(v.focus?.stepName).toBe('Set 1');
    expect(v.focus?.setNumber).toBe(2); // the old count still includes the warm-up
    expect(buildWorkoutTableView(input(state)).log?.prefix).toBe('Set 1');

    state = apply(state, logCmd(s1.id, values(kg(100), 6), 300));
    v = buildActiveSetView(input(state));
    expect(v.justSaved?.stepName).toBe('Set 1');
    expect(buildSetEditView(state, s1.id, null)?.stepName).toBe('Set 1');
    expect(buildPlannedSetEditView(state, s2.id)?.stepName).toBe('Set 2');
    const ex = state.exercises.find((e) => e.exerciseId === BENCH);
    expect(exerciseCardFacts({ aggregate: state }, ex?.id ?? '')?.nextSet?.stepName).toBe('Set 2');
    expect(setStepName(state, warm.id)).toBe('Warm-up');
    expect(setStepName(state, s2.id)).toBe('Set 2');
    expect(setStepName(state, 'nope')).toBeNull();
  });

  it('a single-side log: the other side is still Set 1, and the next set is Set 2 (B2)', () => {
    const SPLIT = exercise(260, 'Bulgarian split squat', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', laterality: 'unilateral' });
    const rack = dumbbells();
    let state = startWorkout({
      opId: 's',
      owner: profile(),
      gymId: GYM,
      routine: routine([routineExercise(860, { exerciseId: SPLIT.id, equipmentId: rack.id, order: 0, setTemplates: [8601, 8602, 8603].map((n) => template(n, { targetLoad: kg(15, 'per_hand'), targetReps: { min: 8, max: 10 } })) })]),
      exercises: new Map([[SPLIT.id, SPLIT]]),
      gymEquipment: [rack],
      at: at(0),
      newId: idGen(86_000),
    }).aggregate;
    const [first] = setsFor(state, SPLIT.id);
    state = apply(state, logCmd(first?.id ?? '', values(kg(15, 'per_hand'), 8), 30, 'op-left', 'left'));
    const v = buildActiveSetView(input(state));
    expect(v.focus?.side).toEqual({ kind: 'fixed', value: 'right' });
    expect(v.focus?.stepName).toBe('Set 1');
    const t = buildWorkoutTableView(input(state));
    const rows = t.blocks[0]?.kind === 'exercise' ? t.blocks[0].card.rows : [];
    expect(rows.map((r) => r.pairedWithSetId === null)).toEqual([true, false, true, true]);
    expect(t.log?.prefix).toBe('Set 1');
  });
});

describe('＋ Set copies the last working set, not a drop (wo-v3 logic S5)', () => {
  const BENCH_EX = exercise(270, 'Bench press');
  function start(types: ('warmup' | 'working' | 'top' | 'backoff' | 'drop')[]): SessionAggregate {
    return startWorkout({
      opId: 's',
      owner: profile(),
      gymId: GYM,
      routine: routine([routineExercise(870, { exerciseId: BENCH_EX.id, equipmentId: barbell().id, order: 0, setTemplates: types.map((t, i) => template(8700 + i, { setType: t, targetLoad: kg(t === 'drop' ? 60 : t === 'warmup' ? 40 : 100) })) })]),
      exercises: new Map([[BENCH_EX.id, BENCH_EX]]),
      gymEquipment: [barbell()],
      at: at(0),
      newId: idGen(87_000),
    }).aggregate;
  }
  it('top + 2 back-offs + a drop: the new set is a back-off with the back-off load', () => {
    const state = start(['warmup', 'top', 'backoff', 'backoff', 'drop']);
    const row = state.exercises[0]?.id ?? '';
    expect(plusSetType(state.sets, row)).toBe('backoff');
    const r = reduceSession(state, { type: 'add_set', at: at(5), opId: 'plus', sessionExerciseId: row, newSetId: 'new-set', setType: plusSetType(state.sets, row) });
    if (!r.ok) throw new Error(r.error.message);
    const added = r.state.sets.find((x) => x.id === 'new-set');
    expect(added?.setType).toBe('backoff');
    expect(added?.planned.load).toEqual(kg(100));
    // Named like its row: added after the drop, so Set 5.
    expect(setStepName(r.state, 'new-set')).toBe('Set 5');
  });
  it('only warm-ups (or drops): copy the last set as before', () => {
    const state = start(['warmup', 'warmup']);
    expect(plusSetType(state.sets, state.exercises[0]?.id ?? '')).toBeNull();
  });
});

describe('a round change never moves the current set off a running work timer (wo-v3 logic S3)', () => {
  it('set_active_set is refused while another set\'s work timer runs; fine on the timed set itself and after Stop', () => {
    let s = startFixture().state;
    const [h1] = setsFor(s, HANG);
    const [, b1] = setsFor(s, BENCH);
    s = apply(s, { type: 'set_active_set', at: at(1), opId: 'act', setId: h1?.id ?? '', expectedVersion: s.session.version });
    s = apply(s, { type: 'start_work_interval', at: at(2), opId: 'w', setId: h1?.id ?? '', durationS: 45 });
    expectError(reduceSession(s, { type: 'set_active_set', at: at(3), opId: 'act-2', setId: b1?.id ?? '', expectedVersion: s.session.version }), 'work_interval_running');
    // Selecting the timed set itself is a no-op, not a refusal.
    expect(reduceSession(s, { type: 'set_active_set', at: at(3), opId: 'act-3', setId: h1?.id ?? '', expectedVersion: s.session.version }).ok).toBe(true);
    s = apply(s, { type: 'stop_work_interval', at: at(20), opId: 'ws', setId: h1?.id ?? '' });
    expect(reduceSession(s, { type: 'set_active_set', at: at(21), opId: 'act-4', setId: b1?.id ?? '', expectedVersion: s.session.version }).ok).toBe(true);
  });
});

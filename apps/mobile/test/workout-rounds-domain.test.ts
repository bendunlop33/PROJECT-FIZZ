import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';
import { buildActiveSetView, buildAddExerciseCommand, buildWorkoutTableView, catalogueExerciseId, latestCommittedSetId, NBSP, reduceSession, startWorkout, type ActiveViewInput } from '@fizz/domain';

import { assisted, at, barbell, bodyweightStation, dumbbells, exercise, GYM, idGen, kg, lb, ms, profile, routine, routineExercise, stack, template, values } from '../../../packages/domain/test/fixtures';
import { apply, logCmd, setsFor, startFixture, BENCH, FACE, ROW } from '../../../packages/domain/test/session-fixture';
import { buildRounds, clockText, lastLogMs, revealSetId, roundPrimary, setClockMs, setClockStartMs, shownRoundIndex, timerBarMode, whyView } from '../src/workout/rounds';

/**
 * The v3 round page over real domain state (wo-v3 logic S4): a superset's
 * a → b order with the rest after the round, uneven members, many warm-ups,
 * and every load convention's header and `Why?` target. The pure layout
 * checks with hand-built rows are in workout-rounds.test.ts.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const input = (aggregate: SessionAggregate, seconds = 10): ActiveViewInput => ({ aggregate, nowMs: ms(seconds), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
const roundsOf = (s: SessionAggregate, seconds = 10) => buildRounds(buildWorkoutTableView(input(s, seconds)), () => null);
const openRow = (s: SessionAggregate, seconds = 10) =>
  roundsOf(s, seconds)
    .flatMap((r) => r.exercises.flatMap((e) => e.rows.map((x) => ({ round: r.n, ex: e.label, row: x }))))
    .find((x) => x.row.current);

describe('superset through the domain: a → b with no rest, rest after b (logic S4)', () => {
  it('after 3a the open row is 3b with no rest; after 3b the rest runs and the round moves to the next a', () => {
    let s = startFixture().state;
    const [w, b1, b2] = setsFor(s, BENCH);
    const [r1, r2] = setsFor(s, ROW);
    const [f1] = setsFor(s, FACE);
    let t = 30;
    for (const x of [w, b1, b2]) s = apply(s, logCmd(x?.id ?? '', values(kg(60), 8), (t += 30)));
    let rs = roundsOf(s, t + 1);
    expect(rs.map((r) => r.exercises.map((e) => e.label))).toEqual([['1'], ['2a', '2b'], ['3']]);
    expect(shownRoundIndex(rs, null)).toBe(1);
    expect(rs[1]?.firstPendingSetId).toBe(r1?.id);
    // Log 2a: the open row is 2b at once, no rest between members.
    s = apply(s, logCmd(r1?.id ?? '', values(kg(50, 'stack'), 10), (t += 30)));
    expect(openRow(s, t + 1)).toMatchObject({ round: 2, ex: '2b' });
    expect(s.restTimer?.status).not.toBe('running');
    rs = roundsOf(s, t + 1);
    expect(rs[1]?.exercises.map((e) => [e.upNext, e.dim])).toEqual([
      [false, true],
      [true, false],
    ]);
    const pill = roundPrimary({ rounds: rs, shown: 1, primary: buildActiveSetView(input(s, t + 1)).primary });
    expect(pill.kind === 'step' ? pill.label : '').toMatch(/^2b · Set 1 · /);
    // Log 2b: the rest after the round runs, and the open row is 2a's set 2.
    s = apply(s, logCmd(f1?.id ?? '', values(kg(20, 'stack'), 12), (t += 30)));
    expect(s.restTimer?.status).toBe('running');
    expect(s.restTimer?.setId).toBe(f1?.id);
    expect(openRow(s, t + 1)).toMatchObject({ round: 2, ex: '2a' });
    expect(openRow(s, t + 1)?.row.setId).toBe(r2?.id);
    // Strip progress counts working sets: 2 of 4 done in the superset.
    rs = roundsOf(s, t + 1);
    expect([rs[1]?.doneSets, rs[1]?.totalSets]).toEqual([2, 4]);
  });

  it('uneven members: the round after the shorter member runs out holds only the longer one', () => {
    const ROW_EX = exercise(301, 'Cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
    const FACE_EX = exercise(302, 'Face pull', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
    let s = startWorkout({
      opId: 's',
      owner: profile(),
      gymId: GYM,
      routine: routine([
        routineExercise(910, { exerciseId: ROW_EX.id, equipmentId: stack().id, order: 0, supersetGroup: 'A', setTemplates: [9101, 9102, 9103].map((n) => template(n, { targetLoad: kg(50, 'stack') })) }),
        routineExercise(911, { exerciseId: FACE_EX.id, equipmentId: stack().id, order: 1, supersetGroup: 'A', setTemplates: [9111, 9112].map((n) => template(n, { targetLoad: kg(20, 'stack') })) }),
      ]),
      exercises: new Map([
        [ROW_EX.id, ROW_EX],
        [FACE_EX.id, FACE_EX],
      ]),
      gymEquipment: [stack()],
      at: at(0),
      newId: idGen(91_000),
    }).aggregate;
    const rows = setsFor(s, ROW_EX.id);
    const faces = setsFor(s, FACE_EX.id);
    let t = 0;
    for (const x of [rows[0], faces[0], rows[1], faces[1]]) s = apply(s, logCmd(x?.id ?? '', values(kg(x?.sessionExerciseId === rows[0]?.sessionExerciseId ? 50 : 20, 'stack'), 10), (t += 40)));
    const rs = roundsOf(s, t + 1);
    expect(rs).toHaveLength(1);
    expect(rs[0]?.firstPendingSetId).toBe(rows[2]?.id);
    expect(rs[0]?.exercises.map((e) => e.progressText)).toEqual(['2/3', '2/2']);
    expect(openRow(s, t + 1)).toMatchObject({ ex: '1a' });
    // Nothing left for 1b: nothing to dim.
    expect(rs[0]?.exercises.map((e) => e.dim)).toEqual([false, true]);
  });
});

describe('many warm-ups (logic S4, spec B1)', () => {
  it('4 warm-ups + 4 working: rows W W W W 1 2 3 4, the pill and the just-saved line say the row\'s own name, and the box shows the open row', () => {
    const PRESS = exercise(320, 'Bench press');
    let s = startWorkout({
      opId: 's',
      owner: profile(),
      gymId: GYM,
      routine: routine([
        routineExercise(920, {
          exerciseId: PRESS.id,
          equipmentId: barbell().id,
          order: 0,
          setTemplates: [
            ...[9201, 9202, 9203, 9204].map((n, i) => template(n, { setType: 'warmup', targetLoad: kg(20 + i * 20), targetReps: { min: 5, max: 5 } })),
            ...[9205, 9206, 9207, 9208].map((n) => template(n, { targetLoad: kg(100) })),
          ],
        }),
      ]),
      exercises: new Map([[PRESS.id, PRESS]]),
      gymEquipment: [barbell()],
      at: at(0),
      newId: idGen(92_000),
    }).aggregate;
    const sets = setsFor(s, PRESS.id);
    let t = 0;
    for (const x of sets.slice(0, 5)) s = apply(s, logCmd(x.id, values(kg(x.setType === 'warmup' ? 40 : 100), 5), (t += 60)));
    const rs = roundsOf(s, t + 1);
    const ex = rs[0]?.exercises[0];
    expect(ex?.rows.map((r) => r.label)).toEqual(['W', 'W', 'W', 'W', '1', '2', '3', '4']);
    expect(ex?.progressText).toBe('1/4');
    expect(ex?.anchor).toBe(5);
    const v = buildActiveSetView(input(s, t + 1));
    expect(v.justSaved?.stepName).toBe('Set 1');
    expect(v.focus?.stepName).toBe('Set 2');
    expect(ex?.rows[ex.anchor]?.stepName).toBe(v.focus?.stepName);
    const pill = roundPrimary({ rounds: rs, shown: 0, primary: v.primary });
    expect(pill.kind === 'step' ? plain(pill.label) : '').toMatch(/^Set 2 · Log 100 kg × /);
    // (Ben, 26 Oct) One scroll per round: the page brings the open row into view (not a per-exercise box).
    expect(revealSetId(rs[0])).toBe(ex?.rows[5]?.setId);
  });
});

describe('every load convention reads right on the round page (logic S4)', () => {
  function emptyWith(ex: Exercise, eq: EquipmentInstance | null, unit: 'kg' | 'lb' = 'kg'): SessionAggregate {
    const owner = profile({ preferredUnit: unit });
    const ids = idGen(93_000);
    let state = startWorkout({ opId: 'start-e', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: eq ? [eq] : [], at: at(0), newId: ids }).aggregate;
    state = apply(state, buildAddExerciseCommand({ opId: 'add-1', owner, exercise: ex, equipmentId: eq?.id ?? null, at: at(1), newId: ids }));
    return state;
  }
  const cases: { name: string; ex: Exercise; eq: EquipmentInstance | null; unit: 'kg' | 'lb'; header: string | null; value: string; loadValue: () => ReturnType<typeof values>; top: boolean; target: RegExp }[] = [
    { name: 'lb dumbbells', ex: exercise(330, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' }), eq: dumbbells({ unit: 'lb', loads: [10, 20, 45, 50] }), unit: 'lb', header: 'LB EACH', value: 'REPS', loadValue: () => values(lb(45, 'per_hand'), 8), top: true, target: /^45 lb each × 8/ },
    { name: 'kg dumbbells', ex: exercise(331, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' }), eq: dumbbells(), unit: 'kg', header: 'KG EACH', value: 'REPS', loadValue: () => values(kg(22.5, 'per_hand'), 8), top: true, target: /^22\.5 kg each × 8/ },
    { name: 'assisted', ex: exercise(332, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' }), eq: assisted(), unit: 'kg', header: 'ASSIST KG', value: 'REPS', loadValue: () => values(kg(20, 'assistance'), 8), top: false, target: /^20 kg assist × 8/ },
    { name: 'bodyweight', ex: exercise(333, 'Dip', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' }), eq: bodyweightStation(), unit: 'kg', header: null, value: 'REPS', loadValue: () => values(null, 8), top: false, target: /^8/ },
  ];
  it.each(cases)('$name: header, Why? target from the logged row, top set', (c) => {
    const s = emptyWith(c.ex, c.eq, c.unit);
    const setId = buildWorkoutTableView(input(s)).anchor?.setId ?? '';
    const v = buildActiveSetView(input(s));
    const done = apply(s, logCmd(setId, { ...c.loadValue(), ...(v.focus?.logValues.load?.convention === 'bodyweight' ? { load: v.focus.logValues.load } : {}) }, 30));
    const rs = roundsOf(done, 31);
    const ex = rs[0]?.exercises[0];
    expect(ex?.loadHeader ?? null).toBe(c.header);
    expect(ex?.valueHeader).toBe(c.value);
    expect(ex?.topSet !== null).toBe(c.top);
    const why = rs[0] === undefined ? null : whyView(rs[0], 0);
    expect(why?.target).toMatch(c.target);
  });

  it('cardio: TIME · DIST column, no RIR cell', () => {
    const ROWER = exercise(0, 'Rowing machine', { id: catalogueExerciseId('rowing-erg'), catalogueKey: 'rowing-erg', measurement: 'cardio', movementPattern: 'conditioning', compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', primaryMuscles: ['quads', 'glutes', 'lats'] });
    const s = emptyWith(ROWER, null);
    const ex = roundsOf(s)[0]?.exercises[0];
    expect(ex?.valueHeader).toBe('TIME · DIST');
    expect(ex?.loadHeader).toBeNull();
    expect(ex?.rows.every((r) => r.rir === null)).toBe(true);
  });
});

/**
 * b3 merge wiring: the v3 ✓ untick and the Undo toast are both `undo_log`
 * (WorkoutScreen `untick` / `undo`), so the rest that log replaced comes back
 * in the v3 timer bar (rest-undo): REST counting down to its original
 * deadline, or, when it had finished, the SET clock counting on from its
 * original end (not from the untick).
 */
describe('untick brings the replaced rest back into the v3 timer bar (rest-undo × wo-v3)', () => {
  const undoLog = (setId: string, t: number, version: number) => ({ type: 'undo_log' as const, at: at(t), opId: `undo:${setId}:0`, setId, expectedSetVersion: version });
  const bar = (s: SessionAggregate, seconds: number) => {
    const rest = buildActiveSetView(input(s, seconds)).rest;
    const start = setClockStartMs({ rest, lastLogMs: lastLogMs(s.sets), startedAtMs: ms(0) });
    return { mode: timerBarMode(rest), rest, setClock: clockText(setClockMs({ startMs: start, nowMs: ms(seconds), pausedMs: 0 })) };
  };
  /** Warm-up logged at 30 s (rest 60 s, deadline 90 s), then set 1 ticked by accident at 50 s. */
  const tick = () => {
    let s = startFixture().state;
    const [w, b1] = setsFor(s, BENCH);
    if (!w || !b1) throw new Error('fixture');
    s = apply(s, logCmd(w.id, values(kg(60), 10), 30));
    s = apply(s, logCmd(b1.id, values(kg(100), 8), 50));
    const logged = s.sets.find((x) => x.id === b1.id);
    if (!logged) throw new Error('fixture');
    return { s, b1: logged };
  };

  it('a done row offers untick only on the latest log; the round row reads the step name', () => {
    const { s, b1 } = tick();
    const rows = buildRounds(buildWorkoutTableView(input(s, 55)), () => null, latestCommittedSetId(s)).flatMap((r) => r.exercises.flatMap((e) => e.rows));
    expect(rows.find((x) => x.setId === b1.id)).toMatchObject({ canUntick: true, stepName: 'Set 1' });
    expect(rows.filter((x) => x.canUntick)).toHaveLength(1);
  });

  it('rest still running at the untick: REST counts down to the original deadline, not a fresh rest', () => {
    const { s, b1 } = tick();
    expect(bar(s, 55)).toMatchObject({ mode: 'rest', rest: { kind: 'running', remainingMs: 175_000 } });
    const back = apply(s, undoLog(b1.id, 60, b1.version));
    expect(bar(back, 60)).toMatchObject({ mode: 'rest', rest: { kind: 'running', deadlineUtc: at(90).utc, remainingMs: 30_000 } });
    // The page opens set 1 again.
    expect(openRow(back, 60)?.row.setId).toBe(b1.id);
  });

  it('rest finished before the untick: the SET clock continues from the original end, no countdown', () => {
    const { s, b1 } = tick();
    const back = apply(s, undoLog(b1.id, 130, b1.version));
    expect(back.restTimer?.restoredFinished).toBe(true);
    const b = bar(back, 130);
    expect(b.mode).toBe('set');
    expect(b.rest).toMatchObject({ kind: 'ended', endedAtUtc: at(90).utc, skipped: false });
    // 130 s − 90 s: counting on from when the rest ended, not 0:00 from the untick.
    expect(b.setClock).toBe('0:40');
  });

  it('a stale untick (set changed since) is refused and the rest stays as it is', () => {
    const { s, b1 } = tick();
    const r = reduceSession(s, undoLog(b1.id, 60, b1.version - 1));
    expect(r.ok).toBe(false);
  });
});

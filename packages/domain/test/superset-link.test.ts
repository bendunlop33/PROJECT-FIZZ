import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { buildExecutionOrder, isRoundEnd, reduceSession, supersetMenu, supersetPartners, supersetPartnerSets } from '../src/index';
import { at, kg, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * `Superset with…` and `Remove superset` on live rows (Ben, 19 Oct): only rows and order change,
 * never a set (rule 2); versioned and idempotent (rule 5); Undo; a reload of the saved workout
 * (restart recovery) still undoes.
 */

const rowId = (s: SessionAggregate, exerciseId: string): string => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.id ?? '';
const order = (s: SessionAggregate): string[] => [...s.exercises].filter((e) => e.removed === undefined).sort((a, b) => a.order - b.order).map((e) => `${e.exerciseName}${e.supersetGroup === null ? '' : `:${e.supersetGroup}`}`);
const link = (s: SessionAggregate, a: string, b: string, opId = 'link-1'): SessionCommand => ({ type: 'link_superset', at: at(400), opId, expectedVersion: s.session.version, sessionExerciseId: a, withSessionExerciseId: b });
const split = (s: SessionAggregate, a: string, opId = 'split-1'): SessionCommand => ({ type: 'split_superset', at: at(400), opId, expectedVersion: s.session.version, sessionExerciseId: a });
const undo = (target: string, opId = 'undo-1'): SessionCommand => ({ type: 'undo_op', at: at(450), opId, targetOpId: target });
const reload = (s: SessionAggregate): SessionAggregate => SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s)));

/** Bench set 1 (warm-up) logged. */
function started(): SessionAggregate {
  const s = startFixture().state;
  const [w] = setsFor(s, BENCH);
  return apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
}

describe('link_superset', () => {
  it('pairs the dead hang with bench: it moves after bench, a new letter, sets untouched; Undo puts it back', () => {
    const s0 = started();
    const r = expectOk(reduceSession(s0, link(s0, rowId(s0, HANG), rowId(s0, BENCH))));
    expect(order(r.state)).toEqual(['Bench press:B', 'Dead hang:B', 'Cable row:A', 'Face pull:A']);
    expect(r.state.session.version).toBe(s0.session.version + 1);
    expect(r.state.sets).toEqual(s0.sets);
    // The warm-up is done, so the hang starts in bench's next round: W, B1, hang, B2.
    const ids = buildExecutionOrder(r.state.exercises, r.state.sets);
    const name = (setId: string) => r.state.exercises.find((e) => e.id === r.state.sets.find((x) => x.id === setId)?.sessionExerciseId)?.exerciseName;
    expect(ids.slice(0, 4).map(name)).toEqual(['Bench press', 'Bench press', 'Dead hang', 'Bench press']);
    const back = expectOk(reduceSession(reload(r.state), undo('link-1'))).state;
    expect(order(back)).toEqual(['Bench press', 'Cable row:A', 'Face pull:A', 'Dead hang']);
    expect(back.sets).toEqual(s0.sets);
  });

  it('joins an existing superset (either way round) and Undo leaves the pair as it was', () => {
    const s0 = started();
    const s1 = apply(s0, link(s0, rowId(s0, ROW), rowId(s0, HANG)));
    expect(order(s1)).toEqual(['Bench press', 'Cable row:A', 'Face pull:A', 'Dead hang:A']);
    const back = apply(s1, undo('link-1'));
    expect(order(back)).toEqual(['Bench press', 'Cable row:A', 'Face pull:A', 'Dead hang']);
  });

  it('two different supersets, the same row, a done row: refused, nothing changes', () => {
    const s0 = started();
    const s1 = apply(s0, link(s0, rowId(s0, HANG), rowId(s0, BENCH)));
    expectError(reduceSession(s1, link(s1, rowId(s1, ROW), rowId(s1, BENCH), 'link-2')), 'invalid_values');
    expectError(reduceSession(s0, link(s0, rowId(s0, BENCH), rowId(s0, BENCH), 'link-3')), 'invalid_values');
    let done = s0;
    for (const x of setsFor(done, HANG)) done = apply(done, logCmd(x.id, values(null, null, { durationS: 45 }), 500));
    expectError(reduceSession(done, link(done, rowId(done, HANG), rowId(done, BENCH), 'link-4')), 'set_not_pending');
  });

  it('a second copy of the same exercise supersets with the first (calf raise at 0)', () => {
    const s0 = started();
    const bench = s0.exercises.find((e) => e.exerciseId === BENCH);
    if (bench === undefined) throw new Error('no bench');
    const s1 = apply(s0, {
      type: 'add_exercise',
      at: at(300),
      opId: 'add-copy',
      newSessionExerciseId: '00000000-0000-4000-8000-000000077001',
      newSetId: '00000000-0000-4000-8000-000000077002',
      exercise: { exerciseId: BENCH, name: 'Bench press', measurement: 'reps', laterality: 'bilateral', defaultLoadConvention: 'total', compatibleEquipment: ['barbell'] },
      equipmentId: null,
      unit: 'kg',
      rest: { seconds: 60, source: 'global_default', sourceLabel: 'Default' },
      plan: [{ id: '00000000-0000-4000-8000-000000077002', setType: 'working', planned: { load: kg(0), reps: { min: 20, max: 20 }, durationS: null, rpe: null, rir: null } }],
    });
    const copy = s1.exercises.find((e) => e.id === '00000000-0000-4000-8000-000000077001');
    const s2 = apply(s1, link(s1, copy?.id ?? '', bench.id));
    expect(order(s2)).toEqual(['Bench press:B', 'Bench press:B', 'Cable row:A', 'Face pull:A', 'Dead hang']);
    // Each copy keeps its own sets.
    expect(s2.sets.filter((x) => x.sessionExerciseId === copy?.id).map((x) => x.planned.load)).toEqual([kg(0)]);
    expect(s2.sets.filter((x) => x.sessionExerciseId === bench.id)).toEqual(s1.sets.filter((x) => x.sessionExerciseId === bench.id));
  });

  it('review N3: the letter of a partner add that was undone is used again', () => {
    const s0 = started();
    const bench = rowId(s0, BENCH);
    const s1 = apply(s0, {
      type: 'add_exercise',
      at: at(300),
      opId: 'add-pair',
      newSessionExerciseId: '00000000-0000-4000-8000-000000078001',
      newSetId: '00000000-0000-4000-8000-000000078002',
      exercise: { exerciseId: BENCH, name: 'Bench press', measurement: 'reps', laterality: 'bilateral', defaultLoadConvention: 'total', compatibleEquipment: ['barbell'] },
      equipmentId: null,
      unit: 'kg',
      rest: { seconds: 60, source: 'global_default', sourceLabel: 'Default' },
      plan: [{ id: '00000000-0000-4000-8000-000000078002', setType: 'working', planned: { load: kg(0), reps: { min: 20, max: 20 }, durationS: null, rpe: null, rir: null } }],
      supersetWithSessionExerciseId: bench,
    });
    expect(order(s1)).toContain('Bench press:B');
    const s2 = apply(s1, undo('add-pair'));
    expect(order(s2)).toEqual(['Bench press', 'Cable row:A', 'Face pull:A', 'Dead hang']);
    const s3 = apply(s2, link(s2, rowId(s2, HANG), bench, 'link-after'));
    expect(order(s3)).toEqual(['Bench press:B', 'Dead hang:B', 'Cable row:A', 'Face pull:A']);
  });

  it('is idempotent (same opId) and refuses a stale version', () => {
    const s0 = started();
    const cmd = link(s0, rowId(s0, HANG), rowId(s0, BENCH));
    const s1 = apply(s0, cmd);
    const again = expectOk(reduceSession(s1, cmd));
    expect(again.duplicate).toBe(true);
    expect(again.superseded).toBe(false);
    expectError(reduceSession(s1, { ...link(s0, rowId(s0, HANG), rowId(s0, ROW), 'link-9') }), 'stale_version');
    // After its Undo the repeat reports it is no longer in place.
    const s2 = apply(s1, undo('link-1'));
    expect(expectOk(reduceSession(s2, cmd)).superseded).toBe(true);
  });

  it('Undo is refused once the rows moved again', () => {
    const s0 = started();
    const s1 = apply(s0, link(s0, rowId(s0, HANG), rowId(s0, BENCH)));
    const s2 = apply(s1, { type: 'move_exercise', at: at(420), opId: 'm1', sessionExerciseId: rowId(s1, ROW), afterSessionExerciseId: null, expectedVersion: s1.session.version });
    expectError(reduceSession(s2, undo('link-1')), 'stale_version');
  });
});

describe('link_superset either way round (review B1)', () => {
  /** Bench warm-up and set 1 logged: bench is in progress. */
  function midBench(): SessionAggregate {
    const s = started();
    const [, b1] = setsFor(s, BENCH);
    return apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 200));
  }
  const pendingNames = (s: SessionAggregate): (string | undefined)[] =>
    buildExecutionOrder(s.exercises, s.sets)
      .filter((x) => s.sets.find((y) => y.id === x)?.status === 'pending')
      .map((x) => s.exercises.find((e) => e.id === s.sets.find((y) => y.id === x)?.sessionExerciseId)?.exerciseName);

  it('the ⋯ menu on Dead hang picking Bench gives the same result as the reverse: bench stays put, the hang alternates from its next round', () => {
    const s0 = midBench();
    const fromHang = apply(s0, link(s0, rowId(s0, BENCH), rowId(s0, HANG)));
    const fromBench = apply(s0, link(s0, rowId(s0, HANG), rowId(s0, BENCH)));
    expect(fromHang.exercises).toEqual(fromBench.exercises);
    expect(order(fromHang)).toEqual(['Bench press:B', 'Dead hang:B', 'Cable row:A', 'Face pull:A']);
    expect(fromHang.exercises.find((e) => e.exerciseId === HANG)?.roundOffset).toBe(2);
    expect(fromHang.exercises.find((e) => e.exerciseId === BENCH)?.roundOffset).toBeUndefined();
    expect(pendingNames(fromHang).slice(0, 3)).toEqual(['Bench press', 'Dead hang', 'Cable row']);
    expect(fromHang.sets).toEqual(s0.sets);
  });

  it('bench in progress joins a superset not started: the superset moves after bench and sits out its done rounds; Undo puts it all back', () => {
    const s0 = midBench();
    for (const [x, y] of [[BENCH, ROW], [ROW, BENCH]] as const) {
      const s1 = apply(s0, link(s0, rowId(s0, x), rowId(s0, y)));
      expect(order(s1)).toEqual(['Bench press:A', 'Cable row:A', 'Face pull:A', 'Dead hang']);
      expect(s1.exercises.filter((e) => e.supersetGroup === 'A').map((e) => [e.exerciseName, e.roundOffset ?? 0])).toEqual(
        expect.arrayContaining([
          ['Bench press', 0],
          ['Cable row', 2],
          ['Face pull', 2],
        ]),
      );
      // B2 then Cable row, Face pull (a round), B3 …: bench is still next.
      expect(pendingNames(s1).slice(0, 4)).toEqual(['Bench press', 'Cable row', 'Face pull', 'Cable row']);
      expect(s1.sets).toEqual(s0.sets);
      const back = apply(reload(s1), undo('link-1'));
      expect(order(back)).toEqual(['Bench press', 'Cable row:A', 'Face pull:A', 'Dead hang']);
      expect(back.exercises.map((e) => e.roundOffset)).toEqual(s0.exercises.map((e) => e.roundOffset));
      expect(buildExecutionOrder(back.exercises, back.sets)).toEqual(buildExecutionOrder(s0.exercises, s0.sets));
    }
  });

  it('nothing done on either side: the earlier row anchors whichever is named first', () => {
    const s0 = startFixture().state;
    const x = apply(s0, link(s0, rowId(s0, BENCH), rowId(s0, HANG)));
    const y = apply(s0, link(s0, rowId(s0, HANG), rowId(s0, BENCH)));
    expect(order(x)).toEqual(order(y));
    expect(order(x)).toEqual(['Bench press:B', 'Dead hang:B', 'Cable row:A', 'Face pull:A']);
  });
});

describe('split_superset', () => {
  it('takes the whole superset apart, order and sets kept; Undo groups it again after a reload', () => {
    const s0 = started();
    const r = expectOk(reduceSession(s0, split(s0, rowId(s0, FACE))));
    expect(order(r.state)).toEqual(['Bench press', 'Cable row', 'Face pull', 'Dead hang']);
    expect(r.state.sets).toEqual(s0.sets);
    const back = apply(reload(r.state), undo('split-1'));
    expect(order(back)).toEqual(['Bench press', 'Cable row:A', 'Face pull:A', 'Dead hang']);
    // A single exercise has nothing to split.
    expect(expectOk(reduceSession(s0, split(s0, rowId(s0, BENCH), 'split-2'))).state.session.version).toBe(s0.session.version);
  });

  it('a link after a split makes the Undo of the split stale', () => {
    const s0 = started();
    const s1 = apply(s0, split(s0, rowId(s0, FACE)));
    const s2 = apply(s1, link(s1, rowId(s1, FACE), rowId(s1, ROW), 'link-1'));
    expectError(reduceSession(s2, undo('split-1')), 'stale_version');
  });
});

describe('finish with a start time (Finish sheet, 19 Oct)', () => {
  it('moves the start and the end, both audited; never after the first set', () => {
    const s0 = started();
    const finish = (startSec: number, opId: string): SessionCommand => ({ type: 'finish', at: at(3600), opId, expectedVersion: s0.session.version, endedAt: at(3000), startedAt: at(startSec) });
    expectError(reduceSession(s0, finish(61, 'f-late')), 'invalid_time');
    const r = expectOk(reduceSession(s0, finish(-600, 'f-1')));
    expect(r.state.session.startedAt).toEqual(at(-600));
    expect(r.state.session.endedAt).toEqual(at(3000));
    expect(r.state.timingAudit.map((e) => [e.field, e.source, e.before?.utc])).toEqual([
      ['startedAt', 'finish', at(0).utc],
      ['endedAt', 'finish', at(3600).utc],
    ]);
    // HANG was never logged, so its pending set is skipped as before.
    expect(setsFor(r.state, HANG).map((x) => x.status)).toEqual(['skipped']);
  });
});

describe('pairing mid-workout starts in the current round (roundOffset)', () => {
  it('bench with two sets done, then the hang: B2 is followed by the hang, not paired with a done round', () => {
    let s = started();
    const [, b1] = setsFor(s, BENCH);
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 200));
    const s1 = apply(s, link(s, rowId(s, HANG), rowId(s, BENCH)));
    const hang = s1.exercises.find((e) => e.exerciseId === HANG);
    expect(hang?.roundOffset).toBe(2);
    const name = (setId: string | undefined) => s1.exercises.find((e) => e.id === s1.sets.find((x) => x.id === setId)?.sessionExerciseId)?.exerciseName;
    const pending = buildExecutionOrder(s1.exercises, s1.sets).filter((x) => s1.sets.find((y) => y.id === x)?.status === 'pending');
    expect(pending.slice(0, 2).map(name)).toEqual(['Bench press', 'Dead hang']);
    // Logging B2 is not a round end: no rest before the hang.
    const [, , b2] = setsFor(s1, BENCH);
    const r = expectOk(reduceSession(s1, logCmd(b2?.id ?? '', values(kg(100), 8), 500)));
    expect(name(r.state.session.activeSetId ?? undefined)).toBe('Dead hang');
    expect(isRoundEnd(r.state.sets.find((x) => x.id === b2?.id) ?? (b2 as never), r.state.exercises, r.state.sets)).toBe(false);
    // Survives a reload; Remove superset keeps the offset but it's no longer read.
    const back = reload(s1);
    expect(back.exercises.find((e) => e.exerciseId === HANG)?.roundOffset).toBe(2);
    const solo = apply(back, split(back, rowId(back, HANG)));
    const soloName = (setId: string | undefined) => solo.exercises.find((e) => e.id === solo.sets.find((x) => x.id === setId)?.sessionExerciseId)?.exerciseName;
    expect(buildExecutionOrder(solo.exercises, solo.sets).map(soloName)).toEqual(['Bench press', 'Bench press', 'Bench press', 'Dead hang', 'Cable row', 'Face pull', 'Cable row', 'Face pull']);
  });
});

describe('the ⋯ menu and the partner list (supersetMenu, supersetPartners, supersetPartnerSets)', () => {
  it('offers Superset with… on a row with a set left, Remove superset on a member; lists rows it can pair with', () => {
    const s = started();
    expect(supersetMenu(s, rowId(s, BENCH))).toEqual({ canPair: true, inSuperset: false });
    expect(supersetMenu(s, rowId(s, ROW))).toEqual({ canPair: true, inSuperset: true });
    expect(supersetPartners(s, rowId(s, BENCH)).map((p) => [p.exerciseName, p.detail])).toEqual([
      ['Cable row', 'Superset A · 2 sets left'],
      ['Face pull', 'Superset A · 2 sets left'],
      ['Dead hang', '1 set left'],
    ]);
    // A member of superset A can't pair with another member, or a row in another superset.
    expect(supersetPartners(s, rowId(s, ROW)).map((p) => p.exerciseName)).toEqual(['Bench press', 'Dead hang']);
    // A new partner starts with the working sets bench has left (2; the warm-up is done).
    expect(supersetPartnerSets(s, rowId(s, BENCH))).toBe(2);
    let done = s;
    for (const x of setsFor(done, HANG)) done = apply(done, logCmd(x.id, values(null, null, { durationS: 45 }), 500));
    expect(supersetMenu(done, rowId(done, HANG)).canPair).toBe(false);
    expect(supersetPartners(done, rowId(done, BENCH)).map((p) => p.exerciseName)).not.toContain('Dead hang');
  });
});

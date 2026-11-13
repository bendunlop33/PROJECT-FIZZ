import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';
import { SessionAggregateSchema } from '@fizz/schemas';
import { buildActiveSetView, gymRouteIds, latestUndoableGymChange, nextTargetBlocks, planFingerprint, reduceSession, toHistorySessions } from '../src/index';
import { at, dumbbells, kg, lb, values } from './fixtures';
import { BENCH, exerciseSets, GYM_NAMES, HOTEL, HOTEL_EQ, hotelRack, INCLINE, LATERAL, MAIN, mainBar, mainRack, propose, pushA, rowOf, switchCmd } from './gym-fixture';
import { apply, expectError, expectOk, logCmd } from './session-fixture';

/**
 * (Ben, 7 Nov; ADR 0041) "If I change gym location mid go it should apply to everything." A switch moves the
 * whole workout: done values stay exactly as logged (rule 2), their gym and item follow, every pending set of every
 * exercise is fitted to the new gym's kit (rule 4), and Undo restores everything.
 */

/**
 * Push A at Main: bench 1–2, incline 1–2 and all three lateral raises done. Ben was really at the hotel all along
 * (Ben's case): he lifted the 20 kg dumbbells it has, not the plan's 32.5.
 */
function midWorkout(inclineDone = 20): SessionAggregate {
  let s = pushA();
  const bench = exerciseSets(s, BENCH);
  const incline = exerciseSets(s, INCLINE);
  const lateral = exerciseSets(s, LATERAL);
  s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(100), 8), 60));
  s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(100), 7), 200));
  s = apply(s, logCmd(incline[0]?.id ?? '', values(kg(inclineDone, 'per_hand'), 10), 400));
  s = apply(s, logCmd(incline[1]?.id ?? '', values(kg(inclineDone, 'per_hand'), 9), 550));
  for (const [i, set] of lateral.entries()) s = apply(s, logCmd(set.id, values(kg(10, 'per_hand'), 15), 700 + i * 120));
  return s;
}

const hotel = { id: HOTEL, equipment: HOTEL_EQ };
const nowMs = (sec: number) => Date.parse(at(sec).utc);

describe('A gym switch is the whole workout (Ben, 7 Nov)', () => {
  const before = midWorkout();
  const p = propose(before, hotel);
  const r = expectOk(reduceSession(before, switchCmd(p, 1200, 'whole-1')));
  const after = r.state;

  it('done sets keep their values exactly; their row moves to the new gym’s item', () => {
    for (const d of before.sets.filter((s) => s.status === 'completed')) {
      const now = after.sets.find((s) => s.id === d.id);
      expect(now?.actual).toEqual(d.actual);
      expect(now?.planned).toEqual(d.planned);
      expect(now?.status).toBe('completed');
      expect(now?.version).toBe(d.version);
    }
    // Incline (2 done, 1 pending) and lateral raise (all done) are now on Hotel's dumbbells: one row each.
    expect(after.exercises.filter((e) => e.exerciseId === INCLINE)).toHaveLength(1);
    expect(rowOf(after, INCLINE)).toMatchObject({ equipmentId: hotelRack.id, unit: 'kg', loadConvention: 'per_hand' });
    expect(rowOf(after, LATERAL)).toMatchObject({ equipmentId: hotelRack.id });
    expect(exerciseSets(after, INCLINE).map((s) => s.sessionExerciseId)).toEqual(Array(3).fill(rowOf(after, INCLINE)?.id));
    expect(SessionAggregateSchema.safeParse(after).success).toBe(true);
  });

  it('every pending set of every exercise is fitted to the new kit (rule 4)', () => {
    expect(after.session.gymId).toBe(HOTEL);
    const incline = exerciseSets(after, INCLINE);
    expect(incline.map((s) => [s.status, s.status === 'completed' ? s.actual?.load : s.planned.load])).toEqual([
      ['completed', kg(20, 'per_hand')],
      ['completed', kg(20, 'per_hand')],
      ['pending', kg(20, 'per_hand')],
    ]);
    // The third set's target was the plan's 32.5: fitted to the rack's 20 (the toast's `1 set fitted`, plus bench and cable).
    expect(after.session.gymChanges?.at(-1)?.changedSetIds).toContain(incline[2]?.id);
    // Bench: Hotel has no bar, so its pending sets lose the load target; cable row likewise.
    expect(exerciseSets(after, BENCH).filter((s) => s.status === 'pending').every((s) => s.planned.load === null)).toBe(true);
    for (const s of after.sets.filter((x) => x.status === 'pending' && x.planned.load !== null)) expect(s.planned.load?.value).toBeLessThanOrEqual(20);
  });

  it('the active view shows no gym divider or other-gym caption', () => {
    const view = buildActiveSetView({ aggregate: after, nowMs: nowMs(1210), gymName: 'Hotel · Lisbon', gymNames: GYM_NAMES, previous: {}, painFlagged: new Set(), edits: null });
    expect(view.focus?.rows.every((row) => row.gymCaption === null)).toBe(true);
    expect(view.focus?.rows.some((row) => 'partStart' in row)).toBe(false);
  });

  it('history, route and next-time read the whole workout as at the new gym', () => {
    expect(gymRouteIds(after.session)).toEqual([HOTEL]);
    expect(after.session.gymChanges?.at(-1)?.wholeWorkout).toBe(true);
    const finished = { ...after, session: { ...after.session, status: 'finished' as const, endedAt: at(2000) } };
    const incline = toHistorySessions(finished, INCLINE);
    expect(incline.map((h) => [h.gymId, h.equipmentId, h.sets.length])).toEqual([[HOTEL, hotelRack.id, 2]]);
    const lateral = toHistorySessions(finished, LATERAL);
    expect(lateral.map((h) => [h.gymId, h.equipmentId])).toEqual([[HOTEL, hotelRack.id]]);
    // Bench: Hotel has no bar, so its done sets keep Main's bar (their item isn't lost); the route is still Hotel.
    expect(toHistorySessions(finished, BENCH).filter((h) => h.sets.length > 0).map((h) => [h.equipmentId, h.sets.length])).toEqual([[mainBar.id, 2]]);
    const blocks = nextTargetBlocks(finished);
    const inclineBlock = blocks.find((b) => b.root.exerciseId === INCLINE);
    expect(inclineBlock).toMatchObject({ split: false, equipment: { id: hotelRack.id } });
  });

  it('Undo restores the previous gym and every changed target and row exactly', () => {
    const change = latestUndoableGymChange(after);
    const u = expectOk(reduceSession(after, { type: 'undo_change_gym', at: at(1230), opId: 'undo-whole-1', actionId: change?.actionId ?? '', expectedFingerprint: change?.afterFingerprint ?? '' })).state;
    expect(u.session.gymId).toBe(MAIN);
    expect(u.exercises.slice(0, before.exercises.length)).toEqual(before.exercises);
    for (const s of before.sets) expect({ ...u.sets.find((x) => x.id === s.id), version: 0 }).toEqual({ ...s, version: 0 });
    expect(gymRouteIds(u.session)).toEqual([MAIN]);
  });

  it('the same opId twice is one switch (idempotent)', () => {
    const again = reduceSession(after, switchCmd(p, 1200, 'whole-1'));
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.duplicate).toBe(true);
      expect(again.state.session.gymChanges).toHaveLength(1);
    }
  });

  it('a stale switch (a set logged since the proposal) is refused, never applied to newer state', () => {
    const logged = apply(before, logCmd(exerciseSets(before, INCLINE)[2]?.id ?? '', values(kg(20, 'per_hand'), 8), 1100));
    expect(planFingerprint(logged)).not.toBe(p.expected.fingerprint);
    expectError(reduceSession(logged, switchCmd(p, 1200, 'whole-stale')), 'stale_version');
  });

  it('done sets in another unit stay on their item; pending sets still move (no data reinterpreted)', () => {
    const lbGym = { id: HOTEL, equipment: [dumbbells({ id: hotelRack.id, gymId: HOTEL, name: 'Hotel dumbbells', unit: 'lb', loads: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] })] };
    const q = propose(before, lbGym, { ownerUnit: 'lb' });
    const s2 = expectOk(reduceSession(before, switchCmd(q, 1200, 'whole-lb'))).state;
    const inclineRows = s2.exercises.filter((e) => e.exerciseId === INCLINE);
    expect(inclineRows).toHaveLength(2);
    const done = exerciseSets(s2, INCLINE).filter((s) => s.status === 'completed');
    expect(done.every((s) => s.sessionExerciseId === inclineRows[0]?.id && s.actual?.load?.unit === 'kg')).toBe(true);
    const pending = exerciseSets(s2, INCLINE).filter((s) => s.status === 'pending');
    expect(pending.map((s) => s.planned.load)).toEqual([lb(50, 'per_hand')]);
    // Still one gym for the workout (the route), and no caption in the view.
    expect(gymRouteIds(s2.session)).toEqual([HOTEL]);
    const view = buildActiveSetView({ aggregate: s2, nowMs: nowMs(1210), gymName: 'Hotel · Lisbon', gymNames: GYM_NAMES, previous: {}, painFlagged: new Set(), edits: null });
    expect(view.focus?.rows.every((row) => row.gymCaption === null)).toBe(true);
  });

  it('done loads the new item couldn’t make keep their old item (history never claims a load past its max)', () => {
    const heavy = midWorkout(32.5);
    const s3 = expectOk(reduceSession(heavy, switchCmd(propose(heavy, hotel), 1200, 'whole-heavy'))).state;
    const rows = s3.exercises.filter((e) => e.exerciseId === INCLINE);
    expect(rows.map((e) => e.equipmentId)).toEqual([mainRack.id, hotelRack.id]);
    expect(exerciseSets(s3, INCLINE).map((x) => [x.status, x.sessionExerciseId])).toEqual([
      ['completed', rows[0]?.id],
      ['completed', rows[0]?.id],
      ['pending', rows[1]?.id],
    ]);
    // Lateral raise (10 kg each) still follows; the workout still reads as at Hotel with no divider or caption.
    expect(rowOf(s3, LATERAL)?.equipmentId).toBe(hotelRack.id);
    expect(gymRouteIds(s3.session)).toEqual([HOTEL]);
    const view = buildActiveSetView({ aggregate: s3, nowMs: nowMs(1210), gymName: 'Hotel · Lisbon', gymNames: GYM_NAMES, previous: {}, painFlagged: new Set(), edits: null });
    expect(view.focus?.rows.every((row) => row.gymCaption === null)).toBe(true);
  });
});

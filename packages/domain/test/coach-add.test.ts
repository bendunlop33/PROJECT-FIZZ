import { describe, expect, it } from 'vitest';
import type { AddExerciseTodayArgs, EquipmentInstance, Exercise, Load, PainFlag, SessionAggregate } from '@fizz/schemas';
import {
  buildAddExerciseCommand,
  checkCoachAdd,
  coachAddRowId,
  getAchievableLoads,
  reduceSession,
  startWorkout,
  type CoachAddInput,
  type HistorySession,
  type SubstituteContext,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, OWNER, profile, stack, TZ, values } from './fixtures';
import { apply, expectOk, logCmd } from './session-fixture';

/**
 * The coach's `add_exercise_today` check (12 Oct): validated against the
 * workout's gym, pain flags and the catalogue; loads from the exercise's own
 * history through the shared fit (B6: blank with no history on that
 * equipment); the workout's own `add_exercise` command. Covers kg/lb,
 * per-hand dumbbells, an equipment max, assisted machines, timed exercises,
 * duplicate op IDs and stale versions.
 */

const steps = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

const MAIN = GYM;
const HOTEL = id(3);
const IMPERIAL = id(4);
const bar = barbell({ id: id(700), gymId: MAIN });
const rack = dumbbells({ id: id(701), gymId: MAIN, name: 'Main dumbbells', loads: steps(2.5, 30, 2.5) });
const cable = stack({ id: id(702), gymId: MAIN, name: 'Cable station', stackLoads: steps(5, 100, 5) });
const assist = assisted({ id: id(703), gymId: MAIN });
const MAIN_EQ: EquipmentInstance[] = [bar, rack, cable, assist];
const hotelRack = dumbbells({ id: id(710), gymId: HOTEL, name: 'Hotel dumbbells', loads: steps(2.5, 20, 2.5) });
const lbRack = dumbbells({ id: id(711), gymId: IMPERIAL, name: 'Imperial dumbbells', unit: 'lb', loads: steps(5, 100, 5) });
const KNOWN = new Map([...MAIN_EQ, hotelRack, lbRack].map((e) => [e.id, e]));

const ex = (n: number, name: string, key: string, over: Partial<Exercise>): Exercise => exercise(n, name, { catalogueKey: key, ...over });
const BENCH = ex(210, 'Bench press', 'barbell-bench-press', { mechanic: 'compound' });
const RAISE = ex(213, 'Lateral raise', 'dumbbell-lateral-raise', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'isolation' });
const INCLINE = ex(211, 'Incline DB press', 'dumbbell-incline-press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', mechanic: 'compound' });
const FLY = ex(212, 'Cable fly', 'cable-fly', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', mechanic: 'isolation' });
const PULLUP = ex(218, 'Assisted pull-up', 'assisted-pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', mechanic: 'compound' });
const PLANK = ex(219, 'Plank', 'plank', { compatibleEquipment: [], defaultLoadConvention: 'bodyweight', measurement: 'duration', mechanic: 'isolation' });
const HACK = ex(220, 'Hack squat', 'hack-squat', { compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'total', mechanic: 'compound' });
const ROWER = ex(221, 'Row erg', 'row-erg', { compatibleEquipment: [], defaultLoadConvention: 'bodyweight', measurement: 'distance' });

function history(n: number, daysAgo: number, equipment: EquipmentInstance | null, load: Load | null, reps: number[]): HistorySession {
  return {
    sessionId: id(n),
    performedAtUtc: at(-daysAgo * 86_400).utc,
    equipmentId: equipment?.id ?? null,
    gymId: equipment?.gymId ?? MAIN,
    imported: false,
    sets: reps.map((r) => ({ setType: 'working' as const, side: null, load, reps: r, rpe: null, rir: null })),
    tz: TZ,
  };
}

const HISTORIES = new Map<string, HistorySession[]>([
  [RAISE.id, [history(900, 2, rack, kg(10, 'per_hand'), [12, 12, 12])]],
  [INCLINE.id, [history(901, 2, rack, kg(27.5, 'per_hand'), [9, 9, 9])]],
  [PULLUP.id, [history(902, 2, assist, kg(30, 'assistance'), [8, 8, 8])]],
]);

function session(gymId: string, equipment: EquipmentInstance[]): SessionAggregate {
  const empty = startWorkout({ opId: 's', owner: profile(), gymId, routine: null, exercises: new Map(), gymEquipment: equipment, at: at(0), newId: idGen(60_000) }).aggregate;
  // Bench, already in today's workout, on the bar when there is one.
  return apply(empty, buildAddExerciseCommand({ opId: 'bench', owner: profile(), exercise: BENCH, equipmentId: equipment.includes(bar) ? bar.id : null, at: at(1), newId: idGen(61_000), plan: [1, 2, 3].map(() => ({ setType: 'working' as const, planned: { load: null, reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null } })) }));
}

function subCtx(gymId: string, equipment: EquipmentInstance[], over: Partial<SubstituteContext> = {}): SubstituteContext {
  return { ownerId: OWNER, unit: 'kg', gym: { id: gymId, name: gymId === IMPERIAL ? 'Imperial gym' : gymId === HOTEL ? 'Hotel gym' : 'Main gym', equipment }, knownEquipment: KNOWN, painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(5), ...over };
}

function args(exerciseId: string, s: SessionAggregate, over: Partial<AddExerciseTodayArgs> = {}): AddExerciseTodayArgs {
  return { baseVersion: s.session.version, exerciseId, workingSets: 3, reps: { min: 10, max: 15 }, workSeconds: null, targetRpe: 8, afterSessionExerciseId: null, supersetWithSessionExerciseId: null, reason: 'Ben asked', ...over };
}

function input(e: Exercise | null, s: SessionAggregate, over: Partial<CoachAddInput> = {}, a: Partial<AddExerciseTodayArgs> = {}): CoachAddInput {
  return {
    aggregate: s,
    args: args(e?.catalogueKey ?? 'unknown', s, a),
    exercise: e,
    history: e === null ? [] : (HISTORIES.get(e.id) ?? []),
    substitute: subCtx(s.session.gymId ?? MAIN, s.session.equipmentSnapshot),
    owner: profile(),
    opId: 'coach-op-1',
    at: at(5),
    ...over,
  };
}

function ok(i: CoachAddInput) {
  const r = checkCoachAdd(i);
  if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}${r.status === 'rejected' ? `: ${r.failure}` : ''}`);
  return r;
}

const rowsNamed = (s: SessionAggregate, name: string) => s.exercises.filter((e) => e.exerciseName === name && e.removed === undefined);

describe('checkCoachAdd: loads from history, fitted to this gym', () => {
  it('per-hand dumbbells from history: 3 working sets on the rack, coach reps and RPE, applied by the reducer', () => {
    const s = session(MAIN, MAIN_EQ);
    const r = ok(input(RAISE, s));
    const after = expectOk(reduceSession(s, r.command)).state;
    const row = rowsNamed(after, 'Lateral raise')[0];
    expect(row).toMatchObject({ equipmentId: rack.id, loadConvention: 'per_hand', unit: 'kg', id: coachAddRowId('coach-op-1') });
    const sets = after.sets.filter((x) => x.sessionExerciseId === row?.id);
    expect(sets).toHaveLength(3);
    for (const x of sets) {
      expect(x.status).toBe('pending');
      expect(x.planned.load?.convention).toBe('per_hand');
      expect(getAchievableLoads(rack).loads).toContain(x.planned.load?.value);
      expect(x.planned).toMatchObject({ reps: { min: 10, max: 15 }, rpe: 8, source: 'coach' });
    }
    expect(r.summary).toMatchObject({ exerciseName: 'Lateral raise', sets: 3, equipmentName: 'Main dumbbells', afterName: null });
    // Bench's sets are untouched.
    expect(after.sets.filter((x) => x.sessionExerciseId === rowsNamed(s, 'Bench press')[0]?.id)).toEqual(s.sets.filter((x) => x.sessionExerciseId === rowsNamed(s, 'Bench press')[0]?.id));
  });

  it('no history on that equipment: the load stays blank (B6), with a note', () => {
    const s = session(MAIN, MAIN_EQ);
    const r = ok(input(FLY, s));
    expect(r.command.plan?.every((p) => p.planned.load === null)).toBe(true);
    expect(r.summary.target.load).toBeNull();
    expect(r.guardNotes.some((n) => /No history/.test(n.text))).toBe(true);
  });

  it('kg history on an lb rack: converted to an achievable lb load, per hand', () => {
    const s = session(IMPERIAL, [lbRack]);
    const r = ok(input(RAISE, s));
    const after = expectOk(reduceSession(s, r.command)).state;
    const row = rowsNamed(after, 'Lateral raise')[0];
    expect(row).toMatchObject({ equipmentId: lbRack.id, unit: 'lb', loadConvention: 'per_hand' });
    const load = after.sets.find((x) => x.sessionExerciseId === row?.id)?.planned.load;
    expect(load?.unit).toBe('lb');
    expect(getAchievableLoads(lbRack).loads).toContain(load?.value);
  });

  it('never past the equipment max: a 27.5 per-hand history on a 20 kg rack is never planned above 20', () => {
    const s = session(HOTEL, [hotelRack]);
    const r = ok(input(INCLINE, s));
    for (const p of r.command.plan ?? []) {
      if (p.planned.load !== null) expect(p.planned.load.value).toBeLessThanOrEqual(20);
    }
  });

  it('an assisted machine keeps the assistance convention', () => {
    const s = session(MAIN, MAIN_EQ);
    const r = ok(input(PULLUP, s, {}, { reps: { min: 6, max: 8 } }));
    expect(r.command.equipmentId).toBe(assist.id);
    for (const p of r.command.plan ?? []) expect(p.planned.load?.convention).toBe('assistance');
    expectOk(reduceSession(s, r.command));
  });

  it('a timed exercise gets its work time, no reps and no load', () => {
    const s = session(MAIN, MAIN_EQ);
    const r = ok(input(PLANK, s, {}, { reps: null, workSeconds: 60, workingSets: 2 }));
    expect(r.command.plan).toHaveLength(2);
    expect(r.command.plan?.[0]?.planned).toMatchObject({ durationS: 60, reps: null, load: null });
    expect(r.command.equipmentId).toBeNull();
    expectOk(reduceSession(s, r.command));
  });

  it('cardio (19 Oct): a time and the distance asked for, no reps, RPE or load; 10:00 when no time; at most 2 h', () => {
    const BIKE = ex(222, 'Exercise bike', 'exercise-bike', { compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', measurement: 'cardio' });
    const s = session(MAIN, MAIN_EQ);
    const r = ok(input(BIKE, s, {}, { reps: null, workSeconds: 1200, distanceMetres: 8000, workingSets: 1, targetRpe: null }));
    expect(r.command.plan).toHaveLength(1);
    expect(r.command.plan?.[0]?.planned).toMatchObject({ durationS: 1200, distanceM: 8000, reps: null, load: null });
    expect(r.command.equipmentId).toBeNull();
    const done = expectOk(reduceSession(s, r.command)).state;
    expect(done.exercises.find((e) => e.exerciseId === BIKE.id)?.measurement).toBe('cardio');
    expect(ok(input(BIKE, s, {}, { reps: null, workSeconds: null, workingSets: 1, targetRpe: null })).command.plan?.[0]?.planned).toMatchObject({ durationS: 600 });
    expect(ok(input(BIKE, s, {}, { reps: null, workSeconds: 4 * 3600, workingSets: 1, targetRpe: null })).command.plan?.[0]?.planned).toMatchObject({ durationS: 7200 });
  });

  it('cardio (review S3): "add a 5k row" is a distance with no time; no RPE lands on a cardio set (N4)', () => {
    const ROWER = ex(223, 'Rowing machine', 'rowing-erg', { compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', measurement: 'cardio' });
    const s = session(MAIN, MAIN_EQ);
    const r = ok(input(ROWER, s, {}, { reps: null, workSeconds: null, distanceMetres: 5000, workingSets: 1, targetRpe: 8 }));
    expect(r.command.plan?.[0]?.planned).toMatchObject({ durationS: null, distanceM: 5000, reps: null, load: null, rpe: null });
    expect(r.summary).toMatchObject({ durationS: null, distanceM: 5000 });
    const done = expectOk(reduceSession(s, r.command)).state;
    const set = done.sets.find((x) => done.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === ROWER.id);
    expect(set?.planned).toMatchObject({ durationS: null, distanceM: 5000 });
    // A distance of 0 is no distance: 10:00 as with neither.
    expect(ok(input(ROWER, s, {}, { reps: null, workSeconds: null, distanceMetres: 0, workingSets: 1, targetRpe: null })).command.plan?.[0]?.planned).toMatchObject({ durationS: 600 });
  });

  it('pain mentioned in today’s check-in holds the load: never above last time', () => {
    const s = session(MAIN, MAIN_EQ);
    const r = ok(input(RAISE, s, { substitute: subCtx(MAIN, MAIN_EQ, { sessionPain: { active: true, reportedAtUtc: at(0).utc } }) }));
    for (const p of r.command.plan ?? []) expect(p.planned.load?.value ?? 0).toBeLessThanOrEqual(10);
  });

  it('clamps sets, reps and RPE with a note each; a missing RPE stays the usual target', () => {
    const s = session(MAIN, MAIN_EQ);
    const r = ok(input(RAISE, s, {}, { workingSets: 15, reps: { min: 15, max: 8 }, targetRpe: 11 }));
    expect(r.command.plan).toHaveLength(10);
    expect(r.command.plan?.[0]?.planned).toMatchObject({ reps: { min: 8, max: 15 }, rpe: 10 });
    expect(r.guardNotes.map((n) => n.text)).toEqual(expect.arrayContaining(['Sets 15 → 10', 'RPE 11 → 10']));
    const none = ok(input(RAISE, s, {}, { targetRpe: null, reps: null }));
    expect(none.command.plan?.[0]?.planned.rpe).toBeNull();
    expect(none.command.plan?.[0]?.planned.reps).not.toBeNull();
  });
});

describe('checkCoachAdd: refusals (nothing is added)', () => {
  const flag: PainFlag = {
    id: id(950),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: at(-86_400).utc,
    updatedAtUtc: at(-86_400).utc,
    exerciseId: RAISE.id,
    exerciseName: 'Lateral raise',
    area: 'shoulder',
    source: 'workout',
    checkInId: null,
    reportedAt: { utc: '2026-10-06T08:00:00.000Z', tz: TZ },
    status: 'active',
    clearedAtUtc: null,
    createdByOpId: 'flag-1',
  };

  it.each([
    ['a pain-flagged movement (rule 9)', () => input(RAISE, session(MAIN, MAIN_EQ), { substitute: subCtx(MAIN, MAIN_EQ, { painFlags: [flag] }) }), /shoulder flagged/],
    ['an exercise already in the workout', () => input(BENCH, session(MAIN, MAIN_EQ)), /already in today/],
    ['nothing to do it on here (rule 4)', () => input(HACK, session(MAIN, MAIN_EQ)), /nothing for it at Main gym/],
    ['an unknown exercise', () => input(null, session(MAIN, MAIN_EQ)), /isn’t one of your exercises/],
    ['a distance exercise', () => input(ROWER, session(MAIN, MAIN_EQ)), /distance/],
    ['a position row that is not in the workout', () => input(RAISE, session(MAIN, MAIN_EQ), {}, { afterSessionExerciseId: id(1234) }), /isn’t in today’s workout/],
  ])('%s', (_label, make, failure) => {
    const r = checkCoachAdd(make());
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.failure).toMatch(failure);
  });

  // Review S2: a FitNotes custom "Lateral Raise" (own ID, no catalogue key) is the same movement.
  const CUSTOM = exercise(260, 'Lateral Raises', { catalogueKey: null, compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', ownerId: OWNER });
  const withCustomRow = (): SessionAggregate =>
    apply(session(MAIN, MAIN_EQ), buildAddExerciseCommand({ opId: 'custom', owner: profile(), exercise: CUSTOM, equipmentId: rack.id, at: at(2), newId: idGen(62_000), plan: [{ setType: 'working' as const, planned: { load: null, reps: { min: 10, max: 12 }, durationS: null, rpe: null, rir: null } }] }));

  it('the same movement under another ID or name (review S2): already in the workout, or flagged, is refused', () => {
    expect(checkCoachAdd(input(RAISE, withCustomRow()))).toMatchObject({ status: 'rejected', failure: 'it’s already in today’s workout' });
    const customFlag: PainFlag = { ...flag, id: id(951), exerciseId: CUSTOM.id, exerciseName: CUSTOM.name };
    const flagged = checkCoachAdd(input(RAISE, session(MAIN, MAIN_EQ), { substitute: subCtx(MAIN, MAIN_EQ, { painFlags: [customFlag] }) }));
    expect(flagged.status === 'rejected' ? flagged.failure : flagged.status).toMatch(/shoulder flagged/);
    // By catalogue key through `sameMovementIds`: Ben's saved copy under another ID and name.
    const COPY = exercise(261, 'DB side raise', { catalogueKey: RAISE.catalogueKey ?? null, compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const copyFlag: PainFlag = { ...flag, id: id(952), exerciseId: COPY.id, exerciseName: COPY.name };
    expect(checkCoachAdd(input(RAISE, session(MAIN, MAIN_EQ), { sameMovementIds: [COPY.id], substitute: subCtx(MAIN, MAIN_EQ, { painFlags: [copyFlag] }) })).status).toBe('rejected');
    expect(checkCoachAdd(input(RAISE, session(MAIN, MAIN_EQ), { substitute: subCtx(MAIN, MAIN_EQ, { painFlags: [copyFlag] }) })).status).toBe('ok');
    // A cleared flag on the look-alike doesn't block it.
    expect(checkCoachAdd(input(RAISE, session(MAIN, MAIN_EQ), { substitute: subCtx(MAIN, MAIN_EQ, { painFlags: [{ ...customFlag, status: 'cleared' }] }) })).status).toBe('ok');
  });

  it('a superset partner that is done is refused', () => {
    let s = session(MAIN, MAIN_EQ);
    const benchRow = rowsNamed(s, 'Bench press')[0];
    for (const [i, set] of s.sets.filter((x) => x.sessionExerciseId === benchRow?.id).entries()) s = apply(s, logCmd(set.id, values(kg(100), 8), 30 + i * 200));
    const r = checkCoachAdd(input(RAISE, s, {}, { supersetWithSessionExerciseId: benchRow?.id ?? null }));
    expect(r).toMatchObject({ status: 'rejected', failure: 'Bench press is done' });
  });

  it('a stale version (the workout moved on since the coach read it) is stale, not applied (rule 5)', () => {
    const s = session(MAIN, MAIN_EQ);
    expect(checkCoachAdd(input(RAISE, s, {}, { baseVersion: s.session.version - 1 })).status).toBe('stale');
    expect(checkCoachAdd({ ...input(RAISE, s), aggregate: null }).status).toBe('stale');
  });
});

describe('checkCoachAdd: position, superset and replays', () => {
  it('after a named row and in a superset, through the same command', () => {
    const s = session(MAIN, MAIN_EQ);
    const benchRow = rowsNamed(s, 'Bench press')[0]?.id ?? null;
    const after = ok(input(FLY, s, {}, { afterSessionExerciseId: benchRow }));
    expect(after.command.afterSessionExerciseId).toBe(benchRow);
    expect(after.summary.afterName).toBe('Bench press');
    const pair = ok(input(FLY, s, {}, { supersetWithSessionExerciseId: benchRow, afterSessionExerciseId: benchRow }));
    expect(pair.command.supersetWithSessionExerciseId).toBe(benchRow);
    expect(pair.command.afterSessionExerciseId).toBeUndefined();
    const state = expectOk(reduceSession(s, pair.command)).state;
    expect(rowsNamed(state, 'Cable fly')[0]?.supersetGroup).toBe(rowsNamed(state, 'Bench press')[0]?.supersetGroup);
  });

  it('the same opId builds the same command (IDs from the opId), and a replay is a duplicate', () => {
    const s = session(MAIN, MAIN_EQ);
    const a = ok(input(RAISE, s));
    const b = ok(input(RAISE, s, { at: at(9) }));
    expect({ ...b.command, at: a.command.at }).toEqual(a.command);
    const once = expectOk(reduceSession(s, a.command)).state;
    expect(expectOk(reduceSession(once, b.command)).duplicate).toBe(true);
  });
});

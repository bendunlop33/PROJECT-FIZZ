import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type EquipmentInstance, type Exercise, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import {
  buildActiveSetView,
  buildGymSwitchProposal,
  calculateNextTargets,
  changeGymCommand,
  lastComparableSession,
  reduceSession,
  routineFromPlan,
  snapPlannedLoad,
  startWorkout,
  startWorkoutFromSession,
  validateTodayAdjustment,
  type HistorySession,
} from '../src/index';
import { at, dumbbells, doubleProgression, exercise, GYM, id, idGen, kg, ms, plateMachine, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, expectError, expectOk, logCmd } from './session-fixture';

/**
 * Review ben-18oct: weight on a bodyweight exercise is checked against the
 * gym's dumbbells and plates on the usual row, which has no equipment (B1),
 * the mode switch is reversible (S1), and the paths around it (S3–S5).
 */

const BACK_EXT = id(800);
const LEG_PRESS = id(801);
const OTHER_GYM = id(3);
const exercises = new Map<string, Exercise>([
  [BACK_EXT, exercise(800, '45° back extension', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', movementPattern: 'hinge' })],
  [LEG_PRESS, exercise(801, 'Leg press', { compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added', movementPattern: 'squat' })],
]);

/** Hotel-style gym: dumbbells 5, 10 and 20 kg, nothing else. */
const small: EquipmentInstance[] = [dumbbells({ loads: [5, 10, 20] })];

function start(over: { addedWeight?: boolean; targets?: number[]; equipment?: EquipmentInstance[]; legPress?: boolean } = {}): SessionAggregate {
  const r = routine([
    routineExercise(810, {
      exerciseId: BACK_EXT,
      order: 0,
      ...(over.addedWeight === true ? { addedWeight: true } : {}),
      setTemplates: [0, 1, 2].map((i) => template(8100 + i, { targetReps: { min: 12, max: 12 }, targetLoad: over.targets?.[i] === undefined ? null : kg(over.targets[i] ?? 0, 'added') })),
    }),
    ...(over.legPress === true ? [routineExercise(811, { exerciseId: LEG_PRESS, equipmentId: plateMachine().id, order: 1, setTemplates: [template(8110, { targetLoad: kg(100, 'added') })] })] : []),
  ]);
  return startWorkout({ opId: 'start-g', owner: profile(), gymId: GYM, routine: r, exercises, gymEquipment: over.equipment ?? small, at: at(0), newId: idGen(80_000) }).aggregate;
}

const row = (s: SessionAggregate, exerciseId = BACK_EXT) => {
  const r = s.exercises.find((e) => e.exerciseId === exerciseId);
  if (!r) throw new Error('row missing');
  return r;
};
const setsOf = (s: SessionAggregate, exerciseId = BACK_EXT) => s.sets.filter((x) => x.sessionExerciseId === row(s, exerciseId).id).sort((a, b) => a.index - b.index);
const mode = (s: SessionAggregate, m: 'added' | 'bodyweight', opId = `mode-${m}`) =>
  reduceSession(s, { type: 'set_load_mode', at: at(5), opId, expectedVersion: s.session.version, sessionExerciseId: row(s).id, mode: m });
const focus = (s: SessionAggregate) => buildActiveSetView({ aggregate: s, nowMs: ms(10), gymName: 'Hotel', previous: {}, painFlagged: new Set(), edits: null }).focus;

describe('B1: added weight on a row with no equipment is checked against the gym', () => {
  it('the row carries the marker from the start, and a typed target snaps to what the gym can make', () => {
    const s = start({ addedWeight: true, targets: [10, 10, 10] });
    expect(row(s).equipmentId).toBeNull();
    expect(setsOf(s).every((x) => x.planned.bodyweightExercise === true)).toBe(true);
    const first = setsOf(s)[0];
    if (!first) throw new Error('sets');
    // No catalogue set passed: the session's own record is enough.
    expect(snapPlannedLoad(s, first.id, 47)).toBe(20);
    expect(snapPlannedLoad(s, first.id, 13)).toBe(15);
    expect(snapPlannedLoad(s, first.id, 0)).toBe(0);
    expect(SessionAggregateSchema.safeParse(s).success).toBe(true);
  });

  it('edit_planned_set refuses an impossible added target; 0 and makeable ones save', () => {
    const s = start({ addedWeight: true, targets: [10, 10, 10] });
    const first = setsOf(s)[0];
    if (!first) throw new Error('sets');
    const edit = (value: number, opId: string) => reduceSession(s, { type: 'edit_planned_set', at: at(5), opId, setId: first.id, expectedSetVersion: first.version, patch: { load: kg(value, 'added') } });
    expectError(edit(47, 'e-47'), 'invalid_values');
    expectOk(edit(15, 'e-15'));
    expectOk(edit(0, 'e-0'));
  });

  it('logging past the heaviest item is flagged off profile and the set card warns', () => {
    let s = start({ addedWeight: true });
    const [first, second] = setsOf(s);
    if (!first || !second) throw new Error('sets');
    s = apply(s, logCmd(first.id, values(kg(47.3, 'added'), 12), 60));
    expect(setsOf(s)[0]?.flags).toEqual(['off_profile_load']);
    s = apply(s, logCmd(second.id, values(kg(15, 'added'), 12), 200));
    expect(setsOf(s)[1]?.flags).toEqual([]);
    const withDraft = apply(s, { type: 'save_draft', at: at(210), setId: setsOf(s)[2]?.id ?? '', values: values(kg(25, 'added'), 12) });
    expect(focus(withDraft)?.offProfileWarning).toBe('Not at Hotel (max 20 kg)');
  });

  it('adjust_pending_targets refuses an added target the gym can’t make', () => {
    const s = start({ addedWeight: true, targets: [10, 10, 10] });
    const first = setsOf(s)[0];
    const cmd: SessionCommand = { type: 'adjust_pending_targets', at: at(100), opId: 'adj', expectedVersion: s.session.version, actionId: id(88_001), changes: [{ setId: first?.id ?? '', target: { load: kg(99, 'added'), reps: null } }], removeSetIds: [], addSets: [] };
    expectError(reduceSession(s, cmd), 'invalid_values');
  });

  it('set_load_mode stamps the marker, so a row switched mid-workout is checked too', () => {
    let s = start();
    s = expectOk(mode(s, 'added')).state;
    expect(setsOf(s).every((x) => x.planned.bodyweightExercise === true)).toBe(true);
    s = apply(s, logCmd(setsOf(s)[0]?.id ?? '', values(kg(30, 'added'), 12), 60));
    expect(setsOf(s)[0]?.flags).toEqual(['off_profile_load']);
  });
});

describe('S1: switching to bodyweight and back keeps the targets', () => {
  it('puts the added targets back, with an earlier edit’s Undo still working', () => {
    let s = start({ addedWeight: true, targets: [10, 10, 10] });
    const first = setsOf(s)[0];
    if (!first) throw new Error('sets');
    s = apply(s, { type: 'edit_planned_set', at: at(3), opId: 'edit-1', setId: first.id, expectedSetVersion: first.version, patch: { load: kg(15, 'added') } });
    s = expectOk(mode(s, 'bodyweight')).state;
    expect(setsOf(s).map((x) => x.planned.load)).toEqual([null, null, null]);
    expect(SessionAggregateSchema.safeParse(s).success).toBe(true);
    s = expectOk(mode(s, 'added', 'mode-added-2')).state;
    expect(setsOf(s).map((x) => x.planned.load)).toEqual([kg(15, 'added'), kg(10, 'added'), kg(10, 'added')]);
    expect(setsOf(s).every((x) => x.planned.otherMode === undefined)).toBe(true);
    // The edit's Undo still applies: the set is as that edit left it.
    s = apply(s, { type: 'undo_op', at: at(9), opId: 'undo-edit', targetOpId: 'edit-1' });
    expect(setsOf(s)[0]?.planned.load).toEqual(kg(10, 'added'));
  });

  it('a target Ben set in the other mode wins over the one set aside', () => {
    let s = start({ addedWeight: true, targets: [10, 10, 10] });
    s = expectOk(mode(s, 'bodyweight')).state;
    const first = setsOf(s)[0];
    if (!first) throw new Error('sets');
    s = apply(s, { type: 'edit_planned_set', at: at(6), opId: 'bw-edit', setId: first.id, expectedSetVersion: first.version, patch: { load: kg(0, 'bodyweight') } });
    s = expectOk(mode(s, 'added', 'mode-added-3')).state;
    // Set 1 had a bodyweight target: set aside, nothing invented. Sets 2–3 get their 10 kg back.
    expect(setsOf(s).map((x) => x.planned.load)).toEqual([null, kg(10, 'added'), kg(10, 'added')]);
  });
});

describe('S5: only bodyweight exercises swap between bodyweight and added', () => {
  it('a leg press whose machine isn’t here stays added only', () => {
    const s = start({ legPress: true });
    const lp = row(s, LEG_PRESS);
    expect(lp.equipmentId).toBeNull();
    expect(lp.loadConvention).toBe('added');
    const set = setsOf(s, LEG_PRESS)[0];
    expectError(reduceSession(s, logCmd(set?.id ?? '', values(kg(0, 'bodyweight'), 10), 60)), 'convention_mismatch');
    expectError(reduceSession(s, { type: 'set_load_mode', at: at(5), opId: 'lp-mode', expectedVersion: s.session.version, sessionExerciseId: lp.id, mode: 'bodyweight' }), 'convention_mismatch');
  });
});

describe('S3/S4: history, Last, gym change, saving and the coach on a weighted row', () => {
  const history = (load: ReturnType<typeof kg>, day: number): HistorySession => ({
    sessionId: id(89_000 + day),
    performedAtUtc: `2026-10-${String(day).padStart(2, '0')}T06:00:00.000Z`,
    equipmentId: null,
    gymId: GYM,
    imported: false,
    sets: [12, 12, 12].map((reps) => ({ setType: 'working' as const, side: null, load, reps, rpe: 8, rir: null })),
  });

  it('Last: a weighted row shows the weighted workout; a bodyweight row skips it for the last bodyweight one', () => {
    const h = [history(kg(0, 'bodyweight'), 1), history(kg(10, 'added'), 5)];
    const weighted = lastComparableSession(h, { equipmentId: null, unit: 'kg', loadConvention: 'added' });
    expect(weighted?.sets[0]?.values.load).toEqual(kg(10, 'added'));
    const bw = lastComparableSession(h, { equipmentId: null, unit: 'kg', loadConvention: 'bodyweight' });
    expect(bw?.sets[0]?.values.load).toEqual(kg(0, 'bodyweight'));
  });

  it('next-session targets from weighted history stay added mass, and Start fits them to the gym', () => {
    const t = calculateNextTargets({
      exerciseName: '45° back extension',
      measurement: 'reps',
      history: [history(kg(20, 'added'), 5)],
      rule: doubleProgression({ repRange: { min: 8, max: 12 } }),
      equipment: null,
      unit: 'kg',
      convention: 'added',
      pain: { active: false, reportedAtUtc: null },
    });
    // The row has no item: the rule's step is unchecked here, like any row without equipment…
    expect(t.decision).toBe('increase_load');
    expect(t.loadFeasibility).toBe('unchecked');
    expect(t.sets.map((x) => x.load)).toEqual([kg(22.5, 'added'), kg(22.5, 'added'), kg(22.5, 'added')]);
    // …and Start fits it to the gym's dumbbells, never past the heaviest (rule 4).
    const s = start({ addedWeight: true, targets: t.sets.map((x) => x.load?.value ?? 0) });
    expect(setsOf(s).map((x) => x.planned.load)).toEqual([kg(20, 'added'), kg(20, 'added'), kg(20, 'added')]);
  });

  it('a gym change fits a weighted row to the new gym’s dumbbells and keeps it weighted', () => {
    const s = start({ addedWeight: true, targets: [20, 20, 20] });
    const other = [dumbbells({ id: id(901), gymId: OTHER_GYM, loads: [4, 8, 12] })];
    const p = buildGymSwitchProposal({ aggregate: s, mode: 'gym_switch', gym: { id: OTHER_GYM, name: 'Other', equipment: other }, gymNames: {}, exercises, painFlagged: new Set(), ownerUnit: 'kg', newId: idGen(81_000) });
    const after = expectOk(reduceSession(s, changeGymCommand(p, 'switch-1', at(50)))).state;
    const live = after.sets.filter((x) => x.status === 'pending' && after.exercises.find((e) => e.id === x.sessionExerciseId)?.exerciseId === BACK_EXT);
    expect(live.map((x) => x.planned.load)).toEqual([kg(12, 'added'), kg(12, 'added'), kg(12, 'added')]);
    expect(live.every((x) => x.planned.bodyweightExercise === true)).toBe(true);
  });

  it('save as workout and repeat keep Add weight', () => {
    const s = start({ addedWeight: true, targets: [10, 10, 10] });
    const saved = routineFromPlan({ id: id(960), ownerId: s.session.ownerId, name: 'Hotel', opId: 'save', plan: s, at: at(2), newId: idGen(82_000), isCompound: () => false });
    expect(saved?.exercises[0]?.addedWeight).toBe(true);
    let done = s;
    for (const [i, set] of setsOf(s).entries()) done = apply(done, logCmd(set.id, values(kg(10, 'added'), 12), 60 + i * 120));
    done = apply(done, { type: 'finish', at: at(600), opId: 'fin', expectedVersion: done.session.version, endedAt: null });
    const again = startWorkoutFromSession({ opId: 'rep', owner: profile(), gymId: GYM, source: done, exercises, gymEquipment: small, at: at(86_400), newId: idGen(83_000) });
    expect(row(again.aggregate).loadConvention).toBe('added');
    expect(setsOf(again.aggregate).every((x) => x.planned.bodyweightExercise === true)).toBe(true);
  });

  it('the coach can change added weight on a weighted row, snapped to the gym and capped at its heaviest item', () => {
    const s = start({ addedWeight: true, targets: [10, 10, 10] });
    const [, second] = setsOf(s);
    const base = { aggregate: s, intent: 'too_easy' as const, opId: 'turn:adjust', painFlags: [], sessionPainUnspecified: false, gymName: 'Hotel', messagePain: null };
    const ok = validateTodayAdjustment({ ...base, args: { baseVersion: s.session.version, reason: 'Too easy.', exercises: [{ sessionExerciseId: row(s).id, sets: [{ setId: second?.id ?? '', target: { load: kg(13, 'added'), reps: null } }], addSet: null, removeSetId: null }] } });
    expect(ok.status).toBe('apply');
    if (ok.status === 'apply') expect(ok.exercises[0]?.changes[0]?.after?.load).toEqual(kg(15, 'added'));
    const capped = validateTodayAdjustment({ ...base, args: { baseVersion: s.session.version, reason: 'Too easy.', exercises: [{ sessionExerciseId: row(s).id, sets: [{ setId: second?.id ?? '', target: { load: kg(40, 'added'), reps: null } }], addSet: null, removeSetId: null }] } });
    expect(capped.status).toBe('apply');
    if (capped.status === 'apply') expect(capped.exercises[0]?.changes[0]?.after?.load).toEqual(kg(20, 'added'));
    // A bodyweight row still refuses an added load from the coach.
    const bw = start();
    const refused = validateTodayAdjustment({ ...base, aggregate: bw, args: { baseVersion: bw.session.version, reason: 'Too easy.', exercises: [{ sessionExerciseId: row(bw).id, sets: [{ setId: setsOf(bw)[1]?.id ?? '', target: { load: kg(10, 'added'), reps: null } }], addSet: null, removeSetId: null }] } });
    expect(refused.status).toBe('unchanged');
  });
});

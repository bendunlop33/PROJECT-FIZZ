import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type EditTodayArgs, type EditTodayOp, type Exercise, type Load, type PainFlag, type SessionAggregate, type SessionCommand } from '@fizz/schemas';
import { isLoadAchievable, namedWeights, planCoachEdit, snapLoad, startWorkout, type CoachEditExerciseInputs, type CoachEditInput } from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, kg, OWNER, profile, stack, TZ } from './fixtures';
import { apply, BENCH, FACE, setsFor, startFixture } from './session-fixture';

/**
 * ADR 0038 (Ben, 28 Oct: "It fails to make the changes I want. It gets very caught up in whether I have
 * equipment or barbells"). The coach acts quietly: weights Ben names are kept as typed (only a machine's
 * max and pain change them), the coach's own ramp is snapped and stays under his top set, an exercise with
 * no item keeps its load, and an op that can't be done is left out while the rest applies.
 */

const RAISE = exercise(231, 'Lateral raise', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const rowId = (s: SessionAggregate, exerciseId: string): string => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.id ?? '';
const working = (s: SessionAggregate, exerciseId: string) => setsFor(s, exerciseId).filter((x) => x.setType !== 'warmup' && x.status !== 'deleted');
const t = (load: Load | null, reps: number | null = null) => ({ load, reps: reps === null ? null : { min: reps, max: reps }, rpe: null });

function inputs(e: Exercise, equipment = [barbell(), stack(), dumbbells()]): CoachEditExerciseInputs {
  return {
    exercise: e,
    history: [],
    owner: profile(),
    sameMovementIds: [],
    substitute: { ownerId: OWNER, unit: 'kg', gym: { id: GYM, name: 'Main gym', equipment }, knownEquipment: new Map(), painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(5) },
  };
}

function plan(s: SessionAggregate, ops: EditTodayOp[], words: string | null, over: Partial<CoachEditInput> = {}, exercises = new Map<number, CoachEditExerciseInputs | null>()): ReturnType<typeof planCoachEdit> {
  const args: EditTodayArgs = { baseVersion: s.session.version, ops, reason: 'Ben asked', benAsked: true, benQuote: words ?? '' };
  return planCoachEdit({ aggregate: s, args, intent: 'general', opId: 'turn-1:edit_today:q', actionId: id(9_100), at: at(500), painFlags: [], sessionPainUnspecified: false, gymName: 'Main gym', messagePain: null, exercises, benLoads: namedWeights(words), ...over });
}

function ok(p: ReturnType<typeof planCoachEdit>) {
  if (p.status !== 'ok') throw new Error(`Expected ok, got ${p.status}${p.status === 'rejected' ? `: ${p.failure}` : ''}`);
  return p;
}

const revert = (target = 'turn-1:edit_today:q'): SessionCommand => ({ type: 'revert_coach_edit', at: at(600), opId: 'undo-q', targetOpId: target, actionId: id(9_100) });

describe('namedWeights: the weights in Ben’s own words', () => {
  it('reads weights with and without a unit; never reps, sets, effort or time', () => {
    expect(namedWeights('give me a workout which builds up to 95 kg barbell row as the last set (with sets and weights)')).toEqual([{ value: 95, unit: 'kg' }]);
    expect(namedWeights('use 30 kg for curls')).toEqual([{ value: 30, unit: 'kg' }]);
    expect(namedWeights('use 30 for curls')).toEqual([{ value: 30, unit: null }]);
    expect(namedWeights('225 lb squat, 100kg top set')).toEqual([{ value: 225, unit: 'lb' }, { value: 100, unit: 'kg' }]);
    expect(namedWeights('grab the 30s')).toEqual([{ value: 30, unit: null }]);
    expect(namedWeights('3x8, 3 sets of 10 @8, RPE 9, 2 RIR, 90s rest, 60 minutes, set 3')).toEqual([]);
    expect(namedWeights(null)).toEqual([]);
  });
});

describe('edit_today `sets`: "build up to 95 kg as the last set" (Ben, 28 Oct)', () => {
  it('his 95 is the last set exactly; the coach’s ramp is achievable, lower and never above it; one Undo', () => {
    const s0 = startFixture().state;
    const bench = rowId(s0, BENCH);
    const said = 'Build up to 95 kg on bench as the last set';
    // The coach's ramp: 72 isn't on the bar (snapped quietly), 100 is above his top set (held under it).
    const p = ok(plan(s0, [{ op: 'sets', sessionExerciseId: bench, sets: [t(kg(60), 5), t(kg(72), 3), t(kg(100), 2), t(kg(95), 1)] }], said));
    const s1 = apply(s0, p.command);
    const loads = working(s1, BENCH).map((x) => x.planned.load?.value);
    expect(loads).toEqual([60, 72.5, 95, 95]);
    expect(loads.at(-1)).toBe(95);
    for (const x of working(s1, BENCH)) expect(x.planned.load !== null && isLoadAchievable(x.planned.load, barbell())).toBe(true);
    expect(working(s1, BENCH).map((x) => x.planned.reps?.min)).toEqual([5, 3, 2, 1]);
    expect(p.lines.map((l) => l.text)).toEqual(['Bench press: 2 → 4 sets']);
    // Restart recovery: the saved workout reads back and the one Undo puts the plan back exactly.
    const reloaded = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s1)));
    const back = apply(reloaded, revert());
    expect(working(back, BENCH).map((x) => x.planned.load?.value)).toEqual([100, 100]);
  });

  it('a weight he names that isn’t on the rack is kept as typed (no rounding), and the workout accepts it', () => {
    const s0 = startFixture().state;
    const bench = rowId(s0, BENCH);
    const p = ok(plan(s0, [{ op: 'sets', sessionExerciseId: bench, sets: [t(kg(96)), t(kg(96))] }], 'make the last two 96 kg'));
    expect(p.guardNotes.map((n) => n.kind)).not.toContain('snapped');
    const s1 = apply(s0, p.command);
    expect(working(s1, BENCH).map((x) => x.planned.load)).toEqual([kg(96), kg(96)]);
    // The coach's own 96 is still fitted to the bar (rule 4).
    const coach = ok(plan(s0, [{ op: 'sets', sessionExerciseId: bench, sets: [t(kg(96)), t(kg(96))] }], 'make the last two a bit lighter'));
    expect(working(apply(s0, coach.command), BENCH).map((x) => x.planned.load?.value)).toEqual([95, 95]);
  });

  it('equipment max: his weight past a machine’s max is capped there, with one line', () => {
    const s0 = startFixture().state;
    const face = setsFor(s0, FACE);
    const p = ok(plan(s0, [{ op: 'set', setId: face[0]?.id ?? '', target: t(kg(65, 'stack')) }], 'put face pulls on 65'));
    expect(p.exercises[0]?.changes[0]?.after?.load).toEqual(kg(50, 'stack'));
    expect(p.guardNotes.filter((n) => n.kind === 'capped').map((n) => n.text)).toEqual(['Max here 50\u00a0kg\u00a0stack']);
    apply(s0, p.command);
  });

  it('kg/lb: a weight he gives in lb on a kg stack is converted exactly, not rounded to the stack', () => {
    const s0 = startFixture().state;
    const face = setsFor(s0, FACE);
    const p = ok(plan(s0, [{ op: 'set', setId: face[0]?.id ?? '', target: t({ value: 66, unit: 'lb', convention: 'stack' }) }], 'face pulls at 66 lb'));
    expect(p.exercises[0]?.changes[0]?.after?.load).toEqual(kg(29.94, 'stack'));
    apply(s0, p.command);
  });

  it('pain: a heavier weight he names on a flagged movement is still held (rule 9)', () => {
    const s0 = startFixture().state;
    const flag: PainFlag = { id: id(8_100), ownerId: OWNER, version: 1, createdAtUtc: at(1).utc, updatedAtUtc: at(1).utc, exerciseId: BENCH, exerciseName: 'Bench press', area: 'shoulder', source: 'coach', checkInId: null, reportedAt: { utc: at(1).utc, tz: TZ }, status: 'active', clearedAtUtc: null, createdByOpId: 'x' };
    const p = plan(s0, [{ op: 'sets', sessionExerciseId: rowId(s0, BENCH), sets: [t(kg(110)), t(kg(110))] }], 'bench at 110 kg', { painFlags: [flag] });
    expect(p).toMatchObject({ status: 'rejected' });
    expect(p.status === 'rejected' ? p.failure : '').toMatch(/shoulder pain/);
  });
});

describe('partial success and kit (ADR 0038)', () => {
  it('an op that can’t be done is left out with one line; the rest applies as one change', () => {
    const s0 = startFixture().state;
    const face = setsFor(s0, FACE);
    const p = ok(plan(s0, [{ op: 'set', setId: face[0]?.id ?? '', target: t(kg(25, 'stack')) }, { op: 'swap', sessionExerciseId: rowId(s0, BENCH), toExerciseId: 'nope' }], 'face pulls 25 and swap bench'));
    expect(p.guardNotes.filter((n) => n.kind === 'structural_dropped').map((n) => n.text)).toEqual(['Not done: it isn’t one of your exercises']);
    const s1 = apply(s0, p.command);
    expect(setsFor(s1, FACE)[0]?.planned.load).toEqual(kg(25, 'stack'));
    expect(rowId(s1, BENCH)).not.toBe('');
  });

  it('only when nothing can be done is the edit refused', () => {
    const s0 = startFixture().state;
    expect(plan(s0, [{ op: 'swap', sessionExerciseId: rowId(s0, BENCH), toExerciseId: 'nope' }], 'swap bench')).toMatchObject({ status: 'rejected', failure: 'it isn’t one of your exercises' });
  });

  it('an exercise the gym has nothing for is added with no item and his weight as typed (kitOptional), per hand', () => {
    const s0 = startFixture().state;
    const add: EditTodayOp = { op: 'add', exerciseId: RAISE.id, workingSets: 3, reps: { min: 12, max: 15 }, workSeconds: null, targetRpe: null, afterSessionExerciseId: null, supersetWithSessionExerciseId: null, load: 11 };
    const p = ok(plan(s0, [add], 'add lateral raises with 11 kg', { kitOptional: true }, new Map([[0, inputs(RAISE, [barbell(), stack()])]])));
    const s1 = apply(s0, p.command);
    const row = s1.exercises.find((e) => e.exerciseId === RAISE.id);
    expect(row?.equipmentId).toBeNull();
    expect(row?.loadConvention).toBe('per_hand');
    expect(setsFor(s1, RAISE.id).map((x) => x.planned.load)).toEqual([kg(11, 'per_hand'), kg(11, 'per_hand'), kg(11, 'per_hand')]);
  });

  it('per-hand dumbbells: a weight he names off the rack is kept as typed; the coach’s own is fitted', () => {
    const { input } = startFixture();
    const s0 = startWorkout({ ...input, gymEquipment: [barbell(), stack(), dumbbells()] }).aggregate;
    const add = (load: number): EditTodayOp => ({ op: 'add', exerciseId: RAISE.id, workingSets: 2, reps: { min: 12, max: 15 }, workSeconds: null, targetRpe: null, afterSessionExerciseId: null, supersetWithSessionExerciseId: null, load });
    const mine = ok(plan(s0, [add(11)], 'add lateral raises with the 11s', {}, new Map([[0, inputs(RAISE)]])));
    expect(setsFor(apply(s0, mine.command), RAISE.id).map((x) => x.planned.load)).toEqual([kg(11, 'per_hand'), kg(11, 'per_hand')]);
    const coach = ok(plan(s0, [add(11)], 'add some lateral raises', {}, new Map([[0, inputs(RAISE)]])));
    expect(setsFor(apply(s0, coach.command), RAISE.id).map((x) => x.planned.load?.value)).toEqual([10, 10]);
  });
});

describe('snapLoad: as typed, no item, assisted', () => {
  const row = { exerciseName: 'Assisted pull-up', loadConvention: 'assistance' as const } as Parameters<typeof snapLoad>[1];
  it('assisted: his assistance is kept as typed inside the machine’s range; outside it, held at the end with one line', () => {
    expect(snapLoad(kg(23, 'assistance'), row, assisted(), 'nearest', false, { asTyped: true, lenient: true })).toMatchObject({ ok: true, load: kg(23, 'assistance'), note: null });
    expect(snapLoad(kg(60, 'assistance'), row, assisted(), 'nearest', false, { asTyped: true, lenient: true })).toMatchObject({ ok: true, load: kg(40, 'assistance'), note: { kind: 'capped' } });
    // The coach's own 23 is fitted (rounded) as before.
    expect(snapLoad(kg(23, 'assistance'), row, assisted(), 'nearest', false, { lenient: true })).toMatchObject({ ok: true, load: kg(25, 'assistance') });
  });

  it('no equipment row (a FitNotes import): today’s load is kept as given, never refused', () => {
    const imported = { exerciseName: 'Seal row', loadConvention: 'total' as const } as Parameters<typeof snapLoad>[1];
    expect(snapLoad(kg(62.3), imported, null, 'nearest', false, { lenient: true })).toEqual({ ok: true, load: kg(62.3), note: null, extra: null });
    // Next session's targets keep the strict check.
    expect(snapLoad(kg(62.3), imported, null, 'nearest')).toMatchObject({ ok: false, note: { kind: 'no_equipment' } });
  });
});

import { describe, expect, it } from 'vitest';
import type { PlannedSet, Routine, SessionAggregate, SetType } from '@fizz/schemas';
import { RoutineSchema } from '@fizz/schemas';

import {
  checkRoutineName,
  createMemoryRepositories,
  createSessionService,
  deleteRoutine,
  liveRoutines,
  nextInRotation,
  planRoutineStart,
  reduceSession,
  renameRoutine,
  restoreRoutine,
  routineCounts,
  routineFromSession,
  routineLastDone,
  startWorkout,
  targetSummaryLines,
  NBSP,
  type FinishedRef,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, OWNER, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, BENCH, exercises, expectError, logCmd, ROW, setsFor, startFixture } from './session-fixture';

const plain = (s: string) => s.replaceAll(NBSP, ' ');

/** Push A finished: bench W 60×10, 102.5×8, 100×7; row 50×12 once (second skipped); face pull and hang skipped. */
function finishedPushA(): SessionAggregate {
  let s = startFixture().state;
  const bench = setsFor(s, BENCH);
  s = apply(s, logCmd(bench[0]?.id ?? '', values(kg(60), 10), 10));
  s = apply(s, logCmd(bench[1]?.id ?? '', values(kg(102.5), 8, { rpe: 9 }), 200));
  s = apply(s, logCmd(bench[2]?.id ?? '', values(kg(100), 5), 400));
  const row = setsFor(s, ROW);
  s = apply(s, logCmd(row[0]?.id ?? '', values(kg(50, 'stack'), 12), 600));
  for (const ex of s.exercises.filter((e) => e.exerciseId !== BENCH)) {
    s = apply(s, { type: 'skip_exercise', at: at(700), opId: `skip-${ex.id}`, sessionExerciseId: ex.id });
  }
  return apply(s, { type: 'finish', at: at(900), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
}

const save = (source: SessionAggregate, name = 'Push A', opId = 'save-1'): Routine => {
  const r = routineFromSession({ id: id(700), ownerId: OWNER, name, opId, source, at: at(1000), newId: idGen(70_000) });
  if (!r) throw new Error('no routine');
  return r;
};

describe('routineFromSession (Save as routine, premium-feel §2.6)', () => {
  it('keeps order, equipment, set types, rep ranges, rest by set type and supersets; loads are the actuals', () => {
    const source = finishedPushA();
    const before = JSON.stringify(source);
    const r = save(source);
    expect(RoutineSchema.parse(r)).toEqual(r);
    expect(r).toMatchObject({ name: 'Push A', version: 1, createdFromSessionId: source.session.id, deletedAtUtc: null, lastOpId: 'save-1' });
    expect(r.exercises.map((e) => e.exerciseId)).toEqual([BENCH, ROW]);
    const [bench, row] = r.exercises;
    expect(bench?.equipmentId).toBe(barbell().id);
    // In the planned range: the range is kept. Outside it (5 under 6–8): the reps done.
    expect(bench?.setTemplates.map((t) => [t.setType, t.targetLoad?.value, t.targetReps])).toEqual([
      ['warmup', 60, { min: 10, max: 10 }],
      ['working', 102.5, { min: 6, max: 8 }],
      ['working', 100, { min: 5, max: 5 }],
    ]);
    expect(bench?.setTemplates.every((t) => t.targetRpe === null)).toBe(true);
    expect(bench?.restBySetType).toEqual({ warmup: { seconds: 60 }, working: { seconds: 180 } });
    // Skipped sets aren't kept; the superset label is.
    expect(row?.setTemplates).toHaveLength(1);
    expect(row?.supersetGroup).toBe('A');
    expect(row?.setTemplates[0]?.targetLoad).toEqual(kg(50, 'stack'));
    expect(routineCounts(r)).toEqual({ exercises: 2, sets: 4 });
    // Saving never touches the finished workout.
    expect(JSON.stringify(source)).toBe(before);
  });

  it('an exercise with only warm-ups done is left out; nothing logged gives no routine', () => {
    let s = startFixture().state;
    s = apply(s, logCmd(setsFor(s, BENCH)[0]?.id ?? '', values(kg(60), 10), 10));
    s = apply(s, logCmd(setsFor(s, ROW)[0]?.id ?? '', values(kg(50, 'stack'), 12), 100));
    s = apply(s, { type: 'finish', at: at(900), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    expect(save(s).exercises.map((e) => e.exerciseId)).toEqual([ROW]);
    let empty = startFixture().state;
    empty = apply(empty, { type: 'finish', at: at(60), opId: 'f', expectedVersion: empty.session.version, endedAt: null });
    expect(routineFromSession({ id: id(701), ownerId: OWNER, name: 'X', opId: 'o', source: empty, at: at(70), newId: idGen(71_000) })).toBeNull();
  });

  it('only finished workouts done in the app: not an active one, not an imported one', () => {
    const active = startFixture().state;
    expect(routineFromSession({ id: id(702), ownerId: OWNER, name: 'X', opId: 'o', source: active, at: at(70), newId: idGen(72_000) })).toBeNull();
    const finished = finishedPushA();
    const imported = { ...finished, session: { ...finished.session, source: 'import' as const } };
    expect(routineFromSession({ id: id(703), ownerId: OWNER, name: 'X', opId: 'o', source: imported, at: at(70), newId: idGen(73_000) })).toBeNull();
  });

  it('a left/right pair counts once', () => {
    const SPLIT = id(220);
    const exs = new Map([[SPLIT, exercise(220, 'Split squat', { laterality: 'unilateral', compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })]]);
    const rack = dumbbells();
    const r = routine([routineExercise(620, { exerciseId: SPLIT, equipmentId: rack.id, setTemplates: [template(6201, { targetLoad: kg(20, 'per_hand') })] })]);
    let s = startWorkout({ opId: 's', owner: profile(), gymId: GYM, routine: r, exercises: exs, gymEquipment: [rack], at: at(0), newId: idGen(74_000) }).aggregate;
    const set = setsFor(s, SPLIT)[0]?.id ?? '';
    s = apply(s, logCmd(set, values(kg(20, 'per_hand'), 8), 10, 'l', 'left'));
    const companion = s.sets.find((x) => x.pairedWithSetId === set)?.id ?? '';
    s = apply(s, logCmd(companion, values(kg(20, 'per_hand'), 8), 60, 'r', 'right'));
    s = apply(s, { type: 'finish', at: at(300), opId: 'f', expectedVersion: s.session.version, endedAt: null });
    const saved = save(s, 'Legs');
    expect(saved.exercises[0]?.setTemplates).toHaveLength(1);
    expect(saved.exercises[0]?.setTemplates[0]?.targetLoad).toEqual(kg(20, 'per_hand'));
  });
});

describe('routine names', () => {
  const existing = [{ id: id(1), name: 'Push A', deletedAtUtc: null }, { id: id(2), name: 'Old', deletedAtUtc: at(0).utc }];
  it('empty and over 120 characters are refused with the sheet’s words', () => {
    expect(checkRoutineName('   ', existing)).toEqual({ ok: false, message: 'Give it a name' });
    expect(checkRoutineName('x'.repeat(121), existing)).toEqual({ ok: false, message: 'Keep it under 120 characters' });
    expect(checkRoutineName(` ${'x'.repeat(120)} `, existing)).toMatchObject({ ok: true });
  });
  it('a duplicate name is allowed with a note; a deleted routine or the one being renamed doesn’t count', () => {
    expect(checkRoutineName('push a', existing)).toEqual({ ok: true, name: 'push a', note: 'You already have a routine called Push A.' });
    expect(checkRoutineName('Push A', existing, id(1))).toEqual({ ok: true, name: 'Push A', note: null });
    expect(checkRoutineName('Old', existing)).toEqual({ ok: true, name: 'Old', note: null });
  });
});

describe('versioned, idempotent routine changes', () => {
  const r = save(finishedPushA());
  it('rename bumps the version and records the operation; a retry is a duplicate; a stale version is refused', () => {
    const c = renameRoutine(r, '  Push B ', 1, 'ren-1', at(2000));
    expect(c.kind).toBe('write');
    if (c.kind !== 'write') return;
    expect(c.next).toMatchObject({ name: 'Push B', version: 2, lastOpId: 'ren-1', updatedAtUtc: at(2000).utc });
    expect(c.expectedVersion).toBe(1);
    expect(renameRoutine(c.next, 'Push B', 1, 'ren-1', at(2001)).kind).toBe('duplicate');
    expect(renameRoutine(c.next, 'Push C', 1, 'ren-2', at(2002)).kind).toBe('stale');
    expect(renameRoutine(c.next, '', 2, 'ren-3', at(2002))).toEqual({ kind: 'invalid', message: 'Give it a name' });
  });
  it('delete is a tombstone that Undo restores; deleted routines drop out of the list', () => {
    const d = deleteRoutine(r, 1, 'del-1', at(3000));
    if (d.kind !== 'write') throw new Error('expected write');
    expect(d.next.deletedAtUtc).toBe(at(3000).utc);
    expect(liveRoutines([d.next])).toEqual([]);
    const u = restoreRoutine(d.next, 2, 'undo-del-1', at(3001));
    if (u.kind !== 'write') throw new Error('expected write');
    expect(u.next).toMatchObject({ deletedAtUtc: null, version: 3, exercises: r.exercises });
    expect(liveRoutines([u.next])).toHaveLength(1);
  });
  it('routines written before these fields still parse (old backups)', () => {
    const old = { ...r } as Partial<Routine>;
    delete old.createdFromSessionId;
    delete old.deletedAtUtc;
    delete old.lastOpId;
    expect(RoutineSchema.safeParse(old).success).toBe(true);
    expect(liveRoutines([old as Routine])).toHaveLength(1);
  });
});

describe('rotation (D19, simplified: by what was done last)', () => {
  const mk = (n: number, name: string, createdAt: number, from: string | null = null) => ({ id: id(n), name, createdAtUtc: at(createdAt).utc, deletedAtUtc: null, createdFromSessionId: from });
  const pushA = mk(801, 'Push A', 0, id(901));
  const pullA = mk(802, 'Pull A', 10);
  const legsA = mk(803, 'Legs A', 20);
  const list = liveRoutines([legsA, pullA, pushA]);
  const ref = (sessionId: number, routineId: string | null, s = 5000): FinishedRef => ({ sessionId: id(sessionId), routineId, startedAtUtc: at(s).utc, tz: 'Pacific/Auckland' });

  it('lists in creation order', () => {
    expect(list.map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Legs A']);
  });
  it('with Pull A done last, Up next is the routine after it, with the basis', () => {
    const pick = nextInRotation(list, ref(950, pullA.id));
    expect(pick).toEqual({ kind: 'routine', routine: legsA, basis: { kind: 'after', routineName: 'Pull A', atUtc: at(5000).utc, tz: 'Pacific/Auckland' } });
  });
  it('wraps round after the last routine', () => {
    expect(nextInRotation(list, ref(951, legsA.id))).toMatchObject({ kind: 'routine', routine: pushA });
  });
  it('the workout a routine was saved from counts as that routine', () => {
    expect(nextInRotation(list, ref(901, null))).toMatchObject({ kind: 'routine', routine: pullA, basis: { routineName: 'Push A' } });
  });
  it('the last workout not from a routine (or a deleted one): Up next stays that workout’s next session', () => {
    expect(nextInRotation(list, ref(952, null))).toEqual({ kind: 'last_workout' });
    expect(nextInRotation(list, ref(953, id(899)))).toEqual({ kind: 'last_workout' });
    expect(nextInRotation([], ref(954, null))).toEqual({ kind: 'last_workout' });
    expect(nextInRotation(list, null)).toEqual({ kind: 'last_workout' });
  });
  it('one routine: `Your only routine`', () => {
    expect(nextInRotation([pushA], ref(901, null))).toEqual({ kind: 'routine', routine: pushA, basis: { kind: 'only' } });
  });
  it('last done per routine: the newest finished workout from it, or none', () => {
    const done = routineLastDone(list, [ref(901, null, 100), ref(960, pullA.id, 200), ref(961, pullA.id, 400), ref(962, null, 500)]);
    expect(done.get(pushA.id)?.sessionId).toBe(id(901));
    expect(done.get(pullA.id)?.sessionId).toBe(id(961));
    expect(done.get(legsA.id)).toBeNull();
  });
});

describe('planRoutineStart (start a routine with next-session targets)', () => {
  const source = finishedPushA();
  const pushA = save(source);
  const plan = (load: number | null, reps: [number, number], n = 2, setType: SetType = 'working') =>
    Array.from({ length: n }, () => ({ setType, planned: { load: load === null ? null : kg(load), reps: { min: reps[0], max: reps[1] }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' } satisfies PlannedSet }));
  const base = { opId: 'rs-1', owner: profile(), gymId: GYM, routine: pushA, exercises, knownEquipment: new Map(), at: at(86_400), newId: idGen(80_000) };

  it('structure from the routine; loads and reps from the targets, labelled; the routine’s warm-up kept', () => {
    const targets = new Map([[BENCH, plan(105, [6, 8])]]);
    const out = planRoutineStart({ ...base, gymEquipment: [barbell(), stack()], targets });
    const s = out.aggregate;
    expect(s.session).toMatchObject({ routineId: pushA.id, routineName: 'Push A', status: 'active', startOperationId: 'rs-1' });
    expect(setsFor(s, BENCH).map((x) => [x.setType, x.planned.load?.value, x.planned.reps, x.planned.source])).toEqual([
      ['warmup', 60, { min: 10, max: 10 }, undefined],
      ['working', 105, { min: 6, max: 8 }, 'built_in_rule'],
      ['working', 105, { min: 6, max: 8 }, 'built_in_rule'],
    ]);
    // No targets for the row: the routine's own template (no source = routine template).
    expect(setsFor(s, ROW).map((x) => [x.planned.load, x.planned.reps, x.planned.source])).toEqual([[kg(50, 'stack'), { min: 10, max: 12 }, undefined]]);
    expect(out.notes).toEqual([]);
    expect(targetSummaryLines(s).map((l) => plain(l.line))).toEqual(['Target 105 kg × 6–8 · 2 sets', 'Target 50 kg stack × 10–12 · 1 set']);
  });

  it('Why?: a rule target keeps the rule’s provenance (never `Your routine`), with any fit said against the target (review B1.1)', () => {
    const ruleWhy = { source: 'rule' as const, setAt: at(86_000), routineName: null, requestedLoad: null, basis: null, rule: { name: 'Built-in', decision: 'increase_load' as const, summary: 'Increase to 105 kg for 6–8 reps.', facts: [] }, guardNotes: [] };
    const withWhy = plan(105, [6, 8]).map((p) => ({ ...p, planned: { ...p.planned, provenance: ruleWhy } }));
    const out = planRoutineStart({ ...base, gymEquipment: [barbell(), stack()], targets: new Map([[BENCH, withWhy]]) });
    const bench = setsFor(out.aggregate, BENCH);
    expect(bench.filter((x) => x.setType !== 'warmup').map((x) => x.planned.provenance)).toEqual([ruleWhy, ruleWhy]);
    // The routine's own warm-up and rows keep the routine as their source.
    expect(bench[0]?.planned.provenance?.source).toBe('plan');
    expect(setsFor(out.aggregate, ROW)[0]?.planned.provenance?.source).toBe('plan');

    // At a lighter gym the rule's 105 kg is capped, and Why? says so against the target.
    const lighter = barbell({ plates: [{ mass: 20, count: 2 }] });
    const capped = planRoutineStart({ ...base, opId: 'rs-light', gymEquipment: [lighter, stack()], targets: new Map([[BENCH, withWhy]]) });
    const set = setsFor(capped.aggregate, BENCH).find((x) => x.setType !== 'warmup');
    expect(set?.planned.provenance?.source).toBe('rule');
    expect(set?.planned.provenance?.guardNotes.map(plain)).toEqual(['Capped at 60 kg: the most this bar makes. Target was 105 kg.']);

    // A rule target stored without provenance reads Not recorded, never the routine's words.
    const bare = planRoutineStart({ ...base, opId: 'rs-bare', gymEquipment: [barbell(), stack()], targets: new Map([[BENCH, plan(105, [6, 8])]]) });
    expect(setsFor(bare.aggregate, BENCH).filter((x) => x.setType !== 'warmup').map((x) => x.planned.provenance)).toEqual([undefined, undefined]);
  });

  it('an exercise in two slots keeps each slot’s own templates, never the first slot’s targets twice (review S7)', () => {
    const benchSlots = pushA.exercises.filter((e) => e.exerciseId === BENCH);
    const first = benchSlots[0];
    if (!first) throw new Error('no bench slot');
    const light = { ...first, id: id(640), order: pushA.exercises.length, setTemplates: [template(6401, { setType: 'working', targetLoad: kg(70), targetReps: { min: 12, max: 15 } })] };
    const r: Routine = { ...pushA, exercises: [...pushA.exercises, light] };
    const out = planRoutineStart({ ...base, routine: r, gymEquipment: [barbell(), stack()], targets: new Map([[BENCH, plan(105, [6, 8])]]) });
    const sx = out.aggregate.exercises.filter((e) => e.exerciseId === BENCH);
    expect(sx).toHaveLength(2);
    const loads = sx.map((e) => out.aggregate.sets.filter((x) => x.sessionExerciseId === e.id && x.setType !== 'warmup').map((x) => [x.planned.load?.value, x.planned.source]));
    expect(loads[1]).toEqual([[70, undefined]]);
    expect(loads.flat().some(([v]) => v === 105)).toBe(false);
  });

  it('a top set then back-offs: the preview line names both targets (review N10)', () => {
    const targets = new Map([[BENCH, [...plan(105, [3, 3], 1, 'top'), ...plan(90, [6, 8], 2, 'backoff')]]]);
    const out = planRoutineStart({ ...base, gymEquipment: [barbell(), stack()], targets });
    expect(plain(targetSummaryLines(out.aggregate)[0]?.line ?? '')).toBe('Target 105 kg × 3, then 90 kg × 6–8 · 3 sets');
  });

  it('never above the equipment’s max: rounded down, with a note', () => {
    const small = barbell({ plates: [{ mass: 20, count: 2 }] });
    const out = planRoutineStart({ ...base, gymEquipment: [small, stack()], targets: new Map([[BENCH, plan(105, [6, 8])]]) });
    expect(setsFor(out.aggregate, BENCH).map((x) => x.planned.load?.value)).toEqual([60, 60, 60]);
    expect(out.notes).toContainEqual({ exerciseName: 'Bench press', text: 'Rounded down from 105 kg: this gym stops at 60 kg.' });
  });

  it('kg targets at an lb dumbbell rack: per hand, converted toward easier', () => {
    const DB = id(230);
    const exs = new Map([[DB, exercise(230, 'DB press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })]]);
    const kgRack = dumbbells();
    const lbRack = dumbbells({ id: id(130), name: 'Hotel rack', unit: 'lb', loads: [10, 20, 30, 40, 45, 50] });
    const r: Routine = { ...pushA, exercises: [routineExercise(630, { exerciseId: DB, equipmentId: kgRack.id, setTemplates: [template(6301, { targetLoad: kg(22.5, 'per_hand') })] })] };
    const out = planRoutineStart({ ...base, routine: r, exercises: exs, gymEquipment: [lbRack], knownEquipment: new Map([[kgRack.id, kgRack]]) });
    expect(setsFor(out.aggregate, DB)[0]?.planned.load).toEqual(lb(45, 'per_hand'));
    expect(out.notes.map((n) => n.text)).toContain('Rounded from 22.5 kg each to 45 lb each to match this gym.');
  });

  it('assisted machine: rounding goes toward more assistance (easier), never less', () => {
    const PULL = id(231);
    const exs = new Map([[PULL, exercise(231, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })]]);
    const machine = assisted();
    const r: Routine = { ...pushA, exercises: [routineExercise(631, { exerciseId: PULL, equipmentId: machine.id, setTemplates: [template(6311)] })] };
    const targets = new Map([[PULL, [{ setType: 'working' as const, planned: { load: kg(27.5, 'assistance'), reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' as const } }]]]);
    const out = planRoutineStart({ ...base, routine: r, exercises: exs, gymEquipment: [machine], targets });
    expect(setsFor(out.aggregate, PULL)[0]?.planned.load).toEqual(kg(30, 'assistance'));
  });

  it('the routine’s equipment isn’t here and nothing of its kind is: reps kept, loads dropped, said plainly', () => {
    const out = planRoutineStart({ ...base, gymEquipment: [dumbbells()], knownEquipment: new Map([[barbell().id, barbell()], [stack().id, stack()]]) });
    expect(setsFor(out.aggregate, BENCH).every((x) => x.planned.load === null)).toBe(true);
    expect(setsFor(out.aggregate, BENCH).map((x) => x.planned.reps?.min)).toEqual([10, 6, 5]);
    expect(out.notes).toContainEqual({ exerciseName: 'Bench press', text: 'No Olympic bar here: no load target.' });
    expect(out.notes).toContainEqual({ exerciseName: 'Cable row', text: 'No Cable stack here: no load target.' });
  });

  it('the same kind at another gym is used when the routine’s own item isn’t there', () => {
    const other = barbell({ id: id(140), name: 'Hotel bar' });
    const out = planRoutineStart({ ...base, gymEquipment: [other, stack()], knownEquipment: new Map([[barbell().id, barbell()]]) });
    expect(out.aggregate.exercises.find((e) => e.exerciseId === BENCH)?.equipmentId).toBe(other.id);
    expect(setsFor(out.aggregate, BENCH)[1]?.planned.load).toEqual(kg(102.5));
  });

  it('an exercise added during a routine’s workout never joins the routine', () => {
    let s = planRoutineStart({ ...base, gymEquipment: [barbell(), stack()] }).aggregate;
    const HANG_ID = id(203);
    s = apply(s, {
      type: 'add_exercise',
      at: at(86_500),
      opId: 'add-hang',
      newSessionExerciseId: id(88_000),
      newSetId: id(88_001),
      exercise: { exerciseId: HANG_ID, name: 'Dead hang', measurement: 'duration', laterality: 'bilateral', defaultLoadConvention: 'bodyweight', compatibleEquipment: ['bodyweight_station'] },
      equipmentId: null,
      unit: 'kg',
      rest: { seconds: 60, source: 'global_default', sourceLabel: 'Default' },
    });
    expect(s.exercises).toHaveLength(3);
    const again = planRoutineStart({ ...base, opId: 'rs-2', gymEquipment: [barbell(), stack()], newId: idGen(81_000) }).aggregate;
    expect(again.exercises.map((e) => e.exerciseId)).toEqual([BENCH, ROW]);
  });
});

describe('session service: startRoutine', () => {
  async function seed() {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile(), null);
    for (const eq of [barbell(), stack()]) await repos.equipment.save(eq, null);
    for (const ex of exercises.values()) await repos.exercises.save(ex, null);
    const r = save(finishedPushA());
    await repos.routines.save(r, null);
    return { repos, r };
  }

  it('is idempotent by opId: a double tap starts one workout', async () => {
    const { repos, r } = await seed();
    const svc = createSessionService(repos, idGen(90_000));
    const first = await svc.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: r.id, opId: 'tap-1', at: at(10) });
    const second = await svc.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: r.id, opId: 'tap-1', at: at(11) });
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    if (!first.ok || !second.ok) return;
    expect(second.aggregate.session.id).toBe(first.aggregate.session.id);
    // A different start while one is active is refused.
    expect(await svc.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: r.id, opId: 'tap-2', at: at(12) })).toMatchObject({ ok: false, error: { code: 'session_already_active' } });
  });

  it('a preview saves nothing; a deleted routine can’t be started', async () => {
    const { repos, r } = await seed();
    const svc = createSessionService(repos, idGen(91_000));
    expect(await svc.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: r.id, opId: 'p', at: at(10), preview: true })).toMatchObject({ ok: true });
    expect(await repos.sessions.getActive(OWNER)).toBeNull();
    const d = deleteRoutine(r, 1, 'del', at(20));
    if (d.kind !== 'write') throw new Error('expected write');
    await repos.routines.save(d.next, 1);
    expect(await svc.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: r.id, opId: 'x', at: at(30) })).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('rename_session', () => {
  const rename = (s: SessionAggregate, name: string, opId: string, expectedVersion = s.session.version) => reduceSession(s, { type: 'rename_session', at: at(1000), opId, name, expectedVersion });

  it('renames a planned workout in progress, bumping its version; the duplicate is a no-op', () => {
    const s = startFixture().state;
    const r = rename(s, ' Chest day ', 'ren-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.session).toMatchObject({ routineName: 'Chest day', version: s.session.version + 1 });
    expect(r.events).toContainEqual({ type: 'SessionRenamed', name: 'Chest day' });
    expect(reduceSession(r.state, { type: 'rename_session', at: at(1001), opId: 'ren-1', name: ' Chest day ', expectedVersion: s.session.version })).toMatchObject({ ok: true, duplicate: true, superseded: false });
  });

  it('a stale rename is refused, never applied to newer state', () => {
    const s = startFixture().state;
    const renamed = apply(s, { type: 'rename_session', at: at(1000), opId: 'a', name: 'One', expectedVersion: s.session.version });
    expectError(rename(renamed, 'Two', 'b', s.session.version), 'stale_version');
  });

  it('undo is a rename back; the first rename then reads as superseded', () => {
    const s = startFixture().state;
    const renamed = apply(s, { type: 'rename_session', at: at(1000), opId: 'a', name: 'One', expectedVersion: s.session.version });
    const undone = apply(renamed, { type: 'rename_session', at: at(1001), opId: 'undo-a', name: 'Push A', expectedVersion: renamed.session.version });
    expect(undone.session.routineName).toBe('Push A');
    expect(reduceSession(undone, { type: 'rename_session', at: at(1002), opId: 'a', name: 'One', expectedVersion: s.session.version })).toMatchObject({ ok: true, duplicate: true, superseded: true });
  });

  it('works after Finish and never renames the routine; refused once discarded', () => {
    const done = finishedPushA();
    const r = rename(done, 'Heavy push', 'ren-f');
    expect(r.ok && r.state.session.routineName).toBe('Heavy push');
    expect(r.ok && r.state.session.routineId).toBe(done.session.routineId);
    let d = startFixture().state;
    d = apply(d, { type: 'discard', at: at(5), opId: 'disc', confirmedLoggedSets: 0, expectedVersion: d.session.version });
    expectError(rename(d, 'X', 'ren-d'), 'session_finished');
  });

  it('an open-ended workout in progress is named after Finish (naming would change how it rests)', () => {
    const open = startWorkout({ opId: 'o', owner: profile(), gymId: GYM, routine: null, exercises, gymEquipment: [], at: at(0), newId: idGen(95_000) }).aggregate;
    expectError(rename(open, 'Push', 'ren-o'), 'session_not_finished');
    const finished = apply(open, { type: 'finish', at: at(60), opId: 'fo', expectedVersion: open.session.version, endedAt: null });
    const named = apply(finished, { type: 'rename_session', at: at(70), opId: 'ren-o2', name: 'Push', expectedVersion: finished.session.version });
    expect(named.session.routineName).toBe('Push');
    // Undo of naming an unnamed workout clears the name again (finished workouts only).
    const cleared = apply(named, { type: 'rename_session', at: at(80), opId: 'undo-o2', name: null, expectedVersion: named.session.version });
    expect(cleared.session.routineName).toBeNull();
    expectError(reduceSession(startFixture().state, { type: 'rename_session', at: at(90), opId: 'clr', name: null, expectedVersion: 1 }), 'session_not_finished');
  });

  it('an empty or over-long name fails validation', async () => {
    const repos = createMemoryRepositories();
    const s = startFixture().state;
    await repos.sessions.save(s, null);
    const svc = createSessionService(repos, idGen(96_000));
    expect(await svc.dispatch(s.session.id, { type: 'rename_session', at: at(10), opId: 'e', name: '  ', expectedVersion: s.session.version })).toMatchObject({ ok: false, error: { code: 'invalid_command' } });
    expect(await svc.dispatch(s.session.id, { type: 'rename_session', at: at(10), opId: 'l', name: 'x'.repeat(121), expectedVersion: s.session.version })).toMatchObject({ ok: false, error: { code: 'invalid_command' } });
  });
});

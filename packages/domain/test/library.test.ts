import { describe, expect, it } from 'vitest';
import type { Routine, RoutineExercise, ZonedTimestamp } from '@fizz/schemas';
import { RoutineSchema } from '@fizz/schemas';

import {
  buildLibraryView,
  createRoutine,
  deleteRoutine,
  deriveSessionTypes,
  duplicateRoutine,
  editableEdit,
  editableExercises,
  editRoutine,
  isInRotation,
  LIBRARY_HISTORY_CAP,
  mainFlags,
  nextInRotation,
  normaliseRoutineExercises,
  restoreRoutine,
  rotationRoutines,
  routineChangeLines,
  routineEditDirty,
  routineFromPlan,
  notSavedFromPlan,
  notCopiedText,
  planSettingsOfRoutine,
  mergeRoutineEdits,
  startWorkout,
  routineGymIssues,
  routineIssues,
  saveSheetDetail,
  unnamedWorkoutName,
  withSaveEdit,
  setRoutineRotation,
  NBSP,
  type LibraryRoutineInput,
  type SessionTypeSession,
} from '../src/index';
import { at, barbell, id, idGen, kg, OWNER, routineExercise, stack, template } from './fixtures';
import { apply, BENCH, FACE, HANG, ROW, setsFor, startFixture } from './session-fixture';

const plain = (s: string) => s.replaceAll(NBSP, ' ');
const compound = (x: string) => x === BENCH || x === ROW;

const exs = (): RoutineExercise[] => [
  routineExercise(10, { exerciseId: BENCH, order: 0, setTemplates: [template(101, { setType: 'warmup', targetReps: { min: 5, max: 5 } }), template(102), template(103)] }),
  routineExercise(11, { exerciseId: ROW, order: 1, setTemplates: [template(111), template(112)] }),
  routineExercise(12, { exerciseId: FACE, order: 2, setTemplates: [template(121, { targetReps: { min: 12, max: 15 } })] }),
];

function made(name = 'Push A', o: { inRotation?: boolean; id?: string; opId?: string; at?: ZonedTimestamp } = {}): Routine {
  const c = createRoutine({ id: o.id ?? id(900), ownerId: OWNER, edit: { name, exercises: exs() }, opId: o.opId ?? 'new-1', at: o.at ?? at(0), isCompound: compound, ...(o.inRotation === undefined ? {} : { inRotation: o.inRotation }) });
  if (c.kind !== 'write') throw new Error(c.message);
  return c.next;
}

describe('createRoutine / routineIssues (routines.md §A2.3, §A6)', () => {
  it('a new workout is Ben’s, version 1, Main written down (WL9), out of the rotation unless asked', () => {
    const r = made();
    expect(RoutineSchema.parse(r)).toEqual(r);
    expect(r).toMatchObject({ version: 1, source: 'ben', inRotation: false, lastOpId: 'new-1', deletedAtUtc: null, createdFromSessionId: null });
    expect(r.exercises.map((e) => e.main)).toEqual([true, true, false]);
    expect(r.exercises.map((e) => e.order)).toEqual([0, 1, 2]);
    expect(made('X', { inRotation: true })).toMatchObject({ inRotation: true, rotationAtUtc: at(0).utc });
  });

  it('refuses what can’t be saved, first issue first', () => {
    expect(routineIssues({ name: ' ', exercises: [] })).toEqual(['Add a name', 'Add an exercise']);
    expect(routineIssues({ name: 'x'.repeat(121), exercises: exs() })).toEqual(['Keep it under 120 characters']);
    const bad = exs().map((e, i) => (i === 0 ? { ...e, setTemplates: [template(1, { targetReps: { min: 8, max: 6 } })] } : i === 1 ? { ...e, setTemplates: [] } : e));
    expect(routineIssues({ name: 'A', exercises: bad })).toEqual(['Add at least one set.', 'Reps: the first number must be the smaller one.']);
    const many = Array.from({ length: 41 }, (_, i) => routineExercise(2000 + i, { exerciseId: BENCH, order: i }));
    expect(routineIssues({ name: 'A', exercises: many })).toEqual(['Up to 40 exercises']);
    const sets = [routineExercise(3000, { exerciseId: BENCH, setTemplates: Array.from({ length: 31 }, (_, i) => template(30_000 + i)) })];
    expect(routineIssues({ name: 'A', exercises: sets })).toEqual(['Up to 30 sets per exercise']);
    expect(createRoutine({ id: id(901), ownerId: OWNER, edit: { name: '', exercises: exs() }, opId: 'o', at: at(0), isCompound: compound })).toEqual({ kind: 'invalid', message: 'Add a name' });
  });

  it('refuses a distance slot in create, edit and Save › Edit (EL-B13, review library-browse r2 S1)', () => {
    const isDistance = (x: string) => x === FACE;
    expect(routineIssues({ name: 'A', exercises: exs() }, isDistance)).toEqual(['Can’t save distance yet']);
    expect(routineIssues({ name: 'A', exercises: exs() }, () => false)).toEqual([]);
    expect(createRoutine({ id: id(903), ownerId: OWNER, edit: { name: 'A', exercises: exs() }, opId: 'o', at: at(0), isCompound: compound, isDistance })).toEqual({ kind: 'invalid', message: 'Can’t save distance yet' });
    const r = made();
    expect(editRoutine(r, { name: 'A', exercises: r.exercises }, 1, 'e1', at(1), compound, isDistance)).toEqual({ kind: 'invalid', message: 'Can’t save distance yet' });
    // A retry of a save that landed, or a stale one, is reported as such before validation (rule 5).
    expect(editRoutine(r, { name: 'A', exercises: r.exercises }, 1, 'new-1', at(1), compound, isDistance)).toMatchObject({ kind: 'duplicate' });
    expect(withSaveEdit(r, { name: 'A', exercises: r.exercises }, compound, isDistance)).toEqual({ kind: 'invalid', message: 'Can’t save distance yet' });
  });

  it('Main (WL9): an all-isolation workout marks only the first; Ben’s choice wins over the rule', () => {
    const iso = createRoutine({ id: id(902), ownerId: OWNER, edit: { name: 'Arms', exercises: exs() }, opId: 'o', at: at(0), isCompound: () => false });
    expect(iso.kind === 'write' && iso.next.exercises.map((e) => e.main)).toEqual([true, false, false]);
    const off = exs().map((e, i) => (i === 0 ? { ...e, main: false } : e));
    expect(mainFlags(off, compound)).toEqual([false, true, false]);
  });
});

describe('editRoutine (§A4.2, WL10, rule 5)', () => {
  const r = made();
  it('writes the next version; a retried opId is a duplicate; an older version is stale; nothing invalid is written', () => {
    const edit = { name: 'Push B ', exercises: editableExercises(r).slice(0, 2) };
    const c = editRoutine(r, edit, 1, 'edit-1', at(60), compound);
    expect(c.kind).toBe('write');
    if (c.kind !== 'write') return;
    expect(c.next).toMatchObject({ name: 'Push B', version: 2, lastOpId: 'edit-1', source: 'ben', inRotation: false });
    expect(c.next.exercises).toHaveLength(2);
    expect(editRoutine(c.next, edit, 1, 'edit-1', at(61), compound)).toEqual({ kind: 'duplicate', current: c.next });
    expect(editRoutine(c.next, edit, 1, 'edit-2', at(61), compound)).toEqual({ kind: 'stale', current: c.next });
    expect(editRoutine(c.next, { name: 'X', exercises: [] }, 2, 'edit-3', at(61), compound)).toEqual({ kind: 'invalid', message: 'Add an exercise' });
  });

  it('editing a coach workout makes it Ben’s (WB8); rotation and history link are kept', () => {
    const coach: Routine = { ...made('Push · 45 min', { inRotation: true }), source: 'coach', createdFromSessionId: id(77) };
    const c = editRoutine(coach, { name: coach.name, exercises: coach.exercises }, 1, 'e', at(5), compound);
    expect(c.kind === 'write' && c.next).toMatchObject({ source: 'ben', inRotation: true, rotationAtUtc: at(0).utc, createdFromSessionId: id(77) });
  });

  it('a routine from before the library opens with Auto loads (its loads were last time’s actuals)', () => {
    const old: Routine = { ...made(), exercises: exs().map((e) => ({ ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetLoad: kg(60) })) })) };
    delete old.source;
    expect(editableExercises(old).flatMap((e) => e.setTemplates).every((t) => t.targetLoad === null)).toBe(true);
    const pinned = { ...made(), exercises: old.exercises };
    expect(editableExercises(pinned).flatMap((e) => e.setTemplates).every((t) => t.targetLoad?.value === 60)).toBe(true);
  });

  it('change lines and dirty state', () => {
    const before = made();
    const list = editableExercises(before);
    expect(routineEditDirty({ name: before.name, exercises: list }, { name: 'Push A ', exercises: list })).toBe(false);
    const moved = normaliseRoutineExercises([list[1], list[0], list[2]].filter((x): x is RoutineExercise => x !== undefined));
    expect(routineEditDirty({ name: before.name, exercises: list }, { name: before.name, exercises: moved })).toBe(true);
    const nameOf = (x: string) => ({ [BENCH]: 'Bench press', [ROW]: 'Cable row', [FACE]: 'Face pull', [HANG]: 'Dead hang' })[x] ?? 'Exercise';
    const added = [...moved.slice(0, 2), routineExercise(13, { exerciseId: HANG, order: 2 })];
    expect(routineChangeLines(before, { name: 'Push B', exercises: added }, nameOf).map((l) => l.text)).toEqual(['Renamed to Push B', 'Added Dead hang', 'Removed Face pull', 'New order']);
    const reps = list.map((e, i) => (i === 0 ? { ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetReps: { min: 6, max: 8 } })) } : e));
    expect(routineChangeLines(before, { name: before.name, exercises: reps }, nameOf)).toEqual([{ change: 'edit', text: 'Bench press edited' }]);
  });
});

describe('duplicateRoutine (§4.4, WL-A7)', () => {
  it('`Push A copy`: new IDs throughout, linked, never in the rotation, Main kept', () => {
    const r = { ...made('Push A', { inRotation: true }), exercises: made().exercises.map((e, i) => (i === 0 ? { ...e, main: false } : e)) };
    const copy = duplicateRoutine(r, { id: id(950), opId: 'dup-1', at: at(10), newId: idGen(95_000), isCompound: compound });
    expect(RoutineSchema.parse(copy)).toEqual(copy);
    expect(copy).toMatchObject({ id: id(950), name: 'Push A copy', version: 1, source: 'ben', inRotation: false, createdFromRoutineId: r.id, lastOpId: 'dup-1' });
    expect(copy.exercises.map((e) => e.main)).toEqual([false, true, false]);
    const oldIds = new Set([...r.exercises.map((e) => e.id), ...r.exercises.flatMap((e) => e.setTemplates.map((t) => t.id))]);
    expect([...copy.exercises.map((e) => e.id), ...copy.exercises.flatMap((e) => e.setTemplates.map((t) => t.id))].some((x) => oldIds.has(x))).toBe(false);
    expect(copy.exercises.map((e) => e.exerciseId)).toEqual(r.exercises.map((e) => e.exerciseId));
  });
});

describe('rotation membership (RT9, WL-A8)', () => {
  it('Add puts it at the end; Remove takes it out; Delete + Restore keep its place', () => {
    const a = made('Push A', { id: id(1001), inRotation: true, at: at(0) });
    const b = made('Pull A', { id: id(1002), inRotation: true, at: at(10) });
    const c = made('Legs A', { id: id(1003), inRotation: true, at: at(20) });
    const arms = made('Arms', { id: id(1004), at: at(30) });
    expect(rotationRoutines([c, arms, b, a]).map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Legs A']);
    const added = setRoutineRotation(arms, true, 1, 'rot-1', at(40));
    if (added.kind !== 'write') throw new Error(added.kind);
    expect(rotationRoutines([a, b, c, added.next]).map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Legs A', 'Arms']);
    expect(setRoutineRotation(added.next, true, 2, 'rot-2', at(41))).toEqual({ kind: 'invalid', message: 'Already in your rotation.' });
    expect(setRoutineRotation(added.next, false, 1, 'rot-3', at(41)).kind).toBe('stale');
    // Delete leaves the rotation (it's a tombstone); restore puts it back where it was.
    const del = deleteRoutine(a, 1, 'del-1', at(50));
    if (del.kind !== 'write') throw new Error(del.kind);
    expect(rotationRoutines([del.next, b, c]).map((r) => r.name)).toEqual(['Pull A', 'Legs A']);
    const back = restoreRoutine(del.next, 2, 'undo-1', at(51));
    if (back.kind !== 'write') throw new Error(back.kind);
    expect(rotationRoutines([back.next, b, c]).map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Legs A']);
    // Remove, then Undo with its old place.
    const out = setRoutineRotation(b, false, 1, 'rm', at(60));
    if (out.kind !== 'write') throw new Error(out.kind);
    expect(isInRotation(out.next)).toBe(false);
    const undo = setRoutineRotation(out.next, true, 2, 'rm-undo', at(61), b.rotationAtUtc ?? null);
    if (undo.kind !== 'write') throw new Error(undo.kind);
    expect(rotationRoutines([a, undo.next, c]).map((r) => r.name)).toEqual(['Push A', 'Pull A', 'Legs A']);
    // A routine from before the library (no flag) is in the rotation.
    const old: Routine = { ...a };
    delete old.inRotation;
    expect(isInRotation(old)).toBe(true);
    // Up next reads only the rotation.
    const last = { sessionId: 's1', routineId: c.id, startedAtUtc: at(100).utc, tz: at(100).tz };
    expect(nextInRotation(rotationRoutines([a, b, c, arms]), last)).toMatchObject({ kind: 'routine', routine: { name: 'Push A' } });
  });
});

describe('routineFromPlan (save what the overview shows, WL-A11)', () => {
  it('shown order; skipped slots and sets left out; Auto loads except Ben’s Fixed; rest by type and supersets kept', () => {
    let plan = startFixture().state;
    const face = plan.exercises.find((e) => e.exerciseId === FACE);
    if (!face) throw new Error('no face pull');
    plan = apply(plan, { type: 'skip_exercise', at: at(1), opId: 'skip-face', sessionExerciseId: face.id });
    const before = JSON.stringify(plan);
    const benchSet = setsFor(plan, BENCH).find((s) => s.setType !== 'warmup');
    const r = routineFromPlan({ id: id(960), ownerId: OWNER, name: ' Push A · 30 min ', opId: 'save-plan', plan, at: at(2), newId: idGen(96_000), isCompound: compound, fixedSetIds: new Set([benchSet?.id ?? '']) });
    expect(JSON.stringify(plan)).toBe(before);
    if (!r) throw new Error('nothing saved');
    expect(RoutineSchema.parse(r)).toEqual(r);
    expect(r).toMatchObject({ name: 'Push A · 30 min', source: 'ben', inRotation: false, createdFromSessionId: null, version: 1 });
    expect(r.exercises.map((e) => e.exerciseId)).toEqual([BENCH, ROW, HANG]);
    // The superset lost its other member, so it's no group.
    expect(r.exercises.map((e) => e.supersetGroup)).toEqual([null, null, null]);
    const bench = r.exercises[0];
    expect(bench?.setTemplates.map((t) => [t.setType, t.targetLoad?.value ?? null, t.targetReps])).toEqual([
      ['warmup', null, { min: 10, max: 10 }],
      ['working', 100, { min: 6, max: 8 }],
      ['working', null, { min: 6, max: 8 }],
    ]);
    expect(bench?.restBySetType).toMatchObject({ warmup: { seconds: 60 }, working: { seconds: 180 } });
    expect(r.exercises[2]?.setTemplates.every((t) => t.targetReps === null && t.targetDurationS !== null)).toBe(true);
    expect(r.exercises.map((e) => e.main)).toEqual([true, true, false]);
  });

  it('keeps a superset whose members are all kept; Nothing to save when everything is skipped', () => {
    const plan = startFixture().state;
    const r = routineFromPlan({ id: id(961), ownerId: OWNER, name: 'X', opId: 'o', plan, at: at(2), newId: idGen(96_500), isCompound: compound, createdFromSessionId: id(5), inRotation: true });
    expect(r?.exercises.map((e) => e.supersetGroup)).toEqual([null, 'A', 'A', null]);
    expect(r).toMatchObject({ createdFromSessionId: id(5), inRotation: true });
    let all = plan;
    for (const ex of plan.exercises) all = apply(all, { type: 'skip_exercise', at: at(3), opId: `s-${ex.id}`, sessionExerciseId: ex.id });
    expect(routineFromPlan({ id: id(962), ownerId: OWNER, name: 'X', opId: 'o', plan: all, at: at(4), newId: idGen(96_800), isCompound: compound })).toBeNull();
  });
});

describe('routineFromPlan and distance sets (review S1)', () => {
  it('a distance exercise is left out and listed, never saved as a timed set', () => {
    const plan = startFixture().state;
    const hang = plan.exercises.find((e) => e.exerciseId === HANG);
    if (!hang) throw new Error('no hang');
    // The timed hang as a carry: distance and time planned.
    const carry = {
      ...plan,
      exercises: plan.exercises.map((e) => (e.id === hang.id ? { ...e, measurement: 'distance' as const, exerciseName: 'Farmer carry' } : e)),
      sets: plan.sets.map((s) => (s.sessionExerciseId === hang.id ? { ...s, planned: { ...s.planned, distanceM: 40 } } : s)),
    };
    const n = carry.sets.filter((s) => s.sessionExerciseId === hang.id && s.status === 'pending' && s.pairedWithSetId === null).length;
    expect(n).toBe(1);
    const r = routineFromPlan({ id: id(963), ownerId: OWNER, name: 'X', opId: 'o', plan: carry, at: at(2), newId: idGen(96_900), isCompound: compound });
    expect(r?.exercises.map((e) => e.exerciseId)).toEqual([BENCH, ROW, FACE]);
    expect(r?.exercises.flatMap((e) => e.setTemplates).some((t) => t.targetReps === null)).toBe(false);
    expect(notSavedFromPlan(carry)).toEqual([{ kind: 'distance', exerciseName: 'Farmer carry', sets: n }]);
    expect(notCopiedText(notSavedFromPlan(carry))).toBe('Not copied: 1 distance set (Farmer carry)');
    expect(notSavedFromPlan(plan)).toEqual([]);
  });
});

describe('buildLibraryView (§A2.1, WL-A1)', () => {
  const TZ = 'Europe/London';
  const NOW: ZonedTimestamp = { utc: '2026-10-11T08:00:00.000Z', tz: TZ };
  const on = (date: string): ZonedTimestamp => ({ utc: `${date}T17:00:00.000Z`, tz: TZ });
  const lib = (name: string, n: number, o: Partial<Routine> = {}): Routine => ({ ...made(name, { id: id(n), at: on('2026-09-01') }), ...o });
  const pushA = lib('Push A', 1, { inRotation: true, rotationAtUtc: on('2026-09-01').utc });
  const pullA = lib('Pull A', 2, { inRotation: true, rotationAtUtc: on('2026-09-02').utc });
  const legsA = lib('Legs A', 3, { inRotation: true, rotationAtUtc: on('2026-09-03').utc });
  const arms = lib('Arms', 4, { createdAtUtc: on('2026-10-01').utc });
  const coach = lib('Push · 45 min', 5, { source: 'coach', createdAtUtc: on('2026-10-08').utc });
  const routines = [pushA, pullA, legsA, arms, coach];
  const sessions: SessionTypeSession[] = [
    { id: 's-push', routineId: pushA.id, routineName: 'Push A', startedAt: on('2026-10-07'), exerciseCount: 3, imported: false },
    { id: 's-pull', routineId: pullA.id, routineName: 'Pull A', startedAt: on('2026-10-09'), exerciseCount: 3, imported: false },
    { id: 's-legs', routineId: legsA.id, routineName: 'Legs A', startedAt: on('2026-10-05'), exerciseCount: 3, imported: false },
    { id: 's-sh', routineId: null, routineName: 'Shoulders', startedAt: on('2026-10-07'), exerciseCount: 5, imported: false },
    { id: 's-back', routineId: null, routineName: 'Back', startedAt: on('2026-10-08'), exerciseCount: 6, imported: false },
  ];
  const types = deriveSessionTypes({ routines: routines.map((r) => ({ id: r.id, name: r.name, exerciseCount: r.exercises.length })), sessions, now: NOW, groupImportsByCategory: false });
  const inputs: LibraryRoutineInput[] = routines.map((routine) => ({ routine, minutes: routine.id === arms.id ? 40 : 55, gymIssues: routine.id === pullA.id ? 1 : 0 }));

  it('YOUR ROTATION from Up next, ALL WORKOUTS (New, Coach tag), FROM HISTORY longest gap first', () => {
    const v = buildLibraryView({ routines: inputs, types, upNextRoutineId: legsA.id, now: NOW, sort: 'recent', showAllHistory: false });
    expect(v.state).toBe('normal');
    expect(v.rotation.map((r) => [r.name, r.upNext])).toEqual([
      ['Legs A', true],
      ['Push A', false],
      ['Pull A', false],
    ]);
    expect(v.rotation.map((r) => [plain(r.detail), r.issue])).toEqual([
      ['3 exercises · ≈ 55 min · 6 days ago', null],
      ['3 exercises · ≈ 55 min · 4 days ago', null],
      ['3 exercises · ≈ 55 min', '1 not here'],
    ]);
    expect(v.all.map((r) => [r.name, r.sourceTag, plain(r.detail)])).toEqual([
      ['Push · 45 min', 'Coach', 'New · 3 exercises · ≈ 55 min'],
      ['Arms', null, 'New · 3 exercises · ≈ 40 min'],
    ]);
    expect(v.history.map((h) => [h.label, plain(h.detail)])).toEqual([
      ['Shoulders', '5 exercises · 4 days ago'],
      ['Back', '6 exercises · 3 days ago'],
    ]);
    expect(v.rotation[0]?.accessibilityLabel).toBe('Legs A, up next, 3 exercises, about 55 minutes, last done 6 days ago');
    expect(v.all[0]?.accessibilityLabel).toBe('Push · 45 min, made by the coach, 3 exercises, about 55 minutes, not done yet');
    expect(v.rotation[2]?.accessibilityLabel).toContain('1 not here at this gym');
    // A–Z sort applies to ALL WORKOUTS only.
    expect(buildLibraryView({ routines: inputs, types, upNextRoutineId: legsA.id, now: NOW, sort: 'az', showAllHistory: false }).all.map((r) => r.name)).toEqual(['Arms', 'Push · 45 min']);
  });

  it('a history type named like a saved workout is that workout’s (WL5); deleted workouts are hidden', () => {
    const shoulders = lib('Shoulders', 6);
    const withSh = [...routines, shoulders];
    const t = deriveSessionTypes({ routines: withSh.map((r) => ({ id: r.id, name: r.name, exerciseCount: r.exercises.length })), sessions, now: NOW, groupImportsByCategory: false });
    const v = buildLibraryView({ routines: [...inputs, { routine: shoulders, minutes: null, gymIssues: 0 }], types: t, upNextRoutineId: null, now: NOW, sort: 'recent', showAllHistory: false });
    expect(v.history.map((h) => h.label)).toEqual(['Back']);
    expect(plain(v.all.find((r) => r.name === 'Shoulders')?.detail ?? '')).toBe('3 exercises · 4 days ago');
    const gone = buildLibraryView({ routines: [{ routine: { ...arms, deletedAtUtc: NOW.utc }, minutes: null, gymIssues: 0 }], types: [], upNextRoutineId: null, now: NOW, sort: 'recent', showAllHistory: false });
    expect(gone).toMatchObject({ rotation: [], all: [], history: [], state: 'empty' });
  });

  it('no saved workouts: FROM HISTORY only; more than 10 history types show 10 then Show all (N)', () => {
    const many: SessionTypeSession[] = Array.from({ length: 12 }, (_, i) => ({ id: `h-${String(i)}`, routineId: null, routineName: `Day ${String(i)}`, startedAt: on(`2026-10-${String(i + 1).padStart(2, '0')}`), exerciseCount: 4, imported: false }));
    const t = deriveSessionTypes({ routines: [], sessions: many, now: NOW, groupImportsByCategory: false });
    const v = buildLibraryView({ routines: [], types: t, upNextRoutineId: null, now: NOW, sort: 'recent', showAllHistory: false });
    expect(v.state).toBe('history_only');
    expect(v.history).toHaveLength(LIBRARY_HISTORY_CAP);
    expect(v.history[0]?.label).toBe('Day 0');
    expect(v.historyTotal).toBe(12);
    expect(buildLibraryView({ routines: [], types: t, upNextRoutineId: null, now: NOW, sort: 'recent', showAllHistory: true })).toMatchObject({ historyTotal: 0 });
  });
});

describe('library helpers', () => {
  it('gym issues: exercises with no equipment here; bodyweight never; unknown counts', () => {
    const r = { exercises: [routineExercise(1, { exerciseId: BENCH }), routineExercise(2, { exerciseId: ROW }), routineExercise(3, { exerciseId: HANG }), routineExercise(4, { exerciseId: id(4040) })] };
    const info = new Map([
      [BENCH, { defaultLoadConvention: 'total' as const, compatibleEquipment: ['barbell' as const] }],
      [ROW, { defaultLoadConvention: 'stack' as const, compatibleEquipment: ['weight_stack' as const] }],
      [HANG, { defaultLoadConvention: 'bodyweight' as const, compatibleEquipment: ['bodyweight_station' as const] }],
    ]);
    expect(routineGymIssues(r, info, [stack()])).toBe(2);
    expect(routineGymIssues(r, info, [stack(), barbell()])).toBe(1);
  });
  it('unnamed name and save detail', () => {
    expect(plain(unnamedWorkoutName({ utc: '2026-10-11T08:00:00.000Z', tz: 'Europe/London' }))).toBe('Workout · Sun 11 Oct');
    expect(saveSheetDetail(made())).toBe('3 exercises · 6 sets');
  });
});

describe('workout-library review A: what a save keeps (S2, S5, S3, N4)', () => {
  it('S5: only the workout’s own set-type rest and per-set overrides are copied; default rest falls through', () => {
    const plan = startFixture().state;
    const rowEx = plan.exercises.find((e) => e.exerciseId === ROW);
    const benchSets = setsFor(plan, BENCH).filter((s) => s.setType !== 'warmup');
    const second = benchSets[1];
    if (!rowEx || !second) throw new Error('fixture');
    const changed = {
      ...plan,
      sets: plan.sets.map((s) => {
        if (s.id === second.id) return { ...s, rest: { seconds: 240, source: 'set_override' as const, sourceLabel: 'Set override' } };
        if (s.sessionExerciseId === rowEx.id) return { ...s, rest: { seconds: 90, source: 'exercise_default' as const, sourceLabel: 'Cable row default' } };
        return s;
      }),
    };
    const r = routineFromPlan({ id: id(970), ownerId: OWNER, name: 'X', opId: 'o', plan: changed, at: at(2), newId: idGen(97_000), isCompound: compound });
    const bench = r?.exercises.find((e) => e.exerciseId === BENCH);
    const row = r?.exercises.find((e) => e.exerciseId === ROW);
    expect(bench?.restBySetType).toEqual({ warmup: { seconds: 60 }, working: { seconds: 180 } });
    expect(bench?.setTemplates.filter((t) => t.setType !== 'warmup').map((t) => t.restOverrideS)).toEqual([null, 240]);
    expect(row?.restBySetType).toEqual({});
  });

  it('S2, N9: a saved workout’s plan keeps its Fixed pins (unfitted), Main and item; a row swapped today keeps only Main', () => {
    const { input } = startFixture();
    const out = startWorkout(input);
    const plan = out.aggregate;
    if (input.routine === null) throw new Error('fixture');
    const routine: Routine = { ...input.routine, source: 'ben', exercises: input.routine.exercises.map((e) => (e.exerciseId === BENCH ? { ...e, main: false, setTemplates: e.setTemplates.map((t, i) => (i === 2 ? { ...t, targetLoad: null } : t)) } : e.exerciseId === ROW ? { ...e, equipmentId: null } : e)) };
    const slotOf = Object.fromEntries(plan.exercises.map((sx) => [sx.id, routine.exercises.find((e) => e.exerciseId === sx.exerciseId)?.id ?? '']));
    const settings = planSettingsOfRoutine(routine, plan, slotOf, out.setTemplateIds);
    const r = routineFromPlan({ id: id(971), ownerId: OWNER, name: 'Push A · short', opId: 'o', plan, at: at(2), newId: idGen(97_500), isCompound: compound, fromRoutine: settings });
    const bench = r?.exercises.find((e) => e.exerciseId === BENCH);
    expect(bench?.main).toBe(false);
    expect(bench?.setTemplates.map((t) => t.targetLoad?.value ?? null)).toEqual([60, 100, null]);
    expect(r?.exercises.find((e) => e.exerciseId === ROW)?.equipmentId).toBeNull();
    // Without the workout's settings (a next session's plan) every load is Auto and Main is the rule's.
    const plain = routineFromPlan({ id: id(972), ownerId: OWNER, name: 'X', opId: 'o', plan, at: at(2), newId: idGen(97_800), isCompound: compound });
    expect(plain?.exercises[0]?.setTemplates.every((t) => t.targetLoad === null)).toBe(true);
    expect(plain?.exercises[0]?.main).toBe(true);
    // Swapped today: Main stays, the pins and item (the other exercise’s) don't.
    const swapped = { ...plan, exercises: plan.exercises.map((sx) => (sx.exerciseId === BENCH ? { ...sx, exerciseId: ROW } : sx)) };
    const s2 = planSettingsOfRoutine(routine, swapped, slotOf, out.setTemplateIds);
    const benchRow = plan.exercises.find((sx) => sx.exerciseId === BENCH);
    expect(s2.rows.get(benchRow?.id ?? '')).toEqual({ main: false, equipmentId: null });
    expect([...s2.pins.keys()].some((k) => setsFor(plan, BENCH).some((s) => s.id === k))).toBe(false);
    // A workout from before the library has no pins: its loads are last time's actuals.
    expect(planSettingsOfRoutine({ ...routine, source: undefined }, plan, slotOf, out.setTemplateIds).pins.size).toBe(0);
  });

  it('S3: Keep both on a pre-library workout compares Auto with Auto, so no stale actual load becomes a Fixed pin', () => {
    const legacy: Routine = { ...made(), source: undefined, exercises: made().exercises.map((e) => ({ ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetLoad: kg(80) })) })) };
    const base = editableEdit(legacy);
    // Ben edits Row's reps; meanwhile the workout was renamed (still pre-library).
    const mine = { ...base, exercises: base.exercises.map((e) => (e.exerciseId === ROW ? { ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetReps: { min: 10, max: 12 } })) } : e)) };
    const newer: Routine = { ...legacy, name: 'Push X', version: 2 };
    const merged = mergeRoutineEdits(base, mine, editableEdit(newer));
    expect(merged.conflicts).toEqual([]);
    expect(merged.merged.name).toBe('Push X');
    expect(merged.merged.exercises.flatMap((e) => e.setTemplates).every((t) => t.targetLoad === null)).toBe(true);
    expect(merged.merged.exercises.find((e) => e.exerciseId === ROW)?.setTemplates[0]?.targetReps).toEqual({ min: 10, max: 12 });
  });

  it('N4: the first save of a pre-library workout lists only what Ben changed', () => {
    const legacy: Routine = { ...made(), source: undefined, exercises: made().exercises.map((e) => ({ ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetLoad: kg(80) })) })) };
    const after = { name: 'Push B', exercises: editableExercises(legacy) };
    expect(routineChangeLines(editableEdit(legacy), after, () => 'X').map((l) => l.text)).toEqual(['Renamed to Push B']);
  });
});

describe('structureChangedAtUtc (review r2 S1, WL7): only a change to a slot’s structure counts', () => {
  const r = made('Push A', { inRotation: true });
  const write = (c: ReturnType<typeof editRoutine>): Routine => {
    if (c.kind !== 'write') throw new Error(c.kind);
    return c.next;
  };
  const times = (x: Routine) => x.exercises.map((e) => e.structureChangedAtUtc ?? null);

  it('a new workout has none; a rename, Main toggle, rest or order change sets none', () => {
    expect(times(r)).toEqual([null, null, null]);
    const list = editableExercises(r);
    const renamed = write(editRoutine(r, { name: 'Push B', exercises: list.map((e, i) => (i === 2 ? { ...e, main: true, restBySetType: { working: { seconds: 75 } } } : e)) }, 1, 's1-a', at(100), compound));
    expect(times(renamed)).toEqual([null, null, null]);
    const moved = write(editRoutine(renamed, { name: 'Push B', exercises: [list[1], list[0], list[2]].filter((x): x is RoutineExercise => x !== undefined) }, 2, 's1-b', at(110), compound));
    expect(times(moved)).toEqual([null, null, null]);
    expect(RoutineSchema.parse(moved)).toEqual(moved);
  });

  it('a rep change marks that slot only, at the save’s time; a later unrelated save keeps it', () => {
    const list = editableExercises(r);
    const reps = list.map((e, i) => (i === 1 ? { ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetReps: { min: 10, max: 12 } })) } : e));
    const a = write(editRoutine(r, { name: r.name, exercises: reps }, 1, 's1-c', at(200), compound));
    expect(times(a)).toEqual([null, at(200).utc, null]);
    const b = write(editRoutine(a, { name: 'Renamed', exercises: editableExercises(a) }, 2, 's1-d', at(300), compound));
    expect(times(b)).toEqual([null, at(200).utc, null]);
    expect(RoutineSchema.parse(b)).toEqual(b);
  });

  it('a set added, a set type changed, a Fixed pin or a new exercise counts', () => {
    const [a, b, c] = editableExercises(r);
    if (a === undefined || b === undefined || c === undefined) throw new Error('fixture');
    const changed = [
      { ...a, setTemplates: [...a.setTemplates, template(104)] },
      { ...b, setTemplates: b.setTemplates.map((t, i) => (i === 0 ? { ...t, setType: 'top' as const } : t)) },
      { ...c, setTemplates: c.setTemplates.map((t) => ({ ...t, targetLoad: kg(20) })) },
      routineExercise(13, { exerciseId: HANG, order: 3 }),
    ];
    expect(times(write(editRoutine(r, { name: r.name, exercises: changed }, 1, 's1-e', at(400), compound)))).toEqual(Array(4).fill(at(400).utc));
  });

  it('compares loads and reps field by field: another key order is not a change, another unit or convention is (review N12)', () => {
    const [a, b, c] = editableExercises(r);
    if (a === undefined || b === undefined || c === undefined) throw new Error('fixture');
    const pinned = write(editRoutine(r, { name: r.name, exercises: [a, b, { ...c, setTemplates: c.setTemplates.map((t) => ({ ...t, targetLoad: kg(20), targetReps: { min: 8, max: 10 } })) }] }, 1, 'n12-a', at(800), compound));
    expect(times(pinned)).toEqual([null, null, at(800).utc]);
    const reordered = editableExercises(pinned).map((e) => ({
      ...e,
      setTemplates: e.setTemplates.map((t) => ({
        ...t,
        targetLoad: t.targetLoad === null ? null : { convention: t.targetLoad.convention, unit: t.targetLoad.unit, value: t.targetLoad.value },
        targetReps: t.targetReps === null ? null : { max: t.targetReps.max, min: t.targetReps.min },
      })),
    }));
    expect(times(write(editRoutine(pinned, { name: r.name, exercises: reordered }, 2, 'n12-b', at(900), compound)))).toEqual([null, null, at(800).utc]);
    const inLb = editableExercises(pinned).map((e, i) => (i === 2 ? { ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetLoad: t.targetLoad === null ? null : { ...t.targetLoad, unit: 'lb' as const } })) } : e));
    expect(times(write(editRoutine(pinned, { name: r.name, exercises: inLb }, 2, 'n12-c', at(950), compound)))).toEqual([null, null, at(950).utc]);
    const perHand = editableExercises(pinned).map((e, i) => (i === 2 ? { ...e, setTemplates: e.setTemplates.map((t) => ({ ...t, targetLoad: t.targetLoad === null ? null : { ...t.targetLoad, convention: 'per_hand' as const } })) } : e));
    expect(times(write(editRoutine(pinned, { name: r.name, exercises: perHand }, 2, 'n12-d', at(960), compound)))).toEqual([null, null, at(960).utc]);
  });

  it('rotation toggles, renames and delete/restore never touch it; Duplicate starts without one', () => {
    const a = write(editRoutine(r, { name: r.name, exercises: editableExercises(r).map((e, i) => (i === 0 ? { ...e, setTemplates: e.setTemplates.slice(0, 2) } : e)) }, 1, 's1-f', at(500), compound));
    const off = setRoutineRotation(a, false, 2, 's1-g', at(600));
    expect(off.kind === 'write' && times(off.next)).toEqual([at(500).utc, null, null]);
    const copy = duplicateRoutine(a, { id: id(951), opId: 'dup-s1', at: at(700), newId: idGen(96_000), isCompound: compound });
    expect(times(copy)).toEqual([null, null, null]);
  });
});

describe('withSaveEdit (routines.md §A2.5, WL-A18)', () => {
  it('the unsaved copy takes the editor’s name and sets; ID, opId, version, rotation and links stay; it becomes Ben’s', () => {
    const copy: Routine = { ...made('Workout · Mon 5 Oct', { inRotation: true, opId: 'sheet-op' }), source: 'coach', createdFromSessionId: id(950), createdFromDraft: { draftId: id(951), version: 2 } };
    const more = exs().map((e, i) => (i === 1 ? { ...e, setTemplates: [...e.setTemplates, template(113), template(114)] } : e));
    const r = withSaveEdit(copy, { name: '  Push A ', exercises: more }, compound);
    if (r.kind !== 'write') throw new Error(r.message);
    expect(r.next).toMatchObject({ id: copy.id, version: 1, lastOpId: 'sheet-op', inRotation: true, createdFromSessionId: id(950), createdFromDraft: { draftId: id(951), version: 2 }, name: 'Push A', source: 'ben' });
    expect(r.next.exercises.map((e) => e.setTemplates.length)).toEqual([3, 4, 1]);
    expect(r.next.exercises.map((e) => e.main)).toEqual([true, true, false]);
    expect(RoutineSchema.parse(r.next)).toEqual(r.next);
  });

  it('refuses an edit that can’t be saved', () => {
    expect(withSaveEdit(made(), { name: 'X', exercises: [] }, compound)).toEqual({ kind: 'invalid', message: 'Add an exercise' });
  });
});

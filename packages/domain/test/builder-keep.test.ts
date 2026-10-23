import { describe, expect, it } from 'vitest';
import { RoutineExerciseSchema, WorkoutDraftSchema, type BuilderSetup, type DraftPlan, type RoutineExercise, type SetTemplate } from '@fizz/schemas';
import { benRemovalOf, deriveId, keepDiff, keepNextTimeMark, keptExercises, markBenEdit, newBuilderDraft, withBenAdded, withTemplateMarks, withWorkingSets, type BuilderKeepMarks, type BuilderSlot, type BuilderWorkout, type DraftLifeChange, type KeepBaseItem, type KeepCurrentItem } from '../src/index';
import { id } from './fixtures';

/**
 * Summary's `Keep for next time?` (Ben, 23 Oct, D1): only Ben's own structure edits count (swap, add, remove, set
 * count), read through his marks; Today's card, Time, a gym change and the coach never do (review batch23 B1–B3).
 * Apply writes exactly those changes to the plan day or saved workout and leaves everything else as stored.
 */

const at = (min: number) => ({ utc: `2026-10-23T18:${String(min).padStart(2, '0')}:00.000Z`, tz: 'Europe/London' });

const set = (exercise: number, k: number, setType: SetTemplate['setType'], load: number | null = null): SetTemplate => ({
  id: id(5000 + exercise * 20 + k),
  setType,
  targetLoad: load === null ? null : { value: load, unit: 'kg', convention: 'total' },
  targetReps: { min: 8, max: 10 },
  targetDurationS: null,
  targetRpe: 8,
  targetRir: null,
  restOverrideS: null,
});

const ex = (n: number, order: number, types: SetTemplate['setType'][], over: Partial<RoutineExercise> = {}): RoutineExercise => ({
  id: id(400 + n),
  exerciseId: id(n),
  equipmentId: null,
  order,
  supersetGroup: null,
  setTemplates: types.map((t, k) => set(n, k, t, t === 'warmup' ? 40 : 60)),
  restBySetType: { working: { seconds: 90 } },
  transitionRestS: null,
  progressionRuleId: null,
  ...over,
});

// Bench (main, warm-up + 3), Cable fly 3, Triceps pushdown 3.
const before = [ex(1, 0, ['warmup', 'working', 'working', 'working'], { main: true }), ex(2, 1, ['working', 'working', 'working']), ex(3, 2, ['working', 'working', 'working'])];
const base: KeepBaseItem[] = before.map((e) => ({ exerciseId: e.exerciseId, workingSets: e.setTemplates.filter((t) => t.setType !== 'warmup').length, ref: e.id }));
const cur = (n: number, sets: number, origin: number | null, round: number, ben: BuilderKeepMarks | null = null): KeepCurrentItem => ({ key: `slot-${String(n)}`, exerciseId: id(n), workingSets: sets, origin: origin === null ? null : id(origin), round, ben });
const entryFor = (item: KeepCurrentItem): RoutineExercise => ({
  id: deriveId(item.key),
  exerciseId: item.exerciseId,
  equipmentId: null,
  order: 0,
  supersetGroup: null,
  setTemplates: Array.from({ length: item.workingSets }, (_, k) => ({ ...set(99, k, 'working'), id: deriveId(`${item.key}:${String(k)}`), targetLoad: null })),
  restBySetType: {},
  transitionRestS: null,
  progressionRuleId: null,
});
const keep = (current: KeepCurrentItem[], removed: string[] = []) => {
  const diff = keepDiff(base, current, removed);
  return { diff, out: keptExercises({ before, base, current, diff, entryFor, opId: 'keep-1', atUtc: at(0).utc }) };
};

describe('keepDiff: only Ben’s own structure edits', () => {
  it('the workout as it opened (loads and reps aside) has nothing to keep', () => {
    expect(keepDiff(base, [cur(1, 3, 1, 0), cur(2, 3, 2, 1), cur(3, 3, 3, 2)]).changes).toEqual([]);
  });

  it('reads Ben’s swap through its origin, his adds, his removal and his set counts (the stored count plus his change)', () => {
    const d = keepDiff(base, [cur(1, 3, 1, 0), cur(5, 3, 2, 1, { from: id(2) }), cur(6, 3, null, 2, { added: true }), cur(1 + 6, 4, null, 3, { added: true })], [id(3)]);
    expect(d.changes).toEqual([
      { kind: 'swap', from: id(2), to: id(5) },
      { kind: 'add', exerciseId: id(6) },
      { kind: 'add', exerciseId: id(7) },
      { kind: 'delete', exerciseId: id(3) },
    ]);
    const counts = keepDiff(base, [cur(1, 3, 1, 0), cur(2, 2, 2, 1, { setsFrom: 3 }), cur(3, 4, 3, 2, { setsFrom: 3 })]);
    expect(counts.changes).toEqual([
      { kind: 'sets', exerciseId: id(2), from: 3, to: 2 },
      { kind: 'sets', exerciseId: id(3), from: 3, to: 4 },
    ]);
  });

  it('what the app changed is never listed: Today’s picks and its main lift’s top set + back-offs, Time’s drops, a gym’s or the coach’s swap and removal', () => {
    // Today drafted Bench as a top set + 3 back-offs (4), left out Triceps pushdown (Time) and added its own Incline
    // press; a gym (or the coach) swapped Cable fly for Dumbbell fly. Ben touched no structure.
    expect(keepDiff(base, [cur(1, 4, 1, 0), cur(5, 3, 2, 1), cur(8, 3, null, 2)]).changes).toEqual([]);
  });

  it('a set count is like with like: Today’s main lift 4 → 5 is one more than the plan day’s 3; a set Time cut that Ben adds back is no change', () => {
    expect(keepDiff(base, [cur(1, 5, 1, 0, { setsFrom: 4 }), cur(2, 3, 2, 1), cur(3, 3, 3, 2)]).changes).toEqual([{ kind: 'sets', exerciseId: id(1), from: 3, to: 4 }]);
    // Cable fly opened at 2 (Time cut 1, put back as `setsFrom: 3`); Ben added one: 3 again.
    expect(keepDiff(base, [cur(1, 4, 1, 0), cur(2, 3, 2, 1, { setsFrom: 3 }), cur(3, 3, 3, 2)]).changes).toEqual([]);
  });

  it('a swap is Ben’s only from the exercise it opened with; swapped back it is nothing; after the gym’s swap it is not offered', () => {
    expect(keepDiff(base, [cur(1, 3, 1, 0), cur(2, 3, 2, 1, { from: id(2) }), cur(3, 3, 3, 2)]).changes).toEqual([]);
    // The gym had swapped Cable fly for 8; Ben then swapped 8 for 5: not a plan-day change.
    expect(keepDiff(base, [cur(1, 3, 1, 0), cur(5, 3, 2, 1, { from: id(8) }), cur(3, 3, 3, 2)]).changes).toEqual([]);
  });

  it('an exercise Ben adds that the plan day already has (Time left it out, he put it back) is not an add', () => {
    expect(keepDiff(base, [cur(1, 3, 1, 0), cur(2, 3, 2, 1), cur(3, 3, null, 2, { added: true })]).changes).toEqual([]);
  });

  it('removed only lists an exercise nothing in the workout still is', () => {
    expect(keepDiff(base, [cur(1, 3, 1, 0), cur(2, 3, 2, 1), cur(3, 3, null, 2, { added: true })], [id(3)]).changes).toEqual([]);
  });

  it('the plan day’s main lift is never swapped or removed by Keep (SP7); its set count still is', () => {
    const locked = base.map((b, k) => (k === 0 ? { ...b, locked: true } : b));
    expect(keepDiff(locked, [cur(9, 4, 1, 0, { from: id(1), setsFrom: 3 }), cur(2, 3, 2, 1), cur(3, 3, 3, 2)]).changes).toEqual([{ kind: 'sets', exerciseId: id(1), from: 3, to: 4 }]);
    expect(keepDiff(locked, [cur(2, 3, 2, 1), cur(3, 3, 3, 2)], [id(1)]).changes).toEqual([]);
  });

  it('order alone is not structure: no change', () => {
    expect(keepDiff(base, [cur(3, 3, 3, 0), cur(1, 3, 1, 1), cur(2, 3, 2, 2)]).changes).toEqual([]);
  });
});

describe('keptExercises: exactly the changes, nothing else', () => {
  it('a swap takes the old one’s place and superset; its sets are the stored count with automatic loads; its Main is the rule’s, not copied', () => {
    const { out } = keep([cur(1, 3, 1, 0), cur(5, 4, 2, 1, { from: id(2) }), cur(3, 3, 3, 2)]);
    const mainSwap = keptExercises({ before, base, current: [cur(9, 3, 1, 0, { from: id(1) }), cur(2, 3, 2, 1), cur(3, 3, 3, 2)], diff: keepDiff(base, [cur(9, 3, 1, 0, { from: id(1) }), cur(2, 3, 2, 1), cur(3, 3, 3, 2)]), entryFor: (x) => ({ ...entryFor(x), main: true }), opId: 'keep-m', atUtc: at(0).utc });
    expect(mainSwap[0]?.exerciseId).toBe(id(9));
    expect(mainSwap[0]?.main).toBeUndefined();
    expect(out.map((e) => e.exerciseId)).toEqual([id(1), id(5), id(3)]);
    expect(out[1]?.setTemplates.filter((t) => t.setType !== 'warmup')).toHaveLength(3);
    expect(out[1]?.setTemplates.every((t) => t.targetLoad === null)).toBe(true);
    expect(out[1]?.structureChangedAtUtc).toBe(at(0).utc);
    // The others are as stored: loads, reps, rests and their IDs.
    expect(out[0]).toEqual(before[0]);
    expect(out[2]).toEqual(before[2]);
    out.forEach((e) => RoutineExerciseSchema.parse(e));
  });

  it('a set count changes in place (warm-ups and loads kept); a removal leaves; order is renumbered', () => {
    const { out } = keep([cur(1, 4, 1, 0, { setsFrom: 3 }), cur(3, 2, 3, 1, { setsFrom: 3 })], [id(2)]);
    expect(out.map((e) => e.exerciseId)).toEqual([id(1), id(3)]);
    expect(out.map((e) => e.order)).toEqual([0, 1]);
    const bench = out[0];
    expect(bench?.setTemplates.map((t) => t.setType)).toEqual(['warmup', 'working', 'working', 'working', 'working']);
    expect(bench?.setTemplates.every((t) => t.targetLoad !== null)).toBe(true);
    expect(new Set(bench?.setTemplates.map((t) => t.id)).size).toBe(5);
    expect(out[1]?.setTemplates.filter((t) => t.setType === 'working')).toHaveLength(2);
  });

  it('what isn’t Ben’s stays as stored: an exercise Today or Time left out, a gym’s swap, Today’s main-lift count', () => {
    const { out } = keep([cur(1, 4, 1, 0), cur(5, 3, 2, 1), cur(8, 3, null, 2)]);
    expect(out).toEqual(before);
  });

  it('an add goes after the exercise before it in Ben’s order; first in his order goes first', () => {
    const after = keep([cur(1, 3, 1, 0), cur(6, 2, null, 1, { added: true }), cur(2, 3, 2, 2), cur(3, 3, 3, 3)]).out;
    expect(after.map((e) => e.exerciseId)).toEqual([id(1), id(6), id(2), id(3)]);
    expect(after[1]?.supersetGroup).toBeNull();
    const first = keep([cur(6, 2, null, 0, { added: true }), cur(1, 3, 1, 1), cur(2, 3, 2, 2), cur(3, 3, 3, 3)]).out;
    expect(first.map((e) => e.exerciseId)).toEqual([id(6), id(1), id(2), id(3)]);
  });

  it('an add Ben paired joins its partner’s superset (a new letter when it had none), next to it', () => {
    const { out } = keep([cur(1, 3, 1, 0), cur(2, 3, 2, 1), cur(3, 3, 3, 2), cur(6, 3, null, 2, { added: true })]);
    expect(out.map((e) => e.exerciseId)).toEqual([id(1), id(2), id(3), id(6)]);
    expect(out[2]?.supersetGroup).toBe('A');
    expect(out[3]?.supersetGroup).toBe('A');
    // A partner already in a superset: the add joins that one, after its last member.
    const paired = [before[0], { ...before[1], supersetGroup: 'B' }, { ...before[2], supersetGroup: 'B' }].filter((e): e is RoutineExercise => e !== undefined);
    const current = [cur(1, 3, 1, 0), cur(2, 3, 2, 1), cur(6, 3, null, 1, { added: true }), cur(3, 3, 3, 1)];
    const diff = keepDiff(base, current);
    const out2 = keptExercises({ before: paired, base, current, diff, entryFor, opId: 'keep-2', atUtc: at(0).utc });
    expect(out2.map((e) => [e.exerciseId, e.supersetGroup])).toEqual([
      [id(1), null],
      [id(2), 'B'],
      [id(3), 'B'],
      [id(6), 'B'],
    ]);
  });

  it('an exercise the workout couldn’t open stays as stored; the same op ID gives the same IDs', () => {
    const notOpened = [...before, ex(9, 3, ['working'])];
    const current = [cur(1, 3, 1, 0), cur(5, 3, 2, 1, { from: id(2) }), cur(3, 3, 3, 2)];
    const diff = keepDiff(base, current);
    const a = keptExercises({ before: notOpened, base, current, diff, entryFor, opId: 'keep-3', atUtc: at(0).utc });
    const b = keptExercises({ before: notOpened, base, current, diff, entryFor, opId: 'keep-3', atUtc: at(0).utc });
    expect(a.map((e) => e.exerciseId)).toEqual([id(1), id(5), id(3), id(9)]);
    expect(a).toEqual(b);
  });
});

/** A bare builder slot for the mark tests (rows: `n` working sets). */
const slot = (key: string, exerciseId: string, n: number, over: Partial<BuilderSlot> = {}): BuilderSlot => ({
  key,
  exerciseId,
  main: false,
  repRange: { min: 8, max: 10 },
  rows: Array.from({ length: n }, () => ({ type: 'working' as const, reps: 8, load: 50, rpe: 8 })),
  unit: 'kg',
  convention: 'total',
  source: 'rule',
  startLight: null,
  anchorE1rm: null,
  ...over,
});
const wo = (...slots: BuilderSlot[]): BuilderWorkout => ({ blocks: slots.map((s) => ({ slots: [s], auto: false })), restLevel: 'normal' });

describe('markBenEdit: Ben’s marks after his own edit', () => {
  const a = slot('a', id(1), 3, { origin: id(1) });
  const b = slot('b', id(2), 3, { origin: id(2), todayCut: 1 });

  it('a swap records what it was before his first swap; a second swap keeps it; an add is his; a set count keeps the count before his first change', () => {
    const swapped = markBenEdit(wo(a, b), wo(slot('a', id(5), 3, { origin: id(1) }), b), () => 99).workout;
    expect(swapped.blocks[0]?.slots[0]?.keep).toEqual({ from: id(1) });
    const twice = markBenEdit(swapped, wo(slot('a', id(6), 3, { origin: id(1) }), b), () => 99).workout;
    expect(twice.blocks[0]?.slots[0]?.keep).toEqual({ from: id(1) });
    const added = markBenEdit(wo(a), wo(a, slot('c', id(7), 3)), () => 99).workout;
    expect(added.blocks[1]?.slots[0]?.keep).toEqual({ added: true });
    // The count before his first change comes from the caller (Time's cuts put back).
    const more = markBenEdit(wo(a, b), wo(a, slot('b', id(2), 3 + 1, { origin: id(2), todayCut: 1 })), (s) => s.rows.length + (s.todayCut ?? 0)).workout;
    expect(more.blocks[1]?.slots[0]?.keep).toEqual({ setsFrom: 4 });
    const again = markBenEdit(more, wo(a, slot('b', id(2), 5, { origin: id(2), keep: { setsFrom: 4 } })), () => 99).workout;
    expect(again.blocks[1]?.slots[0]?.keep).toEqual({ setsFrom: 4 });
  });

  it('a load, reps or order edit leaves no mark; a removal names the exercise it opened as, never one he added', () => {
    expect(markBenEdit(wo(a, b), wo(b, { ...a, rows: a.rows.map((r) => ({ ...r, load: 60 })) }), () => 99)).toEqual({ workout: wo(b, { ...a, rows: a.rows.map((r) => ({ ...r, load: 60 })) }), removed: [] });
    expect(markBenEdit(wo(slot('a', id(5), 3, { origin: id(1), keep: { from: id(1) } }), b), wo(b), () => 99).removed).toEqual([id(1)]);
    expect(markBenEdit(wo(a, slot('c', id(7), 3, { keep: { added: true } })), wo(a), () => 99).removed).toEqual([]);
    expect(benRemovalOf({ exerciseId: id(8) })).toBe(id(8));
  });

  it('Set up’s added exercises are his adds', () => {
    expect(withBenAdded(wo(a, slot('c', id(7), 3)), new Set(['c'])).blocks[1]?.slots[0]?.keep).toEqual({ added: true });
  });
});

describe('withTemplateMarks: Today’s card for Keep', () => {
  it('the plan day’s exercises carry their origin; Time’s cut is recorded per slot, never a set it added', () => {
    const w = wo(slot('a', id(1), 4), slot('b', id(2), 2), slot('c', id(9), 4));
    const out = withTemplateMarks(w, [id(1), id(2)], [
      { kind: 'sets', slotKey: 'b', exerciseId: id(2), from: 3, to: 2 },
      { kind: 'sets', slotKey: 'c', exerciseId: id(9), from: 3, to: 4 },
    ]);
    expect(out.blocks.map((x) => [x.slots[0]?.origin ?? null, x.slots[0]?.todayCut ?? null])).toEqual([
      [id(1), null],
      [id(2), 1],
      [null, null],
    ]);
  });
});

describe('withWorkingSets', () => {
  it('a back-off’s copy is a back-off, before trailing drops; fewer never takes the top set', () => {
    const e = ex(1, 0, ['warmup', 'top', 'backoff', 'drop']);
    const more = withWorkingSets(e, 4, 'seed');
    expect(more.setTemplates.map((t) => t.setType)).toEqual(['warmup', 'top', 'backoff', 'backoff', 'drop']);
    expect(more.setTemplates[3]?.targetLoad).toEqual(e.setTemplates[2]?.targetLoad);
    const fewer = withWorkingSets(e, 1, 'seed');
    expect(fewer.setTemplates.map((t) => t.setType)).toEqual(['warmup', 'top']);
  });

  it('a top set’s copy is a back-off with no load of its own (N1, D4: worked out below the top, never the top’s)', () => {
    const more = withWorkingSets(ex(1, 0, ['warmup', 'top']), 2, 'seed');
    expect(more.setTemplates.map((t) => [t.setType, t.targetLoad])).toEqual([
      ['warmup', { value: 40, unit: 'kg', convention: 'total' }],
      ['top', { value: 60, unit: 'kg', convention: 'total' }],
      ['backoff', null],
    ]);
  });
});

describe('keepNextTimeMark: one answer per workout, on the started draft', () => {
  const setup: BuilderSetup = { dayId: 'chest', minutes: 60, mainLiftExerciseId: id(1), supersets: true, groups: [{ parts: ['Chest'], count: 3 }], variationId: null };
  const plan: DraftPlan = { slots: [{ slotKey: id(100), exerciseId: id(1), catalogueId: 'ex-1', order: 0, main: true, supersetGroup: null, setTemplates: [{ setType: 'working', reps: { min: 8, max: 8 }, durationS: null, targetRpe: 8, restS: 120 }], rev: 1 }] };
  const open = newBuilderDraft({ id: id(900), ownerId: id(1000), opId: 'op-1', actionId: id(901), name: 'Chest · Bench', key: { planId: null, dayIndex: null, splitDayId: 'chest', mainLiftExerciseId: id(1), localDate: '2026-10-23' }, setup, plan, focus: 'chest', gymId: null, equipmentVersion: 'eq', contextHash: 'ctx', at: at(0) });
  const started = WorkoutDraftSchema.parse({ ...open, status: 'started', sessionId: id(700), startedAtUtc: at(1).utc, version: 2 });
  const undo = { kind: 'template' as const, routineId: id(800), version: 3, restore: before, label: 'Chest · Bench' };
  const written = (c: DraftLifeChange) => {
    if (c.kind !== 'write') throw new Error(c.kind);
    return WorkoutDraftSchema.parse(c.next);
  };

  it('Apply records the inverse; a retry is a duplicate; a second answer or Skip after it is stale; Undo once', () => {
    const kept = written(keepNextTimeMark(started, { sessionId: id(700), opId: 'keep', at: at(2), mark: { kind: 'kept', undo } }));
    expect(kept.keepNextTime).toMatchObject({ choice: 'kept', opId: 'keep', undo: { routineId: id(800), version: 3 } });
    expect(kept.version).toBe(3);
    expect(keepNextTimeMark(kept, { sessionId: id(700), opId: 'keep', at: at(3), mark: { kind: 'kept', undo } }).kind).toBe('duplicate');
    expect(keepNextTimeMark(kept, { sessionId: id(700), opId: 'skip', at: at(3), mark: { kind: 'skipped' } }).kind).toBe('stale');
    const undone = written(keepNextTimeMark(kept, { sessionId: id(700), opId: 'undo', at: at(4), mark: { kind: 'undone' } }));
    expect(undone.keepNextTime?.undoneOpId).toBe('undo');
    expect(keepNextTimeMark(undone, { sessionId: id(700), opId: 'undo-2', at: at(5), mark: { kind: 'undone' } }).kind).toBe('stale');
  });

  it('Skip is an answer too; an open draft or another workout is refused', () => {
    const skipped = written(keepNextTimeMark(started, { sessionId: id(700), opId: 'skip', at: at(2), mark: { kind: 'skipped' } }));
    expect(skipped.keepNextTime).toEqual({ choice: 'skipped', opId: 'skip', atUtc: at(2).utc });
    expect(keepNextTimeMark(skipped, { sessionId: id(700), opId: 'undo', at: at(3), mark: { kind: 'undone' } }).kind).toBe('stale');
    expect(keepNextTimeMark(open, { sessionId: id(700), opId: 'k', at: at(2), mark: { kind: 'skipped' } }).kind).toBe('invalid');
    expect(keepNextTimeMark(started, { sessionId: id(701), opId: 'k', at: at(2), mark: { kind: 'skipped' } }).kind).toBe('invalid');
    // The schema refuses an answer on a draft that isn't started.
    expect(WorkoutDraftSchema.safeParse({ ...open, keepNextTime: { choice: 'skipped', opId: 'x', atUtc: at(2).utc } }).success).toBe(false);
  });
});

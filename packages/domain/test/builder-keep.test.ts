import { describe, expect, it } from 'vitest';
import { RoutineExerciseSchema, WorkoutDraftSchema, type BuilderSetup, type DraftPlan, type RoutineExercise, type SetTemplate } from '@fizz/schemas';
import { deriveId, keepDiff, keepNextTimeMark, keptExercises, newBuilderDraft, withWorkingSets, type DraftLifeChange, type KeepBaseItem, type KeepCurrentItem } from '../src/index';
import { id } from './fixtures';

/**
 * Summary's `Keep for next time?` (Ben, 23 Oct, D1): only structure counts (swap, add, remove, set count); Apply
 * writes exactly those changes to the plan day or saved workout and leaves everything else as stored.
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
const cur = (n: number, sets: number, origin: number | null, round: number): KeepCurrentItem => ({ key: `slot-${String(n)}`, exerciseId: id(n), workingSets: sets, origin: origin === null ? null : id(origin), round });
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
const keep = (current: KeepCurrentItem[]) => {
  const diff = keepDiff(base, current);
  return { diff, out: keptExercises({ before, base, current, diff, entryFor, opId: 'keep-1', atUtc: at(0).utc }) };
};

describe('keepDiff: only structure', () => {
  it('the workout as it opened (loads and reps aside) has nothing to keep', () => {
    expect(keepDiff(base, [cur(1, 3, 1, 0), cur(2, 3, 2, 1), cur(3, 3, 3, 2)]).changes).toEqual([]);
  });

  it('reads a swap through its origin, an add, a removal and a set count', () => {
    const d = keepDiff(base, [cur(1, 3, 1, 0), cur(5, 3, 2, 1), cur(6, 3, null, 2), cur(1 + 6, 4, null, 3)]);
    expect(d.changes).toEqual([
      { kind: 'swap', from: id(2), to: id(5) },
      { kind: 'add', exerciseId: id(6) },
      { kind: 'add', exerciseId: id(7) },
      { kind: 'delete', exerciseId: id(3) },
    ]);
    const counts = keepDiff(base, [cur(1, 3, 1, 0), cur(2, 2, 2, 1), cur(3, 4, 3, 2)]);
    expect(counts.changes).toEqual([
      { kind: 'sets', exerciseId: id(2), from: 3, to: 2 },
      { kind: 'sets', exerciseId: id(3), from: 3, to: 4 },
    ]);
  });

  it('an exercise with no origin that the workout already had is the same one, not an add', () => {
    expect(keepDiff(base, [cur(1, 3, null, 0), cur(2, 3, null, 1), cur(3, 3, null, 2)]).changes).toEqual([]);
  });

  it('order alone is not structure: no change', () => {
    expect(keepDiff(base, [cur(3, 3, 3, 0), cur(1, 3, 1, 1), cur(2, 3, 2, 2)]).changes).toEqual([]);
  });
});

describe('keptExercises: exactly the changes, nothing else', () => {
  it('a swap takes the old one’s place, superset and main flag; its sets are the workout’s with automatic loads', () => {
    const { out } = keep([cur(1, 3, 1, 0), cur(5, 3, 2, 1), cur(3, 3, 3, 2)]);
    expect(out.map((e) => e.exerciseId)).toEqual([id(1), id(5), id(3)]);
    expect(out[1]?.setTemplates.every((t) => t.targetLoad === null)).toBe(true);
    expect(out[1]?.structureChangedAtUtc).toBe(at(0).utc);
    // The others are as stored: loads, reps, rests and their IDs.
    expect(out[0]).toEqual(before[0]);
    expect(out[2]).toEqual(before[2]);
    out.forEach((e) => RoutineExerciseSchema.parse(e));
  });

  it('a set count changes in place (warm-ups and loads kept); a removal leaves; order is renumbered', () => {
    const { out } = keep([cur(1, 4, 1, 0), cur(3, 2, 3, 1)]);
    expect(out.map((e) => e.exerciseId)).toEqual([id(1), id(3)]);
    expect(out.map((e) => e.order)).toEqual([0, 1]);
    const bench = out[0];
    expect(bench?.setTemplates.map((t) => t.setType)).toEqual(['warmup', 'working', 'working', 'working', 'working']);
    expect(bench?.setTemplates.every((t) => t.targetLoad !== null)).toBe(true);
    expect(new Set(bench?.setTemplates.map((t) => t.id)).size).toBe(5);
    expect(out[1]?.setTemplates.filter((t) => t.setType === 'working')).toHaveLength(2);
  });

  it('an add goes after the exercise before it in Ben’s order; first in his order goes first', () => {
    const after = keep([cur(1, 3, 1, 0), cur(6, 2, null, 1), cur(2, 3, 2, 2), cur(3, 3, 3, 3)]).out;
    expect(after.map((e) => e.exerciseId)).toEqual([id(1), id(6), id(2), id(3)]);
    expect(after[1]?.supersetGroup).toBeNull();
    const first = keep([cur(6, 2, null, 0), cur(1, 3, 1, 1), cur(2, 3, 2, 2), cur(3, 3, 3, 3)]).out;
    expect(first.map((e) => e.exerciseId)).toEqual([id(6), id(1), id(2), id(3)]);
  });

  it('an add Ben paired joins its partner’s superset (a new letter when it had none), next to it', () => {
    const { out } = keep([cur(1, 3, 1, 0), cur(2, 3, 2, 1), cur(3, 3, 3, 2), cur(6, 3, null, 2)]);
    expect(out.map((e) => e.exerciseId)).toEqual([id(1), id(2), id(3), id(6)]);
    expect(out[2]?.supersetGroup).toBe('A');
    expect(out[3]?.supersetGroup).toBe('A');
    // A partner already in a superset: the add joins that one, after its last member.
    const paired = [before[0], { ...before[1], supersetGroup: 'B' }, { ...before[2], supersetGroup: 'B' }].filter((e): e is RoutineExercise => e !== undefined);
    const current = [cur(1, 3, 1, 0), cur(2, 3, 2, 1), cur(6, 3, null, 1), cur(3, 3, 3, 1)];
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
    const current = [cur(1, 3, 1, 0), cur(5, 3, 2, 1), cur(3, 3, 3, 2)];
    const diff = keepDiff(base, current);
    const a = keptExercises({ before: notOpened, base, current, diff, entryFor, opId: 'keep-3', atUtc: at(0).utc });
    const b = keptExercises({ before: notOpened, base, current, diff, entryFor, opId: 'keep-3', atUtc: at(0).utc });
    expect(a.map((e) => e.exerciseId)).toEqual([id(1), id(5), id(3), id(9)]);
    expect(a).toEqual(b);
  });
});

describe('withWorkingSets', () => {
  it('a top set’s copy is a back-off, before trailing drops; fewer never takes the top set', () => {
    const e = ex(1, 0, ['warmup', 'top', 'backoff', 'drop']);
    const more = withWorkingSets(e, 4, 'seed');
    expect(more.setTemplates.map((t) => t.setType)).toEqual(['warmup', 'top', 'backoff', 'backoff', 'drop']);
    const fewer = withWorkingSets(e, 1, 'seed');
    expect(fewer.setTemplates.map((t) => t.setType)).toEqual(['warmup', 'top']);
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

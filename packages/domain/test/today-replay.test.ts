import { describe, expect, it } from 'vitest';
import {
  applyBuilderEdit,
  buildFromSetup,
  fitToMinutes,
  replayTodayEdits,
  replayedFitSteps,
  slotsOf,
  todayTimeFit,
  unfitWorkout,
  workingCount,
  type BuilderContext,
  type BuilderWorkout,
  type GroupCount,
} from '../src/index';
import { context, info, pool } from './builder-v3-fixture';

/**
 * Today's options on Your workout (D3, §2.3a; review todaylean S2/S3, FT5): Today's draft for the new choice, with
 * Ben's edits replayed. Today's slot keys name an exercise for the day (`today-slot:<date>:<id>`), as here.
 */
const ctx: BuilderContext = { ...context(), newKey: (id) => `today:${id}` };
const ids = (w: BuilderWorkout) => slotsOf(w.blocks).map((s) => s.exerciseId);
const today = (groups: readonly GroupCount[], opts: { supersets?: boolean; accessories?: 'focused' | 'varied'; main?: string } = {}) =>
  buildFromSetup({ minutes: 999, mainLiftExerciseId: opts.main ?? 'bench', supersets: opts.supersets ?? false, groups, ...(opts.accessories === undefined ? {} : { accessories: opts.accessories }) }, pool, ctx, { trim: false }).workout;
const noAbs: GroupCount[] = [{ group: 'Chest', count: 3 }, { group: 'Triceps', count: 1 }];
const withAbs: GroupCount[] = [...noAbs, { group: 'Abs', count: 1 }];
const edit = (w: BuilderWorkout, op: Parameters<typeof applyBuilderEdit>[1]) => {
  const r = applyBuilderEdit(w, op, ctx);
  if (!r.ok) throw new Error(r.reason);
  return r.workout;
};
const keyOf = (w: BuilderWorkout, id: string) => slotsOf(w.blocks).find((s) => s.exerciseId === id)?.key ?? '';

describe('replayTodayEdits', () => {
  it('no edits: exactly Today’s draft for the new choice', () => {
    const was = today(noAbs);
    const next = today(withAbs);
    expect(replayTodayEdits({ next, current: was, removed: [], info })).toEqual(next);
  });

  it('a slot Ben deleted stays deleted (acceptance 5: delete Cable fly, then Abs on/off)', () => {
    const was = today(withAbs);
    const fly = keyOf(was, 'cable_fly');
    const now = edit(was, { kind: 'delete_exercise', slotKey: fly });
    const r = replayTodayEdits({ next: today(noAbs), current: now, removed: [fly], info });
    expect(ids(r)).not.toContain('cable_fly');
    expect(ids(r)).not.toContain('crunch');
    expect(ids(r)).toEqual(ids(today(noAbs)).filter((x) => x !== 'cable_fly'));
  });

  it('a slot Ben changed keeps his version in place; a swap keeps its place; an added exercise follows the slot it followed', () => {
    const was = today(noAbs);
    const incline = keyOf(was, 'incline_db');
    let now = edit(was, { kind: 'add_set', slotKey: incline });
    now = edit(now, { kind: 'swap', slotKey: keyOf(now, 'pushdown'), exerciseId: 'oh_ext' });
    now = edit(now, { kind: 'add_exercise', exerciseId: 'hammer' });
    const r = replayTodayEdits({ next: today(withAbs), current: now, removed: [], info });
    const mine = slotsOf(r.blocks);
    expect(workingCount(mine.find((s) => s.key === incline) ?? { rows: [] })).toBe(4);
    expect(ids(r)).toContain('oh_ext');
    expect(ids(r)).not.toContain('pushdown');
    expect(ids(r).indexOf('oh_ext')).toBe(ids(today(withAbs)).indexOf('pushdown'));
    expect(ids(r)).toContain('hammer');
    expect(ids(r)).toContain('crunch');
    expect(slotsOf(r.blocks).filter((s) => s.main).map((s) => s.exerciseId)).toEqual(['bench']);
  });

  it('skip: his slots that don’t belong to the new choice (the old main lift on a new Main lift; his own ab exercise on Abs off)', () => {
    const was = today(withAbs);
    let now = edit(was, { kind: 'add_set', slotKey: keyOf(was, 'bench') });
    now = edit(now, { kind: 'add_exercise', exerciseId: 'knee_raise' });
    const incline = today(noAbs, { main: 'incline_bb' });
    const r = replayTodayEdits({ next: incline, current: now, removed: [], info, skip: (s) => s.main || info(s.exerciseId)?.group === 'Abs' });
    expect(slotsOf(r.blocks).filter((s) => s.main).map((s) => s.exerciseId)).toEqual(['incline_bb']);
    expect(ids(r)).not.toContain('knee_raise');
    expect(ids(r).filter((x) => x === 'bench')).toHaveLength(ids(incline).filter((x) => x === 'bench').length);
  });

  it('one copy of an exercise: Today’s copy of what Ben swapped in goes', () => {
    const was = today(noAbs);
    const now = edit(was, { kind: 'swap', slotKey: keyOf(was, 'pushdown'), exerciseId: 'crunch' });
    const r = replayTodayEdits({ next: today(withAbs), current: now, removed: [], info });
    expect(ids(r).filter((x) => x === 'crunch')).toHaveLength(1);
  });

  it('the fit record after a replay: Time’s cuts only, so more time brings back Today’s draft for the choice with Ben’s edits kept', () => {
    const was = today(noAbs);
    const fly = keyOf(was, 'cable_fly');
    const now = edit(edit(was, { kind: 'delete_exercise', slotKey: fly }), { kind: 'add_set', slotKey: keyOf(was, 'incline_db') });
    const nextBase = today(withAbs);
    const fitted = fitToMinutes(nextBase, ctx, { minutes: 30, mainGroup: 'Chest', grow: false, supersets: false });
    const base = replayTodayEdits({ next: nextBase, current: now, removed: [fly], info });
    const result = replayTodayEdits({ next: fitted.workout, current: now, removed: [fly], info });
    const steps = replayedFitSteps(fitted.steps, base);
    // Nothing on a slot Ben deleted or changed is Time's.
    expect(steps.some((s) => 'slotKey' in s && (s.slotKey === fly || s.slotKey === keyOf(was, 'incline_db')))).toBe(false);
    const rec = todayTimeFit(base, steps, 60, ctx);
    if (rec === null) throw new Error('no record');
    const back = unfitWorkout(rec, result);
    expect(ids(back)).toEqual(ids(base));
    expect(ids(back)).not.toContain('cable_fly');
    expect(workingCount(slotsOf(back.blocks).find((s) => s.exerciseId === 'incline_db') ?? { rows: [] })).toBe(4);
  });
});

describe('todayTimeFit', () => {
  it('a card Time shrank: the draft before, what it cut, dropped and paired; the length at which nothing is cut', () => {
    const w = today(withAbs, { supersets: true });
    const fit = fitToMinutes(w, ctx, { minutes: 30, mainGroup: 'Chest', grow: false, supersets: true });
    const rec = todayTimeFit(w, fit.steps, 60, ctx);
    expect(rec?.base).toEqual(w);
    expect(rec?.dropped).toEqual(fit.steps.flatMap((s) => (s.kind === 'drop' ? [s.slotKey] : [])));
    expect(rec?.fromMinutes).toBeGreaterThanOrEqual(60);
    expect(unfitWorkout(rec ?? { base: w, dropped: [] }, fit.workout)).toEqual(w);
  });

  it('nothing changed: no record; a card Time filled: a fill record from the plan day (re-review B3)', () => {
    const w = today(noAbs);
    expect(todayTimeFit(w, [], 60, ctx)).toBeNull();
    const fill = todayTimeFit(w, [{ kind: 'add', slotKey: 'x', exerciseId: 'hammer', why: 'arm' }], 60, ctx, 90);
    expect(fill).toMatchObject({ base: w, fromMinutes: 60, dropped: [], added: [{ slotKey: 'x', why: 'arm' }], filledTo: 90 });
  });

  it('a plan day longer than its own length: fitted at it, the record’s length is the draft’s own', () => {
    const w = today(withAbs);
    const fit = fitToMinutes(w, ctx, { minutes: 45, mainGroup: 'Chest', grow: false, supersets: false });
    const rec = todayTimeFit(w, fit.steps, 45, ctx);
    expect(rec?.fromMinutes).toBeGreaterThan(45);
  });
});

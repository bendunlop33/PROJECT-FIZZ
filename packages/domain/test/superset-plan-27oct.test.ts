import { describe, expect, it } from 'vitest';
import { coachEditStepOpId, type PlanDayDraft, type RoutineExercise, type SessionAggregate, type SetTemplate } from '@fizz/schemas';
import {
  buildPlanFromAnswers,
  pbDayEstimateS,
  pbDayWarmups,
  deriveId,
  keepDiff,
  keptExercises,
  markBenEdit,
  pbDayAsWorkout,
  pbSupersetLabels,
  storedTemplateWorkout,
  withMidWorkoutEdits,
  type BuilderWorkout,
  type KeepBaseItem,
  type KeepCurrentItem,
  type TodayTemplate,
} from '../src/index';
import { context, info, pool } from './builder-v3-fixture';
import { id } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers as pbAnswers } from './plan-builder-fixture';

/**
 * (Ben, 27 Oct, build 435: "If I add superset it doesn't then change the plan") Pure parts of the fix:
 * - Today drafts a plan day as stored (order, set counts, superset pairs; Supersets off splits; another gym's exercise
 *   gives way to its group's next pick in the same pair);
 * - Keep for next time? lists and writes Ben's own pairs, unlinks and moves (never the app's), and his mid-workout
 *   `Superset with…` and adds (never the coach's steps);
 * - Library › Plan shows a week not done yet as its workout will run it, with superset labels.
 */

const template = (slots: TodayTemplate['slots'], over: Partial<TodayTemplate> = {}): TodayTemplate => ({
  routineId: 'r-push',
  version: 1,
  label: 'Bench',
  mainLiftExerciseId: 'bench',
  exerciseIds: (slots ?? []).map((x) => x.exerciseId),
  minutes: 45,
  absPlan: (slots ?? []).some((x) => info(x.exerciseId)?.group === 'Core'),
  supersetsPlan: (slots ?? []).some((x) => x.group !== null),
  groups: [],
  ...(slots === undefined ? {} : { slots }),
  ...over,
});
const shape = (w: BuilderWorkout | null) => w?.blocks.map((b) => b.slots.map((s) => `${s.exerciseId}×${String(s.rows.filter((r) => r.type !== 'warmup').length)}`).join('+'));

const PUSH: NonNullable<TodayTemplate['slots']> = [
  { exerciseId: 'bench', workingSets: 3, group: null },
  { exerciseId: 'incline_db', workingSets: 3, group: null },
  { exerciseId: 'cable_fly', workingSets: 2, group: 'A' },
  { exerciseId: 'pushdown', workingSets: 2, group: 'A' },
  { exerciseId: 'crunch', workingSets: 3, group: null },
];

describe('storedTemplateWorkout: the plan day as stored', () => {
  it('keeps order, set counts and the stored superset; Supersets off splits it', () => {
    const t = template(PUSH);
    expect(shape(storedTemplateWorkout(t, { supersets: true }, { ctx: context(), pool }))).toEqual(['bench×3', 'incline_db×3', 'cable_fly×2+pushdown×2', 'crunch×3']);
    expect(shape(storedTemplateWorkout(t, { supersets: false }, { ctx: context(), pool }))).toEqual(['bench×3', 'incline_db×3', 'cable_fly×2', 'pushdown×2', 'crunch×3']);
  });
  it('an exercise not usable here gives way to its group’s next pick, in the same pair; the main lift leads', () => {
    const t = template([{ exerciseId: 'incline_db', workingSets: 3, group: null }, ...PUSH.filter((x) => x.exerciseId !== 'incline_db')]);
    const w = storedTemplateWorkout(t, { supersets: true }, { ctx: context(), pool, usable: (x) => x !== 'cable_fly' });
    expect(shape(w)).toEqual(['bench×3', 'incline_db×3', 'machine_press×2+pushdown×2', 'crunch×3']);
  });
  it('no stored slots: null (the group draft stands)', () => {
    expect(storedTemplateWorkout(template(undefined), { supersets: true }, { ctx: context(), pool })).toBeNull();
  });
});

// Keep: routine Bench (main), Fly, Pushdown, Crunch; Fly + Pushdown stored as superset A.
const set = (n: number, k: number): SetTemplate => ({ id: id(7000 + n * 20 + k), setType: 'working', targetLoad: null, targetReps: { min: 8, max: 12 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: null });
const rex = (n: number, order: number, group: string | null, over: Partial<RoutineExercise> = {}): RoutineExercise => ({ id: id(600 + n), exerciseId: id(n), equipmentId: null, order, supersetGroup: group, setTemplates: [set(n, 0), set(n, 1), set(n, 2)], restBySetType: {}, transitionRestS: null, progressionRuleId: null, ...over });
const before = [rex(1, 0, null, { main: true }), rex(2, 1, 'A'), rex(3, 2, 'A'), rex(4, 3, null)];
const base: KeepBaseItem[] = before.map((e) => ({ exerciseId: e.exerciseId, workingSets: 3, ref: e.id, group: e.supersetGroup }));
const cur = (n: number, round: number, ben: KeepCurrentItem['ben'] = null): KeepCurrentItem => ({ key: `slot-${String(n)}`, exerciseId: id(n), workingSets: 3, origin: id(n), round, ben });
const entryFor = (item: KeepCurrentItem): RoutineExercise => rex(90, 0, null, { id: deriveId(item.key), exerciseId: item.exerciseId });
const kept = (current: KeepCurrentItem[]) => {
  const diff = keepDiff(base, current);
  return { diff, out: keptExercises({ before, base, current, diff, entryFor, opId: 'keep-ss', atUtc: '2026-10-27T10:00:00.000Z' }) };
};
const groups = (out: readonly RoutineExercise[]) => [...out].sort((a, b) => a.order - b.order).map((e) => `${e.exerciseId === id(1) ? 'bench' : e.exerciseId === id(2) ? 'fly' : e.exerciseId === id(3) ? 'pushdown' : 'crunch'}:${e.supersetGroup ?? '-'}`);

describe('Keep for next time?: Ben’s own supersets and order', () => {
  it('as stored, or pairs the app made (no marks): nothing listed', () => {
    expect(kept([cur(1, 0), cur(2, 1), cur(3, 1), cur(4, 2)]).diff.changes).toEqual([]);
    // Supersets off today (Today's control): the stored pair split, never an unlink line.
    expect(kept([cur(1, 0), cur(2, 1), cur(3, 2), cur(4, 3)]).diff.changes).toEqual([]);
    // Time's fit paired Pushdown with Crunch: not Ben's.
    expect(kept([cur(1, 0), cur(2, 1), cur(3, 2), cur(4, 2)]).diff.changes).toEqual([]);
  });
  it('he unlinks Pushdown and pairs it with Crunch: two lines; Apply writes the new pair and splits the old', () => {
    const r = kept([cur(1, 0), cur(2, 1, { placed: true }), cur(3, 2, { placed: true }), cur(4, 2, { placed: true })]);
    expect(r.diff.changes).toEqual([
      { kind: 'unpair', exerciseId: id(2) },
      { kind: 'pair', a: id(3), b: id(4) },
    ]);
    expect(groups(r.out)).toEqual(['bench:-', 'fly:-', 'pushdown:A', 'crunch:A']);
    expect(r.out.filter((e) => e.structureChangedAtUtc !== undefined).map((e) => e.exerciseId).sort()).toEqual([id(2), id(4)].sort());
  });
  it('he moves Crunch before the superset: order alone is never listed (D1)', () => {
    expect(kept([cur(1, 0), cur(4, 1), cur(2, 2), cur(3, 2)]).diff.changes).toEqual([]);
  });
  it('he pairs Bench’s neighbour Fly with Crunch (Crunch moved up beside it): the pair written side by side', () => {
    const r = kept([cur(1, 0), cur(2, 1, { placed: true }), cur(4, 1, { placed: true }), cur(3, 2, { placed: true })]);
    expect(r.diff.changes).toEqual([
      { kind: 'pair', a: id(2), b: id(4) },
      { kind: 'unpair', exerciseId: id(3) },
    ]);
    expect(groups(r.out)).toEqual(['bench:-', 'fly:A', 'crunch:A', 'pushdown:-']);
  });
});

describe('markBenEdit: his pairing', () => {
  const slot = (key: string, exerciseId: string) => ({ key, exerciseId, main: false, repRange: { min: 8, max: 12 }, rows: [{ type: 'working' as const, reps: 8, load: null, rpe: null }], unit: 'kg' as const, convention: 'total' as const, source: 'none' as const, startLight: null, anchorE1rm: null });
  const w = (...blocks: string[][]): BuilderWorkout => ({ restLevel: 'normal', blocks: blocks.map((b) => ({ auto: false, slots: b.map((k) => slot(k, k)) })) });
  it('a pair he makes marks both; slots he didn’t touch stay unmarked', () => {
    const m = markBenEdit(w(['a'], ['b'], ['c']), w(['a'], ['b', 'c']), () => 1);
    expect(m.workout.blocks.map((b) => b.slots.map((s) => `${s.key}:${s.keep?.placed === true ? 'p' : '-'}`))).toEqual([['a:-'], ['b:p', 'c:p']]);
  });
  it('a move, an add or a removal alone marks nothing', () => {
    const marked = (x: BuilderWorkout) => x.blocks.flatMap((b) => b.slots.filter((s) => s.keep?.placed === true).map((s) => s.key));
    expect(marked(markBenEdit(w(['a'], ['b'], ['c']), w(['c'], ['a'], ['b']), () => 1).workout)).toEqual([]);
    expect(marked(markBenEdit(w(['a'], ['b']), w(['a'], ['b'], ['n']), () => 1).workout)).toEqual([]);
    expect(marked(markBenEdit(w(['a'], ['b'], ['c']), w(['a'], ['c']), () => 1).workout)).toEqual([]);
    // An add of his paired with b: b is placed.
    expect(marked(markBenEdit(w(['a'], ['b']), w(['a'], ['b', 'n']), () => 1).workout)).toEqual(['b']);
  });
});

describe('withMidWorkoutEdits: his mid-workout supersets and adds, never the coach’s', () => {
  const row = (n: number, order: number, group: string | null) => ({ id: `row-${String(n)}`, sessionId: 's', exerciseId: id(n), exerciseName: `E${String(n)}`, measurement: 'reps' as const, laterality: 'bilateral' as const, equipmentId: null, loadConvention: 'total' as const, unit: 'kg' as const, order, supersetGroup: group, transitionRestS: null, progressionRuleId: null });
  const a = (rows: ReturnType<typeof row>[], ops: SessionAggregate['processedOps']): Pick<SessionAggregate, 'exercises' | 'sets' | 'processedOps'> => ({ exercises: rows, sets: [], processedOps: ops });
  const started = [cur(1, 0), cur(2, 1), cur(3, 2), cur(4, 3)];
  const op = (opId: string, commandType: string, createdIds?: string[]) => ({ [opId]: { opId, commandType, fingerprint: 'f', atUtc: '2026-10-27T10:00:00.000Z', ...(createdIds === undefined ? {} : { createdIds }) } });
  it('his `Superset with…` (link_superset): the workout’s rounds, both marked', () => {
    const r = withMidWorkoutEdits(started, a([row(1, 0, null), row(2, 1, null), row(3, 2, 'A'), row(4, 3, 'A')], op('ben-link', 'link_superset')));
    expect(r.current.map((c) => [c.exerciseId, c.round, c.ben?.placed === true])).toEqual([
      [id(1), 0, false],
      [id(2), 1, false],
      [id(3), 2, true],
      [id(4), 2, true],
    ]);
  });
  it('the coach’s link (a coach_edit_today step): nothing of his', () => {
    const parent = 'coach-edit-1';
    const r = withMidWorkoutEdits(started, a([row(1, 0, null), row(2, 1, null), row(3, 2, 'A'), row(4, 3, 'A')], { ...op(parent, 'coach_edit_today'), ...op(coachEditStepOpId(parent, 0), 'link_superset') }));
    expect(r.current).toEqual(started);
  });
  it('`Superset with…` a new exercise: his add, in the round of the one he paired it with', () => {
    const r = withMidWorkoutEdits(started, a([row(1, 0, null), row(2, 1, null), row(3, 2, null), row(4, 3, 'A'), row(9, 4, 'A')], op('ben-add', 'add_exercise', ['row-9'])));
    expect(r.adds).toEqual([{ key: 'row-9', exerciseId: id(9), workingSets: 1 }]);
    expect(r.current.at(-1)).toMatchObject({ exerciseId: id(9), round: 3, ben: { added: true } });
    expect(r.current.find((c) => c.exerciseId === id(4))?.ben?.placed).toBe(true);
  });
});

describe('Library › Plan: a week not done yet as its workout will run it', () => {
  const dset = { setType: 'working' as const, reps: { min: 8, max: 12 }, durationS: null, targetRpe: 8, restS: null };
  const slot = (n: number, order: number, sets: number, group: string | null = null) => ({ slotKey: `k${String(n)}`, exerciseId: id(n), catalogueId: `c${String(n)}`, order, main: n === 1, supersetGroup: group, setTemplates: Array.from({ length: sets }, () => ({ ...dset })) });
  const day = (slots: ReturnType<typeof slot>[]): PlanDayDraft => ({ index: 0, name: 'Push', splitDayId: 'push', focus: 'split_day', minutes: 45, plan: { slots, notes: [] } as unknown as PlanDayDraft['plan'], checks: [] });
  it('the template’s order and supersets; the week’s own sets plus Ben’s change; a removed one gone; an added one shown', () => {
    const week3 = day([slot(1, 0, 4), slot(2, 1, 3), slot(3, 2, 3), slot(4, 3, 2)]);
    const baseDay = day([slot(1, 0, 3), slot(2, 1, 3), slot(3, 2, 3), slot(4, 3, 2)]);
    // Ben: Pushdown (3) paired with a new Hammer curl (5), Fly (2) one set more, Crunch (4) removed.
    const tpl = [rex(1, 0, null, { main: true }), rex(2, 1, null, { setTemplates: [set(2, 0), set(2, 1), set(2, 2), set(2, 3)] }), rex(3, 2, 'A'), rex(5, 3, 'A')];
    const out = pbDayAsWorkout(week3, tpl, baseDay);
    expect(out.plan.slots.map((x) => [x.exerciseId, x.supersetGroup, x.setTemplates.length])).toEqual([
      [id(1), null, 4],
      [id(2), null, 4],
      [id(3), 'A', 3],
      [id(5), 'A', 3],
    ]);
    expect(pbSupersetLabels(out.plan.slots)).toEqual([null, null, 'A1', 'A2']);
  });
});

describe('(Ben, 27 Oct) "I set the plan to be 45 mins so why is Pull B 50+ mins?": one shared time estimate', () => {
  const ex = (key: string, role: 'main' | 'c' | 'i', sets: number, reps: number, pair: string | null = null) => ({ key, muscle: 'Back' as const, role, tags: [], sets, reps, load: { kind: 'none' as const }, bodyweightMain: false, main: null, estimate: false, pair, why: '' });
  it('his Pull B as built (Pull-up 4, Barbell row 2 + 2 warm-ups, rear-delt fly 2, shrug 2, curl 3, crunch 3 + 1) is over 45 by the estimate Today uses', () => {
    const day = { exercises: [ex('pull-up', 'main', 4, 6), ex('barbell-row', 'c', 2, 8), ex('rear-delt-fly', 'i', 2, 12), ex('barbell-shrug', 'i', 2, 10), ex('barbell-curl', 'i', 3, 10), ex('cable-crunch', 'i', 3, 12)] };
    const steps = [[], [{ reps: 5, load: 40 }, { reps: 3, load: 60 }], [], [], [], [{ reps: 8, load: 20 }]];
    const s = pbDayEstimateS(day, { stepsOf: (k) => steps[k] ?? [] });
    expect(s).toBeGreaterThan(45 * 60 + 29);
    // Paired as the plan builder pairs accessories, it takes less time.
    const paired = { exercises: [ex('pull-up', 'main', 4, 6), ex('barbell-row', 'c', 2, 8), ex('rear-delt-fly', 'i', 2, 12, 'A1'), ex('barbell-shrug', 'i', 2, 10, 'A2'), ex('barbell-curl', 'i', 3, 10, 'B1'), ex('cable-crunch', 'i', 3, 12, 'B2')] };
    expect(pbDayEstimateS(paired, { stepsOf: (k) => steps[k] ?? [] })).toBeLessThan(s);
  });
  it('a PPL plan built at 45 minutes: every day fits 45 by that estimate (warm-ups and abs in), Supersets on or off, any Warm-ups, 3 or 6 days', () => {
    for (const supersets of [true, false])
      for (const warmups of ['full', 'short', 'none'] as const)
        for (const sessions of [3, 6]) {
          const a = pbAnswers({ split: 'ppl', sessions, minutes: 45, supersets, warmups });
          const p = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
          for (const d of p.days) {
            const est = pbDayEstimateS(d, pbDayWarmups(d, a, { kitOf: KIT_OF }));
            expect(est, `${String(sessions)} days, supersets ${String(supersets)}, ${warmups}, ${d.focus}`).toBeLessThanOrEqual(45 * 60 + 29);
            expect(d.minutes).toBeLessThanOrEqual(45);
          }
        }
  });
});

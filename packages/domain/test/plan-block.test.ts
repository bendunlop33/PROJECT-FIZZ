import { describe, expect, it } from 'vitest';

import type { DraftSlot, PlanPause } from '@fizz/schemas';

import {
  buildPlanFromAnswers,
  builderLoad,
  deloadSetCount,
  makeSlot,
  pbAtWeek,
  pbBlockLine,
  pbBlockOfPlan,
  pbBlockView,
  pbBlockViews,
  pbBlockWeekOf,
  pbExerciseOfSlot,
  pbPlanVersion,
  pbStartReps,
  withDeloadLoads,
  withDeloadSets,
  workingCount,
  type BuilderWorkout,
  type PbPlan,
  type PlanKit,
} from '../src/index';
import { context, loadInput, assist, cable } from './builder-v3-fixture';
import { BAR, DB, HISTORY_OF, KIT_OF, NOW, STACK, answers } from './plan-builder-fixture';

/**
 * (Ben, 23 Oct: a plan's length is its training block, block 1) The block week derived from the plan's Apply, its
 * pauses and Ben's plan workouts (training-blocks §4.1, TB1); the weekly planned targets on Your plan (`pbAtWeek`);
 * the deload week's draft (−10 % rounded down, a set fewer, RPE ≤ 7; §4.4, Q3).
 */

const TZ = 'Europe/London';
const ms = (iso: string) => Date.parse(iso);
const w = (iso: string, dayIndex: number | null = 0) => ({ startedAtUtc: iso, dayIndex });
const at = { utc: '2026-10-22T12:00:00.000Z', tz: TZ } as const;

describe('block week (pbBlockWeekOf)', () => {
  const six = { weeks: 6 as const, effort: 'standard' as const };

  it('TB1: applied Wed 14 Oct, plan workouts in the weeks of 12, 19 and 26 Oct, none 2–8 Nov: on 10 Nov it is week 4', () => {
    const b = pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-10-14T09:00:00.000Z', workouts: [w('2026-10-15T08:00:00Z'), w('2026-10-21T08:00:00Z'), w('2026-10-28T08:00:00Z', 1)], nowMs: ms('2026-11-10T08:00:00Z'), tz: TZ });
    expect(b).toMatchObject({ week: 4, of: 6, deload: false, done: false });
    expect(b.mondays).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-09']);
    expect(b.daysDone).toEqual([[0], [0], [1], []]);
    expect(pbBlockLine(b)).toEqual({ text: 'Week 4 of 6', accessibilityLabel: 'Training block, week 4 of 6', deload: false, done: false });
  });

  it('the same with 2–8 Nov paused; a fully paused week with a workout in it never counts', () => {
    const pause: PlanPause = { opId: '00000000-0000-4000-8000-00000000a001', fromUtc: '2026-11-01T23:00:00.000Z', untilDate: '2026-11-09', endedAtUtc: null };
    const workouts = [w('2026-10-15T08:00:00Z'), w('2026-10-21T08:00:00Z'), w('2026-10-28T08:00:00Z')];
    expect(pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-10-14T09:00:00.000Z', pauses: [pause], workouts, nowMs: ms('2026-11-10T08:00:00Z'), tz: TZ }).week).toBe(4);
    const paused = pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-10-14T09:00:00.000Z', pauses: [pause], workouts: [...workouts, w('2026-11-04T08:00:00Z')], nowMs: ms('2026-11-10T08:00:00Z'), tz: TZ });
    expect(paused.week).toBe(4);
  });

  it('an empty week holds the number (nothing is missed); workouts before Apply or in the future are not counted', () => {
    const b = pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-10-14T09:00:00.000Z', workouts: [w('2026-10-13T08:00:00Z'), w('2026-12-01T08:00:00Z')], nowMs: ms('2026-11-10T08:00:00Z'), tz: TZ });
    expect(b.week).toBe(1);
    // A deleted workout re-derives: the week goes back (never stored).
    const before = pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-10-14T09:00:00.000Z', workouts: [w('2026-10-15T08:00:00Z')], nowMs: ms('2026-10-20T08:00:00Z'), tz: TZ });
    const after = pbBlockWeekOf({ answers: six, appliedAtUtc: '2026-10-14T09:00:00.000Z', workouts: [], nowMs: ms('2026-10-20T08:00:00Z'), tz: TZ });
    expect([before.week, after.week]).toEqual([2, 1]);
  });

  it('deload weeks: Standard the last week, Push every 4th, Maintain none; done past the last week', () => {
    const weekly = (n: number) => Array.from({ length: n }, (_, i) => w(new Date(ms('2026-10-15T08:00:00Z') + i * 7 * 86_400_000).toISOString()));
    const atWeek = (effort: 'standard' | 'push' | 'maintain', weeks: 4 | 6 | 8 | 12, done: number) => pbBlockWeekOf({ answers: { weeks, effort }, appliedAtUtc: '2026-10-14T09:00:00.000Z', workouts: weekly(done), nowMs: ms('2026-10-15T09:00:00Z') + done * 7 * 86_400_000, tz: TZ });
    expect(atWeek('standard', 6, 5)).toMatchObject({ week: 6, deload: true });
    expect(pbBlockLine(atWeek('standard', 6, 5)).text).toBe('Week 6 of 6 · Deload');
    expect(atWeek('standard', 6, 4)).toMatchObject({ week: 5, deload: false });
    expect(atWeek('push', 8, 3)).toMatchObject({ week: 4, deload: true });
    expect(atWeek('push', 8, 4)).toMatchObject({ week: 5, deload: false });
    expect(atWeek('maintain', 12, 11)).toMatchObject({ week: 12, deload: false });
    const done = atWeek('standard', 6, 6);
    expect(done).toMatchObject({ week: 7, done: true, deload: false });
    expect(done.mondays).toHaveLength(6);
    expect(pbBlockLine(done).text).toBe('Block done');
  });

  it('pbBlockOfPlan counts the plan’s own workouts only (its plan day, or a workout its Apply made)', () => {
    const p = build(answers({ split: 'ppl', sessions: 3, days: [0, 2, 4] }));
    const version = pbPlanVersion({ plan: p, answers: answers({ split: 'ppl', sessions: 3, days: [0, 2, 4] }), kitOf: KIT_OF, gymId: null, equipmentVersion: 'v', opId: '00000000-0000-4000-8000-00000000b001', at, planId: 'plan-1' });
    const plan = {
      id: 'plan-1',
      status: 'applied' as const,
      versions: [version],
      currentVersion: 1,
      applied: { mode: 'replace' as const, versionN: 1, opId: '00000000-0000-4000-8000-00000000b002', atUtc: '2026-10-14T09:00:00.000Z', made: [{ dayIndex: 1, routineId: 'r-pull', version: 1 }], rotationOff: [] },
      pauses: [],
    };
    const refs = [
      { routineId: null, startedAtUtc: '2026-10-15T08:00:00Z', planDay: { planId: 'plan-1', dayIndex: 0 } },
      { routineId: 'r-pull', startedAtUtc: '2026-10-22T08:00:00Z' },
      { routineId: 'someone-else', startedAtUtc: '2026-10-29T08:00:00Z' },
      { routineId: null, startedAtUtc: '2026-10-29T09:00:00Z', planDay: { planId: 'other-plan', dayIndex: 0 } },
    ];
    expect(pbBlockOfPlan(plan, refs, ms('2026-11-03T08:00:00Z'), TZ)).toMatchObject({ week: 3, daysDone: [[0], [1], []] });
    // A coach plan (no builder answers) has no block.
    expect(pbBlockOfPlan({ ...plan, versions: [{ ...version, builder: undefined }] }, refs, ms('2026-11-03T08:00:00Z'), TZ)).toBeNull();
  });
});

function build(a = answers()): PbPlan {
  return buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
}

describe('Your plan: the week strip and each week’s planned targets', () => {
  const a = answers({ split: 'ppl', sessions: 3, days: [0, 2, 4], lifts: { 'barbell-back-squat': { kind: 'confirmed' } } });
  const plan = build(a);
  const version = pbPlanVersion({ plan, answers: a, kitOf: KIT_OF, gymId: null, equipmentVersion: 'v', opId: '00000000-0000-4000-8000-00000000c001', at, planId: 'plan-2' });
  const builder = { answers: a, startReps: pbStartReps(plan, 'plan-2') };
  const kits = new Map<string, PlanKit>([BAR, DB, STACK].map((k) => [k.equipmentId, k]));
  const kitOf = (s: DraftSlot): PlanKit | null => kits.get(s.checkedOn?.equipmentId ?? '') ?? null;
  const block = (week: number, daysDone: number[][] = []) => ({ week, of: 6, deload: week === 6, done: week > 6, mondays: Array.from({ length: Math.min(week, 6) }, (_, i) => `2026-10-${String(12 + i * 7).padStart(2, '0')}`), daysDone });
  const nameOf = (id: string) => id;
  const bench = (v: ReturnType<typeof pbBlockView>) => v.days.flatMap((d) => d.rows).find((r) => version.days.flatMap((d) => d.plan.slots).find((s) => s.slotKey === r.key)?.catalogueId === 'barbell-bench-press' && r.main);

  it('week 1 reads as the builder showed it; later weeks follow pbAtWeek, snapped; week 6 is the deload', () => {
    const w1 = pbBlockView({ version, builder, block: block(1), viewed: 1, kitOf, nameOf });
    expect(bench(w1)?.line).toBe('1 × 6 + 2 × 8 · 100 / 95');
    const benchEx = plan.days.flatMap((d) => d.exercises).find((e) => e.key === 'barbell-bench-press' && e.role === 'main');
    if (benchEx === undefined) throw new Error('no bench');
    for (const wk of [2, 3, 4, 5, 6]) {
      const v = pbBlockView({ version, builder, block: block(1), viewed: wk, kitOf, nameOf });
      expect(bench(v)?.line).toBe(pbAtWeek(a, benchEx, BAR, wk).line);
    }
    const w6 = pbBlockView({ version, builder, block: block(1), viewed: 6, kitOf, nameOf });
    expect(w6.note).toBe('Deload: lighter, fewer sets');
    expect(bench(w6)?.line).toBe('1 × 6 + 1 × 8 · 92.5 / 87.5');
    expect(w6.strip.map((c) => [c.week, c.deload])).toEqual([[1, false], [2, false], [3, false], [4, false], [5, false], [6, true]]);
  });

  it('accessories start from the reps the engine planned (not the range bottom) and use double progression; deload a set fewer, never below 2', () => {
    const slots = version.days.flatMap((d) => d.plan.slots).filter((s) => !s.main);
    const s = slots.find((x) => (builder.startReps[x.slotKey] ?? 0) > 8 && (builder.startReps[x.slotKey] ?? 0) < 12) ?? slots[0];
    if (s === undefined) throw new Error('no accessory');
    const reps = builder.startReps[s.slotKey] ?? 0;
    const w1 = pbBlockView({ version, builder, block: block(1), viewed: 1, kitOf, nameOf }).days.flatMap((d) => d.rows).find((r) => r.key === s.slotKey);
    const sets = s.setTemplates.filter((t) => t.setType !== 'warmup').length;
    expect(w1?.line).toBe(`${String(sets)} × ${String(reps)}`);
    const w6 = pbBlockView({ version, builder, block: block(1), viewed: 6, kitOf, nameOf }).days.flatMap((d) => d.rows).find((r) => r.key === s.slotKey);
    expect(w6?.line.startsWith(`${String(deloadSetCount(sets))} × `)).toBe(true);
    expect(deloadSetCount(4)).toBe(3);
    expect(deloadSetCount(3)).toBe(2);
    expect(deloadSetCount(2)).toBe(2);
    expect(deloadSetCount(1)).toBe(1);
  });

  it('a dumbbell main lift adds reps first, then the next dumbbell, never past the rack (rule 4); per-hand loads say each', () => {
    // The 4-day default plan has the dumbbell seated shoulder press as a main lift (26 each for 6).
    const a4 = answers();
    const p4 = build(a4);
    const v4 = pbPlanVersion({ plan: p4, answers: a4, kitOf: KIT_OF, gymId: null, equipmentVersion: 'v', opId: '00000000-0000-4000-8000-00000000c002', at, planId: 'plan-4' });
    const slot = v4.days.flatMap((d) => d.plan.slots).find((s) => s.main && s.catalogueId === 'dumbbell-seated-shoulder-press');
    if (slot === undefined) throw new Error('no dumbbell main lift');
    const small: PlanKit = { ...DB, loads: DB.loads.filter((l) => l <= 28) };
    const views = pbBlockViews({ version: v4, builder: { answers: { ...a4, weeks: 12 }, startReps: pbStartReps(p4, 'plan-4') }, block: { ...block(1), of: 12 }, kitOf: (s) => (s.slotKey === slot.slotKey ? small : kitOf(s)), nameOf });
    const lines = views.map((v) => v.days.flatMap((d) => d.rows).find((r) => r.key === slot.slotKey)?.line ?? '');
    expect(lines.slice(0, 3)).toEqual(['1 × 6 + 2 × 8 · 26 / 24 each', '1 × 7 + 2 × 8 · 26 / 24 each', '1 × 8 + 2 × 8 · 26 / 24 each']);
    // Then the next dumbbell (28), the rack's heaviest here: it holds there.
    expect(lines[3]?.startsWith('1 × 6 + 2 × 8 · 28')).toBe(true);
    for (const l of lines) for (const n of l.split('·')[1]?.match(/[\d.]+/g) ?? []) expect(Number(n)).toBeLessThanOrEqual(28);
    expect(lines.every((l) => l.endsWith(' each'))).toBe(true);
  });

  it('done weeks are read-only and say which days were done; the current week and later are not', () => {
    const b = block(3, [[0, 1], [2], []]);
    const v2 = pbBlockView({ version, builder, block: b, viewed: 2, kitOf, nameOf });
    expect(v2.readOnly).toBe(true);
    expect(v2.days.filter((d) => d.done).map((d) => d.index)).toEqual([2]);
    expect(v2.strip.map((c) => c.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo']);
    expect(v2.strip[1]?.accessibilityLabel).toBe('Week 2, done');
    expect(v2.strip[5]?.accessibilityLabel).toBe('Week 6, deload');
    const v3 = pbBlockView({ version, builder, block: b, viewed: null, kitOf, nameOf });
    expect(v3).toMatchObject({ viewed: 3, readOnly: false, header: 'Week 3 of 6' });
    // Viewing never changes the stored plan (rule 2).
    expect(JSON.stringify(version)).toBe(JSON.stringify(pbPlanVersion({ plan, answers: a, kitOf: KIT_OF, gymId: null, equipmentVersion: 'v', opId: '00000000-0000-4000-8000-00000000c001', at, planId: 'plan-2' })));
  });

  it('a slot reads back as the engine’s exercise: main lift top/back-offs, bodyweight, assisted', () => {
    const s = version.days.flatMap((d) => d.plan.slots).find((x) => x.catalogueId === 'barbell-bench-press' && x.main);
    if (s === undefined) throw new Error('no bench slot');
    const e = pbExerciseOfSlot(s, BAR);
    expect(e.main).toMatchObject({ top: 100, back: 95, reps: 6, backs: 2, backReps: 8 });
    // A bodyweight accessory (no item, no load) reads as bodyweight: its rows show `BW`.
    const bw = version.days.flatMap((d) => d.plan.slots).find((x) => x.checkedOn == null && !x.main);
    if (bw !== undefined) expect(pbExerciseOfSlot(bw, null).load).toEqual({ kind: 'bodyweight' });
  });
});

// ---------------------------------------------------------------------------
// The deload week's draft (Today, Your workout, Start)

const deloadCtx = (ids: string[]) => context(Object.fromEntries(ids.map((id) => [id, { deload: true as const }])));
const wk = (slots: ReturnType<typeof makeSlot>[]): BuilderWorkout => ({ blocks: slots.map((s) => ({ slots: [s], auto: false })), restLevel: 'normal' });

describe('deload draft: −10 % rounded down, a set fewer (min 2), RPE ≤ 7', () => {
  it('a barbell main lift: top and back-offs 10 % lighter on real plates, one back-off fewer, the top kept', () => {
    const normal = makeSlot('bench', { main: true, workingSets: 3 }, context());
    const ctx = deloadCtx(['bench']);
    const light = withDeloadSets(wk([makeSlot('bench', { main: true, workingSets: 3 }, ctx)]), ctx).workout.blocks[0]?.slots[0];
    if (light === undefined) throw new Error('no slot');
    const work = (s: typeof normal) => s.rows.filter((r) => r.type !== 'warmup');
    expect(workingCount(normal)).toBe(3);
    expect(workingCount(light)).toBe(2);
    expect(work(light)[0]?.type).toBe('top');
    const topN = work(normal)[0]?.load ?? 0;
    const topL = work(light)[0]?.load ?? 0;
    expect(topL).toBeLessThanOrEqual(topN * 0.9 + 1e-9);
    expect(topL).toBeGreaterThan(topN * 0.9 - 2.5);
    expect((topL * 100) % 250).toBe(0);
    expect(work(light).every((r) => (r.rpe ?? 0) <= 7)).toBe(true);
    // Back-offs drop by the same −10 % (D4, SS4, HT8) and stay below the top.
    const backN = work(normal)[1]?.load ?? 0;
    const backL = work(light)[1]?.load ?? 0;
    expect(backL).toBeLessThanOrEqual(backN * 0.9 + 1e-9);
    expect(backL).toBeLessThan(topL);
    // Today's cut: Keep for next time never reads the deload's set as Ben's change.
    expect(light.todayCut).toBe(1);
  });

  it('a 2-set accessory keeps its sets (never below 2); a stack load comes down to a real pin', () => {
    const ctx = deloadCtx(['cable_fly']);
    const s = withDeloadSets(wk([makeSlot('cable_fly', { main: false, workingSets: 2 }, ctx)]), ctx).workout.blocks[0]?.slots[0];
    expect(s === undefined ? 0 : workingCount(s)).toBe(2);
    const n = builderLoad(loadInput({ equipment: cable, convention: 'stack', e1rm: 22 }), { reps: 10, rpe: 8 });
    const l = builderLoad(loadInput({ equipment: cable, convention: 'stack', e1rm: 22, deload: true }), { reps: 10, rpe: 8 });
    expect(l.working).toBeCloseTo((n.working ?? 0) * 0.9, 2);
  });

  it('assisted lifts keep their assistance (less would be harder); a load at the item’s lightest is kept, never none', () => {
    const r = builderLoad(loadInput({ equipment: assist, convention: 'assistance', ruleTarget: { value: 25, reps: 8, rpe: 8 }, deload: true }), { reps: 8, rpe: 8 });
    expect(r.working).toBe(25);
    const lightest = builderLoad(loadInput({ equipment: cable, convention: 'stack', coachTarget: { value: 5, reps: 10, rpe: 8 }, deload: true }), { reps: 10, rpe: 8 });
    expect(lightest.working).toBe(5);
  });

  it('a normal week is untouched; timed sets are untouched', () => {
    const ctx = context();
    const w0 = wk([makeSlot('bench', { main: true, workingSets: 3 }, ctx)]);
    expect(withDeloadSets(w0, ctx).workout).toBe(w0);
    expect(withDeloadLoads(w0, ctx).workout).toBe(w0);
  });

  it('withDeloadLoads lightens a workout opened as planned (a library workout), on the item, typed loads kept', () => {
    const ctx = deloadCtx(['bench']);
    const slot = makeSlot('bench', { main: true, workingSets: 3 }, context());
    const typed = { ...slot, rows: slot.rows.map((r, i) => (i === slot.rows.length - 1 ? { ...r, typed: true as const } : r)) };
    const out = withDeloadLoads(wk([typed]), ctx).workout.blocks[0]?.slots[0];
    if (out === undefined) throw new Error('no slot');
    const before = typed.rows.filter((r) => r.type !== 'warmup');
    const after = out.rows.filter((r) => r.type !== 'warmup');
    expect(after.at(-1)?.load).toBe(before.at(-1)?.load);
    expect(after[0]?.load ?? 0).toBeLessThanOrEqual((before[0]?.load ?? 0) * 0.9 + 1e-9);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildPlanFromAnswers,
  currentPlanVersion,
  makeSlot,
  pbCapSets,
  pbDayWarmups,
  pbNewPlanDraft,
  pbWarmupsOf,
  planSessionWarmups,
  planSessionWarmupsAs,
  settleWarmups,
  slotsOf,
  type BuilderWorkout,
  type PbPlan,
  type PlanEngineInput,
  type SessionWarmupItem,
} from '../src/index';
import type { PlanBuilderAnswers } from '@fizz/schemas';
import { context } from './builder-v3-fixture';
import { BAR, HISTORY_OF, KIT_OF, NOW, STACK, answers } from './plan-builder-fixture';

/**
 * (Ben, 23 Oct) "Warm-up time should be selectable. Shouldn't be time driven but specific to what's being trained."
 * Each plan day's capacity is the session length less that day's own warm-ups (WU1–WU12 through the shared planner)
 * less its working sets; the Warm-ups setting (Full / Short / None) changes the warm-ups and so the capacity, and the
 * same setting plans Today's, Your workout's and Start's warm-ups (`settleWarmups` with `ctx.warmups`).
 */

const at = { utc: '2026-10-23T12:00:00.000Z', tz: 'Europe/London' } as const;
const build = (a: PlanBuilderAnswers, patch: Partial<PlanEngineInput> = {}): PbPlan => buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW, ...patch });
const steps = (w: BuilderWorkout): number[] => slotsOf(w.blocks).map((sl) => sl.rows.filter((r) => r.type === 'warmup').length);

describe('each plan day’s warm-up time comes from its own warm-ups', () => {
  it('different days get different warm-up time, and the capacity follows each day’s', () => {
    const p = build(answers({ split: 'ppl', sessions: 3, days: [0, 2, 4] }));
    const times = p.days.map((d) => d.warmupS);
    expect(new Set(times).size).toBeGreaterThan(1);
    for (const d of p.days) {
      expect(d.warmupS).toBeGreaterThan(0);
      // The day's own warm-ups, recomputed from its exercises (the iteration settled on them).
      expect(pbDayWarmups(d, answers(), { kitOf: KIT_OF }).timeS).toBe(d.warmupS);
      // It fits: the capacity is never more than the length less this day's warm-ups allows.
      expect(d.cap).toBeLessThanOrEqual(pbCapSets(answers(), d.warmupS));
      // The day's minutes include its warm-ups.
      expect(d.minutes).toBe(Math.round(d.warmupS / 60 + d.exercises.reduce((n, e) => n + e.sets, 0) * 3));
    }
  });

  it('a heavy first lift brings WU12’s general warm-up into the time (Full only)', () => {
    const p = build(answers());
    const d = p.days[0];
    if (d === undefined) throw new Error('no day');
    const w = pbDayWarmups(d, answers(), { kitOf: KIT_OF });
    expect(w.generalMinutes === null || w.generalMinutes === 3).toBe(true);
    expect(pbDayWarmups(d, answers({ warmups: 'short' }), { kitOf: KIT_OF }).generalMinutes).toBeNull();
    expect(pbDayWarmups(d, answers({ warmups: 'none' }), { kitOf: KIT_OF })).toMatchObject({ timeS: 0, generalMinutes: null });
  });

  it('an accessory with no known load is still timed (on a nominal load), never left out of the time', () => {
    const day = {
      exercises: [
        { key: 'cable-triceps-pushdown', muscle: 'Triceps' as const, role: 'i' as const, tags: [], sets: 3, reps: 12, load: { kind: 'none' as const }, bodyweightMain: false, main: null, estimate: true, pair: null, why: '' },
      ],
    };
    expect(pbDayWarmups(day, answers(), { kitOf: () => STACK }).timeS).toBe(8 * 4);
  });

  it('is deterministic and bounded', () => {
    for (const minutes of [30, 45, 60, 90])
      for (const warmups of ['full', 'short', 'none'] as const) {
        const a = answers({ minutes, warmups });
        expect(JSON.stringify(build(a))).toBe(JSON.stringify(build(a)));
      }
  });
});

describe('Warm-ups: Full / Short / None', () => {
  const at60 = (warmups: 'full' | 'short' | 'none'): PbPlan => build(answers({ warmups }));

  it('Short and None lower each day’s warm-up time and so raise its capacity', () => {
    const full = at60('full');
    const short = at60('short');
    const none = at60('none');
    full.days.forEach((d, i) => {
      const s = short.days[i];
      const n = none.days[i];
      if (s === undefined || n === undefined) throw new Error('days differ');
      expect(s.warmupS).toBeLessThan(d.warmupS);
      expect(n.warmupS).toBe(0);
      expect(s.cap).toBeGreaterThanOrEqual(d.cap);
      expect(n.cap).toBeGreaterThanOrEqual(s.cap);
      expect(n.cap).toBe(pbCapSets(answers(), 0));
    });
    const total = (p: PbPlan) => p.days.reduce((t, d) => t + d.cap, 0);
    expect(total(short)).toBeGreaterThan(total(full));
    expect(total(none)).toBeGreaterThan(total(short));
  });

  it('the main lift’s warm-ups: Full the WU4 ladder, Short WU11’s short ladder, None nothing; stored on the plan day', () => {
    const benchOf = (p: PbPlan) => p.days.flatMap((d) => d.exercises).find((e) => e.key === 'barbell-bench-press' && e.role === 'main');
    expect(benchOf(at60('full'))?.main?.warmup.map((w) => [w.load, w.reps])).toEqual([[20, 5], [40, 5], [60, 3], [80, 2]]);
    // WU11 cut 4: 50 % × 5 → 75 % × 2 (R 4–6), snapped down on the bar's loads.
    expect(benchOf(at60('short'))?.main?.warmup.map((w) => [w.load, w.reps])).toEqual([[50, 5], [75, 2]]);
    expect(benchOf(at60('none'))?.main?.warmup).toEqual([]);
    for (const warmups of ['full', 'short', 'none'] as const) {
      const a = answers({ warmups });
      const draft = pbNewPlanDraft({ plan: build(a), answers: a, kitOf: KIT_OF, ownerId: '00000000-0000-4000-8000-000000000001', gymId: null, equipmentVersion: 'v1', opId: '00000000-0000-4000-8000-0000000000aa', at });
      const v = currentPlanVersion(draft);
      expect(v.builder?.answers.warmups).toBe(warmups);
      const slot = v.days.flatMap((d) => d.plan.slots).find((x) => x.catalogueId === 'barbell-bench-press' && x.main);
      expect(slot?.setTemplates.filter((t) => t.setType === 'warmup').length).toBe({ full: 4, short: 2, none: 0 }[warmups]);
    }
  });

  it('pbWarmupsOf: the applied builder plan’s setting, else Full', () => {
    const a = answers({ warmups: 'none' });
    const draft = pbNewPlanDraft({ plan: build(a), answers: a, kitOf: KIT_OF, ownerId: '00000000-0000-4000-8000-000000000001', gymId: null, equipmentVersion: 'v1', opId: '00000000-0000-4000-8000-0000000000ab', at });
    expect(pbWarmupsOf(draft)).toBe('full');
    expect(pbWarmupsOf({ ...draft, status: 'applied' })).toBe('none');
    expect(pbWarmupsOf(null)).toBe('full');
    // A plan built before the setting: Full.
    const old: PlanBuilderAnswers = { ...a };
    delete old.warmups;
    const before = pbNewPlanDraft({ plan: build(answers()), answers: old, kitOf: KIT_OF, ownerId: '00000000-0000-4000-8000-000000000001', gymId: null, equipmentVersion: 'v1', opId: '00000000-0000-4000-8000-0000000000ac', at });
    expect(pbWarmupsOf({ ...before, status: 'applied' })).toBe('full');
  });
});

describe('planSessionWarmupsAs', () => {
  const items: SessionWarmupItem[] = [
    { cls: 'heavy', reps: 5, load: 100, warmed: false, firstOfSession: true, floorStart: false, barMass: 20, loads: BAR.loads },
    { cls: 'secondary', reps: 8, load: 30, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads: STACK.loads },
    { cls: 'isolation', reps: 12, load: 40, warmed: false, firstOfSession: false, floorStart: false, barMass: null, loads: STACK.loads },
  ];
  it('Full is the approved planner; Short is every WU11 cut to its floors; None plans nothing', () => {
    expect(planSessionWarmupsAs(items, 'full', { generalMinutes: 3 })).toEqual(planSessionWarmups(items, { generalMinutes: 3 }));
    const short = planSessionWarmupsAs(items, 'short', { generalMinutes: 3 });
    expect(short.generalMinutes).toBeNull();
    expect(short.steps.map((x) => x.length)).toEqual([2, 0, 0]);
    expect(short.overBudget).toBe(false);
    const none = planSessionWarmupsAs(items, 'none', { generalMinutes: 3 });
    expect(none).toMatchObject({ steps: [[], [], []], generalMinutes: null, timeS: 0 });
    // Ben's own warm-ups count in every mode.
    expect(planSessionWarmupsAs([{ ...items[0], fixedS: 90 } as SessionWarmupItem], 'none').timeS).toBe(90);
  });
});

describe('settleWarmups follows the setting (Today, Your workout and Start plan the same way)', () => {
  it('Full / Short / None, and Ben’s own warm-ups on an exercise still win', () => {
    const ctx = context();
    const bench = makeSlot('bench', { main: true }, ctx);
    const crunch = makeSlot('crunch', { main: false }, ctx);
    const w: BuilderWorkout = { restLevel: 'normal', blocks: [{ slots: [bench], auto: false }, { slots: [crunch], auto: false }] };
    expect(steps(settleWarmups(w, ctx))).toEqual([4, 1]);
    expect(steps(settleWarmups(w, { ...ctx, warmups: 'full' }))).toEqual([4, 1]);
    expect(steps(settleWarmups(w, { ...ctx, warmups: 'short' }))).toEqual([2, 0]);
    expect(steps(settleWarmups(w, { ...ctx, warmups: 'none' }))).toEqual([0, 0]);
    // Ben set the crunch's warm-up himself (Your workout): kept under None; the bench's planned ones go.
    const own: BuilderWorkout = { ...w, blocks: [{ slots: [bench], auto: false }, { slots: [{ ...crunch, ownWarmups: true }], auto: false }] };
    expect(steps(settleWarmups(own, { ...ctx, warmups: 'none' }))).toEqual([0, 1]);
  });
});

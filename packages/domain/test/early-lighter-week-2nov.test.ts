import { describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers } from '@fizz/schemas';

import {
  blockWeekSlots,
  buildPlanFromAnswers,
  liftBlockProgress,
  pbAtWeek,
  pbDeloadSkippedBy,
  pbDeloadWeeks,
  pbIsDeload,
  pbPlanChange,
  pbProgWeeks,
  pbWithoutLighterWeeks,
  setRowsFor,
  weekBestSet,
  type BlockBestSet,
  type LiftWeekInput,
  type PbExercise,
  type TrainingBlock,
} from '../src/index';
import { loadInput } from './builder-v3-fixture';
import { BAR, HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben approved LW1–LW3, 2 Nov; docs/training-guides/early-lighter-week.md; supersedes training-blocks Q4.)
 *
 * - LW1: after a lighter week L the plan keeps its length; the next planned deload D becomes a normal week iff
 *   D − L ≤ 3. Later deloads stay. Never ends, restarts or extends. Maintain: only L changes.
 * - LW2: both changes are on the one proposal (`Week 3 of 6 → Lighter`, `Deload: week 6 → none`).
 * - LW3: no catch-up: the planned path doesn't advance in L; the week after is the last build week plus one step; the
 *   lighter week never reads as a stall (`Behind` itself isn't built yet).
 * - Pain: the change never touches pain flags; a normalised week D drafts with the pain cap as any normal week.
 */

const lighter = (a: PlanBuilderAnswers, l: number) => {
  const r = pbPlanChange(a, { kind: 'lighter_week', week: 'this' }, { week: l, leadIn: false });
  if (r.kind !== 'ok') throw new Error(r.line);
  return r;
};

/** Each week 1…N as the result column of the guide's worked examples: `L` lighter, `D` deload, `n` normal. */
const shape = (a: PlanBuilderAnswers): string =>
  Array.from({ length: a.weeks }, (_, i) => i + 1)
    .map((w) => (a.lighterWeeks?.includes(w) === true ? 'L' : pbIsDeload(a, w) ? 'D' : 'n'))
    .join('');

describe('LW1: the guide’s 8 worked examples', () => {
  const cases: { plan: string; a: PlanBuilderAnswers; l: number; skipped: number | null; want: string; lines: string[] }[] = [
    { plan: '6 wk Standard, L3: D6 − 3 = 3 → normal', a: answers({ weeks: 6, effort: 'standard' }), l: 3, skipped: 6, want: 'nnLnnn', lines: ['Week 3 of 6 → Lighter', 'Deload: week 6 → none'] },
    { plan: '6 wk Standard, L2: D6 − 2 = 4 → kept', a: answers({ weeks: 6, effort: 'standard' }), l: 2, skipped: null, want: 'nLnnnD', lines: ['Week 2 of 6 → Lighter'] },
    { plan: '4 wk Standard, L2: D4 − 2 = 2 → normal', a: answers({ weeks: 4, effort: 'standard' }), l: 2, skipped: 4, want: 'nLnn', lines: ['Week 2 of 4 → Lighter', 'Deload: week 4 → none'] },
    { plan: '8 wk Standard, L3: D8 − 3 = 5 → kept', a: answers({ weeks: 8, effort: 'standard' }), l: 3, skipped: null, want: 'nnLnnnnD', lines: ['Week 3 of 8 → Lighter'] },
    { plan: '12 wk Push, L3: D4 → normal; D8, D12 kept', a: answers({ weeks: 12, effort: 'push' }), l: 3, skipped: 4, want: 'nnLnnnnDnnnD', lines: ['Week 3 of 12 → Lighter', 'Deload: week 4 → none'] },
    { plan: '12 wk Push, L6: D8 → normal; D4, D12 kept', a: answers({ weeks: 12, effort: 'push' }), l: 6, skipped: 8, want: 'nnnDnLnnnnnD', lines: ['Week 6 of 12 → Lighter', 'Deload: week 8 → none'] },
    { plan: '12 wk Push, L5 straight after D4: honoured; D8 → normal', a: answers({ weeks: 12, effort: 'push' }), l: 5, skipped: 8, want: 'nnnDLnnnnnnD', lines: ['Week 5 of 12 → Lighter', 'Deload: week 8 → none'] },
    { plan: '8 wk Maintain, L4: only week 4 changes', a: answers({ weeks: 8, effort: 'maintain' }), l: 4, skipped: null, want: 'nnnLnnnn', lines: ['Week 4 of 8 → Lighter'] },
  ];

  for (const c of cases) {
    it(c.plan, () => {
      expect(pbDeloadSkippedBy(c.a, c.l)).toBe(c.skipped);
      const r = lighter(c.a, c.l);
      expect(shape(r.answers)).toBe(c.want);
      // LW2: the card's lines (then the deload shape's line).
      expect(r.lines).toEqual([...c.lines, '−10 % load, 1 set fewer']);
      expect(r.answers.skippedDeloads).toEqual(c.skipped === null ? undefined : [c.skipped]);
      // Never ends, restarts or extends: the plan's length and everything else stay.
      expect(r.answers.weeks).toBe(c.a.weeks);
      expect({ ...r.answers, lighterWeeks: undefined, skippedDeloads: undefined }).toEqual({ ...c.a, lighterWeeks: undefined, skippedDeloads: undefined });
      expect(r.fromWeek).toBe(c.l);
    });
  }

  it('a skipped deload week can itself be asked lighter later (Ben asked); a second lighter week only looks forward', () => {
    const push = answers({ weeks: 12, effort: 'push' });
    const l3 = lighter(push, 3).answers;
    expect(pbDeloadWeeks(l3)).toEqual([3, 8, 12]);
    // Week 4 (the normalised D4) as lighter: honoured; D8 is 4 weeks later, so it stays.
    const l4 = lighter(l3, 4);
    expect(l4.answers).toMatchObject({ lighterWeeks: [3, 4], skippedDeloads: [4] });
    expect(l4.lines).toEqual(['Week 4 of 12 → Lighter', '−10 % load, 1 set fewer']);
    // A lighter week 7 (D8 one week later) drops D8 too; D12 stays.
    const l7 = lighter(l3, 7);
    expect(l7.answers).toMatchObject({ lighterWeeks: [3, 7], skippedDeloads: [4, 8] });
    expect(pbDeloadWeeks(l7.answers)).toEqual([3, 7, 12]);
  });

  it('validity unchanged: a lighter week or a planned deload is refused; the lead-in can’t be lighter', () => {
    const six = answers({ weeks: 6, effort: 'standard' });
    expect(pbPlanChange(six, { kind: 'lighter_week', week: 'this' }, { week: 6, leadIn: false })).toEqual({ kind: 'refused', line: 'Week 6 is already a deload week' });
    const l3 = lighter(six, 3).answers;
    expect(pbPlanChange(l3, { kind: 'lighter_week', week: 'this' }, { week: 3, leadIn: false })).toEqual({ kind: 'refused', line: 'Week 3 is already a deload week' });
    expect(pbPlanChange(six, { kind: 'lighter_week', week: 'this' }, { week: 1, leadIn: true })).toMatchObject({ kind: 'refused' });
  });

  it('a new block starts with neither lighterWeeks nor skippedDeloads', () => {
    const six = answers({ weeks: 6, effort: 'standard' });
    expect(pbWithoutLighterWeeks(lighter(six, 3).answers)).toEqual(six);
  });

  it('a length change keeps a skipped deload only while it is still a planned deload', () => {
    const push = lighter(answers({ weeks: 8, effort: 'push' }), 3).answers;
    expect(push.skippedDeloads).toEqual([4]);
    const longer = pbPlanChange(push, { kind: 'length', weeks: 12 }, { week: 3, leadIn: false });
    expect(longer).toMatchObject({ kind: 'ok', answers: { weeks: 12, lighterWeeks: [3], skippedDeloads: [4] }, lines: ['8 → 12 weeks', 'Deload: week 3, 8 → week 3, 8, 12'] });
    const std = lighter(answers({ weeks: 6, effort: 'standard' }), 3).answers;
    const eight = pbPlanChange(std, { kind: 'length', weeks: 8 }, { week: 3, leadIn: false });
    if (eight.kind !== 'ok') throw new Error(eight.line);
    // Week 6 is no longer a planned deload on an 8-week Standard plan, so the skip goes; D8 is the deload.
    expect(eight.answers.skippedDeloads).toBeUndefined();
    expect(pbDeloadWeeks(eight.answers)).toEqual([3, 8]);
  });
});

describe('LW3: no catch-up after the lighter week', () => {
  const a = answers({ weeks: 6, effort: 'standard', split: 'ppl', sessions: 3, days: [0, 2, 4], lifts: { 'barbell-back-squat': { kind: 'confirmed' } } });
  const plan = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  const bench = plan.days.flatMap((d) => d.exercises).find((e): e is PbExercise => e.role === 'main' && e.key === 'barbell-bench-press');
  if (bench === undefined) throw new Error('no bench');
  const l3 = lighter(a, 3).answers;

  it('the planned path holds through L3: week 4 is week 2 plus one step (not two); the normalised week 6 is a build week', () => {
    expect(pbProgWeeks(l3, 4)).toBe(2);
    expect(pbProgWeeks(l3, 4)).toBe(pbProgWeeks(a, 3));
    const w2 = pbAtWeek(l3, bench, BAR, 2);
    const w3 = pbAtWeek(l3, bench, BAR, 3);
    const w4 = pbAtWeek(l3, bench, BAR, 4);
    expect(w3.deload).toBe(true);
    // Week 4's target is what week 3 would have been without the lighter week: one step on from week 2.
    expect(w4).toEqual({ ...pbAtWeek(a, bench, BAR, 3), week: 4 });
    expect(w4.load ?? 0).toBeGreaterThanOrEqual(w2.load ?? 0);
    const w6 = pbAtWeek(l3, bench, BAR, 6);
    expect(w6.deload).toBe(false);
    expect(w6.load ?? 0).toBeGreaterThanOrEqual(pbAtWeek(l3, bench, BAR, 5).load ?? 0);
    expect(w6.sets).toBe(pbAtWeek(l3, bench, BAR, 5).sets);
  });

  it('the Blocks view reads the lighter week as a deload (never a stall) and the skipped deload as a normal week', () => {
    const tb: Pick<TrainingBlock, 'week' | 'answers' | 'leadInMonday' | 'current' | 'lastWeekTrained'> = {
      week: { week: 4, of: 6, deload: false, done: false, mondays: ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'], daysDone: [[0], [0], [0], [0]] },
      answers: { weeks: 6, effort: 'standard', sessions: 3, lighterWeeks: l3.lighterWeeks, skippedDeloads: l3.skippedDeloads },
      leadInMonday: null,
      current: true,
      lastWeekTrained: true,
    };
    const slots = blockWeekSlots(tb);
    expect(slots.map((s) => s.deload)).toEqual([false, false, true, false, false, false]);
    const best = (v: number, reps: number): BlockBestSet => {
      const b = weekBestSet([{ setType: 'working', load: { value: v, unit: 'kg', convention: 'total' }, reps }], 'load', null, 'kg');
      if (b === null) throw new Error('no best');
      return b;
    };
    const weeks = (deload3: boolean): LiftWeekInput[] => [
      { week: 1, deload: false, reached: true, best: best(100, 6), sets: 3 },
      { week: 2, deload: false, reached: true, best: best(102.5, 6), sets: 3 },
      { week: 3, deload: deload3, reached: true, best: best(92.5, 6), sets: 2 },
      { week: 4, deload: false, reached: true, best: best(102.5, 6), sets: 3 },
    ];
    const p = liftBlockProgress(weeks(slots[2]?.deload === true));
    expect(p.weeks.map((w) => w.state)).toEqual(['base', 'up', 'deload', 'held']);
    expect(p.status).not.toBe('stalled');
    // Were the lighter week read as a build week, the dip would count toward a stall.
    expect(liftBlockProgress(weeks(false)).status).toBe('stalled');
  });
});

describe('pain flags across a lighter week (rule 9)', () => {
  it('the proposal never carries or clears pain; a normalised week D drafts with the pain cap as any normal week', () => {
    const six = answers({ weeks: 6, effort: 'standard' });
    const r = lighter(six, 3);
    expect(Object.keys(r.answers).filter((k) => /pain/i.test(k))).toEqual([]);
    expect(pbIsDeload(r.answers, 6)).toBe(false);
    // Week 6 is a normal week (no deload flag on the slot's loads); the held movement stays at its cap, never above.
    const rows = setRowsFor({ main: true, role: 'compound', barbell: true, workingSets: 3, repRange: { min: 6, max: 8 }, load: loadInput({ ruleTarget: { value: 105, reps: 6, rpe: 8 }, painCap: 100 }) }).rows;
    const working = rows.filter((x) => x.type !== 'warmup').map((x) => x.load ?? 0);
    expect(Math.max(...working)).toBeLessThanOrEqual(100);
  });
});

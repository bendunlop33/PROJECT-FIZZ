import { describe, expect, it } from 'vitest';

import type { PlanBuilderAnswers, PlanDraft } from '@fizz/schemas';

import {
  applyPlan,
  blockOf,
  blocksView,
  blockWeekSlots,
  buildPlanFromAnswers,
  liftBlockDetailView,
  liftInBlock,
  pbNewPlanDraft,
  planBlockLine,
  planMainLiftIds,
  thisBlockView,
  trainingBlocks,
  type BlockSession,
  type PbFinishedRef,
} from '../src/index';
import { OWNER, TZ } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';

/**
 * (Ben, 31 Oct; block-progress.md) Every block kept, worked out from the stored plan documents (never stored): a
 * document continuing a block (`applied.block`) joins it; any other applied document starts one (plans applied
 * before blocks existed included). Sessions in a block's weeks count for its lifts, off-plan ones too.
 */

const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (utc: string) => ({ utc, tz: TZ });

function draft(n: number, utc: string, over: Partial<PlanBuilderAnswers>): PlanDraft {
  const a = answers({ split: 'ul', sessions: 4, ...over });
  const built = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  return pbNewPlanDraft({ plan: built, answers: a, kitOf: KIT_OF, ownerId: OWNER, gymId: null, equipmentVersion: 'v1', opId: op(n), at: at(utc) });
}

function apply(p: PlanDraft, n: number, utc: string, inUse: readonly PlanDraft[] = []): { plan: PlanDraft; superseded: PlanDraft[] } {
  const r = applyPlan(p, { expectedVersion: p.version, versionN: p.currentVersion, mode: 'replace', opId: op(n), at: at(utc), live: [], applied: inUse });
  if (r.kind !== 'write') throw new Error(r.kind);
  return { plan: r.next, superseded: r.supersede.map((x) => x.next) };
}

const ref = (p: PlanDraft, i: number, utc: string): PbFinishedRef => ({ routineId: null, startedAtUtc: utc, planDay: { planId: p.id, dayIndex: i } });
const ms = (iso: string) => Date.parse(iso);
/** 00:00 UTC is midday in Auckland (NZST / NZDT): the same local date. */
const noonNz = (date: string) => `${date}T00:00:00.000Z`;

let sid = 0;
function session(date: string, exerciseId: string, sets: [number, number][], over: { convention?: 'total' | 'per_hand' } = {}): BlockSession {
  sid += 1;
  return {
    sessionId: `s${String(sid)}`,
    startedAtUtc: noonNz(date),
    date,
    exercises: [{ exerciseId, exerciseName: 'Bench press', equipmentKind: 'barbell', convention: over.convention ?? 'total', unit: 'kg', sets: sets.map(([v, r]) => ({ setType: 'working' as const, load: { value: v, unit: 'kg' as const, convention: over.convention ?? 'total' }, reps: r })) }],
  };
}

/**
 * Block 1 · Strength (4 wk, Maintain) applied Mon 3 Aug; block 2 · Muscle (6 wk) Mon 7 Sep; block 3 · Muscle applied
 * Wed 21 Oct (a lead-in week, week 1 = Mon 26 Oct), re-applied Wed 4 Nov (continues block 3). Now: Thu 12 Nov, week 3.
 */
function history() {
  const b1 = apply(draft(1, noonNz('2026-08-03'), { weeks: 4, effort: 'maintain', focus: 'strength' }), 2, noonNz('2026-08-03')).plan;
  const two = apply(draft(3, noonNz('2026-09-07'), { weeks: 6, effort: 'standard', focus: 'muscle' }), 4, noonNz('2026-09-07'), [b1]);
  const b1s = two.superseded[0] as PlanDraft;
  const b2 = two.plan;
  const three = apply(draft(5, noonNz('2026-10-21'), { weeks: 6, effort: 'standard', focus: 'muscle' }), 6, noonNz('2026-10-21'), [b2]);
  const b2s = three.superseded[0] as PlanDraft;
  const again = apply(draft(7, noonNz('2026-11-04'), { weeks: 6, effort: 'standard', focus: 'muscle' }), 8, noonNz('2026-11-04'), [three.plan]);
  const b3s = again.superseded[0] as PlanDraft;
  const b3 = again.plan;
  const bench = planMainLiftIds(b3)[0] as string;
  const refs: PbFinishedRef[] = [];
  const sessions: BlockSession[] = [];
  const log = (p: PlanDraft, date: string, sets: [number, number][], planDay = true) => {
    if (planDay) refs.push(ref(p, 0, noonNz(date)));
    sessions.push(session(date, bench, sets));
  };
  // Earlier training: before any plan.
  log(b1, '2026-07-20', [[85, 5]], false);
  // Block 1: weeks of 3, 10, 17, 24 Aug.
  log(b1, '2026-08-04', [[90, 5]]);
  log(b1, '2026-08-11', [[92.5, 5]]);
  log(b1, '2026-08-18', [[95, 5]]);
  log(b1, '2026-08-25', [[97.5, 5]]);
  // Block 2: 7 Sep … 12 Oct (week 6 deload).
  log(b2, '2026-09-08', [[92.5, 8]]);
  log(b2, '2026-09-15', [[95, 8]]);
  log(b2, '2026-09-22', [[97.5, 8]]);
  log(b2, '2026-09-29', [[100, 8]]);
  log(b2, '2026-10-06', [[100, 8]]);
  log(b2, '2026-10-13', [[90, 6]]);
  // Block 3: lead-in Thu 22 Oct; week 1 (26 Oct) 100×6; week 2 (2 Nov) 102.5×6 off-plan; week 3 (9 Nov) 105×6 on the re-applied plan.
  log(three.plan, '2026-10-22', [[97.5, 6]]);
  log(three.plan, '2026-10-27', [[100, 6]]);
  refs.push(ref(three.plan, 1, noonNz('2026-11-03')));
  sessions.push(session('2026-11-04', bench, [[102.5, 6]]));
  log(b3, '2026-11-10', [[105, 6]]);
  return { plans: [b1s, b2s, b3s, b3], refs, sessions, bench, ids: { b1: b1.id, b2: b2.id, b3a: three.plan.id, b3: b3.id } };
}

const NOW_MS = ms('2026-11-12T00:00:00.000Z');
const nameOf = () => 'Bench press';

describe('trainingBlocks: identified from the plan documents', () => {
  it('three blocks, oldest first; the re-apply joins block 3; only block 3 is current', () => {
    const h = history();
    const blocks = trainingBlocks(h.plans, h.refs, NOW_MS, TZ);
    expect(blocks.map((b) => [b.n, b.goal, b.current])).toEqual([
      [1, 'Strength', false],
      [2, 'Muscle', false],
      [3, 'Muscle', true],
    ]);
    expect(blocks[2]?.planIds).toEqual([h.ids.b3a, h.ids.b3]);
    expect(blocks[2]?.key).toBe(h.ids.b3a);
    expect(blocks[0]?.endedAtUtc).toBe(noonNz('2026-09-07'));
    // The current block: lead-in Mon 19 Oct, week 3 of 6.
    expect(blocks[2]?.leadInMonday).toBe('2026-10-19');
    expect(blocks[2]?.week).toMatchObject({ week: 3, of: 6, done: false });
    expect(blocks[0]?.week).toMatchObject({ done: true, of: 4 });
  });

  it('a plan applied before blocks existed (no block field) is its own block; any order of documents', () => {
    const h = history();
    const blocks = trainingBlocks([...h.plans].reverse(), h.refs, NOW_MS, TZ);
    expect(blocks.map((b) => b.planIds.length)).toEqual([1, 1, 2]);
  });

  it('the lead-in is week 0, shown as Lead-in, never week 1; the deload week is marked', () => {
    const h = history();
    const blocks = trainingBlocks(h.plans, h.refs, NOW_MS, TZ);
    const slots = blockWeekSlots(blocks[2] as NonNullable<(typeof blocks)[2]>);
    expect(slots.map((s) => [s.week, s.reached, s.deload])).toEqual([
      [0, true, false],
      [1, true, false],
      [2, true, false],
      [3, true, false],
      [4, false, false],
      [5, false, false],
      [6, false, true],
    ]);
    const lift = liftInBlock(blocks[2] as NonNullable<(typeof blocks)[2]>, h.bench, h.sessions, nameOf);
    expect(lift.progress.first?.value).toBe(100);
    const detail = liftBlockDetailView(lift);
    expect(detail.table.map((r) => [r.week, r.topSet])).toEqual([
      ['Lead-in', '97.5×6 kg'],
      ['1', '100×6 kg'],
      ['2', '102.5×6 kg'],
      ['3', '105×6 kg'],
    ]);
    expect(detail.table[1]?.e1rm).toBe('120 est.');
    expect(detail.chart.map((c) => c.label)).toEqual(['Lead-in', 'W1', 'W2', 'W3']);
  });
});

describe('the views', () => {
  it('This block: Week 3 of 6, bench 100×6 → 105×6 kg, +5%, an off-plan workout counted', () => {
    const h = history();
    const blocks = trainingBlocks(h.plans, h.refs, NOW_MS, TZ);
    const v = thisBlockView(blockOf(blocks, null) as NonNullable<ReturnType<typeof blockOf>>, h.sessions, nameOf, TZ);
    expect(v.title).toBe('This block');
    expect(v.meta).toBe('Week 3 of 6');
    const bench = v.rows.find((r) => r.exerciseId === h.bench);
    expect(bench).toMatchObject({ line: '100×6 → 105×6 kg', delta: '+5%', stalled: false, gain: true });
    expect(bench?.bars.map((b) => b.state)).toEqual(['up', 'up', 'up', 'none', 'none', 'deload']);
    expect(planBlockLine(v)).toBe(`${String(v.up)} ${v.up === 1 ? 'lift' : 'lifts'} up`);
  });

  it('a past block opens the same view: Block 2 · Muscle with its dates; a stall in it', () => {
    const h = history();
    const blocks = trainingBlocks(h.plans, h.refs, NOW_MS, TZ);
    const v = thisBlockView(blockOf(blocks, blocks[1]?.key ?? '') as NonNullable<ReturnType<typeof blockOf>>, h.sessions, nameOf, TZ);
    expect(v.title).toBe('Block 2 · Muscle');
    expect(v.meta).toBe('7 Sep – 18 Oct');
    const bench = v.rows.find((r) => r.exerciseId === h.bench);
    // 92.5, 95, 97.5, 100, 100 (held), deload: up overall.
    expect(bench?.bars.map((b) => b.state)).toEqual(['up', 'up', 'up', 'up', 'up', 'deload']);
    expect(bench?.line).toBe('92.5×8 → 100×8 kg');
  });

  it('Blocks: newest first, Now on the current; X of Y sessions; N up · M stalled · biggest gain; Earlier training last', () => {
    const h = history();
    const blocks = trainingBlocks(h.plans, h.refs, NOW_MS, TZ);
    const v = blocksView({ blocks, sessions: h.sessions, nameOf, tz: TZ, compareLift: null });
    expect(v.rows.map((r) => r.title)).toEqual(['Block 3 · Muscle', 'Block 2 · Muscle', 'Block 1 · Strength', 'Earlier training']);
    expect(v.rows[0]).toMatchObject({ tag: 'Now', sub: '21 Oct – 6 Dec · week 3 of 6' });
    expect(v.rows[1]?.sub).toBe('7 Sep – 18 Oct · 6 of 24 sessions');
    expect(v.rows[1]?.facts).toContain('Bench press +7.5 kg');
    expect(v.rows[2]?.sub).toBe('3 Aug – 30 Aug · 4 of 16 sessions');
    expect(v.rows[2]?.facts).toContain('Bench press +7.5 kg');
    expect(v.rows[3]).toMatchObject({ opens: false, sub: '20 Jul – 20 Jul · 1 session' });
  });

  it('cross-block comparison: rep ranges differ (5, 8, 6) → Est. 1RM, labelled est.', () => {
    const h = history();
    const blocks = trainingBlocks(h.plans, h.refs, NOW_MS, TZ);
    const v = blocksView({ blocks, sessions: h.sessions, nameOf, tz: TZ, compareLift: h.bench });
    expect(v.compare?.byEstimate).toBe(true);
    expect(v.compare?.rows.map((r) => r.block)).toEqual(['1 · Strength', '2 · Muscle', '3 · Muscle']);
    for (const r of v.compare?.rows ?? []) {
      expect(r.start).toMatch(/ est\.$/);
      expect(r.end).toMatch(/ est\.$/);
    }
    expect(v.compare?.rows[2]?.change).toBe('+5%');
  });

  it('the same rep range: best sets compared as they are', () => {
    const h = history();
    const blocks = trainingBlocks(h.plans, h.refs, NOW_MS, TZ).slice(0, 1);
    const v = blocksView({ blocks, sessions: h.sessions, nameOf, tz: TZ, compareLift: h.bench });
    expect(v.compare?.byEstimate).toBe(false);
    expect(v.compare?.rows[0]).toMatchObject({ start: '90×5 kg', end: '97.5×5 kg' });
  });

  it('a stall in the current block: Stalled 2 weeks and the running line', () => {
    const h = history();
    const sessions = h.sessions.map((s) => (s.date === '2026-11-04' || s.date === '2026-11-10' ? session(s.date, h.bench, [[100, 6]]) : s));
    const blocks = trainingBlocks(h.plans, h.refs, NOW_MS, TZ);
    const b = blockOf(blocks, null) as NonNullable<ReturnType<typeof blockOf>>;
    const row = thisBlockView(b, sessions, nameOf, TZ).rows.find((r) => r.exerciseId === h.bench);
    expect(row).toMatchObject({ stalled: true, delta: null });
    const d = liftBlockDetailView(liftInBlock(b, h.bench, sessions, nameOf));
    expect(d.pill).toEqual({ text: 'Stalled 2 weeks', tone: 'stalled' });
    expect(d.line).toBe('Top set 100×6 kg, 3 weeks running.');
    expect(planBlockLine({ up: 0, stalled: 1 })).toBe('1 stalled');
  });

  it('nothing up or stalled yet: no Library line', () => {
    expect(planBlockLine({ up: 0, stalled: 0 })).toBeNull();
    expect(planBlockLine(null)).toBeNull();
  });
});

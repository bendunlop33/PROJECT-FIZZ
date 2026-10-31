import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP, planTabView, type PlanTabView } from '@fizz/domain';

import { librarySegmentAtOpen } from '../src/library/plan-tab-view';
import type { AppServices } from '../src/services/app-services';
import type { PlanOverviewWithBlock } from '../src/services/plan-services';
import type { TodaySessionData } from '../src/services/today-session';
import { finishWorkout } from './finish-workout';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 27 Oct: "don't really understand this page. Seems poorly designed.") Library › Plan v2 (plan-tab-v2.md) end
 * to end on real SQLite, offline: the overview joins each plan day to its workout (no extra reads per row), so the
 * page shows **one** list: Push ✓ with its date, Up next, `Week 1 of 6 · deload in week 6`; a past week keeps its
 * ticks; a day opened from another week shows that week's planned targets; a force-close shows the same page. And
 * the screen's structure: the duplicate rotation list and the big `Edit plan` button are gone, every action stays.
 */

const SRC = join(import.meta.dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

let h: Harness;
beforeEach(() => {
  // Monday 19 Oct 2026.
  h = createHarness('2026-10-19T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

/** Today's Push card committed, started and finished. */
async function doPush(s: AppServices, gymId: string): Promise<void> {
  const data = await loaded(s);
  const day = data.days.find((d) => d.name === 'Push');
  const controls = day === undefined ? undefined : data.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error('no Push day');
  const c = await s.todaySession.commit(data, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  await finishWorkout(h, s, r.aggregate.session.id);
}

function nextMonday(): void {
  const now = new Date(h.clockMs);
  const back = (now.getUTCDay() + 6) % 7;
  h.clockMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + 7, 7);
}

/** What the page draws: the same call `YourPlanBlock` makes. */
function pageOf(ov: PlanOverviewWithBlock | null, selected: number | null = null): PlanTabView {
  if (ov === null) throw new Error('no plan');
  const b = ov.block ?? null;
  return planTabView({ overview: ov, block: b === null ? null : { views: b.views, current: b.current, done: b.done, editable: b.editable, actions: b.actions }, selected });
}

describe('Library › Plan v2: one list', () => {
  it('a builder plan: one row per day with its workout, ✓ with the date, Up next, weeks; past weeks keep ticks; force-close safe', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no builder');
    const a = { ...session.answers, split: 'ppl' as const, sessions: 3, days: [0, 2, 4] };
    const built = await s.planBuilder.save(session, a, null, h.ids());
    if (!built.ok) throw new Error('not built');
    const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
    if (!applied.ok) throw new Error('not applied');

    let ov = await s.plans.overview();
    // Every plan day's workout knows its plan day, so the page joins them without a read per row.
    expect(ov?.days.every((d) => d.dayIndex !== null)).toBe(true);
    let page = pageOf(ov);
    expect(page.line).toBe('Week 1 of 6 · deload in week 6');
    expect(page.chips?.map((c) => c.label)).toEqual(['1', '2', '3', '4', '5', '6 · Deload']);
    expect(page.chips?.find((c) => c.week === 1)).toMatchObject({ current: true, selected: true });
    expect(page.rows.map((r) => r.name)).toEqual(ov?.block?.views[0]?.days.map((d) => d.name));
    expect(page.rows.every((r) => r.routineId !== null && r.sub !== null)).toBe(true);
    // Each day once, each opening its own workout.
    expect(new Set(page.rows.map((r) => r.routineId)).size).toBe(page.rows.length);
    expect(page.rows.filter((r) => r.state === 'next')).toHaveLength(1);
    // This week's not-done days carry Do today (their Today key).
    expect(page.rows.every((r) => r.actions?.todayKey.startsWith(`plan:${built.planId}:`) === true)).toBe(true);

    // Push done on Monday: ✓ with its date; its actions go (rule 2: a done day never moves).
    await doPush(s, gymId);
    ov = await s.plans.overview();
    page = pageOf(ov);
    const push = page.rows.find((r) => r.name === 'Push');
    expect(push).toMatchObject({ state: 'done', actions: null });
    expect(plain(push?.trailing)).toBe('Mon 19 Oct');
    expect(page.listTitle).toBe('This week');
    expect(page.listMeta).toMatch(/^1 of \d days/);

    // Next week: week 2 is current; week 1 still shows Push ✓ with its date; this week's Push is to do again.
    nextMonday();
    ov = await s.plans.overview();
    page = pageOf(ov);
    expect(page.line).toBe('Week 2 of 6 · deload in week 6');
    expect(page.rows.find((r) => r.name === 'Push')?.state).not.toBe('done');
    const week1 = pageOf(ov, 1);
    expect(week1.listTitle).toBe('Week 1');
    expect(week1.chips?.find((c) => c.week === 1)).toMatchObject({ done: true, selected: true, current: false });
    expect(week1.chips?.find((c) => c.week === 2)).toMatchObject({ current: true, selected: false });
    expect(plain(week1.rows.find((r) => r.name === 'Push')?.trailing)).toBe('Mon 19 Oct');
    expect(week1.rows.every((r) => r.state !== 'next' && r.actions === null)).toBe(true);

    // A day opened from week 6: that week's planned targets (the old inline day card); from this week: Start's plan.
    const pushId = page.rows.find((r) => r.name === 'Push')?.routineId ?? '';
    const day6 = await s.plans.planDay(pushId, { targetsHit: false, week: 6 });
    expect(day6?.week?.header).toBe('Week 6 of 6 · Deload');
    expect(day6?.week?.note).toBe('Deload: lighter, fewer sets');
    expect(day6?.week?.rows.map((r) => r.name)).toEqual(ov?.block?.views[5]?.days.find((d) => d.name === 'Push')?.rows.map((r) => r.name));
    expect((await s.plans.planDay(pushId, { targetsHit: false, week: 2 }))?.week).toBeNull();
    expect((await s.plans.planDay(pushId))?.week).toBeNull();

    // Force-close: the same page.
    const before = JSON.stringify(pageOf(ov, 1));
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(JSON.stringify(pageOf(await s2.plans.overview(), 1))).toBe(before);
  });
});

describe('Library › Plan v2: the screen', () => {
  const block = code(read('screens/library/YourPlanBlock.tsx'));
  const tab = code(read('screens/library/PlanTab.tsx'));

  it('one list: no week-strip day cards and no second rotation list (the plan days only in Change plan)', () => {
    expect(block).not.toContain('PlanWeeksBlock');
    expect(block.match(/view\.rows\.map\(/g)).toHaveLength(1);
    expect(block).toContain('planTabView(');
    // (Redesign D4) The plan's days feed Change plan's `A day's exercises` only, never a second list on the page.
    expect(block.match(/plan\.days\.map\(/g)).toHaveLength(1);
    expect(block).toContain('changePlanView({');
  });

  it('every action stays reachable (redesign 27 Oct D1–D4): ⋯ Pause / Ask coach; Changes row; Edit plan at the bottom → Change plan; rows swipe', () => {
    expect(block).toContain('planTabEditAction(view)');
    expect(block).toContain('openNextBlock(plan.planId)');
    expect(block).toContain("openPlanChange(plan.planId, a.kind === 'week' ? 'week' : 'goals')");
    for (const k of ["item.kind === 'pause'", "item.kind === 'resume'", "navigation.navigate('Coach'", '<ChangePlanSheet', '<EditPlanButton', "stack.navigate('LibraryChanges')", '<WeekCircles', 'void end();']) expect(block).toContain(k);
    // Do today (leading swipe) and Move (trailing swipe), the same in ⋯, long-press and VoiceOver actions.
    expect(block).toContain('<SwipeRow');
    expect(block).toMatch(/rightAction: \{ label: today\.label/);
    expect(block).toMatch(/leftAction: \{ label: PLAN_TAB_VIEW_COPY\.move, tone: 'accent'/);
    expect(block).toContain('holdProps={{ onLongPress: onMore }}');
    expect(block).toContain("if (kind === 'today') doToday(row);");
    expect(block).toContain("else if (kind === 'move') setMoving(row.dayIndex);");
    expect(block).toContain("stack.navigate('LibraryPlanDay'");
    expect(block).toContain('<LiftTargetsBlock onToast={onToast} />');
    expect(block).toContain('undoWeek(plan.weekChange)');
  });

  it('with a plan in use Library opens on Plan; a link’s segment wins; without a plan the remembered one', () => {
    expect(librarySegmentAtOpen({ asked: undefined, remembered: 'exercises', planInUse: true, plan: 'plan' })).toBe('plan');
    expect(librarySegmentAtOpen({ asked: 'workouts', remembered: 'exercises', planInUse: true, plan: 'plan' })).toBe('workouts');
    expect(librarySegmentAtOpen({ asked: undefined, remembered: 'exercises', planInUse: false, plan: 'plan' })).toBe('exercises');
    const lib = code(read('screens/library/LibraryScreen.tsx'));
    expect(lib).toContain('services.plans');
    expect(lib).toContain('librarySegmentAtOpen(');
    // Ben's own pick before the read lands is kept; the remembered pref isn't overwritten by the default.
    expect(lib).toContain('picked.current = true;');
  });

  it('the scroll area draws a hairline at its top edge once scrolled (nothing reads as clipped by the segmented control)', () => {
    expect(tab).toContain('onScroll=');
    expect(tab).toMatch(/scrolled \? <View pointerEvents="none"/);
  });
});

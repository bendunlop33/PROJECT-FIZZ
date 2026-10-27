import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { NBSP, NO_FILTERS, withBroadGroup } from '@fizz/domain';

import { parsePrefs } from '../src/device/prefs';
import { PLAN_TAB_COPY, planSetupRoute } from '../src/library/plan-tab-view';
import { openPlanSetup, openYourPlan } from '../src/navigation/actions';
import type { AppServices } from '../src/services/app-services';
import { LIBRARY_BROWSE_COPY, muscleChips } from '../src/workout/library-browse-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Library › Plan (Ben, 22 Oct; review gaps V1): the tabs `Plan | Workouts |
 * Exercises`, Your plan moved there, `Set up a plan ›` never a dead end,
 * Previous plans with `Start again` (a copy applied with Undo, rule 2, 5),
 * Today's / Profile's plan links landing on it, and Exercises' D5 muscle
 * chips. Real SQLite and a scripted model only for building the plans.
 */

const SRC = join(import.meta.dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const plain = (s: string) => s.replaceAll(NBSP, ' ');
const DAY = 86_400_000;

describe('tabs, links and the set-up hook', () => {
  it('Plan | Workouts | Exercises, remembered on this phone (an unknown value falls back)', () => {
    expect(LIBRARY_BROWSE_COPY.segments.map((s) => s.label)).toEqual(['Plan', 'Workouts', 'Exercises']);
    expect(parsePrefs('{"librarySegment":"plan"}').librarySegment).toBe('plan');
    expect(parsePrefs('{"librarySegment":"workouts"}').librarySegment).toBe('workouts');
    expect(parsePrefs('{"librarySegment":"exercises"}').librarySegment).toBe('exercises');
    // (Ben, 23 Oct) Library opens on Plan until he picks another segment.
    expect(parsePrefs('{"librarySegment":"nope"}').librarySegment).toBe('plan');
    expect(parsePrefs(null).librarySegment).toBe('plan');
  });

  it('Profile’s `Set by your plan` opens Library › Plan; Today’s `Set up a plan ›` opens the plan builder (23 Oct)', () => {
    expect(openYourPlan('t1').payload.params).toEqual({ screen: 'Library', params: { screen: 'LibraryHome', params: { segment: 'plan', plan: 't1' }, pop: true } });
    expect(openPlanSetup()).toEqual({ type: 'NAVIGATE', payload: { name: 'PlanSetup' } });
    const today = code(read('screens/TodayScreen.tsx'));
    expect(today.match(/navigation\.dispatch\(openPlanSetup\(\)\)/g)).toHaveLength(1);
    expect(today).not.toMatch(/navigate\('Coach'[^)]*Build me a plan/);
    // (Ben, 23 Oct: plan length = block 1) Today's only way to Your plan is the block week in the header, never Set up.
    expect(today.match(/openYourPlan\(/g)).toHaveLength(1);
    expect(today).toMatch(/onRight=\{\(\) => \{\s*navigation\.dispatch\(openYourPlan\(newUuid\(\)\)\);/);
    expect(code(read('screens/profile/SplitScreen.tsx'))).toContain('navigation.dispatch(openYourPlan(newUuid()))');
  });

  it('`Set up a plan ›`: the plan builder; the coach (or Connect) only as the fallback when the builder is missing', () => {
    expect(planSetupRoute({ status: 'ok', model: 'm' })).toEqual({ kind: 'builder' });
    expect(planSetupRoute(null)).toEqual({ kind: 'builder' });
    expect(planSetupRoute({ status: 'not_connected', model: null }, true)).toEqual({ kind: 'builder' });
    // Fallback (never a dead end): the coach with `Build me a plan` when it can answer, else the short state and Connect.
    expect(planSetupRoute({ status: 'ok', model: 'm' }, false)).toEqual({ kind: 'coach', draft: 'Build me a plan' });
    expect(planSetupRoute({ status: 'offline', model: 'm' }, false)).toEqual({ kind: 'coach', draft: 'Build me a plan' });
    expect(planSetupRoute({ status: 'not_connected', model: null }, false)).toEqual({ kind: 'connect', state: 'Coach not connected' });
    expect(planSetupRoute(null, false)).toEqual({ kind: 'connect', state: 'Coach not connected' });
    expect(planSetupRoute({ status: 'limit', model: 'm' }, false)).toEqual({ kind: 'connect', state: 'Coach paused' });
    // One hook: the tab routes only through it; the builder through `openPlanSetup`, the coach gets the draft, not a sent message.
    const tab = code(read('screens/library/PlanTab.tsx'));
    expect(tab.match(/function setUpPlan\(/g)).toHaveLength(1);
    expect(tab).toContain("if (route.kind === 'builder') navigation.dispatch(openPlanSetup());");
    expect(tab).toContain("navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true, draft: route.draft })");
    expect(tab).toContain("screen: 'CoachConnection'");
    expect(tab).not.toMatch(/coach\.send\(/);
  });

  it('Your plan lives on Library › Plan, not on Workouts', () => {
    expect(code(read('screens/library/PlanTab.tsx'))).toContain('<YourPlanBlock plan={plan} onToast={setToast} />');
    expect(code(read('screens/routines/WorkoutsScreen.tsx'))).not.toContain('YourPlanBlock');
    expect(code(read('screens/library/LibraryScreen.tsx'))).toContain('<PlanTab scrollTopKey={route.params?.plan} />');
  });

  it('copy is minimal: values and actions', () => {
    expect(Object.values(PLAN_TAB_COPY).every((t) => t.length <= 30)).toBe(true);
  });
});

describe('Exercises: muscle chips, All + six broad groups (D5)', () => {
  it('one chip on; each group filters by its detailed groups; All clears; other filters kept', () => {
    expect(muscleChips(NO_FILTERS).map((c) => [c.label, c.selected])).toEqual([
      ['All', true],
      ['Chest', false],
      ['Back', false],
      ['Shoulders', false],
      ['Legs', false],
      ['Arms', false],
      ['Core', false],
    ]);
    const legs = withBroadGroup({ ...NO_FILTERS, atGym: true }, 'Legs');
    expect(legs).toEqual({ ...NO_FILTERS, atGym: true, muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves'] });
    expect(muscleChips(legs).filter((c) => c.selected).map((c) => c.label)).toEqual(['Legs']);
    expect(withBroadGroup(legs, 'Arms').muscles).toEqual(['Biceps', 'Triceps', 'Forearms']);
    expect(withBroadGroup(legs, null)).toEqual({ ...NO_FILTERS, atGym: true });
  });
});

// ---------------------------------------------------------------------------

let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 12 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-12T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}

const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const stubOf =
  (days: [string, string[]][]) =>
  (req: ModelRequest): ModelEvent[] => {
    const usable = usableOf(req);
    const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
    return toolCall('propose_plan', { days: days.map(([dayName, exs]) => ({ dayName, splitDayId: null, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Your week.', minutes: null, gymName: null });
  };
const PPL: [string, string[]][] = [
  ['Push', ['Bench press']],
  ['Pull', ['Lat pulldown']],
  ['Legs', ['Back squat']],
];
const UPPER_LOWER: [string, string[]][] = [
  ['Upper', ['Overhead press']],
  ['Lower', ['Back squat']],
];

async function buildAndApply(s: AppServices, days: [string, string[]][], opId: string): Promise<string> {
  model = new StepModel([stubOf(days), () => replyWith('Here is your week.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: `Build me a ${String(days.length)}-day plan`, spoken: false }, turnId: h.ids() });
  const card = r.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId })).toMatchObject({ ok: true });
  return planId;
}

async function endInUse(s: AppServices, opId: string): Promise<void> {
  const v = await s.plans.overview();
  if (v === null) throw new Error('no plan in use');
  expect(await s.plans.end({ planId: v.planId, expectedVersion: v.planVersion, opId })).toMatchObject({ ok: true });
}

const rotation = async (s: AppServices) => (await s.routines.list()).filter((r) => r.inRotation).sort((a, b) => (a.rotationAtUtc < b.rotationAtUtc ? -1 : 1)).map((r) => r.name);

describe('Previous plans and Start again (Ben, 22–23 Oct, D7)', () => {
  it('ended plan → Previous → Start again (retry replays, stale refused) → in use → force-close → Undo → listed again', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    expect(await s.plans.previous()).toEqual([]);
    const planId = await buildAndApply(s, PPL, 'apply-ppl');
    // In use: not previous.
    expect(await s.plans.previous()).toEqual([]);
    h.clockMs += 7 * DAY;
    await endInUse(s, 'end-ppl');
    expect(await s.plans.overview()).toBeNull();

    const prev = await s.plans.previous();
    expect(prev.map((p) => [p.planId, p.name, plain(p.line)])).toEqual([[planId, '3-day plan', 'Push / Pull / Legs · ended 19 Oct']]);
    const row = prev[0];
    if (row === undefined) throw new Error('row');

    // A stale row (read before a later write) changes nothing (rule 5).
    expect(await s.plans.startAgain({ planId, expectedVersion: row.planVersion - 1, mode: 'replace', opId: 'again-stale' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await s.plans.overview()).toBeNull();

    h.clockMs += DAY;
    const req = { planId, expectedVersion: row.planVersion, mode: 'replace' as const, opId: 'again-1' };
    const again = await s.plans.startAgain(req);
    expect(again).toMatchObject({ ok: true, duplicate: false, plan: { status: 'applied', name: '3-day plan', restartedFrom: { planId } } });
    if (!again.ok) throw new Error('again');
    expect(again.plan.id).not.toBe(planId);
    // A retried tap is the same write.
    expect(await s.plans.startAgain(req)).toMatchObject({ ok: true, duplicate: true, plan: { id: again.plan.id } });
    // In use again: Your plan on Library › Plan, its days in the rotation; the source stays ended and leaves Previous.
    expect(await s.plans.overview()).toMatchObject({ planId: again.plan.id, name: '3-day plan' });
    expect(await rotation(s)).toEqual(['Push', 'Pull', 'Legs']);
    expect(await s.plans.previous()).toEqual([]);
    expect((await s.plans.get(planId))?.status).toBe('ended');

    // Force-close: still in use.
    await h.forceClose();
    const s2 = (await h.launch()).services;
    expect((await s2.plans.overview())?.planId).toBe(again.plan.id);

    // Undo (the toast's): no plan in use, the copy's workouts gone, the plan back in Previous.
    const undo = { planId: again.plan.id, expectedVersion: again.plan.version, opId: 'again-undo' };
    expect(await s2.plans.undo(undo)).toMatchObject({ ok: true });
    expect(await s2.plans.undo(undo)).toMatchObject({ ok: true, duplicate: true });
    expect(await s2.plans.overview()).toBeNull();
    expect(await rotation(s2)).toEqual([]);
    expect((await s2.plans.previous()).map((p) => p.planId)).toEqual([planId]);
  });

  it('with another plan in use: Start again replaces it; Undo puts it back. Previous lists each plan once, newest end first', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const ppl = await buildAndApply(s, PPL, 'apply-ppl');
    h.clockMs += DAY;
    // A newer plan's Apply ends the first (superseded): it is a previous plan too.
    const ul = await buildAndApply(s, UPPER_LOWER, 'apply-ul');
    let prev = await s.plans.previous();
    expect(prev.map((p) => p.planId)).toEqual([ppl]);
    expect(plain(prev[0]?.line ?? '')).toBe('Push / Pull / Legs · ended 13 Oct');

    h.clockMs += DAY;
    const row = prev[0];
    if (row === undefined) throw new Error('row');
    const again = await s.plans.startAgain({ planId: ppl, expectedVersion: row.planVersion, mode: 'replace', opId: 'again-ppl' });
    if (!again.ok) throw new Error(again.message);
    expect((await s.plans.overview())?.planId).toBe(again.plan.id);
    expect((await s.plans.get(ul))?.status).toBe('superseded');
    expect(await rotation(s)).toEqual(['Push', 'Pull', 'Legs']);
    // Upper/Lower is now previous; PPL shows once (as its copy is in use, not at all).
    prev = await s.plans.previous();
    expect(prev.map((p) => p.planId)).toEqual([ul]);

    // Undo: Upper/Lower in use again, as it was.
    expect(await s.plans.undo({ planId: again.plan.id, expectedVersion: again.plan.version, opId: 'again-ppl-undo' })).toMatchObject({ ok: true });
    expect((await s.plans.overview())?.planId).toBe(ul);
    expect(await rotation(s)).toEqual(['Upper', 'Lower']);
    expect((await s.plans.previous()).map((p) => p.planId)).toEqual([ppl]);

    // Start again, then End the copy: Previous lists PPL once, as the copy (the newest run).
    const row2 = (await s.plans.previous())[0];
    if (row2 === undefined) throw new Error('row2');
    h.clockMs += DAY;
    const again2 = await s.plans.startAgain({ planId: ppl, expectedVersion: row2.planVersion, mode: 'add', opId: 'again-ppl-2' });
    if (!again2.ok) throw new Error(again2.message);
    h.clockMs += DAY;
    await endInUse(s, 'end-copy');
    prev = await s.plans.previous();
    expect(prev.map((p) => p.planId)).toEqual([again2.plan.id, ul]);
  });

  it('a plan that isn’t Ben’s or doesn’t exist, or one still in use, is refused and nothing changes', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    expect(await s.plans.startAgain({ planId: 'nope', expectedVersion: 1, mode: 'replace', opId: 'x' })).toMatchObject({ ok: false, reason: 'missing' });
    const ppl = await buildAndApply(s, PPL, 'apply-ppl');
    const inUse = await s.plans.get(ppl);
    expect(await s.plans.startAgain({ planId: ppl, expectedVersion: inUse?.version ?? 0, mode: 'replace', opId: 'y' })).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.plans.overview())?.planId).toBe(ppl);
  });
});

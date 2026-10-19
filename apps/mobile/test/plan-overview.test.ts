import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Library › Workouts › Your plan end to end (Ben, 19 Oct: "can i see it
 * visually?", "where is the overview of what the goal is"): apply a coach
 * plan → the block shows its days, the goal line and this week's stats →
 * a plan day's screen shows what Start plans and last time's sets → log a
 * day → ✓ and the stats update → a new week clears the ✓ → End plan (the
 * days leave the rotation, workouts and history stay; Up next falls back)
 * → Undo. Retried taps replay, a stale read changes nothing, a force-close
 * keeps the ended plan. Real SQLite, a scripted model only for the build.
 */

const DAY = 86_400_000;
const plain = (s: string | null | undefined): string | null => (s == null ? null : s.replaceAll(' ', ' '));
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

const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const kgLoad = (value: number, convention = 'total') => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const FOUR: [string, string | null, [string, Record<string, unknown>?][]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }]]],
  ['Pull', 'pull', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }]]],
  ['Upper', null, [['Overhead press', { reps: { min: 6, max: 8 }, load: kgLoad(50) }]]],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: FOUR.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs, upper.', minutes: null, gymName: null });
};

async function benWithPlan(): Promise<{ s: AppServices; gymId: string; planId: string; days: string[] }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] },
    { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 4-day plan', spoken: false }, turnId: h.ids() });
  const card = result.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const active = await s.plans.active();
  return { s, gymId, planId, days: active?.days.map((d) => d.routineId) ?? [] };
}

async function doDay(s: AppServices, gymId: string, routineId: string): Promise<string> {
  const started = await s.workout.start({ gymId, opId: `start-${routineId}-${String(h.clockMs)}`, checkIn: null, routineOf: routineId });
  if (!started.ok) throw new Error(started.error.message);
  const id = started.aggregate.session.id;
  for (const set of started.aggregate.sets) {
    if (set.status !== 'pending' || set.setType === 'warmup') continue;
    h.clockMs += 60_000;
    const conv = started.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
    const r = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.max ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return id;
}

const rotation = async (s: AppServices) => (await s.routines.list()).filter((r) => r.inRotation).sort((a, b) => (a.rotationAtUtc < b.rotationAtUtc ? -1 : 1)).map((r) => r.name);

describe('Library › Your plan: apply → the block → log a day → End plan → Undo', () => {
  it('the block, a day, ✓ after a day is logged, a new week, End plan and its Undo', async () => {
    const { s, gymId, planId, days } = await benWithPlan();
    expect(days).toHaveLength(4);

    // No goal yet: `Set goal`, with the session length that is set.
    let v = await s.plans.overview();
    expect(v).toMatchObject({ planId, name: '4-day plan', goal: { action: 'Set goal' } });
    expect(plain(v?.since)).toBe('Since 13 Oct');
    expect(v?.days.map((d) => [d.n, d.name, d.state, d.next, d.when])).toEqual([
      [1, 'Push', 'next', true, null],
      [2, 'Pull', 'todo', false, null],
      [3, 'Legs', 'todo', false, null],
      [4, 'Upper', 'todo', false, null],
    ]);
    expect(v?.daysThisWeek.text).toBe('0 of 4');
    expect(v?.setsDone).toBeNull();

    // Profile › Training details: the goal line follows.
    const snap = await s.training.snapshot();
    if (!snap) throw new Error('snapshot');
    expect(await s.training.change({ kind: 'goal', goal: 'strength' }, snap.profile.version, 'goal-1')).toMatchObject({ ok: true });
    const snap2 = await s.training.snapshot();
    expect(await s.training.change({ kind: 'days_per_week', days: 4 }, snap2?.profile.version ?? 0, 'days-1')).toMatchObject({ ok: true });
    v = await s.plans.overview();
    expect(v?.goal.action).toBe('Edit');
    expect(v?.goal.text).toMatch(/^Goal: Strength · 4 days a week · \d+ min$/);

    // A plan day: what Start plans here, last time's sets.
    const day1 = await s.plans.planDay(days[0] ?? '');
    expect(day1).toMatchObject({ name: 'Push', dayN: 1, of: 4, planned: true });
    expect(plain(day1?.header)).toMatch(/^Day 1 of 4 · Main Gym · about \d+ min$/);
    expect(day1?.rows.map((r) => [r.name, plain(r.line)])).toEqual([
      ['Bench press', '3 × 6–8 · 100 kg'],
      ['Incline dumbbell press', '3 × 8–10 · 27.5 kg each'],
    ]);
    expect(plain(day1?.rows[0]?.sub)).toBe('Last 12 Oct: 100 × 7, 7 · Targets hit 1 of last 1');
    // A workout that isn't one of the plan's days has no plan-day screen.
    expect(await s.plans.planDay('not-a-plan-day')).toBeNull();

    // Log day 1 (Tuesday 13 Oct): ✓ with its weekday; day 2 is next; the stats count it.
    h.clockMs += 3_600_000;
    await doDay(s, gymId, days[0] ?? '');
    v = await s.plans.overview();
    expect(v?.days.map((d) => [d.state, d.next, d.when])).toEqual([
      ['done', false, 'Tue'],
      ['next', true, null],
      ['todo', false, null],
      ['todo', false, null],
    ]);
    expect(v?.daysThisWeek.text).toBe('1 of 4');
    expect(v?.setsDone).toEqual({ pct: 100, text: '100%' });
    // The same count as Progress's consistency card.
    expect((await s.plans.consistency())?.planThisWeek?.text).toBe('1 of 4');
    expect(plain((await s.plans.planDay(days[0] ?? ''))?.rows[0]?.sub)).toBe('Last 13 Oct: 100 × 8, 8, 8 · Targets hit 2 of last 2');

    // A new week (Monday 19 Oct): no ✓; day 1 reads when it was last done.
    h.clockMs = Date.parse('2026-10-19T07:00:00.000Z');
    v = await s.plans.overview();
    expect(v?.days.map((d) => [d.state, plain(d.when)])).toEqual([
      ['todo', 'Last 13 Oct'],
      ['next', null],
      ['todo', null],
      ['todo', null],
    ]);
    expect(v?.daysThisWeek.text).toBe('0 of 4');
    expect(v?.setsDone).toBeNull();

    // End plan: the days leave the rotation; the workouts and history stay; Up next falls back; no block.
    const stale = await s.plans.end({ planId, expectedVersion: (v?.planVersion ?? 0) - 1, opId: 'end-old' });
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    const req = { planId, expectedVersion: v?.planVersion ?? 0, opId: 'end-1' };
    const ended = await s.plans.end(req);
    expect(ended).toMatchObject({ ok: true, duplicate: false, plan: { status: 'ended' } });
    expect(await s.plans.end(req)).toMatchObject({ ok: true, duplicate: true });
    expect(await s.plans.overview()).toBeNull();
    expect(await rotation(s)).toEqual([]);
    expect((await s.routines.list()).map((r) => r.name).sort()).toEqual(['Legs', 'Pull', 'Push', 'Upper']);
    expect((await s.next.preview(gymId))?.routine?.basis.kind).not.toBe('plan');
    expect((await s.plans.card({ planId, versionN: 1 }))?.state).toEqual({ kind: 'ended' });
    expect((await s.plans.consistency())?.planThisWeek).toBeNull();

    // Force-close: still ended.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await s2.plans.overview()).toBeNull();

    // Undo (the toast's): the plan in use again, its days back in the rotation in order; Up next walks it again.
    if (!ended.ok) throw new Error('ended');
    const undo = { planId, expectedVersion: ended.plan.version, opId: 'resume-1' };
    expect(await s2.plans.resume(undo)).toMatchObject({ ok: true, duplicate: false, plan: { status: 'applied' } });
    expect(await s2.plans.resume(undo)).toMatchObject({ ok: true, duplicate: true });
    expect(await rotation(s2)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect(await s2.plans.overview()).toMatchObject({ planId, daysThisWeek: { text: '0 of 4' } });
    expect(await s2.next.preview(gymId)).toMatchObject({ title: 'Pull', routine: { basis: { kind: 'plan', dayN: 2, of: 4 } } });
    expect((await s2.plans.card({ planId, versionN: 1 }))?.state).toMatchObject({ kind: 'applied' });
  });

  it('no plan applied: no block; End on a plan that isn’t there changes nothing', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    expect(await s.plans.overview()).toBeNull();
    expect(await s.plans.end({ planId: 'nope', expectedVersion: 1, opId: 'end-x' })).toMatchObject({ ok: false, reason: 'missing' });
  });
});

describe('Your plan › Ask coach to change (review planview-19oct B1)', () => {
  function planOf(req: ModelRequest): { current: { name: string; inUse?: boolean; days: { name: string; exercises: { name: string }[] }[] } | null } | null {
    const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    if (block?.type !== 'message') return null;
    const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { plan?: { current: { name: string; inUse?: boolean; days: { name: string; exercises: { name: string }[] }[] } | null } } };
    return data.build?.plan ?? null;
  }

  it('the prefilled "Change my plan: …" turn sees the plan in use; the change is a new plan (Apply replaces it, Undo puts it back); the plan in use is untouched until then', async () => {
    const { s, planId } = await benWithPlan();
    const before = await s.plans.overview();
    const seen: ReturnType<typeof planOf>[] = [];
    model = new StepModel([
      (req) => {
        seen.push(planOf(req));
        return planStub(req);
      },
      () => replyWith('Swapped it.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Change my plan: swap squats for leg press', spoken: false }, turnId: h.ids() });
    expect(seen[0]?.current).toMatchObject({ name: '4-day plan', inUse: true });
    expect(seen[0]?.current?.days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect(seen[0]?.current?.days[2]?.exercises.map((e) => e.name)).toEqual(['Back squat']);
    const card = r.cards[0]?.record;
    if (card?.detail.kind !== 'build_plan') throw new Error('no plan card');
    const newId = card.detail.planId;
    expect(newId).not.toBe(planId);
    // Nothing changed yet (rule 2): the plan in use and its block are as they were.
    expect(await s.plans.overview()).toMatchObject({ planId, planVersion: before?.planVersion });
    expect(await rotation(s)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);

    // Apply: the new plan is in use; the old one is superseded. Undo: the old one is back.
    const c = await s.plans.card({ planId: newId, versionN: 1 });
    const applied = await s.plans.apply({ planId: newId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-2' });
    expect(applied).toMatchObject({ ok: true });
    expect((await s.plans.overview())?.planId).toBe(newId);
    expect((await s.plans.card({ planId, versionN: 1 }))?.state.kind).toBe('superseded');
    if (!applied.ok) throw new Error('apply');
    expect(await s.plans.undo({ planId: newId, expectedVersion: applied.plan.version, opId: 'undo-2' })).toMatchObject({ ok: true });
    expect((await s.plans.overview())?.planId).toBe(planId);
    expect(await rotation(s)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
  });

  it('words that don’t change the plan (a question about it) get no plan turn', async () => {
    const { s } = await benWithPlan();
    const seen: ReturnType<typeof planOf>[] = [];
    model = new StepModel([
      (req) => {
        seen.push(planOf(req));
        return replyWith('It looks balanced.');
      },
    ]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'What do you think of my plan?', spoken: false }, turnId: h.ids() });
    expect(seen[0]).toBeNull();
  });
});

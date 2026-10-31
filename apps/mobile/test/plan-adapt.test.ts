import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { localDateText } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * A plan that follows what Ben does (Ben, 20 Oct) end to end, real SQLite:
 * Apply (`Replace my workouts`) → an off-plan leg session ticks Legs and Up
 * next moves on to another day → `Make next` pins a day (retry replays, a
 * stale read changes nothing, Undo) → Pause until a date (Up next back to the
 * normal rules, no `Day N of M`, no plan rows in Change; Undo) → the first
 * open after the date resumes it → Pause with no date, Resume → End plan puts
 * Push A and Pull A back in the rotation (a deleted one is named, not
 * restored) → Undo of End takes them out again.
 */

const DAY = 86_400_000;
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

type Ex = [string, Record<string, unknown>?];
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const kgLoad = (value: number, convention = 'total') => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const FOUR: [string, string | null, Ex[]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }]]],
  ['Pull', 'pull', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }]]],
  ['Upper', null, [['Overhead press', { reps: { min: 6, max: 8 }, load: kgLoad(50) }]]],
];

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: FOUR.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs, upper.', minutes: null, gymName: null });
};

const rotation = async (s: AppServices) => (await s.routines.list()).filter((r) => r.inRotation).sort((a, b) => (a.rotationAtUtc < b.rotationAtUtc ? -1 : 1)).map((r) => r.name);

/** Ben's history (push, pull, legs), Push A and Pull A in the rotation, then a 4-day plan applied with `Replace my workouts`. */
async function benWithPlan() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  // His history is the week before (28 Oct: a plan's first week counts from its Monday, so history that week would
  // already tick its days).
  h.clockMs -= 7 * DAY;
  const push = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  const pull = await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10, rpe: 8 }, { load: 60, reps: 10, rpe: 8 }] }]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }] }]);
  const pushA = await s.routines.saveFromSession({ sessionId: push, name: 'Push A', opId: 'save-push', addToRotation: true });
  h.clockMs += 60_000;
  const pullA = await s.routines.saveFromSession({ sessionId: pull, name: 'Pull A', opId: 'save-pull', addToRotation: true });
  if (!pushA.ok || !pullA.ok) throw new Error('save');
  h.clockMs += DAY + 7 * DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 4-day plan', spoken: false }, turnId: h.ids() });
  const card = r.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const active = await s.plans.active();
  const byName = new Map(active?.days.map((d) => [d.name, d.routineId]));
  return { s, gymId, planId, day: (n: string) => byName.get(n) ?? '' };
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

const upNext = async (s: AppServices, gymId: string) => {
  const p = await s.next.preview(gymId);
  return { title: p?.title ?? null, plan: p?.routine?.basis.kind === 'plan' ? p.routine.basis.dayN : null };
};
const nbsp = (t: string | null | undefined) => (t ?? '').replaceAll(' ', ' ');

describe('a plan that follows what Ben does (Ben, 20 Oct)', () => {
  it('apply → off-plan leg day → Legs ✓, next is another day → Make next → pause → normal Up next → auto-resume → resume → End restores replaced workouts → Undo', async () => {
    const { s, gymId, planId, day } = await benWithPlan();
    // Shoulders (Upper) were never trained in the window; legs were trained last (before Apply): Upper first.
    expect(await upNext(s, gymId)).toEqual({ title: 'Upper', plan: 4 });

    // Upper from the plan, then an off-plan leg day: an empty workout with squats.
    h.clockMs += 3_600_000;
    await doDay(s, gymId, day('Upper'));
    h.clockMs += DAY;
    await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }] }]);
    let v = await s.plans.overview();
    expect(v?.days.map((d) => [d.name, d.state, d.next])).toEqual([
      ['Push', 'next', true],
      ['Pull', 'todo', false],
      ['Legs', 'done', false],
      ['Upper', 'done', false],
    ]);
    expect(v?.daysThisWeek.text).toBe('2 of 4');
    expect((await s.plans.consistency())?.planThisWeek?.text).toBe('2 of 4');
    expect(await upNext(s, gymId)).toEqual({ title: 'Push', plan: 1 });
    // Change lists the plan's days first (not Up next's own row).
    const list = await s.sessions.list(gymId);
    expect(list?.plan?.map((r) => r.label)).toEqual(['Pull', 'Legs', 'Upper']);
    expect(list?.workouts.some((r) => ['Pull', 'Legs', 'Upper'].includes(r.label))).toBe(false);

    // Make next: Pull. Retried: replayed. An old read: stale, nothing changes.
    const pin = { planId, routineId: day('Pull'), expectedVersion: v?.planVersion ?? 0, opId: 'pin-pull' };
    const pinned = await s.plans.makeNext(pin);
    expect(pinned).toMatchObject({ ok: true, duplicate: false });
    expect(await s.plans.makeNext(pin)).toMatchObject({ ok: true, duplicate: true });
    expect(await s.plans.makeNext({ ...pin, routineId: day('Legs'), opId: 'pin-old' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await upNext(s, gymId)).toEqual({ title: 'Pull', plan: 2 });
    expect(await s.plans.planDay(day('Pull'))).toMatchObject({ pinned: true, paused: false });
    expect(await s.plans.planDay(day('Push'))).toMatchObject({ pinned: false });
    if (!pinned.ok) throw new Error('pin');
    // Undo: Push again. Then pin Pull again for the rest of the flow.
    const undone = await s.plans.undoControl({ planId, targetOpId: 'pin-pull', expectedVersion: pinned.plan.version, opId: 'undo-pin' });
    expect(undone).toMatchObject({ ok: true });
    expect(await upNext(s, gymId)).toEqual({ title: 'Push', plan: 1 });
    if (!undone.ok) throw new Error('undo');
    const again = await s.plans.makeNext({ planId, routineId: day('Pull'), expectedVersion: undone.plan.version, opId: 'pin-pull-2' });
    if (!again.ok) throw new Error('pin again');

    // Pause until a date two weeks on: Up next follows the normal rules, no `Day N of M`; the block says so; no plan rows in Change.
    const until = '2026-10-30';
    const paused = await s.plans.pause({ planId, untilDate: until, expectedVersion: again.plan.version, opId: 'pause-1' });
    expect(paused).toMatchObject({ ok: true });
    expect((await upNext(s, gymId)).plan).toBeNull();
    v = await s.plans.overview();
    expect(nbsp(v?.paused?.text)).toBe(`Paused · until ${nbsp(localDateText(until))}`);
    expect(v?.days.some((d) => d.next)).toBe(false);
    expect((await s.sessions.list(gymId))?.plan).toEqual([]);
    expect(await s.plans.planDay(day('Pull'))).toMatchObject({ paused: true });
    // A bad date is refused; a second pause while paused is refused.
    if (!paused.ok) throw new Error('pause');
    expect(await s.plans.pause({ planId, untilDate: null, expectedVersion: paused.plan.version, opId: 'pause-x' })).toMatchObject({ ok: false });
    // Undo of the pause: in use again (still pinned), then pause again.
    const up = await s.plans.undoControl({ planId, targetOpId: 'pause-1', expectedVersion: paused.plan.version, opId: 'undo-pause' });
    if (!up.ok) throw new Error('undo pause');
    expect(await upNext(s, gymId)).toEqual({ title: 'Pull', plan: 2 });
    const paused2 = await s.plans.pause({ planId, untilDate: until, expectedVersion: up.plan.version, opId: 'pause-2' });
    if (!paused2.ok) throw new Error('pause 2');
    // Paused days don't count against this week's plan days.
    expect(Number((await s.plans.overview())?.daysThisWeek.of)).toBeLessThan(4);

    // Holiday: the first open on 30 Oct resumes it (a force-close and launch, as Ben opening the app).
    h.clockMs = Date.parse('2026-10-30T08:00:00.000Z');
    await h.forceClose();
    const s2 = (await h.launch()).services;
    v = await s2.plans.overview();
    expect(v?.paused).toBeNull();
    expect(await upNext(s2, gymId)).toEqual({ title: 'Pull', plan: 2 });

    // Pause with no date; Resume at once.
    const p3 = await s2.plans.pause({ planId, untilDate: null, expectedVersion: v?.planVersion ?? 0, opId: 'pause-3' });
    if (!p3.ok) throw new Error('pause 3');
    expect(nbsp((await s2.plans.overview())?.paused?.text)).toBe('Paused');
    const r3 = await s2.plans.resumePause({ planId, expectedVersion: p3.plan.version, opId: 'resume-3' });
    expect(r3).toMatchObject({ ok: true });
    expect((await s2.plans.overview())?.paused).toBeNull();

    // End plan: the plan's days leave the rotation, Push A and Pull A come back in their places; Undo reverts both.
    v = await s2.plans.overview();
    const ended = await s2.plans.end({ planId, expectedVersion: v?.planVersion ?? 0, opId: 'end-1' });
    expect(ended).toMatchObject({ ok: true, notRestored: [] });
    expect(await rotation(s2)).toEqual(['Push A', 'Pull A']);
    if (!ended.ok) throw new Error('end');
    expect(await s2.plans.resume({ planId, expectedVersion: ended.plan.version, opId: 'resume-end' })).toMatchObject({ ok: true });
    expect(await rotation(s2)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
  });

  it('End plan skips a replaced workout Ben deleted since, and names it', async () => {
    const { s, planId } = await benWithPlan();
    const pullA = (await s.routines.list()).find((r) => r.name === 'Pull A');
    if (pullA === undefined) throw new Error('Pull A');
    expect(await s.routines.remove({ routineId: pullA.id, expectedVersion: pullA.version, opId: 'rm-pull' })).toMatchObject({ ok: true });
    const v = await s.plans.overview();
    const ended = await s.plans.end({ planId, expectedVersion: v?.planVersion ?? 0, opId: 'end-2' });
    expect(ended).toMatchObject({ ok: true, notRestored: ['Pull A'] });
    expect(await rotation(s)).toEqual(['Push A']);
  });
});

describe('pause and pin edge cases (review plan-adapt B1, S3)', () => {
  it('End while paused (no date): later weeks aren\'t paused; Undo of End puts the pause back', async () => {
    const { s, planId } = await benWithPlan();
    let v = await s.plans.overview();
    const p = await s.plans.pause({ planId, untilDate: null, expectedVersion: v?.planVersion ?? 0, opId: 'pause-e' });
    if (!p.ok) throw new Error('pause');
    h.clockMs += 2 * DAY;
    const ended = await s.plans.end({ planId, expectedVersion: p.plan.version, opId: 'end-e' });
    if (!ended.ok) throw new Error('end');
    // The week after: nothing paused, so it is judged (paused only up to End).
    h.clockMs += 15 * DAY;
    const weeks = (await s.plans.consistency())?.weeks ?? [];
    expect(weeks.find((w) => w.monday === '2026-10-12')?.pausedDays).toBe(2);
    expect(weeks.find((w) => w.monday === '2026-10-19')?.pausedDays).toBe(0);
    // Undo of End: the plan is in use and paused again.
    h.clockMs -= 15 * DAY;
    expect(await s.plans.resume({ planId, expectedVersion: ended.plan.version, opId: 'undo-end-e' })).toMatchObject({ ok: true });
    v = await s.plans.overview();
    expect(nbsp(v?.paused?.text)).toBe('Paused');
  });

  it('a pin done before a six-week break stays done: Up next and the plan day agree', async () => {
    const { s, gymId, planId, day } = await benWithPlan();
    const v = await s.plans.overview();
    const pin = await s.plans.makeNext({ planId, routineId: day('Legs'), expectedVersion: v?.planVersion ?? 0, opId: 'pin-legs' });
    if (!pin.ok) throw new Error('pin');
    expect(await upNext(s, gymId)).toEqual({ title: 'Legs', plan: 3 });
    h.clockMs += 3_600_000;
    await doDay(s, gymId, day('Legs'));
    expect((await upNext(s, gymId)).title).not.toBe('Legs');
    h.clockMs += 45 * DAY;
    expect((await upNext(s, gymId)).title).not.toBe('Legs');
    expect(await s.plans.planDay(day('Legs'))).toMatchObject({ pinned: false });
  });
});

describe('the coach pauses the plan when Ben asks (Ben, 20 Oct: "pause eg if go on hols")', () => {
  function planBlock(req: ModelRequest): { today: string; inUse: { name: string; paused: unknown } | null } | null {
    const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    if (block?.type !== 'message') return null;
    const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { plan?: { today: string; inUse: { name: string; paused: unknown } | null } };
    return data.plan ?? null;
  }

  it('"I\'m on holiday till 3 Nov": paused until 3 Nov (his date wins over the model\'s), Up next normal; the card\'s Undo puts it back; other words don\'t offer the tool', async () => {
    const { s, gymId } = await benWithPlan();
    const seen: { tools: string[]; plan: ReturnType<typeof planBlock> }[] = [];
    model = new StepModel([
      (req) => {
        seen.push({ tools: req.tools.map((t) => t.name), plan: planBlock(req) });
        return toolCall('pause_plan', { action: 'pause', until: '2025-11-02', reason: 'Holiday' });
      },
      () => replyWith('Enjoy the break.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: "I'm on holiday till 3 Nov", spoken: false }, turnId: h.ids() });
    expect(seen[0]?.tools).toContain('pause_plan');
    // (Ben, 30 Oct) The plan days' exercises come with it (what `propose_plan_swap` swaps).
    expect(seen[0]?.plan).toEqual({ today: '2026-10-15', inUse: { name: '4-day plan', paused: null, days: expect.any(Array) as unknown } });
    const card = r.cards.find((c) => c.record.detail.kind === 'pause_plan')?.record;
    expect(card).toMatchObject({ status: 'committed', detail: { kind: 'pause_plan', action: 'pause', untilDate: '2026-11-03' } });
    expect(nbsp((await s.plans.overview())?.paused?.text)).toBe('Paused · until 3 Nov');
    expect((await upNext(s, gymId)).plan).toBeNull();

    // Undo from the card: the plan is in use again.
    if (card === undefined) throw new Error('card');
    const u = await s.coach.undo(card.actionId, 'undo-pause-chat');
    expect(u.result.status).toBe('written');
    expect((await s.plans.overview())?.paused).toBeNull();
    expect((await upNext(s, gymId)).plan).not.toBeNull();

    // ADR 0039: the tool is offered whenever a plan is in use; a message that isn't about pausing changes nothing.
    const seen2: string[][] = [];
    model = new StepModel([
      (req) => {
        seen2.push(req.tools.map((t) => t.name));
        return replyWith('Looks good.');
      },
    ]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'How is my week looking?', spoken: false }, turnId: h.ids() });
    expect(seen2[0]).toContain('pause_plan');
    expect((await s.plans.overview())?.paused).toBeNull();
  });

  it('a holiday still ahead, or "I\'m back to 100 kg", never pauses (review B2; ADR 0039: the tool is offered, the call isn\'t run); of several dates Ben said, the model\'s pick stands (S4)', async () => {
    const { s } = await benWithPlan();
    for (const text of ['Going on holiday next week, anything I should do before?', "I'm back to 100 kg on bench"]) {
      const tools: string[][] = [];
      model = new StepModel([
        (req) => {
          tools.push(req.tools.map((t) => t.name));
          return toolCall('pause_plan', { action: text.includes('holiday') ? 'pause' : 'resume', until: null, reason: 'Holiday', benAsked: true, benQuote: text });
        },
        () => replyWith('Noted.'),
      ]);
      const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
      expect(tools[0]).toContain('pause_plan');
      expect(r.cards.filter((c) => c.record.detail.kind === 'pause_plan')).toEqual([]);
      expect((await s.plans.overview())?.paused).toBeNull();
    }
    model = new StepModel([() => toolCall('pause_plan', { action: 'pause', until: '2026-11-04', reason: 'Holiday' }), () => replyWith('Enjoy.')]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: "I'm on holiday till 3 Nov, maybe 4 Nov", spoken: false }, turnId: h.ids() });
    expect(r.cards.find((c) => c.record.detail.kind === 'pause_plan')?.record).toMatchObject({ status: 'committed', detail: { untilDate: '2026-11-04' } });
  });
});

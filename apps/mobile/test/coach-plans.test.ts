import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';
import type { SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Coach-built multi-day plans end to end (Ben, 19 Oct): "Build me a 4-day
 * plan" → the coach builds every day at once (a scripted model calls
 * `propose_plan` with IDs from the context) → one plan card with every day
 * → Apply (`Replace my workouts`) saves the days as workouts in the
 * rotation, so Up next walks them, day 1 with the plan's checked loads →
 * Summary's plan vs done → Progress's consistency and targets hit → Undo
 * puts the previous setup back. Retried taps replay; an old card is stale;
 * a force-close keeps the plan. Real SQLite.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
let connection: TextCoachState;
beforeEach(() => {
  model = new StepModel([]);
  connection = CONNECTED;
  h = createHarness('2026-10-12T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(connection) } });
});
afterEach(async () => {
  await h.cleanup();
});

interface BuildView {
  usable: { catalogueId: string; name: string }[];
  plan?: { splitDays: { id: string; name: string }[]; daysPerWeek: number | null; minutesEach: number; setBudget: number; rotation: string[]; current: unknown };
}

function buildOf(req: ModelRequest): BuildView {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: BuildView };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build;
}

type Ex = [string, Record<string, unknown>?];
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const kgLoad = (value: number, convention = 'total') => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });

const FOUR: [string, string | null, Ex[]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }], ['Triceps pushdown']]],
  ['Pull', 'pull', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }], ['Leg sled']]],
  ['Upper', null, [['Overhead press', { reps: { min: 6, max: 8 }, load: kgLoad(50) }], ['Lat pulldown', { load: kgLoad(60, 'stack') }]]],
];

function planStub(days = FOUR, message = 'Push, pull and legs, then an upper day to round out the week.') {
  return (req: ModelRequest): ModelEvent[] => {
    const b = buildOf(req);
    const idOf = (name: string) => b.usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name.toLowerCase().replaceAll(' ', '-')}`;
    return toolCall('propose_plan', { days: days.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message, minutes: null, gymName: null });
  };
}

const ask = (s: AppServices, text: string, threadId: string | null = null) => s.coach.send({ entry: { kind: 'today' }, threadId, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

/** Ben's history and his current setup: Push A and Pull A in the rotation. */
async function benWithSetup(): Promise<{ s: AppServices; gymId: string; pushA: string; pullA: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const push = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] },
    { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9, rpe: 8 }, { load: 27.5, reps: 9, rpe: 8 }] },
    { exercise: 'Overhead press', sets: [{ load: 50, reps: 8, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  const pull = await logWorkout(h, s, gymId, [
    { exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10, rpe: 8 }, { load: 60, reps: 10, rpe: 8 }] },
    { exercise: 'Barbell row', sets: [{ load: 70, reps: 8, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }] }]);
  const pushA = await s.routines.saveFromSession({ sessionId: push, name: 'Push A', opId: 'save-push', addToRotation: true });
  h.clockMs += 60_000;
  const pullA = await s.routines.saveFromSession({ sessionId: pull, name: 'Pull A', opId: 'save-pull', addToRotation: true });
  if (!pushA.ok || !pullA.ok) throw new Error('save');
  h.clockMs += DAY;
  return { s, gymId, pushA: pushA.routine.id, pullA: pullA.routine.id };
}

async function buildFour(s: AppServices): Promise<{ planId: string; threadId: string }> {
  model = new StepModel([planStub(), () => replyWith('Here is your week.')]);
  const result = await ask(s, 'Build me a 4-day plan');
  const card = result.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan' || card.status !== 'committed') throw new Error(`no plan: ${JSON.stringify(result.cards.map((c) => c.record))}`);
  return { planId: card.detail.planId, threadId: result.threadId };
}

const rotation = async (s: AppServices) => (await s.routines.list()).filter((r) => r.inRotation).sort((a, b) => (a.rotationAtUtc < b.rotationAtUtc ? -1 : 1)).map((r) => r.name);

/** Start a routine, log every pending set at its planned load (reps as given, else the top of its range), finish. */
async function doRoutine(s: AppServices, gymId: string, routineId: string, reps: (setIndex: number, exerciseName: string) => number | null = () => null): Promise<{ sessionId: string; started: SessionAggregate }> {
  const started = await s.workout.start({ gymId, opId: `start-${routineId}-${String(h.clockMs)}`, checkIn: null, routineOf: routineId });
  if (!started.ok) throw new Error(started.error.message);
  const id = started.aggregate.session.id;
  const cur = await s.workout.load(id);
  const names = new Map(cur?.aggregate.exercises.map((e) => [e.id, e.exerciseName]));
  const conventions = new Map(cur?.aggregate.exercises.map((e) => [e.id, e.loadConvention]));
  for (const set of cur?.aggregate.sets ?? []) {
    if (set.status !== 'pending' || set.setType === 'warmup') continue;
    h.clockMs += 60_000;
    const n = reps(set.index, names.get(set.sessionExerciseId) ?? '') ?? set.planned.reps?.max ?? 8;
    const r = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}:0`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conventions.get(set.sessionExerciseId) ?? 'total' }, reps: n, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return { sessionId: id, started: started.aggregate };
}

describe('build a 4-day plan → card → Apply (replace) → Up next walks it → Undo', () => {
  it('the coach builds every day at once from Ben’s split and history; the card shows every day; nothing changes before Apply', async () => {
    const { s, gymId } = await benWithSetup();
    const { planId } = await buildFour(s);
    const req = model.requests[0] as ModelRequest;
    expect(req.tools.map((t) => t.name)).toContain('propose_plan');
    expect(req.toolChoice).toBe('required');
    const b = buildOf(req);
    expect(b.plan?.splitDays.map((d) => d.id)).toEqual(['push', 'pull', 'legs']);
    expect(b.plan?.rotation).toEqual(['Push A', 'Pull A']);
    expect(b.plan?.minutesEach).toBe(60);

    const card = await s.plans.card({ planId, versionN: 1 });
    expect(card).toMatchObject({ name: '4-day plan', state: { kind: 'open' }, gymName: 'Main Gym', replaces: ['Push A', 'Pull A'], rationale: 'Push, pull and legs, then an upper day to round out the week.' });
    // An exercise the coach named that isn't in the usable list is left out of its day, with a count.
    expect(card?.days.map((d) => [d.name, d.line, d.leftOut])).toEqual([
      ['Push', '3 exercises · 9 sets · 60 min', 0],
      ['Pull', '2 exercises · 6 sets · 60 min', 0],
      ['Legs', '1 exercise · 3 sets · 60 min', 1],
      ['Upper', '2 exercises · 6 sets · 60 min', 0],
    ]);
    const push = await s.plans.day({ planId, versionN: 1, dayIndex: 0 });
    expect(push?.rows.map((r) => [r.name, r.scheme.replace(/\s/g, ' '), r.load.replace(/\s/g, ' ')])).toEqual([
      ['Bench press', '3 × 6–8', '100 kg'],
      ['Incline dumbbell press', '3 × 8–10', '27.5 kg each'],
      ['Triceps pushdown', '3 × 8–10', '—'],
    ]);
    expect(push?.routineId).toBeNull();
    // A proposal: the rotation and Up next are as they were.
    expect(await rotation(s)).toEqual(['Push A', 'Pull A']);
    expect((await s.next.preview(gymId))?.routine?.basis.kind).not.toBe('plan');
  });

  it('Apply replace: the days are the rotation, Up next is day 1 with the plan’s loads, then day 2; a retried Apply replays; an old card is stale; Undo restores', async () => {
    const { s, gymId, pushA, pullA } = await benWithSetup();
    const { planId } = await buildFour(s);
    const card = await s.plans.card({ planId, versionN: 1 });
    if (card === null) throw new Error('card');
    const req = { planId, versionN: 1, expectedVersion: card.planVersion, mode: 'replace' as const, opId: 'apply-1' };
    const applied = await s.plans.apply(req);
    expect(applied).toMatchObject({ ok: true, duplicate: false });
    expect(await s.plans.apply(req)).toMatchObject({ ok: true, duplicate: true });
    expect(await s.plans.apply({ ...req, opId: 'apply-2' })).toEqual({ ok: false, reason: 'stale', message: 'Out of date. Nothing changed.' });
    expect(await rotation(s)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    // Push A and Pull A are still in Workouts, out of the rotation.
    expect((await s.routines.list()).filter((r) => r.id === pushA || r.id === pullA).map((r) => r.inRotation)).toEqual([false, false]);
    const after = await s.plans.card({ planId, versionN: 1 });
    expect(after?.state).toMatchObject({ kind: 'applied', mode: 'replace' });

    // Up next: day 1, with the plan's checked loads.
    const up = await s.next.preview(gymId);
    expect(up).toMatchObject({ title: 'Push', routine: { basis: { kind: 'plan', dayN: 1, of: 4 } } });
    const day1 = up?.routine?.id ?? '';
    const day = await s.plans.day({ planId, versionN: 1, dayIndex: 0 });
    expect(day?.routineId).toBe(day1);

    // Force-close and relaunch: the plan, the rotation and Up next are as they were.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await rotation(s2)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect((await s2.next.preview(gymId))?.routine?.id).toBe(day1);

    // Day 1: the bench's first workout takes the plan's 100 kg (labelled coach); one bench set short.
    h.clockMs += 3_600_000;
    const { sessionId, started } = await doRoutine(s2, gymId, day1, (i, name) => (name === 'Bench press' && i === 2 ? 5 : null));
    const benchRow = started.exercises.find((e) => e.exerciseName === 'Bench press');
    const benchSets = started.sets.filter((x) => x.sessionExerciseId === benchRow?.id && x.setType !== 'warmup');
    expect(benchSets.map((x) => x.planned.load)).toEqual([{ value: 100, unit: 'kg', convention: 'total' }, { value: 100, unit: 'kg', convention: 'total' }, { value: 100, unit: 'kg', convention: 'total' }]);
    expect(benchSets[0]?.planned.source).toBe('coach');
    expect(started.session.routineId).toBe(day1);

    // Summary: plan vs done.
    const pvd = await s2.workout.planVsDone(sessionId);
    expect(pvd?.rows.find((r) => r.name === 'Bench press')).toMatchObject({ text: '3/3 sets · 8, 8, 5 of 6–8', verdict: 'short' });
    expect(pvd?.rows.find((r) => r.name === 'Incline dumbbell press')).toMatchObject({ text: '3/3 sets · 10, 10, 10 of 8–10', verdict: 'hit' });
    expect(pvd?.header).toBe('9/9 planned sets');

    // Up next walks the plan: day 2.
    h.clockMs += DAY;
    expect(await s2.next.preview(gymId)).toMatchObject({ title: 'Pull', routine: { basis: { kind: 'plan', dayN: 2, of: 4 } } });

    // Progress: consistency against the aim, and the plan's days this week.
    const snap = await s2.training.snapshot();
    if (!snap) throw new Error('snapshot');
    expect(await s2.training.change({ kind: 'days_per_week', days: 4 }, snap.profile.version, 'days-4')).toMatchObject({ ok: true });
    const c = await s2.plans.consistency();
    expect(c?.planThisWeek).toEqual({ done: 1, of: 4, text: '1 of 4' });
    expect(c?.thisWeek.text).toMatch(/^\d\/4$/);
    expect(c?.atAimText).toMatch(/^Weeks at your aim: \d of 8$/);
    expect(JSON.stringify(c)).not.toMatch(/miss/i);
    // Exercise history: target vs actual, targets hit.
    const benchId = benchRow?.exerciseId ?? '';
    const targets = await s2.progress.exerciseTargets(benchId);
    expect(targets?.rows[0]).toMatchObject({ sessionId, target: '3 × 6–8', actual: '8, 8, 5', verdict: 'short' });
    expect(targets?.hitText).toMatch(/^Targets hit \d of last \d$/);

    // Undo: Push A and Pull A back in the rotation in their places; the plan's workouts are gone; the plan is open again.
    const now = await s2.plans.card({ planId, versionN: 1 });
    expect(await s2.plans.undo({ planId, expectedVersion: (now?.planVersion ?? 0) - 1, opId: 'undo-old' })).toMatchObject({ ok: false, reason: 'stale' });
    const undone = await s2.plans.undo({ planId, expectedVersion: now?.planVersion ?? 0, opId: 'undo-1' });
    expect(undone).toMatchObject({ ok: true });
    expect(await s2.plans.undo({ planId, expectedVersion: now?.planVersion ?? 0, opId: 'undo-1' })).toMatchObject({ ok: true, duplicate: true });
    expect(await rotation(s2)).toEqual(['Push A', 'Pull A']);
    expect((await s2.routines.list()).map((r) => r.name).sort()).toEqual(['Pull A', 'Push A']);
    expect(await s2.plans.card({ planId, versionN: 1 })).toMatchObject({ state: { kind: 'open' } });
    expect((await s2.next.preview(gymId))?.routine?.basis.kind).not.toBe('plan');
    // The workout done from day 1 stays in history (rule 2).
    expect((await s2.workout.load(sessionId))?.aggregate.session.status).toBe('finished');
  });

  it('Add alongside keeps the current workouts in the rotation; day 1 is Up next until a plan day is done', async () => {
    const { s, gymId } = await benWithSetup();
    const { planId } = await buildFour(s);
    const card = await s.plans.card({ planId, versionN: 1 });
    expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: card?.planVersion ?? 0, mode: 'add', opId: 'apply-add' })).toMatchObject({ ok: true });
    expect(await rotation(s)).toEqual(['Push A', 'Pull A', 'Push', 'Pull', 'Legs', 'Upper']);
    expect(await s.next.preview(gymId)).toMatchObject({ title: 'Push', routine: { basis: { kind: 'plan', dayN: 1, of: 4 } } });
  });

  it('with a split: the plan’s days are the split days, so the day due by split is the plan’s workout', async () => {
    const { s, gymId } = await benWithSetup();
    const snap = await s.training.snapshot();
    if (!snap) throw new Error('snapshot');
    expect(await s.training.change({ kind: 'preset_split', split: 'ppl' }, snap.profile.version, 'split-ppl')).toMatchObject({ ok: true });
    const { planId } = await buildFour(s);
    const card = await s.plans.card({ planId, versionN: 1 });
    expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: card?.planVersion ?? 0, mode: 'replace', opId: 'apply-split' })).toMatchObject({ ok: true });
    // Push was trained least recently (squat last, pull before it): the plan's Push, day 1 of 4.
    expect(await s.next.preview(gymId)).toMatchObject({ title: 'Push', routine: { basis: { kind: 'plan', dayN: 1, of: 4 } } });
  });

  it('a change to the plan in the thread is a new version; the old card can’t apply (rule 5)', async () => {
    const { s } = await benWithSetup();
    const { planId, threadId } = await buildFour(s);
    model = new StepModel([planStub(FOUR.slice(0, 3)), () => replyWith('Three days.')]);
    const r = await ask(s, 'only 3 days', threadId);
    expect(r.cards[0]?.record.detail).toMatchObject({ kind: 'build_plan', planId, versionN: 2, parentN: 1, name: '3-day plan' });
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_plan');
    const old = await s.plans.card({ planId, versionN: 1 });
    expect(old?.state).toEqual({ kind: 'replaced', byN: 2 });
    expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: old?.planVersion ?? 0, mode: 'replace', opId: 'apply-old' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await rotation(s)).toEqual(['Push A', 'Pull A']);
  });

  it('up to 2 clarifying questions: the coach asks one, Ben’s answer builds the plan (never a one-session draft)', async () => {
    const { s } = await benWithSetup();
    model = new StepModel([() => toolCall('ask_build_question', { topic: 'split', question: 'Which split this week?', answers: [{ label: 'Push/Pull/Legs', catalogueId: null }, { label: 'Upper/Lower', catalogueId: null }] }), () => replyWith('never')]);
    const first = await ask(s, 'Build me a 4-day plan');
    expect(model.requests[0]?.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['propose_plan', 'ask_build_question']));
    expect(first.cards[0]?.record).toMatchObject({ status: 'proposed', detail: { kind: 'build_question', question: 'Which split this week?' } });
    model = new StepModel([planStub(), () => replyWith('Here it is.')]);
    const second = await ask(s, 'Push/Pull/Legs', first.threadId);
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_plan');
    expect(model.requests[0]?.tools.map((t) => t.name)).not.toContain('propose_workout');
    expect(second.cards[0]?.record.detail.kind).toBe('build_plan');
    expect(await s.coachDrafts.list()).toEqual([]);
  });

  it('offline or not connected: no plan is built and nothing changes (rule 1)', async () => {
    const { s } = await benWithSetup();
    connection = { status: 'not_connected', route: null, email: null, model: null };
    await expect(ask(s, 'Build me a 4-day plan')).rejects.toThrow();
    expect(model.requests).toHaveLength(0);
    expect(await rotation(s)).toEqual(['Push A', 'Pull A']);
  });
});

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
async function doRoutine(s: AppServices, gymId: string, routineId: string, reps: (setIndex: number, exerciseName: string) => number | null = () => null, addSetTo: string | null = null): Promise<{ sessionId: string; started: SessionAggregate }> {
  const started = await s.workout.start({ gymId, opId: `start-${routineId}-${String(h.clockMs)}`, checkIn: null, routineOf: routineId });
  if (!started.ok) throw new Error(started.error.message);
  const id = started.aggregate.session.id;
  // Ben adds a set mid-workout (`add_set` copies the last set's target).
  const addTo = addSetTo === null ? undefined : started.aggregate.exercises.find((e) => e.exerciseName === addSetTo);
  if (addTo !== undefined) {
    const r = await s.workout.dispatch(id, { type: 'add_set', at: h.now(), opId: `add-set-${id}`, sessionExerciseId: addTo.id, newSetId: h.ids(), setType: null });
    if (!r.ok) throw new Error(r.error.message);
  }
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
    const targets = await s2.progress.exerciseTargets(benchId, { targetsHit: true });
    expect(targets?.rows[0]).toMatchObject({ sessionId, target: '3 × 6–8', actual: '8, 8, 5', verdict: 'short' });
    expect(targets?.hitText).toMatch(/^Targets hit \d of last \d$/);
    // (Ben, 20 Oct) Setting off (the default): the per-workout rows stay, no `Targets hit`.
    const off = await s2.progress.exerciseTargets(benchId);
    expect(off?.rows[0]).toMatchObject({ sessionId, target: '3 × 6–8', verdict: 'short' });
    expect(off?.hitText).toBeNull();
    // Progress › Exercises tab: the same.
    expect((await s2.progress.exerciseTab({ exerciseId: benchId, period: '6m', targetsHit: true }))?.targets?.hitText).toMatch(/^Targets hit \d of last \d$/);
    const tabOff = await s2.progress.exerciseTab({ exerciseId: benchId, period: '6m' });
    expect(tabOff?.targets?.hitText).toBeNull();
    expect(tabOff?.targets?.rows[0]).toMatchObject({ sessionId, verdict: 'short' });

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

  it('a set Ben adds mid-workout is done beyond the plan: `4/3 sets` Over, and the header stays at the plan’s 9 (review S1)', async () => {
    const { s, gymId } = await benWithSetup();
    const { planId } = await buildFour(s);
    const card = await s.plans.card({ planId, versionN: 1 });
    expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: card?.planVersion ?? 0, mode: 'replace', opId: 'apply-s1' })).toMatchObject({ ok: true });
    const day1 = (await s.next.preview(gymId))?.routine?.id ?? '';
    h.clockMs += 3_600_000;
    const { sessionId } = await doRoutine(s, gymId, day1, (_i, name) => (name === 'Bench press' ? 8 : null), 'Bench press');
    const pvd = await s.workout.planVsDone(sessionId);
    expect(pvd?.rows.find((r) => r.name === 'Bench press')).toMatchObject({ text: '4/3 sets · 8, 8, 8, 8 of 6–8', verdict: 'over', plannedSets: 3, doneSets: 4 });
    expect(pvd?.header).toBe('9/9 planned sets');
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

  it('with a split, a plan day that isn’t a split day still comes up in turn: a full cycle walks every day (review B1)', async () => {
    const { s, gymId } = await benWithSetup();
    const snap = await s.training.snapshot();
    if (!snap) throw new Error('snapshot');
    expect(await s.training.change({ kind: 'preset_split', split: 'ppl' }, snap.profile.version, 'split-ppl')).toMatchObject({ ok: true });
    const { planId } = await buildFour(s);
    const card = await s.plans.card({ planId, versionN: 1 });
    expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: card?.planVersion ?? 0, mode: 'replace', opId: 'apply-split' })).toMatchObject({ ok: true });
    const walked: string[] = [];
    for (let i = 0; i < 8; i++) {
      h.clockMs += DAY;
      const up = await s.next.preview(gymId);
      walked.push(`${up?.title ?? '?'} ${String(up?.routine?.basis.kind === 'plan' ? up.routine.basis.dayN : 0)}`);
      await doRoutine(s, gymId, up?.routine?.id ?? '');
    }
    expect(walked).toEqual(['Push 1', 'Pull 2', 'Legs 3', 'Upper 4', 'Push 1', 'Pull 2', 'Legs 3', 'Upper 4']);
  });

  it('a plan in another structure from the Profile split (Upper/Lower while PPL) drives Up next (review B1)', async () => {
    const { s, gymId } = await benWithSetup();
    const snap = await s.training.snapshot();
    if (!snap) throw new Error('snapshot');
    expect(await s.training.change({ kind: 'preset_split', split: 'ppl' }, snap.profile.version, 'split-ppl')).toMatchObject({ ok: true });
    const upperLower: [string, string | null, Ex[]][] = [
      ['Upper', null, [['Bench press', { load: kgLoad(100) }], ['Lat pulldown', { load: kgLoad(60, 'stack') }]]],
      ['Lower', null, [['Back squat', { load: kgLoad(100) }]]],
    ];
    model = new StepModel([planStub(upperLower, 'Upper and lower, as asked.'), () => replyWith('Here.')]);
    const r = await ask(s, 'Build me an upper/lower plan, 2 days');
    const rec = r.cards[0]?.record;
    if (rec?.detail.kind !== 'build_plan') throw new Error('no plan');
    const planId = rec.detail.planId;
    const card = await s.plans.card({ planId, versionN: 1 });
    expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: card?.planVersion ?? 0, mode: 'replace', opId: 'apply-ul' })).toMatchObject({ ok: true });
    const walked: string[] = [];
    for (let i = 0; i < 4; i++) {
      h.clockMs += DAY;
      const up = await s.next.preview(gymId);
      expect(up?.routine?.basis.kind).toBe('plan');
      walked.push(up?.title ?? '?');
      await doRoutine(s, gymId, up?.routine?.id ?? '');
    }
    expect(walked).toEqual(['Upper', 'Lower', 'Upper', 'Lower']);
  });

  it('a second plan applied over the first ends it: the first card shows it ended (no Undo); the second’s Undo brings the first back (review S3)', async () => {
    const { s, gymId } = await benWithSetup();
    const first = await buildFour(s);
    const c1 = await s.plans.card({ planId: first.planId, versionN: 1 });
    expect(await s.plans.apply({ planId: first.planId, versionN: 1, expectedVersion: c1?.planVersion ?? 0, mode: 'replace', opId: 'apply-first' })).toMatchObject({ ok: true });
    const upperLower: [string, string | null, Ex[]][] = [
      ['Upper', null, [['Bench press', { load: kgLoad(100) }], ['Lat pulldown', { load: kgLoad(60, 'stack') }]]],
      ['Lower', null, [['Back squat', { load: kgLoad(100) }]]],
    ];
    model = new StepModel([planStub(upperLower, 'Upper and lower.'), () => replyWith('Here.')]);
    const r = await ask(s, 'Build me an upper/lower plan, 2 days');
    const rec = r.cards[0]?.record;
    if (rec?.detail.kind !== 'build_plan') throw new Error('no plan');
    const secondId = rec.detail.planId;
    expect(secondId).not.toBe(first.planId);
    const c2 = await s.plans.card({ planId: secondId, versionN: 1 });
    expect(c2?.replaces).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect(await s.plans.apply({ planId: secondId, versionN: 1, expectedVersion: c2?.planVersion ?? 0, mode: 'replace', opId: 'apply-second' })).toMatchObject({ ok: true });
    expect(await rotation(s)).toEqual(['Upper', 'Lower']);
    // The first card: ended, no Undo; an Undo from it changes nothing and names nothing.
    const old = await s.plans.card({ planId: first.planId, versionN: 1 });
    expect(old?.state).toEqual({ kind: 'superseded' });
    expect(await s.plans.undo({ planId: first.planId, expectedVersion: c1?.planVersion ?? 0, opId: 'undo-first-old' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await s.plans.undo({ planId: first.planId, expectedVersion: old?.planVersion ?? 0, opId: 'undo-first' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await rotation(s)).toEqual(['Upper', 'Lower']);
    expect((await s.plans.active())?.planId).toBe(secondId);
    expect(await s.next.preview(gymId)).toMatchObject({ title: 'Upper', routine: { basis: { kind: 'plan', dayN: 1, of: 2 } } });
    // Undo of the second: the first plan's days and the first plan are back, as the plan in use.
    const now2 = await s.plans.card({ planId: secondId, versionN: 1 });
    expect(await s.plans.undo({ planId: secondId, expectedVersion: now2?.planVersion ?? 0, opId: 'undo-second' })).toMatchObject({ ok: true });
    expect(await rotation(s)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect((await s.plans.active())?.planId).toBe(first.planId);
    expect((await s.plans.card({ planId: first.planId, versionN: 1 }))?.state).toMatchObject({ kind: 'applied', mode: 'replace' });
    expect((await s.plans.card({ planId: secondId, versionN: 1 }))?.state).toEqual({ kind: 'open' });
    expect(await s.next.preview(gymId)).toMatchObject({ title: 'Push', routine: { basis: { kind: 'plan', dayN: 1, of: 4 } } });
    // And the first plan's Undo works again: Push A and Pull A back.
    const back = await s.plans.card({ planId: first.planId, versionN: 1 });
    expect(await s.plans.undo({ planId: first.planId, expectedVersion: back?.planVersion ?? 0, opId: 'undo-first-2' })).toMatchObject({ ok: true });
    expect(await rotation(s)).toEqual(['Push A', 'Pull A']);
  });

  it('a stale Apply writes nothing to Ben’s data, not even the catalogue exercises the plan names (review S4)', async () => {
    const { s } = await benWithSetup();
    const stored = new Set((await s.coachingKnowledge.exercises()).map((e) => e.id));
    // A plan naming a catalogue exercise that isn't one of Ben's rows yet.
    let extra = '';
    const withExtra = (req: ModelRequest): ModelEvent[] => {
      const b = buildOf(req);
      extra = b.usable.find((u) => !stored.has(u.catalogueId))?.catalogueId ?? '';
      const bench = b.usable.find((u) => u.name === 'Bench press')?.catalogueId ?? '';
      return toolCall('propose_plan', { days: [{ dayName: 'Push', splitDayId: 'push', focus: null, minutes: null, exercises: [ex(bench, { load: kgLoad(100) }), ex(extra)] }, { dayName: 'Legs', splitDayId: 'legs', focus: null, minutes: null, exercises: [ex(bench)] }], message: 'Two days.', minutes: null, gymName: null });
    };
    model = new StepModel([withExtra, () => replyWith('Here.')]);
    const first = await ask(s, 'Build me a 2-day plan');
    const rec = first.cards[0]?.record;
    if (rec?.detail.kind !== 'build_plan') throw new Error('no plan');
    const planId = rec.detail.planId;
    expect(extra).not.toBe('');
    const v1 = await s.plans.card({ planId, versionN: 1 });
    const extraId = (await s.plans.day({ planId, versionN: 1, dayIndex: 0 }))?.rows[1]?.exerciseId ?? '';
    expect(stored.has(extraId) || extraId === '').toBe(false);
    model = new StepModel([withExtra, () => replyWith('Again.')]);
    expect((await ask(s, 'make the legs day different', first.threadId)).cards[0]?.record.detail).toMatchObject({ kind: 'build_plan', versionN: 2 });
    expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: v1?.planVersion ?? 0, mode: 'replace', opId: 'apply-stale' })).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.coachingKnowledge.exercises()).some((e) => e.id === extraId)).toBe(false);
    // The current card applies, and the new exercise is saved with it.
    const v2 = await s.plans.card({ planId, versionN: 2 });
    expect(await s.plans.apply({ planId, versionN: 2, expectedVersion: v2?.planVersion ?? 0, mode: 'replace', opId: 'apply-ok' })).toMatchObject({ ok: true });
    expect((await s.coachingKnowledge.exercises()).some((e) => e.id === extraId)).toBe(true);
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

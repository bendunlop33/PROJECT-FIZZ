import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, SetupInput } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Review b3-builder-20oct fixes on real SQLite (B1–B4, S1–S9): each case
 * reproduces the reviewer's failure and checks the fixed behaviour.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-20T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? String(r.message) : ''}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};
const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((sl) => snap.facts[sl.exerciseId]?.name ?? '?');
const slotNamed = (snap: BuilderSnapshot, name: string) => {
  const sl = slotsOf(snap.workout.blocks).find((x) => snap.facts[x.exerciseId]?.name === name);
  if (sl === undefined) throw new Error(`no ${name} in ${names(snap).join(', ')}`);
  return sl;
};
const pushSetup = async (s: AppServices, over: Partial<SetupInput> = {}): Promise<SetupInput> => ({ ...(await s.builder.initialSetup({ dayId: 'push' })), ...over });

async function withPushdown(s: AppServices, snap: BuilderSnapshot): Promise<BuilderSnapshot> {
  if (names(snap).includes('Triceps pushdown')) return snap;
  const c = await s.builder.exerciseChoices(snap.draftId, { slotKey: null, group: 'Triceps' });
  const pd = c?.sections.flatMap((x) => x.items).find((i) => i.name === 'Triceps pushdown');
  if (pd === undefined) throw new Error('no pushdown');
  return ok(await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: pd.exerciseId }, { opId: 'add-pd', basis: { version: snap.version } })).snapshot;
}

describe('B3: the built-in rule’s load stands as the rule gave it', () => {
  it('hold after a miss on 8–12: 50 × 9 @ 8 stays 50, Why reads Last time', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Triceps pushdown', sets: [{ load: 50, reps: 9, rpe: 8 }, { load: 50, reps: 9, rpe: 8 }, { load: 50, reps: 9, rpe: 8 }] }]);
    h.clockMs += DAY;
    const snap = await withPushdown(s, ok(await s.builder.create(await pushSetup(s), 'c-1')).snapshot);
    const pd = slotNamed(snap, 'Triceps pushdown');
    expect(pd.source).toBe('rule');
    const work = pd.rows.filter((r) => r.type !== 'warmup');
    expect(work.every((r) => r.load === 50)).toBe(true);
    expect(await s.builder.whyWeight(snap.draftId, pd.key)).toEqual(['Last time']);
  });

  it('an increase on 8–12 is the rule’s own next load, never more', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Triceps pushdown', sets: [{ load: 50, reps: 12, rpe: 8 }, { load: 50, reps: 12, rpe: 8 }, { load: 50, reps: 12, rpe: 8 }] }]);
    h.clockMs += DAY;
    const snap = await withPushdown(s, ok(await s.builder.create(await pushSetup(s), 'c-1')).snapshot);
    const pd = slotNamed(snap, 'Triceps pushdown');
    const work = pd.rows.filter((r) => r.type !== 'warmup').map((r) => r.load ?? 0);
    const top = Math.max(...work);
    expect(top).toBeGreaterThan(50);
    // One step up from last time (a stack step is at most 5 kg here), never a formula rescale.
    expect(top - 50).toBeLessThanOrEqual(5);
    const why = await s.builder.whyWeight(snap.draftId, pd.key);
    expect(why[0]).toBe(`Last time + ${String(top - 50)}`);
  });
});

// ---------------------------------------------------------------------------
// Plan days (as builder-service.test.ts)

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const DAYS: [string, string, string[]][] = [
  ['Push', 'push', ['Bench press', 'Incline dumbbell press', 'Triceps pushdown']],
  ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
  ['Legs', 'legs', ['Back squat', 'Leg curl']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull, legs.', minutes: null, gymName: null });
};

async function benWithPlan(): Promise<{ s: AppServices; gymId: string; push: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const card = result.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: card.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: card.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const push = (await s.plans.active())?.days[0]?.routineId;
  if (push === undefined) throw new Error('no push day');
  return { s, gymId, push };
}

export const template = async (s: AppServices, id: string) => (await s.routines.editor({ routineId: id, gymId: null }))?.routine ?? null;

describe('B1: a new Day or Main lift moves the draft’s plan day', () => {
  it('Push template → Set up → Legs → Start records Legs, and a later Push opens a fresh draft', async () => {
    const { s, gymId, push } = await benWithPlan();
    const snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    expect(snap.planDay?.splitDayId).toBe('push');
    const legs = await s.builder.initialSetup({ dayId: 'legs' });
    const rebuilt = ok(await s.builder.changeSetup(snap.draftId, { ...legs, minutes: snap.setup.minutes }, { opId: 'day-legs', expectedVersion: snap.version }));
    expect(rebuilt.toast?.text).toBe('Rebuilt');
    expect(rebuilt.snapshot.planDay).toMatchObject({ splitDayId: 'legs', dayIndex: 2 });
    expect(names(rebuilt.snapshot)).toContain('Back squat');

    // Undo puts the Push key back with both pages.
    const back = ok(await s.builder.undo(snap.draftId, 'day-legs', 'u-1')).snapshot;
    expect(back.planDay?.splitDayId).toBe('push');
    const again = ok(await s.builder.changeSetup(snap.draftId, { ...legs, minutes: snap.setup.minutes }, { opId: 'day-legs-2', expectedVersion: back.version })).snapshot;

    const r = await s.builder.start(again.draftId, { choice: { kind: 'today' }, opId: 'start-1', expectedVersion: again.version, gymId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = (await s.workout.load(r.sessionId))?.aggregate;
    expect(a?.session.planDay).toMatchObject({ splitDayId: 'legs', dayIndex: 2 });
    // Push is free again: a new Push open makes a new draft, not the started Legs one.
    const pushAgain = ok(await s.builder.openTemplate({ routineId: push }, 'open-2')).snapshot;
    expect(pushAgain.draftId).not.toBe(snap.draftId);
  });

  it('a change to Custom records no plan day', async () => {
    const { s, gymId, push } = await benWithPlan();
    const snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const custom: SetupInput = { ...snap.setup, dayId: 'custom', dayName: 'Custom', dayParts: [], mainLiftExerciseId: null, variationId: null, groups: [{ group: 'Chest', count: 2 }], groupsEdited: true };
    const c = ok(await s.builder.changeSetup(snap.draftId, custom, { opId: 'custom-1', expectedVersion: snap.version })).snapshot;
    expect(c.planDay).toBeNull();
    const r = await s.builder.start(c.draftId, { choice: { kind: 'today' }, opId: 'start-c', expectedVersion: c.version, gymId });
    if (!r.ok) throw new Error(r.message);
    expect((await s.workout.load(r.sessionId))?.aggregate.session.planDay).toBeUndefined();
  });

  it('a Day change onto a day that already has an open draft today resumes that one', async () => {
    const { s, push } = await benWithPlan();
    const legsSetup = await s.builder.initialSetup({ dayId: 'legs' });
    const legs = ok(await s.builder.create(legsSetup, 'legs-1')).snapshot;
    const snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const moved = ok(await s.builder.changeSetup(snap.draftId, { ...legsSetup }, { opId: 'to-legs', expectedVersion: snap.version }));
    expect(moved.snapshot.draftId).toBe(legs.draftId);
    // The Push draft is untouched.
    expect((await s.builder.read(snap.draftId))?.planDay?.splitDayId).toBe('push');
  });
});

describe('B2: Set up over a template changes nothing until Ben changes it', () => {
  it('Set up shows the template’s groups; Next with nothing changed writes nothing', async () => {
    const { s, push } = await benWithPlan();
    const snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const facts = await s.builder.setupFacts(snap.setup);
    expect(facts.loaded).toEqual(snap.setup.groups);
    const next = await s.builder.changeSetup(snap.draftId, snap.setup, { opId: 'next-1', expectedVersion: snap.version });
    expect(next.status).toBe('replayed');
    expect(next.snapshot && names(next.snapshot)).toEqual(['Bench press', 'Incline dumbbell press', 'Triceps pushdown']);
    expect((await s.builder.read(snap.draftId))?.version).toBe(snap.version);
    expect(await s.builder.startPrompt(snap.draftId)).toBeNull();
    // Only Length changed: sets merge, no new exercises.
    const longer = ok(await s.builder.changeSetup(snap.draftId, { ...snap.setup, minutes: snap.setup.minutes + 5 }, { opId: 'len-1', expectedVersion: snap.version })).snapshot;
    expect(names(longer)).toEqual(['Bench press', 'Incline dumbbell press', 'Triceps pushdown']);
  });
});

async function benBench(): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
  h.clockMs += DAY;
  return { s, gymId };
}

/** Push with Bench press as the main lift (top set + back-offs). */
async function benchDraft(s: AppServices): Promise<BuilderSnapshot> {
  const base = await pushSetup(s, { supersets: false, mainLiftExerciseId: null });
  const bench = (await s.builder.setupFacts(base)).mainLifts.find((m) => m.name === 'Bench press');
  if (bench === undefined) throw new Error('no bench');
  return ok(await s.builder.create({ ...base, mainLiftExerciseId: bench.id }, 'c-bench')).snapshot;
}

const benchSets = async (s: AppServices, sessionId: string) => {
  const a = (await s.workout.load(sessionId))?.aggregate;
  const ex = a?.exercises.find((e) => e.exerciseName === 'Bench press');
  return (a?.sets ?? []).filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup');
};

describe('B4: Start re-checks pain and history', () => {
  it('a pain flag raised after the build holds bench at the last comparable load (rule 9)', async () => {
    const { s, gymId } = await benBench();
    const snap = await benchDraft(s);
    const bench = slotNamed(snap, 'Bench press');
    expect(bench.rows.find((r) => r.type === 'top')?.load).toBe(102.5);
    expect((await s.pain.flagMovement({ exerciseId: bench.exerciseId, exerciseName: 'Bench press', opId: 'pain-1' })).ok).toBe(true);
    const r = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-1', expectedVersion: snap.version, gymId });
    if (!r.ok) throw new Error(r.message);
    const sets = await benchSets(s, r.sessionId);
    expect(sets.length).toBeGreaterThan(0);
    for (const x of sets) expect(x.planned.load?.value ?? 0).toBeLessThanOrEqual(100);
    expect(sets.some((x) => x.planned.provenance?.held === true)).toBe(true);
  });

  it('a draft built before bench was logged again is re-derived at Start', async () => {
    const { s, gymId } = await benBench();
    const snap = await benchDraft(s);
    expect(slotNamed(snap, 'Bench press').rows.find((r) => r.type === 'top')?.load).toBe(102.5);
    // A heavier bench is logged after the build (another workout that day).
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 110, reps: 6, rpe: 8 }, { load: 110, reps: 6, rpe: 8 }, { load: 110, reps: 6, rpe: 8 }] }]);
    const fresh = await s.builder.read(snap.draftId);
    if (fresh === null) throw new Error('draft');
    const r = await s.builder.start(fresh.draftId, { choice: { kind: 'today' }, opId: 'start-1', expectedVersion: fresh.version, gymId });
    if (!r.ok) throw new Error(r.message);
    const top = Math.max(...(await benchSets(s, r.sessionId)).map((x) => x.planned.load?.value ?? 0));
    expect(top).toBeGreaterThanOrEqual(110);
  });
});

describe('S7: each builder load keeps its reason in the session', () => {
  it('a rule load is the built-in rule; a typed kg says so', async () => {
    const { s, gymId } = await benBench();
    let snap = await benchDraft(s);
    const bench = slotNamed(snap, 'Bench press');
    const backoff = bench.rows.findIndex((r) => r.type === 'backoff');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: bench.key, index: backoff, patch: { kind: 'load', value: 90 } }, { opId: 'kg-1', basis: { version: snap.version } })).snapshot;
    const r = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-1', expectedVersion: snap.version, gymId });
    if (!r.ok) throw new Error(r.message);
    const sets = (await benchSets(s, r.sessionId)).sort((a, b) => a.index - b.index);
    const top = sets.find((x) => x.setType === 'top');
    expect(top?.planned.source).toBe('built_in_rule');
    expect(top?.planned.provenance?.source).toBe('rule');
    const typed = sets.find((x) => x.planned.load?.value === 90);
    expect(typed?.planned.provenance?.guardNotes).toContain('Typed by you');
  });
});

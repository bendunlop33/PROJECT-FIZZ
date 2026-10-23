import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, SetupInput } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';
import { seedVariation } from './variation-fixture';

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

    const r = await s.builder.start(again.draftId, { opId: 'start-1', expectedVersion: again.version, gymId });
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
    const r = await s.builder.start(c.draftId, { opId: 'start-c', expectedVersion: c.version, gymId });
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
    const r = await s.builder.start(snap.draftId, { opId: 'start-1', expectedVersion: snap.version, gymId });
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
    const r = await s.builder.start(fresh.draftId, { opId: 'start-1', expectedVersion: fresh.version, gymId });
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
    const r = await s.builder.start(snap.draftId, { opId: 'start-1', expectedVersion: snap.version, gymId });
    if (!r.ok) throw new Error(r.message);
    const sets = (await benchSets(s, r.sessionId)).sort((a, b) => a.index - b.index);
    const top = sets.find((x) => x.setType === 'top');
    expect(top?.planned.source).toBe('built_in_rule');
    expect(top?.planned.provenance?.source).toBe('rule');
    const typed = sets.find((x) => x.planned.load?.value === 90);
    expect(typed?.planned.provenance?.guardNotes).toContain('Typed by you');
  });
});

describe('S1, S9 (D1): Keep for next time’s Undo survives a relaunch and a retry is idempotent', () => {
  it('Apply stores the inverse with the workout; Undo twice is ok; once the plan day changed again it is refused', async () => {
    const { s, gymId, push } = await benWithPlan();
    let snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const pd = slotNamed(snap, 'Triceps pushdown');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: pd.key }, { opId: 'set-1', basis: { version: snap.version } })).snapshot;
    const r = await s.builder.start(snap.draftId, { opId: 'start-1', expectedVersion: snap.version, gymId });
    if (!r.ok) throw new Error(r.message);
    await finishOne(s, r.sessionId);
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toEqual({ ok: true });
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect((await s2.builder.keepNextTimeOf(r.sessionId))?.state).toBe('kept');
    expect(await s2.builder.undoKeepNextTime(r.sessionId)).toEqual({ ok: true });
    expect(await s2.builder.undoKeepNextTime(r.sessionId)).toEqual({ ok: true });

    // A second workout: kept, then the plan day changes elsewhere; Undo is refused and the line has no Undo.
    let again = ok(await s2.builder.openTemplate({ routineId: push }, 'open-2')).snapshot;
    again = ok(await s2.builder.edit(again.draftId, { kind: 'add_set', slotKey: slotNamed(again, 'Triceps pushdown').key }, { opId: 'set-2', basis: { version: again.version } })).snapshot;
    const r2 = await s2.builder.start(again.draftId, { opId: 'start-2', expectedVersion: again.version, gymId });
    if (!r2.ok) throw new Error(r2.message);
    await finishOne(s2, r2.sessionId);
    expect(await s2.builder.keepNextTime(r2.sessionId, 'apply')).toEqual({ ok: true });
    const t = await template(s2, push);
    expect((await s2.routines.rename({ routineId: push, name: 'Push A', expectedVersion: t?.version ?? 0, opId: 'rename-1' })).ok).toBe(true);
    expect(await s2.builder.undoKeepNextTime(r2.sessionId)).toEqual({ ok: false, reason: 'stale', message: 'Changed since · can’t undo' });
    expect(await s2.builder.keepNextTimeOf(r2.sessionId)).toMatchObject({ state: 'kept', canUndo: false });
    expect((await template(s2, push))?.exercises.find((e) => e.exerciseId === pd.exerciseId)?.setTemplates.filter((x) => x.setType !== 'warmup')).toHaveLength(4);
  });
});

describe('variations Ben saved before D1: open, rename and delete; Start today only, no Keep for next time', () => {
  async function withVariation(s: AppServices, push: string): Promise<{ s: AppServices; variationId: string }> {
    const snap = ok(await s.builder.openTemplate({ routineId: push }, 'peek-v')).snapshot;
    const pd = slotNamed(snap, 'Triceps pushdown');
    const variationId = '7a7a7a7a-0000-4000-8000-000000000001';
    const s2 = await seedVariation(h, s, { id: variationId, templateRoutineId: push, splitDayId: snap.setup.dayId, mainLiftExerciseId: snap.setup.mainLiftExerciseId, label: 'more sets', extras: [{ kind: 'set_count', exerciseId: pd.exerciseId, n: 4 }] });
    return { s: s2, variationId };
  }

  it('an open variation starts today only; the Summary doesn’t offer Keep for next time (its ops can’t take a swap)', async () => {
    const { s: s0, gymId, push } = await benWithPlan();
    const { s, variationId } = await withVariation(s0, push);
    let snap = ok(await s.builder.openTemplate({ routineId: push, variationId }, 'open-2')).snapshot;
    expect(snap.variationLabel).toBe('more sets');
    const bench = slotNamed(snap, 'Bench press');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: bench.key }, { opId: 'set-2', basis: { version: snap.version } })).snapshot;
    const r = await s.builder.start(snap.draftId, { opId: 'start-v', expectedVersion: snap.version, gymId });
    if (!r.ok) throw new Error(r.message);
    expect((await s.workout.load(r.sessionId))?.aggregate.session.planDay?.variationId).toBe(variationId);
    await finishOne(s, r.sessionId);
    expect(await s.builder.keepNextTimeOf(r.sessionId)).toBeNull();
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toMatchObject({ ok: false, reason: 'gone' });
  });

  it('Rename and Delete a variation; Undo puts it back', async () => {
    const { s: s0, push } = await benWithPlan();
    const { s, variationId } = await withVariation(s0, push);
    const setup = { ...(await s.builder.initialSetup({ dayId: 'push' })) };
    const facts = async () => (await s.builder.setupFacts({ ...setup, mainLiftExerciseId: (await s.builder.read((ok(await s.builder.openTemplate({ routineId: push }, 'peek')).snapshot.draftId)))?.setup.mainLiftExerciseId ?? null })).variations;
    let v = (await facts()).find((x) => x.id === variationId);
    expect(await s.builder.renameVariation(variationId, 'arm day', { opId: 'rn-1', expectedVersion: v?.version ?? 0 })).toEqual({ ok: true });
    expect(await s.builder.renameVariation(variationId, 'arm day', { opId: 'rn-1', expectedVersion: v?.version ?? 0 })).toEqual({ ok: true });
    v = (await facts()).find((x) => x.id === variationId);
    expect(v?.label).toBe('arm day');
    const del = await s.builder.deleteVariation(variationId, { opId: 'del-1', expectedVersion: v?.version ?? 0 });
    if (!del.ok) throw new Error(del.message);
    expect(await facts()).toEqual([]);
    expect(await s.builder.undoDeleteVariation(del.undo, 'undel-1')).toEqual({ ok: true });
    expect((await facts()).map((x) => x.label)).toEqual(['arm day']);
  });
});

describe('S6: a typed kg the gym can’t make is rounded down, with the item named', () => {
  it('typed 101 on bench becomes 100; the toast and Why? say so', async () => {
    const { s } = await benBench();
    const snap = await benchDraft(s);
    const bench = slotNamed(snap, 'Bench press');
    const top = bench.rows.findIndex((r) => r.type === 'top');
    const r = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: bench.key, index: top, patch: { kind: 'load', value: 101 } }, { opId: 'kg-101', basis: { version: snap.version } }));
    expect(slotNamed(r.snapshot, 'Bench press').rows[top]?.load).toBe(100);
    expect(r.toast?.text).toBe('Rounded to 100 kg');
    expect(r.toast?.why).toMatch(/^Rounded down: /);
    // After a relaunch too.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const why = await s2.builder.whyWeight(snap.draftId, bench.key);
    expect(why).toContain('Typed by you');
    expect(why.some((l) => l.startsWith('Rounded down: '))).toBe(true);
  });
});

describe('S8 (D1): Keep for next time keeps the structure only; Ben’s rests and length stay today’s', () => {
  it('a set count goes to the template; a rest change and Set up’s length don’t', async () => {
    const { s, gymId, push } = await benWithPlan();
    const before = await template(s, push);
    let snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const pd = slotNamed(snap, 'Triceps pushdown');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: pd.key }, { opId: 'set-1', basis: { version: snap.version } })).snapshot;
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'rest', slotKey: pd.key, restKind: 'working', seconds: 120 }, { opId: 'rest-1', basis: { version: snap.version } })).snapshot;
    snap = ok(await s.builder.changeSetup(snap.draftId, { ...snap.setup, minutes: snap.setup.minutes + 1 }, { opId: 'len-1', expectedVersion: snap.version })).snapshot;
    const r = await s.builder.start(snap.draftId, { opId: 'start-1', expectedVersion: snap.version, gymId });
    if (!r.ok) throw new Error(r.message);
    await finishOne(s, r.sessionId);
    expect(await s.builder.keepNextTimeOf(r.sessionId)).toMatchObject({ state: 'open', lines: ['Triceps pushdown: 3 → 4 sets'] });
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toEqual({ ok: true });
    const t = await template(s, push);
    const was = before?.exercises.find((e) => e.exerciseId === pd.exerciseId);
    const now = t?.exercises.find((e) => e.exerciseId === pd.exerciseId);
    expect(now?.setTemplates.filter((x) => x.setType !== 'warmup')).toHaveLength(4);
    expect(now?.restBySetType).toEqual(was?.restBySetType);
    expect(t?.planDay?.minutes).toBe(before?.planDay?.minutes);
  });
});

/** Log one set and finish, so the next Start can run (one workout at a time). */
async function finishOne(s: AppServices, sessionId: string): Promise<void> {
  const a = (await s.workout.load(sessionId))?.aggregate;
  const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
  if (a === undefined || set === undefined) throw new Error('no set');
  const conv = a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
  h.clockMs += 60_000;
  expect((await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() })).ok).toBe(true);
  h.clockMs += 60_000;
  const now = await s.workout.load(sessionId);
  expect((await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null })).ok).toBe(true);
  await h.settle(s);
  h.clockMs += DAY;
}

describe('S10: gym changed, plan day reloaded silently, Not applied · Add anyway, check-in at Start', () => {
  it('another gym selected: loads re-rounded there, Undo puts the gym back and it stays', async () => {
    const { s, gymId } = await benBench();
    const snap = await benchDraft(s);
    expect(snap.gymChanged).toBe(false);
    const hotel = h.ids();
    expect((await s.setup.saveGym({ gymId: hotel, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(hotel)).ok).toBe(true);
    const at = await s.builder.read(snap.draftId);
    expect(at?.gymChanged).toBe(true);
    const moved = ok(await s.builder.changeGym(snap.draftId, { opId: 'gym-1', expectedVersion: at?.version ?? 0 }));
    expect(moved.toast).toEqual({ text: 'Gym changed', undoOpId: 'gym-1', why: null });
    expect(moved.snapshot.gymChanged).toBe(false);
    // Dumbbells only: no barbell bench here; it's swapped or marked, never kept at a barbell load.
    const benchNow = slotsOf(moved.snapshot.workout.blocks).find((x) => x.exerciseId === slotNamed(snap, 'Bench press').exerciseId);
    if (benchNow !== undefined) expect(moved.snapshot.facts[benchNow.exerciseId]?.notHere).toBe(true);
    const back = ok(await s.builder.undo(snap.draftId, 'gym-1', 'u-gym'));
    expect(names(back.snapshot)).toEqual(names(snap));
    expect(back.snapshot.gymChanged).toBe(false);
    const r = await s.builder.start(snap.draftId, { opId: 'start-1', expectedVersion: back.snapshot.version });
    if (!r.ok) throw new Error(r.message);
    expect((await s.workout.load(r.sessionId))?.aggregate.session.gymId).toBe(gymId);
  });

  it('the template changed and Ben hasn’t edited the draft: the snapshot asks for a silent reload', async () => {
    const { s, push } = await benWithPlan();
    const snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const t = await template(s, push);
    expect((await s.routines.rename({ routineId: push, name: 'Push A', expectedVersion: t?.version ?? 0, opId: 'rename-1' })).ok).toBe(true);
    const read = await s.builder.read(snap.draftId);
    expect(read?.planDayChanged?.silent).toBe(true);
    const r = ok(await s.builder.reloadPlanDay(snap.draftId, { opId: 'reload-1', expectedVersion: read?.version ?? 0, silent: true }));
    expect(r.toast).toBeNull();
    expect(r.snapshot.planDayChanged).toBeNull();
    expect(r.snapshot.planDay?.templateVersion).toBe((t?.version ?? 0) + 1);
  });

  it('a variation op whose anchor left the template shows Not applied after a relaunch, and Add anyway adds it', async () => {
    const { s: s0, gymId, push } = await benWithPlan();
    // A variation from before D1: a curl after Triceps pushdown, paired with it.
    const snap = ok(await s0.builder.openTemplate({ routineId: push }, 'open-1')).snapshot;
    const c = await s0.builder.exerciseChoices(snap.draftId, { slotKey: null, group: 'Biceps' });
    const curl = c?.sections.flatMap((x) => x.items).find((i) => !i.mayHurt);
    if (curl === undefined) throw new Error('no curl');
    const pdId = slotNamed(snap, 'Triceps pushdown').exerciseId;
    const variationId = '7a7a7a7a-0000-4000-8000-000000000002';
    const s = await seedVariation(h, s0, { id: variationId, templateRoutineId: push, splitDayId: snap.setup.dayId, mainLiftExerciseId: snap.setup.mainLiftExerciseId, label: 'arms superset', extras: [{ kind: 'add_slot', after: pdId, slot: { exerciseId: curl.exerciseId } }, { kind: 'pair', a: pdId, b: curl.exerciseId }] });
    // The template loses Triceps pushdown (the pair's anchor): Ben deletes it and keeps that for next time.
    let tplSnap = ok(await s.builder.openTemplate({ routineId: push }, 'open-2')).snapshot;
    tplSnap = ok(await s.builder.edit(tplSnap.draftId, { kind: 'delete_exercise', slotKey: slotNamed(tplSnap, 'Triceps pushdown').key }, { opId: 'del-pd', basis: { version: tplSnap.version } })).snapshot;
    const up = await s.builder.start(tplSnap.draftId, { opId: 'start-up', expectedVersion: tplSnap.version, gymId });
    if (!up.ok) throw new Error(up.message);
    await finishOne(s, up.sessionId);
    expect(await s.builder.keepNextTimeOf(up.sessionId)).toMatchObject({ state: 'open', lines: ['Delete Triceps pushdown'] });
    expect(await s.builder.keepNextTime(up.sessionId, 'apply')).toEqual({ ok: true });
    const opened = ok(await s.builder.openTemplate({ routineId: push, variationId }, 'open-3')).snapshot;
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = await s2.builder.read(opened.draftId);
    // The curl was added after Triceps pushdown and paired with it: both ops lost their anchor.
    expect(again?.skipped.map((x) => x.op.kind)).toEqual(['add_slot', 'pair']);
    expect(again?.facts[pdId]?.name).toBe('Triceps pushdown');
    // Add anyway: the missing exercises come back, and the lines go.
    let added = ok(await s2.builder.edit(opened.draftId, { kind: 'add_exercise', exerciseId: curl.exerciseId }, { opId: 'add-anyway-1', basis: { version: again?.version ?? 0 } })).snapshot;
    expect(added.skipped.map((x) => x.op.kind)).toEqual(['pair']);
    added = ok(await s2.builder.edit(opened.draftId, { kind: 'add_exercise', exerciseId: pdId }, { opId: 'add-anyway-2', basis: { version: added.version } })).snapshot;
    expect(names(added)).toEqual(expect.arrayContaining(['Triceps pushdown', curl.name]));
    expect(added.skipped).toEqual([]);
  });
});

describe('Re-review R5 (retire-workout-overview): a plan day from a plan no longer in use', () => {
  it('opens as a library workout (no plan-day key); while the plan is in use it opens as its plan day', async () => {
    const { s, push } = await benWithPlan();
    const inUse = ok(await s.builder.openTarget({ kind: 'routine', routineId: push }, 'open-in-use')).snapshot;
    expect(inUse.planDay).not.toBeNull();
    expect(inUse.from).toBeNull();
    const planId = (await s.plans.active())?.planId ?? '';
    const v = await s.plans.overview();
    expect(await s.plans.end({ planId, expectedVersion: v?.planVersion ?? 0, opId: 'end-r5' })).toMatchObject({ ok: true });
    const old = ok(await s.builder.openTarget({ kind: 'routine', routineId: push }, 'open-old-plan')).snapshot;
    expect(old.draftId).not.toBe(inUse.draftId);
    expect(old.planDay).toBeNull();
    expect(old.from).toEqual({ kind: 'routine', id: push });
    expect(names(old).length).toBeGreaterThan(0);
  });
});

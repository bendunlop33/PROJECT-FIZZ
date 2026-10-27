import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, slotsOf } from '@fizz/domain';
import type { RoutineExercise } from '@fizz/schemas';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { addAnywayConfirm, workoutView } from '../src/builder/builder-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';
import { finishWorkout } from './finish-workout';

/**
 * Your workout's Time, the 22 Oct review fixes, on real SQLite, offline:
 * - B1: `Update … in your plan` keeps the plan day's own length, never Time's (with or without a cut);
 * - B2: going back to Set up after a fit keeps Time (merged into the original, fitted again), or ends it when Ben
 *   sets a new Length; never a fit's rest level without its note;
 * - B3: a past workout opened with `do again` protects its main lift (WL9 at read);
 * - Gym changed keeps an exercise's two copies by identity, however they were reordered or deleted;
 * - the coach's version keeps shortened rests honest (a rests-only note with Undo);
 * - `Add anyway` asks first for a `May hurt` exercise (rule 9); the Time detail keys lines by place.
 */

const DAY = 86_400_000;
const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-05T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`write ${r.status}: ${r.message}`);
};

async function bigPush(s: AppServices) {
  const gymId = await setUpGym(h, s);
  const three = (load: number, reps: number) => [0, 1, 2].map(() => ({ load, reps, rpe: 8 }));
  const sid = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: three(100, 6) },
    { exercise: 'Incline dumbbell press', sets: three(27.5, 9) },
    { exercise: 'Face pull', sets: three(20, 12) },
    { exercise: 'Triceps pushdown', sets: three(30, 12) },
    { exercise: 'Lateral raise', sets: three(8, 12) },
  ]);
  h.clockMs += DAY;
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId: sid }, name: 'Push B', addToRotation: true, opId: 'save-push-b' });
  if (!r.ok) throw new Error(r.message);
  return { gymId, routine: r.routine };
}

async function step(s: AppServices, snap: BuilderSnapshot, dir: 'less' | 'more', opId: string): Promise<BuilderSnapshot> {
  const to = workoutView(snap).time[dir];
  if (to === null) throw new Error(`no ${dir}`);
  return opened(await s.builder.setTime(snap.draftId, to, { opId, expectedVersion: snap.version }));
}

async function cutUntilDropped(s: AppServices, snap0: BuilderSnapshot): Promise<BuilderSnapshot> {
  let snap = snap0;
  for (let i = 0; i < 14 && snap.time?.changes.some((c) => c.kind === 'drop') !== true; i += 1) {
    if (workoutView(snap).time.less === null) break;
    snap = await step(s, snap, 'less', `less-${String(snap.version)}`);
  }
  return snap;
}

const keys = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).map((sl) => sl.key);
const counts = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).map((sl) => `${sl.key}×${String(sl.rows.filter((r) => r.type !== 'warmup').length)}`);

// ---------------------------------------------------------------------------
// B1: a plan day's length is never Time's

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const planEx = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const DAYS: [string, string, string[]][] = [
  ['Push', 'push', ['Bench press', 'Incline dumbbell press', 'Dumbbell shoulder press', 'Triceps pushdown', 'Lateral raise']],
  ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
  ['Legs', 'legs', ['Back squat', 'Leg curl']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => planEx(idOf(n))) })), message: 'Push, pull, legs.', minutes: null, gymName: null });
};

async function pushDay(s: AppServices): Promise<string> {
  await bigPush(s);
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const card = result.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: card.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: card.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const push = (await s.plans.active())?.days[0]?.routineId;
  if (push === undefined) throw new Error('no push day');
  return push;
}

describe('B1 (D1): Keep for next time keeps the plan day’s own length, never Time’s', () => {
  it('Time lowered with nothing cut (a step that only fits), then Ben’s own change: the plan day keeps the length it opened at; the session is today’s', async () => {
    const { services: s } = await h.launch();
    const push = await pushDay(s);
    const minutes0 = (await s.routines.editor({ routineId: push, gymId: null }))?.routine?.planDay?.minutes;
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: push }, 'open-day'));
    // Longer first (nothing cut, no fit record), then back down past the original: the length before Time stands.
    const longer = opened(await s.builder.setTime(snap0.draftId, snap0.setup.minutes + 20, { opId: 'longer', expectedVersion: snap0.version }));
    expect(longer.time).toBeNull();
    // (Ben, 27 Oct) `−` now steps from the live estimate (it cuts below the plan's length); a length above it only fits.
    const down = opened(await s.builder.setTime(longer.draftId, snap0.setup.minutes + 15, { opId: 'down-1', expectedVersion: longer.version }));
    expect(down.setup.minutes).toBe(snap0.setup.minutes + 15);
    expect(down.time).toBeNull();
    const bench = slotsOf(down.workout.blocks).find((x) => x.main);
    if (bench === undefined) throw new Error('no main');
    const edited = opened(await s.builder.edit(down.draftId, { kind: 'add_set', slotKey: bench.key }, { opId: 'own-change', basis: { version: down.version } }));
    const r = await s.builder.start(edited.draftId, { opId: 'start-1', expectedVersion: edited.version });
    if (!r.ok) throw new Error(r.message);
    await finishWorkout(h, s, r.sessionId);
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toEqual({ ok: true });
    const template = (await s.routines.editor({ routineId: push, gymId: null }))?.routine;
    expect(template?.planDay?.minutes).toBe(minutes0);
  });

  it('after a cut, Ben’s own change is the only line and the plan day keeps its length and every exercise', async () => {
    const { services: s } = await h.launch();
    const push = await pushDay(s);
    const template0 = (await s.routines.editor({ routineId: push, gymId: null }))?.routine;
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: push }, 'open-day-2'));
    const short = await cutUntilDropped(s, snap0);
    expect(short.setup.minutes).toBeLessThan(snap0.setup.minutes);
    const bench = slotsOf(short.workout.blocks).find((x) => x.main);
    if (bench === undefined) throw new Error('no main');
    const edited = opened(await s.builder.edit(short.draftId, { kind: 'add_set', slotKey: bench.key }, { opId: 'own-change-2', basis: { version: short.version } }));
    const r = await s.builder.start(edited.draftId, { opId: 'start-2', expectedVersion: edited.version });
    if (!r.ok) throw new Error(r.message);
    await finishWorkout(h, s, r.sessionId);
    expect(await s.builder.keepNextTimeOf(r.sessionId)).toMatchObject({ state: 'open', lines: [expect.stringMatching(/sets$/) as string] });
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toEqual({ ok: true });
    const template = (await s.routines.editor({ routineId: push, gymId: null }))?.routine;
    expect(template?.planDay?.minutes).toBe(template0?.planDay?.minutes);
    expect(template?.exercises.map((e) => e.exerciseId)).toEqual(template0?.exercises.map((e) => e.exerciseId));
  });
});

// ---------------------------------------------------------------------------
// B2: back to Set up after a fit

describe('B2: back to Set up after a Time fit', () => {
  it('Supersets turned on, Length left as Time’s: merged into the original and fitted again: Time, its note and Undo stay; more time brings everything back', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-b2'));
    expect(snap0.setup.supersets).toBe(false);
    let short = await cutUntilDropped(s, snap0);
    // Far enough under that pairs alone (Supersets on: a free saving, fit-to-time 22 Oct revision) can't fit it.
    for (let i = 0; i < 3 && workoutView(short).time.less !== null; i += 1) short = await step(s, short, 'less', `deeper-${String(i)}`);
    expect(workoutView(short).time.note).toMatch(/^−\d+ exercises?$/);
    const merged = opened(await s.builder.changeSetup(short.draftId, { ...short.setup, supersets: true }, { opId: 'supersets-on', expectedVersion: short.version }));
    expect(merged.setup.supersets).toBe(true);
    expect(merged.setup.minutes).toBe(short.setup.minutes);
    expect(merged.time).not.toBeNull();
    expect(workoutView(merged).time.undoMinutes).toBe(snap0.setup.minutes);
    // Rest level is the fit's, with its record; never a shortened level with nothing to say so.
    if (merged.workout.restLevel !== 'normal') expect(merged.time?.changes.some((c) => c.kind === 'rest')).toBe(true);
    // More time (the detail's Undo): every original exercise back, rests normal.
    const back = opened(await s.builder.setTime(merged.draftId, merged.time?.fromMinutes ?? 0, { opId: 'b2-back', expectedVersion: merged.version }));
    expect(back.time).toBeNull();
    expect(back.workout.restLevel).toBe('normal');
    expect(new Set(keys(back))).toEqual(new Set(keys(snap0)));
  });

  it('a new Length in Set up is Ben’s set-up length: Time ends, the change merges into the original (what Time cut is back)', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-b2b'));
    const short = await cutUntilDropped(s, snap0);
    const longer = snap0.setup.minutes + 5;
    const merged = opened(await s.builder.changeSetup(short.draftId, { ...short.setup, minutes: longer }, { opId: 'new-length', expectedVersion: short.version }));
    expect(merged.setup.minutes).toBe(longer);
    expect(merged.time).toBeNull();
    for (const k of keys(snap0)) expect(keys(merged)).toContain(k);
  });
});

// ---------------------------------------------------------------------------
// B3: a past workout's main lift

describe('B3: a past workout opened with `do again` keeps its main lift whole', () => {
  it('no stored Main: the WL9 rule at read marks bench; every Time step leaves its sets as they were', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const five = [0, 1, 2, 3, 4].map(() => ({ load: 100, reps: 5, rpe: 8 }));
    const sid = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: five },
      { exercise: 'Incline dumbbell press', sets: [0, 1, 2, 3].map(() => ({ load: 27.5, reps: 9, rpe: 8 })) },
      { exercise: 'Face pull', sets: [0, 1, 2, 3].map(() => ({ load: 20, reps: 12, rpe: 8 })) },
      { exercise: 'Triceps pushdown', sets: [0, 1, 2].map(() => ({ load: 30, reps: 12, rpe: 8 })) },
    ]);
    h.clockMs += DAY;
    const snap0 = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: sid }, 'do-again'));
    const mains = slotsOf(snap0.workout.blocks).filter((x) => x.main);
    expect(mains.map((x) => snap0.facts[x.exerciseId]?.name)).toEqual(['Bench press']);
    expect(snap0.setup.mainLiftExerciseId).toBe(mains[0]?.exerciseId);
    const benchRows = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).find((sl) => sl.main)?.rows.map((r) => [r.type, r.reps, r.load, r.rpe]);
    let snap = snap0;
    for (let i = 0; i < 8 && workoutView(snap).time.less !== null; i += 1) {
      snap = await step(s, snap, 'less', `b3-${String(i)}`);
      expect(benchRows(snap)).toEqual(benchRows(snap0));
      expect(workoutView(snap).time.lines.some((l) => l.startsWith('Bench press'))).toBe(false);
    }
    expect(snap.time).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gym changed: two copies of an exercise by identity

describe('Gym changed with an exercise listed twice: each copy keeps its own sets, by identity', () => {
  async function twice(s: AppServices) {
    const gymId = await setUpGym(h, s);
    const push = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }] }]);
    const bench = (await s.workout.load(push))?.aggregate.exercises.find((e) => e.exerciseName === 'Bench press')?.exerciseId ?? '';
    h.clockMs += DAY;
    const template = (t: Partial<RoutineExercise['setTemplates'][number]>): RoutineExercise['setTemplates'][number] => ({ id: h.ids(), setType: 'working', targetLoad: null, targetReps: { min: 5, max: 5 }, targetDurationS: null, targetRpe: null, targetRir: null, restOverrideS: null, ...t });
    const ex = (order: number, sets: RoutineExercise['setTemplates']): RoutineExercise => ({ id: h.ids(), exerciseId: bench, equipmentId: null, order, supersetGroup: null, setTemplates: sets, restBySetType: {}, transitionRestS: null, progressionRuleId: null });
    const fixed = (v: number, reps: number) => template({ targetLoad: { value: v, unit: 'kg', convention: 'total' }, targetReps: { min: reps, max: reps } });
    const made = await s.routines.create({ edit: { name: 'Twice', exercises: [ex(0, [fixed(80, 3)]), ex(1, [fixed(50, 10), fixed(50, 10), fixed(50, 10)])] }, opId: 'new-twice' });
    if (!made.ok) throw new Error(made.message);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: made.routine.id }, 'open-twice'));
    const other = h.ids();
    expect((await s.setup.saveGym({ gymId: other, name: 'Second gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(other)).ok).toBe(true);
    return snap;
  }
  const work = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).map((sl) => sl.rows.filter((r) => r.type !== 'warmup').map((r) => `${String(r.reps)}@${String(r.load)}`));

  it('reordered: the copies keep their own sets after the move', async () => {
    const { services: s } = await h.launch();
    const snap = await twice(s);
    expect(work(snap)).toEqual([['3@80'], ['10@50', '10@50', '10@50']]);
    const second = slotsOf(snap.workout.blocks)[1];
    if (second === undefined) throw new Error('no copy');
    const moved = opened(await s.builder.edit(snap.draftId, { kind: 'move', slotKey: second.key, dir: 'up' }, { opId: 'move-up', basis: { version: snap.version } }));
    expect(work(moved)).toEqual([['10@50', '10@50', '10@50'], ['3@80']]);
    const r = await s.builder.changeGym(moved.draftId, { opId: 'gym-a', expectedVersion: moved.version });
    if (r.status !== 'written') throw new Error(r.status);
    expect(work(r.snapshot)).toEqual([['10@50', '10@50', '10@50'], ['3@80']]);
  });

  it('one copy deleted: the other keeps its own sets, not the deleted copy’s', async () => {
    const { services: s } = await h.launch();
    const snap = await twice(s);
    const first = slotsOf(snap.workout.blocks)[0];
    if (first === undefined) throw new Error('no copy');
    const del = opened(await s.builder.edit(snap.draftId, { kind: 'delete_exercise', slotKey: first.key }, { opId: 'delete-first', basis: { version: snap.version } }));
    expect(work(del)).toEqual([['10@50', '10@50', '10@50']]);
    const r = await s.builder.changeGym(del.draftId, { opId: 'gym-b', expectedVersion: del.version });
    if (r.status !== 'written') throw new Error(r.status);
    expect(work(r.snapshot)).toEqual([['10@50', '10@50', '10@50']]);
  });
});

// ---------------------------------------------------------------------------
// The coach's version over a fit

describe('the coach’s version over a Time fit (rule 3: Ben’s tap)', () => {
  it('rests the fit shortened stay shortened with their note and Undo; Undo puts normal rests back on the coach’s version', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-coach'));
    const short = await cutUntilDropped(s, snap0);
    expect(short.workout.restLevel).not.toBe('normal');
    // The coach's version: the shorter workout as it stands (an applied proposal).
    const applied = await s.builder.applyCoachWorkout({ draftId: short.draftId, expectedVersion: short.version, workout: short.workout, minutes: short.setup.minutes, opId: 'coach-version' });
    expect(applied).toEqual({ ok: true });
    const after = await s.builder.read(short.draftId);
    if (after === null) throw new Error('gone');
    expect(after.workout.restLevel).toBe(short.workout.restLevel);
    expect(after.time?.changes).toEqual([{ kind: 'rest', from: 'normal', to: short.workout.restLevel }]);
    expect(workoutView(after).time.note).toMatch(/rests$/);
    const undo = opened(await s.builder.setTime(after.draftId, after.time?.fromMinutes ?? 0, { opId: 'coach-undo', expectedVersion: after.version }));
    expect(undo.workout.restLevel).toBe('normal');
    expect(undo.time).toBeNull();
    expect(counts(undo)).toEqual(counts(after));
  });
});

// ---------------------------------------------------------------------------
// Rule 9 and the detail's keys

describe('`Add anyway` asks first for a `May hurt` exercise (rule 9)', () => {
  it('names the flagged exercise(s) with `Choose another` / `Add anyway`; nothing flagged goes straight through', () => {
    const facts = { fly: { name: 'Cable fly', works: null, group: 'Chest' as const, compound: false, mayHurt: true, notHere: false, hasHistory: false }, dip: { name: 'Dips', works: null, group: 'Chest' as const, compound: true, mayHurt: false, notHere: false, hasHistory: false } };
    expect(addAnywayConfirm({ facts }, ['fly', 'dip'])).toEqual({ title: 'Cable fly may hurt', message: null, cancel: 'Choose another', confirm: 'Add anyway' });
    expect(addAnywayConfirm({ facts }, ['dip'])).toBeNull();
    expect(addAnywayConfirm({ facts: { ...facts, dip: { ...facts.dip, mayHurt: true } } }, ['fly', 'dip'])?.title).toBe('Cable fly and Dips may hurt');
  });

  it('the screen asks before adding; the Time detail keys its lines by place (an exercise listed twice) (source)', () => {
    const page = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(page).toContain('const c = addAnywayConfirm(snap, l.add);');
    expect(page).toContain('{ text: c.confirm, onPress: add },');
    // The detail is the shared Time sheet (Today's card and Your workout).
    const sheet = read('ui/time-stepper.tsx');
    expect(page).toContain('<TimeDetailSheet');
    expect(sheet).toContain('key={`${String(i)}:${l}`}');
    expect(sheet).not.toContain('<AppText key={l} variant="body" numeric>');
  });

  it('a flagged exercise on the page is `May hurt` in its facts (what the confirm reads)', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s);
    const fly = catalogueExerciseId('cable-fly');
    expect((await s.pain.flagMovement({ exerciseId: fly, exerciseName: 'Cable fly', opId: 'pain-fly' })).ok).toBe(true);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-pain'));
    const added = opened(await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: fly }, { opId: 'add-fly', basis: { version: snap.version } }));
    expect(addAnywayConfirm(added, [fly])?.title).toBe('Cable fly may hurt');
  });
});

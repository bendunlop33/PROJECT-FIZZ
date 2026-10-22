import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { workoutView } from '../src/builder/builder-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Your workout's Time, re-review round 1 (22 Oct), on real SQLite, offline, no coach call:
 * - R1: less time never makes an exercise Ben edited after a fit longer (Time steps, a Set up merge, Gym changed);
 *   the detail keeps listing what the fit took from it, and the full length (Undo) brings it back with his edit;
 * - R2: Gym changed to a gym that lacks exercises: its swaps aren't Ben's edits, so Time still shortens (or leaves
 *   out) what it swapped in, and the workout fits Time again;
 * - R3: Time never pairs exercises with Supersets on; a draft from Today's Edit; a workout already over its length;
 * - N10: a Set up rebuild with Length left as Time's is fitted again, so more time brings work back.
 */

const DAY = 86_400_000;
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

/** Push B: bench (main), incline DB press, face pull, pushdown, lateral raise, `sets` each (the reviewer's probe). */
async function bigPush(s: AppServices, sets: number) {
  const gymId = await setUpGym(h, s);
  const n = (load: number, reps: number) => Array.from({ length: sets }, () => ({ load, reps, rpe: 8 }));
  const sid = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: n(100, 6) },
    { exercise: 'Incline dumbbell press', sets: n(27.5, 9) },
    { exercise: 'Face pull', sets: n(20, 12) },
    { exercise: 'Triceps pushdown', sets: n(30, 12) },
    { exercise: 'Lateral raise', sets: n(8, 12) },
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

async function stepUntil(s: AppServices, snap0: BuilderSnapshot, done: (x: BuilderSnapshot) => boolean, tag: string): Promise<BuilderSnapshot> {
  let snap = snap0;
  for (let i = 0; i < 16 && !done(snap); i += 1) {
    if (workoutView(snap).time.less === null) break;
    snap = await step(s, snap, 'less', `${tag}-${String(i)}`);
  }
  if (!done(snap)) throw new Error(`${tag}: never reached`);
  return snap;
}

const work = (sl: { rows: readonly { type: string }[] }) => sl.rows.filter((r) => r.type !== 'warmup').length;
const slotOf = (x: BuilderSnapshot, key: string) => slotsOf(x.workout.blocks).find((sl) => sl.key === key);
const countOf = (x: BuilderSnapshot, key: string) => {
  const sl = slotOf(x, key);
  return sl === undefined ? 0 : work(sl);
};
const nameOf = (x: BuilderSnapshot, key: string) => x.facts[slotOf(x, key)?.exerciseId ?? '']?.name ?? '?';

/** Time down until a set is cut; then Ben changes the RPE on that exercise's first working set (it's his now). */
async function cutThenEdit(s: AppServices, snap0: BuilderSnapshot) {
  const cut = await stepUntil(s, snap0, (x) => x.time?.changes.some((c) => c.kind === 'sets') === true, 'cut');
  const ch = cut.time?.changes.find((c) => c.kind === 'sets');
  if (ch?.kind !== 'sets') throw new Error('no set cut');
  const sl = slotOf(cut, ch.slotKey);
  if (sl === undefined) throw new Error('no slot');
  const index = sl.rows.findIndex((r) => r.type !== 'warmup');
  const edited = opened(await s.builder.edit(cut.draftId, { kind: 'edit_row', slotKey: sl.key, index, patch: { kind: 'rpe', rpe: 7 } }, { opId: 'rpe-7', basis: { version: cut.version } }));
  const line = `${nameOf(edited, sl.key)} ${String(ch.from)} → ${String(ch.to)} sets`;
  expect(workoutView(edited).time.lines).toContain(line);
  return { edited, key: sl.key, his: countOf(edited, sl.key), from: ch.from, index, line };
}

// ---------------------------------------------------------------------------
// R1

describe('R1: less time never makes an exercise Ben edited after a fit longer', () => {
  it('Time down twice after an RPE edit on a cut exercise: its sets stay as he left them, nothing else pays for it, the detail still lists the cut; Undo brings it all back with his RPE', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s, 4);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open'));
    const { edited, key, his, from, index, line } = await cutThenEdit(s, snap0);
    let snap = edited;
    for (const tag of ['down-1', 'down-2']) {
      const down = await step(s, snap, 'less', tag);
      expect(countOf(down, key)).toBe(his);
      expect(slotOf(down, key)?.rows[index]?.rpe).toBe(7);
      expect(workoutView(down).time.lines).toContain(line);
      // Less time never gives any exercise more sets.
      for (const sl of slotsOf(down.workout.blocks)) expect(work(sl)).toBeLessThanOrEqual(countOf(snap, sl.key));
      expect(down.over || down.minutes <= down.setup.minutes).toBe(true);
      snap = down;
    }
    // The detail's Undo: the original, his edit kept.
    const back = opened(await s.builder.setTime(snap.draftId, snap.time?.fromMinutes ?? 0, { opId: 'undo-time', expectedVersion: snap.version }));
    expect(back.time).toBeNull();
    expect(countOf(back, key)).toBe(from);
    expect(slotOf(back, key)?.rows[index]?.rpe).toBe(7);
    for (const sl of slotsOf(snap0.workout.blocks)) expect(countOf(back, sl.key)).toBe(work(sl));
  });

  it('through a Set up merge (Supersets on, Length left) and Gym changed (a gym with everything): his exercise keeps his sets and its line', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s, 4);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-2'));
    const { edited, key, his, from, line } = await cutThenEdit(s, snap0);
    const down = await step(s, edited, 'less', 'down');
    const merged = opened(await s.builder.changeSetup(down.draftId, { ...down.setup, supersets: true }, { opId: 'supersets-on', expectedVersion: down.version }));
    expect(merged.setup.minutes).toBe(down.setup.minutes);
    expect(countOf(merged, key)).toBe(his);
    expect(workoutView(merged).time.lines).toContain(line);
    const other = h.ids();
    expect((await s.setup.saveGym({ gymId: other, name: 'Second gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(other)).ok).toBe(true);
    const moved = await s.builder.changeGym(merged.draftId, { opId: 'gym', expectedVersion: merged.version });
    if (moved.status !== 'written') throw new Error(moved.status);
    expect(countOf(moved.snapshot, key)).toBe(his);
    expect(workoutView(moved.snapshot).time.lines).toContain(line);
    const back = opened(await s.builder.setTime(moved.snapshot.draftId, moved.snapshot.time?.fromMinutes ?? 0, { opId: 'undo-time', expectedVersion: moved.snapshot.version }));
    expect(countOf(back, key)).toBe(from);
  });
});

// ---------------------------------------------------------------------------
// R2

describe('R2: Gym changed to a gym that lacks exercises after a fit', () => {
  it('the gym’s swaps aren’t Ben’s edits: the workout is fitted to Time again (what Time left out stays out or another cut stands in), Time can still shorten it, Undo brings the whole workout back at the new gym', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s, 3);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-r2'));
    const short = await stepUntil(s, snap0, (x) => x.time?.changes.some((c) => c.kind === 'drop') === true, 'drop');
    const other = h.ids();
    expect((await s.setup.saveGym({ gymId: other, name: 'Home', draft: s.coachingKnowledge.buildGymDraft('home_barbell', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(other)).ok).toBe(true);
    const moved = await s.builder.changeGym(short.draftId, { opId: 'gym', expectedVersion: short.version });
    if (moved.status !== 'written') throw new Error(moved.status);
    const m = moved.snapshot;
    // Something was swapped (this gym lacks most of Push B), and no swap is marked as Ben's.
    expect(slotsOf(m.workout.blocks).map((sl) => sl.exerciseId)).not.toEqual(slotsOf(short.workout.blocks).map((sl) => sl.exerciseId));
    expect(slotsOf(m.workout.blocks).every((sl) => sl.touched !== true)).toBe(true);
    // Fitted to Time again at the new gym: within Time, with its note; never the uncut workout under a short Time.
    expect(m.setup.minutes).toBe(short.setup.minutes);
    expect(m.over).toBe(false);
    expect(m.minutes).toBeLessThanOrEqual(m.setup.minutes);
    expect(m.time).not.toBeNull();
    expect(workoutView(m).time.lines.length).toBeGreaterThan(1);
    expect(slotsOf(m.workout.blocks).length).toBeLessThan(slotsOf(snap0.workout.blocks).length);
    // Time can still shorten what was swapped in.
    const less = await step(s, m, 'less', 'less-after-gym');
    expect(less.minutes).toBeLessThanOrEqual(m.minutes);
    expect(slotsOf(less.workout.blocks).reduce((n, sl) => n + work(sl), 0)).toBeLessThan(slotsOf(m.workout.blocks).reduce((n, sl) => n + work(sl), 0));
    // The detail's Undo: every exercise back (at the new gym), normal rests, no fit.
    const back = opened(await s.builder.setTime(less.draftId, less.time?.fromMinutes ?? 0, { opId: 'undo-time', expectedVersion: less.version }));
    expect(back.time).toBeNull();
    expect(back.workout.restLevel).toBe('normal');
    expect(new Set(slotsOf(back.workout.blocks).map((sl) => sl.key))).toEqual(new Set(slotsOf(snap0.workout.blocks).map((sl) => sl.key)));
    for (const sl of slotsOf(snap0.workout.blocks)) expect(countOf(back, sl.key)).toBe(work(sl));
  });

  it('the gym toast’s Undo puts the old gym, its workout and its fit back as they were', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s, 3);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-r2b'));
    const short = await stepUntil(s, snap0, (x) => x.time?.changes.some((c) => c.kind === 'drop') === true, 'drop');
    const other = h.ids();
    expect((await s.setup.saveGym({ gymId: other, name: 'Home', draft: s.coachingKnowledge.buildGymDraft('home_barbell', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(other)).ok).toBe(true);
    const moved = await s.builder.changeGym(short.draftId, { opId: 'gym', expectedVersion: short.version });
    if (moved.status !== 'written') throw new Error(moved.status);
    expect(moved.toast?.undoOpId).toBe('gym');
    const undone = opened(await s.builder.undo(short.draftId, 'gym', 'undo-gym'));
    expect(slotsOf(undone.workout.blocks).map((sl) => `${sl.exerciseId}×${String(work(sl))}`)).toEqual(slotsOf(short.workout.blocks).map((sl) => `${sl.exerciseId}×${String(work(sl))}`));
    expect(undone.time?.changes).toEqual(short.time?.changes);
    expect(undone.setup.minutes).toBe(short.setup.minutes);
  });
});

// ---------------------------------------------------------------------------
// R3: Supersets on, Today's Edit, a workout over its length

describe('R3: Time with Supersets on never pairs exercises', () => {
  it('each step only keeps or splits the pairs Set up made; no single is paired by Time', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s, 4);
    const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-ss'));
    const on = opened(await s.builder.changeSetup(snap0.draftId, { ...snap0.setup, supersets: true }, { opId: 'ss-on', expectedVersion: snap0.version }));
    expect(on.setup.supersets).toBe(true);
    const pairs = (x: BuilderSnapshot) => x.workout.blocks.filter((b) => b.slots.length > 1).map((b) => b.slots.map((sl) => sl.key).join('+'));
    let snap = on;
    for (let i = 0; i < 8 && workoutView(snap).time.less !== null; i += 1) {
      const next = await step(s, snap, 'less', `ss-${String(i)}`);
      for (const p of pairs(next)) expect(pairs(snap)).toContain(p);
      snap = next;
    }
    expect(snap.time).not.toBeNull();
  });
});

const planEx = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
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

describe('R3 / S1: a draft from Today’s Edit (pending Ben, SP6)', () => {
  it('Your workout’s Time works on the draft as Today committed it: less time cuts and lists it; Undo is exactly Today’s version; more time never adds past it', async () => {
    const { services: s } = await h.launch();
    await bigPush(s, 3);
    model = new StepModel([planStub, () => replyWith('Here is your week.')]);
    const sent = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
    const card = sent.cards[0]?.record;
    if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
    const c = await s.plans.card({ planId: card.detail.planId, versionN: 1 });
    expect(await s.plans.apply({ planId: card.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
    const data = await s.todaySession.load();
    if (data === null) throw new Error('no Today');
    const key = data.days.find((d) => d.name === 'Push')?.key ?? '';
    const controls = data.initial[key];
    if (controls === undefined) throw new Error('no Push');
    const full = s.todaySession.card(data, { dayKey: key, controls });
    if (full === null) throw new Error('no card');
    const todayMinutes = Math.floor((full.minutes - 10) / 5) * 5;
    const committed = await s.todaySession.commit(data, { dayKey: key, controls: { ...controls, minutes: todayMinutes } }, 'commit-short');
    if (!committed.ok) throw new Error(committed.message);
    const snap0 = await s.builder.read(committed.draftId);
    if (snap0 === null) throw new Error('no draft');
    expect(snap0.setup.minutes).toBe(todayMinutes);
    expect(snap0.time).toBeNull();
    const counts = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).map((sl) => `${sl.key}×${String(work(sl))}`);
    const short = await stepUntil(s, snap0, (x) => x.time !== null && x.time.changes.some((ch) => ch.kind !== 'rest'), 'today');
    expect(workoutView(short).time.note).not.toBeNull();
    const back = opened(await s.builder.setTime(short.draftId, short.time?.fromMinutes ?? 0, { opId: 'undo-today', expectedVersion: short.version }));
    expect(back.time).toBeNull();
    expect(back.setup.minutes).toBe(todayMinutes);
    expect(counts(back)).toEqual(counts(snap0));
    expect(back.workout.restLevel).toBe(snap0.workout.restLevel);
    const more = await step(s, back, 'more', 'more-today');
    for (const sl of slotsOf(more.workout.blocks)) expect(work(sl)).toBeLessThanOrEqual(countOf(snap0, sl.key));
    expect(slotsOf(more.workout.blocks).length).toBe(slotsOf(snap0.workout.blocks).length);
  });
});

describe('R3 / S2: a workout already over its length (decision pending Ben)', () => {
  it('Over is always shown when the estimate passes Time: at open, after a step down and back up at the length it opened at', async () => {
    const { services: s } = await h.launch();
    const { routine } = await bigPush(s, 3);
    let snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: routine.id }, 'open-over'));
    const length = snap.setup.minutes;
    // Ben adds sets until the workout is over the length it opened at.
    for (let i = 0; i < 6 && !snap.over; i += 1) {
      const sl = slotsOf(snap.workout.blocks).find((x) => !x.main && work(x) < 6);
      if (sl === undefined) break;
      snap = opened(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: sl.key }, { opId: `add-${String(i)}`, basis: { version: snap.version } }));
    }
    expect(snap.over).toBe(true);
    expect(workoutView(snap).overLine).toBe(`⚠ Over ${String(length)} min`);
    const down = await step(s, snap, 'less', 'over-down');
    expect(down.over).toBe(down.minutes > down.setup.minutes);
    const up = opened(await s.builder.setTime(down.draftId, length, { opId: 'over-up', expectedVersion: down.version }));
    expect(up.setup.minutes).toBe(length);
    expect(up.over).toBe(up.minutes > length);
    expect(workoutView(up).overLine).toBe(up.over ? `⚠ Over ${String(length)} min` : null);
  });
});

// ---------------------------------------------------------------------------
// N10

describe('N10: a Set up rebuild with Length left as Time’s', () => {
  it('builds at the set-up’s own length and fits it to Time again: the note and Undo work, and more time brings the work back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [0, 1, 2].map(() => ({ load: 100, reps: 6, rpe: 8 })) }]);
    h.clockMs += DAY;
    const setup = { ...(await s.builder.initialSetup({ dayId: 'push' })), minutes: 60, supersets: false };
    const snap0 = opened(await s.builder.create(setup, 'create-60'));
    const short = opened(await s.builder.setTime(snap0.draftId, 35, { opId: 'time-35', expectedVersion: snap0.version }));
    expect(short.setup.minutes).toBe(35);
    const facts = await s.builder.setupFacts(short.setup);
    const other = facts.mainLifts.find((m) => m.id !== short.setup.mainLiftExerciseId);
    if (other === undefined) throw new Error('no other main lift');
    const rebuilt = opened(await s.builder.changeSetup(short.draftId, { ...short.setup, mainLiftExerciseId: other.id }, { opId: 'main-2', expectedVersion: short.version }));
    expect(slotsOf(rebuilt.workout.blocks).find((x) => x.main)?.exerciseId).toBe(other.id);
    expect(rebuilt.setup.minutes).toBe(35);
    expect(rebuilt.minutes <= 35 || rebuilt.over).toBe(true);
    expect(rebuilt.time?.fromMinutes).toBe(60);
    const up = opened(await s.builder.setTime(rebuilt.draftId, 60, { opId: 'time-60', expectedVersion: rebuilt.version }));
    expect(up.time).toBeNull();
    expect(up.minutes).toBeGreaterThan(rebuilt.minutes);
  });
});

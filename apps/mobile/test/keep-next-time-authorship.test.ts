import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf, workingCount } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { Routine } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData, TodaySelection } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct, D1; review batch23 B1–B3, S4, S7) Summary's `Keep for next time?` lists only Ben's own structure edits
 * on Your workout, measured like with like, and Apply writes only those. Today's card and its controls (Time
 * included), Your workout's Time, a gym change's swaps and the coach's landed next-workout change (D8) are never
 * listed. The plan day's main lift is never swapped or removed through Keep (SP7). Real SQLite; exact lines.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Thursday 1 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const PUSH = ['Bench press', 'Incline dumbbell press', 'Cable fly', 'Lateral raise', 'Triceps pushdown'];
const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const DAYS: [string, string, string[]][] = [
  ['Push', 'push', PUSH],
  ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const usable = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull.', minutes: null, gymName: null });
};
const ask = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

async function benWithPlan(): Promise<{ s: AppServices; gymId: string; push: string; pushKey: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 80, reps: 8, rpe: 8 }, { load: 80, reps: 8, rpe: 8 }] },
    { exercise: 'Incline dumbbell press', sets: [{ load: 24, reps: 10, rpe: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12, rpe: 8 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const built = await ask(s, 'Build me a 2-day plan');
  const plan = built.cards[0]?.record;
  if (plan?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: plan.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: plan.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-plan' })).toMatchObject({ ok: true });
  const push = (await s.plans.active())?.days[0]?.routineId;
  if (push === undefined) throw new Error('no push day');
  h.clockMs += 3_600_000;
  const data = await loaded(s);
  const pushKey = data.days.find((d) => d.name === 'Push')?.key ?? '';
  return { s, gymId, push, pushKey };
}

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}
const sel = (data: TodaySessionData, dayKey: string, over: Partial<TodaySelection['controls']> = {}): TodaySelection => {
  const c = data.initial[dayKey];
  if (c === undefined) throw new Error(`no controls for ${dayKey}`);
  return { dayKey, controls: { ...c, ...over } };
};
const ok = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${r.message}`);
  return r.snapshot;
};
const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((x) => snap.facts[x.exerciseId]?.name ?? '?');
const slotNamed = (snap: BuilderSnapshot, name: string) => {
  const x = slotsOf(snap.workout.blocks).find((y) => snap.facts[y.exerciseId]?.name === name);
  if (x === undefined) throw new Error(`no ${name} in ${names(snap).join(', ')}`);
  return x;
};
const template = async (s: AppServices, id: string): Promise<Routine | null> => (await s.routines.editor({ routineId: id, gymId: null }))?.routine ?? null;
const working = (r: Routine | null, name: string, nameOf: (id: string) => string) => r?.exercises.find((e) => nameOf(e.exerciseId) === name)?.setTemplates.filter((t) => t.setType !== 'warmup').length;

/** Today's card at these controls, committed and opened on Your workout (Today's `Edit`). */
async function editFromToday(s: AppServices, over: Partial<TodaySelection['controls']> = {}): Promise<BuilderSnapshot> {
  const data = await loaded(s);
  const key = data.days.find((d) => d.name === 'Push')?.key ?? '';
  const c = await s.todaySession.commit(data, sel(data, key, over), h.ids());
  if (!c.ok) throw new Error(c.message);
  const snap = await s.builder.read(c.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}

/** Start the draft as it stands (one tap) and finish it (one set logged as planned; a bodyweight set with no load). */
async function startAndFinish(s: AppServices, snap: BuilderSnapshot, gymId: string): Promise<string> {
  const r = await s.builder.start(snap.draftId, { opId: h.ids(), expectedVersion: snap.version, gymId, checkIn: null });
  if (!r.ok) throw new Error(r.message);
  const a = (await s.workout.load(r.sessionId))?.aggregate;
  const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup' && x.planned.load !== null);
  if (set === undefined) {
    await finishWorkout(h, s, r.sessionId);
    return r.sessionId;
  }
  h.clockMs += 60_000;
  const logged = await s.workout.dispatch(r.sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load, reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  h.clockMs += 60_000;
  const now = await s.workout.load(r.sessionId);
  const fin = await s.workout.dispatch(r.sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return r.sessionId;
}

async function swapIn(s: AppServices, snap: BuilderSnapshot, name: string, avoid: readonly string[] = []): Promise<{ snap: BuilderSnapshot; to: string }> {
  const from = slotNamed(snap, name);
  const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: from.key });
  const to = choices?.sections.flatMap((x) => x.items).find((i) => !i.mayHurt && !avoid.includes(i.name));
  if (to === undefined) throw new Error('no swap');
  return { snap: ok(await s.builder.edit(snap.draftId, { kind: 'swap', slotKey: from.key, exerciseId: to.exerciseId }, { opId: h.ids(), basis: { version: snap.version } })), to: to.name };
}

describe('Keep for next time lists only Ben’s own structure edits (review batch23 B1)', () => {
  it('Today’s Time 20 + Edit + a load-only edit: no row (Time and Today’s own card never ask)', async () => {
    const { s, gymId } = await benWithPlan();
    const snap = await editFromToday(s, { minutes: 20 });
    expect(slotsOf(snap.workout.blocks).length).toBeLessThan(PUSH.length);
    const bench = slotNamed(snap, 'Bench press');
    const kg = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: bench.key, index: bench.rows.findIndex((r) => r.type !== 'warmup'), patch: { kind: 'load', value: 70 } }, { opId: 'kg-1', basis: { version: snap.version } }));
    const sessionId = await startAndFinish(s, kg, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toBeNull();
  });

  it('Today at its own length + Edit + one swap: exactly that swap; Apply writes it in place and leaves every other exercise (the main lift’s 3 sets included) and the routine’s source as stored', async () => {
    const { s, gymId, push } = await benWithPlan();
    const before = await template(s, push);
    const snap = await editFromToday(s);
    expect(names(snap)).toContain('Triceps pushdown');
    const swapped = await swapIn(s, snap, 'Triceps pushdown');
    const sessionId = await startAndFinish(s, swapped.snap, gymId);
    const view = await s.builder.keepNextTimeOf(sessionId);
    expect(view).toEqual({ state: 'open', label: expect.stringMatching(/^Push/) as string, lines: [`Triceps pushdown → ${swapped.to}`] });
    expect(await s.builder.keepNextTime(sessionId, 'apply')).toEqual({ ok: true });
    const after = await template(s, push);
    expect(after?.version).toBe((before?.version ?? 0) + 1);
    // (Review S4) The plan day stays the coach's template: its `source` isn't rewritten.
    expect(after?.source).toBe(before?.source);
    const pd = before?.exercises.find((e) => snap.facts[e.exerciseId]?.name === 'Triceps pushdown');
    const swappedIn = slotNamed(swapped.snap, swapped.to).exerciseId;
    // In Triceps pushdown's place, with its 3 sets; every other exercise exactly as stored.
    const now = [...(after?.exercises ?? [])].sort((a, b) => a.order - b.order);
    expect(now.map((e) => e.exerciseId)).toEqual([...(before?.exercises ?? [])].sort((a, b) => a.order - b.order).map((e) => (e.id === pd?.id ? swappedIn : e.exerciseId)));
    expect(now.find((e) => e.exerciseId === swappedIn)?.setTemplates.filter((t) => t.setType !== 'warmup')).toHaveLength(3);
    for (const e of before?.exercises ?? []) if (e.id !== pd?.id) expect(after?.exercises.find((x) => x.id === e.id)).toEqual(e);
  });

  it('Today’s Time 20 + Edit + one more Bench set: exactly `Bench press: 3 → 4 sets` (like with like: Today’s top set + back-offs and Time’s cuts aren’t changes); Apply leaves the rest of the day as stored', async () => {
    const { s, gymId, push } = await benWithPlan();
    const before = await template(s, push);
    const snap = await editFromToday(s, { minutes: 20 });
    const bench = slotNamed(snap, 'Bench press');
    const more = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: bench.key }, { opId: 'set-1', basis: { version: snap.version } }));
    expect(workingCount(slotNamed(more, 'Bench press'))).toBe(workingCount(bench) + 1);
    const sessionId = await startAndFinish(s, more, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toEqual({ state: 'open', label: expect.any(String) as string, lines: ['Bench press: 3 → 4 sets'] });
    expect(await s.builder.keepNextTime(sessionId, 'apply')).toEqual({ ok: true });
    const after = await template(s, push);
    const nameOf = (id: string) => snap.facts[id]?.name ?? '?';
    expect(working(after, 'Bench press', nameOf)).toBe(4);
    expect(after?.exercises.map((e) => e.exerciseId)).toEqual(before?.exercises.map((e) => e.exerciseId));
    for (const e of before?.exercises ?? []) if (nameOf(e.exerciseId) !== 'Bench press') expect(after?.exercises.find((x) => x.id === e.id)).toEqual(e);
  });

  it('Today’s Time short + one swap of an exercise still on the card: exactly that line', async () => {
    const { s, gymId } = await benWithPlan();
    const snap = await editFromToday(s, { minutes: 30 });
    const accessory = names(snap).find((n) => n !== 'Bench press' && PUSH.includes(n));
    if (accessory === undefined) throw new Error(`no accessory in ${names(snap).join(', ')}`);
    const swapped = await swapIn(s, snap, accessory);
    const sessionId = await startAndFinish(s, swapped.snap, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toEqual({ state: 'open', label: expect.any(String) as string, lines: [`${accessory} → ${swapped.to}`] });
  });

  it('a set Today’s Time cut that Ben adds back is no change for the plan', async () => {
    const { s, gymId } = await benWithPlan();
    // The first length whose card cuts sets from an exercise it keeps.
    let found: { snap: BuilderSnapshot; key: string } | null = null;
    for (const minutes of [25, 30, 35, 40, 45, 50]) {
      const snap = await editFromToday(s, { minutes });
      const stored = await s.coachDrafts.get(snap.draftId);
      const cut = stored?.versions.find((v) => v.n === stored.currentVersion)?.plan.slots.find((x) => (x.builder?.todayCut ?? 0) > 0 && !x.main);
      if (cut !== undefined) {
        found = { snap, key: cut.slotKey };
        break;
      }
    }
    if (found === null) throw new Error('no length cuts sets here');
    const more = ok(await s.builder.edit(found.snap.draftId, { kind: 'add_set', slotKey: found.key }, { opId: 'set-back', basis: { version: found.snap.version } }));
    const sessionId = await startAndFinish(s, more, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toBeNull();
  });

  it('Ben’s own removal and add from Today’s Edit: exactly those lines; Apply removes and adds only those', async () => {
    const { s, gymId, push } = await benWithPlan();
    const before = await template(s, push);
    let snap = await editFromToday(s);
    const fly = slotNamed(snap, 'Cable fly');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'delete_exercise', slotKey: fly.key }, { opId: 'del-1', basis: { version: snap.version } }));
    const choices = await s.builder.exerciseChoices(snap.draftId, { slotKey: null, group: 'Biceps' });
    const curl = choices?.sections.flatMap((x) => x.items).find((i) => !i.mayHurt);
    if (curl === undefined) throw new Error('no biceps exercise');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: curl.exerciseId }, { opId: 'add-1', basis: { version: snap.version } }));
    const sessionId = await startAndFinish(s, snap, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toEqual({ state: 'open', label: expect.any(String) as string, lines: [`Add ${curl.name}`, 'Delete Cable fly'] });
    expect(await s.builder.keepNextTime(sessionId, 'apply')).toEqual({ ok: true });
    const after = await template(s, push);
    expect(after?.exercises.some((e) => e.exerciseId === fly.exerciseId)).toBe(false);
    expect(after?.exercises.some((e) => e.exerciseId === curl.exerciseId)).toBe(true);
    for (const e of before?.exercises ?? []) if (e.exerciseId !== fly.exerciseId) expect(after?.exercises.find((x) => x.id === e.id)).toEqual({ ...e, order: expect.any(Number) as number });
  });
});

describe('Ben’s own Set up change is his structure edit', () => {
  it('one more Chest exercise on Set up: exactly `Add <it>`', async () => {
    const { s, gymId, push } = await benWithPlan();
    const snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-setup'));
    const groups = snap.setup.groups.map((g) => (g.group === 'Chest' ? { ...g, count: g.count + 1 } : g));
    const more = ok(await s.builder.changeSetup(snap.draftId, { ...snap.setup, groups, groupsEdited: true }, { opId: 'setup-1', expectedVersion: snap.version }));
    const added = names(more).filter((n) => !names(snap).includes(n));
    expect(added).toHaveLength(1);
    const sessionId = await startAndFinish(s, more, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toEqual({ state: 'open', label: expect.any(String) as string, lines: [`Add ${added[0] ?? ''}`] });
  });
});

describe('the main lift is never swapped or removed through Keep (review batch23 B3; SP7 open)', () => {
  it('Ben swaps the bench on Today’s Edit: the workout uses his swap today; no row; the plan day keeps its bench as its main lift', async () => {
    const { s, gymId, push } = await benWithPlan();
    const before = await template(s, push);
    const snap = await editFromToday(s);
    const swapped = await swapIn(s, snap, 'Bench press');
    const r = await s.builder.start(swapped.snap.draftId, { opId: 'start-main', expectedVersion: swapped.snap.version, gymId, checkIn: null });
    if (!r.ok) throw new Error(r.message);
    expect((await s.workout.load(r.sessionId))?.aggregate.exercises.map((e) => e.exerciseName)).toContain(swapped.to);
    await finishWorkout(h, s, r.sessionId);
    expect(await s.builder.keepNextTimeOf(r.sessionId)).toBeNull();
    expect(await s.builder.keepNextTime(r.sessionId, 'apply')).toMatchObject({ ok: false });
    expect(await template(s, push)).toEqual(before);
  });
});

describe('the app’s own changes never ask (review batch23 B2)', () => {
  /** Ben asks the coach to swap `fromName` next time on the plan day; he applies it (D8). */
  async function coachSwapNextTime(s: AppServices, sessionId: string, fromName: string): Promise<string> {
    const agg = (await s.workout.load(sessionId))?.aggregate;
    const from = agg?.exercises.find((e) => e.exerciseName === fromName);
    model = new StepModel([
      () => toolCall('get_substitutions', { exerciseId: from?.exerciseId }),
      (req) => {
        const out = req.input.flatMap((i) => (i.type === 'function_call_output' ? [JSON.parse(i.output) as { data: { options: { exerciseId: string }[] } }] : []));
        return toolCall('propose_next_workout_change', { sourceSessionId: sessionId, sourceVersion: agg?.session.version ?? 1, changes: [{ change: 'swap', fromExerciseId: from?.exerciseId, toExerciseId: out[0]?.data.options[0]?.exerciseId }], reason: 'Some variety.' });
      },
      () => replyWith('Here is a swap to try.'),
    ]);
    const r = await ask(s, `Swap the ${fromName.toLowerCase()} for something else next time`);
    const card = r.cards.find((c) => c.record.detail.kind === 'propose_next_workout_change')?.record;
    if (card?.detail.kind !== 'propose_next_workout_change') throw new Error('no card');
    const a = await s.coach.tapProposal(card.actionId, 'apply');
    if (!a.ok) throw new Error('not applied');
    const op = card.detail.ops?.[0];
    return op?.change === 'swap' ? op.toName : '';
  }

  async function pushDone(s: AppServices, push: string, gymId: string): Promise<string> {
    const day = ok(await s.builder.openTemplate({ routineId: push }, h.ids()));
    const done = await s.builder.start(day.draftId, { opId: h.ids(), expectedVersion: day.version, gymId, checkIn: null });
    if (!done.ok) throw new Error(done.message);
    await finishWorkout(h, s, done.sessionId);
    h.clockMs += DAY;
    return done.sessionId;
  }

  it('the coach’s change for next Push lands on Today’s card; Ben starts it with no edits: no row', async () => {
    const { s, gymId, push } = await benWithPlan();
    const last = await pushDone(s, push, gymId);
    const toName = await coachSwapNextTime(s, last, 'Triceps pushdown');
    const data = await loaded(s);
    const key = data.days.find((d) => d.name === 'Push')?.key ?? '';
    const c = await s.todaySession.commit(data, sel(data, key), 'commit-coach');
    if (!c.ok) throw new Error(c.message);
    const snap = await s.builder.read(c.draftId);
    if (snap === null) throw new Error('no draft');
    expect(names(snap)).toContain(toName);
    const sessionId = await startAndFinish(s, snap, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toBeNull();
  });

  it('the coach’s landed change plus Ben’s own swap of another exercise: exactly Ben’s line', async () => {
    const { s, gymId, push } = await benWithPlan();
    const last = await pushDone(s, push, gymId);
    const toName = await coachSwapNextTime(s, last, 'Triceps pushdown');
    const snap = await editFromToday(s);
    expect(names(snap)).toContain(toName);
    const mine = await swapIn(s, snap, 'Lateral raise', [toName]);
    const sessionId = await startAndFinish(s, mine.snap, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toEqual({ state: 'open', label: expect.any(String) as string, lines: [`Lateral raise → ${mine.to}`] });
  });

  it('a gym change alone (dumbbells only): the gym’s swaps are today’s, no row; Ben’s own swap before it stays his', async () => {
    const { s, gymId, push } = await benWithPlan();
    let snap = ok(await s.builder.openTemplate({ routineId: push }, 'open-gym'));
    const mine = await swapIn(s, snap, 'Lateral raise');
    snap = mine.snap;
    const hotel = h.ids();
    expect((await s.setup.saveGym({ gymId: hotel, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(hotel)).ok).toBe(true);
    const at = await s.builder.read(snap.draftId);
    const moved = ok(await s.builder.changeGym(snap.draftId, { opId: 'gym-1', expectedVersion: at?.version ?? 0 }));
    // The gym swapped something this gym can't do.
    expect(names(moved).filter((n) => !names(snap).includes(n)).length).toBeGreaterThan(0);
    const sessionId = await startAndFinish(s, moved, hotel);
    const lines = (await s.builder.keepNextTimeOf(sessionId)) ?? null;
    // Only Ben's own swap, if the dumbbell gym kept it (else nothing).
    expect(lines === null ? [] : lines.state === 'open' ? lines.lines : ['kept?']).toEqual(names(moved).includes(mine.to) ? [`Lateral raise → ${mine.to}`] : []);
    expect(gymId).not.toBe(hotel);
  });

  it('Today drafted Push at 30 min, then Ben opens Push from the Library (its set-up merged in by the open): no row', async () => {
    const { s, gymId, push } = await benWithPlan();
    const today = await editFromToday(s, { minutes: 30 });
    const snap = ok(await s.builder.openTarget({ kind: 'routine', routineId: push }, 'lib-open'));
    expect(snap.draftId).toBe(today.draftId);
    // The open merged the plan day's set-up into Today's draft (its exercises back): not Ben's adds.
    expect(names(snap).length).toBeGreaterThan(names(today).length);
    const sessionId = await startAndFinish(s, snap, gymId);
    expect(await s.builder.keepNextTimeOf(sessionId)).toBeNull();
  });

  it('a saved workout opened, the gym changed, no edit by Ben: no row (review B2, second round)', async () => {
    const { s, gymId } = await benWithPlan();
    const sessionId0 = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] },
      { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
      { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }] },
    ]);
    const saved = await s.routines.saveFrom({ from: { kind: 'session', sessionId: sessionId0 }, name: 'Push A', addToRotation: true, opId: 'save-push-a' });
    if (!saved.ok) throw new Error(saved.message);
    h.clockMs += DAY;
    const snap = ok(await s.builder.openTarget({ kind: 'routine', routineId: saved.routine.id }, 'open-a'));
    const hotel = h.ids();
    expect((await s.setup.saveGym({ gymId: hotel, name: 'Hotel gym', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).ok).toBe(true);
    expect((await s.gyms.select(hotel)).ok).toBe(true);
    const at = await s.builder.read(snap.draftId);
    const moved = ok(await s.builder.changeGym(snap.draftId, { opId: 'gym-a', expectedVersion: at?.version ?? 0 }));
    expect(names(moved)).not.toEqual(names(snap));
    const sessionId = await startAndFinish(s, moved, hotel);
    expect(await s.builder.keepNextTimeOf(sessionId)).toBeNull();
  });
});

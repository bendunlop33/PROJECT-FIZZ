import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct; fit-to-time SP3) The sets Your workout's Time cut can be carried over to each muscle's next plan day: a
 * real offer (`Carry over` / `✕`), never applied by default, at most 4 sets, version-fenced, with Undo after Apply. It
 * lands on that day's next Today card once the workout is done, after that day's own fit. Real SQLite.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
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
  ['Shoulders', 'shoulders', ['Lateral raise', 'Triceps pushdown']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const usable = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull, shoulders.', minutes: null, gymName: null });
};

async function benWithPlan(): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 80, reps: 8, rpe: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const built = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const plan = built.cards[0]?.record;
  if (plan?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: plan.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: plan.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-plan' })).toMatchObject({ ok: true });
  h.clockMs += 3_600_000;
  return { s, gymId };
}

/** The plan's third day (the split names it; its exercises are Lateral raise and Triceps pushdown): `THIRD`. */
const THIRD = '#3';
async function dayCard(s: AppServices, name: string) {
  const data: TodaySessionData | null = await s.todaySession.load();
  if (data === null) throw new Error('no Today');
  const key = (name === THIRD ? data.days[2] : data.days.find((d) => d.name === name))?.key ?? '';
  const controls = data.initial[key];
  if (controls === undefined) throw new Error(`no ${name} in ${data.days.map((d) => d.name).join(', ')}`);
  return { data, key, controls, view: s.todaySession.card(data, { dayKey: key, controls }) };
}

async function pushFromToday(s: AppServices): Promise<BuilderSnapshot> {
  const { data, key, controls } = await dayCard(s, 'Push');
  const c = await s.todaySession.commit(data, { dayKey: key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const snap = await s.builder.read(c.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}

const ok = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? r.message : ''}`);
  return r.snapshot;
};
const totalSets = (rows: readonly { sets: number }[] | undefined) => (rows ?? []).reduce((n, r) => n + r.sets, 0);

/** Push at 30 min on Your workout: Time cuts the pushdown (Triceps), the offer routes it to Shoulders. */
async function shortPush(s: AppServices): Promise<BuilderSnapshot> {
  let snap = await pushFromToday(s);
  for (let i = 0; i < 12 && snap.setup.minutes > 25; i += 1) snap = ok(await s.builder.setTime(snap.draftId, snap.setup.minutes - 5, { opId: h.ids(), expectedVersion: snap.version }));
  return snap;
}

async function finish(s: AppServices, snap: BuilderSnapshot, gymId: string): Promise<string> {
  const st = await s.builder.start(snap.draftId, { opId: h.ids(), expectedVersion: snap.version, gymId, checkIn: null });
  if (!st.ok) throw new Error(st.message);
  const a = (await s.workout.load(st.sessionId))?.aggregate;
  const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
  if (set !== undefined) {
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(st.sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load, reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(st.sessionId);
  const fin = await s.workout.dispatch(st.sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return st.sessionId;
}

describe('the carry-over offer on Your workout (Ben, 23 Oct)', () => {
  it('offered, never applied by default: without Carry over, nothing reaches the next day for that muscle', async () => {
    const { s, gymId } = await benWithPlan();
    const before = totalSets((await dayCard(s, THIRD)).view?.rows);
    const snap = await shortPush(s);
    expect(snap.carry?.state).toBe('offer');
    const lines = snap.carry?.lines ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => /^\+[2-4] \w+ sets on your next \w+ day$/.test(l))).toBe(true);
    expect(snap.carry?.items.reduce((n, x) => n + x.sets, 0)).toBeLessThanOrEqual(4);
    await finish(s, snap, gymId);
    h.clockMs += 86_400_000;
    expect(totalSets((await dayCard(s, THIRD)).view?.rows)).toBe(before);
  });

  it('Carry over (version-fenced, once per op ID), Undo, Carry over again; it lands on the next day for that muscle after its fit, until that day is done', async () => {
    const { s, gymId } = await benWithPlan();
    const snap = await shortPush(s);
    const tri = snap.carry?.items.find((x) => x.toDayIndex === 2);
    if (tri === undefined) throw new Error(`no carry to day 3: ${JSON.stringify(snap.carry)}`);
    // The day's card in sets (the carried sets go on the group's first exercise there).
    const before = totalSets((await dayCard(s, THIRD)).view?.rows);
    expect(tri.toDayName).toBe((await s.todaySession.load())?.days[2]?.name);
    // A stale version is refused and nothing changes (rule 5).
    expect((await s.builder.carryOver(snap.draftId, 'carried', { opId: 'carry-stale', expectedVersion: snap.version - 1 })).status).toBe('stale');
    const carried = await s.builder.carryOver(snap.draftId, 'carried', { opId: 'carry-1', expectedVersion: snap.version });
    expect(carried).toMatchObject({ status: 'written', toast: { text: 'Carried over', undoOpId: 'carry-1' } });
    const c1 = ok(carried);
    expect(c1.carry?.state).toBe('carried');
    expect((await s.builder.carryOver(snap.draftId, 'carried', { opId: 'carry-1', expectedVersion: snap.version })).status).toBe('replayed');
    // Undo (the toast's, the write's own): offered again; Carry over again.
    const undone = await s.builder.undo(snap.draftId, 'carry-1', 'undo-carry-1');
    expect(undone.status).toBe('written');
    const again = ok(undone);
    expect(again.carry?.state).toBe('offer');
    const c2 = ok(await s.builder.carryOver(snap.draftId, 'carried', { opId: 'carry-2', expectedVersion: again.version }));
    // The detail's Undo clears it too.
    const cleared = ok(await s.builder.carryOver(snap.draftId, 'clear', { opId: 'clear-2', expectedVersion: c2.version }));
    expect(cleared.carry?.state).toBe('offer');
    const c3 = ok(await s.builder.carryOver(snap.draftId, 'carried', { opId: 'carry-3', expectedVersion: cleared.version }));
    // Not landed before the workout is done.
    expect(totalSets((await dayCard(s, THIRD)).view?.rows)).toBe(before);
    await finish(s, c3, gymId);
    h.clockMs += 86_400_000;
    const shoulders = await dayCard(s, THIRD);
    expect(totalSets(shoulders.view?.rows)).toBe(before + tri.sets);
    expect(shoulders.view?.why).toContain(`Carried over: +${String(tri.sets)} ${tri.group} sets`);
    // A relaunch reads the same.
    const { services: again2 } = await h.launch();
    expect(totalSets((await dayCard(again2, THIRD)).view?.rows)).toBe(before + tri.sets);
    // Shoulders done: used.
    const sh = await again2.todaySession.commit(shoulders.data, { dayKey: shoulders.key, controls: shoulders.controls }, h.ids());
    if (!sh.ok) throw new Error(sh.message);
    const shSnap = await again2.builder.read(sh.draftId);
    if (shSnap === null) throw new Error('no shoulders draft');
    await finish(again2, shSnap, gymId);
    h.clockMs += 86_400_000;
    expect(totalSets((await dayCard(again2, THIRD)).view?.rows)).toBe(before);
  });

  it('✕ skips it (nothing carried, the offer gone for this fit); a Time change asks again', async () => {
    const { s } = await benWithPlan();
    const snap = await shortPush(s);
    const skipped = ok(await s.builder.carryOver(snap.draftId, 'skipped', { opId: 'skip-1', expectedVersion: snap.version }));
    expect(skipped.carry).toBeNull();
    const carried = ok(await s.builder.setTime(skipped.draftId, skipped.setup.minutes - 5, { opId: 'time-after-skip', expectedVersion: skipped.version }));
    expect(carried.carry?.state ?? 'offer').toBe('offer');
  });

  it('a Time change after Carry over clears it (it was for that fit)', async () => {
    const { s } = await benWithPlan();
    const snap = await shortPush(s);
    const c = ok(await s.builder.carryOver(snap.draftId, 'carried', { opId: 'carry-t', expectedVersion: snap.version }));
    const more = ok(await s.builder.setTime(c.draftId, c.setup.minutes + 5, { opId: 'time-after-carry', expectedVersion: c.version }));
    expect(more.carry?.state ?? 'offer').toBe('offer');
  });
});

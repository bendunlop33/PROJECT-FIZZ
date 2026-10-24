import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct; review todaylean SP3) `↻ Mix it up` is on Your workout opened from Today's Edit with a plan: one
 * accessory swapped for a fresh one (never the main lift), one versioned write with `<from> → <to> · Undo`, offline.
 * It is Ben's own swap, so the Summary's `Keep for next time?` lists it. Real SQLite.
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
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const usable = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull.', minutes: null, gymName: null });
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
  const built = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 2-day plan', spoken: false }, turnId: h.ids() });
  const plan = built.cards[0]?.record;
  if (plan?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: plan.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: plan.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-plan' })).toMatchObject({ ok: true });
  h.clockMs += 3_600_000;
  return { s, gymId };
}

async function editFromToday(s: AppServices): Promise<BuilderSnapshot> {
  const data: TodaySessionData | null = await s.todaySession.load();
  if (data === null) throw new Error('no Today');
  const key = data.days.find((d) => d.name === 'Push')?.key ?? '';
  const controls = data.initial[key];
  if (controls === undefined) throw new Error('no controls');
  const c = await s.todaySession.commit(data, { dayKey: key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const snap = await s.builder.read(c.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}

const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((x) => snap.facts[x.exerciseId]?.name ?? '?');
const mainOf = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).find((x) => x.main)?.exerciseId ?? null;

describe('↻ Mix it up on Your workout (Ben, 23 Oct)', () => {
  it('swaps one accessory for a fresh one, never the main lift; toast names it with Undo; Undo puts it back; a retry writes nothing more', async () => {
    const { s } = await benWithPlan();
    const snap = await editFromToday(s);
    expect(await s.builder.todayOptions(snap.draftId)).not.toBeNull();
    const before = names(snap);
    const r = await s.builder.mixItUp(snap.draftId, { opId: 'mix-1', expectedVersion: snap.version });
    if (r.status !== 'written') throw new Error(`mix ${r.status} ${JSON.stringify(r)}`);
    const after = names(r.snapshot);
    expect(after).toHaveLength(before.length);
    const gone = before.filter((n) => !after.includes(n));
    const fresh = after.filter((n) => !before.includes(n));
    expect(gone).toHaveLength(1);
    expect(fresh).toHaveLength(1);
    expect(mainOf(r.snapshot)).toBe(mainOf(snap));
    expect(r.toast).toEqual({ text: `${gone[0] ?? ''} → ${fresh[0] ?? ''}`, undoOpId: 'mix-1', why: null });
    // Same op again: replayed, no second swap.
    const again = await s.builder.mixItUp(snap.draftId, { opId: 'mix-1', expectedVersion: snap.version });
    expect(again.status).toBe('replayed');
    expect(names((await s.builder.read(snap.draftId)) as BuilderSnapshot)).toEqual(after);
    const u = await s.builder.undo(snap.draftId, 'mix-1', 'undo-mix-1');
    expect(u.status).toBe('written');
    expect(names((await s.builder.read(snap.draftId)) as BuilderSnapshot)).toEqual(before);
  });

  it('a stale version is refused and nothing changes (rule 5)', async () => {
    const { s } = await benWithPlan();
    const snap = await editFromToday(s);
    const r = await s.builder.mixItUp(snap.draftId, { opId: 'mix-stale', expectedVersion: snap.version - 1 });
    expect(r.status).not.toBe('written');
    expect(names((await s.builder.read(snap.draftId)) as BuilderSnapshot)).toEqual(names(snap));
  });

  it('not offered off Today (a plan day opened from the Library has Set up): refused with no write', async () => {
    const { s } = await benWithPlan();
    const push = (await s.plans.active())?.days[0]?.routineId ?? '';
    const opened = await s.builder.openTemplate({ routineId: push }, 'open-lib');
    if (opened.status !== 'written' && opened.status !== 'replayed') throw new Error('no open');
    const r = await s.builder.mixItUp(opened.snapshot.draftId, { opId: 'mix-lib', expectedVersion: opened.snapshot.version });
    expect(r).toMatchObject({ status: 'refused', reason: 'nothing_to_mix' });
  });

  it('the mix is Ben’s own swap: Keep for next time lists it', async () => {
    const { s, gymId } = await benWithPlan();
    const snap = await editFromToday(s);
    const r = await s.builder.mixItUp(snap.draftId, { opId: 'mix-keep', expectedVersion: snap.version });
    if (r.status !== 'written') throw new Error(`mix ${r.status}`);
    const st = await s.builder.start(snap.draftId, { opId: 'start-mix', expectedVersion: r.snapshot.version, gymId, checkIn: null });
    if (!st.ok) throw new Error(st.message);
    const a = (await s.workout.load(st.sessionId))?.aggregate;
    const fin = await s.workout.dispatch(st.sessionId, { type: 'finish', at: h.now(), opId: 'fin-mix', expectedVersion: a?.session.version ?? 0, endedAt: null });
    expect(fin.ok).toBe(true);
    await h.settle(s);
    const keep = await s.builder.keepNextTimeOf(st.sessionId);
    expect(keep).toEqual({ state: 'open', label: expect.any(String) as string, lines: [r.toast?.text ?? ''] });
  });
});

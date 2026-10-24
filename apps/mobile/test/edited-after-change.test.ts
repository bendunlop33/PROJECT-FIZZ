import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData, TodaySelection } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Review batch23 S3, M2) A workout opened on Your workout and left as it was isn't `· edited`: Up next's saved workout
 * with no plan, and a plan day opened from the Library (Today's card stays Today's, its controls working). One change
 * makes it edited; an Undo back to what it opened as makes it plain again. Real SQLite.
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

const ex = (catalogueId: string) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null });
const DAYS: [string, string, string[]][] = [
  ['Push', 'push', ['Bench press', 'Incline dumbbell press', 'Lateral raise', 'Triceps pushdown']],
  ['Pull', 'pull', ['Lat pulldown', 'Barbell row']],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const usable = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build: { usable: { catalogueId: string; name: string }[] } }).build.usable;
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map((n) => ex(idOf(n))) })), message: 'Push, pull.', minutes: null, gymName: null });
};

async function ben(): Promise<{ s: AppServices; gymId: string; sessionId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const sessionId = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 80, reps: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }] },
  ]);
  h.clockMs += DAY;
  return { s, gymId, sessionId };
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
const slotNamed = (snap: BuilderSnapshot, name: string) => {
  const x = slotsOf(snap.workout.blocks).find((y) => snap.facts[y.exerciseId]?.name === name);
  if (x === undefined) throw new Error(`no ${name}`);
  return x;
};

describe('`· edited` only once something changed the draft (review batch23 S3, M2)', () => {
  it('no plan: Up next’s saved workout opened on Your workout and left as it was isn’t edited; one edit makes it so; Undo back to it, not again', async () => {
    const { s, sessionId } = await ben();
    const saved = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name: 'Push A', addToRotation: true, opId: 'save-push-a' });
    if (!saved.ok) throw new Error(saved.message);
    const first = await loaded(s);
    expect(first.upNext?.routineId).toBe(saved.routine.id);
    const snap = ok(await s.builder.openTarget({ kind: 'routine', routineId: saved.routine.id }, 'open-a'));
    expect((await loaded(s)).upNext?.edited).toBeUndefined();
    const bench = slotNamed(snap, 'Bench press');
    const more = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: bench.key }, { opId: 'set-a', basis: { version: snap.version } }));
    expect((await loaded(s)).upNext?.edited).toEqual({ draftId: snap.draftId, version: more.version });
    ok(await s.builder.undo(snap.draftId, 'set-a', 'undo-a'));
    expect((await loaded(s)).upNext?.edited).toBeUndefined();
  });

  it('a plan day opened from the Library and left as it was: Today’s card stays Today’s (its Time works); an edit makes it `· edited`', async () => {
    const { s } = await ben();
    model = new StepModel([planStub, () => replyWith('Here is your week.')]);
    const built = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 2-day plan', spoken: false }, turnId: h.ids() });
    const plan = built.cards[0]?.record;
    if (plan?.detail.kind !== 'build_plan') throw new Error('no plan');
    const c = await s.plans.card({ planId: plan.detail.planId, versionN: 1 });
    expect(await s.plans.apply({ planId: plan.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-plan' })).toMatchObject({ ok: true });
    const push = (await s.plans.active())?.days[0]?.routineId;
    if (push === undefined) throw new Error('no push day');
    const snap = ok(await s.builder.openTarget({ kind: 'routine', routineId: push }, 'lib-open'));
    const data = await loaded(s);
    const pushKey = data.days.find((d) => d.name === 'Push')?.key ?? '';
    const view = s.todaySession.card(data, sel(data, pushKey));
    expect(view?.title).toBe('Push');
    expect(view?.edited).toBeNull();
    expect(s.todaySession.card(data, sel(data, pushKey, { minutes: 20 }))?.time?.note ?? null).not.toBeNull();
    const pd = slotNamed(snap, 'Triceps pushdown');
    ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: pd.key }, { opId: 'set-lib', basis: { version: snap.version } }));
    const after = await loaded(s);
    expect(s.todaySession.card(after, sel(after, pushKey))?.title).toBe('Push · edited');
  });
});

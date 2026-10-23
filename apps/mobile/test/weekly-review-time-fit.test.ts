import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { workoutView } from '../src/builder/builder-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Review v5offers B1 on real SQLite: a Time fit is today's only (D1 "Time changes never ask; a short day isn't a
 * new plan"; fit-to-time.md). Two short days (Your workout's Time, or Today's Time on its card) started today-only
 * must never become a plan change on the next open, and never an offer either. Ben's own edit repeated is only ever
 * offered (Apply / Skip), never applied by the review, and stays one offer (same ID, `NEW` kept off) on a re-run.
 * The coach gives no weekly answer (the reviewer's probe).
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Mon 12 Oct 2026 (London): the plan is made today; the reviewed week is 12–18 Oct.
  h = createHarness('2026-10-12T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`write ${r.status}: ${r.message}`);
};

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

/** A 3-day plan applied; Push is 5 exercises × 3 sets. */
async function withPlan(): Promise<{ s: AppServices; gymId: string; push: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const sent = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const card = sent.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const c = await s.plans.card({ planId: card.detail.planId, versionN: 1 });
  expect(await s.plans.apply({ planId: card.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const push = (await s.plans.active())?.days[0]?.routineId;
  if (push === undefined) throw new Error('no push day');
  expect(await workingOf(s, push, gymId)).toEqual([3, 3, 3, 3, 3]);
  return { s, gymId, push };
}

const workingOf = async (s: AppServices, routineId: string, gymId: string) => (await s.routines.editor({ routineId, gymId }))?.exercises.map((e) => e.setTemplates.filter((t) => t.setType !== 'warmup').length);
const working = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((sl) => sl.rows.filter((r) => r.type !== 'warmup').length);

/** Log every planned working set of a started workout and finish it. */
async function logAndFinish(s: AppServices, sessionId: string): Promise<void> {
  const loaded = await s.workout.load(sessionId);
  if (loaded === null) throw new Error('no workout');
  for (const set of loaded.aggregate.sets) {
    if (set.status !== 'pending' || set.setType === 'warmup') continue;
    h.clockMs += 60_000;
    const conv = loaded.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
    const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.max ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(sessionId);
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}

/** Push in Your workout, `edit` applied, started today-only through the builder's Start, logged and finished. */
async function pushDay(s: AppServices, gymId: string, push: string, tag: string, edit: (s: AppServices, snap: BuilderSnapshot) => Promise<BuilderSnapshot>): Promise<{ sessionId: string; snap: BuilderSnapshot }> {
  const snap0 = opened(await s.builder.openTarget({ kind: 'routine', routineId: push }, `open-${tag}`));
  const snap = await edit(s, snap0);
  const r = await s.builder.start(snap.draftId, { opId: `start-${tag}`, expectedVersion: snap.version, gymId });
  if (!r.ok) throw new Error(r.message);
  await logAndFinish(s, r.sessionId);
  return { sessionId: r.sessionId, snap };
}

/** Your workout's Time stepped down until the fit cuts working sets (not only rests). */
async function shortened(s: AppServices, snap0: BuilderSnapshot): Promise<BuilderSnapshot> {
  let snap = snap0;
  for (let i = 0; i < 14 && working(snap).every((n) => n === 3); i += 1) {
    const to = workoutView(snap).time.less;
    if (to === null) break;
    snap = opened(await s.builder.setTime(snap.draftId, to, { opId: `less-${snap.draftId}-${String(snap.version)}`, expectedVersion: snap.version }));
  }
  expect(working(snap).some((n) => n < 3)).toBe(true);
  return snap;
}

/** The last working set of Lateral raise deleted by hand (Ben's own edit). */
async function oneSetFewer(s: AppServices, snap: BuilderSnapshot): Promise<BuilderSnapshot> {
  const raise = slotsOf(snap.workout.blocks).at(-1);
  if (raise === undefined) throw new Error('no slot');
  return opened(await s.builder.edit(snap.draftId, { kind: 'delete_set', slotKey: raise.key, index: raise.rows.length - 1 }, { opId: `own-${snap.draftId}`, basis: { version: snap.version } }));
}

const monday = () => {
  h.clockMs = Date.parse('2026-10-19T07:00:00.000Z');
};

describe('review v5offers B1: two short days are never a plan change, nor an offer', () => {
  it('Your workout’s Time: two Time-fitted Push days started today-only; Monday’s review changes nothing and asks nothing; the sessions say what Time set', async () => {
    const { s, gymId, push } = await withPlan();
    h.clockMs += 2 * DAY;
    const a = await pushDay(s, gymId, push, 'wed', shortened);
    h.clockMs += 2 * DAY;
    const b = await pushDay(s, gymId, push, 'fri', shortened);
    // What Start recorded: the exercises Time cut, never read as Ben's edit.
    for (const x of [a, b]) {
      const session = (await s.workout.load(x.sessionId))?.aggregate.session;
      expect(session?.planDay?.templateRoutineId).toBe(push);
      const cut = slotsOf(x.snap.workout.blocks).filter((sl) => sl.rows.filter((r) => r.type !== 'warmup').length < 3).map((sl) => sl.exerciseId);
      expect(cut.length).toBeGreaterThan(0);
      expect(session?.planDay?.notEdited).toEqual(expect.arrayContaining(cut));
    }
    // Today only: the plan is as it was.
    expect(await workingOf(s, push, gymId)).toEqual([3, 3, 3, 3, 3]);

    monday();
    const run = await s.reviews.runOnOpen();
    expect(run.kind).toBe('not_reviewed');
    if (run.kind !== 'not_reviewed') return;
    expect(run.review.facts.filter((f) => f.kind === 'template_edit')).toEqual([]);
    expect(run.review.proposals ?? []).toEqual([]);
    for (let i = 0; i < 2; i += 1) {
      h.clockMs += 3_600_000;
      await s.reviews.runOnOpen();
    }
    expect(await workingOf(s, push, gymId)).toEqual([3, 3, 3, 3, 3]);
    const changes = (await s.reviews.progress())?.changes;
    expect(changes?.rows).toEqual([]);
    expect(changes?.asks).toEqual([]);
  });

  it('Today’s Time on the card: two short Push days from Today (its card is never Ben’s edit either); Monday’s review changes nothing and asks nothing', async () => {
    const { s, gymId, push } = await withPlan();
    for (const [tag, days] of [['wed', 2], ['fri', 2]] as const) {
      h.clockMs += days * DAY;
      const data = await s.todaySession.load();
      if (data === null) throw new Error('no Today');
      const key = data.days.find((d) => d.name === 'Push')?.key ?? '';
      const controls = data.initial[key];
      if (controls === undefined) throw new Error('no Push');
      // The shortest Today allows: its fit cuts sets.
      const committed = await s.todaySession.commit(data, { dayKey: key, controls: { ...controls, minutes: 20 } }, `commit-${tag}`);
      if (!committed.ok) throw new Error(committed.message);
      const snap = await s.builder.read(committed.draftId);
      if (snap === null) throw new Error('no draft');
      expect(working(snap).some((n) => n < 3) || slotsOf(snap.workout.blocks).length < 5).toBe(true);
      const started = await s.todaySession.start({ draftId: committed.draftId, expectedVersion: committed.version, gymId, opId: `start-${tag}`, checkIn: null });
      if (!started.ok) throw new Error(started.error.message);
      expect(started.aggregate.session.planDay?.templateRoutineId).toBe(push);
      // Today's card as built (its main lift's top set and back-offs, Time's cuts): none of it is Ben's edit. With
      // todaylean's fit record on the draft, what Today's Time left out is named too (never Ben's), and nothing else.
      const notEdited = new Set(started.aggregate.session.planDay?.notEdited);
      const onCard = slotsOf(snap.workout.blocks).map((sl) => sl.exerciseId);
      for (const id of onCard) expect(notEdited.has(id), id).toBe(true);
      const timeTook = new Set((snap.time?.changes ?? []).flatMap((st) => (st.kind === 'drop' || st.kind === 'sets' ? [st.exerciseId] : [])));
      for (const id of notEdited) expect(onCard.includes(id) || timeTook.has(id), id).toBe(true);
      await logAndFinish(s, started.aggregate.session.id);
    }
    monday();
    const run = await s.reviews.runOnOpen();
    if (run.kind !== 'not_reviewed') throw new Error(run.kind);
    expect(run.review.facts.filter((f) => f.kind === 'template_edit')).toEqual([]);
    expect(run.review.proposals ?? []).toEqual([]);
    expect(await workingOf(s, push, gymId)).toEqual([3, 3, 3, 3, 3]);
  });

  it('Ben’s own edit repeated (one set fewer by hand, twice): an offer only; no open or relaunch applies it; a re-run keeps the same offer and `Got it`; Apply writes it as Ben’s with Undo', async () => {
    const x = await withPlan();
    let s = x.s;
    const { gymId, push } = x;
    h.clockMs += 2 * DAY;
    await pushDay(s, gymId, push, 'wed', oneSetFewer);
    h.clockMs += 2 * DAY;
    await pushDay(s, gymId, push, 'fri', oneSetFewer);
    monday();
    const run = await s.reviews.runOnOpen();
    if (run.kind !== 'not_reviewed') throw new Error(run.kind);
    expect(run.review.proposals?.map((p) => [p.source, p.change.fromSets, p.change.toSets, p.status, p.offer])).toEqual([['code', 3, 2, 'open', true]]);
    const offerId = run.review.proposals?.[0]?.id ?? '';
    for (let i = 0; i < 2; i += 1) {
      h.clockMs += 3_600_000;
      await s.reviews.runOnOpen();
    }
    await h.forceClose();
    ({ services: s } = await h.launch());
    await h.settle(s);
    await s.reviews.runOnOpen();
    expect(await workingOf(s, push, gymId)).toEqual([3, 3, 3, 3, 3]);
    let changes = (await s.reviews.progress())?.changes;
    expect(changes?.rows).toEqual([]);
    expect(changes?.asks.map((r) => [r.exercise, r.before, r.after, r.offer, r.status, r.canApply])).toEqual([['Lateral raise', '3 sets', '2 sets', true, 'open', true]]);
    expect(await s.reviews.markSeen({ reviewId: changes?.reviewId ?? '', expectedVersion: changes?.version ?? 0, opId: 'seen', contentKey: changes?.contentKey ?? '' })).toBe(true);

    // New inputs (a run logged that week) make a new review: the same offer, the same ID, `Got it` kept.
    const before = changes?.reviewId;
    expect((await s.activities.add({ id: h.ids(), opId: 'run-1', fields: { kind: 'run', status: 'done', date: '2026-10-18', durationS: 1500, distanceM: 5000, effort: null } })).ok).toBe(true);
    h.clockMs += 3_600_000;
    await s.reviews.runOnOpen();
    changes = (await s.reviews.progress())?.changes;
    expect(changes?.reviewId).not.toBe(before);
    expect(changes?.asks.map((r) => [r.id, r.status, r.offer])).toEqual([[offerId, 'open', true]]);
    expect(changes?.isNew).toBe(false);
    expect(await workingOf(s, push, gymId)).toEqual([3, 3, 3, 3, 3]);

    const ask = changes?.asks[0];
    expect(await s.reviews.applyProposal({ reviewId: changes?.reviewId ?? '', proposalId: ask?.id ?? '', opId: 'apply-tap' })).toMatchObject({ ok: true, proposal: { status: 'applied', canUndo: true } });
    expect(await workingOf(s, push, gymId)).toEqual([3, 3, 3, 3, 2]);
    expect(await s.reviews.undoProposal({ reviewId: changes?.reviewId ?? '', proposalId: ask?.id ?? '', opId: 'undo-tap' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect(await workingOf(s, push, gymId)).toEqual([3, 3, 3, 3, 3]);
  });
});

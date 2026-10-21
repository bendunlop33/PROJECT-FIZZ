import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The weekly review with a real applied plan (review build-b-21oct B1): the review's own small changes move
 * the plan's set counts, which must not count as new inputs. Otherwise every later open asked the coach
 * again, dropped Ben's open asks, brought `NEW` back after `Got it`, and let the coach add one more automatic
 * change per open. Real SQLite and services; the model is scripted, with weekly calls counted apart.
 */

const DAY = 86_400_000;

class Router implements CoachModelPort {
  build: ((req: ModelRequest) => ModelEvent[])[] = [];
  weekly: ((req: ModelRequest) => ModelEvent[] | Promise<ModelEvent[]>)[] = [];
  weeklyCalls = 0;
  buildCalls = 0;
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const isWeekly = typeof request.toolChoice === 'object' && request.toolChoice.name === 'weekly_review';
    const step = isWeekly ? this.weekly[this.weeklyCalls++] : this.build[this.buildCalls++];
    const events = step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : await step(request);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  }
}

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const kgLoad = (value: number, convention = 'total') => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const DAYS: [string, string | null, [string, Record<string, unknown>?][]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }]]],
  ['Pull', 'pull', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }]]],
];
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs.', minutes: null, gymName: null });
};

let h: Harness;
let model: Router;
let conn: TextCoachState = CONNECTED;
beforeEach(() => {
  model = new Router();
  conn = CONNECTED;
  h = createHarness('2026-10-12T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(conn) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function doDay(s: AppServices, gymId: string, routineId: string): Promise<string> {
  const started = await s.workout.start({ gymId, opId: `start-${routineId}-${String(h.clockMs)}`, checkIn: null, routineOf: routineId });
  if (!started.ok) throw new Error(started.error.message);
  const id = started.aggregate.session.id;
  for (const set of started.aggregate.sets) {
    if (set.status !== 'pending' || set.setType === 'warmup') continue;
    h.clockMs += 60_000;
    const conv = started.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
    const r = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.max ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return id;
}

async function setup() {
  let { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  model.build = [planStub, () => replyWith('Here is your week.')];
  const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
  const card = result.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const days = (await s.plans.active())?.days.map((d) => d.routineId) ?? [];
  // Tue 13 – Thu 15 Oct: the three days.
  for (const d of days) {
    h.clockMs += DAY;
    await doDay(s, gymId, d);
  }
  const pull = await s.routines.editor({ routineId: days[1] ?? '', gymId });
  const [pulldown, row] = pull?.exercises ?? [];
  if (!pulldown || !row) throw new Error('pull');
  return { s, gymId, days, pullId: days[1] ?? '', pulldownId: pulldown.exerciseId, rowId: row.exerciseId, relaunch: async () => {
    await h.forceClose();
    ({ services: s } = await h.launch());
    return s;
  } };
}

const workingOf = async (s: AppServices, routineId: string, gymId: string) => (await s.routines.editor({ routineId, gymId }))?.exercises.map((e) => e.setTemplates.filter((t) => t.setType !== 'warmup').length);

describe('weekly review over an applied plan (review build-b-21oct B1)', () => {
  it('after the automatic change, later opens are cached: one coach call, the ask kept, Got it kept, no further changes; Undo doesn\'t re-run it; a stale Apply is refused', async () => {
    const x = await setup();
    let s = x.s;
    const push = x.days[0] ?? '';
    const bench = (await s.routines.editor({ routineId: push, gymId: x.gymId }))?.exercises[0]?.exerciseId ?? '';
    model.weekly = [
      () =>
        toolCall('weekly_review', {
          verdict: '3 of 3 sessions done.',
          lines: [],
          tweaks: [
            { routineId: x.pullId, exerciseId: x.pulldownId, workingSets: 4, reason: 'Back volume is light.' },
            // A wrong number in the reason hides it: asked, not applied.
            { routineId: x.pullId, exerciseId: x.rowId, workingSets: 4, reason: 'Row 17 sets last week.' },
          ],
        }),
      // Would add another automatic change if asked again.
      () => toolCall('weekly_review', { verdict: 'Again.', lines: [], tweaks: [{ routineId: push, exerciseId: bench, workingSets: 4, reason: 'Chest is light.' }] }),
    ];
    h.clockMs = Date.parse('2026-10-19T07:00:00.000Z');
    const first = await s.reviews.runOnOpen();
    expect(first.kind).toBe('reviewed');
    expect(await workingOf(s, x.pullId, x.gymId)).toEqual([4, 3]);
    const shown = (await s.reviews.progress())?.changes;
    expect(shown?.rows.map((r) => [r.exercise, r.status, r.canUndo])).toEqual([['Lat pulldown', 'applied', true]]);
    expect(shown?.asks.map((r) => [r.exercise, r.statusText, r.canApply])).toEqual([['Barbell row', 'Not applied', true]]);
    // The week keeps the plan it was reviewed against (Back 6, not the 7 after the change).
    expect((await s.reviews.progress())?.muscles.rows.find((r) => r.key === 'Back')?.last).toBe('6 of 6');
    expect(await s.reviews.markSeen({ reviewId: shown?.reviewId ?? '', expectedVersion: shown?.version ?? 0, opId: 'seen-1', contentKey: shown?.contentKey ?? '' })).toBe(true);

    for (let i = 0; i < 3; i += 1) {
      h.clockMs += 3_600_000;
      expect((await s.reviews.runOnOpen()).kind).toBe('cached');
    }
    expect(model.weeklyCalls).toBe(1);
    expect(await workingOf(s, push, x.gymId)).toEqual([3]);
    let now = (await s.reviews.progress())?.changes;
    expect(now).toMatchObject({ reviewId: shown?.reviewId, isNew: false, note: '3 of 3 sessions done.' });
    expect(now?.asks.map((r) => r.exercise)).toEqual(['Barbell row']);
    expect((await s.reviews.progress())?.muscles.rows.find((r) => r.key === 'Back')?.last).toBe('6 of 6');

    // Undo of the automatic change: the plan goes back, and the next open is still the same review.
    const auto = now?.rows[0];
    expect(await s.reviews.undoProposal({ reviewId: now?.reviewId ?? '', proposalId: auto?.id ?? '', opId: 'undo-tap' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect(await workingOf(s, x.pullId, x.gymId)).toEqual([3, 3]);
    h.clockMs += 3_600_000;
    expect((await s.reviews.runOnOpen()).kind).toBe('cached');
    expect(model.weeklyCalls).toBe(1);
    expect(await workingOf(s, x.pullId, x.gymId)).toEqual([3, 3]);

    // Force-close: the same state comes back.
    s = await x.relaunch();
    await h.settle(s);
    now = (await s.reviews.progress())?.changes;
    expect(now?.rows.map((r) => [r.exercise, r.status, r.canRedo])).toEqual([['Lat pulldown', 'undone', true]]);
    expect(now?.asks.map((r) => [r.exercise, r.statusText])).toEqual([['Barbell row', 'Not applied']]);
    expect(model.weeklyCalls).toBe(1);

    // Ben changes Barbell row himself (3 → 2); Apply on the ask is then refused and writes nothing (rule 5).
    const ed = await s.routines.editor({ routineId: x.pullId, gymId: x.gymId });
    if (!ed?.routine) throw new Error('pull');
    const exercises = ed.exercises.map((e) => (e.exerciseId === x.rowId ? { ...e, setTemplates: [...e.setTemplates.filter((t) => t.setType === 'warmup'), ...e.setTemplates.filter((t) => t.setType !== 'warmup').slice(0, 2)] } : e));
    expect((await s.routines.update({ routineId: x.pullId, edit: { name: ed.routine.name, exercises }, expectedVersion: ed.routine.version, opId: 'ben-edit' })).ok).toBe(true);
    const ask = now?.asks[0];
    expect(await s.reviews.applyProposal({ reviewId: now?.reviewId ?? '', proposalId: ask?.id ?? '', opId: 'apply-tap' })).toMatchObject({ ok: false, reason: 'out_of_date' });
    expect(await workingOf(s, x.pullId, x.gymId)).toEqual([3, 2]);
  });

  it('a workout logged into the reviewed week is still new input: a new review', async () => {
    const x = await setup();
    const s = x.s;
    model.weekly = [() => toolCall('weekly_review', { verdict: 'One.', lines: [], tweaks: [{ routineId: x.pullId, exerciseId: x.pulldownId, workingSets: 4, reason: 'Back is light.' }] }), () => toolCall('weekly_review', { verdict: 'Two.', lines: [], tweaks: [] })];
    // Sat 17 Oct: Pull again; reviewed from Sun 18:00.
    h.clockMs = Date.parse('2026-10-18T17:30:00.000Z');
    const a = await s.reviews.runOnOpen();
    expect(a.kind).toBe('reviewed');
    h.clockMs = Date.parse('2026-10-18T18:00:00.000Z');
    await doDay(s, x.gymId, x.pullId);
    h.clockMs = Date.parse('2026-10-18T19:00:00.000Z');
    const b = await s.reviews.runOnOpen();
    expect(b.kind).toBe('reviewed');
    if (a.kind !== 'reviewed' || b.kind !== 'reviewed') return;
    expect(b.review.id).not.toBe(a.review.id);
    expect(model.weeklyCalls).toBe(2);
  });

  it('an unanswered ask survives a re-run on new inputs, offline or when the coach doesn\'t repeat it (review build-b-21oct S1)', async () => {
    const x = await setup();
    const s = x.s;
    model.weekly = [
      () => toolCall('weekly_review', { verdict: 'One.', lines: [], tweaks: [{ routineId: x.pullId, exerciseId: x.rowId, workingSets: 4, reason: 'Row 17 sets last week.' }] }),
      () => toolCall('weekly_review', { verdict: 'Two.', lines: [], tweaks: [] }),
    ];
    h.clockMs = Date.parse('2026-10-18T17:30:00.000Z');
    const a = await s.reviews.runOnOpen();
    expect(a.kind).toBe('reviewed');
    expect((await s.reviews.progress())?.changes?.asks.map((r) => [r.exercise, r.status])).toEqual([['Barbell row', 'open']]);
    // New input (Pull again on Sunday), and the coach can't be reached: a new review, the ask still there.
    h.clockMs = Date.parse('2026-10-18T18:00:00.000Z');
    await doDay(s, x.gymId, x.pullId);
    h.clockMs = Date.parse('2026-10-18T19:00:00.000Z');
    conn = { ...CONNECTED, status: 'offline' };
    const b = await s.reviews.runOnOpen();
    expect(b.kind).toBe('not_reviewed');
    if (a.kind !== 'reviewed' || b.kind !== 'not_reviewed') return;
    expect(b.review.id).not.toBe(a.review.id);
    expect((await s.reviews.progress())?.changes?.asks.map((r) => [r.exercise, r.status, r.canApply])).toEqual([['Barbell row', 'open', true]]);
    // Online again, the coach doesn't repeat it: still asked, never dropped unanswered; Apply's own check still guards it.
    conn = CONNECTED;
    h.clockMs = Date.parse('2026-10-18T20:00:00.000Z');
    expect((await s.reviews.runOnOpen()).kind).toBe('reviewed');
    const now = (await s.reviews.progress())?.changes;
    expect(now?.note).toBe('Two.');
    expect(now?.asks.map((r) => r.exercise)).toEqual(['Barbell row']);
    expect(await s.reviews.applyProposal({ reviewId: now?.reviewId ?? '', proposalId: now?.asks[0]?.id ?? '', opId: 'apply-ask' })).toMatchObject({ ok: true });
    expect(await workingOf(s, x.pullId, x.gymId)).toEqual([3, 4]);
  });

  it('Summary: `New best · Bench press 105 × 6` for a tracked lift beating every earlier real top set; none on a tie', async () => {
    const x = await setup();
    const s = x.s;
    h.clockMs = Date.parse('2026-10-17T07:00:00.000Z');
    const tie = await logWorkout(h, s, x.gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }] }]);
    expect(await s.reviews.sessionBests(tie)).toEqual([]);
    h.clockMs += 3_600_000 * 24;
    const pb = await logWorkout(h, s, x.gymId, [{ exercise: 'Bench press', sets: [{ load: 105, reps: 6, rpe: 9 }] }]);
    const bests = await s.reviews.sessionBests(pb);
    expect(bests.map((b) => b.text.replaceAll('\u00a0', ' '))).toEqual(['New best · Bench press 105 × 6']);
    // Lifts: the newest point is a PB (the table's tag, the ring on the all-lifts chart).
    const bench = (await s.reviews.progress())?.lifts.lifts.find((l) => l.name === 'Bench press');
    expect(bench).toMatchObject({ latestPb: true, loadSuffix: null });
  });
});

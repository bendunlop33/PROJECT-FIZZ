import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { NBSP } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { SessionAggregate } from '@fizz/schemas';

import type { WorkoutOffer } from '../src/coach/coach-service';
import { nextTimeView } from '../src/coach/next-time-view';
import { whyView } from '../src/coach/sheet-view';
import { coachCouldNotAnswer, offerCandidates, ruleOfferOutcome, slotView } from '../src/coach/slot-view';
import { exerciseMenu } from '../src/workout/exercise-menu';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Build 108: "I did way fewer reps than stated and the coach still didn't
 * change sets for the set or session." Ben's exact case, on real SQLite,
 * in each connection state of the diagnosis (docs/reviews/coach-fallback-diagnosis.md):
 * (a) not signed in, (b1) signed in but the request fails, (b2) offline after
 * a failure, (c) reachable. The model is scripted; nothing here proves the
 * plan route on the iPhone.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

class StepModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: ((req: ModelRequest) => ModelEvent[])[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    const events = step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : step(request);
    for (const e of events) {
      await Promise.resolve();
      yield e;
    }
  }
}

const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const NOT_CONNECTED: TextCoachState = { status: 'not_connected', route: null, email: null, model: null };

let h: Harness;
let model: StepModel;
let connection: TextCoachState;
beforeEach(() => {
  model = new StepModel([]);
  connection = CONNECTED;
  h = createHarness('2026-10-10T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(connection) } });
});
afterEach(async () => {
  await h.cleanup();
});

/** Workout 1: Bench 60 kg × 8, 8, 8. Workout 2 from it: the built-in rule plans 62.5 kg × 3–6. */
async function bensWorkout() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
  h.clockMs += 2 * 86_400_000;
  const started = await s.workout.start({ gymId, opId: 'start-2', checkIn: null, nextOf: first });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const work = started.aggregate.sets.filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
  return { s, gymId, sessionId, first, work };
}

type S = Awaited<ReturnType<typeof bensWorkout>>['s'];

async function log(s: S, sessionId: string, setId: string, reps: number, opId: string, rpe: number | null = null): Promise<SessionAggregate> {
  h.clockMs += 60_000;
  const data = await s.workout.load(sessionId);
  const set = data?.aggregate.sets.find((x) => x.id === setId);
  const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId, setId, values: { load: set?.planned.load ?? null, reps, durationS: null, rpe, rir: null }, restTimerId: h.ids() });
  if (!r.ok) throw new Error(r.error.message);
  return r.aggregate;
}

async function offerFor(s: S, aggregate: SessionAggregate, setId: string): Promise<WorkoutOffer | null> {
  // The same calls `WorkoutCoach.afterLog` makes.
  const now = await s.coach.availability();
  return s.coach.offerAfterLog({ aggregate, setId, resting: aggregate.restTimer?.status === 'running', coachReachable: now.status === 'ok', pending: false });
}

describe('Ben’s case: 62.5 kg × 3–6 planned, 2 reps logged', () => {
  it('the built-in plan is what the diagnosis traced', async () => {
    const { work } = await bensWorkout();
    expect(work).toHaveLength(3);
    expect(work.every((x) => x.planned.load?.value === 62.5 && x.planned.reps?.min === 3 && x.planned.reps.max === 6)).toBe(true);
  });

  it('(a) not signed in: the rule offers a concrete change, tagged Rule; Adjust applies it to the remaining sets with Undo; no AI call', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    expect(agg.restTimer?.status).toBe('running');
    const offer = await offerFor(s, agg, s1.id);
    expect(offer).toMatchObject({ kind: 'reps_short', by: 'rule', fact: '2 reps on set 1 (target 3–6)', prompt: 'That looked hard. Adjust remaining sets?' });
    expect(plain(offer?.change)).toBe('Next sets: 57.5 kg × 3–6');
    const slot = slotView({ pending: false, adjustment: null, outcome: null, offer });
    expect(slot).toMatchObject({ kind: 'offer', tag: 'Rule', triggerKind: 'reps_short' });
    expect(plain(slot?.kind === 'offer' ? slot.change : null)).toBe('Next sets: 57.5 kg × 3–6');
    if (offer === null) throw new Error('no offer');

    const r = await s.coach.applyRuleOffer(offer);
    if (r.status !== 'applied') throw new Error(r.status);
    expect(r.record).toMatchObject({ author: 'checks', turnId: null, status: 'committed' });
    expect(r.record.reason).toBe('2 reps on set 1 (target 3–6). Lighter load for the remaining sets (8%).');
    // A double tap applies once.
    const again = await s.coach.applyRuleOffer(offer);
    expect(again.status === 'applied' && again.record.actionId).toBe(r.record.actionId);

    const after = (await s.workout.load(sessionId))?.aggregate;
    const bySet = (id: string) => after?.sets.find((x) => x.id === id);
    expect(bySet(s1.id)?.actual?.reps).toBe(2);
    expect(bySet(s1.id)?.planned.load?.value).toBe(62.5);
    for (const id of [s2.id, s3.id]) expect(bySet(id)?.planned).toMatchObject({ load: { value: 57.5 }, reps: { min: 3, max: 6 }, source: 'built_in_rule' });
    expect(after?.session.version).toBe(agg.session.version + 1);

    const banner = slotView({ pending: false, adjustment: r.record, outcome: null, offer: null, workout: after ?? null });
    expect(banner).toMatchObject({ kind: 'banner', tag: 'Rule', canUndo: true });
    expect(plain(banner?.kind === 'banner' ? banner.title : null)).toBe('Adjusted sets 2–3');
    expect(plain(banner?.kind === 'banner' ? banner.detail : null)).toBe('62.5 → 57.5 kg × 3–6');
    expect(whyView(r.record)).toMatchObject({ heading: 'Rule', reason: '2 reps on set 1 (target 3–6). Lighter load for the remaining sets (8%).' });

    // Why? on the changed set: the built-in rule, never the coach.
    const why = await s.workout.explainTarget(sessionId, s2.id);
    expect(plain(why?.rows.find((x) => x.key === 'set_by')?.lines[0])).toMatch(/^Built-in rule · /);
    expect(why?.rows.find((x) => x.key === 'reason')?.lines).toEqual(['Lighter load for the remaining sets (8%).', '2 reps on set 1 (target 3–6)']);
    expect(exerciseMenu(false, 'rule').options).toContain('Undo change');

    const undone = await s.coach.undo(r.record.actionId, `undo:${r.record.actionId}`);
    expect(undone.result.status).toBe('written');
    const back = (await s.workout.load(sessionId))?.aggregate;
    for (const id of [s2.id, s3.id]) expect(back?.sets.find((x) => x.id === id)?.planned.load?.value).toBe(62.5);
    expect(slotView({ pending: false, adjustment: { ...r.record, undoneBy: { actionId: undone.undo.actionId, atUtc: h.now().utc } }, outcome: null, offer: null })).toEqual({ kind: 'outcome', text: 'Change undone.', retry: false });
    expect(model.requests).toEqual([]);
  });

  it('(b2) offline after a failed request: the same rule offer', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    // A request failed less than 60 s before this log.
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Hi', spoken: false }, turnId: h.ids() });
    expect((await s.coach.availability()).status).toBe('offline');
    expect(await offerFor(s, agg, s1.id)).toMatchObject({ by: 'rule', kind: 'reps_short' });
  });

  it('(b1) reads "ok" but the Adjust turn fails on the network: the rule’s offer takes its place (F3)', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const offer = await offerFor(s, agg, s1.id);
    expect(offer).toMatchObject({ by: 'coach', change: null, kind: 'reps_short' });
    if (offer === null) throw new Error('no offer');
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    const threadId = await s.coach.resolveThread({ kind: 'workout', sessionId });
    const turn = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'chip', chip: 'too_hard', sessionExerciseId: offer.sessionExerciseId }, turnId: h.ids() });
    expect(coachCouldNotAnswer(turn)).toBe(true);
    const fallback = await s.coach.ruleOfferFor(offer);
    expect(fallback).toMatchObject({ by: 'rule', triggerId: offer.triggerId });
    expect(plain(fallback?.change)).toBe('Next sets: 57.5 kg × 3–6');
    if (fallback === null) throw new Error('no fallback');
    expect((await s.coach.applyRuleOffer(fallback)).status).toBe('applied');
  });

  it('(c) reachable: the coach’s offer at 2 reps (F1), and Adjust is the coach’s; a completed coach answer is never replaced by the rule', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const offer = await offerFor(s, agg, s1.id);
    expect(offer).toMatchObject({ by: 'coach', change: null });
    expect(slotView({ pending: false, adjustment: null, outcome: null, offer })).toMatchObject({ kind: 'offer', tag: null, change: null });
    expect(model.requests).toEqual([]);
    expect(coachCouldNotAnswer({ turnId: 't', threadId: 'x', status: 'completed', error: null, items: [], cards: [], note: null, offer: null } as never)).toBe(false);
    expect(coachCouldNotAnswer({ turnId: 't', threadId: 'x', status: 'failed', error: 'cancelled', items: [], cards: [], note: null, offer: null } as never)).toBe(false);
    expect(coachCouldNotAnswer(null)).toBe(true);
  });

  it('a stale offer is never applied to newer state: the workout moved on, nothing changes', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const offer = await offerFor(s, agg, s1.id);
    if (offer === null) throw new Error('no offer');
    await log(s, sessionId, s2.id, 3, 'log-2');
    expect(await s.coach.applyRuleOffer(offer)).toEqual({ status: 'stale' });
    expect((await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === s3.id)?.planned.load?.value).toBe(62.5);
    expect(ruleOfferOutcome('stale').text).toBe('Out of date. Nothing changed.');
    // Nothing left to change at all: say so in two words.
    await log(s, sessionId, s3.id, 3, 'log-3');
    expect(await s.coach.applyRuleOffer(offer)).toEqual({ status: 'unchanged' });
  });

  it('no offer is possible: the last set, or a raise blocked by pain; nothing is shown or recorded', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    await log(s, sessionId, s1.id, 6, 'log-1');
    await log(s, sessionId, s2.id, 6, 'log-2');
    const last = await log(s, sessionId, s3.id, 1, 'log-3');
    expect(await offerFor(s, last, s3.id)).toBeNull();
  });

  it('too easy offline with a pain flag on the movement: no offer (rule 9)', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const ex = (await s.workout.load(sessionId))?.aggregate.exercises[0];
    if (!ex) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 6, 'log-1', 5);
    // Without a flag the rule offers the next step up.
    const easy = await offerFor(s, agg, s1.id);
    expect(easy).toMatchObject({ kind: 'rpe_low', by: 'rule', prompt: 'That looked easy. Adjust remaining sets?' });
    const flagged = await s.pain.flagMovement({ exerciseId: ex.exerciseId, exerciseName: 'Bench press', opId: 'pain-1' });
    expect(flagged.ok).toBe(true);
    if (easy === null) throw new Error('no offer');
    // Flagged since the offer: the rule has nothing it may change any more.
    expect(await s.coach.applyRuleOffer(easy)).toEqual({ status: 'unchanged' });
    expect(await s.coach.ruleOfferFor(easy)).toBeNull();
  });

  it('CA4 holds for the rule’s offers too, across a force-close; an applied rule change re-opens it; the change and its Undo survive a restart', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const offer = await offerFor(s, agg, s1.id);
    if (offer === null) throw new Error('no offer');
    expect(await offerFor(s, agg, s1.id)).toBeNull();
    const applied = await s.coach.applyRuleOffer(offer);
    if (applied.status !== 'applied') throw new Error(applied.status);

    await h.forceClose();
    const { services: again } = await h.launch();
    const reloaded = (await again.workout.load(sessionId))?.aggregate;
    expect(reloaded?.sets.find((x) => x.id === s3.id)?.planned).toMatchObject({ load: { value: 57.5 }, source: 'built_in_rule' });
    // A second miss after the change: a new offer (the plan changed since), from the lighter plan.
    const agg2 = await log(again, sessionId, s2.id, 1, 'log-2');
    const second = await offerFor(again, agg2, s2.id);
    expect(second).toMatchObject({ by: 'rule', fact: '1 rep on set 2 (target 3–6)' });
    expect(plain(second?.change)).toBe('Next set: 52.5 kg × 3–6');
    const undone = await again.coach.undo(applied.record.actionId, `undo:${applied.record.actionId}`);
    expect(undone.result.status).toBe('written');
    // Set 2 was logged since, so only set 3 comes back.
    expect(undone.undo.detail).toMatchObject({ kind: 'undo', alreadyLogged: [2] });
    expect((await again.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === s3.id)?.planned.load?.value).toBe(62.5);
  });

  it('F4: correcting a logged set’s reps down runs the check again (new set version, new trigger)', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 6, 'log-1');
    expect(await offerFor(s, agg, s1.id)).toBeNull();
    const set = agg.sets.find((x) => x.id === s1.id);
    const fixed = await s.workout.correctSet({ sessionId, setId: s1.id, expectedSetVersion: set?.version ?? 0, patch: { reps: 2 }, opId: 'fix-1' });
    if (!fixed.ok) throw new Error(fixed.message);
    expect(await offerFor(s, fixed.aggregate, s1.id)).toMatchObject({ by: 'rule', fact: '2 reps on set 1 (target 3–6)' });
  });

  it('F5 + 7-F: the miss feeds next session; the Summary lists the hold; the next workout never raises; a second miss reduces', async () => {
    const { s, gymId, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    for (const [i, set] of work.entries()) await log(s, sessionId, set.id, [2, 1, 2][i] ?? 2, `log-${String(i)}`);
    h.clockMs += 60_000;
    const data = await s.workout.load(sessionId);
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin-2', expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    const summary = await s.workout.summary(sessionId, 'not_connected');
    const row = summary?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press');
    expect(row).toMatchObject({ kind: 'held', decision: 'hold_after_miss' });
    expect(plain(row?.target)).toBe('Same target: 62.5 kg × 3–6');
    expect(summary?.nextTime?.emptyText ?? null).toBeNull();
    const view = nextTimeView({ title: 'Workout', builtIn: summary?.nextTime ?? null, coachRows: [], availability: await s.coach.availability(), reviewing: false });
    expect(view?.rows.find((r) => r.exerciseName === 'Bench press')).toMatchObject({ tag: 'Rule' });

    h.clockMs += 2 * 86_400_000;
    const third = await s.workout.start({ gymId, opId: 'start-3', checkIn: null, nextOf: sessionId });
    if (!third.ok) throw new Error(third.error.message);
    const work3 = third.aggregate.sets.filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
    expect(work3.every((x) => x.planned.load?.value === 62.5)).toBe(true);
    for (const [i, set] of work3.entries()) await log(s, third.aggregate.session.id, set.id, 2, `log3-${String(i)}`);
    h.clockMs += 60_000;
    const d3 = await s.workout.load(third.aggregate.session.id);
    const fin3 = await s.workout.dispatch(third.aggregate.session.id, { type: 'finish', at: h.now(), opId: 'fin-3', expectedVersion: d3?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin3.ok) throw new Error(fin3.error.message);
    await h.settle(s);
    const summary3 = await s.workout.summary(third.aggregate.session.id, 'not_connected');
    const row3 = summary3?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press');
    expect(row3).toMatchObject({ kind: 'change', decision: 'reduce_load' });
    expect(plain(row3?.target)).toBe('Target 55 kg × 3–6');
  });

  it('F5: after the rule lowered today’s sets, the hold is on the lighter load and reads `Target`, not `Same target`', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const offer = await offerFor(s, agg, s1.id);
    if (offer === null) throw new Error('no offer');
    expect((await s.coach.applyRuleOffer(offer)).status).toBe('applied');
    await log(s, sessionId, s2.id, 5, 'log-2');
    await log(s, sessionId, s3.id, 5, 'log-3');
    h.clockMs += 60_000;
    const data = await s.workout.load(sessionId);
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin-2', expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    const row = (await s.workout.summary(sessionId, 'not_connected'))?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press');
    expect(row).toMatchObject({ kind: 'held', decision: 'hold_after_miss' });
    expect(plain(row?.target)).toBe('Target 57.5 kg × 3–6');
  });
});

describe('F7: a miss logged with no rest running is checked when the next rest starts', () => {
  it('holds sets until a rest, newest first, then clears', () => {
    expect(offerCandidates([], 'a', false)).toEqual({ check: [], held: ['a'] });
    expect(offerCandidates(['a'], 'b', false)).toEqual({ check: [], held: ['b', 'a'] });
    expect(offerCandidates(['b', 'a'], 'c', true)).toEqual({ check: ['c', 'b', 'a'], held: [] });
    expect(offerCandidates(['a'], 'a', true)).toEqual({ check: ['a'], held: [] });
    expect(offerCandidates(['1', '2', '3', '4', '5', '6'], '7', false).held).toHaveLength(6);
  });
});

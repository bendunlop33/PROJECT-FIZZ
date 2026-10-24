import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { StackRouter, type ParamListBase, type StackNavigationState } from '@react-navigation/routers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { NBSP, slotsOf } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';
import type { SessionAggregate } from '@fizz/schemas';

import type { WorkoutOffer } from '../src/coach/coach-service';
import { nextTimeView } from '../src/coach/next-time-view';
import { chipRoute, correctedSetToCheck, findOffer, NO_HELD_SETS, planOfferCheck, routeChip, settleTurn, type ChipGate, type RuleRequest } from '../src/coach/offer-check';
import { returnToWorkout } from '../src/navigation/actions';
import { whyView } from '../src/coach/sheet-view';
import { coachCouldNotAnswer, offerCandidates, ruleOfferOutcome, slotAfterTurn, slotView } from '../src/coach/slot-view';
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
    expect(plain(why?.rows.find((x) => x.key === 'set_by')?.lines[0])).toMatch(/^Rule · /);
    expect(why?.rows.find((x) => x.key === 'reason')?.lines).toEqual(['Lighter load for the remaining sets (8%)']);
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

  it('S2: the same words on different sets is a different change: refused; a draft or rest edit since (version moved, same sets and targets) still applies', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const exId = s1.sessionExerciseId;
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const offer = await offerFor(s, agg, s1.id);
    if (offer === null) throw new Error('no offer');
    expect(offer.basis).toMatchObject({ baseVersion: agg.session.version, touchedSetIds: [s2.id, s3.id] });

    // Ben adds a set during the rest: the remaining sets are now 2–4, all 62.5 kg × 3–6, so the words are the same.
    const added = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: 'add-1', sessionExerciseId: exId, newSetId: h.ids(), setType: null });
    if (!added.ok) throw new Error(added.error.message);
    const again = await s.coach.ruleOfferFor(offer);
    expect(plain(again?.change)).toBe(plain(offer.change));
    expect(again?.basis?.touchedSetIds).toHaveLength(3);
    expect(await s.coach.applyRuleOffer(offer)).toEqual({ status: 'stale' });
    const now = (await s.workout.load(sessionId))?.aggregate;
    expect(now?.sets.filter((x) => x.status === 'pending' && x.setType !== 'warmup').every((x) => x.planned.load?.value === 62.5)).toBe(true);
    // The offer worked out on this state applies.
    if (again === null) throw new Error('no offer');
    expect((await s.coach.applyRuleOffer(again)).status).toBe('applied');
  });

  it('S2: a rest edit after the offer moves the version but not the change: Adjust still applies', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const offer = await offerFor(s, agg, s1.id);
    if (offer === null) throw new Error('no offer');
    const rest = await s.workout.dispatch(sessionId, { type: 'set_rest_after', at: h.now(), opId: 'rest-1', setId: s3.id, seconds: 90, scope: 'set', expectedVersion: agg.session.version });
    if (!rest.ok) throw new Error(rest.error.message);
    expect(rest.aggregate.session.version).toBeGreaterThan(agg.session.version);
    const r = await s.coach.applyRuleOffer(offer);
    expect(r.status).toBe('applied');
    // A rule offer without its basis (an old shape) is never applied.
    expect(await s.coach.applyRuleOffer({ ...offer, triggerId: 'other', basis: null })).toEqual({ status: 'stale' });
  });

  it('no offer is possible on the last set; nothing is shown or recorded', async () => {
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

  it('F5 + 7-F: the miss feeds next session; the Summary lists the hold; the next workout never raises; a second miss offers the reset (Ben, 23 Oct)', async () => {
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
    const thirdId = third.aggregate.session.id;
    const summary3 = await s.workout.summary(thirdId, 'not_connected');
    const row3 = summary3?.nextTime?.rows.find((r) => r.exerciseName === 'Bench press');
    // (Ben, 23 Oct; v5offers SP2) The rule's own reset is an offer: it holds at 62.5 until Ben applies 57.5.
    expect(row3).toMatchObject({ kind: 'held', decision: 'hold_after_miss' });
    expect(plain(row3?.target)).toBe('Same target: 62.5 kg × 3–6');
    expect(plain(row3?.resetOffer?.text)).toBe('Reset to 57.5 kg × 3–6?');
    const viewOf = async (id: string) => {
      const sum = await s.workout.summary(id, 'not_connected');
      return nextTimeView({ title: 'Workout', builtIn: sum?.nextTime ?? null, coachRows: await s.coach.nextTargets(id), ruleRows: await s.coach.ruleResets(id), availability: await s.coach.availability(), reviewing: false })?.rows.find((r) => r.exerciseName === 'Bench press');
    };
    const offered = await viewOf(thirdId);
    expect(offered).toMatchObject({ tag: 'Rule', actions: [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }] });
    expect(plain(offered?.note)).toBe('Reset to 57.5 kg × 3–6?');
    // Not applied: next time holds.
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).not.toContain('57.5');
    const reset = offered?.reset;
    if (reset === undefined) throw new Error('no reset');
    // Apply (offline, no coach): next time is 57.5; a double tap writes once.
    expect(await s.coach.tapRuleReset(thirdId, reset, 'apply')).toEqual({ status: 'written' });
    expect(await s.coach.tapRuleReset(thirdId, reset, 'apply')).toEqual({ status: 'replayed' });
    expect(await s.coach.nextTargets(thirdId)).toEqual([]);
    const applied = await viewOf(thirdId);
    expect(plain(applied?.target)).toBe('Target 57.5 kg × 3–6');
    expect(applied).toMatchObject({ tag: 'Rule', actions: [{ label: 'Undo', tap: 'undo' }] });
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).toContain('57.5');
    // Your workout plans from the same rule (builder loads): the bench is at most 57.5 now (62.5 before the Apply).
    const opened = await s.builder.openTarget({ kind: 'session', sourceSessionId: thirdId }, 'open-after-reset');
    if (opened.snapshot == null) throw new Error('no builder');
    const benchTop = slotsOf(opened.snapshot.workout.blocks).find((x) => opened.snapshot?.facts[x.exerciseId]?.name === 'Bench press')?.rows.find((r) => r.type !== 'warmup')?.load ?? null;
    expect(benchTop).not.toBeNull();
    expect(benchTop ?? 99).toBeLessThanOrEqual(57.5);
    // Undo: offered again, next time holds.
    const r2 = applied?.reset;
    if (r2 === undefined) throw new Error('no reset');
    expect(await s.coach.tapRuleReset(thirdId, r2, 'undo')).toEqual({ status: 'written' });
    const again = await viewOf(thirdId);
    expect(again).toMatchObject({ actions: [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }] });
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).not.toContain('57.5');
    // Skip: it holds, no buttons, never offered again for this workout.
    const r3 = again?.reset;
    if (r3 === undefined) throw new Error('no reset');
    expect(await s.coach.tapRuleReset(thirdId, r3, 'not_now')).toEqual({ status: 'written' });
    const skipped = await viewOf(thirdId);
    expect(skipped?.actions).toEqual([]);
    expect(plain(skipped?.target)).toBe('Same target: 62.5 kg × 3–6');
    // After a relaunch the answer stands.
    const { services: relaunched } = await h.launch();
    const sum4 = await relaunched.workout.summary(thirdId, 'not_connected');
    const v4 = nextTimeView({ title: 'Workout', builtIn: sum4?.nextTime ?? null, coachRows: await relaunched.coach.nextTargets(thirdId), ruleRows: await relaunched.coach.ruleResets(thirdId), availability: await relaunched.coach.availability(), reviewing: false });
    expect(v4?.rows.find((r) => r.exerciseName === 'Bench press')?.actions).toEqual([]);
  });

  it('Ben, 23 Oct: Skip as the first answer holds; the next workout from it starts at the held load', async () => {
    const { s, gymId, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    for (const [i, set] of work.entries()) await log(s, sessionId, set.id, 2, `log-${String(i)}`);
    h.clockMs += 60_000;
    const d = await s.workout.load(sessionId);
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin-2', expectedVersion: d?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    h.clockMs += 2 * 86_400_000;
    const third = await s.workout.start({ gymId, opId: 'start-3', checkIn: null, nextOf: sessionId });
    if (!third.ok) throw new Error(third.error.message);
    const work3 = third.aggregate.sets.filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
    for (const [i, set] of work3.entries()) await log(s, third.aggregate.session.id, set.id, 2, `log3-${String(i)}`);
    h.clockMs += 60_000;
    const d3 = await s.workout.load(third.aggregate.session.id);
    const fin3 = await s.workout.dispatch(third.aggregate.session.id, { type: 'finish', at: h.now(), opId: 'fin-3', expectedVersion: d3?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin3.ok) throw new Error(fin3.error.message);
    await h.settle(s);
    const thirdId = third.aggregate.session.id;
    const sum = await s.workout.summary(thirdId, 'not_connected');
    const view = nextTimeView({ title: 'Workout', builtIn: sum?.nextTime ?? null, coachRows: [], ruleRows: [], availability: await s.coach.availability(), reviewing: false })?.rows.find((r) => r.exerciseName === 'Bench press');
    const reset = view?.reset;
    if (reset === undefined) throw new Error('no reset');
    expect(await s.coach.tapRuleReset(thirdId, reset, 'not_now')).toEqual({ status: 'written' });
    expect((await s.coach.ruleResets(thirdId)).map((r) => r.status)).toEqual(['not_applied']);
    h.clockMs += 2 * 86_400_000;
    const fourth = await s.workout.start({ gymId, opId: 'start-4', checkIn: null, nextOf: thirdId });
    if (!fourth.ok) throw new Error(fourth.error.message);
    expect(fourth.aggregate.sets.filter((x) => x.setType !== 'warmup').every((x) => x.planned.load?.value === 62.5)).toBe(true);
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

describe('S1: Ben’s own Too hard / Too easy with no coach: the built-in rule applies at once, with Undo', () => {
  it('not connected: chips are shown; Too hard after set 1 lowers sets 2–3 now (no AI call), set 1 untouched; a double tap applies once; Undo restores', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const logged = await log(s, sessionId, s1.id, 6, 'log-1');
    const r = await s.coach.applyRuleRequest({ sessionId, sessionExerciseId: s1.sessionExerciseId, intent: 'too_hard', opId: 'tap-1' });
    if (r.status !== 'applied') throw new Error(r.status);
    expect(r.record).toMatchObject({ author: 'checks', turnId: null, reason: 'Too hard. Lighter load for the remaining sets (8%).' });
    expect((await s.coach.applyRuleRequest({ sessionId, sessionExerciseId: s1.sessionExerciseId, intent: 'too_hard', opId: 'tap-1' })).status).toBe('applied');
    const after = (await s.workout.load(sessionId))?.aggregate;
    expect(after?.sets.find((x) => x.id === s1.id)?.actual).toMatchObject({ reps: 6, load: { value: 62.5 } });
    for (const id of [s2.id, s3.id]) expect(after?.sets.find((x) => x.id === id)?.planned).toMatchObject({ load: { value: 57.5 }, source: 'built_in_rule' });
    // One version step: the double tap replayed.
    expect(after?.session.version).toBe(logged.session.version + 1);
    expect(slotView({ pending: false, adjustment: r.record, outcome: null, offer: null, workout: after ?? null })).toMatchObject({ kind: 'banner', tag: 'Rule', canUndo: true });
    expect(model.requests).toEqual([]);
    const undone = await s.coach.undo(r.record.actionId, `undo:${r.record.actionId}`);
    expect(undone.result.status).toBe('written');
    expect((await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === s3.id)?.planned.load?.value).toBe(62.5);
  });

  it('offline after a failed chip turn: the rule’s change applies; too easy with a pain flag changes nothing', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    const threadId = await s.coach.resolveThread({ kind: 'workout', sessionId });
    const turn = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'chip', chip: 'too_easy' }, turnId: h.ids() });
    expect(coachCouldNotAnswer(turn)).toBe(true);
    expect((await s.coach.availability()).status).toBe('offline');
    const easy = await s.coach.applyRuleRequest({ sessionId, sessionExerciseId: s1.sessionExerciseId, intent: 'too_easy', opId: 'tap-2' });
    if (easy.status !== 'applied') throw new Error(easy.status);
    const ex = (await s.workout.load(sessionId))?.aggregate.exercises[0];
    if (!ex) throw new Error('fixture');
    await s.coach.undo(easy.record.actionId, `undo:${easy.record.actionId}`);
    await s.pain.flagMovement({ exerciseId: ex.exerciseId, exerciseName: 'Bench press', opId: 'pain-1' });
    expect(await s.coach.applyRuleRequest({ sessionId, sessionExerciseId: s1.sessionExerciseId, intent: 'too_easy', opId: 'tap-3' })).toEqual({ status: 'unchanged' });
    expect(ruleOfferOutcome('unchanged').text).toBe('Nothing to change.');
    // Another workout's row, or none: nothing changes.
    expect(await s.coach.applyRuleRequest({ sessionId, sessionExerciseId: 'nope', intent: 'too_hard', opId: 'tap-4' })).toEqual({ status: 'stale' });
  });
});

/** A model that waits until the turn is stopped (Ben's Cancel). */
class HangingModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    await new Promise<void>((resolve) => request.signal?.addEventListener('abort', () => { resolve(); }));
    yield* [];
  }
}

describe('r2 S1: the chip routing the hook uses (chipRoute, then settleTurn after the coach turn)', () => {
  /** What `useWorkoutCoach.askChip` and `ask` do for a chip, on the real services. */
  async function tapChip(s: S, sessionId: string, request: RuleRequest, during?: (turnId: string) => Promise<void>) {
    const route = chipRoute(await s.coach.availability());
    if (route === 'rule') {
      const r = await s.coach.applyRuleRequest({ sessionId, ...request, opId: h.ids() });
      return { route, adjustment: r.status === 'applied' ? r.record : null, outcome: r.status === 'applied' ? null : ruleOfferOutcome(r.status), offer: null };
    }
    const turnId = h.ids();
    const threadId = await s.coach.resolveThread({ kind: 'workout', sessionId });
    const sending = s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'chip', chip: request.intent }, turnId });
    if (during !== undefined) await during(turnId);
    const result = await sending;
    return { route, ...(await settleTurn(s.coach, { sessionId, turnId, result, after: slotAfterTurn(result), offered: null, request })) };
  }

  async function plannedLoads(s: S, sessionId: string, ids: string[]) {
    const a = (await s.workout.load(sessionId))?.aggregate;
    return ids.map((id) => a?.sets.find((x) => x.id === id)?.planned.load?.value);
  }

  it('the coach answered with no change: its answer stands, the rule changes nothing', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    await log(s, sessionId, s1.id, 6, 'log-1');
    model = new StepModel([() => [{ type: 'tool_call', callId: 'c-reply', name: 'reply', arguments: JSON.stringify({ message: 'Keep the load.', offer: null }) }, { type: 'completed' }]]);
    const r = await tapChip(s, sessionId, { sessionExerciseId: s1.sessionExerciseId, intent: 'too_hard' });
    expect(r.route).toBe('coach');
    expect(model.requests).toHaveLength(1);
    expect(r).toMatchObject({ adjustment: null, offer: null, outcome: { text: 'No change made.' } });
    expect(await plannedLoads(s, sessionId, [s2.id, s3.id])).toEqual([62.5, 62.5]);
  });

  it('review S5 (build 156): a model that asks "which set?" on Too hard instead of acting: the rule’s change applies now, with Undo', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    await log(s, sessionId, s1.id, 6, 'log-1');
    // Disobeys "never ask which set": no tool call, a question.
    model = new StepModel([() => [{ type: 'tool_call', callId: 'c-reply', name: 'reply', arguments: JSON.stringify({ message: 'Was that about the warm-up or a working set?', offer: null }) }, { type: 'completed' }]]);
    const r = await tapChip(s, sessionId, { sessionExerciseId: s1.sessionExerciseId, intent: 'too_hard' });
    expect(r.route).toBe('coach');
    expect(model.requests).toHaveLength(1);
    expect(r.adjustment).toMatchObject({ author: 'checks', status: 'committed' });
    expect(r.outcome).toBeNull();
    expect(await plannedLoads(s, sessionId, [s2.id, s3.id])).toEqual([57.5, 57.5]);
    if (r.adjustment === null) throw new Error('no adjustment');
    expect((await s.coach.undo(r.adjustment.actionId, `undo:${r.adjustment.actionId}`)).result.status).toBe('written');
    expect(await plannedLoads(s, sessionId, [s2.id, s3.id])).toEqual([62.5, 62.5]);
  });

  it('the coach turn failed on the network: the rule’s change applies now, with Undo', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    await log(s, sessionId, s1.id, 6, 'log-1');
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    const r = await tapChip(s, sessionId, { sessionExerciseId: s1.sessionExerciseId, intent: 'too_hard' });
    expect(r.route).toBe('coach');
    expect(r.adjustment).toMatchObject({ author: 'checks', status: 'committed' });
    expect(r.outcome).toBeNull();
    expect(await plannedLoads(s, sessionId, [s2.id, s3.id])).toEqual([57.5, 57.5]);
    // r3 N7: and its Undo puts the plan back.
    if (r.adjustment === null) throw new Error('no adjustment');
    const undone = await s.coach.undo(r.adjustment.actionId, `undo:${r.adjustment.actionId}`);
    expect(undone.result.status).toBe('written');
    expect(await plannedLoads(s, sessionId, [s2.id, s3.id])).toEqual([62.5, 62.5]);
  });

  it('Ben cancelled the coach turn: nothing changes, the rule does not step in', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    await log(s, sessionId, s1.id, 6, 'log-1');
    const hanging = new HangingModel();
    model = hanging as unknown as StepModel;
    const r = await tapChip(s, sessionId, { sessionExerciseId: s1.sessionExerciseId, intent: 'too_hard' }, async (turnId) => {
      for (let i = 0; i < 200 && hanging.requests.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
      s.coach.stop(turnId);
    });
    expect(r.route).toBe('coach');
    expect(hanging.requests).toHaveLength(1);
    expect(r).toMatchObject({ adjustment: null, offer: null });
    expect(await plannedLoads(s, sessionId, [s2.id, s3.id])).toEqual([62.5, 62.5]);
  });

  it('Offline: the chip goes to the rule at once, no AI call', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    await log(s, sessionId, s1.id, 6, 'log-1');
    // A request failed just now: `Offline` for the next 60 s.
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Hi', spoken: false }, turnId: h.ids() });
    expect((await s.coach.availability()).status).toBe('offline');
    const r = await tapChip(s, sessionId, { sessionExerciseId: s1.sessionExerciseId, intent: 'too_hard' });
    expect(r.route).toBe('rule');
    expect(model.requests).toHaveLength(1);
    expect(r.adjustment).toMatchObject({ author: 'checks' });
    expect(await plannedLoads(s, sessionId, [s2.id, s3.id])).toEqual([57.5, 57.5]);
  });

  it('chipRoute: only `ok` asks the coach', () => {
    expect(chipRoute({ status: 'ok', model: null })).toBe('coach');
    expect(chipRoute({ status: 'offline', model: null })).toBe('rule');
    expect(chipRoute(null)).toBe('rule');
  });
});

describe('S3: the screen wiring for F4 and F7, through the same functions the screens call', () => {
  const router = StackRouter({});
  const options = { routeNames: ['Tabs', 'Workout', 'EditSet'], routeParamList: {}, routeGetIdList: {} };
  type State = StackNavigationState<ParamListBase>;
  const apply = (state: State, action: Parameters<typeof router.getStateForAction>[1]): State => {
    const next = router.getStateForAction(state, action, options);
    if (next === null) throw new Error(action.type);
    return next as State;
  };

  it('F4: correct 6 → 2 in the sheet, return to the one Workout with `corrected`, and its check offers the rule’s change', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const logged = await log(s, sessionId, s1.id, 6, 'log-1');
    let held = NO_HELD_SETS;
    const first = planOfferCheck(held, logged, s1.id);
    held = first.held;
    expect((await findOffer(s.coach, { aggregate: logged, check: first.check, resting: first.resting, pending: false })).offer).toBeNull();

    let nav = apply(router.getInitialState(options), { type: 'NAVIGATE', payload: { name: 'Workout', params: {} } });
    nav = apply(nav, { type: 'NAVIGATE', payload: { name: 'EditSet', params: { sessionId, setId: s1.id } } });
    // EditSetScreen.save(): correctSet, then back with the corrected key.
    const set = logged.sets.find((x) => x.id === s1.id);
    const fixed = await s.workout.correctSet({ sessionId, setId: s1.id, expectedSetVersion: set?.version ?? 0, patch: { reps: 2 }, opId: 'fix-1' });
    if (!fixed.ok) throw new Error(fixed.message);
    nav = apply(nav, returnToWorkout({ corrected: { setId: s1.id, key: 'fix-1' } }));
    expect(nav.routes.map((r) => r.name)).toEqual(['Tabs', 'Workout']);
    const corrected = (nav.routes[1]?.params as { corrected?: { setId: string; key: string } }).corrected;

    // WorkoutScreen's F4 effect: reload, then afterLog on the corrected set.
    const reloaded = (await s.workout.load(sessionId))?.aggregate;
    const id = correctedSetToCheck(corrected, reloaded);
    expect(id).toBe(s1.id);
    if (reloaded === undefined || id === null) throw new Error('fixture');
    const plan = planOfferCheck(held, reloaded, id);
    const found = await findOffer(s.coach, { aggregate: reloaded, check: plan.check, resting: plan.resting, pending: false });
    expect(found.availability.status).toBe('not_connected');
    expect(found.offer).toMatchObject({ by: 'rule', fact: '2 reps on set 1 (target 3–6)' });
    // A pending set that wasn't logged is never checked.
    expect(correctedSetToCheck({ setId: work[2]?.id ?? '' }, reloaded)).toBeNull();
  });

  it('B2 (review target-rpe): Edit set → Target RPE 10 on a just-logged RPE 10 set clears the "too hard" offer through F4', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const logged = await log(s, sessionId, s1.id, 6, 'log-1', 10);
    const first = planOfferCheck(NO_HELD_SETS, logged, s1.id);
    const shown = (await findOffer(s.coach, { aggregate: logged, check: first.check, resting: first.resting, pending: false })).offer;
    expect(shown).toMatchObject({ by: 'rule', kind: 'rpe_high' });
    // EditSetScreen: the sheet's view, then Save with Ben's target.
    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('fixture');
    const view = s.workout.editView(data, s1.id, null, null, 10);
    expect(view?.targetRpe).toMatchObject({ override: 10, changed: true });
    expect(view?.changed).toBe(true);
    const set = logged.sets.find((x) => x.id === s1.id);
    const fixed = await s.workout.correctSet({ sessionId, setId: s1.id, expectedSetVersion: set?.version ?? 0, patch: { targetRpe: 10 }, opId: 'fix-rpe' });
    if (!fixed.ok) throw new Error(fixed.message);
    expect(fixed.aggregate.sets.find((x) => x.id === s1.id)?.actual).toEqual(set?.actual);
    // WorkoutScreen's F4 effect: the corrected set is checked again; the shown offer goes.
    const reloaded = (await s.workout.load(sessionId))?.aggregate;
    const id = correctedSetToCheck({ setId: s1.id }, reloaded);
    if (reloaded === undefined || id === null) throw new Error('fixture');
    const plan = planOfferCheck(first.held, reloaded, id);
    expect((await findOffer(s.coach, { aggregate: reloaded, check: plan.check, resting: plan.resting, pending: false, shown })).offer).toBeNull();
    // Adjust tapped before F4 clears the card: the set no longer triggers it, so it is refused and nothing changes (review r3 S1).
    if (!shown) throw new Error('fixture');
    expect(await s.coach.ruleOfferFor(shown)).toBeNull();
    expect(await s.coach.applyRuleOffer(shown)).toEqual({ status: 'stale' });
    const after = (await s.workout.load(sessionId))?.aggregate;
    expect(after?.session.version).toBe(reloaded.session.version);
    expect(after?.sets.map((x) => x.planned)).toEqual(reloaded.sets.map((x) => x.planned));
    // A replay of the same save applies once; a stale set version is refused.
    const again = await s.workout.correctSet({ sessionId, setId: s1.id, expectedSetVersion: set?.version ?? 0, patch: { targetRpe: 10 }, opId: 'fix-rpe' });
    expect(again.ok).toBe(true);
    expect((await s.workout.load(sessionId))?.aggregate.session.version).toBe(reloaded.session.version);
    const stale = await s.workout.correctSet({ sessionId, setId: s1.id, expectedSetVersion: set?.version ?? 0, patch: { targetRpe: 9 }, opId: 'fix-rpe-2' });
    expect(stale).toMatchObject({ ok: false, stale: true });
  });

  it('review target-rpe r3 S1: logged RPE corrected 10 → 8 after the "too hard" offer shows; Adjust is refused', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const logged = await log(s, sessionId, s1.id, 6, 'log-1', 10);
    const first = planOfferCheck(NO_HELD_SETS, logged, s1.id);
    const shown = (await findOffer(s.coach, { aggregate: logged, check: first.check, resting: first.resting, pending: false })).offer;
    expect(shown).toMatchObject({ by: 'rule', kind: 'rpe_high' });
    if (!shown) throw new Error('fixture');
    const set = logged.sets.find((x) => x.id === s1.id);
    const fixed = await s.workout.correctSet({ sessionId, setId: s1.id, expectedSetVersion: set?.version ?? 0, patch: { rpe: 8 }, opId: 'fix-rpe-8' });
    if (!fixed.ok) throw new Error(fixed.message);
    const before = (await s.workout.load(sessionId))?.aggregate;
    if (!before) throw new Error('fixture');
    expect(await s.coach.triggerKindOf(before, s1.id)).toBeNull();
    expect(await s.coach.ruleOfferFor(shown)).toBeNull();
    expect(await s.coach.applyRuleOffer(shown)).toEqual({ status: 'stale' });
    // A double tap is refused too, and nothing changed.
    expect(await s.coach.applyRuleOffer(shown)).toEqual({ status: 'stale' });
    const after = (await s.workout.load(sessionId))?.aggregate;
    expect(after?.session.version).toBe(before.session.version);
    expect(after?.sets.map((x) => x.planned)).toEqual(before.sets.map((x) => x.planned));
  });

  it('F7: a superset’s A1 missed with no rest running, then B1 starts the round’s rest: the offer for A, by the rule, offline', async () => {
    const { services: s0 } = await h.launch();
    const gymId = await setUpGym(h, s0);
    const first = await logWorkout(h, s0, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }, { load: 50, reps: 10 }] },
    ]);
    h.clockMs += 2 * 86_400_000;
    const started = await s0.workout.start({ gymId, opId: 'start-ss', checkIn: null, nextOf: first });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    // Make A and B a superset in the saved workout (no service builds one outside a routine), then relaunch.
    await h.forceClose();
    const file = readdirSync(h.dir).find((f) => /^training-\d+\.db$/.test(f));
    if (file === undefined) throw new Error('no db');
    const db = new DatabaseSync(join(h.dir, file));
    db.prepare("UPDATE session_exercises SET superset_group = 'A' WHERE session_id = ?").run(sessionId);
    db.close();
    const { services: s } = await h.launch();
    connection = NOT_CONNECTED;
    const agg = (await s.workout.load(sessionId))?.aggregate;
    if (!agg) throw new Error('no workout');
    expect(agg.exercises.every((e) => e.supersetGroup === 'A')).toBe(true);
    const [a, b] = [...agg.exercises].sort((x, y) => x.order - y.order);
    const firstOf = (exId: string | undefined) => agg.sets.filter((x) => x.sessionExerciseId === exId && x.setType !== 'warmup').sort((x, y) => x.index - y.index)[0];
    const a1 = firstOf(a?.id);
    const b1 = firstOf(b?.id);
    if (!a1 || !b1 || !a) throw new Error('fixture');
    expect(a1.planned.reps?.min).toBeGreaterThan(2);

    let held = NO_HELD_SETS;
    const afterA = await log(s, sessionId, a1.id, 2, 'log-a1');
    expect(afterA.restTimer?.status === 'running').toBe(false);
    const p1 = planOfferCheck(held, afterA, a1.id);
    held = p1.held;
    expect(p1).toMatchObject({ check: [], resting: false });
    expect(held.ids).toEqual([a1.id]);

    const afterB = await log(s, sessionId, b1.id, b1.planned.reps?.max ?? 10, 'log-b1');
    expect(afterB.restTimer?.status).toBe('running');
    const p2 = planOfferCheck(held, afterB, b1.id);
    expect(p2.check).toEqual([b1.id, a1.id]);
    expect(p2.held.ids).toEqual([]);
    const found = await findOffer(s.coach, { aggregate: afterB, check: p2.check, resting: p2.resting, pending: false });
    expect(found.offer).toMatchObject({ by: 'rule', kind: 'reps_short', setId: a1.id, sessionExerciseId: a.id });
    expect(found.offer?.change).toMatch(/^Next sets?: /);
    // Held sets are per workout: another workout's ID starts empty.
    expect(planOfferCheck({ sessionId: 'other', ids: [a1.id] }, afterB, b1.id).check).toEqual([b1.id]);
    expect(model.requests).toEqual([]);
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

describe('r3 nits: N6 settleTurn’s F3 branch, N3 an effort chip keeps a shown offer, N5 two quick chip taps', () => {
  it('N6: Adjust on the coach’s offer, then the turn fails on the network: settleTurn swaps in the rule’s offer, no outcome line', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const offered = await offerFor(s, agg, s1.id);
    expect(offered).toMatchObject({ by: 'coach', kind: 'reps_short' });
    if (offered === null) throw new Error('no offer');
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    const turnId = h.ids();
    const threadId = await s.coach.resolveThread({ kind: 'workout', sessionId });
    const result = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input: { kind: 'chip', chip: 'too_hard', sessionExerciseId: offered.sessionExerciseId }, turnId });
    const settled = await settleTurn(s.coach, { sessionId, turnId, result, after: slotAfterTurn(result), offered, request: null });
    expect(settled.offer).toMatchObject({ by: 'rule', triggerId: offered.triggerId, kind: 'reps_short' });
    expect(plain(settled.offer?.change)).toBe('Next sets: 57.5 kg × 3–6');
    expect(settled.outcome).toBeNull();
    expect(settled.adjustment).toBeNull();
  });

  it('N3: an effort chip on the same set keeps the shown offer while it still holds, and drops it once it doesn’t', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    const shown = await offerFor(s, agg, s1.id);
    expect(shown).toMatchObject({ by: 'rule', kind: 'reps_short' });
    const effort = async (rpe: number, opId: string) => {
      const cur = (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === s1.id);
      const r = await s.workout.dispatch(sessionId, { type: 'correct_set', at: h.now(), opId, setId: s1.id, expectedSetVersion: cur?.version ?? 0, patch: { rpe } });
      if (!r.ok) throw new Error(r.error.message);
      return r.aggregate;
    };
    // RPE 9 against the 8.5 target: still a miss (CA4 alone would have hidden it for good).
    const at9 = await effort(9, 'rpe-9');
    const plan = planOfferCheck(NO_HELD_SETS, at9, s1.id);
    expect((await findOffer(s.coach, { aggregate: at9, check: plan.check, resting: plan.resting, pending: false, shown })).offer).toBe(shown);
    // RPE 7 is clearly below target: he stopped with reps in the tank, so no miss.
    const at7 = await effort(7, 'rpe-7');
    expect((await findOffer(s.coach, { aggregate: at7, check: plan.check, resting: true, pending: false, shown })).offer).toBeNull();
    // Without the shown offer (another set's log), nothing is kept.
    expect((await findOffer(s.coach, { aggregate: at9, check: plan.check, resting: true, pending: false, shown: null })).offer).toBeNull();
  });

  it('N5: two quick taps while the availability read is in flight apply one reduction', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    await log(s, sessionId, s1.id, 6, 'log-1');
    const gate: ChipGate = { busy: false };
    let release: () => void = () => undefined;
    const slow = { availability: () => new Promise<Awaited<ReturnType<S['coach']['availability']>>>((resolve) => { release = () => { void s.coach.availability().then(resolve); }; }) };
    let writes = 0;
    const tap = () =>
      routeChip(slow, gate, null, {
        coach: () => { throw new Error('not reachable'); },
        rule: async () => {
          writes += 1;
          await s.coach.applyRuleRequest({ sessionId, sessionExerciseId: s1.sessionExerciseId, intent: 'too_hard', opId: h.ids() });
        },
      });
    const first = tap();
    const second = tap();
    release();
    expect(await second).toBe('busy');
    expect(await first).toBe('rule');
    expect(writes).toBe(1);
    expect(await plannedLoadsOf(s, sessionId, [s2.id, s3.id])).toEqual([57.5, 57.5]);
    // Once done, the next tap goes through.
    expect(gate.busy).toBe(false);
  });
});

describe('CHANGELOG 2026-10-11: offers follow the target RPE, on real SQLite', () => {
  it('every working set shows its target RPE; the built-in rule’s 8.5 for a main barbell lift', async () => {
    const { s, sessionId, work } = await bensWorkout();
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('fixture');
    const v = s.workout.view(data, h.clockMs, null);
    expect(plain(v.focus?.target)).toMatch(/@ RPE 8\.5$/);
    expect(v.focus?.targetRpe).toEqual({ rpe: 8.5, source: 'rule' });
  });

  it('RPE 10 on an RPE-10 plan (Ben’s override): no offer; RPE 10 on an RPE-8 plan: offer', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2, s3] = work;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    const exId = s1.sessionExerciseId;
    const setTarget = async (rpe: number, opId: string) => {
      const a = (await s.workout.load(sessionId))?.aggregate;
      const r = await s.workout.dispatch(sessionId, { type: 'set_target_rpe', at: h.now(), opId, expectedVersion: a?.session.version ?? 0, scope: { kind: 'exercise', sessionExerciseId: exId }, rpe });
      if (!r.ok) throw new Error(r.error.message);
    };
    await setTarget(10, 'rpe-10');
    const allOut = await log(s, sessionId, s1.id, 6, 'log-1', 10);
    expect(await offerFor(s, allOut, s1.id)).toBeNull();
    await setTarget(8, 'rpe-8');
    const hard = await log(s, sessionId, s2.id, 6, 'log-2', 10);
    const offer = await offerFor(s, hard, s2.id);
    expect(offer).toMatchObject({ by: 'rule', kind: 'rpe_high', fact: 'RPE 10 on set 2 (target 8)', targetRpe: 8, loggedRpe: 10 });
    expect(plain(offer?.change)).toBe('Next set: 57.5 kg × 3–6');
    // Ben's target survives: the remaining set still reads 8 after the rule's change.
    if (offer === null) throw new Error('no offer');
    expect((await s.coach.applyRuleOffer(offer)).status).toBe('applied');
    const left = (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === s3.id);
    expect(left?.planned).toMatchObject({ load: { value: 57.5 }, rpeOverride: 8 });
  });

  it('Ben’s override survives a force-close, and the offer after restart is judged against it', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const [s1, s2] = work;
    if (!s1 || !s2) throw new Error('fixture');
    const a = (await s.workout.load(sessionId))?.aggregate;
    const cmd = { type: 'set_target_rpe' as const, at: h.now(), opId: 'rpe-today', expectedVersion: a?.session.version ?? 0, scope: { kind: 'today' as const }, rpe: 10 };
    const r = await s.workout.dispatch(sessionId, cmd);
    if (!r.ok) throw new Error(r.error.message);
    await h.forceClose();
    const { services: again } = await h.launch();
    const data = await again.workout.load(sessionId);
    if (!data) throw new Error('fixture');
    expect(data.aggregate.sets.filter((x) => x.setType !== 'warmup').every((x) => x.planned.rpeOverride === 10)).toBe(true);
    expect(plain(again.workout.view(data, h.clockMs, null).focus?.target)).toMatch(/@ RPE 10$/);
    // The same op replayed after the restart applies once.
    const dup = await again.workout.dispatch(sessionId, cmd);
    expect(dup.ok && dup.aggregate.session.version).toBe(data.aggregate.session.version);
    const logged = await log(again, sessionId, s1.id, 6, 'log-1', 10);
    expect(await offerFor(again, logged, s1.id)).toBeNull();
  });

  it('Ben’s case: 2 reps against 3–6 with no RPE still offers (built-in target 8.5)', async () => {
    const { s, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    const s1 = work[0];
    if (!s1) throw new Error('fixture');
    const agg = await log(s, sessionId, s1.id, 2, 'log-1');
    expect(await offerFor(s, agg, s1.id)).toMatchObject({ kind: 'reps_short', targetRpe: 8.5, loggedRpe: null });
  });
});

async function plannedLoadsOf(s: S, sessionId: string, ids: string[]) {
  const a = (await s.workout.load(sessionId))?.aggregate;
  return ids.map((id) => a?.sets.find((x) => x.id === id)?.planned.load?.value);
}


describe('review ben-8-decisions: the rule’s reset answer and the coach’s review (B1, S1, S2)', () => {
  /** Two short Bench workouts offline: the Summary of the second offers `Reset to 57.5 kg × 3–6?`. */
  async function stalled() {
    const { s, gymId, sessionId, work } = await bensWorkout();
    connection = NOT_CONNECTED;
    for (const [i, set] of work.entries()) await log(s, sessionId, set.id, 2, `log-${String(i)}`);
    h.clockMs += 60_000;
    const d = await s.workout.load(sessionId);
    const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: 'fin-2', expectedVersion: d?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    h.clockMs += 2 * 86_400_000;
    const third = await s.workout.start({ gymId, opId: 'start-3', checkIn: null, nextOf: sessionId });
    if (!third.ok) throw new Error(third.error.message);
    const work3 = third.aggregate.sets.filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
    for (const [i, set] of work3.entries()) await log(s, third.aggregate.session.id, set.id, 2, `log3-${String(i)}`);
    h.clockMs += 60_000;
    const d3 = await s.workout.load(third.aggregate.session.id);
    const fin3 = await s.workout.dispatch(third.aggregate.session.id, { type: 'finish', at: h.now(), opId: 'fin-3', expectedVersion: d3?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin3.ok) throw new Error(fin3.error.message);
    await h.settle(s);
    const thirdId = third.aggregate.session.id;
    const viewOf = async () => {
      const sum = await s.workout.summary(thirdId, 'not_connected');
      return nextTimeView({ title: 'Workout', builtIn: sum?.nextTime ?? null, coachRows: await s.coach.nextTargets(thirdId), ruleRows: await s.coach.ruleResets(thirdId), availability: await s.coach.availability(), reviewing: false })?.rows.find((r) => r.exerciseName === 'Bench press');
    };
    return { s, gymId, thirdId, viewOf, work3 };
  }

  it('B1: Apply the reset, then the coach’s Summary review runs: the turn completes, Ben’s answer stands for Bench, and the review is recorded (no silent failure)', async () => {
    const { s, gymId, thirdId, viewOf } = await stalled();
    const reset = (await viewOf())?.reset;
    if (reset === undefined) throw new Error('no reset');
    expect(await s.coach.tapRuleReset(thirdId, reset, 'apply')).toEqual({ status: 'written' });
    connection = CONNECTED;
    model = new StepModel([
      (req) => {
        const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
        if (block?.type !== 'message') throw new Error('no context');
        const w = (JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { workout: { sessionId: string; version: number; exercises: { exerciseId: string }[] } }).workout;
        return [{ type: 'tool_call', callId: 'c-t', name: 'set_next_session_targets', arguments: JSON.stringify({ sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Gentler.' }] }) }, { type: 'completed' }];
      },
      () => [{ type: 'tool_call', callId: 'c-r', name: 'reply', arguments: JSON.stringify({ message: 'Your reset stands.', offer: null }) }, { type: 'completed' }],
    ]);
    const turn = await s.coach.runSummaryTurn(thirdId);
    expect(turn).not.toBeNull();
    // Ben's answer wins for Bench: no coach row over it, and next time is his 57.5.
    expect(await s.coach.nextTargets(thirdId)).toEqual([]);
    expect((await s.coach.ruleResets(thirdId)).map((r) => r.status)).toEqual(['applied']);
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).toContain('57.5');
  });

  it('S2: a Skip from a view drawn before Apply landed is refused, never overwriting the Apply', async () => {
    const { s, thirdId, viewOf } = await stalled();
    const reset = (await viewOf())?.reset;
    if (reset === undefined) throw new Error('no reset');
    expect(await s.coach.tapRuleReset(thirdId, reset, 'apply')).toEqual({ status: 'written' });
    // The same (stale) row, no answer on it yet as drawn: Skip.
    expect(await s.coach.tapRuleReset(thirdId, reset, 'not_now')).toEqual({ status: 'not_possible', reason: 'changed_since' });
    expect((await s.coach.ruleResets(thirdId)).map((r) => r.status)).toEqual(['applied']);
  });

  it('S1: an applied reset the workout no longer fits (a set corrected) says so and asks again; Apply again plans it', async () => {
    const { s, gymId, thirdId, viewOf, work3 } = await stalled();
    const reset = (await viewOf())?.reset;
    if (reset === undefined) throw new Error('no reset');
    expect(await s.coach.tapRuleReset(thirdId, reset, 'apply')).toEqual({ status: 'written' });
    const set = (await s.workout.load(thirdId))?.aggregate.sets.find((x) => x.id === work3[0]?.id);
    if (set === undefined) throw new Error('no set');
    const fixed = await s.workout.dispatch(thirdId, { type: 'correct_set', at: h.now(), opId: 'fix-1', setId: set.id, expectedSetVersion: set.version, patch: { reps: 1 } });
    if (!fixed.ok) throw new Error(fixed.error.message);
    await h.settle(s);
    // Not used any more (rule 5), and not silent: `Changed since`, Skip / Apply again.
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).not.toContain('57.5');
    const again = await viewOf();
    expect(plain(again?.note)).toMatch(/^Changed since · Reset to [\d.]+ kg × 3–6\?$/);
    expect(again?.actions).toEqual([{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }]);
    const r2 = again?.reset;
    if (r2 === undefined) throw new Error('no reset');
    expect(await s.coach.tapRuleReset(thirdId, r2, 'apply')).toEqual({ status: 'written' });
    expect(await s.coach.tapRuleReset(thirdId, r2, 'apply')).toEqual({ status: 'replayed' });
    const applied = await viewOf();
    expect(applied?.actions).toEqual([{ label: 'Undo', tap: 'undo' }]);
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).toContain(String(r2.target.load?.value ?? 'none'));
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sessionCheckInForSkip } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { slotView } from '../src/coach/slot-view';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct) The check-in no longer asks on Start: Ben is assumed fine and
 * nothing is recorded. It stays one quiet tap away in the workout until the
 * first working set is logged. A low score with no coach to answer offers the
 * built-in lighter session (one fewer working set per exercise, loads ~10%
 * lighter, snapped), today's pending sets only, Apply / Skip, with Undo.
 * Real SQLite files through the whole app (harness).
 */

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

async function secondWorkout(s: AppServices): Promise<{ gymId: string; agg: SessionAggregate }> {
  const gymId = await setUpGym(h, s);
  const first = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [1, 2, 3].map(() => ({ load: 100, reps: 6, rpe: 8 })) },
    { exercise: 'Lat pulldown', sets: [1, 2, 3].map(() => ({ load: 40, reps: 10, rpe: 8 })) },
  ]);
  h.clockMs += 86_400_000;
  // Start: the gate doesn't ask by default; the session records only that it wasn't asked.
  const gate = await s.checkIns.gate();
  expect(gate).toEqual({ kind: 'skip', reason: 'when_i_choose' });
  if (gate.kind !== 'skip') throw new Error('gate');
  const started = await s.workout.start({ gymId, opId: 'start-2', checkIn: sessionCheckInForSkip(gate.reason), repeatOf: first });
  if (!started.ok) throw new Error(started.error.message);
  return { gymId, agg: started.aggregate };
}

const working = (a: SessionAggregate) => a.sets.filter((x) => x.setType !== 'warmup' && x.status !== 'deleted');

describe('Start goes straight in (Ben, 23 Oct)', () => {
  it('no sheet, no check-in record, `not_asked: when_i_choose`; the workout offers `How are you feeling?`', async () => {
    const { services: s } = await h.launch();
    const { agg } = await secondWorkout(s);
    expect(agg.session.checkIn).toEqual({ kind: 'not_asked', reason: 'when_i_choose' });
    // Nothing invented: no check-in row exists (no Today line, nothing reusable).
    expect(await s.checkIns.unlinked()).toBeNull();
    expect(s.checkIns.offeredIn(agg)).toBe(true);
    // No offer without a check-in.
    expect(await s.coach.checkInOffer(agg, false)).toBeNull();
  });
});

describe('the optional check-in in the workout', () => {
  it('saves and links at the score tap (idempotent per opId); then it goes; a second check-in is refused', async () => {
    const { services: s } = await h.launch();
    const { agg } = await secondWorkout(s);
    const req = { checkInId: h.ids(), opId: 'ci-op-1', score: 2 as const, sessionId: agg.session.id };
    const r = await s.checkIns.recordInWorkout(req);
    if (!r.ok) throw new Error(r.message);
    const again = await s.checkIns.recordInWorkout(req);
    expect(again.ok && again.checkIn.id).toBe(r.checkIn.id);
    const now = (await s.workout.load(agg.session.id))?.aggregate;
    if (!now) throw new Error('load');
    expect(now.session.checkIn).toEqual({ kind: 'answered', checkInId: r.checkIn.id });
    // One version step: the retry replayed.
    expect(now.session.version).toBe(agg.session.version + 1);
    expect(s.checkIns.offeredIn(now)).toBe(false);
    const other = await s.checkIns.recordInWorkout({ checkInId: h.ids(), opId: 'ci-op-2', score: 4, sessionId: agg.session.id });
    expect(other.ok).toBe(false);
    // The summary still shows (and edits) it as before.
    expect((await s.workout.summary(agg.session.id))?.checkIn).toMatchObject({ checkInId: r.checkIn.id, scoreText: '2 of 5' });
  });

  it('is refused once a working set is logged (never mid-workout); a warm-up doesn’t close it', async () => {
    const { services: s } = await h.launch();
    const { agg } = await secondWorkout(s);
    const first = working(agg)[0];
    if (!first) throw new Error('fixture');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(agg.session.id, { type: 'log_set', at: h.now(), opId: 'log-w1', setId: first.id, values: { load: first.planned.load, reps: 6, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    expect(s.checkIns.offeredIn(logged.aggregate)).toBe(false);
    const r = await s.checkIns.recordInWorkout({ checkInId: h.ids(), opId: 'late', score: 2, sessionId: agg.session.id });
    expect(r).toMatchObject({ ok: false, message: 'Check-in closed: a working set is logged.' });
    expect((await s.workout.load(agg.session.id))?.aggregate.session.checkIn).toEqual({ kind: 'not_asked', reason: 'when_i_choose' });
  });
});

describe('the built-in lighter session after a low check-in (no coach)', () => {
  async function lowCheckIn(s: AppServices, score: 1 | 2 | 3 | 4 | 5 = 2) {
    const { agg } = await secondWorkout(s);
    const r = await s.checkIns.recordInWorkout({ checkInId: h.ids(), opId: h.ids(), score, sessionId: agg.session.id });
    if (!r.ok) throw new Error(r.message);
    const now = (await s.workout.load(agg.session.id))?.aggregate;
    if (!now) throw new Error('load');
    return { agg: now, checkIn: r.checkIn };
  }

  it('offers Apply / Skip with its concrete change; Apply: one fewer working set each, lighter achievable loads; Undo restores', async () => {
    const { services: s } = await h.launch();
    const { agg } = await lowCheckIn(s);
    const before = working(agg);
    const offer = await s.coach.checkInOffer(agg, false);
    if (offer === null) throw new Error('no offer');
    expect(offer).toMatchObject({ by: 'rule', prompt: 'Want a lighter session today?', fact: 'You said 2 of 5' });
    expect(offer.change).toMatch(/^2 fewer sets · loads \d+(–\d+)?% lighter$/);
    expect(slotView({ pending: false, adjustment: null, outcome: null, offer: null, checkInOffer: offer })).toMatchObject({ kind: 'check_in_offer', by: 'rule', tag: 'Rule' });
    // With the coach reachable it is the coach's offer instead (no change worked out here).
    expect(await s.coach.checkInOffer(agg, true)).toMatchObject({ by: 'coach', change: null });

    const applied = await s.coach.applyLighterSession(offer);
    if (applied.status !== 'applied') throw new Error(applied.status);
    expect(applied.record).toMatchObject({ author: 'checks', turnId: null });
    // A double tap replays (one opId per check-in).
    expect((await s.coach.applyLighterSession(offer)).status).toBe('applied');
    const after = (await s.workout.load(agg.session.id))?.aggregate;
    if (!after) throw new Error('load');
    expect(after.session.version).toBe(agg.session.version + 1);
    for (const ex of after.exercises) {
      const was = before.filter((x) => x.sessionExerciseId === ex.id);
      const now = working(after).filter((x) => x.sessionExerciseId === ex.id);
      expect(now.length).toBe(Math.max(1, was.length - 1));
      for (const x of now) {
        const old = was.find((w) => w.id === x.id)?.planned.load?.value ?? 0;
        expect(x.planned.load?.value ?? 0).toBeLessThan(old);
        expect(x.planned.load?.value ?? 0).toBeGreaterThanOrEqual(old * 0.8);
        expect(x.planned.source).toBe('built_in_rule');
      }
    }
    // Answered: never offered again for this check-in (also after Undo).
    expect(await s.coach.checkInOffer(after, false)).toBeNull();
    const undone = await s.coach.undo(applied.record.actionId, `undo:${applied.record.actionId}`);
    expect(undone.result.status).toBe('written');
    const back = (await s.workout.load(agg.session.id))?.aggregate;
    if (!back) throw new Error('load');
    expect(working(back).map((x) => [x.id, x.planned.load?.value])).toEqual(before.map((x) => [x.id, x.planned.load?.value]));
    expect(await s.coach.checkInOffer(back, false)).toBeNull();
  });

  it('never touches logged sets; a stale offer (workout moved on) applies nothing', async () => {
    const { services: s } = await h.launch();
    const { agg } = await lowCheckIn(s, 1);
    const offer = await s.coach.checkInOffer(agg, false);
    if (offer === null) throw new Error('no offer');
    const first = working(agg)[0];
    if (!first) throw new Error('fixture');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(agg.session.id, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first.id, values: { load: first.planned.load, reps: 6, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    expect(await s.coach.applyLighterSession(offer)).toEqual({ status: 'stale' });
    expect(await s.coach.checkInOffer(logged.aggregate, false)).toBeNull();
    const after = (await s.workout.load(agg.session.id))?.aggregate;
    expect(after?.session.version).toBe(logged.aggregate.session.version);
    expect(after?.sets.find((x) => x.id === first.id)?.actual?.load).toEqual(first.planned.load);
  });

  it('no offer for 4 or 5; Skip is remembered across a force-close and relaunch', async () => {
    const launched = await h.launch();
    const { agg } = await lowCheckIn(launched.services, 4);
    expect(await launched.services.coach.checkInOffer(agg, false)).toBeNull();
    await h.forceClose();

    h = createHarness();
    const { services: s } = await h.launch();
    const low = await lowCheckIn(s, 2);
    const offer = await s.coach.checkInOffer(low.agg, false);
    if (offer === null) throw new Error('no offer');
    await s.coach.answerCheckInOffer(offer);
    await h.forceClose();
    const { services: again } = await h.launch();
    const restored = (await again.workout.load(low.agg.session.id))?.aggregate;
    if (!restored) throw new Error('restore');
    expect(restored.session.checkIn).toEqual({ kind: 'answered', checkInId: low.checkIn.id });
    expect(await again.coach.checkInOffer(restored, false)).toBeNull();
    // Skip changed nothing.
    expect(working(restored).map((x) => x.planned.load?.value)).toEqual(working(low.agg).map((x) => x.planned.load?.value));
  });
});

describe('Skip workout from the workout’s check-in (ill step)', () => {
  it('discards the still-empty workout; refused once anything is logged', async () => {
    const { services: s } = await h.launch();
    const { agg } = await secondWorkout(s);
    expect(await s.checkIns.canSkipWorkout(agg.session.id)).toBe(true);
    const first = agg.sets[0];
    if (!first) throw new Error('fixture');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(agg.session.id, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first.id, values: { load: first.planned.load, reps: 6, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    expect(await s.checkIns.canSkipWorkout(agg.session.id)).toBe(false);
    expect((await s.checkIns.skipWorkoutFrom({ sessionId: agg.session.id, opId: 'skip-1' })).ok).toBe(false);
  });

  it('with nothing logged, Skip workout discards it', async () => {
    const { services: s } = await h.launch();
    const { agg } = await secondWorkout(s);
    expect(await s.checkIns.skipWorkoutFrom({ sessionId: agg.session.id, opId: 'skip-2' })).toEqual({ ok: true });
    expect((await s.workout.load(agg.session.id))?.aggregate.session.status).toBe('discarded');
  });
});

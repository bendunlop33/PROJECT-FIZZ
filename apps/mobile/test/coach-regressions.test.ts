import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nextTargetTapOpId, renderActionResult, undoOpId, type CoachModelPort, type ModelEvent, type ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import { nextTimeView } from '../src/coach/next-time-view';
import { threadRows } from '../src/coach/sheet-view';
import { slotAfterTurn, slotView, syncAdjustment } from '../src/coach/slot-view';
import { CONNECTED, contextWorkout, lowerPending, replyWith, saveNextTarget, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** Coach bugs found by the independent check (rule 3, honesty, Undo), each reproduced on real SQLite. */

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

type Services = Awaited<ReturnType<Harness['launch']>>['services'];

/** A routine whose last workout got the coach's next-time target, then a new workout started from it (coach-sourced sets). */
async function coachPlannedWorkout(s: Services, gymId: string) {
  const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }] }]);
  const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: `save-${first}` });
  if (!saved.ok) throw new Error(saved.message);
  model = new StepModel([saveNextTarget(), () => replyWith('Ok.')]);
  await s.coach.runSummaryTurn(first);
  h.clockMs += 2 * 86_400_000;
  const started = await s.workout.start({ gymId, opId: 'start-coach', checkIn: null, routineOf: saved.routine.id });
  if (!started.ok) throw new Error(started.error.message);
  const work = started.aggregate.sets.filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
  return { first, routineId: saved.routine.id, sessionId: started.aggregate.session.id, work };
}

describe('CA4 with coach-sourced targets (rule 3)', () => {
  it('RPE 10 on sets 1 and 2 of coach-planned sets offers once; a real adjustment after the offer allows exactly one more', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { sessionId, work } = await coachPlannedWorkout(s, gymId);
    expect(work.every((x) => x.planned.source === 'coach')).toBe(true);
    expect(work.length).toBeGreaterThanOrEqual(4);
    const logHard = async (i: number) => {
      const set = (await s.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === work[i]?.id);
      if (!set) throw new Error('fixture');
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `hard-${String(i)}`, setId: set.id, values: { load: set.planned.load, reps: 8, durationS: null, rpe: 10, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
      return (await s.coach.offerAfterLog({ aggregate: r.aggregate, setId: set.id, resting: true, coachReachable: true, pending: false }))?.fact ?? null;
    };
    expect(await logHard(0)).toBe('RPE 10 on set 1');
    expect(await logHard(1)).toBeNull();
    // Ben accepts an adjustment: one more offer may follow, then none.
    model = new StepModel([lowerPending(), () => replyWith('Lighter.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'chip', chip: 'too_hard' }, turnId: h.ids() });
    expect(r.cards.some((c) => c.record.detail.kind === 'adjust_pending_sets' && c.record.status === 'committed')).toBe(true);
    expect(await logHard(2)).toBe('RPE 10 on set 3');
    expect(await logHard(3)).toBeNull();
  });
});

describe('Offline recovers by itself; the summary review isn’t skipped for an earlier failure', () => {
  it('after one network failure, the review still calls the model, and once the network is back the status is ok again', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    const failed = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Hi', spoken: false }, turnId: h.ids() });
    expect(failed.error).toBe('network');
    expect((await s.coach.availability()).status).toBe('offline');
    // Signal back: the next request isn't refused for the old failure.
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }] }]);
    model = new StepModel([saveNextTarget(), () => replyWith('Ok.')]);
    const review = await s.coach.runSummaryTurn(first);
    expect(model.requests).toHaveLength(2);
    expect(review?.status).toBe('completed');
    expect((await s.coach.availability()).status).toBe('ok');
  });

  it('Offline clears by itself after a short while, with no request needed', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Hi', spoken: false }, turnId: h.ids() });
    expect((await s.coach.availability()).status).toBe('offline');
    h.clockMs += 2 * 60_000;
    expect((await s.coach.availability()).status).toBe('ok');
  });

  it('a review skipped while not connected isn’t cached: it runs once the coach is back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }] }]);
    connection = { status: 'not_connected', route: null, email: null, model: null };
    expect(await s.coach.runSummaryTurn(first)).toBeNull();
    expect(s.coach.summaryRunning(first)).toBeNull();
    connection = CONNECTED;
    model = new StepModel([saveNextTarget(), () => replyWith('Ok.')]);
    expect((await s.coach.runSummaryTurn(first))?.status).toBe('completed');
  });
});

describe('A name or time edit on the Summary keeps the coach’s next-time targets (D21, CA10)', () => {
  async function reviewed(s: Services, gymId: string) {
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }] }]);
    model = new StepModel([saveNextTarget(), () => replyWith('Ok.')]);
    return first;
  }
  const rename = async (s: Services, sessionId: string, name: string) => {
    const v = (await s.workout.load(sessionId))?.aggregate.session.version ?? 0;
    const r = await s.workout.dispatch(sessionId, { type: 'rename_session', at: h.now(), opId: h.ids(), name, expectedVersion: v });
    if (!r.ok) throw new Error(r.error.message);
  };
  const startFrom = async (s: Services, gymId: string, first: string) => {
    h.clockMs += 86_400_000;
    const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: null, nextOf: first });
    if (!started.ok) throw new Error(started.error.message);
    return started.aggregate.sets.filter((x) => x.setType !== 'warmup');
  };

  it('rename after the targets are saved: the next workout still uses them', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await reviewed(s, gymId);
    await s.coach.runSummaryTurn(first);
    await rename(s, first, 'Chest day');
    const work = await startFrom(s, gymId, first);
    expect(work.every((x) => x.planned.source === 'coach' && x.planned.load?.value === 57.5)).toBe(true);
  });

  it('rename while the review is running: its targets are still saved and used', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await reviewed(s, gymId);
    let open = (): void => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const inner = model;
    model = new (class implements CoachModelPort {
      async *stream(req: ModelRequest): AsyncIterable<ModelEvent> {
        await gate;
        yield* inner.stream(req);
      }
    })() as unknown as StepModel;
    const run = s.coach.runSummaryTurn(first);
    await new Promise((r) => setTimeout(r, 50));
    await rename(s, first, 'Chest day');
    open();
    await run;
    expect((await s.coach.nextTargets(first))[0]).toMatchObject({ status: 'saved' });
    const work = await startFrom(s, gymId, first);
    expect(work.every((x) => x.planned.source === 'coach' && x.planned.load?.value === 57.5)).toBe(true);
  });

  it('a corrected set does make them stale, and the Summary then shows the built-in rule, not the coach target', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await reviewed(s, gymId);
    await s.coach.runSummaryTurn(first);
    const set = (await s.workout.load(first))?.aggregate.sets.find((x) => x.status === 'completed');
    if (!set) throw new Error('fixture');
    const fixed = await s.workout.dispatch(first, { type: 'correct_set', at: h.now(), opId: h.ids(), setId: set.id, expectedSetVersion: set.version, patch: { reps: 5 } });
    if (!fixed.ok) throw new Error(fixed.error.message);
    const summary = await s.workout.summary(first, 'connected');
    const view = nextTimeView({ title: 'Workout', builtIn: summary?.nextTime ?? null, coachRows: await s.coach.nextTargets(first), stale: await s.coach.staleNextTargets(first), availability: await s.coach.availability(), reviewing: false });
    expect(view?.rows.find((r) => r.exerciseName === 'Bench press')).toMatchObject({ tag: 'Rule', actions: [] });
    expect(view?.undoAll).toBeNull();
    const work = await startFrom(s, gymId, first);
    expect(work.some((x) => x.planned.source === 'coach')).toBe(false);
  });
});

describe('Try again retries its own turn, also after a relaunch', () => {
  it('each failed turn’s row carries that turn’s own words: A fails, B succeeds, A’s Try again is A', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    model = new StepModel([() => [{ type: 'error', error: 'timeout' }], () => replyWith('Two minutes.')]);
    const a = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Message A', spoken: false }, turnId: h.ids() });
    await s.coach.send({ entry: { kind: 'today' }, threadId: a.threadId, input: { kind: 'words', text: 'Message B', spoken: false }, turnId: h.ids() });
    await h.forceClose();
    const { services: again } = await h.launch();
    const data = await again.coach.loadThread(a.threadId);
    if (data === null) throw new Error('no thread');
    const outcomes = threadRows(data).filter((r) => r.kind === 'outcome');
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ retry: true, input: { kind: 'words', text: 'Message A' } });
  });

  it('a summary review cut off by a force-close runs again when asked (its Try again), not skipped', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }] }]);
    model = new (class extends StepModel {
      override stream(request: ModelRequest): AsyncIterable<ModelEvent> {
        this.requests.push(request);
        return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<ModelEvent>>(() => undefined) }) };
      }
    })([]);
    void s.coach.runSummaryTurn(first).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    await h.forceClose();
    const { services: again } = await h.launch();
    const threadId = await again.coach.resolveThread({ kind: 'summary', sessionId: first });
    const data = threadId === null ? null : await again.coach.loadThread(threadId);
    if (data === null) throw new Error('no thread');
    expect(threadRows(data).find((r) => r.kind === 'outcome')).toMatchObject({ text: 'Interrupted. Nothing changed.', retry: true, input: { kind: 'summary' } });
    model = new StepModel([saveNextTarget(), () => replyWith('All sets were RPE 10.')]);
    expect((await again.coach.runSummaryTurn(first))?.status).toBe('completed');
    expect(await again.coach.summaryNote(first)).toBe('All sets were RPE 10.');
    // Once it has completed, it isn't run again.
    const calls = model.requests.length;
    await h.forceClose();
    const { services: third } = await h.launch();
    expect(await third.coach.runSummaryTurn(first)).toBeNull();
    expect(model.requests.length).toBe(calls);
  });
});

describe('A double-tapped Undo undoes once and reports success both times', () => {
  it('the workout banner / sheet card: the second tap replays the first, with the same line', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    h.clockMs += 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'start-dbl', checkIn: null, nextOf: first });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    model = new StepModel([lowerPending(), () => replyWith('Lighter.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'chip', chip: 'too_hard' }, turnId: h.ids() });
    const actionId = r.cards.find((c) => c.record.detail.kind === 'adjust_pending_sets')?.record.actionId ?? '';
    const [a, b] = await Promise.all([s.coach.undo(actionId, undoOpId(actionId)), s.coach.undo(actionId, undoOpId(actionId))]);
    expect([a.result.status, b.result.status].sort()).toEqual(['replayed', 'written']);
    expect(renderActionResult(b.undo, 'slot').text).toBe(renderActionResult(a.undo, 'slot').text);
    expect(renderActionResult(b.undo, 'slot').text).not.toMatch(/Couldn/);
  });

  it('a Next time row: the second Undo tap replays, no “Changed since”', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }] }]);
    model = new StepModel([saveNextTarget(), () => replyWith('Ok.')]);
    await s.coach.runSummaryTurn(first);
    const [row] = await s.coach.nextTargets(first);
    if (!row) throw new Error('no row');
    const [a, b] = await Promise.all([s.coach.tapNextTarget(row, 'undo', nextTargetTapOpId(row, 'undo')), s.coach.tapNextTarget(row, 'undo', nextTargetTapOpId(row, 'undo'))]);
    expect([a.status, b.status].sort()).toEqual(['replayed', 'written']);
    // A later tap on the row as it is now is a new intent.
    const [now] = await s.coach.nextTargets(first);
    if (!now) throw new Error('no row');
    expect(nextTargetTapOpId(now, 'use_coach')).not.toBe(nextTargetTapOpId(row, 'use_coach'));
    expect(await s.coach.tapNextTarget(now, 'use_coach', nextTargetTapOpId(now, 'use_coach'))).toMatchObject({ status: 'written', row: { status: 'saved' } });
  });
});

describe('The workout banner follows an Undo made in the sheet', () => {
  it('after the sheet’s Undo, the banner’s record is read again: `Coach change undone.`, no live Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    h.clockMs += 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'start-banner', checkIn: null, nextOf: first });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    model = new StepModel([lowerPending(), () => replyWith('Lighter.')]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'chip', chip: 'too_hard' }, turnId: h.ids() });
    const cached = slotAfterTurn(r).adjustment;
    if (cached === null) throw new Error('no adjustment');
    // The sheet's card Undo.
    expect((await s.coach.undo(cached.actionId, undoOpId(cached.actionId))).result.status).toBe('written');
    // Back to the workout: the reloaded workout and the banner's record read again.
    const workout = (await s.workout.load(sessionId))?.aggregate ?? null;
    const fresh = await syncAdjustment(cached, (id) => s.coach.getAction(id));
    expect(slotView({ pending: false, adjustment: fresh, outcome: null, offer: null, workout })).toEqual({ kind: 'outcome', text: 'Coach change undone.', retry: false });
    // Still live: the same record back.
    expect(await syncAdjustment(null, (id) => s.coach.getAction(id))).toBeNull();
  });
});

describe('Undo all on the Summary works every time it is shown', () => {
  it('Undo all → Use coach target on both → Undo all again undoes both rows', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 50, reps: 10, rpe: 10 }] },
    ]);
    model = new StepModel([
      (req) => {
        const w = contextWorkout(req);
        const t = (i: number, value: number, convention: string) => ({ exerciseId: w.exercises[i]?.exerciseId, target: { load: { value, unit: 'kg', convention }, reps: null }, sets: null, reason: 'Heavy.' });
        return toolCall('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [t(0, 57.5, 'total'), t(1, 47.5, 'stack')] });
      },
      () => replyWith('Ok.'),
    ]);
    await s.coach.runSummaryTurn(first);
    const summary = await s.workout.summary(first, 'connected');
    const view = async () => nextTimeView({ title: 'Workout', builtIn: summary?.nextTime ?? null, coachRows: await s.coach.nextTargets(first), availability: await s.coach.availability(), reviewing: false });
    const before = await view();
    expect(before?.undoAll?.rows).toHaveLength(2);
    expect(await s.coach.undoNextTargets(before?.undoAll?.rows ?? [])).toEqual({ ok: true });
    expect((await s.coach.nextTargets(first)).map((r) => r.status)).toEqual(['undone', 'undone']);
    for (const r of await s.coach.nextTargets(first)) expect((await s.coach.tapNextTarget(r, 'use_coach', nextTargetTapOpId(r, 'use_coach'))).status).toBe('written');
    const again = await view();
    expect(again?.undoAll?.rows).toHaveLength(2);
    expect(await s.coach.undoNextTargets(again?.undoAll?.rows ?? [])).toEqual({ ok: true });
    expect((await s.coach.nextTargets(first)).map((r) => r.status)).toEqual(['undone', 'undone']);
  });
});

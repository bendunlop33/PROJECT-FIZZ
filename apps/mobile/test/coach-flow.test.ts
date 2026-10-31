import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import { NBSP } from '@fizz/domain';
import type { TextCoachState } from '@fizz/providers';

import type { CoachEntry } from '../src/coach/coach-service';
import { nextTimeView } from '../src/coach/next-time-view';
import { statusView, threadRows } from '../src/coach/sheet-view';
import { slotAfterTurn, slotView } from '../src/coach/slot-view';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Coach C6–C8 through the app services on real SQLite, with a scripted
 * model in place of the plan route. Nothing here proves the route on the
 * iPhone (spike S3); it proves what the app does with each answer.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

/** A model whose each step is computed from the request (so it can name real set IDs and versions). */
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

function yourData(req: ModelRequest): { workout: { sessionId: string; version: number; exercises: { sessionExerciseId: string; exerciseId: string; name: string; sets: { setId: string; status: string; target: { load: { value: number; unit: string; convention: string } | null; reps: { min: number; max: number } | null } }[] }[] } } {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as ReturnType<typeof yourData>;
}

const call = (name: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: `c-${name}`, name, arguments: JSON.stringify(args) }, { type: 'completed' }];
const reply = (message: string): ModelEvent[] => call('reply', { message, offer: null });

const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };

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

describe('C6: the sheet’s thread, status and honesty', () => {
  it('a question gets an answer; the thread reads back Ben’s words and the coach’s checked sentences; a phantom change is dropped', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    model = new StepModel([() => reply('Rest 2–3 minutes on bench. I’ve lowered your squat to 80 kg.')]);
    expect(await s.coach.resolveThread({ kind: 'today' })).toBeNull();
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'How long should I rest?', spoken: false }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    const data = await s.coach.loadThread(r.threadId);
    if (data === null) throw new Error('no thread');
    const rows = threadRows(data);
    expect(rows.map((x) => x.kind)).toEqual(['ben', 'coach', 'note']);
    expect(rows[1]).toMatchObject({ kind: 'coach', sentences: ['Rest 2–3 minutes on bench.'] });
    // CS1: reopening within 6 hours finds the same general thread.
    expect(await s.coach.resolveThread({ kind: 'today' })).toBe(r.threadId);
    h.clockMs += 7 * 60 * 60 * 1000;
    expect(await s.coach.resolveThread({ kind: 'today' })).toBeNull();
  });

  it('honest states: not connected says so in one or two words and blocks Send; after a network failure it reads Offline', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    connection = { status: 'not_connected', route: null, email: null, model: null };
    expect(statusView(await s.coach.availability())).toMatchObject({ word: 'Not connected', canSend: false, action: { label: 'Connect' } });
    await expect(s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Hi', spoken: false }, turnId: h.ids() })).rejects.toThrow();
    connection = CONNECTED;
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Hi', spoken: false }, turnId: h.ids() });
    expect(r).toMatchObject({ status: 'failed', error: 'network', items: [] });
    expect(statusView(await s.coach.availability()).word).toBe('Offline');
    const rows = threadRows((await s.coach.loadThread(r.threadId)) ?? (() => { throw new Error('x'); })());
    // Ben's message was saved before the request; no coach words were made up.
    expect(rows.map((x) => x.kind)).toEqual(['ben', 'outcome']);
    expect(rows[1]).toMatchObject({ text: 'Offline. Nothing changed.', retry: true });
  });
});

describe('C7: in the workout (offer, Adjust, banner, Undo)', () => {
  async function secondWorkout() {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] }]);
    h.clockMs += 2 * 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'start-2', checkIn: null, nextOf: first });
    if (!started.ok) throw new Error(started.error.message);
    return { s, sessionId: started.aggregate.session.id, first };
  }

  it('RPE 10 on set 1 offers once (no AI call); Adjust → too hard; the slot banner comes from the saved change; Undo restores the plan', async () => {
    const { s, sessionId } = await secondWorkout();
    let data = await s.workout.load(sessionId);
    const sets = (data?.aggregate.sets ?? []).filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
    const [s1, s2, s3] = sets;
    if (!s1 || !s2 || !s3) throw new Error('fixture');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: s1.id, values: { load: s1.planned.load, reps: 8, durationS: null, rpe: 10, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const offer = await s.coach.offerAfterLog({ aggregate: logged.aggregate, setId: s1.id, resting: true, coachReachable: true, pending: false });
    expect(offer).toMatchObject({ kind: 'rpe_high', fact: 'RIR 0 on set 1 (target RIR 1.5)', prompt: 'That looked hard. Adjust remaining sets?' });
    expect(model.requests).toEqual([]);
    // CA4: the same kind on the same exercise doesn't come back.
    expect(await s.coach.offerAfterLog({ aggregate: logged.aggregate, setId: s1.id, resting: true, coachReachable: true, pending: false })).toBeNull();
    // Offline: no offers at all.
    expect(await s.coach.offerAfterLog({ aggregate: logged.aggregate, setId: s1.id, resting: true, coachReachable: false, pending: false })).toBeNull();
    expect(slotView({ pending: false, adjustment: null, outcome: null, offer })).toMatchObject({ kind: 'offer', fact: 'RIR 0 on set 1 (target RIR 1.5)' });

    model = new StepModel([
      (req) => {
        const w = yourData(req).workout;
        const ex = w.exercises[0];
        const pending = ex?.sets.filter((x) => x.status === 'pending') ?? [];
        const lighter = { value: (pending[0]?.target.load?.value ?? 60) - 2.5, unit: 'kg', convention: 'total' };
        return call('edit_today', { baseVersion: w.version, ops: pending.map((x) => ({ op: 'set', setId: x.setId, target: { load: lighter, reps: null } })), reason: 'Set 1 was RPE 10.' });
      },
      () => reply('A little lighter should keep you at 8.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'chip', chip: 'too_hard' }, turnId: h.ids() });
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('edit_today');
    const after = slotAfterTurn(r);
    const banner = slotView({ pending: false, adjustment: after.adjustment, outcome: after.outcome, offer: null });
    expect(banner).toMatchObject({ kind: 'banner', canUndo: true });
    if (banner?.kind !== 'banner') throw new Error('no banner');
    expect(plain(banner.title)).toBe('Coach adjusted sets 2–3');
    data = await s.workout.load(sessionId);
    const view = data === null ? null : s.workout.view(data, h.clockMs, null);
    expect(plain(view?.focus?.target)).toMatch(/^Coach target /);
    expect(plain(view?.focus?.planWas)).toMatch(/^Plan was /);
    // The done set is untouched.
    expect(data?.aggregate.sets.find((x) => x.id === s1.id)?.actual).toMatchObject({ rpe: 10, reps: 8 });

    const u = await s.coach.undo(banner.actionId, 'undo-1');
    expect(u.result.status).toBe('written');
    const back = await s.workout.load(sessionId);
    expect(back?.aggregate.sets.find((x) => x.id === s2.id)?.planned).toEqual(s2.planned);
    expect(back?.aggregate.sets.find((x) => x.id === s3.id)?.planned.source).toBe(s3.planned.source);
  });

  async function twoExerciseWorkout() {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] },
    ]);
    h.clockMs += 2 * 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'start-two', checkIn: null, nextOf: first });
    if (!started.ok) throw new Error(started.error.message);
    const a = started.aggregate;
    const rowOf = (name: string) => a.exercises.find((e) => e.exerciseName === name);
    const bench = rowOf('Bench press');
    const pulldown = rowOf('Lat pulldown');
    if (!bench || !pulldown) throw new Error('fixture');
    const setsOf = (rowId: string) => a.sets.filter((x) => x.sessionExerciseId === rowId && x.setType !== 'warmup').sort((x, y) => x.index - y.index);
    return { s, sessionId: a.session.id, bench, pulldown, benchSets: setsOf(bench.id), pulldownSets: setsOf(pulldown.id) };
  }

  it('in a workout, Pain flags the movement Ben named, not the one in focus; the focus row only when nothing is named (review r2 S1, r3 S1/S2)', async () => {
    const { s, sessionId, bench, pulldown } = await twoExerciseWorkout();
    const entry = { kind: 'workout' as const, sessionId };
    const focus = { exerciseId: pulldown.exerciseId, name: 'Lat pulldown' };
    // Named in full: that movement, flagged at once.
    expect(await s.coach.painChoices(entry, 'bench press earlier hurt my shoulder, go lighter', focus)).toEqual({ choices: [{ exerciseId: bench.exerciseId, name: 'Bench press' }], pick: false });
    // A short name: that movement and the one in focus, to pick from (never Lat pulldown alone).
    expect(await s.coach.painChoices(entry, 'bench earlier hurt my shoulder, go lighter', focus)).toEqual({ choices: [{ exerciseId: bench.exerciseId, name: 'Bench press' }, focus], pick: true });
    expect((await s.coach.painChoices(entry, 'bench press and lat pulldown both hurt', focus)).choices.map((c) => c.name)).toEqual(['Bench press', 'Lat pulldown']);
    // r3 S1: a movement Ben clears isn't the one flagged.
    expect(await s.coach.painChoices(entry, 'bench press felt fine but my shoulder hurts on pulldowns', focus)).toEqual({ choices: [focus], pick: true });
    // r3 S2: a body part alone: chips, the one in focus first.
    expect(await s.coach.painChoices(entry, 'my elbow hurts', focus)).toEqual({ choices: [focus, { exerciseId: bench.exerciseId, name: 'Bench press' }], pick: true });
    // Nothing named at all: the one in focus.
    expect(await s.coach.painChoices(entry, 'ow, that hurt', focus)).toEqual({ choices: [focus], pick: false });
    expect(await s.coach.painChoices(entry, null, focus)).toEqual({ choices: [focus], pick: false });
  });

  it('no offer for an exercise with no pending set left, even with another exercise still to do (review S1)', async () => {
    const { s, sessionId, benchSets, pulldownSets } = await twoExerciseWorkout();
    expect(pulldownSets.every((x) => x.status === 'pending')).toBe(true);
    let latest = null as Awaited<ReturnType<typeof s.workout.dispatch>> | null;
    for (const [i, set] of benchSets.entries()) {
      h.clockMs += 60_000;
      latest = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `b-${String(i)}`, setId: set.id, values: { load: set.planned.load, reps: 8, durationS: null, rpe: i === benchSets.length - 1 ? 10 : 8, rir: null }, restTimerId: h.ids() });
      if (!latest.ok) throw new Error(latest.error.message);
    }
    if (!latest?.ok) throw new Error('not logged');
    expect(await s.coach.offerAfterLog({ aggregate: latest.aggregate, setId: benchSets.at(-1)?.id ?? '', resting: true, coachReachable: true, pending: false })).toBeNull();
  });

  it('accepting an offer about bench can only change bench: a pulldown change is refused (review S1)', async () => {
    const { s, sessionId, bench, pulldown, benchSets, pulldownSets } = await twoExerciseWorkout();
    const [b1] = benchSets;
    if (!b1) throw new Error('fixture');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'b-rpe10', setId: b1.id, values: { load: b1.planned.load, reps: 8, durationS: null, rpe: 10, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const offer = await s.coach.offerAfterLog({ aggregate: logged.aggregate, setId: b1.id, resting: true, coachReachable: true, pending: false });
    expect(offer?.sessionExerciseId).toBe(bench.id);
    model = new StepModel([
      (req) => {
        const w = yourData(req).workout;
        const pd = w.exercises.find((e) => e.sessionExerciseId === pulldown.id);
        const pending = pd?.sets.filter((x) => x.status === 'pending') ?? [];
        return call('edit_today', { baseVersion: w.version, ops: pending.map((x) => ({ op: 'set', setId: x.setId, target: { load: { value: 45, unit: 'kg', convention: 'stack' }, reps: null } })), reason: 'Lighter.' });
      },
      () => reply('Ok.'),
    ]);
    const r = await s.coach.send({ entry: { kind: 'workout', sessionId }, threadId: null, input: { kind: 'chip', chip: 'too_hard', sessionExerciseId: offer?.sessionExerciseId ?? '' }, turnId: h.ids() });
    expect(r.status).toBe('completed');
    const thread = await s.coach.loadThread(r.threadId);
    const records = thread?.actionsByTurn.get(r.turnId) ?? [];
    expect(records.map((x) => [x.status, x.failure])).toEqual([['rejected', 'only Bench press']]);
    const after = await s.workout.load(sessionId);
    for (const x of pulldownSets) expect(after?.aggregate.sets.find((y) => y.id === x.id)?.planned).toEqual(x.planned);
  });

  it('two quick logs checked at once show the offer once (CA4, review r2 N3)', async () => {
    const { s, sessionId } = await secondWorkout();
    const data = await s.workout.load(sessionId);
    const [s1] = (data?.aggregate.sets ?? []).filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
    if (!s1) throw new Error('fixture');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-n3', setId: s1.id, values: { load: s1.planned.load, reps: 8, durationS: null, rpe: 10, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const input = { aggregate: logged.aggregate, setId: s1.id, resting: true, coachReachable: true, pending: false };
    const both = await Promise.all([s.coach.offerAfterLog(input), s.coach.offerAfterLog(input)]);
    expect(both.filter((o) => o !== null)).toHaveLength(1);
  });

  it('an offer shown before a force-close doesn’t come back after the relaunch (CA4, review S6)', async () => {
    const { s, sessionId } = await secondWorkout();
    const data = await s.workout.load(sessionId);
    const [s1] = (data?.aggregate.sets ?? []).filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
    if (!s1) throw new Error('fixture');
    h.clockMs += 60_000;
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-s6', setId: s1.id, values: { load: s1.planned.load, reps: 8, durationS: null, rpe: 10, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    expect(await s.coach.offerAfterLog({ aggregate: logged.aggregate, setId: s1.id, resting: true, coachReachable: true, pending: false })).not.toBeNull();
    await h.forceClose();
    const { services: again } = await h.launch();
    expect(await again.coach.offerAfterLog({ aggregate: logged.aggregate, setId: s1.id, resting: true, coachReachable: true, pending: false })).toBeNull();
  });

  it('logging 10 normal sets makes no AI call and no offer', async () => {
    const { s, sessionId } = await secondWorkout();
    let data = await s.workout.load(sessionId);
    for (let i = 0; i < 10; i += 1) {
      const pending = data?.aggregate.sets.find((x) => x.status === 'pending');
      if (pending === undefined) {
        const ex = data?.aggregate.exercises[0];
        if (!ex) break;
        const added = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: ex.id, newSetId: h.ids(), setType: null });
        if (!added.ok) throw new Error(added.error.message);
        data = data === null ? null : { ...data, aggregate: added.aggregate };
        i -= 1;
        continue;
      }
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `n-${String(i)}`, setId: pending.id, values: { load: pending.planned.load, reps: pending.planned.reps?.max ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
      expect(await s.coach.offerAfterLog({ aggregate: r.aggregate, setId: pending.id, resting: true, coachReachable: true, pending: false })).toBeNull();
      data = data === null ? null : { ...data, aggregate: r.aggregate };
    }
    expect(model.requests).toEqual([]);
  });
});

describe('Pain from Adjust or the sheet: deterministic, offline, one flag', () => {
  it('a repeated opId flags once; an active flag on the movement is kept, not duplicated; no AI call', async () => {
    const { services: s } = await h.launch();
    connection = { status: 'not_connected', route: null, email: null, model: null };
    const req = { exerciseId: '00000000-0000-4000-8000-00000000b001', exerciseName: 'Bench press', opId: 'pain-op-1' };
    await setUpGym(h, s);
    const a = await s.pain.flagMovement(req);
    const b = await s.pain.flagMovement(req);
    expect(a.ok && a.flags).toHaveLength(1);
    // The same tap again finds its own flag: Undo can still take it back.
    expect(b).toEqual(a);
    if (!a.ok) throw new Error('not flagged');
    expect(await s.pain.flagMovement({ ...req, opId: 'pain-op-2' })).toEqual({ ok: true, flags: [] });
    expect((await s.pain.active()).filter((f) => f.exerciseId === req.exerciseId)).toHaveLength(1);
    // Undo retracts it (not a clear); flagging again later is a new flag.
    expect(await s.pain.retract(a.flags, 'undo-1')).toEqual({ ok: true, stale: [] });
    expect((await s.pain.active()).some((f) => f.exerciseId === req.exerciseId)).toBe(false);
    expect((await s.pain.flagMovement({ ...req, opId: 'pain-op-3' })).ok).toBe(true);
    expect(model.requests).toHaveLength(0);
  });
});

describe('Sore or pain? outside a workout (review S5)', () => {
  it('Today: the named movement, else the last workout’s movements to choose from; nothing to flag before any workout', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    expect(await s.coach.painChoices({ kind: 'today' }, 'my shoulder hurts')).toEqual({ choices: [], pick: false });
    const done = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] },
      { exercise: 'Lat pulldown', sets: [{ load: 50, reps: 10 }] },
    ]);
    const names = async (words: string | null, entry: CoachEntry = { kind: 'today' }) => {
      const r = await s.coach.painChoices(entry, words);
      return { names: r.choices.map((c) => c.name), pick: r.pick };
    };
    expect(await names('my shoulder hurts')).toEqual({ names: ['Bench press', 'Lat pulldown'], pick: true });
    expect(await names('shoulder hurts on bench press')).toEqual({ names: ['Bench press'], pick: false });
    // A short name is offered to pick, never flagged on a guess.
    expect(await names('bench hurt my shoulder')).toEqual({ names: ['Bench press'], pick: true });
    expect(await names(null, { kind: 'summary', sessionId: done })).toEqual({ names: ['Bench press', 'Lat pulldown'], pick: true });
  });
});

describe('C8: Summary next-session targets (D21) and routines', () => {
  it('one summary turn saves a small bench change; Next time shows it with Undo; the next session of the routine plans it and marks it used', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }, { load: 60, reps: 6, rpe: 10 }] }]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1' , addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    model = new StepModel([
      (req) => {
        const w = yourData(req).workout;
        const ex = w.exercises[0];
        return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: ex?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Every set was RPE 10.' }] });
      },
      () => reply('All three sets were RPE 10.'),
    ]);
    const turn = await s.coach.runSummaryTurn(first);
    // Once per workout, even if asked again.
    expect(await s.coach.runSummaryTurn(first)).toBe(turn);
    expect(turn?.status).toBe('completed');
    // The Summary's coach note is the turn's checked reply, read back from the thread.
    expect(await s.coach.summaryNote(first)).toBe('All three sets were RPE 10.');
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('set_next_session_targets');
    const summary = await s.workout.summary(first, 'connected');
    const rows = await s.coach.nextTargets(first);
    const view = nextTimeView({ title: 'Push A', builtIn: summary?.nextTime ?? null, coachRows: rows, availability: await s.coach.availability(), reviewing: false });
    const bench = view?.rows.find((r) => r.exerciseName === 'Bench press');
    expect(bench).toMatchObject({ tag: 'Coach', pct: '−4.2%', actions: [{ label: 'Undo', tap: 'undo' }] });
    expect(plain(bench?.target)).toMatch(/^Target 57\.5 kg × /);
    expect(bench?.why[0]).toBe('“Every set was RPE 10.”');

    // Routines-aware: the next Push A uses the coach's target.
    h.clockMs += 2 * 86_400_000;
    const started = await s.workout.start({ gymId, opId: 'start-push-a', checkIn: null, routineOf: saved.routine.id });
    if (!started.ok) throw new Error(started.error.message);
    const work = started.aggregate.sets.filter((x) => x.setType !== 'warmup');
    expect(work.every((x) => x.planned.source === 'coach' && x.planned.load?.value === 57.5)).toBe(true);
    // Why? on the set: set by the coach after the workout it reviewed, its reason in quotes.
    expect(work[0]?.planned.provenance).toMatchObject({ source: 'coach', coach: { scope: 'next_session', reason: 'Every set was RPE 10.' } });
    const why = await s.workout.explainTarget(started.aggregate.session.id, work[0]?.id ?? '');
    expect(why?.rows.find((r) => r.key === 'reason')?.lines).toEqual(['“Every set was RPE 10”']);
    expect(plain(why?.rows.find((r) => r.key === 'set_by')?.lines[0])).toBe('Coach · after your 10 Oct workout');
    await h.settle(s);
    const used = await s.coach.nextTargets(first);
    expect(used[0]?.usedBySessionId).toBe(started.aggregate.session.id);
    const after = nextTimeView({ title: 'Push A', builtIn: summary?.nextTime ?? null, coachRows: used, availability: await s.coach.availability(), reviewing: false });
    expect(after?.rows.find((r) => r.exerciseName === 'Bench press')).toMatchObject({ actions: [], note: 'Used' });
  });

  it('D2: on a stalled lift (misses at the same load twice) the coach’s one-step reset is a suggestion: not saved, the rule plans next time until Apply; Apply then Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 2, rpe: 10 }, { load: 60, reps: 2, rpe: 10 }] }]);
    h.clockMs += 2 * 86_400_000;
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 2, rpe: 10 }, { load: 60, reps: 2, rpe: 10 }] }]);
    model = new StepModel([
      (req) => {
        const w = yourData(req).workout;
        return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Two sessions short at 60.' }] });
      },
      () => reply('Two sessions short.'),
    ]);
    await s.coach.runSummaryTurn(second);
    const [row] = await s.coach.nextTargets(second);
    if (!row) throw new Error('no row');
    // One step lighter would be small anywhere else; after a stall it is a reset: a suggestion (rule 8, CA8, D2).
    expect(row).toMatchObject({ size: 'bigger', status: 'proposed' });
    const summary = await s.workout.summary(second, 'connected');
    const view = nextTimeView({ title: 'Workout', builtIn: summary?.nextTime ?? null, coachRows: [row], availability: await s.coach.availability(), reviewing: false });
    expect(view?.rows.find((r) => r.exerciseName === 'Bench press')).toMatchObject({ tag: 'Suggested', actions: [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }] });
    // Until Ben applies it, next time is the built-in rule's, not 57.5.
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).not.toContain('57.5');
    expect(await s.coach.tapNextTarget(row, 'apply', 'tap-apply')).toMatchObject({ status: 'written', row: { status: 'applied' } });
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).toContain('57.5');
    const [applied] = await s.coach.nextTargets(second);
    if (!applied) throw new Error('no row');
    expect(await s.coach.tapNextTarget(applied, 'undo', 'tap-undo')).toMatchObject({ status: 'written', row: { status: 'proposed' } });
    expect(plain((await s.next.preview(gymId))?.targets[0]?.line)).not.toContain('57.5');
  });

  it('Ben, 23 Oct (v5offers SP1): an extra set the coach suggests unasked is offered on the Summary with Skip / Apply, never dropped or saved by default; Apply plans it, Skip keeps the count', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 6, rpe: 8 }, { load: 60, reps: 6, rpe: 8 }, { load: 60, reps: 6, rpe: 8 }] }]);
    model = new StepModel([
      (req) => {
        const w = yourData(req).workout;
        return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: null, reps: null }, sets: 4, reason: 'Room for one more.' }] });
      },
      () => reply('Room for one more.'),
    ]);
    await s.coach.runSummaryTurn(first);
    const [row] = await s.coach.nextTargets(first);
    if (!row) throw new Error('no row');
    expect(row).toMatchObject({ size: 'bigger', status: 'proposed', sets: 4 });
    const summary = await s.workout.summary(first, 'connected');
    const view = nextTimeView({ title: 'Workout', builtIn: summary?.nextTime ?? null, coachRows: [row], availability: await s.coach.availability(), reviewing: false });
    expect(view?.rows.find((r) => r.exerciseName === 'Bench press')).toMatchObject({ tag: 'Suggested', actions: [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }] });
    expect(view?.rows.find((r) => r.exerciseName === 'Bench press')?.target).toContain('4 sets');
    const workingNext = async () => {
      h.clockMs += 86_400_000;
      const st = await s.workout.start({ gymId, opId: h.ids(), checkIn: null, nextOf: first });
      if (!st.ok) throw new Error(st.error.message);
      const n = st.aggregate.sets.filter((x) => x.setType !== 'warmup').length;
      const d = await s.workout.load(st.aggregate.session.id);
      const r = await s.workout.dispatch(st.aggregate.session.id, { type: 'discard', at: h.now(), opId: h.ids(), expectedVersion: d?.aggregate.session.version ?? 0, confirmedLoggedSets: 0 });
      if (!r.ok) throw new Error(r.error.message);
      return n;
    };
    expect(await workingNext()).toBe(3);
    expect(await s.coach.tapNextTarget(row, 'apply', 'tap-apply-extra')).toMatchObject({ status: 'written', row: { status: 'applied' } });
    expect(await workingNext()).toBe(4);
  });

  it('Undo on the row puts the built-in rule back for the next session; offline or not connected, the built-in rule is labelled and no call is made', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 8, rpe: 10 }] }]);
    model = new StepModel([
      (req) => {
        const w = yourData(req).workout;
        return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Heavy.' }] });
      },
      () => reply('Ok.'),
    ]);
    await s.coach.runSummaryTurn(first);
    const [row] = await s.coach.nextTargets(first);
    if (!row) throw new Error('no row');
    expect(await s.coach.tapNextTarget(row, 'undo', 'tap-undo')).toMatchObject({ status: 'written', row: { status: 'undone' } });
    const preview = await s.next.preview(gymId);
    expect(plain(preview?.targets[0]?.line)).not.toContain('57.5');

    connection = { status: 'not_connected', route: null, email: null, model: null };
    const second = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const calls = model.requests.length;
    expect(await s.coach.runSummaryTurn(second)).toBeNull();
    expect(model.requests.length).toBe(calls);
    const summary = await s.workout.summary(second, 'not_connected');
    const view = nextTimeView({ title: 'Workout', builtIn: summary?.nextTime ?? null, coachRows: [], availability: await s.coach.availability(), reviewing: false });
    expect(view?.rows.every((r) => r.tag === 'Rule')).toBe(true);
  });

  it('a summary turn cut off by a force-close shows Interrupted on the Summary, not nothing (review N7)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    // The model never answers; the app is closed mid-turn.
    model = new (class extends StepModel {
      override stream(request: ModelRequest): AsyncIterable<ModelEvent> {
        this.requests.push(request);
        return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<ModelEvent>>(() => undefined) }) };
      }
    })([]);
    const pending = s.coach.runSummaryTurn(first);
    void pending.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    await h.forceClose();
    const { services: again } = await h.launch();
    expect(await again.coach.summaryNote(first)).toBe('Interrupted.');
  });

  async function savedBenchTarget(s: Awaited<ReturnType<Harness['launch']>>['services'], gymId: string) {
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 10 }, { load: 60, reps: 7, rpe: 10 }] }]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: `save-${first}`, addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    model = new StepModel([
      (req) => {
        const w = yourData(req).workout;
        return call('set_next_session_targets', { sourceSessionId: w.sessionId, sourceVersion: w.version, targets: [{ exerciseId: w.exercises[0]?.exerciseId, target: { load: { value: 57.5, unit: 'kg', convention: 'total' }, reps: null }, sets: null, reason: 'Heavy.' }] });
      },
      () => reply('Ok.'),
    ]);
    return { first, routineId: saved.routine.id };
  }

  it('an unrelated workout doesn’t use the targets up: a late summary answer is saved, and Undo still works (review S2)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { first } = await savedBenchTarget(s, gymId);
    // Before the summary answers, Ben does an empty workout (not from Push A).
    h.clockMs += 3_600_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 40, reps: 10 }] }]);
    const turn = await s.coach.runSummaryTurn(first);
    expect(turn?.status).toBe('completed');
    const [row] = await s.coach.nextTargets(first);
    expect(row).toMatchObject({ status: 'saved', usedBySessionId: null });
    if (!row) throw new Error('no row');
    expect(await s.coach.tapNextTarget(row, 'undo', 'tap-undo-s2')).toMatchObject({ status: 'written', row: { status: 'undone' } });
  });

  it('a discarded start gives the coach’s targets back; a restart plans them again (review S3)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { first, routineId } = await savedBenchTarget(s, gymId);
    await s.coach.runSummaryTurn(first);
    h.clockMs += 86_400_000;
    const a = await s.workout.start({ gymId, opId: 'start-a', checkIn: null, routineOf: routineId });
    if (!a.ok) throw new Error(a.error.message);
    expect(a.aggregate.sets.filter((x) => x.setType !== 'warmup').every((x) => x.planned.source === 'coach' && x.planned.load?.value === 57.5)).toBe(true);
    expect((await s.coach.nextTargets(first))[0]?.usedBySessionId).toBe(a.aggregate.session.id);
    const d = await s.workout.dispatch(a.aggregate.session.id, { type: 'discard', at: h.now(), opId: 'discard-a', expectedVersion: a.aggregate.session.version, confirmedLoggedSets: 0 });
    expect(d.ok).toBe(true);
    // Unused again: Undo is back, and a restart plans the coach's target, not the built-in rule's.
    expect((await s.coach.nextTargets(first))[0]?.usedBySessionId).toBeNull();
    const b = await s.workout.start({ gymId, opId: 'start-b', checkIn: null, routineOf: routineId });
    if (!b.ok) throw new Error(b.error.message);
    expect(b.aggregate.sets.filter((x) => x.setType !== 'warmup').every((x) => x.planned.source === 'coach' && x.planned.load?.value === 57.5)).toBe(true);
    expect((await s.coach.nextTargets(first))[0]?.usedBySessionId).toBe(b.aggregate.session.id);
  });

  it('a start noted but never written (refused, or cut off by a force-close) leaves the targets unused (review S3)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const { first, routineId } = await savedBenchTarget(s, gymId);
    await s.coach.runSummaryTurn(first);
    h.clockMs += 86_400_000;
    // An empty workout is open, so the routine start is noted and then refused.
    const open = await s.workout.start({ gymId, opId: 'start-empty', checkIn: null });
    expect(open.ok).toBe(true);
    const refused = await s.workout.start({ gymId, opId: 'start-refused', checkIn: null, routineOf: routineId });
    expect(refused.ok).toBe(false);
    await h.forceClose();
    const { services: again } = await h.launch();
    expect((await again.coach.nextTargets(first))[0]).toMatchObject({ status: 'saved', usedBySessionId: null });
  });
});

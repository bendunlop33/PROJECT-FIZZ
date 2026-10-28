import { afterEach, describe, expect, it } from 'vitest';

import type { CoachModelPort, ModelEvent, ModelRequest } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import type { CoachEntry } from '../src/coach/coach-service';
import { CoachTurnBusyError, type RunningTurnEvent } from '../src/coach/running-turns';
import { liveTurnOf, statusView, threadRows } from '../src/coach/sheet-view';
import { createAppForeground, HOST_CLOCK } from '../src/coach/turn-lifecycle';
import { ScriptedCoachModel } from '../../../packages/coach/test/fake-model';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 28 Oct: "it stops 'running' if I move away from the chat screen") Through the app services on real
 * SQLite with the scripted fake model: a turn keeps running with the sheet closed, a sheet opened on its
 * thread attaches to it, a second send is refused while it runs, and the rows show the reply when it ends.
 * Leaving the app doesn't fail the turn or mark the coach Offline; a relaunch shows `Interrupted.` with Try again.
 */

const CONNECTED: TextCoachState = { status: 'ok', route: 'chatgpt_plan', email: 'ben@example.com', model: { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' } };
const TODAY: CoachEntry = { kind: 'today' };
const words = (text: string) => ({ kind: 'words' as const, text, spoken: false });

/** The scripted model, with a hook before each step's events: hold the stream, or leave the app. */
class HookedModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(
    private readonly inner: ScriptedCoachModel,
    private readonly before: (step: number) => Promise<void> | void = () => undefined,
    /** Events played before the hook (so the sheet has something to show while the turn is held). */
    private readonly lead: (step: number) => ModelEvent[] = () => [],
  ) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    // The weekly review the app runs on open isn't part of these flows.
    if (typeof request.toolChoice === 'object' && request.toolChoice.name === 'weekly_review') {
      yield { type: 'error', error: 'unavailable' };
      return;
    }
    this.requests.push(request);
    const step = this.requests.length;
    for (const e of this.lead(step)) yield e;
    await this.before(step);
    yield* this.inner.stream(request);
  }
}

const replyCall = (message: string): ModelEvent[] => [{ type: 'tool_call', callId: 'c-reply', name: 'reply', arguments: JSON.stringify({ message, offer: null }) }, { type: 'completed' }];
const dropped: ModelEvent = { type: 'error', error: 'network', failure: { kind: 'stream_interrupted' } };

function gate() {
  let open: () => void = () => undefined;
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { wait: () => p, open: () => { open(); } };
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let h: Harness;
afterEach(async () => {
  await h.cleanup();
});

describe('a coach turn outlives the sheet', () => {
  it('runs with the sheet closed; reopened, the sheet attaches; a second send is refused; the rows show the reply when it ends', async () => {
    const held = gate();
    const reply = 'Rest two minutes. Then go again.';
    // The first sentence streams, then the stream is held (Ben has closed the sheet).
    const args = JSON.stringify({ message: reply, offer: null });
    const model = new HookedModel(new ScriptedCoachModel([replyCall(reply)]), () => held.wait(), (step) => (step === 1 ? [{ type: 'tool_call_delta', name: 'reply', delta: args.slice(0, args.indexOf('Then')) }] : []));
    h = createHarness('2026-10-28T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const { services: s } = await h.launch();
    await setUpGym(h, s);

    const events: RunningTurnEvent[] = [];
    const off = s.coach.running.subscribe((e) => events.push(e));
    const turnId = h.ids();
    // Sent from the sheet, which then closes: no `onProgress`, nobody waiting on it on screen.
    const sent = s.coach.send({ entry: TODAY, threadId: null, input: words('How long should I rest?'), turnId });
    await until(() => (s.coach.running.get(turnId)?.progress.some((p) => p.kind === 'item') ?? false));

    // The sheet opens again: its thread (the turn's first message made it) and the turn running on it.
    const threadId = await s.coach.resolveThread(TODAY);
    expect(threadId).not.toBeNull();
    const running = s.coach.running.runningOn(threadId, 'general');
    expect(running?.turnId).toBe(turnId);
    if (running === null) throw new Error('not running');
    expect(liveTurnOf(running)).toMatchObject({ benText: 'How long should I rest?', firstEvent: true, sentences: ['Rest two minutes.'] });
    // The stored rows leave the running turn to the live rows (Ben's message isn't shown twice).
    const during = await s.coach.loadThread(threadId ?? '');
    if (during === null) throw new Error('no thread');
    expect(threadRows({ ...during, running: (id) => s.coach.isRunning(id) })).toEqual([]);

    // One turn per thread: a second send is refused by the service (with or without the thread ID), and nothing is saved.
    await expect(s.coach.send({ entry: TODAY, threadId, input: words('Hello?'), turnId: h.ids() })).rejects.toBeInstanceOf(CoachTurnBusyError);
    await expect(s.coach.send({ entry: TODAY, threadId: null, input: words('Hello?'), turnId: h.ids() })).rejects.toBeInstanceOf(CoachTurnBusyError);
    // The same tap again is the same turn.
    expect(s.coach.send({ entry: TODAY, threadId: null, input: words('How long should I rest?'), turnId })).toBe(sent);

    held.open();
    const r = await sent;
    expect(r.status).toBe('completed');
    expect(s.coach.running.runningOn(threadId, 'general')).toBeNull();
    const finished = events.find((e) => e.kind === 'finished');
    expect(finished?.turn).toMatchObject({ turnId, threadId });
    off();

    const after = await s.coach.loadThread(threadId ?? '');
    if (after === null) throw new Error('no thread');
    const rows = threadRows({ ...after, running: (id) => s.coach.isRunning(id) });
    expect(rows.map((x) => x.kind)).toEqual(['ben', 'coach']);
    expect(rows[1]).toMatchObject({ sentences: ['Rest two minutes.', 'Then go again.'] });
    expect(model.requests).toHaveLength(1);

    // Free again once it ended.
    const next = await s.coach.send({ entry: TODAY, threadId, input: words('Thanks'), turnId: h.ids() });
    expect(next.status).toBe('failed'); // The script has no second answer; the point is it ran.
  });

  it('a workout’s thread: the summary turn and the workout sheet share it (one at a time)', async () => {
    const held = gate();
    const model = new HookedModel(new ScriptedCoachModel([replyCall('Ok.')]), () => held.wait());
    h = createHarness('2026-10-28T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const sent = s.coach.send({ entry: { kind: 'summary', sessionId: 'w1' }, threadId: null, input: { kind: 'summary' }, turnId: h.ids() });
    void sent.catch(() => undefined);
    expect(s.coach.running.runningOn(null, 'session:w1')).not.toBeNull();
    await expect(s.coach.send({ entry: { kind: 'workout', sessionId: 'w1' }, threadId: null, input: words('Hi'), turnId: h.ids() })).rejects.toBeInstanceOf(CoachTurnBusyError);
    // Another thread is free.
    expect(s.coach.running.runningOn(null, 'general')).toBeNull();
    held.open();
    await sent.catch(() => undefined);
  });
});

describe('leaving the app while the coach answers', () => {
  it('a stream lost in the background is asked for again on return; the coach never reads Offline', async () => {
    const fg = createAppForeground(HOST_CLOCK);
    const model = new HookedModel(new ScriptedCoachModel([[dropped], replyCall('Rest two minutes.')]), (step) => {
      if (step === 1) fg.setActive(false);
    });
    h = createHarness('2026-10-28T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED), lifecycle: fg } });
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const turnId = h.ids();
    const sent = s.coach.send({ entry: TODAY, threadId: null, input: words('How long should I rest?'), turnId });
    await new Promise((r) => setTimeout(r, 50));
    // Waiting for the app: still running, nothing asked again yet.
    expect(s.coach.isRunning(turnId)).toBe(true);
    expect(model.requests).toHaveLength(1);
    fg.setActive(true);
    const r = await sent;
    expect(r.status).toBe('completed');
    expect(model.requests).toHaveLength(2);
    expect(statusView(await s.coach.availability()).word).not.toBe('Offline');
  });

  it('lost again while away: Interrupted with Try again, and still not Offline', async () => {
    const fg = createAppForeground(HOST_CLOCK);
    const model = new HookedModel(new ScriptedCoachModel([[dropped], [dropped]]), () => {
      fg.setActive(false);
    });
    h = createHarness('2026-10-28T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED), lifecycle: fg } });
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const sent = s.coach.send({ entry: TODAY, threadId: null, input: words('How long should I rest?'), turnId: h.ids() });
    await new Promise((r) => setTimeout(r, 50));
    fg.setActive(true);
    const r = await sent;
    expect(r.status).toBe('interrupted');
    expect(statusView(await s.coach.availability()).word).not.toBe('Offline');
    const data = await s.coach.loadThread(r.threadId);
    if (data === null) throw new Error('no thread');
    const rows = threadRows({ ...data, running: (id) => s.coach.isRunning(id) });
    expect(rows.at(-1)).toMatchObject({ kind: 'outcome', text: 'Interrupted. Nothing changed.', retry: true, input: words('How long should I rest?') });
  });
});

describe('a relaunch while the coach was answering', () => {
  it('the thread shows Interrupted with Try again, which sends the same words as a new turn', async () => {
    const held = gate();
    let model = new HookedModel(new ScriptedCoachModel([replyCall('never')]), () => held.wait());
    h = createHarness('2026-10-28T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const sent = s.coach.send({ entry: TODAY, threadId: null, input: words('How long should I rest?'), turnId: h.ids() });
    void sent.catch(() => undefined);
    await until(() => model.requests.length === 1);
    const threadId = await s.coach.resolveThread(TODAY);
    await h.forceClose();

    model = new HookedModel(new ScriptedCoachModel([replyCall('Rest two minutes.')]));
    const { services: again } = await h.launch();
    const data = await again.coach.loadThread(threadId ?? '');
    if (data === null) throw new Error('no thread');
    const rows = threadRows({ ...data, running: (id) => again.coach.isRunning(id) });
    const outcome = rows.at(-1);
    expect(outcome).toMatchObject({ kind: 'outcome', text: 'Interrupted. Nothing changed.', retry: true, input: words('How long should I rest?') });
    if (outcome?.kind !== 'outcome' || outcome.input === null) throw new Error('no retry');
    const retried = await again.coach.send({ entry: TODAY, threadId, input: outcome.input, turnId: h.ids() });
    expect(retried.status).toBe('completed');
  });

  it('a saved `running` turn that no app run owns reads as Interrupted (never a silent gap)', async () => {
    const held = gate();
    const model = new HookedModel(new ScriptedCoachModel([replyCall('Ok.')]), () => held.wait());
    h = createHarness('2026-10-28T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    const sent = s.coach.send({ entry: TODAY, threadId: null, input: words('Hi'), turnId: h.ids() });
    await until(() => model.requests.length === 1);
    const data = await s.coach.loadThread((await s.coach.resolveThread(TODAY)) ?? '');
    if (data === null) throw new Error('no thread');
    // As another app run would see it: not running here.
    expect(threadRows({ ...data, running: () => false }).at(-1)).toMatchObject({ kind: 'outcome', text: 'Interrupted. Nothing changed.', retry: true });
    held.open();
    await sent;
  });
});

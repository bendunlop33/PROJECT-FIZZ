import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { createEditTodayExecutor } from '../src/edit-today';
import { createSessionReadExecutor, createStoreExecutors, type CoachExecutors } from '../src/executors';
import type { CoachModelPort, ModelEvent, ModelRequest } from '../src/model-port';
import { PLAIN_TURN_TIMERS, runCoachTurn, type TurnLifecycle, type TurnTimers } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { call, id, kg, memoryStore, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * (Ben, 28 Oct: "it stops 'running' if I move away from the chat screen") A turn and the app's foreground state:
 * a stream lost in the background is asked for again once on return (nothing committed yet); one that can't be
 * is `interrupted` (never a network failure, so never `Offline`); the turn's timers are the lifecycle's own.
 */

let stores: Store[] = [];
async function store(): Promise<Store> {
  const s = await memoryStore();
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores) await s.close();
  stores = [];
});

/** A hand-driven foreground: `away()` / `back()`. */
function fakeLifecycle(timers: TurnTimers = PLAIN_TURN_TIMERS) {
  let active = true;
  let count = 0;
  const waiting = new Set<() => void>();
  const lifecycle: TurnLifecycle & { away(): void; back(): void; waiters(): number } = {
    timers,
    backgroundCount: () => count,
    isActive: () => active,
    whenActive: (signal) =>
      active || signal.aborted
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiting.add(resolve);
            signal.addEventListener('abort', () => {
              resolve();
            });
          }),
    away() {
      active = false;
      count += 1;
    },
    back() {
      active = true;
      for (const w of [...waiting]) w();
      waiting.clear();
    },
    waiters: () => waiting.size,
  };
  return lifecycle;
}

/** Each step: run `before` (e.g. the app leaves), then play the events. */
class StepsModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: { before?: () => void; events: ModelEvent[] }[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1] ?? { events: [{ type: 'error', error: 'unavailable' }] };
    step.before?.();
    for (const e of step.events) {
      await Promise.resolve();
      yield e;
    }
  }
}

const dropped: ModelEvent = { type: 'error', error: 'network', failure: { kind: 'stream_interrupted' } };

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('a stream lost while the app was in the background', () => {
  it('waits for the app to come back, asks once more and completes', async () => {
    const s = await store();
    const life = fakeLifecycle();
    const model = new StepsModel([{ before: () => { life.away(); }, events: [dropped] }, { events: reply('Rest two minutes.') }]);
    const turn = runCoachTurn(request({ input: words('How long should I rest?') }), { ...ports(s, model), lifecycle: life });
    await tick();
    // Nothing is asked while away; the turn is still running.
    expect(model.requests).toHaveLength(1);
    expect(life.waiters()).toBe(1);
    life.back();
    const r = await turn;
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.input).toEqual(model.requests[0]?.input);
    expect(r).toMatchObject({ status: 'completed', error: null });
  });

  it('a second loss right after returning is a real failure (network): no third request', async () => {
    const s = await store();
    const life = fakeLifecycle();
    const model = new StepsModel([{ before: () => { life.away(); }, events: [dropped] }, { events: [dropped] }, { events: reply('never') }]);
    const turn = runCoachTurn(request({ input: words('How long should I rest?') }), { ...ports(s, model), lifecycle: life });
    await tick();
    life.back();
    const r = await turn;
    expect(model.requests).toHaveLength(2);
    expect(r).toMatchObject({ status: 'failed', error: 'network' });
  });

  it('lost again while away after the retry: interrupted, not failed', async () => {
    const s = await store();
    const life = fakeLifecycle();
    const model = new StepsModel([{ before: () => { life.away(); }, events: [dropped] }, { before: () => { life.away(); }, events: [dropped] }]);
    const turn = runCoachTurn(request({ input: words('How long should I rest?') }), { ...ports(s, model), lifecycle: life });
    await tick();
    life.back();
    const r = await turn;
    expect(model.requests).toHaveLength(2);
    expect(r.status).toBe('interrupted');
    expect((await s.repos.coach.getTurn(r.turnId))?.status).toBe('interrupted');
  });

  it('after a committed change: not asked again; interrupted with the card kept', async () => {
    const s = await store();
    const agg: SessionAggregate = workout();
    const saved = await s.repos.sessions.save(agg, null);
    if (!saved.ok) throw new Error('save failed');
    const load = () => s.repos.sessions.get(SESSION);
    const executors: CoachExecutors = {
      ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: SESSION }),
      get_active_session: createSessionReadExecutor({ loadSession: load, gymName: 'Main Gym' }),
      edit_today: createEditTodayExecutor({ store: s.repos.coach, loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
    };
    const life = fakeLifecycle();
    const edit = { baseVersion: 7, ops: [{ op: 'set', setId: id(102), target: { load: kg(102), reps: null } }, { op: 'set', setId: id(103), target: { load: kg(102), reps: null } }], reason: 'Your recent sets were easy.', benAsked: true, benQuote: 'Make bench heavier' };
    const model = new StepsModel([{ events: [call('edit_today', edit), { type: 'completed' }] }, { before: () => { life.away(); }, events: [dropped] }, { events: reply('never') }]);
    const turn = runCoachTurn(request({ kind: 'workout', input: words('Make bench heavier'), context: { session: agg, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] } }), { ...ports(s, model, executors), lifecycle: life });
    await tick();
    // Not waiting to ask again: a change is already saved.
    expect(life.waiters()).toBe(0);
    life.back();
    const r = await turn;
    expect(model.requests).toHaveLength(2);
    expect(r.status).toBe('interrupted');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
  });

  it('in the foreground a lost stream is a network failure, as before', async () => {
    const s = await store();
    const life = fakeLifecycle();
    const model = new ScriptedCoachModel([[dropped], reply('never')]);
    const r = await runCoachTurn(request({ input: words('Hi') }), { ...ports(s, model), lifecycle: life });
    expect(model.requests).toHaveLength(1);
    expect(r).toMatchObject({ status: 'failed', error: 'network' });
  });

  it('Stop while waiting to come back ends the turn as stopped', async () => {
    const s = await store();
    const life = fakeLifecycle();
    const stop = new AbortController();
    const model = new StepsModel([{ before: () => { life.away(); }, events: [dropped] }]);
    const turn = runCoachTurn(request({ input: words('Hi'), signal: stop.signal }), { ...ports(s, model), lifecycle: life });
    await tick();
    stop.abort();
    const r = await turn;
    expect(model.requests).toHaveLength(1);
    expect(r.status).toBe('cancelled');
  });
});

describe('the turn’s time limits run on the lifecycle’s timers', () => {
  it('first-event, stall and whole-turn timers are set and cleared there (paused timers never fire)', async () => {
    const s = await store();
    const set: number[] = [];
    let live = 0;
    // Timers that never fire: the app "in the background" for the whole wait.
    const paused: TurnTimers = {
      set: (_fn, ms) => {
        set.push(ms);
        live += 1;
        return {};
      },
      clear: () => {
        live -= 1;
      },
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const model: CoachModelPort = {
      async *stream() {
        await gate;
        yield* reply('Rest two minutes.');
      },
    };
    const life = fakeLifecycle(paused);
    const turn = runCoachTurn(request({ input: words('How long should I rest?') }), { ...ports(s, model), timing: { firstEventMs: 20, stallMs: 20, totalMs: 40 }, lifecycle: life });
    // Far past every limit in real time: nothing timed out.
    await new Promise((r) => setTimeout(r, 120));
    release();
    const r = await turn;
    expect(r.status).toBe('completed');
    expect(set).toContain(40);
    expect(set).toContain(20);
    expect(live).toBe(0);
  });
});

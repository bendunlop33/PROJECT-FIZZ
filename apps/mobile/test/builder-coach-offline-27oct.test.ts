import { describe, expect, it } from 'vitest';

import { createBuilderLoadGuard, type BuilderCoachSnapshot, type CoachModelPort, type ModelEvent, type ModelRequest } from '@fizz/coach';
import { buildFromSetup, slotsOf, type BuilderSetup } from '@fizz/domain';
import { OWNER, builderFixture as F, idGen } from '@fizz/domain/testing';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createBuilderCoachService, type BuilderCoachWorld } from '../src/coach/builder-coach-service';
import { EDIT_ASK_COPY, editAskView } from '../src/coach/builder-coach-view';
import { askTurn, asksResend, retryableTurn, retryTurn, sendPlan, settleTurn, type BuilderTurn } from '../src/coach/builder-sheet-view';
import type { CoachAvailability } from '../src/coach/coach-service';

/**
 * (Ben, build 403, 26 Oct 18:19, on wifi) "Add 8 min bike warm up" → `ⓘ Offline`, no reply; then "Again" was read as
 * a new request ("What would you like me to repeat?"). Root causes: the builder coach called a timeout (no answer in
 * 20 s, e.g. a slow first call while the sign-in refreshes) `offline`, never retried a dropped connection (a stale
 * socket on the first call after a while), held `Offline` for a minute after one network error with no way to retry,
 * and sent "Again" to the coach as words.
 */

class StepModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: (() => ModelEvent[])[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    for (const e of step === undefined ? [{ type: 'error' as const, error: 'unavailable' as const }] : step()) {
      await Promise.resolve();
      yield e;
    }
  }
}
const call = (name: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: `c-${name}`, name, arguments: JSON.stringify(args) }, { type: 'completed' }];

const DRAFT = '5f0c2a52-7b1e-4c1a-9d3e-2a4b6c8d0e1f';
const CONNECTED: CoachAvailability = { status: 'ok', model: 'gpt-main', workoutModel: 'gpt-light' };
const legs: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'squat', supersets: false, groups: [{ group: 'Legs', count: 4 }] };

function serviceWith(model: StepModel) {
  const ctx = F.context();
  const workout = buildFromSetup(legs, F.pool, ctx).workout;
  const clock = { ms: Date.parse('2026-10-26T18:19:00Z') };
  const now = (): ZonedTimestamp => ({ utc: new Date(clock.ms).toISOString(), tz: 'Europe/London' });
  const world = (): BuilderCoachWorld => {
    const snapshot: BuilderCoachSnapshot = { draftId: DRAFT, draftVersion: 1, dayName: 'Legs', minutes: 60, supersets: false, workout, revs: {} };
    return {
      snapshot,
      env: { ctx, usable: (id) => F.info(id) !== null, pain: () => null, loads: createBuilderLoadGuard({ ctx, refs: () => null, pain: () => null }), mainGroup: 'Legs' },
      extras: { usable: [], painFlags: [], dayNotes: [], plan: null, goal: null, history: [], memories: [] },
    };
  };
  const service = createBuilderCoachService({
    availability: () => Promise.resolve(CONNECTED),
    model: () => model,
    now,
    newId: idGen(),
    ownerId: () => Promise.resolve(OWNER),
    source: { world: (id) => Promise.resolve(id === DRAFT ? world() : null), setup: () => Promise.resolve(null) },
    writer: { applySetup: () => Promise.resolve({ ok: true }), applied: () => Promise.resolve(false), applyWorkout: () => Promise.resolve({ ok: true }) },
  });
  const legCurl = slotsOf(workout.blocks).find((s) => s.exerciseId === 'leg_curl')?.key ?? '';
  return { service, clock, legCurl };
}

const proposal = (key: string) => call('propose_workout_edit', { ops: [{ op: 'sets', slotKey: key, workingSets: 4 }], reply: 'One more set.' });

describe('builder coach: honest status when the call fails while online (Ben, 26 Oct)', () => {
  it('a timeout is `Couldn’t reach the coach` (Retry), never `Offline`; the bar stays connected (repro: it read Offline)', async () => {
    const model = new StepModel([() => [{ type: 'error', error: 'timeout' }]]);
    const { service } = serviceWith(model);
    const r = await service.askEdit({ draftId: DRAFT, words: 'Add 8 min bike warm up', opId: 'a1' });
    expect(r).toEqual({ kind: 'unavailable', status: 'failed', timeout: true });
    expect(editAskView(r)).toEqual({ kind: 'toast', text: EDIT_ASK_COPY.unreached });
    expect(await service.status()).toBe('ok');
  });

  it('a dropped connection (transient) is tried once more and the answer lands', async () => {
    let key = '';
    const model = new StepModel([() => [{ type: 'error', error: 'network', transient: true }], () => proposal(key)]);
    const s = serviceWith(model);
    key = s.legCurl;
    const r = await s.service.askEdit({ draftId: DRAFT, words: 'one more set of leg curls', opId: 'a2' });
    expect(r.kind).toBe('proposal');
    expect(model.requests).toHaveLength(2);
    expect(await s.service.status()).toBe('ok');
  });

  it('no network twice reads Offline and holds it; Ben’s Retry still tries at once and clears it when it answers', async () => {
    let key = '';
    const model = new StepModel([() => [{ type: 'error', error: 'network', transient: true }], () => [{ type: 'error', error: 'network', transient: true }], () => proposal(key)]);
    const s = serviceWith(model);
    key = s.legCurl;
    expect(await s.service.askEdit({ draftId: DRAFT, words: 'one more set of leg curls', opId: 'a3' })).toEqual({ kind: 'unavailable', status: 'offline' });
    expect(await s.service.status()).toBe('offline');
    // Inside the hold a plain ask doesn't call (offline), a Retry does.
    expect(await s.service.askEdit({ draftId: DRAFT, words: 'x', opId: 'a4' })).toEqual({ kind: 'unavailable', status: 'offline' });
    expect(model.requests).toHaveLength(2);
    const again = await s.service.askEdit({ draftId: DRAFT, words: 'one more set of leg curls', opId: 'a3', retry: true });
    expect(again.kind).toBe('proposal');
    expect(await s.service.status()).toBe('ok');
  });
});

describe('builder coach sheet: Retry and "Again" (Ben, 26 Oct)', () => {
  const at = { atUtc: '2026-10-26T18:19:00Z', tz: 'Europe/London' };
  const failed = (text: string): BuilderTurn[] => settleTurn(askTurn([], { id: 't1', words: 'Add 8 min bike warm up', ...at }), 't1', editAskView({ kind: 'unavailable', status: 'failed', timeout: true })).turns.map((t) => ({ ...t, words: text }));

  it('a failed ask is a line with Retry; Offline too; a reply or proposal sets the status back to connected', () => {
    const t = failed('Add 8 min bike warm up');
    expect(t[0]?.result).toEqual({ kind: 'line', text: 'Couldn’t reach the coach', retry: true });
    const off = settleTurn(askTurn([], { id: 'o', words: 'w', ...at }), 'o', { kind: 'reach', reach: 'offline' });
    expect(off.turns[0]?.result).toEqual({ kind: 'line', text: 'Offline', retry: true });
    expect(off.reach).toBe('offline');
    const gone = settleTurn(askTurn([], { id: 'g', words: 'w', ...at }), 'g', { kind: 'gone' });
    expect(gone.turns[0]?.result).toEqual({ kind: 'line', text: 'Workout unavailable' });
    expect(settleTurn(askTurn([], { id: 'r', words: 'w', ...at }), 'r', { kind: 'reply', text: 'Done.' }).reach).toBe('ok');
  });

  it('"Again" right after a failed ask sends that ask again (its own words and ID), not the word (repro)', () => {
    const t = failed('Add 8 min bike warm up');
    expect(sendPlan(t, 'Again')).toEqual({ kind: 'retry', turn: t[0] });
    for (const w of ['again', 'Try again', 'try again please', 'Retry', 'one more time', 'ok again']) expect(asksResend(w)).toBe(true);
    for (const w of ['Again with 10 min', 'add it again later', 'Add 8 minute bike warm up before legs']) expect(asksResend(w)).toBe(false);
    // After an answer, "again" is just words for the coach.
    const answered = settleTurn(askTurn([], { id: 'x', words: 'w', ...at }), 'x', { kind: 'reply', text: 'Done.' }).turns;
    expect(sendPlan(answered, 'Again')).toEqual({ kind: 'ask', words: 'Again' });
    expect(retryableTurn(answered)).toBeNull();
  });

  it('Retry puts the same turn back to asking, once; nothing while another asks', () => {
    const t = failed('Add 8 min bike warm up');
    const r = retryTurn(t, 't1');
    expect(r[0]?.result).toEqual({ kind: 'asking' });
    expect(r[0]?.words).toBe('Add 8 min bike warm up');
    expect(retryTurn(r, 't1')).toEqual(r);
  });
});

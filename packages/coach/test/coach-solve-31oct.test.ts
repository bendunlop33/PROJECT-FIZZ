import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { ActionDetail } from '@fizz/schemas';

import type { CoachModelPort, ModelEvent, ModelRequest } from '../src/model-port';
import { createPlanAddExecutor, isFixOffer, namedLoadIn, type PlanAddRequest, type PlanSwapPrepared } from '../src/plan-swap';
import { asksLiveChange, asksPlanFix, asksPlanRebuild, planLevelAsk } from '../src/request';
import {
  COACH_HIGH_EFFORT_EVENT_MS,
  COACH_PLAN_TIMEOUT_MS,
  COACH_WORKOUT_PLAN_TIMEOUT_MS,
  COACH_WORKOUT_TIMEOUT_MS,
  LIGHT_RETRY_LINE,
  PLAN_PART_NUDGE_LINE,
  SHORT_ANSWER_NOTE,
  SOLUTION_NUDGE_LINE,
  coachTurnTiming,
  runCoachTurn,
  type CoachTiming,
  type CoachTurnProgress,
  type CoachTurnResult,
} from '../src/turn';
import { createStoreExecutors, type CoachExecutors } from '../src/executors';
import { call, id, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * (Ben, 31 Oct, build 493) "Why does this fail? Also the coach said this but then couldn't change everything still? It
 * should be more solution focused." Real SQLite, the scripted model, fake timers.
 *
 * - The Today chat's "Change my plan: does the plan train enough biceps throughout?" was forced into a whole-plan
 *   rebuild at high effort with a 20 s window to the first event (and between events): a reasoning model is silent
 *   while it thinks, so the step was cut off. Three times.
 * - Now: a targeted plan ask is answered with a targeted proposal, high-effort steps get 60 s, plan turns 120 s (90 s
 *   live), and one timeout gets one lighter retry that says it is the short answer.
 */

/** A scripted model whose steps each wait `delayMs` (on the test's fake clock) before their events. */
class DelayedModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: readonly { delayMs: number; events: readonly ModelEvent[] }[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1] ?? { delayMs: 0, events: [{ type: 'error', error: 'unavailable', detail: 'script exhausted' } as const] };
    if (step.delayMs > 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, step.delayMs);
        request.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    if (request.signal?.aborted === true) {
      yield { type: 'error', error: 'cancelled' };
      return;
    }
    for (const e of step.events) {
      await Promise.resolve();
      yield e;
    }
  }
  efforts(): (string | undefined)[] {
    return this.requests.map((r) => r.effort);
  }
}

let stores: Store[] = [];
async function store(): Promise<Store> {
  const s = await memoryStore();
  stores.push(s);
  return s;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(async () => {
  vi.useRealTimers();
  for (const s of stores) await s.close();
  stores = [];
});

/** Runs the turn, moving the fake clock a second at a time until it ends. */
async function settle(p: Promise<CoachTurnResult>): Promise<CoachTurnResult> {
  const state: { done: CoachTurnResult | null } = { done: null };
  void p.then((r) => {
    state.done = r;
  });
  for (let i = 0; i < 400 && state.done === null; i += 1) await vi.advanceTimersByTimeAsync(1000);
  if (state.done === null) throw new Error('turn never ended');
  return state.done;
}

const CURL = 'dumbbell-curl';
const HLR = 'bodyweight-hanging-leg-raise';
const ASK_1 = 'Change my plan: does the plan train enough biceps throughout?';
const ASK_2 = 'Can we just add them in after the raises. Can u fix the plan too?';

const planView = {
  today: '2026-10-31',
  inUse: {
    name: 'PPL',
    paused: null,
    days: [
      { name: 'Pull A', exercises: [{ catalogueId: 'pull-up', name: 'Pull-up' }, { catalogueId: HLR, name: 'Hanging leg raise' }] },
      { name: 'Pull B', exercises: [{ catalogueId: 'barbell-row', name: 'Barbell row' }] },
    ],
  },
};
const ctx = { session: null, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [], plan: planView };

const ADD: Extract<ActionDetail, { kind: 'propose_plan_swap' }> = {
  kind: 'propose_plan_swap',
  op: 'add',
  planId: id(500),
  planName: 'PPL',
  addId: CURL,
  addName: 'Dumbbell curl',
  afterId: HLR,
  afterName: 'Hanging leg raise',
  sets: 3,
  reps: { min: 10, max: 12 },
  load: null,
  days: [
    { routineId: id(501), routineName: 'Pull A', versionBefore: 3, edits: [{ kind: 'add', rowId: id(511), afterRowId: id(512), afterName: 'Hanging leg raise' }], before: ['Pull-up', 'Hanging leg raise'], after: ['Pull-up', 'Hanging leg raise', 'Dumbbell curl'] },
    { routineId: id(502), routineName: 'Pull B', versionBefore: 2, edits: [{ kind: 'add', rowId: id(513), afterRowId: null, afterName: null }], before: ['Barbell row'], after: ['Barbell row', 'Dumbbell curl'] },
  ],
  today: null,
};

function planExecutors(s: Store, seen: PlanAddRequest[] = []): CoachExecutors {
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null }),
    ...createPlanAddExecutor({
      store: s.repos.coach,
      prepare: (r): Promise<PlanSwapPrepared> => {
        seen.push(r);
        return Promise.resolve({ kind: 'ok', detail: ADD });
      },
    }),
  };
}

const addCall = (over: Partial<Record<string, unknown>> = {}): ModelEvent => call('propose_plan_add', { add: CURL, days: ['Pull A', 'Pull B'], after: HLR, workingSets: 3, reps: { min: 10, max: 12 }, load: null, reason: 'No direct biceps work in the plan.', ...over });
const GAP_REPLY = 'Biceps only get indirect work from pull-ups and rows. Curls on both pull days give them direct work.';

describe('timeouts that fit the work (ADR 0039 amendment, 31 Oct)', () => {
  it('the limits: 30 s live, 90 s live about the plan or two things, 120 s for a plan analysis elsewhere; 60 s per event at high effort', () => {
    expect(coachTurnTiming({ liveWorkout: true, words: 'make the rows heavier', buildInPlay: false })).toMatchObject({ totalMs: COACH_WORKOUT_TIMEOUT_MS, firstEventMs: 20_000, stallMs: 20_000, highEffortMs: COACH_HIGH_EFFORT_EVENT_MS });
    expect(coachTurnTiming({ liveWorkout: true, words: ASK_2, buildInPlay: false }).totalMs).toBe(COACH_WORKOUT_PLAN_TIMEOUT_MS);
    expect(coachTurnTiming({ liveWorkout: false, words: ASK_1, buildInPlay: false }).totalMs).toBe(COACH_PLAN_TIMEOUT_MS);
    expect(coachTurnTiming({ liveWorkout: false, words: 'Does my plan hit rear delts enough?', buildInPlay: false }).totalMs).toBe(COACH_PLAN_TIMEOUT_MS);
    expect(coachTurnTiming({ liveWorkout: false, words: 'hi', buildInPlay: false }).totalMs).toBeUndefined();
    expect([COACH_WORKOUT_TIMEOUT_MS, COACH_WORKOUT_PLAN_TIMEOUT_MS, COACH_PLAN_TIMEOUT_MS, COACH_HIGH_EFFORT_EVENT_MS]).toEqual([30_000, 90_000, 120_000, 60_000]);
  });

  it('root cause, case 1: with the old 20 s window a high-effort plan step that thinks for 40 s is cut off at the first event', async () => {
    const s = await store();
    const model = new DelayedModel([{ delayMs: 40_000, events: [addCall(), { type: 'completed' }] }]);
    const old: CoachTiming = { firstEventMs: 20_000, stallMs: 20_000, lightRetryMs: 0 };
    const r = await settle(runCoachTurn(request({ input: words(ASK_1), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)), timing: old }));
    expect(r).toMatchObject({ status: 'failed', error: 'timeout' });
    // Which timer fired is kept on the turn now (it wasn't before).
    expect(r.failure).toMatchObject({ kind: 'timeout', code: 'first_event' });
    expect((await s.repos.coach.getTurn(r.turnId))?.failure).toMatchObject({ code: 'first_event' });
  });

  it('a plan-analysis turn whose first event takes 40 s still answers, with the fix as a proposal card', async () => {
    const s = await store();
    const seen: PlanAddRequest[] = [];
    const model = new DelayedModel([
      { delayMs: 40_000, events: [addCall(), { type: 'completed' }] },
      { delayMs: 5_000, events: reply(GAP_REPLY) },
    ]);
    const progress: CoachTurnProgress[] = [];
    const timing = coachTurnTiming({ liveWorkout: false, words: ASK_1, buildInPlay: false });
    const r = await settle(runCoachTurn(request({ input: words(ASK_1), planInUse: true, context: ctx, onProgress: (p) => progress.push(p) }), { ...ports(s, model, planExecutors(s, seen)), timing }));
    expect(r.status).toBe('completed');
    expect(model.efforts()).toEqual(['high', 'high']);
    // Not forced into a whole-plan rebuild: the targeted tool, a proposal (rule 3).
    expect(model.requests[0]?.toolChoice).toBe('required');
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status])).toEqual([['propose_plan_swap', 'proposed']]);
    expect(seen).toEqual([{ add: CURL, days: ['Pull A', 'Pull B'], after: HLR, sets: 3, reps: { min: 10, max: 12 }, load: null }]);
    expect(r.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []))).toEqual(['Biceps only get indirect work from pull-ups and rows.', 'Curls on both pull days give them direct work.']);
    expect(r.note).toBeNull();
    // The sheet shows `Thinking…` for the high-effort step.
    expect(progress).toContainEqual({ kind: 'thinking', mode: 'hard' });
  });
});

describe('one timeout gets one lighter retry; never silent failures in a row', () => {
  it('a timeout leads to an automatic lighter retry (low effort, answer now) that says it is the short answer', async () => {
    const s = await store();
    const model = new DelayedModel([
      // Thinks past even the high-effort window.
      { delayMs: 70_000, events: [addCall(), { type: 'completed' }] },
      { delayMs: 2_000, events: reply('Short version: no direct biceps work. Add curls to both pull days.') },
    ]);
    const timing = coachTurnTiming({ liveWorkout: false, words: ASK_1, buildInPlay: false });
    const progress: CoachTurnProgress[] = [];
    const r = await settle(runCoachTurn(request({ input: words(ASK_1), planInUse: true, context: ctx, onProgress: (p) => progress.push(p) }), { ...ports(s, model, planExecutors(s)), timing }));
    expect(r.status).toBe('completed');
    expect(model.efforts()).toEqual(['high', 'low']);
    const retryInput = model.requests[1]?.input ?? [];
    expect(retryInput.some((i) => i.type === 'message' && i.content === LIGHT_RETRY_LINE)).toBe(true);
    // No forcing on the retry, and its answer is labelled (rule 1).
    expect(model.requests[1]?.toolChoice).toBe('required');
    expect(r.note).toBe(SHORT_ANSWER_NOTE);
    expect(r.failure).toMatchObject({ kind: 'timeout', code: 'first_event' });
    expect(r.toolLog.some((l) => l.tool === 'timeout' && l.outcome === 'failed')).toBe(true);
    expect(progress).toContainEqual({ kind: 'thinking', mode: 'short' });
  });

  it('when the retry times out too the turn fails once, honestly: two requests, never a third', async () => {
    const s = await store();
    const model = new DelayedModel([
      { delayMs: 70_000, events: reply('late') },
      { delayMs: 70_000, events: reply('late again') },
      { delayMs: 0, events: reply('never asked') },
    ]);
    const timing = coachTurnTiming({ liveWorkout: false, words: ASK_1, buildInPlay: false });
    const r = await settle(runCoachTurn(request({ input: words(ASK_1), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)), timing }));
    expect(r).toMatchObject({ status: 'failed', error: 'timeout', items: [] });
    expect(model.requests).toHaveLength(2);
    expect(r.failure?.kind).toBe('timeout');
  });

  it('a live turn past its whole-turn cap: the lighter retry answers in its own budget', async () => {
    const s = await store();
    // Each step starts inside its window, but the turn as a whole runs past 30 s.
    const model = new DelayedModel([
      { delayMs: 19_000, events: [call('get_recent_actions', { limit: 3 }), { type: 'completed' }] },
      { delayMs: 19_000, events: reply('late') },
      { delayMs: 1_000, events: reply('Keep the rows as they are.') },
    ]);
    const timing = coachTurnTiming({ liveWorkout: true, words: 'are the rows ok?', buildInPlay: false });
    const r = await settle(runCoachTurn(request({ kind: 'general', input: words('are the rows ok?'), context: ctx }), { ...ports(s, model, planExecutors(s)), timing }));
    expect(r.status).toBe('completed');
    expect(r.failure).toMatchObject({ code: 'turn_cap' });
    expect(r.note).toBe(SHORT_ANSWER_NOTE);
  });
});

describe('asked, solution-first', () => {
  it('"Can u fix the plan too?" counts as asked for a plan proposal; a rebuild is something else', () => {
    expect(asksPlanFix('Can u fix the plan too?')).toBe(true);
    expect(asksPlanFix(ASK_2)).toBe(true);
    expect(asksPlanFix('sort my plan as well')).toBe(true);
    expect(asksPlanFix('add curls to my plan')).toBe(true);
    expect(asksPlanFix('what do you think of my plan?')).toBe(false);
    expect(asksPlanFix('don’t change my plan')).toBe(false);
    expect(asksPlanRebuild('change my plan to 4 days')).toBe(true);
    expect(asksPlanRebuild('make it a PPL split')).toBe(true);
    expect(asksPlanRebuild(ASK_1)).toBe(false);
    expect(asksPlanRebuild(ASK_2)).toBe(false);
    expect(planLevelAsk(ASK_1)).toBe(true);
    expect(planLevelAsk('Why are we not training biceps or arms')).toBe(false);
    // Today's part: an add with a place.
    expect(asksLiveChange('Can we just add them in after the raises.')).toBe(true);
    expect(asksLiveChange('put curls in at the end')).toBe(true);
    expect(asksLiveChange('add curls after rows in my plan')).toBe(false);
  });

  it('a plan ask answered in words only is asked once for the plan proposal (or the same answer when nothing needs changing)', async () => {
    const s = await store();
    const model = new DelayedModel([
      { delayMs: 0, events: reply(GAP_REPLY) },
      { delayMs: 0, events: [addCall(), { type: 'completed' }] },
      { delayMs: 0, events: reply('ignored') },
    ]);
    const r = await settle(runCoachTurn(request({ input: words('Can u fix the plan too?'), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)), timing: coachTurnTiming({ liveWorkout: false, words: 'Can u fix the plan too?', buildInPlay: false }) }));
    expect(r.status).toBe('completed');
    const fed = (model.requests[1]?.input ?? []).flatMap((i) => (i.type === 'function_call_output' ? [(JSON.parse(i.output) as { line?: string }).line] : []));
    expect(fed).toContain(PLAN_PART_NUDGE_LINE);
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    // The held answer isn't shown twice: the final reply is the one shown.
    expect(r.items.filter((i) => i.kind === 'sentence')).toHaveLength(1);
  });

  it('a plan ask where nothing needs changing: the coach says so, and the turn still completes', async () => {
    const s = await store();
    const model = new DelayedModel([
      { delayMs: 0, events: reply('Biceps get plenty from the curls already on Pull B.') },
      { delayMs: 0, events: reply('Biceps get plenty from the curls already on Pull B.') },
    ]);
    const r = await settle(runCoachTurn(request({ input: words(ASK_1), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)) }));
    expect(r.status).toBe('completed');
    expect(r.cards).toEqual([]);
    expect(model.requests).toHaveLength(2);
  });

  it('a gap answer ending "Want me to …?" comes with the fix as a card, and the question goes', async () => {
    const s = await store();
    const model = new DelayedModel([
      { delayMs: 0, events: reply('There’s no direct curl work, so arms lag. Want me to add curls to both pull days in your plan?') },
      { delayMs: 0, events: [addCall(), { type: 'completed' }] },
      { delayMs: 0, events: reply('') },
    ]);
    const r = await settle(runCoachTurn(request({ input: words('Why are we not training biceps or arms'), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)) }));
    expect(r.status).toBe('completed');
    const fed = (model.requests[1]?.input ?? []).flatMap((i) => (i.type === 'function_call_output' ? [(JSON.parse(i.output) as { line?: string }).line] : []));
    expect(fed).toContain(SOLUTION_NUDGE_LINE);
    // The offer is the card (Apply / Skip), not a question (rule 3: nothing applied).
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status])).toEqual([['propose_plan_swap', 'proposed']]);
    expect(r.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []))).toEqual(['There’s no direct curl work, so arms lag.']);
  });

  it('if making the card fails, the full answer (question and all) still shows: never a failure after a good answer', async () => {
    const s = await store();
    const model = new DelayedModel([{ delayMs: 0, events: reply('No direct curl work. Want me to add curls to both pull days in your plan?') }, { delayMs: 0, events: [{ type: 'error', error: 'unavailable' }] }]);
    const r = await settle(runCoachTurn(request({ input: words('Why are we not training biceps or arms'), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)) }));
    expect(r.status).toBe('completed');
    expect(r.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []))).toEqual(['No direct curl work.', 'Want me to add curls to both pull days in your plan?']);
  });

  it('pure readings: a fix offer; a load kept only when Ben named it', () => {
    expect(isFixOffer('Want me to swap hanging leg raises for curls today?')).toBe(true);
    expect(isFixOffer('Want me to explain why?')).toBe(false);
    expect(namedLoadIn(12, 'add curls at 12 kg after the raises')).toBe(12);
    expect(namedLoadIn(12, 'add curls after the raises')).toBeNull();
    expect(namedLoadIn(12.5, 'curls at 12,5')).toBe(12.5);
  });
});

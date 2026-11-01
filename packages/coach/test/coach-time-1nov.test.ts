import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { ActionDetail } from '@fizz/schemas';

import type { CoachModelPort, ModelEvent, ModelRequest } from '../src/model-port';
import { createPlanDayEditExecutor, type PlanDayEditRequest, type PlanSwapPrepared } from '../src/plan-swap';
import { asksDeepAnalysis, asksLiveChange, asksPlanDayChange, asksPlanFix, planLevelAsk } from '../src/request';
import { planWorkContext, requestChars, type CoachContextInput } from '../src/context';
import { COACH_PLAN_WORK_CAP_MS, SHORT_ANSWER_NOTE, coachTurnTiming, runCoachTurn, type CoachTurnProgress, type CoachTurnResult } from '../src/turn';
import { createStoreExecutors, type CoachExecutors } from '../src/executors';
import { call, id, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * (Ben, 1 Nov, build 500) "Still running out of time which I don't want for changing plans." From a live Push B chat
 * his plan question got "Short answer (ran out of time)", and his two-part ask a failure card and a turn still thinking.
 * Real SQLite, a scripted model, fake timers.
 */

/** A scripted model whose steps each wait `delayMs` on the fake clock before their events. */
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

/** Runs the turn, moving the fake clock a second at a time until it ends; the seconds it took. */
async function settle(p: Promise<CoachTurnResult>): Promise<{ r: CoachTurnResult; seconds: number }> {
  const state: { done: CoachTurnResult | null } = { done: null };
  void p.then((r) => {
    state.done = r;
  });
  let i = 0;
  for (; i < 600 && state.done === null; i += 1) await vi.advanceTimersByTimeAsync(1000);
  if (state.done === null) throw new Error('turn never ended');
  return { r: state.done, seconds: i };
}

const PRESS = 'dumbbell-shoulder-press';
const BENCH = 'dumbbell-bench-press';
const INCLINE = 'incline-dumbbell-press';
const RAISE = 'bodyweight-hanging-leg-raise';
const ASK_PLAN = 'Push B should be different since shoulders are pre-fatigued';
const ASK_TWO = "Let's stick to 100 as easier to take off plates. I think we didn't adjust the plan considering the shoulders I just trained? Going forwards plan B should be slightly different?";
const ASK_Q = 'Should the plan change? Push B is shoulder-led and bench comes after';

const planView = {
  today: '2026-11-01',
  inUse: {
    name: 'PPL',
    paused: null,
    days: [
      { name: 'Push B', exercises: [{ catalogueId: PRESS, name: 'Dumbbell shoulder press', sets: 3, reps: '6', main: true }, { catalogueId: INCLINE, name: 'Incline dumbbell press', sets: 3, reps: '8–12' }, { catalogueId: BENCH, name: 'Dumbbell bench press', sets: 2, reps: '8–12' }, { catalogueId: RAISE, name: 'Hanging leg raise', sets: 2, reps: '8–12' }] },
    ],
  },
};
const ctx: CoachContextInput = { turnKind: 'general', thread: [], session: null, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [{ exerciseId: 'bench', name: 'Bench', cues: ['Feet down', 'Bar to chest'] }], plan: planView };

const DAY_EDIT: Extract<ActionDetail, { kind: 'propose_plan_swap' }> = {
  kind: 'propose_plan_swap',
  op: 'day_edit',
  planId: id(600),
  planName: 'PPL',
  addId: BENCH,
  addName: 'Dumbbell bench press',
  days: [{ routineId: id(601), routineName: 'Push B', versionBefore: 2, edits: [{ kind: 'edit', rowId: id(611) }], before: ['Dumbbell shoulder press', 'Incline dumbbell press', 'Dumbbell bench press', 'Hanging leg raise'], after: ['Dumbbell bench press', 'Dumbbell shoulder press', 'Incline dumbbell press', 'Hanging leg raise'] }],
  dayEdit: { order: [id(613), id(611), id(612), id(614)], rows: [{ rowId: id(611), main: false, targetRpe: 7 }], lines: ['Order: Dumbbell bench press, Dumbbell shoulder press, Incline dumbbell press, Hanging leg raise', 'Dumbbell shoulder press: RPE 8 → 7 · secondary'] },
  today: null,
};

function planExecutors(s: Store, seen: PlanDayEditRequest[] = []): CoachExecutors {
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null }),
    ...createPlanDayEditExecutor({
      store: s.repos.coach,
      prepare: (r): Promise<PlanSwapPrepared> => {
        seen.push(r);
        return Promise.resolve({ kind: 'ok', detail: DAY_EDIT });
      },
    }),
  };
}

const dayEditCall = (): ModelEvent => call('propose_plan_day_edit', { day: 'Push B', order: [BENCH, PRESS, INCLINE, RAISE], changes: [{ exercise: PRESS, workingSets: null, reps: null, targetRpe: 7, main: false, load: null }], reason: 'Bench first while fresh; the press after it.' });

describe('plan work has no visible time limit (Ben, 1 Nov)', () => {
  it('a plan turn whose first event takes 90 s and which completes at 3 min still succeeds, with no short answer', async () => {
    const s = await store();
    const model = new DelayedModel([
      { delayMs: 90_000, events: [dayEditCall(), { type: 'completed' }] },
      { delayMs: 85_000, events: reply('Bench goes first while you’re fresh; the press comes after it as a secondary lift.') },
    ]);
    const progress: CoachTurnProgress[] = [];
    const timing = coachTurnTiming({ liveWorkout: true, words: ASK_PLAN, buildInPlay: false });
    const { r, seconds } = await settle(runCoachTurn(request({ input: words(ASK_PLAN), planInUse: true, context: ctx, onProgress: (p) => progress.push(p) }), { ...ports(s, model, planExecutors(s)), timing }));
    expect(r.status).toBe('completed');
    expect(seconds).toBeGreaterThanOrEqual(175);
    expect(seconds).toBeLessThan(COACH_PLAN_WORK_CAP_MS / 1000);
    expect(r.note).not.toBe(SHORT_ANSWER_NOTE);
    expect(r.failure ?? null).toBeNull();
    expect(model.requests).toHaveLength(2);
    // Medium effort for a plan proposal (he didn't ask for the deep version); `Thinking…` with its timer.
    expect(model.requests.map((q) => q.effort)).toEqual(['medium', 'medium']);
    expect(progress).toContainEqual({ kind: 'thinking', mode: 'hard' });
    expect(progress).not.toContainEqual({ kind: 'thinking', mode: 'short' });
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status])).toEqual([['propose_plan_swap', 'proposed']]);
  });

  it('if plan work truly fails it fails once, honestly: no short-answer retry', async () => {
    const s = await store();
    const model = new DelayedModel([{ delayMs: 400_000, events: reply('too late') }, { delayMs: 0, events: reply('never asked') }]);
    const timing = coachTurnTiming({ liveWorkout: false, words: ASK_Q, buildInPlay: false });
    const { r, seconds } = await settle(runCoachTurn(request({ input: words(ASK_Q), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)), timing }));
    expect(r).toMatchObject({ status: 'failed', error: 'timeout' });
    expect(model.requests).toHaveLength(1);
    expect(r.note).not.toBe(SHORT_ANSWER_NOTE);
    expect(seconds).toBeLessThanOrEqual(COACH_PLAN_WORK_CAP_MS / 1000 + 1);
  });

  it('a simple today edit is still capped quickly', async () => {
    const s = await store();
    const model = new DelayedModel([{ delayMs: 400_000, events: reply('late') }, { delayMs: 400_000, events: reply('late') }]);
    const timing = coachTurnTiming({ liveWorkout: true, words: 'make the rows heavier', buildInPlay: false });
    expect(timing.planEventMs).toBeUndefined();
    const { r, seconds } = await settle(runCoachTurn(request({ input: words('make the rows heavier'), context: ctx }), { ...ports(s, model, planExecutors(s)), timing }));
    expect(r).toMatchObject({ status: 'failed', error: 'timeout' });
    // 20 s to the first event, then the lighter retry's own 25 s: well under a minute.
    expect(seconds).toBeLessThan(60);
  });

  it('plan work: a 30 s silent start is fine now (the 20 s window cut it off before)', async () => {
    const s = await store();
    const model = new DelayedModel([{ delayMs: 30_000, events: reply('late') }]);
    const timing = coachTurnTiming({ liveWorkout: true, words: ASK_TWO, buildInPlay: false });
    expect(timing.totalMs).toBe(COACH_PLAN_WORK_CAP_MS);
    const { r } = await settle(runCoachTurn(request({ input: words(ASK_TWO), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)), timing }));
    expect(r.failure?.code).not.toBe('first_event');
  });

  it('"think it through properly" is the deep version: high effort', async () => {
    const s = await store();
    const deep = `${ASK_PLAN}, think it through properly`;
    const model = new DelayedModel([{ delayMs: 0, events: [dayEditCall(), { type: 'completed' }] }, { delayMs: 0, events: reply('Bench first.') }]);
    await settle(runCoachTurn(request({ input: words(deep), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s)), timing: coachTurnTiming({ liveWorkout: false, words: deep, buildInPlay: false }) }));
    expect(model.requests[0]?.effort).toBe('high');
  });
});

describe('plan turns are smaller (Ben, 1 Nov)', () => {
  it('a targeted plan turn leaves out the build tools and view, the addable list and exercise cues: fewer characters sent', async () => {
    const s = await store();
    const big = { ...ctx, build: { request: 'x'.repeat(8000) } as unknown as NonNullable<CoachContextInput['build']>, addable: Array.from({ length: 40 }, (_, i) => ({ exerciseId: `ex-${String(i)}`, name: `Exercise ${String(i)}`, equipment: 'Dumbbells', muscles: ['chest'] })) as unknown as NonNullable<CoachContextInput['addable']> };
    const trimmed = planWorkContext(big, { keepAddable: false });
    expect(trimmed.build).toBeUndefined();
    expect(trimmed.addable).toBeUndefined();
    expect(trimmed.catalogue).toEqual([]);
    expect(trimmed.plan).toEqual(big.plan);
    // The turn sends the trimmed context, and no whole-workout or whole-plan build tool.
    const model = new DelayedModel([{ delayMs: 0, events: [dayEditCall(), { type: 'completed' }] }, { delayMs: 0, events: reply('Bench first.') }]);
    const general = new DelayedModel([{ delayMs: 0, events: reply('Hi.') }]);
    await settle(runCoachTurn(request({ input: words(ASK_PLAN), planInUse: true, buildAvailable: true, context: big }), { ...ports(s, model, planExecutors(s)), timing: coachTurnTiming({ liveWorkout: false, words: ASK_PLAN, buildInPlay: false }) }));
    await settle(runCoachTurn(request({ input: words('Push day today, about 50 min'), planInUse: true, buildAvailable: true, context: big }), { ...ports(s, general, planExecutors(s)) }));
    const plan = model.requests[0];
    const other = general.requests[0];
    if (plan === undefined || other === undefined) throw new Error('no request');
    expect(plan.tools.map((t) => t.name)).toContain('propose_plan_day_edit');
    expect(plan.tools.map((t) => t.name)).not.toEqual(expect.arrayContaining(['propose_workout']));
    const yourData = plan.input.find((i) => i.type === 'message' && i.content.startsWith('YOUR DATA'));
    expect(yourData?.type === 'message' && yourData.content.includes('"build"')).toBe(false);
    expect(yourData?.type === 'message' && yourData.content.includes('"addable"')).toBe(false);
    // The token proxy: about 4 characters a token. The plan turn sends well under the other turn's size.
    expect(requestChars(plan)).toBeLessThan(requestChars(other) * 0.8);
  });
});

describe('Ben’s words (1 Nov)', () => {
  it('his plan asks read as plan work; "stick to 100" is today’s change; the deep version is asked for', () => {
    expect(asksPlanDayChange(ASK_PLAN)).toBe(true);
    expect(asksPlanDayChange(ASK_TWO)).toBe(true);
    expect(asksPlanFix(ASK_TWO)).toBe(true);
    expect(planLevelAsk(ASK_Q)).toBe(true);
    expect(planLevelAsk(ASK_PLAN)).toBe(true);
    expect(asksLiveChange("Let's stick to 100 as easier to take off plates.")).toBe(true);
    expect(asksLiveChange('keep it at 22.5')).toBe(true);
    expect(asksPlanDayChange('push b was good today')).toBe(false);
    expect(asksPlanDayChange('don’t change Push B')).toBe(false);
    expect(asksDeepAnalysis('think it through properly')).toBe(true);
    expect(asksDeepAnalysis(ASK_PLAN)).toBe(false);
  });

  it('propose_plan_day_edit is a proposal; a weight the coach made up is dropped (rule 4)', async () => {
    const s = await store();
    const seen: PlanDayEditRequest[] = [];
    const model = new DelayedModel([
      { delayMs: 0, events: [call('propose_plan_day_edit', { day: 'Push B', order: null, changes: [{ exercise: BENCH, workingSets: 2, reps: null, targetRpe: 7, main: false, load: 32 }], reason: 'Bench after the press: lighter.' }), { type: 'completed' }] },
      { delayMs: 0, events: reply('Bench as a secondary lift.') },
    ]);
    const { r } = await settle(runCoachTurn(request({ input: words(ASK_PLAN), planInUse: true, context: ctx }), { ...ports(s, model, planExecutors(s, seen)), timing: coachTurnTiming({ liveWorkout: false, words: ASK_PLAN, buildInPlay: false }) }));
    expect(r.status).toBe('completed');
    expect(seen).toEqual([{ day: 'Push B', order: null, changes: [{ exercise: BENCH, sets: 2, reps: null, targetRpe: 7, main: false, load: null }] }]);
    expect(r.cards[0]?.record.status).toBe('proposed');
    expect(r.cards[0]?.rendered.text).toBe('Every week: Push B: Order: Dumbbell bench press, Dumbbell shoulder press, Incline dumbbell press, Hanging leg raise; Dumbbell shoulder press: RPE 8 → 7 · secondary.');
  });
});

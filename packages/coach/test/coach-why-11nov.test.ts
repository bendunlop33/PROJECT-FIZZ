import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Store } from '@fizz/persistence';

import type { CoachModelPort, ModelEvent, ModelRequest } from '../src/model-port';
import { asksPlanSettingChange } from '../src/plan-change';
import { plainWhyQuestion } from '../src/request';
import {
  COACH_INSTRUCTIONS,
  COACH_LIGHT_RETRY_CHAT_MS,
  COACH_LIGHT_RETRY_MS,
  COACH_MEDIUM_EFFORT_EVENT_MS,
  COACH_WORKOUT_TIMEOUT_MS,
  SHORT_ANSWER_NOTE,
  WHY_RULE_LINE,
  coachTurnTiming,
  runCoachTurn,
  type CoachTurnResult,
} from '../src/turn';
import { call, memoryStore, ports, reply, request, words } from './turn-fixtures';

/**
 * (Ben, 11 Nov, build 564, coach on Today, ChatGPT plan) "Why did you give me pull on Tuesday?": first `No answer in
 * time. Nothing changed.`, then "I can't verify why it was originally placed there". A one-line why is now low effort
 * and answered from the week's schedule fact; a medium step gets 45 s of silence before it is cut off; the chat's
 * lighter retry has room for one read and its answer. Fake timers, the scripted model.
 */

const WHY = 'Why did you give me pull on Tuesday?';

/** Each step waits `delayMs` (fake clock) before its events; Stop and the timers abort the wait. */
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

async function settle(p: Promise<CoachTurnResult>): Promise<CoachTurnResult> {
  const state: { done: CoachTurnResult | null } = { done: null };
  void p.then((r) => {
    state.done = r;
  });
  for (let i = 0; i < 400 && state.done === null; i += 1) await vi.advanceTimersByTimeAsync(1000);
  if (state.done === null) throw new Error('turn never ended');
  return state.done;
}

const SCHEDULE = ['Push A: done Mon 9 Nov', 'Pull A: scheduled Tue 10 Nov · missed: nothing logged that day and no free plan day left this week', "Today's card: Up next = Legs A: the only day left this week."];
const ctx = {
  session: null,
  gymName: 'Main Gym',
  painFlags: [],
  checkIn: null,
  memories: [],
  catalogue: [],
  week: { today: '2026-11-11', weekday: 'Wed', aim: 4, gymDaysDone: 1, gymDaysLeft: 2, daysFrom: 'plan' as const, remaining: [], activities: [], needsReshape: false, suggestion: null, applied: null, schedule: SCHEDULE },
};

describe('a short why question (Ben, 11 Nov)', () => {
  it('plainWhyQuestion: one short why with nothing to change; not a change, a plan ask, two sentences or a training question', () => {
    expect(plainWhyQuestion(WHY)).toBe(true);
    expect(plainWhyQuestion('how come legs is up next?')).toBe(true);
    expect(plainWhyQuestion('So why is push B on Wednesday')).toBe(true);
    expect(plainWhyQuestion('how often should I train?')).toBe(false);
    expect(plainWhyQuestion('Why did you give me pull on Tuesday? Move it to Thursday.')).toBe(false);
    expect(plainWhyQuestion('why not drop the weight on bench')).toBe(false);
    expect(plainWhyQuestion('why does my plan not train enough biceps?')).toBe(false);
    expect(plainWhyQuestion('why ' + 'really '.repeat(20) + 'pull?')).toBe(false);
    expect(plainWhyQuestion('why don’t we do pull on Thursday')).toBe(false);
  });

  it('the bug: "on Tuesday" read the why as a Set days change (plan work: medium, the reply held for a plan card, no retry); a why never is', () => {
    expect(asksPlanSettingChange(WHY)).toBe(false);
    expect(asksPlanSettingChange('why is next week a deload?')).toBe(false);
    expect(asksPlanSettingChange('move pull to Tuesday and train on Thursday')).toBe(true);
    expect(asksPlanSettingChange('why not train on Tuesdays and Thursdays')).toBe(true);
  });

  it('the why turn is sent at low effort on the main model, with the week schedule fact in YOUR DATA and the why-rule line', async () => {
    const s = await store();
    const model = new DelayedModel([{ delayMs: 1_000, events: reply('Pull A is on Tuesdays in your plan; nothing was logged that day, so it shows missed.') }]);
    const timing = coachTurnTiming({ liveWorkout: false, words: WHY, buildInPlay: false });
    const r = await settle(runCoachTurn(request({ input: words(WHY), planInUse: true, context: ctx, workoutModel: 'gpt-6-mini' }), { ...ports(s, model), timing }));
    expect(r.status).toBe('completed');
    expect(model.requests.map((q) => [q.model, q.effort])).toEqual([['gpt-6.1-sol', 'low']]);
    const data = model.requests[0]?.input.find((i) => i.type === 'message' && i.content.startsWith('YOUR DATA'));
    const parsed = data?.type === 'message' ? (JSON.parse(data.content.slice(data.content.indexOf('\n') + 1)) as { week?: { schedule?: string[] } }) : {};
    expect(parsed.week?.schedule).toEqual(SCHEDULE);
    expect(model.requests[0]?.instructions).toContain(WHY_RULE_LINE);
    expect(WHY_RULE_LINE).toContain('week.schedule');
    expect(COACH_INSTRUCTIONS).toContain('never "I can’t verify"');
  });

  it('a training question stays medium', async () => {
    const s = await store();
    const model = new DelayedModel([{ delayMs: 0, events: reply('Two or three times a week.') }]);
    await settle(runCoachTurn(request({ input: words('how often should I train?'), context: ctx }), { ...ports(s, model), timing: coachTurnTiming({ liveWorkout: false, words: 'how often should I train?', buildInPlay: false }) }));
    expect(model.requests.map((q) => q.effort)).toEqual(['medium']);
  });

  it('budgets: chat medium window 45 s (was 20 s), chat retry 45 s (was 25 s); a live workout keeps 30 s and 25 s', () => {
    const chat = coachTurnTiming({ liveWorkout: false, words: WHY, buildInPlay: false });
    expect(chat).toMatchObject({ firstEventMs: 20_000, stallMs: 20_000, mediumEffortMs: COACH_MEDIUM_EFFORT_EVENT_MS, lightRetryMs: COACH_LIGHT_RETRY_CHAT_MS });
    expect(chat.totalMs).toBeUndefined();
    expect(COACH_MEDIUM_EFFORT_EVENT_MS).toBe(45_000);
    expect(COACH_LIGHT_RETRY_CHAT_MS).toBe(45_000);
    const live = coachTurnTiming({ liveWorkout: true, words: WHY, buildInPlay: false });
    expect(live.totalMs).toBe(COACH_WORKOUT_TIMEOUT_MS);
    expect(live.lightRetryMs ?? COACH_LIGHT_RETRY_MS).toBe(25_000);
  });

  it('a medium step silent for 30 s (thinking) is not cut off any more', async () => {
    const s = await store();
    const model = new DelayedModel([{ delayMs: 30_000, events: reply('Two or three times a week.') }]);
    const r = await settle(runCoachTurn(request({ input: words('how often should I train?'), context: ctx }), { ...ports(s, model), timing: coachTurnTiming({ liveWorkout: false, words: 'how often should I train?', buildInPlay: false }) }));
    expect(r.status).toBe('completed');
    expect(model.requests).toHaveLength(1);
    expect(r.note).toBeNull();
  });

  it('a timed-out why still answers on the retry when it reads first: one read and its answer fit the chat retry', async () => {
    const s = await store();
    const model = new DelayedModel([
      // Low effort: past the 20 s window.
      { delayMs: 25_000, events: reply('late') },
      // The retry reads, then answers: 18 s + 18 s (the old 25 s budget ran out here).
      { delayMs: 18_000, events: [call('get_recent_actions', { limit: 3 }), { type: 'completed' }] },
      { delayMs: 18_000, events: reply('Pull A is on Tuesdays in your plan.') },
    ]);
    const r = await settle(runCoachTurn(request({ input: words(WHY), context: ctx }), { ...ports(s, model), timing: coachTurnTiming({ liveWorkout: false, words: WHY, buildInPlay: false }) }));
    expect(r.status).toBe('completed');
    expect(model.requests.map((q) => q.effort)).toEqual(['low', 'low', 'low']);
    expect(r.note).toBe(SHORT_ANSWER_NOTE);
  });
});

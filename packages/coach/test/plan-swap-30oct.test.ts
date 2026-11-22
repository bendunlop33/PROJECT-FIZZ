import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { ActionDetail, SessionAggregate } from '@fizz/schemas';

import { createSessionReadExecutor, createStoreExecutors, type CoachExecutors } from '../src/executors';
import { createEditTodayExecutor } from '../src/edit-today';
import { createPlanSwapExecutor, offerContinuationOf, PLAN_ASK_LINE, planScopeOf, threadPlanScope, type PlanSwapPrepared } from '../src/plan-swap';
import { createReplyFilter, noToolAim, WEEK_ASK_LINE } from '../src/reply';
import { runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { call, id, memoryStore, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * (Ben, 30 Oct, build 486) The live workout's chat: "swap leg press and leg extension across the plan" got "Want me
 * to change this week?" and "Nothing changed · 1 line hidden", "Yes" the same, "full plan" the same. The turn engine
 * with the scripted model and real SQLite: the plan swap is offered in every chat with a plan in use, it comes back
 * as a proposal, the hidden line's replacement matches the ask, and "Yes" to the coach's own offer acts.
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

const LP = 'machine-leg-press';
const LE = 'machine-leg-extension';
const SWAP: Extract<ActionDetail, { kind: 'propose_plan_swap' }> = {
  kind: 'propose_plan_swap',
  planId: id(500),
  planName: 'Strength block',
  removeId: LE,
  removeName: 'Leg extension',
  addId: LP,
  addName: 'Leg press',
  days: [
    { routineId: id(501), routineName: 'Legs A', versionBefore: 4, edits: [{ kind: 'swap', rowId: id(511) }] },
    { routineId: id(502), routineName: 'Legs B', versionBefore: 2, edits: [{ kind: 'remove', rowId: id(512) }] },
  ],
  flipped: true,
};

async function live(s: Store, prepare: (r: { remove: string; add: string }) => Promise<PlanSwapPrepared>): Promise<CoachExecutors> {
  const r = await s.repos.sessions.save(workout(), null);
  if (!r.ok) throw new Error('save failed');
  const load = () => s.repos.sessions.get(SESSION);
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null }),
    get_active_session: createSessionReadExecutor({ loadSession: load, gymName: 'Main Gym' }),
    edit_today: createEditTodayExecutor({ store: s.repos.coach, loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
    ...createPlanSwapExecutor({ store: s.repos.coach, prepare }),
  };
}

const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [], plan: { today: '2026-10-30', inUse: { name: 'Strength block', paused: null, days: [{ name: 'Legs A', exercises: [{ catalogueId: LE, name: 'Leg extension' }] }, { name: 'Legs B', exercises: [{ catalogueId: LP, name: 'Leg press' }, { catalogueId: LE, name: 'Leg extension' }] }] } }, notPreferred: [{ catalogueId: LE, name: 'Leg extension' }] });
const say = (text: string) => ({ kind: 'workout' as const, input: words(text), context: ctx(workout()), planInUse: true, week: true });
const sentences = (r: { items: readonly { kind: string; text?: string }[] }) => r.items.flatMap((i) => (i.kind === 'sentence' && i.text !== undefined ? [i.text] : []));

describe('Ben’s live-workout chat: the plan swap from any chat', () => {
  it('"swap leg press and leg extension in the full plan": offered on a workout turn, with notPreferred in YOUR DATA; a proposal card, never applied', async () => {
    const s = await store();
    const asked: { remove: string; add: string }[] = [];
    const ex = await live(s, (r) => {
      asked.push(r);
      return Promise.resolve({ kind: 'ok', detail: SWAP });
    });
    // The model reads it the wrong way round (leg press out); the app's port turns it round (leg extension not preferred).
    const model = new ScriptedCoachModel([[call('propose_plan_swap', { remove: LP, add: LE, reason: 'Ben asked to swap them in his plan.' }), { type: 'completed' }], reply('Here it is for every week.')]);
    const r = await runCoachTurn(request(say('swap leg press and leg extension in the full plan')), ports(s, model, ex));
    expect(model.requests[0]?.tools.map((t) => t.name)).toContain('propose_plan_swap');
    expect(model.requests[0]?.instructions).toContain('call propose_plan_swap in this turn');
    const data = model.requests[0]?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
    expect(data?.type === 'message' ? data.content : '').toContain('"notPreferred"');
    expect(asked).toEqual([{ remove: LP, add: LE }]);
    expect(r.cards.map((c) => [c.record.detail.kind, c.record.status])).toEqual([['propose_plan_swap', 'proposed']]);
    expect(sentences(r).join(' ')).not.toContain('change this week');
    expect(r.note).toBeNull();
  });

  it('the model says it can’t change the full plan from here: hidden, one plan offer (never the week’s line)', async () => {
    const s = await store();
    const ex = await live(s, () => Promise.resolve({ kind: 'ok', detail: SWAP }));
    const model = new ScriptedCoachModel([reply("You want leg press replaced with leg extensions throughout your full plan. I can't change your full plan from this chat.")]);
    const r = await runCoachTurn(request(say('Can we swap leg press for leg extension across the full plan')), ports(s, model, ex));
    const text = sentences(r).join(' ');
    expect(text).not.toContain(WEEK_ASK_LINE);
    expect(text).not.toContain("can't change");
    expect(text).toContain(PLAN_ASK_LINE);
  });

  it('"Yes" to the coach’s offer is the request: the plan tool is offered and told to act; the swap is proposed', async () => {
    const s = await store();
    const ex = await live(s, () => Promise.resolve({ kind: 'ok', detail: SWAP }));
    const first = new ScriptedCoachModel([reply("I can't change your full plan from this chat.")]);
    const r1 = await runCoachTurn(request(say('Can we swap leg press for leg extension across the full plan')), ports(s, first, ex));
    expect(sentences(r1)).toContain(PLAN_ASK_LINE);
    const second = new ScriptedCoachModel([[call('propose_plan_swap', { remove: LE, add: LP, reason: 'He said yes.' }), { type: 'completed' }], reply('Here you go.')]);
    const r2 = await runCoachTurn(request({ ...say('Yes'), threadId: r1.threadId, turnId: id(80_001) }), ports(s, second, ex));
    expect(second.requests[0]?.instructions).toContain('answers your last offer');
    expect(second.requests[0]?.instructions).toContain(PLAN_ASK_LINE);
    expect(r2.cards.map((c) => c.record.detail.kind)).toEqual(['propose_plan_swap']);
    expect(sentences(r2).join(' ')).not.toContain('change this week');
  });

  it('a swap that can’t be proposed: one honest line on its card, the coach told why; never "Nothing changed" on a loop', async () => {
    const s = await store();
    const ex = await live(s, () => Promise.resolve({ kind: 'refused', line: 'Leg extension is not preferred in your plan settings', names: { remove: 'Hack squat', add: 'Leg extension' } }));
    const model = new ScriptedCoachModel([[call('propose_plan_swap', { remove: 'machine-hack-squat', add: LE, reason: 'x' }), { type: 'completed' }], reply('Leg extension is marked not preferred in your plan settings.')]);
    const r = await runCoachTurn(request(say('put leg extension in instead of hack squat across my plan')), ports(s, model, ex));
    const out = model.requests[1]?.input.find((i) => i.type === 'function_call_output');
    expect(out?.type === 'function_call_output' ? out.output : '').toContain('not preferred');
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['rejected', 'Not changed: Leg extension is not preferred in your plan settings.']]);
    expect(r.note ?? '').not.toContain('Nothing changed');
  });
});

describe('the hidden line’s replacement matches the ask (pure)', () => {
  const filterWith = (scope: ReturnType<typeof planScopeOf>, plan: boolean, week: boolean) =>
    createReplyFilter({ ledger: () => ({ turnId: 't', entries: [], knownExerciseNames: [] }), surface: 'sheet', weekToolOffered: week, planToolOffered: plan, planScope: scope, noChangeLine: 'off' });
  const shown = (f: ReturnType<typeof filterWith>, text: string) => [...f.push(text), ...f.end(true)].flatMap((i) => (i.kind === 'sentence' ? [i.text] : []));

  it('after "full plan": the plan offer, never "Want me to change this week?"', () => {
    expect(shown(filterWith('plan', true, true), "I don't have a weekly-plan editing tool available in this chat.")).toEqual([PLAN_ASK_LINE]);
  });
  it('this week asked (or nothing said and the sentence is about the week): the week’s line, as ADR 0039', () => {
    expect(shown(filterWith('week', true, true), "I can't change your plan from this chat.")).toEqual([WEEK_ASK_LINE]);
    expect(shown(filterWith(null, true, true), "I don't have a weekly-plan editing tool available in this chat.")).toEqual([WEEK_ASK_LINE]);
  });
  it('no plan in use (no plan tool): a "can’t change your plan" sentence after "full plan" is true and kept', () => {
    expect(shown(filterWith('plan', false, true), "I can't change your plan from this chat.")).toEqual(["I can't change your plan from this chat."]);
  });
  it('noToolAim: his scope wins, else the sentence’s words', () => {
    expect(noToolAim('I can’t change this week here.', 'plan')).toBe('plan');
    expect(noToolAim('I can’t change your plan here.', null)).toBe('plan');
    expect(noToolAim('I can’t change your weekly schedule here.', null)).toBe('week');
  });
});

describe('scope and offer replies (pure)', () => {
  it.each([
    ['swap leg press and leg extension in the full plan', 'plan'],
    ['Can we swap leg press for leg extension across the plan', 'plan'],
    ['full plan', 'plan'],
    ['every week', 'plan'],
    ['from now on', 'plan'],
    ['just this week', 'week'],
    ['change my plan this week', 'week'],
    ['swap it today', 'today'],
    ['how heavy should I go', null],
  ] as const)('"%s" → %s', (t, scope) => {
    expect(planScopeOf(t)).toBe(scope);
  });

  it('threadPlanScope: his words now, else his last message with a scope', () => {
    expect(threadPlanScope('Yes', ['swap leg press for leg extension across the full plan'])).toBe('plan');
    expect(threadPlanScope('just this week', ['across the full plan'])).toBe('week');
    expect(threadPlanScope('Yes', ['hello'])).toBeNull();
  });

  const msg = (ordinal: number, role: 'ben' | 'coach', text: string) =>
    role === 'ben'
      ? { id: `m${String(ordinal)}`, ownerId: 'o', threadId: 't', turnId: `t${String(Math.ceil(ordinal / 2))}`, ordinal, createdAt: { utc: '2026-10-30T10:00:00.000Z', tz: 'Europe/London' }, body: { role: 'ben' as const, input: { kind: 'words' as const, text, spoken: false } } }
      : { id: `m${String(ordinal)}`, ownerId: 'o', threadId: 't', turnId: `t${String(Math.ceil(ordinal / 2))}`, ordinal, createdAt: { utc: '2026-10-30T10:00:00.000Z', tz: 'Europe/London' }, body: { role: 'coach' as const, items: [{ kind: 'sentence' as const, text: 'Sure thing.' }, { kind: 'sentence' as const, text }], actionIds: [], note: null, offer: null, hiddenLines: [], complete: true } };

  it('"Yes" or "full plan" after the coach’s offer carries the words that led to it; anything else is its own message', () => {
    const h = [msg(1, 'ben', 'Can we swap leg press for leg extension across the plan'), msg(2, 'coach', 'Want me to change this week?')];
    expect(offerContinuationOf(h as never, 'Yes')).toEqual({ request: 'Can we swap leg press for leg extension across the plan\nYes', offer: 'Want me to change this week?' });
    expect(offerContinuationOf(h as never, 'full plan')?.request).toBe('Can we swap leg press for leg extension across the plan\nfull plan');
    expect(offerContinuationOf(h as never, 'what about my squat today, how heavy?')).toBeNull();
    // Not an offer: a plain statement.
    expect(offerContinuationOf([msg(1, 'ben', 'how was my week'), msg(2, 'coach', 'Solid week.')] as never, 'Yes')).toBeNull();
  });
});

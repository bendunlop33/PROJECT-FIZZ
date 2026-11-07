import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { createSessionReadExecutor, createStoreExecutors, type CoachExecutors } from '../src/executors';
import { createEditTodayExecutor } from '../src/edit-today';
import { THINK_AGAIN_LINE, THINK_HARDER_LINE, runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { call, memoryStore, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * Coach v3, slice 5 (ADR 0027; Ben 18 Oct: "Mid workouts I think it should use it but gauge itself
 * whether it's needed or if a lighter model can be used"). Live-workout turns start at low effort
 * on his mid-workout model (if he chose one); `think_harder`, once a turn, moves the next steps to
 * high effort on his main model. Builds are high, anything else medium.
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

async function live(s: Store): Promise<SessionAggregate> {
  const agg = workout();
  const r = await s.repos.sessions.save(agg, null);
  if (!r.ok) throw new Error('save failed');
  return agg;
}

function liveExecutors(s: Store): CoachExecutors {
  const load = () => s.repos.sessions.get(SESSION);
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: SESSION }),
    get_active_session: createSessionReadExecutor({ loadSession: load, gymName: 'Main Gym' }),
    edit_today: createEditTodayExecutor({ store: s.repos.coach, loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
  };
}

const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] });

describe('effort and model per step', () => {
  it('a live-workout turn: low effort on the mid-workout model; think_harder once → high on the main model; a second is refused', async () => {
    const s = await store();
    const agg = await live(s);
    const model = new ScriptedCoachModel([
      [call('think_harder', { why: 'replan around a missed set' }, 't1'), { type: 'completed' }],
      [call('think_harder', { why: 'again' }, 't2'), { type: 'completed' }],
      reply('Keep bench where it is.'),
    ]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('should I keep going with bench?'), workoutModel: 'gpt-6-mini', context: ctx(agg) }), ports(s, model, liveExecutors(s)));
    expect(r.status).toBe('completed');
    expect(model.offeredTools()[0]).toContain('think_harder');
    expect(model.requests.map((q) => [q.model, q.effort])).toEqual([
      ['gpt-6-mini', 'low'],
      ['gpt-6.1-sol', 'high'],
      ['gpt-6.1-sol', 'high'],
    ]);
    expect(r.toolLog.map((l) => [l.tool, l.outcome, l.text])).toEqual([
      ['think_harder', 'read', 'Thinking harder'],
      ['think_harder', 'not_allowed', 'Already thinking harder.'],
    ]);
    const outputs = (model.requests[2]?.input ?? []).flatMap((i) => (i.type === 'function_call_output' ? [(JSON.parse(i.output) as { line: string }).line] : []));
    expect(outputs).toEqual([THINK_HARDER_LINE, THINK_AGAIN_LINE]);
    // Nothing was written.
    expect(await s.repos.coach.listTurnActions(r.turnId)).toEqual([]);
  });

  it('with no mid-workout model chosen, the main model throughout (low until think_harder)', async () => {
    const s = await store();
    const agg = await live(s);
    const model = new ScriptedCoachModel([reply('Good set.')]);
    await runCoachTurn(request({ kind: 'workout', input: words('that felt fine'), context: ctx(agg) }), ports(s, model, liveExecutors(s)));
    expect(model.requests.map((q) => [q.model, q.effort])).toEqual([['gpt-6.1-sol', 'low']]);
  });

  it('a general turn is medium on the main model and has no think_harder; the mid-workout model is never used there', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([reply('Rest days matter.')]);
    await runCoachTurn(request({ input: words('how often should I train?'), workoutModel: 'gpt-6-mini' }), ports(s, model, liveExecutors(s)));
    expect(model.requests.map((q) => [q.model, q.effort])).toEqual([['gpt-6.1-sol', 'medium']]);
    expect(model.offeredTools()[0]).not.toContain('think_harder');
  });
});

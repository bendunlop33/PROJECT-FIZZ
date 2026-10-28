import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { createSessionReadExecutor, createStoreExecutors, type CoachExecutors } from '../src/executors';
import { createEditTodayExecutor } from '../src/edit-today';
import { benMessageAsks, verifyAsked } from '../src/intent';
import { COACH_INSTRUCTIONS, FIND_EXERCISES_LINE, runCoachTurn, STALE_RETRY_LINE } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { call, id, kg, memoryStore, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * ADR 0038 (Ben, 28 Oct: "It fails to make the changes I want. It gets very caught up in whether I have
 * equipment or barbells etc."). The turn engine: the same tools for today's live workout from every entry,
 * "Ben asked" decided once per turn on his message, a stale call gets the version to retry with, and the
 * model is never fed rounding notes to argue about.
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

async function saved(s: Store, agg: SessionAggregate): Promise<SessionAggregate> {
  const r = await s.repos.sessions.save(agg, null);
  if (!r.ok) throw new Error('save failed');
  return agg;
}

function live(s: Store): CoachExecutors {
  const load = () => s.repos.sessions.get(SESSION);
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: null }),
    get_active_session: createSessionReadExecutor({ loadSession: load, gymName: 'Main Gym' }),
    edit_today: createEditTodayExecutor({ store: s.repos.coach, loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
  };
}

const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] });
const t = (value: number, reps: number) => ({ load: kg(value), reps: { min: reps, max: reps }, rpe: null });
const outputs = (req: { input: readonly { type: string }[] } | undefined): string[] => (req?.input ?? []).flatMap((i) => (i.type === 'function_call_output' ? [(i as { output: string }).output] : []));

describe('the same tools from every entry point (Today, Progress, Plan)', () => {
  it('a general turn with today’s live workout offers edit_today; "add a set to bench" applies with Undo; the thread stays general', async () => {
    const s = await store();
    await saved(s, workout());
    const args = { baseVersion: 7, ops: [{ op: 'set_count', sessionExerciseId: id(10), workingSets: 5 }], reason: 'Ben asked.', benAsked: true, benQuote: 'add a set to bench' };
    const model = new ScriptedCoachModel([[call('edit_today', args), { type: 'completed' }], reply('Go.')]);
    const r = await runCoachTurn(request({ kind: 'general', input: words('add a set to bench'), context: ctx(workout()), threadSessionId: null }), ports(s, model, live(s)));
    expect(model.requests[0]?.tools.map((x) => x.name)).toContain('edit_today');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(r.offer).toBeNull();
    expect((await s.repos.sessions.get(SESSION))?.sets.filter((x) => x.sessionExerciseId === id(10) && x.status !== 'deleted')).toHaveLength(5);
    expect((await s.repos.coach.getThread(r.threadId))?.sessionId).toBeNull();
  });

  it('the coach raising a change itself on a general turn is still an offer, never applied', async () => {
    const s = await store();
    await saved(s, workout());
    const args = { baseVersion: 7, ops: [{ op: 'set', setId: id(102), target: { load: kg(105), reps: null } }], reason: 'Looked easy.', benAsked: true, benQuote: 'felt easy' };
    const model = new ScriptedCoachModel([[call('edit_today', args), { type: 'completed' }], reply('Want me to adjust?')]);
    const r = await runCoachTurn(request({ kind: 'general', input: words('Bench felt pretty easy today, nice to see progress'), context: ctx(workout()), threadSessionId: null }), ports(s, model, live(s)));
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    expect(r.offer).toBe('adjust_today');
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });
});

describe('"build up to 95 kg as the last set" mid-workout (Ben, 28 Oct)', () => {
  it('the last set is exactly 95, the ramp is lower; no rounding notes reach the model', async () => {
    const s = await store();
    await saved(s, workout());
    const args = { baseVersion: 7, ops: [{ op: 'sets', sessionExerciseId: id(10), sets: [t(71, 5), t(83, 3), t(95, 1)] }], reason: 'Ramp to his top set.', benAsked: true, benQuote: 'build up to 95' };
    const model = new ScriptedCoachModel([[call('edit_today', args), { type: 'completed' }], reply('Go.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Give me sets which build up to 95 kg on bench as the last set'), context: ctx(workout()) }), ports(s, model, live(s)));
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    const pending = (await s.repos.sessions.get(SESSION))?.sets.filter((x) => x.sessionExerciseId === id(10) && x.status === 'pending').sort((a, b) => a.index - b.index) ?? [];
    expect(pending.map((x) => x.planned.load?.value)).toEqual([70, 82.5, 95]);
    const fed = outputs(model.requests[1]).join('\n');
    expect(fed).not.toMatch(/Rounded|isn't possible|rack/);
  });
});

describe('stale: the model gets the version now and retries once', () => {
  it('a stale edit returns the current baseVersion; the retry applies', async () => {
    const s = await store();
    await saved(s, workout(8));
    const stale = { baseVersion: 7, ops: [{ op: 'set', setId: id(103), target: { load: kg(95), reps: null } }], reason: 'Ben asked.', benAsked: true, benQuote: 'drop the last one to 95' };
    const model = new ScriptedCoachModel([[call('edit_today', stale, 'a'), { type: 'completed' }], [call('edit_today', { ...stale, baseVersion: 8 }, 'b'), { type: 'completed' }], reply('Done.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('drop the last one to 95'), context: ctx(workout(8)) }), ports(s, model, live(s)));
    const first = JSON.parse(outputs(model.requests[1])[0] ?? '{}') as { status?: string; baseVersion?: number; retry?: string };
    expect(first).toMatchObject({ status: 'stale', baseVersion: 8, retry: STALE_RETRY_LINE });
    expect(r.cards.map((c) => c.record.status)).toEqual(['stale', 'committed']);
    expect((await s.repos.sessions.get(SESSION))?.sets.find((x) => x.id === id(103))?.planned.load).toEqual(kg(95));
  });
});

describe('"Ben asked", once per turn and leniently', () => {
  it('a paraphrased swap applies; a statement or an opinion question does not', () => {
    const base = { tool: 'edit_today', chip: false, acceptedOffer: false, setsOnly: false, fallback: () => false };
    expect(verifyAsked({ ...base, words: 'Can we do something else instead of the assisted pull-ups', claim: { benAsked: true, benQuote: 'swap pull-ups' } }).asked).toBe(true);
    expect(verifyAsked({ ...base, words: 'Pull-ups are killing me today, the rest is fine', claim: { benAsked: true, benQuote: 'swap pull-ups' } }).asked).toBe(false);
    expect(verifyAsked({ ...base, words: 'Should I swap the pull-ups for something?', claim: { benAsked: true, benQuote: 'swap the pull-ups' } }).asked).toBe(false);
    // A load complaint asks for loads, not a structural edit (review coach-fail S1 stands).
    expect(verifyAsked({ ...base, words: 'It’s too light given my set on Friday', claim: { benAsked: true, benQuote: 'too light' } }).asked).toBe(false);
    expect(benMessageAsks('use 30 kg for curls')).toBe(true);
    expect(benMessageAsks('Set 2 felt good, nice and smooth today')).toBe(false);
  });
});

describe('the prompt: equipment rules the code enforces are gone; honesty and no-diagnosis stay', () => {
  it('no equipment arguing, no update_gym questions, honesty and pain rules kept', () => {
    expect(COACH_INSTRUCTIONS).toContain('never argue about equipment');
    expect(COACH_INSTRUCTIONS).not.toContain('Loads must come from the equipment Ben has');
    expect(COACH_INSTRUCTIONS).toContain('Never diagnose pain');
    expect(COACH_INSTRUCTIONS).toContain('An estimated 1RM is always called an estimate');
    expect(COACH_INSTRUCTIONS).toContain('Never say a change failed');
    expect(FIND_EXERCISES_LINE).not.toContain('can’t be done at this gym');
  });
});

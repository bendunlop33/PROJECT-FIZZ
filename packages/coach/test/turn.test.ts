import { afterEach, describe, expect, it } from 'vitest';
import type { newPainFlag } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { ActionRecord, CoachToolCall } from '@fizz/schemas';
import { createAdjustExecutor, createStoreExecutors, undoCoachAction, type CoachExecutors, type ToolExecutor } from '../src/executors';
import { COACH_TOOLS } from '../src/registry';
import { recoverCoachTurns, runCoachTurn, isBareAccept, gateFor } from '../src/turn';
import { chunked, ScriptedCoachModel } from './fake-model';
import { at, call, FakeTodayTargets, HangingModel, id, kg, memoryStore, OWNER, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

const nb = (s: string): string => s.replace(/\u00a0/g, ' ');
const BENCH_EX = id(10);
const DB_EX = id(20);
const ASSIST_EX = id(30);
const BENCH_ID = id(1010);
const OHP_ID = id(1040);

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

const NAMES: Record<string, string> = { [BENCH_ID]: 'Bench press', [OHP_ID]: 'Overhead press' };
function storeExecutors(s: Store, sessionId: string | null = null): CoachExecutors {
  return createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: (x) => Promise.resolve(NAMES[x] ?? null) }, sessionId });
}

function sentences(r: { items: readonly { kind: string; text?: string }[] }): string[] {
  return r.items.flatMap((i) => (i.kind === 'sentence' && i.text !== undefined ? [i.text] : []));
}

describe('runCoachTurn: structured replies (PM decision 10 Oct)', () => {
  it('every request offers the reply function, forces one call and no parallel calls', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([reply('Rest 2–3 minutes on bench.')]);
    const r = await runCoachTurn(request({ input: words('How long should I rest?') }), ports(s, model, storeExecutors(s)));
    expect(r.status).toBe('completed');
    expect(sentences(r)).toEqual(['Rest 2–3 minutes on bench.']);
    const req = model.requests[0];
    expect(req).toMatchObject({ toolChoice: 'required', parallelToolCalls: false });
    expect(req?.tools.map((t) => t.name)).toContain('reply');
    expect(new Set(req?.tools.map((t) => t.strict))).toEqual(new Set([true]));
  });

  it('contract check 2: a phantom change in the message is dropped; no card, no change; Why? keeps it', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([reply('Done, I’ve lowered sets 3–4 to 95 kg. That should keep you at 8.')]);
    const r = await runCoachTurn(request({ input: words('How did bench go?') }), ports(s, model, storeExecutors(s)));
    expect(sentences(r)).toEqual(['That should keep you at 8.']);
    expect(r.cards).toEqual([]);
    expect(r.note).toBe('Nothing was changed. One line said otherwise and is hidden.');
    expect(r.hiddenLines).toMatchObject([{ sentence: 'Done, I’ve lowered sets 3–4 to 95 kg.', reason: 'no_action' }]);
    const msgs = await s.repos.coach.listMessages(r.threadId);
    expect(msgs.map((m) => m.body.role)).toEqual(['ben', 'coach']);
    expect(msgs[1]?.body).toMatchObject({ role: 'coach', hiddenLines: [{ reason: 'no_action' }], complete: true });
  });

  it('a saved memory is a card from the record; the model restating it in words is dropped', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([
      [call('save_memory', { text: 'Trains before work', quote: 'remember that I train before work' }), { type: 'completed' }],
      reply('I’ve saved that to memory. Morning sessions suit short rests.'),
    ]);
    const r = await runCoachTurn(request({ input: words('Remember that I train before work') }), ports(s, model, storeExecutors(s)));
    expect(r.cards.map((c) => nb(c.rendered.text))).toEqual(['Saved to memory: “Trains before work”.']);
    expect(sentences(r)).toEqual(['Morning sessions suit short rests.']);
    expect(r.hiddenLines[0]).toMatchObject({ reason: 'mismatch', detail: 'Changes show on their cards, not in the reply.' });
    expect(await s.repos.coach.listMemories(OWNER)).toHaveLength(1);
    // The model saw the saved result, not its own words.
    const out = model.requests[1]?.input.find((i) => i.type === 'function_call_output');
    expect(out).toMatchObject({ type: 'function_call_output' });
    expect(JSON.parse(out?.type === 'function_call_output' ? out.output : '{}')).toMatchObject({ status: 'committed', ref: 'a1', shownToBen: 'as a card' });
  });

  it('a plain-text answer (the route ignored tool_choice) goes through the same backstop and can change nothing', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([[...chunked('Bench looked strong. I’ve flagged your shoulder.'), { type: 'completed' }]]);
    const r = await runCoachTurn(request({ input: words('Thoughts?') }), ports(s, model, storeExecutors(s)));
    expect(sentences(r)).toEqual(['Bench looked strong.']);
    expect(r.cards).toEqual([]);
  });

  it('the structural no-change line: Ben asked, no card, any statement (even an emoji) gets "No change made."', async () => {
    const s = await store();
    const r = await runCoachTurn(request({ input: words('Remember that I hate lunges') }), ports(s, new ScriptedCoachModel([reply('👍')]), storeExecutors(s)));
    expect(r.cards).toEqual([]);
    expect(r.note).toBe('No change made.');
  });
});

describe('the gate: tools come from Ben’s own words, never from tool output (rule 3, check 19)', () => {
  it('"remember …" opens save_memory; a question doesn’t; nothing clears a pain flag', async () => {
    const s = await store();
    const ask = new ScriptedCoachModel([reply('Nothing yet.')]);
    await runCoachTurn(request({ input: words('What do you remember about me?') }), ports(s, ask, storeExecutors(s)));
    expect(ask.offeredTools()[0]).not.toContain('save_memory');
    const tell = new ScriptedCoachModel([reply('Okay.')]);
    await runCoachTurn(request({ input: words('Remember that I train before work') }), ports(s, tell, storeExecutors(s)));
    expect(tell.offeredTools()[0]).toContain('save_memory');
    expect(COACH_TOOLS.some((t) => /clear/.test(t.name))).toBe(false);
  });

  it('check 10: "My shoulder hurts on overhead press" sets a flag with Undo; check 19: "shoulder sore" in history read by a tool opens nothing', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([
      [call('set_pain_flag', { exerciseIds: [OHP_ID], area: 'shoulder', quote: 'my shoulder hurts on overhead press' }), { type: 'completed' }],
      reply('See a physio if it keeps up.'),
    ]);
    const r = await runCoachTurn(request({ input: words('My shoulder hurts on overhead press') }), ports(s, model, storeExecutors(s)));
    expect(r.cards.map((c) => c.rendered.text)).toEqual(['Pain flag on for Overhead press. No increases until you clear it.']);
    expect((await s.repos.painFlags.listActive(OWNER)).map((f) => [f.exerciseName, f.source])).toEqual([['Overhead press', 'coach']]);
    const undone = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: r.cards[0]?.record.actionId ?? '', opId: 'undo-tap-1', now: at(500) });
    expect(undone.result.status).toBe('written');
    expect(await s.repos.painFlags.listActive(OWNER)).toEqual([]);

    // Imported notes say "shoulder sore"; Ben only asks a question.
    const history: ToolExecutor = () => Promise.resolve({ kind: 'read', data: { sessions: [{ note: { quoted: 'shoulder sore' } }] } });
    const m2 = new ScriptedCoachModel([[call('get_recent_training', { exerciseId: OHP_ID, sessions: 3 }), { type: 'completed' }], [call('set_pain_flag', { exerciseIds: [OHP_ID], area: 'shoulder', quote: 'shoulder sore' }), { type: 'completed' }], reply('Okay.')]);
    const r2 = await runCoachTurn(request({ input: words('How has overhead press gone lately?') }), ports(s, m2, { ...storeExecutors(s), get_recent_training: history }));
    expect(m2.offeredTools()[1]).not.toContain('set_pain_flag');
    expect(r2.toolLog.map((l) => l.text)).toContain('Not allowed: set_pain_flag');
    expect(await s.repos.painFlags.listActive(OWNER)).toEqual([]);
  });

  it('a tool the app can’t run in this build is never offered (set_next_session_targets, history reads without a port)', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([reply('Good session.')]);
    await runCoachTurn(request({ kind: 'summary', input: { kind: 'summary' } }), ports(s, model, storeExecutors(s)));
    expect(model.offeredTools()[0]).not.toContain('set_next_session_targets');
    expect(model.offeredTools()[0]).not.toContain('get_recent_training');
  });

  it('an unknown tool runs nothing and is logged as Not allowed (check 7: delete_set)', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([[call('delete_set', { setId: id(100) }), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ input: words('Delete set 1') }), ports(s, model, storeExecutors(s)));
    expect(r.toolLog).toMatchObject([{ tool: 'delete_set', outcome: 'not_allowed', text: 'Not allowed: delete_set' }]);
    expect(r.cards).toEqual([]);
  });

  it('a bare "yes" accepts only the coach’s structured offer', () => {
    expect(isBareAccept('Yes please!')).toBe(true);
    expect(isBareAccept('yes, but lighter on squat')).toBe(false);
    expect(gateFor({ kind: 'workout', input: words('yes'), previousOffer: 'adjust_today', structuralSignals: [] }).acceptedOffer).toBe(true);
    expect(gateFor({ kind: 'workout', input: words('yes'), previousOffer: null, structuralSignals: [] }).acceptedOffer).toBe(false);
    expect(gateFor({ kind: 'workout', input: { kind: 'accept_offer', offer: 'adjust_today' }, previousOffer: null, structuralSignals: [] }).acceptedOffer).toBe(false);
  });
});

describe("today's sets through the turn (rule 3: offer, accept, apply; rule 4, rule 5)", () => {
  function adjustExecutors(s: Store, targets: FakeTodayTargets, flags: () => ReturnType<typeof newPainFlag>[] = () => []): CoachExecutors {
    return {
      ...storeExecutors(s, SESSION),
      adjust_pending_sets: createAdjustExecutor({ store: s.repos.coach, targets, loadSession: () => Promise.resolve(targets.state), painFlags: () => Promise.resolve(flags()), sessionPainUnspecified: false, gymName: 'Main Gym' }),
    };
  }
  const lower = (baseVersion = 7) => ({
    baseVersion,
    exercises: [{ sessionExerciseId: BENCH_EX, sets: [{ setId: id(102), target: { load: kg(95), reps: { min: 8, max: 8 } } }, { setId: id(103), target: { load: kg(95), reps: { min: 8, max: 8 } } }], addSet: null, removeSetId: null }],
    reason: 'Set 2 was RPE 10.',
  });

  it('the coach offers on its own; nothing applies; Ben’s "yes" opens the tool and the card shows the saved change', async () => {
    const s = await store();
    const targets = new FakeTodayTargets(workout(), s);
    const ctx = { session: targets.state, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] };
    const first = new ScriptedCoachModel([reply('Set 2 was RPE 10. Want me to take 5 kg off the last two?', 'adjust_today')]);
    const r1 = await runCoachTurn(request({ kind: 'workout', input: words('Set 2 was rough'), context: ctx }), ports(s, first, adjustExecutors(s, targets)));
    expect(first.offeredTools()[0]).not.toContain('adjust_pending_sets');
    expect(r1.offer).toBe('adjust_today');
    expect(targets.applied).toEqual([]);

    const second = new ScriptedCoachModel([[call('adjust_pending_sets', lower()), { type: 'completed' }], reply('That should keep you at 8.')]);
    const r2 = await runCoachTurn(request({ kind: 'workout', threadId: r1.threadId, input: words('yes'), context: ctx }), ports(s, second, adjustExecutors(s, targets)));
    expect(second.offeredTools()[0]).toContain('adjust_pending_sets');
    expect(r2.cards.map((c) => nb(c.rendered.text))).toEqual(['Changed sets 3–4 to 95 kg × 8 (targets).']);
    expect(sentences(r2)).toEqual(['That should keep you at 8.']);
    expect(targets.state.session.version).toBe(8);
  });

  it('contract check 3: the validator snaps 98 to 97.5 kg; the card says 97.5, a sentence with 98 is dropped', async () => {
    const s = await store();
    const targets = new FakeTodayTargets(workout(), s);
    const args = { ...lower(), exercises: [{ ...lower().exercises[0], sets: [{ setId: id(102), target: { load: kg(98), reps: null } }, { setId: id(103), target: { load: kg(98), reps: null } }] }] };
    const model = new ScriptedCoachModel([[call('adjust_pending_sets', args), { type: 'completed' }], reply('Sets 3 and 4 are 98 kg now. Keep the bar path tight.')]);
    const r = await runCoachTurn(
      request({ kind: 'workout', input: words('Drop the last two to 98'), context: { session: targets.state, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] } }),
      ports(s, model, adjustExecutors(s, targets)),
    );
    expect(nb(r.cards[0]?.rendered.text ?? '')).toBe('Changed sets 3–4 to 97.5 kg × 6–8 (targets).');
    expect(r.cards[0]?.record.guardNotes.map((n) => n.kind)).toContain('snapped');
    expect(sentences(r)).toEqual(['Keep the bar path tight.']);
    expect(JSON.stringify(r.items)).not.toContain('98');
  });

  it('contract check 4: a stale base version is a stale card; nothing changes', async () => {
    const s = await store();
    const targets = new FakeTodayTargets(workout(8), s);
    const model = new ScriptedCoachModel([[call('adjust_pending_sets', lower(7)), { type: 'completed' }], reply('Changed sets 3–4.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Drop the last two to 95'), context: { session: targets.state, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, model, adjustExecutors(s, targets)));
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['stale', "Couldn't change sets 3–4: your workout moved on. Nothing changed."]]);
    expect(sentences(r)).toEqual([]);
    expect(targets.applied).toEqual([]);
  });

  it('contract check 6: the same call replayed (dropped connection) saves one record and one change', async () => {
    const s = await store();
    const targets = new FakeTodayTargets(workout(), s);
    const model = new ScriptedCoachModel([[call('adjust_pending_sets', lower(), 'x1'), { type: 'completed' }], [call('adjust_pending_sets', lower(), 'x2'), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Drop the last two to 95'), context: { session: targets.state, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }), ports(s, model, adjustExecutors(s, targets)));
    expect(r.cards).toHaveLength(1);
    expect(r.toolLog.map((l) => l.outcome)).toEqual(['committed', 'replayed']);
    expect(targets.applied).toHaveLength(1);
    expect(await s.repos.coach.listTurnActions(r.turnId)).toHaveLength(1);
  });

  it('per-hand dumbbells are capped at the rack’s max; assisted "harder" means less assistance; units never convert silently', async () => {
    const s = await store();
    const targets = new FakeTodayTargets(workout(), s);
    const args = {
      baseVersion: 7,
      exercises: [
        { sessionExerciseId: DB_EX, sets: [{ setId: id(200), target: { load: kg(35, 'per_hand'), reps: null } }], addSet: null, removeSetId: null },
        { sessionExerciseId: ASSIST_EX, sets: [{ setId: id(300), target: { load: kg(25, 'assistance'), reps: null } }], addSet: null, removeSetId: null },
      ],
      reason: 'Too easy.',
    };
    const model = new ScriptedCoachModel([[call('adjust_pending_sets', args), { type: 'completed' }], reply('Go for it.')]);
    const r = await runCoachTurn(
      request({ kind: 'workout', input: { kind: 'chip', chip: 'too_easy' }, context: { session: targets.state, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] } }),
      ports(s, model, adjustExecutors(s, targets)),
    );
    const record = r.cards[0]?.record;
    expect(record?.status).toBe('committed');
    const after = record?.detail.kind === 'adjust_pending_sets' ? record.detail.exercises.map((e) => e.changes[0]?.after?.load) : [];
    expect(after).toEqual([kg(30, 'per_hand'), kg(25, 'assistance')]);
    expect(record?.guardNotes.map((n) => n.kind)).toContain('capped');
  });

  it('rule 9: pain in Ben’s own words this turn blocks an increase; the sheet asks Sore or pain? from the words, not the model', async () => {
    const s = await store();
    const targets = new FakeTodayTargets(workout(), s);
    const up = { ...lower(), exercises: [{ ...lower().exercises[0], sets: [{ setId: id(102), target: { load: kg(105), reps: null } }] }] };
    const model = new ScriptedCoachModel([[call('adjust_pending_sets', up), { type: 'completed' }], reply('Also sorted your knee.')]);
    const r = await runCoachTurn(
      request({ kind: 'workout', input: words('Add 5 to bench, my knee’s a bit off'), context: { session: targets.state, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] } }),
      ports(s, model, adjustExecutors(s, targets)),
    );
    expect(r.cards.map((c) => c.record.status)).toEqual(['rejected']);
    expect(targets.applied).toEqual([]);
    expect(r.askPain).toEqual({ bodyPart: 'knee' });
  });
});

describe('errors, timeouts, Stop and restart recovery (rule 1: honest states, no canned replies)', () => {
  it.each(['usage_limit', 'not_eligible', 'auth_expired', 'network', 'unavailable'] as const)('%s: the turn fails with that status and no coach text', async (error) => {
    const s = await store();
    const r = await runCoachTurn(request({ input: words('Hi') }), ports(s, new ScriptedCoachModel([[{ type: 'error', error }]]), storeExecutors(s)));
    expect(r).toMatchObject({ status: 'failed', error, items: [], cards: [], note: null });
    expect((await s.repos.coach.getTurn(r.turnId))?.status).toBe('failed');
  });

  it('a change saved before the stream broke keeps its card; the reply is not padded', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([[call('save_memory', { text: 'Trains before work', quote: 'remember I train before work' }), { type: 'completed' }], [{ type: 'error', error: 'network' }]]);
    const r = await runCoachTurn(request({ input: words('Remember I train before work') }), ports(s, model, storeExecutors(s)));
    expect(r).toMatchObject({ status: 'failed', error: 'network', items: [], note: 'Stopped. Anything applied is shown above.' });
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
  });

  it('timeouts: no first event in time, or a stall mid-reply', async () => {
    const s = await store();
    const r1 = await runCoachTurn(request({ input: words('Hi') }), ports(s, new HangingModel(), storeExecutors(s)));
    expect(r1).toMatchObject({ status: 'failed', error: 'timeout' });
    const r2 = await runCoachTurn(request({ input: words('Hi') }), ports(s, new HangingModel({ type: 'text_delta', delta: 'Hel' }), storeExecutors(s)));
    expect(r2).toMatchObject({ status: 'failed', error: 'timeout', items: [] });
  });

  it('Stop cancels the request', async () => {
    const s = await store();
    const stop = new AbortController();
    const running = runCoachTurn(request({ input: words('Hi'), signal: stop.signal }), { ...ports(s, new HangingModel(), storeExecutors(s)), timing: { firstEventMs: 10_000, stallMs: 10_000 } });
    setTimeout(() => {
      stop.abort();
    }, 20);
    expect(await running).toMatchObject({ status: 'cancelled', error: 'cancelled' });
  });

  it('at most four model steps', async () => {
    const s = await store();
    const loop = Array.from({ length: 6 }, (_, i) => [call('get_recent_actions', { limit: 3 }, `l${String(i)}`), { type: 'completed' as const }]);
    const model = new ScriptedCoachModel(loop);
    const r = await runCoachTurn(request({ input: words('What did you change?') }), ports(s, model, storeExecutors(s)));
    expect(r).toMatchObject({ status: 'failed', error: 'too_many_steps' });
    expect(model.requests).toHaveLength(4);
  });

  it('coach-sheet 9 as a replay: the same turn ID sends nothing again and shows the saved cards', async () => {
    const s = await store();
    const req = request({ input: words('Remember I train before work') });
    const model = new ScriptedCoachModel([[call('save_memory', { text: 'Trains before work', quote: 'remember I train before work' }), { type: 'completed' }], reply('Okay.')]);
    await runCoachTurn(req, ports(s, model, storeExecutors(s)));
    const again = await runCoachTurn(req, ports(s, model, storeExecutors(s)));
    expect(again).toMatchObject({ replayed: true, status: 'completed' });
    expect(again.cards).toHaveLength(1);
    expect(model.requests).toHaveLength(2);
  });

  it('contract check 8: force-close mid-turn; at launch the turn is interrupted and its card shows once', async () => {
    const s = await store();
    // A turn that saved a memory, then the app was killed before the reply.
    const saved: { record: ActionRecord | null } = { record: null };
    const killing: ToolExecutor = async (c: CoachToolCall, ctx) => {
      const r = await storeExecutors(s).save_memory?.(c, ctx);
      if (r?.kind === 'action') saved.record = r.record;
      throw new Error('app killed');
    };
    const req = request({ input: words('Remember I train before work') });
    await expect(runCoachTurn(req, ports(s, new ScriptedCoachModel([[call('save_memory', { text: 'Trains before work', quote: 'remember' }), { type: 'completed' }]]), { ...storeExecutors(s), save_memory: killing }))).rejects.toThrow('app killed');
    expect((await s.repos.coach.getTurn(req.turnId))?.status).toBe('running');
    const recovered = await recoverCoachTurns(s.repos.coach, OWNER, at(900));
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.note).toBe('Interrupted. Anything applied is shown above.');
    expect(recovered[0]?.cards.map((c) => c.record.actionId)).toEqual([saved.record?.actionId]);
    expect(await recoverCoachTurns(s.repos.coach, OWNER, at(901))).toEqual([]);
  });
});

describe('earlier actions (CC5, check 16)', () => {
  it('get_recent_actions gives refs; a sentence citing [[e1]] shows the app line; one that doesn’t is dropped', async () => {
    const s = await store();
    const m = new ScriptedCoachModel([[call('save_memory', { text: 'Trains before work', quote: 'remember' }), { type: 'completed' }], reply('Okay.')]);
    await runCoachTurn(request({ input: words('Remember that I train before work') }), ports(s, m, storeExecutors(s)));
    const model = new ScriptedCoachModel([[call('get_recent_actions', { limit: 5 }), { type: 'completed' }], reply('Earlier I saved this: [[e1]]. I also saved that you hate lunges.')]);
    const r = await runCoachTurn(request({ input: words('What have you saved?') }), ports(s, model, storeExecutors(s)));
    const shown = r.items.map((i) => (i.kind === 'sentence' ? i.text : `[app] ${nb(i.rendered.text)}`));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatch(/^\[app\] Saved to memory: “Trains before work”\. · \d\d:\d\d$/);
    expect(r.hiddenLines.map((h) => h.sentence)).toContain('I also saved that you hate lunges.');
    expect(r.cards).toEqual([]);
  });
});

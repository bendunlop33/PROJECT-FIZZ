import { afterEach, describe, expect, it } from 'vitest';
import { exerciseHistoryView } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { buildCoachContext, contextInputItems, CUT_OFF_TURN_NOTE, liveFocusExerciseIds, recentLiftsView, UNANSWERED_TURN_NOTE } from '../src/context';
import { createSessionReadExecutor, createStoreExecutors, type CoachExecutors } from '../src/executors';
import { createEditTodayExecutor } from '../src/edit-today';
import { cleanFailure, failureWhy, scrubFailureMessage } from '../src/failure';
import { verifyAsked } from '../src/intent';
import type { ModelEvent } from '../src/model-port';
import { collectFacts, verifySentence } from '../src/numbers';
import { claimsChangeFailed, createReplyFilter, FAILURE_CLAIM_DETAIL } from '../src/reply';
import { asksLiveChange, followsUpChange, mentionsTodaysSets } from '../src/request';
import type { ToolLogLine } from '@fizz/schemas';
import { COACH_INSTRUCTIONS, failureBackedBy, LIVE_CHANGE_NUDGE_LINE, liveWorkoutInstructions, openChangeRequestIn, runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { at, call, id, kg, memoryStore, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * Ben's Build B report (21 Oct, real iPhone, live "Back · Barbell row" workout): "Make the rows warm up…"
 * ended "Coach unavailable. Nothing changed." with the provider's reason thrown away; the next turns
 * answered "It's too light given eg my set on Friday/sat" with advice and an invented "The adjustment
 * didn't go through", and only applied the change several messages later.
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

function liveExecutors(s: Store): CoachExecutors {
  const load = () => s.repos.sessions.get(SESSION);
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: SESSION }),
    get_active_session: createSessionReadExecutor({ loadSession: load, gymName: 'Main Gym' }),
    edit_today: createEditTodayExecutor({ store: s.repos.coach, loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
  };
}

const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] });

/** Bench sets 3–4 to 102 kg (snaps to 102.5 on the bar), with the model's ask claim. */
const raise = (benQuote: string | null, baseVersion = 7) => ({
  baseVersion,
  ops: [
    { op: 'set', setId: id(102), target: { load: kg(102), reps: null } },
    { op: 'set', setId: id(103), target: { load: kg(102), reps: null } },
  ],
  reason: 'Your recent sets were easy.',
  benAsked: benQuote !== null,
  benQuote,
});

const transient503: ModelEvent = { type: 'error', error: 'unavailable', transient: true, failure: { kind: 'unavailable', status: 503, code: 'subscription_sharing_usage_unavailable', message: 'Try again later', requestId: 'req_503' } };
const bad400: ModelEvent = { type: 'error', error: 'request_error', failure: { kind: 'bad_request', status: 400, code: 'invalid_request_error', message: "Invalid schema for function 'edit_today'", requestId: 'req_400' } };

describe('the provider failure is kept on the turn (B)', () => {
  it('scrubs tokens, keys and emails from the message and bounds it', () => {
    expect(scrubFailureMessage('Bad token Bearer eyJabc.defgh.ijk for ben@example.com')).toBe('Bad token … for …');
    expect(scrubFailureMessage('access_token=abc123 refused')).toBe('… refused');
    expect(scrubFailureMessage(`x ${'A1'.repeat(30)} y`)).toBe('x … y');
    expect(scrubFailureMessage('subscription_sharing_usage_unavailable')).toBe('subscription_sharing_usage_unavailable');
    expect(scrubFailureMessage('a'.repeat(500).replace(/a/g, 'ab '))?.length).toBeLessThanOrEqual(200);
    expect(scrubFailureMessage('')).toBeNull();
    expect(cleanFailure({ kind: 'bad request!', status: 999, code: 'invalid_request_error', message: 'm', requestId: 'req 1<x>' })).toEqual({ kind: 'badrequest', code: 'invalid_request_error', message: 'm', requestId: 'req1x' });
  });

  it('formats the Why? line: status, code, message, request ID', () => {
    expect(failureWhy({ kind: 'bad_request', status: 400, code: 'invalid_request_error', message: 'Bad schema', requestId: 'req_1' })).toBe('HTTP 400 · invalid_request_error · Bad schema · request req_1');
    expect(failureWhy({ kind: 'stream_interrupted', message: 'The stream ended without response.completed' })).toBe('stream_interrupted · The stream ended without response.completed');
  });

  it('a 400 fails the turn as request_error with the provider detail on the turn and the result; nothing retried', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[bad400]]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Make the rows warm up heavier'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.requests).toHaveLength(1);
    expect(r).toMatchObject({ status: 'failed', error: 'request_error', failure: { kind: 'bad_request', status: 400, code: 'invalid_request_error', requestId: 'req_400' } });
    const turn = await s.repos.coach.getTurn(r.turnId);
    expect(turn?.failure).toEqual({ kind: 'bad_request', status: 400, code: 'invalid_request_error', message: "Invalid schema for function 'edit_today'", requestId: 'req_400' });
    expect(turn?.error).toBe('request_error');
  });

  it('a cancelled turn keeps no failure', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([[{ type: 'error', error: 'cancelled', failure: { kind: 'network', message: 'aborted' } }]]);
    const r = await runCoachTurn(request({ input: words('Hello') }), ports(s, model));
    expect(r.status).toBe('cancelled');
    expect(r.failure).toBeUndefined();
  });
});

describe('a temporary failure retries the step once (C)', () => {
  it('a 503 before anything arrived is retried once; the turn completes', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([[transient503], reply('Rest two minutes.')]);
    const r = await runCoachTurn(request({ input: words('How long should I rest?') }), ports(s, model));
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.input).toEqual(model.requests[0]?.input);
    expect(r.status).toBe('completed');
    expect(r.failure).toBeUndefined();
  });

  it('a second temporary failure on the same step fails the turn with the detail', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([[transient503], [transient503], reply('never')]);
    const r = await runCoachTurn(request({ input: words('How long should I rest?') }), ports(s, model));
    expect(model.requests).toHaveLength(2);
    expect(r).toMatchObject({ status: 'failed', error: 'unavailable', failure: { status: 503, code: 'subscription_sharing_usage_unavailable' } });
  });

  it('a failure that is not temporary is not retried', async () => {
    const s = await store();
    const model = new ScriptedCoachModel([[{ type: 'error', error: 'unavailable', failure: { kind: 'policy_forbidden', status: 403 } }], reply('never')]);
    const r = await runCoachTurn(request({ input: words('How long should I rest?') }), ports(s, model));
    expect(model.requests).toHaveLength(1);
    expect(r.error).toBe('unavailable');
  });

  it('a stream that broke after part of the reply was shown is not retried (no sentence twice)', async () => {
    const s = await store();
    const args = JSON.stringify({ message: 'Rest two minutes. Then go again.', offer: null });
    const model = new ScriptedCoachModel([[{ type: 'tool_call_delta', name: 'reply', delta: args.slice(0, 30) }, { ...transient503, failure: { kind: 'stream_interrupted' } }], reply('never')]);
    const r = await runCoachTurn(request({ input: words('How long should I rest?') }), ports(s, model));
    expect(model.requests).toHaveLength(1);
    expect(r.items.map((i) => (i.kind === 'sentence' ? i.text : ''))).toEqual(['Rest two minutes.']);
    expect(r.status).toBe('failed');
  });

  it('a retry after a step that applied a change never applies it twice', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', raise('Make bench heavier')), { type: 'completed' }], [transient503], reply('Go.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Make bench heavier'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.requests).toHaveLength(3);
    expect(r.status).toBe('completed');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(8);
  });
});

describe('a live change request ends in edit_today (D, rule 3)', () => {
  const BEN_2 = "It's too light given eg my set on Friday/sat";

  it('reads Ben’s change words, and not questions, opinions, holds or later sessions', () => {
    for (const t of [BEN_2, 'Fix them then', 'Make the rows warm up heavier', 'Make the warm-ups heavier', 'way too easy', 'Can you fix them?', 'Make the rows heavier']) expect(asksLiveChange(t), t).toBe(true);
    for (const t of ['Is that too heavy?', 'Was that too light?', 'Too light, what do you think?', 'Keep the weights as they are', 'Make rows heavier next time', 'Set 2 felt good', 'How long should I rest?']) expect(asksLiveChange(t), t).toBe(false);
    for (const t of ['Try again', 'Go on then', 'ok do it', 'Fix them then', 'yes please']) expect(followsUpChange(t), t).toBe(true);
    for (const t of ['What did I do on Friday?', 'Try again with a different exercise next week please']) expect(followsUpChange(t), t).toBe(false);
  });

  it('the live instructions tell the coach to call edit_today and never invent a failure', () => {
    expect(liveWorkoutInstructions(true)).toContain('call edit_today in this turn');
    expect(liveWorkoutInstructions(true)).toContain('recentLifts');
    expect(COACH_INSTRUCTIONS).toContain('Never say a change failed');
  });

  it('turn 2 of the report: a text answer is held once, edit_today is then named, and the change applies with Undo', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([
      reply('The adjustment didn’t go through; keep the warm-ups controlled.'),
      [call('edit_today', raise('It’s too light')), { type: 'completed' }],
      reply('Keep the bar path tight.'),
    ]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_2), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.requests.map((q) => q.toolChoice)).toEqual(['required', { type: 'function', name: 'edit_today' }, 'required']);
    expect(JSON.stringify(model.requests[1]?.input)).toContain(LIVE_CHANGE_NUDGE_LINE.slice(0, 40));
    // The model quoted only part of his message ("It's too light"); his whole message asks, so it applies.
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(r.offer).toBeNull();
    // The held advice (and its invented failure) is never shown.
    expect(r.items.map((i) => (i.kind === 'sentence' ? i.text : ''))).toEqual(['Keep the bar path tight.']);
    expect((await s.repos.sessions.get(SESSION))?.sets.find((x) => x.id === id(103))?.planned.load).toEqual(kg(102.5));
  });

  it('an answer that calls edit_today first is never held or forced', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', raise('Make bench heavier')), { type: 'completed' }], reply('Done.')]);
    await runCoachTurn(request({ kind: 'workout', input: words('Make bench heavier'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.requests.map((q) => q.toolChoice)).toEqual(['required', 'required']);
  });

  it('a question about the load is answered, never forced', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([reply('It suits an RPE 8.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Is 100 too heavy for me?'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.requests).toHaveLength(1);
    expect(r.status).toBe('completed');
  });

  it('after a failed turn: the history says it went unanswered, and "Fix them then" is forced to edit_today', async () => {
    const s = await store();
    await saved(s, workout());
    const first = await runCoachTurn(request({ kind: 'workout', input: words('Make the bench warm up heavier'), context: ctx(workout()) }), ports(s, new ScriptedCoachModel([[bad400]]), liveExecutors(s)));
    expect(first.status).toBe('failed');
    const history = await s.repos.coach.listMessages(first.threadId);
    expect(openChangeRequestIn(history)).toBe('Make the bench warm up heavier');

    const model = new ScriptedCoachModel([reply('Keep them controlled.'), [call('edit_today', raise('Fix them then')), { type: 'completed' }], reply('Heavier now.')]);
    const r = await runCoachTurn(request({ kind: 'workout', threadId: first.threadId, input: words('Try again'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    const sent = JSON.stringify(model.requests[0]?.input);
    expect(sent).toContain('Make the bench warm up heavier');
    expect(sent).toContain(UNANSWERED_TURN_NOTE.slice(0, 30));
    expect(model.requests[1]?.toolChoice).toEqual({ type: 'function', name: 'edit_today' });
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
  });

  it('verifyAsked: Ben’s whole message counts when the model quoted only part of it', () => {
    const base = { tool: 'edit_today', chip: false, acceptedOffer: false, words: "It's too light given eg my set on Friday", fallback: () => false };
    expect(verifyAsked({ ...base, claim: { benAsked: true, benQuote: 'on Friday' } })).toEqual({ asked: false, by: 'not_a_request' });
    expect(verifyAsked({ ...base, benWordsAsk: true, claim: { benAsked: true, benQuote: 'on Friday' } })).toEqual({ asked: true, by: 'words' });
    expect(verifyAsked({ ...base, benWordsAsk: true, claim: { benAsked: true, benQuote: 'not his words' } })).toEqual({ asked: true, by: 'words' });
    // The model saying he didn't ask is still taken: an offer, nothing applied.
    expect(verifyAsked({ ...base, benWordsAsk: true, claim: { benAsked: false, benQuote: null } })).toEqual({ asked: false, by: 'model_said_no' });
  });
});

describe('a claimed failure with no tool result is hidden (D/c)', () => {
  it('recognises failure claims, not conditionals, questions or other "blocked" talk', () => {
    for (const t of ['The adjustment didn’t go through; keep the warm-ups controlled.', 'It was rejected.', 'The app is rejecting changes right now.', 'I couldn’t apply that.', 'That change failed to save.', 'The change failed.']) expect(claimsChangeFailed(t), t).toBe(true);
    for (const t of ['If it doesn’t apply, tap Undo.', 'Did it go through?', 'Progression is on hold for your knee.', 'Keep the warm-ups controlled.', 'That set didn’t go as planned.']) expect(claimsChangeFailed(t), t).toBe(false);
  });

  it('the filter hides it when nothing this turn was refused, and keeps it when something was', () => {
    const ledger = () => ({ turnId: 't', entries: [], knownExerciseNames: [] });
    const run = (backed: boolean) => {
      const f = createReplyFilter({ ledger, surface: 'sheet', failureBacked: () => backed, noChangeLine: 'off' });
      const items = [...f.push('The adjustment didn’t go through. Keep the warm-ups controlled. '), ...f.end(true)];
      return { shown: items.map((i) => (i.kind === 'sentence' ? i.text : '')), hidden: f.hiddenLines };
    };
    const invented = run(false);
    expect(invented.shown).toEqual(['Keep the warm-ups controlled.']);
    expect(invented.hidden).toEqual([{ sentence: 'The adjustment didn’t go through.', reason: 'no_action', detail: FAILURE_CLAIM_DETAIL }]);
    expect(run(true).shown).toEqual(['The adjustment didn’t go through.', 'Keep the warm-ups controlled.']);
  });

  it('in a turn, an invented failure is hidden; one after a stale edit stands', async () => {
    const s = await store();
    await saved(s, workout(8));
    // Ben said no change words, so nothing is forced; the edit names an old version and is refused as stale.
    const stale = new ScriptedCoachModel([[call('edit_today', raise('bench felt smooth', 7)), { type: 'completed' }], reply('That change didn’t go through.')]);
    const r1 = await runCoachTurn(request({ kind: 'workout', input: words('bench felt smooth'), context: ctx(workout(8)) }), ports(s, stale, liveExecutors(s)));
    expect(r1.items.map((i) => (i.kind === 'sentence' ? i.text : ''))).toEqual(['That change didn’t go through.']);
    const invented = new ScriptedCoachModel([reply('That change didn’t go through. Rest two minutes.')]);
    const r2 = await runCoachTurn(request({ kind: 'workout', input: words('How long should I rest?'), context: ctx(workout(8)) }), ports(s, invented, liveExecutors(s)));
    expect(r2.items.map((i) => (i.kind === 'sentence' ? i.text : ''))).toEqual(['Rest two minutes.']);
    expect(r2.hiddenLines.map((h) => h.detail)).toEqual([FAILURE_CLAIM_DETAIL]);
  });
});

describe('the live context carries the exercise’s recent sets (D/b)', () => {
  const past = (date: string, sid: number, sets: { load: number; reps: number; rpe: number | null; warm?: boolean }[]): SessionAggregate => {
    const w = workout();
    return {
      ...w,
      session: { ...w.session, id: id(sid), status: 'finished', startedAt: { utc: `${date}T17:00:00.000Z`, tz: 'Europe/London' }, endedAt: { utc: `${date}T18:00:00.000Z`, tz: 'Europe/London' } },
      exercises: w.exercises.filter((e) => e.id === id(10)).map((e) => ({ ...e, sessionId: id(sid) })),
      sets: sets.map((x, i) => ({
        ...(w.sets[0] as SessionAggregate['sets'][number]),
        id: id(sid * 10 + i),
        sessionId: id(sid),
        index: i,
        setType: x.warm === true ? 'warmup' : 'working',
        status: 'completed',
        actual: { load: kg(x.load), reps: x.reps, durationS: null, rpe: x.rpe, rir: null },
        completedAt: { utc: `${date}T17:${String(10 + i)}:00.000Z`, tz: 'Europe/London' },
      })),
    };
  };
  const history = () =>
    exerciseHistoryView({
      exerciseId: id(1010),
      exerciseName: 'Bench press',
      sessions: [past('2026-10-16', 801, [{ load: 60, reps: 10, rpe: null, warm: true }, { load: 80, reps: 12, rpe: 6 }]), past('2026-10-17', 802, [{ load: 90, reps: 12, rpe: null }])],
      limit: 3,
      gymNames: {},
      equipmentNames: {},
    });

  it('recentLiftsView: newest first, load × reps @RPE with the unit, warm-ups marked', () => {
    expect(JSON.parse(JSON.stringify(recentLiftsView([history()])).replace(/\u00a0/g, ' '))).toEqual([
      {
        exercise: 'Bench press',
        sessions: [
          { date: '2026-10-17', source: 'app', sets: ['90 kg × 12'] },
          { date: '2026-10-16', source: 'app', sets: ['60 kg × 10 (warm-up)', '80 kg × 12 @RPE 6'] },
        ],
      },
    ]);
  });

  it('liveFocusExerciseIds: the ones he named, then the one he is on, at most three', () => {
    expect(liveFocusExerciseIds(workout())).toEqual([id(1010)]);
    expect(liveFocusExerciseIds(workout(), [id(1030), id(9999)])).toEqual([id(1030), id(1010)]);
  });

  it('the context sends it under YOUR DATA, and the numbers check accepts it', () => {
    const c = buildCoachContext({ ...ctx(workout()), turnKind: 'workout', thread: [], recentLifts: [history()] });
    expect(c.yourData.recentLifts?.[0]?.exercise).toBe('Bench press');
    const texts = contextInputItems(c).flatMap((i) => (i.type === 'message' && i.role === 'developer' ? [{ text: i.content, setsDone: false }] : []));
    expect(verifySentence('Friday you did 80 kg × 12 at RPE 6, so go heavier.', collectFacts(texts)).ok).toBe(true);
  });

  it('a turn cut off after a change says so in the history', () => {
    const msg = (complete: boolean, actionIds: string[]) => ({ id: id(1), ownerId: id(2), threadId: id(3), turnId: id(4), ordinal: 1, createdAt: at(1), body: { role: 'coach' as const, items: [], actionIds, note: null, offer: null, hiddenLines: [], complete } });
    const sent = (m: ReturnType<typeof msg>) => buildCoachContext({ ...ctx(workout()), turnKind: 'workout', thread: [m] }).history.map((h) => (h.type === 'message' ? h.content : ''));
    expect(sent(msg(false, []))).toEqual([UNANSWERED_TURN_NOTE]);
    expect(sent(msg(false, [id(5)]))).toEqual([CUT_OFF_TURN_NOTE]);
    expect(sent(msg(true, []))).toEqual([]);
  });
});

describe('review coach-fail-21oct fixes', () => {
  const BEN_2 = "It's too light given eg my set on Friday/sat";
  const shown = (r: { items: readonly { kind: string; text?: string }[] }) => r.items.map((i) => (i.kind === 'sentence' ? (i.text ?? '') : ''));

  it('B1a: a held "didn’t go through" is hidden when the forced edit_today step is rejected; the failure is kept (S2)', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([reply('The adjustment didn’t go through; keep the warm-ups controlled.'), [bad400]]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_2), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.requests[1]?.toolChoice).toEqual({ type: 'function', name: 'edit_today' });
    expect(r.status).toBe('completed');
    expect(shown(r)).toEqual([]);
    expect(r.hiddenLines.map((h) => h.detail)).toEqual([FAILURE_CLAIM_DETAIL]);
    // S2: the outcome is honest and the forced step's own failure is kept.
    expect(r.note).toBe('No change made.');
    expect(r.failure).toMatchObject({ kind: 'bad_request', status: 400, requestId: 'req_400' });
    expect(r.toolLog.at(-1)).toMatchObject({ tool: 'edit_today', outcome: 'failed' });
    expect(r.toolLog.at(-1)?.text).toContain('HTTP 400');
    const turn = await s.repos.coach.getTurn(r.turnId);
    expect(turn?.failure?.requestId).toBe('req_400');
    expect(turn?.status).toBe('completed');
  });

  it('B1a: the held answer’s other sentences still show when the forced step is rejected', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([reply('Keep the warm-ups controlled.'), [{ type: 'error', error: 'unavailable', failure: { kind: 'unavailable', status: 503 } }]]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_2), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(r.status).toBe('completed');
    expect(shown(r)).toEqual(['Keep the warm-ups controlled.']);
    expect(r.note).toBe('No change made.');
    expect(r.failure).toMatchObject({ kind: 'unavailable', status: 503 });
  });

  it('B1b: "didn’t go through" next to a committed card is hidden', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([reply('Keep them controlled.'), [call('edit_today', raise('It’s too light')), { type: 'completed' }], reply('The change didn’t go through. Keep the bar path tight.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_2), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(shown(r)).toEqual(['Keep the bar path tight.']);
    expect(r.failure).toBeUndefined();
  });

  it('B1: only a write tool’s own unapplied result backs a failure claim', () => {
    const tools = [{ name: 'edit_today', effect: 'write' }, { name: 'get_active_session', effect: 'read' }, { name: 'think_harder', effect: 'read' }];
    const line = (tool: string, outcome: ToolLogLine['outcome'], text = 'x') => ({ tool, outcome, text, actionId: null });
    expect(failureBackedBy([line('reply', 'not_allowed', 'Answer in text; asked to change.')], tools)).toBe(false);
    expect(failureBackedBy([line('edit_today', 'not_allowed', 'Only one call at a time; the others were ignored.')], tools)).toBe(false);
    expect(failureBackedBy([line('think_harder', 'not_allowed'), line('get_active_session', 'not_allowed', 'Read limit reached.')], tools)).toBe(false);
    for (const o of ['stale', 'rejected', 'invalid_args', 'not_allowed', 'proposed'] as const) expect(failureBackedBy([line('edit_today', o)], tools), o).toBe(true);
    expect(failureBackedBy([line('edit_today', 'stale'), line('edit_today', 'committed')], tools)).toBe(false);
  });

  it('B2: declines, deferrals and contented feedback are not change requests', () => {
    for (const t of [
      "I'll fix it myself",
      "Leave it, I'll sort it out",
      "Not now, I'll change it later",
      "Don't bump it",
      'The warm-up felt too easy but working sets were perfect',
      "Don't bump it, leave it, I'll sort it out",
      'Leave the rows, I’ll sort it out',
      'No need to fix them',
      'I will adjust the weights myself',
    ]) {
      expect(asksLiveChange(t), t).toBe(false);
      expect(mentionsTodaysSets(t), t).toBe(false);
    }
    // Still asks.
    for (const t of [BEN_2, 'Fix them then', 'Never mind, make the rows heavier', 'Sets were fine but make the rows heavier', 'Make the rows warm up heavier']) expect(asksLiveChange(t), t).toBe(true);
  });

  it('B2: "I’ll fix it myself" with an edit_today call is offered, never applied', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', raise("I'll fix it myself")), { type: 'completed' }], reply('Ok.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words("I'll fix it myself"), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.map((c) => c.record.status)).not.toContain('committed');
    expect(r.offer).toBe('adjust_today');
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });

  it('B2: "Don’t bump it, leave it, I’ll sort it out" is answered in text, never forced to edit_today', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([reply('Ok, over to you.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words("Don't bump it, leave it, I'll sort it out"), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.requests).toHaveLength(1);
    expect(shown(r)).toEqual(['Ok, over to you.']);
  });

  it('S1: a complaint about the load never applies a structural edit; it is offered', async () => {
    const s = await store();
    await saved(s, workout());
    const remove = { baseVersion: 7, ops: [{ op: 'remove', sessionExerciseId: id(30) }], reason: 'Too light.', benAsked: true, benQuote: 'It’s too light' };
    const model = new ScriptedCoachModel([[call('edit_today', remove), { type: 'completed' }], reply('Want me to drop it?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_2), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.map((c) => c.record.status)).not.toContain('committed');
    expect((await s.repos.sessions.get(SESSION))?.exercises.map((e) => e.id)).toContain(id(30));
  });

  it('S3: true statements are not failure claims', () => {
    for (const t of ['I can’t change completed sets; edit the log instead.', 'I can’t make that call for you.', 'It didn’t land well with your elbow.', 'That didn’t go well.']) expect(claimsChangeFailed(t), t).toBe(false);
    for (const t of ['I couldn’t apply it.', 'I wasn’t able to change the weights.', 'It didn’t go through.', 'That wasn’t saved.', 'The change didn’t land.']) expect(claimsChangeFailed(t), t).toBe(true);
  });

  it('S5: a long quoted echo of the request is dropped from the failure message; short names stay', () => {
    expect(scrubFailureMessage("Invalid schema for function 'edit_today': can't use 'pattern' here")).toBe("Invalid schema for function 'edit_today': can't use 'pattern' here");
    expect(scrubFailureMessage('Invalid input: "It’s too light given eg my set on Friday/sat and the rows" is not valid')).toBe('Invalid input: "…" is not valid');
    expect(scrubFailureMessage("Value 'make the rows warm up heavier please because they felt light' rejected")).toBe("Value '…' rejected");
    expect(scrubFailureMessage('Bad content at input[3]: "Make the rows warm up heavier please because they were')).toBe('Bad content at input[3]: "…');
    expect(scrubFailureMessage("Can't find that model; the thing you asked for isn't on this route")).toBe("Can't find that model; the thing you asked for isn't on this route");
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { CoachTurnResult, ModelEvent, ModelRequest } from '@fizz/coach';
import { OPENAI_RESPONSES_URL, serializeTokens, type SettingsStore } from '@fizz/providers';

import { createPlanModelPort, failureDetailOf, modelErrorOf, transientFailure } from '../src/coach/plan-model-port';
import type { CoachMessage, CoachThread, CoachTurn } from '@fizz/schemas';
import { FOLLOW_TOP_GAP, followOffset, outcomeFor, threadRows } from '../src/coach/sheet-view';
import { slotAfterTurn } from '../src/coach/slot-view';
import { FakeClock, fakeFetch, jsonResponse, MemoryVault } from '../../../packages/providers/test/helpers';

/**
 * Ben's Build B report (21 Oct, real iPhone): "Coach unavailable. Nothing changed." with the
 * provider's reason thrown away, and the line drawn under the sticky `Ready · Back to workout ›`
 * pill. The failure is now split and kept for Why?; the transcript keeps its newest turn in view.
 * Layout parts are source checks; the look goes on Ben's device checklist.
 */

const clock = new FakeClock();

function vault(): MemoryVault {
  const v = new MemoryVault();
  v.tokens = serializeTokens({ clientId: 'c', accessToken: 'AT-1', refreshToken: 'RT-1', idToken: null, tokenType: 'Bearer', expiresAtMs: clock.ms + 3_600_000, earliestRefreshAtMs: null, scopes: ['openid', 'chatgpt.tokens.use.direct'], savedAtMs: clock.ms });
  return v;
}
function settings(): SettingsStore {
  let text: string | null = null;
  return { load: () => Promise.resolve(text), save: (t: string) => ((text = t), Promise.resolve()) };
}
const request: ModelRequest = { model: 'gpt-6.1-sol', instructions: 'Coach.', input: [], tools: [], toolChoice: 'required', parallelToolCalls: false };
async function collect(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('provider failures are split and kept (B)', () => {
  it('a rejected request is request_error; 503, usage-unavailable, 5xx, refusals and a dropped stream stay unavailable', () => {
    expect(modelErrorOf({ kind: 'bad_request', status: 400 })).toBe('request_error');
    expect(modelErrorOf({ kind: 'unsupported_capability', status: 400 })).toBe('request_error');
    expect(modelErrorOf({ kind: 'protocol' })).toBe('request_error');
    expect(modelErrorOf({ kind: 'bad_request', status: 404 })).toBe('model_gone');
    for (const kind of ['unavailable', 'server', 'rate_limited', 'policy_forbidden', 'route_not_supported', 'stream_interrupted', 'incomplete', 'response_failed'] as const) expect(modelErrorOf({ kind }), kind).toBe('unavailable');
  });

  it('only 5xx, 503, a dropped stream or connection are retried; never a limit, a 400 or a timeout', () => {
    expect(['server', 'unavailable', 'stream_interrupted', 'network'].every((kind) => transientFailure({ kind: kind as 'server' }))).toBe(true);
    expect(['usage_limit', 'rate_limited', 'bad_request', 'timeout', 'policy_forbidden'].some((kind) => transientFailure({ kind: kind as 'server' }))).toBe(false);
  });

  it('the detail keeps kind, status, code, message and request ID, never a token', () => {
    expect(failureDetailOf({ kind: 'bad_request', status: 400, code: 'invalid_request_error', message: "Invalid schema for function 'edit_today' (Bearer eyJabc.def.ghi)", requestId: 'req_9' })).toEqual({
      kind: 'bad_request',
      status: 400,
      code: 'invalid_request_error',
      message: "Invalid schema for function 'edit_today' (…)",
      requestId: 'req_9',
    });
  });

  it('a 503 from the route is an unavailable event marked temporary, with its reason and request ID', async () => {
    const { fetch } = fakeFetch({ [OPENAI_RESPONSES_URL]: () => jsonResponse(503, { error: { code: 'subscription_sharing_usage_unavailable', message: 'Busy' } }, { 'x-request-id': 'req_503' }) });
    const events = await collect(createPlanModelPort({ fetch, vault: vault(), settings: settings(), nowMs: clock.now }).stream(request));
    expect(events).toEqual([{ type: 'error', error: 'unavailable', detail: 'Busy', transient: true, failure: { kind: 'unavailable', status: 503, code: 'subscription_sharing_usage_unavailable', message: 'Busy', requestId: 'req_503' } }]);
  });

  it('something thrown inside the app is a coach error, not the service being unavailable', async () => {
    const broken = { ...request, tools: null as unknown as ModelRequest['tools'] };
    const events = await collect(createPlanModelPort({ fetch: fakeFetch({}).fetch, vault: vault(), settings: settings(), nowMs: clock.now }).stream(broken));
    expect(events).toMatchObject([{ type: 'error', error: 'request_error', failure: { kind: 'app_error' } }]);
    expect(events[0]).not.toHaveProperty('transient');
  });
});

describe('the outcome line says which, and Why? shows the recorded reason (B)', () => {
  it('a request error is "Coach error." with Try again; unavailable no longer claims a refusal', () => {
    expect(outcomeFor('failed', 'request_error', false)).toEqual({ text: 'Coach error. Nothing changed.', icon: 'exclamationmark.triangle', retry: true, why: 'The AI service rejected the request (request_error).' });
    expect(outcomeFor('failed', 'unavailable', false)?.why).toBe('The AI service didn’t answer (unavailable).');
  });

  it('with a recorded failure, Why? is the provider’s reason', () => {
    const failure = { kind: 'bad_request', status: 400, code: 'invalid_request_error', message: 'Bad schema', requestId: 'req_1' };
    expect(outcomeFor('failed', 'request_error', false, { failure })?.why).toBe('HTTP 400 · invalid_request_error · Bad schema · request req_1');
    expect(outcomeFor('failed', 'unavailable', false, { failure: { kind: 'stream_interrupted', message: 'The stream ended without response.completed' } })?.why).toBe('stream_interrupted · The stream ended without response.completed');
    // The mid-workout model line keeps its own explanation.
    expect(outcomeFor('failed', 'model_gone', false, { workoutModelGone: true, failure })?.why).not.toContain('HTTP 400');
  });

  it('the Adjust slot shows the same line from the turn result', () => {
    const result = { status: 'failed', error: 'request_error', failure: { kind: 'bad_request', status: 400 }, cards: [], items: [] } as unknown as CoachTurnResult;
    expect(slotAfterTurn(result).outcome).toMatchObject({ text: 'Coach error. Nothing changed.', retry: true });
  });
});

describe('the transcript never draws under the status pill (E)', () => {
  it('following new content shows the newest turn from its start when it is taller than the view', () => {
    expect(followOffset({ contentHeight: 1000, viewportHeight: 400, turnTop: null })).toBe(600);
    // A short newest turn: the end, as before.
    expect(followOffset({ contentHeight: 1000, viewportHeight: 400, turnTop: 800 })).toBe(600);
    // Taller than the view (the keyboard is up): its start, a gap below the top edge.
    expect(followOffset({ contentHeight: 1000, viewportHeight: 300, turnTop: 400 })).toBe(400 - FOLLOW_TOP_GAP);
    expect(followOffset({ contentHeight: 200, viewportHeight: 400, turnTop: 50 })).toBe(0);
  });

  const flat = (s: string) => s.replace(/\s+/g, ' ');
  const screen = flat(readFileSync(join(__dirname, '..', 'src', 'screens', 'coach', 'CoachSheetScreen.tsx'), 'utf8'));

  it('the transcript fills the space below the pill with its own top edge, and follows with followOffset', () => {
    expect(screen).toContain("style={{ flex: 1, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}");
    expect(screen).toContain('scroll.current?.scrollTo({ y: followOffset(transcript.current), animated: false })');
    expect(screen).not.toContain('scrollToEnd');
    // The pill keeps a gap below it and is shorter while the keyboard is up.
    expect(screen).toContain("marginBottom: theme.space['1'], minHeight: keyboardUp ? 44 : 52");
  });

  it('the outcome line wraps; Why? and Try again move down when there is no room', () => {
    const row = screen.slice(screen.indexOf('function OutcomeRow'));
    expect(row).toContain("flexDirection: 'row', flexWrap: 'wrap'");
    expect(row).toContain('flexGrow: 1, flexShrink: 1, flexBasis: 160');
    expect(row).not.toMatch(/position: 'absolute'|marginTop: -/);
  });
});

describe('review coach-fail S2: a forced change step that failed keeps its reason behind Why?', () => {
  const meta = { ownerId: 'owner', version: 1, createdAtUtc: '2026-10-21T17:00:00.000Z', updatedAtUtc: '2026-10-21T17:00:00.000Z' };
  const at = { utc: '2026-10-21T17:00:00.000Z', tz: 'Europe/London' };
  const thread: CoachThread = { ...meta, id: 'th', sessionId: null, title: 'Too light' };
  const messages: CoachMessage[] = [
    { id: 'm1', ownerId: 'owner', threadId: 'th', turnId: 't1', ordinal: 1, createdAt: at, body: { role: 'ben', input: { kind: 'words', text: 'It’s too light', spoken: false } } },
    { id: 'm2', ownerId: 'owner', threadId: 'th', turnId: 't1', ordinal: 2, createdAt: at, body: { role: 'coach', items: [{ kind: 'sentence', text: 'Keep them controlled.' }], actionIds: [], note: 'No change made.', offer: null, hiddenLines: [], complete: true } },
  ];
  const turn = (failure?: CoachTurn['failure']): CoachTurn => ({ ...meta, id: 't1', threadId: 'th', kind: 'workout', status: 'completed', error: null, ...(failure === undefined ? {} : { failure }), model: 'm', contextHash: 'h', startedAt: at, endedAtUtc: at.utc, toolLog: [] });
  const rows = (t: CoachTurn) => threadRows({ thread, messages, turns: new Map([['t1', t]]), actionsByTurn: new Map() });

  it('with a kept failure the note has Why? and Try again; without one it is the plain note', () => {
    expect(rows(turn({ kind: 'bad_request', status: 400, requestId: 'req_400' })).at(-1)).toMatchObject({ kind: 'outcome', text: 'No change made.', why: 'HTTP 400 · bad_request · request req_400', retry: true });
    expect(rows(turn()).at(-1)).toMatchObject({ kind: 'note', text: 'No change made.' });
  });
});

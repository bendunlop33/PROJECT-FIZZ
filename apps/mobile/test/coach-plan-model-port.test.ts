import { describe, expect, it } from 'vitest';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { OPENAI_RESPONSES_URL, parseConnectionSettings, serializeTokens, type SettingsStore } from '@fizz/providers';

import { createPlanModelPort, modelErrorOf } from '../src/coach/plan-model-port';
import { FakeClock, fakeFetch, jsonResponse, MemoryVault, sse, streamResponseOf } from '../../../packages/providers/test/helpers';

/**
 * The real coach model port over the plan route, with a fake fetch. Unit only:
 * spike S3 on Ben's iPhone still has to show the route accepts it.
 */

const clock = new FakeClock();

function vaultWithTokens(expiresInMs = 3_600_000): MemoryVault {
  const v = new MemoryVault();
  v.tokens = serializeTokens({
    clientId: 'client_1',
    accessToken: 'AT-1',
    refreshToken: 'RT-1',
    idToken: null,
    tokenType: 'Bearer',
    expiresAtMs: clock.ms + expiresInMs,
    earliestRefreshAtMs: null,
    scopes: ['openid', 'chatgpt.tokens.use.direct'],
    savedAtMs: clock.ms,
  });
  return v;
}

function memorySettings(): SettingsStore & { text: string | null } {
  const s = { text: null as string | null, load: () => Promise.resolve(s.text), save: (t: string) => ((s.text = t), Promise.resolve()) };
  return s;
}

const request: ModelRequest = {
  model: 'gpt-6.1-sol',
  instructions: 'Coach.',
  input: [
    { type: 'message', role: 'developer', content: 'YOUR DATA' },
    { type: 'function_call', callId: 'c1', name: 'get_active_session', arguments: '{}' },
    { type: 'function_call_output', callId: 'c1', output: '{"status":"ok"}' },
  ],
  tools: [{ type: 'function', name: 'reply', description: 'Reply', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
  toolChoice: 'required',
  parallelToolCalls: false,
};

async function collect(it: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('plan model port (ADR 0020 C5, unproven on the device until S3)', () => {
  it('sends a plan-safe request (call_id, forced tool choice, no parallel calls) and streams heartbeats, reply pieces and the call', async () => {
    const { fetch, calls } = fakeFetch({
      [OPENAI_RESPONSES_URL]: () =>
        streamResponseOf([
          sse([
            { type: 'response.created', response: { id: 'r1' } },
            { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc1', call_id: 'c2', name: 'reply' } },
            { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"message":"Hi."' },
            { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c2', name: 'reply', arguments: '{"message":"Hi.","offer":null}' } },
            { type: 'response.completed', response: { id: 'r1' } },
          ]),
        ]),
    });
    const port = createPlanModelPort({ fetch, vault: vaultWithTokens(), settings: memorySettings(), nowMs: clock.now });
    const events = await collect(port.stream(request));
    expect(events).toEqual([
      { type: 'heartbeat' },
      { type: 'heartbeat' },
      { type: 'tool_call_delta', name: 'reply', delta: '{"message":"Hi."' },
      { type: 'tool_call', callId: 'c2', name: 'reply', arguments: '{"message":"Hi.","offer":null}' },
      { type: 'heartbeat' },
      { type: 'completed' },
    ]);
    const body = JSON.parse(calls[0]?.init.body ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'gpt-6.1-sol', tool_choice: 'required', parallel_tool_calls: false, store: false, stream: true });
    expect(body.input).toEqual([
      { type: 'message', role: 'developer', content: 'YOUR DATA' },
      { type: 'function_call', call_id: 'c1', name: 'get_active_session', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: '{"status":"ok"}' },
    ]);
    expect(body).not.toHaveProperty('text');
    expect(calls[0]?.init.headers.Authorization).toBe('Bearer AT-1');
  });

  it('a usage limit pauses the coach (sticky in settings) and is an error event, never a reply; no other route is tried', async () => {
    const { fetch, calls } = fakeFetch({ [OPENAI_RESPONSES_URL]: () => jsonResponse(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Limit' } }) });
    const settings = memorySettings();
    const events = await collect(createPlanModelPort({ fetch, vault: vaultWithTokens(), settings, nowMs: clock.now }).stream(request));
    expect(events).toEqual([{ type: 'error', error: 'usage_limit', detail: 'Limit', failure: { kind: 'usage_limit', status: 429, code: 'subscription_sharing_usage_limit_exceeded', message: 'Limit' } }]);
    expect(parseConnectionSettings(settings.text).lastFailure?.kind).toBe('usage_limit');
    expect(calls.map((c) => c.url)).toEqual([OPENAI_RESPONSES_URL]);
  });

  it('not signed in: auth_expired with no request sent', async () => {
    const { fetch, calls } = fakeFetch({});
    const events = await collect(createPlanModelPort({ fetch, vault: new MemoryVault(), settings: memorySettings(), nowMs: clock.now }).stream(request));
    expect(events).toMatchObject([{ type: 'error', error: 'auth_expired' }]);
    expect(calls).toEqual([]);
  });

  it('maps failures to honest kinds', () => {
    expect(modelErrorOf({ kind: 'network' })).toBe('network');
    expect(modelErrorOf({ kind: 'not_eligible' })).toBe('not_eligible');
    expect(modelErrorOf({ kind: 'bad_request', code: 'model_not_found' })).toBe('model_gone');
    expect(modelErrorOf({ kind: 'server' })).toBe('unavailable');
    expect(modelErrorOf({ kind: 'stream_interrupted' })).toBe('unavailable');
  });
});

describe('reasoning effort (Coach v3, ADR 0027; unproven on the plan route until the device test)', () => {
  const ok = () =>
    streamResponseOf([
      sse([
        { type: 'response.created', response: { id: 'r1' } },
        { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c2', name: 'reply', arguments: '{"message":"Hi.","offer":null}' } },
        { type: 'response.completed', response: { id: 'r1' } },
      ]),
    ]);
  const bodyOf = (c: { init: { body?: string } } | undefined) => JSON.parse(c?.init.body ?? '{}') as Record<string, unknown>;

  it('sent as reasoning.effort while unknown; a success marks the model supported', async () => {
    const { fetch, calls } = fakeFetch({ [OPENAI_RESPONSES_URL]: ok });
    const settings = memorySettings();
    const events = await collect(createPlanModelPort({ fetch, vault: vaultWithTokens(), settings, nowMs: clock.now }).stream({ ...request, effort: 'low' }));
    expect(events.at(-1)).toEqual({ type: 'completed' });
    expect(bodyOf(calls[0]).reasoning).toEqual({ effort: 'low' });
    expect(parseConnectionSettings(settings.text).reasoning).toEqual({ 'gpt-6.1-sol': 'supported' });
  });

  it('a 400 with it is retried once without it; the model is marked rejected and it is not sent again', async () => {
    const { fetch, calls } = fakeFetch({ [OPENAI_RESPONSES_URL]: [() => jsonResponse(400, { error: { message: 'Unsupported parameter: reasoning', param: 'reasoning' } }), ok] });
    const settings = memorySettings();
    const port = createPlanModelPort({ fetch, vault: vaultWithTokens(), settings, nowMs: clock.now });
    const events = await collect(port.stream({ ...request, effort: 'high' }));
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'completed' });
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[0]).reasoning).toEqual({ effort: 'high' });
    expect(bodyOf(calls[1])).not.toHaveProperty('reasoning');
    expect(parseConnectionSettings(settings.text).reasoning).toEqual({ 'gpt-6.1-sol': 'rejected' });
    await collect(port.stream({ ...request, effort: 'medium' }));
    expect(bodyOf(calls[2])).not.toHaveProperty('reasoning');
  });

  it('a 400 that persists without it is shown as it is (no loop, not marked); other failures are never retried', async () => {
    const { fetch, calls } = fakeFetch({ [OPENAI_RESPONSES_URL]: () => jsonResponse(400, { error: { message: 'Bad input' } }) });
    const settings = memorySettings();
    const events = await collect(createPlanModelPort({ fetch, vault: vaultWithTokens(), settings, nowMs: clock.now }).stream({ ...request, effort: 'low' }));
    // 21 Oct: a request the route rejected is a request error with its reason, not "unavailable".
    expect(events).toMatchObject([{ type: 'error', error: 'request_error', failure: { kind: 'bad_request', status: 400, message: 'Bad input' } }]);
    expect(calls).toHaveLength(2);
    expect(parseConnectionSettings(settings.text).reasoning).toBeUndefined();
    const limited = fakeFetch({ [OPENAI_RESPONSES_URL]: () => jsonResponse(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Limit' } }) });
    await collect(createPlanModelPort({ fetch: limited.fetch, vault: vaultWithTokens(), settings: memorySettings(), nowMs: clock.now }).stream({ ...request, effort: 'low' }));
    expect(limited.calls).toHaveLength(1);
  });

  it('no effort: no reasoning field', async () => {
    const { fetch, calls } = fakeFetch({ [OPENAI_RESPONSES_URL]: ok });
    await collect(createPlanModelPort({ fetch, vault: vaultWithTokens(), settings: memorySettings(), nowMs: clock.now }).stream(request));
    expect(bodyOf(calls[0])).not.toHaveProperty('reasoning');
  });
});


import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_REQUEST_FIELDS,
  OPENAI_RESPONSES_URL,
  buildPlanRequestBody,
  createSseParser,
  planRequestProblems,
  streamResponse,
  type PlanResponsesRequest,
} from '../src';
import { FakeClock, fakeFetch, jsonResponse, sse, streamResponseOf, textResponse } from './helpers';

const request: PlanResponsesRequest = {
  model: 'gpt-6.1-sol',
  instructions: 'Reply with exactly: OK',
  input: [{ type: 'message', role: 'user', content: 'Reply with OK' }],
};

describe('SSE parser', () => {
  it('handles chunks split anywhere, CRLF split across chunks, multi-line data and comments', () => {
    const text = ': keep-alive\r\nevent: a\r\ndata: {"x":\r\ndata: 1}\r\n\r\nevent: b\ndata: two\n\n';
    for (let cut = 0; cut <= text.length; cut += 1) {
      const p = createSseParser();
      const events = [...p.push(text.slice(0, cut)), ...p.push(text.slice(cut)), ...p.end()];
      expect(events).toEqual([
        { event: 'a', data: '{"x":\n1}' },
        { event: 'b', data: 'two' },
      ]);
    }
  });

  it('flushes a final event without a trailing blank line', () => {
    const p = createSseParser();
    expect(p.push('data: last')).toEqual([]);
    expect(p.end()).toEqual([{ event: null, data: 'last' }]);
  });
});

describe('plan request body', () => {
  it('always sets store:false and stream:true and nothing forbidden', () => {
    const body = buildPlanRequestBody(request);
    expect(body).toEqual({ ...request, store: false, stream: true });
    for (const f of FORBIDDEN_REQUEST_FIELDS) expect(body).not.toHaveProperty(f);
  });

  it('includes function tools and tool settings', () => {
    const body = buildPlanRequestBody({
      ...request,
      tools: [{ type: 'function', name: 'log_set', description: 'Log a set', parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] }, strict: true }],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    });
    expect(body.tools).toHaveLength(1);
    expect(body.parallel_tool_calls).toBe(false);
  });

  it('carries the coach’s structured reply shape: strict functions forced with tool_choice "required"; text.format is not sent (ADR 0019, PM decision 10 Oct)', () => {
    const reply = {
      type: 'function' as const,
      name: 'reply',
      description: 'Your reply',
      strict: true,
      parameters: { type: 'object', properties: { message: { type: 'string' }, offer: { anyOf: [{ type: 'string', enum: ['adjust_today'] }, { type: 'null' }] } }, required: ['message', 'offer'], additionalProperties: false },
    };
    const body = buildPlanRequestBody({ ...request, tools: [reply], tool_choice: 'required', parallel_tool_calls: false });
    expect(body).toMatchObject({ tool_choice: 'required', parallel_tool_calls: false, tools: [{ name: 'reply', strict: true }] });
    // The plan docs neither allow nor forbid `text`; the guard keeps it out until a device test says otherwise.
    expect(planRequestProblems({ ...request, text: { format: { type: 'json_schema' } } } as unknown as PlanResponsesRequest)).toContain('unknown field "text"');
  });

  it.each(['temperature', 'max_output_tokens', 'previous_response_id', 'top_p', 'metadata', 'user', 'truncation', 'background'])(
    'rejects %s even when a caller casts around the type',
    (field) => {
      const bad: PlanResponsesRequest = Object.assign({}, request, { [field]: 1 });
      expect(() => buildPlanRequestBody(bad)).toThrow(/not allowed/);
    },
  );

  it('rejects overriding store/stream, system messages, hosted tools and unknown fields', () => {
    expect(planRequestProblems({ ...request, store: true } as unknown as PlanResponsesRequest)).toContain('"store" is fixed by the client');
    expect(planRequestProblems({ ...request, input: [{ type: 'message', role: 'system', content: 'x' }] } as unknown as PlanResponsesRequest).join()).toMatch(/system-role/);
    expect(planRequestProblems({ ...request, tools: [{ type: 'file_search' }] } as unknown as PlanResponsesRequest).join()).toMatch(/only function tools/);
    expect(planRequestProblems({ ...request, reasoning: {} } as unknown as PlanResponsesRequest)).toContain('unknown field "reasoning"');
    expect(planRequestProblems({ ...request, model: '' })).toContain('model is required');
  });
});

describe('streamResponse', () => {
  const completed = { type: 'response.completed', response: { id: 'resp_1', model: 'gpt-6.1-sol', usage: { input_tokens: 12, output_tokens: 1, total_tokens: 13 } } };

  it('streams deltas split across chunks and succeeds only on response.completed', async () => {
    const clock = new FakeClock();
    const payload = sse([
      { type: 'response.created', response: { id: 'resp_1', model: 'gpt-6.1-sol' } },
      { type: 'response.output_text.delta', delta: 'O' },
      { type: 'response.output_text.delta', delta: 'K' },
      { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_1', name: 'log_set', arguments: '{}' } },
      completed,
    ]);
    const chunks = [payload.slice(0, 37), payload.slice(37, 90), payload.slice(90)];
    const { fetch, calls } = fakeFetch({
      [OPENAI_RESPONSES_URL]: () => {
        clock.advance(250);
        return streamResponseOf(chunks, 200, { 'x-request-id': 'req_9' });
      },
    });
    const deltas: string[] = [];
    const r = await streamResponse(request, { fetch, accessToken: 'AT', nowMs: clock.now, onTextDelta: (d) => deltas.push(d) });
    expect(calls[0]?.init.headers.Authorization).toBe('Bearer AT');
    expect(calls[0]?.json).toMatchObject({ store: false, stream: true, model: 'gpt-6.1-sol' });
    expect(deltas).toEqual(['O', 'K']);
    expect(r).toMatchObject({
      ok: true,
      value: {
        text: 'OK',
        responseId: 'resp_1',
        model: 'gpt-6.1-sol',
        usage: { inputTokens: 12, outputTokens: 1, totalTokens: 13 },
        functionCalls: [{ callId: 'call_1', name: 'log_set', arguments: '{}' }],
        requestId: 'req_9',
        firstTokenMs: 250,
      },
    });
  });

  it('reports every event as it arrives, function calls as soon as their item is done', async () => {
    const clock = new FakeClock();
    const { fetch } = fakeFetch({
      [OPENAI_RESPONSES_URL]: () =>
        streamResponseOf([
          sse([
            { type: 'response.created', response: { id: 'resp_1' } },
            { type: 'response.function_call_arguments.delta', delta: '{"mess' },
            { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'reply', arguments: '{"message":"Hi","offer":null}' } },
            { type: 'response.output_text.delta', delta: 'stray' },
            completed,
          ]),
        ]),
    });
    const seen: unknown[] = [];
    const r = await streamResponse(request, { fetch, accessToken: 'AT', nowMs: clock.now, onEvent: (e) => seen.push(e) });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([
      { type: 'event', eventType: 'response.created' },
      { type: 'event', eventType: 'response.function_call_arguments.delta' },
      { type: 'function_call', call: { callId: 'c1', name: 'reply', arguments: '{"message":"Hi","offer":null}' } },
      { type: 'text_delta', delta: 'stray' },
      { type: 'event', eventType: 'response.completed' },
    ]);
  });

  it('maps a usage-limit response.failed that arrives mid-stream, keeping the partial text', async () => {
    const clock = new FakeClock();
    const { fetch } = fakeFetch({
      [OPENAI_RESPONSES_URL]: () =>
        streamResponseOf([
          sse([
            { type: 'response.output_text.delta', delta: 'Partial' },
            { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Limit reached' } } },
          ]),
        ]),
    });
    const r = await streamResponse(request, { fetch, accessToken: 'AT', nowMs: clock.now });
    expect(r).toMatchObject({ ok: false, error: { kind: 'usage_limit', recovery: 'manage_usage', partialText: 'Partial' } });
  });

  it('maps an error event, response.incomplete and a stream that ends early', async () => {
    const clock = new FakeClock();
    const run = async (events: Record<string, unknown>[]) => {
      const { fetch } = fakeFetch({ [OPENAI_RESPONSES_URL]: () => streamResponseOf([sse(events)]) });
      return streamResponse(request, { fetch, accessToken: 'AT', nowMs: clock.now });
    };
    expect(await run([{ type: 'error', error: { code: 'subscription_sharing_usage_unavailable', message: 'x' } }])).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(await run([{ type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }])).toMatchObject({
      ok: false,
      error: { kind: 'incomplete', message: 'The response was incomplete (content_filter)' },
    });
    expect(await run([{ type: 'response.output_text.delta', delta: 'O' }])).toMatchObject({ ok: false, error: { kind: 'stream_interrupted', partialText: 'O' } });
  });

  it('maps HTTP errors before the stream opens (429 usage limit, 403 not eligible)', async () => {
    const clock = new FakeClock();
    const { fetch } = fakeFetch({
      [OPENAI_RESPONSES_URL]: [
        () => jsonResponse(429, { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } }, { 'x-request-id': 'req_l' }),
        () => jsonResponse(403, { error: { code: 'subscription_sharing_user_not_eligible', message: 'no' } }),
      ],
    });
    expect(await streamResponse(request, { fetch, accessToken: 'AT', nowMs: clock.now })).toMatchObject({ ok: false, error: { kind: 'usage_limit', requestId: 'req_l', retryable: false } });
    expect(await streamResponse(request, { fetch, accessToken: 'AT', nowMs: clock.now })).toMatchObject({ ok: false, error: { kind: 'not_eligible', retryable: false } });
  });

  it('parses the whole event stream when the runtime gives no streamed body', async () => {
    const clock = new FakeClock();
    const { fetch } = fakeFetch({ [OPENAI_RESPONSES_URL]: () => textResponse(200, sse([{ type: 'response.output_text.delta', delta: 'OK' }, completed])) });
    expect(await streamResponse(request, { fetch, accessToken: 'AT', nowMs: clock.now })).toMatchObject({ ok: true, value: { text: 'OK' } });
  });

  it('reports a network failure', async () => {
    const clock = new FakeClock();
    const r = await streamResponse(request, { fetch: () => Promise.reject(new Error('offline')), accessToken: 'AT', nowMs: clock.now });
    expect(r).toMatchObject({ ok: false, error: { kind: 'network', partialText: '' } });
  });
});

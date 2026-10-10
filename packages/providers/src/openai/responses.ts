/**
 * Responses API client restricted to the ChatGPT-plan preview rules
 * (https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations,
 * checked 2026-10-09). The same client serves a personal API key later; only
 * the bearer credential differs (research proposal 3).
 *
 * Always: `store: false`, `stream: true`, app-managed history in `input`.
 * Never: temperature, top_p, max_output_tokens, previous_response_id,
 * metadata, user, … (the request type has no such fields, and a runtime
 * guard rejects them if a caller casts around the type).
 * System-role messages are rejected; use `instructions` or developer messages.
 * Tools: function tools only (hosted tools are unsupported on this route).
 */

import { err, objectField, ok, parseJsonObject, readTextSafely, stringField, numberField, type FetchLike, type Result } from '../http';
import { OPENAI_RESPONSES_URL } from './constants';
import { failure, mapApiError, mapStreamError, mapThrown, type ProviderFailure } from './errors';
import { createSseParser, type SseEvent } from './sse';

export type MessageRole = 'user' | 'assistant' | 'developer';

export type InputContentPart = { type: 'input_text'; text: string } | { type: 'output_text'; text: string };

export type ResponsesInputItem =
  | { type: 'message'; role: MessageRole; content: string | readonly InputContentPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface FunctionTool {
  type: 'function';
  name: string;
  description: string;
  /** JSON Schema (strict-compatible subset). */
  parameters: { readonly [key: string]: JsonValue };
  strict: boolean;
}

export type ToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; name: string };

/** The only fields a caller can set. */
export interface PlanResponsesRequest {
  model: string;
  input: readonly ResponsesInputItem[];
  instructions?: string;
  tools?: readonly FunctionTool[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
}

/** Fields the plan route rejects (documented list plus previous_response_id over HTTP). */
export const FORBIDDEN_REQUEST_FIELDS: readonly string[] = [
  'background',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'moderation',
  'multi_agent',
  'prompt',
  'prompt_cache_retention',
  'safety_identifier',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user',
  'previous_response_id',
];

const ALLOWED_FIELDS = new Set(['model', 'input', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls']);

/**
 * Builds the JSON body. Throws (a programming error, not a runtime state) if
 * the request breaks a plan rule.
 */
export function buildPlanRequestBody(request: PlanResponsesRequest): Record<string, unknown> {
  const problems = planRequestProblems(request);
  if (problems.length > 0) throw new TypeError(`Request breaks ChatGPT-plan rules: ${problems.join('; ')}`);
  const body: Record<string, unknown> = { model: request.model, input: request.input };
  if (request.instructions !== undefined) body.instructions = request.instructions;
  if (request.tools !== undefined && request.tools.length > 0) body.tools = request.tools;
  if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice;
  if (request.parallel_tool_calls !== undefined) body.parallel_tool_calls = request.parallel_tool_calls;
  // Set last so nothing can override them.
  body.store = false;
  body.stream = true;
  return body;
}

/** Runtime check for callers that bypass the types (e.g. data parsed from elsewhere). */
export function planRequestProblems(request: PlanResponsesRequest): string[] {
  const problems: string[] = [];
  const raw = request as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_REQUEST_FIELDS.includes(key)) problems.push(`field "${key}" is not allowed`);
    else if (key === 'store' || key === 'stream') problems.push(`"${key}" is fixed by the client`);
    else if (!ALLOWED_FIELDS.has(key)) problems.push(`unknown field "${key}"`);
  }
  if (typeof request.model !== 'string' || request.model === '') problems.push('model is required');
  if (!Array.isArray(request.input)) problems.push('input must be an array');
  else {
    for (const item of request.input as readonly unknown[]) {
      const rec = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
      if (rec.role === 'system') problems.push('system-role messages are rejected; use instructions or a developer message');
      const t = rec.type;
      if (t !== 'message' && t !== 'function_call' && t !== 'function_call_output') problems.push(`input item type "${String(t)}" is not supported`);
    }
  }
  for (const tool of request.tools ?? []) {
    if ((tool as { type: unknown }).type !== 'function') problems.push('only function tools are supported on this route');
  }
  return problems;
}

// ---------- Streaming call ----------

export interface FunctionCallOut {
  callId: string;
  name: string;
  arguments: string;
}

export interface ResponseUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface StreamedResponse {
  text: string;
  responseId: string | null;
  model: string | null;
  usage: ResponseUsage | null;
  functionCalls: FunctionCallOut[];
  requestId: string | null;
  /** From request start to the first text delta (null if no text). */
  firstTokenMs: number | null;
  totalMs: number;
  eventCount: number;
}

export interface StreamFailure extends ProviderFailure {
  /** Text received before the failure (shown only as diagnostic). */
  partialText: string;
  totalMs: number;
}

/**
 * Progress while a response streams, for the coach's turn loop: the
 * first-event timeout counts from the request to the first event of any
 * kind (ADR 0019 §7), and a function call is handed over as soon as its item
 * is done, so a tool can run before the stream ends.
 */
export type StreamProgress =
  | { type: 'text_delta'; delta: string }
  | { type: 'function_call'; call: FunctionCallOut }
  | { type: 'event'; eventType: string };

export interface StreamOptions {
  fetch: FetchLike;
  accessToken: string;
  nowMs: () => number;
  /** Called for each text delta (live display). */
  onTextDelta?: (delta: string) => void;
  /** Called for every parsed stream event (see `StreamProgress`). */
  onEvent?: (progress: StreamProgress) => void;
  /** Whole-call limit, including streaming. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_STREAM_TIMEOUT_MS = 120_000;

/**
 * Sends one plan-safe request and consumes the stream. Success only after
 * `response.completed`; `response.failed`, `response.incomplete`, `error`
 * events and a stream that ends early are failures.
 */
export async function streamResponse(request: PlanResponsesRequest, options: StreamOptions): Promise<Result<StreamedResponse, StreamFailure>> {
  const started = options.nowMs();
  const body = JSON.stringify(buildPlanRequestBody(request));
  const controller = new AbortController();
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS);
  const onOuterAbort = () => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onOuterAbort);
  const acc = newAccumulator();
  const fail = (f: ProviderFailure): { ok: false; error: StreamFailure } => err({ ...f, partialText: acc.text, totalMs: options.nowMs() - started });

  try {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await options.fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      return fail(mapThrown(e, state.timedOut));
    }
    acc.requestId = response.headers.get('x-request-id');
    if (!response.ok) {
      return fail(mapApiError(response.status, await readTextSafely(response), acc.requestId));
    }

    const parser = createSseParser();
    const handle = (events: SseEvent[]): ProviderFailure | 'done' | null => {
      for (const ev of events) {
        const outcome = applyEvent(acc, ev, () => options.nowMs() - started, options.onTextDelta, options.onEvent);
        if (outcome !== null) return outcome;
      }
      return null;
    };

    let terminal: ProviderFailure | 'done' | null = null;
    try {
      if (response.body !== null) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          terminal = handle(parser.push(decoder.decode(value, { stream: true })));
          if (terminal !== null) {
            void reader.cancel().catch(() => undefined);
            break;
          }
        }
        if (terminal === null) terminal = handle([...parser.push(decoder.decode()), ...parser.end()]);
      } else {
        // Runtime without a streamed body: parse the whole event stream at once.
        const text = await response.text();
        terminal = handle([...parser.push(text), ...parser.end()]);
      }
    } catch (e) {
      return fail(state.timedOut ? mapThrown(e, true) : failure('stream_interrupted', `Stream broke: ${e instanceof Error ? e.message : String(e)}`));
    }

    if (terminal === 'done') {
      return ok({
        text: acc.text,
        responseId: acc.responseId,
        model: acc.model,
        usage: acc.usage,
        functionCalls: acc.functionCalls,
        requestId: acc.requestId,
        firstTokenMs: acc.firstTokenMs,
        totalMs: options.nowMs() - started,
        eventCount: acc.eventCount,
      });
    }
    if (terminal !== null) return fail({ ...terminal, ...(acc.requestId === null ? {} : { requestId: acc.requestId }) });
    return fail(failure('stream_interrupted', 'The stream ended without response.completed', acc.requestId === null ? {} : { requestId: acc.requestId }));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

interface Accumulator {
  text: string;
  responseId: string | null;
  model: string | null;
  usage: ResponseUsage | null;
  functionCalls: FunctionCallOut[];
  requestId: string | null;
  firstTokenMs: number | null;
  eventCount: number;
}

function newAccumulator(): Accumulator {
  return { text: '', responseId: null, model: null, usage: null, functionCalls: [], requestId: null, firstTokenMs: null, eventCount: 0 };
}

/** Applies one event. Returns 'done', a failure, or null to keep reading. */
function applyEvent(
  acc: Accumulator,
  ev: SseEvent,
  elapsedMs: () => number,
  onTextDelta?: (delta: string) => void,
  onEvent?: (progress: StreamProgress) => void,
): ProviderFailure | 'done' | null {
  if (ev.data === '[DONE]') return null;
  const json = parseJsonObject(ev.data);
  if (json === null) return null;
  acc.eventCount += 1;
  const type = stringField(json, 'type') ?? ev.event ?? '';
  const response = objectField(json, 'response');
  if (type !== 'response.output_text.delta' && !(type === 'response.output_item.done' && stringField(objectField(json, 'item'), 'type') === 'function_call')) {
    onEvent?.({ type: 'event', eventType: type });
  }
  if (response !== undefined) {
    acc.responseId = stringField(response, 'id') ?? acc.responseId;
    acc.model = stringField(response, 'model') ?? acc.model;
  }
  switch (type) {
    case 'response.output_text.delta': {
      const delta = stringField(json, 'delta') ?? '';
      if (delta !== '') {
        if (acc.firstTokenMs === null) acc.firstTokenMs = elapsedMs();
        acc.text += delta;
        onTextDelta?.(delta);
        onEvent?.({ type: 'text_delta', delta });
      }
      return null;
    }
    case 'response.output_item.done': {
      const item = objectField(json, 'item');
      if (stringField(item, 'type') === 'function_call') {
        const call = { callId: stringField(item, 'call_id') ?? '', name: stringField(item, 'name') ?? '', arguments: stringField(item, 'arguments') ?? '' };
        acc.functionCalls.push(call);
        onEvent?.({ type: 'function_call', call });
      }
      return null;
    }
    case 'response.completed': {
      acc.usage = readUsage(objectField(response, 'usage'));
      return 'done';
    }
    case 'response.failed':
      return mapStreamError(objectField(response, 'error'), 'response_failed');
    case 'response.incomplete': {
      const reason = stringField(objectField(response, 'incomplete_details'), 'reason') ?? 'unknown reason';
      return failure('incomplete', `The response was incomplete (${reason})`);
    }
    case 'error':
      return mapStreamError(objectField(json, 'error') ?? json, 'response_failed');
    default:
      return null;
  }
}

function readUsage(usage: Record<string, unknown> | undefined): ResponseUsage | null {
  if (usage === undefined) return null;
  return {
    inputTokens: numberField(usage, 'input_tokens') ?? null,
    outputTokens: numberField(usage, 'output_tokens') ?? null,
    totalTokens: numberField(usage, 'total_tokens') ?? null,
  };
}

/**
 * The real `CoachModelPort` (ADR 0020 §7, slice C5): the coach's model calls
 * over the ChatGPT-plan Responses route, with the same Keychain tokens,
 * refresher and streaming client as the S1 test that passed on Ben's iPhone.
 *
 * Not yet proven on the device: spike S3 (a strict function-tool round trip
 * with `tool_choice: "required"` on the plan route) still has to pass before
 * anything here counts as working.
 *
 * - Stream progress becomes coach events as it arrives: argument pieces for
 *   the streamed reply, each complete function call, and every other event as
 *   a heartbeat for the first-event and stall timeouts.
 * - Failures map to honest statuses; sticky ones (limit, not eligible,
 *   expired, region, scope) are remembered in the connection settings so the
 *   sheet pauses. Nothing switches route or produces a reply (rules 1, 7).
 * - (Coach v3, ADR 0027) The request's `effort` goes as `reasoning.effort`
 *   unless the route rejected it for this model before. A 400 before any
 *   stream event, with it sent, is retried once without it; if that works the
 *   model is marked `rejected` and it isn't sent again. A success with it
 *   marks it `supported`. Unproven on the plan route until the device test.
 */

import type { CoachModelPort, ModelErrorKind, ModelEvent, ModelInputItem, ModelRequest } from '@fizz/coach';
import {
  loadConnectionSettings,
  reasoningCapabilityOf,
  recordProviderFailure,
  recordReasoningCapability,
  streamResponse,
  TokenRefresher,
  type ChatGptVault,
  type FailureKind,
  type FetchLike,
  type FunctionTool,
  type JsonValue,
  type ProviderFailure,
  type ResponsesInputItem,
  type SettingsStore,
  type StreamProgress,
} from '@fizz/providers';

export interface PlanModelDeps {
  fetch: FetchLike;
  vault: ChatGptVault;
  settings: SettingsStore;
  nowMs: () => number;
}

const ERROR_BY_KIND: Partial<Record<FailureKind, ModelErrorKind>> = {
  usage_limit: 'usage_limit',
  not_eligible: 'not_eligible',
  unauthorized: 'auth_expired',
  invalid_user: 'auth_expired',
  refresh_unusable: 'auth_expired',
  scope_not_authorized: 'auth_expired',
  network: 'network',
  timeout: 'timeout',
};

/** Provider failure → the coach's error kind. Anything not listed is `unavailable` (Try again). */
export function modelErrorOf(f: Pick<ProviderFailure, 'kind' | 'code' | 'status'>): ModelErrorKind {
  if (f.code === 'model_not_found' || (f.kind === 'bad_request' && f.status === 404)) return 'model_gone';
  return ERROR_BY_KIND[f.kind] ?? 'unavailable';
}

const aborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

/** (Coach v3) A 400 that could be the `reasoning` field: retried once without it. */
export function reasoningRefused(f: Pick<ProviderFailure, 'kind' | 'status'>): boolean {
  return f.status === 400 && (f.kind === 'bad_request' || f.kind === 'unsupported_capability');
}

function toInput(items: readonly ModelInputItem[]): ResponsesInputItem[] {
  return items.map((i): ResponsesInputItem => {
    switch (i.type) {
      case 'message':
        return { type: 'message', role: i.role, content: i.content };
      case 'function_call':
        return { type: 'function_call', call_id: i.callId, name: i.name, arguments: i.arguments };
      case 'function_call_output':
        return { type: 'function_call_output', call_id: i.callId, output: i.output };
    }
  });
}

function toTools(request: ModelRequest): FunctionTool[] {
  return request.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, strict: t.strict, parameters: t.parameters as { readonly [key: string]: JsonValue } }));
}

function eventOf(p: StreamProgress): ModelEvent {
  switch (p.type) {
    case 'text_delta':
      return { type: 'text_delta', delta: p.delta };
    case 'function_call_delta':
      return { type: 'tool_call_delta', name: p.name, delta: p.delta };
    case 'function_call':
      return { type: 'tool_call', callId: p.call.callId, name: p.call.name, arguments: p.call.arguments };
    case 'event':
      return { type: 'heartbeat' };
  }
}

/** A small push-to-pull queue: the stream callback pushes, the turn pulls. */
class EventQueue {
  private items: ModelEvent[] = [];
  private waiting: ((e: ModelEvent | null) => void) | null = null;
  private closed = false;

  push(e: ModelEvent): void {
    if (this.closed) return;
    const w = this.waiting;
    if (w !== null) {
      this.waiting = null;
      w(e);
    } else this.items.push(e);
  }

  close(): void {
    this.closed = true;
    const w = this.waiting;
    this.waiting = null;
    w?.(null);
  }

  next(): Promise<ModelEvent | null> {
    const first = this.items.shift();
    if (first !== undefined) return Promise.resolve(first);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
}

export function createPlanModelPort(deps: PlanModelDeps): CoachModelPort {
  return {
    async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
      const queue = new EventQueue();
      const fail = async (f: ProviderFailure): Promise<void> => {
        await recordProviderFailure(deps.settings, f, deps.nowMs()).catch(() => undefined);
        queue.push({ type: 'error', error: request.signal?.aborted === true ? 'cancelled' : modelErrorOf(f), detail: f.message });
      };
      const run = (async () => {
        const fresh = await new TokenRefresher(deps.vault, { fetch: deps.fetch, nowMs: deps.nowMs }).ensureFresh();
        if (!fresh.ok) {
          await fail(fresh.error);
          return;
        }
        if (request.signal?.aborted === true) {
          queue.push({ type: 'error', error: 'cancelled' });
          return;
        }
        const capability = request.effort === undefined ? 'rejected' : reasoningCapabilityOf(await loadConnectionSettings(deps.settings), request.model);
        let events = 0;
        const send = (withReasoning: boolean) =>
          streamResponse(
            {
              model: request.model,
              instructions: request.instructions,
              input: toInput(request.input),
              tools: toTools(request),
              ...(request.toolChoice === undefined ? {} : { tool_choice: request.toolChoice }),
              parallel_tool_calls: request.parallelToolCalls,
              ...(withReasoning && request.effort !== undefined ? { reasoning: { effort: request.effort } } : {}),
            },
            {
              fetch: deps.fetch,
              accessToken: fresh.value.tokens.accessToken,
              nowMs: deps.nowMs,
              ...(request.signal === undefined ? {} : { signal: request.signal }),
              onEvent: (p) => {
                events += 1;
                queue.push(eventOf(p));
              },
            },
          );
        const withReasoning = capability !== 'rejected';
        let result = await send(withReasoning);
        if (withReasoning && !result.ok && events === 0 && reasoningRefused(result.error) && !aborted(request.signal)) {
          result = await send(false);
          if (result.ok) await recordReasoningCapability(deps.settings, request.model, 'rejected').catch(() => undefined);
        } else if (withReasoning && result.ok && capability === 'unknown') {
          await recordReasoningCapability(deps.settings, request.model, 'supported').catch(() => undefined);
        }
        if (result.ok) queue.push({ type: 'completed' });
        else await fail(result.error);
      })()
        .catch((e: unknown) => {
          queue.push({ type: 'error', error: 'unavailable', detail: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => {
          queue.close();
        });
      try {
        for (;;) {
          const e = await queue.next();
          if (e === null) break;
          yield e;
          if (e.type === 'error' || e.type === 'completed') break;
        }
      } finally {
        queue.close();
        void run;
      }
    },
  };
}

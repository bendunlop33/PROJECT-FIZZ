import type { FunctionToolDefinition } from './function-tools';

/**
 * The coach's view of a model provider (ADR 0020 §7). The real port (slice C5)
 * wraps `streamResponse` and the token refresher from `@fizz/providers`; tests
 * use the scripted fake in `@fizz/coach/testing`. The coach package never
 * imports a network client.
 */

export type ModelInputItem =
  | { type: 'message'; role: 'developer' | 'user' | 'assistant'; content: string }
  | { type: 'function_call'; callId: string; name: string; arguments: string }
  | { type: 'function_call_output'; callId: string; output: string };

export interface ModelRequest {
  model: string;
  instructions: string;
  input: readonly ModelInputItem[];
  /** This turn's registry tools plus the `reply` function (reply-tool.ts). */
  tools: readonly FunctionToolDefinition[];
  /**
   * `required`: every step calls exactly one function, either a registry
   * tool or `reply`; the model has no free-text channel (PM decision 10 Oct).
   * Optional only so older test requests stay valid.
   */
  toolChoice?: 'required';
  /** Always false: the coach makes one call at a time so each write is checked in order. */
  parallelToolCalls: false;
  signal?: AbortSignal;
}

/**
 * Why a call didn't answer. None of these switches the route or produces a
 * canned reply (rule 1, rule 7); each maps to an honest status.
 */
export type ModelErrorKind =
  | 'usage_limit'
  | 'not_eligible'
  | 'auth_expired'
  | 'model_gone'
  | 'unavailable'
  | 'network'
  | 'timeout'
  | 'cancelled';

export type ModelEvent =
  /** Free text outside any function. Never shown as is (see turn.ts). */
  | { type: 'text_delta'; delta: string }
  /**
   * A piece of a function call's arguments while they stream. Only the
   * `reply` function's are used, to show its message sentence by sentence
   * (C6); a registry tool runs only on its complete `tool_call`.
   */
  | { type: 'tool_call_delta'; name: string; delta: string }
  | { type: 'tool_call'; callId: string; name: string; arguments: string }
  /**
   * Any other stream event (`response.created`, `in_progress`, …). Counts
   * for the first-event and stall timeouts (ADR 0020 §7) and nothing else.
   */
  | { type: 'heartbeat' }
  | { type: 'completed' }
  | { type: 'error'; error: ModelErrorKind; detail?: string };

export interface CoachModelPort {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}

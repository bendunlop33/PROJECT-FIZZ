import type { FunctionToolDefinition } from './function-tools';

/**
 * The coach's view of a model provider (ADR 0019 §7). The real port (slice C5)
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
  tools: readonly FunctionToolDefinition[];
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
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; callId: string; name: string; arguments: string }
  | { type: 'completed' }
  | { type: 'error'; error: ModelErrorKind; detail?: string };

export interface CoachModelPort {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}

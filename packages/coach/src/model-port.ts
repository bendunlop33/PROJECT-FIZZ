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
   * Optional only so older test requests stay valid. A named function forces
   * that one call (build 131 review S1: the build nudge forces `propose_workout`).
   */
  toolChoice?: 'required' | { type: 'function'; name: string };
  /** Always false: the coach makes one call at a time so each write is checked in order. */
  parallelToolCalls: false;
  /**
   * (Coach v3, ADR 0027) How hard the model should think: a build `high`, a live-workout turn `low`
   * (`high` after `think_harder`), anything else `medium`. The port sends it only where the route
   * takes it. Absent: the route's default.
   */
  effort?: 'low' | 'medium' | 'high';
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
  /**
   * (21 Oct, Ben's Build B report) The route rejected the request itself (HTTP 400, a malformed
   * response): a fault on our side or the route's, never "the coach is unavailable".
   */
  | 'request_error'
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
  | {
      type: 'error';
      error: ModelErrorKind;
      detail?: string;
      /** (21 Oct) What the provider said, kept on the failed turn for `Why?`. Never tokens or credentials. */
      failure?: ModelFailureDetail;
      /**
       * (21 Oct) A temporary failure (5xx, 503, a dropped stream or connection): the turn retries
       * that model step once before failing (nothing from the step was applied).
       */
      transient?: boolean;
    };

/** (21 Oct) A provider failure as recorded on the turn: kind, HTTP status, code, a short message, request ID. */
export interface ModelFailureDetail {
  /** The provider's failure kind (`bad_request`, `server`, `stream_interrupted`, …). */
  kind: string;
  status?: number;
  code?: string;
  /** Trimmed and scrubbed of anything token-like (`scrubFailureMessage`). */
  message?: string;
  requestId?: string;
}

export interface CoachModelPort {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}

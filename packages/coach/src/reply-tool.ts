import { COACH_REPLY_TOOL_NAME, CoachReplySchema, type CoachReply, type CoachTurnKind } from '@fizz/schemas';
import { strictJsonSchema, type FunctionToolDefinition } from './function-tools';

/**
 * The structured reply (PM decision, 10 Oct 2026: honesty is structural).
 *
 * Every model step must call exactly one function (`tool_choice: required`,
 * `parallel_tool_calls: false`). A change is only ever a call to a registry
 * tool, whose committed result the app renders as a card. Advice,
 * explanation and questions arrive as the `message` field of the `reply`
 * function, which ends the turn. So the model has no channel in which a
 * change "happens" in words: the UI never shows model text as a change, and
 * the claim check (`checkReplyClaims`) is only a backstop that drops a
 * sentence that still talks as if it made one.
 *
 * Why a function and not `text.format`: the plan route's adapter
 * (`PlanResponsesRequest` in `@fizz/providers`) accepts only `model`,
 * `input`, `instructions`, `tools`, `tool_choice` and `parallel_tool_calls`,
 * and the plan docs neither allow nor forbid `text` (ai-import.md §9 item 1,
 * fact-check F1). Function tools are what spike S3 tests anyway, so the reply
 * rides the same path as every other tool and needs no new request field.
 */

const DESCRIPTION =
  'Your reply to Ben, which ends the turn. `message`: advice, explanation or a question in plain sentences. ' +
  'Never say that something was changed, saved, logged, flagged or undone: the app shows every change as a card from the saved result. ' +
  '`offer`: "adjust_today" only when you are offering (not making) a change to today\'s remaining sets and want Ben to accept first; otherwise null.';

export function replyToolDefinition(): FunctionToolDefinition {
  return { type: 'function', name: COACH_REPLY_TOOL_NAME, description: DESCRIPTION, strict: true, parameters: strictJsonSchema(CoachReplySchema) };
}

export type ParsedReply =
  | { ok: true; reply: CoachReply; dropped: string[] }
  | { ok: false; issues: string[] };

/**
 * Parse the `reply` call. An offer is kept only in a workout turn where
 * today's sets could actually be adjusted after Ben accepts; elsewhere it's
 * dropped (and listed), so a "yes" can never open a tool the turn can't have.
 */
export function parseReply(rawArguments: string, turnKind: CoachTurnKind): ParsedReply {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments);
  } catch {
    return { ok: false, issues: ['not JSON'] };
  }
  const r = CoachReplySchema.safeParse(raw);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  const dropped: string[] = [];
  let reply = r.data;
  if (reply.offer !== null && turnKind !== 'workout') {
    dropped.push('offer');
    reply = { ...reply, offer: null };
  }
  return { ok: true, reply, dropped };
}

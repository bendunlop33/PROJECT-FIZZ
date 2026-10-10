import { deriveId, stableStringify } from '@fizz/domain';
import { COACH_TOOL_ARGS, type CoachToolCall, type CoachToolName } from '@fizz/schemas';
import type { z } from 'zod';
import type { TurnRegistry } from './registry';

/**
 * Turning a model function call into a typed `CoachToolCall`. Nothing the
 * model sends is trusted: the tool must be in this turn's registry, the
 * arguments must parse against the Zod schema, and any extra fields (for
 * example a programme change smuggled into `set_next_session_targets`, CC10)
 * are dropped and listed for `Why?` → `Not used`.
 */

export type ParsedToolCall =
  | { ok: true; call: CoachToolCall; opId: string; dropped: string[] }
  | { ok: false; error: 'not_allowed'; line: string }
  | { ok: false; error: 'invalid_args'; line: string; issues: string[] };

/**
 * Idempotency key (ADR 0018 §5): the same call in the same turn, e.g. replayed
 * after a dropped connection, gets the same opId and so changes nothing twice.
 * `parseToolCall` passes `semanticArgs`, so a retry that only rewords the
 * reason or quote is the same operation (review S4).
 */
export function toolOpId(turnId: string, tool: CoachToolName, args: unknown): string {
  return `${turnId}:${tool}:${deriveId(stableStringify(args))}`;
}

/** Text compared by meaning-preserving form: case, spacing, curly quotes and end punctuation don't make a new item. */
export function normaliseContentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:\s]+$/, '');
}

/**
 * The fields that decide what a call does. Free-text explanations (`reason`,
 * `quote`) are dropped; memory and playbook text is normalised; pain-flag
 * exercises are sorted.
 */
export function semanticArgs(call: CoachToolCall): unknown {
  switch (call.tool) {
    case 'adjust_pending_sets':
      return { baseVersion: call.args.baseVersion, exercises: call.args.exercises };
    case 'set_next_session_targets':
      return { ...call.args, targets: call.args.targets.map((t) => ({ exerciseId: t.exerciseId, target: t.target, sets: t.sets })) };
    case 'propose_next_workout_change':
      return { sourceSessionId: call.args.sourceSessionId, sourceVersion: call.args.sourceVersion, changes: call.args.changes };
    case 'set_pain_flag':
      return { exerciseIds: [...new Set(call.args.exerciseIds)].sort(), area: call.args.area };
    case 'save_memory':
      return { text: normaliseContentText(call.args.text) };
    case 'add_playbook_candidate':
      return { text: normaliseContentText(call.args.text), statedBy: call.args.statedBy };
    case 'forget_memory':
    case 'get_active_session':
    case 'get_recent_training':
    case 'get_gym_equipment':
    case 'get_progression_targets':
    case 'get_recent_actions':
      return call.args;
  }
}

/**
 * Turn-independent content keys for the append tools (review S4). A `Try
 * again` starts a new turn, so the opId differs; the store (C3) must treat a
 * live item with the same key as already done and return it instead of
 * writing a second copy: an active pain flag on the same exercise, the same
 * memory text, the same playbook candidate text. Other tools return [] (they
 * are protected by their base version instead).
 */
export function appendContentKeys(call: CoachToolCall): string[] {
  switch (call.tool) {
    case 'set_pain_flag':
      return [...new Set(call.args.exerciseIds)].sort().map((id) => `pain_flag:${id}`);
    case 'save_memory':
      return [`memory:${deriveId(normaliseContentText(call.args.text))}`];
    case 'add_playbook_candidate':
      return [`playbook_candidate:${deriveId(normaliseContentText(call.args.text))}`];
    case 'forget_memory':
    case 'adjust_pending_sets':
    case 'set_next_session_targets':
    case 'propose_next_workout_change':
    case 'get_active_session':
    case 'get_recent_training':
    case 'get_gym_equipment':
    case 'get_progression_targets':
    case 'get_recent_actions':
      return [];
  }
}

function removeAt(value: unknown, path: readonly PropertyKey[], keys: readonly string[]): void {
  let node: unknown = value;
  for (const p of path) {
    if (node === null || typeof node !== 'object') return;
    node = (node as Record<PropertyKey, unknown>)[p];
  }
  if (node === null || typeof node !== 'object') return;
  for (const k of keys) Reflect.deleteProperty(node, k);
}

/** `value` must be the caller's own copy (fresh from `JSON.parse`): unknown keys are deleted in place. */
function parseArgs(schema: z.ZodType, value: unknown): { ok: true; value: unknown; dropped: string[] } | { ok: false; issues: string[] } {
  const dropped: string[] = [];
  // Unknown keys are removed one round at a time (nested objects surface after their parents parse).
  for (let round = 0; round < 8; round += 1) {
    const r = schema.safeParse(value);
    if (r.success) return { ok: true, value: r.data, dropped };
    const unknownKeys = r.error.issues.filter((i) => i.code === 'unrecognized_keys');
    if (unknownKeys.length === 0 || unknownKeys.length !== r.error.issues.length) {
      return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
    }
    for (const issue of unknownKeys) {
      removeAt(value, issue.path, issue.keys);
      for (const k of issue.keys) dropped.push([...issue.path.map(String), k].join('.'));
    }
  }
  return { ok: false, issues: ['too many unknown fields'] };
}

export function parseToolCall(turnId: string, name: string, rawArguments: string, registry: TurnRegistry): ParsedToolCall {
  const decl = registry.tools.find((t) => t.name === name);
  if (decl === undefined) return { ok: false, error: 'not_allowed', line: `Not allowed: ${name}` };
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments);
  } catch {
    return { ok: false, error: 'invalid_args', line: `Couldn't read the coach's request for ${name}. Nothing changed.`, issues: ['not JSON'] };
  }
  const schema: z.ZodType = COACH_TOOL_ARGS[decl.name];
  const parsed = parseArgs(schema, raw);
  if (!parsed.ok) {
    return { ok: false, error: 'invalid_args', line: `Couldn't read the coach's request for ${name}. Nothing changed.`, issues: parsed.issues };
  }
  const call = { tool: decl.name, args: parsed.value } as CoachToolCall;
  return { ok: true, call, opId: toolOpId(turnId, decl.name, semanticArgs(call)), dropped: parsed.dropped };
}

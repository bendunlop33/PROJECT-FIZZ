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
 */
export function toolOpId(turnId: string, tool: CoachToolName, args: unknown): string {
  return `${turnId}:${tool}:${deriveId(stableStringify(args))}`;
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
  return { ok: true, call, opId: toolOpId(turnId, decl.name, call.args), dropped: parsed.dropped };
}

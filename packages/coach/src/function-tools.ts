import { COACH_TOOL_ARGS } from '@fizz/schemas';
import { z } from 'zod';
import type { ToolDeclaration } from './registry';

/**
 * Strict function-tool definitions for the Responses API, generated from the
 * same Zod schemas the app parses with, so the two can't drift (ADR 0019 §7).
 * Strict mode needs every object closed (`additionalProperties: false`) with
 * every property required (optional values are `null`), `anyOf` rather than
 * `oneOf`, and no string length keywords. Length limits are still enforced
 * by Zod when the call is parsed.
 */

export interface FunctionToolDefinition {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
}

const UNSUPPORTED_KEYWORDS = new Set(['$schema', 'minLength', 'maxLength', 'default']);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function strictify(node: Json): Json {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== 'object') return node;
  const out: { [k: string]: Json } = {};
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(k)) continue;
    out[k === 'oneOf' ? 'anyOf' : k] = strictify(v);
  }
  if (out.type === 'object') {
    const props = out.properties;
    const keys = props !== null && typeof props === 'object' && !Array.isArray(props) ? Object.keys(props) : [];
    out.properties = props ?? {};
    out.required = keys;
    out.additionalProperties = false;
  }
  return out;
}

export function functionToolDefinition(tool: ToolDeclaration): FunctionToolDefinition {
  const schema = z.toJSONSchema(COACH_TOOL_ARGS[tool.name], { io: 'input', unrepresentable: 'throw' }) as Json;
  const parameters = strictify(schema) as Record<string, unknown>;
  return { type: 'function', name: tool.name, description: tool.description, strict: true, parameters };
}

export function functionToolDefinitions(tools: readonly ToolDeclaration[]): FunctionToolDefinition[] {
  return tools.map(functionToolDefinition);
}

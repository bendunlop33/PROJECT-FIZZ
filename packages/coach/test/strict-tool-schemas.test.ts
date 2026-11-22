import { describe, expect, it } from 'vitest';
import { functionToolDefinitions, type FunctionToolDefinition } from '../src/function-tools';
import { COACH_TOOLS } from '../src/registry';
import { replyToolDefinition } from '../src/reply-tool';

/**
 * Review coach-fail-21oct S6: Ben's Build B turn ended in an HTTP 400 on the plan route. One suspect
 * was a strict-mode schema keyword the route rejects. This walks every tool definition the coach can
 * send and checks it against the strict structured-outputs subset documented for the Responses API
 * (keywords, string formats, closed objects with every property required, nesting and size limits).
 * It proves the definitions stay inside the documented subset; whether the plan route accepts that
 * whole subset is still a device check (spike S3).
 */

const KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'anyOf', 'enum', 'const', 'description', 'title',
  'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems',
  '$ref', '$defs', 'definitions',
]);
const FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid']);
/** Documented limits: 10 levels of object nesting, 5000 properties, 1000 enum values. */
const MAX_OBJECT_DEPTH = 10;
const MAX_PROPERTIES = 5000;
const MAX_ENUM_VALUES = 1000;

type Node = { [k: string]: unknown };
const isNode = (v: unknown): v is Node => v !== null && typeof v === 'object' && !Array.isArray(v);

interface Report {
  issues: string[];
  objectDepth: number;
  properties: number;
  enumValues: number;
}

function check(def: FunctionToolDefinition): Report {
  const r: Report = { issues: [], objectDepth: 0, properties: 0, enumValues: 0 };
  const walk = (n: unknown, path: string, depth: number): void => {
    if (Array.isArray(n)) {
      n.forEach((x, i) => {
        walk(x, `${path}[${String(i)}]`, depth);
      });
      return;
    }
    if (!isNode(n)) return;
    for (const k of Object.keys(n)) if (!KEYWORDS.has(k)) r.issues.push(`${path}: keyword ${k}`);
    if (typeof n.format === 'string' && !FORMATS.has(n.format)) r.issues.push(`${path}: format ${n.format}`);
    const objectDepth = n.type === 'object' ? depth + 1 : depth;
    r.objectDepth = Math.max(r.objectDepth, objectDepth);
    if (n.type === 'object') {
      if (n.additionalProperties !== false) r.issues.push(`${path}: object not closed`);
      const props = isNode(n.properties) ? Object.keys(n.properties) : [];
      const required = Array.isArray(n.required) ? n.required : [];
      if (props.some((p) => !required.includes(p)) || required.length !== props.length) r.issues.push(`${path}: not every property required`);
      r.properties += props.length;
    }
    if (Array.isArray(n.enum)) r.enumValues += n.enum.length;
    for (const [k, v] of Object.entries(n)) {
      if (k === 'properties' && isNode(v)) for (const [pk, pv] of Object.entries(v)) walk(pv, `${path}.${pk}`, objectDepth);
      else if (k === 'items' || k === 'anyOf' || k === '$defs' || k === 'definitions') walk(v, `${path}.${k}`, objectDepth);
    }
  };
  walk(def.parameters, '$', 0);
  if (def.parameters.type !== 'object') r.issues.push('$: root is not an object');
  if ('anyOf' in def.parameters) r.issues.push('$: root anyOf');
  return r;
}

const ALL = [...functionToolDefinitions(COACH_TOOLS), replyToolDefinition()];

describe('every coach tool schema stays inside the strict-mode subset (review coach-fail S6)', () => {
  it.each(ALL.map((d) => [d.name, d] as const))('%s', (_name, def) => {
    expect(def.strict).toBe(true);
    const r = check(def);
    expect(r.issues).toEqual([]);
    expect(r.objectDepth).toBeLessThanOrEqual(MAX_OBJECT_DEPTH);
    expect(r.properties).toBeLessThanOrEqual(MAX_PROPERTIES);
    expect(r.enumValues).toBeLessThanOrEqual(MAX_ENUM_VALUES);
  });

  it('the walker catches what strict mode rejects', () => {
    const bad: FunctionToolDefinition = {
      type: 'function',
      name: 'x',
      description: 'x',
      strict: true,
      parameters: { type: 'object', properties: { a: { type: 'string', minLength: 1, format: 'uri' }, b: { type: 'object', properties: { c: { type: 'number' } }, required: [] } }, required: ['a'], additionalProperties: false },
    };
    expect(check(bad).issues).toEqual(['$: not every property required', '$.a: keyword minLength', '$.a: format uri', '$.b: object not closed', '$.b: not every property required']);
  });
});

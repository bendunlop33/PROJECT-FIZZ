/**
 * (7 Nov, build 552) Arguments shaped the way a strict-mode model writes them from the declared JSON schema: every
 * property present, every nullable one null, strings and numbers at their smallest declared values. What the declared
 * schema allows, the app's Zod schema must accept.
 */
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Node = { [k: string]: unknown };

export function modelShaped(node: unknown, fill: (path: string) => Json | undefined = () => undefined, path = ''): Json {
  const own = fill(path);
  if (own !== undefined) return own;
  const n = (node ?? {}) as Node;
  if ('const' in n) return n.const as Json;
  if (Array.isArray(n.enum)) return n.enum[0] as Json;
  const options = (n.anyOf ?? n.oneOf) as unknown[] | undefined;
  if (Array.isArray(options)) {
    if (options.some((o) => (o as Node).type === 'null')) return null;
    return modelShaped(options[0], fill, path);
  }
  const types: unknown[] = Array.isArray(n.type) ? (n.type as unknown[]) : [n.type];
  const type = types.includes('null') ? 'null' : types[0];
  switch (type) {
    case 'null':
      return null;
    case 'boolean':
      return false;
    case 'string':
      if (n.format === 'uuid') return '0b0e7a52-3c1d-4f6a-9b1e-2d3c4b5a6f70';
      if (n.format === 'date') return '2026-11-08';
      if (n.format === 'date-time') return '2026-11-08T07:00:00.000Z';
      return 'x';
    case 'integer':
    case 'number': {
      const min = typeof n.minimum === 'number' && n.minimum > -1e9 ? n.minimum : typeof n.exclusiveMinimum === 'number' ? n.exclusiveMinimum + 1 : 1;
      return Math.max(min, 1) <= (typeof n.maximum === 'number' ? n.maximum : Infinity) ? Math.max(min, 1) : min;
    }
    case 'array': {
      const count = typeof n.minItems === 'number' ? n.minItems : 0;
      return Array.from({ length: count }, (_, i) => modelShaped(n.items, fill, `${path}.${String(i)}`));
    }
    case 'object': {
      const props = (n.properties ?? {}) as Record<string, unknown>;
      const out: { [k: string]: Json } = {};
      for (const [k, v] of Object.entries(props)) out[k] = modelShaped(v, fill, path === '' ? k : `${path}.${k}`);
      return out;
    }
    default:
      return null;
  }
}

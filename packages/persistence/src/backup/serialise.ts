import { stableStringify } from '@fizz/domain';

import { Sha256Stream } from './sha256';
import { noYield, type Slicer } from './slice';

/** `stableStringify(undefined)` is `undefined` at run time; a joined array writes it as nothing. */
function stableStringifyOrEmpty(value: unknown): string {
  const out: unknown = stableStringify(value);
  return typeof out === 'string' ? out : '';
}

/**
 * `stableStringify`, emitted piece by piece with `slice()` between array
 * elements (backup review B1), so serialising every table of a multi-year
 * history never holds the JS thread in one go. The concatenated pieces are
 * exactly `stableStringify(value)`.
 */
export async function writeStable(value: unknown, sink: (piece: string) => void, slice: Slicer = noYield): Promise<void> {
  if (value === null || typeof value !== 'object') {
    sink(stableStringifyOrEmpty(value));
    return;
  }
  if (Array.isArray(value)) {
    sink('[');
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) sink(',');
      // Elements (table rows) are small: one synchronous piece each. `[undefined]` joins as `[]`, as in `stableStringify`.
      sink(stableStringifyOrEmpty(value[i]));
      await slice();
    }
    sink(']');
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  sink('{');
  for (const [i, [k, v]] of entries.entries()) {
    sink(`${i > 0 ? ',' : ''}${JSON.stringify(k)}:`);
    await writeStable(v, sink, slice);
  }
  sink('}');
}

/** SHA-256 of `stableStringify(value)`, without building the string. */
export async function stableHash(value: unknown, slice: Slicer = noYield): Promise<string> {
  const hash = new Sha256Stream();
  await writeStable(value, (p) => hash.update(p), slice);
  return hash.digestHex();
}

/**
 * Exactly `JSON.stringify(value, null, indent)`, built with `slice()` between
 * array elements and object members (your-data-merge S1), so a multi-year
 * export never holds the JS thread in one go. For plain data (what an export
 * holds): a value with `toJSON` is written by `JSON.stringify` in one piece.
 */
export async function stringifyPretty(value: unknown, indent = 1, slice: Slicer = noYield): Promise<string> {
  if (!Number.isInteger(indent) || indent < 1 || indent > 10) throw new RangeError('stringifyPretty: indent must be 1-10');
  const pieces: string[] = [];
  const pad = ' '.repeat(indent);
  const reindent = (text: string, depth: number) => (depth === 0 ? text : text.replaceAll('\n', `\n${pad.repeat(depth)}`));
  async function write(v: unknown, depth: number): Promise<void> {
    if (v === null || typeof v !== 'object' || typeof (v as { toJSON?: unknown }).toJSON === 'function') {
      // Raw newlines never occur inside JSON text (they're escaped), so re-indenting is safe.
      // `JSON.stringify` is `undefined` at run time when `toJSON` returns undefined; as an element or member that's `null`.
      const text: unknown = JSON.stringify(v, null, indent);
      pieces.push(reindent(typeof text === 'string' ? text : 'null', depth));
      return;
    }
    const inner = `\n${pad.repeat(depth + 1)}`;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        pieces.push('[]');
        return;
      }
      pieces.push('[');
      for (let i = 0; i < v.length; i += 1) {
        pieces.push(i > 0 ? `,${inner}` : inner);
        const el: unknown = v[i];
        if (el === undefined || typeof el === 'function' || typeof el === 'symbol') pieces.push('null');
        else await write(el, depth + 1);
        await slice();
      }
      pieces.push(`\n${pad.repeat(depth)}]`);
      return;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && typeof x !== 'function' && typeof x !== 'symbol');
    if (entries.length === 0) {
      pieces.push('{}');
      return;
    }
    pieces.push('{');
    for (const [i, [k, x]] of entries.entries()) {
      pieces.push(`${i > 0 ? ',' : ''}${inner}${JSON.stringify(k)}: `);
      await write(x, depth + 1);
      await slice();
    }
    pieces.push(`\n${pad.repeat(depth)}}`);
  }
  await write(value, 0);
  await slice();
  return pieces.join('');
}

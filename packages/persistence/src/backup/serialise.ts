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

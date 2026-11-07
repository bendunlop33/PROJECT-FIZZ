/**
 * Time conversion helpers. Domain functions never read the clock: callers pass
 * `at`/`now` explicitly so every rule is deterministic and replayable.
 */

/** (Perf, 24 Oct) Parsed timestamps: history reads parse the same few thousand many times over. Pure, so safe to keep. */
const parsed = new Map<string, number>();
const PARSED_MAX = 20_000;

/** Parse an ISO-8601 UTC string to epoch milliseconds. */
export function toMs(isoUtc: string): number {
  const hit = parsed.get(isoUtc);
  if (hit !== undefined) return hit;
  // eslint-disable-next-line no-restricted-globals -- pure parse, not a clock read
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid timestamp: ${isoUtc}`);
  if (parsed.size >= PARSED_MAX) parsed.clear();
  parsed.set(isoUtc, ms);
  return ms;
}

/**
 * `list` newest first by `utcOf`, each timestamp parsed once (perf, 24 Oct: a comparator calling `toMs` parsed every
 * timestamp ~log n times over years of history). Equal times keep their order (a stable sort).
 */
export function sortNewestFirst<T>(list: readonly T[], utcOf: (x: T) => string): T[] {
  return list
    .map((x) => ({ x, ms: toMs(utcOf(x)) }))
    .sort((a, b) => b.ms - a.ms)
    .map((e) => e.x);
}

/** Format epoch milliseconds as an ISO-8601 UTC string. */
export function toIso(ms: number): string {
  // eslint-disable-next-line no-restricted-globals -- pure format, not a clock read
  return new Date(ms).toISOString();
}

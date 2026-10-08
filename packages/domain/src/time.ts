/**
 * Time conversion helpers. Domain functions never read the clock: callers pass
 * `at`/`now` explicitly so every rule is deterministic and replayable.
 */

/** Parse an ISO-8601 UTC string to epoch milliseconds. */
export function toMs(isoUtc: string): number {
  // eslint-disable-next-line no-restricted-globals -- pure parse, not a clock read
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid timestamp: ${isoUtc}`);
  return ms;
}

/** Format epoch milliseconds as an ISO-8601 UTC string. */
export function toIso(ms: number): string {
  // eslint-disable-next-line no-restricted-globals -- pure format, not a clock read
  return new Date(ms).toISOString();
}

/**
 * The app's one clock read. Domain and probe logic take `nowMs` as an argument
 * (CLAUDE.md conventions); screens and native runners get it from here so the
 * no-restricted-globals rule stays meaningful everywhere else.
 */
export function nowMs(): number {
  // eslint-disable-next-line no-restricted-globals -- the single sanctioned clock read
  return Date.now();
}

/** Format epoch ms as ISO-8601 UTC. */
export function isoUtc(ms: number): string {
  // eslint-disable-next-line no-restricted-globals -- formatting, not a clock read
  return new Date(ms).toISOString();
}

/** A `Date` for a native picker's value or bounds (an injected instant, never a clock read). */
export function dateAt(ms: number): Date {
  // eslint-disable-next-line no-restricted-globals -- converting an injected instant, not reading the clock
  return new Date(ms);
}

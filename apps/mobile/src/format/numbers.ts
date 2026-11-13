/** Rest and work timers: `m:ss` (design-system §3). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** Counts with thousands separators (`4,105`). */
export function formatCount(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** `1 workout` / `3 workouts`. */
export function plural(n: number, one: string, many: string, locale?: string): string {
  return `${formatCount(n, locale)} ${n === 1 ? one : many}`;
}

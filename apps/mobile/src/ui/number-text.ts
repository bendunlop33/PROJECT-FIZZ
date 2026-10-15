/** Typed number text → value (`,` accepted as the decimal mark). Null when empty or not a non-negative number. */
export function parseNumber(text: string): number | null {
  const t = text.replace(',', '.').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * What a number field shows when its value changes (review S5): keep what Ben
 * is typing while it still means the value (`100.` while typing 100.5), but
 * follow the value whenever it changed elsewhere, e.g. `+` tapped while the
 * field is focused. The field never contradicts the Log label.
 */
export function nextFieldText(current: string, value: number | null): string {
  if (parseNumber(current) === value) return current;
  return value === null ? '' : String(value);
}

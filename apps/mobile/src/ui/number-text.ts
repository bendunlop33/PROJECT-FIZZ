import { cardioTimeFieldText, parseCardioTime } from '@fizz/domain';

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
export function nextFieldText(current: string, value: number | null, format: FieldFormat = NUMBER_FORMAT): string {
  if (format.parse(current) === value) return current;
  return value === null ? '' : format.show(value);
}

/** How a field reads and shows its value: a plain number, or a cardio time (`20:34`, review cardio S5). */
export interface FieldFormat {
  parse: (text: string) => number | null;
  show: (value: number) => string;
}

export const NUMBER_FORMAT: FieldFormat = { parse: parseNumber, show: String };

/** A cardio time in seconds, typed and shown as the machine shows it: `20:34` (or `20.34` on the number pad), `1:05:00`, `20` for whole minutes. */
export const CARDIO_TIME_FORMAT: FieldFormat = { parse: parseCardioTime, show: cardioTimeFieldText };

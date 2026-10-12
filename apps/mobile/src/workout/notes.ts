/**
 * Notes on an exercise or a set (active-workout §4.4 `Notes`; Your data).
 * Pure: what a typed note saves as, and how it shows. The note is Ben's own
 * words, shown as typed; it never changes a value, target or rest.
 */

export const NOTE_MAX = 500;

/** Trimmed text, or null to clear (an empty field clears the note). */
export function noteValue(text: string): string | null {
  const t = text.trim().slice(0, NOTE_MAX).trim();
  return t === '' ? null : t;
}

/** Whether Save would change the stored note. */
export function noteChanged(stored: string | null, text: string): boolean {
  return (stored ?? null) !== noteValue(text);
}

/** A set row's caption: the gym part caption and the set's note, joined. */
export function setRowCaption(gymCaption: string | null, note: string | null): string | null {
  const parts = [gymCaption, note].filter((p): p is string => p !== null && p !== '');
  return parts.length === 0 ? null : parts.join(' · ');
}

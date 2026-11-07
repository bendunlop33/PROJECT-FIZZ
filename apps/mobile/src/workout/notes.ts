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

/** (Ben, 26 Oct) A note's pin: on shows it every time the exercise is in a workout; `gymOnly` at this gym only. */
export interface NotePin {
  on: boolean;
  gymOnly: boolean;
}

export const PIN_COPY = { pin: 'Pin', gymOnly: (gym: string) => `Only at ${gym}` } as const;

/** Whether Save would change anything: the words, or the pin. */
export function noteSheetChanged(stored: string | null, text: string, pinBefore: NotePin | null, pinNow: NotePin | null): boolean {
  if (noteChanged(stored, text)) return true;
  if (pinBefore === null || pinNow === null) return false;
  return pinBefore.on !== pinNow.on || (pinNow.on && pinBefore.gymOnly !== pinNow.gymOnly);
}

/**
 * (Ben, 26 Oct) What Save writes for a note with a Pin switch, in order. `pinned`: the exercise's pin now (null:
 * none); `today`: today's note on the row. Pinned: the pin (moved if its gym scope changed) and today's copy
 * cleared so it shows once. Unpinned: the pin removed and the words kept for this workout only. An empty note
 * clears whichever it was. Pure; each step is one versioned write by the caller.
 */
export type NoteWrite = { kind: 'pin'; gymOnly: boolean; text: string } | { kind: 'unpin'; gymOnly: boolean } | { kind: 'today'; text: string | null };

export function noteWrites(o: { text: string | null; pin: NotePin; pinned: { gymOnly: boolean } | null; today: string | null }): NoteWrite[] {
  const out: NoteWrite[] = [];
  if (o.pin.on && o.text !== null) {
    if (o.pinned !== null && o.pinned.gymOnly !== o.pin.gymOnly) out.push({ kind: 'unpin', gymOnly: o.pinned.gymOnly });
    out.push({ kind: 'pin', gymOnly: o.pin.gymOnly, text: o.text });
    if (o.today !== null) out.push({ kind: 'today', text: null });
    return out;
  }
  if (o.pinned !== null) out.push({ kind: 'unpin', gymOnly: o.pinned.gymOnly });
  if (o.text !== o.today) out.push({ kind: 'today', text: o.text });
  return out;
}

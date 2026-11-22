import type { NotePreview } from '../import/note-service';
import { formatShortDate, formatTime } from '../format/dates';

/**
 * (Ben, 11 Nov) `Paste` in Log a past workout: the review's rows, pure. Minimal copy (Ben, 10 Oct): values and
 * actions; `Coach` marks a name the coach changed or a set it read, `Choose` an exercise he still has to pick.
 */

export const PASTE_COPY = {
  entry: 'Paste',
  title: 'Paste',
  placeholder: 'Paste your workout',
  read: 'Read',
  nothing: 'Couldn’t read that',
  choose: 'Choose',
  open: 'Open workout',
  coach: 'Coach',
  checking: 'Coach…',
  failed: 'Couldn’t open. Try again.',
  pickTitle: (header: string) => `Choose: ${header}`,
  pick: 'Choose',
} as const;

export interface PasteRow {
  key: string;
  index: number;
  /** As he wrote it (`Bench`). */
  header: string;
  /** The exercise it will be logged as, or `Choose`. */
  name: string;
  /** `2×60×6, 80×4, 110×5, 110×5, 100×8`. */
  detail: string;
  needsPick: boolean;
  /** A suggestion for Ben to check (not sure, or the coach changed it). */
  check: boolean;
  /** The coach changed the name or read one of its lines. */
  coach: boolean;
  /** `own:<name>` from the coach: the name for `Add your own`. */
  ownName: string | null;
  accessibilityLabel: string;
}

/** The review's rows with Ben's picks (`picks[index]` = exercise ID, `names[id]` = its name). */
export function pasteRows(p: NotePreview, picks: Readonly<Record<number, string>>, names: Readonly<Record<string, string>>): PasteRow[] {
  return p.exercises.map((e) => {
    const picked = picks[e.index];
    const id = picked ?? e.exerciseId;
    const name = picked !== undefined ? (names[picked] ?? e.exerciseName ?? PASTE_COPY.choose) : (e.exerciseName ?? PASTE_COPY.choose);
    const coach = picked === undefined && (e.byCoach || e.sets.some((s) => s.byCoach));
    const needsPick = id === null;
    return {
      key: `${String(e.index)}:${e.header}`,
      index: e.index,
      header: e.header === '' ? '—' : e.header,
      name,
      detail: e.rowsText,
      needsPick,
      check: !needsPick && picked === undefined && (!e.sure || e.byCoach),
      coach,
      ownName: needsPick ? e.ownName : null,
      accessibilityLabel: `${e.header === '' ? '' : `${e.header}, `}${needsPick ? `${PASTE_COPY.choose} exercise` : name}. ${e.rowsText}${coach ? `. ${PASTE_COPY.coach}` : ''}`,
    };
  });
}

/** Every row has an exercise. */
export function canOpenPaste(p: NotePreview, picks: Readonly<Record<number, string>>): boolean {
  return p.exercises.length > 0 && p.exercises.every((e) => (picks[e.index] ?? e.exerciseId) !== null);
}

/** `Tue 10 Nov, 17:30 · Main gym`. */
export function pasteWhen(p: NotePreview, gymName: string | null, locale?: string): string {
  const when = `${formatShortDate(p.startMs, p.tz, locale)}, ${formatTime(p.startMs, p.tz, locale)}`;
  return gymName === null ? when : `${when} · ${gymName}`;
}

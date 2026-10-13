/**
 * Muscles table columns (progress.md §2.4; F16, 13 Oct: `SESSIONS` wrapped to
 * `SESSION / S`). Each column is wide enough for its header in the D section
 * label (12 pt, semibold, uppercase, 1.4 pt tracking) at the default size; the
 * header also never wraps (one line, shrinks if text is larger).
 */
export const FREQUENCY_COLUMNS = { sessions: 84, sets: 52, perWeek: 80 } as const;

export const FREQUENCY_HEADERS = { sessions: 'SESSIONS', sets: 'SETS', perWeek: 'PER WEEK' } as const;

/** A generous width estimate (pt) of a section label: SF Pro semibold caps ≈ 0.68 em, plus tracking. */
export function sectionLabelWidth(text: string, size = 12, tracking = 1.4): number {
  let w = 0;
  for (const c of text) w += (c === ' ' ? 0.28 : 0.68) * size + tracking;
  return w;
}

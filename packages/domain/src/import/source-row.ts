import type { MarkerMeaning } from '@fizz/schemas';
import type { FitNotesRow } from './fitnotes';

/**
 * One set from a source file, the shape `analyseImport` and `planImportRows`
 * read (data-import-export §9.6.2, ADR 0026). It generalises `FitNotesRow`:
 * a FitNotes row **is** a `SourceSetRow` as it stands (one to one; none of
 * the extra fields set), so the FitNotes import is unchanged.
 *
 * Only two code paths make these: the FitNotes parser and `applyImportSpec`.
 * The coach never does (rule 8, check 42): its layout is read by code.
 */
export interface SourceSetRow extends FitNotesRow {
  /** Which set of the row: a packed or wide row (`3x8`, `Set 1…Set 4`) gives several. Absent: 0. */
  part?: number;
  /** The workout it belongs to: its date, `date` + start time, or `date` + `Which workout`. Absent: its date. */
  workoutKey?: string;
  /** The start time as written (`18:02`), no zone (AI6). */
  startLocal?: string | null;
  /** A confirmed set-type marker's meaning (`not_a_set` rows are skipped and listed). */
  setType?: MarkerMeaning | null;
  /** From an `RPE` column: 1–10 in half steps; other values stay in the original only. */
  rpe?: number | null;
  /** FitNotes 2 (`D`) `RIR`: a whole number 0–10; other values stay in the original only. */
  rir?: number | null;
  /** FitNotes 2 (`D`): a weight written with no unit; read in the unit Ben gives the file (asked once). */
  unitless?: number | null;
  /** FitNotes 2 (`D`) `Equipment` (`Barbell`, `Machine`): a matching hint only, like the category. */
  equipment?: string;
  /** FitNotes 2 (`D`) `Categories`, split on commas: the category hint. */
  categories?: string[];
}

/** The workout a row belongs to: its key, else its date (FitNotes keeps one workout per date). */
export function workoutKeyOf(r: Pick<SourceSetRow, 'workoutKey' | 'date'>): string | null {
  return r.workoutKey ?? r.date;
}

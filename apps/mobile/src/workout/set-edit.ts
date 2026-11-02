/**
 * Edit set's save for a set not done yet (14 Oct, "edit anything on the
 * sets"), pure so it's tested: the target as one `edit_planned_set`, then
 * the note (its own versioned write, on the version the edit returned).
 * A refused edit saves nothing; a note that fails after a saved edit still
 * hands over the edit's Undo, and says so (review gaps N7).
 */

type Outcome = { ok: true; duplicate?: boolean; aggregate: { session: { version: number } } } | { ok: false; error: { code: string; message: string } };

export type PlannedSaveOutcome =
  /** The edit saved: `Set 3 updated` [Undo]. */
  | { kind: 'edited'; noteFailed: boolean }
  /** Only the note changed (or the edit was already saved): back, no toast. */
  | { kind: 'saved' }
  /** Nothing saved; the sheet stays and shows why (it reloads). */
  | { kind: 'refused'; message: string };

export async function plannedEditSave<P>(i: {
  patch: P | null;
  /** The note as typed: a value or null to clear; undefined = unchanged. */
  note: string | null | undefined;
  sessionVersion: number;
  edit: (patch: P) => Promise<Outcome>;
  setNote: (note: string | null, expectedVersion: number) => Promise<Outcome>;
}): Promise<PlannedSaveOutcome> {
  let version = i.sessionVersion;
  let edited = false;
  if (i.patch !== null) {
    const r = await i.edit(i.patch);
    if (!r.ok) return { kind: 'refused', message: refusal(r.error) };
    version = r.aggregate.session.version;
    edited = r.duplicate !== true;
  }
  if (i.note !== undefined) {
    const n = await i.setNote(i.note, version);
    if (!n.ok) {
      if (!edited) return { kind: 'refused', message: refusal(n.error) };
      return { kind: 'edited', noteFailed: true };
    }
  }
  return edited ? { kind: 'edited', noteFailed: false } : { kind: 'saved' };
}

function refusal(e: { code: string; message: string }): string {
  return e.code === 'stale_version' || e.code === 'write_conflict' ? 'This set changed since it was shown. Showing the latest.' : e.message;
}

/**
 * The load field after a typed value is committed (blur or Save; review S1):
 * the load the equipment can make, so the field shows what will be saved.
 * `snapped` undefined (nothing fits) drops the typed value: the stored
 * target stays. `typed` undefined: untouched.
 */
export function committedLoad(typed: number | null | undefined, snapped: number | null | undefined): number | null | undefined {
  return typed === undefined ? undefined : snapped;
}

/** Save shows the fitted load first when it differs from what's typed, rather than saving a number that isn't on screen. */
export function loadNeedsFit(typed: number | null | undefined, snapped: number | null | undefined): boolean {
  return typed !== undefined && typed !== snapped;
}

/**
 * (Ben, 2 Nov: "Maybe we only need set type, rest and notes?") What the set sheet shows. In a live workout the table
 * edits load, reps, time and distance inline and the set's hold menu has RIR, Target RIR, + Weight and Delete, so the
 * sheet keeps only what has nowhere else to live: `planned` (a set not done yet) Set type, Rest after, Note;
 * `logged` (a done set, live) Set type and Note (its rest has run; `correct_set` carries no rest). `past` (any
 * workout that isn't live) keeps the full correction sheet, unchanged.
 */
export type SetSheetKind = 'planned' | 'logged' | 'past';

export type SetSheetSection = 'done_at' | 'values' | 'add_weight' | 'rir' | 'range' | 'target_line' | 'target_rir' | 'set_type' | 'rest' | 'exclusions' | 'note' | 'saved_as' | 'do_next' | 'insert_after' | 'delete';

const SHEET_SECTIONS: Readonly<Record<SetSheetKind, readonly SetSheetSection[]>> = {
  planned: ['set_type', 'rest', 'note'],
  logged: ['set_type', 'note'],
  past: ['done_at', 'values', 'add_weight', 'rir', 'target_rir', 'set_type', 'exclusions', 'note', 'saved_as', 'delete'],
};

export function setSheetKind(sessionStatus: string, setStatus: string | undefined): SetSheetKind {
  if (sessionStatus !== 'active') return 'past';
  return setStatus === 'pending' ? 'planned' : 'logged';
}

export function setSheetSections(kind: SetSheetKind): ReadonlySet<SetSheetSection> {
  return new Set(SHEET_SECTIONS[kind]);
}

/** `Set 2 · Back squat` live; the past sheet keeps `Edit set 2 · Back squat`. */
export function setSheetTitle(kind: SetSheetKind, stepName: string, exerciseName: string): string {
  return kind === 'past' ? `Edit ${stepName.toLowerCase()} · ${exerciseName}` : `${stepName} · ${exerciseName}`;
}

/** The menu item that opens the live sheet: what it holds, nothing more. */
export function setSheetMenuLabel(done: boolean): string {
  return done ? 'Type, note' : 'Type, rest, note';
}

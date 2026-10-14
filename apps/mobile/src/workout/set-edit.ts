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

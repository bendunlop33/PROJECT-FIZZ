import { z } from 'zod';

import { RoutineExerciseSchema, type RoutineExercise } from '@fizz/schemas';

import type { TextFile } from '../backup/backup-service';

/**
 * (Ben, 26 Oct; app review finding 6) The one editor's unsaved edits, kept on this phone as Ben makes them, so a
 * force-close or iOS ending the app loses nothing: reopening the same workout asks `Resume edits` / `Discard`.
 * It is never a save: `Save` stays the one versioned write (rule 5), against the version the edits started from
 * (`baseVersion`) with the save's own op ID (`opId`), so a newer version is never overwritten (the conflict sheet)
 * and a save that landed just before the app closed isn't written twice. Your data (a personal file, removed by
 * Delete my data); not in backups (it is only ever a few minutes' work in progress). Pure apart from the file.
 */

export const EDITOR_DRAFTS_MAX = 10;

/** `edit:<routineId>` (a saved workout or plan day), or `new` (`New workout`). A Save-sheet copy isn't kept. */
export type EditorDraftKey = string;

export function editorDraftKey(target: { kind: 'edit'; routineId: string } | { kind: 'new' } | { kind: string }): EditorDraftKey | null {
  if (target.kind === 'edit' && 'routineId' in target) return `edit:${target.routineId}`;
  return target.kind === 'new' ? 'new' : null;
}

const EditSchema = z.object({ name: z.string().max(160), exercises: z.array(RoutineExerciseSchema).max(40) });

const DraftSchema = z.object({
  key: z.string().min(1).max(200),
  savedAtUtc: z.string().min(1).max(40),
  /** The stored version the edits started from; null for a new workout. */
  baseVersion: z.int().min(0).nullable(),
  /** The workout as opened (what `dirty` and Keep both compare against). */
  base: EditSchema,
  edit: EditSchema,
  /** The Save's op ID, kept so a retried save is the same write. */
  opId: z.string().min(1).max(128),
});
export type EditorDraft = z.infer<typeof DraftSchema>;

const FileSchema = z.object({ v: z.literal(1), drafts: z.array(z.unknown()).max(100) });

/** The file's drafts; anything unreadable is dropped (a file is data, never trusted as shaped). */
export function parseEditorDrafts(text: string | null): EditorDraft[] {
  if (text === null) return [];
  try {
    const f = FileSchema.safeParse(JSON.parse(text));
    if (!f.success) return [];
    return f.data.drafts.flatMap((d) => {
      const r = DraftSchema.safeParse(d);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

/** The list with this draft in place of the key's old one, newest first, at most `EDITOR_DRAFTS_MAX`. */
export function withEditorDraft(list: readonly EditorDraft[], draft: EditorDraft): EditorDraft[] {
  return [draft, ...list.filter((d) => d.key !== draft.key)].slice(0, EDITOR_DRAFTS_MAX);
}

export function withoutEditorDraft(list: readonly EditorDraft[], key: EditorDraftKey): EditorDraft[] {
  return list.filter((d) => d.key !== key);
}

const sameEdit = (a: { name: string; exercises: readonly RoutineExercise[] }, b: { name: string; exercises: readonly RoutineExercise[] }) => a.name === b.name && JSON.stringify(a.exercises) === JSON.stringify(b.exercises);

/**
 * On opening: the kept draft to offer back, or null. Nothing to offer when it changes nothing against what it started
 * from, or it is exactly the workout as it now opens (the save went through).
 */
export function editorDraftToOffer(draft: EditorDraft | null, opened: { name: string; exercises: readonly RoutineExercise[] }): EditorDraft | null {
  if (draft === null) return null;
  if (sameEdit(draft.edit, draft.base) || sameEdit(draft.edit, opened)) return null;
  return draft;
}

export const EDITOR_DRAFT_COPY = { title: 'Unsaved edits', resume: 'Resume edits', discard: 'Discard' } as const;

/** The phone's file, one write at a time. */
export interface EditorDraftStore {
  get(key: EditorDraftKey): Promise<EditorDraft | null>;
  put(draft: EditorDraft): Promise<void>;
  remove(key: EditorDraftKey): Promise<void>;
}

export function createEditorDraftStore(file: TextFile): EditorDraftStore {
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const p = queue.then(run, run);
    queue = p.catch(() => undefined);
    return p;
  };
  const read = async () => parseEditorDrafts(await file.read().catch(() => null));
  const write = (drafts: readonly EditorDraft[]) => file.write(JSON.stringify({ v: 1, drafts }));
  return {
    get: (key) => inTurn(async () => (await read()).find((d) => d.key === key) ?? null),
    put: (draft) => inTurn(async () => write(withEditorDraft(await read(), draft))),
    remove: (key) =>
      inTurn(async () => {
        const list = await read();
        if (list.some((d) => d.key === key)) await write(withoutEditorDraft(list, key));
      }),
  };
}

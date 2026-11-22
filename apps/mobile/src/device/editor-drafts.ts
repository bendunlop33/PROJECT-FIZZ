import { createEditorDraftStore, type EditorDraftStore } from '../workout/editor-draft';
import { containerTextFile } from './files';
import { EDITOR_DRAFTS_FILE } from './personal-files';

let store: EditorDraftStore | null = null;

/** The phone's editor drafts file (Documents, written by a temporary file and a move). */
export function editorDrafts(): EditorDraftStore {
  store ??= createEditorDraftStore(containerTextFile(EDITOR_DRAFTS_FILE));
  return store;
}

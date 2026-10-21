import { saveDraftCommand, type DraftEdits } from '@fizz/domain';
import type { SessionCommand, ZonedTimestamp } from '@fizz/schemas';

/**
 * The workout screen's debounced draft save (300 ms), without React so its
 * sequences are tested (review weight-revert S2, S3). Unsaved edits survive a
 * force-close without counting as results. A save refused as stale (the
 * screen is behind the stored set) reloads, so `reconcileDraftEdits` re-bases
 * the edits on the stored set and the save goes again; Ben's typed value is
 * never dropped quietly.
 */

export const DRAFT_SAVE_DELAY_MS = 300;

export type SaveOutcome = { ok: true } | { ok: false; error: { code: string; message: string } };

export interface DraftSaverDeps {
  save: (cmd: Extract<SessionCommand, { type: 'save_draft' }>) => Promise<SaveOutcome>;
  /** Re-reads the stored workout (the screen's `reload`). */
  reload: () => Promise<unknown>;
  now: () => ZonedTimestamp;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface DraftSaver {
  /** Saves `edits` after the delay, replacing any save still waiting. */
  schedule: (edits: DraftEdits) => void;
  /** Drops a save still waiting (the edits changed or went). */
  cancel: () => void;
}

export function createDraftSaver(deps: DraftSaverDeps, delayMs = DRAFT_SAVE_DELAY_MS): DraftSaver {
  let handle: unknown = null;
  const cancel = () => {
    if (handle !== null) deps.clearTimer(handle);
    handle = null;
  };
  return {
    cancel,
    schedule(edits) {
      cancel();
      handle = deps.setTimer(() => {
        handle = null;
        void deps
          .save(saveDraftCommand(edits, deps.now()))
          .then((r) => (!r.ok && r.error.code === 'stale_version' ? deps.reload() : undefined))
          .catch(() => undefined);
      }, delayMs);
    },
  };
}

import type { TimeSheetRow } from '@fizz/domain';

import type { ConfirmOutcome } from '../services/progress-service';

/**
 * `Count it` on the Time sheet (progress.md PG25a, §4.5, check 6), as a plain
 * function so the order of effects is tested without rendering.
 *
 * The sheet is a modal, and anything the screen draws sits under it. So the
 * sheet closes first, and only then does the toast show, where its Undo can be
 * reached (review progress-A B2). A failure closes the sheet too, so its
 * message is seen. A second tap on the same row while the first is still
 * saving does nothing (review N6), and so does a second tap on Undo.
 */

export type CountItToast = { text: string; action?: 'Undo'; onAction?: () => void };

export interface CountItDeps {
  confirm: (req: { sessionId: string; expectedVersion: number; opId: string }) => Promise<ConfirmOutcome>;
  undo: (req: { sessionId: string; expectedVersion: number; opId: string }) => Promise<ConfirmOutcome>;
  newId: () => string;
  closeSheet: () => void;
  show: (toast: CountItToast) => void;
  hide: () => void;
  reload: () => void;
}

/** `Counted Push A, 5 h 12 min`: the row's title and its duration (the last part of `Fri 2 Oct · Push A · 5 h 12 min`). */
export function countedText(row: Pick<TimeSheetRow, 'title' | 'text'>): string {
  const duration = row.text.split(' · ').at(-1) ?? '';
  return `Counted ${row.title}, ${duration}`;
}

export async function runCountIt(row: Pick<TimeSheetRow, 'sessionId' | 'version' | 'title' | 'text'>, deps: CountItDeps, inFlight: Set<string>): Promise<void> {
  const key = `count:${row.sessionId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const out = await deps.confirm({ sessionId: row.sessionId, expectedVersion: row.version, opId: deps.newId() });
    deps.closeSheet();
    deps.reload();
    if (!out.ok) {
      deps.show({ text: out.message });
      return;
    }
    const undoKey = `undo:${out.sessionId}:${String(out.version)}`;
    deps.show({
      text: countedText(row),
      action: 'Undo',
      onAction: () => {
        if (inFlight.has(undoKey)) return;
        inFlight.add(undoKey);
        deps.hide();
        void deps
          .undo({ sessionId: out.sessionId, expectedVersion: out.version, opId: deps.newId() })
          .then((u) => {
            if (!u.ok) deps.show({ text: u.message });
            deps.reload();
          })
          .finally(() => {
            inFlight.delete(undoKey);
          });
      },
    });
  } finally {
    inFlight.delete(key);
  }
}

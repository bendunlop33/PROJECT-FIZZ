import { Alert } from 'react-native';

import type { PainFlag } from '@fizz/schemas';

import type { AppServices } from '../services/app-services';
import { painClearConfirm, painClearedToast } from './pain-clear';

/**
 * The two answers to a pain flag (active-workout §2.14.2–2.14.3), shared by
 * the rest card's `PainReviewLine`, the pain flag sheet, Today's check row
 * and Profile. All decisions are in the services and `@fizz/domain`; this
 * only shows the system confirm and reports the outcome for a toast.
 */

export interface PainToast {
  icon: 'exclamationmark.triangle' | 'info.circle' | 'checkmark.circle.fill';
  text: string;
  /** Second line (the physio-or-doctor nudge). */
  detail?: string | null;
  action?: string;
  onAction?: () => void;
}

/** One operation per answer to one version of the flag: a double tap or retry is a duplicate, never a second answer. */
export function stillHurtsOpId(flagId: string, flagVersion: number): string {
  return `still-hurts:${flagId}:${String(flagVersion)}`;
}

/**
 * `Still hurts`: keeps the flag; the outcome line `Pain flag kept · next
 * check 3 Nov` carries Undo. A failure says so honestly and changes nothing.
 */
export async function answerStillHurts(services: AppServices, flagId: string, flagVersion: number, done: (t: PainToast) => void): Promise<void> {
  const opId = stillHurtsOpId(flagId, flagVersion);
  const r = await services.pain.stillHurts({ flagId, opId, expectedVersion: flagVersion });
  if (!r.ok) {
    done({ icon: 'info.circle', text: r.message });
    return;
  }
  done({
    icon: 'exclamationmark.triangle',
    text: r.kept,
    detail: r.nudge,
    action: 'Undo',
    onAction: () => {
      void services.pain.undoStillHurts({ flagId, reviewOpId: r.reviewOpId, undoOpId: `undo:${opId}` }).then((ok) => {
        done(ok ? { icon: 'info.circle', text: 'Answer undone. The check is still due.' } : { icon: 'info.circle', text: 'Couldn’t undo: flag changed' });
      });
    },
  });
}

/**
 * `Better…` / `Clear flag…`: the AW10 confirmation. Only `Clear flag` there
 * clears; `Keep it` records nothing, so a due check stays due. Versioned:
 * a flag that changed since it was read isn't cleared.
 */
export function confirmClearFlag(services: AppServices, flag: PainFlag, done: (t: PainToast) => void): void {
  const c = painClearConfirm(flag);
  Alert.alert(c.title, undefined, [
    {
      text: c.confirm,
      onPress: () => {
        void services.pain.clearConfirmed({ flagId: flag.id, expectedVersion: flag.version }).then((r) => {
          if (!r.ok) {
            done({ icon: 'info.circle', text: r.message });
            return;
          }
          const t = painClearedToast(flag.exerciseName);
          const cleared = r.cleared;
          done({
            icon: 'checkmark.circle.fill',
            text: t.text,
            ...(cleared
              ? {
                  action: t.action,
                  onAction: () => {
                    void services.pain.undoClear([cleared]).then((ok) => {
                      done(ok ? { icon: 'exclamationmark.triangle', text: `Pain flag back on for ${flag.exerciseName}` } : { icon: 'info.circle', text: 'Couldn’t undo: flag changed' });
                    });
                  },
                }
              : {}),
          });
        });
      },
    },
    { text: c.cancel, style: 'cancel' },
  ]);
}

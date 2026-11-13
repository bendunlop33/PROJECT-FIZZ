import { Alert } from 'react-native';

import type { PainFlag } from '@fizz/schemas';

import type { AppServices } from '../services/app-services';
import { painClearConfirm, painClearedToast } from './pain-clear';

/**
 * Ben's `Clear flag…` on a pain flag (active-workout §2.14.3), shared by the
 * pain flag sheet and Profile. (The two-weekly `Still hurts?` check was
 * removed by Ben, 9 Nov: flags clear by themselves after one more session.)
 * All decisions are in the services and `@fizz/domain`; this only shows the
 * system confirm and reports the outcome for a toast.
 */

export interface PainToast {
  icon: 'exclamationmark.triangle' | 'info.circle' | 'checkmark.circle.fill';
  text: string;
  action?: string;
  onAction?: () => void;
}

/**
 * `Clear flag…`: the AW10 confirmation. Only `Clear flag` there clears;
 * `Keep it` records nothing. Versioned: a flag that changed since it was
 * read isn't cleared.
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

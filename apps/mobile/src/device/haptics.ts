import * as Haptics from 'expo-haptics';

import type { HapticToken } from '../theme';

/**
 * design-system §6 haptics. Never awaited by logging and never throws: a
 * phone without haptics (or a build without the module) just stays quiet.
 * Per-haptic on/off switches come with Profile → Voice & alerts.
 */
export function haptic(token: HapticToken): void {
  let run: Promise<void>;
  try {
    switch (token) {
      case 'commit':
        run = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'restEnd':
        run = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'undo':
        run = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'step':
        run = Haptics.selectionAsync();
        break;
    }
  } catch {
    return;
  }
  void run.catch(() => undefined);
}

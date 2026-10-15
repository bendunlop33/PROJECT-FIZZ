import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { readInstallStatus, type InstallStatus } from '../device/install';

/**
 * Signing expiry is read at launch and again on every return to the
 * foreground (system-states §3.5), so a SideStore refresh clears the banner
 * without a relaunch.
 */
let cached: InstallStatus | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(s: InstallStatus) => void>();

function refresh(): void {
  inFlight ??= readInstallStatus()
    .then((s) => {
      cached = s;
      listeners.forEach((l) => {
        l(s);
      });
    })
    .finally(() => {
      inFlight = null;
    });
}

export function useInstallStatus(): InstallStatus | null {
  const [status, setStatus] = useState<InstallStatus | null>(cached);
  useEffect(() => {
    listeners.add(setStatus);
    if (cached === null) refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      listeners.delete(setStatus);
      sub.remove();
    };
  }, []);
  return status;
}

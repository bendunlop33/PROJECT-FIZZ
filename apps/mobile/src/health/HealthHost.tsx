import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { AppServices } from '../services/app-services';
import { useDataChanged } from '../shell/context';

/**
 * (ADR 0035) Keeps Apple Health in step: on launch and return to the foreground, a read when due and any writes
 * left over (a failed or force-closed one); after any write to the store, the Health writes catch up. Never during
 * a workout (the service checks). (Ben, 1 Nov) When a read has stored what it read, every screen reloads (Today,
 * Progress, Library), so a read that finishes after a screen loaded still shows. Renders nothing.
 */
export function HealthHost({ services }: { services: AppServices }) {
  const changed = useDataChanged();
  useEffect(() => {
    const unread = services.health.onDataRead(changed);
    void services.health.onAppActive();
    const stop = services.health.watchWrites();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void services.health.onAppActive();
    });
    return () => {
      sub.remove();
      stop();
      unread();
    };
  }, [services, changed]);
  return null;
}

import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { AppServices } from '../services/app-services';

/**
 * (ADR 0035) Keeps Apple Health in step: on launch and return to the foreground, a read when due and any writes
 * left over (a failed or force-closed one); after any write to the store, the Health writes catch up. Never during
 * a workout (the service checks). Renders nothing.
 */
export function HealthHost({ services }: { services: AppServices }) {
  useEffect(() => {
    void services.health.onAppActive();
    const stop = services.health.watchWrites();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void services.health.onAppActive();
    });
    return () => {
      sub.remove();
      stop();
    };
  }, [services]);
  return null;
}

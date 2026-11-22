import { useEffect, useSyncExternalStore } from 'react';

import { getSnapshot, loadSavedResults, subscribe, type ProbeStoreState } from '../../probe/results-store';

/** The capability probe's saved results (its own probe database), live. */
export function useProbeResults(): ProbeStoreState {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    void loadSavedResults();
  }, []);
  return state;
}

import { useEffect, useRef } from 'react';

/**
 * (Redesign v3 C2) Reload a screen read when `key` changes after the first render (the period bar's choice): the
 * loaders read their arguments when they run, and `useScreenData` only reruns on focus, writes and `reload()`.
 */
export function useReloadOn(key: string, reload: () => void): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [key, reload]);
}

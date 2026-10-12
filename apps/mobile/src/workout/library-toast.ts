import type { LibraryToastParam } from '../navigation/types';

/**
 * A toast the workout editor hands back to Exercise detail (exercise-library
 * §9.5 `New workout` → Save → Detail). The editor is a root modal over a
 * screen nested in a tab, so it isn't passed as route params: it waits here
 * and the next detail screen to focus takes it once. In memory only.
 */
let pending: LibraryToastParam | null = null;

export function handOffLibraryToast(t: LibraryToastParam): void {
  pending = t;
}

export function takeLibraryToast(): LibraryToastParam | null {
  const t = pending;
  pending = null;
  return t;
}

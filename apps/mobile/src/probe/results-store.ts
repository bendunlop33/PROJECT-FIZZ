import { isoUtc, nowMs } from '../clock';
import {
  PROBE_RESULTS_KEY,
  initialResults,
  mergeNewer,
  restoreResults,
  serialiseResults,
  type ProbeResults,
} from './model';
import { getProbeValue, putProbeValue } from './runners';

/**
 * Probe results live here, not in screen state, so they survive leaving the
 * screen (‹ Back) and, through the probe DB's probe_kv table, a force-close.
 * A probe that finishes after the screen unmounts is still recorded.
 *
 * Writes are serialised so an older snapshot can never land after a newer
 * one. A failed write is shown on screen (persistError), never hidden.
 */

export interface ProbeStoreState {
  results: ProbeResults;
  /** False until the saved results have been read (or failed to read). */
  loaded: boolean;
  /** Problems found while loading saved results. */
  loadIssues: readonly string[];
  /** Last persistence error, or null if the latest write succeeded. */
  persistError: string | null;
}

let state: ProbeStoreState = { results: initialResults(), loaded: false, loadIssues: [], persistError: null };
const listeners = new Set<() => void>();
let writeChain: Promise<void> = Promise.resolve();
let loadPromise: Promise<void> | null = null;

function setState(next: ProbeStoreState) {
  state = next;
  listeners.forEach((l) => {
    l();
  });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function persist(results: ProbeResults) {
  writeChain = writeChain
    .then(() => putProbeValue(PROBE_RESULTS_KEY, serialiseResults(results), isoUtc(nowMs())))
    .then(
      () => {
        if (state.persistError !== null) setState({ ...state, persistError: null });
      },
      (e: unknown) => {
        setState({ ...state, persistError: errorText(e) });
      },
    );
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ProbeStoreState {
  return state;
}

/** Applies a pure update to the latest results and saves them. */
export function updateResults(fn: (r: ProbeResults) => ProbeResults): void {
  const next = fn(state.results);
  if (next === state.results) return;
  setState({ ...state, results: next });
  // Don't write before the saved results are merged in, or they'd be overwritten.
  if (state.loaded) persist(next);
}

/** Reads the saved results once per launch. Safe to call on every mount. */
export function loadSavedResults(): Promise<void> {
  loadPromise ??= (async () => {
    let stored: string | null = null;
    let readError: string | null = null;
    try {
      stored = await getProbeValue(PROBE_RESULTS_KEY);
    } catch (e) {
      readError = `Could not read saved results: ${errorText(e)}`;
    }
    const restored = restoreResults(stored);
    // Anything recorded in this launch before the load finished is newer.
    const results = mergeNewer(restored.results, state.results);
    setState({
      ...state,
      results,
      loaded: true,
      loadIssues: readError === null ? restored.issues : [readError, ...restored.issues],
    });
    // Write back the validated, merged form (drops bad rows, records interrupted
    // runs). Not after a read error: the saved copy may still be fine.
    if (readError === null) persist(results);
  })();
  return loadPromise;
}

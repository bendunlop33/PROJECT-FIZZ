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
 *
 * If the saved results can't be read, nothing is written until a later read
 * succeeds (review F6): the saved copy may still be fine, and writing this
 * launch's results would overwrite it. The next mount retries the read.
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
/** True from a failed read until a read succeeds; blocks writes meanwhile. */
let readFailed = false;

export const NOT_SAVING_UNTIL_READ =
  'the saved results could not be read, and saving now would overwrite them. Leave and reopen this screen to retry';

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
  if (state.loaded && !readFailed) persist(next);
}

/**
 * Reads the saved results once per launch. Safe to call on every mount: after
 * a successful read it's a no-op; after a failed read it tries again.
 */
export function loadSavedResults(): Promise<void> {
  loadPromise ??= (async () => {
    let stored: string | null;
    try {
      stored = await getProbeValue(PROBE_RESULTS_KEY);
    } catch (e) {
      readFailed = true;
      loadPromise = null;
      // loaded: the screen stays usable; results are kept in memory only.
      setState({
        ...state,
        loaded: true,
        loadIssues: [`Could not read saved results: ${errorText(e)}`],
        persistError: NOT_SAVING_UNTIL_READ,
      });
      return;
    }
    readFailed = false;
    const restored = restoreResults(stored);
    // Anything recorded in this launch before the load finished is newer.
    const results = mergeNewer(restored.results, state.results);
    setState({ ...state, results, loaded: true, loadIssues: restored.issues });
    // Write back the validated, merged form (drops bad rows, records interrupted
    // runs, and saves anything recorded while a read was failing).
    persist(results);
  })();
  return loadPromise;
}

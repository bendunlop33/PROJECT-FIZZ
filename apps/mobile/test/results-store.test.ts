import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PROBE_RESULTS_KEY, initialResults, recordResult, restoreResults, serialiseResults } from '../src/probe/model';

/**
 * The impure probe results store (review F8), with the probe DB replaced by a
 * fake. Each test gets a fresh copy of the module (it holds module state).
 */

const T0 = Date.UTC(2026, 9, 9, 8, 0, 0);

interface FakeDb {
  saved: Map<string, string>;
  writes: string[];
  failReads: number;
  pendingWrites: (() => void)[];
  holdWrites: boolean;
}

const db: FakeDb = { saved: new Map(), writes: [], failReads: 0, pendingWrites: [], holdWrites: false };

vi.mock('../src/probe/runners', () => ({
  getProbeValue: (key: string) => {
    if (db.failReads > 0) {
      db.failReads -= 1;
      return Promise.reject(new Error('disk I/O error'));
    }
    return Promise.resolve(db.saved.get(key) ?? null);
  },
  putProbeValue: (key: string, value: string) =>
    new Promise<void>((resolve) => {
      const write = () => {
        db.saved.set(key, value);
        db.writes.push(value);
        resolve();
      };
      if (db.holdWrites) db.pendingWrites.push(write);
      else write();
    }),
}));

async function freshStore() {
  vi.resetModules();
  return import('../src/probe/results-store');
}

function savedResults() {
  return restoreResults(db.saved.get(PROBE_RESULTS_KEY) ?? null).results;
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  db.saved = new Map();
  db.writes = [];
  db.failReads = 0;
  db.pendingWrites = [];
  db.holdWrites = false;
});

afterEach(() => {
  vi.resetModules();
});

describe('results store', () => {
  it('lands two quick updates in order, even when the first write is slow', async () => {
    const store = await freshStore();
    await store.loadSavedResults();
    await settle();
    db.writes = [];
    db.holdWrites = true;
    store.updateResults((r) => recordResult(r, 'sqlite', { status: 'pass', summary: 'first' }, T0));
    store.updateResults((r) => recordResult(r, 'secure_store', { status: 'pass', summary: 'second' }, T0 + 1));
    // Writes are chained: only the first has started.
    await settle();
    expect(db.pendingWrites).toHaveLength(1);
    db.holdWrites = false;
    db.pendingWrites.shift()?.();
    await settle();
    expect(db.writes).toHaveLength(2);
    const last = savedResults();
    expect(last.sqlite.summary).toBe('first');
    expect(last.secure_store.summary).toBe('second');
    expect(store.getSnapshot().persistError).toBeNull();
  });

  it('merges saved results with ones recorded before the load finished', async () => {
    db.saved.set(
      PROBE_RESULTS_KEY,
      serialiseResults(recordResult(initialResults(), 'notification', { status: 'pass', summary: 'saved earlier' }, T0)),
    );
    const store = await freshStore();
    store.updateResults((r) => recordResult(r, 'sqlite', { status: 'pass', summary: 'this launch' }, T0 + 5));
    expect(db.writes).toHaveLength(0); // not before the saved copy is merged
    await store.loadSavedResults();
    await settle();
    expect(store.getSnapshot().results.notification.summary).toBe('saved earlier');
    expect(savedResults().notification.summary).toBe('saved earlier');
    expect(savedResults().sqlite.summary).toBe('this launch');
  });

  it('after a failed read, never overwrites the saved copy; a later read merges and saves (review F6)', async () => {
    db.saved.set(
      PROBE_RESULTS_KEY,
      serialiseResults(recordResult(initialResults(), 'notification', { status: 'pass', summary: 'confirmed on device' }, T0)),
    );
    db.failReads = 1;
    const store = await freshStore();
    await store.loadSavedResults();
    expect(store.getSnapshot()).toMatchObject({ loaded: true, persistError: store.NOT_SAVING_UNTIL_READ });
    expect(store.getSnapshot().loadIssues[0]).toMatch(/Could not read saved results: disk I\/O error/);

    store.updateResults((r) => recordResult(r, 'sqlite', { status: 'pass', summary: 'new' }, T0 + 10));
    await settle();
    expect(db.writes).toHaveLength(0);
    expect(savedResults().notification.summary).toBe('confirmed on device');

    // Remount: the read is retried and now succeeds.
    await store.loadSavedResults();
    await settle();
    const after = savedResults();
    expect(after.notification.summary).toBe('confirmed on device');
    expect(after.sqlite.summary).toBe('new');
    expect(store.getSnapshot().persistError).toBeNull();
    expect(store.getSnapshot().loadIssues).toEqual([]);
  });

  it('reads only once after a successful load', async () => {
    const store = await freshStore();
    await store.loadSavedResults();
    db.saved.set(PROBE_RESULTS_KEY, 'not json');
    await store.loadSavedResults();
    expect(store.getSnapshot().loadIssues).toEqual([]);
  });
});

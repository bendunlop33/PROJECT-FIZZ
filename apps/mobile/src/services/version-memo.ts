import type { Store } from '@fizz/persistence';

/**
 * (Perf, Ben 26 Oct: "Progress slow") A read kept while nothing was written. Keyed on the open store and its write
 * count (`Database.writeCount`: every write transaction through the store, from any screen, an import, the weekly
 * review or a restore's new store), plus the caller's own key (the request, today's date). Any write since makes
 * the next call read again, so a cached answer is never older than the data. The key is taken before the read
 * starts: a write that lands during it bumps the count and the next call reads again.
 *
 * Holds the promise, so calls made while one is in flight share it. A failed read isn't kept.
 */
export interface VersionMemo<T> {
  get(store: Store, key: string, read: () => Promise<T>): Promise<T>;
  /** Drop everything (tests; a caller that knows its inputs changed outside the store). */
  clear(): void;
}

export function createVersionMemo<T>(size = 8): VersionMemo<T> {
  let stamp: { store: Store; writes: number } | null = null;
  const entries = new Map<string, Promise<T>>();
  return {
    get(store, key, read) {
      // A store without a write count (a test's stand-in) is never cached.
      const writes = (store as Partial<Store>).db?.writeCount;
      if (writes === undefined) return read();
      if (stamp === null || stamp.store !== store || stamp.writes !== writes) {
        stamp = { store, writes };
        entries.clear();
      }
      const hit = entries.get(key);
      if (hit !== undefined) {
        // Most recently used last.
        entries.delete(key);
        entries.set(key, hit);
        return hit;
      }
      const out = read();
      entries.set(key, out);
      while (entries.size > size) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
      const at = stamp;
      out.catch(() => {
        if (stamp === at && entries.get(key) === out) entries.delete(key);
      });
      return out;
    },
    clear() {
      stamp = null;
      entries.clear();
    },
  };
}

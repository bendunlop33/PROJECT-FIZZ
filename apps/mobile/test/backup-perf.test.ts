import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toIso, toMs } from '@fizz/domain';
import { barbell, gym, HISTORY_EXERCISES, largeHistory, measureBlocking, profile, stack } from '@fizz/domain/testing';
import { openStore, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createBackupService, type BackupFileStore, type TextFile } from '../src/backup/backup-service';
import { emptyManifest, serialiseManifest } from '../src/backup/manifest';

/**
 * Backup review B1: on a real-sized history (2 years, 4 workouts a week),
 * an automatic backup must never block the JS thread for long, so Summary,
 * Undo and taps stay responsive right after Finish.
 */

const TZ = 'Europe/London';
const APP = { name: 'GymSmarter', version: '0.1.0', build: '9' };

class MemoryFiles implements BackupFileStore {
  readonly files = new Map<string, string>();
  write(name: string, text: string) {
    this.files.set(name, text);
    return Promise.resolve();
  }
  read(name: string) {
    return Promise.resolve(this.files.get(name) ?? null);
  }
  remove(name: string) {
    this.files.delete(name);
    return Promise.resolve();
  }
}

class MemoryText implements TextFile {
  text: string | null = null;
  read() {
    return Promise.resolve(this.text);
  }
  write(text: string) {
    this.text = text;
    return Promise.resolve();
  }
}

let store: Store;
const clock = { ms: toMs('2026-10-08T18:05:00.000Z') };
const now = (): ZonedTimestamp => ({ utc: toIso(clock.ms), tz: TZ });

beforeAll(async () => {
  store = await openStore(openNodeDriver(':memory:'));
  await store.repos.profiles.save(profile(), null);
  await store.repos.gyms.save(gym(2, { isDefault: true }), null);
  for (const eq of [barbell(), stack()]) await store.repos.equipment.save(eq, null);
  for (const ex of HISTORY_EXERCISES) await store.repos.exercises.save(ex, null);
  for (const s of largeHistory()) await store.repos.sessions.save(s, null);
}, 600_000);
afterAll(async () => {
  await store.close();
});

describe('backup on a 2-year history (B1)', () => {
  it('never blocks the JS thread for long, including rotation', async () => {
    const files = new MemoryFiles();
    const manifest = new MemoryText();
    // Keep 2 automatic files, so rotation (read, hash, delete) runs from the third backup on.
    manifest.text = serialiseManifest({ ...emptyManifest(), keep: 2 });
    const svc = createBackupService({ store: () => store, files, manifest, now, app: APP, locale: 'en-GB' });
    expect((await store.countRecords()).finishedWorkouts).toBe(416);
    let worst = 0;
    const runs: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      clock.ms += 3_600_000;
      const m = await measureBlocking(() => svc.backUpOnPhone('workout_finished'));
      if (!m.result.ok) throw new Error(m.result.error);
      worst = Math.max(worst, m.maxBlockMs);
      runs.push(`${String(Math.round(m.totalMs))}ms/${String(Math.round(m.maxBlockMs))}ms${m.result.deleted.length > 0 ? ' (rotated)' : ''}`);
      if (i === 0) runs.unshift(`file ${(m.result.record.textLength / 1e6).toFixed(1)} MB`);
    }
    console.log(`[B1] automatic backup, total/longest block: ${runs.join(', ')}`);
    expect(files.files.size).toBe(2);
    // Before the fix each run blocked for its whole length (~6 s here, ~50 s under --jitless).
    // Typically under 150 ms; the margin absorbs CPU contention from parallel test files.
    expect(worst).toBeLessThan(1000);
  }, 600_000);
});

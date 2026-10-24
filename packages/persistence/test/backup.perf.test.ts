import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, barbell, gym, HISTORY_EXERCISES, largeHistory, measureBlocking, profile, stack } from '@fizz/domain/testing';
import { createBackup, DatabaseManager, timeSlicer } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { tempDir } from './helpers';

/**
 * Backup review B1: Check a backup and Restore on a real-sized history
 * (2 years, 4 workouts a week) never block the JS thread for long, and a
 * file is parsed and verified once per text, not once per step.
 */

const APP = { name: 'GymSmarter', version: '0.1.0', build: '9' };
const jitless = () => (process.execArgv.includes('--jitless') ? ' (--jitless)' : '');
const dirs: { cleanup: () => void }[] = [];
let source: DatabaseManager;
let text: string;

function open(prefix: string): Promise<DatabaseManager> {
  const d = tempDir();
  dirs.push(d);
  let n = 0;
  return DatabaseManager.open({ host: nodeDatabaseHost(d.dir), newName: () => `${prefix}-${String((n += 1))}.db` });
}

beforeAll(async () => {
  source = await open('source');
  const { repos } = source.store;
  await repos.profiles.save(profile(), null);
  await repos.gyms.save(gym(2, { isDefault: true }), null);
  for (const eq of [barbell(), stack()]) await repos.equipment.save(eq, null);
  for (const ex of HISTORY_EXERCISES) await repos.exercises.save(ex, null);
  for (const s of largeHistory()) await repos.sessions.save(s, null);
  const created = await createBackup(source.store, { at: at(0), app: APP, slice: timeSlicer() });
  expect(created.counts.finishedWorkouts).toBe(416);
  expect(created.integrity.ok).toBe(true);
  text = created.text;
}, 600_000);
afterAll(async () => {
  await source.close();
  for (const d of dirs) d.cleanup();
});

describe('Check and Restore on a 2-year history (B1)', () => {
  it('never block the JS thread for long', async () => {
    const target = await open('target');
    const check = await measureBlocking(() => target.check(text));
    if (!check.result.ok) throw new Error(check.result.error.message);
    expect(check.result.restorable).toBe(true);
    const restore = await measureBlocking(() => target.restore(text, at(10), { expectedStamp: check.result.ok ? check.result.preview.stamp : '' }));
    expect(restore.result).toMatchObject({ ok: true, status: 'restored' });
    const fmt = (m: { totalMs: number; maxBlockMs: number }) => `${String(Math.round(m.totalMs))}ms/${String(Math.round(m.maxBlockMs))}ms`;
    console.log(`[B1]${jitless()} ${(text.length / 1e6).toFixed(1)} MB backup, total/longest block: check ${fmt(check)}, restore ${fmt(restore)}`);
    // Before the fix each step blocked for its whole length (13-15 s here). Typically under 250 ms
    // (node:sqlite runs PRAGMA integrity_check synchronously; expo-sqlite runs it off the JS thread);
    // the margin absorbs CPU contention from parallel test files. Under `npm run test:perf:jitless`
    // (no JIT, closer to Hermes) the longest block was ~200 ms (11 Oct 2026, 19.7 MB): the
    // unsliced JSON.parse of the whole file. Not yet measured on the phone.
    expect(Math.max(check.maxBlockMs, restore.maxBlockMs)).toBeLessThan(1000);
    await target.close();
  }, 600_000);

  it('hold the store queue only for the export: a write issued meanwhile waits a bounded time (S3)', async () => {
    // A set logged or Summary Undo tapped just after Finish, while the automatic backup runs.
    let backupDone = false;
    const backup = createBackup(source.store, { at: at(20), app: APP, slice: timeSlicer() }).then((b) => {
      backupDone = true;
      return b;
    });
    await new Promise((r) => setTimeout(r, 0));
    const t0 = performance.now();
    await source.store.db.write((tx) => tx.run('SELECT 1'));
    const waitedMs = performance.now() - t0;
    expect(backupDone).toBe(false);
    const created = await backup;
    expect(created.counts.finishedWorkouts).toBe(416);
    console.log(`[S3]${jitless()} write queued during a ${(created.text.length / 1e6).toFixed(1)} MB backup waited ${String(Math.round(waitedMs))}ms`);
    // Only the paged export holds the queue; integrity, serialising and hashing run in later
    // turns or off it. Typically ~200 ms here (~350 ms under `npm run test:perf:jitless`); the
    // margin absorbs CPU contention from parallel test files. Not yet measured on the phone.
    expect(waitedMs).toBeLessThan(1500);
  }, 600_000);
});

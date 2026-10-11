import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { at, barbell, exercise, gym, HISTORY_EXERCISES, largeHistory, measureBlocking, profile, stack } from '@fizz/domain/testing';
import { DatabaseManager, stringifyPretty, timeSlicer } from '../src/index';
import { nodeDatabaseHost } from '../src/node/index';
import { tempDir } from './helpers';

/**
 * your-data-merge S1, S2: Export, Delete, Reset, Undo last reset and the
 * counts/summary behind their screens, on main's real-sized history (2 years,
 * 4 workouts a week, the backup B1 fixture), never block the JS thread for
 * long. Included in `npm run test:perf:jitless`.
 */

const jitless = () => (process.execArgv.includes('--jitless') ? ' (--jitless)' : '');
const fmt = (m: { totalMs: number; maxBlockMs: number }) => `${String(Math.round(m.totalMs))}ms/${String(Math.round(m.maxBlockMs))}ms`;
/** Bundled knowledge the history lacks, so Reset switches (not `unchanged`). */
const BUNDLED = exercise(9100, 'Goblet squat');
const dirs: { cleanup: () => void }[] = [];
let m: DatabaseManager;

beforeAll(async () => {
  const d = tempDir();
  dirs.push(d);
  let n = 0;
  m = await DatabaseManager.open({ host: nodeDatabaseHost(d.dir), newName: () => `perf-${String((n += 1))}.db` });
  const { repos } = m.store;
  await repos.profiles.save(profile(), null);
  await repos.gyms.save(gym(2, { isDefault: true }), null);
  for (const eq of [barbell(), stack()]) await repos.equipment.save(eq, null);
  for (const ex of HISTORY_EXERCISES) await repos.exercises.save(ex, null);
  for (const s of largeHistory()) await repos.sessions.save(s, null);
}, 600_000);
afterAll(async () => {
  await m.close();
  for (const d of dirs) d.cleanup();
});

describe('Your data on a 2-year history (your-data-merge S1, S2)', () => {
  it('counts, summary, Export, Reset, Undo last reset and Delete never block the JS thread for long', async () => {
    const counts = await measureBlocking(() => m.domainCounts());
    expect(counts.result.yourData.workouts).toBe(416);

    const summary = await measureBlocking(() => m.domainSummary());
    expect(summary.result.counts).toEqual(counts.result);

    const exported = await measureBlocking(async () => {
      const body = await m.exportDomain('your_data');
      const file = { format: 'fizz-export', formatVersion: 1, section: 'your_data', createdAt: at(0), schemaVersion: body.schemaVersion, tables: body.tables };
      return stringifyPretty(file, 1, timeSlicer());
    });
    expect(exported.result.length).toBeGreaterThan(1_000_000);

    const reset = await measureBlocking(() => m.resetKnowledge([BUNDLED], { expectedStamp: summary.result.stamp, at: at(1) }));
    expect(reset.result).toMatchObject({ ok: true, status: 'switched' });

    const undo = await measureBlocking(() => m.rollback(at(2)));
    expect(undo.result).toMatchObject({ ok: true });
    expect(m.rollbackTarget.last?.reason).toBe('undo_reset');
    expect((await m.domainCounts()).yourData.workouts).toBe(416);

    const del = await measureBlocking(() => m.deleteYourData());
    expect(del.result).toMatchObject({ ok: true, status: 'switched' });
    expect((await m.domainCounts()).yourData.records).toBe(0);

    console.log(
      `[S2]${jitless()} ${(exported.result.length / 1e6).toFixed(1)} MB export, total/longest block: counts ${fmt(counts)}, summary ${fmt(summary)}, export ${fmt(exported)}, reset ${fmt(reset)}, undo reset ${fmt(undo)}, delete ${fmt(del)}`,
    );
    // Before the fix Export blocked ~440 ms and Reset ~310 ms in one go (JIT). The margin absorbs CPU
    // contention from parallel test files, as the backup B1 test's does. Not yet measured on the phone.
    for (const step of [counts, summary, exported, reset, undo, del]) expect(step.maxBlockMs).toBeLessThan(1000);
    // Counts-only is SQL: no full read, no hash (S3).
    expect(counts.totalMs).toBeLessThan(summary.totalMs);
  }, 1_200_000);
});

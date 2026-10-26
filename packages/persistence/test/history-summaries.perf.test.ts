import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HISTORY_EXERCISES, largeHistory, loadSample, measureBlocking, profile, timingBudget } from '@fizz/domain/testing';
import { MIGRATIONS, openStore, timeSlicer, type Store } from '../src/index';
import { openNodeDriver } from '../src/node/index';
import { tempDir } from './helpers';

/**
 * (ADR 0032, Ben-approved 24 Oct) The stored history summaries on ~800 workouts (`largeHistory`, 200 weeks × 4): the
 * cold history reads straight after a launch read summaries, not every workout; the migration's backfill and the
 * consistency check run once over all of them without blocking the JS thread for long. Included in
 * `npm run test:perf:jitless` (budgets ×4 there).
 */

const jitless = process.execArgv.includes('--jitless');
const slow = jitless ? 4 : 1;
const lines: string[] = [];
const dirs: { cleanup: () => void }[] = [];
let file35 = '';
let file36 = '';
let startLoad = 0;
const ids = HISTORY_EXERCISES.map((e) => e.id);
const OWNER = profile().id;

function check(label: string, m: { totalMs: number; maxBlockMs: number }, totalMs: number, blockMs?: number): void {
  const budget = timingBudget(totalMs * slow, startLoad);
  lines.push(`${label}: ${String(Math.round(m.totalMs))} ms, longest block ${String(Math.round(m.maxBlockMs))} ms (budget ${String(Math.round(budget))})`);
  expect(m.totalMs, label).toBeLessThan(budget);
  if (blockMs !== undefined) expect(m.maxBlockMs, `${label}: longest block`).toBeLessThan(timingBudget(blockMs * slow, startLoad));
}

beforeAll(async () => {
  const d = tempDir();
  dirs.push(d);
  const history = largeHistory({ weeks: 200, perWeek: 4 });
  // The same history twice: written at schema 35 (no summaries; the update's backfill), and at the current schema.
  file35 = join(d.dir, 'at35.db');
  file36 = join(d.dir, 'at36.db');
  const at35 = await openStore(openNodeDriver(file35), { migrations: MIGRATIONS.slice(0, 35) });
  const at36 = await openStore(openNodeDriver(file36));
  for (const s of [at35, at36]) {
    await s.repos.profiles.save(profile(), null);
    for (const e of HISTORY_EXERCISES) await s.repos.exercises.save(e, null);
    for (const w of history) await s.repos.sessions.save(w, null);
    await s.close();
  }
  startLoad = loadSample();
}, 1_200_000);
afterAll(() => {
  console.log(`[History summaries]${jitless ? ' (--jitless)' : ''} 800 workouts:\n  ${lines.join('\n  ')}`);
  for (const d of dirs) d.cleanup();
});

describe('history summaries on ~800 workouts', () => {
  it('cold reads after a launch read summaries: every exercise’s history, the last 120 days, every workout for Progress', async () => {
    const store: Store = await openStore(openNodeDriver(file36));
    expect(store.summaryRefresh).toMatchObject({ written: 0 });
    const lifts = await measureBlocking(() => store.listExerciseHistories(OWNER, ids));
    expect([...lifts.result.values()].every((h) => h.length === 800)).toBe(true);
    check('every exercise’s history, cold', lifts, 250);
    const warm = await measureBlocking(() => store.listExerciseHistories(OWNER, ids));
    check('every exercise’s history, again', warm, 50);
    const window = await measureBlocking(() => store.repos.sessions.listFinishedBetweenReadable(OWNER, '2026-06-10T00:00:00.000Z', '2026-10-09T00:00:00.000Z'));
    expect(window.result.sessions.length).toBeGreaterThan(60);
    check('the last 120 days, cold', window, 100);
    const all = await store.db.read((q) => q.getAll<{ id: string }>("SELECT id FROM sessions WHERE status = 'finished'"));
    const progress = await measureBlocking(() => store.repos.sessions.getMany(all.map((r) => r.id)));
    expect(progress.result.size).toBe(800);
    check('every workout as history reads it (Progress), cold', progress, 600);
    await store.close();
  }, 1_200_000);

  it('the update’s backfill (migration 36) and the consistency check go over every workout once, in short turns', async () => {
    const opened = await measureBlocking(() => openStore(openNodeDriver(file35), { slice: timeSlicer() }));
    const store = opened.result;
    expect(store.migration.applied).toEqual([36, 37, 38]);
    check('migration 36 backfill (sliced)', opened, 12_000, 250);
    const checked = await measureBlocking(() => store.checkHistorySummaries());
    expect(checked.result).toMatchObject({ ok: true, checked: 800 });
    check('consistency check (every summary against its workout, in turns)', checked, 15_000, 250);
    await store.close();
  }, 1_200_000);
});

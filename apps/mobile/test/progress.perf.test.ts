import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toIso, toMs } from '@fizz/domain';
import {
  barbell,
  dumbbells,
  gym,
  HISTORY_EXERCISES,
  largeHistory,
  measureBlocking,
  profile,
  stack,
  loadSample,
  timingBudget,
  UNILATERAL_HISTORY_EXERCISE,
} from '@fizz/domain/testing';
import { openStore, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createProgressService } from '../src/services/progress-service';

/**
 * Progress on the spec's history size (check 25: 4 years, about 600
 * workouts; here 208 weeks × 3 = 624 workouts, ~17,500 sets, built like the
 * backup B1 fixture plus a single-arm dumbbell row logged left/right, so the
 * per-hand loads and the unilateral side-pairing are on the timed path). The cold pass (`prewarm`, run after launch and after
 * Finish) projects every workout and must never block the JS thread for long;
 * after it, opening Progress and switching windows or groupings re-read
 * nothing but `(id, revision)` and must stay under the 100 ms budget (Node
 * as a proxy for the phone; `npm run test:perf:jitless` runs it jitless too).
 * On a loaded machine the budget scales with the load (`timingBudget`);
 * `FIZZ_PERF_STRICT=1` enforces the plain 100 ms.
 */
const SWITCH_BUDGET_MS = 100;

const TZ = 'Europe/London';
let store: Store;
const clock = { ms: toMs('2026-10-08T18:05:00.000Z') };
const now = (): ZonedTimestamp => ({ utc: toIso(clock.ms), tz: TZ });

beforeAll(async () => {
  store = await openStore(openNodeDriver(':memory:'));
  await store.repos.profiles.save(profile(), null);
  await store.repos.gyms.save(gym(2, { isDefault: true }), null);
  for (const eq of [barbell(), stack(), dumbbells()]) await store.repos.equipment.save(eq, null);
  for (const ex of [...HISTORY_EXERCISES, UNILATERAL_HISTORY_EXERCISE]) await store.repos.exercises.save(ex, null);
  for (const s of largeHistory({ weeks: 208, perWeek: 3, unilateral: true })) await store.repos.sessions.save(s, null);
}, 600_000);
afterAll(async () => {
  await store.close();
});

describe('Progress on a 4-year, ~600-workout history', () => {
  it('the cold pass never blocks for long; after it, opening and switching windows and groupings are under 100 ms', async () => {
    const svc = createProgressService({
      store: () => store,
      now,
      profile: async () => (await store.repos.profiles.get(profile().id)) ?? null,
      saveSettings: () => Promise.resolve({ ok: true }),
      catalogueExercises: () => [],
      dispatch: () => Promise.reject(new Error('not used')),
    });
    const startLoad = loadSample();
    const budget = (ms: number) => timingBudget(ms, startLoad);
    const cold = await measureBlocking(() => svc.prewarm());
    const first = await measureBlocking(() => svc.home({ period: '1m' }));
    const view = first.result?.view;
    if (view?.dataState !== 'normal') throw new Error('expected normal');
    // 4 a week over the last 30 days ending the day before "today".
    expect(Number(view.activity.stats[0]?.value)).toBeGreaterThanOrEqual(12);
    expect(await store.repos.sessions.listFinishedRevisions(profile().id)).toHaveLength(624);

    const switches: { totalMs: number; maxBlockMs: number }[] = [];
    for (const period of ['3m', '6m', '1y', '1m'] as const) {
      for (const grouping of ['body_part', 'ppl'] as const) {
        switches.push(await measureBlocking(() => svc.home({ period, grouping })));
      }
    }
    const calendar = await measureBlocking(() => svc.calendar('2026-09'));
    const worstSwitch = Math.max(...switches.map((m) => m.totalMs));
    const fmt = (m: { totalMs: number; maxBlockMs: number }) => `${String(Math.round(m.totalMs))}ms/${String(Math.round(m.maxBlockMs))}ms`;
    console.log(
      `[Progress]${process.execArgv.includes('--jitless') ? ' (--jitless)' : ''} total/longest block: cold pass ${fmt(cold)}, first open ${fmt(first)}, window switches worst ${String(Math.round(worstSwitch))}ms, calendar ${fmt(calendar)}, budget ${String(Math.round(budget(SWITCH_BUDGET_MS)))}ms`,
    );
    // Longest block under 1 s, as the backup tests (margin for CPU contention from parallel files).
    expect(cold.maxBlockMs).toBeLessThan(budget(1000));
    for (const m of [first, ...switches, calendar]) expect(m.maxBlockMs).toBeLessThan(budget(1000));
    // The unilateral row is on the timed path: 4 left/right pairs a workout count as 4 Back sets, not 8.
    const back = view.muscles.rows.find((r) => r.label === 'Back');
    expect(back?.sessions).toBeGreaterThanOrEqual(12);
    expect(back?.sets).toBe(4 * (back?.sessions ?? 0));
    // After the cold pass: opening Progress and every switch within the check-25 budget.
    // A burst from parallel suites can stretch one pass; a real regression fails the repeat too (review progress-B r2 N1).
    let timed = { first: first.totalMs, worst: worstSwitch };
    if (timed.first >= budget(SWITCH_BUDGET_MS) || timed.worst >= budget(SWITCH_BUDGET_MS)) {
      const again = await measureBlocking(() => svc.home({ period: '1m' }));
      let worst = 0;
      for (const period of ['3m', '6m', '1y', '1m'] as const) {
        for (const grouping of ['body_part', 'ppl'] as const) worst = Math.max(worst, (await measureBlocking(() => svc.home({ period, grouping }))).totalMs);
      }
      console.log(`[Progress] repeat after a slow pass: first open ${String(Math.round(again.totalMs))}ms, window switches worst ${String(Math.round(worst))}ms`);
      timed = { first: again.totalMs, worst };
    }
    expect(timed.first).toBeLessThan(budget(SWITCH_BUDGET_MS));
    expect(timed.worst).toBeLessThan(budget(SWITCH_BUDGET_MS));
  }, 600_000);
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toIso, toMs } from '@fizz/domain';
import { barbell, gym, HISTORY_EXERCISES, largeHistory, measureBlocking, profile, stack } from '@fizz/domain/testing';
import { openStore, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createProgressService } from '../src/services/progress-service';

/**
 * Progress on a real-sized history (2 years, 4 workouts a week: 416
 * workouts, 8,320 sets; the backup B1 fixture). The first read projects every
 * workout and must never block the JS thread for long; after that, switching
 * windows or groupings re-reads nothing but `(id, revision)` and must be
 * quick (progress.md check 25: under 100 ms on the phone, no spinner).
 * Included in `npm run test:perf:jitless`.
 */

const TZ = 'Europe/London';
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

describe('Progress on a 2-year history', () => {
  it('the first read never blocks for long; switching windows and groupings is quick', async () => {
    const svc = createProgressService({
      store: () => store,
      now,
      profile: async () => (await store.repos.profiles.get(profile().id)) ?? null,
      saveSettings: () => Promise.resolve({ ok: true }),
      catalogueExercises: () => [],
      dispatch: () => Promise.reject(new Error('not used')),
    });
    const first = await measureBlocking(() => svc.home({ days: 30 }));
    const view = first.result?.view;
    if (view?.dataState !== 'normal') throw new Error('expected normal');
    // 4 a week over the last 30 days ending the day before "today".
    expect(Number(view.activity.stats[0]?.value)).toBeGreaterThanOrEqual(16);

    const switches: { totalMs: number; maxBlockMs: number }[] = [];
    for (const days of [7, 14, 60, 30] as const) {
      for (const grouping of ['body_part', 'ppl'] as const) {
        switches.push(await measureBlocking(() => svc.home({ days, grouping })));
      }
    }
    const calendar = await measureBlocking(() => svc.calendar('2026-09'));
    const worstSwitch = Math.max(...switches.map((m) => m.totalMs));
    const fmt = (m: { totalMs: number; maxBlockMs: number }) => `${String(Math.round(m.totalMs))}ms/${String(Math.round(m.maxBlockMs))}ms`;
    console.log(
      `[Progress]${process.execArgv.includes('--jitless') ? ' (--jitless)' : ''} total/longest block: first read ${fmt(first)}, window switches worst ${String(Math.round(worstSwitch))}ms, calendar ${fmt(calendar)}`,
    );
    // Longest block under 1 s, as the backup tests (margin for CPU contention from parallel files).
    expect(first.maxBlockMs).toBeLessThan(1000);
    for (const m of [...switches, calendar]) expect(m.maxBlockMs).toBeLessThan(1000);
    // Warm reads re-project nothing: far quicker than the first read.
    expect(worstSwitch).toBeLessThan(first.totalMs);
  }, 600_000);
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toIso, toMs } from '@fizz/domain';
import { barbell, dumbbells, gym, HISTORY_EXERCISES, largeHistory, measureBlocking, profile, stack, timingBudget, UNILATERAL_HISTORY_EXERCISE } from '@fizz/domain/testing';
import { openStore, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { ZonedTimestamp } from '@fizz/schemas';

import { createProgressService } from '../src/services/progress-service';

/**
 * Exercise detail (progress.md slice B) on a 2-year history: 104 weeks × 4 =
 * 416 workouts, 6 exercises each (barbell, stacks and a single-arm dumbbell
 * row logged left/right, so per-hand loads and side pairing are on the timed
 * path). After the cold pass, the Exercises list and every detail view
 * (each metric, `All`, both rep-table views, history paging) must never block
 * the JS thread for 1 s or more (the backup tests' bound; scaled with machine
 * load by `timingBudget`).
 */
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
  for (const s of largeHistory({ weeks: 104, perWeek: 4, unilateral: true })) await store.repos.sessions.save(s, null);
}, 600_000);
afterAll(async () => {
  await store.close();
});

describe('Exercise detail on a 2-year, 416-workout history', () => {
  it('the list and every detail view stay under 1 s of blocking', async () => {
    const svc = createProgressService({
      store: () => store,
      now,
      profile: async () => (await store.repos.profiles.get(profile().id)) ?? null,
      saveSettings: () => Promise.resolve({ ok: true }),
      catalogueExercises: () => [],
      dispatch: () => Promise.reject(new Error('not used')),
    });
    const cold = await measureBlocking(() => svc.prewarm());
    const list = await measureBlocking(() => svc.exercises());
    expect(list.result?.view.rows).toHaveLength(6);
    const bench = HISTORY_EXERCISES[0]?.id ?? '';
    const row = UNILATERAL_HISTORY_EXERCISE.id;

    const runs: { name: string; m: { totalMs: number; maxBlockMs: number } }[] = [];
    for (const metric of ['e1rm', 'top_set', 'total_weight'] as const) {
      for (const range of ['6m', 'all'] as const) {
        runs.push({ name: `bench ${metric} ${range}`, m: await measureBlocking(() => svc.exerciseDetail({ exerciseId: bench, metric, range })) });
      }
    }
    runs.push({ name: 'bench by reps', m: await measureBlocking(() => svc.exerciseDetail({ exerciseId: bench, repBy: 'reps', range: 'all' })) });
    runs.push({ name: 'bench history 24 months', m: await measureBlocking(() => svc.exerciseDetail({ exerciseId: bench, historyMonths: 24 })) });
    const uni = await measureBlocking(() => svc.exerciseDetail({ exerciseId: row, metric: 'total_weight', range: 'all' }));
    runs.push({ name: 'db row total weight all', m: uni });

    const fmt = (m: { totalMs: number; maxBlockMs: number }) => `${String(Math.round(m.totalMs))}ms/${String(Math.round(m.maxBlockMs))}ms`;
    console.log(
      `[Exercise detail]${process.execArgv.includes('--jitless') ? ' (--jitless)' : ''} total/longest block: cold ${fmt(cold)}, list ${fmt(list)}, ${runs.map((r) => `${r.name} ${fmt(r.m)}`).join(', ')}`,
    );
    for (const m of [cold, list, ...runs.map((r) => r.m)]) expect(m.maxBlockMs).toBeLessThan(timingBudget(1000));

    // The numbers are right on the large history too.
    const view = (await svc.exerciseDetail({ exerciseId: bench, metric: 'e1rm', range: 'all' }))?.view;
    expect(view?.stats.find((s) => s.label === 'SESSIONS')?.value).toBe('416');
    // 416 sessions in `All` > 150: weekly bests, and the table still lists every session.
    expect(view?.heading.endsWith('· weekly best')).toBe(true);
    expect(view?.table.rows).toHaveLength(416);
    // Total weight (Ben, 20 Oct: replaces Volume; both sides counted) is plain kg.
    const v = uni.result?.view;
    expect(v?.axisUnit).toBe('kg');
    expect(v?.points.length).toBeGreaterThan(0);
  }, 600_000);
});

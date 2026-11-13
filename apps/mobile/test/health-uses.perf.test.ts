import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSample, measureBlocking, timingBudget } from '@fizz/domain/testing';

import type { AppServices } from '../src/services/app-services';
import { FakeHealth } from './fake-health';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 27 Oct) The Health uses on a heavy Health history: 400 bodyweight entries of Ben's, two years of daily scale
 * readings, 30 nights of Apple Watch sleep stages (~40 segments a night) and 30 resting heart rates. Progress ›
 * Training's bodyweight card (All) and the last-night line read only local tables; budgets ×4 under --jitless.
 */

const DAY = 86_400_000;
let h: Harness;
let s: AppServices;
const timings: string[] = [];
const jitless = process.execArgv.includes('--jitless');
const slow = jitless ? 4 : 1;
let startLoad = 0;

async function timed<T>(label: string, budgetMs: number, fn: () => Promise<T>): Promise<T> {
  const m = await measureBlocking(fn);
  const budget = timingBudget(budgetMs * slow, startLoad);
  timings.push(`${label}: ${String(Math.round(m.totalMs))} ms, longest block ${String(Math.round(m.maxBlockMs))} ms (budget ${String(Math.round(budget))})`);
  expect(m.totalMs, label).toBeLessThan(budget);
  return m.result;
}

beforeAll(async () => {
  h = createHarness('2026-10-27T18:00:00.000Z');
  const fake = new FakeHealth();
  s = (await h.launch({ health: { port: fake, buildIncludesHealth: true } })).services;
  await setUpGym(h, s);
  const now = h.clockMs;
  const hex = (n: number) => n.toString(16).padStart(8, '0').toUpperCase();
  fake.weights = Array.from({ length: 730 }, (_, i) => ({ uuid: `${hex(i)}-0000-4000-8000-000000000001`, kg: 82 + Math.sin(i / 9), atMs: now - i * DAY - 12 * 3_600_000, sourceName: 'Withings', sourceBundleId: 'com.withings' }));
  fake.resting = Array.from({ length: 30 }, (_, i) => ({ uuid: `${hex(i)}-0000-4000-8000-000000000002`, bpm: 54 + (i % 4), atMs: now - i * DAY - 10 * 3_600_000, sourceName: 'Garmin Connect', sourceBundleId: 'g' }));
  fake.sleep = Array.from({ length: 30 * 40 }, (_, k) => {
    const night = Math.floor(k / 40);
    const start = now - night * DAY - 20 * 3_600_000 + (k % 40) * 11 * 60_000;
    return { uuid: `${hex(k)}-0000-4000-8000-000000000003`, value: 3 + (k % 3), startMs: start, endMs: start + 10 * 60_000, sourceName: 'Apple Watch', sourceBundleId: 'w' };
  });
  for (const k of ['readWeight', 'readRestingHeartRate', 'readSleep'] as const) await s.health.setSwitch(k, true);
  await s.health.readNow();
  for (let i = 0; i < 400; i += 1) {
    const card = await s.bodyweight.card('1m');
    const d = new Date(now - (i * 2 + 1) * DAY).toISOString().slice(0, 10);
    await s.bodyweight.log({ value: 82 + (i % 7) / 10, unit: 'kg', date: d, opId: `seed-${String(i)}`, expectedVersion: card?.version ?? 1 });
  }
  startLoad = loadSample();
}, 1_200_000);

afterAll(async () => {
  console.log(`[Health uses]${jitless ? ' (--jitless)' : ''}:\n  ${timings.join('\n  ')}`);
  await h.cleanup();
});

describe('Health uses on a heavy Health history (Ben, 27 Oct)', () => {
  it('the bodyweight card (All) and the last-night line open quickly from local tables', async () => {
    const all = await timed('bodyweight card, All', 80, () => s.bodyweight.card('all'));
    expect(all?.view.points.length).toBeGreaterThan(700);
    await timed('bodyweight card, 1M', 80, () => s.bodyweight.card('1m'));
    const night = await timed('last night line + trends', 120, () => s.health.lastNight());
    expect(night.line).not.toBeNull();
  });
});

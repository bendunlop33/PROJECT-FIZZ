import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSample, measureBlocking, timingBudget } from '@fizz/domain/testing';

import type { AppServices } from '../src/services/app-services';
import { bigDataset, bigDatasetExerciseId, type BigDataset } from './perf-dataset';

/**
 * (Ben, 26 Oct: "Progress slow"; app-review-26oct finding 1, 9) Progress on his real-sized phone: ~800 workouts,
 * ~20k sets and an applied 4-day plan (`perf-dataset.ts`). Each path is what the screen awaits for what is on
 * screen (ProgressScreen: the shell, then only the visible tab's reads). Node stands in for Hermes; `npm run
 * test:perf:jitless` runs this file without the JIT too (budgets ×4 there unless given). On a loaded machine
 * budgets scale (`timingBudget`).
 *
 * Before the fix (review 26 Oct, same dataset, Node / jitless): cold Overview 2,407 / 3,063 ms with a 881 / 1,049 ms
 * block; Training's `progress.home()` read on the same focus 1,697 / 2,076 ms; a return with nothing changed
 * 198 / 338 ms; a Lifts dropdown change 158 / 292 ms (20 full workouts read one at a time).
 */

let big: BigDataset;
const timings: string[] = [];
const jitless = process.execArgv.includes('--jitless');
const slow = jitless ? 4 : 1;
let startLoad = 0;

async function timed<T>(label: string, budgetMs: number, fn: () => Promise<T>, opts: { jitlessMs?: number; blockMs?: number } = {}): Promise<T> {
  const m = await measureBlocking(fn);
  const budget = timingBudget(jitless && opts.jitlessMs !== undefined ? opts.jitlessMs : budgetMs * slow, startLoad);
  timings.push(`${label}: ${String(Math.round(m.totalMs))} ms, longest block ${String(Math.round(m.maxBlockMs))} ms (budget ${String(Math.round(budget))})`);
  expect(m.totalMs, label).toBeLessThan(budget);
  if (opts.blockMs !== undefined) expect(m.maxBlockMs, `${label}: longest block`).toBeLessThan(timingBudget(opts.blockMs * slow, startLoad));
  return m.result;
}

/** What Progress awaits on open with Overview showing (the default tab). */
function overviewOpen(s: AppServices) {
  return Promise.all([s.progress.shell(), s.reviews.progress()]);
}
/** Training › Totals: its totals and the consistency card. */
function trainingOpen(s: AppServices) {
  return Promise.all([s.progress.home(), s.plans.consistency()]);
}

beforeAll(async () => {
  big = await bigDataset({ plan: true });
  startLoad = loadSample();
}, 1_200_000);
afterAll(async () => {
  console.log(`[Progress open]${jitless ? ' (--jitless)' : ''} ${String(big.sessions)} workouts, ${String(big.sets)} sets:\n  ${timings.join('\n  ')}`);
  await big.h.cleanup();
});

describe('Progress on ~800 workouts (Ben, 26 Oct)', () => {
  it('cold just after a launch, before the launch pass: Overview opens from the stored summaries', async () => {
    const { h } = big;
    await h.forceClose();
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const s = (await h.launch({ backgroundGate: () => gate })).services;
    const [shell, data] = await timed('Overview, cold (just launched)', 500, () => overviewOpen(s), { jitlessMs: 1500, blockMs: 400 });
    expect(shell?.hasData).toBe(true);
    expect(data?.lifts.empty).toBe(false);
    // Training isn't read while Overview shows; opening it cold is its own budget.
    await timed('Training tab, cold (first switch)', 1500, () => trainingOpen(s), { jitlessMs: 4000 });
    open();
    await s.progress.prewarm();
  }, 1_200_000);

  it('with the launch’s background work at once (backup, integrity check competing): still usable', async () => {
    const { h } = big;
    await h.forceClose();
    const s = (await h.launch()).services;
    await timed('Overview, cold, background work at once', 4000, () => overviewOpen(s));
  }, 1_200_000);

  it('after the launch pass: open, return with nothing changed, tab switches and Lifts option changes', async () => {
    const { h } = big;
    await h.forceClose();
    const s = (await h.launch()).services;
    await h.settle(s);
    await s.progress.prewarm();

    const [, first] = await timed('Overview (after the launch pass)', 400, () => overviewOpen(s));
    // A return to the tab with nothing written: answered from memory, the very same objects (no render).
    const [, again] = await timed('Overview again, nothing changed (focus return)', 25, () => overviewOpen(s), { jitlessMs: 50 });
    expect(again).toBe(first);

    const lifts = await timed('Lifts tab (switch)', 250, () => s.progress.exerciseTab({ period: '6m' }));
    const training = await timed('Training tab (switch)', 150, () => trainingOpen(s));
    expect(training[0]?.view.dataState).toBe('normal');
    const back = await timed('Training again, nothing changed', 25, () => trainingOpen(s), { jitlessMs: 50 });
    expect(back[0]).toBe(training[0]);
    expect(await s.progress.exerciseTab({ period: '6m' })).toBe(lifts);

    // Lifts dropdowns and chips: no workout is read again (review finding 9).
    const id = lifts?.view?.exerciseId ?? bigDatasetExerciseId('barbell-bench-press');
    await timed('Lifts: period 3 months', 150, () => s.progress.exerciseTab({ exerciseId: id, period: '3m' }));
    await timed('Lifts: measure Weight', 150, () => s.progress.exerciseTab({ exerciseId: id, period: '3m', measure: 'weight' }));
    await timed('Lifts: trailing 10', 150, () => s.progress.exerciseTab({ exerciseId: id, period: '3m', measure: 'weight', trailing: 10 }));
    await timed('Lifts: another chip (Squat)', 150, () => s.progress.exerciseTab({ exerciseId: bigDatasetExerciseId('barbell-back-squat'), period: '3m' }));

    // A write (a profile setting) is seen at once: the next open reads again.
    const saved = await s.progress.saveSettings({ period: '3m' });
    expect(saved.ok).toBe(true);
    const after = await timed('Training after a write (period saved)', 150, () => trainingOpen(s));
    expect(after[0]).not.toBe(training[0]);
    expect(after[0]?.period).toBe('3m');

    // The monthly recap on the 2nd of the next month: from the projections already in memory (no workout re-read).
    h.clockMs = Date.parse('2026-11-02T08:00:00.000Z');
    const recap = await timed('Monthly recap (2 Nov, after the launch pass)', 250, () => s.progress.recap());
    expect(recap?.view.month).toBe('2026-10');
    await timed('Monthly recap again, nothing changed', 25, () => s.progress.recap(), { jitlessMs: 50 });
  }, 1_200_000);
});

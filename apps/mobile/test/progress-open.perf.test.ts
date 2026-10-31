import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSample, measureBlocking, timingBudget } from '@fizz/domain/testing';

import type { AppServices } from '../src/services/app-services';
import { bigDataset, bigDatasetExerciseId, type BigDataset } from './perf-dataset';

/**
 * (Ben, 26 Oct: "Progress slow"; app-review-26oct finding 1, 9) Progress on his real-sized phone: ~800 workouts,
 * ~20k sets and an applied 4-day plan (`perf-dataset.ts`). Each path is what the screen awaits for what is on
 * screen (ProgressScreen: the shell, then only the visible tab's reads; redesign v3 C: Lifts first, Overview gone). Node stands in for Hermes; `npm run
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

/**
 * (Redesign v3 C) What Progress awaits on open: the shell (with the period bar, Month by default) and the Lifts tab
 * (the default tab) for the bar's dates, as `ExercisesTab` asks for it with no pick yet on this phone.
 */
const MONTH = { span: 'month' as const, offset: 0 };
async function liftsReq(s: AppServices, exerciseId: string | null = null) {
  const shell = await s.progress.shell(MONTH);
  const range = shell === null ? null : { from: shell.bar.window.from, to: shell.bar.window.to };
  return { exerciseId, remembered: null, period: shell?.bar.preset ?? ('1m' as const), range, measure: null, trailing: null, seriesId: null, open: null, targetsHit: false, repBy: 'weight' as const };
}
async function progressOpen(s: AppServices) {
  const req = await liftsReq(s);
  return Promise.all([s.progress.shell(MONTH), s.progress.exerciseTab(req)]);
}
/** Training › Month: the calendar, totals, muscles and the consistency card. */
function trainingOpen(s: AppServices, choice: { span: 'week' | 'month' | '3m' | '6m' | '1y'; offset: number } = MONTH) {
  return Promise.all([s.progress.training(choice), s.plans.consistency()]);
}

beforeAll(async () => {
  big = await bigDataset({ plan: true });
  startLoad = loadSample();
}, 1_200_000);
afterAll(async () => {
  console.log(`[Progress open]${jitless ? ' (--jitless)' : ''} ${String(big.sessions)} workouts, ${String(big.sets)} sets:\n  ${timings.join('\n  ')}`);
  await big.h.cleanup();
});

describe('Progress on ~800 workouts (Ben, 26 Oct; redesign v3 C)', () => {
  it('cold just after a launch, before the launch pass: Progress opens on Lifts', async () => {
    const { h } = big;
    await h.forceClose();
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const s = (await h.launch({ backgroundGate: () => gate })).services;
    // Every workout is read for Lifts (Overview, 0.5 s, read stored summaries): the old cold Training budget, Overview's block budget.
    const [shell, lifts] = await timed('Progress open (Lifts), cold (just launched)', 1500, () => progressOpen(s), { jitlessMs: 4000, blockMs: 400 });
    expect(shell?.hasData).toBe(true);
    expect(lifts?.view).not.toBeNull();
    // Training isn't read while Lifts shows; opening it is its own budget (the workouts are in memory now).
    await timed('Training tab, first switch', 150, () => trainingOpen(s), { jitlessMs: 600 });
    open();
    await s.progress.prewarm();
  }, 1_200_000);

  it('with the launch’s background work at once (backup, integrity check competing): still usable', async () => {
    const { h } = big;
    await h.forceClose();
    const s = (await h.launch()).services;
    await timed('Progress open (Lifts), cold, background work at once', 4000, () => progressOpen(s));
  }, 1_200_000);

  it('after the launch pass: open, return with nothing changed, tab switches, period steps and Lifts option changes', async () => {
    const { h } = big;
    await h.forceClose();
    const s = (await h.launch()).services;
    await h.settle(s);
    await s.progress.prewarm();

    const [, first] = await timed('Progress open (after the launch pass)', 400, () => progressOpen(s));
    // A return to the tab with nothing written: answered from memory, the very same objects (no render).
    const [, again] = await timed('Progress again, nothing changed (focus return)', 25, () => progressOpen(s), { jitlessMs: 50 });
    expect(again).toBe(first);

    const training = await timed('Training tab (switch)', 150, () => trainingOpen(s));
    expect(training[0]?.view?.month).not.toBeNull();
    const back = await timed('Training again, nothing changed', 25, () => trainingOpen(s), { jitlessMs: 50 });
    expect(back[0]).toBe(training[0]);

    // The period bar: ‹ a month back, Week, 1Y; each is one pass over the workouts in memory.
    await timed('Training: ‹ (September)', 150, () => trainingOpen(s, { span: 'month', offset: -1 }));
    await timed('Training: Week', 150, () => trainingOpen(s, { span: 'week', offset: 0 }));
    const year = await timed('Training: 1Y (a bar per week)', 150, () => trainingOpen(s, { span: '1y', offset: 0 }));
    expect(year[0]?.view?.bars?.weeks.length).toBeGreaterThanOrEqual(51);

    // Lifts dropdowns and chips: no workout is read again (review finding 9).
    const id = first?.view?.exerciseId ?? bigDatasetExerciseId('barbell-bench-press');
    const base = await liftsReq(s, id);
    const threeMonths = { ...base, period: '3m' as const, range: { from: (await s.progress.shell({ span: '3m', offset: 0 }))?.bar.window.from ?? '', to: base.range?.to ?? '' } };
    await timed('Lifts: period 3M', 150, () => s.progress.exerciseTab(threeMonths));
    await timed('Lifts: measure Weight', 150, () => s.progress.exerciseTab({ ...threeMonths, measure: 'weight' }));
    await timed('Lifts: trailing 10', 150, () => s.progress.exerciseTab({ ...threeMonths, measure: 'weight', trailing: 10 }));
    await timed('Lifts: another chip (Squat)', 150, () => s.progress.exerciseTab({ ...threeMonths, exerciseId: bigDatasetExerciseId('barbell-back-squat') }));

    // A write (a profile setting) is seen at once: the next open reads again.
    const saved = await s.progress.saveSettings({ grouping: 'ppl' });
    expect(saved.ok).toBe(true);
    const after = await timed('Training after a write (grouping saved)', 150, () => trainingOpen(s));
    expect(after[0]).not.toBe(training[0]);
    expect(after[0]?.home.grouping).toBe('ppl');

    // The monthly recap on the 2nd of the next month: from the projections already in memory (no workout re-read).
    h.clockMs = Date.parse('2026-11-02T08:00:00.000Z');
    const recap = await timed('Monthly recap (2 Nov, after the launch pass)', 250, () => s.progress.recap());
    expect(recap?.view.month).toBe('2026-10');
    await timed('Monthly recap again, nothing changed', 25, () => s.progress.recap(), { jitlessMs: 50 });
  }, 1_200_000);
});

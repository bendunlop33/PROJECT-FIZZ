import { describe, expect, it } from 'vitest';
import { timingBudget } from './large-history';
import { isLoadAchievable, stepLoad } from '../src/index';
import { barbell, kg } from './fixtures';

/** Timing budget for the memoised achievable loads (review M8). Perf lane only: `npm run test:perf`. */
describe('memoised achievable loads (review M8)', () => {
  // A realistic commercial inventory: 10 plate sizes, 40 of each.
  const commercial = () =>
    barbell({
      plates: [25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5].map((mass) => ({ mass, count: 40 })),
    });

  it('stepper taps on a large inventory stay cheap (was ~5 ms per call before memoising)', () => {
    const eq = commercial();
    stepLoad(100, eq, 'increase'); // warm the cache
    const t0 = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      stepLoad(100 + (i % 50), eq, i % 2 === 0 ? 'increase' : 'decrease');
      isLoadAchievable(kg(100 + (i % 50)), eq);
    }
    // Generous bound so slow CI machines don't flake; without the cache this takes seconds.
    expect(performance.now() - t0).toBeLessThan(timingBudget(500));
  });
});

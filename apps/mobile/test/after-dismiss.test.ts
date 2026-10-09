import { describe, expect, it } from 'vitest';

import { createAfterDismiss } from '../src/workout/after-dismiss';

describe('navigate only after a sheet closes (review S8)', () => {
  it('runs once on dismiss, and the fallback does nothing after that', () => {
    const timers: (() => void)[] = [];
    const a = createAfterDismiss(700, (fn) => timers.push(fn));
    let runs = 0;
    a.arm(() => (runs += 1));
    expect(runs).toBe(0);
    a.dismissed();
    timers.forEach((t) => {
      t();
    });
    expect(runs).toBe(1);
  });

  it('falls back to the timer when no dismissal is reported', () => {
    const timers: (() => void)[] = [];
    const a = createAfterDismiss(700, (fn) => timers.push(fn));
    let runs = 0;
    a.arm(() => (runs += 1));
    timers.forEach((t) => {
      t();
    });
    a.dismissed();
    expect(runs).toBe(1);
  });
});

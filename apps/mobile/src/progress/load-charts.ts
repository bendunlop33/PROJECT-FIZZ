import { createGuardedLoader } from '../guide/guarded-load';
import type { TrendCanvas } from './TrendCanvas';
import type { WeekBarsCanvas } from './WeekBarsCanvas';

/**
 * Skia for Progress's bars, required on first draw (as How to's guide
 * player), so a Skia module failure becomes plain-view bars instead of a
 * crashed tab. The type-only import above is erased.
 */
export const loadWeekBarsCanvas = createGuardedLoader(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy, guarded load
  const mod = require('./WeekBarsCanvas') as { WeekBarsCanvas: typeof WeekBarsCanvas };
  return mod.WeekBarsCanvas;
});

/** The exercise `TrendChart` plot, behind the same guard: a Skia failure falls back to the table, never a crash. */
export const loadTrendCanvas = createGuardedLoader(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy, guarded load
  const mod = require('./TrendCanvas') as { TrendCanvas: typeof TrendCanvas };
  return mod.TrendCanvas;
});

import { createGuardedLoader } from '../guide/guarded-load';
import type { TrendCanvas } from './TrendCanvas';

/**
 * Skia for Progress's charts, required on first draw (as How to's guide
 * player), so a Skia module failure becomes plain views instead of a crashed
 * tab. The type-only import above is erased. The activity line and the
 * exercise `TrendChart` share this one canvas; on failure the activity line
 * draws plain-view points and the trend chart falls back to its table.
 */
export const loadTrendCanvas = createGuardedLoader(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy, guarded load
  const mod = require('./TrendCanvas') as { TrendCanvas: typeof TrendCanvas };
  return mod.TrendCanvas;
});

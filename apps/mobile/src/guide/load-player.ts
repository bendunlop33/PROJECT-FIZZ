import type { GuidePlayer } from './GuidePlayer';
import { createGuardedLoader } from './guarded-load';

/**
 * The guide player, required only when How to first shows a guide (review
 * S1). It imports Skia and Reanimated's hooks, so a module-evaluation failure
 * there becomes `{ ok: false }` and the cues-only fallback, never a crash at
 * launch or on opening How to. The type-only import above is erased.
 */
export const loadGuidePlayer = createGuardedLoader(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy, guarded load
  const mod = require('./GuidePlayer') as { GuidePlayer: typeof GuidePlayer };
  return mod.GuidePlayer;
});

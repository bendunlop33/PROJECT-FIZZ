import { armLaunchGuard, settleLaunchGuard } from './crash-capture';
import { createSettler, type LaunchPhase } from './launch-guard';

/**
 * The launch-crash guard's one settler for the app run (`launch-guard.ts`): the first screen arms it, the workout
 * screen re-arms it as it opens, and going to the background settles at once.
 */
export const launchSettler = createSettler(
  {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => {
      clearTimeout(h as ReturnType<typeof setTimeout>);
    },
  },
  settleLaunchGuard,
);

/** A screen that could close the app on open (the workout screen): breadcrumb it, then settle after it stays up. */
export function guardScreenOpen(phase: LaunchPhase): void {
  armLaunchGuard(phase);
  launchSettler.arm();
}

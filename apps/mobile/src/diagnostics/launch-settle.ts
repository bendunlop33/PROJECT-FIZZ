import { armLaunchGuard, holdLaunchGuard, settleLaunchGuard } from './crash-capture';
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
    // (Hang fix, 27 Oct) Settling waits for a drawn frame: a stuck main thread draws none.
    frame: (fn) => {
      requestAnimationFrame(() => {
        fn();
      });
    },
  },
  settleLaunchGuard,
);

/** A screen that could close the app on open (the workout screen): breadcrumb it, then settle after it stays up. */
export function guardScreenOpen(phase: LaunchPhase): void {
  armLaunchGuard(phase);
  launchSettler.arm();
}

/**
 * (Hang fix, 27 Oct) An error boundary caught a render error: the run never settles and its breadcrumb stays, so the
 * next launch is a safe start that names the error (Ben saw only a blank screen, every launch, on build 457).
 */
export function holdLaunch(): void {
  launchSettler.hold();
  holdLaunchGuard();
}

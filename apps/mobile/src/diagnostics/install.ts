/**
 * Side-effect import, first in `index.ts`: installs crash capture before any
 * other app module is evaluated, so errors at launch are recorded too.
 */
import { installCrashCapture, startLaunchGuard } from './crash-capture';

installCrashCapture();
// The launch-crash guard (`launch-guard.ts`): decides a safe start from what the last run left, then arms this run's.
startLaunchGuard();

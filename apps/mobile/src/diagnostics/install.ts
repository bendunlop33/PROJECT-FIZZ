/**
 * Side-effect import, first in `index.ts`: installs crash capture before any
 * other app module is evaluated, so errors at launch are recorded too.
 */
import { installCrashCapture } from './crash-capture';

installCrashCapture();

import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';

import { isoUtc, nowMs } from '../clock';
import {
  createGlobalErrorHandler,
  GUIDE_OPEN_FILE,
  LAST_ERROR_FILE,
  parseErrorRecord,
  parseGuideBreadcrumb,
  recordFromGuideBreadcrumb,
  toErrorRecord,
  toGuideBreadcrumb,
  type ErrorContext,
  type ErrorRecord,
  type GlobalHandler,
} from './error-record';

/**
 * Phone bindings for crash capture (`error-record.ts`). Installed from
 * `index.ts` before the app registers, so errors at launch are caught too.
 * The file is written synchronously (expo-file-system 57 `File.write`): a
 * fatal error closes the app right after the handler returns.
 *
 * Only JS-thread errors reach this handler. In a release build an uncaught
 * animation-thread (worklet) error aborts the app natively, as does a crash
 * in Skia, Reanimated or iOS itself: none of those can be caught here. App
 * worklets catch their own errors (ADR 0018); for the rest, the How to
 * breadcrumb shows a close during How to at the next launch.
 */

interface ErrorUtilsLike {
  getGlobalHandler: () => GlobalHandler;
  setGlobalHandler: (handler: GlobalHandler) => void;
}

let currentScreen: string | null = null;
let installed = false;

function lastErrorFile(): File {
  return new File(Paths.document, LAST_ERROR_FILE);
}

function guideOpenFile(): File {
  return new File(Paths.document, GUIDE_OPEN_FILE);
}

function buildLabel(): string | null {
  try {
    const version = Application.nativeApplicationVersion;
    const build = Application.nativeBuildVersion;
    return version === null && build === null ? null : `${version ?? '?'} (${build ?? '?'})`;
  } catch {
    return null;
  }
}

function timeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function context(): ErrorContext {
  return { nowUtc: isoUtc(nowMs()), tz: timeZone(), screen: currentScreen, build: buildLabel() };
}

function save(record: ErrorRecord): void {
  lastErrorFile().write(JSON.stringify(record));
}

export function installCrashCapture(): void {
  if (installed) return;
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (utils === undefined) return;
  installed = true;
  settleGuideBreadcrumb();
  const handler = createGlobalErrorHandler({
    previous: utils.getGlobalHandler(),
    context,
    save,
  });
  utils.setGlobalHandler(handler);
}

/** The navigator reports the focused route's name (never its parameters). */
export function setCurrentScreen(name: string | null): void {
  currentScreen = name;
}

/** An error a feature caught itself (an error boundary, a guarded load): recorded as Last error, never rethrown. */
export function recordContainedError(error: unknown, containedBy: string): void {
  try {
    save(toErrorRecord(error, false, containedBy, context()));
  } catch {
    // Best effort.
  }
}

export function readLastError(): ErrorRecord | null {
  try {
    const f = lastErrorFile();
    return f.exists ? parseErrorRecord(f.textSync()) : null;
  } catch {
    return null;
  }
}

export function clearLastError(): void {
  try {
    const f = lastErrorFile();
    if (f.exists) f.delete();
  } catch {
    // Nothing to clear, or the file system is unavailable; App status re-reads either way.
  }
}

/** A breadcrumb left by the last run becomes the Last error (unless a JS error explains the close), then goes. */
function settleGuideBreadcrumb(): void {
  try {
    const f = guideOpenFile();
    if (!f.exists) return;
    const record = recordFromGuideBreadcrumb(parseGuideBreadcrumb(f.textSync()), readLastError());
    if (record !== null) save(record);
    f.delete();
  } catch {
    // Best effort: diagnostics must never stop the app launching.
  }
}

/** The guide player is on screen with the app active (written synchronously, so a native abort right after still leaves it). */
export function markGuideOpen(): void {
  try {
    guideOpenFile().write(JSON.stringify(toGuideBreadcrumb(context())));
  } catch {
    // Best effort.
  }
}

/** The guide player unmounted, or the app went to the background. */
export function clearGuideOpen(): void {
  try {
    const f = guideOpenFile();
    if (f.exists) f.delete();
  } catch {
    // Best effort.
  }
}

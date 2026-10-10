import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';

import { isoUtc, nowMs } from '../clock';
import { createContainmentScopes, createGlobalErrorHandler, LAST_ERROR_FILE, parseErrorRecord, toErrorRecord, type ErrorContext, type ErrorRecord, type GlobalHandler } from './error-record';

/**
 * Phone bindings for crash capture (`error-record.ts`). Installed from
 * `index.ts` before the app registers, so errors at launch are caught too.
 * The file is written synchronously (expo-file-system 57 `File.write`): a
 * fatal error closes the app right after the handler returns.
 *
 * Only JS errors (including UI-thread errors Worklets forwards to JS) reach
 * this handler. A native crash (Skia, Reanimated or iOS itself) can't be
 * caught here and leaves no record; App status says so.
 */

interface ErrorUtilsLike {
  getGlobalHandler: () => GlobalHandler;
  setGlobalHandler: (handler: GlobalHandler) => void;
}

const scopes = createContainmentScopes();
let currentScreen: string | null = null;
let installed = false;

function lastErrorFile(): File {
  return new File(Paths.document, LAST_ERROR_FILE);
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
  const handler = createGlobalErrorHandler({
    previous: utils.getGlobalHandler(),
    scopes,
    context,
    save,
  });
  utils.setGlobalHandler(handler);
}

/** The navigator reports the focused route's name (never its parameters). */
export function setCurrentScreen(name: string | null): void {
  currentScreen = name;
}

/**
 * While open, any JS error (fatal or not) goes to `onError` instead of
 * closing the app. Open it only around something whose failure is harmless
 * to the rest of the app, and close it when that unmounts.
 */
export function openContainment(id: string, onError: (error: unknown) => void): () => void {
  return scopes.open(id, onError);
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

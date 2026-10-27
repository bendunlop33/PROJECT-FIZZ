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
import { decideLaunch, LAUNCH_GUARD_FILE, launchBreadcrumb, NATIVE_OFF_FILE, nativeOffAfter, parseNativeOff, type LaunchGuardDecision, type LaunchPhase, type NativeFeature } from './launch-guard';

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

// ------------------------------------------------------------------ launch-crash guard (`launch-guard.ts`)

let launchDecision: LaunchGuardDecision = { safe: false, previous: null };
let launchGuardStarted = false;
/** This run's own phase while unsettled (null once settled). */
let currentPhase: LaunchPhase | null = 'launch';
/** Native calls of optional features in flight, newest last (each one breadcrumbed while it runs). */
const inFlight: NativeFeature[] = [];
/** In the background a close is iOS's to make (memory, suspension), never a launch crash: no breadcrumb then. */
let inBackground = false;
let offFeatures: ReadonlySet<NativeFeature> = new Set();

function launchGuardFile(): File {
  return new File(Paths.document, LAUNCH_GUARD_FILE);
}

function nativeOffFile(): File {
  return new File(Paths.document, NATIVE_OFF_FILE);
}

/**
 * First thing in `index.ts` (after crash capture): read what the last run left, decide whether this launch starts
 * safe and which optional native features stay off on this build, and leave this run's own breadcrumb. Written
 * synchronously, so a crash a moment later still leaves it. Never throws: a file-system failure is a normal launch.
 */
export function startLaunchGuard(): void {
  if (launchGuardStarted) return;
  launchGuardStarted = true;
  try {
    const f = launchGuardFile();
    launchDecision = decideLaunch(f.exists ? f.textSync() : null);
  } catch {
    launchDecision = { safe: false, previous: null };
  }
  try {
    const off = nativeOffFile();
    const ctx = context();
    const r = nativeOffAfter({ previous: launchDecision.previous, stored: parseNativeOff(off.exists ? off.textSync() : null), build: ctx.build, nowUtc: ctx.nowUtc });
    offFeatures = r.off;
    if (r.record !== null) off.write(JSON.stringify(r.record));
    else if (off.exists) off.delete();
  } catch {
    offFeatures = new Set();
  }
  armLaunchGuard('launch');
}

function writeBreadcrumb(): void {
  try {
    const phase = inBackground ? null : (inFlight.at(-1) ?? currentPhase);
    const f = launchGuardFile();
    if (phase === null) {
      if (f.exists) f.delete();
      return;
    }
    const ctx = context();
    f.write(JSON.stringify(launchBreadcrumb(phase, ctx.nowUtc, ctx.build, launchDecision.previous)));
  } catch {
    // Best effort.
  }
}

/** (Re)write this run's breadcrumb: launching, or the workout screen opening. */
export function armLaunchGuard(phase: LaunchPhase): void {
  currentPhase = phase;
  writeBreadcrumb();
}

/** The run settled (on screen long enough, or sent to the background): no breadcrumb, so the next launch is normal. */
export function settleLaunchGuard(): void {
  currentPhase = null;
  writeBreadcrumb();
}

/** The app went to the background (true) or came back (false); Root's AppState listener reports it. */
export function setLaunchGuardBackground(background: boolean): void {
  inBackground = background;
  writeBreadcrumb();
}

/**
 * A synchronous native call of an optional feature (ActivityKit's request, list and update): breadcrumbed while it
 * runs, so if the app dies inside it the next launch names it and leaves the feature off on this build. Errors it
 * throws pass through unchanged (the caller already handles them).
 */
export function guardNativeCall<T>(feature: NativeFeature, fn: () => T): T {
  inFlight.push(feature);
  writeBreadcrumb();
  try {
    return fn();
  } finally {
    const i = inFlight.lastIndexOf(feature);
    if (i >= 0) inFlight.splice(i, 1);
    writeBreadcrumb();
  }
}

/** The same for an async native call (HealthKit's, ActivityKit's update and end). */
export async function guardNativeCallAsync<T>(feature: NativeFeature, fn: () => Promise<T>): Promise<T> {
  inFlight.push(feature);
  writeBreadcrumb();
  try {
    return await fn();
  } finally {
    const i = inFlight.lastIndexOf(feature);
    if (i >= 0) inFlight.splice(i, 1);
    writeBreadcrumb();
  }
}

/** This launch starts safe (the last run closed before it settled). */
export function launchSafeMode(): LaunchGuardDecision {
  return launchDecision;
}

/** An optional native feature is on for this run: not a safe start, and not turned off on this build by a crash in it. */
export function nativeFeatureOn(feature: NativeFeature): boolean {
  return !launchDecision.safe && !offFeatures.has(feature);
}

/** The optional native features off on this build (a crash inside them). */
export function nativeFeaturesOffForBuild(): ReadonlySet<NativeFeature> {
  return offFeatures;
}

/** The last error, only if it was recorded by the run that left the breadcrumb (or later). */
export function lastErrorSinceLastLaunch(): ErrorRecord | null {
  const prev = launchDecision.previous;
  const e = readLastError();
  if (e === null) return null;
  if (prev === null) return launchDecision.safe ? e : null;
  return e.atUtc >= prev.atUtc ? e : null;
}

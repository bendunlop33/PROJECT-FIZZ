/**
 * Launch-crash guard (Ben, 27 Oct 2026: "flashes then closes" on every launch
 * after a Start, no device logs). Pure parts, unit-tested in Node;
 * `crash-capture.ts` binds them to a small file in the app's container.
 *
 * A breadcrumb is written as early as JS runs (`index.ts` → `install.ts`), and
 * again while the workout screen opens. It is removed once the app has stayed
 * open on a screen for `LAUNCH_STABLE_MS` and drawn a frame after that, or when
 * it goes to the background having drawn one (Ben left it; not a crash). One
 * still there at the next launch means the last run closed (or froze) before it
 * settled: a JS error React Native treats as fatal, a native crash, or a stuck
 * main thread. A render error an error boundary contained holds the run
 * unsettled too (hang fix, 27 Oct: on build 457 the workout's render error left
 * a blank modal, and swiping the app away settled it, so every launch reopened
 * the workout into the same blank screen).
 *
 * That next launch is a safe start: the unfinished workout is not opened by
 * itself, and the optional native layers that run on launch with a workout in
 * progress (the Live Activity, Apple Health) are left off for that run. The
 * workout and every other record are read and kept exactly as stored, and not
 * recovered until Resume; nothing is repaired or rewritten. The Safe start
 * screen shows before the data is even opened. Ben chooses Resume, Today (Discard is there, with
 * its own confirmation) or a backup copy. A safe start that settles clears the
 * breadcrumb like any other, so the following launch is a normal one.
 */

import { toMs } from '@fizz/domain';

export const LAUNCH_GUARD_FILE = 'launch-guard.json';

/** How long the app must stay open on a screen before a launch (or opening the workout) counts as settled. */
export const LAUNCH_STABLE_MS = 8000;

/**
 * Where the last run was when it closed: launching, opening the workout screen, or inside a native call of an
 * optional feature (the Live Activity's ActivityKit calls, Apple Health's HealthKit calls), which is breadcrumbed
 * for its duration so a native crash in it is named at the next launch.
 */
export type LaunchPhase = 'launch' | 'workout' | 'render_error' | NativeFeature;

/** Optional native features a crash inside turns off on this phone until the next build (`nativeOffAfter`). */
export type NativeFeature = 'live_activity' | 'health';
export const NATIVE_FEATURES: readonly NativeFeature[] = ['live_activity', 'health'];

/** Features turned off after a crash inside them, and the build that crashed (a new build tries them again). */
export const NATIVE_OFF_FILE = 'native-off.json';

export interface NativeOffRecord {
  v: 1;
  build: string | null;
  features: NativeFeature[];
  atUtc: string;
}

export interface LaunchBreadcrumb {
  v: 1;
  phase: LaunchPhase;
  atUtc: string;
  build: string | null;
  /** Unsettled runs in a row, this one included. */
  failures: number;
}

export interface LaunchGuardDecision {
  /** Start safe: no auto-open of the workout, no Live Activity, no Apple Health on this run. */
  safe: boolean;
  /** The breadcrumb the last run left (null: it settled, or this is the first run). */
  previous: LaunchBreadcrumb | null;
}

/** The saved breadcrumb, or null if missing or unreadable (never throws). */
export function parseLaunchBreadcrumb(text: string | null | undefined): LaunchBreadcrumb | null {
  if (text === null || text === undefined || text === '') return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown> | null;
    if (typeof j !== 'object' || j === null || j.v !== 1 || typeof j.atUtc !== 'string') return null;
    toMs(j.atUtc);
    const phase: LaunchPhase = j.phase === 'workout' || j.phase === 'render_error' || j.phase === 'live_activity' || j.phase === 'health' ? j.phase : 'launch';
    const failures = typeof j.failures === 'number' && Number.isFinite(j.failures) && j.failures >= 1 ? Math.min(1000, Math.floor(j.failures)) : 1;
    return { v: 1, phase, atUtc: j.atUtc, build: typeof j.build === 'string' ? j.build : null, failures };
  } catch {
    return null;
  }
}

/**
 * This launch, from what the last one left. A breadcrumb that is there at all means the last run never settled:
 * start safe. An unreadable file counts as one too (it was written by a run that never removed it).
 */
export function decideLaunch(previousText: string | null | undefined): LaunchGuardDecision {
  if (previousText === null || previousText === undefined) return { safe: false, previous: null };
  const previous = parseLaunchBreadcrumb(previousText);
  return { safe: true, previous };
}

/** The breadcrumb a run writes while it is not yet settled. */
export function launchBreadcrumb(phase: LaunchPhase, atUtc: string, build: string | null, previous: LaunchBreadcrumb | null): LaunchBreadcrumb {
  return { v: 1, phase, atUtc, build, failures: (previous?.failures ?? 0) + 1 };
}

const isFeature = (x: unknown): x is NativeFeature => x === 'live_activity' || x === 'health';

export function parseNativeOff(text: string | null | undefined): NativeOffRecord | null {
  if (text === null || text === undefined || text === '') return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown> | null;
    if (typeof j !== 'object' || j === null || j.v !== 1 || !Array.isArray(j.features)) return null;
    const features = [...new Set(j.features.filter(isFeature))];
    return { v: 1, build: typeof j.build === 'string' ? j.build : null, features, atUtc: typeof j.atUtc === 'string' ? j.atUtc : '' };
  } catch {
    return null;
  }
}

/**
 * The optional native features off on this launch: those a run of THIS build closed inside (the record kept from
 * earlier launches, plus the last run's if it closed inside one). A different build tries them all again (a fix may
 * have landed); the build is unknown (null) on both sides only in tests. `record`: what to keep for later launches
 * (null: nothing off, the file can go).
 */
export function nativeOffAfter(input: { previous: LaunchBreadcrumb | null; stored: NativeOffRecord | null; build: string | null; nowUtc: string }): { off: ReadonlySet<NativeFeature>; record: NativeOffRecord | null } {
  const kept = input.stored !== null && input.stored.build === input.build ? input.stored.features : [];
  const crashed = input.previous !== null && isFeature(input.previous.phase) && input.previous.build === input.build ? [input.previous.phase] : [];
  const features = [...new Set([...kept, ...crashed])];
  if (features.length === 0) return { off: new Set(), record: null };
  return { off: new Set(features), record: { v: 1, build: input.build, features, atUtc: crashed.length > 0 ? input.nowUtc : (input.stored?.atUtc ?? input.nowUtc) } };
}

/**
 * Settling: a timer from the first screen, cancelled by nothing but a new arm. Pure over its clock, so the rule
 * ("on screen for 8 s, or sent to the background") is tested without React Native.
 */
export interface SettleClock {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /**
   * (Hang fix, 27 Oct) Calls back once the screen has drawn a frame (React Native's `requestAnimationFrame`, driven
   * by the display on the main thread). Absent: no frame check (tests of the timer alone).
   */
  frame?: (fn: () => void) => void;
}

/**
 * (Hang fix, 27 Oct) A run settles only when the app is provably alive: the timer ran AND a frame was drawn after
 * it (a main thread stuck in a loop draws none, so its breadcrumb stays and the next launch is a safe start), and
 * never while a contained render error holds it (`hold`). Going to the background settles only a run that has
 * drawn a frame since its last arm: Ben swiping away a blank or frozen app is not "Ben left it".
 */
export function createSettler(clock: SettleClock, settle: () => void) {
  let timer: unknown = null;
  let settled = false;
  let held = false;
  /** A frame was drawn since the last arm (always true without a frame source). */
  let framed = clock.frame === undefined;
  let generation = 0;
  const done = () => {
    timer = null;
    if (settled || held) return;
    settled = true;
    settle();
  };
  const fire = () => {
    timer = null;
    if (settled || held) return;
    if (framed || clock.frame === undefined) {
      done();
      return;
    }
    const g = generation;
    clock.frame(() => {
      if (g !== generation) return;
      framed = true;
      done();
    });
  };
  return {
    /** A screen is up (or the workout screen opened): settle after `LAUNCH_STABLE_MS` and a drawn frame, unless re-armed. */
    arm(): void {
      settled = false;
      generation += 1;
      if (timer !== null) clock.clearTimeout(timer);
      timer = clock.setTimeout(fire, LAUNCH_STABLE_MS);
      if (clock.frame !== undefined) {
        framed = false;
        const g = generation;
        clock.frame(() => {
          if (g === generation) framed = true;
        });
      }
    },
    /** The app went to the background: Ben left a working app (it drew a frame since the last arm), not a crash. */
    background(): void {
      if (!framed || held) return;
      if (timer !== null) clock.clearTimeout(timer);
      done();
    },
    /** A run that started in the background (a Lock Screen button's intent): nothing on screen to wait for. */
    settleNow(): void {
      if (timer !== null) clock.clearTimeout(timer);
      done();
    },
    /** A render error was contained: this run never settles (the next launch is a safe start, showing the error). */
    hold(): void {
      held = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
    },
    get settled(): boolean {
      return settled;
    },
    get held(): boolean {
      return held;
    },
  };
}

/** The safe start's words (minimal, Ben 10 Oct): what happened, what is kept, the error if one was recorded. */
export interface SafeStartView {
  title: string;
  lines: string[];
  /** `Resume workout` when a workout is in progress. */
  resume: boolean;
}

const CLOSED_WHERE: Readonly<Record<LaunchPhase, string>> = {
  launch: 'GymSmarter closed during the last launch.',
  workout: 'GymSmarter closed while opening the workout.',
  render_error: 'GymSmarter hit an error last time.',
  live_activity: 'GymSmarter closed while starting the Live Activity.',
  health: 'GymSmarter closed while reading Apple Health.',
};

const FEATURE_NAME: Readonly<Record<NativeFeature, string>> = { live_activity: 'Live Activity', health: 'Apple Health' };

/**
 * (Ben, 28 Oct) Why an optional native feature is off this run when the build has it: `launch` (a safe start, back on
 * at the next launch) or `build` (it closed the app on this build: the native-off record, back with the next build).
 * Null: not paused (it may still be missing from the install, which reads as that).
 */
export type NativePause = 'launch' | 'build';

export function nativePauseOf(feature: NativeFeature, input: { safe: boolean; offForBuild: ReadonlySet<NativeFeature> }): NativePause | null {
  if (input.offForBuild.has(feature)) return 'build';
  return input.safe ? 'launch' : null;
}

/** What a paused feature reads (values only; the reason behind `Why?`). */
export const NATIVE_PAUSED_COPY: Readonly<Record<NativePause, { line: string; why: string }>> = {
  launch: { line: 'Paused for this launch', why: 'Safe start. On again at the next launch.' },
  build: { line: 'Paused on this build', why: 'It closed the app on this build. On again with the next build.' },
};

export function safeStartView(input: { workoutName: string | null; workoutOpen: boolean; lastError: { name: string; message: string; atUtc: string } | null; previous: LaunchBreadcrumb | null; offForBuild?: ReadonlySet<NativeFeature> }): SafeStartView {
  const lines: string[] = [];
  lines.push(CLOSED_WHERE[input.previous?.phase ?? 'launch']);
  if (input.workoutOpen) lines.push(`${input.workoutName ?? 'Workout'} in progress · kept`);
  const offForBuild = NATIVE_FEATURES.filter((f) => input.offForBuild?.has(f) === true).map((f) => FEATURE_NAME[f]);
  const offForRun = NATIVE_FEATURES.filter((f) => input.offForBuild?.has(f) !== true).map((f) => FEATURE_NAME[f]);
  if (offForBuild.length > 0) lines.push(`${offForBuild.join(' and ')} off on this build.`);
  if (offForRun.length > 0) lines.push(`${offForRun.join(' and ')} off until next launch.`);
  if (input.lastError !== null) lines.push(`Last error: ${input.lastError.name}: ${input.lastError.message}`);
  return { title: 'Safe start', lines, resume: input.workoutOpen };
}

/**
 * Crash capture (How to closing the app, build 83, with no device logs).
 *
 * Pure parts, unit-tested in Node; `crash-capture.ts` binds them to React
 * Native's global error handler and a small file in the app's container.
 *
 * - Every JS error that reaches the global handler, fatal or not, is written
 *   as the "last error" and then passed on to React Native unchanged, so it
 *   survives the app going down. Profile › App status shows it with a way to
 *   copy it.
 * - A feature that catches its own error (the guide player's boundary, a
 *   guarded load) records it with `containedBy` set: the app stayed open.
 * - Animation-thread (worklet) errors never reach the JS handler in a release
 *   build: Worklets 0.10 forwards them only in debug builds (`#ifndef
 *   NDEBUG`), and in release an uncaught one aborts the app natively. They are
 *   recorded only when the worklet catches them itself and reports through
 *   `scheduleOnRN` (ADR 0018). The How to breadcrumb below at least shows that
 *   the app closed while a guide was playing.
 *
 * Privacy: the record holds the error's name, message and stack, the screen
 * (route name only, never its parameters), the time and the build. Nothing
 * from Ben's data is added; a message is truncated, never enriched.
 */

import { toMs } from '@fizz/domain';

export const LAST_ERROR_FILE = 'last-error.json';
export const MAX_MESSAGE_CHARS = 500;
export const MAX_STACK_CHARS = 4000;

export interface ErrorRecord {
  v: 1;
  name: string;
  message: string;
  stack: string | null;
  /** What React Native would have done: true closes the app. */
  fatal: boolean;
  /** The feature that caught it itself (e.g. `guide`, `how-to`): the app stayed open. */
  containedBy: string | null;
  /** Route name when it happened, if known. */
  screen: string | null;
  atUtc: string;
  tz: string | null;
  /** `0.1.0 (83)`, if known. */
  build: string | null;
}

export interface ErrorContext {
  nowUtc: string;
  tz: string | null;
  screen: string | null;
  build: string | null;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Anything thrown, as a record. Non-Error values keep only their type and a short string form. */
export function toErrorRecord(error: unknown, fatal: boolean, containedBy: string | null, ctx: ErrorContext): ErrorRecord {
  let name: string;
  let message: string;
  let stack: string | null = null;
  if (error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)) {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    name = typeof e.name === 'string' && e.name !== '' ? e.name : 'Error';
    message = typeof e.message === 'string' ? e.message : safeString(e.message);
    stack = typeof e.stack === 'string' && e.stack !== '' ? clip(e.stack, MAX_STACK_CHARS) : null;
  } else {
    name = `Thrown ${typeof error}`;
    message = safeString(error);
  }
  return { v: 1, name: clip(name, 100), message: clip(message, MAX_MESSAGE_CHARS), stack, fatal, containedBy, screen: ctx.screen, atUtc: ctx.nowUtc, tz: ctx.tz, build: ctx.build };
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '(unprintable)';
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** The saved record, or null if missing or unreadable (never throws). */
export function parseErrorRecord(text: string | null): ErrorRecord | null {
  if (text === null) return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown> | null;
    if (typeof j !== 'object' || j === null || j.v !== 1 || typeof j.message !== 'string' || typeof j.atUtc !== 'string') return null;
    toMs(j.atUtc); // throws on an unreadable time (App status formats it)
    return {
      v: 1,
      name: str(j.name) ?? 'Error',
      message: j.message,
      stack: str(j.stack),
      fatal: j.fatal === true,
      containedBy: str(j.containedBy),
      screen: str(j.screen),
      atUtc: j.atUtc,
      tz: str(j.tz),
      build: str(j.build),
    };
  } catch {
    return null;
  }
}

/** What happened, in words for App status. */
export function errorOutcome(r: ErrorRecord): string {
  if (r.containedBy === 'guide') return 'The exercise guide stopped; the app stayed open';
  if (r.containedBy !== null) return 'Contained; the app stayed open';
  return r.fatal ? 'The app closed' : 'The app stayed open';
}

/** App status line under the outcome: screen, build, then the error itself. */
export function errorStatusDetail(r: ErrorRecord): string {
  const where = [r.screen === null ? null : `on ${r.screen}`, r.build === null ? null : `build ${r.build}`].filter((x) => x !== null).join(' · ');
  return `${where === '' ? '' : `${where}. `}${r.name}: ${r.message}`;
}

/** Plain text to copy or send to the developer. */
export function formatErrorReport(r: ErrorRecord): string {
  return [
    'GymSmarter last error',
    `When: ${r.atUtc}${r.tz ? ` (${r.tz})` : ''}`,
    `Build: ${r.build ?? 'unknown'}`,
    `Screen: ${r.screen ?? 'unknown'}`,
    `Outcome: ${errorOutcome(r)}${r.fatal ? ' (fatal)' : ''}`,
    `${r.name}: ${r.message}`,
    '',
    r.stack ?? '(no stack)',
  ].join('\n');
}

export type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

export interface HandlerDeps {
  /** React Native's handler from before (shows the red box in dev, closes the app on a fatal in release). */
  previous: GlobalHandler | null;
  context: () => ErrorContext;
  /** Save the record synchronously (the app may be gone right after). Errors are ignored. */
  save: (record: ErrorRecord) => void;
}

/**
 * The app-wide handler: record, then pass on to React Native's own handler
 * unchanged. It never swallows an error: a fatal error elsewhere in the app
 * (a rest alert, a timer, a save) must close the app as React Native
 * decides, not be hidden behind a feature's fallback (review B1).
 */
export function createGlobalErrorHandler(deps: HandlerDeps): GlobalHandler {
  return (error, isFatal) => {
    try {
      deps.save(toErrorRecord(error, isFatal === true, null, deps.context()));
    } catch {
      // Recording is best effort; it must never change what happens next.
    }
    deps.previous?.(error, isFatal);
  };
}

/**
 * "How to was open" breadcrumb (review S1). In a release build an uncaught
 * error on the animation (UI) thread aborts the app natively, so the JS
 * handler above never runs and nothing is recorded. The breadcrumb file is
 * written while the guide player is on screen with the app active, and
 * removed when it unmounts or the app goes to the background. One still
 * there at the next launch means the app closed while How to was open.
 */
export const GUIDE_OPEN_FILE = 'guide-open.json';

export interface GuideBreadcrumb {
  v: 1;
  atUtc: string;
  tz: string | null;
  build: string | null;
}

export function toGuideBreadcrumb(ctx: ErrorContext): GuideBreadcrumb {
  return { v: 1, atUtc: ctx.nowUtc, tz: ctx.tz, build: ctx.build };
}

/** The saved breadcrumb, or null if missing or unreadable (never throws). */
export function parseGuideBreadcrumb(text: string | null): GuideBreadcrumb | null {
  if (text === null) return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown> | null;
    if (typeof j !== 'object' || j === null || j.v !== 1 || typeof j.atUtc !== 'string') return null;
    toMs(j.atUtc);
    return { v: 1, atUtc: j.atUtc, tz: str(j.tz), build: str(j.build) };
  } catch {
    return null;
  }
}

export const GUIDE_CLOSE_NAME = 'Closed during How to';
export const GUIDE_CLOSE_MESSAGE =
  'The app closed while How to was open, and no error reached the app. It was most likely a native or animation-thread crash (or iOS ended the app). Try Profile › Developer › Exercise guide animations off.';

/**
 * At launch, a leftover breadcrumb as a Last error, unless a JS error was
 * recorded at or after it (that error already explains the close).
 */
export function recordFromGuideBreadcrumb(crumb: GuideBreadcrumb | null, last: ErrorRecord | null): ErrorRecord | null {
  if (crumb === null) return null;
  if (last !== null && toMs(last.atUtc) >= toMs(crumb.atUtc)) return null;
  return { v: 1, name: GUIDE_CLOSE_NAME, message: GUIDE_CLOSE_MESSAGE, stack: null, fatal: true, containedBy: null, screen: 'HowTo', atUtc: crumb.atUtc, tz: crumb.tz, build: crumb.build };
}

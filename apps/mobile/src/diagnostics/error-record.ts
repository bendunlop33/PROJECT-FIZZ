/**
 * Crash capture (How to closing the app, build 83, with no device logs).
 *
 * Pure parts, unit-tested in Node; `crash-capture.ts` binds them to React
 * Native's global error handler and a small file in the app's container.
 *
 * - Every JS error that reaches the global handler, fatal or not (including
 *   errors Worklets forwards from the UI thread), is written as the
 *   "last error" before anything else happens, so it survives the app going
 *   down. Profile › App status shows it with a way to copy it.
 * - While a feature that may fail without harm (the How to guide player) has
 *   a containment scope open, an error is reported to that scope and kept
 *   non-fatal: the feature falls back (cues only) instead of the app closing.
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
  /** A containment scope took it (e.g. `guide`): the app stayed open. */
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

/**
 * Open containment scopes. The newest scope takes an error; it is called at
 * most once (it should unmount whatever failed, which closes the scope).
 */
export interface ContainmentScopes {
  /** Open a scope; returns its close function. */
  open: (id: string, onError: (error: unknown) => void) => () => void;
  /** Hand an error to the newest open scope: its id, or null if none is open. */
  take: (error: unknown) => string | null;
  readonly size: number;
}

export function createContainmentScopes(): ContainmentScopes {
  const scopes: { id: string; onError: (error: unknown) => void; told: boolean }[] = [];
  return {
    open(id, onError) {
      const scope = { id, onError, told: false };
      scopes.push(scope);
      return () => {
        const i = scopes.indexOf(scope);
        if (i >= 0) scopes.splice(i, 1);
      };
    },
    take(error) {
      const scope = scopes.at(-1);
      if (scope === undefined) return null;
      if (!scope.told) {
        scope.told = true;
        try {
          scope.onError(error);
        } catch {
          // The fallback itself failing must not turn a contained error into a crash.
        }
      }
      return scope.id;
    },
    get size() {
      return scopes.length;
    },
  };
}

export type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

export interface HandlerDeps {
  /** React Native's handler from before (shows the red box in dev, closes the app on a fatal in release). */
  previous: GlobalHandler | null;
  scopes: ContainmentScopes;
  context: () => ErrorContext;
  /** Save the record synchronously (the app may be gone right after). Errors are ignored. */
  save: (record: ErrorRecord) => void;
}

/**
 * The app-wide handler: record, then either contain (a scope is open) or
 * pass on to React Native's own handler unchanged.
 */
export function createGlobalErrorHandler(deps: HandlerDeps): GlobalHandler {
  return (error, isFatal) => {
    const fatal = isFatal === true;
    let containedBy: string | null;
    try {
      containedBy = deps.scopes.take(error);
    } catch {
      containedBy = null;
    }
    try {
      deps.save(toErrorRecord(error, fatal, containedBy, deps.context()));
    } catch {
      // Recording is best effort; it must never change what happens next.
    }
    if (containedBy !== null) return;
    deps.previous?.(error, isFatal);
  };
}

import type { AlertsAsk } from '../device/prefs';
import type { AlertPermission } from './notifier';

/**
 * Rest alerts permission, asked in context on the first Start (premium-feel
 * §3.5), never on the Rest screen and never in onboarding. Pure.
 */

/** Show the one-time `Rest alerts` sheet before this Start? Once in the app's life, and only while iOS can still ask. */
export function shouldAskOnStart(permission: AlertPermission | 'unknown', ask: AlertsAsk): boolean {
  return permission === 'undetermined' && ask === 'undetermined';
}

/**
 * Rest's honest status: the `bell.slash` glyph shows when alerts won't
 * arrive with the phone locked (denied, or `Not now` and never allowed).
 * Unknown (still reading) shows nothing rather than guessing.
 */
export function alertsOff(permission: AlertPermission | 'unknown', ask: AlertsAsk): boolean {
  if (permission === 'denied') return true;
  return permission === 'undetermined' && ask !== 'undetermined';
}

/** What tapping the glyph does: iOS Settings once denied; otherwise ask iOS now. */
export function alertsOffAction(permission: AlertPermission | 'unknown'): 'open_settings' | 'request' | 'none' {
  if (permission === 'denied') return 'open_settings';
  if (permission === 'undetermined') return 'request';
  return 'none';
}

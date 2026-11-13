import { createRestTimer, expireRestTimerIfDue, restOverrunMs, restRemainingMs } from '@fizz/domain';
import { RestTimerSchema, type RestTimer } from '@fizz/schemas';

/**
 * Persisted rest-deadline probe (pure). The stored value is the deadline, never
 * a JS interval, so remaining time is recomputed from the clock on relaunch
 * (brief §9, rest-state design). Uses the real domain timer functions.
 */

export const PROBE_REST_DURATION_S = 180;

export interface StoredProbeRest {
  /** Random per JS launch; tells "same launch" from "recovered after relaunch". */
  launchId: string;
  /** CFBundleVersion of the build that saved it. Absent in records from older builds. */
  buildNumber?: string;
  timer: RestTimer;
}

export interface ProbeRestIds {
  timerId: string;
  sessionId: string;
  setId: string;
}

export function startProbeRest(
  ids: ProbeRestIds,
  launchId: string,
  buildNumber: string,
  nowMs: number,
  durationS = PROBE_REST_DURATION_S,
): StoredProbeRest {
  const timer = createRestTimer({
    id: ids.timerId,
    sessionId: ids.sessionId,
    setId: ids.setId,
    kind: 'rest',
    durationS,
    source: null,
    nowMs,
  });
  return { launchId, buildNumber, timer };
}

export function serialiseProbeRest(stored: StoredProbeRest): string {
  return JSON.stringify(stored);
}

export type RecoveredProbeRest =
  | { kind: 'none' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'running'; timer: RestTimer; remainingMs: number; fromPreviousLaunch: boolean; savedByBuild: string | null }
  | { kind: 'expired'; timer: RestTimer; overrunMs: number; fromPreviousLaunch: boolean; savedByBuild: string | null };

/** Stored text is untrusted: validate before use (CLAUDE.md rule 8). */
export function recoverProbeRest(stored: string | null, currentLaunchId: string, nowMs: number): RecoveredProbeRest {
  if (stored === null) return { kind: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { kind: 'invalid', reason: 'Stored rest is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'invalid', reason: 'Stored rest is not an object' };
  const launchId: unknown = (parsed as { launchId?: unknown }).launchId;
  if (typeof launchId !== 'string') return { kind: 'invalid', reason: 'Stored rest has no launch ID' };
  const timerResult = RestTimerSchema.safeParse((parsed as { timer?: unknown }).timer);
  if (!timerResult.success) return { kind: 'invalid', reason: 'Stored rest timer failed schema validation' };
  const rawBuild: unknown = (parsed as { buildNumber?: unknown }).buildNumber;
  if (rawBuild !== undefined && typeof rawBuild !== 'string') return { kind: 'invalid', reason: 'Stored rest build number is not text' };
  const savedByBuild = rawBuild ?? null;
  const fromPreviousLaunch = launchId !== currentLaunchId;
  const timer = expireRestTimerIfDue(timerResult.data, nowMs);
  if (timer.status === 'running') {
    return { kind: 'running', timer, remainingMs: restRemainingMs(timer, nowMs), fromPreviousLaunch, savedByBuild };
  }
  return { kind: 'expired', timer, overrunMs: restOverrunMs(timer, nowMs), fromPreviousLaunch, savedByBuild };
}

export function formatMs(ms: number): string {
  const totalS = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface RestProbeVerdict {
  status: 'pass' | 'fail' | 'running' | 'not_run';
  summary: string;
  details: string[];
}

/**
 * Pass only when a timer saved by a previous launch was read back and
 * recomputed. A relaunch can't tell force-close from a normal quit; the
 * detail says so instead of claiming more.
 */
export function describeSavingBuild(savedByBuild: string | null, currentBuild: string): string {
  if (savedByBuild === null) return `Saved by an older build that did not record its number; read by build ${currentBuild}`;
  return savedByBuild === currentBuild
    ? `Saved and read by build ${currentBuild}`
    : `Saved by build ${savedByBuild}, read by build ${currentBuild} (survived an app update)`;
}

export function judgeRecoveredRest(r: RecoveredProbeRest, currentBuild: string): RestProbeVerdict {
  switch (r.kind) {
    case 'none':
      return { status: 'not_run', summary: 'No saved rest', details: [] };
    case 'invalid':
      return { status: 'fail', summary: r.reason, details: [] };
    case 'running': {
      const line = `Deadline ${r.timer.deadlineUtc}; ${formatMs(r.remainingMs)} remaining`;
      return r.fromPreviousLaunch
        ? {
            status: 'pass',
            summary: `Recovered after relaunch: ${formatMs(r.remainingMs)} left`,
            details: [line, describeSavingBuild(r.savedByBuild, currentBuild), 'Read back from SQLite after the app restarted (force-close not distinguishable from a normal quit)'],
          }
        : {
            status: 'running',
            summary: `Saved. ${formatMs(r.remainingMs)} left. Now swipe the app away and reopen it.`,
            details: [line],
          };
    }
    case 'expired': {
      const line = `Deadline ${r.timer.deadlineUtc} passed ${formatMs(r.overrunMs)} ago`;
      return r.fromPreviousLaunch
        ? {
            status: 'pass',
            summary: `Recovered after relaunch: rest ended ${formatMs(r.overrunMs)} ago`,
            details: [line, describeSavingBuild(r.savedByBuild, currentBuild), 'Read back from SQLite after the app restarted (force-close not distinguishable from a normal quit)'],
          }
        : {
            status: 'running',
            summary: 'Rest ended before a relaunch. Run again and reopen the app within 3 minutes.',
            details: [line],
          };
    }
  }
}

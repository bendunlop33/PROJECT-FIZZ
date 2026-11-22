import type { SessionAggregate } from '@fizz/schemas';
import { formatDuration } from '../display';
import { STALE_SESSION_MS } from '../session/recovery';
import { getSessionPhase } from '../session/view';
import { toMs } from '../time';

/**
 * The `ResumeBar` on Progress (progress.md PG5): shown while a workout is
 * unfinished and under 6 h old. One tap resumes it. Pure: the bar's text is
 * recomputed from `resumeBarText` each second while a rest runs.
 */

export interface ResumeBar {
  sessionId: string;
  title: string;
  state: 'rest' | 'working' | 'ready' | 'paused';
  /** Rest or work end (epoch ms) for the countdown; null otherwise. */
  deadlineMs: number | null;
}

export function resumeBar(active: SessionAggregate | null, nowMs: number): ResumeBar | null {
  if (active === null || active.session.status !== 'active') return null;
  if (nowMs - toMs(active.session.lastActivityAtUtc) >= STALE_SESSION_MS) return null;
  const phase = getSessionPhase(active, nowMs);
  const title = active.session.routineName ?? 'Workout';
  const base = { sessionId: active.session.id, title };
  switch (phase.kind) {
    case 'paused':
      return { ...base, state: 'paused', deadlineMs: null };
    case 'resting':
      return { ...base, state: 'rest', deadlineMs: nowMs + phase.remainingMs };
    case 'working':
      return { ...base, state: 'working', deadlineMs: nowMs + phase.remainingMs };
    case 'ready':
    case 'empty':
    case 'all_done':
    case 'finished':
      return { ...base, state: 'ready', deadlineMs: null };
  }
}

/** `Push A · Rest 1:12` · `Push A · Ready` · `Push A · Paused`. */
export function resumeBarText(bar: ResumeBar, nowMs: number): string {
  const left = bar.deadlineMs === null ? 0 : Math.max(0, bar.deadlineMs - nowMs);
  switch (bar.state) {
    case 'paused':
      return `${bar.title} · Paused`;
    case 'rest':
      return left > 0 ? `${bar.title} · Rest ${formatDuration(Math.ceil(left / 1000))}` : `${bar.title} · Ready`;
    case 'working':
      return left > 0 ? `${bar.title} · Set ${formatDuration(Math.ceil(left / 1000))}` : `${bar.title} · Ready`;
    case 'ready':
      return `${bar.title} · Ready`;
  }
}

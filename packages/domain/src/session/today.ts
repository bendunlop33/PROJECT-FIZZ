import type { CheckIn, SessionAggregate } from '@fizz/schemas';
import { reusableCheckIn, type RecentCheckIn } from '../checkin';
import { toIso, toMs } from '../time';
import { buildActiveSetView } from './active-view';
import { STALE_SESSION_MS } from './recovery';
import { dateOnlyOf, workoutDurationMs } from './view';

/**
 * `buildTodayView` (today.md §6) for this build: no weekly plan or routines
 * yet, so the main card is Resume, the stale-workout card, Done today, or
 * `Nothing planned today`. Local and pure; no AI.
 */

/** Forgotten Finish: the end time offered is the last set + 3 min (today.md §4), never in the future. */
export const FORGOTTEN_FINISH_PAD_MS = 3 * 60 * 1000;

export type TodayMain =
  | {
      kind: 'resume';
      sessionId: string;
      title: string;
      startedAtUtc: string;
      now: string | null;
      done: number;
      total: number;
      status: { kind: 'resting'; deadlineUtc: string } | { kind: 'ready' } | { kind: 'paused' } | { kind: 'all_done' } | { kind: 'empty' };
    }
  | {
      kind: 'stale';
      sessionId: string;
      sessionVersion: number;
      title: string;
      startedAtUtc: string;
      done: number;
      total: number;
      lastSetAtUtc: string | null;
      /** `Finish (ended about 19:24)`; null when nothing was logged (`Discard (nothing logged)`). */
      endedAboutUtc: string | null;
    }
  /** `activeMs` is null for a date-only (imported) workout: it has no times, so no duration is shown (review B2). */
  | { kind: 'done_today'; sessionId: string; title: string; activeMs: number | null }
  | { kind: 'no_plan' };

export interface TodayInput {
  nowMs: number;
  active: SessionAggregate | null;
  /** Finished sessions that started this local week (Monday–Sunday). */
  finishedThisWeek: readonly SessionAggregate[];
  /** Local `YYYY-MM-DD` of today and of each finished session, in the phone's zone. */
  todayLocalDate: string;
  localDateOf: (utc: string) => string;
  recentCheckIns: readonly (RecentCheckIn & Pick<CheckIn, 'score' | 'reasons'>)[];
  /** Local `YYYY-MM-DD` of Monday…Sunday this week, for the dot strip (D-Today). */
  weekDates?: readonly string[];
}

/** One day of This week's strip: trained (filled), today (ringed), or neither. Never a plan we don't have. */
export interface WeekDay {
  letter: string;
  localDate: string;
  trained: boolean;
  today: boolean;
}

export interface TodayView {
  main: TodayMain;
  week: { count: number; text: string; days: WeekDay[] };
  unlinkedCheckIn: (RecentCheckIn & Pick<CheckIn, 'score' | 'reasons'>) | null;
}

function lastSetUtc(a: SessionAggregate): string | null {
  return (
    a.sets
      .filter((s) => s.status === 'completed' && s.completedAt)
      .map((s) => s.completedAt?.utc ?? '')
      .sort()
      .at(-1) ?? null
  );
}

export function buildTodayView(input: TodayInput): TodayView {
  const { nowMs, active } = input;
  let main: TodayMain = { kind: 'no_plan' };
  if (active && active.session.status === 'active') {
    const done = active.sets.filter((s) => s.status === 'completed').length;
    const total = active.sets.filter((s) => s.status !== 'deleted').length;
    const stale = nowMs - toMs(active.session.lastActivityAtUtc) >= STALE_SESSION_MS;
    if (stale) {
      const last = lastSetUtc(active);
      main = {
        kind: 'stale',
        sessionId: active.session.id,
        sessionVersion: active.session.version,
        title: active.session.routineName ?? 'Workout',
        startedAtUtc: active.session.startedAt.utc,
        done,
        total,
        lastSetAtUtc: last,
        endedAboutUtc: last === null ? null : toIso(Math.min(nowMs, toMs(last) + FORGOTTEN_FINISH_PAD_MS)),
      };
    } else {
      const v = buildActiveSetView({ aggregate: active, nowMs, gymName: null, previous: {}, painFlagged: new Set(), edits: null });
      const status: Extract<TodayMain, { kind: 'resume' }>['status'] =
        v.phase === 'resting' && v.rest?.kind === 'running'
          ? { kind: 'resting', deadlineUtc: v.rest.deadlineUtc }
          : v.phase === 'paused'
            ? { kind: 'paused' }
            : v.phase === 'all_done'
              ? { kind: 'all_done' }
              : v.phase === 'empty'
                ? { kind: 'empty' }
                : { kind: 'ready' };
      main = {
        kind: 'resume',
        sessionId: active.session.id,
        title: v.title,
        startedAtUtc: active.session.startedAt.utc,
        now: v.focus ? `${v.focus.exerciseName} · set ${String(v.focus.setNumber)} of ${String(v.focus.setCount)}` : null,
        done,
        total,
        status,
      };
    }
  } else {
    // A date-only workout is on its own calendar date, whatever zone the phone is in now (review N3).
    const today = [...input.finishedThisWeek]
      .filter((a) => (dateOnlyOf(a.session) ?? input.localDateOf(a.session.startedAt.utc)) === input.todayLocalDate)
      .sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc))[0];
    if (today) main = { kind: 'done_today', sessionId: today.session.id, title: today.session.routineName ?? 'Workout', activeMs: workoutDurationMs(today, nowMs) };
  }

  const count = input.finishedThisWeek.length;
  const text = count === 0 ? 'No workouts logged yet this week.' : count === 1 ? '1 workout this week' : `${String(count)} workouts this week`;
  const trainedDates = new Set(input.finishedThisWeek.map((a) => dateOnlyOf(a.session) ?? input.localDateOf(a.session.startedAt.utc)));
  const days = (input.weekDates ?? []).map((d, i) => ({ letter: 'MTWTFSS'[i] ?? '', localDate: d, trained: trainedDates.has(d), today: d === input.todayLocalDate }));
  return { main, week: { count, text, days }, unlinkedCheckIn: reusableCheckIn(input.recentCheckIns, nowMs) };
}

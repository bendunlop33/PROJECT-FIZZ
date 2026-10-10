import type { CheckIn, PainFlag, SessionAggregate } from '@fizz/schemas';
import { reusableCheckIn, type RecentCheckIn } from '../checkin';
import { todayPainCheck, type TodayPainCheck } from '../pain-flags';
import { toIso, toMs } from '../time';
import { buildActiveSetView } from './active-view';
import { GENERIC_WORKOUT_NAME, storedWorkoutName } from './first-run';
import type { PaceSamples } from './time-left';
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
      /** This workout's exercises with progress (premium-feel §2.3), in workout order. */
      rows: ResumeRow[];
      /** `About 35 min left · ends about 19:40` (active-workout §2.15.1); null when hidden. */
      timeLeft: string | null;
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

/**
 * One Resume row: `✓ Back squat  3 of 3 sets`. Status is said in words too
 * (`text`), never by the icon alone. `firstPendingSetId` is where a tap
 * resumes (null when nothing is left to log).
 */
export interface ResumeRow {
  sessionExerciseId: string;
  name: string;
  status: 'done' | 'now' | 'pending' | 'skipped';
  done: number;
  total: number;
  text: string;
  firstPendingSetId: string | null;
}

/** Resume rows from the active workout and its current exercise. Pure. */
export function resumeRows(active: SessionAggregate, currentExerciseId: string | null): ResumeRow[] {
  return [...active.exercises]
    .sort((a, b) => a.order - b.order)
    .map((e) => {
      const sets = active.sets.filter((s) => s.sessionExerciseId === e.id && s.status !== 'deleted').sort((a, b) => a.index - b.index);
      const done = sets.filter((s) => s.status === 'completed').length;
      const pending = sets.filter((s) => s.status === 'pending');
      const skipped = sets.filter((s) => s.status === 'skipped').length;
      const status: ResumeRow['status'] =
        e.id === currentExerciseId && pending.length > 0 ? 'now' : pending.length > 0 ? 'pending' : done === 0 && skipped > 0 ? 'skipped' : done > 0 ? 'done' : 'pending';
      const total = sets.length - skipped;
      return {
        sessionExerciseId: e.id,
        name: e.exerciseName,
        status,
        done,
        total,
        text: status === 'skipped' ? 'Skipped' : `${String(done)} of ${String(total)} ${total === 1 ? 'set' : 'sets'}`,
        firstPendingSetId: pending[0]?.id ?? null,
      };
    });
}

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
  /** Derived names (`Push`) by session ID, for workouts without a stored name (audit F5). */
  titles?: Readonly<Record<string, string>>;
  /** Ben's active pain flags and the phone's zone, for the `Still hurts?` row (region 4b). */
  painFlags?: readonly PainFlag[];
  tz?: string;
  /** Pace samples from Ben's last finished workouts, as the workout screen uses (§2.15.2). */
  recentPace?: PaceSamples;
}

/**
 * One day of This week's strip: trained (filled), in progress (ring with a
 * centre), today (ringed), or neither. Never a plan we don't have.
 * A day can be both trained and in progress (premium-feel.md §2.5).
 */
export interface WeekDay {
  letter: string;
  localDate: string;
  trained: boolean;
  inProgress: boolean;
  today: boolean;
}

/**
 * This week's line (premium-feel.md §2.5). An active workout is never "none":
 * the bug Ben saw on device was a workout in progress reading as no workouts.
 */
export function weekText(finishedCount: number, activeTitle: string | null): string {
  if (activeTitle !== null) {
    return finishedCount === 0 ? `${activeTitle} in progress` : `${String(finishedCount)} done · ${activeTitle} in progress`;
  }
  if (finishedCount === 0) return 'No workouts yet this week.';
  return finishedCount === 1 ? '1 workout this week' : `${String(finishedCount)} workouts this week`;
}

/** VoiceOver label for the strip: `This week: 2 days trained, today in progress`. */
export function weekStripLabel(days: readonly WeekDay[]): string {
  const trained = days.filter((d) => d.trained).length;
  const parts = [trained === 1 ? '1 day trained' : `${String(trained)} days trained`];
  const live = days.find((d) => d.inProgress);
  if (live) parts.push(live.today ? 'today in progress' : 'a workout in progress');
  return `This week: ${parts.join(', ')}`;
}

export interface TodayView {
  main: TodayMain;
  week: { count: number; text: string; days: WeekDay[] };
  unlinkedCheckIn: (RecentCheckIn & Pick<CheckIn, 'score' | 'reasons'>) | null;
  /**
   * Region 4b (rare): one quiet row while a pain flag's two-weekly check is
   * due. Null while a workout is in progress (Resume or stale): the workout
   * asks in place. Never a banner or a notification, and never clears a flag.
   */
  painCheck: TodayPainCheck | null;
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
  const titleOf = (a: SessionAggregate): string => storedWorkoutName(a.session) ?? input.titles?.[a.session.id] ?? GENERIC_WORKOUT_NAME;
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
        title: titleOf(active),
        startedAtUtc: active.session.startedAt.utc,
        done,
        total,
        lastSetAtUtc: last,
        endedAboutUtc: last === null ? null : toIso(Math.min(nowMs, toMs(last) + FORGOTTEN_FINISH_PAD_MS)),
      };
    } else {
      const v = buildActiveSetView({ aggregate: active, nowMs, gymName: null, previous: {}, painFlagged: new Set(), edits: null, title: titleOf(active), ...(input.recentPace ? { recentPace: input.recentPace } : {}) });
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
        rows: resumeRows(active, v.focus?.sessionExerciseId ?? null),
        timeLeft: v.timeLeft?.line.text ?? null,
      };
    }
  } else {
    // A date-only workout is on its own calendar date, whatever zone the phone is in now (review N3).
    const today = [...input.finishedThisWeek]
      .filter((a) => (dateOnlyOf(a.session) ?? input.localDateOf(a.session.startedAt.utc)) === input.todayLocalDate)
      .sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc))[0];
    if (today) main = { kind: 'done_today', sessionId: today.session.id, title: titleOf(today), activeMs: workoutDurationMs(today, nowMs) };
  }

  const count = input.finishedThisWeek.length;
  // A forgotten workout from an earlier week isn't "in progress" this week (review S8); one Ben can resume always is.
  const open = active && active.session.status === 'active' ? active : null;
  const openDate = open ? input.localDateOf(open.session.startedAt.utc) : null;
  const live = open !== null && (main.kind === 'resume' || (openDate !== null && (input.weekDates ?? []).includes(openDate))) ? open : null;
  const activeLocalDate = live ? openDate : null;
  const text = weekText(count, live ? titleOf(live) : null);
  const trainedDates = new Set(input.finishedThisWeek.map((a) => dateOnlyOf(a.session) ?? input.localDateOf(a.session.startedAt.utc)));
  const days = (input.weekDates ?? []).map((d, i) => ({
    letter: 'MTWTFSS'[i] ?? '',
    localDate: d,
    trained: trainedDates.has(d),
    inProgress: d === activeLocalDate,
    today: d === input.todayLocalDate,
  }));
  const inWorkout = main.kind === 'resume' || main.kind === 'stale';
  const painCheck = inWorkout || input.tz === undefined ? null : todayPainCheck(input.painFlags ?? [], nowMs, input.tz);
  return { main, week: { count, text, days }, unlinkedCheckIn: reusableCheckIn(input.recentCheckIns, nowMs), painCheck };
}

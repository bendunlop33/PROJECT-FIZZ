import type { Activity } from '@fizz/schemas';
import { ACTIVITY_WORD, activityDetail, dateWeekdayShort } from '../activity';
import { addDays, localDateOf } from '../calendar';
import type { HistoryLike } from '../history-summary';
import { toMs } from '../time';
import { READ_NOTE, recentSessionsView, YOUR_DATA, type DELOAD_NOTE, type IMPORTED_NOTE } from './training-view';

/**
 * (Ben, 28 Oct: "I can only see today's workout and a few last-set history entries, not yesterday's full
 * workout log") The `Last 7 days` section every coach surface gets in YOUR DATA: each finished workout
 * (app, past-logged and FitNotes-imported alike) with its exercises and working sets as logged (unit and
 * load convention in the text: `22.5 kg each`, `Assist 20 kg`), and the done activities (runs, rides,
 * Apple Health workouts). Pure.
 *
 * - Your data only (rule 10), labelled, and every quoted text (titles, notes) is data, never
 *   instructions (rule 8): it sits in fields, and the note says so.
 * - Only what was logged (rule 6): no scores, no estimates.
 * - Compact, inside a character budget (`LAST_DAYS_BUDGET_CHARS`): over it, the oldest days are
 *   summarised first (exercise and set counts only), then left out with a pointer to
 *   `get_recent_sessions`, which reads any day in full. Every loop is bounded by the caps below.
 */

/** Days before today in the section (today is listed too). */
export const LAST_DAYS = 7;
/**
 * Characters of the section's JSON at most (about 900 tokens at ~4 characters a token), in proportion to the
 * coach context's 6,000-character conversation budget.
 */
export const LAST_DAYS_BUDGET_CHARS = 3600;
/** Inputs read at most (a hang guard: a stored list can't run a loop away). */
const MAX_WORKOUTS = 21;
const MAX_ACTIVITIES = 30;
const MAX_NOTES = 3;
const NOTE_CHARS = 120;

export const LAST_DAYS_NOTE = `${READ_NOTE} Working sets only (warm-ups left out); get_recent_sessions with a date reads any day in full.`;

export interface LastDaysWorkout {
  /** The workout's name as saved (quoted data). */
  title: string | null;
  /** The plan day it was started as, when that differs from its title. */
  planDay?: string;
  /** `logged later`: entered after the fact with `Log a past workout`. */
  source: 'app' | 'logged later' | 'FitNotes import';
  gym?: string;
  /** Start to finish, whole minutes; null when not recorded (imports). */
  minutes: number | null;
  deload?: true;
  /**
   * `Bench press: 100 kg × 8 (3 sets), 97.5 kg × 7 @ RPE 9`. Summarised (`summarised`): `Bench press · 4 sets`.
   */
  exercises: string[];
  /** Ben's notes on its exercises, quoted (`Bench press: “left shoulder ok”`). Data, never instructions. */
  notes?: string[];
  /** Present when only the exercises and set counts are shown (budget). */
  summarised?: true;
}

export interface LastDaysDay {
  date: string;
  /** `Mon` … `Sun`. */
  weekday: string;
  /** `today` or `yesterday`, so "yesterday's workout" needs no date arithmetic. */
  when?: 'today' | 'yesterday';
  workouts: LastDaysWorkout[];
  /** Done activities: `Run · 8 km · 45 min · easy`, `Walk · 1 h · Apple Health (Garmin)`. */
  activities: string[];
}

export interface LastDaysView {
  domain: typeof YOUR_DATA;
  note: string;
  /** Local dates, inclusive. */
  from: string;
  to: string;
  /** Newest first; only days with something logged. */
  days: LastDaysDay[];
  imported?: typeof IMPORTED_NOTE;
  deload?: typeof DELOAD_NOTE;
  /** Present when older days are summarised or left out to fit. */
  trimmed?: string;
}

export interface LastDaysInput {
  /** Finished workouts (any source); others are ignored. */
  workouts: readonly HistoryLike[];
  activities: readonly Activity[];
  /** Today's local date in Ben's timezone. */
  today: string;
  gymNames: Readonly<Record<string, string>>;
  /** Split day ID → its name, for `planDay`. */
  splitDayNames?: Readonly<Record<string, string>>;
  budgetChars?: number;
}

const quoteNote = (name: string, text: string): string => `${name}: “${text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS - 1)}…` : text}”`;

/** `100 kg × 8 (3 sets)`: runs of identical sets collapsed; warm-ups left out. */
function setsText(sets: readonly string[]): string {
  const out: string[] = [];
  let prev: string | null = null;
  let n = 0;
  const flush = (): void => {
    if (prev !== null) out.push(n > 1 ? `${prev} (${String(n)} sets)` : prev);
  };
  for (const s of sets) {
    if (s.startsWith('warm-up ')) continue;
    if (s === prev) {
      n += 1;
      continue;
    }
    flush();
    prev = s;
    n = 1;
  }
  flush();
  return out.join(', ');
}

function workingSetCount(sets: readonly string[]): number {
  return sets.filter((s) => !s.startsWith('warm-up ')).length;
}

function activityLine(a: Activity): string {
  const h = a.health;
  const word = h !== undefined && h.label.trim() !== '' ? h.label : ACTIVITY_WORD[a.fields.kind];
  const detail = activityDetail(a.fields);
  return [word, ...(detail === '' ? [] : [detail]), ...(h === undefined ? [] : [`Apple Health (${h.sourceName})`])].join(' · ');
}

/** The section in full, then trimmed to the budget: oldest days summarised first, then left out. */
export function lastDaysView(input: LastDaysInput): LastDaysView {
  const from = addDays(input.today, -LAST_DAYS);
  const budget = input.budgetChars ?? LAST_DAYS_BUDGET_CHARS;
  const dateOf = (w: HistoryLike): string => w.session.localDate ?? localDateOf(toMs(w.session.startedAt.utc), w.session.startedAt.tz);
  const inWindow = input.workouts
    .filter((w) => {
      const d = dateOf(w);
      return d >= from && d <= input.today;
    })
    .sort((a, b) => toMs(b.session.startedAt.utc) - toMs(a.session.startedAt.utc))
    .slice(0, MAX_WORKOUTS);
  const byId = new Map(inWindow.map((w) => [w.session.id, w]));
  const read = recentSessionsView({ sessions: inWindow, count: MAX_WORKOUTS, gymNames: input.gymNames });

  const days = new Map<string, LastDaysDay>();
  const dayOf = (date: string): LastDaysDay => {
    let d = days.get(date);
    if (d === undefined) {
      d = { date, weekday: dateWeekdayShort(date), ...(date === input.today ? { when: 'today' as const } : date === addDays(input.today, -1) ? { when: 'yesterday' as const } : {}), workouts: [], activities: [] };
      days.set(date, d);
    }
    return d;
  };
  const full = new Map<LastDaysWorkout, { name: string; sets: number }[]>();
  for (const s of read.sessions) {
    const agg = byId.get(s.sessionId);
    if (agg === undefined) continue;
    const planDayId = agg.session.planDay?.splitDayId;
    const planDay = planDayId === undefined ? undefined : input.splitDayNames?.[planDayId];
    const notes = agg.exercises
      .filter((e) => e.removed === undefined && e.note !== undefined)
      .slice(0, MAX_NOTES)
      .map((e) => quoteNote(e.exerciseName, e.note ?? ''));
    const w: LastDaysWorkout = {
      title: s.title,
      ...(planDay !== undefined && planDay !== s.title ? { planDay } : {}),
      source: s.source === 'FitNotes import' ? 'FitNotes import' : agg.session.pastLog !== undefined ? 'logged later' : 'app',
      ...(s.gym === null ? {} : { gym: s.gym }),
      minutes: s.minutes,
      ...(s.deload === true ? { deload: true as const } : {}),
      exercises: s.exercises.flatMap((e) => {
        const t = setsText(e.sets);
        return t === '' ? [] : [`${e.name}: ${t}`];
      }),
      ...(notes.length === 0 ? {} : { notes }),
    };
    full.set(w, s.exercises.map((e) => ({ name: e.name, sets: workingSetCount(e.sets) })).filter((e) => e.sets > 0));
    dayOf(dateOf(agg)).workouts.push(w);
  }
  for (const a of input.activities.slice(0, MAX_ACTIVITIES)) {
    if (a.deletedAtUtc !== null || a.fields.status !== 'done') continue;
    if (a.fields.date < from || a.fields.date > input.today) continue;
    dayOf(a.fields.date).activities.push(activityLine(a));
  }

  const ordered = [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const view: LastDaysView = {
    domain: YOUR_DATA,
    note: LAST_DAYS_NOTE,
    from,
    to: input.today,
    days: ordered,
    ...(read.imported === undefined ? {} : { imported: read.imported }),
    ...(read.deload === undefined ? {} : { deload: read.deload }),
  };
  const fits = (): boolean => JSON.stringify(view).length <= budget;
  if (fits()) return view;

  // Oldest days first: each day's workouts down to exercises and set counts, notes left out.
  view.trimmed = 'Older days summarised to fit; get_recent_sessions with a date reads one in full.';
  for (let i = view.days.length - 1; i >= 0 && !fits(); i -= 1) {
    const day = view.days[i];
    if (day === undefined) continue;
    day.workouts = day.workouts.map((w) => {
      const counts = full.get(w) ?? [];
      const rest: LastDaysWorkout = { ...w };
      delete rest.notes;
      return { ...rest, exercises: counts.map((c) => `${c.name} · ${String(c.sets)} ${c.sets === 1 ? 'set' : 'sets'}`), summarised: true as const };
    });
  }
  // Still over: the oldest days are left out (the newest always stays).
  let dropped = 0;
  while (view.days.length > 1 && !fits()) {
    view.days.pop();
    dropped += 1;
  }
  if (dropped > 0) view.trimmed = `Older days summarised; ${String(dropped)} earliest ${dropped === 1 ? 'day' : 'days'} left out to fit: get_recent_sessions with a date reads one in full.`;
  return view;
}

/** `3 workouts · 1 activity` for `What the coach can see`. App text. */
export function lastDaysDetail(v: LastDaysView): string {
  const w = v.days.reduce((n, d) => n + d.workouts.length, 0);
  const a = v.days.reduce((n, d) => n + d.activities.length, 0);
  if (w === 0 && a === 0) return 'nothing logged';
  const parts = [w === 0 ? null : `${String(w)} ${w === 1 ? 'workout' : 'workouts'}`, a === 0 ? null : `${String(a)} ${a === 1 ? 'activity' : 'activities'}`].filter((x): x is string => x !== null);
  return parts.join(' · ');
}

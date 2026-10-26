import type { WeightUnit } from '@fizz/schemas';

import { addDays, addMonths } from '../calendar';
import { formatMinutes, formatNumber, NBSP } from '../display';
import { countSessions, timeInGym } from './activity';
import { collectExerciseSeries, sessionTopSet, type ExerciseSeries } from './exercise';
import { seriesUnitText, shortDate, longDate } from './exercise-view';
import { muscleFrequency, type MuscleInfo } from './muscles';
import type { ProgressSession } from './projection';
import { recordsInWindow } from './records';
import { countNoun, gymTimeWords, monthName, setsText } from './text';
import { inRange, type ProgressWindow } from './window';

/**
 * The monthly recap (Ben approved 26 Oct; progress-goals "Later: monthly recap card", competitor pass 4 #9):
 * facts only, for the month just ended, against the month before. Workouts, time, working sets per muscle,
 * the records set that month, the tracked lifts' heaviest top set against the month before, and (with a plan)
 * the weeks at his aim. No score, nothing invented, nothing estimated: every number is counted from finished
 * workouts (the stored history summaries), and an estimate never appears. Pure.
 *
 * The card shows on Progress for the first `MONTHLY_RECAP.showDays` days of a month, for the month before,
 * when that month had a workout and Ben hasn't dismissed it (Your data, `profile.progress.recapDismissed`).
 */

export const MONTHLY_RECAP = {
  /** The card shows on the 1st to the 7th. */
  showDays: 7,
  /** Tracked lifts listed (those trained that month). */
  lifts: 3,
} as const;

export interface RecapStatRow {
  label: string;
  value: string;
  previous: string;
  words: string;
}

export interface RecapMuscleRow {
  key: string;
  label: string;
  value: string;
  previous: string;
  words: string;
}

export interface RecapRecordRow {
  key: string;
  sessionId: string;
  exercise: string;
  text: string;
  date: string;
  words: string;
}

export interface RecapLiftRow {
  exerciseId: string;
  name: string;
  /** `97.5 × 5 → 100 × 5` (the month before's heaviest top set, then this month's); `100 × 5` with none before. */
  text: string;
  /** `kg`, `kg each`, `kg stack`. */
  unit: string;
  /** The workout this month's top set was done in: a tap opens it. */
  sessionId: string;
  words: string;
}

export interface MonthlyRecapView {
  /** `YYYY-MM`. */
  month: string;
  /** `October`. */
  title: string;
  /** `September`: the month compared with. */
  previousTitle: string;
  /** The card's one line: `12 workouts · 9 h 40 min · 3 records`. */
  line: string;
  accessibilityLabel: string;
  stats: RecapStatRow[];
  /** `9 of 12 timed`: time covers only timed workouts (imports have none); null when every workout counts. */
  timeNote: string | null;
  /** Working sets per body part, either month above 0, largest this month first. */
  muscles: RecapMuscleRow[];
  /** Records set that month (actual sets, never an estimate), newest first. */
  records: RecapRecordRow[];
  lifts: RecapLiftRow[];
  /** `3 of 4` weeks at his aim, with a plan in use; null otherwise. */
  plan: { text: string; words: string } | null;
}

export interface MonthlyRecapInput {
  sessions: readonly ProgressSession[];
  exercises: ReadonlyMap<string, MuscleInfo>;
  /** Today, local. */
  today: string;
  /** The month to recap (`YYYY-MM`); default the one before today's. */
  month?: string;
  /** Tracked lift IDs in order (Overview's and Lifts' list). */
  lifts: readonly string[];
  unit: WeightUnit | null;
  /** With a plan in use: each week (Monday) and whether it reached his aim (consistency); null: no plan or no aim. */
  planWeeks: readonly { monday: string; atAim: boolean | null }[] | null;
  nameOf?: (exerciseId: string) => string | null;
}

/** The month before `today`'s, `YYYY-MM`. */
export function recapMonthOf(today: string): string {
  return addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
}

function monthWindow(month: string): ProgressWindow {
  const from = `${month}-01`;
  const to = addDays(addMonths(from, 1), -1);
  const prevFrom = addMonths(from, -1);
  const prevTo = addDays(from, -1);
  return { from, to, days: Number(to.slice(8, 10)), preset: null, previous: { from: prevFrom, to: prevTo } };
}

/** Whether the card shows today: the first days of a month, for a month with a workout, not dismissed. */
export function recapCardShown(input: { today: string; dismissed: string | null; recap: MonthlyRecapView | null }): boolean {
  if (input.recap === null) return false;
  if (Number(input.today.slice(8, 10)) > MONTHLY_RECAP.showDays) return false;
  return input.dismissed !== input.recap.month;
}

type TopSet = { load: number; reps: number; sessionId: string };

function bestTop(series: ExerciseSeries, from: string, to: string): TopSet | null {
  const lowerWins = series.kind === 'assisted';
  let best: TopSet | null = null;
  for (const ss of series.sessions) {
    if (ss.date < from || ss.date > to) continue;
    const t = sessionTopSet(ss, series)?.fromSet ?? null;
    if (t === null || t.load === null || t.reps === null) continue;
    const v = t.load.value;
    if (best === null || (v !== best.load ? (lowerWins ? v < best.load : v > best.load) : t.reps > best.reps)) best = { load: v, reps: t.reps, sessionId: ss.sessionId };
  }
  return best;
}

const setText = (t: TopSet): string => `${formatNumber(t.load)}${NBSP}×${NBSP}${String(t.reps)}`;

/** The recap of one month; null when it had no finished workout. */
export function buildMonthlyRecap(input: MonthlyRecapInput): MonthlyRecapView | null {
  const month = input.month ?? recapMonthOf(input.today);
  const w = monthWindow(month);
  const counts = countSessions(input.sessions, w);
  if (counts.count === 0) return null;
  const title = monthName(month);
  const previousTitle = monthName(w.previous.from.slice(0, 7));
  const time = timeInGym(input.sessions, w);

  const stats: RecapStatRow[] = [
    { label: 'Workouts', value: String(counts.count), previous: String(counts.previousCount), words: `Workouts: ${String(counts.count)}; ${previousTitle} ${String(counts.previousCount)}.` },
    {
      label: 'Time',
      value: time.timedCount === 0 ? '—' : formatMinutes(time.totalMs),
      previous: time.previousTimedCount === 0 ? '—' : formatMinutes(time.previousTotalMs),
      words: `Time: ${time.timedCount === 0 ? 'none timed' : gymTimeWords(time.totalMs)}; ${previousTitle} ${time.previousTimedCount === 0 ? 'none timed' : gymTimeWords(time.previousTotalMs)}.`,
    },
  ];
  const timeNote = time.timedCount > 0 && time.timedCount < time.sessionCount ? `${String(time.timedCount)} of ${String(time.sessionCount)} timed` : null;

  // Working sets per body part (the Training tab's count), this month and the one before.
  const now = muscleFrequency(input.sessions, input.exercises, w, 'body_part');
  const before = muscleFrequency(input.sessions, input.exercises, { ...w, from: w.previous.from, to: w.previous.to, days: Number(w.previous.to.slice(8, 10)) }, 'body_part');
  const prevOf = new Map(before.rows.map((r) => [r.key, r.sets]));
  const muscles: RecapMuscleRow[] = now.rows
    .map((r) => ({ r, prev: prevOf.get(r.key) ?? 0 }))
    .filter(({ r, prev }) => r.sets > 0 || prev > 0)
    .sort((a, b) => b.r.sets - a.r.sets || b.prev - a.prev)
    .map(({ r, prev }) => ({ key: r.key, label: r.label, value: setsText(r.sets), previous: setsText(prev), words: `${r.label}: ${setsText(r.sets)} sets; ${previousTitle} ${setsText(prev)}.` }));

  // Records set that month: actual sets only (no `Best Est. 1RM`).
  const rec = recordsInWindow(input.sessions, w, { limit: Number.POSITIVE_INFINITY, estimates: false });
  const records: RecapRecordRow[] = rec.items.map((r) => ({
    key: `${r.sessionExerciseId}:${r.kind}`,
    sessionId: r.sessionId,
    exercise: r.exerciseName,
    text: r.kind === 'heaviest' ? r.value : `${r.label} · ${r.value}`,
    date: shortDate(r.date, input.today),
    words: `${r.exerciseName}, ${r.label.toLowerCase()}, ${r.value.replace(/\u00a0/g, ' ').replace(' × ', ' by ')}, ${longDate(r.date, input.today)}. Opens the workout.`,
  }));

  // The tracked lifts trained that month: heaviest top set against the month before (same series, his unit).
  const lifts: RecapLiftRow[] = [];
  for (const id of input.lifts) {
    if (lifts.length >= MONTHLY_RECAP.lifts) break;
    const all = collectExerciseSeries(input.sessions, id, { unit: input.unit }).filter((s) => s.kind === 'load' || s.kind === 'assisted' || s.kind === 'added_bodyweight');
    const series = [...all].sort((a, b) => b.sessions.filter((x) => inRange(x.date, w)).length - a.sessions.filter((x) => inRange(x.date, w)).length)[0];
    if (series === undefined) continue;
    const top = bestTop(series, w.from, w.to);
    if (top === null) continue;
    const prev = bestTop(series, w.previous.from, w.previous.to);
    const name = input.nameOf?.(id) ?? series.exerciseName;
    const unit = seriesUnitText(series);
    lifts.push({
      exerciseId: id,
      name,
      text: prev === null ? setText(top) : `${setText(prev)} → ${setText(top)}`,
      unit,
      sessionId: top.sessionId,
      words: `${name}: heaviest top set ${formatNumber(top.load)} ${unit} for ${countNoun(top.reps, 'rep', 'reps')}${prev === null ? `; none in ${previousTitle}` : `; ${previousTitle} ${formatNumber(prev.load)} for ${String(prev.reps)}`}. Opens the workout.`,
    });
  }

  // With a plan: the weeks (starting that month) at his days-a-week aim.
  let plan: MonthlyRecapView['plan'] = null;
  const weeks = (input.planWeeks ?? []).filter((x) => x.monday.slice(0, 7) === month && x.atAim !== null);
  if (input.planWeeks !== null && weeks.length > 0) {
    const at = weeks.filter((x) => x.atAim === true).length;
    plan = { text: `${String(at)} of ${String(weeks.length)}`, words: `Weeks at your aim: ${String(at)} of ${String(weeks.length)}.` };
  }

  const line = [countNoun(counts.count, 'workout', 'workouts'), time.timedCount === 0 ? null : formatMinutes(time.totalMs), records.length === 0 ? null : countNoun(records.length, 'record', 'records')].filter((x): x is string => x !== null).join(' · ');
  return {
    month,
    title,
    previousTitle,
    line,
    accessibilityLabel: `${title} recap: ${line.replace(/\u00a0/g, ' ')}. Opens the recap.`,
    stats,
    timeNote,
    muscles,
    records,
    lifts,
    plan,
  };
}

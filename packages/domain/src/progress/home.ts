import type { ProgressGrouping, ProgressPeriodKey } from '@fizz/schemas';
import { formatNumber } from '../display';
import { EXCLUSION_WORD } from '../exclusions';
import { deriveWorkoutTitle } from '../session/first-run';
import { countAxisTicks, countSessions, timeInGym, type LeftOutSession } from './activity';
import { muscleFrequency, type MuscleInfo } from './muscles';
import type { ProgressSession } from './projection';
import { recordsInWindow, type ProgressRecord } from './records';
import {
  dayMonth,
  dayMonthLong,
  gymTimeText,
  gymTimeWords,
  massWords,
  perWeekText,
  countNoun,
  rangeText,
  rangeWords,
  setsText,
  setsWords,
  monthBarLabel,
  pointDatesText,
  monthBarsWords,
  weekBarListText,
  weekBarsWords,
  weekdayDayMonth,
} from './text';
import { customProgressWindow, periodProgressWindow, progressPeriodLabel, progressPeriodPhrase, type DateRange, type ProgressWindow } from './window';

/**
 * The Progress home view model (progress.md §2.2–§2.4, §3.1, §5): every
 * number and word the screens show, from the finished workouts and the
 * exercise table. Pure; the screens only lay it out. Nothing here needs a
 * network or the coach.
 */

export interface ProgressHomeInput {
  /** Every finished workout (logged and imported), any order. */
  sessions: readonly ProgressSession[];
  exercises: ReadonlyMap<string, MuscleInfo>;
  /** Today's local date in the owner's zone. */
  today: string;
  period: ProgressPeriodKey;
  /** A custom period (`normaliseProgressRange`); when set it replaces `period`. */
  range?: DateRange | null;
  grouping: ProgressGrouping;
  gymNames?: Readonly<Record<string, string>>;
  /** At most this many records in `items` (default: all of them). */
  recordLimit?: number;
}

export interface StatView {
  value: string;
  label: string;
  /** F17: `1 of 3 timed` under TIME when only some sessions have a time (imports have none). */
  note?: string;
}

export interface ActivityPointView {
  from: string;
  to: string;
  /** X label: `14 Sep` (week start inside the window), `Sep` or `Sep 25` (month). */
  label: string;
  count: number;
  /** The window cut this week or month. */
  partial: boolean;
  /** AX list row (`Week from 14 Sep · 2`, `Sep 2025 · 12`). */
  listText: string;
  /** Shown when the point is tapped: `14–20 Sep · 2 sessions`. */
  valueText: string;
}

/** Activity over time (Ben, 13 Oct 2026): a line, one point a week (up to 6 months) or a month. */
export interface ActivityChartView {
  unit: 'week' | 'month';
  points: ActivityPointView[];
  /** Y gridlines, 0 first; the last is the plot's top. */
  yTicks: number[];
  words: string;
}

export interface TimeSheetRow {
  sessionId: string;
  version: number;
  /** `Fri 2 Oct · Push A · 5 h 12 min`. */
  text: string;
  title: string;
  durationMs: number | null;
}

export interface ActivityView {
  stats: StatView[];
  statsWords: string;
  chart: ActivityChartView;
  /** `Previous 30 days: 7 sessions · 6 h 50 min` · `Previous 30 days: none`. */
  comparison: string;
  /** `Last workout: Fri 14 Aug` when the window is empty; null otherwise. */
  lastWorkout: string | null;
  /** `Time from 7 of 9 sessions` · `No times for imported workouts`; null when nothing was left out. */
  footnote: string | null;
  cardWords: string;
  sheet: {
    countLine: string;
    overCap: TimeSheetRow[];
    noEnd: TimeSheetRow[];
    /** `1 imported from FitNotes`; null when none. */
    imported: string | null;
  };
}

export interface ContributorLine {
  exerciseId: string;
  text: string;
}

export interface FrequencyRowView {
  key: string;
  label: string;
  sessions: number;
  sets: number;
  setsText: string;
  perWeek: string | null;
  /** 0–1 of the largest row's sets in this view. */
  fraction: number;
  zero: boolean;
  words: string;
  /** `Last trained 8 Oct` · `Not trained yet`. */
  lastTrained: string;
  contributors: ContributorLine[];
  /** D2: shown under the row when it is tapped open. */
  subRows: FrequencySubRowView[];
}

export interface FrequencySubRowView {
  key: string;
  label: string;
  /** Empty for exercise sub-rows (Push/Pull/Legs). */
  sessionsText: string;
  setsText: string;
  words: string;
}

export interface MusclesView {
  grouping: ProgressGrouping;
  rows: FrequencyRowView[];
  /** All rows are zero because no counted set has muscles (rows hidden). */
  noneSet: boolean;
  /** `2 exercises have no muscles set`; null when every exercise has them. */
  noMusclesLine: string | null;
  notCounted: {
    /** `22 warm-up sets · 2 rated under RPE 6`; null when nothing was left out. */
    summary: string | null;
    noMuscles: { exerciseId: string; text: string }[];
    /** `3 sets you marked (spotted) are counted here.`; null when none. */
    marked: string | null;
  };
}

export interface RecordView {
  /** Unique per row (`sessionExerciseId:kind`): the same exercise can appear twice in one workout. */
  key: string;
  sessionId: string;
  /** The workout row: exercise detail opens on its series. */
  sessionExerciseId: string;
  exerciseId: string;
  /** Exercise detail opens on this equipment's series (slice B). */
  equipmentId: string | null;
  /** `Best Est. 1RM` (labelled `≈`, `Est.`). */
  isEstimate: boolean;
  /** `Bench press · Main Gym`. */
  title: string;
  label: string;
  value: string;
  date: string;
  words: string;
}

export type ProgressHomeView =
  | { dataState: 'empty' }
  | {
      dataState: 'normal';
      window: ProgressWindow;
      windowLabel: string;
      datesLine: string;
      /** The same dates for VoiceOver: `12 September to 11 October`. */
      datesWords: string;
      activity: ActivityView;
      muscles: MusclesView;
      /**
       * Every record in the window, newest first. The home shows the first
       * `initial` and then `more` (`All records (5) ›`, §2.2 region 5), which
       * lists the rest in place.
       */
      records: { items: RecordView[]; total: number; initial: number; more: { label: string; words: string } | null; empty: string | null };
    };

/** §2.2 region 5: up to 3 record rows, then `All records (n) ›`. */
export const HOME_RECORDS_INITIAL = 3;

function sessionTitle(s: ProgressSession, exercises: ReadonlyMap<string, MuscleInfo>): string {
  if (s.name !== null && s.name.trim() !== '') return s.name;
  const infos = s.exercises.flatMap((e) => {
    const i = exercises.get(e.exerciseId);
    return i ? [{ movementPattern: i.movementPattern, primaryMuscles: [...i.primaryMuscles] }] : [];
  });
  return deriveWorkoutTitle(infos);
}

function recordView(r: ProgressRecord, gymNames: Readonly<Record<string, string>>): RecordView {
  const gym = r.gymId === null || r.equipmentId === null ? null : (gymNames[r.gymId] ?? null);
  const title = gym === null ? r.exerciseName : `${r.exerciseName} · ${gym}`;
  const unitWords = r.load.unit === 'kg' ? 'kilograms' : 'pounds';
  const what =
    r.kind === 'heaviest'
      ? `Heaviest set, ${massWords(r.load, r.equipmentKind)} by ${String(r.reps)}`
      : r.kind === 'best_e1rm'
        ? `Best estimated one-rep max, an estimate, about ${formatNumber(r.estimate ?? 0)} ${unitWords}${r.load.convention === 'per_hand' ? ' each' : ''}`
        : `Most reps at ${massWords(r.load, r.equipmentKind)}, ${String(r.reps)}`;
  return {
    key: `${r.sessionExerciseId}:${r.kind}`,
    sessionId: r.sessionId,
    sessionExerciseId: r.sessionExerciseId,
    exerciseId: r.exerciseId,
    equipmentId: r.equipmentId,
    isEstimate: r.isEstimate,
    title,
    label: r.label,
    value: r.value,
    date: dayMonth(r.date),
    words: `${gym === null ? r.exerciseName : `${r.exerciseName}, ${gym}`}. ${what}, ${dayMonthLong(r.date)}.`,
  };
}

function leftOutRow(s: LeftOutSession, title: string): TimeSheetRow {
  return {
    sessionId: s.sessionId,
    version: s.version,
    title,
    durationMs: s.durationMs,
    text: s.durationMs === null ? `${weekdayDayMonth(s.date)} · ${title}` : `${weekdayDayMonth(s.date)} · ${title} · ${gymTimeText(s.durationMs)}`,
  };
}

export function buildProgressHomeView(input: ProgressHomeInput): ProgressHomeView {
  if (input.sessions.length === 0) return { dataState: 'empty' };
  const window = input.range ? customProgressWindow(input.range) : periodProgressWindow(input.today, input.period);
  const custom = input.range !== undefined && input.range !== null;
  const label = custom ? `${String(window.days)} days` : progressPeriodLabel(input.period);
  // `Last month`, `Previous 3 months`; a custom period counts days.
  const phrase = custom ? label : progressPeriodPhrase(input.period);
  // A custom period may end before today: its words name the dates, never "last".
  const endsToday = window.to === input.today;
  const span = endsToday ? `Last ${phrase}` : rangeText(window, input.today);
  const gymNames = input.gymNames ?? {};
  const byId = new Map(input.sessions.map((s) => [s.sessionId, s]));
  const titleOf = (id: string): string => {
    const s = byId.get(id);
    return s ? sessionTitle(s, input.exercises) : 'Workout';
  };

  // Activity (PG24, PG25)
  const counts = countSessions(input.sessions, window);
  const time = timeInGym(input.sessions, window);
  const timeValue = time.timedCount === 0 ? '—' : gymTimeText(time.totalMs);
  // F17 (rule 6): a total from some sessions never reads as the total for all of them.
  const partlyTimed = time.timedCount > 0 && time.timedCount < time.sessionCount;
  const avgValue = time.avgMs === null ? '—' : gymTimeText(time.avgMs);
  const statsWords = [
    `${countNoun(counts.count, 'session', 'sessions')}.`,
    time.timedCount === 0 ? 'Time in gym not available.' : `Time in gym ${gymTimeWords(time.totalMs)}${partlyTimed ? `, from ${String(time.timedCount)} of ${countNoun(time.sessionCount, 'session', 'sessions')}` : ''}.`,
    time.avgMs === null ? '' : `Average ${gymTimeWords(time.avgMs)} per session.`,
  ]
    .filter((x) => x !== '')
    .join(' ');
  let chart: ActivityChartView;
  const point = (p: { from: string; to: string; count: number; partial: boolean }, unit: 'week' | 'month', label: string, listText: string): ActivityPointView => ({
    from: p.from,
    to: p.to,
    label,
    count: p.count,
    partial: p.partial,
    listText,
    valueText: `${pointDatesText(p, unit, p.partial)} · ${countNoun(p.count, 'session', 'sessions')}`,
  });
  if (counts.months !== null) {
    const months = counts.months;
    const withYear = window.from.slice(0, 4) !== window.to.slice(0, 4);
    const points = months.map((m) => point(m, 'month', monthBarLabel(m.from, withYear), `${monthBarLabel(m.from, withYear)}${m.partial ? ` (${dayMonth(m.from)}–${dayMonth(m.to)})` : ''} · ${String(m.count)}`));
    chart = { unit: 'month', points, yTicks: countAxisTicks(Math.max(0, ...months.map((m) => m.count))), words: monthBarsWords(months) };
  } else {
    const weeks = counts.weeks ?? [];
    const points = weeks.map((w) => point(w, 'week', dayMonth(w.from), weekBarListText(w)));
    chart = { unit: 'week', points, yTicks: countAxisTicks(Math.max(0, ...weeks.map((w) => w.count))), words: weekBarsWords(weeks) };
  }
  const prevHead = `Previous ${phrase}`;
  const comparison =
    counts.previousCount === 0
      ? `${prevHead}: none`
      : time.previousTimedCount === 0
        ? `${prevHead}: ${countNoun(counts.previousCount, 'session', 'sessions')}`
        : `${prevHead}: ${countNoun(counts.previousCount, 'session', 'sessions')} · ${gymTimeText(time.previousTotalMs)}`;
  const leftOut = time.sessionCount - time.timedCount;
  const onlyImported = time.sessionCount > 0 && time.excluded.imported === time.sessionCount;
  const footnote = leftOut === 0 ? null : onlyImported ? 'No times for imported workouts' : `Time from ${String(time.timedCount)} of ${String(time.sessionCount)} sessions`;
  const comparisonWords =
    counts.previousCount === 0
      ? `previous ${phrase} none`
      : time.previousTimedCount === 0
        ? `previous ${phrase} ${countNoun(counts.previousCount, 'session', 'sessions')}`
        : `previous ${phrase} ${countNoun(counts.previousCount, 'session', 'sessions')}, ${gymTimeWords(time.previousTotalMs)}`;
  const activity: ActivityView = {
    stats: [
      { value: String(counts.count), label: 'SESSIONS' },
      { value: timeValue, label: 'TIME', ...(partlyTimed ? { note: `${String(time.timedCount)} of ${String(time.sessionCount)} timed` } : {}) },
      { value: avgValue, label: 'AVG' },
    ],
    statsWords,
    chart,
    comparison,
    lastWorkout: counts.count === 0 && counts.lastSessionDate !== null ? `Last workout: ${weekdayDayMonth(counts.lastSessionDate)}` : null,
    footnote,
    cardWords: `${statsWords} ${chart.words} ${comparisonWords[0]?.toUpperCase() ?? ''}${comparisonWords.slice(1)}. Opens calendar.`,
    sheet: {
      countLine: `${span}: ${String(time.timedCount)} of ${countNoun(time.sessionCount, 'session', 'sessions')}`,
      overCap: time.excluded.overCap.map((s) => leftOutRow(s, titleOf(s.sessionId))),
      noEnd: time.excluded.noEnd.map((s) => leftOutRow(s, titleOf(s.sessionId))),
      imported: time.excluded.imported === 0 ? null : `${String(time.excluded.imported)} imported from FitNotes`,
    },
  };

  // Muscles (PG26, PG27)
  const freq = muscleFrequency(input.sessions, input.exercises, window, input.grouping);
  const maxSets = Math.max(0, ...freq.rows.map((r) => r.sets));
  const rows: FrequencyRowView[] = freq.rows.map((r) => ({
    key: r.key,
    label: r.label,
    sessions: r.sessions,
    sets: r.sets,
    setsText: setsText(r.sets),
    perWeek: r.perWeek === null ? null : perWeekText(r.perWeek),
    fraction: maxSets === 0 ? 0 : r.sets / maxSets,
    zero: r.sets === 0 && r.sessions === 0,
    words: `${r.label}, ${countNoun(r.sessions, 'session', 'sessions')}, ${setsWords(r.sets)}.`,
    lastTrained: r.lastTrained === null ? 'Not trained yet' : `Last trained ${dayMonth(r.lastTrained)}`,
    contributors: r.contributors.map((c) => ({
      exerciseId: c.exerciseId,
      text: c.factor === null ? `${c.name}  ${countNoun(c.sets, 'set', 'sets')}` : `${c.name}  ${countNoun(c.sets, 'set', 'sets')} × ${c.factor === 1 ? '1' : '½'} = ${setsText(c.total)}`,
    })),
    subRows: r.subRows.map((sr) => ({
      key: sr.key,
      label: sr.label,
      sessionsText: sr.sessions === null ? '' : String(sr.sessions),
      setsText: setsText(sr.sets),
      words: `${sr.label}, ${sr.sessions === null ? '' : `${countNoun(sr.sessions, 'session', 'sessions')}, `}${setsWords(sr.sets)}`,
    })),
  }));
  const skipped = [freq.notCounted.warmups > 0 ? countNoun(freq.notCounted.warmups, 'warm-up set', 'warm-up sets') : null, freq.notCounted.easy > 0 ? `${String(freq.notCounted.easy)} rated under RPE 6` : null].filter(
    (x): x is string => x !== null,
  );
  const noMusclesCount = freq.notCounted.noMuscles.length;
  const muscles: MusclesView = {
    grouping: input.grouping,
    rows,
    noneSet: input.grouping === 'body_part' && freq.hardSets > 0 && rows.every((r) => r.sets === 0),
    noMusclesLine: input.grouping === 'body_part' && noMusclesCount > 0 ? `${countNoun(noMusclesCount, 'exercise has', 'exercises have')} no muscles set` : null,
    notCounted: {
      summary: skipped.length === 0 ? null : skipped.join(' · '),
      noMuscles: freq.notCounted.noMuscles.map((n) => ({ exerciseId: n.exerciseId, text: `${n.name}: no muscles set (${countNoun(n.sets, 'set', 'sets')})` })),
      marked: freq.markedCounted === 0 ? null : `${countNoun(freq.markedCounted, 'set', 'sets')} you marked (${freq.markedKinds.map((k) => EXCLUSION_WORD[k]).join(', ')}) ${freq.markedCounted === 1 ? 'is' : 'are'} counted here.`,
    },
  };

  // Records (PG10, PG30)
  const rec = recordsInWindow(input.sessions, window, { limit: input.recordLimit ?? Number.POSITIVE_INFINITY, estimates: true });
  const listed = rec.items.length;
  return {
    dataState: 'normal',
    window,
    windowLabel: label,
    datesLine: rangeText(window, input.today),
    datesWords: rangeWords(window, input.today),
    activity,
    muscles,
    records: {
      items: rec.items.map((r) => recordView(r, gymNames)),
      total: rec.total,
      initial: HOME_RECORDS_INITIAL,
      more: listed > HOME_RECORDS_INITIAL ? { label: `All records (${String(listed)})`, words: `All records, ${String(listed)}.` } : null,
      empty: rec.total === 0 ? (endsToday ? `No new records in the last ${phrase}.` : `No new records, ${rangeText(window, input.today)}.`) : null,
    },
  };
}

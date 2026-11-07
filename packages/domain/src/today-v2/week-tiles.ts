import { ACTIVITY_WORD } from '../activity';
import { addDays, weekdayIndexOfDate } from '../calendar';
import { mondayOf } from '../progress/exercise';
import { stripActivityText, type StripActivityInput, type StripItem, type StripPlannedDayInput, type StripWorkoutInput } from './strip';

/**
 * (Redesign v3, Ben 27 Oct, option B) Today's week: seven tiles Mon–Sun like Progress's month calendar. No pills, no
 * labels, no legend. Only what happened or what Ben said (rule 6):
 * - a done day (any finished workout or done activity) is tinted light green, with a dot per gym session in its plan
 *   day's colour and a hollow ring per activity;
 * - a planned day (a dated plan day not done yet, an Any days plan's day left placed after today, a planned activity,
 *   or today's chosen workout) is transparent with a 1 pt outline and an empty ring in that session's colour;
 * - today is outlined; future days with nothing are plain. Colour is never the only signal: VoiceOver reads each day.
 * Tap a tile → that day's sheet (`items`). Pure.
 */

/**
 * The plan-day colour family by day name (Progress's calendar palette, redesign v3 §C3: Push orange, Pull blue, Legs
 * violet; Upper / Lower / Full body their own; anything else neutral). Minimal helper on this branch: the Progress
 * stream owns the palette and may replace this with its shared one.
 */
export type PlanDayColourKey = 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'full' | 'neutral';

export function planDayColourKey(name: string): PlanDayColourKey {
  const n = name.trim().toLowerCase();
  if (/^(push|chest|shoulders?)\b/.test(n)) return 'push';
  if (/^(pull|back)\b/.test(n)) return 'pull';
  if (/^legs?\b/.test(n)) return 'legs';
  if (/^upper\b/.test(n)) return 'upper';
  if (/^lower\b/.test(n)) return 'lower';
  if (/^full[\s-]?body\b/.test(n)) return 'full';
  return 'neutral';
}

export interface WeekTileMark {
  /** `dot`: a done gym session; `ring`: an activity (done or planned) or a planned session. */
  shape: 'dot' | 'ring';
  colour: PlanDayColourKey | 'activity';
  planned: boolean;
}

export interface WeekTile {
  date: string;
  /** `M`, `T`, `W` … */
  letter: string;
  dayOfMonth: number;
  today: boolean;
  past: boolean;
  /** `done`: light green; `planned`: outlined, transparent; `plain`: the shaded surface. */
  state: 'done' | 'planned' | 'plain';
  marks: WeekTileMark[];
  /** Everything on the day, for its sheet (done workouts, today's pick, planned days, activities). */
  items: StripItem[];
  /** `Today, Tuesday 27: Push, done. Run, 5 kilometres`. */
  accessibilityLabel: string;
}

const LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export interface WeekTilesInput {
  today: string;
  workouts: readonly StripWorkoutInput[];
  activities: readonly StripActivityInput[];
  /** Dated plan days not done yet this week (a Set days plan, or a day Ben moved). */
  plannedDays?: readonly StripPlannedDayInput[];
  /**
   * (Ben, 28 Oct) Any days plans: the plan days not done yet this week, in plan order, undated (`aheadDates` places
   * them). Absent or empty: none.
   */
  ahead?: readonly string[];
  /** The workout on Today's card (`Push`); null: none (done today, rest day). */
  chosen: string | null;
  /**
   * (Ben, 29 Oct: "it stays up on the calendar on today and also moves to new day") Ben picked the card's day for today
   * himself (the card picker, Any days `Do today instead`). Picked: today's ring, and its own date's ring goes (one
   * ring a plan day). Not picked (the card as it was before a Move…, a swap or a Skip): a day dated later this week, or
   * skipped this week, is never also ringed today.
   */
  chosenPicked?: boolean;
  /** Plan days skipped this week (names): never ringed, today included, unless Ben picks one. */
  skipped?: readonly string[];
  /**
   * (Ben, 31 Oct) Up next's plan day (name). Once a gym workout is finished today Up next plans from tomorrow: on an Any
   * days plan it leads the days left from tomorrow. Absent or null: plan order.
   */
  upNext?: string | null;
}

/**
 * Whether the card's day is ringed on today, and the planned days left to ring (a plan day once). Pure.
 */
export function todayRing(input: Pick<WeekTilesInput, 'today' | 'chosen' | 'chosenPicked' | 'skipped'> & { doneToday?: boolean }, planned: readonly StripPlannedDayInput[]): { chosen: string | null; planned: StripPlannedDayInput[] } {
  const c = input.chosen;
  if (c === null) return { chosen: null, planned: [...planned] };
  // (Ben, 31 Oct) Trained today: no planned ring on today unless Ben picks another session himself.
  if (input.doneToday === true && input.chosenPicked !== true) return { chosen: null, planned: [...planned] };
  if (input.chosenPicked === true) return { chosen: c, planned: planned.filter((d) => !(d.name === c && d.localDate > input.today)) };
  const later = planned.some((d) => d.name === c && d.localDate > input.today);
  const datedToday = planned.some((d) => d.name === c && d.localDate === input.today);
  if ((later && !datedToday) || (input.skipped ?? []).includes(c)) return { chosen: null, planned: [...planned] };
  return { chosen: c, planned: [...planned] };
}

function spokenActivity(a: StripActivityInput): string {
  const parts: string[] = [ACTIVITY_WORD[a.kind]];
  if (a.distanceM !== null) parts.push(`${String(Math.round(a.distanceM / 100) / 10)} kilometres`);
  else if (a.durationS !== null) parts.push(`${String(Math.round(a.durationS / 60))} minutes`);
  if (a.status === 'planned') parts.push('Planned');
  return parts.join(', ');
}

/**
 * (Ben, 28 Oct) Where an Any days plan's days left this week go: one a day, in order, from tomorrow to Sunday (the
 * next N − done days). Today holds the card's day (`chosen`, taken out of the list once) or a workout done today, so
 * the rest start tomorrow. More days left than dates: the ones that fit. Never a past day. (Ben, 31 Oct) `first`: Up
 * next once a workout is done today (it plans from tomorrow), so it goes on tomorrow, the rest after it in order.
 */
export function aheadDates(today: string, ahead: readonly string[], chosen: string | null, first: string | null = null): StripPlannedDayInput[] {
  const left = [...ahead];
  const i = chosen === null ? -1 : left.indexOf(chosen);
  if (i >= 0) left.splice(i, 1);
  const j = first === null ? -1 : left.indexOf(first);
  if (j > 0) left.unshift(...left.splice(j, 1));
  const sunday = addDays(mondayOf(today), 6);
  const out: StripPlannedDayInput[] = [];
  let date = addDays(today, 1);
  for (const name of left) {
    if (date > sunday) break;
    out.push({ localDate: date, name });
    date = addDays(date, 1);
  }
  return out;
}

export function buildWeekTiles(input: WeekTilesInput): WeekTile[] {
  const monday = mondayOf(input.today);
  const doneToday = input.workouts.some((w) => w.localDate === input.today);
  const ring = todayRing({ ...input, doneToday }, input.plannedDays ?? []);
  const plannedDays = [...ring.planned, ...aheadDates(input.today, input.ahead ?? [], ring.chosen, doneToday ? (input.upNext ?? null) : null)];
  const chosen = ring.chosen;
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const isToday = date === input.today;
    const past = date < input.today;
    const items: StripItem[] = [];
    const marks: WeekTileMark[] = [];
    const spoken: string[] = [];
    const done = input.workouts.filter((w) => w.localDate === date);
    for (const w of done) {
      items.push({ kind: 'workout', text: w.title, sessionId: w.sessionId, planned: false });
      marks.push({ shape: 'dot', colour: planDayColourKey(w.dayName ?? w.title), planned: false });
      spoken.push(`${w.title}, done`);
    }
    if (isToday && chosen !== null) {
      items.push({ kind: 'today', text: chosen, planned: true });
      marks.push({ shape: 'ring', colour: planDayColourKey(chosen), planned: true });
      spoken.push(`${chosen}, today's workout`);
    }
    if (!past && !isToday) {
      for (const d of plannedDays.filter((x) => x.localDate === date)) {
        items.push({ kind: 'plan_day', text: d.name, planned: true });
        marks.push({ shape: 'ring', colour: planDayColourKey(d.name), planned: true });
        spoken.push(`${d.name}, Planned`);
      }
    }
    let activityDone = false;
    for (const a of input.activities.filter((x) => x.localDate === date)) {
      const planned = a.status === 'planned';
      if (!planned) activityDone = true;
      items.push({ kind: 'activity', text: stripActivityText(a), activityId: a.activityId, planned });
      marks.push({ shape: 'ring', colour: 'activity', planned });
      spoken.push(spokenActivity(a));
    }
    const state: WeekTile['state'] = done.length > 0 || activityDone ? 'done' : marks.some((m) => m.planned) && !past ? 'planned' : 'plain';
    const head = `${isToday ? 'Today, ' : ''}${LONG[i] ?? ''} ${String(Number(date.slice(8, 10)))}`;
    return {
      date,
      letter: LETTER[i] ?? '',
      dayOfMonth: Number(date.slice(8, 10)),
      today: isToday,
      past,
      state,
      marks,
      items,
      accessibilityLabel: spoken.length === 0 ? head : `${head}: ${spoken.join('. ')}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Today's workout sheet and the rest-day card (redesign v3 option C, Ben 27 Oct)

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const shortDay = (date: string): string => SHORT[weekdayIndexOfDate(date)] ?? '';

export const TODAY_PICK_COPY = {
  title: 'Today’s workout',
  upNext: 'Up next',
  today: 'Today',
  restDay: 'Rest day',
  next: 'Next',
  mainLift: 'Main lift',
  exercises: 'Exercises',
  estTime: 'Est. time',
  gym: 'Gym',
  addGym: 'Add a gym',
  /** `(1 left out)`: exercises Time left out to fit, after the count. */
  leftOut: (n: number) => `(${String(n)} left out)`,
  time: 'Time',
  newBest: 'New best',
  summary: 'Summary ›',
  startPlan: 'Start Plan Workout',
  startEmpty: 'Start Empty Workout',
  thisWeek: 'This week',
  /** `Plan week 3 of 6`, `Plan week 6 of 6 · Deload`. */
  planWeek: (text: string) => `Plan ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
} as const;

export interface TodayDayRow {
  key: string;
  name: string;
  /** `Up next`, `Done Mon`, `Done today`, `Thu`, or ''. */
  status: string;
  selected: boolean;
  accessibilityLabel: string;
}

/**
 * The `Push ⌄` sheet's plan days: each with what Ben can trust about it this week. Up next (the plan's pick), done (the
 * day it was first done this week), else its planned weekday (a Set days plan); nothing invented for a rotation.
 */
export function todayDayRows(input: { days: readonly { key: string; name: string }[]; nextKey: string | null; selectedKey: string | null; today: string; doneOn: Readonly<Record<string, string>>; plannedOn: Readonly<Record<string, string>> }): TodayDayRow[] {
  return input.days.map((d) => {
    const doneDate = input.doneOn[d.key];
    const planned = input.plannedOn[d.key];
    const status = d.key === input.nextKey ? TODAY_PICK_COPY.upNext : doneDate !== undefined ? (doneDate === input.today ? 'Done today' : `Done ${shortDay(doneDate)}`) : planned !== undefined ? (planned === input.today ? TODAY_PICK_COPY.today : shortDay(planned)) : '';
    const selected = d.key === input.selectedKey;
    return { key: d.key, name: d.name, status, selected, accessibilityLabel: [d.name, status === '' ? null : status, selected ? 'selected' : null].filter((x): x is string => x !== null).join(', ') };
  });
}

/**
 * A rest day (Set days plans only): nothing done today, and no plan day still to do is dated today or earlier this
 * week. `next`: the earliest plan day dated after today (`Legs · Thu`); Start Plan Workout starts it early. Null: not a
 * rest day (a rotation never has one; its next day is always Up next).
 */
export function todayRestDay(input: { setDays: boolean; doneToday: boolean; today: string; days: readonly { key: string; name: string }[]; plannedOn: Readonly<Record<string, string>> }): { nextKey: string; text: string; accessibilityLabel: string } | null {
  if (!input.setDays || input.doneToday) return null;
  const dated = input.days.flatMap((d) => (input.plannedOn[d.key] === undefined ? [] : [{ ...d, date: input.plannedOn[d.key] ?? '' }]));
  if (dated.length === 0 || dated.some((d) => d.date <= input.today)) return null;
  const next = [...dated].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  if (next === undefined) return null;
  const day = shortDay(next.date);
  return { nextKey: next.key, text: `${next.name} · ${day}`, accessibilityLabel: `Rest day. Next, ${next.name}, ${LONG[weekdayIndexOfDate(next.date)] ?? day}` };
}

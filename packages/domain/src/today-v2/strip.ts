import type { ActivityEffort, ActivityKind } from '@fizz/schemas';
import { ACTIVITY_WORD } from '../activity';
import { addDays, weekdayIndexOfDate } from '../calendar';
import { formatNumber } from '../display';

/**
 * Today (v2)'s 7-day strip (workout-builder-v3 §2.0.2 region 3, Q19): 3 days
 * back, today, 3 ahead. Only what happened or what Ben said:
 * - done workouts `✓ Shoulders`;
 * - activities Ben logged (`＋ Activity`) or told the coach (`log_activity`),
 *   done or planned: `Run 12k`;
 * - planned plan days only when dated (a week change Ben applied, or days he
 *   told the coach). The rotation has no dates, so with none dated the
 *   future cells stay empty (never inferred);
 * - a past day with nothing: `Rest`.
 * Colour is never the only signal: `✓`, the dashed outline and the word
 * `Planned` in the VoiceOver label.
 */

export interface StripWorkoutInput {
  sessionId: string;
  localDate: string;
  title: string;
}

export interface StripActivityInput {
  activityId: string;
  localDate: string;
  kind: ActivityKind;
  status: 'done' | 'planned';
  distanceM: number | null;
  durationS: number | null;
  effort: ActivityEffort | null;
}

export interface StripPlannedDayInput {
  localDate: string;
  name: string;
}

export type StripItem =
  | { kind: 'workout'; text: string; sessionId: string; planned: false }
  | { kind: 'activity'; text: string; activityId: string; planned: boolean }
  | { kind: 'plan_day'; text: string; planned: true }
  | { kind: 'today'; text: string; planned: true }
  | { kind: 'rest'; text: string; planned: false };

export interface StripCell {
  date: string;
  /** `SAT`; today reads `TODAY`. */
  weekday: string;
  dayOfMonth: number;
  today: boolean;
  past: boolean;
  /** A Monday: the thin divider before it shows the plan week. */
  weekStart: boolean;
  /** At most two shown. */
  items: StripItem[];
  /** Items beyond the two shown. */
  more: number;
  /** `Saturday 17: Shoulders, done. Run 12 km`. */
  accessibilityLabel: string;
  /** The large-text list row: `Sat 17 · ✓ Shoulders`. */
  listText: string;
}

const SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const TITLE = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** `Run 12k`, `Run 5.5k`, `Ride 45 min`, `Swim`. */
export function stripActivityText(a: Pick<StripActivityInput, 'kind' | 'distanceM' | 'durationS'>): string {
  const word = ACTIVITY_WORD[a.kind];
  if (a.distanceM !== null) {
    const km = a.distanceM / 1000;
    return `${word} ${formatNumber(km >= 10 ? Math.round(km) : Math.round(km * 10) / 10)}k`;
  }
  if (a.durationS !== null) return `${word} ${String(Math.round(a.durationS / 60))} min`;
  return word;
}

function spokenActivity(a: StripActivityInput): string {
  const word = ACTIVITY_WORD[a.kind];
  const parts = [word];
  if (a.distanceM !== null) parts.push(`${formatNumber(Math.round(a.distanceM / 100) / 10)} kilometres`);
  else if (a.durationS !== null) parts.push(`${String(Math.round(a.durationS / 60))} minutes`);
  if (a.status === 'planned') parts.push('Planned');
  return parts.join(', ');
}

export interface TodayStripInput {
  today: string;
  workouts: readonly StripWorkoutInput[];
  activities: readonly StripActivityInput[];
  plannedDays?: readonly StripPlannedDayInput[];
  /** The day on the card (`Chest`); null: none picked (done today, no plan). */
  chosen: string | null;
  /** First use: only today. */
  todayOnly?: boolean;
}

/** `buildTodayStrip`: the 7 cells, oldest first. */
export function buildTodayStrip(input: TodayStripInput): StripCell[] {
  const offsets = input.todayOnly === true ? [0] : [-3, -2, -1, 0, 1, 2, 3];
  return offsets.map((o) => {
    const date = addDays(input.today, o);
    const wd = weekdayIndexOfDate(date);
    const isToday = o === 0;
    const past = o < 0;
    const items: StripItem[] = [];
    const spoken: string[] = [];
    for (const w of input.workouts.filter((x) => x.localDate === date)) {
      items.push({ kind: 'workout', text: `✓ ${w.title}`, sessionId: w.sessionId, planned: false });
      spoken.push(`${w.title}, done`);
    }
    if (isToday && items.length === 0 && input.chosen !== null) {
      items.push({ kind: 'today', text: input.chosen, planned: true });
      spoken.push(`${input.chosen}, today's session`);
    }
    if (!past) {
      for (const d of input.plannedDays?.filter((x) => x.localDate === date) ?? []) {
        if (isToday) continue;
        items.push({ kind: 'plan_day', text: d.name, planned: true });
        spoken.push(`${d.name}, Planned`);
      }
    }
    for (const a of input.activities.filter((x) => x.localDate === date)) {
      // A planned activity on a past day isn't shown as done; it still shows (Ben said it), dashed.
      items.push({ kind: 'activity', text: stripActivityText(a), activityId: a.activityId, planned: a.status === 'planned' });
      spoken.push(spokenActivity(a));
    }
    if (past && items.length === 0) {
      items.push({ kind: 'rest', text: 'Rest', planned: false });
      spoken.push('Rest');
    }
    const shown = items.slice(0, 2);
    const head = `${isToday ? 'Today, ' : ''}${LONG[wd] ?? ''} ${String(Number(date.slice(8, 10)))}`;
    return {
      date,
      weekday: isToday ? 'TODAY' : (SHORT[wd] ?? ''),
      dayOfMonth: Number(date.slice(8, 10)),
      today: isToday,
      past,
      weekStart: wd === 0,
      items: shown,
      more: items.length - shown.length,
      accessibilityLabel: spoken.length === 0 ? head : `${head}: ${spoken.join('. ')}`,
      listText: `${TITLE[wd] ?? ''} ${String(Number(date.slice(8, 10)))}${items.length === 0 ? '' : ` · ${items.map((i) => i.text).join(' · ')}`}`,
    };
  });
}

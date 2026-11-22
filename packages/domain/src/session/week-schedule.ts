import { addDays } from '../calendar';

/**
 * (Ben, 11 Nov, build 564: "Why did you give me pull on Tuesday?" → "I can't verify why it was originally placed there")
 * This week's plan days as the coach reads them: each day's date and the reason in a few words, and how Today's card
 * (Up next) was picked. The schedule is the app's own rules (training-blocks.md §4.1a; `setDaysWeekSlots`,
 * `upNextOrder`, MS1–MS9), never a coach action, so the coach explains it from this fact. Pure; numbers from the plan
 * and logs only (rule 6).
 */

/** A plan day as this week's schedule fact reads it. Weekdays: Mon = 0. */
export interface WeekScheduleDay {
  name: string;
  /** Its plan weekday (the schedule, without this week's moves); null on Any days. */
  own: number | null;
  /** The weekday Ben moved it to this week (Move to…, Do today instead); null: not moved. */
  movedTo: number | null;
  /** This week's weekday after the slotting (`setDaysWeekSlots`); null: no free plan day left. */
  slot: number | null;
  /** The weekday it was done this week; null: not done. */
  doneOn: number | null;
  skipped: boolean;
  /** Set days: it doesn't fit this week (`week.missed`, MS1). */
  missed: boolean;
  /** Its type last trained (local `YYYY-MM-DD`, any workout of that type); null: not in the window. */
  lastTrained: string | null;
  /** A Health strength workout on its passed date with nothing logged (`Strength 47 min, Garmin`). */
  health?: string | null;
}

export interface WeekScheduleInput {
  mode: 'set' | 'any';
  /** This week's Monday, local `YYYY-MM-DD`. */
  monday: string;
  /** Today's weekday. */
  today: number;
  /** Trained today: Up next plans from tomorrow. */
  doneToday: boolean;
  days: readonly WeekScheduleDay[];
  /** Up next's day (Today's card unless Ben picks another); null: none. */
  upNext: string | null;
  /** Ben picked Up next himself (`Make next`). */
  pinned: boolean;
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const wd = (n: number): string => WD[n] ?? '?';
const shortDate = (date: string): string => `${String(Number(date.slice(8, 10)))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;

/** `Mon 9 Nov`, `Sat 31 Oct`, `Sun 1 Nov`. */
function dayText(monday: string, weekday: number): string {
  return `${wd(weekday)} ${shortDate(addDays(monday, weekday))}`;
}

function reasonOf(d: WeekScheduleDay, input: WeekScheduleInput, planningDay: number): string {
  const at = (n: number) => dayText(input.monday, n);
  if (d.doneOn !== null) return `done ${at(d.doneOn)}${d.own !== null && d.own !== d.doneOn ? ` (scheduled ${wd(d.own)})` : ''}`;
  if (d.skipped) return 'skipped this week by Ben';
  const health = d.health == null ? '' : `; Health has ${d.health} that day, not logged in the app: offer Today › Log a past workout`;
  if (input.mode === 'any') return `to do (Any days: no dates)${d.name === input.upNext ? ', Up next' : ''}`;
  const own = d.own;
  if (d.missed) {
    const passed = own !== null && own < input.today;
    return `${own === null ? '' : `scheduled ${at(own)} · `}missed: ${passed ? 'nothing logged that day and ' : ''}no free plan day left this week${passed ? health : ''}`;
  }
  const slot = d.slot;
  if (slot === null) return 'no free plan day left this week';
  if (d.movedTo !== null && slot === d.movedTo && d.movedTo !== own) return `moved by Ben from ${own === null ? 'its day' : wd(own)} to ${at(slot)}`;
  if (own !== null && slot !== own) {
    if (d.name === input.upNext && slot === planningDay) return `${at(slot)}: Up next (scheduled ${wd(own)})`;
    const holder = input.days.find((x) => x !== d && (x.doneOn === own || (x.doneOn === null && !x.skipped && x.slot === own)));
    const why = holder === undefined ? '' : holder.doneOn === own ? `: Ben did ${holder.name} on ${wd(own)}` : holder.name === input.upNext ? `: ${holder.name} is Up next on ${wd(own)}` : `: ${holder.name} is on ${wd(own)}`;
    return `${at(slot)}, moved from ${wd(own)}${why}`;
  }
  const past = slot < input.today;
  return `scheduled ${at(slot)}${past ? ' · not done' : ''}${d.name === input.upNext ? ' · Up next' : ''}${past ? health : ''}`;
}

/** How Today's card was picked (Up next), with the last-trained dates it ordered by. */
function upNextLine(input: WeekScheduleInput): string | null {
  const up = input.days.find((d) => d.name === input.upNext);
  if (up === undefined) return null;
  const head = `Today's card: Up next = ${up.name}`;
  if (input.pinned) return `${head}, picked by Ben (Make next).`;
  const planningDay = input.doneToday ? input.today + 1 : input.today;
  if (input.mode === 'set' && up.movedTo !== null && up.movedTo === planningDay) return `${head}, moved there by Ben.`;
  const allOpen = input.days.filter((d) => d.doneOn === null && !d.skipped);
  // A day Ben moved to a later date comes after the others (`upNextOrder` rule 5), whatever its last-trained date.
  const later = input.mode === 'set' ? allOpen.filter((d) => d.movedTo !== null && d.movedTo > planningDay) : [];
  const open = allOpen.filter((d) => !later.includes(d));
  const seen = new Set<string>();
  const dates = open
    .map((d) => `${d.name} ${d.lastTrained === null ? 'not recently' : shortDate(d.lastTrained)}`)
    .filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  const rule = open.length <= 1 ? 'the only day left this week' : `the day not done this week whose type was trained longest ago${input.mode === 'set' ? ', schedule breaks ties' : ', plan order breaks ties'}`;
  const moved = later.length === 0 ? '' : `; ${later.map((d) => d.name).join(', ')} moved later by Ben, so after the others`;
  return `${head}${input.doneToday ? ' (trained today, so from tomorrow)' : ''}: ${rule}${open.length > 1 ? ` (last trained: ${dates.join(', ')})` : ''}${moved}.`;
}

/**
 * This week's schedule for the coach: one line per plan day (`Pull A: scheduled Tue 10 Nov · missed: …`, `Legs A:
 * moved by Ben from Wed to Thu 12 Nov`, `Push A: done Mon 9 Nov`), then how Today's card was picked. Pure.
 */
export function weekScheduleLines(input: WeekScheduleInput): string[] {
  const planningDay = input.doneToday ? input.today + 1 : input.today;
  const lines = input.days.map((d) => `${d.name}: ${reasonOf(d, input, planningDay)}`);
  const up = upNextLine(input);
  return up === null ? lines : [...lines, up];
}

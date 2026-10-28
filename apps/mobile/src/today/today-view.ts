import { clampMinutes, localDateOf, stepTodayMinutes, toMs, toggleTodayAbs, TODAY_PICK_COPY, TODAY_V2_COPY, weekdayIndexOfDate, withTodayControl, type FeedItem, planDayColourKey, type TodayControls, type TodayDay, type TodayMain, type WeekTile, type WeekTileMark } from '@fizz/domain';

/**
 * Today (v2)'s screen rules (workout-builder-v3 §2.0, prototypes/today-v2.html), pure so they are tested
 * without a renderer: the day control's segments and their VoiceOver labels, the card's selection
 * reducer (the five controls, Mix it up, the breakdown), the title, and whether a route exists yet.
 * The workout itself always comes from `todaySession.card` (the screen never computes it).
 */

const LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** `Tuesday`: the day title (§2.0.2 region 1). */
export function todayTitle(utc: string, tz: string): string {
  return LONG[weekdayIndexOfDate(localDateOf(toMs(utc), tz))] ?? '';
}

/** Plan days shown as segments; more go in `⋯` (§2.0.2, Proposal). */
export const MAX_DAY_SEGMENTS = 4;

export interface TodaySegment {
  key: string;
  label: string;
  next: boolean;
  selected: boolean;
  /** `⋯` (Other sessions, and any plan day past the fourth). */
  more: boolean;
  accessibilityLabel: string;
}

/**
 * The day control: the plan's first four days in plan order (`NEXT` under the next one), then `⋯`, which
 * shows the picked name when an Other session (or a fifth day) is on the card. VoiceOver: a tab
 * `Chest, next, 1 of 5`. Paused: no day is next.
 */
export function todaySegments(input: { days: readonly TodayDay[]; others: readonly TodayDay[]; nextKey: string | null; selectedKey: string | null; paused: boolean }): { segments: TodaySegment[]; overflow: TodayDay[] } {
  const shown = input.days.slice(0, MAX_DAY_SEGMENTS);
  const overflow = input.days.slice(MAX_DAY_SEGMENTS);
  const total = shown.length + 1;
  const segments: TodaySegment[] = shown.map((d, i) => {
    const next = !input.paused && d.key === input.nextKey;
    const selected = d.key === input.selectedKey;
    return { key: d.key, label: d.name, next, selected, more: false, accessibilityLabel: [d.name, next ? 'next' : null, `${String(i + 1)} of ${String(total)}`].filter((x): x is string => x !== null).join(', ') };
  });
  const picked = [...overflow, ...input.others].find((d) => d.key === input.selectedKey) ?? null;
  segments.push({
    key: 'more',
    label: picked?.name ?? TODAY_V2_COPY.other,
    next: picked !== null && !input.paused && picked.key === input.nextKey,
    selected: picked !== null,
    more: true,
    accessibilityLabel: picked === null ? `${TODAY_V2_COPY.otherLabel}, ${String(total)} of ${String(total)}` : `${picked.name}, ${TODAY_V2_COPY.otherLabel}, ${String(total)} of ${String(total)}`,
  });
  return { segments, overflow };
}

// ---------------------------------------------------------------------------
// The card's selection

export interface TodayCardState {
  dayKey: string;
  controls: TodayControls;
  /** Session breakdown open. */
  open: boolean;
  /** `Why?` open. */
  why: boolean;
}

export type TodayCardAction =
  | { kind: 'day'; dayKey: string; initial: TodayControls }
  | { kind: 'main_lift'; exerciseId: string | null }
  | { kind: 'accessories'; value: 'focused' | 'varied' }
  | { kind: 'minutes'; delta: -1 | 1 }
  /** The Time detail's `Undo`: back to the plan's length. */
  | { kind: 'minutes_to'; minutes: number }
  | { kind: 'abs'; planOn: boolean }
  | { kind: 'supersets' }
  | { kind: 'mix' }
  | { kind: 'mix_undo' }
  | { kind: 'breakdown' }
  | { kind: 'why' };

/**
 * Picking a day resets the controls to that day's own (its last-used main lift) and collapses the card
 * (§2.0.2 Day control). Mix it up is today only: `Another` moves to the next pick, `Undo` restores.
 */
export function todayCardReducer(s: TodayCardState, a: TodayCardAction): TodayCardState {
  switch (a.kind) {
    case 'day':
      return { dayKey: a.dayKey, controls: a.initial, open: false, why: false };
    case 'main_lift':
      return { ...s, controls: withTodayControl(s.controls, 'mainLiftExerciseId', a.exerciseId) };
    case 'accessories':
      return { ...s, controls: withTodayControl(s.controls, 'accessories', a.value) };
    case 'minutes':
      return { ...s, controls: withTodayControl(s.controls, 'minutes', stepTodayMinutes(s.controls.minutes, a.delta)) };
    case 'minutes_to':
      return { ...s, controls: withTodayControl(s.controls, 'minutes', clampMinutes(a.minutes)) };
    case 'abs':
      return { ...s, controls: toggleTodayAbs(s.controls, { absPlan: a.planOn }) };
    case 'supersets':
      return { ...s, controls: withTodayControl(s.controls, 'supersets', !s.controls.supersets) };
    case 'mix':
      return { ...s, controls: { ...s.controls, mix: s.controls.mix + 1 } };
    case 'mix_undo':
      return { ...s, controls: { ...s.controls, mix: 0 } };
    case 'breakdown':
      return { ...s, open: !s.open };
    case 'why':
      return { ...s, why: !s.why };
  }
}

/**
 * (D3) On a reload, the card follows a main lift Ben chose on Your workout (Main lift left Today's card): the day's
 * latest draft was written since the last read, is for another of the day's lifts (`initialMain`, which the service
 * only sets to one of them), and isn't the card's. Anything else keeps the card as Ben left it.
 */
export function followLatestDraft(cur: TodayCardState, latest: { mainLiftExerciseId: string | null; atUtc: string } | undefined, seenAtUtc: string | undefined, initialMain: string | null | undefined): TodayCardState {
  if (latest === undefined || latest.atUtc === seenAtUtc || latest.mainLiftExerciseId === cur.controls.mainLiftExerciseId || initialMain !== latest.mainLiftExerciseId) return cur;
  return todayCardReducer(cur, { kind: 'main_lift', exerciseId: latest.mainLiftExerciseId });
}

/**
 * (Ben, 28 Oct) Up next re-checks when history changes (an import committed, a past workout logged, edited or deleted,
 * an Undo of those): a card that was showing Up next's day and that Ben left untouched is redrafted for the new Up next
 * day (its own controls). A day Ben picked, a card whose controls he changed, or a day with a draft he edited (or a
 * coach offer he applied) keeps his choice. Anything else: the card as it is.
 */
export function followUpNext(
  cur: TodayCardState,
  i: {
    /** Up next before this read, and now. */
    prevNextKey: string | null;
    nextKey: string | null;
    /** Ben picked this day himself (the sheet, `Do today`). */
    picked: boolean;
    /** A draft of this day Ben edited, or a coach offer he applied. */
    hasOwnDraft: boolean;
    /** The day's controls as the previous read opened it (null: unknown). */
    initialWas: TodayControls | null;
    initial: Readonly<Record<string, TodayControls>>;
  },
): TodayCardState {
  if (i.prevNextKey === null || i.nextKey === null || i.nextKey === i.prevNextKey || cur.dayKey !== i.prevNextKey) return cur;
  if (i.picked || i.hasOwnDraft || i.initialWas === null || JSON.stringify(cur.controls) !== JSON.stringify(i.initialWas)) return cur;
  const next = i.initial[i.nextKey];
  return next === undefined ? cur : { dayKey: i.nextKey, controls: next, open: cur.open, why: false };
}

/** A day has a draft Ben edited, or a coach offer he applied (`edited` / `nudged` are keyed `dayKey|mainLift`). */
export function hasOwnDraftFor(dayKey: string, s: { edited: Readonly<Record<string, unknown>>; nudged: Readonly<Record<string, unknown>> }): boolean {
  const mine = (k: string) => k.startsWith(`${dayKey}|`);
  return Object.keys(s.edited).some(mine) || Object.keys(s.nudged).some(mine);
}

/** The card's one button for VoiceOver: `Chest, Bench, details, collapsed`. */
export function breakdownLabel(title: string, mainLift: string | null, open: boolean): string {
  return [title, mainLift, 'details', open ? 'expanded' : 'collapsed'].filter((x): x is string => x !== null && x !== '').join(', ');
}

/** `5 minutes less` / `5 minutes more`, and the value read out as `60 minutes`. */
export const TIME_LABELS = { less: '5 minutes less', more: '5 minutes more', value: (m: number) => `Time, ${String(m)} minutes` } as const;

export const TODAY_SCREEN_COPY = {
  /** The coach's offer couldn't be applied (not out of date: the write failed). */
  offerFailed: 'Not applied',
  started: 'A workout is already in progress.',
  notStarted: (m: string) => `Couldn’t start the workout: ${m}. Try again.`,
  speak: 'Speak to the coach',
  coach: 'Ask the coach',
  activity: 'Add an activity',
  addActivity: '＋ Activity',
  daySheetEmpty: 'Nothing logged',
  /** Today's session couldn't be read: said, never shown as `No plan`. */
  sessionFailed: 'Couldn’t load',
  /** No plan in use: the old Today's Up next (split, rotation) still offered (review today-fix-21oct B1). */
  upNext: 'Up next',
  upNextLabel: (title: string) => `Start ${title}, up next`,
  /** (Redesign v3 §A2) The Health line's long-press sheet. */
  showOnToday: 'Show on Today',
  done: 'Done',
  /** (Redesign v3 §A5) The coach's offer sheet: `1 change for today`. */
  changesForToday: (n: number) => `${String(n)} ${n === 1 ? 'change' : 'changes'} for today`,
} as const;

/** What Today's session area offers in each state of its read (review today-fix-21oct B1, S2, S3). */
export interface TodayActions {
  /** The gym chip on the `Today's session` row: shown while it loads and after a failed read too. */
  gymRow: boolean;
  /** `Couldn't load · Try again`. */
  failed: boolean;
  /** The resolver's Up next with Start (No plan only). */
  upNext: boolean;
  /** `Build your own`: primary when nothing else is the main action. */
  buildYourOwn: 'primary' | 'secondary' | null;
  /**
   * (Ben, 26 Oct) `Empty workout` as a visible one-tap action in every state of a read (with a plan, no plan, paused,
   * nothing up next, done today) and after a failed read; hidden while loading (no button moving under a finger) and
   * while a workout is open (Resume takes over). It stays in `⋯` too.
   */
  emptyWorkout: boolean;
  /** Where it sits: under the card's Start when a card shows, else its own row in the session area. */
  emptyOnCard: boolean;
}

/**
 * Pure: the session area's actions. A failed read never removes the ways to start a workout (Build your own,
 * Empty workout); No plan with an Up next makes that the main action and Build your own secondary.
 */
export function todayActions(input: { openWorkout: boolean; read: 'loading' | 'failed' | 'ready'; noPlan: boolean; cardShown: boolean; upNext: boolean }): TodayActions {
  if (input.openWorkout) return { gymRow: false, failed: false, upNext: false, buildYourOwn: null, emptyWorkout: false, emptyOnCard: false };
  if (input.read === 'loading') return { gymRow: true, failed: false, upNext: false, buildYourOwn: null, emptyWorkout: false, emptyOnCard: false };
  if (input.read === 'failed') return { gymRow: true, failed: true, upNext: false, buildYourOwn: 'primary', emptyWorkout: true, emptyOnCard: false };
  const noPlanList = input.noPlan && !input.cardShown;
  const upNext = noPlanList && input.upNext;
  return { gymRow: true, failed: false, upNext, buildYourOwn: noPlanList && !upNext ? 'primary' : 'secondary', emptyWorkout: true, emptyOnCard: input.cardShown };
}

/**
 * How often Today's clock ticks (app review 26 Oct, finding 8): only while a clock is on screen. The Resume
 * hero's rest countdown needs a second-by-second tick; its `started 18:02` only changes its date at midnight, so a
 * minute is enough. With no workout open nothing on Today moves with time, so there is no tick at all (`null`)
 * and the page isn't redrawn every second.
 */
export function todayTickMs(main: TodayMain | null): number | null {
  if (main === null || main.kind !== 'resume') return null;
  return main.status.kind === 'resting' ? 1000 : 60_000;
}

/**
 * (Ben, 26 Oct; app review finding 14) Today's text at large sizes. The day row's segments share a fixed width, so
 * from xxxLarge (RN font scale ≈ 1.35) the row becomes the one-line `Day  Chest ›` control (the list sheet), not at
 * AX1 as before, when `Shoulders` and `Full body` were already cut. Below that, a label shrinks to fit (never `…`)
 * and grows with Dynamic Type only so far.
 */
export const DAY_LIST_FONT_SCALE = 1.3;

export const TODAY_TEXT_FIT = {
  segmentLabel: { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7, maxFontSizeMultiplier: 1.3 },
  segmentNext: { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8, maxFontSizeMultiplier: 1.3 },
  weekLabel: { adjustsFontSizeToFit: true, minimumFontScale: 0.85 },
} as const;

export function dayRowAsList(fontScale: number): boolean {
  return fontScale >= DAY_LIST_FONT_SCALE;
}

/**
 * The header's `· Week 6 of 6 · Deload` sits beside the day name only when there's room: on a 375 pt phone at the
 * default sizes. On a narrower screen (320 pt) or from xLarge text it goes on its own line under the name, so
 * neither it, the name nor the coach bar is cut.
 */
export function todayWeekStacked(widthPt: number, fontScale: number): boolean {
  return widthPt < 375 || fontScale >= 1.1;
}

// ---------------------------------------------------------------------------
// Redesign v3 (Ben, 27 Oct): option C card rows, the day sheet, Recent, the section label

/** The label above the card: `Up next` on the plan's next day, `Today` when Ben picked another (option C). */
export function todayCardLabel(selectedKey: string | null, nextKey: string | null): string {
  return selectedKey !== null && nextKey !== null && selectedKey !== nextKey ? TODAY_PICK_COPY.today : TODAY_PICK_COPY.upNext;
}

export interface LabelValueRow {
  label: string;
  value: string;
  /** A small secondary part after the value (`(1 left out)`), tappable when the row says so. */
  note?: string;
}

/** The collapsed card's rows: `Main lift  Bench press`, `Exercises  5`, `Est. time  45 min` (the live estimate). */
export function todayCardRows(v: { list: readonly { main: boolean; fullName: string }[]; exerciseCount: number; minutes: number; time: { minutes: number } | null; leftOut?: number }, gymName: string | null = null): LabelValueRow[] {
  const main = v.list.find((r) => r.main)?.fullName ?? null;
  const left = v.leftOut ?? 0;
  return [
    ...(main === null ? [] : [{ label: TODAY_PICK_COPY.mainLift, value: main }]),
    // (Ben, 27 Oct) `Exercises  5 (1 left out)`: only when Time left something out; the note opens the fit with Undo.
    { label: TODAY_PICK_COPY.exercises, value: String(v.exerciseCount), ...(left > 0 ? { note: TODAY_PICK_COPY.leftOut(left) } : {}) },
    { label: TODAY_PICK_COPY.estTime, value: TODAY_V2_COPY.minutesValue(v.time?.minutes ?? v.minutes) },
    ...(gymName === null ? [] : [{ label: TODAY_PICK_COPY.gym, value: gymName }]),
  ];
}

/** The done card's rows (`Time 47 min`, `New best 1`); a date-only workout has no time; no bests: no row. */
export function doneCardRows(activeMs: number | null, newBests: number): LabelValueRow[] {
  return [
    ...(activeMs === null ? [] : [{ label: TODAY_PICK_COPY.time, value: TODAY_V2_COPY.minutesValue(Math.max(1, Math.round(activeMs / 60_000))) }]),
    ...(newBests > 0 ? [{ label: TODAY_PICK_COPY.newBest, value: String(newBests) }] : []),
  ];
}

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** `27 October`: the header's date line under the day name (Ben, 27 Oct). */
export function todayDateLine(utc: string, tz: string): string {
  const d = localDateOf(toMs(utc), tz);
  return `${String(Number(d.slice(8, 10)))} ${LONG_MONTHS[Number(d.slice(5, 7)) - 1] ?? ''}`;
}

/** `Mon 26 Oct`: a day sheet's title. */
export function daySheetTitle(date: string): string {
  return `${SHORT_DAYS[weekdayIndexOfDate(date)] ?? ''} ${String(Number(date.slice(8, 10)))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;
}

export type DaySheetOpen = { kind: 'summary'; sessionId: string } | { kind: 'activity'; activityId: string } | { kind: 'plan_day'; dayName: string } | null;

export interface DaySheetRow {
  key: string;
  mark: WeekTileMark;
  title: string;
  /** Imported from Apple Health: a small `♥` after the name (Ben, 27 Oct); VoiceOver says `from Apple Health`. */
  health: boolean;
  detail: string | null;
  open: DaySheetOpen;
  accessibilityLabel: string;
}

/**
 * A tapped tile's rows (Ben, 27 Oct): a done workout (`54 min · 17 sets`, opens its Summary), an activity (`5.2 km ·
 * 28 min`, opens it), a planned day (`Legs · planned`, `Back squat · 5 exercises · 45 min`, opens the plan day). The
 * values are History's (`feed`) and the plan day's card (`plannedDetail`); nothing invented. A tile with nothing on it
 * has no sheet (`[]`).
 */
export function daySheetRows(tile: Pick<WeekTile, 'items' | 'marks'>, feed: readonly FeedItem[], plannedDetail: (dayName: string) => string | null): DaySheetRow[] {
  return tile.items.map((it, i) => {
    const mark = tile.marks[i] ?? { shape: 'ring', colour: 'neutral', planned: true };
    switch (it.kind) {
      case 'workout': {
        const f = feed.find((x) => x.kind === 'workout' && x.sessionId === it.sessionId);
        return { key: `w:${it.sessionId}`, mark, title: f?.title ?? it.text, health: false, detail: f?.value ?? null, open: { kind: 'summary', sessionId: it.sessionId }, accessibilityLabel: [f?.title ?? it.text, 'done', f?.value ?? null].filter((x): x is string => x !== null).join(', ') };
      }
      case 'activity': {
        const f = feed.find((x) => x.kind === 'activity' && x.activityId === it.activityId);
        const title = f?.title ?? it.text;
        const detail = it.planned ? 'planned' : (f?.value ?? null);
        const health = f?.kind === 'activity' && f.fromHealth !== undefined;
        return { key: `a:${it.activityId}`, mark, title, health, detail, open: { kind: 'activity', activityId: it.activityId }, accessibilityLabel: [title, health ? 'from Apple Health' : null, detail].filter((x): x is string => x !== null).join(', ') };
      }
      case 'plan_day':
      case 'today': {
        const title = `${it.text} · ${it.kind === 'today' ? 'today' : 'planned'}`;
        const detail = plannedDetail(it.text);
        return { key: `p:${it.text}:${String(i)}`, mark, title, health: false, detail, open: { kind: 'plan_day', dayName: it.text }, accessibilityLabel: [title, detail].filter((x): x is string => x !== null).join(', ') };
      }
      case 'rest':
        return { key: `r:${String(i)}`, mark, title: it.text, health: false, detail: null, open: null, accessibilityLabel: it.text };
    }
  });
}

/** `Back squat · 5 exercises · 45 min`: a planned day's line from its card. */
export function plannedDayDetail(v: { list: readonly { main: boolean; fullName: string }[]; exerciseCount: number; minutes: number; time: { minutes: number } | null }): string {
  const main = v.list.find((r) => r.main)?.fullName ?? null;
  const n = v.exerciseCount;
  return [main, `${String(n)} ${n === 1 ? 'exercise' : 'exercises'}`, TODAY_V2_COPY.minutesValue(v.time?.minutes ?? v.minutes)].filter((x): x is string => x !== null).join(' · ');
}

/** Today's Recent (Ben, 27 Oct): the last three things done, newest first, `Push` over `Mon 26 · 54 min · 17 sets`. */
export const TODAY_RECENT_MAX = 3;

export function todayRecentRows(items: readonly FeedItem[]): { item: FeedItem; mark: WeekTileMark; title: string; health: boolean; line: string; accessibilityLabel: string }[] {
  return items.slice(0, TODAY_RECENT_MAX).map((it) => {
    const day = it.when.split(' ').slice(0, 2).join(' ');
    // (Ben, 27 Oct) The week tiles' marker leads every row: a session dot in its plan day's colour, a ring for an activity.
    const mark: WeekTileMark = it.kind === 'workout' ? { shape: 'dot', colour: planDayColourKey(it.title), planned: false } : { shape: 'ring', colour: 'activity', planned: false };
    const health = it.kind === 'activity' && it.fromHealth !== undefined;
    return { item: it, mark, title: it.title, health, line: [day, it.value].filter((x) => x !== '').join(' · '), accessibilityLabel: health ? `${it.accessibilityLabel}, from Apple Health` : it.accessibilityLabel };
  });
}

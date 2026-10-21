import { localDateOf, stepTodayMinutes, toMs, toggleTodayAbs, TODAY_V2_COPY, weekdayIndexOfDate, withTodayControl, type TodayControls, type TodayDay } from '@fizz/domain';

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
} as const;

import { healthActivityLine, healthSourceText, toMs, type LinkableWorkout } from '@fizz/domain';
import type { HealthActivityProvenance, HealthSettings, HealthWorkoutSample } from '@fizz/schemas';
import type { HealthCapability } from '@fizz/providers';

import { formatShortDate, formatTime, formatWhen } from '../format/dates';

/**
 * Apple Health's views (apple-health.md §2, §4, §6), pure. Values and actions only (minimal copy); the reason for
 * a state sits behind `Why?`.
 */

export const HEALTH_COPY = {
  title: 'Apple Health',
  saveTo: 'Save to Health',
  readFrom: 'Read from Health',
  workouts: 'Workouts',
  activities: 'Runs, rides and other activities',
  heartRate: 'Heart rate on linked workouts',
  bodyweight: 'Bodyweight',
  sources: 'Sources',
  readNow: 'Read now',
  reading: 'Reading…',
  notAvailable: 'Not available on this install',
  notAvailableWhy: 'This install’s signing doesn’t include Health.',
  unsupported: 'Not available on this iPhone',
  off: 'Off',
  offInHealth: 'Off in Health',
  offInHealthHow: 'Health › your profile › Apps › GymSmarter',
  nothingYet: 'Nothing from Health yet',
  nothingYetWhy: 'Check Health › your profile › Apps › GymSmarter.',
  remove: 'Remove GymSmarter workouts from Health',
  removed: 'Removed from Health',
  remove_: 'Remove',
  cancel: 'Cancel',
  tryAgain: 'Try again',
  linkedActivity: 'Linked activity',
  linkQuestion: 'Link to this workout?',
  link: 'Link',
  notIt: 'Not it',
  linked: 'Linked',
  unlink: 'Unlink',
  unlinked: 'Unlinked',
  undo: 'Undo',
  linkToWorkout: 'Link to a workout',
  linkFromHealth: 'Link activity from Health',
  openHealth: 'Open Health',
  failed: 'Couldn’t save. Try again.',
  stale: 'Changed since. Try again.',
} as const;

export type HealthSwitch = 'writeWorkouts' | 'readActivities' | 'readHeartRate' | 'readWeight';

export interface HealthSwitchRow {
  key: HealthSwitch;
  title: string;
  on: boolean;
  /** `Off in Health`, `1 not saved to Health`, `Nothing from Health yet`; null when nothing to say. */
  detail: string | null;
  /** `Why?` text behind the detail. */
  why: string | null;
  /** `Try again` beside a write that failed. */
  retry: boolean;
}

export interface HealthScreenView {
  /** False: only the `Not available` line (no switches). */
  available: boolean;
  /** `Not available on this install`, `Off`, `On · last read 07:42`, `Last read failed · 07:42`, `Reading…`. */
  line: string;
  why: string | null;
  save: HealthSwitchRow[];
  read: HealthSwitchRow[];
  sources: { name: string; line: string }[];
  /** `Last read 07:42 · 3 new`; null before the first read or with every read off. */
  lastRead: string | null;
  canReadNow: boolean;
  canRemove: boolean;
}

export interface HealthStatusInput {
  capability: HealthCapability;
  settings: HealthSettings;
  shareStatus: 'notDetermined' | 'denied' | 'authorized' | null;
  /** Workouts not yet saved to Health after a failed write. */
  notSaved: number;
  /** Activities and weights read in the store (for `Nothing from Health yet`). */
  readCounts: { workouts: number; weights: number };
  sources: { name: string; latestUtc: string }[];
  reading: boolean;
  newOnLastRead: number | null;
  /** Workouts this app wrote that are still in Health. */
  written: number;
  nowMs: number;
  tz: string;
  locale?: string;
}

/** Profile › Apple Health and its Profile row (apple-health.md §2.1, §4). */
export function healthScreenView(i: HealthStatusInput): HealthScreenView {
  const s = i.settings;
  if (i.capability !== 'available') {
    return {
      available: false,
      line: i.capability === 'unsupported' ? HEALTH_COPY.unsupported : HEALTH_COPY.notAvailable,
      why: i.capability === 'unsupported' ? null : HEALTH_COPY.notAvailableWhy,
      save: [],
      read: [],
      sources: [],
      lastRead: null,
      canReadNow: false,
      canRemove: false,
    };
  }
  const anyRead = s.readActivities || s.readWeight || s.readHeartRate;
  const anyOn = anyRead || s.writeWorkouts;
  const when = (utc: string) => formatWhen(toMs(utc), i.nowMs, i.tz, i.locale);
  let line: string;
  if (!anyOn) line = HEALTH_COPY.off;
  else if (i.reading) line = HEALTH_COPY.reading;
  else if (s.lastReadFailedUtc !== null && (s.lastReadUtc === null || s.lastReadFailedUtc > s.lastReadUtc)) line = `Last read failed · ${when(s.lastReadFailedUtc)}`;
  else if (anyRead && s.lastReadUtc !== null) line = `On · last read ${when(s.lastReadUtc)}`;
  else line = 'On';
  const writeDetail = !s.writeWorkouts ? null : i.shareStatus === 'denied' ? HEALTH_COPY.offInHealth : i.notSaved > 0 ? `${String(i.notSaved)} not saved to Health` : null;
  const nothing = (on: boolean, n: number) => (on && s.lastReadUtc !== null && n === 0 ? HEALTH_COPY.nothingYet : null);
  const read: HealthSwitchRow[] = [
    { key: 'readActivities', title: HEALTH_COPY.activities, on: s.readActivities, detail: nothing(s.readActivities, i.readCounts.workouts), why: nothing(s.readActivities, i.readCounts.workouts) === null ? null : HEALTH_COPY.nothingYetWhy, retry: false },
    { key: 'readHeartRate', title: HEALTH_COPY.heartRate, on: s.readHeartRate, detail: null, why: null, retry: false },
    { key: 'readWeight', title: HEALTH_COPY.bodyweight, on: s.readWeight, detail: nothing(s.readWeight, i.readCounts.weights), why: nothing(s.readWeight, i.readCounts.weights) === null ? null : HEALTH_COPY.nothingYetWhy, retry: false },
  ];
  return {
    available: true,
    line,
    why: null,
    save: [{ key: 'writeWorkouts', title: HEALTH_COPY.workouts, on: s.writeWorkouts, detail: writeDetail, why: writeDetail === HEALTH_COPY.offInHealth ? HEALTH_COPY.offInHealthHow : null, retry: writeDetail !== null && writeDetail !== HEALTH_COPY.offInHealth }],
    read,
    sources: [...i.sources].sort((a, b) => (a.latestUtc < b.latestUtc ? 1 : -1)).map((x) => ({ name: healthSourceText(x.name), line: `latest ${when(x.latestUtc)}` })),
    lastRead: !anyRead || s.lastReadUtc === null ? null : `Last read ${when(s.lastReadUtc)}${i.newOnLastRead !== null && i.newOnLastRead > 0 ? ` · ${String(i.newOnLastRead)} new` : ''}`,
    canReadNow: anyRead && !i.reading,
    canRemove: i.written > 0,
  };
}

/** The Profile row's subtitle: `On · last read 07:42`, `Off`, `Not available on this install`. */
export function healthProfileLine(v: HealthScreenView): string {
  return v.line;
}

// ---------------------------------------------------------------------------
// Summary / past workout: Linked activity

export interface LinkedActivityView {
  kind: 'linked';
  healthUuid: string;
  linkVersion: number;
  /** `Garmin · Strength · 61 min`. */
  line: string;
  /** `Avg HR 118 · Max 162` (only with `Heart rate on linked workouts`); null otherwise. */
  heartRate: string | null;
  /** The sheet: `Strength · Garmin` / `Tue 27 Oct · 18:01–19:02 · 61 min`. */
  sheetTitle: string;
  sheetWhen: string;
  accessibilityLabel: string;
}

export interface LinkQuestionView {
  kind: 'question';
  candidates: { healthUuid: string; line: string; accessibilityLabel: string }[];
}

export type WorkoutHealthView = LinkedActivityView | LinkQuestionView | { kind: 'none' };

function minutes(p: Pick<HealthActivityProvenance, 'startUtc' | 'endUtc'>): number {
  return Math.round((toMs(p.endUtc) - toMs(p.startUtc)) / 60_000);
}

function heartRateText(p: Pick<HealthActivityProvenance, 'avgHeartRate' | 'maxHeartRate'>): string | null {
  const parts = [p.avgHeartRate === null ? null : `Avg HR ${String(p.avgHeartRate)}`, p.maxHeartRate === null ? null : `Max ${String(p.maxHeartRate)}`].filter((x): x is string => x !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The `Linked activity` row and sheet for a linked Health workout (actuals from the watch; never merged with the app's). */
export function linkedActivityView(p: HealthActivityProvenance, linkVersion: number, showHeartRate: boolean, tz: string, locale?: string): LinkedActivityView {
  const m = minutes(p);
  const line = `${p.sourceName} · ${String(m)} min`;
  const hr = showHeartRate ? heartRateText(p) : null;
  const start = toMs(p.startUtc);
  const end = toMs(p.endUtc);
  return {
    kind: 'linked',
    healthUuid: p.uuid,
    linkVersion,
    line,
    heartRate: hr,
    sheetTitle: `${p.label} · ${p.sourceName}`,
    sheetWhen: `${formatShortDate(start, tz, locale)} · ${formatTime(start, tz, locale)}–${formatTime(end, tz, locale)} · ${String(m)} min`,
    accessibilityLabel: `Linked activity, ${p.label}, ${p.sourceName}, ${String(m)} minutes${hr === null ? '' : `, ${hr.replace('Avg HR', 'average heart rate').replace('Max', 'maximum')}`}, from Apple Health`,
  };
}

/** `Strength · Garmin · 17:40–18:35`: one Health workout the Summary asks about. */
export function linkCandidateLine(s: Pick<HealthWorkoutSample, 'activityType' | 'sourceName' | 'startUtc' | 'endUtc'>, label: string, tz: string, locale?: string): { line: string; accessibilityLabel: string } {
  const source = healthSourceText(s.sourceName);
  const line = `${label} · ${source} · ${formatTime(toMs(s.startUtc), tz, locale)}–${formatTime(toMs(s.endUtc), tz, locale)}`;
  return { line, accessibilityLabel: `${line}, from Apple Health` };
}

/** One row of `Link to a workout`: `Push · Tue 27 Oct 18:02`. */
export function linkableWorkoutLine(w: LinkableWorkout, locale?: string): string {
  const ms = toMs(w.startUtc);
  return `${w.title} · ${formatShortDate(ms, w.tz, locale)} ${formatTime(ms, w.tz, locale)}`;
}

/** The Health activity sheet's facts line: `16.2 km · 1 h 31 min · Avg HR 141`, the source line, and HR only when on. */
export function healthActivityFacts(p: HealthActivityProvenance, detail: string, showHeartRate: boolean, tz: string, locale?: string): { when: string; facts: string; source: string } {
  const start = toMs(p.startUtc);
  const hr = showHeartRate ? heartRateText(p) : null;
  return {
    when: `${formatShortDate(start, tz, locale)} · ${formatTime(start, tz, locale)}–${formatTime(toMs(p.endUtc), tz, locale)}`,
    facts: [detail, hr].filter((x): x is string => x !== null && x !== '').join(' · '),
    source: `${p.sourceName} · Apple Health`,
  };
}

export { healthActivityLine };

import { BUILD_LENGTH_CHIPS, type ActionRecord, type BuildDay, type BuildFocus, type TrainingSplit } from '@fizz/schemas';
import { buildRequestText, buildingTitle, draftCardEndText, draftName, historyUsedLine, splitDayFocus, type DraftCardState } from '@fizz/domain';

import type { CoachDraftCard, CoachDraftInfo } from '../services/workout-services';
import type { BuildBlock } from './coach-service';

/**
 * The workout builder's views (workout-builder.md v1.0 §4, §5, §7): the
 * Build card, the draft card, the version card and `Needs the coach`. Pure:
 * every value comes from code (the stored draft, the overview's estimate),
 * never from the model's words. Minimal copy: values and actions only.
 */

export const BUILD_COPY = {
  chip: 'Build a workout',
  title: 'Build a workout',
  length: 'LENGTH',
  focus: 'FOCUS',
  build: 'Build',
  noGym: '⚠ No gym',
  open: 'Open ›',
  cancel: 'Cancel',
  link: 'Build with coach',
  newWith: 'New with coach',
  needsCoach: 'Needs the coach',
  connect: 'Connect ›',
  emptyWorkout: 'Empty workout',
  chooseSession: 'Choose session',
  fromCoach: 'FROM COACH',
  undo: 'Undo',
  why: 'Why? ›',
  leftOut: (n: number) => `⚠ ${String(n)} left out`,
  saveToWorkouts: 'Save to Workouts',
  askCoach: 'Ask coach',
  whyThisWorkout: 'Why this workout',
  discard: 'Discard draft',
  discarded: 'Draft discarded',
  deleted: 'Draft deleted',
  startByTap: "Tap Start workout when you're ready.",
} as const;

/** One Build card chip: a day of the Settings split (F19). */
export interface BuildDayChip {
  id: string;
  focus: BuildFocus;
  day: BuildDay;
}

/** F19: the Build card's chips are the split's days, in its order. No `Coach picks`. */
export function buildDayChips(split: TrainingSplit): BuildDayChip[] {
  return split.days.map((d) => ({ id: d.id, focus: splitDayFocus(split, d), day: { name: d.name, bodyParts: [...d.bodyParts] } }));
}

export interface BuildCardView {
  title: string;
  lengths: { minutes: number; label: string; selected: boolean; accessibilityLabel: string }[];
  focuses: { id: string; label: string; selected: boolean; accessibilityLabel: string }[];
  /** `⌂ Main gym`, or `⚠ No gym` (the typical gym's items are used). */
  gym: { text: string; warning: boolean };
  /** Ben's message `Build` sends: `Build a 45 min push workout`. */
  message: string;
  buildLabel: string;
}

/**
 * The Build card (§4.1, F19). Length defaults to the session length (Training
 * details). The focus chips are the Settings split's days, the next day in
 * rotation selected (`dayId`); a chip is always selected.
 */
export function buildCardView(s: { minutes: number | null; days: readonly BuildDayChip[]; dayId: string | null; gymName: string | null }): BuildCardView {
  const chosen = s.days.find((d) => d.id === s.dayId) ?? s.days[0] ?? null;
  const message = buildRequestText({ minutes: s.minutes, focus: chosen?.focus ?? 'coach_picks', dayName: chosen?.day.name ?? null });
  const spoken = chosen === null ? '' : `${chosen.day.name.toLowerCase()} `;
  return {
    title: BUILD_COPY.title,
    lengths: BUILD_LENGTH_CHIPS.map((m) => ({ minutes: m, label: String(m), selected: s.minutes === m, accessibilityLabel: `${String(m)} minutes${s.minutes === m ? ', selected' : ''}, length` })),
    focuses: s.days.map((d) => {
      const selected = d.id === chosen?.id;
      return { id: d.id, label: d.day.name, selected, accessibilityLabel: `${d.day.name}${selected ? ', selected' : ''}, focus` };
    }),
    gym: s.gymName === null ? { text: BUILD_COPY.noGym, warning: true } : { text: `⌂ ${s.gymName}`, warning: false },
    message,
    buildLabel: `Build a ${s.minutes === null ? '' : `${String(s.minutes)} minute `}${spoken}workout`,
  };
}

/** The pending card (§4.2): `Building Push · 45 min` and the elapsed `0:12` (no spinner). */
export function pendingBuildView(s: { focus: BuildFocus; minutes: number; elapsedMs: number; dayName?: string | null }): { title: string; elapsed: string } {
  const sec = Math.max(0, Math.floor(s.elapsedMs / 1000));
  return { title: buildingTitle(s.focus, s.minutes, s.dayName ?? null), elapsed: `${String(Math.floor(sec / 60))}:${String(sec % 60).padStart(2, '0')}` };
}

export interface DraftCardView {
  title: string;
  /** `6 exercises · ≈ 44 min · Main gym`. */
  line: string;
  leftOut: string | null;
  /** `Open ›` while it can open; else the end state's words (`After this workout`, `Started 18:10` …). */
  open: boolean;
  endText: string | null;
  /** `Saved · <name> ›` opens that workout's overview. */
  routineId: string | null;
  accessibilityLabel: string;
}

/** The draft card (§4.2, §6.6): one element, every value from the stored draft. */
export function draftCardView(card: CoachDraftCard, clock: (utc: string, tz: string) => string): DraftCardView {
  const parts = [`${String(card.exerciseCount)} ${card.exerciseCount === 1 ? 'exercise' : 'exercises'}`, card.estimateMinutes === null ? null : `≈ ${String(card.estimateMinutes)} min`, card.gymName].filter((x): x is string => x !== null);
  const endText = draftCardEndText(card.state, clock);
  const spokenName = card.name.replace(' · ', ' ').replace(/ min$/, ' minutes');
  const spoken = [
    `Coach draft, ${spokenName}`,
    `${String(card.exerciseCount)} exercises`,
    card.estimateMinutes === null ? null : `about ${String(card.estimateMinutes)} minutes`,
    card.leftOut > 0 ? `${String(card.leftOut)} left out` : null,
  ].filter((x): x is string => x !== null);
  return {
    title: card.name,
    line: parts.join(' · '),
    leftOut: card.leftOut > 0 ? BUILD_COPY.leftOut(card.leftOut) : null,
    open: card.state.kind === 'open',
    endText,
    routineId: card.state.kind === 'saved' ? card.state.routineId : null,
    accessibilityLabel: `${spoken.join(', ')}.${card.state.kind === 'open' ? ' Open button.' : endText === null ? '' : ` ${endText.replace(' ›', '')}.`}`,
  };
}

export interface DraftChangeView {
  title: string;
  lines: { icon: 'plus.circle' | 'minus.circle' | 'pencil'; text: string }[];
  minutes: string | null;
  canUndo: boolean;
}

/** The version card (§5.3, `DraftChangeCard`): code-made lines with an icon and a word glyph each; never colour alone. */
export function draftChangeView(r: ActionRecord, minutes: { before: number | null; after: number | null }, current: DraftCardState): DraftChangeView | null {
  const d = r.detail;
  if (d.kind !== 'build_workout' || d.parentN === null || r.status !== 'committed') return null;
  return {
    title: `Version ${String(d.versionN)}`,
    lines: d.lines.map((l) => ({ icon: l.change === 'add' ? 'plus.circle' : l.change === 'remove' ? 'minus.circle' : 'pencil', text: l.text })),
    minutes: minutes.before === null || minutes.after === null ? null : `≈ ${String(minutes.before)} → ${String(minutes.after)} min`,
    canUndo: current.kind === 'open' || current.kind === 'after_workout',
  };
}

const BLOCK_WORD: Readonly<Record<BuildBlock, string>> = {
  offline: 'Offline',
  not_connected: 'Not connected',
  signed_out: 'Signed out',
  usage_limit: 'Usage limit',
  choose_model: 'Choose a model',
};

/** `Needs the coach · Offline` (§5.4): the reason word, and `Connect ›` when connecting fixes it. No stand-in plan. */
export function needsCoachView(block: BuildBlock): { title: string; line: string; connect: boolean; accessibilityLabel: string } {
  const word = BLOCK_WORD[block];
  return { title: BUILD_COPY.link, line: `${BUILD_COPY.needsCoach} · ${word}`, connect: block === 'not_connected' || block === 'signed_out', accessibilityLabel: `${BUILD_COPY.needsCoach}. ${word}.` };
}

/** The picker's `FROM COACH` row (§4.4): name, then when it was made (an actual) and the count. */
export function fromCoachRowText(row: { name: string; exerciseCount: number }, made: string): { title: string; detail: string } {
  return { title: row.name, detail: `${made} · ${String(row.exerciseCount)} ${row.exerciseCount === 1 ? 'exercise' : 'exercises'}` };
}

/** The draft's name for a chip choice (the card's own title before it's built). */
export function chosenName(focus: BuildFocus, minutes: number | null, dayName?: string | null): string {
  return draftName(focus, minutes ?? 60, dayName ?? null);
}

/**
 * `Why this workout` (§4.5): Ben's words (quoted data), the coach's checked
 * rationale and the code's check lines. Read-only; nothing here is the
 * model's number.
 */
export function draftWhyView(d: Pick<CoachDraftInfo, 'request' | 'rationale' | 'checks' | 'fitMinutes'> & Partial<Pick<CoachDraftInfo, 'loads' | 'headNote' | 'historyUsed'>>): { heading: string; lines: string[] }[] {
  // v2 §4.5 `LOADS`: the final target (code), its label, code's reason line and notes, then the coach's note quoted (data, review r2 B1r).
  const loads = (d.loads ?? []).flatMap((l) => [`${l.name} ${l.target}${l.label === null ? '' : ` · ${l.label}`}`, ...l.notes.map((n) => `  ⓘ ${n}`), ...(l.quote === null ? [] : [`  Coach’s note “${l.quote}”`])]);
  // WB-L9: a coach basis code didn't use (failed the check, or named another number than the target), quoted.
  const notUsed = (d.loads ?? []).flatMap((l) => (l.notUsed === null ? [] : [`${l.name}: “${l.notUsed}”`]));
  // Review S4: only the history a load actually came from (absent before the page is planned: not claimed).
  const history = d.historyUsed === undefined ? null : historyUsedLine(d.historyUsed);
  return [
    { heading: 'YOU ASKED', lines: [`“${d.request}”`] },
    ...(d.rationale === null ? [] : [{ heading: 'COACH', lines: [d.rationale] }]),
    ...(loads.length === 0 ? [] : [{ heading: 'LOADS', lines: loads }]),
    { heading: 'USED', lines: [d.headNote !== undefined && d.headNote !== '' ? d.headNote : `${String(d.fitMinutes)} min`, ...(history === null ? [] : [history])] },
    ...(d.checks.length === 0 ? [] : [{ heading: 'CHECKS', lines: d.checks }]),
    ...(notUsed.length === 0 ? [] : [{ heading: 'NOT USED', lines: notUsed }]),
  ];
}

/**
 * A tap on the coach's question card (§6.2, WB-Q9): with the coach
 * unavailable, nothing is saved or sent and the card says `Needs the coach ·
 * Offline`; otherwise the answer (or `Skip`) is sent as Ben's message, and a
 * tapped main lift for a split day is saved to Profile first (the service
 * refuses it when Ben already chose one).
 */
export type QuestionTap = { kind: 'blocked'; line: string } | { kind: 'send'; text: string; saveMainLift: { dayId: string; catalogueId: string; opId: string } | null };

export function questionTap(
  block: BuildBlock | null,
  q: { actionId: string; topic: string; day: { id: string } | null },
  a: { label: string; catalogueId: string | null } | 'skip',
  skipText: string,
): QuestionTap {
  if (block !== null) return { kind: 'blocked', line: needsCoachView(block).line };
  if (a === 'skip') return { kind: 'send', text: skipText, saveMainLift: null };
  const save = a.catalogueId !== null && q.topic === 'main_lift' && q.day !== null ? { dayId: q.day.id, catalogueId: a.catalogueId, opId: `${q.actionId}:main-lift` } : null;
  return { kind: 'send', text: a.label, saveMainLift: save };
}

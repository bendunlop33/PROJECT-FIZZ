import type { WeightUnit } from '@fizz/schemas';
import { infoOrDefault } from '../builder/arrange';
import { workingCount } from '../builder/set-rows';
import type { BuilderInfoLookup, BuilderSlot, BuilderWorkout } from '../builder/types';
import { formatNumber, NBSP } from '../display';

/**
 * Today (v2) card text (workout-builder-v3 §2.0, prototypes/today-v2.html).
 * Values and actions only (minimal copy); every number comes from code.
 */

export const TODAY_V2_COPY = {
  session: 'Today’s session',
  next: 'NEXT',
  other: '⋯',
  otherLabel: 'Other sessions',
  mainLift: 'Main lift',
  accessories: 'Accessories',
  focused: 'Focused',
  varied: 'Varied',
  time: 'Time',
  abs: 'Abs',
  supersets: 'Supersets',
  breakdown: 'Session breakdown',
  why: 'Why?',
  mix: '↻ Mix it up',
  undo: 'Undo',
  // The coach's pre-session offer (§6.1; rule 3: applied only on Ben's tap).
  apply: 'Apply',
  skip: 'Skip',
  applied: 'Applied',
  start: 'Start',
  edit: 'Edit',
  buildYourOwn: 'Build your own',
  emptyWorkout: 'Empty workout',
  close: 'Close',
  coach: 'Coach',
  offline: 'Offline',
  notConnected: 'Not connected',
  noPlan: 'No plan',
  setUpPlan: 'Set up a plan',
  planPaused: 'Plan paused',
  planned: 'Planned',
  rest: 'Rest',
  edited: 'edited',
  backToPlan: 'Back to plan day',
  notReviewedOffline: 'Not reviewed · Offline',
  notReviewedNotConnected: 'Not reviewed · Coach not connected',
  notReviewed: 'Not reviewed',
  exercise: 'Exercise',
  sets: 'Sets',
  topSet: (unit: WeightUnit) => `Top set (${unit})`,
  another: (k: number, n: number) => `Another (${String(k)}/${String(n)})`,
  minutesValue: (m: number) => `${String(m)}${NBSP}min`,
  planAbs: (on: boolean) => `plan: ${on ? 'on' : 'off'}`,
  summary: (n: number, minutes: number) => `${String(n)} ${n === 1 ? 'exercise' : 'exercises'} · ~${String(minutes)}${NBSP}min`,
  moves: (day: string, to: string) => `${day} moves to ${to}`,
} as const;

// ---------------------------------------------------------------------------
// Session breakdown (`#` · Exercise + works line · Sets (+N W) · Top set)

export interface TodayBreakdownRow {
  key: string;
  exerciseId: string;
  /** `1`, `4a`, `4b`. */
  label: string;
  name: string;
  works: string | null;
  sets: number;
  warmups: number;
  /** `+3 W` (warm-ups), or null. */
  warmupText: string | null;
  /** `102.5`, `27.5 each`, `assist 25`, `BW`, `—`; a load in another unit than the header carries it. */
  top: string;
  /** Superset box: which block, its letter, first/last (the connecting line). */
  superset: { block: number; member: string; first: boolean; last: boolean } | null;
  /** Pain-flagged (rule 9): held, never progressed; the row shows a warning mark. */
  held: boolean;
  accessibilityLabel: string;
}

function topLoadOf(slot: BuilderSlot): number | null {
  const loads = slot.rows.filter((r) => r.type !== 'warmup' && r.load !== null).map((r) => r.load as number);
  if (loads.length === 0) return null;
  // Assisted: less help is harder, so the top set is the least assistance.
  return slot.convention === 'assistance' ? Math.min(...loads) : Math.max(...loads);
}

/** The top set's value as the table shows it (header unit `unit`). */
export function topSetText(slot: BuilderSlot, unit: WeightUnit): string {
  if (slot.convention === 'bodyweight') return 'BW';
  const v = topLoadOf(slot);
  if (v === null) return slot.convention === 'added' ? 'BW' : '—';
  const n = `${formatNumber(v)}${slot.unit === unit ? '' : `${NBSP}${slot.unit}`}`;
  switch (slot.convention) {
    case 'per_hand':
      return `${n}${NBSP}each`;
    case 'assistance':
      return `assist${NBSP}${n}`;
    case 'added':
      return v === 0 ? 'BW' : `+${n}`;
    case 'total':
    case 'stack':
      return n;
  }
}

/** The header unit: the most common slot unit (Ben's unit when none has a load). */
export function breakdownUnit(w: BuilderWorkout, fallback: WeightUnit): WeightUnit {
  const units = w.blocks.flatMap((b) => b.slots.filter((s) => topLoadOf(s) !== null).map((s) => s.unit));
  const kg = units.filter((u) => u === 'kg').length;
  const lb = units.length - kg;
  return units.length === 0 ? fallback : kg >= lb ? 'kg' : 'lb';
}

export function todayBreakdown(w: BuilderWorkout, info: BuilderInfoLookup, worksOf: (exerciseId: string) => string | null, unit: WeightUnit, painFlagged: (exerciseId: string) => boolean = () => false): TodayBreakdownRow[] {
  const out: TodayBreakdownRow[] = [];
  let n = 0;
  w.blocks.forEach((b, bi) => {
    if (b.slots.length === 0) return;
    n += 1;
    b.slots.forEach((s, i) => {
      const member = b.slots.length > 1 ? String.fromCharCode(97 + i) : '';
      const name = infoOrDefault(info, s.exerciseId).name;
      const sets = workingCount(s);
      const warmups = s.rows.filter((r) => r.type === 'warmup').length;
      const top = topSetText(s, unit);
      const label = `${String(n)}${member}`;
      const held = painFlagged(s.exerciseId);
      const spoken = top === '—' ? 'no load yet' : top === 'BW' ? 'bodyweight' : `top set ${top.replaceAll(NBSP, ' ')}${s.unit === unit ? ` ${unit}` : ''}`;
      out.push({
        key: s.key,
        exerciseId: s.exerciseId,
        label,
        name,
        works: worksOf(s.exerciseId),
        sets,
        warmups,
        warmupText: warmups > 0 ? `+${String(warmups)}${NBSP}W` : null,
        top,
        superset: member === '' ? null : { block: bi, member, first: i === 0, last: i === b.slots.length - 1 },
        held,
        accessibilityLabel: [`${label}, ${name}`, held ? 'pain flag, held' : null, member === '' ? null : 'superset', `${String(sets)} ${sets === 1 ? 'set' : 'sets'}`, warmups > 0 ? `plus ${String(warmups)} warm-up${warmups === 1 ? '' : 's'}` : null, spoken].filter((x): x is string => x !== null).join(', '),
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Why? (facts from code; the coach's reason when it changed something)

/** `reviewed`: the coach looked (its line, an applied or skipped offer, or its own silence): no `Not reviewed` line. */
export type TodayReviewStatus = 'reviewed' | 'offline' | 'not_connected' | 'not_reviewed';

export interface TodayWhyInput {
  dayName: string;
  /** The plan's next day (null: no plan in use, or paused). */
  nextDayName: string | null;
  /** The day is an Other session (not in the plan). */
  other: boolean;
  /**
   * (§2.0.4 No plan) The day is a Profile split day: `Chest: up next` on the day NEXT marks (`longest since trained`
   * when the split rule picked it), else `Chest: picked by you; Back stays next`.
   */
  split?: { due: boolean } | null;
  /** Last time this day was done, with the main lift's top working set (actuals). */
  last: { dateText: string; lift: string; value: string; reps: number; rpe: number | null } | null;
  /** The main lift's top set today (target). */
  mainTarget: string | null;
  goal: 'strength' | 'muscle' | 'both' | null;
  /** A lift target that is on (`bench target 110 kg`). */
  liftTarget: string | null;
  accessories: 'focused' | 'varied';
  minutes: number;
  /** The coach's one-line reason, when it changed something (coach stream). */
  coachReason: string | null;
  review: TodayReviewStatus;
  /** Pain-flagged movements still on the card (a main lift), held at their last load (rule 9). */
  held?: readonly string[];
  /** The plan's main lift this gym can't do (left out, §3.7). */
  missingHere?: string | null;
}

const GOAL_WORD = { strength: 'strength', muscle: 'muscle', both: 'strength and muscle' } as const;

/** `Why?` lines: plan position, last session → today's load, goal/target, accessories and time, then the review line. */
export function todayWhy(input: TodayWhyInput): string[] {
  const lines: string[] = [];
  if (input.split != null) {
    if (input.nextDayName === input.dayName) lines.push(`${input.dayName}: up next${input.split.due ? ' · longest since trained' : ''}`);
    else lines.push(`${input.dayName}: picked by you${input.nextDayName === null ? '' : `; ${input.nextDayName} stays next`}`);
  } else if (input.other) lines.push(`${input.dayName}: picked by you${input.nextDayName === null ? '' : `; ${input.nextDayName} stays next`}`);
  else if (input.nextDayName === null) lines.push(`${input.dayName}: picked by you`);
  else if (input.nextDayName === input.dayName) lines.push(`Plan: ${input.dayName} is next`);
  else lines.push(`${input.dayName} picked by you; the plan moves on`);
  if (input.last !== null) {
    const rpe = input.last.rpe === null ? '' : ` at RPE ${formatNumber(input.last.rpe)}`;
    lines.push(`Last ${input.dayName}, ${input.last.dateText}: ${input.last.lift} ${input.last.value}${NBSP}×${NBSP}${String(input.last.reps)}${rpe}${input.mainTarget === null ? '' : ` → ${input.mainTarget}`}`);
  } else if (input.mainTarget !== null) {
    lines.push(`Top set today: ${input.mainTarget}`);
  }
  const goal = [input.goal === null ? null : `Goal: ${GOAL_WORD[input.goal]}`, input.liftTarget].filter((x): x is string => x !== null).join(' · ');
  if (goal !== '') lines.push(goal);
  if (input.missingHere != null) lines.push(`${input.missingHere}: not at this gym`);
  for (const h of input.held ?? []) lines.push(`${h}: pain flag · held`);
  lines.push(`Accessories ${input.accessories} · ${String(input.minutes)}${NBSP}min`);
  if (input.coachReason !== null) lines.push(`✦ Coach: ${input.coachReason}`);
  else if (input.review !== 'reviewed') lines.push(input.review === 'offline' ? TODAY_V2_COPY.notReviewedOffline : input.review === 'not_connected' ? TODAY_V2_COPY.notReviewedNotConnected : TODAY_V2_COPY.notReviewed);
  return lines;
}

// ---------------------------------------------------------------------------
// Mix it up line

export interface TodayMixLine {
  /** `Cable fly → Cable crossover` (no `today only` tag: D1/D3, Ben 22–23 Oct). */
  text: string;
  /** `Another (1/3)`. */
  another: string;
  /** No coach pick: least recently done (shown as not reviewed). */
  notReviewed: boolean;
  /** The coach's one-line reason for its pick (after the number check), shown under the swap; null: code's pick. */
  reason: string | null;
  accessibilityLabel: string;
}

export function todayMixLine(mix: { fromExerciseId: string; toExerciseId: string; k: number; n: number }, nameOf: (id: string) => string, coachReason: string | null = null): TodayMixLine {
  const text = `${nameOf(mix.fromExerciseId)} → ${nameOf(mix.toExerciseId)}`;
  return {
    text,
    another: TODAY_V2_COPY.another(mix.k, mix.n),
    notReviewed: coachReason === null,
    reason: coachReason,
    accessibilityLabel: `${nameOf(mix.fromExerciseId)} swapped for ${nameOf(mix.toExerciseId)}${coachReason === null ? ', not reviewed' : `. ${coachReason}`}`,
  };
}

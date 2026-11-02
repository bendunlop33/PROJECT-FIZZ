import { fmt, PB_BLOCK_COPY, weekdayDayMonth, type PbBlockView, type PlanMuscleBar } from '@fizz/domain';
import type { PlanBuilderAnswers, WeightUnit } from '@fizz/schemas';

import { PB_EFFORTS, PB_FOCUSES, PB_WEEKDAYS } from '../plan-builder/plan-builder-view';

/**
 * (Ben, 2 Nov; docs/design/plan-summary.md, prototype `plan-summary-2nov.html`) The plan summary opened from the plan
 * in Progress: `<Focus> · <N> weeks`, `Week 3 of 6 · ends Sun 13 Dec`, the week strip (done, now, deload ↓), days a
 * week · minutes · effort, each day's main lift and exercise count (done this week, `Next`), the main lifts now → the
 * plan-end estimate (est., the Gym goals table's own numbers), and planned sets per week per muscle (Plan › Muscles'
 * own bars). Formatting only: every number comes from the services. A coach-built plan (no builder answers) shows what
 * it has and hides the rest. Pure.
 */

export const PLAN_SUMMARY_COPY = {
  weeks: (n: number) => `${String(n)} weeks`,
  ends: (date: string) => `ends ${weekdayDayMonth(date)}`,
  daysWeek: 'days / week',
  min: 'min',
  effort: 'effort',
  days: 'Days',
  anyDays: 'Any days',
  setDays: 'Set days',
  exercises: (n: number) => `${String(n)} ${n === 1 ? 'exercise' : 'exercises'}`,
  next: 'Next',
  mainLifts: 'Main lifts',
  nowTo: (w: number) => `Now → week ${String(w)}`,
  est: 'est.',
  setsPerWeek: 'Sets per week',
  muscles: 'Muscles',
  edit: 'Edit',
  editPlan: 'Edit plan',
  startNext: PB_BLOCK_COPY.startNext,
  doneSaid: 'done this week',
} as const;

/** The plan in use as `services.plans.overview()` reads it (the parts the summary shows). */
export interface PlanSummaryOverview {
  planId: string;
  name: string;
  /** `Since 13 Oct`. */
  since: string;
  paused: { text: string } | null;
  days: readonly { routineId: string; name: string; state: 'done' | 'next' | 'todo'; next: boolean; dayIndex: number | null }[];
  /** Null: a coach-built plan (no weeks, no answers). */
  block?:
    | {
        views: readonly Pick<PbBlockView, 'strip' | 'days'>[];
        current: number;
        done: boolean;
        editable: boolean;
        answers: Pick<PlanBuilderAnswers, 'focus' | 'weeks' | 'effort' | 'sessions' | 'minutes' | 'schedule'>;
        startsOn: string | null;
        endsOn?: string | null | undefined;
      }
    | null
    | undefined;
}

/** What to expect (the plan builder's `expect` for the plan's own answers): each lift at the focus's reps, now and at the end. */
export interface PlanSummaryExpect {
  reps: number;
  /** Ben's unit (a lift with no kit unit reads in it). */
  unit: WeightUnit;
  rows: readonly { key: string; name: string; now: number | null; end: number | null; perHand: boolean; unit: WeightUnit | null }[];
}

export interface PlanSummaryInput {
  overview: PlanSummaryOverview;
  /** Plan › Muscles' bars for this week (`services.planMuscles.muscles()`); null: none to show. */
  muscles: readonly PlanMuscleBar[] | null;
  expect: PlanSummaryExpect | null;
}

export interface PlanSummaryWeek {
  week: number;
  label: string;
  state: 'done' | 'current' | 'todo';
  deload: boolean;
}

export interface PlanSummaryDay {
  routineId: string;
  name: string;
  /** `Bench press · 5 exercises`; null: not known (a coach plan). */
  meta: string | null;
  /** Set days: its weekday this week (`Mon`); null on Any days. */
  weekday: string | null;
  done: boolean;
  next: boolean;
  accessibilityLabel: string;
}

export interface PlanSummaryLift {
  key: string;
  name: string;
  /** `80`. */
  now: string;
  /** `85 kg × 6`, `25 kg each × 8`. */
  end: string;
  accessibilityLabel: string;
}

export interface PlanSummaryMuscle {
  bar: PlanMuscleBar;
  low: boolean;
}

export type PlanSummaryEdit = { kind: 'edit' | 'next' | 'plan'; label: string };

export interface PlanSummaryView {
  planId: string;
  title: string;
  line: string | null;
  weeks: PlanSummaryWeek[] | null;
  weeksLabel: string;
  facts: { key: string; value: string; label: string }[] | null;
  days: { meta: string | null; rows: PlanSummaryDay[] };
  lifts: { meta: string; rows: PlanSummaryLift[] } | null;
  muscles: PlanSummaryMuscle[] | null;
  edit: PlanSummaryEdit;
}

function lineOf(o: PlanSummaryOverview): string | null {
  const b = o.block;
  if (b == null) return o.since;
  if (b.done) return PB_BLOCK_COPY.done;
  const ends = o.paused === null && b.endsOn != null ? PLAN_SUMMARY_COPY.ends(b.endsOn) : null;
  const head = b.startsOn !== null ? PB_BLOCK_COPY.starts(b.startsOn) : PB_BLOCK_COPY.week(Math.min(b.current, b.answers.weeks), b.answers.weeks);
  return [head, ...(o.paused !== null ? [o.paused.text] : []), ...(ends === null ? [] : [ends])].join(' · ');
}

function weeksOf(b: NonNullable<PlanSummaryOverview['block']>): PlanSummaryWeek[] | null {
  const strip = b.views[0]?.strip ?? [];
  if (strip.length === 0) return null;
  return strip.map((c) => ({ week: c.week, label: c.deload ? `${String(c.week)} ↓` : String(c.week), state: c.state, deload: c.deload }));
}

function weeksSaid(weeks: readonly PlanSummaryWeek[] | null): string {
  if (weeks === null) return '';
  return weeks.map((w) => [`Week ${String(w.week)}`, ...(w.state === 'done' ? ['done'] : w.state === 'current' ? ['now'] : []), ...(w.deload ? ['deload'] : [])].join(' ')).join(', ');
}

function daysOf(o: PlanSummaryOverview): PlanSummaryDay[] {
  const b = o.block ?? null;
  const week = b === null ? null : (b.views[Math.max(0, Math.min(b.views.length, b.current) - 1)] ?? null);
  const setDays = b?.answers.schedule === 'set';
  const seen = new Set<string>();
  return o.days.flatMap((d) => {
    if (seen.has(d.routineId)) return [];
    seen.add(d.routineId);
    const day = week === null || d.dayIndex === null ? null : (week.days.find((x) => x.index === d.dayIndex) ?? null);
    const main = day?.rows.find((r) => r.main) ?? null;
    const meta = day === null || day.rows.length === 0 ? null : [...(main === null ? [] : [main.name]), PLAN_SUMMARY_COPY.exercises(day.rows.length)].join(' · ');
    const weekday = setDays && day !== null && day.weekday !== null ? (PB_WEEKDAYS[day.weekday] ?? null) : null;
    const done = d.state === 'done';
    const next = d.next && o.paused === null;
    const said = [d.name, ...(weekday === null ? [] : [weekday]), ...(meta === null ? [] : [meta]), ...(done ? [PLAN_SUMMARY_COPY.doneSaid] : []), ...(next ? [PLAN_SUMMARY_COPY.next] : [])];
    return [{ routineId: d.routineId, name: d.name, meta, weekday, done, next, accessibilityLabel: said.join(', ') }];
  });
}

function liftsOf(e: PlanSummaryExpect | null, weeks: number | null): PlanSummaryView['lifts'] {
  if (e === null || weeks === null) return null;
  const rows = e.rows.flatMap((r): PlanSummaryLift[] => {
    if (r.now === null && r.end === null) return [];
    const unit = r.unit ?? e.unit;
    const v = (n: number | null) => (n === null ? '—' : fmt(n));
    const end = `${v(r.end)} ${unit}${r.perHand ? ' each' : ''} × ${String(e.reps)}`;
    return [{ key: r.key, name: r.name, now: v(r.now), end, accessibilityLabel: `${r.name}, now ${v(r.now)}, week ${String(weeks)} ${end}, ${PLAN_SUMMARY_COPY.est}` }];
  });
  return rows.length === 0 ? null : { meta: PLAN_SUMMARY_COPY.nowTo(weeks), rows };
}

function editOf(b: PlanSummaryOverview['block']): PlanSummaryEdit {
  if (b == null) return { kind: 'plan', label: PLAN_SUMMARY_COPY.editPlan };
  if (b.done) return { kind: 'next', label: PLAN_SUMMARY_COPY.startNext };
  return b.editable ? { kind: 'edit', label: PLAN_SUMMARY_COPY.editPlan } : { kind: 'plan', label: PLAN_SUMMARY_COPY.editPlan };
}

export function planSummaryView(input: PlanSummaryInput): PlanSummaryView {
  const o = input.overview;
  const b = o.block ?? null;
  const a = b?.answers ?? null;
  const weeks = b === null ? null : weeksOf(b);
  const focus = a === null ? null : (PB_FOCUSES.find((f) => f.key === a.focus)?.label ?? null);
  const effort = a === null ? null : (PB_EFFORTS.find((x) => x.key === a.effort)?.label ?? null);
  return {
    planId: o.planId,
    title: a === null || focus === null ? o.name : `${focus} · ${PLAN_SUMMARY_COPY.weeks(a.weeks)}`,
    line: lineOf(o),
    weeks,
    weeksLabel: weeksSaid(weeks),
    facts:
      a === null
        ? null
        : [
            { key: 'days', value: String(a.sessions), label: PLAN_SUMMARY_COPY.daysWeek },
            { key: 'min', value: `~${String(a.minutes)}`, label: PLAN_SUMMARY_COPY.min },
            ...(effort === null ? [] : [{ key: 'effort', value: effort, label: PLAN_SUMMARY_COPY.effort }]),
          ],
    days: { meta: a === null ? null : a.schedule === 'set' ? PLAN_SUMMARY_COPY.setDays : PLAN_SUMMARY_COPY.anyDays, rows: daysOf(o) },
    lifts: liftsOf(input.expect, a?.weeks ?? null),
    muscles: input.muscles === null || input.muscles.length === 0 ? null : input.muscles.map((bar) => ({ bar, low: bar.status === 'below' })),
    edit: editOf(b),
  };
}

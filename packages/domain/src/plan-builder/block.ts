import { supersetLabels } from '../superset-labels';
import { PLAN_LIMITS } from '@fizz/schemas';
import type { DraftSlot, PlanBuilderAnswers, PlanBuilderRecord, PlanDraft, PlanDraftVersion, PlanPause, SessionDeload } from '@fizz/schemas';
import { addDays, localDateOf, localWeekBounds } from '../calendar';
import { pausedInWeek } from '../progress/plan-tracker';
import { weekdayDayMonth, weekdayDayMonthLong } from '../progress/text';
import { activePause, pausedDates } from '../session/plan-adapt';
import { deriveId } from '../stable';
import { toMs } from '../time';
import type { PbExercise, PbLoad } from './engine';
import { fmt, type PlanKit } from './loads';
import { pbAtWeek, pbIsDeload, type PbWeekTarget } from './weeks';

/**
 * A builder plan's training block (Ben, 23 Oct: **the plan's length is block 1**; training-blocks.md §4.1). Pure.
 *
 * - `pbBlockWeekOf`: the block week now, derived (never stored) from the plan's Apply, its pauses and Ben's finished
 *   workouts of the plan: weeks run Monday–Sunday in his zone; week 1 is the week the plan was applied when that was
 *   its Monday. (Ben, 28 Oct) Applied on any other day, that week is a **lead-in**: it runs week 1's days and its
 *   workouts count for that week (its plan workouts from that Monday count, 28 Oct), but week 1 of the block starts the
 *   next Monday, so the plan's weeks (and its deload) are full weeks after it (training-blocks.md §4.1). Derived from
 *   the stored Apply time, so a plan already in its first week becomes a lead-in with no migration. A calendar week
 *   counts once it has a finished plan workout and isn't fully paused, else the number holds (nothing is "missed",
 *   D19). A correction or a deleted workout re-derives it. Past the plan's length the block is done.
 * - `pbBlockView`: Library › Plan › Your plan's week strip (1…N, D on deload weeks) and the plan days for the week
 *   viewed, each exercise's planned target that week from `pbAtWeek` (snapped to the item's achievable loads, never
 *   past its max, rule 4). Done weeks are read-only and say which days were done. These are planned targets: Today
 *   still plans from what Ben lifted (training-blocks Q1); the deload week drafts lighter (`deloadDraft`).
 */

export const PB_BLOCK_COPY = {
  week: (w: number, n: number) => `Week ${String(w)} of ${String(n)}`,
  /** (Ben, 28 Oct) The lead-in week: `Starts Mon 2 Nov` (Today reads `Plan starts Mon 2 Nov`). */
  starts: (date: string) => `Starts ${weekdayDayMonth(date)}`,
  deload: 'Deload',
  done: 'Block done',
  startNext: 'Start next block',
  deloadNote: 'Deload: lighter, fewer sets',
  dayDone: '✓ Done',
  weekLabel: 'Week',
} as const;

/** A plan workout as the block counts it: when it started and, when known, which plan day it was. */
export interface PbBlockWorkout {
  startedAtUtc: string;
  dayIndex: number | null;
  /** (28 Oct) Named for variants it doesn't tell apart (Pull A / Pull B): their day indexes in plan order; it is the first not done that week. */
  dayIndexes?: readonly number[] | undefined;
}

export interface PbBlockInput {
  answers: Pick<PlanBuilderAnswers, 'weeks' | 'effort'>;
  appliedAtUtc: string;
  pauses?: readonly PlanPause[] | undefined;
  /** The plan's finished workouts (any order; ones before Apply or after now are ignored). */
  workouts: readonly PbBlockWorkout[];
  nowMs: number;
  tz: string;
}

export interface PbBlockWeek {
  /** The block week now, 1-based; `of + 1` once the block is done. */
  week: number;
  of: number;
  /** This week is a deload week (never once done). */
  deload: boolean;
  done: boolean;
  /** Each block week's local Monday so far, week 1 first; the current week's last (while not done). */
  mondays: string[];
  /** Plan day indexes done in each block week of `mondays` (same order). */
  daysDone: number[][];
  /** (27 Oct) The local date each of those days was first done that week (same order); absent: not known. */
  doneOn?: Record<number, string>[];
  /**
   * (Ben, 28 Oct) This week is the lead-in of a plan applied after its Monday: `week` is 1 (the lead-in runs week 1's
   * days, and its workouts count for this week) and week 1 itself starts on `startsOn` (the next Monday). Absent: not
   * a lead-in.
   */
  leadIn?: { startsOn: string } | undefined;
}

/** Calendar weeks looked at, at most (12-week plans with pauses and gaps fit easily). */
const MAX_WEEKS = 260;

export function pbBlockWeekOf(input: PbBlockInput): PbBlockWeek {
  const of = input.answers.weeks;
  const appliedMs = toMs(input.appliedAtUtc);
  const applyMonday = localWeekBounds(appliedMs, input.tz).mondayLocalDate;
  // (Ben, 28 Oct) Applied after its Monday: that week is a lead-in, and the block's weeks start the next Monday.
  const leadIn = localDateOf(appliedMs, input.tz) !== applyMonday;
  const startMonday = leadIn ? addDays(applyMonday, 7) : applyMonday;
  const nowMonday = localWeekBounds(input.nowMs, input.tz).mondayLocalDate;
  const byMonday = new Map<string, Set<number>>();
  const firstOn = new Map<string, Record<number, string>>();
  // (Ben, 28 Oct) The plan's first week counts from its Monday: a workout of that week before Apply that is a plan
  // day's (linked by name or lifts) counts too. A workout counts in its own calendar week only.
  const startMs = localWeekBounds(appliedMs, input.tz).startMs;
  // Workouts of one day first, then ones named for variants: each takes the first of its variants not done that week.
  const ordered = [...input.workouts].sort((a, b) => Number((a.dayIndexes?.length ?? 0) > 0) - Number((b.dayIndexes?.length ?? 0) > 0) || toMs(a.startedAtUtc) - toMs(b.startedAtUtc));
  for (const w of ordered) {
    const ms = toMs(w.startedAtUtc);
    if (ms < startMs || ms > input.nowMs) continue;
    const m = localWeekBounds(ms, input.tz).mondayLocalDate;
    const days = byMonday.get(m) ?? new Set<number>();
    const dayIndex = w.dayIndexes !== undefined && w.dayIndexes.length > 0 ? (w.dayIndexes.find((i) => !days.has(i)) ?? null) : w.dayIndex;
    if (dayIndex !== null) {
      days.add(dayIndex);
      const on = firstOn.get(m) ?? {};
      const date = localDateOf(ms, input.tz);
      const was = on[dayIndex];
      if (was === undefined || date < was) on[dayIndex] = date;
      firstOn.set(m, on);
    }
    byMonday.set(m, days);
  }
  const counted: string[] = [];
  let m = startMonday;
  for (let i = 0; i < MAX_WEEKS && m < nowMonday; i += 1, m = addDays(m, 7)) {
    if (!byMonday.has(m)) continue;
    if (pausedInWeek(m, pausedDates(input.pauses, m, addDays(m, 7), input.tz)) >= 7) continue;
    counted.push(m);
  }
  const done = counted.length >= of;
  const mondays = done ? counted.slice(0, of) : [...counted, nowMonday];
  const week = done ? of + 1 : counted.length + 1;
  const daysOf = (monday: string): number[] => [...(byMonday.get(monday) ?? [])].sort((a, b) => a - b);
  const inLeadIn = leadIn && nowMonday < startMonday;
  return {
    week,
    of,
    deload: !done && !inLeadIn && pbIsDeload(input.answers, week),
    done,
    mondays,
    daysDone: mondays.map(daysOf),
    doneOn: mondays.map((x) => ({ ...(firstOn.get(x) ?? {}) })),
    ...(inLeadIn ? { leadIn: { startsOn: startMonday } } : {}),
  };
}

/** The builder record of the plan version in use (Apply's), else null (a coach plan, or not applied). */
export function pbAppliedBuilder(plan: Pick<PlanDraft, 'status' | 'versions' | 'currentVersion' | 'applied'> | null): { version: PlanDraftVersion; builder: PlanBuilderRecord } | null {
  if (plan?.status !== 'applied' || plan.applied === null) return null;
  // (Ben, 26 Oct: Edit plan) An edit's newest version carries the plan's answers (length, effort); without edits the
  // current version is the applied one. Each week's days: `pbWeekDaysOf`.
  const version = plan.versions.find((v) => v.n === plan.currentVersion) ?? plan.versions.find((v) => v.n === plan.applied?.versionN);
  const builder = version?.builder;
  return version === undefined || builder === undefined ? null : { version, builder };
}

/**
 * (Ben, 23 Oct) `Set up a plan` always starts a new plan at its first step; the starting selections are his last
 * builder plan's answers: the applied one (as applied), else the most recently written builder plan of any status.
 * Null: no builder plan yet (the ✦ answers).
 */
export function pbStartingAnswers(plans: readonly Pick<PlanDraft, 'status' | 'versions' | 'currentVersion' | 'applied' | 'updatedAtUtc'>[]): PlanBuilderAnswers | null {
  for (const p of plans) {
    const a = pbAppliedBuilder(p);
    if (a !== null) return a.builder.answers;
  }
  const built = plans
    .filter((p) => p.versions.find((v) => v.n === p.currentVersion)?.builder !== undefined)
    .sort((a, b) => toMs(b.updatedAtUtc) - toMs(a.updatedAtUtc))[0];
  return built?.versions.find((v) => v.n === built.currentVersion)?.builder?.answers ?? null;
}

/** A finished workout as the block reads it (a `FinishedRef`). */
export interface PbFinishedRef {
  routineId: string | null;
  startedAtUtc: string;
  planDay?: { planId: string; dayIndex: number } | undefined;
  /** (28 Oct) Linked by name to variants it doesn't tell apart (`linkRefs`): their templates in plan order. */
  variantRoutineIds?: readonly string[] | undefined;
}

/**
 * The applied builder plan's block now; null without one (no plan, a coach plan, ended). Its workouts are the ones
 * started as one of its days (`planDay`), or from a workout its Apply made.
 */
export function pbBlockOfPlan(plan: Pick<PlanDraft, 'id' | 'status' | 'versions' | 'currentVersion' | 'applied' | 'pauses'> | null, refs: readonly PbFinishedRef[], nowMs: number, tz: string): PbBlockWeek | null {
  const b = pbAppliedBuilder(plan);
  if (plan === null || plan.applied === null || b === null) return null;
  // (Ben, 30 Oct) A block continued across plan documents (`applied.block`): the earlier documents' workouts count too.
  const earlier = plan.applied.block?.plans ?? [];
  const made = new Map([...earlier.flatMap((p) => p.made), ...plan.applied.made].map((x) => [x.routineId, x.dayIndex] as const));
  const planIds = new Set([plan.id, ...earlier.map((p) => p.planId)]);
  const workouts: PbBlockWorkout[] = refs.flatMap((r) => {
    if (r.planDay !== undefined && planIds.has(r.planDay.planId)) return [{ startedAtUtc: r.startedAtUtc, dayIndex: r.planDay.dayIndex }];
    const day = r.routineId === null ? undefined : made.get(r.routineId);
    const variants = (r.variantRoutineIds ?? []).flatMap((id) => {
      const i = made.get(id);
      return i === undefined ? [] : [i];
    });
    return day === undefined ? [] : [{ startedAtUtc: r.startedAtUtc, dayIndex: day, ...(variants.length > 1 ? { dayIndexes: variants } : {}) }];
  });
  return pbBlockWeekOf({ answers: b.builder.answers, appliedAtUtc: pbBlockStartUtc(plan) ?? plan.applied.atUtc, pauses: plan.pauses, workouts, nowMs, tz });
}

/**
 * (Ben, 30 Oct: edits never restart the block) When the plan's block started: its first Apply. A re-apply that
 * continued the block (`applied.block`) keeps the block's start; else this Apply's time. Null: not applied.
 */
export function pbBlockStartUtc(plan: Pick<PlanDraft, 'applied'> | null): string | null {
  if (plan?.applied == null) return null;
  return plan.applied.block?.startedAtUtc ?? plan.applied.atUtc;
}

/**
 * (Ben, 30 Oct) Whether `next`'s Apply at `atUtc`, superseding `prior` (the builder plan in use), continues `prior`'s
 * block, and if so the block it continues. Only a genuinely new plan restarts: a copy from `Start again`
 * (`restartedFrom`), or a block that may be finished (`Start next block`). A block can only be finished once as many
 * whole weeks as its length have passed since it started, so an Apply before then always continues it. Null: a new
 * block (a coach plan on either side, or the block may be done). Pure.
 */
export function pbContinuedBlock(
  next: Pick<PlanDraft, 'versions' | 'currentVersion' | 'restartedFrom'>,
  prior: Pick<PlanDraft, 'id' | 'status' | 'versions' | 'currentVersion' | 'applied'>,
  atUtc: string,
  tz: string,
): NonNullable<NonNullable<PlanDraft['applied']>['block']> | null {
  if (next.restartedFrom != null) return null;
  if (next.versions.find((v) => v.n === next.currentVersion)?.builder === undefined) return null;
  const pb = pbAppliedBuilder(prior);
  const start = pbBlockStartUtc(prior);
  if (pb === null || start === null || prior.applied === null) return null;
  const startMs = toMs(start);
  const applyMonday = localWeekBounds(startMs, tz).mondayLocalDate;
  const startMonday = localDateOf(startMs, tz) === applyMonday ? applyMonday : addDays(applyMonday, 7);
  const atMonday = localWeekBounds(toMs(atUtc), tz).mondayLocalDate;
  if (atMonday >= addDays(startMonday, 7 * pb.builder.answers.weeks)) return null;
  const plans = [...(prior.applied.block?.plans ?? []), { planId: prior.id, made: prior.applied.made.map((m) => ({ dayIndex: m.dayIndex, routineId: m.routineId })) }];
  return { startedAtUtc: start, plans: plans.slice(-8) };
}

/**
 * (PM, 23 Oct) What a workout started now is stamped with (`WorkoutSession.deload`): the applied builder plan's block
 * when this is its deload week and the plan isn't paused today, else null. The same derivation Today's header and the
 * deload draft use, read once at Start, so the mark never moves when the plan or history changes later.
 */
export function pbDeloadAtStart(
  plan: Pick<PlanDraft, 'id' | 'status' | 'versions' | 'currentVersion' | 'applied' | 'pauses'> | null,
  refs: readonly PbFinishedRef[],
  nowMs: number,
  tz: string,
): SessionDeload | null {
  if (plan === null || activePause(plan, nowMs, tz) !== null) return null;
  const b = pbBlockOfPlan(plan, refs, nowMs, tz);
  return b === null || !b.deload ? null : { planId: plan.id, week: b.week, of: b.of };
}

/**
 * (Ben, 28 Oct) The week a move made now belongs to (`PlanDayMove.week`): 0 in the lead-in, so a day moved then
 * never moves in week 1 too; else the block week.
 */
export function pbMoveWeek(b: Pick<PbBlockWeek, 'week' | 'leadIn'>): number {
  return b.leadIn !== undefined ? 0 : b.week;
}

/** Today's header text: `Week 3 of 6`, `Week 6 of 6 · Deload`, `Block done`, `Starts Mon 2 Nov` (the lead-in); with what VoiceOver reads. */
export function pbBlockLine(b: PbBlockWeek): { text: string; accessibilityLabel: string; deload: boolean; done: boolean } {
  if (b.done) return { text: PB_BLOCK_COPY.done, accessibilityLabel: 'Training block done', deload: false, done: true };
  if (b.leadIn !== undefined) return { text: PB_BLOCK_COPY.starts(b.leadIn.startsOn), accessibilityLabel: `Lead-in week. Training block starts ${weekdayDayMonthLong(b.leadIn.startsOn)}`, deload: false, done: false };
  const week = PB_BLOCK_COPY.week(b.week, b.of);
  return b.deload
    ? { text: `${week} · ${PB_BLOCK_COPY.deload}`, accessibilityLabel: `Training block, week ${String(b.week)} of ${String(b.of)}, deload`, deload: true, done: false }
    : { text: week, accessibilityLabel: `Training block, week ${String(b.week)} of ${String(b.of)}`, deload: false, done: false };
}

// ---------------------------------------------------------------------------
// A stored plan slot as the engine's exercise (for `pbAtWeek`)

const workingTemplates = (s: Pick<DraftSlot, 'setTemplates'>) => s.setTemplates.filter((t) => t.setType !== 'warmup');

/**
 * A stored plan slot as the engine's exercise (its week-1 plan): main lifts from their top and back-off templates,
 * bodyweight mains and accessories from their working sets and reps. `startReps`: the accessory's week-1 reps (the
 * slot keeps only its range). The week-1 line it gives is the one the builder showed.
 */
export function pbExerciseOfSlot(slot: DraftSlot, kit: PlanKit | null, startReps?: number): PbExercise {
  const work = workingTemplates(slot);
  const top = slot.setTemplates.find((t) => t.setType === 'top');
  const backs = slot.setTemplates.filter((t) => t.setType === 'backoff');
  const first = work[0];
  const loadOf = (l: DraftSlot['setTemplates'][number]['load']): PbLoad => {
    const v = l?.load ?? null;
    // (27 Oct) A workout-only exercise (`pbDayAsWorkout`) names its convention: bodyweight only when it is.
    if (v === null) return slot.checkedOn == null && (slot.builder === undefined || slot.builder.convention === 'bodyweight') ? { kind: 'bodyweight' } : { kind: 'none' };
    return { kind: 'kg', value: v.value, unit: v.unit, convention: v.convention, equipmentId: kit?.equipmentId ?? slot.checkedOn?.equipmentId ?? 'none' };
  };
  const base = { key: slot.catalogueId, muscle: 'Chest' as const, tags: [], pair: null, why: '', estimate: (top?.load ?? first?.load)?.estimate === true };
  if (slot.main && top !== undefined) {
    const topLoad = top.load?.load?.value ?? null;
    const backLoad = backs[0]?.load?.load?.value ?? null;
    return {
      ...base,
      role: 'main',
      sets: 1 + backs.length,
      reps: top.reps?.min ?? 6,
      load: loadOf(top.load),
      bodyweightMain: false,
      main: { top: topLoad, back: backLoad, reps: top.reps?.min ?? 6, backs: backs.length, backReps: backs[0]?.reps?.min ?? 8, estimate: base.estimate, light: false, start: null, warmup: [] },
    };
  }
  const reps = startReps ?? first?.reps?.min ?? 10;
  return { ...base, role: slot.main ? 'main' : 'i', sets: Math.max(1, work.length), reps, load: loadOf(first?.load), bodyweightMain: slot.main, main: null };
}

// ---------------------------------------------------------------------------
// Your plan: the week strip and the week's days

export interface PbBlockRow {
  key: string;
  exerciseId: string;
  name: string;
  main: boolean;
  /** Main lift: `1 × 6 + 2 × 8 · 102.5 / 95`; others: `3 × 10`. */
  line: string;
  /** Others: `30`, `24 each`, `BW`, `—`; main lifts with a load: null (in the line). */
  kg: string | null;
  est: boolean;
  /** (Ben, 27 Oct) Its superset label (`A1`, `A2`); null: on its own. */
  superset: string | null;
}

export interface PbBlockDay {
  index: number;
  name: string;
  /** (26 Oct) Set days plans: its weekday that week (Mon = 0, a `Move day` applied); null on Any days. */
  weekday: number | null;
  /** Done in the week viewed (done or current week). */
  done: boolean;
  /** (27 Oct) The local date it was first done in the week viewed (`YYYY-MM-DD`); null: not done, or not known. */
  doneOn: string | null;
  rows: PbBlockRow[];
}

export interface PbBlockStripCell {
  week: number;
  deload: boolean;
  state: 'done' | 'current' | 'todo';
  selected: boolean;
  accessibilityLabel: string;
}

export interface PbBlockView {
  /** `Week 3 of 6`, `Week 6 of 6 · Deload`, `Block done`. */
  header: string;
  done: boolean;
  /** The week shown (1…N). */
  viewed: number;
  /** The week shown is done: nothing on it can change (rule 2). */
  readOnly: boolean;
  /** `Deload: lighter, fewer sets` on a deload week, else null. */
  note: string | null;
  strip: PbBlockStripCell[];
  days: PbBlockDay[];
  /** The plan's deload weeks (Standard: the last; Push: every 4th; Maintain: none). */
  deloadWeeks: number[];
}

export interface PbBlockViewInput {
  version: Pick<PlanDraftVersion, 'days'>;
  builder: Pick<PlanBuilderRecord, 'answers' | 'startReps'>;
  block: PbBlockWeek;
  /** The week asked for; null: the current one (the last week once done). */
  viewed: number | null;
  /** The slot's item at Ben's gyms as achievable loads, else null (bodyweight, or the item is gone). */
  kitOf: (slot: DraftSlot) => PlanKit | null;
  /** The exercise's display name (catalogue or Ben's own). */
  nameOf: (exerciseId: string) => string;
  /** (Ben, 26 Oct: Edit plan) Each week's own days (a running plan's edits); absent: `version` every week. */
  weekOf?: ((w: number) => { days: PlanDraftVersion['days']; startReps?: Record<string, number> | undefined }) | undefined;
  /** (26 Oct) Set days plans: each day's weekday in week `w`; null on Any days. */
  weekdaysOf?: ((w: number, dayIndexes: readonly number[]) => ReadonlyMap<number, number> | null) | undefined;
}

function rowOf(slot: DraftSlot, t: PbWeekTarget, kit: PlanKit | null, e: PbExercise, name: string, superset: string | null = null): PbBlockRow {
  const perHand = kit?.convention === 'per_hand' || (e.load.kind === 'kg' && e.load.convention === 'per_hand');
  const loadedMain = e.role === 'main' && e.main !== null;
  const kg = loadedMain ? null : e.load.kind === 'bodyweight' ? 'BW' : t.load === null ? '—' : `${fmt(t.load)}${perHand ? ' each' : ''}`;
  return { key: slot.slotKey, exerciseId: slot.exerciseId, name, main: slot.main, line: t.line, kg, est: e.estimate, superset };
}

/** (Ben, 27 Oct) Superset labels for a day's slots in order (`A1`, `A2`; null on its own). */
export const pbSupersetLabels = supersetLabels;

export function pbBlockView(input: PbBlockViewInput): PbBlockView {
  const { block, builder } = input;
  const a = builder.answers;
  const n = a.weeks;
  const current = Math.min(block.week, n);
  const viewed = Math.max(1, Math.min(n, input.viewed ?? current));
  const doneWeek = (w: number) => block.done || w < block.week;
  const strip = Array.from({ length: n }, (_, i): PbBlockStripCell => {
    const w = i + 1;
    const dl = pbIsDeload(a, w);
    const state = doneWeek(w) ? 'done' : w === block.week ? 'current' : 'todo';
    const said = [`Week ${String(w)}`, ...(state === 'done' ? ['done'] : state === 'current' ? ['current'] : []), ...(dl ? ['deload'] : [])];
    return { week: w, deload: dl, state, selected: w === viewed, accessibilityLabel: said.join(', ') };
  });
  const daysDone = new Set(block.daysDone[viewed - 1] ?? []);
  const doneOn = block.doneOn?.[viewed - 1] ?? {};
  const week = input.weekOf?.(viewed) ?? { days: input.version.days, startReps: builder.startReps };
  const weekdays = input.weekdaysOf?.(viewed, week.days.map((d) => d.index)) ?? null;
  const days = week.days.map((d): PbBlockDay => {
    const sorted = [...d.plan.slots].sort((x, y) => x.order - y.order);
    const labels = pbSupersetLabels(sorted);
    const rows = sorted.map((slot, i) => {
      const kit = input.kitOf(slot);
      const e = pbExerciseOfSlot(slot, kit, week.startReps?.[slot.slotKey] ?? builder.startReps?.[slot.slotKey]);
      return rowOf(slot, pbAtWeek(a, e, kit, viewed), kit, e, input.nameOf(slot.exerciseId), labels[i] ?? null);
    });
    const done = viewed <= block.mondays.length && daysDone.has(d.index);
    return { index: d.index, name: d.name, weekday: weekdays?.get(d.index) ?? null, done, doneOn: done ? (doneOn[d.index] ?? null) : null, rows };
  });
  return {
    header: pbBlockLine(block).text,
    done: block.done,
    viewed,
    readOnly: doneWeek(viewed),
    note: pbIsDeload(a, viewed) ? PB_BLOCK_COPY.deloadNote : null,
    strip,
    days,
    deloadWeeks: strip.filter((c) => c.deload).map((c) => c.week),
  };
}

/** Every week's view (1…N), for a strip that switches weeks without another read. */
export function pbBlockViews(input: Omit<PbBlockViewInput, 'viewed'>): PbBlockView[] {
  return Array.from({ length: input.builder.answers.weeks }, (_, i) => pbBlockView({ ...input, viewed: i + 1 }));
}

/**
 * (Ben, 30 Oct) A plan in use that was applied over a builder plan whose block was running (a re-apply before
 * 30 Oct made a new plan document) gets back its block's start: derived from the plans it superseded (each one's own
 * block first, so a chain of re-applies goes back to the block's first Apply), stamped once as `applied.block`.
 * `plans`: Ben's plans (any status). Nothing to do: null (no earlier plan, already stamped, or a new block). Pure; the
 * op ID is derived, so a second open writes nothing.
 */
export function pbKeepBlockOf(current: PlanDraft, plans: readonly PlanDraft[], tz: string, atUtc: string): { next: PlanDraft; expectedVersion: number; opId: string } | null {
  if (current.status !== 'applied' || current.applied === null || current.applied.block !== undefined) return null;
  const byId = new Map(plans.map((p) => [p.id, p] as const));
  const blockOf = (p: PlanDraft, depth: number): PlanDraft => {
    if (p.applied === null || p.applied.block !== undefined || depth >= 8) return p;
    for (const s of p.applied.superseded ?? []) {
      const prior = byId.get(s.planId);
      if (prior?.status !== 'superseded' || prior.supersededBy?.planId !== p.id || prior.applied === null) continue;
      // The prior plan as it was when this Apply ended it: in use, with its own block derived first.
      const was = blockOf({ ...prior, status: 'applied' }, depth + 1);
      const b = pbContinuedBlock(p, was, p.applied.atUtc, tz);
      if (b !== null) return { ...p, applied: { ...p.applied, block: b } };
    }
    return p;
  };
  const kept = blockOf(current, 0);
  const block = kept.applied?.block;
  if (block === undefined) return null;
  const opId = deriveId(`plan-block-keep:${current.id}:${current.applied.opId}`);
  if (current.opIds.includes(opId)) return null;
  return {
    next: { ...current, applied: { ...current.applied, block }, opIds: [...current.opIds, opId].slice(-PLAN_LIMITS.maxOps), version: current.version + 1, updatedAtUtc: atUtc },
    expectedVersion: current.version,
    opId,
  };
}

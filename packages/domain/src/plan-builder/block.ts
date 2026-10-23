import type { DraftSlot, PlanBuilderAnswers, PlanBuilderRecord, PlanDraft, PlanDraftVersion, PlanPause, SessionDeload } from '@fizz/schemas';
import { addDays, localWeekBounds } from '../calendar';
import { pausedInWeek } from '../progress/plan-tracker';
import { activePause, pausedDates } from '../session/plan-adapt';
import { toMs } from '../time';
import type { PbExercise, PbLoad } from './engine';
import { fmt, type PlanKit } from './loads';
import { pbAtWeek, pbIsDeload, type PbWeekTarget } from './weeks';

/**
 * A builder plan's training block (Ben, 23 Oct: **the plan's length is block 1**; training-blocks.md §4.1). Pure.
 *
 * - `pbBlockWeekOf`: the block week now, derived (never stored) from the plan's Apply, its pauses and Ben's finished
 *   workouts of the plan: weeks run Monday–Sunday in his zone; week 1 is the week the plan was applied; a calendar
 *   week counts once it has a finished plan workout and isn't fully paused, else the number holds (nothing is
 *   "missed", D19). A correction or a deleted workout re-derives it. Past the plan's length the block is done.
 * - `pbBlockView`: Library › Plan › Your plan's week strip (1…N, D on deload weeks) and the plan days for the week
 *   viewed, each exercise's planned target that week from `pbAtWeek` (snapped to the item's achievable loads, never
 *   past its max, rule 4). Done weeks are read-only and say which days were done. These are planned targets: Today
 *   still plans from what Ben lifted (training-blocks Q1); the deload week drafts lighter (`deloadDraft`).
 */

export const PB_BLOCK_COPY = {
  week: (w: number, n: number) => `Week ${String(w)} of ${String(n)}`,
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
}

/** Calendar weeks looked at, at most (12-week plans with pauses and gaps fit easily). */
const MAX_WEEKS = 260;

export function pbBlockWeekOf(input: PbBlockInput): PbBlockWeek {
  const of = input.answers.weeks;
  const appliedMs = toMs(input.appliedAtUtc);
  const startMonday = localWeekBounds(appliedMs, input.tz).mondayLocalDate;
  const nowMonday = localWeekBounds(input.nowMs, input.tz).mondayLocalDate;
  const byMonday = new Map<string, Set<number>>();
  for (const w of input.workouts) {
    const ms = toMs(w.startedAtUtc);
    if (ms < appliedMs || ms > input.nowMs) continue;
    const m = localWeekBounds(ms, input.tz).mondayLocalDate;
    const days = byMonday.get(m) ?? new Set<number>();
    if (w.dayIndex !== null) days.add(w.dayIndex);
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
  return { week, of, deload: !done && pbIsDeload(input.answers, week), done, mondays, daysDone: mondays.map(daysOf) };
}

/** The builder record of the plan version in use (Apply's), else null (a coach plan, or not applied). */
export function pbAppliedBuilder(plan: Pick<PlanDraft, 'status' | 'versions' | 'currentVersion' | 'applied'> | null): { version: PlanDraftVersion; builder: PlanBuilderRecord } | null {
  if (plan?.status !== 'applied' || plan.applied === null) return null;
  const n = plan.applied.versionN;
  const version = plan.versions.find((v) => v.n === n) ?? plan.versions.find((v) => v.n === plan.currentVersion);
  const builder = version?.builder;
  return version === undefined || builder === undefined ? null : { version, builder };
}

/** A finished workout as the block reads it (a `FinishedRef`). */
export interface PbFinishedRef {
  routineId: string | null;
  startedAtUtc: string;
  planDay?: { planId: string; dayIndex: number } | undefined;
}

/**
 * The applied builder plan's block now; null without one (no plan, a coach plan, ended). Its workouts are the ones
 * started as one of its days (`planDay`), or from a workout its Apply made.
 */
export function pbBlockOfPlan(plan: Pick<PlanDraft, 'id' | 'status' | 'versions' | 'currentVersion' | 'applied' | 'pauses'> | null, refs: readonly PbFinishedRef[], nowMs: number, tz: string): PbBlockWeek | null {
  const b = pbAppliedBuilder(plan);
  if (plan === null || plan.applied === null || b === null) return null;
  const made = new Map(plan.applied.made.map((x) => [x.routineId, x.dayIndex] as const));
  const workouts: PbBlockWorkout[] = refs.flatMap((r) => {
    if (r.planDay !== undefined && r.planDay.planId === plan.id) return [{ startedAtUtc: r.startedAtUtc, dayIndex: r.planDay.dayIndex }];
    const day = r.routineId === null ? undefined : made.get(r.routineId);
    return day === undefined ? [] : [{ startedAtUtc: r.startedAtUtc, dayIndex: day }];
  });
  return pbBlockWeekOf({ answers: b.builder.answers, appliedAtUtc: plan.applied.atUtc, pauses: plan.pauses, workouts, nowMs, tz });
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

/** Today's header text: `Week 3 of 6`, `Week 6 of 6 · Deload`, `Block done`; with what VoiceOver reads. */
export function pbBlockLine(b: PbBlockWeek): { text: string; accessibilityLabel: string; deload: boolean; done: boolean } {
  if (b.done) return { text: PB_BLOCK_COPY.done, accessibilityLabel: 'Training block done', deload: false, done: true };
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
    if (v === null) return slot.checkedOn == null ? { kind: 'bodyweight' } : { kind: 'none' };
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
}

export interface PbBlockDay {
  index: number;
  name: string;
  /** Done in the week viewed (done or current week). */
  done: boolean;
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
}

function rowOf(slot: DraftSlot, t: PbWeekTarget, kit: PlanKit | null, e: PbExercise, name: string): PbBlockRow {
  const perHand = kit?.convention === 'per_hand' || (e.load.kind === 'kg' && e.load.convention === 'per_hand');
  const loadedMain = e.role === 'main' && e.main !== null;
  const kg = loadedMain ? null : e.load.kind === 'bodyweight' ? 'BW' : t.load === null ? '—' : `${fmt(t.load)}${perHand ? ' each' : ''}`;
  return { key: slot.slotKey, exerciseId: slot.exerciseId, name, main: slot.main, line: t.line, kg, est: e.estimate };
}

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
  const days = input.version.days.map((d): PbBlockDay => {
    const rows = [...d.plan.slots]
      .sort((x, y) => x.order - y.order)
      .map((slot) => {
        const kit = input.kitOf(slot);
        const e = pbExerciseOfSlot(slot, kit, builder.startReps?.[slot.slotKey]);
        return rowOf(slot, pbAtWeek(a, e, kit, viewed), kit, e, input.nameOf(slot.exerciseId));
      });
    return { index: d.index, name: d.name, done: viewed <= block.mondays.length && daysDone.has(d.index), rows };
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

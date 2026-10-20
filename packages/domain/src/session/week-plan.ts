import type { Activity, Exercise, ProposeWeekArgs, RoutineExercise, Routine, SplitBodyPart, UserProfile, WeekBasis, WeekMerge, WeekPlan, WeekRow, WeekSkip, ZonedTimestamp } from '@fizz/schemas';

import { activitiesBetween, isLegDay, isLegRun, dateWeekdayShort } from '../activity';
import { addDays, localWeekBounds } from '../calendar';
import { deriveId } from '../stable';
import { estimateRemainingDuration, roundEstimateMinutes, type ResolvedPace } from './duration';
import { planRoutineStart } from './routines';

/**
 * This week shaped around a run (Ben, 20 Oct: "if I did or have planned a
 * long run maybe we swap to a push rather than shoulder and chest
 * separately"). Pure.
 *
 * - `weekFacts`: the gym days left this week (Ben's aim less the days done
 *   and the days a long or hard run from today on takes, never more than
 *   the days left that aren't one; a planned run counts on its date unless
 *   Ben cancels it, Ben 20 Oct)
 *   against the plan (or split) days not done yet. Runs never count as gym
 *   days. Only logged facts: no fatigue or readiness numbers (rule 6).
 * - `suggestWeek`: code's own idea of a merge (two upper days of the same
 *   kind → `Push` / `Pull`, else `Upper`), given to the coach as context.
 * - `checkWeekProposal`: the coach's `propose_week` checked against those
 *   days, with the before/after list (rule 3: a proposal Ben applies).
 * - `mergedExercises`: a merged day's exercises from the two days', set
 *   counts trimmed to fit his session length (main lifts kept longest).
 * - `activeWeekPlan` / `weekDays`: while this week lasts, the plan's days
 *   with the merge in place and skipped days left out; the next week is the
 *   plan as it was (no write needed).
 */

// ---------------------------------------------------------------------------
// The week's facts

export interface WeekDayInput {
  /** The plan day's workout ID, or the split day's ID. */
  id: string;
  name: string;
  bodyParts: readonly SplitBodyPart[];
  /** Done this week (the plan's ✓ rule, or the split rule). */
  done: boolean;
}

export interface WeekFacts {
  monday: string;
  /** Local today. */
  today: string;
  /** Days not done yet this week, in order. */
  remaining: WeekDayInput[];
  /** Dates from today (or tomorrow, after a workout today) to Sunday without a long or hard run (planned or done). */
  openDates: string[];
  /** Gym days done this week (dates with a finished workout). */
  gymDaysDone: number;
  /** `min(aim − done − long/hard run days from today on, open dates)`; open dates with no aim set. */
  gymDaysLeft: number;
  /** Long or hard runs this week, planned or done (oldest first). */
  runs: Activity[];
  /** More days left than gym days: the coach may offer to reshape the week (rule 3, `schedule_changed`). */
  needsReshape: boolean;
}

export interface WeekFactsInput {
  /** Local today. */
  today: string;
  nowMs: number;
  tz: string;
  /** Ben's days a week; null: none set (the open dates are the limit). */
  aim: number | null;
  /** Local dates this week with a finished workout (runs never count). */
  gymDates: ReadonlySet<string>;
  days: readonly WeekDayInput[];
  activities: readonly Activity[];
}

export function weekFacts(input: WeekFactsInput): WeekFacts {
  const { mondayLocalDate: monday } = localWeekBounds(input.nowMs, input.tz);
  const sunday = addDays(monday, 6);
  const runs = activitiesBetween(input.activities, monday, addDays(monday, 7)).filter((a) => isLegRun(a.fields));
  // (Ben, 20 Oct) A run takes its date whether it is planned or done: a planned one counts unless cancelled (deleted).
  const runDays = new Set(runs.map((a) => a.fields.date));
  const openDates: string[] = [];
  const start = input.gymDates.has(input.today) ? addDays(input.today, 1) : input.today;
  for (let d = start; d <= sunday; d = addDays(d, 1)) if (!runDays.has(d)) openDates.push(d);
  const gymDaysDone = [...input.gymDates].filter((d) => d >= monday && d <= sunday).length;
  // Review S7, the spec's formula (Ben, 20 Oct): aim − done − days blocked by a long or hard run from today on;
  // never more than the open dates left.
  const blocked = [...runDays].filter((d) => d >= start && d <= sunday).length;
  const byAim = input.aim === null ? openDates.length : Math.max(0, input.aim - gymDaysDone - blocked);
  const gymDaysLeft = Math.min(byAim, openDates.length);
  const remaining = input.days.filter((d) => !d.done);
  return { monday, today: input.today, remaining, openDates, gymDaysDone, gymDaysLeft, runs, needsReshape: gymDaysLeft >= 1 && remaining.length > gymDaysLeft };
}

/** What the week looked like (for a proposal's stale check, rule 5): the basis, the workouts and activities this week. */
export function weekFactsKey(input: { monday: string; basisKey: string; workoutIds: readonly string[]; activities: readonly Pick<Activity, 'id' | 'version'>[] }): string {
  const w = [...input.workoutIds].sort().join(',');
  const a = input.activities
    .map((x) => `${x.id}@${String(x.version)}`)
    .sort()
    .join(',');
  return deriveId(`week:${input.monday}|${input.basisKey}|${w}|${a}`);
}

// ---------------------------------------------------------------------------
// Code's suggestion

const PUSH: readonly SplitBodyPart[] = ['Chest', 'Shoulders', 'Triceps'];
const PULL: readonly SplitBodyPart[] = ['Back', 'Biceps'];

function familyOf(parts: readonly SplitBodyPart[]): 'push' | 'pull' | 'mixed' | null {
  const upper = parts.filter((p) => p !== 'Core');
  if (upper.length === 0) return null;
  if (upper.every((p) => PUSH.includes(p))) return 'push';
  if (upper.every((p) => PULL.includes(p))) return 'pull';
  return 'mixed';
}

/** Two days merged: `Push` (both push), `Pull` (both pull), else `Upper`. Null for a leg day. */
export function mergedName(a: Pick<WeekDayInput, 'bodyParts'>, b: Pick<WeekDayInput, 'bodyParts'>): string | null {
  if (isLegDay(a.bodyParts) || isLegDay(b.bodyParts)) return null;
  const fa = familyOf(a.bodyParts);
  const fb = familyOf(b.bodyParts);
  if (fa === null || fb === null) return null;
  if (fa === fb && fa !== 'mixed') return fa === 'push' ? 'Push' : 'Pull';
  return 'Upper';
}

/**
 * Code's idea of a reshape: while more days are left than gym days, merge
 * two upper days (same kind first: Chest + Shoulders → Push), never a leg
 * day. Empty when no merge fits.
 */
export function suggestWeek(facts: Pick<WeekFacts, 'remaining' | 'gymDaysLeft'>): Pick<ProposeWeekArgs, 'merges' | 'skips'> {
  const merges: ProposeWeekArgs['merges'] = [];
  const used = new Set<string>();
  let left = facts.remaining.length;
  while (left > facts.gymDaysLeft && merges.length < 3) {
    const free = facts.remaining.filter((d) => !used.has(d.id));
    let best: { a: WeekDayInput; b: WeekDayInput; name: string; rank: number } | null = null;
    for (let i = 0; i < free.length; i += 1) {
      for (let j = i + 1; j < free.length; j += 1) {
        const a = free[i];
        const b = free[j];
        if (a === undefined || b === undefined) continue;
        const name = mergedName(a, b);
        if (name === null) continue;
        const rank = name === 'Upper' ? 1 : 0;
        if (best === null || rank < best.rank) best = { a, b, name, rank };
      }
    }
    if (best === null) break;
    merges.push({ dayIds: [best.a.id, best.b.id], name: best.name });
    used.add(best.a.id);
    used.add(best.b.id);
    left -= 1;
  }
  return { merges, skips: [] };
}

// ---------------------------------------------------------------------------
// The coach's proposal, checked

export type WeekProposalCheck =
  | { ok: true; merges: WeekMerge[]; skips: WeekSkip[]; before: WeekRow[]; after: WeekRow[] }
  | { ok: false; failure: string };

/**
 * For a leg day while a long or hard run is ahead this week (today on, planned or done): `After Fri's run` when an
 * open date after the day after the run is left (it goes last), else `Before Sat's run`. Null otherwise.
 */
function legNote(day: WeekDayInput, facts: Pick<WeekFacts, 'runs' | 'openDates' | 'today'>): { note: string; late: boolean } | null {
  if (!isLegDay(day.bodyParts)) return null;
  const run = facts.runs.find((r) => r.fields.date >= facts.today) ?? null;
  if (run === null) return null;
  const ok = facts.openDates.filter((d) => d !== addDays(run.fields.date, -1) && d !== addDays(run.fields.date, 1));
  if (ok.some((d) => d > run.fields.date)) return { note: `After ${dateWeekdayShort(run.fields.date)}’s run`, late: true };
  if (ok.some((d) => d < run.fields.date)) return { note: `Before ${dateWeekdayShort(run.fields.date)}’s run`, late: false };
  return null;
}

/**
 * The coach's `propose_week` against the days left this week: each day it
 * names must be one of them, used once; a merge is two upper days (never a
 * leg day) and takes code's name (`mergedName`: Push, Pull or Upper), never
 * the model's.
 * The before/after list is code's: the days left, then with the merge in
 * place (`Push`, `Chest + Shoulders`), skipped days out, a leg day around a
 * planned run noted (`After Fri's run` goes last, else `Before Sat's run`).
 */
export function checkWeekProposal(args: ProposeWeekArgs, facts: Pick<WeekFacts, 'remaining' | 'runs' | 'openDates' | 'today'>): WeekProposalCheck {
  const byId = new Map(facts.remaining.map((d) => [d.id, d]));
  const used = new Set<string>();
  const take = (id: string): WeekDayInput | null => {
    const d = byId.get(id);
    if (d === undefined || used.has(id)) return null;
    used.add(id);
    return d;
  };
  const merges: WeekMerge[] = [];
  for (const m of args.merges) {
    const [x, y] = m.dayIds;
    const a = x === undefined ? null : take(x);
    const b = y === undefined ? null : take(y);
    if (a === null || b === null) return { ok: false, failure: 'a day to merge isn’t one left this week' };
    // Review S2: code is the guardrail. A leg day never merges, nor a day outside the upper families; the name is code's.
    const name = mergedName(a, b);
    if (name === null) return { ok: false, failure: isLegDay(a.bodyParts) || isLegDay(b.bodyParts) ? 'a leg day can’t be merged' : 'those two days can’t be merged' };
    merges.push({ dayIds: [a.id, b.id], name, fromNames: [a.name, b.name] });
  }
  const skips: WeekSkip[] = [];
  for (const id of args.skips) {
    const d = take(id);
    if (d === null) return { ok: false, failure: 'a day to skip isn’t one left this week' };
    skips.push({ dayId: d.id, name: d.name });
  }
  if (merges.length === 0 && skips.length === 0) return { ok: false, failure: 'no day is merged or skipped' };
  if (skips.length === facts.remaining.length) return { ok: false, failure: 'every day left would be skipped' };
  const before: WeekRow[] = facts.remaining.map((d) => ({ name: d.name, note: null }));
  const rows: WeekRow[] = [];
  const late: WeekRow[] = [];
  const emitted = new Set<WeekMerge>();
  for (const d of facts.remaining) {
    if (skips.some((s) => s.dayId === d.id)) continue;
    const m = merges.find((x) => x.dayIds.includes(d.id));
    if (m !== undefined) {
      // The merged day takes the place of the first of its two days.
      if (!emitted.has(m)) rows.push({ name: m.name, note: `${m.fromNames[0]} + ${m.fromNames[1]}` });
      emitted.add(m);
      continue;
    }
    const leg = legNote(d, facts);
    (leg?.late === true ? late : rows).push({ name: d.name, note: leg?.note ?? null });
  }
  return { ok: true, merges, skips, before, after: [...rows, ...late] };
}

// ---------------------------------------------------------------------------
// The merged day

/** About this long per set: the work, then the rest after it (no rest recorded: these). A fallback only (`mergedExercises` without `secondsOf`). */
const WORK_S = 40;
const REST_WORKING_S = 120;
const REST_WARMUP_S = 60;

function setSeconds(e: Pick<RoutineExercise, 'restBySetType'>, t: RoutineExercise['setTemplates'][number]): number {
  const rest = t.restOverrideS ?? e.restBySetType[t.setType]?.seconds ?? (t.setType === 'warmup' ? REST_WARMUP_S : REST_WORKING_S);
  return (t.targetDurationS ?? WORK_S) + rest;
}

/** About how long a day's exercises take (every set's work and rest). A rough fallback for trimming only. */
export function routineSeconds(exercises: readonly Pick<RoutineExercise, 'restBySetType' | 'setTemplates'>[]): number {
  return exercises.reduce((n, e) => n + e.setTemplates.reduce((m, t) => m + setSeconds(e, t), 0), 0);
}

/**
 * (review S4) How long a day's exercises take as Up next shows it: the same
 * dry run Start makes (`planRoutineStart`), then `estimateRemainingDuration`
 * at Ben's pace (`planPace` of his recent workouts). Loads don't change the
 * time, so no gym equipment is needed. Pure; nothing is saved.
 */
export function plannedDaySeconds(exercises: readonly RoutineExercise[], input: { owner: UserProfile; exercises: ReadonlyMap<string, Exercise>; pace: ResolvedPace; at: ZonedTimestamp }): number {
  let n = 0;
  const newId = () => deriveId(`week-merge-estimate:${String((n += 1))}`);
  const routine: Routine = { id: deriveId('week-merge-estimate'), ownerId: input.owner.id, version: 1, createdAtUtc: input.at.utc, updatedAtUtc: input.at.utc, name: 'Estimate', exercises: [...exercises], createdFromSessionId: null, source: 'ben' };
  const out = planRoutineStart({ opId: 'week-merge-estimate', owner: input.owner, gymId: deriveId('week-merge-estimate-gym'), routine, exercises: input.exercises, gymEquipment: [], knownEquipment: new Map(), at: input.at, newId });
  return estimateRemainingDuration(out.aggregate, { pace: input.pace }).seconds;
}

const working = (e: Pick<RoutineExercise, 'setTemplates'>): number => e.setTemplates.filter((t) => t.setType !== 'warmup').length;

/**
 * A merged day's exercises: the first day's main lifts, the second's, then
 * the first's others and the second's (an exercise in both once, from the
 * first). New IDs, superset labels kept apart. Then, while its `about N min`
 * (`secondsOf`, rounded as Up next rounds it) is over `minutes`, one working
 * set at a time comes off the exercise with the most (others before main
 * lifts; an other keeps one, a main lift two) until it fits or nothing more
 * can come off. Warm-ups stay. `secondsOf`: Up next's estimate
 * (`plannedDaySeconds`); without it, the rough `routineSeconds`.
 */
export function mergedExercises(a: readonly RoutineExercise[], b: readonly RoutineExercise[], o: { minutes: number; newId: () => string; secondsOf?: (exercises: readonly RoutineExercise[]) => number }): RoutineExercise[] {
  const seen = new Set<string>();
  const labelsA = new Set(a.map((e) => e.supersetGroup).filter((g): g is string => g !== null));
  const tag = (e: RoutineExercise, second: boolean): RoutineExercise => {
    const g = e.supersetGroup;
    const group = second && g !== null && labelsA.has(g) ? `${g}2`.slice(0, 8) : g;
    return { ...e, supersetGroup: group };
  };
  const pick = (xs: readonly RoutineExercise[], main: boolean, second: boolean): RoutineExercise[] =>
    [...xs]
      .sort((x, y) => x.order - y.order)
      .filter((e) => (e.main === true) === main)
      .filter((e) => {
        if (seen.has(e.exerciseId)) return false;
        seen.add(e.exerciseId);
        return true;
      })
      .map((e) => tag(e, second));
  const ordered = [...pick(a, true, false), ...pick(b, true, true), ...pick(a, false, false), ...pick(b, false, true)].slice(0, 40);
  const out = ordered.map((e, i) => ({ ...e, id: o.newId(), order: i, setTemplates: e.setTemplates.map((t) => ({ ...t, id: o.newId() })) }));
  const secondsOf = o.secondsOf ?? routineSeconds;
  for (let guard = 0; guard < 400 && roundEstimateMinutes(secondsOf(out)) > o.minutes; guard += 1) {
    const floor = (e: RoutineExercise) => (e.main === true ? 2 : 1);
    const cut = (main: boolean) =>
      out
        .filter((e) => (e.main === true) === main && working(e) > floor(e))
        .sort((x, y) => working(y) - working(x) || y.order - x.order)[0];
    const target = cut(false) ?? cut(true);
    if (target === undefined) break;
    const lastWorking = target.setTemplates.map((t, i) => [t, i] as const).filter(([t]) => t.setType !== 'warmup').at(-1)?.[1];
    if (lastWorking === undefined) break;
    target.setTemplates = target.setTemplates.filter((_, i) => i !== lastWorking);
  }
  return out;
}

/** The merged day's saved workout: out of the rotation, marked for its week (hidden from the library). */
export function mergedWeekRoutine(input: {
  id: string;
  ownerId: string;
  name: string;
  exercises: RoutineExercise[];
  weekPlanId: string;
  weekMonday: string;
  opId: string;
  at: ZonedTimestamp;
}): Routine {
  return {
    id: input.id,
    ownerId: input.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    name: input.name,
    exercises: input.exercises,
    deletedAtUtc: null,
    lastOpId: input.opId,
    source: 'coach',
    inRotation: false,
    createdForWeek: { weekPlanId: input.weekPlanId, weekMonday: input.weekMonday },
  };
}

// ---------------------------------------------------------------------------
// Apply, Undo, and the week in use

export type WeekPlanChange =
  | { kind: 'write'; next: WeekPlan; expectedVersion: number | null; routines: { next: Routine; expectedVersion: number | null }[] }
  | { kind: 'duplicate'; current: WeekPlan }
  | { kind: 'stale' }
  | { kind: 'invalid'; reason: string };

/** The proposal as Apply needs it. */
export interface WeekProposal {
  actionId: string;
  weekMonday: string;
  basis: WeekBasis;
  merges: readonly WeekMerge[];
  skips: readonly WeekSkip[];
  before: readonly WeekRow[];
  after: readonly WeekRow[];
  factsKey: string;
}

/**
 * Apply of the coach's week proposal (Ben's tap). Stale (nothing written,
 * rule 5) when the week isn't the proposal's any more, its facts changed
 * since (`factsKey`: a workout or activity this week, the plan's version), or
 * another change is in use this week. `merged`: each merge's exercises, built
 * by the caller from the two days' workouts (`mergedExercises`).
 */
export function applyWeekPlan(input: {
  id: string;
  ownerId: string;
  proposal: WeekProposal;
  /** The week's facts now. */
  monday: string;
  factsKey: string;
  /** Week plans for this week already applied (any proposal). */
  current: readonly WeekPlan[];
  merged: readonly { routineId: string; exercises: RoutineExercise[] }[];
  opId: string;
  at: ZonedTimestamp;
}): WeekPlanChange {
  const mine = input.current.find((w) => w.proposalActionId === input.proposal.actionId);
  if (mine !== undefined && mine.opIds.includes(input.opId)) return { kind: 'duplicate', current: mine };
  if (input.proposal.weekMonday !== input.monday || input.proposal.factsKey !== input.factsKey) return { kind: 'stale' };
  if (input.current.some((w) => w.status === 'applied' && w.weekMonday === input.monday)) return { kind: 'stale' };
  if (mine !== undefined) return { kind: 'stale' };
  if (input.merged.length !== input.proposal.merges.length) return { kind: 'invalid', reason: 'a merged day is missing' };
  const routines = input.proposal.merges.map((m, i) => {
    const made = input.merged[i];
    if (made === undefined) throw new Error('merge without its workout');
    return { next: mergedWeekRoutine({ id: made.routineId, ownerId: input.ownerId, name: m.name, exercises: made.exercises, weekPlanId: input.id, weekMonday: input.monday, opId: input.opId, at: input.at }), expectedVersion: null };
  });
  if (routines.some((r) => r.next.exercises.length === 0)) return { kind: 'invalid', reason: 'a merged day has no exercises' };
  const next: WeekPlan = {
    id: input.id,
    ownerId: input.ownerId,
    version: 1,
    createdAtUtc: input.at.utc,
    updatedAtUtc: input.at.utc,
    status: 'applied',
    weekMonday: input.monday,
    tz: input.at.tz,
    basis: input.proposal.basis,
    merges: [...input.proposal.merges],
    skips: [...input.proposal.skips],
    before: [...input.proposal.before],
    after: [...input.proposal.after],
    made: routines.map((r) => ({ routineId: r.next.id, version: 1 })),
    proposalActionId: input.proposal.actionId,
    appliedOpId: input.opId,
    undoneAtUtc: null,
    opIds: [input.opId],
  };
  return { kind: 'write', next, expectedVersion: null, routines };
}

/**
 * Undo of the Apply: the week as the plan has it again, the merged day's
 * workout deleted (tombstoned; a workout done from it keeps its history).
 * Stale when the week plan moved on since the screen read it.
 */
export function undoWeekPlan(current: WeekPlan, input: { expectedVersion: number; opId: string; at: ZonedTimestamp; routines: ReadonlyMap<string, Routine | null> }): WeekPlanChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.status !== 'applied' || current.version !== input.expectedVersion) return { kind: 'stale' };
  const routines: { next: Routine; expectedVersion: number | null }[] = [];
  for (const m of current.made) {
    const r = input.routines.get(m.routineId) ?? null;
    if (r === null || r.deletedAtUtc != null) continue;
    routines.push({ next: { ...r, deletedAtUtc: input.at.utc, version: r.version + 1, updatedAtUtc: input.at.utc, lastOpId: input.opId }, expectedVersion: r.version });
  }
  const next: WeekPlan = { ...current, status: 'undone', undoneAtUtc: input.at.utc, version: current.version + 1, updatedAtUtc: input.at.utc, opIds: [...current.opIds, input.opId].slice(-20) };
  return { kind: 'write', next, expectedVersion: current.version, routines };
}

/**
 * The week change in use now: applied, for this week (Monday–Sunday in
 * Ben's zone). A change from an earlier week has expired: the plan is as it
 * was, with no write. `basisOk`: whether its basis is still the one in use
 * (the same plan, or no plan for a split change).
 */
export function activeWeekPlan(plans: readonly WeekPlan[], nowMs: number, tz: string, basisOk: (b: WeekBasis) => boolean = () => true): WeekPlan | null {
  const { mondayLocalDate } = localWeekBounds(nowMs, tz);
  return (
    plans
      .filter((w) => w.status === 'applied' && w.weekMonday === mondayLocalDate && basisOk(w.basis))
      .sort((x, y) => (x.updatedAtUtc < y.updatedAtUtc ? 1 : -1))[0] ?? null
  );
}

/**
 * This week's days with the change in place: a merge's two days become its
 * merged day (where the first of them was), skipped days are left out. `merged(i)`:
 * merge `i`'s day (null when its workout is gone: the two days stay).
 */
export function weekDays<T>(days: readonly T[], idOf: (t: T) => string, week: Pick<WeekPlan, 'merges' | 'skips'> | null, merged: (i: number) => T | null): T[] {
  if (week === null) return [...days];
  const out: T[] = [];
  const placed = new Set<number>();
  for (const d of days) {
    const id = idOf(d);
    if (week.skips.some((s) => s.dayId === id)) continue;
    const i = week.merges.findIndex((m) => m.dayIds.includes(id));
    const m = i < 0 ? null : merged(i);
    if (i < 0 || m === null) {
      out.push(d);
      continue;
    }
    if (placed.has(i)) continue;
    placed.add(i);
    out.push(m);
  }
  return out;
}

/** The days a week change takes out of this week's count (`3 of 4` → `3 of 3`): one per merge, one per skip. */
export function weekDaysRemoved(week: Pick<WeekPlan, 'merges' | 'skips'> | null): number {
  return week === null ? 0 : week.merges.length + week.skips.length;
}

/** `This week: Push (Chest + Shoulders)`: the after list's changed rows, for Your plan. */
export function weekChangeText(week: Pick<WeekPlan, 'after' | 'skips'>): string {
  const parts = week.after.filter((r) => r.note !== null).map((r) => `${r.name} (${r.note ?? ''})`);
  for (const s of week.skips) parts.push(`no ${s.name}`);
  return `This week: ${parts.join(', ')}`;
}

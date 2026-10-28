import { PLAN_LIMITS, type Exercise, type PlanDayLink, type PlanDraft, type Routine } from '@fizz/schemas';
import type { HistoryLike } from '../history-summary';
import { normaliseSessionName } from './session-types';
import type { PlanControlChange } from './plan-adapt';
import { planDayOf } from './coach-plan';
import { deriveWorkoutTitle, storedWorkoutName } from './first-run';
import { isPastLog } from './time-shift';

/**
 * (Ben, 28 Oct) Imported and past-logged workouts count towards the plan. Ben imported Tue 27 Oct "Pull · Barbell row"
 * and Up next still offered Pull B: a workout that came in via Import history or Log a past workout isn't started as
 * a plan day, so the plan's progress (this week's days, Up next's rotation, Library › Plan, the week circles) only saw
 * its muscles. Now such a workout counts as a plan day when it matches one:
 *
 * 1. **By name**: its name (or, with none, its derived title) names a plan day: the same split word (Push, Pull, Legs,
 *    Upper, Lower, Full body; `Leg` = `Legs`) and, when both name one, the same variant (`Pull B`), or the day's own
 *    name exactly. Several days of that name (Pull A, Pull B) and no variant: (Ben, 28 Oct) the one whose main lift it
 *    led with, else the only one whose main lift it did; else it counts as the first of them not done that week, in
 *    plan order (`variants`; this week's count picks, `assignPlanWeek`). Never asked: the split is sure.
 * 2. **Else by lifts**: the plan day whose main lift it did, sharing at least 40% of the two lists (Jaccard), clearly
 *    ahead of any other day with its main lift (0.15). Something in common but not that clear: unclear.
 * 3. **Unclear: never guessed silently.** A one-time `Count as Pull?` (Count / Not a plan day) on that workout's
 *    Summary; Ben's answer (`PlanDayLink`, on the plan: versioned, op ID, Undo) wins over every match.
 *
 * The workout's sets never change (rule 2): a link is read beside it. Pure.
 */

/** A plan day as the link reads it. */
export interface LinkPlanDay {
  /** Its template (the plan day's workout). */
  routineId: string;
  /** `Pull B`, `Push`. */
  name: string;
  dayIndex: number;
  mainLiftExerciseId: string | null;
  exerciseIds: readonly string[];
}

/** A finished workout as the link reads it. */
export interface LinkWorkout {
  sessionId: string;
  /** Its own name (not the generic `Workout`), else its derived title (`Pull`); null: none. */
  title: string | null;
  /** The exercises it did (a completed set). */
  exerciseIds: readonly string[];
  /** (28 Oct) The lift it led with (`leadLiftOf`); absent: its first exercise. */
  leadExerciseId?: string | null | undefined;
}

export type PlanDayLinkView =
  /** Counts as this plan day: matched by name or lifts, or Ben said `Count`. */
  | {
      kind: 'linked';
      day: LinkPlanDay;
      by: 'name' | 'lift' | 'ben';
      /**
       * (Ben, 28 Oct) Named for variants (`Pull` → Pull A, Pull B) its lifts don't tell apart: every one of them in plan
       * order (`day` is the first). This week's count fills the first not filled yet; absent: `day` for sure.
       */
      variants?: readonly LinkPlanDay[];
    }
  /** Unclear: ask `Count as <day>?` once. */
  | { kind: 'ask'; day: LinkPlanDay }
  /** Ben said `Not a plan day`. */
  | { kind: 'not_plan_day' }
  | { kind: 'none' };

export const PLAN_LINK_RULES = {
  /** Jaccard of the two exercise lists for a match by lifts. */
  minShare: 0.4,
  /** How far ahead of the next day with its main lift a match by lifts must be. */
  margin: 0.15,
} as const;

/** The split words a name can lead with, normalised. */
const SPLIT_WORDS: readonly [RegExp, string][] = [
  [/^push\b/, 'push'],
  [/^pull\b/, 'pull'],
  [/^legs?\b/, 'legs'],
  [/^upper\b/, 'upper'],
  [/^lower\b/, 'lower'],
  [/^full\s*-?\s*body\b/, 'full body'],
];

/** A name's head (before `·`), normalised: `Pull B · Barbell row` → `pull b`. */
const headOf = (name: string): string => normaliseSessionName((name.split('·')[0] ?? '').trim());

/** `{ base: 'pull', variant: 'b' }` for `Pull B`; null when it doesn't lead with a split word. */
export function splitNameOf(name: string): { base: string; variant: string | null } | null {
  const head = headOf(name);
  for (const [re, base] of SPLIT_WORDS) {
    const m = re.exec(head);
    if (m === null) continue;
    const rest = head.slice(m[0].length).trim().replace(/^(day|session|workout)\b/, '').trim();
    const v = /^([a-z]|\d)$/.exec(rest);
    return { base, variant: v === null ? null : (v[1] ?? null) };
  }
  return null;
}

/** The days a name names (see 1. above). */
export function daysNamed(title: string, days: readonly LinkPlanDay[]): LinkPlanDay[] {
  const head = headOf(title);
  if (head === '') return [];
  const exact = days.filter((d) => headOf(d.name) === head);
  if (exact.length > 0) return exact;
  const t = splitNameOf(title);
  if (t === null) return [];
  return days.filter((d) => {
    const n = splitNameOf(d.name);
    return n !== null && n.base === t.base && (t.variant === null || n.variant === null || n.variant === t.variant);
  });
}

interface Score {
  day: LinkPlanDay;
  main: boolean;
  share: number;
  common: number;
}

function scoreOf(w: LinkWorkout, d: LinkPlanDay): Score {
  const mine = new Set(w.exerciseIds);
  const theirs = new Set(d.exerciseIds);
  if (d.mainLiftExerciseId !== null) theirs.add(d.mainLiftExerciseId);
  let common = 0;
  for (const id of theirs) if (mine.has(id)) common += 1;
  const union = new Set([...mine, ...theirs]).size;
  return { day: d, main: d.mainLiftExerciseId !== null && mine.has(d.mainLiftExerciseId), share: union === 0 ? 0 : common / union, common };
}

const better = (a: Score, b: Score): number => Number(b.main) - Number(a.main) || b.share - a.share;

/** Ben's answer for this workout, if any. */
export function linkAnswerOf(links: readonly PlanDayLink[] | undefined, sessionId: string): PlanDayLink | null {
  return (links ?? []).find((l) => l.sessionId === sessionId) ?? null;
}

/** How a workout counts towards the plan (see the module comment). `days` in plan order. */
export function planDayLinkOf(w: LinkWorkout, days: readonly LinkPlanDay[], answer: PlanDayLink | null = null): PlanDayLinkView {
  if (answer !== null) {
    if (answer.answer === 'not_plan_day') return { kind: 'not_plan_day' };
    const day = days.find((d) => d.routineId === answer.routineId) ?? days.find((d) => d.dayIndex === answer.dayIndex);
    if (day !== undefined) return { kind: 'linked', day, by: 'ben' };
  }
  if (days.length === 0) return { kind: 'none' };
  // 1. By name.
  const named = w.title === null ? [] : daysNamed(w.title, days);
  if (named.length === 1 && named[0] !== undefined) return { kind: 'linked', day: named[0], by: 'name' };
  if (named.length > 1) {
    const scored = named.map((d) => scoreOf(w, d)).sort(better);
    const [a] = scored;
    if (a === undefined) return { kind: 'none' };
    // Templates of one plan day (`Chest · bench`, `Chest · incline`): that day, by the best of them.
    if (new Set(named.map((d) => d.dayIndex)).size === 1) return { kind: 'linked', day: a.day, by: 'name' };
    // (Ben, 28 Oct: the Tue 27 pull ticked Pull B, not Pull A) Variants: the one whose main lift it led with, else the
    // only one whose main lift it did. A share of accessories alone never picks a variant.
    const lead = w.leadExerciseId ?? w.exerciseIds[0] ?? null;
    const one = (ds: readonly LinkPlanDay[]): LinkPlanDay | null => (new Set(ds.map((d) => d.dayIndex)).size === 1 ? (ds[0] ?? null) : null);
    const led = one(named.filter((d) => lead !== null && d.mainLiftExerciseId === lead));
    if (led !== null) return { kind: 'linked', day: led, by: 'name' };
    const did = one(named.filter((d) => d.mainLiftExerciseId !== null && w.exerciseIds.includes(d.mainLiftExerciseId)));
    if (did !== null) return { kind: 'linked', day: did, by: 'name' };
    // Unclear which variant: the split is sure, so it counts as the first of them not done yet this week (plan order).
    const ordered = [...named].sort((x, y) => days.indexOf(x) - days.indexOf(y));
    const first = ordered[0] ?? a.day;
    return { kind: 'linked', day: first, by: 'name', variants: ordered };
  }
  // 2. By lifts.
  const scored = days.map((d) => scoreOf(w, d)).sort(better);
  const best = scored[0];
  if (best === undefined || (best.common === 0 && !best.main)) return { kind: 'none' };
  // Another template of the same plan day is no rival.
  const rival = scored.slice(1).find((s) => s.main === best.main && s.day.dayIndex !== best.day.dayIndex);
  if (best.main && best.share >= PLAN_LINK_RULES.minShare && (rival === undefined || best.share - rival.share >= PLAN_LINK_RULES.margin)) return { kind: 'linked', day: best.day, by: 'lift' };
  // Something in common, not clear enough: asked (one shared accessory alone isn't a question worth asking).
  return best.main || best.common >= 2 ? { kind: 'ask', day: best.day } : { kind: 'none' };
}

// ---------------------------------------------------------------------------
// Ben's answer: `Count` / `Not a plan day`, and its Undo

interface LinkInput {
  expectedVersion: number;
  opId: string;
  at: { utc: string };
}

/**
 * `Count` (it counts as `routineId`, plan day `dayIndex`) or `Not a plan day` on a workout's `Count as Pull?`. One
 * versioned write on the plan in use (op ID; refused when the plan moved or isn't in use, rule 5). Replaces an earlier
 * answer for the same workout; `undoPlanDayLink` puts that back.
 */
export function answerPlanDayLink(current: PlanDraft, input: LinkInput & { sessionId: string; answer: 'count' | 'not_plan_day'; dayIndex: number | null; routineId: string | null }): PlanControlChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.version !== input.expectedVersion || current.status !== 'applied' || current.applied === null) return { kind: 'stale', current };
  if (input.answer === 'count' && (input.dayIndex === null || input.routineId === null)) return { kind: 'invalid', current, reason: 'not_a_day' };
  const links = current.dayLinks ?? [];
  const before = linkAnswerOf(links, input.sessionId);
  const link: PlanDayLink = {
    sessionId: input.sessionId,
    answer: input.answer,
    dayIndex: input.answer === 'count' ? input.dayIndex : null,
    routineId: input.answer === 'count' ? input.routineId : null,
    opId: input.opId,
    atUtc: input.at.utc,
  };
  const version = current.version + 1;
  const next: PlanDraft = {
    ...current,
    dayLinks: [...links.filter((l) => l.sessionId !== input.sessionId), link].slice(-200),
    lastLink: { opId: input.opId, versionAfter: version, sessionId: input.sessionId, before },
    opIds: [...current.opIds, input.opId].slice(-PLAN_LIMITS.maxOps),
    version,
    updatedAtUtc: input.at.utc,
  };
  return { kind: 'write', next, expectedVersion: current.version };
}

/** Undo of the last answer (`targetOpId`): that workout's answer before it, only while the plan is as that write left it. */
export function undoPlanDayLink(current: PlanDraft, input: LinkInput & { targetOpId: string }): PlanControlChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  const last = current.lastLink ?? null;
  if (current.status !== 'applied' || last === null || last.opId !== input.targetOpId || current.version !== input.expectedVersion || last.versionAfter !== current.version) return { kind: 'stale', current };
  const others = (current.dayLinks ?? []).filter((l) => l.sessionId !== last.sessionId);
  const next: PlanDraft = {
    ...current,
    dayLinks: last.before === null ? others : [...others, last.before],
    lastLink: null,
    opIds: [...current.opIds, input.opId].slice(-PLAN_LIMITS.maxOps),
    version: current.version + 1,
    updatedAtUtc: input.at.utc,
  };
  return { kind: 'write', next, expectedVersion: current.version };
}

// ---------------------------------------------------------------------------
// Reading many workouts

/** The plan's days for the link: each live template of the plan in use, its plan day index, name, main lift and exercises. */
export function linkPlanDaysOf(plan: Pick<PlanDraft, 'id' | 'applied'>, templates: readonly Pick<Routine, 'id' | 'name' | 'exercises' | 'planDay' | 'createdFromPlan'>[]): LinkPlanDay[] {
  const made = new Map((plan.applied?.made ?? []).map((m) => [m.routineId, m.dayIndex] as const));
  return templates.flatMap((r) => {
    const ref = planDayOf(r);
    const dayIndex = made.get(r.id) ?? (ref?.planId === plan.id ? ref.dayIndex : undefined);
    if (dayIndex === undefined) return [];
    const main = r.exercises.find((e) => e.main === true)?.exerciseId ?? r.planDay?.mainLiftExerciseId ?? null;
    return [{ routineId: r.id, name: r.name, dayIndex, mainLiftExerciseId: main, exerciseIds: r.exercises.map((e) => e.exerciseId) }];
  });
}

/**
 * Whether a finished workout is one the link reads: imported, or entered with `Log a past workout`, and not already
 * a plan day's (started as one: `planDay`, or from one of `templateIds`).
 */
export function linkCandidate(a: Pick<HistoryLike, 'session'>, templateIds: ReadonlySet<string>): boolean {
  const s = a.session;
  if (s.source !== 'import' && !isPastLog(s)) return false;
  return s.planDay === undefined && (s.routineId === null || !templateIds.has(s.routineId));
}

/** A finished workout as the link reads it: its name (else its derived title) and the exercises it did. */
export function linkWorkoutOf(a: HistoryLike, exerciseOf: (id: string) => Pick<Exercise, 'movementPattern' | 'primaryMuscles'> | null): LinkWorkout {
  const done = new Set(a.sets.filter((x) => x.status === 'completed').map((x) => x.sessionExerciseId));
  const ids = [...a.exercises].filter((e) => e.removed === undefined && done.has(e.id)).sort((x, y) => x.order - y.order).map((e) => e.exerciseId);
  const infos = ids.map(exerciseOf).filter((x): x is Pick<Exercise, 'movementPattern' | 'primaryMuscles'> => x !== null);
  const derived = infos.length === 0 ? null : deriveWorkoutTitle(infos);
  return { sessionId: a.session.id, title: storedWorkoutName(a.session) ?? (derived === 'Workout' ? null : derived), exerciseIds: ids, leadExerciseId: leadLiftOf(a) };
}

/** A candidate workout's link, and whether it was imported (an unlinked import reads as before: from no routine). */
export type PlanLinkEntry = PlanDayLinkView & { imported: boolean };

/** Every candidate workout's link (`planDayLinkOf`, Ben's answers first); workouts that aren't candidates are absent. */
export function planLinksFor(input: { plan: Pick<PlanDraft, 'id' | 'applied' | 'dayLinks'>; days: readonly LinkPlanDay[]; workouts: readonly HistoryLike[]; exerciseOf: (id: string) => Pick<Exercise, 'movementPattern' | 'primaryMuscles'> | null }): Map<string, PlanLinkEntry> {
  const ids = new Set(input.days.map((d) => d.routineId));
  const out = new Map<string, PlanLinkEntry>();
  for (const a of input.workouts) {
    if (!linkCandidate(a, ids)) continue;
    out.set(a.session.id, { ...planDayLinkOf(linkWorkoutOf(a, input.exerciseOf), input.days, linkAnswerOf(input.plan.dayLinks, a.session.id)), imported: a.session.source === 'import' });
  }
  return out;
}

/**
 * Finished-workout refs (any source) as the plan's block and week read them: a linked workout carries its plan day's
 * template as `routineId`; an imported one that isn't linked is left out, as before (it comes from no routine).
 */
export function linkRefs<R extends { sessionId: string; routineId: string | null }>(refs: readonly R[], links: ReadonlyMap<string, PlanLinkEntry>): (R & { variantRoutineIds?: readonly string[] })[] {
  return refs.flatMap((r) => {
    const v = links.get(r.sessionId);
    if (v === undefined) return [r];
    if (v.kind === 'linked') return [{ ...r, routineId: v.day.routineId, ...(v.variants === undefined ? {} : { variantRoutineIds: v.variants.map((d) => d.routineId) }) }];
    return v.imported ? [] : [r];
  });
}

/** The template a workout reads as for the plan (a linked one's day), else its own routine. */
export function linkedRoutineId(links: ReadonlyMap<string, PlanDayLinkView> | null | undefined, sessionId: string, routineId: string | null): string | null {
  const v = links?.get(sessionId);
  return v?.kind === 'linked' ? v.day.routineId : routineId;
}

/** (28 Oct) A workout named for variants it doesn't tell apart: their templates in plan order (`assignPlanWeek`); else null. */
export function linkedVariants(links: ReadonlyMap<string, PlanDayLinkView> | null | undefined, sessionId: string): string[] | null {
  const v = links?.get(sessionId);
  return v?.kind === 'linked' && v.variants !== undefined ? v.variants.map((d) => d.routineId) : null;
}

/**
 * (28 Oct) The lift a workout led with: its first exercise (in order) with a completed working set. Null: none done.
 */
export function leadLiftOf(a: Pick<HistoryLike, 'exercises' | 'sets'>): string | null {
  const done = new Set(a.sets.filter((x) => x.status === 'completed' && x.setType !== 'warmup').map((x) => x.sessionExerciseId));
  const live = [...a.exercises].filter((e) => e.removed === undefined && done.has(e.id)).sort((x, y) => x.order - y.order);
  return live[0]?.exerciseId ?? null;
}

/** Ben said `Not a plan day`: it ticks no plan day. */
export const isNotPlanDay = (links: ReadonlyMap<string, PlanDayLinkView> | null | undefined, sessionId: string): boolean => links?.get(sessionId)?.kind === 'not_plan_day';

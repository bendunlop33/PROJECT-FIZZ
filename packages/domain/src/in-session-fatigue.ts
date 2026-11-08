import type { Measurement, SessionExercise, SetSide, SetType, WorkoutSet } from '@fizz/schemas';
import { muscleGroupOf } from '@fizz/schemas';
import { daysBetween } from './calendar';
import { toMs } from './time';

/**
 * In-session fatigue (Ben, 8 Nov: SF1–SF9 approved; docs/training-guides/in-session-fatigue.md). Pure.
 *
 * - **SF1** `earlierWorkOf` / `earlierSetsByMuscle` / `earlierSetsP`: the hard sets each muscle has already done in
 *   this workout before an exercise (1 per set where the muscle was a primary mover of the earlier exercise, ½ where it
 *   helped). Warm-ups, drop-set drops and cardio never count (SF9). P is the highest value across the exercise's own
 *   primary muscles; no catalogue muscles → P unknown.
 * - **SF2** `pickLikeForLike`: a past exposure is comparable when its P is within 2 sets of today's and it is the same
 *   kind (same-muscle superset or not, SF8). Exposures with no known order (imports) are used only when no
 *   known-context exposure exists.
 * - **SF3** `earlierWorkCushion`: no comparable exposure and today's P ≥ 2 higher than the newest other-context one:
 *   same load, 1 rep fewer (2 at ≥ 5 higher), labelled `est.`, no load step; below the range bottom, one achievable
 *   step easier at the range bottom.
 * - **SF4** no percentage factor anywhere (nothing here scales a load).
 *
 * Context is derived at read time from the logged order (set completion times), so nothing is stored or migrated and
 * no completed row is rewritten. Muscles are grouped by `muscleGroupOf` (chest and upper chest are one muscle here),
 * the same table as every other muscle count.
 */

export const SF_RULES = {
  /** SF2: today's P and the exposure's P within this many sets are like for like. */
  window: 2,
  /** SF3: 1 rep fewer at this many more earlier sets than the reference had… */
  oneRepAt: 2,
  /** …and 2 fewer at this many. */
  twoRepsAt: 5,
  /** SF2: a comparable exposure this many days older than a newer one in another context is stale. */
  staleDays: 28,
} as const;

/** What SF1 needs to know about an exercise (catalogue or Ben's own). */
export interface FatigueMuscles {
  primaryMuscles: readonly string[];
  secondaryMuscles?: readonly string[] | undefined;
  measurement?: Measurement | undefined;
}

export type MusclesOf = (exerciseId: string) => FatigueMuscles | null | undefined;

/** One earlier exercise's hard sets in a workout. */
export interface EarlierWork {
  exerciseId: string;
  /** Hard sets (a left or right side set counts ½: a left + right pair is one set). */
  sets: number;
}

/**
 * Read-time context of one exposure (an exercise in one workout): the hard sets done before it, and its superset
 * partners. Null on an exposure whose order isn't known (an imported workout: FitNotes records no set times, and its
 * row order isn't documented as the order done).
 */
export interface WorkContext {
  earlier: readonly EarlierWork[];
  /** Other exercises in its superset (`supersetGroup`), any order. */
  supersetWith: readonly string[];
}

/** A context resolved against the muscles: P (null = unknown) and whether it was a same-muscle superset (SF8). */
export interface ResolvedContext {
  p: number | null;
  sameMuscleSuperset: boolean;
  /** The primary muscle (group) behind P; null when P is 0 or unknown. */
  muscle: string | null;
}

export const UNKNOWN_CONTEXT: ResolvedContext = { p: null, sameMuscleSuperset: false, muscle: null };

const COUNTED: ReadonlySet<SetType> = new Set(['working', 'top', 'backoff']);

/** D18 / PG7: a non-warm-up set rated RPE ≥ 6 (or RIR ≤ 4), or unrated. Drop-set drops never count here (SF9). */
function isHard(s: { setType: SetType; rpe: number | null; rir: number | null }): boolean {
  if (!COUNTED.has(s.setType)) return false;
  if (s.rpe !== null) return s.rpe >= 6;
  if (s.rir !== null) return s.rir <= 4;
  return true;
}

const sideWeight = (side: SetSide | null): number => (side === 'left' || side === 'right' ? 0.5 : 1);

type ContextSet = Pick<WorkoutSet, 'sessionExerciseId' | 'setType' | 'status' | 'side' | 'completedAt' | 'actual'>;
type ContextRow = Pick<SessionExercise, 'id' | 'exerciseId' | 'order' | 'supersetGroup' | 'removed' | 'measurement'>;

/** What `earlierWorkOf` reads of a workout: its source, rows and sets. */
export interface ContextWorkout {
  session: { source?: string | undefined };
  exercises: readonly ContextRow[];
  sets: readonly (ContextSet & { status: string; skippedBy?: 'before_start' | 'in_workout' | undefined })[];
}

/**
 * SF1: the context of `exerciseId` in a workout. Earlier work = the completed hard sets of other exercises logged
 * before this exercise's first completed working set (when it has none yet: everything logged so far). With
 * `planned: true` (today's workout, not started or in progress, SF6) the working sets still to do on rows ordered
 * before it count too, so the target fits the order Ben will do. Imported workouts: null (order unknown).
 */
export function earlierWorkOf(w: ContextWorkout, exerciseId: string, opts: { planned?: boolean } = {}): WorkContext | null {
  if (w.session.source === 'import') return null;
  const live = w.exercises.filter((e) => e.removed === undefined);
  const own = live.filter((e) => e.exerciseId === exerciseId);
  // Not in the workout yet (being added at the end, SF6): everything done or planned so far is before it.
  if (own.length === 0 && opts.planned !== true) return null;
  const ownIds = new Set(own.map((e) => e.id));
  const rowOf = new Map(live.map((e) => [e.id, e]));
  const done = (s: ContextSet): boolean => s.status === 'completed' && s.actual !== null && s.completedAt !== null;
  const firstOwn = w.sets
    .filter((s) => ownIds.has(s.sessionExerciseId) && done(s) && COUNTED.has(s.setType))
    .map((s) => toMs((s.completedAt as { utc: string }).utc))
    .reduce((m, t) => Math.min(m, t), Number.POSITIVE_INFINITY);
  const firstOrder = own.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...own.map((e) => e.order));
  const counts = new Map<string, number>();
  for (const s of w.sets) {
    const row = rowOf.get(s.sessionExerciseId);
    if (row === undefined || ownIds.has(row.id) || row.exerciseId === exerciseId || row.measurement === 'cardio') continue;
    let n = 0;
    if (done(s)) {
      const actual = s.actual as { rpe: number | null; rir: number | null };
      if (toMs((s.completedAt as { utc: string }).utc) < firstOwn && isHard({ setType: s.setType, rpe: actual.rpe, rir: actual.rir })) n = sideWeight(s.side);
    } else if (opts.planned === true && s.status === 'pending' && row.order < firstOrder && COUNTED.has(s.setType)) {
      // A set still to do on an earlier row: counted as planned (no rating yet, so hard).
      n = sideWeight(s.side);
    }
    if (n > 0) counts.set(row.exerciseId, (counts.get(row.exerciseId) ?? 0) + n);
  }
  const groups = new Set(own.map((e) => e.supersetGroup).filter((g): g is string => g !== null));
  const supersetWith = [...new Set(live.filter((e) => e.supersetGroup !== null && groups.has(e.supersetGroup) && e.exerciseId !== exerciseId).map((e) => e.exerciseId))].sort();
  return { earlier: [...counts].map(([id, sets]) => ({ exerciseId: id, sets })).sort((a, b) => (a.exerciseId < b.exerciseId ? -1 : a.exerciseId > b.exerciseId ? 1 : 0)), supersetWith };
}

/** A muscle's group when it has one, else the muscle itself. */
const groupOf = (m: string): string => muscleGroupOf(m) ?? m;

/** Per muscle (group): 1 for a primary, ½ for a secondary; the higher wins (E1 / V1 counting). */
function credits(info: FatigueMuscles | null | undefined): Map<string, 1 | 0.5> {
  const out = new Map<string, 1 | 0.5>();
  if (info == null || info.measurement === 'cardio') return out;
  for (const m of info.primaryMuscles) out.set(groupOf(m), 1);
  for (const m of info.secondaryMuscles ?? []) if (!out.has(groupOf(m))) out.set(groupOf(m), 0.5);
  return out;
}

export interface MuscleSoFar {
  /** Hard sets where the muscle was a primary mover. */
  direct: number;
  /** Hard sets where it helped (each counts ½ towards P). */
  secondary: number;
}

/** SF1 / SF7(a): per muscle (group), the earlier hard sets split into direct and secondary. */
export function earlierSetsByMuscle(earlier: readonly EarlierWork[], musclesOf: MusclesOf): Map<string, MuscleSoFar> {
  const out = new Map<string, MuscleSoFar>();
  for (const e of earlier) {
    for (const [m, c] of credits(musclesOf(e.exerciseId))) {
      const cur = out.get(m) ?? { direct: 0, secondary: 0 };
      out.set(m, c === 1 ? { ...cur, direct: cur.direct + e.sets } : { ...cur, secondary: cur.secondary + e.sets });
    }
  }
  return out;
}

/** SF1: P for an exercise from the earlier sets by muscle: the highest `direct + ½ secondary` across its primary muscles. */
export function earlierSetsP(info: FatigueMuscles | null | undefined, byMuscle: ReadonlyMap<string, MuscleSoFar>): { p: number; muscle: string | null } | null {
  if (info == null || info.measurement === 'cardio') return null;
  const primaries = [...new Set(info.primaryMuscles.map(groupOf))];
  if (primaries.length === 0) return null;
  let best: { p: number; muscle: string | null } = { p: 0, muscle: null };
  for (const m of primaries) {
    const x = byMuscle.get(m);
    const p = x === undefined ? 0 : x.direct + x.secondary / 2;
    if (p > best.p) best = { p, muscle: m };
  }
  return best;
}

/** SF1 + SF8: the context resolved for `exerciseId` against the muscles. */
export function resolveContext(ctx: WorkContext | null | undefined, exerciseId: string, musclesOf: MusclesOf): ResolvedContext {
  if (ctx == null) return UNKNOWN_CONTEXT;
  const info = musclesOf(exerciseId);
  const pick = earlierSetsP(info, earlierSetsByMuscle(ctx.earlier, musclesOf));
  if (pick === null) return UNKNOWN_CONTEXT;
  const own = new Set((info?.primaryMuscles ?? []).map(groupOf));
  const sameMuscleSuperset = ctx.supersetWith.some((id) => (musclesOf(id)?.primaryMuscles ?? []).some((m) => own.has(groupOf(m))));
  return { p: pick.p, sameMuscleSuperset, muscle: pick.muscle };
}

/** SF2: like for like (P within the window, the same superset kind). Unknown contexts are never comparable. */
export function sameContext(a: ResolvedContext, b: ResolvedContext): boolean {
  return a.p !== null && b.p !== null && Math.abs(a.p - b.p) <= SF_RULES.window && a.sameMuscleSuperset === b.sameMuscleSuperset;
}

/** SF3: reps fewer for `todayP` against the reference's P: 0 (no cushion), 1 or 2. */
export function cushionReps(todayP: number, referenceP: number): 0 | 1 | 2 {
  const d = todayP - referenceP;
  if (d >= SF_RULES.twoRepsAt) return 2;
  if (d >= SF_RULES.oneRepAt) return 1;
  return 0;
}

/** An exposure as SF2 reads it. */
export interface ContextExposure {
  sessionId: string;
  performedAtUtc: string;
  context: ResolvedContext;
}

export type LikeForLikePick =
  /** SF does nothing: today's P unknown, or no exposure with a known context (only imports): every exposure is read. */
  | { kind: 'all' }
  /** The comparable exposures (SF2); `stale`: a newer other-context exposure 28+ days newer (also work out SF3 from it, take the lower). */
  | { kind: 'comparable'; sessionIds: ReadonlySet<string>; stale: ContextExposure | null }
  /** No comparable exposure: read the other-context ones (`reference` first; SF3 when `cushion` > 0). */
  | { kind: 'other'; sessionIds: ReadonlySet<string>; reference: ContextExposure; cushion: 0 | 1 | 2 };

const newestFirst = (a: ContextExposure, b: ContextExposure): number => toMs(b.performedAtUtc) - toMs(a.performedAtUtc) || (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0);

/**
 * SF2: which exposures a target reads. `exposures`: the ones that could be a basis at all (the caller has already
 * kept only those the rule can judge on today's equipment, unit and convention).
 */
export function pickLikeForLike(today: ResolvedContext, exposures: readonly ContextExposure[]): LikeForLikePick {
  if (today.p === null) return { kind: 'all' };
  const known = exposures.filter((e) => e.context.p !== null).sort(newestFirst);
  if (known.length === 0) return { kind: 'all' };
  const comparable = known.filter((e) => sameContext(today, e.context));
  const others = known.filter((e) => !sameContext(today, e.context));
  const newestComparable = comparable[0];
  const newestOther = others[0];
  if (newestComparable !== undefined) {
    const stale = newestOther !== undefined && dayGap(newestComparable.performedAtUtc, newestOther.performedAtUtc) > SF_RULES.staleDays ? newestOther : null;
    return { kind: 'comparable', sessionIds: new Set(comparable.map((e) => e.sessionId)), stale };
  }
  const ref = newestOther as ContextExposure;
  return { kind: 'other', sessionIds: new Set(others.map((e) => e.sessionId)), reference: ref, cushion: cushionReps(today.p, ref.context.p ?? 0) };
}

/** Calendar days from `a` to `b` (UTC dates; positive when `b` is later). */
function dayGap(aUtc: string, bUtc: string): number {
  return daysBetween(aUtc.slice(0, 10), bUtc.slice(0, 10));
}

/** `3 chest sets` / `1.5 shoulders sets`, for `Why?` and the coach. */
const setsWord = (n: number): string => `${Number.isInteger(n) ? String(n) : n.toFixed(1)} ${n === 1 ? 'set' : 'sets'}`;

/**
 * SF7(a): `Chest 3 direct + 1 secondary · Triceps 1.5 secondary`-style lines, one per muscle, highest first.
 * Empty when nothing was done.
 */
export function doneSoFarLines(byMuscle: ReadonlyMap<string, MuscleSoFar>): string[] {
  return [...byMuscle]
    .filter(([, v]) => v.direct > 0 || v.secondary > 0)
    .sort((a, b) => b[1].direct + b[1].secondary / 2 - (a[1].direct + a[1].secondary / 2) || (a[0] < b[0] ? -1 : 1))
    .map(([m, v]) => `${m}: ${[v.direct > 0 ? `${setsWord(v.direct)} direct` : null, v.secondary > 0 ? `${setsWord(v.secondary)} secondary` : null].filter((x) => x !== null).join(', ')}`);
}

/** How a reference context reads in one line: `first` (nothing before it) or `after 3 sets`. */
export function contextWords(c: ResolvedContext): string {
  if (c.p === null) return 'order not recorded';
  const base = c.p === 0 ? 'first' : `after ${setsWord(c.p)}`;
  return c.sameMuscleSuperset ? `${base}, in a superset` : base;
}

/** SF3's one-line `Why?`: `After 3 chest sets today; last time first: 30 × 9 → 8 est.` */
export function cushionWhy(today: ResolvedContext, reference: ResolvedContext, load: string, lastReps: number, aim: number): string {
  const muscle = today.muscle === null ? '' : `${today.muscle.toLowerCase()} `;
  const p = today.p ?? 0;
  return `After ${Number.isInteger(p) ? String(p) : p.toFixed(1)} ${muscle}${p === 1 ? 'set' : 'sets'} today; last time ${contextWords(reference)}: ${load} × ${String(lastReps)} → ${String(aim)} est.`;
}

/**
 * SF5: the sessions of one lift done in another context than its newest one with a known context, which stall checks
 * (ST1, ST2, rule 8) and the weekly review skip, as they skip deload weeks. A session with an unknown context
 * (imported) is never skipped: SF never blocks.
 */
export function otherContextSessions(points: readonly { sessionId: string; context?: WorkContext | null | undefined }[], exerciseId: string, musclesOf: MusclesOf): Set<string> {
  const resolved = points.map((p) => ({ id: p.sessionId, c: resolveContext(p.context, exerciseId, musclesOf) }));
  const anchor = [...resolved].reverse().find((x) => x.c.p !== null);
  const out = new Set<string>();
  if (anchor === undefined) return out;
  for (const x of resolved) if (x.c.p !== null && !sameContext(anchor.c, x.c)) out.add(x.id);
  return out;
}

/** Every exercise whose muscles SF needs for one target: the exercise, today's earlier work and partners, and every exposure's. */
export function fatigueExerciseIds(exerciseId: string, today: WorkContext | null | undefined, history: readonly { context?: WorkContext | undefined }[]): string[] {
  const out = new Set<string>([exerciseId]);
  const add = (c: WorkContext | null | undefined) => {
    if (c == null) return;
    for (const e of c.earlier) out.add(e.exerciseId);
    for (const id of c.supersetWith) out.add(id);
  };
  add(today);
  for (const h of history) add(h.context);
  return [...out].sort();
}

/** SF7(a): every hard set logged so far in a workout, per exercise (warm-ups, drops, easy sets and cardio left out). */
export function doneSoFarIn(w: ContextWorkout): EarlierWork[] {
  const rows = new Map(w.exercises.filter((e) => e.removed === undefined && e.measurement !== 'cardio').map((e) => [e.id, e]));
  const counts = new Map<string, number>();
  for (const s of w.sets) {
    const row = rows.get(s.sessionExerciseId);
    if (row === undefined || s.status !== 'completed' || s.actual === null) continue;
    if (!isHard({ setType: s.setType, rpe: s.actual.rpe, rir: s.actual.rir })) continue;
    counts.set(row.exerciseId, (counts.get(row.exerciseId) ?? 0) + sideWeight(s.side));
  }
  return [...counts].map(([exerciseId, sets]) => ({ exerciseId, sets })).sort((a, b) => (a.exerciseId < b.exerciseId ? -1 : 1));
}

/** SF7(a) for the coach: per muscle, the hard sets so far in this workout, direct and secondary, most-worked first. */
export function doneSoFarByMuscle(w: ContextWorkout, musclesOf: MusclesOf): { muscle: string; direct: number; secondary: number }[] {
  return [...earlierSetsByMuscle(doneSoFarIn(w), musclesOf)]
    .filter(([, v]) => v.direct > 0 || v.secondary > 0)
    .sort((a, b) => b[1].direct + b[1].secondary / 2 - (a[1].direct + a[1].secondary / 2) || (a[0] < b[0] ? -1 : 1))
    .map(([muscle, v]) => ({ muscle, direct: v.direct, secondary: v.secondary }));
}

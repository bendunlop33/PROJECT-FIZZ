import { infoOrDefault } from './arrange';
import { autoPickClash } from './similar';
import type { BuilderGroupName, BuilderInfoLookup, BuilderSlot, BuilderWorkout } from './types';

/**
 * `↻ Mix it up` (workout-builder-v3 §2.0.2, Ben agreed 20 Oct). Code picks
 * WHICH accessory and the SHORTLIST; with AI the coach picks from the
 * shortlist (with a reason); offline code picks the least recently done,
 * labelled not reviewed. Today only; Undo restores.
 */

export interface MixTargetInput {
  workout: BuilderWorkout;
  info: BuilderInfoLookup;
  /** How often each exercise was done in this day's recent sessions (Your data, injected). */
  recentCountOnDay: ReadonlyMap<string, number>;
  /** Accessories: Varied puts one that repeats another's angle first. */
  varied: boolean;
}

/**
 * Which one to swap: never the main lift; on Varied, an accessory whose
 * angle repeats another's goes first; then the one done most often lately on
 * this day; ties go to the later exercise. Null when there's no accessory.
 */
export function mixItUpTarget(input: MixTargetInput): BuilderSlot | null {
  const slots = input.workout.blocks.flatMap((b) => b.slots).filter((s) => !s.main);
  if (slots.length === 0) return null;
  const angle = (s: BuilderSlot) => infoOrDefault(input.info, s.exerciseId);
  const repeats = (s: BuilderSlot) => {
    const a = angle(s);
    return a.angle !== '' && input.workout.blocks.some((b) => b.slots.some((o) => o !== s && infoOrDefault(input.info, o.exerciseId).group === a.group && infoOrDefault(input.info, o.exerciseId).angle === a.angle));
  };
  let best: BuilderSlot | null = null;
  let bestScore: readonly number[] = [];
  for (const [i, s] of slots.entries()) {
    const score = [input.varied && repeats(s) ? 1 : 0, input.recentCountOnDay.get(s.exerciseId) ?? 0, i];
    if (best === null || lexGreater(score, bestScore)) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

function lexGreater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export interface MixShortlistInput {
  target: Pick<BuilderSlot, 'exerciseId' | 'main'>;
  /** Exercises to consider (Ben's list + catalogue), any order. */
  candidates: readonly string[];
  info: BuilderInfoLookup;
  /** Available at today's gym (`doableHere`, injected). */
  availableHere: (exerciseId: string) => boolean;
  /** Pain-flagged movement (`painFlagCovering`, injected). */
  painFlagged: (exerciseId: string) => boolean;
  /** Exercise IDs in this day's last two sessions. */
  lastTwoOnDay: ReadonlySet<string>;
  /** Exercise IDs already in today's workout. */
  inWorkout: ReadonlySet<string>;
  /** When each was last done (ms), any day; absent = never. */
  lastDoneMs: ReadonlyMap<string, number>;
}

export type MixExclusion = 'not_same_group' | 'same_angle' | 'other_role' | 'not_here' | 'pain' | 'recent_on_day' | 'in_workout' | 'near_duplicate' | 'unknown' | 'is_target';

/** Why one candidate is out, or null when it's on the shortlist. */
export function mixExclusion(id: string, input: MixShortlistInput): MixExclusion | null {
  if (id === input.target.exerciseId) return 'is_target';
  const c = input.info(id);
  if (c === null) return 'unknown';
  const t = infoOrDefault(input.info, input.target.exerciseId);
  if (c.group !== t.group) return 'not_same_group';
  if (c.angle === t.angle) return 'same_angle';
  if (c.role !== t.role) return 'other_role';
  if (!input.availableHere(id)) return 'not_here';
  if (input.painFlagged(id)) return 'pain';
  if (input.lastTwoOnDay.has(id)) return 'recent_on_day';
  if (input.inWorkout.has(id)) return 'in_workout';
  // (Ben, 23 Oct) Never a near-duplicate of another exercise in the workout (the target goes), nor a second traps isolation.
  if (autoPickClash(id, [...input.inWorkout].filter((x) => x !== input.target.exerciseId), input.info) !== null) return 'near_duplicate';
  return null;
}

/**
 * `mixItUpShortlist`: same muscles (group) at a different angle, same role,
 * here, not pain-flagged, not in the day's last 2 sessions, not already in
 * the workout, and no near-duplicate of another exercise in it (Ben, 23 Oct). Ordered least recently done first (never done first), so the
 * offline pick is `[0]` and `Another (1/3)` cycles the rest. Empty for the
 * main lift.
 */
export function mixItUpShortlist(input: MixShortlistInput): string[] {
  if (input.target.main) return [];
  const ok = [...new Set(input.candidates)].filter((id) => mixExclusion(id, input) === null);
  const when = (id: string) => input.lastDoneMs.get(id) ?? Number.NEGATIVE_INFINITY;
  const cmp = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);
  return ok
    .map((id, i) => ({ id, i }))
    .sort((a, b) => cmp(when(a.id), when(b.id)) || a.i - b.i)
    .map((x) => x.id);
}

/** The offline pick: least recently done (labelled not reviewed by the UI). */
export function mixItUpOfflinePick(shortlist: readonly string[]): string | null {
  return shortlist[0] ?? null;
}

export interface MixPickInput extends Omit<MixShortlistInput, 'target' | 'candidates' | 'inWorkout'> {
  workout: BuilderWorkout;
  /** Candidates of the target's group (Ben's list, then the catalogue). */
  candidates: (group: BuilderGroupName) => readonly string[];
  recentCountOnDay: ReadonlyMap<string, number>;
  varied: boolean;
}

/**
 * `mixItUpPick` (Ben, 23 Oct: `↻ Mix it up` on Your workout): the slot to swap and code's pick for it. The 20 Oct
 * target first (`mixItUpTarget`); a target with no fresh option (every one here shares its angle, say) gives way to the
 * next, never the main lift. The pick is the shortlist's first (least recently done). Null: no accessory has one.
 */
export function mixItUpPick(input: MixPickInput): { slot: BuilderSlot; exerciseId: string } | null {
  const tried = new Set<string>();
  const inWorkout = new Set(input.workout.blocks.flatMap((b) => b.slots.map((s) => s.exerciseId)));
  for (;;) {
    const masked: BuilderWorkout = { ...input.workout, blocks: input.workout.blocks.map((b) => ({ ...b, slots: b.slots.map((x) => (tried.has(x.key) ? { ...x, main: true } : x)) })) };
    const target = mixItUpTarget({ workout: masked, info: input.info, recentCountOnDay: input.recentCountOnDay, varied: input.varied });
    if (target === null) return null;
    tried.add(target.key);
    const group = input.info(target.exerciseId)?.group;
    if (group === undefined) continue;
    const pick = mixItUpShortlist({ ...input, target, candidates: input.candidates(group), inWorkout })[0];
    const slot = input.workout.blocks.flatMap((b) => b.slots).find((x) => x.key === target.key);
    if (pick !== undefined && slot !== undefined) return { slot, exerciseId: pick };
  }
}

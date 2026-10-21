import { BUILD_LIMITS, type CommandOf, type Load, type PlannedSet, type SessionAggregate, type SessionExercise, type SetType, type WorkoutSet, type ZonedTimestamp } from '@fizz/schemas';
import { adviseAfter, adviseBuilder, type AdviceBlock, type BuilderAdvice } from '../builder/advise';
import { BUILDER_REST_DEFAULTS } from '../builder/rest';
import { warmupGap } from '../builder/edit';
import type { BuilderInfoLookup, BuilderSetRow } from '../builder/types';
import { loadDirection, roundToAvailableLoad } from '../equipment';
import { equipmentOfRow } from './equipment-snapshot';

/**
 * Same editing as the builder, mid-workout (workout-table-v3 §7; Ben, 20
 * Oct: "should generally have same functionality as when building them").
 * Pure: what each of Ben's edits on the round page, the exercise pop-up and
 * the Workout sheet sends, as the workout's own versioned commands (rule 5),
 * today only. Nothing here changes a done set (rule 2): set drags move only
 * sets not done yet, round moves only rounds not started, and a superset
 * unlinked mid-round finishes its round first (`split_superset` keeps the
 * set Log is on).
 */

const byOrder = (a: SessionExercise, b: SessionExercise): number => a.order - b.order;

/** One round of the workout: an exercise, or a superset's members, with any gym-switch parts. */
export interface SessionRound {
  /** The first member's row ID (stable while the round exists). */
  key: string;
  members: SessionExercise[];
  /** A set of it is done or skipped: it stays where it is (§7). */
  started: boolean;
  /** Every live set is done or skipped. */
  done: boolean;
  /** A member continues on another gym's item (or is continued): its order follows its parts. */
  parted: boolean;
}

/** The workout's rounds in order (live rows; a superset is one round; a continuation part stays with its exercise). */
export function sessionRounds(state: Pick<SessionAggregate, 'exercises' | 'sets'>): SessionRound[] {
  const live = state.exercises.filter((e) => e.removed === undefined).sort(byOrder);
  const out: SessionRound[] = [];
  const byGroup = new Map<string, SessionRound>();
  for (const ex of live) {
    const parent = ex.continuesFromId === undefined ? undefined : out.find((r) => r.members.some((m) => m.id === ex.continuesFromId));
    let round: SessionRound | undefined = parent ?? (ex.supersetGroup === null ? undefined : byGroup.get(ex.supersetGroup));
    if (round === undefined) {
      round = { key: ex.id, members: [], started: false, done: false, parted: false };
      out.push(round);
      if (ex.supersetGroup !== null) byGroup.set(ex.supersetGroup, round);
    }
    round.members.push(ex);
  }
  for (const r of out) {
    const ids = new Set(r.members.map((m) => m.id));
    const sets = state.sets.filter((s) => ids.has(s.sessionExerciseId) && s.status !== 'deleted');
    r.started = sets.some((s) => s.status === 'completed' || s.status === 'skipped');
    r.done = sets.length > 0 && sets.every((s) => s.status === 'completed' || s.status === 'skipped');
    r.parted = r.members.some((m) => m.continuesFromId !== undefined || live.some((x) => x.continuesFromId === m.id));
  }
  return out;
}

const roundIndexOf = (rounds: readonly SessionRound[], sessionExerciseId: string): number => rounds.findIndex((r) => r.members.some((m) => m.id === sessionExerciseId));

interface Op {
  opId: string;
  at: ZonedTimestamp;
}

export type RoundMoveRefusal = 'not_found' | 'started' | 'crosses_started' | 'parted' | 'nowhere';

/**
 * Where a round may go (§7: only rounds not started move, and done ones stay put): every round
 * index `to` such that the round and every round it passes are not started. `from` itself is
 * excluded. Drives the drag's allowed drops and Move up / Move down.
 */
export function roundMoveTargets(rounds: readonly SessionRound[], from: number): number[] {
  const r = rounds[from];
  if (r === undefined || r.started || r.parted) return [];
  const out: number[] = [];
  for (let to = from - 1; to >= 0; to -= 1) {
    const x = rounds[to];
    if (x === undefined || x.started || x.parted) break;
    out.push(to);
  }
  for (let to = from + 1; to < rounds.length; to += 1) {
    const x = rounds[to];
    if (x === undefined || x.started || x.parted) break;
    out.push(to);
  }
  return out.sort((a, b) => a - b);
}

/**
 * `move_exercise` that puts the round holding `sessionExerciseId` at position `to` (0-based, in the
 * order after the move), or why it can't (§7). A no-op move is `nowhere`.
 */
export function moveRoundCommand(state: SessionAggregate, sessionExerciseId: string, to: number, op: Op): { ok: true; command: CommandOf<'move_exercise'> } | { ok: false; reason: RoundMoveRefusal } {
  const rounds = sessionRounds(state);
  const from = roundIndexOf(rounds, sessionExerciseId);
  const round = rounds[from];
  if (round === undefined) return { ok: false, reason: 'not_found' };
  if (round.parted) return { ok: false, reason: 'parted' };
  if (round.started) return { ok: false, reason: 'started' };
  if (to === from || to < 0 || to >= rounds.length) return { ok: false, reason: 'nowhere' };
  if (!roundMoveTargets(rounds, from).includes(to)) return { ok: false, reason: 'crosses_started' };
  const without = rounds.filter((_, i) => i !== from);
  const anchor = to === 0 ? null : without[to - 1];
  return {
    ok: true,
    command: { type: 'move_exercise', at: op.at, opId: op.opId, sessionExerciseId: round.key, afterSessionExerciseId: anchor === null || anchor === undefined ? null : (anchor.members.at(-1)?.id ?? anchor.key), expectedVersion: state.session.version },
  };
}

/** `Move up` / `Move down` on an exercise (pop-up, `⋯`, VoiceOver): its round one place, by the same rule. */
export function stepRoundCommand(state: SessionAggregate, sessionExerciseId: string, dir: 'up' | 'down', op: Op): ReturnType<typeof moveRoundCommand> {
  const from = roundIndexOf(sessionRounds(state), sessionExerciseId);
  if (from < 0) return { ok: false, reason: 'not_found' };
  return moveRoundCommand(state, sessionExerciseId, from + (dir === 'up' ? -1 : 1), op);
}

/** Whether `Move up` / `Move down` would move this exercise's round. */
export function roundSteps(state: Pick<SessionAggregate, 'exercises' | 'sets'>, sessionExerciseId: string): { up: boolean; down: boolean } {
  const rounds = sessionRounds(state);
  const from = roundIndexOf(rounds, sessionExerciseId);
  const targets = roundMoveTargets(rounds, from);
  return { up: targets.includes(from - 1), down: targets.includes(from + 1) };
}

/**
 * `Superset with next` (§7): this exercise and the next round's first exercise, as `link_superset`
 * (the reducer keeps each side's done rounds and pairs from the current one). Null when there is no
 * next round, or either side has nothing left to do.
 */
export function supersetNextCommand(state: SessionAggregate, sessionExerciseId: string, op: Op): CommandOf<'link_superset'> | null {
  const rounds = sessionRounds(state);
  const at = roundIndexOf(rounds, sessionExerciseId);
  const next = rounds[at + 1];
  const target = next?.members[0];
  if (at < 0 || target === undefined) return null;
  const pending = (id: string) => state.sets.some((s) => s.sessionExerciseId === id && s.status === 'pending');
  if (!pending(sessionExerciseId) || !next?.members.some((m) => pending(m.id))) return null;
  return { type: 'link_superset', at: op.at, opId: op.opId, expectedVersion: state.session.version, sessionExerciseId: target.id, withSessionExerciseId: sessionExerciseId };
}

/**
 * The drag's drop onto another exercise in the Workout sheet (§7): a superset of the two, as
 * `link_superset`. Null when it's the same round.
 */
export function pairWithCommand(state: SessionAggregate, sessionExerciseId: string, withSessionExerciseId: string, op: Op): CommandOf<'link_superset'> | null {
  const rounds = sessionRounds(state);
  if (roundIndexOf(rounds, sessionExerciseId) === roundIndexOf(rounds, withSessionExerciseId)) return null;
  return { type: 'link_superset', at: op.at, opId: op.opId, expectedVersion: state.session.version, sessionExerciseId, withSessionExerciseId };
}

/** A superset whose current round is half done (a member done in it, another not): `Unlink` finishes that round first (§7). */
export function supersetMidRound(state: Pick<SessionAggregate, 'exercises' | 'sets'>, sessionExerciseId: string): boolean {
  const rounds = sessionRounds(state);
  const round = rounds[roundIndexOf(rounds, sessionExerciseId)];
  if (round === undefined || round.members.length < 2) return false;
  const doneCounts = round.members.map((m) => state.sets.filter((s) => s.sessionExerciseId === m.id && s.pairedWithSetId === null && (s.status === 'completed' || s.status === 'skipped')).length + (m.roundOffset ?? 0));
  return new Set(doneCounts).size > 1 && round.members.some((m) => state.sets.some((s) => s.sessionExerciseId === m.id && s.status === 'pending'));
}

// ---------------------------------------------------------------------------
// Sets

/** The sets a drag can move: not done yet, and not the other side of a half-logged pair (it stays with its partner). */
export function movableSetIds(state: Pick<SessionAggregate, 'sets'>, sessionExerciseId: string): string[] {
  const own = state.sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status !== 'deleted').sort((a, b) => a.index - b.index);
  return own.filter((s) => s.status === 'pending' && s.pairedWithSetId === null && !own.some((c) => c.pairedWithSetId === s.id)).map((s) => s.id);
}

/** `reorder_sets` with `setId` at position `to` among the movable sets; null when nothing changes. */
export function moveSetCommand(state: SessionAggregate, setId: string, to: number, op: Op): CommandOf<'reorder_sets'> | null {
  const set = state.sets.find((s) => s.id === setId);
  if (set === undefined) return null;
  const ids = movableSetIds(state, set.sessionExerciseId);
  const from = ids.indexOf(setId);
  if (from < 0 || ids.length < 2) return null;
  const clamped = Math.max(0, Math.min(ids.length - 1, to));
  if (clamped === from) return null;
  const next = ids.filter((id) => id !== setId);
  next.splice(clamped, 0, setId);
  return { type: 'reorder_sets', at: op.at, opId: op.opId, sessionExerciseId: set.sessionExerciseId, setIds: next, expectedVersion: state.session.version };
}

/** `Move up` / `Move down` on a set (VoiceOver, long-press menu): one place among the sets not done yet. */
export function stepSetCommand(state: SessionAggregate, setId: string, dir: 'up' | 'down', op: Op): CommandOf<'reorder_sets'> | null {
  const set = state.sets.find((s) => s.id === setId);
  if (set === undefined) return null;
  const from = movableSetIds(state, set.sessionExerciseId).indexOf(setId);
  if (from < 0) return null;
  return moveSetCommand(state, setId, from + (dir === 'up' ? -1 : 1), op);
}

/** Whether a set can move up / down among the sets not done yet. */
export function setMoveSteps(state: Pick<SessionAggregate, 'sets'>, setId: string): { up: boolean; down: boolean } {
  const set = state.sets.find((s) => s.id === setId);
  if (set === undefined) return { up: false, down: false };
  const ids = movableSetIds(state, set.sessionExerciseId);
  const at = ids.indexOf(setId);
  return { up: at > 0, down: at >= 0 && at < ids.length - 1 };
}

export type AddWarmupRefusal = 'not_found' | 'done' | 'max_warmups' | 'no_load' | 'no_gap';

const RAMP_CONVENTIONS: ReadonlySet<Load['convention']> = new Set(['total', 'per_hand', 'stack']);

/**
 * `＋ Warm-up` mid-workout (§7, the builder's rule `warmupGap`): the biggest gap in the ramp up to
 * the first working load, rounded down on the row's own item (rule 4). Only for loads on an item
 * with the reps/RPE formula (not assisted, added weight or bodyweight), at most 4 warm-ups.
 */
export function addWarmupCommand(state: SessionAggregate, sessionExerciseId: string, op: Op & { newSetId: string }): { ok: true; command: CommandOf<'add_warmup'> } | { ok: false; reason: AddWarmupRefusal } {
  const ex = state.exercises.find((e) => e.id === sessionExerciseId && e.removed === undefined);
  if (ex === undefined) return { ok: false, reason: 'not_found' };
  const own = state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted').sort((a, b) => a.index - b.index);
  if (!own.some((s) => s.status === 'pending' && s.setType !== 'warmup')) return { ok: false, reason: 'done' };
  const warm = own.filter((s) => s.setType === 'warmup');
  if (warm.length >= BUILD_LIMITS.maxWarmups) return { ok: false, reason: 'max_warmups' };
  const loadOf = (s: WorkoutSet): Load | null => s.actual?.load ?? s.draft?.load ?? s.planned.load;
  const work = own.find((s) => s.status === 'pending' && s.setType !== 'warmup') ?? own.find((s) => s.setType !== 'warmup');
  const top = work === undefined ? null : loadOf(work);
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  if (top === null || eq === null || !RAMP_CONVENTIONS.has(top.convention) || loadDirection(top.convention) !== 'resistance' || top.convention !== eq.loadConvention || top.unit !== ex.unit) {
    return { ok: false, reason: 'no_load' };
  }
  const roundDown = (v: number): number | null => {
    const r = roundToAvailableLoad({ value: v, unit: top.unit, convention: top.convention }, eq, 'down');
    return r.ok && r.load.value <= v + 1e-9 ? r.load.value : null;
  };
  const gap = warmupGap(
    warm.map((s) => loadOf(s)?.value ?? 0),
    top.value,
    roundDown,
  );
  if (gap === null) return { ok: false, reason: 'no_gap' };
  const planned: PlannedSet = { load: { value: gap.load, unit: top.unit, convention: top.convention }, reps: { min: gap.reps, max: gap.reps }, durationS: null, rpe: null, rir: null };
  return {
    ok: true,
    command: {
      type: 'add_warmup',
      at: op.at,
      opId: op.opId,
      sessionExerciseId: ex.id,
      newSetId: op.newSetId,
      planned,
      restS: warm[0]?.rest.seconds ?? BUILDER_REST_DEFAULTS.warmup,
      expectedVersion: state.session.version,
    },
  };
}

/** Whether `＋ Warm-up` can add one (disabled at 4, or with no ramp to fill). */
export function canAddWarmupNow(state: SessionAggregate, sessionExerciseId: string): boolean {
  return addWarmupCommand(state, sessionExerciseId, { opId: 'probe', at: state.session.startedAt, newSetId: 'probe' }).ok;
}

/**
 * `Remove` from `⋯` (§7): with logged sets Ben is asked first (`loggedSets` > 0) and they stay in
 * history; without, it goes at once with Undo.
 */
export function removeExerciseCommand(state: SessionAggregate, sessionExerciseId: string, op: Op): { command: CommandOf<'remove_exercise'>; loggedSets: number } {
  const loggedSets = state.sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status === 'completed').length;
  return {
    loggedSets,
    command: { type: 'remove_exercise', at: op.at, opId: op.opId, sessionExerciseId, expectedVersion: state.session.version, ...(loggedSets > 0 ? { confirmedLoggedSets: loggedSets } : {}) },
  };
}

/** `set_rest_after` for the pop-up's rest per set type; in a superset, `After each round` (the last member's rest). */
export function typeRestCommand(state: SessionAggregate, sessionExerciseId: string, kind: SetType | 'round', seconds: number, op: Op): CommandOf<'set_rest_after'> | null {
  if (kind === 'round') {
    const rounds = sessionRounds(state);
    const last = rounds[roundIndexOf(rounds, sessionExerciseId)]?.members.at(-1);
    const set = last === undefined ? undefined : state.sets.find((s) => s.sessionExerciseId === last.id && s.status === 'pending');
    return set === undefined ? null : { type: 'set_rest_after', at: op.at, opId: op.opId, setId: set.id, seconds, scope: 'exercise', expectedVersion: state.session.version };
  }
  const set = state.sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status === 'pending' && s.setType === kind).sort((a, b) => a.index - b.index)[0];
  return set === undefined ? null : { type: 'set_rest_after', at: op.at, opId: op.opId, setId: set.id, seconds, scope: 'type', expectedVersion: state.session.version };
}

// ---------------------------------------------------------------------------
// Advice and builder loads

/** The rounds still to do, as the builder's advice reads them (keyed by session row). */
export function sessionAdviceBlocks(state: Pick<SessionAggregate, 'exercises' | 'sets'>): AdviceBlock[] {
  return sessionRounds(state)
    .filter((r) => !r.done)
    .map((r) => ({ slots: r.members.filter((m) => m.continuesFromId === undefined).map((m) => ({ key: m.id, exerciseId: m.exerciseId })) }));
}

/**
 * Ben's own change mid-workout (§7): the builder's "not recommended because…" for what it newly
 * made, or null. Advice never blocks or undoes the change; only the hard rules (equipment limits,
 * pain flags) refuse, in the reducer and the services.
 */
export function adviseSessionChange(before: Pick<SessionAggregate, 'exercises' | 'sets'>, after: Pick<SessionAggregate, 'exercises' | 'sets'>, info: BuilderInfoLookup): BuilderAdvice | null {
  return adviseAfter(adviseBuilder(sessionAdviceBlocks(before), info), adviseBuilder(sessionAdviceBlocks(after), info));
}

/**
 * The builder's rows for an exercise (§9 Q12 load sources, rounded down on the gym's item) as the
 * planned sets an added or swapped exercise starts with: exact reps, the row's target RPE, the load
 * in the item's unit and convention (explicit kg/lb and convention, rule 4).
 */
export function plannedFromBuilderRows(rows: readonly BuilderSetRow[], frame: { unit: Load['unit']; convention: Load['convention'] }): { setType: SetType; planned: PlannedSet }[] {
  return rows.map((r) => ({
    setType: r.type,
    planned: {
      load: r.load === null ? null : { value: r.load, unit: frame.unit, convention: frame.convention },
      reps: { min: r.reps, max: r.reps },
      durationS: null,
      rpe: r.type === 'warmup' ? null : r.rpe,
      rir: null,
    },
  }));
}

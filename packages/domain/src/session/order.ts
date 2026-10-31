import type { SessionExercise, WorkoutSet } from '@fizz/schemas';

interface Block {
  group: string | null;
  members: SessionExercise[];
}

function blocks(exercises: readonly SessionExercise[]): Block[] {
  const sorted = [...exercises].sort((a, b) => a.order - b.order);
  const out: Block[] = [];
  const byGroup = new Map<string, Block>();
  for (const ex of sorted) {
    if (ex.supersetGroup === null) {
      out.push({ group: null, members: [ex] });
      continue;
    }
    const existing = byGroup.get(ex.supersetGroup);
    if (existing) existing.members.push(ex);
    else {
      const block = { group: ex.supersetGroup, members: [ex] };
      byGroup.set(ex.supersetGroup, block);
      out.push(block);
    }
  }
  return out;
}

/**
 * One exercise's sets grouped into units, in execution order. A unit is a set
 * plus the other-side rows paired with it (review T1): the other side is
 * performed immediately after its partner and belongs to the same superset
 * round. A companion whose partner was deleted keeps the partner's position.
 * Deleted tombstones take no place in the order.
 */
function unitsOf(sets: readonly WorkoutSet[], exerciseId: string): WorkoutSet[][] {
  const own = sets.filter((s) => s.sessionExerciseId === exerciseId).sort((a, b) => a.index - b.index);
  const ids = new Set(own.map((s) => s.id));
  const isHead = (s: WorkoutSet) => s.pairedWithSetId === null || !ids.has(s.pairedWithSetId);
  const units: WorkoutSet[][] = [];
  for (const head of own.filter(isHead)) {
    const unit = [head, ...own.filter((s) => !isHead(s) && s.pairedWithSetId === head.id)].filter((s) => s.status !== 'deleted');
    if (unit.length > 0) units.push(unit);
  }
  return units;
}

/** One exercise row's sets as units (a set plus its paired other side), in round order: the Table's superset rounds. */
export function setUnits(sets: readonly WorkoutSet[], sessionExerciseId: string, roundOffset = 0): WorkoutSet[][] {
  return [...Array.from({ length: roundOffset }, (): WorkoutSet[] => []), ...unitsOf(sets, sessionExerciseId)];
}

/** A superset member's units by round: the rounds it sits out first (`roundOffset`, a row paired mid-workout), then its own. */
function roundUnits(sets: readonly WorkoutSet[], ex: SessionExercise): WorkoutSet[][] {
  return setUnits(sets, ex.id, ex.supersetGroup === null ? 0 : (ex.roundOffset ?? 0));
}

/** The most rounds a superset row can sit out (the schema's and the table's cap). */
export const MAX_ROUND_OFFSET = 60;

function firstPending(units: readonly WorkoutSet[][]): number {
  const i = units.findIndex((u) => u.some((s) => s.status === 'pending'));
  return i < 0 ? units.length : i;
}

/** The first round (offset included, in a superset) in which a row still has a set not done. */
export function firstPendingRound(sets: readonly WorkoutSet[], ex: SessionExercise): number {
  return firstPending(roundUnits(sets, ex));
}

/**
 * The offset that puts a row joining a superset in the group's current round
 * (the first round with a set not done yet), so A3 is followed by B1 rather
 * than B1 pairing with the done A1. Never negative (a row with more done than
 * the group starts where it is), never past `MAX_ROUND_OFFSET`.
 */
export function joinRoundOffset(members: readonly SessionExercise[], sets: readonly WorkoutSet[], joiner: SessionExercise): number {
  const rounds = members.filter((m) => m.id !== joiner.id).map((m) => firstPending(roundUnits(sets, m)));
  if (rounds.length === 0) return 0;
  return Math.min(MAX_ROUND_OFFSET, Math.max(0, Math.min(...rounds) - firstPending(unitsOf(sets, joiner.id))));
}

/** The rounds a row sits out, as the order reads it (none outside a superset). */
export function effectiveOffset(e: SessionExercise): number {
  return e.supersetGroup === null ? 0 : (e.roundOffset ?? 0);
}

/**
 * Linking two rows into a superset (`link_superset`, review B1), whichever is named first: each
 * side is the row, or its whole superset. The side further along (a later current round; on a tie
 * the superset already there, else the earlier row) leads and stays in place; the other side lags,
 * moves to straight after it and sits out `shift` more rounds.
 */
export function supersetLinkSides(
  exercises: readonly SessionExercise[],
  sets: readonly WorkoutSet[],
  a: SessionExercise,
  b: SessionExercise,
): { lead: SessionExercise[]; lag: SessionExercise[]; shift: number } {
  const sideOf = (row: SessionExercise): SessionExercise[] =>
    row.supersetGroup === null ? [row] : exercises.filter((e) => e.removed === undefined && e.supersetGroup === row.supersetGroup).sort((x, y) => x.order - y.order);
  const sideA = sideOf(a);
  const sideB = sideOf(b);
  const round = (side: readonly SessionExercise[]): number => Math.min(...side.map((m) => firstPendingRound(sets, m)));
  const roundA = round(sideA);
  const roundB = round(sideB);
  const aLeads =
    roundA !== roundB
      ? roundA > roundB
      : (a.supersetGroup === null) !== (b.supersetGroup === null)
        ? a.supersetGroup !== null
        : (sideA[0]?.order ?? a.order) < (sideB[0]?.order ?? b.order);
  return aLeads ? { lead: sideA, lag: sideB, shift: roundA - roundB } : { lead: sideB, lag: sideA, shift: roundB - roundA };
}

/**
 * The order sets are performed in. Plain exercises run all their sets in
 * order; superset members interleave round by round (A1 s1, A2 s1, A1 s2 …).
 * A superset is positioned where its first member appears. The other side of a
 * single-side log comes straight after its partner (A1 L, A1 R, A2 s1 …).
 */
export function buildExecutionOrder(
  exercises: readonly SessionExercise[],
  sets: readonly WorkoutSet[],
): string[] {
  const order: string[] = [];
  for (const block of blocks(exercises)) {
    const memberUnits = block.members.map((m) => (block.group === null ? unitsOf(sets, m.id) : roundUnits(sets, m)));
    const rounds = Math.max(0, ...memberUnits.map((u) => u.length));
    for (let r = 0; r < rounds; r += 1) {
      for (const units of memberUnits) {
        for (const set of units[r] ?? []) order.push(set.id);
      }
    }
  }
  return order;
}

/**
 * Each live set's number as the set card, toast and correction sheet show it
 * (`Set 4`): its place among its exercise's live sets, warm-ups included, in
 * execution order. `Why?` stores it with a basis set so `Not used` names the
 * same set later (review N1).
 */
export function setDisplayNumbers(exercises: readonly SessionExercise[], sets: readonly WorkoutSet[]): Map<string, number> {
  const order = buildExecutionOrder(exercises, sets);
  const pos = new Map(order.map((id, i) => [id, i]));
  const out = new Map<string, number>();
  for (const ex of exercises) {
    const own = sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted').sort((a, b) => (pos.get(a.id) ?? a.index + 1e6) - (pos.get(b.id) ?? b.index + 1e6));
    own.forEach((s, i) => out.set(s.id, i + 1));
  }
  return out;
}

/** A set's name on the active workout (workout-table-v3 §2): `Set 3`, or `Warm-up`. */
export interface SetStep {
  /** The working-set number; null for a warm-up. */
  number: number | null;
  /** `Set 3` / `Warm-up`: what the table row, the Log pill, every toast and sheet title call it. */
  name: string;
  /** The other side of a single-side log: it shares its partner's number and isn't a set of its own. */
  companion: boolean;
}

/**
 * The one numbering the active workout uses everywhere (wo-v3 reviews B1/B2):
 * one block's live sets in execution order, working sets numbered 1..n,
 * warm-ups named `Warm-up` and not counted, and the other side of a
 * single-side log (`pairedWithSetId`) taking its partner's number (a pair is
 * one prescribed set). A companion whose partner is gone counts as its own.
 */
export function setSteps(ordered: readonly { id: string; setType: WorkoutSet['setType']; pairedWithSetId: string | null }[]): Map<string, SetStep> {
  const out = new Map<string, SetStep>();
  let n = 0;
  for (const s of ordered) {
    const head = s.pairedWithSetId === null ? undefined : out.get(s.pairedWithSetId);
    if (head !== undefined) {
      out.set(s.id, { number: head.number, name: head.name, companion: true });
    } else if (s.setType === 'warmup') {
      out.set(s.id, { number: null, name: 'Warm-up', companion: false });
    } else {
      n += 1;
      out.set(s.id, { number: n, name: `Set ${String(n)}`, companion: false });
    }
  }
  return out;
}

/**
 * The set type `＋ Set` copies (workout-table-v3 §2: "a set like the last
 * working set"; wo-v3 logic S5): the type of the row's last live set that
 * isn't a warm-up or a drop set, so a plan ending in a drop adds another
 * back-off, not another drop. Null (copy the last live set) when the row has
 * only warm-ups or drops.
 */
export function plusSetType(sets: readonly WorkoutSet[], sessionExerciseId: string): WorkoutSet['setType'] | null {
  const own = sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status !== 'deleted').sort((a, b) => a.index - b.index);
  return own.filter((s) => s.setType !== 'warmup' && s.setType !== 'drop').at(-1)?.setType ?? null;
}

/**
 * For a superset set: true when no later member of the group still has a
 * pending set in the same round. An other-side row is in its partner's round.
 * Plain exercises are always at a round end.
 */
export function isRoundEnd(
  set: WorkoutSet,
  exercises: readonly SessionExercise[],
  sets: readonly WorkoutSet[],
): boolean {
  const own = exercises.find((e) => e.id === set.sessionExerciseId);
  if (!own || own.supersetGroup === null) return true;
  const group = own.supersetGroup;
  const later = exercises.filter((e) => e.supersetGroup === group && e.order > own.order);
  const round = roundUnits(sets, own).findIndex((u) => u.some((s) => s.id === set.id));
  return !later.some((ex) => roundUnits(sets, ex)[round]?.some((s) => s.status === 'pending') ?? false);
}

/**
 * Next pending set after `fromSetId` in execution order, wrapping to the first
 * pending set before it (out-of-order logging). Null when none remain.
 *
 * `orderFrom` is the set list the order is built from (default `sets`). Pass
 * the sets from before a deletion so a just-deleted `fromSetId` still has a
 * position and the search continues after it (review re-review minor 1).
 */
export function nextPendingSet(
  fromSetId: string | null,
  exercises: readonly SessionExercise[],
  sets: readonly WorkoutSet[],
  orderFrom: readonly WorkoutSet[] = sets,
): string | null {
  const order = buildExecutionOrder(exercises, orderFrom);
  const pending = new Set(sets.filter((s) => s.status === 'pending').map((s) => s.id));
  const start = fromSetId === null ? -1 : order.indexOf(fromSetId);
  for (let i = start + 1; i < order.length; i += 1) {
    const id = order[i];
    if (id !== undefined && pending.has(id)) return id;
  }
  for (let i = 0; i <= start && i < order.length; i += 1) {
    const id = order[i];
    if (id !== undefined && pending.has(id)) return id;
  }
  return null;
}

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
    const memberUnits = block.members.map((m) => unitsOf(sets, m.id));
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
  const later = exercises
    .filter((e) => e.supersetGroup === group && e.order > own.order)
    .map((e) => e.id);
  const round = unitsOf(sets, own.id).findIndex((u) => u.some((s) => s.id === set.id));
  return !later.some((exId) => unitsOf(sets, exId)[round]?.some((s) => s.status === 'pending') ?? false);
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

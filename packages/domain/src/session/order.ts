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

function setsOf(sets: readonly WorkoutSet[], exerciseId: string): WorkoutSet[] {
  return sets.filter((s) => s.sessionExerciseId === exerciseId).sort((a, b) => a.index - b.index);
}

/**
 * The order sets are performed in. Plain exercises run all their sets in
 * order; superset members interleave round by round (A1 s1, A2 s1, A1 s2 …).
 * A superset is positioned where its first member appears.
 */
export function buildExecutionOrder(
  exercises: readonly SessionExercise[],
  sets: readonly WorkoutSet[],
): string[] {
  const order: string[] = [];
  for (const block of blocks(exercises)) {
    const memberSets = block.members.map((m) => setsOf(sets, m.id));
    const rounds = Math.max(0, ...memberSets.map((s) => s.length));
    for (let r = 0; r < rounds; r += 1) {
      for (const ms of memberSets) {
        const set = ms[r];
        if (set) order.push(set.id);
      }
    }
  }
  return order;
}

/**
 * For a superset set: true when no later member of the group still has a
 * pending set in the same round. Plain exercises are always at a round end.
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
  const round = setsOf(sets, own.id).findIndex((s) => s.id === set.id);
  return !later.some((exId) => setsOf(sets, exId)[round]?.status === 'pending');
}

/**
 * Next pending set after `fromSetId` in execution order, wrapping to the first
 * pending set before it (out-of-order logging). Null when none remain.
 */
export function nextPendingSet(
  fromSetId: string | null,
  exercises: readonly SessionExercise[],
  sets: readonly WorkoutSet[],
): string | null {
  const order = buildExecutionOrder(exercises, sets);
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

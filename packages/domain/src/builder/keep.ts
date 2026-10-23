import { MAX_WORKOUT_DRAFT_OPS, type KeepNextTime, type RoutineExercise, type SetTemplate, type WorkoutDraft, type ZonedTimestamp } from '@fizz/schemas';
import type { DraftLifeChange } from '../session/coach-draft';
import { deriveId } from '../stable';
import type { BuilderChange } from './scope';

/**
 * Summary's `Keep for next time?` (Ben, 23 Oct, D1). Pure.
 *
 * Start always starts, today only. When the workout Ben did (as he left it at Start, with what Time cut put back:
 * a short day isn't a new plan) differs in **structure** from the plan day or saved workout it opened as (an exercise
 * swapped, added or removed, or a set count changed), the Summary offers one row. Apply writes exactly those changes
 * to that plan day or saved workout, nothing else:
 *
 * - `keepDiff`: the changes, matched through each exercise's `origin` (the one it opened as, kept by a swap).
 * - `keptExercises`: the routine's exercises with them: a swap takes the old one's place and superset, a removal
 *   leaves, a set count changes in place, an add goes after the exercise before it in Ben's order (in its superset if
 *   he paired it). Every other exercise keeps its own set types, reps, loads, rests and order. Exercises the workout
 *   couldn't open stay as they are.
 * - `keepNextTimeMark`: the answer (Apply, Skip, Undo) on the started builder draft, versioned and idempotent.
 */

export type KeepChange = Extract<BuilderChange, { kind: 'swap' | 'add' | 'delete' | 'sets' }>;

/** One exercise of the plan day or saved workout as the workout opened it, in order. `ref`: its routine exercise ID. */
export interface KeepBaseItem {
  exerciseId: string;
  workingSets: number;
  ref: string;
}

/**
 * One exercise of the workout as Ben left it at Start (Time put back), in order. `origin`: the exercise it opened as
 * (a swap keeps it); null or unknown: added. `round`: its round (a superset is one round).
 */
export interface KeepCurrentItem {
  key: string;
  exerciseId: string;
  workingSets: number;
  origin: string | null;
  round: number;
}

export interface KeepDiff {
  /** Swaps, adds, removals, then set counts (as the Start prompt listed them). Empty: nothing to keep. */
  changes: KeepChange[];
  /** Per current item, the base item it opened as; null: added. */
  matchOf: (number | null)[];
  /** Base items no current item opened as: removed. */
  deleted: number[];
}

export function keepDiff(base: readonly KeepBaseItem[], current: readonly KeepCurrentItem[]): KeepDiff {
  const used = new Set<number>();
  const matchOf: (number | null)[] = current.map(() => null);
  const claim = (i: number, exerciseId: string): void => {
    const j = base.findIndex((b, k) => !used.has(k) && b.exerciseId === exerciseId);
    if (j < 0) return;
    used.add(j);
    matchOf[i] = j;
  };
  // What each exercise opened as first (a swap keeps its origin), then the same exercise with no origin of its own.
  current.forEach((c, i) => {
    if (c.origin !== null) claim(i, c.origin);
  });
  current.forEach((c, i) => {
    if (matchOf[i] === null) claim(i, c.exerciseId);
  });
  const swaps: KeepChange[] = [];
  const adds: KeepChange[] = [];
  const sets: KeepChange[] = [];
  current.forEach((c, i) => {
    const j = matchOf[i];
    const b = j === null || j === undefined ? undefined : base[j];
    if (b === undefined) {
      adds.push({ kind: 'add', exerciseId: c.exerciseId });
      return;
    }
    if (b.exerciseId !== c.exerciseId) swaps.push({ kind: 'swap', from: b.exerciseId, to: c.exerciseId });
    if (b.workingSets !== c.workingSets) sets.push({ kind: 'sets', exerciseId: c.exerciseId, from: b.workingSets, to: c.workingSets });
  });
  const deleted = base.flatMap((_, k) => (used.has(k) ? [] : [k]));
  const removals: KeepChange[] = deleted.flatMap((k) => {
    const b = base[k];
    return b === undefined ? [] : [{ kind: 'delete' as const, exerciseId: b.exerciseId }];
  });
  return { changes: [...swaps, ...adds, ...removals, ...sets], matchOf, deleted };
}

const isWork = (t: Pick<SetTemplate, 'setType'>): boolean => t.setType !== 'warmup';

/**
 * A routine exercise with `n` working sets (warm-ups follow the exercise), as the builder's `setWorkingCount` does:
 * more copies the last straight set (a top set's copy is a back-off) before any trailing drop sets; fewer removes the
 * last set that isn't the top set. New set IDs come from `seed`.
 */
export function withWorkingSets(e: RoutineExercise, n: number, seed: string): RoutineExercise {
  const target = Math.max(1, Math.round(n));
  const out = [...e.setTemplates];
  let made = 0;
  while (out.filter(isWork).length < target && out.length < 30) {
    const work = out.filter(isWork);
    const last = [...work].reverse().find((t) => t.setType !== 'drop') ?? work[work.length - 1];
    if (last === undefined) break;
    const copy: SetTemplate = { ...last, id: deriveId(`${seed}:set:${String(made)}`), setType: last.setType === 'top' ? 'backoff' : last.setType };
    made += 1;
    let at = out.length;
    while (at > 0 && out[at - 1]?.setType === 'drop') at -= 1;
    out.splice(at, 0, copy);
  }
  while (out.filter(isWork).length > target) {
    const work = out.filter(isWork);
    const drop = [...work].reverse().find((t) => t.setType !== 'top') ?? work[work.length - 1];
    if (drop === undefined) break;
    out.splice(out.indexOf(drop), 1);
  }
  return { ...e, setTemplates: out };
}

export interface KeptExercisesInput {
  /** The plan day's or saved workout's exercises as stored (the version the workout opened). */
  before: readonly RoutineExercise[];
  base: readonly KeepBaseItem[];
  current: readonly KeepCurrentItem[];
  diff: KeepDiff;
  /** The routine exercise for an exercise swapped in or added (its sets from the workout, loads automatic). */
  entryFor: (item: KeepCurrentItem) => RoutineExercise;
  /** The write's op ID: new IDs derive from it, so a retry makes the same ones. */
  opId: string;
  atUtc: string;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function keptExercises(i: KeptExercisesInput): RoutineExercise[] {
  const before = [...i.before].sort((a, b) => a.order - b.order);
  const baseOfRef = new Map(i.base.map((b, k) => [b.ref, k] as const));
  const currentOfBase = new Map<number, number>();
  i.diff.matchOf.forEach((j, c) => {
    if (j !== null) currentOfBase.set(j, c);
  });
  const deleted = new Set(i.diff.deleted);
  const changed = (e: RoutineExercise): RoutineExercise => ({ ...e, structureChangedAtUtc: i.atUtc });
  /** The result in order; `item`: the current item each entry is (none: left as it was, not opened). */
  const out: { entry: RoutineExercise; item: number | null }[] = [];
  for (const e of before) {
    const k = baseOfRef.get(e.id);
    if (k === undefined) {
      out.push({ entry: e, item: null });
      continue;
    }
    if (deleted.has(k)) continue;
    const c = currentOfBase.get(k);
    const item = c === undefined ? undefined : i.current[c];
    if (c === undefined || item === undefined) {
      out.push({ entry: e, item: null });
      continue;
    }
    if (item.exerciseId !== e.exerciseId) {
      // A swap: the new exercise in the old one's place and superset, a main lift's place staying a main lift's.
      const fresh = i.entryFor(item);
      const swapped: RoutineExercise = { ...fresh, id: deriveId(`keep-ex:${i.opId}:${item.key}`), supersetGroup: e.supersetGroup, ...(e.main === undefined ? {} : { main: e.main }) };
      out.push({ entry: changed(swapped), item: c });
      continue;
    }
    const was = i.base[k]?.workingSets;
    out.push({ entry: was !== undefined && was !== item.workingSets ? changed(withWorkingSets(e, item.workingSets, `keep-ex:${i.opId}:${e.id}`)) : e, item: c });
  }
  // Adds, in Ben's order: after the exercise before it (and that one's superset), or with its superset partner.
  const used = new Set(out.flatMap((o) => (o.entry.supersetGroup === null ? [] : [o.entry.supersetGroup])));
  const freshLetter = (): string | null => {
    for (const l of LETTERS) if (!used.has(l)) return l;
    return null;
  };
  const placeOf = (c: number): number => out.findIndex((o) => o.item === c);
  /** The last entry of the superset `at` is in (or `at` itself). */
  const groupEnd = (at: number): number => {
    const g = out[at]?.entry.supersetGroup ?? null;
    let end = at;
    while (g !== null && out[end + 1]?.entry.supersetGroup === g) end += 1;
    return end;
  };
  i.diff.matchOf.forEach((j, c) => {
    if (j !== null) return;
    const item = i.current[c];
    if (item === undefined) return;
    const fresh: RoutineExercise = { ...i.entryFor(item), id: deriveId(`keep-ex:${i.opId}:${item.key}`), supersetGroup: null };
    const partner = i.current.findIndex((x, n) => n !== c && x.round === item.round && placeOf(n) >= 0);
    if (partner >= 0) {
      const at = placeOf(partner);
      const p = out[at];
      if (p !== undefined) {
        let group = p.entry.supersetGroup;
        if (group === null) {
          group = freshLetter();
          if (group !== null) {
            used.add(group);
            out[at] = { entry: changed({ ...p.entry, supersetGroup: group }), item: p.item };
          }
        }
        out.splice(groupEnd(at) + 1, 0, { entry: changed({ ...fresh, supersetGroup: group }), item: c });
        return;
      }
    }
    let prev = -1;
    for (let n = c - 1; n >= 0 && prev < 0; n -= 1) prev = placeOf(n);
    out.splice(prev < 0 ? 0 : groupEnd(prev) + 1, 0, { entry: changed(fresh), item: c });
  });
  return out.map((o, n) => (o.entry.order === n ? o.entry : { ...o.entry, order: n }));
}

/** What Summary's row wrote: Apply (with the write's inverse), Skip, or Undo of an Apply. */
export type KeepMark = { kind: 'kept'; undo: NonNullable<KeepNextTime['undo']> } | { kind: 'skipped' } | { kind: 'undone' };

/**
 * `keepNextTimeMark`: the answer on the started builder draft that became `sessionId`. One answer per workout (Apply
 * or Skip); Undo only of an Apply not undone yet. A repeated op ID is `duplicate`; an answer already there is
 * `stale` (rule 5).
 */
export function keepNextTimeMark(current: WorkoutDraft, m: { sessionId: string; opId: string; at: ZonedTimestamp; mark: KeepMark }): DraftLifeChange {
  if (current.opIds.includes(m.opId)) return { kind: 'duplicate', current };
  if (current.builderKey === undefined || current.status !== 'started' || current.sessionId !== m.sessionId) return { kind: 'invalid', reason: 'not the started workout' };
  const had = current.keepNextTime;
  let next: KeepNextTime;
  if (m.mark.kind === 'undone') {
    if (had?.choice !== 'kept' || had.undoneOpId !== undefined) return { kind: 'stale', current };
    next = { ...had, undoneOpId: m.opId };
  } else {
    if (had !== undefined) return { kind: 'stale', current };
    next = m.mark.kind === 'kept' ? { choice: 'kept', opId: m.opId, atUtc: m.at.utc, undo: m.mark.undo } : { choice: 'skipped', opId: m.opId, atUtc: m.at.utc };
  }
  return {
    kind: 'write',
    next: { ...current, keepNextTime: next, opIds: [...current.opIds, m.opId].slice(-MAX_WORKOUT_DRAFT_OPS), version: current.version + 1, updatedAtUtc: m.at.utc },
    expectedVersion: current.version,
  };
}

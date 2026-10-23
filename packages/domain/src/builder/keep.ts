import { BUILD_LIMITS, MAX_WORKOUT_DRAFT_OPS, type KeepMainLift, type KeepNextTime, type Routine, type RoutineExercise, type SetTemplate, type WorkoutDraft, type ZonedTimestamp } from '@fizz/schemas';
import type { DraftLifeChange } from '../session/coach-draft';
import { deriveId } from '../stable';
import { slotsOf } from './arrange';
import { workingCount } from './set-rows';
import type { BuilderChange } from './scope';
import type { BuilderKeepMarks, BuilderSlot, BuilderWorkout } from './types';

/**
 * Summary's `Keep for next time?` (Ben, 23 Oct, D1). Pure.
 *
 * Start always starts, today only. When Ben himself changed the workout's structure on Your workout or Set up (he
 * swapped, added or removed an exercise, or changed a set count), the Summary offers one row; Apply writes exactly
 * those changes to the plan day or saved workout the workout opened, nothing else. Only Ben's own edits count
 * (review batch23 B1–B3): Today's card and its controls (Time included), Your workout's Time, a gym change's swaps and
 * the coach's changes (a pre-session offer, a review, a next-workout change landed under D8) are today's, never listed.
 *
 * - `markBenEdit`: after one of Ben's edits, his marks on the slots it changed (`BuilderSlot.keep`) and the exercises
 *   he removed (kept on the set-up, `keepRemoved`).
 * - `keepDiff`: the plan day's or saved workout's exercises against the workout as Ben left it (Time's cuts put back),
 *   read through his marks: a swap he made of an exercise it opened with, an exercise he added, one he removed, and a
 *   set count he changed, as the stored count plus his change (Today's top set + back-offs, or a set Time cut, is never
 *   a change). The plan day's main lift is never swapped or removed by Keep (it names the plan day; SP7, Ben to decide).
 * - `keptExercises`: the routine's exercises with them: a swap takes the old one's place and superset (its `Main` by
 *   the rule), a removal
 *   leaves, a set count changes in place, an add goes after the exercise before it in Ben's order (in its superset if
 *   he paired it). Every other exercise keeps its own set types, reps, loads, rests and order.
 * - `keepNextTimeMark`: the answer (Apply, Skip, Undo) on the started builder draft, versioned and idempotent.
 */

export type KeepChange = Extract<BuilderChange, { kind: 'swap' | 'add' | 'delete' | 'sets' }>;

const clampSets = (n: number): number => Math.max(BUILD_LIMITS.minWorkingSets, Math.min(BUILD_LIMITS.maxWorkingSets, Math.round(n)));

/** A slot's marks with only the fields set (none: undefined). */
function withKeep(s: BuilderSlot, k: BuilderKeepMarks): BuilderSlot {
  const out: BuilderSlot = { ...s };
  delete out.keep;
  const marks: BuilderKeepMarks = {};
  if (k.added === true) marks.added = true;
  if (k.from !== undefined) marks.from = k.from;
  if (k.setsFrom !== undefined) marks.setsFrom = clampSets(k.setsFrom);
  return Object.keys(marks).length === 0 ? out : { ...out, keep: marks };
}

/**
 * The exercise a slot Ben removes takes out of the plan day or saved workout: the one it opened as (`origin`), else
 * the one before his swap, else its own. Null for an exercise he added himself (nothing to remove there).
 */
export function benRemovalOf(s: Pick<BuilderSlot, 'exerciseId' | 'origin' | 'keep'>): string | null {
  if (s.keep?.added === true) return null;
  return s.origin ?? s.keep?.from ?? s.exerciseId;
}

/** Slots Ben added through Set up (a group count he raised): marked as his adds. */
export function withBenAdded(w: BuilderWorkout, keys: ReadonlySet<string>): BuilderWorkout {
  if (keys.size === 0) return w;
  return { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (keys.has(s.key) ? withKeep(s, { ...s.keep, added: true }) : s)) })) };
}

export interface BenEditMarks {
  workout: BuilderWorkout;
  /** Exercises Ben's edit removed from the plan day or saved workout (`benRemovalOf`), in order. */
  removed: string[];
}

/**
 * `markBenEdit`: Ben's marks after one of his own edits on Your workout (`before` → `after`, both as stored). A new
 * slot is his add. A slot whose exercise changed is his swap (`from`: what it was before his first swap, unless he
 * added it). A slot whose working-set count changed keeps the count before his first change (`setsFrom(slot)`, with
 * Time's cuts put back). A slot gone is his removal (`benRemovalOf`). Marks already there stay; a swap the app makes
 * (a gym change, the coach) clears them, since the builder's swap makes a fresh slot.
 */
export function markBenEdit(before: BuilderWorkout, after: BuilderWorkout, setsFrom: (slot: BuilderSlot) => number): BenEditMarks {
  const was = new Map(slotsOf(before.blocks).map((s) => [s.key, s] as const));
  const now = new Set(slotsOf(after.blocks).map((s) => s.key));
  const mark = (s: BuilderSlot): BuilderSlot => {
    const prev = was.get(s.key);
    if (prev === undefined) return withKeep(s, { ...s.keep, added: true });
    const marks: BuilderKeepMarks = { ...prev.keep };
    if (prev.exerciseId !== s.exerciseId && marks.added !== true && marks.from === undefined) marks.from = prev.exerciseId;
    if (workingCount(prev) !== workingCount(s) && marks.setsFrom === undefined) marks.setsFrom = setsFrom(prev);
    return withKeep(s, marks);
  };
  const workout = { ...after, blocks: after.blocks.map((b) => ({ ...b, slots: b.slots.map(mark) })) };
  const removed = slotsOf(before.blocks).flatMap((s) => {
    if (now.has(s.key)) return [];
    const r = benRemovalOf(s);
    return r === null ? [] : [r];
  });
  return { workout, removed };
}

/** One exercise of the plan day or saved workout as the workout opened it, in order. `ref`: its routine exercise ID. */
export interface KeepBaseItem {
  exerciseId: string;
  workingSets: number;
  ref: string;
  /** The plan day's main lift: never swapped or removed by Keep (it names the plan day; SP7). */
  locked?: boolean;
}

/**
 * One exercise of the workout as Ben left it at Start (Time's cuts put back), in order. `origin`: the exercise it
 * opened as (a swap keeps it); null: none (Today's own pick, an add). `round`: its round (a superset is one round).
 * `ben`: his marks on it (`BuilderSlot.keep`); none: nothing of his.
 */
export interface KeepCurrentItem {
  key: string;
  exerciseId: string;
  workingSets: number;
  origin: string | null;
  round: number;
  ben: BuilderKeepMarks | null;
}

export interface KeepDiff {
  /** Swaps, adds, removals, then set counts. Empty: nothing to keep. */
  changes: KeepChange[];
  /** Per current item, the base item it is (opened as, or the same exercise); null: none. */
  matchOf: (number | null)[];
  /** Per current item: Ben's swap of its base item is kept. */
  swapped: boolean[];
  /** Per current item: the base item's working sets after Keep (Ben changed the count); null: as stored. */
  setsTo: (number | null)[];
  /** Per current item: Ben's add, kept. */
  added: boolean[];
  /** Base items Ben removed. */
  deleted: number[];
}

/**
 * `keepDiff`: what Keep lists. Each current item meets the base item it opened as (`origin`), else one of the same
 * exercise. Then only Ben's marks count: his swap of the exercise it opened with (`from` is that exercise), his add
 * (not one the plan day already has), his set count (the stored count plus his change, 1–10), and an exercise he
 * removed (`removed`) that nothing in the workout still is. Whatever else differs (Today's picks and controls, Time,
 * the gym, the coach) is left as stored.
 */
export function keepDiff(base: readonly KeepBaseItem[], current: readonly KeepCurrentItem[], removed: readonly string[] = []): KeepDiff {
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
  const swapped = current.map(() => false);
  const setsTo: (number | null)[] = current.map(() => null);
  const added = current.map(() => false);
  const swaps: KeepChange[] = [];
  const adds: KeepChange[] = [];
  const sets: KeepChange[] = [];
  current.forEach((c, i) => {
    const j = matchOf[i];
    const b = j === null || j === undefined ? undefined : base[j];
    if (b === undefined) {
      if (c.ben?.added === true) {
        added[i] = true;
        adds.push({ kind: 'add', exerciseId: c.exerciseId });
      }
      return;
    }
    const swap = c.exerciseId !== b.exerciseId && c.ben?.from === b.exerciseId && b.locked !== true;
    if (swap) {
      swapped[i] = true;
      swaps.push({ kind: 'swap', from: b.exerciseId, to: c.exerciseId });
    }
    const from = c.ben?.setsFrom;
    if (from !== undefined) {
      const to = clampSets(b.workingSets + c.workingSets - from);
      if (to !== b.workingSets) {
        setsTo[i] = to;
        sets.push({ kind: 'sets', exerciseId: swap ? c.exerciseId : b.exerciseId, from: b.workingSets, to });
      }
    }
  });
  const gone = new Set(removed);
  const deleted = base.flatMap((b, k) => (!used.has(k) && gone.has(b.exerciseId) && b.locked !== true ? [k] : []));
  const removals: KeepChange[] = deleted.flatMap((k) => {
    const b = base[k];
    return b === undefined ? [] : [{ kind: 'delete' as const, exerciseId: b.exerciseId }];
  });
  return { changes: [...swaps, ...adds, ...removals, ...sets], matchOf, swapped, setsTo, added, deleted };
}

const isWork = (t: Pick<SetTemplate, 'setType'>): boolean => t.setType !== 'warmup';

/**
 * A routine exercise with `n` working sets (warm-ups follow the exercise), as the builder's `setWorkingCount` does:
 * more copies the last straight set before any trailing drop sets; fewer removes the last set that isn't the top set.
 * A top set's copy is a back-off with no load of its own (review N1, D4: a back-off's load is worked out from its reps
 * and effort below the top, never the top's). New set IDs come from `seed`.
 */
export function withWorkingSets(e: RoutineExercise, n: number, seed: string): RoutineExercise {
  const target = Math.max(1, Math.round(n));
  const out = [...e.setTemplates];
  let made = 0;
  while (out.filter(isWork).length < target && out.length < 30) {
    const work = out.filter(isWork);
    const last = [...work].reverse().find((t) => t.setType !== 'drop') ?? work[work.length - 1];
    if (last === undefined) break;
    const copy: SetTemplate = last.setType === 'top' ? { ...last, id: deriveId(`${seed}:set:${String(made)}`), setType: 'backoff', targetLoad: null } : { ...last, id: deriveId(`${seed}:set:${String(made)}`) };
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

/** `keptExercises`: the routine's exercises with exactly the changes `diff` lists; every other one as stored. */
export function keptExercises(i: KeptExercisesInput): RoutineExercise[] {
  const before = [...i.before].sort((a, b) => a.order - b.order);
  const baseOfRef = new Map(i.base.map((b, k) => [b.ref, k] as const));
  const currentOfBase = new Map<number, number>();
  i.diff.matchOf.forEach((j, c) => {
    if (j !== null) currentOfBase.set(j, c);
  });
  const deleted = new Set(i.diff.deleted);
  const changed = (e: RoutineExercise): RoutineExercise => ({ ...e, structureChangedAtUtc: i.atUtc });
  /** The result in order; `item`: the current item each entry is (none: left as it was). */
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
    const to = i.diff.setsTo[c] ?? null;
    if (i.diff.swapped[c] === true) {
      // Ben's swap: the new exercise in the old one's place and superset, with the stored set count plus his change.
      // Its `Main` is the rule's (WL9: a compound in places 1–2), never copied from what it replaced (an isolation in
      // a compound's place isn't a main lift).
      const fresh: RoutineExercise = { ...i.entryFor(item) };
      delete fresh.main;
      const swapped: RoutineExercise = { ...fresh, id: deriveId(`keep-ex:${i.opId}:${item.key}`), supersetGroup: e.supersetGroup };
      out.push({ entry: changed(withWorkingSets(swapped, to ?? i.base[k]?.workingSets ?? workingOf(swapped), `keep-ex:${i.opId}:${item.key}`)), item: c });
      continue;
    }
    out.push({ entry: to === null ? e : changed(withWorkingSets(e, to, `keep-ex:${i.opId}:${e.id}`)), item: c });
  }
  // Ben's adds, in his order: after the exercise before it (and that one's superset), or with its superset partner.
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
  i.diff.added.forEach((isAdd, c) => {
    if (!isAdd) return;
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

const workingOf = (e: RoutineExercise): number => e.setTemplates.filter(isWork).length;

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

// ---------------------------------------------------------------------------
// (Ben, 23 Oct; batch23-design SP7, v3summary SP7) A main lift Ben swapped: its own Summary row.

/**
 * `keepMainLiftSwap`: the plan day's main lift (the locked base item) that Ben himself swapped on Your workout (his
 * `from` mark names it), and what he swapped in. Null: none (the main lift is as it opened, or the app swapped it: a
 * gym change, the coach). Keep's own row never lists it (`keepDiff` leaves the locked item); this row does.
 */
export function keepMainLiftSwap(base: readonly KeepBaseItem[], current: readonly KeepCurrentItem[], diff: Pick<KeepDiff, 'matchOf'>): { from: string; to: string; ref: string } | null {
  for (const [i, c] of current.entries()) {
    const j = diff.matchOf[i];
    const b = j === null || j === undefined ? undefined : base[j];
    if (b?.locked !== true || c.exerciseId === b.exerciseId || c.ben?.from !== b.exerciseId) continue;
    return { from: b.exerciseId, to: c.exerciseId, ref: b.ref };
  }
  return null;
}

/**
 * `withMainLift`: the template with `to` as its main lift, in place: the main lift's entry (`ref`) takes the new
 * exercise with its own set structure (top set and back-offs, loads automatic: `targetLoad` null), `Main` on it and on
 * no other entry, and the template's key (`planDay.mainLiftExerciseId`) and name (`Chest · incline barbell press`)
 * follow, so the plan day's identity stays whole (review v3summary B3). Every other exercise is as stored. Null: the
 * entry isn't there.
 */
export function withMainLift(r: Pick<Routine, 'exercises' | 'name' | 'planDay'>, m: { ref: string; to: string; toName: string; opId: string; atUtc: string }): { exercises: RoutineExercise[]; name: string; planDay: Routine['planDay'] } | null {
  const at = r.exercises.findIndex((e) => e.id === m.ref);
  const e = r.exercises[at];
  if (e === undefined) return null;
  const seed = `keep-main:${m.opId}:${e.id}`;
  const entry: RoutineExercise = {
    ...e,
    id: deriveId(seed),
    exerciseId: m.to,
    main: true,
    equipmentId: null,
    progressionRuleId: null,
    setTemplates: e.setTemplates.map((t, k) => ({ ...t, id: deriveId(`${seed}:set:${String(k)}`), targetLoad: null })),
    structureChangedAtUtc: m.atUtc,
  };
  const exercises = r.exercises.map((x, k) => {
    if (k === at) return entry;
    if (x.main !== true) return x;
    const plain: RoutineExercise = { ...x };
    delete plain.main;
    return plain;
  });
  const parts = r.name.split('·').map((x) => x.trim());
  const day = parts[0] ?? '';
  const name = parts.length > 1 && day !== '' ? `${day} · ${m.toName.toLowerCase()}`.slice(0, 120) : r.name;
  const planDay = r.planDay === undefined ? undefined : { ...r.planDay, mainLiftExerciseId: m.to };
  return { exercises, name, planDay };
}

/** What Summary's main-lift row wrote: Apply (with the write's inverse), Skip, or Undo of an Apply. */
export type KeepMainLiftAnswer = { kind: 'kept'; from: string; to: string; undo: NonNullable<KeepMainLift['undo']> } | { kind: 'skipped'; from: string; to: string } | { kind: 'undone' };

/**
 * `keepMainLiftMark`: the main-lift row's answer on the started builder draft that became `sessionId`, as
 * `keepNextTimeMark` does for Keep's row: one answer (Apply or Skip), Undo only of an Apply not undone yet, a repeated
 * op ID is `duplicate`, an answer already there `stale` (rule 5).
 */
export function keepMainLiftMark(current: WorkoutDraft, m: { sessionId: string; opId: string; at: ZonedTimestamp; mark: KeepMainLiftAnswer }): DraftLifeChange {
  if (current.opIds.includes(m.opId)) return { kind: 'duplicate', current };
  if (current.builderKey === undefined || current.status !== 'started' || current.sessionId !== m.sessionId) return { kind: 'invalid', reason: 'not the started workout' };
  const had = current.keepMainLift;
  let next: KeepMainLift;
  if (m.mark.kind === 'undone') {
    if (had?.choice !== 'kept' || had.undoneOpId !== undefined) return { kind: 'stale', current };
    next = { ...had, undoneOpId: m.opId };
  } else {
    if (had !== undefined) return { kind: 'stale', current };
    next = m.mark.kind === 'kept' ? { choice: 'kept', opId: m.opId, atUtc: m.at.utc, from: m.mark.from, to: m.mark.to, undo: m.mark.undo } : { choice: 'skipped', opId: m.opId, atUtc: m.at.utc, from: m.mark.from, to: m.mark.to };
  }
  return {
    kind: 'write',
    next: { ...current, keepMainLift: next, opIds: [...current.opIds, m.opId].slice(-MAX_WORKOUT_DRAFT_OPS), version: current.version + 1, updatedAtUtc: m.at.utc },
    expectedVersion: current.version,
  };
}

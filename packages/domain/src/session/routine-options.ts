import type { RoutineExercise } from '@fizz/schemas';

import { canAutoPair, infoOrDefault, pairSlots } from '../builder/arrange';
import { autoPickClash } from '../builder/similar';
import type { BuilderBlock, BuilderInfoLookup, BuilderSlot } from '../builder/types';
import { normaliseRoutineExercises, SUPERSET_MAX } from './library';
import { dropRoutineSlot, type EditorList } from './routine-editor';

/**
 * (Redesign 27 Oct, D6) The workout editor's **Options** card on a plan day or saved workout: `Abs` and `Supersets`
 * switches over the workout's own list, by the same rules Today's options use (`absOff`, `pairSlots`):
 *
 * - **Abs off** removes the ab exercises and splits their supersets; with Supersets on, an arm exercise that was
 *   paired with abs gets an arm partner in the same place (`absOff`'s rule; the partner must pass `canAutoPair` and
 *   not clash with what's there). **Abs on** adds the group's first usable pick on its own at the end.
 * - **Supersets off** splits every pair. **On** pairs the singles as the builder does (`pairSlots`): never the main
 *   lift, never a heavy lift, never a slot Ben unlinked.
 *
 * Pure: the caller applies the result as page edits (Undo), and Save writes one version (rule 5). An exercise to add
 * is returned as a request (`add`), since only the caller knows its shape at this gym.
 */

const isAbsId = (info: BuilderInfoLookup, id: string): boolean => infoOrDefault(info, id).group === 'Core';

export interface RoutineOptionsState {
  /** The workout has an ab exercise. */
  abs: boolean;
  /** The workout has a superset. */
  supersets: boolean;
}

export function routineOptionsState(list: EditorList, info: BuilderInfoLookup): RoutineOptionsState {
  return { abs: list.some((e) => isAbsId(info, e.exerciseId)), supersets: list.some((e) => e.supersetGroup !== null) };
}

/** Every superset split (Supersets off). */
export function routineSupersetsOff(list: EditorList): RoutineExercise[] {
  return normaliseRoutineExercises(list.map((e) => (e.supersetGroup === null ? e : { ...e, supersetGroup: null })));
}

/** A routine slot as the builder's pairing reads it (key, exercise, main, unlinked); nothing else is read. */
function asSlot(e: RoutineExercise, main: boolean, unlinked: boolean): BuilderSlot {
  return { key: e.id, exerciseId: e.exerciseId, main, repRange: { min: 8, max: 12 }, rows: [], unit: 'kg', convention: 'total', source: 'none', startLight: null, anchorE1rm: null, ...(unlinked ? { unlinked: true as const } : {}) };
}

/**
 * Supersets on: the singles paired by `pairSlots` (abs with the latest compatible exercise first, then the rest);
 * Ben's own pairs stay as they are. `mains`: the slots that are the main lift; `unlinked`: slots Ben unlinked.
 */
export function routineSupersetsOn(list: EditorList, info: BuilderInfoLookup, opts: { mains: ReadonlySet<string>; unlinked: ReadonlySet<string> }): RoutineExercise[] {
  const byId = new Map(list.map((e) => [e.id, e]));
  const blocks: BuilderBlock[] = [];
  for (const e of list) {
    const last = blocks[blocks.length - 1];
    const lastGroup = last === undefined ? null : (byId.get(last.slots[0]?.key ?? '')?.supersetGroup ?? null);
    const slot = asSlot(e, opts.mains.has(e.id), opts.unlinked.has(e.id));
    if (e.supersetGroup !== null && last !== undefined && lastGroup === e.supersetGroup) last.slots.push(slot);
    else blocks.push({ slots: [slot], auto: false });
  }
  const paired = pairSlots(blocks, info);
  const out: RoutineExercise[] = [];
  paired.forEach((b, i) => {
    for (const s of b.slots) {
      const e = byId.get(s.key);
      if (e === undefined) continue;
      out.push({ ...e, supersetGroup: b.slots.length > 1 ? (e.supersetGroup ?? `#p${String(i)}`) : null });
    }
  });
  return normaliseRoutineExercises(out);
}

export interface RoutineAbsOff {
  list: RoutineExercise[];
  removed: string[];
  /** With Supersets on: an arm partner to add in the abs' place, paired with `withSlotId` (`workingSets` like it). */
  add: { exerciseId: string; withSlotId: string; workingSets: number } | null;
}

/** Abs off (`absOff`'s rule on the workout's list). `armCandidates`: this gym's arm exercises, best first. */
export function routineAbsOff(list: EditorList, info: BuilderInfoLookup, opts: { supersets: boolean; armCandidates: readonly string[] }): RoutineAbsOff {
  const removed = list.filter((e) => isAbsId(info, e.exerciseId)).map((e) => e.id);
  if (removed.length === 0) return { list: [...list], removed, add: null };
  const gone = new Set(removed);
  const present = new Set(list.map((e) => e.exerciseId));
  let add: RoutineAbsOff['add'] = null;
  // Groups that lose a member to the abs: the one left alone is a single again.
  const groups = new Map<string, RoutineExercise[]>();
  for (const e of list) if (e.supersetGroup !== null) groups.set(e.supersetGroup, [...(groups.get(e.supersetGroup) ?? []), e]);
  const kept = list.filter((e) => !gone.has(e.id));
  const out = kept.map((e) => {
    if (e.supersetGroup === null) return e;
    const members = groups.get(e.supersetGroup) ?? [];
    const left = members.filter((m) => !gone.has(m.id));
    if (left.length === members.length) return e;
    if (left.length > 1) return e;
    // A lone arm exercise that was paired with abs: an arm partner in the same place (Supersets on).
    if (opts.supersets && add === null && infoOrDefault(info, e.exerciseId).group === 'Arms') {
      const id = opts.armCandidates.find((c) => !present.has(c) && autoPickClash(c, present, info) === null && infoOrDefault(info, c).group === 'Arms' && canAutoPair({ exerciseId: e.exerciseId, main: false }, { exerciseId: c, main: false }, info));
      if (id !== undefined) {
        present.add(id);
        add = { exerciseId: id, withSlotId: e.id, workingSets: e.setTemplates.filter((t) => t.setType !== 'warmup').length };
      }
    }
    return { ...e, supersetGroup: null };
  });
  return { list: normaliseRoutineExercises(out), removed, add };
}

/** Abs on: the first usable ab pick not in the workout, on its own at the end (null: none to add). */
export function routineAbsOnPick(list: EditorList, coreCandidates: readonly string[]): string | null {
  const present = new Set(list.map((e) => e.exerciseId));
  return coreCandidates.find((id) => !present.has(id)) ?? null;
}

/** After the caller added `newSlotId` (at the end): it joins `withSlotId` as a superset, in that slot's place. */
export function pairAddedWith(list: EditorList, newSlotId: string, withSlotId: string): RoutineExercise[] {
  const target = list.find((e) => e.id === withSlotId);
  if (target === undefined) return [...list];
  const size = target.supersetGroup === null ? 1 : list.filter((e) => e.supersetGroup === target.supersetGroup).length;
  if (size + 1 > SUPERSET_MAX) return [...list];
  return dropRoutineSlot(list, newSlotId, withSlotId, 'onto') ?? [...list];
}

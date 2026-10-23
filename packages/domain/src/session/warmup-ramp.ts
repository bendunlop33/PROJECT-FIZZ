import type { Load, SessionAggregate, WorkoutSet } from '@fizz/schemas';
import { warmupGap } from '../builder/edit';
import { loadDirection, roundToAvailableLoad } from '../equipment';
import { equipmentOfRow } from './equipment-snapshot';

/**
 * A warm-up with no load of its own (23 Oct, Ben: the workout showed `—` on
 * every warm-up, and the open warm-up prefilled the working weight). A
 * coach-built workout stores its warm-ups as reps only, so the load each one
 * shows and prefills is worked out here, never written: the ramp Ben would
 * get by tapping `＋ Warm-up` once per warm-up (`warmupGap`, the builder's
 * and the workout's shared rule), up to the exercise's first working load,
 * rounded down on the row's own item (rule 4). Warm-ups that already have a
 * load (logged, typed or planned) stay as they are and the ramp fills around
 * them. Only for loads on an item with the reps/RPE formula: not assisted,
 * added weight or bodyweight. Pure.
 *
 * `workingLoad` is what the first working set shows (its target, else what
 * it would prefill); null when nothing is known, and then no warm-up load.
 * Returns the warm-up set IDs with a derived load.
 */
export function warmupRampLoads(state: Pick<SessionAggregate, 'sets' | 'exercises' | 'session'>, sessionExerciseId: string, workingLoad: (set: WorkoutSet) => Load | null): ReadonlyMap<string, Load> {
  const out = new Map<string, Load>();
  const ex = state.exercises.find((e) => e.id === sessionExerciseId);
  if (ex === undefined) return out;
  const own = state.sets.filter((s) => s.sessionExerciseId === ex.id && s.status !== 'deleted').sort((a, b) => a.index - b.index);
  const warm = own.filter((s) => s.setType === 'warmup' && s.status !== 'skipped');
  const open = warm.filter((s) => s.status === 'pending' && s.planned.load === null && (s.draft?.load ?? null) === null);
  if (open.length === 0) return out;
  const work = own.find((s) => s.setType !== 'warmup' && s.status !== 'skipped');
  if (work === undefined) return out;
  const top = work.status === 'completed' ? (work.actual?.load ?? null) : workingLoad(work);
  const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
  if (top === null || eq === null || !(top.value > 0)) return out;
  if (!RAMP_CONVENTIONS.has(top.convention) || loadDirection(top.convention) !== 'resistance' || top.convention !== eq.loadConvention || top.unit !== ex.unit) return out;
  const roundDown = (v: number): number | null => {
    const r = roundToAvailableLoad({ value: v, unit: top.unit, convention: top.convention }, eq, 'down');
    return r.ok && r.load.value <= v + 1e-9 ? r.load.value : null;
  };
  const fixed = warm.filter((s) => !open.includes(s)).map((s) => (s.status === 'completed' ? (s.actual?.load ?? null) : (s.draft?.load ?? s.planned.load)));
  const points = fixed.filter((l): l is Load => l !== null && l.unit === top.unit && l.convention === top.convention).map((l) => l.value);
  const made: number[] = [];
  for (let i = 0; i < open.length; i += 1) {
    const gap = warmupGap([...points, ...made], top.value, roundDown);
    if (gap === null) break;
    made.push(gap.load);
  }
  // Lightest first, in set order: the ramp climbs to the working load.
  made.sort((a, b) => a - b);
  // Fewer loads than warm-ups (no room in the ramp): the heaviest go to the last warm-ups, the first stay empty.
  const offset = open.length - made.length;
  made.forEach((value, i) => {
    const s = open[offset + i];
    if (s !== undefined) out.set(s.id, { value, unit: top.unit, convention: top.convention });
  });
  return out;
}

const RAMP_CONVENTIONS: ReadonlySet<Load['convention']> = new Set(['total', 'per_hand', 'stack']);

import type { EquipmentInstance, Exercise, Load, RepRange, SetTemplate, SetType } from '@fizz/schemas';
import { builtInRepRange, ruleCategory } from '../default-rule';

/**
 * Today's shape of one slot (overview-today-edits §11, TE12): Ben's working-set
 * count, reps (or work time) and his own target load for today. Pure.
 *
 * Applied to a slot's templates **after** its targets are in place (the
 * built-in rule's, a coach target's, or last time's), so Ben's today-only
 * choice is the last word for today. Loads are still intended values: the
 * shared fit (`snapPlanToGym`) runs afterwards, unchanged (rule 4).
 */
export interface SlotShape {
  workingSets?: number;
  reps?: { reps: RepRange | null; durationS: number | null };
  /** Ben's intended load: the top and plain working sets (back-off and drop sets keep theirs). */
  load?: Load;
}

/** A slot as planned before today's shape: what the steppers step from and `Use planned` returns to. */
export interface ShapeBefore {
  workingSets: number;
  reps: RepRange | null;
  durationS: number | null;
}

const isWorkingTemplate = (t: Pick<SetTemplate, 'setType'>): boolean => t.setType !== 'warmup';

/** The working-set count and the first working set's reps or time. */
export function shapeOfTemplates(templates: readonly Pick<SetTemplate, 'setType' | 'targetReps' | 'targetDurationS'>[]): ShapeBefore {
  const working = templates.filter(isWorkingTemplate);
  const first = working[0];
  return { workingSets: working.length, reps: first?.targetReps ?? null, durationS: first?.targetDurationS ?? null };
}

/**
 * The templates with today's shape, in TE12 order (sets, reps, load):
 * - **sets**: more copies the last working set's target (load included)
 *   after it; fewer drops working sets from the end; at least one stays.
 *   Warm-ups never change.
 * - **reps**: every working set's reps (or work time); loads kept.
 * - **load**: top and plain working sets take Ben's intended load; back-off
 *   and drop sets keep their planned loads (§11.4).
 * `copied(from, to)`: a new set copies `from` (its `Why?` comes along).
 * `ownLoad(id)`: the set's load is now Ben's (its rule `Why?` no longer applies).
 */
export function shapeTemplates(
  templates: readonly SetTemplate[],
  shape: SlotShape,
  o: { newId: () => string; copied?: (fromId: string, toId: string) => void; ownLoad?: (id: string) => void },
): SetTemplate[] {
  let out = [...templates];
  if (shape.workingSets !== undefined) {
    const want = Math.max(1, Math.round(shape.workingSets));
    const working = out.filter(isWorkingTemplate);
    const last = working[working.length - 1];
    if (last !== undefined && want > working.length) {
      const at = out.indexOf(last) + 1;
      const extra = Array.from({ length: want - working.length }, () => {
        const id = o.newId();
        o.copied?.(last.id, id);
        return { ...last, id };
      });
      out = [...out.slice(0, at), ...extra, ...out.slice(at)];
    } else if (want < working.length) {
      const drop = new Set(working.slice(want).map((t) => t.id));
      out = out.filter((t) => !drop.has(t.id));
    }
  }
  if (shape.reps !== undefined) {
    const r = shape.reps;
    out = out.map((t) => (isWorkingTemplate(t) ? { ...t, targetReps: r.reps === null ? null : { ...r.reps }, targetDurationS: r.reps === null ? r.durationS : null } : t));
  }
  if (shape.load !== undefined) {
    const load = shape.load;
    out = out.map((t) => {
      if (t.setType !== 'working' && t.setType !== 'top') return t;
      o.ownLoad?.(t.id);
      return { ...t, targetLoad: { ...load } };
    });
  }
  return out;
}

/** Default count of an added exercise's working sets (TE16). */
export const ADDED_WORKING_SETS = 3;
/** An added timed exercise's default work time. */
export const ADDED_WORK_S = 45;

/**
 * An added exercise's default shape (TE16): 3 working sets × the built-in
 * rule's rep range for it (else 8–12), or 0:45 for a timed one. Its own
 * history's targets, when it has any, replace this (`substituteTargets`).
 */
export function addedSlotShape(
  exercise: Pick<Exercise, 'movementPattern' | 'mechanic' | 'family' | 'compatibleEquipment' | 'defaultLoadConvention' | 'measurement'>,
  equipmentKind: EquipmentInstance['kind'] | null,
): { workingSets: number; templates: { setType: SetType; reps: RepRange | null; durationS: number | null }[] } {
  const timed = exercise.measurement !== 'reps';
  const reps = timed ? null : builtInRepRange(ruleCategory(exercise, equipmentKind ?? exercise.compatibleEquipment[0] ?? null, exercise.defaultLoadConvention));
  return {
    workingSets: ADDED_WORKING_SETS,
    templates: Array.from({ length: ADDED_WORKING_SETS }, () => ({ setType: 'working' as const, reps: reps === null ? null : { ...reps }, durationS: timed ? ADDED_WORK_S : null })),
  };
}

/**
 * An added exercise's sets at the count Ben chose when adding it
 * (exercise-library §10.2): warm-ups kept; working sets cut from the end, or
 * the last one copied (its target included). `n` absent = unchanged. Pure.
 */
export function resizeWorkingSets<T extends { setType: SetType }>(list: readonly T[], n: number | undefined): T[] {
  if (n === undefined) return [...list];
  const want = Math.max(1, Math.min(10, Math.round(n)));
  const working = list.filter((t) => t.setType !== 'warmup');
  const last = working[working.length - 1];
  if (last === undefined || want === working.length) return [...list];
  if (want < working.length) {
    const drop = new Set(working.slice(want));
    return list.filter((t) => !drop.has(t));
  }
  return [...list, ...Array.from({ length: want - working.length }, () => ({ ...last }))];
}

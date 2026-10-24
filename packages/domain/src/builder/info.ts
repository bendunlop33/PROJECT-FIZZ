import { builderFocusOf, builderGroupOf, isBrowseOnlyFocus, worksLine, type Exercise } from '@fizz/schemas';
import type { BuilderExerciseInfo } from './types';

/**
 * An exercise row (Ben's or the catalogue's) as the builder rules see it
 * (workout-builder-v3 §3.4, §3.5, §4.7). Pure. Null when it has no builder
 * group (conditioning, cardio, carries). Forearm-only work is `Arms` › `Forearms` (D5).
 *
 * `heavy` (§3.5): marked per exercise in the catalogue once it carries the
 * flag; until then the spec's fallback, any compound on a barbell (incl. EZ
 * and trap bars, Smith) or a plate-loaded machine.
 */

const HEAVY_KINDS: ReadonlySet<string> = new Set(['barbell', 'trap_bar', 'smith_machine', 'plate_loaded_machine']);
const BAR_KINDS: ReadonlySet<string> = new Set(['barbell', 'ez_bar', 'trap_bar']);
/** Helpers too general to decide pairing (every lift braces and grips). */
const QUIET: ReadonlySet<string> = new Set(['core', 'grip', 'forearms']);

const LEG_PART: Readonly<Record<string, string>> = { Quads: 'quads', 'Hamstrings & glutes': 'hamstrings_glutes', Calves: 'calves', Shins: 'calves' };
const ARM_PART: Readonly<Record<string, string>> = { Biceps: 'biceps', Triceps: 'triceps', Forearms: 'forearms' };

export function builderInfoOf(
  e: Pick<Exercise, 'id' | 'name' | 'primaryMuscles' | 'secondaryMuscles' | 'movementPattern' | 'measurement' | 'mechanic' | 'compatibleEquipment'> & Partial<Pick<Exercise, 'family' | 'catalogueKey' | 'defaultLoadConvention'>> & { heavy?: boolean },
): BuilderExerciseInfo | null {
  const group = builderGroupOf(e);
  if (group === null) return null;
  const focus = builderFocusOf(e) ?? group;
  const compound = e.mechanic === 'compound';
  const kinds = e.compatibleEquipment as readonly string[];
  const muscles = [...new Set([...e.primaryMuscles, ...(e.secondaryMuscles ?? []).filter((m) => !QUIET.has(m))].map((m) => m.replace(/_/g, ' ')))];
  return {
    exerciseId: e.id,
    name: e.name,
    group,
    role: compound && group !== 'Core' ? 'compound' : 'isolation',
    heavy: e.heavy ?? (compound && kinds.some((k) => HEAVY_KINDS.has(k))),
    part: group === 'Legs' ? (LEG_PART[focus] ?? 'quads') : group === 'Arms' ? (ARM_PART[focus] ?? 'biceps') : group,
    muscles,
    angle: focus,
    barbell: kinds.some((k) => BAR_KINDS.has(k)),
    // (WU1–WU12) What the warm-up planner classifies by.
    warmup: {
      catalogueKey: e.catalogueKey ?? null,
      family: e.family ?? null,
      movementPattern: e.movementPattern,
      mechanic: e.mechanic ?? null,
      primaryMuscles: [...e.primaryMuscles],
      measurement: e.measurement,
      ...(e.defaultLoadConvention === undefined ? {} : { defaultLoadConvention: e.defaultLoadConvention }),
    },
  };
}

/**
 * Whether the builder may pick an exercise by itself (a group's pool, a
 * merge's extra exercise): it has builder info and isn't prehab or forearm
 * work (`Rotator cuff`, `Shins`, `Forearms`…), which Swap / Add offer only.
 */
export function isAutoPickInfo(i: Pick<BuilderExerciseInfo, 'angle'> | null): boolean {
  return i !== null && !isBrowseOnlyFocus(i.angle);
}

/** The `works` line under an exercise (§2.4, §2.5): `Chest, front delts, triceps`. */
export function builderWorksOf(e: Pick<Exercise, 'primaryMuscles' | 'secondaryMuscles'>): string | null {
  return worksLine(e);
}

/**
 * (Today v2, builder v3) Only rep-based strength work goes into a built workout: timed and cardio rows have no
 * reps to target, and an archived row is never picked.
 */
export function builderUsable(e: Pick<Exercise, 'id' | 'name' | 'primaryMuscles' | 'secondaryMuscles' | 'movementPattern' | 'measurement' | 'mechanic' | 'compatibleEquipment' | 'archivedAtUtc'>): boolean {
  return e.measurement === 'reps' && e.archivedAtUtc === undefined && builderInfoOf(e) !== null;
}

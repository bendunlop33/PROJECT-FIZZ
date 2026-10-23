import { BROAD_MUSCLE_GROUPS, broadGroupOfFilters, EQUIPMENT_FILTER_LABEL, EQUIPMENT_FILTERS, MOVEMENT_FILTER_LABEL, MOVEMENT_FILTERS, MUSCLE_GROUPS, type BroadMuscleGroup, type EquipmentFilter, type ExerciseFilters, type MovementFilter, type MuscleGroup } from '@fizz/domain';

import type { LibrarySegment } from '../navigation/types';

/**
 * The Library tab's words and small screen rules (exercise-library §9.3,
 * §9.9). Pure: the services build the rows; these only pick labels. Minimal
 * copy: values and actions, no explanations.
 */

export const LIBRARY_BROWSE_COPY = {
  title: 'Library',
  // (Ben, 22 Oct) `Plan | Workouts | Exercises`.
  segments: [
    { key: 'plan', label: 'Plan' },
    { key: 'workouts', label: 'Workouts' },
    { key: 'exercises', label: 'Exercises' },
  ] as const satisfies readonly { key: LibrarySegment; label: string }[],
  segmentLabel: 'Library',
  search: 'Search exercises',
  muscle: 'Muscle',
  all: 'All',
  equipment: 'Equipment',
  movement: 'Movement',
  clear: 'Clear',
  done: 'Done',
  clearFilters: 'Clear filters',
  show: 'Show',
  loadFailed: 'Couldn’t open your exercise list.',
  tryAgain: 'Try again',
  hasGuide: 'has a guide',
} as const;

export type FilterKind = 'muscle' | 'equipment' | 'movement';

/** A filter sheet's choices, in sheet order (§2.3). */
export function filterOptions(kind: FilterKind): { key: string; label: string }[] {
  if (kind === 'muscle') return MUSCLE_GROUPS.map((g) => ({ key: g, label: g }));
  if (kind === 'equipment') return EQUIPMENT_FILTERS.map((k) => ({ key: k, label: EQUIPMENT_FILTER_LABEL[k] }));
  return MOVEMENT_FILTERS.map((k) => ({ key: k, label: MOVEMENT_FILTER_LABEL[k] }));
}

/** The chosen keys of one filter. */
export function filterValues(f: ExerciseFilters, kind: FilterKind): readonly string[] {
  return kind === 'muscle' ? f.muscles : kind === 'equipment' ? f.equipment : f.movements;
}

/** One filter set to `keys` (the others kept). */
export function withFilter(f: ExerciseFilters, kind: FilterKind, keys: readonly string[]): ExerciseFilters {
  if (kind === 'muscle') return { ...f, muscles: MUSCLE_GROUPS.filter((g): g is MuscleGroup => keys.includes(g)) };
  if (kind === 'equipment') return { ...f, equipment: EQUIPMENT_FILTERS.filter((k): k is EquipmentFilter => keys.includes(k)) };
  return { ...f, movements: MOVEMENT_FILTERS.filter((k): k is MovementFilter => keys.includes(k)) };
}

/** `Muscle`, `Muscle: Hamstrings`, `Muscle: 2` (§2.3: an active chip shows its choice). */
export function filterChipLabel(f: ExerciseFilters, kind: FilterKind): string {
  const base = kind === 'muscle' ? LIBRARY_BROWSE_COPY.muscle : kind === 'equipment' ? LIBRARY_BROWSE_COPY.equipment : LIBRARY_BROWSE_COPY.movement;
  const keys = filterValues(f, kind);
  if (keys.length === 0) return base;
  if (keys.length > 1) return `${base}: ${String(keys.length)}`;
  const one = filterOptions(kind).find((o) => o.key === keys[0]);
  return `${base}: ${one?.label ?? ''}`;
}

/** Toggle one key in a multi-select list. */
export function toggled(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}

/** (D5) The muscle chip row: `All` + Chest, Back, Shoulders, Legs, Arms, Core; exactly one on. `group` null: `All`. */
export function muscleChips(f: ExerciseFilters): { label: string; group: BroadMuscleGroup | null; selected: boolean }[] {
  const on = broadGroupOfFilters(f);
  return [{ label: LIBRARY_BROWSE_COPY.all, group: null, selected: on === null }, ...BROAD_MUSCLE_GROUPS.map((g) => ({ label: g, group: g, selected: on === g }))];
}

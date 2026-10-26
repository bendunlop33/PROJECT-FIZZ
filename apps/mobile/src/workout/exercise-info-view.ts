import { cardioValuesText, formatDuration, formatNumber, NBSP, repRangeText, type AddDestination, type SlotShapeInput, rirOfRpe } from '@fizz/domain';

import type { LibraryAddShape } from '../services/library-service';
import type { RepsDraft } from './reps-draft';
import { SET_SHAPE_COPY } from './set-shape-view';

/**
 * Exercise detail and its `Add to a workout` sheet (exercise-library §9.4,
 * §9.5): words and the sheet's small rules. Pure; the service builds the
 * detail and writes the add.
 */

export const EXERCISE_INFO_COPY = {
  addToWorkout: 'Add to a workout',
  /** (19 Oct) Ben's own exercise. */
  edit: 'Edit',
  play: 'Play',
  fullHowTo: 'Full how-to',
  progress: 'Progress and records',
  usedIn: 'Used in',
  howToDo: 'HOW TO DO IT',
  whatNot: 'WHAT NOT TO DO',
  now: 'NOW',
  yourWorkouts: 'YOUR WORKOUTS',
  cancel: 'Cancel',
  chooseWorkout: 'Choose a workout',
  addTitle: (name: string) => `Add ${name}`,
  repsTitle: (name: string) => `Reps · ${name}`,
  effortTitle: (label: string, name: string) => `${label} · ${name}`,
  undo: 'Undo',
  loadFailed: 'Couldn’t open your exercise list.',
  tryAgain: 'Try again',
  addAnyway: 'Add anyway',
} as const;

/** The sheet's starting shape: the exercise's §10.1 default; effort `None`. A cardio exercise's carries its distance (none to start). */
export function initialAddShape(d: SlotShapeInput, scale: 'rpe' | 'rir' | null, measurement?: string): LibraryAddShape {
  return { workingSets: d.workingSets, warmups: d.warmups, reps: d.reps === null ? null : { ...d.reps }, durationS: d.durationS, ...(measurement === 'cardio' ? { distanceM: d.distanceM ?? null } : {}), effort: { scale: scale ?? 'rpe', value: null }, repsTouched: false };
}

/** The sheet's `Reps` / `Work time` row: `8–10`, `8–10 per side`, `0:45`; cardio's `Time` row: `20:00 · 4,800 m`. */
export function addRepsRow(shape: LibraryAddShape, perSide: boolean): { label: string; text: string } {
  if (shape.distanceM !== undefined) return { label: 'Time', text: cardioValuesText({ durationS: shape.durationS, distanceM: shape.distanceM }) };
  if (shape.reps !== null) return { label: SET_SHAPE_COPY.reps, text: `${repRangeText(shape.reps)}${perSide ? `${NBSP}per side` : ''}` };
  return { label: SET_SHAPE_COPY.workTime, text: formatDuration(shape.durationS ?? 45) };
}

/** The `Target RPE` row; null (hidden) with the effort scale off. */
export function addEffortRow(shape: LibraryAddShape, scale: 'rpe' | 'rir' | null): { label: string; text: string } | null {
  if (scale === null) return null;
  // (Ben, 26 Oct) Reads RIR; an RPE value converts (RIR = 10 − RPE).
  const v = shape.effort.value;
  return { label: SET_SHAPE_COPY.targetRir, text: v === null ? SET_SHAPE_COPY.none : formatNumber(shape.effort.scale === 'rpe' ? rirOfRpe(v) : v) };
}

/** What the Reps sheet opens with. */
export function repsDraftOfShape(shape: LibraryAddShape): RepsDraft {
  // Cardio (review S1): time up to 4 h and a distance, never the 10-minute work-time sheet.
  if (shape.distanceM !== undefined) return { kind: 'cardio', seconds: shape.durationS, distanceM: shape.distanceM };
  if (shape.reps === null) return { kind: 'time', seconds: shape.durationS ?? 45 };
  return { kind: 'reps', exact: shape.reps.min === shape.reps.max, min: shape.reps.min, max: shape.reps.max };
}

/** The primary names the destination (`Add to Pull B`); disabled `Choose a workout` until one is picked. Nothing is preselected. */
export function addPrimary(selected: AddDestination | null): { label: string; disabled: boolean } {
  return selected === null || selected.disabled ? { label: EXERCISE_INFO_COPY.chooseWorkout, disabled: true } : { label: selected.primary, disabled: false };
}

/** The shape the editor's new card starts with (`New workout`): the sheet's values as a slot shape. */
export function slotShapeOfAdd(shape: LibraryAddShape): SlotShapeInput {
  return { workingSets: shape.workingSets, warmups: shape.warmups, reps: shape.reps, durationS: shape.durationS, ...(shape.distanceM !== undefined ? { distanceM: shape.distanceM } : {}), targetRpe: shape.effort.scale === 'rpe' ? shape.effort.value : null, targetRir: shape.effort.scale === 'rir' ? shape.effort.value : null };
}

/** `GuidePoster` canvas (design-system §9.90): `min(240, width − 2 × margin − 2 × padding)`, never under 160. */
export function posterSize(width: number, margin: number, padding: number): number {
  return Math.max(160, Math.min(240, width - 2 * margin - 2 * padding));
}

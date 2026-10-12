import { DEFAULT_WORKING_SETS_ON_ADD, EFFORT_CHOICES, formatDuration, formatNumber, NBSP, repRangeText, SLOT_SET_LIMITS, type SlotShapeView } from '@fizz/domain';

/**
 * Screen-side words for the one sets control (`SetShapeControl`,
 * `SetCountBar`; exercise-library §10.5, design-system §9.88). The values
 * come from the domain (`slotShapeOf`, `defaultSlotShape`); this file only
 * words them, so every place that adds an exercise reads the same.
 */

export const SET_SHAPE_COPY = {
  sets: 'Sets',
  warmups: 'Warm-ups',
  reps: 'Reps',
  workTime: 'Work time',
  targetRpe: 'Target RPE',
  targetRir: 'Target RIR',
  none: 'None',
  mixed: 'Mixed',
  eachSet: 'Each set',
  fewerSets: 'Fewer sets',
  moreSets: 'More sets',
  fewerWarmups: 'Fewer warm-ups',
  moreWarmups: 'More warm-ups',
  done: 'Done',
} as const;

/** A stepper's next values at its limits (null = that button is dimmed). */
export function countSteps(value: number, limits: { min: number; max: number }): { down: number | null; up: number | null } {
  return { down: value > limits.min ? value - 1 : null, up: value < limits.max ? value + 1 : null };
}

/** The `Sets` bar's limits and its starting count each time a sheet opens (§10.2). */
export const SET_BAR = { start: DEFAULT_WORKING_SETS_ON_ADD, limits: SLOT_SET_LIMITS.working } as const;

/** `8–10`, `8–10 per side`, `Mixed`; `0:45` for a timed one. */
export function shapeRepsText(shape: Pick<SlotShapeView, 'reps' | 'durationS'>, perSide: boolean): string {
  if (shape.reps === 'mixed' || shape.durationS === 'mixed') return SET_SHAPE_COPY.mixed;
  if (shape.reps !== null) return `${repRangeText(shape.reps)}${perSide ? `${NBSP}per side` : ''}`;
  if (shape.durationS !== null) return formatDuration(shape.durationS);
  return '—';
}

/** The effort row: hidden when the effort scale is off; `None`, `8`, `Mixed`. */
export function shapeEffortRow(shape: Pick<SlotShapeView, 'targetRpe' | 'targetRir'>, scale: 'rpe' | 'rir' | null): { label: string; text: string } | null {
  if (scale === null) return null;
  const v = scale === 'rpe' ? shape.targetRpe : shape.targetRir;
  return { label: scale === 'rpe' ? SET_SHAPE_COPY.targetRpe : SET_SHAPE_COPY.targetRir, text: v === 'mixed' ? SET_SHAPE_COPY.mixed : v === null ? SET_SHAPE_COPY.none : formatNumber(v) };
}

/** The EffortSheet's chips (§9.91): `None` first, then the scale's values. */
export function effortChoices(scale: 'rpe' | 'rir'): { label: string; value: number | null }[] {
  return [{ label: SET_SHAPE_COPY.none, value: null }, ...EFFORT_CHOICES[scale].map((v) => ({ label: formatNumber(v), value: v }))];
}

/** VoiceOver for a stepper row: "Sets, 3, adjustable" is the role; this is the label and value. */
export function countAccessibility(label: string, value: number): { label: string; value: string } {
  return { label, value: String(value) };
}

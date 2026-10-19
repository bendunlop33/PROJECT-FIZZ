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

/**
 * The Add exercise picker's `Sets` bar (review S2, N7): `touched` once Ben
 * steps it. Untouched, it shows 1 while the Cardio chip is on and the usual
 * start otherwise; Ben's own count is never reset by the chip.
 */
export interface PickerSetsBar {
  value: number;
  touched: boolean;
}

/** What the bar shows. */
export function pickerBarValue(bar: PickerSetsBar, cardioChip: boolean): number {
  return bar.touched ? bar.value : cardioChip ? 1 : SET_BAR.start;
}

/** The working sets an add from the picker makes: Ben's count, else one for a cardio exercise (one 10-minute set), else the usual start. */
export function pickerAddSets(bar: PickerSetsBar, measurement: string): number {
  if (bar.touched) return bar.value;
  return measurement === 'cardio' ? 1 : SET_BAR.start;
}

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

/**
 * A card stepper's limits from the domain's next values (`slotShapeOf`): a
 * button the domain says is at its limit (1–10, 0–5, the 30-set cap, or a
 * slot already above 10) is dimmed.
 */
export function stepperLimits(value: number, down: number | null, up: number | null): { min: number; max: number } {
  return { min: down ?? value, max: up ?? value };
}

/** The editor card's Reps sheet start: the slot's plain working reps (or the first non-warm-up set's when they differ), or its work time. */
export function slotRepsDraft(
  templates: readonly { setType: string; targetReps: { min: number; max: number } | null; targetDurationS: number | null; targetDistanceM?: number | null | undefined }[],
  cardio = false,
): { kind: 'reps'; exact: boolean; min: number; max: number } | { kind: 'time'; seconds: number } | { kind: 'cardio'; seconds: number | null; distanceM: number | null } {
  const plain = templates.filter((t) => t.setType === 'working');
  const first = (plain.length > 0 ? plain : templates.filter((t) => t.setType !== 'warmup'))[0];
  // Cardio (review S1): its time (up to 4 h) and distance, never the 10-minute work-time sheet.
  if (cardio) return { kind: 'cardio', seconds: first?.targetDurationS ?? null, distanceM: first?.targetDistanceM ?? null };
  if (first?.targetReps == null && first?.targetDurationS != null) return { kind: 'time', seconds: first.targetDurationS };
  const r = first?.targetReps ?? { min: 8, max: 10 };
  return { kind: 'reps', exact: r.min === r.max, min: r.min, max: r.max };
}

/**
 * Whether the sets control stacks each label above its control (EL-B24,
 * design-system §9.88, review S3): as asked, else at AX1 and above
 * (`fontScale >= axAt`), where a label, two 44pt circles and a value no
 * longer share one row on a 375pt phone.
 */
export function setShapeStacked(asked: boolean | undefined, fontScale: number, axAt: number): boolean {
  return asked ?? fontScale >= axAt;
}

import type { Mass, WeightUnit } from '@fizz/schemas';

/** Exact international definition of the avoirdupois pound. */
export const KG_PER_LB = 0.45359237;

/**
 * Loads are compared and summed as integers of 1/1000 of the unit so that
 * 1.25 + 1.25 + 2.5 is exactly 5 and set membership tests are reliable.
 */
export const LOAD_SCALE = 1000;

export function toScaled(value: number): number {
  return Math.round(value * LOAD_SCALE);
}

export function fromScaled(scaled: number): number {
  return scaled / LOAD_SCALE;
}

/** Convert a mass to the requested unit. Precision is preserved; round for display separately. */
export function convertMass(mass: Mass, to: WeightUnit): Mass {
  if (mass.unit === to) return { value: mass.value, unit: to };
  const value = to === 'kg' ? mass.value * KG_PER_LB : mass.value / KG_PER_LB;
  return { value, unit: to };
}

/** Round a number to a display step (e.g. 0.1 or 0.25) without float noise. */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) throw new RangeError('step must be positive');
  const scaledStep = toScaled(step);
  const scaled = Math.round(toScaled(value) / scaledStep) * scaledStep;
  return fromScaled(scaled);
}

/** Equality at load precision (1/1000 of the unit). Units must match. */
export function sameMass(a: Mass, b: Mass): boolean {
  return a.unit === b.unit && toScaled(a.value) === toScaled(b.value);
}

/**
 * Loads are shown to two decimals at most (enough for 1.25 kg and 2.5 lb
 * plates). A unit conversion is only "exact" if it lands on this step.
 */
export const LOAD_DISPLAY_STEP = 0.01;

/**
 * Convert only when the result is exact at display precision; otherwise null.
 * Used where a silent approximation would change what Ben is told to lift
 * (e.g. a kg template on a session logged in lb with no equipment to round to).
 */
export function convertMassExactly(mass: Mass, to: WeightUnit): Mass | null {
  if (mass.unit === to) return { value: mass.value, unit: to };
  const converted = convertMass(mass, to).value;
  const stepped = roundToStep(converted, LOAD_DISPLAY_STEP);
  return Math.abs(converted - stepped) <= 1e-9 * Math.max(1, Math.abs(converted)) ? { value: stepped, unit: to } : null;
}

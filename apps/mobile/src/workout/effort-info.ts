/**
 * F4 (Ben, 13 Oct): "what does RPE 6-10 mean?". The scale behind the effort
 * label's ⓘ, as reps left in the tank (RIR); minimal copy, one line per value.
 */
export type EffortScale = 'rpe' | 'rir';

export interface EffortInfoLine {
  value: string;
  meaning: string;
}

const LEFT = (n: number, plus = false): string => (n === 0 ? 'Nothing left' : `${String(n)}${plus ? '+' : ''} ${n === 1 && !plus ? 'rep' : 'reps'} left`);

export function effortInfoLines(scale: EffortScale): EffortInfoLine[] {
  if (scale === 'rir') return [4, 3, 2, 1, 0].map((n) => ({ value: n === 4 ? '4+' : String(n), meaning: LEFT(n, n === 4) }));
  return [10, 9, 8, 7, 6].map((rpe) => ({ value: String(rpe), meaning: LEFT(10 - rpe, rpe === 6) }));
}

/** The ⓘ's spoken name. */
export function effortInfoLabel(scale: EffortScale, open: boolean): string {
  if (open) return 'Hide scale';
  return scale === 'rir' ? 'What reps in reserve means' : 'What RPE means';
}

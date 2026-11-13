import { describe, expect, it } from 'vitest';

import { effortInfoLabel, effortInfoLines } from '../src/workout/effort-info';

describe('effort scale info (F4)', () => {
  it('RPE 10 is nothing left, 9 one rep, 8 two, 7 three, 6 four or more', () => {
    expect(effortInfoLines('rpe').map((l) => `${l.value} ${l.meaning}`)).toEqual(['10 Nothing left', '9 1 rep left', '8 2 reps left', '7 3 reps left', '6 4+ reps left']);
  });

  it('the RIR scale reads the same way', () => {
    expect(effortInfoLines('rir').map((l) => `${l.value} ${l.meaning}`)).toEqual(['4+ 4+ reps left', '3 3 reps left', '2 2 reps left', '1 1 rep left', '0 Nothing left']);
  });

  it('the ⓘ has a spoken name', () => {
    expect(effortInfoLabel('rpe', false)).toBe('What RPE means');
    expect(effortInfoLabel('rir', true)).toBe('Hide scale');
  });
});

import { describe, expect, it } from 'vitest';
import { BACKOFF_BANDS, backoffLoad, belowBackoffBand, type MainFocus } from '../src/index';

/**
 * Review B3 (batch 23 Oct, track loads): the band's lower edge made a back-off heavier than its reps and RPE allow
 * (12 @ 8 and 15 @ 8 at 90 off a 100 × 6 @ 8 top). A back-off keeps what its reps and RPE give; the lower edge is
 * only a check (`belowBackoffBand`); the top edge (never within `band.min` of the top) stays a limit.
 */

const E1RM = 100 * (1 + 8 / 30);

describe('B3: the band’s lower edge is a check, not a clamp', () => {
  it('feasible: every focus, reps 3–15, RPE 6–10: load × (1 + (reps + RIR) / 30) ≤ est. max; never within band.min of the top', () => {
    for (const focus of ['strength', 'balanced', 'muscle'] as MainFocus[]) {
      for (let reps = 3; reps <= 15; reps += 1) {
        for (const rpe of [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) {
          const kg = backoffLoad({ anchorE1rm: E1RM, working: 100, reps, rpe, top: 100, focus }) ?? Infinity;
          // `tidy` keeps 3 decimals.
          expect(kg * (1 + (reps + 10 - rpe) / 30)).toBeLessThanOrEqual(E1RM + 1e-3);
          expect(kg).toBeLessThanOrEqual(100 * (1 - BACKOFF_BANDS[focus].min) + 1e-9);
        }
      }
    }
  });

  it('12 @ 8 → 86.4 and 15 @ 8 → 80.9 in every focus (were 90, 90 and Muscle 85)', () => {
    for (const focus of ['strength', 'balanced', 'muscle'] as MainFocus[]) {
      expect(backoffLoad({ anchorE1rm: E1RM, working: 100, reps: 12, rpe: 8, top: 100, focus })).toBe(86.364);
      expect(backoffLoad({ anchorE1rm: E1RM, working: 100, reps: 15, rpe: 8, top: 100, focus })).toBe(80.851);
    }
  });

  it('belowBackoffBand says when a back-off is further below the top than the band', () => {
    expect(belowBackoffBand(82.5, 100, 'strength')).toBe(true);
    expect(belowBackoffBand(95, 100, 'strength')).toBe(false);
    expect(belowBackoffBand(85, 100, 'muscle')).toBe(false);
    expect(belowBackoffBand(84.9, 100, 'muscle')).toBe(true);
    expect(belowBackoffBand(null, 100, 'muscle')).toBe(false);
  });
});

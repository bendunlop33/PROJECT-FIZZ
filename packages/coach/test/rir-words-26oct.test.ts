import { describe, expect, it } from 'vitest';

import { collectFacts, EFFORT_WORDS_LINE, verifySentence } from '../src/numbers';
import { COACH_INSTRUCTIONS } from '../src/turn';
import { PLAN_INSTRUCTIONS } from '../src/plan';

/**
 * (Ben, 26 Oct: RIR replaces RPE in the UI) The coach talks to Ben in RIR. Effort in its data stays as stored
 * (often RPE), so the numbers check accepts either form of an effort it was given: a correct reply in RIR is
 * never hidden, and an effort it wasn't given still is.
 */

describe('numbers check: RIR ↔ RPE twins', () => {
  it('a past set given as @RPE 6 backs "at RIR 4"', () => {
    const facts = collectFacts(['2026-10-17 · app: 80 kg × 12 @RPE 6, 90 kg × 12']);
    expect(verifySentence('Friday you did 80 kg × 12 at RIR 4, so go heavier.', facts).ok).toBe(true);
    expect(verifySentence('Friday you did 80 kg × 12 at RPE 6, so go heavier.', facts).ok).toBe(true);
  });

  it('JSON efforts (rpe, targetRpe, meanRpe, rir) back their twins, half values included', () => {
    const facts = collectFacts([{ text: 'YOUR DATA\n{"sets":[{"load":{"value":100},"reps":8,"rpe":8.5}],"targetRpe":8,"rir":3}', setsDone: false }]);
    expect(facts.values.has(1.5)).toBe(true);
    expect(facts.values.has(2)).toBe(true);
    expect(facts.values.has(7)).toBe(true);
  });

  it('Ben’s own RIR backs the RPE twin too', () => {
    const facts = collectFacts(['that was 2 RIR']);
    expect(facts.values.has(8)).toBe(true);
  });

  it('an effort it was not given is still hidden in a sentence about the past', () => {
    const facts = collectFacts(['2026-10-17 · app: 80 kg × 12 @RPE 6']);
    expect(verifySentence('Last time you averaged RIR 1 on bench.', facts).ok).toBe(false);
  });
});

describe('the coach is told to say RIR', () => {
  it('in every chat turn and plan turn; tool arguments stay RPE', () => {
    expect(COACH_INSTRUCTIONS).toContain(EFFORT_WORDS_LINE);
    expect(PLAN_INSTRUCTIONS).toContain(EFFORT_WORDS_LINE);
    expect(EFFORT_WORDS_LINE).toMatch(/say RIR, never RPE/);
    expect(EFFORT_WORDS_LINE).toMatch(/RPE 8\.5 is RIR 1\.5/);
    expect(EFFORT_WORDS_LINE).toMatch(/Tool arguments named rpe or targetRpe stay in RPE/);
  });
});

import { describe, expect, it } from 'vitest';

import { BUILD_INSTRUCTIONS, checkedRationale, OFFER_REPLY_BUILD_INSTRUCTIONS, OFFERED_BUILD_INSTRUCTIONS } from '../src/index';

/**
 * Review builder-v2 r5 B1u: the draft's `message` follows the load-note rule
 * (words only: no digit, number word, max/record claim or praise) and is
 * split without breaking decimals or `est.`.
 */
describe('checkedRationale: words only (r5 B1u)', () => {
  it('drops every r5 probe sentence that states a number; never garbles a decimal', () => {
    expect(checkedRationale('You did 105×8 on Tuesday, so bench leads.')).toBeNull();
    expect(checkedRationale('Bench leads; last week you hit 110 for 6.')).toBeNull();
    expect(checkedRationale('Bench 102.5 since you hit 102.5 for 8 on Tuesday. Then incline.')).toBe('Then incline.');
    expect(checkedRationale('Your est. max is 140, so bench at 110.')).toBeNull();
  });

  it('keeps qualitative reasons; drops number words, max claims, praise and change claims', () => {
    expect(checkedRationale('Bench first while you are fresh. Rows balance the pressing.')).toBe('Bench first while you are fresh. Rows balance the pressing.');
    expect(checkedRationale('Bench first. You did eight reps last time.')).toBe('Bench first.');
    expect(checkedRationale('Bench first. Close to your max.')).toBe('Bench first.');
    expect(checkedRationale('Bench first. Great session last week!')).toBe('Bench first.');
    expect(checkedRationale("Bench first. I've moved your squat to Friday.")).toBe('Bench first.');
    expect(checkedRationale('   ')).toBeNull();
  });

  it('never shows a digit of any script', () => {
    for (const m of ['Bench at １０２.５ today.', 'Bench for Ⅻ reps.', 'Top set ① then back-offs.', 'Bench 1. Rows 2.']) expect(checkedRationale(m) ?? '').not.toMatch(/\p{N}/u);
  });

  it('Coach v3 (ADR 0027): every build prompt allows numbers only from what the coach was given, up to 600 characters', () => {
    for (const p of [BUILD_INSTRUCTIONS, OFFERED_BUILD_INSTRUCTIONS, OFFER_REPLY_BUILD_INSTRUCTIONS]) {
      expect(p).not.toContain('never state numbers');
      expect(p).toMatch(/must come from YOUR DATA, a tool result, Ben’s words or this workout/);
      expect(p).toContain('at most 600 characters');
    }
  });
});

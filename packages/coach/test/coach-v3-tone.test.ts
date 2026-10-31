import { describe, expect, it } from 'vitest';
import { BUILD_LIMITS, MAX_BUILD_QUESTIONS, ProposeWorkoutArgsSchema } from '@fizz/schemas';
import { checkedRationale } from '../src/build';
import { collectFacts } from '../src/numbers';
import { COACH_INSTRUCTIONS, liveWorkoutInstructions } from '../src/turn';

/** Coach v3, slice 6 (ADR 0027): a coach's voice, short mid-workout; a build message up to 600 characters; still 2 questions at most. */

describe('tone and limits', () => {
  it('the coach talks like a coach and checks its numbers; mid-workout replies are one or two short sentences', () => {
    expect(COACH_INSTRUCTIONS).toMatch(/strength coach/);
    expect(COACH_INSTRUCTIONS).toMatch(/must come from YOUR DATA, a tool result or Ben’s words/);
    expect(COACH_INSTRUCTIONS).toMatch(/estimated 1RM is always called an estimate/);
    expect(liveWorkoutInstructions(true)).toMatch(/one or two short sentences/);
  });

  it('a build message may be up to 600 characters; longer is cut at 600 before it is checked', () => {
    expect(BUILD_LIMITS.messageMax).toBe(600);
    const sentence = 'Presses lead while you are fresh, then raises for the side delts. ';
    const long = sentence.repeat(9).trim();
    expect(long.length).toBeLessThanOrEqual(600);
    expect(ProposeWorkoutArgsSchema.shape.message.safeParse(long).success).toBe(true);
    expect(ProposeWorkoutArgsSchema.shape.message.safeParse('x'.repeat(601)).success).toBe(false);
    expect(checkedRationale(long, collectFacts([]))).toBe(long);
    expect(checkedRationale(sentence.repeat(12), collectFacts([]))?.length).toBeLessThanOrEqual(600);
  });

  it('still at most two clarifying questions per build request', () => {
    expect(MAX_BUILD_QUESTIONS).toBe(2);
  });
});

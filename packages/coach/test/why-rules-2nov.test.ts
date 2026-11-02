import { describe, expect, it } from 'vitest';
import { buildCoachContext, type CoachContextInput } from '../src/context';
import { COACH_INSTRUCTIONS, WHY_RULE_LINE } from '../src/turn';
import { workout } from './turn-fixtures';

/**
 * (Ben, 2 Nov: "a good coach applies rules without lecturing, but must be able to say why when asked") Every rule the
 * app enforces is in COACHING KNOWLEDGE by ID (context.test.ts checks each one); the coach is told to name the rule
 * and Ben's numbers when he asks why, never to invent one; and the plan's rule outcomes are in YOUR DATA.
 */

function input(over: Partial<CoachContextInput> = {}): CoachContextInput {
  return { turnKind: 'general', session: workout(), gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], thread: [], catalogue: [], ...over };
}

describe('why a rule fired', () => {
  it('every chat is told to name the rule and his numbers when asked, never invent one, and not lecture', () => {
    expect(COACH_INSTRUCTIONS).toContain(WHY_RULE_LINE);
    expect(WHY_RULE_LINE).toMatch(/one or two sentences/);
    expect(WHY_RULE_LINE).toMatch(/Never invent a rule/);
    expect(WHY_RULE_LINE).toMatch(/if no rule explains it, say so/);
    expect(WHY_RULE_LINE).toMatch(/Don’t explain rules he didn’t ask about/);
  });

  it('the plan’s rule outcomes are in YOUR DATA: VC3’s day flag and LW1’s dropped deload, with their numbers', () => {
    const ctx = buildCoachContext(
      input({
        plan: {
          today: '2026-11-02',
          inUse: {
            name: 'PPL',
            paused: null,
            muscles: ['Chest 10 direct · range 6–20 · in range', 'Chest 10 on Push A · above 8'],
            weeks: 'Week 4 of 6 · no planned deload weeks · lighter week (asked for): 3 · week 6 deload dropped: lighter week 3 was 3 weeks before (LW1)',
          },
        },
      }),
    );
    const inUse = ctx.yourData.plan?.inUse;
    expect(inUse?.muscles).toContain('Chest 10 on Push A · above 8');
    expect(inUse?.weeks).toMatch(/week 6 deload dropped: lighter week 3 was 3 weeks before \(LW1\)/);
    // The rules those name are in COACHING KNOWLEDGE, never in YOUR DATA (rule 10).
    const ids = ctx.coachingKnowledge.playbook.rules.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['VC3', 'FQ2', 'LW1', '8']));
  });

  it('no weeks line when the app has none (a coach plan): nothing is made up', () => {
    const ctx = buildCoachContext(input({ plan: { today: '2026-11-02', inUse: { name: 'Coach plan', paused: null } } }));
    expect(ctx.yourData.plan?.inUse).not.toHaveProperty('weeks');
  });
});

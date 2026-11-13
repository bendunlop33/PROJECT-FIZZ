import { describe, expect, it } from 'vitest';

import { asksForPlan, classifyBenRequest, multiWeekBlock, requestHas } from '../src/index';

/**
 * (19 Oct, plans) Ben's words that ask for a multi-day plan open
 * `propose_plan` only (`build_plan`), never a one-session build or today's
 * sets; a multi-week block isn't a plan in v1; a question about plans asks
 * nothing.
 */

describe('a plan request (build_plan)', () => {
  it.each([
    'Build me a 4-day plan',
    'build me a 4 day plan',
    'PPL week, 60 min each, dumbbells only on Friday',
    'ppl week please',
    'can you plan my week',
    'make me a 3 day split',
    'I want a weekly plan',
    'can you set me up a push pull legs plan',
    'give me an upper lower split, 4 days a week',
    'could you build a training plan for this week',
    'write me a workout plan for next week',
    'put together a 5 day programme',
    'build plans across multiple days',
    'Can you build me a plan for 3 days a week, 45 min each?',
  ])('%s', (text) => {
    const r = classifyBenRequest(text, 'general');
    expect(requestHas(r, 'build_plan')).toBe(true);
    expect(requestHas(r, 'build')).toBe(false);
    expect(requestHas(r, 'change')).toBe(false);
    expect(asksForPlan(text)).toBe(true);
  });

  it.each([
    'build me a 45 minute push session',
    'make me a leg day',
    'plan a push workout for today',
    'Can it build plans across multiple days as well not just single workouts?',
    'what should my weekly split be?',
    'build me an 8-week block',
    'a 12 week programme with deloads',
    'my plan for this week is to rest',
    'how many days a week should I lift?',
    'split squats today please',
  ])('not a plan request: %s', (text) => {
    expect(asksForPlan(text)).toBe(false);
  });

  it('a one-session build stays a build', () => {
    expect(requestHas(classifyBenRequest('build me a 45 minute push session', 'general'), 'build')).toBe(true);
    expect(requestHas(classifyBenRequest('make me a leg day', 'general'), 'build')).toBe(true);
  });

  it('a block of weeks is not available in v1', () => {
    expect(multiWeekBlock('build me an 8-week block')).toBe(true);
    expect(multiWeekBlock('a 12 week programme with deloads')).toBe(true);
    expect(multiWeekBlock('build me a 4-day plan')).toBe(false);
  });
});

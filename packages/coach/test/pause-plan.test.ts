import { describe, expect, it } from 'vitest';

import { asksToPausePlan, buildTurnRegistry, classifyBenRequest, pauseDateFromWords, requestHas } from '../src/index';

/**
 * (Ben, 20 Oct: "should also be able to pause eg if go on hols") `pause_plan` opens only on Ben's
 * own pause or resume words (code, never the model's reading), and a date he says outright is read
 * by code.
 */
describe('Ben asks to pause or resume his plan', () => {
  it.each([
    'Pause my plan',
    'can you pause the plan please',
    "I'm on holiday till 3 Nov",
    'Im on hols until the 10th',
    'going on holiday next week',
    'Put my plan on hold',
    "I'll be away until 12 November",
    'Resume my plan',
    "I'm back from holiday",
  ])('"%s" asks', (text) => {
    expect(asksToPausePlan(text)).toBe(true);
  });

  it.each(['Should I train on holiday?', 'What do you think of my plan?', 'Build me a 4-day plan', 'Pause the timer', 'Change my plan: swap squats', 'hold the weight next set'])('"%s" does not', (text) => {
    expect(asksToPausePlan(text)).toBe(false);
  });

  it('opens pause_plan only (never a build or today’s sets)', () => {
    const r = classifyBenRequest("I'm on holiday till 3 Nov", 'general');
    expect(requestHas(r, 'plan_pause')).toBe(true);
    const reg = buildTurnRegistry({ kind: 'general', benRequest: r, acceptedOffer: false, benPainWords: false, structuralSignals: [] });
    expect(reg.tools.map((t) => t.name)).toContain('pause_plan');
    expect(reg.tools.map((t) => t.name)).not.toContain('propose_plan');
    const other = buildTurnRegistry({ kind: 'general', benRequest: classifyBenRequest('Build me a 4-day plan', 'general'), acceptedOffer: false, benPainWords: false, structuralSignals: [] });
    expect(other.tools.map((t) => t.name)).not.toContain('pause_plan');
    expect(other.withheld).toContainEqual({ name: 'pause_plan', reason: 'needs_request' });
  });
});

describe('the date Ben said', () => {
  const today = '2026-10-20';
  it.each([
    ["I'm on holiday till 3 Nov", '2026-11-03'],
    ['until the 3rd of November', '2026-11-03'],
    ['back Nov 3rd', '2026-11-03'],
    ['till 2 Jan', '2027-01-02'],
    ['until 20 Oct', '2027-10-20'],
    ['until the 25th', '2026-10-25'],
    ['until the 5th', '2026-11-05'],
    ['till 3 November 2027', '2027-11-03'],
    ['until 31 Nov', null],
    ['for two weeks', null],
  ])('"%s" → %s', (text, want) => {
    expect(pauseDateFromWords(text, today)).toBe(want);
  });
});

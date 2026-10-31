import { describe, expect, it } from 'vitest';

import { asksToPausePlan, buildTurnRegistry, classifyBenRequest, pauseDateFromWords, pauseDatesFromWords, requestHas } from '../src/index';

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
    'Put my plan on hold',
    "I'm away until 12 November",
    "I'm on holiday from today till 3 Nov",
    "I'm on holiday till next Friday",
    'Resume my plan',
    "I'm back from holiday",
    "I'm back",
    "I'm back home now, let's go",
  ])('"%s" asks', (text) => {
    expect(asksToPausePlan(text)).toBe(true);
  });

  it.each(['Should I train on holiday?', 'What do you think of my plan?', 'Build me a 4-day plan', 'Pause the timer', 'Change my plan: swap squats', 'hold the weight next set'])('"%s" does not', (text) => {
    expect(asksToPausePlan(text)).toBe(false);
  });

  // Review plan-adapt B2: a pause starts now, so a holiday still ahead isn't Ben asking (the coach may offer);
  // "I'm back to 100 kg" isn't a resume.
  it.each([
    'going on holiday next week',
    'going on holiday next week, anything I should do before?',
    'im off on leave in december',
    "I'll be away until 12 November",
    "I'm on holiday from 25 Oct to 3 Nov",
    "I'm on holiday tomorrow till 3 Nov",
    "we're on holiday in two weeks",
    "I'm away for a week on Friday",
    'pause my plan next week',
    "I'm back to 100 kg on bench",
    "I'm back at the gym after a cold",
    "I'm back on bench today",
  ])('"%s" does not (future, or not a resume)', (text) => {
    expect(asksToPausePlan(text)).toBe(false);
  });

  it('ADR 0039: offered from every chat whenever a plan is in use (his words decide only whether it applies); never without a plan', () => {
    const r = classifyBenRequest("I'm on holiday till 3 Nov", 'general');
    expect(requestHas(r, 'plan_pause')).toBe(true);
    const reg = buildTurnRegistry({ kind: 'general', benRequest: r, acceptedOffer: false, benPainWords: false, structuralSignals: [], planInUse: true });
    expect(reg.tools.map((t) => t.name)).toContain('pause_plan');
    expect(reg.tools.map((t) => t.name)).not.toContain('propose_plan');
    const workout = buildTurnRegistry({ kind: 'workout', benRequest: null, acceptedOffer: false, benPainWords: false, structuralSignals: [], planInUse: true });
    expect(workout.tools.map((t) => t.name)).toContain('pause_plan');
    const none = buildTurnRegistry({ kind: 'general', benRequest: r, acceptedOffer: false, benPainWords: false, structuralSignals: [] });
    expect(none.withheld).toContainEqual({ name: 'pause_plan', reason: 'no_target' });
  });
});

describe('the date Ben said', () => {
  const today = '2026-10-20';
  it.each([
    ["I'm on holiday till 3 Nov", '2026-11-03'],
    ['until the 3rd of November', '2026-11-03'],
    ['back Nov 3rd', '2026-11-03'],
    ['till 2 Jan', '2027-01-02'],
    // Said on 20 Oct: today, refused as `bad_date` (review S4), never a year away.
    ['until 20 Oct', '2026-10-20'],
    ['until 19 Oct', '2027-10-19'],
    ['until the 25th', '2026-10-25'],
    ['until the 5th', '2026-11-05'],
    ['till 3 November 2027', '2027-11-03'],
    ['until 31 Nov', null],
    // Several dates: the one after till / until / to, else the last (review S4).
    ["I'm on holiday from 25 Oct to 3 Nov", '2026-11-03'],
    ['away 25 Oct until 3 Nov', '2026-11-03'],
    ['flying out 25 Oct, back 3 Nov', '2026-11-03'],
    ['25 oct and 3 nov', '2026-11-03'],
    ['until the 25th of December', '2026-12-25'],
    ['for two weeks', null],
  ])('"%s" → %s', (text, want) => {
    expect(pauseDateFromWords(text, today)).toBe(want);
  });
});

describe('several dates in Ben\'s words (review plan-adapt S4)', () => {
  it('lists every date he named, in order, and picks the until one', () => {
    expect(pauseDatesFromWords('from 25 Oct to 3 Nov', '2026-10-20')).toEqual({ date: '2026-11-03', all: ['2026-10-25', '2026-11-03'] });
    expect(pauseDatesFromWords('for two weeks', '2026-10-20')).toEqual({ date: null, all: [] });
  });
});

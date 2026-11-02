import { describe, expect, it } from 'vitest';

import { asksForRestChange, asksPlanSettingChange, buildTurnRegistry, findTool, mentionsRestSettings, PLAN_CHANGE_LINE, planChangeRequestOf, REST_SETTINGS_TOOL_LINE } from '../src/index';

/**
 * (Ben, 2 Nov) `propose_plan_change` and `update_rest_settings` in the one registry (ADR 0039), loaded only on the turns
 * whose words need them (coachtime's trimmed context, 1 Nov). Ben-like messages.
 */
describe('plan-level changes and rest settings in the registry', () => {
  const gate = (over: Partial<Parameters<typeof buildTurnRegistry>[0]> = {}): Parameters<typeof buildTurnRegistry>[0] => ({ kind: 'general', benRequest: null, acceptedOffer: false, benPainWords: false, structuralSignals: [], ...over });
  const names = (g: Parameters<typeof buildTurnRegistry>[0]): string[] => buildTurnRegistry(g).tools.map((t) => t.name);

  it('propose_plan_change: every chat while a plan is in use and his words ask for one; never otherwise, never in the review', () => {
    expect(names(gate({ planInUse: true, planChangeWords: true }))).toContain('propose_plan_change');
    expect(names(gate({ kind: 'workout', planInUse: true, planChangeWords: true }))).toContain('propose_plan_change');
    expect(names(gate({ planInUse: true }))).not.toContain('propose_plan_change');
    expect(names(gate({ planChangeWords: true }))).not.toContain('propose_plan_change');
    expect(names(gate({ kind: 'summary', planInUse: true, planChangeWords: true }))).not.toContain('propose_plan_change');
    // Always a proposal (rule 3).
    expect(findTool('propose_plan_change')).toMatchObject({ effect: 'propose', writes: ['plan_settings'], capabilitySection: 'when_you_ask' });
  });

  it('update_rest_settings: every chat with a profile when his words are about rest; a versioned update of his settings only', () => {
    expect(names(gate({ trainingProfile: true, restWords: true }))).toContain('update_rest_settings');
    expect(names(gate({ kind: 'workout', trainingProfile: true, restWords: true }))).toContain('update_rest_settings');
    expect(names(gate({ trainingProfile: true }))).not.toContain('update_rest_settings');
    expect(names(gate({ kind: 'summary', trainingProfile: true, restWords: true }))).not.toContain('update_rest_settings');
    expect(findTool('update_rest_settings')).toMatchObject({ effect: 'versioned_update', writes: ['rest_settings'] });
  });

  it('Ben’s plan words open the plan tool', () => {
    for (const w of ['make next week a lighter week', 'Can this week be a deload?', 'go to 4 days a week', 'make the plan 8 weeks', 'end this plan', 'Set days: Mon, Tue, Thu and Fri', 'switch to any days', 'I can only train 3 days per week now']) {
      expect([w, asksPlanSettingChange(w)]).toEqual([w, true]);
    }
    for (const w of ['bench felt heavy', 'add curls to pull day', 'rest 2 minutes on accessories', 'how is my plan going?']) {
      expect([w, asksPlanSettingChange(w)]).toEqual([w, false]);
    }
  });

  it('Ben’s rest words open the rest tool and count as asked; a question or a rest day doesn’t', () => {
    for (const w of ['rest 2 minutes on accessories', 'turn on shorten main lift', 'Make my rests shorter when I’m short on time', 'Set warm-up rest to 45 seconds']) {
      expect([w, mentionsRestSettings(w), asksForRestChange(w)]).toEqual([w, true, true]);
    }
    expect(mentionsRestSettings('make today a rest day')).toBe(false);
    expect(mentionsRestSettings('next week a rest week')).toBe(false);
    expect(asksForRestChange('How long should I rest between sets?')).toBe(false);
    expect(asksForRestChange('my rests feel long')).toBe(false);
    // Short on time today is Time's fit, not his `Rest when short on time` setting.
    expect(mentionsRestSettings('I’m short on time today, can you shorten it?')).toBe(false);
  });

  it('the model’s weekdays become the builder’s (Mon = 0)', () => {
    expect(planChangeRequestOf({ kind: 'schedule', schedule: 'set', weekdays: ['mon', 'tue', 'thu', 'fri'] })).toEqual({ kind: 'schedule', schedule: 'set', weekdays: [0, 1, 3, 4] });
    expect(planChangeRequestOf({ kind: 'days_per_week', days: 4, weekdays: null })).toEqual({ kind: 'days_per_week', days: 4, weekdays: null });
    expect(planChangeRequestOf({ kind: 'end' })).toEqual({ kind: 'end' });
  });

  it('the prompt lines say these can be changed', () => {
    expect(PLAN_CHANGE_LINE).toContain('Never say you can’t change these');
    expect(REST_SETTINGS_TOOL_LINE).toContain('Today too');
  });
});

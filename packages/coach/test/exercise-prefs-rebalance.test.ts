import { describe, expect, it } from 'vitest';

import { asksExercisePreference, asksMuscleBalance, buildTurnRegistry, EXERCISE_PREF_TOOL_LINE, REBALANCE_TOOL_LINE } from '../src/index';

/**
 * (Ben, 2 Nov) `set_exercise_preference` and `propose_rebalance`: one registry (ADR 0039), each offered only while its
 * target exists and on the words that need it, so other turns (plan turns included) don't grow.
 */
describe('set_exercise_preference and propose_rebalance in the registry', () => {
  const gate = (over: Partial<Parameters<typeof buildTurnRegistry>[0]> = {}): Parameters<typeof buildTurnRegistry>[0] => ({ kind: 'general', benRequest: null, acceptedOffer: false, benPainWords: false, structuralSignals: [], planInUse: true, ...over });
  const names = (g: Parameters<typeof buildTurnRegistry>[0]): string[] => buildTurnRegistry(g).tools.map((t) => t.name);

  it('offered in general and workout chats only with their target; never in the post-workout review', () => {
    expect(names(gate({ exercisePrefs: true }))).toContain('set_exercise_preference');
    expect(names(gate({ kind: 'workout', rebalanceOpen: true }))).toContain('propose_rebalance');
    expect(names(gate())).not.toContain('set_exercise_preference');
    expect(names(gate())).not.toContain('propose_rebalance');
    expect(names(gate({ kind: 'summary', exercisePrefs: true }))).not.toContain('set_exercise_preference');
    expect(names(gate({ kind: 'summary', rebalanceOpen: true }))).not.toContain('propose_rebalance');
    const withheld = buildTurnRegistry(gate()).withheld;
    expect(withheld).toEqual(expect.arrayContaining([{ name: 'set_exercise_preference', reason: 'no_target' }, { name: 'propose_rebalance', reason: 'no_target' }]));
  });

  it('Ben’s like/dislike words open the preference tool; a question or other words don’t', () => {
    expect(asksExercisePreference('I don’t like leg extensions, take them out')).toBe(true);
    expect(asksExercisePreference("I don't like leg extensions, take them out")).toBe(true);
    expect(asksExercisePreference('I hate lunges')).toBe(true);
    expect(asksExercisePreference('not a fan of dips')).toBe(true);
    expect(asksExercisePreference('I like hack squats')).toBe(true);
    expect(asksExercisePreference('clear my dislike of lunges')).toBe(true);
    expect(asksExercisePreference('Should I drop lunges?')).toBe(false);
    expect(asksExercisePreference('Bench felt heavy today')).toBe(false);
    // A plain remove is a change to the plan or today, not a stated preference.
    expect(asksExercisePreference('remove the last set of curls')).toBe(false);
    expect(asksExercisePreference('take leg press out of Legs B')).toBe(false);
    expect(asksExercisePreference('am I doing enough biceps?')).toBe(false);
  });

  it('muscle and balance words open Rebalance: "am I doing enough biceps?", "rebalance my plan"', () => {
    expect(asksMuscleBalance('am I doing enough biceps?')).toBe(true);
    expect(asksMuscleBalance('rebalance my plan')).toBe(true);
    expect(asksMuscleBalance('Is my plan balanced?')).toBe(true);
    expect(asksMuscleBalance('too much chest in my plan')).toBe(true);
    expect(asksMuscleBalance('Bench felt heavy today')).toBe(false);
    expect(asksMuscleBalance("I don't like leg extensions, take them out")).toBe(false);
  });

  it('the prompt lines: apply at once with Undo; the swap is a proposal on the same card; Rebalance is the screen’s', () => {
    expect(EXERCISE_PREF_TOOL_LINE).toContain('saved at once with Undo');
    expect(EXERCISE_PREF_TOOL_LINE).toContain('don’t also call propose_plan_swap');
    expect(REBALANCE_TOOL_LINE).toContain('Rebalance card');
  });
});

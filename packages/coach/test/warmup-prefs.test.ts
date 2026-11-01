import { describe, expect, it } from 'vitest';

import { asksForWarmupChange, buildTurnRegistry, WARMUP_PREFS_TOOL_LINE } from '../src/index';

/** (Ben, 1 Nov) `update_warmup_prefs`: offered in every chat with a profile; applied only on Ben's own words. */
describe('update_warmup_prefs', () => {
  const gate = (over: Partial<Parameters<typeof buildTurnRegistry>[0]> = {}): Parameters<typeof buildTurnRegistry>[0] => ({ kind: 'general', benRequest: null, acceptedOffer: false, benPainWords: false, structuralSignals: [], ...over });
  const names = (g: Parameters<typeof buildTurnRegistry>[0]): string[] => buildTurnRegistry(g).tools.map((t) => t.name);

  it('offered in general and workout chats whenever a profile exists; never in the post-workout review', () => {
    expect(names(gate({ trainingProfile: true }))).toContain('update_warmup_prefs');
    expect(names(gate({ kind: 'workout', trainingProfile: true }))).toContain('update_warmup_prefs');
    expect(names(gate())).not.toContain('update_warmup_prefs');
    expect(names(gate({ kind: 'summary', trainingProfile: true }))).not.toContain('update_warmup_prefs');
  });

  it('Ben’s words ask for a warm-up change; a question or other words don’t', () => {
    expect(asksForWarmupChange('Use simple warm-up weights for everything')).toBe(true);
    expect(asksForWarmupChange('No warm-ups on face pulls please')).toBe(true);
    expect(asksForWarmupChange('Turn warm ups back on for curls')).toBe(true);
    expect(asksForWarmupChange('Why are my warm-ups so fiddly?')).toBe(false);
    expect(asksForWarmupChange('Bench felt heavy today')).toBe(false);
  });

  it('the prompt line says warm-ups can be changed', () => {
    expect(WARMUP_PREFS_TOOL_LINE).toContain('Never say you can’t change warm-ups');
  });
});

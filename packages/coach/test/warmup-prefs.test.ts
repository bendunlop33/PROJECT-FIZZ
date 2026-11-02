import { describe, expect, it } from 'vitest';

import { asksForGeneralWarmup, asksForWarmupChange, buildTurnRegistry, PARTIAL_ASK_LINE, PLAN_ADD_LINE, WARMUP_PREFS_TOOL_LINE } from '../src/index';
import { futureScopeOnly } from '../src/request';
import { semanticArgs } from '../src/tool-call';
import { COACH_INSTRUCTIONS as INSTRUCTIONS } from '../src/turn';
import { COACH_TOOL_ARGS, UpdateWarmupPrefsArgsSchema } from '@fizz/schemas';
import { strictJsonSchema } from '../src/function-tools';

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

  // (Ben, 2 Nov, build 513) "bike for 8 minutes first on leg days, rowing for 4 minutes first on other days".
  it('a standing cardio-first rule is a warm-up change (his exact words); today only, or a question, is not', () => {
    const ben = 'bike for 8 minutes first on leg days, rowing for 4 minutes first on other days';
    expect(asksForGeneralWarmup(ben)).toBe(true);
    expect(asksForWarmupChange(ben)).toBe(true);
    // Recurring: never read as a change to today's live workout.
    expect(futureScopeOnly(ben)).toBe(true);
    expect(asksForGeneralWarmup('5 min row before every workout')).toBe(true);
    expect(asksForGeneralWarmup('Always start with 10 minutes on the bike')).toBe(true);
    expect(asksForGeneralWarmup('add a bike to today, 8 minutes first')).toBe(false);
    expect(asksForGeneralWarmup('Should I do 8 minutes of bike first on leg days?')).toBe(false);
    expect(asksForGeneralWarmup('Bench felt heavy today')).toBe(false);
  });

  it('the tool takes general rules (strict schema: every field present), the routing line names it, and the plan add points here', () => {
    const parsed = UpdateWarmupPrefsArgsSchema.safeParse({ simpleLoads: null, exercises: [], general: [{ days: 'legs', exercise: 'bike', minutes: 8 }, { days: 'other', exercise: 'rowing', minutes: 4 }], benAsked: true, benQuote: 'x' });
    expect(parsed.success).toBe(true);
    // A call from before the field still parses.
    expect(UpdateWarmupPrefsArgsSchema.safeParse({ simpleLoads: true, exercises: [], benAsked: true, benQuote: 'x' }).success).toBe(true);
    const schema = strictJsonSchema(COACH_TOOL_ARGS.update_warmup_prefs) as { required: string[] };
    expect(schema.required).toContain('general');
    expect(WARMUP_PREFS_TOOL_LINE).toContain('A standing cardio-first rule');
    expect(PLAN_ADD_LINE).toContain('update_warmup_prefs');
    // The same rule twice is the same call (idempotent op ID), whatever the case of the words.
    const a = semanticArgs({ tool: 'update_warmup_prefs', args: { simpleLoads: null, exercises: [], general: [{ days: 'legs', exercise: 'Bike', minutes: 8 }], benAsked: true, benQuote: 'x' } } as never);
    const b = semanticArgs({ tool: 'update_warmup_prefs', args: { simpleLoads: null, exercises: [], general: [{ days: 'legs', exercise: 'bike', minutes: 8 }], benAsked: true, benQuote: 'y' } } as never);
    expect(a).toEqual(b);
  });

  it('honesty: the coach is told to say what its tools can’t do once, and to label a partial proposal', () => {
    expect(INSTRUCTIONS).toContain(PARTIAL_ASK_LINE);
    expect(PARTIAL_ASK_LINE).toContain('notIncluded');
  });
});

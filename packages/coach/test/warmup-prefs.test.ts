import { describe, expect, it } from 'vitest';

import { asksForWarmupChange, buildTurnRegistry, PARTIAL_ASK_LINE, PLAN_ADD_LINE, WARMUP_PREFS_TOOL_LINE } from '../src/index';
import { futureScopeOnly } from '../src/request';
import { semanticArgs } from '../src/tool-call';
import { COACH_INSTRUCTIONS as INSTRUCTIONS } from '../src/turn';
import { COACH_TOOL_ARGS, ProposePlanAddArgsSchema, UpdateWarmupPrefsArgsSchema } from '@fizz/schemas';
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

  // (Ben, 2 Nov: "no i am talking about the ability to add that with the coach for the plan. the coach should know
  // when there are leg days. it just needs the ability to add it") Cardio first is a plan add, not a warm-up setting.
  const BEN = 'bike for 8 minutes first on leg days, rowing for 4 minutes first on other days';

  it('his exact words are not a warm-up setting change; they are recurring (never today’s workout)', () => {
    expect(asksForWarmupChange(BEN)).toBe(false);
    expect(futureScopeOnly(BEN)).toBe(true);
  });

  it('update_warmup_prefs has no cardio rules any more; the routing lines send cardio first to propose_plan_add', () => {
    // The retired field is refused (strict schema), and not offered to the model.
    expect(UpdateWarmupPrefsArgsSchema.safeParse({ simpleLoads: null, exercises: [], general: [{ days: 'legs', exercise: 'bike', minutes: 8 }], benAsked: true, benQuote: 'x' }).success).toBe(false);
    expect(UpdateWarmupPrefsArgsSchema.safeParse({ simpleLoads: true, exercises: [], benAsked: true, benQuote: 'x' }).success).toBe(true);
    expect((strictJsonSchema(COACH_TOOL_ARGS.update_warmup_prefs) as { required: string[] }).required).not.toContain('general');
    expect(WARMUP_PREFS_TOOL_LINE).toContain('is not a warm-up setting: it is propose_plan_add');
    expect(PLAN_ADD_LINE).toContain('Never update_warmup_prefs for this');
    expect(PLAN_ADD_LINE).toContain('you decide which plan days are leg days');
  });

  it('propose_plan_add carries a second add (`also`) with its own days; no code-decided day types', () => {
    const call = {
      add: 'exercise-bike', days: ['Legs A', 'Legs B'], after: null, workingSets: 1, reps: null, load: null, position: 'first', before: null, minutes: 8, distanceM: null,
      also: [{ add: 'rowing-erg', days: ['Push A', 'Pull A', 'Upper B'], position: 'first', before: null, after: null, workingSets: 1, reps: null, minutes: 4, distanceM: null }],
      notIncluded: null, reason: 'Cardio first.',
    };
    expect(ProposePlanAddArgsSchema.safeParse(call).success).toBe(true);
    expect(ProposePlanAddArgsSchema.safeParse({ ...call, dayType: 'legs' }).success).toBe(false);
    expect((strictJsonSchema(COACH_TOOL_ARGS.propose_plan_add) as { required: string[] }).required).toContain('also');
    // The same proposal twice is the same call (idempotent op ID), whatever the order or case of the days.
    const a = semanticArgs({ tool: 'propose_plan_add', args: call } as never);
    const b = semanticArgs({ tool: 'propose_plan_add', args: { ...call, reason: 'x', also: [{ ...call.also[0], days: ['upper b', 'Pull A', 'push a'] }] } } as never);
    expect(a).toEqual(b);
  });

  it('honesty: the coach is told to say what its tools can’t do once, and to label a partial proposal', () => {
    expect(INSTRUCTIONS).toContain(PARTIAL_ASK_LINE);
    expect(PARTIAL_ASK_LINE).toContain('notIncluded');
  });
});

import { describe, expect, it } from 'vitest';
import { BUILDER_LOAD_BOUNDS } from '@fizz/domain';
import { BUILD_INSTRUCTIONS, LIVE_LOAD_CHOICE_LINE, LOAD_CHOICE_LINE, OFFERED_BUILD_INSTRUCTIONS, PLAN_INSTRUCTIONS } from '../src/index';
import { liveWorkoutInstructions } from '../src/turn';

// Ben, 19 Oct: "coach weight limits - i would say 20% for both, but gpt should consider".
describe('coach load choice: 20% is a ceiling, not a target', () => {
  it('states the ceiling from the same bounds the checker uses', () => {
    expect(BUILDER_LOAD_BOUNDS.capE).toBe(1.2);
    expect(LOAD_CHOICE_LINE).toContain('Your own loads are never more than 20% above the weight his e1rmEst supports for those reps and target RPE (not above the e1rmEst itself), or 20% above his last weight for those reps');
    expect(LOAD_CHOICE_LINE).not.toMatch(/caps it there,/);
    expect(LIVE_LOAD_CHOICE_LINE).toContain('never more than 20% above the planned weight');
  });

  it('ADR 0038 (Ben, 28 Oct): the ceiling is only for the coach’s own loads; a weight Ben names is used exactly', () => {
    expect(LOAD_CHOICE_LINE).toContain('A weight, reps or sets Ben names are used exactly as he said them');
    expect(LIVE_LOAD_CHOICE_LINE).toContain('A weight Ben names is used exactly');
    expect(LIVE_LOAD_CHOICE_LINE).toContain('stay below it');
  });

  it('asks for small steps by default and a stated reason for anything bigger', () => {
    for (const line of [LOAD_CHOICE_LINE, LIVE_LOAD_CHOICE_LINE]) {
      expect(line).toContain('one small step');
      expect(line).toContain('clear signal');
      expect(line).toContain('reps well over the range at low RPE');
    }
    expect(LOAD_CHOICE_LINE).toContain('the basis says which');
    expect(LIVE_LOAD_CHOICE_LINE).toContain('say why in your reason');
  });

  it('is in the build, plan and live-workout instructions', () => {
    expect(BUILD_INSTRUCTIONS).toContain(LOAD_CHOICE_LINE);
    expect(PLAN_INSTRUCTIONS).toContain(LOAD_CHOICE_LINE);
    expect(OFFERED_BUILD_INSTRUCTIONS).toContain('Only if you call `propose_workout`: a weight, reps or sets Ben names are used exactly');
    expect(liveWorkoutInstructions(true)).toContain(LIVE_LOAD_CHOICE_LINE);
    expect(liveWorkoutInstructions(false)).toContain(LIVE_LOAD_CHOICE_LINE);
  });
});

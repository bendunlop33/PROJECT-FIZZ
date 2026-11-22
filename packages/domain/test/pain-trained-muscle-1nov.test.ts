import { describe, expect, it } from 'vitest';
import { classifyPainMention } from '../src/index';

/** (Ben, 1 Nov, build 500) A muscle named as the one a lift trained is training talk, never a pain question; pain still is. */
describe('trained muscles are not a pain question', () => {
  it('"the shoulders I just trained", "pre-fatigued", "shoulder-led" are not a pain question (none)', () => {
    expect(classifyPainMention('I think we didn’t adjust the plan considering the shoulders I just trained?')).toBe('none');
    expect(classifyPainMention('Push B should be different since shoulders are pre-fatigued')).toBe('none');
    expect(classifyPainMention('Push B is shoulder-led and bench comes after')).toBe('none');
  });
  it('pain, or a bare body part, still counts (rule 9)', () => {
    expect(classifyPainMention('my shoulder hurts, I just trained it')).toBe('pain');
    expect(classifyPainMention('shoulder')).toBe('unclear');
    expect(classifyPainMention('my shoulder feels off, just trained it')).toBe('unclear');
  });
});

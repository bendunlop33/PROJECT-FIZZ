import { describe, expect, it } from 'vitest';
import { chipRequest, classifyBenRequest, isStructuralRequest } from '../src/request';

describe('classifyBenRequest (the ben_request gate; review S3)', () => {
  it.each([
    // Directives
    ['drop the weight for the last two', 'change'],
    ['Please lower sets 3 and 4 to 95', 'change'],
    ['can you take 5 kg off?', 'change'],
    ['could we go a bit lighter for the rest', 'change'],
    ['I want it lighter', 'change'],
    ["let's do 95 for the last set", 'change'],
    ['ok just add another set', 'change'],
    ['bump bench up next time', 'change'],
    // Difficulty reports that the spec treats as Path A (coach-adjustments §4.1)
    ['that was a grind', 'difficulty'],
    ['too easy, what next?', 'difficulty'],
    ['way too heavy', 'difficulty'],
    ["couldn't finish the last set", 'difficulty'],
    // Structural (CC10)
    ['swap cable fly for something else next time', 'structural'],
    ["I'm bored of incline press", 'structural'],
    ['can we mix it up next week?', 'structural'],
    // Memory
    ['remember that I train before work', 'memory'],
    ['please forget that I hate lunges', 'memory'],
  ] as const)('%s → %s', (text, kind) => {
    expect(classifyBenRequest(text)).toEqual({ source: 'words', kind });
  });

  it.each([
    'why is set 3 at 100?',
    'should I drop the weight?',
    'what do you think of my bench?',
    'how many sets are left?',
    'is 95 too light?',
    'thanks',
    'nice, that felt good',
    'yes',
    'do it',
    'what was my best squat?',
    'why did you swap cable fly?',
  ])('not a request: %s', (text) => {
    expect(classifyBenRequest(text)).toBeNull();
  });

  it('a chip is always a request, never structural', () => {
    expect(chipRequest('too_hard')).toEqual({ source: 'chip', chip: 'too_hard' });
    expect(isStructuralRequest(chipRequest('pain'))).toBe(false);
    expect(isStructuralRequest(null)).toBe(false);
    expect(isStructuralRequest(classifyBenRequest('swap cable fly'))).toBe(true);
  });
});

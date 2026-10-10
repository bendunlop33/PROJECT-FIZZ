import { describe, expect, it } from 'vitest';
import { chipRequest, classifyBenRequest, isStructuralRequest, requestHas } from '../src/request';

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
    // Noun-like verbs with an object or value (review r2 B2)
    ['set 3 to 95', 'change'],
    ['set it to 95', 'change'],
    ['up the weight on the last set', 'change'],
    ['make it lighter', 'change'],
    ['go 95 for the rest', 'change'],
    ['take 5 off the last two', 'change'],
    ['use 95 for the rest', 'change'],
    ['give me 95 for the last set', 'change'],
    ['I want to drop the last set', 'change'],
    ['I want another set', 'change'],
    ['switch to 95 for the rest', 'change'],
    ["don't change my routine, just lower the weight", 'change'],
    ['remember that pause reps build strength', 'memory'],
    // Review r3 B1: real requests still count after the anchoring.
    ['could you lower it?', 'change'],
    ['Hey coach, drop the last set', 'change'],
    ['drop me to 95', 'change'],
    ['bump me up', 'change'],
    ['I need more weight', 'change'],
    ['I want one more set', 'change'],
    ['I want less weight on the last set', 'change'],
    ['go ahead and drop it to 95', 'change'],
    ['Sure, lower it to 95', 'change'],
    ["that's too much", 'difficulty'],
    ['Remember that my left knee is dodgy on lunges', 'memory'],
    // Review r3 S1: the playbook is its own kind.
    ['add this as a general rule: pause reps build strength', 'playbook'],
    ['put that in the playbook', 'playbook'],
  ] as const)('%s → %s', (text, kind) => {
    expect(classifyBenRequest(text)).toEqual({ source: 'words', kinds: [kind] });
  });

  it('a message can carry more than one kind', () => {
    expect(classifyBenRequest('swap cable fly next time and drop bench to 95')).toEqual({ source: 'words', kinds: ['structural', 'change'] });
    expect(classifyBenRequest('remember that I train before work. Also lower sets 3 and 4')).toEqual({ source: 'words', kinds: ['memory', 'change'] });
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
    // Review r2 B2: remarks that used to open adjust_pending_sets.
    'Set 3 was fine',
    'set 2 felt good',
    'Up next is squat right?',
    'I want to understand why set 3 is 100',
    'I need to leave by 7',
    'Can you go over my form cues?',
    'Plan looks good',
    'Log looks right',
    'Take your time',
    'Remember when I did 100 for 8?',
    'I am not bored of incline press',
    "I'm not bored of incline press",
    "don't change my routine",
    'make sure I rest 3 minutes',
    'forget it',
    'set 4 is the last one',
    'drop sets are fun',
    'go over the plan again',
    'I need a minute',
    'move on to the next exercise',
    // Review r3 B1: questions asking for the coach's view.
    'Why would you lower sets 3 and 4?',
    'What would you change?',
    'Would you lower it if you were me?',
    'why would we drop the weight',
    'Change nothing',
    // Wants with no training object.
    'I need more sleep',
    'I want another coffee',
    'I would like more detail',
    'I want more cues',
    'I need less talking',
    // `'s` attached to the noun.
    "Lower back's a bit tight",
    "Cut's going well, down 2 kg",
    // A strong verb as a label, noun or with a person object.
    'Update: my shoulder feels fine',
    'Scale says 80 kg today',
    'Add me as a friend lol',
    'Remove? no keep it',
    // A bare acceptance belongs to acceptedOffer, not here.
    'Go ahead',
    'yes go ahead',
    // Review r3 nit: "too much" needs a training subject.
    'Too much coffee this morning',
    // Review r3 S1: a remember question isn't a memory request.
    'Remember that time I hit 100?',
    // Adversarial: more questions and non-requests.
    'Drop it?',
    'Lower sets 3 and 4?',
    'Add a set?',
    'swap it?',
    'why not drop it to 95?',
    'what if we dropped it?',
    'how about 95 for the rest?',
    'what about the last two at 95?',
    "what's your take, lower it?",
    'Can you not lower it',
    "Let's not change anything",
    'Let’s leave it',
    'Lower? Nah',
    "Don't add anything",
    'Would it be better to drop the weight?',
    'Do you think I should cut set 4?',
    'I wonder if I should drop it',
    "I don't want it in the playbook",
    'is it a good rule to add sets?',
    "Raise's a strange word",
    'Switch was broken at the gym',
    'Delete key is sticking on my phone',
  ])('not a request: %s', (text) => {
    expect(classifyBenRequest(text)).toBeNull();
  });

  it('a chip is always a request, never structural', () => {
    expect(chipRequest('too_hard')).toEqual({ source: 'chip', chip: 'too_hard' });
    expect(isStructuralRequest(chipRequest('pain'))).toBe(false);
    expect(isStructuralRequest(null)).toBe(false);
    expect(isStructuralRequest(classifyBenRequest('swap cable fly'))).toBe(true);
    expect(requestHas(chipRequest('too_easy'), 'change')).toBe(true);
    expect(requestHas(chipRequest('too_easy'), 'memory')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { asksForMoreSets, chipRequest, classifyBenRequest, isStructuralRequest, requestHas } from '../src/request';

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
    // Review r4 B1: real requests and reports still count with the object and report checks.
    ['Set 3 was too heavy', 'difficulty'],
    ['Bench felt way too light', 'difficulty'],
    ['95 is too heavy', 'difficulty'],
    ['felt too easy', 'difficulty'],
    ['too heavy for me', 'difficulty'],
    ['The last set was way too heavy', 'difficulty'],
    ["It's getting too heavy", 'difficulty'],
    ["I'm finding it too heavy", 'difficulty'],
    ['Set 3 was brutal', 'difficulty'],
    ['failed the last rep', 'difficulty'],
    ['missed two reps', 'difficulty'],
    ["Couldn't lock it out", 'difficulty'],
    ['cut set 4', 'change'],
    ['skip the last set', 'change'],
    ['drop down a bit', 'change'],
    ['knock 5 off', 'change'],
    ['add a set', 'change'],
    ['Change bench to 95', 'change'],
    ['Deload bench next time', 'change'],
    ['ease off a bit', 'change'],
    ['adjust the rest to 95', 'change'],
    ['delete set 4', 'change'],
    ['up the weight', 'change'],
    ['Up it to 100', 'change'],
    ['I want more volume', 'change'],
    ['swap cable fly for pec deck', 'structural'],
    ['switch to dumbbells', 'structural'],
    // Review r4 S1: clear requests that used to return nothing.
    ['Lighter please', 'change'],
    ['95 for the rest please', 'change'],
    ['Can I go lighter?', 'change'],
    ['Can I drop to 95?', 'change'],
    ['Bring it down to 95', 'change'],
    ['Gimme 95 for the rest', 'change'],
    ['Less weight next set', 'change'],
    ['Sets 3 and 4 at 95', 'change'],
    ['Last two at 95', 'change'],
    ['Put me down for 95', 'change'],
    ['Another set please', 'change'],
    ['One more set please', 'change'],
    ['Extra set', 'change'],
    ['Two more reps on the last set', 'change'],
    ['Heavier next time', 'change'],
    ["I'm sick of cable fly", 'structural'],
    ['Can we do something other than cable fly?', 'structural'],
    ['Remember: no lunges', 'memory'],
    // Review r4 S2: the spec's own playbook example; the content after the label is data.
    ['Add a rule: never squat after deadlifts', 'playbook'],
    ['Add a rule: drop the weight when RPE 10', 'playbook'],
    ['New rule: deload every fifth week', 'playbook'],
  ] as const)('%s → %s', (text, kind) => {
    expect(classifyBenRequest(text)).toEqual({ source: 'words', kinds: [kind] });
  });

  // 11 Oct, coach tools: removing or reordering exercises in the plan opens the structural tool only with a future scope.
  it.each([
    ['Drop the triceps pushdown next time', ['structural']],
    ['Drop the triceps pushdown next time and do laterals first', ['structural']],
    ['Do laterals first next time', ['structural']],
    ['can you remove lateral raises from my routine?', ['structural']],
    ['Move squats to the end from now on', ['structural']],
    ['Reorder push day', ['structural']],
    ['drop bench to 95', ['change']],
    ['drop bench by 5 next time', ['change']],
    ['Drop the weight next time', ['change']],
    ['drop the pushdown', ['change']],
    ["don't drop bench next time", null],
    ['should I drop bench next time?', null],
    ['I dropped the pushdown last time', null],
    ['I do squats first', null],
    ['Do squats first?', null],
  ] as const)('remove/reorder: %s', (text, kinds) => {
    expect(classifyBenRequest(text)).toEqual(kinds === null ? null : { source: 'words', kinds: [...kinds] });
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
    // Review r4 B1: difficulty that is negated, a question, conditional or not about a set.
    "It wasn't too heavy",
    'Not too heavy',
    'Never too easy',
    'Set 3 was too heavy?',
    'If set 3 is too heavy what then?',
    'Way too early for this',
    'Way too many people here',
    'That rest was way too long',
    'Too hard to say',
    'Too easy to forget my belt',
    'Too light in here, the sun',
    "Couldn't get a bench, all taken",
    'Failed the drug test lol',
    // Review r4 B1: a strong verb used as a noun, or with an object that isn't training.
    'Deload week starting Monday',
    'Lower body day tomorrow',
    'Increase in pain on set 3',
    'Update on my shoulder, feels fine',
    'Scale reckons 80 kg',
    'Change the music',
    'Cut the chatter',
    'Ease up on the chat',
    'Skip the small talk',
    'Change your tone',
    'Cut sugar this week',
    'Adjust the timer to 3 min',
    'Change my bodyweight to 82',
    'Delete that last message',
    'Drop the voice, text only',
    'Remove the coach note please',
    'Raise your game coach lol',
    // Review r4 B1: swaps with no exercise.
    'Switch to dark mode',
    'Swap the music',
    'Replace the battery in my watch',
    'Switch gyms, I am at the hotel',
    // Review r4 nit: a closing retraction takes the request back.
    'Can you lower it? Actually no, leave it.',
    'Drop sets 3 and 4 to 95. Never mind.',
    // Review r4 S2: reminders aren't memories.
    'Remember to bring chalk',
    "Don't forget to stretch",
    'Remember my belt next time',
    // Adversarial (r4): more negations, questions, conditionals and other subjects.
    'It was not too heavy at all',
    'Too heavy? Nah it was fine',
    'Was that too heavy?',
    'Is it too heavy?',
    'Never too much',
    'Hardly too heavy',
    'Not too heavy, not too light',
    'It would be too heavy',
    'Might be too heavy',
    'Too heavy? I doubt it',
    'When it is too heavy I drop it',
    "If it's too easy, add weight",
    'Too much traffic today',
    'Too tired to talk',
    'Too hot in here',
    'Way too loud in here',
    'The music is way too loud',
    'Too much chat',
    'That was too much talking',
    'Too heavy for a Monday',
    "Didn't get much sleep",
    "Couldn't find the chalk",
    'Missed the bus',
    'Failed my exam',
    "Couldn't get a parking spot",
    "Bench was taken, couldn't do it",
    'My mate failed his set lol',
    'Missed the start of the podcast',
    "Change of plan, I'm leaving early",
    'Drop off the kids first',
    'Drop me a text later',
    'Add me on Strava',
    'Switch off the voice',
    'Swap phones',
    'Swap sides',
    'Replace my headphones',
    'Cut it out',
    'Knock it off',
    'Scrap that',
    'Scrap that idea',
    'Lower your voice',
    'Lower the lights',
    'Raise the volume',
    'Raise the bar lol',
    'Increase the font size',
    'Update the app',
    'Skip the intro',
    'Skip this song',
    'Add some music',
    'Up the tempo of the music',
    'Cut to the chase',
    'Cut the rest timer to 2 min',
    'Ditch the small talk',
    'One more set to go',
    'Another set done',
    'Lighter',
    'Too heavy?',
    // A bare "one more set" is usually a countdown; "One more set please" is a request.
    'One more set',
    'Bench was too heavy last week, should I go lower?',
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

describe('review r5 B3: remarks, other days, cues and retractions open nothing (rule 3)', () => {
  it.each([
    // The review's rows.
    'Missed a rep on Tuesday, today was fine',
    "Couldn't do the last rep last week but today flew up",
    'That was brutal, the traffic',
    'Drop set on the last one was fun',
    'Extra set of eyes would help',
    'Lower the weight under control',
    'Remove the bar from the rack first',
    'Increase the rest to 3 minutes',
    'Add 30s rest',
    'Add weight next time if it moves well',
    'I want it lighter but leave it',
    'Lower it. Hmm actually leave it as it was',
    'Lower it. Never mind, keep it',
    "Lower it. Don't",
    // Developer's adversarial rows.
    'Failed that rep yesterday',
    'Missed reps last session but fine now',
    'Last week, missed two reps',
    'Too heavy on Monday',
    'Had loads in the tank yesterday',
    'Felt like a warmup last week',
    'RPE 10 last week',
    'Was that RPE 10?',
    'RPE 10 means failure',
    'That was brutal, the weather',
    'That was a grind, the whole day',
    'Drop sets are brutal',
    'Supersets are fun',
    'Lower it to your chest',
    'Lower slowly on the way down',
    'Lower it slowly',
    'Raise it until lockout',
    'Drop the bar on the floor',
    'Put the bar back on the rack',
    'Raise the bench a notch',
    'Lower the seat',
    'Add a minute of rest',
    'Increase rest between sets to 2 min',
    'Drop the timer to 90 seconds',
    'More rest please',
    'Unless it feels bad, add 5 kg',
    'Bump it up if the bar speed is good',
    'Add weight next time unless I say otherwise',
    "Drop it. No wait, don't",
    'Lower sets 3 and 4. Actually, no.',
    'Lower it, actually no',
    'Can you lower it? Nah leave it',
    "Lower it. Don't bother",
    'I want more weight. Actually forget it',
    'Take a plate off. Nah, leave it',
    'Barely got the bus',
    'Almost failed my driving test',
    'Could have done more cardio',
    'Kill the music',
    'Lose the attitude',
    'Get rid of the timer',
    'Back off mate',
    'Push me a message',
    '8 reps last time',
    'Throw the towel on the bench',
    'Load the dishwasher',
    'Increase the volume to 10',
    'Can we not talk about it',
  ])('null: %s', (text) => {
    expect(classifyBenRequest(text)).toBeNull();
  });

  it('a new request after a retraction still counts', () => {
    expect(classifyBenRequest('Lower it. Actually no, raise it')).toEqual({ source: 'words', kinds: ['change'] });
    expect(classifyBenRequest('Lower it. Actually no, drop it to 90')).toEqual({ source: 'words', kinds: ['change'] });
    expect(classifyBenRequest('Lower it, keep it at 8 reps')).toEqual({ source: 'words', kinds: ['change'] });
  });

  it('a polite "if that\'s OK" is not a condition', () => {
    expect(classifyBenRequest("Drop the last set if that's ok")).toEqual({ source: 'words', kinds: ['change'] });
    expect(classifyBenRequest("Drop it to 95, if that's ok")).toEqual({ source: 'words', kinds: ['change'] });
  });
});

describe('review r5 S1: clear requests and the rule 3 signals in words', () => {
  it.each([
    ['Strip a plate', 'change'],
    ['Pull a plate off', 'change'],
    ['Take a plate off each side', 'change'],
    ['Throw another 5 on', 'change'],
    ['Stick 2.5 on each side', 'change'],
    ['Pop another 2.5 on each side', 'change'],
    ['Load it up to 100', 'change'],
    ['Back it off a bit', 'change'],
    ['Back off to 90', 'change'],
    ['Dial it back', 'change'],
    ['Tone it down', 'change'],
    ['Kill the last set', 'change'],
    ['Lose the last set', 'change'],
    ['Get rid of set 4', 'change'],
    ['Nix set 4', 'change'],
    ['Ditch the last set', 'change'],
    ['Can we not do set 4', 'change'],
    ['8 reps instead', 'change'],
    ['Push me harder', 'change'],
    ['Do dumbbells instead', 'structural'],
    ['Hold bench where it is', 'hold'],
    ['Same weight next time', 'hold'],
    ['Same weight again next time', 'hold'],
    ["Don't increase it next time", 'hold'],
    ["Don't progress squat next session", 'hold'],
    ['No increase next time', 'hold'],
    ['Keep bench at 100 next time', 'hold'],
    ['Stop progressing bench', 'hold'],
    ['Rule: no deadlifts after squats', 'playbook'],
    ['Rule: deload every 6 weeks', 'playbook'],
    ['Remember, I hate lunges', 'memory'],
    ['Remember, my knee is dodgy', 'memory'],
    ['RPE 10', 'difficulty'],
    ['That was RPE 10', 'difficulty'],
    ['Set 3 was RPE 10', 'difficulty'],
    ['That last set was RPE 9.5', 'difficulty'],
    ['0 RIR', 'difficulty'],
    ['Barely got the last rep', 'difficulty'],
    ['Only just got it', 'difficulty'],
    ['Almost failed', 'difficulty'],
    ['Nearly failed the last rep', 'difficulty'],
    ['Had 5 more in the tank', 'difficulty'],
    ['Easily had 3 more in the tank', 'difficulty'],
    ['Could have done 5 more', 'difficulty'],
    ['Felt like a warmup', 'difficulty'],
    ['Lower the bench to 90', 'change'],
    ['Raise bench to 102.5', 'change'],
  ] as const)('%s → %s', (text, kind) => {
    const r = classifyBenRequest(text);
    expect(r?.source === 'words' ? r.kinds : null).toContain(kind);
  });

  it('a hold opens no tool by itself (next-session targets are written only in the summary turn)', () => {
    expect(classifyBenRequest('Same weight next time')).toEqual({ source: 'words', kinds: ['hold'] });
  });
});

describe('asksForMoreSets (D1; review S7)', () => {
  it.each(['Can I have more sets next time?', 'Add a set to bench', 'I want extra volume on rows', 'Give me another set', 'Legs felt fine, more sets please', 'Could you add a set to bench next time?', 'Bench felt easy. Can we do more sets?', 'More sets please?'])('an ask: %s', (t) => {
    expect(asksForMoreSets(t)).toBe(true);
  });
  it.each(['I don’t want any more sets', 'no extra sets please', 'Not another set, I’m done', 'Never add a set to squats', 'That was enough volume', 'too many sets today', 'No more sets on bench', 'Should I do more sets?', 'Would more sets help?', 'Do I need extra volume for legs?', 'Bench felt easy. Is another set worth it?'])('not an ask: %s', (t) => {
    expect(asksForMoreSets(t)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { checkReplyClaims, isChangeClaim } from '../src/claims';
import { benchAdjust, id, kg, lb, ledger, record, tgt } from './records';

/**
 * Coach-contract check 14: the claim-check corpus. Every sentence that claims
 * a finished change must be hidden when nothing was saved (100% recall; a
 * false keep fails the build). Suggestions, questions and facts should be
 * kept; any that are hidden count towards the false-hide rate, which is
 * reported (not hidden) and held under a ceiling.
 */

/** Claims of a finished (or promised) change. British, American and spoken-style. */
const CLAIMS: readonly string[] = [
  'Done, I’ve lowered sets 3–4 to 95 kg.',
  'I’ve dropped the weight for your last two sets.',
  'I lowered sets 3 and 4 to 95 kg.',
  'Sets 3–4 are now 95 kg × 8.',
  'Set 4 has been removed.',
  'All set — your remaining sets are lighter.',
  'Done.',
  'I’ve updated your plan for next time.',
  'Next session will be 97.5 kg for 6–8.',
  'Logged it: 100 kg × 8.',
  'I’ve swapped cable fly for pec deck.',
  'Your next Push A now has pec deck instead of cable fly.',
  'I’ve flagged your shoulder.',
  'Pain flag is on for overhead press.',
  'I’ll remember that you train before work.',
  'Noted.',
  'Saved to memory.',
  'I’ve forgotten that you don’t like lunges.',
  'I’ve added that rule to your playbook.',
  'I’ve undone the change to sets 3–4.',
  'OK, knocked 5 kg off the last two sets.',
  'Right, that’s sorted — 95 for the rest.',
  'Your sets have been adjusted.',
  'I went ahead and cut set 4.',
  'I’m lowering the weight to 95 now.',
  'I’ll drop sets 3 and 4 to 95.',
  'Let me take 5 kg off the last two.',
  'Bumped you up to 102.5 for the next one.',
  'Took it down to 92.5 kg.',
  'So I’ve gone and dropped it to ninety-five kilos.',
  'I have reduced the load on the remaining sets.',
  'Changes applied.',
  'You’re all set for 97.5 next time.',
  'The weight’s been lowered to 95.',
  'From now on bench is 97.5 kg.',
  'Your new target is 95 kg × 8.',
  'I’ve put you down for 95 kg on the last set.',
  'Your workout’s been updated.',
  'Everything’s updated.',
  'Great — dropped the last set.',
  'I’ve made sets three and four a bit lighter.',
  'Dialled it back to 90 for you.',
  'We’ve added a fifth set at 90 kg.',
  'I’ve rescheduled your session to Thursday.',
  'Set 3’s now 95.',
  'Consider it done.',
  'Okay, I’ve switched you to the 22.5s.',
  'I’ve cleared your shoulder flag.',
  'Your remaining sets were changed to 95 kg.',
  'That’s locked in for next Push A.',
  'Taken care of.',
  'I’ve deleted yesterday’s workout.',
  'Sets 3 and 4 will be 95 kg.',
  'You’ll do 95 for the last two.',
  'Sorted, 95 kg it is.',
  'I went ahead and lowered your weight to 205 pounds.',
  'Got it, I bumped your sets down 10 pounds.',
  'okay so I’ve taken it down to ninety seven and a half',
  'I have now logged that set.',
  'Your plan’s been updated so next week is lighter.',
  'Overhead press is flagged now.',
  'Set 2 was RPE 10, so I’ve lowered sets 3–4 to 95 kg.',
  'I’ve lowered sets 3–4 and dropped set 4.',
  'I’ll go ahead and lower the rest to 95.',
  'I’ve taken the incline press out of next week.',
  'Your last two sets are 95 kg now.',
  'Sets 3 and 4: 95 kg.',
  'There you go — 95 for the rest.',
  'Your weights have come down to 95.',
  'Made the change.',
  'Change made.',
  'Sets 3–4 now 95 kg.',
  'OK, the last two sets are lighter.',
  'Plan’s changed.',
  'Applied.',
  'Gone with 95 for the rest.',
  'Dropping you to 95 for the rest.',
  'Your next session has 97.5 on bench.',
  'Bench is at 97.5 next time.',
  'Okey dokey, adjusted.',
  'Yep, did that.',
  'I lowered it last week and again today.',
  // Present-tense state statements about a target (review B1, coach-contract CC3).
  'Bench is down to 95.',
  'Squat goes to 120 kg next time.',
  'Pec deck replaces cable fly next time.',
  'Cable fly is out, pec deck is in.',
  'All changed.',
  'Sets 3 and 4 are 95 kg.',
  'You’re on 95 kg for the last two sets.',
  'Bench is 95 for the rest.',
  'The last two sets are at 95 kg.',
  'Squat’s at 120 next time.',
  'Your weight for sets 3 and 4 is 95 kg.',
  'Pec deck is in for cable fly next time.',
  'Bench goes up to 102.5 next week.',
  'Set 4 is gone.',
  'Your remaining sets are 95 kg × 8.',
  'Incline press is out of next week’s session.',
  'All updated.',
  'Everything’s changed.',
  'Pec deck takes over from cable fly.',
  // Review r2 B1: forms the r1 fix still kept with nothing saved.
  'Bench is down to 95 and not 100.',
  'Sets 3 and 4 are now 95 kg not 100.',
  'Sets 3 and 4 are now 95 kg, not 100.',
  'Sets 3 and 4 should now show 95 kg.',
  'You should now see 95 kg on sets 3 and 4.',
  'Sets 3 and 4 will now show 95 kg.',
  'Your screen should now read 95 kg.',
  'Bench now sits at 95.',
  'Bench is sitting at 95 for the rest.',
  'The rest of your sets read 95 kg.',
  'Your app shows 95 for sets 3 and 4.',
  'You are doing 95 for the rest.',
  'You’re doing 95 for the last two.',
  'You’re lifting 95 kg from here.',
  'Bench: 95 kg for sets 3 and 4.',
  '95 kg for sets 3 and 4 from here.',
  '95 for the rest, not 100.',
  'Squat: 120 kg next time.',
  'Pec deck in, cable fly out.',
  'No more cable fly, pec deck from next time.',
  'Cable fly out, pec deck in.',
  'Got that in memory.',
  'I won’t forget that.',
  'I will not forget that.',
  'That’s in your memory now.',
  'Memorised.',
  'It’s 95 for the rest now, not 100.',
  'Not 100 any more: 95 for the last two.',
  // The value-statement backstop: phrasings no verb list names (review r2 B1, structural rule).
  'The app has 95 for sets 3 and 4.',
  'Sets 3 and 4 have 95 on them now.',
  'You have 95 kg for the rest.',
  'You’ve got 95 for the last two.',
  'That leaves you at 95 for the rest.',
  'Last two sets at 95 kg.',
  'Bench, 95 kg, sets 3 and 4.',
  'Down to 95 for the rest.',
  'Up to 102.5 next time.',
  'Sticking with 95 for the rest.',
  'That makes it 95 for the rest.',
  'Pec deck instead of cable fly from next time.',
  'Pec deck it is.',
  'I’ve got that down.',
  'You’ll see 95 on the card.',
  'Your sets are now lighter, not heavier.',
  'Bench isn’t 100 any more, it’s 95.',
  'Sets 3 & 4 → 95 kg.',
  // Review r3 B3: forms the r2 backstop still kept with nothing saved.
  'Expect sets 3 and 4 at 95 kg.',
  'Expect 95 kg on your card for sets 3 and 4.',
  'Use 95 from here, it’s on your card.',
  'Given last week, you have 95 kg for the rest.',
  'Sets 3 and 4 have 95 kg rather than the 100 you did.',
  'You’ll be on 95 for the rest which may feel light.',
  'Push A now opens with squat.',
  'Squat first next time.',
  'Next Push A: pec deck, not cable fly.',
  'Pec deck’s taking cable fly’s spot next time.',
  'Binned set 4.',
  'Chopped set 4.',
  'Set 4 is history.',
  'Overhead press won’t progress until your shoulder settles.',
  'Overhead press is on hold while your shoulder settles.',
  'I’ve wiped that memory.',
  'Consider it noted.',
  'I’ll bear that in mind.',
  'Will do.',
  'On it.',
  '95 for the rest, yeah?',
  'Remember: 95 for the rest.',
  // Adversarial additions (r3 fixes): the same ideas in other words.
  'Expect 95 on the bar for the rest.',
  'Expect 95 kg next time.',
  'Heads up: sets 3 and 4 are 95 now.',
  'Lunges are off the menu next time.',
  'Swapped.',
  'Switched it.',
  'Deadlift goes first next session.',
  'Next time starts with squat.',
  'Your next Push A kicks off with squat.',
  'Squat’s first next time.',
  'Pec deck slots in where cable fly was.',
  'Pec deck takes cable fly’s place.',
  'Push B: rows, not pulldowns.',
  'Your overhead press is paused for now.',
  'No more increases on overhead press until the shoulder settles.',
  'Overhead press won’t go up while your shoulder’s sore.',
  'I’ve parked overhead press for now.',
  'Shoulder’s flagged.',
  'I’ve scrubbed that note.',
  'Memory wiped.',
  'Duly noted.',
  'Noted, I’ll keep it in mind.',
  'Sets 3 and 4 have 95 kg on them, which should feel lighter.',
  'Sets 3 and 4 have 95 kg instead of 100.',
  'You have 95 kg for the rest as you asked.',
  'You’re at 95 for the rest, same as last week.',
  'Bench drops to 95 for the rest.',
  'Bench is 95 for the rest, yeah?',
  '95 kg for the rest, right?',
  'Set 4’s gone.',
  'Removed.',
  'Lunges are binned.',
  'That’s on the card now.',
  'It’s in the app.',
  'Everything’s on your screen.',
  'All good, 95 for the rest.',
  'Ninety-five for the rest.',
  'The last two are ninety five.',
  'Will do, 95 for the rest.',
  'Leave it with me.',
  'Can do.',
  'You got it.',
  'Copy that.',
  // Review r4 B3: load with no number.
  'Lighter for the last two.',
  'Bench lighter for the rest.',
  'Your last two are a touch lighter.',
  'Easier sets from here.',
  'Easier from here on.',
  'Bench goes up a notch next time.',
  // Undo.
  'Back to 100.',
  'Rolled back.',
  'Reversed.',
  'Back how it was.',
  // Sets.
  'Extra set on the end for you.',
  'One more set of curls on the card.',
  'Last set scratched.',
  'No set 4 today.',
  'Two sets left at 95.',
  'Last two: 95.',
  'Last set is an AMRAP.',
  'Bench gets a fourth set next time.',
  // Structural (CC10).
  'Pec deck next time.',
  'Next time: pec deck.',
  'Your next Push A has pec deck instead of cable fly.',
  'Pec deck takes over next time.',
  'Pec deck replacing cable fly.',
  'Pec deck goes where cable fly was.',
  'Squats lead next time.',
  'Squat kicks off next session.',
  'Cable fly retired.',
  'Cable fly gets a rest next week.',
  // Progression holds.
  'OHP’s on ice for now.',
  'Overhead press is off the table for now.',
  'Leaving overhead press alone for now.',
  'I won’t push overhead press for now.',
  'No more overhead pressing till the shoulder settles.',
  'Overhead press stays at 50 until your shoulder settles.',
  // Memory.
  'I’ve let that go.',
  'Gone from memory.',
  // Generic.
  'Boom done.',
  'Handled.',
  'Squared away.',
  'Say no more.',
  'Your plan now reflects that.',
  // Adversarial (r4): the same ideas in other words.
  'Heavier from here on.',
  'A notch lighter for the rest.',
  'Squat’s back to 120.',
  'Everything’s back how it was.',
  'Bonus set for you on bench.',
  'No set 3 or 4 today.',
  'Next session: pec deck.',
  'Pec deck subbing for cable fly next time.',
  'Deadlift leads next session.',
  'RDL’s on ice till your back settles.',
  'Done and done.',
  'Job done.',
  'Your card now reflects the change.',
  'That change is live.',
  'All fixed up.',
  'No fourth set today.',
  'Squat now leads Push A.',
  'Your shoulder’s on my list.',
  'I’ll keep OHP light until it settles.',
  'Holding off on OHP.',
  'OHP stays put while your shoulder settles.',
  'Back where we started.',
  'Rewound that.',
  'Put it back how it was.',
  'Down a plate for the rest.',
  'One plate less on the last two.',
  'Easy does it from here: 95.',
  'Your remaining bench sets went down.',
  'Ok, 95.',
  'Knocked it back to 95.',
  'Sets 3 and 4 trimmed to 95.',
  'You’re lighter for the last two now.',
  'The last two come down to 95.',
  'Swapped in pec deck.',
  'Pec deck’s in for next time.',
  'Curls are gone next week.',
  'Set 4’s off the card.',
  'Reverted to 100.',
  'Playbook updated.',
  'Memory updated.',
  'Next time you’ll have 4 sets of bench.',
  'Down a plate for the rest of today.',
];

/** Suggestions, questions and facts. Keeping them is right; hiding them is a (reported) false hide. */
const NOT_CLAIMS: readonly string[] = [
  'Want me to drop the weight?',
  'I’d go 95 next time.',
  'Next time, try 97.5.',
  'Set 2 was RPE 10.',
  'That looked hard.',
  'Should I lower sets 3–4 to 95?',
  'You could drop to 95 kg if the bar slows down.',
  'I’d suggest keeping 100 kg for set 3.',
  'How about 95 for the last two?',
  'If set 3 feels like a grind, take 5 kg off.',
  'Your form looked solid on set 1.',
  'Rest a full three minutes before set 3.',
  'Nothing has changed yet.',
  'I haven’t changed anything.',
  'You logged 100 kg × 8 at RPE 10.',
  'Last week you lifted 97.5 kg for 8.',
  'Keep the bar path over mid-foot.',
  'That’s a solid session.',
  'Do you want me to lower the weight for the remaining sets?',
  'I can lower sets 3–4 if you like.',
  'Maybe drop to 95 if set 3 is another grind.',
  'Aim for 8 reps with one in reserve.',
  'You hit every rep today.',
  'Pain is a signal to stop; please see a physio if it continues.',
  'I can’t clear pain flags.',
  'Lower the bar under control.',
  'Drop the weight if your form breaks.',
  'Next time, aim for 97.5 kg × 6–8.',
  'Would you like a lighter session today?',
  'Your estimated 1RM is about 125 kg (an estimate).',
  'It might be worth adding a set next time.',
  'You’ve been consistent this month.',
  'Want me to adjust the remaining sets?',
  'I’d rather you stop the set than grind out a bad rep.',
  'Shall I take 5 kg off?',
  'You dropped the weight yourself last week, which was sensible.',
  'Your squat has increased by 10 kg since August.',
  'Bench went up 5 kg over the last month.',
  'You’ve added 10 kg to your squat since August.',
  'Your RPE dropped from 9 to 8 across the sets.',
  'Bar speed slowed on set 3, which is normal near failure.',
  'That was your best set of the day.',
  'Rest is set to 3 minutes.',
  'The plan was 100 kg × 6–8.',
  // Near-misses for the present-tense rule (B1): facts, not targets.
  'The bar is 20 kg.',
  'Your best set is 100 kg × 8.',
  'Bench is your strongest lift.',
  'Set 3 is next.',
  'Is bench down to 95 on your sheet?',
  'If bench is down to 95, the bar should move faster.',
  // Review r2 B1 near-misses: negations, questions and advice the wider rules must still keep.
  'Are you doing 95 for the rest?',
  'You should see progress in a few weeks.',
  'Your best on bench is 100 kg, not 105.',
  'I won’t change anything unless you ask.',
  'Nothing is different yet.',
  'No more than 3 sets of this one, ideally.',
  'Count me in.',
  'Should 95 feel easier, we can talk about going up.',
  'Your log shows 100 kg × 8 last week.',
  'I can’t see any pain flags.',
  'Want 95 for sets 3 and 4?',
  'Sets 3 and 4 are still 100 kg.',
  'Aim for 95 kg on the last two.',
  'Set 2 was 100 kg × 8.',
  'You hit 100 kg for 8 on set 2.',
  'Rest 3 minutes before the last two.',
  'The 20 kg bar plus a 20 on each side makes 60 kg.',
  'If set 3 slows down, 95 kg for the last two is fine.',
  'Your target for set 3 stays at 100 kg.',
  'You managed 100 kg for all 4 sets.',
  'The last two sets are where the work happens.',
  'Most people use 2.5 kg jumps.',
  'Your dumbbells go up in 2 kg steps.',
  'The machine maxes out at 100 kg.',
  // Review r3 B3 near-misses: advice, questions and history the narrower vetoes must still keep.
  'Expect the last reps to feel slow.',
  'Bear in mind the bar is 20 kg.',
  'Is overhead press on hold?',
  'Should overhead press go on hold?',
  'If your shoulder hurts, overhead press won’t progress.',
  'Do you want squat first next time?',
  'Want squat first next time?',
  'I’d put squat first next time.',
  'You can see 95 for sets 3 and 4 if you tap the card.',
  'Rather than 100, I’d go 95 for the rest.',
  'See how set 3 feels first.',
  'Plan to rest 3 minutes.',
  'Remember to brace before each rep.',
  'Thanks!',
  'No problem.',
  'Got it, here’s why.',
  'Cue: chest up, not out.',
  'Tip: slow down, not up.',
  // Review r4 B3 near-misses: the new forms must still keep advice, questions, feelings and history.
  'Go lighter for the last two.',
  'Lighter for the last two might help.',
  'Want it lighter for the last two?',
  'The last two felt easier.',
  'Set 3 was lighter than set 2.',
  'Back to 100 next week if it moves well.',
  'You can undo it from the card.',
  'Pec deck next time?',
  'Maybe pec deck next time.',
  'Try pec deck next time.',
  'An extra set might help.',
  'Your fourth set was strong.',
  'No set 4 today?',
  'Don’t push overhead press for now.',
  'If your shoulder hurts, leave overhead press alone.',
  'That’s off the table unless you ask.',
  'Your plan reflects your goal.',
  'Handled well, that set.',
  'All good.',
  'Let it go, the next set is what counts.',
  'Easier said than done.',
  'Heavier next time if this moves well.',
  'Next time: focus on bar speed.',
  'A bonus set is optional.',
  'Three sessions in a row, nice work.',
  'Nice work on the rows today.',
  'Last time you went a notch heavier.',
  'It will feel easier from here.',
  'Rest: 3 minutes.',
  'Last week, 92.5.',
  'Your squat went up 10 kg since August.',
  'You went up a plate last week.',
  'Keep your elbows tucked until lockout.',
  'Hold off on the coffee before bed.',
  'Your knee stays put over your foot.',
  'I’ll keep it simple.',
  'Fixed weights are fine too.',
  'Squats now? Sure, after bench.',
  'Squat felt fast today, nice.',
  'Last week you did 100 for 8, so 95 is conservative.',
  'The 95 you did last week moved well.',
  'You did 95 last time, which was smart.',
  // Known false hides (reported): explaining today's plan reads like a stated target.
  'Set 3 is at 100 because you hit 8 reps last week.',
  'Sets 3 and 4 are planned at 100 kg.',
];

const EMPTY = ledger([]);

describe('claim-check corpus (coach-contract check 14)', () => {
  it('has at least 60 sentences', () => {
    expect(CLAIMS.length + NOT_CLAIMS.length).toBeGreaterThanOrEqual(60);
    expect(CLAIMS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(CLAIMS)('hides with nothing saved: %s', (sentence) => {
    const r = checkReplyClaims(sentence, EMPTY);
    expect(r.keep).toBe(false);
  });

  it('100% recall over the claim corpus; false-hide rate reported and under 15%', () => {
    const falseKeeps = CLAIMS.filter((s) => checkReplyClaims(s, EMPTY).keep);
    expect(falseKeeps).toEqual([]);
    const falseHides = NOT_CLAIMS.filter((s) => !checkReplyClaims(s, EMPTY).keep);
    const rate = falseHides.length / NOT_CLAIMS.length;
    // Reported for the PM (contract check 14): which harmless sentences the check hides.
    console.info(`claim check: recall 100% (${String(CLAIMS.length)} claims); false hides ${String(falseHides.length)}/${String(NOT_CLAIMS.length)} (${(rate * 100).toFixed(1)}%)`, falseHides);
    expect(rate).toBeLessThan(0.15);
  });

  it('the named suggestions are kept (contract check 14 examples)', () => {
    for (const s of ['Want me to drop the weight?', 'I’d go 95 next time', 'Next time, try 97.5']) {
      expect(checkReplyClaims(s, EMPTY)).toEqual({ keep: true, claim: false, matchedActionIds: [] });
      expect(isChangeClaim(s)).toBe(false);
    }
  });
});

describe('claims against a ledger', () => {
  it('keeps a claim that matches a committed action', () => {
    const a = benchAdjust();
    expect(checkReplyClaims('Done, I’ve lowered sets 3–4 to 95 kg.', ledger([a]))).toEqual({ keep: true, claim: true, matchedActionIds: [a.actionId] });
    expect(checkReplyClaims('Set 2 was RPE 10, so I’ve lowered sets 3–4 to 95 kg × 8.', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('I’ve dropped sets three and four to ninety five kilos', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Done.', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Lowered bench press for the last two.', ledger([a])).keep).toBe(true);
  });

  it('a different number replaces the sentence with the saved line (CC4, check 3)', () => {
    const a = benchAdjust({}, tgt(kg(97.5), 8));
    const r = checkReplyClaims('I’ve lowered sets 3–4 to 98 kg.', ledger([a]));
    expect(r).toEqual({ keep: false, reason: 'numbers_differ', detail: 'The saved load is 97.5 kg; the reply said 98 kg.', replaceWith: a.actionId });
    expect(checkReplyClaims('I’ve lowered sets 3–4 by 5%.', ledger([a]))).toMatchObject({ reason: 'numbers_differ' });
  });

  it('a claim about something else is hidden as a mismatch', () => {
    const a = benchAdjust();
    expect(checkReplyClaims('I’ve lowered sets 3–4 and dropped set 4.', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch', detail: 'It said a set was removed; none was.' });
    expect(checkReplyClaims('I’ve lowered set 5 as well.', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch', detail: 'It named set 5; only sets 3–4 changed.' });
    expect(checkReplyClaims('I’ve lowered overhead press too.', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    expect(checkReplyClaims('I’ve logged set 2.', ledger([a]))).toMatchObject({ keep: false, reason: 'no_action' });
  });

  it('a proposal, a stale result or an undone change never backs a claim', () => {
    const proposal = record(
      { kind: 'propose_next_workout_change', sourceSessionId: id(1), workoutLabel: 'Push A', changes: [{ change: 'swap', text: 'Cable fly → Pec deck' }], because: 'you asked for some variety.' },
      { status: 'proposed' },
    );
    expect(checkReplyClaims('I’ve swapped cable fly for pec deck.', ledger([proposal]))).toMatchObject({ keep: false, reason: 'not_committed', detail: "That change was only suggested; it isn't applied." });
    expect(checkReplyClaims('Done.', ledger([proposal]))).toMatchObject({ keep: false, reason: 'not_committed' });

    const stale = benchAdjust({ status: 'stale', failure: null });
    expect(checkReplyClaims('Changed sets 3–4.', ledger([stale]))).toMatchObject({ keep: false, reason: 'not_committed', detail: "That change didn't go through." });

    const undone = benchAdjust({ undoneBy: { actionId: id(900), atUtc: '2026-10-10T17:24:00.000Z' } });
    expect(checkReplyClaims('I lowered sets 3–4 to 95 kg.', ledger([undone]))).toMatchObject({ keep: false, reason: 'not_committed', detail: 'That change was undone.' });
  });

  it('a swap claim is never backed by a set change (CC10)', () => {
    expect(checkReplyClaims('I’ve swapped cable fly for pec deck.', ledger([benchAdjust()])).keep).toBe(false);
    expect(checkReplyClaims('Pec deck replaces cable fly next time.', ledger([benchAdjust()])).keep).toBe(false);
    expect(checkReplyClaims('Cable fly is out, pec deck is in.', ledger([benchAdjust()])).keep).toBe(false);
  });

  it('present-tense target statements are claims, backed only by a matching saved change (B1)', () => {
    const a = benchAdjust();
    expect(checkReplyClaims('Bench is down to 95.', ledger([a]))).toEqual({ keep: true, claim: true, matchedActionIds: [a.actionId] });
    expect(checkReplyClaims('Sets 3 and 4 are 95 kg.', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Sets 3 and 4 are 92.5 kg.', ledger([a]))).toMatchObject({ keep: false, reason: 'numbers_differ' });
    expect(checkReplyClaims('Squat goes to 120 kg next time.', ledger([a])).keep).toBe(false);
    expect(checkReplyClaims('All changed.', ledger([a])).keep).toBe(true);
    const stale = benchAdjust({ status: 'stale', failure: null });
    expect(checkReplyClaims('Bench is down to 95.', ledger([stale]))).toMatchObject({ keep: false, reason: 'not_committed' });
  });

  it('a generic name word still names its exercise (review r2 B1)', () => {
    const a = benchAdjust();
    expect(checkReplyClaims('Incline is 95 for the rest.', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    expect(checkReplyClaims('Bench is back to 95 for the rest.', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Sets 3 and 4 are now 95 kg, not 100.', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Bench: 95 kg for sets 3 and 4.', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Overhead: 95 kg for sets 3 and 4.', ledger([a])).keep).toBe(false);
  });

  it('a plural or generic exercise word claims every exercise it could mean (review r3 B3)', () => {
    const a = benchAdjust();
    expect(checkReplyClaims('Dumbbells are 95 for the rest', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    expect(checkReplyClaims('Flyes are 95 for the rest', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    expect(checkReplyClaims('Your presses are 95 for the rest', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    expect(checkReplyClaims('DBs are 95 for the rest', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    expect(checkReplyClaims('Bench and flyes are 95 for the rest', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    expect(checkReplyClaims('Rows are 95 for the rest', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    // Naming the changed exercise still matches, plural or not.
    expect(checkReplyClaims('Bench presses are 95 for the rest', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Bench is 95 for the rest', ledger([a])).keep).toBe(true);
  });

  it('the new claim forms match their own kinds (review r3 B3)', () => {
    const pain = record({ kind: 'set_pain_flag', flagIds: [id(50)], exerciseNames: ['Overhead press'], area: 'shoulder' });
    expect(checkReplyClaims('Overhead press is on hold while your shoulder settles.', ledger([pain])).keep).toBe(true);
    expect(checkReplyClaims('Overhead press is on hold while your shoulder settles.', ledger([benchAdjust()])).keep).toBe(false);
    expect(checkReplyClaims('Bench press is on hold while your shoulder settles.', ledger([pain])).keep).toBe(false);
    const forget = record({ kind: 'forget_memory', memoryId: id(61), text: 'Hates lunges' });
    expect(checkReplyClaims('I’ve wiped that memory.', ledger([forget])).keep).toBe(true);
    expect(checkReplyClaims('I’ve wiped that memory.', ledger([benchAdjust()])).keep).toBe(false);
    const memory = record({ kind: 'save_memory', memoryId: id(60), text: 'Trains before work' });
    expect(checkReplyClaims('I’ll bear that in mind.', ledger([memory])).keep).toBe(true);
    expect(checkReplyClaims('Consider it noted.', ledger([memory])).keep).toBe(true);
    expect(checkReplyClaims('Will do.', ledger([memory])).keep).toBe(true);
    const swap = record({ kind: 'propose_next_workout_change', sourceSessionId: id(1), workoutLabel: 'Push A', changes: [{ change: 'swap', text: 'Cable fly → Pec deck' }], because: 'you asked for some variety.' });
    expect(checkReplyClaims('Next Push A: pec deck, not cable fly.', ledger([benchAdjust()])).keep).toBe(false);
    expect(checkReplyClaims('Squat first next time.', ledger([benchAdjust()])).keep).toBe(false);
    // Like "I've swapped cable fly for pec deck", a structural line names exercises a proposal record doesn't carry: hidden.
    expect(checkReplyClaims('Next Push A: pec deck, not cable fly.', ledger([swap]))).toEqual(checkReplyClaims('I’ve swapped cable fly for pec deck.', ledger([swap])));
    // A stale adjustment never backs "Expect …" (the r3 failure scenario).
    expect(checkReplyClaims('Expect sets 3 and 4 at 95 kg.', ledger([benchAdjust({ status: 'stale', failure: null })]))).toMatchObject({ keep: false, reason: 'not_committed' });
    expect(checkReplyClaims('Expect sets 3 and 4 at 95 kg.', ledger([benchAdjust()])).keep).toBe(true);
  });

  it('the r4 forms are kept when the matching change was saved (review r4 B3)', () => {
    const a = benchAdjust();
    expect(checkReplyClaims('Lighter for the last two.', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Bench lighter for the rest.', ledger([a])).keep).toBe(true);
    const undo = record({
      kind: 'undo',
      undoneActionId: a.actionId,
      what: 'the change to sets 3–4',
      restored: [{ sessionExerciseId: id(10), exerciseName: 'Bench press', changes: [{ setId: id(13), setNumber: 3, before: tgt(kg(95), 8), after: tgt(kg(100), 6, 8) }] }],
      alreadyLogged: [],
    });
    expect(checkReplyClaims('Rolled back.', ledger([undo])).keep).toBe(true);
    expect(checkReplyClaims('Back to 100.', ledger([undo])).keep).toBe(true);
    // The r4 failure scenario: an undo that went stale backs nothing.
    expect(checkReplyClaims('Rolled back.', ledger([{ ...undo, status: 'stale' }]))).toMatchObject({ keep: false });
    expect(checkReplyClaims('Rolled back.', EMPTY)).toMatchObject({ keep: false, reason: 'no_action' });
    const added = record({
      kind: 'adjust_pending_sets',
      sessionId: id(1),
      exercises: [{ sessionExerciseId: id(10), exerciseName: 'Bench press', changes: [{ setId: id(15), setNumber: 5, before: null, after: tgt(kg(90), 8) }] }],
    });
    expect(checkReplyClaims('Extra set on the end for you.', ledger([added])).keep).toBe(true);
    expect(checkReplyClaims('Extra set on the end for you.', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    const removed = record({
      kind: 'adjust_pending_sets',
      sessionId: id(1),
      exercises: [{ sessionExerciseId: id(10), exerciseName: 'Bench press', changes: [{ setId: id(14), setNumber: 4, before: tgt(kg(100), 6, 8), after: null }] }],
    });
    expect(checkReplyClaims('No set 4 today.', ledger([removed])).keep).toBe(true);
    expect(checkReplyClaims('No set 4 today.', ledger([a]))).toMatchObject({ keep: false });
    const pain = record({ kind: 'set_pain_flag', flagIds: [id(50)], exerciseNames: ['Overhead press'], area: 'shoulder' });
    expect(checkReplyClaims('OHP’s on ice for now.', ledger([pain])).keep).toBe(true);
    expect(checkReplyClaims('OHP’s on ice for now.', ledger([a])).keep).toBe(false);
    const forget = record({ kind: 'forget_memory', memoryId: id(61), text: 'Hates lunges' });
    expect(checkReplyClaims('I’ve let that go.', ledger([forget])).keep).toBe(true);
    expect(checkReplyClaims('I’ve let that go.', ledger([a])).keep).toBe(false);
  });

  it('abbreviations, exercises outside the session and "every set" are checked against the ledger (review r4 B3)', () => {
    const a = benchAdjust();
    for (const s of ['OHP is 95 for the rest', 'RDL is 95 for the rest', 'Lat pulldown is 95 for the rest', 'Leg press is 95 for the rest', 'Hack squat is 95 for the rest']) {
      expect(checkReplyClaims(s, ledger([a])), s).toMatchObject({ keep: false, reason: 'mismatch' });
    }
    expect(checkReplyClaims('All your sets are 95 now', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch', detail: 'It said every set; only sets 3–4 changed.' });
    expect(checkReplyClaims('Every set is 95 now', ledger([a]))).toMatchObject({ keep: false, reason: 'mismatch' });
    // The remaining sets are what changed, so "the rest" still matches.
    expect(checkReplyClaims('All your remaining sets are 95 now', ledger([a])).keep).toBe(true);
    // An abbreviation of the changed exercise matches it.
    const ohp = record({
      kind: 'adjust_pending_sets',
      sessionId: id(1),
      exercises: [{ sessionExerciseId: id(11), exerciseName: 'Overhead press', changes: [{ setId: id(23), setNumber: 3, before: tgt(kg(50), 8), after: tgt(kg(45), 8) }] }],
    });
    expect(checkReplyClaims('OHP is 45 for the rest', ledger([ohp])).keep).toBe(true);
    expect(checkReplyClaims('Bench is 45 for the rest', ledger([ohp])).keep).toBe(false);
  });

  it('an earlier action read through get_recent_actions backs a claim about it (CC5, check 16)', () => {
    const earlier = benchAdjust({ turnId: 'turn-0' });
    // Only with its token cited in the sentence (review r2 S2): free text alone can't lean on an earlier read.
    expect(checkReplyClaims('I lowered bench press earlier because set 2 was RPE 10.', ledger([['e1', earlier, 'earlier']]), new Set([earlier.actionId])).keep).toBe(true);
    expect(checkReplyClaims('I lowered bench press earlier because set 2 was RPE 10.', ledger([['e1', earlier, 'earlier']])).keep).toBe(false);
    expect(checkReplyClaims('I lowered sets 3–4.', ledger([['e1', earlier, 'earlier']]))).toMatchObject({ keep: false, reason: 'no_action' });
    expect(checkReplyClaims('I lowered bench press earlier because set 2 was RPE 10.', EMPTY).keep).toBe(false);
  });

  it('pain flags and memories match their own kinds only', () => {
    const pain = record({ kind: 'set_pain_flag', flagIds: [id(50)], exerciseNames: ['Overhead press'], area: 'shoulder' });
    expect(checkReplyClaims('I’ve flagged your shoulder pain on overhead press.', ledger([pain])).keep).toBe(true);
    expect(checkReplyClaims('I’ve flagged bench press too.', ledger([pain])).keep).toBe(false);
    expect(checkReplyClaims('I’ve lowered overhead press.', ledger([pain])).keep).toBe(false);

    const memory = record({ kind: 'save_memory', memoryId: id(60), text: 'Trains before work' });
    expect(checkReplyClaims('I’ll remember that.', ledger([memory])).keep).toBe(true);
    expect(checkReplyClaims('Noted.', ledger([memory])).keep).toBe(true);
    expect(checkReplyClaims('I’ve lowered sets 3–4.', ledger([memory])).keep).toBe(false);
  });

  it('lb stays lb: a kg number against an lb record is replaced', () => {
    const a = benchAdjust({}, tgt(lb(205), 8));
    expect(checkReplyClaims('Lowered sets 3–4 to 205 pounds.', ledger([a])).keep).toBe(true);
    expect(checkReplyClaims('Lowered sets 3–4 to 95 kg.', ledger([a]))).toMatchObject({ keep: false, reason: 'numbers_differ' });
  });

  it('next-session claims need a saved small change, not a bigger suggestion', () => {
    const next = record({
      kind: 'set_next_session_targets',
      sourceSessionId: id(1),
      workoutLabel: 'Push A',
      rows: [
        { exerciseId: id(20), exerciseName: 'Bench press', before: tgt(kg(95), 6, 8), after: tgt(kg(97.5), 6, 8), setsBefore: 3, setsAfter: 3, size: 'small' },
        { exerciseId: id(21), exerciseName: 'Overhead press', before: tgt(kg(50), 6, 8), after: tgt(kg(40), 6, 8), setsBefore: 3, setsAfter: 3, size: 'bigger' },
      ],
    });
    expect(checkReplyClaims('Next session, bench press will be 97.5 kg for 6–8.', ledger([next])).keep).toBe(true);
    expect(checkReplyClaims('Next session, overhead press will be 40 kg.', ledger([next])).keep).toBe(false);
    expect(checkReplyClaims('I’ve lowered sets 3–4.', ledger([next])).keep).toBe(false);
  });
});

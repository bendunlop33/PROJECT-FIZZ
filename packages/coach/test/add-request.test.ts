import { describe, expect, it } from 'vitest';
import { buildTurnRegistry, classifyBenRequest, gateFor, requestHas, todayAskVerdict } from '../src/index';

/**
 * (12 Oct) Ben: "Why can't the ChatGPT link create sets in the app?" The
 * gate decides from his own words which write tools the model sees. Adding
 * an exercise ("add 3 sets of lateral raises", "put in some curls") opens
 * `edit_today` and `adjust_pending_sets` (the exercise may already be
 * in the workout); a set on an existing exercise ("add a set to bench",
 * "another set") opens `adjust_pending_sets` only. A question, a negation, a
 * condition or a retraction opens nothing (rule 3).
 */

const words = (text: string) => ({ kind: 'words' as const, text, spoken: false });

/** The write tools a workout turn offers for these words. */
function writeTools(text: string, kind: 'workout' | 'general' = 'workout'): string[] {
  const g = gateFor({ kind, input: words(text), previousOffer: null, structuralSignals: [] });
  return buildTurnRegistry(g)
    .tools.filter((t) => t.effect !== 'read' && t.name !== 'suggest_memory')
    .map((t) => t.name)
    .sort();
}

// Review r3 S1: a plain today add doesn't open the proposal tool; an add with an unclear scope opens both.
// Coach v3 (ADR 0027, 18 Oct): one tool, `edit_today`, replaced `edit_today` and `adjust_pending_sets`.
const ADD = ['edit_today'];
const BOTH = ['edit_today', 'propose_next_workout_change'];
const FUTURE = ['propose_next_workout_change'];
const SETS = ['edit_today'];
const NONE: string[] = [];

describe('the gate for adding to today’s workout (table)', () => {
  it.each([
    // Adding an exercise.
    ['add 3 sets of lateral raises', ADD],
    ['Add 3 sets of lateral raises please', ADD],
    ['put in some curls', ADD],
    ['Put in some cable curls', ADD],
    ['throw in some curls', ADD],
    ['chuck in 3 sets of curls', ADD],
    ['stick some dips in', ADD],
    ['add curls', ADD],
    ['add some curls at the end', ADD],
    ['add face pulls after bench', ADD],
    ['can you add lateral raises?', ADD],
    ['could you add 3 sets of face pulls after bench?', ADD],
    ["let's do some curls", ADD],
    ['can we do some face pulls', ADD],
    ['I want to add some curls', ADD],
    ['include face pulls today', ADD],
    ['add an exercise', ADD],
    ['add the leg press', ADD],
    ['add a superset of curls', ADD],
    // Review B1: a rep count after the sets, other verbs, a superset, "a set of" an exercise.
    ['add 3 sets of 12 lateral raises', ADD],
    ['add 3 sets of 12 reps of lateral raises', ADD],
    ['can you add 3 sets of 12 curls after bench', ADD],
    ['add 3 sets of 10-12 curls', ADD],
    ['add 3 sets of 10 to 12 curls', ADD],
    ['add 3x12 curls', ADD],
    ['add some sets of curls', ADD],
    ['give me 3 sets of curls', ADD],
    ['give me some curls', ADD],
    ['add a set of lateral raises', ADD],
    ['create 3 sets of lateral raises', ADD],
    ['can you create sets for lateral raises', ADD],
    ['can you create 3 sets of 12 lateral raises?', ADD],
    ['make 3 sets of curls', ADD],
    ['add in some curls', ADD],
    ['add on some curls', ADD],
    ['add on face pulls at the end', ADD],
    ['superset curls with bench', ADD],
    ['can you superset lateral raises with bench?', ADD],
    ["let's superset curls and pushdowns", ADD],
    // One more set of an exercise already there: today's sets only.
    ['add another set', SETS],
    ['add a set to bench', SETS],
    ['add a set', SETS],
    ['another set please', SETS],
    ['one more set of bench please', SETS],
    ['add a drop set', SETS],
    ['add weight to bench', SETS],
    ['add 5kg to bench', SETS],
    // Not a request.
    ['Why can’t you add curls?', NONE],
    ['should I add curls?', NONE],
    ['would curls help?', NONE],
    ["don't add curls", NONE],
    ['no need to add curls', NONE],
    ['if there is time add curls', NONE],
    ['add curls. actually no, leave it', NONE],
    ['I added curls last week', NONE],
    ['curls were good', NONE],
    ['do some curls', NONE],
    // Never an add: a load, a set type, a change to today's sets.
    ['make bench lighter', NONE],
    ['give me bench at 100', SETS],
    ['create a rule', NONE],
    ['make it 3 sets', SETS],
    ['give me 3 sets', SETS],
    ['superset sounds fun', NONE],
    // Review B2: an add with a future scope is a proposal, never today's add.
    ['add curls next time', ['propose_next_workout_change']],
    ['add curls to next session', ['propose_next_workout_change']],
    ['add curls for next week', ['propose_next_workout_change']],
    ['can you add curls to my routine', ['propose_next_workout_change']],
    ['add 3 sets of lateral raises to my push day template', ['propose_next_workout_change']],
    ['add face pulls from now on', ['propose_next_workout_change']],
    ['put in some curls every week', ['propose_next_workout_change']],
    ['create 3 sets of curls next time', ['propose_next_workout_change']],
    ['add curls going forward', ['propose_next_workout_change']],
    ['superset curls with bench next time', ['propose_next_workout_change']],
    // Review r2 B1: future scopes outside the r1 list.
    ['add curls in future', FUTURE],
    ['add curls in the future', FUTURE],
    ['add curls in future workouts', FUTURE],
    ['add curls to future sessions', FUTURE],
    ['add curls to my next workouts', FUTURE],
    ['add curls to the next sessions', FUTURE],
    ['add curls permanently', FUTURE],
    ['always add curls', FUTURE],
    ['add curls to push days', FUTURE],
    ['add curls on leg days', FUTURE],
    ['add curls to every push day', FUTURE],
    ['add curls every pull session', FUTURE],
    ['add curls for the rest of the block', FUTURE],
    ['add curls for the rest of the month', FUTURE],
    ['add curls from today on', FUTURE],
    ['add curls from today onwards', FUTURE],
    // Review r2 S1: today's plan is today; a bare "the plan" is ambiguous, so both tools open.
    ["add curls to today's plan", ADD],
    ['add curls to today’s plan', ADD],
    ['add curls to the plan for today', ADD],
    ['add curls to my plan today', ADD],
    ['add curls to the plan for this workout', ADD],
    ['add curls in the plan', BOTH],
    ['add curls to the plan', BOTH],
    // Review r3 S1/N5: a routine or template with a today word is unclear, so both open; N3: one push day is today.
    ['add curls to my routine now', BOTH],
    ['add curls to the push template today', BOTH],
    ['add curls to push day', ADD],
    ['add curls today and next time', BOTH],
    ['add curls today, and to my routine', BOTH],
    ['add curls today and to my routine too', BOTH],
    ['add curls now and every push day as well', BOTH],
    ['add some curls, we always do them on fridays', ADD],
    ['put in some curls, I always forget them', ADD],
    ['add lateral raises, my shoulders need work every week', ADD],
    ['add curls to my plan', FUTURE],
    ['add curls to my push plan', FUTURE],
    // Review r2 S2: other ask forms.
    ["I'd like to add curls", ADD],
    ['I’d like to add curls', ADD],
    ["i'd like some curls", ADD],
    ['I would like some curls', ADD],
    ['can I get 3 sets of curls', ADD],
    ['can I have some curls?', ADD],
    ['we should add curls', ADD],
    ['maybe add some curls', ADD],
    ['perhaps add face pulls at the end', ADD],
    ['pair curls with bench', ADD],
    ['do curls as a superset with bench', ADD],
    ['add 3 sets of 12 on lateral raises', ADD],
    ["I'd like to add curls next time", FUTURE],
    ['we should add curls to every push day', FUTURE],
    // Still not a request.
    ["we shouldn't add curls", NONE],
    ['should we add curls?', NONE],
    ['maybe add some curls?', NONE],
    ["I'd like to know why you added curls", NONE],
    // A swap or variety request is structural, not an add.
    ['Can we do something other than cable fly?', ['propose_next_workout_change']],
  ] as const)('%s → %j', (text, expected) => {
    expect(writeTools(text)).toEqual([...expected].sort());
  });

  it('only a workout turn offers the tool; elsewhere it is withheld by turn kind', () => {
    const g = gateFor({ kind: 'general', input: words('add 3 sets of lateral raises'), previousOffer: null, structuralSignals: [] });
    expect(buildTurnRegistry(g).withheld).toContainEqual({ name: 'edit_today', reason: 'turn_kind' });
    const summary = gateFor({ kind: 'summary', input: words('add 3 sets of lateral raises'), previousOffer: null, structuralSignals: [] });
    expect(buildTurnRegistry(summary).tools.map((t) => t.name)).not.toContain('edit_today');
  });

  it('an add request counts as asking for a change, so a reply with no card gets "No change made."', () => {
    for (const t of ['put in some curls', 'stick some dips in', 'add 3 sets of lateral raises', 'add another set', 'add a set to bench', 'create 3 sets of lateral raises', 'add in some curls', 'superset curls with bench', 'add curls next time', "I'd like to add curls", 'I’d like some curls', 'can I get 3 sets of curls', 'we should add curls', 'maybe add some curls', 'pair curls with bench', 'do curls as a superset with bench', 'add 3 sets of 12 on lateral raises', 'add curls to every push day', "add curls to today's plan"]) {
      expect(gateFor({ kind: 'workout', input: words(t), previousOffer: null, structuralSignals: [] }).benAskedForChange).toBe(true);
    }
    expect(gateFor({ kind: 'workout', input: words('should I add curls?'), previousOffer: null, structuralSignals: [] }).benAskedForChange).toBe(false);
  });

  it('accepting an offer to adjust asks for today’s sets only: an add or swap after it is an offer (CA1)', () => {
    const g = gateFor({ kind: 'workout', input: { kind: 'accept_offer', offer: 'adjust_today' }, previousOffer: 'adjust_today', structuralSignals: [] });
    expect(buildTurnRegistry(g).tools.map((t) => t.name)).toContain('edit_today');
    expect(todayAskVerdict('edit_today', g, null, {}, { setsOnly: true }).asked).toBe(true);
    expect(todayAskVerdict('edit_today', g, null, {}, { setsOnly: false }).asked).toBe(false);
  });

  it('the add kind is its own: a memory or a log request never opens it', () => {
    for (const t of ['remember that I hate curls', 'log 100 for 8', 'set 2 was 95']) {
      expect(requestHas(classifyBenRequest(t, 'workout'), 'add')).toBe(false);
      expect(writeTools(t)).not.toContain('edit_today');
    }
  });
});

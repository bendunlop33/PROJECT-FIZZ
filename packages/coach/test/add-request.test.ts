import { describe, expect, it } from 'vitest';
import { buildTurnRegistry, classifyBenRequest, gateFor, requestHas } from '../src/index';

/**
 * (12 Oct) Ben: "Why can't the ChatGPT link create sets in the app?" The
 * gate decides from his own words which write tools the model sees. Adding
 * an exercise ("add 3 sets of lateral raises", "put in some curls") opens
 * `add_exercise_today` and `adjust_pending_sets` (the exercise may already be
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

const ADD = ['add_exercise_today', 'adjust_pending_sets'];
const SETS = ['adjust_pending_sets'];
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
    // A swap or variety request is structural, not an add.
    ['Can we do something other than cable fly?', ['propose_next_workout_change']],
  ] as const)('%s → %j', (text, expected) => {
    expect(writeTools(text)).toEqual([...expected].sort());
  });

  it('only a workout turn offers the tool; elsewhere it is withheld by turn kind', () => {
    const g = gateFor({ kind: 'general', input: words('add 3 sets of lateral raises'), previousOffer: null, structuralSignals: [] });
    expect(buildTurnRegistry(g).withheld).toContainEqual({ name: 'add_exercise_today', reason: 'turn_kind' });
    const summary = gateFor({ kind: 'summary', input: words('add 3 sets of lateral raises'), previousOffer: null, structuralSignals: [] });
    expect(buildTurnRegistry(summary).tools.map((t) => t.name)).not.toContain('add_exercise_today');
  });

  it('an add request counts as asking for a change, so a reply with no card gets "No change made."', () => {
    for (const t of ['put in some curls', 'stick some dips in', 'add 3 sets of lateral raises', 'add another set', 'add a set to bench']) {
      expect(gateFor({ kind: 'workout', input: words(t), previousOffer: null, structuralSignals: [] }).benAskedForChange).toBe(true);
    }
    expect(gateFor({ kind: 'workout', input: words('should I add curls?'), previousOffer: null, structuralSignals: [] }).benAskedForChange).toBe(false);
  });

  it('accepting an offer to adjust never opens the add tool (CA1 is today’s sets only)', () => {
    const g = gateFor({ kind: 'workout', input: { kind: 'accept_offer', offer: 'adjust_today' }, previousOffer: 'adjust_today', structuralSignals: [] });
    expect(buildTurnRegistry(g).tools.map((t) => t.name)).not.toContain('add_exercise_today');
  });

  it('the add kind is its own: a memory or a log request never opens it', () => {
    for (const t of ['remember that I hate curls', 'log 100 for 8', 'set 2 was 95']) {
      expect(requestHas(classifyBenRequest(t, 'workout'), 'add')).toBe(false);
      expect(writeTools(t)).not.toContain('add_exercise_today');
    }
  });
});

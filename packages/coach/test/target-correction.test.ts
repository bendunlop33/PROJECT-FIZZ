import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { buildEditRequest } from '../src/builder/requests';
import { BUILDER_TARGET_CORRECTION_LINES, LIVE_TARGET_CORRECTION_LINES } from '../src/corrections';
import { createEditTodayExecutor } from '../src/edit-today';
import { createSessionReadExecutor, createStoreExecutors, undoCoachAction, undoOpId, type CoachExecutors } from '../src/executors';
import { quoteAsks, verifyAsked } from '../src/intent';
import { runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { at, call, id, kg, memoryStore, OWNER, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * Ben, 21 Oct 19:15, live Back workout: shrugs were planned at 8 reps though he did 15 last time.
 * The coach said "I relied on the planned 8 reps instead of checking your previous shrug
 * performance — that was my mistake", and the outcome was "Nothing changed · 1 line hidden".
 * Earlier, "Can we add weights to these" (shrugs, curls, back extensions) got a clarifying question.
 *
 * Here the fixture's Dumbbell press (2 pending sets at 22.5 kg each × 8–10) stands in for the shrugs.
 */

let stores: Store[] = [];
async function store(): Promise<Store> {
  const s = await memoryStore();
  stores.push(s);
  return s;
}
afterEach(async () => {
  for (const s of stores) await s.close();
  stores = [];
});

async function saved(s: Store, agg: SessionAggregate): Promise<SessionAggregate> {
  const r = await s.repos.sessions.save(agg, null);
  if (!r.ok) throw new Error('save failed');
  return agg;
}

function liveExecutors(s: Store): CoachExecutors {
  const load = () => s.repos.sessions.get(SESSION);
  return {
    ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: SESSION }),
    get_active_session: createSessionReadExecutor({ loadSession: load, gymName: 'Main Gym' }),
    edit_today: createEditTodayExecutor({ store: s.repos.coach, loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
  };
}

const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] });

/** The corrected target: his 15 reps on both remaining sets, same load. */
const fifteen = (claim: Record<string, unknown>, baseVersion = 7) => ({
  baseVersion,
  ops: [
    { op: 'set', setId: id(200), target: { load: kg(22.5, 'per_hand'), reps: { min: 15, max: 15 } } },
    { op: 'set', setId: id(201), target: { load: kg(22.5, 'per_hand'), reps: { min: 15, max: 15 } } },
  ],
  reason: 'Matches your last session.',
  ...claim,
});

const BEN = 'Why is dumbbell press only 8 reps? I did 15 last time';

describe('a target the coach agrees was wrong is put right, never "Nothing changed"', () => {
  it('Ben pointing out a target contradicts what he did is a request (his words, quoted); an opinion question still is not', () => {
    expect(quoteAsks('I did 15 last time', BEN)).toBe(true);
    expect(quoteAsks('only 8 reps', BEN)).toBe(false);
    expect(verifyAsked({ tool: 'edit_today', chip: false, acceptedOffer: false, setsOnly: true, words: BEN, claim: { benAsked: true, benQuote: 'I did 15 last time' }, fallback: () => false })).toEqual({ asked: true, by: 'quote' });
    // Still an opinion question: offered, not applied.
    expect(quoteAsks('I did 15 last time', 'I did 15 last time, what do you think?')).toBe(false);
    expect(quoteAsks('can we add weights to these', 'Can we add weights to these')).toBe(true);
  });

  it('live: the coach admits the target was wrong and applies the corrected reps at once, with Undo (fake model)', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([
      [call('edit_today', fifteen({ benAsked: true, benQuote: 'I did 15 last time' })), { type: 'completed' }],
      reply('You’re right, I went off the plan instead of your last session.'),
    ]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    // The model is told to fix it in the same turn.
    expect(model.requests[0]?.instructions).toContain(LIVE_TARGET_CORRECTION_LINES);
    expect(model.requests[0]?.instructions).toContain('Never agree a target was wrong and change nothing');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(r.offer).toBeNull();
    expect(r.note ?? '').not.toContain('Nothing changed');
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.session.version).toBe(8);
    expect(after?.sets.filter((x) => x.sessionExerciseId === id(20)).map((x) => x.planned.reps)).toEqual([{ min: 15, max: 15 }, { min: 15, max: 15 }]);
    // Done sets never change (rule 2).
    expect(after?.sets.find((x) => x.id === id(100))).toEqual(workout().sets.find((x) => x.id === id(100)));
    // One-tap Undo puts the planned 8–10 back.
    const actionId = r.cards[0]?.record.actionId ?? '';
    expect((await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(900) })).result.status).toBe('written');
    expect((await s.repos.sessions.get(SESSION))?.sets.filter((x) => x.sessionExerciseId === id(20)).map((x) => x.planned.reps)).toEqual([{ min: 8, max: 10 }, { min: 8, max: 10 }]);
  });

  it('live: the same correction against a newer workout is refused (stale version, rule 5), never applied', async () => {
    const s = await store();
    await saved(s, workout(8));
    const model = new ScriptedCoachModel([[call('edit_today', fifteen({ benAsked: true, benQuote: 'I did 15 last time' }, 7)), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN), context: ctx(workout(8)) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.every((c) => c.record.status !== 'committed')).toBe(true);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(8);
  });

  it('"Can we add weights to these": one call for every exercise just discussed applies at once (no clarifying question needed)', async () => {
    const s = await store();
    await saved(s, workout());
    const both = {
      baseVersion: 7,
      ops: [
        { op: 'set', setId: id(200), target: { load: kg(25, 'per_hand'), reps: null } },
        { op: 'set', setId: id(201), target: { load: kg(25, 'per_hand'), reps: null } },
        { op: 'set', setId: id(300), target: { load: kg(25, 'assistance'), reps: null } },
        { op: 'set', setId: id(301), target: { load: kg(25, 'assistance'), reps: null } },
      ],
      reason: 'From your recent sessions.',
      benAsked: true,
      benQuote: 'add weights to these',
    };
    const model = new ScriptedCoachModel([[call('edit_today', both), { type: 'completed' }], reply('Both go up from your history.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Can we add weights to these'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.requests[0]?.instructions).toContain('act on every one of them in one call');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.sets.find((x) => x.id === id(201))?.planned.load).toEqual(kg(25, 'per_hand'));
    expect(after?.sets.find((x) => x.id === id(301))?.planned.load).toEqual(kg(25, 'assistance'));
  });

  it('builder before Start: the edit request tells the coach to propose the corrected target (Apply/Skip) and to act on "these"', () => {
    const req = buildEditRequest(
      { day: 'Back', minutes: 60, estimateMinutes: 55, supersets: false, slots: [] },
      { usable: [], painFlags: [], dayNotes: [], plan: null, goal: null, history: ['Dumbbell shrug, 14 Oct: 30 kg each × 15'], memories: [] },
      'Shrugs at 8? I did 15 last time',
      'model',
    );
    expect(req.instructions).toContain(BUILDER_TARGET_CORRECTION_LINES);
    expect(req.instructions).toContain('propose the corrected reps and load');
    expect(req.instructions).toContain('each one is a proposal he applies or skips'.replace('each', 'Each'));
  });
});

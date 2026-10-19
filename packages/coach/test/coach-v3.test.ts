import { afterEach, describe, expect, it } from 'vitest';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { capAddable, ADDABLE_CAP } from '../src/add-exercise';
import { bareNumbers, buildFocusFor, lengthRevision, buildMinutesFor, gymNamedIn, gymNameCore, sameGymName, savedGymFor, unknownGymLine } from '../src/build';
import { buildCoachContext, contextInputItems, lastLoggedSets, workoutView, type YourData } from '../src/context';
import { createSessionReadExecutor, createStoreExecutors, undoCoachAction, undoOpId, type CoachExecutors } from '../src/executors';
import { createEditTodayExecutor } from '../src/edit-today';
import { quoteInWords, verifyAsked } from '../src/intent';
import type { ModelRequest } from '../src/model-port';
import { createRenameExecutor } from '../src/rename';
import { parseToolCall } from '../src/tool-call';
import { buildTurnRegistry } from '../src/registry';
import { runCoachTurn, todayAskVerdict } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { at, call, id, kg, memoryStore, OWNER, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * Coach v3, slice 1 (ADR 0027; Ben, 18 Oct, build 156): the model reads what Ben meant and code
 * checks it. Ben's two reports are reproduced here and in `apps/mobile/test/coach-v3.test.ts`:
 * - "Not adjusting during workout": `Too easy` → the coach asked "Was that about the 40 kg
 *   overhead-press warm-up, or a working set?" → "Working set" → nothing changed.
 * - "Can't properly create based on constraints I give": "make it 40" kept a 60 min draft.
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
    ...createRenameExecutor({ store: s.repos.coach, loadSession: load }),
  };
}

const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] });

/**
 * Ben's build 156 workout: bench sets 1–2 done (working), then a 40 kg overhead-press warm-up
 * logged last (the fixture's dumbbell press row stands in for it, with a warm-up first).
 */
function afterWarmup(version = 7): SessionAggregate {
  const w = workout(version);
  const sets = w.sets.map((x) =>
    x.sessionExerciseId === id(20) && x.index === 0
      ? { ...x, setType: 'warmup' as const, status: 'completed' as const, actual: { load: kg(10, 'per_hand'), reps: 10, durationS: null, rpe: 5, rir: null }, completedAt: at(120), completedByOpId: 'op-warm' }
      : x,
  );
  return { ...w, sets };
}

/** Only a warm-up logged: nothing else done yet. */
function warmupOnly(version = 7): SessionAggregate {
  const w = afterWarmup(version);
  return { ...w, sets: w.sets.map((x) => (x.sessionExerciseId === id(10) && x.status === 'completed' ? { ...x, status: 'pending' as const, actual: null, completedAt: null, completedByOpId: null } : x)) };
}

/** Bench sets 3–4 up to 102.5 kg. */
const raise = (claim: Record<string, unknown> = {}, baseVersion = 7) => ({
  baseVersion,
  ops: [
    { op: 'set', setId: id(102), target: { load: kg(102.5), reps: null } },
    { op: 'set', setId: id(103), target: { load: kg(102.5), reps: null } },
  ],
  reason: 'The working sets felt easy.',
  ...claim,
});

function yourData(req: ModelRequest | undefined): YourData {
  const block = req?.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as YourData;
}

describe('verifyAsked: the model says Ben asked; code checks his words', () => {
  it('a quote is his words, in order, whole words, at least two (or his whole message)', () => {
    expect(quoteInWords('Working set', 'Working set')).toBe(true);
    expect(quoteInWords('working set', 'Working set.')).toBe(true);
    expect(quoteInWords('make it heavier', 'Can you make it heavier please?')).toBe(true);
    expect(quoteInWords('Heavier', 'Heavier')).toBe(true);
    // One word out of a longer message isn't enough; nor is a word he didn't say, or a part-word.
    expect(quoteInWords('heavier', 'Can you make it heavier')).toBe(false);
    expect(quoteInWords('make it lighter', 'Can you make it heavier')).toBe(false);
    expect(quoteInWords('king set', 'Working set')).toBe(false);
    expect(quoteInWords('', 'Working set')).toBe(false);
    expect(quoteInWords('Working set', null)).toBe(false);
    expect(quoteInWords(null, 'Working set')).toBe(false);
    // Curly quotes and spacing don't matter.
    expect(quoteInWords("that’s   too easy", "That's too easy")).toBe(true);
  });

  it('a tap counts for today’s sets only; a claim with a verified quote counts; "he didn’t ask" is an offer; else the word lists decide', () => {
    const base = { chip: false, acceptedOffer: false, words: 'Working set', claim: {}, fallback: () => false };
    expect(verifyAsked({ ...base, tool: 'adjust_pending_sets', chip: true, words: null })).toEqual({ asked: true, by: 'chip' });
    expect(verifyAsked({ ...base, tool: 'add_exercise_today', chip: true, words: null })).toEqual({ asked: false, by: 'no_request' });
    expect(verifyAsked({ ...base, tool: 'adjust_pending_sets', acceptedOffer: true, words: null })).toEqual({ asked: true, by: 'accepted_offer' });
    expect(verifyAsked({ ...base, tool: 'rename_workout', acceptedOffer: true, words: null })).toEqual({ asked: false, by: 'no_request' });
    expect(verifyAsked({ ...base, tool: 'adjust_pending_sets', claim: { benAsked: true, benQuote: 'Working set' } })).toEqual({ asked: true, by: 'quote' });
    // An invented quote is never trusted: the word lists decide.
    expect(verifyAsked({ ...base, tool: 'adjust_pending_sets', claim: { benAsked: true, benQuote: 'make it heavier' } })).toEqual({ asked: false, by: 'no_request' });
    expect(verifyAsked({ ...base, tool: 'adjust_pending_sets', claim: { benAsked: true, benQuote: 'make it heavier' }, fallback: () => true })).toEqual({ asked: true, by: 'words' });
    expect(verifyAsked({ ...base, tool: 'adjust_pending_sets', claim: { benAsked: false, benQuote: null }, fallback: () => true })).toEqual({ asked: false, by: 'model_said_no' });
    expect(verifyAsked({ ...base, tool: 'adjust_pending_sets', claim: { benAsked: null } })).toEqual({ asked: false, by: 'no_request' });
  });

  it('todayAskVerdict: after warm-ups only, a Too easy tap is offered, not applied', () => {
    const chip = { benRequest: { source: 'chip' as const, chip: 'too_easy' as const }, acceptedOffer: false };
    expect(todayAskVerdict('adjust_pending_sets', chip, null, {}).asked).toBe(true);
    expect(todayAskVerdict('adjust_pending_sets', chip, null, {}, { noWorkingSet: true }).asked).toBe(false);
    // Words still go through the word lists when the model makes no claim (build 151's wording).
    expect(todayAskVerdict('adjust_pending_sets', { benRequest: null, acceptedOffer: false }, 'can you repopulate the weights based on my max?', {}).asked).toBe(true);
  });

  it('the claim fields are optional in the schema and never part of the op ID', () => {
    const live = buildTurnRegistry({ kind: 'workout', benRequest: null, acceptedOffer: false, benPainWords: false, structuralSignals: [], liveWorkout: true });
    const a = parseToolCall('t1', 'edit_today', JSON.stringify(raise()), live);
    const b = parseToolCall('t1', 'edit_today', JSON.stringify(raise({ benAsked: true, benQuote: 'Working set' })), live);
    expect(a.ok && b.ok && a.opId === b.opId).toBe(true);
    expect(parseToolCall('t1', 'edit_today', JSON.stringify(raise({ benAsked: 'yes' })), live)).toMatchObject({ ok: false, error: 'invalid_args' });
  });
});

describe('the last logged set (Ben 18 Oct: the coach must know which set was logged last)', () => {
  it('lastLogged is the newest result; lastWorkingSet skips warm-ups; exercise, kind, load, reps and RPE are explicit', () => {
    const last = lastLoggedSets(afterWarmup());
    expect(last.lastLogged).toMatchObject({ exercise: 'Dumbbell press', sessionExerciseId: id(20), setNumber: 1, kind: 'warm-up', load: kg(10, 'per_hand'), reps: 10, rpe: 5 });
    expect(last.lastWorkingSet).toMatchObject({ exercise: 'Bench press', sessionExerciseId: id(10), setId: id(101), setNumber: 2, kind: 'working', load: kg(100), reps: 8, rpe: 10 });
    // Narrowed to one exercise (a tap on its slot): the dumbbell press has only a warm-up.
    expect(lastLoggedSets(afterWarmup(), id(20)).lastWorkingSet).toBeNull();
    expect(lastLoggedSets(warmupOnly())).toMatchObject({ lastLogged: { kind: 'warm-up' }, lastWorkingSet: null });
    // Nothing logged: both null.
    const fresh = workout();
    expect(lastLoggedSets({ ...fresh, sets: fresh.sets.map((x) => ({ ...x, status: 'pending' as const, actual: null, completedAt: null, completedByOpId: null })) })).toEqual({ lastLogged: null, lastWorkingSet: null });
  });

  it('it rides in the workout the coach sees (YOUR DATA and get_active_session)', () => {
    const view = workoutView(afterWarmup(), 'Main Gym');
    expect(view.lastLogged?.kind).toBe('warm-up');
    expect(view.lastWorkingSet?.exercise).toBe('Bench press');
    const items = contextInputItems(buildCoachContext({ ...ctx(afterWarmup()), turnKind: 'workout', thread: [] }));
    expect(JSON.stringify(items[0])).toContain('lastWorkingSet');
  });
});

describe('Ben’s report "Not adjusting during workout" (build 156), reproduced', () => {
  it('"Too easy" after a warm-up: the coach is told the last working set and acts on it; the change applies at once with Undo', async () => {
    const s = await store();
    await saved(s, afterWarmup());
    const model = new ScriptedCoachModel([[call('edit_today', raise()), { type: 'completed' }], reply('Bench goes up for the rest.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: { kind: 'chip', chip: 'too_easy' }, context: ctx(afterWarmup()) }), ports(s, model, liveExecutors(s)));
    const data = yourData(model.requests[0]);
    expect(data.workout?.lastLogged).toMatchObject({ exercise: 'Dumbbell press', kind: 'warm-up' });
    expect(data.workout?.lastWorkingSet).toMatchObject({ exercise: 'Bench press', kind: 'working', load: kg(100), reps: 8, rpe: 10 });
    expect(model.requests[0]?.instructions).toContain('never ask him which set it was');
    expect(r.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(r.offer).toBeNull();
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.sets.find((x) => x.id === id(103))?.planned.load).toEqual(kg(102.5));
    // Done sets never change (rule 2).
    expect(after?.sets.find((x) => x.id === id(101))).toEqual(afterWarmup().sets.find((x) => x.id === id(101)));
    const actionId = r.cards[0]?.record.actionId ?? '';
    expect((await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(900) })).result.status).toBe('written');
    expect((await s.repos.sessions.get(SESSION))?.sets.find((x) => x.id === id(103))?.planned.load).toEqual(kg(100));
  });

  it('"Too easy" after warm-ups only: there is no working set it can be about, so the change is offered, never applied', async () => {
    const s = await store();
    await saved(s, warmupOnly());
    const model = new ScriptedCoachModel([[call('edit_today', raise()), { type: 'completed' }], reply('That was a warm-up. Want me to adjust?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: { kind: 'chip', chip: 'too_easy' }, context: ctx(warmupOnly()) }), ports(s, model, liveExecutors(s)));
    // Saved as an offer (Coach v3: exactly what Adjust would apply), never applied.
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    expect(r.offer).toBe('adjust_today');
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });

  it('answering the coach’s question ("Working set") counts as asking: the change applies at once with Undo', async () => {
    const s = await store();
    await saved(s, afterWarmup());
    // Turn 1 as on Ben's phone: the coach asked which set.
    const first = new ScriptedCoachModel([reply('Was that about the 40 kg overhead-press warm-up, or a working set?')]);
    const r1 = await runCoachTurn(request({ kind: 'workout', input: words('Too easy'), context: ctx(afterWarmup()) }), ports(s, first, liveExecutors(s)));
    expect(r1.status).toBe('completed');
    // Turn 2: his answer. The model says he asked, quoting him; code finds the quote in his message.
    const second = new ScriptedCoachModel([[call('edit_today', raise({ benAsked: true, benQuote: 'Working set' })), { type: 'completed' }], reply('Up a step on bench.')]);
    const r2 = await runCoachTurn(request({ kind: 'workout', threadId: r1.threadId, input: words('Working set'), context: ctx(afterWarmup()) }), ports(s, second, liveExecutors(s)));
    expect(second.offeredTools()[0]).toContain('edit_today');
    expect(r2.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect(r2.offer).toBeNull();
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(8);
    const actionId = r2.cards[0]?.record.actionId ?? '';
    expect((await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(900) })).result.status).toBe('written');
  });

  it('a quote Ben never wrote is not trusted: the call becomes an offer (rule 3)', async () => {
    const s = await store();
    await saved(s, afterWarmup());
    const model = new ScriptedCoachModel([[call('edit_today', raise({ benAsked: true, benQuote: 'make bench heavier' })), { type: 'completed' }], reply('Want me to adjust?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Working set'), context: ctx(afterWarmup()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    expect(r.offer).toBe('adjust_today');
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });

  it('the coach’s own idea (benAsked false) is an offer even on words the lists would read as a request', async () => {
    const s = await store();
    await saved(s, afterWarmup());
    const model = new ScriptedCoachModel([[call('edit_today', raise({ benAsked: false, benQuote: null })), { type: 'completed' }], reply('Want me to adjust?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Make the last two lighter'), context: ctx(afterWarmup()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    expect(r.offer).toBe('adjust_today');
  });

  it('words about next time stay a hard veto whatever the claim (review B1)', async () => {
    const s = await store();
    await saved(s, afterWarmup());
    const model = new ScriptedCoachModel([[call('edit_today', raise({ benAsked: true, benQuote: 'heavier next time' })), { type: 'completed' }], reply('Noted for next time.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Make bench heavier next time'), context: ctx(afterWarmup()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards).toEqual([]);
    expect(r.offer).toBeNull();
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });

  it('a stale version is still refused, never applied to the newer workout (rule 5)', async () => {
    const s = await store();
    await saved(s, afterWarmup(8));
    const model = new ScriptedCoachModel([[call('edit_today', raise({ benAsked: true, benQuote: 'Working set' }, 7)), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Working set'), context: ctx(afterWarmup(8)) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.map((c) => c.record.status)).toEqual(['stale']);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(8);
  });
});

describe('build length, focus and gym from the model’s arguments, checked (Ben: "make it 40")', () => {
  it('a length Ben stated outright wins; then the model’s; his one bare number beats a different model number; else the request’s', () => {
    expect(buildMinutesFor({ minutes: 60, minutesFromBen: null, benNumbers: [40] }, 40)).toEqual({ minutes: 40, by: 'coach' });
    expect(buildMinutesFor({ minutes: 60, minutesFromBen: null, benNumbers: [40] }, 45)).toEqual({ minutes: 40, by: 'ben' });
    expect(buildMinutesFor({ minutes: 60, minutesFromBen: 45, benNumbers: [] }, 30)).toEqual({ minutes: 45, by: 'ben' });
    expect(buildMinutesFor({ minutes: 60, minutesFromBen: null, benNumbers: [] }, 30)).toEqual({ minutes: 30, by: 'coach' });
    expect(buildMinutesFor({ minutes: 60, minutesFromBen: null, benNumbers: [] }, 42)).toEqual({ minutes: 40, by: 'coach' });
    expect(buildMinutesFor({ minutes: 60, minutesFromBen: null, benNumbers: [40] }, null)).toEqual({ minutes: 60, by: 'request' });
    expect(buildMinutesFor({ minutes: 60 }, undefined)).toEqual({ minutes: 60, by: 'request' });
  });

  it('bare numbers: a length-like number with no unit; never loads, reps, sets or seconds', () => {
    expect(bareNumbers('make it 40')).toEqual([40]);
    expect(bareNumbers('Make it 40.')).toEqual([40]);
    expect(bareNumbers('use 20 kg dumbbells, 3 sets of 12 reps')).toEqual([]);
    expect(bareNumbers('rest 90s, 100kg bench')).toEqual([]);
    expect(bareNumbers('only 45 today')).toEqual([45]);
    expect(bareNumbers('8')).toEqual([]);
  });

  it('review S2: only a revision of the length is a length; a load or a room number in a request is not', () => {
    for (const t of ['make it 40', 'Make it 40.', '40 instead', 'only 45 today', 'ok 40', 'can you make it 40 please', 'Actually, cut it to 40', 'Shorter, make it 40 tops', '40?']) expect([t, lengthRevision(t)]).toEqual([t, t.includes('45') ? 45 : 40]);
    for (const t of ['Leg session, I want to work up to 140 on squat', 'build me something, hotel room 115', 'hotel room 215', 'Shoulders, then 40 on the lateral raise', 'make it 40 or 50', 'push day']) expect([t, lengthRevision(t)]).toEqual([t, null]);
    // So the model's reading stands.
    expect(buildMinutesFor({ minutes: 60, minutesFromBen: null, benNumbers: [lengthRevision('Leg session, I want to work up to 140 on squat')].filter((n): n is number => n !== null) }, 60)).toEqual({ minutes: 60, by: 'coach' });
  });

  it('focus: the Build card’s chip stands; else the model’s reading; never split_day from the model', () => {
    expect(buildFocusFor({ focus: 'coach_picks' }, 'shoulders')).toBe('shoulders');
    expect(buildFocusFor({ focus: 'push', focusFromChips: true }, 'shoulders')).toBe('push');
    expect(buildFocusFor({ focus: 'push' }, null)).toBe('push');
    expect(buildFocusFor({ focus: 'push' }, 'split_day')).toBe('push');
  });

  it('gym names: Ben’s words name a saved gym; the model’s name matches one; an unknown one is refused with the saved list', () => {
    const saved = ['Main Gym', 'Hotel · Lisbon', 'Home'];
    expect(gymNameCore('My Hotel gym')).toBe('hotel');
    expect(sameGymName('hotel gym', 'Hotel')).toBe(true);
    expect(gymNamedIn(['Can you make me a shoulder workout in my hotel gym, dumbbells only'], saved)).toBe('Hotel · Lisbon');
    expect(gymNamedIn(['make it 40', 'shoulders at the main gym'], saved)).toBe('Main Gym');
    // "main lift" and "home" alone name no gym.
    expect(gymNamedIn(['bench as the main lift', 'I get home late'], saved)).toBeNull();
    expect(gymNamedIn(['at my home gym'], saved)).toBe('Home');
    expect(savedGymFor('Hotel gym', saved)).toBe('Hotel · Lisbon');
    expect(savedGymFor('main gym', saved)).toBe('Main Gym');
    expect(savedGymFor('Airport gym', saved)).toBeNull();
    expect(unknownGymLine('Airport gym', saved)).toBe('Not built: no saved gym called "Airport gym". Saved gyms: "Main Gym", "Hotel · Lisbon", "Home". Use one of them, or null for the selected gym.');
  });
});

describe('what can be added goes on every live turn, compact (no word gate)', () => {
  const list = Array.from({ length: 150 }, (_, i) => ({ exerciseId: `ex-${String(i).padStart(3, '0')}`, name: i === 140 ? 'Lateral raise' : `Exercise ${String(i).padStart(3, '0')}`, equipment: 'dumbbells', measured: 'reps' as const }));
  it('capped at ADDABLE_CAP, what Ben named kept first, in the list’s order', () => {
    const out = capAddable(list, 'can I finish with some lateral raises?');
    expect(out).toHaveLength(ADDABLE_CAP);
    expect(out.some((a) => a.name === 'Lateral raise')).toBe(true);
    expect(capAddable(list.slice(0, 10), '')).toHaveLength(10);
    expect(capAddable(list, '').some((a) => a.name === 'Lateral raise')).toBe(false);
  });
});

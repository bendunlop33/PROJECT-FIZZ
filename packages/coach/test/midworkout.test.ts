import { afterEach, describe, expect, it } from 'vitest';
import { exerciseHistoryView, IMPORTED_NOTE } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { createAdjustExecutor, createSessionReadExecutor, createStoreExecutors, storeTodayTargets, undoCoachAction, undoOpId, type CoachExecutors } from '../src/executors';
import { COACH_TOOLS } from '../src/registry';
import { createRenameExecutor } from '../src/rename';
import { asksToRename, classifyBenRequest, mentionsTodaysSets } from '../src/request';
import { gateFor, LIVE_WORKOUT_INSTRUCTIONS, runCoachTurn, todayChangeAsked } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { at, call, id, kg, memoryStore, OWNER, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * Build 151 (14 Oct, PM decision pending Ben): in a live workout the today-tools are offered on
 * every turn. Code decides whether a call applies (Ben asked: at once, with Undo) or becomes an
 * offer (he didn't: nothing applies until he accepts). Rename from chat. FitNotes history is a
 * valid basis for loads.
 */

const nb = (s: string): string => s.replace(/\u00a0/g, ' ');
const BENCH_EX = id(10);
/** Ben's exact words in build 151. */
const BEN_151 = 'can you repopulate the weights based on my maximum working weight recently?';

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
    adjust_pending_sets: createAdjustExecutor({ store: s.repos.coach, targets: storeTodayTargets(s.repos.coach), loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
    ...createRenameExecutor({ store: s.repos.coach, loadSession: load }),
  };
}

const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] });

/** Bench sets 3–4 to 102 kg (snaps to 102.5 on the bar). */
const raise = (baseVersion = 7) => ({
  baseVersion,
  exercises: [{ sessionExerciseId: BENCH_EX, sets: [{ setId: id(102), target: { load: kg(102), reps: null } }, { setId: id(103), target: { load: kg(102), reps: null } }], addSet: null, removeSetId: null }],
  reason: 'Your recent best was 105 × 6.',
});

describe('build 151: the today-tools are offered on every live-workout turn', () => {
  it("the classifier misses Ben's wording; the broad live-workout test counts it as a request", () => {
    expect(classifyBenRequest(BEN_151, 'workout')).toBeNull();
    expect(mentionsTodaysSets(BEN_151)).toBe(true);
    // A remark about one set, or a hold, isn't a request.
    expect(mentionsTodaysSets('Set 2 felt good')).toBe(false);
    expect(mentionsTodaysSets('Keep the weights as they are')).toBe(false);
    expect(mentionsTodaysSets('Make the last two lighter')).toBe(true);
    expect(mentionsTodaysSets('Recalculate my targets')).toBe(true);
  });

  it('the gate offers adjust_pending_sets, add_exercise_today and rename_workout live, whatever the words; not after the workout', () => {
    const live = gateFor({ kind: 'workout', input: words('How long have I been going?'), previousOffer: null, structuralSignals: [], liveWorkout: true });
    expect(live.liveWorkout).toBe(true);
    expect(live.benAskedForChange).toBe(false);
    const notLive = gateFor({ kind: 'workout', input: words(BEN_151), previousOffer: null, structuralSignals: [] });
    expect(notLive.liveWorkout).toBeUndefined();
  });

  it("Ben's exact wording: the tool is offered unforced, the call applies at once with Undo, snapped to the bar", async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('adjust_pending_sets', raise()), { type: 'completed' }], reply('Based on your recent best.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_151), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    const offered = model.offeredTools()[0] ?? [];
    expect(offered).toEqual(expect.arrayContaining(['adjust_pending_sets', 'rename_workout']));
    expect(model.requests[0]?.toolChoice).toBe('required');
    expect(model.requests[0]?.instructions).toContain(LIVE_WORKOUT_INSTRUCTIONS);
    expect(r.cards.map((c) => [c.record.status, nb(c.rendered.text)])).toEqual([['committed', 'Changed sets 3–4 to 102.5 kg × 6–8 (targets).']]);
    expect(r.offer).toBeNull();
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.session.version).toBe(8);
    // Done sets never change.
    expect(after?.sets.find((x) => x.id === id(101))).toEqual(workout().sets.find((x) => x.id === id(101)));
    // One-tap Undo puts 100 back.
    const actionId = r.cards[0]?.record.actionId ?? '';
    const u = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(800) });
    expect(u.result.status).toBe('written');
    expect((await s.repos.sessions.get(SESSION))?.sets.find((x) => x.id === id(103))?.planned.load).toEqual(kg(100));
  });

  it('an unprompted call is never applied: it becomes an offer card Ben accepts with Adjust', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('adjust_pending_sets', raise()), { type: 'completed' }], reply('Your last sets looked easy. Want me to adjust?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('That felt smooth'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(model.offeredTools()[0]).toContain('adjust_pending_sets');
    expect(r.cards).toEqual([]);
    expect(r.offer).toBe('adjust_today');
    expect(r.toolLog.map((l) => [l.tool, l.outcome])).toEqual([['adjust_pending_sets', 'proposed']]);
    expect(await s.repos.coach.listTurnActions(r.turnId)).toEqual([]);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
    // The model was told it wasn't applied.
    expect(JSON.stringify(model.requests[1]?.input)).toContain('not_applied');

    // Ben taps Adjust: now it applies, with Undo.
    const second = new ScriptedCoachModel([[call('adjust_pending_sets', raise()), { type: 'completed' }], reply('Done.')]);
    const r2 = await runCoachTurn(request({ kind: 'workout', threadId: r.threadId, input: { kind: 'accept_offer', offer: 'adjust_today' }, context: ctx(workout()) }), ports(s, second, liveExecutors(s)));
    expect(r2.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(8);
  });

  it('a stale base version is refused, never applied to the newer workout (rule 5)', async () => {
    const s = await store();
    await saved(s, workout(8));
    const model = new ScriptedCoachModel([[call('adjust_pending_sets', raise(7)), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_151), context: ctx(workout(8)) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.map((c) => c.record.status)).toEqual(['stale']);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(8);
  });

  it('todayChangeAsked: chips, an accepted offer and set words count; a bare remark does not', () => {
    const none = { benRequest: null, acceptedOffer: false };
    expect(todayChangeAsked('adjust_pending_sets', none, 'That felt smooth')).toBe(false);
    expect(todayChangeAsked('adjust_pending_sets', none, BEN_151)).toBe(true);
    expect(todayChangeAsked('adjust_pending_sets', { benRequest: { source: 'chip', chip: 'too_hard' }, acceptedOffer: false }, null)).toBe(true);
    expect(todayChangeAsked('adjust_pending_sets', { benRequest: null, acceptedOffer: true }, null)).toBe(true);
    expect(todayChangeAsked('rename_workout', none, BEN_151)).toBe(false);
    expect(todayChangeAsked('rename_workout', none, 'Change name of workout to Chest day')).toBe(true);
  });
});

describe('rename_workout (build 151: "Change name of workout to …")', () => {
  it('recognises rename wording, not other uses of "name"', () => {
    expect(asksToRename('Change name of workout to Chest, abs and triceps')).toBe(true);
    expect(asksToRename('rename this to Push B')).toBe(true);
    expect(asksToRename('call it Chest day')).toBe(true);
    expect(asksToRename("What's the name of this exercise?")).toBe(false);
    expect(asksToRename("Don't rename it")).toBe(false);
  });

  it('is a registered, gated, versioned tool for workout turns only', () => {
    const t = COACH_TOOLS.find((x) => x.name === 'rename_workout');
    expect(t).toMatchObject({ effect: 'versioned_update', writes: ['session_name'], needs: 'ben_request', turnKinds: ['workout'] });
  });

  it('Ben asks: the workout is renamed at once, with Undo back to the old name; a replay renames once', async () => {
    const s = await store();
    await saved(s, workout());
    const args = { baseVersion: 7, name: 'Chest, abs, triceps' };
    const model = new ScriptedCoachModel([[call('rename_workout', args, 'r1'), { type: 'completed' }], [call('rename_workout', args, 'r2'), { type: 'completed' }], reply('Sure.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Change name of workout to Chest, abs, triceps'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['committed', 'Renamed workout: Chest, abs, triceps.']]);
    expect(r.toolLog.map((l) => l.outcome)).toEqual(['committed', 'replayed']);
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.session).toMatchObject({ routineName: 'Chest, abs, triceps', version: 8 });

    const actionId = r.cards[0]?.record.actionId ?? '';
    const u = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(800) });
    expect(u.result.status).toBe('written');
    expect((await s.repos.sessions.get(SESSION))?.session.routineName).toBe('Push A');
  });

  it('unprompted: not renamed, offered instead', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('rename_workout', { baseVersion: 7, name: 'Push day' }), { type: 'completed' }], reply('Want a new name?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Bench felt strong'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards).toEqual([]);
    expect(r.offer).toBe('adjust_today');
    expect((await s.repos.sessions.get(SESSION))?.session.routineName).toBe('Push A');
  });

  it('a stale version or an open-ended workout is refused with nothing changed', async () => {
    const s = await store();
    await saved(s, workout(8));
    const stale = new ScriptedCoachModel([[call('rename_workout', { baseVersion: 7, name: 'Chest day' }), { type: 'completed' }], reply('Okay.')]);
    const r1 = await runCoachTurn(request({ kind: 'workout', input: words('rename it to Chest day'), context: ctx(workout(8)) }), ports(s, stale, liveExecutors(s)));
    expect(r1.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['stale', 'Not renamed: your workout moved on.']]);

    const s2 = await store();
    const open = workout();
    await saved(s2, { ...open, session: { ...open.session, routineName: null } });
    const m2 = new ScriptedCoachModel([[call('rename_workout', { baseVersion: 7, name: 'Chest day' }), { type: 'completed' }], reply('Okay.')]);
    const r2 = await runCoachTurn(request({ kind: 'workout', input: words('rename it to Chest day'), context: ctx(open) }), ports(s2, m2, liveExecutors(s2)));
    expect(r2.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['rejected', 'Not renamed: you can name this workout after you finish it.']]);
    expect((await s2.repos.sessions.get(SESSION))?.session.routineName).toBeNull();
  });
});

describe('imported FitNotes history is a valid basis for loads (B7)', () => {
  it('the history read labels FitNotes workouts as Ben’s own history usable for loads; tool text never says "not comparable"', () => {
    const base = workout();
    const finished: SessionAggregate = {
      ...base,
      session: { ...base.session, id: id(9100), status: 'finished', source: 'import', endedAt: at(3000), startedAt: at(0) },
      sets: base.sets.map((x) => ({ ...x, sessionId: id(9100), status: 'completed', actual: { load: x.planned.load, reps: 6, durationS: null, rpe: null, rir: null }, completedAt: at(60) })),
      exercises: base.exercises.map((e) => ({ ...e, sessionId: id(9100), equipmentId: null })),
    };
    const view = exerciseHistoryView({ exerciseId: id(1010), exerciseName: 'Bench press', sessions: [finished], limit: 5, gymNames: {}, equipmentNames: {} });
    expect(view.sessions[0]?.source).toBe('FitNotes import');
    expect(view.imported).toBe(IMPORTED_NOTE);
    expect(IMPORTED_NOTE).toMatch(/basis for loads/);
    const text = [IMPORTED_NOTE, LIVE_WORKOUT_INSTRUCTIONS, ...COACH_TOOLS.map((t) => t.description)].join('\n').toLowerCase();
    expect(text).not.toMatch(/never compared|not (?:a )?verified|like[- ]for[- ]like/);
  });
});

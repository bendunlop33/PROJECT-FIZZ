import { afterEach, describe, expect, it } from 'vitest';
import { exerciseHistoryView, IMPORTED_NOTE } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { SessionAggregate } from '@fizz/schemas';
import { createSessionReadExecutor, createStoreExecutors, undoCoachAction, undoOpId, type CoachExecutors } from '../src/executors';
import { acceptEditOffer, createEditTodayExecutor } from '../src/edit-today';
import { COACH_TOOLS } from '../src/registry';
import { createRenameExecutor } from '../src/rename';
import { asksToRename, classifyBenRequest, futureScopeOnly, mentionsAdding, mentionsTodaysSets } from '../src/request';
import { checkReplyClaims } from '../src/claims';
import { claimsNoTodayTool, TODAY_ASK_LINE } from '../src/reply';
import { FUTURE_SCOPE_LINE, gateFor, LIVE_WORKOUT_INSTRUCTIONS, liveWorkoutInstructions, runCoachTurn, todayChangeAsked } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { at, call, id, kg, memoryStore, OWNER, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * Build 151 (14 Oct, PM decision pending Ben): in a live workout the today-tools are offered on
 * every turn. Code decides whether a call applies (Ben asked: at once, with Undo) or becomes an
 * offer (he didn't: nothing applies until he accepts). Rename from chat. FitNotes history is a
 * valid basis for loads.
 */

const nb = (s: string): string => s.replace(/\u00a0/g, ' ');
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
    edit_today: createEditTodayExecutor({ store: s.repos.coach, loadSession: load, painFlags: () => Promise.resolve([]), sessionPainUnspecified: false, gymName: 'Main Gym' }),
    ...createRenameExecutor({ store: s.repos.coach, loadSession: load }),
  };
}

/** The turn's ports with Ben's accept of an offered edit wired (Coach v3: applies the stored offer, no model call). */
function livePorts(s: Store, model: ScriptedCoachModel) {
  return { ...ports(s, model, liveExecutors(s)), acceptOffer: acceptEditOffer.bind(null, { store: s.repos.coach, loadSession: () => s.repos.sessions.get(SESSION) }) };
}

const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] });

/** Bench sets 3–4 to 102 kg (snaps to 102.5 on the bar). */
const raise = (baseVersion = 7) => ({
  baseVersion,
  ops: [
    { op: 'set', setId: id(102), target: { load: kg(102), reps: null } },
    { op: 'set', setId: id(103), target: { load: kg(102), reps: null } },
  ],
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

  it('the gate offers edit_today and rename_workout live, whatever the words; not after the workout', () => {
    const live = gateFor({ kind: 'workout', input: words('How long have I been going?'), previousOffer: null, structuralSignals: [], liveWorkout: true });
    expect(live.liveWorkout).toBe(true);
    expect(live.benAskedForChange).toBe(false);
    const notLive = gateFor({ kind: 'workout', input: words(BEN_151), previousOffer: null, structuralSignals: [] });
    expect(notLive.liveWorkout).toBeUndefined();
  });

  it("Ben's exact wording: the tool is offered unforced, the call applies at once with Undo, snapped to the bar", async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', raise()), { type: 'completed' }], reply('Based on your recent best.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_151), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    const offered = model.offeredTools()[0] ?? [];
    expect(offered).toEqual(expect.arrayContaining(['edit_today', 'rename_workout']));
    expect(model.requests[0]?.toolChoice).toBe('required');
    expect(model.requests[0]?.instructions).toContain(liveWorkoutInstructions(false));
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

  it('an unprompted call is never applied: it is saved as an offer card; Adjust applies exactly that, with no model call', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', raise()), { type: 'completed' }], reply('Your last sets looked easy. Want me to adjust?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('That felt smooth'), context: ctx(workout()) }), livePorts(s, model));
    expect(model.offeredTools()[0]).toContain('edit_today');
    expect(r.cards.map((c) => [c.record.status, nb(c.rendered.text)])).toEqual([['proposed', 'Suggested: sets 3–4 at 102.5 kg × 6–8 (targets). Not applied.']]);
    expect(r.offer).toBe('adjust_today');
    expect(r.toolLog.map((l) => [l.tool, l.outcome])).toEqual([['edit_today', 'proposed']]);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
    // The model was told it wasn't applied.
    expect(JSON.stringify(model.requests[1]?.input)).toContain('not_applied');

    // Ben taps Adjust: the stored offer applies as it was shown, with Undo; the model isn't asked again.
    const second = new ScriptedCoachModel([reply('This should never be sent.')]);
    const r2 = await runCoachTurn(request({ kind: 'workout', threadId: r.threadId, input: { kind: 'accept_offer', offer: 'adjust_today' }, context: ctx(workout()) }), livePorts(s, second));
    expect(second.requests).toHaveLength(0);
    expect(r2.cards.map((c) => [c.record.status, nb(c.rendered.text)])).toEqual([['committed', 'Changed sets 3–4 to 102.5 kg × 6–8 (targets).']]);
    expect(r2.cards[0]?.record.detail).toMatchObject({ kind: 'edit_today', proposalId: r.cards[0]?.record.actionId });
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(8);
    // A double tap applies once.
    const third = await runCoachTurn(request({ kind: 'workout', threadId: r.threadId, input: { kind: 'accept_offer', offer: 'adjust_today' }, context: ctx(workout()) }), livePorts(s, new ScriptedCoachModel([])));
    expect(third.toolLog.map((l) => l.outcome)).toEqual([]);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(8);
    const actionId = r2.cards[0]?.record.actionId ?? '';
    expect((await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(900) })).result.status).toBe('written');
    expect((await s.repos.sessions.get(SESSION))?.sets.find((x) => x.id === id(103))?.planned.load).toEqual(kg(100));
  });

  it('an offer accepted after the workout moved on is refused as stale, never applied to the newer workout (rule 5)', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', raise()), { type: 'completed' }], reply('Want me to adjust?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('That felt smooth'), context: ctx(workout()) }), livePorts(s, model));
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    // Ben logs a set before tapping Adjust.
    const now = (await s.repos.sessions.get(SESSION)) as SessionAggregate;
    await s.repos.sessions.save({ ...now, session: { ...now.session, version: 8 } }, now.revision);
    const r2 = await runCoachTurn(request({ kind: 'workout', threadId: r.threadId, input: { kind: 'accept_offer', offer: 'adjust_today' }, context: ctx(workout(8)) }), livePorts(s, new ScriptedCoachModel([])));
    expect(r2.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['stale', "Couldn't change today's workout: your workout moved on. Nothing changed."]]);
    expect((await s.repos.sessions.get(SESSION))?.sets.find((x) => x.id === id(103))?.planned.load).toEqual(kg(100));
  });

  it('a stale base version is refused, never applied to the newer workout (rule 5)', async () => {
    const s = await store();
    await saved(s, workout(8));
    const model = new ScriptedCoachModel([[call('edit_today', raise(7)), { type: 'completed' }], reply('Okay.')]);
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

describe('review fixes: scope, accepted offers, rename claims, "no tool" lines, add list, info questions', () => {
  it('B1: words about next time, the routine or every push day never ask for today\'s sets or adds', () => {
    const none = { benRequest: null, acceptedOffer: false };
    for (const w of ['make bench heavier next time', 'Raise bench from now on', 'put the weights up in my routine', 'more sets on bench every push day', 'add curls to my template']) {
      expect(futureScopeOnly(w)).toBe(true);
      expect(todayChangeAsked('adjust_pending_sets', { benRequest: classifyBenRequest(w, 'workout'), acceptedOffer: false }, w)).toBe(false);
      expect(todayChangeAsked('add_exercise_today', { benRequest: classifyBenRequest(w, 'workout'), acceptedOffer: false }, w)).toBe(false);
    }
    // Today said outright still counts.
    expect(futureScopeOnly('make bench heavier today and next time')).toBe(false);
    expect(todayChangeAsked('adjust_pending_sets', none, 'make the rest heavier')).toBe(true);
    expect(liveWorkoutInstructions(true)).toMatch(/today only/);
  });

  it('B1: "make bench heavier next time" in a live workout is refused, not applied and not offered', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', raise()), { type: 'completed' }], reply('Noted for next time.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('make bench heavier next time'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(r.cards).toEqual([]);
    expect(r.offer).toBeNull();
    expect(r.toolLog.map((l) => [l.tool, l.outcome])).toEqual([['edit_today', 'not_allowed']]);
    expect(JSON.stringify(model.requests[1]?.input)).toContain(JSON.stringify(FUTURE_SCOPE_LINE).slice(1, 30));
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });

  it('S1: an accepted offer applies adjust_pending_sets only; a rename after it is offered, not run', async () => {
    expect(todayChangeAsked('rename_workout', { benRequest: null, acceptedOffer: true }, null)).toBe(false);
    expect(todayChangeAsked('add_exercise_today', { benRequest: null, acceptedOffer: true }, null)).toBe(false);
    const s = await store();
    await saved(s, workout());
    const first = new ScriptedCoachModel([reply('Your sets look easy. Want me to adjust?', 'adjust_today')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('That felt smooth'), context: ctx(workout()) }), ports(s, first, liveExecutors(s)));
    expect(r.offer).toBe('adjust_today');
    const second = new ScriptedCoachModel([[call('rename_workout', { baseVersion: 7, name: 'Chest day' }), { type: 'completed' }], reply('Okay.')]);
    const r2 = await runCoachTurn(request({ kind: 'workout', threadId: r.threadId, input: { kind: 'accept_offer', offer: 'adjust_today' }, context: ctx(workout()) }), ports(s, second, liveExecutors(s)));
    expect(r2.cards).toEqual([]);
    expect((await s.repos.sessions.get(SESSION))?.session.routineName).toBe('Push A');
  });

  it('S2: "I\'ve renamed the workout" with no rename card is hidden and noted', async () => {
    const empty = { turnId: 't', entries: [], knownExerciseNames: [] };
    expect(checkReplyClaims("I've renamed the workout to Chest day.", empty).keep).toBe(false);
    expect(checkReplyClaims("It's now called Chest day.", empty).keep).toBe(false);
    expect(checkReplyClaims('Want me to rename it?', empty).keep).toBe(true);
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([reply("I've renamed the workout to Chest day.")]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('rename it to Chest day'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    expect(r.items.filter((i) => i.kind === 'sentence')).toEqual([]);
    expect(r.note).not.toBeNull();
  });

  it('S3: the build-151 "no tool" sentence is hidden and replaced by an offer', async () => {
    expect(claimsNoTodayTool("I don't have a tool to repopulate them directly here.")).toBe(true);
    expect(claimsNoTodayTool("I can't change your weights here.")).toBe(true);
    expect(claimsNoTodayTool("I can't go past the machine's 120 kg.")).toBe(false);
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([reply("I don't have a tool to repopulate them directly here. Try 102.5 kg.")]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words(BEN_151), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    const texts = r.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []));
    expect(texts[0]).toBe(TODAY_ASK_LINE);
    expect(texts.join(' ')).not.toMatch(/tool/);
    expect(r.offer).toBe('adjust_today');
  });

  it('S5: adding is named to the coach only with the list of what can be added (Coach v3: one tool, edit_today)', async () => {
    expect(mentionsAdding('Can I also do some curls?')).toBe(true);
    const s = await store();
    await saved(s, workout());
    const without = new ScriptedCoachModel([reply('Sure.')]);
    await runCoachTurn(request({ kind: 'workout', input: words('Bench felt good'), context: ctx(workout()) }), ports(s, without, liveExecutors(s)));
    expect(without.offeredTools()[0]).toContain('edit_today');
    expect(without.requests[0]?.instructions).toContain(liveWorkoutInstructions(false));
    const withList = new ScriptedCoachModel([reply('Sure.')]);
    const listed = { ...ctx(workout()), addable: [{ exerciseId: 'curl', name: 'Curl', equipment: 'dumbbell', measured: 'reps' as const }] };
    await runCoachTurn(request({ kind: 'workout', input: words('Can I also do some curls?'), context: listed }), ports(s, withList, liveExecutors(s)));
    expect(withList.requests[0]?.instructions).toContain(liveWorkoutInstructions(true));
  });

  it('S6: questions for information are not requests, so a change the coach raises is offered', async () => {
    expect(mentionsTodaysSets('What weight did I do last week?')).toBe(false);
    expect(mentionsTodaysSets('How many sets left?')).toBe(false);
    expect(mentionsTodaysSets('What about lighter sets?')).toBe(true);
    expect(mentionsTodaysSets(BEN_151)).toBe(true);
    const g = gateFor({ kind: 'workout', input: words('What weight did I do last week?'), previousOffer: null, structuralSignals: [], liveWorkout: true });
    expect(g.benAskedForChange).toBe(false);
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', raise()), { type: 'completed' }], reply('You did 100 kg.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('What weight did I do last week?'), context: ctx(workout()) }), ports(s, model, liveExecutors(s)));
    // Saved as an offer (Coach v3), never applied.
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    expect(r.offer).toBe('adjust_today');
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });
});

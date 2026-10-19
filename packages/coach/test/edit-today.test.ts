import { afterEach, describe, expect, it } from 'vitest';
import { exercise, GYM, profile } from '@fizz/domain/testing';
import type { Store } from '@fizz/persistence';
import type { Exercise, PainFlag, SessionAggregate } from '@fizz/schemas';
import { acceptEditOffer, createEditTodayExecutor, type EditTodayDeps } from '../src/edit-today';
import { createStoreExecutors, undoCoachAction, undoOpId, type CoachExecutors } from '../src/executors';
import { runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { ASSIST, at, BAR, call, DB, id, memoryStore, OWNER, ports, reply, request, SESSION, words, workout } from './turn-fixtures';

/**
 * Coach v3 slice 2 (ADR 0027, Ben 18 Oct: "Why isn't the coach more dynamic like AI would be?"):
 * one tool, `edit_today`, for today's live workout. Swaps, adds, removals, moves, set counts and
 * targets apply together or not at all, with one Undo; an unasked edit is saved as an offer that
 * Adjust applies exactly, with no model call; stale versions are refused (rule 5).
 */

const nb = (s: string): string => s.replace(/\u00a0/g, ' ');
const INCLINE = exercise(4001, 'Incline DB press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const RAISE = exercise(4002, 'Lateral raise', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const KNOWN = new Map<string, Exercise>([INCLINE, RAISE].map((e) => [e.id, e]));

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

async function saved(s: Store, agg: SessionAggregate): Promise<void> {
  const r = await s.repos.sessions.save(agg, null);
  if (!r.ok) throw new Error('save failed');
}

function deps(s: Store, flags: () => readonly PainFlag[] = () => []): EditTodayDeps {
  return {
    store: s.repos.coach,
    loadSession: () => s.repos.sessions.get(SESSION),
    painFlags: () => Promise.resolve(flags()),
    sessionPainUnspecified: false,
    gymName: 'Main Gym',
    inputs: (exerciseId) => {
      const e = KNOWN.get(exerciseId) ?? null;
      return Promise.resolve({
        exercise: e,
        history: [],
        owner: profile(),
        sameMovementIds: [],
        exerciseUnsaved: true,
        substitute: { ownerId: OWNER, unit: 'kg', gym: { id: GYM, name: 'Main Gym', equipment: [BAR, DB, ASSIST] }, knownEquipment: new Map(), painFlags: [], sessionPain: { active: false, reportedAtUtc: null }, at: at(5) },
      });
    },
  };
}

function executors(s: Store): CoachExecutors {
  return { ...createStoreExecutors({ store: s.repos.coach, exercises: { exerciseName: () => Promise.resolve(null) }, sessionId: SESSION }), edit_today: createEditTodayExecutor(deps(s)) };
}

const livePorts = (s: Store, model: ScriptedCoachModel) => ({ ...ports(s, model, executors(s)), acceptOffer: acceptEditOffer.bind(null, deps(s)) });
const ctx = (session: SessionAggregate) => ({ session, gymName: 'Main Gym', painFlags: [], checkIn: null, memories: [], catalogue: [] });

const swapAndAdd = (claim: Record<string, unknown>, baseVersion = 7) => ({
  baseVersion,
  ops: [
    { op: 'swap', sessionExerciseId: id(10), toExerciseId: INCLINE.id },
    { op: 'add', exerciseId: RAISE.id, workingSets: 3, reps: { min: 12, max: 15 }, workSeconds: null, targetRpe: 8, afterSessionExerciseId: null, supersetWithSessionExerciseId: null },
  ],
  reason: 'Dumbbells only today.',
  ...claim,
});

const live = (a: SessionAggregate | null) => (a === null ? [] : [...a.exercises].filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order).map((e) => e.exerciseName));

describe('edit_today through the turn (Coach v3 slice 2)', () => {
  it('Ben asks for a swap and an add: both apply at once as one change, done sets untouched, one Undo puts it all back', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', swapAndAdd({ benAsked: true, benQuote: 'swap bench for incline dumbbell press' })), { type: 'completed' }], reply('Dumbbells it is.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('swap bench for incline dumbbell press and add lateral raises'), context: ctx(workout()) }), livePorts(s, model));
    expect(r.cards.map((c) => [c.record.status, nb(c.rendered.text)])).toEqual([['committed', 'Bench press → Incline DB press. Added Lateral raise: 3 × 12–15 reps @ RPE 8.']]);
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.session.version).toBe(8);
    expect(live(after)).toEqual(['Bench press', 'Incline DB press', 'Dumbbell press', 'Assisted pull-up', 'Lateral raise']);
    // Rule 2: bench's done sets stay as logged; only its pending ones moved.
    expect(after?.sets.filter((x) => x.sessionExerciseId === id(10)).map((x) => x.status)).toEqual(['completed', 'completed', 'deleted', 'deleted']);
    // The new exercises were saved to Ben's exercises in the same write.
    expect(await s.repos.exercises.get(RAISE.id)).not.toBeNull();
    // The model hears the new version and rows for a further change this turn.
    const out = model.requests[1]?.input.find((i) => i.type === 'function_call_output');
    expect(JSON.parse(out?.type === 'function_call_output' ? out.output : '{}')).toMatchObject({ status: 'committed', sessionVersion: 8, newSessionExerciseIds: [expect.any(String), expect.any(String)] });
    const actionId = r.cards[0]?.record.actionId ?? '';
    expect((await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(900) })).result.status).toBe('written');
    const back = await s.repos.sessions.get(SESSION);
    expect(live(back)).toEqual(['Bench press', 'Dumbbell press', 'Assisted pull-up']);
    expect(back?.sets.filter((x) => x.sessionExerciseId === id(10)).map((x) => x.status)).toEqual(['completed', 'completed', 'pending', 'pending']);
  });

  it('one op the checks refuse refuses the whole edit: nothing changes (all or nothing)', async () => {
    const s = await store();
    await saved(s, workout());
    // A target change that would pass, and two swaps to the same exercise that can't both happen.
    const args = { baseVersion: 7, ops: [{ op: 'set', setId: id(102), target: { load: { value: 95, unit: 'kg', convention: 'total' }, reps: null } }, { op: 'swap', sessionExerciseId: id(30), toExerciseId: INCLINE.id }, { op: 'swap', sessionExerciseId: id(10), toExerciseId: INCLINE.id }], reason: 'x', benAsked: true, benQuote: 'swap them' };
    const model = new ScriptedCoachModel([[call('edit_today', args), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('swap them'), context: ctx(workout()) }), livePorts(s, model));
    expect(r.cards.map((c) => [c.record.status, c.rendered.text])).toEqual([['rejected', "Couldn't change today's workout: the same exercise twice. Nothing changed."]]);
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });

  it('after a chip, a swap is the coach’s idea: saved as an offer, a claim of it is hidden; Adjust applies it with no model call', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', swapAndAdd({ benAsked: true, benQuote: 'Too easy' })), { type: 'completed' }], reply("I've swapped bench for incline presses. Want me to keep that?")]);
    const r = await runCoachTurn(request({ kind: 'workout', input: { kind: 'chip', chip: 'too_easy' }, context: ctx(workout()) }), livePorts(s, model));
    expect(r.cards.map((c) => [c.record.status, nb(c.rendered.text)])).toEqual([['proposed', 'Suggested: Bench press → Incline DB press. Added Lateral raise: 3 × 12–15 reps @ RPE 8. Not applied.']]);
    expect(r.offer).toBe('adjust_today');
    expect(r.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []))).not.toContain("I've swapped bench for incline presses.");
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);

    const silent = new ScriptedCoachModel([]);
    const r2 = await runCoachTurn(request({ kind: 'workout', threadId: r.threadId, input: { kind: 'accept_offer', offer: 'adjust_today' }, context: ctx(workout()) }), livePorts(s, silent));
    expect(silent.requests).toHaveLength(0);
    expect(r2.cards.map((c) => [c.record.status, nb(c.rendered.text)])).toEqual([['committed', 'Bench press → Incline DB press. Added Lateral raise: 3 × 12–15 reps @ RPE 8.']]);
    expect(live(await s.repos.sessions.get(SESSION))).toEqual(['Bench press', 'Incline DB press', 'Dumbbell press', 'Assisted pull-up', 'Lateral raise']);
    const actionId = r2.cards[0]?.record.actionId ?? '';
    expect((await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(900) })).result.status).toBe('written');
    expect(live(await s.repos.sessions.get(SESSION))).toEqual(['Bench press', 'Dumbbell press', 'Assisted pull-up']);
  });

  it('an offer survives a restart: fresh services apply it once (double tap replays), from what SQLite saved', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', swapAndAdd({ benAsked: false, benQuote: null })), { type: 'completed' }], reply('Want me to swap bench for incline presses?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('bench feels off today'), context: ctx(workout()) }), livePorts(s, model));
    const offer = r.cards[0]?.record;
    expect(offer?.status).toBe('proposed');
    // Restart: nothing in memory but the offer's ID; the record and the workout are read back from the store.
    const reread = (await s.repos.coach.listTurnActions(r.turnId)).find((a) => a.actionId === offer?.actionId);
    if (reread === undefined) throw new Error('offer not saved');
    const c = { ownerId: OWNER, turnId: id(7001), now: at(800) };
    const first = await acceptEditOffer(deps(s), reread, c);
    const again = await acceptEditOffer(deps(s), reread, c);
    expect(first).toMatchObject({ kind: 'action', replayed: false, record: { status: 'committed', detail: { proposalId: reread.actionId } } });
    expect(again).toMatchObject({ kind: 'action', replayed: true });
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.session.version).toBe(8);
    expect(live(after)).toEqual(['Bench press', 'Incline DB press', 'Dumbbell press', 'Assisted pull-up', 'Lateral raise']);
  });

  it('an offer accepted after the workout moved on is refused as stale: nothing changes (rule 5)', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', swapAndAdd({ benAsked: false, benQuote: null })), { type: 'completed' }], reply('Want me to swap bench?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('bench feels off today'), context: ctx(workout()) }), livePorts(s, model));
    const offer = r.cards[0]?.record;
    if (offer === undefined) throw new Error('no offer');
    // Ben logs a set before tapping Adjust.
    const now = (await s.repos.sessions.get(SESSION)) as SessionAggregate & { revision: number };
    const logged = { ...now, sets: now.sets.map((x) => (x.id === id(102) ? { ...x, status: 'completed' as const, actual: { load: { value: 100, unit: 'kg' as const, convention: 'total' as const }, reps: 8, durationS: null, rpe: 9, rir: null }, completedAt: at(700), completedByOpId: 'log-3', version: x.version + 1 } : x)), session: { ...now.session, version: 8 } };
    expect((await s.repos.sessions.save(logged, now.revision)).ok).toBe(true);
    const got = await acceptEditOffer(deps(s), offer, { ownerId: OWNER, turnId: id(7002), now: at(800) });
    expect(got).toMatchObject({ kind: 'action', record: { status: 'stale', detail: { command: null } } });
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.session.version).toBe(8);
    expect(live(after)).toEqual(['Bench press', 'Dumbbell press', 'Assisted pull-up']);
  });

  it('assisted machine: a target past the most assistance is bounded to it, in the assistance convention', async () => {
    const s = await store();
    await saved(s, workout());
    const target = { load: { value: 47, unit: 'kg', convention: 'assistance' }, reps: null, rpe: null };
    const args = { baseVersion: 7, ops: [{ op: 'set', setId: id(300), target }, { op: 'set', setId: id(301), target }], reason: 'More help on pull-ups.', benAsked: true, benQuote: 'more assistance on pull-ups' };
    const model = new ScriptedCoachModel([[call('edit_today', args), { type: 'completed' }], reply('Done.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('more assistance on pull-ups please'), context: ctx(workout()) }), livePorts(s, model));
    expect(r.cards[0]?.record.status).toBe('committed');
    const after = await s.repos.sessions.get(SESSION);
    expect(after?.sets.filter((x) => x.sessionExerciseId === id(30)).map((x) => x.planned.load)).toEqual([
      { value: 40, unit: 'kg', convention: 'assistance' },
      { value: 40, unit: 'kg', convention: 'assistance' },
    ]);
  });

  it('Undo is refused, nothing half undone, once a set is logged on the added exercise', async () => {
    const s = await store();
    await saved(s, workout());
    const model = new ScriptedCoachModel([[call('edit_today', swapAndAdd({ benAsked: true, benQuote: 'add lateral raises' })), { type: 'completed' }], reply('Okay.')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('swap bench and add lateral raises'), context: ctx(workout()) }), livePorts(s, model));
    const now = (await s.repos.sessions.get(SESSION)) as SessionAggregate & { revision: number };
    const raiseRow = now.exercises.find((e) => e.exerciseId === RAISE.id)?.id;
    const first = now.sets.find((x) => x.sessionExerciseId === raiseRow);
    const logged = { ...now, sets: now.sets.map((x) => (x.id === first?.id ? { ...x, status: 'completed' as const, actual: { load: { value: 10, unit: 'kg' as const, convention: 'per_hand' as const }, reps: 12, durationS: null, rpe: 8, rir: null }, completedAt: at(950), completedByOpId: 'log-raise', version: x.version + 1 } : x)), session: { ...now.session, version: now.session.version + 1 } };
    expect((await s.repos.sessions.save(logged, now.revision)).ok).toBe(true);
    const actionId = r.cards[0]?.record.actionId ?? '';
    const u = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId, opId: undoOpId(actionId), now: at(1000) });
    expect(u.result).toEqual({ status: 'not_possible', reason: 'changed_since' });
    expect(live(await s.repos.sessions.get(SESSION))).toContain('Incline DB press');
  });

  it('review S3: "Bench felt easy, what do you think?" quoted as "felt easy" is offered, not applied (rule 3)', async () => {
    const s = await store();
    await saved(s, workout());
    const up = { load: { value: 102.5, unit: 'kg', convention: 'total' }, reps: null, rpe: null };
    const args = { baseVersion: 7, ops: [{ op: 'set', setId: id(102), target: up }, { op: 'set', setId: id(103), target: up }], reason: 'Felt easy.', benAsked: true, benQuote: 'felt easy' };
    const model = new ScriptedCoachModel([[call('edit_today', args), { type: 'completed' }], reply('Want me to add 2.5 kg?')]);
    const r = await runCoachTurn(request({ kind: 'workout', input: words('Bench felt easy, what do you think?'), context: ctx(workout()) }), livePorts(s, model));
    expect(r.cards.map((c) => c.record.status)).toEqual(['proposed']);
    expect(r.offer).toBe('adjust_today');
    expect((await s.repos.sessions.get(SESSION))?.session.version).toBe(7);
  });

  describe('review B1: pain flagged after the offer, before Adjust (rule 9)', () => {
    const benchFlag = (n: number): PainFlag => ({
      id: id(960),
      ownerId: OWNER,
      version: 1,
      createdAtUtc: at(n).utc,
      updatedAtUtc: at(n).utc,
      exerciseId: id(1010),
      exerciseName: 'Bench press',
      area: 'shoulder',
      source: 'workout',
      checkInId: null,
      reportedAt: at(n),
      status: 'active',
      clearedAtUtc: null,
      createdByOpId: 'flag-bench',
    });
    const up = { load: { value: 102.5, unit: 'kg', convention: 'total' }, reps: null, rpe: null };

    it('bench +2.5 kg offered, then Pain on bench, then Adjust: refused, nothing changes', async () => {
      const s = await store();
      await saved(s, workout());
      const flags: PainFlag[] = [];
      const args = { baseVersion: 7, ops: [{ op: 'set', setId: id(102), target: up }, { op: 'set', setId: id(103), target: up }], reason: 'Last sets moved fast.', benAsked: false, benQuote: null };
      const model = new ScriptedCoachModel([[call('edit_today', args), { type: 'completed' }], reply('Want me to add 2.5 kg to bench?')]);
      const r = await runCoachTurn(request({ kind: 'workout', input: words('that felt quick'), context: ctx(workout()) }), { ...ports(s, model, executors(s)), acceptOffer: acceptEditOffer.bind(null, deps(s, () => flags)) });
      const offer = r.cards[0]?.record;
      expect(offer?.status).toBe('proposed');
      if (offer === undefined) throw new Error('no offer');
      // The workout's Pain tap: a flag document only, the workout's version stays 7.
      flags.push(benchFlag(600));
      const got = await acceptEditOffer(deps(s, () => flags), offer, { ownerId: OWNER, turnId: id(7003), now: at(700) });
      expect(got).toMatchObject({ kind: 'action', record: { status: 'rejected', detail: { command: null } } });
      expect(got.kind === 'action' ? got.record.failure : null).toMatch(/^Bench press: shoulder flagged/);
      const after = await s.repos.sessions.get(SESSION);
      expect(after?.session.version).toBe(7);
      expect(after?.sets.filter((x) => x.sessionExerciseId === id(10)).map((x) => x.planned.load?.value)).toEqual([100, 100, 100, 100]);
    });

    it('a swap to a movement flagged after the offer is refused; a decrease on a flagged row still applies', async () => {
      const s = await store();
      await saved(s, workout());
      const flags: PainFlag[] = [];
      const model = new ScriptedCoachModel([[call('edit_today', swapAndAdd({ benAsked: false, benQuote: null })), { type: 'completed' }], reply('Want me to swap bench?')]);
      const r = await runCoachTurn(request({ kind: 'workout', input: words('bench feels off today'), context: ctx(workout()) }), livePorts(s, model));
      const offer = r.cards[0]?.record;
      if (offer === undefined) throw new Error('no offer');
      flags.push({ ...benchFlag(600), exerciseId: INCLINE.id, exerciseName: INCLINE.name });
      const got = await acceptEditOffer(deps(s, () => flags), offer, { ownerId: OWNER, turnId: id(7004), now: at(700) });
      expect(got).toMatchObject({ kind: 'action', record: { status: 'rejected' } });
      expect(live(await s.repos.sessions.get(SESSION))).toEqual(['Bench press', 'Dumbbell press', 'Assisted pull-up']);

      const s2 = await store();
      await saved(s2, workout());
      const down = { load: { value: 95, unit: 'kg', convention: 'total' }, reps: null, rpe: null };
      const args = { baseVersion: 7, ops: [{ op: 'set', setId: id(102), target: down }], reason: 'RPE 10 twice.', benAsked: false, benQuote: null };
      const m2 = new ScriptedCoachModel([[call('edit_today', args), { type: 'completed' }], reply('Want me to drop bench?')]);
      const r2 = await runCoachTurn(request({ kind: 'workout', input: words('that was hard'), context: ctx(workout()) }), { ...ports(s2, m2, executors(s2)), acceptOffer: acceptEditOffer.bind(null, deps(s2)) });
      const o2 = r2.cards[0]?.record;
      if (o2 === undefined) throw new Error('no offer');
      const got2 = await acceptEditOffer(deps(s2, () => [benchFlag(600)]), o2, { ownerId: OWNER, turnId: id(7005), now: at(700) });
      expect(got2).toMatchObject({ kind: 'action', record: { status: 'committed' } });
    });
  });
});


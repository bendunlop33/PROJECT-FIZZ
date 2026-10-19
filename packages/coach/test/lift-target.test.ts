import { afterEach, describe, expect, it } from 'vitest';
import { liftTargetsInUse, newLiftTarget, withLiftTarget, type LiftTargetChoice } from '@fizz/domain';
import { profile } from '@fizz/domain/testing';
import type { Store } from '@fizz/persistence';
import type { SetLiftTargetArgs } from '@fizz/schemas';

import { asksForLiftTarget, createLiftTargetExecutors, LIFT_TARGET_NOT_ASKED_LINE, liftTargetAsked, type LiftTargetDeps } from '../src/lift-target';
import { undoCoachAction, undoOpId } from '../src/executors';
import { renderActionResult } from '../src/render';
import { runCoachTurn } from '../src/turn';
import { ScriptedCoachModel } from './fake-model';
import { at, call, id, memoryStore, OWNER, ports, reply, request, words } from './turn-fixtures';

/** `set_lift_target` (Ben approved 20 Oct): asked applies with Undo; offered saves nothing; off is never offered. */

const BENCH = id(5001);
const choice: LiftTargetChoice = { exerciseId: BENCH, name: 'Bench Press', convention: 'total', unit: 'kg', plateLoaded: false, lastDate: '2026-10-10' };

const stores: Store[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
});

async function setup(): Promise<Store> {
  const s = await memoryStore();
  stores.push(s);
  await s.repos.profiles.save(profile(), null);
  await s.repos.trainingProfiles.change(OWNER, { kind: 'lift_targets_on', on: true }, { opId: 'on', expectedVersion: 1, atUtc: at(1).utc, nowYear: 2026, today: '2026-10-14' });
  return s;
}

/** The app's checks, reduced: Bench only, the profile read now. */
function deps(s: Store): LiftTargetDeps {
  return {
    store: s.repos.coach,
    async prepare(args: SetLiftTargetArgs, a) {
      if (!/bench/i.test(args.exercise)) return { ok: false, line: `Not set: ${args.exercise} isn't one of Ben's exercises with a load.` };
      const p = await s.repos.trainingProfiles.get(OWNER);
      const list = p?.liftTargets ?? [];
      const target = newLiftTarget({ id: a.targetId, choice, kind: args.kind, value: args.load, unit: args.unit, reps: args.reps ?? 1, byDate: args.byDate, atUtc: a.nowUtc, today: a.nowUtc.slice(0, 10), setBy: 'coach' }, []);
      if (withLiftTarget(list, target) === null) return { ok: false, line: 'Not set: max 3 targets.' };
      return { ok: true, prepared: { target, before: list.find((t) => t.exerciseId === BENCH) ?? null, expectedVersion: p?.version ?? 1 } };
    },
  };
}

const args = (o: Partial<SetLiftTargetArgs> = {}): SetLiftTargetArgs => ({ exercise: 'Bench Press', kind: 'one_rm', load: 100, unit: 'kg', reps: null, byDate: '2027-03-01', benAsked: true, benQuote: 'I want to bench 100 kg by March', ...o });

describe('asksForLiftTarget (the word fallback)', () => {
  it.each([
    ['I want to bench 100 kg by March', true],
    ['set a target of 140 kg on squat', true],
    ['my goal is a 200 kg deadlift', true],
    ['what should my bench target be?', false],
    ['bench felt good today', false],
    ['I want a target', false],
  ])('%s → %s', (text, want) => {
    expect(asksForLiftTarget(text)).toBe(want);
  });

  it('a verified quote asks; "he didn’t ask" never does; a yes to the coach’s question does', () => {
    expect(liftTargetAsked('I want to bench 100 kg by March', { benAsked: true, benQuote: 'I want to bench 100 kg by March' })).toBe(true);
    expect(liftTargetAsked('Bench felt easy', { benAsked: false })).toBe(false);
    expect(liftTargetAsked('Bench felt easy', { benAsked: true, benQuote: 'bench 100 kg' })).toBe(false);
    expect(liftTargetAsked('Yes', { benAsked: true, benQuote: 'Yes' })).toBe(true);
  });
});

describe('set_lift_target in a turn', () => {
  it('Ben asks: the target is saved with its record and a card; Undo takes it off (once, idempotent)', async () => {
    const s = await setup();
    const model = new ScriptedCoachModel([[call('set_lift_target', args()), { type: 'completed' }], reply('Good goal.')]);
    const r = await runCoachTurn(request({ input: words('I want to bench 100 kg by March'), liftTargetsOn: true }), { ...ports(s, model, createLiftTargetExecutors(deps(s))) });
    expect(model.offeredTools()[0]).toContain('set_lift_target');
    expect(r.cards).toHaveLength(1);
    const card = r.cards[0];
    if (card === undefined) throw new Error('card');
    expect(card.record.status).toBe('committed');
    expect(card.rendered.text.replace(/\u00a0/g, ' ')).toBe('Lift target: Bench Press 100 kg by 1 Mar.');
    const p = await s.repos.trainingProfiles.get(OWNER);
    expect(liftTargetsInUse(p).map((t) => [t.exerciseName, t.load.value, t.byDate, t.setBy])).toEqual([['Bench Press', 100, '2027-03-01', 'coach']]);

    const undo = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: card.record.actionId, opId: undoOpId(card.record.actionId), now: at(500) });
    expect(undo.result.status).toBe('written');
    expect((await s.repos.trainingProfiles.get(OWNER))?.liftTargets).toEqual([]);
    const again = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: card.record.actionId, opId: undoOpId(card.record.actionId), now: at(501) });
    expect(again.result.status).toBe('replayed');
  });

  it('the coach’s own idea: nothing saved, no card; it is told to ask; Ben’s "Yes" then sets it', async () => {
    const s = await setup();
    const model = new ScriptedCoachModel([[call('set_lift_target', args({ benAsked: false, benQuote: null })), { type: 'completed' }], reply('Want a 100 kg bench target for March?')]);
    const r = await runCoachTurn(request({ input: words('Bench is going well'), liftTargetsOn: true }), ports(s, model, createLiftTargetExecutors(deps(s))));
    expect(r.cards).toEqual([]);
    expect(r.toolLog.map((l) => l.outcome)).toContain('not_allowed');
    expect(JSON.stringify(model.requests[1]?.input)).toContain(LIFT_TARGET_NOT_ASKED_LINE);
    expect((await s.repos.trainingProfiles.get(OWNER))?.liftTargets).toBeUndefined();

    const yes = new ScriptedCoachModel([[call('set_lift_target', args({ benQuote: 'Yes' })), { type: 'completed' }], reply('Done deal.')]);
    const r2 = await runCoachTurn(request({ threadId: r.threadId, input: words('Yes'), liftTargetsOn: true }), ports(s, yes, createLiftTargetExecutors(deps(s))));
    expect(r2.cards.map((c) => c.record.status)).toEqual(['committed']);
    expect((await s.repos.trainingProfiles.get(OWNER))?.liftTargets).toHaveLength(1);
  });

  it('off: never offered, even when Ben asks', async () => {
    const s = await setup();
    const model = new ScriptedCoachModel([reply('Sure.')]);
    await runCoachTurn(request({ input: words('I want to bench 100 kg by March') }), ports(s, model, createLiftTargetExecutors(deps(s))));
    expect(model.offeredTools()[0]).not.toContain('set_lift_target');
  });

  it('a replaced target comes back on Undo; Undo after Ben changed it since is refused', async () => {
    const s = await setup();
    const ex = createLiftTargetExecutors(deps(s)).set_lift_target;
    if (ex === undefined) throw new Error('executor');
    const ctx = (opId: string, minute: number) => ({ ownerId: OWNER, turnId: 'turn', opId, now: at(minute), benWords: null, messagePain: null, intent: 'general' as const });
    const first = await ex({ tool: 'set_lift_target', args: args() }, ctx('op-a', 200));
    const second = await ex({ tool: 'set_lift_target', args: args({ load: 105 }) }, ctx('op-b', 201));
    if (first.kind !== 'action' || second.kind !== 'action') throw new Error('actions');
    expect((await s.repos.trainingProfiles.get(OWNER))?.liftTargets?.map((t) => t.load.value)).toEqual([105]);
    // The same operation again replays: nothing written twice (rule 5).
    const replay = await ex({ tool: 'set_lift_target', args: args({ load: 105 }) }, ctx('op-b', 202));
    expect(replay).toMatchObject({ kind: 'action', replayed: true });
    expect(renderActionResult(second.record, 'sheet').text).toContain('105');

    await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: second.record.actionId, opId: undoOpId(second.record.actionId), now: at(300) });
    expect((await s.repos.trainingProfiles.get(OWNER))?.liftTargets?.map((t) => t.load.value)).toEqual([100]);
    // Ben removes it himself; the first action's Undo then finds its target gone and changes nothing.
    const p = await s.repos.trainingProfiles.get(OWNER);
    await s.repos.trainingProfiles.change(OWNER, { kind: 'remove_lift_target', exerciseId: BENCH }, { opId: 'ben-remove', expectedVersion: p?.version ?? 0, atUtc: at(301).utc, nowYear: 2026, today: '2026-10-14' });
    const late = await undoCoachAction(s.repos.coach, { ownerId: OWNER, actionId: first.record.actionId, opId: undoOpId(first.record.actionId), now: at(302) });
    expect(late.result).toEqual({ status: 'not_possible', reason: 'changed_since' });
  });

  it('a stale profile version is recorded as stale, never applied to newer state', async () => {
    const s = await setup();
    const d = deps(s);
    const stale: LiftTargetDeps = {
      ...d,
      async prepare(a, at2) {
        const r = await d.prepare(a, at2);
        return r.ok ? { ok: true, prepared: { ...r.prepared, expectedVersion: r.prepared.expectedVersion - 1 } } : r;
      },
    };
    const ex = createLiftTargetExecutors(stale).set_lift_target;
    if (ex === undefined) throw new Error('executor');
    const r = await ex({ tool: 'set_lift_target', args: args() }, { ownerId: OWNER, turnId: 'turn', opId: 'op-stale', now: at(200), benWords: null, messagePain: null, intent: 'general' });
    expect(r).toMatchObject({ kind: 'action', record: { status: 'stale' } });
    expect((await s.repos.trainingProfiles.get(OWNER))?.liftTargets).toBeUndefined();
  });

  it('refuses an exercise the app can’t match, with a line for the model', async () => {
    const s = await setup();
    const ex = createLiftTargetExecutors(deps(s)).set_lift_target;
    if (ex === undefined) throw new Error('executor');
    const r = await ex({ tool: 'set_lift_target', args: args({ exercise: 'Assisted pull-up' }) }, { ownerId: OWNER, turnId: 'turn', opId: 'op-x', now: at(200), benWords: null, messagePain: null, intent: 'general' });
    expect(r.kind).toBe('refused');
  });
});

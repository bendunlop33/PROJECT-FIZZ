import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type EditTodayArgs, type EditTodayOp, type SessionAggregate } from '@fizz/schemas';
import { planCoachEdit, reduceSession } from '../src/index';
import { at, id, kg, values } from './fixtures';
import { apply, BENCH, expectOk, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 8 Nov, live Pull B: "not much of a warm up", "why haven't u added a 80 too") `edit_today`'s `warmups` op: the
 * workout's own `add_warmup` (in the warm-up block by load, above the working sets) and, replacing the ramp, `delete_set`
 * on pending warm-ups only. Loads rounded down to the bar and plates, under the first working load; deduped; one op,
 * one version bump, one Undo; a replay builds the same rows; stale versions refused (rule 5); done sets untouched (rule 2).
 */

const rowOf = (s: SessionAggregate): string => s.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '';
const warm = (s: SessionAggregate) => setsFor(s, BENCH).filter((x) => x.setType === 'warmup' && x.status !== 'deleted').map((x) => [(x.actual?.load ?? x.planned.load)?.value ?? null, x.status]);
const order = (s: SessionAggregate) => setsFor(s, BENCH).filter((x) => x.status !== 'deleted').sort((a, b) => a.index - b.index).map((x) => x.setType);
function plan(s: SessionAggregate, ops: EditTodayOp[], opId = 'turn-1:edit_today:w', baseVersion = s.session.version) {
  const args: EditTodayArgs = { baseVersion, ops, reason: 'A real ramp.', benAsked: true, benQuote: 'not much of a warm up' };
  return planCoachEdit({ aggregate: s, args, intent: 'general', opId, actionId: id(9_300), at: at(500), painFlags: [], sessionPainUnspecified: false, gymName: 'Main gym', messagePain: null, exercises: new Map() });
}
const revert = { type: 'revert_coach_edit' as const, at: at(600), opId: 'undo-w', targetOpId: 'turn-1:edit_today:w', actionId: id(9_300) };

/** Bench: the 60 kg warm-up done, working sets pending (100 kg). */
function fresh(): SessionAggregate {
  const s = startFixture().state;
  const [w] = setsFor(s, BENCH);
  return apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
}

describe('warm-ups today (edit_today warmups)', () => {
  it('adds a ramp in load order above the working sets, rounded down to the plates, the done one kept and not repeated', () => {
    const s0 = fresh();
    const p = plan(s0, [{ op: 'warmups', sessionExerciseId: rowOf(s0), sets: [{ load: 60, reps: 10 }, { load: 81, reps: 3 }, { load: 70, reps: 5 }, { load: 120, reps: 1 }], replace: false }]);
    if (p.status !== 'ok') throw new Error(p.status === 'rejected' ? p.failure : p.status);
    expect(p.lines).toEqual([{ change: 'edit', text: 'Bench press warm-ups: 60, 70, 80 kg' }]);
    expect(p.guardNotes.map((n) => n.text)).toEqual(['Not done: 120 kg isn’t below Bench press’s 100 kg']);
    const r = expectOk(reduceSession(s0, p.command));
    expect(r.state.session.version).toBe(s0.session.version + 1);
    expect(warm(r.state)).toEqual([[60, 'completed'], [70, 'pending'], [80, 'pending']]);
    expect(order(r.state).slice(0, 3)).toEqual(['warmup', 'warmup', 'warmup']);
    // The same op again (a replay) is the same operation: nothing doubles.
    const again = reduceSession(r.state, p.command);
    expect(again.ok && again.duplicate).toBe(true);
    // Saved and read back (restart): still valid.
    expect(SessionAggregateSchema.safeParse(r.state).success).toBe(true);
    // One Undo takes the whole batch back.
    expect(warm(expectOk(reduceSession(r.state, revert)).state)).toEqual([[60, 'completed']]);
  });

  it('replace: pending warm-ups not asked for go, ones at a load asked for stay; a done one never moves', () => {
    const s0 = fresh();
    const s1 = expectOk(reduceSession(s0, (() => {
      const p = plan(s0, [{ op: 'warmups', sessionExerciseId: rowOf(s0), sets: [{ load: 70, reps: 5 }, { load: 85, reps: 2 }], replace: false }], 'turn-0:edit_today:a');
      if (p.status !== 'ok') throw new Error('not ok');
      return p.command;
    })())).state;
    expect(warm(s1)).toEqual([[60, 'completed'], [70, 'pending'], [85, 'pending']]);
    const p = plan(s1, [{ op: 'warmups', sessionExerciseId: rowOf(s1), sets: [{ load: 70, reps: 5 }, { load: 80, reps: 3 }], replace: true }]);
    if (p.status !== 'ok') throw new Error(p.status === 'rejected' ? p.failure : p.status);
    expect(p.lines).toEqual([{ change: 'edit', text: 'Bench press warm-ups: 60, 70, 80 kg' }]);
    const r = expectOk(reduceSession(s1, p.command)).state;
    expect(warm(r)).toEqual([[60, 'completed'], [70, 'pending'], [80, 'pending']]);
    expect(warm(expectOk(reduceSession(r, revert)).state)).toEqual([[60, 'completed'], [70, 'pending'], [85, 'pending']]);
  });

  it('already that: nothing to do is refused with its line; a stale version is refused', () => {
    const s0 = fresh();
    expect(plan(s0, [{ op: 'warmups', sessionExerciseId: rowOf(s0), sets: [{ load: 60, reps: 10 }], replace: false }])).toMatchObject({ status: 'rejected', failure: 'Bench press’s warm-ups are already that' });
    expect(plan(s0, [{ op: 'warmups', sessionExerciseId: rowOf(s0), sets: [{ load: 70, reps: 5 }], replace: false }], 'turn-1:edit_today:w', s0.session.version - 1)).toMatchObject({ status: 'stale' });
  });
});

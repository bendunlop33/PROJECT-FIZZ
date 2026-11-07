import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type SessionAggregate, type SessionCommand, type WorkoutSet } from '@fizz/schemas';
import { addWarmupCommand, buildExecutionOrder, buildWorkoutSummary, canAddWarmupNow, reduceSession, toHistorySessions, type SummaryInput } from '../src/index';
import { at, id, kg, ms, values } from './fixtures';
import { apply, BENCH, expectError, expectOk, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/**
 * (Ben, 7 Nov) "The add warm up button … should also move to top, underneath the last warm-up. Doesn't make sense
 * the default to be last after a working set." `add_warmup` always lands in the warm-up block (ramp order, lighter
 * first, before the first working set), even when working sets are done (a forgotten warm-up). Done sets keep their
 * values, times and relative order (rule 2); the current set stays on the next working set; logging the warm-up
 * starts and ends no rest; warm-ups never count toward volume or progression; Undo takes it out.
 */

const reload = (s: SessionAggregate): SessionAggregate => SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s)));
const rowId = (s: SessionAggregate, exerciseId: string): string => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.id ?? '';
const op = (opId: string, seconds = 400) => ({ opId, at: at(seconds) });
/** A set as Ben sees it, without its position (which a forgotten warm-up shifts by one). */
const sansIndex = (x: WorkoutSet): WorkoutSet => ({ ...x, index: -1 });
const shape = (s: SessionAggregate) => setsFor(s, BENCH).map((x) => `${x.setType}:${String((x.actual?.load ?? x.planned.load)?.value)}:${x.status}`);
const done = (s: SessionAggregate) => setsFor(s, BENCH).filter((x) => x.status === 'completed' && x.setType !== 'warmup');

function add(s: SessionAggregate, opId: string, newSetId: string): { s: SessionAggregate; cmd: Extract<SessionCommand, { type: 'add_warmup' }> } {
  const built = addWarmupCommand(s, rowId(s, BENCH), { ...op(opId), newSetId });
  if (!built.ok) throw new Error(built.reason);
  return { s: apply(s, built.command), cmd: built.command };
}

/** Bench: warm-up, set 1 and set 2 logged; two more working sets added, the first of them current (rest running). */
function twoWorkingDone(): SessionAggregate {
  let s = startFixture().state;
  const bench = rowId(s, BENCH);
  s = apply(s, { type: 'add_set', at: at(10), opId: 'add-a', sessionExerciseId: bench, newSetId: id(95001), setType: 'working' });
  s = apply(s, { type: 'add_set', at: at(11), opId: 'add-b', sessionExerciseId: bench, newSetId: id(95002), setType: 'working' });
  const [w, b1, b2] = setsFor(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
  s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 6), 300));
  s = apply(s, logCmd(b2?.id ?? '', values(kg(100), 6), 600));
  return s;
}

describe('＋ Warm-up lands in the warm-up block (Ben, 7 Nov)', () => {
  it('no working set done: after the warm-ups lighter than it, in ramp order, and it becomes current', () => {
    let s = startFixture().state;
    const first = add(s, 'w-1', id(95101));
    // Ramp 0 · 60 · 100: 30 kg × 10, above the 60 kg warm-up.
    expect(shape(first.s)).toEqual(['warmup:30:pending', 'warmup:60:pending', 'working:100:pending', 'working:100:pending']);
    expect(first.s.session.activeSetId).toBe(id(95101));
    s = first.s;
    // The next one fills 60–100: 80 kg, after the 60 kg warm-up and before set 1.
    const second = add(s, 'w-2', id(95102));
    expect(shape(second.s)).toEqual(['warmup:30:pending', 'warmup:60:pending', 'warmup:80:pending', 'working:100:pending', 'working:100:pending']);
    expect(second.s.session.activeSetId).toBe(id(95101));
  });

  it('after two working sets: above them as a pending row; done sets unchanged; the current set stays', () => {
    const s0 = twoWorkingDone();
    const before = setsFor(s0, BENCH);
    const current = s0.session.activeSetId;
    expect(current).toBe(id(95001));
    expect(canAddWarmupNow(s0, rowId(s0, BENCH))).toBe(true);
    const { s: s1, cmd } = add(s0, 'w-late', id(95201));
    // Ramp 0 · 60 · 100 (set 1's logged load): 30 kg, lighter than the 60 kg warm-up, so first.
    expect(shape(s1)).toEqual(['warmup:30:pending', 'warmup:60:completed', 'working:100:completed', 'working:100:completed', 'working:100:pending', 'working:100:pending']);
    expect(setsFor(s1, BENCH)[0]?.id).toBe(id(95201));
    // Every done set as it was (values, times, versions), in the same order; only its position moved down one.
    const after = setsFor(s1, BENCH).filter((x) => x.id !== id(95201));
    expect(after.map(sansIndex)).toEqual(before.map(sansIndex));
    expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));
    expect(s1.session.activeSetId).toBe(current);
    expect(s1.restTimer).toEqual(s0.restTimer);
    // The lifting order: the warm-up first, then the done sets in logged order, then what's left.
    const order = buildExecutionOrder(s1.exercises, s1.sets).filter((x) => setsFor(s1, BENCH).some((b) => b.id === x));
    expect(order).toEqual(setsFor(s1, BENCH).map((x) => x.id));
    // Idempotent and versioned (rule 5).
    expect(expectOk(reduceSession(s1, cmd)).duplicate).toBe(true);
    expectError(reduceSession(s1, { ...cmd, opId: 'w-stale', newSetId: id(95202) }), 'stale_version');
  });

  it('logging it records it with its own time and nothing else: done sets, rest and the current set untouched; Undo too', () => {
    const s0 = twoWorkingDone();
    const { s: s1 } = add(s0, 'w-late', id(95201));
    const rest = s1.restTimer;
    expect(rest?.status).toBe('running');
    const s2 = apply(s1, logCmd(id(95201), values(kg(30), 10), 650, 'log-late'));
    const logged = s2.sets.find((x) => x.id === id(95201));
    expect(logged?.status).toBe('completed');
    expect(logged?.completedAt).toEqual(at(650));
    expect(done(s2)).toEqual(done(s1));
    expect(s2.restTimer).toEqual(rest);
    expect(s2.session.activeSetId).toBe(id(95001));
    // Untick (the latest log): pending again, the current set and rest stay.
    const undone = apply(reload(s2), { type: 'undo_log', at: at(660), opId: 'undo-late', setId: id(95201), expectedSetVersion: logged?.version ?? 0 });
    expect(undone.sets.find((x) => x.id === id(95201))?.status).toBe('pending');
    expect(undone.session.activeSetId).toBe(id(95001));
    expect(undone.restTimer).toEqual(rest);
    expect(done(undone)).toEqual(done(s1));
  });

  it('Undo takes it out: back to the order before, done sets as they were (after a reload too)', () => {
    const s0 = twoWorkingDone();
    const { s: s1 } = add(s0, 'w-late', id(95201));
    const back = apply(reload(s1), { type: 'undo_op', at: at(700), opId: 'undo-w', targetOpId: 'w-late' });
    expect(back.sets.find((x) => x.id === id(95201))?.status).toBe('deleted');
    expect(setsFor(back, BENCH).filter((x) => x.status !== 'deleted').map(sansIndex)).toEqual(setsFor(s0, BENCH).map(sansIndex));
    expect(back.session.activeSetId).toBe(id(95001));
  });

  it('never counts: working sets, history (progression input) and next targets are the same with or without it', () => {
    const finish = (s: SessionAggregate) => apply(s, { type: 'finish', at: at(2000), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    const summary = (s: SessionAggregate) => buildWorkoutSummary({ aggregate: s, nowMs: ms(3000), gymName: 'Main Gym', history: { [BENCH]: toHistorySessions(s, BENCH) }, rules: {}, painFlags: [], checkIn: null, coach: 'not_connected' } satisfies SummaryInput);
    const without = finish(twoWorkingDone());
    const withIt = finish(apply(add(twoWorkingDone(), 'w-late', id(95201)).s, logCmd(id(95201), values(kg(30), 10), 650, 'log-late')));
    const a = summary(without);
    const b = summary(withIt);
    expect(b.facts.workingSets).toBe(a.facts.workingSets);
    expect(b.facts.warmupSets).toBe(a.facts.warmupSets + 1);
    expect(b.nextTime).toEqual(a.nextTime);
    const working = (s: SessionAggregate) => toHistorySessions(s, BENCH).flatMap((h) => h.sets.filter((x) => x.setType !== 'warmup'));
    expect(working(withIt)).toEqual(working(without));
  });

  it('every working set done: still allowed (a forgotten warm-up), above them; the workout’s current set stays', () => {
    let s = startFixture().state;
    for (const x of setsFor(s, BENCH)) s = apply(s, logCmd(x.id, values(x.planned.load, 8), 100 + x.index * 100));
    const current = s.session.activeSetId;
    const { s: s1 } = add(s, 'w-all', id(95301));
    expect(shape(s1)).toEqual(['warmup:30:pending', 'warmup:60:completed', 'working:100:completed', 'working:100:completed']);
    expect(s1.session.activeSetId).toBe(current);
  });

  it('Ben logged set 2 first: the warm-up still goes in the ramp (by load), above the done set; Log stays on his set', () => {
    let s = startFixture().state;
    const [w, , b2] = setsFor(s, BENCH);
    s = apply(s, logCmd(b2?.id ?? '', values(kg(100), 5), 100));
    const current = s.session.activeSetId;
    const { s: s1 } = add(s, 'w-x', id(95401));
    expect(setsFor(s1, BENCH).map((x) => x.id).slice(0, 2)).toEqual([id(95401), w?.id]);
    expect(s1.session.activeSetId).toBe(current);
  });

  it('at most 6 (BUILD_LIMITS), and never inside a superset', () => {
    let s = startFixture().state;
    for (let i = 0; i < 10; i += 1) {
      const next = addWarmupCommand(s, rowId(s, BENCH), { ...op(`w-max-${String(i)}`), newSetId: id(95500 + i) });
      if (!next.ok) {
        expect(['max_warmups', 'no_gap']).toContain(next.reason);
        break;
      }
      s = apply(s, next.command);
    }
    const warm = setsFor(s, BENCH).filter((x) => x.setType === 'warmup');
    expect(warm.length).toBeLessThanOrEqual(6);
    // Still in ramp order, all above set 1.
    const loads = warm.map((x) => x.planned.load?.value ?? 0);
    expect(loads).toEqual([...loads].sort((a, b) => a - b));
    expect(setsFor(s, BENCH).findIndex((x) => x.setType !== 'warmup')).toBe(warm.length);
    expect(addWarmupCommand(s, rowId(s, ROW), { ...op('w-ss'), newSetId: id(95600) })).toEqual({ ok: false, reason: 'superset' });
  });
});

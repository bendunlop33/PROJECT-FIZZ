import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentRoundIndex, jumpRoundCommand, roundMoves, sessionRounds, stepRoundCommand } from '@fizz/domain';
import type { SessionAggregate, SessionCommand } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 1 Nov: "Why can't I move this up or down or to the start?") The current exercise moves too while nothing on
 * it is logged, on real SQLite through the workout service as the screen sends it: Do first takes it to the first
 * place not started, the current set follows the order, a done exercise and its sets stay exactly as they were
 * (rule 2), one opId each, stale versions refused (rule 5), and Undo after a relaunch hands the current set back.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-19T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const names = (a: SessionAggregate): string[] => sessionRounds(a).map((r) => r.members.map((m) => m.exerciseName).join('+'));
const rowOf = (a: SessionAggregate, name: string): string => a.exercises.find((e) => e.exerciseName === name && e.removed === undefined)?.id ?? '';
const currentName = (a: SessionAggregate): string | undefined => sessionRounds(a)[currentRoundIndex(a)]?.members[0]?.exerciseName;
const benchSets = (a: SessionAggregate) => a.sets.filter((s) => s.sessionExerciseId === rowOf(a, 'Bench press'));

async function send(s: AppServices, sessionId: string, c: SessionCommand): Promise<SessionAggregate> {
  const r = await s.workout.dispatch(sessionId, c);
  if (!r.ok) throw new Error(r.error.message);
  return r.aggregate;
}

/** Bench press done (every set logged), then Incline dumbbell press and Lat pulldown with nothing logged. */
async function benchDone(s: AppServices, gymId: string): Promise<{ sessionId: string; a: SessionAggregate }> {
  const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  let a = started.aggregate;
  for (const name of ['Bench press', 'Incline dumbbell press', 'Lat pulldown']) {
    const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
    if (!pick) throw new Error(`no ${name}`);
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    a = added.aggregate;
  }
  for (const set of benchSets(a).filter((x) => x.status === 'pending')) {
    h.clockMs += 60_000;
    a = await send(s, sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}:0`, setId: set.id, values: { load: { value: 80, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
  }
  return { sessionId, a };
}

describe('moving the current exercise (Ben, 1 Nov)', () => {
  it('Do first on the one after the current: it goes above it (never above Bench, done) and becomes current; Undo after a relaunch hands back', async () => {
    const s = (await h.launch()).services;
    const gymId = await setUpGym(h, s);
    const { sessionId, a } = await benchDone(s, gymId);
    expect(names(a)).toEqual(['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    expect(currentName(a)).toBe('Incline dumbbell press');
    // The current exercise, nothing logged: Later and Down; no Now or Up (it's already first of the rest). Bench: nothing.
    expect(roundMoves(a, rowOf(a, 'Incline dumbbell press'))).toEqual({ up: false, down: true, first: false, toEnd: true });
    expect(roundMoves(a, rowOf(a, 'Bench press'))).toEqual({ up: false, down: false, first: false, toEnd: false });
    expect(roundMoves(a, rowOf(a, 'Lat pulldown'))).toEqual({ up: true, down: false, first: true, toEnd: false });

    const opId = h.ids();
    const m = jumpRoundCommand(a, rowOf(a, 'Lat pulldown'), 'do_first', { opId, at: h.now() });
    if (!m.ok) throw new Error(m.reason);
    const after = await send(s, sessionId, m.command);
    expect(names(after)).toEqual(['Bench press', 'Lat pulldown', 'Incline dumbbell press']);
    expect(currentName(after)).toBe('Lat pulldown');
    expect(benchSets(after)).toEqual(benchSets(a));
    expect(after.restTimer).toEqual(a.restTimer);

    // A retry with the same opId changes nothing; one worked out before the move is refused.
    const again = await s.workout.dispatch(sessionId, m.command);
    expect(again.ok && again.duplicate).toBe(true);
    const stale = stepRoundCommand(a, rowOf(a, 'Incline dumbbell press'), 'down', { opId: h.ids(), at: h.now() });
    if (!stale.ok) throw new Error(stale.reason);
    const refused = await s.workout.dispatch(sessionId, stale.command);
    expect(refused.ok ? '' : refused.error.code).toBe('stale_version');

    const s2 = (await h.launch()).services;
    const stored = (await s2.workout.load(sessionId))?.aggregate as SessionAggregate;
    expect(currentName(stored)).toBe('Lat pulldown');
    const u = await s2.workout.undoOp({ sessionId, targetOpId: opId });
    expect(u.ok).toBe(true);
    const back = (await s2.workout.load(sessionId))?.aggregate as SessionAggregate;
    expect(names(back)).toEqual(names(a));
    expect(back.session.activeSetId).toBe(a.session.activeSetId);
    expect(benchSets(back)).toEqual(benchSets(a));
  });

  it('the current exercise (Ben jumped to it, nothing logged) goes to the top with Do first and stays current; Move to end hands over', async () => {
    const s = (await h.launch()).services;
    const gymId = await setUpGym(h, s);
    const { sessionId, a: a0 } = await benchDone(s, gymId);
    const lat = a0.sets.find((x) => x.sessionExerciseId === rowOf(a0, 'Lat pulldown') && x.status === 'pending');
    if (!lat) throw new Error('no Lat set');
    const a = await send(s, sessionId, { type: 'set_active_set', at: h.now(), opId: h.ids(), setId: lat.id, expectedVersion: a0.session.version });
    expect(currentName(a)).toBe('Lat pulldown');
    expect(roundMoves(a, rowOf(a, 'Lat pulldown')).first).toBe(true);

    const m = jumpRoundCommand(a, rowOf(a, 'Lat pulldown'), 'do_first', { opId: h.ids(), at: h.now() });
    if (!m.ok) throw new Error(m.reason);
    const first = await send(s, sessionId, m.command);
    expect(names(first)).toEqual(['Bench press', 'Lat pulldown', 'Incline dumbbell press']);
    expect(first.session.activeSetId).toBe(lat.id);
    expect(benchSets(first)).toEqual(benchSets(a));

    const end = jumpRoundCommand(first, rowOf(first, 'Lat pulldown'), 'to_end', { opId: h.ids(), at: h.now() });
    if (!end.ok) throw new Error(end.reason);
    const last = await send(s, sessionId, end.command);
    expect(names(last)).toEqual(['Bench press', 'Incline dumbbell press', 'Lat pulldown']);
    expect(currentName(last)).toBe('Incline dumbbell press');
    expect(benchSets(last)).toEqual(benchSets(a));
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dropRoundCommand, jumpRoundCommand, roundJumps, sessionRounds } from '@fizz/domain';
import type { SessionAggregate, SessionCommand } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, 31 Oct) `Do next`, `Move to end` and the Workout sheet's drag, on real SQLite through the
 * workout service as the screen sends them: today's remaining exercises only, a superset as one block,
 * done sets byte-identical (rule 2), one opId each (a retry changes nothing), stale versions refused
 * (rule 5), and Undo after a relaunch (restart recovery).
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
const done = (a: SessionAggregate) => a.sets.filter((s) => s.status === 'completed');

/** Bench press (one set logged, current), Incline dumbbell press, then Lat pulldown + Seated cable row as a superset. */
async function pullDay(s: AppServices, gymId: string): Promise<{ sessionId: string; a: SessionAggregate }> {
  const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  let a = started.aggregate;
  for (const name of ['Bench press', 'Incline dumbbell press', 'Lat pulldown', 'Seated cable row']) {
    const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
    if (!pick) throw new Error(`no ${name}`);
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    a = added.aggregate;
    const ex = a.exercises.at(-1);
    if (!ex) throw new Error('no row');
    while (a.sets.filter((x) => x.sessionExerciseId === ex.id && x.status === 'pending').length < 2) {
      const r = await s.workout.dispatch(sessionId, { type: 'add_set', at: h.now(), opId: h.ids(), sessionExerciseId: ex.id, newSetId: h.ids(), setType: null });
      if (!r.ok) throw new Error(r.error.message);
      a = r.aggregate;
    }
  }
  const link = await s.workout.linkSuperset({ sessionId, sessionExerciseId: rowOf(a, 'Lat pulldown'), withSessionExerciseId: rowOf(a, 'Seated cable row'), expectedVersion: a.session.version, opId: h.ids() });
  if (!link.ok) throw new Error(link.error.message);
  a = link.aggregate;
  const bench = a.sets.filter((x) => x.sessionExerciseId === rowOf(a, 'Bench press')).sort((x, y) => x.index - y.index)[0];
  if (!bench) throw new Error('no bench set');
  h.clockMs += 60_000;
  const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${bench.id}:0`, setId: bench.id, values: { load: { value: 80, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  return { sessionId, a: logged.aggregate };
}

async function send(s: AppServices, sessionId: string, c: SessionCommand): Promise<SessionAggregate> {
  const r = await s.workout.dispatch(sessionId, c);
  if (!r.ok) throw new Error(r.error.message);
  return r.aggregate;
}

describe('Do next / Move to end / drag on the stored workout (Ben, 31 Oct)', () => {
  it('Do next carries the superset as one block straight after the current exercise; done sets untouched; Undo after a relaunch', async () => {
    const s = (await h.launch()).services;
    const gymId = await setUpGym(h, s);
    const { sessionId, a } = await pullDay(s, gymId);
    expect(names(a)).toEqual(['Bench press', 'Incline dumbbell press', 'Lat pulldown+Seated cable row']);
    // The current exercise offers neither; the superset is offered Do next, Incline is offered Move to end.
    expect(roundJumps(a, rowOf(a, 'Bench press'))).toEqual({ doNext: false, toEnd: false });
    expect(roundJumps(a, rowOf(a, 'Seated cable row'))).toEqual({ doNext: true, toEnd: false });
    const opId = h.ids();
    const m = jumpRoundCommand(a, rowOf(a, 'Seated cable row'), 'do_next', { opId, at: h.now() });
    if (!m.ok) throw new Error(m.reason);
    const after = await send(s, sessionId, m.command);
    expect(names(after)).toEqual(['Bench press', 'Lat pulldown+Seated cable row', 'Incline dumbbell press']);
    expect(done(after)).toEqual(done(a));
    expect(after.session.activeSetId).toBe(a.session.activeSetId);
    // Stored: a relaunch reads the new order, and Undo from there puts the old one back.
    const s2 = (await h.launch()).services;
    const stored = await s2.workout.load(sessionId);
    expect(names(stored?.aggregate as SessionAggregate)).toEqual(names(after));
    const u = await s2.workout.undoOp({ sessionId, targetOpId: opId });
    expect(u.ok).toBe(true);
    const back = (await s2.workout.load(sessionId))?.aggregate as SessionAggregate;
    expect(names(back)).toEqual(names(a));
    expect(done(back)).toEqual(done(a));
  });

  it('Move to end: a retry with the same opId changes nothing; one worked out on an older version is refused', async () => {
    const s = (await h.launch()).services;
    const gymId = await setUpGym(h, s);
    const { sessionId, a } = await pullDay(s, gymId);
    const m = jumpRoundCommand(a, rowOf(a, 'Incline dumbbell press'), 'to_end', { opId: h.ids(), at: h.now() });
    if (!m.ok) throw new Error(m.reason);
    const once = await send(s, sessionId, m.command);
    expect(names(once)).toEqual(['Bench press', 'Lat pulldown+Seated cable row', 'Incline dumbbell press']);
    const again = await s.workout.dispatch(sessionId, m.command);
    expect(again.ok && again.duplicate).toBe(true);
    expect(again.ok ? names(again.aggregate) : []).toEqual(names(once));
    expect(again.ok ? again.aggregate.session.version : -1).toBe(once.session.version);
    // Built on the version before the move (a second tap from a stale screen): refused, never applied to the newer state.
    const stale = jumpRoundCommand(a, rowOf(a, 'Lat pulldown'), 'do_next', { opId: h.ids(), at: h.now() });
    if (!stale.ok) throw new Error(stale.reason);
    const refused = await s.workout.dispatch(sessionId, stale.command);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error.code).toBe('stale_version');
    expect(names((await s.workout.load(sessionId))?.aggregate as SessionAggregate)).toEqual(names(once));
  });

  it('the Workout sheet drag: the superset moves as one, never above the started exercise; Undo', async () => {
    const s = (await h.launch()).services;
    const gymId = await setUpGym(h, s);
    const { sessionId, a } = await pullDay(s, gymId);
    const lat = rowOf(a, 'Lat pulldown');
    expect(dropRoundCommand(a, lat, rowOf(a, 'Bench press'), 'before', { opId: 'probe', at: h.now() })).toBeNull();
    const opId = h.ids();
    const c = dropRoundCommand(a, lat, rowOf(a, 'Incline dumbbell press'), 'before', { opId, at: h.now() });
    if (c === null) throw new Error('no drop');
    const after = await send(s, sessionId, c);
    expect(names(after)).toEqual(['Bench press', 'Lat pulldown+Seated cable row', 'Incline dumbbell press']);
    const group = after.exercises.find((e) => e.id === lat)?.supersetGroup;
    expect(group).not.toBeNull();
    expect(after.exercises.find((e) => e.exerciseName === 'Seated cable row')?.supersetGroup).toBe(group);
    expect(done(after)).toEqual(done(a));
    const u = await s.workout.undoOp({ sessionId, targetOpId: opId });
    expect(u.ok).toBe(true);
    expect(names((await s.workout.load(sessionId))?.aggregate as SessionAggregate)).toEqual(names(a));
  });
});

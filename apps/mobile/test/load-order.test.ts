import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { apply, at, HANG, setsFor, startFixture } from '@fizz/domain/testing';

import type { ActiveWorkoutData } from '../src/services/workout-services';
import { newerWorkoutData, withCommandResult } from '../src/workout/load-order';
import { createHarness, type Harness } from './harness';

/**
 * A reload that read the workout before a log was saved must never put the
 * older workout back on screen (the set showing unsaved, its rest gone).
 * Through the app services on real SQLite, in the order the race resolves.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-10T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function benchReady() {
  const { services: s } = await h.launch();
  await s.setup.saveUnits('kg');
  const gym = await s.setup.useTypicalGym();
  await s.setup.complete();
  const started = await s.workout.start({ gymId: gym.ok ? (gym.gymId ?? '') : '', opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, 'Bench press')).find((p) => p.exercise.name === 'Bench press');
  const added = await s.workout.addExercise({ sessionId, exerciseId: pick?.exercise.id ?? '', equipmentId: pick?.equipment[0]?.id ?? null, opId: 'add-1' });
  if (!added.ok) throw new Error(added.error.message);
  const set = added.aggregate.sets.sort((a, b) => a.index - b.index)[0];
  if (!set) throw new Error('no set');
  return { s, sessionId, setId: set.id };
}

describe('newerWorkoutData: a slow reload never overwrites a newer write', () => {
  it('the reload read before the log resolves last: the logged set and its rest stay on screen', async () => {
    const { s, sessionId, setId } = await benchReady();
    // AppState `active` starts a reload; it reads the workout before the log is saved.
    const stale = await s.workout.load();
    if (!stale) throw new Error('no workout');
    h.clockMs += 30_000;
    const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${setId}:0`, setId, values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 5, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
    // run() adopts the committed state first, then the slow reload resolves.
    let shown: ActiveWorkoutData | null | 'loading' = 'loading';
    shown = newerWorkoutData(shown, stale);
    const committed: ActiveWorkoutData = { ...stale, aggregate: r.aggregate };
    shown = newerWorkoutData(shown, committed);
    shown = newerWorkoutData(shown, stale);
    expect(shown).toEqual(committed);
    if (shown === 'loading' || shown === null) throw new Error('nothing shown');
    expect(shown.aggregate.sets.find((x) => x.id === setId)?.status).toBe('completed');
    expect(shown.aggregate.restTimer?.status).toBe('running');
    // A reload that read after the log is adopted (it carries fresh history, pain flags, names).
    const fresh = await s.workout.load();
    expect(newerWorkoutData(shown, fresh)).toBe(fresh);
  });

  it('pause with no rest running: a read from before the pause never shows the workout unpaused', async () => {
    const { s, sessionId } = await benchReady();
    const stale = await s.workout.load();
    if (!stale) throw new Error('no workout');
    expect(stale.aggregate.restTimer).toBeNull();
    const r = await s.workout.dispatch(sessionId, { type: 'pause', at: h.now(), opId: 'pause-1' });
    if (!r.ok) throw new Error(r.error.message);
    // Pause changes neither the workout version nor a rest timer; only the revision.
    expect(r.aggregate.session.version).toBe(stale.aggregate.session.version);
    expect(r.aggregate.revision).toBeGreaterThan(stale.aggregate.revision);
    let shown = withCommandResult(stale, stale, r.aggregate);
    shown = newerWorkoutData(shown, stale);
    if (shown === 'loading' || shown === null) throw new Error('nothing shown');
    expect(shown.aggregate.session.pause).not.toBeNull();
    // Resume, then the same stale read: still resumed and newer.
    const resumed = await s.workout.dispatch(sessionId, { type: 'resume', at: h.now(), opId: 'resume-1' });
    if (!resumed.ok) throw new Error(resumed.error.message);
    shown = newerWorkoutData(withCommandResult(shown, stale, resumed.aggregate), stale);
    if (shown === 'loading' || shown === null) throw new Error('nothing shown');
    expect(shown.aggregate.session.pause).toBeNull();
    expect(shown.aggregate.revision).toBe(resumed.aggregate.revision);
    // A read after both is adopted, and matches what the command result showed.
    const fresh = await s.workout.load();
    if (!fresh) throw new Error('no workout');
    expect(fresh.aggregate.revision).toBe(resumed.aggregate.revision);
    expect(newerWorkoutData(shown, fresh)).toBe(fresh);
  });

  it('start and stop of a work timer on the active set: a read from before each never shows the old timer state', () => {
    // Timed exercises aren't in the app picker yet, so this runs on the domain fixture.
    const { state } = startFixture();
    const hang = setsFor(state, HANG)[0];
    if (!hang) throw new Error('fixture');
    const active = apply(state, { type: 'set_active_set', at: at(0), opId: 'sa', setId: hang.id, expectedVersion: 1 });
    const beforeStart = { aggregate: active };
    const started = apply(active, { type: 'start_work_interval', at: at(10), opId: 'w', setId: hang.id, durationS: 45 });
    expect(started.session.version).toBe(active.session.version);
    let shown = newerWorkoutData(withCommandResult(beforeStart, beforeStart, started), beforeStart);
    if (shown === 'loading' || shown === null) throw new Error('nothing shown');
    expect(shown.aggregate.workInterval?.status).toBe('running');

    const beforeStop = { aggregate: started };
    const stopped = apply(started, { type: 'stop_work_interval', at: at(20), opId: 's', setId: hang.id });
    expect(stopped.session.version).toBe(started.session.version);
    shown = newerWorkoutData(withCommandResult(shown, beforeStop, stopped), beforeStop);
    if (shown === 'loading' || shown === null) throw new Error('nothing shown');
    expect(shown.aggregate.workInterval?.status).toBe('stopped');
    // Both stale reads, in either order, still lose.
    expect(newerWorkoutData(newerWorkoutData(shown, beforeStart), beforeStop)).toEqual(shown);
  });

  it('a rejected stale read still brings its fresh side data (pain flags, history, names)', async () => {
    const { s, sessionId } = await benchReady();
    const before = await s.workout.load();
    if (!before) throw new Error('no workout');
    const r = await s.workout.dispatch(sessionId, { type: 'pause', at: h.now(), opId: 'pause-1' });
    if (!r.ok) throw new Error(r.error.message);
    const shown = withCommandResult(before, before, r.aggregate);
    // A reload read the workout before the pause, but its side data is newer (a pain flag was just saved).
    const staleWithNewFlags: ActiveWorkoutData = { ...before, gymName: 'Renamed gym' };
    const merged = newerWorkoutData(shown, staleWithNewFlags);
    if (merged === 'loading' || merged === null) throw new Error('nothing shown');
    expect(merged.aggregate).toBe(r.aggregate);
    expect(merged.gymName).toBe('Renamed gym');
  });

  it('a command result merges into what is on screen now, not the snapshot it was issued from', async () => {
    const { s, sessionId } = await benchReady();
    const snapshot = await s.workout.load();
    if (!snapshot) throw new Error('no workout');
    const onScreen: ActiveWorkoutData = { ...snapshot, gymName: 'Newer name' };
    const r = await s.workout.dispatch(sessionId, { type: 'pause', at: h.now(), opId: 'pause-1' });
    if (!r.ok) throw new Error(r.error.message);
    const shown = withCommandResult(onScreen, snapshot, r.aggregate);
    if (shown === 'loading' || shown === null) throw new Error('nothing shown');
    expect(shown.aggregate).toBe(r.aggregate);
    expect(shown.gymName).toBe('Newer name');
    // A late result older than what's shown never replaces it.
    expect(withCommandResult(shown, snapshot, snapshot.aggregate)).toEqual(shown);
    // Nothing of this workout shown: the snapshot it was issued from carries the side data.
    expect(withCommandResult('loading', snapshot, r.aggregate)).toEqual({ ...snapshot, aggregate: r.aggregate });
  });

  it('the foreground tick: an older read of the same rest is ignored; a newer one is adopted', async () => {
    const { s, sessionId, setId } = await benchReady();
    const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${setId}:0`, setId, values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 5, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
    const before = await s.workout.load();
    if (!before?.aggregate.restTimer) throw new Error('no rest');
    // The foreground tick persists the expiry: same workout version, newer timer version.
    h.clockMs += 10 * 60_000;
    const ticked = await s.workout.dispatch(sessionId, { type: 'tick', at: h.now() });
    if (!ticked.ok) throw new Error(ticked.error.message);
    const after: ActiveWorkoutData = { ...before, aggregate: ticked.aggregate };
    expect(after.aggregate.session.version).toBe(before.aggregate.session.version);
    expect((after.aggregate.restTimer?.version ?? 0) > before.aggregate.restTimer.version).toBe(true);
    expect(newerWorkoutData(after, before)).toEqual(after);
    expect(newerWorkoutData(before, after)).toBe(after);
  });

  it('another workout, no workout, or nothing shown yet: the new read is adopted', async () => {
    const { s } = await benchReady();
    const d = await s.workout.load();
    if (!d) throw new Error('no workout');
    const other: ActiveWorkoutData = { ...d, aggregate: { ...d.aggregate, session: { ...d.aggregate.session, id: 'other', version: 1 } } };
    expect(newerWorkoutData(d, other)).toBe(other);
    expect(newerWorkoutData(d, null)).toBeNull();
    expect(newerWorkoutData(null, d)).toBe(d);
    expect(newerWorkoutData('loading', d)).toBe(d);
  });

  it('the workout screen sets its data only through the ordering guard (tripwire; the behaviour is tested above)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'screens', 'workout', 'WorkoutScreen.tsx'), 'utf8');
    const calls = [...src.matchAll(/setData\(/g)].map((m) => src.slice(m.index, m.index + 200).replace(/\s+/g, ' '));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => !/^setData\(\(\w+\) => (\(.*\? \w+ : )?(newerWorkoutData|withCommandResult)\(/.test(c))).toEqual([]);
  });
});

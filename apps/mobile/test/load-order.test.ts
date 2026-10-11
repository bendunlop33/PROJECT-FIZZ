import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActiveWorkoutData } from '../src/services/workout-services';
import { newerWorkoutData } from '../src/workout/load-order';
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
    expect(shown).toBe(committed);
    if (shown === 'loading' || shown === null) throw new Error('nothing shown');
    expect(shown.aggregate.sets.find((x) => x.id === setId)?.status).toBe('completed');
    expect(shown.aggregate.restTimer?.status).toBe('running');
    // A reload that read after the log is adopted (it carries fresh history, pain flags, names).
    const fresh = await s.workout.load();
    expect(newerWorkoutData(shown, fresh)).toBe(fresh);
  });

  it('same version: an older read of the same rest timer is ignored; a newer one is adopted', async () => {
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
    expect(newerWorkoutData(after, before)).toBe(after);
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

  it('the workout screen sets its data only through the ordering guard', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'screens', 'workout', 'WorkoutScreen.tsx'), 'utf8');
    const calls = [...src.matchAll(/setData\(([^\n]*)/g)].map((m) => m[1] ?? '');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => !c.startsWith('(cur) =>') || !c.includes('newerWorkoutData(cur, '))).toEqual([]);
    // A repeated log (same operation) shows the saved state without a second toast or haptic.
    expect(src).toMatch(/if \(r\.duplicate\) \{\n\s+setEdits\(null\);\n\s+return;/);
  });
});

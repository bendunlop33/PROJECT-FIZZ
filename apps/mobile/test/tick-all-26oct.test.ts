import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tickAllDoneText, tickAllPlannedSets, toIso } from '@fizz/domain';

import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * (Ben, 26 Oct; log-past-workout Q-PL2) `Tick all as planned` through the app's services on real SQLite: a past log
 * started from a saved workout, every planned set ticked as planned in one versioned write that survives a
 * force-close, a retry that writes nothing, one-tap Undo, and nothing offered in a live workout.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('Tick all as planned (app services, real SQLite)', () => {
  it('a past log from a saved workout: one write ticks every planned set as planned; retry, force-close, Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }] },
    ]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1', addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);

    // A live workout from the same routine is never offered it.
    h.clockMs += DAY;
    const pastStart = { utc: toIso(h.clockMs - DAY / 2), tz: TZ };
    const started = await s.workout.start({ gymId, opId: 'past-1', checkIn: null, routineOf: saved.routine.id, pastStart });
    if (!started.ok) throw new Error(started.error.message);
    const sid = started.aggregate.session.id;
    expect(started.aggregate.session.pastLog).toBeDefined();
    const plan = tickAllPlannedSets(started.aggregate);
    expect(plan.length).toBe(started.aggregate.sets.filter((x) => x.status === 'pending').length);
    expect(plan.length).toBeGreaterThanOrEqual(3);

    const cmd = { type: 'tick_all_planned' as const, at: h.now(), opId: 'tick-1', expectedVersion: started.aggregate.session.version };
    const ticked = await s.workout.dispatch(sid, cmd);
    if (!ticked.ok) throw new Error(ticked.error.message);
    expect(ticked.aggregate.session.version).toBe(started.aggregate.session.version + 1);
    for (const p of plan) expect(ticked.aggregate.sets.find((x) => x.id === p.setId)).toMatchObject({ status: 'completed', actual: p.values });
    expect(ticked.aggregate.restTimer).toBeNull();
    expect(tickAllDoneText(ticked.aggregate, 'tick-1')).toBe(`${String(plan.length)} sets ticked`);
    // A retry (double tap, relaunch) writes nothing.
    expect(await s.workout.dispatch(sid, { ...cmd, at: h.now() })).toMatchObject({ ok: true, duplicate: true });
    // A stale screen is refused (rule 5).
    const stale = await s.workout.dispatch(sid, { ...cmd, opId: 'tick-2' });
    expect(stale.ok ? null : stale.error.code).toBe('stale_version');

    // Force-close: it comes back as saved.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const back = (await s2.workout.load(sid))?.aggregate;
    if (!back) throw new Error('load');
    expect(back.sets.filter((x) => x.status === 'completed').map((x) => x.id).sort()).toEqual(plan.map((p) => p.setId).sort());
    const one = back.sets.find((x) => x.id === plan[0]?.setId);
    // Undo after a relaunch, before any change: every ticked set back to not done.
    const undone = await s2.workout.dispatch(sid, { type: 'undo_op', at: s2.now(), opId: 'undo-1', targetOpId: 'tick-1' });
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.aggregate.sets.filter((x) => plan.some((p) => p.setId === x.id)).every((x) => x.status === 'pending' && x.actual === null)).toBe(true);
    // Tick again (a new intent); each set stays editable: a correction lands as Ben's own, and Undo is then out of date.
    const again = await s2.workout.dispatch(sid, { type: 'tick_all_planned', at: s2.now(), opId: 'tick-3', expectedVersion: undone.aggregate.session.version });
    if (!again.ok) throw new Error(again.error.message);
    const set = again.aggregate.sets.find((x) => x.id === one?.id);
    const fixed = await s2.workout.correctSet({ sessionId: sid, setId: set?.id ?? '', expectedSetVersion: set?.version ?? 0, patch: { reps: 7 }, opId: 'fix-1' });
    expect(fixed.ok).toBe(true);
    const late = await s2.workout.dispatch(sid, { type: 'undo_op', at: s2.now(), opId: 'undo-2', targetOpId: 'tick-3' });
    expect(late.ok ? null : late.error.code).toBe('stale_version');
    const kept = (await s2.workout.load(sid))?.aggregate;
    expect(kept?.sets.find((x) => x.id === one?.id)?.actual?.reps).toBe(7);
    expect(kept?.sets.filter((x) => x.status === 'completed')).toHaveLength(plan.length);
  });

  it('never in a live workout, nor in a past log started empty', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-1', addToRotation: true });
    if (!saved.ok) throw new Error(saved.message);
    h.clockMs += DAY;
    const live = await s.workout.start({ gymId, opId: 'live-1', checkIn: null, routineOf: saved.routine.id });
    if (!live.ok) throw new Error(live.error.message);
    expect(tickAllPlannedSets(live.aggregate)).toEqual([]);
    const refused = await s.workout.dispatch(live.aggregate.session.id, { type: 'tick_all_planned', at: h.now(), opId: 'tick-live', expectedVersion: live.aggregate.session.version });
    expect(refused.ok).toBe(false);
    expect((await s.workout.load(live.aggregate.session.id))?.aggregate.sets.some((x) => x.status === 'completed')).toBe(false);
  });
});

describe('the past log shows the button (source check)', () => {
  it('WorkoutScreen offers `Tick all as planned` only when the domain lists sets, and its toast has Undo', () => {
    const text = readFileSync(join(import.meta.dirname, '..', 'src', 'screens', 'workout', 'WorkoutScreen.tsx'), 'utf8');
    expect(text).toContain('const tickAll = tickAllPlannedSets(loaded.aggregate);');
    expect(text).toMatch(/tickAll\.length > 0 \? \(/);
    expect(text).toContain("type: 'tick_all_planned'");
    expect(text).toContain("type: 'undo_op', at: services.now(), opId: newUuid(), targetOpId: opId");
  });
});

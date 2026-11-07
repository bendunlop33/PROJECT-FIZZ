import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gymRouteIds, isLoadAchievable } from '@fizz/domain';

import { switchedNowToast } from '../src/workout/gym-switch-card';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 7 Nov; ADR 0041) "If I change gym location mid go it should apply to everything." Picking a gym in the
 * workout moves the whole workout there at once (he asked: rule 3), with one Undo. Real SQLite files, force-close.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

async function setUp() {
  const { services: s } = await h.launch();
  const mainId = await setUpGym(h, s);
  const hotelId = h.ids();
  expect(await s.setup.saveGym({ gymId: hotelId, name: 'Battersea', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).toEqual({ ok: true });
  await logWorkout(h, s, mainId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }, { load: 32.5, reps: 8 }, { load: 32.5, reps: 8 }] },
  ]);
  h.clockMs += 2 * 86_400_000;
  const started = await s.workout.start({ gymId: mainId, opId: 'today', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  for (const name of ['Bench press', 'Dumbbell bench press']) {
    const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
    if (!pick) throw new Error(name);
    const r = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  // Ben was at Battersea all along: bench set 1, and dumbbell bench set 1 with Battersea's 22.5s.
  const data = await s.workout.load(sessionId);
  if (!data) throw new Error('no workout');
  const rowOf = (name: string) => data.aggregate.exercises.find((e) => e.exerciseName === name);
  const firstPending = (name: string) => data.aggregate.sets.filter((x) => x.sessionExerciseId === rowOf(name)?.id && x.status === 'pending').sort((a, b) => a.index - b.index)[0];
  const log = async (setId: string, load: number, reps: number, convention: 'total' | 'per_hand') => {
    h.clockMs += 90_000;
    const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: h.ids(), setId, values: { load: { value: load, unit: 'kg', convention }, reps, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  };
  await log(firstPending('Bench press')?.id ?? '', 100, 5, 'total');
  await log(firstPending('Dumbbell bench press')?.id ?? '', 22.5, 8, 'per_hand');
  return { s, mainId, hotelId, sessionId };
}

describe('a gym change applies to the whole workout (Ben, 7 Nov)', () => {
  it('switchNow: done values kept, their gym follows, every pending set fitted; toast counts; idempotent; survives a force-close; Undo restores', async () => {
    const { s, mainId, hotelId, sessionId } = await setUp();
    const before = await s.workout.load(sessionId);
    if (!before) throw new Error('no workout');

    const r = await s.gymSwitch.switchNow(sessionId, hotelId, 'pick-battersea');
    if (!r.ok) throw new Error(r.message);
    expect(r.gymName).toBe('Battersea');
    expect(r.fitted).toBeGreaterThan(0);
    expect(switchedNowToast(r.gymName, r.fitted)).toBe(`At Battersea · ${String(r.fitted)} ${r.fitted === 1 ? 'set' : 'sets'} fitted`);
    const after = r.outcome.aggregate;
    expect(after.session.gymId).toBe(hotelId);
    expect(gymRouteIds(after.session)).toEqual([hotelId]);

    // Done sets: values exactly as logged (rule 2).
    for (const d of before.aggregate.sets.filter((x) => x.status === 'completed')) {
      const now = after.sets.find((x) => x.id === d.id);
      expect(now?.actual).toEqual(d.actual);
      expect(now?.version).toBe(d.version);
    }
    // Dumbbell bench: one row, now on Battersea's dumbbells, its done set with it.
    const hotelEq = await s.yourData.equipment(hotelId);
    const db = after.exercises.filter((e) => e.exerciseName === 'Dumbbell bench press');
    expect(db).toHaveLength(1);
    expect(hotelEq.map((e) => e.id)).toContain(db[0]?.equipmentId);
    // Every pending load is achievable on Battersea's kit (rule 4).
    for (const p of after.sets.filter((x) => x.status === 'pending' && x.planned.load !== null)) {
      const row = after.exercises.find((e) => e.id === p.sessionExerciseId);
      const eq = hotelEq.find((e) => e.id === row?.equipmentId);
      expect(eq).toBeDefined();
      if (eq && p.planned.load) expect(isLoadAchievable(p.planned.load, eq)).toBe(true);
    }
    // The workout screen: no other gym named on any set.
    const v = s.workout.view(await s.workout.load(sessionId).then((d) => { if (!d) throw new Error('gone'); return d; }), h.clockMs, null);
    expect(v.focus?.rows.every((row) => row.gymCaption === null)).toBe(true);

    // Same tap again (double tap, retry): the same switch, once.
    const again = await s.gymSwitch.switchNow(sessionId, hotelId, 'pick-battersea');
    expect(again).toMatchObject({ ok: true, fitted: r.fitted, actionId: r.actionId });
    expect((await s.workout.load(sessionId))?.aggregate.session.gymChanges).toHaveLength(1);

    // Force-close and relaunch: still at Battersea; Undo (the toast's) puts everything back.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const reloaded = await s2.workout.load(sessionId);
    expect(reloaded?.aggregate.session.gymId).toBe(hotelId);
    expect(reloaded?.gymName).toBe('Battersea');
    const undone = await s2.gymSwitch.undo(sessionId, `undo-gym:${r.actionId}`);
    if (!undone.ok) throw new Error(undone.message);
    expect(undone.gymName).toBe('Main Gym');
    const u = undone.outcome.aggregate;
    expect(u.session.gymId).toBe(mainId);
    for (const x of before.aggregate.sets) expect({ ...u.sets.find((y) => y.id === x.id), version: 0 }).toEqual({ ...x, version: 0 });
    expect(u.exercises.slice(0, before.aggregate.exercises.length)).toEqual(before.aggregate.exercises);
  });

  it('the workout’s own gym is refused with a reason; nothing changes', async () => {
    const { s, mainId, sessionId } = await setUp();
    const same = await s.gymSwitch.switchNow(sessionId, mainId, 'same');
    expect(same).toEqual({ ok: false, message: 'Already at Main Gym.' });
    expect((await s.workout.load(sessionId))?.aggregate.session.gymChanges ?? []).toHaveLength(0);
  });

  it('copy', () => {
    expect(switchedNowToast('Battersea', 0)).toBe('At Battersea');
    expect(switchedNowToast('Battersea', 1)).toBe('At Battersea · 1 set fitted');
    expect(switchedNowToast('Battersea', 4)).toBe('At Battersea · 4 sets fitted');
  });
});

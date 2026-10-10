import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isProposalStale, NBSP } from '@fizz/domain';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Mid-workout gym switch through the app's services on real SQLite files
 * (gym-switch.md §7): propose, Switch, force-close, Undo, refused Undo,
 * Add set and the picker at the new gym. Everything is local.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

async function setUp() {
  const { services: s } = await h.launch();
  const mainId = await setUpGym(h, s);
  const hotelId = h.ids();
  expect(await s.setup.saveGym({ gymId: hotelId, name: 'Hotel · Lisbon', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).toEqual({ ok: true });
  // History, so today's exercises get targets from the built-in rule.
  await logWorkout(h, s, mainId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }] },
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
  // Log bench set 1 at Main Gym.
  const data = await s.workout.load(sessionId);
  if (!data) throw new Error('no workout');
  const v = s.workout.view(data, h.clockMs, null);
  if (!v.focus) throw new Error('no focus');
  h.clockMs += 60_000;
  const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus.opId, setId: v.focus.setId, values: v.focus.logValues, restTimerId: h.ids() });
  if (!logged.ok) throw new Error(logged.error.message);
  return { s, mainId, hotelId, sessionId };
}

describe('gym switch through the services', () => {
  it('3 steps: list gyms, propose (nothing changes), Switch; done sets untouched; the result survives a force-close', async () => {
    const { s, mainId, hotelId, sessionId } = await setUp();
    expect((await s.gymSwitch.gyms(sessionId)).map((g) => [g.name, g.current])).toEqual([
      ['Main Gym', true],
      ['Hotel · Lisbon', false],
    ]);
    const before = await s.workout.load(sessionId);
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p || !before) throw new Error('no proposal');
    expect(p.card.title).toBe('Switch to Hotel · Lisbon');
    expect(p.card.notChanged).toEqual(['1 logged set stays as it is.']);
    expect(p.card.lines.map((l) => [l.exerciseName, l.after === null ? 'kept' : 'dropped'])).toEqual([
      ['Bench press', 'dropped'],
      ['Dumbbell bench press', 'kept'],
    ]);
    expect(p.card.lines[1]?.notes.map((n) => n.text)).toEqual(['Capped: the most here is 25 kg each.']);
    // Proposing changed nothing.
    expect(await s.workout.load(sessionId)).toEqual(before);

    const applied = await s.gymSwitch.apply(p, 'switch-1');
    if (!applied.ok) throw new Error(applied.error.message);
    const again = await s.gymSwitch.apply(p, 'switch-1');
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(applied.aggregate.session.gymId).toBe(hotelId);
    const done = before.aggregate.sets.filter((x) => x.status === 'completed');
    for (const d of done) expect(applied.aggregate.sets.find((x) => x.id === d.id)).toEqual(d);

    // Force-close and relaunch: the switch is all there, and the notes read the same.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const data = await s2.workout.load(sessionId);
    if (!data) throw new Error('no workout');
    expect(data.aggregate.session.gymId).toBe(hotelId);
    expect(data.gymName).toBe('Hotel · Lisbon');
    const v = s2.workout.view(data, h.clockMs, null);
    expect(v.focus?.exerciseName).toBe('Bench press');
    expect(v.focus?.snapNote?.text).toBe('No Barbell and plates at Hotel · Lisbon. Plan was 100 kg.');
    expect(v.focus?.rows.map((r) => [r.status, r.gymCaption, r.partStart])).toEqual([
      ['done', 'Main Gym', null],
      ['active', null, 'At Hotel · Lisbon'],
    ]);
    expect(v.primary.label).toBe('Enter load');
    // The picker and Add exercise offer only Hotel's items now.
    const picks = await s2.workout.pickerExercises(sessionId, 'Lat pulldown');
    expect(picks.find((x) => x.exercise.name === 'Lat pulldown')?.equipment).toEqual([]);
    const dbPicks = await s2.workout.pickerExercises(sessionId, 'Dumbbell curl');
    expect(dbPicks[0]?.equipment.map((e) => e.name)).toEqual((await s2.yourData.equipment(hotelId)).filter((e) => e.kind === 'dumbbells').map((e) => e.name));
    expect(mainId).not.toBe(hotelId);
  });

  it('Undo restores Main Gym exactly; after a set is logged at Hotel it is refused and a Switch back card is offered', async () => {
    const { s, mainId, hotelId, sessionId } = await setUp();
    const before = await s.workout.load(sessionId);
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p || !before) throw new Error('no proposal');
    await s.gymSwitch.apply(p, 'switch-a');
    const undone = await s.gymSwitch.undo(sessionId, 'undo-a');
    if (!undone.ok) throw new Error(undone.message);
    expect(undone.gymName).toBe('Main Gym');
    const after = undone.outcome.aggregate;
    expect(after.session.gymId).toBe(mainId);
    for (const x of before.aggregate.sets) expect({ ...after.sets.find((y) => y.id === x.id), version: 0 }).toEqual({ ...x, version: 0 });

    // Switch again, log a set at Hotel, then Undo: refused, never a silent revert.
    const p2 = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p2) throw new Error('no proposal');
    const applied = await s.gymSwitch.apply(p2, 'switch-b');
    if (!applied.ok) throw new Error(applied.error.message);
    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('no workout');
    const v = s.workout.view(data, h.clockMs, null);
    h.clockMs += 60_000;
    await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: v.focus?.opId ?? '', setId: v.focus?.setId ?? '', values: { load: { value: 60, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(isProposalStale(p2, (await s.workout.load(sessionId))?.aggregate ?? data.aggregate)).toBe(true);
    const refused = await s.gymSwitch.undo(sessionId, 'undo-b');
    expect(refused).toMatchObject({ ok: false, message: 'Can’t undo: your workout changed since the switch.' });
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.back?.card.title).toBe('Switch back to Main Gym');
    expect(refused.back?.card.lines.find((l) => l.exerciseName === 'Dumbbell bench press')?.notes.map((n) => n.text)).toEqual(['Back to the planned load.']);
    expect((await s.workout.load(sessionId))?.aggregate.session.gymId).toBe(hotelId);
  });

  it('Add set on bench (all done at Main) goes on Hotel’s equipment with no barbell target', async () => {
    const { s, hotelId, sessionId } = await setUp();
    const data = await s.workout.load(sessionId);
    const bench = data?.aggregate.exercises.find((e) => e.exerciseName === 'Bench press');
    if (!data || !bench) throw new Error('no bench');
    // Skip the remaining bench set, so all of bench is at Main, then switch.
    await s.workout.dispatch(sessionId, { type: 'skip_exercise', at: h.now(), opId: 'skip-bench', sessionExerciseId: bench.id });
    const p = await s.gymSwitch.propose(sessionId, hotelId);
    if (!p) throw new Error('no proposal');
    await s.gymSwitch.apply(p, 'switch-c');
    const r = await s.workout.addSet({ sessionId, sessionExerciseId: bench.id, opId: 'add-1', newSetId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
    const cont = r.aggregate.exercises.find((e) => e.continuesFromId === bench.id);
    expect(cont).toMatchObject({ equipmentId: null });
    const added = r.aggregate.sets.find((x) => x.sessionExerciseId === cont?.id);
    expect(added?.planned.load).toBeNull();
    expect(added?.planned.snap).toMatchObject({ outcome: 'dropped', reason: 'not_here' });
  });

  it('Repeat preview at another gym re-checks every row without starting anything (GS10)', async () => {
    const { services: s } = await h.launch();
    const mainId = await setUpGym(h, s);
    const hotelId = h.ids();
    await s.setup.saveGym({ gymId: hotelId, name: 'Hotel · Lisbon', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') });
    const past = await logWorkout(h, s, mainId, [{ exercise: 'Dumbbell bench press', sets: [{ load: 32.5, reps: 8 }] }]);
    const atMain = await s.repeat.preview(past, mainId);
    const atHotel = await s.repeat.preview(past, hotelId);
    expect(atMain?.notes).toEqual([]);
    expect(atHotel?.notes.map((n) => plain(n.text))).toEqual(['Capped: the most here is 25 kg each. Last time 32.5 kg each.']);
    expect(await s.sessions.active()).toBeNull();
  });
});

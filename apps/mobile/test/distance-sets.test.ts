import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSetEditView, valuesText } from '@fizz/domain';

import { bundledHowToSources, howToRouteFor } from '../src/guide/how-to';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Distance sets (sled push, carries; ADR 0011) through the app's services on
 * real SQLite: the picker offers them, the card asks for metres, Log saves
 * them, Edit set corrects them, and the sled-push guide is reachable.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('distance sets end to end', () => {
  it('Sled push: picker → Enter distance → Log 40 kg × 20 m → correct to 25 m; How to opens its guide', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const started = await s.workout.start({ gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    const sled = (await s.workout.pickerExercises(sessionId, 'Sled push', { withCatalogue: true })).find((p) => p.exercise.name === 'Sled push');
    expect(sled?.exercise.measurement).toBe('distance');
    // No gym holds a sled item yet: added with no equipment, the load is what's on the sled.
    expect(sled?.equipment).toEqual([]);
    const added = await s.workout.addExercise({ sessionId, exerciseId: sled?.exercise.id ?? '', equipmentId: null, opId: 'add-sled' });
    if (!added.ok) throw new Error(added.error.message);
    const data = await s.workout.load(sessionId);
    if (!data) throw new Error('load');
    const v = s.workout.view(data, h.clockMs, null);
    expect(v.primary).toMatchObject({ kind: 'enter', field: 'distance', label: 'Enter distance' });
    expect(v.focus?.loadField?.label).toBe('Added');
    const focus = v.focus;
    if (!focus) throw new Error('focus');
    expect(howToRouteFor(focus, bundledHowToSources())).toEqual({ catalogueKey: 'sled-push', name: 'Sled push' });

    const values = { load: { value: 40, unit: 'kg' as const, convention: 'added' as const }, reps: null, durationS: null, distanceM: 20, rpe: null, rir: null };
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: focus.setId, values, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const set = logged.aggregate.sets.find((x) => x.id === focus.setId);
    expect(set?.actual).toMatchObject({ distanceM: 20 });
    expect(valuesText(set?.actual ?? values, { convention: 'added', measurement: 'distance' }).replaceAll(' ', ' ')).toBe('40 kg × 20 m');

    const edit = buildSetEditView(logged.aggregate, focus.setId, null);
    expect(edit?.distance).toMatchObject({ value: 20, up: { value: 25 } });
    const fixed = await s.workout.correctSet({ sessionId, setId: focus.setId, expectedSetVersion: set?.version ?? 0, patch: { distanceM: 25 }, opId: 'fix-1' });
    expect(fixed.ok && fixed.aggregate.sets.find((x) => x.id === focus.setId)?.actual?.distanceM).toBe(25);
  });
});

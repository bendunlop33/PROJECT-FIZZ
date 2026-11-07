import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formFromEquipment, getAchievableLoads, newEquipmentForm, type EquipmentForm } from '@fizz/domain';

import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/** The minimal gym editor through the app services (gym-editor.md §4.1, §7 checks 1, 4, 8, 18). */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe('gym editor services', () => {
  it('lists the gym with unchecked preset items; saving marks one checked; a double save is one version', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const [row] = await s.gyms.list();
    expect(row).toMatchObject({ items: 6, unchecked: 6 });
    const detail = await s.gyms.detail(gymId);
    const db = detail?.equipment.find((e) => e.equipment.kind === 'dumbbells');
    if (!db) throw new Error('no dumbbells');
    expect(db).toMatchObject({ unchecked: true, line: '2.5–40 kg each' });

    // Home rack to 30 kg, 30 missing.
    const form = { ...(formFromEquipment(db.equipment) as Extract<EquipmentForm, { kind: 'dumbbells' | 'kettlebell' }>), range: { from: 2.5, to: 32.5, step: 2.5 }, missing: [30] };
    const req = { gymId, equipmentId: db.equipment.id, expectedVersion: db.equipment.version, form };
    const [a, b] = await Promise.all([s.gyms.save(req), s.gyms.save(req)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect([a, b].filter((r) => r.ok && r.duplicate)).toHaveLength(1);
    const after = await s.gyms.item(db.equipment.id);
    expect(after?.equipment).toMatchObject({ version: 2, detailsSource: 'user' });
    expect(getAchievableLoads(after?.equipment ?? db.equipment).loads.at(-1)).toBe(32.5);
    expect((await s.gyms.list())[0]?.unchecked).toBe(5);

    // A save from an editor opened before that change is refused, never applied to newer data.
    const stale = await s.gyms.save({ ...req, form: { ...form, range: { from: 5, to: 20, step: 5 } } });
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });

    // Undo: the previous content comes back as a new version.
    if (!a.ok || !a.previous) throw new Error('no previous');
    expect(await s.gyms.undoSave(a.equipment, a.previous)).toBe(true);
    expect((await s.gyms.item(db.equipment.id))?.equipment).toMatchObject({ version: 3, detailsSource: 'preset' });
  });

  it('locks the unit once a set is logged with the item; new items work; a workout in progress keeps its snapshot', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 60, reps: 8 }] }]);
    const bar = (await s.gyms.detail(gymId))?.equipment.find((e) => e.equipment.kind === 'barbell')?.equipment;
    if (!bar) throw new Error('no bar');
    const item = await s.gyms.item(bar.id);
    expect(item?.unitLocked).toBe(true);
    const toLb = { ...formFromEquipment(bar), unit: 'lb' as const };
    expect(await s.gyms.save({ gymId, equipmentId: bar.id, expectedVersion: bar.version, form: toLb })).toMatchObject({ ok: false, reason: 'unit_locked' });

    // A workout in progress keeps the gym as it was at Start (§4.9).
    const started = await s.workout.start({ gymId, opId: 'w', checkIn: null });
    if (!started.ok) throw new Error('start');
    expect((await s.gyms.detail(gymId))?.inUseByWorkout).toBe(true);
    const fewer = { ...formFromEquipment(bar), plates: [{ mass: 20, count: 2 }] } as EquipmentForm;
    expect((await s.gyms.save({ gymId, equipmentId: bar.id, expectedVersion: bar.version, form: fewer })).ok).toBe(true);
    const snap = (await s.workout.load())?.aggregate.session.equipmentSnapshot.find((e) => e.id === bar.id);
    expect(snap).toEqual(bar);

    // Add as new: a separate item with no shared history.
    const newId = h.ids();
    const added = await s.gyms.save({ gymId, equipmentId: newId, expectedVersion: null, form: { ...newEquipmentForm('weight_stack', 'lb'), name: 'Left stack' } });
    expect(added).toMatchObject({ ok: true, equipment: { id: newId, version: 1, unit: 'lb' } });
    expect((await s.gyms.item(newId))?.unitLocked).toBe(false);
  });
});

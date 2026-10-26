import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { builderApplyOpId, makeBuilderProposal, NO_NUMBERS } from '@fizz/coach';
import { buildExercisePickerView, slotsOf, type PickerIndex } from '@fizz/domain';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * (Ben, build 403, 26 Oct) "Add 8 minute bike warm up before legs" → "Bike warm-up isn't available in your exercise
 * list", and the Add picker's search for "exercise bike" found nothing. Exercise bike is in the catalogue (cardio,
 * `erg`, available at every gym by design: `isMachineCardio`), but Your workout dropped every exercise with no builder
 * group: the coach's lists, its add check and the picker's builder scope. On real SQLite with the bundled catalogue.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-26T18:19:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`builder ${r.status}`);
};

async function legsDraft(s: AppServices): Promise<BuilderSnapshot> {
  await setUpGym(h, s);
  return opened(await s.builder.create({ ...(await s.builder.initialSetup({ dayId: 'legs' })) }, 'create-legs'));
}

const rowNames = (index: PickerIndex, query: string): string[] => buildExercisePickerView({ index, query, group: null, exclude: [], suggested: [] }).sections.flatMap((x) => x.parts.flatMap((p) => p.rows.map((r) => r.name)));

describe('Your workout coach: the bike is in reach and goes in first as 8:00', () => {
  it('the coach world lists cardio machines and its checks take them (repro: neither did)', async () => {
    const { services: s } = await h.launch();
    const snap = await legsDraft(s);
    const world = await s.builder.coachWorld(snap.draftId);
    if (world === null) throw new Error('no world');
    const bike = world.extras.otherWork?.find((c) => c.name === 'Exercise bike');
    expect(bike).toBeDefined();
    if (bike === undefined) return;
    expect(world.env.usable(bike.exerciseId)).toBe(true);
    expect(world.extras.otherWork?.map((c) => c.name)).toEqual(expect.arrayContaining(['Air bike', 'Rowing machine', 'Ski erg', 'Exercise bike']));
  });

  it('proposal → Apply → Your workout shows it first, 8:00; Undo puts it back; Start plans an 8:00 ride first', async () => {
    const { services: s } = await h.launch();
    const snap = await legsDraft(s);
    const world = await s.builder.coachWorld(snap.draftId);
    const bike = world?.extras.otherWork?.find((c) => c.name === 'Exercise bike');
    if (world === null || bike === undefined) throw new Error('no bike');
    const made = makeBuilderProposal({ id: 'bike-1', snapshot: world.snapshot, ops: [{ op: 'add', exerciseId: bike.exerciseId, afterSlotKey: null, workingSets: null, first: true, workSeconds: 480 }], words: 'Add 8 minute bike warm up before legs', check: NO_NUMBERS, env: { ...world.env, askedHeavier: false } });
    expect(made.proposal?.lines).toEqual(['Add Exercise bike · 8:00 · first']);
    expect(made.proposal?.warnings).toEqual([]);
    if (made.proposal === null) throw new Error('no proposal');
    expect(await s.builderCoach.apply(made.proposal)).toMatchObject({ kind: 'applied' });
    const read = await s.builder.read(snap.draftId);
    const first = slotsOf(read?.workout.blocks ?? [])[0];
    expect(first?.exerciseId).toBe(bike.exerciseId);
    expect(first?.rows.map((r) => [r.type, r.durationS, r.load])).toEqual([['working', 480, null]]);
    expect(read?.facts[bike.exerciseId]?.name).toBe('Exercise bike');
    // Undo (one tap) takes it out again.
    const u = await s.builder.undo(snap.draftId, builderApplyOpId('bike-1'), 'undo-bike-1');
    expect(u.status).toBe('written');
    expect(slotsOf(u.status === 'written' ? u.snapshot.workout.blocks : []).some((x) => x.exerciseId === bike.exerciseId)).toBe(false);
    // Apply again (a new ask) and Start: the session's first exercise is the ride, 8:00.
    const again = await s.builder.coachWorld(snap.draftId);
    if (again === null) throw new Error('no world');
    const p2 = makeBuilderProposal({ id: 'bike-2', snapshot: again.snapshot, ops: [{ op: 'add', exerciseId: bike.exerciseId, afterSlotKey: null, workingSets: null, first: true, workSeconds: 480 }], words: null, check: NO_NUMBERS, env: { ...again.env, askedHeavier: false } }).proposal;
    if (p2 === null) throw new Error('no proposal');
    expect(await s.builderCoach.apply(p2)).toMatchObject({ kind: 'applied' });
    const cur = await s.builder.read(snap.draftId);
    const started = await s.builder.start(snap.draftId, { opId: 'start-1', expectedVersion: cur?.version ?? 0, checkIn: null });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const agg = (await s.workout.load(started.sessionId))?.aggregate;
    const firstEx = [...(agg?.exercises ?? [])].sort((a, b) => a.order - b.order)[0];
    expect(firstEx?.exerciseId).toBe(bike.exerciseId);
    const sets = (agg?.sets ?? []).filter((x) => x.sessionExerciseId === firstEx?.id);
    expect(sets.map((x) => [x.setType, x.planned.durationS, x.planned.reps, x.planned.load])).toEqual([['working', 480, null, null]]);
  });
});

describe('Your workout Add picker: a search never misses a cardio machine', () => {
  it('Add lists cardio and finds it by name, alias and part of a name; Swap stays strength for strength', async () => {
    const { services: s } = await h.launch();
    const snap = await legsDraft(s);
    const add = await s.exercisePicker.forDraft(snap.draftId, { add: true });
    expect(rowNames(add, 'exercise bike')[0]).toBe('Exercise bike');
    expect(rowNames(add, 'bike')).toEqual(expect.arrayContaining(['Exercise bike', 'Air bike']));
    expect(rowNames(add, 'stationary')).toContain('Exercise bike');
    expect(rowNames(add, 'air bike')[0]).toBe('Air bike');
    expect(rowNames(add, 'rower')).toContain('Rowing machine');
    expect(rowNames(add, 'treadmill').length).toBeGreaterThan(0);
    expect(rowNames(add, 'ski')).toContain('Ski erg');
    // Available at every gym (no gym item needed): never tagged `Not at`.
    const bikeRow = buildExercisePickerView({ index: add, query: 'exercise bike', group: null, exclude: [], suggested: [] }).sections[0]?.parts[0]?.rows[0];
    expect(bikeRow?.notHere).toBe(false);
    // Swap: a ride never replaces a lift.
    const swap = await s.exercisePicker.forDraft(snap.draftId);
    expect(rowNames(swap, 'exercise bike')).not.toContain('Exercise bike');
  });

  it('picking it adds a timed slot (10:00) through the builder’s own write', async () => {
    const { services: s } = await h.launch();
    const snap = await legsDraft(s);
    const add = await s.exercisePicker.forDraft(snap.draftId, { add: true });
    const bike = add.entries.find((e) => e.exercise.name === 'Exercise bike');
    if (bike === undefined) throw new Error('no bike');
    const r = await s.builder.edit(snap.draftId, { kind: 'add_exercise', exerciseId: bike.exercise.id }, { opId: 'add-bike', basis: { version: snap.version } });
    const after = opened(r);
    const slot = slotsOf(after.workout.blocks).find((x) => x.exerciseId === bike.exercise.id);
    expect(slot?.rows.map((x) => [x.type, x.durationS, x.load])).toEqual([['working', 600, null]]);
  });
});

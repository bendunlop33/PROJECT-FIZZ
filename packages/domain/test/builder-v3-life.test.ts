import { describe, expect, it } from 'vitest';
import { WorkoutDraftSchema, type BuilderSetup, type DraftPlan } from '@fizz/schemas';
import { builderDraftEdit, builderDraftUndo, builderInfoOf, draftOpenedUnchanged, mixForDay, newBuilderDraft, partsLabel, ruleSetupOf, storedGroupsOf, type DraftLifeChange } from '../src/index';
import { id } from './fixtures';

/** Builder drafts' life (§4.4): idempotent op IDs, version or slot-revision staleness, Undo at the version it left. */

const at = (min: number) => ({ utc: `2026-10-20T17:${String(min).padStart(2, '0')}:00.000Z`, tz: 'Europe/London' });
const setup: BuilderSetup = { dayId: 'chest', minutes: 60, mainLiftExerciseId: id(1), supersets: true, groups: [{ parts: ['Chest'], count: 4 }], variationId: null };
const slot = (k: number, ex: number, reps = 8): DraftPlan['slots'][number] => ({
  slotKey: id(100 + k),
  exerciseId: id(ex),
  catalogueId: `ex-${String(ex)}`,
  order: k,
  main: k === 0,
  supersetGroup: null,
  setTemplates: [{ setType: 'working', reps: { min: reps, max: reps }, durationS: null, targetRpe: 8, restS: 120 }],
  rev: 1,
});
const plan: DraftPlan = { slots: [slot(0, 1), slot(1, 2)] };
const draft = () => newBuilderDraft({ id: id(900), ownerId: id(1000), opId: 'op-1', actionId: id(901), name: 'Chest · Bench', key: { planId: null, dayIndex: null, splitDayId: 'chest', mainLiftExerciseId: id(1), localDate: '2026-10-20' }, setup, plan, focus: 'chest', gymId: null, equipmentVersion: 'eq', contextHash: 'ctx', at: at(0) });
const written = (c: DraftLifeChange) => {
  if (c.kind !== 'write') throw new Error(c.kind);
  return WorkoutDraftSchema.parse(c.next);
};

describe('builder draft life (§4.4)', () => {
  it('a new draft parses; an edit bumps the version in place and keeps Undo; the same op ID again is a duplicate', () => {
    const d = WorkoutDraftSchema.parse(draft());
    const next: DraftPlan = { slots: [slot(0, 1), { ...slot(1, 2, 10), rev: 2 }] };
    const e = written(builderDraftEdit(d, { opId: 'e-1', at: at(1), basis: { version: 1 }, plan: next, setup, undoable: true }));
    expect(e.version).toBe(2);
    expect(e.versions).toHaveLength(1);
    expect(e.undo).toMatchObject({ opId: 'e-1', atVersion: 2 });
    expect(builderDraftEdit(e, { opId: 'e-1', at: at(2), basis: { version: 1 }, plan: next, setup, undoable: true }).kind).toBe('duplicate');
  });

  it('a version basis is stale once anything moved; a slot basis only when that slot moved', () => {
    const d = draft();
    const e = written(builderDraftEdit(d, { opId: 'e-1', at: at(1), basis: { version: 1 }, plan: { slots: [slot(0, 1), { ...slot(1, 2, 10), rev: 2 }] }, setup, undoable: true }));
    expect(builderDraftEdit(e, { opId: 'e-2', at: at(2), basis: { version: 1 }, plan, setup, undoable: true }).kind).toBe('stale');
    expect(builderDraftEdit(e, { opId: 'e-3', at: at(2), basis: { slots: [{ slotKey: id(100), rev: 1 }] }, plan, setup, undoable: true }).kind).toBe('write');
    expect(builderDraftEdit(e, { opId: 'e-4', at: at(2), basis: { slots: [{ slotKey: id(101), rev: 1 }] }, plan, setup, undoable: true }).kind).toBe('stale');
  });

  it('a rebuild is a new version; Undo restores both pages and only at the version it left', () => {
    const d = draft();
    const other: BuilderSetup = { ...setup, mainLiftExerciseId: id(3) };
    const r = written(builderDraftEdit(d, { opId: 'r-1', at: at(1), basis: { version: 1 }, plan: { slots: [slot(0, 3)] }, setup: other, name: 'Chest · Incline', rebuild: { actionId: id(902), focus: 'chest', gymId: null, equipmentVersion: 'eq', contextHash: 'ctx2' }, undoable: true }));
    expect(r.currentVersion).toBe(2);
    expect(r.versions.map((v) => v.status)).toEqual(['replaced', 'current']);
    const u = builderDraftUndo(r, { opId: 'u-1', undoOpId: 'r-1', at: at(2), name: 'Chest · Bench' });
    const back = written(u as DraftLifeChange);
    expect(back.currentVersion).toBe(1);
    expect(back.versions.find((v) => v.n === 1)?.request.setup).toEqual(setup);
    expect(back.name).toBe('Chest · Bench');
    expect(back.undo).toBeNull();
    expect(builderDraftUndo(back, { opId: 'u-2', undoOpId: 'r-1', at: at(3) })).toMatchObject({ kind: 'refused', reason: 'nothing' });
    // Something else after the edit: refused.
    const later = written(builderDraftEdit(r, { opId: 'e-9', at: at(2), basis: { version: r.version }, plan: { slots: [slot(0, 3, 6)] }, setup: other, undoable: false }));
    expect(builderDraftUndo(later, { opId: 'u-3', undoOpId: 'r-1', at: at(3) })).toMatchObject({ kind: 'refused', reason: 'nothing' });
  });

  it('a started or expired draft takes no edit', () => {
    const d = { ...draft(), status: 'discarded' as const };
    expect(builderDraftEdit(d, { opId: 'x', at: at(1), basis: { version: 1 }, plan, setup, undoable: true }).kind).toBe('closed');
    const old = draft();
    expect(builderDraftEdit(old, { opId: 'y', at: { utc: '2026-11-05T10:00:00.000Z', tz: 'Europe/London' }, basis: { version: 1 }, plan, setup, undoable: true }).kind).toBe('closed');
  });
});

describe('opened as it was (review batch23 S3)', () => {
  it('a draft opened as it was is unchanged until an edit; an Undo back to it is unchanged again; one opened without the mark never is', () => {
    const opened = WorkoutDraftSchema.parse(newBuilderDraft({ id: id(910), ownerId: id(1000), opId: 'op-o', actionId: id(911), name: 'Push A', key: { planId: null, dayIndex: null, splitDayId: null, mainLiftExerciseId: null, localDate: '2026-10-20' }, setup, plan, focus: 'chest', gymId: null, equipmentVersion: 'eq', contextHash: 'ctx', at: at(0), opened: true }));
    expect(draftOpenedUnchanged(opened)).toBe(true);
    const e = written(builderDraftEdit(opened, { opId: 'e-1', at: at(1), basis: { version: 1 }, plan: { slots: [slot(0, 1), { ...slot(1, 2), setTemplates: [...slot(1, 2).setTemplates, ...slot(1, 2).setTemplates], rev: 2 }] }, setup, undoable: true }));
    expect(draftOpenedUnchanged(e)).toBe(false);
    expect(draftOpenedUnchanged(written(builderDraftUndo(e, { opId: 'u-1', undoOpId: 'e-1', at: at(2) }) as DraftLifeChange))).toBe(true);
    expect(draftOpenedUnchanged(draft())).toBe(false);
  });
});

describe('Set up helpers (§2.2, §3.7)', () => {
  it('day mixes: preset days use the prototype mix; other days their parts', () => {
    expect(mixForDay('chest', [])).toEqual([{ group: 'Chest', count: 4 }, { group: 'Triceps', count: 1 }, { group: 'Abs', count: 1 }]);
    expect(mixForDay('upper-1', ['Chest', 'Back', 'Biceps', 'Core'])).toEqual([{ group: 'Chest', count: 4 }, { group: 'Back', count: 1 }, { group: 'Biceps', count: 1 }, { group: 'Abs', count: 1 }]);
    expect(partsLabel(['Chest', 'Triceps'])).toBe('Chest, triceps');
    expect(partsLabel(['Quads', 'Hamstrings', 'Calves'])).toBe('Legs');
  });
  it('stored groups (body parts) ↔ rule groups; a custom day with some leg parts keeps them', () => {
    const stored = storedGroupsOf([{ group: 'Legs', count: 3 }, { group: 'Abs', count: 1 }], ['Quads', 'Calves']);
    expect(stored).toEqual([{ parts: ['Quads', 'Calves'], count: 3 }, { parts: ['Core'], count: 1 }]);
    const r = ruleSetupOf({ ...setup, groups: stored });
    expect(r.groups).toEqual([{ group: 'Legs', count: 3 }, { group: 'Abs', count: 1 }]);
    expect(r.legParts).toEqual(['quads', 'calves']);
  });
});

describe('exercise info for the rules (§3.4, §3.5)', () => {
  const ex = (over: Record<string, unknown>) => ({ id: id(5), name: 'X', primaryMuscles: ['chest'], secondaryMuscles: ['front_delts', 'triceps', 'core'], movementPattern: 'horizontal_push', measurement: 'reps' as const, mechanic: 'compound' as const, compatibleEquipment: ['barbell'] as never, ...over });
  it('a barbell compound is heavy; rear delts are Back; quiet helpers never decide a pair', () => {
    expect(builderInfoOf(ex({}))).toMatchObject({ group: 'Chest', role: 'compound', heavy: true, barbell: true, muscles: ['chest', 'front delts', 'triceps'] });
    expect(builderInfoOf(ex({ compatibleEquipment: ['dumbbells'] }))?.heavy).toBe(false);
    expect(builderInfoOf(ex({ primaryMuscles: ['rear_delts'], mechanic: 'isolation', compatibleEquipment: ['dumbbells'] }))?.group).toBe('Back');
    expect(builderInfoOf(ex({ primaryMuscles: ['hamstrings', 'glutes'], movementPattern: 'hinge' }))?.part).toBe('hamstrings_glutes');
    expect(builderInfoOf(ex({ primaryMuscles: ['quads'], movementPattern: 'conditioning' }))).toBeNull();
  });
});

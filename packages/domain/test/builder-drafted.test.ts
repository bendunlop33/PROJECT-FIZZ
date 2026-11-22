import { describe, expect, it } from 'vitest';
import { WorkoutDraftSchema, type BuilderSetup, type DraftPlan } from '@fizz/schemas';
import { adoptChangedSlots, adoptUneditedSlots, builderDraftEdit, builderDraftUndo, currentDraftVersion, newBuilderDraft, type DraftLifeChange } from '../src/index';
import { id } from './fixtures';

/**
 * (Ben, 23 Oct; workout-builder-v3 §2.9) A builder version's drafted baseline: what was drafted before Ben's own
 * edits. His edits never move it; a coach apply and a gym change move only what they changed; Undo puts it back.
 */

const at = (min: number) => ({ utc: `2026-10-20T17:${String(min).padStart(2, '0')}:00.000Z`, tz: 'Europe/London' });
const setup: BuilderSetup = { dayId: 'chest', minutes: 60, mainLiftExerciseId: id(1), supersets: true, groups: [{ parts: ['Chest'], count: 4 }], variationId: null };
const slot = (k: number, ex: number, reps = 8, rev = 1): DraftPlan['slots'][number] => ({
  slotKey: id(100 + k),
  exerciseId: id(ex),
  catalogueId: `ex-${String(ex)}`,
  order: k,
  main: k === 0,
  supersetGroup: null,
  setTemplates: [{ setType: 'working', reps: { min: reps, max: reps }, durationS: null, targetRpe: 8, restS: 120 }],
  rev,
});
const plan: DraftPlan = { slots: [slot(0, 1), slot(1, 2), slot(2, 3)] };
const draft = () => WorkoutDraftSchema.parse(newBuilderDraft({ id: id(900), ownerId: id(1000), opId: 'op-1', actionId: id(901), name: 'Chest · Bench', key: { planId: null, dayIndex: null, splitDayId: 'chest', mainLiftExerciseId: id(1), localDate: '2026-10-20' }, setup, plan, focus: 'chest', gymId: null, equipmentVersion: 'eq', contextHash: 'ctx', at: at(0) }));
const written = (c: DraftLifeChange) => {
  if (c.kind !== 'write') throw new Error(c.kind);
  return WorkoutDraftSchema.parse(c.next);
};
const reps = (p: DraftPlan | undefined, k: number) => p?.slots.find((s) => s.slotKey === id(100 + k))?.setTemplates[0]?.reps?.min;

describe('drafted baseline on builder versions', () => {
  it('a new draft records what was drafted; Ben’s in-place edit keeps it; a rebuild starts again', () => {
    const d = draft();
    expect(currentDraftVersion(d).drafted).toEqual({ plan, minutes: 60 });
    const mine: DraftPlan = { slots: [slot(0, 1), slot(1, 2, 12, 2), slot(2, 3)] };
    const e = written(builderDraftEdit(d, { opId: 'e-1', at: at(1), basis: { version: 1 }, plan: mine, setup: { ...setup, minutes: 45 }, undoable: true }));
    expect(currentDraftVersion(e).plan).toEqual(mine);
    expect(currentDraftVersion(e).drafted).toEqual({ plan, minutes: 60 });
    const fresh: DraftPlan = { slots: [slot(0, 4)] };
    const r = written(builderDraftEdit(e, { opId: 'r-1', at: at(2), basis: { version: e.version }, plan: fresh, setup, rebuild: { actionId: id(902), focus: 'chest', gymId: null, equipmentVersion: 'eq', contextHash: 'c2' }, undoable: true }));
    expect(currentDraftVersion(r).drafted).toEqual({ plan: fresh, minutes: 60 });
  });

  it('a coach apply carries the baseline: the slot it changed takes its new state, his own edit elsewhere still shows', () => {
    const d = draft();
    // Ben: slot 1 reps 8 → 12. Coach (applied): slot 2 reps 8 → 10, a new version.
    const mine: DraftPlan = { slots: [slot(0, 1), slot(1, 2, 12, 2), slot(2, 3)] };
    const e = written(builderDraftEdit(d, { opId: 'e-1', at: at(1), basis: { version: 1 }, plan: mine, setup, undoable: true }));
    const coach: DraftPlan = { slots: [slot(0, 1), slot(1, 2, 12, 2), slot(2, 3, 10, 2)] };
    const base = adoptChangedSlots(currentDraftVersion(e).drafted, mine, coach);
    const c = written(builderDraftEdit(e, { opId: 'c-1', at: at(2), basis: { version: e.version }, plan: coach, setup, rebuild: { actionId: id(903), focus: 'chest', gymId: null, equipmentVersion: 'eq', contextHash: 'c3' }, undoable: true, drafted: base }));
    const b = currentDraftVersion(c).drafted;
    expect(reps(b?.plan, 1)).toBe(8);
    expect(reps(b?.plan, 2)).toBe(10);
    // Undo of the coach apply: the version before, with its own baseline.
    const u = written(builderDraftUndo(c, { opId: 'u-1', undoOpId: 'c-1', at: at(3) }) as DraftLifeChange);
    expect(reps(currentDraftVersion(u).drafted?.plan, 2)).toBe(8);
  });

  it('coach adds and removes move the baseline; Ben’s own removal stays a removal', () => {
    const base = { plan, minutes: 60 };
    const mine: DraftPlan = { slots: [slot(0, 1), slot(1, 2)] }; // Ben removed slot 2
    const coach: DraftPlan = { slots: [slot(0, 1), slot(3, 5)] }; // coach removed slot 1, added slot 3
    const next = adoptChangedSlots(base, mine, coach, { before: 60, after: 50 });
    expect(next?.plan.slots.map((s) => s.slotKey)).toEqual([id(100), id(102), id(103)]);
    expect(next?.minutes).toBe(50);
    expect(adoptChangedSlots(null, mine, coach)).toBeNull();
  });

  it('a gym change: slots he hadn’t edited take their new state; his edited slot keeps its drafted one; Undo puts the baseline back', () => {
    const d = draft();
    const mine: DraftPlan = { slots: [slot(0, 1), slot(1, 2, 12, 2), slot(2, 3)] };
    const e = written(builderDraftEdit(d, { opId: 'e-1', at: at(1), basis: { version: 1 }, plan: mine, setup, undoable: true }));
    const moved: DraftPlan = { slots: [slot(0, 1, 6, 2), slot(1, 2, 11, 3), slot(2, 3, 9, 2)] };
    const base = adoptUneditedSlots(currentDraftVersion(e).drafted, mine, moved);
    expect(base?.plan.slots.map((s) => s.setTemplates[0]?.reps?.min)).toEqual([6, 8, 9]);
    const g = written(builderDraftEdit(e, { opId: 'g-1', at: at(2), basis: { version: e.version }, plan: moved, setup, undoable: true, drafted: base }));
    expect(currentDraftVersion(g).drafted).toEqual(base);
    expect(g.undo?.snapshot.drafted).toEqual({ plan, minutes: 60 });
    const u = written(builderDraftUndo(g, { opId: 'u-1', undoOpId: 'g-1', at: at(3) }) as DraftLifeChange);
    expect(currentDraftVersion(u).drafted).toEqual({ plan, minutes: 60 });
  });

  it('an older draft with no baseline parses and stays without one', () => {
    const d = draft();
    const v = currentDraftVersion(d);
    const rest = { ...v };
    delete rest.drafted;
    const old = WorkoutDraftSchema.parse({ ...d, versions: [rest] });
    expect(currentDraftVersion(old).drafted).toBeUndefined();
    const e = written(builderDraftEdit(old, { opId: 'e-1', at: at(1), basis: { version: 1 }, plan, setup, undoable: true }));
    expect(currentDraftVersion(e).drafted).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { EquipmentInstance } from '@fizz/schemas';

import {
  applyEquipmentForm,
  buildPresetDraft,
  checkLoadText,
  dumbbellLoads,
  equipmentRowLine,
  formFromEquipment,
  gapLines,
  loadPreviewLine,
  newEquipmentForm,
  stepLoad,
  unbalancedPlateHints,
  type EquipmentForm,
} from '../src/index';
import { OWNER } from './fixtures';

const meta = { id: '00000000-0000-4000-8000-0000000000e1', ownerId: OWNER, gymId: '00000000-0000-4000-8000-0000000000e2', atUtc: '2026-10-09T10:00:00.000Z' };

function save(form: EquipmentForm, base: EquipmentInstance | null = null): EquipmentInstance {
  const r = applyEquipmentForm(form, base, meta);
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.equipment;
}

describe('gym editor (gym-editor.md §7)', () => {
  it('check 2: a 20 kg bar with 4 each of 20, 10, 5, 2.5, 1.25 previews 63 loads; Check a load uses buildPlateSetup', () => {
    const bar = save({ kind: 'barbell', name: 'Olympic bar', unit: 'kg', barMass: 20, plates: [20, 10, 5, 2.5, 1.25].map((mass) => ({ mass, count: 4 })), maxLoad: null });
    expect(loadPreviewLine(bar)).toBe('Makes 63 loads: 20–175 kg, total, every 2.5 kg.');
    expect(checkLoadText(bar, 102.5)).toBe('Each side: 20 + 20 + 1.25');
    expect(checkLoadText(bar, 176)).toBe('176 kg is above this bar’s limit (175 kg).');
    expect(checkLoadText(bar, 103)).toBe('103 kg can’t be made. Nearest: 102.5 kg or 105 kg.');
    expect(bar).toMatchObject({ detailsSource: 'user', checkedAtUtc: meta.atUtc, version: 1 });
  });

  it('check 3: three 1.25 kg plates show the balance hint and count one pair', () => {
    const plates = [{ mass: 1.25, count: 3 }];
    expect(unbalancedPlateHints(plates, 2, 'kg')).toEqual(['One of the 1.25 kg plates can’t be balanced, so it isn’t used.']);
    const bar = save({ kind: 'barbell', name: 'Bar', unit: 'kg', barMass: 20, plates, maxLoad: null });
    expect(loadPreviewLine(bar)).toBe('Makes 2 loads: 20–22.5 kg, total.');
  });

  it('check 4 + home dumbbells to 30 kg: marking 30 missing makes a gap and the stepper jumps 27.5 → 32.5; never past the rack', () => {
    const form: EquipmentForm = { kind: 'dumbbells', name: 'Dumbbells', unit: 'kg', range: { from: 2.5, to: 40, step: 2.5 }, missing: [30], extra: [] };
    expect(dumbbellLoads(form)).not.toContain(30);
    const db = save(form);
    expect(gapLines(db)).toEqual(['Gap: 27.5 → 32.5 kg.']);
    expect(stepLoad(27.5, db, 'increase')).toEqual({ ok: true, value: 32.5 });
    expect(loadPreviewLine(db)).toBe('Makes 15 loads: 2.5–40 kg each.');
    const home = save({ kind: 'dumbbells', name: 'Home', unit: 'kg', range: { from: 2, to: 30, step: 2 }, missing: [], extra: [] });
    expect(stepLoad(30, home, 'increase')).toEqual({ ok: false, reason: 'at_max' });
    expect(equipmentRowLine(home)).toBe('2–30 kg each');
    // Round trip: the form read back from the record keeps the missing weight.
    expect(formFromEquipment(db)).toMatchObject({ kind: 'dumbbells', range: { from: 2.5, to: 40, step: 2.5 }, missing: [30], extra: [] });
  });

  it('stack step and max, assisted range, lb units stay native', () => {
    const st = save({ kind: 'weight_stack', name: 'Cable', unit: 'lb', range: { from: 10, to: 150, step: 10 }, irregular: null, addOns: [] });
    expect(loadPreviewLine(st)).toBe('Makes 15 loads: 10–150 lb stack.');
    expect(stepLoad(150, st, 'increase')).toEqual({ ok: false, reason: 'at_max' });
    const asst = save({ kind: 'assisted_stack', name: 'Assist', unit: 'kg', range: { from: 5, to: 70, step: 5 }, irregular: null });
    expect(loadPreviewLine(asst)).toBe('Makes 14 loads: Assist 5–70 kg.');
    // An uneven stack read from the record is kept until the range is edited.
    const uneven = { ...st, stackLoads: [4.5, 9, 13.6, 18] } as EquipmentInstance;
    const f = formFromEquipment(uneven);
    expect(f).toMatchObject({ kind: 'weight_stack', irregular: [4.5, 9, 13.6, 18] });
    expect(save(f, uneven)).toMatchObject({ stackLoads: [4.5, 9, 13.6, 18], version: uneven.version + 1 });
  });

  it('check 6: a plate-loaded machine never claims a total resistance', () => {
    const m = save({ kind: 'plate_loaded_machine', name: 'Leg press', unit: 'kg', loadingSides: 2, plates: [{ mass: 20, count: 4 }], maxLoad: null });
    expect(loadPreviewLine(m)).toBe('Makes 3 loads: 0–80 kg plates, every 40 kg.');
    expect(checkLoadText(m, 40)).toBe('Each side: 20');
  });

  it('check 7: max below the bar, an empty range or no feasible load is refused with the spec wording', () => {
    expect(applyEquipmentForm({ kind: 'barbell', name: 'Bar', unit: 'kg', barMass: 20, plates: [], maxLoad: 15 }, null, meta)).toEqual({ ok: false, problems: ['Max is below the bar weight (20 kg).'] });
    expect(applyEquipmentForm({ kind: 'dumbbells', name: 'DB', unit: 'kg', range: { from: 10, to: 5, step: 2.5 }, missing: [], extra: [] }, null, meta)).toEqual({ ok: false, problems: ['Add at least one weight. Check From, To and Every.'] });
    const all = applyEquipmentForm({ kind: 'dumbbells', name: 'DB', unit: 'kg', range: { from: 5, to: 5, step: 5 }, missing: [5], extra: [] }, null, meta);
    expect(all.ok).toBe(false);
    expect(applyEquipmentForm({ ...newEquipmentForm('weight_stack', 'kg'), name: '  ' }, null, meta)).toMatchObject({ ok: false, problems: ['Give it a name.'] });
  });

  it('editing a preset item marks it checked and bumps the version, keeping its ID and gym', () => {
    const draft = buildPresetDraft('commercial', 'kg').items.find((i) => i.key === 'dumbbells');
    if (!draft) throw new Error('fixture');
    const preset = { ...draft.equipment, id: meta.id, ownerId: OWNER, gymId: meta.gymId, version: 1, createdAtUtc: '2026-10-01T00:00:00.000Z', updatedAtUtc: '2026-10-01T00:00:00.000Z' };
    const edited = save({ ...(formFromEquipment(preset) as Extract<EquipmentForm, { kind: 'dumbbells' }>), range: { from: 2.5, to: 32.5, step: 2.5 } }, preset);
    expect(edited).toMatchObject({ id: preset.id, gymId: preset.gymId, version: 2, detailsSource: 'user', createdAtUtc: preset.createdAtUtc });
    expect(loadPreviewLine(edited)).toBe('Makes 13 loads: 2.5–32.5 kg each.');
  });
});

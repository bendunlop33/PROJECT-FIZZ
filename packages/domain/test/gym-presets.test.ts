import { describe, expect, it } from 'vitest';
import {
  buildPresetDraft,
  getAchievableLoads,
  listGymPresets,
  loadRange,
  materialiseGymDraft,
  toggleDraftItem,
  type GymPresetId,
} from '../src/index';
import { GYM, idGen, OWNER, T0 } from './fixtures';

const REQ = { name: 'Main gym', ownerId: OWNER, gymId: GYM, isDefault: true, atUtc: T0 };
const ids = listGymPresets().map((p) => p.id);

describe('gym presets', () => {
  it('offers the onboarding presets in order', () => {
    expect(listGymPresets().map((p) => p.title)).toEqual([
      'Commercial gym',
      'Home: dumbbells and a bench',
      'Home: barbell, rack and plates',
      'Hotel or small gym',
      'Start empty',
    ]);
  });

  it.each(ids.flatMap((id) => (['kg', 'lb'] as const).map((unit) => [id, unit] as const)))(
    '%s (%s): every item validates, is marked preset, keeps the unit and makes loads',
    (presetId: GymPresetId, unit) => {
      const draft = buildPresetDraft(presetId, unit);
      const allTicked = draft.items.reduce((d, i) => (i.ticked ? d : toggleDraftItem(d, i.key)), draft);
      const result = materialiseGymDraft(allTicked, { ...REQ, newId: idGen() });
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.equipment).toHaveLength(draft.items.length);
      for (const eq of result.equipment) {
        expect(eq.unit).toBe(unit);
        expect(eq.detailsSource).toBe('preset');
        expect(eq.gymId).toBe(GYM);
        expect(eq.ownerId).toBe(OWNER);
        if (eq.kind !== 'bodyweight_station') expect(getAchievableLoads(eq).loads.length).toBeGreaterThan(1);
      }
    },
  );

  it('writes lb presets natively in lb (45 lb bar, 5 lb dumbbell steps), never converted', () => {
    const lb = buildPresetDraft('commercial', 'lb');
    const bar = lb.items.find((i) => i.key === 'barbell')?.equipment;
    expect(bar?.kind === 'barbell' && bar.barMass).toBe(45);
    const db = lb.items.find((i) => i.key === 'dumbbells')?.equipment;
    expect(db?.kind === 'dumbbells' && db.loads.slice(0, 3)).toEqual([5, 10, 15]);
    const kgDb = buildPresetDraft('commercial', 'kg').items.find((i) => i.key === 'dumbbells')?.equipment;
    expect(kgDb?.kind === 'dumbbells' && kgDb.loads.slice(0, 3)).toEqual([2.5, 5, 7.5]);
  });

  it('saves only ticked items; toggling is pure', () => {
    const draft = buildPresetDraft('commercial', 'kg');
    expect(draft.items.filter((i) => i.ticked).map((i) => i.key)).toEqual(['barbell', 'dumbbells', 'cable', 'pull_up_bar']);
    const without = toggleDraftItem(draft, 'cable');
    expect(draft.items.find((i) => i.key === 'cable')?.ticked).toBe(true);
    const result = materialiseGymDraft(without, { ...REQ, newId: idGen() });
    expect(result.ok && result.equipment.map((e) => e.name)).toEqual(['Barbell and plates', 'Dumbbells', 'Pull-up bar']);
  });

  it('allows an empty gym and requires a name', () => {
    const empty = materialiseGymDraft(buildPresetDraft('empty', 'kg'), { ...REQ, newId: idGen() });
    expect(empty.ok && empty.equipment).toEqual([]);
    expect(materialiseGymDraft(null, { ...REQ, newId: idGen() }).ok).toBe(true);
    const unnamed = materialiseGymDraft(buildPresetDraft('hotel', 'kg'), { ...REQ, name: '   ', newId: idGen() });
    expect(unnamed).toMatchObject({ ok: false, error: 'name_empty' });
  });

  it('builds ranges without float drift', () => {
    expect(loadRange(1.25, 2.5, 0.25)).toEqual([1.25, 1.5, 1.75, 2, 2.25, 2.5]);
    expect(loadRange(2.5, 40, 2.5)).toHaveLength(16);
    expect(() => loadRange(5, 1, 1)).toThrow(RangeError);
  });
});

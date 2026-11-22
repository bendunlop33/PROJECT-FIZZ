import { describe, expect, it } from 'vitest';

import { canSaveForm, loadOptions, newFormFields, selectedGroups, toggledMuscle, withEquipment } from '../src/library/exercise-form-view';
import { addedMessage, handOffAdded, takeAdded } from '../src/library/exercise-form-handoff';

describe('New exercise form (pure)', () => {
  it('prefills the name; Save needs a muscle; equipment keeps a fitting load or takes its usual one', () => {
    const f = newFormFields('  landmine twst ');
    expect(f).toMatchObject({ name: 'landmine twst', equipment: 'barbell', loadConvention: 'total' });
    expect(canSaveForm(f)).toBe(false);
    const withBack = toggledMuscle(f, 'Back');
    expect(canSaveForm(withBack)).toBe(true);
    expect(withEquipment(withBack, 'plate_loaded_machine').loadConvention).toBe('added');
    expect(withEquipment({ ...withBack, loadConvention: 'added' }, 'barbell').loadConvention).toBe('added');
    expect(withEquipment(withBack, 'erg')).toMatchObject({ loadConvention: 'bodyweight', measurement: 'cardio' });
    expect(loadOptions('bodyweight_station').map((o) => o.label)).toEqual(['Bodyweight', 'Plates added']);
  });
  it('muscles: at most 3 groups, a second tap removes', () => {
    let f = newFormFields('x');
    for (const g of ['Back', 'Biceps', 'Forearms', 'Chest'] as const) f = toggledMuscle(f, g);
    expect(selectedGroups(f)).toEqual(['Back', 'Biceps', 'Forearms']);
    expect(selectedGroups(toggledMuscle(f, 'Biceps'))).toEqual(['Back', 'Forearms']);
  });
  it('the card’s Edit hands the added name back once', () => {
    handOffAdded('a1', 'Meadows row');
    expect(takeAdded()).toEqual({ actionId: 'a1', name: 'Meadows row' });
    expect(takeAdded()).toBeNull();
    expect(addedMessage('Meadows row')).toBe('Added Meadows row.');
  });
});

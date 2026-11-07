import { describe, expect, it } from 'vitest';

import { equipmentForExercise, needsNoEquipment, pickerEquipmentLabel, starterExercises } from '../src/index';
import { assisted, barbell, bodyweightStation, dumbbells } from './fixtures';

/** Bodyweight exercises never need a gym equipment instance (slice-3 re-review nit). */
describe('equipment for an exercise in the picker', () => {
  const starters = new Map(starterExercises('2026-10-09T00:00:00.000Z').map((e) => [e.name, e]));
  const get = (name: string) => {
    const e = starters.get(name);
    if (!e) throw new Error(name);
    return e;
  };
  const pullUpBar = bodyweightStation();

  it('a push-up keeps the catalogue’s bodyweight_station but is never attached to the gym’s pull-up bar', () => {
    const pushUp = get('Push-up');
    expect(pushUp.compatibleEquipment).toEqual(['bodyweight_station']);
    expect(needsNoEquipment(pushUp)).toBe(true);
    expect(equipmentForExercise(pushUp, [barbell(), pullUpBar])).toEqual([]);
    expect(pickerEquipmentLabel(pushUp, [])).toBe('Bodyweight');
  });

  it('at a gym with no bodyweight station a bodyweight exercise is not "Not at this gym"', () => {
    for (const name of ['Push-up', 'Pull-up', 'Dip']) expect([name, pickerEquipmentLabel(get(name), equipmentForExercise(get(name), [dumbbells()]))]).toEqual([name, 'Bodyweight']);
  });

  it('loaded exercises still match by kind, skip retired items, and say plainly when nothing here fits', () => {
    const bench = get('Bench press');
    const retired = { ...barbell(), id: '00000000-0000-4000-8000-0000000009c1', availability: 'retired' as const };
    expect(equipmentForExercise(bench, [barbell(), retired, dumbbells(), pullUpBar]).map((e) => e.id)).toEqual([barbell().id]);
    expect(pickerEquipmentLabel(bench, [barbell()])).toBe(barbell().name);
    expect(pickerEquipmentLabel(bench, [])).toBe('Not at this gym · loads won’t be checked');
    expect(equipmentForExercise(get('Assisted pull-up'), [assisted(), pullUpBar]).map((e) => e.kind)).toEqual(['assisted_stack']);
    expect(pickerEquipmentLabel({ defaultLoadConvention: 'total', compatibleEquipment: [] }, [])).toBe('No equipment needed');
  });
});

import { describe, expect, it } from 'vitest';
import { boundWords, convertedWords, droppedWords, noLoadWords, roundedWords, withWas } from '../src/session/fit-words';

describe('shared fit words (minimal-copy audit §11)', () => {
  it('says why a load was dropped in the overview’s short form', () => {
    expect(droppedWords('not_here', { equipmentName: 'Olympic bar', unit: 'kg' })).toBe('No olympic bar here');
    expect(droppedWords('equipment_not_in_gym', { unit: 'kg' })).toBe('No equipment for this here');
    expect(droppedWords('unit_not_convertible', { unit: 'lb' })).toBe('Nothing here takes lb');
    expect(droppedWords('lightest_is_harder', { unit: 'kg', requested: '20 kg' })).toBe('Lightest here is above 20 kg');
    expect(droppedWords('lightest_is_harder', { unit: 'kg', requested: '50 kg', assisted: true })).toBe('Most assistance here is under 50 kg');
    expect(droppedWords('lightest_is_harder', { unit: 'kg', requested: null })).toBe('Lightest here is heavier than planned');
    expect(droppedWords('no_achievable_loads', { unit: 'kg' })).toBe('No loads set up here');
    expect(droppedWords('convention_mismatch', { unit: 'kg' })).toBe('Different equipment here');
    expect(droppedWords('pain_flag', { unit: 'kg' })).toBe('Pain flag · no increases');
  });

  it('prefixes a dropped note with No load target', () => {
    expect(noLoadWords('not_here', { equipmentName: 'Barbell', unit: 'kg' })).toBe('No load target · no barbell here');
  });

  it('bounds, conversions and roundings read as one short line, kg/lb and assisted explicit', () => {
    expect(boundWords('max', '30 kg each', false)).toBe('Max here 30 kg each');
    expect(boundWords('min', '5 lb', false)).toBe('Min here 5 lb');
    expect(boundWords('min', '30 kg', true)).toBe('Least assistance here 30 kg');
    expect(boundWords('max', '60 kg', true)).toBe('Most assistance here 60 kg');
    expect(convertedWords('225 lb')).toBe('Converted from 225 lb');
    expect(roundedWords()).toBe('Rounded');
    expect(roundedWords({ was: 'plan', load: '32.5 kg' })).toBe('Rounded · plan 32.5 kg');
    expect(withWas('Max here 30 kg', 'last time', '32.5 kg')).toBe('Max here 30 kg · last time 32.5 kg');
    expect(withWas('Max here 30 kg', 'last time', null)).toBe('Max here 30 kg');
  });
});

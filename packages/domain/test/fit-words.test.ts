import type { Load } from '@fizz/schemas';
import { describe, expect, it } from 'vitest';
import { boundWords, convertedWords, droppedWords, nameInLine, noLoadWords, roundedWords, withWas } from '../src/session/fit-words';
import { cardNoteText, repeatNoteText, setSnapNote } from '../src/session/snap-text';

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

describe('assisted caps and equipment names in the snap wording (minimal-copy review S1, N3)', () => {
  const assist = (value: number) => ({ value, unit: 'kg' as const, convention: 'assistance' as const });
  const total = (value: number) => ({ value, unit: 'kg' as const, convention: 'total' as const });
  const top = (intended: Load, load: Load) => ({ setId: 's1', intended, current: intended, load, reps: { min: 6, max: 8 }, durationS: null });
  const slot = { equipment: null, exerciseName: 'Assisted pull-up', sourceEquipment: null, unit: 'kg' as const };
  const snap = (intended: Load | null, outcome: 'capped' | 'dropped', extra: Record<string, unknown> = {}) => ({ intended, intendedOn: null, outcome, equipmentId: null, gymId: null, by: 'gym_switch' as const, ...extra });
  const ctx = { gymName: 'Hotel', equipment: null, unit: 'kg' as const };

  it('gym-switch card: a capped assistance load is the least assistance here', () => {
    expect(cardNoteText({ kind: 'capped', setIds: ['s1'], top: top(assist(10), assist(20)) }, slot)?.text).toBe('Least assistance here 20 kg');
  });

  it('Repeat: a capped assistance load is the least assistance here, with last time', () => {
    expect(repeatNoteText({ kind: 'capped', setIds: ['s1'], top: top(assist(10), assist(20)) }, slot)).toBe('Least assistance here 20 kg · last time Assist 10 kg');
  });

  it('set card: a capped assistance load reads Least assistance here; a bar still reads Max here', () => {
    expect(setSnapNote(snap(assist(10), 'capped'), assist(20), ctx)?.text).toBe('Least assistance here · plan Assist 10 kg');
    expect(setSnapNote(snap(total(150), 'capped'), total(140), ctx)?.text).toBe('Max here · plan 150 kg');
  });

  it('keeps a custom name’s casing, lower-cases a plain one, and falls back to `not here`', () => {
    expect(nameInLine('Rogue Ohio Bar')).toBe('Rogue Ohio Bar');
    expect(nameInLine('Smith machine')).toBe('smith machine');
    const on = (name: string) => ({ equipmentId: 'e1', kind: 'barbell' as const, gymId: 'g1', name });
    expect(setSnapNote(snap(null, 'dropped', { reason: 'not_here', intendedOn: on('Rogue Ohio Bar') }), null, ctx)?.text).toBe('No load target · no Rogue Ohio Bar here');
    expect(setSnapNote(snap(null, 'dropped', { reason: 'not_here' }), null, ctx)?.text).toBe('No load target · not here');
  });
});

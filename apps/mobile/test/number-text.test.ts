import { describe, expect, it } from 'vitest';

import { nextFieldText, parseNumber } from '../src/ui/number-text';

describe('number field text (review S5)', () => {
  it('follows a value changed by + or − even while the field is focused', () => {
    expect(nextFieldText('100', 102.5)).toBe('102.5');
    expect(nextFieldText('100', null)).toBe('');
  });
  it('keeps what is being typed while it still means the value', () => {
    expect(nextFieldText('100.', 100)).toBe('100.');
    expect(nextFieldText('100,5', 100.5)).toBe('100,5');
    expect(nextFieldText('', null)).toBe('');
  });
  it('parses commas and rejects negatives', () => {
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('-1')).toBeNull();
  });
});

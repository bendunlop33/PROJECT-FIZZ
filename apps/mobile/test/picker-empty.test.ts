import { describe, expect, it } from 'vitest';

import { pickerEmptyText } from '../src/workout/picker-empty';

describe('picker empty state (review S4)', () => {
  it('says loading only while loading, and never matches an empty query', () => {
    expect(pickerEmptyText('loading', '')).toBe('Loading exercises…');
    expect(pickerEmptyText('failed', 'bench')).toBe('Couldn’t load exercises. Go back and try again.');
    expect(pickerEmptyText('ready', '  ')).toBe('No exercises yet.');
    expect(pickerEmptyText('ready', ' zzz ')).toBe('No match for “zzz”');
  });
});

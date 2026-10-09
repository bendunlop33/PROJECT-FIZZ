import { describe, expect, it } from 'vitest';

import { initialRootState } from '../src/navigation/initial-state';

describe('root stack at launch (review S5)', () => {
  it('opens an unfinished workout over Today, so minimise pops back to Today', () => {
    expect(initialRootState(true, true)).toEqual({ index: 1, routes: [{ name: 'Tabs' }, { name: 'Workout' }] });
    expect(initialRootState(true, false)).toEqual({ index: 0, routes: [{ name: 'Tabs' }] });
    expect(initialRootState(false, true)).toEqual({ index: 0, routes: [{ name: 'Setup' }] });
  });
});

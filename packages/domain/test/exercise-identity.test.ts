import { describe, expect, it } from 'vitest';
import { movementMatcher, movementNameKey, sameMovement, sameMovementIds } from '../src/index';
import { exercise } from './fixtures';

/** Review coach-add S2: the same movement under another ID, catalogue key or name. */
describe('exercise identity', () => {
  const RAISE = exercise(1, 'Lateral raise', { catalogueKey: 'dumbbell-lateral-raise' });
  const CUSTOM = exercise(2, 'Lateral Raises', { catalogueKey: null });
  const COPY = exercise(3, 'DB side raise', { catalogueKey: 'dumbbell-lateral-raise' });
  const CABLE = exercise(4, 'Cable lateral raise', { catalogueKey: 'cable-lateral-raise' });
  const PRESS = exercise(5, 'Press', { catalogueKey: null });

  it('names: case, punctuation and a plural s are ignored; "press" keeps its double s', () => {
    expect(movementNameKey('Lateral Raises')).toBe(movementNameKey('lateral raise'));
    expect(movementNameKey('Pull-Ups')).toBe(movementNameKey('pull up'));
    expect(movementNameKey('Presses')).not.toBe('');
    expect(movementNameKey('Press')).toBe('press');
  });

  it('same ID, catalogue key or name; a similar movement is not the same', () => {
    expect(sameMovement(RAISE, CUSTOM)).toBe(true);
    expect(sameMovement(RAISE, COPY)).toBe(true);
    expect(sameMovement(RAISE, CABLE)).toBe(false);
    expect(sameMovement(RAISE, PRESS)).toBe(false);
    expect(sameMovementIds(RAISE, [RAISE, CUSTOM, COPY, CABLE]).sort()).toEqual([RAISE.id, CUSTOM.id, COPY.id].sort());
  });

  it('a matcher over rows: by ID, by the row exercise’s catalogue key, or by name', () => {
    const m = movementMatcher([RAISE, CUSTOM, COPY, CABLE], [{ exerciseId: COPY.id, exerciseName: COPY.name }]);
    expect(m(RAISE)).toBe(true);
    expect(m(COPY)).toBe(true);
    expect(m(CABLE)).toBe(false);
    const byName = movementMatcher([], [{ exerciseId: 'gone', exerciseName: 'Lateral Raise' }]);
    expect(byName(RAISE)).toBe(true);
    expect(byName(CABLE)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { claimsRowSwipe, exerciseSwipeActions, swipeOffset, swipeRelease } from '../src/workout/exercise-swipe';

/** (Ben, 1 Nov, approved C) Swipes on an exercise in the Workout list. */
describe('exercise swipes', () => {
  const all = exerciseSwipeActions({ done: false, toEnd: true, canSwap: true, canSkip: true });

  it('left: Later · Swap · Skip; right: Add set; each only where it applies', () => {
    expect(all.left.map((a) => a.label)).toEqual(['Later', 'Swap', 'Skip']);
    expect(all.right.map((a) => a.label)).toEqual(['Add set']);
    expect(exerciseSwipeActions({ done: false, toEnd: false, canSwap: true, canSkip: true }).left.map((a) => a.action)).toEqual(['swap', 'skip_exercise']);
  });

  it('a done exercise: no left swipe; Add set stays', () => {
    const done = exerciseSwipeActions({ done: true, toEnd: true, canSwap: true, canSkip: true });
    expect(done.left).toEqual([]);
    expect(done.right.map((a) => a.action)).toEqual(['add_set']);
    expect(swipeRelease(-300, 360, done)).toEqual({ kind: 'closed' });
    expect(swipeOffset(-120, 360, done)).toBe(0);
  });

  it('a release opens a side, a full swipe left skips, a short one stays closed', () => {
    expect(swipeRelease(-20, 360, all)).toEqual({ kind: 'closed' });
    expect(swipeRelease(-80, 360, all)).toEqual({ kind: 'open', side: 'left' });
    expect(swipeRelease(-216, 360, all)).toEqual({ kind: 'full', action: 'skip_exercise' });
    expect(swipeRelease(60, 360, all)).toEqual({ kind: 'open', side: 'right' });
    // No Skip (nothing left to skip): a long swipe only opens.
    const noSkip = exerciseSwipeActions({ done: false, toEnd: true, canSwap: true, canSkip: false });
    expect(swipeRelease(-300, 360, noSkip)).toEqual({ kind: 'open', side: 'left' });
    expect(swipeOffset(-300, 360, noSkip)).toBe(-144);
    expect(swipeOffset(-300, 360, all)).toBe(-300);
    expect(swipeOffset(200, 360, all)).toBe(72);
  });

  it('only a sideways drag is a swipe (a vertical one scrolls; a still hold is the drag)', () => {
    expect(claimsRowSwipe(30, 5)).toBe(true);
    expect(claimsRowSwipe(6, 0)).toBe(false);
    expect(claimsRowSwipe(20, 18)).toBe(false);
  });
});

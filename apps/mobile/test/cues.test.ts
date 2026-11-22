import { describe, expect, it } from 'vitest';

import { shouldCueRestEnd } from '../src/workout/cues';

describe('in-app rest-end cue', () => {
  it('plays once at the deadline, never early, never twice, never more than 5 s late', () => {
    expect(shouldCueRestEnd('t:1', 10_000, 9_999, new Set())).toBe(false);
    expect(shouldCueRestEnd('t:1', 10_000, 10_000, new Set())).toBe(true);
    expect(shouldCueRestEnd('t:1', 10_000, 15_000, new Set())).toBe(true);
    expect(shouldCueRestEnd('t:1', 10_000, 15_001, new Set())).toBe(false);
    expect(shouldCueRestEnd('t:1', 10_000, 10_500, new Set(['t:1']))).toBe(false);
    // A ±30 s change is a new version: its own cue.
    expect(shouldCueRestEnd('t:2', 40_000, 40_200, new Set(['t:1']))).toBe(true);
  });
});

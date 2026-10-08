import { describe, expect, it } from 'vitest';

import { judgeLockedCue, type LockedCueObservation } from '../src/probe/locked-cue';

const base: LockedCueObservation = {
  appStateAtCue: 'background',
  latenessMs: 120,
  outcome: 'finished',
  otherAudioWasPlaying: true,
  keepAliveCategory: 'AVAudioSessionCategoryPlayback',
  events: [],
};

describe('judgeLockedCue', () => {
  it('asks Ben only when the cue played on time with the app in the background', () => {
    const r = judgeLockedCue(base);
    expect(r.status).toBe('needs_check');
    expect(r.details).toContain('App state when due: background');
  });

  it('fails when the timer fired late, i.e. the app was suspended', () => {
    const r = judgeLockedCue({ ...base, latenessMs: 42_000, appStateAtCue: 'active' });
    expect(r.status).toBe('fail');
    expect(r.summary).toMatch(/suspended.*42 s late/);
  });

  it('does not count a run with the app on screen', () => {
    expect(judgeLockedCue({ ...base, appStateAtCue: 'active' }).status).toBe('not_run');
  });

  it('fails when the cue was cancelled or timed out, and lists events', () => {
    const r = judgeLockedCue({ ...base, outcome: 'cancelled', events: ['interruption began'] });
    expect(r.status).toBe('fail');
    expect(r.details).toContain('Event: interruption began');
  });
});

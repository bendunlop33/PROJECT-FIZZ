import { describe, expect, it } from 'vitest';

import { judgeLockedCue, parseCueLogEntry, type LockedCueFire, type LockedCueObservation } from '../src/probe/locked-cue';

const fire: LockedCueFire = { outcome: 'spoken', appState: 'background', latenessMs: 120, holdRunning: true, speakOutcome: 'finished', error: null };
const base: LockedCueObservation = { scheduled: true, reason: null, holdError: null, fires: [fire, fire], events: [] };

describe('judgeLockedCue (background cues, Ben 1 Nov)', () => {
  it('asks Ben only when both cues played on time with the app in the background', () => {
    const r = judgeLockedCue(base);
    expect(r.status).toBe('needs_check');
    expect(r.details?.[1]).toBe('"15 seconds": spoken (finished), app background, 0.1 s late, silent hold running');
  });

  it('a build without background audio is unavailable, not a failure', () => {
    const r = judgeLockedCue({ ...base, scheduled: false, reason: 'noBackgroundMode', fires: [] });
    expect(r.status).toBe('unavailable');
    expect(r.summary).toContain('FIZZ_BACKGROUND_AUDIO=0');
  });

  it('fails when a cue fired late (the app was suspended) or never fired', () => {
    const late = judgeLockedCue({ ...base, fires: [fire, { ...fire, outcome: 'late', latenessMs: 42_000 }] });
    expect(late.status).toBe('fail');
    expect(late.summary).toMatch(/suspended.*42 s late/);
    expect(judgeLockedCue({ ...base, fires: [fire, null] }).status).toBe('fail');
  });

  it('does not count a run with the app on screen', () => {
    expect(judgeLockedCue({ ...base, fires: [{ ...fire, outcome: 'skippedActive', appState: 'active' }, fire] }).status).toBe('not_run');
  });

  it('fails when a cue was cancelled or could not speak, and lists events', () => {
    const r = judgeLockedCue({ ...base, fires: [fire, { ...fire, speakOutcome: 'cancelled' }], events: ['interruption began'] });
    expect(r.status).toBe('fail');
    expect(r.details).toContain('Event: interruption began');
    const f = judgeLockedCue({ ...base, fires: [{ ...fire, outcome: 'speakFailed', speakOutcome: null, error: 'Could not activate' }, fire] });
    expect(f.summary).toContain('Could not activate');
  });

  it('parses the native log defensively', () => {
    expect(parseCueLogEntry({ id: 'a', outcome: 'spoken', fireAtMs: 1000, firedAtMs: 1250, appState: 'background', holdRunning: true, speakOutcome: 'finished' })).toEqual({
      id: 'a',
      outcome: 'spoken',
      appState: 'background',
      latenessMs: 250,
      holdRunning: true,
      speakOutcome: 'finished',
      error: null,
    });
    expect(parseCueLogEntry({ id: 'a', outcome: 'exploded', fireAtMs: 1, firedAtMs: 2 })).toBeNull();
    expect(parseCueLogEntry({ id: 3, outcome: 'spoken', fireAtMs: 1, firedAtMs: 2 })).toBeNull();
  });
});

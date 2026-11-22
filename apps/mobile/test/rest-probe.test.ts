import { describe, expect, it } from 'vitest';

import {
  PROBE_REST_DURATION_S,
  describeSavingBuild,
  formatMs,
  judgeRecoveredRest,
  recoverProbeRest,
  serialiseProbeRest,
  startProbeRest,
} from '../src/probe/rest-probe';

const T0 = Date.UTC(2026, 9, 8, 9, 0, 0);
const ids = {
  timerId: '3f1c2b7a-1d2e-4f3a-8b4c-5d6e7f8a9b0c',
  sessionId: '4a2d3c8b-2e3f-4a4b-9c5d-6e7f8a9b0c1d',
  setId: '5b3e4d9c-3f4a-4b5c-8d6e-7f8a9b0c1d2e',
};
const stored = serialiseProbeRest(startProbeRest(ids, 'launch-1', '7', T0));

describe('rest deadline probe', () => {
  it('stores a deadline, not a countdown', () => {
    const s = startProbeRest(ids, 'launch-1', '7', T0);
    expect(s.timer.deadlineUtc).toBe('2026-10-08T09:03:00.000Z');
    expect(s.timer.durationS).toBe(PROBE_REST_DURATION_S);
  });

  it('does not pass in the same launch: nothing has survived a restart yet', () => {
    const v = judgeRecoveredRest(recoverProbeRest(stored, 'launch-1', T0 + 10_000), '7');
    expect(v.status).toBe('running');
    expect(v.summary).toContain('2:50 left');
  });

  it('passes after relaunch, recomputing remaining time from the clock', () => {
    const r = recoverProbeRest(stored, 'launch-2', T0 + 75_000);
    expect(r).toMatchObject({ kind: 'running', remainingMs: 105_000, fromPreviousLaunch: true, savedByBuild: '7' });
    const v = judgeRecoveredRest(r, '7');
    expect(v.status).toBe('pass');
    expect(v.summary).toBe('Recovered after relaunch: 1:45 left');
    expect(v.details.join(' ')).toMatch(/not distinguishable/);
  });

  it('reports a rest that ended while the app was closed, with the overrun', () => {
    const r = recoverProbeRest(stored, 'launch-2', T0 + 200_000);
    expect(r).toMatchObject({ kind: 'expired', overrunMs: 20_000 });
    if (r.kind === 'expired') expect(r.timer.endedAtUtc).toBe('2026-10-08T09:03:00.000Z');
    expect(judgeRecoveredRest(r, '7').summary).toBe('Recovered after relaunch: rest ended 0:20 ago');
  });

  it('treats stored text as untrusted', () => {
    expect(recoverProbeRest(null, 'x', T0)).toEqual({ kind: 'none' });
    expect(recoverProbeRest('{not json', 'x', T0)).toMatchObject({ kind: 'invalid' });
    expect(recoverProbeRest('42', 'x', T0)).toMatchObject({ kind: 'invalid' });
    expect(recoverProbeRest(JSON.stringify({ timer: {} }), 'x', T0)).toEqual({ kind: 'invalid', reason: 'Stored rest has no launch ID' });
    const bad = JSON.stringify({ launchId: 'l', timer: { ...startProbeRest(ids, 'l', '7', T0).timer, deadlineUtc: 'tomorrow' } });
    expect(recoverProbeRest(bad, 'x', T0)).toEqual({ kind: 'invalid', reason: 'Stored rest timer failed schema validation' });
    const badBuild = JSON.stringify({ ...startProbeRest(ids, 'l', '7', T0), buildNumber: 8 });
    expect(recoverProbeRest(badBuild, 'x', T0)).toEqual({ kind: 'invalid', reason: 'Stored rest build number is not text' });
    expect(judgeRecoveredRest({ kind: 'invalid', reason: 'r' }, '7').status).toBe('fail');
    expect(judgeRecoveredRest({ kind: 'none' }, '7').status).toBe('not_run');
  });

  it('says which build saved the rest, so a pass across an update is not misread', () => {
    const v = judgeRecoveredRest(recoverProbeRest(stored, 'launch-2', T0 + 1000), '9');
    expect(v.status).toBe('pass');
    expect(v.details).toContain('Saved by build 7, read by build 9 (survived an app update)');
    expect(describeSavingBuild('9', '9')).toBe('Saved and read by build 9');
  });

  it('accepts a rest saved by an older build that did not record its number', () => {
    const legacy = JSON.parse(serialiseProbeRest(startProbeRest(ids, 'old', '7', T0))) as Record<string, unknown>;
    delete legacy.buildNumber;
    const r = recoverProbeRest(JSON.stringify(legacy), 'new', T0 + 1000);
    expect(r).toMatchObject({ kind: 'running', savedByBuild: null });
    expect(judgeRecoveredRest(r, '9').details).toContain('Saved by an older build that did not record its number; read by build 9');
  });

  it('formats durations as m:ss', () => {
    expect(formatMs(0)).toBe('0:00');
    expect(formatMs(65_999)).toBe('1:05');
    expect(formatMs(-5)).toBe('0:00');
  });
});

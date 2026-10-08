import { describe, expect, it } from 'vitest';

import { judgeAlarmKitStatus } from '../src/probe/alarmkit';

describe('judgeAlarmKitStatus', () => {
  it('passes only when present and authorized', () => {
    expect(judgeAlarmKitStatus('authorized').status).toBe('pass');
  });

  it.each([
    ['denied', 'unavailable', /denied/],
    ['notDetermined', 'not_run', /never requested/],
    ['unsupportedOS', 'unavailable', /iOS 26/],
    ['notInSDK', 'unavailable', /SDK/],
    ['somethingNew', 'fail', /unexpected state: somethingNew/],
  ] as const)('%s is reported as %s, never a pass', (raw, status, summary) => {
    const r = judgeAlarmKitStatus(raw);
    expect(r.status).toBe(status);
    expect(r.summary).toMatch(summary);
  });
});

import { describe, expect, it } from 'vitest';

import { judgeAlarmKitStatus } from '../src/probe/alarmkit';
import { probeDefinition } from '../src/probe/model';

describe('judgeAlarmKitStatus', () => {
  it('passes only when present and authorized, and never claims an alarm was tested', () => {
    const read = judgeAlarmKitStatus('authorized');
    expect(read.status).toBe('pass');
    expect(read.summary).toBe('AlarmKit present and authorized. Scheduling an alarm is not tested yet');
    const requested = judgeAlarmKitStatus('authorized', 'requested');
    expect(requested.status).toBe('pass');
    expect(requested.summary).toMatch(/permission granted.*not tested yet/);
    expect(requested.details).toContain('Raw authorization state: authorized (after requesting permission)');
  });

  it.each([
    ['denied', 'unavailable', /denied/],
    ['notDetermined', 'not_run', /not requested yet. Tap Request permission/],
    ['unsupportedOS', 'unavailable', /iOS 26/],
    ['notInSDK', 'unavailable', /SDK/],
    ['somethingNew', 'fail', /unexpected state: somethingNew/],
  ] as const)('read: %s is reported as %s, never a pass', (raw, status, summary) => {
    const r = judgeAlarmKitStatus(raw);
    expect(r.status).toBe(status);
    expect(r.summary).toMatch(summary);
  });

  it('after a request, an unanswered prompt is not a result', () => {
    const r = judgeAlarmKitStatus('notDetermined', 'requested');
    expect(r.status).toBe('not_run');
    expect(r.summary).toMatch(/not answered/);
  });

  it('after a request, denied stays unavailable', () => {
    expect(judgeAlarmKitStatus('denied', 'requested').status).toBe('unavailable');
  });
});

describe('AlarmKit probe row', () => {
  it('offers Request permission and says scheduling is not tested', () => {
    const def = probeDefinition('alarmkit');
    expect(def.secondaryAction).toEqual({ id: 'alarmkit_request_permission', label: 'Request permission' });
    expect(def.title).toContain('scheduling not tested yet');
  });
});

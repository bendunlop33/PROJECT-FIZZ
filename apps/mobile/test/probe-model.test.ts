import { describe, expect, it } from 'vitest';

import {
  PROBES,
  confirmObservation,
  formatReport,
  initialResults,
  recordResult,
  type ReportMeta,
} from '../src/probe/model';

const T0 = Date.UTC(2026, 9, 8, 9, 0, 0);
const meta: ReportMeta = {
  appVersion: '0.1.0',
  buildNumber: '7',
  installedBundleId: 'com.projectfizz.fizz',
  configuredBundleId: 'com.projectfizz.fizz',
  osVersion: '26.0',
  timeZone: 'Pacific/Auckland',
};

describe('probe model', () => {
  it('starts with every probe not run, and S1 sign-in as a not-implemented stub', () => {
    const r = initialResults();
    for (const p of PROBES) expect(r[p.id].atUtc).toBeNull();
    expect(r.chatgpt_signin).toMatchObject({ status: 'not_implemented', summary: 'S1 ChatGPT sign-in: not yet implemented' });
    expect(PROBES.filter((p) => p.id !== 'chatgpt_signin').every((p) => r[p.id].status === 'not_run')).toBe(true);
  });

  it('records results with a UTC timestamp', () => {
    const r = recordResult(initialResults(), 'sqlite', { status: 'pass', summary: 'ok' }, T0);
    expect(r.sqlite).toEqual({ id: 'sqlite', status: 'pass', summary: 'ok', details: [], atUtc: '2026-10-08T09:00:00.000Z' });
  });

  it('never lets a run overwrite the S1 stub', () => {
    const r = recordResult(initialResults(), 'chatgpt_signin', { status: 'pass', summary: 'fake' }, T0);
    expect(r.chatgpt_signin.status).toBe('not_implemented');
  });

  it('turns a needs-check result into pass or fail only on Ben’s answer', () => {
    const pending = recordResult(initialResults(), 'notification', { status: 'needs_check', summary: 'Scheduled' }, T0);
    const yes = confirmObservation(pending, 'notification', true, T0 + 20_000);
    expect(yes.notification.status).toBe('pass');
    expect(yes.notification.details.at(-1)).toMatch(/Yes \(confirmed on device\)$/);
    expect(yes.notification.atUtc).toBe('2026-10-08T09:00:20.000Z');
    expect(confirmObservation(pending, 'notification', false, T0).notification.status).toBe('fail');
  });

  it('ignores a confirmation for anything not awaiting one (stale tap)', () => {
    const failed = recordResult(initialResults(), 'live_activity', { status: 'fail', summary: 'no' }, T0);
    expect(confirmObservation(failed, 'live_activity', true, T0)).toBe(failed);
    const unavailable = recordResult(initialResults(), 'alarmkit', { status: 'unavailable', summary: 'iOS < 26' }, T0);
    expect(confirmObservation(unavailable, 'alarmkit', true, T0)).toBe(unavailable);
  });

  it('exports a text report with timestamps, statuses and totals', () => {
    let r = recordResult(initialResults(), 'sqlite', { status: 'pass', summary: 'ok', details: ['WAL'] }, T0);
    r = recordResult(r, 'alarmkit', { status: 'unavailable', summary: 'no AlarmKit' }, T0);
    const text = formatReport(r, meta, T0 + 60_000);
    expect(text).toContain('Exported: 2026-10-08T09:01:00.000Z (device time zone Pacific/Auckland)');
    expect(text).toContain('[PASS] Spike: local DB: SQLite open, write, read (exclusive transaction)');
    expect(text).toContain('  - WAL');
    expect(text).toContain('[NOT IMPLEMENTED] S1: ChatGPT sign-in');
    expect(text).toContain('Totals: 1 pass, 0 fail, 1 unavailable, 0 needs check, 7 not run, 1 not implemented');
    expect(text).not.toContain('differs');
  });

  it('flags a bundle ID changed by the signing tool', () => {
    const text = formatReport(initialResults(), { ...meta, installedBundleId: 'com.projectfizz.fizz.ABCDE12345' }, T0);
    expect(text).toContain('Bundle ID configured: com.projectfizz.fizz (differs: the signing tool changed it)');
  });
});

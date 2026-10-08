import { describe, expect, it } from 'vitest';

import {
  PROBES,
  appendDetail,
  confirmObservation,
  formatReport,
  initialResults,
  mergeNewer,
  recordResult,
  restoreResults,
  serialiseResults,
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

  it('appends a late observation without changing the status', () => {
    const pending = recordResult(initialResults(), 'notification', { status: 'needs_check', summary: 'Scheduled', details: ['a'] }, T0);
    const r = appendDetail(pending, 'notification', 'Delivered while the app was in the foreground', T0 + 15_000);
    expect(r.notification).toMatchObject({ status: 'needs_check', details: ['a', 'Delivered while the app was in the foreground'] });
    expect(r.notification.atUtc).toBe('2026-10-08T09:00:15.000Z');
    expect(appendDetail(r, 'chatgpt_signin', 'x', T0)).toBe(r);
  });

  it('exports a text report with timestamps, statuses and totals', () => {
    let r = recordResult(initialResults(), 'sqlite', { status: 'pass', summary: 'ok', details: ['WAL'] }, T0);
    r = recordResult(r, 'alarmkit', { status: 'unavailable', summary: 'no AlarmKit' }, T0);
    const text = formatReport(r, meta, T0 + 60_000);
    expect(text).toContain('Exported: 2026-10-08T09:01:00.000Z (device time zone Pacific/Auckland)');
    expect(text).toContain('[PASS] Spike: local DB: SQLite open, write, read (exclusive transaction)');
    expect(text).toContain('  - WAL');
    expect(text).toContain('[NOT IMPLEMENTED] S1: ChatGPT sign-in');
    expect(text).toContain('Totals: 1 pass, 0 fail, 1 unavailable, 0 needs check, 8 not run, 1 not implemented');
    expect(text).not.toContain('differs');
  });

  it('flags a bundle ID changed by the signing tool', () => {
    const text = formatReport(initialResults(), { ...meta, installedBundleId: 'com.projectfizz.fizz.ABCDE12345' }, T0);
    expect(text).toContain('Bundle ID configured: com.projectfizz.fizz (differs: the signing tool changed it)');
    expect(text).toContain('Team suffix added by the signing tool: .ABCDE12345');
  });
});

describe('probe result persistence', () => {
  const answered = () => {
    let r = recordResult(initialResults(), 'notification', { status: 'needs_check', summary: 'Scheduled', details: ['id 1'] }, T0);
    r = confirmObservation(r, 'notification', true, T0 + 20_000);
    r = recordResult(r, 'sqlite', { status: 'pass', summary: 'ok' }, T0);
    return r;
  };

  it('round-trips confirmed results, so a force-close does not lose them', () => {
    const r = answered();
    const restored = restoreResults(serialiseResults(r));
    expect(restored.issues).toEqual([]);
    expect(restored.results).toEqual(r);
    expect(restored.results.notification.status).toBe('pass');
  });

  it('starts fresh with no saved results', () => {
    expect(restoreResults(null)).toEqual({ results: initialResults(), issues: [] });
  });

  it.each([
    ['not JSON', '{oops', /not valid JSON/],
    ['not an object', '42', /not an object/],
    ['an unknown version', JSON.stringify({ version: 99, results: {} }), /unknown format/],
  ])('starts fresh, with a visible issue, when the saved text is %s', (_label, text, pattern) => {
    const restored = restoreResults(text);
    expect(restored.results).toEqual(initialResults());
    expect(restored.issues[0]).toMatch(pattern);
  });

  it('drops only the invalid rows and says which', () => {
    const r = answered();
    const raw = JSON.parse(serialiseResults(r)) as { version: number; results: Record<string, Record<string, unknown>> };
    raw.results.sqlite = { ...raw.results.sqlite, status: 'totally_passed' };
    raw.results.tts = { id: 'tts', status: 'pass', summary: 'x', details: [1], atUtc: null };
    raw.results.alarmkit = { id: 'alarmkit', status: 'pass', summary: 'x', details: [], atUtc: 'yesterday' };
    raw.results.live_activity = { id: 'tts', status: 'pass', summary: 'x', details: [], atUtc: null };
    const restored = restoreResults(JSON.stringify(raw));
    expect(restored.results.notification.status).toBe('pass');
    for (const id of ['sqlite', 'tts', 'alarmkit', 'live_activity'] as const) {
      expect(restored.results[id].status).toBe('not_run');
    }
    expect(restored.issues).toHaveLength(4);
    expect(restored.issues.join('\n')).toMatch(/sqlite result dropped: unknown status/);
  });

  it('never restores a pass over the S1 stub', () => {
    const raw = { version: 1, results: { chatgpt_signin: { id: 'chatgpt_signin', status: 'pass', summary: 'fake', details: [], atUtc: null } } };
    expect(restoreResults(JSON.stringify(raw)).results.chatgpt_signin.status).toBe('not_implemented');
  });

  it('turns a run cut off by the app closing into "not run", never a result', () => {
    const r = recordResult(initialResults(), 'tts', { status: 'running', summary: 'Running…' }, T0);
    const restored = restoreResults(serialiseResults(r)).results.tts;
    expect(restored.status).toBe('not_run');
    expect(restored.summary).toMatch(/Interrupted/);
  });

  it('keeps whichever result is newer when merging this launch with saved results', () => {
    const saved = answered();
    const thisLaunch = recordResult(initialResults(), 'rest_deadline', { status: 'pass', summary: 'Recovered' }, T0 + 60_000);
    const merged = mergeNewer(saved, thisLaunch);
    expect(merged.rest_deadline.summary).toBe('Recovered');
    expect(merged.notification.status).toBe('pass');
    const newerSqlite = recordResult(initialResults(), 'sqlite', { status: 'fail', summary: 'later' }, T0 + 1);
    expect(mergeNewer(saved, newerSqlite).sqlite.summary).toBe('later');
    expect(mergeNewer(newerSqlite, saved).sqlite.summary).toBe('later');
  });

  it('exports every persisted result after a relaunch', () => {
    const text = formatReport(restoreResults(serialiseResults(answered())).results, meta, T0);
    expect(text).toContain('[PASS] Spike: rest alert: Local notification while locked');
    expect(text).toContain('Did the notification arrive while the phone was locked? Yes (confirmed on device)');
  });
});

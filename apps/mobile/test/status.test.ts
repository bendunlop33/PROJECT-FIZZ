import { describe, expect, it } from 'vitest';

import { toMs } from '@fizz/domain';

import { formatShortDate, formatWhen, localStamp } from '../src/format/dates';
import { initialResults } from '../src/probe/model';
import { capabilityGroups, summariseCapabilities } from '../src/status/capabilities';
import { refreshByDay, signingStatus } from '../src/status/signing';
import { buildSystemStatus, topBanners } from '../src/status/system-status';

const TZ = 'Europe/London';
const L = 'en-GB';
const at = (iso: string) => toMs(iso);

describe('date wording', () => {
  it('formats as design-system §3 writes it', () => {
    expect(formatShortDate(at('2026-10-08T18:05:00Z'), TZ, L)).toBe('Thu 8 Oct');
    expect(formatWhen(at('2026-10-08T18:05:00Z'), at('2026-10-08T20:00:00Z'), TZ, L)).toBe('19:05');
    expect(formatWhen(at('2026-10-08T18:05:00Z'), at('2026-10-09T20:00:00Z'), TZ, L)).toBe('Thu 8 Oct, 19:05');
    expect(localStamp(at('2026-10-08T23:30:00Z'), TZ)).toBe('2026-10-09-0030');
  });
});

describe('signing expiry (system-states §3.5)', () => {
  // Expiry Sun 11 Oct 09:00 local (BST, UTC+1).
  const expiry = '2026-10-11T08:00:00Z';

  it('names the day before when the expiry is before 20:00, else the day itself', () => {
    expect(refreshByDay(at(expiry), TZ, L)).toBe('Sat');
    expect(refreshByDay(at('2026-10-11T20:30:00Z'), TZ, L)).toBe('Sun');
  });

  it('is quiet over 72 h, informs within 72 h and warns within 24 h', () => {
    expect(signingStatus(expiry, at('2026-10-07T08:00:00Z'), TZ, L)).toMatchObject({ state: 'ok', banner: null, line: 'Signed until Sun 11 Oct, 09:00' });
    expect(signingStatus(expiry, at('2026-10-08T20:00:00Z'), TZ, L)).toMatchObject({ state: 'notice', banner: 'Refresh Fizz in SideStore by Sat' });
    expect(signingStatus(expiry, at('2026-10-10T20:00:00Z'), TZ, L)).toMatchObject({ state: 'urgent', banner: 'Refresh Fizz in SideStore by tomorrow 09:00' });
    expect(signingStatus(expiry, at('2026-10-11T06:00:00Z'), TZ, L)).toMatchObject({ state: 'urgent', banner: 'Refresh Fizz in SideStore today, by 09:00' });
    expect(signingStatus(expiry, at('2026-10-11T09:00:00Z'), TZ, L).state).toBe('expired');
  });

  it('shows no date when the profile can’t be read', () => {
    expect(signingStatus(null, 0, TZ, L)).toMatchObject({ state: 'unknown', banner: null, line: 'Signing date unknown' });
    expect(signingStatus('garbage', 0, TZ, L).state).toBe('unknown');
  });
});

describe('capability rows from the probe store', () => {
  it('says Working only with a dated pass, and Not tested otherwise', () => {
    const r = initialResults();
    const results = {
      ...r,
      notification: { ...r.notification, status: 'pass' as const, atUtc: '2026-10-08T10:00:00.000Z', summary: 'ok' },
      live_activity: { ...r.live_activity, status: 'fail' as const, atUtc: '2026-10-08T10:00:00.000Z', summary: 'App Group renamed' },
      tts: { ...r.tts, status: 'needs_check' as const },
      locked_cue: { ...r.locked_cue, status: 'unavailable' as const, summary: 'Not in this build' },
    };
    const groups = capabilityGroups(results, TZ, L);
    const rows = Object.fromEntries(groups.flatMap((g) => g.rows).map((row) => [row.id, row]));
    expect(rows.notification).toMatchObject({ label: 'Working', detail: 'Tested Thu 8 Oct' });
    expect(rows.live_activity).toMatchObject({ label: 'Not working', detail: 'Checked Thu 8 Oct: App Group renamed' });
    expect(rows.tts?.label).toBe('Not tested');
    expect(rows.locked_cue?.label).toBe('Not available');
    expect(rows.sqlite?.label).toBe('Not tested');
    expect(rows.time_sensitive).toMatchObject({ label: 'Not available', detail: 'Needs paid Apple signing.' });
    expect(summariseCapabilities(groups)).toMatch(/^1 not working · \d+ not tested$/);
  });
});

describe('banner priority (system-states §2.2)', () => {
  const base = {
    signing: signingStatus(null, 0, TZ, L),
    onPhoneBackup: 'backed_up' as const,
    backupFailureDetail: null,
    hasGym: true,
    damagedRecords: 0,
  };

  it('shows nothing when all is well, including no off-phone backup nagging', () => {
    expect(buildSystemStatus(base)).toEqual([]);
  });

  it('orders T2, T3, T5, T7, T8 and keeps the top two', () => {
    const urgent = signingStatus('2026-10-11T08:00:00Z', at('2026-10-10T20:00:00Z'), TZ, L);
    const all = buildSystemStatus({ ...base, signing: urgent, onPhoneBackup: 'failed', backupFailureDetail: 'This iPhone is out of space.', hasGym: false, damagedRecords: 1 });
    expect(all.map((b) => b.id)).toEqual(['T2', 'T3', 'T5', 'T8']);
    expect(topBanners({ ...base, onPhoneBackup: 'failed', backupFailureDetail: null, hasGym: false }).map((b) => [b.id, b.text])).toEqual([
      ['T5', 'Last backup on this phone didn’t save.'],
      ['T8', 'No gym selected. Loads won’t be checked against equipment.'],
    ]);
    const notice = signingStatus('2026-10-11T08:00:00Z', at('2026-10-08T20:00:00Z'), TZ, L);
    expect(buildSystemStatus({ ...base, signing: notice }).map((b) => [b.id, b.severity])).toEqual([['T7', 'info']]);
  });
});

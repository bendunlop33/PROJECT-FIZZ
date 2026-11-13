import { toMs } from '@fizz/domain';

import { formatShortDate } from '../format/dates';
import type { ProbeId, ProbeResult, ProbeResults } from '../probe/model';

/**
 * App status capability rows (system-states.md §2.4, profile-and-settings
 * §2.10) from the capability probe's saved results. The evidence rule:
 * `Working` only with a dated passing check on this install; otherwise
 * `Not tested`. Pure.
 */

export type CapabilityLabel = 'Working' | 'Not working' | 'Not tested' | 'Not available' | 'Not in this build';

export interface CapabilityRow {
  id: ProbeId | 'time_sensitive';
  title: string;
  label: CapabilityLabel;
  /** Evidence or reason, e.g. `Tested Thu 8 Oct` or the probe's summary. */
  detail: string | null;
}

export interface CapabilityGroup {
  title: string;
  rows: CapabilityRow[];
}

const GROUPS: readonly { title: string; rows: readonly { id: ProbeId; title: string }[] }[] = [
  {
    title: 'Rest alerts',
    rows: [
      { id: 'notification', title: 'Notifications' },
      { id: 'rest_deadline', title: 'Rest timer after a force-close' },
      { id: 'live_activity', title: 'Lock Screen timer' },
      { id: 'alarmkit', title: 'Loud rest alerts' },
    ],
  },
  {
    title: 'Voice',
    rows: [
      { id: 'tts', title: 'Spoken cues' },
      { id: 'audio_coach', title: 'Lower music during cues' },
      { id: 'audio_events', title: 'Calls and headphone changes' },
      { id: 'locked_cue', title: 'Speak while locked' },
      { id: 'speech_recognition', title: 'Speech recognition' },
    ],
  },
  {
    title: 'Data and security',
    rows: [
      { id: 'sqlite', title: 'Database' },
      { id: 'secure_store', title: 'Keychain' },
      { id: 'app_group', title: 'Shared storage for the Lock Screen' },
    ],
  },
  { title: 'Coach', rows: [{ id: 'chatgpt_signin', title: 'ChatGPT sign-in' }] },
];

export function capabilityRow(result: ProbeResult | undefined, title: string, id: ProbeId, tz: string, locale?: string): CapabilityRow {
  const when = result?.atUtc ? formatShortDate(toMs(result.atUtc), tz, locale) : null;
  switch (result?.status ?? 'not_run') {
    case 'pass':
      return { id, title, label: 'Working', detail: when === null ? null : `Tested ${when}` };
    case 'fail':
      return { id, title, label: 'Not working', detail: when === null ? (result?.summary ?? null) : `Checked ${when}: ${result?.summary ?? ''}` };
    case 'unavailable':
      return { id, title, label: 'Not available', detail: result?.summary ?? null };
    case 'not_implemented':
      return { id, title, label: 'Not in this build', detail: null };
    case 'needs_check':
      return { id, title, label: 'Not tested', detail: 'Waiting for your answer in Capability probe.' };
    case 'running':
    case 'not_run':
      return { id, title, label: 'Not tested', detail: null };
  }
}

export function capabilityGroups(results: ProbeResults, tz: string, locale?: string): CapabilityGroup[] {
  const groups = GROUPS.map((g) => ({ title: g.title, rows: g.rows.map((r) => capabilityRow(results[r.id], r.title, r.id, tz, locale)) }));
  const rest = groups[0];
  // Free Apple ID: not possible, so it is a fact, not a test (ADR 0004).
  rest?.rows.splice(1, 0, { id: 'time_sensitive', title: 'Time-sensitive alerts', label: 'Not available', detail: 'Needs paid Apple signing.' });
  return groups;
}

export function summariseCapabilities(groups: readonly CapabilityGroup[]): string {
  const rows = groups.flatMap((g) => g.rows);
  const notWorking = rows.filter((r) => r.label === 'Not working').length;
  const notTested = rows.filter((r) => r.label === 'Not tested').length;
  const parts = [notWorking > 0 ? `${String(notWorking)} not working` : null, notTested > 0 ? `${String(notTested)} not tested` : null].filter(
    (p): p is string => p !== null,
  );
  return parts.length === 0 ? 'Everything tested is working' : parts.join(' · ');
}

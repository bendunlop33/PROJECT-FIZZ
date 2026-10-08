/**
 * Capability probe model (pure). No React Native imports: unit-tested on Linux.
 *
 * Honesty rules (CLAUDE.md rules 1 and 6):
 * - "pass" only when the app itself observed success, or Ben confirmed an
 *   observation it can't make (a notification arriving, music ducking).
 * - Anything that needs Ben's eyes or ears is "needs_check" until he answers.
 * - "unavailable" means the capability is absent on this build/device, which is
 *   a valid result, not a failure.
 */

export type ProbeId =
  | 'sqlite'
  | 'secure_store'
  | 'notification'
  | 'rest_deadline'
  | 'tts'
  | 'audio_coach'
  | 'speech_recognition'
  | 'live_activity'
  | 'alarmkit'
  | 'chatgpt_signin';

export type ProbeStatus =
  | 'not_run'
  | 'running'
  | 'pass'
  | 'fail'
  | 'unavailable'
  | 'needs_check'
  | 'not_implemented';

export interface ProbeDefinition {
  id: ProbeId;
  /** Spike reference (docs/research/ai-access-and-voice.md S1-S8, free-ios-install.md §8). */
  ref: string;
  title: string;
  /** What Ben does on the phone. */
  howTo: string;
  /** Question asked when the probe needs his confirmation. */
  confirmQuestion?: string;
}

export interface ProbeResult {
  id: ProbeId;
  status: ProbeStatus;
  summary: string;
  details: readonly string[];
  /** UTC ISO timestamp of the last change; null if never run. */
  atUtc: string | null;
}

export type ProbeResults = Readonly<Record<ProbeId, ProbeResult>>;

export const PROBES: readonly ProbeDefinition[] = [
  {
    id: 'sqlite',
    ref: 'Spike: local DB',
    title: 'SQLite open, write, read (exclusive transaction)',
    howTo: 'Tap Run. Uses a separate probe database, not workout data.',
  },
  {
    id: 'secure_store',
    ref: 'Spike: Keychain',
    title: 'Secure storage (Keychain) write and read',
    howTo: 'Tap Run. Writes a random test value, reads it back and deletes it.',
  },
  {
    id: 'notification',
    ref: 'Spike: rest alert',
    title: 'Local notification while locked',
    howTo: 'Tap Run, then lock the phone straight away and wait for the alert.',
    confirmQuestion: 'Did the notification arrive while the phone was locked?',
  },
  {
    id: 'rest_deadline',
    ref: 'Spike: force-close',
    title: 'Rest deadline survives force-close',
    howTo:
      'Tap Run to save a 3-minute rest. Swipe the app away, reopen it, and check the remaining time below. Other results are saved and come back too.',
  },
  {
    id: 'tts',
    ref: 'S7',
    title: 'Spoken cue (expo-speech)',
    howTo: 'Tap Run with the silent switch off, then again with it on. Expo documents no sound in silent mode.',
    confirmQuestion: 'Did you hear the cue?',
  },
  {
    id: 'audio_coach',
    ref: 'S7',
    title: 'Ducking while music plays (audio-coach module)',
    howTo: 'Start music in another app, come back, tap Run. Music should dip under the cue, then return to full volume.',
    confirmQuestion: 'Did the music dip during the cue and come back afterwards?',
  },
  {
    id: 'speech_recognition',
    ref: 'S6',
    title: 'On-device speech recognition',
    howTo: 'Tap Run and say "bench one hundred kilos for eight". Try again in flight mode.',
    confirmQuestion: 'Was the transcript close to what you said?',
  },
  {
    id: 'live_activity',
    ref: 'Spike: Live Activity',
    title: 'Live Activity countdown (no push)',
    howTo: 'Tap Run, then lock the phone. A 2-minute countdown should show on the Lock Screen and Dynamic Island.',
    confirmQuestion: 'Did the countdown show on the Lock Screen and count down?',
  },
  {
    id: 'alarmkit',
    ref: 'Spike: AlarmKit',
    title: 'AlarmKit availability (detect only)',
    howTo: 'Tap Run. Only reads availability; it does not ask for permission or set an alarm.',
  },
  {
    id: 'chatgpt_signin',
    ref: 'S1',
    title: 'ChatGPT sign-in',
    howTo: 'Not part of this build.',
  },
];

export function probeDefinition(id: ProbeId): ProbeDefinition {
  const def = PROBES.find((p) => p.id === id);
  if (def === undefined) throw new RangeError(`Unknown probe: ${id}`);
  return def;
}

export function toUtcIso(nowMs: number): string {
  // eslint-disable-next-line no-restricted-globals -- formatting an injected time, not reading the clock
  return new Date(nowMs).toISOString();
}

export function initialResults(): ProbeResults {
  const entries = PROBES.map((p): [ProbeId, ProbeResult] => [
    p.id,
    p.id === 'chatgpt_signin'
      ? { id: p.id, status: 'not_implemented', summary: 'S1 ChatGPT sign-in: not yet implemented', details: [], atUtc: null }
      : { id: p.id, status: 'not_run', summary: 'Not run yet', details: [], atUtc: null },
  ]);
  return Object.fromEntries(entries) as Record<ProbeId, ProbeResult>;
}

export interface ResultUpdate {
  status: ProbeStatus;
  summary: string;
  details?: readonly string[];
}

export function recordResult(results: ProbeResults, id: ProbeId, update: ResultUpdate, nowMs: number): ProbeResults {
  if (id === 'chatgpt_signin') return results;
  return {
    ...results,
    [id]: { id, status: update.status, summary: update.summary, details: update.details ?? [], atUtc: toUtcIso(nowMs) },
  };
}

/**
 * Ben's answer to a "needs_check" probe. Ignored for any other state, so a
 * stale tap can't turn a failure or an unavailable capability into a pass.
 */
export function confirmObservation(
  results: ProbeResults,
  id: ProbeId,
  observed: boolean,
  nowMs: number,
): ProbeResults {
  const current = results[id];
  if (current.status !== 'needs_check') return results;
  const question = probeDefinition(id).confirmQuestion ?? 'Observed on device?';
  return recordResult(
    results,
    id,
    {
      status: observed ? 'pass' : 'fail',
      summary: `${current.summary}. Ben: ${observed ? 'yes' : 'no'}`,
      details: [...current.details, `${question} ${observed ? 'Yes' : 'No'} (confirmed on device)`],
    },
    nowMs,
  );
}

// ---------- Persistence (pure) ----------

/** probe_kv key holding the serialised results (probe DB, not workout data). */
export const PROBE_RESULTS_KEY = 'probe_results';
const RESULTS_FORMAT_VERSION = 1;

const ALL_STATUSES: readonly ProbeStatus[] = [
  'not_run',
  'running',
  'pass',
  'fail',
  'unavailable',
  'needs_check',
  'not_implemented',
];

export function serialiseResults(results: ProbeResults): string {
  return JSON.stringify({ version: RESULTS_FORMAT_VERSION, results });
}

export interface RestoredResults {
  results: ProbeResults;
  /** Rows that were dropped or changed while loading, for display. */
  issues: string[];
}

function isIsoUtc(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v);
}

function parseStoredResult(id: ProbeId, raw: unknown): ProbeResult | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object';
  const r = raw as Record<string, unknown>;
  if (r.id !== id) return 'id mismatch';
  const status = r.status;
  if (typeof status !== 'string' || !(ALL_STATUSES as readonly string[]).includes(status)) return 'unknown status';
  if (typeof r.summary !== 'string') return 'summary is not text';
  if (!Array.isArray(r.details) || !r.details.every((d): d is string => typeof d === 'string')) return 'details are not text';
  if (r.atUtc !== null && !isIsoUtc(r.atUtc)) return 'timestamp is not ISO UTC';
  return { id, status: status as ProbeStatus, summary: r.summary, details: r.details, atUtc: r.atUtc };
}

/**
 * Loads results saved by an earlier launch. The stored text is untrusted
 * (CLAUDE.md rule 8): each row is validated, and a bad row falls back to "not
 * run" rather than discarding everything. A row saved as "running" was cut off
 * by the app closing, so it comes back as "not run" with a note, never as a
 * result. The S1 stub can't be overwritten.
 */
export function restoreResults(stored: string | null): RestoredResults {
  const base = initialResults();
  if (stored === null) return { results: base, issues: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { results: base, issues: ['Saved results were not valid JSON; starting fresh'] };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { results: base, issues: ['Saved results were not an object; starting fresh'] };
  }
  const { version, results } = parsed as { version?: unknown; results?: unknown };
  if (version !== RESULTS_FORMAT_VERSION || typeof results !== 'object' || results === null) {
    return { results: base, issues: [`Saved results have an unknown format (version ${String(version)}); starting fresh`] };
  }
  const rows = results as Record<string, unknown>;
  const out: Record<ProbeId, ProbeResult> = { ...base };
  const issues: string[] = [];
  for (const def of PROBES) {
    if (def.id === 'chatgpt_signin' || !(def.id in rows)) continue;
    const row = parseStoredResult(def.id, rows[def.id]);
    if (typeof row === 'string') {
      issues.push(`Saved ${def.id} result dropped: ${row}`);
      continue;
    }
    out[def.id] =
      row.status === 'running'
        ? {
            ...row,
            status: 'not_run',
            summary: 'Interrupted: the app closed while this was running. Run it again',
            details: [],
          }
        : row;
  }
  return { results: out, issues };
}

/**
 * Per probe, keeps whichever result changed most recently. Used when results
 * recorded in this launch race the load of the saved ones.
 */
export function mergeNewer(a: ProbeResults, b: ProbeResults): ProbeResults {
  const entries = PROBES.map((p): [ProbeId, ProbeResult] => {
    const x = a[p.id];
    const y = b[p.id];
    if (x.atUtc === null) return [p.id, y];
    if (y.atUtc === null) return [p.id, x];
    return [p.id, y.atUtc >= x.atUtc ? y : x];
  });
  return Object.fromEntries(entries) as Record<ProbeId, ProbeResult>;
}

export const STATUS_LABEL: Readonly<Record<ProbeStatus, string>> = {
  not_run: 'NOT RUN',
  running: 'RUNNING',
  pass: 'PASS',
  fail: 'FAIL',
  unavailable: 'UNAVAILABLE',
  needs_check: 'NEEDS CHECK',
  not_implemented: 'NOT IMPLEMENTED',
};

export interface ReportMeta {
  appVersion: string;
  buildNumber: string;
  /** Bundle ID the app is actually installed under (re-signing tools may change it). */
  installedBundleId: string;
  /** Bundle ID this build was configured with (apps/mobile/app-identity.mts). */
  configuredBundleId: string;
  osVersion: string;
  timeZone: string;
}

export function formatReport(results: ProbeResults, meta: ReportMeta, nowMs: number): string {
  const lines: string[] = [
    'Fizz capability probe',
    `Exported: ${toUtcIso(nowMs)} (device time zone ${meta.timeZone})`,
    `App ${meta.appVersion} (build ${meta.buildNumber}), iOS ${meta.osVersion}`,
    `Bundle ID installed: ${meta.installedBundleId}`,
  ];
  if (meta.installedBundleId !== meta.configuredBundleId) {
    lines.push(`Bundle ID configured: ${meta.configuredBundleId} (differs: the signing tool changed it)`);
  }
  lines.push('');
  for (const def of PROBES) {
    const r = results[def.id];
    lines.push(`[${STATUS_LABEL[r.status]}] ${def.ref}: ${def.title}`);
    lines.push(`  ${r.summary}`);
    for (const d of r.details) lines.push(`  - ${d}`);
    lines.push(`  at: ${r.atUtc ?? 'never'}`);
  }
  const counts = PROBES.reduce<Record<ProbeStatus, number>>(
    (acc, def) => ({ ...acc, [results[def.id].status]: acc[results[def.id].status] + 1 }),
    { not_run: 0, running: 0, pass: 0, fail: 0, unavailable: 0, needs_check: 0, not_implemented: 0 },
  );
  lines.push('');
  lines.push(
    `Totals: ${counts.pass} pass, ${counts.fail} fail, ${counts.unavailable} unavailable, ` +
      `${counts.needs_check} needs check, ${counts.not_run} not run, ${counts.not_implemented} not implemented`,
  );
  return lines.join('\n');
}

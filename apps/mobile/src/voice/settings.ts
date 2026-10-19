import type { CueDetail } from '@fizz/domain';

/**
 * Settings › Voice (Ben, 19 Oct 2026). Saved with this phone's preferences
 * (`device/prefs.ts`): the voices are this phone's, so they aren't in backups.
 * No secrets here. Pure parse, tested on Linux.
 */

/** Read coach replies aloud: during a live workout only (default), always, or never. */
export type ReadReplies = 'workout' | 'always' | 'off';

/** The three choices Settings shows for spoken cues. */
export type CueMode = 'off' | CueDetail;

export interface VoicePrefs {
  /** The quick on/off (workout ⋯ menu); turning it back on keeps `cueDetail`. */
  cuesOn: boolean;
  cueDetail: CueDetail;
  readReplies: ReadReplies;
  /** An installed iOS voice; null = the default (best en-GB, else en-US, else the system's). */
  voiceId: string | null;
  /** Multiplier of the system speaking rate. */
  rate: number;
}

export const RATE_STEPS = [0.8, 0.9, 1, 1.1, 1.2] as const;

export const DEFAULT_VOICE_PREFS: VoicePrefs = { cuesOn: true, cueDetail: 'timer_and_set', readReplies: 'workout', voiceId: null, rate: 1 };

/** Nearest allowed step; anything unreadable is the default speed. */
export function clampRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  let best: number = RATE_STEPS[0];
  for (const r of RATE_STEPS) if (Math.abs(r - value) < Math.abs(best - value)) best = r;
  return best;
}

export function parseVoicePrefs(raw: unknown): VoicePrefs {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_VOICE_PREFS;
  const r = raw as Record<string, unknown>;
  return {
    cuesOn: r.cuesOn !== false,
    cueDetail: r.cueDetail === 'timer' ? 'timer' : 'timer_and_set',
    readReplies: r.readReplies === 'always' || r.readReplies === 'off' ? r.readReplies : 'workout',
    voiceId: typeof r.voiceId === 'string' && r.voiceId.length > 0 && r.voiceId.length <= 300 ? r.voiceId : null,
    rate: clampRate(r.rate),
  };
}

export function cueModeOf(p: VoicePrefs): CueMode {
  return p.cuesOn ? p.cueDetail : 'off';
}

/** Settings' Off / Timer only / Timer and set details. Off keeps the detail for the quick toggle. */
export function withCueMode(p: VoicePrefs, mode: CueMode): VoicePrefs {
  return mode === 'off' ? { ...p, cuesOn: false } : { ...p, cuesOn: true, cueDetail: mode };
}

/** The workout ⋯ menu's quick toggle: mirrors the setting. */
export function toggleCues(p: VoicePrefs): VoicePrefs {
  return { ...p, cuesOn: !p.cuesOn };
}

export const CUE_MODE_LABEL: Record<CueMode, string> = { off: 'Off', timer: 'Timer only', timer_and_set: 'Timer and set details' };
export const READ_REPLIES_LABEL: Record<ReadReplies, string> = { workout: 'During workouts', always: 'Always', off: 'Off' };

/** `0.8×` … `1.2×`; the default reads `Normal`. */
export function rateLabel(rate: number): string {
  return rate === 1 ? 'Normal' : `${String(rate)}×`;
}

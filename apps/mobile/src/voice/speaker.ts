import { getLocales } from 'expo-localization';

import AudioCoach from '../../modules/audio-coach';
import type { CueSpeaker } from './cue-controller';
import type { ReplySpeaker } from './read-aloud';
import { DEFAULT_VOICE_PREFS, type VoicePrefs } from './settings';
import { parseVoices, resolveVoice, type VoiceOption } from './voices';

/**
 * The phone binding for spoken cues and replies: the audio-coach Swift module
 * (ADR 0007), which owns the audio session. Category `.playback` / mode
 * `.voicePrompt` so speech plays with the silent switch on; other audio is
 * ducked (spoken audio such as podcasts pauses) and comes back when the
 * session is deactivated with notifyOthersOnDeactivation after each cue.
 * Apple voices only: never an OpenAI or other paid voice (rule 7). When the
 * module isn't in this build (Expo Go, an old build), `available()` is false
 * and Settings says Voice is unavailable.
 */

let prefs: VoicePrefs = DEFAULT_VOICE_PREFS;

/** Root keeps this in step with the saved preferences. */
export function setVoicePrefs(p: VoicePrefs): void {
  prefs = p;
}

export function voicePrefs(): VoicePrefs {
  return prefs;
}

/** Whether this build has the module (speech), and whether it can list voices (newer builds). */
export function voiceCapability(): { speech: boolean; voiceList: boolean } {
  return { speech: AudioCoach !== null, voiceList: typeof AudioCoach?.getVoices === 'function' };
}

let cache: VoiceOption[] | null = null;

/** The phone's installed voices, or null when this build can't list them. */
export function installedVoices(refresh = false): VoiceOption[] | null {
  const m = AudioCoach;
  if (m === null || typeof m.getVoices !== 'function') return null;
  if (cache === null || refresh) {
    try {
      cache = parseVoices(m.getVoices());
    } catch {
      return null;
    }
  }
  return cache;
}

/** The phone's first language, e.g. `en-GB`. */
export function phoneLocale(): string {
  try {
    return getLocales().at(0)?.languageTag ?? 'en-GB';
  } catch {
    return 'en-GB';
  }
}

export const appleSpeaker: CueSpeaker & ReplySpeaker = {
  available: () => AudioCoach !== null,
  async speak(text: string) {
    const m = AudioCoach;
    if (m === null) return null;
    // Re-applied each time (only when idle, natively), so a probe run's playAndRecord never lingers.
    await m.configureSession({ category: 'playback', duckOthers: true, interruptSpokenAudioAndMixWithOthers: true });
    const { voice } = resolveVoice(installedVoices() ?? [], prefs.voiceId);
    return m.speak(text, { ...(voice ? { voice: voice.id, language: voice.language } : { language: 'en-GB' }), rate: prefs.rate, deactivateAfter: true });
  },
  async stop() {
    await AudioCoach?.stop();
  },
};

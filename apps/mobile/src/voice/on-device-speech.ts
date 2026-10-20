import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { PROBE_CONTEXTUAL_STRINGS } from '../probe/speech-probe';
import type { SpeechInputPort, SpeechSession } from './dictation';

/**
 * The Expo adapter for tap-to-talk (`expo-speech-recognition` 57.1.0, a
 * native module: needs the dev build, not Expo Go). On-device only
 * (`requiresOnDeviceRecognition: true`), and checked at run time on every
 * tap, not only in the probe (§5 "Voice"): the library falls back to Apple's
 * servers when the device can't recognise on-device, so `start` is never
 * called unless `supportsOnDeviceRecognition()` says it can.
 *
 * `supportsOnDeviceRecognition()` answers for the device's default locale,
 * so the recogniser is started in that same locale (the first of Ben's
 * device languages) and only when the recogniser lists it.
 *
 * Not proven on the device yet: the audio session this takes while
 * listening has to be checked against the audio-coach module (TTS and
 * ducking) on Ben's iPhone.
 */

function deviceLocale(): string | null {
  try {
    const tags = getLocales()
      .map((l) => l.languageTag)
      .filter((t) => t.length > 0);
    return tags[0] ?? null;
  } catch {
    return null;
  }
}

const norm = (t: string): string => t.replace(/_/g, '-').toLowerCase();

export function createOnDeviceSpeech(): SpeechInputPort {
  let locale: string | null = null;
  return {
    async onDeviceAvailable(): Promise<boolean> {
      try {
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable() || !ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) return false;
        const tag = deviceLocale();
        if (tag === null) return false;
        const listed = await ExpoSpeechRecognitionModule.getSupportedLocales({}).catch(() => ({ locales: [] as string[] }));
        const match = listed.locales.find((l) => norm(l) === norm(tag));
        locale = match ?? null;
        return match !== undefined;
      } catch {
        return false;
      }
    },
    async permission(): Promise<'granted' | 'denied'> {
      const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      return p.granted ? 'granted' : 'denied';
    },
    start(h): SpeechSession {
      const lang = locale;
      if (lang === null) throw new Error('No on-device locale');
      const subs = [
        ExpoSpeechRecognitionModule.addListener('result', (ev) => {
          const text = ev.results[0]?.transcript ?? '';
          if (ev.isFinal) h.final(text);
          else h.partial(text);
        }),
        ExpoSpeechRecognitionModule.addListener('error', (ev) => {
          h.error(ev.error);
        }),
        ExpoSpeechRecognitionModule.addListener('end', () => {
          subs.forEach((s) => {
            s.remove();
          });
          h.end();
        }),
      ];
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        // Stops on silence (iOS 17: 3 s of no speech; 18+: the final result).
        continuous: false,
        requiresOnDeviceRecognition: true,
        addsPunctuation: false,
        contextualStrings: [...PROBE_CONTEXTUAL_STRINGS, 'superset', 'supersets', 'minutes', 'abs', 'triceps', 'biceps'],
      });
      return {
        stop: () => {
          try {
            ExpoSpeechRecognitionModule.stop();
          } catch {
            // Already ended: the `end` listener has settled it.
          }
        },
      };
    },
  };
}

import { requireOptionalNativeModule, type NativeModule } from 'expo';

import type {
  AlarmKitStatus,
  AudioCoachEvents,
  AudioSessionState,
  SessionOptions,
  SpeakOptions,
  SpeakResult,
} from './AudioCoach.types';

declare class AudioCoachNativeModule extends NativeModule<AudioCoachEvents> {
  configureSession(options: SessionOptions): Promise<AudioSessionState>;
  speak(text: string, options: SpeakOptions): Promise<SpeakResult>;
  stop(): Promise<void>;
  getSessionState(): AudioSessionState;
  getAlarmKitStatus(): Promise<AlarmKitStatus>;
}

/**
 * null when the native module isn't in this build (e.g. a JS bundle running in
 * a build made before the module existed). Callers must show "unavailable".
 */
const AudioCoach: AudioCoachNativeModule | null = requireOptionalNativeModule<AudioCoachNativeModule>('AudioCoach');

export default AudioCoach;

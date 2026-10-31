import { requireOptionalNativeModule, type NativeModule } from 'expo';

import type {
  AlarmKitStatus,
  AppGroupInfo,
  AudioCoachEvents,
  AudioSessionState,
  KeepAliveStartResult,
  KeepAliveStopResult,
  LiveActivityTapEntry,
  NativeVoice,
  SessionOptions,
  SpeakOptions,
  SpeakResult,
} from './AudioCoach.types';

declare class AudioCoachNativeModule extends NativeModule<AudioCoachEvents> {
  configureSession(options: SessionOptions): Promise<AudioSessionState>;
  speak(text: string, options: SpeakOptions): Promise<SpeakResult>;
  /** Stops speech; every pending speak() resolves with outcome "cancelled". */
  stop(): Promise<void>;
  /** Opt-in locked-cue experiment; refuses without the audio background mode. */
  startKeepAlive(): Promise<KeepAliveStartResult>;
  stopKeepAlive(): Promise<KeepAliveStopResult>;
  getSessionState(): AudioSessionState;
  /** Absent in builds made before it existed: check before calling. */
  getVoices?(): NativeVoice[];
  getAlarmKitStatus(): Promise<AlarmKitStatus>;
  /** Shows the system prompt if not yet determined; resolves to the resulting state. */
  requestAlarmKitAuthorization(): Promise<AlarmKitStatus>;
  getAppGroupInfo(configuredGroups: string[]): Promise<AppGroupInfo>;
  /** Lock Screen rest-button taps waiting to be handled (Ben, 26 Oct). Absent in builds made before it existed. */
  liveActivityTaps?(): LiveActivityTapEntry[];
  /** Removes handled taps; the waiting LiveActivityIntent then returns. Absent in older builds. */
  ackLiveActivityTaps?(ids: string[]): void;
}

/**
 * null when the native module isn't in this build (e.g. a JS bundle running in
 * a build made before the module existed). Callers must show "unavailable".
 */
const AudioCoach: AudioCoachNativeModule | null = requireOptionalNativeModule<AudioCoachNativeModule>('AudioCoach');

export default AudioCoach;

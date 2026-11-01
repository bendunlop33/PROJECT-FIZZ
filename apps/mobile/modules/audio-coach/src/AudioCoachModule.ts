import { requireOptionalNativeModule, type NativeModule } from 'expo';

import type {
  AlarmKitStatus,
  AppGroupInfo,
  AudioCoachEvents,
  AudioSessionState,
  CancelCuesResult,
  LiveActivityTapEntry,
  NativeVoice,
  ScheduleCuesResult,
  ScheduledCue,
  ScheduledCueLogEntry,
  SessionOptions,
  SpeakOptions,
  SpeakResult,
} from './AudioCoach.types';

declare class AudioCoachNativeModule extends NativeModule<AudioCoachEvents> {
  configureSession(options: SessionOptions): Promise<AudioSessionState>;
  speak(text: string, options: SpeakOptions): Promise<SpeakResult>;
  /** Stops speech; every pending speak() resolves with outcome "cancelled". */
  stop(): Promise<void>;
  /**
   * Replaces the rest's natively scheduled cues (ADR 0040): each speaks at its
   * moment only while the app isn't active; a silent mixable player keeps the
   * app running in the background meanwhile. Absent in builds made before it existed.
   */
  scheduleRestCues?(cues: ScheduledCue[], options: SpeakOptions): Promise<ScheduleCuesResult>;
  /** Drops every scheduled cue and releases the session once nothing is speaking. Absent in older builds. */
  cancelRestCues?(): Promise<CancelCuesResult>;
  /** The last 20 scheduled cues' outcomes. Absent in older builds. */
  scheduledCueLog?(): ScheduledCueLogEntry[];
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

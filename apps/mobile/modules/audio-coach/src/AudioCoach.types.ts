export type AudioCategory = 'playback' | 'playAndRecord';

export interface SessionOptions {
  category?: AudioCategory;
  duckOthers?: boolean;
  interruptSpokenAudioAndMixWithOthers?: boolean;
}

export interface SpeakOptions {
  language?: string;
  /** Multiplier of the system default rate (1 = default). */
  rate?: number;
  deactivateAfter?: boolean;
}

export interface AudioSessionState {
  category: string;
  mode: string;
  categoryOptions: number;
  isOtherAudioPlaying: boolean;
  secondaryAudioShouldBeSilencedHint: boolean;
  outputs: { portType: string; portName: string }[];
}

export interface SpeakResult {
  /** false if the cue was cancelled before it finished. */
  finished: boolean;
  /** Whether other audio (music) was playing when the cue started. */
  otherAudioWasPlaying: boolean;
  category: string;
  deactivated: boolean;
  deactivationError?: string;
}

/** Raw string from the native side; see AudioCoachModule.swift. */
export type AlarmKitStatus = string;

// A type alias (not an interface) so it satisfies expo's EventsMap index constraint.
export type AudioCoachEvents = {
  onInterruption: (event: { type: 'began' | 'ended'; shouldResume: boolean }) => void;
  onRouteChange: (event: { reason: string; outputs: string[] }) => void;
};

export type AudioCategory = 'playback' | 'playAndRecord';

export interface SessionOptions {
  category?: AudioCategory;
  duckOthers?: boolean;
  interruptSpokenAudioAndMixWithOthers?: boolean;
  /**
   * playAndRecord only: also allow a Bluetooth headset mic (HFP). Bluetooth
   * output (A2DP) is always allowed, so cues reach AirPods.
   */
  bluetoothMicrophone?: boolean;
}

export interface SpeakOptions {
  language?: string;
  /** Multiplier of the system default rate (1 = default). */
  rate?: number;
  deactivateAfter?: boolean;
}

export interface AudioSessionState {
  /** configureSession only: false when a cue or the keep-alive was playing, so the options wait for the next idle cue. */
  applied?: boolean;
  category: string;
  mode: string;
  categoryOptions: number;
  isOtherAudioPlaying: boolean;
  secondaryAudioShouldBeSilencedHint: boolean;
  outputs: { portType: string; portName: string }[];
}

export type CueOutcome = 'finished' | 'cancelled' | 'timedOut';

export interface SpeakResult {
  /** true only for outcome "finished". */
  finished: boolean;
  /** Every speak() settles: finished, cancelled (stop/interruption) or timedOut. */
  outcome: CueOutcome;
  /** Cues still pending when this one was queued. */
  queuedBehind: number;
  /** Whether other audio (music) was playing when the cue started. */
  otherAudioWasPlaying: boolean;
  category: string;
  deactivated: boolean;
  /** Why the session was left active: other cues pending, the keep-alive, or not requested. */
  deactivationSkipped?: 'cuesPending' | 'keepAliveRunning' | 'notRequested';
  deactivationError?: string;
}

export interface KeepAliveStartResult {
  started: boolean;
  reason?: string;
  category?: string;
}

export interface KeepAliveStopResult {
  wasRunning: boolean;
  deactivated: boolean;
  deactivationSkipped?: string;
  deactivationError?: string;
}

/** Signing profile fields read from a bundle's embedded.mobileprovision. */
export interface SigningProfileInfo {
  profileFound: boolean;
  profileGroups?: string[];
  profileTeamId?: string;
  profileExpiresUtc?: string;
}

/**
 * Native App Group evidence for the app and the Live Activity extension; raw,
 * validated by the probe (src/probe/app-group.ts) before use.
 */
export interface AppGroupInfo extends SigningProfileInfo {
  altAppGroups?: string[];
  /** NSSupportsLiveActivities in the app's Info.plist. */
  supportsLiveActivities?: boolean;
  /** ActivityAuthorizationInfo().areActivitiesEnabled (Settings > GymSmarter > Live Activities). */
  activitiesEnabled?: boolean;
  extension?: SigningProfileInfo & {
    present: boolean;
    bundleId?: string;
    configuredGroup?: string;
    altAppGroups?: string[];
  };
  containers: Record<string, { resolved: boolean; path?: string; writeRead?: boolean; error?: string }>;
  /** Written by the patched expo-widgets in each process (patches/expo-widgets+57.0.23.patch). */
  resolutionRecords?: Record<string, unknown>[];
}

/** Raw string from the native side; see AudioCoachModule.swift. */
export type AlarmKitStatus = string;

// A type alias (not an interface) so it satisfies expo's EventsMap index constraint.
export type AudioCoachEvents = {
  onInterruption: (event: { type: 'began' | 'ended'; shouldResume: boolean }) => void;
  onRouteChange: (event: { reason: string; outputs: string[] }) => void;
};

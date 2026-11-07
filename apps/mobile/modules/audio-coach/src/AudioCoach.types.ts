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
  /** A `NativeVoice.identifier`; a voice no longer on the phone falls back to `language`, then the system default. */
  voice?: string;
  /** Multiplier of the system default rate (1 = default). */
  rate?: number;
  deactivateAfter?: boolean;
}

export interface AudioSessionState {
  /** configureSession only: false when a cue or the background hold was playing, so the options wait for the next idle cue. */
  applied?: boolean;
  category: string;
  mode: string;
  categoryOptions: number;
  isOtherAudioPlaying: boolean;
  secondaryAudioShouldBeSilencedHint: boolean;
  outputs: { portType: string; portName: string }[];
}

/** One installed iOS voice (AVSpeechSynthesisVoice), raw; validated by src/voice/voices.ts. */
export interface NativeVoice {
  identifier: string;
  name: string;
  /** BCP-47, e.g. `en-GB`. */
  language: string;
  quality: 'default' | 'enhanced' | 'premium';
  /** iOS 17+: novelty voices (Bells, Bubbles…). */
  novelty?: boolean;
  personal?: boolean;
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
  /** Why the session was left active: other cues pending, the background hold, or not requested. */
  deactivationSkipped?: 'cuesPending' | 'holdRunning' | 'notRequested';
  deactivationError?: string;
}

/** One rest cue for the native scheduler (ADR 0040). Times are Unix ms, wall clock. */
export interface ScheduledCue {
  /** `rest:<timerId>:<deadline>:warn|end`; an id that has fired never fires again. */
  id: string;
  text: string;
  fireAtMs: number;
  /** Later than this the cue is dropped, never spoken. */
  dropAfterMs: number;
}

export interface ScheduleCuesResult {
  /** false with reason `noBackgroundMode` when the build has no UIBackgroundModes audio. */
  scheduled: boolean;
  count: number;
  reason?: string;
  /** The silent, mixable player that keeps the app running in the background. */
  holdRunning?: boolean;
  holdError?: string;
}

export interface CancelCuesResult {
  cancelled: number;
  holdRunning: boolean;
}

/** What happened to a natively scheduled cue (raw; the probe validates fields before use). */
export interface ScheduledCueLogEntry {
  id?: unknown;
  fireAtMs?: unknown;
  firedAtMs?: unknown;
  /** UIApplication state when it fired: active (JS spoke it), inactive, background. */
  appState?: unknown;
  holdRunning?: unknown;
  /** spoken | skippedActive | late | speakFailed */
  outcome?: unknown;
  /** The utterance's own outcome when spoken: finished | cancelled | timedOut. */
  speakOutcome?: unknown;
  error?: unknown;
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

/** One queued Lock Screen button tap (patched expo-widgets `FizzLiveActivityTaps`); fields unchecked until parsed. */
export interface LiveActivityTapEntry {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  atMs?: unknown;
}

// A type alias (not an interface) so it satisfies expo's EventsMap index constraint.
export type AudioCoachEvents = {
  onInterruption: (event: { type: 'began' | 'ended'; shouldResume: boolean }) => void;
  onRouteChange: (event: { reason: string; outputs: string[] }) => void;
};

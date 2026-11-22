import type { ScheduleCuesResult, ScheduledCue, SpeakOptions } from '../../modules/audio-coach';

/**
 * Rest cues in the background (Ben, 1 Nov; ADR 0040). iOS suspends JS when
 * GymSmarter is in another app or locked, so the rest's cues are also handed
 * to audio-coach, which speaks them at their moment when the app isn't active
 * and keeps the app running meanwhile with a silent, mixable player. On
 * screen, JS still speaks them (the newest words). When this build can't
 * (an old build, no audio background mode), `available()` turns false and the
 * rest-done notification stays the background alert, as before. Pure: the
 * native module is a port, faked in tests.
 */

/** The audio-coach functions this needs (optional: absent in older builds). */
export interface CueSchedulingModule {
  scheduleRestCues?(cues: ScheduledCue[], options: SpeakOptions): Promise<ScheduleCuesResult>;
  cancelRestCues?(): Promise<unknown>;
}

export interface NativeCuePort {
  /** False in builds that can't speak cues in the background. */
  available(): boolean;
  /** Replaces whatever was scheduled. */
  schedule(cues: readonly ScheduledCue[]): Promise<unknown>;
  cancel(): Promise<unknown>;
}

export type NativeCueStatus = 'unknown' | 'scheduled' | 'idle' | 'no_background_mode' | 'error';

export function createNativeCueScheduler(module: CueSchedulingModule | null, speakOptions: () => SpeakOptions) {
  let status: NativeCueStatus = 'unknown';
  let lastError: string | null = null;
  const supported = () => module !== null && typeof module.scheduleRestCues === 'function' && typeof module.cancelRestCues === 'function';
  const port: NativeCuePort & { readonly status: NativeCueStatus; readonly lastError: string | null } = {
    // A build without the audio background mode says so once; nothing more is sent to it.
    available: () => supported() && status !== 'no_background_mode',
    async schedule(cues) {
      if (!supported() || module?.scheduleRestCues === undefined) return null;
      try {
        const r = await module.scheduleRestCues([...cues], speakOptions());
        status = r.scheduled ? 'scheduled' : r.reason === 'noBackgroundMode' ? 'no_background_mode' : 'idle';
        lastError = r.holdError ?? null;
        return r;
      } catch (e) {
        status = 'error';
        lastError = e instanceof Error ? e.message : String(e);
        return null;
      }
    },
    async cancel() {
      if (!supported() || module?.cancelRestCues === undefined) return null;
      try {
        const r = await module.cancelRestCues();
        status = 'idle';
        return r;
      } catch (e) {
        status = 'error';
        lastError = e instanceof Error ? e.message : String(e);
        return null;
      }
    },
    get status() {
      return status;
    },
    get lastError() {
      return lastError;
    },
  };
  return port;
}

/**
 * Tap-to-talk for the coach bars (workout-builder-v3 §2.6; brief build step
 * 5): the mic starts listening at once, live words show, and it stops on
 * silence or a second tap; the words then open the coach sheet. On-device
 * only: when the phone has no on-device recogniser, the mic is `⊘` and
 * nothing starts, so no audio ever leaves the phone (no server fallback).
 *
 * Pure: the recogniser is a port (`SpeechInputPort`, the Expo adapter is
 * `on-device-speech.ts`); tested on Linux with a fake.
 */

import type { MicState } from '../coach/builder-coach-view';

export interface SpeechSession {
  stop(): void;
}

export interface SpeechInputPort {
  /** A recogniser exists AND it can run on the device for Ben's language. Checked at run time, every tap. */
  onDeviceAvailable(): Promise<boolean>;
  /** Mic and speech-recognition permission (asks once; iOS remembers). */
  permission(): Promise<'granted' | 'denied'>;
  /** Start listening with on-device recognition only. Events until `end`; `stop` ends it early. */
  start(handlers: { partial: (text: string) => void; final: (text: string) => void; error: (code: string) => void; end: () => void }): SpeechSession;
}

export interface DictationEvents {
  /** The mic's state changed. */
  state: (s: MicState) => void;
  /** Live words while listening. */
  partial: (text: string) => void;
  /** What was heard, when listening ends with words (opens the coach sheet with them). */
  done: (text: string) => void;
}

export interface Dictation {
  state(): MicState;
  /** The mic: idle → listening; listening → stop (words so far are kept). `unavailable`/`denied`: nothing starts. */
  tap(): Promise<MicState>;
  /** Stop without sending (sheet closed). */
  cancel(): void;
}

export function createDictation(port: SpeechInputPort, on: DictationEvents): Dictation {
  let state: MicState = 'idle';
  let session: SpeechSession | null = null;
  let heard = '';
  let ticket = 0;
  const set = (s: MicState): void => {
    state = s;
    on.state(s);
  };
  const finish = (t: number, send: boolean): void => {
    if (t !== ticket) return;
    ticket += 1;
    session = null;
    const words = heard.trim();
    heard = '';
    set('idle');
    if (send && words !== '') on.done(words);
  };

  return {
    state: () => state,
    async tap(): Promise<MicState> {
      if (state === 'listening') {
        const t = ticket;
        session?.stop();
        finish(t, true);
        return state;
      }
      // Runtime check every time (not only the probe): a language change or a removed model shows ⊘.
      const available = await port.onDeviceAvailable().catch(() => false);
      if (!available) {
        set('unavailable');
        return state;
      }
      const perm = await port.permission().catch(() => 'denied' as const);
      if (perm !== 'granted') {
        set('denied');
        return state;
      }
      ticket += 1;
      const t = ticket;
      heard = '';
      set('listening');
      try {
        session = port.start({
          partial: (text) => {
            if (t !== ticket) return;
            heard = text;
            on.partial(text);
          },
          final: (text) => {
            if (t !== ticket) return;
            heard = text;
            finish(t, true);
          },
          error: () => {
            finish(t, true);
          },
          end: () => {
            finish(t, true);
          },
        });
      } catch {
        finish(t, false);
      }
      return state;
    },
    cancel(): void {
      const t = ticket;
      session?.stop();
      heard = '';
      finish(t, false);
    },
  };
}

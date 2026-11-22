/**
 * One voice, two kinds of speech (review S1): workout cues always win over a
 * coach reply. The audio-coach module has one synthesizer and its `stop()`
 * cancels everything queued, so the order is kept here, in JS:
 *
 * - a cue stops a reply that is speaking and speaks at once (never queued
 *   behind a long reply, so never late);
 * - a reply waits for any cue still speaking, then speaks;
 * - stopping replies (typing, closing the sheet, a new reply) never reaches a
 *   cue: while a cue is speaking, a waiting reply is just dropped, and the
 *   native stop is only called when a reply is what's speaking.
 *
 * Pure: the raw speaker is a port; tested on Linux with a fake.
 */

export type SpeechPurpose = 'cue' | 'reply';

export interface RawSpeaker {
  available(): boolean;
  /** Resolves when the utterance finishes or is cancelled. */
  speak(text: string): Promise<unknown>;
  /** Cancels everything speaking and queued. */
  stop(): Promise<void>;
}

export interface Speaker {
  available(): boolean;
  speak(text: string, purpose: SpeechPurpose): Promise<unknown>;
  /** Stops coach replies only; a cue speaking or queued is never cut. */
  stop(): Promise<void>;
}

export function createSpeechArbiter(raw: RawSpeaker): Speaker {
  /** Cue utterances handed to the module and not finished. */
  let cues = 0;
  let cuesDone: Promise<void> = Promise.resolve();
  /** The reply handed to the module and not finished (0 = none). */
  let replyOnAir = 0;
  /** Bumped by every stop and every new reply: a waiting reply whose ticket is old never speaks. */
  let replyTicket = 0;

  async function speakCue(text: string): Promise<unknown> {
    cues += 1;
    let finish: () => void = () => undefined;
    const prior = cuesDone;
    cuesDone = new Promise<void>((resolve) => {
      finish = resolve;
    }).then(() => prior);
    try {
      if (replyOnAir !== 0) {
        replyOnAir = 0;
        replyTicket += 1;
        await raw.stop().catch(() => undefined);
      }
      return await raw.speak(text);
    } finally {
      cues -= 1;
      finish();
    }
  }

  async function speakReply(text: string): Promise<unknown> {
    const ticket = ++replyTicket;
    while (cues > 0) {
      await cuesDone;
      if (ticket !== replyTicket) return null;
    }
    if (ticket !== replyTicket) return null;
    replyOnAir = ticket;
    try {
      return await raw.speak(text);
    } finally {
      if (replyOnAir === ticket) replyOnAir = 0;
    }
  }

  return {
    available: () => raw.available(),
    speak(text, purpose) {
      return purpose === 'cue' ? speakCue(text) : speakReply(text);
    },
    async stop() {
      replyTicket += 1;
      if (replyOnAir === 0 || cues > 0) {
        // Nothing of ours speaking, or a cue is: a waiting reply is dropped by its ticket; the cue plays on.
        replyOnAir = 0;
        return;
      }
      replyOnAir = 0;
      await raw.stop().catch(() => undefined);
    },
  };
}

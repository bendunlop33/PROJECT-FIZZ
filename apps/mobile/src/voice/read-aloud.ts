import { spokenReplyText } from '@fizz/domain';

import type { ReadReplies } from './settings';

/**
 * Coach replies read aloud (Ben, 19 Oct 2026). On by default only in the
 * coach sheet over a live workout; the sheet's speaker toggle mirrors the
 * setting. Speech stops when Ben starts typing, closes the sheet, or a new
 * reply arrives. Never an OpenAI or other paid voice (rule 7): the Apple
 * voice through the audio-coach module only. Pure, tested on Linux.
 */

export function readRepliesOn(mode: ReadReplies, liveWorkout: boolean): boolean {
  return mode === 'always' || (mode === 'workout' && liveWorkout);
}

/** The header toggle: off → Off; on → During workouts in a workout, else Always. */
export function toggleReadReplies(mode: ReadReplies, liveWorkout: boolean): ReadReplies {
  if (readRepliesOn(mode, liveWorkout)) return 'off';
  return liveWorkout ? 'workout' : 'always';
}

/** What of a finished turn is spoken: its sentences, shortened; null when nothing (failed, replayed, empty, or off). */
export function replyToSpeak(
  result: { status: string; replayed: boolean; items: readonly ({ kind: 'sentence'; text: string } | { kind: string })[] },
  on: boolean,
): string | null {
  if (!on || result.status !== 'completed' || result.replayed) return null;
  const text = result.items
    .map((i) => (i.kind === 'sentence' && 'text' in i ? i.text : ''))
    .filter((t) => t.trim() !== '')
    .join(' ');
  const spoken = spokenReplyText(text);
  return spoken === '' ? null : spoken;
}

export interface ReplySpeaker {
  available(): boolean;
  speak(text: string, purpose: 'cue' | 'reply'): Promise<unknown>;
  stop(): Promise<void>;
}

/**
 * The sheet's reply voice. `say` stops a reply still speaking first (a new
 * reply arrived); `hush` (typing, closing) stops only a reply this voice
 * started that hasn't finished, so a rest cue playing meanwhile isn't cut.
 */
export function createReplyVoice(speaker: ReplySpeaker) {
  /** The `seq` of the reply speaking now; 0 = none of ours. */
  let speaking = 0;
  let seq = 0;
  async function hush(): Promise<void> {
    if (speaking === 0) return;
    speaking = 0;
    await speaker.stop().catch(() => undefined);
  }
  return {
    say(text: string): Promise<void> {
      if (!speaker.available()) return Promise.resolve();
      const interrupting = speaking !== 0;
      const mine = ++seq;
      speaking = mine;
      return (async () => {
        if (interrupting) await speaker.stop().catch(() => undefined);
        // Hushed (typing, closing) before it started: say nothing.
        if (speaking !== mine) return;
        try {
          await speaker.speak(text, 'reply');
        } catch {
          // Never throws into the sheet.
        } finally {
          if (speaking === mine) speaking = 0;
        }
      })();
    },
    hush,
    get speaking(): boolean {
      return speaking !== 0;
    },
  };
}

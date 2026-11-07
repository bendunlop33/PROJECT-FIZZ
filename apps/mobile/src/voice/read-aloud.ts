import { spokenReplyText } from '@fizz/domain';

import type { ReadReplies } from './settings';

/**
 * Coach replies read aloud (Ben, 19 Oct 2026). With the default "During
 * workouts", on whenever a workout is in progress, however the sheet was
 * opened (review S4); the sheet's speaker button overrides it for that sheet
 * only (review S5). Speech stops when Ben starts typing, closes the sheet, or a new
 * reply arrives. Never an OpenAI or other paid voice (rule 7): the Apple
 * voice through the audio-coach module only. Pure, tested on Linux.
 */

export function readRepliesOn(mode: ReadReplies, liveWorkout: boolean): boolean {
  return mode === 'always' || (mode === 'workout' && liveWorkout);
}

/**
 * The sheet's speaker button (review S5): a choice for this sheet only, never
 * written to Settings › Voice. `override` null = the setting decides.
 */
export function sheetReadOn(mode: ReadReplies, liveWorkout: boolean, override: boolean | null): boolean {
  return override ?? readRepliesOn(mode, liveWorkout);
}

/** Where the sheet is when a reply arrives: closed (or covered), or Ben already typing the next message. */
export interface SheetMoment {
  open: boolean;
  typing: boolean;
}

/**
 * What of a finished turn is spoken: its sentences, shortened; null when
 * nothing (failed, replayed, empty, off, the sheet closed before the reply
 * arrived, or Ben typing again — review B2).
 */
export function replyToSpeak(
  result: { status: string; replayed: boolean; items: readonly ({ kind: 'sentence'; text: string } | { kind: string })[] },
  on: boolean,
  sheet: SheetMoment,
): string | null {
  if (!on || !sheet.open || sheet.typing || result.status !== 'completed' || result.replayed) return null;
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
 * started that hasn't finished. The speaker's `stop` is reply-only (the
 * arbiter, review S1), so a rest cue is never cut.
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

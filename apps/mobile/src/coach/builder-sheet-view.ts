import { BUILDER_STATUS_WORD, type BuilderCoachReach, type BuilderProposal } from '@fizz/coach';

import { EDIT_ASK_COPY, proposalCardView, replyCardView, type EditAskView, type ProposalCardView, type ProposalState } from './builder-coach-view';

/**
 * (Ben, 26 Oct, follow-up 3 option a) Your workout's coach bar opens the coach sheet with a `builder` entry. Typed
 * words go through the builder's `askEdit` and come back as proposal cards with Apply / Skip in the sheet. Nothing
 * is written to the draft without Apply (rule 3); Apply is checked again against the draft as it is then
 * (version-fenced, `Out of date. Ask again.`), and an applied card keeps its Undo. Pure; the screen holds the turns.
 */

export type BuilderTurnResult =
  | { kind: 'asking' }
  | { kind: 'proposal'; proposal: BuilderProposal; state: ProposalState; /** After Apply: the Undo's outcome. */ undo: 'available' | 'undone' | 'not_undone' | null }
  /** The coach's checked words with nothing to apply. */
  | { kind: 'reply'; text: string }
  /**
   * One short line: no answer, couldn't reach, offline, not connected, workout gone. `retry` (Ben, 26 Oct): the ask
   * can be sent again as it was (`Retry`, or his "again"); false when the workout is gone.
   */
  | { kind: 'line'; text: string; retry?: boolean };

export interface BuilderTurn {
  /** The ask's op ID (also the proposal's ID). */
  id: string;
  words: string;
  atUtc: string;
  tz: string;
  result: BuilderTurnResult;
}

export const BUILDER_SHEET_COPY = {
  title: 'Coach',
  placeholder: 'Ask the coach to change it',
  gone: 'Workout unavailable',
  undo: 'Undo',
  undone: 'Undone',
  notUndone: 'Not undone',
  notApplied: EDIT_ASK_COPY.notApplied,
  retry: EDIT_ASK_COPY.retry,
} as const;

/** `Sees: Push A (draft)`, as the general sheet names a draft. */
export function builderSeesLabel(name: string): string {
  return `Sees: ${name} (draft)`;
}

/** The status row: the one word when the coach can't answer, and whether Send works. */
export function builderSheetStatus(reach: BuilderCoachReach, asking: boolean): { word: string | null; canSend: boolean } {
  return { word: reach === 'ok' ? null : BUILDER_STATUS_WORD[reach], canSend: reach === 'ok' && !asking };
}

/** Ben sent words: a new turn, `asking` until the answer lands. One at a time: none while another is asking. */
export function askTurn(turns: readonly BuilderTurn[], t: { id: string; words: string; atUtc: string; tz: string }): BuilderTurn[] {
  if (turns.some((x) => x.result.kind === 'asking') || t.words.trim() === '') return [...turns];
  return [...turns, { ...t, words: t.words.trim(), result: { kind: 'asking' } }];
}

/**
 * The answer landed. `reach`: the sheet's status changes too (offline / not connected; back to `ok` when the coach
 * answered, e.g. after a Retry), null: unchanged.
 */
export function settleTurn(turns: readonly BuilderTurn[], id: string, v: EditAskView): { turns: BuilderTurn[]; reach: BuilderCoachReach | null } {
  let reach: BuilderCoachReach | null = null;
  const result = ((): BuilderTurnResult => {
    switch (v.kind) {
      case 'proposal':
        reach = 'ok';
        return { kind: 'proposal', proposal: v.proposal, state: 'open', undo: null };
      case 'reply':
        reach = 'ok';
        return { kind: 'reply', text: v.text };
      case 'toast':
        return { kind: 'line', text: v.text, retry: true };
      case 'reach':
        reach = v.reach;
        return { kind: 'line', text: BUILDER_STATUS_WORD[v.reach], retry: v.reach === 'offline' };
      case 'gone':
        return { kind: 'line', text: BUILDER_SHEET_COPY.gone };
      case 'none':
        return { kind: 'line', text: EDIT_ASK_COPY.noAnswer, retry: true };
    }
  })();
  return { turns: turns.map((t) => (t.id === id ? { ...t, result } : t)), reach };
}

/**
 * (Ben, 26 Oct: "Again" after `Offline` was read as a new request) Words that only ask to send the last one again.
 * Read only right after an ask that got no answer.
 */
const RESEND = /^(?:(?:ok(?:ay)?|please|yes|so|now)[,!.]?\s+)*(?:again|try (?:it |that )?again|retry|resend|send (?:it|that) again|one more time|repeat (?:it|that)|do (?:it|that) again|go again)(?:\s+(?:please|now|then))*[.!?]*$/i;

export function asksResend(words: string): boolean {
  return RESEND.test(words.trim().replace(/[‘’]/g, "'"));
}

/** The turn Ben's Retry (or his "again") sends again: the last one, when it got no answer and can be retried. */
export function retryableTurn(turns: readonly BuilderTurn[]): BuilderTurn | null {
  const last = turns[turns.length - 1];
  return last !== undefined && last.result.kind === 'line' && last.result.retry === true ? last : null;
}

/**
 * What Send does with Ben's words: a new ask, or (`retry`) the last unanswered ask again, as he first wrote it,
 * when his words only ask for that ("Again", "Try again").
 */
export function sendPlan(turns: readonly BuilderTurn[], words: string): { kind: 'ask'; words: string } | { kind: 'retry'; turn: BuilderTurn } {
  const last = retryableTurn(turns);
  return last !== null && asksResend(words) ? { kind: 'retry', turn: last } : { kind: 'ask', words: words.trim() };
}

/** Retry: the turn asks again with its own words and ID (nothing was written for it). One at a time. */
export function retryTurn(turns: readonly BuilderTurn[], id: string): BuilderTurn[] {
  if (turns.some((x) => x.result.kind === 'asking')) return [...turns];
  return turns.map((t) => (t.id === id && t.result.kind === 'line' && t.result.retry === true ? { ...t, result: { kind: 'asking' } } : t));
}

/** Apply's outcome (`failed`: the write didn't happen, the card stays open with `Not applied`). */
export function applyTurn(turns: readonly BuilderTurn[], id: string, outcome: 'applied' | 'out_of_date' | 'failed'): BuilderTurn[] {
  return turns.map((t) => {
    if (t.id !== id || t.result.kind !== 'proposal' || t.result.state !== 'open') return t;
    if (outcome === 'failed') return t;
    return { ...t, result: { ...t.result, state: outcome, undo: outcome === 'applied' ? 'available' : null } };
  });
}

/** Skip: nothing is written; the card stays as `Skipped`. */
export function skipTurn(turns: readonly BuilderTurn[], id: string): BuilderTurn[] {
  return turns.map((t) => (t.id === id && t.result.kind === 'proposal' && t.result.state === 'open' ? { ...t, result: { ...t.result, state: 'skipped' } } : t));
}

/** Undo on an applied card: once. */
export function undoTurn(turns: readonly BuilderTurn[], id: string, ok: boolean): BuilderTurn[] {
  return turns.map((t) => (t.id === id && t.result.kind === 'proposal' && t.result.undo === 'available' ? { ...t, result: { ...t.result, undo: ok ? 'undone' : 'not_undone' } } : t));
}

/** The card a settled turn shows (the same view as the builder's proposal sheet), or null while asking / for a line. */
export function turnCard(t: BuilderTurn): (ProposalCardView & { undoState: string | null }) | null {
  switch (t.result.kind) {
    case 'proposal': {
      const card = proposalCardView(t.result.proposal, t.result.state);
      const u = t.result.undo;
      return { ...card, undo: u === 'available', undoState: u === 'undone' ? BUILDER_SHEET_COPY.undone : u === 'not_undone' ? BUILDER_SHEET_COPY.notUndone : null };
    }
    case 'reply':
      return { ...replyCardView(t.result.text), undoState: null };
    case 'asking':
    case 'line':
      return null;
  }
}

/** The coach sheet's entry from Your workout (a route param, not a thread entry: nothing is stored as a conversation). */
export interface BuilderCoachEntry {
  kind: 'builder';
  draftId: string;
  name: string;
}

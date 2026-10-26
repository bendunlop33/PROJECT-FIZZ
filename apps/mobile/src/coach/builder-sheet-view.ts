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
  /** One short line: no answer, offline, not connected, workout gone. */
  | { kind: 'line'; text: string };

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

/** The answer landed. `reach`: the sheet's status changes too (offline / not connected). */
export function settleTurn(turns: readonly BuilderTurn[], id: string, v: EditAskView): { turns: BuilderTurn[]; reach: Exclude<BuilderCoachReach, 'ok'> | null } {
  let reach: Exclude<BuilderCoachReach, 'ok'> | null = null;
  const result = ((): BuilderTurnResult => {
    switch (v.kind) {
      case 'proposal':
        return { kind: 'proposal', proposal: v.proposal, state: 'open', undo: null };
      case 'reply':
        return { kind: 'reply', text: v.text };
      case 'toast':
        return { kind: 'line', text: v.text };
      case 'reach':
        reach = v.reach;
        return { kind: 'line', text: BUILDER_STATUS_WORD[v.reach] };
      case 'gone':
        return { kind: 'line', text: BUILDER_SHEET_COPY.gone };
      case 'none':
        return { kind: 'line', text: EDIT_ASK_COPY.noAnswer };
    }
  })();
  return { turns: turns.map((t) => (t.id === id ? { ...t, result } : t)), reach };
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

/**
 * The workout's coach slot (coach-adjustments §2.1–2.6, ADR 0020 C7). Pure.
 * One item at most; priority pending > applied banner > outcome line >
 * offer. Every value line comes from a saved `ActionRecord`
 * (`renderActionResult(…, 'slot')`), never from the model's words. Minimal
 * copy: the coach's reason sits behind `Why?`.
 */

import { renderActionResult, type CoachTurnResult } from '@fizz/coach';
import { coachUndoRefusal, type CoachTrigger } from '@fizz/domain';
import type { ActionRecord, SessionAggregate } from '@fizz/schemas';

import type { CoachAvailability, WorkoutOffer } from './coach-service';
import { outcomeFor } from './sheet-view';

export type SlotView =
  | { kind: 'pending'; title: string; cancel: true }
  /** `tag`: `Rule` when the built-in rule made the change (CA6 revised), else null (the coach's). */
  | { kind: 'banner'; actionId: string; title: string; detail: string | null; notes: string[]; canUndo: boolean; tag: 'Rule' | null }
  | { kind: 'outcome'; text: string; retry: boolean }
  /** `change`: the rule's concrete change (`Next sets: 57.5 kg × 3–6`), tagged `Rule`; null for the coach's offer. */
  | { kind: 'offer'; prompt: string; fact: string; triggerKind: CoachTrigger['kind']; change: string | null; tag: 'Rule' | null };

export interface SlotInput {
  pending: boolean;
  /** The latest coach adjustment in this workout (from the latest result or the store). */
  adjustment: ActionRecord | null;
  /** The latest turn's outcome when it changed nothing (refused, stale, failed). */
  outcome: { text: string; retry: boolean } | null;
  offer: WorkoutOffer | null;
  /** The workout as loaded, to hide Undo on a change that can't be undone now (gym changed since; review r2 B1). */
  workout?: Pick<SessionAggregate, 'session' | 'sets'> | null;
}

/**
 * The banner's visible notes (minimal-copy W13): only a pain block, as one
 * short warning. Every other guard note is a `Why?` check. `Pain flag` only
 * when a saved flag blocked it (`pain_blocked`); a pain mention in chat or
 * the check-in writes no flag, so it reads `Pain mentioned` (review B1).
 */
function slotNotes(notes: readonly { kind: string }[]): string[] {
  if (notes.some((n) => n.kind === 'pain_blocked')) return ['Pain flag · no increases'];
  if (notes.some((n) => n.kind === 'pain_mentioned' || n.kind === 'pain_unspecified')) return ['Pain mentioned · no increases'];
  return [];
}

/** A change to today's sets the slot shows as its banner: the coach's (`edit_today`; before Coach v3, `adjust_pending_sets`) or the built-in rule's. */
export function isTodayChange(r: ActionRecord): boolean {
  return r.detail.kind === 'adjust_pending_sets' || r.detail.kind === 'edit_today';
}

export function slotView(input: SlotInput): SlotView | null {
  if (input.pending) return { kind: 'pending', title: 'Coach is working…', cancel: true };
  const a = input.adjustment;
  if (a !== null && isTodayChange(a) && a.status === 'committed') {
    const r = renderActionResult(a, 'slot');
    const byRule = a.author !== 'coach';
    if (a.undoneBy !== null) return { kind: 'outcome', text: byRule ? 'Change undone.' : 'Coach change undone.', retry: false };
    return { kind: 'banner', actionId: a.actionId, title: r.text, detail: r.detail, notes: slotNotes(a.guardNotes), canUndo: input.workout == null || coachUndoRefusal(input.workout, a.actionId) === null, tag: byRule ? 'Rule' : null };
  }
  if (input.outcome !== null) return { kind: 'outcome', text: input.outcome.text, retry: input.outcome.retry };
  if (input.offer !== null) {
    const o = input.offer;
    return { kind: 'offer', prompt: o.prompt, fact: o.fact, triggerKind: o.kind, change: o.by === 'rule' ? o.change : null, tag: o.by === 'rule' ? 'Rule' : null };
  }
  return null;
}

/**
 * The banner's record read again from the store (after the workout reloads,
 * say on return from the sheet): an Undo made elsewhere shows as undone here
 * too, instead of a banner with an Undo that can't work. A failed read keeps
 * what is shown.
 */
export async function syncAdjustment(cached: ActionRecord | null, read: (actionId: string) => Promise<ActionRecord | null>): Promise<ActionRecord | null> {
  if (cached === null || cached.undoneBy !== null) return cached;
  const fresh = await read(cached.actionId).catch(() => null);
  return fresh ?? cached;
}

/**
 * What a finished Adjust turn leaves in the slot: its adjustment card, or
 * one line saying what happened (nothing changed). Never the model's words.
 */
export function slotAfterTurn(result: CoachTurnResult, opts: { workoutModelGone?: boolean } = {}): { adjustment: ActionRecord | null; outcome: { text: string; retry: boolean } | null } {
  const adjust = result.cards.map((c) => c.record).filter(isTodayChange);
  const committed = adjust.find((r) => r.status === 'committed') ?? null;
  if (committed !== null) return { adjustment: committed, outcome: null };
  const refused = adjust[0];
  if (refused !== undefined) {
    const text = refused.status === 'stale' ? 'Out of date' : renderActionResult(refused, 'slot').text;
    return { adjustment: null, outcome: { text, retry: refused.status === 'stale' } };
  }
  const failed = outcomeFor(result.status, result.error, result.cards.length > 0, opts);
  if (failed !== null) return { adjustment: null, outcome: failed };
  return { adjustment: null, outcome: { text: 'No change made.', retry: false } };
}

/**
 * (Coach v3 review S5; Ben's build 156 report "Not adjusting during workout") A `Too easy` /
 * `Too hard` turn the coach finished with a question and no change to today's sets, saved or
 * offered: it asked instead of acting ("Was that the warm-up or a working set?"). Ben's tap was the
 * request, so the built-in rule's change applies in its place. A plain answer with no change ("Keep
 * the load.") is the coach's answer and stands.
 */
export function coachAskedInstead(result: CoachTurnResult | null): boolean {
  if (result === null || result.status !== 'completed' || result.offer !== null) return false;
  if (result.cards.some((c) => isTodayChange(c.record))) return false;
  return result.items.some((i) => i.kind === 'sentence' && /\?["”’)]*\s*$/.test(i.text));
}

/**
 * F3: whether a turn started from an offer's `Adjust` ended without the
 * coach answering (no network, not available), so the built-in rule's
 * offer can take its place. A turn the coach completed (even with no
 * change) is the coach's answer and stands.
 */
export function coachCouldNotAnswer(result: CoachTurnResult | null): boolean {
  if (result === null) return true;
  if (result.cards.some((c) => isTodayChange(c.record) && c.record.status === 'committed')) return false;
  // Ben's own Cancel isn't the coach failing to answer.
  return result.status === 'failed' && result.error !== 'cancelled';
}

/**
 * The slot after a turn that threw (review N2): "Nothing changed" only when
 * the turn saved nothing. A change saved before the error (say, the reply
 * failed to save) still shows as its banner with Undo.
 */
export function slotAfterFailure(saved: readonly ActionRecord[]): { adjustment: ActionRecord | null; outcome: { text: string; retry: boolean } | null } {
  const committed = saved.find((r) => r.status === 'committed' && isTodayChange(r)) ?? null;
  if (committed !== null) return { adjustment: committed, outcome: null };
  if (saved.some((r) => r.status === 'committed')) return { adjustment: null, outcome: { text: 'Couldn’t reach the coach.', retry: false } };
  return { adjustment: null, outcome: { text: 'Couldn’t reach the coach. Nothing changed.', retry: true } };
}

/**
 * F7: which logged sets to check for an offer now. Offers only show on the
 * rest card, so a set logged with no rest running (a superset's 0 s
 * transition, an exercise with no rest) is held and checked when the next
 * rest starts, newest first. Holds at most `max`.
 */
export function offerCandidates(held: readonly string[], setId: string, resting: boolean, max = 6): { check: string[]; held: string[] } {
  const all = [setId, ...held.filter((id) => id !== setId)];
  if (!resting) return { check: [], held: all.slice(0, max) };
  return { check: all.slice(0, max + 1), held: [] };
}

/** One line when Ben's `Adjust` on the rule's offer changed nothing (minimal copy). */
export function ruleOfferOutcome(status: 'stale' | 'unchanged' | 'failed'): { text: string; retry: boolean } {
  switch (status) {
    case 'stale':
      return { text: 'Out of date. Nothing changed.', retry: false };
    case 'unchanged':
      return { text: 'Nothing to change.', retry: false };
    case 'failed':
      return { text: 'Couldn’t save. Nothing changed.', retry: false };
  }
}

/**
 * The `Adjust` control (§2.2): which chips it offers now, and the coach's
 * state when it can't answer. The button's word is always `Adjust`; the state
 * is a small icon (`icon`), read in `accessibilityLabel`, and its word
 * (`caption`) is the open row's `line` (design pass 1.9, Ben approved 20 Oct).
 */
export interface AdjustControlView {
  caption: string | null;
  icon: 'wifi.slash' | 'bolt.slash' | null;
  accessibilityLabel: string;
  chips: ('too_hard' | 'too_easy' | 'pain' | 'type')[];
  /** Shown when the row opens and the coach can't answer: its state, in a word. */
  line: string | null;
}

export function adjustControlView(a: CoachAvailability): AdjustControlView {
  if (a.status === 'ok') return { caption: null, icon: null, accessibilityLabel: 'Adjust', chips: ['too_hard', 'too_easy', 'pain', 'type'], line: null };
  if (a.status === 'offline') return { caption: 'Offline', icon: 'wifi.slash', accessibilityLabel: 'Adjust, coach offline', chips: ['too_hard', 'too_easy', 'pain', 'type'], line: 'Offline' };
  // No coach: Too hard / Too easy are the built-in rule's (review coach-fallback S1); typing needs the coach.
  const caption = a.status === 'not_connected' ? 'Not connected' : 'Unavailable';
  return { caption, icon: 'bolt.slash', accessibilityLabel: `Adjust, coach ${caption.toLowerCase()}`, chips: ['too_hard', 'too_easy', 'pain'], line: caption };
}

export const ADJUST_CHIP_LABEL: Record<AdjustControlView['chips'][number], string> = { too_hard: 'Too hard', too_easy: 'Too easy', pain: 'Pain', type: 'Type…' };

/** An offer's `Adjust` counts as Ben asking (CA1): the trigger's direction becomes his chip. */
export function chipForTrigger(kind: CoachTrigger['kind']): 'too_hard' | 'too_easy' {
  return kind === 'rpe_low' ? 'too_easy' : 'too_hard';
}

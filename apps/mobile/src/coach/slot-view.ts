/**
 * The workout's coach slot (coach-adjustments §2.1–2.6, ADR 0020 C7). Pure.
 * One item at most; priority pending > applied banner > outcome line >
 * offer. Every value line comes from a saved `ActionRecord`
 * (`renderActionResult(…, 'slot')`), never from the model's words. Minimal
 * copy: the coach's reason sits behind `Why?`.
 */

import { renderActionResult, type CoachTurnResult } from '@fizz/coach';
import type { CoachTrigger } from '@fizz/domain';
import type { ActionRecord } from '@fizz/schemas';

import type { CoachAvailability } from './coach-service';
import { outcomeFor } from './sheet-view';

export type SlotView =
  | { kind: 'pending'; title: string; cancel: true }
  | { kind: 'banner'; actionId: string; title: string; detail: string | null; notes: string[]; canUndo: boolean }
  | { kind: 'outcome'; text: string; retry: boolean }
  | { kind: 'offer'; prompt: string; fact: string; triggerKind: CoachTrigger['kind'] };

export interface SlotInput {
  pending: boolean;
  /** The latest coach adjustment in this workout (from the latest result or the store). */
  adjustment: ActionRecord | null;
  /** The latest turn's outcome when it changed nothing (refused, stale, failed). */
  outcome: { text: string; retry: boolean } | null;
  offer: (CoachTrigger & { sessionExerciseId: string }) | null;
}

export function slotView(input: SlotInput): SlotView | null {
  if (input.pending) return { kind: 'pending', title: 'Coach is working…', cancel: true };
  const a = input.adjustment;
  if (a !== null && a.detail.kind === 'adjust_pending_sets' && a.status === 'committed') {
    const r = renderActionResult(a, 'slot');
    if (a.undoneBy !== null) return { kind: 'outcome', text: 'Coach change undone.', retry: false };
    return { kind: 'banner', actionId: a.actionId, title: r.text, detail: r.detail, notes: [...new Set(a.guardNotes.filter((n) => n.kind !== 'completed_set_dropped').map((n) => n.text))].slice(0, 2), canUndo: true };
  }
  if (input.outcome !== null) return { kind: 'outcome', text: input.outcome.text, retry: input.outcome.retry };
  if (input.offer !== null) return { kind: 'offer', prompt: input.offer.prompt, fact: input.offer.fact, triggerKind: input.offer.kind };
  return null;
}

/**
 * What a finished Adjust turn leaves in the slot: its adjustment card, or
 * one line saying what happened (nothing changed). Never the model's words.
 */
export function slotAfterTurn(result: CoachTurnResult): { adjustment: ActionRecord | null; outcome: { text: string; retry: boolean } | null } {
  const adjust = result.cards.map((c) => c.record).filter((r) => r.detail.kind === 'adjust_pending_sets');
  const committed = adjust.find((r) => r.status === 'committed') ?? null;
  if (committed !== null) return { adjustment: committed, outcome: null };
  const refused = adjust[0];
  if (refused !== undefined) {
    const text = refused.status === 'stale' ? 'Your workout moved on. Nothing changed.' : renderActionResult(refused, 'slot').text;
    return { adjustment: null, outcome: { text, retry: refused.status === 'stale' } };
  }
  const failed = outcomeFor(result.status, result.error, result.cards.length > 0);
  if (failed !== null) return { adjustment: null, outcome: failed };
  return { adjustment: null, outcome: { text: 'No change made.', retry: false } };
}

/** The `Adjust` control (§2.2): its caption and which chips it offers now. */
export interface AdjustControlView {
  caption: string | null;
  chips: ('too_hard' | 'too_easy' | 'pain' | 'type')[];
  /** Shown when the row opens and the coach can't answer. */
  line: string | null;
}

export function adjustControlView(a: CoachAvailability): AdjustControlView {
  if (a.status === 'ok') return { caption: null, chips: ['too_hard', 'too_easy', 'pain', 'type'], line: null };
  if (a.status === 'offline') return { caption: 'Offline', chips: ['too_hard', 'too_easy', 'pain', 'type'], line: null };
  return { caption: a.status === 'not_connected' ? 'Not connected' : 'Unavailable', chips: ['pain'], line: 'Sets unchanged.' };
}

export const ADJUST_CHIP_LABEL: Record<AdjustControlView['chips'][number], string> = { too_hard: 'Too hard', too_easy: 'Too easy', pain: 'Pain', type: 'Type…' };

/** An offer's `Adjust` counts as Ben asking (CA1): the trigger's direction becomes his chip. */
export function chipForTrigger(kind: CoachTrigger['kind']): 'too_hard' | 'too_easy' {
  return kind === 'rpe_low' ? 'too_easy' : 'too_hard';
}

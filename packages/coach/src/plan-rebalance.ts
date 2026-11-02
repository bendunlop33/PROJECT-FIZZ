import type { ActionDetail } from '@fizz/schemas';

import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * `propose_rebalance` (Ben, 2 Nov: "am I doing enough biceps?", "rebalance my plan"). Plan › Muscles' **Rebalance**
 * from any chat: the app's port runs the **same engine** the screen runs (`planMuscles.rebalance`) on the plan in use
 * and the record keeps exactly that card (each day's line, the bars, the day lengths, Why?), so the coach and the screen
 * can never disagree. Always a proposal (rule 3): per-line skip, Apply (the screen's versioned plan edit, refused when
 * the plan moved on, rule 5) and Undo, on the card. Offered only on Ben's muscle or balance words while a builder plan
 * runs (a targeted tool group, so other turns don't grow). The muscle ranges are the approved ones (V1/V4 as amended
 * 1 Nov); no focus input: the engine fills every gap in order.
 */

export type RebalancePrepared =
  | { kind: 'ok'; detail: Extract<ActionDetail, { kind: 'propose_rebalance' }> }
  /** Nothing to propose (every group in range, or nothing fits the days' time), or no builder plan runs. */
  | { kind: 'refused'; line: string };

export interface RebalanceDeps {
  store: CoachWriteStore;
  /** The screen's Rebalance card for the plan in use, as the record keeps it; nothing is written here. */
  prepare(): Promise<RebalancePrepared>;
}

/** Sent while the tool is offered. */
export const REBALANCE_TOOL_LINE =
  'For whether his plan trains each muscle enough, read plan.inUse.muscles (direct sets a week against the range). To even it out across the whole plan, call propose_rebalance: it makes Plan › Muscles’ Rebalance card (trims, swaps, supersets, adds, each day within its time, at most +2 sets a group), a proposal he applies line by line. Use it rather than several propose_plan_add calls for muscle gaps; propose_plan_add stays for one exercise he names.';

/** Ben's words ask about his muscles' balance or volume: "am I doing enough biceps?", "rebalance my plan", "too much chest". */
const REBALANCE_WORD = /\b(?:re-?balanc\w*|balanc\w*|imbalanc\w*|lopsided)\b/i;
const VOLUME_WORD = /\b(?:enough|too (?:much|little|many|few)|volume|sets (?:a|per) week|weekly sets|neglect\w*|lagging|under-?(?:trained|worked)|over-?(?:trained|worked)|more|less|fewer)\b/i;
const MUSCLE_WORD = /\b(?:muscles?|biceps?|triceps?|chest|pecs?|back|lats?|traps?|shoulders?|delts?|quads?|hamstrings?|hams|glutes?|calves|calf|abs|core|arms?|legs?|forearms?)\b/i;

export function asksMuscleBalance(words: string): boolean {
  const w = words.trim();
  if (w === '') return false;
  return REBALANCE_WORD.test(w) || (VOLUME_WORD.test(w) && MUSCLE_WORD.test(w));
}

export function createRebalanceExecutor(deps: RebalanceDeps): CoachExecutors {
  return {
    propose_rebalance: async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'propose_rebalance') throw new TypeError(call.tool);
      const r = await deps.prepare().catch((): RebalancePrepared => ({ kind: 'refused', line: 'Your plan couldn’t be read just now.' }));
      if (r.kind === 'refused') return { kind: 'refused', line: r.line };
      const saved = await deps.store.commit(ctx.ownerId, { kind: 'record', action: newActionRecord(ctx, r.detail, { status: 'proposed', reason: call.args.reason.slice(0, 240) }) });
      if (saved.status === 'conflict') throw new Error('Could not record the rebalance');
      // The model gets every line and bar (the card shows them); its reply needn't repeat them.
      const line = `Shown as a card with Apply: ${r.detail.lines.map((l) => l.text).join('; ')}. After: ${r.detail.bars.map((b) => b.text).join('; ')}.`.slice(0, 1500);
      return { kind: 'action', record: saved.action, replayed: saved.status === 'replayed', line };
    },
  };
}

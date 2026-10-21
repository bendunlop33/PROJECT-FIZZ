import type { BuilderEditOp } from '@fizz/schemas';
import type { TextCheck } from './claims';
import { OUT_OF_DATE_LINE, applyBuilderEdits, preconditionsHold, type BuilderCoachEnv, type BuilderCoachSnapshot, type EditOutcome, type SlotPrecondition } from './edit-ops';

/**
 * A coach change to the workout before Start: a proposal (Apply / Skip,
 * then `Applied · Undo`; Ben, 20 Oct, §9 Q9). Pure. Its lines are code's;
 * the coach's words show only after the number check. Apply re-checks it
 * against the workout as it is NOW (rule 5): refused with `Out of date.
 * Ask again.` when a slot it touches changed, or when the same ops would
 * no longer give the lines Ben saw. A change that touches only slots Ben
 * didn't edit still applies.
 */

export interface BuilderProposal {
  /** Stable ID (the caller's op ID for the request): Apply's op ID derives from it, so a double tap writes once. */
  id: string;
  draftId: string;
  /** The draft version it was made against (recorded; staleness is by slot, §4.4). */
  baseVersion: number;
  ops: BuilderEditOp[];
  lines: string[];
  warnings: string[];
  notes: string[];
  preconditions: SlotPrecondition[];
  /** `about N min` after. */
  estimate: number;
  /** Set up's length after. */
  minutes: number;
  /** The coach's words after the number check; null when none passed. */
  reason: string | null;
  /** Sentences hidden for an unchecked number (`Why?` → `Not shown`). */
  hidden: string[];
  /** Ben asked for heavier when it was made: Apply's re-check uses the same load guard step (spec §5, `stepsHarderAsked`). */
  askedHeavier: boolean;
}

/** Build the proposal from checked ops. Null when nothing would change (every op was left out). */
export function makeBuilderProposal(input: { id: string; snapshot: BuilderCoachSnapshot; ops: readonly BuilderEditOp[]; words: string | null; check: TextCheck; env: BuilderCoachEnv }): { proposal: BuilderProposal | null; outcome: EditOutcome; reason: string | null; hidden: string[] } {
  const outcome = applyBuilderEdits(input.snapshot, input.ops, input.env);
  // Every number in the coach's words is checked against the fact it names, before and after the change (B2).
  const checked = input.check(input.words, outcome);
  if (outcome.lines.length === 0) return { proposal: null, outcome, reason: checked.shown, hidden: checked.hidden };
  return {
    proposal: {
      id: input.id,
      draftId: input.snapshot.draftId,
      baseVersion: input.snapshot.draftVersion,
      ops: [...input.ops],
      lines: outcome.lines,
      warnings: outcome.warnings,
      notes: outcome.notes,
      preconditions: outcome.preconditions,
      estimate: outcome.estimate,
      minutes: outcome.minutes,
      reason: checked.shown,
      hidden: checked.hidden,
      askedHeavier: input.env.askedHeavier,
    },
    outcome,
    reason: checked.shown,
    hidden: checked.hidden,
  };
}

export type ProposalRecheck = { ok: true; outcome: EditOutcome } | { ok: false; line: typeof OUT_OF_DATE_LINE };

/** Apply's check (rule 5): the same draft, every touched slot at its revision, and the same lines now. */
export function recheckBuilderProposal(p: BuilderProposal, now: BuilderCoachSnapshot, env: BuilderCoachEnv): ProposalRecheck {
  if (now.draftId !== p.draftId) return { ok: false, line: OUT_OF_DATE_LINE };
  const fresh = preconditionsHold(p.preconditions, now);
  if (!fresh.ok) return fresh;
  // The guard runs as it did when Ben saw the lines: his "heavier" request stands (integrity B1).
  const outcome = applyBuilderEdits(now, p.ops, { ...env, askedHeavier: p.askedHeavier });
  const differs = (a: readonly string[], b: readonly string[]): boolean => a.length !== b.length || a.some((l, i) => l !== b[i]);
  // A new ⚠ since (Ben's other edits) is shown before Apply, never applied unseen (review N5).
  if (differs(outcome.lines, p.lines) || outcome.warnings.some((w) => !p.warnings.includes(w))) return { ok: false, line: OUT_OF_DATE_LINE };
  return { ok: true, outcome };
}

/** Apply's op ID for a proposal (idempotent: a double tap or a retry after a crash writes once). */
export function builderApplyOpId(proposalId: string): string {
  return `builder-apply:${proposalId}`;
}

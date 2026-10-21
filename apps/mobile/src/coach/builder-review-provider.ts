/**
 * The `BuilderReviewProvider` the builder stream's Coach review sheet consumes
 * (workout-builder-v3 §2.9; review b3-coach B6). Adapts the builder coach
 * service (`review`, `apply`, `saveReviewNotes`) to the builder's contract:
 * suggestions and `Add back` by action ID, notes by note ID. Stateful by
 * design: it keeps the last review per draft (its proposals and notes) so a
 * tap on `Swap` or `Done` acts on exactly what Ben saw. Nothing here counts or
 * words anything: the counts, plan lines and proposals are the service's (code),
 * the verdict, reasons and notes the coach's after the number check.
 *
 * Registered at app start: `setBuilderReviewProvider(createBuilderReviewProvider(...))`
 * (`apps/mobile/src/builder/review.ts` owns the contract; status `failed` is
 * connected-but-the-call-failed, header `Not reviewed`, review S12, rule 1).
 */

import { builderApplyOpId, type BuilderProposal, type ReviewNote, type ReviewPlanDay } from '@fizz/coach';
import type { BuilderGroupName } from '@fizz/domain';

import type { BuilderReview, BuilderReviewAction, BuilderReviewProvider, BuilderReviewStatus } from '../builder/review';
import type { BuilderCoachService, BuilderReviewResult } from './builder-coach-service';
import { builderReviewView } from './builder-coach-view';

// ---------------------------------------------------------------------------

/** `Update plan day` in the Plan section: the builder routes this ID to its own §2.8 choice (it owns plan-day writes); `apply` never takes it. */
export const UPDATE_PLAN_DAY_ACTION = 'update_plan_day';

/** What the review needs from the open builder (the builder stream supplies it). */
export interface BuilderReviewInputs {
  /** `Chest` (for `For next Chest day`). */
  dayName: string;
  /** The day's groups in Set up order. */
  groups: BuilderGroupName[];
  /** The plan day the draft came from; null when it isn't a plan day. */
  plan: ReviewPlanDay | null;
  /** Where Done saves the notes (the plan day's split day and main lift); null split day: notes aren't saved. */
  splitDayId: string | null;
  mainLiftExerciseId: string | null;
}

export interface BuilderReviewSource {
  inputs(draftId: string): Promise<BuilderReviewInputs | null>;
}

interface Held {
  result: BuilderReviewResult;
  inputs: BuilderReviewInputs;
  proposals: Map<string, BuilderProposal>;
  notes: ReviewNote[];
  applied: Set<string>;
  outOfDate: Set<string>;
}

const OUT_OF_DATE = 'Out of date. Ask again.';
const NOT_APPLIED = 'Not applied';

const STATUS: Readonly<Record<BuilderReviewResult['status'], BuilderReviewStatus>> = { reviewed: 'reviewed', offline: 'offline', not_connected: 'not_connected', failed: 'failed' };

function sheetOf(h: Held): BuilderReview {
  const v = builderReviewView(h.result, h.inputs.dayName);
  const action = (id: string, text: string, reason: string | null, apply: string): BuilderReviewAction => ({ id, text, reason, apply, ...(h.outOfDate.has(id) ? { outOfDate: true as const } : {}) });
  const open = (id: string): boolean => !h.applied.has(id);
  const notes = h.inputs.splitDayId === null ? [] : v.notes;
  return {
    status: STATUS[h.result.status],
    verdict: v.verdict,
    counts: h.result.facts.coverage.map((c) => ({ group: c.focus, sets: c.sets, trained: c.sets > 0 })),
    variety: v.variety === '' ? null : v.variety,
    plan:
      v.plan === null
        ? null
        : {
            title: v.plan.title,
            lines: v.plan.lines.map((l) => ({ ok: l.ok, text: l.text })),
            actions: [...v.plan.addBack.filter((a) => open(a.id)).map((a) => action(a.id, a.label, null, 'Add')), ...(v.plan.updatePlanDay ? [action(UPDATE_PLAN_DAY_ACTION, 'Update plan day', null, 'Update')] : [])],
          },
    suggestions: v.suggestions.filter((s) => open(s.id)).map((s) => action(s.id, s.card.lines.join(' · '), [s.card.reason, ...s.card.warnings].filter((x): x is string => x !== null).join('\n') || null, s.action)),
    nextNotes: notes.map((n) => ({ id: n.id, text: n.text, ticked: n.ticked })),
    nextNotesTitle: notes.length === 0 ? null : v.notesTitle,
  };
}

const unavailable = (status: BuilderReviewStatus): BuilderReview => ({ status, verdict: null, counts: [], variety: null, plan: null, suggestions: [], nextNotes: [], nextNotesTitle: null });

export function createBuilderReviewProvider(service: Pick<BuilderCoachService, 'review' | 'apply' | 'saveReviewNotes'>, source: BuilderReviewSource, opts: { newId: () => string }): BuilderReviewProvider {
  const held = new Map<string, Held>();
  return {
    async review(draftId, signal) {
      const inputs = await source.inputs(draftId);
      if (inputs === null) return unavailable('failed');
      const result = await service.review({ draftId, opId: `builder-review:${draftId}:${opts.newId()}`, groups: inputs.groups, plan: inputs.plan, ...(signal === undefined ? {} : { signal }) });
      if (result === null) return unavailable('failed');
      const proposals = new Map<string, BuilderProposal>([...result.addBack.map((a) => [a.id, a.proposal] as const), ...(result.coach?.suggestions ?? []).map((s) => [s.id, s.proposal] as const)]);
      const h: Held = { result, inputs, proposals, notes: result.coach?.notes ?? [], applied: new Set(), outOfDate: new Set() };
      held.set(draftId, h);
      return sheetOf(h);
    },

    // The proposal's own ID makes Apply idempotent (`builderApplyOpId`), so a double tap writes once; the builder's `opId` isn't needed.
    async apply(draftId, actionId) {
      const h = held.get(draftId);
      const p = h?.proposals.get(actionId);
      if (h === undefined || p === undefined) return { ok: false, message: actionId === UPDATE_PLAN_DAY_ACTION ? NOT_APPLIED : OUT_OF_DATE };
      const r = await service.apply(p);
      if (r.kind === 'applied') {
        h.applied.add(actionId);
        h.outOfDate.delete(actionId);
        return { ok: true, undoOpId: builderApplyOpId(p.id) };
      }
      if (r.kind === 'out_of_date') {
        h.outOfDate.add(actionId);
        return { ok: false, message: OUT_OF_DATE };
      }
      return { ok: false, message: NOT_APPLIED };
    },

    async saveNotes(draftId, noteIds, opId) {
      const h = held.get(draftId);
      if (h === undefined || h.inputs.splitDayId === null) return { ok: noteIds.length === 0 };
      const r = await service.saveReviewNotes({ notes: h.notes, ticked: new Set(noteIds), splitDayId: h.inputs.splitDayId, mainLiftExerciseId: h.inputs.mainLiftExerciseId, reviewId: h.result.reviewId, opId });
      return { ok: r.skipped === 0, saved: r.saved, notSaved: r.notSaved };
    },
  };
}

import type { ActionDetail, ActionRecord } from '@fizz/schemas';

import type { BuilderProposal } from './builder/proposal';
import { newActionRecord, type CoachExecutors, type CoachWriteStore, type ToolResult } from './executors';

/**
 * ADR 0039 (Ben, 29 Oct: "Can we make the coach across chats have broader and more homogenous edit rights?"). The
 * builder's two powers in every chat, so the entry point never decides what the coach can do:
 *
 * - `propose_workout_edit`: a change to the Your workout draft in context (not started). The builder's own edit coach
 *   makes it from Ben's words this turn (its checks, his named weights, the load guard), and the main coach saves it
 *   as a proposal with Apply / Skip (rule 3: in the builder before Start, what he asks for comes back as a proposal).
 *   Apply is the builder's versioned write, checked again then; its Undo is the builder's.
 * - `fill_setup`: today's Set up filled from Ben's words (a day, a length, a main lift), as Today's bar used to; Undo
 *   is on Set up. Nothing runs without his words.
 *
 * The model passes no request text: Ben's own words are the request, so a number it made up is never taken as his.
 */

export type DraftEditOutcome =
  | { kind: 'proposal'; proposal: BuilderProposal }
  | { kind: 'reply'; text: string | null; notes: readonly string[] }
  | { kind: 'unavailable' }
  | { kind: 'gone' };

export type SetupFillOutcome = { kind: 'filled'; toast: string; notes: readonly string[] } | { kind: 'reply'; text: string } | { kind: 'not_understood' } | { kind: 'failed' };

export interface DraftToolDeps {
  store: CoachWriteStore;
  /** The Your workout draft in context (not started). Null: `propose_workout_edit` isn't wired. */
  draft: { draftId: string; name: string } | null;
  edit?: (req: { draftId: string; words: string; opId: string }) => Promise<DraftEditOutcome>;
  /** Absent: `fill_setup` isn't wired. */
  fillSetup?: (req: { words: string; opId: string }) => Promise<SetupFillOutcome>;
}

/** Fed back when a draft or Set up tool is called with no words of Ben's this turn (a chip, an accepted offer). */
export const NEEDS_BEN_WORDS_LINE = 'Not run: this needs Ben’s own words this turn. Ask him what to change.';

async function record(store: CoachWriteStore, ownerId: string, action: ActionRecord): Promise<ToolResult> {
  const r = await store.commit(ownerId, { kind: 'record', action });
  if (r.status === 'conflict') throw new Error('Could not record the change');
  return { kind: 'action', record: r.action, replayed: r.status === 'replayed' };
}

export function createDraftToolExecutors(deps: DraftToolDeps): CoachExecutors {
  const out: CoachExecutors = {};
  const draft = deps.draft;
  const edit = deps.edit;
  if (draft !== null && edit !== undefined) {
    out.propose_workout_edit = async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'propose_workout_edit') throw new TypeError(call.tool);
      const words = ctx.benWords?.trim() ?? '';
      if (words === '') return { kind: 'refused', line: NEEDS_BEN_WORDS_LINE };
      const made = await edit({ draftId: draft.draftId, words, opId: ctx.opId }).catch((): DraftEditOutcome => ({ kind: 'unavailable' }));
      switch (made.kind) {
        case 'proposal': {
          const p = made.proposal;
          const detail: ActionDetail = {
            kind: 'propose_workout_edit',
            draftId: draft.draftId,
            draftName: draft.name.slice(0, 120),
            proposal: { ...p, ops: [...p.ops], lines: [...p.lines], warnings: [...p.warnings], notes: [...p.notes], preconditions: p.preconditions.map((x) => ({ ...x })), hidden: [...p.hidden], ...(p.benLoads === undefined ? {} : { benLoads: p.benLoads.map((b) => ({ ...b })) }), ...(p.topLoadsAfter === undefined ? {} : { topLoadsAfter: { ...p.topLoadsAfter } }) },
          };
          return record(deps.store, ctx.ownerId, newActionRecord(ctx, detail, { status: 'proposed', reason: call.args.reason.slice(0, 240) }));
        }
        case 'reply':
          return { kind: 'refused', line: `Not changed: ${(made.text ?? made.notes[0] ?? 'nothing in his words could be done to it').slice(0, 300)}` };
        case 'unavailable':
          return { kind: 'refused', line: 'Not changed: the workout’s coach couldn’t answer just now.' };
        case 'gone':
          return { kind: 'refused', line: 'Not changed: that workout is gone or already started.' };
      }
    };
  }
  const fill = deps.fillSetup;
  if (fill !== undefined) {
    out.fill_setup = async (call, ctx): Promise<ToolResult> => {
      if (call.tool !== 'fill_setup') throw new TypeError(call.tool);
      const words = ctx.benWords?.trim() ?? '';
      if (words === '') return { kind: 'refused', line: NEEDS_BEN_WORDS_LINE };
      const r = await fill({ words, opId: ctx.opId }).catch((): SetupFillOutcome => ({ kind: 'failed' }));
      switch (r.kind) {
        case 'filled':
          return record(deps.store, ctx.ownerId, newActionRecord(ctx, { kind: 'fill_setup', toast: r.toast.slice(0, 200), notes: r.notes.slice(0, 6).map((n) => n.slice(0, 200)) }, { reason: call.args.reason.slice(0, 240) }));
        case 'reply':
          return { kind: 'refused', line: `Set up not filled: ${r.text.slice(0, 300)}` };
        case 'not_understood':
          return { kind: 'refused', line: 'Set up not filled: his words name no day, length or main lift.' };
        case 'failed':
          return { kind: 'refused', line: 'Set up not filled: it couldn’t be saved.' };
      }
    };
  }
  return out;
}

import { describe, expect, it } from 'vitest';
import type { StructuralChange } from '@fizz/schemas';
import { checkStructuralProposal, dismissedCoachEditOpIds, structuralApplyOf, structuralDraftPlan, structuralDraftEdits, structuralEditOpId, structuralProposalState, type StructuralExerciseInfo, type StructuralSlot } from '../src/index';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BENCH = id(1);
const FLY = id(2);
const PEC = id(3);
const ROW = id(4);
const FACE = id(5);
const HANG = id(6);
const LUNGE = id(7);

const NAMES: Record<string, StructuralExerciseInfo> = {
  [BENCH]: { name: 'Bench press', measurement: 'reps' },
  [FLY]: { name: 'Cable fly', measurement: 'reps' },
  [PEC]: { name: 'Pec deck', measurement: 'reps' },
  [ROW]: { name: 'Cable row', measurement: 'reps' },
  [FACE]: { name: 'Face pull', measurement: 'reps' },
  [HANG]: { name: 'Dead hang', measurement: 'duration' },
  [LUNGE]: { name: 'Lunge', measurement: 'reps' },
};

const slot = (n: number, exerciseId: string, supersetGroup: string | null = null): StructuralSlot => ({ slotKey: id(100 + n), exerciseId, supersetGroup, name: NAMES[exerciseId]?.name ?? '?' });
const PUSH: StructuralSlot[] = [slot(1, BENCH), slot(2, FLY), slot(3, ROW, 'A'), slot(4, FACE, 'A')];

function check(changes: StructuralChange[], over: { doable?: (id: string) => boolean; painFlagged?: string[]; slots?: StructuralSlot[] } = {}) {
  return checkStructuralProposal({
    slots: over.slots ?? PUSH,
    changes,
    exercise: (x) => NAMES[x] ?? null,
    doable: over.doable ?? (() => true),
    painFlagged: new Set(over.painFlagged ?? []),
  });
}

describe('checkStructuralProposal (ADR 0020 §3; rule 3, 4, 9)', () => {
  it('a swap: before/after names, the app’s own line, the slot it points at', () => {
    const r = check([{ change: 'swap', fromExerciseId: FLY, toExerciseId: PEC }]);
    expect(r).toMatchObject({
      status: 'ok',
      before: ['Bench press', 'Cable fly', 'Cable row', 'Face pull'],
      after: ['Bench press', 'Pec deck', 'Cable row', 'Face pull'],
      lines: [{ change: 'swap', text: 'Cable fly → Pec deck' }],
      ops: [{ change: 'swap', slotKey: id(102), fromExerciseId: FLY, toExerciseId: PEC }],
    });
  });

  it('never swaps in a pain-flagged movement or one the gym can’t do; an unknown exercise is never guessed', () => {
    expect(check([{ change: 'swap', fromExerciseId: FLY, toExerciseId: PEC }], { painFlagged: [PEC] })).toMatchObject({ status: 'rejected', notes: [{ kind: 'pain_blocked' }] });
    expect(check([{ change: 'swap', fromExerciseId: FLY, toExerciseId: PEC }], { doable: (x) => x !== PEC })).toMatchObject({ status: 'rejected', notes: [{ kind: 'no_equipment' }] });
    expect(check([{ change: 'swap', fromExerciseId: FLY, toExerciseId: id(999) }])).toMatchObject({ status: 'rejected', failure: 'Not swapped: Cable fly. The new exercise isn’t known' });
    // Swapping away from a flagged movement is fine: that's the safe direction.
    expect(check([{ change: 'swap', fromExerciseId: FLY, toExerciseId: PEC }], { painFlagged: [FLY] }).status).toBe('ok');
  });

  it('a swap to something already in the plan, from something not in it, or across measurements is dropped', () => {
    expect(check([{ change: 'swap', fromExerciseId: FLY, toExerciseId: ROW }]).status).toBe('rejected');
    expect(check([{ change: 'swap', fromExerciseId: LUNGE, toExerciseId: PEC }]).status).toBe('rejected');
    expect(check([{ change: 'swap', fromExerciseId: FLY, toExerciseId: HANG }])).toMatchObject({ status: 'rejected', failure: 'Not swapped: Dead hang isn’t measured like Cable fly' });
  });

  it('remove: never the last exercise; the removed slot is skipped, not deleted', () => {
    const r = check([{ change: 'remove', exerciseId: FLY }]);
    expect(r).toMatchObject({ status: 'ok', after: ['Bench press', 'Cable row', 'Face pull'], lines: [{ change: 'remove', text: 'Cable fly out' }] });
    if (r.status !== 'ok') throw new Error('x');
    expect(structuralDraftEdits(r.ops)).toEqual([{ kind: 'skip', slotKey: id(102) }]);
    expect(check([{ change: 'remove', exerciseId: BENCH }], { slots: [slot(1, BENCH)] })).toMatchObject({ status: 'rejected', failure: 'Not removed: Bench press is the only exercise' });
  });

  it('reorder: every exercise once, supersets together; after a remove the removed slot stays at the end', () => {
    const r = check([{ change: 'reorder', exerciseIds: [ROW, FACE, BENCH, FLY] }]);
    expect(r).toMatchObject({ status: 'ok', after: ['Cable row', 'Face pull', 'Bench press', 'Cable fly'], lines: [{ text: 'New order: Cable row, Face pull, Bench press, Cable fly' }] });
    expect(check([{ change: 'reorder', exerciseIds: [ROW, BENCH, FACE, FLY] }])).toMatchObject({ status: 'rejected', failure: 'Not reordered: a superset has to stay together' });
    expect(check([{ change: 'reorder', exerciseIds: [ROW, FACE, BENCH] }]).status).toBe('rejected');
    expect(check([{ change: 'reorder', exerciseIds: [BENCH, FLY, ROW, FACE] }]).status).toBe('rejected');
    const both = check([
      { change: 'remove', exerciseId: FLY },
      { change: 'reorder', exerciseIds: [ROW, FACE, BENCH] },
    ]);
    if (both.status !== 'ok') throw new Error(JSON.stringify(both));
    expect(structuralDraftEdits(both.ops)).toEqual([
      { kind: 'skip', slotKey: id(102) },
      { kind: 'order', slotKeys: [id(103), id(104), id(101), id(102)] },
    ]);
  });

  it('add is not offered in this build: dropped with a note; with nothing else it is refused', () => {
    expect(check([{ change: 'add', exerciseId: LUNGE, afterExerciseId: null }])).toMatchObject({ status: 'rejected', failure: 'Not added: Lunge. Add it in the workout' });
    const mixed = check([
      { change: 'add', exerciseId: LUNGE, afterExerciseId: null },
      { change: 'swap', fromExerciseId: FLY, toExerciseId: PEC },
    ]);
    expect(mixed).toMatchObject({ status: 'ok', notes: [{ kind: 'structural_dropped', text: 'Not added: Lunge. Add it in the workout.' }] });
  });

  it('draft edit op IDs are per apply and change, and lead back to the apply', () => {
    expect(structuralEditOpId(id(9), 1)).toBe(`coach-apply:${id(9)}:1`);
    expect(structuralApplyOf(structuralEditOpId(id(9), 1))).toBe(id(9));
    expect(structuralApplyOf('ben-tap-1')).toBeNull();
  });
});

describe('structuralProposalState', () => {
  it('suggested → applied → used; dismissed; out of date once a workout started or the plan moved', () => {
    expect(structuralProposalState({ apply: null, dismissed: false, startedSince: false, basisChanged: false })).toBe('suggested');
    expect(structuralProposalState({ apply: { undone: false }, dismissed: false, startedSince: false, basisChanged: false })).toBe('applied');
    expect(structuralProposalState({ apply: { undone: false }, dismissed: false, startedSince: true, basisChanged: false })).toBe('used');
    expect(structuralProposalState({ apply: { undone: true }, dismissed: false, startedSince: false, basisChanged: false })).toBe('undone');
    expect(structuralProposalState({ apply: null, dismissed: true, startedSince: false, basisChanged: false })).toBe('not_applied');
    expect(structuralProposalState({ apply: null, dismissed: false, startedSince: true, basisChanged: false })).toBe('out_of_date');
    expect(structuralProposalState({ apply: null, dismissed: false, startedSince: false, basisChanged: true })).toBe('out_of_date');
    // Review S1: refused at the overview's gym; a started workout still wins.
    expect(structuralProposalState({ apply: { undone: false }, dismissed: false, startedSince: false, basisChanged: false, refusedHere: true })).toBe('not_here');
    expect(structuralProposalState({ apply: { undone: false }, dismissed: false, startedSince: true, basisChanged: false, refusedHere: true })).toBe('used');
    expect(structuralProposalState({ apply: { undone: true }, dismissed: false, startedSince: false, basisChanged: false, refusedHere: true })).toBe('undone');
  });
});

describe('structuralDraftPlan (Apply → the next workout’s draft)', () => {
  const swap = { change: 'swap' as const, slotKey: id(102), fromExerciseId: FLY, fromName: 'Cable fly', toExerciseId: PEC, toName: 'Pec deck' };
  const remove = { change: 'remove' as const, slotKey: id(101), exerciseId: BENCH, name: 'Bench press' };
  it('writes each applied change once, as Ben’s own edit kinds; a draft that has seen the op ID gets nothing again', () => {
    const applies = [{ applyActionId: 'a1', ops: [swap, remove], undone: false, used: false }];
    const first = structuralDraftPlan({ applies, draftOpIds: null, liveEdits: [] });
    expect(first.write).toEqual([
      { opId: structuralEditOpId('a1', 0), edit: { kind: 'swap', slotKey: id(102), toExerciseId: PEC } },
      { opId: structuralEditOpId('a1', 1), edit: { kind: 'skip', slotKey: id(101) } },
    ]);
    // Ben undid the swap on the overview himself: its op ID is in the draft, so it isn't written back.
    expect(structuralDraftPlan({ applies, draftOpIds: [structuralEditOpId('a1', 0), structuralEditOpId('a1', 1)], liveEdits: [] }).write).toEqual([]);
  });
  it('an undone Apply takes its live edits back; Ben’s own edits and used applies are left alone', () => {
    const plan = structuralDraftPlan({
      applies: [
        { applyActionId: 'a1', ops: [swap], undone: true, used: false },
        { applyActionId: 'a2', ops: [remove], undone: false, used: true },
      ],
      draftOpIds: [structuralEditOpId('a1', 0)],
      liveEdits: [
        { editId: 'e1', opId: structuralEditOpId('a1', 0) },
        { editId: 'e2', opId: 'ben-own-op' },
      ],
    });
    expect(plan).toEqual({ write: [], remove: ['e1'] });
  });
});

describe('dismissedCoachEditOpIds (review S5: a coach edit Ben undid stays undone after midnight)', () => {
  const swap = (opId: string, removedBy: string | null, to = 'x') => ({ kind: 'swap' as const, slotKey: 's1', toExerciseId: to, opId, removed: removedBy === null ? null : { opId: removedBy } });
  it('lists coach edits Ben removed on a closed draft, not live ones, not the Apply’s own Undo, not open drafts', () => {
    const a = structuralEditOpId('apply-1', 0);
    const b = structuralEditOpId('apply-2', 0);
    const c = structuralEditOpId('apply-3', 0);
    expect(
      dismissedCoachEditOpIds([
        { status: 'expired', edits: [swap(a, 'ben-undo'), swap(b, null, 'y'), { ...swap(c, 'coach-undo:e3'), toExerciseId: 'z' }] },
        { status: 'open', edits: [swap(structuralEditOpId('apply-4', 0), 'ben-undo', 'w')] },
      ]),
    ).toEqual([a]);
  });

  it('an edit Ben brought back with the toast’s Undo (a live copy) is still wanted', () => {
    const a = structuralEditOpId('apply-1', 0);
    expect(dismissedCoachEditOpIds([{ status: 'expired', edits: [swap(a, 'ben-undo'), swap('restore-op', null)] }])).toEqual([]);
  });

  it('structuralDraftPlan skips dismissed op IDs in a new draft', () => {
    const ops = [{ change: 'swap' as const, slotKey: 's1', fromExerciseId: 'a', fromName: 'A', toExerciseId: 'b', toName: 'B' }];
    const applies = [{ applyActionId: 'apply-1', ops, undone: false, used: false }];
    expect(structuralDraftPlan({ applies, draftOpIds: null, liveEdits: [] }).write).toHaveLength(1);
    expect(structuralDraftPlan({ applies, draftOpIds: null, liveEdits: [], dismissedOpIds: [structuralEditOpId('apply-1', 0)] }).write).toEqual([]);
  });
});


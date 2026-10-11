import type { Exercise, Measurement, StructuralChange } from '@fizz/schemas';
import { needsNoEquipment } from '../exercise-equipment';
import type { SnapGym } from '../session/snap';
import { doableHere, equipmentHere } from '../session/substitutes';
import { keepsGroupsTogether, type TodaySlot } from '../session/today-edits';

/**
 * Structural proposals for the next workout (ADR 0020 §3, coach-adjustments
 * CA9, CLAUDE.md rule 3). Pure and deterministic: the model's `changes` are
 * only a request; this decides what can be proposed, against the plan the
 * next workout would start from (a routine's slots, or the part roots of the
 * workout it is built from).
 *
 * - **Swap**: the exercise is in the plan; the new one is known, measured the
 *   same way, doable at the gym (rule 4), not pain-flagged (rule 9) and not
 *   already in the plan.
 * - **Remove**: the exercise is in the plan and isn't the last one left.
 * - **Reorder**: every exercise left, each once, supersets kept together.
 * - **Add** isn't offered in this build: the pre-start draft (ADR 0022) has no
 *   place for an added exercise, so an add is dropped with a guard note and
 *   the coach can only suggest it in words. Decided conservatively, 11 Oct.
 *
 * Nothing changes until Ben taps Apply. Applying writes the changes into
 * the next workout's pre-start draft as his own `Swap today` / `Skip today`
 * / order edits (`structuralDraftEdits`), so the overview shows them with
 * its own Undo and the routine itself never changes: a template change goes
 * through the overview's change-review card (`Change Push A too ›`).
 */

export interface StructuralSlot extends TodaySlot {
  name: string;
}

export type StructuralOp =
  | { change: 'swap'; slotKey: string; fromExerciseId: string; fromName: string; toExerciseId: string; toName: string }
  | { change: 'remove'; slotKey: string; exerciseId: string; name: string }
  | { change: 'reorder'; slotKeys: string[]; names: string[] };

export interface StructuralExerciseInfo {
  name: string;
  measurement: Measurement;
}

export interface StructuralCheckInput {
  /** The plan the next workout starts from, in order. */
  slots: readonly StructuralSlot[];
  changes: readonly StructuralChange[];
  /** A known exercise (the app's list or the catalogue); null when unknown (never guessed). */
  exercise(exerciseId: string): StructuralExerciseInfo | null;
  /** Whether the gym the next workout uses can do it (rule 4). */
  doable(exerciseId: string): boolean;
  /** Exercises with an active pain flag (rule 9): never swapped in. */
  painFlagged: ReadonlySet<string>;
}

export interface StructuralNote {
  kind: 'structural_dropped' | 'pain_blocked' | 'no_equipment';
  text: string;
}

export type StructuralCheck =
  | {
      status: 'ok';
      ops: StructuralOp[];
      /** Exercise names before and after, in order (removed ones left out of `after`). */
      before: string[];
      after: string[];
      /** One app line per change: `Cable fly → Pec deck`, `Cable fly out`, `New order: …`. */
      lines: { change: 'swap' | 'add' | 'remove' | 'reorder'; text: string }[];
      notes: StructuralNote[];
    }
  | { status: 'rejected'; failure: string; notes: StructuralNote[] };

/** `Cable fly → Pec deck` etc.: app text from the op, never the model's words. */
export function structuralLine(op: StructuralOp): { change: 'swap' | 'remove' | 'reorder'; text: string } {
  switch (op.change) {
    case 'swap':
      return { change: 'swap', text: `${op.fromName} → ${op.toName}` };
    case 'remove':
      return { change: 'remove', text: `${op.name} out` };
    case 'reorder':
      return { change: 'reorder', text: `New order: ${op.names.join(', ')}` };
  }
}

export function checkStructuralProposal(input: StructuralCheckInput): StructuralCheck {
  const notes: StructuralNote[] = [];
  const ops: StructuralOp[] = [];
  // Today's plan as the changes so far leave it.
  let plan = input.slots.map((s) => ({ ...s }));
  const removed = new Set<string>();
  const drop = (text: string) => notes.push({ kind: 'structural_dropped', text });
  const live = () => plan.filter((s) => !removed.has(s.slotKey));
  const slotOf = (exerciseId: string) => live().find((s) => s.exerciseId === exerciseId);

  for (const c of input.changes) {
    switch (c.change) {
      case 'add':
        drop(`Not added: ${input.exercise(c.exerciseId)?.name ?? 'that exercise'}. Add it in the workout.`);
        break;
      case 'swap': {
        const slot = slotOf(c.fromExerciseId);
        const to = input.exercise(c.toExerciseId);
        if (slot === undefined) {
          drop(`Not swapped: ${input.exercise(c.fromExerciseId)?.name ?? 'that exercise'} isn’t in this workout.`);
          break;
        }
        if (to === null) {
          drop(`Not swapped: ${slot.name}. The new exercise isn’t known.`);
          break;
        }
        if (c.toExerciseId === slot.exerciseId || live().some((s) => s.exerciseId === c.toExerciseId)) {
          drop(`Not swapped: ${to.name} is already in this workout.`);
          break;
        }
        const from = input.exercise(slot.exerciseId);
        if (from !== null && from.measurement !== to.measurement) {
          drop(`Not swapped: ${to.name} isn’t measured like ${slot.name}.`);
          break;
        }
        if (input.painFlagged.has(c.toExerciseId)) {
          notes.push({ kind: 'pain_blocked', text: `Not swapped in: ${to.name} has a pain flag.` });
          break;
        }
        if (!input.doable(c.toExerciseId)) {
          notes.push({ kind: 'no_equipment', text: `Not swapped in: ${to.name}. No equipment for it at this gym.` });
          break;
        }
        ops.push({ change: 'swap', slotKey: slot.slotKey, fromExerciseId: slot.exerciseId, fromName: slot.name, toExerciseId: c.toExerciseId, toName: to.name });
        plan = plan.map((s) => (s.slotKey === slot.slotKey ? { ...s, exerciseId: c.toExerciseId, name: to.name } : s));
        break;
      }
      case 'remove': {
        const slot = slotOf(c.exerciseId);
        if (slot === undefined) {
          drop(`Not removed: ${input.exercise(c.exerciseId)?.name ?? 'that exercise'} isn’t in this workout.`);
          break;
        }
        if (live().length <= 1) {
          drop(`Not removed: ${slot.name} is the only exercise.`);
          break;
        }
        ops.push({ change: 'remove', slotKey: slot.slotKey, exerciseId: slot.exerciseId, name: slot.name });
        removed.add(slot.slotKey);
        break;
      }
      case 'reorder': {
        const current = live();
        const keys = c.exerciseIds.map((id) => current.find((s) => s.exerciseId === id)?.slotKey);
        const complete = keys.every((k): k is string => k !== undefined) && new Set(keys).size === current.length && keys.length === current.length;
        if (!complete) {
          drop('Not reordered: the order has to list every exercise once.');
          break;
        }
        // Removed slots keep their place at the end; supersets stay together.
        const full = [...keys, ...plan.filter((s) => removed.has(s.slotKey)).map((s) => s.slotKey)];
        const groups = plan.map((s) => ({ slotKey: s.slotKey, exerciseId: s.exerciseId, supersetGroup: removed.has(s.slotKey) ? null : s.supersetGroup }));
        if (!keepsGroupsTogether(full, groups)) {
          drop('Not reordered: a superset has to stay together.');
          break;
        }
        if (keys.every((k, i) => k === current[i]?.slotKey)) {
          drop('Not reordered: that is the order already.');
          break;
        }
        const byKey = new Map(plan.map((s) => [s.slotKey, s]));
        ops.push({ change: 'reorder', slotKeys: full, names: keys.map((k) => byKey.get(k)?.name ?? '') });
        plan = full.map((k) => byKey.get(k)).filter((s): s is (typeof plan)[number] => s !== undefined);
        break;
      }
    }
  }
  if (ops.length === 0) return { status: 'rejected', failure: notes[0]?.text.replace(/\.$/, '') ?? 'nothing to change', notes };
  return {
    status: 'ok',
    ops,
    before: input.slots.map((s) => s.name),
    after: live().map((s) => s.name),
    lines: ops.map(structuralLine),
    notes,
  };
}

/** What Apply writes into the pre-start draft: Ben's own edit kinds, one per op, in order. */
export type StructuralDraftEdit = { kind: 'swap'; slotKey: string; toExerciseId: string } | { kind: 'skip'; slotKey: string } | { kind: 'order'; slotKeys: string[] };

export function structuralDraftEdits(ops: readonly StructuralOp[]): StructuralDraftEdit[] {
  return ops.map((op): StructuralDraftEdit => {
    switch (op.change) {
      case 'swap':
        return { kind: 'swap', slotKey: op.slotKey, toExerciseId: op.toExerciseId };
      case 'remove':
        return { kind: 'skip', slotKey: op.slotKey };
      case 'reorder':
        return { kind: 'order', slotKeys: [...op.slotKeys] };
    }
  });
}

/** The op ID of one applied change's draft edit: one per apply and change, so writing it again is a no-op. */
export function structuralEditOpId(applyActionId: string, index: number): string {
  return `coach-apply:${applyActionId}:${String(index)}`;
}

/** The apply a draft edit came from, or null for Ben's own edits. */
export function structuralApplyOf(editOpId: string): string | null {
  const m = /^coach-apply:(.+):\d+$/.exec(editOpId);
  return m?.[1] ?? null;
}

/** One applied structural proposal for a plan, as the coach service lists it (no draft data). */
export interface AppliedStructural {
  applyActionId: string;
  ops: readonly StructuralOp[];
  undone: boolean;
  /** A workout has started from the plan since this Apply: it is used and left alone. */
  used: boolean;
}

/**
 * What the next workout's draft needs so applied proposals show on its
 * overview (ADR 0020 §3, ADR 0022): edits to write (one op ID per apply and
 * change, skipped once the draft has seen it, so a reload or a later Ben
 * Undo of that edit never brings it back) and the live edits to take back
 * because their Apply was undone. Pure; the app reads the draft.
 */
export function structuralDraftPlan(input: {
  applies: readonly AppliedStructural[];
  /** Op IDs the open draft has already processed (null: no draft yet). */
  draftOpIds: readonly string[] | null;
  /** The open draft's live edits. */
  liveEdits: readonly { editId: string; opId: string }[];
}): { write: { opId: string; edit: StructuralDraftEdit }[]; remove: string[] } {
  const done = new Set(input.draftOpIds ?? []);
  const write: { opId: string; edit: StructuralDraftEdit }[] = [];
  for (const a of input.applies) {
    if (a.undone || a.used) continue;
    structuralDraftEdits(a.ops).forEach((edit, i) => {
      const opId = structuralEditOpId(a.applyActionId, i);
      if (!done.has(opId)) write.push({ opId, edit });
    });
  }
  const undone = new Set(input.applies.filter((a) => a.undone).map((a) => a.applyActionId));
  const remove = input.liveEdits.filter((e) => undone.has(structuralApplyOf(e.opId) ?? '')).map((e) => e.editId);
  return { write, remove };
}

export type StructuralProposalState =
  /** Waiting for Ben: `Not now` · `Apply`. */
  | 'suggested'
  /** Applied for the next workout, with Undo until it starts. */
  | 'applied'
  /** Applied, then undone. */
  | 'undone'
  /** Ben tapped Not now. */
  | 'not_applied'
  /** The next workout started, or the plan changed, before Ben applied it. */
  | 'out_of_date'
  /** Applied and used by a workout that started. */
  | 'used';

/**
 * The card's state from the proposal and Ben's records about it. `applied`
 * is his live Apply (committed, not undone); `staleOrUsed` is whether a
 * workout has started from the basis since (or the basis moved on).
 */
export function structuralProposalState(input: {
  apply: { undone: boolean } | null;
  dismissed: boolean;
  /** A workout has started from the basis since the proposal (or the apply), or the basis changed. */
  startedSince: boolean;
  basisChanged: boolean;
}): StructuralProposalState {
  if (input.apply !== null) {
    if (input.apply.undone) return 'undone';
    return input.startedSince ? 'used' : 'applied';
  }
  if (input.dismissed) return 'not_applied';
  if (input.startedSince || input.basisChanged) return 'out_of_date';
  return 'suggested';
}

// ---------------------------------------------------------------------------
// Swap options the coach can name (`get_substitutions`)

export interface SubstitutionOption {
  exerciseId: string;
  name: string;
  /** The item this gym would use for it; null for a bodyweight exercise. */
  equipment: string | null;
}

/**
 * Exercises that could replace `planned` at this gym: the catalogue's
 * substitutes first (in its order), then the same movement family by name.
 * Only ones measured the same way, doable here (rule 4), not pain-flagged
 * (rule 9) and not already in the plan. No scores and no AI.
 */
export function substitutionOptions(input: {
  planned: Exercise;
  pool: readonly Exercise[];
  catalogueSubstitutions: readonly (string | null)[];
  gym: SnapGym;
  painFlagged: ReadonlySet<string>;
  exclude: ReadonlySet<string>;
  limit?: number;
}): SubstitutionOption[] {
  const { planned } = input;
  const keys = input.catalogueSubstitutions.filter((k): k is string => k !== null);
  const rank = (e: Exercise): number => {
    const i = e.catalogueKey ? keys.indexOf(e.catalogueKey) : -1;
    return i >= 0 ? i : keys.length;
  };
  const eligible = input.pool.filter(
    (e) =>
      e.id !== planned.id &&
      e.measurement === planned.measurement &&
      ((e.catalogueKey !== undefined && e.catalogueKey !== null && keys.includes(e.catalogueKey)) || (planned.family !== undefined && e.family === planned.family)) &&
      !input.painFlagged.has(e.id) &&
      !input.exclude.has(e.id) &&
      doableHere(e, input.gym),
  );
  const seen = new Set<string>();
  return [...eligible]
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .slice(0, input.limit ?? 12)
    .map((e) => ({ exerciseId: e.id, name: e.name, equipment: needsNoEquipment(e) ? null : (equipmentHere(e, { gym: input.gym }).equipment?.name ?? null) }));
}

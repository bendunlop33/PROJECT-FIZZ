/**
 * The active exercise's `⋯` action sheet (active-workout.md §4.4). Pure, so
 * the index → action mapping is tested rather than shifted by hand next to
 * destructive actions (review S3). `How to` leads when the exercise has one
 * (ADR 0013), so the bottom rows stay put under the thumb either way.
 */
import { formatNumber, rirOfRpe, TARGET_RPE_CHOICES, type TargetRpe } from '@fizz/domain';
import type { TargetRpeScope } from '@fizz/schemas';

export type ExerciseMenuAction =
  | 'adjust'
  | 'how_to'
  | 'history'
  | 'plates'
  | 'edit_set'
  | 'undo_coach'
  | 'undo_swap'
  | 'target_rpe'
  | 'add_set'
  | 'swap'
  | 'do_next'
  | 'move_to_end'
  | 'not_at_gym'
  | 'superset_with'
  | 'remove_superset'
  | 'notes'
  | 'add_exercise'
  | 'delete_set'
  | 'skip_exercise'
  | 'remove_exercise';

interface MenuItem {
  action: ExerciseMenuAction | 'cancel';
  label: string;
  destructive: boolean;
}

const HOW_TO: MenuItem = { action: 'how_to', label: 'How to', destructive: false };
/** (Ben, 26 Oct) The coach's `Adjust` chips for the current exercise, moved off the header into the round page's `⋯`. */
const ADJUST: MenuItem = { action: 'adjust', label: 'Adjust', destructive: false };
/** While the focused set carries a coach change still pending (coach-adjustments §2.7). */
const UNDO_COACH: MenuItem = { action: 'undo_coach', label: 'Undo coach change', destructive: false };
/** The same for the built-in rule's change (CA6 revised): never called the coach's. */
const UNDO_RULE: MenuItem = { action: 'undo_coach', label: 'Undo change', destructive: false };
/** While the exercise is today's mid-workout swap and its swap can be undone (EL4). */
const UNDO_SWAP: MenuItem = { action: 'undo_swap', label: 'Undo swap', destructive: false };
/** The set Log logs next, opened in Edit set (type, insert after, note…; review B1: "edit anything on the sets"). */
const EDIT_SET: MenuItem = { action: 'edit_set', label: 'Edit set', destructive: false };
/** Ben's own target RPE (CHANGELOG 2026-10-11): only on a set that carries one (not a warm-up or drop set). */
const TARGET_RPE: MenuItem = { action: 'target_rpe', label: 'Target RIR', destructive: false };
const ADD_SET: MenuItem = { action: 'add_set', label: 'Add set', destructive: false };
/** Only while the exercise has a pending set (B3: applies at once with Undo). */
const SWAP: MenuItem = { action: 'swap', label: 'Swap exercise', destructive: false };
/** (Ben, 20 Oct; ADR 0029) The gym doesn't have it: marked on the gym, then the swap sheet. */
const NOT_AT_GYM: MenuItem = { action: 'not_at_gym', label: 'Not at this gym', destructive: false };
/** (Ben, 19 Oct) Pair it with another exercise, or a second copy of itself; its sets alternate. */
const SUPERSET_WITH: MenuItem = { action: 'superset_with', label: 'Superset with…', destructive: false };
/** (Ben, 19 Oct) Each member back to its own sets. */
const REMOVE_SUPERSET: MenuItem = { action: 'remove_superset', label: 'Remove superset', destructive: false };
/** (Ben, 31 Oct) Today's order from the `⋯`: straight after the current exercise, or last. */
const DO_NEXT: MenuItem = { action: 'do_next', label: 'Do next', destructive: false };
const MOVE_TO_END: MenuItem = { action: 'move_to_end', label: 'Move to end', destructive: false };
/** The exercise's history (it was on the name's sheet before the name opened the pop-up, v3 §7). */
const HISTORY: MenuItem = { action: 'history', label: 'History', destructive: false };
/** Plates for every load in today's targets (also from the name's sheet before v3 §7). */
const PLATES: MenuItem = { action: 'plates', label: 'Plates', destructive: false };
const NOTES: MenuItem = { action: 'notes', label: 'Notes', destructive: false };
const SKIP: MenuItem = { action: 'skip_exercise', label: 'Skip exercise', destructive: true };
const ITEMS: readonly MenuItem[] = [
  NOTES,
  { action: 'add_exercise', label: 'Add exercise', destructive: false },
  { action: 'delete_set', label: 'Delete this set', destructive: true },
  SKIP,
];
/** Only while nothing on the exercise is logged (exercise-library §4.6): no confirm, toast with Undo. */
const REMOVE: MenuItem = { action: 'remove_exercise', label: 'Remove exercise', destructive: true };
const CANCEL: MenuItem = { action: 'cancel', label: 'Cancel', destructive: false };

export interface ExerciseMenu {
  /** Labels in sheet order. */
  options: string[];
  /** Rows shown red (iOS takes an array). */
  destructiveButtonIndex: number[];
  cancelButtonIndex: number;
  /** The action for a tapped row; null for Cancel, a dismissal or an unknown index. */
  actionAt: (index: number) => ExerciseMenuAction | null;
}

export interface ExerciseMenuOptions {
  /** The exercise has a pending set to swap (mid-workout swap, EL4). */
  canSwap?: boolean;
  /** The exercise is today's swap and it can still be undone. */
  canUndoSwap?: boolean;
  /** Nothing on the exercise is logged: it can be removed (added by mistake). */
  canRemove?: boolean;
  /** The focused set carries a target RPE (not a warm-up or drop set): `Target RPE`. */
  hasTargetRpe?: boolean;
  /** The exercise has a set not done yet (the current one in Focus): `Edit set` opens it. */
  canEditSet?: boolean;
  /** `Superset with…` (`supersetMenu().canPair`). */
  canSuperset?: boolean;
  /** `Remove superset` (`supersetMenu().inSuperset`). */
  inSuperset?: boolean;
  /** `Not at this gym`: the exercise uses an item of this workout's gym. */
  canMarkNotHere?: boolean;
}

/**
 * Focus view's `⋯` (active-workout.md §4.4). The round page (Table, the default) has its own, shorter
 * one: `roundExerciseMenu`.
 */
export function exerciseMenu(hasHowTo: boolean, hasCoachChange: boolean | 'rule' = false, o: ExerciseMenuOptions = {}): ExerciseMenu {
  const undo = hasCoachChange === 'rule' ? [UNDO_RULE] : hasCoachChange ? [UNDO_COACH] : [];
  return menuOf([
    ...(hasHowTo ? [HOW_TO] : []),
    ...undo,
    ...(o.canUndoSwap ? [UNDO_SWAP] : []),
    ...(o.canEditSet ? [EDIT_SET] : []),
    ...(o.hasTargetRpe ? [TARGET_RPE] : []),
    ADD_SET,
    ...(o.canSwap ? [SWAP] : []),
    ...(o.canMarkNotHere ? [NOT_AT_GYM] : []),
    ...(o.canSuperset ? [SUPERSET_WITH] : []),
    ...(o.inSuperset ? [REMOVE_SUPERSET] : []),
    ...ITEMS,
    ...(o.canRemove ? [REMOVE] : []),
  ]);
}

export interface RoundExerciseMenuOptions {
  /** The exercise has sets to swap (`midSwapSlot`: with sets done, the rest are swapped). */
  canSwap: boolean;
  /** `roundJumps`: not the current round, not started, not past a started one, not already there. */
  doNext: boolean;
  moveToEnd: boolean;
  /** Plates: the exercise's targets have a breakdown (a bar or a plate-loaded machine; never dumbbells or a stack). */
  plates: boolean;
  /** A coach (true) or built-in rule ('rule') change on the next set can still be undone. */
  coachChange?: boolean | 'rule';
  /** Today's swap can still be undone. */
  canUndoSwap?: boolean;
  /** The current exercise: the coach's `Adjust` chips (the only way to them on the round page). */
  adjust?: boolean;
}

/**
 * The round page's `⋯` (Ben, 31 Oct: "do we need all this when in workout mode?"): Swap, Do next, Move
 * to end, Add set, History, Plates, Notes, Skip. Elsewhere now: Edit set, Target RIR and Delete on the
 * set's own hold menu and swipe; Add exercise at the end of the list; Not at this gym in the Swap sheet;
 * How to, Move up / down, Superset and Remove in the name's pop-up; pairing by dragging onto an exercise
 * in Workout. While a change can be undone its Undo shows, and `Adjust` stays on the current exercise
 * (nowhere else on the round page), last before Skip.
 */
export function roundExerciseMenu(o: RoundExerciseMenuOptions): ExerciseMenu {
  const c = o.coachChange ?? false;
  return menuOf([
    ...(o.canSwap ? [SWAP] : []),
    ...(o.doNext ? [DO_NEXT] : []),
    ...(o.moveToEnd ? [MOVE_TO_END] : []),
    ADD_SET,
    HISTORY,
    ...(o.plates ? [PLATES] : []),
    NOTES,
    ...(c === 'rule' ? [UNDO_RULE] : c ? [UNDO_COACH] : []),
    ...(o.canUndoSwap === true ? [UNDO_SWAP] : []),
    ...(o.adjust === true ? [ADJUST] : []),
    SKIP,
  ]);
}

function menuOf(rows: readonly MenuItem[]): ExerciseMenu {
  const items = [...rows, CANCEL];
  return {
    options: items.map((i) => i.label),
    destructiveButtonIndex: items.flatMap((item, i) => (item.destructive ? [i] : [])),
    cancelButtonIndex: items.findIndex((i) => i.action === 'cancel'),
    actionAt: (index) => {
      const action = items[index]?.action;
      return action === undefined || action === 'cancel' ? null : action;
    },
  };
}

/** A picked target RPE: a value, or `null` to clear Ben's own (back to the coach's or the built-in rule's). */
export interface TargetRpeMenu {
  options: string[];
  cancelButtonIndex: number;
  valueAt: (index: number) => number | null | undefined;
}

/**
 * `Target RIR` sheet (Ben, 26 Oct: RIR replaces RPE in the UI): `RIR 0` … `RIR 4` (the current one marked `✓`),
 * and `Default` when Ben has set his own. Values stay RPE (RIR = 10 − RPE). `valueAt`: undefined for Cancel.
 */
export function targetRpeMenu(current: TargetRpe | null): TargetRpeMenu {
  const values: (number | null)[] = [...[...TARGET_RPE_CHOICES].sort((a, b) => b - a), ...(current?.source === 'ben' ? [null] : [])];
  const options = values.map((v) => (v === null ? 'Default' : `RIR ${formatNumber(rirOfRpe(v))}${current?.rpe === v ? ' ✓' : ''}`));
  return {
    options: [...options, 'Cancel'],
    cancelButtonIndex: options.length,
    valueAt: (i) => (i >= 0 && i < values.length ? values[i] : undefined),
  };
}

/** Then where it applies: the next set, this exercise, or today's workout. */
export function targetRpeScopeMenu(setId: string, sessionExerciseId: string): { options: string[]; cancelButtonIndex: number; scopeAt: (index: number) => TargetRpeScope | null } {
  const scopes: TargetRpeScope[] = [{ kind: 'set', setId }, { kind: 'exercise', sessionExerciseId }, { kind: 'today' }];
  return {
    options: ['This set', 'This exercise', 'Today', 'Cancel'],
    cancelButtonIndex: 3,
    scopeAt: (i) => scopes[i] ?? null,
  };
}

export interface TargetRpeChip {
  key: string;
  label: string;
  /** The value to pick; null clears Ben's own (back to the coach's, the plan's or the rule's). */
  value: number | null;
  selected: boolean;
}

/**
 * Edit set's `Target RIR` chips: the same choices as the `⋯` sheet (labels RIR, values RPE), with
 * `Default` when Ben has set his own (review target-rpe r2 N3).
 */
export function targetRpeChips(current: { target: TargetRpe | null; override: number | null } | null): TargetRpeChip[] {
  if (current === null) return [];
  const chips: TargetRpeChip[] = [...TARGET_RPE_CHOICES].sort((a, b) => b - a).map((n) => ({ key: String(n), label: formatNumber(rirOfRpe(n)), value: n, selected: current.target?.rpe === n }));
  return current.override === null ? chips : [...chips, { key: 'default', label: 'Default', value: null, selected: false }];
}

/** (Ben, 26 Oct: RIR replaces RPE in the UI) Reps in reserve for one set: `0` … `5`, `Clear` when one is set. */
export const RIR_CHOICES = [0, 1, 2, 3, 4, 5] as const;

export interface RirMenu {
  title: string;
  options: string[];
  cancelButtonIndex: number;
  /** The RIR picked; null clears it; undefined for Cancel or a dismissal. */
  valueAt: (index: number) => number | null | undefined;
}

export function rirMenu(stepName: string, current: number | null): RirMenu {
  const values: (number | null)[] = [...RIR_CHOICES, ...(current !== null ? [null] : [])];
  const options = values.map((v) => (v === null ? 'Clear' : `${formatNumber(v)}${v === 5 ? '+' : ''}${current === v ? ' ✓' : ''}`));
  return {
    title: `${stepName} · Reps in reserve`,
    options: [...options, 'Cancel'],
    cancelButtonIndex: options.length,
    valueAt: (i) => (i >= 0 && i < values.length ? values[i] : undefined),
  };
}

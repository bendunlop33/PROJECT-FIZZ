/**
 * The active exercise's `⋯` action sheet (active-workout.md §4.4). Pure, so
 * the index → action mapping is tested rather than shifted by hand next to
 * destructive actions (review S3). `How to` leads when the exercise has one
 * (ADR 0013), so the bottom rows stay put under the thumb either way.
 */
import { formatNumber, TARGET_RPE_CHOICES, type TargetRpe } from '@fizz/domain';
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
  | 'move_up'
  | 'move_down'
  | 'not_at_gym'
  | 'superset_next'
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
/** (Ben, 26 Oct) The coach's `Adjust` chips for the current exercise, moved off the header into `⋯`: first, one tap. */
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
const TARGET_RPE: MenuItem = { action: 'target_rpe', label: 'Target RPE', destructive: false };
const ADD_SET: MenuItem = { action: 'add_set', label: 'Add set', destructive: false };
/** Only while the exercise has a pending set (B3: applies at once with Undo). */
const SWAP: MenuItem = { action: 'swap', label: 'Swap exercise', destructive: false };
/** (Ben, 20 Oct; ADR 0029) The gym doesn't have it: marked on the gym, then the swap sheet. */
const NOT_AT_GYM: MenuItem = { action: 'not_at_gym', label: 'Not at this gym', destructive: false };
/** (Ben, 19 Oct) Pair it with another exercise, or a second copy of itself; its sets alternate. */
const SUPERSET_WITH: MenuItem = { action: 'superset_with', label: 'Superset with…', destructive: false };
/** (Ben, 19 Oct) Each member back to its own sets. */
const REMOVE_SUPERSET: MenuItem = { action: 'remove_superset', label: 'Remove superset', destructive: false };
/** (workout-table-v3 §7) The v3 round page's words, the builder's: the round moves, pairs with the next, unlinks. */
const MOVE_UP: MenuItem = { action: 'move_up', label: 'Move up', destructive: false };
const MOVE_DOWN: MenuItem = { action: 'move_down', label: 'Move down', destructive: false };
const SUPERSET_NEXT: MenuItem = { action: 'superset_next', label: 'Superset with next', destructive: false };
const UNLINK: MenuItem = { action: 'remove_superset', label: 'Unlink', destructive: false };
/** The exercise's history (it was on the name's sheet before the name opened the pop-up, v3 §7). */
const HISTORY: MenuItem = { action: 'history', label: 'History', destructive: false };
/** Plates for every load in today's targets (also from the name's sheet before v3 §7). */
const PLATES: MenuItem = { action: 'plates', label: 'Plates', destructive: false };
const ITEMS: readonly MenuItem[] = [
  { action: 'notes', label: 'Notes', destructive: false },
  { action: 'add_exercise', label: 'Add exercise', destructive: false },
  { action: 'delete_set', label: 'Delete this set', destructive: true },
  { action: 'skip_exercise', label: 'Skip exercise', destructive: true },
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
  /**
   * (workout-table-v3 §7) The v3 round page: Move up / Move down (rounds not started only) and
   * Superset with next, as the builder's pop-up; `Remove superset` reads `Unlink`; History.
   */
  round?: { moveUp: boolean; moveDown: boolean; supersetNext: boolean; history: boolean; plates?: boolean };
  /** (Ben, 26 Oct) The current exercise on the round page: `Adjust` leads the sheet. */
  adjust?: boolean;
}

export function exerciseMenu(hasHowTo: boolean, hasCoachChange: boolean | 'rule' = false, o: ExerciseMenuOptions = {}): ExerciseMenu {
  const undo = hasCoachChange === 'rule' ? [UNDO_RULE] : hasCoachChange ? [UNDO_COACH] : [];
  const r = o.round;
  const items = [
    ...(o.adjust === true ? [ADJUST] : []),
    ...(hasHowTo ? [HOW_TO] : []),
    ...(r?.history === true ? [HISTORY] : []),
    ...(r?.plates === true ? [PLATES] : []),
    ...undo,
    ...(o.canUndoSwap ? [UNDO_SWAP] : []),
    ...(o.canEditSet ? [EDIT_SET] : []),
    ...(o.hasTargetRpe ? [TARGET_RPE] : []),
    ADD_SET,
    ...(o.canSwap ? [SWAP] : []),
    ...(r?.moveUp === true ? [MOVE_UP] : []),
    ...(r?.moveDown === true ? [MOVE_DOWN] : []),
    ...(o.canMarkNotHere ? [NOT_AT_GYM] : []),
    ...(r?.supersetNext === true ? [SUPERSET_NEXT] : []),
    ...(o.canSuperset ? [SUPERSET_WITH] : []),
    ...(o.inSuperset ? [r === undefined ? REMOVE_SUPERSET : UNLINK] : []),
    ...ITEMS,
    ...(o.canRemove ? [REMOVE] : []),
    CANCEL,
  ];
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
 * `Target RPE` sheet: `RPE 6` … `RPE 10` (the current one marked `✓`), and
 * `Default` when Ben has set his own. `valueAt`: undefined for Cancel.
 */
export function targetRpeMenu(current: TargetRpe | null): TargetRpeMenu {
  const values: (number | null)[] = [...TARGET_RPE_CHOICES, ...(current?.source === 'ben' ? [null] : [])];
  const options = values.map((v) => (v === null ? 'Default' : `RPE ${formatNumber(v)}${current?.rpe === v ? ' ✓' : ''}`));
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
 * Edit set's `Target RPE` chips: the same choices as the `⋯` sheet, with
 * `Default` when Ben has set his own (review target-rpe r2 N3).
 */
export function targetRpeChips(current: { target: TargetRpe | null; override: number | null } | null): TargetRpeChip[] {
  if (current === null) return [];
  const chips: TargetRpeChip[] = TARGET_RPE_CHOICES.map((n) => ({ key: String(n), label: formatNumber(n), value: n, selected: current.target?.rpe === n }));
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

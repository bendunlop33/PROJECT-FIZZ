/**
 * The active exercise's `⋯` action sheet (active-workout.md §4.4). Pure, so
 * the index → action mapping is tested rather than shifted by hand next to
 * destructive actions (review S3). `How to` leads when the exercise has one
 * (ADR 0013), so the bottom rows stay put under the thumb either way.
 */
import { formatNumber, TARGET_RPE_CHOICES, type TargetRpe } from '@fizz/domain';
import type { TargetRpeScope } from '@fizz/schemas';

export type ExerciseMenuAction = 'how_to' | 'undo_coach' | 'target_rpe' | 'add_set' | 'add_exercise' | 'delete_set' | 'skip_exercise';

interface MenuItem {
  action: ExerciseMenuAction | 'cancel';
  label: string;
  destructive: boolean;
}

const HOW_TO: MenuItem = { action: 'how_to', label: 'How to', destructive: false };
/** While the focused set carries a coach change still pending (coach-adjustments §2.7). */
const UNDO_COACH: MenuItem = { action: 'undo_coach', label: 'Undo coach change', destructive: false };
/** The same for the built-in rule's change (CA6 revised): never called the coach's. */
const UNDO_RULE: MenuItem = { action: 'undo_coach', label: 'Undo change', destructive: false };
/** Ben's own target RPE (CHANGELOG 2026-10-11): only on a set that carries one (not a warm-up or drop set). */
const TARGET_RPE: MenuItem = { action: 'target_rpe', label: 'Target RPE', destructive: false };
const ITEMS: readonly MenuItem[] = [
  { action: 'add_set', label: 'Add set', destructive: false },
  { action: 'add_exercise', label: 'Add exercise', destructive: false },
  { action: 'delete_set', label: 'Delete this set', destructive: true },
  { action: 'skip_exercise', label: 'Skip exercise', destructive: true },
  { action: 'cancel', label: 'Cancel', destructive: false },
];

export interface ExerciseMenu {
  /** Labels in sheet order. */
  options: string[];
  /** Rows shown red (iOS takes an array). */
  destructiveButtonIndex: number[];
  cancelButtonIndex: number;
  /** The action for a tapped row; null for Cancel, a dismissal or an unknown index. */
  actionAt: (index: number) => ExerciseMenuAction | null;
}

export function exerciseMenu(hasHowTo: boolean, hasCoachChange: boolean | 'rule' = false, hasTargetRpe = false): ExerciseMenu {
  const undo = hasCoachChange === 'rule' ? [UNDO_RULE] : hasCoachChange ? [UNDO_COACH] : [];
  const items = [...(hasHowTo ? [HOW_TO] : []), ...undo, ...(hasTargetRpe ? [TARGET_RPE] : []), ...ITEMS];
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

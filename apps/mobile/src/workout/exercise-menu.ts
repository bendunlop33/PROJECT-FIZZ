/**
 * The active exercise's `⋯` action sheet (active-workout.md §4.4). Pure, so
 * the index → action mapping is tested rather than shifted by hand next to
 * destructive actions (review S3). `How to` leads when the exercise has one
 * (ADR 0013), so the bottom rows stay put under the thumb either way.
 */
import { formatNumber, rirOfRpe, TARGET_RPE_CHOICES, type TargetRpe } from '@fizz/domain';
import type { TargetRpeScope } from '@fizz/schemas';

import type { SymbolName } from '../ui/Icon';

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
  | 'do_first'
  | 'make_main'
  | 'move_to_end'
  | 'not_at_gym'
  | 'superset_with'
  | 'remove_superset'
  | 'notes'
  | 'add_exercise'
  | 'delete_set'
  | 'skip_exercise'
  | 'remove_exercise'
  /** (Ben, 2 Nov) The round page's menu, from the name's former pop-up. */
  | 'superset_next'
  | 'unlink'
  | 'add_warmup'
  | 'rest'
  | 'why_weight';

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
 * Focus view's `⋯` (active-workout.md §4.4). The round page (Table, the default) has its own context
 * menu: `roundContextMenu`.
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

/** One row (or icon button) of the round page's context menu. */
export interface ContextMenuItem {
  action: ExerciseMenuAction;
  /** What the row shows (`Later` on an icon button). */
  label: string;
  /** VoiceOver's name for it (`Move to end` for `Later`); the label when absent. */
  accessibilityLabel?: string;
  /** Shown after the label in secondary ink: what an Undo undoes (`Rotation ← Face pull`). */
  detail?: string;
  icon: SymbolName;
  destructive?: boolean;
}

/**
 * The round page's context menu (Ben, 1 Nov, A): Undo rows first (only while something can be undone), a row of
 * icon buttons for the moves that would change the order, the actions, a short second section (Ben, 2 Nov: what
 * the name's pop-up had), then Skip and Remove in red after a separator. No Cancel: a tap outside dismisses it.
 */
export interface ContextMenuModel {
  undo: ContextMenuItem[];
  moves: ContextMenuItem[];
  rows: ContextMenuItem[];
  more: ContextMenuItem[];
  danger: ContextMenuItem[];
}

/** (Ben, 2 Nov) The second section's facts: each row only when it applies. */
export interface ContextMenuMore {
  /** The exercise has a guide. */
  howTo: boolean;
  /** `canAddWarmupNow`. */
  warmup: boolean;
  /** Per-set-type rest rows exist (sets not done yet); the text shown is the first row's (`2:00`). Null: no row. */
  rest: string | null;
  /** `supersetNextCommand` would pair it with the next exercise. */
  supersetNext: boolean;
  /** It's in a superset. */
  unlink: boolean;
  /** It has a set whose target can be explained. */
  why: boolean;
}

export interface RoundContextMenuOptions {
  /** The exercise has sets to swap (`midSwapSlot`: with sets done, the rest are swapped). */
  canSwap: boolean;
  /** `roundMoves` (Ben, 1 Nov): only moves that change the order; never on a started exercise, never above one. */
  moves: { up: boolean; down: boolean; first: boolean; toEnd: boolean };
  /** Plates: the exercise's targets have a breakdown (a bar or a plate-loaded machine; never dumbbells or a stack). */
  plates: boolean;
  /** A coach (true) or built-in rule ('rule') change on the next set can still be undone. */
  coachChange?: boolean | 'rule';
  /** Today's swap, while it can still be undone: what it swapped (`to ← from`). */
  swapped?: { from: string; to: string } | null;
  /** The current exercise: the coach's `Adjust` chips (the only way to them on the round page). */
  adjust?: boolean;
  /** Skip: the exercise has a set not done yet. */
  canSkip?: boolean;
  /** (Ben, 1 Nov) `Make main lift` (`mainLiftOffer`): a plan workout's compound that isn't today's main lift. */
  makeMain?: boolean;
  /** (Ben, 2 Nov) The second section; absent: none. */
  more?: ContextMenuMore;
  /** (Ben, 2 Nov) `Remove exercise` (`canRemoveExercise`; with logged sets it asks first and keeps them). */
  canRemove?: boolean;
}

/**
 * (Ben, 1 Nov, approved A) Undo… · Later / Now / Up / Down · Swap exercise · Make main lift (1 Nov) · Add set · History · Notes · Plates
 * (bar or plate-loaded only) · Adjust (current only); (Ben, 2 Nov) How to · Add warm-up · Rest · Superset with next
 * or Unlink · Why this weight?; then Skip exercise and Remove exercise in red. Elsewhere: Edit set, Target RIR and
 * Delete on the set's own hold menu and swipe; Add exercise at the end of the list; Not at this gym in the Swap
 * sheet. The name itself opens nothing (Ben, 2 Nov).
 */
export function roundContextMenu(o: RoundContextMenuOptions): ContextMenuModel {
  const c = o.coachChange ?? false;
  const undo: ContextMenuItem[] = [];
  if (o.swapped != null) undo.push({ action: 'undo_swap', label: 'Undo swap', detail: `${o.swapped.to} ← ${o.swapped.from}`, accessibilityLabel: `Undo swap, ${o.swapped.to} back to ${o.swapped.from}`, icon: 'arrow.uturn.backward' });
  if (c !== false) undo.push({ action: 'undo_coach', label: c === 'rule' ? 'Undo change' : 'Undo coach change', icon: 'arrow.uturn.backward' });
  const moves: ContextMenuItem[] = [
    ...(o.moves.toEnd ? [{ action: 'move_to_end' as const, label: 'Later', accessibilityLabel: 'Move to end', icon: 'arrow.down.to.line' as const }] : []),
    ...(o.moves.first ? [{ action: 'do_first' as const, label: 'Now', accessibilityLabel: 'Do first', icon: 'arrow.up.to.line' as const }] : []),
    ...(o.moves.up ? [{ action: 'move_up' as const, label: 'Up', accessibilityLabel: 'Move up', icon: 'arrow.up' as const }] : []),
    ...(o.moves.down ? [{ action: 'move_down' as const, label: 'Down', accessibilityLabel: 'Move down', icon: 'arrow.down' as const }] : []),
  ];
  const rows: ContextMenuItem[] = [
    ...(o.canSwap ? [{ action: 'swap' as const, label: 'Swap exercise', icon: 'arrow.left.arrow.right' as const }] : []),
    // (Ben, 1 Nov) Right after Swap.
    ...(o.makeMain === true ? [{ action: 'make_main' as const, label: 'Make main lift', icon: 'star' as const }] : []),
    { action: 'add_set', label: 'Add set', icon: 'plus' },
    { action: 'history', label: 'History', icon: 'clock.arrow.circlepath' },
    { action: 'notes', label: 'Notes', icon: 'note.text' },
    ...(o.plates ? [{ action: 'plates' as const, label: 'Plates', icon: 'circle.circle' as const }] : []),
    ...(o.adjust === true ? [{ action: 'adjust' as const, label: 'Adjust', icon: 'slider.horizontal.3' as const }] : []),
  ];
  const x = o.more;
  const more: ContextMenuItem[] =
    x === undefined
      ? []
      : [
          ...(x.howTo ? [{ action: 'how_to' as const, label: 'How to', icon: 'play.circle' as const }] : []),
          ...(x.warmup ? [{ action: 'add_warmup' as const, label: 'Add warm-up', icon: 'flame' as const }] : []),
          ...(x.rest !== null ? [{ action: 'rest' as const, label: 'Rest', detail: x.rest, accessibilityLabel: `Rest, ${x.rest}`, icon: 'timer' as const }] : []),
          ...(x.supersetNext ? [{ action: 'superset_next' as const, label: 'Superset with next', icon: 'link' as const }] : []),
          ...(x.unlink ? [{ action: 'unlink' as const, label: 'Unlink', icon: 'scissors' as const }] : []),
          ...(x.why ? [{ action: 'why_weight' as const, label: 'Why this weight?', icon: 'questionmark.circle' as const }] : []),
        ];
  const danger: ContextMenuItem[] = [
    ...(o.canSkip === false ? [] : [{ action: 'skip_exercise' as const, label: 'Skip exercise', icon: 'forward.end' as const, destructive: true }]),
    ...(o.canRemove === true ? [{ action: 'remove_exercise' as const, label: 'Remove exercise', icon: 'trash' as const, destructive: true }] : []),
  ];
  return { undo, moves, rows, more, danger };
}

/** Every item in menu order (VoiceOver's actions, tests). */
export function contextMenuItems(m: ContextMenuModel): ContextMenuItem[] {
  return [...m.undo, ...m.moves, ...m.rows, ...m.more, ...m.danger];
}

/** A rectangle in window points (`measureInWindow`). */
export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CONTEXT_MENU = { width: 250, rowH: 44, movesH: 58, sepH: 6, gap: 8, margin: 12 } as const;

/** The menu's height: rows of 44 pt, the icon row, and a 6 pt separator before each later section. */
export function contextMenuHeight(m: ContextMenuModel): number {
  const sections = [m.undo.length > 0, m.moves.length > 0, m.rows.length > 0, m.more.length > 0, m.danger.length > 0].filter(Boolean).length;
  return (m.undo.length + m.rows.length + m.more.length + m.danger.length) * CONTEXT_MENU.rowH + (m.moves.length > 0 ? CONTEXT_MENU.movesH : 0) + Math.max(0, sections - 1) * CONTEXT_MENU.sepH;
}

/**
 * Where the lifted card and the menu sit (A: "next to the card"): under the card, right-aligned with it; above it
 * when there's no room below; and when neither fits, the card is shown higher so the menu fits under it. With no
 * card on screen (opened from the Workout sheet) the card sits near the top. Pure; tested.
 */
export function contextMenuPlacement(anchor: MenuAnchor | null, menuH: number, win: { width: number; height: number }, insets: { top: number; bottom: number }): { card: MenuAnchor; menu: { top: number; left: number; width: number } } {
  const { width: W, gap, margin } = CONTEXT_MENU;
  const top = insets.top + margin;
  const bottom = win.height - insets.bottom - margin;
  const width = Math.min(W, win.width - 2 * margin);
  const card0: MenuAnchor = anchor ?? { x: margin, y: top + 40, width: win.width - 2 * margin, height: 56 };
  const left = Math.max(margin, Math.min(card0.x + card0.width - width, win.width - margin - width));
  if (card0.y + card0.height + gap + menuH <= bottom) return { card: card0, menu: { top: card0.y + card0.height + gap, left, width } };
  if (card0.y - gap - menuH >= top) return { card: card0, menu: { top: card0.y - gap - menuH, left, width } };
  // Neither fits as it is: the card moves up (to the top at most) so the menu fits under it (still too tall: it scrolls).
  const cardY = Math.max(top, bottom - menuH - gap - card0.height);
  return { card: { ...card0, y: cardY }, menu: { top: cardY + card0.height + gap, left, width } };
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

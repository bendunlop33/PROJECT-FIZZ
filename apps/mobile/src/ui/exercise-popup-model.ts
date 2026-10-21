import type { LoadConvention, SetType, WeightUnit } from '@fizz/schemas';

/**
 * The exercise pop-up's model (workout-builder-v3 §2.4; workout-table-v3
 * §7: "same functionality as when building them"). One shape for both
 * pages: the builder maps a slot into it (`popupView`), the active workout
 * maps a session row (`sessionPopupView`). Pure: values and actions only,
 * every number comes from a service (minimal copy, CLAUDE.md).
 */

export const SET_TYPE_LABEL: Readonly<Record<SetType, string>> = { warmup: 'Warm-up', working: 'Working', top: 'Top set', backoff: 'Back-off', drop: 'Drop' };
export const SET_TYPES: readonly SetType[] = ['warmup', 'working', 'top', 'backoff', 'drop'];

/** A rest stepper's step (§2.4). */
export const REST_STEP_S = 15;

/** Keyboard bar steps (§2.7): reps 1, RPE 0.5; kg comes from this gym's next loadable weight (service). */
export const KEY_STEPS = { reps: 1, rpe: 0.5 } as const;

export const POPUP_COPY = {
  swapExercise: 'Swap exercise',
  moveUp: 'Move up',
  moveDown: 'Move down',
  supersetNext: 'Superset with next',
  unlink: 'Unlink',
  done: 'Done',
  next: 'Next',
  delete: 'Delete',
  remove: 'Remove',
  whyWeight: 'Why this weight?',
  warmup: '＋ Warm-up',
  set: '＋ Set',
  rest: 'Rest',
  mayHurt: 'May hurt',
  changeType: 'Change type',
  deleteSet: 'Delete set',
  type: 'Type',
  cancel: 'Cancel',
} as const;

export type PopupField = 'reps' | 'kg' | 'rpe';

const trim = (n: number): string => String(Math.round(n * 100) / 100);

/** `1:00`, `3:30` (rest, 15 s steps). */
export function restText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** A target load as the tables show it (§2.3): `100`, `30 each`, `25 assist`, `BW`, `BW+10`, `—`; another unit inline (`45 lb`). */
export function loadText(value: number | null, unit: WeightUnit, convention: LoadConvention, headerUnit: WeightUnit): string {
  if (convention === 'bodyweight') return 'BW';
  if (value === null) return '—';
  const u = unit === headerUnit ? '' : ` ${unit}`;
  switch (convention) {
    case 'per_hand':
      return `${trim(value)}${u} each`;
    case 'assistance':
      return `${trim(value)}${u} assist`;
    case 'added':
      return value === 0 ? 'BW' : `BW+${trim(value)}${u}`;
    case 'total':
    case 'stack':
      return `${trim(value)}${u}`;
  }
}

/** Spoken form for VoiceOver: `30 kilograms each`, `25 kilograms assistance`. */
export function loadSpoken(value: number | null, unit: WeightUnit, convention: LoadConvention): string {
  if (convention === 'bodyweight') return 'bodyweight';
  if (value === null) return 'no load yet';
  const u = unit === 'kg' ? 'kilograms' : 'pounds';
  switch (convention) {
    case 'per_hand':
      return `${trim(value)} ${u} each`;
    case 'assistance':
      return `${trim(value)} ${u} assistance`;
    case 'added':
      return `bodyweight plus ${trim(value)} ${u}`;
    case 'total':
    case 'stack':
      return `${trim(value)} ${u}`;
  }
}

export interface PopupSetRow {
  /** Stable per row: the builder's row index, the session's set ID. Typed drafts, focus and edits are keyed by it. */
  key: string;
  /** The row's position in `PopupView.rows` (the builder's row index for its commands). */
  index: number;
  /** `W` for a warm-up, else the working set's number. */
  mark: string;
  type: SetType;
  typeText: string;
  /** Reps as a number to edit; null when the set isn't counted in reps (timed). */
  reps: number | null;
  /** What the Reps cell shows: `8`, `8–12`, `0:45`. */
  repsText: string;
  kgText: string;
  load: number | null;
  rpeText: string;
  rpe: number | null;
  /** Logged (the active workout): its values are what was done; an edit is a versioned correction (rule 2). */
  done: boolean;
  /** Reps / kg / RPE can be typed here. */
  editable: boolean;
  /** No target effort: warm-ups (and drop sets in the workout). */
  noRpe: boolean;
  canDelete: boolean;
  /** Press-and-hold drag and VoiceOver Move up / Move down (sets not done yet only). */
  canMoveUp: boolean;
  canMoveDown: boolean;
  draggable: boolean;
  accessibilityLabel: string;
  /** `Warm-up 1`, `Set 2`: what VoiceOver says before each cell (`Set 2, reps`). */
  spokenName: string;
}

export interface PopupRestRow {
  /** The builder's rest kind, or the session's set type; `round` in a superset. */
  kind: string;
  label: string;
  seconds: number;
  text: string;
  /** A 15 s step down or up is still in range (no write that changes nothing). */
  canMinus: boolean;
  canPlus: boolean;
}

export interface PopupView {
  name: string;
  works: string | null;
  kgHeader: string;
  rows: PopupSetRow[];
  canAddWarmup: boolean;
  canAddSet: boolean;
  rests: PopupRestRow[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  canSupersetNext: boolean;
  canUnlink: boolean;
  mayHurt: boolean;
  /** `Swap exercise` top right: hidden when there's nothing left to swap (every set done). */
  canSwap: boolean;
  /** `Delete` (builder) or `Remove` (today only, mid-workout). */
  deleteLabel: string;
  /** Hidden when it would be refused (a finished exercise has nothing to remove; review S5). */
  canDeleteExercise: boolean;
}

/** `Next` order: Reps → Kg → RPE → next set's Reps (§2.7). Null at the end. */
export function nextField(rowIndex: number, field: PopupField, rowCount: number, hasRpe: (i: number) => boolean): { row: number; field: PopupField } | null {
  if (field === 'reps') return { row: rowIndex, field: 'kg' };
  if (field === 'kg' && hasRpe(rowIndex)) return { row: rowIndex, field: 'rpe' };
  return rowIndex + 1 < rowCount ? { row: rowIndex + 1, field: 'reps' } : null;
}

/**
 * The row a typed cell belongs to, by its key (review B1): never by position, so a skipped or
 * removed set before it can't send an edit to another set (a logged one included, rule 2).
 */
export function popupRowByKey(rows: readonly PopupSetRow[], key: string): PopupSetRow | undefined {
  return rows.find((r) => r.key === key);
}

/** `Next` from a cell, by row key: the next field in this row, else the next row's Reps; null at the end. */
export function nextFieldByKey(rows: readonly PopupSetRow[], key: string, field: PopupField): { key: string; field: PopupField } | null {
  const at = rows.findIndex((r) => r.key === key);
  if (at < 0) return null;
  const n = nextField(at, field, rows.length, (i) => rows[i]?.noRpe === false);
  const row = n === null ? undefined : rows[n.row];
  return n === null || row === undefined ? null : { key: row.key, field: n.field };
}

export type PopupRowAction = 'type' | 'move_up' | 'move_down' | 'delete_set';

/** A set row's VoiceOver actions, also the long-press menu (§7: Change type, Move up, Move down, Delete). */
export function popupRowActions(row: Pick<PopupSetRow, 'canDelete' | 'canMoveUp' | 'canMoveDown'>): { name: PopupRowAction; label: string }[] {
  return [
    { name: 'type', label: POPUP_COPY.changeType },
    ...(row.canMoveUp ? [{ name: 'move_up' as const, label: POPUP_COPY.moveUp }] : []),
    ...(row.canMoveDown ? [{ name: 'move_down' as const, label: POPUP_COPY.moveDown }] : []),
    ...(row.canDelete ? [{ name: 'delete_set' as const, label: POPUP_COPY.deleteSet }] : []),
  ];
}

/** The long-press menu (the drag's fallback): the row's actions, then Cancel; `actionAt` maps a tap back. */
export function holdMenu<A extends string>(actions: readonly { name: A; label: string }[]): { options: string[]; cancelButtonIndex: number; destructiveButtonIndex: number[]; actionAt: (i: number) => A | null } {
  return {
    options: [...actions.map((a) => a.label), POPUP_COPY.cancel],
    cancelButtonIndex: actions.length,
    destructiveButtonIndex: actions.flatMap((a, i) => (a.name === 'delete_set' || a.name === 'delete' || a.name === 'remove' ? [i] : [])),
    actionAt: (i) => actions[i]?.name ?? null,
  };
}

/** The Type sheet: every set type, the current one marked; `typeAt` maps a tap back (null: Cancel or the same type). */
export function typeMenu(current: SetType): { options: string[]; cancelButtonIndex: number; typeAt: (i: number) => SetType | null } {
  return {
    options: [...SET_TYPES.map((t) => `${SET_TYPE_LABEL[t]}${t === current ? ' ✓' : ''}`), POPUP_COPY.cancel],
    cancelButtonIndex: SET_TYPES.length,
    typeAt: (i) => {
      const t = SET_TYPES[i];
      return t === undefined || t === current ? null : t;
    },
  };
}

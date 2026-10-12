import { dayMonthText, formatDuration, toMs, type LibraryRow, type RoutineConflict, type RoutineIssue } from '@fizz/domain';

import { formatTime } from '../format/dates';
import type { RoutineExercise } from '@fizz/schemas';

/**
 * The Workouts library's words and small screen rules (routines.md Part A
 * §A5). Pure: the services build the rows; these only pick labels, menus
 * and toasts. The UI says "workout", never "routine" (WL1).
 */

export const LIBRARY_COPY_UI = {
  title: 'Workouts',
  rotation: 'Your rotation',
  all: 'All workouts',
  history: 'From history',
  recent: 'Recent',
  az: 'A–Z',
  showAll: (n: number) => `Show all (${String(n)})`,
  save: 'Save',
  upNext: 'Up next',
  newWorkout: 'New workout',
  editWorkout: 'Edit workout',
  duplicate: 'Duplicate',
  addToRotation: 'Add to rotation',
  removeFromRotation: 'Remove from rotation',
  delete: 'Delete',
  cancel: 'Cancel',
  empty: 'No workouts yet.',
  emptyWorkout: 'Empty workout',
  inProgress: (name: string) => `${name} in progress`,
  resume: 'Resume',
  loadFailed: 'Couldn’t open your data.',
  tryAgain: 'Try again',
  restore: 'Restore from backup',
  more: 'More',
  saveToWorkouts: 'Save to Workouts',
  /** The Save sheet's summary-line `Edit ›` (§A2.5, WL-A18) and its VoiceOver label. */
  edit: 'Edit',
  editBeforeSaving: 'Edit sets before saving',
  savedToWorkouts: 'Saved to Workouts',
  savedLink: (name: string) => `Saved · ${name} ›`,
  nothingToSave: 'Nothing to save',
  saveFailed: 'Couldn’t save. Try again.',
  undo: 'Undo',
} as const;

export const EDITOR_COPY = {
  newTitle: 'New workout',
  editTitle: 'Edit workout',
  name: 'Name',
  exercises: 'Exercises',
  main: 'Main',
  addExercise: 'Add exercise',
  addWarmup: '+ Warm-up',
  addWorking: '+ Working',
  addMore: '+ More',
  topSet: 'Top set',
  backoff: 'Back-off',
  dropSet: 'Drop set',
  restByType: 'Rest by set type',
  replace: 'Replace',
  exerciseInfo: 'Exercise info',
  supersetWithNext: 'Superset with next',
  ungroup: 'Ungroup',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  save: 'Save',
  noChanges: 'No changes',
  inProgress: 'In progress · changes apply next time',
  discardTitle: 'Discard changes?',
  discard: 'Discard',
  keepEditing: 'Keep editing',
  cancel: 'Cancel',
  done: 'Done',
  type: 'Type',
  load: 'Load',
  auto: 'Auto',
  fixed: 'Fixed',
  autoInfo: 'Auto: the coach’s target from the last time you did this workout, or the built-in rule’s. Worked out when you start.',
  reps: 'Reps',
  range: 'Range',
  exact: 'Exact',
  workTime: 'Work time',
  restAfter: 'Rest after this set',
  thisSetOnly: 'This set only',
  useDefault: 'Use default',
  deleteSet: 'Delete set',
  removeExerciseTitle: (exercise: string, workout: string) => `Remove ${exercise} from ${workout}?`,
  search: 'Search exercises',
  conflictTitle: (name: string) => `${name} changed while you were editing`,
  keepBoth: 'Keep both',
  discardMine: 'Discard my edits',
  mine: 'Mine',
  theirs: 'Newer',
} as const;

/** The row's `⋯` menu (§A2.1): one list, also the VoiceOver custom actions. */
export function rowMenu(row: Pick<LibraryRow, 'inRotation'>): string[] {
  return [LIBRARY_COPY_UI.editWorkout, LIBRARY_COPY_UI.duplicate, row.inRotation ? LIBRARY_COPY_UI.removeFromRotation : LIBRARY_COPY_UI.addToRotation, LIBRARY_COPY_UI.delete];
}

/** `Delete Push A?` · `Past workouts stay.` (§A5). */
export function deleteConfirm(name: string): { title: string; message: string; confirm: string } {
  return { title: `Delete ${name}?`, message: 'Past workouts stay.', confirm: LIBRARY_COPY_UI.delete };
}

export const LIBRARY_TOASTS = {
  saved: (name: string) => `Saved ${name}`,
  deleted: (name: string) => `${name} deleted`,
  added: (name: string) => `${name} added to your rotation`,
  removed: (name: string) => `${name} removed from your rotation`,
} as const;

/** Line 2 of a row (§A2.1), with the gym problem as `⚠` + text in place of last done. */
export function rowLine(row: Pick<LibraryRow, 'detail' | 'issue'>): { text: string; issue: string | null } {
  return { text: row.detail, issue: row.issue };
}

/**
 * The editor's primary (routines.md §3.3): `Add a name`, then `Add an
 * exercise`, then `Save`; a stored workout with nothing changed reads `No
 * changes`; any other issue reads `Fix 1 issue`. Disabled unless it saves.
 */
export function editorPrimary(input: { issues: readonly RoutineIssue[]; dirty: boolean; isNew: boolean }): { label: string; disabled: boolean } {
  const first = input.issues[0];
  if (first === 'Add a name' || first === 'Add an exercise') return { label: first, disabled: true };
  if (first !== undefined) return { label: `Fix ${String(input.issues.length)} ${input.issues.length === 1 ? 'issue' : 'issues'}`, disabled: true };
  if (!input.isNew && !input.dirty) return { label: EDITOR_COPY.noChanges, disabled: true };
  return { label: EDITOR_COPY.save, disabled: false };
}

/** An exercise card's `⋯` (§A2.3, revised 2026-10-12): Replace, Exercise info, Superset with next / Ungroup, Move up, Move down, Remove. */
export function exerciseMenu(list: readonly Pick<RoutineExercise, 'id' | 'supersetGroup'>[], slotId: string): string[] {
  const i = list.findIndex((e) => e.id === slotId);
  const slot = list[i];
  if (slot === undefined) return [];
  const next = list[i + 1];
  const canGroup = next !== undefined && !(slot.supersetGroup !== null && slot.supersetGroup === next.supersetGroup);
  return [
    EDITOR_COPY.replace,
    EDITOR_COPY.exerciseInfo,
    ...(canGroup ? [EDITOR_COPY.supersetWithNext] : []),
    ...(slot.supersetGroup !== null ? [EDITOR_COPY.ungroup] : []),
    ...(i > 0 ? [EDITOR_COPY.moveUp] : []),
    ...(i < list.length - 1 ? [EDITOR_COPY.moveDown] : []),
    EDITOR_COPY.remove,
  ];
}

/** The `Main` chip's VoiceOver (§A2.3): "Main lift, on". */
export function mainChipLabel(on: boolean): string {
  return `Main lift, ${on ? 'on' : 'off'}`;
}

/** The conflict sheet's lines (v0.1 §3.3): what changed, and when. */
export function conflictLines(input: { lines: readonly string[]; changedAtUtc: string; tz: string }): string[] {
  const when = `${dayMonthText(input.changedAtUtc, input.tz)}, ${timeText(input.changedAtUtc, input.tz)}`;
  return input.lines.length > 0 ? input.lines.map((l) => `${l} · ${when}`) : [`Changed ${when}`];
}

function timeText(utc: string, tz: string): string {
  return formatTime(toMs(utc), tz);
}

/** One conflict, in words, for the sheet's per-item choice. */
export function conflictText(c: RoutineConflict, nameOf: (exerciseId: string) => string): { title: string; mine: string; theirs: string } {
  if (c.kind === 'name') return { title: 'Name', mine: c.mine, theirs: c.theirs };
  const say = (e: RoutineExercise | null) => (e === null ? 'Removed' : `${String(e.setTemplates.length)} ${e.setTemplates.length === 1 ? 'set' : 'sets'}${e.exerciseId === c.exerciseId ? '' : ` · ${nameOf(e.exerciseId)}`}`);
  return { title: nameOf(c.exerciseId), mine: say(c.mine), theirs: say(c.theirs) };
}

/** Rest choices in the set and rest sheets: Ben's presets, then common times; `m:ss`. */
export function restChoices(presets: readonly { seconds: number; presetName?: string | undefined }[]): { seconds: number; label: string }[] {
  const seen = new Set<number>();
  const out: { seconds: number; label: string }[] = [];
  for (const p of presets) {
    if (seen.has(p.seconds)) continue;
    seen.add(p.seconds);
    out.push({ seconds: p.seconds, label: `${p.presetName ?? ''} ${formatDuration(p.seconds)}`.trim() });
  }
  for (const s of [30, 60, 90, 120, 150, 180, 240, 300]) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ seconds: s, label: formatDuration(s) });
  }
  return out.sort((a, b) => a.seconds - b.seconds);
}

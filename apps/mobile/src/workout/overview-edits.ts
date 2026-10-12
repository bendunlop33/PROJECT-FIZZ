import type { OverviewGroup, OverviewRow, SubstituteRow, WorkoutOverview } from '@fizz/domain';

/**
 * Screen-side rules for today's edits on the Workout overview
 * (overview-today-edits.md §2–§5). Pure, so they run on Linux. They decide
 * what the page shows and sends from what the domain already worked out
 * (`row.actions`, `row.edit`, the Swap sheet's rows); they never apply an
 * edit, rank a candidate or compute a target.
 */

export const TODAY_EDITS_COPY = {
  swapToday: 'Swap today',
  skipToday: 'Skip today',
  doFirst: 'Do first',
  undoSwap: 'Undo swap',
  swapAgain: 'Swap again',
  bringBack: 'Bring back',
  reorder: 'Reorder',
  resetEdits: 'Reset today’s edits',
  resetOrder: 'Reset order',
  done: 'Done',
  skippedSuffix: '· skipped',
  planned: 'planned',
  noHistory: 'No history',
  mayHurt: 'May hurt',
  close: 'Close',
  changeTitle: (routineName: string) => `Change ${routineName}`,
  changeLink: (routineName: string) => `Change ${routineName} too ›`,
  scope: (routineName: string) => `${routineName} from now on`,
  changed: 'Changed',
  notNow: 'Not now',
  apply: 'Apply',
  applied: (routineName: string) => `✓ Applied · ${routineName} from now on`,
  undo: 'Undo',
  wasSuggested: 'Was suggested:',
  dismiss: 'Dismiss',
  earlierCleared: 'Earlier edits cleared',
  /** A coach change Ben applied that the overview's checks refused at this gym (review S1). */
  coachRefused: 'Coach change didn’t fit here',
  editFailed: 'Couldn’t save that edit.',
} as const;

/** `5 exercises · 3 edited` (§2.1; the label style sets the caps). */
export function listHeaderText(view: Pick<WorkoutOverview, 'exerciseCount' | 'editCount'>): string {
  const n = `${String(view.exerciseCount)} ${view.exerciseCount === 1 ? 'exercise' : 'exercises'}`;
  return view.editCount > 0 ? `${n} · ${String(view.editCount)} edited` : n;
}

/** The toasts (§5). Each edit's toast carries `Undo`; the screen holds what Undo sends. */
export const editToast = {
  swapped: (from: string, to: string) => `${from} → ${to} · today`,
  skipped: (name: string) => `${name} skipped today`,
  first: (name: string) => `${name} first`,
  orderReset: 'Order reset',
  editsReset: 'Today’s edits reset',
  routineChanged: (routineName: string) => `${routineName} changed`,
  planChanged: (n: number) => `Plan changed · ${String(n)} ${n === 1 ? 'edit' : 'edits'} removed`,
  cantUndo: (routineName: string) => `Can’t undo: ${routineName} changed since.`,
} as const;

export type EditPillKey = 'swap' | 'undo_swap' | 'skip' | 'bring_back' | 'do_first';

export interface EditPill {
  key: EditPillKey;
  label: string;
  accessibilityLabel: string;
}

/**
 * The row panel's edit pills, in order (§2.2): normal `Swap today · Skip
 * today · Do first`; swapped `Undo swap · Swap again · Skip today · Do
 * first`; skipped `Bring back`. `How to`, `Why?` and coach pills follow
 * (the row component adds them).
 */
export function editPills(row: Pick<OverviewRow, 'name' | 'actions' | 'edit'>): EditPill[] {
  const a = row.actions;
  const out: EditPill[] = [];
  const pill = (key: EditPillKey, label: string) => out.push({ key, label, accessibilityLabel: `${label}: ${row.name}` });
  if (a.bringBack) {
    pill('bring_back', TODAY_EDITS_COPY.bringBack);
    return out;
  }
  if (a.undoSwap) pill('undo_swap', TODAY_EDITS_COPY.undoSwap);
  if (a.swap) pill('swap', a.undoSwap ? TODAY_EDITS_COPY.swapAgain : TODAY_EDITS_COPY.swapToday);
  if (a.skip) pill('skip', TODAY_EDITS_COPY.skipToday);
  if (a.doFirst) pill('do_first', TODAY_EDITS_COPY.doFirst);
  return out;
}

/** A skipped row shows only `Bring back` and `How to` (§2.2): no `Why?`, no coach pills. */
export function showsWhy(row: Pick<OverviewRow, 'edit'>): boolean {
  return row.edit?.kind !== 'skipped';
}

export type RowCustomAction = { name: 'swap' | 'skip' | 'bring_back' | 'do_first' | 'move_up' | 'move_down'; label: string };

/** VoiceOver custom actions on a row (§4.5): Swap today, Skip today / Bring back, Do first, Move up, Move down. */
export function rowCustomActions(row: Pick<OverviewRow, 'actions'>): RowCustomAction[] {
  const a = row.actions;
  const out: RowCustomAction[] = [];
  if (a.swap) out.push({ name: 'swap', label: a.undoSwap ? TODAY_EDITS_COPY.swapAgain : TODAY_EDITS_COPY.swapToday });
  if (a.skip) out.push({ name: 'skip', label: TODAY_EDITS_COPY.skipToday });
  if (a.bringBack) out.push({ name: 'bring_back', label: TODAY_EDITS_COPY.bringBack });
  if (a.doFirst) out.push({ name: 'do_first', label: TODAY_EDITS_COPY.doFirst });
  if (a.up) out.push({ name: 'move_up', label: 'Move up' });
  if (a.down) out.push({ name: 'move_down', label: 'Move down' });
  return out;
}

/** One Reorder row (§2.3): a single exercise, or a whole superset with its members stacked. */
export interface ReorderUnit {
  /** The slot the `↑` / `↓` move (the first member; a superset moves as one). */
  slotKey: string;
  indexText: string;
  names: string[];
  skipped: boolean[];
  superset: boolean;
  up: boolean;
  down: boolean;
  /** VoiceOver: `Move Incline DB press up`. */
  upLabel: string;
  downLabel: string;
}

export function reorderUnits(groups: readonly OverviewGroup[]): ReorderUnit[] {
  return groups.map((g) => {
    const rows = g.kind === 'single' ? [g.row] : g.rows;
    const first = rows[0];
    const name = rows.map((r) => r.name).join(' and ');
    return {
      slotKey: first?.slotKey ?? '',
      indexText: first?.indexText ?? '',
      names: rows.map((r) => r.name),
      skipped: rows.map((r) => r.edit?.kind === 'skipped'),
      superset: g.kind === 'superset',
      up: first?.actions.up ?? false,
      down: first?.actions.down ?? false,
      upLabel: `Move ${name} up`,
      downLabel: `Move ${name} down`,
    };
  });
}

/** The `⋯` menu's added items (§5): `Reorder` always; `Reset today's edits` only with edits. */
export function editMenuItems(view: Pick<WorkoutOverview, 'editCount' | 'rows'>): string[] {
  return [...(view.rows.length > 1 ? [TODAY_EDITS_COPY.reorder] : []), ...(view.editCount > 0 ? [TODAY_EDITS_COPY.resetEdits] : [])];
}

/**
 * A Swap sheet tap (§2.4): the planned exercise is `Undo swap`; a flagged
 * one asks first (EL9); anything else is picked at once.
 */
export function swapTap(row: Pick<SubstituteRow, 'planned' | 'mayHurt'>): 'undo' | 'confirm' | 'pick' {
  if (row.planned) return 'undo';
  return row.mayHurt !== null ? 'confirm' : 'pick';
}

/** `No swaps at Main gym.` */
export function noSwapsText(gymName: string): string {
  return `No swaps at ${gymName}.`;
}

/** The sheet's subtitle: `Main gym · today`. */
export function swapSubtitle(gymName: string): string {
  return `${gymName} · today`;
}

/** The change-review card (§2.5): what it shows now. */
export type ChangeCard = { slotKey: string; routineVersion: number; fromName: string; toName: string; toExerciseId: string; editId: string } & ({ state: 'ready' } | { state: 'applied'; actionId: string });

/** Ready while the routine is still at the version the card was opened on; out of date (`Was suggested:`, no Apply) once it moved (CR4). */
export function changeCardState(card: ChangeCard, routineVersion: number | null): 'ready' | 'applied' | 'out_of_date' {
  if (card.state === 'applied') return 'applied';
  return routineVersion === card.routineVersion ? 'ready' : 'out_of_date';
}

/**
 * One operation ID per intent until it succeeds (§3: a failed write's retry
 * reuses its opId, so a write that landed before the error isn't repeated).
 */
export function createOpIds(newId: () => string): { of: (intent: string) => string; done: (intent: string) => void } {
  const ops = new Map<string, string>();
  return {
    of(intent) {
      const known = ops.get(intent);
      if (known !== undefined) return known;
      const id = newId();
      ops.set(intent, id);
      return id;
    },
    done(intent) {
      ops.delete(intent);
    },
  };
}

/** The toasts a fresh page asks for, once per draft version: `Earlier edits cleared`, `Plan changed · N edits removed`. */
export function pageToast(page: { cleared: boolean; removedEdits: number; draft: { id: string; version: number } | null; coachRefused?: number }, shown: ReadonlySet<string>): { key: string; text: string } | null {
  if (page.cleared) return { key: 'cleared', text: TODAY_EDITS_COPY.earlierCleared };
  if ((page.coachRefused ?? 0) > 0 && !shown.has('coach-refused')) return { key: 'coach-refused', text: TODAY_EDITS_COPY.coachRefused };
  if (page.removedEdits > 0 && page.draft !== null) {
    const key = `removed:${page.draft.id}:${String(page.draft.version)}`;
    return shown.has(key) ? null : { key, text: editToast.planChanged(page.removedEdits) };
  }
  return null;
}

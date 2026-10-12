import type { OverviewGroup, OverviewRow, StepTarget, SubstituteRow, WorkoutOverview } from '@fizz/domain';

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
  coachLanded: 'Coach change applied',
  editFailed: 'Couldn’t save that edit.',
} as const;

/** `5 exercises · 3 edited`, and `· fitted` with a live fit (§2.1, fit-to-time §3.3; the label style sets the caps). */
export function listHeaderText(view: Pick<WorkoutOverview, 'exerciseCount' | 'editCount'> & Partial<Pick<WorkoutOverview, 'fit'>>): string {
  const n = `${String(view.exerciseCount)} ${view.exerciseCount === 1 ? 'exercise' : 'exercises'}`;
  return [n, view.editCount > 0 ? `${String(view.editCount)} edited` : null, view.fit ? 'fitted' : null].filter((x): x is string => x !== null).join(' · ');
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

/**
 * Pain on the exercise being swapped: every substitute's target is held
 * today (B5, rule 9). The existing pain wording; null otherwise.
 */
export function swapPainLine(painHeld: boolean): string | null {
  return painHeld ? 'Pain flag · no increases' : null;
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

type ToastPage = { cleared: boolean; removedEdits: number; draft: { id: string; version: number } | null; coachRefused?: number; coachLanded?: number };

/**
 * Every toast a fresh page asks for, in the order they show (one after another,
 * so none is dropped; merge r3 S1): `Earlier edits cleared`, `Coach change didn’t fit here`,
 * `Coach change applied`, `Plan changed · N edits removed`. Keyed toasts show once per draft version.
 */
export function pageToasts(page: ToastPage, shown: ReadonlySet<string>): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (page.cleared) out.push({ key: 'cleared', text: TODAY_EDITS_COPY.earlierCleared });
  if ((page.coachRefused ?? 0) > 0 && !shown.has('coach-refused')) out.push({ key: 'coach-refused', text: TODAY_EDITS_COPY.coachRefused });
  // A refused coach change that landed on this load (merge r2 S2): once per landing.
  if ((page.coachLanded ?? 0) > 0 && page.draft !== null) {
    const key = `coach-landed:${page.draft.id}:${String(page.draft.version)}`;
    if (!shown.has(key)) out.push({ key, text: TODAY_EDITS_COPY.coachLanded });
  }
  // Cleared edits leave nothing to report as removed.
  if (!page.cleared && page.removedEdits > 0 && page.draft !== null) {
    const key = `removed:${page.draft.id}:${String(page.draft.version)}`;
    if (!shown.has(key)) out.push({ key, text: editToast.planChanged(page.removedEdits) });
  }
  return out;
}

/** The first toast a fresh page asks for (see `pageToasts`). */
export function pageToast(page: ToastPage, shown: ReadonlySet<string>): { key: string; text: string } | null {
  return pageToasts(page, shown)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Edit mode (overview-today-edits §11): what the page shows and sends. Pure.

export const EDIT_MODE_COPY = {
  edit: 'Edit',
  done: 'Done',
  reset: 'Reset',
  swap: 'Swap',
  skip: 'Skip',
  bringBack: 'Bring back',
  remove: 'Remove',
  addExercise: 'Add exercise',
  updateLink: (routineName: string) => `Update ${routineName} ›`,
  saveLink: 'Save to Workouts ›',
  updateTitle: (routineName: string) => `Update ${routineName}`,
  scope: (routineName: string) => `${routineName} from now on`,
  applied: (routineName: string) => `✓ Applied · ${routineName} from now on`,
  notNow: 'Not now',
  apply: 'Apply',
  wasSuggested: 'Was suggested:',
  dismiss: 'Dismiss',
  undo: 'Undo',
  repsTitle: (name: string) => `Reps · ${name}`,
  range: 'Range',
  exact: 'Exact',
  workTime: 'Work time',
  usePlanned: 'Use planned',
  setTarget: 'Set target',
  ben: 'Ben',
  noHistory: 'No history',
  nothingHere: (gymName: string) => `Nothing else here at ${gymName}.`,
  showAll: 'Show all',
  search: 'Search',
} as const;

/** Edit mode's toasts (§11.8). Steppers show none (`−` undoes `+` in place, TE14). */
export const editModeToast = {
  added: (name: string) => `${name} added`,
  removed: (name: string) => `${name} removed`,
  target: (loadText: string) => `Target ${loadText} today`,
  updated: (routineName: string) => `${routineName} updated`,
} as const;

/** The Edit mode top bar (§11.3): `Reset` only with edits; `Done` always. */
export function editTopBar(view: Pick<WorkoutOverview, 'editCount'>): { reset: boolean } {
  return { reset: view.editCount > 0 };
}

export type EditRowPillKey = 'swap' | 'skip' | 'bring_back' | 'remove';

/** An Edit mode row's outline pills (§11.3): `Swap` · `Skip`; a skipped row `Bring back`; an added one `Remove`. */
export function editRowPills(row: Pick<OverviewRow, 'name' | 'actions'>): { key: EditRowPillKey; label: string; accessibilityLabel: string }[] {
  const a = row.actions;
  const out: { key: EditRowPillKey; label: string; accessibilityLabel: string }[] = [];
  const pill = (key: EditRowPillKey, label: string) => out.push({ key, label, accessibilityLabel: `${label}: ${row.name}` });
  if (a.bringBack) {
    pill('bring_back', EDIT_MODE_COPY.bringBack);
    return out;
  }
  if (a.remove) {
    pill('remove', EDIT_MODE_COPY.remove);
    return out;
  }
  if (a.swap) pill('swap', EDIT_MODE_COPY.swap);
  if (a.skip) pill('skip', EDIT_MODE_COPY.skip);
  return out;
}

export type EditRowAction = { name: 'add_set' | 'remove_set' | 'change_reps' | 'change_target' | EditRowPillKey | 'move_up' | 'move_down'; label: string };

/** VoiceOver custom actions on an Edit mode row (§11.7): Add set, Remove set, Change reps, Change target, Swap, Skip, Move up, Move down. */
export function editRowCustomActions(row: Pick<OverviewRow, 'name' | 'actions' | 'editRow' | 'edit'>, moves: { up: boolean; down: boolean } | null): EditRowAction[] {
  if (row.edit?.kind === 'skipped') return [{ name: 'bring_back', label: EDIT_MODE_COPY.bringBack }, ...moveActions(moves)];
  const out: EditRowAction[] = [];
  if (row.editRow.setsUp !== null) out.push({ name: 'add_set', label: 'Add set' });
  if (row.editRow.setsDown !== null) out.push({ name: 'remove_set', label: 'Remove set' });
  out.push({ name: 'change_reps', label: 'Change reps' });
  if (row.editRow.keypad !== null) out.push({ name: 'change_target', label: 'Change target' });
  for (const p of editRowPills(row)) out.push({ name: p.key, label: p.label });
  return [...out, ...moveActions(moves)];
}

function moveActions(moves: { up: boolean; down: boolean } | null): EditRowAction[] {
  if (moves === null) return [];
  return [...(moves.up ? [{ name: 'move_up' as const, label: 'Move up' }] : []), ...(moves.down ? [{ name: 'move_down' as const, label: 'Move down' }] : [])];
}

/**
 * Which rows carry `↑` `↓` in Edit mode (§11.3): every single row, and the
 * first member of a superset (the group moves as one). Keyed by slot.
 */
export function editMoves(groups: readonly OverviewGroup[]): Map<string, ReorderUnit> {
  return new Map(reorderUnits(groups).map((u) => [u.slotKey, u]));
}

/**
 * The link under the list (§11.3, TE15): `Update Push A ›` on a saved
 * workout with something to list; `Save to Workouts ›` on a next session
 * with edits; nothing otherwise.
 */
export function updateLink(page: { templateCard: { routineName: string } | null; routine: { name: string } | null; view: Pick<WorkoutOverview, 'editCount'> }): { kind: 'update'; text: string } | { kind: 'save'; text: string } | null {
  if (page.templateCard !== null) return { kind: 'update', text: EDIT_MODE_COPY.updateLink(page.templateCard.routineName) };
  if (page.routine === null && page.view.editCount > 0) return { kind: 'save', text: EDIT_MODE_COPY.saveLink };
  return null;
}

/**
 * The Update card's state (§11.5): ready while Push A and today's draft are
 * both at the card's versions; `Was suggested:` once either moved (a `+`
 * tapped while the card is open changes what Apply would write, review B3);
 * Apply needs a tick.
 */
export function updateCardState(
  card: { routineVersion: number; draftVersion: number; applied: string | null },
  now: { routineVersion: number | null; draftVersion: number | null },
  checked: ReadonlySet<string>,
): { state: 'ready' | 'applied' | 'out_of_date'; applyEnabled: boolean } {
  if (card.applied !== null) return { state: 'applied', applyEnabled: false };
  if (now.routineVersion !== card.routineVersion || now.draftVersion !== card.draftVersion) return { state: 'out_of_date', applyEnabled: false };
  return { state: 'ready', applyEnabled: checked.size > 0 };
}

type DraftRef = { id: string; version: number };

/**
 * The draft version the next write sends (review S2): the newer of the page's
 * and the last write's. A write lands before the page re-reads, so a quick
 * second tap must build on what the first one left, never on the page it was
 * tapped on. A page read from before the first write (no draft yet) doesn't
 * undo it; a different draft (a new day) is the page's.
 */
export function nextDraftVersion(page: DraftRef | null, wrote: DraftRef | null): number | null {
  if (wrote === null) return page?.version ?? null;
  if (page === null) return wrote.version;
  if (page.id !== wrote.id) return page.version;
  return Math.max(page.version, wrote.version);
}

/**
 * The last write's draft after a page read (review r2 N2): a read that
 * started after that write and shows no draft, or another one (it expired at
 * midnight), retires it, so the next write sends the page's version, never
 * the gone draft's. A read from before the write leaves it as is.
 */
export function wroteAfterRead<W extends DraftRef & { seq: number }>(page: DraftRef | null, wrote: W | null, readSeq: number | undefined): W | null {
  if (wrote === null || readSeq === undefined || readSeq < wrote.seq) return wrote;
  return page !== null && page.id === wrote.id ? wrote : null;
}

/**
 * A queued draft write still belongs to the page it was tapped on (review r2
 * N1): not while a session switch runs, and not once another page is shown.
 */
export function queuedWriteLive(tappedOnPage: number, shownPage: number, switching: boolean): boolean {
  return !switching && tappedOnPage === shownPage;
}

/**
 * `Set target` with the keypad's opening value on a row that already has
 * Ben's load is no change (review r2 N5): at an lb gym it opens at the fitted
 * `80 lb each`, and writing that back would replace his `37.5 kg each`.
 */
export function loadUnchanged(row: { benLoad: boolean; keypad: { value: number | null } | null }, value: number | null): boolean {
  return row.benLoad && row.keypad !== null && value !== null && row.keypad.value === value;
}

/**
 * A row's working-set count to step from (review S2): the count the last
 * stepper write on it left, until the page shows that write (its draft
 * version or later), else the page's.
 */
export function stepperCount(pageCount: number, pageDraftVersion: number | null, pending: { count: number; version: number } | undefined): number {
  if (pending === undefined) return pageCount;
  return pageDraftVersion === null || pending.version > pageDraftVersion ? pending.count : pageCount;
}

/**
 * One lane for today's draft writes: a stepper tap waits its turn (`queue`)
 * so quick taps all land; any other edit tapped while a write runs is
 * dropped (a double tap sends one).
 */
export function createEditLane(): { run: <R>(fn: () => Promise<R>, opts?: { queue?: boolean }) => Promise<R | null>; busy: () => boolean } {
  let tail: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  return {
    busy: () => waiting > 0,
    run<R>(fn: () => Promise<R>, opts: { queue?: boolean } = {}): Promise<R | null> {
      if (waiting > 0 && opts.queue !== true) return Promise.resolve(null);
      waiting += 1;
      const next = tail.then(fn).finally(() => {
        waiting -= 1;
      });
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

/** The lines checked when the card opens (TE15: skips unchecked). */
export function defaultChecked(lines: readonly { key: string; checked: boolean }[]): Set<string> {
  return new Set(lines.filter((l) => l.checked).map((l) => l.key));
}

// RepsSheet (§11.4)

export const REPS_LIMITS = { min: 1, max: 50, minWorkS: 5, maxWorkS: 600, workStepS: 5 } as const;

export type RepsDraft = { kind: 'reps'; exact: boolean; min: number; max: number } | { kind: 'time'; seconds: number };

/** The sheet as it opens: the row's reps (or work time) today. */
export function repsDraftOf(row: Pick<OverviewRow['editRow'], 'reps' | 'durationS' | 'timed'>): RepsDraft {
  if (row.timed || (row.reps === null && row.durationS !== null)) return { kind: 'time', seconds: row.durationS ?? 45 };
  const r = row.reps ?? { min: 8, max: 12 };
  return { kind: 'reps', exact: r.min === r.max, min: r.min, max: r.max };
}

type Step = StepTarget;
const step = (to: number, lo: number, hi: number, label: (n: number) => string): Step => (to < lo || to > hi ? { enabled: false, reason: to < lo ? `Min ${label(lo)}` : `Max ${label(hi)}` } : { enabled: true, value: to, label: label(to) });

/** The sheet's steppers: ±1 rep within 1–50 (`To` never under `From`); ±5 s within 0:05–10:00. */
export function repsSteps(d: RepsDraft): { from?: { down: Step; up: Step }; to?: { down: Step; up: Step }; time?: { down: Step; up: Step } } {
  const n = (x: number) => String(x);
  if (d.kind === 'time') {
    const s = (x: number) => `${String(x)} s`;
    return { time: { down: step(d.seconds - REPS_LIMITS.workStepS, REPS_LIMITS.minWorkS, REPS_LIMITS.maxWorkS, s), up: step(d.seconds + REPS_LIMITS.workStepS, REPS_LIMITS.minWorkS, REPS_LIMITS.maxWorkS, s) } };
  }
  const from = { down: step(d.min - 1, REPS_LIMITS.min, REPS_LIMITS.max, n), up: step(d.min + 1, REPS_LIMITS.min, d.exact ? REPS_LIMITS.max : d.max, n) };
  return d.exact ? { from } : { from, to: { down: step(d.max - 1, d.min, REPS_LIMITS.max, n), up: step(d.max + 1, d.min, REPS_LIMITS.max, n) } };
}

/** A typed or stepped value, kept inside the limits (and `To` ≥ `From`). */
export function repsDraftWith(d: RepsDraft, field: 'from' | 'to' | 'time' | 'exact' | 'range', value = 0): RepsDraft {
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(x) ? x : lo)));
  if (d.kind === 'time') return field === 'time' ? { kind: 'time', seconds: clamp(value, REPS_LIMITS.minWorkS, REPS_LIMITS.maxWorkS) } : d;
  if (field === 'exact') return { ...d, exact: true, max: d.min };
  if (field === 'range') return { ...d, exact: false, max: Math.min(REPS_LIMITS.max, Math.max(d.max, d.min + 2)) };
  if (field === 'from') {
    const min = clamp(value, REPS_LIMITS.min, REPS_LIMITS.max);
    return { ...d, min, max: d.exact ? min : Math.max(min, d.max) };
  }
  if (field === 'to') return { ...d, max: clamp(value, d.min, REPS_LIMITS.max) };
  return d;
}

/** `Done` (§11.4): one `reps` edit, or a clear when the sheet is back at the plan's own. */
export function repsPayload(d: RepsDraft, planned: OverviewRow['editRow']['plannedReps']): { kind: 'clear' } | { kind: 'reps'; reps: { min: number; max: number } | null; durationS: number | null } {
  if (d.kind === 'time') return planned.reps === null && planned.durationS === d.seconds ? { kind: 'clear' } : { kind: 'reps', reps: null, durationS: d.seconds };
  const same = planned.reps !== null && planned.reps.min === d.min && planned.reps.max === d.max;
  return same ? { kind: 'clear' } : { kind: 'reps', reps: { min: d.min, max: d.max }, durationS: null };
}

/** The load the keypad's `Set target` sends, in the row's frame (convention explicit, rule 4). */
export function loadPayload(value: number, keypad: NonNullable<OverviewRow['editRow']['keypad']>): { value: number; unit: 'kg' | 'lb'; convention: NonNullable<OverviewRow['editRow']['keypad']>['convention'] } | null {
  if (!Number.isFinite(value) || value < 0 || value > 2000) return null;
  return { value: Math.round(value * 100) / 100, unit: keypad.unit, convention: keypad.convention };
}

/** A typed load for the toast: `27.5 kg`, `20 kg each`, `−30 kg` (assisted). */
export function typedLoadText(load: { value: number; unit: 'kg' | 'lb'; convention: string }): string {
  const n = `${String(Math.round(load.value * 100) / 100)} ${load.unit}`;
  if (load.convention === 'per_hand') return `${n} each`;
  if (load.convention === 'assistance') return `−${n}`;
  if (load.convention === 'added') return `+${n}`;
  return n;
}

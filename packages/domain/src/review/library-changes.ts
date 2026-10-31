import type { Load, NextSessionTargetRecord, RepRange, ReviewProposal } from '@fizz/schemas';

import { formatNumber, loadText, NBSP, repRangeText } from '../display';
import type { ChangeRowView, ChangeTap, CoachChangesView } from './progress-page';

/**
 * Library › Plan › Changes (redesign 27 Oct, section D2 and D5). One pure view of the coach's changes to come, so the
 * Plan page's `✦ 3 changes · next week ›` row, the Changes screen, the dot on a changed number in a plan day (tap:
 * was / now + Undo) and a saved workout's `✦1` all read the same rows:
 *
 * - **Next time** (the Summary's coach targets, D21): a small change already saved for the workout's next session
 *   (`saved` / `applied`, not used yet, still fitting the workout it came from) with Why? and Undo; a bigger one the
 *   coach only suggested (`proposed`) with Apply / Skip.
 * - **Weekly review** (Progress v3's Coach's changes, moved here): the small set changes made for next week (Undo,
 *   Redo once undone) and every offer (Apply / Skip; answered ones keep their status).
 *
 * Values only: every number is from the stored record (rule 6), never recomputed; nothing here writes. Minimal copy:
 * the row is `Bench press 82.5 → 85 kg` and its day; the reason is behind Why?.
 */

export const LIBRARY_CHANGES_COPY = {
  title: 'Changes',
  /** The Plan page's row: `3 changes · next week`. */
  row: (n: number) => `${String(n)} ${n === 1 ? 'change' : 'changes'} · next week`,
  nextWeek: 'Next week',
  earlier: 'Earlier changes',
  none: 'No changes',
  why: 'Why?',
  undo: 'Undo',
  redo: 'Redo',
  apply: 'Apply',
  skip: 'Skip',
  undone: 'Undone',
  skipped: 'Skipped',
  outOfDate: 'Out of date',
  was: (text: string) => `was ${text}`,
  backTo: (name: string, text: string) => `${name} back to ${text}`,
  nextTime: 'Next time',
} as const;

/** One coach next-session row with the workout it is for (the routine its source workout was started from). */
export interface NextTimeChangeInput {
  row: Pick<NextSessionTargetRecord, 'id' | 'version' | 'exerciseId' | 'exerciseName' | 'target' | 'builtIn' | 'sets' | 'builtInSets' | 'status' | 'reason' | 'guardNotes' | 'usedBySessionId'> & Partial<Pick<NextSessionTargetRecord, 'origin'>>;
  /** The saved workout or plan day the change lands on; null: an ad-hoc workout (it follows the exercise). */
  routineId: string | null;
  /** `Push`, `Upper A`; null with no routine. */
  routineName: string | null;
  /** The source workout was corrected since the row was saved: it no longer applies (`staleNextTargets`). */
  stale: boolean;
}

export type LibraryChangeRef = { kind: 'next'; rowId: string } | { kind: 'weekly'; reviewId: string; proposalId: string };

export type LibraryChangeState = 'made' | 'offer' | 'undone' | 'answered';

export interface LibraryChangeRow {
  key: string;
  ref: LibraryChangeRef;
  routineId: string | null;
  exerciseId: string;
  exerciseName: string;
  /** `Bench press 82.5 → 85 kg`, `Cable lateral raise 3 → 4 sets`. */
  title: string;
  /** `Push`, `Upper A`; null with none to name. */
  sub: string | null;
  /** Behind `Why?`: the coach's reason (quoted), its checks, the built-in rule's value. Empty: no Why?. */
  why: string[];
  state: LibraryChangeState;
  /** `Undone`, `Skipped`, `Out of date`, `Held · pain`; null while made or asked. */
  statusText: string | null;
  /** Its buttons, in order (`changeRowTaps`'s mapping for weekly rows). */
  taps: ChangeTap[];
  /** The changed number on a plan day / saved workout row: `85 kg` with `was 82.5 kg`. Null: not a number change. */
  mark: { now: string; was: string | null } | null;
  /** The toast after its Undo: `Bench press back to 82.5 kg`. */
  undoneText: string;
  accessibilityLabel: string;
}

export interface LibraryChangesView {
  /** Made and asked changes still to come (the row's count). */
  count: number;
  /** `3 changes · next week`; null with none (the row is hidden). */
  rowText: string | null;
  /** Small changes made (Undo), and Ben's undone ones (Redo). */
  tweaks: LibraryChangeRow[];
  /** Asked (Apply / Skip), and answered offers with their status. */
  offers: LibraryChangeRow[];
  /** The weekly review's coach sentence; null when it didn't review. */
  note: string | null;
  /** `Earlier changes ›`: older weekly reviews exist. */
  hasEarlier: boolean;
  /** The weekly review the weekly rows belong to (its taps need it). */
  reviewId: string | null;
}

const LOAD_SHORT: ReadonlySet<Load['convention']> = new Set(['total', 'per_hand', 'stack']);

/** `82.5 → 85 kg`, `22.5 → 24 kg each`, `Assist 30 kg → Assist 25 kg`; `85 kg` when there is nothing to compare. */
export function loadChangeText(was: Load | null, now: Load): string {
  const to = loadText(now, now.convention);
  if (was === null) return to;
  if (was.unit === now.unit && was.convention === now.convention && LOAD_SHORT.has(now.convention)) return `${formatNumber(was.value)} → ${to}`;
  return `${loadText(was, was.convention)} → ${to}`;
}

const sameLoad = (a: Load | null, b: Load | null): boolean => (a === null ? b === null : b !== null && a.value === b.value && a.unit === b.unit && a.convention === b.convention);
const sameReps = (a: RepRange | null, b: RepRange | null): boolean => (a === null ? b === null : b !== null && a.min === b.min && a.max === b.max);
const plain = (t: string): string => t.replaceAll(NBSP, ' ');

/** What a coach next-session target changes against the built-in rule's (load, reps, sets), as words and the mark. */
function nextTimeParts(r: NextTimeChangeInput['row']): { parts: string[]; mark: LibraryChangeRow['mark']; backTo: string | null } {
  const parts: string[] = [];
  let mark: LibraryChangeRow['mark'] = null;
  let backTo: string | null = null;
  const was = r.builtIn;
  const now = r.target;
  if (now.load !== null && !sameLoad(was?.load ?? null, now.load)) {
    parts.push(loadChangeText(was?.load ?? null, now.load));
    const prev = was?.load ?? null;
    mark = { now: loadText(now.load, now.load.convention), was: prev === null ? null : loadText(prev, prev.convention) };
    backTo = prev === null ? null : loadText(prev, prev.convention);
  }
  if (now.reps !== null && was?.reps != null && !sameReps(was.reps, now.reps)) {
    parts.push(`${repRangeText(was.reps)} → ${repRangeText(now.reps)} reps`);
    mark ??= { now: `${repRangeText(now.reps)} reps`, was: `${repRangeText(was.reps)} reps` };
    backTo ??= `${repRangeText(was.reps)} reps`;
  }
  if (r.sets !== null && r.builtInSets !== null && r.builtInSets > 0 && r.sets !== r.builtInSets) {
    parts.push(`${String(r.builtInSets)} → ${String(r.sets)} sets`);
    mark ??= { now: `${String(r.sets)} sets`, was: `${String(r.builtInSets)} sets` };
    backTo ??= `${String(r.builtInSets)} sets`;
  }
  return { parts, mark, backTo };
}

/** Behind Why?: the coach's reason (quoted), the checks' notes, and the built-in rule's value. */
function nextTimeWhy(r: NextTimeChangeInput['row']): string[] {
  const rule = r.builtIn === null ? null : [r.builtIn.load === null ? null : loadText(r.builtIn.load, r.builtIn.load.convention), r.builtIn.reps === null ? null : `${repRangeText(r.builtIn.reps)} reps`].filter((x): x is string => x !== null).join(' · ');
  return [...(r.reason === null ? [] : [`“${r.reason}”`]), ...r.guardNotes.map((n) => n.text), ...(rule === null || rule === '' ? [] : [`Rule: ${rule}`])];
}

/**
 * A coach next-session row as a change, or null when it isn't one to show: the rule's own stall-reset answers
 * (Summary only), a row used by a workout already, one whose workout was corrected since, one Ben declined
 * (`not_applied`), or one that changes nothing against the built-in rule.
 */
export function nextTimeChangeRow(i: NextTimeChangeInput): LibraryChangeRow | null {
  const r = i.row;
  if (r.origin === 'rule' || r.usedBySessionId !== null || i.stale) return null;
  if (r.status === 'not_applied') return null;
  const { parts, mark, backTo } = nextTimeParts(r);
  if (parts.length === 0) return null;
  const title = `${r.exerciseName} ${parts.join(' · ')}`;
  const state: LibraryChangeState = r.status === 'proposed' ? 'offer' : r.status === 'undone' ? 'undone' : 'made';
  const taps: ChangeTap[] = state === 'offer' ? ['apply', 'skip'] : state === 'made' ? ['undo'] : [];
  const statusText = state === 'undone' ? LIBRARY_CHANGES_COPY.undone : null;
  const said = [plain(title), ...(i.routineName === null ? [] : [i.routineName]), ...(statusText === null ? [] : [statusText])].join(', ');
  return {
    key: `next:${r.id}`,
    ref: { kind: 'next', rowId: r.id },
    routineId: i.routineId,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    title,
    sub: i.routineName,
    why: nextTimeWhy(r),
    state,
    statusText,
    taps,
    mark: state === 'made' ? mark : null,
    undoneText: backTo === null ? LIBRARY_CHANGES_COPY.undone : LIBRARY_CHANGES_COPY.backTo(r.exerciseName, backTo),
    accessibilityLabel: said,
  };
}

/** A weekly-review change (Coach's changes, moved here) with the routine and exercise it changes. */
export function weeklyChangeRow(view: Pick<ChangeRowView, 'id' | 'exercise' | 'before' | 'after' | 'why' | 'status' | 'offer' | 'statusText' | 'canApply' | 'canUndo' | 'canRedo'>, p: Pick<ReviewProposal, 'change'>, reviewId: string): LibraryChangeRow {
  const c = p.change;
  const title = `${view.exercise} ${String(c.fromSets)} → ${String(c.toSets)} sets`;
  const taps: ChangeTap[] = view.status === 'open' ? (view.canApply ? ['apply', 'skip'] : []) : [...(view.canUndo ? (['undo'] as const) : []), ...(view.canRedo ? (['redo'] as const) : [])];
  const state: LibraryChangeState = view.status === 'applied' ? 'made' : view.status === 'open' ? 'offer' : view.status === 'undone' ? 'undone' : 'answered';
  const said = [title, c.routineName, ...(view.statusText === null ? [] : [view.statusText])].join(', ');
  return {
    key: `weekly:${view.id}`,
    ref: { kind: 'weekly', reviewId, proposalId: view.id },
    routineId: c.routineId,
    exerciseId: c.exerciseId,
    exerciseName: c.exerciseName,
    title,
    sub: c.routineName,
    why: view.why === null ? [] : [view.why],
    state,
    statusText: view.statusText,
    taps,
    mark: view.status === 'applied' ? { now: view.after, was: view.before } : null,
    undoneText: LIBRARY_CHANGES_COPY.backTo(view.exercise, view.before),
    accessibilityLabel: said,
  };
}

export interface LibraryChangesInput {
  nextTime: readonly NextTimeChangeInput[];
  /** The newest weekly review's changes (`coachChangesView`) and its proposals; null with none. */
  weekly: { view: CoachChangesView; proposals: readonly Pick<ReviewProposal, 'id' | 'change'>[] } | null;
  hasEarlier: boolean;
}

/**
 * The changes to come, one list for the Plan row, the Changes screen and the marks. Weekly rows only while their
 * review is the current week's (`for next week`); an older one's are under `Earlier changes`.
 */
export function libraryChangesView(input: LibraryChangesInput): LibraryChangesView {
  const next = input.nextTime.map(nextTimeChangeRow).filter((x): x is LibraryChangeRow => x !== null);
  const w = input.weekly !== null && input.weekly.view.current ? input.weekly : null;
  const byId = new Map((w?.proposals ?? []).map((p) => [p.id, p]));
  const weekly: LibraryChangeRow[] = [];
  if (w !== null) {
    for (const v of [...w.view.rows, ...w.view.asks]) {
      const p = byId.get(v.id);
      if (p !== undefined) weekly.push(weeklyChangeRow(v, p, w.view.reviewId));
    }
  }
  const all = [...next, ...weekly];
  const tweaks = all.filter((x) => x.state === 'made' || (x.state === 'undone' && x.taps.length > 0));
  const offers = all.filter((x) => !tweaks.includes(x) && (x.state === 'offer' || x.ref.kind === 'weekly'));
  const count = all.filter((x) => x.state === 'made' || (x.state === 'offer' && x.taps.length > 0)).length;
  return {
    count,
    rowText: count === 0 ? null : LIBRARY_CHANGES_COPY.row(count),
    tweaks,
    offers,
    note: w?.view.note ?? null,
    hasEarlier: input.hasEarlier,
    reviewId: w?.view.reviewId ?? null,
  };
}

export interface LibraryChangeMark {
  exerciseId: string;
  /** `85 kg`. */
  now: string;
  /** `82.5 kg`; null when the rule had no value to compare. */
  was: string | null;
  /** `Bench press 85 kg · was 82.5 kg` (the tap's line). */
  text: string;
  row: LibraryChangeRow;
}

/** The dots on one workout's rows: each exercise with a change made for it (the first one wins). */
export function libraryChangeMarks(view: Pick<LibraryChangesView, 'tweaks'>, routineId: string): Map<string, LibraryChangeMark> {
  const out = new Map<string, LibraryChangeMark>();
  for (const r of view.tweaks) {
    if (r.routineId !== routineId || r.mark === null || r.state !== 'made' || out.has(r.exerciseId)) continue;
    out.set(r.exerciseId, { exerciseId: r.exerciseId, now: r.mark.now, was: r.mark.was, text: `${r.exerciseName} ${r.mark.now}${r.mark.was === null ? '' : ` · ${LIBRARY_CHANGES_COPY.was(r.mark.was)}`}`, row: r });
  }
  return out;
}

/** A saved workout's `✦N`: its changes made or asked (0: no marker). */
export function libraryChangeCounts(view: Pick<LibraryChangesView, 'tweaks' | 'offers'>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of [...view.tweaks, ...view.offers]) {
    if (r.routineId === null) continue;
    if (!(r.state === 'made' || (r.state === 'offer' && r.taps.length > 0))) continue;
    out.set(r.routineId, (out.get(r.routineId) ?? 0) + 1);
  }
  return out;
}

/** One workout's `Next time` card: its next-session changes (made and asked), in the list's order. */
export function nextTimeCardRows(view: Pick<LibraryChangesView, 'tweaks' | 'offers'>, routineId: string): LibraryChangeRow[] {
  return [...view.tweaks, ...view.offers].filter((r) => r.routineId === routineId && r.ref.kind === 'next' && (r.state === 'made' || r.state === 'offer'));
}

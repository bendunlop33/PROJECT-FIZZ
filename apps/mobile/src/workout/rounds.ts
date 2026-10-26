/**
 * The active workout v3 round page (workout-table-v3.md §1–§5), pure so it's
 * unit-tested: rounds from the domain's table view, the round strip, the
 * step-named Log, Up next, the per-exercise row boxes (how many rows each
 * shows so the round fits one screen, and where each box sits), the timer
 * bar's SET clock, the Workout overview rows and the `Why?` sheet's lines.
 *
 * Nothing here works out a target, a load or a set type: those come from
 * `buildWorkoutTableView` (domain). This file only groups, numbers and words
 * what the session already holds.
 */
import { setSteps, toMs, type RestView, type TableColumns, type TableRow, type TopSet, type WorkoutTableView } from '@fizz/domain';
import type { SetType } from '@fizz/schemas';

const NBSP = ' ';
const plain = (s: string): string => s.replaceAll(NBSP, ' ');

// ---------------------------------------------------------------------------
// Rounds

export interface RoundRow {
  row: TableRow;
  setId: string;
  /** `1`, `2`… for working sets (warm-ups aren't counted), `W` for a warm-up; then `L` / `R` for a fixed side. */
  label: string;
  /** The working-set number; null for a warm-up. */
  number: number | null;
  /** `Top`, `Back-off`, `Drop` under the number; null for plain working sets and warm-ups. */
  typeLabel: string | null;
  warmup: boolean;
  /** The other side of a single-side log: shares its partner's number, not counted in progress. */
  companion: boolean;
  /** The set Log logs now (the open row). */
  current: boolean;
  done: boolean;
  /** The latest log: its ✓ unticks it (the domain refuses any other; older sets are corrected). */
  canUntick: boolean;
  skipped: boolean;
  /**
   * (Ben, 26 Oct: RIR replaces RPE in the UI) The RIR cell: the logged RIR on a done row, the RIR Ben entered on a
   * set not done yet, else its target (`rirTarget`, shown dimmed); null for warm-ups and none.
   */
  rir: string | null;
  rirTarget: boolean;
  /** `Set 3` or `Warm-up`, for the Log pill and VoiceOver. */
  stepName: string;
  /** "Set 3, 7.5 kilograms each, 12 reps, target 1 rep in reserve, not done". */
  accessibilityLabel: string;
  /**
   * (Ben, 26 Oct: smoother scrolling) Everything the row draws, as one string: a row whose key is unchanged isn't
   * drawn again (`memo`), so a timer tick redraws no set rows and a log only the rows it changed.
   */
  renderKey: string;
}

export interface RoundExercise {
  sessionExerciseId: string;
  exerciseId: string;
  name: string;
  /** `1`, or `3a` / `3b` in a superset. */
  label: string;
  /** (Ben, 26 Oct) The works line only (`Front delts`): the rep range is in the REPS cells, the target in RIR. Null when unknown. */
  subline: string | null;
  /** Working sets only. */
  progress: { done: number; total: number };
  progressText: string;
  loadHeader: string | null;
  valueHeader: TableColumns['valueLabel'];
  rows: RoundRow[];
  /** The open row is one of this exercise's sets. */
  isCurrent: boolean;
  /** In a superset: the member whose set is next (the other is dimmed). */
  upNext: boolean;
  dim: boolean;
  /** The row each box positions on: the open row, else the first set still to do, else the last row. */
  anchor: number;
  painBadge: boolean;
  note: string | null;
  /** (Ben, 26 Oct) The exercise's pinned note at this gym (shown every time it's in a workout); null when none. */
  pinned: PinnedView | null;
  /** `Last 1 Oct: 100 × 8, 8, 7` / `No previous result`. */
  lastLine: string;
  topSet: TopSet | null;
}

export interface Round {
  key: string;
  /** 1-based position among the rounds. */
  n: number;
  superset: boolean;
  exercises: RoundExercise[];
  /** Every live set is done or skipped. */
  done: boolean;
  /** The open row is in this round. */
  current: boolean;
  hasPending: boolean;
  /** The first set still to do in lifting order (a → b → a → b), or null. */
  firstPendingSetId: string | null;
  /** Working sets done / total across the round (warm-ups not counted). */
  doneSets: number;
  totalSets: number;
}

/** (Ben, 26 Oct) A pinned note as the header shows it: Ben's words as typed (rule 8), and whether it's for this gym only. */
export interface PinnedView {
  text: string;
  gymOnly: boolean;
}

const TYPE_LABEL: Record<SetType, string | null> = { warmup: null, working: null, top: 'Top', backoff: 'Back-off', drop: 'Drop' };

/** The RIR cell's text and whether it is the target (dimmed) or Ben's own value (`2`, `1.5`). */
export function rirCellText(row: Pick<TableRow, 'state' | 'rir' | 'setType'>): { text: string; target: boolean } | null {
  if (row.setType === 'warmup' || row.state === 'skipped' || row.rir === null) return null;
  return { text: row.rir.text, target: row.state !== 'done' && row.rir.target };
}

/**
 * Numbers working sets 1..n (warm-ups `W`, not counted; the other side of a
 * single-side log shares its partner's number) with the domain's `setSteps`,
 * the same numbering every toast and sheet uses, plus the set-type label and
 * RPE cell (§2).
 */
export function roundRows(rows: readonly TableRow[], latestLoggedSetId: string | null = null): RoundRow[] {
  const steps = setSteps(rows.map((r) => ({ id: r.setId, setType: r.setType, pairedWithSetId: r.pairedWithSetId })));
  return rows.map((row) => {
    const step = steps.get(row.setId);
    const warmup = row.setType === 'warmup';
    const number = step?.number ?? null;
    const side = row.badges.includes('L') ? 'L' : row.badges.includes('R') ? 'R' : '';
    const stepName = step?.name ?? (warmup ? 'Warm-up' : 'Set');
    const rir = rirCellText(row);
    const status = row.state === 'done' ? 'done' : row.state === 'skipped' ? 'skipped' : row.state === 'open' ? 'current, not done' : 'not done';
    const typeLabel = TYPE_LABEL[row.setType];
    const accessibilityLabel = [stepName, typeLabel, side === 'L' ? 'left side' : side === 'R' ? 'right side' : null, row.spoken === '' ? null : row.spoken, rir === null ? null : (row.rir?.spoken ?? null), status]
      .filter((x): x is string => x !== null)
      .join(', ');
    const label = `${number === null ? 'W' : String(number)}${side}`;
    const canUntick = row.state === 'done' && row.setId === latestLoggedSetId;
    return {
      row,
      setId: row.setId,
      label,
      number,
      typeLabel,
      warmup,
      companion: step?.companion ?? false,
      current: row.state === 'open',
      done: row.state === 'done',
      canUntick,
      skipped: row.state === 'skipped',
      rir: rir?.text ?? null,
      rirTarget: rir?.target ?? false,
      stepName,
      accessibilityLabel,
      renderKey: rowRenderKey(row, { label, typeLabel, canUntick, rir, accessibilityLabel }),
    };
  });
}

/** The row's drawn content (its cells, previous, marks, state, words), so an unchanged row isn't redrawn. */
export function rowRenderKey(row: TableRow, own: { label: string; typeLabel: string | null; canUntick: boolean; rir: { text: string; target: boolean } | null; accessibilityLabel: string }): string {
  return JSON.stringify([
    own.label,
    own.typeLabel,
    own.canUntick,
    own.rir,
    own.accessibilityLabel,
    row.state,
    row.cells,
    row.columns,
    row.last?.text ?? null,
    row.last?.accessibilityLabel ?? null,
    row.todayChange,
    row.pace,
    row.notCounted,
    row.note,
    row.gymCaption,
    row.edited,
    row.partStart,
  ]);
}

/**
 * Working sets done / total: warm-ups and skipped sets aren't counted, and a
 * single-side pair is one set, done once both sides are (review B2).
 */
function progressOf(rows: readonly RoundRow[]): { done: number; total: number } {
  const counted = rows.filter((r) => !r.warmup && !r.skipped && !r.companion);
  const sides = (head: RoundRow) => rows.filter((r) => r.companion && r.row.pairedWithSetId === head.setId && !r.skipped);
  return { done: counted.filter((r) => r.done && sides(r).every((c) => c.done)).length, total: counted.length };
}

function anchorOf(rows: readonly RoundRow[]): number {
  const open = rows.findIndex((r) => r.current);
  if (open >= 0) return open;
  const todo = rows.findIndex((r) => !r.done && !r.skipped);
  return todo >= 0 ? todo : Math.max(0, rows.length - 1);
}

function sublineOf(works: string | null): string | null {
  return works === null || works === '' ? null : works;
}

const MEMBER_LETTERS = 'abcdefghij';

/**
 * One round per table block (§1.3): an exercise, or a superset's members as
 * `3a`, `3b`. `worksLineOf` reads the builder's works line by exercise ID.
 */
export function buildRounds(table: Pick<WorkoutTableView, 'blocks'>, worksLineOf: (exerciseId: string) => string | null, latestLoggedSetId: string | null = null, pinnedOf: (exerciseId: string) => PinnedView | null = () => null): Round[] {
  return table.blocks.map((block, i) => {
    const n = i + 1;
    let exercises: RoundExercise[];
    let order: TableRow[];
    if (block.kind === 'exercise') {
      const c = block.card;
      const rows = roundRows(c.rows, latestLoggedSetId);
      const progress = progressOf(rows);
      exercises = [
        {
          sessionExerciseId: c.sessionExerciseId,
          exerciseId: c.exerciseId,
          name: c.name,
          label: String(n),
          subline: sublineOf(worksLineOf(c.exerciseId)),
          progress,
          progressText: `${String(progress.done)}/${String(progress.total)}`,
          loadHeader: c.loadHeader,
          valueHeader: (c.columns ?? c.rows[0]?.columns ?? { valueLabel: 'REPS' as const }).valueLabel,
          rows,
          isCurrent: c.isCurrent,
          upNext: true,
          dim: false,
          anchor: anchorOf(rows),
          painBadge: c.painBadge,
          note: c.note,
          pinned: pinnedOf(c.exerciseId),
          lastLine: c.lastLine,
          topSet: c.topSet,
        },
      ];
      order = c.rows;
    } else {
      const ss = block.superset;
      order = ss.rounds.flatMap((r) => r.rows);
      const nextTag = order.find((r) => r.state === 'open')?.memberTag ?? order.find((r) => r.state === 'pending')?.memberTag ?? null;
      exercises = ss.members.map((m, k) => {
        const rows = roundRows(m.rows, latestLoggedSetId);
        const progress = progressOf(rows);
        const upNext = nextTag === m.tag;
        return {
          sessionExerciseId: m.sessionExerciseId,
          exerciseId: m.exerciseId,
          name: m.name,
          label: `${String(n)}${MEMBER_LETTERS[k] ?? String(k + 1)}`,
          subline: sublineOf(worksLineOf(m.exerciseId)),
          progress,
          progressText: `${String(progress.done)}/${String(progress.total)}`,
          loadHeader: m.loadHeader,
          valueHeader: m.columns.valueLabel,
          rows,
          isCurrent: m.isCurrent,
          upNext,
          // Nothing left in the round: nothing to dim.
          dim: nextTag !== null && !upNext,
          anchor: anchorOf(rows),
          painBadge: m.painBadge,
          note: m.note,
          pinned: pinnedOf(m.exerciseId),
          lastLine: m.lastLine,
          topSet: m.topSet,
        };
      });
    }
    const totals = exercises.reduce((t, e) => ({ done: t.done + e.progress.done, total: t.total + e.progress.total }), { done: 0, total: 0 });
    const first = order.find((r) => r.state === 'open') ?? order.find((r) => r.state === 'pending');
    return {
      key: block.key,
      n,
      superset: block.kind === 'superset',
      exercises,
      done: order.length > 0 && order.every((r) => r.state === 'done' || r.state === 'skipped'),
      current: order.some((r) => r.state === 'open'),
      hasPending: order.some((r) => r.state === 'pending' || r.state === 'open'),
      firstPendingSetId: first?.setId ?? null,
      doneSets: totals.done,
      totalSets: totals.total,
    };
  });
}

/**
 * The round on screen: the one Ben picked (strip, swipe, overview), else the
 * one with the open row, else the first with sets to do, else the last.
 */
export function shownRoundIndex(rounds: readonly Pick<Round, 'key' | 'current' | 'hasPending'>[], picked: string | null): number {
  if (rounds.length === 0) return 0;
  if (picked !== null) {
    const i = rounds.findIndex((r) => r.key === picked);
    if (i >= 0) return i;
  }
  const cur = rounds.findIndex((r) => r.current);
  if (cur >= 0) return cur;
  const todo = rounds.findIndex((r) => r.hasPending);
  return todo >= 0 ? todo : rounds.length - 1;
}

/**
 * The set to make current when Ben moves to a round (§3: Log logs the shown
 * round's current set): its first set to do, unless the open row is already
 * there or nothing is left. A `set_active_set`, never a log.
 */
export function selectOnShow(round: Pick<Round, 'current' | 'firstPendingSetId'> | undefined): string | null {
  if (round === undefined || round.current) return null;
  return round.firstPendingSetId;
}

/**
 * Round-change selects, one at a time (wo-v3 reviews spec S2, logic S1):
 * while one is in flight a later pick waits (replacing any earlier wait), and
 * is sent when the first lands, with the version it left. A pick with nothing
 * to select (a done round) cancels the wait. So swipes 2 → 3 → 4 end on 4.
 */
export interface SelectQueue {
  inFlight: string | null;
  queued: string | null;
}

export const SELECT_IDLE: SelectQueue = { inFlight: null, queued: null };

export function queueSelect(q: SelectQueue, setId: string | null): { q: SelectQueue; send: string | null } {
  if (q.inFlight === null) return setId === null ? { q, send: null } : { q: { inFlight: setId, queued: null }, send: setId };
  return { q: { inFlight: q.inFlight, queued: setId === q.inFlight ? null : setId }, send: null };
}

/** The select in flight landed (or was refused: `ok` false drops the wait; the pill then offers `Go to …`). */
export function selectLanded(q: SelectQueue, ok: boolean): { q: SelectQueue; send: string | null } {
  if (!ok || q.queued === null) return { q: SELECT_IDLE, send: null };
  return { q: { inFlight: q.queued, queued: null }, send: q.queued };
}

/**
 * Whether a change of the open row brings the page back to its round
 * (auto-advance, §3): yes on a log, untick, delete or relaunch; no when a
 * round change's own select made it (it would bounce Ben back mid-swipe).
 */
export function resetsPick(activeSetId: string | null, roundSelects: ReadonlySet<string>): boolean {
  return activeSetId === null || !roundSelects.has(activeSetId);
}

/**
 * The Log pill on a round that has sets to do but isn't current yet (a
 * select in flight or refused, or a work timer running on another round):
 * it never says Log, since tapping it doesn't log (logic S2). `Go to Set 1`
 * / `Go to 3a · Set 1` selects; with a work timer running, `Back to round 2`.
 */
export function offRoundPill(round: Round, o: { timerRound: number | null }): { kind: 'select'; label: string } | { kind: 'back'; label: string; index: number } {
  if (o.timerRound !== null) return { kind: 'back', label: `Back to round ${String(o.timerRound + 1)}`, index: o.timerRound };
  for (const ex of round.exercises) {
    const row = ex.rows.find((r) => r.setId === round.firstPendingSetId);
    if (row !== undefined) return { kind: 'select', label: `Go to ${round.superset ? `${ex.label} · ` : ''}${row.stepName}` };
  }
  return { kind: 'select', label: `Go to round ${String(round.n)}` };
}

/** The round whose set has a work timer running or paused (it stays current until stopped), else null. */
export function timerRoundIndex(rounds: readonly Pick<Round, 'exercises'>[], wi: { setId: string; status: string } | null): number | null {
  if (wi === null || (wi.status !== 'running' && wi.status !== 'paused')) return null;
  const i = rounds.findIndex((r) => r.exercises.some((e) => e.rows.some((x) => x.setId === wi.setId)));
  return i >= 0 ? i : null;
}

/** A swipe (left: next, right: previous) or a VoiceOver action, kept within the rounds. */
export function stepRound(index: number, direction: 'next' | 'prev', count: number): number | null {
  const to = index + (direction === 'next' ? 1 : -1);
  return to < 0 || to >= count ? null : to;
}

// ---------------------------------------------------------------------------
// Round strip (§1.2)

export interface StripChip {
  key: string;
  index: number;
  /** `✓ 1`, `3a·b`, `4`. */
  text: string;
  done: boolean;
  shown: boolean;
  /** "Round 3, superset, 2 of 3 sets done". */
  accessibilityLabel: string;
}

export function roundStrip(rounds: readonly Round[], shown: number): StripChip[] {
  return rounds.map((r, i) => {
    const letters = r.superset ? MEMBER_LETTERS.slice(0, r.exercises.length).split('').join('·') : '';
    const text = `${r.done ? '✓ ' : ''}${String(r.n)}${letters}`;
    const a11y = [`Round ${String(r.n)}`, r.superset ? 'superset' : r.exercises[0]?.name ?? null, `${String(r.doneSets)} of ${String(r.totalSets)} ${r.totalSets === 1 ? 'set' : 'sets'} done`, i === shown ? 'showing' : null]
      .filter((x): x is string => x !== null)
      .join(', ');
    return { key: r.key, index: i, text, done: r.done, shown: i === shown, accessibilityLabel: a11y };
  });
}

/** `Up next: 4 Lateral raise` / `4 Rear-delt fly + Cable crunch`: the next round after the shown one with sets to do. */
export function upNextText(rounds: readonly Round[], shown: number): string | null {
  const next = rounds.slice(shown + 1).find((r) => r.hasPending);
  if (next === undefined) return null;
  return `${String(next.n)} ${next.exercises.map((e) => e.name).join(' + ')}`;
}

// ---------------------------------------------------------------------------
// The Log pill (§1.6)

export type RoundPrimary =
  /** The step: `3a · Set 3 · Log 7.5 kg each × 12`, from the active view's own label. */
  | { kind: 'step'; label: string }
  /** The shown round is done: go to the next round with sets to do. */
  | { kind: 'next_round'; label: 'Next round'; index: number }
  /** Whatever the active view says (Finish, Resume, Add exercise…). */
  | { kind: 'view' };

/**
 * The Log pill on the round page. `primary` is the active view's primary
 * (exactly what `log_set` saves); it gets the step in front when it names a
 * set (Log, Start, Enter). While the open row isn't on the shown round yet
 * (a select in flight) the view's own label shows.
 */
export function roundPrimary(p: { rounds: readonly Round[]; shown: number; primary: { kind: string; label: string } }): RoundPrimary {
  const round = p.rounds[p.shown];
  if (round === undefined) return { kind: 'view' };
  if (!round.hasPending) {
    const after = p.rounds.findIndex((r, i) => i > p.shown && r.hasPending);
    const any = after >= 0 ? after : p.rounds.findIndex((r) => r.hasPending);
    return any >= 0 ? { kind: 'next_round', label: 'Next round', index: any } : { kind: 'view' };
  }
  const named = p.primary.kind === 'log' || p.primary.kind === 'start_work' || p.primary.kind === 'enter';
  if (!named) return { kind: 'view' };
  for (const ex of round.exercises) {
    const row = ex.rows.find((r) => r.current);
    if (row !== undefined) return { kind: 'step', label: stepLabel({ member: round.superset ? ex.label : null, stepName: row.stepName, primary: p.primary.label }) };
  }
  return { kind: 'view' };
}

/** `3a · Set 3 · Log 7.5 kg each × 12`; `Set 2 · Log 100 kg × 6`; `Warm-up · Log 20 kg × 10`. */
export function stepLabel(p: { member: string | null; stepName: string; primary: string }): string {
  return [p.member, p.stepName, p.primary].filter((x): x is string => x !== null).join(' · ');
}

// ---------------------------------------------------------------------------
// One scroll per round page (Ben, 26 Oct: "the scrolling could be improved, at the moment it's a bit clunky
// when you have extra sets"). Replaces the per-exercise row boxes of 20 Oct: the whole round is one scroll
// view (natural momentum and bounce, nothing nested to fight), and it moves on its own only to bring a row
// into view, gently, when that row is off-screen.

/** Room kept above a row brought into view (about one compact row: the set just done stays visible). */
export const REVEAL_CONTEXT = 44;
/** And below it, so it never sits flush on the timer bar or the keypad bar. */
export const REVEAL_MARGIN = 8;

/**
 * The scroll offset that brings a row into view with the least movement, or `offset` unchanged when it is
 * already fully in view (no jump when logging a set that stays on screen). `context` keeps that much of what's
 * above the row in view too (the set just logged) when it's brought down into view.
 */
export function revealOffset(p: { offset: number; viewHeight: number; rowTop: number; rowHeight: number; context?: number; margin?: number }): number {
  const context = Math.min(p.context ?? 0, Math.max(0, p.rowTop));
  const margin = p.margin ?? 0;
  const top = p.rowTop - context;
  const bottom = p.rowTop + p.rowHeight + margin;
  if (p.viewHeight <= 0) return p.offset;
  if (p.rowTop >= p.offset && p.rowTop + p.rowHeight <= p.offset + p.viewHeight) return p.offset;
  if (p.rowTop < p.offset) return Math.max(0, top);
  // Below the fold: just enough to show it, but never so far that its own top goes off.
  return Math.max(0, Math.min(bottom - p.viewHeight, p.rowTop - context));
}

/** The row the page brings into view on a log, untick or round change: the open row, else the round's first set to do. */
export function revealSetId(round: Pick<Round, 'exercises' | 'firstPendingSetId'> | undefined): string | null {
  if (round === undefined) return null;
  for (const e of round.exercises) {
    const open = e.rows.find((r) => r.current);
    if (open !== undefined) return open.setId;
  }
  return round.firstPendingSetId;
}

/** The offset that keeps a row (the cell being typed in) in view: the smallest move, none when it's already in view. */
export function keepInView(offset: number, viewHeight: number, rowTop: number, rowHeight: number): number {
  if (rowTop < offset) return Math.max(0, rowTop);
  if (rowTop + rowHeight > offset + viewHeight) return Math.max(0, rowTop + rowHeight - viewHeight);
  return offset;
}

/**
 * When the page brings the current set into view (the current set changes on a log, an untick or a round
 * change; never while typing): the round, the open row and how many sets are done.
 */
export function positionKey(round: Pick<Round, 'key' | 'exercises'> | undefined, activeSetId: string | null): string {
  if (round === undefined) return '';
  const done = round.exercises.reduce((t, e) => t + e.rows.filter((r) => r.done).length, 0);
  return `${round.key}|${activeSetId ?? '-'}|${String(done)}`;
}

// ---------------------------------------------------------------------------
// Timer bar (§1.5)

/** REST while a rest runs or is paused; otherwise the SET clock. */
export function timerBarMode(rest: Pick<RestView, 'kind'> | null): 'rest' | 'set' {
  return rest !== null && (rest.kind === 'running' || rest.kind === 'paused') ? 'rest' : 'set';
}

/**
 * The round page's bottom chrome (Ben, 23 Oct: with the number pad up only
 * about 2 rows showed). While the pad is up the SET clock and the action bar
 * (Log, coach, mic) step aside so the table gets the room; the cell's − / +,
 * Next › and Done bar stays on the pad. A running rest keeps its slim bar
 * (its countdown and Skip still matter). Done or the pad closing brings them
 * back. Focus view keeps its own layout.
 */
export function bottomChrome(p: { tableMode: boolean; keypadUp: boolean; rest: Pick<RestView, 'kind'> | null }): { timer: 'rest' | 'rest_slim' | 'set' | null; actionBar: boolean } {
  if (!p.tableMode) return { timer: null, actionBar: true };
  const mode = timerBarMode(p.rest);
  if (!p.keypadUp) return { timer: mode, actionBar: true };
  return { timer: mode === 'rest' ? 'rest_slim' : null, actionBar: false };
}

/**
 * Where the SET clock counts up from: when the last rest ended, or the last
 * log if that came later (a superset's a → b has no rest), else the start.
 */
export function setClockStartMs(p: { rest: RestView | null; lastLogMs: number | null; startedAtMs: number }): number {
  const restEnd = p.rest?.kind === 'ended' && p.rest.endedAtUtc !== null ? toMs(p.rest.endedAtUtc) : null;
  const candidates = [restEnd, p.lastLogMs].filter((x): x is number => x !== null);
  return candidates.length === 0 ? p.startedAtMs : Math.max(...candidates);
}

/**
 * The SET clock's time (§1.5): from `setClockStartMs` to now, less any pause
 * since then (spec S7), so it freezes while paused and doesn't jump on
 * Resume. `pausedMs` is the paused time inside that window (`pausedMsWithin`).
 */
export function setClockMs(p: { startMs: number; nowMs: number; pausedMs: number }): number {
  return Math.max(0, p.nowMs - p.startMs - p.pausedMs);
}

/** The latest log time among the sets (`completedAt`), or null. */
export function lastLogMs(sets: readonly { status: string; completedAt: { utc: string } | null }[]): number | null {
  let last: number | null = null;
  for (const s of sets) {
    if (s.status !== 'completed' || s.completedAt === null) continue;
    const t = toMs(s.completedAt.utc);
    if (last === null || t > last) last = t;
  }
  return last;
}

/** `0:25`, `12:04`, `1:02:09`: the SET clock (never negative). */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

// ---------------------------------------------------------------------------
// Header (§5)

/** `+12 min` after the elapsed time while the session runs over Ben's finish time; null otherwise. Shown, never applied. */
export function overTimeText(overByMinutes: number | null | undefined): string | null {
  return overByMinutes === null || overByMinutes === undefined || overByMinutes <= 0 ? null : `+${String(overByMinutes)}${NBSP}min`;
}

// ---------------------------------------------------------------------------
// Workout overview sheet (§4)

export interface OverviewRowView {
  key: string;
  roundIndex: number;
  label: string;
  name: string;
  works: string | null;
  /** `2/3` working sets. */
  sets: string;
  /** `100`, `45 lb` (the column says kg), `—`. */
  top: string;
  done: boolean;
  current: boolean;
  accessibilityLabel: string;
}

function topText(t: TopSet | null): string {
  if (t === null) return '—';
  const v = Number.isInteger(t.value) ? String(t.value) : String(Math.round(t.value * 100) / 100);
  return t.unit === 'kg' ? v : `${v}${NBSP}lb`;
}

export function overviewRows(rounds: readonly Round[], shown: number, worksLineOf: (exerciseId: string) => string | null): OverviewRowView[] {
  return rounds.flatMap((r, i) =>
    r.exercises.map((e) => {
      const done = e.progress.total > 0 && e.progress.done >= e.progress.total;
      const top = topText(e.topSet);
      return {
        key: e.sessionExerciseId,
        roundIndex: i,
        label: e.label,
        name: e.name,
        works: worksLineOf(e.exerciseId),
        sets: e.progressText,
        top,
        done,
        current: i === shown,
        accessibilityLabel: [`${e.label}, ${e.name}`, `${String(e.progress.done)} of ${String(e.progress.total)} sets done`, top === '—' ? null : `top set ${plain(top)}${top.includes('lb') ? '' : ' kilograms'}`, done ? 'done' : null].filter((x): x is string => x !== null).join(', '),
      };
    }),
  );
}

/** `Upper body · about 55 min`: the time so far plus the estimate left, to 5 minutes; just the title without an estimate. */
export function overviewTitle(title: string, elapsedMs: number, minutesLeft: number | null): string {
  if (minutesLeft === null) return title;
  const total = Math.max(5, Math.round((elapsedMs / 60_000 + minutesLeft) / 5) * 5);
  return `${title} · about ${String(total)}${NBSP}min`;
}

// ---------------------------------------------------------------------------
// `Why?` sheet (§2)

export interface WhyView {
  /** The set the reason and the rest belong to. */
  setId: string;
  /** `7.5 kg each × 8–12 · RIR 1`. */
  target: string;
  /** `Rest 1:30` / `1:30 after the round`. */
  rest: string;
  /** The set whose rest `Change` edits (in a superset, the last member's: rest comes after the round). */
  restSetId: string;
  restSeconds: number;
  /** `16 Oct · 7.5 × 12, 12, 12`, or null with no history. */
  last: string | null;
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

function loadWords(cell: string | null, header: string | null): string | null {
  if (cell === null || cell === '—') return null;
  const c = plain(cell);
  if (/[a-z]/i.test(c) || header === null) return c;
  if (header.startsWith('ASSIST ')) return `${c} ${header.slice(7).toLowerCase()} assist`;
  if (header.startsWith('+')) return `+${c} ${header.slice(1).toLowerCase()}`;
  return `${c} ${header.toLowerCase()}`;
}

/** `Last 1 Oct: 100 × 8, 8, 7` → `1 Oct · 100 × 8, 8, 7`; null for `No previous result`. */
export function lastTimeText(lastLine: string): string | null {
  const m = /^Last (.+?): (.*)$/.exec(plain(lastLine));
  return m === null ? null : `${m[1] ?? ''} · ${m[2] ?? ''}`;
}

export function whyView(round: Round, exerciseIndex: number): WhyView | null {
  const ex = round.exercises[exerciseIndex];
  const row = ex?.rows[ex.anchor];
  if (ex === undefined || row === undefined) return null;
  const load = loadWords(row.row.cells.load, ex.loadHeader);
  const value = plain(row.row.cells.value);
  const rir = row.rir === null || row.done ? null : row.rir;
  const target = `${load === null ? '' : `${load} × `}${value}${rir === null ? '' : ` · RIR ${rir}`}`;
  const last = round.exercises.at(-1);
  const restRow = round.superset && last !== undefined ? (last.rows[last.anchor] ?? row) : row;
  const seconds = restRow.row.restAfterS;
  return {
    setId: row.setId,
    target,
    rest: round.superset ? `${mmss(seconds)} after the round` : `Rest ${mmss(seconds)}`,
    restSetId: restRow.setId,
    restSeconds: seconds,
    last: lastTimeText(ex.lastLine),
  };
}

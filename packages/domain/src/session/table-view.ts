import type { EquipmentInstance, Load, Measurement, SessionAggregate, SessionExercise, SetValues, WorkoutSet } from '@fizz/schemas';
import { paceText } from '../cardio';
import { cardioValuesText, dayMonthText, EQUIPMENT_WORD, formatDistance, formatDuration, formatNumber, NBSP, repRangeText, rowLoadCell, rowValueCell, targetText } from '../display';
import { painFlagCovering } from '../pain-flags';
import { massWords } from '../progress/text';
import { targetRpeOf } from '../coach/target-rpe';
import { buildSetRows, type ActiveViewInput, type PrimaryAction, type PreviousSession, type SetRowView } from './active-view';
import { carriesTodayAdjustment } from './coach-undo';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets, isEmptyPart, partRootOf, partsOf } from './gym-switch';
import { isRoundEnd, nextPendingSet, setUnits } from './order';

/**
 * `buildWorkoutTableView` (active-workout §2A.12): the Table view of the
 * workout in progress, the default workout screen. Pure. It takes the same
 * input as `buildActiveSetView` and reuses its rows (`buildSetRows`), its
 * text helpers and the stored targets, so the two views can't disagree. It
 * never computes a target or a load: every number is a stored target or an
 * actual result, formatted.
 *
 * The open row's steppers, draft, target line and Log values come from
 * `buildActiveSetView(...).focus` (one source for both views, WT41); this
 * view only says which row is open (`anchor`) and how every other row reads.
 */

export type TableRowState = 'done' | 'pending' | 'open' | 'skipped';

export interface TableColumns {
  kind: 'load_reps' | 'reps' | 'load_time' | 'time' | 'load_distance' | 'distance' | 'cardio';
  /** `KG`, `LB`, `ASSIST KG`, `+KG`; null when the exercise has no load column (bodyweight, cardio). */
  loadLabel: string | null;
  /** `TIME · DIST`: a cardio set's one value cell holds both (`20:00 · 4,800 m`). */
  valueLabel: 'REPS' | 'TIME' | 'DIST' | 'TIME · DIST';
}

export interface TableRow extends SetRowView {
  state: TableRowState;
  /** This row's own columns (its exercise, part and equipment): whether it has a load cell, and which value. */
  columns: TableColumns;
  /**
   * Numbers only when the block has one shared column header (the unit is in
   * the label). When the block's rows disagree (a mixed superset, or parts in
   * kg and lb), there's no shared header and each cell carries its unit:
   * `25 lb each`, `+10 kg`, `12 reps`, `0:45`. A range only ever appears on a target.
   */
  cells: { load: string | null; value: string };
  /** `RPE 8` / `RIR 2` on a done row (actual, no `@`); the target `@ 8.5` on a pending or open row; null otherwise. */
  effort: string | null;
  /** A done cardio row's pace (`2:05 /500 m`, `5:12 /km`); null otherwise. */
  pace: string | null;
  /** A pending target changed today: the word tag `Coach` or `Rule` (never `C`). */
  todayChange: 'coach' | 'rule' | null;
  /** `A1` in a superset, null otherwise. */
  memberTag: string | null;
  /** AX1+ block rows: line 1 (`Set 1 · done`, `Set 3`, `Set 2 · NOW`) and line 2 (the value). */
  blockTitle: string;
  blockValue: string;
  /** VoiceOver: "Set 1, done, 100 kilograms, 8 reps, RPE 8" / "Set 3, target 100 kilograms, 6 to 8 reps". */
  accessibilityLabel: string;
}

export interface FoldedLine {
  name: string;
  /** Actual results in session order (`100 × 8, 8, 7`), or null when skipped. */
  summary: string | null;
  skipped: boolean;
  accessibilityLabel: string;
}

export interface TableCard {
  /** The block's key: its first (root) session exercise. */
  key: string;
  /** The row actions act on: the part with pending sets, else the last part. */
  sessionExerciseId: string;
  exerciseId: string;
  name: string;
  /** `Barbell`, `Dumbbells · kg each`, `Cable / stack · kg stack · per side`. */
  headerLine: string;
  /** `Last 1 Oct: 100 × 8, 8, 7` (actual; imported history reads the same, 18 Oct) or `No previous result`. */
  lastLine: string;
  /** Header line 2: `Barbell · Last 1 Oct: 100 × 8, 8, 7`. */
  subtitle: string;
  note: string | null;
  progress: { done: number; total: number };
  /** `1/3`. */
  progressText: string;
  /** "1 of 3 sets done". */
  progressAccessibility: string;
  painBadge: boolean;
  /** The shared column header; null when the rows disagree (then each cell carries its unit). */
  columns: TableColumns | null;
  rows: TableRow[];
  isCurrent: boolean;
  hasPending: boolean;
  unilateral: boolean;
}

export interface SupersetMember {
  tag: string;
  sessionExerciseId: string;
  exerciseId: string;
  name: string;
  /** `kg stack`, `kg each`, `bodyweight`. */
  unitCaption: string;
  painBadge: boolean;
  /** This member's own columns. */
  columns: TableColumns;
  /** Ben's note on this member today, or null. */
  note: string | null;
  /** The open row is one of this member's sets. */
  isCurrent: boolean;
}

export interface SupersetCard {
  key: string;
  /** `Superset A`. */
  label: string;
  round: { n: number; of: number };
  /** `Round 2 of 3`. */
  roundText: string;
  members: SupersetMember[];
  /** The shared column header when every member agrees; null otherwise (each cell carries its unit). */
  columns: TableColumns | null;
  /**
   * The member the group's `⋯` and `Adjust` act on: the one with the open
   * row, else the one whose set is next in lifting order, else the first.
   */
  menuTarget: string;
  /** Rows grouped by round, in lifting order (A1, A2 in each round). */
  rounds: { n: number; rows: TableRow[] }[];
  progress: { done: number; total: number };
  progressText: string;
  isCurrent: boolean;
  hasPending: boolean;
}

export type TableBlock =
  | { kind: 'exercise'; key: string; folded: FoldedLine | null; card: TableCard }
  | { kind: 'superset'; key: string; folded: FoldedLine | null; superset: SupersetCard };

export interface WorkoutTableView {
  /** `↑ N done`: sets logged in this workout, warm-ups included; skipped and deleted aren't counted. */
  doneCount: number;
  /** The open row (the active set) and the block it's in; null when nothing is open. */
  anchor: { blockKey: string; sessionExerciseId: string; setId: string } | null;
  blocks: TableBlock[];
  /** Not empty and nothing pending: `All planned sets done.` */
  allDone: boolean;
  empty: boolean;
  /**
   * What the Log pill adds around the active view's primary label: `Set 2` or
   * `A1` before it, `→ A2` after it (a superset member logged with no rest),
   * and the exercise name for when the open row is off-screen.
   */
  log: { prefix: string; suffix: string | null; exerciseName: string } | null;
}

const live = (s: WorkoutSet): boolean => s.status !== 'deleted';
const TIMES = `${NBSP}×${NBSP}`;

function equipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | null {
  return equipmentOfRow(state.session.equipmentSnapshot, ex);
}

/** The Table's columns for an exercise (§2A.3): unit once, in the label. */
export function tableColumns(ex: Pick<SessionExercise, 'measurement' | 'loadConvention' | 'unit'>, eq: Pick<EquipmentInstance, 'kind'> | null): TableColumns {
  if (ex.measurement === 'cardio') return { kind: 'cardio', loadLabel: null, valueLabel: 'TIME · DIST' };
  const unit = ex.unit.toUpperCase();
  const loadLabel =
    ex.loadConvention === 'bodyweight'
      ? null
      : ex.loadConvention === 'assistance'
        ? `ASSIST ${unit}`
        : ex.loadConvention === 'added' && eq?.kind !== 'plate_loaded_machine'
          ? `+${unit}`
          : unit;
  const valueLabel = ex.measurement === 'duration' ? 'TIME' : ex.measurement === 'distance' ? 'DIST' : 'REPS';
  const kind: TableColumns['kind'] =
    ex.measurement === 'duration' ? (loadLabel === null ? 'time' : 'load_time') : ex.measurement === 'distance' ? (loadLabel === null ? 'distance' : 'load_distance') : loadLabel === null ? 'reps' : 'load_reps';
  return { kind, loadLabel, valueLabel };
}

function valueCellTarget(set: WorkoutSet, m: Measurement): string {
  const p = set.planned;
  if (m === 'cardio') return cardioValuesText(p);
  if (m === 'duration') return p.durationS === null ? '—' : formatDuration(p.durationS);
  if (m === 'distance') return p.distanceM === undefined || p.distanceM === null ? '—' : formatDistance(p.distanceM);
  return p.reps === null ? '—' : repRangeText(p.reps);
}

function secondsWords(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  const parts = [m > 0 ? `${String(m)} ${m === 1 ? 'minute' : 'minutes'}` : null, sec > 0 || m === 0 ? `${String(sec)} ${sec === 1 ? 'second' : 'seconds'}` : null];
  return parts.filter((p): p is string => p !== null).join(' ');
}

/** VoiceOver words for a set's values (actual or target): "100 kilograms, 8 reps", "6 to 8 reps", "45 seconds". */
function spokenValues(load: Load | null, reps: string | null, durationS: number | null, distanceM: number | null | undefined, ex: SessionExercise, eq: EquipmentInstance | null): string {
  const parts: string[] = [];
  if (ex.loadConvention !== 'bodyweight' && load !== null) parts.push(massWords(load, eq?.kind ?? null));
  else if (ex.loadConvention === 'bodyweight' && ex.measurement === 'reps') parts.push('body weight');
  if (ex.measurement === 'cardio') {
    if (durationS !== null) parts.push(secondsWords(durationS));
    if (distanceM !== null && distanceM !== undefined) parts.push(`${formatNumber(distanceM)} metres`);
  } else if (ex.measurement === 'duration' && durationS !== null) parts.push(secondsWords(durationS));
  else if (ex.measurement === 'distance' && distanceM !== null && distanceM !== undefined) parts.push(`${formatNumber(distanceM)} metres`);
  else if (ex.measurement === 'reps' && reps !== null) parts.push(`${reps.replace('–', ' to ')} reps`);
  return parts.join(', ');
}

const SET_TYPE_SPOKEN: Record<WorkoutSet['setType'], string | null> = { warmup: 'warm-up', working: null, top: 'top set', backoff: 'back-off', drop: 'drop set' };

interface BuiltRow {
  row: TableRow;
  /** The same cells with their units, for a block whose rows disagree on columns. */
  unitCells: TableRow['cells'];
}

function rowOf(state: SessionAggregate, base: SetRowView, activeSetId: string | null, ruleRpe: number | null, memberTag: string | null, memberName: string | null): BuiltRow {
  const built = rowCore(state, base, activeSetId, ruleRpe, memberTag, memberName);
  const set = state.sets.find((s) => s.id === base.setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return { row: built, unitCells: built.cells };
  const source = set.status === 'completed' && set.actual ? set.actual.load : set.planned.load;
  const unitCells = {
    load: built.cells.load === null ? null : withUnit(built.cells.load, source, ex, equipmentOf(state, ex)),
    value: ex.measurement === 'reps' && built.cells.value !== '—' && built.cells.value !== 'Skipped' ? `${built.cells.value}${NBSP}reps` : built.cells.value,
  };
  return { row: built, unitCells };
}

/**
 * A load cell with its unit (`25 lb each`, `+10 kg`, `20 kg assist`); `BW` and `—` stay as they are.
 * A plate-loaded machine's `added` load is a plain load, as in `tableColumns` and `loadCell` (review r2 S3).
 */
function withUnit(cell: string, load: Load | null, ex: Pick<SessionExercise, 'loadConvention' | 'unit'>, eq: Pick<EquipmentInstance, 'kind'> | null): string {
  if (cell === 'BW' || cell === '—') return cell;
  const unit = load?.unit ?? ex.unit;
  const convention = load?.convention ?? ex.loadConvention;
  switch (convention) {
    case 'added':
      return eq?.kind === 'plate_loaded_machine' ? `${cell}${NBSP}${unit}` : `+${cell}${NBSP}${unit}`;
    case 'assistance':
      return `${cell}${NBSP}${unit} assist`;
    case 'per_hand':
      return `${cell}${NBSP}${unit} each`;
    case 'stack':
      return `${cell}${NBSP}${unit} stack`;
    case 'total':
    case 'bodyweight':
      return `${cell}${NBSP}${unit}`;
  }
}

const sameColumns = (a: TableColumns, b: TableColumns): boolean => a.kind === b.kind && a.loadLabel === b.loadLabel && a.valueLabel === b.valueLabel;

/** One shared header when every row (and the block's own columns) agree; else null, and every cell carries its unit. */
function sharedColumns(own: readonly TableColumns[], built: readonly BuiltRow[]): { columns: TableColumns | null; rows: TableRow[] } {
  const all = [...own, ...built.map((b) => b.row.columns)];
  const first = all[0];
  const shared = first !== undefined && all.every((c) => sameColumns(c, first)) ? first : null;
  return { columns: shared, rows: built.map((b) => (shared === null ? { ...b.row, cells: b.unitCells } : b.row)) };
}

function rowCore(state: SessionAggregate, base: SetRowView, activeSetId: string | null, ruleRpe: number | null, memberTag: string | null, memberName: string | null): TableRow {
  const set = state.sets.find((s) => s.id === base.setId);
  const ex = set ? state.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) {
    return { ...base, state: 'skipped', columns: { kind: 'reps', loadLabel: null, valueLabel: 'REPS' }, cells: { load: null, value: '—' }, effort: null, pace: null, todayChange: null, memberTag, blockTitle: `Set ${String(base.number)}`, blockValue: '—', accessibilityLabel: `Set ${String(base.number)}` };
  }
  const eq = equipmentOf(state, ex);
  const columns = tableColumns(ex, eq);
  const label = memberTag ?? `Set ${String(base.number)}`;
  const who = [memberTag !== null && memberName !== null ? `${memberTag}, ${memberName}, set ${String(base.number)}` : label, SET_TYPE_SPOKEN[set.setType], set.side === 'left' ? 'left side' : set.side === 'right' ? 'right side' : null]
    .filter((p): p is string => p !== null)
    .join(', ');

  if (set.status === 'completed' && set.actual) {
    const a = set.actual;
    const effort = a.rpe !== null ? `RPE${NBSP}${formatNumber(a.rpe)}` : a.rir !== null ? `RIR${NBSP}${String(a.rir)}` : null;
    const spoken = spokenValues(a.load, a.reps === null ? null : String(a.reps), a.durationS, a.distanceM, ex, eq);
    const extra = [effort === null ? null : effort.replace(NBSP, ' '), base.edited ? 'edited' : null, base.gymCaption !== null ? `at ${base.gymCaption}` : null].filter((p): p is string => p !== null);
    return {
      ...base,
      state: 'done',
      columns,
      cells: { load: rowLoadCell(a.load, ex.loadConvention, eq), value: rowValueCell(a, ex.measurement) },
      effort,
      pace: ex.measurement === 'cardio' ? paceText(a, ex.exerciseId) : null,
      todayChange: null,
      memberTag,
      blockTitle: `${label} · done`,
      blockValue: base.text.replace(/\s{3}/, ' · '),
      accessibilityLabel: `${[who, 'done', spoken, ...extra].filter((p) => p !== '').join(', ')}${base.exclusionAccessibility ? `. ${base.exclusionAccessibility}` : ''}`,
    };
  }
  if (set.status === 'skipped') {
    return { ...base, state: 'skipped', columns, cells: { load: null, value: 'Skipped' }, effort: null, pace: null, todayChange: null, memberTag, blockTitle: label, blockValue: 'Skipped', accessibilityLabel: `${who}, skipped` };
  }
  const open = set.id === activeSetId;
  const today = carriesTodayAdjustment(set.planned) ? (set.planned.source === 'built_in_rule' ? 'rule' : 'coach') : null;
  const rpe = targetRpeOf(set, ruleRpe)?.rpe ?? null;
  const p = set.planned;
  const spokenTarget = spokenValues(p.load, p.reps === null ? null : repRangeText(p.reps), p.durationS, p.distanceM, ex, eq);
  const targetWord = today === 'coach' ? 'coach target' : today === 'rule' ? 'adjusted target' : 'target';
  const before = today !== null && p.coach ? p.coach.before : null;
  const planWas = before === null ? null : spokenValues(before.load, before.reps === null ? null : repRangeText(before.reps), before.durationS, before.distanceM, ex, eq);
  const rpeWords = rpe === null ? null : `RPE ${formatNumber(rpe)}`;
  const target = targetText(p, { convention: ex.loadConvention, equipment: eq, perSide: ex.laterality === 'unilateral', rpe, measurement: ex.measurement });
  return {
    ...base,
    state: open ? 'open' : 'pending',
    columns,
    cells: { load: rowLoadCell(p.load, ex.loadConvention, eq), value: valueCellTarget(set, ex.measurement) },
    // The target RPE is a cell too (18 Oct: set · KG · REPS · RPE · ✓).
    effort: rpe === null ? null : `@${NBSP}${formatNumber(rpe)}`,
    pace: null,
    todayChange: today,
    memberTag,
    blockTitle: open ? `${label} · NOW` : label,
    blockValue: target ?? 'No target',
    accessibilityLabel: open
      ? `${who}, current`
      : `${[who, spokenTarget === '' ? 'no target' : `${targetWord} ${spokenTarget}`, rpeWords].filter((x): x is string => x !== null).join(', ')}${planWas !== null && planWas !== '' ? `. Plan was ${planWas}` : ''}`,
  };
}

/** `100 × 8, 8, 7`; `100 × 8, 105 × 6`; `0:45, 0:40`; `40 × 20 m, 20 m`; `12, 10, 9` (actual results, session order). */
export function resultsSummary(values: readonly SetValues[], ex: Pick<SessionExercise, 'measurement' | 'loadConvention' | 'laterality'>, eq: Pick<EquipmentInstance, 'kind'> | null): string {
  const groups: { load: string | null; values: string[] }[] = [];
  for (const v of values) {
    const load = rowLoadCell(v.load, ex.loadConvention, eq);
    const value = rowValueCell(v, ex.measurement);
    const last = groups.at(-1);
    if (last?.load === load) last.values.push(value);
    else groups.push({ load, values: [value] });
  }
  const body = groups.map((g) => (g.load === null ? g.values.join(', ') : `${g.load}${TIMES}${g.values.join(', ')}`)).join(', ');
  return ex.laterality === 'unilateral' && body !== '' ? `${body} per side` : body;
}

/** The sets the folded line and `Last` summarise: working sets when there are any, else all (a warm-up-only exercise). */
function summarised<T extends { setType: WorkoutSet['setType'] }>(sets: readonly T[]): T[] {
  const working = sets.filter((s) => s.setType !== 'warmup');
  return working.length > 0 ? working : [...sets];
}

function unitWords(ex: Pick<SessionExercise, 'loadConvention' | 'unit'>): string | null {
  switch (ex.loadConvention) {
    case 'per_hand':
      return `${ex.unit} each`;
    case 'stack':
      return `${ex.unit} stack`;
    case 'assistance':
      return `${ex.unit} assist`;
    case 'total':
    case 'added':
    case 'bodyweight':
      return null;
  }
}

function headerLineOf(ex: SessionExercise, eq: EquipmentInstance | null): string {
  const kind = eq ? EQUIPMENT_WORD[eq.kind] : ex.measurement === 'cardio' ? 'Cardio' : ex.loadConvention === 'bodyweight' ? 'Bodyweight' : null;
  return [kind, unitWords(ex), ex.laterality === 'unilateral' ? 'per side' : null].filter((p): p is string => p !== null).join(' · ');
}

function lastLineOf(prev: PreviousSession | null, ex: SessionExercise, eq: EquipmentInstance | null, tz: string): string {
  if (prev === null || prev.sets.length === 0) return 'No previous result';
  const values = prev.sets.map((s) => s.values);
  const when = dayMonthText(prev.performedAtUtc, tz);
  return `Last ${when}: ${resultsSummary(values, ex, eq)}`;
}

function painBadgeOf(input: ActiveViewInput, ex: SessionExercise): boolean {
  if (input.painFlagged.has(ex.exerciseId)) return true;
  return painFlagCovering(input.painFlags ?? [], ex.exerciseId, input.nowMs, input.aggregate.session.startedAt.tz) !== null;
}

/** The row an exercise block's actions use: the part with pending sets, else its last part. */
function actionRowOf(state: SessionAggregate, parts: readonly SessionExercise[]): SessionExercise | undefined {
  return parts.find((p) => state.sets.some((s) => s.sessionExerciseId === p.id && s.status === 'pending')) ?? parts.at(-1);
}

function foldedOf(name: string, blockLive: readonly WorkoutSet[], summary: string): FoldedLine | null {
  if (blockLive.length === 0 || blockLive.some((s) => s.status === 'pending')) return null;
  const done = blockLive.filter((s) => s.status === 'completed');
  if (done.length === 0) return { name, summary: null, skipped: true, accessibilityLabel: `${name}, skipped. Expands.` };
  return { name, summary, skipped: false, accessibilityLabel: `${name}, done, ${summary.replaceAll(NBSP, ' ').replaceAll(' × ', ' for ')}. Expands.` };
}

function progressOf(blockLive: readonly WorkoutSet[]): { done: number; total: number } {
  const counted = blockLive.filter((s) => s.status !== 'skipped');
  return { done: counted.filter((s) => s.status === 'completed').length, total: counted.length };
}

function exerciseCard(input: ActiveViewInput, root: SessionExercise, parts: readonly SessionExercise[], activeSetId: string | null): { card: TableCard; folded: FoldedLine | null } {
  const state = input.aggregate;
  const action = actionRowOf(state, parts) ?? root;
  const eq = equipmentOf(state, action);
  const blockLive = blockSets(state, root.id).filter(live);
  const ruleRpe = input.ruleTargetRpe?.[action.id] ?? input.ruleTargetRpe?.[root.id] ?? null;
  const ownColumns = tableColumns(action, eq);
  const { columns, rows } = sharedColumns([ownColumns], buildSetRows(input, root.id, activeSetId).map((r) => rowOf(state, r, activeSetId, ruleRpe, null, null)));
  const prev = input.previous[action.id] ?? input.previous[root.id] ?? null;
  const headerLine = headerLineOf(action, eq);
  const lastLine = lastLineOf(prev, action, eq, state.session.startedAt.tz);
  const progress = progressOf(blockLive);
  const doneValues = summarised(blockLive.filter((s) => s.status === 'completed' && s.actual !== null)).map((s) => s.actual as SetValues);
  const summary = resultsSummary(doneValues, action, eq);
  return {
    card: {
      key: root.id,
      sessionExerciseId: action.id,
      exerciseId: action.exerciseId,
      name: action.exerciseName,
      headerLine,
      lastLine,
      subtitle: [headerLine, lastLine].filter((p) => p !== '').join(' · '),
      note: action.note ?? root.note ?? null,
      progress,
      progressText: `${String(progress.done)}/${String(progress.total)}`,
      progressAccessibility: `${String(progress.done)} of ${String(progress.total)} sets done`,
      painBadge: painBadgeOf(input, action),
      columns,
      rows,
      isCurrent: activeSetId !== null && blockLive.some((s) => s.id === activeSetId),
      hasPending: blockLive.some((s) => s.status === 'pending'),
      unilateral: action.laterality === 'unilateral',
    },
    folded: foldedOf(action.exerciseName, blockLive, summary),
  };
}

function supersetCard(input: ActiveViewInput, group: string, memberRoots: readonly SessionExercise[], activeSetId: string | null): { superset: SupersetCard; folded: FoldedLine | null } {
  const state = input.aggregate;
  const members: SupersetMember[] = [];
  const unitsByMember: { tag: string; name: string; units: WorkoutSet[][] }[] = [];
  const built: BuiltRow[] = [];
  const activeRow = activeSetId === null ? undefined : state.sets.find((s) => s.id === activeSetId);
  memberRoots.forEach((root, i) => {
    const parts = partsOf(state.exercises, root.id).filter((p) => p.removed === undefined);
    const action = actionRowOf(state, parts) ?? root;
    const tag = `${group}${String(i + 1)}`;
    const isCurrent = activeRow !== undefined && parts.some((p) => p.id === activeRow.sessionExerciseId);
    members.push({
      tag,
      // The member's actions act on the open row's part when it's current.
      sessionExerciseId: isCurrent ? activeRow.sessionExerciseId : action.id,
      exerciseId: action.exerciseId,
      name: action.exerciseName,
      unitCaption: unitWords(action) ?? (action.loadConvention === 'bodyweight' ? 'bodyweight' : action.unit),
      painBadge: painBadgeOf(input, action),
      columns: tableColumns(action, equipmentOf(state, action)),
      note: action.note ?? root.note ?? null,
      isCurrent,
    });
    const ruleRpe = input.ruleTargetRpe?.[action.id] ?? null;
    for (const r of buildSetRows(input, root.id, activeSetId)) built.push(rowOf(state, r, activeSetId, ruleRpe, tag, action.exerciseName));
    unitsByMember.push({ tag, name: action.exerciseName, units: parts.flatMap((p) => setUnits(state.sets, p.id)) });
  });
  const { columns, rows: allRows } = sharedColumns(
    members.map((m) => m.columns),
    built,
  );
  const rowsById = new Map(allRows.map((r) => [r.setId, r]));
  const of = Math.max(0, ...unitsByMember.map((m) => m.units.length));
  const rounds: SupersetCard['rounds'] = [];
  for (let r = 0; r < of; r += 1) {
    const rows: TableRow[] = [];
    for (const m of unitsByMember) for (const s of m.units[r] ?? []) {
      const row = rowsById.get(s.id);
      if (row) rows.push(row);
    }
    if (rows.length > 0) rounds.push({ n: r + 1, rows });
  }
  const activeRound = rounds.find((r) => r.rows.some((x) => x.setId === activeSetId));
  const firstPending = rounds.find((r) => r.rows.some((x) => x.state === 'pending' || x.state === 'open'));
  const n = activeRound?.n ?? firstPending?.n ?? of;
  // The group's `⋯` acts on the open member, else the member whose set comes next in lifting order (review B3).
  const nextTag = rounds.flatMap((r) => r.rows).find((x) => x.state === 'open' || x.state === 'pending')?.memberTag ?? null;
  const menuTarget = members.find((m) => m.isCurrent) ?? members.find((m) => m.tag === nextTag) ?? members[0];
  const blockLive = memberRoots.flatMap((m) => blockSets(state, m.id)).filter(live);
  const progress = progressOf(blockLive);
  const first = memberRoots[0];
  const label = `Superset ${group}`;
  const summary = unitsByMember
    .map((m, i) => {
      const root = memberRoots[i];
      if (!root) return '';
      const done = summarised(m.units.flat().filter((s) => s.status === 'completed' && s.actual !== null)).map((s) => s.actual as SetValues);
      return done.length === 0 ? '' : `${m.tag} ${resultsSummary(done, root, equipmentOf(state, root))}`;
    })
    .filter((x) => x !== '')
    .join(' · ');
  return {
    superset: {
      key: first?.id ?? group,
      label,
      round: { n, of },
      roundText: `Round ${String(n)} of ${String(of)}`,
      members,
      columns,
      menuTarget: menuTarget?.sessionExerciseId ?? first?.id ?? '',
      rounds,
      progress,
      progressText: `${String(progress.done)}/${String(progress.total)}`,
      isCurrent: activeSetId !== null && blockLive.some((s) => s.id === activeSetId),
      hasPending: blockLive.some((s) => s.status === 'pending'),
    },
    folded: foldedOf(label, blockLive, summary),
  };
}

export function buildWorkoutTableView(input: ActiveViewInput): WorkoutTableView {
  const state = input.aggregate;
  const session = state.session;
  const liveSets = state.sets.filter(live);
  const activeSet = session.status === 'active' && session.activeSetId !== null ? state.sets.find((s) => s.id === session.activeSetId && s.status === 'pending') : undefined;
  const activeSetId = activeSet?.id ?? null;

  // Blocks in session order: a split exercise (gym parts) is one block at its first part; a superset sits where its first member is.
  const shown = [...state.exercises].sort((a, b) => a.order - b.order).filter((e) => e.removed === undefined && !isEmptyPart(state, e));
  const blocks: TableBlock[] = [];
  const seenRoots = new Set<string>();
  const seenGroups = new Set<string>();
  for (const e of shown) {
    const rootId = partRootOf(state.exercises, e.id);
    if (seenRoots.has(rootId)) continue;
    const root = state.exercises.find((x) => x.id === rootId) ?? e;
    if (root.supersetGroup !== null) {
      const group = root.supersetGroup;
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
      const memberRoots = shown.filter((x) => x.supersetGroup === group && partRootOf(state.exercises, x.id) === x.id);
      for (const m of memberRoots) seenRoots.add(m.id);
      if (memberRoots.length > 1) {
        const { superset, folded } = supersetCard(input, group, memberRoots, activeSetId);
        blocks.push({ kind: 'superset', key: superset.key, folded, superset });
        continue;
      }
    }
    seenRoots.add(rootId);
    const parts = shown.filter((x) => partRootOf(state.exercises, x.id) === rootId);
    const { card, folded } = exerciseCard(input, root, parts, activeSetId);
    blocks.push({ kind: 'exercise', key: card.key, folded, card });
  }

  let anchor: WorkoutTableView['anchor'] = null;
  let log: WorkoutTableView['log'] = null;
  if (activeSet) {
    const block = blocks.find((b) => (b.kind === 'exercise' ? b.card.rows.some((r) => r.setId === activeSet.id) : b.superset.rounds.some((r) => r.rows.some((x) => x.setId === activeSet.id))));
    if (block) {
      anchor = { blockKey: block.key, sessionExerciseId: activeSet.sessionExerciseId, setId: activeSet.id };
      const ex = state.exercises.find((x) => x.id === activeSet.sessionExerciseId);
      if (block.kind === 'exercise') {
        const row = block.card.rows.find((r) => r.setId === activeSet.id);
        log = { prefix: `Set ${String(row?.number ?? 1)}`, suffix: null, exerciseName: block.card.name };
      } else {
        const rows = block.superset.rounds.flatMap((r) => r.rows);
        const row = rows.find((r) => r.setId === activeSet.id);
        // Logging A1 goes to A2 with no rest (§2.6): `A1 · Log 25 kg × 14 → A2`.
        const nextId = isRoundEnd(activeSet, state.exercises, state.sets) ? null : nextPendingSet(activeSet.id, state.exercises, state.sets);
        const nextTag = nextId === null ? null : (rows.find((r) => r.setId === nextId)?.memberTag ?? null);
        log = { prefix: row?.memberTag ?? `Set ${String(row?.number ?? 1)}`, suffix: nextTag === null || nextTag === row?.memberTag ? null : `→ ${nextTag}`, exerciseName: ex?.exerciseName ?? block.superset.label };
      }
    }
  }

  const empty = liveSets.length === 0;
  return {
    doneCount: liveSets.filter((s) => s.status === 'completed').length,
    anchor,
    blocks,
    allDone: !empty && !liveSets.some((s) => s.status === 'pending'),
    empty,
    log,
  };
}

/**
 * The Log pill's text in Table (§2A.11): the active view's primary label
 * (exactly what `log_set` saves) with the set before it, `→ A2` after a
 * superset member, and the exercise first while the open row is off-screen
 * (`lead`, which the pill may truncate; the values never are).
 */
export function tableLogLabel(primary: PrimaryAction, log: WorkoutTableView['log'], o: { offscreen: boolean }): { lead: string | null; label: string } {
  const named = primary.kind === 'log' || primary.kind === 'start_work';
  if (!named || log === null) return { lead: null, label: primary.label };
  const label = `${log.prefix} · ${primary.label}${log.suffix !== null && primary.kind === 'log' ? ` ${log.suffix}` : ''}`;
  return { lead: o.offscreen ? log.exerciseName : null, label };
}

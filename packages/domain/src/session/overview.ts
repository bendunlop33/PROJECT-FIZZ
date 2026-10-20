import type {
  EquipmentInstance,
  Exercise,
  NextSessionTargetRecord,
  Load,
  LoadConvention,
  PainFlag,
  RepRange,
  SessionAggregate,
  SessionExercise,
  SetExclusion,
  SetType,
  WeightUnit,
  WorkoutSet,
  ZonedTimestamp,
} from '@fizz/schemas';
import { clockText } from '../calendar';
import { cardioValuesText, dayMonthText, formatDuration, formatNumber, NBSP, repRangeText } from '../display';
import { buildPlateSetup, isBarLoaded, loadDirection } from '../equipment';
import { isSetCountable } from '../exclusions';
import { painFlagCovering, PAIN_AREA_WORD } from '../pain-flags';
import { deriveId, stableStringify } from '../stable';
import { nextTargetFitsSource } from '../coach/next-session';
import { buildStepCard } from '../step-card';
import { toMs } from '../time';
import { convertMass, toScaled } from '../units';
import type { WriteFence } from '../ports';
import type { SetFit } from './create';
import { estimateRemainingDuration, type ResolvedPace } from './duration';
import { muscleWords } from './first-run';
import { droppedWords } from './fit-words';
import { fitMinutesOf, overByMinutes, type FitStatus } from './fit-time';
import { editCountOf, slotMoves, type FitLine, type FitOutcome, type TodayPlanOutput, type TodaySlot } from './today-edits';
import type { ShapeBefore } from './today-shape';
import { TODAY_EDIT_LIMITS } from '@fizz/schemas';
import { roundToAvailableLoad } from '../equipment';
import { loadText } from '../display';
import { isInHistory } from './deletion';
import { comparableSetsOf } from '../progression';

/**
 * The Workout overview (workout-overview.md): the one page before the first
 * set. Pure. Every number on the page comes from here, built from the same
 * dry run Start uses (`planRoutineStart` / `startWorkoutFromSession` with
 * `preview: true`), so what the page shows is what Start creates (OV3). The
 * screen only formats dates and lays it out; it computes no target, marker,
 * grouping or duration (CLAUDE.md conventions).
 *
 * - Change markers (§4): one word per row against the last comparable
 *   session (same equipment kind, bar and load convention; an imported
 *   FitNotes workout matches on convention alone, B7), kg/lb normalised.
 * - `previewKey` (§7): a stable hash of every input that can change a
 *   target, so a Start against a page that went out of date creates nothing.
 * - Actual sets (`LAST`, `BEST`) are what Ben did, never an estimate (rule 6);
 *   estimates (`TIME`, `DONE BY`) always carry `≈` in the screen.
 */

/** Set types that count as working sets on this page (everything but warm-ups). */
const isWorking = (t: SetType): boolean => t !== 'warmup';
const live = (s: WorkoutSet): boolean => s.status !== 'deleted';

// ---------------------------------------------------------------------------
// Comparable history

/** What a comparison needs to know about a piece of equipment: its kind, and for a bar, its mass. */
export interface EquipmentKey {
  kind: EquipmentInstance['kind'];
  /** Barbells only: a different bar makes totals incomparable. */
  barMass: { value: number; unit: WeightUnit } | null;
}

export function equipmentKey(eq: EquipmentInstance | null | undefined): EquipmentKey | null {
  if (!eq) return null;
  return { kind: eq.kind, barMass: eq.kind === 'barbell' ? { value: eq.barMass, unit: eq.unit } : null };
}

/** Same kind (and, for barbells, the same bar mass); no equipment matches only no equipment. */
export function sameEquipmentKind(a: EquipmentKey | null, b: EquipmentKey | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.barMass === null || b.barMass === null) return a.barMass === b.barMass;
  return toScaled(convertMass(a.barMass, 'kg').value) === toScaled(convertMass(b.barMass, 'kg').value);
}

export interface PastTarget {
  setType: SetType;
  load: Load | null;
  reps: RepRange | null;
  durationS: number | null;
}

export interface PastActual {
  setType: SetType;
  load: Load | null;
  reps: number | null;
  durationS: number | null;
  exclusions?: readonly SetExclusion[];
}

/** One exercise as it was in one finished workout. */
export interface PastExercise {
  sessionId: string;
  performedAt: ZonedTimestamp;
  imported: boolean;
  equipment: EquipmentKey | null;
  convention: LoadConvention;
  unit: WeightUnit;
  /** Working sets that had a target, in order (deleted rows and other-side companions left out). */
  targets: PastTarget[];
  /** Completed working sets, in order (a left/right pair counts once). */
  actuals: PastActual[];
}

const hasTarget = (s: WorkoutSet): boolean => s.planned.load !== null || s.planned.reps !== null || s.planned.durationS !== null;

/**
 * Every appearance of `exerciseId` in finished workouts, newest first. One
 * entry per workout exercise row, so an exercise done on two machines in one
 * workout gives two entries.
 */
export function pastExercisesOf(sessions: readonly SessionAggregate[], exerciseId: string): PastExercise[] {
  const out: PastExercise[] = [];
  for (const a of sessions) {
    if (!isInHistory(a.session)) continue;
    for (const ex of [...a.exercises].sort((x, y) => y.order - x.order)) {
      if (ex.exerciseId !== exerciseId) continue;
      const own = a.sets.filter((s) => s.sessionExerciseId === ex.id && live(s) && s.pairedWithSetId === null && isWorking(s.setType)).sort((x, y) => x.index - y.index);
      const eq = ex.equipmentId === null ? null : (a.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
      out.push({
        sessionId: a.session.id,
        performedAt: a.session.startedAt,
        imported: a.session.source === 'import',
        equipment: equipmentKey(eq),
        convention: ex.loadConvention,
        unit: ex.unit,
        targets: own.filter(hasTarget).map((s) => ({ setType: s.setType, load: s.planned.load, reps: s.planned.reps, durationS: s.planned.durationS })),
        // B7: an imported workout's lighter ramp sets read as warm-ups (`comparableSetsOf`).
        actuals: comparableSetsOf({
          imported: a.session.source === 'import',
          sets: own.flatMap((s) =>
            s.status === 'completed' && s.actual !== null
              ? [{ setType: s.setType, load: s.actual.load, reps: s.actual.reps, durationS: s.actual.durationS, ...(s.exclusions && s.exclusions.length > 0 ? { exclusions: s.exclusions } : {}) }]
              : [],
          ),
        }),
      });
    }
  }
  return out.sort((x, y) => toMs(y.performedAt.utc) - toMs(x.performedAt.utc));
}

export interface PlannedKey {
  /**
   * Today's equipment. `any`: the routine's equipment isn't at this gym, so
   * there's none to match; last time still counts (the row reads `NO LOAD`).
   */
  equipment: EquipmentKey | null | 'any';
  convention: LoadConvention;
}

/**
 * Comparable (§4): same equipment kind and bar, same load convention, and
 * something was planned or done. An imported FitNotes workout has no
 * equipment recorded, so it matches on convention alone (B7, ADR 0016).
 */
export function isComparable(planned: PlannedKey, past: PastExercise): boolean {
  const kindOk = planned.equipment === 'any' || past.imported || sameEquipmentKind(planned.equipment, past.equipment);
  return past.convention === planned.convention && kindOk && (past.targets.length > 0 || past.actuals.length > 0);
}

/** The newest comparable appearance, or null. `pasts`: newest first. */
export function lastComparable(planned: PlannedKey, pasts: readonly PastExercise[]): PastExercise | null {
  return pasts.find((p) => isComparable(planned, p)) ?? null;
}

// ---------------------------------------------------------------------------
// Change markers (§4)

/** This preview's first working set and the working set count. */
export interface PlannedFirst {
  load: Load | null;
  reps: RepRange | null;
  durationS: number | null;
  workingSets: number;
  convention: LoadConvention;
}

export type ChangeMarkerKind = 'held' | 'new' | 'no_load' | 'up' | 'down' | 'reps_up' | 'reps_down' | 'sets_up' | 'sets_down' | 'same' | 'swapped' | 'skipped' | 'added' | 'edited' | 'trimmed';

export type ChangeDelta =
  /** `from` is last time's load in today's unit (converted when it was in another unit). */
  | { kind: 'load'; from: Load; to: Load; harder: boolean }
  | { kind: 'reps'; by: number }
  | { kind: 'sets'; by: number };

export interface ChangeMarker {
  kind: ChangeMarkerKind;
  /** The size of the difference against last time (the panel's `CHANGE`), when there is one. Also given for `HELD`. */
  delta: ChangeDelta | null;
  /** When the compared workout was done; null for `NEW`. */
  basis: ZonedTimestamp | null;
}

/** Last time's load to compare with: its first working target's, else its heaviest counted working set (a workout with no targets). */
function referenceLoad(past: PastExercise): Load | null {
  const first = past.targets[0];
  if (first?.load) return first.load;
  const loads = past.actuals.filter((s) => isSetCountable(s, 'comparison')).map((s) => s.load).filter((l): l is Load => l !== null && l.convention !== 'bodyweight');
  const top = loads[0];
  if (top === undefined) return null;
  const harder = loadDirection(top.convention) === 'resistance' ? 1 : -1;
  return loads.reduce((best, l) => (harder * (convertMass(l, 'kg').value - convertMass(best, 'kg').value) > 0 ? l : best), top);
}

/** Loads differ after normalising units. Same unit: exact. Another unit: within 1% counts as the same (a converted load is never exact). */
function compareLoads(planned: Load, ref: Load): number {
  if (planned.unit === ref.unit) return Math.sign(toScaled(planned.value) - toScaled(ref.value));
  const a = convertMass(planned, 'kg').value;
  const b = convertMass(ref, 'kg').value;
  return Math.abs(a - b) <= 0.01 * Math.max(a, b) ? 0 : Math.sign(a - b);
}

/** The comparison alone, before pain, `NEW` and `NO LOAD` (rows 4–7 of §4). */
export function compareWithPast(planned: PlannedFirst, past: PastExercise): { kind: Extract<ChangeMarkerKind, 'up' | 'down' | 'reps_up' | 'reps_down' | 'sets_up' | 'sets_down' | 'same'>; delta: ChangeDelta | null } {
  const ref = referenceLoad(past);
  if (planned.load !== null && planned.load.convention !== 'bodyweight' && ref !== null) {
    const cmp = compareLoads(planned.load, ref);
    if (cmp !== 0) {
      const from = ref.unit === planned.load.unit ? ref : { value: Math.round(convertMass(ref, planned.load.unit).value * 100) / 100, unit: planned.load.unit, convention: ref.convention };
      const harder = loadDirection(planned.convention) === 'resistance' ? cmp > 0 : cmp < 0;
      return { kind: harder ? 'up' : 'down', delta: { kind: 'load', from, to: planned.load, harder } };
    }
  }
  // Reps and sets are compared only with last time's own targets (a workout with none compares load only).
  const first = past.targets[0];
  if (first === undefined) return { kind: 'same', delta: null };
  if (planned.reps !== null && first.reps !== null && planned.reps.min !== first.reps.min) {
    const by = planned.reps.min - first.reps.min;
    return { kind: by > 0 ? 'reps_up' : 'reps_down', delta: { kind: 'reps', by } };
  }
  if (planned.workingSets !== past.targets.length) {
    const by = planned.workingSets - past.targets.length;
    return { kind: by > 0 ? 'sets_up' : 'sets_down', delta: { kind: 'sets', by } };
  }
  return { kind: 'same', delta: null };
}

/**
 * `targetChangeMarker` (§4): the first rule that matches.
 * 1 `HELD` an active pain flag covers the exercise; 2 `NEW` no comparable
 * session; 3 `NO LOAD` the first working set's load was dropped here;
 * 4 `UP`/`DOWN` the working load differs (assisted: less assistance is up;
 * a cap or rounding that lands lower is down); 5 `REPS` the rep target's
 * lower bound differs; 6 `SETS` the working set count differs; 7 `SAME`.
 */
export function targetChangeMarker(planned: PlannedFirst, comparable: PastExercise | null, painFlag: Pick<PainFlag, 'id'> | null, fit: SetFit | null): ChangeMarker {
  const compared = comparable === null ? null : compareWithPast(planned, comparable);
  const basis = comparable?.performedAt ?? null;
  if (painFlag !== null) return { kind: 'held', delta: compared?.delta ?? null, basis };
  if (comparable === null || compared === null) return { kind: 'new', delta: null, basis: null };
  if (fit?.kind === 'dropped') return { kind: 'no_load', delta: null, basis };
  return { kind: compared.kind, delta: compared.delta, basis };
}

export interface MarkerWords {
  /** Shown in tracked caps: `Up`, `Reps`, `No load`. */
  word: string;
  glyph: 'up' | 'down' | 'warning' | 'swap' | 'skip' | 'add' | 'edit' | 'clock' | null;
  /** `warning`: `status.warning` with its icon (HELD, NO LOAD). Never `status.done`, `status.danger` or the accent. */
  tone: 'warning' | 'secondary';
}

export function markerWords(kind: ChangeMarkerKind): MarkerWords {
  switch (kind) {
    case 'held':
      return { word: 'Held', glyph: 'warning', tone: 'warning' };
    case 'new':
      return { word: 'New', glyph: null, tone: 'secondary' };
    case 'no_load':
      return { word: 'No load', glyph: 'warning', tone: 'warning' };
    case 'up':
      return { word: 'Up', glyph: 'up', tone: 'secondary' };
    case 'down':
      return { word: 'Down', glyph: 'down', tone: 'secondary' };
    case 'reps_up':
      return { word: 'Reps', glyph: 'up', tone: 'secondary' };
    case 'reps_down':
      return { word: 'Reps', glyph: 'down', tone: 'secondary' };
    case 'sets_up':
      return { word: 'Sets', glyph: 'up', tone: 'secondary' };
    case 'sets_down':
      return { word: 'Sets', glyph: 'down', tone: 'secondary' };
    case 'same':
      return { word: 'Same', glyph: null, tone: 'secondary' };
    case 'swapped':
      return { word: 'Swapped', glyph: 'swap', tone: 'secondary' };
    case 'skipped':
      return { word: 'Skipped', glyph: 'skip', tone: 'secondary' };
    case 'added':
      return { word: 'Added', glyph: 'add', tone: 'secondary' };
    case 'edited':
      return { word: 'Edited', glyph: 'edit', tone: 'secondary' };
    case 'trimmed':
      return { word: 'Trimmed', glyph: 'clock', tone: 'secondary' };
  }
}

const spokenUnit = (u: WeightUnit, n: number): string => (u === 'kg' ? (n === 1 ? 'kilogram' : 'kilograms') : n === 1 ? 'pound' : 'pounds');
const SPOKEN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

function spokenDate(at: ZonedTimestamp): string {
  const [day, month] = dayMonthText(at.utc, at.tz).split(NBSP);
  const idx = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month ?? '');
  return `${day ?? ''} ${SPOKEN_MONTHS[idx] ?? month ?? ''}`.trim();
}

/** The panel's `CHANGE` value: `↑ 2.5 kg · vs 1 Oct`, `↓ 2 kg each · vs 1 Oct`, `↑ 1 rep`, `↓ 1 set`. Null when nothing differs. */
export function changeText(m: ChangeMarker): string | null {
  const d = m.delta;
  if (d === null) return null;
  const vs = m.basis === null ? '' : ` · vs ${dayMonthText(m.basis.utc, m.basis.tz)}`;
  if (d.kind === 'load') {
    const amount = Math.round(Math.abs(d.to.value - d.from.value) * 100) / 100;
    const tail = d.to.convention === 'per_hand' ? `${NBSP}each` : d.to.convention === 'assistance' ? ` ${d.harder ? 'less' : 'more'} assistance` : '';
    return `${d.harder ? '↑' : '↓'} ${formatNumber(amount)}${NBSP}${d.to.unit}${tail}${vs}`;
  }
  const n = Math.abs(d.by);
  const word = d.kind === 'reps' ? (n === 1 ? 'rep' : 'reps') : n === 1 ? 'set' : 'sets';
  return `${d.by > 0 ? '↑' : '↓'} ${String(n)} ${word}${vs}`;
}

/** VoiceOver: `load up 2.5 kilograms from 1 October`, `held, pain flag`, `new`. */
export function markerSpoken(m: ChangeMarker): string {
  switch (m.kind) {
    case 'held':
      return 'held, pain flag';
    case 'new':
      return 'new';
    case 'no_load':
      return 'no load target here';
    case 'same':
      return 'same as last time';
    case 'swapped':
      return 'swapped today';
    case 'skipped':
      return 'skipped today';
    case 'added':
      return 'added today';
    case 'edited':
      return 'edited today';
    case 'trimmed':
      return 'trimmed to fit';
    case 'up':
    case 'down':
    case 'reps_up':
    case 'reps_down':
    case 'sets_up':
    case 'sets_down':
      break;
  }
  const from = m.basis === null ? '' : ` from ${spokenDate(m.basis)}`;
  const d = m.delta;
  if (d?.kind === 'load') {
    const amount = Math.round(Math.abs(d.to.value - d.from.value) * 100) / 100;
    const each = d.to.convention === 'per_hand' ? ' each' : '';
    const assist = d.to.convention === 'assistance' ? (d.harder ? ' less assistance' : ' more assistance') : '';
    return `load ${d.harder ? 'up' : 'down'} ${formatNumber(amount)} ${spokenUnit(d.to.unit, amount)}${each}${assist}${from}`;
  }
  if (d?.kind === 'reps' || d?.kind === 'sets') {
    const n = Math.abs(d.by);
    const what = d.kind === 'reps' ? (n === 1 ? 'rep' : 'reps') : n === 1 ? 'set' : 'sets';
    return `${d.by > 0 ? 'up' : 'down'} ${String(n)} ${what}${from}`;
  }
  return markerWords(m.kind).word.toLowerCase();
}

// ---------------------------------------------------------------------------
// Load cell

export interface LoadCell {
  /** `100`, `32`, `−20`, `+10`, `BW`, `—`. */
  value: string;
  /** `kg`, `kg each`, `lb`; null for `BW` and `—`. */
  unit: string | null;
  /** VoiceOver: `target 100 kilograms`, `20 kilograms of assistance`. */
  spoken: string;
  /** `—`: no load target. */
  none: boolean;
}

/** The TARGET column (§3.7): `100 kg` · `32 kg each` · `25 kg` (stack) · `−20 kg` (assisted) · `BW` / `+10 kg`. */
export function loadCell(load: Load | null, convention: LoadConvention, equipmentKind: EquipmentInstance['kind'] | null, dropped: boolean): LoadCell {
  if (!dropped && (convention === 'bodyweight' || load?.convention === 'bodyweight' || (load === null && convention === 'added' && equipmentKind !== 'plate_loaded_machine'))) {
    return { value: 'BW', unit: null, spoken: 'target bodyweight', none: false };
  }
  if (load === null) return { value: '—', unit: null, spoken: 'no load target', none: true };
  const n = formatNumber(load.value);
  const u = spokenUnit(load.unit, load.value);
  switch (load.convention) {
    case 'total':
    case 'stack':
      return { value: n, unit: load.unit, spoken: `target ${n} ${u}`, none: false };
    case 'per_hand':
      return { value: n, unit: `${load.unit} each`, spoken: `target ${n} ${u} each`, none: false };
    case 'assistance':
      return { value: `−${n}`, unit: load.unit, spoken: `target ${n} ${u} of assistance`, none: false };
    case 'added':
      if (equipmentKind === 'plate_loaded_machine') return { value: n, unit: `${load.unit} plates`, spoken: `target ${n} ${u} of plates`, none: false };
      return load.value === 0 ? { value: 'BW', unit: null, spoken: 'target bodyweight', none: false } : { value: `+${n}`, unit: load.unit, spoken: `target bodyweight plus ${n} ${u}`, none: false };
    case 'bodyweight':
      return { value: 'BW', unit: null, spoken: 'target bodyweight', none: false };
  }
}

// ---------------------------------------------------------------------------
// Rows

/** `3 × 6–8`, `3 × 0:45`, `1 × 3–5 + 2 × 6–8`; `each side` for unilateral exercises. */
export function setsDetail(working: readonly Pick<WorkoutSet, 'planned'>[], unilateral: boolean): string {
  const parts: { text: string; n: number }[] = [];
  for (const s of working) {
    const text = s.planned.reps !== null ? repRangeText(s.planned.reps) : s.planned.durationS !== null ? formatDuration(s.planned.durationS) : '—';
    const last = parts.at(-1);
    if (last?.text === text) last.n += 1;
    else parts.push({ text, n: 1 });
  }
  const body = parts.map((p) => `${String(p.n)}${NBSP}×${NBSP}${p.text}`).join(' + ');
  return unilateral && body !== '' ? `${body} each side` : body;
}

export interface PanelLine {
  key: 'added' | 'swapped' | 'skipped' | 'fit' | 'change' | 'last' | 'warmup' | 'plates' | 'best' | 'rounded' | 'gym' | 'flag' | 'coach' | 'rule' | 'load' | 'rpe';
  label: string;
  value: string;
  tone: 'normal' | 'warning';
}

/**
 * Today's edit on a row (overview-today-edits §2, §11): swapped for another
 * exercise, skipped, or added today. A row the built-in fit skipped
 * (fit-to-time §3.3) is `skipped` with `fitKeep`: its `Bring back` is Ben's
 * own sets edit at that count (FT5), not an Undo of the fit; `editId` is the
 * fit's.
 */
export type RowEdit = { kind: 'swapped'; editId: string; fromExerciseId: string; fromName: string } | { kind: 'skipped'; editId: string; fitKeep?: number } | { kind: 'added'; editId: string } | null;

/** Ben's §11 edits on a row's sets, reps and load (their edit IDs), or null with none. */
export interface RowShapeEdit {
  sets: string | null;
  reps: string | null;
  load: string | null;
}

/** One `SetCountStepper` step: the count it writes, and whether that is the plan's own (the edit is then cleared). Null: disabled. */
export type SetsStep = { workingSets: number; clear: boolean } | null;

/**
 * The step from `count` working sets by `delta` (`+1`, `−1`), against the
 * plan's own count: a step back at the plan clears the edit. Null outside
 * TE17's limits. The screen steps a quick second tap from the count its
 * previous write left, not the page it tapped on (review S2).
 */
export function setsStepFrom(count: number, delta: 1 | -1, plannedCount: number | null): SetsStep {
  const to = count + delta;
  return to < TODAY_EDIT_LIMITS.minSets || to > TODAY_EDIT_LIMITS.maxSets ? null : { workingSets: to, clear: to === plannedCount };
}

/**
 * A row in Edit mode (§11.3): the values its controls show and what each
 * step writes. The screen lays it out and sends these values; it computes nothing.
 */
export interface EditRowView {
  workingSets: number;
  /** The plan's own working-set count (what a step back to clears the edit at). */
  plannedSets: number;
  /**
   * What a step clears at: the plan's own count, or null on a row the fit
   * trimmed (fit-to-time FT5: `[+]` back to the plan's count is Ben's own
   * edit, never a clear that the trim would take again).
   */
  clearsAt: number | null;
  /** `3 sets`. */
  setsText: string;
  setsDown: SetsStep;
  setsUp: SetsStep;
  /** `6–8 reps`, `0:45`. */
  repsText: string;
  reps: RepRange | null;
  durationS: number | null;
  timed: boolean;
  /** A cardio row (review cardio S1): its sheet takes a time up to 4 h and a distance. */
  cardio: boolean;
  /** Cardio: the first working set's distance target; null otherwise or with none. */
  distanceM: number | null;
  repsEdited: boolean;
  /** The RepsSheet's `Use planned` values (what the plan gives without the reps edit); `distanceM` on a cardio row only. */
  plannedReps: { reps: RepRange | null; durationS: number | null; distanceM?: number | null };
  /** `100 kg`, `30 kg each` (a target, fitted); null: no load target (`—`). */
  loadText: string | null;
  /** `—  No history`: no load target and no comparable history. */
  noHistory: boolean;
  /** The load is Ben's own for today (`[Ben]` tag). */
  benLoad: boolean;
  /** Ben's intended load (before the fit), when he typed one. */
  intendedLoad: Load | null;
  /** The keypad's frame (unit, convention, the item it is checked on); null where there is no load to set (bodyweight). */
  keypad: { unit: WeightUnit; convention: LoadConvention; equipmentId: string | null; value: number | null } | null;
  accessibilityLabel: string;
}

/**
 * Which of today's edits a row offers (§2.2), decided here so the screen
 * only lays them out. `move`: Reorder's `↑` / `↓` (a superset moves as one).
 */
export interface RowActions {
  swap: boolean;
  /** The row is swapped: `Undo swap`, and `Swap` reads `Swap again`. */
  undoSwap: boolean;
  skip: boolean;
  bringBack: boolean;
  doFirst: boolean;
  up: boolean;
  down: boolean;
  /** `Change Push A too ›` (routine basis, swapped rows). */
  changeRoutine: boolean;
  /** `Remove` (§11.3): an exercise added today. */
  remove: boolean;
}

export interface OverviewRow {
  sessionExerciseId: string;
  exerciseId: string;
  /** The plan slot this row is (routine: `RoutineExercise.id`; next: the source part-root row). Today's edits are keyed by it. */
  slotKey: string;
  edit: RowEdit;
  /** §11: Ben's sets, reps and load edits on this row. */
  shapeEdit: RowShapeEdit | null;
  /** §11: the row's Edit mode controls. */
  editRow: EditRowView;
  actions: RowActions;
  /** 1-based position on the page. */
  index: number;
  /** `01`. */
  indexText: string;
  name: string;
  /** `3 × 6–8 · 3 warm-ups`. */
  detail: string;
  /** The warm-up fragment on its own (dropped first at large text sizes). */
  warmups: string | null;
  marker: ChangeMarker & MarkerWords;
  load: LoadCell;
  /** The snap changed the target here (rounded, capped or converted): the info glyph. */
  rounded: boolean;
  panel: PanelLine[];
  /** The active pain flag on the movement (panel `Still hurts?` when `checkDue`). */
  painFlag: { id: string; version: number; checkDue: boolean } | null;
  /** The load target was dropped because this gym lacks the equipment (`Edit gym`). */
  missingEquipment: string | null;
  /** The first pending working set: `Why?` explains it. */
  firstSetId: string | null;
  /** The equipment this row uses at this gym (null: none, or not here): `History` opens its series. */
  equipmentId: string | null;
  /** A finished workout has this exercise: `History` is offered. */
  hasHistory: boolean;
  /** The coach's stored target for this row (§5): the `Coach` tag, its reason, Undo / `Use coach target`. */
  coach: OverviewCoach | null;
  /** Superset partners' names, for VoiceOver (`Superset with Triceps pushdown`). */
  supersetWith: string[];
  accessibilityLabel: string;
}

export type OverviewGroup = { kind: 'single'; row: OverviewRow } | { kind: 'superset'; rows: OverviewRow[] };

export type OverviewBasis =
  | { kind: 'after'; routineName: string; at: ZonedTimestamp }
  | { kind: 'only' }
  | { kind: 'rotation_start' }
  | { kind: 'last_done'; at: ZonedTimestamp }
  | { kind: 'next_from'; at: ZonedTimestamp }
  | { kind: 'new_routine' }
  /** A coach-built draft (workout-builder §4.3): `COACH DRAFT · TODAY 18:02`, `COACH DRAFT · V2 · 18:20`. */
  | { kind: 'coach_draft'; at: ZonedTimestamp; versionN: number };

// ---------------------------------------------------------------------------
// previewKey (§7)

export interface PreviewKeyParts {
  /** What the page previews: Up next (the routine or the last workout's next session) or a routine from the list. */
  target: { kind: 'routine'; routineId: string } | { kind: 'next'; sourceSessionId: string } | { kind: 'coach_draft'; draftId: string };
  routine: { id: string; version: number } | null;
  /** The gym and its equipment; `typical` when there is no gym yet (Start saves the typical gym). */
  gym: { id: string; equipment: readonly { id: string; version: number }[] } | { typical: true };
  /** The workout the targets come from (its revision changes on a correction). */
  source: { id: string; revision: number } | null;
  painFlags: readonly { id: string; version: number }[];
  /** The stored coach (D21) next-session targets for `source`, by row (ADR 0021): an Undo or a late result changes the key. */
  coachActions: readonly { id: string; version: number }[];
  unit: WeightUnit;
  /** An answered check-in today: pain mentioned there holds loads. */
  checkIn: { id: string; version: number } | null;
  /** Today's pre-start draft (ADR 0022): any edit, Undo or Reset changes the key. Null: none. */
  draft?: { id: string; version: number } | null;
  /** A coach draft (workout-builder §6.3): a new version, a discard or a start changes the key. */
  coachDraft?: { id: string; version: number } | null;
  /**
   * (workout-builder v2 §8.2, WB-L12) A coach draft's stored loads are re-checked against newer
   * history at plan time: the newest finished workout (and its revision) is part of the key.
   */
  history?: { sessionId: string; revision: number } | null;
}

const byId = <T extends { id: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** A stable hash of everything that can change a target. Order of lists doesn't matter. */
export function previewKey(parts: PreviewKeyParts): string {
  const gym = 'typical' in parts.gym ? { typical: true } : { id: parts.gym.id, equipment: byId(parts.gym.equipment).map((e) => [e.id, e.version]) };
  return deriveId(
    stableStringify({
      target: parts.target,
      routine: parts.routine,
      gym,
      source: parts.source,
      painFlags: byId(parts.painFlags).map((f) => [f.id, f.version]),
      coachActions: byId(parts.coachActions).map((a) => [a.id, a.version]),
      unit: parts.unit,
      checkIn: parts.checkIn,
      // Absent and null hash alike, so a page with no draft keeps the key it had before drafts existed.
      ...(parts.draft ? { draft: parts.draft } : {}),
      ...(parts.coachDraft ? { coachDraft: parts.coachDraft } : {}),
      ...(parts.history ? { history: parts.history } : {}),
    }),
  );
}

/**
 * The rows a fresh preview was planned from, as a fence the start re-checks
 * inside its write (workout-overview §7, rule 5): a change that lands between
 * the key check and the write creates nothing. `profile`: the owner's row
 * (the unit); null where Start itself may write the profile (no gym yet: it
 * saves the typical gym first, so the gym isn't pinned either).
 */
export function previewFence(parts: PreviewKeyParts, ownerId: string, profile: { id: string; version: number } | null): WriteFence {
  return {
    rows: [
      ...(parts.routine ? [{ table: 'routines' as const, id: parts.routine.id, version: parts.routine.version }] : []),
      ...(parts.source ? [{ table: 'sessions' as const, id: parts.source.id, version: parts.source.revision }] : []),
      ...(parts.checkIn ? [{ table: 'check_ins' as const, id: parts.checkIn.id, version: parts.checkIn.version }] : []),
      ...(profile ? [{ table: 'profiles' as const, id: profile.id, version: profile.version }] : []),
      ...(parts.draft ? [{ table: 'pre_start_drafts' as const, id: parts.draft.id, version: parts.draft.version }] : []),
      ...(parts.coachDraft ? [{ table: 'workout_drafts' as const, id: parts.coachDraft.id, version: parts.coachDraft.version }] : []),
    ],
    sets: [
      ...('typical' in parts.gym ? [] : [{ kind: 'gym_equipment' as const, gymId: parts.gym.id, members: parts.gym.equipment }]),
      { kind: 'active_pain_flags' as const, ownerId, members: parts.painFlags },
      ...(parts.source ? [{ kind: 'next_session_targets' as const, ownerId, sourceSessionId: parts.source.id, members: parts.coachActions }] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// The view

export interface OverviewInput {
  /** The dry run Start uses (`preview: true`). */
  aggregate: SessionAggregate;
  /** How each set's load was fitted to this gym (`fits` from the dry run). */
  fits: Readonly<Record<string, SetFit>>;
  /** Finished history per exercise ID (`pastExercisesOf`), newest first. */
  pasts: Readonly<Record<string, readonly PastExercise[]>>;
  painFlags: readonly PainFlag[];
  /** Catalogue muscles (Coaching knowledge) per exercise ID. */
  exerciseInfo: Readonly<Record<string, Pick<Exercise, 'primaryMuscles'>>>;
  /** Ben's last finished workouts (pace). */
  recent: readonly SessionAggregate[];
  /** The pace already worked out from `recent` (`planPace`), the same one a fit used; absent: from `recent`. */
  pace?: ResolvedPace;
  nowMs: number;
  tz: string;
  title: string;
  basis: OverviewBasis;
  /** Null: no gym yet; the rows are fitted to the typical gym Start will save. */
  gym: { id: string; name: string } | null;
  key: PreviewKeyParts;
  /**
   * The coach's stored next-session targets for the workout the targets come
   * from (D21, §5), as saved, with that workout's `session.version` and
   * whether today's check-in mentioned pain (`withCoachTargets` then holds
   * them). Read only: the page never calls the coach. Absent or empty:
   * nothing coach-related renders.
   */
  coach?: { targets: readonly NextSessionTargetRecord[]; sourceVersion: number; /** `nextTargetSourceBasis` of that workout. */ sourceBasis?: string | null; painToday: boolean } | null;
  /**
   * Today's edits (overview-today-edits §6.2), from `planWithTodayEdits`:
   * each session exercise's slot key, today's slots in order, what each
   * applied edit did, and the draft. Absent: no edits (every row's slot key
   * is its session exercise ID).
   */
  today?: OverviewToday | null;
  /**
   * A coach draft's page (workout-builder §4.3): the detail line names the
   * target RPE (`4 × 6–8 @ RPE 8`), a row with no history says `start
   * light`, and a top set's own RPE is in the panel. Absent: as before.
   */
  targetRpe?: boolean;
}

export interface OverviewToday {
  slotOf: Readonly<Record<string, string>>;
  /** Today's slots after the edits, in today's order (`Do first` and Reorder move these). */
  slots: readonly TodaySlot[];
  swapped: ReadonlyMap<string, { editId: string; fromExerciseId: string; fromName: string }>;
  skipped: ReadonlyMap<string, string>;
  /** `N EDITED`. */
  editCount: number;
  draft: { id: string; version: number } | null;
  /** The routine Change … too › would change; null for a next session. */
  routineName: string | null;
  /** §11: exercises added today (slot key → edit ID). */
  added?: ReadonlyMap<string, string>;
  /** §11: Ben's sets, reps and load edits per slot. */
  shapeEdits?: ReadonlyMap<string, RowShapeEdit>;
  /** §11: each slot as planned before those edits (`planWithTodayEdits().plannedShape`). */
  plannedShape?: Readonly<Record<string, ShapeBefore>>;
  /** §11: Ben's intended loads today, per slot. */
  benLoads?: ReadonlyMap<string, Load>;
  /** Fit to time (fit-to-time §3.3): the live fit as planned; null or absent with none. */
  fit?: FitOutcome | null;
}

/**
 * `OverviewToday` from `planWithTodayEdits` (§6.2, §11, fit-to-time): the
 * one place that decides which applied edits are Ben's on the page. The
 * coach fit's own edits are the fit (its card and `TRIMMED`), never `✎
 * EDITED` or `N EDITED`. `swapped`: each swapped slot's original (the caller
 * looks its name up).
 */
export function overviewTodayOf(
  out: Pick<TodayPlanOutput, 'slotOf' | 'slots' | 'resolved' | 'plannedShape' | 'fit'>,
  p: { swapped: ReadonlyMap<string, { editId: string; fromExerciseId: string; fromName: string }>; draft: { id: string; version: number } | null; routineName: string | null },
): OverviewToday {
  const r = out.resolved;
  const ben = <V extends { editId: string }>(m: ReadonlyMap<string, V>): [string, V][] => [...m].filter(([, v]) => !r.coachEdits.has(v.editId));
  const shapeEdits = new Map<string, RowShapeEdit>();
  const shapeAt = (k: string): RowShapeEdit => shapeEdits.get(k) ?? { sets: null, reps: null, load: null };
  for (const [k, v] of ben(r.sets)) shapeEdits.set(k, { ...shapeAt(k), sets: v.editId });
  for (const [k, v] of ben(r.reps)) shapeEdits.set(k, { ...shapeAt(k), reps: v.editId });
  for (const [k, v] of ben(r.loads)) shapeEdits.set(k, { ...shapeAt(k), load: v.editId });
  return {
    slotOf: out.slotOf,
    slots: out.slots,
    swapped: p.swapped,
    skipped: r.skipped,
    editCount: editCountOf(r),
    draft: p.draft,
    routineName: p.routineName,
    added: new Map([...r.added].map(([k, v]) => [k, v.editId])),
    shapeEdits,
    plannedShape: out.plannedShape,
    benLoads: new Map(ben(r.loads).map(([k, v]) => [k, v.load])),
    fit: out.fit,
  };
}

/**
 * A row's coach state (§5). `coach`: the first working set's target is the
 * coach's stored one (Start uses it); `reason` is the stored reason.
 * `built_in`: the built-in rule's target is used and the coach's can be put
 * back: `use_coach` after Ben undid a small change, `apply` for a bigger
 * change still to apply (one Ben applied and then undid goes back to
 * `proposed`; review merge S1). `target` is the stored target (value only,
 * `57.5 kg × 6–8 · 4 sets`), so the tap isn't blind (merge N2). Null: the
 * coach has nothing for this row.
 */
export type OverviewCoach =
  | { state: 'coach'; rowId: string; reason: string | null }
  | { state: 'built_in'; rowId: string; putBack: 'use_coach' | 'apply'; target: string };

/** The stored coach target as a value: `57.5 kg × 6–8`, `+ 4 sets`. */
export function coachTargetText(record: Pick<NextSessionTargetRecord, 'target' | 'sets'>): string {
  const load = record.target.load === null ? null : loadWord(record.target.load);
  const reps = record.target.reps === null ? null : repRangeText(record.target.reps);
  const what = load !== null && reps !== null ? `${load}${NBSP}×${NBSP}${reps}` : (load ?? (reps === null ? null : `${reps}${NBSP}reps`));
  const sets = record.sets === null ? null : `${String(record.sets)}${NBSP}sets`;
  return [what, sets].filter((x): x is string => x !== null).join(' · ') || '—';
}

/**
 * The coach state for one row, from the dry run's first working set and the
 * stored rows. Putting the coach's target back is offered only where Start
 * would use it again (not used, the same source version, no pain flag, no
 * pain today).
 */
export function overviewCoachOf(
  first: Pick<WorkoutSet, 'planned'> | null,
  record: NextSessionTargetRecord | undefined,
  ctx: { sourceVersion: number | null; sourceBasis?: string | null; painFlagged: boolean; painToday: boolean },
): OverviewCoach | null {
  if (record === undefined) return null;
  const coach = first?.planned.provenance?.coach ?? null;
  if (first?.planned.source === 'coach' && coach !== null && coach.actionId === record.actionId && (record.status === 'saved' || record.status === 'applied')) {
    return { state: 'coach', rowId: record.id, reason: coach.reason ?? record.reason };
  }
  const usable = record.usedBySessionId === null && nextTargetFitsSource(record, { version: ctx.sourceVersion, basis: ctx.sourceBasis ?? null }) && !ctx.painFlagged && !ctx.painToday;
  if (!usable) return null;
  if (record.status === 'undone') return { state: 'built_in', rowId: record.id, putBack: 'use_coach', target: coachTargetText(record) };
  if (record.status === 'proposed') return { state: 'built_in', rowId: record.id, putBack: 'apply', target: coachTargetText(record) };
  return null;
}

export interface WorkoutOverview {
  previewKey: string;
  title: string;
  basis: OverviewBasis;
  gym: { id: string; name: string } | null;
  /** `estimateRemainingDuration` over the unstarted plan, rounded (§2.15); null when nothing is planned. */
  estimate: { minutes: number; seconds: number } | null;
  /** Working sets only. */
  workingSets: number;
  /** `Chest`, `Shoulders`, `Triceps`: the first is the main one. */
  muscles: string[];
  exerciseCount: number;
  groups: OverviewGroup[];
  rows: OverviewRow[];
  /** `5 EXERCISES · 3 EDITED` (§2.1): swaps and skips each count, an order change once. 0 with no draft. */
  editCount: number;
  /** Today's pre-start draft, for the next write's `expectedDraftVersion`. */
  draft: { id: string; version: number } | null;
  /** The live fit (fit-to-time §3.1, §3.3): the tile's label and the `FitCard`. Null with none. */
  fit: FitView | null;
}

/** The `FitCard` and the tile with a live fit (fit-to-time §3.1, §3.3, §7.2). App text only; minutes from the estimate. */
export interface FitView {
  editId: string;
  minutes: number;
  by: 'built_in' | 'coach';
  actionId: string | null;
  status: FitStatus;
  /** `Fitted to 45 min`, `Shortest: ≈ 52 min`, `Coach fitted to 45 min`. */
  title: string;
  /** `≈ 62 → 44 min`, or `≈ 52 min · 7 over 45` once a slot Ben kept stops it fitting. */
  beforeAfter: string;
  beforeMinutes: number;
  afterMinutes: number;
  /** The unrounded estimates (what `Fits already` and a new fit compare against). */
  beforeSeconds: number;
  afterSeconds: number;
  /** One per slot, in today's order: `Cable fly · skipped`, `Lateral raise · 3 → 2 sets`, `Face pull · added · 2 × 12–15`. */
  lines: string[];
  /** The tile's label: `Time · fit 45` (shown in caps). */
  tileLabel: string;
  /** `Fitted to 45 minutes. About 62 to about 44 minutes. Cable fly skipped. …` */
  accessibilityLabel: string;
  /** Collapsed after the first scroll: `Fitted to 45 min · ≈ 44 min`. */
  collapsed: string;
}

const minutesWord = (n: number): string => `${String(n)} ${n === 1 ? 'minute' : 'minutes'}`;

/** The card's words for a fit (§3.3, §7.2). `nameOf` / `detailOf`: a slot's exercise name and its sets detail on the page. */
export function fitView(fit: FitOutcome, nameOf: (slotKey: string) => string, detailOf: (slotKey: string) => string): FitView {
  const before = fitMinutesOf(fit.beforeSeconds, 'fitted', fit.minutes);
  const after = fitMinutesOf(fit.afterSeconds, fit.status, fit.minutes);
  const over = fit.status === 'over';
  const coach = fit.by === 'coach';
  const title = coach ? `Coach fitted to ${String(fit.minutes)} min` : over && !fit.benKept ? `Shortest: ≈${NBSP}${String(after)}${NBSP}min` : `Fitted to ${String(fit.minutes)} min`;
  const beforeAfter = over && (fit.benKept || coach) ? `≈${NBSP}${String(after)}${NBSP}min · ${String(overByMinutes(fit.afterSeconds, fit.minutes))} over ${String(fit.minutes)}` : `≈${NBSP}${String(before)} → ${String(after)}${NBSP}min`;
  const lineText = (l: FitLine): { text: string; spoken: string } => {
    const name = nameOf(l.slotKey);
    if (l.kind === 'skip') return { text: `${name} · skipped`, spoken: `${name} skipped` };
    if (l.kind === 'add') return { text: `${name} · added · ${detailOf(l.slotKey)}`, spoken: `${name} added` };
    return { text: `${name} · ${String(l.from)} → ${String(l.to)}${NBSP}sets`, spoken: `${name} ${String(l.from)} to ${String(l.to)} sets` };
  };
  const lines = fit.lines.map(lineText);
  const spokenHead = coach ? `Coach fitted to ${minutesWord(fit.minutes)}` : over && !fit.benKept ? `Shortest about ${minutesWord(after)}` : `Fitted to ${minutesWord(fit.minutes)}`;
  const spokenBa = over && (fit.benKept || coach) ? `About ${minutesWord(after)}, ${String(overByMinutes(fit.afterSeconds, fit.minutes))} over ${String(fit.minutes)}` : `About ${minutesWord(before)} to about ${minutesWord(after)}`;
  return {
    editId: fit.editId,
    minutes: fit.minutes,
    by: fit.by,
    actionId: fit.actionId,
    status: fit.status,
    title,
    beforeAfter,
    beforeMinutes: before,
    afterMinutes: after,
    beforeSeconds: fit.beforeSeconds,
    afterSeconds: fit.afterSeconds,
    lines: lines.map((l) => l.text),
    tileLabel: `Time · fit ${String(fit.minutes)}`,
    accessibilityLabel: [spokenHead, spokenBa, ...lines.map((l) => l.spoken)].join('. ') + '.',
    collapsed: `${coach ? `Coach fitted to ${String(fit.minutes)} min` : over && !fit.benKept ? 'Shortest' : `Fitted to ${String(fit.minutes)} min`} · ≈${NBSP}${String(after)}${NBSP}min`,
  };
}

function firstBarbell(aggregate: SessionAggregate, skippedRows: ReadonlySet<string>): SessionExercise | null {
  const ordered = [...aggregate.exercises].sort((a, b) => a.order - b.order).filter((e) => !skippedRows.has(e.id));
  return ordered.find((ex) => (ex.equipmentId === null ? null : aggregate.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId))?.kind === 'barbell') ?? null;
}

const loadWord = (l: Load): string => {
  const n = `${formatNumber(l.value)}${NBSP}${l.unit}`;
  switch (l.convention) {
    case 'per_hand':
      return `${n}${NBSP}each`;
    case 'assistance':
      return `−${n}`;
    case 'added':
      return `+${n}`;
    case 'bodyweight':
      return 'BW';
    case 'total':
    case 'stack':
      return n;
  }
};

/** `97.5 kg × 8, 8, 8` (one load) or `100 kg × 5, 90 kg × 8` (loads differ). Actuals only. */
export function lastText(past: PastExercise): string | null {
  const done = past.actuals;
  if (done.length === 0) return null;
  const amount = (s: PastActual) => (s.reps !== null ? String(s.reps) : s.durationS !== null ? formatDuration(s.durationS) : '—');
  const loadOf = (s: PastActual) => (s.load === null ? (past.convention === 'bodyweight' ? 'BW' : null) : loadWord(s.load));
  const loads = new Set(done.map(loadOf));
  const times = `${NBSP}×${NBSP}`;
  if (loads.size === 1) {
    const l = loadOf(done[0] as PastActual);
    const reps = done.map(amount).join(', ');
    return l === null ? reps : `${l}${times}${reps}`;
  }
  return done.map((s) => `${loadOf(s) ?? '—'}${times}${amount(s)}`).join(', ');
}

/** The heaviest counted working set over comparable history (never an estimate). Ties: more reps, then the newest. */
export function bestSet(planned: PlannedKey, pasts: readonly PastExercise[]): { load: Load; reps: number; at: ZonedTimestamp; imported: boolean } | null {
  let best: { load: Load; reps: number; at: ZonedTimestamp; kg: number; imported: boolean } | null = null;
  // Harder is heavier, except on an assisted machine, where less assistance is harder (N5).
  const sign = loadDirection(planned.convention) === 'assistance' ? -1 : 1;
  for (const p of pasts) {
    if (!isComparable(planned, p)) continue;
    for (const s of p.actuals) {
      if (s.load === null || s.reps === null || s.reps <= 0 || s.load.convention === 'bodyweight' || s.setType === 'drop' || !isSetCountable(s, 'record')) continue;
      const kg = sign * convertMass(s.load, 'kg').value;
      if (best === null || kg > best.kg || (kg === best.kg && s.reps > best.reps)) best = { load: s.load, reps: s.reps, at: p.performedAt, kg, imported: p.imported };
    }
  }
  return best === null ? null : { load: best.load, reps: best.reps, at: best.at, imported: best.imported };
}

const EQUIPMENT_NOUN: Record<EquipmentInstance['kind'], string> = {
  barbell: 'Bar',
  dumbbells: 'Rack',
  weight_stack: 'Stack',
  assisted_stack: 'Machine',
  plate_loaded_machine: 'Machine',
  bodyweight_station: 'Station',
  kettlebell: 'Kettlebells',
  ez_bar: 'Bar',
  trap_bar: 'Bar',
  smith_machine: 'Smith',
  bench: 'Bench',
  rack: 'Rack',
};

/** The panel's `ROUNDED` value: `Rack tops out at 30 kg each`, `Stack goes 15 → 17.5 → 20`, `Converted from 225 lb`. */
export function roundedText(fit: Extract<SetFit, { kind: 'rounded' }>, eq: EquipmentInstance | null): string {
  const noun = eq === null ? 'Equipment' : EQUIPMENT_NOUN[eq.kind];
  const assisted = fit.planned.convention === 'assistance';
  if (fit.bounded === 'max') return assisted ? `${noun} gives at most ${loadWord(fit.planned)}` : `${noun} tops out at ${loadWord(fit.planned)}`;
  if (fit.bounded === 'min') return assisted ? `${noun} gives at least ${loadWord(fit.planned)}` : `${noun} starts at ${loadWord(fit.planned)}`;
  if (fit.converted) return `Converted from ${loadWord(fit.requested)}`;
  const card = eq === null ? null : buildStepCard(eq, fit.planned);
  if (card === null) return `Rounded from ${loadWord(fit.requested)}`;
  const n = (l: Load) => formatNumber(l.value);
  const seq = [card.nextDown?.load, fit.planned, card.nextUp?.load].filter((l): l is Load => l !== undefined);
  const ordered = loadDirection(fit.planned.convention) === 'assistance' ? [...seq].reverse() : seq;
  return `${noun} goes ${ordered.map(n).join(' → ')}`;
}

/** `25 · 10 · 5 a side · 20 kg bar`, or null when the plates can't make it (or it isn't a bar). */
export function platesText(load: Load, eq: EquipmentInstance): string | null {
  if (!isBarLoaded(eq) || eq.plates.length === 0 || load.convention !== 'total') return null;
  const setup = buildPlateSetup(load, eq);
  if (!setup.ok) return null;
  const bar = `${formatNumber(setup.base.value)}${NBSP}${setup.base.unit} bar`;
  const plates = setup.perSide.flatMap((p) => Array.from({ length: p.count }, () => formatNumber(p.mass)));
  return plates.length === 0 ? `Bar only · ${bar}` : `${plates.join(' · ')} a side · ${bar}`;
}

/** `20 × 10 · 60 × 5 · 80 × 3`: the planned warm-ups (load number × reps). */
function warmupText(sets: readonly WorkoutSet[]): string | null {
  const parts = sets.map((s) => {
    const l = s.planned.load === null ? 'BW' : formatNumber(s.planned.load.value);
    const r = s.planned.reps !== null ? repRangeText(s.planned.reps) : s.planned.durationS !== null ? formatDuration(s.planned.durationS) : '—';
    return `${l}${NBSP}×${NBSP}${r}`;
  });
  return parts.length === 0 ? null : parts.join(' · ');
}

function flagText(flag: PainFlag): string {
  const where = flag.area === null ? null : PAIN_AREA_WORD[flag.area];
  const word = where === null ? 'Pain' : `${where.charAt(0).toUpperCase()}${where.slice(1)}`;
  return `${word} · ${dayMonthText(flag.reportedAt.utc, flag.reportedAt.tz)}`;
}

export function buildWorkoutOverview(input: OverviewInput): WorkoutOverview {
  const { aggregate } = input;
  const ordered = [...aggregate.exercises].sort((a, b) => a.order - b.order);
  const sets = aggregate.sets.filter(live);
  const today = input.today ?? null;
  const slotOf = (sxId: string): string => today?.slotOf[sxId] ?? sxId;
  // The live fit (fit-to-time §3.3): the built-in trim's cut sets, and each slot's line.
  const fit = today?.fit ?? null;
  const fitLines = new Map((fit?.lines ?? []).map((l) => [l.slotKey, l]));
  const fitSkipped = (sxId: string): boolean => fit?.by === 'built_in' && fitLines.get(slotOf(sxId))?.kind === 'skip';
  const fitCutSets = new Set(fit?.skipSetIds ?? []);
  const skippedRows = new Set(ordered.filter((e) => today?.skipped.has(slotOf(e.id)) === true || fitSkipped(e.id)).map((e) => e.id));
  const barbellEx = firstBarbell(aggregate, skippedRows);
  const unskipped = ordered.length - skippedRows.size;
  const todaySlots: TodaySlot[] = today?.slots.length ? [...today.slots] : ordered.map((e) => ({ slotKey: e.id, exerciseId: e.exerciseId, supersetGroup: e.supersetGroup }));
  const coachByExercise = new Map((input.coach?.targets ?? []).map((r) => [r.exerciseId, r]));
  const sourceVersion = input.coach?.sourceVersion ?? null;
  const sourceBasis = input.coach?.sourceBasis ?? null;

  const rows: OverviewRow[] = ordered.map((ex, i) => {
    // A trimmed row shows what is left (`2 × 12–15`); a skipped one, what it was.
    const own = sets.filter((s) => s.sessionExerciseId === ex.id && s.pairedWithSetId === null && (skippedRows.has(ex.id) || !fitCutSets.has(s.id))).sort((a, b) => a.index - b.index);
    const working = own.filter((s) => isWorking(s.setType));
    const warm = own.filter((s) => !isWorking(s.setType));
    const first = working[0] ?? null;
    const eq = ex.equipmentId === null ? null : (aggregate.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
    const planned: PlannedFirst = { load: first?.planned.load ?? null, reps: first?.planned.reps ?? null, durationS: first?.planned.durationS ?? null, workingSets: working.length, convention: ex.loadConvention };
    // Fits for this exercise's working sets; the first working set decides `NO LOAD` and the glyph.
    const fits = working.map((s) => input.fits[s.id]).filter((f): f is SetFit => f !== undefined);
    const firstFit = first === null ? null : (input.fits[first.id] ?? null);
    const dropped = fits.find((f): f is Extract<SetFit, { kind: 'dropped' }> => f.kind === 'dropped') ?? null;
    const notHere = eq === null && dropped?.reason === 'equipment_not_in_gym';
    const key: PlannedKey = { equipment: notHere ? 'any' : equipmentKey(eq), convention: ex.loadConvention };
    const pasts = input.pasts[ex.exerciseId] ?? [];
    const comparable = lastComparable(key, pasts);
    const covering = painFlagCovering([...input.painFlags], ex.exerciseId, input.nowMs, input.tz);
    const rounded = fits.find((f): f is Extract<SetFit, { kind: 'rounded' }> => f.kind === 'rounded') ?? null;
    const slotKey = slotOf(ex.id);
    const swappedFrom = today?.swapped.get(slotKey);
    const skipEdit = today?.skipped.get(slotKey);
    const addEdit = today?.added?.get(slotKey);
    const shapeEdit = today?.shapeEdits?.get(slotKey) ?? null;
    const fitLine = fitLines.get(slotKey) ?? null;
    const trimmed = fitLine?.kind === 'sets';
    const edit: RowEdit =
      skipEdit !== undefined
        ? { kind: 'skipped', editId: skipEdit }
        : fitSkipped(ex.id) && fit !== null
          ? { kind: 'skipped', editId: fit.editId, fitKeep: own.filter((s) => isWorking(s.setType)).length }
        : addEdit !== undefined
          ? { kind: 'added', editId: addEdit }
          : swappedFrom !== undefined
            ? { kind: 'swapped', editId: swappedFrom.editId, fromExerciseId: swappedFrom.fromExerciseId, fromName: swappedFrom.fromName }
            : null;
    const base = targetChangeMarker(planned, comparable, covering?.flag ?? null, firstFit);
    // Precedence (§2.1, §11.3, fit-to-time §3.3): SKIPPED > HELD > NO LOAD > ADDED > SWAPPED > EDITED > TRIMMED > the §4 markers.
    const warned = base.kind === 'held' || base.kind === 'no_load';
    const marker: ChangeMarker =
      edit?.kind === 'skipped'
        ? { kind: 'skipped', delta: null, basis: null }
        : warned
          ? base
          : edit?.kind === 'added'
            ? { kind: 'added', delta: null, basis: null }
            : edit?.kind === 'swapped'
              ? { kind: 'swapped', delta: base.delta, basis: base.basis }
              : shapeEdit !== null
                ? { kind: 'edited', delta: base.delta, basis: base.basis }
                : trimmed
                  ? { kind: 'trimmed', delta: base.delta, basis: base.basis }
                  : base;
    const words = markerWords(marker.kind);
    const load = edit?.kind === 'skipped' ? { value: '—', unit: null, spoken: 'skipped', none: true } : loadCell(planned.load, ex.loadConvention, eq?.kind ?? null, firstFit?.kind === 'dropped');

    const warmups = warm.length === 0 ? null : `${String(warm.length)} ${warm.length === 1 ? 'warm-up' : 'warm-ups'}`;
    const setsText = setsDetail(working, ex.laterality === 'unilateral');
    // A coach draft's target RPE (BD7): the working sets' value after the reps; `@` marks it as a target.
    const workRpe = input.targetRpe === true ? (working.at(-1)?.planned.rpe ?? null) : null;
    const topRpe = input.targetRpe === true ? (working.find((s) => s.setType === 'top')?.planned.rpe ?? null) : null;
    const detail = [workRpe === null || setsText === '' ? setsText : `${setsText} @ RPE ${formatNumber(workRpe)}`, warmups].filter((x): x is string => x !== null && x !== '').join(' · ');

    const panel: PanelLine[] = [];
    if (edit?.kind === 'added') panel.push({ key: 'added', label: 'Added', value: 'Today', tone: 'normal' });
    if (edit?.kind === 'swapped') panel.push({ key: 'swapped', label: 'Swapped', value: `For ${edit.fromName} · today`, tone: 'normal' });
    if (edit?.kind === 'skipped') panel.push({ key: 'skipped', label: 'Skipped', value: 'Today', tone: 'normal' });
    if (fitLine?.kind === 'sets' && fit !== null) panel.push({ key: 'fit', label: 'Fit', value: `${String(fitLine.from)} → ${String(fitLine.to)}${NBSP}sets · fit ${String(fit.minutes)}`, tone: 'normal' });
    const change = edit?.kind === 'skipped' ? null : changeText(marker);
    if (change !== null) panel.push({ key: 'change', label: 'Change', value: change, tone: 'normal' });
    const last = comparable === null ? null : lastText(comparable);
    if (comparable !== null && last !== null) panel.push({ key: 'last', label: 'Last', value: `${last} · ${dayMonthText(comparable.performedAt.utc, comparable.performedAt.tz)}`, tone: 'normal' });
    if (barbellEx?.id === ex.id) {
      const w = warmupText(warm);
      if (w !== null) panel.push({ key: 'warmup', label: 'Warm-up', value: w, tone: 'normal' });
      const plates = planned.load !== null && eq !== null ? platesText(planned.load, eq) : null;
      if (plates !== null) panel.push({ key: 'plates', label: 'Plates', value: plates, tone: 'normal' });
      const best = bestSet(key, pasts);
      if (best !== null) panel.push({ key: 'best', label: 'Best', value: `${loadWord(best.load)}${NBSP}×${NBSP}${String(best.reps)} · ${dayMonthText(best.at.utc, best.at.tz)}`, tone: 'normal' });
    }
    if (rounded !== null && !dropped) panel.push({ key: 'rounded', label: 'Rounded', value: roundedText(rounded, eq), tone: 'normal' });
    const missing = dropped?.reason === 'equipment_not_in_gym' ? dropped.missing : null;
    if (dropped !== null) {
      const assisted = dropped.requested.convention === 'assistance';
      const what = droppedWords(dropped.reason, {
        equipmentName: missing,
        unit: dropped.requested.unit,
        requested: assisted ? `${formatNumber(dropped.requested.value)}${NBSP}${dropped.requested.unit}` : loadWord(dropped.requested),
        assisted,
      });
      panel.push({ key: 'gym', label: 'Gym', value: what, tone: 'warning' });
    }
    if (covering !== null) panel.push({ key: 'flag', label: 'Flag', value: flagText(covering.flag), tone: 'warning' });
    // B6 (workout-builder BD6): no comparable history, so no load; the first set card asks for it.
    if (input.targetRpe === true && edit?.kind !== 'skipped' && planned.load === null && comparable === null && dropped === null && ex.loadConvention !== 'bodyweight') panel.push({ key: 'load', label: 'Load', value: '— · start light', tone: 'normal' });
    if (topRpe !== null && workRpe !== null && topRpe !== workRpe) panel.push({ key: 'rpe', label: 'RPE', value: `Top ${formatNumber(topRpe)} · back-off ${formatNumber(workRpe)}`, tone: 'normal' });
    // (19 Oct) An exercise added again today is its own copy: the coach's next-time target is the plan's slot's only.
    const addedCopy = today?.added?.has(slotOf(ex.id)) === true && ordered.some((o) => o.id !== ex.id && o.exerciseId === ex.exerciseId);
    const coach = overviewCoachOf(first, addedCopy ? undefined : coachByExercise.get(ex.exerciseId), { sourceVersion, sourceBasis, painFlagged: covering !== null, painToday: input.coach?.painToday === true });
    // D1 (minimal copy): a built-in rule target says so in one word, as a coach target does; the rule in full is behind `Why?`.
    if (coach?.state !== 'coach' && first?.planned.source === 'built_in_rule') panel.push({ key: 'rule', label: 'Rule', value: first.planned.provenance?.rule?.name ?? 'Built-in', tone: 'normal' });
    if (coach?.state === 'coach' && coach.reason !== null) panel.push({ key: 'coach', label: 'Coach', value: `“${coach.reason}”`, tone: 'normal' });
    if (coach?.state === 'built_in') panel.push({ key: 'coach', label: 'Coach', value: coach.target, tone: 'normal' });

    const supersetWith = ex.supersetGroup === null ? [] : ordered.filter((o) => o.id !== ex.id && o.supersetGroup === ex.supersetGroup).map((o) => o.exerciseName);
    const spokenSets = (() => {
      const n = working.length;
      const r = first?.planned.reps;
      const what = r ? (r.min === r.max ? String(r.min) : `${String(r.min)} to ${String(r.max)}`) : first?.planned.durationS !== null && first?.planned.durationS !== undefined ? formatDuration(first.planned.durationS) : null;
      return `${String(n)} ${n === 1 ? 'set' : 'sets'}${what === null ? '' : ` of ${what}`}${ex.laterality === 'unilateral' ? ' each side' : ''}`;
    })();
    const moves = slotMoves(todaySlots, slotKey);
    const actions: RowActions = {
      swap: edit?.kind !== 'skipped' && edit?.kind !== 'added',
      undoSwap: edit?.kind === 'swapped',
      skip: edit?.kind !== 'skipped' && edit?.kind !== 'added' && unskipped > 1,
      bringBack: edit?.kind === 'skipped',
      doFirst: edit?.kind !== 'skipped' && moves.first,
      up: moves.up,
      down: moves.down,
      changeRoutine: edit?.kind === 'swapped' && today?.routineName !== null && today?.routineName !== undefined,
      remove: edit?.kind === 'added',
    };
    const editRowBase = editRowView({
      index: i + 1,
      name: ex.exerciseName,
      working,
      edit,
      shapeEdit,
      plannedShape: today?.plannedShape?.[slotKey] ?? null,
      load,
      noHistory: planned.load === null && comparable === null && load.none,
      benLoad: today?.benLoads?.get(slotKey) ?? null,
      eq,
      convention: ex.loadConvention,
      unit: input.key.unit,
      timed: ex.measurement !== 'reps',
      cardio: ex.measurement === 'cardio',
    });
    // A trimmed row's stepper writes Ben's count (FT5: `[+]` takes the slot out of the fit), never a clear back to the trim.
    const editRow: EditRowView = trimmed && shapeEdit === null ? { ...editRowBase, clearsAt: null, setsDown: keepStep(editRowBase.setsDown), setsUp: keepStep(editRowBase.setsUp) } : editRowBase;
    const accessibilityLabel = (edit?.kind === 'skipped' ? [String(i + 1), ex.exerciseName, 'skipped today'] : [
      String(i + 1),
      ex.exerciseName,
      edit?.kind === 'added' ? 'added today' : null,
      edit?.kind === 'swapped' ? `swapped for ${edit.fromName} today` : null,
      edit?.kind !== 'added' && shapeEdit !== null ? 'edited today' : null,
      trimmed && shapeEdit === null && edit?.kind !== 'added' ? 'trimmed to fit' : null,
      supersetWith.length > 0 ? `superset with ${supersetWith.join(' and ')}` : null,
      spokenSets,
      warmups,
      load.spoken,
      rounded !== null && !dropped ? 'rounded to this gym' : null,
      marker.kind === 'swapped' || marker.kind === 'added' || marker.kind === 'edited' || marker.kind === 'trimmed' ? markerSpoken(base) : markerSpoken(marker),
      coach?.state === 'coach' ? 'coach target' : null,
    ])
      .filter((x): x is string => x !== null && x !== '')
      .join(', ');

    return {
      sessionExerciseId: ex.id,
      exerciseId: ex.exerciseId,
      slotKey,
      edit,
      shapeEdit,
      editRow,
      actions,
      index: i + 1,
      indexText: String(i + 1).padStart(2, '0'),
      name: ex.exerciseName,
      detail,
      warmups,
      marker: { ...marker, ...words },
      load,
      rounded: rounded !== null && dropped === null,
      panel,
      painFlag: covering === null ? null : { id: covering.flag.id, version: covering.flag.version, checkDue: covering.checkDue },
      missingEquipment: missing,
      firstSetId: first?.id ?? null,
      equipmentId: notHere ? null : ex.equipmentId,
      hasHistory: pasts.some((p) => p.actuals.length > 0),
      coach,
      supersetWith,
      accessibilityLabel,
    };
  });

  // Consecutive exercises in one superset group form one block (bracket + eyebrow).
  const groups: OverviewGroup[] = [];
  ordered.forEach((ex, i) => {
    const row = rows[i];
    if (row === undefined) return;
    const prev = groups.at(-1);
    const prevEx = ordered[i - 1];
    if (ex.supersetGroup !== null && prev?.kind === 'superset' && prevEx?.supersetGroup === ex.supersetGroup) {
      prev.rows.push(row);
      return;
    }
    const next = ordered[i + 1];
    if (ex.supersetGroup !== null && next?.supersetGroup === ex.supersetGroup) groups.push({ kind: 'superset', rows: [row] });
    else groups.push({ kind: 'single', row });
  });

  // Skipped rows stay in place but are left out of TIME, DONE BY, SETS and the muscles line (§2.1).
  const est = estimateRemainingDuration(aggregate, input.pace ? { pace: input.pace } : { recent: input.recent });
  const rowBySlot = new Map(rows.map((r) => [r.slotKey, r]));
  const view = fit === null ? null : fitView(fit, (k) => rowBySlot.get(k)?.name ?? 'Exercise', (k) => rowBySlot.get(k)?.detail ?? '');
  const muscles = muscleWords(
    ordered
      .filter((e) => !skippedRows.has(e.id))
      .map((e) => input.exerciseInfo[e.exerciseId])
      .filter((x): x is Pick<Exercise, 'primaryMuscles'> => x !== undefined),
  );
  return {
    previewKey: previewKey(input.key),
    title: input.title,
    basis: input.basis,
    gym: input.gym,
    // With a fit, the tile reads the card's number (an `over` fit never rounds to its own length).
    estimate: est.pendingSets === 0 ? null : { minutes: view !== null && fit !== null ? fitMinutesOf(est.seconds, fit.status, fit.minutes) : est.minutes, seconds: est.seconds },
    workingSets: sets.filter((s) => s.pairedWithSetId === null && isWorking(s.setType) && !skippedRows.has(s.sessionExerciseId) && !fitCutSets.has(s.id)).length,
    muscles,
    exerciseCount: ordered.length,
    groups,
    rows,
    editCount: today?.editCount ?? 0,
    draft: today?.draft ?? null,
    fit: view,
  };
}

const keepStep = (step: SetsStep): SetsStep => (step === null ? null : { workingSets: step.workingSets, clear: false });

const FIVE_MIN_MS = 5 * 60_000;

/** `DONE BY` (§3.4): now + the estimate, rounded to 5 min, as `19:05`. The screen re-asks once a minute (`timing.timeLeftRefresh`). */
export function overviewDoneBy(nowMs: number, estimateSeconds: number, tz: string): { atMs: number; text: string } {
  const atMs = Math.round((nowMs + estimateSeconds * 1000) / FIVE_MIN_MS) * FIVE_MIN_MS;
  return { atMs, text: clockText(atMs, tz) };
}

/** The stat strip as one VoiceOver element (§8): `About 55 minutes, done about 19:05, 15 working sets`. */
export function statStripSpoken(estimateMinutes: number | null, doneByText: string | null, workingSets: number): string {
  const sets = `${String(workingSets)} working ${workingSets === 1 ? 'set' : 'sets'}`;
  if (estimateMinutes === null || doneByText === null) return sets;
  return `About ${String(estimateMinutes)} ${estimateMinutes === 1 ? 'minute' : 'minutes'}, done about ${doneByText}, ${sets}`;
}

// ---------------------------------------------------------------------------
// Edit mode (overview-today-edits §11)

const spokenReps = (r: RepRange): string => (r.min === r.max ? `${String(r.min)} reps` : `${String(r.min)} to ${String(r.max)} reps`);

/** One row's Edit mode controls: the stepper's steps, reps, the fitted load and the keypad's frame. */
export function editRowView(i: {
  index: number;
  name: string;
  working: readonly Pick<WorkoutSet, 'planned'>[];
  edit: RowEdit;
  shapeEdit: RowShapeEdit | null;
  plannedShape: ShapeBefore | null;
  load: LoadCell;
  noHistory: boolean;
  benLoad: Load | null;
  eq: EquipmentInstance | null;
  convention: LoadConvention;
  unit: WeightUnit;
  timed: boolean;
  cardio?: boolean;
}): EditRowView {
  const n = i.working.length;
  const first = i.working[0];
  const plannedCount = i.plannedShape?.workingSets ?? n;
  const reps = first?.planned.reps ?? null;
  const durationS = first?.planned.durationS ?? null;
  const cardio = i.cardio === true;
  const distanceM = cardio ? (first?.planned.distanceM ?? null) : null;
  const repsText = cardio ? cardioValuesText({ durationS, distanceM }) : reps !== null ? `${repRangeText(reps)}${NBSP}reps` : durationS !== null ? formatDuration(durationS) : '—';
  const loadText = i.load.none ? null : i.load.unit === null ? i.load.value : `${i.load.value}${NBSP}${i.load.unit}`;
  const bodyweight = i.convention === 'bodyweight';
  const frameUnit = i.eq !== null && i.eq.kind !== 'bodyweight_station' ? i.eq.unit : (first?.planned.load?.unit ?? i.unit);
  const frameConvention = i.eq !== null && i.eq.kind !== 'bodyweight_station' ? i.eq.loadConvention : i.convention;
  const setsText = `${String(n)}${NBSP}${n === 1 ? 'set' : 'sets'}`;
  const edited = i.edit?.kind !== 'added' && i.shapeEdit !== null;
  const accessibilityLabel = [
    String(i.index),
    i.name,
    i.edit?.kind === 'added' ? 'added' : edited ? 'edited' : null,
    `${String(n)} ${n === 1 ? 'set' : 'sets'}`,
    cardio ? cardioValuesText({ durationS, distanceM }) : reps !== null ? spokenReps(reps) : durationS !== null ? formatDuration(durationS) : null,
    cardio ? null : i.noHistory ? 'no history' : i.load.spoken,
    i.benLoad !== null ? 'your target today' : null,
  ]
    .filter((x): x is string => x !== null)
    .join(', ');
  return {
    workingSets: n,
    plannedSets: plannedCount,
    clearsAt: plannedCount,
    setsText,
    setsDown: setsStepFrom(n, -1, plannedCount),
    setsUp: setsStepFrom(n, 1, plannedCount),
    repsText,
    reps,
    durationS,
    timed: i.timed,
    cardio,
    distanceM,
    repsEdited: i.shapeEdit?.reps != null,
    plannedReps: { reps: i.plannedShape?.reps ?? reps, durationS: i.plannedShape?.durationS ?? durationS, ...(cardio ? { distanceM: i.plannedShape === null ? distanceM : (i.plannedShape.distanceM ?? null) } : {}) },
    loadText,
    noHistory: i.noHistory,
    benLoad: i.benLoad !== null,
    intendedLoad: i.benLoad,
    keypad: bodyweight ? null : { unit: frameUnit, convention: frameConvention, equipmentId: i.eq?.id ?? null, value: keypadValue([i.benLoad, first?.planned.load ?? null], frameUnit, frameConvention) },
    accessibilityLabel,
  };
}

/**
 * The keypad's first value: the first of `loads` (Ben's intended load, then
 * the fitted planned one) already in the frame's unit and convention. A
 * number is never relabelled with another unit or convention (review B2):
 * `37.5 kg each` at an lb rack opens at the fitted `80 lb each`, not `37.5 lb`.
 */
function keypadValue(loads: readonly (Load | null)[], unit: WeightUnit, convention: LoadConvention): number | null {
  for (const l of loads) if (l !== null && l.unit === unit && l.convention === convention) return l.value;
  return null;
}

/**
 * The keypad's note before `Set target` (§11.4): `Rounds to 97.5 kg here`,
 * `Most here: 30 kg each`, or why it can't be made. Null: makeable as typed
 * (or nothing to check it on; the fit at Start still applies).
 */
export function todayLoadNote(load: Load, eq: EquipmentInstance | null): string | null {
  if (eq === null || eq.kind === 'bodyweight_station') return null;
  const r = roundToAvailableLoad(load, eq, 'easier');
  if (!r.ok) return droppedWords(r.reason, { unit: load.unit });
  if (r.exact && r.convertedRequest === null) return null;
  const words = loadText(r.load, r.load.convention, eq).replaceAll(NBSP, ' ');
  const assisted = loadDirection(eq.loadConvention) === 'assistance';
  if (r.bounded === 'max') return assisted ? `Most assistance here: ${words}` : `Most here: ${words}`;
  if (r.bounded === 'min') return assisted ? `Least assistance here: ${words}` : `Least here: ${words}`;
  return `Rounds to ${words} here`;
}

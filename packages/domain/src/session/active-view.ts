import type { CommandOf, EquipmentInstance, Load, Measurement, PainFlag, ZonedTimestamp, SessionAggregate, SessionExercise, SetExclusion, SetSide, SetType, SetValues, WorkoutSet } from '@fizz/schemas';
import {
  EQUIPMENT_WORD,
  SET_TYPE_BADGE,
  SET_TYPE_WORD,
  formatDistance,
  formatDuration,
  formatNumber,
  loadFieldLabel,
  loadFieldUnit,
  loadText,
  targetShort,
  targetText,
  valuesText,
} from '../display';
import { exclusionAccessibility, exclusionPainLine, exclusionTag, normaliseExclusions, notCountedLine, withExclusionWords } from '../exclusions';
import { getAchievableLoads, isLoadAchievable, loadDirection, stepLoad } from '../equipment';
import { painFlagCovering, painFlagFact, painNoteAccessibility, painNoteText, painReviewQuestion } from '../pain-flags';
import { plateBreakdownLine, showsWarmUp, warmUpRamp, warmUpText } from '../touches';
import { comparableSetsOf, fitNotesPlannedSets, matchesEquipment, type HistorySession } from '../progression';
import { toMs } from '../time';
import { carriesTodayAdjustment, coachUndoRefusal } from './coach-undo';
import { equipmentOfRow } from './equipment-snapshot';
import { blockSets, isEmptyPart, partRootOf } from './gym-switch';
import { buildExecutionOrder, nextPendingSet } from './order';
import { DEFAULT_WORKING_SETS, GENERIC_WORKOUT_NAME, isOpenEndedWorkout, storedWorkoutName } from './first-run';
import { latestCommittedSetId } from './reducer';
import { midSwapSlot } from './mid-swap';
import { setSnapNote, type NoteLine } from './snap-text';
import { buildTimeLeftView, type PaceSamples, type TimeLeftEstimate, type TimeLeftLineView } from './time-left';
import { draftOperationId, getActiveDurationMs, getSessionPhase, prefillDraft, type ComparableSet, type DraftSource, type SessionPhase } from './view';
import { targetRpeOf, type TargetRpe } from '../coach/target-rpe';

/**
 * `buildActiveSetView` (active-workout.md §6): everything the Active workout
 * and Rest screens show, derived from committed state plus Ben's unsaved
 * edits. Pure, so the screen never computes targets, loads or labels itself.
 * The Log label is built from exactly the values `log_set` will save.
 */

/** The last comparable session of one exercise (same equipment instance, unit and convention). */
export interface PreviousSession {
  sessionId: string;
  performedAtUtc: string;
  /** The compared workout's own gym (null: not recorded), so nothing claims it was at today's gym. */
  gymId: string | null;
  /** From FitNotes (B7): shown as `Last (FitNotes, 1 Oct)`, never as an app session. */
  imported: boolean;
  /** Working-order sets as logged, for prefill and the `Last (…)` line. */
  sets: ComparableSet[];
}

/**
 * Pick the most recent history session that is like-for-like with this
 * session exercise: same equipment instance, and every load in the same unit
 * and convention (history in another unit or convention is never offered).
 * Imported (FitNotes) history has no equipment recorded, so it matches on
 * unit and convention alone and is marked `imported` (B7, approved 11 Oct
 * 2026); only its working sets are offered (`comparableSetsOf`).
 */
export function lastComparableSession(history: readonly HistorySession[], ex: Pick<SessionExercise, 'equipmentId' | 'unit' | 'loadConvention'>): PreviousSession | null {
  const sorted = [...history].sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
  for (const h of sorted) {
    if (!matchesEquipment(h, ex.equipmentId)) continue;
    const sets = comparableSetsOf(h).filter((s) => s.setType !== 'warmup');
    if (sets.length === 0) continue;
    const alike = sets.every((s) => s.load === null || s.load.convention === 'bodyweight' || (s.load.unit === ex.unit && s.load.convention === ex.loadConvention));
    if (!alike) continue;
    return {
      sessionId: h.sessionId,
      performedAtUtc: h.performedAtUtc,
      gymId: h.gymId,
      imported: h.imported,
      sets: sets.map((s, index) => ({
        index,
        values: { load: s.load, reps: s.reps, durationS: s.durationS ?? null, rpe: s.rpe, rir: s.rir, ...(s.distanceM !== undefined ? { distanceM: s.distanceM } : {}) },
        ...(s.exclusions && s.exclusions.length > 0 ? { exclusions: s.exclusions } : {}),
      })),
    };
  }
  return null;
}

/**
 * Working sets to plan when an exercise is added after `previous` (Add
 * exercise, `planFor`): its counted sets with reps. From FitNotes (review
 * import-progress B1, B2), the same reading as the load
 * (`comparableSetsOf`), and the reading never takes the count below the
 * built-in default (`importedWorkingSetCount`): a top single followed by
 * nothing still plans 3 sets, a 2-set session plans 2.
 */
export function workingSetsFromPrevious(previous: PreviousSession, history: readonly HistorySession[]): number {
  const withReps = previous.sets.filter((s) => s.values.reps !== null);
  const counted = withReps.length;
  if (!previous.imported) return counted;
  // r3 S1, r4 B1: only the sets the rule judges (not a lone top set); a lighter finisher never lifts the count.
  const source = history.find((h) => h.sessionId === previous.sessionId && h.imported);
  const total = source ? source.sets.filter((s) => s.setType !== 'warmup' && s.reps !== null).length : counted;
  return fitNotesPlannedSets(withReps.map((s) => ({ load: s.values.load })), total, DEFAULT_WORKING_SETS);
}

/** Unsaved changes held by the screen (debounced to `save_draft`). */
export interface DraftEdits {
  setId: string;
  values: SetValues;
  side?: SetSide;
  /** Set by "copy last time" (`Copied from 1 Oct`). */
  copied?: boolean;
}

/** The `save_draft` for the screen's edits: the values and, when chosen, the side (so it survives a minimise or restart). */
export function saveDraftCommand(edits: DraftEdits, at: ZonedTimestamp): CommandOf<'save_draft'> {
  return { type: 'save_draft', at, setId: edits.setId, values: edits.values, ...(edits.side !== undefined ? { side: edits.side } : {}) };
}

export interface ActiveViewInput {
  aggregate: SessionAggregate;
  nowMs: number;
  gymName: string | null;
  /** Keyed by session exercise ID. */
  previous: Readonly<Record<string, PreviousSession | null>>;
  /** Exercise IDs with an active pain flag. */
  painFlagged: ReadonlySet<string>;
  /**
   * The built-in rule's target RPE per session exercise (`ruleTargetRpes`),
   * the last fallback of each set's target RPE (`targetRpeOf`). Omitted: only
   * Ben's, the coach's or the plan's target shows.
   */
  ruleTargetRpe?: Readonly<Record<string, number>>;
  /**
   * Ben's pain flags (active ones are enough), for the note's `check due`
   * and the rest card's `Still hurts?` line (active-workout §2.14.2). Dates
   * are read in the workout's zone.
   */
  painFlags?: readonly PainFlag[];
  edits: DraftEdits | null;
  /** A derived name (`Push`) for a workout without one (audit F5); the stored name wins. */
  title?: string | null;
  /** Gym names by ID, for a workout that used more than one gym (part dividers, done-set captions). */
  gymNames?: Readonly<Record<string, string>>;
  /** Pace samples from Ben's last finished workouts, for `Time left` (§2.15.2). Omitted = none. */
  recentPace?: PaceSamples;
  /**
   * False skips `timeLeft` (null). The workout screen reads `Time left` from
   * its own once-a-minute clock (`services.workout.timeLeft`), so its 1 s view
   * doesn't estimate it again and throw it away (review N4). Default true
   * (Today's Resume card).
   */
  withTimeLeft?: boolean;
}

/** `TimeLeftLine` (§2.15.1): an estimate, never a countdown; null when hidden. */
export interface TimeLeftView {
  estimate: TimeLeftEstimate;
  line: TimeLeftLineView;
}

/** `PainFlagNote` under the target line; tapping it opens that flag's sheet (§2.14.4). */
export interface PainFlagNoteView {
  flagId: string;
  flagVersion: number;
  checkDue: boolean;
  /** `Pain flag: no increases` (`· check due`). */
  text: string;
  accessibilityLabel: string;
}

/**
 * `PainReviewLine` (§2.14.2): asked in the rest card once per due flag per
 * workout, right after the first logged set of that movement. Derived from
 * stored state, so it survives a force-close; the next Log moves on and it
 * isn't asked again in that workout. Never spoken, never a banner.
 */
export interface PainReviewPrompt {
  flagId: string;
  flagVersion: number;
  exerciseName: string;
  /** The just-saved set it follows (the outcome line hides when this changes). */
  afterSetId: string;
  /** `Overhead press: still hurting?` */
  question: string;
  /** `Pain flag since 6 Oct · 16 days` */
  fact: string;
}

export type StepTarget = { enabled: true; value: number; label: string } | { enabled: false; reason: string };

export interface LoadField {
  label: string;
  unitText: string;
  value: number | null;
  down: StepTarget;
  up: StepTarget;
  /** Assisted machines: `+` means more assistance (easier). */
  assisted: boolean;
}

export type SetRowStatus = 'done' | 'active' | 'pending' | 'skipped';

export interface SetRowView {
  setId: string;
  number: number;
  /** `W`, `T`, `B`, `D`, `L`, `R` text badges (never colour alone). */
  badges: string[];
  /** Ben's note on this set, or null. */
  note: string | null;
  status: SetRowStatus;
  text: string;
  edited: boolean;
  /**
   * Ben's exclusion flags (§2.13), canonical order. `exclusionTag` is the
   * colourless `Tag` (`Spotted`), `notCounted` the Overview's second line
   * (`Spotted · not counted`), `accessibility` what VoiceOver appends. All
   * null when the set counts.
   */
  exclusions: SetExclusion[];
  exclusionTag: string | null;
  notCounted: string | null;
  exclusionAccessibility: string | null;
  version: number;
  /** A done set from a gym other than the current one: that gym's name (gym-switch §2.5). */
  gymCaption: string | null;
  /** `At Hotel · Lisbon`: this set starts a part at another gym (`GymPartDivider` before it). */
  partStart: string | null;
}

export interface FocusView {
  setId: string;
  setVersion: number;
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  measurement: Measurement;
  unilateral: boolean;
  /** Ben's note on this exercise today (Notes), or null. */
  note: string | null;
  /** `Swapped from Bench press` while this row is today's swap (EL4); null otherwise. */
  swappedFrom: { name: string; opId: string } | null;
  /** `Remove exercise` is offered: nothing on it is logged and it has no parts at another gym (exercise-library §4.6). */
  removable: boolean;
  /** `Swap exercise` is offered: the row has pending sets a swap would move (`midSwapSlot`; not only a half-logged pair's other side, review gaps r2 S1). */
  swappable: boolean;
  /** `Barbell · Working · Set 2 of 4`, `Barbell · Warm-up · Set 1 of 4` (+ ` · per side`). */
  headerLine: string;
  /** The set's type word, always shown (F3): `Warm-up`, `Working`, `Top set`, `Back-off`, `Drop set`. */
  setTypeLabel: string;
  setNumber: number;
  setCount: number;
  /** `imported`: from FitNotes, shown as `Last (FitNotes, 1 Oct)` (B7). */
  previous: { performedAtUtc: string; text: string; values: SetValues; imported: boolean } | null;
  draft: SetValues;
  draftSource: DraftSource | 'edited' | 'copied';
  loadField: LoadField | null;
  reps: { value: number | null; down: StepTarget; up: StepTarget } | null;
  /** Timed sets: the work time in seconds, stepping 5 s. */
  duration: { value: number | null; down: StepTarget; up: StepTarget } | null;
  /** Distance sets: metres, stepping 5 m (sled push, carries). */
  distance: { value: number | null; down: StepTarget; up: StepTarget } | null;
  /**
   * The work timer of a timed set (active-workout §2.7): `idle` shows
   * `Start 0:45`; `running`/`paused` count down; `ended` (reached 0 or
   * stopped) leaves the time in the field to log. Null for other sets.
   */
  workTimer: WorkTimerView | null;
  target: string | null;
  /** The set's target RPE and who set it (`@ RPE 8` on the target line); null on warm-up and drop sets. */
  targetRpe: TargetRpe | null;
  /** `Plan was 100 kg × 6–8` when a coach adjustment set this target (coach-adjustments §2.7); else null. */
  planWas: string | null;
  /** The coach action behind this set's target, for `Undo coach change`; null when the target isn't the coach's or can't be undone (gym changed since). */
  coachActionId: string | null;
  /** Who made that today-change: the coach, or the built-in rule when the coach couldn't answer (CA6 revised). */
  adjustedBy: 'coach' | 'rule' | null;
  /**
   * `SnapNote` under the target (gym-switch §2.5): only for a capped,
   * converted or dropped fit, read from `planned.snap` so it survives a relaunch.
   */
  snapNote: NoteLine | null;
  /** The target line carries `Why?` (active-workout §2.12): every set with a target; `explainTarget` fills the panel. */
  hasExplanation: boolean;
  painFlagged: boolean;
  /** Set when `painFlags` were given and one covers this exercise. */
  painFlag: PainFlagNoteView | null;
  offProfileWarning: string | null;
  /** The equipment the off-profile line opens (audit A3): fix the gym, or log anyway. */
  offProfileEquipment: { gymId: string; equipmentId: string; kind: EquipmentInstance['kind'] } | null;
  side: { kind: 'choice'; value: SetSide } | { kind: 'fixed'; value: 'left' | 'right' } | null;
  restAfterS: number;
  /** Where the rest came from (`Heavy preset (Bench press, working sets)`), shown only in the Rest after editor. */
  restSourceLabel: string;
  /** `20 bar + 25 + 10 + 2.5 / side` for the load about to be logged (barbell and plate-loaded only). */
  plateLine: string | null;
  /** Built-in warm-up ramp suggestion on the first barbell exercise's first working set; labelled and skippable. */
  warmUp: string | null;
  rows: SetRowView[];
  next: { kind: 'exercise'; name: string; target: string | null; setId: string } | { kind: 'last_set' } | null;
  /** Null when a value is missing. */
  logLabel: string | null;
  missing: 'load' | 'reps' | 'time' | 'distance' | null;
  /** Deterministic per draft, so a retry after a crash commits once. */
  opId: string;
  /** Values `log_set` will save (effort is never prefilled). */
  logValues: SetValues;
  /** `log_set.side` to send: only for unilateral sets that may change side. */
  logSide: SetSide | undefined;
}

export interface JustSavedView {
  setId: string;
  setVersion: number;
  exerciseName: string;
  setNumber: number;
  side: SetSide | null;
  /** `100 kg × 7` (the actual result), with Ben's exclusion words (`100 kg × 8 · spotted`, §2.13). */
  text: string;
  exclusions: SetExclusion[];
  rpe: number | null;
  rir: number | null;
  /** Undo opId: one per log (the set's undo count). */
  undoOpId: string;
}

export type RestView =
  | { kind: 'running'; timerId: string; timerVersion: number; remainingMs: number; deadlineUtc: string; durationS: number }
  | { kind: 'ended'; timerId: string; endedAtUtc: string | null; restedMs: number; skipped: boolean }
  | { kind: 'paused'; remainingMs: number };

export type PrimaryAction =
  | { kind: 'log'; label: string }
  /** A value is missing: the button focuses that field (audit F2), it never logs. */
  | { kind: 'enter'; label: string; field: 'load' | 'reps' | 'time' | 'distance' }
  | { kind: 'resume'; label: 'Resume' }
  /**
   * A timed set before its work timer runs (§2.7): `Start 0:45` runs
   * `start_work_interval`. `logLabel` (`Log 0:45`): the time in the field
   * can be logged without the timer (timed on the gym clock, or Start
   * forgotten; review gaps S2). Null when the set can't be logged yet.
   */
  | { kind: 'start_work'; label: string; durationS: number; logLabel: string | null }
  /** The work timer is running or paused: `Stop` runs `stop_work_interval`; the time so far becomes the draft. */
  | { kind: 'stop_work'; label: 'Stop' }
  | { kind: 'add_exercise'; label: 'Add exercise' }
  | { kind: 'finish'; label: 'Finish workout' }
  | { kind: 'none'; label: '' };

export interface ActiveSetView {
  phase: SessionPhase['kind'];
  title: string;
  sessionId: string;
  sessionVersion: number;
  elapsedMs: number;
  paused: boolean;
  focus: FocusView | null;
  rest: RestView | null;
  justSaved: JustSavedView | null;
  /** The `Still hurts?` line for the rest card, or null. */
  painReview: PainReviewPrompt | null;
  primary: PrimaryAction;
  progress: { done: number; total: number };
  /** Ordered exercises with their live set count (exercise menu, pain picker). */
  exercises: { sessionExerciseId: string; exerciseId: string; name: string; pendingSets: number; doneSets: number }[];
  lastCompletedAtUtc: string | null;
  /** Built as Ben goes (no routine or plan): all done offers `Add exercise`, not Finish (audit B1). */
  openEnded: boolean;
  /** `Set 3 · 100 kg × 6–8` (or `Incline dumbbell press · Set 1 · …`) for the Rest state's Next line. */
  upNext: string | null;
  /** `About 35 min left · ends about 19:40` (§2.15); null once all sets are done, when empty or finished. */
  timeLeft: TimeLeftView | null;
  /** Today's `Finish by` (UTC), or null when not set. */
  finishByUtc: string | null;
}

const live = (s: WorkoutSet) => s.status !== 'deleted';

/** Live sets of the exercise's whole block (all gym parts), so set numbers run across parts. */
function exerciseSets(state: SessionAggregate, exId: string): WorkoutSet[] {
  return blockSets(state, exId);
}

function equipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | null {
  return equipmentOfRow(state.session.equipmentSnapshot, ex);
}

/** The gym a part's sets are planned or done at: its item's gym, else where its targets were fitted. */
function partGymId(state: SessionAggregate, row: SessionExercise): string | null {
  const eq = equipmentOf(state, row);
  if (eq) return eq.gymId;
  return state.sets.find((s) => s.sessionExerciseId === row.id && s.planned.snap?.gymId)?.planned.snap?.gymId ?? null;
}

function sideBadge(set: WorkoutSet): string | null {
  return set.side === 'left' ? 'L' : set.side === 'right' ? 'R' : null;
}

function maxText(eq: EquipmentInstance, load: Load): string {
  const loads = getAchievableLoads(eq).loads;
  const top = loads[loads.length - 1];
  return top === undefined ? '' : loadText({ ...load, value: top }, eq.loadConvention, eq);
}

function stepWord(eq: EquipmentInstance | null): string {
  if (eq === null) return 'Maximum';
  switch (eq.kind) {
    case 'dumbbells':
      return 'Rack maximum';
    case 'weight_stack':
    case 'assisted_stack':
      return 'Stack maximum';
    case 'barbell':
    case 'plate_loaded_machine':
      return 'Plates maximum';
    case 'bodyweight_station':
      return 'Maximum';
  }
}

/** Steppers move through achievable loads only (P5, rule 4). Without equipment: 2.5 kg / 5 lb, unchecked. */
function loadSteps(value: number | null, ex: SessionExercise, eq: EquipmentInstance | null): { down: StepTarget; up: StepTarget } {
  const unit = ex.unit;
  const fmt = (v: number) => loadText({ value: v, unit, convention: ex.loadConvention }, ex.loadConvention, eq);
  if (eq !== null && eq.kind !== 'bodyweight_station') {
    const loads = getAchievableLoads(eq).loads;
    if (loads.length === 0) {
      const reason = `${eq.name} can’t make any load with its current min/max settings. Fix the equipment profile.`;
      return { down: { enabled: false, reason }, up: { enabled: false, reason } };
    }
    if (value === null) {
      const first = loads[0] ?? 0;
      return { down: { enabled: false, reason: 'No load entered' }, up: { enabled: true, value: first, label: fmt(first) } };
    }
    const up = stepLoad(value, eq, 'increase');
    const down = stepLoad(value, eq, 'decrease');
    const top = loads[loads.length - 1] ?? value;
    const bottom = loads[0] ?? value;
    return {
      up: up.ok ? { enabled: true, value: up.value, label: fmt(up.value) } : { enabled: false, reason: `${stepWord(eq)} ${fmt(top)}` },
      down: down.ok ? { enabled: true, value: down.value, label: fmt(down.value) } : { enabled: false, reason: `Minimum ${fmt(bottom)}` },
    };
  }
  const step = unit === 'kg' ? 2.5 : 5;
  const v = value ?? 0;
  const upV = Number(formatNumber(v + step));
  const downV = Number(formatNumber(v - step));
  return {
    up: { enabled: true, value: upV, label: fmt(upV) },
    down: value === null || downV < 0 ? { enabled: false, reason: 'Minimum 0' } : { enabled: true, value: downV, label: fmt(downV) },
  };
}

function repSteps(value: number | null): { down: StepTarget; up: StepTarget } {
  const v = value ?? 0;
  return {
    up: { enabled: true, value: v + 1, label: String(v + 1) },
    down: value === null || v <= 0 ? { enabled: false, reason: 'Minimum 0' } : { enabled: true, value: v - 1, label: String(v - 1) },
  };
}

function rowText(set: WorkoutSet, ex: SessionExercise, eq: EquipmentInstance | null, active: boolean): { status: SetRowStatus; text: string } {
  if (set.status === 'completed' && set.actual) {
    const v = valuesText(set.actual, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq });
    const effort = set.actual.rpe !== null ? `   RPE ${formatNumber(set.actual.rpe)}` : set.actual.rir !== null ? `   RIR ${String(set.actual.rir)}` : '';
    return { status: 'done', text: `${v}${effort}` };
  }
  if (set.status === 'skipped') return { status: 'skipped', text: 'Skipped' };
  if (active) return { status: 'active', text: 'now' };
  return { status: 'pending', text: targetShort(set.planned, { convention: ex.loadConvention, equipment: eq }) ?? 'No target' };
}

/** A done row's exclusion fields (§2.13); empty for any other row. */
export function exclusionFields(set: Pick<WorkoutSet, 'status' | 'exclusions'>): Pick<SetRowView, 'exclusions' | 'exclusionTag' | 'notCounted' | 'exclusionAccessibility'> {
  const xs = set.status === 'completed' ? normaliseExclusions(set.exclusions) : [];
  return { exclusions: xs, exclusionTag: exclusionTag(xs), notCounted: notCountedLine(xs), exclusionAccessibility: exclusionAccessibility(xs) };
}

function missingFor(values: SetValues, ex: SessionExercise): FocusView['missing'] {
  if (ex.loadConvention !== 'bodyweight' && values.load === null && ex.loadConvention !== 'added') return 'load';
  if (ex.measurement === 'reps' && values.reps === null) return 'reps';
  if (ex.measurement === 'duration' && values.durationS === null) return 'time';
  if (ex.measurement === 'distance' && (values.distanceM === null || values.distanceM === undefined)) return 'distance';
  return null;
}

export interface WorkTimerView {
  state: 'idle' | 'running' | 'paused' | 'ended';
  /** What `Start` runs: the planned time, else the draft's, else 30 s. */
  plannedS: number;
  /** Counting down (running/paused); null otherwise. */
  remainingMs: number | null;
  /** `Start 0:45` / `Stop`. */
  label: string;
}

/** Default work time when a timed set has no target or draft (active-workout §2.7). */
export const DEFAULT_WORK_S = 30;

function workTimerView(state: SessionAggregate, set: WorkoutSet, values: SetValues, nowMs: number): WorkTimerView {
  // The time in the field (Ben may change it before Start), else the target, else 30 s.
  const plannedS = values.durationS !== null && values.durationS > 0 ? values.durationS : (set.planned.durationS ?? DEFAULT_WORK_S);
  const wi = state.workInterval?.setId === set.id ? state.workInterval : null;
  if (wi?.status === 'running') return { state: 'running', plannedS: wi.durationS, remainingMs: Math.max(0, toMs(wi.deadlineUtc) - nowMs), label: 'Stop' };
  if (wi?.status === 'paused') return { state: 'paused', plannedS: wi.durationS, remainingMs: wi.remainingMsAtPause ?? 0, label: 'Stop' };
  if (wi?.status === 'completed' || wi?.status === 'stopped') return { state: 'ended', plannedS: wi.durationS, remainingMs: null, label: `Start ${formatDuration(plannedS)}` };
  return { state: 'idle', plannedS, remainingMs: null, label: `Start ${formatDuration(plannedS)}` };
}

/** Work-time steps: 5 s, from 5 s up to 4 h (no equipment involved). */
function durationSteps(value: number | null): { down: StepTarget; up: StepTarget } {
  const v = value ?? 0;
  const up = Math.min(4 * 3600, v + 5);
  return {
    up: v >= 4 * 3600 ? { enabled: false, reason: 'Maximum 4:00:00' } : { enabled: true, value: up, label: formatDuration(up) },
    down: value === null || v - 5 < 5 ? { enabled: false, reason: 'Minimum 0:05' } : { enabled: true, value: v - 5, label: formatDuration(v - 5) },
  };
}

/** Distance steps: 5 m, never below 0 (no equipment involved). */
function distanceSteps(value: number | null): { down: StepTarget; up: StepTarget } {
  const v = value ?? 0;
  const up = v + 5;
  return {
    up: { enabled: true, value: up, label: formatDistance(up) },
    down: value === null || v - 5 < 0 ? { enabled: false, reason: 'Minimum 0' } : { enabled: true, value: v - 5, label: formatDistance(v - 5) },
  };
}

function buildFocus(input: ActiveViewInput, setId: string): FocusView | null {
  const { aggregate: state } = input;
  const set = state.sets.find((s) => s.id === setId);
  if (!set || set.status !== 'pending') return null;
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (!ex) return null;
  const eq = equipmentOf(state, ex);
  const prev = input.previous[ex.id] ?? null;
  const own = exerciseSets(state, ex.id);
  const setNumber = own.findIndex((s) => s.id === set.id) + 1;

  const edits = input.edits?.setId === set.id ? input.edits : null;
  const pre = prefillDraft(state, set.id, prev?.sets ?? []);
  const covering = painFlagCovering(input.painFlags ?? [], ex.exerciseId, input.nowMs, state.session.startedAt.tz);
  const painNote: PainFlagNoteView | null = covering
    ? { flagId: covering.flag.id, flagVersion: covering.flag.version, checkDue: covering.checkDue, text: painNoteText(covering.checkDue), accessibilityLabel: painNoteAccessibility(covering.checkDue) }
    : null;
  let values: SetValues = edits ? edits.values : pre.values;
  // Effort is never prefilled; only an explicit chip sets it.
  values = { ...values, rpe: null, rir: null };
  // A bodyweight exercise has no load; `added` with nothing entered means none added.
  if (ex.loadConvention === 'bodyweight') values = { ...values, load: { value: 0, unit: ex.unit, convention: 'bodyweight' } };
  const draftSource: FocusView['draftSource'] = edits ? (edits.copied ? 'copied' : 'edited') : pre.source;

  const unilateral = ex.laterality === 'unilateral';
  const fixedSide = set.pairedWithSetId !== null && (set.side === 'left' || set.side === 'right') ? set.side : null;
  const chosenSide: SetSide | null = unilateral ? (fixedSide ?? edits?.side ?? set.side ?? 'both') : null;
  const side: FocusView['side'] = !unilateral ? null : fixedSide !== null ? { kind: 'fixed', value: fixedSide } : { kind: 'choice', value: chosenSide ?? 'both' };

  const loadLabel = loadFieldLabel(ex.loadConvention, eq);
  const loadValue = values.load === null || values.load.convention === 'bodyweight' ? null : values.load.value;
  const loadField: LoadField | null =
    loadLabel === null
      ? null
      : { label: loadLabel, unitText: loadFieldUnit(ex.unit, ex.loadConvention), value: loadValue, assisted: loadDirection(ex.loadConvention) === 'assistance', ...loadSteps(loadValue, ex, eq) };

  let offProfileWarning: string | null = null;
  let offProfileEquipment: FocusView['offProfileEquipment'] = null;
  if (eq !== null && values.load !== null && values.load.convention !== 'bodyweight' && !isLoadAchievable(values.load, eq)) {
    const max = maxText(eq, values.load);
    offProfileWarning = `Not on ${eq.name}${input.gymName ? ` at ${input.gymName}` : ''}${max === '' ? '' : ` (max ${max})`}`;
    offProfileEquipment = { gymId: eq.gymId, equipmentId: eq.id, kind: eq.kind };
  }

  const missing = missingFor(values, ex);
  const logValues: SetValues = {
    ...values,
    load: ex.loadConvention === 'added' && values.load === null ? { value: 0, unit: ex.unit, convention: 'added' } : values.load,
  };
  const labelValues = valuesText(logValues, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq, side: chosenSide });
  const logLabel = missing === null ? `Log ${labelValues}` : null;

  const order = buildExecutionOrder(state.exercises, state.sets);
  const nextId = nextPendingSet(set.id, state.exercises, state.sets);
  let next: FocusView['next'] = null;
  if (nextId === null) next = { kind: 'last_set' };
  else {
    const nextSet = state.sets.find((s) => s.id === nextId);
    const nextEx = nextSet ? state.exercises.find((e) => e.id === nextSet.sessionExerciseId) : undefined;
    // Another part of the same exercise (after a gym switch) isn't a "next exercise".
    if (nextSet && nextEx && partRootOf(state.exercises, nextEx.id) !== partRootOf(state.exercises, ex.id) && order.indexOf(nextId) > order.indexOf(set.id)) {
      next = { kind: 'exercise', name: nextEx.exerciseName, target: targetShort(nextSet.planned, { convention: nextEx.loadConvention, equipment: equipmentOf(state, nextEx) }), setId: nextId };
    }
  }

  const prevFirst = prev?.sets.find((c) => c.index === setNumber - 1) ?? prev?.sets[prev.sets.length - 1] ?? null;
  // F3 (Ben, 13 Oct): every set names its type, `Working` too (`Barbell · Working · Set 2 of 4`).
  const headerParts = [eq ? EQUIPMENT_WORD[eq.kind] : null, SET_TYPE_WORD[set.setType], `Set ${String(setNumber)} of ${String(own.length)}`, unilateral ? 'per side' : null];

  return {
    setId: set.id,
    setVersion: set.version,
    sessionExerciseId: ex.id,
    exerciseId: ex.exerciseId,
    exerciseName: ex.exerciseName,
    measurement: ex.measurement,
    unilateral,
    note: ex.note ?? null,
    swappedFrom: swappedFromOf(state, ex),
    removable: isRemovable(state, ex),
    swappable: midSwapSlot(state, ex.id) !== null,
    headerLine: headerParts.filter((p): p is string => p !== null).join(' · '),
    setTypeLabel: SET_TYPE_WORD[set.setType],
    setNumber,
    setCount: own.length,
    previous:
      prev && prevFirst
        ? {
            performedAtUtc: prev.performedAtUtc,
            // §2.13: a flagged set still shows (and copies) what happened, with its words.
            text: withExclusionWords(valuesText(prevFirst.values, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }), prevFirst.exclusions),
            values: prevFirst.values,
            imported: prev.imported,
          }
        : null,
    draft: values,
    draftSource,
    loadField,
    reps: ex.measurement === 'reps' ? { value: values.reps, ...repSteps(values.reps) } : null,
    duration: ex.measurement === 'duration' ? { value: values.durationS, ...durationSteps(values.durationS) } : null,
    distance: ex.measurement === 'distance' ? { value: values.distanceM ?? null, ...distanceSteps(values.distanceM ?? null) } : null,
    workTimer: ex.measurement === 'duration' ? workTimerView(state, set, values, input.nowMs) : null,
    target: targetText(set.planned, { convention: ex.loadConvention, equipment: eq, perSide: unilateral, rpe: targetRpeOf(set, input.ruleTargetRpe?.[ex.id] ?? null)?.rpe ?? null }),
    targetRpe: targetRpeOf(set, input.ruleTargetRpe?.[ex.id] ?? null),
    planWas: carriesTodayAdjustment(set.planned) && set.planned.coach ? planWasText(set.planned.coach.before, ex.loadConvention, eq) : null,
    coachActionId: carriesTodayAdjustment(set.planned) && set.planned.coach !== undefined && coachUndoRefusal(state, set.planned.coach.actionId) === null ? set.planned.coach.actionId : null,
    adjustedBy: carriesTodayAdjustment(set.planned) ? (set.planned.source === 'built_in_rule' ? 'rule' : 'coach') : null,
    snapNote: setSnapNote(set.planned.snap, set.planned.load, { gymName: input.gymName, equipment: eq, unit: ex.unit }),
    hasExplanation: set.planned.load !== null || set.planned.reps !== null || set.planned.durationS !== null,
    painFlagged: input.painFlagged.has(ex.exerciseId) || painNote !== null,
    painFlag: painNote,
    offProfileWarning,
    offProfileEquipment,
    side,
    restAfterS: set.rest.seconds,
    restSourceLabel: set.rest.sourceLabel,
    plateLine: plateBreakdownLine(logValues.load, eq),
    warmUp: eq !== null && showsWarmUp(state, set.id) ? warmUpText(warmUpRamp(logValues.load ?? set.planned.load, eq), eq) : null,
    rows: buildSetRows(input, ex.id, set.id),
    next,
    logLabel,
    missing,
    opId: draftOperationId(set),
    logValues,
    logSide: unilateral && fixedSide === null ? (chosenSide ?? 'both') : undefined,
  };
}

/**
 * The rows of one exercise's whole block (all gym parts, set numbers running
 * across them), as the Focus mini list and the Table view show them. One
 * source for both views, so they can't disagree on status, badges,
 * exclusions or gym captions.
 */
export function buildSetRows(input: Pick<ActiveViewInput, 'aggregate' | 'gymNames'>, sessionExerciseId: string, activeSetId: string | null): SetRowView[] {
  const state = input.aggregate;
  const ex = state.exercises.find((e) => e.id === sessionExerciseId);
  if (!ex) return [];
  const own = exerciseSets(state, ex.id);
  return own.map((s, i) => {
    const partRow = state.exercises.find((e) => e.id === s.sessionExerciseId) ?? ex;
    const { status, text } = rowText(s, partRow, equipmentOf(state, partRow), s.id === activeSetId);
    const gymId = partGymId(state, partRow);
    const prevRowId = own[i - 1]?.sessionExerciseId;
    const prevRow = prevRowId === undefined ? undefined : state.exercises.find((e) => e.id === prevRowId);
    const startsPart = prevRow !== undefined && prevRow.id !== partRow.id && gymId !== null && partGymId(state, prevRow) !== gymId;
    const gymName = gymId === null ? undefined : input.gymNames?.[gymId];
    return {
      setId: s.id,
      number: i + 1,
      badges: [SET_TYPE_BADGE[s.setType], sideBadge(s)].filter((b): b is string => b !== null),
      note: s.note ?? null,
      status,
      text,
      edited: s.edited,
      ...exclusionFields(s),
      version: s.version,
      gymCaption: status === 'done' && gymId !== null && gymId !== state.session.gymId ? (gymName ?? null) : null,
      partStart: startsPart && gymName !== undefined ? `At ${gymName}` : null,
    };
  });
}

/**
 * What an exercise's `⋯` menu and name sheet need for any card, current or
 * not (active-workout §2A.7): its next pending set (for `Target RPE` and
 * `Delete this set`), that set's undoable coach change, today's swap, and
 * the plate breakdown of every load in today's targets (barbell and
 * plate-loaded). Read from the stored state; nothing is computed anew.
 */
export interface ExerciseCardFacts {
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  note: string | null;
  /** Its next pending set (lowest index), or null when it has none. */
  nextSet: { id: string; version: number; number: number } | null;
  targetRpe: TargetRpe | null;
  coachActionId: string | null;
  adjustedBy: 'coach' | 'rule' | null;
  swappedFrom: { name: string; opId: string } | null;
  swappable: boolean;
  removable: boolean;
  /** `100 kg: 20 bar + 25 + 15 / side`, one per distinct target load in session order; empty when not plate-loaded. */
  plates: string[];
}

export function exerciseCardFacts(input: Pick<ActiveViewInput, 'aggregate' | 'ruleTargetRpe'>, sessionExerciseId: string): ExerciseCardFacts | null {
  const state = input.aggregate;
  const ex = state.exercises.find((e) => e.id === sessionExerciseId);
  if (!ex) return null;
  const own = exerciseSets(state, ex.id);
  const next = own.filter((s) => s.sessionExerciseId === ex.id && s.status === 'pending').sort((a, b) => a.index - b.index)[0];
  const today = next !== undefined && carriesTodayAdjustment(next.planned);
  const plates: string[] = [];
  const seen = new Set<string>();
  for (const s of own) {
    if (s.status === 'skipped' || s.planned.load === null) continue;
    const row = state.exercises.find((e) => e.id === s.sessionExerciseId) ?? ex;
    const eq = equipmentOf(state, row);
    const line = plateBreakdownLine(s.planned.load, eq);
    if (line === null) continue;
    const text = `${loadText(s.planned.load, row.loadConvention, eq)}: ${line}`;
    if (seen.has(text)) continue;
    seen.add(text);
    plates.push(text);
  }
  return {
    sessionExerciseId: ex.id,
    exerciseId: ex.exerciseId,
    exerciseName: ex.exerciseName,
    note: ex.note ?? null,
    nextSet: next === undefined ? null : { id: next.id, version: next.version, number: own.findIndex((s) => s.id === next.id) + 1 },
    targetRpe: next === undefined ? null : targetRpeOf(next, input.ruleTargetRpe?.[ex.id] ?? null),
    coachActionId: today && next.planned.coach !== undefined && coachUndoRefusal(state, next.planned.coach.actionId) === null ? next.planned.coach.actionId : null,
    adjustedBy: today ? (next.planned.source === 'built_in_rule' ? 'rule' : 'coach') : null,
    swappedFrom: swappedFromOf(state, ex),
    swappable: midSwapSlot(state, ex.id) !== null,
    removable: isRemovable(state, ex),
    plates,
  };
}

/** `Swapped from Bench press` while the swap can still be undone (any of its sets pending). */
function swappedFromOf(state: SessionAggregate, ex: SessionExercise): FocusView['swappedFrom'] {
  const from = ex.swappedFrom;
  if (from === undefined || !state.sets.some((s) => s.sessionExerciseId === ex.id && s.status === 'pending')) return null;
  const original = state.exercises.find((e) => e.id === from.sessionExerciseId);
  if (!original) return null;
  return { name: original.exerciseName, opId: from.opId };
}

/** Nothing logged on it and no part at another gym (the reducer refuses the rest). */
export function isRemovable(state: SessionAggregate, ex: SessionExercise): boolean {
  if (ex.removed !== undefined || ex.continuesFromId !== undefined) return false;
  if (state.exercises.some((e) => e.continuesFromId === ex.id && e.removed === undefined)) return false;
  return !state.sets.some((s) => s.sessionExerciseId === ex.id && s.status === 'completed');
}

function buildJustSaved(state: SessionAggregate): JustSavedView | null {
  const id = latestCommittedSetId(state);
  const set = id === null ? undefined : state.sets.find((s) => s.id === id);
  if (!set?.actual) return null;
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (!ex) return null;
  const eq = equipmentOf(state, ex);
  return {
    setId: set.id,
    setVersion: set.version,
    exerciseName: ex.exerciseName,
    setNumber: exerciseSets(state, ex.id).findIndex((s) => s.id === set.id) + 1,
    side: set.side,
    text: withExclusionWords(valuesText(set.actual, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }), set.exclusions),
    exclusions: normaliseExclusions(set.exclusions),
    rpe: set.actual.rpe,
    rir: set.actual.rir,
    undoOpId: `undo:${set.id}:${String(set.undoCount)}`,
  };
}

/**
 * The `Still hurts?` prompt: the just-saved set is the first set of its
 * movement logged in this workout (any set type, any of its session
 * exercises), and a flag on that movement has its check due.
 */
function buildPainReview(input: ActiveViewInput, justSaved: JustSavedView | null): PainReviewPrompt | null {
  const state = input.aggregate;
  if (justSaved === null || state.session.status !== 'active' || !input.painFlags?.length) return null;
  const set = state.sets.find((s) => s.id === justSaved.setId);
  const ex = state.exercises.find((e) => e.id === set?.sessionExerciseId);
  if (!set || !ex) return null;
  const sameMovement = new Set(state.exercises.filter((e) => e.exerciseId === ex.exerciseId).map((e) => e.id));
  const first = state.sets
    .filter((s) => sameMovement.has(s.sessionExerciseId) && s.status === 'completed' && s.completedAt)
    .sort((a, b) => toMs(a.completedAt?.utc ?? '') - toMs(b.completedAt?.utc ?? '') || a.index - b.index)[0];
  if (first?.id !== set.id) return null;
  const tz = state.session.startedAt.tz;
  const covering = painFlagCovering(input.painFlags, ex.exerciseId, input.nowMs, tz);
  if (!covering?.checkDue) return null;
  return {
    flagId: covering.flag.id,
    flagVersion: covering.flag.version,
    exerciseName: ex.exerciseName,
    afterSetId: set.id,
    question: painReviewQuestion(ex.exerciseName),
    fact: painFlagFact(covering.flag, input.nowMs, tz),
  };
}

export function buildActiveSetView(input: ActiveViewInput): ActiveSetView {
  const { aggregate: state, nowMs } = input;
  const phase = getSessionPhase(state, nowMs);
  const session = state.session;
  const liveSets = state.sets.filter(live);
  const activeId = session.activeSetId;

  let rest: RestView | null = null;
  const timer = state.restTimer;
  if (phase.kind === 'resting' && timer) {
    rest = { kind: 'running', timerId: timer.id, timerVersion: timer.version, remainingMs: phase.remainingMs, deadlineUtc: timer.deadlineUtc, durationS: timer.durationS };
  } else if (phase.kind === 'ready' && phase.restEnded) {
    rest = { kind: 'ended', timerId: phase.restEnded.timerId, endedAtUtc: phase.restEnded.endedAtUtc, restedMs: phase.restEnded.restedMs, skipped: phase.restEnded.skipped };
  } else if (phase.kind === 'paused' && phase.timerRemainingMs !== null) {
    rest = { kind: 'paused', remainingMs: phase.timerRemainingMs };
  }

  const focus = activeId !== null && session.status === 'active' ? buildFocus(input, activeId) : null;

  let primary: PrimaryAction;
  if (session.status !== 'active') primary = { kind: 'none', label: '' };
  else if (phase.kind === 'paused') primary = { kind: 'resume', label: 'Resume' };
  else if (phase.kind === 'empty') primary = { kind: 'add_exercise', label: 'Add exercise' };
  else if (focus === null) primary = isOpenEndedWorkout(state) ? { kind: 'add_exercise', label: 'Add exercise' } : { kind: 'finish', label: 'Finish workout' };
  // A timed set (§2.7): `Start 0:45` until its work timer runs, `Stop` while it runs, then `Log 0:38`.
  else if (focus.workTimer?.state === 'running' || focus.workTimer?.state === 'paused') primary = { kind: 'stop_work', label: 'Stop' };
  else if (focus.workTimer?.state === 'idle') primary = { kind: 'start_work', label: focus.workTimer.label, durationS: focus.workTimer.plannedS, logLabel: focus.logLabel };
  else if (focus.logLabel === null) {
    const field = focus.missing ?? 'reps';
    primary = { kind: 'enter', field, label: field === 'load' ? 'Enter load' : field === 'time' ? 'Enter time' : field === 'distance' ? 'Enter distance' : 'Enter reps' };
  } else primary = { kind: 'log', label: focus.logLabel };

  const completed = liveSets.filter((s) => s.status === 'completed' && s.completedAt);
  const justSaved = buildJustSaved(state);
  const last = completed.map((s) => s.completedAt?.utc ?? '').sort().at(-1) ?? null;

  return {
    phase: phase.kind,
    title: storedWorkoutName(session) ?? input.title ?? GENERIC_WORKOUT_NAME,
    sessionId: session.id,
    sessionVersion: session.version,
    elapsedMs: getActiveDurationMs(state, nowMs),
    paused: session.pause !== null,
    focus,
    rest,
    justSaved,
    painReview: buildPainReview(input, justSaved),
    primary,
    progress: { done: completed.length, total: liveSets.length },
    exercises: exerciseEntries(state, liveSets),
    lastCompletedAtUtc: last,
    openEnded: isOpenEndedWorkout(state),
    upNext: focus === null ? null : upNextLine(state, focus),
    timeLeft: input.withTimeLeft === false ? null : buildTimeLeftView(state, nowMs, input.recentPace),
    finishByUtc: session.finishBy?.utc ?? null,
  };
}

/** The Rest state's `Next · Set 3 · 100 kg × 6–8` (D-Rest). The exercise is named when it changes. */
function upNextLine(state: SessionAggregate, focus: FocusView): string {
  const lastId = latestCommittedSetId(state);
  const lastSet = lastId === null ? undefined : state.sets.find((s) => s.id === lastId);
  // A gym-switch continuation part is the same exercise (gym-switch GS6).
  const sameExercise = lastSet !== undefined && partRootOf(state.exercises, lastSet.sessionExerciseId) === partRootOf(state.exercises, focus.sessionExerciseId);
  const ex = state.exercises.find((e) => e.id === focus.sessionExerciseId);
  const eq = ex ? equipmentOf(state, ex) : null;
  const set = state.sets.find((s) => s.id === focus.setId);
  // No planned load (an exercise added with no history) but a carried load to log: the line names
  // that load with the planned reps, so the next line says what will be lifted (premium-feel §3.6, D6).
  const planned = set && set.planned.load === null && focus.draft.load !== null && (set.planned.reps !== null || set.planned.durationS !== null) ? { ...set.planned, load: focus.draft.load } : set?.planned;
  const target = planned && ex ? targetShort(planned, { convention: ex.loadConvention, equipment: eq }) : null;
  // `Target 3–6 reps` → `3–6 reps`: the label stays on the set view.
  const what = target !== null ? target.replace(/^Target /, '') : focus.logLabel === null ? null : focus.logLabel.replace(/^Log /, '');
  return [sameExercise ? null : focus.exerciseName, `Set ${String(focus.setNumber)}`, what].filter((p): p is string => p !== null).join(' · ');
}

/**
 * One entry per exercise block: an exercise split across gyms (gym-switch
 * GS6) is one entry, named by the part that has its pending sets (else its
 * last part). An empty continuation part (after an Undo) is never listed.
 */
function exerciseEntries(state: SessionAggregate, liveSets: readonly WorkoutSet[]): ActiveSetView['exercises'] {
  const out: ActiveSetView['exercises'] = [];
  const index = new Map<string, number>();
  for (const e of [...state.exercises].sort((a, b) => a.order - b.order)) {
    if (isEmptyPart(state, e) || e.removed !== undefined) continue;
    const root = partRootOf(state.exercises, e.id);
    const pending = liveSets.filter((s) => s.sessionExerciseId === e.id && s.status === 'pending').length;
    const done = liveSets.filter((s) => s.sessionExerciseId === e.id && s.status === 'completed').length;
    const at = index.get(root);
    const prior = at === undefined ? undefined : out[at];
    if (at === undefined || prior === undefined) {
      index.set(root, out.length);
      out.push({ sessionExerciseId: e.id, exerciseId: e.exerciseId, name: e.exerciseName, pendingSets: pending, doneSets: done });
      continue;
    }
    out[at] = {
      ...prior,
      sessionExerciseId: pending > 0 || prior.pendingSets === 0 ? e.id : prior.sessionExerciseId,
      pendingSets: prior.pendingSets + pending,
      doneSets: prior.doneSets + done,
    };
  }
  return out;
}

export interface SetEditView {
  setId: string;
  setVersion: number;
  exerciseName: string;
  setNumber: number;
  completedAtUtc: string | null;
  values: SetValues;
  loadField: LoadField | null;
  reps: { value: number | null; down: StepTarget; up: StepTarget } | null;
  /** Timed sets: seconds, ±5 s. */
  duration: { value: number | null; down: StepTarget; up: StepTarget } | null;
  /** Distance sets: metres, ±5 m. */
  distance: { value: number | null; down: StepTarget; up: StepTarget } | null;
  /** `100 kg × 8` for the values as edited. */
  text: string;
  /** Exclusion chips as edited (§2.13, canonical order); the stored ones when untouched. */
  exclusions: SetExclusion[];
  /** `This also puts a pain flag on Bench press: …` while `Pain` is ticked and wasn't before (AW7). */
  painLine: string | null;
  /**
   * Set type control (brief §1; backlog 4.1): one choice per type, in
   * workout order. `changed` says the type differs from the stored one, so
   * `correct_set` carries `setType` only then.
   */
  setType: { value: SetType; changed: boolean; choices: { type: SetType; label: string; selected: boolean }[] };
  /**
   * Ben's own target RPE for the set (CHANGELOG 2026-10-11 (b) "Edit set"),
   * in an active workout's working set; null otherwise. `target` is the set's
   * target as edited (`targetRpeOf`); `override` is Ben's value as edited
   * (null: none, the coach's, plan's or rule's applies).
   */
  targetRpe: { target: TargetRpe | null; override: number | null; changed: boolean } | null;
  /** Values, exclusions, the set type or the target RPE differ from the stored set: `Save changes` is enabled. */
  changed: boolean;
}

/** The set types in the order a workout uses them (Edit set's control). */
export const SET_TYPE_ORDER: readonly SetType[] = ['warmup', 'working', 'top', 'backoff', 'drop'];

export interface SetEditOptions {
  /** The set type as edited; null or undefined: the stored one. */
  setType?: SetType | null | undefined;
  /** Ben's target RPE as edited: a value, null to clear it, undefined untouched. */
  targetRpe?: number | null | undefined;
  /** The built-in rule's target RPE per session exercise (`ruleTargetRpes`), the default shown. */
  ruleTargetRpe?: Readonly<Record<string, number>> | undefined;
}

/**
 * The correction sheet for a logged set (active-workout §4.4): the same
 * equipment-aware steppers as the set card. `correct_set` saves it; the rest
 * timer is never touched (invariant 5).
 */
export function buildSetEditView(state: SessionAggregate, setId: string, edits: SetValues | null, exclusionEdits: readonly SetExclusion[] | null = null, options: SetEditOptions = {}): SetEditView | null {
  const set = state.sets.find((s) => s.id === setId);
  if (!set || set.status !== 'completed' || !set.actual) return null;
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (!ex) return null;
  const eq = equipmentOf(state, ex);
  const values = edits ?? set.actual;
  const setType = options.setType ?? set.setType;
  const stored = normaliseExclusions(set.exclusions);
  const exclusions = exclusionEdits === null ? stored : normaliseExclusions(exclusionEdits);
  const label = loadFieldLabel(ex.loadConvention, eq);
  const loadValue = values.load === null || values.load.convention === 'bodyweight' ? null : values.load.value;
  const storedOverride = set.planned.rpeOverride ?? null;
  const override = options.targetRpe === undefined ? storedOverride : options.targetRpe;
  // The type as edited: a set changed to a warm-up or drop has no target (its override is cleared with the correction).
  const working = setType !== 'warmup' && setType !== 'drop';
  const plannedAsEdited = { ...set.planned, rpeOverride: override ?? undefined };
  const targetRpe =
    state.session.status === 'active' && working
      ? { target: targetRpeOf({ setType, planned: plannedAsEdited }, options.ruleTargetRpe?.[ex.id] ?? null), override, changed: override !== storedOverride }
      : null;
  return {
    setId: set.id,
    setVersion: set.version,
    exerciseName: ex.exerciseName,
    setNumber: exerciseSets(state, ex.id).findIndex((s) => s.id === set.id) + 1,
    completedAtUtc: set.completedAt?.utc ?? null,
    values,
    loadField:
      label === null
        ? null
        : { label, unitText: loadFieldUnit(ex.unit, ex.loadConvention), value: loadValue, assisted: loadDirection(ex.loadConvention) === 'assistance', ...loadSteps(loadValue, ex, eq) },
    reps: ex.measurement === 'reps' ? { value: values.reps, ...repSteps(values.reps) } : null,
    duration: ex.measurement === 'duration' ? { value: values.durationS, ...durationSteps(values.durationS) } : null,
    distance: ex.measurement === 'distance' ? { value: values.distanceM ?? null, ...distanceSteps(values.distanceM ?? null) } : null,
    text: valuesText(values, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }),
    exclusions,
    painLine: exclusions.includes('pain') && !stored.includes('pain') ? exclusionPainLine(ex.exerciseName) : null,
    setType: { value: setType, changed: setType !== set.setType, choices: SET_TYPE_ORDER.map((t) => ({ type: t, label: SET_TYPE_WORD[t], selected: t === setType })) },
    targetRpe,
    changed: JSON.stringify(values) !== JSON.stringify(set.actual) || exclusions.join() !== stored.join() || setType !== set.setType || (targetRpe?.changed ?? false),
  };
}

/** `Plan was 100 kg × 6–8` (the target a coach adjustment replaced). */
function planWasText(before: WorkoutSet['planned'], convention: SessionExercise['loadConvention'], eq: EquipmentInstance | null | undefined): string | null {
  const short = targetShort({ ...before, source: undefined }, { convention, ...(eq ? { equipment: eq } : {}) });
  return short === null ? null : short.replace(/^Target /, 'Plan was ');
}

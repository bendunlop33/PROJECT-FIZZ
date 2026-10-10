import type { EquipmentInstance, Load, PainFlag, SessionAggregate, SessionExercise, SetExclusion, SetSide, SetValues, WorkoutSet } from '@fizz/schemas';
import {
  EQUIPMENT_WORD,
  SET_TYPE_BADGE,
  SET_TYPE_WORD,
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
import type { HistorySession } from '../progression';
import { toMs } from '../time';
import { buildExecutionOrder, nextPendingSet } from './order';
import { GENERIC_WORKOUT_NAME, isOpenEndedWorkout, storedWorkoutName } from './first-run';
import { latestCommittedSetId } from './reducer';
import { buildTimeLeftView, type PaceSamples, type TimeLeftEstimate, type TimeLeftLineView } from './time-left';
import { draftOperationId, getActiveDurationMs, getSessionPhase, prefillDraft, type ComparableSet, type DraftSource, type SessionPhase } from './view';

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
  /** Working-order sets as logged, for prefill and the `Last (…)` line. */
  sets: ComparableSet[];
}

/**
 * Pick the most recent history session that is like-for-like with this
 * session exercise: same equipment instance, and every load in the same unit
 * and convention (history in another unit or convention is never offered).
 * Imported (FitNotes) history is never offered while P-I3 is open, even when
 * neither side has equipment (review r2 B1).
 */
export function lastComparableSession(history: readonly HistorySession[], ex: Pick<SessionExercise, 'equipmentId' | 'unit' | 'loadConvention'>): PreviousSession | null {
  const sorted = [...history].sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
  for (const h of sorted) {
    if (h.imported || h.equipmentId !== ex.equipmentId) continue;
    const sets = h.sets.filter((s) => s.setType !== 'warmup');
    if (sets.length === 0) continue;
    const alike = sets.every((s) => s.load === null || s.load.convention === 'bodyweight' || (s.load.unit === ex.unit && s.load.convention === ex.loadConvention));
    if (!alike) continue;
    return {
      sessionId: h.sessionId,
      performedAtUtc: h.performedAtUtc,
      gymId: h.gymId,
      sets: sets.map((s, index) => ({
        index,
        values: { load: s.load, reps: s.reps, durationS: null, rpe: s.rpe, rir: s.rir },
        ...(s.exclusions && s.exclusions.length > 0 ? { exclusions: s.exclusions } : {}),
      })),
    };
  }
  return null;
}

/** Unsaved changes held by the screen (debounced to `save_draft`). */
export interface DraftEdits {
  setId: string;
  values: SetValues;
  side?: SetSide;
  /** Set by "copy last time" (`Copied from 1 Oct`). */
  copied?: boolean;
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
   * Ben's pain flags (active ones are enough), for the note's `check due`
   * and the rest card's `Still hurts?` line (active-workout §2.14.2). Dates
   * are read in the workout's zone.
   */
  painFlags?: readonly PainFlag[];
  edits: DraftEdits | null;
  /** A derived name (`Push`) for a workout without one (audit F5); the stored name wins. */
  title?: string | null;
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
}

export interface FocusView {
  setId: string;
  setVersion: number;
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  measurement: 'reps' | 'duration';
  unilateral: boolean;
  /** `Barbell · Set 2 of 4`, `Barbell · Warm-up · Set 1 of 4` (+ ` · per side`). */
  headerLine: string;
  setNumber: number;
  setCount: number;
  previous: { performedAtUtc: string; text: string; values: SetValues } | null;
  draft: SetValues;
  draftSource: DraftSource | 'edited' | 'copied';
  loadField: LoadField | null;
  reps: { value: number | null; down: StepTarget; up: StepTarget } | null;
  duration: { value: number | null } | null;
  target: string | null;
  /** The target line carries `Why?` (active-workout §2.12): every set with a target; `explainTarget` fills the panel. */
  hasExplanation: boolean;
  painFlagged: boolean;
  /** Set when `painFlags` were given and one covers this exercise. */
  painFlag: PainFlagNoteView | null;
  offProfileWarning: string | null;
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
  missing: 'load' | 'reps' | 'time' | null;
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
  | { kind: 'enter'; label: string; field: 'load' | 'reps' | 'time' }
  | { kind: 'resume'; label: 'Resume' }
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

function exerciseSets(state: SessionAggregate, exId: string): WorkoutSet[] {
  const order = buildExecutionOrder(state.exercises, state.sets);
  const pos = new Map(order.map((id, i) => [id, i]));
  return state.sets
    .filter((s) => s.sessionExerciseId === exId && live(s))
    .sort((a, b) => (pos.get(a.id) ?? a.index + 1e6) - (pos.get(b.id) ?? b.index + 1e6));
}

function equipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | null {
  return ex.equipmentId === null ? null : (state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
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
  return null;
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
  if (eq !== null && values.load !== null && values.load.convention !== 'bodyweight' && !isLoadAchievable(values.load, eq)) {
    const max = maxText(eq, values.load);
    offProfileWarning = `${loadText(values.load, ex.loadConvention, eq)} isn’t on ${eq.name}${input.gymName ? ` at ${input.gymName}` : ''}${max === '' ? '' : ` (max ${max})`}. Log it anyway if that’s what you lifted, or update the gym.`;
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
    if (nextSet && nextEx && nextEx.id !== ex.id && order.indexOf(nextId) > order.indexOf(set.id)) {
      next = { kind: 'exercise', name: nextEx.exerciseName, target: targetShort(nextSet.planned, { convention: nextEx.loadConvention, equipment: equipmentOf(state, nextEx) }), setId: nextId };
    }
  }

  const prevFirst = prev?.sets.find((c) => c.index === setNumber - 1) ?? prev?.sets[prev.sets.length - 1] ?? null;
  // `Working` is the usual case, so only other set types are named (D-ActiveSet: `Barbell · Set 2 of 4`).
  const headerParts = [eq ? EQUIPMENT_WORD[eq.kind] : null, set.setType === 'working' ? null : SET_TYPE_WORD[set.setType], `Set ${String(setNumber)} of ${String(own.length)}`, unilateral ? 'per side' : null];

  return {
    setId: set.id,
    setVersion: set.version,
    sessionExerciseId: ex.id,
    exerciseId: ex.exerciseId,
    exerciseName: ex.exerciseName,
    measurement: ex.measurement,
    unilateral,
    headerLine: headerParts.filter((p): p is string => p !== null).join(' · '),
    setNumber,
    setCount: own.length,
    previous:
      prev && prevFirst
        ? {
            performedAtUtc: prev.performedAtUtc,
            // §2.13: a flagged set still shows (and copies) what happened, with its words.
            text: withExclusionWords(valuesText(prevFirst.values, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }), prevFirst.exclusions),
            values: prevFirst.values,
          }
        : null,
    draft: values,
    draftSource,
    loadField,
    reps: ex.measurement === 'reps' ? { value: values.reps, ...repSteps(values.reps) } : null,
    duration: ex.measurement === 'duration' ? { value: values.durationS } : null,
    target: targetText(set.planned, { convention: ex.loadConvention, equipment: eq, perSide: unilateral }),
    hasExplanation: set.planned.load !== null || set.planned.reps !== null || set.planned.durationS !== null,
    painFlagged: input.painFlagged.has(ex.exerciseId) || painNote !== null,
    painFlag: painNote,
    offProfileWarning,
    side,
    restAfterS: set.rest.seconds,
    restSourceLabel: set.rest.sourceLabel,
    plateLine: plateBreakdownLine(logValues.load, eq),
    warmUp: eq !== null && showsWarmUp(state, set.id) ? warmUpText(warmUpRamp(logValues.load ?? set.planned.load, eq), eq) : null,
    rows: own.map((s, i) => {
      const { status, text } = rowText(s, ex, eq, s.id === set.id);
      return {
        setId: s.id,
        number: i + 1,
        badges: [SET_TYPE_BADGE[s.setType], sideBadge(s)].filter((b): b is string => b !== null),
        status,
        text,
        edited: s.edited,
        ...exclusionFields(s),
        version: s.version,
      };
    }),
    next,
    logLabel,
    missing,
    opId: draftOperationId(set),
    logValues,
    logSide: unilateral && fixedSide === null ? (chosenSide ?? 'both') : undefined,
  };
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
  else if (focus.logLabel === null) {
    const field = focus.missing ?? 'reps';
    primary = { kind: 'enter', field, label: field === 'load' ? 'Enter load' : field === 'time' ? 'Enter time' : 'Enter reps' };
  }
  else primary = { kind: 'log', label: focus.logLabel };

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
    exercises: [...state.exercises]
      .sort((a, b) => a.order - b.order)
      .map((e) => ({
        sessionExerciseId: e.id,
        exerciseId: e.exerciseId,
        name: e.exerciseName,
        pendingSets: liveSets.filter((s) => s.sessionExerciseId === e.id && s.status === 'pending').length,
        doneSets: liveSets.filter((s) => s.sessionExerciseId === e.id && s.status === 'completed').length,
      })),
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
  const sameExercise = lastSet?.sessionExerciseId === focus.sessionExerciseId;
  const ex = state.exercises.find((e) => e.id === focus.sessionExerciseId);
  const eq = ex ? equipmentOf(state, ex) : null;
  const set = state.sets.find((s) => s.id === focus.setId);
  // No planned load (an exercise added with no history) but a carried load to log: the line names
  // that load with the planned reps, so the next line says what will be lifted (premium-feel §3.6, D6).
  const planned = set && set.planned.load === null && focus.draft.load !== null && (set.planned.reps !== null || set.planned.durationS !== null) ? { ...set.planned, load: focus.draft.load } : set?.planned;
  const target = planned && ex ? targetShort(planned, { convention: ex.loadConvention, equipment: eq }) : null;
  // `Target (built-in rule) 3–6 reps` → `3–6 reps`: the label stays on the set view.
  const what = target !== null ? target.replace(/^Target (\([^)]*\) )?/, '') : focus.logLabel === null ? null : focus.logLabel.replace(/^Log /, '');
  return [sameExercise ? null : focus.exerciseName, `Set ${String(focus.setNumber)}`, what].filter((p): p is string => p !== null).join(' · ');
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
  /** `100 kg × 8` for the values as edited. */
  text: string;
  /** Exclusion chips as edited (§2.13, canonical order); the stored ones when untouched. */
  exclusions: SetExclusion[];
  /** `This also puts a pain flag on Bench press: …` while `Pain` is ticked and wasn't before (AW7). */
  painLine: string | null;
  /** Values or exclusions differ from the stored set: `Save changes` is enabled. */
  changed: boolean;
}

/**
 * The correction sheet for a logged set (active-workout §4.4): the same
 * equipment-aware steppers as the set card. `correct_set` saves it; the rest
 * timer is never touched (invariant 5).
 */
export function buildSetEditView(state: SessionAggregate, setId: string, edits: SetValues | null, exclusionEdits: readonly SetExclusion[] | null = null): SetEditView | null {
  const set = state.sets.find((s) => s.id === setId);
  if (!set || set.status !== 'completed' || !set.actual) return null;
  const ex = state.exercises.find((e) => e.id === set.sessionExerciseId);
  if (!ex) return null;
  const eq = equipmentOf(state, ex);
  const values = edits ?? set.actual;
  const stored = normaliseExclusions(set.exclusions);
  const exclusions = exclusionEdits === null ? stored : normaliseExclusions(exclusionEdits);
  const label = loadFieldLabel(ex.loadConvention, eq);
  const loadValue = values.load === null || values.load.convention === 'bodyweight' ? null : values.load.value;
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
    text: valuesText(values, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }),
    exclusions,
    painLine: exclusions.includes('pain') && !stored.includes('pain') ? exclusionPainLine(ex.exerciseName) : null,
    changed: JSON.stringify(values) !== JSON.stringify(set.actual) || exclusions.join() !== stored.join(),
  };
}

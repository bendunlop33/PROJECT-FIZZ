import {
  activeWeekPlan,
  plusSetType,
  avoidLegDays,
  isLegDay,
  legRunNear,
  weekDays,
  type LegRunNear,
  addDays,
  cardioRepeatTargets,
  buildPlannedSetEditView,
  restSetsView,
  setGlance,
  setNavigation,
  snapTypedLoadEasier,
  workoutChatContext,
  type ComparableSet,
  type PlannedSetEdits,
  type PlannedSetEditView,
  type SetGlance,
  type SetNavigation,
  draftHeadNote,
  draftReasonLine,
  formatLoad,
  historyUsedOf,
  loadPanelLine,
  loadWhyEntry,
  type DraftSlotWhy,
  type HistoryUsed,
  matchSplitDay,
  splitInUse,
  SPLIT_WINDOW_DAYS,
  splitWorkoutOf,
  splitDaysByDue,
  isSplitDayName,
  splitDaySource,
  planRoutines,
  planRoutineForSplitDay,
  activePause,
  planDayBodyParts,
  planDayGroups,
  planDaysAhead,
  planDayPick,
  planDaysByDue,
  activePin,
  type PlanAheadDay,
  type PlanDueWorkout,
  workoutGroupsOf,
  planFirstLoads,
  plannedVsDone,
  type PlannedVsDone,
  splitDaysTrained,
  cutShort,
  baseWorkoutName,
  type SplitWorkout,
  workoutMuscleGroups,
  type LoadWhyEntry,
  type OverviewRow,
  coachDraftIsOpen,
  coachDraftListed,
  currentDraftVersion,
  discardWorkoutDraft,
  draftAsRoutine,
  draftCardState,
  draftName,
  linkDraftRoutine,
  restoreWorkoutDraft,
  undoDraftVersion,
  type DraftCardState,
  type DraftLifeChange,
  withoutTodayOnlySets,
  liveExercises,
  buildSwapExerciseCommand,
  midSwapSlot,
  swapPainCarry,
  applyCheckInPatch,
  supersetPartners,
  supersetPartnerSets,
  type SupersetPartner,
  buildActiveSetView,
  buildWorkoutTableView,
  exerciseCardFacts,
  buildLiftHighlight,
  buildAddSetContinuation,
  buildGymSwitchProposal,
  gymRouteIds,
  doneExerciseNames,
  changeGymCommand,
  currentGymEquipment,
  equipmentOfRow,
  lastUsedAtGym,
  buildPainFlagSheet,
  buildSetEditView,
  planExclusionMark,
  buildTodayView,
  buildWorkoutSummary,
  defaultStartingPlan,
  deriveWorkoutTitle,
  GENERIC_WORKOUT_NAME,
  storedWorkoutName,
  muscleSummary,
  clearPainFlag,
  restorePainFlag,
  retractPainFlag,
  createSessionService,
  deriveId,
  DEFAULT_CHECK_IN_SETTINGS,
  explainTarget,
  lastComparableSession,
  lastWorkingLoad,
  workingSetsFromPrevious,
  localDateOf,
  localWeekBounds,
  mayHurtAccessibility,
  mayHurtConfirm,
  newCheckIn,
  newPainFlag,
  nextTargetBlocks,
  nextTargetsFor,
  nextTargetsForBlock,
  painFlagCovering,
  painKeptText,
  painProfessionalNudge,
  recordPainFlagReview,
  undoPainFlagReview,
  plannedSetsFromTargets,
  repeatPreviewLines,
  targetSummaryLines,
  unspecifiedPain,
  painStatusFor,
  withCoachTargets,
  acceptedRuleResets,
  coachTargetRows,
  type NextTargetEntry,
  equipmentForExercise,
  missingStations,
  searchExercises,
  defaultSlotShape,
  shapeAddPlan,
  type AddShape,
  type SlotShapeInput,
  offersCheckInInWorkout,
  discardCommand,
  discardConfirmation,
  shouldAskCheckIn,
  toIso,
  toMs,
  weekdayOf,
  findSetRecord,
  estimateRemainingDuration,
  checkRoutineName,
  deleteRoutine,
  isFromRoutine,
  liveRoutines,
  builderSetupOf,
  nextInRotation,
  nextTargetSourceBasis,
  renameRoutine,
  restoreRoutine,
  routineCounts,
  routineFromSession,
  notSavedFromSession,
  notSavedFromPlan,
  mergeNotCopied,
  notCopiedText,
  routineLastDone,
  ruleTargetRpes,
  type RuleExerciseInfo,
  type ExerciseCardFacts,
  type FinishedRef,
  type RoutineChange,
  type RoutineNameCheck,
  buildTimeLeftView,
  buildWorkoutOverview,
  applyDraftCommand,
  basisSlots,
  doableHere,
  draftBasisKey,
  draftIsLive,
  overviewTodayOf,
  planPace,
  benEditedSlots,
  coachFitDraftEdits,
  fitMinutesOf,
  fitPlanOf,
  FIT_REFUSAL_WORDS,
  PACE_SOURCE_LABEL,
  validateTodayFit,
  fitShortens,
  validFitMinutes,
  type AddCheck,
  type SwapCheck,
  editedSlots,
  liveEdits,
  moveSlot,
  pruneOf,
  rankSubstitutions,
  resolveTodayEdits,
  substituteSlotOf,
  substituteTargets,
  swapTargetText,
  swapRoutineSlot,
  addTargets,
  NBSP,
  fixedLoadSteps,
  type StepTarget,
  addedSlotShape,
  applyEditsToRoutine,
  equipmentHere,
  rankAddCandidates,
  substituteRow,
  templateLinesFromEdits,
  todayLoadNote,
  todayShapes,
  type ShapeEditKind,
  type TemplateLine,
  type TodayEditBody,
  type DraftCommand,
  type EditOutcome,
  type OverviewToday,
  type SubstituteRow,
  type SwapPlan,
  type TodayEditsInput,
  type TodayPlanInfo,
  pastExercisesOf,
  previewKey,
  previewFence,
  type OverviewBasis,
  type PastExercise,
  type PreviewKeyParts,
  type SetFit,
  type WorkoutOverview,
  type WriteFence,
  type AlongsideRefusal,
  type StartAlongside,
  type ResolvedPace,
  recentPaceSamples,
  timeLeftSheet,
  timeFitOffer,
  fitTodayCommand,
  builderInfoOf,
  type BuilderExerciseInfo,
  type WarmupExerciseFacts,
  type TimeFitOffer,
  type ActiveSetView,
  type WorkoutTableView,
  type SetEditView,
  type SetRecord,
  type SetRecordInput,
  type CheckInGate,
  type CheckInPatch,
  type CommandOutcome,
  type DraftEdits,
  type GymSwitchProposal,
  type HistorySession,
  type SubstituteContext,
  type PainFlagSheetView,
  type PreviousSession,
  type RecentCheckIn,
  type StartOutcome,
  type LiftHighlight,
  type TargetExplanation,
  type TodayView,
  type PaceSamples,
  type TimeLeftSheetView,
  type TimeLeftView,
  type WorkoutSummary,
  type CoachStatus,
  groupSessionTypes,
  orderSessionTypes,
  routineTypeKey,
  buildLibraryView,
  createRoutine,
  withSaveEdit,
  duplicateRoutine,
  editableExercises,
  editableEdit,
  editRoutine,
  planRoutineStart,
  planSettingsOfRoutine,
  isArchivedExercise,
  isDeleted,
  rotationOrder,
  rotationRoutines,
  routineChangeLines,
  routineFromPlan,
  routineGymIssues,
  sameMovementIds,
  saveSheetDetail,
  setRoutineRotation,
  unnamedWorkoutName,
  type LibrarySort,
  type LibraryView,
  type RoutineEdit,
  SESSION_PICKER_DECISIONS,
  longestGapSource,
  type SessionType,
  type SessionTypeKind,
  type NotCopied,
  isInHistory,
  leftOutCount,
  draftSavedRoutineId,
  shownRationale,
  secondaryMainLifts,
  type RuleReps,
  type HistoryLike,
  type HistoryWorkout,
} from '@fizz/domain';
import type { SqliteRepositories, Store } from '@fizz/persistence';
import { worksLine } from '@fizz/schemas';
import type { TodayFitAnswer, TodayFitContext } from '@fizz/coach';
import type {
  GymStation,
  Load,
  LoadConvention,
  WeightUnit,
  ActionRecord,
  DraftBasis,
  PreStartDraft,
  CheckIn,
  CheckInScore,
  CheckInSettings,
  EquipmentInstance,
  Gym,
  Exercise,
  NextSessionTargetRecord,
  PainArea,
  PainFlag,
  PlannedSet,
  ProgressionRule,
  Routine,
  RoutineExercise,
  RestSetting,
  SessionAggregate,
  SessionCheckIn,
  SessionPlanDay,
  SessionCommand,
  SetExclusion,
  SetType,
  SetValues,
  SplitDay,
  TrainingProfile,
  PlanPin,
  TrainingSplit,
  UserProfile,
  WorkoutDraft,
  ZonedTimestamp,
  WeekPlan,
  SplitBodyPart,
} from '@fizz/schemas';

import { undoOpId, undoRefusalText } from '../workout/undo-op';
import { setActivePainFlagged } from '../workout/pain-flagged';
import { deloadAtOf } from './deload-at';

/** A past workout's title when it has no exercise (`Finish anyway` with nothing added). */
export const EMPTY_WORKOUT_TITLE = 'Empty workout';

/**
 * Services for the workout loop (Today → check-in → Active set → Rest →
 * Summary). In-process, local, no AI and no network. Screens call these; the
 * rules live in `@fizz/domain`. Every write is idempotent by an operation ID
 * chosen by the screen once per intent, and versioned where it edits.
 */
export interface WorkoutServicesContext {
  /**
   * Check-in settings (check-in.md §2.8). Not persisted yet (no settings screen): absent, the
   * defaults (`DEFAULT_CHECK_IN_SETTINGS`, `Only when I choose` since Ben, 23 Oct). Tests pass others.
   */
  checkInSettings?: () => CheckInSettings;
  repos: () => SqliteRepositories;
  store: () => Store;
  now: () => ZonedTimestamp;
  newId: () => string;
  profile: () => Promise<UserProfile | null>;
  /** Runs after every committed session command (backups, alerts). Never awaited by the caller's write. */
  afterCommand: (outcome: CommandOutcome) => CommandOutcome;
  /** Runs after a workout starts (the Lock Screen Live Activity shows Ready). Never awaited. */
  afterStart?: (aggregate: SessionAggregate) => void;
  /** The bundled catalogue as exercise rows (read on first use). Absent: the picker shows the database only. */
  catalogueExercises?: () => readonly Exercise[];
  /** A catalogue entry's substitutions (`variations.substitutions[].key`), in catalogue order (Coaching knowledge). Absent: none. */
  catalogueSubstitutions?: (catalogueKey: string) => readonly (string | null)[];
  /** A catalogue entry's other names (Coaching knowledge), for search (EL1). Absent: none. */
  catalogueAliases?: (catalogueKey: string) => readonly string[];
  /**
   * The coach's fit request (fit-to-time §5; `coach.fitToday`): one model
   * call with the context given, nothing written. Null: the coach can't be
   * reached (no provider call). Absent: not in this build's wiring.
   */
  coachFit?: (context: TodayFitContext, signal?: AbortSignal) => Promise<TodayFitAnswer | null>;
}

/** `Ask coach` on `How long?` (fit-to-time §6): what came of it. Nothing is written unless `applied`. */
export type CoachFitOutcome =
  | { kind: 'applied'; actionId: string; draft: PreStartDraft | null; duplicate: boolean }
  /** Every edit the coach sent failed the checks: nothing changed (`Couldn't use the coach's version`). */
  | { kind: 'rejected'; reasons: string[] }
  /** No answer in time (`timing.coachTimeout`). */
  | { kind: 'timeout' }
  /** The page (draft, targets, gym) moved while the coach worked: the answer is discarded (`Plan changed`). */
  | { kind: 'plan_changed' }
  /** Not connected, paused or offline: no provider call (`Coach offline`). */
  | { kind: 'unavailable' }
  | { kind: 'cancelled' }
  | { kind: 'failed' };

/** `Why?` on the coach's fit card (fit-to-time §7.2): the checks it passed, as app text. */
export const FIT_CHECKS = {
  unchanged: 'Loads and rest unchanged.',
  own: 'Added from your own exercises.',
  dropped: (n: number) => `${String(n)} ${n === 1 ? 'change' : 'changes'} not used.`,
} as const;

/** `Undo` on the coach's fit card (§5.3). */
export type CoachFitUndoOutcome = { ok: true; draft: PreStartDraft | null } | { ok: false; reason: 'changed_since' | 'missing' | 'failed' };

/** What the overview shows about the live coach fit (`Why?`, the swap suggestions), from its record. */
export interface CoachFitInfo {
  actionId: string;
  reason: string | null;
  /** The checks it passed, as app text (`Loads and rest unchanged.`). */
  checks: string[];
  /** Edits the checks refused, as app text. */
  rejected: string[];
  /** Swaps offered as a `Today only` card (never applied without Apply); ones already applied are left out. */
  suggestions: { slotKey: string; toExerciseId: string; text: string }[];
}

export type CheckInWrite = { ok: true; checkIn: CheckIn; duplicate: boolean } | { ok: false; message: string; stale?: boolean };

/** What the exercise picker offers: rep, timed (active-workout §2.7) and distance exercises (ADR 0011). */
export const PICKER_MEASUREMENTS: ReadonlySet<Exercise['measurement']> = new Set(['reps', 'duration', 'distance', 'cardio']);

const CHECK_IN_WRITE_FAILED = 'Check-in not saved';
const RECENT_WINDOW_MS = 3 * 60 * 60 * 1000;
/** Said on the workout when "Start next session" couldn't work out targets (review S2). */
/** See `recordContext`. */
export interface RecordContext {
  setId: string;
  sessionExerciseId: string;
  base: Omit<SetRecordInput, 'set' | 'earlierToday'>;
}

function recordFromContext(context: RecordContext, aggregate: SessionAggregate, setId: string): SetRecord | null | undefined {
  const set = aggregate.sets.find((s) => s.id === setId);
  const ex = set ? aggregate.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
  if (!set || !ex) return null;
  if (context.setId !== setId || context.sessionExerciseId !== ex.id || context.base.equipmentId !== ex.equipmentId || context.base.convention !== ex.loadConvention) return undefined;
  if (set.status !== 'completed' || set.actual === null) return null;
  const earlierToday = aggregate.sets
    .filter((s) => s.id !== set.id && s.sessionExerciseId === ex.id && s.status === 'completed' && s.actual !== null && (s.completedAt?.utc ?? '') <= (set.completedAt?.utc ?? ''))
    .map((s) => ({ setType: s.setType, side: s.side, load: s.actual?.load ?? null, reps: s.actual?.reps ?? null, rpe: null, rir: null, ...(s.exclusions ? { exclusions: s.exclusions } : {}) }));
  return findSetRecord({ ...context.base, set: { setType: set.setType, load: set.actual.load, reps: set.actual.reps, ...(set.exclusions ? { exclusions: set.exclusions } : {}) }, earlierToday });
}

export const TARGETS_UNAVAILABLE = 'Using last time’s numbers.';

/** `notice`: something the workout screen should say once on opening (a toast). */
export type WorkoutStartOutcome =
  | (Extract<StartOutcome, { ok: true }> & { notice?: string })
  | Extract<StartOutcome, { ok: false }>
  /** The overview's `expectedPreviewKey` no longer matches: nothing was created (workout-overview §7, rule 5). */
  | { ok: false; error: { code: 'stale_preview'; message: string; /** (Builder v3) The template or variation write was refused; nothing was created. */ alongside?: AlongsideRefusal } };
/** How far back to look for Ben's last 5 finished workouts (pace for `Time left`). Older ones fall back to `Default`. */
const RECENT_PACE_WINDOW_MS = 90 * 86_400_000;

export interface PickerExercise {
  exercise: Exercise;
  /** Catalogue aliases and Ben's own (FitNotes) names, for search (EL1). */
  aliases: readonly string[];
  /** Compatible equipment at this workout's gym. Empty = none needed (bodyweight) or none there (loads not checked). */
  equipment: Pick<EquipmentInstance, 'id' | 'name' | 'kind'>[];
  /** (ADR 0030) The bench or rack this gym has none of, when that's why `equipment` is empty (`Needs a rack`). */
  needs: GymStation[];
  /**
   * `⚠ May hurt` (exercise-library EL9, active-workout §2.14.1): an active
   * pain flag covers this exercise (never a similar movement, CM5). The row
   * is never hidden; tapping it asks `confirm` before anything is added.
   */
  mayHurt: { flagId: string; accessibilityLabel: string; confirm: ReturnType<typeof mayHurtConfirm> } | null;
}

/** `Still hurts` (active-workout §2.14.2): versioned and idempotent. Never clears a flag. */
export type PainReviewWrite =
  | {
      ok: true;
      flag: PainFlag;
      /** The answer's operation, for Undo. */
      reviewOpId: string;
      /** `Pain flag kept · next check 3 Nov`. */
      kept: string;
      /** From the second `Still hurts` in a row: the physio-or-doctor line. */
      nudge: string | null;
      duplicate: boolean;
    }
  | { ok: false; reason: 'not_found' | 'not_active' | 'not_due' | 'stale' | 'failed'; message: string };

/**
 * `correctSet` from the correction sheet (active-workout §4.4, §2.13). On
 * success, `undo` is what the toast's Undo sends back to `undoMark`.
 */
export type SetCorrectionWrite =
  | {
      ok: true;
      aggregate: SessionAggregate;
      duplicate: boolean;
      /** `Set 2: spotted · not counted for records`; null when the exclusions didn't change. */
      toast: string | null;
      /**
       * Present when the exclusions changed: the flags before, the set version
       * the mark produced, and any pain flag the same save set, at the version
       * the save left it (Undo retracts it only if nothing changed it since).
       */
      undo: { setId: string; setVersion: number; previous: SetExclusion[]; painFlags: PainFlagRef[] } | null;
    }
  | { ok: false; stale: boolean; message: string };

/** A pain flag at the version an action left it: what an Undo may retract. */
export interface PainFlagRef {
  id: string;
  version: number;
}

/** `retract`: `stale` lists flags that changed since and were left as they are. */
export type PainRetractWrite = { ok: true; stale: string[] } | { ok: false; message: string };

export type PainClearWrite = { ok: true; cleared: { id: string; version: number } | null } | { ok: false; stale: boolean; message: string };

export interface RepeatCandidate {
  sessionId: string;
  /** The session version the row was read at: what Delete sends as `expectedVersion` (rule 5). */
  version: number;
  title: string;
  startedAtUtc: string;
  tz: string;
  /** Imported (FitNotes) workouts have a date only. */
  localDate: string | null;
  source: 'manual' | 'import';
  gymId: string | null;
  gymName: string;
  exerciseNames: string[];
  sets: number;
}

/**
 * Past workouts for Repeat; `unreadable` counts records skipped because they
 * failed to decode. Imported (FitNotes) workouts are candidates too (B7).
 */
export interface RepeatCandidates {
  rows: RepeatCandidate[];
  unreadable: number;
}

export interface RepeatPreview {
  /** The workout's name (or the derived title, `Push`), prefilled in `Save as routine`. */
  title: string;
  exercises: { exerciseName: string; equipmentName: string | null; line: string }[];
  notes: { exerciseName: string; text: string; tone: 'info' | 'warning' }[];
  notCopied: NotCopied[];
  sourceGymId: string | null;
  sourceStartedAtUtc: string;
  tz: string;
}

/** The built-in rule's target RPE per session exercise (`ruleTargetRpes`), from the loaded exercise info. */
function ruleRpes(data: ActiveWorkoutData): Record<string, number> {
  const info = data.exerciseInfo ?? {};
  return ruleTargetRpes(data.aggregate, (id) => (id in info ? (info[id] ?? null) : undefined));
}

export interface ActiveWorkoutData {
  aggregate: SessionAggregate;
  gymName: string | null;
  /** Every gym's name by ID (a workout can use two after a switch: dividers, captions). */
  gymNames: Record<string, string>;
  previous: Record<string, PreviousSession | null>;
  painFlagged: Set<string>;
  /** Active pain flags: the note's `check due` and the rest card's `Still hurts?` (§2.14.2). */
  painFlags: PainFlag[];
  effortScale: UserProfile['effortScale'];
  checkIn: CheckIn | null;
  /** `Push`, from the exercises, for a workout without a name (audit F5). */
  title: string | null;
  /** Pace samples from Ben's last finished workouts, for `Time left` (active-workout §2.15.2). */
  recentPace: PaceSamples;
  /**
   * Catalogue info per exercise ID (null: none), for the built-in rule's
   * target RPE on the target line (`ruleTargetRpes`). An exercise added
   * since the load is missing and shows no built-in value until the next load.
   */
  exerciseInfo?: Readonly<Record<string, RuleExerciseInfo | null>>;
  /** Exercise IDs the catalogue lists as bodyweight: `+ Weight` and added-weight steps. */
  bodyweightExercises?: ReadonlySet<string>;
  /** The builder's `works` line per exercise ID (`Chest, front delts, triceps`; workout-table-v3 §2); null when none. */
  worksLines?: Readonly<Record<string, string | null>>;
  /** The builder's group and role per exercise ID, for the `+N min` fit (workout-table-v3 §5); null when the builder has none. */
  builderInfo?: Readonly<Record<string, BuilderExerciseInfo | null>>;
  /** The main lifts of the builder or plan draft this workout started from (`session.coachDraft`), for the `+N min` fit. */
  mainExerciseIds?: ReadonlySet<string>;
}

/**
 * Today's main card (audit B2): the next session, built from the last
 * workout with the built-in rule's next targets (labelled), at this gym.
 */
/** Why a routine is Up next: after the last in the rotation (D19), the only one, or its split day is due (18 Oct). */
/** (19 Oct) `plan`: a day of the applied coach plan (`Day 2 of 4`). */
export type UpNextRoutineBasis = { kind: 'after'; routineName: string; atUtc: string; tz: string } | { kind: 'only' } | { kind: 'split' } | { kind: 'plan'; dayN: number; of: number };

/** A plan day the morning reminder predicts (`next.planAhead`). */
export interface PlanAheadRow {
  routineId: string;
  name: string;
  dayN: number;
  of: number;
  /** A leg day (the run rule). */
  legs: boolean;
  /** The pinned day (`Make next`), kept first. */
  pinned: boolean;
}

export interface NextSessionPreview {
  /**
   * Up next is a routine (premium-feel §2.6, rotation D19): Start starts it.
   * Null: the last workout's next session (Start uses `sourceSessionId`).
   */
  routine: { id: string; basis: UpNextRoutineBasis } | null;
  /** The workout the targets come from; null for a routine not done yet (its own templates). */
  sourceSessionId: string | null;
  title: string;
  /** `Chest · Shoulders · Triceps`. */
  muscles: string | null;
  exercises: { exerciseName: string; line: string }[];
  /** `Target 100 kg × 6–8 · 3 sets` per exercise, from what Start would create (premium-feel §2.3). */
  targets: { exerciseName: string; line: string }[];
  sets: number;
  /** `about 45 min` (`estimateRemainingDuration` on what Start would create; always an estimate). */
  aboutMinutes: number | null;
  sourceStartedAtUtc: string | null;
  tz: string;
  /** (Ben, 20 Oct) Behind `Why?` when Up next is a leg day with a long or hard run near (`Long run yesterday`); else null. */
  why: string | null;
}

/** A row of the switcher sheet (`Gym for this workout`, gym-editor §2.7). */
export interface GymChoice {
  id: string;
  name: string;
  current: boolean;
  /** Items set up there (0 = none yet). */
  items: number;
}

/** Toast Undo of a switch (gym-switch §4.5): restored, or refused with a `Switch back` card. */
export type GymUndoOutcome =
  | { ok: true; outcome: Extract<CommandOutcome, { ok: true }>; gymName: string }
  | { ok: false; message: string; back: GymSwitchProposal | null };

/** A row of Today's `Your routines` (premium-feel §2.6): `5 exercises · 6 Oct` or `5 exercises · not done yet`. */
export interface RoutineRow {
  id: string;
  name: string;
  version: number;
  exercises: number;
  sets: number;
  lastDone: { atUtc: string; tz: string } | null;
  createdFromSessionId: string | null;
  /** In Ben's rotation (RT9); also its place there, for an Undo of `Remove from rotation`. */
  inRotation: boolean;
  rotationAtUtc: string;
}

/** The routine sheet: what `Start this routine` would create at this gym. Saves nothing. */
export interface RoutinePreview {
  routine: RoutineRow;
  /** `Target 100 kg × 6–8 · 3 sets` per exercise, snapped to this gym. */
  targets: { exerciseName: string; line: string }[];
  notes: { exerciseName: string; text: string }[];
  aboutMinutes: number | null;
  /** Where the targets come from: the built-in rule (next targets) or the routine as saved. */
  source: 'built_in_rule' | 'routine';
  lastDone: { atUtc: string; tz: string; gymName: string | null } | null;
}

export type RoutineWrite = { ok: true; routine: Routine; duplicate: boolean } | { ok: false; message: string; stale?: boolean };

/**
 * What the Workout overview previews (workout-overview §7): Up next, one
 * routine, or (session picker §7) a session type picked from its history:
 * the next session of `sourceSessionId`, its most recent workout.
 */
export type OverviewTarget = { kind: 'next' } | { kind: 'routine'; routineId: string } | { kind: 'session'; sourceSessionId: string } | { kind: 'coach_draft'; draftId: string };

/** A coach-built draft in the picker's `FROM COACH` and Today's `SESSIONS` (workout-builder §4.4): a picker row. Actuals only. */
export interface CoachDraftRow extends SessionPickerRow {
  draftId: string;
  /** `Push · 45 min` (code-made). */
  name: string;
  /** When the coach built it (`Today 18:02`). */
  createdAt: ZonedTimestamp;
}

/** One session picker row (session-picker §2.2): actuals only, no targets and no coach content. */
export interface SessionPickerRow {
  key: string;
  label: string;
  kind: SessionTypeKind;
  /** What a tap opens: Up next (the recommended row, so the page is Today's card), a routine, or a history type's next session. */
  target: OverviewTarget;
  routineId: string | null;
  sourceSessionId: string | null;
  lastDone: ZonedTimestamp | null;
  exerciseCount: number;
  /** The `UP NEXT` row: the same session Today's card shows. */
  recommended: boolean;
  /** Today's pre-start draft for this session has edits (`Edited`, SP-D6). */
  edited: boolean;
  /** A coach draft (workout-builder §4.4): `Coach` tag, and when it was made instead of when last done. */
  coachDraft?: { createdAt: ZonedTimestamp };
}

/** `services.sessions.list` (session-picker §7). `current`: Up next first, longest gap first, then `New`; `older`: `OLDER`. */
export interface SessionList {
  /** The `UP NEXT` row, always first (routines.md WL4). */
  upNext: SessionPickerRow | null;
  /** `YOUR WORKOUTS`: saved workouts, longest gap first, `New` last. */
  workouts: SessionPickerRow[];
  /** `FROM HISTORY`: named (and, with Decision 1, Category) types that aren't saved workouts. */
  fromHistory: SessionPickerRow[];
  /** `OLDER`: not done in 42 days, saved workouts first. */
  older: SessionPickerRow[];
  recommendedKey: string | null;
  /** `FROM COACH` (workout-builder §4.4): open coach drafts, newest first. Started, saved, discarded and expired ones aren't here. */
  fromCoach?: CoachDraftRow[];
  /** (Ben, 20 Oct) `YOUR PLAN`: the plan in use's days in plan order (not Up next's), listed first; none while paused. */
  plan?: SessionPickerRow[];
}

/** The Workouts list (routines.md §A2.1): the rows, and the workout in progress (`StatusBanner`, Resume). */
export interface LibraryData {
  view: LibraryView;
  active: { sessionId: string; name: string; routineId: string | null } | null;
}

/** An exercise as the editor shows it (names, how it's measured, Fixed-load checks). */
export interface EditorExerciseInfo {
  id: string;
  name: string;
  measurement: Exercise['measurement'];
  laterality: Exercise['laterality'];
  defaultLoadConvention: Exercise['defaultLoadConvention'];
  compatibleEquipment: Exercise['compatibleEquipment'];
  /** Rest resolution step 3: Ben's own default for it, else the catalogue's. */
  defaultRestS: number | null;
  compound: boolean;
  /** The §10.1 default shape (3 working sets, the built-in rule's reps, `0:45` timed); the add sheet's `Sets` bar sets the count. */
  defaultShape: SlotShapeInput;
  /** (Design pass 5.1) The working load last logged (`lastWorkingLoad`): a new Fixed load starts from it, snapped. Absent from search results. */
  lastLoad?: Load | null;
}

/** The workout editor's data (routines.md §A2.3). Local reads only. */
export interface RoutineEditorData {
  /** The stored workout; null for `New workout`. */
  routine: Routine | null;
  /** What the editor opens with (a workout from before the library shows `Auto` loads). */
  exercises: RoutineExercise[];
  info: Record<string, EditorExerciseInfo>;
  /** The selected gym: Fixed loads are checked on its items. */
  gym: { id: string; name: string; equipment: EquipmentInstance[] } | null;
  unit: UserProfile['preferredUnit'];
  globalDefault: RestSetting;
  restPresets: RestSetting[];
  /** This workout is the one in progress (`In progress · changes apply next time`). */
  inProgress: boolean;
  /** `Target RPE` / `Target RIR` on the cards (WL11); null hides the row (effort scale off). */
  effortScale: 'rpe' | 'rir' | null;
}

/** An editor save (WL10): the new version and the record its Undo reads. */
export type RoutineEditWrite =
  | { ok: true; routine: Routine; actionId: string | null; duplicate: boolean }
  | { ok: false; reason: 'stale'; message: string; current: Routine; changedAtUtc: string; lines: string[] }
  | { ok: false; reason: 'invalid' | 'missing' | 'failed'; message: string };

/** What `Save to Workouts` saves (§A4.2): a finished workout, or exactly what an overview shows. */
export type SaveFrom =
  | { kind: 'session'; sessionId: string }
  /** Repeat's `Save to Workouts` (§A2.6): the Repeat preview at this gym, its fitted loads as Fixed (review S4). */
  | { kind: 'repeat'; sessionId: string; gymId: string }
  | { kind: 'preview'; target: OverviewTarget; gymId: string | null; checkInId?: string | null; typicalEquipment?: readonly EquipmentInstance[]; previewKey: string }
  /** (22 Oct, §7) Your workout's `⋯ Save to Workouts`: the builder draft as it stands, planned at its gym (loads `Auto`). */
  | { kind: 'draft'; draftId: string; gymId: string | null };

/** The draft a save source names (a coach draft or Your workout's), so the saved workout is linked to it (BD12). */
function savedDraftIdOf(from: SaveFrom): string | null {
  if (from.kind === 'draft') return from.draftId;
  return from.kind === 'preview' && from.target.kind === 'coach_draft' ? from.target.draftId : null;
}

/** The save sheet's prefill (§A2.5): name and `5 exercises · 15 sets`; null = `Nothing to save`. */
export interface SaveSource {
  name: string;
  detail: string;
  /** What isn't saved (`Not copied: 3 distance sets (Sled push)`, review S1); null when nothing is left out. */
  notSaved: string | null;
  /** The unsaved copy's exercises, for the sheet's `Edit ›` (routines.md §A2.5, WL-A18): the editor opens on them. */
  exercises: RoutineExercise[];
}

export type LibrarySaveWrite = RoutineWrite | { ok: false; message: string; reason: 'nothing' | 'stale_preview' | 'already_saved' };

/** User-facing words for library writes (minimal copy; the UI says "workout", never "routine", WL1). */
export const LIBRARY_COPY = {
  notFound: 'That workout wasn’t found.',
  changed: (name: string) => `${name} changed. Check it and try again.`,
  saveFailed: 'Couldn’t save. Try again.',
  alreadySaved: 'Already saved.',
  editFailed: (name: string) => `Couldn’t save ${name}. Your edits are still here.`,
  nothing: 'Nothing to save',
} as const;

/** What a Start from the overview starts: the routine, or the last workout's next session. */
export type OverviewStartOf =
  | { routineOf: string; nextOf?: undefined; coachDraftOf?: undefined }
  | { nextOf: string; routineOf?: undefined; coachDraftOf?: undefined }
  /** A coach-built draft (workout-builder §6.3). */
  | { coachDraftOf: string; routineOf?: undefined; nextOf?: undefined };

/** The draft basis a Start names (ADR 0022, workout-builder BD2). */
export function startBasisOf(startOf: OverviewStartOf): DraftBasis {
  if (startOf.routineOf !== undefined) return { kind: 'routine', routineId: startOf.routineOf };
  if (startOf.coachDraftOf !== undefined) return { kind: 'coach_draft', draftId: startOf.coachDraftOf };
  return { kind: 'next', sourceSessionId: startOf.nextOf };
}

/** A Ben write on a coach draft (§5.3, §6.2). `stale`: the draft moved since the page read it; `closed`: started, discarded or expired. */
export type CoachDraftWrite = { ok: true; draft: WorkoutDraft; duplicate: boolean } | { ok: false; reason: 'stale' | 'closed' | 'missing' | 'failed'; draft: WorkoutDraft | null };

/** The draft card in the coach sheet (§4.2): every value from the stored draft and the overview's own dry run. */
export interface CoachDraftCard {
  draftId: string;
  versionN: number;
  name: string;
  exerciseCount: number;
  /** `≈ 44 min`: the fitted plan's estimate; null when it can't be worked out here. */
  estimateMinutes: number | null;
  gymName: string | null;
  leftOut: number;
  state: DraftCardState;
  /** The coach's checked message, shown under the card. */
  rationale: string | null;
}

/** What the overview shows of a coach draft (workout-builder §4.3, §4.5): code-made values and checks, never model numbers. */
export interface CoachDraftInfo {
  id: string;
  version: number;
  versionN: number;
  name: string;
  /** `⚠ 1 left out`. */
  leftOut: number;
  /** `Why this workout` (§4.5): Ben's words (quoted data), the checked rationale and the code's check lines. */
  request: string;
  rationale: string | null;
  /** (Coach v3) The rationale's numbers were checked against the facts at build time, so they may show. */
  rationaleNumbersChecked?: boolean;
  checks: string[];
  fitMinutes: number;
  /** The live library workout it was saved as (still open, Ben may start it); null when not saved or that workout was deleted. Review r2 S2: set, the page offers no second Save. */
  routineId: string | null;
  /**
   * (Ben, 14 Oct) The one-line note at the top: `Push · Bench press · 45 min · last Push 6 days ago`.
   * Empty before the page is planned.
   */
  headNote: string;
  /** (Ben, 14 Oct) Each row's short reason line, by slot key: `last 3: 87.5×8 @8 → +2.5`, `Rule · last 85×8`. */
  reasons: Record<string, string>;
  /** Rows whose target is an estimate (`est.`, rule 6), by slot key. */
  estimates: string[];
  /** `Why this workout` → `LOADS` (§4.5): each row's target, label, the coach's basis quoted, code's notes. */
  loads: LoadWhyEntry[];
  /** The row panel's `LOAD` line (§4.4), by slot key: `LOAD  12.5 kg · est.`, `LOAD  — · start light`. */
  loadLines: Record<string, string>;
  /** `USED`: which history the loads came from (review S4); null when none did. */
  historyUsed: HistoryUsed;
}

/**
 * Everything the Workout overview shows (workout-overview §3, §7). Local
 * reads only: no AI, no network, nothing written.
 */
export interface OverviewData {
  view: WorkoutOverview;
  /** What this page's Start starts (the resolved Up next, or the routine). */
  startOf: OverviewStartOf;
  /** The routine shown (`⋯` Rename / Delete); null for a non-routine next session. */
  routine: RoutineRow | null;
  /** Gyms for the chip (not archived), the selected one first. */
  gyms: Pick<Gym, 'id' | 'name' | 'isDefault'>[];
  /**
   * The inline check-in row (§3.9): `ask` (no selection), `reuse` (an
   * unlinked check-in under 2 h, pre-selected), or `skip` (no row).
   */
  checkIn: { kind: 'ask' } | { kind: 'reuse'; checkIn: CheckIn } | Extract<CheckInGate, { kind: 'skip' }>;
  /** The answered check-in the targets were planned with (pain mentioned holds loads), when there is one. */
  planCheckIn: CheckIn | null;
  /** Ben's unit, for the `Typical equipment` preview. */
  unit: UserProfile['preferredUnit'];
  /** The coach's stored next-session targets the rows name (`row.coach.rowId`), for Undo / `Use coach target` (§5). */
  coachTargets: Readonly<Record<string, NextSessionTargetRecord>>;
  /** Today's pre-start draft (ADR 0022), when one is open; every edit sends its version. */
  draft: { id: string; version: number } | null;
  /** A draft for this workout closed at midnight on this read and had edits: `Earlier edits cleared` (once). */
  cleared: boolean;
  /** Edits the plan no longer has a place for (the routine changed): `Plan changed · N edit(s) removed`. */
  removedEdits: number;
  /** Today's order differs from the plan's (Reorder's `Reset order`). */
  reordered: boolean;
  /**
   * `Update Push A ›` (overview-today-edits §11.5): the card's lines from
   * today's edits, against the workout as this page read it. Null on a next
   * session (that link reads `Save to Workouts ›`) or with nothing to list.
   */
  /** `draftVersion`: the draft the lines were built from; Apply sends it, so a draft that moved since is refused (review B3). */
  templateCard: { routineId: string; routineName: string; routineVersion: number; draftId: string; draftVersion: number; lines: TemplateLine[] } | null;
  /** The pace the TIME tile and a fit use (`How long?` → `ⓘ`, fit-to-time §3.2). */
  pace: ResolvedPace;
  /** The live coach fit's record, when the fit is the coach's (fit-to-time §3.3). */
  coachFit: CoachFitInfo | null;
  /** A coach-built draft's page (workout-builder §4.3); null on every other basis. */
  coachDraft: CoachDraftInfo | null;
}

/** The Add exercise list (§11.4): rows with this gym's targets; `Nothing else here at Main gym.` when empty. */
export interface AddSheet {
  gymName: string;
  rows: SubstituteRow[];
  /** `Show all` was on (a pick with no usable item here shows `NO LOAD`). */
  showAll: boolean;
}

/** `Update Push A` → Apply (§11.5): the routine write and Ben's record, or why nothing was written. */
export type TemplateUpdateWrite =
  | { ok: true; action: ActionRecord; routine: Routine; duplicate: boolean }
  | { ok: false; reason: 'stale' | 'missing' | 'invalid' | 'failed'; message: string };

/** A write to today's draft (overview-today-edits §4.2). `stale`: the page re-reads (rule 5). */
export type DraftWrite =
  | {
      ok: true;
      draft: PreStartDraft | null;
      duplicate: boolean;
      /** Edits this write added (the new edit, or restored copies). */
      added: string[];
      /** Edits this write removed: what an Undo of a Reset restores. */
      removed: string[];
    }
  | { ok: false; reason: 'stale' | 'invalid' | 'failed'; message: string };

/** The Swap sheet (§2.4): `Swap Bench press` · `Main gym · today`, then its rows. Never calls the coach. */
export interface SwapSheet {
  slotKey: string;
  /** The slot's planned exercise (`Swap Bench press`). */
  plannedName: string;
  gymName: string;
  rows: SubstituteRow[];
  /** Pain on the exercise being swapped: the substitute's targets are held today (B5, rule 9). */
  painHeld: boolean;
}

/** `Change Push A too ›` → Apply / Undo (TE4). */
export type TemplateSwapWrite =
  | { ok: true; action: ActionRecord; routine: Routine; duplicate: boolean }
  | { ok: false; reason: 'stale' | 'missing' | 'invalid' | 'failed' | 'changed_since'; message: string };

/** One of today's edits as the page sends it (§4.2, §11.7). `add` names only the exercise: the new row's key comes from the opId. */
/** `order` is the coach's Applied reorder (structural proposals) as well as `move`. */
export type OverviewEdit = Exclude<TodayEditBody, { kind: 'add' }> | { kind: 'add'; exerciseId: string; workingSets?: number };

/** The slot key an added exercise gets: from the write's opId, so a retry names the same row. */
export function addSlotKey(opId: string): string {
  return deriveId(`today-add-slot:${opId}`);
}

export const DRAFT_COPY = {
  failed: 'Couldn’t save that edit.',
  cleared: 'Earlier edits cleared',
  cantUndo: (routineName: string) => `Can’t undo: ${routineName} changed since.`,
} as const;

export const STALE_PREVIEW = 'Targets updated';

export interface WorkoutStartRequest {
  gymId: string;
  opId: string;
  checkIn: SessionCheckIn | null;
  repeatOf?: string | null;
  nextOf?: string | null;
  routineOf?: string | null;
  /** A coach-built draft (workout-builder §6.3): planned with `planCoachDraft`, the session names the draft. */
  coachDraftOf?: string | null;
  /**
   * From the Workout overview (§7): the key of the page Ben saw. Checked
   * against the inputs as stored now; a mismatch creates nothing and
   * returns `stale_preview`. A retry of a Start that already went through
   * is a duplicate, never stale.
   */
  expectedPreviewKey?: string;
  /** Internal (the no-gym overview Start): a fence from a key check already made, re-checked inside the write. */
  fence?: WriteFence;
  /**
   * The pre-start draft the page showed (ADR 0022 §3): null for none. A Start
   * of a routine or a next session always plans with the live draft for it;
   * when this is given and the live draft differs, nothing is created.
   */
  draft?: { id: string; expectedVersion: number } | null;
  /**
   * (Workout builder v3 §2.8, §4.2, §4.6) A builder draft's Start, with `coachDraftOf`: the draft's
   * version the page showed (a moved one creates nothing), the plan day it is started as, and the
   * template or variation write that lands in the same transaction.
   */
  builder?: { expectedVersion: number; planDay?: SessionPlanDay; alongside?: StartAlongside };
}

/** The overview's key check (§7): a retry of a Start that landed, out of date, or fresh with what to re-check in the write. */
export type PreviewCheck = { kind: 'duplicate' } | { kind: 'stale' } | { kind: 'fresh'; fence: WriteFence };

export function createWorkoutServices(ctx: WorkoutServicesContext) {
  const repos = () => ctx.repos();
  // (PM, 23 Oct) Every real start is marked when it falls in the plan's deload week.
  const deloadAt = deloadAtOf(repos);
  const domain = () => createSessionService(repos(), ctx.newId, { deloadAt });

  /**
   * The pain flag an op set on a movement, if it is still on (review r2 B1).
   * IDs are derived from the opId so a retry flags once. A flag of this op
   * that is no longer active (taken back by a failed save's rollback, an
   * Undo, or cleared) is never "ours": the next ID in the op's chain is, so
   * a retry writes a fresh flag instead of pointing at a withdrawn one.
   */
  async function opPainFlag(opId: string, exerciseId: string): Promise<{ id: string; flag: PainFlag | null }> {
    for (let n = 0; n < 64; n += 1) {
      const id = deriveId(n === 0 ? `pain:${opId}:${exerciseId}` : `pain:${opId}:${exerciseId}:${String(n)}`);
      const flag = await repos().painFlags.get(id);
      if (!flag || flag.status === 'active') return { id, flag };
    }
    throw new Error('Too many pain flags for one operation.');
  }

  async function owner(): Promise<UserProfile> {
    const p = await ctx.profile();
    if (!p) throw new Error('Owner profile not found.');
    return p;
  }

  async function recentCheckIns(ownerId: string, nowMs: number): Promise<(RecentCheckIn & { checkIn: CheckIn })[]> {
    const list = await repos().checkIns.listSince(ownerId, toIso(nowMs - RECENT_WINDOW_MS));
    const linked = await repos().checkIns.linkedIds(list.map((c) => c.id));
    return list.map((c) => ({
      id: c.id,
      recordedAtUtc: c.recordedAt.utc,
      outcome: c.outcome,
      deleted: c.deletedAtUtc !== undefined,
      linked: linked.has(c.id),
      checkIn: c,
    }));
  }

  async function saveCheckIn(next: CheckIn, expectedVersion: number | null): Promise<boolean> {
    const r = await repos().checkIns.save(next, expectedVersion);
    return r.ok;
  }

  const checkInSettings = (): CheckInSettings => ctx.checkInSettings?.() ?? DEFAULT_CHECK_IN_SETTINGS;

  /** `recordCheckIn` (CI4): idempotent per opId. */
  async function recordCheckIn(req: { checkInId: string; opId: string; score: CheckInScore }): Promise<CheckInWrite> {
    try {
      const p = await owner();
      const at = ctx.now();
      const made = newCheckIn({ id: req.checkInId, ownerId: p.id, opId: req.opId, score: req.score, at, localDate: localDateOf(toMs(at.utc), at.tz) });
      if (await saveCheckIn(made, null)) return { ok: true, checkIn: made, duplicate: false };
      const existing = await repos().checkIns.get(req.checkInId);
      if (existing?.createdByOpId === req.opId) return { ok: true, checkIn: existing, duplicate: true };
      return { ok: false, message: CHECK_IN_WRITE_FAILED };
    } catch {
      return { ok: false, message: CHECK_IN_WRITE_FAILED };
    }
  }

  const checkIns = {
    /** `shouldAskCheckIn` for a Start (check-in.md §2.1). Defaults are used until the settings screen exists. */
    async gate(): Promise<CheckInGate> {
      const p = await owner();
      const at = ctx.now();
      const nowMs = toMs(at.utc);
      return shouldAskCheckIn({ settings: checkInSettings(), nowMs, weekday: weekdayOf(nowMs, at.tz), entry: 'start', recent: await recentCheckIns(p.id, nowMs) });
    },

    get: (id: string): Promise<CheckIn | null> => repos().checkIns.get(id),

    /**
     * (Ben, 23 Oct) The quiet `How are you feeling?` in the workout: until the first working set is
     * logged, when the workout has no check-in answered or skipped.
     */
    offeredIn(aggregate: SessionAggregate): boolean {
      return offersCheckInInWorkout({ settings: checkInSettings(), session: aggregate });
    },

    /**
     * (Ben, 23 Oct) The score from the workout's `How are you feeling?`: saved at the tap (CI4), then
     * linked to that workout (`set_session_check_in`, versioned and idempotent per opId). Refused once a
     * working set is logged; the check-in is then kept as Ben gave it, unlinked.
     */
    async recordInWorkout(req: { checkInId: string; opId: string; score: CheckInScore; sessionId: string }): Promise<CheckInWrite> {
      const saved = await recordCheckIn(req);
      if (!saved.ok) return saved;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const agg = await repos().sessions.get(req.sessionId);
          if (agg === null) return { ok: false, message: 'That workout wasn’t found.' };
          // Already linked (a retry after the write went through): nothing more to write.
          if (agg.session.checkIn?.kind === 'answered' && agg.session.checkIn.checkInId === saved.checkIn.id) return saved;
          const r = ctx.afterCommand(await domain().dispatch(req.sessionId, { type: 'set_session_check_in', at: ctx.now(), opId: `${req.opId}:link`, checkInId: saved.checkIn.id, expectedVersion: agg.session.version }));
          if (r.ok) return saved;
          // The workout moved on between the read and the write (a draft save): read it again once.
          if (r.error.code === 'stale_version') continue;
          return { ok: false, message: r.error.code === 'check_in_closed' ? 'Check-in closed: a working set is logged.' : CHECK_IN_WRITE_FAILED };
        }
        return { ok: false, message: CHECK_IN_WRITE_FAILED };
      } catch {
        return { ok: false, message: CHECK_IN_WRITE_FAILED };
      }
    },

    /** Written at the first score tap (CI4). `checkInId` is chosen once per sheet, so a retry is a duplicate. */
    record: (req: { checkInId: string; opId: string; score: CheckInScore }): Promise<CheckInWrite> => recordCheckIn(req),

    /** (Ben, 23 Oct) `Skip workout` is offered on the workout's own check-in only while nothing is logged in it. */
    async canSkipWorkout(sessionId: string): Promise<boolean> {
      const agg = await repos()
        .sessions.get(sessionId)
        .catch(() => null);
      return agg !== null && agg.session.status === 'active' && !discardConfirmation(agg).required;
    },

    /**
     * (Ben, 23 Oct) `Skip workout` on the workout's own check-in (ill step): the empty workout is
     * discarded (nothing was logged, so no Undo, as today.md §4). Refused once a set is logged.
     */
    async skipWorkoutFrom(req: { sessionId: string; opId: string }): Promise<{ ok: true } | { ok: false; message: string }> {
      try {
        const agg = await repos().sessions.get(req.sessionId);
        if (agg === null || agg.session.status !== 'active') return { ok: false, message: 'That workout wasn’t found.' };
        const ask = discardConfirmation(agg);
        if (ask.required) return { ok: false, message: 'Sets are logged. End it from the workout instead.' };
        const r = ctx.afterCommand(await domain().dispatch(req.sessionId, discardCommand(ask, { opId: req.opId, at: ctx.now() })));
        return r.ok ? { ok: true } : { ok: false, message: r.error.message };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },

    /** `updateCheckIn` / `setCheckInOutcome`: versioned; a stale edit is refused and the latest is returned. */
    async update(checkInId: string, patch: CheckInPatch, expectedVersion: number, opId: string): Promise<CheckInWrite> {
      try {
        const current = await repos().checkIns.get(checkInId);
        if (!current) return { ok: false, message: 'That check-in wasn’t found.' };
        const r = applyCheckInPatch(current, patch, opId, ctx.now());
        if (r.kind === 'duplicate' || r.kind === 'unchanged') return { ok: true, checkIn: current, duplicate: r.kind === 'duplicate' };
        if (current.version !== expectedVersion) return { ok: false, stale: true, message: 'This check-in changed. Showing the latest.' };
        if (await saveCheckIn(r.checkIn, expectedVersion)) return { ok: true, checkIn: r.checkIn, duplicate: false };
        return { ok: false, stale: true, message: 'This check-in changed. Showing the latest.' };
      } catch {
        return { ok: false, message: CHECK_IN_WRITE_FAILED };
      }
    },

    /** Today's region 4 line: an unlinked check-in under 2 h old. */
    async unlinked(): Promise<CheckIn | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const nowMs = toMs(ctx.now().utc);
      const gate = shouldAskCheckIn({ settings: checkInSettings(), nowMs, weekday: weekdayOf(nowMs, ctx.now().tz), entry: 'start', recent: await recentCheckIns(p.id, nowMs) });
      return gate.kind === 'reuse' ? repos().checkIns.get(gate.checkInId) : null;
    },
  };

  const pain = {
    /**
     * Pain step `Flag n movements` (check-in.md §4.1): one flag per movement,
     * IDs derived from the opId so a retry flags once; then the check-in
     * records them. Flag first, then everything else (CM4).
     */
    async flagFromCheckIn(req: { checkIn: CheckIn; exercises: Pick<Exercise, 'id' | 'name'>[]; area: PainArea | null; opId: string }): Promise<CheckInWrite & { flagIds?: string[]; flags?: PainFlagRef[] }> {
      try {
        const p = await owner();
        const at = ctx.now();
        // The step already went through (a retry after the link): flag nothing new.
        const linked = await repos().checkIns.get(req.checkIn.id);
        if (linked?.appliedOps.includes(`${req.opId}:link`)) return { ok: true, checkIn: linked, duplicate: true, flagIds: [], flags: [] };
        const ids: string[] = [];
        const refs: PainFlagRef[] = [];
        for (const ex of req.exercises) {
          // Only an active flag counts as this op's (review r2 N2).
          const { id, flag: existing } = await opPainFlag(req.opId, ex.id);
          ids.push(id);
          if (existing) {
            refs.push({ id, version: existing.version });
            continue;
          }
          const flag = newPainFlag({ id, ownerId: p.id, opId: req.opId, exerciseId: ex.id, exerciseName: ex.name, area: req.area, source: 'check_in', checkInId: req.checkIn.id, at });
          const saved = await repos().painFlags.save(flag, null);
          const now = saved.ok ? flag : await repos().painFlags.get(id);
          if (!now) return { ok: false, message: 'The pain flag wasn’t saved. Try again.' };
          refs.push({ id, version: now.version });
        }
        const updated = await checkIns.update(req.checkIn.id, { painFlagIds: ids }, req.checkIn.version, `${req.opId}:link`);
        return updated.ok ? { ...updated, flagIds: ids, flags: refs } : updated;
      } catch {
        return { ok: false, message: 'The pain flag wasn’t saved. Try again.' };
      }
    },

    /**
     * `Pain` from the workout's Adjust row or the coach sheet (coach-adjustments
     * §4.5, coach-memory §2.5): deterministic, offline, no AI. One flag on this
     * movement, its ID derived from the opId so a double tap flags once; an
     * active flag already there is kept (never duplicated) and isn't this
     * tap's to take back. Increases stop at once. `flags`: what Undo retracts.
     */
    async flagMovement(req: { exerciseId: string; exerciseName: string; opId: string }): Promise<{ ok: true; flags: PainFlagRef[] } | { ok: false; message: string }> {
      try {
        const p = await owner();
        // This tap's own flag first (a retry or double tap gets the same Undo), then any other active one.
        const id = deriveId(`pain:${req.opId}:${req.exerciseId}`);
        const existing = await repos().painFlags.get(id);
        if (existing) return { ok: true, flags: existing.status === 'active' ? [{ id, version: existing.version }] : [] };
        const live = (await repos().painFlags.listActive(p.id)).find((f) => f.exerciseId === req.exerciseId);
        if (live) return { ok: true, flags: [] };
        const flag = newPainFlag({ id, ownerId: p.id, opId: req.opId, exerciseId: req.exerciseId, exerciseName: req.exerciseName, area: null, source: 'workout', checkInId: null, at: ctx.now() });
        const saved = await repos().painFlags.save(flag, null);
        if (!saved.ok) {
          const raced = await repos().painFlags.get(id);
          return raced ? { ok: true, flags: raced.status === 'active' ? [{ id, version: raced.version }] : [] } : { ok: false, message: 'The pain flag wasn’t saved. Try again.' };
        }
        return { ok: true, flags: [{ id, version: flag.version }] };
      } catch {
        return { ok: false, message: 'The pain flag wasn’t saved. Try again.' };
      }
    },

    /**
     * Undo of a flag Ben just set (the `Pain noted` toast, the exclusion
     * toast after ticking `Pain`; review B2): a retraction, never a clear, so
     * no 8-week `Before flag` reference, cleared-flag history or
     * return-to-load guard comes from it. Versioned: a flag changed since the
     * action (answered, cleared) is left as it is and reported in `stale`.
     * A flag already retracted (a retry, a double tap) is a no-op. Clearing
     * stays `clearConfirmed`.
     */
    async retract(flags: readonly PainFlagRef[], opId: string): Promise<PainRetractWrite> {
      const at = ctx.now();
      const stale: string[] = [];
      try {
        for (const ref of flags) {
          const f = await repos().painFlags.get(ref.id);
          if (!f) continue;
          if (f.status === 'retracted') continue;
          if (f.status !== 'active' || f.version !== ref.version) {
            stale.push(ref.id);
            continue;
          }
          const r = await repos().painFlags.save(retractPainFlag(f, at, opId), f.version);
          if (!r.ok) stale.push(ref.id);
        }
        return { ok: true, stale };
      } catch {
        return { ok: false, message: 'Undo wasn’t saved. Try again.' };
      }
    },

    /** Undo on the `Pain flag cleared` toast. A flag changed since the clear is left alone (stale). */
    async undoClear(cleared: readonly { id: string; version: number }[]): Promise<boolean> {
      const at = ctx.now();
      let all = true;
      try {
        for (const c of cleared) {
          const f = await repos().painFlags.get(c.id);
          if (!f || f.version !== c.version || f.status !== 'cleared') {
            all = false;
            continue;
          }
          const r = await repos().painFlags.save(restorePainFlag(f, at), f.version);
          if (!r.ok) all = false;
        }
        return all;
      } catch {
        return false;
      }
    },

    async active(): Promise<PainFlag[]> {
      const p = await ctx.profile();
      return p ? repos().painFlags.listActive(p.id) : [];
    },

    get: (flagId: string): Promise<PainFlag | null> => repos().painFlags.get(flagId),

    /**
     * `recordPainFlagReview(flagId, 'still_hurts', opId)`: keeps the flag and
     * moves the next check 14 days on. A retry with the same opId is a
     * duplicate; an answer against a flag that changed since the screen read
     * it is refused (stale), never applied to newer state.
     */
    async stillHurts(req: { flagId: string; opId: string; expectedVersion: number }): Promise<PainReviewWrite> {
      const failed = { ok: false as const, reason: 'failed' as const, message: 'Your answer wasn’t saved. Try again.' };
      try {
        const at = ctx.now();
        const nowMs = toMs(at.utc);
        const done = (flag: PainFlag, duplicate: boolean): PainReviewWrite => ({ ok: true, flag, reviewOpId: req.opId, kept: painKeptText(flag), nudge: painProfessionalNudge(flag, nowMs, at.tz), duplicate });
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const f = await repos().painFlags.get(req.flagId);
          if (!f) return { ok: false, reason: 'not_found', message: 'That pain flag wasn’t found.' };
          const r = recordPainFlagReview(f, 'still_hurts', req.opId, at);
          if (r.kind === 'duplicate') return done(r.flag, true);
          if (r.kind === 'not_active') return { ok: false, reason: 'not_active', message: `The pain flag on ${f.exerciseName} was cleared.` };
          if (r.kind === 'not_due') return { ok: false, reason: 'not_due', message: 'Already answered. Showing the latest.' };
          if (f.version !== req.expectedVersion) return { ok: false, reason: 'stale', message: 'This pain flag changed. Showing the latest.' };
          const saved = await repos().painFlags.save(r.flag, f.version);
          if (saved.ok) return done(r.flag, false);
          // Lost a race: the re-read either finds our own answer (duplicate) or a newer flag (stale).
        }
        return { ok: false, reason: 'stale', message: 'This pain flag changed. Showing the latest.' };
      } catch {
        return failed;
      }
    },

    /** Undo on `Pain flag kept · next check …`: the check is due again exactly as before. */
    async undoStillHurts(req: { flagId: string; reviewOpId: string; undoOpId: string }): Promise<boolean> {
      try {
        const f = await repos().painFlags.get(req.flagId);
        if (!f) return false;
        const r = undoPainFlagReview(f, req.reviewOpId, req.undoOpId, ctx.now());
        if (r.kind === 'duplicate') return true;
        if (r.kind !== 'undone') return false;
        return (await repos().painFlags.save(r.flag, f.version)).ok;
      } catch {
        return false;
      }
    },

    /**
     * `Clear flag` in the confirmation (§2.14.3): the only way a flag is
     * cleared. Versioned: a flag changed since the sheet read it isn't
     * cleared. Clearing a flag that is already cleared is a no-op (a retry).
     * Nothing else is touched: history, records and the reference stay.
     */
    async clearConfirmed(req: { flagId: string; expectedVersion: number }): Promise<PainClearWrite> {
      try {
        const f = await repos().painFlags.get(req.flagId);
        if (!f) return { ok: false, stale: false, message: 'That pain flag wasn’t found.' };
        if (f.status === 'cleared') return { ok: true, cleared: null };
        if (f.status === 'retracted') return { ok: false, stale: true, message: 'This pain flag changed. Showing the latest.' };
        if (f.version !== req.expectedVersion) return { ok: false, stale: true, message: 'This pain flag changed. Showing the latest.' };
        const next = clearPainFlag(f, ctx.now());
        const r = await repos().painFlags.save(next, f.version);
        if (!r.ok) return { ok: false, stale: true, message: 'This pain flag changed. Showing the latest.' };
        return { ok: true, cleared: { id: next.id, version: next.version } };
      } catch {
        return { ok: false, stale: false, message: 'The pain flag wasn’t cleared. Try again.' };
      }
    },

    /**
     * The pain flag sheet (§2.14.4). With a workout exercise, `Before` and
     * `Since` use its equipment; otherwise the latest workout of the
     * exercise decides. The workout in progress is never part of history.
     */
    async sheet(req: { flagId: string; sessionId?: string | null; sessionExerciseId?: string | null }): Promise<PainFlagSheetView | null> {
      try {
        const p = await ctx.profile();
        const flag = await repos().painFlags.get(req.flagId);
        if (!p || !flag || flag.ownerId !== p.id) return null;
        const [exercise, aggregate, history] = await Promise.all([
          repos().exercises.get(flag.exerciseId),
          req.sessionId ? repos().sessions.get(req.sessionId).catch(() => null) : Promise.resolve(null),
          historyFor(p.id, flag.exerciseId).catch(() => [] as HistorySession[]),
        ]);
        const ex =
          aggregate?.exercises.find((e) => e.id === req.sessionExerciseId && e.exerciseId === flag.exerciseId) ??
          aggregate?.exercises.find((e) => e.exerciseId === flag.exerciseId) ??
          null;
        const at = ctx.now();
        return buildPainFlagSheet({
          flag,
          history: history.filter((h) => h.sessionId !== aggregate?.session.id),
          nowMs: toMs(at.utc),
          tz: aggregate?.session.startedAt.tz ?? at.tz,
          exercise: {
            measurement: ex?.measurement ?? exercise?.measurement ?? 'reps',
            defaultLoadConvention: ex?.loadConvention ?? exercise?.defaultLoadConvention ?? 'total',
          },
          anchor:
            ex === null || aggregate === null
              ? null
              : {
                  equipmentId: ex.equipmentId,
                  unit: ex.unit,
                  loadConvention: ex.loadConvention,
                  equipment: equipmentOfRow(aggregate.session.equipmentSnapshot, ex),
                },
        });
      } catch {
        return null;
      }
    },
  };

  /**
   * Pace samples from the last finished workouts (§2.15.2). Finished workouts
   * don't change during a workout, so they're read once per active session.
   * A read failure never blocks logging: the estimate falls back to `Default`.
   */
  let paceCache: { key: string; samples: PaceSamples } | null = null;
  async function recentPace(ownerId: string, sessionId: string, nowMs: number): Promise<PaceSamples> {
    if (paceCache?.key === sessionId) return paceCache.samples;
    try {
      const r = await repos().sessions.listFinishedBetweenReadable(ownerId, toIso(nowMs - RECENT_PACE_WINDOW_MS), toIso(nowMs + 1));
      const samples = recentPaceSamples(r.sessions.filter((a) => a.session.id !== sessionId));
      paceCache = { key: sessionId, samples };
      return samples;
    } catch {
      return { set: [], changeover: [] };
    }
  }

  async function historyFor(ownerId: string, exerciseId: string): Promise<HistorySession[]> {
    return ctx.store().listExerciseHistory(ownerId, exerciseId);
  }

  /** (Perf, 23 Oct) Several exercises' histories in one read; one that can't be read is empty, as `historyFor`'s callers treat it. */
  async function historiesFor(ownerId: string, exerciseIds: Iterable<string>): Promise<Map<string, HistorySession[]>> {
    const ids = [...new Set(exerciseIds)];
    const all = await ctx.store().listExerciseHistories(ownerId, ids).catch(() => null);
    const out = new Map<string, HistorySession[]>();
    for (const id of ids) out.set(id, all?.get(id) ?? (await historyFor(ownerId, id).catch(() => [] as HistorySession[])));
    return out;
  }

  async function gymNamesOf(ownerId: string): Promise<Record<string, string>> {
    return Object.fromEntries((await repos().gyms.listByOwner(ownerId).catch(() => [])).map((g) => [g.id, g.name]));
  }

  /** The substitutes today's swaps plan with (their own GS3 step 2 at this gym). */
  function swapExerciseIds(today: TodayEditsInput | undefined): string[] {
    return today === undefined ? [] : [...today.swaps.values(), ...(today.adds?.values() ?? [])].map((sp) => sp.exercise.id);
  }

  /** GS3 step 2 for each exercise: the item it last used at `gymId`. History that can't be read is skipped. */
  async function lastUsedFor(ownerId: string, exerciseIds: Iterable<string>, gymId: string): Promise<(exerciseId: string) => string | null> {
    const map = new Map<string, string | null>();
    const ids = [...new Set(exerciseIds)];
    // (Perf, 23 Oct) One read for all of them (each workout decoded once), not a full history read per exercise.
    const all = ids.length > 1 ? await ctx.store().listExerciseHistories(ownerId, ids).catch(() => null) : null;
    for (const exerciseId of ids) {
      map.set(exerciseId, lastUsedAtGym(all?.get(exerciseId) ?? (await historyFor(ownerId, exerciseId).catch(() => [] as HistorySession[])), gymId));
    }
    return (exerciseId) => map.get(exerciseId) ?? null;
  }

  /** The check-in on a workout, for "pain mentioned, no movement chosen" (PM SP3). */
  async function sessionCheckIn(a: SessionAggregate | null): Promise<CheckIn | null> {
    return a?.session.checkIn?.kind === 'answered' ? repos().checkIns.get(a.session.checkIn.checkInId) : null;
  }

  async function planFor(p: UserProfile, req: { sessionId: string; exerciseId: string; equipmentId: string | null }): Promise<{ setType: SetType; planned: PlannedSet }[] | null> {
    const [aggregate, exercise] = await Promise.all([repos().sessions.get(req.sessionId), repos().exercises.get(req.exerciseId)]);
    // Cardio (review B1): last time's time and distance, on any item (no load to fit); none = the add's own default.
    if (aggregate && exercise?.measurement === 'cardio') return cardioRepeatTargets(await historyFor(p.id, exercise.id), { at: ctx.now() });
    if (!aggregate || !exercise || exercise.measurement !== 'reps') return null;
    const equipment = req.equipmentId === null ? null : (currentGymEquipment(aggregate.session).find((e) => e.id === req.equipmentId) ?? null);
    const unit = equipment?.unit ?? p.preferredUnit;
    const convention = equipment?.loadConvention ?? exercise.defaultLoadConvention;
    const history = await historyFor(p.id, exercise.id);
    const previous = lastComparableSession(history, { equipmentId: equipment?.id ?? null, unit, loadConvention: convention });
    // No history: three working sets in the built-in rep range, no load (audit B1).
    if (!previous) return defaultStartingPlan(exercise, equipment?.kind ?? null, convention, undefined, { at: ctx.now() });
    const now = unspecifiedPain(await sessionCheckIn(aggregate));
    const then = unspecifiedPain(await sessionCheckIn(await repos().sessions.get(previous.sessionId)));
    // From FitNotes: the same reading as the load, never below the default because of it (review import-progress B1, B2).
    const workingSets = workingSetsFromPrevious(previous, history);
    const { result } = nextTargetsFor({
      ownerId: p.id,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      measurement: exercise.measurement,
      unit,
      convention,
      equipment,
      exercise,
      rule: null,
      workingSets,
      history,
      painFlags: await repos().painFlags.listActive(p.id),
      sessionPain: now.active ? now : then,
    });
    // Each planned set records what produced it, for `Why?` (active-workout §2.12, AW3).
    return plannedSetsFromTargets(result, { history, equipment, at: ctx.now() }) ?? defaultStartingPlan(exercise, equipment?.kind ?? null, convention, Math.max(1, workingSets), { at: ctx.now(), decision: result.decision });
  }

  /**
   * Next targets for every exercise of a finished workout, on the equipment
   * it was done with (the gym check happens when the workout is built).
   * Exercises the rule can't plan are left out, so they repeat as last time.
   * `today`: the check-in answered for the workout being started; pain
   * mentioned there holds every load, like `planFor` (rule 9; review B2).
   */
  async function nextTargetsOf(p: UserProfile, source: SessionAggregate, today: CheckIn | null = null): Promise<Map<string, NextTargetEntry[]>> {
    const all = await ctx.store().repos.coach.listNextTargets(p.id, source.session.id).catch(() => []);
    // (Ben, 23 Oct) The rule lowers a stalled lift only where Ben applied its reset on the Summary.
    const builtIn = await builtInNextTargetsOf(p, source, today, undefined, acceptedRuleResets(all, source));
    // D21: the coach's saved next-session targets win where they are still valid; the built-in rule is the fallback.
    const rows = coachTargetRows(all);
    if (rows.length === 0) return builtIn;
    const flags = await repos().painFlags.listActive(p.id);
    return withCoachTargets(builtIn, rows, source, { flaggedExerciseIds: new Set(flags.map((f) => f.exerciseId)), painToday: unspecifiedPain(today).active });
  }

  /**
   * Before a start from a finished workout: note which workout it starts
   * from, so the coach's targets for that source count as used while the new
   * workout exists and isn't discarded (D21; review S2, S3). Never blocks
   * the start: if the note can't be saved, the targets just stay unused.
   */
  async function noteStartFrom(ownerId: string, sourceSessionId: string, opId: string): Promise<void> {
    await ctx
      .store()
      .repos.coach.noteStartFrom(ownerId, sourceSessionId, opId, ctx.now().utc)
      .catch(() => undefined);
  }

  /**
   * `targets` with last time's time and distance for each cardio exercise it
   * has none for (review B1; `cardioRepeatTargets`). `failed`: the targets
   * couldn't be read, so they stay null (the start says so).
   */
  async function withCardioRepeats(p: UserProfile, exerciseIds: readonly string[], targets: ReadonlyMap<string, readonly NextTargetEntry[]> | null, failed: boolean): Promise<ReadonlyMap<string, readonly NextTargetEntry[]> | null> {
    if (failed) return targets;
    const out = new Map<string, readonly NextTargetEntry[]>(targets ?? []);
    for (const exerciseId of new Set(exerciseIds)) {
      if (out.has(exerciseId)) continue;
      const exercise = await repos().exercises.get(exerciseId).catch(() => null);
      if (exercise?.measurement !== 'cardio') continue;
      const plan = cardioRepeatTargets(await historyFor(p.id, exerciseId).catch(() => [] as HistorySession[]), { at: ctx.now() });
      if (plan) out.set(exerciseId, plan);
    }
    return out.size === 0 ? targets : out;
  }

  /** The built-in rule's next targets only (playbook 7-F): the comparison and the fallback for the coach's. */
  async function builtInNextTargetsOf(p: UserProfile, source: SessionAggregate, today: CheckIn | null = null, repsOut?: Map<string, RuleReps>, acceptedResets: ReadonlySet<string> = new Set()): Promise<Map<string, { setType: SetType; planned: PlannedSet }[]>> {
    const out = new Map<string, { setType: SetType; planned: PlannedSet }[]>();
    const flags = await repos().painFlags.listActive(p.id);
    const now = unspecifiedPain(today);
    const sessionPain = now.active ? now : unspecifiedPain(await sessionCheckIn(source));
    const blocks = nextTargetBlocks(source);
    const infos = new Map<string, Exercise | null>();
    for (const b of blocks) if (!infos.has(b.decider.exerciseId)) infos.set(b.decider.exerciseId, await repos().exercises.get(b.decider.exerciseId).catch(() => null));
    // A main barbell lift after the workout's main lift reads as a secondary lift, as in the builder (review S3).
    const secondary = secondaryMainLifts(blocks, (id) => infos.get(id) ?? null);
    // One entry per exercise block: a split exercise reads its deciding part with the
    // block's set count, the same as the Summary's `Next time` (review r2 B1).
    for (const block of blocks) {
      const sx = block.decider;
      // (19 Oct) A second copy of an exercise (a superset with itself at 0) never plans next time.
      if (block.copy || out.has(sx.exerciseId)) continue;
      // Cardio (review B1): never progressed; next time repeats last time's time and distance (this workout's, as history reads it).
      if (sx.measurement === 'cardio') {
        const plan = cardioRepeatTargets(await historyFor(p.id, sx.exerciseId), { at: ctx.now() });
        if (plan) out.set(sx.exerciseId, plan);
        continue;
      }
      if (sx.measurement !== 'reps') continue;
      const exercise = await repos().exercises.get(sx.exerciseId);
      // The reason line isn't shown at Start (the Summary shows it), so no gym name is needed.
      const history = await historyFor(p.id, sx.exerciseId);
      const { result } = nextTargetsForBlock(
        block,
        // A FitNotes source recorded no item: its loads are fitted to the gym when the workout is built (B7; rule 4).
        { ownerId: p.id, sessionId: source.session.id, count: 'done', exercise, rule: null, history, painFlags: flags, sessionPain, ...(source.session.source === 'import' ? { fitLater: true } : {}), ...(secondary.has(sx.exerciseId) ? { accessory: true } : {}), ...(acceptedResets.has(sx.exerciseId) ? { acceptReset: true } : {}) },
        null,
      );
      if (repsOut !== undefined && result.reps !== undefined) repsOut.set(sx.exerciseId, result.reps);
      // Rule provenance on each set, so `Why?` explains a progressed target as the rule's, never as a repeat (review B1.1).
      // A split block's targets are the deciding part's, on its item.
      const plan = plannedSetsFromTargets(result, { history, equipment: block.equipment, at: ctx.now() });
      if (plan) out.set(sx.exerciseId, plan);
    }
    return out;
  }

  /** `Push` for a workout without a stored name, from its exercises' muscles. */
  async function titleFor(exerciseIds: readonly string[]): Promise<{ title: string; muscles: string | null }> {
    const infos: Exercise[] = [];
    for (const id of new Set(exerciseIds)) {
      const e = await repos().exercises.get(id).catch(() => null);
      if (e) infos.push(e);
    }
    return { title: deriveWorkoutTitle(infos), muscles: muscleSummary(infos) };
  }

  /** The source's own name, unless it's the generic `Workout`. */
  const storedName = (a: HistoryLike): string | null => storedWorkoutName(a.session);

  /** A next session's name: a coach build's without its length (`Pull · 20 min` → `Pull`; the plan's own estimate is shown). */
  const upNextName = (a: SessionAggregate): string | null => {
    const n = storedName(a);
    if (n === null || a.session.coachDraft === undefined) return n;
    // `Workout · 45 min` is the generic name: the derived title (`Push`) is used instead (review today-18oct N1).
    const base = baseWorkoutName(n);
    return base === '' || base === GENERIC_WORKOUT_NAME ? null : base;
  };

  /** `about N min` for a workout not started yet, at Ben's pace over his last 5 workouts. Null if it can't be read. */
  async function aboutMinutes(p: UserProfile, a: SessionAggregate): Promise<number | null> {
    try {
      const refs = (await repos().sessions.listFinishedRefs(p.id, 5)).map((r) => r.sessionId);
      const recent: SessionAggregate[] = [];
      for (const id of refs) {
        const x = await repos().sessions.get(id).catch(() => null);
        if (x) recent.push(x);
      }
      const m = estimateRemainingDuration(a, { recent }).minutes;
      return m > 0 ? m : null;
    } catch {
      return null;
    }
  }

  /** Enough finished workouts to find each routine's last one; small rows, no decode. */
  const REF_LIMIT = 400;
  async function finishedRefs(ownerId: string): Promise<FinishedRef[]> {
    return repos().sessions.listFinishedRefs(ownerId, REF_LIMIT);
  }

  async function routineRows(ownerId: string): Promise<{ rows: RoutineRow[]; live: Routine[]; refs: FinishedRef[] }> {
    const live = liveRoutines(await repos().routines.listByOwner(ownerId));
    const refs = await finishedRefs(ownerId);
    const last = routineLastDone(live, refs);
    const rows = live.map((r) => {
      const c = routineCounts(r);
      const done = last.get(r.id) ?? null;
      return {
        id: r.id,
        name: r.name,
        version: r.version,
        exercises: c.exercises,
        sets: c.sets,
        lastDone: done ? { atUtc: done.startedAtUtc, tz: done.tz } : null,
        createdFromSessionId: r.createdFromSessionId ?? null,
        inRotation: r.inRotation !== false,
        rotationAtUtc: r.rotationAtUtc ?? r.createdAtUtc,
      };
    });
    return { rows, live, refs };
  }

  /**
   * A routine's start at this gym: its structure, with next targets from its
   * most recent finished workout (the same rule as Today's next session).
   * `today`: the check-in for the workout being started (pain holds loads).
   * Targets that can't be worked out leave the routine's own templates.
   */
  async function routineStart(
    p: UserProfile,
    req: {
      routineId: string;
      gymId: string;
      opId: string;
      preview: boolean;
      checkIn?: SessionCheckIn | null;
      today?: CheckIn | null;
      gymEquipment?: readonly EquipmentInstance[];
      newId?: () => string;
      fence?: WriteFence;
      noteSource?: boolean;
      /** Today's edits from the pre-start draft (ADR 0022). */
      todayEdits?: TodayEditsInput;
    },
  ) {
    const routine = await repos().routines.get(req.routineId);
    const ref = routine ? (await finishedRefs(p.id)).find((f) => isFromRoutine(f, routine)) ?? null : null;
    const source = ref ? await repos().sessions.get(ref.sessionId).catch(() => null) : null;
    const fromSource = source ? await nextTargetsOf(p, source, req.today ?? null).catch(() => null) : null;
    // A routine from before the library: last time's today-only set counts stay last time's (TE-B13, review S1).
    const sourced = fromSource !== null && routine && source ? withoutTodayOnlySets(fromSource, routine, source.session.todayEdits) : fromSource;
    // Cardio (review B1): last time's time and distance wherever it was done, also when this routine hasn't run yet.
    const targets = routine ? await withCardioRepeats(p, routine.exercises.map((e) => e.exerciseId), sourced, source !== null && sourced === null) : sourced;
    // Swapped slots' substitutes too, so the dry run, the Swap sheet and Start map the same item (GS3 step 2, review S3).
    const lastUsedHere = routine ? await lastUsedFor(p.id, [...routine.exercises.map((e) => e.exerciseId), ...swapExerciseIds(req.todayEdits)], req.gymId) : undefined;
    if (req.noteSource === true && ref !== null && !req.preview) await noteStartFrom(p.id, ref.sessionId, req.opId);
    // (19 Oct) A coach plan's workout never done yet: its first workout takes the plan's checked loads, re-checked now.
    const firstLoads = routine && ref === null && routine.createdFromPlan !== undefined ? await planDayFirstLoads(p, routine, req.gymId, req.gymEquipment, req.today ?? null).catch(() => null) : null;
    const service = req.newId ? createSessionService(repos(), req.newId, { deloadAt }) : domain();
    const r = await service.startRoutine({
      ownerId: p.id,
      gymId: req.gymId,
      routineId: req.routineId,
      opId: req.opId,
      at: ctx.now(),
      preview: req.preview,
      ...(req.checkIn !== undefined ? { checkIn: req.checkIn } : {}),
      ...(targets && targets.size > 0 ? { targets } : {}),
      ...(firstLoads !== null && firstLoads.size > 0 ? { firstLoads } : {}),
      ...(req.gymEquipment ? { gymEquipment: req.gymEquipment } : {}),
      ...(req.fence ? { fence: req.fence } : {}),
      ...(lastUsedHere ? { lastUsedHere } : {}),
      ...(req.todayEdits ? { today: req.todayEdits } : {}),
    });
    return { r, ref, source, routine, targeted: (targets !== null && targets.size > 0) || (firstLoads !== null && firstLoads.size > 0), targetsFailed: source !== null && targets === null };
  }

  /** (19 Oct) A plan workout's first loads (`planFirstLoads`) at this gym: its plan's checked loads, re-checked against today's history, pain and items. */
  async function planDayFirstLoads(p: UserProfile, routine: Routine, gymId: string, gymEquipment: readonly EquipmentInstance[] | undefined, today: CheckIn | null) {
    const link = routine.createdFromPlan;
    if (link === undefined) return null;
    const plan = await ctx.store().repos.planDrafts.get(link.planId).catch(() => null);
    if (plan === null || plan.ownerId !== p.id) return null;
    const exercises = new Map<string, Exercise>();
    for (const e of routine.exercises) {
      const x = await exerciseById(e.exerciseId);
      if (x === null) continue;
      exercises.set(x.id, x);
    }
    const histories = await historiesFor(p.id, exercises.keys());
    const substitute = await substituteCtx(p, gymId, gymEquipment, today, exercises.keys());
    return planFirstLoads({ routine, plan, exercises, histories, substitute, nowMs: toMs(ctx.now().utc) });
  }

  /**
   * A coach draft's start at this gym (workout-builder §6.3): `planCoachDraft`
   * through the session service, with each exercise's own history (BD6) and
   * the selected gym's items. A real start first saves catalogue exercises as
   * Ben's rows (as `Add exercise` does); a preview only reads them.
   */
  async function coachDraftStart(
    p: UserProfile,
    draft: WorkoutDraft,
    req: { gymId: string; opId: string; preview: boolean; checkIn?: SessionCheckIn | null; today?: CheckIn | null; gymEquipment?: readonly EquipmentInstance[]; newId?: () => string; fence?: WriteFence; todayEdits?: TodayEditsInput; planDay?: SessionPlanDay; alongside?: StartAlongside },
  ) {
    const v = currentDraftVersion(draft);
    const exercises = new Map<string, Exercise>();
    for (const s of v.plan.slots) {
      const e = req.preview ? await exerciseById(s.exerciseId) : await ensureExercise(s.exerciseId);
      if (e !== null) exercises.set(s.exerciseId, e);
    }
    const histories = await historiesFor(p.id, exercises.keys());
    const substitute = await substituteCtx(p, req.gymId, req.gymEquipment, req.today ?? null, exercises.keys());
    const lastUsedHere = await lastUsedFor(p.id, [...exercises.keys(), ...swapExerciseIds(req.todayEdits)], req.gymId);
    const service = req.newId ? createSessionService(repos(), req.newId, { deloadAt }) : domain();
    return service.startCoachDraft({
      ownerId: p.id,
      gymId: req.gymId,
      opId: req.opId,
      at: ctx.now(),
      draft,
      exercises,
      histories,
      substitute,
      preview: req.preview,
      lastUsedHere,
      ...(req.checkIn !== undefined ? { checkIn: req.checkIn } : {}),
      ...(req.gymEquipment ? { gymEquipment: req.gymEquipment } : {}),
      ...(req.fence ? { fence: req.fence } : {}),
      ...(req.todayEdits ? { today: req.todayEdits } : {}),
      ...(req.planDay ? { planDay: req.planDay } : {}),
      ...(req.alongside ? { alongside: req.alongside } : {}),
    });
  }

  /** Save one routine change; a conflict re-reads once so a retry after a lost acknowledgement reads as done. */
  async function writeRoutine(routineId: string, make: (current: Routine) => RoutineChange): Promise<RoutineWrite> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await repos().routines.get(routineId);
      const p = await ctx.profile();
      if (!current || !p || current.ownerId !== p.id) return { ok: false, message: LIBRARY_COPY.notFound };
      const c = make(current);
      if (c.kind === 'duplicate') return { ok: true, routine: c.current, duplicate: true };
      if (c.kind === 'stale') return { ok: false, message: LIBRARY_COPY.changed(current.name), stale: true };
      if (c.kind === 'invalid') return { ok: false, message: c.message };
      const saved = await repos().routines.save(c.next, c.expectedVersion).catch(() => null);
      if (saved?.ok) return { ok: true, routine: c.next, duplicate: false };
      if (saved === null) return { ok: false, message: LIBRARY_COPY.saveFailed };
    }
    return { ok: false, message: LIBRARY_COPY.notFound, stale: true };
  }

  /** Whether each exercise is a compound one (`Main`, WL9): Ben's list, then the catalogue. Unknown = not. */
  async function compoundOf(ids: Iterable<string>): Promise<(exerciseId: string) => boolean> {
    const yes = new Set<string>();
    for (const id of new Set(ids)) if ((await exerciseById(id))?.mechanic === 'compound') yes.add(id);
    return (exerciseId) => yes.has(exerciseId);
  }

  /** Which exercises are measured in distance: a saved workout refuses them (EL-B13, review library-browse r2 S1). */
  async function distanceOf(ids: Iterable<string>): Promise<(exerciseId: string) => boolean> {
    const yes = new Set<string>();
    for (const id of new Set(ids)) if ((await exerciseById(id))?.measurement === 'distance') yes.add(id);
    return (exerciseId) => yes.has(exerciseId);
  }

  /** Session types for the picker and the library (session-picker §3, routines.md WL5). Local reads. */
  async function typeIndex(p: UserProfile, live: readonly Routine[]) {
    const rows = await repos().sessions.listSessionTypeRows(p.id, TYPE_ROW_LIMIT);
    // Decision 1: unnamed imports are typed by their FitNotes Category; unreadable rows just leave them untyped.
    const categories = SESSION_PICKER_DECISIONS.groupImportsByCategory && rows.some((r) => r.imported) ? await ctx.store().repos.imports.categoriesBySession(p.id).catch(() => new Map<string, Record<string, number>>()) : new Map<string, Record<string, number>>();
    // F20: an unnamed import is typed by the title the overview and calendar give it (`Pull`), not its Category cell.
    const infoById = new Map<string, Exercise | null>();
    const derivedTitle = async (ids: readonly string[]): Promise<string | null> => {
      const infos: Exercise[] = [];
      for (const id of ids) {
        if (!infoById.has(id)) infoById.set(id, await repos().exercises.get(id).catch(() => null));
        const e = infoById.get(id);
        if (e) infos.push(e);
      }
      return infos.length === 0 ? null : deriveWorkoutTitle(infos);
    };
    const titles = new Map<string, string>();
    // No exercise read back: its Category cell still names it.
    if (SESSION_PICKER_DECISIONS.groupImportsByCategory) for (const r of rows) if (r.imported && r.routineId === null) { const t = await derivedTitle(r.exerciseIds); if (t !== null) titles.set(r.sessionId, t); }
    return groupSessionTypes({
      routines: live.map((r) => ({ id: r.id, name: r.name, createdFromSessionId: r.createdFromSessionId ?? null, exerciseCount: routineCounts(r).exercises })),
      sessions: rows.map((r) => ({ id: r.sessionId, routineId: r.routineId, routineName: r.routineName, startedAt: { utc: r.startedAtUtc, tz: r.tz }, exerciseCount: r.exerciseCount, imported: r.imported, importCategories: categories.get(r.sessionId) ?? null, derivedTitle: titles.get(r.sessionId) ?? null })),
      now: ctx.now(),
      groupImportsByCategory: SESSION_PICKER_DECISIONS.groupImportsByCategory,
    });
  }

  /** A new workout write: idempotent by `opId` (the workout's ID comes from it), so a double tap saves one. */
  async function createOnce(id: string, opId: string, make: () => Routine | null, nothing: string): Promise<LibrarySaveWrite> {
    const existing = await repos().routines.get(id).catch(() => null);
    if (existing) return existing.lastOpId === opId || existing.version > 1 ? { ok: true, routine: existing, duplicate: true } : { ok: false, message: LIBRARY_COPY.saveFailed };
    const routine = make();
    if (routine === null) return { ok: false, message: nothing, reason: 'nothing' };
    // Catalogue exercises are saved as rows before a workout can use them (as `Add exercise` does).
    for (const e of routine.exercises) if ((await ensureExercise(e.exerciseId)) === null) return { ok: false, message: LIBRARY_COPY.notFound };
    const saved = await repos().routines.save(routine, null).catch(() => null);
    if (saved?.ok) return { ok: true, routine, duplicate: false };
    // The write may have landed before an error: read it back.
    const again = await repos().routines.get(id).catch(() => null);
    return again?.lastOpId === opId ? { ok: true, routine: again, duplicate: true } : { ok: false, message: LIBRARY_COPY.saveFailed };
  }

  /** The Repeat preview at a gym (routines.md §2.4): the screen and its `Save to Workouts` plan the same way. Saves nothing. */
  async function repeatPlan(p: UserProfile, sourceSessionId: string, gymId: string) {
    const source = await repos().sessions.get(sourceSessionId);
    if (!source || source.session.ownerId !== p.id) return null;
    const lastUsedHere = await lastUsedFor(p.id, source.exercises.map((e) => e.exerciseId), gymId);
    const out = await domain().startFromSession({ ownerId: p.id, gymId, routineId: null, opId: `preview:${sourceSessionId}`, at: ctx.now(), sourceSessionId, preview: true, lastUsedHere });
    return out.ok ? { source, out, plan: out.aggregate } : null;
  }

  /** What an overview shows, planned exactly as the page did (same draft, check-in and gym), and whether its key still matches. */
  async function previewPlan(p: UserProfile, from: Extract<SaveFrom, { kind: 'preview' }>): Promise<{ aggregate: SessionAggregate; resolved: ResolvedOverview; today: TodayPlanInfo | null } | 'stale' | null> {
    const gymId = from.gymId ?? 'typical-gym-preview';
    const typical = from.gymId === null ? from.typicalEquipment : undefined;
    const resolved = await resolveOverview(p, from.target, { gymId, gymEquipment: typical });
    if (resolved === null) return 'stale';
    const { planCheckIn } = await overviewCheckIn(from.checkInId ?? null);
    const t = await todayFor(p, resolved, gymId, typical, planCheckIn);
    if (previewKey(await previewKeyParts(p, resolved, from.gymId, planCheckIn, t.draft)) !== from.previewKey) return 'stale';
    const run = await overviewDryRun(p, resolved, gymId, planCheckIn, typical, t.input);
    return run === null ? null : { aggregate: run.aggregate, resolved, today: run.today };
  }

  /** (22 Oct) Your workout's draft planned as its Start would plan it (no check-in), for `Save to Workouts`. Gone or started: stale. */
  async function draftSavePlan(p: UserProfile, from: Extract<SaveFrom, { kind: 'draft' }>): Promise<{ aggregate: SessionAggregate; resolved: ResolvedOverview; today: TodayPlanInfo | null } | 'stale' | null> {
    const resolved = await resolveCoachDraft(p, from.draftId);
    if (resolved === null) return 'stale';
    const run = await overviewDryRun(p, resolved, from.gymId ?? 'typical-gym-preview', null);
    return run === null ? null : { aggregate: run.aggregate, resolved, today: run.today };
  }

  /** A workout from a save source, not saved: what the sheet shows and what `saveFrom` writes. */
  /** `notSaved`, when given, gets what the workout leaves out (distance sets, review S1), for the save sheet. */
  async function routineFromSource(p: UserProfile, from: SaveFrom, req: { id: string; name: string; opId: string; inRotation: boolean }, notSaved?: NotCopied[]): Promise<Routine | 'stale' | null> {
    const at = ctx.now();
    if (from.kind === 'session') {
      const source = await repos().sessions.get(from.sessionId).catch(() => null);
      if (!source || source.session.ownerId !== p.id) return null;
      const isCompound = await compoundOf(source.exercises.map((e) => e.exerciseId));
      notSaved?.push(...notSavedFromSession(source));
      return routineFromSession({ id: req.id, ownerId: p.id, name: req.name, opId: req.opId, source, at, newId: ctx.newId, inRotation: req.inRotation, isCompound });
    }
    if (from.kind === 'repeat') {
      const r = await repeatPlan(p, from.sessionId, from.gymId);
      if (r === null) return null;
      const isCompound = await compoundOf(r.plan.exercises.map((e) => e.exerciseId));
      // What the Repeat screen shows: last time's loads fitted to this gym, kept as Fixed (§4.6).
      const fixedSetIds = new Set(r.plan.sets.filter((s) => s.status === 'pending' && s.planned.load !== null).map((s) => s.id));
      // Repeat's own distance-only sets (never copied) and any distance set the plan still holds.
      notSaved?.push(...mergeNotCopied(r.out.notCopied.filter((n) => n.kind === 'distance'), notSavedFromPlan(r.plan)));
      return routineFromPlan({ id: req.id, ownerId: p.id, name: req.name, opId: req.opId, plan: r.plan, at, newId: ctx.newId, isCompound, inRotation: req.inRotation, fixedSetIds, createdFromSessionId: r.source.session.id });
    }
    const plan = from.kind === 'draft' ? await draftSavePlan(p, from) : await previewPlan(p, from);
    if (plan === null || plan === 'stale') return plan;
    const isCompound = await compoundOf(plan.aggregate.exercises.map((e) => e.exerciseId));
    notSaved?.push(...notSavedFromPlan(plan.aggregate));
    if (plan.resolved.kind === 'coach_draft') {
      // workout-builder BD12: exactly what the page shows (today's edits and the fit; skipped rows left out), loads `Auto`,
      // the coach's target RPE kept, `source: 'coach'` until Ben's first edit in the editor.
      const d = plan.resolved.draft;
      const made = routineFromPlan({
        id: req.id,
        ownerId: p.id,
        name: req.name,
        opId: req.opId,
        plan: plan.aggregate,
        at,
        newId: ctx.newId,
        isCompound,
        inRotation: req.inRotation,
        createdFromSessionId: null,
        keepTargetRpe: true,
        ...(plan.today?.setTemplateIds ? { fromRoutine: planSettingsOfRoutine(plan.resolved.routine, plan.aggregate, plan.today.slotOf, plan.today.setTemplateIds) } : {}),
      });
      return made === null ? null : { ...made, source: 'coach', createdFromDraft: { draftId: d.id, version: d.currentVersion } };
    }
    return routineFromPlan({
      id: req.id,
      ownerId: p.id,
      name: req.name,
      opId: req.opId,
      plan: plan.aggregate,
      at,
      newId: ctx.newId,
      isCompound,
      inRotation: req.inRotation,
      // A next session's source keeps its history (WL5); a routine's plan is a new workout.
      createdFromSessionId: plan.resolved.kind === 'next' ? plan.resolved.source.session.id : null,
      // A saved workout's own Fixed pins, Main and items are kept (review S2).
      ...(plan.resolved.kind !== 'next' && plan.today?.setTemplateIds ? { fromRoutine: planSettingsOfRoutine(plan.resolved.routine, plan.aggregate, plan.today.slotOf, plan.today.setTemplateIds) } : {}),
    });
  }

  /** IDs for a preview: the same inputs give the same IDs, so `Why?` can find a set from an earlier read. */
  const previewIds = (): (() => string) => {
    let n = 0;
    return () => deriveId(`overview-preview:${String((n += 1))}`);
  };

  /** What an overview previews, resolved: a routine (and its last workout), or the last workout's next session. */
  type ResolvedOverview =
    | { kind: 'routine'; routine: Routine; ref: FinishedRef | null; basis: OverviewBasis }
    | { kind: 'next'; source: SessionAggregate; basis: OverviewBasis }
    /** A coach-built draft (workout-builder BD2): planned as its transient routine-shaped plan, never stored as a routine. */
    | { kind: 'coach_draft'; draft: WorkoutDraft; routine: Routine; basis: OverviewBasis };

  /** The overview's view of a coach draft (§4.3, §4.5): values and check lines from the stored version. */
  /** The live workout a coach draft was saved as, or null (not saved, or that workout was deleted). */
  /** Review r3 S1: the live workout the draft's current version was saved as; one saved from an earlier version doesn't count. */
  async function liveRoutineOf(d: WorkoutDraft): Promise<string | null> {
    const own = d.routineId === null ? null : await ctx.store().repos.routines.get(d.routineId).catch(() => null);
    const saved = draftSavedRoutineId(d, own !== null && !isDeleted(own) ? own : null);
    return saved ?? (d.builderKey === undefined ? await savedOnYourWorkout(d) : null);
  }

  /**
   * Review R4 (S1 in reverse): a chat draft whose current version Ben saved from Your workout (a builder draft opened
   * on it, at that version) is already that saved workout, so the chat card shows it saved and isn't saved twice.
   */
  async function savedOnYourWorkout(chat: WorkoutDraft): Promise<string | null> {
    const all = liveRoutines(await ctx.store().repos.routines.listByOwner(chat.ownerId).catch(() => [] as Routine[]));
    for (const r of all) {
      const fromId = r.createdFromDraft?.draftId;
      if (fromId === undefined || fromId === chat.id) continue;
      const b = await ctx.store().repos.workoutDrafts.get(fromId).catch(() => null);
      const from = b?.builderKey?.from;
      if (b === null || from?.kind !== 'coach_draft' || from.id !== chat.id) continue;
      if (builderSetupOf(b)?.sourceVersion !== chat.currentVersion) continue;
      const own = b.routineId === null ? null : await ctx.store().repos.routines.get(b.routineId).catch(() => null);
      if (draftSavedRoutineId(b, own !== null && !isDeleted(own) ? own : null) === r.id) return r.id;
    }
    return null;
  }

  /** The coach chat draft a builder draft was opened on (`builderKey.from`), or null. */
  async function chatSourceOf(draftId: string): Promise<string | null> {
    const d = await ctx.store().repos.workoutDrafts.get(draftId).catch(() => null);
    const from = d?.builderKey?.from;
    return from?.kind === 'coach_draft' && from.id !== draftId ? from.id : null;
  }

  async function liveDraftRoutineId(draftId: string): Promise<string | null> {
    const d = await ctx.store().repos.workoutDrafts.get(draftId).catch(() => null);
    return d === null ? null : liveRoutineOf(d);
  }

  async function coachDraftInfoOf(d: WorkoutDraft, planned?: { ownerId: string; rows: readonly OverviewRow[]; aggregate: SessionAggregate; draftWhy: Record<string, DraftSlotWhy> }): Promise<CoachDraftInfo> {
    const v = currentDraftVersion(d);
    const base = { id: d.id, version: d.version, versionN: v.n, name: d.name, leftOut: leftOutCount(v.checks), request: v.request.text, rationale: shownRationale(v.rationale, v.rationaleNumbersChecked === true), rationaleNumbersChecked: v.rationaleNumbersChecked === true, checks: v.checks.filter((c) => c.kind !== 'load').map((c) => c.text), fitMinutes: v.fitMinutes, routineId: await liveRoutineOf(d) };
    const none = { headNote: '', reasons: {}, estimates: [], loads: [], loadLines: {}, historyUsed: null };
    if (planned === undefined) return { ...base, ...none };
    return { ...base, ...(await draftExplain(d, planned).catch(() => none)) };
  }

  /**
   * (Ben, 14 Oct: "4 sets on 90kg for 6–8 with no reason why") The draft's
   * head note and each row's reason line, from the planned sets' own
   * provenance (`draftReasonLine`), the training profile's goal and split,
   * and Ben's recent workouts. Values only; the detail is behind `Why?`.
   */
  async function draftExplain(d: WorkoutDraft, planned: { ownerId: string; rows: readonly OverviewRow[]; aggregate: SessionAggregate; draftWhy: Record<string, DraftSlotWhy> }): Promise<Pick<CoachDraftInfo, 'headNote' | 'reasons' | 'estimates' | 'loads' | 'loadLines' | 'historyUsed'>> {
    const v = currentDraftVersion(d);
    const profile = await ctx.store().repos.trainingProfiles.get(planned.ownerId).catch(() => null);
    const goal = profile?.goal ?? null;
    const mainSlot = [...v.plan.slots].sort((a, b) => a.order - b.order).find((sl) => sl.main) ?? null;
    const firstSet = (row: OverviewRow) => planned.aggregate.sets.find((x) => x.id === row.firstSetId) ?? planned.aggregate.sets.filter((x) => x.sessionExerciseId === row.sessionExerciseId && x.setType !== 'warmup').sort((a, b) => a.index - b.index)[0];
    const reasons: Record<string, string> = {};
    const estimates: string[] = [];
    const loads: LoadWhyEntry[] = [];
    const loadLines: Record<string, string> = {};
    const sources: ('app' | 'fitnotes')[] = [];
    for (const row of planned.rows) {
      const set = firstSet(row);
      const reps = planned.aggregate.exercises.find((e) => e.id === row.sessionExerciseId)?.measurement === 'reps';
      const isMain = mainSlot !== null && row.slotKey === mainSlot.slotKey && row.exerciseId === mainSlot.exerciseId;
      const line = draftReasonLine({ planned: set?.planned ?? null, reps, main: isMain, goal });
      if (line !== null) reasons[row.slotKey] = line;
      if (set?.planned.provenance?.estimate === true) estimates.push(row.slotKey);
      const slot = v.plan.slots.find((sl) => sl.slotKey === row.slotKey);
      const stored = slot?.setTemplates.find((t) => t.setType !== 'warmup' && t.load !== undefined)?.load ?? null;
      const why = planned.draftWhy[row.slotKey];
      const prov = set?.planned.provenance;
      // USED: only the history a load actually came from (a coach load's references; the rule's basis).
      if (set?.planned.source === 'coach') sources.push(...(why?.sources ?? []));
      else if (set?.planned.source === 'built_in_rule' && prov?.basis) sources.push(prov.basis.imported ? 'fitnotes' : 'app');
      if (reps) {
        const target = set === undefined || set.planned.load === null ? '—' : formatLoad(set.planned.load, row.load.none ? undefined : set.planned.load.convention);
        const entry = loadWhyEntry(row.name, target, set?.planned ?? null, { storedNotes: stored?.notes ?? [], notUsed: why?.notUsed ?? stored?.notUsed ?? null, planNotes: why?.planNotes ?? [] });
        loads.push(entry);
        loadLines[row.slotKey] = loadPanelLine(entry);
      }
    }
    // The head note: split day · main lift · length · last workout of the same split day.
    const split = splitInUse(profile);
    const FOCUS: Record<string, string> = { push: 'Push', pull: 'Pull', legs: 'Legs', chest: 'Chest', shoulders: 'Shoulders', back: 'Back', upper: 'Upper', lower: 'Lower', full_body: 'Full body' };
    const dayName = v.request.day?.name ?? FOCUS[v.request.focus] ?? null;
    let lastSameDaysAgo: number | null = null;
    if (dayName !== null) {
      const now = ctx.now();
      const nowMs = toMs(now.utc);
      const recent = await repos().sessions.listFinishedBetween(planned.ownerId, toIso(nowMs - 120 * 86_400_000), toIso(nowMs + 1)).catch(() => [] as HistoryWorkout[]);
      const muscles = new Map<string, readonly string[]>();
      for (const a of recent) for (const e of a.exercises) if (!muscles.has(e.exerciseId)) muscles.set(e.exerciseId, (await exerciseById(e.exerciseId))?.primaryMuscles ?? []);
      const same = [...recent].reverse().find((a) => matchSplitDay(split, workoutMuscleGroups(a.exercises.map((ex) => ({ primaryMuscles: muscles.get(ex.exerciseId) ?? [], workingSets: a.sets.filter((x) => x.sessionExerciseId === ex.id && x.status === 'completed' && x.setType !== 'warmup').length }))))?.name === dayName);
      if (same !== undefined) {
        const today = localDateOf(nowMs, now.tz);
        const then = localDateOf(toMs(same.session.startedAt.utc), now.tz);
        lastSameDaysAgo = Math.round((toMs(`${today}T00:00:00.000Z`) - toMs(`${then}T00:00:00.000Z`)) / 86_400_000);
      }
    }
    const mainRow = mainSlot === null ? null : (planned.rows.find((r) => r.slotKey === mainSlot.slotKey) ?? null);
    const headNote = draftHeadNote({ split: dayName, mainLift: mainRow?.name ?? null, minutes: v.fitMinutes, lastSameDaysAgo });
    return { headNote, reasons, estimates, loads, loadLines, historyUsed: historyUsedOf(sources) };
  }

  /** An open coach draft (14 days, not started or discarded), as the overview plans it. Null: gone (`Draft deleted`). */
  async function resolveCoachDraft(p: UserProfile, draftId: string): Promise<ResolvedOverview | null> {
    const now = ctx.now();
    const drafts = ctx.store().repos.workoutDrafts;
    await drafts.expire(p.id, now.utc).catch(() => [] as WorkoutDraft[]);
    const d = await drafts.get(draftId).catch(() => null);
    if (d === null || d.ownerId !== p.id || !coachDraftIsOpen(d, now.utc)) return null;
    const v = currentDraftVersion(d);
    return { kind: 'coach_draft', draft: d, routine: draftAsRoutine(d, v), basis: { kind: 'coach_draft', at: v.createdAt, versionN: v.n } };
  }

  async function resolveRoutine(p: UserProfile, routineId: string, basis: OverviewBasis | null): Promise<ResolvedOverview | null> {
    const routine = await repos().routines.get(routineId);
    if (!routine || routine.ownerId !== p.id || (routine.deletedAtUtc !== undefined && routine.deletedAtUtc !== null)) return null;
    const ref = (await finishedRefs(p.id)).find((f) => isFromRoutine(f, routine)) ?? null;
    return { kind: 'routine', routine, ref, basis: basis ?? (ref ? { kind: 'last_done', at: { utc: ref.startedAtUtc, tz: ref.tz } } : { kind: 'new_routine' }) };
  }

  async function resolveNext(p: UserProfile, sourceSessionId: string): Promise<ResolvedOverview | null> {
    const source = await repos().sessions.get(sourceSessionId);
    // An imported (FitNotes) workout can be the source too (B7): Start fits its loads to the gym.
    if (!source || source.session.ownerId !== p.id || !isInHistory(source.session)) return null;
    return { kind: 'next', source, basis: { kind: 'next_from', at: source.session.startedAt } };
  }

  /**
   * Up next (D19 rotation), the one resolver Today's card and the overview
   * share (review S5): the rotation's routine when it can be started at this
   * gym, else the last workout's next session. `run`: the routine's dry run,
   * for Today's card. `gymEquipment`: the typical gym when there is none yet.
   */
  async function resolveUpNext(p: UserProfile, gymId: string, gymEquipment?: readonly EquipmentInstance[]) {
    const { live, refs } = await routineRows(p.id).catch(() => ({ live: [] as Routine[], refs: [] as FinishedRef[] }));
    const training = await ctx.store().repos.trainingProfiles.get(p.id).catch(() => null);
    // (19 Oct) The applied coach plan's days, in day order (none without one). (Ben, 20 Oct) None while it is paused:
    // Up next follows the normal rules then, and Today shows no `Day N of M`.
    const plan = await ctx.store().repos.planDrafts.applied(p.id).catch(() => null);
    const nowMs = toMs(ctx.now().utc);
    const paused = activePause(plan, nowMs, p.timezone) !== null;
    const basePlanDays = paused ? [] : planRoutines(plan, live);
    // (Ben, 20 Oct) A long or hard run near today keeps legs off Up next (the day before a planned one, the day after a
    // done one); this week's change Ben applied (a merged day, a skipped day) is in place until Sunday.
    const { near, week } = await weekShape(p, nowMs);
    const planWeek = week !== null && week.basis.kind === 'plan' && plan !== null && week.basis.planId === plan.id && basePlanDays.length > 0 ? week : null;
    const merged = await mergedDays(planWeek);
    const planDays = weekDays(basePlanDays, (r) => r.id, planWeek, (i) => merged[i] ?? null);
    const planBasis = (r: Routine): UpNextRoutineBasis | null => {
      const i = planDays.findIndex((d) => d.id === r.id);
      return i < 0 ? null : { kind: 'plan', dayN: i + 1, of: planDays.length };
    };
    // Only workouts in the rotation (D19, RT9); a workout from before the library is in it.
    const pick = nextInRotation(rotationRoutines(live), refs[0] ?? null);
    const startable = async (routine: Routine, basis: UpNextRoutineBasis) => {
      const run = await routineStart(p, { routineId: routine.id, gymId, opId: `preview-next-routine:${routine.id}`, preview: true, ...(gymEquipment ? { gymEquipment } : {}) });
      return run.r.ok ? { kind: 'routine' as const, routine, basis: planBasis(routine) ?? basis, run: { ...run, r: run.r } } : null;
    };
    // (Ben, 20 Oct; review S6) The run rule on the rotation too: with a long or hard run near, a leg day comes round
    // after the others (the first that starts here); every one a leg day: the pick anyway, with the run behind Why?.
    const rotation = async () => {
      if (pick.kind !== 'routine') return null;
      if (near === null) return startable(pick.routine, pick.basis);
      const split = splitInUse(training);
      const of = await exerciseLookup(rotationRoutines(live));
      const order = avoidLegDays(rotationOrder(rotationRoutines(live), refs[0] ?? null), (r) => planDayBodyParts(r, of, split), near).order;
      for (const r of order) {
        const run = await startable(r, pick.basis);
        if (run !== null) return { ...run, why: isLegDay(planDayBodyParts(r, of, split)) ? near.why : null };
      }
      return null;
    };
    // PM decision 18 Oct (pending Ben): the rotation wins only when the last workout was a routine's and Ben set no split;
    // otherwise the split day trained least recently, counting every workout by the muscles done.
    // (19 Oct, review plans-19oct B1) An applied plan drives Up next even with a split. (Ben, 20 Oct) Adaptive: the
    // pinned day (`Make next`) until done, else the plan day whose body parts were trained least recently, counting every
    // finished workout (plan day, coach-built, empty, imported, off-plan) by the muscles done; never the day(s) the
    // last workout trained unless no other is left. The first one this gym can start. The plan's days never change.
    const planDrives = (plan?.applied ?? null) !== null && planDays.length > 0;
    if (planDrives) {
      const due = await planDue(p, planDays, training, plan?.pin ?? null, near).catch(() => planDays.map((day) => ({ day, legs: false })));
      for (const { day, legs } of due) {
        const planned = await startable(day, { kind: 'split' });
        // The run's `Why?` on a leg day picked anyway (every day left is legs, or none other starts here).
        if (planned !== null) return { ...planned, why: legs && near !== null ? near.why : null };
      }
    }
    if (training?.split === undefined) {
      const rot = await rotation();
      if (rot !== null) return rot;
    }
    const splitWeek = week !== null && week.basis.kind === 'split' && !planDrives ? week : null;
    const bySplit = await splitUpNext(p, live, training, gymId, gymEquipment, planDays, refs, near, splitWeek === null ? null : { week: splitWeek, merged: await mergedDays(splitWeek) }).catch(() => null);
    if (bySplit?.plan) return bySplit.plan;
    if (training?.split !== undefined) {
      const rot = await rotation();
      if (rot !== null) return rot;
    }
    // Decision 2 (approved 11 Oct 2026; review import-progress S1): the history type with the longest gap,
    // never the workout Ben just did (since B7, often his newest FitNotes one). Unreadable: D19's newest workout.
    // A type whose workout trained the day(s) just done only when no other type is left (review today-18oct S4).
    if (SESSION_PICKER_DECISIONS.longestGapFallback) {
      const gap = await longestGapUpNext(p, live, bySplit?.avoid).catch(() => null);
      if (gap !== null) return { kind: 'next' as const, sessionId: gap };
    }
    const last = (await repeat.candidates(1)).rows[0];
    return last ? { kind: 'next' as const, sessionId: last.sessionId } : null;
  }

  /**
   * (Ben, 20 Oct) What shapes Up next this week: the long or hard run near today (`legRunNear`), and the week change
   * Ben applied for this week (`activeWeekPlan`; one from an earlier week has expired). Local reads; never throws.
   */
  async function weekShape(p: UserProfile, nowMs: number): Promise<{ near: LegRunNear | null; week: WeekPlan | null }> {
    const today = localDateOf(nowMs, p.timezone);
    const acts = await repos()
      .activities.listBetween(p.id, addDays(today, -1), addDays(today, 2))
      .catch(() => []);
    const monday = localWeekBounds(nowMs, p.timezone).mondayLocalDate;
    const weeks = await repos()
      .weekPlans.listForWeek(p.id, monday)
      .catch(() => [] as WeekPlan[]);
    return { near: legRunNear(acts, today), week: activeWeekPlan(weeks, nowMs, p.timezone) };
  }

  /** An exercise lookup for routines' rows (the run rule's body parts). */
  async function exerciseLookup(routines: readonly Routine[]): Promise<(id: string) => Exercise | null> {
    const infos = new Map<string, Exercise | null>();
    for (const r of routines) for (const e of r.exercises) if (!infos.has(e.exerciseId)) infos.set(e.exerciseId, await exerciseById(e.exerciseId));
    return (id) => infos.get(id) ?? null;
  }

  /** Each merge's day (its workout, while live), by merge index. */
  async function mergedDays(week: WeekPlan | null): Promise<(Routine | null)[]> {
    if (week === null) return [];
    const out: (Routine | null)[] = [];
    for (const m of week.made) {
      const r = await repos()
        .routines.get(m.routineId)
        .catch(() => null);
      out.push(r !== null && (r.deletedAtUtc ?? null) === null ? r : null);
    }
    return out;
  }

  /** The finished workouts in Up next's window (`SPLIT_WINDOW_DAYS`; from `sinceUtc` when that is earlier) and an exercise lookup for their rows. */
  async function windowSessions(p: UserProfile, sinceUtc: string | null = null): Promise<{ sessions: HistoryWorkout[]; exerciseOf: (id: string) => Exercise | null }> {
    const nowMs = toMs(ctx.now().utc);
    const windowMs = nowMs - SPLIT_WINDOW_DAYS * 86_400_000;
    const fromMs = sinceUtc === null ? windowMs : Math.min(windowMs, toMs(sinceUtc));
    const { sessions } = await repos().sessions.listFinishedBetweenReadable(p.id, toIso(fromMs), toIso(nowMs + 1));
    const infos = new Map<string, Exercise | null>();
    for (const a of sessions) for (const e of a.exercises) if (!infos.has(e.exerciseId)) infos.set(e.exerciseId, await exerciseById(e.exerciseId));
    return { sessions, exerciseOf: (id) => infos.get(id) ?? null };
  }

  /**
   * (Ben, 20 Oct) The applied plan's days in the order they are due (`planDaysByDue`): each day's body parts from its
   * exercises (else the split day it was mapped to), every finished workout in the window by the muscles done.
   */
  async function planDue(p: UserProfile, planDays: readonly Routine[], training: TrainingProfile | null, pin: PlanPin | null, near: LegRunNear | null = null) {
    const { days, workouts, live } = await planDueInput(p, planDays, training, pin);
    const due = planDaysByDue(days, workouts, live);
    // (Ben, 20 Oct) With a long or hard run near, leg days go after the others; a pinned day (`Make next`) stays first.
    const pinned = due.filter((d) => d.pinned);
    const rest = avoidLegDays(
      due.filter((d) => !d.pinned),
      (d) => d.day.bodyParts,
      near,
    ).order;
    return [...pinned, ...rest].map((d) => ({ day: d.day.routine, pinned: d.pinned, legs: isLegDay(d.day.bodyParts) }));
  }

  /** `planDue`'s inputs: the plan days (with their planned muscle groups), the window's workouts and the live pin. */
  async function planDueInput(p: UserProfile, planDays: readonly Routine[], training: TrainingProfile | null, pin: PlanPin | null) {
    // A pin is read against every workout since it, not only the window: one done before a long break stays done (review plan-adapt S3).
    const { sessions: read, exerciseOf } = await windowSessions(p, pin?.atUtc ?? null);
    const windowFrom = toMs(ctx.now().utc) - SPLIT_WINDOW_DAYS * 86_400_000;
    const infos = new Map<string, Exercise | null>();
    for (const r of planDays) for (const e of r.exercises) if (!infos.has(e.exerciseId)) infos.set(e.exerciseId, exerciseOf(e.exerciseId) ?? (await exerciseById(e.exerciseId)));
    const split = splitInUse(training);
    const info = (id: string) => infos.get(id) ?? null;
    const days: (PlanAheadDay & { routine: Routine })[] = planDays.map((r) => ({ routineId: r.id, name: r.name, bodyParts: planDayBodyParts(r, info, split), plannedGroups: planDayGroups(r, info), createdFromSessionId: r.createdFromSessionId ?? null, routine: r }));
    const all: PlanDueWorkout[] = read.map((a) => ({ sessionId: a.session.id, routineId: a.session.routineId ?? null, startedAtUtc: a.session.startedAt.utc, groups: workoutGroupsOf(a, exerciseOf) }));
    const live = activePin(pin, days, all);
    const workouts = all.filter((w) => toMs(w.startedAtUtc) >= windowFrom);
    return { days, workouts, live };
  }

  /**
   * Up next by split day (PM decision 18 Oct, pending Ben): Ben's split (else Push/Pull/Legs), the day trained least
   * recently in the last 42 days by every finished workout's muscles. Planned from a live routine with the day's name,
   * else the newest workout that was mainly that day (a full one before a cut-short or short-built one), whatever its
   * name, so targets come from the latest evidence (review today-18oct B2); a workout older than the window is never
   * Up next (SP-D3). `avoid`: the days the last workout trained, for the fallbacks (S4). Null plan: the other rules apply.
   */
  async function splitUpNext(
    p: UserProfile,
    live: readonly Routine[],
    training: TrainingProfile | null,
    gymId: string,
    gymEquipment?: readonly EquipmentInstance[],
    planDays: readonly Routine[] = [],
    refs: readonly FinishedRef[] = [],
    near: LegRunNear | null = null,
    shape: { week: WeekPlan; merged: readonly (Routine | null)[] } | null = null,
  ) {
    const split = splitInUse(training);
    const { sessions, exerciseOf } = await windowSessions(p);
    const workouts = sessions.map((a) => splitWorkoutOf(a, exerciseOf, training?.sessionMinutes ?? null));
    const due = splitDaysByDue(split, workouts);
    // (Ben, 20 Oct) This week's change on split days: a merged day where the first of its days is due, skipped days out;
    // then, with a long or hard run near, leg days after the others.
    type Entry = { kind: 'day'; day: SplitDay; parts: readonly SplitBodyPart[] } | { kind: 'merged'; routine: Routine; parts: readonly SplitBodyPart[] };
    const entries = weekDays<Entry>(
      due.map(({ day }) => ({ kind: 'day', day, parts: day.bodyParts })),
      (e) => (e.kind === 'day' ? e.day.id : e.routine.id),
      shape?.week ?? null,
      (i) => {
        const r = shape?.merged[i] ?? null;
        const m = shape?.week.merges[i];
        if (r === null || m === undefined) return null;
        return { kind: 'merged', routine: r, parts: [...new Set(split.days.filter((d) => m.dayIds.includes(d.id)).flatMap((d) => d.bodyParts))] };
      },
    );
    for (const e of avoidLegDays(entries, (x) => x.parts, near).order) {
      const why = isLegDay(e.parts) && near !== null ? near.why : null;
      if (e.kind === 'merged') {
        const run = await routineStart(p, { routineId: e.routine.id, gymId, opId: `preview-next-routine:${e.routine.id}`, preview: true, ...(gymEquipment ? { gymEquipment } : {}) });
        if (run.r.ok) return { plan: { kind: 'routine' as const, routine: e.routine, basis: { kind: 'split' } as UpNextRoutineBasis, run: { ...run, r: run.r }, why }, avoid: new Set<string>() };
        continue;
      }
      const plan = await splitDayPlan(p, live, split, e.day, workouts, gymId, gymEquipment, planDays, refs);
      if (plan !== null) return { plan: { ...plan, why }, avoid: new Set<string>() };
    }
    // No due day has a workout to plan from: the window's workouts that trained the day(s) just done (left out of `due`).
    const dueIds = new Set(due.map((d) => d.day.id));
    const justDone = due.length === 0 || dueIds.size === split.days.length ? new Set<string>() : new Set(split.days.filter((d) => !dueIds.has(d.id)).map((d) => d.id));
    // (review S6) With a long or hard run near, the fallbacks pass over leg workouts too (unless nothing else is left).
    const legDayIds = new Set(split.days.filter((d) => isLegDay(d.bodyParts)).map((d) => d.id));
    const passOver = (w: (typeof workouts)[number]) => splitDaysTrained(split, w.groups).some((d) => justDone.has(d) || (near !== null && legDayIds.has(d)));
    return { plan: null, avoid: new Set(workouts.filter(passOver).map((w) => w.sessionId)) };
  }

  /** One split day's Up next: its routine, else the newest workout (in the window) mainly that day; null when none. */
  async function splitDayPlan(
    p: UserProfile,
    live: readonly Routine[],
    split: TrainingSplit,
    day: SplitDay,
    workouts: readonly SplitWorkout[],
    gymId: string,
    gymEquipment: readonly EquipmentInstance[] | undefined,
    planDays: readonly Routine[] = [],
    refs: readonly FinishedRef[] = [],
  ) {
    // (19 Oct) The applied plan's workout for this split day first (two for one day alternate), then one named as the day.
    const fromPlan = planRoutineForSplitDay(planDays, day.id, refs);
    const routine = fromPlan ?? live.find((r) => isSplitDayName(r.name, day.name));
    if (routine !== undefined) {
      const run = await routineStart(p, { routineId: routine.id, gymId, opId: `preview-next-routine:${routine.id}`, preview: true, ...(gymEquipment ? { gymEquipment } : {}) });
      const at = planDays.findIndex((d) => d.id === routine.id);
      const basis: UpNextRoutineBasis = at >= 0 ? { kind: 'plan', dayN: at + 1, of: planDays.length } : { kind: 'split' };
      if (run.r.ok) return { kind: 'routine' as const, routine, basis, run: { ...run, r: run.r } };
    }
    const sessionId = splitDaySource(split, day, workouts)?.sessionId ?? null;
    if (sessionId === null) return null;
    const source = await repos().sessions.get(sessionId).catch(() => null);
    if (source === null || source.session.ownerId !== p.id || !isInHistory(source.session)) return null;
    // A workout from a saved routine: that routine, as Ben saved it.
    const own = live.find((r) => isFromRoutine({ sessionId, routineId: source.session.routineId }, r));
    if (own !== undefined) {
      const run = await routineStart(p, { routineId: own.id, gymId, opId: `preview-next-routine:${own.id}`, preview: true, ...(gymEquipment ? { gymEquipment } : {}) });
      if (run.r.ok) return { kind: 'routine' as const, routine: own, basis: { kind: 'split' } as UpNextRoutineBasis, run: { ...run, r: run.r } };
    }
    // Called what the started workout and Recent will call it: its own name, else its derived title (S5).
    return { kind: 'next' as const, sessionId };
  }

  /** Decision 2's source workout for Up next (`longestGapSource`), if it is still a readable, repeatable workout. */
  async function longestGapUpNext(p: UserProfile, live: readonly Routine[], avoid?: ReadonlySet<string>): Promise<string | null> {
    const index = await typeIndex(p, live);
    const newest = (await repos().sessions.listFinishedRefs(p.id, 1, { includeImported: true }))[0] ?? null;
    const pick = longestGapSource(index, newest, avoid);
    if (pick === null) return null;
    const source = await repos().sessions.get(pick.sessionId).catch(() => null);
    return source !== null && source.session.ownerId === p.id && isInHistory(source.session) ? pick.sessionId : null;
  }

  /** Up next (as Today's card, at this gym) or the routine asked for. */
  async function resolveOverview(p: UserProfile, target: OverviewTarget | OverviewStartOf, gym?: { gymId: string; gymEquipment?: readonly EquipmentInstance[] | undefined }): Promise<ResolvedOverview | null> {
    if ('kind' in target) {
      if (target.kind === 'routine') return resolveRoutine(p, target.routineId, null);
      if (target.kind === 'coach_draft') return resolveCoachDraft(p, target.draftId);
      if (target.kind === 'session') {
        // A picked session type (session-picker §2.3): `Last done Wed 7 Oct`. Start, drafts and the key are the `nextOf` ones.
        const picked = await resolveNext(p, target.sourceSessionId);
        return picked === null || picked.kind !== 'next' ? picked : { ...picked, basis: { kind: 'last_done', at: picked.source.session.startedAt } };
      }
      const up = await resolveUpNext(p, gym?.gymId ?? 'typical-gym-preview', gym?.gymEquipment);
      if (up === null) return null;
      if (up.kind === 'next') return resolveNext(p, up.sessionId);
      const basis: OverviewBasis | null = up.basis.kind === 'only' ? { kind: 'only' } : up.basis.kind === 'after' ? { kind: 'after', routineName: up.basis.routineName, at: { utc: up.basis.atUtc, tz: up.basis.tz } } : null;
      return resolveRoutine(p, up.routine.id, basis);
    }
    if (target.routineOf !== undefined) return resolveRoutine(p, target.routineOf, null);
    if (target.coachDraftOf !== undefined) return resolveCoachDraft(p, target.coachDraftOf);
    return resolveNext(p, target.nextOf);
  }

  /** The finished workout an overview's targets come from: the next session's source, or the routine's last workout. */
  async function overviewSource(resolved: ResolvedOverview): Promise<SessionAggregate | null> {
    if (resolved.kind === 'next') return resolved.source;
    // A coach draft's targets come from each exercise's own history (BD6), never from one source workout.
    if (resolved.kind === 'coach_draft') return null;
    return resolved.ref === null ? null : repos().sessions.get(resolved.ref.sessionId).catch(() => null);
  }

  /** The coach's stored next-session targets from a finished workout (D21), as saved. A read only; never calls the coach. */
  async function storedCoachTargets(ownerId: string, source: SessionAggregate | null): Promise<NextSessionTargetRecord[]> {
    if (source === null) return [];
    return coachTargetRows(await ctx.store().repos.coach.listNextTargets(ownerId, source.session.id));
  }

  // -------------------------------------------------------------------------
  // Today's edits (overview-today-edits.md, ADR 0022): the saved pre-start draft

  const NO_TODAY: TodayEditsInput = { draft: null, edits: [], swaps: new Map() };

  /** The page's draft against the live one: a different draft, or another version, is out of date (rule 5). Not given: no check. */
  function draftMismatch(seen: { id: string; expectedVersion: number } | null | undefined, live: PreStartDraft | null): boolean {
    if (seen === undefined) return false;
    if (seen === null || live === null) return seen !== live;
    return seen.id !== live.id || seen.expectedVersion !== live.version;
  }

  /** The draft row joins the start's fence, so a write to it after the check creates nothing (ADR 0022 §3). */
  function withDraftFence(fence: WriteFence | undefined, draft: PreStartDraft | null): WriteFence | undefined {
    if (draft === null) return fence;
    const row = { table: 'pre_start_drafts' as const, id: draft.id, version: draft.version };
    if (fence === undefined) return { rows: [row], sets: [] };
    return fence.rows.some((r) => r.table === 'pre_start_drafts') ? fence : { ...fence, rows: [...fence.rows, row] };
  }

  /** The draft basis a resolved overview edits. */
  const basisOf = (resolved: ResolvedOverview): DraftBasis =>
    resolved.kind === 'routine' ? { kind: 'routine', routineId: resolved.routine.id } : resolved.kind === 'coach_draft' ? { kind: 'coach_draft', draftId: resolved.draft.id } : { kind: 'next', sourceSessionId: resolved.source.session.id };
  const slotBasisOf = (resolved: ResolvedOverview) => (resolved.kind === 'next' ? { kind: 'next' as const, source: resolved.source } : { kind: 'routine' as const, routine: resolved.routine });

  /** The open draft for a basis; one past its local midnight reads as none (TE5). Reads only. */
  async function liveDraft(ownerId: string, basis: DraftBasis): Promise<PreStartDraft | null> {
    const d = await ctx.store().repos.drafts.open(ownerId, basis);
    return d !== null && draftIsLive(d, ctx.now().utc) ? d : null;
  }

  /** The `main` slots of the draft version a workout started from (none when it didn't, or the draft can't be read). */
  async function draftMains(ownerId: string, aggregate: SessionAggregate): Promise<ReadonlySet<string>> {
    const ref = aggregate.session.coachDraft;
    if (ref === undefined) return new Set();
    const d = await ctx.store().repos.workoutDrafts.get(ref.draftId).catch(() => null);
    if (d === null || d.ownerId !== ownerId) return new Set();
    const v = d.versions.find((x) => x.n === ref.version);
    return new Set((v?.plan.slots ?? []).filter((x) => x.main).map((x) => x.exerciseId));
  }

  /** An exercise by ID: Ben's list first, then the bundled catalogue's row (Coaching knowledge). */
  async function exerciseById(exerciseId: string): Promise<Exercise | null> {
    return (await repos().exercises.get(exerciseId).catch(() => null)) ?? ctx.catalogueExercises?.().find((e) => e.id === exerciseId) ?? null;
  }

  /** A picked catalogue exercise is saved as a row before a workout can use it (as `Add exercise` does). */
  /**
   * Other names each exercise is searched by (EL1): the catalogue's aliases
   * and Ben's own FitNotes names that map to it. A name that can't be read
   * just isn't searched; nothing is hidden or blocked.
   */
  async function aliasIndex(p: UserProfile | null): Promise<(e: Pick<Exercise, 'id' | 'name' | 'catalogueKey'>) => string[]> {
    const own = new Map<string, string[]>();
    const saved = p === null ? [] : await repos().imports.aliases(p.id).catch(() => []);
    for (const a of saved) if (a.target.kind === 'exercise') own.set(a.target.exerciseId, [...(own.get(a.target.exerciseId) ?? []), a.name]);
    return (e) => {
      const names = [...(e.catalogueKey ? (ctx.catalogueAliases?.(e.catalogueKey) ?? []) : []), ...(own.get(e.id) ?? [])];
      const self = e.name.trim().toLowerCase();
      return [...new Set(names)].filter((n) => n.trim().toLowerCase() !== self);
    };
  }

  async function ensureExercise(exerciseId: string): Promise<Exercise | null> {
    const stored = await repos().exercises.get(exerciseId).catch(() => null);
    if (stored) return stored;
    const row = ctx.catalogueExercises?.().find((e) => e.id === exerciseId) ?? null;
    if (row === null) return null;
    const saved = await repos().exercises.save(row, null).catch(() => null);
    return saved?.ok === true || (await repos().exercises.get(exerciseId).catch(() => null)) !== null ? row : null;
  }

  /** Ben's items at every gym (a history row's item may be at another gym, GS3). */
  async function allEquipment(ownerId: string): Promise<Map<string, EquipmentInstance>> {
    const out = new Map<string, EquipmentInstance>();
    for (const g of await repos().gyms.listByOwner(ownerId)) for (const e of await repos().equipment.listByGym(g.id)) out.set(e.id, e);
    return out;
  }

  /** What `substituteTargets` and `rankSubstitutions` need at a gym (local reads only). */
  /**
   * `carryFrom`: the exercise being swapped. An active pain flag on it holds
   * the substitute today (B5, rule 9): it is planned as if pain was reported.
   */
  async function substituteCtx(p: UserProfile, gymId: string, gymEquipment: readonly EquipmentInstance[] | undefined, today: CheckIn | null, exerciseIds: Iterable<string>, carryFrom?: string) {
    const at = ctx.now();
    const gym = await repos().gyms.get(gymId).catch(() => null);
    const painFlags = await repos().painFlags.listActive(p.id);
    const checkInPain = unspecifiedPain(today);
    const carried = carryFrom === undefined ? { active: false, reportedAtUtc: null } : painStatusFor(painFlags, carryFrom);
    return {
      ownerId: p.id,
      unit: p.preferredUnit,
      gym: { id: gymId, name: gym?.name ?? 'this gym', equipment: gymEquipment ?? (await repos().equipment.listByGym(gymId)) },
      knownEquipment: await allEquipment(p.id),
      lastUsedHere: await lastUsedFor(p.id, exerciseIds, gymId),
      painFlags,
      sessionPain: checkInPain.active ? checkInPain : carried,
      painCarried: carried.active,
      at,
      nowMs: toMs(at.utc),
    };
  }

  /**
   * `substituteCtx` for a running workout: its current gym's items as the
   * workout has them, and its check-in. Pain on the row being swapped (a
   * flag, or a set marked `pain`) holds the substitute today (B5, rule 9):
   * it is planned as if pain was reported in this workout.
   */
  async function midSwapCtx(p: UserProfile, aggregate: SessionAggregate, exerciseIds: Iterable<string>, fromSessionExerciseId: string) {
    const ci = aggregate.session.checkIn?.kind === 'answered' ? await repos().checkIns.get(aggregate.session.checkIn.checkInId).catch(() => null) : null;
    const gymId = aggregate.session.gymId ?? 'no-gym';
    const base = await substituteCtx(p, gymId, currentGymEquipment(aggregate.session), ci ?? null, exerciseIds);
    const carried = swapPainCarry(aggregate, fromSessionExerciseId, base.painFlags);
    return { ...base, sessionPain: base.sessionPain.active ? base.sessionPain : carried, painCarried: carried.active };
  }

  /**
   * Today's edits as the planner takes them (TE2): the live draft's edits and
   * each swapped slot's own plan (`substituteTargets`: the substitute's own
   * history at this gym, never the original's load). No draft: no edits.
   */
  async function todayFor(p: UserProfile, resolved: ResolvedOverview, gymId: string, gymEquipment: readonly EquipmentInstance[] | undefined, today: CheckIn | null): Promise<{ draft: PreStartDraft | null; input: TodayEditsInput }> {
    return todayForDraft(p, resolved, gymId, gymEquipment, today, await liveDraft(p.id, basisOf(resolved)));
  }

  /** `todayFor` with a given draft (the coach's fit plans the draft it is about to write). */
  async function todayForDraft(p: UserProfile, resolved: ResolvedOverview, gymId: string, gymEquipment: readonly EquipmentInstance[] | undefined, today: CheckIn | null, draft: PreStartDraft | null): Promise<{ draft: PreStartDraft | null; input: TodayEditsInput }> {
    // A coach draft always has a fit (its `fitMinutes`, BD11): the same pace and pain holds as the TIME tile.
    if (draft === null) return { draft: null, input: resolved.kind === 'coach_draft' ? { ...NO_TODAY, fit: await fitContext(p) } : NO_TODAY };
    const edits = liveEdits(draft.edits);
    const swaps = new Map<string, SwapPlan>();
    const sb = slotBasisOf(resolved);
    for (const e of edits) {
      if (e.kind !== 'swap') continue;
      const slot = substituteSlotOf(sb, e.slotKey);
      const exercise = await exerciseById(e.toExerciseId);
      if (slot === null || exercise === null) continue;
      const history = await historyFor(p.id, exercise.id).catch(() => [] as HistorySession[]);
      const from = basisSlots(sb).find((b) => b.slotKey === e.slotKey)?.exerciseId;
      swaps.set(e.slotKey, substituteTargets(slot, exercise, history, await substituteCtx(p, gymId, gymEquipment, today, [exercise.id], from)));
    }
    // Added exercises (§11, TE16): each from its own history through the same path as a swap, never another exercise's load.
    const adds = new Map<string, SwapPlan>();
    for (const e of edits) {
      if (e.kind !== 'add') continue;
      const exercise = await exerciseById(e.exerciseId);
      if (exercise === null) continue;
      const history = await historyFor(p.id, exercise.id).catch(() => [] as HistorySession[]);
      adds.set(e.slotKey, addTargets(exercise, history, await substituteCtx(p, gymId, gymEquipment, today, [exercise.id])));
    }
    // Fit to time (FT4): the pace the TIME tile uses and which movements a pain flag holds; read only with a live fit.
    const fit = edits.some((e) => e.kind === 'fit') || resolved.kind === 'coach_draft' ? await fitContext(p) : undefined;
    return { draft, input: { draft: { id: draft.id, version: draft.version }, edits, swaps, adds, ...(fit ? { fit } : {}) } };
  }

  /** What the built-in trim reads besides the plan (fit-to-time §4.1): Ben's recent pace and the active pain flags. Local only. */
  async function fitContext(p: UserProfile): Promise<NonNullable<TodayEditsInput['fit']>> {
    const at = ctx.now();
    const flags = await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
    return { pace: planPace(await recentFinished(p)), held: (exerciseId) => painFlagCovering(flags, exerciseId, toMs(at.utc), at.tz) !== null };
  }

  /** The overview's view of today's edits (§6.2): slot keys, today's order, what each applied edit did, and the live fit. */
  async function overviewToday(resolved: ResolvedOverview, info: TodayPlanInfo | null, draft: PreStartDraft | null): Promise<OverviewToday | null> {
    if (info === null) return null;
    const swapped = new Map<string, { editId: string; fromExerciseId: string; fromName: string }>();
    for (const [slotKey, sw] of info.resolved.swaps) {
      const base = info.baseSlots.find((b) => b.slotKey === slotKey);
      if (base === undefined) continue;
      const fromName = resolved.kind === 'next' ? resolved.source.exercises.find((x) => x.id === slotKey)?.exerciseName : (await exerciseById(base.exerciseId))?.name;
      swapped.set(slotKey, { editId: sw.editId, fromExerciseId: base.exerciseId, fromName: fromName ?? 'Exercise' });
    }
    return overviewTodayOf(info, { swapped, draft: draft === null ? null : { id: draft.id, version: draft.version }, routineName: resolved.kind === 'routine' ? resolved.routine.name : null });
  }

  /** The live coach fit's record for the page (`Why?`, suggestions), or null. Never throws. */
  async function coachFitInfo(info: TodayPlanInfo | null): Promise<CoachFitInfo | null> {
    const fit = info?.fit ?? null;
    if (info === null || fit === null || fit.by !== 'coach' || fit.actionId === null) return null;
    const record = await ctx.store().repos.coach.getAction(fit.actionId).catch(() => null);
    if (record === null || record.detail.kind !== 'fit_today') return null;
    const d = record.detail;
    const swappedTo = new Map([...info.resolved.swaps].map(([k, v]) => [k, v.toExerciseId]));
    return {
      actionId: record.actionId,
      reason: record.reason,
      // The checks every coach fit passed (§7.2 `Why?`): app text, not the model's.
      checks: [FIT_CHECKS.unchanged, ...(fit.lines.some((l) => l.kind === 'add') ? [FIT_CHECKS.own] : []), ...(d.rejected.length > 0 ? [FIT_CHECKS.dropped(d.rejected.length)] : [])],
      rejected: d.rejected.map((r) => r.text),
      suggestions: d.suggestions.filter((x) => swappedTo.get(x.slotKey) !== x.toExerciseId),
    };
  }

  /** `Update Push A ›` (§11.5): today's template-able edits as lines, against the workout as read. */
  async function templateCardOf(resolved: ResolvedOverview, run: { aggregate: SessionAggregate; today: TodayPlanInfo | null }, draft: Pick<PreStartDraft, 'id' | 'version'> | null): Promise<OverviewData['templateCard']> {
    if (resolved.kind !== 'routine' || run.today === null || draft === null) return null;
    const names = new Map<string, string>();
    for (const id of new Set([...resolved.routine.exercises.map((e) => e.exerciseId), ...[...run.today.resolved.swaps.values()].map((x) => x.toExerciseId), ...[...run.today.resolved.added.values()].map((x) => x.exerciseId)])) {
      names.set(id, (await exerciseById(id))?.name ?? 'Exercise');
    }
    const lines = templateLinesFromEdits({ routine: resolved.routine, resolved: run.today.resolved, today: todayShapes(run.aggregate, run.today.slotOf), nameOf: (id) => names.get(id) ?? 'Exercise' });
    return lines.length === 0 ? null : { routineId: resolved.routine.id, routineName: resolved.routine.name, routineVersion: resolved.routine.version, draftId: draft.id, draftVersion: draft.version, lines };
  }

  /** `previewKey` inputs as stored now (workout-overview §7). `gymId` null: the typical gym Start will save. */
  /** The newest finished workout (app or imported) and its revision: new or corrected history changes a coach draft's key (WB-L12). */
  async function newestFinished(ownerId: string): Promise<{ sessionId: string; revision: number } | null> {
    const ref = (await repos().sessions.listFinishedRefs(ownerId, 1, { includeImported: true }).catch(() => []))[0];
    if (ref === undefined) return null;
    const a = await repos().sessions.get(ref.sessionId).catch(() => null);
    return { sessionId: ref.sessionId, revision: a?.revision ?? 0 };
  }

  async function previewKeyParts(p: UserProfile, resolved: ResolvedOverview, gymId: string | null, checkIn: CheckIn | null, draft: PreStartDraft | null = null): Promise<PreviewKeyParts> {
    const equipment = gymId === null ? null : await repos().equipment.listByGym(gymId);
    const source = await overviewSource(resolved);
    const flags = await repos().painFlags.listActive(p.id);
    const coachRows = await storedCoachTargets(p.id, source);
    return {
      target:
        resolved.kind === 'routine'
          ? { kind: 'routine', routineId: resolved.routine.id }
          : resolved.kind === 'coach_draft'
            ? { kind: 'coach_draft', draftId: resolved.draft.id }
            : { kind: 'next', sourceSessionId: resolved.source.session.id },
      routine: resolved.kind === 'routine' ? { id: resolved.routine.id, version: resolved.routine.version } : null,
      // A coach draft's version: a new version, a discard or a start since the page loaded makes Start create nothing (§6.3).
      ...(resolved.kind === 'coach_draft' ? { coachDraft: { id: resolved.draft.id, version: resolved.draft.version }, history: await newestFinished(p.id) } : {}),
      gym: gymId === null || equipment === null ? { typical: true } : { id: gymId, equipment: equipment.map((e) => ({ id: e.id, version: e.version })) },
      source: source === null ? null : { id: source.session.id, revision: source.revision },
      painFlags: flags.map((f) => ({ id: f.id, version: f.version })),
      coachActions: coachRows.map((r) => ({ id: r.id, version: r.version })),
      unit: p.preferredUnit,
      checkIn: checkIn === null ? null : { id: checkIn.id, version: checkIn.version },
      draft: draft === null ? null : { id: draft.id, version: draft.version },
    };
  }

  /**
   * The dry run Start uses (workout-overview §7): the same planner, the same
   * targets and the same gym check, with `preview: true`. `gymEquipment`: the
   * typical gym's items when there is no gym yet.
   */
  async function overviewDryRun(
    p: UserProfile,
    resolved: ResolvedOverview,
    gymId: string,
    today: CheckIn | null,
    gymEquipment?: readonly EquipmentInstance[],
    todayEdits: TodayEditsInput = NO_TODAY,
  ): Promise<{ aggregate: SessionAggregate; fits: Record<string, SetFit>; today: TodayPlanInfo | null; draftWhy?: Record<string, DraftSlotWhy> } | null> {
    const newId = previewIds();
    if (resolved.kind === 'coach_draft') {
      const r = await coachDraftStart(p, resolved.draft, { gymId, opId: 'overview-preview', preview: true, today, newId, todayEdits, ...(gymEquipment ? { gymEquipment } : {}) });
      return r.ok ? { aggregate: r.aggregate, fits: r.fits, today: r.today, draftWhy: r.draftWhy ?? {} } : null;
    }
    if (resolved.kind === 'routine') {
      const { r } = await routineStart(p, { routineId: resolved.routine.id, gymId, opId: 'overview-preview', preview: true, today, newId, todayEdits, ...(gymEquipment ? { gymEquipment } : {}) });
      return r.ok ? { aggregate: r.aggregate, fits: r.fits, today: r.today } : null;
    }
    const targets = await nextTargetsOf(p, resolved.source, today).catch(() => null);
    // The same history mapping Start uses, so the preview is what Start creates (gym-switch GS3).
    const lastUsedHere = await lastUsedFor(p.id, [...resolved.source.exercises.map((e) => e.exerciseId), ...swapExerciseIds(todayEdits)], gymId);
    const r = await createSessionService(repos(), newId, { deloadAt }).startFromSession({
      ownerId: p.id,
      gymId,
      routineId: null,
      opId: 'overview-preview',
      at: ctx.now(),
      sourceSessionId: resolved.source.session.id,
      preview: true,
      targets: targets ?? new Map(),
      name: upNextName(resolved.source) ?? GENERIC_WORKOUT_NAME,
      // A cut-short source is planned whole, so the estimate is its full plan's (review today-18oct S2).
      includeNotDone: cutShort(resolved.source),
      lastUsedHere,
      today: todayEdits,
      ...(gymEquipment ? { gymEquipment } : {}),
    });
    return r.ok ? { aggregate: r.aggregate, fits: r.fits, today: r.today } : null;
  }

  /** Ben's last 5 finished workouts (pace for the estimate), newest first. Never throws. */
  async function recentFinished(p: UserProfile): Promise<SessionAggregate[]> {
    try {
      const refs = (await repos().sessions.listFinishedRefs(p.id, 5)).map((r) => r.sessionId);
      const out: SessionAggregate[] = [];
      for (const id of refs) {
        const x = await repos().sessions.get(id).catch(() => null);
        if (x) out.push(x);
      }
      return out;
    } catch {
      return [];
    }
  }

  const workout = {
    /**
     * (12 Oct) What the coach's `add_exercise_today` check needs at the
     * workout's current gym (local reads only, no AI): the exercise by ID or
     * catalogue key (Ben's own, else the catalogue's), its history, the gym's
     * items with the workout's check-in pain, the other IDs of the same
     * movement (review S2) and Ben's profile. Nothing is saved here (review
     * S3): a catalogue exercise not yet in Ben's exercises comes back with
     * `exerciseUnsaved` and is saved in the add's own write. Null when there's
     * no profile.
     */
    async coachAddInputs(exerciseId: string, aggregate: SessionAggregate): Promise<{ exercise: Exercise | null; history: HistorySession[]; substitute: SubstituteContext; owner: UserProfile; sameMovementIds: string[]; exerciseUnsaved: boolean } | null> {
      const p = await ctx.profile();
      if (!p) return null;
      // Review exlist S5: a deleted exercise of Ben's can't be added by the coach, even by ID.
      const mine = (e: Exercise | null | undefined): Exercise | null => (e !== null && e !== undefined && (e.ownerId === null || e.ownerId === p.id) && !isArchivedExercise(e) ? e : null);
      const saved = (await repos().exercises.list().catch(() => [] as Exercise[])).filter((e) => mine(e) !== null);
      const catalogue = (ctx.catalogueExercises?.() ?? []).filter((e) => mine(e) !== null);
      const fromSaved = saved.find((e) => e.id === exerciseId) ?? saved.find((e) => e.catalogueKey === exerciseId) ?? null;
      const fromCatalogue = fromSaved === null ? (catalogue.find((e) => e.id === exerciseId || e.catalogueKey === exerciseId) ?? null) : null;
      // A catalogue entry already saved under its own ID is Ben's row.
      const exercise = fromSaved ?? (fromCatalogue === null ? null : (saved.find((e) => e.id === fromCatalogue.id) ?? fromCatalogue));
      const exerciseUnsaved = exercise !== null && !saved.some((e) => e.id === exercise.id);
      const ci = await sessionCheckIn(aggregate).catch(() => null);
      const gymId = aggregate.session.gymId ?? 'no-gym';
      const substitute = await substituteCtx(p, gymId, currentGymEquipment(aggregate.session), ci, exercise === null ? [] : [exercise.id]);
      const history = exercise === null ? [] : await historyFor(p.id, exercise.id).catch(() => [] as HistorySession[]);
      const sameMovement = exercise === null ? [] : sameMovementIds(exercise, [...saved, ...catalogue]).filter((id) => id !== exercise.id);
      return { exercise, history, substitute, owner: p, sameMovementIds: [...new Set(sameMovement)], exerciseUnsaved };
    },

    /**
     * The built-in rule's next targets for a finished workout (the summary
     * turn's comparison and fallback, D21). Never the coach's own.
     */
    async builtInNextTargets(sessionId: string, reps?: Map<string, RuleReps>): Promise<Map<string, { setType: SetType; planned: PlannedSet }[]> | null> {
      const p = await ctx.profile();
      const source = await repos().sessions.get(sessionId);
      if (!p || !source) return null;
      return builtInNextTargetsOf(p, source, null, reps).catch(() => null);
    },

    /**
     * Up next's name as Today's card shows it (routine name, the source's own name, else its derived
     * title), for the coach's build context (review today-18oct S1). Null: no Up next or unreadable.
     */
    async upNextTitle(gymId: string | null): Promise<string | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const up = await resolveUpNext(p, gymId ?? 'typical-gym-preview');
        if (up === null) return null;
        if (up.kind === 'routine') return up.routine.name;
        const source = await repos().sessions.get(up.sessionId);
        if (!source) return null;
        return upNextName(source) ?? (await titleFor(liveExercises(source.exercises).map((e) => e.exerciseId))).title;
      } catch {
        return null;
      }
    },

    /**
     * `startWorkout(…, opts.checkIn)` for an empty workout (no routines yet).
     * A gym is required (PM SP1). An answered check-in is linked in the same
     * write as the session; one already linked to another workout is refused.
     */
    async start(req: WorkoutStartRequest): Promise<WorkoutStartOutcome> {
      const r = await workout.startOnce(req);
      if (r.ok) ctx.afterStart?.(r.aggregate);
      if (r.ok || (r.error.code !== 'write_failed' && r.error.code !== 'write_conflict')) return r;
      // Two taps raced and the other one's write landed (OV5): this tap is its duplicate, not a failure.
      const p = await ctx.profile();
      const landed = p ? await repos().sessions.findByStartOperation(p.id, req.opId).catch(() => null) : null;
      return landed ? { ok: true, aggregate: landed, warnings: [], duplicate: true } : r;
    },

    async startOnce(req: WorkoutStartRequest): Promise<WorkoutStartOutcome> {
      const p = await ctx.profile();
      if (!p) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
      let fence = req.fence;
      if (req.expectedPreviewKey !== undefined && (req.routineOf || req.nextOf || req.coachDraftOf)) {
        const check = await workout.previewCheck(p, {
          startOf: req.routineOf ? { routineOf: req.routineOf } : req.coachDraftOf ? { coachDraftOf: req.coachDraftOf } : { nextOf: req.nextOf ?? '' },
          gymId: req.gymId,
          opId: req.opId,
          checkIn: req.checkIn,
          expectedPreviewKey: req.expectedPreviewKey,
        });
        if (check.kind === 'stale') {
          // A racing tap with the same opId may have just landed (it moved the inputs): that is this tap's duplicate (OV5).
          const landed = await repos().sessions.findByStartOperation(p.id, req.opId).catch(() => null);
          return landed ? { ok: true, aggregate: landed, warnings: [], duplicate: true } : { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
        }
        if (check.kind === 'fresh') fence = check.fence;
      }
      let checkIn = req.checkIn;
      if (checkIn?.kind === 'answered') {
        const already = await repos().sessions.findByStartOperation(p.id, req.opId);
        const linked = await repos().checkIns.linkedIds([checkIn.checkInId]);
        // Linked to another workout (not this start's retry): start without it rather than block.
        if (linked.has(checkIn.checkInId) && already?.session.checkIn?.kind !== 'answered') checkIn = { kind: 'skipped', atUtc: ctx.now().utc };
      }
      if (req.coachDraftOf) {
        // A coach-built draft (workout-builder §6.3): the same planner path the page showed; the session names the draft.
        const already = await repos().sessions.findByStartOperation(p.id, req.opId);
        if (already) return { ok: true, aggregate: already, warnings: [], duplicate: true };
        const today = checkIn?.kind === 'answered' ? await repos().checkIns.get(checkIn.checkInId) : null;
        const resolvedD = await resolveCoachDraft(p, req.coachDraftOf);
        // Discarded, started or past its 14 days since the page loaded: nothing is created (§5.2).
        if (resolvedD === null || resolvedD.kind !== 'coach_draft') return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
        const t = await todayFor(p, resolvedD, req.gymId, undefined, today);
        if (draftMismatch(req.draft, t.draft)) return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
        const draftFence = withDraftFence(fence, t.draft);
        // A builder draft's version is pinned in the write: an edit since the page loaded creates nothing (rule 5).
        const b = req.builder;
        const fenced: WriteFence | undefined = b === undefined ? draftFence : { rows: [...(draftFence?.rows ?? []), { table: 'workout_drafts', id: resolvedD.draft.id, version: b.expectedVersion }], sets: draftFence?.sets ?? [] };
        // (22 Oct) Your workout opened on a library workout or a past one: the workout its targets follow on from is noted, as those Starts always did.
        // Before the start, by design (persistence `noteStartFrom`): the note counts only while a session with this op ID exists, so a refused start
        // leaves it inert, and a force-close after the start can't leave the coach's targets unused for a second workout (review S2: no change).
        const from = resolvedD.draft.builderKey?.from;
        if (from?.kind === 'session') await noteStartFrom(p.id, from.id, req.opId);
        else if (from?.kind === 'routine') {
          const r = await repos().routines.get(from.id).catch(() => null);
          const ref = r === null ? null : ((await finishedRefs(p.id)).find((f) => isFromRoutine(f, r)) ?? null);
          if (ref !== null) await noteStartFrom(p.id, ref.sessionId, req.opId);
        }
        const r = await coachDraftStart(p, resolvedD.draft, { gymId: req.gymId, opId: req.opId, preview: false, checkIn, today, todayEdits: t.input, ...(fenced ? { fence: fenced } : {}), ...(b?.planDay === undefined ? {} : { planDay: b.planDay }), ...(b?.alongside === undefined ? {} : { alongside: b.alongside }) });
        if (!r.ok) {
          // Two taps raced and the other one's start landed (OV5): this tap is its duplicate.
          const landed = await repos().sessions.findByStartOperation(p.id, req.opId).catch(() => null);
          if (landed) return { ok: true, aggregate: landed, warnings: [], duplicate: true };
          if (r.alongside !== undefined) return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW, alongside: r.alongside } };
          const e = r.error;
          if (e.code === 'nothing_to_start') return { ok: false, error: { code: 'not_found', message: e.message } };
          if (e.code === 'stale_inputs') return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
          return { ok: false, error: e };
        }
        return { ok: true, aggregate: r.aggregate, warnings: [], duplicate: r.duplicate };
      }
      if (req.routineOf) {
        // A routine (premium-feel §2.6): its structure, with next targets from its last workout, fitted to this gym.
        const today = checkIn?.kind === 'answered' ? await repos().checkIns.get(checkIn.checkInId) : null;
        // Today's edits (ADR 0022): the live draft for this routine, the same one the page planned with.
        const resolvedR = await resolveRoutine(p, req.routineOf, null);
        const t = resolvedR === null ? { draft: null, input: NO_TODAY } : await todayFor(p, resolvedR, req.gymId, undefined, today);
        if (draftMismatch(req.draft, t.draft) && !(await repos().sessions.findByStartOperation(p.id, req.opId))) return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
        const fenced = withDraftFence(fence, t.draft);
        const { r, targetsFailed } = await routineStart(p, { routineId: req.routineOf, gymId: req.gymId, opId: req.opId, preview: false, checkIn, today, noteSource: true, todayEdits: t.input, ...(fenced ? { fence: fenced } : {}) });
        if (!r.ok) {
          const e = r.error;
          if (e.code === 'nothing_to_start') return { ok: false, error: { code: 'not_found', message: e.message } };
          if (e.code === 'stale_inputs') return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
          return { ok: false, error: e };
        }
        const notice = targetsFailed && !r.duplicate ? 'Using saved targets.' : null;
        return { ok: true, aggregate: r.aggregate, warnings: [], duplicate: r.duplicate, ...(notice !== null ? { notice } : {}) };
      }
      if (req.nextOf) {
        // "Start next session" (audit B2): last workout's exercises with the built-in rule's next targets.
        const source = await repos().sessions.get(req.nextOf);
        if (!source) return { ok: false, error: { code: 'not_found', message: 'That workout wasn’t found.' } };
        const today = checkIn?.kind === 'answered' ? await repos().checkIns.get(checkIn.checkInId) : null;
        // Targets that can't be worked out repeat last time's numbers, and the workout says so (review S2).
        const targets = await nextTargetsOf(p, source, today).catch(() => null);
        // No derived name (`Push`) is stored as if Ben chose it; titles are worked out when shown (review S3).
        // Same history mapping as the overview's preview, so Start gives what the page showed (gym-switch GS3).
        const resolvedN = await resolveNext(p, source.session.id);
        const t = resolvedN === null ? { draft: null, input: NO_TODAY } : await todayFor(p, resolvedN, req.gymId, undefined, today);
        const lastUsedHere = await lastUsedFor(p.id, [...source.exercises.map((e) => e.exerciseId), ...swapExerciseIds(t.input)], req.gymId);
        if (draftMismatch(req.draft, t.draft) && !(await repos().sessions.findByStartOperation(p.id, req.opId))) return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
        const fenced = withDraftFence(fence, t.draft);
        await noteStartFrom(p.id, source.session.id, req.opId);
        const r = await domain().startFromSession({
          ownerId: p.id,
          gymId: req.gymId,
          routineId: null,
          opId: req.opId,
          at: ctx.now(),
          checkIn,
          sourceSessionId: req.nextOf,
          targets: targets ?? new Map(),
          name: upNextName(source) ?? GENERIC_WORKOUT_NAME,
          includeNotDone: cutShort(source),
          lastUsedHere,
          today: t.input,
          ...(fenced ? { fence: fenced } : {}),
        });
        if (!r.ok) {
          const e = r.error;
          if (e.code === 'nothing_to_repeat') return { ok: false, error: { code: 'not_found', message: e.message } };
          if (e.code === 'stale_inputs') return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
          return { ok: false, error: e };
        }
        return { ok: true, aggregate: r.aggregate, warnings: [], duplicate: r.duplicate, ...(targets === null && !r.duplicate ? { notice: TARGETS_UNAVAILABLE } : {}) };
      }
      if (req.repeatOf) {
        // Repeat a past workout (routines.md RT4): its actuals become today's targets.
        // Same history mapping as the preview, so Start gives what the preview showed (GS10).
        const source = await repos().sessions.get(req.repeatOf);
        const lastUsedHere = await lastUsedFor(p.id, source?.exercises.map((e) => e.exerciseId) ?? [], req.gymId);
        const r = await domain().startFromSession({ ownerId: p.id, gymId: req.gymId, routineId: null, opId: req.opId, at: ctx.now(), checkIn, sourceSessionId: req.repeatOf, lastUsedHere });
        if (!r.ok) {
          const e = r.error;
          if (e.code === 'nothing_to_repeat') return { ok: false, error: { code: 'not_found', message: e.message } };
          return { ok: false, error: e };
        }
        return { ok: true, aggregate: r.aggregate, warnings: [], duplicate: r.duplicate };
      }
      return domain().start({ ownerId: p.id, gymId: req.gymId, routineId: null, opId: req.opId, at: ctx.now(), checkIn });
    },

    /**
     * Whether the overview a Start came from is out of date (rule 5).
     * `duplicate` when this opId already started a workout (a retry after
     * success). `fresh` carries the rows the key was read from, so the write
     * re-checks them inside its transaction (§7): a change that lands after
     * this check (a late coach write, CA10) still creates nothing.
     * `gymId` null: checked against the typical gym Start is about to save.
     */
    async previewCheck(p: UserProfile, req: { startOf: OverviewStartOf; gymId: string | null; opId: string; checkIn: SessionCheckIn | null; expectedPreviewKey: string }): Promise<PreviewCheck> {
      if (await repos().sessions.findByStartOperation(p.id, req.opId)) return { kind: 'duplicate' };
      const resolved = await resolveOverview(p, req.startOf);
      if (resolved === null) return { kind: 'stale' };
      const ci = req.checkIn?.kind === 'answered' ? await repos().checkIns.get(req.checkIn.checkInId) : null;
      const parts = await previewKeyParts(p, resolved, req.gymId, ci, await liveDraft(p.id, basisOf(resolved)));
      if (previewKey(parts) !== req.expectedPreviewKey) return { kind: 'stale' };
      return { kind: 'fresh', fence: previewFence(parts, p.id, req.gymId === null ? null : { id: p.id, version: p.version }) };
    },

    /**
     * What a record check needs that the write doesn't change (premium-feel
     * §5.1, review S1): the exercise's finished history, gym and equipment.
     * Read when a set is focused, so the log haptic can be decided right
     * after the write without any database read. Null: no record possible
     * or the read failed (never blocks logging).
     */
    async recordContext(sessionId: string, setId: string): Promise<RecordContext | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const aggregate = await repos().sessions.get(sessionId);
        const set = aggregate?.sets.find((s) => s.id === setId);
        const ex = set ? aggregate?.exercises.find((e) => e.id === set.sessionExerciseId) : undefined;
        if (!aggregate || !set || !ex) return null;
        const history = (await historyFor(p.id, ex.exerciseId)).filter((h) => h.sessionId !== aggregate.session.id);
        // The version of the item this row uses; a row left at another gym after a switch names that gym (records are per item).
        const equipment = equipmentOfRow(aggregate.session.equipmentSnapshot, ex);
        const gymId = equipment !== null && (aggregate.session.gymChanges?.length ?? 0) > 0 ? equipment.gymId : aggregate.session.gymId;
        const gym = gymId === null ? null : await repos().gyms.get(gymId);
        return {
          setId,
          sessionExerciseId: ex.id,
          base: { exerciseName: ex.exerciseName, gymName: gym?.name ?? null, equipmentId: ex.equipmentId, convention: ex.loadConvention, measurement: ex.measurement, equipment, history },
        };
      } catch {
        return null;
      }
    },

    /**
     * The record for a just-logged set from a context read earlier, with no
     * database read. `undefined`: the context doesn't fit this set any more
     * (another set, or the exercise's equipment or convention changed), so
     * the caller reads it again with `setRecord`.
     */
    recordOf(context: RecordContext, aggregate: SessionAggregate, setId: string): SetRecord | null | undefined {
      return recordFromContext(context, aggregate, setId);
    },

    /**
     * The heaviest-set line for a set just logged (premium-feel §5.1), or
     * null. Read after the write; never blocks or fails logging (any error
     * reads as no record).
     */
    async setRecord(sessionId: string, setId: string): Promise<SetRecord | null> {
      try {
        const context = await workout.recordContext(sessionId, setId);
        const aggregate = context === null ? null : await repos().sessions.get(sessionId);
        if (context === null || !aggregate) return null;
        return recordFromContext(context, aggregate, setId) ?? null;
      } catch {
        return null;
      }
    },

    /**
     * The last comparable session's sets for one exercise row of a workout, as
     * the card's prefill reads them (`load` → `previous`), for the spoken
     * "Rest done. Set 2 …" (voice review B1). Empty when none or unreadable.
     */
    async lastComparableSets(state: SessionAggregate, sessionExerciseId: string): Promise<ComparableSet[]> {
      try {
        const p = await ctx.profile();
        const ex = state.exercises.find((e) => e.id === sessionExerciseId);
        if (!p || !ex) return [];
        const h = (await historyFor(p.id, ex.exerciseId)).filter((x) => x.sessionId !== state.session.id);
        return lastComparableSession(h, ex)?.sets ?? [];
      } catch {
        return [];
      }
    },

    /** Everything the Active workout screen needs, read once per change. */
    async load(sessionId?: string): Promise<ActiveWorkoutData | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const aggregate = sessionId ? await repos().sessions.get(sessionId) : await repos().sessions.getActive(p.id);
      if (!aggregate) return null;
      const gym = aggregate.session.gymId === null ? null : await repos().gyms.get(aggregate.session.gymId);
      const previous: Record<string, PreviousSession | null> = {};
      const byExercise = new Map<string, HistorySession[]>();
      for (const ex of aggregate.exercises) {
        let h = byExercise.get(ex.exerciseId);
        if (!h) {
          // A past record that can't be read never stops today's logging: no `Last` line instead (review S2).
          h = (await historyFor(p.id, ex.exerciseId).catch(() => [] as HistorySession[])).filter((x) => x.sessionId !== aggregate.session.id);
          byExercise.set(ex.exerciseId, h);
        }
        previous[ex.id] = lastComparableSession(h, ex);
      }
      const flags = await repos().painFlags.listActive(p.id);
      // The Lock Screen and spoken cues hold back a heavier carried load on a flagged movement too (21 Oct).
      if (aggregate.session.status === 'active') setActivePainFlagged(new Set(flags.map((f) => f.exerciseId)));
      const ci = aggregate.session.checkIn?.kind === 'answered' ? await repos().checkIns.get(aggregate.session.checkIn.checkInId) : null;
      const title = storedName(aggregate) === null && aggregate.exercises.length > 0 ? (await titleFor(liveExercises(aggregate.exercises).map((e) => e.exerciseId))).title : null;
      const pace = await recentPace(p.id, aggregate.session.id, toMs(ctx.now().utc));
      const exerciseInfo: Record<string, RuleExerciseInfo | null> = {};
      const bodyweightExercises = new Set<string>();
      const worksLines: Record<string, string | null> = {};
      const builderInfo: Record<string, BuilderExerciseInfo | null> = {};
      for (const id of new Set(aggregate.exercises.map((e) => e.exerciseId))) {
        const e = await exerciseById(id).catch(() => null);
        exerciseInfo[id] = e;
        worksLines[id] = e === null ? null : worksLine(e);
        builderInfo[id] = e === null ? null : builderInfoOf(e);
        if (e?.defaultLoadConvention === 'bodyweight') bodyweightExercises.add(id);
      }
      return {
        exerciseInfo,
        bodyweightExercises,
        worksLines,
        builderInfo,
        mainExerciseIds: await draftMains(p.id, aggregate),
        aggregate,
        gymName: gym?.name ?? null,
        gymNames: await gymNamesOf(p.id),
        previous,
        painFlagged: new Set(flags.map((f) => f.exerciseId)),
        painFlags: flags,
        effortScale: p.effortScale,
        checkIn: ci,
        title,
        recentPace: pace,
      };
    },

    /** `buildActiveSetView` over loaded data plus the screen's unsaved edits. */
    view(data: ActiveWorkoutData, nowMs: number, edits: DraftEdits | null): ActiveSetView {
      // `Time left` has one source on this screen: `timeLeft` below, on its own minute clock (review N4).
      const info = data.exerciseInfo ?? {};
      const ruleTargetRpe = ruleTargetRpes(data.aggregate, (id) => (id in info ? (info[id] ?? null) : undefined));
      return buildActiveSetView({ aggregate: data.aggregate, nowMs, gymName: data.gymName, gymNames: data.gymNames, previous: data.previous, painFlagged: data.painFlagged, painFlags: data.painFlags, edits, title: data.title, withTimeLeft: false, ruleTargetRpe, ...warmupInputOf(data), ...(data.bodyweightExercises ? { bodyweightExercises: data.bodyweightExercises } : {}) });
    },

    /**
     * `buildWorkoutTableView` (active-workout §2A.12) over the same input as
     * `view`, so the Table and the open row (`view(...).focus`) can't disagree.
     */
    tableView(data: ActiveWorkoutData, nowMs: number, edits: DraftEdits | null): WorkoutTableView {
      const info = data.exerciseInfo ?? {};
      const ruleTargetRpe = ruleTargetRpes(data.aggregate, (id) => (id in info ? (info[id] ?? null) : undefined));
      return buildWorkoutTableView({ aggregate: data.aggregate, nowMs, gymName: data.gymName, gymNames: data.gymNames, previous: data.previous, painFlagged: data.painFlagged, painFlags: data.painFlags, edits, title: data.title, withTimeLeft: false, ruleTargetRpe, ...warmupInputOf(data), ...(data.bodyweightExercises ? { bodyweightExercises: data.bodyweightExercises } : {}) });
    },

    /** `exerciseCardFacts` for any card's `⋯` and name sheet, with the built-in target RPE as the default (§2A.7). */
    cardFacts(data: ActiveWorkoutData, sessionExerciseId: string): ExerciseCardFacts | null {
      const info = data.exerciseInfo ?? {};
      const ruleTargetRpe = ruleTargetRpes(data.aggregate, (id) => (id in info ? (info[id] ?? null) : undefined));
      return exerciseCardFacts({ aggregate: data.aggregate, ruleTargetRpe }, sessionExerciseId);
    },

    /** `buildSetEditView` over loaded data: the correction sheet, with the built-in target RPE as the default (CHANGELOG 2026-10-11 (b)). */
    editView(data: ActiveWorkoutData, setId: string, values: SetValues | null, exclusions: readonly SetExclusion[] | null, targetRpe: number | null | undefined, setType: SetType | null = null): SetEditView | null {
      const info = data.exerciseInfo ?? {};
      const ruleTargetRpe = ruleTargetRpes(data.aggregate, (id) => (id in info ? (info[id] ?? null) : undefined));
      return buildSetEditView(data.aggregate, setId, values, exclusions, { targetRpe, ruleTargetRpe, setType, bodyweightExercises: data.bodyweightExercises });
    },

    /** Edit set for a set not done yet (14 Oct): its target, type, target RPE and rest, with the built-in target RPE as the default. */
    plannedEditView(data: ActiveWorkoutData, setId: string, edits: PlannedSetEdits): PlannedSetEditView | null {
      return buildPlannedSetEditView(data.aggregate, setId, edits, { ruleTargetRpe: ruleRpes(data), bodyweightExercises: data.bodyweightExercises, painFlagged: data.painFlagged });
    },

    /**
     * A typed load for a set not done yet, made achievable on its equipment (rule 4): toward easier,
     * never past the max, the same rule as the exercise pop-up and the builder (v3 §7; review S6).
     */
    snapPlannedLoad: (data: ActiveWorkoutData, setId: string, typed: number | null): number | null | undefined => snapTypedLoadEasier(data.aggregate, setId, typed, data.bodyweightExercises),

    /** The rest screen's `Last set` and `Next` (F8). */
    restSets: (data: ActiveWorkoutData): { last: SetGlance | null; next: SetGlance | null } => restSetsView(data.aggregate, ruleRpes(data), { painFlagged: data.painFlagged }),

    /** One set at a glance (the Focus view's set pager, F7). */
    glance: (data: ActiveWorkoutData, setId: string): SetGlance | null => setGlance(data.aggregate, setId, ruleRpes(data), { painFlagged: data.painFlagged }),

    /** Prev / next across the workout (F7); viewing never changes the current set. */
    navigation: (data: ActiveWorkoutData, viewingSetId: string | null): SetNavigation => setNavigation(data.aggregate, viewingSetId),

    /** What the workout's coach chips are about (14 Oct). */
    chatContext: (data: ActiveWorkoutData): { exerciseName: string | null; offTarget: boolean } => workoutChatContext(data.aggregate, ruleRpes(data)),

    /**
     * `Edit set` → `Save changes` on a set not done yet (14 Oct):
     * `edit_planned_set`, guarded on the set's version. Undo is `undo_op` on
     * the same opId.
     */
    editPlannedSet: async (req: { sessionId: string; setId: string; expectedSetVersion: number; patch: NonNullable<PlannedSetEditView['patch']>; opId: string }): Promise<CommandOutcome> =>
      ctx.afterCommand(await domain().dispatch(req.sessionId, { type: 'edit_planned_set', at: ctx.now(), opId: req.opId, setId: req.setId, expectedSetVersion: req.expectedSetVersion, patch: req.patch })),

    /**
     * `TimeLeftLine` and the `Time left` sheet (§2.15). The screen calls this
     * with a clock that moves only on events and once a minute, so the line
     * never ticks like a countdown.
     */
    timeLeft(data: ActiveWorkoutData, nowMs: number): { view: TimeLeftView; sheet: TimeLeftSheetView } | null {
      const view = buildTimeLeftView(data.aggregate, nowMs, data.recentPace);
      return view === null ? null : { view, sheet: timeLeftSheet(view.estimate, data.aggregate, nowMs, data.aggregate.session.startedAt.tz) };
    },

    /**
     * `+N min` (workout-table-v3 §5): the builder's fit ladder over the sets
     * left, as one offer. Nothing changes until `applyTimeFit` (rule 3).
     */
    timeFit(data: ActiveWorkoutData, overByMinutes: number): TimeFitOffer | null {
      const info = data.builderInfo ?? {};
      const o = timeFitOffer({ aggregate: data.aggregate, overByMinutes, info: (id) => info[id] ?? null, painFlagged: new Set(data.painFlagged), ...(data.mainExerciseIds === undefined ? {} : { mainExerciseIds: data.mainExerciseIds }) });
      return o.status === 'none' ? null : o;
    },

    /** Ben's Apply on the `+N min` offer: one `fit_today_to_time`, refused once the workout moved on (rule 5). Undo is `undo_op` on `opId`. */
    applyTimeFit: async (req: { sessionId: string; offer: TimeFitOffer; opId: string }): Promise<CommandOutcome> => {
      const cmd = fitTodayCommand(req.offer, { opId: req.opId, at: ctx.now() });
      if (cmd === null) return { ok: false, error: { code: 'invalid_values', message: 'Nothing to change.' } };
      return ctx.afterCommand(await domain().dispatch(req.sessionId, cmd));
    },

    /** `Finish by` (§2.15.3): today only; null = `Not set`. Changes only the line's wording. */
    setFinishBy: async (req: { sessionId: string; finishByUtc: string | null; tz: string; expectedVersion: number; opId: string }): Promise<CommandOutcome> =>
      ctx.afterCommand(
        await domain().dispatch(req.sessionId, {
          type: 'set_finish_by',
          at: ctx.now(),
          opId: req.opId,
          finishBy: req.finishByUtc === null ? null : { utc: req.finishByUtc, tz: req.tz },
          expectedVersion: req.expectedVersion,
        }),
      ),

    dispatch: async (sessionId: string, command: SessionCommand): Promise<CommandOutcome> => ctx.afterCommand(await domain().dispatch(sessionId, command)),

    /**
     * `Undo` on a delete-set, skip, correction, remove or swap toast (copy D4):
     * `undo_op` puts back exactly what that operation changed, or is refused
     * when anything it touched changed since (rule 5). The opId is derived
     * from the target, so a retry or a double tap undoes once.
     */
    async undoOp(req: { sessionId: string; targetOpId: string }): Promise<{ ok: true; aggregate: SessionAggregate } | { ok: false; message: string }> {
      try {
        const r = ctx.afterCommand(await domain().dispatch(req.sessionId, { type: 'undo_op', at: ctx.now(), opId: undoOpId(req.targetOpId), targetOpId: req.targetOpId }));
        return r.ok ? { ok: true, aggregate: r.aggregate } : { ok: false, message: undoRefusalText(r.error.code) };
      } catch {
        return { ok: false, message: undoRefusalText('failed') };
      }
    },

    /**
     * `Save changes` in the correction sheet: values and exclusion chips in
     * one versioned `correct_set` (§2.13, AW6). Ticking `Pain` when no flag
     * covers the movement sets one first (AW7, source `workout`, ID derived
     * from the opId so a retry flags once). A stale set version is refused
     * before anything is written.
     */
    async correctSet(req: {
      sessionId: string;
      setId: string;
      expectedSetVersion: number;
      patch: Partial<SetValues> & { exclusions?: SetExclusion[]; setType?: SetType; targetRpe?: number | null };
      opId: string;
    }): Promise<SetCorrectionWrite> {
      const failed = { ok: false as const, stale: false, message: 'The change wasn’t saved. Try again.' };
      let created: PainFlagRef | null = null;
      try {
        const p = await owner();
        const aggregate = await repos().sessions.get(req.sessionId);
        const set = aggregate?.sets.find((s) => s.id === req.setId);
        const ex = aggregate?.exercises.find((e) => e.id === set?.sessionExerciseId);
        if (!aggregate || !set || !ex) return { ok: false, stale: true, message: 'This set isn’t logged any more.' };
        const at = ctx.now();
        const done = aggregate.processedOps[req.opId] !== undefined;
        if (!done && set.version !== req.expectedSetVersion) return { ok: false, stale: true, message: 'This set changed since it was shown. Showing the latest.' };
        const flags = await repos().painFlags.listActive(p.id);
        // Only an active flag of this op is ours (review r2 B1): after a failed save's rollback, a retry flags afresh.
        const { id: flagId, flag: ours } = done ? { id: '', flag: null } : await opPainFlag(req.opId, ex.exerciseId);
        const covered = painFlagCovering(flags.filter((f) => f.id !== flagId), ex.exerciseId, toMs(at.utc), aggregate.session.startedAt.tz) !== null;
        const setNumber = buildSetEditView(aggregate, set.id, null)?.setNumber ?? set.index + 1;
        const plan = planExclusionMark({ prior: done ? undefined : set.exclusions, next: req.patch.exclusions, painFlagActive: covered, setNumber, exerciseName: ex.exerciseName });
        const painFlags: PainFlagRef[] = [];
        // An active flag of this op whose save never landed is a leftover of a
        // failed attempt whose rollback didn't go through: this attempt owns it.
        if (!done && ours && !plan.setsPainFlag) await rollBack({ id: flagId, version: ours.version });
        else if (!done && plan.setsPainFlag) {
          let version = ours?.version ?? 1;
          if (!ours) {
            const flag = newPainFlag({ id: flagId, ownerId: p.id, opId: req.opId, exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, area: null, source: 'workout', checkInId: null, at });
            const saved = await repos().painFlags.save(flag, null);
            const now = saved.ok ? flag : await repos().painFlags.get(flagId);
            if (now?.status !== 'active') return failed;
            version = now.version;
          }
          created = { id: flagId, version };
          painFlags.push(created);
        }
        const r = ctx.afterCommand(await domain().dispatch(req.sessionId, { type: 'correct_set', at, opId: req.opId, setId: req.setId, expectedSetVersion: req.expectedSetVersion, patch: req.patch }));
        if (!r.ok) {
          // AW7 is one change from Ben's view (review N2): a flag this save just set is taken back when the mark isn't saved.
          if (created !== null) await rollBack(created);
          return { ok: false, stale: r.error.code === 'stale_version', message: r.error.code === 'stale_version' ? 'This set changed since it was shown. Showing the latest.' : r.error.message };
        }
        const after = r.aggregate.sets.find((s) => s.id === req.setId);
        const changedFlags = plan.toast !== null && !r.duplicate;
        return {
          ok: true,
          aggregate: r.aggregate,
          duplicate: r.duplicate,
          toast: r.duplicate ? null : plan.toast,
          undo: changedFlags && after ? { setId: req.setId, setVersion: after.version, previous: plan.prior, painFlags } : null,
        };
      } catch {
        // Review r2 N1: a throw after the flag was written. If the mark didn't
        // land, take the flag back so "wasn't saved" is true; if it did (the
        // throw came later), keep the flag and say the change was saved.
        if (created === null) return failed;
        try {
          const latest = await repos().sessions.get(req.sessionId);
          if (latest?.processedOps[req.opId] !== undefined) return { ok: false, stale: true, message: 'Saved. Showing the latest.' };
          await rollBack(created);
        } catch {
          // The flag stays on: the safe direction for rule 9.
        }
        return failed;
      }

      /** AW7 is one change from Ben's view (review N2): a flag this save just set is taken back when the mark isn't saved. */
      async function rollBack(flag: PainFlagRef): Promise<void> {
        await pain.retract([flag], `${req.opId}:rollback`);
      }
    },

    /**
     * Undo on the exclusion toast: put the flags back as they were, as one
     * more versioned correction (kept in `Edit history`), and retract a pain
     * flag that the same save set (review B2: as if it never existed, not a
     * clear). Refused when the set changed since; a flag changed since the
     * save is kept, and the message says so.
     */
    async undoMark(req: { sessionId: string; setId: string; setVersion: number; previous: SetExclusion[]; painFlags: PainFlagRef[]; opId: string }): Promise<{ ok: boolean; message: string | null }> {
      try {
        const r = ctx.afterCommand(
          await domain().dispatch(req.sessionId, { type: 'correct_set', at: ctx.now(), opId: req.opId, setId: req.setId, expectedSetVersion: req.setVersion, patch: { exclusions: req.previous } }),
        );
        if (!r.ok) return { ok: false, message: r.error.code === 'stale_version' ? 'Can’t undo: this set changed' : r.error.message };
        if (req.painFlags.length === 0) return { ok: true, message: null };
        const retracted = await pain.retract(req.painFlags, `${req.opId}:pain`);
        if (!retracted.ok) return { ok: false, message: 'Set undone. The pain flag wasn’t removed. Try again.' };
        return { ok: true, message: retracted.stale.length > 0 ? 'Set undone. Pain flag kept: it changed since.' : null };
      } catch {
        return { ok: false, message: 'Undo wasn’t saved. Try again.' };
      }
    },

    /**
     * `Rest after` (rest-state §2.4): this set only, or every pending set of
     * the exercise plus Ben's default for it in future workouts (saved in
     * his profile, Your data). The running timer is never changed.
     */
    async setRestAfter(req: { sessionId: string; setId: string; seconds: number; scope: 'set' | 'exercise'; opId: string; expectedVersion: number }): Promise<CommandOutcome & { defaultSaved?: boolean }> {
      const r = ctx.afterCommand(await domain().dispatch(req.sessionId, { type: 'set_rest_after', at: ctx.now(), opId: req.opId, setId: req.setId, seconds: req.seconds, scope: req.scope, expectedVersion: req.expectedVersion }));
      if (!r.ok || req.scope !== 'exercise') return r;
      const ex = r.aggregate.exercises.find((e) => e.id === r.aggregate.sets.find((s) => s.id === req.setId)?.sessionExerciseId);
      if (!ex) return r;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const p = await ctx.profile();
        if (!p) break;
        if (p.exerciseRestS?.[ex.exerciseId] === req.seconds) return { ...r, defaultSaved: true };
        const next: UserProfile = { ...p, exerciseRestS: { ...(p.exerciseRestS ?? {}), [ex.exerciseId]: req.seconds }, version: p.version + 1, updatedAtUtc: ctx.now().utc };
        const saved = await repos().profiles.save(next, p.version);
        if (saved.ok) return { ...r, defaultSaved: true };
      }
      return { ...r, defaultSaved: false };
    },

    /**
     * `Add set`. After a gym switch, a set added to an exercise whose row is
     * on another gym's item goes on a continuation row at the current gym,
     * with its target fitted by the shared function (gym-switch §4.3).
     */
    async addSet(req: { sessionId: string; sessionExerciseId: string; opId: string; newSetId: string; afterSetId?: string }): Promise<CommandOutcome> {
      const p = await ctx.profile();
      const aggregate = await repos().sessions.get(req.sessionId);
      if (!p || !aggregate) return { ok: false, error: { code: 'not_found', message: 'Workout not found.' } };
      const row = aggregate.exercises.find((e) => e.id === req.sessionExerciseId);
      const gymId = aggregate.session.gymId;
      let continuation: ReturnType<typeof buildAddSetContinuation> = null;
      if (row && gymId !== null) {
        const gym = await repos().gyms.get(gymId);
        continuation = buildAddSetContinuation(aggregate, row.id, {
          exercise: await repos().exercises.get(row.exerciseId),
          gymName: gym?.name ?? 'this gym',
          painFlagged: new Set((await repos().painFlags.listActive(p.id)).map((f) => f.exerciseId)),
          ownerUnit: p.preferredUnit,
          lastUsedHere: await lastUsedFor(p.id, [row.exerciseId], gymId),
          newId: ctx.newId,
        });
      }
      // `＋ Set` copies the last working set, never a drop (wo-v3 logic S5); `Insert set after` copies the set it follows.
      const setType = req.afterSetId === undefined ? plusSetType(aggregate.sets, req.sessionExerciseId) : null;
      const cmd: SessionCommand = { type: 'add_set', at: ctx.now(), opId: req.opId, sessionExerciseId: req.sessionExerciseId, newSetId: req.newSetId, setType, ...(req.afterSetId !== undefined ? { afterSetId: req.afterSetId } : {}), ...(continuation ? { continuation } : {}) };
      return ctx.afterCommand(await domain().dispatch(req.sessionId, cmd));
    },

    /**
     * Exercise picker: the exercise list with compatible equipment at this
     * workout's gym. `withCatalogue` adds the bundled catalogue's exercises
     * not saved yet (audit F4); the first read of the catalogue is slower, so
     * the screen asks for the saved list first.
     */
    async pickerExercises(sessionId: string, query: string, opts: { withCatalogue?: boolean } = {}): Promise<PickerExercise[]> {
      const aggregate = await repos().sessions.get(sessionId);
      const p = await ctx.profile();
      // Timed exercises (planks, hangs) are loggable with a work timer (§2.7).
      // (19 Oct) A deleted custom exercise isn't offered (its history keeps it).
      const saved = (await repos().exercises.list()).filter((e) => PICKER_MEASUREMENTS.has(e.measurement) && (e.ownerId === null || e.ownerId === p?.id) && !isArchivedExercise(e));
      const have = new Set(saved.map((e) => e.id));
      const extra = opts.withCatalogue && ctx.catalogueExercises ? ctx.catalogueExercises().filter((e) => !have.has(e.id) && PICKER_MEASUREMENTS.has(e.measurement)) : [];
      const all = [...saved, ...extra];
      // Only the current gym's items, also after a switch (gym-switch §4.3).
      const snapshot = aggregate ? currentGymEquipment(aggregate.session) : [];
      // A flag that can't be read never hides or blocks a row: it just isn't tagged.
      const flags = p ? await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]) : [];
      const at = ctx.now();
      const nowMs = toMs(at.utc);
      const aliasesOf = await aliasIndex(p);
      // Bodyweight exercises never need (or get) a gym item: there's no load to check.
      return searchExercises(
        all.map((exercise) => ({ name: exercise.name, aliases: aliasesOf(exercise), exercise })),
        query,
      ).map(({ exercise, aliases }) => {
        const covering = painFlagCovering(flags, exercise.id, nowMs, at.tz);
        return {
          exercise,
          aliases,
          equipment: equipmentForExercise(exercise, snapshot).map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
          needs: missingStations(exercise.id, snapshot),
          mayHurt: covering ? { flagId: covering.flag.id, accessibilityLabel: mayHurtAccessibility(covering.flag), confirm: mayHurtConfirm({ ...covering.flag, exerciseName: exercise.name }) } : null,
        };
      });
    },

    /** Recently done exercises first (pain step `Recent`, picker). */
    async recentExerciseIds(limit = 8): Promise<string[]> {
      const p = await ctx.profile();
      if (!p) return [];
      const at = ctx.now();
      const nowMs = toMs(at.utc);
      const recent = await repos().sessions.listFinishedBetween(p.id, toIso(nowMs - 60 * 86_400_000), toIso(nowMs + 1));
      const ids: string[] = [];
      for (const a of [...recent].reverse()) for (const e of a.exercises) if (!ids.includes(e.exerciseId)) ids.push(e.exerciseId);
      return ids.slice(0, limit);
    },

    /**
     * Add an exercise. Its sets are planned from the built-in rule's next
     * targets for this exercise and equipment (the same result the last
     * Summary showed, shown as `Target`, its source behind `Why?`; review S3, minimal-copy D1), or one
     * empty set when there's no comparable history.
     */
    /**
     * `Superset with…` (Ben, 19 Oct): the exercises already in the workout this one can pair with,
     * at the workout's version (a link sent with it is refused once the workout moved on), and the
     * set count a new exercise starts with (as many as this one has left). Reads only.
     */
    async supersetChoices(sessionId: string, sessionExerciseId: string): Promise<{ version: number; name: string; partners: SupersetPartner[]; sets: number } | null> {
      const aggregate = await repos().sessions.get(sessionId).catch(() => null);
      const row = aggregate?.exercises.find((e) => e.id === sessionExerciseId);
      if (!aggregate || !row) return null;
      return { version: aggregate.session.version, name: row.exerciseName, partners: supersetPartners(aggregate, sessionExerciseId), sets: supersetPartnerSets(aggregate, sessionExerciseId) };
    },

    /** `Superset with…` an exercise already in the workout: `link_superset`, versioned; Undo is `undoOp` on the opId. */
    async linkSuperset(req: { sessionId: string; sessionExerciseId: string; withSessionExerciseId: string; expectedVersion: number; opId: string }): Promise<CommandOutcome> {
      return ctx.afterCommand(await domain().dispatch(req.sessionId, { type: 'link_superset', at: ctx.now(), opId: req.opId, expectedVersion: req.expectedVersion, sessionExerciseId: req.withSessionExerciseId, withSessionExerciseId: req.sessionExerciseId }));
    },

    async addExercise(req: {
      sessionId: string;
      exerciseId: string;
      equipmentId: string | null;
      opId: string;
      shape?: AddShape;
      supersetWithSessionExerciseId?: string;
      /**
       * (workout-table-v3 §7) The sets to start with, already worked out and fitted to the item by the
       * caller (the builder's load sources, `workoutEdit.add`). Absent: the built-in rule's plan (`planFor`).
       */
      plan?: { setType: SetType; planned: PlannedSet }[];
    }): Promise<CommandOutcome> {
      const p = await ctx.profile();
      if (!p) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
      // A catalogue exercise is saved (Coaching knowledge, no owner) the first time it's added.
      if (!(await repos().exercises.get(req.exerciseId))) {
        const row = ctx.catalogueExercises?.().find((e) => e.id === req.exerciseId);
        if (row) {
          const saved = await repos().exercises.save(row, null).catch(() => null);
          if (!saved?.ok && !(await repos().exercises.get(req.exerciseId))) return { ok: false, error: { code: 'write_failed', message: 'Couldn’t save that exercise. Try again.' } };
        }
      }
      const planned = req.plan ?? (await planFor(p, req).catch(() => null));
      // The picker's `Sets` count (exercise-library §10.2): only this exercise's new pending sets are shaped (rule 2).
      const plan = req.shape === undefined ? planned : shapeAddPlan(planned, req.shape);
      return ctx.afterCommand(
        await domain().addExercise(req.sessionId, {
          ownerId: p.id,
          exerciseId: req.exerciseId,
          equipmentId: req.equipmentId,
          opId: req.opId,
          at: ctx.now(),
          plan,
          exerciseRestS: p.exerciseRestS?.[req.exerciseId] ?? null,
          ...(req.supersetWithSessionExerciseId === undefined ? {} : { supersetWithSessionExerciseId: req.supersetWithSessionExerciseId }),
        }),
      );
    },

    /**
     * A note on an exercise or a logged set (active-workout §4.4; Your data),
     * during or after the workout. Null clears it. Changes no value, target
     * or rest; versioned on the workout.
     */
    async setNote(req: { sessionId: string; target: { kind: 'exercise'; sessionExerciseId: string } | { kind: 'set'; setId: string }; note: string | null; expectedVersion: number; opId: string }): Promise<CommandOutcome> {
      return ctx.afterCommand(await domain().dispatch(req.sessionId, { type: 'set_note', at: ctx.now(), opId: req.opId, target: req.target, note: req.note, expectedVersion: req.expectedVersion }));
    },

    /**
     * The Swap sheet mid-workout (exercise-library EL4, B3): the same rows as
     * before Start (`rankSubstitutions`, this gym's items as the workout has
     * them, never an exercise already in the workout, flagged ones last),
     * ranked for the row's **pending** sets. Null when nothing is left to
     * swap. Reads only; never an AI call.
     */
    async swapCandidates(sessionId: string, sessionExerciseId: string): Promise<SwapSheet | null> {
      try {
        const p = await owner();
        const aggregate = await repos().sessions.get(sessionId);
        if (!aggregate) return null;
        const slot = midSwapSlot(aggregate, sessionExerciseId);
        const row = aggregate.exercises.find((e) => e.id === sessionExerciseId);
        const planned = row ? await exerciseById(row.exerciseId) : null;
        if (slot === null || !row || planned === null) return null;
        const inWorkout = new Set(aggregate.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId));
        const all = new Map<string, Exercise>();
        for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) if (!isArchivedExercise(e)) all.set(e.id, e);
        for (const e of ctx.catalogueExercises?.() ?? []) if (!all.has(e.id)) all.set(e.id, e);
        const subs = planned.catalogueKey ? (ctx.catalogueSubstitutions?.(planned.catalogueKey) ?? []) : [];
        const keys = new Set(subs.filter((k): k is string => k !== null));
        const pool = [...all.values()].filter((e) => (e.ownerId === null || e.ownerId === p.id) && ((e.catalogueKey !== undefined && e.catalogueKey !== null && keys.has(e.catalogueKey)) || (planned.family !== undefined && e.family === planned.family)));
        const histories = new Map<string, HistorySession[]>();
        for (const e of pool) histories.set(e.id, await historyFor(p.id, e.id).catch(() => [] as HistorySession[]));
        const sctx = await midSwapCtx(p, aggregate, pool.map((e) => e.id), sessionExerciseId);
        const rows = rankSubstitutions({ ...sctx, slotExercise: planned, slot, exercises: pool, catalogueSubstitutions: subs, excludeExerciseIds: inWorkout, histories, planned: null });
        return { slotKey: sessionExerciseId, plannedName: row.exerciseName, gymName: sctx.gym.name, rows, painHeld: sctx.painCarried };
      } catch {
        return null;
      }
    },

    /**
     * Ben's pick on the mid-workout Swap sheet applies at once (B3): only the
     * row's pending sets move, each target from the substitute's own history
     * fitted to this gym (rule 4); logged sets stay. Undo is `undoOp` on the
     * same opId. A retry with the same opId is a duplicate.
     */
    async swapExercise(req: {
      sessionId: string;
      sessionExerciseId: string;
      exerciseId: string;
      opId: string;
      /**
       * (workout-table-v3 §7) The substitute's sets from the builder's load sources (`workoutEdit.swap`),
       * on `pin` (the item they were worked out on). Absent: its own history and the built-in rule
       * (`substituteTargets`). Either way the shared fit snaps them to this gym (rule 4) and pain holds them.
       */
      builderPlan?: { plan: { setType: SetType; planned: PlannedSet }[]; pin: EquipmentInstance | null };
    }): Promise<CommandOutcome & { fromName?: string; toName?: string }> {
      const failed = (message: string): CommandOutcome => ({ ok: false, error: { code: 'set_not_pending', message } });
      const p = await ctx.profile();
      const aggregate = await repos().sessions.get(req.sessionId);
      if (!p || !aggregate) return { ok: false, error: { code: 'not_found', message: 'Workout not found.' } };
      // Already applied (a retry after a crash): the same result, nothing new.
      const row = aggregate.exercises.find((e) => e.id === req.sessionExerciseId);
      if (aggregate.processedOps[req.opId] !== undefined) {
        const to = aggregate.exercises.find((e) => e.swappedFrom?.opId === req.opId);
        return { ok: true, aggregate, events: [], duplicate: true, superseded: false, fromName: row?.exerciseName ?? '', toName: to?.exerciseName ?? '' };
      }
      const slot = midSwapSlot(aggregate, req.sessionExerciseId);
      const exercise = await ensureExercise(req.exerciseId);
      if (!row || slot === null) return failed('Nothing left to swap.');
      if (exercise === null) return { ok: false, error: { code: 'write_failed', message: 'Couldn’t save that exercise. Try again.' } };
      const history = await historyFor(p.id, exercise.id).catch(() => [] as HistorySession[]);
      const sctx = await midSwapCtx(p, aggregate, [exercise.id], row.id);
      const plan = req.builderPlan === undefined ? substituteTargets(slot, exercise, history, sctx) : { exercise, pin: req.builderPlan.pin, plan: req.builderPlan.plan };
      const built = buildSwapExerciseCommand({
        aggregate,
        sessionExerciseId: row.id,
        plan,
        gymName: sctx.gym.name,
        ownerUnit: p.preferredUnit,
        // The flags never name the substitute; when the original's pain carries (B5), its loads are held too (review gaps r2 N3).
        painFlagged: new Set([...sctx.painFlags.map((f) => f.exerciseId), ...(sctx.painCarried ? [exercise.id] : [])]),
        lastUsedHere: sctx.lastUsedHere,
        opId: req.opId,
        at: ctx.now(),
        newId: ctx.newId,
      });
      if (!built.ok) return failed(built.reason === 'measurement' ? `${exercise.name} is measured differently.` : 'Nothing left to swap.');
      const r = ctx.afterCommand(await domain().dispatch(req.sessionId, built.command));
      return r.ok ? { ...r, fromName: row.exerciseName, toName: exercise.name } : r;
    },

    /**
     * `Why?` on a set target (active-workout §2.12): reads the provenance
     * stored with the target, the pain flags on the movement and the basis
     * workout as it is now. Local reads only: no rule runs, no coach, no
     * network, and nothing is written. Null when the set has no target or
     * the workout can't be read; a basis that can't be read is treated as
     * not found (no `edited` claim either way).
     */
    async explainTarget(sessionId: string, setId: string): Promise<TargetExplanation | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const aggregate = await repos().sessions.get(sessionId);
        const set = aggregate?.sets.find((x) => x.id === setId);
        const ex = aggregate?.exercises.find((e) => e.id === set?.sessionExerciseId);
        if (!aggregate || !set || !ex) return null;
        const basisId = set.planned.provenance?.basis?.sessionId ?? null;
        const draftId = aggregate.session.coachDraft?.draftId ?? null;
        const [basisNow, gyms, flags, history, coachDraft] = await Promise.all([
          basisId === null ? null : repos().sessions.get(basisId).catch(() => null),
          repos().gyms.listByOwner(p.id).catch(() => []),
          repos().painFlags.listByOwner(p.id).catch(() => [] as PainFlag[]),
          historyFor(p.id, ex.exerciseId).catch(() => [] as HistorySession[]),
          draftId === null ? null : ctx.store().repos.workoutDrafts.get(draftId).catch(() => null),
        ]);
        return explainTarget({
          coachDraftBuiltAt: coachDraft !== null && coachDraft.ownerId === p.id ? coachDraft.createdAt : null,
          aggregate,
          setId,
          nowMs: toMs(ctx.now().utc),
          basisNow,
          gymNames: Object.fromEntries(gyms.map((g) => [g.id, g.name])),
          painFlags: flags.filter((f) => f.exerciseId === ex.exerciseId),
          history: history.filter((h) => h.sessionId !== aggregate.session.id),
        });
      } catch {
        return null;
      }
    },

    /** (19 Oct, plan tracker v1) `Plan vs done` on the Summary: per exercise with a plan, sets and reps against it. Null: nothing planned, or an import. */
    async planVsDone(sessionId: string): Promise<PlannedVsDone | null> {
      const p = await ctx.profile();
      const aggregate = await repos().sessions.get(sessionId).catch(() => null);
      if (!p || !aggregate || aggregate.session.ownerId !== p.id || aggregate.session.source === 'import') return null;
      return plannedVsDone(aggregate);
    },

    /** `coach`: the coach's state from the AI connection (Keychain, read by the caller); it only changes the source tag. */
    async summary(sessionId: string, coach: CoachStatus = 'not_connected'): Promise<WorkoutSummary | null> {
      const p = await ctx.profile();
      const aggregate = await repos().sessions.get(sessionId);
      if (!p || !aggregate) return null;
      const gym = aggregate.session.gymId === null ? null : await repos().gyms.get(aggregate.session.gymId);
      const history: Record<string, HistorySession[]> = {};
      const rules: Record<string, ProgressionRule> = {};
      const exerciseInfo: Record<string, Exercise> = {};
      for (const ex of aggregate.exercises) {
        history[ex.exerciseId] ??= await historyFor(p.id, ex.exerciseId);
        if (!(ex.exerciseId in exerciseInfo)) {
          const info = await repos().exercises.get(ex.exerciseId);
          if (info) exerciseInfo[ex.exerciseId] = info;
        }
        if (ex.progressionRuleId !== null && !(ex.progressionRuleId in rules)) {
          const r = await repos().progressionRules.get(ex.progressionRuleId);
          if (r) rules[r.id] = r;
        }
      }
      const ci = aggregate.session.checkIn?.kind === 'answered' ? await repos().checkIns.get(aggregate.session.checkIn.checkInId) : null;
      // The compared workout is named by its own gym, never assumed to be this one (review r2 B1).
      const gymNames = Object.fromEntries((await repos().gyms.listByOwner(p.id).catch(() => [])).map((g) => [g.id, g.name]));
      // (Ben, 23 Oct) The rule's stall resets Ben applied on this Summary: only those lower the load.
      const acceptedResets = acceptedRuleResets(await ctx.store().repos.coach.listNextTargets(p.id, aggregate.session.id).catch(() => []), aggregate);
      const summary = buildWorkoutSummary({
        acceptedResets,
        aggregate,
        nowMs: toMs(ctx.now().utc),
        gymName: gym?.name ?? null,
        history,
        rules,
        painFlags: await repos().painFlags.listActive(p.id),
        checkIn: ci,
        coach,
        exerciseInfo,
        gymNames,
      });
      // An open-ended workout is named from what was in it (`Push`), never a routine it wasn't (audit F5).
      return storedName(aggregate) === null && aggregate.exercises.length > 0 ? { ...summary, title: deriveWorkoutTitle(Object.values(exerciseInfo)) } : summary;
    },
  };

  /**
   * Mid-workout gym switch (gym-switch.md). `propose` is `setActiveGym`: it
   * fits the remaining sets to the chosen gym and returns the card; nothing
   * changes until `apply`. Everything is local: no network, no coach.
   */
  const gymSwitch = {
    /** The switcher sheet's rows: every gym (not archived), the workout's own marked. */
    async gyms(sessionId: string): Promise<GymChoice[]> {
      const p = await ctx.profile();
      const aggregate = await repos().sessions.get(sessionId);
      if (!p || !aggregate) return [];
      const gyms = (await repos().gyms.listByOwner(p.id)).filter((g) => g.archivedAtUtc === undefined);
      const rows: GymChoice[] = [];
      for (const g of gyms) {
        const items = (await repos().equipment.listByGym(g.id)).filter((e) => e.availability === 'available').length;
        rows.push({ id: g.id, name: g.name, current: g.id === aggregate.session.gymId, items });
      }
      return rows.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
    },

    /** The proposal for fitting this workout's remaining sets to `gymId` (the same gym: `[Use changes today]`). Saves nothing. */
    async propose(sessionId: string, gymId: string): Promise<GymSwitchProposal | null> {
      const p = await ctx.profile();
      const aggregate = await repos().sessions.get(sessionId);
      const gym = await repos().gyms.get(gymId);
      if (!p || !aggregate || aggregate.session.status !== 'active' || !gym || gym.ownerId !== p.id) return null;
      const exercises = new Map<string, Exercise>();
      for (const e of aggregate.exercises) {
        if (exercises.has(e.exerciseId)) continue;
        const info = await repos().exercises.get(e.exerciseId);
        if (info) exercises.set(info.id, info);
      }
      return buildGymSwitchProposal({
        aggregate,
        mode: gymId === aggregate.session.gymId ? 'equipment_update' : 'gym_switch',
        gym: { id: gym.id, name: gym.name, equipment: await repos().equipment.listByGym(gym.id) },
        gymNames: await gymNamesOf(p.id),
        exercises,
        painFlagged: new Set((await repos().painFlags.listActive(p.id)).map((f) => f.exerciseId)),
        lastUsedHere: await lastUsedFor(p.id, aggregate.exercises.map((e) => e.exerciseId), gym.id),
        ownerUnit: p.preferredUnit,
        newId: ctx.newId,
      });
    },

    /** `Switch` / `Apply`: one transaction; a double tap or `Try again` with the same opId is one change. */
    async apply(proposal: GymSwitchProposal, opId: string): Promise<CommandOutcome> {
      return ctx.afterCommand(await domain().dispatch(proposal.sessionId, changeGymCommand(proposal, opId, ctx.now())));
    },

    /**
     * The toast's Undo. Refused when anything changed since the switch; then
     * a `Switch back to …` card is offered instead (never a silent revert).
     */
    async undo(sessionId: string, opId: string): Promise<GymUndoOutcome> {
      const aggregate = await repos().sessions.get(sessionId);
      const last = aggregate?.session.gymChanges?.at(-1);
      if (!aggregate || last?.kind !== 'change') return { ok: false, message: 'Can’t undo: your workout changed since the switch.', back: null };
      const r = ctx.afterCommand(await domain().dispatch(sessionId, { type: 'undo_change_gym', at: ctx.now(), opId, actionId: last.actionId, expectedFingerprint: last.afterFingerprint }));
      if (r.ok) {
        const gymId = r.aggregate.session.gymId;
        const gym = gymId === null ? null : await repos().gyms.get(gymId);
        return { ok: true, outcome: r, gymName: gym?.name ?? 'the last gym' };
      }
      const back = last.fromGymId === null ? null : await gymSwitch.propose(sessionId, last.fromGymId).catch(() => null);
      return { ok: false, message: r.error.code === 'write_failed' ? 'Couldn’t undo.' : 'Can’t undo: your workout changed since the switch.', back };
    },
  };

  const repeat = {
    /**
     * `Start from a past workout`: the newest `limit` finished workouts with
     * logged sets, newest first (review S1). Only those rows are decoded; a
     * record that fails to decode is skipped and counted, never thrown.
     * Imported (FitNotes) workouts are included (B7): Start fits their loads
     * to the gym's equipment like any other (rule 4).
     */
    async candidates(limit = 30): Promise<RepeatCandidates> {
      const p = await ctx.profile();
      if (!p) return { rows: [], unreadable: 0 };
      const gyms = new Map<string, string>();
      const rows: RepeatCandidate[] = [];
      let unreadable = 0;
      for (let offset = 0; rows.length < limit; ) {
        const ids = await repos().sessions.listRepeatableIds(p.id, limit - rows.length, offset);
        if (ids.length === 0) break;
        offset += ids.length;
        for (const id of ids) {
          let a: SessionAggregate | null;
          try {
            a = await repos().sessions.get(id);
          } catch {
            unreadable += 1;
            continue;
          }
          if (!a) continue;
          const row = await repeat.describe(a, gyms);
          if (row.sets === 0) continue;
          rows.push(row);
        }
      }
      return { rows, unreadable };
    },

    /**
     * One past workout as a list row (Past workouts, Recently deleted):
     * title, gym route, done exercises and set count. `gyms` caches names.
     */
    async describe(a: SessionAggregate, gyms: Map<string, string> = new Map()): Promise<RepeatCandidate> {
      const done = a.sets.filter((s) => s.status === 'completed' && s.pairedWithSetId === null);
      // A workout that switched gym is listed as `Main Gym → Hotel · Lisbon` (gym-switch check 24).
      const route = gymRouteIds(a.session);
      for (const g of route) if (!gyms.has(g)) gyms.set(g, (await repos().gyms.get(g).catch(() => null))?.name ?? 'Gym');
      return {
        sessionId: a.session.id,
        version: a.session.version,
        // A test session with no exercise at all is recognisable in Past workouts' delete list (delete-workouts §2.3).
        title: storedName(a) ?? (liveExercises(a.exercises).length === 0 ? EMPTY_WORKOUT_TITLE : (await titleFor(liveExercises(a.exercises).map((e) => e.exerciseId)).catch(() => ({ title: 'Workout' }))).title),
        startedAtUtc: a.session.startedAt.utc,
        tz: a.session.startedAt.tz,
        localDate: a.session.localDate ?? null,
        source: a.session.source,
        gymId: a.session.gymId,
        gymName: route.length === 0 ? 'Gym not recorded' : route.map((g) => gyms.get(g) ?? 'Gym').join(' → '),
        // An exercise done at two gyms is listed once (review B1).
        exerciseNames: doneExerciseNames(a),
        sets: done.length,
      };
    },

    /** `describe` by ID (an imported workout's view, delete-workouts §2.1); null if it isn't stored or can't be read. */
    async describeById(sessionId: string): Promise<RepeatCandidate | null> {
      const a = await repos().sessions.get(sessionId).catch(() => null);
      return a === null ? null : repeat.describe(a);
    },

    /** Today's `Repeat last workout` row: the newest readable candidate, or null. Never throws (review S1). */
    async last(): Promise<RepeatCandidate | null> {
      try {
        return (await repeat.candidates(1)).rows[0] ?? null;
      } catch {
        return null;
      }
    },

    /** The Repeat screen (routines.md §2.4): what the new workout would plan at this gym. Saves nothing. */
    async preview(sourceSessionId: string, gymId: string): Promise<RepeatPreview | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const planned = await repeatPlan(p, sourceSessionId, gymId);
      if (planned === null) return null;
      const { source, out: r } = planned;
      const title = storedName(source) ?? (await titleFor(liveExercises(source.exercises).map((e) => e.exerciseId)).catch(() => ({ title: GENERIC_WORKOUT_NAME }))).title;
      return { title, exercises: repeatPreviewLines(r.aggregate), notes: r.notes, notCopied: r.notCopied, sourceGymId: source.session.gymId, sourceStartedAtUtc: source.session.startedAt.utc, tz: source.session.startedAt.tz };
    },
  };

  const routines = {
    /** Live routines in list order with `last done` (premium-feel §2.6). Never throws: an unreadable list reads as none. */
    async list(): Promise<RoutineRow[]> {
      try {
        const p = await ctx.profile();
        return p ? (await routineRows(p.id)).rows : [];
      } catch {
        return [];
      }
    },

    /** The Save/Rename sheet's name check (empty, too long, a duplicate note). */
    async checkName(name: string, exceptId: string | null = null): Promise<RoutineNameCheck> {
      const p = await ctx.profile();
      const all = p ? await repos().routines.listByOwner(p.id).catch(() => []) : [];
      return checkRoutineName(name, all, exceptId);
    },

    /**
     * The Workouts list (routines.md §A2.1): rotation from Up next, the
     * rest, and history types that aren't saved workouts, with `≈ N min`
     * and `⚠ N not here` at the selected gym. Local reads only; never a
     * provider call. Null when it can't be read (`Couldn't open your data.`).
     */
    async library(req: { gymId: string | null; sort: LibrarySort; showAllHistory: boolean }): Promise<LibraryData | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const now = ctx.now();
        const live = liveRoutines(await repos().routines.listByOwner(p.id));
        const index = await typeIndex(p, live);
        const up = await resolveUpNext(p, req.gymId ?? 'typical-gym-preview').catch(() => null);
        const gymEquipment = req.gymId === null ? null : await repos().equipment.listByGym(req.gymId).catch(() => null);
        const recent = await recentFinished(p);
        const infos = new Map<string, Exercise>();
        for (const r of live) for (const e of r.exercises) if (!infos.has(e.exerciseId)) {
          const x = await exerciseById(e.exerciseId);
          if (x) infos.set(x.id, x);
        }
        const routines = [];
        for (const routine of live) {
          let minutes: number | null = null;
          if (req.gymId !== null) {
            const run = await routineStart(p, { routineId: routine.id, gymId: req.gymId, opId: `library:${routine.id}`, preview: true, newId: previewIds() }).catch(() => null);
            if (run?.r.ok) {
              const m = estimateRemainingDuration(run.r.aggregate, { recent }).minutes;
              minutes = m > 0 ? m : null;
            }
          }
          routines.push({ routine, minutes, gymIssues: gymEquipment === null ? 0 : routineGymIssues(routine, infos, gymEquipment) });
        }
        const view = buildLibraryView({ routines, types: index.types, upNextRoutineId: up?.kind === 'routine' ? up.routine.id : null, now, sort: req.sort, showAllHistory: req.showAllHistory });
        const active = await repos().sessions.getActive(p.id).catch(() => null);
        const activeName = active === null ? null : (active.session.routineName ?? storedName(active) ?? (await titleFor(active.exercises.map((e) => e.exerciseId))).title);
        return { view, active: active === null ? null : { sessionId: active.session.id, name: activeName ?? GENERIC_WORKOUT_NAME, routineId: active.session.routineId ?? null } };
      } catch {
        return null;
      }
    },

    /** The editor (§A2.3): the stored workout (null = new) with what each exercise needs. Local reads only. */
    async editor(req: { routineId: string | null; gymId: string | null }): Promise<RoutineEditorData | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const routine = req.routineId === null ? null : await repos().routines.get(req.routineId);
        if (req.routineId !== null && (routine === null || routine.ownerId !== p.id || (routine.deletedAtUtc ?? null) !== null)) return null;
        const exercises = routine === null ? [] : editableExercises(routine);
        const gym = req.gymId === null ? null : await repos().gyms.get(req.gymId).catch(() => null);
        const active = await repos().sessions.getActive(p.id).catch(() => null);
        return {
          routine,
          exercises,
          info: await routines.exerciseInfo(exercises.map((e) => e.exerciseId)),
          gym: gym === null ? null : { id: gym.id, name: gym.name, equipment: await repos().equipment.listByGym(gym.id) },
          unit: p.preferredUnit,
          globalDefault: p.defaultRest,
          restPresets: p.restPresets,
          effortScale: p.effortScale === 'off' ? null : p.effortScale,
          inProgress: routine !== null && active?.session.routineId === routine.id,
        };
      } catch {
        return null;
      }
    },

    /** Editor info for exercises (added ones too): Ben's list, then the catalogue. */
    async exerciseInfo(ids: readonly string[]): Promise<Record<string, EditorExerciseInfo>> {
      const p = await ctx.profile();
      const out: Record<string, EditorExerciseInfo> = {};
      for (const id of new Set(ids)) {
        const x = await exerciseById(id);
        if (!x) continue;
        out[id] = {
          id,
          name: x.name,
          measurement: x.measurement,
          laterality: x.laterality,
          defaultLoadConvention: x.defaultLoadConvention,
          compatibleEquipment: x.compatibleEquipment,
          defaultRestS: p?.exerciseRestS?.[id] ?? x.defaultRestS ?? null,
          compound: x.mechanic === 'compound',
          defaultShape: defaultSlotShape(x),
          lastLoad: p ? lastWorkingLoad(await historyFor(p.id, id).catch(() => [] as HistorySession[])) : null,
        };
      }
      return out;
    },

    /** The editor's `Add exercise` list: Ben's exercises and the catalogue's, searched by name, aliases and Ben's own names (EL1). */
    async searchExercises(query: string): Promise<EditorExerciseInfo[]> {
      const p = await ctx.profile();
      const saved = (await repos().exercises.list()).filter((e) => (e.ownerId === null || e.ownerId === p?.id) && !isArchivedExercise(e));
      const have = new Set(saved.map((e) => e.id));
      const all = [...saved, ...(ctx.catalogueExercises ? ctx.catalogueExercises().filter((e) => !have.has(e.id)) : [])];
      const aliasesOf = await aliasIndex(p);
      return searchExercises(
        all.map((x) => ({ name: x.name, aliases: aliasesOf(x), x })),
        query,
      )
        .slice(0, 60)
        .map(({ x }) => ({ id: x.id, name: x.name, measurement: x.measurement, laterality: x.laterality, defaultLoadConvention: x.defaultLoadConvention, compatibleEquipment: x.compatibleEquipment, defaultRestS: p?.exerciseRestS?.[x.id] ?? x.defaultRestS ?? null, compound: x.mechanic === 'compound', defaultShape: defaultSlotShape(x) }));
    },

    /** `≈ N min` while editing (§A2.3): the workout as edited, planned at this gym with no targets. Null when it can't be estimated. */
    async estimate(req: { exercises: readonly RoutineExercise[]; gymId: string | null }): Promise<number | null> {
      try {
        const p = await ctx.profile();
        if (!p || req.gymId === null || req.exercises.length === 0) return null;
        const exercises = new Map<string, Exercise>();
        for (const e of req.exercises) {
          const x = await exerciseById(e.exerciseId);
          if (x) exercises.set(x.id, x);
        }
        const at = ctx.now();
        const routine: Routine = { id: deriveId('editor-estimate'), ownerId: p.id, version: 1, createdAtUtc: at.utc, updatedAtUtc: at.utc, name: 'Estimate', exercises: [...req.exercises], createdFromSessionId: null, source: 'ben' };
        const out = planRoutineStart({ opId: 'editor-estimate', owner: p, gymId: req.gymId, routine, exercises, gymEquipment: await repos().equipment.listByGym(req.gymId), knownEquipment: await allEquipment(p.id), at, newId: previewIds() });
        const m = estimateRemainingDuration(out.aggregate, { recent: await recentFinished(p) }).minutes;
        return m > 0 ? m : null;
      } catch {
        return null;
      }
    },

    /** `New workout` → `Save` (§A4.2). Idempotent by `opId`. */
    async create(req: { edit: RoutineEdit; opId: string; inRotation?: boolean }): Promise<LibrarySaveWrite> {
      try {
        const p = await owner();
        const ids = req.edit.exercises.map((e) => e.exerciseId);
        const isCompound = await compoundOf(ids);
        const isDistance = await distanceOf(ids);
        const id = deriveId(`routine:${req.opId}`);
        const c = createRoutine({ id, ownerId: p.id, edit: req.edit, opId: req.opId, at: ctx.now(), isCompound, isDistance, inRotation: req.inRotation === true });
        // A retry of a save that landed is the same save, even if the edit no longer validates.
        if (c.kind === 'invalid' && (await repos().routines.get(id).catch(() => null)) === null) return { ok: false, message: c.message };
        return await createOnce(id, req.opId, () => (c.kind === 'write' ? c.next : null), LIBRARY_COPY.nothing);
      } catch {
        return { ok: false, message: LIBRARY_COPY.saveFailed };
      }
    },

    /**
     * The editor's `Save` on a stored workout (§A4.2, WL10): the next
     * version and Ben's `update_routine` record holding the version before,
     * in one write, so `Undo` (`revert`) works after a force-close too. A
     * retried opId is the same save; an older `expectedVersion` writes
     * nothing and returns the newer version for the conflict sheet (rule 5).
     */
    async update(req: { routineId: string; edit: RoutineEdit; expectedVersion: number; opId: string }): Promise<RoutineEditWrite> {
      try {
        const p = await owner();
        const current = await repos().routines.get(req.routineId);
        if (!current || current.ownerId !== p.id || (current.deletedAtUtc ?? null) !== null) return { ok: false, reason: 'missing', message: LIBRARY_COPY.notFound };
        const actionId = deriveId(`update-routine:${req.opId}`);
        if (current.lastOpId === req.opId) return { ok: true, routine: current, actionId, duplicate: true };
        if (current.version !== req.expectedVersion) {
          // What changed since (`Coach target applied for Bench press, 18:40`): the newest record on it, if any.
          const actions = await ctx.store().repos.coach.listRecentActions(p.id, { limit: 50 }).catch(() => [] as ActionRecord[]);
          const last = actions.find((a) => a.detail.kind === 'update_routine' && a.detail.routineId === current.id && a.undoneBy === null);
          const lines = last !== undefined && last.detail.kind === 'update_routine' ? last.detail.changes.map((c) => c.text) : [];
          return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name), current, changedAtUtc: current.updatedAtUtc, lines };
        }
        for (const e of req.edit.exercises) if ((await ensureExercise(e.exerciseId)) === null) return { ok: false, reason: 'missing', message: LIBRARY_COPY.notFound };
        const at = ctx.now();
        const ids = req.edit.exercises.map((e) => e.exerciseId);
        const c = editRoutine(current, req.edit, req.expectedVersion, req.opId, at, await compoundOf(ids), await distanceOf(ids));
        if (c.kind === 'invalid') return { ok: false, reason: 'invalid', message: c.message };
        if (c.kind === 'duplicate') return { ok: true, routine: c.current, actionId, duplicate: true };
        if (c.kind === 'stale') return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name), current: c.current, changedAtUtc: c.current.updatedAtUtc, lines: [] };
        const nameOf = new Map<string, string>();
        for (const e of [...current.exercises, ...c.next.exercises]) if (!nameOf.has(e.exerciseId)) nameOf.set(e.exerciseId, (await exerciseById(e.exerciseId))?.name ?? 'Exercise');
        const action: ActionRecord = {
          actionId,
          turnId: null,
          opId: req.opId,
          status: 'committed',
          author: 'ben',
          detail: {
            kind: 'update_routine',
            routineId: current.id,
            routineName: current.name,
            // Against what the editor opened (a pre-library workout's loads read as Auto), so only Ben's changes are listed (review N4).
            changes: routineChangeLines(editableEdit(current), c.next, (id) => nameOf.get(id) ?? 'Exercise'),
            before: current,
            versionBefore: current.version,
            versionAfter: c.next.version,
            draft: null,
          },
          failure: null,
          reason: null,
          evidenceRefs: [],
          guardNotes: [],
          entityVersions: [{ entity: 'routine', id: current.id, before: current.version, after: c.next.version }],
          undoneBy: null,
          createdAt: at,
        };
        const r = await ctx.store().repos.drafts.applyRoutineChange({ ownerId: p.id, routine: c.next, expectedRoutineVersion: current.version, action, at });
        if (r.status === 'missing') return { ok: false, reason: 'missing', message: LIBRARY_COPY.notFound };
        if (r.status === 'stale') {
          const now = r.routine ?? current;
          return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name), current: now, changedAtUtc: now.updatedAtUtc, lines: [] };
        }
        return { ok: true, routine: r.routine, actionId: r.action.actionId, duplicate: r.status === 'replayed' };
      } catch {
        const name = (await repos().routines.get(req.routineId).catch(() => null))?.name ?? 'workout';
        return { ok: false, reason: 'failed', message: LIBRARY_COPY.editFailed(name) };
      }
    },

    /**
     * `Undo` on `Saved Push A` (§A4.2): the version before, while the
     * workout is still at the version that save made; else nothing changes
     * and the message says `Can't undo: Push A changed since.`
     */
    revert(req: { actionId: string; opId: string }): Promise<TemplateSwapWrite> {
      return routines.undoTemplateSwap(req);
    },

    /** `Duplicate` (§4.4): `Push A copy`, not in the rotation; the toast's Undo deletes it. Idempotent by `opId`. */
    async duplicate(req: { routineId: string; opId: string }): Promise<LibrarySaveWrite> {
      try {
        const p = await owner();
        const current = await repos().routines.get(req.routineId);
        if (!current || current.ownerId !== p.id) return { ok: false, message: LIBRARY_COPY.notFound };
        const id = deriveId(`routine:${req.opId}`);
        // A deleted workout isn't copied (as its other writes refuse); a retry of a copy made before still replays (review N5).
        if (isDeleted(current) && (await repos().routines.get(id).catch(() => null)) === null) return { ok: false, message: LIBRARY_COPY.notFound };
        const isCompound = await compoundOf(current.exercises.map((e) => e.exerciseId));
        return await createOnce(id, req.opId, () => duplicateRoutine(current, { id, opId: req.opId, at: ctx.now(), newId: ctx.newId, isCompound }), LIBRARY_COPY.nothing);
      } catch {
        return { ok: false, message: LIBRARY_COPY.saveFailed };
      }
    },

    /** `Add to rotation` / `Remove from rotation` (RT9). `placeAtUtc`: an Undo of a removal puts it back where it was. */
    setRotation(req: { routineId: string; on: boolean; expectedVersion: number; opId: string; placeAtUtc?: string | null }): Promise<RoutineWrite> {
      return writeRoutine(req.routineId, (r) => setRoutineRotation(r, req.on, req.expectedVersion, req.opId, ctx.now(), req.placeAtUtc ?? null));
    },

    /**
     * The save sheet's prefill (§A2.5): the name (the workout's or the
     * page's, else `Workout · Sun 11 Oct`) and what will be saved. Null:
     * nothing to save (all skipped, or only warm-ups), so no sheet opens;
     * `stale`: the page is out of date (`Targets updated`).
     */
    async saveSource(from: SaveFrom, fallbackName: string | null = null): Promise<SaveSource | 'stale' | null> {
      try {
        const p = await owner();
        const left: NotCopied[] = [];
        const r = await routineFromSource(p, from, { id: deriveId('save-source'), name: 'x', opId: 'save-source', inRotation: false }, left);
        if (r === 'stale') return 'stale';
        if (r === null) return null;
        let name = fallbackName;
        if (name === null && (from.kind === 'session' || from.kind === 'repeat')) {
          const source = await repos().sessions.get(from.sessionId).catch(() => null);
          name = source === null ? null : (source.session.routineName ?? storedName(source) ?? unnamedWorkoutName(source.session.startedAt));
        }
        return { name: name ?? unnamedWorkoutName(ctx.now()), detail: saveSheetDetail(r), notSaved: notCopiedText(left), exercises: editableExercises(r) };
      } catch {
        return null;
      }
    },

    /**
     * `Save to Workouts` (§A4.2, WL6, WL7): always a new workout, from a
     * finished one (imported too) or from what an overview shows. Loads are
     * `Auto` (Repeat's save keeps them Fixed). Idempotent by `opId`; the
     * source is never changed. A preview save with an out-of-date key saves
     * nothing (`Targets updated`). `edit`: the Save sheet's `Edit ›` →
     * editor `Save` (§A2.5, WL-A18): the same copy with the editor's name
     * and exercises (set counts), still one write under the sheet's opId.
     */
    async saveFrom(req: { from: SaveFrom; name: string; addToRotation: boolean; opId: string; edit?: RoutineEdit }): Promise<LibrarySaveWrite> {
      try {
        const p = await owner();
        const name = checkRoutineName(req.name, []);
        if (!name.ok) return { ok: false, message: name.message };
        const id = deriveId(`routine:${req.opId}`);
        // A coach draft names the workout it was saved as (BD12); it stays open, so Ben may still start it.
        // Review S8: the link runs on a replay too, so a link lost to a failure or a force-close is made by the retry.
        const linked = async (saved: LibrarySaveWrite): Promise<LibrarySaveWrite> => {
          const draftId = savedDraftIdOf(req.from);
          if (saved.ok && draftId !== null && saved.routine.createdFromDraft?.draftId === draftId) {
            const versionN = saved.routine.createdFromDraft.version;
            const routineId = saved.routine.id;
            const live = await liveDraftRoutineId(draftId);
            if (live !== null && live !== routineId) return saved;
            await ctx
              .store()
              .repos.workoutDrafts.write(p.id, draftId, (c) => linkDraftRoutine(c, { routineId, opId: `save:${req.opId}`, at: ctx.now(), versionN }))
              .catch(() => null);
          }
          return saved;
        };
        const existing = await repos().routines.get(id).catch(() => null);
        // Review r2 S2: one save per draft version. A draft whose current version is already a live workout isn't saved again (the link stays on the first);
        // review r3 S1: a version revised after Save may be saved, and the link moves to the new workout.
        const fromDraft = savedDraftIdOf(req.from);
        // Review S1 (retire-workout-overview): Your workout opened on a chat draft already saved is that saved workout too.
        const chat = fromDraft === null ? null : await chatSourceOf(fromDraft);
        if (!existing && fromDraft !== null && ((await liveDraftRoutineId(fromDraft)) !== null || (chat !== null && (await liveDraftRoutineId(chat)) !== null))) {
          return { ok: false, message: LIBRARY_COPY.alreadySaved, reason: 'already_saved' };
        }
        if (existing) return await linked(existing.lastOpId === req.opId || existing.version > 1 ? { ok: true, routine: existing, duplicate: true } : { ok: false, message: LIBRARY_COPY.saveFailed });
        const source = await routineFromSource(p, req.from, { id, name: name.name, opId: req.opId, inRotation: req.addToRotation });
        if (source === 'stale') return { ok: false, message: STALE_PREVIEW, reason: 'stale_preview' };
        let made = source;
        if (req.edit !== undefined && source !== null) {
          for (const e of req.edit.exercises) if ((await ensureExercise(e.exerciseId)) === null) return { ok: false, message: LIBRARY_COPY.notFound };
          const ids = req.edit.exercises.map((e) => e.exerciseId);
          const edited = withSaveEdit(source, req.edit, await compoundOf(ids), await distanceOf(ids));
          if (edited.kind === 'invalid') return { ok: false, message: edited.message };
          made = edited.next;
        }
        return await linked(await createOnce(id, req.opId, () => made, LIBRARY_COPY.nothing));
      } catch {
        return { ok: false, message: LIBRARY_COPY.saveFailed };
      }
    },

    /** Older entry point: `Save to Workouts` from a finished workout (Auto loads; Repeat saves through `kind: 'repeat'`). */
    saveFromSession(req: { sessionId: string; name: string; opId: string; addToRotation?: boolean }): Promise<LibrarySaveWrite> {
      return routines.saveFrom({ from: { kind: 'session', sessionId: req.sessionId }, name: req.name, addToRotation: req.addToRotation === true, opId: req.opId });
    },

    rename(req: { routineId: string; name: string; expectedVersion: number; opId: string }): Promise<RoutineWrite> {
      return writeRoutine(req.routineId, (r) => renameRoutine(r, req.name, req.expectedVersion, req.opId, ctx.now()));
    },

    /** Delete (a tombstone): past workouts keep their name; `restore` is its Undo. */
    remove(req: { routineId: string; expectedVersion: number; opId: string }): Promise<RoutineWrite> {
      return writeRoutine(req.routineId, (r) => deleteRoutine(r, req.expectedVersion, req.opId, ctx.now()));
    },

    /**
     * `Change Push A too ›` → Apply (overview-today-edits TE4, §4.2): the
     * routine's slot changed to today's substitute from now on (item cleared,
     * template loads back to automatic, never converted), Ben's
     * `ActionRecord`, and the draft's swap made redundant, in one write. A
     * routine that moved since the card was shown is refused (rule 5).
     */
    async applyTemplateSwap(req: { routineId: string; expectedRoutineVersion: number; slotKey: string; toExerciseId: string; draft: { id: string; editId: string } | null; opId: string }): Promise<TemplateSwapWrite> {
      try {
        const p = await owner();
        const current = await repos().routines.get(req.routineId);
        const to = await ensureExercise(req.toExerciseId);
        if (!current || current.ownerId !== p.id || to === null) return { ok: false, reason: 'missing', message: LIBRARY_COPY.notFound };
        const at = ctx.now();
        const c = swapRoutineSlot(current, req.slotKey, to, req.expectedRoutineVersion, req.opId, at);
        if (c.kind === 'invalid') return { ok: false, reason: 'invalid', message: c.message };
        if (c.kind === 'stale') return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name) };
        const before = current.exercises.find((e) => e.id === req.slotKey);
        const next = c.kind === 'write' ? c.next : c.current;
        const after = next.exercises.find((e) => e.id === req.slotKey);
        if (before === undefined || after === undefined) return { ok: false, reason: 'invalid', message: 'That exercise isn’t in the workout any more.' };
        const fromName = (await exerciseById(before.exerciseId))?.name ?? 'Exercise';
        const versionBefore = c.kind === 'write' ? current.version : current.version - 1;
        const action: ActionRecord = {
          actionId: deriveId(`update-routine:${req.opId}`),
          turnId: null,
          opId: req.opId,
          status: 'committed',
          author: 'ben',
          detail: {
            kind: 'update_routine',
            routineId: current.id,
            routineName: current.name,
            changes: [{ change: 'swap', text: `${fromName} → ${to.name}`.slice(0, 200) }],
            slot: { before, after },
            versionBefore: Math.max(1, versionBefore),
            versionAfter: Math.max(2, versionBefore + 1),
            draft: req.draft,
          },
          failure: null,
          reason: null,
          evidenceRefs: [],
          guardNotes: [],
          entityVersions: [{ entity: 'routine', id: current.id, before: versionBefore, after: versionBefore + 1 }],
          undoneBy: null,
          createdAt: at,
        };
        const r = await ctx.store().repos.drafts.applyRoutineChange({ ownerId: p.id, routine: next, expectedRoutineVersion: c.kind === 'write' ? c.expectedVersion : current.version - 1, action, at });
        if (r.status === 'missing') return { ok: false, reason: 'missing', message: LIBRARY_COPY.notFound };
        if (r.status === 'stale') return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name) };
        return { ok: true, action: r.action, routine: r.routine, duplicate: r.status === 'replayed' };
      } catch {
        return { ok: false, reason: 'failed', message: LIBRARY_COPY.saveFailed };
      }
    },

    /**
     * `Update Push A ›` → Apply (overview-today-edits §11.5, TE15): the
     * checked lines of today's edits written into the workout as its next
     * version, through the editor's own `editRoutine`, with Ben's
     * `update_routine` record (the version before kept, so `revert` is the
     * Undo) and those draft edits marked redundant, in one transaction.
     * Planned from the same dry run the page showed; a workout or draft that
     * moved since is refused (rule 5). Swapped and added exercises go in
     * with `Auto` loads; today's typed loads never go in (TE-B8).
     */
    async applyTodayEdits(req: {
      target: OverviewTarget;
      gymId: string | null;
      typicalEquipment?: readonly EquipmentInstance[];
      checkInId?: string | null;
      routineId: string;
      expectedRoutineVersion: number;
      draft: { id: string; expectedVersion: number };
      lineKeys: readonly string[];
      opId: string;
    }): Promise<TemplateUpdateWrite> {
      try {
        const p = await owner();
        const current = await repos().routines.get(req.routineId);
        if (!current || current.ownerId !== p.id || isDeleted(current)) return { ok: false, reason: 'missing', message: LIBRARY_COPY.notFound };
        const actionId = deriveId(`update-routine:${req.opId}`);
        const prior = await ctx.store().repos.coach.getAction(actionId).catch(() => null);
        if (prior !== null) return { ok: true, action: prior, routine: current, duplicate: true };
        if (current.version !== req.expectedRoutineVersion) return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name) };
        const gymEquipment = req.gymId === null ? req.typicalEquipment : undefined;
        const gymId = req.gymId ?? 'typical-gym-preview';
        const resolved = await resolveOverview(p, req.target, { gymId, gymEquipment });
        if (resolved === null || resolved.kind !== 'routine' || resolved.routine.id !== current.id) return { ok: false, reason: 'stale', message: STALE_PREVIEW };
        const { planCheckIn } = await overviewCheckIn(req.checkInId ?? null);
        const t = await todayFor(p, resolved, gymId, gymEquipment, planCheckIn);
        if (draftMismatch(req.draft, t.draft)) return { ok: false, reason: 'stale', message: STALE_PREVIEW };
        const run = await overviewDryRun(p, resolved, gymId, planCheckIn, gymEquipment, t.input);
        if (run === null || run.today === null || t.draft === null) return { ok: false, reason: 'stale', message: STALE_PREVIEW };
        const card = await templateCardOf(resolved, run, t.draft);
        const chosen = (card?.lines ?? []).filter((l) => req.lineKeys.includes(l.key));
        if (chosen.length === 0) return { ok: false, reason: 'invalid', message: LIBRARY_COPY.nothing };
        for (const id of [...run.today.resolved.swaps.values()].map((x) => x.toExerciseId).concat([...run.today.resolved.added.values()].map((x) => x.exerciseId))) {
          if ((await ensureExercise(id)) === null) return { ok: false, reason: 'missing', message: LIBRARY_COPY.notFound };
        }
        const at = ctx.now();
        const today = todayShapes(run.aggregate, run.today.slotOf);
        const c = applyEditsToRoutine({ current, lines: chosen, resolved: run.today.resolved, today, expectedVersion: req.expectedRoutineVersion, opId: req.opId, at, isCompound: await compoundOf(current.exercises.map((e) => e.exerciseId)) });
        if (c.kind === 'invalid') return { ok: false, reason: 'invalid', message: c.message };
        if (c.kind === 'stale') return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name) };
        if (c.kind === 'duplicate') return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name) };
        const editIds = chosen.flatMap((l) => l.editIds);
        const kindOf = { swap: 'swap', add: 'add', remove: 'remove', order: 'reorder', sets: 'edit', reps: 'edit' } as const;
        const action: ActionRecord = {
          actionId,
          turnId: null,
          opId: req.opId,
          status: 'committed',
          author: 'ben',
          detail: {
            kind: 'update_routine',
            routineId: current.id,
            routineName: current.name,
            changes: chosen.map((l) => ({ change: kindOf[l.kind], text: `${l.label}: ${l.text}${l.detail === null ? '' : ` ${l.detail}`}`.replaceAll(NBSP, ' ').slice(0, 200) })).slice(0, 40),
            before: current,
            versionBefore: current.version,
            versionAfter: c.next.version,
            draft: editIds[0] === undefined ? null : { id: t.draft.id, editId: editIds[0], editIds },
          },
          failure: null,
          reason: null,
          evidenceRefs: [],
          guardNotes: [],
          entityVersions: [{ entity: 'routine', id: current.id, before: current.version, after: c.next.version }],
          undoneBy: null,
          createdAt: at,
        };
        const r = await ctx.store().repos.drafts.applyRoutineChange({ ownerId: p.id, routine: c.next, expectedRoutineVersion: current.version, action, at });
        if (r.status === 'missing') return { ok: false, reason: 'missing', message: LIBRARY_COPY.notFound };
        if (r.status === 'stale') return { ok: false, reason: 'stale', message: LIBRARY_COPY.changed(current.name) };
        return { ok: true, action: r.action, routine: r.routine, duplicate: r.status === 'replayed' };
      } catch {
        return { ok: false, reason: 'failed', message: LIBRARY_COPY.saveFailed };
      }
    },

    /**
     * Undo of `Change Push A too ›` (TE4): the slot goes back exactly as it
     * was while the routine is still at the version Apply made, and today's
     * swap comes back. Otherwise nothing changes: `Can't undo: Push A changed since.`
     */
    async undoTemplateSwap(req: { actionId: string; opId: string }): Promise<TemplateSwapWrite> {
      try {
        const p = await owner();
        const target = await ctx.store().repos.coach.getAction(req.actionId);
        if (target === null || target.detail.kind !== 'update_routine') return { ok: false, reason: 'missing', message: 'That change wasn’t found.' };
        const at = ctx.now();
        const undo: ActionRecord = {
          ...target,
          actionId: deriveId(`undo-routine:${req.opId}`),
          opId: req.opId,
          author: 'ben',
          detail: { kind: 'undo', undoneActionId: target.actionId, what: `the change to ${target.detail.routineName}`.slice(0, 200), restored: [], alreadyLogged: [] },
          entityVersions: [],
          undoneBy: null,
          createdAt: at,
        };
        const r = await ctx.store().repos.drafts.undoRoutineChange({ ownerId: p.id, undo, at, newRoutineAtUtc: at.utc });
        if (r.status === 'not_possible') {
          return r.reason === 'changed_since' ? { ok: false, reason: 'changed_since', message: DRAFT_COPY.cantUndo(target.detail.routineName) } : { ok: false, reason: 'missing', message: DRAFT_COPY.cantUndo(target.detail.routineName) };
        }
        return { ok: true, action: r.undo, routine: r.routine, duplicate: r.status === 'replayed' };
      } catch {
        return { ok: false, reason: 'failed', message: LIBRARY_COPY.saveFailed };
      }
    },

    restore(req: { routineId: string; expectedVersion: number; opId: string }): Promise<RoutineWrite> {
      return writeRoutine(req.routineId, (r) => restoreRoutine(r, req.expectedVersion, req.opId, ctx.now()));
    },

    /** The routine sheet at this gym. Saves nothing; null when it can't be built. */
    async preview(routineId: string, gymId: string): Promise<RoutinePreview | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const { rows } = await routineRows(p.id);
        const row = rows.find((x) => x.id === routineId);
        if (!row) return null;
        const { r, ref, source, targeted } = await routineStart(p, { routineId, gymId, opId: `preview-routine:${routineId}`, preview: true });
        if (!r.ok) return null;
        const gymName = source?.session.gymId ? ((await repos().gyms.get(source.session.gymId).catch(() => null))?.name ?? null) : null;
        return {
          routine: row,
          targets: targetSummaryLines(r.aggregate),
          notes: r.notes,
          aboutMinutes: await aboutMinutes(p, r.aggregate),
          source: targeted ? 'built_in_rule' : 'routine',
          lastDone: ref ? { atUtc: ref.startedAtUtc, tz: ref.tz, gymName } : null,
        };
      } catch {
        return null;
      }
    },

    /** (19 Oct) Library › Your plan › a day: what Start would create at this gym (the same dry run) and about how long. Saves nothing. */
    async planned(routineId: string, gymId: string): Promise<{ aggregate: SessionAggregate; aboutMinutes: number | null } | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        // Review planview S3: the same edited preview as Up next and the overview (TE-A14): with a live draft of today's edits, plan with them.
        const routine = await repos().routines.get(routineId).catch(() => null);
        const t = routine === null ? null : await todayFor(p, { kind: 'routine', routine, ref: null, basis: { kind: 'only' } }, gymId, undefined, null);
        const edited = t === null || t.draft === null ? null : await routineStart(p, { routineId, gymId, opId: `preview-plan-day:${routineId}`, preview: true, todayEdits: t.input });
        const { r } = edited !== null && edited.r.ok ? edited : await routineStart(p, { routineId, gymId, opId: `preview-plan-day:${routineId}`, preview: true });
        if (!r.ok) return null;
        return { aggregate: r.aggregate, aboutMinutes: await aboutMinutes(p, r.aggregate) };
      } catch {
        return null;
      }
    },
  };

  const next = {
    /**
     * (Morning reminder, Ben 20 Oct) A prediction, not Up next: the applied plan's days Up next would name after
     * `firstRoutineId` (Up next now), `count` days ahead, assuming each is done the day it's named (`planDaysAhead`:
     * plan-adapt's least-recently-trained rule, a pin consumed once its day is done, a day this gym can't start
     * skipped). Null with no plan in use (none, paused, or `firstRoutineId` not one of its days). Saves nothing.
     *
     * `dates[i]`: the date day `i` of `days` is reminded on (the run rule for that date). `firstOn` (review
     * ben-runs-20oct S3): the first reminder falls on that later date, so `first` is Up next as the rule picks it
     * there (a pin first, then the run rule for that date, no workout assumed today) and `days` follow it.
     * `firstPinned`: Up next now is the pinned day (`Make next`).
     */
    async planAhead(
      gymId: string,
      firstRoutineId: string,
      count: number,
      dates: readonly string[] = [],
      firstOn: string | null = null,
    ): Promise<{ firstPinned: boolean; first: PlanAheadRow | null; days: PlanAheadRow[] } | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const { live } = await routineRows(p.id);
        const plan = await ctx.store().repos.planDrafts.applied(p.id);
        const nowMs = toMs(ctx.now().utc);
        if ((plan?.applied ?? null) === null || activePause(plan, nowMs, p.timezone) !== null) return null;
        const planDays = planRoutines(plan, live);
        if (!planDays.some((r) => r.id === firstRoutineId)) return null;
        const training = await ctx.store().repos.trainingProfiles.get(p.id).catch(() => null);
        const { days, workouts, live: pin } = await planDueInput(p, planDays, training, plan?.pin ?? null);
        const startable = new Map<string, boolean>();
        for (const r of planDays) startable.set(r.id, (await routineStart(p, { routineId: r.id, gymId, opId: `preview-next-routine:${r.id}`, preview: true })).r.ok);
        const canStart = (d: { routineId: string }) => startable.get(d.routineId) === true;
        // (Ben, 20 Oct) The run rule on predicted days: a long or hard run (planned or done) the day before or after a
        // reminder date keeps legs off it, as Up next does. The dates come in order (`reminderSlots`).
        const all = firstOn === null ? dates : [firstOn, ...dates];
        const from = all[0];
        const to = all.at(-1);
        const acts = from === undefined || to === undefined ? [] : await repos().activities.listBetween(p.id, addDays(from, -1), addDays(to, 2)).catch(() => []);
        const nearOn = (i: number) => {
          const d = dates[i];
          return d === undefined ? null : legRunNear(acts, d);
        };
        const row = (d: (typeof days)[number], pinned: boolean): PlanAheadRow => ({ routineId: d.routineId, name: d.name, dayN: planDays.findIndex((r) => r.id === d.routineId) + 1, of: planDays.length, legs: isLegDay(d.bodyParts), pinned });
        const pick = firstOn === null ? undefined : planDayPick(days, workouts, pin, legRunNear(acts, firstOn), canStart);
        const startId = pick?.day.routineId ?? firstRoutineId;
        const order = planDaysAhead({ days, workouts, pin, firstRoutineId: startId, count, fromMs: nowMs, windowDays: SPLIT_WINDOW_DAYS, canStart, nearOn });
        return { firstPinned: pin?.routineId === firstRoutineId, first: pick === undefined ? null : row(pick.day, pick.pinned), days: order.map((d) => row(d, false)) };
      } catch {
        return null;
      }
    },

    /**
     * (Morning reminder, Ben 20 Oct) Which of these workouts are leg days for the run rule (`planDayBodyParts` with
     * the split in use, `isLegDay`). Unreadable: none.
     */
    async legDayIds(routineIds: readonly string[]): Promise<Set<string>> {
      try {
        const p = await ctx.profile();
        if (!p) return new Set();
        const { live } = await routineRows(p.id);
        const routines = live.filter((r) => routineIds.includes(r.id));
        const training = await ctx.store().repos.trainingProfiles.get(p.id).catch(() => null);
        const of = await exerciseLookup(routines);
        const split = splitInUse(training);
        return new Set(routines.filter((r) => isLegDay(planDayBodyParts(r, of, split))).map((r) => r.id));
      } catch {
        return new Set();
      }
    },

    /**
     * Today's `Start workout` card (audit B2): the last workout with next
     * targets, previewed at this gym. Saves nothing; null when there's no
     * workout to build from. Never throws (an unreadable record hides the card).
     */
    async preview(gymId: string): Promise<NextSessionPreview | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        // Rotation (D19, simplified): the routine after the one done last, when the last workout was a routine's (the overview's resolver).
        const up = await resolveUpNext(p, gymId);
        if (up === null) return null;
        if (up.kind === 'routine') {
          // Up next reads the same edited preview as the overview (TE-A14): with a live draft, plan with its edits.
          const resolvedR: ResolvedOverview = { kind: 'routine', routine: up.routine, ref: up.run.ref, basis: { kind: 'only' } };
          const t = await todayFor(p, resolvedR, gymId, undefined, null);
          const edited = t.draft === null ? null : await routineStart(p, { routineId: up.routine.id, gymId, opId: `preview-next-routine:${up.routine.id}`, preview: true, todayEdits: t.input });
          const { r, ref } = edited !== null && edited.r.ok ? { r: edited.r, ref: edited.ref } : up.run;
          const derived = await titleFor(liveExercises(r.aggregate.exercises).map((e) => e.exerciseId));
          return {
            routine: { id: up.routine.id, basis: up.basis },
            sourceSessionId: ref?.sessionId ?? null,
            title: up.routine.name,
            muscles: derived.muscles,
            exercises: repeatPreviewLines(r.aggregate).map((l) => ({ exerciseName: l.exerciseName, line: l.line })),
            targets: targetSummaryLines(r.aggregate),
            sets: r.aggregate.sets.length,
            aboutMinutes: await aboutMinutes(p, r.aggregate),
            sourceStartedAtUtc: ref?.startedAtUtc ?? null,
            tz: ref?.tz ?? ctx.now().tz,
            why: ('why' in up ? up.why : null) ?? null,
          };
        }
        const last = { sessionId: up.sessionId };
        const source = await repos().sessions.get(last.sessionId);
        if (!source) return null;
        const targets = await nextTargetsOf(p, source);
        const t = await todayFor(p, { kind: 'next', source, basis: { kind: 'next_from', at: source.session.startedAt } }, gymId, undefined, null);
        const lastUsedHere = await lastUsedFor(p.id, [...source.exercises.map((e) => e.exerciseId), ...swapExerciseIds(t.input)], gymId);
        const r = await domain().startFromSession({ ownerId: p.id, gymId, routineId: null, opId: `preview-next:${last.sessionId}`, at: ctx.now(), sourceSessionId: last.sessionId, preview: true, targets, lastUsedHere, today: t.input, includeNotDone: cutShort(source) });
        if (!r.ok) return null;
        const derived = await titleFor(liveExercises(source.exercises).map((e) => e.exerciseId));
        return {
          routine: null,
          sourceSessionId: last.sessionId,
          title: upNextName(source) ?? derived.title,
          muscles: derived.muscles,
          exercises: repeatPreviewLines(r.aggregate).map((l) => ({ exerciseName: l.exerciseName, line: l.line })),
          targets: targetSummaryLines(r.aggregate),
          sets: r.aggregate.sets.length,
          aboutMinutes: await aboutMinutes(p, r.aggregate),
          sourceStartedAtUtc: source.session.startedAt.utc,
          tz: source.session.startedAt.tz,
          why: ('why' in up ? up.why : null) ?? null,
        };
      } catch {
        return null;
      }
    },
  };

  /** Two years of FitNotes history is a few hundred workouts; small rows, no decode. */
  const TYPE_ROW_LIMIT = 2000;

  const sessionTypes = {
    /**
     * The session picker's rows (session-picker §3, §7): routines and named
     * workouts, one row per normalised name, in picker order. `UP NEXT` is
     * the session Today's card shows (the same D19 resolver), so the two
     * always agree, Decision 2 (longest gap) included. Imported
     * workouts are typed by FitNotes Category (Decision 1) and start like any
     * other (B7). Local reads only: no AI, no network, nothing written.
     * Never throws: null when it can't be read.
     */
    async list(req: { gymId: string | null; typicalEquipment?: readonly EquipmentInstance[] }): Promise<SessionList | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const now = ctx.now();
        const live = liveRoutines(await repos().routines.listByOwner(p.id));
        const index = await typeIndex(p, live);
        const up = await resolveUpNext(p, req.gymId ?? 'typical-gym-preview', req.gymId === null ? req.typicalEquipment : undefined).catch(() => null);
        const startable = index.types.filter((t) => t.startable);
        // Up next is a row only when the row opens exactly that plan (review r2 B1): the same routine, or a named type whose
        // newest workout is Up next's source. A workout that joined a routine by name keeps the routine row on the routine.
        const upKey = up === null ? null : up.kind === 'routine' ? routineTypeKey(up.routine.id) : (index.keyOfSession.get(up.sessionId) ?? null);
        const upType = upKey === null ? undefined : startable.find((t) => t.key === upKey);
        const recommendedKey =
          up === null || upType === undefined
            ? null
            : up.kind === 'routine'
              ? upType.routineId === up.routine.id
                ? upKey
                : null
              : upType.routineId === null && upType.sourceSessionId === up.sessionId
                ? upKey
                : null;
        // `Edited`: an open draft with edits, for the plan the row opens (a routine, or the type's newest workout).
        const drafts = await ctx
          .store()
          .repos.drafts.listByOwner(p.id)
          .catch(() => [] as PreStartDraft[]);
        const editedBases = new Set(drafts.filter((d) => d.status === 'open' && draftIsLive(d, now.utc) && liveEdits(d.edits).length > 0).map((d) => draftBasisKey(d.basis)));
        // The plan a row's target opens: `next` is Up next's own plan (the routine, or its source workout).
        const opened = (target: OverviewTarget): DraftBasis | null => {
          if (target.kind === 'routine') return { kind: 'routine', routineId: target.routineId };
          if (target.kind === 'session') return { kind: 'next', sourceSessionId: target.sourceSessionId };
          if (up === null) return null;
          return up.kind === 'routine' ? { kind: 'routine', routineId: up.routine.id } : { kind: 'next', sourceSessionId: up.sessionId };
        };
        const isEdited = (target: OverviewTarget): boolean => {
          const basis = opened(target);
          return basis !== null && editedBases.has(draftBasisKey(basis));
        };
        const targetOf = (t: SessionType): OverviewTarget =>
          t.key === recommendedKey ? { kind: 'next' } : t.routineId !== null ? { kind: 'routine', routineId: t.routineId } : { kind: 'session', sourceSessionId: t.sourceSessionId ?? '' };
        const row = (t: SessionType): SessionPickerRow => ({
          key: t.key,
          label: t.label,
          kind: t.kind,
          target: targetOf(t),
          routineId: t.routineId,
          sourceSessionId: t.sourceSessionId,
          lastDone: t.lastDone,
          exerciseCount: t.exerciseCount,
          recommended: t.key === recommendedKey,
          edited: isEdited(targetOf(t)),
        });
        const ordered = orderSessionTypes(startable, recommendedKey);
        const fromCoach = await coachDraftRows(p).catch(() => [] as CoachDraftRow[]);
        // (Ben, 20 Oct) The plan in use's days first, in plan order (none while paused).
        const applied = await ctx.store().repos.planDrafts.applied(p.id).catch(() => null);
        const planIds = activePause(applied, toMs(now.utc), p.timezone) !== null ? [] : planRoutines(applied, live).map((r) => r.id);
        const inPlan = new Set(planIds);
        const notPlan = (t: SessionType) => t.routineId === null || !inPlan.has(t.routineId);
        const planRows = planIds.flatMap((rid) => {
          const t = [...ordered.workouts, ...ordered.older].find((x) => x.routineId === rid);
          return t === undefined ? [] : [row(t)];
        });
        return {
          upNext: ordered.upNext === null ? null : row(ordered.upNext),
          plan: planRows,
          workouts: ordered.workouts.filter(notPlan).map(row),
          fromHistory: ordered.fromHistory.map(row),
          older: ordered.older.filter(notPlan).map(row),
          recommendedKey,
          fromCoach,
        };
      } catch {
        return null;
      }
    },
  };

  /** The check-in an overview plans with: a score tapped on the page, else one reused from the last 2 h (the gate). */
  async function overviewCheckIn(tappedId: string | null): Promise<{ gate: CheckInGate; reused: CheckIn | null; planCheckIn: CheckIn | null }> {
    const gate = await checkIns.gate().catch((): CheckInGate => ({ kind: 'ask' }));
    const reused = gate.kind === 'reuse' ? await repos().checkIns.get(gate.checkInId) : null;
    const tapped = tappedId ? await repos().checkIns.get(tappedId) : null;
    return { gate, reused, planCheckIn: tapped ?? reused };
  }

  /** What every draft write names: the page's target and gym (the plan the edit is checked against). */
  /** One command of a draft write, with its own op ID (a batch keeps each edit's idempotency). */
  interface DraftStep {
    opId: string;
    command: DraftCommand;
  }

  interface DraftTarget {
    target: OverviewTarget;
    gymId: string | null;
    typicalEquipment?: readonly EquipmentInstance[];
    expectedDraftVersion: number | null;
    opId: string;
  }

  /**
   * One draft write (overview-today-edits §4.2): versioned on
   * `expectedDraftVersion`, idempotent on `opId`. The command is checked
   * against today's plan (the routine or source workout as stored now);
   * edits the plan no longer has a place for are marked removed in the same
   * write. Local only; never an AI call.
   */
  async function writeDraft(
    req: DraftTarget,
    make: (slots: { base: ReturnType<typeof basisSlots>; today: ReturnType<typeof basisSlots> }) => DraftCommand | DraftStep[] | null | Promise<DraftCommand | DraftStep[] | null>,
  ): Promise<DraftWrite> {
    try {
      const p = await owner();
      const resolved = await resolveOverview(p, req.target, { gymId: req.gymId ?? 'typical-gym-preview', gymEquipment: req.gymId === null ? req.typicalEquipment : undefined });
      if (resolved === null) return { ok: false, reason: 'stale', message: STALE_PREVIEW };
      const at = ctx.now();
      const drafts = ctx.store().repos.drafts;
      await drafts.expire(p.id, at.utc);
      const basis = basisOf(resolved);
      const current = await drafts.open(p.id, basis);
      const base = basisSlots(slotBasisOf(resolved));
      // A swap to an exercise that can't be found any more is pruned too, as the plan treats it (review N3).
      const known = new Set<string>();
      for (const e of current === null ? [] : liveEdits(current.edits)) {
        const exId = e.kind === 'swap' ? e.toExerciseId : e.kind === 'add' ? e.exerciseId : null;
        if (exId !== null && (await exerciseById(exId)) !== null) known.add(exId);
      }
      const resolvedEdits = current === null ? null : resolveTodayEdits(base, current.edits, (id) => known.has(id));
      const made = await make({ base, today: resolvedEdits === null ? base : editedSlots(base, resolvedEdits) });
      if (made === null) return { ok: false, reason: 'invalid', message: DRAFT_COPY.failed };
      // One command, or several written together (a coach Apply's edits, review B2): all of them in one save, or none.
      const steps: DraftStep[] = Array.isArray(made) ? made : [{ opId: req.opId, command: made }];
      if (steps.length === 0) return { ok: false, reason: 'invalid', message: DRAFT_COPY.failed };
      if (steps.length > 1 && (current?.version ?? null) !== req.expectedDraftVersion) {
        if (current !== null && steps.every((x) => current.opIds.includes(x.opId))) return { ok: true, draft: current, duplicate: true, added: [], removed: [] };
        return { ok: false, reason: 'stale', message: DRAFT_COPY.failed };
      }
      let draft = current;
      let wrote = false;
      let duplicates = 0;
      const added: string[] = [];
      const removed: string[] = [];
      for (const [i, step] of steps.entries()) {
        const c = applyDraftCommand({
          current: draft,
          expectedVersion: i === 0 ? req.expectedDraftVersion : (draft?.version ?? null),
          opId: step.opId,
          at,
          ownerId: p.id,
          basis,
          newDraftId: draft?.id ?? ctx.newId(),
          slots: base,
          prune: i > 0 || resolvedEdits === null ? [] : pruneOf(resolvedEdits.outcomes),
          command: step.command,
        });
        if (c.kind === 'duplicate') {
          duplicates += 1;
          continue;
        }
        if (c.kind === 'unchanged') continue;
        // Only the draft moved (a quick second tap on an older version): nothing about the plan to announce (review S2).
        if (c.kind === 'stale') return { ok: false, reason: 'stale', message: DRAFT_COPY.failed };
        if (c.kind === 'invalid') return { ok: false, reason: 'invalid', message: DRAFT_COPY.failed };
        draft = c.next;
        wrote = true;
        added.push(...c.added);
        removed.push(...c.removed);
      }
      if (!wrote || draft === null) return { ok: true, draft, duplicate: duplicates === steps.length, added: [], removed: [] };
      const saved = await drafts.save(draft, current?.version ?? null);
      if (!saved.ok) {
        // A retry whose first write landed reads as done; anything else moved under the page.
        const now = await drafts.open(p.id, basis);
        if (now !== null && steps.every((x) => now.opIds.includes(x.opId))) return { ok: true, draft: now, duplicate: true, added: [], removed: [] };
        return { ok: false, reason: 'stale', message: DRAFT_COPY.failed };
      }
      return { ok: true, draft, duplicate: false, added, removed };
    } catch {
      return { ok: false, reason: 'failed', message: DRAFT_COPY.failed };
    }
  }

  /**
   * Whether a typed load is in the row's keypad frame as the page shows it
   * now: the same unit and convention (a `total` load on a dumbbell row, or
   * kg at an lb rack, is refused; review S3). A row with no keypad
   * (bodyweight) takes no load.
   */
  async function loadInFrame(req: DraftTarget, slotKey: string, load: Load): Promise<boolean> {
    try {
      const page = await overview.load({ target: req.target, gymId: req.gymId, ...(req.typicalEquipment ? { typicalEquipment: req.typicalEquipment } : {}) });
      const frame = page?.view.rows.find((r) => r.slotKey === slotKey)?.editRow.keypad ?? null;
      return frame !== null && frame.unit === load.unit && frame.convention === load.convention;
    } catch {
      return false;
    }
  }

  /** Whether `toExerciseId` may replace the slot's exercise today: it exists, measures the same way, and this gym can do it. */
  // Runs inside `writeDraft` on the base slots it already resolved, so a swap resolves the overview once (review r2 N5).
  async function swapAllowed(req: DraftTarget, base: readonly { slotKey: string; exerciseId: string }[], slotKey: string, toExerciseId: string): Promise<boolean> {
    try {
      const gymId = req.gymId ?? 'typical-gym-preview';
      const slot = base.find((x) => x.slotKey === slotKey);
      if (slot === undefined) return true; // applyDraftCommand refuses it as `slot_gone`.
      const [planned, to] = await Promise.all([exerciseById(slot.exerciseId), exerciseById(toExerciseId)]);
      if (planned === null || to === null || to.measurement !== planned.measurement) return false;
      const equipment = req.gymId === null ? (req.typicalEquipment ?? []) : await repos().equipment.listByGym(req.gymId);
      return doableHere(to, { id: gymId, name: '', equipment });
    } catch {
      return false;
    }
  }

  /**
   * The coach fit's inputs (fit-to-time §5.1): today's shown plan without any
   * fit, as the request's context and the validator's slots, and the checks
   * an added or swapped exercise must pass. Local reads only.
   */
  async function coachFitPlan(p: UserProfile, req: DraftTarget & { minutes: number; checkInId?: string | null }, page: OverviewData) {
    const gymId = req.gymId ?? 'typical-gym-preview';
    const typical = req.gymId === null ? req.typicalEquipment : undefined;
    const resolved = await resolveOverview(p, req.target, { gymId, gymEquipment: typical });
    if (resolved === null) return null;
    const { planCheckIn } = await overviewCheckIn(req.checkInId ?? null);
    const t = await todayFor(p, resolved, gymId, typical, planCheckIn);
    // The plan without any fit: a coach fit replaces the live one.
    const without = { ...t.input, edits: t.input.edits.filter((e) => e.kind !== 'fit' && e.author !== 'coach') };
    const run = await overviewDryRun(p, resolved, gymId, planCheckIn, typical, without);
    if (run === null || run.today === null) return null;
    const at = ctx.now();
    const flags = await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]);
    const held = (exerciseId: string) => painFlagCovering(flags, exerciseId, toMs(at.utc), at.tz) !== null;
    const info = new Map<string, Exercise | null>();
    const exOf = async (id: string) => {
      if (!info.has(id)) info.set(id, await exerciseById(id));
      return info.get(id) ?? null;
    };
    for (const ex of run.aggregate.exercises) await exOf(ex.exerciseId);
    const r = run.today.resolved;
    const benEdited = new Set([...benEditedSlots(r), ...[...r.skipped].filter(([, id]) => !r.coachEdits.has(id)).map(([k]) => k)]);
    const lastBySlot = new Map(page.view.rows.map((row) => [row.slotKey, row.panel.find((l) => l.key === 'last')?.value ?? null]));
    const { items, slots } = fitPlanOf({
      aggregate: run.aggregate,
      slotOf: run.today.slotOf,
      tiers: run.today.tiers,
      benEdited,
      skipped: new Set(r.skipped.keys()),
      held,
      muscles: (id) => info.get(id)?.primaryMuscles ?? [],
      lastOf: (sx) => lastBySlot.get(run.today?.slotOf[sx] ?? sx) ?? null,
      ruleTargetRpe: ruleTargetRpes(run.aggregate, (id) => (info.has(id) ? (info.get(id) ?? null) : undefined)),
    });
    const unfittedSeconds = estimateRemainingDuration(run.aggregate, { pace: page.pace }).seconds;
    const equipment = typical ?? (await repos().equipment.listByGym(gymId).catch(() => [] as EquipmentInstance[]));
    const gym = { id: gymId, name: page.view.gym?.name ?? 'this gym', equipment };
    const inPlan = new Set(run.aggregate.exercises.map((e) => e.exerciseId));
    // Ben's own exercises (done before, in his list), usable here, not flagged, not in today's plan: only when filling a longer session.
    const own: { exerciseId: string; name: string }[] = [];
    if (req.minutes * 60 > unfittedSeconds) {
      for (const id of await workout.recentExerciseIds(40).catch(() => [] as string[])) {
        const e = await exOf(id);
        if (e === null || inPlan.has(id) || held(id) || !doableHere(e, gym)) continue;
        own.push({ exerciseId: id, name: e.name });
        if (own.length >= 20) break;
      }
    }
    const ownIds = new Set(own.map((o) => o.exerciseId));
    const canAdd = (exerciseId: string): AddCheck => {
      const e = info.get(exerciseId) ?? null;
      if (inPlan.has(exerciseId)) return { ok: false, why: 'in_plan' };
      if (!ownIds.has(exerciseId) || e === null) return { ok: false, why: 'not_own' };
      if (held(exerciseId)) return { ok: false, why: 'pain_hold' };
      return { ok: true, name: e.name, muscles: e.primaryMuscles };
    };
    const canSwap = (slotKey: string, exerciseId: string): SwapCheck => {
      const slot = slots.find((x) => x.slotKey === slotKey);
      const to = info.get(exerciseId) ?? ctx.catalogueExercises?.().find((x) => x.id === exerciseId) ?? null;
      const from = slot === undefined ? null : (info.get(slot.exerciseId) ?? null);
      if (slot === undefined || to === null || from === null) return { ok: false, why: 'not_own' };
      if (inPlan.has(exerciseId)) return { ok: false, why: 'in_plan' };
      if (held(exerciseId)) return { ok: false, why: 'pain_hold' };
      if (to.measurement !== from.measurement || !doableHere(to, gym)) return { ok: false, why: 'not_here' };
      return { ok: true, name: to.name };
    };
    const equipmentKinds = [...new Set(equipment.map((e) => e.kind))];
    const context: TodayFitContext = {
      workout: page.view.title,
      minutes: req.minutes,
      // Unrounded (one decimal) and the validator's own direction, so `Fill` is never sent for a shorten (review C S1).
      estimateMinutes: Math.round(unfittedSeconds / 6) / 10,
      shorten: fitShortens(req.minutes, unfittedSeconds),
      paceSource: PACE_SOURCE_LABEL[page.pace.source],
      goal: null,
      priorityGroups: [],
      painFlags: flags.map((f) => ({ exercise: f.exerciseName, area: f.area })),
      equipmentKinds,
      plan: items,
      ownExercises: own,
    };
    return { context, slots, unfittedSeconds, canAdd, canSwap, basis: basisOf(resolved), baseSlots: run.today.baseSlots, resolved, gymId, checkIn: planCheckIn, nameOf: new Map(slots.map((x) => [x.slotKey, x.name])) };
  }

  const overview = {
    /**
     * `services.overview.load` (workout-overview §7): the page for Up next or
     * a routine at this gym. Local and read-only; no AI and no network. Never
     * throws: null when the preview can't be built. `gymId` null: no gym yet,
     * so the rows are fitted to `typicalEquipment` (what Start will save).
     * `checkInId`: a score Ben tapped on the page (pain mentioned holds loads).
     */
    async load(req: { target: OverviewTarget; gymId: string | null; checkInId?: string | null; typicalEquipment?: readonly EquipmentInstance[] }): Promise<OverviewData | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        if (req.gymId === null && !req.typicalEquipment) return null;
        const resolved = await resolveOverview(p, req.target, { gymId: req.gymId ?? 'typical-gym-preview', gymEquipment: req.gymId === null ? req.typicalEquipment : undefined });
        if (resolved === null) return null;
        const { gate, reused, planCheckIn } = await overviewCheckIn(req.checkInId ?? null);
        const gymId = req.gymId ?? 'typical-gym-preview';
        const typical = req.gymId === null ? req.typicalEquipment : undefined;
        // A draft past its local midnight is closed now (TE5); one for this workout with edits says so once.
        const closed = await ctx
          .store()
          .repos.drafts.expire(p.id, ctx.now().utc)
          .catch(() => [] as PreStartDraft[]);
        const basisKey = draftBasisKey(basisOf(resolved));
        const cleared = closed.some((d) => draftBasisKey(d.basis) === basisKey && liveEdits(d.edits).length > 0);
        const t = await todayFor(p, resolved, gymId, typical, planCheckIn);
        const run = await overviewDryRun(p, resolved, gymId, planCheckIn, typical, t.input);
        if (run === null) return null;
        const { aggregate } = run;
        const pasts: Record<string, PastExercise[]> = {};
        const exerciseInfo: Record<string, Exercise> = {};
        for (const ex of aggregate.exercises) {
          if (ex.exerciseId in pasts) continue;
          const history = await repos().sessions.listFinishedWithExercise(p.id, ex.exerciseId).catch(() => [] as HistoryWorkout[]);
          pasts[ex.exerciseId] = pastExercisesOf(history, ex.exerciseId);
          const info = await repos().exercises.get(ex.exerciseId).catch(() => null);
          if (info) exerciseInfo[ex.exerciseId] = info;
        }
        const allGyms = (await repos().gyms.listByOwner(p.id)).filter((g) => g.archivedAtUtc === undefined);
        const gym = req.gymId === null ? null : (allGyms.find((g) => g.id === req.gymId) ?? null);
        if (req.gymId !== null && gym === null) return null;
        const at = ctx.now();
        const title =
          resolved.kind === 'next' ? (upNextName(resolved.source) ?? (await titleFor(liveExercises(resolved.source.exercises).map((e) => e.exerciseId))).title) : resolved.kind === 'coach_draft' ? resolved.draft.name : resolved.routine.name;
        const source = await overviewSource(resolved);
        // A failed read shows no coach rows; the key below reads them again, so a Start planned without them is refused.
        const coachTargets = await storedCoachTargets(p.id, source).catch(() => [] as NextSessionTargetRecord[]);
        const recent = await recentFinished(p);
        const view = buildWorkoutOverview({
          aggregate,
          fits: run.fits,
          coach: source === null || coachTargets.length === 0 ? null : { targets: coachTargets, sourceVersion: source.session.version, sourceBasis: nextTargetSourceBasis(source), painToday: unspecifiedPain(planCheckIn).active },
          pasts,
          painFlags: await repos().painFlags.listActive(p.id),
          exerciseInfo,
          recent,
          // The same pace a fit trims with, so the tile and the card agree (FT7).
          pace: planPace(recent),
          nowMs: toMs(at.utc),
          tz: at.tz,
          title,
          basis: resolved.basis,
          gym: gym === null ? null : { id: gym.id, name: gym.name },
          key: await previewKeyParts(p, resolved, req.gymId, planCheckIn, t.draft),
          today: await overviewToday(resolved, run.today, t.draft),
          ...(resolved.kind === 'coach_draft' ? { targetRpe: true } : {}),
        });
        const rows = resolved.kind === 'routine' ? (await routineRows(p.id)).rows : [];
        return {
          view,
          startOf: resolved.kind === 'routine' ? { routineOf: resolved.routine.id } : resolved.kind === 'coach_draft' ? { coachDraftOf: resolved.draft.id } : { nextOf: resolved.source.session.id },
          routine: resolved.kind === 'routine' ? (rows.find((r) => r.id === resolved.routine.id) ?? null) : null,
          gyms: [...allGyms].sort((a, b) => Number(b.id === req.gymId) - Number(a.id === req.gymId) || a.name.localeCompare(b.name)).map((g) => ({ id: g.id, name: g.name, isDefault: g.isDefault })),
          checkIn: gate.kind === 'reuse' ? (reused ? { kind: 'reuse', checkIn: reused } : { kind: 'ask' }) : gate.kind === 'ask' ? { kind: 'ask' } : { kind: 'skip', reason: gate.reason },
          planCheckIn,
          unit: p.preferredUnit,
          coachTargets: Object.fromEntries(coachTargets.map((r) => [r.id, r])),
          draft: t.draft === null ? null : { id: t.draft.id, version: t.draft.version },
          cleared,
          removedEdits: (run.today?.outcomes ?? []).filter((o: EditOutcome) => o.result === 'stale').length,
          reordered: (run.today?.resolved.order ?? null) !== null,
          templateCard: await templateCardOf(resolved, run, t.draft),
          pace: planPace(recent),
          coachFit: await coachFitInfo(run.today),
          coachDraft: resolved.kind === 'coach_draft' ? await coachDraftInfoOf(resolved.draft, { ownerId: p.id, rows: view.rows, aggregate, draftWhy: run.draftWhy ?? {} }) : null,
        };
      } catch {
        return null;
      }
    },

    /**
     * `Why?` on a row (active-workout §2.12 content, in a sheet): the first
     * working set of the exercise at `index` in the same dry run. Reads only.
     */
    async explain(req: { target: OverviewTarget; gymId: string | null; checkInId?: string | null; typicalEquipment?: readonly EquipmentInstance[]; sessionExerciseId: string }): Promise<TargetExplanation | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const resolved = await resolveOverview(p, req.target, { gymId: req.gymId ?? 'typical-gym-preview', gymEquipment: req.gymId === null ? req.typicalEquipment : undefined });
        if (resolved === null) return null;
        // The same check-in the page planned with (tapped, else reused), so `Why?` explains the row it opens on (review S1).
        const { planCheckIn: today } = await overviewCheckIn(req.checkInId ?? null);
        const typical = req.gymId === null ? req.typicalEquipment : undefined;
        const t = await todayFor(p, resolved, req.gymId ?? 'typical-gym-preview', typical, today);
        const run = await overviewDryRun(p, resolved, req.gymId ?? 'typical-gym-preview', today, typical, t.input);
        const ex = run?.aggregate.exercises.find((e) => e.id === req.sessionExerciseId);
        if (!run || !ex) return null;
        const set = run.aggregate.sets.filter((x) => x.sessionExerciseId === ex.id && x.setType !== 'warmup' && x.pairedWithSetId === null).sort((a, b) => a.index - b.index)[0];
        if (!set) return null;
        const basisId = set.planned.provenance?.basis?.sessionId ?? null;
        const [basisNow, gyms, flags, history] = await Promise.all([
          basisId === null ? null : repos().sessions.get(basisId).catch(() => null),
          repos().gyms.listByOwner(p.id).catch(() => []),
          repos().painFlags.listByOwner(p.id).catch(() => [] as PainFlag[]),
          historyFor(p.id, ex.exerciseId).catch(() => [] as HistorySession[]),
        ]);
        return explainTarget({
          aggregate: run.aggregate,
          setId: set.id,
          nowMs: toMs(ctx.now().utc),
          basisNow,
          gymNames: Object.fromEntries(gyms.map((g) => [g.id, g.name])),
          painFlags: flags.filter((f) => f.exerciseId === ex.exerciseId),
          history,
        });
      } catch {
        return null;
      }
    },
    /**
     * Today's edits (overview-today-edits §4.2): `Swap today`, `Skip today`,
     * `Undo`, `Bring back`. Each applies at once to the saved pre-start draft
     * (no Apply step: Ben choosing is consent, TE3); nothing outside today
     * changes. The first edit creates the draft (`expectedDraftVersion: null`).
     */
    async edit(req: DraftTarget & { edit: OverviewEdit }): Promise<DraftWrite> {
      const e = req.edit;
      // A typed load is in the row's own keypad frame (its item's unit and convention), else refused (review S3).
      if (e.kind === 'load' && !(await loadInFrame(req, e.slotKey, e.load))) return { ok: false, reason: 'invalid', message: DRAFT_COPY.failed };
      return writeDraft(req, async ({ base }) => {
        if (e.kind === 'swap') {
          // The Swap sheet's own checks, again here (review S5): the same measurement, doable at this gym. Not in today's plan: `applyDraftCommand`.
          if (!(await swapAllowed(req, base, e.slotKey, e.toExerciseId))) return null;
          if ((await ensureExercise(e.toExerciseId)) === null) return null;
        }
        if (e.kind === 'add') {
          // A picked catalogue exercise is saved as a row first (as the workout's `Add exercise` does). The new row's key comes from the opId, so a retry is the same row.
          if ((await ensureExercise(e.exerciseId)) === null) return null;
          return { type: 'edit', edit: { kind: 'add', slotKey: addSlotKey(req.opId), exerciseId: e.exerciseId, ...(e.workingSets === undefined ? {} : { workingSets: e.workingSets }) } };
        }
        return { type: 'edit', edit: e };
      });
    },

    /**
     * Several of today's swap / skip / order edits as one draft write (a
     * coach Apply's changes, ADR 0020 §3; review B2): every edit is checked
     * as `edit` checks it, and either all are written in one versioned save
     * or none is (`invalid` names no edit; the caller reports the Apply).
     * Each edit keeps its own op ID, so a retry, or a later load, writes
     * nothing twice. `opId` is the first edit's.
     */
    async editBatch(req: Omit<DraftTarget, 'opId'> & { edits: readonly { opId: string; edit: Extract<OverviewEdit, { kind: 'swap' | 'skip' | 'order' }> }[] }): Promise<DraftWrite> {
      const first = req.edits[0];
      if (first === undefined) return { ok: false, reason: 'invalid', message: DRAFT_COPY.failed };
      return writeDraft({ ...req, opId: first.opId }, async ({ base }) => {
        for (const { edit: e } of req.edits) {
          if (e.kind !== 'swap') continue;
          if (!(await swapAllowed({ ...req, opId: first.opId }, base, e.slotKey, e.toExerciseId))) return null;
          if ((await ensureExercise(e.toExerciseId)) === null) return null;
        }
        return req.edits.map((x) => ({ opId: x.opId, command: { type: 'edit', edit: x.edit } }));
      });
    },

    /**
     * `How long?` → `Trim to 45 min` (fit-to-time §3.2, FT2, FT4): the fit is
     * written as intent; the built-in trim re-runs on every read. Offline,
     * never an AI call. A length the plan already fits writes nothing
     * (FT-C4: the sheet shows `Fits already`).
     */
    async trimToFit(req: DraftTarget & { minutes: number }): Promise<DraftWrite> {
      const page = await overview.load({ target: req.target, gymId: req.gymId, ...(req.typicalEquipment ? { typicalEquipment: req.typicalEquipment } : {}) });
      const unfitted = page?.view.fit?.beforeSeconds ?? page?.view.estimate?.seconds ?? null;
      if (page !== null && unfitted !== null && unfitted <= req.minutes * 60) {
        return { ok: true, draft: null, duplicate: false, added: [], removed: [] };
      }
      return writeDraft(req, () => ({ type: 'edit', edit: { kind: 'fit', minutes: req.minutes } }));
    },

    /**
     * `Ask coach` on `How long?` (fit-to-time §5, FT6): only when Ben asks.
     * Sends today's shown plan (without any fit), his pain flags and the
     * gym's equipment kinds, and nothing else (§5.1); validates the answer
     * (`validateTodayFit`); and writes what passes as the coach's draft
     * edits with one `fit_today` record, in one versioned write. Applied at
     * once (rule 3: Ben asked; today only); Undo takes all of it back. A
     * page that moved while the coach worked discards the answer (rule 5).
     * Swaps come back as suggestions only. Logging never waits on this.
     */
    async requestCoachFit(req: DraftTarget & { minutes: number; previewKey: string; checkInId?: string | null; signal?: AbortSignal }): Promise<CoachFitOutcome> {
      try {
        if (ctx.coachFit === undefined || !validFitMinutes(req.minutes)) return { kind: 'unavailable' };
        const p = await owner();
        const prior = await ctx.store().repos.coach.findActionByOpId(p.id, req.opId).catch(() => null);
        if (prior !== null && prior.detail.kind === 'fit_today') return { kind: 'applied', actionId: prior.actionId, draft: await ctx.store().repos.drafts.get(prior.detail.draftId).catch(() => null), duplicate: true };
        // Cancel, Start or leaving the page stops it at every step after this, and a Start moves the fence (§3.4, FT-C13; review C B1).
        const aborted = () => req.signal?.aborted === true;
        const startFence = await ctx.store().repos.drafts.startFence(p.id);
        const typical = req.gymId === null ? req.typicalEquipment : undefined;
        const page = await overview.load({ target: req.target, gymId: req.gymId, checkInId: req.checkInId ?? null, ...(typical ? { typicalEquipment: typical } : {}) });
        if (page === null || page.view.previewKey !== req.previewKey || (page.draft?.version ?? null) !== req.expectedDraftVersion) return { kind: 'plan_changed' };
        const plan = await coachFitPlan(p, req, page);
        if (plan === null) return { kind: 'plan_changed' };
        if (aborted()) return { kind: 'cancelled' };
        const answer = await ctx.coachFit(plan.context, req.signal);
        if (aborted()) return { kind: 'cancelled' };
        if (answer === null) return { kind: 'unavailable' };
        if (!answer.ok) {
          if (answer.error === 'timeout') return { kind: 'timeout' };
          if (answer.error === 'cancelled') return { kind: 'cancelled' };
          if (answer.error === 'network') return { kind: 'unavailable' };
          return { kind: 'failed' };
        }
        // The page as it is now: anything that moved while the coach worked discards the answer (§6 `Plan changed`).
        const now = await overview.load({ target: req.target, gymId: req.gymId, checkInId: req.checkInId ?? null, ...(typical ? { typicalEquipment: typical } : {}) });
        if (aborted()) return { kind: 'cancelled' };
        if (now === null || now.view.previewKey !== req.previewKey) return { kind: 'plan_changed' };
        const v = validateTodayFit({ minutes: req.minutes, unfittedSeconds: plan.unfittedSeconds, slots: plan.slots, args: answer.args, canAdd: plan.canAdd, canSwap: plan.canSwap });
        const rejectedText = v.rejected.map((r) => `${r.slotKey === null ? r.kind : (plan.nameOf.get(r.slotKey) ?? r.kind)} · ${FIT_REFUSAL_WORDS[r.why]}`);
        if (v.accepted.length === 0) return { kind: 'rejected', reasons: rejectedText };
        const at = ctx.now();
        const actionId = deriveId(`coach-fit:${req.opId}`);
        const drafts = ctx.store().repos.drafts;
        const current = await liveDraft(p.id, plan.basis);
        if (aborted()) return { kind: 'cancelled' };
        if ((current?.version ?? null) !== req.expectedDraftVersion) return { kind: 'plan_changed' };
        const change = applyDraftCommand({
          current,
          expectedVersion: req.expectedDraftVersion,
          opId: req.opId,
          at,
          ownerId: p.id,
          basis: plan.basis,
          newDraftId: ctx.newId(),
          slots: plan.baseSlots,
          command: { type: 'coach_fit', minutes: req.minutes, actionId, edits: coachFitDraftEdits(v.accepted, req.opId) },
        });
        if (change.kind !== 'write') return change.kind === 'stale' || change.kind === 'duplicate' ? { kind: 'plan_changed' } : { kind: 'rejected', reasons: rejectedText };
        // Before → after from the estimate (FT7): the draft this write leaves, planned now.
        const t = await todayForDraft(p, plan.resolved, plan.gymId, typical, plan.checkIn, change.next);
        const run = await overviewDryRun(p, plan.resolved, plan.gymId, plan.checkIn, typical, t.input);
        if (aborted()) return { kind: 'cancelled' };
        const fit = run?.today?.fit ?? null;
        if (run === null || fit === null) return { kind: 'failed' };
        const beforeMinutes = fitMinutesOf(fit.beforeSeconds, 'fitted', req.minutes);
        const afterMinutes = fitMinutesOf(fit.afterSeconds, fit.status, req.minutes);
        const nameOfSlot = (slotKey: string): string => {
          const sx = Object.entries(run.today?.slotOf ?? {}).find(([, k]) => k === slotKey)?.[0];
          return run.aggregate.exercises.find((e) => e.id === sx)?.exerciseName ?? plan.nameOf.get(slotKey) ?? 'Exercise';
        };
        const lines = fit.lines.map((l) => (l.kind === 'skip' ? `${nameOfSlot(l.slotKey)} · skipped` : l.kind === 'add' ? `${nameOfSlot(l.slotKey)} · added` : `${nameOfSlot(l.slotKey)} · ${String(l.from)} → ${String(l.to)} sets`));
        const fitEdit = change.next.edits.find((e) => change.added.includes(e.editId) && e.kind === 'fit');
        if (fitEdit === undefined) return { kind: 'failed' };
        const action: ActionRecord = {
          actionId,
          turnId: null,
          opId: req.opId,
          status: 'committed',
          author: 'coach',
          detail: {
            kind: 'fit_today',
            workoutLabel: page.view.title.slice(0, 120),
            minutes: req.minutes,
            beforeMinutes,
            afterMinutes,
            draftId: change.next.id,
            fitEditId: fitEdit.editId,
            editIds: change.added,
            lines: lines.map((l) => l.slice(0, 200)),
            rejected: v.rejected.map((r, i) => ({ text: (rejectedText[i] ?? r.why).slice(0, 200), why: r.why })),
            suggestions: v.suggestions.map((x) => ({ slotKey: x.slotKey, toExerciseId: x.toExerciseId, text: `${x.fromName} → ${x.toName}`.slice(0, 200) })),
          },
          failure: null,
          reason: answer.args.reason.trim() === '' ? null : answer.args.reason.trim().slice(0, 240),
          evidenceRefs: [],
          guardNotes: [],
          entityVersions: [{ entity: 'pre_start_draft', id: change.next.id, before: current?.version ?? null, after: change.next.version }],
          undoneBy: null,
          createdAt: at,
        };
        if (aborted()) return { kind: 'cancelled' };
        const r = await drafts.applyCoachFit({ ownerId: p.id, next: change.next, expectedVersion: req.expectedDraftVersion, action, startFence, cancelled: aborted });
        if (r.status === 'cancelled') return { kind: 'cancelled' };
        if (r.status === 'stale' || r.status === 'started') return { kind: 'plan_changed' };
        return { kind: 'applied', actionId: r.action.actionId, draft: r.draft, duplicate: r.status === 'replayed' };
      } catch {
        return { kind: 'failed' };
      }
    },

    /** `Undo` on the coach's fit card (§5.3): every edit it made removed in one write; a built-in fit it replaced comes back. */
    async undoCoachFit(req: { actionId: string; opId: string }): Promise<CoachFitUndoOutcome> {
      try {
        const p = await owner();
        const target = await ctx.store().repos.coach.getAction(req.actionId);
        if (target === null || target.detail.kind !== 'fit_today') return { ok: false, reason: 'missing' };
        const at = ctx.now();
        const undo: ActionRecord = {
          actionId: deriveId(`coach-fit-undo:${req.opId}`),
          turnId: null,
          opId: req.opId,
          status: 'committed',
          author: 'ben',
          detail: { kind: 'undo', undoneActionId: req.actionId, what: `the fit to ${String(target.detail.minutes)} min`, restored: [], alreadyLogged: [] },
          failure: null,
          reason: null,
          evidenceRefs: [],
          guardNotes: [],
          entityVersions: [],
          undoneBy: null,
          createdAt: at,
        };
        const r = await ctx.store().repos.drafts.undoCoachFit({ ownerId: p.id, undo, at });
        if (r.status === 'not_possible') return { ok: false, reason: r.reason === 'missing' ? 'missing' : 'changed_since' };
        return { ok: true, draft: r.draft };
      } catch {
        return { ok: false, reason: 'failed' };
      }
    },

    /**
     * `Clear fit` (fit-to-time §3.2, §5.3): the live fit removed. A coach fit
     * goes through its Undo (`undoCoachFit`), so its edits are removed in one
     * write and the `undo` is in the coach action log (FT-C15; review C S2);
     * a built-in fit it replaced comes back, as with the card's Undo.
     */
    async clearFit(req: DraftTarget): Promise<DraftWrite> {
      // A coach draft's own length is a fit too (BD11): `Clear fit` is "no fit today", which also replaces any other fit.
      if (req.target.kind === 'coach_draft') return writeDraft(req, () => ({ type: 'edit', edit: { kind: 'fit', minutes: null } }));
      try {
        const p = await owner();
        const resolved = await resolveOverview(p, req.target, { gymId: req.gymId ?? 'typical-gym-preview', gymEquipment: req.gymId === null ? req.typicalEquipment : undefined });
        const current = resolved === null ? null : await liveDraft(p.id, basisOf(resolved));
        const fit = current === null ? undefined : liveEdits(current.edits).find((e) => e.kind === 'fit');
        if (current !== null && fit !== undefined && fit.author === 'coach' && fit.actionId !== undefined) {
          if (current.version !== req.expectedDraftVersion) return { ok: false, reason: 'stale', message: DRAFT_COPY.failed };
          const u = await overview.undoCoachFit({ actionId: fit.actionId, opId: req.opId });
          if (!u.ok) return { ok: false, reason: u.reason === 'failed' ? 'failed' : 'stale', message: DRAFT_COPY.failed };
          return { ok: true, draft: u.draft, duplicate: false, added: [], removed: [] };
        }
      } catch {
        return { ok: false, reason: 'failed', message: DRAFT_COPY.failed };
      }
      return writeDraft(req, () => ({ type: 'clear_fit' }));
    },

    /** `Use planned` (reps, load) or a stepper back at the plan's count (§11.4): that edit on the slot is removed. */
    clearEdit(req: DraftTarget & { kind: ShapeEditKind; slotKey: string }): Promise<DraftWrite> {
      return writeDraft(req, () => ({ type: 'clear', kind: req.kind, slotKey: req.slotKey }));
    },

    /**
     * The Add exercise list (§11.4, TE16): any exercise (one already in today's plan is a second copy), doable here
     * unless `showAll`, matching `query`; each row with the target the pick
     * will plan (its own history, else `No history`), flagged ones marked.
     * Reads only; never an AI call.
     */
    async addCandidates(req: { target: OverviewTarget; gymId: string | null; typicalEquipment?: readonly EquipmentInstance[]; checkInId?: string | null; query: string; showAll: boolean }): Promise<AddSheet | null> {
      try {
        const p = await owner();
        const gymEquipment = req.gymId === null ? req.typicalEquipment : undefined;
        const gymId = req.gymId ?? 'typical-gym-preview';
        const resolved = await resolveOverview(p, req.target, { gymId, gymEquipment });
        if (resolved === null) return null;
        const { planCheckIn } = await overviewCheckIn(req.checkInId ?? null);
        // (Ben, 19 Oct) An exercise already in today's plan can be added again as a second copy.
        const all = new Map<string, Exercise>();
        for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) if (!isArchivedExercise(e)) all.set(e.id, e);
        for (const e of ctx.catalogueExercises?.() ?? []) if (!all.has(e.id)) all.set(e.id, e);
        const sctx = await substituteCtx(p, gymId, gymEquipment, planCheckIn, []);
        const histories = new Map<string, HistorySession[]>();
        for (const id of await workout.recentExerciseIds(40).catch(() => [] as string[])) histories.set(id, await historyFor(p.id, id).catch(() => [] as HistorySession[]));
        const aliasesOf = await aliasIndex(p);
        const picked = rankAddCandidates({ exercises: [...all.values()], excludeExerciseIds: new Set<string>(), query: req.query, gym: sctx.gym, showAll: req.showAll, histories, painFlags: sctx.painFlags, nowMs: sctx.nowMs, tz: sctx.at.tz, aliasesOf });
        const rows: SubstituteRow[] = [];
        for (const e of picked) {
          const history = histories.get(e.id) ?? (await historyFor(p.id, e.id).catch(() => [] as HistorySession[]));
          const kind = equipmentHere(e, sctx).equipment?.kind ?? null;
          rows.push(substituteRow(e, addedSlotShape(e, kind), history, { ...sctx, lastUsedHere: await lastUsedFor(p.id, [e.id], gymId) }));
        }
        return { gymName: sctx.gym.name, rows, showAll: req.showAll };
      } catch {
        return null;
      }
    },

    /**
     * Today's load keypad (§11.4) for a value in the row's frame: the
     * stepper's next achievable loads on this item (as the editor's Fixed
     * load), and the note before `Set target` (`Rounds to 97.5 kg here`,
     * `Most here: 30 kg each`; null when makeable). Reads only.
     */
    async loadKeypad(req: { equipmentId: string | null; unit: WeightUnit; convention: LoadConvention; value: number | null }): Promise<{ down: StepTarget; up: StepTarget; note: string | null }> {
      const eq = req.equipmentId === null ? null : await repos().equipment.get(req.equipmentId).catch(() => null);
      const steps = fixedLoadSteps(req.value, { unit: req.unit, convention: req.convention }, eq ?? null);
      const note = req.value === null ? null : todayLoadNote({ value: req.value, unit: req.unit, convention: req.convention }, eq ?? null);
      return { ...steps, note };
    },

    /**
     * `Undo swap` and `<original> · planned` in `Swap again` (§2.4, TE-A6):
     * the slot goes back to the plan, however many swaps were chained on it.
     * The toast's `Undo` (`undoEdit`) still steps back one swap.
     */
    clearSwap(req: DraftTarget & { slotKey: string }): Promise<DraftWrite> {
      return writeDraft(req, () => ({ type: 'clear_swap', slotKey: req.slotKey }));
    },

    /** `Do first`, `Move up`, `Move down` (Reorder): the whole new order is worked out here, a superset moving as one (TE10). */
    async move(req: DraftTarget & { slotKey: string; how: 'first' | 'up' | 'down' }): Promise<DraftWrite> {
      return writeDraft(req, ({ today }) => {
        const order = moveSlot(today, req.slotKey, req.how);
        return order === null ? null : { type: 'edit', edit: { kind: 'order', slotKeys: order } };
      });
    },

    /** Undo one edit (toast Undo, `Undo swap`, `Bring back`): a swap or order it replaced comes back. */
    undoEdit(req: DraftTarget & { editId: string }): Promise<DraftWrite> {
      return writeDraft(req, () => ({ type: 'undo', editId: req.editId }));
    },

    /** `Reset today's edits`: every edit removed, the draft kept open; `removed` is what the toast's Undo restores. */
    resetEdits(req: DraftTarget): Promise<DraftWrite> {
      return writeDraft(req, () => ({ type: 'reset' }));
    },

    /** `Reset order` (Reorder mode). */
    resetOrder(req: DraftTarget): Promise<DraftWrite> {
      return writeDraft(req, () => ({ type: 'clear_order' }));
    },

    /** Undo of a Reset (or of `Reset order`): those edits come back as they were. */
    restoreEdits(req: DraftTarget & { editIds: readonly string[] }): Promise<DraftWrite> {
      return writeDraft(req, () => ({ type: 'restore', editIds: req.editIds }));
    },

    /**
     * The Swap sheet's rows (§2.4, `rankSubstitutions`): this gym only, never
     * an exercise already in today's plan, flagged ones last. Each row's
     * target is the one the pick will plan and Start will create. On a
     * swapped row (`Swap again`), the planned exercise comes first with the
     * plan's own target. Reads only; never an AI call.
     */
    async swapCandidates(req: { target: OverviewTarget; gymId: string | null; typicalEquipment?: readonly EquipmentInstance[]; checkInId?: string | null; slotKey: string }): Promise<SwapSheet | null> {
      try {
        const p = await owner();
        const gymEquipment = req.gymId === null ? req.typicalEquipment : undefined;
        const gymId = req.gymId ?? 'typical-gym-preview';
        const resolved = await resolveOverview(p, req.target, { gymId, gymEquipment });
        if (resolved === null) return null;
        const sb = slotBasisOf(resolved);
        const slot = substituteSlotOf(sb, req.slotKey);
        const base = basisSlots(sb);
        const baseSlot = base.find((b) => b.slotKey === req.slotKey);
        const planned = baseSlot === undefined ? null : await exerciseById(baseSlot.exerciseId);
        if (slot === null || baseSlot === undefined || planned === null) return null;
        const { planCheckIn } = await overviewCheckIn(req.checkInId ?? null);
        const t = await todayFor(p, resolved, gymId, gymEquipment, planCheckIn);
        const resolvedEdits = resolveTodayEdits(base, t.input.edits);
        const inPlan = new Set([...base.map((b) => b.exerciseId), ...editedSlots(base, resolvedEdits).map((x) => x.exerciseId)]);
        // Candidates: Ben's exercises and the catalogue's, once each.
        const all = new Map<string, Exercise>();
        for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) if (!isArchivedExercise(e)) all.set(e.id, e);
        for (const e of ctx.catalogueExercises?.() ?? []) if (!all.has(e.id)) all.set(e.id, e);
        const subs = planned.catalogueKey ? (ctx.catalogueSubstitutions?.(planned.catalogueKey) ?? []) : [];
        const keys = new Set(subs.filter((k): k is string => k !== null));
        const pool = [...all.values()].filter((e) => (e.catalogueKey !== undefined && e.catalogueKey !== null && keys.has(e.catalogueKey)) || (planned.family !== undefined && e.family === planned.family) || e.id === planned.id);
        const histories = new Map<string, HistorySession[]>();
        for (const e of pool) histories.set(e.id, await historyFor(p.id, e.id).catch(() => [] as HistorySession[]));
        const sctx = await substituteCtx(p, gymId, gymEquipment, planCheckIn, pool.map((e) => e.id), planned.id);
        // `Swap again`: the planned exercise first, with the target the plan gives it without this swap (what Undo restores).
        let plannedRow: { targetText: string; spoken: string } | null = null;
        if (resolvedEdits.swaps.has(req.slotKey)) {
          const without = { ...t.input, edits: t.input.edits.filter((e) => !(e.kind === 'swap' && e.slotKey === req.slotKey)) };
          const run = await overviewDryRun(p, resolved, gymId, planCheckIn, gymEquipment, without);
          const row = run === null ? undefined : Object.entries(run.today?.slotOf ?? {}).find(([, key]) => key === req.slotKey)?.[0];
          const ex = run?.aggregate.exercises.find((x) => x.id === row);
          const first = run?.aggregate.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup').sort((a, b) => a.index - b.index)[0];
          if (run && ex && first) {
            const eq = ex.equipmentId === null ? null : (run.aggregate.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
            const text = swapTargetText({ equipment: eq, mapping: 'same_item', load: first.planned.load, reps: first.planned.reps, durationS: first.planned.durationS, dropped: run.fits[first.id]?.kind === 'dropped', workingSets: 0 }, planned);
            plannedRow = { targetText: text.text, spoken: text.spoken };
          }
        }
        const rows = rankSubstitutions({
          ...sctx,
          slotExercise: planned,
          slot,
          exercises: pool,
          catalogueSubstitutions: subs,
          excludeExerciseIds: inPlan,
          histories,
          planned: plannedRow,
        });
        return { slotKey: req.slotKey, plannedName: planned.name, gymName: sctx.gym.name, rows, painHeld: sctx.painCarried };
      } catch {
        return null;
      }
    },
  };

  const today = {
    async view(): Promise<TodayView | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const at = ctx.now();
      const nowMs = toMs(at.utc);
      const week = localWeekBounds(nowMs, at.tz);
      const [active, finished, recent, painFlags] = await Promise.all([
        repos().sessions.getActive(p.id),
        // An unreadable workout this week is left out rather than blocking Today (review S1).
        repos().sessions.listFinishedBetweenReadable(p.id, toIso(week.startMs), toIso(week.endMs)).then((r) => r.sessions),
        recentCheckIns(p.id, nowMs),
        // Region 4b is rare and optional: a flag read failure never blocks Today.
        repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]),
      ]);
      // Names for workouts without one (`Push`), from their exercises (audit F5).
      const titles: Record<string, string> = {};
      for (const a of [...(active ? [active] : []), ...finished]) {
        if (storedName(a) === null && a.exercises.length > 0) titles[a.session.id] = (await titleFor(liveExercises(a.exercises).map((e) => e.exerciseId))).title;
      }
      return buildTodayView({
        nowMs,
        titles,
        active,
        finishedThisWeek: finished,
        todayLocalDate: localDateOf(nowMs, at.tz),
        localDateOf: (utc) => localDateOf(toMs(utc), at.tz),
        recentCheckIns: recent.map((r) => ({ ...r, score: r.checkIn.score, reasons: r.checkIn.reasons })),
        weekDates: Array.from({ length: 7 }, (_, i) => addDays(week.mondayLocalDate, i)),
        painFlags,
        tz: at.tz,
        ...(active ? { recentPace: await recentPace(p.id, active.session.id, nowMs) } : {}),
      });
    },

    /**
     * D-Today's lift highlight: the main lift's last top set and its recent
     * trend, from logged workouts in the last 120 days. Unreadable workouts
     * are left out; never blocks Today.
     */
    async liftHighlight(): Promise<LiftHighlight | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const nowMs = toMs(ctx.now().utc);
      const { sessions } = await repos().sessions.listFinishedBetweenReadable(p.id, toIso(nowMs - 120 * 86_400_000), toIso(nowMs + 1));
      return buildLiftHighlight(sessions);
    },
  };

  /**
   * `FROM COACH` (workout-builder §4.4): open coach drafts, newest first. A
   * draft saved to Workouts stays listed until it is started (review S6:
   * the never-done `Auto` rule, §11 item 1, isn't approved). Expired drafts
   * are closed on this read (BD4).
   */
  async function coachDraftRows(p: UserProfile): Promise<CoachDraftRow[]> {
    const now = ctx.now();
    const drafts = ctx.store().repos.workoutDrafts;
    await drafts.expire(p.id, now.utc).catch(() => [] as WorkoutDraft[]);
    return (await drafts.listByOwner(p.id))
      .filter((d) => coachDraftListed(d, now.utc))
      .sort((a, b) => toMs(b.createdAt.utc) - toMs(a.createdAt.utc) || (a.id < b.id ? -1 : 1))
      .map((d) => ({
        key: `coach_draft:${d.id}`,
        label: d.name,
        kind: 'named' as const,
        target: { kind: 'coach_draft' as const, draftId: d.id },
        routineId: null,
        sourceSessionId: null,
        lastDone: null,
        exerciseCount: currentDraftVersion(d).plan.slots.length,
        recommended: false,
        edited: false,
        coachDraft: { createdAt: d.createdAt },
        draftId: d.id,
        name: d.name,
        createdAt: d.createdAt,
      }));
  }

  /** A Ben write on a coach draft (versioned, idempotent on the opId). */
  async function draftWrite(draftId: string, change: (current: WorkoutDraft) => DraftLifeChange): Promise<CoachDraftWrite> {
    try {
      const p = await owner();
      const r = await ctx.store().repos.workoutDrafts.write(p.id, draftId, change);
      switch (r.status) {
        case 'written':
        case 'replayed':
          return { ok: true, draft: r.draft, duplicate: r.status === 'replayed' };
        case 'stale':
        case 'closed':
          return { ok: false, reason: r.status, draft: r.draft };
        case 'missing':
          return { ok: false, reason: 'missing', draft: null };
        case 'invalid':
          return { ok: false, reason: 'stale', draft: null };
      }
    } catch {
      return { ok: false, reason: 'failed', draft: null };
    }
  }

  /**
   * Coach-built drafts (workout-builder §4.2, §5.3, §6.2): the card's values
   * from the stored draft, and Ben's writes (Undo a version, Discard and its
   * Undo). Local only; never an AI call. Opening, starting and saving go
   * through the overview (one page, one Start, one save).
   */
  const coachDrafts = {
    async list(): Promise<CoachDraftRow[]> {
      try {
        const p = await owner();
        return await coachDraftRows(p);
      } catch {
        return [];
      }
    },

    async get(draftId: string): Promise<WorkoutDraft | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const d = await ctx.store().repos.workoutDrafts.get(draftId).catch(() => null);
      return d !== null && d.ownerId === p.id ? d : null;
    },

    /**
     * The gym a draft was built at (Coach v3, Ben 18 Oct "in my hotel gym"; review B2): the
     * current version's gym while it is still saved and not archived, else null (the caller's
     * gym). Opening and Start plan the draft there, so loads fit that gym (rule 4) and the
     * workout is filed under it. Local read only.
     */
    async gymOf(draftId: string): Promise<string | null> {
      try {
        const p = await owner();
        const d = await coachDrafts.get(draftId);
        const version = d?.versions.find((v) => v.n === d.currentVersion) ?? d?.versions.at(-1) ?? null;
        const gymId = version?.request.gymId ?? null;
        if (gymId === null) return null;
        const g = await repos().gyms.get(gymId).catch(() => null);
        return g !== null && g.ownerId === p.id && g.archivedAtUtc === undefined ? g.id : null;
      } catch {
        return null;
      }
    },

    /**
     * The draft card (§4.2): name, counts and `≈` minutes from the stored
     * draft and the same dry run the overview shows (`estimateRemainingDuration`
     * of the fitted plan), and its end state. Null when it can't be read.
     */
    async card(req: { draftId: string; versionN: number; gymId: string | null; typicalEquipment?: readonly EquipmentInstance[] }): Promise<CoachDraftCard | null> {
      try {
        const p = await owner();
        const now = ctx.now();
        await ctx.store().repos.workoutDrafts.expire(p.id, now.utc).catch(() => [] as WorkoutDraft[]);
        const d = await coachDrafts.get(req.draftId);
        const routine = d?.routineId == null ? null : await repos().routines.get(d.routineId).catch(() => null);
        const savedName = d !== null && routine !== null && !isDeleted(routine) && draftSavedRoutineId(d, routine) !== null ? routine.name : null;
        const active = await repos().sessions.getActive(p.id).catch(() => null);
        const state = draftCardState({ draft: d, versionN: req.versionN, nowUtc: now.utc, workoutActive: active !== null, savedName });
        const version = d?.versions.find((v) => v.n === req.versionN) ?? null;
        let estimateMinutes: number | null = null;
        let exerciseCount = version?.plan.slots.length ?? 0;
        // Coach v3 (Ben 18 Oct, "in my hotel gym"): the gym the draft was built at, while it is still saved; else the caller's.
        const own = version?.request.gymId == null ? null : await repos().gyms.get(version.request.gymId).catch(() => null);
        const ownGym = own !== null && own.ownerId === p.id && own.archivedAtUtc === undefined ? own : null;
        const cardGymId = ownGym?.id ?? req.gymId;
        const gym = ownGym ?? (req.gymId === null ? null : await repos().gyms.get(req.gymId).catch(() => null));
        if (d !== null && (state.kind === 'open' || state.kind === 'after_workout')) {
          const resolved = await resolveCoachDraft(p, d.id);
          if (resolved !== null) {
            const gymId = cardGymId ?? 'typical-gym-preview';
            const typical = cardGymId === null ? req.typicalEquipment : undefined;
            const t = await todayFor(p, resolved, gymId, typical, null);
            const run = await overviewDryRun(p, resolved, gymId, null, typical, t.input);
            if (run !== null) {
              estimateMinutes = estimateRemainingDuration(run.aggregate, { pace: planPace(await recentFinished(p)) }).minutes;
              exerciseCount = new Set(run.aggregate.exercises.filter((e) => run.aggregate.sets.some((x) => x.sessionExerciseId === e.id && x.status === 'pending')).map((e) => run.today?.slotOf[e.id] ?? e.id)).size;
            }
          }
        }
        const leftOut = version === null ? 0 : leftOutCount(version.checks);
        const name = version === null ? (d?.name ?? 'Workout') : draftName(version.request.focus, version.fitMinutes);
        return { draftId: req.draftId, versionN: req.versionN, name, exerciseCount, estimateMinutes, gymName: gym?.name ?? null, leftOut, state, rationale: shownRationale(version?.rationale, version?.rationaleNumbersChecked === true) };
      } catch {
        return null;
      }
    },

    /** `Undo` on a `DraftChangeCard` (§5.3): the previous version is current again; the newer stays as `replaced`. */
    undoVersion(req: { draftId: string; versionN: number; expectedVersion: number; opId: string }): Promise<CoachDraftWrite> {
      return draftWrite(req.draftId, (c) => undoDraftVersion(c, { versionN: req.versionN, expectedVersion: req.expectedVersion, opId: req.opId, at: ctx.now() }));
    },

    /** `Discard draft` (§6.2): at once, no confirm; the toast's Undo is `restore`. */
    discard(req: { draftId: string; expectedVersion: number; opId: string }): Promise<CoachDraftWrite> {
      return draftWrite(req.draftId, (c) => discardWorkoutDraft(c, { expectedVersion: req.expectedVersion, opId: req.opId, at: ctx.now() }));
    },

    restore(req: { draftId: string; expectedVersion: number; opId: string }): Promise<CoachDraftWrite> {
      return draftWrite(req.draftId, (c) => restoreWorkoutDraft(c, { expectedVersion: req.expectedVersion, opId: req.opId, at: ctx.now() }));
    },

    /** The 14-day expiry (BD4), on launch and on read. */
    async expire(): Promise<number> {
      const p = await ctx.profile();
      if (!p) return 0;
      return (await ctx.store().repos.workoutDrafts.expire(p.id, ctx.now().utc).catch(() => [] as WorkoutDraft[])).length;
    },
  };

  /**
   * (Today v2, workout-builder-v3 §2.0) What `todaySession` reads through this service, so Today's card plans from
   * the same history, gym mapping, pain and Up next as Start (local reads only; never an AI call).
   */
  const todayPort = {
    historyFor,
    substituteCtx: (p: UserProfile, gymId: string, gymEquipment: readonly EquipmentInstance[] | undefined, exerciseIds: Iterable<string>) => substituteCtx(p, gymId, gymEquipment, null, exerciseIds),
    /** Up next's template (the applied plan's due day, with the run rule and a pin), or null. */
    async upNextRoutineId(gymId: string, gymEquipment?: readonly EquipmentInstance[]): Promise<string | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const up = await resolveUpNext(p, gymId, gymEquipment).catch(() => null);
      return up?.kind === 'routine' ? up.routine.id : null;
    },
    /**
     * (review today-fix-21oct B1) With no plan in use, what the old Today's Up next named: the same resolver (the
     * Profile split's due day, the routines in rotation, the longest gap). Its title, and its routine when it is one.
     */
    async upNext(gymId: string): Promise<{ title: string; routineId: string | null; sourceSessionId: string | null } | null> {
      const v = await next.preview(gymId).catch(() => null);
      if (v === null || (v.routine === null && v.sourceSessionId === null)) return null;
      return { title: v.title, routineId: v.routine?.id ?? null, sourceSessionId: v.routine === null ? v.sourceSessionId : null };
    },
    plannedDay: (routineId: string, gymId: string) => routines.planned(routineId, gymId),
    /** (22 Oct) A past workout's name as Up next names it (`Push`; the source's own name, else its derived title). Null: not found. */
    async sessionTitle(sessionId: string): Promise<string | null> {
      const source = await repos().sessions.get(sessionId).catch(() => null);
      if (!source) return null;
      return upNextName(source) ?? (await titleFor(liveExercises(source.exercises).map((e) => e.exerciseId))).title;
    },
    /** The plan day Up next would name after `routineId` is done today (a prediction; saves nothing). */
    async nextAfter(gymId: string, routineId: string): Promise<string | null> {
      const r = await next.planAhead(gymId, routineId, 1).catch(() => null);
      return r?.days[0]?.routineId ?? null;
    },
  };

  /**
   * (Review B1, retire-workout-overview) What Your workout opens a library workout or a past workout with: the
   * overview's own dry run (the routine's next targets with its own rule, Fixed loads, set types and reps, or last
   * time's next session), fitted to this gym's items (rule 4; the typical gym's when there is none). Saves nothing;
   * never an AI call. Null: the workout is gone or has nothing to plan.
   */
  const builderSources = {
    async planned(req: { target: { kind: 'routine'; routineId: string } | { kind: 'session'; sourceSessionId: string }; gymId: string | null; typicalEquipment?: readonly EquipmentInstance[] }): Promise<SessionAggregate | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const resolved = req.target.kind === 'routine' ? await resolveRoutine(p, req.target.routineId, null).catch(() => null) : await resolveNext(p, req.target.sourceSessionId).catch(() => null);
      if (resolved === null) return null;
      const run = await overviewDryRun(p, resolved, req.gymId ?? 'typical-gym-preview', null, req.gymId === null ? req.typicalEquipment : undefined).catch(() => null);
      return run?.aggregate ?? null;
    },
  };

  return { checkIns, pain, workout, today, repeat, next, routines, gymSwitch, overview, sessionTypes, coachDrafts, todayPort, builderSources };
}

export type WorkoutServices = ReturnType<typeof createWorkoutServices>;

/**
 * (WU1–WU12) The warm-up planner's facts for the active workout's views (catalogue facts by exercise ID and the
 * workout's main lifts), so warm-ups filled at display are planned as Start plans them.
 */
function warmupInputOf(data: Pick<ActiveWorkoutData, 'builderInfo' | 'mainExerciseIds'>): { warmupFacts?: Record<string, WarmupExerciseFacts | null>; mainExerciseIds?: ReadonlySet<string> } {
  const info = data.builderInfo;
  return {
    ...(info === undefined ? {} : { warmupFacts: Object.fromEntries(Object.entries(info).map(([id, i]) => [id, i?.warmup ?? null])) }),
    ...(data.mainExerciseIds === undefined ? {} : { mainExerciseIds: data.mainExerciseIds }),
  };
}

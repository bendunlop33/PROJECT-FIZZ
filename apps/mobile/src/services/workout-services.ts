import {
  addDays,
  liveExercises,
  buildSwapExerciseCommand,
  midSwapSlot,
  swapPainCarry,
  applyCheckInPatch,
  buildActiveSetView,
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
  equipmentForExercise,
  searchExercises,
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
  nextInRotation,
  nextTargetSourceBasis,
  renameRoutine,
  restoreRoutine,
  routineCounts,
  routineFromSession,
  routineLastDone,
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
  editCountOf,
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
  recentPaceSamples,
  timeLeftSheet,
  type ActiveSetView,
  type SetRecord,
  type SetRecordInput,
  type CheckInGate,
  type CheckInPatch,
  type CommandOutcome,
  type DraftEdits,
  type GymSwitchProposal,
  type HistorySession,
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
  SESSION_PICKER_DECISIONS,
  type SessionType,
  type SessionTypeKind,
  type NotCopied,
} from '@fizz/domain';
import type { SqliteRepositories, Store } from '@fizz/persistence';
import type {
  ActionRecord,
  DraftBasis,
  PreStartDraft,
  CheckIn,
  CheckInScore,
  EquipmentInstance,
  Gym,
  Exercise,
  NextSessionTargetRecord,
  PainArea,
  PainFlag,
  PlannedSet,
  ProgressionRule,
  Routine,
  SessionAggregate,
  SessionCheckIn,
  SessionCommand,
  SetExclusion,
  SetType,
  SetValues,
  UserProfile,
  ZonedTimestamp,
} from '@fizz/schemas';

import { undoOpId, undoRefusalText } from '../workout/undo-op';

/**
 * Services for the workout loop (Today → check-in → Active set → Rest →
 * Summary). In-process, local, no AI and no network. Screens call these; the
 * rules live in `@fizz/domain`. Every write is idempotent by an operation ID
 * chosen by the screen once per intent, and versioned where it edits.
 */

export interface WorkoutServicesContext {
  repos: () => SqliteRepositories;
  store: () => Store;
  now: () => ZonedTimestamp;
  newId: () => string;
  profile: () => Promise<UserProfile | null>;
  /** Runs after every committed session command (backups, alerts). Never awaited by the caller's write. */
  afterCommand: (outcome: CommandOutcome) => CommandOutcome;
  /** The bundled catalogue as exercise rows (read on first use). Absent: the picker shows the database only. */
  catalogueExercises?: () => readonly Exercise[];
  /** A catalogue entry's substitutions (`variations.substitutions[].key`), in catalogue order (Coaching knowledge). Absent: none. */
  catalogueSubstitutions?: (catalogueKey: string) => readonly (string | null)[];
}

export type CheckInWrite = { ok: true; checkIn: CheckIn; duplicate: boolean } | { ok: false; message: string; stale?: boolean };

/** What the exercise picker offers: rep, timed (active-workout §2.7) and distance exercises (ADR 0011). */
export const PICKER_MEASUREMENTS: ReadonlySet<Exercise['measurement']> = new Set(['reps', 'duration', 'distance']);

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
  | { ok: false; error: { code: 'stale_preview'; message: string } };
/** How far back to look for Ben's last 5 finished workouts (pace for `Time left`). Older ones fall back to `Default`. */
const RECENT_PACE_WINDOW_MS = 90 * 86_400_000;

export interface PickerExercise {
  exercise: Exercise;
  /** Compatible equipment at this workout's gym. Empty = none needed (bodyweight) or none there (loads not checked). */
  equipment: Pick<EquipmentInstance, 'id' | 'name' | 'kind'>[];
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
  title: string;
  startedAtUtc: string;
  tz: string;
  gymId: string | null;
  gymName: string;
  exerciseNames: string[];
  sets: number;
}

/**
 * Past workouts for Repeat; `unreadable` counts records skipped because they
 * failed to decode. Imported (FitNotes) workouts are never candidates while
 * P-I3 is open (review r2 B1); `importedNotListed` says how many were left out.
 */
export interface RepeatCandidates {
  rows: RepeatCandidate[];
  unreadable: number;
  importedNotListed: number;
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
}

/**
 * Today's main card (audit B2): the next session, built from the last
 * workout with the built-in rule's next targets (labelled), at this gym.
 */
export interface NextSessionPreview {
  /**
   * Up next is a routine (premium-feel §2.6, rotation D19): Start starts it.
   * Null: the last workout's next session (Start uses `sourceSessionId`).
   */
  routine: { id: string; basis: { kind: 'after'; routineName: string; atUtc: string; tz: string } | { kind: 'only' } } | null;
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
export type OverviewTarget = { kind: 'next' } | { kind: 'routine'; routineId: string } | { kind: 'session'; sourceSessionId: string };

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
}

/** `services.sessions.list` (session-picker §7). `current`: Up next first, longest gap first, then `New`; `older`: `OLDER`. */
export interface SessionList {
  current: SessionPickerRow[];
  older: SessionPickerRow[];
  recommendedKey: string | null;
}

/** What a Start from the overview starts: the routine, or the last workout's next session. */
export type OverviewStartOf = { routineOf: string; nextOf?: undefined } | { nextOf: string; routineOf?: undefined };

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
  checkIn: { kind: 'ask' } | { kind: 'reuse'; checkIn: CheckIn } | { kind: 'skip'; reason: 'off' | 'not_a_check_in_day' | 'already_decided' | 'set_logged' };
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
}

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
}

/** The overview's key check (§7): a retry of a Start that landed, out of date, or fresh with what to re-check in the write. */
export type PreviewCheck = { kind: 'duplicate' } | { kind: 'stale' } | { kind: 'fresh'; fence: WriteFence };

export function createWorkoutServices(ctx: WorkoutServicesContext) {
  const repos = () => ctx.repos();
  const domain = () => createSessionService(repos(), ctx.newId);

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

  const checkIns = {
    /** `shouldAskCheckIn` for a Start (check-in.md §2.1). Defaults are used until the settings screen exists. */
    async gate(): Promise<CheckInGate> {
      const p = await owner();
      const at = ctx.now();
      const nowMs = toMs(at.utc);
      return shouldAskCheckIn({ settings: DEFAULT_CHECK_IN_SETTINGS, nowMs, weekday: weekdayOf(nowMs, at.tz), entry: 'start', recent: await recentCheckIns(p.id, nowMs) });
    },

    get: (id: string): Promise<CheckIn | null> => repos().checkIns.get(id),

    /** Written at the first score tap (CI4). `checkInId` is chosen once per sheet, so a retry is a duplicate. */
    async record(req: { checkInId: string; opId: string; score: CheckInScore }): Promise<CheckInWrite> {
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
      const gate = shouldAskCheckIn({ settings: DEFAULT_CHECK_IN_SETTINGS, nowMs, weekday: weekdayOf(nowMs, ctx.now().tz), entry: 'start', recent: await recentCheckIns(p.id, nowMs) });
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

  async function gymNamesOf(ownerId: string): Promise<Record<string, string>> {
    return Object.fromEntries((await repos().gyms.listByOwner(ownerId).catch(() => [])).map((g) => [g.id, g.name]));
  }

  /** The substitutes today's swaps plan with (their own GS3 step 2 at this gym). */
  function swapExerciseIds(today: TodayEditsInput | undefined): string[] {
    return today === undefined ? [] : [...today.swaps.values()].map((sp) => sp.exercise.id);
  }

  /** GS3 step 2 for each exercise: the item it last used at `gymId`. History that can't be read is skipped. */
  async function lastUsedFor(ownerId: string, exerciseIds: Iterable<string>, gymId: string): Promise<(exerciseId: string) => string | null> {
    const map = new Map<string, string | null>();
    for (const exerciseId of new Set(exerciseIds)) {
      map.set(exerciseId, lastUsedAtGym(await historyFor(ownerId, exerciseId).catch(() => [] as HistorySession[]), gymId));
    }
    return (exerciseId) => map.get(exerciseId) ?? null;
  }

  /** The check-in on a workout, for "pain mentioned, no movement chosen" (PM SP3). */
  async function sessionCheckIn(a: SessionAggregate | null): Promise<CheckIn | null> {
    return a?.session.checkIn?.kind === 'answered' ? repos().checkIns.get(a.session.checkIn.checkInId) : null;
  }

  async function planFor(p: UserProfile, req: { sessionId: string; exerciseId: string; equipmentId: string | null }): Promise<{ setType: SetType; planned: PlannedSet }[] | null> {
    const [aggregate, exercise] = await Promise.all([repos().sessions.get(req.sessionId), repos().exercises.get(req.exerciseId)]);
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
      workingSets: previous.sets.filter((s) => s.values.reps !== null).length,
      history,
      painFlags: await repos().painFlags.listActive(p.id),
      sessionPain: now.active ? now : then,
    });
    // Each planned set records what produced it, for `Why?` (active-workout §2.12, AW3).
    return plannedSetsFromTargets(result, { history, equipment, at: ctx.now() }) ?? defaultStartingPlan(exercise, equipment?.kind ?? null, convention, Math.max(1, previous.sets.length), { at: ctx.now(), decision: result.decision });
  }

  /**
   * Next targets for every exercise of a finished workout, on the equipment
   * it was done with (the gym check happens when the workout is built).
   * Exercises the rule can't plan are left out, so they repeat as last time.
   * `today`: the check-in answered for the workout being started; pain
   * mentioned there holds every load, like `planFor` (rule 9; review B2).
   */
  async function nextTargetsOf(p: UserProfile, source: SessionAggregate, today: CheckIn | null = null): Promise<Map<string, { setType: SetType; planned: PlannedSet }[]>> {
    const builtIn = await builtInNextTargetsOf(p, source, today);
    // D21: the coach's saved next-session targets win where they are still valid; the built-in rule is the fallback.
    const rows = await ctx.store().repos.coach.listNextTargets(p.id, source.session.id).catch(() => []);
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

  /** The built-in rule's next targets only (playbook 7-F): the comparison and the fallback for the coach's. */
  async function builtInNextTargetsOf(p: UserProfile, source: SessionAggregate, today: CheckIn | null = null): Promise<Map<string, { setType: SetType; planned: PlannedSet }[]>> {
    const out = new Map<string, { setType: SetType; planned: PlannedSet }[]>();
    const flags = await repos().painFlags.listActive(p.id);
    const now = unspecifiedPain(today);
    const sessionPain = now.active ? now : unspecifiedPain(await sessionCheckIn(source));
    // One entry per exercise block: a split exercise reads its deciding part with the
    // block's set count, the same as the Summary's `Next time` (review r2 B1).
    for (const block of nextTargetBlocks(source)) {
      const sx = block.decider;
      if (out.has(sx.exerciseId) || sx.measurement !== 'reps') continue;
      const exercise = await repos().exercises.get(sx.exerciseId);
      // The reason line isn't shown at Start (the Summary shows it), so no gym name is needed.
      const history = await historyFor(p.id, sx.exerciseId);
      const { result } = nextTargetsForBlock(
        block,
        { ownerId: p.id, sessionId: source.session.id, count: 'done', exercise, rule: null, history, painFlags: flags, sessionPain },
        null,
      );
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
  const storedName = (a: SessionAggregate): string | null => storedWorkoutName(a.session);

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
      return { id: r.id, name: r.name, version: r.version, exercises: c.exercises, sets: c.sets, lastDone: done ? { atUtc: done.startedAtUtc, tz: done.tz } : null, createdFromSessionId: r.createdFromSessionId ?? null };
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
    const targets = source ? await nextTargetsOf(p, source, req.today ?? null).catch(() => null) : null;
    // Swapped slots' substitutes too, so the dry run, the Swap sheet and Start map the same item (GS3 step 2, review S3).
    const lastUsedHere = routine ? await lastUsedFor(p.id, [...routine.exercises.map((e) => e.exerciseId), ...swapExerciseIds(req.todayEdits)], req.gymId) : undefined;
    if (req.noteSource === true && ref !== null && !req.preview) await noteStartFrom(p.id, ref.sessionId, req.opId);
    const service = req.newId ? createSessionService(repos(), req.newId) : domain();
    const r = await service.startRoutine({
      ownerId: p.id,
      gymId: req.gymId,
      routineId: req.routineId,
      opId: req.opId,
      at: ctx.now(),
      preview: req.preview,
      ...(req.checkIn !== undefined ? { checkIn: req.checkIn } : {}),
      ...(targets && targets.size > 0 ? { targets } : {}),
      ...(req.gymEquipment ? { gymEquipment: req.gymEquipment } : {}),
      ...(req.fence ? { fence: req.fence } : {}),
      ...(lastUsedHere ? { lastUsedHere } : {}),
      ...(req.todayEdits ? { today: req.todayEdits } : {}),
    });
    return { r, ref, source, routine, targeted: targets !== null && targets.size > 0, targetsFailed: source !== null && targets === null };
  }

  /** Save one routine change; a conflict re-reads once so a retry after a lost acknowledgement reads as done. */
  async function writeRoutine(routineId: string, make: (current: Routine) => RoutineChange): Promise<RoutineWrite> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await repos().routines.get(routineId);
      const p = await ctx.profile();
      if (!current || !p || current.ownerId !== p.id) return { ok: false, message: 'That routine wasn’t found.' };
      const c = make(current);
      if (c.kind === 'duplicate') return { ok: true, routine: c.current, duplicate: true };
      if (c.kind === 'stale') return { ok: false, message: 'The routine changed. Check it and try again.', stale: true };
      if (c.kind === 'invalid') return { ok: false, message: c.message };
      const saved = await repos().routines.save(c.next, c.expectedVersion).catch(() => null);
      if (saved?.ok) return { ok: true, routine: c.next, duplicate: false };
      if (saved === null) return { ok: false, message: 'Couldn’t save the routine. Try again.' };
    }
    return { ok: false, message: 'The routine changed. Check it and try again.', stale: true };
  }

  /** IDs for a preview: the same inputs give the same IDs, so `Why?` can find a set from an earlier read. */
  const previewIds = (): (() => string) => {
    let n = 0;
    return () => deriveId(`overview-preview:${String((n += 1))}`);
  };

  /** What an overview previews, resolved: a routine (and its last workout), or the last workout's next session. */
  type ResolvedOverview =
    | { kind: 'routine'; routine: Routine; ref: FinishedRef | null; basis: OverviewBasis }
    | { kind: 'next'; source: SessionAggregate; basis: OverviewBasis };

  async function resolveRoutine(p: UserProfile, routineId: string, basis: OverviewBasis | null): Promise<ResolvedOverview | null> {
    const routine = await repos().routines.get(routineId);
    if (!routine || routine.ownerId !== p.id || (routine.deletedAtUtc !== undefined && routine.deletedAtUtc !== null)) return null;
    const ref = (await finishedRefs(p.id)).find((f) => isFromRoutine(f, routine)) ?? null;
    return { kind: 'routine', routine, ref, basis: basis ?? (ref ? { kind: 'last_done', at: { utc: ref.startedAtUtc, tz: ref.tz } } : { kind: 'new_routine' }) };
  }

  async function resolveNext(p: UserProfile, sourceSessionId: string): Promise<ResolvedOverview | null> {
    const source = await repos().sessions.get(sourceSessionId);
    if (!source || source.session.ownerId !== p.id || source.session.status !== 'finished' || source.session.source === 'import') return null;
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
    const pick = nextInRotation(live, refs[0] ?? null);
    if (pick.kind === 'routine') {
      const run = await routineStart(p, { routineId: pick.routine.id, gymId, opId: `preview-next-routine:${pick.routine.id}`, preview: true, ...(gymEquipment ? { gymEquipment } : {}) });
      if (run.r.ok) return { kind: 'routine' as const, routine: pick.routine, basis: pick.basis, run: { ...run, r: run.r } };
    }
    const last = (await repeat.candidates(1, { countImported: false })).rows[0];
    return last ? { kind: 'next' as const, sessionId: last.sessionId } : null;
  }

  /** Up next (as Today's card, at this gym) or the routine asked for. */
  async function resolveOverview(p: UserProfile, target: OverviewTarget | OverviewStartOf, gym?: { gymId: string; gymEquipment?: readonly EquipmentInstance[] | undefined }): Promise<ResolvedOverview | null> {
    if ('kind' in target) {
      if (target.kind === 'routine') return resolveRoutine(p, target.routineId, null);
      if (target.kind === 'session') {
        // A picked session type (session-picker §2.3): `Last done Wed 7 Oct`. Start, drafts and the key are the `nextOf` ones.
        const picked = await resolveNext(p, target.sourceSessionId);
        return picked === null || picked.kind !== 'next' ? picked : { ...picked, basis: { kind: 'last_done', at: picked.source.session.startedAt } };
      }
      const up = await resolveUpNext(p, gym?.gymId ?? 'typical-gym-preview', gym?.gymEquipment);
      if (up === null) return null;
      if (up.kind === 'next') return resolveNext(p, up.sessionId);
      const basis: OverviewBasis = up.basis.kind === 'only' ? { kind: 'only' } : { kind: 'after', routineName: up.basis.routineName, at: { utc: up.basis.atUtc, tz: up.basis.tz } };
      return resolveRoutine(p, up.routine.id, basis);
    }
    if (target.routineOf !== undefined) return resolveRoutine(p, target.routineOf, null);
    return resolveNext(p, target.nextOf);
  }

  /** The finished workout an overview's targets come from: the next session's source, or the routine's last workout. */
  async function overviewSource(resolved: ResolvedOverview): Promise<SessionAggregate | null> {
    if (resolved.kind === 'next') return resolved.source;
    return resolved.ref === null ? null : repos().sessions.get(resolved.ref.sessionId).catch(() => null);
  }

  /** The coach's stored next-session targets from a finished workout (D21), as saved. A read only; never calls the coach. */
  async function storedCoachTargets(ownerId: string, source: SessionAggregate | null): Promise<NextSessionTargetRecord[]> {
    if (source === null) return [];
    return ctx.store().repos.coach.listNextTargets(ownerId, source.session.id);
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
  const basisOf = (resolved: ResolvedOverview): DraftBasis => (resolved.kind === 'routine' ? { kind: 'routine', routineId: resolved.routine.id } : { kind: 'next', sourceSessionId: resolved.source.session.id });
  const slotBasisOf = (resolved: ResolvedOverview) => (resolved.kind === 'routine' ? { kind: 'routine' as const, routine: resolved.routine } : { kind: 'next' as const, source: resolved.source });

  /** The open draft for a basis; one past its local midnight reads as none (TE5). Reads only. */
  async function liveDraft(ownerId: string, basis: DraftBasis): Promise<PreStartDraft | null> {
    const d = await ctx.store().repos.drafts.open(ownerId, basis);
    return d !== null && draftIsLive(d, ctx.now().utc) ? d : null;
  }

  /** An exercise by ID: Ben's list first, then the bundled catalogue's row (Coaching knowledge). */
  async function exerciseById(exerciseId: string): Promise<Exercise | null> {
    return (await repos().exercises.get(exerciseId).catch(() => null)) ?? ctx.catalogueExercises?.().find((e) => e.id === exerciseId) ?? null;
  }

  /** A picked catalogue exercise is saved as a row before a workout can use it (as `Add exercise` does). */
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
    const draft = await liveDraft(p.id, basisOf(resolved));
    if (draft === null) return { draft: null, input: NO_TODAY };
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
    return { draft, input: { draft: { id: draft.id, version: draft.version }, edits, swaps } };
  }

  /** The overview's view of today's edits (§6.2): slot keys, today's order, what each applied edit did. */
  async function overviewToday(resolved: ResolvedOverview, info: TodayPlanInfo | null, draft: PreStartDraft | null): Promise<OverviewToday | null> {
    if (info === null) return null;
    const swapped = new Map<string, { editId: string; fromExerciseId: string; fromName: string }>();
    for (const [slotKey, sw] of info.resolved.swaps) {
      const base = info.baseSlots.find((b) => b.slotKey === slotKey);
      if (base === undefined) continue;
      const fromName = resolved.kind === 'next' ? resolved.source.exercises.find((x) => x.id === slotKey)?.exerciseName : (await exerciseById(base.exerciseId))?.name;
      swapped.set(slotKey, { editId: sw.editId, fromExerciseId: base.exerciseId, fromName: fromName ?? 'Exercise' });
    }
    return {
      slotOf: info.slotOf,
      slots: info.slots,
      swapped,
      skipped: info.resolved.skipped,
      editCount: editCountOf(info.resolved),
      draft: draft === null ? null : { id: draft.id, version: draft.version },
      routineName: resolved.kind === 'routine' ? resolved.routine.name : null,
    };
  }

  /** `previewKey` inputs as stored now (workout-overview §7). `gymId` null: the typical gym Start will save. */
  async function previewKeyParts(p: UserProfile, resolved: ResolvedOverview, gymId: string | null, checkIn: CheckIn | null, draft: PreStartDraft | null = null): Promise<PreviewKeyParts> {
    const equipment = gymId === null ? null : await repos().equipment.listByGym(gymId);
    const source = await overviewSource(resolved);
    const flags = await repos().painFlags.listActive(p.id);
    const coachRows = await storedCoachTargets(p.id, source);
    return {
      target: resolved.kind === 'routine' ? { kind: 'routine', routineId: resolved.routine.id } : { kind: 'next', sourceSessionId: resolved.source.session.id },
      routine: resolved.kind === 'routine' ? { id: resolved.routine.id, version: resolved.routine.version } : null,
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
  ): Promise<{ aggregate: SessionAggregate; fits: Record<string, SetFit>; today: TodayPlanInfo | null } | null> {
    const newId = previewIds();
    if (resolved.kind === 'routine') {
      const { r } = await routineStart(p, { routineId: resolved.routine.id, gymId, opId: 'overview-preview', preview: true, today, newId, todayEdits, ...(gymEquipment ? { gymEquipment } : {}) });
      return r.ok ? { aggregate: r.aggregate, fits: r.fits, today: r.today } : null;
    }
    const targets = await nextTargetsOf(p, resolved.source, today).catch(() => null);
    // The same history mapping Start uses, so the preview is what Start creates (gym-switch GS3).
    const lastUsedHere = await lastUsedFor(p.id, [...resolved.source.exercises.map((e) => e.exerciseId), ...swapExerciseIds(todayEdits)], gymId);
    const r = await createSessionService(repos(), newId).startFromSession({
      ownerId: p.id,
      gymId,
      routineId: null,
      opId: 'overview-preview',
      at: ctx.now(),
      sourceSessionId: resolved.source.session.id,
      preview: true,
      targets: targets ?? new Map(),
      name: storedName(resolved.source) ?? GENERIC_WORKOUT_NAME,
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
     * The built-in rule's next targets for a finished workout (the summary
     * turn's comparison and fallback, D21). Never the coach's own.
     */
    async builtInNextTargets(sessionId: string): Promise<Map<string, { setType: SetType; planned: PlannedSet }[]> | null> {
      const p = await ctx.profile();
      const source = await repos().sessions.get(sessionId);
      if (!p || !source) return null;
      return builtInNextTargetsOf(p, source, null).catch(() => null);
    },

    /**
     * `startWorkout(…, opts.checkIn)` for an empty workout (no routines yet).
     * A gym is required (PM SP1). An answered check-in is linked in the same
     * write as the session; one already linked to another workout is refused.
     */
    async start(req: WorkoutStartRequest): Promise<WorkoutStartOutcome> {
      const r = await workout.startOnce(req);
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
      if (req.expectedPreviewKey !== undefined && (req.routineOf || req.nextOf)) {
        const check = await workout.previewCheck(p, {
          startOf: req.routineOf ? { routineOf: req.routineOf } : { nextOf: req.nextOf ?? '' },
          gymId: req.gymId,
          opId: req.opId,
          checkIn: req.checkIn,
          expectedPreviewKey: req.expectedPreviewKey,
        });
        if (check.kind === 'stale') return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
        if (check.kind === 'fresh') fence = check.fence;
      }
      let checkIn = req.checkIn;
      if (checkIn?.kind === 'answered') {
        const already = await repos().sessions.findByStartOperation(p.id, req.opId);
        const linked = await repos().checkIns.linkedIds([checkIn.checkInId]);
        // Linked to another workout (not this start's retry): start without it rather than block.
        if (linked.has(checkIn.checkInId) && already?.session.checkIn?.kind !== 'answered') checkIn = { kind: 'skipped', atUtc: ctx.now().utc };
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
          name: storedName(source) ?? GENERIC_WORKOUT_NAME,
          lastUsedHere,
          today: t.input,
          ...(fenced ? { fence: fenced } : {}),
        });
        if (!r.ok) {
          const e = r.error;
          if (e.code === 'nothing_to_repeat' || e.code === 'imported_not_repeatable') return { ok: false, error: { code: 'not_found', message: e.message } };
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
          if (e.code === 'nothing_to_repeat' || e.code === 'imported_not_repeatable') return { ok: false, error: { code: 'not_found', message: e.message } };
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
      const ci = aggregate.session.checkIn?.kind === 'answered' ? await repos().checkIns.get(aggregate.session.checkIn.checkInId) : null;
      const title = storedName(aggregate) === null && aggregate.exercises.length > 0 ? (await titleFor(liveExercises(aggregate.exercises).map((e) => e.exerciseId))).title : null;
      const pace = await recentPace(p.id, aggregate.session.id, toMs(ctx.now().utc));
      return {
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
      return buildActiveSetView({ aggregate: data.aggregate, nowMs, gymName: data.gymName, gymNames: data.gymNames, previous: data.previous, painFlagged: data.painFlagged, painFlags: data.painFlags, edits, title: data.title, withTimeLeft: false });
    },

    /**
     * `TimeLeftLine` and the `Time left` sheet (§2.15). The screen calls this
     * with a clock that moves only on events and once a minute, so the line
     * never ticks like a countdown.
     */
    timeLeft(data: ActiveWorkoutData, nowMs: number): { view: TimeLeftView; sheet: TimeLeftSheetView } | null {
      const view = buildTimeLeftView(data.aggregate, nowMs, data.recentPace);
      return view === null ? null : { view, sheet: timeLeftSheet(view.estimate, data.aggregate, nowMs, data.aggregate.session.startedAt.tz) };
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
      patch: Partial<SetValues> & { exclusions?: SetExclusion[]; setType?: SetType };
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
    async addSet(req: { sessionId: string; sessionExerciseId: string; opId: string; newSetId: string }): Promise<CommandOutcome> {
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
      const cmd: SessionCommand = { type: 'add_set', at: ctx.now(), opId: req.opId, sessionExerciseId: req.sessionExerciseId, newSetId: req.newSetId, setType: null, ...(continuation ? { continuation } : {}) };
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
      const saved = (await repos().exercises.list()).filter((e) => PICKER_MEASUREMENTS.has(e.measurement) && (e.ownerId === null || e.ownerId === p?.id));
      const have = new Set(saved.map((e) => e.id));
      const extra = opts.withCatalogue && ctx.catalogueExercises ? ctx.catalogueExercises().filter((e) => !have.has(e.id) && PICKER_MEASUREMENTS.has(e.measurement)) : [];
      const all = [...saved, ...extra];
      // Only the current gym's items, also after a switch (gym-switch §4.3).
      const snapshot = aggregate ? currentGymEquipment(aggregate.session) : [];
      // A flag that can't be read never hides or blocks a row: it just isn't tagged.
      const flags = p ? await repos().painFlags.listActive(p.id).catch(() => [] as PainFlag[]) : [];
      const at = ctx.now();
      const nowMs = toMs(at.utc);
      // Bodyweight exercises never need (or get) a gym item: there's no load to check.
      return searchExercises(all, query).map((exercise) => {
        const covering = painFlagCovering(flags, exercise.id, nowMs, at.tz);
        return {
          exercise,
          equipment: equipmentForExercise(exercise, snapshot).map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
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
    async addExercise(req: { sessionId: string; exerciseId: string; equipmentId: string | null; opId: string }): Promise<CommandOutcome> {
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
      const plan = await planFor(p, req).catch(() => null);
      return ctx.afterCommand(
        await domain().addExercise(req.sessionId, {
          ownerId: p.id,
          exerciseId: req.exerciseId,
          equipmentId: req.equipmentId,
          opId: req.opId,
          at: ctx.now(),
          plan,
          exerciseRestS: p.exerciseRestS?.[req.exerciseId] ?? null,
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
        for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) all.set(e.id, e);
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
    async swapExercise(req: { sessionId: string; sessionExerciseId: string; exerciseId: string; opId: string }): Promise<CommandOutcome & { fromName?: string; toName?: string }> {
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
      const plan = substituteTargets(slot, exercise, history, sctx);
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
        const [basisNow, gyms, flags, history] = await Promise.all([
          basisId === null ? null : repos().sessions.get(basisId).catch(() => null),
          repos().gyms.listByOwner(p.id).catch(() => []),
          repos().painFlags.listByOwner(p.id).catch(() => [] as PainFlag[]),
          historyFor(p.id, ex.exerciseId).catch(() => [] as HistorySession[]),
        ]);
        return explainTarget({
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
      const summary = buildWorkoutSummary({
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
     * Imported (FitNotes) workouts are left out and counted: their loads
     * were never checked on any equipment, and P-I3 is open (review r2 B1).
     */
    async candidates(limit = 30, opts: { countImported?: boolean } = {}): Promise<RepeatCandidates> {
      const p = await ctx.profile();
      if (!p) return { rows: [], unreadable: 0, importedNotListed: 0 };
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
          if (!a || a.session.source === 'import') continue;
          const done = a.sets.filter((s) => s.status === 'completed' && s.pairedWithSetId === null);
          if (done.length === 0) continue;
          const gymId = a.session.gymId;
          // A workout that switched gym is listed as `Main Gym → Hotel · Lisbon` (gym-switch check 24).
          const route = gymRouteIds(a.session);
          for (const g of route) if (!gyms.has(g)) gyms.set(g, (await repos().gyms.get(g).catch(() => null))?.name ?? 'Gym');
          // An exercise done at two gyms is listed once (review B1).
          const names = doneExerciseNames(a);
          rows.push({
            sessionId: a.session.id,
            title: storedName(a) ?? (await titleFor(liveExercises(a.exercises).map((e) => e.exerciseId)).catch(() => ({ title: 'Workout' }))).title,
            startedAtUtc: a.session.startedAt.utc,
            tz: a.session.startedAt.tz,
            gymId,
            gymName: route.length === 0 ? 'Gym not recorded' : route.map((g) => gyms.get(g) ?? 'Gym').join(' → '),
            exerciseNames: names,
            sets: done.length,
          });
        }
      }
      // Only `Start from a past workout` shows this count; Today's row doesn't read it (review r3 N4).
      const importedNotListed = opts.countImported === false ? 0 : await repos().sessions.countImportedFinished(p.id).catch(() => 0);
      return { rows, unreadable, importedNotListed };
    },

    /** Today's `Repeat last workout` row: the newest readable candidate, or null. Never throws (review S1). */
    async last(): Promise<RepeatCandidate | null> {
      try {
        return (await repeat.candidates(1, { countImported: false })).rows[0] ?? null;
      } catch {
        return null;
      }
    },

    /** The Repeat screen (routines.md §2.4): what the new workout would plan at this gym. Saves nothing. */
    async preview(sourceSessionId: string, gymId: string): Promise<RepeatPreview | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const source = await repos().sessions.get(sourceSessionId);
      if (!source) return null;
      const lastUsedHere = await lastUsedFor(p.id, source.exercises.map((e) => e.exerciseId), gymId);
      const r = await domain().startFromSession({ ownerId: p.id, gymId, routineId: null, opId: `preview:${sourceSessionId}`, at: ctx.now(), sourceSessionId, preview: true, lastUsedHere });
      if (!r.ok) return null;
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
     * `Save as routine` from a finished workout. Idempotent by `opId`: the
     * routine's ID is derived from it, so a double tap or a retry after a lost
     * acknowledgement saves one routine. The workout is never changed.
     */
    async saveFromSession(req: { sessionId: string; name: string; opId: string }): Promise<RoutineWrite> {
      const p = await ctx.profile();
      if (!p) return { ok: false, message: 'Owner profile not found.' };
      const id = deriveId(`routine:${req.opId}`);
      const existing = await repos().routines.get(id);
      if (existing) return existing.lastOpId === req.opId || existing.createdFromSessionId === req.sessionId ? { ok: true, routine: existing, duplicate: true } : { ok: false, message: 'Couldn’t save the routine. Try again.' };
      const name = checkRoutineName(req.name, []);
      if (!name.ok) return { ok: false, message: name.message };
      const source = await repos().sessions.get(req.sessionId).catch(() => null);
      if (!source || source.session.ownerId !== p.id) return { ok: false, message: 'That workout wasn’t found.' };
      const routine = routineFromSession({ id, ownerId: p.id, name: name.name, opId: req.opId, source, at: ctx.now(), newId: ctx.newId });
      if (!routine) return { ok: false, message: source.session.source === 'import' ? 'Workouts imported from FitNotes can’t be saved as routines yet.' : 'This workout has no logged sets to save.' };
      const saved = await repos().routines.save(routine, null).catch(() => null);
      if (saved?.ok) return { ok: true, routine, duplicate: false };
      // The write may have landed before an error: read it back.
      const again = await repos().routines.get(id).catch(() => null);
      return again?.lastOpId === req.opId ? { ok: true, routine: again, duplicate: true } : { ok: false, message: 'Couldn’t save the routine. Try again.' };
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
        if (!current || current.ownerId !== p.id || to === null) return { ok: false, reason: 'missing', message: 'That routine wasn’t found.' };
        const at = ctx.now();
        const c = swapRoutineSlot(current, req.slotKey, to, req.expectedRoutineVersion, req.opId, at);
        if (c.kind === 'invalid') return { ok: false, reason: 'invalid', message: c.message };
        if (c.kind === 'stale') return { ok: false, reason: 'stale', message: 'The routine changed. Check it and try again.' };
        const before = current.exercises.find((e) => e.id === req.slotKey);
        const next = c.kind === 'write' ? c.next : c.current;
        const after = next.exercises.find((e) => e.id === req.slotKey);
        if (before === undefined || after === undefined) return { ok: false, reason: 'invalid', message: 'That exercise isn’t in the routine any more.' };
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
        if (r.status === 'missing') return { ok: false, reason: 'missing', message: 'That routine wasn’t found.' };
        if (r.status === 'stale') return { ok: false, reason: 'stale', message: 'The routine changed. Check it and try again.' };
        return { ok: true, action: r.action, routine: r.routine, duplicate: r.status === 'replayed' };
      } catch {
        return { ok: false, reason: 'failed', message: 'Couldn’t save the routine. Try again.' };
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
        return { ok: false, reason: 'failed', message: 'Couldn’t save the routine. Try again.' };
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
  };

  const next = {
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
          };
        }
        const last = { sessionId: up.sessionId };
        const source = await repos().sessions.get(last.sessionId);
        if (!source) return null;
        const targets = await nextTargetsOf(p, source);
        const t = await todayFor(p, { kind: 'next', source, basis: { kind: 'next_from', at: source.session.startedAt } }, gymId, undefined, null);
        const lastUsedHere = await lastUsedFor(p.id, [...source.exercises.map((e) => e.exerciseId), ...swapExerciseIds(t.input)], gymId);
        const r = await domain().startFromSession({ ownerId: p.id, gymId, routineId: null, opId: `preview-next:${last.sessionId}`, at: ctx.now(), sourceSessionId: last.sessionId, preview: true, targets, lastUsedHere, today: t.input });
        if (!r.ok) return null;
        const derived = await titleFor(liveExercises(source.exercises).map((e) => e.exerciseId));
        return {
          routine: null,
          sourceSessionId: last.sessionId,
          title: storedName(source) ?? derived.title,
          muscles: derived.muscles,
          exercises: repeatPreviewLines(r.aggregate).map((l) => ({ exerciseName: l.exerciseName, line: l.line })),
          targets: targetSummaryLines(r.aggregate),
          sets: r.aggregate.sets.length,
          aboutMinutes: await aboutMinutes(p, r.aggregate),
          sourceStartedAtUtc: source.session.startedAt.utc,
          tz: source.session.startedAt.tz,
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
     * always agree; Ben's Decision 2 (longest gap) stays off until he
     * decides. Types that can't be started (an imported source, P-I3) are
     * left out. Local reads only: no AI, no network, nothing written.
     * Never throws: null when it can't be read.
     */
    async list(req: { gymId: string | null; typicalEquipment?: readonly EquipmentInstance[] }): Promise<SessionList | null> {
      try {
        const p = await ctx.profile();
        if (!p) return null;
        const now = ctx.now();
        const live = liveRoutines(await repos().routines.listByOwner(p.id));
        const rows = await repos().sessions.listSessionTypeRows(p.id, TYPE_ROW_LIMIT);
        const index = groupSessionTypes({
          routines: live.map((r) => ({ id: r.id, name: r.name, createdFromSessionId: r.createdFromSessionId ?? null, exerciseCount: routineCounts(r).exercises })),
          sessions: rows.map((r) => ({ id: r.sessionId, routineId: r.routineId, routineName: r.routineName, startedAt: { utc: r.startedAtUtc, tz: r.tz }, exerciseCount: r.exerciseCount, imported: r.imported })),
          now,
          groupImportsByCategory: SESSION_PICKER_DECISIONS.groupImportsByCategory,
        });
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
        return { current: ordered.current.map(row), older: ordered.older.map(row), recommendedKey };
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
    make: (slots: { base: ReturnType<typeof basisSlots>; today: ReturnType<typeof basisSlots> }) => DraftCommand | null | Promise<DraftCommand | null>,
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
      for (const e of current === null ? [] : liveEdits(current.edits)) if (e.kind === 'swap' && (await exerciseById(e.toExerciseId)) !== null) known.add(e.toExerciseId);
      const resolvedEdits = current === null ? null : resolveTodayEdits(base, current.edits, (id) => known.has(id));
      const command = await make({ base, today: resolvedEdits === null ? base : editedSlots(base, resolvedEdits) });
      if (command === null) return { ok: false, reason: 'invalid', message: DRAFT_COPY.failed };
      const c = applyDraftCommand({
        current,
        expectedVersion: req.expectedDraftVersion,
        opId: req.opId,
        at,
        ownerId: p.id,
        basis,
        newDraftId: ctx.newId(),
        slots: base,
        prune: resolvedEdits === null ? [] : pruneOf(resolvedEdits.outcomes),
        command,
      });
      switch (c.kind) {
        case 'duplicate':
          return { ok: true, draft: c.current, duplicate: true, added: [], removed: [] };
        case 'unchanged':
          return { ok: true, draft: c.current, duplicate: false, added: [], removed: [] };
        case 'stale':
          return { ok: false, reason: 'stale', message: STALE_PREVIEW };
        case 'invalid':
          return { ok: false, reason: 'invalid', message: DRAFT_COPY.failed };
        case 'write': {
          const saved = await drafts.save(c.next, c.expectedVersion);
          if (!saved.ok) {
            // A retry whose first write landed reads as done; anything else moved under the page.
            const now = await drafts.open(p.id, basis);
            if (now?.opIds.includes(req.opId) === true) return { ok: true, draft: now, duplicate: true, added: [], removed: [] };
            return { ok: false, reason: 'stale', message: STALE_PREVIEW };
          }
          return { ok: true, draft: c.next, duplicate: false, added: c.added, removed: c.removed };
        }
      }
    } catch {
      return { ok: false, reason: 'failed', message: DRAFT_COPY.failed };
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
          const history = await repos().sessions.listFinishedWithExercise(p.id, ex.exerciseId).catch(() => [] as SessionAggregate[]);
          pasts[ex.exerciseId] = pastExercisesOf(history, ex.exerciseId);
          const info = await repos().exercises.get(ex.exerciseId).catch(() => null);
          if (info) exerciseInfo[ex.exerciseId] = info;
        }
        const allGyms = (await repos().gyms.listByOwner(p.id)).filter((g) => g.archivedAtUtc === undefined);
        const gym = req.gymId === null ? null : (allGyms.find((g) => g.id === req.gymId) ?? null);
        if (req.gymId !== null && gym === null) return null;
        const at = ctx.now();
        const title =
          resolved.kind === 'routine' ? resolved.routine.name : (storedName(resolved.source) ?? (await titleFor(liveExercises(resolved.source.exercises).map((e) => e.exerciseId))).title);
        const source = await overviewSource(resolved);
        // A failed read shows no coach rows; the key below reads them again, so a Start planned without them is refused.
        const coachTargets = await storedCoachTargets(p.id, source).catch(() => [] as NextSessionTargetRecord[]);
        const view = buildWorkoutOverview({
          aggregate,
          fits: run.fits,
          coach: source === null || coachTargets.length === 0 ? null : { targets: coachTargets, sourceVersion: source.session.version, sourceBasis: nextTargetSourceBasis(source), painToday: unspecifiedPain(planCheckIn).active },
          pasts,
          painFlags: await repos().painFlags.listActive(p.id),
          exerciseInfo,
          recent: await recentFinished(p),
          nowMs: toMs(at.utc),
          tz: at.tz,
          title,
          basis: resolved.basis,
          gym: gym === null ? null : { id: gym.id, name: gym.name },
          key: await previewKeyParts(p, resolved, req.gymId, planCheckIn, t.draft),
          today: await overviewToday(resolved, run.today, t.draft),
        });
        const rows = resolved.kind === 'routine' ? (await routineRows(p.id)).rows : [];
        return {
          view,
          startOf: resolved.kind === 'routine' ? { routineOf: resolved.routine.id } : { nextOf: resolved.source.session.id },
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
    async edit(req: DraftTarget & { edit: { kind: 'swap'; slotKey: string; toExerciseId: string } | { kind: 'skip'; slotKey: string } }): Promise<DraftWrite> {
      const edit = req.edit;
      return writeDraft(req, async ({ base }) => {
        if (edit.kind === 'swap') {
          // The Swap sheet's own checks, again here (review S5): the same measurement, doable at this gym. Not in today's plan: `applyDraftCommand`.
          if (!(await swapAllowed(req, base, edit.slotKey, edit.toExerciseId))) return null;
          if ((await ensureExercise(edit.toExerciseId)) === null) return null;
        }
        return { type: 'edit', edit };
      });
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
        for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) all.set(e.id, e);
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

  return { checkIns, pain, workout, today, repeat, next, routines, gymSwitch, overview, sessionTypes };
}

export type WorkoutServices = ReturnType<typeof createWorkoutServices>;

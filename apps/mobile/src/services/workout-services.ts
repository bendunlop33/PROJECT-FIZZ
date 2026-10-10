import {
  addDays,
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
  renameRoutine,
  restoreRoutine,
  routineCounts,
  routineFromSession,
  routineLastDone,
  type FinishedRef,
  type RoutineChange,
  type RoutineNameCheck,
  buildTimeLeftView,
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
} from '@fizz/domain';
import type { SqliteRepositories, Store } from '@fizz/persistence';
import type {
  CheckIn,
  CheckInScore,
  EquipmentInstance,
  Exercise,
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
}

export type CheckInWrite = { ok: true; checkIn: CheckIn; duplicate: boolean } | { ok: false; message: string; stale?: boolean };

const CHECK_IN_WRITE_FAILED = 'Check-in wasn’t saved. Your workout can start as normal.';
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
export type WorkoutStartOutcome = (Extract<StartOutcome, { ok: true }> & { notice?: string }) | Extract<StartOutcome, { ok: false }>;
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
  notCopied: { exerciseName: string; skipped: number }[];
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
  async function routineStart(p: UserProfile, req: { routineId: string; gymId: string; opId: string; preview: boolean; checkIn?: SessionCheckIn | null; today?: CheckIn | null }) {
    const routine = await repos().routines.get(req.routineId);
    const ref = routine ? (await finishedRefs(p.id)).find((f) => isFromRoutine(f, routine)) ?? null : null;
    const source = ref ? await repos().sessions.get(ref.sessionId).catch(() => null) : null;
    const targets = source ? await nextTargetsOf(p, source, req.today ?? null).catch(() => null) : null;
    const r = await domain().startRoutine({
      ownerId: p.id,
      gymId: req.gymId,
      routineId: req.routineId,
      opId: req.opId,
      at: ctx.now(),
      preview: req.preview,
      ...(req.checkIn !== undefined ? { checkIn: req.checkIn } : {}),
      ...(targets && targets.size > 0 ? { targets } : {}),
    });
    return { r, ref, source, targeted: targets !== null && targets.size > 0, targetsFailed: source !== null && targets === null };
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

  const workout = {
    /**
     * `startWorkout(…, opts.checkIn)` for an empty workout (no routines yet).
     * A gym is required (PM SP1). An answered check-in is linked in the same
     * write as the session; one already linked to another workout is refused.
     */
    async start(req: { gymId: string; opId: string; checkIn: SessionCheckIn | null; repeatOf?: string | null; nextOf?: string | null; routineOf?: string | null }): Promise<WorkoutStartOutcome> {
      const p = await ctx.profile();
      if (!p) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
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
        const { r, targetsFailed } = await routineStart(p, { routineId: req.routineOf, gymId: req.gymId, opId: req.opId, preview: false, checkIn, today });
        if (!r.ok) {
          const e = r.error;
          if (e.code === 'nothing_to_start') return { ok: false, error: { code: 'not_found', message: e.message } };
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
        // Same history mapping as Today's preview, so Start gives what the card showed (gym-switch GS3).
        const lastUsedHere = await lastUsedFor(p.id, source.exercises.map((e) => e.exerciseId), req.gymId);
        const r = await domain().startFromSession({ ownerId: p.id, gymId: req.gymId, routineId: null, opId: req.opId, at: ctx.now(), checkIn, sourceSessionId: req.nextOf, targets: targets ?? new Map(), name: storedName(source) ?? GENERIC_WORKOUT_NAME, lastUsedHere });
        if (!r.ok) {
          const e = r.error;
          if (e.code === 'nothing_to_repeat' || e.code === 'imported_not_repeatable') return { ok: false, error: { code: 'not_found', message: e.message } };
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
      const title = storedName(aggregate) === null && aggregate.exercises.length > 0 ? (await titleFor(aggregate.exercises.map((e) => e.exerciseId))).title : null;
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
      patch: Partial<SetValues> & { exclusions?: SetExclusion[] };
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
        if (!r.ok) return { ok: false, message: r.error.code === 'stale_version' ? 'Can’t undo: this set changed. Tap it to edit.' : r.error.message };
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
      const saved = (await repos().exercises.list()).filter((e) => e.measurement === 'reps' && (e.ownerId === null || e.ownerId === p?.id));
      const have = new Set(saved.map((e) => e.id));
      const extra = opts.withCatalogue && ctx.catalogueExercises ? ctx.catalogueExercises().filter((e) => !have.has(e.id)) : [];
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
     * Summary showed, labelled `Target (built-in rule)`; review S3), or one
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

    async summary(sessionId: string): Promise<WorkoutSummary | null> {
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
        coach: 'not_connected',
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
      return { ok: false, message: r.error.code === 'write_failed' ? 'Couldn’t undo. Nothing changed.' : 'Can’t undo: your workout changed since the switch.', back };
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
            title: storedName(a) ?? (await titleFor(a.exercises.map((e) => e.exerciseId)).catch(() => ({ title: 'Workout' }))).title,
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
      const title = storedName(source) ?? (await titleFor(source.exercises.map((e) => e.exerciseId)).catch(() => ({ title: GENERIC_WORKOUT_NAME }))).title;
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
        // Rotation (D19, simplified): the routine after the one done last, when the last workout was a routine's.
        const { live, refs } = await routineRows(p.id).catch(() => ({ live: [] as Routine[], refs: [] as FinishedRef[] }));
        const pick = nextInRotation(live, refs[0] ?? null);
        if (pick.kind === 'routine') {
          const { r, ref } = await routineStart(p, { routineId: pick.routine.id, gymId, opId: `preview-next-routine:${pick.routine.id}`, preview: true });
          if (r.ok) {
            const derived = await titleFor(r.aggregate.exercises.map((e) => e.exerciseId));
            return {
              routine: { id: pick.routine.id, basis: pick.basis },
              sourceSessionId: ref?.sessionId ?? null,
              title: pick.routine.name,
              muscles: derived.muscles,
              exercises: repeatPreviewLines(r.aggregate).map((l) => ({ exerciseName: l.exerciseName, line: l.line })),
              targets: targetSummaryLines(r.aggregate),
              sets: r.aggregate.sets.length,
              aboutMinutes: await aboutMinutes(p, r.aggregate),
              sourceStartedAtUtc: ref?.startedAtUtc ?? null,
              tz: ref?.tz ?? ctx.now().tz,
            };
          }
        }
        const last = (await repeat.candidates(1, { countImported: false })).rows[0];
        if (!last) return null;
        const source = await repos().sessions.get(last.sessionId);
        if (!source) return null;
        const targets = await nextTargetsOf(p, source);
        const lastUsedHere = await lastUsedFor(p.id, source.exercises.map((e) => e.exerciseId), gymId);
        const r = await domain().startFromSession({ ownerId: p.id, gymId, routineId: null, opId: `preview-next:${last.sessionId}`, at: ctx.now(), sourceSessionId: last.sessionId, preview: true, targets, lastUsedHere });
        if (!r.ok) return null;
        const derived = await titleFor(source.exercises.map((e) => e.exerciseId));
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
        if (storedName(a) === null && a.exercises.length > 0) titles[a.session.id] = (await titleFor(a.exercises.map((e) => e.exerciseId))).title;
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

  return { checkIns, pain, workout, today, repeat, next, routines, gymSwitch };
}

export type WorkoutServices = ReturnType<typeof createWorkoutServices>;

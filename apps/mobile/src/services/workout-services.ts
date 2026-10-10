import {
  applyCheckInPatch,
  buildActiveSetView,
  buildTodayView,
  buildWorkoutSummary,
  defaultStartingPlan,
  deriveWorkoutTitle,
  muscleSummary,
  clearPainFlag,
  restorePainFlag,
  createSessionService,
  deriveId,
  DEFAULT_CHECK_IN_SETTINGS,
  lastComparableSession,
  localDateOf,
  localWeekBounds,
  newCheckIn,
  newPainFlag,
  nextTargetsFor,
  plannedSetsFromTargets,
  repeatPreviewLines,
  unspecifiedPain,
  equipmentForExercise,
  searchExercises,
  shouldAskCheckIn,
  toIso,
  toMs,
  weekdayOf,
  type ActiveSetView,
  type CheckInGate,
  type CheckInPatch,
  type CommandOutcome,
  type DraftEdits,
  type HistorySession,
  type PreviousSession,
  type RecentCheckIn,
  type StartOutcome,
  type TodayView,
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
  SessionAggregate,
  SessionCheckIn,
  SessionCommand,
  SetType,
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

export interface PickerExercise {
  exercise: Exercise;
  /** Compatible equipment at this workout's gym. Empty = none needed (bodyweight) or none there (loads not checked). */
  equipment: Pick<EquipmentInstance, 'id' | 'name' | 'kind'>[];
}

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
  exercises: { exerciseName: string; equipmentName: string | null; line: string }[];
  notes: { exerciseName: string; text: string }[];
  notCopied: { exerciseName: string; skipped: number }[];
  sourceGymId: string | null;
  sourceStartedAtUtc: string;
  tz: string;
}

export interface ActiveWorkoutData {
  aggregate: SessionAggregate;
  gymName: string | null;
  previous: Record<string, PreviousSession | null>;
  painFlagged: Set<string>;
  effortScale: UserProfile['effortScale'];
  checkIn: CheckIn | null;
  /** `Push`, from the exercises, for a workout without a name (audit F5). */
  title: string | null;
}

/**
 * Today's main card (audit B2): the next session, built from the last
 * workout with the built-in rule's next targets (labelled), at this gym.
 */
export interface NextSessionPreview {
  sourceSessionId: string;
  title: string;
  /** `Chest · Shoulders · Triceps`. */
  muscles: string | null;
  exercises: { exerciseName: string; line: string }[];
  sets: number;
  sourceStartedAtUtc: string;
  tz: string;
}

export function createWorkoutServices(ctx: WorkoutServicesContext) {
  const repos = () => ctx.repos();
  const domain = () => createSessionService(repos(), ctx.newId);

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
    async flagFromCheckIn(req: { checkIn: CheckIn; exercises: Pick<Exercise, 'id' | 'name'>[]; area: PainArea | null; opId: string }): Promise<CheckInWrite & { flagIds?: string[] }> {
      try {
        const p = await owner();
        const at = ctx.now();
        const ids: string[] = [];
        for (const ex of req.exercises) {
          const id = deriveId(`pain:${req.opId}:${ex.id}`);
          ids.push(id);
          if (await repos().painFlags.get(id)) continue;
          const flag = newPainFlag({ id, ownerId: p.id, opId: req.opId, exerciseId: ex.id, exerciseName: ex.name, area: req.area, source: 'check_in', checkInId: req.checkIn.id, at });
          const saved = await repos().painFlags.save(flag, null);
          if (!saved.ok && !(await repos().painFlags.get(id))) return { ok: false, message: 'The pain flag wasn’t saved. Try again.' };
        }
        const updated = await checkIns.update(req.checkIn.id, { painFlagIds: ids }, req.checkIn.version, `${req.opId}:link`);
        return updated.ok ? { ...updated, flagIds: ids } : updated;
      } catch {
        return { ok: false, message: 'The pain flag wasn’t saved. Try again.' };
      }
    },

    /** Undo on the `Pain noted` toast. Only Ben clears a flag. */
    async clear(flagIds: readonly string[]): Promise<boolean> {
      const at = ctx.now();
      for (const id of flagIds) {
        const f = await repos().painFlags.get(id);
        if (!f || f.status === 'cleared') continue;
        const r = await repos().painFlags.save(clearPainFlag(f, at), f.version);
        if (!r.ok) return false;
      }
      return true;
    },

    /**
     * Clear with Undo (review S4): returns each cleared flag's new version, so
     * `undoClear` only restores a flag nothing else has changed since.
     */
    async clearWithUndo(flagIds: readonly string[]): Promise<{ ok: boolean; cleared: { id: string; version: number }[] }> {
      const at = ctx.now();
      const cleared: { id: string; version: number }[] = [];
      try {
        for (const id of flagIds) {
          const f = await repos().painFlags.get(id);
          if (!f || f.status === 'cleared') continue;
          const next = clearPainFlag(f, at);
          const r = await repos().painFlags.save(next, f.version);
          if (!r.ok) return { ok: false, cleared };
          cleared.push({ id, version: next.version });
        }
        return { ok: true, cleared };
      } catch {
        return { ok: false, cleared };
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
  };

  async function historyFor(ownerId: string, exerciseId: string): Promise<HistorySession[]> {
    return ctx.store().listExerciseHistory(ownerId, exerciseId);
  }

  /** The check-in on a workout, for "pain mentioned, no movement chosen" (PM SP3). */
  async function sessionCheckIn(a: SessionAggregate | null): Promise<CheckIn | null> {
    return a?.session.checkIn?.kind === 'answered' ? repos().checkIns.get(a.session.checkIn.checkInId) : null;
  }

  async function planFor(p: UserProfile, req: { sessionId: string; exerciseId: string; equipmentId: string | null }): Promise<{ setType: SetType; planned: PlannedSet }[] | null> {
    const [aggregate, exercise] = await Promise.all([repos().sessions.get(req.sessionId), repos().exercises.get(req.exerciseId)]);
    if (!aggregate || !exercise || exercise.measurement !== 'reps') return null;
    const equipment = req.equipmentId === null ? null : (aggregate.session.equipmentSnapshot.find((e) => e.id === req.equipmentId) ?? null);
    const unit = equipment?.unit ?? p.preferredUnit;
    const convention = equipment?.loadConvention ?? exercise.defaultLoadConvention;
    const history = await historyFor(p.id, exercise.id);
    const previous = lastComparableSession(history, { equipmentId: equipment?.id ?? null, unit, loadConvention: convention });
    // No history: three working sets in the built-in rep range, no load (audit B1).
    if (!previous) return defaultStartingPlan(exercise, equipment?.kind ?? null, convention);
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
    return plannedSetsFromTargets(result) ?? defaultStartingPlan(exercise, equipment?.kind ?? null, convention, Math.max(1, previous.sets.length));
  }

  /**
   * Next targets for every exercise of a finished workout, on the equipment
   * it was done with (the gym check happens when the workout is built).
   * Exercises the rule can't plan are left out, so they repeat as last time.
   */
  async function nextTargetsOf(p: UserProfile, source: SessionAggregate): Promise<Map<string, { setType: SetType; planned: PlannedSet }[]>> {
    const out = new Map<string, { setType: SetType; planned: PlannedSet }[]>();
    const flags = await repos().painFlags.listActive(p.id);
    const sessionPain = unspecifiedPain(await sessionCheckIn(source));
    for (const sx of source.exercises) {
      if (out.has(sx.exerciseId) || sx.measurement !== 'reps') continue;
      const done = source.sets.filter((s) => s.sessionExerciseId === sx.id && s.status === 'completed' && s.pairedWithSetId === null && s.setType !== 'warmup');
      if (done.length === 0) continue;
      const exercise = await repos().exercises.get(sx.exerciseId);
      const equipment = sx.equipmentId === null ? null : (source.session.equipmentSnapshot.find((e) => e.id === sx.equipmentId) ?? null);
      const { result } = nextTargetsFor({
        ownerId: p.id,
        exerciseId: sx.exerciseId,
        exerciseName: sx.exerciseName,
        measurement: sx.measurement,
        unit: sx.unit,
        convention: sx.loadConvention,
        equipment,
        exercise,
        rule: null,
        workingSets: done.length,
        history: await historyFor(p.id, sx.exerciseId),
        painFlags: flags,
        sessionPain,
      });
      const plan = plannedSetsFromTargets(result);
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
  const storedName = (a: SessionAggregate): string | null => (a.session.routineName !== null && a.session.routineName !== 'Workout' ? a.session.routineName : null);

  const workout = {
    /**
     * `startWorkout(…, opts.checkIn)` for an empty workout (no routines yet).
     * A gym is required (PM SP1). An answered check-in is linked in the same
     * write as the session; one already linked to another workout is refused.
     */
    async start(req: { gymId: string; opId: string; checkIn: SessionCheckIn | null; repeatOf?: string | null; nextOf?: string | null }): Promise<StartOutcome> {
      const p = await ctx.profile();
      if (!p) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
      let checkIn = req.checkIn;
      if (checkIn?.kind === 'answered') {
        const already = await repos().sessions.findByStartOperation(p.id, req.opId);
        const linked = await repos().checkIns.linkedIds([checkIn.checkInId]);
        // Linked to another workout (not this start's retry): start without it rather than block.
        if (linked.has(checkIn.checkInId) && already?.session.checkIn?.kind !== 'answered') checkIn = { kind: 'skipped', atUtc: ctx.now().utc };
      }
      if (req.nextOf) {
        // "Start next session" (audit B2): last workout's exercises with the built-in rule's next targets.
        const source = await repos().sessions.get(req.nextOf);
        if (!source) return { ok: false, error: { code: 'not_found', message: 'That workout wasn’t found.' } };
        const targets = await nextTargetsOf(p, source).catch(() => new Map<string, { setType: SetType; planned: PlannedSet }[]>());
        const name = storedName(source) ?? (await titleFor(source.exercises.map((e) => e.exerciseId))).title;
        const r = await domain().startFromSession({ ownerId: p.id, gymId: req.gymId, routineId: null, opId: req.opId, at: ctx.now(), checkIn, sourceSessionId: req.nextOf, targets, name });
        if (!r.ok) {
          const e = r.error;
          if (e.code === 'nothing_to_repeat' || e.code === 'imported_not_repeatable') return { ok: false, error: { code: 'not_found', message: e.message } };
          return { ok: false, error: e };
        }
        return { ok: true, aggregate: r.aggregate, warnings: [], duplicate: r.duplicate };
      }
      if (req.repeatOf) {
        // Repeat a past workout (routines.md RT4): its actuals become today's targets.
        const r = await domain().startFromSession({ ownerId: p.id, gymId: req.gymId, routineId: null, opId: req.opId, at: ctx.now(), checkIn, sourceSessionId: req.repeatOf });
        if (!r.ok) {
          const e = r.error;
          if (e.code === 'nothing_to_repeat' || e.code === 'imported_not_repeatable') return { ok: false, error: { code: 'not_found', message: e.message } };
          return { ok: false, error: e };
        }
        return { ok: true, aggregate: r.aggregate, warnings: [], duplicate: r.duplicate };
      }
      return domain().start({ ownerId: p.id, gymId: req.gymId, routineId: null, opId: req.opId, at: ctx.now(), checkIn });
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
      const title = aggregate.session.routineName === null && aggregate.exercises.length > 0 ? (await titleFor(aggregate.exercises.map((e) => e.exerciseId))).title : null;
      return {
        aggregate,
        gymName: gym?.name ?? null,
        previous,
        painFlagged: new Set(flags.map((f) => f.exerciseId)),
        effortScale: p.effortScale,
        checkIn: ci,
        title,
      };
    },

    /** `buildActiveSetView` over loaded data plus the screen's unsaved edits. */
    view(data: ActiveWorkoutData, nowMs: number, edits: DraftEdits | null): ActiveSetView {
      return buildActiveSetView({ aggregate: data.aggregate, nowMs, gymName: data.gymName, previous: data.previous, painFlagged: data.painFlagged, edits, title: data.title });
    },

    dispatch: async (sessionId: string, command: SessionCommand): Promise<CommandOutcome> => ctx.afterCommand(await domain().dispatch(sessionId, command)),

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
      const snapshot = aggregate?.session.equipmentSnapshot ?? [];
      // Bodyweight exercises never need (or get) a gym item: there's no load to check.
      return searchExercises(all, query).map((exercise) => ({
        exercise,
        equipment: equipmentForExercise(exercise, snapshot).map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
      }));
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
      return buildWorkoutSummary({
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
          if (gymId !== null && !gyms.has(gymId)) gyms.set(gymId, (await repos().gyms.get(gymId).catch(() => null))?.name ?? 'Gym');
          const names = [...a.exercises].sort((x, y) => x.order - y.order).filter((e) => done.some((s) => s.sessionExerciseId === e.id)).map((e) => e.exerciseName);
          rows.push({
            sessionId: a.session.id,
            title: a.session.routineName ?? 'Workout',
            startedAtUtc: a.session.startedAt.utc,
            tz: a.session.startedAt.tz,
            gymId,
            gymName: gymId === null ? 'Gym not recorded' : (gyms.get(gymId) ?? 'Gym'),
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
      const r = await domain().startFromSession({ ownerId: p.id, gymId, routineId: null, opId: `preview:${sourceSessionId}`, at: ctx.now(), sourceSessionId, preview: true });
      if (!r.ok) return null;
      const source = await repos().sessions.get(sourceSessionId);
      if (!source) return null;
      return { exercises: repeatPreviewLines(r.aggregate), notes: r.notes, notCopied: r.notCopied, sourceGymId: source.session.gymId, sourceStartedAtUtc: source.session.startedAt.utc, tz: source.session.startedAt.tz };
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
        const last = (await repeat.candidates(1, { countImported: false })).rows[0];
        if (!last) return null;
        const source = await repos().sessions.get(last.sessionId);
        if (!source) return null;
        const targets = await nextTargetsOf(p, source);
        const r = await domain().startFromSession({ ownerId: p.id, gymId, routineId: null, opId: `preview-next:${last.sessionId}`, at: ctx.now(), sourceSessionId: last.sessionId, preview: true, targets });
        if (!r.ok) return null;
        const derived = await titleFor(source.exercises.map((e) => e.exerciseId));
        return {
          sourceSessionId: last.sessionId,
          title: storedName(source) ?? derived.title,
          muscles: derived.muscles,
          exercises: repeatPreviewLines(r.aggregate).map((l) => ({ exerciseName: l.exerciseName, line: l.line })),
          sets: r.aggregate.sets.length,
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
      const [active, finished, recent] = await Promise.all([
        repos().sessions.getActive(p.id),
        // An unreadable workout this week is left out rather than blocking Today (review S1).
        repos().sessions.listFinishedBetweenReadable(p.id, toIso(week.startMs), toIso(week.endMs)).then((r) => r.sessions),
        recentCheckIns(p.id, nowMs),
      ]);
      return buildTodayView({
        nowMs,
        active,
        finishedThisWeek: finished,
        todayLocalDate: localDateOf(nowMs, at.tz),
        localDateOf: (utc) => localDateOf(toMs(utc), at.tz),
        recentCheckIns: recent.map((r) => ({ ...r, score: r.checkIn.score, reasons: r.checkIn.reasons })),
      });
    },
  };

  return { checkIns, pain, workout, today, repeat, next };
}

export type WorkoutServices = ReturnType<typeof createWorkoutServices>;

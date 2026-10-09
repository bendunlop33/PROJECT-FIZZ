import {
  applyCheckInPatch,
  buildActiveSetView,
  buildTodayView,
  buildWorkoutSummary,
  clearPainFlag,
  createSessionService,
  deriveId,
  DEFAULT_CHECK_IN_SETTINGS,
  lastComparableSession,
  localDateOf,
  localWeekBounds,
  newCheckIn,
  newPainFlag,
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
  ProgressionRule,
  SessionAggregate,
  SessionCheckIn,
  SessionCommand,
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
}

export type CheckInWrite = { ok: true; checkIn: CheckIn; duplicate: boolean } | { ok: false; message: string; stale?: boolean };

const CHECK_IN_WRITE_FAILED = 'Check-in wasn’t saved. Your workout can start as normal.';
const RECENT_WINDOW_MS = 3 * 60 * 60 * 1000;

export interface PickerExercise {
  exercise: Exercise;
  /** Compatible equipment at this workout's gym. Empty = none needed or none there (loads not checked). */
  equipment: Pick<EquipmentInstance, 'id' | 'name' | 'kind'>[];
}

export interface ActiveWorkoutData {
  aggregate: SessionAggregate;
  gymName: string | null;
  previous: Record<string, PreviousSession | null>;
  painFlagged: Set<string>;
  effortScale: UserProfile['effortScale'];
  checkIn: CheckIn | null;
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

    async active(): Promise<PainFlag[]> {
      const p = await ctx.profile();
      return p ? repos().painFlags.listActive(p.id) : [];
    },
  };

  async function historyFor(ownerId: string, exerciseId: string): Promise<HistorySession[]> {
    return ctx.store().listExerciseHistory(ownerId, exerciseId);
  }

  const workout = {
    /**
     * `startWorkout(…, opts.checkIn)` for an empty workout (no routines yet).
     * A gym is required (PM SP1). An answered check-in is linked in the same
     * write as the session; one already linked to another workout is refused.
     */
    async start(req: { gymId: string; opId: string; checkIn: SessionCheckIn | null }): Promise<StartOutcome> {
      const p = await ctx.profile();
      if (!p) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
      let checkIn = req.checkIn;
      if (checkIn?.kind === 'answered') {
        const already = await repos().sessions.findByStartOperation(p.id, req.opId);
        const linked = await repos().checkIns.linkedIds([checkIn.checkInId]);
        // Linked to another workout (not this start's retry): start without it rather than block.
        if (linked.has(checkIn.checkInId) && already?.session.checkIn?.kind !== 'answered') checkIn = { kind: 'skipped', atUtc: ctx.now().utc };
      }
      return domain().start({ ownerId: p.id, gymId: req.gymId, routineId: null, opId: req.opId, at: ctx.now(), checkIn });
    },

    /** Everything the Active workout screen needs, read once per change. */
    async load(sessionId?: string): Promise<ActiveWorkoutData | null> {
      const p = await ctx.profile();
      if (!p) return null;
      const aggregate = sessionId ? await repos().sessions.get(sessionId) : await repos().sessions.getActive(p.id);
      if (!aggregate) return null;
      const gym = await repos().gyms.get(aggregate.session.gymId);
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
      return {
        aggregate,
        gymName: gym?.name ?? null,
        previous,
        painFlagged: new Set(flags.map((f) => f.exerciseId)),
        effortScale: p.effortScale,
        checkIn: ci,
      };
    },

    /** `buildActiveSetView` over loaded data plus the screen's unsaved edits. */
    view(data: ActiveWorkoutData, nowMs: number, edits: DraftEdits | null): ActiveSetView {
      return buildActiveSetView({ aggregate: data.aggregate, nowMs, gymName: data.gymName, previous: data.previous, painFlagged: data.painFlagged, edits });
    },

    dispatch: async (sessionId: string, command: SessionCommand): Promise<CommandOutcome> => ctx.afterCommand(await domain().dispatch(sessionId, command)),

    /** Exercise picker: the exercise list with compatible equipment at this workout's gym. */
    async pickerExercises(sessionId: string, query: string): Promise<PickerExercise[]> {
      const aggregate = await repos().sessions.get(sessionId);
      const all = (await repos().exercises.list()).filter((e) => e.measurement === 'reps');
      const snapshot = aggregate?.session.equipmentSnapshot.filter((e) => e.availability === 'available') ?? [];
      return searchExercises(all, query).map((exercise) => ({
        exercise,
        equipment: snapshot.filter((e) => exercise.compatibleEquipment.includes(e.kind)).map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
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

    async addExercise(req: { sessionId: string; exerciseId: string; equipmentId: string | null; opId: string }): Promise<CommandOutcome> {
      const p = await ctx.profile();
      if (!p) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
      return ctx.afterCommand(await domain().addExercise(req.sessionId, { ownerId: p.id, exerciseId: req.exerciseId, equipmentId: req.equipmentId, opId: req.opId, at: ctx.now() }));
    },

    async summary(sessionId: string): Promise<WorkoutSummary | null> {
      const p = await ctx.profile();
      const aggregate = await repos().sessions.get(sessionId);
      if (!p || !aggregate) return null;
      const gym = await repos().gyms.get(aggregate.session.gymId);
      const history: Record<string, HistorySession[]> = {};
      const rules: Record<string, ProgressionRule> = {};
      for (const ex of aggregate.exercises) {
        history[ex.exerciseId] ??= await historyFor(p.id, ex.exerciseId);
        if (ex.progressionRuleId !== null && !(ex.progressionRuleId in rules)) {
          const r = await repos().progressionRules.get(ex.progressionRuleId);
          if (r) rules[r.id] = r;
        }
      }
      const ci = aggregate.session.checkIn?.kind === 'answered' ? await repos().checkIns.get(aggregate.session.checkIn.checkInId) : null;
      return buildWorkoutSummary({
        aggregate,
        nowMs: toMs(ctx.now().utc),
        gymName: gym?.name ?? null,
        history,
        rules,
        painFlags: await repos().painFlags.listActive(p.id),
        checkIn: ci,
        coach: 'not_connected',
      });
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
        repos().sessions.listFinishedBetween(p.id, toIso(week.startMs), toIso(week.endMs)),
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

  return { checkIns, pain, workout, today };
}

export type WorkoutServices = ReturnType<typeof createWorkoutServices>;

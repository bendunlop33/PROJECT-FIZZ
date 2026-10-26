import { createWeeklyReviewService } from '../reviews/weekly-review-service';
import { createCustomExercises } from './custom-exercises';
import {
  buildPresetDraft,
  buildQuickGymDraft,
  type GymEdit,
  type GymLearn,
  type QuickGymInput,
  createSessionService,
  deriveId,
  discardCommand,
  LEGACY_STARTER_IDS,
  listGymPresets,
  localDateOf,
  materialiseGymDraft,
  planRoutines,
  starterExercises,
  toIso,
  toMs,
  type GymDraft,
  type GymPresetId,
  type CommandOutcome,
  type DiscardConfirmation,
  type RecoveryResult,
  type StartOutcome,
  DEFAULT_CHECK_IN_SETTINGS,
} from '@fizz/domain';
import { bundledCatalogue, toExerciseRow, type CatalogueEntry } from '@fizz/catalogue';
import {
  checkIntegrity,
  EXERCISE_SPEC,
  listDocuments,
  PROFILE_SPEC,
  saveDocumentIn,
  timeSlicer,
  type AppInfo,
  type DatabaseManager,
  type IntegrityReport,
  type RecordCounts,
  type SqliteRepositories,
} from '@fizz/persistence';
import type { CheckInSettings, EquipmentInstance, Exercise, Gym, GymSetup, ImplementCount, SessionAggregate, SessionCheckIn, SessionCommand, UserProfile, WeightUnit, ZonedTimestamp } from '@fizz/schemas';

import type { CoachModelPort } from '@fizz/coach';
import type { HealthPort, TextCoachState } from '@fizz/providers';

import type { RestAlertController } from '../alerts/rest-alerts';
import { createCoachService } from '../coach/coach-service';
import { createBackupService, type BackupFileStore, type TextFile } from '../backup/backup-service';
import { createRestoreService } from '../backup/restore-service';
import { createDataDomainService, type CredentialPort, type PersonalFilesPort } from '../backup/data-domain-service';
import { createImportService } from '../import/import-service';
import { createLayoutService } from '../import/layout-service';
import { createGymServices, type GymEditOutcome } from './gym-services';
import { createExercisePickerService } from './exercise-picker-service';
import { createLibraryService } from './library-service';
import { createProgressService } from './progress-service';
import { createTrainingService } from './training-service';
import { createLiftTargetService } from './lift-target-service';
import { createPlanServices } from './plan-services';
import { createPlanBuilderService } from './plan-builder-service';
import { createWeekServices } from './week-services';
import { createHistoryServices } from './history-services';
import { createTodaySessionService, type TodaySessionData } from './today-session';
import { createWorkoutServices, STALE_PREVIEW, type OverviewStartOf, type OverviewTarget, type SessionList, type WorkoutStartOutcome } from './workout-services';
import { bumpProfile, newProfile, setupStep, unitLockedText, type SetupStep } from './setup';
import { createBuilderEnv } from '../builder/builder-env';
import { createBuilderService } from '../builder/builder-service';
import { createWorkoutEditService } from '../workout/workout-edit-service';
import { createBuilderCoachPorts } from '../builder/coach-ports';
import { setBuilderReviewProvider } from '../builder/review';
import { createBuilderCoachService, createDayNotes } from '../coach/builder-coach-service';
import { createBuilderReviewProvider } from '../coach/builder-review-provider';
import { deloadAtOf } from './deload-at';
import { createHealthService } from '../health/health-service';

/**
 * The app's in-process services (no HTTP layer). Screens call these and never
 * touch repositories, SQL or domain rules directly.
 *
 * Rule 10: the two data domains are exposed separately.
 * - `yourData`: owner-scoped records about Ben (profile, gyms and equipment,
 *   routines, workouts).
 * - `coachingKnowledge`: general records with no owner (exercise catalogue,
 *   gym presets). Custom exercise definitions belong here too (open-decisions
 *   B12).
 * Both currently live in one SQLite file; separate tables and per-section
 * backups/restores are the follow-up (open-decisions "For the developer" §1–2).
 *
 * Every read goes through `manager.store` at call time, so after a restore
 * or rollback the services use the new database without being rebuilt.
 */

export interface AppServicesDeps {
  manager: DatabaseManager;
  backupFiles: BackupFileStore;
  backupManifest: TextFile;
  now: () => ZonedTimestamp;
  newId: () => string;
  app: AppInfo;
  locale?: string;
  /** Rest-end alerts (phone binding); absent in tests that don't need it. */
  restAlerts?: RestAlertController;
  /** Bundled catalogue entries (tests inject a small one); defaults to the shipped catalogue. */
  catalogue?: () => readonly CatalogueEntry[];
  /**
   * The coach's model and connection (the phone wires the ChatGPT-plan route).
   * Absent: the coach reads as not connected; nothing else changes (rule 1).
   */
  coach?: { model: () => CoachModelPort; connection: () => Promise<TextCoachState> };
  /**
   * Delete my data / Reset coaching knowledge: the marker and op-ID ledger
   * (a small file in the container), the Keychain items and the Your-data
   * files outside SQLite. Absent in tests that don't need them: the ledger
   * is then kept in memory.
   */
  dataLedger?: TextFile;
  credentials?: CredentialPort;
  personalFiles?: PersonalFilesPort;
  /** How long Delete waits for the online ChatGPT revoke (default 10 s). */
  signOutTimeoutMs?: number;
  /** Check-in settings (check-in.md §2.8; not persisted yet). Absent: the defaults (`Only when I choose`, Ben 23 Oct). */
  checkInSettings?: () => CheckInSettings;
  /**
   * (ADR 0035) Apple Health: the HealthKit bridge and whether the build has the entitlement. Absent (tests, Expo
   * Go): Apple Health reads `Not available on this install`; nothing else changes.
   */
  health?: { port: HealthPort | null; buildIncludesHealth: boolean };
  /** Resolves when the UI is idle; background backups wait for it so Finish's Summary appears first (backup review B1). */
  idle?: () => Promise<void>;
}

function memoryTextFile(): TextFile {
  let text: string | null = null;
  return {
    read: () => Promise.resolve(text),
    write: (t) => {
      text = t;
      return Promise.resolve();
    },
  };
}

export type SetupState = { step: SetupStep; profile: UserProfile | null; gyms: Gym[] };

export type SetupWriteResult = { ok: true } | { ok: false; message: string };

export type IntegrityCheck = { atUtc: string; tz: string; report: IntegrityReport } | null;

const WRITE_FAILED = 'Couldn’t save. Try again.';

export function createAppServices(deps: AppServicesDeps) {
  const repos = (): SqliteRepositories => deps.manager.store.repos;
  const backups = createBackupService({
    store: () => deps.manager.store,
    files: deps.backupFiles,
    manifest: deps.backupManifest,
    now: deps.now,
    app: deps.app,
    ...(deps.locale === undefined ? {} : { locale: deps.locale }),
    ...(deps.idle === undefined ? {} : { idle: deps.idle }),
  });
  let lastIntegrity: IntegrityCheck = null;

  /** The single owner's profile (single-user app; the profile ID is the stable owner ID). */
  async function getProfile(): Promise<UserProfile | null> {
    const all = await deps.manager.store.db.read((q) => listDocuments(q, PROFILE_SPEC));
    return [...all].sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? -1 : 1))[0] ?? null;
  }

  /**
   * Versioned profile write. `patch` may be a function of the current profile,
   * so a retry after a version clash merges onto the fresh row instead of
   * writing a stale copy (review progress-A S3); it returns null for "no
   * change". Writes run one at a time, so two quick taps can't race.
   */
  type ProfilePatch = Parameters<typeof bumpProfile>[1];
  let profileWrites: Promise<unknown> = Promise.resolve();
  function updateProfile(patch: ProfilePatch | ((current: UserProfile) => ProfilePatch | null)): Promise<SetupWriteResult> {
    const run = async (): Promise<SetupWriteResult> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await getProfile();
        if (!current) return { ok: false, message: 'Your profile wasn’t found. Start setup again.' };
        const next = typeof patch === 'function' ? patch(current) : patch;
        if (next === null) return { ok: true };
        const saved = await repos().profiles.save(bumpProfile(current, next, deps.now().utc), current.version);
        if (saved.ok) return { ok: true };
      }
      return { ok: false, message: WRITE_FAILED };
    };
    const out = profileWrites.then(run, run);
    profileWrites = out.catch(() => undefined);
    return out;
  }

  const yourData = {
    profile: getProfile,
    gyms: async (): Promise<Gym[]> => {
      const p = await getProfile();
      return p ? (await repos().gyms.listByOwner(p.id)).filter((g) => g.archivedAtUtc === undefined) : [];
    },
    /** The default gym, else the first. */
    currentGym: async (): Promise<Gym | null> => {
      const gyms = await yourData.gyms();
      return gyms.find((g) => g.isDefault) ?? gyms[0] ?? null;
    },
    equipment: (gymId: string): Promise<EquipmentInstance[]> => repos().equipment.listByGym(gymId),
    counts: (): Promise<RecordCounts> => deps.manager.store.countRecords(),
  };

  const coachingKnowledge = {
    exercises: (): Promise<Exercise[]> => repos().exercises.list(),
    gymPresets: listGymPresets,
    /**
     * Seed the starter exercise list (until the catalogue package is wired).
     * One transaction; only missing IDs are added, so it is safe every launch
     * and never overwrites an existing record.
     */
    ensureStarterExercises: (): Promise<number> =>
      deps.manager.store.db.write(async (tx) => {
        // Pre-B2 starter rows (another ID scheme) that nothing refers to are removed, so nothing shows twice.
        for (const legacy of LEGACY_STARTER_IDS) {
          const used = await tx.getFirst(
            'SELECT 1 AS used FROM session_exercises WHERE exercise_id = ? UNION ALL SELECT 1 FROM pain_flags WHERE exercise_id = ? LIMIT 1',
            [legacy, legacy],
          );
          if (!used) await tx.run('DELETE FROM exercises WHERE id = ? AND owner_id IS NULL', [legacy]);
        }
        const have = new Set((await listDocuments(tx, EXERCISE_SPEC)).map((e) => e.id));
        let added = 0;
        for (const e of starterExercises(deps.now().utc)) {
          if (have.has(e.id)) continue;
          const r = await saveDocumentIn(tx, EXERCISE_SPEC, e, null);
          if (r.ok) added += 1;
        }
        return added;
      }),
    buildGymDraft: (presetId: GymPresetId, unit: WeightUnit): GymDraft => buildPresetDraft(presetId, unit),
    /** (Ben, 20 Oct; ADR 0029) Full gym / Hotel or small / Home as a draft, every item assumed. */
    buildQuickGymDraft: (input: QuickGymInput): GymDraft => buildQuickGymDraft(input),
  };

  const setup = {
    async getState(): Promise<SetupState> {
      const profile = await getProfile();
      const gyms = profile ? await repos().gyms.listByOwner(profile.id) : [];
      return { step: setupStep(profile, gyms.length), profile, gyms };
    },

    /**
     * Step 1. Creates the profile on first save; later saves update it. Safe to
     * repeat, even concurrently (review S1): the "is there a profile?" check and
     * the insert happen in one write transaction, so there is only ever one
     * owner profile.
     */
    async saveUnits(unit: WeightUnit): Promise<SetupWriteResult> {
      const at = deps.now();
      const id = deps.newId();
      let created: boolean;
      try {
        created = await deps.manager.store.db.write(async (tx) => {
          if ((await listDocuments(tx, PROFILE_SPEC)).length > 0) return false;
          const saved = await saveDocumentIn(tx, PROFILE_SPEC, newProfile({ id, unit, timezone: at.tz, atUtc: at.utc }), null);
          if (!saved.ok) throw new Error('profile conflict');
          return true;
        });
      } catch {
        return { ok: false, message: WRITE_FAILED };
      }
      if (created) return { ok: true };
      const existing = await getProfile();
      if (!existing) return { ok: false, message: WRITE_FAILED };
      if (existing.preferredUnit === unit) return { ok: true };
      // Back to Step 1 over a saved gym: its equipment is in the old unit and
      // stays so, so the unit is locked (Ready would say lb over kg loads).
      const inSetup = existing.setup !== undefined && existing.setup.completedAtUtc === undefined;
      if (inSetup && (await repos().gyms.listByOwner(existing.id)).some((g) => g.archivedAtUtc === undefined)) {
        return { ok: false, message: unitLockedText(existing.preferredUnit) };
      }
      return updateProfile({ preferredUnit: unit });
    },

    /**
     * Step 2 `Save gym`: the gym and every ticked item in one transaction.
     * `gymId` is chosen once per visit to the step, so a double tap or a retry
     * creates one gym (the second call is a duplicate).
     */
    async saveGym(req: { gymId: string; name: string; draft: GymDraft | null; setup?: GymSetup }): Promise<SetupWriteResult> {
      const profile = await getProfile();
      if (!profile) return { ok: false, message: 'Your profile wasn’t found. Start setup again.' };
      const existing = await repos().gyms.listByOwner(profile.id);
      // Review B1 / PM SP3: during first run a saved gym is never saved again
      // under a new ID (Back over a saved gym shows it read-only until the gym
      // editor's updateGym exists). A retry with the same ID stays a duplicate.
      const inSetup = profile.setup !== undefined && profile.setup.completedAtUtc === undefined;
      if (inSetup && existing.some((g) => g.id !== req.gymId)) {
        return { ok: false, message: 'A gym is already saved.' };
      }
      const result = materialiseGymDraft(req.draft, {
        name: req.name,
        ownerId: profile.id,
        gymId: req.gymId,
        isDefault: existing.length === 0 || existing.every((g) => g.id === req.gymId),
        atUtc: deps.now().utc,
        newId: deps.newId,
        ...(req.setup === undefined ? {} : { setup: req.setup }),
      });
      if (!result.ok) return { ok: false, message: result.error === 'name_empty' ? 'Give the gym a name' : (result.issues[0]?.message ?? 'Needs fixing') };
      try {
        const saved = await repos().gyms.createWithEquipment(result.gym, result.equipment);
        if (!saved.ok) return { ok: false, message: WRITE_FAILED };
      } catch {
        return { ok: false, message: WRITE_FAILED };
      }
      if (profile.setup !== undefined && profile.setup.completedAtUtc === undefined && profile.setup.gymStep !== 'saved') {
        return updateProfile({ setup: { ...profile.setup, gymStep: 'saved' } });
      }
      return { ok: true };
    },

    /**
     * `Use a typical gym for now` (audit B4): a "Main gym" from the
     * commercial preset with every item ticked and marked not checked, so a
     * first workout can start straight away (loads are snapped to typical
     * equipment and can be corrected in the gym editor). The ID is derived
     * from the owner, so a double tap or a retry creates one gym. With a gym
     * already saved this does nothing.
     */
    async useTypicalGym(): Promise<SetupWriteResult & { gymId?: string }> {
      const profile = await getProfile();
      if (!profile) return { ok: false, message: 'Your profile wasn’t found. Start setup again.' };
      const all = await repos().gyms.listByOwner(profile.id);
      const existing = all.filter((g) => g.archivedAtUtc === undefined);
      const current = existing.find((g) => g.isDefault) ?? existing[0];
      if (current) return { ok: true, gymId: current.id };
      const draft = buildPresetDraft('commercial', profile.preferredUnit);
      // A new ID per archived gym, so an archived typical gym is never reused (review S5). Still one per double tap.
      const archived = all.length - existing.length;
      const gymId = deriveId(archived === 0 ? `typical-gym:${profile.id}` : `typical-gym:${profile.id}:${String(archived)}`);
      const result = materialiseGymDraft(
        { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) },
        { name: 'Main gym', ownerId: profile.id, gymId, isDefault: true, atUtc: deps.now().utc, newId: deps.newId },
      );
      if (!result.ok) return { ok: false, message: result.issues[0]?.message ?? WRITE_FAILED };
      try {
        const saved = await repos().gyms.createWithEquipment(result.gym, result.equipment);
        if (!saved.ok) {
          const there = await repos().gyms.get(gymId);
          if (!there || there.archivedAtUtc !== undefined) return { ok: false, message: WRITE_FAILED };
        }
      } catch {
        return { ok: false, message: WRITE_FAILED };
      }
      if (profile.setup !== undefined && profile.setup.completedAtUtc === undefined && profile.setup.gymStep !== 'saved') {
        const r = await updateProfile({ setup: { ...profile.setup, gymStep: 'saved' } });
        if (!r.ok) return r;
      }
      return { ok: true, gymId };
    },

    async skipGym(): Promise<SetupWriteResult> {
      const profile = await getProfile();
      if (!profile) return { ok: false, message: 'Your profile wasn’t found. Start setup again.' };
      // Skip after a gym was saved changes nothing: the gym stays (review B1).
      if ((await repos().gyms.listByOwner(profile.id)).length > 0) return { ok: true };
      return updateProfile({ setup: { ...profile.setup, gymStep: 'skipped' } });
    },

    /**
     * Restored data with a profile skips setup (onboarding OB3, check 10; PM
     * decision on SP4): a backup saved part-way through setup is marked set
     * up rather than asked again. With no profile in the restored data,
     * Welcome shows as before.
     *
     * Derived from the data at every launch (review R3), not run by the
     * restore screen after the switch, so a force-close between the switch
     * and `Done` can't resume setup mid-way. It applies when the last database
     * switch was a restore and the profile came with it (created before the
     * switch) but isn't marked set up. A profile created after the restore
     * (setup run on top of a backup without one) is left to finish setup.
     */
    async skipAfterRestore(): Promise<{ skipped: boolean }> {
      const last = deps.manager.rollbackTarget.last;
      if (last?.reason !== 'restore') return { skipped: false };
      const profile = await getProfile();
      if (!profile || profile.setup === undefined || profile.setup.completedAtUtc !== undefined) return { skipped: false };
      if (toMs(profile.createdAtUtc) >= toMs(last.atUtc)) return { skipped: false };
      const r = await setup.complete();
      return { skipped: r.ok };
    },

    /** Ready → `Go to Today`. */
    async complete(): Promise<SetupWriteResult> {
      const profile = await getProfile();
      if (!profile) return { ok: false, message: 'Your profile wasn’t found. Start setup again.' };
      if (profile.setup === undefined || profile.setup.completedAtUtc !== undefined) return { ok: true };
      return updateProfile({ setup: { ...profile.setup, completedAtUtc: deps.now().utc } });
    },
  };

  /**
   * After any command (committed events → subscribers, never gatekeepers):
   * a finished workout triggers an on-phone backup, and the rest-end alert is
   * reconciled with the new state. Neither is awaited by the write.
   */
  function afterCommand(outcome: CommandOutcome): CommandOutcome {
    if (outcome.ok && !outcome.duplicate && outcome.events.some((e) => e.type === 'SessionFinished')) {
      void backups.backUpOnPhone('workout_finished');
      void progress.prewarm().catch(() => undefined);
    }
    if (outcome.ok && deps.restAlerts) void deps.restAlerts.reconcile(outcome.aggregate, toMs(deps.now().utc));
    return outcome;
  }

  const domainSessions = () => createSessionService(repos(), deps.newId, { deloadAt: deloadAtOf(repos) });

  const sessions = {
    active: async (): Promise<SessionAggregate | null> => {
      const p = await getProfile();
      return p ? repos().sessions.getActive(p.id) : null;
    },
    /** Cold-start recovery (flow §4.2). Nothing is committed except the caught-up timers. */
    recover: async (): Promise<RecoveryResult | null> => {
      const p = await getProfile();
      return p ? domainSessions().recover(p.id, deps.now()) : null;
    },
    /** `Start empty workout` (today.md §4). `opId` is chosen once per tap target, so a double tap starts one session. */
    startEmpty: async (req: { gymId: string; opId: string }): Promise<StartOutcome> => {
      const p = await getProfile();
      if (!p) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
      return domainSessions().start({ ownerId: p.id, gymId: req.gymId, routineId: null, opId: req.opId, at: deps.now() });
    },
    dispatch: async (sessionId: string, command: SessionCommand): Promise<CommandOutcome> => afterCommand(await domainSessions().dispatch(sessionId, command)),
    finish: (s: SessionAggregate, opId: string): Promise<CommandOutcome> =>
      sessions.dispatch(s.session.id, { type: 'finish', at: deps.now(), opId, expectedVersion: s.session.version, endedAt: null }),
    /**
     * The session picker (session-picker §7): Ben's session types in picker
     * order, `UP NEXT` the same as Today's card. With no gym, Up next is
     * resolved against the typical gym, as the overview does. Local only;
     * never throws (null: couldn't read).
     */
    list: async (gymId: string | null): Promise<SessionList | null> => {
      const typical = gymId === null ? await typicalEquipment().catch(() => null) : null;
      return loop.sessionTypes.list({ gymId, ...(typical ? { typicalEquipment: typical } : {}) });
    },
    /** Discard with the confirmation Ben accepted (`discardConfirmation`); the reducer refuses a mismatch. */
    discard: (sessionId: string, ask: DiscardConfirmation, opId: string): Promise<CommandOutcome> =>
      sessions.dispatch(sessionId, discardCommand(ask, { opId, at: deps.now() })),
  };

  const integrity = {
    /**
     * `Check all data` (system-states §3.7). Never repairs Ben's data. (ADR 0032) It also compares each workout's
     * stored history summary (derived, rebuildable) with the workout and rebuilds any that disagree, from the workout.
     */
    async checkAll(): Promise<IntegrityCheck> {
      const at = deps.now();
      const store = deps.manager.store;
      const report = await checkIntegrity(store.db, undefined, timeSlicer(), { summaries: true });
      if ((report.staleSummaries ?? []).length > 0) await store.repairHistorySummaries(report.staleSummaries).catch(() => null);
      lastIntegrity = { atUtc: at.utc, tz: at.tz, report };
      return lastIntegrity;
    },
    last: (): IntegrityCheck => lastIntegrity,
  };

  /**
   * Developer settings only (review S6): read-only facts about the database
   * files. Screens never get the manager, repositories or SQL.
   */
  const developer = {
    databaseNames: () => deps.manager.databaseNames,
  };

  /** Restore, Undo restore and Check a backup. Screens relaunch the app after a switch. */
  const restore = createRestoreService({
    manager: deps.manager,
    backupFiles: deps.backupFiles,
    now: deps.now,
    activeWorkout: () => sessions.active(),
    copiesOnPhone: async () => (await backups.getStatus()).copiesOnPhone,
    backupsIdle: () => backups.whenIdle(),
    ...(deps.restAlerts ? { restAlerts: deps.restAlerts } : {}),
  });

  /**
   * The bundled exercise catalogue as exercise rows (Coaching knowledge),
   * read on first use (the picker's second pass), never at launch. A row is
   * saved only when Ben adds that exercise (audit F4).
   */
  let catalogueRows: Exercise[] | null = null;
  const catalogueExercises = (): readonly Exercise[] => {
    if (catalogueRows === null) {
      const at = '2026-10-10T00:00:00.000Z';
      catalogueRows = (deps.catalogue ? deps.catalogue() : bundledCatalogue().catalogue.entries).flatMap((entry) => {
        const row = toExerciseRow(entry, at);
        // Every measurement: the picker chooses what it offers (`PICKER_MEASUREMENTS`); swaps match the slot's.
        return row.ok ? [row.exercise] : [];
      });
    }
    return catalogueRows;
  };

  /** A catalogue entry's substitutions in catalogue order (Coaching knowledge), for `Swap today` (exercise-library §2.5). */
  let substitutionsByKey: Map<string, (string | null)[]> | null = null;
  const catalogueSubstitutions = (catalogueKey: string): readonly (string | null)[] => {
    if (substitutionsByKey === null) {
      substitutionsByKey = new Map();
      for (const entry of deps.catalogue ? deps.catalogue() : bundledCatalogue().catalogue.entries) {
        substitutionsByKey.set(entry.key, 'variations' in entry ? (entry.variations?.substitutions ?? []).map((v) => v.key) : []);
      }
    }
    return substitutionsByKey.get(catalogueKey) ?? [];
  };

  /** A catalogue entry's dumbbell count (`implements`, Coaching knowledge), for Progress's total weight (20 Oct). */
  let implementsByKey: Map<string, ImplementCount> | null = null;
  const catalogueImplements = (catalogueKey: string): ImplementCount | null => {
    if (implementsByKey === null) {
      implementsByKey = new Map();
      for (const entry of deps.catalogue ? deps.catalogue() : bundledCatalogue().catalogue.entries) if ('implements' in entry && entry.implements !== undefined) implementsByKey.set(entry.key, entry.implements);
    }
    return implementsByKey.get(catalogueKey) ?? null;
  };

  /** A catalogue entry's other names (Coaching knowledge), for search (exercise-library EL1). */
  let aliasesByKey: Map<string, readonly string[]> | null = null;
  const catalogueAliases = (catalogueKey: string): readonly string[] => {
    if (aliasesByKey === null) {
      aliasesByKey = new Map();
      for (const entry of deps.catalogue ? deps.catalogue() : bundledCatalogue().catalogue.entries) aliasesByKey.set(entry.key, entry.aliases);
    }
    return aliasesByKey.get(catalogueKey) ?? [];
  };

  /** Ben's own exercises (19 Oct): create, edit, delete. Your data, local only. */
  const customExercises = createCustomExercises({ repos, now: deps.now, profile: getProfile, catalogueExercises, catalogueAliases });

  const loop = createWorkoutServices({
    ...(deps.checkInSettings === undefined ? {} : { checkInSettings: deps.checkInSettings }),
    repos,
    store: () => deps.manager.store,
    now: deps.now,
    newId: deps.newId,
    profile: getProfile,
    afterCommand,
    afterStart: (a) => {
      if (deps.restAlerts) void deps.restAlerts.reconcile(a, toMs(deps.now().utc));
    },
    catalogueExercises,
    catalogueSubstitutions,
    catalogueAliases,
    // `Ask coach` on How long? (fit-to-time §5): the coach's one request; `coach` is defined below and only read when Ben asks.
    coachFit: (context, signal) => coach.fitToday(context, signal),
  });

  /** Training details and split (Ben 13 Oct: D5, D7, D8; F19). Your data, local only. */
  const training = createTrainingService({ store: () => deps.manager.store, profile: getProfile, now: deps.now, catalogueExercises });

  /** Lift targets (Ben approved 20 Oct): Your data on the training profile; the coach sees them only while on. */
  const liftTargets = createLiftTargetService({
    training,
    // `progress` is defined below; read only when a screen or the coach asks.
    history: () => progress.libraryHistory(),
    exercises: async () => {
      const out = new Map<string, Exercise>();
      for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) out.set(e.id, e);
      for (const e of catalogueExercises()) if (!out.has(e.id)) out.set(e.id, e);
      return out;
    },
    now: deps.now,
  });

  /** The coach (ADR 0020 C6–C8): threads, turns, Undo, the summary turn, next-session targets. */
  /** (Ben, 20 Oct) Activities (runs, rides, swims, sport) and this week's shape. Local only. */
  const weekly = createWeekServices({
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    newId: deps.newId,
    catalogueExercises,
    currentGymId: async () => (await yourData.currentGym())?.id ?? null,
    plannedDay: (routineId, gymId) => loop.routines.planned(routineId, gymId),
  });

  const coach = createCoachService({
    ...(deps.checkInSettings === undefined ? {} : { checkInSettings: deps.checkInSettings }),
    // (Ben, 20 Oct) Lift targets join the training details only while the setting is on.
    training: async () => {
      const t = await training.coachInput();
      if (t === null || t.profile?.liftTargetsOn !== true) return t;
      const views = await liftTargets.coachViews().catch(() => []);
      return views.length === 0 ? t : { ...t, liftTargets: views };
    },
    liftTargets: { on: () => liftTargets.on(), prepare: (args, at) => liftTargets.prepare(args, at) },
    week: {
      view: () => weekly.week.contextView(),
      tool: async () => {
        const s = await weekly.week.state();
        return s === null ? null : { facts: s.facts, basis: s.basis, factsKey: s.factsKey };
      },
    },
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    newId: deps.newId,
    ...(deps.coach === undefined ? {} : { model: deps.coach.model, connection: deps.coach.connection }),
    builtInNextTargets: (sessionId, reps) => loop.workout.builtInNextTargets(sessionId, reps),
    upNextTitle: (gymId) => loop.workout.upNextTitle(gymId),
    coachAddInputs: (exerciseId, aggregate) => loop.workout.coachAddInputs(exerciseId, aggregate),
    onSessionChanged: (a) => {
      if (deps.restAlerts) void deps.restAlerts.reconcile(a, toMs(deps.now().utc));
    },
    catalogueExercises,
    catalogueSubstitutions,
    catalogueAliases,
    createCustomExercise: (req) => customExercises.create(req),
    exerciseClash: (name) => customExercises.coachClash(name),
    // A build with no gym yet plans on the typical gym's items (workout-builder §4.1 `⚠ No gym`).
    typicalEquipment: () => typicalEquipment(),
    // (Ben, 23 Oct, D8) An applied next-workout change lands on Your workout; its chat Undo takes it back off there.
    // `builder` is made below and only called after startup.
    nextWorkout: { revert: (applyActionId, check) => builder.revertCoachLanding(applyActionId, check) },
  });

  /** (Today v2, workout-builder-v3 §2.0) Today's session card from the plan, with the builder's rules. Local only. */
  const todaySession = createTodaySessionService({
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    newId: deps.newId,
    catalogueExercises,
    currentGym: () => yourData.currentGym(),
    typicalEquipment: () => typicalEquipment(),
    coachStatus: async () => (await coach.availability()).status,
    port: { ...loop.todayPort, start: (req) => loop.workout.start(req) },
    // `builderCoach` is made below; these run only when Today asks (after startup).
    nudge: (req) => builderCoach.preSessionNudge(req),
    offerAtOrBelow: () => (deps.checkInSettings?.() ?? DEFAULT_CHECK_IN_SETTINGS).offerAtOrBelow,
  });

  /** Gyms and equipment (Your data): the minimal gym editor. */
  const gymServices = createGymServices({
    repos,
    store: () => deps.manager.store,
    now: deps.now,
    profile: getProfile,
    newId: deps.newId,
    exercise: async (id) => (await repos().exercises.get(id).catch(() => null)) ?? catalogueExercises().find((e) => e.id === id) ?? null,
  });

  /**
   * (ADR 0029) Learning the gym mid-workout: the gym is saved, then today's
   * snapshot takes the change when it moves no target (`Use changes today`
   * with nothing to review); otherwise today keeps the gym as it started and
   * the gym screen's `Use changes today` stays the way in.
   */
  const gyms = {
    ...gymServices,
    async learnInWorkout(req: { sessionId: string; learn: GymLearn; opId: string }): Promise<(GymEditOutcome & { ok: true; refreshed: boolean }) | Extract<GymEditOutcome, { ok: false }>> {
      const r = await gymServices.learn(req.learn);
      if (!r.ok) return r;
      const proposal = await loop.gymSwitch.propose(req.sessionId, r.edit.gymId).catch(() => null);
      if (proposal === null || proposal.card.changesTargets || proposal.draftsToReplace.length > 0) return { ...r, refreshed: false };
      const applied = await loop.gymSwitch.apply(proposal, req.opId).catch(() => null);
      return { ...r, refreshed: applied?.ok === true };
    },
    /**
     * Its Undo: today's refresh first, then the gym. Today's refresh is
     * refused once the workout moved on (a set logged on the new item): the
     * gym is still put back, and the result says today kept it (review S3),
     * never a plain "undone".
     */
    async undoLearnInWorkout(req: { sessionId: string; edit: GymEdit; refreshed: boolean; opId: string }): Promise<{ ok: true; todayKept: boolean } | { ok: false; message: string }> {
      let todayKept = false;
      if (req.refreshed) {
        const today = await loop.gymSwitch.undo(req.sessionId, req.opId).catch(() => null);
        todayKept = today?.ok !== true;
      }
      const gym = await gymServices.undoEdit(req.edit);
      return gym.ok ? { ok: true, todayKept } : gym;
    },
  };

  /**
   * The typical gym `Start` will save when there is no gym yet (audit B4), as
   * equipment in memory only, so the overview previews what Start creates
   * (workout-overview §8 `No gym`). Nothing is written. IDs are derived, so
   * the same preview twice gives the same rows.
   */
  async function typicalEquipment(): Promise<EquipmentInstance[] | null> {
    const profile = await getProfile();
    if (!profile) return null;
    const draft = buildPresetDraft('commercial', profile.preferredUnit);
    let n = 0;
    const made = materialiseGymDraft(
      { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) },
      { name: 'Main gym', ownerId: profile.id, gymId: deriveId(`typical-gym-preview:${profile.id}`), isDefault: true, atUtc: deps.now().utc, newId: () => deriveId(`typical-gym-preview:item:${String((n += 1))}`) },
    );
    return made.ok ? made.equipment : null;
  }

  /**
   * The Workout overview (workout-overview.md): load, Why?, and Start. With no
   * gym, the rows are fitted to the typical gym, and Start saves it (after the
   * stale check) before starting, as Today's Start always has.
   */
  const overview = {
    async load(req: { target: OverviewTarget; gymId: string | null; checkInId?: string | null }) {
      const typical = req.gymId === null ? await typicalEquipment().catch(() => null) : null;
      if (req.gymId === null && typical === null) return null;
      const read = () => loop.overview.load({ ...req, ...(typical ? { typicalEquipment: typical } : {}) });
      // (Ben, 23 Oct, D8) The coach's applied next-workout changes land on Your workout (the builder), not on this
      // retired page's draft.
      return read();
    },
    async explain(req: { target: OverviewTarget; gymId: string | null; checkInId?: string | null; sessionExerciseId: string }) {
      const typical = req.gymId === null ? await typicalEquipment().catch(() => null) : null;
      return loop.overview.explain({ ...req, ...(typical ? { typicalEquipment: typical } : {}) });
    },
    /**
     * `Start workout` on the overview: one session, idempotent by `opId`
     * (minted at the first tap and reused for every retry), checked against
     * `expectedPreviewKey` first (a mismatch creates nothing).
     */
    async start(req: { startOf: OverviewStartOf; gymId: string | null; opId: string; checkIn: SessionCheckIn | null; expectedPreviewKey: string; draft?: { id: string; expectedVersion: number } | null }): Promise<WorkoutStartOutcome> {
      const base = {
        opId: req.opId,
        checkIn: req.checkIn,
        ...(req.startOf.routineOf !== undefined ? { routineOf: req.startOf.routineOf } : req.startOf.coachDraftOf !== undefined ? { coachDraftOf: req.startOf.coachDraftOf } : { nextOf: req.startOf.nextOf }),
        ...(req.draft !== undefined ? { draft: req.draft } : {}),
      };
      if (req.gymId !== null) return loop.workout.start({ ...base, gymId: req.gymId, expectedPreviewKey: req.expectedPreviewKey });
      const profile = await getProfile();
      if (!profile) return { ok: false, error: { code: 'not_found', message: 'Owner profile not found.' } };
      const check = await loop.workout.previewCheck(profile, { ...req, gymId: null });
      if (check.kind === 'stale') return { ok: false, error: { code: 'stale_preview', message: STALE_PREVIEW } };
      const made = await setup.useTypicalGym();
      if (!made.ok || made.gymId === undefined) return { ok: false, error: { code: 'write_failed', message: made.ok ? 'Couldn’t set up a gym. Try again.' : made.message } };
      // The routine, source workout, pain flags and check-in are re-checked inside the start's write.
      return loop.workout.start({ ...base, gymId: made.gymId, ...(check.kind === 'fresh' ? { fence: check.fence } : {}) });
    },

    // Today's edits (overview-today-edits §4.2): with no gym, checked against the typical gym's items, as the page shows.
    async edit(req: Omit<Parameters<typeof loop.overview.edit>[0], 'typicalEquipment'>) {
      return loop.overview.edit({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async editBatch(req: Omit<Parameters<typeof loop.overview.editBatch>[0], 'typicalEquipment'>) {
      return loop.overview.editBatch({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async move(req: Omit<Parameters<typeof loop.overview.move>[0], 'typicalEquipment'>) {
      return loop.overview.move({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async undoEdit(req: Omit<Parameters<typeof loop.overview.undoEdit>[0], 'typicalEquipment'>) {
      return loop.overview.undoEdit({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async resetEdits(req: Omit<Parameters<typeof loop.overview.resetEdits>[0], 'typicalEquipment'>) {
      return loop.overview.resetEdits({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async resetOrder(req: Omit<Parameters<typeof loop.overview.resetOrder>[0], 'typicalEquipment'>) {
      return loop.overview.resetOrder({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async clearSwap(req: Omit<Parameters<typeof loop.overview.clearSwap>[0], 'typicalEquipment'>) {
      return loop.overview.clearSwap({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async restoreEdits(req: Omit<Parameters<typeof loop.overview.restoreEdits>[0], 'typicalEquipment'>) {
      return loop.overview.restoreEdits({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async swapCandidates(req: Omit<Parameters<typeof loop.overview.swapCandidates>[0], 'typicalEquipment'>) {
      return loop.overview.swapCandidates({ ...req, ...(await typicalFor(req.gymId)) });
    },
    // Full edit before start (overview-today-edits §11).
    async clearEdit(req: Omit<Parameters<typeof loop.overview.clearEdit>[0], 'typicalEquipment'>) {
      return loop.overview.clearEdit({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async addCandidates(req: Omit<Parameters<typeof loop.overview.addCandidates>[0], 'typicalEquipment'>) {
      return loop.overview.addCandidates({ ...req, ...(await typicalFor(req.gymId)) });
    },
    loadKeypad: (req: Parameters<typeof loop.overview.loadKeypad>[0]) => loop.overview.loadKeypad(req),
    // Fit to time (fit-to-time.md): the built-in trim and `Clear fit`, offline.
    async trimToFit(req: Omit<Parameters<typeof loop.overview.trimToFit>[0], 'typicalEquipment'>) {
      return loop.overview.trimToFit({ ...req, ...(await typicalFor(req.gymId)) });
    },
    async clearFit(req: Omit<Parameters<typeof loop.overview.clearFit>[0], 'typicalEquipment'>) {
      return loop.overview.clearFit({ ...req, ...(await typicalFor(req.gymId)) });
    },
    // The coach's fit (fit-to-time §5): only when Ben taps `Ask coach`; applied at once with Undo (rule 3).
    async requestCoachFit(req: Omit<Parameters<typeof loop.overview.requestCoachFit>[0], 'typicalEquipment'>) {
      return loop.overview.requestCoachFit({ ...req, ...(await typicalFor(req.gymId)) });
    },
    undoCoachFit: (req: Parameters<typeof loop.overview.undoCoachFit>[0]) => loop.overview.undoCoachFit(req),
    /** Whether `Ask coach` can be tapped (connected and not offline): reads settings only, no network. */
    async coachFitAvailable(): Promise<boolean> {
      return (await coach.availability().catch(() => null))?.status === 'ok';
    },
  };

  /** Workouts: `Update Push A` plans from the same page, so with no gym it is checked against the typical gym's items too. */
  const routines = {
    ...loop.routines,
    async applyTodayEdits(req: Omit<Parameters<typeof loop.routines.applyTodayEdits>[0], 'typicalEquipment'>) {
      return loop.routines.applyTodayEdits({ ...req, ...(await typicalFor(req.gymId)) });
    },
  };

  /** Coach-built drafts (workout-builder §4.2): the card plans on the typical gym too when there is none yet. */
  const coachDrafts = {
    ...loop.coachDrafts,
    async card(req: Omit<Parameters<typeof loop.coachDrafts.card>[0], 'typicalEquipment'>) {
      return loop.coachDrafts.card({ ...req, ...(await typicalFor(req.gymId)) });
    },
    /** Whether a build can start (§5.4): reads the connection settings only, never the network or the model. */
    buildBlock: () => coach.buildBlock(),
  };

  async function typicalFor(gymId: string | null): Promise<{ typicalEquipment?: EquipmentInstance[] }> {
    if (gymId !== null) return {};
    const typical = await typicalEquipment().catch(() => null);
    return typical === null ? {} : { typicalEquipment: typical };
  }

  /** FitNotes import (Your data): preview, answers, commit, Undo import, past imports. */
  const imports = createImportService({
    store: () => deps.manager.store,
    now: deps.now,
    newId: deps.newId,
    profile: getProfile,
    activeWorkout: () => sessions.active(),
    backUpOnPhone: async (reason) => {
      const r = await backups.backUpOnPhone(reason);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    // Read at commit time, after both services exist.
    layoutVersionOf: (layoutId) => importLayouts.layoutVersionOf(layoutId),
    layoutCommitting: (layoutId) => importLayouts.layoutCommitting(layoutId),
  });

  /**
   * Import from any app (data-import-export §9, ADR 0026): detection, the
   * layout request on the coach's own ChatGPT-plan port and status (no other
   * route), Check the layout, saved layouts. Commits go through `imports`.
   */
  const importLayouts = createLayoutService({
    store: () => deps.manager.store,
    now: deps.now,
    newId: deps.newId,
    profile: getProfile,
    activeWorkout: () => sessions.active(),
    imports,
    coach: { availability: () => coach.availability(), ...(deps.coach === undefined ? {} : { model: deps.coach.model }) },
  });

  /** Progress (progress.md slice A): windows, sessions, time, muscles, records, calendar, `Count it`. Local only. */
  const progress = createProgressService({
    store: () => deps.manager.store,
    now: deps.now,
    profile: getProfile,
    saveSettings: (merge) =>
      updateProfile((current) => {
        const progress = merge(current.progress);
        return progress === null ? null : { progress };
      }),
    catalogueExercises,
    catalogueImplements,
    dispatch: (sessionId, command) => sessions.dispatch(sessionId, command),
    ...(deps.idle === undefined ? {} : { idle: deps.idle }),
    mainLiftIds: () => training.mainLiftIds(),
    // (Ben, 26 Oct) Overview's `Edit` picks lead the Lifts chips: one list of tracked lifts.
    progressLifts: async () => {
      const p = await getProfile();
      if (p === null) return [];
      return (await repos().trainingProfiles.get(p.id))?.progressLifts ?? [];
    },
    // The monthly recap's plan line (Ben, 26 Oct): the consistency card's weeks, with a plan in use.
    planWeeks: async () => {
      const c = await plans.consistency();
      return c === null || c.planThisWeek === null ? null : [...c.weeks, c.thisWeek].map((w) => ({ monday: w.monday, atAim: w.atAim }));
    },
    // (Ben, 26 Oct; one definition of best) Records are the tracked lifts' `New best`s, read as the Summary reads them.
    newBests: () => reviews.newBestRecords(),
    // Progress › Lifts' chips (Ben, 26 Oct): the plan in use's main lift per day, in day order; null with no plan.
    planMainLifts: async () => {
      const p = await getProfile();
      if (p === null) return null;
      const plan = await repos().planDrafts.applied(p.id);
      if (plan === null) return null;
      const days = planRoutines(plan, await repos().routines.listByOwner(p.id));
      return days.flatMap((r) => {
        const main = r.planDay?.mainLiftExerciseId ?? r.exercises.find((e) => e.main === true)?.exerciseId ?? null;
        return main === null ? [] : [main];
      });
    },
  });

  /** Coach-built plans (19 Oct): the card, Apply and Undo, the consistency card. Local only. */
  const plans = createPlanServices({
    weekInfo: async () => ({ lines: await weekly.activities.weekLines(), change: await weekly.week.change() }),
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    catalogueExercises,
    currentGym: async () => {
      const g = await yourData.currentGym();
      return g === null ? null : { id: g.id, name: g.name };
    },
    upNextRoutineId: async (gymId) => (await loop.next.preview(gymId ?? 'typical-gym-preview'))?.routine?.id ?? null,
    plannedDay: (routineId, gymId) => loop.routines.planned(routineId, gymId),
    splitMainLiftIds: () => training.splitMainLiftIds(),
  });

  /** (Plan builder, 23 Oct) Gym goals → Your week → Your plan, offline: the deterministic engine, Apply / Undo through `plans`. */
  const planBuilder = createPlanBuilderService({
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    catalogueExercises,
    currentGym: async () => {
      const g = await yourData.currentGym();
      return g === null ? null : { id: g.id, name: g.name };
    },
    plans,
  });

  /** Library › Exercises (exercise-library §9): browse, detail, Add to a workout. Local only. */
  const library = createLibraryService({
    repos,
    now: deps.now,
    newId: deps.newId,
    profile: getProfile,
    currentGym: () => yourData.currentGym(),
    catalogueExercises,
    catalogueAliases,
    history: () => progress.libraryHistory(),
    progressDetail: async (exerciseId) => (await progress.exerciseDetail({ exerciseId }))?.view ?? null,
    addToSession: (req) => loop.workout.addExercise(req),
    dispatch: (sessionId, command) => sessions.dispatch(sessionId, command),
    updateRoutine: async (req) => {
      const r = await loop.routines.update(req);
      return r.ok ? { ok: true, routine: r.routine, actionId: r.actionId } : { ok: false, reason: r.reason, message: r.message };
    },
    revertRoutine: async (req) => {
      const r = await loop.routines.revert(req);
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    routineRows: () => loop.routines.list(),
  });

  /** (Ben, 25 Oct) The Swap / Add sheet's full list: every exercise, read once per open; search is pure over it. */
  const exercisePicker = createExercisePickerService({ repos, now: deps.now, profile: getProfile, catalogueExercises, catalogueAliases });

  /** Deleting past workouts: delete, Undo, Recently deleted, Restore, purge (delete-workouts.md). */
  const history = createHistoryServices({
    repos,
    now: deps.now,
    profile: getProfile,
    describe: (a, gyms) => loop.repeat.describe(a, gyms),
    describeMany: (ws, gyms) => loop.repeat.describeMany(ws, gyms),
    activeWorkout: () => sessions.active(),
  });

  /** Export, Delete my data and Reset coaching knowledge, by data domain (rule 10). */
  const data = createDataDomainService({
    manager: deps.manager,
    backups,
    ledger: deps.dataLedger ?? memoryTextFile(),
    now: deps.now,
    app: deps.app,
    bundledKnowledge: (atUtc) => starterExercises(atUtc),
    ...(deps.credentials ? { credentials: deps.credentials } : {}),
    ...(deps.personalFiles ? { personalFiles: deps.personalFiles } : {}),
    ...(deps.restAlerts ? { restAlerts: deps.restAlerts } : {}),
    activeWorkout: () => sessions.active(),
    ...(deps.signOutTimeoutMs === undefined ? {} : { signOutTimeoutMs: deps.signOutTimeoutMs }),
  });

  /** (Workout builder v3) Set up → Your workout drafts over the builder rules; Start goes through the workout Start. */
  const builderEnv = createBuilderEnv({ store: () => deps.manager.store, now: deps.now, catalogueExercises });
  const builder = createBuilderService({
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    env: builderEnv,
    training: async () => {
      const p = await getProfile();
      return p === null ? null : repos().trainingProfiles.get(p.id).catch(() => null);
    },
    currentGym: () => yourData.currentGym(),
    start: (req) => loop.workout.start(req),
    upNextRoutineId: (gymId) => loop.todayPort.upNextRoutineId(gymId),
    upNext: (gymId) => loop.todayPort.upNext(gymId ?? 'typical-gym-preview'),
    sessionTitle: (sessionId) => loop.todayPort.sessionTitle(sessionId),
    planned: async (target, gymId) => {
      const typical = gymId === null ? await typicalEquipment().catch(() => null) : null;
      if (gymId === null && typical === null) return null;
      return loop.builderSources.planned({ target, gymId, ...(typical ? { typicalEquipment: typical } : {}) });
    },
    ensureGym: async () => {
      const made = await setup.useTypicalGym();
      return made.ok && made.gymId !== undefined ? made.gymId : null;
    },
    // (Ben, 23 Oct, D8) The coach's next-workout changes Ben applied in chat land here, with Undo.
    coachApplies: (basis) => coach.appliedStructural(basis),
    coachRefused: (checked, refused) => {
      coach.noteStructuralRefused(checked, refused);
    },
    coachUndone: (applyActionId) => coach.noteNextWorkoutChangeUndone(applyActionId),
    // (D3 §2.3a) Today's options on Your workout load Today's own draft for the choice (one draft and fit code).
    todayDraft: (req) => todaySession.draftFor(req),
    // (Ben, 23 Oct) `↻ Mix it up` on Your workout reads the same Mix it up facts Today's card did.
    todayMix: (key) => todaySession.mixFactsFor(key),
    // (V5) Main lift on Your workout for a no-plan Today draft: the split day's (or Other session's) main lifts here.
    todayMainLifts: (key) => todaySession.mainLiftsFor(key),
    // (Ben, 23 Oct) The carry-over routes the sets Time cut to each muscle's next plan day.
    carryDays: (key) => todaySession.carryDaysFor(key),
    // (Ben, 23 Oct) Carried sets land on a plan day opened from the Library too, not only on Today's card.
    carryFor: (day) => todaySession.carryItemsFor(day),
  });

  /**
   * (Ben, 23 Oct, D8) Today with a change Ben applied in chat for his next workout: it lands on that workout's Your
   * workout draft before the card or Up next shows, so Today shows it (`· edited`) and its one-tap Start starts it.
   * Only when one is waiting (coach records, local); then Today reads again. Nothing else on Today writes on load.
   */
  async function landCoachOnToday(d: TodaySessionData): Promise<boolean> {
    const pending = await coach.pendingNextWorkoutChanges().catch(() => []);
    if (pending.length === 0) return false;
    const routines = new Set(pending.flatMap((b) => (b.kind === 'routine' ? [b.routineId] : [])));
    const sessionsFrom = new Set(pending.flatMap((b) => (b.kind === 'next' ? [b.sourceSessionId] : [])));
    let landed = false;
    for (const day of d.days) {
      for (const t of day.templates) {
        const controls = d.initial[day.key];
        if (t.routineId === null || !routines.has(t.routineId) || controls === undefined) continue;
        const c = await todaySession.commit(d, { dayKey: day.key, controls: { ...controls, mainLiftExerciseId: t.mainLiftExerciseId } }, deriveId(`coach-land-today:${d.localDate}:${day.key}:${t.routineId}`)).catch(() => null);
        if (c === null || !c.ok) continue;
        if ((await builder.landCoachChanges(c.draftId).catch(() => null))?.status === 'written') landed = true;
      }
    }
    const up = d.upNext;
    if (up !== null && ((up.routineId !== null && routines.has(up.routineId)) || (up.sourceSessionId !== null && sessionsFrom.has(up.sourceSessionId)))) {
      const target = up.routineId !== null ? { kind: 'routine' as const, routineId: up.routineId } : { kind: 'session' as const, sourceSessionId: up.sourceSessionId ?? '' };
      const r = await builder.openTarget(target, deriveId(`coach-land-today:${d.localDate}:up-next:${up.routineId ?? up.sourceSessionId ?? ''}`)).catch(() => null);
      if (r?.status === 'written') landed = true;
    }
    return landed;
  }
  const todayWithCoach: typeof todaySession = {
    ...todaySession,
    async load() {
      const d = await todaySession.load();
      if (d === null || !(await landCoachOnToday(d).catch(() => false))) return d;
      return todaySession.load();
    },
  };

  /**
   * (Workout builder v3 §2.6, §2.9, §5, §6.1) The builder's coach: Set up words, Your workout proposals,
   * Coach review and the pre-session nudge, reading and writing through the builder (`coach-ports`). Nothing
   * in Set up, Your workout, Today or logging waits for it (rule 1). Its review is registered for the builder's
   * Coach review sheet here, at app start.
   */
  const builderPorts = createBuilderCoachPorts(builder);
  const ownerIdOf = async (): Promise<string> => {
    const p = await getProfile();
    if (p === null) throw new Error('Owner profile not found');
    return p.id;
  };
  const builderCoach = createBuilderCoachService({
    availability: () => coach.availability(),
    ...(deps.coach === undefined ? {} : { model: deps.coach.model }),
    now: deps.now,
    newId: deps.newId,
    ownerId: ownerIdOf,
    source: builderPorts.source,
    writer: builderPorts.writer,
    reviews: {
      current: async (subject) => repos().reviews.current(await ownerIdOf(), subject),
      record: async (review) => repos().reviews.record(await ownerIdOf(), review),
      update: async (next, expectedVersion, opId) => repos().reviews.update(await ownerIdOf(), next, expectedVersion, opId),
    },
    dayNotes: createDayNotes({ store: () => repos().coach, ownerId: ownerIdOf, now: deps.now }),
    // (Ben, 23 Oct; §2.9) Coach review's own Your data: lift targets only while they're on, and today's check-in.
    reviewExtras: async () => {
      const p = await getProfile();
      const at = deps.now();
      const nowMs = toMs(at.utc);
      const today = localDateOf(nowMs, p?.timezone ?? at.tz);
      const on = await liftTargets.on().catch(() => false);
      const views = on ? await liftTargets.coachViews().catch(() => []) : [];
      const checkIns = p === null ? [] : await repos().checkIns.listSince(p.id, toIso(nowMs - 2 * 24 * 60 * 60 * 1000)).catch(() => []);
      const c = checkIns.filter((x) => x.deletedAtUtc === undefined && x.localDate === today).sort((a, b) => toMs(b.recordedAt.utc) - toMs(a.recordedAt.utc))[0];
      return {
        liftTargets: views.map((v) => ({ exerciseId: v.exerciseId, value: v.load.value, unit: v.load.unit, convention: v.load.convention, reps: v.reps, by: v.by })),
        checkIn: c === undefined ? null : { score: c.score, reasons: c.reasons },
      };
    },
  });
  setBuilderReviewProvider(createBuilderReviewProvider(builderCoach, builderPorts.review, { newId: deps.newId }));

  /**
   * (Workout builder v3 §6.1, §6.2) The weekly auto-review and Progress › Reviews: code's facts always,
   * the coach's verdict and plan tweaks when reachable (the plan route only, rule 7). Runs on app open.
   */
  const reviews = createWeeklyReviewService({
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    newId: deps.newId,
    availability: () => coach.availability(),
    ...(deps.coach === undefined ? {} : { model: deps.coach.model }),
    catalogueExercises,
    mainLiftIds: () => training.splitMainLiftIds(),
  });

  /**
   * (workout-table-v3 §7) Same editing as the builder mid-workout: its Swap / Add sheet and load sources,
   * `Why this weight?` and advice, over the workout's own versioned commands (today only).
   */
  const workoutEdit = createWorkoutEditService({ store: () => deps.manager.store, profile: getProfile, env: builderEnv, workout: loop.workout });

  /** (Ben, 27 Oct; ADR 0035) Apple Health: switches, writes after Finish and edits, reads, links. Local only. */
  const health = createHealthService({
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    newId: deps.newId,
    port: deps.health?.port ?? null,
    buildIncludesHealth: deps.health?.buildIncludesHealth ?? false,
    workoutOpen: async () => (await sessions.active()) !== null,
  });

  return {
    ...loop,
    builder,
    builderCoach,
    reviews,
    workoutEdit,
    exercisePicker,
    library,
    customExercises,
    history,
    todaySession: todayWithCoach,
    overview,
    routines,
    coachDrafts,
    plans,
    planBuilder,
    /** (Ben, 20 Oct) Runs, rides, swims and sport: add, edit, delete, Undo; Recent and calendar rows. */
    activities: weekly.activities,
    /** (Ben, 20 Oct) This week's shape: the coach's proposal card, Apply, Undo. */
    week: weekly.week,
    progress,
    data,
    coach,
    training,
    health,
    liftTargets,
    gyms,
    imports,
    importLayouts,
    yourData,
    coachingKnowledge,
    setup,
    sessions,
    backups,
    restore,
    integrity,
    developer,
    /** Close the database (tests, and before a future restore/delete). */
    close: () => deps.manager.close(),
    now: deps.now,
    newId: deps.newId,
  };
}

export type AppServices = ReturnType<typeof createAppServices>;

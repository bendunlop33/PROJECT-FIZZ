import { createCustomExercises } from './custom-exercises';
import {
  buildPresetDraft,
  createSessionService,
  deriveId,
  discardCommand,
  LEGACY_STARTER_IDS,
  liveEdits,
  dismissedCoachEditOpIds,
  structuralApplyOf,
  structuralDraftPlan,
  listGymPresets,
  materialiseGymDraft,
  starterExercises,
  toMs,
  type GymDraft,
  type GymPresetId,
  type CommandOutcome,
  type DiscardConfirmation,
  type RecoveryResult,
  type StartOutcome,
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
import type { DraftBasis, EquipmentInstance, Exercise, Gym, SessionAggregate, SessionCheckIn, SessionCommand, UserProfile, WeightUnit, ZonedTimestamp } from '@fizz/schemas';

import type { CoachModelPort } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import type { RestAlertController } from '../alerts/rest-alerts';
import { createCoachService } from '../coach/coach-service';
import { createBackupService, type BackupFileStore, type TextFile } from '../backup/backup-service';
import { createRestoreService } from '../backup/restore-service';
import { createDataDomainService, type CredentialPort, type PersonalFilesPort } from '../backup/data-domain-service';
import { createImportService } from '../import/import-service';
import { createLayoutService } from '../import/layout-service';
import { createGymServices } from './gym-services';
import { createLibraryService } from './library-service';
import { createProgressService } from './progress-service';
import { createTrainingService } from './training-service';
import { createPlanServices } from './plan-services';
import { createHistoryServices } from './history-services';
import { createWorkoutServices, STALE_PREVIEW, startBasisOf, type OverviewStartOf, type OverviewTarget, type SessionList, type WorkoutStartOutcome } from './workout-services';
import { bumpProfile, newProfile, setupStep, unitLockedText, type SetupStep } from './setup';

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
    async saveGym(req: { gymId: string; name: string; draft: GymDraft | null }): Promise<SetupWriteResult> {
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

  const domainSessions = () => createSessionService(repos(), deps.newId);

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
    /** `Check all data` (system-states §3.7). Reads only; never repairs. */
    async checkAll(): Promise<IntegrityCheck> {
      const at = deps.now();
      lastIntegrity = { atUtc: at.utc, tz: at.tz, report: await checkIntegrity(deps.manager.store.db, undefined, timeSlicer()) };
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

  /** The coach (ADR 0020 C6–C8): threads, turns, Undo, the summary turn, next-session targets. */
  const coach = createCoachService({
    training: () => training.coachInput(),
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    newId: deps.newId,
    ...(deps.coach === undefined ? {} : { model: deps.coach.model, connection: deps.coach.connection }),
    builtInNextTargets: (sessionId) => loop.workout.builtInNextTargets(sessionId),
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
  });

  /** Gyms and equipment (Your data): the minimal gym editor. */
  const gyms = createGymServices({ repos, store: () => deps.manager.store, now: deps.now, profile: getProfile });

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
   * Structural changes Ben applied from a coach card (ADR 0020 §3) are
   * written into the next workout's pre-start draft as his own `Swap today`,
   * `Skip today` and order edits (ADR 0022), so the overview shows them with
   * its own Undo and `Change Push A too ›` (the only route to a template
   * change), and Start uses them like any edit. One op ID per apply and
   * change: a second load writes nothing, and an edit Ben took back on an
   * earlier day's overview isn't written again (review S5). An edit the
   * draft's own checks refuse here (not doable at this gym, or no place for
   * it in the plan) is left out and reported (review S1): the card reads
   * `Couldn't apply here` and the overview says so once. An Apply's changes
   * are written together or not at all (review B2). A refused Apply is
   * tried again on later loads (at a gym that can do it, or once the plan
   * has room); when one lands like that, the overview says so once
   * (`Coach change applied`, merge r2 S2), so it never appears unannounced.
   */
  async function applyCoachChanges(target: OverviewTarget, gymId: string | null, startOf: OverviewStartOf, draftVersion: number | null): Promise<{ wrote: boolean; refused: number; landedLate: number }> {
    const none = { wrote: false, refused: 0, landedLate: 0 };
    const basis: DraftBasis = startBasisOf(startOf);
    const applies = await coach.appliedStructural(basis);
    if (applies.length === 0) return none;
    const p = await getProfile();
    const draft = p === null ? null : await repos().drafts.open(p.id, basis).catch(() => null);
    const earlier = p === null ? [] : await repos().drafts.listForBasis(p.id, basis).catch(() => []);
    const plan = structuralDraftPlan({ applies, draftOpIds: draft?.opIds ?? null, liveEdits: draft === null ? [] : liveEdits(draft.edits), dismissedOpIds: dismissedCoachEditOpIds(earlier) });
    const refusedApplies = new Set<string>();
    const landedLate = new Set<string>();
    let version = draftVersion;
    let wrote = false;
    // One draft write per Apply (review B2): all of its changes are written, or none, so a card never stands half-applied.
    const byApply = new Map<string, typeof plan.write>();
    for (const w of plan.write) {
      const applyId = structuralApplyOf(w.opId) ?? w.opId;
      byApply.set(applyId, [...(byApply.get(applyId) ?? []), w]);
    }
    for (const [applyId, writes] of byApply) {
      const r = await overview.editBatch({ target, gymId, expectedDraftVersion: version, edits: writes });
      if (r.ok) {
        version = r.draft?.version ?? version;
        wrote = wrote || !r.duplicate;
        if (!r.duplicate && coach.wasStructuralRefused(applyId)) landedLate.add(applyId);
      } else if (r.reason === 'invalid') refusedApplies.add(applyId);
    }
    for (const editId of plan.remove) {
      const r = await overview.undoEdit({ target, gymId, expectedDraftVersion: version, opId: `coach-undo:${editId}`, editId });
      if (r.ok) {
        version = r.draft?.version ?? version;
        wrote = true;
      }
    }
    coach.noteStructuralRefused(
      applies.map((a) => a.applyActionId),
      [...refusedApplies],
    );
    return { wrote, refused: refusedApplies.size, landedLate: landedLate.size };
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
      const data = await read();
      if (data === null) return null;
      // Coach changes Ben applied for this workout (ADR 0020 §3) become today's edits, once; an undone one is taken back.
      const coachChanges = await applyCoachChanges(req.target, req.gymId, data.startOf, data.draft?.version ?? null).catch(() => ({ wrote: false, refused: 0, landedLate: 0 }));
      const page = coachChanges.wrote ? await read() : data;
      // A coach change the overview's own checks refused here (review S1), or one refused earlier that landed now (merge r2 S2): the page says so once.
      return page === null ? null : { ...page, coachRefused: coachChanges.refused, coachLanded: coachChanges.landedLate };
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
    dispatch: (sessionId, command) => sessions.dispatch(sessionId, command),
    ...(deps.idle === undefined ? {} : { idle: deps.idle }),
  });

  /** Coach-built plans (19 Oct): the card, Apply and Undo, the consistency card. Local only. */
  const plans = createPlanServices({
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

  /** Deleting past workouts: delete, Undo, Recently deleted, Restore, purge (delete-workouts.md). */
  const history = createHistoryServices({
    repos,
    now: deps.now,
    profile: getProfile,
    describe: (a, gyms) => loop.repeat.describe(a, gyms),
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

  return {
    ...loop,
    library,
    customExercises,
    history,
    overview,
    routines,
    coachDrafts,
    plans,
    progress,
    data,
    coach,
    training,
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

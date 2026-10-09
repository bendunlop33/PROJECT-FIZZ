import {
  buildPresetDraft,
  createSessionService,
  LEGACY_STARTER_IDS,
  listGymPresets,
  materialiseGymDraft,
  starterExercises,
  toMs,
  type GymDraft,
  type GymPresetId,
  type CommandOutcome,
  type RecoveryResult,
  type StartOutcome,
} from '@fizz/domain';
import {
  checkIntegrity,
  EXERCISE_SPEC,
  listDocuments,
  PROFILE_SPEC,
  saveDocumentIn,
  type AppInfo,
  type DatabaseManager,
  type IntegrityReport,
  type RecordCounts,
  type SqliteRepositories,
} from '@fizz/persistence';
import type { EquipmentInstance, Exercise, Gym, SessionAggregate, SessionCommand, UserProfile, WeightUnit, ZonedTimestamp } from '@fizz/schemas';

import type { RestAlertController } from '../alerts/rest-alerts';
import { createBackupService, type BackupFileStore, type TextFile } from '../backup/backup-service';
import { createRestoreService } from '../backup/restore-service';
import { createImportService } from '../import/import-service';
import { createGymServices } from './gym-services';
import { createWorkoutServices } from './workout-services';
import { bumpProfile, newProfile, setupStep, type SetupStep } from './setup';

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
}

export type SetupState = { step: SetupStep; profile: UserProfile | null; gyms: Gym[] };

export type SetupWriteResult = { ok: true } | { ok: false; message: string };

export type IntegrityCheck = { atUtc: string; tz: string; report: IntegrityReport } | null;

const WRITE_FAILED = 'Couldn’t save this. Nothing was changed; try again.';

export function createAppServices(deps: AppServicesDeps) {
  const repos = (): SqliteRepositories => deps.manager.store.repos;
  const backups = createBackupService({
    store: () => deps.manager.store,
    files: deps.backupFiles,
    manifest: deps.backupManifest,
    now: deps.now,
    app: deps.app,
    ...(deps.locale === undefined ? {} : { locale: deps.locale }),
  });
  let lastIntegrity: IntegrityCheck = null;

  /** The single owner's profile (single-user app; the profile ID is the stable owner ID). */
  async function getProfile(): Promise<UserProfile | null> {
    const all = await deps.manager.store.db.read((q) => listDocuments(q, PROFILE_SPEC));
    return [...all].sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? -1 : 1))[0] ?? null;
  }

  async function updateProfile(patch: Parameters<typeof bumpProfile>[1]): Promise<SetupWriteResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await getProfile();
      if (!current) return { ok: false, message: 'Your profile wasn’t found. Start setup again.' };
      const saved = await repos().profiles.save(bumpProfile(current, patch, deps.now().utc), current.version);
      if (saved.ok) return { ok: true };
    }
    return { ok: false, message: WRITE_FAILED };
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
      return existing.preferredUnit === unit ? { ok: true } : updateProfile({ preferredUnit: unit });
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
        return { ok: false, message: 'A gym is already saved. You can edit it later in the gym editor.' };
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
    discard: (s: SessionAggregate, opId: string): Promise<CommandOutcome> =>
      sessions.dispatch(s.session.id, { type: 'discard', at: deps.now(), opId, expectedVersion: s.session.version }),
  };

  const integrity = {
    /** `Check all data` (system-states §3.7). Reads only; never repairs. */
    async checkAll(): Promise<IntegrityCheck> {
      const at = deps.now();
      lastIntegrity = { atUtc: at.utc, tz: at.tz, report: await checkIntegrity(deps.manager.store.db) };
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

  const loop = createWorkoutServices({
    repos,
    store: () => deps.manager.store,
    now: deps.now,
    newId: deps.newId,
    profile: getProfile,
    afterCommand,
  });

  /** Gyms and equipment (Your data): the minimal gym editor. */
  const gyms = createGymServices({ repos, now: deps.now, profile: getProfile });

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
  });

  return {
    ...loop,
    gyms,
    imports,
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

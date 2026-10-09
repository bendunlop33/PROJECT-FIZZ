import {
  buildPresetDraft,
  createSessionService,
  listGymPresets,
  materialiseGymDraft,
  type GymDraft,
  type GymPresetId,
  type CommandOutcome,
  type RecoveryResult,
  type StartOutcome,
} from '@fizz/domain';
import {
  checkIntegrity,
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

import { createBackupService, type BackupFileStore, type TextFile } from '../backup/backup-service';
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

    /** Ready → `Go to Today`. */
    async complete(): Promise<SetupWriteResult> {
      const profile = await getProfile();
      if (!profile) return { ok: false, message: 'Your profile wasn’t found. Start setup again.' };
      if (profile.setup === undefined || profile.setup.completedAtUtc !== undefined) return { ok: true };
      return updateProfile({ setup: { ...profile.setup, completedAtUtc: deps.now().utc } });
    },
  };

  /** After any command: a finished workout triggers an on-phone backup, without waiting for it. */
  function afterCommand(outcome: CommandOutcome): CommandOutcome {
    if (outcome.ok && !outcome.duplicate && outcome.events.some((e) => e.type === 'SessionFinished')) {
      void backups.backUpOnPhone('workout_finished');
    }
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

  return {
    yourData,
    coachingKnowledge,
    setup,
    sessions,
    backups,
    integrity,
    developer,
    /** Close the database (tests, and before a future restore/delete). */
    close: () => deps.manager.close(),
    now: deps.now,
    newId: deps.newId,
  };
}

export type AppServices = ReturnType<typeof createAppServices>;

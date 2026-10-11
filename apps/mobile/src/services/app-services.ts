import {
  buildPresetDraft,
  createSessionService,
  deriveId,
  discardCommand,
  LEGACY_STARTER_IDS,
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
import type { EquipmentInstance, Exercise, Gym, SessionAggregate, SessionCheckIn, SessionCommand, UserProfile, WeightUnit, ZonedTimestamp } from '@fizz/schemas';

import type { CoachModelPort } from '@fizz/coach';
import type { TextCoachState } from '@fizz/providers';

import type { RestAlertController } from '../alerts/rest-alerts';
import { createCoachService } from '../coach/coach-service';
import { createBackupService, type BackupFileStore, type TextFile } from '../backup/backup-service';
import { createRestoreService } from '../backup/restore-service';
import { createDataDomainService, type CredentialPort, type PersonalFilesPort } from '../backup/data-domain-service';
import { createImportService } from '../import/import-service';
import { createGymServices } from './gym-services';
import { createHistoryServices } from './history-services';
import { createWorkoutServices, STALE_PREVIEW, type OverviewStartOf, type OverviewTarget, type WorkoutStartOutcome } from './workout-services';
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
        return row.ok && row.exercise.measurement === 'reps' ? [row.exercise] : [];
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

  const loop = createWorkoutServices({
    repos,
    store: () => deps.manager.store,
    now: deps.now,
    newId: deps.newId,
    profile: getProfile,
    afterCommand,
    catalogueExercises,
    catalogueSubstitutions,
  });

  /** The coach (ADR 0020 C6–C8): threads, turns, Undo, the summary turn, next-session targets. */
  const coach = createCoachService({
    store: () => deps.manager.store,
    profile: getProfile,
    now: deps.now,
    newId: deps.newId,
    ...(deps.coach === undefined ? {} : { model: deps.coach.model, connection: deps.coach.connection }),
    builtInNextTargets: (sessionId) => loop.workout.builtInNextTargets(sessionId),
    onSessionChanged: (a) => {
      if (deps.restAlerts) void deps.restAlerts.reconcile(a, toMs(deps.now().utc));
    },
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
   * The Workout overview (workout-overview.md): load, Why?, and Start. With no
   * gym, the rows are fitted to the typical gym, and Start saves it (after the
   * stale check) before starting, as Today's Start always has.
   */
  const overview = {
    async load(req: { target: OverviewTarget; gymId: string | null; checkInId?: string | null }) {
      const typical = req.gymId === null ? await typicalEquipment().catch(() => null) : null;
      if (req.gymId === null && typical === null) return null;
      return loop.overview.load({ ...req, ...(typical ? { typicalEquipment: typical } : {}) });
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
        ...(req.startOf.routineOf !== undefined ? { routineOf: req.startOf.routineOf } : { nextOf: req.startOf.nextOf }),
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
    history,
    overview,
    data,
    coach,
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

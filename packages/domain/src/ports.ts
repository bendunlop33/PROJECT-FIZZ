import type {
  EquipmentInstance,
  Exercise,
  Gym,
  ProgressionRule,
  Routine,
  SessionAggregate,
  UserProfile,
} from '@fizz/schemas';

/**
 * Storage ports. The domain depends only on these interfaces; the SQLite
 * adapter (apps/mobile, later) implements them with one exclusive transaction
 * per call and a single serialized write queue (research §2.1).
 */

export type SaveResult =
  | { ok: true; version: number }
  | { ok: false; error: 'conflict'; currentVersion: number | null };

/** Records with a `version` use optimistic concurrency: save succeeds only if the stored version matches. */
export interface VersionedRepository<T extends { id: string; version: number }> {
  get(id: string): Promise<T | null>;
  /** `expectedVersion` null = create; fails if the record already exists. */
  save(record: T, expectedVersion: number | null): Promise<SaveResult>;
}

export interface ProfileRepository {
  get(ownerId: string): Promise<UserProfile | null>;
  save(profile: UserProfile, expectedVersion: number | null): Promise<SaveResult>;
}

export interface GymRepository extends VersionedRepository<Gym> {
  listByOwner(ownerId: string): Promise<Gym[]>;
}

export interface EquipmentRepository extends VersionedRepository<EquipmentInstance> {
  listByGym(gymId: string): Promise<EquipmentInstance[]>;
}

export interface ExerciseRepository extends VersionedRepository<Exercise> {
  list(): Promise<Exercise[]>;
}

export interface RoutineRepository extends VersionedRepository<Routine> {
  listByOwner(ownerId: string): Promise<Routine[]>;
}

export type ProgressionRuleRepository = VersionedRepository<ProgressionRule>;

/**
 * The session aggregate is saved as one unit (session row, sets, timer,
 * audit, processed operations) so a set result and its rest timer commit
 * together or not at all. Concurrency uses the aggregate `revision`.
 */
export interface SessionRepository {
  get(sessionId: string): Promise<SessionAggregate | null>;
  /** The unfinished session for this owner, if any (at most one). */
  getActive(ownerId: string): Promise<SessionAggregate | null>;
  /** Lookup by the operation ID that started the session (idempotent start). */
  findByStartOperation(ownerId: string, opId: string): Promise<SessionAggregate | null>;
  /**
   * `expectedRevision` null = create. `fence`: rows the new state was planned
   * from, re-checked inside the same transaction; a mismatch writes nothing
   * and returns `stale_inputs` (workout-overview §7, rule 5).
   */
  save(aggregate: SessionAggregate, expectedRevision: number | null, fence?: WriteFence): Promise<SaveResult | FencedResult>;
}

/** Tables a `WriteFence` can pin a row of. `sessions` pins the aggregate `revision`; `pre_start_drafts` pins an open draft (ADR 0022). */
export type FenceTable = 'routines' | 'sessions' | 'check_ins' | 'profiles' | 'pre_start_drafts' | 'workout_drafts';

/**
 * What a planned write was planned from (workout-overview §7: the stale check
 * runs inside the start transaction). Every row must still be at its version
 * (null: must not exist), and every set must still hold exactly these members.
 */
export interface WriteFence {
  rows: readonly { table: FenceTable; id: string; version: number | null }[];
  sets: readonly (
    | { kind: 'gym_equipment'; gymId: string; members: readonly { id: string; version: number }[] }
    | { kind: 'active_pain_flags'; ownerId: string; members: readonly { id: string; version: number }[] }
    /** The coach's stored next-session targets from one finished workout (D21; ADR 0021). */
    | { kind: 'next_session_targets'; ownerId: string; sourceSessionId: string; members: readonly { id: string; version: number }[] }
  )[];
}

/** A fenced write found an input changed since it was planned; nothing was written. */
export type FencedResult = { ok: false; error: 'stale_inputs' };

export interface Repositories {
  profiles: ProfileRepository;
  gyms: GymRepository;
  equipment: EquipmentRepository;
  exercises: ExerciseRepository;
  routines: RoutineRepository;
  progressionRules: ProgressionRuleRepository;
  sessions: SessionRepository;
}

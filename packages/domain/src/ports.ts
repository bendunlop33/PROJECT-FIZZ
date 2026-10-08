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
  /** `expectedRevision` null = create. */
  save(aggregate: SessionAggregate, expectedRevision: number | null): Promise<SaveResult>;
}

export interface Repositories {
  profiles: ProfileRepository;
  gyms: GymRepository;
  equipment: EquipmentRepository;
  exercises: ExerciseRepository;
  routines: RoutineRepository;
  progressionRules: ProgressionRuleRepository;
  sessions: SessionRepository;
}

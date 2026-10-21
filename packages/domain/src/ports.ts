import type {
  EquipmentInstance,
  Exercise,
  Gym,
  PlanDayVariation,
  ProgressionRule,
  Routine,
  SessionAggregate,
  UserProfile,
} from '@fizz/schemas';
import type { PlanDayKeySplit } from './session/coach-plan';

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
  /** (19 Oct) Whether any completed set was logged with this exercise. */
  hasLoggedSets(exerciseId: string): Promise<boolean>;
  /** (Review exlist S4) Logged with, or in a workout, routine, open draft or plan, or a live next-session target. */
  isInUse(exerciseId: string): Promise<boolean>;
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
  save(aggregate: SessionAggregate, expectedRevision: number | null, fence?: WriteFence, alongside?: StartAlongside): Promise<SaveResult | FencedResult>;
}

/**
 * (Workout builder v3 §2.8, §4.6) Writes that land in the new session's own
 * transaction, under its op ID: `Update <day> in your plan` (the template, or
 * the open variation) and `Save as new variation`. Any refused write (a
 * version moved, the variation limit, a taken label) writes nothing at all,
 * the session included, and the result says which (`alongside`).
 */
export interface StartAlongside {
  opId: string;
  /** The plan-day template's new version, at the version the builder opened (rule 5). */
  template?: { next: Routine; expectedVersion: number } & PlanDayKeySplit;
  /** A variation write: new (`expectedVersion` null) or an update at its version. */
  variation?: { next: PlanDayVariation; expectedVersion: number | null };
}

/** Why an alongside write was refused (nothing was written). */
export type AlongsideRefusal = 'template_changed' | 'variation_changed' | 'variation_limit' | 'variation_label';

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
export type FencedResult = { ok: false; error: 'stale_inputs'; alongside?: AlongsideRefusal };

export interface Repositories {
  profiles: ProfileRepository;
  gyms: GymRepository;
  equipment: EquipmentRepository;
  exercises: ExerciseRepository;
  routines: RoutineRepository;
  progressionRules: ProgressionRuleRepository;
  sessions: SessionRepository;
}

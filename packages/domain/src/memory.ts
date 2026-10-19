import type {
  EquipmentInstance,
  Exercise,
  Gym,
  ProgressionRule,
  Routine,
  SessionAggregate,
  UserProfile,
} from '@fizz/schemas';
import type {
  EquipmentRepository,
  ExerciseRepository,
  GymRepository,
  ProfileRepository,
  Repositories,
  RoutineRepository,
  FencedResult,
  SaveResult,
  SessionRepository,
  WriteFence,
} from './ports';

/** Deep copy through JSON, mimicking a storage round-trip (no shared references). */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemoryVersioned<T extends { id: string; version: number }> {
  protected readonly rows = new Map<string, T>();

  get(id: string): Promise<T | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? copy(row) : null);
  }

  save(record: T, expectedVersion: number | null): Promise<SaveResult> {
    const current = this.rows.get(record.id);
    const currentVersion = current?.version ?? null;
    if (currentVersion !== expectedVersion) {
      return Promise.resolve({ ok: false, error: 'conflict', currentVersion });
    }
    this.rows.set(record.id, copy(record));
    return Promise.resolve({ ok: true, version: record.version });
  }

  protected all(): T[] {
    return [...this.rows.values()].map(copy);
  }
}

class MemoryGyms extends MemoryVersioned<Gym> implements GymRepository {
  listByOwner(ownerId: string): Promise<Gym[]> {
    return Promise.resolve(this.all().filter((g) => g.ownerId === ownerId));
  }
}

class MemoryEquipment extends MemoryVersioned<EquipmentInstance> implements EquipmentRepository {
  listByGym(gymId: string): Promise<EquipmentInstance[]> {
    return Promise.resolve(this.all().filter((e) => e.gymId === gymId));
  }
}

class MemoryExercises extends MemoryVersioned<Exercise> implements ExerciseRepository {
  list(): Promise<Exercise[]> {
    return Promise.resolve(this.all());
  }
  /** The in-memory store keeps no sets here. */
  hasLoggedSets(): Promise<boolean> {
    return Promise.resolve(false);
  }
  /** Nor workouts, routines or drafts. */
  isInUse(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

class MemoryRoutines extends MemoryVersioned<Routine> implements RoutineRepository {
  listByOwner(ownerId: string): Promise<Routine[]> {
    return Promise.resolve(this.all().filter((r) => r.ownerId === ownerId));
  }
}

class MemoryProfiles extends MemoryVersioned<UserProfile> implements ProfileRepository {}

class MemorySessions implements SessionRepository {
  private readonly rows = new Map<string, SessionAggregate>();

  get(sessionId: string): Promise<SessionAggregate | null> {
    const row = this.rows.get(sessionId);
    return Promise.resolve(row ? copy(row) : null);
  }

  getActive(ownerId: string): Promise<SessionAggregate | null> {
    const row = [...this.rows.values()].find((a) => a.session.ownerId === ownerId && a.session.status === 'active');
    return Promise.resolve(row ? copy(row) : null);
  }

  findByStartOperation(ownerId: string, opId: string): Promise<SessionAggregate | null> {
    const row = [...this.rows.values()].find(
      (a) => a.session.ownerId === ownerId && a.session.startOperationId === opId,
    );
    return Promise.resolve(row ? copy(row) : null);
  }

  /** Pins sessions only: the other fenced tables (check-ins, pain flags) aren't in memory storage. */
  save(aggregate: SessionAggregate, expectedRevision: number | null, fence?: WriteFence): Promise<SaveResult | FencedResult> {
    for (const row of fence?.rows ?? []) {
      if (row.table === 'sessions' && (this.rows.get(row.id)?.revision ?? null) !== row.version) return Promise.resolve({ ok: false, error: 'stale_inputs' });
    }
    const current = this.rows.get(aggregate.session.id);
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== expectedRevision) {
      return Promise.resolve({ ok: false, error: 'conflict', currentVersion: currentRevision });
    }
    this.rows.set(aggregate.session.id, copy(aggregate));
    return Promise.resolve({ ok: true, version: aggregate.revision });
  }
}

/** In-memory repositories for tests and prototyping. Not durable. */
export function createMemoryRepositories(): Repositories {
  return {
    profiles: new MemoryProfiles(),
    gyms: new MemoryGyms(),
    equipment: new MemoryEquipment(),
    exercises: new MemoryExercises(),
    routines: new MemoryRoutines(),
    progressionRules: new MemoryVersioned<ProgressionRule>(),
    sessions: new MemorySessions(),
  };
}

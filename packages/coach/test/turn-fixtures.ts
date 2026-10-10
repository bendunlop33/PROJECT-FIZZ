import { barbell, dumbbells, assisted, at, GYM, id, OWNER, T0, idGen } from '@fizz/domain/testing';
import { openStore, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { CoachModelPort, ModelEvent, ModelRequest } from '../src/model-port';
import type { ActionRecord, EquipmentInstance, Load, LoadConvention, PlannedSet, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';
import type { TodayTargetsPort } from '../src/executors';
import type { CoachTurnPorts, CoachTurnRequest } from '../src/turn';

export { at, id, OWNER };

export const SESSION = id(9000);
export const BAR = barbell();
export const DB = dumbbells();
export const ASSIST = assisted();

export const kg = (value: number, convention: LoadConvention = 'total'): Load => ({ value, unit: 'kg', convention });

interface ExSpec {
  n: number;
  name: string;
  eq: EquipmentInstance | null;
  convention: LoadConvention;
  sets: { done?: boolean; load: Load | null; reps?: [number, number] }[];
}

function planned(load: Load | null, reps: [number, number]): PlannedSet {
  return { load, reps: { min: reps[0], max: reps[1] }, durationS: null, rpe: 8, rir: null };
}

/** Bench (barbell, kg) with sets 1–2 done at RPE 10; DB press per hand; assisted pull-up. */
export function workout(version = 7): SessionAggregate {
  const specs: ExSpec[] = [
    { n: 10, name: 'Bench press', eq: BAR, convention: 'total', sets: [{ done: true, load: kg(100) }, { done: true, load: kg(100) }, { load: kg(100) }, { load: kg(100) }] },
    { n: 20, name: 'Dumbbell press', eq: DB, convention: 'per_hand', sets: [{ load: kg(22.5, 'per_hand'), reps: [8, 10] }, { load: kg(22.5, 'per_hand'), reps: [8, 10] }] },
    { n: 30, name: 'Assisted pull-up', eq: ASSIST, convention: 'assistance', sets: [{ load: kg(30, 'assistance') }, { load: kg(30, 'assistance') }] },
  ];
  const exercises: SessionExercise[] = [];
  const sets: WorkoutSet[] = [];
  specs.forEach((sp, order) => {
    exercises.push({
      id: id(sp.n),
      sessionId: SESSION,
      exerciseId: id(sp.n + 1000),
      exerciseName: sp.name,
      measurement: 'reps',
      laterality: 'bilateral',
      equipmentId: sp.eq?.id ?? null,
      loadConvention: sp.convention,
      unit: 'kg',
      order,
      supersetGroup: null,
      transitionRestS: null,
      progressionRuleId: null,
    });
    sp.sets.forEach((s, i) => {
      const done = s.done === true;
      sets.push({
        id: id(sp.n * 10 + i),
        sessionId: SESSION,
        sessionExerciseId: id(sp.n),
        index: i,
        setType: 'working',
        status: done ? 'completed' : 'pending',
        side: null,
        pairedWithSetId: null,
        planned: planned(s.load, s.reps ?? [6, 8]),
        rest: { seconds: 120, source: 'global_default', sourceLabel: 'Default' },
        actual: done ? { load: s.load, reps: 8, durationS: null, rpe: 10, rir: null } : null,
        draft: null,
        completedAt: done ? at(60) : null,
        completedByOpId: done ? `op-${String(i)}` : null,
        undoCount: 0,
        flags: [],
        edited: false,
        version: 1,
      });
    });
  });
  return {
    session: {
      id: SESSION,
      ownerId: OWNER,
      routineId: null,
      routineName: 'Push A',
      gymId: GYM,
      startOperationId: 'start',
      status: 'active',
      source: 'manual',
      startedAt: at(0),
      endedAt: null,
      version,
      activeSetId: null,
      equipmentSnapshot: [BAR, DB, ASSIST],
      pause: null,
      pauses: [],
      lastActivityAtUtc: T0,
      checkIn: null,
    },
    exercises,
    sets,
    restTimer: null,
    workInterval: null,
    audit: [],
    timingAudit: [],
    processedOps: {},
    revision: 3,
  };
}

/**
 * An in-memory stand-in for the session's `adjust_pending_targets` command
 * (the seam for `claude/active-set`): version-checked, idempotent on the
 * opId, and it saves the record through the real store.
 */
export class FakeTodayTargets implements TodayTargetsPort {
  readonly applied: string[] = [];
  constructor(
    public state: SessionAggregate,
    private readonly store: Store,
  ) {}

  async apply(input: Parameters<TodayTargetsPort['apply']>[0]): ReturnType<TodayTargetsPort['apply']> {
    const prior = await this.store.repos.coach.findActionByOpId(input.ownerId, input.opId);
    if (prior !== null) return { status: 'replayed', record: prior };
    if (this.state.session.version !== input.expectedVersion) return { status: 'stale' };
    const sets = this.state.sets.map((s) => {
      for (const ex of input.plan) {
        const c = ex.changes.find((x) => x.setId === s.id && x.after !== null);
        if (c?.after) return { ...s, planned: { ...s.planned, load: c.after.load, reps: c.after.reps }, version: s.version + 1 };
      }
      return s;
    });
    const r = await this.store.repos.coach.commit(input.ownerId, { kind: 'record', action: input.record });
    if (r.status === 'conflict') return { status: 'stale' };
    this.state = { ...this.state, sets, session: { ...this.state.session, version: this.state.session.version + 1 } };
    this.applied.push(input.opId);
    return { status: r.status, record: r.action };
  }
}

export async function memoryStore(): Promise<Store> {
  return openStore(openNodeDriver(':memory:'));
}

/** A model that never answers until aborted (timeouts, Stop). Optionally one event first. */
export class HangingModel implements CoachModelPort {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly first: ModelEvent | null = null) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    if (this.first !== null) yield this.first;
    await new Promise<void>((resolve) => {
      if (request.signal?.aborted === true) resolve();
      request.signal?.addEventListener('abort', () => {
        resolve();
      });
    });
    yield { type: 'error', error: 'cancelled' };
  }
}

export function call(name: string, args: unknown, callId = `c-${name}`): ModelEvent {
  return { type: 'tool_call', callId, name, arguments: JSON.stringify(args) };
}

export function reply(message: string, offer: 'adjust_today' | null = null): ModelEvent[] {
  return [call('reply', { message, offer }, 'c-reply'), { type: 'completed' }];
}

const next = idGen(50_000);

export function ports(store: Store, model: CoachModelPort, executors: CoachTurnPorts['executors'] = {}): CoachTurnPorts {
  let t = 100;
  return { model, store: store.repos.coach, executors, now: () => at((t += 1)), newId: next, timing: { firstEventMs: 200, stallMs: 200 } };
}

let turnSeq = 0;
export function request(over: Partial<CoachTurnRequest> & Pick<CoachTurnRequest, 'input'>): CoachTurnRequest {
  turnSeq += 1;
  return {
    ownerId: OWNER,
    threadId: null,
    turnId: id(70_000 + turnSeq),
    kind: 'general',
    model: 'gpt-6.1-sol',
    surface: 'sheet',
    context: { session: null, gymName: null, painFlags: [], checkIn: null, memories: [], catalogue: [] },
    structuralSignals: [],
    ...over,
  };
}

export const words = (text: string) => ({ kind: 'words' as const, text, spoken: false });

export type { ActionRecord };

import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Load, LoadConvention, PainFlag, SessionAggregate, SessionExercise, SetType, WeightUnit, WorkoutSet } from '@fizz/schemas';
import { anyWorkingSetEverLogged, evaluateLighterSession, lighterLoad, offersCheckInInWorkout, reduceSession, DEFAULT_CHECK_IN_SETTINGS, type LighterSessionAdjustment } from '../src/index';
import { assisted, at, barbell, dumbbells, GYM, id, kg, lb, OWNER, stack, T0 } from './fixtures';

/**
 * (Ben, 23 Oct) The built-in lighter session after a low check-in when the
 * coach can't answer: one fewer working set per exercise (min 1), loads about
 * 10% lighter snapped to the gym's real equipment, today's pending sets only.
 */

const SESSION = id(9200);
const FACT = 'You said 2 of 5 · Tired';

interface ExSpec {
  eq: EquipmentInstance | null;
  convention: LoadConvention;
  unit?: WeightUnit;
  load: Load | null;
  /** Set types in order; default three working sets. */
  types?: SetType[];
  /** How many sets (from the start) are already logged. */
  done?: number;
}

function workout(specs: ExSpec[], version = 5): SessionAggregate {
  const exercises: SessionExercise[] = [];
  const sets: WorkoutSet[] = [];
  specs.forEach((sp, e) => {
    const ex: SessionExercise = {
      id: id(100 + e),
      sessionId: SESSION,
      exerciseId: id(1000 + e),
      exerciseName: `Exercise ${String(e + 1)}`,
      measurement: 'reps',
      laterality: 'bilateral',
      equipmentId: sp.eq?.id ?? null,
      loadConvention: sp.convention,
      unit: sp.unit ?? 'kg',
      order: e,
      supersetGroup: null,
      transitionRestS: null,
      progressionRuleId: null,
    };
    exercises.push(ex);
    const types = sp.types ?? ['working', 'working', 'working'];
    types.forEach((t, i) => {
      const done = i < (sp.done ?? 0);
      sets.push({
        id: id(200 + e * 20 + i),
        sessionId: SESSION,
        sessionExerciseId: ex.id,
        index: i,
        setType: t,
        status: done ? 'completed' : 'pending',
        side: null,
        pairedWithSetId: null,
        planned: { load: sp.load, reps: { min: 6, max: 8 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' },
        rest: { seconds: 120, source: 'global_default', sourceLabel: 'Default' },
        actual: done ? { load: sp.load, reps: 8, durationS: null, rpe: null, rir: null } : null,
        draft: null,
        completedAt: done ? at(60) : null,
        completedByOpId: done ? `log-${String(e)}-${String(i)}` : null,
        undoCount: 0,
        flags: [],
        edited: false,
        version: done ? 2 : 1,
      });
    });
  });
  const audit: SessionAggregate['audit'] = sets
    .filter((s) => s.status === 'completed')
    .map((s) => ({ id: `a-${s.id}`, sessionId: SESSION, setId: s.id, opId: s.completedByOpId ?? 'op', kind: 'logged' as const, atUtc: T0, before: null, after: null }));
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
      activeSetId: sets.find((s) => s.status === 'pending')?.id ?? null,
      equipmentSnapshot: specs.flatMap((s) => (s.eq ? [s.eq] : [])),
      pause: null,
      pauses: [],
      lastActivityAtUtc: T0,
      checkIn: null,
    },
    exercises,
    sets,
    restTimer: null,
    workInterval: null,
    audit,
    timingAudit: [],
    processedOps: {},
    revision: 3,
  };
}

const run = (agg: SessionAggregate, over: { painFlags?: PainFlag[]; sessionPainUnspecified?: boolean } = {}): LighterSessionAdjustment | null =>
  evaluateLighterSession({ aggregate: agg, painFlags: over.painFlags ?? [], sessionPainUnspecified: over.sessionPainUnspecified ?? false, gymName: 'Main Gym', fact: FACT });

function changesOf(a: LighterSessionAdjustment, exIndex: number) {
  const plan = a.plan.find((p) => p.sessionExerciseId === id(100 + exIndex));
  return plan ?? null;
}

const BAR = barbell();

describe('evaluateLighterSession (Ben, 23 Oct)', () => {
  it('one fewer working set and about 10% lighter, snapped to the bar; warm-ups untouched', () => {
    const agg = workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['warmup', 'working', 'working', 'working'] }]);
    const a = run(agg);
    if (a === null) throw new Error('expected a change');
    const p = changesOf(a, 0);
    // The last pending working set goes.
    expect(p?.removed?.setId).toBe(id(203));
    // The other working sets: 90 kg (exactly makeable).
    const lowered = p?.changes.filter((c) => c.after !== null && c.before !== null) ?? [];
    expect(lowered.map((c) => c.setId)).toEqual([id(201), id(202)]);
    expect(lowered.every((c) => c.after?.load?.value === 90 && c.after.load.unit === 'kg' && c.after.reps?.max === 8)).toBe(true);
    // The warm-up is not in the change.
    expect(a.touchedSetIds).not.toContain(id(200));
    expect(a.change).toBe('1 fewer set · loads 10% lighter');
    expect(a.reason.startsWith(FACT)).toBe(true);
    expect(a.args.baseVersion).toBe(5);
  });

  it('per-hand dumbbells snap to the rack (20 → 17.5 kg each), and a kg/lb rack keeps its own unit', () => {
    const db = dumbbells();
    const a = run(workout([{ eq: db, convention: 'per_hand', load: kg(20, 'per_hand') }]));
    const after = a === null ? [] : (changesOf(a, 0)?.changes ?? []).filter((c) => c.after !== null && c.before !== null);
    expect(after.map((c) => c.after?.load)).toEqual([{ value: 17.5, unit: 'kg', convention: 'per_hand' }, { value: 17.5, unit: 'kg', convention: 'per_hand' }]);

    const lbRack = dumbbells({ unit: 'lb', loads: [20, 25, 30, 35, 40, 45, 50] });
    const b = run(workout([{ eq: lbRack, convention: 'per_hand', unit: 'lb', load: lb(50, 'per_hand') }]));
    const lbAfter = b === null ? [] : (changesOf(b, 0)?.changes ?? []).filter((c) => c.after !== null && c.before !== null);
    expect(lbAfter.map((c) => c.after?.load)).toEqual([{ value: 45, unit: 'lb', convention: 'per_hand' }, { value: 45, unit: 'lb', convention: 'per_hand' }]);
  });

  it('never invents a load the equipment can’t make: a coarse stack keeps its load (the next step is too big), min load stays', () => {
    // 20 kg on a 5 kg stack: 18 isn't makeable; 15 would be 25% lighter, so the load stays and only a set goes.
    const a = run(workout([{ eq: stack(), convention: 'stack', load: kg(20, 'stack') }]));
    expect(a?.change).toBe('1 fewer set');
    expect(changesOf(a as LighterSessionAdjustment, 0)?.changes.filter((c) => c.after !== null)).toEqual([]);
    // Already at the rack's lightest: nothing lighter exists.
    expect(lighterLoad(kg(5, 'per_hand'), dumbbells())).toBeNull();
    // Never above the equipment's max (a load past it is never produced).
    expect(lighterLoad(kg(30, 'per_hand'), dumbbells({ loads: [5, 10, 15, 20, 25, 30] }))).toEqual({ value: 25, unit: 'kg', convention: 'per_hand' });
  });

  it('assisted machines get one step more assistance (easier), never less', () => {
    const a = run(workout([{ eq: assisted(), convention: 'assistance', load: kg(20, 'assistance') }]));
    const after = a === null ? [] : (changesOf(a, 0)?.changes ?? []).filter((c) => c.after !== null && c.before !== null);
    expect(after.map((c) => c.after?.load?.value)).toEqual([25, 25]);
    // At the most assistance there is: no change to the load.
    expect(lighterLoad(kg(40, 'assistance'), assisted())).toBeNull();
  });

  it('keeps at least one working set, and never touches logged sets', () => {
    // Two working sets, one done: removing the pending one would leave one, which is allowed (min 1).
    const a = run(workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['working', 'working'], done: 1 }]));
    expect(changesOf(a as LighterSessionAdjustment, 0)?.removed?.setId).toBe(id(201));
    expect(a?.touchedSetIds).not.toContain(id(200));
    // A single working set: lighter, never removed.
    const b = run(workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['warmup', 'working'] }]));
    expect(changesOf(b as LighterSessionAdjustment, 0)?.removed).toBeNull();
    expect(b?.change).toBe('Loads 10% lighter');
    // Everything logged: nothing to change.
    expect(run(workout([{ eq: BAR, convention: 'total', load: kg(100), done: 3 }]))).toBeNull();
  });

  it('bodyweight exercises lose a set; their load stays bodyweight', () => {
    const a = run(workout([{ eq: null, convention: 'bodyweight', load: { value: 0, unit: 'kg', convention: 'bodyweight' } }]));
    expect(a?.change).toBe('1 fewer set');
  });

  it('covers every exercise with pending working sets, in one change', () => {
    const a = run(workout([
      { eq: BAR, convention: 'total', load: kg(100) },
      { eq: dumbbells(), convention: 'per_hand', load: kg(20, 'per_hand') },
    ]));
    expect(a?.plan.map((p) => p.sessionExerciseId)).toEqual([id(100), id(101)]);
    expect(a?.change).toBe('2 fewer sets · loads 10–13% lighter');
  });

  it('never an increase, even with pain mentioned (rule 9 guardrail still runs)', () => {
    const a = run(workout([{ eq: BAR, convention: 'total', load: kg(100) }]), { sessionPainUnspecified: true });
    expect(a).not.toBeNull();
    for (const p of a?.plan ?? []) for (const c of p.changes) if (c.after?.load && c.before?.load) expect(c.after.load.value).toBeLessThan(c.before.load.value);
  });
});

describe('apply and Undo through the workout (rule 2, rule 5)', () => {
  function command(a: LighterSessionAdjustment, opId = 'built-in-lighter:ci1') {
    return {
      type: 'adjust_pending_targets' as const,
      at: at(120),
      opId,
      expectedVersion: a.args.baseVersion,
      actionId: id(8101),
      reason: a.reason,
      rule: a.rule,
      changes: a.plan.flatMap((e) => e.changes.flatMap((c) => (c.before !== null && c.after !== null ? [{ setId: c.setId, target: c.after }] : []))),
      removeSetIds: a.plan.flatMap((e) => (e.removed === null ? [] : [e.removed.setId])),
      addSets: [],
    };
  }

  it('applies once per operation ID, refuses a stale version, and Undo brings back the removed set and the loads', () => {
    const agg = workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['warmup', 'working', 'working', 'working'] }]);
    const a = run(agg);
    if (a === null) throw new Error('fixture');
    const r = reduceSession(agg, command(a));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.sets.find((s) => s.id === id(203))?.status).toBe('deleted');
    expect(r.state.sets.find((s) => s.id === id(201))?.planned.load?.value).toBe(90);
    expect(r.state.sets.find((s) => s.id === id(200))?.planned.load?.value).toBe(100);

    // Duplicate operation ID: a no-op replay.
    const again = reduceSession(r.state, command(a));
    expect(again.ok && again.duplicate).toBe(true);
    // Stale: the same change, a new op, on the old version.
    const stale = reduceSession(r.state, command(a, 'built-in-lighter:other'));
    expect(stale.ok).toBe(false);

    const undo = reduceSession(r.state, { type: 'revert_target_adjustment', at: at(130), opId: 'undo:x', actionId: id(8101), removedSetIds: [id(203)], addedSetIds: [] });
    if (!undo.ok) throw new Error(undo.error.message);
    expect(undo.state.sets.find((s) => s.id === id(203))?.status).toBe('pending');
    expect(undo.state.sets.filter((s) => s.setType === 'working').every((s) => s.planned.load?.value === 100)).toBe(true);
  });
});

describe('the check-in in the workout (Ben, 23 Oct)', () => {
  it('is offered until the first working set is logged; a logged warm-up keeps it open', () => {
    const fresh = workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['warmup', 'working'] }]);
    expect(offersCheckInInWorkout({ settings: DEFAULT_CHECK_IN_SETTINGS, session: fresh })).toBe(true);
    const warm = workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['warmup', 'working'], done: 1 }]);
    expect(anyWorkingSetEverLogged(warm)).toBe(false);
    expect(offersCheckInInWorkout({ settings: DEFAULT_CHECK_IN_SETTINGS, session: warm })).toBe(true);
    const worked = workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['warmup', 'working'], done: 2 }]);
    expect(offersCheckInInWorkout({ settings: DEFAULT_CHECK_IN_SETTINGS, session: worked })).toBe(false);
    // Logged then undone still counts (never mid-workout).
    const undone: SessionAggregate = { ...worked, sets: worked.sets.map((s) => (s.id === id(201) ? { ...s, status: 'pending', actual: null } : s)) };
    expect(offersCheckInInWorkout({ settings: DEFAULT_CHECK_IN_SETTINGS, session: undone })).toBe(false);
  });

  it('not when answered, skipped, or check-ins are off', () => {
    const fresh = workout([{ eq: BAR, convention: 'total', load: kg(100) }]);
    const withCheckIn = (checkIn: SessionAggregate['session']['checkIn']): SessionAggregate => ({ ...fresh, session: { ...fresh.session, checkIn } });
    expect(offersCheckInInWorkout({ settings: DEFAULT_CHECK_IN_SETTINGS, session: withCheckIn({ kind: 'answered', checkInId: id(5) }) })).toBe(false);
    expect(offersCheckInInWorkout({ settings: DEFAULT_CHECK_IN_SETTINGS, session: withCheckIn({ kind: 'skipped', atUtc: T0 }) })).toBe(false);
    expect(offersCheckInInWorkout({ settings: DEFAULT_CHECK_IN_SETTINGS, session: withCheckIn({ kind: 'not_asked', reason: 'when_i_choose' }) })).toBe(true);
    expect(offersCheckInInWorkout({ settings: { ...DEFAULT_CHECK_IN_SETTINGS, enabled: false }, session: fresh })).toBe(false);
  });

  it('`set_session_check_in` links once, before any working set; a replay is a no-op; stale and late links are refused', () => {
    const fresh = workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['warmup', 'working'] }]);
    const cmd = { type: 'set_session_check_in' as const, at: at(30), opId: 'ci-link-1', checkInId: id(5), expectedVersion: 5 };
    const r = reduceSession(fresh, cmd);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.state.session.checkIn).toEqual({ kind: 'answered', checkInId: id(5) });
    expect(r.state.session.version).toBe(6);
    const replay = reduceSession(r.state, cmd);
    expect(replay.ok && replay.duplicate).toBe(true);
    // A second, different check-in on the same workout is refused.
    const second = reduceSession(r.state, { ...cmd, opId: 'ci-link-2', checkInId: id(6), expectedVersion: 6 });
    expect(second.ok ? null : second.error.code).toBe('check_in_closed');
    // Stale version.
    const stale = reduceSession(fresh, { ...cmd, opId: 'ci-link-3', expectedVersion: 4 });
    expect(stale.ok ? null : stale.error.code).toBe('stale_version');
    // After the first working set: closed.
    const worked = workout([{ eq: BAR, convention: 'total', load: kg(100), types: ['warmup', 'working', 'working'], done: 2 }]);
    const late = reduceSession(worked, { ...cmd, opId: 'ci-link-4' });
    expect(late.ok ? null : late.error.code).toBe('check_in_closed');
  });
});

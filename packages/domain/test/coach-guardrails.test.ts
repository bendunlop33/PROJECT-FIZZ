import { describe, expect, it } from 'vitest';
import type {
  AdjustPendingSetsArgs,
  EquipmentInstance,
  ExerciseAdjustment,
  Load,
  LoadConvention,
  PainFlag,
  PlannedSet,
  SessionAggregate,
  SessionExercise,
  SetType,
  WeightUnit,
  WorkoutSet,
} from '@fizz/schemas';
import {
  classifyPainMention,
  painBodyPart,
  exercisesNamedForPain,
  evaluateCoachTrigger,
  getAchievableLoads,
  getStructuralChangeSignals,
  isLoadAchievable,
  setNumbersText,
  shouldShowCoachOffer,
  validateTodayAdjustment,
  type AdjustIntent,
  type TodayAdjustmentInput,
  type TriggerSetInput,
} from '../src/index';
import { assisted, at, barbell, dumbbells, GYM, id, kg, lb, OWNER, stack, T0 } from './fixtures';

// ---------------------------------------------------------------------------
// A small hand-built workout: one exercise per piece of equipment.

const SESSION = id(9000);

interface ExSpec {
  n: number;
  name: string;
  eq: EquipmentInstance | null;
  convention: LoadConvention;
  unit?: WeightUnit;
  sets: { status?: WorkoutSet['status']; type?: SetType; load: Load | null; reps?: [number, number] | null }[];
}

function planned(load: Load | null, reps: [number, number] | null): PlannedSet {
  return { load, reps: reps === null ? null : { min: reps[0], max: reps[1] }, durationS: null, rpe: null, rir: null };
}

function buildWorkout(specs: ExSpec[], version = 7): SessionAggregate {
  const exercises: SessionExercise[] = [];
  const sets: WorkoutSet[] = [];
  specs.forEach((sp, order) => {
    const exId = id(sp.n);
    exercises.push({
      id: exId,
      sessionId: SESSION,
      exerciseId: id(sp.n + 1000),
      exerciseName: sp.name,
      measurement: 'reps',
      laterality: 'bilateral',
      equipmentId: sp.eq?.id ?? null,
      loadConvention: sp.convention,
      unit: sp.unit ?? 'kg',
      order,
      supersetGroup: null,
      transitionRestS: null,
      progressionRuleId: null,
    });
    sp.sets.forEach((s, i) => {
      const status = s.status ?? 'pending';
      const done = status === 'completed';
      sets.push({
        id: id(sp.n * 10 + i),
        sessionId: SESSION,
        sessionExerciseId: exId,
        index: i,
        setType: s.type ?? 'working',
        status,
        side: null,
        pairedWithSetId: null,
        planned: planned(s.load, s.reps === undefined ? [6, 8] : s.reps),
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
    audit: [],
    timingAudit: [],
    processedOps: {},
    revision: 3,
  };
}

const BAR = barbell();
const DB = dumbbells();
const STACK = stack();
const ASSIST = assisted();
const LB_BAR = barbell({
  id: id(110),
  unit: 'lb',
  barMass: 45,
  plates: [
    { mass: 45, count: 6 },
    { mass: 25, count: 2 },
    { mass: 10, count: 2 },
    { mass: 5, count: 2 },
    { mass: 2.5, count: 2 },
  ],
});

/** Bench: sets 1–2 done, 3–4 pending. Then DB press, cable row, assisted pull-up, lb squat. */
function workout(): SessionAggregate {
  return buildWorkout([
    {
      n: 1,
      name: 'Bench press',
      eq: BAR,
      convention: 'total',
      sets: [
        { status: 'completed', load: kg(100) },
        { status: 'completed', load: kg(100) },
        { load: kg(100) },
        { load: kg(100) },
      ],
    },
    { n: 2, name: 'Incline DB press', eq: DB, convention: 'per_hand', sets: [{ load: kg(25, 'per_hand') }, { load: kg(25, 'per_hand') }] },
    { n: 3, name: 'Cable row', eq: STACK, convention: 'stack', sets: [{ load: kg(40, 'stack') }, { load: kg(40, 'stack') }] },
    { n: 4, name: 'Assisted pull-up', eq: ASSIST, convention: 'assistance', sets: [{ load: kg(20, 'assistance') }, { load: kg(20, 'assistance') }] },
    { n: 5, name: 'Squat', eq: LB_BAR, convention: 'total', unit: 'lb', sets: [{ load: lb(225) }, { load: lb(225) }] },
    { n: 6, name: 'Push-up', eq: null, convention: 'bodyweight', sets: [{ load: null, reps: [10, 15] }] },
  ]);
}

const setId = (exN: number, i: number): string => id(exN * 10 + i);
const exId = (n: number): string => id(n);

function adj(sessionExerciseId: string, over: Partial<ExerciseAdjustment> = {}): ExerciseAdjustment {
  return { sessionExerciseId, sets: [], addSet: null, removeSetId: null, ...over };
}

function input(exercises: ExerciseAdjustment[], over: Partial<TodayAdjustmentInput> & { intent?: AdjustIntent; baseVersion?: number } = {}): TodayAdjustmentInput {
  const args: AdjustPendingSetsArgs = { baseVersion: over.baseVersion ?? 7, exercises, reason: 'Set 2 was RPE 10.' };
  return {
    aggregate: over.aggregate ?? workout(),
    args,
    intent: over.intent ?? 'too_hard',
    opId: 'turn-1:adjust_pending_sets:abc',
    painFlags: over.painFlags ?? [],
    sessionPainUnspecified: over.sessionPainUnspecified ?? false,
    gymName: over.gymName ?? 'Main Gym',
    messagePain: over.messagePain ?? null,
  };
}

function painFlag(exerciseN: number, name: string, area: PainFlag['area'] = 'shoulder', reportedSeconds = 30): PainFlag {
  return {
    id: id(7000 + exerciseN),
    ownerId: OWNER,
    version: 1,
    createdAtUtc: T0,
    updatedAtUtc: T0,
    exerciseId: id(exerciseN + 1000),
    exerciseName: name,
    area,
    source: 'workout',
    checkInId: null,
    reportedAt: at(reportedSeconds),
    status: 'active',
    clearedAtUtc: null,
    createdByOpId: 'pain-op',
  };
}

function applied(r: ReturnType<typeof validateTodayAdjustment>) {
  if (r.status !== 'apply') throw new Error(`expected apply, got ${r.status}: ${'outcome' in r ? r.outcome : ''}`);
  return r;
}

// ---------------------------------------------------------------------------

describe('validateTodayAdjustment: snapping and caps (rule 4)', () => {
  it('rounds 96 kg down to 95 for "too hard" and up to 97.5 for "too easy" (check 10)', () => {
    const ask = [adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(96), reps: null } }] })];
    const hard = applied(validateTodayAdjustment(input(ask, { intent: 'too_hard' })));
    expect(hard.exercises[0]?.changes[0]?.after?.load).toEqual(kg(95));
    expect(hard.guardNotes.map((n) => n.text)).toContain('Rounded to 95\u00a0kg');

    const easy = applied(validateTodayAdjustment(input(ask, { intent: 'too_easy' })));
    expect(easy.exercises[0]?.changes[0]?.after?.load).toEqual(kg(97.5));
    expect(easy.guardNotes[0]?.text).toBe('Rounded to 97.5\u00a0kg');
  });

  it('every stored load is achievable on the snapshot equipment', () => {
    for (const ask of [93.3, 96, 98, 103.1]) {
      const r = applied(validateTodayAdjustment(input([adj(exId(1), { sets: [{ setId: setId(1, 3), target: { load: kg(ask), reps: null } }] })], { intent: 'general' })));
      const load = r.exercises[0]?.changes[0]?.after?.load;
      expect(load && isLoadAchievable(load, BAR)).toBe(true);
    }
  });

  it('caps per-hand dumbbells at the rack max (check 11)', () => {
    const r = applied(
      validateTodayAdjustment(
        input([adj(exId(2), { sets: [{ setId: setId(2, 0), target: { load: kg(35, 'per_hand'), reps: null } }] })], { intent: 'too_easy' }),
      ),
    );
    expect(r.exercises[0]?.changes[0]?.after?.load).toEqual(kg(30, 'per_hand'));
    expect(r.guardNotes[0]).toMatchObject({ kind: 'capped', text: 'Max here 30\u00a0kg\u00a0each' });
  });

  it('never extrapolates past a machine max, whatever the policy', () => {
    for (const intent of ['too_easy', 'general'] as const) {
      const r = applied(validateTodayAdjustment(input([adj(exId(3), { sets: [{ setId: setId(3, 0), target: { load: kg(80, 'stack'), reps: null } }] })], { intent })));
      const load = r.exercises[0]?.changes[0]?.after?.load;
      expect(load?.value).toBe(Math.max(...getAchievableLoads(STACK).loads));
    }
  });

  it('"too hard" never rounds up: a load below the rack minimum is refused, not raised', () => {
    const r = validateTodayAdjustment(
      input([adj(exId(2), { sets: [{ setId: setId(2, 0), target: { load: kg(2, 'per_hand'), reps: null } }] })], { intent: 'too_hard' }),
    );
    expect(r.status).toBe('unchanged');
    if (r.status !== 'unchanged') return;
    expect(r.outcome).toMatch(/^Couldn't use the coach's load: 2\u00a0kg\u00a0each isn't possible on this rack\. Sets unchanged\.$/);
    expect(r.guardNotes[0]?.kind).toBe('no_achievable_load');
  });

  it('assisted machines: "harder" means less assistance, "too hard" means more', () => {
    const tooHard = applied(
      validateTodayAdjustment(input([adj(exId(4), { sets: [{ setId: setId(4, 0), target: { load: kg(23, 'assistance'), reps: null } }] })], { intent: 'too_hard' })),
    );
    // Easier on an assisted machine = more assistance: 23 rounds to 25, not 20.
    expect(tooHard.exercises[0]?.changes[0]?.after?.load).toEqual(kg(25, 'assistance'));

    const tooEasy = applied(
      validateTodayAdjustment(input([adj(exId(4), { sets: [{ setId: setId(4, 0), target: { load: kg(17, 'assistance'), reps: null } }] })], { intent: 'too_easy' })),
    );
    expect(tooEasy.exercises[0]?.changes[0]?.after?.load).toEqual(kg(15, 'assistance'));
  });

  it('a pain flag blocks less assistance (an increase) on an assisted machine but allows more', () => {
    const flags = [painFlag(4, 'Assisted pull-up', 'shoulder')];
    const less = validateTodayAdjustment(
      input([adj(exId(4), { sets: [{ setId: setId(4, 0), target: { load: kg(10, 'assistance'), reps: null } }] })], { intent: 'too_easy', painFlags: flags }),
    );
    expect(less.status).toBe('unchanged');
    const more = applied(
      validateTodayAdjustment(input([adj(exId(4), { sets: [{ setId: setId(4, 0), target: { load: kg(30, 'assistance'), reps: null } }] })], { intent: 'too_hard', painFlags: flags })),
    );
    expect(more.exercises[0]?.changes[0]?.after?.load).toEqual(kg(30, 'assistance'));
  });

  it('kg asked on an lb bar is converted, snapped in lb, and says so (never silently)', () => {
    const r = applied(
      validateTodayAdjustment(input([adj(exId(5), { sets: [{ setId: setId(5, 0), target: { load: kg(95), reps: null } }] })], { intent: 'too_hard' })),
    );
    const load = r.exercises[0]?.changes[0]?.after?.load;
    expect(load?.unit).toBe('lb');
    expect(load && isLoadAchievable(load, LB_BAR)).toBe(true);
    // 95 kg = 209.4 lb; easier rounding on 5 lb steps gives 205.
    expect(load?.value).toBe(205);
    expect(r.guardNotes.map((n) => n.kind)).toEqual(expect.arrayContaining(['snapped', 'converted']));
  });

  it('lb loads stay in lb on an lb bar', () => {
    const r = applied(validateTodayAdjustment(input([adj(exId(5), { sets: [{ setId: setId(5, 1), target: { load: lb(215), reps: null } }] })], { intent: 'too_hard' })));
    expect(r.exercises[0]?.changes[0]?.after?.load).toEqual(lb(215));
    expect(r.guardNotes).toEqual([]);
  });

  it('a load in the wrong convention is refused, not reinterpreted', () => {
    const r = validateTodayAdjustment(input([adj(exId(2), { sets: [{ setId: setId(2, 0), target: { load: kg(50), reps: null } }] })]));
    expect(r.status).toBe('unchanged');
    expect(r.guardNotes[0]?.kind).toBe('convention_mismatch');
  });

  it('a load for an exercise with no equipment is refused; its reps can still change', () => {
    const load = validateTodayAdjustment(input([adj(exId(6), { sets: [{ setId: setId(6, 0), target: { load: kg(10, 'added'), reps: null } }] })]));
    expect(load.status).toBe('unchanged');
    const reps = applied(validateTodayAdjustment(input([adj(exId(6), { sets: [{ setId: setId(6, 0), target: { load: null, reps: { min: 8, max: 12 } } }] })])));
    expect(reps.exercises[0]?.changes[0]?.after).toEqual({ load: null, reps: { min: 8, max: 12 } });
  });

  it('one guard note per kind and text, listing every set it covers', () => {
    const r = applied(
      validateTodayAdjustment(
        input([
          adj(exId(1), {
            sets: [
              { setId: setId(1, 2), target: { load: kg(96), reps: null } },
              { setId: setId(1, 3), target: { load: kg(96), reps: null } },
            ],
          }),
        ]),
      ),
    );
    expect(r.guardNotes).toHaveLength(1);
    expect(r.guardNotes[0]?.setIds).toEqual([setId(1, 2), setId(1, 3)]);
  });
});

describe('validateTodayAdjustment: completed sets, versions, pain (rules 2, 5, 9)', () => {
  it('never changes a completed set and lists it (check 13)', () => {
    const r = applied(
      validateTodayAdjustment(
        input([
          adj(exId(1), {
            sets: [
              { setId: setId(1, 1), target: { load: kg(95), reps: null } },
              { setId: setId(1, 2), target: { load: kg(95), reps: null } },
            ],
          }),
        ]),
      ),
    );
    expect(r.exercises[0]?.changes.map((c) => c.setId)).toEqual([setId(1, 2)]);
    expect(r.guardNotes).toContainEqual({ kind: 'completed_set_dropped', setIds: [setId(1, 1)], text: 'Not changed: set 2 is already done.' });
    expect(r.touchedSetIds).not.toContain(setId(1, 1));
  });

  it("a completed set can't be removed either", () => {
    const r = validateTodayAdjustment(input([adj(exId(1), { removeSetId: setId(1, 0) })]));
    expect(r.status).toBe('unchanged');
    if (r.status === 'unchanged') expect(r.outcome).toBe('Not changed: set 1 is already done. Nothing changed.');
  });

  it('removing a deleted set names it by position, never "set 0" (review nit)', () => {
    const w = workout();
    const target = w.sets.find((x) => x.id === setId(1, 3));
    if (!target) throw new Error('fixture');
    target.status = 'deleted';
    const r = validateTodayAdjustment(input([adj(exId(1), { removeSetId: setId(1, 3) })], { aggregate: w }));
    expect(r.status).toBe('unchanged');
    if (r.status === 'unchanged') expect(r.outcome).toBe("Not changed: set 4 isn't pending. Nothing changed.");
  });

  it('rejects a call made on an older session version as stale', () => {
    const r = validateTodayAdjustment(input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(95), reps: null } }] })], { baseVersion: 6 }));
    expect(r).toEqual({ status: 'stale', outcome: 'Your workout moved on before the coach answered. Nothing changed.', guardNotes: [] });
  });

  it('rejects a finished session as stale', () => {
    const w = workout();
    w.session.status = 'finished';
    expect(validateTodayAdjustment(input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(95), reps: null } }] })], { aggregate: w })).status).toBe('stale');
  });

  it('pain flag: every increase blocked shows the outcome line, no Undo (check 12)', () => {
    const r = validateTodayAdjustment(
      input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(102.5), reps: null } }] })], {
        intent: 'too_easy',
        painFlags: [painFlag(1, 'Bench press', 'shoulder')],
      }),
    );
    expect(r).toMatchObject({ status: 'unchanged', outcome: 'Not increasing: you flagged shoulder pain. Sets unchanged.' });
  });

  it('pain flag: a decrease still applies; increases elsewhere are listed', () => {
    const r = applied(
      validateTodayAdjustment(
        input(
          [
            adj(exId(1), {
              sets: [
                { setId: setId(1, 2), target: { load: kg(95), reps: null } },
                { setId: setId(1, 3), target: { load: null, reps: { min: 8, max: 10 } } },
              ],
            }),
          ],
          { intent: 'general', painFlags: [painFlag(1, 'Bench press', null)] },
        ),
      ),
    );
    expect(r.exercises[0]?.changes.map((c) => c.setId)).toEqual([setId(1, 2)]);
    expect(r.guardNotes).toContainEqual({ kind: 'pain_blocked', setIds: [setId(1, 3)], text: 'Not increasing Bench press: you flagged pain on it.' });
  });

  it('pain flag: load down with reps up keeps the lighter load and the planned reps (review S1)', () => {
    const r = applied(
      validateTodayAdjustment(
        input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(95), reps: { min: 8, max: 8 } } }] })], {
          intent: 'too_hard',
          painFlags: [painFlag(1, 'Bench press', 'shoulder')],
        }),
      ),
    );
    expect(r.exercises[0]?.changes).toEqual([{ setId: setId(1, 2), setNumber: 3, before: { load: kg(100), reps: { min: 6, max: 8 } }, after: { load: kg(95), reps: { min: 6, max: 8 } } }]);
    expect(r.guardNotes).toContainEqual({ kind: 'pain_blocked', setIds: [setId(1, 2)], text: 'Not increasing Bench press: you flagged shoulder pain. Reps stay as planned.' });
  });

  it('pain flag: load up with reps down keeps only the lower reps', () => {
    const r = applied(
      validateTodayAdjustment(
        input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(102.5), reps: { min: 5, max: 6 } } }] })], {
          painFlags: [painFlag(1, 'Bench press', 'shoulder')],
        }),
      ),
    );
    expect(r.exercises[0]?.changes[0]?.after).toEqual({ load: kg(100), reps: { min: 5, max: 6 } });
    expect(r.guardNotes.map((n) => n.text)).toContain('Not increasing Bench press: you flagged shoulder pain. Load stays as planned.');
  });

  it("a cleared flag doesn't block", () => {
    const flag = { ...painFlag(1, 'Bench press'), status: 'cleared' as const };
    const r = validateTodayAdjustment(input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(102.5), reps: null } }] })], { intent: 'too_easy', painFlags: [flag] }));
    expect(r.status).toBe('apply');
  });

  it('pain without a movement in the check-in blocks every increase in the session (check 24)', () => {
    const r = validateTodayAdjustment(
      input([adj(exId(3), { sets: [{ setId: setId(3, 0), target: { load: kg(45, 'stack'), reps: null } }] })], { intent: 'too_easy', sessionPainUnspecified: true }),
    );
    expect(r).toMatchObject({ status: 'unchanged', outcome: 'Not increasing anything today: you mentioned pain. Sets unchanged.' });
  });

  it("a lighter-session request can't raise anything (check 23)", () => {
    const r = applied(
      validateTodayAdjustment(
        input(
          [
            adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(90), reps: null } }] }),
            adj(exId(3), { sets: [{ setId: setId(3, 0), target: { load: kg(45, 'stack'), reps: null } }] }),
          ],
          { intent: 'lighter_session' },
        ),
      ),
    );
    expect(r.exercises.map((e) => e.sessionExerciseId)).toEqual([exId(1)]);
    expect(r.guardNotes).toContainEqual({ kind: 'lighter_no_increase', setIds: [setId(3, 0)], text: 'No increases in a lighter session.' });
  });

  it('adding a set is an increase: blocked by a pain flag, allowed otherwise with a replay-stable ID', () => {
    const add = [adj(exId(1), { addSet: { load: kg(90), reps: null } })];
    expect(validateTodayAdjustment(input(add, { painFlags: [painFlag(1, 'Bench press')] })).status).toBe('unchanged');
    const a = applied(validateTodayAdjustment(input(add)));
    const b = applied(validateTodayAdjustment(input(add)));
    expect(a.exercises[0]?.added).toMatchObject({ setNumber: 5, after: { load: kg(90), reps: { min: 6, max: 8 } } });
    expect(a.exercises[0]?.added?.setId).toBe(b.exercises[0]?.added?.setId);
  });

  it('removing a pending set is allowed under a pain flag', () => {
    const r = applied(validateTodayAdjustment(input([adj(exId(1), { removeSetId: setId(1, 3) })], { painFlags: [painFlag(1, 'Bench press')] })));
    expect(r.exercises[0]?.removed).toMatchObject({ setId: setId(1, 3), setNumber: 4 });
    expect(r.exercises[0]?.changes).toContainEqual({ setId: setId(1, 3), setNumber: 4, before: { load: kg(100), reps: { min: 6, max: 8 } }, after: null });
  });
});

describe('validateTodayAdjustment: no-ops and bad input', () => {
  it('the coach keeping the plan is an outcome line, not a change', () => {
    const r = validateTodayAdjustment(
      input([
        adj(exId(1), {
          sets: [
            { setId: setId(1, 2), target: { load: kg(100), reps: null } },
            { setId: setId(1, 3), target: { load: kg(100), reps: null } },
          ],
        }),
      ]),
    );
    expect(r).toEqual({ status: 'unchanged', outcome: 'Coach kept sets 3–4 as planned.', guardNotes: [] });
  });

  it('a snap that lands back on the current target adds no note', () => {
    const r = validateTodayAdjustment(input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(101), reps: null } }] })], { intent: 'too_hard' }));
    expect(r).toEqual({ status: 'unchanged', outcome: 'Coach kept set 3 as planned.', guardNotes: [] });
  });

  it('unknown exercises and sets are ignored and noted', () => {
    const r = validateTodayAdjustment(input([adj(id(999)), adj(exId(1), { sets: [{ setId: setId(2, 0), target: { load: kg(95), reps: null } }] })]));
    expect(r.status).toBe('unchanged');
    expect(r.guardNotes.every((n) => n.kind === 'unknown_target')).toBe(true);
  });

  it('impossible rep ranges are refused', () => {
    const r = validateTodayAdjustment(input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: null, reps: { min: 0, max: 3 } } }] })]));
    expect(r.guardNotes[0]?.kind).toBe('invalid_reps');
  });
});

describe('setNumbersText', () => {
  it('formats ranges and lists', () => {
    expect(setNumbersText([4, 3])).toBe('sets 3–4');
    expect(setNumbersText([4])).toBe('set 4');
    expect(setNumbersText([2, 4])).toBe('sets 2, 4');
  });
});

// ---------------------------------------------------------------------------

function trig(over: Partial<TriggerSetInput> & { plannedRpe?: number | null; plannedRir?: number | null; reps?: [number, number] | null; actual?: TriggerSetInput['actual'] }): TriggerSetInput {
  return {
    id: id(1),
    version: 2,
    setType: over.setType ?? 'working',
    status: over.status ?? 'completed',
    planned: {
      reps: over.reps === undefined ? { min: 8, max: 10 } : over.reps === null ? null : { min: over.reps[0], max: over.reps[1] },
      rpe: over.plannedRpe ?? null,
      rir: over.plannedRir ?? null,
    },
    actual: over.actual === undefined ? { reps: 8, rpe: 8, rir: null } : over.actual,
  };
}

describe('evaluateCoachTrigger (rule T, D20)', () => {
  it('RPE 10 on a set planned at 8 offers "too hard" with the fact as entered (check 4)', () => {
    const t = evaluateCoachTrigger(trig({ plannedRpe: 8, actual: { reps: 8, rpe: 10, rir: null } }), 2);
    expect(t).toMatchObject({ kind: 'rpe_high', fact: 'RPE 10 on set 2', prompt: 'That looked hard. Adjust remaining sets?' });
  });

  it('a set planned at RPE 9 that came out at 10 doesn’t trigger (rule T compares with the plan)', () => {
    expect(evaluateCoachTrigger(trig({ plannedRpe: 9, actual: { reps: 8, rpe: 10, rir: null } }), 2)).toBeNull();
  });

  it('no planned effort falls back to the ADR 0006 thresholds (D20)', () => {
    expect(evaluateCoachTrigger(trig({ actual: { reps: 8, rpe: 9.5, rir: null } }), 1)?.kind).toBe('rpe_high');
    expect(evaluateCoachTrigger(trig({ actual: { reps: 8, rpe: 6, rir: null } }), 1)?.kind).toBe('rpe_low');
    expect(evaluateCoachTrigger(trig({ actual: { reps: 8, rpe: 9, rir: null } }), 1)).toBeNull();
  });

  it('reps short by 2 from the bottom of the range (CA5)', () => {
    expect(evaluateCoachTrigger(trig({ actual: { reps: 6, rpe: null, rir: null } }), 2)?.fact).toBe('6 reps on set 2 (target 8–10)');
    expect(evaluateCoachTrigger(trig({ actual: { reps: 7, rpe: null, rir: null } }), 2)).toBeNull();
  });

  it('"too easy" needs a plan of 8+ and never fires above 12 reps', () => {
    expect(evaluateCoachTrigger(trig({ plannedRpe: 7, actual: { reps: 8, rpe: 6, rir: null } }), 1)).toBeNull();
    expect(evaluateCoachTrigger(trig({ plannedRpe: 8, actual: { reps: 8, rpe: 6, rir: null } }), 1)?.kind).toBe('rpe_low');
    expect(evaluateCoachTrigger(trig({ plannedRpe: 8, reps: [12, 15], actual: { reps: 13, rpe: 5, rir: null } }), 1)).toBeNull();
  });

  it('RIR entries use their equivalents and quote RIR (§4.2)', () => {
    expect(evaluateCoachTrigger(trig({ plannedRir: 2, actual: { reps: 8, rpe: null, rir: 0 } }), 3)?.fact).toBe('RIR 0 on set 3');
    expect(evaluateCoachTrigger(trig({ plannedRir: 2, actual: { reps: 8, rpe: null, rir: 4 } }), 3)?.kind).toBe('rpe_low');
  });

  it('never on warm-ups, drop sets, planned all-out sets, pending sets, or when switched off (check 6)', () => {
    const hard = { reps: 4, rpe: 10, rir: null };
    expect(evaluateCoachTrigger(trig({ setType: 'warmup', actual: hard }), 1)).toBeNull();
    expect(evaluateCoachTrigger(trig({ setType: 'drop', actual: hard }), 1)).toBeNull();
    expect(evaluateCoachTrigger(trig({ plannedRpe: 10, actual: hard }), 1)).toBeNull();
    expect(evaluateCoachTrigger(trig({ plannedRir: 0, actual: hard }), 1)).toBeNull();
    expect(evaluateCoachTrigger(trig({ status: 'pending', actual: null }), 1)).toBeNull();
    expect(evaluateCoachTrigger(trig({ actual: hard }), 1, { ...{ enabled: false, rpeHigh: 9.5, plannedAtMostForHigh: 8.5, repsShortBy: 2, rpeLow: 6, plannedAtLeastForLow: 8, easyMaxReps: 12 } })).toBeNull();
  });

  it('10 on-target sets at RPE 7–8 never trigger (check 3: zero AI calls)', () => {
    const fired = [7, 7.5, 8, 7, 8, 7.5, 7, 8, 8, 7].map((rpe, i) => evaluateCoachTrigger(trig({ plannedRpe: 8, actual: { reps: 8, rpe, rir: null } }), i + 1));
    expect(fired.every((t) => t === null)).toBe(true);
  });

  it('the trigger ID is stable for the same set version', () => {
    const s = trig({ actual: { reps: 8, rpe: 10, rir: null } });
    expect(evaluateCoachTrigger(s, 1)?.triggerId).toBe(evaluateCoachTrigger(s, 1)?.triggerId);
    expect(evaluateCoachTrigger({ ...s, version: 3 }, 1)?.triggerId).not.toBe(evaluateCoachTrigger(s, 1)?.triggerId);
  });
});

describe('shouldShowCoachOffer (CA4, §4.2)', () => {
  const t = evaluateCoachTrigger(trig({ actual: { reps: 8, rpe: 10, rir: null } }), 2);
  if (t === null) throw new Error('fixture');
  const base = { trigger: t, sessionExerciseId: exId(1), resting: true, coachReachable: true, pending: false, log: [], lastAdjustedAtVersion: null };

  it('only while resting, reachable and idle', () => {
    expect(shouldShowCoachOffer(base)).toBe(true);
    expect(shouldShowCoachOffer({ ...base, resting: false })).toBe(false);
    expect(shouldShowCoachOffer({ ...base, coachReachable: false })).toBe(false);
    expect(shouldShowCoachOffer({ ...base, pending: true })).toBe(false);
  });

  it('once per exercise and kind, unless an adjustment was applied since (check 5)', () => {
    const entry = { sessionExerciseId: exId(1), kind: 'rpe_high' as const, atVersion: 5 };
    const log = [entry];
    expect(shouldShowCoachOffer({ ...base, log })).toBe(false);
    expect(shouldShowCoachOffer({ ...base, log, lastAdjustedAtVersion: 6 })).toBe(true);
    expect(shouldShowCoachOffer({ ...base, log: [{ ...entry, kind: 'rpe_low' as const }] })).toBe(true);
    expect(shouldShowCoachOffer({ ...base, log: [{ ...entry, sessionExerciseId: exId(2) }] })).toBe(true);
  });
});

describe('classifyPainMention (CM6)', () => {
  it.each([
    ['my shoulder hurts on this', 'pain'],
    ['felt a sharp pinch in my elbow', 'pain'],
    ['I think I tweaked my back', 'pain'],
    ['my knee’s a bit sore', 'unclear'],
    ['hamstrings feel tight', 'unclear'],
    ['my quads are burning', 'effort'],
    ['that was a grind', 'effort'],
    ['felt heavy today', 'effort'],
    ['no pain at all, just tired', 'effort'],
    ["it doesn't hurt", 'none'],
    ['drop the weight for the last two', 'none'],
    // Review B2: clear pain that used to come back as `none`.
    ["I can't press without pain", 'pain'],
    ['never had pain like this', 'pain'],
    ['not sure, it hurts', 'pain'],
    ['pulled something in my back', 'pain'],
    ['sprained ankle', 'pain'],
    ['my shoulder is killing me', 'pain'],
    ['felt a pop in my elbow', 'pain'],
    ['think I strained my hamstring', 'pain'],
    ['fingers went numb and tingling', 'pain'],
    ['throbbing in my wrist', 'pain'],
    ["it didn't hurt until set 3", 'pain'],
    // Only an immediately preceding negator cancels pain.
    ['no real pain, just heavy', 'effort'],
    ["it doesn't really hurt", 'none'],
    // A negator further back in the same clause is doubt: ask (CM6).
    ["I don't think it hurts", 'unclear'],
    ['knee feels a bit uncomfortable', 'unclear'],
    ["you're killing it", 'none'],
    // Review r2 B3: common injury talk that used to come back as `none`.
    ['my shoulder flared up', 'pain'],
    ['my shoulder flared up on the last set', 'pain'],
    ['my back spasmed', 'pain'],
    ['my knee is swollen', 'pain'],
    ['aggravated my elbow', 'pain'],
    ["it's bothering my wrist", 'pain'],
    ['rolled my ankle', 'pain'],
    ['my knee gave out', 'pain'],
    ['my back went', 'pain'],
    ['my lower back went on the last rep', 'pain'],
    ['my lower back is acting up', 'pain'],
    ['shoulder impingement again', 'pain'],
    ['tendinitis flaring', 'pain'],
    ['pins and needles in my hand', 'pain'],
    ['dislocated finger', 'pain'],
    ['bruised', 'pain'],
    ['calf cramped up', 'pain'],
    // A body part Ben owns with nothing else said is asked about, never `none`.
    ['my shoulder feels weird', 'unclear'],
    ['something going on with my left knee', 'unclear'],
    ['my elbows flared on that set', 'unclear'],
    // ... but not exercise names, praise or effort.
    ['leg press felt good', 'none'],
    ['back squat next', 'none'],
    ['my shoulder feels fine today', 'none'],
    ['my legs are cooked', 'effort'],
    ['foam rolled my quads', 'none'],
    ['back to 100 for set 3', 'none'],
    ['take 5 kg off the last set', 'none'],
    // Review r2 nit: "sharp" needs a body part.
    ['feeling sharp today', 'none'],
    ['sharp in my knee', 'pain'],
    ['shooting down my arm', 'pain'],
    ['my knee is not swollen', 'none'],
    // Review r3 B2: contractions ("knee's" is "knee is").
    ["my knee's not right", 'unclear'],
    ["my shoulder's a bit off", 'unclear'],
    ["my shoulder's weird", 'unclear'],
    ["my back's gone", 'unclear'],
    ["elbow's grumbling", 'unclear'],
    ["my shoulder's off today", 'unclear'],
    ['my shoulder is off today', 'unclear'],
    // Negated positives are asked about.
    ['my elbow is not great', 'unclear'],
    ["my elbow's not great", 'unclear'],
    ["The shoulder isn't happy today", 'unclear'],
    ["the hamstring's not happy", 'unclear'],
    ["Shoulder's not 100%", 'unclear'],
    ['not 100% today', 'unclear'],
    ['Not feeling great', 'unclear'],
    // A positive word with a carve-out doesn't cancel the body part.
    ['Felt good apart from my elbow', 'unclear'],
    ['Felt great except my wrist', 'unclear'],
    ['good session apart from the knee', 'unclear'],
    ['good, though my wrist', 'unclear'],
    // A body part without "my".
    ['the knee went again', 'pain'],
    ['left knee feels off', 'unclear'],
    ["I've got a dodgy knee", 'unclear'],
    ['Bad back today', 'unclear'],
    ['Achilles is grumbling', 'unclear'],
    ['knee is wonky', 'unclear'],
    ['wrist is iffy', 'unclear'],
    ['elbow was a bit off on the last set', 'unclear'],
    // Adversarial: more ways Ben may say it.
    ["Lower back's a bit tight", 'unclear'],
    ['Rotator cuff is cranky', 'unclear'],
    ['my hip is being weird', 'unclear'],
    ["ankle's dodgy again", 'unclear'],
    ['hip clicking on squats', 'unclear'],
    ['pressing felt off with the shoulder', 'unclear'],
    ['Legs feel weak', 'unclear'],
    ["neck's a bit stiff", 'unclear'],
    ['the elbow', 'unclear'],
    ['Knee', 'unclear'],
    // ... while plan talk, praise and other subjects stay as they were.
    ['shoulder pain-free today', 'none'],
    ['Shoulders next', 'none'],
    ['chest day today', 'none'],
    ["Sleep wasn't great", 'none'],
    ['bar speed not great', 'none'],
    ["That wasn't easy", 'effort'],
    ['hand me the chalk', 'none'],
    ['head over to the rack', 'none'],
    ['Back off the weight a bit', 'none'],
    ['my right knee feels great', 'none'],
    ['the knee is fine now', 'none'],
    ['knee and wrist are fine', 'none'],
    ["Cut's going well, down 2 kg", 'none'],
    ['great session', 'none'],
    ['calf raises next', 'none'],
    // Review r4 B2: gym anatomy.
    ['Delt feels weird', 'unclear'],
    ["Delt's angry", 'unclear'],
    ['My delts are wrecked', 'unclear'],
    ['Rear delt feels off', 'unclear'],
    ['Hammy went', 'pain'],
    ["Hammy's gone again", 'unclear'],
    ['Hip flexors are angry', 'unclear'],
    ['Adductor feels weird', 'unclear'],
    ['QL is cranky', 'unclear'],
    ['Psoas acting funny', 'unclear'],
    ['Piriformis is angry', 'unclear'],
    ['Teres feels off', 'unclear'],
    ['Scapula feels off', 'unclear'],
    ['Collarbone feels odd', 'unclear'],
    ['Core feels weird', 'unclear'],
    // Conditions.
    ['Sciatica bad today', 'pain'],
    ['Plantar fasciitis again', 'pain'],
    ['Slipped disc', 'pain'],
    ['Herniated disc acting up', 'pain'],
    ['Shin splints', 'pain'],
    ['Broke my toe', 'pain'],
    ['Tennis elbow is back', 'pain'],
    // A side or "one" with no named part.
    ['Left side is weird', 'unclear'],
    ['Right side feels off', 'unclear'],
    ['My left one is grumbling', 'unclear'],
    ['Not the best on the left side', 'unclear'],
    // A denied pain word followed by a vague one; "aint".
    ["Doesn't hurt, just feels wrong", 'unclear'],
    ["Doesn't hurt exactly, just off", 'unclear'],
    ['It aint right', 'unclear'],
    // Review r4 nit: "bad" before the part wins over "day".
    ['Bad shoulder day', 'unclear'],
    // Adversarial (r4): more of the same, and things that must stay `none`.
    ['IT band is cranky', 'unclear'],
    ['Obliques feel weird', 'unclear'],
    ['Rhomboid is grumbling', 'unclear'],
    ['Lumbar feels funny', 'unclear'],
    ['SI joint is angry', 'unclear'],
    ['Pinched nerve in my neck', 'pain'],
    ['Crick in my neck', 'pain'],
    ['Feels off today', 'unclear'],
    ["Something's not right", 'unclear'],
    ["Something's up with my hip", 'unclear'],
    ['It feels weird', 'unclear'],
    ['Feeling dizzy', 'unclear'],
    ['Heart racing', 'unclear'],
    ['Bit light headed', 'unclear'],
    ['Feeling sick', 'unclear'],
    ['Felt a tear', 'pain'],
    ['Tear in my shoulder', 'pain'],
    ['Wrist feels a bit off', 'unclear'],
    ['That set felt weird', 'unclear'],
    ['Tear down the rack', 'none'],
    ['Off to the gym', 'none'],
    ['Form felt off', 'none'],
    ['Left side felt fine', 'none'],
    ['Hip flexor stretch next', 'none'],
    ['Core work next', 'none'],
    ['Side raises next', 'none'],
    ['One more set', 'none'],
    ['Right, one more set', 'none'],
    ['Add a 5 kg disc', 'none'],
    ['Day off tomorrow', 'none'],
    ['Back off the weight a bit', 'none'],
    ['Take 5 off the last set', 'none'],
    ['The music is off', 'none'],
    ['Timer went off early', 'none'],
    ['The machine feels weird', 'none'],
    ['Heart rate was 150', 'none'],
    ['Broke my PR', 'none'],
    ['The app is broken', 'none'],
  ] as const)('%s → %s', (text, expected) => {
    expect(classifyPainMention(text)).toBe(expected);
  });
});

describe('classifyPainMention: review r5 B2 and S2 (rule 9, CM6)', () => {
  it.each([
    // Effort words next to a joint or tendon (the review's rows).
    'Burning in my elbow',
    'Burning sensation in my forearm',
    'Shoulder feels heavy',
    'Knee is hard to bend',
    "Elbow's fried",
    'Lower back is cooked',
    'Knee is cooked',
    'Shoulder is gassed',
    'My back is tired, weird tired',
    "Can't straighten it",
    "Can't grip properly",
    // Developer's adversarial rows.
    'my chest is burning',
    'Wrist is burning',
    'Achilles feels tired',
    'Neck is fried',
    'Elbow is hard to straighten',
    'Elbow burns on the way down',
    'My shoulder burns',
    'Knee is a bit tired',
    'Burning down my leg',
    "Can't feel my fingers",
    "Can't bend my elbow fully",
    'Hard to turn my neck',
    'My wrist is heavy and achy',
    'Tweaked my back last week',
    'My knee hurt yesterday',
    'It hurt last week, fine now',
  ])('asked about, never effort or none: %s', (text) => {
    expect(['pain', 'unclear']).toContain(classifyPainMention(text));
  });

  it.each([
    'Felt something go on the last rep',
    'Something gave on the last rep',
    'Felt a pull',
    'Something twanged',
    'Bit of a twang',
    'Heard a crack',
    'Felt a click and then nothing',
    'Ow',
    'Owww',
    'Owwwww',
    'Argh',
    'Aaargh',
    'That stung',
    'Stings a bit',
    'It stings',
    'Pins & needles',
    'Ouch, my wrist',
    'Felt something shift in my back',
    'Felt a twinge',
    'Something popped',
    'Heard a pop in my knee',
    'Felt it pop',
    'Felt that tear',
    'Something went in my neck',
    'Felt a ping in my hammy',
    'Hammy pinged',
  ])('pain: %s', (text) => {
    expect(classifyPainMention(text)).toBe('pain');
  });

  it.each([
    ["Knee hasn't hurt since Tuesday", 'none'],
    // A negator a few words back is a doubt, so CM6 asks (conservative): not `none`.
    ["Elbow hasn't been painful", 'unclear'],
    ["Haven't had any pain", 'unclear'],
    ["Hasn't hurt", 'none'],
    ['Pulled 200 today', 'none'],
    ['Pulled 180 for a single', 'none'],
    ['Popped another plate on', 'none'],
    ['Popped a plate on each side', 'none'],
    ["Let's crack on", 'none'],
    ['Cracked 100 on bench', 'none'],
    ['Snapped a photo of the rack', 'none'],
    ['Felt it go up easy', 'none'],
    ["Can't lift any more", 'none'],
    ['Ping me when it is my set', 'none'],
    // Effort next to a muscle stays effort.
    ['my quads are burning', 'effort'],
    ['legs are fried', 'effort'],
    ['Arms are cooked', 'effort'],
    ['Hamstrings are cooked', 'effort'],
    ['Calves are burning', 'effort'],
    ['Back squat felt heavy', 'effort'],
  ] as const)('%s → %s', (text, expected) => {
    expect(classifyPainMention(text)).toBe(expected);
  });

  it('painBodyPart names the part for the guard note', () => {
    expect(painBodyPart('Way too easy, but my knee hurts')).toBe('knee');
    expect(painBodyPart("Bump it up, shoulder's niggly")).toBe('shoulder');
    expect(painBodyPart('my lower back is sore')).toBe('lower back');
    expect(painBodyPart('my left side is weird')).toBe('left side');
    expect(painBodyPart('Leg press felt heavy')).toBeNull();
    expect(painBodyPart('It stings')).toBeNull();
  });
});

describe('validateTodayAdjustment: pain in the same message blocks increases (review r5 B4, rule 9)', () => {
  const said = (text: string, exerciseIds: string[] = []): NonNullable<TodayAdjustmentInput['messagePain']> => ({
    mention: classifyPainMention(text),
    exerciseIds,
    bodyPart: painBodyPart(text),
  });
  const raiseBench = [adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(102.5), reps: null } }] })];

  it('"Way too easy, but my knee hurts": no increase anywhere, with a note naming the knee', () => {
    const r = validateTodayAdjustment(input(raiseBench, { intent: 'too_easy', messagePain: said('Way too easy, but my knee hurts') }));
    expect(r).toMatchObject({ status: 'unchanged', outcome: 'Not increasing anything: you mentioned your knee. Sets unchanged.' });
    expect(r.guardNotes).toContainEqual({ kind: 'pain_unspecified', setIds: [setId(1, 2)], text: 'Not increasing anything: you mentioned your knee.' });
  });

  it('"Bump it up, shoulder\'s niggly": unclear still blocks until Ben has answered "Sore or pain?"', () => {
    expect(said("Bump it up, shoulder's niggly").mention).toBe('unclear');
    const r = validateTodayAdjustment(input(raiseBench, { intent: 'general', messagePain: said("Bump it up, shoulder's niggly") }));
    expect(r).toMatchObject({ status: 'unchanged', outcome: 'Not increasing anything: you mentioned your shoulder. Sets unchanged.' });
  });

  it('"Add 5 kg to squat, my knee is sore": the named movement gets no increase', () => {
    const squatUp = [adj(exId(5), { sets: [{ setId: setId(5, 1), target: { load: lb(235), reps: null } }] })];
    const named = said('Add 5 kg to squat, my knee is sore', [id(5 + 1000)]);
    const r = validateTodayAdjustment(input(squatUp, { intent: 'general', messagePain: named }));
    expect(r).toMatchObject({ status: 'unchanged', outcome: 'Not increasing Squat: you mentioned your knee. Sets unchanged.' });
    // A mention, not a flag: its own note kind so no screen claims a pain flag exists (minimal-copy review B1).
    expect(r.guardNotes).toContainEqual({ kind: 'pain_mentioned', setIds: [setId(5, 1)], text: 'Not increasing Squat: you mentioned your knee.' });
    expect(r.guardNotes.some((n) => n.kind === 'pain_blocked')).toBe(false);
    // Another movement isn't blocked when a movement was named.
    expect(validateTodayAdjustment(input(raiseBench, { intent: 'too_easy', messagePain: named })).status).toBe('apply');
    // Nothing named: every movement is blocked.
    expect(validateTodayAdjustment(input(raiseBench, { intent: 'too_easy', messagePain: said('Add 5 kg, my knee is sore') })).status).toBe('unchanged');
  });

  it('adding a set is an increase and is blocked too; lowering and removing still apply', () => {
    const pain = said('Way too easy, but my knee hurts');
    expect(validateTodayAdjustment(input([adj(exId(1), { addSet: { load: kg(90), reps: null } })], { messagePain: pain })).status).toBe('unchanged');
    const lower = applied(validateTodayAdjustment(input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(95), reps: null } }] })], { messagePain: pain })));
    expect(lower.exercises[0]?.changes[0]?.after?.load).toEqual(kg(95));
    expect(applied(validateTodayAdjustment(input([adj(exId(1), { removeSetId: setId(1, 3) })], { messagePain: pain }))).exercises[0]?.removed).not.toBeNull();
  });

  it('effort or nothing in the message doesn\'t block', () => {
    for (const text of ['Way too easy', 'my quads are burning, add weight']) {
      expect(validateTodayAdjustment(input(raiseBench, { intent: 'too_easy', messagePain: said(text) })).status, text).toBe('apply');
    }
    expect(validateTodayAdjustment(input(raiseBench, { intent: 'too_easy', messagePain: null })).status).toBe('apply');
  });

  it('a saved flag still wins over the message note for its own movement', () => {
    const r = validateTodayAdjustment(input(raiseBench, { intent: 'too_easy', painFlags: [painFlag(1, 'Bench press')], messagePain: said('my knee hurts') }));
    expect(r).toMatchObject({ status: 'unchanged', outcome: 'Not increasing: you flagged shoulder pain. Sets unchanged.' });
  });
});

describe('exercisesNamedForPain: only whole names narrow the pain block (coach review B2, rule 9)', () => {
  const ex = (n: number, name: string) => ({ exerciseId: id(n), exerciseName: name });
  const workoutExercises = [ex(1, 'Back squat'), ex(2, 'Romanian deadlift'), ex(3, 'Chest-supported row'), ex(4, 'Cable fly'), ex(5, 'Calf raise'), ex(6, 'Shoulder press'), ex(7, 'Bench press')];
  const said = (text: string): NonNullable<TodayAdjustmentInput['messagePain']> => ({ mention: classifyPainMention(text), exerciseIds: exercisesNamedForPain(text, workoutExercises), bodyPart: painBodyPart(text) });

  it.each([
    "back's a bit sore, add 5 to the deadlifts",
    'chest is tight, more on flyes',
    'calf is cramping, heavier squats',
    "shoulder's niggly, bump the shoulder press",
    'my back hurts, add 5 to back squat',
  ])('%s → nothing named, so every increase is blocked', (text) => {
    expect(exercisesNamedForPain(text, workoutExercises)).toEqual([]);
    expect(['pain', 'unclear']).toContain(classifyPainMention(text));
  });

  it('a body-part word alone never names an exercise that starts with it', () => {
    expect(exercisesNamedForPain('back is fine, add 5', workoutExercises)).toEqual([]);
    expect(exercisesNamedForPain('more on chest today', workoutExercises)).toEqual([]);
  });

  it('a whole name with no body part narrows to that movement (plural allowed)', () => {
    expect(exercisesNamedForPain('bench press hurts, add 5 to the romanian deadlifts', workoutExercises)).toEqual([id(2), id(7)]);
    expect(exercisesNamedForPain('Bench press is hurting', workoutExercises)).toEqual([id(7)]);
  });

  it('"back\'s a bit sore, add 5 to the deadlifts": the RDL increase is blocked', () => {
    const agg = workout();
    const rdl = agg.exercises[0];
    if (!rdl) throw new Error('fixture');
    const named = exercisesNamedForPain("back's a bit sore, add 5 to the deadlifts", [{ exerciseId: rdl.exerciseId, exerciseName: 'Romanian deadlift' }, { exerciseId: id(999), exerciseName: 'Back squat' }]);
    expect(named).toEqual([]);
    const r = validateTodayAdjustment(input([adj(exId(1), { sets: [{ setId: setId(1, 2), target: { load: kg(102.5), reps: null } }] })], { intent: 'general', messagePain: said("back's a bit sore, add 5 to the deadlifts") }));
    expect(r.status).toBe('unchanged');
  });
});

describe('getStructuralChangeSignals (CA9)', () => {
  const base = () => ({ source: workout(), painFlags: [] as PainFlag[], varietyRequests: [], currentEquipment: [BAR, DB, STACK, ASSIST, LB_BAR], nextGymId: GYM, nowUtc: T0 });

  it('no request and nothing changed → no signal', () => {
    expect(getStructuralChangeSignals(base())).toEqual([]);
  });

  it('an unanswered variety request is a signal; an answered one is not', () => {
    const s = getStructuralChangeSignals({ ...base(), varietyRequests: [{ id: 'r1', atUtc: T0, answered: false }, { id: 'r2', atUtc: T0, answered: true }] });
    expect(s).toEqual([{ kind: 'variety_request', fact: 'you asked for some variety.', atUtc: T0, ref: 'r1' }]);
  });

  it('a pain flag on one of the workout’s movements, set since it started', () => {
    const s = getStructuralChangeSignals({ ...base(), painFlags: [painFlag(1, 'Bench press', 'shoulder', 30), painFlag(2, 'Incline DB press', 'elbow', -3600)] });
    expect(s.map((x) => x.fact)).toEqual(['you flagged shoulder pain on Bench press.']);
  });

  it('equipment edited or retired, or a different gym next time', () => {
    const edited = { ...DB, version: 2, updatedAtUtc: '2026-10-09T06:00:00.000Z' };
    const retired = { ...STACK, availability: 'retired' as const };
    const s = getStructuralChangeSignals({ ...base(), currentEquipment: [BAR, edited, retired, ASSIST, LB_BAR] });
    expect(s.map((x) => x.fact)).toEqual(['Home dumbbells was changed.', 'Cable stack is no longer in your gym.']);
    const moved = getStructuralChangeSignals({ ...base(), nextGymId: id(3) });
    expect(moved).toEqual([{ kind: 'equipment_changed', fact: 'your next workout is at a different gym.', atUtc: T0, ref: id(3) }]);
  });

  it('never invents goal or schedule signals (none exist in v1)', () => {
    const kinds = getStructuralChangeSignals({ ...base(), varietyRequests: [{ id: 'r', atUtc: T0, answered: false }] }).map((s) => s.kind);
    expect(kinds).not.toContain('goal_changed');
    expect(kinds).not.toContain('schedule_changed');
  });
});


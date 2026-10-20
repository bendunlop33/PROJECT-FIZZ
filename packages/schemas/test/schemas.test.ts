import { describe, expect, it } from 'vitest';
import {
  CatalogueKeySchema,
  CatalogueMeasurementSchema,
  EquipmentInstanceSchema,
  ExerciseSchema,
  MeasurementSchema,
  LoadSchema,
  PainFlagSchema,
  PlannedSetSchema,
  ProgressionRuleSchema,
  RpeSchema,
  SessionCommandSchema,
  SetTemplateSchema,
  WorkoutSetSchema,
  ZonedTimestampSchema,
  validate,
} from '../src/index';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-10-08T06:00:00.000Z';
const meta = { id: id(1), ownerId: id(2), version: 1, createdAtUtc: T, updatedAtUtc: T };
const at = { utc: T, tz: 'Pacific/Auckland' };

describe('Load', () => {
  it('requires an explicit unit and convention', () => {
    expect(validate(LoadSchema, { value: 100 }).ok).toBe(false);
    expect(validate(LoadSchema, { value: 100, unit: 'kg' }).ok).toBe(false);
    expect(validate(LoadSchema, { value: 100, unit: 'kg', convention: 'total' }).ok).toBe(true);
  });

  it('rejects unknown units and negative values', () => {
    expect(validate(LoadSchema, { value: 100, unit: 'kgs', convention: 'total' }).ok).toBe(false);
    expect(validate(LoadSchema, { value: -1, unit: 'kg', convention: 'total' }).ok).toBe(false);
  });

  it('bodyweight loads carry no external value', () => {
    expect(validate(LoadSchema, { value: 0, unit: 'kg', convention: 'bodyweight' }).ok).toBe(true);
    expect(validate(LoadSchema, { value: 10, unit: 'kg', convention: 'bodyweight' }).ok).toBe(false);
  });
});

describe('RPE', () => {
  it('accepts half steps between 1 and 10 only', () => {
    expect(validate(RpeSchema, 8.5).ok).toBe(true);
    expect(validate(RpeSchema, 8.25).ok).toBe(false);
    expect(validate(RpeSchema, 11).ok).toBe(false);
  });
});

describe('ZonedTimestamp', () => {
  it('requires UTC with Z and a real IANA zone', () => {
    expect(validate(ZonedTimestampSchema, at).ok).toBe(true);
    expect(validate(ZonedTimestampSchema, { utc: '2026-10-08T19:00:00+13:00', tz: 'Pacific/Auckland' }).ok).toBe(false);
    expect(validate(ZonedTimestampSchema, { utc: T, tz: 'Mars/Olympus' }).ok).toBe(false);
  });
});

describe('EquipmentInstance', () => {
  const common = { ...meta, gymId: id(3), name: 'Rack', unit: 'kg', movementTags: [], availability: 'available' };

  it('accepts a barbell with plate inventory', () => {
    const r = validate(EquipmentInstanceSchema, {
      ...common,
      kind: 'barbell',
      loadConvention: 'total',
      barMass: 20,
      plates: [{ mass: 20, count: 4 }, { mass: 1.25, count: 2 }],
      maxLoad: 200,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a load convention that contradicts the kind', () => {
    const r = validate(EquipmentInstanceSchema, {
      ...common,
      kind: 'dumbbells',
      loadConvention: 'total',
      loads: [10, 12.5],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects unsorted or duplicate dumbbell loads', () => {
    const base = { ...common, kind: 'dumbbells', loadConvention: 'per_hand' };
    expect(validate(EquipmentInstanceSchema, { ...base, loads: [10, 12.5, 15] }).ok).toBe(true);
    expect(validate(EquipmentInstanceSchema, { ...base, loads: [12.5, 10] }).ok).toBe(false);
    expect(validate(EquipmentInstanceSchema, { ...base, loads: [10, 10] }).ok).toBe(false);
  });

  it('rejects min above max and max below the bar', () => {
    const bar = { ...common, kind: 'barbell', loadConvention: 'total', barMass: 20, plates: [] };
    expect(validate(EquipmentInstanceSchema, { ...bar, minLoad: 50, maxLoad: 40 }).ok).toBe(false);
    expect(validate(EquipmentInstanceSchema, { ...bar, maxLoad: 15 }).ok).toBe(false);
  });

  it('assisted machines declare the assistance convention', () => {
    const r = validate(EquipmentInstanceSchema, {
      ...common,
      kind: 'assisted_stack',
      loadConvention: 'assistance',
      assistanceLoads: [5, 10, 15],
    });
    expect(r.ok).toBe(true);
  });

  it('reports issue paths', () => {
    const r = validate(EquipmentInstanceSchema, { ...common, kind: 'barbell', loadConvention: 'total', barMass: 20, plates: [{ mass: 20, count: 1.5 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe('plates.0.count');
  });
});

describe('SetTemplate', () => {
  it('needs a rep or duration target', () => {
    const t = { id: id(9), setType: 'working', targetLoad: null, targetRpe: null, targetRir: null, restOverrideS: null };
    expect(validate(SetTemplateSchema, { ...t, targetReps: null, targetDurationS: null }).ok).toBe(false);
    expect(validate(SetTemplateSchema, { ...t, targetReps: { min: 6, max: 8 }, targetDurationS: null }).ok).toBe(true);
    expect(validate(SetTemplateSchema, { ...t, targetReps: { min: 8, max: 6 }, targetDurationS: null }).ok).toBe(false);
  });
});

describe('ProgressionRule', () => {
  it('is a discriminated union on method with explicit increment units', () => {
    const rule = {
      ...meta,
      name: 'Bench DP',
      method: 'double_progression',
      repRange: { min: 6, max: 8 },
      workingSets: 3,
      loadIncrement: { value: 2.5, unit: 'kg' },
      startingLoad: null,
      failuresBeforeReduce: 2,
      reducePercent: 10,
      maxLoadJump: null,
      maxRpeToProgress: 9,
      minRirToProgress: null,
      ceilingRepCap: 12,
    };
    expect(validate(ProgressionRuleSchema, rule).ok).toBe(true);
    expect(validate(ProgressionRuleSchema, { ...rule, loadIncrement: 2.5 }).ok).toBe(false);
    expect(validate(ProgressionRuleSchema, { ...rule, failuresBeforeReduce: 1 }).ok).toBe(false);
    // Review M1: a rep cap below the top of the range would yield a 12–10 target.
    const capped = validate(ProgressionRuleSchema, { ...rule, repRange: { min: 8, max: 12 }, ceilingRepCap: 10 });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.issues[0]?.path).toBe('ceilingRepCap');
  });
});

describe('SessionCommand', () => {
  it('parses a log_set command', () => {
    const r = validate(SessionCommandSchema, {
      type: 'log_set',
      at,
      opId: 'op-1',
      setId: id(5),
      restTimerId: id(6),
      values: { load: { value: 100, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects unknown command types and missing operation IDs', () => {
    expect(validate(SessionCommandSchema, { type: 'delete_everything', at }).ok).toBe(false);
    expect(validate(SessionCommandSchema, { type: 'pause', at }).ok).toBe(false);
  });

  it('update_session_timing needs something to change', () => {
    const base = { type: 'update_session_timing', at, opId: 't', expectedVersion: 2 };
    expect(validate(SessionCommandSchema, { ...base, startedAt: null, endedAt: null }).ok).toBe(false);
    expect(validate(SessionCommandSchema, { ...base, startedAt: at, endedAt: null }).ok).toBe(true);
  });

  it('rejects a correction without an expected version', () => {
    expect(validate(SessionCommandSchema, { type: 'correct_set', at, opId: 'x', setId: id(5), patch: { reps: 7 } }).ok).toBe(false);
  });
});

describe('Exercise (ADR 0010 additive fields)', () => {
  const base = {
    id: id(10),
    ownerId: null,
    source: 'catalogue',
    name: 'Back squat',
    movementPattern: 'squat',
    primaryMuscles: ['quads', 'glutes'],
    measurement: 'reps',
    laterality: 'bilateral',
    compatibleEquipment: ['barbell'],
    defaultLoadConvention: 'total',
    version: 1,
    createdAtUtc: T,
    updatedAtUtc: T,
  };

  it('still accepts a row without any of the new fields', () => {
    expect(validate(ExerciseSchema, base).ok).toBe(true);
  });

  it('accepts secondary muscles, catalogue key, family and mechanic', () => {
    const r = validate(ExerciseSchema, {
      ...base,
      secondaryMuscles: ['adductors', 'core'],
      catalogueKey: 'barbell-back-squat',
      family: 'squat',
      mechanic: 'compound',
    });
    expect(r.ok).toBe(true);
    expect(validate(ExerciseSchema, { ...base, catalogueKey: null }).ok).toBe(true);
    expect(validate(ExerciseSchema, { ...base, mechanic: 'hybrid' }).ok).toBe(false);
  });

  it('accepts the new conditioning equipment kinds on exercises', () => {
    for (const kind of ['kettlebell', 'sled', 'erg', 'medicine_ball', 'sandbag', 'band', 'ez_bar', 'trap_bar']) {
      expect(validate(ExerciseSchema, { ...base, compatibleEquipment: [kind] }).ok).toBe(true);
    }
    expect(validate(ExerciseSchema, { ...base, compatibleEquipment: ['trampoline'] }).ok).toBe(false);
  });

  it('gym equipment instances accept the gym kinds only (ADR 0030 adds kettlebells, EZ / trap bar, Smith, bench, rack)', () => {
    const item = { ...meta, gymId: id(3), unit: 'kg', movementTags: [], availability: 'available' };
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'sled', name: 'Sled', loadConvention: 'added' }).ok).toBe(false);
    // Each bar has its own weight: an EZ bar is its own item, never a stand-in for the Olympic bar.
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'ez_bar', name: 'EZ bar', loadConvention: 'total', barMass: 10, plates: [] }).ok).toBe(true);
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'trap_bar', name: 'Trap bar', loadConvention: 'total', barMass: 25, plates: [], maxLoad: 20 }).ok).toBe(false);
    // A Smith machine logs plates added; its bar weight is beside the load, never a total.
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'smith_machine', name: 'Smith', loadConvention: 'added', barMass: 15, plates: [] }).ok).toBe(true);
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'smith_machine', name: 'Smith', loadConvention: 'total', barMass: 15, plates: [] }).ok).toBe(false);
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'kettlebell', name: 'KB', loadConvention: 'per_hand', loads: [8, 12, 16] }).ok).toBe(true);
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'kettlebell', name: 'KB', loadConvention: 'total', loads: [8] }).ok).toBe(false);
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'bench', name: 'Bench', loadConvention: 'bodyweight', benchType: 'adjustable' }).ok).toBe(true);
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'bench', name: 'Bench', loadConvention: 'bodyweight', benchType: 'decline' }).ok).toBe(false);
    expect(validate(EquipmentInstanceSchema, { ...item, kind: 'rack', name: 'Rack', loadConvention: 'bodyweight', rackType: 'power_rack' }).ok).toBe(true);
  });

  it('distance is loggable now that sets record metres (ADR 0011, merged 11 Oct)', () => {
    expect(validate(CatalogueMeasurementSchema, 'distance').ok).toBe(true);
    expect(validate(MeasurementSchema, 'distance').ok).toBe(true);
    expect(validate(ExerciseSchema, { ...base, measurement: 'distance' }).ok).toBe(true);
    expect(validate(MeasurementSchema, 'laps').ok).toBe(false);
  });

  it('catalogue keys are kebab-case', () => {
    expect(validate(CatalogueKeySchema, 'barbell-back-squat').ok).toBe(true);
    expect(validate(CatalogueKeySchema, 'Barbell Back Squat').ok).toBe(false);
    expect(validate(CatalogueKeySchema, 'barbell--squat').ok).toBe(false);
  });
});

describe('PlannedSet provenance (Why?, active-workout §2.12)', () => {
  const kg = (value: number) => ({ value, unit: 'kg', convention: 'total' });
  const planned = { load: kg(102.5), reps: { min: 3, max: 6 }, durationS: null, rpe: null, rir: null, source: 'built_in_rule' };
  const provenance = {
    source: 'rule',
    setAt: at,
    routineName: null,
    requestedLoad: null,
    basis: {
      sessionId: id(10),
      performedAt: at,
      routineName: 'Push A',
      gymId: id(11),
      equipmentId: id(12),
      sets: [{ setId: id(13), version: 1, setType: 'working', side: null, values: { load: kg(100), reps: 6, durationS: null, rpe: 8, rir: null } }],
    },
    rule: { name: 'Double progression', decision: 'increase_load', summary: 'Increase to 102.5 kg for 3–6 reps.', facts: [] },
    step: { from: kg(100), to: kg(102.5), pctChange: 2.5, smallest: true, equipmentKind: 'barbell' },
    guardNotes: [],
  };

  it('is optional, so targets stored before it existed still read', () => {
    expect(validate(PlannedSetSchema, planned).ok).toBe(true);
  });

  it('round-trips a stored provenance unchanged', () => {
    const r = validate(PlannedSetSchema, { ...planned, provenance });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.provenance).toEqual(provenance);
  });

  it('rejects an unknown source or decision, and a basis load without its unit', () => {
    expect(validate(PlannedSetSchema, { ...planned, provenance: { ...provenance, source: 'coach_guess' } }).ok).toBe(false);
    expect(validate(PlannedSetSchema, { ...planned, provenance: { ...provenance, rule: { ...provenance.rule, decision: 'vibes' } } }).ok).toBe(false);
    const noUnit = { ...provenance.basis, sets: [{ ...provenance.basis.sets[0], values: { load: { value: 100, convention: 'total' }, reps: 6, durationS: null, rpe: null, rir: null } }] };
    expect(validate(PlannedSetSchema, { ...planned, provenance: { ...provenance, basis: noUnit } }).ok).toBe(false);
  });
});

describe('PainFlag reviews (Still hurts?, active-workout §2.14.2)', () => {
  const flag = {
    ...meta,
    exerciseId: id(20),
    exerciseName: 'Overhead press',
    area: 'shoulder',
    source: 'check_in',
    checkInId: id(21),
    reportedAt: at,
    status: 'active',
    clearedAtUtc: null,
    createdByOpId: 'pain-op',
  };
  const review = { at, answer: 'still_hurts', opId: 'review-1' };

  it('reads a flag saved before reviews existed (no field at all)', () => {
    const r = validate(PainFlagSchema, flag);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reviews).toBeUndefined();
  });

  it('round-trips reviews, including one that was undone', () => {
    const reviews = [review, { ...review, opId: 'review-2', undone: { atUtc: T, opId: 'undo-2' } }];
    const r = validate(PainFlagSchema, { ...flag, reviews });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reviews).toEqual(reviews);
  });

  it('records only `still_hurts`: a review is never a way to clear a flag', () => {
    expect(validate(PainFlagSchema, { ...flag, reviews: [{ ...review, answer: 'better' }] }).ok).toBe(false);
    expect(validate(PainFlagSchema, { ...flag, reviews: [{ ...review, answer: 'cleared' }] }).ok).toBe(false);
  });

  it('needs an operation ID and a zoned time on every review', () => {
    expect(validate(PainFlagSchema, { ...flag, reviews: [{ at, answer: 'still_hurts' }] }).ok).toBe(false);
    expect(validate(PainFlagSchema, { ...flag, reviews: [{ ...review, at: { utc: T } }] }).ok).toBe(false);
  });
});

describe('Set exclusions (sets that don\'t count, active-workout §2.13)', () => {
  const values = { load: { value: 100, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: 9, rir: null };
  const done = {
    id: id(5),
    sessionId: id(6),
    sessionExerciseId: id(7),
    index: 0,
    setType: 'working',
    status: 'completed',
    side: null,
    pairedWithSetId: null,
    planned: { load: null, reps: null, durationS: null, rpe: null, rir: null },
    rest: { seconds: 120, source: 'global_default', sourceLabel: 'Default' },
    actual: values,
    draft: null,
    completedAt: at,
    completedByOpId: 'log-1',
    undoCount: 0,
    flags: [],
    edited: false,
    version: 2,
  };

  it('reads a set saved before exclusions existed (no field): it counts', () => {
    const r = validate(WorkoutSetSchema, done);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.exclusions).toBeUndefined();
  });

  it('accepts the four reasons, each at most once', () => {
    expect(validate(WorkoutSetSchema, { ...done, exclusions: ['spotted', 'pain', 'technique', 'other_equipment'] }).ok).toBe(true);
    expect(validate(WorkoutSetSchema, { ...done, exclusions: ['spotted', 'spotted'] }).ok).toBe(false);
    expect(validate(WorkoutSetSchema, { ...done, exclusions: ['assisted'] }).ok).toBe(false);
  });

  it('only a logged set can carry exclusions', () => {
    const pending = { ...done, status: 'pending', actual: null, completedAt: null, completedByOpId: null };
    expect(validate(WorkoutSetSchema, { ...pending, exclusions: [] }).ok).toBe(true);
    expect(validate(WorkoutSetSchema, { ...pending, exclusions: ['spotted'] }).ok).toBe(false);
  });

  it('correct_set and log_set take an exclusions list', () => {
    const correct = { type: 'correct_set', at, opId: 'c', setId: id(5), expectedSetVersion: 2, patch: { exclusions: ['spotted'] } };
    expect(validate(SessionCommandSchema, correct).ok).toBe(true);
    expect(validate(SessionCommandSchema, { ...correct, patch: { exclusions: [] } }).ok).toBe(true);
    expect(validate(SessionCommandSchema, { ...correct, patch: { exclusions: ['form'] } }).ok).toBe(false);
    const log = { type: 'log_set', at, opId: 'l', setId: id(5), restTimerId: id(8), values, exclusions: ['technique'] };
    expect(validate(SessionCommandSchema, log).ok).toBe(true);
    // `pain` only through the correction service, which also flags the movement (AW7, review N3).
    expect(validate(SessionCommandSchema, { ...log, exclusions: ['pain'] }).ok).toBe(false);
    expect(validate(SessionCommandSchema, { ...log, exclusions: ['spotted', 'pain'] }).ok).toBe(false);
    expect(validate(SessionCommandSchema, { ...correct, patch: { exclusions: ['pain'] } }).ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CatalogueKeySchema,
  CatalogueMeasurementSchema,
  EquipmentInstanceSchema,
  ExerciseSchema,
  MeasurementSchema,
  LoadSchema,
  ProgressionRuleSchema,
  RpeSchema,
  SessionCommandSchema,
  SetTemplateSchema,
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
    for (const kind of ['kettlebell', 'sled', 'erg', 'medicine_ball', 'sandbag', 'band']) {
      expect(validate(ExerciseSchema, { ...base, compatibleEquipment: [kind] }).ok).toBe(true);
    }
    expect(validate(ExerciseSchema, { ...base, compatibleEquipment: ['trampoline'] }).ok).toBe(false);
  });

  it('gym equipment instances still only accept the six instance kinds', () => {
    const r = validate(EquipmentInstanceSchema, { ...meta, kind: 'sled', gymId: id(3), name: 'Sled', unit: 'kg', movementTags: [], availability: 'available', loadConvention: 'added' });
    expect(r.ok).toBe(false);
  });

  it('keeps distance out of loggable measurements until distance logging exists', () => {
    expect(validate(CatalogueMeasurementSchema, 'distance').ok).toBe(true);
    expect(validate(MeasurementSchema, 'distance').ok).toBe(false);
    expect(validate(ExerciseSchema, { ...base, measurement: 'distance' }).ok).toBe(false);
  });

  it('catalogue keys are kebab-case', () => {
    expect(validate(CatalogueKeySchema, 'barbell-back-squat').ok).toBe(true);
    expect(validate(CatalogueKeySchema, 'Barbell Back Squat').ok).toBe(false);
    expect(validate(CatalogueKeySchema, 'barbell--squat').ok).toBe(false);
  });
});

import { z } from 'zod';
import {
  IdSchema,
  RecordMetaSchema,
  UtcTimestampSchema,
  WeightUnitSchema,
} from './common';

const positiveMass = z.number().positive();

/** Plates of one mass. `count` is the number of physical plates, not pairs. */
export const PlateCountSchema = z.object({
  mass: positiveMass,
  count: z.int().min(0).max(200),
});
export type PlateCount = z.infer<typeof PlateCountSchema>;

function uniqueAscending(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const cur = values[i];
    if (prev === undefined || cur === undefined || cur <= prev) return false;
  }
  return true;
}

const loadList = z
  .array(positiveMass)
  .min(1)
  .max(500)
  .refine(uniqueAscending, { message: 'Loads must be unique and ascending' });

const plateList = z
  .array(PlateCountSchema)
  .max(50)
  .refine((ps) => new Set(ps.map((p) => p.mass)).size === ps.length, {
    message: 'Each plate mass appears once',
  });

const equipmentCommon = RecordMetaSchema.extend({
  gymId: IdSchema,
  name: z.string().min(1).max(120),
  make: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  station: z.string().max(120).optional(),
  /** Unit of every number on this equipment instance. */
  unit: WeightUnitSchema,
  /** Movement/exercise tags used for compatibility and substitution. */
  movementTags: z.array(z.string().min(1).max(60)).max(50),
  /** Optional lower bound below the physical minimum (e.g. user preference). */
  minLoad: z.number().nonnegative().optional(),
  /** Hard ceiling. Targets never exceed this (CLAUDE.md rule 4). */
  maxLoad: z.number().positive().optional(),
  /** Permanent availability. Temporary "busy today" lives on the session. */
  availability: z.enum(['available', 'retired']),
  notes: z.string().max(2000).optional(),
  /**
   * Where the numbers came from (gym-editor.md GE1): `preset` = typical values
   * from a gym preset that Ben hasn't checked yet ("Typical values, not
   * checked"); `user` = entered or confirmed by Ben. Absent = `user`.
   */
  detailsSource: z.enum(['preset', 'user']).optional(),
  /** When Ben last saved this item's details. */
  checkedAtUtc: UtcTimestampSchema.optional(),
  /**
   * (Ben, 20 Oct: "update as we go") Exercises Ben said aren't at this gym
   * (`Not at this gym`, or the coach's `update_gym` on his words): this item
   * is never mapped to them, so they leave this gym's builds and pickers.
   * Absent = none.
   */
  notFor: z.array(IdSchema).max(500).optional(),
  /**
   * (Review quickgym B2) This item is only for these exercises: a machine's own
   * stack learned from Ben's loads ("Leg extension goes up in 7 kg?"), so the
   * family item (`Machines`) keeps its assumed step for every other machine.
   * The family item lists the exercise in `notFor`. Absent = any exercise.
   */
  onlyFor: z.array(IdSchema).min(1).max(50).optional(),
});

/** A bar loaded with plates: the load is the total including the bar (`barMass`). */
const barAndPlates = {
  loadConvention: z.literal('total'),
  barMass: z.number().nonnegative(),
  plates: plateList,
};

export const BarbellSchema = equipmentCommon.extend({
  kind: z.literal('barbell'),
  ...barAndPlates,
});

/**
 * (Ben, 20 Oct; ADR 0030) Specialty bars: each has its own bar weight, so
 * their exercises are never planned on the Olympic bar (rule 4). Loads are
 * the total including the bar, as on a barbell.
 */
export const EzBarSchema = equipmentCommon.extend({ kind: z.literal('ez_bar'), ...barAndPlates });
export const TrapBarSchema = equipmentCommon.extend({ kind: z.literal('trap_bar'), ...barAndPlates });

/**
 * (ADR 0030) A Smith machine: logged as plates added, as Smith exercises
 * always were, balanced on both sides. `barMass` is the bar's starting weight
 * (counterweighted bars read lighter), shown beside the load and never added
 * into it, so an assumed bar weight never changes a logged number (rule 6).
 */
export const SmithMachineSchema = equipmentCommon.extend({
  kind: z.literal('smith_machine'),
  loadConvention: z.literal('added'),
  barMass: z.number().nonnegative(),
  plates: plateList,
});

export const PlateLoadedMachineSchema = equipmentCommon.extend({
  kind: z.literal('plate_loaded_machine'),
  /** Plates added only. This never claims the true resistance of the machine. */
  loadConvention: z.literal('added'),
  /** 2 = plates must be balanced across two horns; 1 = single horn. */
  loadingSides: z.union([z.literal(1), z.literal(2)]),
  plates: plateList,
});

export const DumbbellRackSchema = equipmentCommon.extend({
  kind: z.literal('dumbbells'),
  loadConvention: z.literal('per_hand'),
  /** Every dumbbell mass present in the rack, per hand, ascending. */
  loads: loadList,
});

/** (Ben, 20 Oct) Kettlebells: every size present, per bell, ascending (like a dumbbell rack). */
export const KettlebellsSchema = equipmentCommon.extend({
  kind: z.literal('kettlebell'),
  loadConvention: z.literal('per_hand'),
  loads: loadList,
});

export const WeightStackSchema = equipmentCommon.extend({
  kind: z.literal('weight_stack'),
  loadConvention: z.literal('stack'),
  /** Selectable pin positions as printed on the stack, ascending. */
  stackLoads: loadList,
  /** Optional add-on weights (each usable at most once), e.g. a 2.5 magnet. */
  addOns: z.array(positiveMass).max(5),
});

export const AssistedStackSchema = equipmentCommon.extend({
  kind: z.literal('assisted_stack'),
  /** Larger number = more assistance = easier. */
  loadConvention: z.literal('assistance'),
  assistanceLoads: loadList,
});

export const BodyweightStationSchema = equipmentCommon.extend({
  kind: z.literal('bodyweight_station'),
  loadConvention: z.literal('bodyweight'),
});

/**
 * (Ben, 20 Oct; ADR 0030) Benches and racks are presence only: no load of
 * their own. They let exercises that need one (bench press, squats from a
 * rack) be planned here. `adjustable` counts as flat and incline.
 */
export const BenchTypeSchema = z.enum(['flat', 'incline', 'adjustable']);
export type BenchType = z.infer<typeof BenchTypeSchema>;
export const BenchSchema = equipmentCommon.extend({
  kind: z.literal('bench'),
  loadConvention: z.literal('bodyweight'),
  benchType: BenchTypeSchema,
});

export const RackTypeSchema = z.enum(['squat_rack', 'power_rack']);
export type RackType = z.infer<typeof RackTypeSchema>;
export const RackSchema = equipmentCommon.extend({
  kind: z.literal('rack'),
  loadConvention: z.literal('bodyweight'),
  rackType: RackTypeSchema,
});

export const EquipmentInstanceSchema = z
  .discriminatedUnion('kind', [
    BarbellSchema,
    PlateLoadedMachineSchema,
    DumbbellRackSchema,
    WeightStackSchema,
    AssistedStackSchema,
    BodyweightStationSchema,
    KettlebellsSchema,
    EzBarSchema,
    TrapBarSchema,
    SmithMachineSchema,
    BenchSchema,
    RackSchema,
  ])
  .superRefine((eq, ctx) => {
    if (eq.minLoad !== undefined && eq.maxLoad !== undefined && eq.minLoad > eq.maxLoad) {
      ctx.addIssue({ code: 'custom', message: 'minLoad must be <= maxLoad', path: ['minLoad'] });
    }
    if (eq.loadConvention === 'total' && 'barMass' in eq && eq.maxLoad !== undefined && eq.maxLoad < eq.barMass) {
      ctx.addIssue({ code: 'custom', message: 'maxLoad is below the bar mass', path: ['maxLoad'] });
    }
  });
export type EquipmentInstance = z.infer<typeof EquipmentInstanceSchema>;
export type EquipmentKind = EquipmentInstance['kind'];
export type Barbell = z.infer<typeof BarbellSchema>;
export type PlateLoadedMachine = z.infer<typeof PlateLoadedMachineSchema>;
export type DumbbellRack = z.infer<typeof DumbbellRackSchema>;
export type WeightStack = z.infer<typeof WeightStackSchema>;
export type AssistedStack = z.infer<typeof AssistedStackSchema>;
export type BodyweightStation = z.infer<typeof BodyweightStationSchema>;
export type Kettlebells = z.infer<typeof KettlebellsSchema>;
export type Bench = z.infer<typeof BenchSchema>;
export type Rack = z.infer<typeof RackSchema>;
/** Every item loaded as a bar plus plates (total incl. bar). */
export type BarLoaded = Extract<EquipmentInstance, { kind: 'barbell' | 'ez_bar' | 'trap_bar' }>;
export type SmithMachine = z.infer<typeof SmithMachineSchema>;

/** The kinds a gym profile can hold an instance of. */
export const GYM_EQUIPMENT_KINDS = [
  'barbell',
  'plate_loaded_machine',
  'dumbbells',
  'weight_stack',
  'assisted_stack',
  'bodyweight_station',
  'kettlebell',
  'ez_bar',
  'trap_bar',
  'smith_machine',
  'bench',
  'rack',
] as const;
export const GymEquipmentKindSchema = z.enum(GYM_EQUIPMENT_KINDS);
export type GymEquipmentKind = z.infer<typeof GymEquipmentKindSchema>;

/**
 * (Ben, 20 Oct; ADR 0029) How the gym was described: `full` = assume
 * everything a big gym has (items marked assumed until Ben confirms them);
 * `small` = hotel or small gym; `home`. Absent = set up item by item (before 20 Oct).
 */
export const GymSetupSchema = z.enum(['full', 'small', 'home']);
export type GymSetup = z.infer<typeof GymSetupSchema>;

export const GymSchema = RecordMetaSchema.extend({
  name: z.string().min(1).max(120),
  locationLabel: z.string().max(200).optional(),
  isDefault: z.boolean(),
  notes: z.string().max(2000).optional(),
  archivedAtUtc: UtcTimestampSchema.optional(),
  setup: GymSetupSchema.optional(),
  /**
   * Kinds Ben said this gym doesn't have (the coach's `update_gym` remove, on
   * his words). `Make full gym` never adds them back. Absent = none.
   */
  missingKinds: z.array(GymEquipmentKindSchema).max(GYM_EQUIPMENT_KINDS.length).optional(),
});
export type Gym = z.infer<typeof GymSchema>;

/**
 * (20 Oct, ADR 0029) One change to a gym's profile with the records before
 * and after (`before: null` = a new item), so Undo can put each back while
 * nothing changed since (rule 5). Made by `Make full gym`, `Not at this gym`,
 * a learned load, or the coach's `update_gym`. `lines`: app text.
 */
export const GymEditSchema = z.object({
  gymId: IdSchema,
  gym: z.object({ before: GymSchema, after: GymSchema }).nullable(),
  equipment: z.array(z.object({ before: EquipmentInstanceSchema.nullable(), after: EquipmentInstanceSchema })).max(40),
  lines: z.array(z.string().min(1).max(200)).max(12),
});
export type GymEditRecord = z.infer<typeof GymEditSchema>;

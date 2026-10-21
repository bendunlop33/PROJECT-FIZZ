import type { BuilderGroup, DraftLoadSource, EquipmentInstance, LoadConvention, SetType, WeightUnit } from '@fizz/schemas';

/**
 * Workout builder v3 (docs/design/workout-builder-v3.md, slice S2): the
 * domain model the pure builder rules work on. Display-level only; the
 * service maps it to `DraftPlan` slots (order + supersetGroup) when it saves.
 *
 * Muscle and group lookups are INJECTED (`BuilderExerciseInfo`): the muscles
 * stream owns the catalogue mapping (`builderGroupOf`, rear delts → Back,
 * `heavy?`, `builderFocusOf`). Nothing here reads the catalogue directly.
 */

/**
 * The builder's muscle groups (§4.7): the schemas' `BuilderGroup`. Display
 * only: Legs = Quads + Hamstrings + Glutes + Calves; Abs = Core.
 */
export type BuilderGroupName = BuilderGroup;

export const ARM_GROUPS: readonly BuilderGroupName[] = ['Biceps', 'Triceps'];

/** Role for order, rest and warm-ups (§3.2–§3.4). Abs are isolations in group `Abs`. */
export type BuilderRole = 'compound' | 'isolation';

/** What the injected lookup knows about one exercise. */
export interface BuilderExerciseInfo {
  exerciseId: string;
  name: string;
  group: BuilderGroupName;
  role: BuilderRole;
  /** Marked heavy in the catalogue, else a compound on a barbell or plate-loaded machine (§3.5). */
  heavy: boolean;
  /**
   * The part used for pairing and leg-day alternation (§3.4–§3.5): `quads`,
   * `hamstrings_glutes`, `calves` on legs; the group name otherwise.
   */
  part: string;
  /** Muscles it works (lower-case words, e.g. `lats`, `upper chest`); shared muscle = no pair. */
  muscles: readonly string[];
  /** Focus heading / angle within the group (`Upper chest`, `Mid chest`, `Lats`…). */
  angle: string;
  /** Loaded on a barbell (bar × 10 warm-up). */
  barbell: boolean;
}

/** The injected lookup. Null = unknown exercise (left out by the builder). */
export type BuilderInfoLookup = (exerciseId: string) => BuilderExerciseInfo | null;

// ---------------------------------------------------------------------------
// Loads

/** A known working load: value in the slot's unit and convention, for these reps at this RPE. */
export interface AnchorLoad {
  value: number;
  reps: number;
  rpe: number;
  /**
   * (Builder loads, 21 Oct) This anchor gives way to Ben's own recent sets
   * when it implies a clearly lower e1RM than they do (`HISTORY_WINS_SHARE`):
   * the built-in rule's load when it isn't a pain hold or a miss, and a
   * plan's first-week load with newer history than the plan.
   */
  yieldsToHistory?: boolean;
}

/**
 * Where today's working load came from (§3.1, §9 Q12). Stored as
 * `DraftLoadSchema.source` through `draftLoadSourceOf` (a typed kg is `ben`).
 */
export type BuilderLoadSourceKind = 'coach_target' | 'plan' | 'rule' | 'calc' | 'none';

const DRAFT_SOURCE: Readonly<Record<BuilderLoadSourceKind, DraftLoadSource>> = { coach_target: 'coach', plan: 'plan', rule: 'rule', calc: 'calc', none: 'none' };

/** A row's stored load source: Ben's typed kg is `ben`; every other row is its slot's source. */
export function draftLoadSourceOf(source: BuilderLoadSourceKind, typed: boolean): DraftLoadSource {
  return typed ? 'ben' : DRAFT_SOURCE[source];
}

/**
 * Resolved inputs for one exercise at the selected gym. The service fills
 * them from the existing code (§4.1): coach next-session targets / lift
 * targets, `planFirstLoads`, `nextTargetsFor`, `loadReferences` →
 * `referenceE1rm` (own recent sets), `noReferenceCeiling`, `painFlagCovering`.
 * Values are in `unit` and `convention`; the rules convert them to the
 * item's unit when it differs (`loadFrameOf`).
 */
export interface SlotLoadInput {
  unit: WeightUnit;
  convention: LoadConvention;
  /** The item this gym maps the exercise to; null = none (bodyweight, or not here). */
  equipment: EquipmentInstance | null;
  /** The catalogue's default convention is `bodyweight` (dips, pull-ups): `added` loads are weighted bodyweight. */
  bodyweightExercise?: boolean;
  /** The gym's usable items, for added weight on a bodyweight lift (its dumbbells and plates). */
  gymEquipment?: readonly EquipmentInstance[];
  coachTarget: AnchorLoad | null;
  planFirstLoad: AnchorLoad | null;
  ruleTarget: AnchorLoad | null;
  /** Est. max from Ben's own recent sets (an estimate, rule 6). */
  e1rm: number | null;
  /** Days since the newest of those sets (`OwnReference.gapDays`): a gap of 14+ days cuts the e1RM when it overrides an anchor. */
  e1rmGapDays?: number | null;
  /** `noReferenceCeiling` for `Start light`; null = none. */
  startLightCeiling: number | null;
  /** Pain-flagged movement: no harder than this (the last comparable working load, rule 9). */
  painCap: number | null;
  /** The comparable history these loads were worked out from (`LoadReferences.historyVersion`); Start re-derives the slot once it moved (review B4). */
  historyVersion?: string | null;
}

/** A load after rounding down to what this gym can load. */
export interface RoundedLoad {
  /** In `unit` (the item's unit; the slot's own unit when no item is needed). */
  value: number;
  unit: WeightUnit;
  /** The requested value (before the pain hold and rounding), in `requestedUnit`, for `Why this weight?`. */
  requested: number;
  requestedUnit: WeightUnit;
  /** The value moved to be loadable on the item (plates, rack, stack). */
  rounded: boolean;
  /** Clamped to the item's max or min (rule 4). */
  bounded: 'max' | 'min' | null;
  /** Held to the pain-flag cap before rounding (rule 9): `Why?` names the pain hold, not the plates. */
  capped: 'pain' | null;
}

// ---------------------------------------------------------------------------
// Sets, slots, blocks

export interface BuilderSetRow {
  type: SetType;
  reps: number;
  /** Target load in the slot's unit and convention; null = `—` (unknown, or no load). */
  load: number | null;
  /** Target RPE; null on warm-ups. */
  rpe: number | null;
  /** Ben typed this kg: kept on reps/RPE edits (§2.4). */
  typed?: true;
  /** A typed kg this gym's item rounded down: what Ben typed, in the slot's unit (`Why?` names the item; review S6). */
  roundedFrom?: number;
}

export interface RepRangeT {
  min: number;
  max: number;
}

/** Rest kinds a slot can override (§3.2). */
export type RestKind = 'warmup' | 'top' | 'backoff' | 'working' | 'drop' | 'before_drop';

export interface BuilderSlot {
  /** Stable for the draft's life. */
  key: string;
  exerciseId: string;
  main: boolean;
  repRange: RepRangeT;
  rows: BuilderSetRow[];
  /** Unit and convention of every row's load (the item's unit; review B1). */
  unit: WeightUnit;
  convention: LoadConvention;
  /** Where the working load came from; `none` when no load resulted. */
  source: BuilderLoadSourceKind;
  /** `Start light` cap (in `unit`) when the load is unknown; null otherwise. */
  startLight: number | null;
  /** The anchor e1RM other sets are derived from (Epley, RIR = 10 − RPE); null = no formula. */
  anchorE1rm: number | null;
  /** Ben's own rest per kind (seconds); defaults otherwise. */
  restS?: Partial<Record<RestKind, number>>;
  /** Ben edited this slot (swap, sets, reps…): merges and fits leave it alone. */
  touched?: true;
  /** Ben unlinked this slot from a superset: automatic pairing never re-pairs it (review B3). */
  unlinked?: true;
  /** The plan-day template exercise this slot came from (kept through a swap): `Cable fly → Incline press` (§2.8). */
  origin?: string;
  /** The comparable history its loads were worked out from (stored as `checkedHistoryVersion`; review B4). */
  historyVersion?: string;
}

export interface BuilderBlock {
  slots: BuilderSlot[];
  /** A pair the builder made (re-paired by `Supersets` on/off); Ben's own pairs have false. */
  auto: boolean;
  /** Ben's `After each round` rest (seconds). */
  roundRestS?: number;
}

/** Rest level from the fit ladder (§2.0.2 3a). */
export type RestLevel = 'normal' | 'shorter' | 'shortest';

export interface BuilderWorkout {
  blocks: BuilderBlock[];
  restLevel: RestLevel;
}

/** The context every rule that touches loads or slots needs. */
export interface BuilderContext {
  info: BuilderInfoLookup;
  /** Load inputs for one exercise at today's gym. */
  loads: (exerciseId: string) => SlotLoadInput;
  /** Ben's saved rest presets (seconds); defaults snap to the nearest. */
  restPresetsS?: readonly number[];
  /** Stable key for a new slot (injected so the rules stay pure and deterministic). */
  newKey: (exerciseId: string) => string;
}

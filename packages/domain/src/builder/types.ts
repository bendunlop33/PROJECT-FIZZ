import type { BuilderGroup, DraftLoadSource, EquipmentInstance, LoadConvention, SetType, WeightUnit } from '@fizz/schemas';
import type { RuleReps } from '../rep-range';

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
  /**
   * (Reps from history, 21 Oct) The top of the rep range this load is for (the built-in rule's). A set
   * of up to `repsMax` reps takes the load as is; a set of more reps follows from its e1RM.
   * Absent: the load is for `reps` only.
   */
  repsMax?: number;
}

/**
 * Where today's working load came from (§3.1, §9 Q12). Stored as
 * `DraftLoadSchema.source` through `draftLoadSourceOf` (a typed kg is `ben`).
 */
export type BuilderLoadSourceKind = 'coach_target' | 'plan' | 'rule' | 'calc' | 'none' | 'saved';

const DRAFT_SOURCE: Readonly<Record<BuilderLoadSourceKind, DraftLoadSource>> = { coach_target: 'coach', plan: 'plan', rule: 'rule', calc: 'calc', none: 'none', saved: 'plan' };

/** A row's stored load source: Ben's typed kg is `ben`; every other row is its slot's source. */
export function draftLoadSourceOf(source: BuilderLoadSourceKind, typed: boolean): DraftLoadSource {
  return typed ? 'ben' : DRAFT_SOURCE[source];
}

/**
 * (D4, Ben 22–23 Oct) The main focus a back-off's band follows (`BACKOFF_BANDS`): Ben's goal, Strength, Muscle, or
 * both (Balanced).
 */
export type MainFocus = 'strength' | 'balanced' | 'muscle';

/**
 * Resolved inputs for one exercise at the selected gym. The service fills
 * them from the existing code (§4.1): coach next-session targets / lift
 * targets, `planFirstLoads`, `nextTargetsFor`, `loadReferences` →
 * `referenceE1rm` (own recent sets), `noReferenceCeiling`, `painFlagCovering`.
 * Values are in `unit` and `convention`; the rules convert them to the
 * item's unit when it differs (`loadFrameOf`).
 */
export interface SlotLoadInput {
  /** (D4) The band back-offs sit in below the top set (`mainFocusOf` Ben's goal). Absent: Balanced. */
  mainFocus?: MainFocus;
  unit: WeightUnit;
  convention: LoadConvention;
  /** The item this gym maps the exercise to; null = none (bodyweight, or not here). */
  equipment: EquipmentInstance | null;
  /** The catalogue's default convention is `bodyweight` (dips, pull-ups): `added` loads are weighted bodyweight. */
  bodyweightExercise?: boolean;
  /** The gym's usable items, for added weight on a bodyweight lift (its dumbbells and plates). */
  gymEquipment?: readonly EquipmentInstance[];
  coachTarget: AnchorLoad | null;
  /**
   * (Ben, 23 Oct) The working-set count the coach set for this exercise's next session and that still stands (a small
   * change, or a bigger one Ben applied on the Summary; not used, not stale, not pain-flagged). The plan day's slot
   * takes it (`withCoachSetCounts`). Absent or null: the template's count.
   */
  coachSets?: number | null;
  planFirstLoad: AnchorLoad | null;
  ruleTarget: AnchorLoad | null;
  /** Est. max from Ben's own recent sets (an estimate, rule 6). */
  e1rm: number | null;
  /**
   * (Review S1) Est. max from the most recent comparable session only (`lastSessionE1rm`): what a stale
   * anchor gives way to, so a drop Ben chose last time isn't undone by a heavier set before it.
   * Absent: `e1rm` is used.
   */
  lastE1rm?: number | null;
  /** Days since the newest of those sets (`OwnReference.gapDays`): a gap of 14+ days cuts the e1RM when it overrides an anchor. */
  e1rmGapDays?: number | null;
  /** `noReferenceCeiling` for `Start light`; null = none. */
  startLightCeiling: number | null;
  /** Pain-flagged movement: no harder than this (the last comparable working load, rule 9). */
  painCap: number | null;
  /** The comparable history these loads were worked out from (`LoadReferences.historyVersion`); Start re-derives the slot once it moved (review B4). */
  historyVersion?: string | null;
  /**
   * (Reps from history, 21 Oct) The built-in rule's reps for this exercise (`NextTargets.reps`): what
   * Ben did last time, the range the rule used and the one count to plan. Absent or null: no history,
   * and the slot takes the builder's default range.
   */
  ruleReps?: RuleReps | null;
  /**
   * (Reps from history, 21 Oct) A main barbell lift's built-in rule read as a secondary lift's
   * (`NextTargetRequest.accessory`): what a non-main slot of it uses (`slotLoadOf`). Absent: the same as above.
   */
  secondary?: { ruleTarget: AnchorLoad | null; ruleReps: RuleReps | null };
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
  /** Target reps; with `repsMax`, the bottom of a rep range. */
  reps: number;
  /**
   * Top of a saved rep range (a library or past workout's `3–6`; retire-overview R1), above `reps`. Absent = fixed
   * reps. Kept through the codec so Start plans the range Ben saved; a reps edit on the set fixes it.
   */
  repsMax?: number;
  /** Target load in the slot's unit and convention; null = `—` (unknown, or no load). */
  load: number | null;
  /** Target RPE; null on warm-ups. */
  rpe: number | null;
  /** Ben typed this kg: kept on reps/RPE edits (§2.4). */
  typed?: true;
  /** A typed kg this gym's item rounded down: what Ben typed, in the slot's unit (`Why?` names the item; review S6). */
  roundedFrom?: number;
  /**
   * (D4, HT8; review B1) A back-off whose load isn't worked out from the slot's anchor (a saved or coach-built
   * workout's own back-off, or one the coach's load op kept): its load (`load`) against the top it was set for
   * (`top`), both in the slot's unit. Today's top lower than `top` lowers it by the same %; higher leaves it at
   * `load`. Measured from here, lowering the top again never compounds and putting it back puts the back-off back.
   * `follow` (Ben, 23 Oct, SP2): the top is one Ben asked the coach for, so the back-off follows it both ways
   * (`followTop`), inside the D4 band; a top Ben types himself ends it (`raising the top never raises` again).
   */
  backoffFrom?: { load: number; top: number; follow?: true };
  /**
   * (22 Oct) A timed set's work time, seconds (a plank, a ride): the set is counted in time, not reps (`reps` is
   * then only a placeholder). Kept through the codec as the saved workout has it, so Start plans it as saved.
   */
  durationS?: number;
  /** (22 Oct) Cardio: a distance to aim for, metres, with or without a time (`20:00 · 5,000 m`). */
  distanceM?: number;
}

export interface RepRangeT {
  min: number;
  max: number;
}

/** Rest kinds a slot can override (§3.2). */
export type RestKind = 'warmup' | 'top' | 'backoff' | 'working' | 'drop' | 'before_drop';

/**
 * (Ben, 23 Oct, D1) What Ben himself changed on a slot's structure, for Summary's `Keep for next time?`: he added the
 * exercise (`added`), swapped it (`from`: the exercise before his first swap), or changed its set count (`setsFrom`:
 * its working sets before that, with Time's cuts put back). Loads, reps, rests and order are never structure.
 */
export interface BuilderKeepMarks {
  added?: true;
  from?: string;
  setsFrom?: number;
}

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
  /**
   * (D1) Ben's own structure edits on this slot. Only his edits on Your workout and Set up write it; Today's card,
   * Time, a gym change and the coach never do (a swap they make clears it).
   */
  keep?: BuilderKeepMarks;
  /** (D1) Working sets Today's Time took from this slot (Today's card only): Keep compares Ben's count like with like. */
  todayCut?: number;
  /** (Ben, 23 Oct; review ben-8-decisions S3) Working sets a carry-over landed here: Time fits without them, then puts them back. */
  carried?: number;
  /** The comparable history its loads were worked out from (stored as `checkedHistoryVersion`; review B4). */
  historyVersion?: string;
  /**
   * (Retire-overview R3) Why its loads are what they are, from what it was opened on (a library or past workout's
   * own rule, held on pain, capped or rounded at this gym). Shown by `Why this weight?`; dropped when the builder
   * works the loads out again (gym change, swap).
   */
  why?: string[];
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

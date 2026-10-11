import type {
  AliasTarget,
  BodyweightAnswer,
  CustomExerciseKind,
  ExerciseEquipmentKind,
  FitNotesVariant,
  GroupTotalAnswer,
  ImportAnswers,
  ImportBarKind,
  ImplementCount,
  ImportedSet,
  ImportRow,
  ImportRowResult,
  Laterality,
  Load,
  LoadConvention,
  NameAnswer,
  PerHandAnswer,
  PerHandReading,
  TotalAnswer,
  WeightUnit,
} from '@fizz/schemas';
import { deriveId } from '../stable';
import { fromScaled, toScaled } from '../units';
import { effortFromComment } from './effort';
import type { FitNotesRow } from './fitnotes';
import { categoryHint } from './category';
import { equipmentInName, implementsFor, matchName, nameKey, type MatchCandidate, type NameMatch } from './match';
import type { RememberedTotal } from './remembered';

/**
 * The FitNotes import preview and plan (data-import-export §2.5, §3.4, §4.3).
 * Pure: the same rows, context and answers always give the same analysis,
 * and the same job and operation IDs always give the same row results and
 * record IDs, so a resumed commit can't duplicate (rule 5).
 *
 * Nothing is invented (rule 6): load conventions are never pre-answered
 * (DX6), kg and lb are never converted, imported loads are never snapped to
 * equipment (rule 2: they are completed sets, as written), and dates stay
 * dates (no invented time of day).
 *
 * A stored value differs from the file's only with a source for it (PM
 * decision, review r5): (a) the name is one of the exercise's own names,
 * (b) Ben's own answer, in this import or remembered from one still in
 * effect, or (c) a word in the name. A word suggestion, even after `Use
 * this`, gives the exercise only: an exercise whose dumbbell count isn't
 * known that way never takes a group answer and is asked on its own, with
 * nothing selected, showing what it will import as.
 *
 * A bar weight is only ever added by Ben's answer for that one exercise
 * (PM decision after review r7): the barbell group answer is only "Total as
 * written", and no word in a name ever decides that a bar is added or which.
 */

export const DEFAULT_ANSWERS: ImportAnswers = {
  names: {},
  perHand: null,
  perHandOverrides: {},
  total: null,
  totalOverrides: {},
  totalBars: {},
  barWeight: { kg: 20, lb: 45 },
  otherBarWeight: { ez_bar: { kg: null, lb: null }, trap_bar: { kg: null, lb: null } },
  bodyweight: {},
  bothColumns: null,
  effort: { mode: 'notes_only', rows: [] },
  existingDates: 'skip',
  gymId: null,
};

/** An earlier import still in effect (not undone). */
export interface EarlierImport {
  jobId: string;
  fileName: string;
  startedAtUtc: string;
  tz: string;
}

export interface ImportContext {
  ownerId: string;
  /** Exercises a name can map to, in a stable order. */
  candidates: readonly MatchCandidate[];
  /** Ben's saved answers from earlier imports, by name key. */
  aliases: ReadonlyMap<string, AliasTarget>;
  /**
   * Ben's own dumbbell answer for a name in an earlier import (`one` /
   * `each` / `both`), remembered with the name (review r4 S2). A new
   * preview starts with it filled in (`startingAnswers`) and shows it as his
   * answer last time.
   */
  perHandAnswers?: ReadonlyMap<string, PerHandReading>;
  /**
   * Ben's own barbell answer for a name in an earlier import still in effect
   * (total or plates only, and the bar he chose): filled in by
   * `startingAnswers` and shown as his answer last time (PM decision after
   * review r7).
   */
  totalAnswers?: ReadonlyMap<string, RememberedTotal>;
  /** Local dates that have a workout logged in the app (not imported). */
  appDates: ReadonlySet<string>;
  /** Local dates that came in with an earlier import still in effect. */
  importedDates: ReadonlyMap<string, EarlierImport>;
  /** Unit for an exercise with no weight in the file (the profile's unit). */
  defaultUnit: WeightUnit;
}

/**
 * The bar a `total` exercise uses, for `Plates only` (review S1):
 * - a bar kind: its own bar weight is added;
 * - `none`: no bar at all (kettlebell, medicine ball, sandbag). The value is
 *   the total as written and the barbell question doesn't ask about it;
 * - `unknown`: no bar kind, or more than one, recorded for the exercise.
 *   Asked; a plates-only answer waits until Ben chooses the bar.
 */
export type BarOf = ImportBarKind | 'none' | 'unknown';

const BAR_KINDS: readonly ImportBarKind[] = ['barbell', 'ez_bar', 'trap_bar'];

export function barOf(equipment: readonly ExerciseEquipmentKind[]): BarOf {
  const bars = BAR_KINDS.filter((b) => equipment.includes(b));
  if (bars.length === 1) return bars[0] ?? 'unknown';
  if (bars.length === 0 && equipment.length > 0) return 'none';
  return 'unknown';
}

/** What a source name maps to now. */
export interface ResolvedExercise {
  exerciseId: string;
  name: string;
  laterality: Laterality;
  convention: LoadConvention;
  /**
   * The exercise's own bar, from its equipment (only read for `total`):
   * what a `plates_only` answer adds unless Ben chooses another bar for it
   * (`ImportAnswers.totalBars`). Never read from the source name (PM
   * decision after review r7).
   */
  bar: BarOf;
  /**
   * `per_hand`: one dumbbell or two, only from the exercise's own name or a
   * word in the source name (`implementsFor`); null when not known (asked;
   * review r3 S1, r4 S1, r5 S1).
   */
  implements: ImplementCount | null;
  /** The exercise's equipment (the dumbbell screen says kettlebell for a kettlebell exercise; review r5 N3). */
  equipment: readonly ExerciseEquipmentKind[];
  /** `Add new`: a custom exercise created when the import commits. */
  newKind: CustomExerciseKind | null;
  /**
   * A weight-stack or plates-added exercise whose source name says assisted:
   * `convention` is `bodyweight` so how the values read is asked, and an
   * "added" answer is stored as this convention (review r6.1 S1). Else null.
   */
  loadAs: 'stack' | 'added' | null;
}

export type NameResolution = { kind: 'exercise'; exercise: ResolvedExercise } | { kind: 'skip' } | { kind: 'open' };

export interface NameRow {
  key: string;
  /** As first written in the file. */
  name: string;
  /** Strength sets with this name that would be imported (dates not skipped). */
  sets: number;
  match: NameMatch;
  answer: NameAnswer | null;
  resolution: NameResolution;
  /** Not mapped yet: `Check` or `No match` with no answer (or an answer whose exercise is gone). */
  needsAnswer: boolean;
  /** The FitNotes `Category` as first written for this name (trimmed), or null when blank. Data only; a ranking hint for `match`. */
  category: string | null;
}

export interface ExampleSet {
  name: string;
  date: string;
  /** The weight as written (`22.5`). */
  value: number;
  unit: WeightUnit;
  reps: number;
}

/**
 * One exercise on the barbell question (PM decision after review r7). The
 * group answer only ever reads it as the total as written; "plates only" is
 * Ben's answer for this exercise alone, with the bar shown and changeable.
 */
export interface TotalExercise {
  key: string;
  /** As first written in the file. */
  name: string;
  /** The app's exercise it maps to. */
  exerciseName: string;
  exerciseId: string;
  sets: number;
  /**
   * Units its sets are written in (a FitNotes 2 row with both columns
   * filled counts as both until Ben picks one): the bar weights a
   * plates-only answer depends on (review r8 B1).
   */
  units: WeightUnit[];
  /** The weight of `bar` in effect in each of `units` (absent while not entered): what a plates-only answer adds, remembered with it. */
  barWeights: { kg?: number; lb?: number };
  /** The matched exercise's own bar, from its equipment (`unknown`: none, or more than one, recorded). */
  exerciseBar: Exclude<BarOf, 'none'>;
  /** The bar "plates only" adds: Ben's choice, else the exercise's own. `unknown`: he has to choose one before plates only can be read. */
  bar: Exclude<BarOf, 'none'>;
  /** Ben chose the bar (`ImportAnswers.totalBars`). */
  barChosen: boolean;
  /** Ben's answer for this exercise; null: the group answer reads it. */
  override: TotalAnswer | null;
  /** Ben's answer for this name in an earlier import still in effect, as given then; null when there is none. */
  remembered: RememberedTotal | null;
  /**
   * The remembered answer is exactly what this import would do: the same
   * exercise, the same bar and that bar's same weight in each unit (or one
   * still to be entered) (`rememberedTotalFits`; review r8 B1, B2). Only
   * then is it filled in or labelled `Your answer last time`.
   */
  rememberedFits: boolean;
  /** How its values are read now (`totalReading`). Null: still to answer. */
  reading: TotalAnswer | null;
  /**
   * Its newest weight in the file: `platesOnly` is what it imports as under
   * "plates only" (null while the bar or its weight is missing), `imported`
   * what it imports as under `reading` (null while unanswered or while
   * plates only can't be read yet); `barWeight` is the bar's weight added.
   */
  sample: { value: number; unit: WeightUnit; imported: number | null; barWeight: number | null; platesOnly: number | null } | null;
}

/** One exercise on the dumbbell question (review r3 S1). */
export interface PerHandExercise {
  key: string;
  /** As first written in the file. */
  name: string;
  /** The app's exercise it maps to. */
  exerciseName: string;
  sets: number;
  /** One dumbbell or two (`implementsFor`). Null: not known, so it is asked on its own. */
  implements: ImplementCount | null;
  /** What the copy calls it: a kettlebell exercise isn't "one dumbbell" (review r5 N3). */
  implement: 'dumbbell' | 'kettlebell';
  override: PerHandReading | null;
  /** Ben's answer for this name in an earlier import (review r4 S2); null when there is none. */
  remembered: PerHandReading | null;
  /** How its values are read now (`perHandReading`). Null: still to answer. */
  reading: PerHandReading | null;
  /** Its newest weight in the file, and that weight per dumbbell under `reading` (null while unanswered). */
  sample: { value: number; unit: WeightUnit; imported: number | null } | null;
}

/**
 * Dumbbell weights (§2.5 step 3b; review r3 S1). The group answer (each /
 * both) is asked only for exercises done with two dumbbells. One-dumbbell
 * exercises read as written; exercises with no recorded count are asked one
 * by one with no default (DX6). Every exercise shows what it will import as.
 */
export interface PerHandQuestion {
  exercises: PerHandExercise[];
  /** The group answer, for two-dumbbell exercises with no answer of their own. */
  answer: PerHandAnswer | null;
  /** Two-dumbbell exercises the group answer reads: no answer of their own (the group question is shown only when there is one; review r5 N4). */
  pairs: number;
  /** The newest set of an exercise the group answer reads, for the group options (review r5 N4). */
  example: ExampleSet | null;
  /** A two-dumbbell exercise waits for the group answer. */
  needsGroup: boolean;
  /** Exercises with no recorded count and no answer yet. */
  needsCount: number;
  open: boolean;
}

/**
 * Barbell weights (§2.5 step 3b; PM decision after review r7). The group
 * answer is only "Total as written" (nothing added) and reads every
 * exercise with no answer of its own. "Plates only" is chosen per exercise,
 * from a list that shows each one's bar (changeable) and conversion, with
 * nothing pre-selected (DX6).
 */
export interface TotalQuestion {
  exercises: TotalExercise[];
  /** The group answer (`total` only; a `plates_only` stored before the PM decision after review r7 reads as null). */
  answer: GroupTotalAnswer | null;
  /** Exercises the group answer reads: no answer of their own. */
  grouped: number;
  /** The newest set of an exercise the group answer reads. */
  example: ExampleSet | null;
  /** An exercise the group answer reads waits for it. */
  needsGroup: boolean;
  /** Exercises answered "plates only" whose bar isn't known and that Ben hasn't chosen one for. */
  needsBar: number;
  bars: BarWeightQuestion[];
  missingBarWeight: boolean;
  open: boolean;
}

/**
 * A machine exercise (weight stack, plates added or assisted): read by the
 * exercise, not asked (§2.5 step 3b). For an assisted machine, its newest
 * readable value and what it imports as, since a negative weight is stored
 * as that much assistance (review r6 N2); and whether its values are both
 * negative and positive, so the positive ones can't be read (review r6 S3).
 */
export interface MachineExercise {
  key: string;
  name: string;
  exerciseName: string;
  convention: LoadConvention;
  /** `assistance` only: the newest readable set as written and as imported; null when none can be read. */
  sample: { value: number; unit: WeightUnit; imported: number } | null;
  /** `assistance` only: values both negative and positive. */
  mixed: boolean;
}

export interface BodyweightQuestion {
  key: string;
  name: string;
  exerciseName: string;
  sets: number;
  min: number;
  max: number;
  /** Both negative and positive values: `split` is offered, and `assistance` can't read the positive ones (review B3). */
  mixed: boolean;
  /** A weight-stack or plates-added exercise whose name says assisted: "added" means that load (review r6.1 S1). */
  loadAs: 'stack' | 'added' | null;
  answer: BodyweightAnswer | null;
}

/** A bar's weight for `plates_only` values (review S1). */
export interface BarWeightQuestion {
  bar: ImportBarKind;
  /** Units the bar's exercises are written in. */
  units: WeightUnit[];
  weight: { kg: number | null; lb: number | null };
  /** Some exercise on this bar is answered `plates_only`, so its weight is added. */
  needed: boolean;
  /** Units needed but with no weight entered yet (EZ and trap bars have no default). */
  missing: WeightUnit[];
}

export interface EffortCandidate {
  row: number;
  date: string;
  name: string;
  comment: string;
  rpe: number;
  checked: boolean;
}

export type PendingReason = 'name' | 'per_hand' | 'total' | 'bodyweight' | 'unit';

/** The mapped set before IDs are assigned. */
export interface MappedSet {
  exerciseId: string;
  exerciseName: string;
  laterality: Laterality;
  convention: LoadConvention;
  unit: WeightUnit | null;
  load: Load | null;
  reps: number;
  rpe: number | null;
}

export type RowFate =
  | { result: 'imported'; set: MappedSet }
  | { result: 'pending'; reason: PendingReason }
  | { result: Exclude<ImportRowResult, 'imported'>; detail: string };

export type FateCounts = Record<ImportRowResult | 'pending', number>;

export interface ImportAnalysis {
  variant: FitNotesVariant;
  rowCount: number;
  dateRange: { first: string; last: string } | null;
  /** Weighted rows per unit, to say `weights in kg`, `in lb` or `in kg and lb (per set)`. */
  units: { kg: number; lb: number };
  names: NameRow[];
  perHand: PerHandQuestion | null;
  /** `total` exercises that use a bar (barbell, EZ bar, trap bar). Bar-less ones (a kettlebell) aren't asked. */
  total: TotalQuestion | null;
  bodyweight: BodyweightQuestion[];
  /** FitNotes 2 rows with both weight columns filled. */
  unit: { rows: number; answer: WeightUnit | null } | null;
  effort: { mode: 'notes_only' | 'review'; candidates: EffortCandidate[] };
  /** Exercises whose convention follows the exercise (stack, plates added, assisted): shown as text, not asked. */
  machines: MachineExercise[];
  /** `total` exercises with no bar (kettlebell, medicine ball, sandbag): imported as written, not asked. */
  barless: { key: string; name: string; exerciseName: string }[];
  /** Rows with a comment (kept with each set as the original). */
  comments: number;
  decimalCommaRows: number;
  /** Dates in the file that have a workout logged in the app. */
  appDates: { count: number; newest: string | null };
  /** Dates in the file that came in with earlier imports (always skipped). */
  alreadyImported: { dates: number; imports: (EarlierImport & { dates: number })[] };
  /** One fate per parsed row, in file order. */
  fates: RowFate[];
  counts: { workouts: number; sets: number; exercises: number; byResult: FateCounts };
  /** Dates that will get a workout (imported or still pending an answer), newest first. */
  workouts: { date: string; exercises: number; sets: number }[];
  questionsOpen: number;
  /** Every question answered and something to import. */
  ready: boolean;
}

const CONVENTION_BY_KIND: Readonly<Record<CustomExerciseKind, LoadConvention>> = {
  barbell: 'total',
  dumbbells: 'per_hand',
  weight_stack: 'stack',
  plate_loaded_machine: 'added',
  assisted_stack: 'assistance',
  bodyweight_station: 'bodyweight',
};

const CUSTOM_KINDS = Object.keys(CONVENTION_BY_KIND) as CustomExerciseKind[];

/**
 * Stable ID of the custom exercise `Add new` makes for a source name and
 * equipment, so a retried or repeated import with the same answer reuses
 * it. Each equipment gets its own exercise: an import never changes an
 * exercise that already exists, so an answer that Undo import takes back
 * can't live on in the exercise, and an import still in effect that mapped
 * another name to it keeps reading it its way (review r6 B1).
 */
export function customExerciseIdFor(ownerId: string, key: string, kind: CustomExerciseKind, bar: ImportBarKind = 'barbell'): string {
  // An EZ- or trap-bar exercise `Add new` makes (Ben's plates-only bar) is another exercise from the Olympic one: an import never changes an exercise (review r8 S2).
  const made = kind === 'barbell' && bar !== 'barbell' ? `${kind}:${bar}` : kind;
  return deriveId(`custom-exercise:${ownerId}:fitnotes:${key}:${made}`);
}

const OTHER_BARS: readonly ImportBarKind[] = ['ez_bar', 'trap_bar'];

/** The one ID per name that builds before review r6 gave `Add new`'s exercise, whatever its equipment. Recognised, never written. */
export function legacyCustomExerciseIdFor(ownerId: string, key: string): string {
  return deriveId(`custom-exercise:${ownerId}:fitnotes:${key}`);
}

/**
 * A custom exercise an import's `Add new` made from its own name (either ID
 * scheme): its name is that import's answer, not knowledge of its own
 * (`MatchCandidate.importMade`; review r5 S2).
 */
export function isImportMadeExercise(ownerId: string, e: { id: string; name: string; source: string }): boolean {
  if (e.source !== 'custom') return false;
  const key = nameKey(e.name);
  return (
    e.id === legacyCustomExerciseIdFor(ownerId, key) ||
    CUSTOM_KINDS.some((k) => e.id === customExerciseIdFor(ownerId, key, k)) ||
    OTHER_BARS.some((b) => e.id === customExerciseIdFor(ownerId, key, 'barbell', b))
  );
}

/**
 * The exercise `Add new` with this equipment maps a name to: its own
 * (`customExerciseIdFor`), or one an earlier build made for the name under
 * the old ID when it is still exactly that equipment, so its history stays
 * together. Either way it is never changed (review r6 B1).
 */
function addNewExerciseId(ctx: ImportContext, storedKey: string, key: string, kind: CustomExerciseKind, made: ExerciseEquipmentKind, byId: ReadonlyMap<string, MatchCandidate>): string {
  const legacy = byId.get(legacyCustomExerciseIdFor(ctx.ownerId, key));
  const same = legacy?.importMade === true && legacy.defaultLoadConvention === CONVENTION_BY_KIND[kind] && legacy.compatibleEquipment.length === 1 && legacy.compatibleEquipment[0] === made;
  const bar: ImportBarKind = made === 'ez_bar' || made === 'trap_bar' ? made : 'barbell';
  // Keyed on the name as stored (at most 120 characters), so the exercise is recognised as import-made from its name (review r6.1 N4).
  return same ? legacy.exerciseId : customExerciseIdFor(ctx.ownerId, storedKey, kind, bar);
}

/**
 * A name that says assisted mapped to a weight-stack or plates-added
 * exercise (`Choose…` or `Add new`): Ben's choice gives the exercise, the
 * name's word says the number is help. The two disagree on the sign, so how
 * the values read is asked like a bodyweight exercise's, with nothing
 * selected; a "load" answer is stored as the exercise's own convention
 * (review r6.1 S1).
 */
function withAssistWord(name: string, ex: ResolvedExercise): ResolvedExercise {
  if (ex.convention !== 'stack' && ex.convention !== 'added') return ex;
  if (equipmentInName(name)?.has('assisted_stack') !== true) return ex;
  return { ...ex, convention: 'bodyweight', loadAs: ex.convention };
}

export function conventionForKind(kind: CustomExerciseKind): LoadConvention {
  return CONVENTION_BY_KIND[kind];
}

function resolveName(
  key: string,
  name: string,
  match: NameMatch,
  answer: NameAnswer | null,
  ctx: ImportContext,
  byId: ReadonlyMap<string, MatchCandidate>,
  chosenBar: ImportBarKind | null,
): NameResolution {
  const fromCandidate = (id: string | null): NameResolution => {
    const c = id === null ? undefined : byId.get(id);
    if (!c) return { kind: 'open' };
    const bar = barOf(c.compatibleEquipment);
    return {
      kind: 'exercise',
      exercise: withAssistWord(name, {
        exerciseId: c.exerciseId,
        name: c.name,
        laterality: c.laterality,
        convention: c.defaultLoadConvention,
        // The exercise's own bar; never one read from the source name (PM decision after review r7).
        bar,
        // Only the exercise's own name or a word in the source name gives the count; a suggestion never does (review r4 S1, r5 S1).
        implements: implementsFor(name, c),
        equipment: c.compatibleEquipment,
        newKind: null,
        loadAs: null,
      }),
    };
  };
  if (answer) {
    switch (answer.kind) {
      case 'skip':
        return { kind: 'skip' };
      case 'exercise':
        return fromCandidate(answer.exerciseId);
      case 'new': {
        const stored = name.slice(0, 120);
        // A new barbell exercise is made with the Olympic bar, or the bar Ben chose for its "plates only" answer on the barbell question
        // (`chosenBar` is only passed then; review r8 S2); never one read from the name (PM decision after review r7).
        const bar: BarOf = answer.equipment === 'barbell' ? 'barbell' : 'none';
        const made: ExerciseEquipmentKind = answer.equipment === 'barbell' ? (chosenBar ?? 'barbell') : answer.equipment;
        return {
          kind: 'exercise',
          exercise: withAssistWord(name, {
            exerciseId: addNewExerciseId(ctx, nameKey(stored), key, answer.equipment, made, byId),
            name: stored,
            laterality: 'bilateral',
            convention: CONVENTION_BY_KIND[answer.equipment],
            bar,
            // A new dumbbell exercise: one or two isn't known, so it is asked (review r3 S1).
            implements: null,
            equipment: [made],
            newKind: answer.equipment,
            loadAs: null,
          }),
        };
      }
    }
  }
  if (match.status !== 'matched') return { kind: 'open' };
  if (match.skip) return { kind: 'skip' };
  return fromCandidate(match.exerciseId);
}

function half(v: number): number {
  return fromScaled(toScaled(v) / 2);
}

/**
 * How one exercise's dumbbell values are read (review r3 S1): Ben's own
 * answer for it; else `one` when the catalogue says it uses one dumbbell
 * (the group answer never halves a one-arm row or a goblet squat); else the
 * group answer when it uses two. An exercise whose count isn't recorded
 * never takes the group answer: null until Ben answers it.
 */
export function perHandReading(count: ImplementCount | null, override: PerHandReading | null, group: PerHandAnswer | null): PerHandReading | null {
  if (override !== null) return override;
  if (count === 1) return 'one';
  if (count === 2) return group;
  return null;
}

/** The weight per dumbbell a written value imports as: halved only for `both`. */
export function perHandValue(value: number, reading: PerHandReading): number {
  return reading === 'both' ? half(value) : value;
}

/**
 * How one bar exercise's values are read (PM decision after review r7):
 * Ben's own answer for it; else the group answer, which is only ever
 * "total as written" (a group `plates_only` stored before then reads as
 * not answered); else null until Ben answers.
 */
export function totalReading(override: TotalAnswer | null, group: TotalAnswer | null): TotalAnswer | null {
  if (override !== null) return override;
  return groupTotal(group);
}

/** The group answer as read now: only `total` (PM decision after review r7). */
export function groupTotal(group: TotalAnswer | null): GroupTotalAnswer | null {
  return group === 'total' ? 'total' : null;
}

/** The bar a plates-only value of this exercise adds: the one Ben chose for it, else the exercise's own. */
export function platesOnlyBar(ex: Pick<ResolvedExercise, 'bar'>, key: string, answers: Pick<ImportAnswers, 'totalBars'>): Exclude<BarOf, 'none'> {
  const chosen = answers.totalBars?.[key];
  if (chosen !== undefined) return chosen;
  return ex.bar === 'none' ? 'unknown' : ex.bar;
}

/** What the copy calls an exercise's implement: kettlebell only when it uses a kettlebell and no dumbbells. */
function implementOf(equipment: readonly ExerciseEquipmentKind[]): 'dumbbell' | 'kettlebell' {
  return equipment.includes('kettlebell') && !equipment.includes('dumbbells') ? 'kettlebell' : 'dumbbell';
}

function plus(a: number, b: number): number {
  return fromScaled(toScaled(a) + toScaled(b));
}

/** The weight the row entered: its own, or the column Ben chose when both are filled. Undefined = still to be answered. */
function enteredWeight(row: FitNotesRow, answers: ImportAnswers): { value: number; unit: WeightUnit } | null | undefined {
  if (row.bothColumns) {
    if (answers.bothColumns === null) return undefined;
    return { value: row.bothColumns[answers.bothColumns], unit: answers.bothColumns };
  }
  return row.weight;
}

/** A bar's weight per unit: the Olympic bar has the spec's editable default; EZ and trap bars have none until Ben enters one. */
function barWeightOf(bar: ImportBarKind, answers: Pick<ImportAnswers, 'barWeight' | 'otherBarWeight'>): { kg: number | null; lb: number | null } {
  return bar === 'barbell' ? answers.barWeight : answers.otherBarWeight[bar];
}

/**
 * Whether Ben's remembered barbell answer for a name is exactly what this
 * import would do with it (review r8 B1, B2). Pure.
 * - It must be for the exercise the name maps to now (a remembered answer
 *   never follows the name to another exercise), and records from before
 *   the exercise was kept never fit.
 * - "Total as written" adds nothing, so that is all.
 * - "Plates only" must add the same bar: the one Ben chose then, or the
 *   exercise's own bar when that is still the one it was read with.
 * - And that bar's weight in effect now, in every unit the exercise's sets
 *   are written in, must be the one it was read with then, or still be
 *   empty (an EZ or trap bar's weight is then asked before anything is
 *   imported). A kg answer never fills in a 45 lb default it never saw.
 */
export function rememberedTotalFits(
  r: RememberedTotal,
  now: { exerciseId: string; exerciseBar: Exclude<BarOf, 'none'>; units: readonly WeightUnit[] },
  answers: Pick<ImportAnswers, 'barWeight' | 'otherBarWeight'>,
): boolean {
  if (r.exerciseId === undefined || r.exerciseId !== now.exerciseId) return false;
  if (r.reading === 'total') return true;
  if (r.bar === undefined) return false;
  if (r.barChosen !== true && r.bar !== now.exerciseBar) return false;
  const weight = barWeightOf(r.bar, answers);
  return now.units.every((u) => weight[u] === null || weight[u] === r.barWeight?.[u]);
}

function negative(value: number): string {
  return `Negative weight (${String(value)}) on an exercise that doesn’t use assistance`;
}

/** The dumbbell question from the rows still to import (review r3 S1). */
function perHandQuestion(
  live: readonly FitNotesRow[],
  resolved: (r: FitNotesRow) => ResolvedExercise | null,
  answers: ImportAnswers,
  remembered: ReadonlyMap<string, PerHandReading>,
): PerHandQuestion | null {
  const members = new Map<string, PerHandExercise>();
  const sampleDates = new Map<string, string>();
  let example: ExampleSet | null = null;
  for (const r of live) {
    const ex = resolved(r);
    if (ex?.convention !== 'per_hand') continue;
    const w = enteredWeight(r, answers) ?? (r.bothColumns ? { value: r.bothColumns.kg, unit: 'kg' as const } : null);
    if (w === null) continue;
    const key = nameKey(r.exercise);
    let m = members.get(key);
    if (!m) {
      const override = answers.perHandOverrides[key] ?? null;
      m = {
        key,
        name: r.exercise,
        exerciseName: ex.name,
        sets: 0,
        implements: ex.implements,
        implement: implementOf(ex.equipment),
        override,
        remembered: remembered.get(key) ?? null,
        reading: perHandReading(ex.implements, override, answers.perHand),
        sample: null,
      };
      members.set(key, m);
    }
    m.sets += 1;
    const date = r.date ?? '';
    // The newest readable set (first in the file on that date); a negative weight can't be read for dumbbells.
    if (r.reps !== null && w.value >= 0 && (m.sample === null || date > (sampleDates.get(key) ?? ''))) {
      m.sample = { value: w.value, unit: w.unit, imported: m.reading === null ? null : perHandValue(w.value, m.reading) };
      sampleDates.set(key, date);
    }
    // The example is from an exercise the group answer reads: a pair with no answer of its own (review r5 N4).
    if (ex.implements === 2 && m.override === null && r.reps !== null && (example === null || date > example.date)) example = { name: r.exercise, date, value: w.value, unit: w.unit, reps: r.reps };
  }
  if (members.size === 0) return null;
  const exercises = [...members.values()];
  const needsGroup = exercises.some((e) => e.reading === null && e.implements === 2);
  const needsCount = exercises.filter((e) => e.reading === null && e.implements === null).length;
  return {
    exercises,
    answer: answers.perHand,
    pairs: exercises.filter((e) => e.implements === 2 && e.override === null).length,
    example,
    needsGroup,
    needsCount,
    open: needsGroup || needsCount > 0,
  };
}

/** The barbell question from the rows still to import (PM decision after review r7). */
function totalQuestion(
  live: readonly FitNotesRow[],
  resolved: (r: FitNotesRow) => ResolvedExercise | null,
  answers: ImportAnswers,
  remembered: ReadonlyMap<string, RememberedTotal>,
): TotalQuestion | null {
  const members = new Map<string, TotalExercise>();
  const sampleDates = new Map<string, string>();
  const barUse = new Map<ImportBarKind, { units: Set<WeightUnit>; needed: Set<WeightUnit> }>();
  let example: ExampleSet | null = null;
  for (const r of live) {
    const ex = resolved(r);
    if (ex?.convention !== 'total' || ex.bar === 'none') continue;
    const entered = enteredWeight(r, answers);
    const w = entered ?? (r.bothColumns ? { value: r.bothColumns.kg, unit: 'kg' as const } : null);
    if (w === null) continue;
    const key = nameKey(r.exercise);
    let m = members.get(key);
    if (!m) {
      const override = answers.totalOverrides[key] ?? null;
      m = {
        key,
        name: r.exercise,
        exerciseName: ex.name,
        exerciseId: ex.exerciseId,
        sets: 0,
        units: [],
        barWeights: {},
        exerciseBar: ex.bar,
        bar: platesOnlyBar(ex, key, answers),
        barChosen: answers.totalBars?.[key] !== undefined,
        override,
        remembered: remembered.get(key) ?? null,
        rememberedFits: false,
        reading: totalReading(override, answers.total),
        sample: null,
      };
      members.set(key, m);
    }
    m.sets += 1;
    for (const u of entered ? [entered.unit] : r.bothColumns ? (['kg', 'lb'] as const) : []) if (!m.units.includes(u)) m.units.push(u);
    const bar = m.bar === 'unknown' ? null : m.bar;
    // Each bar's weight per unit, and whether plates-only rows need it (review S1).
    if (bar !== null && entered) {
      const use = barUse.get(bar) ?? { units: new Set<WeightUnit>(), needed: new Set<WeightUnit>() };
      use.units.add(entered.unit);
      if (m.reading === 'plates_only') use.needed.add(entered.unit);
      barUse.set(bar, use);
    }
    const date = r.date ?? '';
    // The newest readable set (first in the file on that date), with what it imports as either way.
    if (r.reps !== null && w.value >= 0 && (m.sample === null || date > (sampleDates.get(key) ?? ''))) {
      const barWeight = bar === null ? null : barWeightOf(bar, answers)[w.unit];
      const platesOnly = barWeight === null ? null : plus(w.value, barWeight);
      const imported = m.reading === 'total' ? w.value : m.reading === 'plates_only' ? platesOnly : null;
      m.sample = { value: w.value, unit: w.unit, imported, barWeight, platesOnly };
      sampleDates.set(key, date);
    }
    if (m.override === null && r.reps !== null && (example === null || date > example.date)) example = { name: r.exercise, date, value: w.value, unit: w.unit, reps: r.reps };
  }
  if (members.size === 0) return null;
  const exercises = [...members.values()];
  for (const m of exercises) {
    m.units.sort();
    if (m.bar !== 'unknown') {
      const weight = barWeightOf(m.bar, answers);
      for (const u of m.units) {
        const w = weight[u];
        if (w !== null) m.barWeights[u] = w;
      }
    }
    m.rememberedFits = m.remembered !== null && rememberedTotalFits(m.remembered, m, answers);
  }
  const bars: BarWeightQuestion[] = BAR_KINDS.flatMap((bar) => {
    const use = barUse.get(bar);
    if (!use) return [];
    const weight = barWeightOf(bar, answers);
    const missing = [...use.needed].filter((u) => weight[u] === null).sort();
    return [{ bar, units: [...use.units].sort(), weight, needed: use.needed.size > 0, missing }];
  });
  const missingBarWeight = bars.some((b) => b.missing.length > 0);
  const needsGroup = exercises.some((e) => e.reading === null);
  const needsBar = exercises.filter((e) => e.reading === 'plates_only' && e.bar === 'unknown').length;
  return {
    exercises,
    answer: groupTotal(answers.total),
    grouped: exercises.filter((e) => e.override === null).length,
    example,
    needsGroup,
    needsBar,
    bars,
    missingBarWeight,
    open: needsGroup || needsBar > 0 || missingBarWeight,
  };
}

/**
 * Each name's match against one context, kept with the context: a preview is
 * analysed again after every answer against the same context, and matching
 * every name against every exercise is most of that work (check 27). The
 * context is read-only, so a kept match is the match.
 */
const MATCHES = new WeakMap<ImportContext, Map<string, NameMatch>>();

function matchIn(ctx: ImportContext, key: string, name: string, categories: readonly string[]): NameMatch {
  let kept = MATCHES.get(ctx);
  if (!kept) {
    kept = new Map();
    MATCHES.set(ctx, kept);
  }
  // The category hint is part of the match, so it is part of the kept key.
  const keptKey = `${key}\u0000${categories.join('\u0000')}`;
  let m = kept.get(keptKey);
  if (!m) {
    m = matchName(name, ctx.candidates, ctx.aliases, categoryHint(categories));
    kept.set(keptKey, m);
  }
  return m;
}

/** The FitNotes `Category` cell (third column in every layout), trimmed. */
function categoryOf(r: FitNotesRow): string {
  return (r.cells[2] ?? '').trim();
}

/**
 * Analyse a parsed file against the app's data and Ben's answers. Rows are
 * the parser's data rows in file order.
 */
export function analyseImport(input: { variant: FitNotesVariant; rows: readonly FitNotesRow[] }, ctx: ImportContext, answers: ImportAnswers): ImportAnalysis {
  const byId = new Map(ctx.candidates.map((c) => [c.exerciseId, c]));
  const { rows } = input;

  // Names: only rows that could be imported need a mapping.
  const strength = rows.filter((r) => r.rowClass === 'strength' && r.date !== null);
  const dateSkipped = (date: string): boolean => ctx.importedDates.has(date) || (ctx.appDates.has(date) && answers.existingDates === 'skip');
  // Every category each name was filed under, first seen first: the matcher's ranking hint.
  const categories = new Map<string, string[]>();
  for (const r of strength) {
    const key = nameKey(r.exercise);
    const list = categories.get(key) ?? [];
    const c = categoryOf(r);
    if (c !== '' && !list.includes(c)) list.push(c);
    categories.set(key, list);
  }
  const nameRows = new Map<string, NameRow>();
  for (const r of strength) {
    const key = nameKey(r.exercise);
    let n = nameRows.get(key);
    if (!n) {
      const filed = categories.get(key) ?? [];
      const match = matchIn(ctx, key, r.exercise, filed);
      const answer = answers.names[key] ?? null;
      // The bar Ben chose shapes the exercise `Add new` makes only when he answered it "plates only" (review r8 S2).
      const chosenBar = answers.totalOverrides[key] === 'plates_only' ? (answers.totalBars?.[key] ?? null) : null;
      const resolution = resolveName(key, r.exercise, match, answer, ctx, byId, chosenBar);
      n = { key, name: r.exercise, sets: 0, match, answer, resolution, needsAnswer: resolution.kind === 'open', category: filed[0] ?? null };
      nameRows.set(key, n);
    }
    if (r.date !== null && !dateSkipped(r.date)) n.sets += 1;
  }

  // Rows whose load needs a convention answer: strength rows not skipped by date or by name.
  const live = strength.filter((r) => r.date !== null && !dateSkipped(r.date) && nameRows.get(nameKey(r.exercise))?.resolution.kind !== 'skip');
  const resolved = (r: FitNotesRow): ResolvedExercise | null => {
    const res = nameRows.get(nameKey(r.exercise))?.resolution;
    return res?.kind === 'exercise' ? res.exercise : null;
  };

  // FitNotes 2 rows with both columns: one question per file.
  const bothRows = live.filter((r) => r.bothColumns !== null).length;
  const unit = bothRows > 0 ? { rows: bothRows, answer: answers.bothColumns } : null;

  // Group questions (dumbbells, barbell) and per-exercise bodyweight questions.
  const perHand = perHandQuestion(live, resolved, answers, ctx.perHandAnswers ?? new Map());
  // Barbell question: `total` exercises on a bar. Each bar kind has its own weight (review S1).
  const total = totalQuestion(live, resolved, answers, ctx.totalAnswers ?? new Map());

  // Each name's range of values over every strength row of it in the file, dates skipped as already
  // imported included: the file is the evidence of how Ben writes the sign, so the same rows read the
  // same way whatever was imported before (review r6.1 S2).
  const fileRange = new Map<string, { min: number; max: number }>();
  for (const r of strength) {
    const w = enteredWeight(r, answers) ?? (r.bothColumns ? { value: r.bothColumns.kg, unit: 'kg' as const } : null);
    if (!w) continue;
    const key = nameKey(r.exercise);
    const range = fileRange.get(key) ?? { min: w.value, max: w.value };
    fileRange.set(key, { min: Math.min(range.min, w.value), max: Math.max(range.max, w.value) });
  }
  const spansZero = (key: string): boolean => {
    const range = fileRange.get(key);
    return range !== undefined && range.min < 0 && range.max > 0;
  };

  const bwMap = new Map<string, BodyweightQuestion>();
  for (const r of live) {
    const ex = resolved(r);
    if (ex?.convention !== 'bodyweight') continue;
    const key = nameKey(r.exercise);
    const q = bwMap.get(key);
    if (q) q.sets += 1;
    else {
      const range = fileRange.get(key) ?? { min: 0, max: 0 };
      bwMap.set(key, { key, name: r.exercise, exerciseName: ex.name, sets: 1, min: range.min, max: range.max, mixed: spansZero(key), loadAs: ex.loadAs, answer: answers.bodyweight[key] ?? null });
    }
  }
  // Asked only when the file has a weight other than 0 for that exercise.
  const bodyweight = [...bwMap.values()].filter((q) => q.min !== 0 || q.max !== 0);
  const askedBodyweight = new Set(bodyweight.map((q) => q.key));

  const machines = new Map<string, MachineExercise>();
  const barless = new Map<string, { key: string; name: string; exerciseName: string }>();
  for (const r of live) {
    const ex = resolved(r);
    if (!ex) continue;
    const key = nameKey(r.exercise);
    if (['stack', 'added', 'assistance'].includes(ex.convention) && !machines.has(key)) machines.set(key, { key, name: r.exercise, exerciseName: ex.name, convention: ex.convention, sample: null, mixed: false });
    if (ex.convention === 'total' && ex.bar === 'none' && !barless.has(key)) barless.set(key, { key, name: r.exercise, exerciseName: ex.name });
  }
  // Assisted machines: a positive value among negative ones in the file isn't read as assistance (review r6 S3, r6.1 S2).
  const assistMixed = spansZero;
  /** An assisted machine's value as assistance: negative or the number on the machine, never a positive one among negatives. Null: can't be read. */
  const assistanceOf = (key: string, value: number): number | null => (value > 0 && assistMixed(key) ? null : Math.abs(value));
  const sampleDates = new Map<string, string>();
  for (const r of live) {
    const m = machines.get(nameKey(r.exercise));
    if (m?.convention !== 'assistance' || r.reps === null) continue;
    m.mixed = assistMixed(m.key);
    const w = enteredWeight(r, answers);
    const imported = w ? assistanceOf(m.key, w.value) : null;
    const date = r.date ?? '';
    // The newest readable set (first in the file on that date).
    if (w && imported !== null && (m.sample === null || date > (sampleDates.get(m.key) ?? ''))) {
      m.sample = { value: w.value, unit: w.unit, imported };
      sampleDates.set(m.key, date);
    }
  }

  const checked = new Set(answers.effort.rows);
  const effortCandidates: EffortCandidate[] = [];

  // Fates.
  const fates: RowFate[] = rows.map((r): RowFate => {
    switch (r.rowClass) {
      case 'unreadable':
        return { result: 'unreadable', detail: r.problem ?? 'Couldn’t be read' };
      case 'cardio':
        return { result: 'skipped_cardio', detail: 'Cardio isn’t imported yet' };
      case 'unsupported':
        return { result: 'skipped_unsupported', detail: `${r.problem ?? 'Not a weight-and-reps set'}; not imported yet` };
      case 'strength':
        break;
    }
    const date = r.date;
    if (date === null || r.reps === null) return { result: 'unreadable', detail: r.problem ?? 'Couldn’t be read' };
    const earlier = ctx.importedDates.get(date);
    if (earlier) return { result: 'skipped_duplicate', detail: `Came in with an earlier import (${earlier.fileName})` };
    if (ctx.appDates.has(date) && answers.existingDates === 'skip') return { result: 'skipped_date_exists', detail: 'This date already has a workout in the app' };
    const key = nameKey(r.exercise);
    const res = nameRows.get(key)?.resolution ?? { kind: 'open' };
    if (res.kind === 'skip') return { result: 'skipped_exercise', detail: 'You chose Skip for this exercise' };
    const rpeInComment = r.comment.trim() === '' ? null : effortFromComment(r.comment);
    if (rpeInComment !== null) effortCandidates.push({ row: r.row, date, name: r.exercise, comment: r.comment, rpe: rpeInComment, checked: checked.has(r.row) });
    const w = enteredWeight(r, answers);
    if (w === undefined) return { result: 'pending', reason: 'unit' };
    if (res.kind === 'open') return { result: 'pending', reason: 'name' };
    const ex = res.exercise;
    const rpe = answers.effort.mode === 'review' && checked.has(r.row) ? rpeInComment : null;
    const set = (convention: LoadConvention, load: Load | null): RowFate => ({
      result: 'imported',
      set: { exerciseId: ex.exerciseId, exerciseName: ex.name, laterality: ex.laterality, convention, unit: w?.unit ?? null, load, reps: r.reps ?? 0, rpe },
    });
    const value = w?.value ?? null;
    switch (ex.convention) {
      case 'per_hand': {
        if (w === null || value === null) return set('per_hand', null);
        const reading = perHandReading(ex.implements, answers.perHandOverrides[key] ?? null, answers.perHand);
        if (reading === null) return { result: 'pending', reason: 'per_hand' };
        if (value < 0) return { result: 'unreadable', detail: negative(value) };
        return set('per_hand', { value: perHandValue(value, reading), unit: w.unit, convention: 'per_hand' });
      }
      case 'total': {
        if (w === null || value === null) return set('total', null);
        // No bar (a kettlebell): the value is the total as written; nothing to ask.
        if (ex.bar === 'none') return value < 0 ? { result: 'unreadable', detail: negative(value) } : set('total', { value, unit: w.unit, convention: 'total' });
        // The group answer is only ever "total as written"; a bar is added only by Ben's answer for this exercise (PM decision after review r7).
        const choice = totalReading(answers.totalOverrides[key] ?? null, answers.total);
        if (choice === null) return { result: 'pending', reason: 'total' };
        if (value < 0) return { result: 'unreadable', detail: negative(value) };
        if (choice === 'total') return set('total', { value, unit: w.unit, convention: 'total' });
        // Plates only: the bar Ben chose, else the exercise's own; none recorded waits for him to choose one.
        const barKind = platesOnlyBar(ex, key, answers);
        if (barKind === 'unknown') return { result: 'pending', reason: 'total' };
        const bar = barWeightOf(barKind, answers)[w.unit];
        if (bar === null) return { result: 'pending', reason: 'total' };
        return set('total', { value: plus(value, bar), unit: w.unit, convention: 'total' });
      }
      case 'bodyweight': {
        // Not asked (every value 0): bodyweight with no load. On a stack exercise whose name says assisted, 0 is
        // no assistance (full bodyweight), not nothing lifted, so it is never stored as a 0 stack load (review r6.2 N2).
        if (!askedBodyweight.has(key)) return set('bodyweight', null);
        const choice = answers.bodyweight[key] ?? null;
        if (choice === null) return { result: 'pending', reason: 'bodyweight' };
        if (w === null || value === null) return set(choice === 'assistance' ? 'assistance' : 'added', null);
        // A stack or plates-added exercise whose name says assisted (review r6.1 S1): a load is its own convention.
        const load = ex.loadAs ?? 'added';
        if (choice === 'added') {
          if (value < 0) return { result: 'unreadable', detail: `Negative weight (${String(value)}), but you said ${ex.loadAs === 'stack' ? 'it’s the weight on the stack' : 'weight is added'}` };
          return set(load, { value, unit: w.unit, convention: load });
        }
        if (choice === 'assistance') {
          // Assistance is written as a negative weight or as the number on the machine. When the
          // exercise also has negative values, a positive one is weight added: never flipped (review B3).
          if (value > 0 && bwMap.get(key)?.mixed === true) {
            return { result: 'unreadable', detail: `Positive weight (${String(value)}), but you said this exercise’s values are assistance and its other values are negative` };
          }
          return set('assistance', { value: Math.abs(value), unit: w.unit, convention: 'assistance' });
        }
        // `split`: negative = assistance, positive (or 0) = weight added (or on the stack).
        return value < 0 ? set('assistance', { value: Math.abs(value), unit: w.unit, convention: 'assistance' }) : set(load, { value, unit: w.unit, convention: load });
      }
      case 'stack':
      case 'added': {
        if (w === null || value === null) return set(ex.convention, null);
        if (value < 0) return { result: 'unreadable', detail: negative(value) };
        return set(ex.convention, { value, unit: w.unit, convention: ex.convention });
      }
      case 'assistance': {
        if (w === null || value === null) return set('assistance', null);
        // Assistance written as negative numbers: a positive one among them most likely means weight added. Never flipped (review r6 S3).
        const assistance = assistanceOf(key, value);
        if (assistance === null) return { result: 'unreadable', detail: `Positive weight (${String(value)}) on an assisted exercise whose other values are negative, so it may be weight added; not read as assistance` };
        return set('assistance', { value: assistance, unit: w.unit, convention: 'assistance' });
      }
    }
  });

  // Counts and the workouts list.
  const byResult: FateCounts = {
    imported: 0,
    pending: 0,
    skipped_cardio: 0,
    skipped_unsupported: 0,
    skipped_duplicate: 0,
    skipped_date_exists: 0,
    skipped_exercise: 0,
    unreadable: 0,
  };
  const perDate = new Map<string, { names: Set<string>; sets: number }>();
  const exercises = new Set<string>();
  fates.forEach((f, i) => {
    byResult[f.result] += 1;
    if (f.result !== 'imported' && f.result !== 'pending') return;
    const r = rows[i];
    if (!r?.date) return;
    const d = perDate.get(r.date) ?? { names: new Set<string>(), sets: 0 };
    d.sets += 1;
    const id = f.result === 'imported' ? f.set.exerciseId : `name:${nameKey(r.exercise)}`;
    d.names.add(id);
    exercises.add(id);
    perDate.set(r.date, d);
  });
  const workouts = [...perDate.entries()]
    .map(([date, d]) => ({ date, exercises: d.names.size, sets: d.sets }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const dates = rows.map((r) => r.date).filter((d): d is string => d !== null).sort();
  const fileDates = new Set(dates);
  const appDatesInFile = [...fileDates].filter((d) => ctx.appDates.has(d) && !ctx.importedDates.has(d)).sort();
  const earlierByJob = new Map<string, EarlierImport & { dates: number }>();
  for (const d of fileDates) {
    const e = ctx.importedDates.get(d);
    if (!e) continue;
    const entry = earlierByJob.get(e.jobId) ?? { ...e, dates: 0 };
    entry.dates += 1;
    earlierByJob.set(e.jobId, entry);
  }

  const names = [...nameRows.values()].sort((a, b) => Number(b.needsAnswer) - Number(a.needsAnswer) || b.sets - a.sets || a.name.localeCompare(b.name));
  const questionsOpen =
    (names.some((n) => n.needsAnswer && n.sets > 0) ? 1 : 0) +
    (perHand?.open ? 1 : 0) +
    (total?.open ? 1 : 0) +
    bodyweight.filter((q) => q.answer === null).length +
    (unit !== null && unit.answer === null ? 1 : 0);

  let kg = 0;
  let lb = 0;
  for (const r of rows) {
    if (r.weight?.unit === 'kg') kg += 1;
    else if (r.weight?.unit === 'lb') lb += 1;
  }

  return {
    variant: input.variant,
    rowCount: rows.length,
    dateRange: dates.length === 0 ? null : { first: dates[0] ?? '', last: dates.at(-1) ?? '' },
    units: { kg, lb },
    names,
    perHand,
    total,
    bodyweight,
    unit,
    effort: { mode: answers.effort.mode, candidates: effortCandidates },
    machines: [...machines.values()],
    barless: [...barless.values()],
    comments: rows.filter((r) => r.comment.trim() !== '').length,
    decimalCommaRows: rows.filter((r) => r.decimalComma).length,
    appDates: { count: appDatesInFile.length, newest: appDatesInFile.at(-1) ?? null },
    alreadyImported: { dates: [...fileDates].filter((d) => ctx.importedDates.has(d)).length, imports: [...earlierByJob.values()] },
    fates,
    counts: { workouts: workouts.length, sets: byResult.imported + byResult.pending, exercises: exercises.size, byResult },
    workouts,
    questionsOpen,
    ready: questionsOpen === 0 && byResult.pending === 0 && byResult.imported > 0,
  };
}

/** Deterministic IDs for an import's records (same job → same IDs, so a retry is a no-op). */
export const importIds = {
  session: (jobId: string, date: string) => deriveId(`fitnotes-import:${jobId}:session:${date}`),
  sessionExercise: (jobId: string, date: string, groupKey: string) => deriveId(`fitnotes-import:${jobId}:exercise:${date}:${groupKey}`),
  set: (jobId: string, row: number) => deriveId(`fitnotes-import:${jobId}:row:${String(row)}`),
  /** The workout's start operation ID: unique per owner, so writing it twice is refused. */
  startOperation: (operationId: string, date: string) => `${operationId}:${date}`,
};

const MAX_CELLS = 64;
const MAX_CELL = 20_000;
const CUT_NOTE = 'Stored cut to 64 cells of 20,000 characters each';

/**
 * Freeze an analysis into the rows a commit stores (check 24: every source
 * row is kept). Requires `analysis.ready`. Imported rows get their workout,
 * session exercise and set IDs; within a date, exercises keep the order they
 * first appear in and sets keep row order. One workout per date: FitNotes
 * keeps one workout per calendar date.
 */
export function planImportRows(
  input: { rows: readonly FitNotesRow[] },
  analysis: ImportAnalysis,
  ids: { jobId: string; defaultUnit: WeightUnit },
): ImportRow[] {
  if (!analysis.ready) throw new Error('The import still has questions to answer');
  const { jobId } = ids;
  // Per date: the unit a weightless row joins (the exercise's first weighted unit that day).
  const firstUnit = new Map<string, WeightUnit>();
  analysis.fates.forEach((f, i) => {
    const r = input.rows[i];
    if (f.result !== 'imported' || !r?.date || f.set.unit === null) return;
    const k = `${r.date}|${f.set.exerciseId}|${f.set.convention}`;
    if (!firstUnit.has(k)) firstUnit.set(k, f.set.unit);
  });
  const groups = new Map<string, { order: number; sets: number; id: string }>();
  const sessionIds = new Map<string, string>();
  const groupsPerDate = new Map<string, number>();
  return analysis.fates.map((f, i): ImportRow => {
    const r = input.rows[i];
    if (!r) throw new Error('Row and fate lists differ');
    const base = {
      jobId,
      row: r.row,
      line: r.line,
      localDate: r.date,
      exerciseName: r.exercise.slice(0, 4000),
      cells: r.cells.slice(0, MAX_CELLS).map((c) => c.slice(0, MAX_CELL)),
    };
    // Storage limits: say so when a row's raw text was cut, never silently (review N7).
    const cut = r.cells.length > MAX_CELLS || r.cells.some((c) => c.length > MAX_CELL) ? CUT_NOTE : null;
    if (f.result === 'pending') throw new Error('The import still has questions to answer');
    if (f.result !== 'imported') return { ...base, result: f.result, detail: (cut === null ? f.detail : `${f.detail}. ${cut}`).slice(0, 500), sessionId: null, setId: null, imported: null };
    const date = r.date ?? '';
    const unit = f.set.unit ?? firstUnit.get(`${date}|${f.set.exerciseId}|${f.set.convention}`) ?? ids.defaultUnit;
    const groupKey = `${f.set.exerciseId}|${f.set.convention}|${unit}`;
    const gk = `${date}|${groupKey}`;
    let g = groups.get(gk);
    if (!g) {
      const order = groupsPerDate.get(date) ?? 0;
      groupsPerDate.set(date, order + 1);
      g = { order, sets: 0, id: importIds.sessionExercise(jobId, date, groupKey) };
      groups.set(gk, g);
    }
    const imported: ImportedSet = {
      exerciseId: f.set.exerciseId,
      exerciseName: f.set.exerciseName,
      laterality: f.set.laterality,
      convention: f.set.convention,
      unit,
      load: f.set.load,
      reps: f.set.reps,
      rpe: f.set.rpe,
      sessionExerciseId: g.id,
      exerciseOrder: g.order,
      setIndex: g.sets,
    };
    g.sets += 1;
    let sessionId = sessionIds.get(date);
    if (sessionId === undefined) {
      sessionId = importIds.session(jobId, date);
      sessionIds.set(date, sessionId);
    }
    return { ...base, result: 'imported', detail: cut, sessionId, setId: importIds.set(jobId, r.row), imported };
  });
}

/**
 * A name to remember (`ExerciseAlias`). `perHand`: Ben's own dumbbell
 * answer for the name to store with it; `null` clears an earlier one he
 * took back; absent: this import didn't ask, so it says nothing about it
 * (review r4 S2).
 */
export interface AliasSave {
  key: string;
  name: string;
  target: AliasTarget;
  perHand?: PerHandReading | null;
  /** Ben's barbell answer for the name, as `perHand` (PM decision after review r7). */
  total?: RememberedTotal | null;
}

/** One exercise's barbell answer as it is remembered (review r8 B1, B2). */
function rememberedTotalOf(e: TotalExercise, reading: TotalAnswer): RememberedTotal {
  if (reading === 'total' || e.bar === 'unknown') return { reading, exerciseId: e.exerciseId };
  return { reading, exerciseId: e.exerciseId, bar: e.bar, barChosen: e.barChosen, barWeight: { ...e.barWeights } };
}

/**
 * Names Ben answered, to remember for the next import (`ExerciseAlias`,
 * §2.5 step 3a), and his own answer for an exercise's dumbbells, kept with
 * its name so a newer export reads it the same way (review r4 S2). Only an
 * answer for that exercise is kept; the group answer isn't. A remembered
 * name this import used (with sets) is saved again, so it stays in effect
 * while this import is, even if the import that taught it is undone
 * (review r5 S2).
 */
export function aliasesToSave(analysis: ImportAnalysis): AliasSave[] {
  const dumbbells = new Map((analysis.perHand?.exercises ?? []).map((e) => [e.key, e]));
  const barbells = new Map((analysis.total?.exercises ?? []).map((e) => [e.key, e]));
  const out: AliasSave[] = [];
  for (const n of analysis.names) {
    const e = dumbbells.get(n.key);
    // Asked about this import: his answer, or null when he cleared the one remembered from last time.
    const perHand = e === undefined ? undefined : (e.override ?? (e.remembered === null ? undefined : null));
    const b = barbells.get(n.key);
    // The same for his barbell answer, kept exactly: the exercise, and for plates only the bar it added and that bar's weight (review r8 B1, B2).
    const total: RememberedTotal | null | undefined =
      b === undefined ? undefined : b.override !== null ? rememberedTotalOf(b, b.override) : b.remembered === null ? undefined : null;
    const used = n.answer === null && n.match.via === 'alias' && n.sets > 0;
    if (n.resolution.kind === 'skip') {
      if (n.answer || used) out.push({ key: n.key, name: n.name, target: { kind: 'skip' } });
      continue;
    }
    if (n.resolution.kind !== 'exercise' || (!n.answer && !used && perHand === undefined && total === undefined)) continue;
    const target: AliasTarget = { kind: 'exercise', exerciseId: n.resolution.exercise.exerciseId };
    out.push({ key: n.key, name: n.name, target, ...(perHand === undefined ? {} : { perHand }), ...(total === undefined ? {} : { total }) });
  }
  return out;
}

/**
 * The answers a new preview starts from (review r4 S2, N2). Load
 * conventions are never pre-answered (DX6), except with Ben's own answers
 * still in effect:
 * - this same file's import, finished and not undone (the file is opened
 *   again because some of its dates aren't in the app now): its answers,
 *   except names (remembered as aliases) and a gym that is gone;
 * - each name's dumbbell answer from the newest import still in effect
 *   that had it (`perHandAnswers`), shown as his answer last time;
 * - each name's barbell answer likewise (`totalAnswers`), but only when it
 *   is exactly what this import would do with it: the same exercise, bar
 *   and bar weight (`rememberedTotalFits`; review r8 B1, B2). Otherwise
 *   the exercise is asked with nothing selected, and the earlier answer is
 *   shown as information only.
 * An undone import's answers are never among them (review r6 N4), and a
 * preview rebuilt against changed data starts from here again (r6 S1).
 */
export function startingAnswers(
  input: { variant: FitNotesVariant; rows: readonly FitNotesRow[] },
  ctx: ImportContext,
  earlier: { answers: ImportAnswers; gymIds: ReadonlySet<string> } | null,
): ImportAnswers {
  const base: ImportAnswers = earlier
    ? {
        ...earlier.answers,
        names: {},
        gymId: earlier.answers.gymId !== null && earlier.gymIds.has(earlier.answers.gymId) ? earlier.answers.gymId : null,
        // A group "plates only" from before the PM decision after review r7 is never carried over: no group answer adds a bar.
        total: groupTotal(earlier.answers.total),
      }
    : DEFAULT_ANSWERS;
  const remembered = ctx.perHandAnswers ?? new Map<string, PerHandReading>();
  const overrides: Record<string, PerHandReading> = { ...base.perHandOverrides };
  for (const r of input.rows) {
    if (r.rowClass !== 'strength') continue;
    const key = nameKey(r.exercise);
    const answer = remembered.get(key);
    if (answer !== undefined) overrides[key] = answer;
  }
  const start: ImportAnswers = { ...base, perHandOverrides: overrides, totalOverrides: { ...base.totalOverrides }, totalBars: { ...base.totalBars } };
  if ((ctx.totalAnswers?.size ?? 0) === 0) return start;
  // Each barbell exercise as this import reads it before any barbell answer is filled in: which exercise, bar, units and bar weights.
  const totalOverrides: Record<string, TotalAnswer> = { ...start.totalOverrides };
  const totalBars: Record<string, ImportBarKind> = { ...start.totalBars };
  for (const e of analyseImport(input, ctx, start).total?.exercises ?? []) {
    const r = e.remembered;
    if (r === null || !e.rememberedFits) continue;
    totalOverrides[e.key] = r.reading;
    if (r.reading === 'plates_only' && r.barChosen === true && r.bar !== undefined && r.bar !== e.exerciseBar) totalBars[e.key] = r.bar;
  }
  return { ...start, totalOverrides, totalBars };
}

/** Custom exercises `Add new` makes, for names with at least one imported set. */
export function newExercisesToCreate(analysis: ImportAnalysis): ResolvedExercise[] {
  const used = new Set<string>();
  for (const f of analysis.fates) if (f.result === 'imported') used.add(f.set.exerciseId);
  const out = new Map<string, ResolvedExercise>();
  for (const n of analysis.names) {
    if (n.resolution.kind !== 'exercise' || n.resolution.exercise.newKind === null) continue;
    if (used.has(n.resolution.exercise.exerciseId)) out.set(n.resolution.exercise.exerciseId, n.resolution.exercise);
  }
  return [...out.values()];
}

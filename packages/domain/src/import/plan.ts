import type {
  AliasTarget,
  BodyweightAnswer,
  CustomExerciseKind,
  ExerciseEquipmentKind,
  FitNotesVariant,
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
import { barNamed, implementsFor, matchName, nameKey, saysSmith, type MatchCandidate, type NameMatch } from './match';

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
 * this`, gives the exercise only: an exercise whose dumbbell count or bar
 * isn't known that way never takes a group answer and is asked on its own,
 * with nothing selected, showing what it will import as.
 */

export const DEFAULT_ANSWERS: ImportAnswers = {
  names: {},
  perHand: null,
  perHandOverrides: {},
  total: null,
  totalOverrides: {},
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
 *   Asked, but a plates-only value can't have a bar weight added (unreadable).
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
  /** Which bar a `plates_only` value adds (only read for `total`). */
  bar: BarOf;
  /**
   * `total` on a bar: the bar is known from the name (`barNamed`: one of the
   * exercise's own names, or a bar word) or from Ben's `Add new` answer, so
   * the barbell group answer reads it. False: asked on its own (PM decision,
   * review r5). Always true off a bar (nothing can be added).
   */
  barKnown: boolean;
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
}

export interface ExampleSet {
  name: string;
  date: string;
  /** The weight as written (`22.5`). */
  value: number;
  unit: WeightUnit;
  reps: number;
}

/** One exercise on the barbell question (PM decision, review r5). */
export interface TotalExercise {
  key: string;
  /** As first written in the file. */
  name: string;
  /** The app's exercise it maps to. */
  exerciseName: string;
  sets: number;
  /** The bar "plates only" adds (`unknown`: none can be added). */
  bar: Exclude<BarOf, 'none'>;
  /** The bar is known (`ResolvedExercise.barKnown`): the group answer reads it. Otherwise it is asked on its own. */
  known: boolean;
  override: TotalAnswer | null;
  /** How its values are read now (`totalReading`). Null: still to answer. */
  reading: TotalAnswer | null;
  /**
   * Its newest weight in the file and what it imports as under `reading`:
   * `imported` is null while unanswered, while the bar's weight is missing,
   * or when no bar can be added (`bar: 'unknown'`); `barWeight` is the
   * weight added for plates only.
   */
  sample: { value: number; unit: WeightUnit; imported: number | null; barWeight: number | null } | null;
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
 * Barbell weights (§2.5 step 3b; PM decision, review r5). The group answer
 * (total / plates only) reads exercises whose bar is known; any other bar
 * exercise is asked on its own with no default (DX6). Every exercise shows
 * what it will import as.
 */
export interface TotalQuestion {
  exercises: TotalExercise[];
  /** The group answer, for exercises whose bar is known and with no answer of their own. */
  answer: TotalAnswer | null;
  /** Exercises the group answer reads (the group question is shown only when there is one). */
  grouped: number;
  /** The newest set of an exercise the group answer reads. */
  example: ExampleSet | null;
  /** An exercise the group answer reads waits for it. */
  needsGroup: boolean;
  /** Exercises whose bar isn't known, with no answer yet. */
  needsOwn: number;
  bars: BarWeightQuestion[];
  missingBarWeight: boolean;
  open: boolean;
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
  machines: { key: string; name: string; exerciseName: string; convention: LoadConvention }[];
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
export function customExerciseIdFor(ownerId: string, key: string, kind: CustomExerciseKind): string {
  return deriveId(`custom-exercise:${ownerId}:fitnotes:${key}:${kind}`);
}

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
  return e.id === legacyCustomExerciseIdFor(ownerId, key) || CUSTOM_KINDS.some((k) => e.id === customExerciseIdFor(ownerId, key, k));
}

/**
 * The exercise `Add new` with this equipment maps a name to: its own
 * (`customExerciseIdFor`), or one an earlier build made for the name under
 * the old ID when it is still exactly that equipment, so its history stays
 * together. Either way it is never changed (review r6 B1).
 */
function addNewExerciseId(ctx: ImportContext, key: string, kind: CustomExerciseKind, byId: ReadonlyMap<string, MatchCandidate>): string {
  const legacy = byId.get(legacyCustomExerciseIdFor(ctx.ownerId, key));
  const same = legacy?.importMade === true && legacy.defaultLoadConvention === CONVENTION_BY_KIND[kind] && legacy.compatibleEquipment.length === 1 && legacy.compatibleEquipment[0] === kind;
  return same ? legacy.exerciseId : customExerciseIdFor(ctx.ownerId, key, kind);
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
): NameResolution {
  const fromCandidate = (id: string | null): NameResolution => {
    const c = id === null ? undefined : byId.get(id);
    if (!c) return { kind: 'open' };
    const bar = barOf(c.compatibleEquipment);
    return {
      kind: 'exercise',
      exercise: {
        exerciseId: c.exerciseId,
        name: c.name,
        laterality: c.laterality,
        convention: c.defaultLoadConvention,
        bar,
        // A bar the name doesn't establish is never added by the group answer (PM decision, review r5).
        barKnown: bar === 'none' || bar === 'unknown' || barNamed(name, c, bar),
        // Only the exercise's own name or a word in the source name gives the count; a suggestion never does (review r4 S1, r5 S1).
        implements: implementsFor(name, c),
        equipment: c.compatibleEquipment,
        newKind: null,
      },
    };
  };
  if (answer) {
    switch (answer.kind) {
      case 'skip':
        return { kind: 'skip' };
      case 'exercise':
        return fromCandidate(answer.exerciseId);
      case 'new':
        return {
          kind: 'exercise',
          exercise: {
            exerciseId: addNewExerciseId(ctx, key, answer.equipment, byId),
            name: name.slice(0, 120),
            laterality: 'bilateral',
            convention: CONVENTION_BY_KIND[answer.equipment],
            bar: answer.equipment === 'barbell' ? 'barbell' : 'none',
            // Ben said it's a barbell exercise: the group answer reads it. Unless the name says Smith: a
            // Smith machine's bar isn't the Olympic bar, so it is asked on its own (review r6 B2).
            barKnown: answer.equipment !== 'barbell' || !saysSmith(name),
            // A new dumbbell exercise: one or two isn't known, so it is asked (review r3 S1).
            implements: null,
            equipment: [answer.equipment],
            newKind: answer.equipment,
          },
        };
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
 * How one bar exercise's values are read (PM decision, review r5): Ben's
 * own answer for it; else the group answer when its bar is known; else
 * null until Ben answers it.
 */
export function totalReading(known: boolean, override: TotalAnswer | null, group: TotalAnswer | null): TotalAnswer | null {
  if (override !== null) return override;
  return known ? group : null;
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
function barWeightOf(bar: ImportBarKind, answers: ImportAnswers): { kg: number | null; lb: number | null } {
  return bar === 'barbell' ? answers.barWeight : answers.otherBarWeight[bar];
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

/** The barbell question from the rows still to import (PM decision, review r5). */
function totalQuestion(live: readonly FitNotesRow[], resolved: (r: FitNotesRow) => ResolvedExercise | null, answers: ImportAnswers): TotalQuestion | null {
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
      m = { key, name: r.exercise, exerciseName: ex.name, sets: 0, bar: ex.bar, known: ex.barKnown, override, reading: totalReading(ex.barKnown, override, answers.total), sample: null };
      members.set(key, m);
    }
    m.sets += 1;
    const bar = ex.bar === 'unknown' ? null : ex.bar;
    // Each bar's weight per unit, and whether plates-only rows need it (review S1).
    if (bar !== null && entered) {
      const use = barUse.get(bar) ?? { units: new Set<WeightUnit>(), needed: new Set<WeightUnit>() };
      use.units.add(entered.unit);
      if (m.reading === 'plates_only') use.needed.add(entered.unit);
      barUse.set(bar, use);
    }
    const date = r.date ?? '';
    // The newest readable set (first in the file on that date), with what it imports as.
    if (r.reps !== null && w.value >= 0 && (m.sample === null || date > (sampleDates.get(key) ?? ''))) {
      const barWeight = bar === null ? null : barWeightOf(bar, answers)[w.unit];
      const imported = m.reading === 'total' ? w.value : m.reading === 'plates_only' && barWeight !== null ? plus(w.value, barWeight) : null;
      m.sample = { value: w.value, unit: w.unit, imported, barWeight };
      sampleDates.set(key, date);
    }
    if (m.known && m.override === null && r.reps !== null && (example === null || date > example.date)) example = { name: r.exercise, date, value: w.value, unit: w.unit, reps: r.reps };
  }
  if (members.size === 0) return null;
  const exercises = [...members.values()];
  const bars: BarWeightQuestion[] = BAR_KINDS.flatMap((bar) => {
    const use = barUse.get(bar);
    if (!use) return [];
    const weight = barWeightOf(bar, answers);
    const missing = [...use.needed].filter((u) => weight[u] === null).sort();
    return [{ bar, units: [...use.units].sort(), weight, needed: use.needed.size > 0, missing }];
  });
  const missingBarWeight = bars.some((b) => b.missing.length > 0);
  const needsGroup = exercises.some((e) => e.reading === null && e.known);
  const needsOwn = exercises.filter((e) => e.reading === null && !e.known).length;
  return {
    exercises,
    answer: answers.total,
    grouped: exercises.filter((e) => e.known && e.override === null).length,
    example,
    needsGroup,
    needsOwn,
    bars,
    missingBarWeight,
    open: needsGroup || needsOwn > 0 || missingBarWeight,
  };
}

/**
 * Each name's match against one context, kept with the context: a preview is
 * analysed again after every answer against the same context, and matching
 * every name against every exercise is most of that work (check 27). The
 * context is read-only, so a kept match is the match.
 */
const MATCHES = new WeakMap<ImportContext, Map<string, NameMatch>>();

function matchIn(ctx: ImportContext, key: string, name: string): NameMatch {
  let kept = MATCHES.get(ctx);
  if (!kept) {
    kept = new Map();
    MATCHES.set(ctx, kept);
  }
  let m = kept.get(key);
  if (!m) {
    m = matchName(name, ctx.candidates, ctx.aliases);
    kept.set(key, m);
  }
  return m;
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
  const nameRows = new Map<string, NameRow>();
  for (const r of strength) {
    const key = nameKey(r.exercise);
    let n = nameRows.get(key);
    if (!n) {
      const match = matchIn(ctx, key, r.exercise);
      const answer = answers.names[key] ?? null;
      const resolution = resolveName(key, r.exercise, match, answer, ctx, byId);
      n = { key, name: r.exercise, sets: 0, match, answer, resolution, needsAnswer: resolution.kind === 'open' };
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
  const total = totalQuestion(live, resolved, answers);

  const bwMap = new Map<string, BodyweightQuestion>();
  for (const r of live) {
    const ex = resolved(r);
    if (ex?.convention !== 'bodyweight') continue;
    const w = enteredWeight(r, answers) ?? (r.bothColumns ? { value: r.bothColumns.kg, unit: 'kg' as const } : null);
    const key = nameKey(r.exercise);
    const q = bwMap.get(key);
    const value = w?.value ?? 0;
    if (q) {
      q.sets += 1;
      q.min = Math.min(q.min, value);
      q.max = Math.max(q.max, value);
      q.mixed = q.min < 0 && q.max > 0;
    } else {
      bwMap.set(key, { key, name: r.exercise, exerciseName: ex.name, sets: 1, min: value, max: value, mixed: false, answer: answers.bodyweight[key] ?? null });
    }
  }
  // Asked only when the file has a weight other than 0 for that exercise.
  const bodyweight = [...bwMap.values()].filter((q) => q.min !== 0 || q.max !== 0);
  const askedBodyweight = new Set(bodyweight.map((q) => q.key));

  const machines = new Map<string, { key: string; name: string; exerciseName: string; convention: LoadConvention }>();
  const barless = new Map<string, { key: string; name: string; exerciseName: string }>();
  for (const r of live) {
    const ex = resolved(r);
    if (!ex) continue;
    const key = nameKey(r.exercise);
    if (['stack', 'added', 'assistance'].includes(ex.convention) && !machines.has(key)) machines.set(key, { key, name: r.exercise, exerciseName: ex.name, convention: ex.convention });
    if (ex.convention === 'total' && ex.bar === 'none' && !barless.has(key)) barless.set(key, { key, name: r.exercise, exerciseName: ex.name });
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
        // The group answer reads it only when its bar is known (PM decision, review r5).
        const choice = totalReading(ex.barKnown, answers.totalOverrides[key] ?? null, answers.total);
        if (choice === null) return { result: 'pending', reason: 'total' };
        if (value < 0) return { result: 'unreadable', detail: negative(value) };
        if (choice === 'total') return set('total', { value, unit: w.unit, convention: 'total' });
        if (ex.bar === 'unknown') return { result: 'unreadable', detail: `Plates only (${String(value)}), but which bar ${ex.name} uses isn’t recorded, so no bar weight can be added` };
        const bar = barWeightOf(ex.bar, answers)[w.unit];
        if (bar === null) return { result: 'pending', reason: 'total' };
        return set('total', { value: plus(value, bar), unit: w.unit, convention: 'total' });
      }
      case 'bodyweight': {
        if (!askedBodyweight.has(key)) return set('bodyweight', null);
        const choice = answers.bodyweight[key] ?? null;
        if (choice === null) return { result: 'pending', reason: 'bodyweight' };
        if (w === null || value === null) return set(choice === 'assistance' ? 'assistance' : 'added', null);
        if (choice === 'added') {
          if (value < 0) return { result: 'unreadable', detail: `Negative weight (${String(value)}), but you said weight is added` };
          return set('added', { value, unit: w.unit, convention: 'added' });
        }
        if (choice === 'assistance') {
          // Assistance is written as a negative weight or as the number on the machine. When the
          // exercise also has negative values, a positive one is weight added: never flipped (review B3).
          if (value > 0 && bwMap.get(key)?.mixed === true) {
            return { result: 'unreadable', detail: `Positive weight (${String(value)}), but you said this exercise’s values are assistance and its other values are negative` };
          }
          return set('assistance', { value: Math.abs(value), unit: w.unit, convention: 'assistance' });
        }
        // `split`: negative = assistance, positive (or 0) = weight added.
        return value < 0 ? set('assistance', { value: Math.abs(value), unit: w.unit, convention: 'assistance' }) : set('added', { value, unit: w.unit, convention: 'added' });
      }
      case 'stack':
      case 'added': {
        if (w === null || value === null) return set(ex.convention, null);
        if (value < 0) return { result: 'unreadable', detail: negative(value) };
        return set(ex.convention, { value, unit: w.unit, convention: ex.convention });
      }
      case 'assistance': {
        if (w === null || value === null) return set('assistance', null);
        return set('assistance', { value: Math.abs(value), unit: w.unit, convention: 'assistance' });
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
  const out: AliasSave[] = [];
  for (const n of analysis.names) {
    const e = dumbbells.get(n.key);
    // Asked about this import: his answer, or null when he cleared the one remembered from last time.
    const perHand = e === undefined ? undefined : (e.override ?? (e.remembered === null ? undefined : null));
    const used = n.answer === null && n.match.via === 'alias' && n.sets > 0;
    if (n.resolution.kind === 'skip') {
      if (n.answer || used) out.push({ key: n.key, name: n.name, target: { kind: 'skip' } });
      continue;
    }
    if (n.resolution.kind !== 'exercise' || (!n.answer && !used && perHand === undefined)) continue;
    const target: AliasTarget = { kind: 'exercise', exerciseId: n.resolution.exercise.exerciseId };
    out.push(perHand === undefined ? { key: n.key, name: n.name, target } : { key: n.key, name: n.name, target, perHand });
  }
  return out;
}

/**
 * The answers a new preview starts from (review r4 S2, N2). Load
 * conventions are never pre-answered (DX6), except with Ben's own answers:
 * - this same file's import (opened again after an undo): its answers,
 *   except names (remembered as aliases) and a gym that is gone;
 * - each name's dumbbell answer from the latest import that had it
 *   (`perHandAnswers`), shown as his answer last time.
 */
export function startingAnswers(
  rows: readonly FitNotesRow[],
  ctx: Pick<ImportContext, 'perHandAnswers'>,
  earlier: { answers: ImportAnswers; gymIds: ReadonlySet<string> } | null,
): ImportAnswers {
  const base: ImportAnswers = earlier
    ? { ...earlier.answers, names: {}, gymId: earlier.answers.gymId !== null && earlier.gymIds.has(earlier.answers.gymId) ? earlier.answers.gymId : null }
    : DEFAULT_ANSWERS;
  const remembered = ctx.perHandAnswers ?? new Map<string, PerHandReading>();
  const overrides: Record<string, PerHandReading> = { ...base.perHandOverrides };
  for (const r of rows) {
    if (r.rowClass !== 'strength') continue;
    const key = nameKey(r.exercise);
    const answer = remembered.get(key);
    if (answer !== undefined) overrides[key] = answer;
  }
  return { ...base, perHandOverrides: overrides };
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

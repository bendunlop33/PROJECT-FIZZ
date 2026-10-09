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
import { matchName, nameKey, type MatchCandidate, type NameMatch } from './match';

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
  /** Exercises a name can map to, in a stable order (ties suggest the first). */
  candidates: readonly MatchCandidate[];
  /** Ben's saved answers from earlier imports, by name key. */
  aliases: ReadonlyMap<string, AliasTarget>;
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
  /** `per_hand`: one dumbbell or two, from the catalogue; null when not recorded (asked; review r3 S1). */
  implements: ImplementCount | null;
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

export interface GroupQuestion<A> {
  exercises: { key: string; name: string; sets: number; override: A | null }[];
  answer: A | null;
  example: ExampleSet | null;
  /** Some exercise in the group has neither an override nor the group answer. */
  open: boolean;
}

/** One exercise on the dumbbell question (review r3 S1). */
export interface PerHandExercise {
  key: string;
  /** As first written in the file. */
  name: string;
  /** The app's exercise it maps to. */
  exerciseName: string;
  sets: number;
  /** One dumbbell or two, from the catalogue. Null: not recorded, so it is asked on its own. */
  implements: ImplementCount | null;
  override: PerHandReading | null;
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
  /** Two-dumbbell exercises (the group question is shown only when there is one). */
  pairs: number;
  /** The newest two-dumbbell set, for the group options. */
  example: ExampleSet | null;
  /** A two-dumbbell exercise waits for the group answer. */
  needsGroup: boolean;
  /** Exercises with no recorded count and no answer yet. */
  needsCount: number;
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
  total: (GroupQuestion<TotalAnswer> & { bars: BarWeightQuestion[]; missingBarWeight: boolean }) | null;
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

/** Stable ID of the custom exercise `Add new` makes for a source name, so a retried or repeated import reuses it. */
export function customExerciseIdFor(ownerId: string, key: string): string {
  return deriveId(`custom-exercise:${ownerId}:fitnotes:${key}`);
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
    return {
      kind: 'exercise',
      exercise: {
        exerciseId: c.exerciseId,
        name: c.name,
        laterality: c.laterality,
        convention: c.defaultLoadConvention,
        bar: barOf(c.compatibleEquipment),
        implements: c.implements,
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
            exerciseId: customExerciseIdFor(ctx.ownerId, key),
            name: name.slice(0, 120),
            laterality: 'bilateral',
            convention: CONVENTION_BY_KIND[answer.equipment],
            bar: answer.equipment === 'barbell' ? 'barbell' : 'none',
            // A new dumbbell exercise: one or two isn't known, so it is asked (review r3 S1).
            implements: null,
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
function perHandQuestion(live: readonly FitNotesRow[], resolved: (r: FitNotesRow) => ResolvedExercise | null, answers: ImportAnswers): PerHandQuestion | null {
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
      m = { key, name: r.exercise, exerciseName: ex.name, sets: 0, implements: ex.implements, override, reading: perHandReading(ex.implements, override, answers.perHand), sample: null };
      members.set(key, m);
    }
    m.sets += 1;
    const date = r.date ?? '';
    // The newest readable set (first in the file on that date); a negative weight can't be read for dumbbells.
    if (r.reps !== null && w.value >= 0 && (m.sample === null || date > (sampleDates.get(key) ?? ''))) {
      m.sample = { value: w.value, unit: w.unit, imported: m.reading === null ? null : perHandValue(w.value, m.reading) };
      sampleDates.set(key, date);
    }
    if (ex.implements === 2 && r.reps !== null && (example === null || date > example.date)) example = { name: r.exercise, date, value: w.value, unit: w.unit, reps: r.reps };
  }
  if (members.size === 0) return null;
  const exercises = [...members.values()];
  const needsGroup = exercises.some((e) => e.reading === null && e.implements === 2);
  const needsCount = exercises.filter((e) => e.reading === null && e.implements === null).length;
  return {
    exercises,
    answer: answers.perHand,
    pairs: exercises.filter((e) => e.implements === 2).length,
    example,
    needsGroup,
    needsCount,
    open: needsGroup || needsCount > 0,
  };
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
      const match = matchName(r.exercise, ctx.candidates, ctx.aliases);
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
  const groupOf = <A>(inGroup: (ex: ResolvedExercise) => boolean, groupAnswer: A | null, overrides: Readonly<Record<string, A>>): GroupQuestion<A> | null => {
    const members = new Map<string, { key: string; name: string; sets: number; override: A | null }>();
    let example: ExampleSet | null = null;
    for (const r of live) {
      const ex = resolved(r);
      if (!ex || !inGroup(ex)) continue;
      const w = enteredWeight(r, answers) ?? (r.bothColumns ? { value: r.bothColumns.kg, unit: 'kg' as const } : null);
      if (w === null) continue;
      const key = nameKey(r.exercise);
      const m = members.get(key) ?? { key, name: r.exercise, sets: 0, override: overrides[key] ?? null };
      m.sets += 1;
      members.set(key, m);
      if (r.reps !== null && (example === null || (r.date ?? '') > example.date)) example = { name: r.exercise, date: r.date ?? '', value: w.value, unit: w.unit, reps: r.reps };
    }
    if (members.size === 0) return null;
    const exercises = [...members.values()];
    return { exercises, answer: groupAnswer, example, open: exercises.some((e) => e.override === null && groupAnswer === null) };
  };
  const perHand = perHandQuestion(live, resolved, answers);
  // Barbell question: `total` exercises on a bar. Each bar kind has its own weight (review S1).
  const onBar = (ex: ResolvedExercise) => ex.convention === 'total' && ex.bar !== 'none';
  const totalGroup = groupOf<TotalAnswer>(onBar, answers.total, answers.totalOverrides);
  const barUse = new Map<ImportBarKind, { units: Set<WeightUnit>; needed: Set<WeightUnit> }>();
  for (const r of live) {
    const ex = resolved(r);
    const w = enteredWeight(r, answers);
    if (!ex || !onBar(ex) || !w || ex.bar === 'none' || ex.bar === 'unknown') continue;
    const use = barUse.get(ex.bar) ?? { units: new Set<WeightUnit>(), needed: new Set<WeightUnit>() };
    use.units.add(w.unit);
    if ((answers.totalOverrides[nameKey(r.exercise)] ?? answers.total) === 'plates_only') use.needed.add(w.unit);
    barUse.set(ex.bar, use);
  }
  const bars: BarWeightQuestion[] = BAR_KINDS.flatMap((bar) => {
    const use = barUse.get(bar);
    if (!use) return [];
    const weight = barWeightOf(bar, answers);
    const missing = [...use.needed].filter((u) => weight[u] === null).sort();
    return [{ bar, units: [...use.units].sort(), weight, needed: use.needed.size > 0, missing }];
  });
  const missingBarWeight = bars.some((b) => b.missing.length > 0);
  const total = totalGroup ? { ...totalGroup, open: totalGroup.open || missingBarWeight, bars, missingBarWeight } : null;

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
        const choice = answers.totalOverrides[key] ?? answers.total;
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

/** Names Ben answered, to remember for the next import (`ExerciseAlias`, §2.5 step 3a). */
export function aliasesToSave(analysis: ImportAnalysis): { key: string; name: string; target: AliasTarget }[] {
  const out: { key: string; name: string; target: AliasTarget }[] = [];
  for (const n of analysis.names) {
    if (!n.answer) continue;
    if (n.resolution.kind === 'skip') out.push({ key: n.key, name: n.name, target: { kind: 'skip' } });
    else if (n.resolution.kind === 'exercise') out.push({ key: n.key, name: n.name, target: { kind: 'exercise', exerciseId: n.resolution.exercise.exerciseId } });
  }
  return out;
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

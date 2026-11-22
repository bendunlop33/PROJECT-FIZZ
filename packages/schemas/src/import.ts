import { z } from 'zod';
import {
  IdSchema,
  LoadConventionSchema,
  LoadSchema,
  OperationIdSchema,
  RecordMetaSchema,
  RirSchema,
  RpeSchema,
  TimeZoneSchema,
  WeightUnitSchema,
  ZonedTimestampSchema,
} from './common';
import { LateralitySchema } from './exercise';
import { ImportJobLayoutSchema } from './import-layout';
import { SetTypeSchema } from './routine';

/**
 * FitNotes import (data-import-export.md §2.5, §3.4, §4.3; research
 * `fitnotes-export-format.md`). Everything here is **Your data** (rule 10):
 * the job, its source rows and the name mappings come from Ben's own file.
 * Imported text (exercise names, comments) is data, never instructions
 * (rule 8): it is stored and shown as written and never interpreted.
 */

/** `YYYY-MM-DD`, a real calendar date (no time, no zone). */
export const LocalDateSchema = z.iso.date();
export type LocalDate = z.infer<typeof LocalDateSchema>;

/**
 * The exact FitNotes CSV header layouts the importer recognises (research §2).
 * Anything else stops the import (DX5).
 * - `A1-kg` / `A1-lb`: Android up to v1.23, one weight column named after the unit, no comments.
 * - `A2-kg` / `A2-lb`: as A1, with `Comment`.
 * - `B1` / `B2`: Android v24+, `Weight` + `Weight Unit`, without / with `Comment`.
 * - `C`: FitNotes 2 (iPhone), `Weight (kg)` + `Weight (lbs)`, `Notes`, `Kind`.
 * - `D`: FitNotes 2 (iPhone) workout export (seen on Ben's file, 13 Oct 2026): one row per set with
 *   `Name`, `StartTime`/`EndTime` (ISO, UTC), `Weight` with no unit, `Status` (`Done`/`NotStarted`),
 *   `IsWarmup`, `RPE`, `RIR`, `Categories`, `Note`.
 */
export const FitNotesVariantSchema = z.enum(['A1-kg', 'A1-lb', 'A2-kg', 'A2-lb', 'B1', 'B2', 'C', 'D']);
export type FitNotesVariant = z.infer<typeof FitNotesVariantSchema>;

/**
 * What happened to one source row (the results CSV's `result` column, §4.3).
 * - `skipped_unsupported`: a timed, distance or weight-only set (a plank, a
 *   carry). Not cardio, but not importable yet: spec change S3 is undecided.
 * - `skipped_duplicate`: the date came in with an earlier import.
 * - `skipped_date_exists`: the date has a workout logged in the app and Ben chose to skip those dates.
 */
export const FITNOTES_ROW_RESULTS = [
  'imported',
  'skipped_cardio',
  'skipped_unsupported',
  'skipped_duplicate',
  'skipped_date_exists',
  'skipped_exercise',
  'unreadable',
] as const;

/**
 * Results only layout imports give (§9.2.10, ADR 0026):
 * - `skipped_value_to_check`: Ben chose `Skip` on a value to check (AI13);
 * - `skipped_not_a_set`: a marker he said is `Not a set` (a rest-timer row);
 * - `not_read`: reserved for notes lines no pattern reads (deferred).
 */
export const LAYOUT_ROW_RESULTS = ['skipped_value_to_check', 'skipped_not_a_set', 'not_read'] as const;

export const ImportRowResultSchema = z.enum([...FITNOTES_ROW_RESULTS, ...LAYOUT_ROW_RESULTS]);
export type ImportRowResult = z.infer<typeof ImportRowResultSchema>;

/** A source exercise name, normalised for matching (lower case, single spaces). */
export const NameKeySchema = z.string().min(1).max(200);

/** Equipment a custom exercise made during an import can use (`Add new`, §2.5 step 3a). */
export const CustomExerciseKindSchema = z.enum(['barbell', 'dumbbells', 'weight_stack', 'plate_loaded_machine', 'assisted_stack', 'bodyweight_station']);
export type CustomExerciseKind = z.infer<typeof CustomExerciseKindSchema>;

/** Ben's answer for one source exercise name. */
export const NameAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exercise'), exerciseId: IdSchema }),
  z.object({ kind: z.literal('new'), equipment: CustomExerciseKindSchema }),
  z.object({ kind: z.literal('skip') }),
]);
export type NameAnswer = z.infer<typeof NameAnswerSchema>;

/**
 * Dumbbells, the group answer: `"22.5"` means each dumbbell of the pair, or
 * both together (DX6: never pre-selected). It applies only to exercises the
 * catalogue records as done with two dumbbells (review r3 S1).
 */
export const PerHandAnswerSchema = z.enum(['each', 'both']);
export type PerHandAnswer = z.infer<typeof PerHandAnswerSchema>;

/**
 * How one exercise's dumbbell values are read (review r3 S1): `each` and
 * `both` as above, or `one`: the exercise is done with a single dumbbell or
 * kettlebell (a one-arm row, a goblet squat), so the value is that one's
 * weight, as written. A one-dumbbell exercise reads `one` unless Ben says
 * otherwise; an exercise whose count isn't recorded (a custom exercise,
 * `Add new`, or one done either way) never takes the group answer and is
 * asked on its own.
 */
export const PerHandReadingSchema = z.enum(['one', 'each', 'both']);
export type PerHandReading = z.infer<typeof PerHandReadingSchema>;

/**
 * Barbell, one exercise's answer: `"100"` is the total as written, or the
 * plates only (its bar's weight is added). `plates_only` is only ever an
 * answer for one exercise, never the group's (PM decision after review r7).
 */
export const TotalAnswerSchema = z.enum(['total', 'plates_only']);
export type TotalAnswer = z.infer<typeof TotalAnswerSchema>;

/**
 * Barbell, the group answer: only `total` ("Total as written", nothing
 * added). No group answer ever adds a bar weight (PM decision after review
 * r7). Jobs stored before then may hold `plates_only` here: it is kept as
 * stored and read as not answered.
 */
export const GroupTotalAnswerSchema = z.literal('total');
export type GroupTotalAnswer = z.infer<typeof GroupTotalAnswerSchema>;

/**
 * A bodyweight exercise with a weight: added to bodyweight, or assistance
 * from a machine. `split` (offered only when the exercise has both negative
 * and positive values, review B3): negative values are assistance, positive
 * values are weight added. Under `assistance`, a positive value in a file
 * that also has negative values for the exercise is unreadable, never
 * flipped into assistance.
 */
export const BodyweightAnswerSchema = z.enum(['added', 'assistance', 'split']);
export type BodyweightAnswer = z.infer<typeof BodyweightAnswerSchema>;

/**
 * Bars a "plates only" value can have a bar weight added to (review S1).
 * Each kind has its own weight: an EZ bar or trap bar isn't the Olympic bar.
 */
export const ImportBarKindSchema = z.enum(['barbell', 'ez_bar', 'trap_bar']);
export type ImportBarKind = z.infer<typeof ImportBarKindSchema>;

/** The heaviest bar weight an import accepts, per unit (never converted between kg and lb). */
export const BAR_WEIGHT_MAX = { kg: 100, lb: 220 } as const;

const OtherBarWeightSchema = z.object({ kg: z.number().positive().max(BAR_WEIGHT_MAX.kg).nullable(), lb: z.number().positive().max(BAR_WEIGHT_MAX.lb).nullable() });

/**
 * Every answer Ben gave on the preview (§2.5 steps 3a–3c). Changing any of
 * them bumps the preview's `mappingVersion`; a commit against an older
 * version is rejected (rule 5). Load-convention answers have no default
 * (`null` = not answered yet, DX6); the others have the spec's defaults.
 */
export const ImportAnswersSchema = z.object({
  /** Answers per source name key. Names that matched exactly need none (they can still be changed). */
  names: z.record(NameKeySchema, NameAnswerSchema),
  perHand: PerHandAnswerSchema.nullable(),
  /** Per exercise (by name key): wins over the group answer and the catalogue's count. */
  perHandOverrides: z.record(NameKeySchema, PerHandReadingSchema),
  /** The group answer. `plates_only` only in jobs stored before the PM decision after review r7; read as not answered. */
  total: TotalAnswerSchema.nullable(),
  /** Per exercise (by name key): `total` or `plates_only`. The only way a bar weight is ever added. */
  totalOverrides: z.record(NameKeySchema, TotalAnswerSchema),
  /**
   * Per exercise (by name key): the bar "plates only" adds, when Ben changed
   * it from the matched exercise's own bar. Absent in jobs stored before the
   * PM decision after review r7.
   */
  totalBars: z.record(NameKeySchema, ImportBarKindSchema).optional(),
  /** Olympic bar weight added to `plates_only` values, per unit (never converted between kg and lb). Default 20 kg / 45 lb, shown and editable. */
  barWeight: z.object({ kg: z.number().positive().max(BAR_WEIGHT_MAX.kg), lb: z.number().positive().max(BAR_WEIGHT_MAX.lb) }),
  /**
   * EZ-bar and trap-bar weights for `plates_only` values, per unit. No
   * default (they vary by bar): `null` until Ben enters one, and plates-only
   * rows on that bar wait for it.
   */
  otherBarWeight: z.object({ ez_bar: OtherBarWeightSchema, trap_bar: OtherBarWeightSchema }),
  bodyweight: z.record(NameKeySchema, BodyweightAnswerSchema),
  /** FitNotes 2 rows with both weight columns filled: which one Ben entered. */
  bothColumns: WeightUnitSchema.nullable(),
  /** Effort ratings in comments: notes only (default), or RPE for the rows Ben ticked. */
  effort: z.object({ mode: z.enum(['notes_only', 'review']), rows: z.array(z.int().min(2)).max(100_000) }),
  /** Dates that already have a workout logged in the app. */
  existingDates: z.enum(['skip', 'import']),
  /** Where the workouts were. Null = not recorded (the default: don't assume). */
  gymId: IdSchema.nullable(),
  /**
   * Values to check (AI13, layout imports): per `<workoutKey>|<name key>`,
   * import as written or skip that exercise's sets in that workout. No
   * default. Absent on FitNotes jobs.
   */
  valueChecks: z.record(z.string().max(400), z.enum(['import', 'skip'])).optional(),
});
export type ImportAnswers = z.infer<typeof ImportAnswersSchema>;

const count = z.int().min(0);

export const ImportCountsSchema = z.object({
  rows: count,
  workouts: count,
  sets: count,
  exercises: count,
  /** Every FitNotes result; the layout-only ones are absent on jobs stored before them. */
  byResult: z.object({
    imported: count,
    skipped_cardio: count,
    skipped_unsupported: count,
    skipped_duplicate: count,
    skipped_date_exists: count,
    skipped_exercise: count,
    unreadable: count,
    skipped_value_to_check: count.optional(),
    skipped_not_a_set: count.optional(),
    not_read: count.optional(),
  }),
});
export type ImportCounts = z.infer<typeof ImportCountsSchema>;

/**
 * - `committing`: rows saved, workouts being written (or paused: fewer
 *   workouts in than planned; `Continue import` resumes).
 * - `committed`: every planned workout is in.
 * - `reverted`: `Undo this import` hid its workouts (DX7). Nothing was deleted.
 */
export const ImportJobStatusSchema = z.enum(['committing', 'committed', 'reverted']);
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;

export const ImportJobSchema = RecordMetaSchema.extend({
  /** `layout`: any other app's table, read through a layout (§9, ADR 0026). */
  source: z.enum(['fitnotes', 'layout']),
  fileName: z.string().min(1).max(255),
  /** SHA-256 of the file's text: the same file is recognised however it's named. */
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  /** FitNotes only; null for a layout import. */
  variant: FitNotesVariantSchema.nullable(),
  /** Layout imports: the layout used (absent on FitNotes jobs). */
  layout: ImportJobLayoutSchema.optional(),
  /** The file's first line, as data. */
  header: z.string().max(4000),
  /** FitNotes dates have no zone: they are read as local dates in this zone (the phone's, when imported). */
  timezone: TimeZoneSchema,
  /** When the commit started. */
  startedAt: ZonedTimestampSchema,
  /** The commit's operation ID: every workout write derives from it, so a retry can't duplicate. */
  operationId: OperationIdSchema,
  mappingVersion: z.int().min(1),
  answers: ImportAnswersSchema,
  /** What the commit planned (row results are final when the commit starts). */
  counts: ImportCountsSchema,
  dateRange: z.object({ first: LocalDateSchema, last: LocalDateSchema }).nullable(),
  status: ImportJobStatusSchema,
  finishedAt: ZonedTimestampSchema.nullable(),
  /** `Undo this import`: when, the operation, and how many workouts were hidden. */
  revert: z.object({ at: ZonedTimestampSchema, opId: OperationIdSchema, workouts: count }).nullable(),
})
  .refine((j) => (j.source === 'fitnotes') === (j.variant !== null), { message: 'A FitNotes import has its variant, and only it', path: ['variant'] })
  .refine((j) => (j.source === 'layout') === (j.layout !== undefined), { message: 'A layout import records its layout, and only it', path: ['layout'] });
export type ImportJob = z.infer<typeof ImportJobSchema>;

/** What one imported row became: the set's mapped values (never snapped to equipment; rule 2). */
export const ImportedSetSchema = z.object({
  exerciseId: IdSchema,
  /** The app's exercise name at import (the session snapshot). The FitNotes name stays in `cells`. */
  exerciseName: z.string().min(1).max(120),
  laterality: LateralitySchema,
  convention: LoadConventionSchema,
  unit: WeightUnitSchema,
  load: LoadSchema.nullable(),
  reps: z.int().min(0).max(1000),
  rpe: RpeSchema.nullable(),
  sessionExerciseId: IdSchema,
  /** Position of the session exercise in its workout (first appearance). */
  exerciseOrder: z.int().min(0),
  /** Position of the set within its session exercise (row order). */
  setIndex: z.int().min(0),
  /** From a confirmed set-type marker (layout imports) or FitNotes 2's `IsWarmup`; absent = a working set, as before. */
  setType: SetTypeSchema.optional(),
  /** FitNotes 2's `RIR` column, when it holds a whole number 0–10; absent = none. */
  rir: RirSchema.optional(),
});
export type ImportedSet = z.infer<typeof ImportedSetSchema>;

/**
 * One source row, kept for good (check 24): raw cells as written, what
 * happened to it and, when imported, the set it became. Rows are immutable
 * once saved.
 */
export const ImportRowSchema = z
  .object({
    jobId: IdSchema,
    /** Spreadsheet row number: the header is row 1. */
    row: z.int().min(2),
    /**
     * Which set of the row (layout imports, ADR 0026): a packed or wide row
     * (`3x8`, `100x5,100x5`, `Set 1…Set 4`) gives several. Absent or 0 for a
     * row that gives one set (every FitNotes row).
     */
    part: z.int().min(0).max(63).optional(),
    /** The workout the row belongs to (layout imports): its date, start time or `Which workout` cell. Absent = its date (FitNotes). */
    workoutKey: z.string().min(1).max(200).optional(),
    /** The start time as written in the file (`18:02`, no zone; AI6). Absent or null when the file has none. */
    startLocal: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    /** Physical line where the record starts (a quoted newline shifts lines). */
    line: z.int().min(1),
    /** The row's date when it is a valid date, else null. */
    localDate: LocalDateSchema.nullable(),
    /** The exercise cell as written (data, never instructions). */
    exerciseName: z.string().max(4000),
    cells: z.array(z.string().max(20_000)).max(64),
    result: ImportRowResultSchema,
    detail: z.string().max(500).nullable(),
    sessionId: IdSchema.nullable(),
    setId: IdSchema.nullable(),
    imported: ImportedSetSchema.nullable(),
  })
  .refine((r) => (r.result === 'imported') === (r.imported !== null && r.sessionId !== null && r.setId !== null), {
    message: 'Imported rows (and only those) carry the set they became',
    path: ['result'],
  });
export type ImportRow = z.infer<typeof ImportRowSchema>;

/** Remembered answer for a source name (`ExerciseAlias`, brief §6; spec §2.5 step 3a). */
export const AliasTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exercise'), exerciseId: IdSchema }),
  z.object({ kind: z.literal('skip') }),
]);
export type AliasTarget = z.infer<typeof AliasTargetSchema>;

/** The most uses an alias keeps (one per import; the oldest drop off first). */
export const ALIAS_USES_MAX = 100;

/**
 * Ben's own barbell answer for one exercise, as remembered on its name's
 * alias (PM decision after review r7). Exact (review r8 B1, B2): the
 * exercise it was given for, and for "plates only" the bar it actually
 * added (`barChosen`: Ben changed it from the exercise's own) and that
 * bar's weight per unit the exercise's sets were written in. A later
 * import fills it in only when the name resolves to the same exercise and
 * bar and the bar weight in effect is the same (or still to be entered).
 * Records written by the review r8 build lack `exerciseId` and are shown,
 * never filled in.
 */
export const RememberedTotalSchema = z.object({
  reading: TotalAnswerSchema,
  exerciseId: IdSchema.optional(),
  bar: ImportBarKindSchema.optional(),
  barChosen: z.boolean().optional(),
  barWeight: z.object({ kg: z.number().positive().max(BAR_WEIGHT_MAX.kg).optional(), lb: z.number().positive().max(BAR_WEIGHT_MAX.lb).optional() }).optional(),
});
export type RememberedTotal = z.infer<typeof RememberedTotalSchema>;

/**
 * One import's answer for a name (review r5 S2): the exercise (or Skip) it
 * used and, when that import asked about the name's dumbbells, Ben's answer
 * (`null`: he cleared it; absent: that import didn't ask).
 */
export const AliasUseSchema = z.object({
  jobId: IdSchema,
  target: AliasTargetSchema,
  perHand: PerHandReadingSchema.nullable().optional(),
  /**
   * Ben's own barbell answer for the name when that import asked (`null`:
   * he gave none, clearing one remembered; absent: that import didn't ask).
   * See `RememberedTotalSchema` (PM decision after review r7; review r8 B1, B2).
   */
  total: RememberedTotalSchema.nullable().optional(),
});
export type AliasUse = z.infer<typeof AliasUseSchema>;

/**
 * Ben's own name for an exercise, learnt from an import, so the next import
 * of a newer file matches it automatically. Owner-scoped (Your data): it
 * describes his naming, not general knowledge.
 *
 * What it says now is read from `uses`, ignoring imports that were undone
 * (`rememberedAnswer` in `@fizz/domain`): Undo import takes back what that
 * import taught (review r5 S2). `target`, `perHand` and `jobId` are the last
 * write, kept as they were for older records.
 */
export const ExerciseAliasSchema = RecordMetaSchema.extend({
  source: z.literal('fitnotes'),
  /** The name as written in the file. */
  name: z.string().min(1).max(4000),
  nameKey: NameKeySchema,
  target: AliasTargetSchema,
  /**
   * Ben's own answer for this name's dumbbell weights (one dumbbell, each,
   * both together), so a newer export reads them the same way. The next
   * preview starts with it, labelled as his answer last time (review r4 S2).
   * Absent when he gave none for this exercise (the group answer isn't kept).
   */
  perHand: PerHandReadingSchema.optional(),
  /** The import that last wrote it. */
  jobId: IdSchema,
  /** Every import that answered or used the name, oldest first (absent on records written before review r5). */
  uses: z.array(AliasUseSchema).max(ALIAS_USES_MAX).optional(),
});
export type ExerciseAlias = z.infer<typeof ExerciseAliasSchema>;
